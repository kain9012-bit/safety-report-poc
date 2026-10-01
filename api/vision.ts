/**
 * 사진 판독 중계.  POST /api/vision  { images: ["data:image/jpeg;base64,...", "..."] }
 *
 * 비전 AI(지금은 Gemini)에게 사진 두 장만 보낸다. **좌표나 주변 시설 정보는 보내지 않는다.**
 * "근처에 정류장이 있다"고 알려주면 AI가 그쪽으로 기울 수 있어서다.
 * 사진만 보고 따로 판단하게 한 뒤, 앱이 좌표 결과와 맞대어 본다(src/lib/crosscheck.ts).
 *
 * 키는 서버에만 있다. 사진은 기록·저장하지 않는다.
 * 이 파일은 다른 파일을 import 하지 않는다 — Vercel 함수로 따로 묶여도 깨지지 않게.
 */

export type Tri = 'yes' | 'no' | 'unclear';
export type PhotoType = 'busstop' | 'crossing' | 'corner' | 'schoolzone' | 'sidewalk' | 'hydrant' | 'none';

export interface VisionResult {
  plate: { text: string; readable: boolean; confidence: number };
  sameVehicle: Tri;
  sameSpot: Tri;
  scene: {
    onCrosswalk: Tri;
    onSidewalk: Tri;
    busStopVisible: Tri;
    schoolZoneMarking: Tri;
    intersectionCorner: Tri;
    fireHydrantNear: Tri;
  };
  typeGuess: PhotoType;
  typeConfidence: number;
  evidence: string;
  model: string;
}

export type VisionError = 'bad_request' | 'no_key' | 'rate_limited' | 'busy' | 'upstream' | 'too_large';

/** 2026-10 무료 키로 확인한 모델. gemini-2.5-flash 는 새 사용자에게 닫혔다(404). */
export const DEFAULT_MODEL = 'gemini-3.5-flash';
export const FALLBACK_MODELS = ['gemini-3-flash-preview', 'gemini-flash-latest'];

const TRI = { type: 'STRING', enum: ['yes', 'no', 'unclear'] };

/** Gemini 구조화 출력 형식. 필드 이름은 응답 JSON과 같다. */
export const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    plate: {
      type: 'OBJECT',
      properties: {
        text: { type: 'STRING', description: '번호판 글자. 공백 없이. 못 읽으면 빈 문자열' },
        readable: { type: 'BOOLEAN' },
        confidence: { type: 'NUMBER', description: '0~1' },
      },
      required: ['text', 'readable', 'confidence'],
    },
    sameVehicle: TRI,
    sameSpot: TRI,
    scene: {
      type: 'OBJECT',
      properties: {
        onCrosswalk: TRI,
        onSidewalk: TRI,
        busStopVisible: TRI,
        schoolZoneMarking: TRI,
        intersectionCorner: TRI,
        fireHydrantNear: TRI,
      },
      required: ['onCrosswalk', 'onSidewalk', 'busStopVisible', 'schoolZoneMarking', 'intersectionCorner', 'fireHydrantNear'],
    },
    typeGuess: {
      type: 'STRING',
      enum: ['busstop', 'crossing', 'corner', 'schoolzone', 'sidewalk', 'hydrant', 'none'],
    },
    typeConfidence: { type: 'NUMBER', description: '0~1' },
    evidence: { type: 'STRING', description: '판단 근거 한 문장(한국어). 사진에 보이는 것만' },
  },
  required: ['plate', 'sameVehicle', 'sameSpot', 'scene', 'typeGuess', 'typeConfidence', 'evidence'],
};

export const PROMPT = `너는 한국의 불법 주정차 신고 사진을 판독한다. 사진은 같은 차를 약 1분 간격으로 같은 자리에서 찍은 두 장이다.
사진에 실제로 보이는 것만 답한다. 추측으로 채우지 않는다.

1. plate: 단속 대상 차량의 번호판.
   - 한국 번호판 형식(예: 12가3456, 123가4567, 서울12가3456)으로 공백 없이 적는다.
   - 한 글자라도 확실하지 않으면 readable=false, text는 빈 문자열로 둔다. 틀린 번호는 엉뚱한 사람에게 과태료가 간다.
   - confidence는 0~1.
2. sameVehicle: 두 장의 차가 같은 차인가. sameSpot: 같은 자리에서 찍었나. (yes/no/unclear)
3. scene: 차가 서 있는 자리에 대해 yes/no/unclear.
   - onCrosswalk: 차가 횡단보도(흰 줄무늬) 위에 걸쳐 있다
   - onSidewalk: 차가 보도(인도) 위에 올라가 있다
   - busStopVisible: 버스정류장 표지판·승강장이 차 바로 옆에 보인다
   - schoolZoneMarking: 어린이보호구역 표시(빨간 노면, '어린이보호구역' 표지·글씨)가 보인다
   - intersectionCorner: 차가 교차로 모퉁이(도로가 꺾이거나 만나는 곳)에 붙어 있다
   - fireHydrantNear: 소화전·소방용수시설 표시가 차 바로 옆에 보인다
4. typeGuess: 위를 종합한 가장 알맞은 위반 유형 하나. 해당 없으면 none.
   busstop=버스정류소, crossing=횡단보도, corner=교차로 모퉁이, schoolzone=어린이보호구역, sidewalk=인도, hydrant=소화전
5. typeConfidence: 0~1. evidence: 그렇게 본 근거 한 문장(한국어).`;

/** data URL 에서 base64 와 형식을 꺼낸다. 이미지가 아니면 null. */
export function parseDataUrl(s: unknown): { mime: string; data: string } | null {
  if (typeof s !== 'string') return null;
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(s);
  return m ? { mime: m[1], data: m[2] } : null;
}

const clamp01 = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
const tri = (v: unknown): Tri => (v === 'yes' || v === 'no' ? v : 'unclear');

/** 모델 출력이 형식을 어겨도 앱이 깨지지 않게 다듬는다. */
export function normalize(raw: unknown, model: string): VisionResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, any>;
  const sc = (r.scene ?? {}) as Record<string, unknown>;
  const types: PhotoType[] = ['busstop', 'crossing', 'corner', 'schoolzone', 'sidewalk', 'hydrant', 'none'];
  const text = typeof r.plate?.text === 'string' ? r.plate.text.replace(/\s/g, '') : '';
  return {
    plate: { text, readable: Boolean(r.plate?.readable) && text.length > 0, confidence: clamp01(r.plate?.confidence) },
    sameVehicle: tri(r.sameVehicle),
    sameSpot: tri(r.sameSpot),
    scene: {
      onCrosswalk: tri(sc.onCrosswalk),
      onSidewalk: tri(sc.onSidewalk),
      busStopVisible: tri(sc.busStopVisible),
      schoolZoneMarking: tri(sc.schoolZoneMarking),
      intersectionCorner: tri(sc.intersectionCorner),
      fireHydrantNear: tri(sc.fireHydrantNear),
    },
    typeGuess: types.includes(r.typeGuess) ? r.typeGuess : 'none',
    typeConfidence: clamp01(r.typeConfidence),
    evidence: typeof r.evidence === 'string' ? r.evidence.slice(0, 200) : '',
    model,
  };
}

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/** 사진 두 장 합계 상한(base64 글자 수). Vercel 함수 요청 본문 한도(4.5MB) 안쪽. */
const MAX_B64 = 4_000_000;

export async function POST(request: Request): Promise<Response> {
  let body: { images?: unknown[] };
  try {
    body = (await request.json()) as { images?: unknown[] };
  } catch {
    return reply({ error: 'bad_request' }, 400);
  }
  const imgs = (body.images ?? []).slice(0, 2).map(parseDataUrl);
  if (imgs.length === 0 || imgs.some((x) => !x)) return reply({ error: 'bad_request' }, 400);
  if (imgs.reduce((n, x) => n + x!.data.length, 0) > MAX_B64) return reply({ error: 'too_large' }, 413);

  const provider = (process.env.VISION_PROVIDER ?? 'gemini').toLowerCase();
  const key = process.env.VISION_API_KEY;
  if (!key || provider !== 'gemini') return reply({ error: 'no_key' }, 503);
  // 지정 모델이 붐비거나(503) 없어지면(404) 다음 후보로 넘어간다. 무료 키는 옛 모델을 못 쓰기도 한다.
  const models = [...new Set([process.env.VISION_MODEL || DEFAULT_MODEL, ...FALLBACK_MODELS])];

  try {
    for (const model of models) {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                { text: PROMPT },
                ...imgs.map((x) => ({ inline_data: { mime_type: x!.mime, data: x!.data } })),
              ],
            },
          ],
          generationConfig: { temperature: 0, thinkingConfig: { thinkingLevel: 'low' }, responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA },
        }),
        signal: AbortSignal.timeout(40_000),
      });
      if (res.status === 503 || res.status === 404) continue;
      if (res.status === 429) return reply({ error: 'rate_limited' }, 429);
      if (!res.ok) return reply({ error: 'upstream', status: res.status }, 502);
      const j = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      const text = j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return reply({ error: 'upstream' }, 502);
      }
      const out = normalize(parsed, model);
      return out ? reply(out) : reply({ error: 'upstream' }, 502);
    }
    return reply({ error: 'busy' }, 503);
  } catch {
    return reply({ error: 'upstream' }, 502);
  }
}
