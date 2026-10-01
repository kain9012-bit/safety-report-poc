/**
 * 사진 판독 중계.  POST /api/vision  { images: ["data:image/jpeg;base64,...", "..."] }
 *
 * 비전 AI(지금은 Gemini)에게 맡기는 것은 "사진에 무엇이 보이는가"까지다. 판정은 이 파일의 규칙이 한다.
 *
 *  1. 사진마다 따로 부른다(병렬). 한 번에 두 장을 주면 한 장에서 읽은 번호를 다른 장에 베낄 수 있다.
 *     두 장에서 **따로 읽은 번호가 같을 때만** 번호판을 확정한다.
 *  2. AI에게는 장면 항목(횡단보도 위·인도·정류장 표지…)만 yes/no/unclear 로 받고,
 *     **유형은 그 항목에서 규칙으로 정한다**(typesFromScene). AI가 따로 낸 유형과 다르면 확신도를 낮춘다.
 *  3. 근거마다 사진 속 위치(상자)를 받는다. 화면이 사진 위에 그려 사람이 눈으로 확인한다.
 *
 * 좌표·주변 시설은 일부러 보내지 않는다 — 힌트를 주면 그쪽으로 기울 수 있다.
 * 키는 서버에만 있다. 사진은 기록·저장하지 않는다.
 * 이 파일은 다른 파일을 import 하지 않는다 — Vercel 함수로 따로 묶여도 깨지지 않게.
 */

export type Tri = 'yes' | 'no' | 'unclear';
export type PhotoType = 'busstop' | 'crossing' | 'corner' | 'schoolzone' | 'sidewalk' | 'hydrant' | 'none';
export type BoxLabel =
  | 'plate'
  | 'vehicle'
  | 'crosswalk'
  | 'sidewalk'
  | 'busstop_sign'
  | 'schoolzone_mark'
  | 'corner'
  | 'hydrant';

export interface Scene {
  onCrosswalk: Tri;
  onSidewalk: Tri;
  busStopVisible: Tri;
  schoolZoneMarking: Tri;
  intersectionCorner: Tri;
  fireHydrantNear: Tri;
}

/** 근거 상자 — [위, 왼쪽, 아래, 오른쪽], 사진 크기를 0~1000으로 본 값 */
export interface Box {
  label: BoxLabel;
  box: [number, number, number, number];
}

/** 사진 한 장을 읽은 결과 */
export interface PhotoRead {
  plate: { text: string; readable: boolean; confidence: number };
  scene: Scene;
  typeGuess: PhotoType;
  typeConfidence: number;
  evidence: string;
  boxes: Box[];
}

export interface VisionResult {
  /** 장마다 읽은 결과(0: 첫 장, 1: 둘째 장). 한 장이 실패하면 null */
  photos: (PhotoRead | null)[];
  /** 두 장을 맞대어 정한 번호판. agree=true 일 때만 앱이 채운다 */
  plate: { text: string; readable: boolean; confidence: number; agree: boolean | null; reads: string[] };
  /** 두 장의 번호가 같으면 yes, 둘 다 읽혔는데 다르면 no */
  sameVehicle: Tri;
  scene: Scene;
  /** 장면 항목에서 규칙으로 뽑은 유형(우선순위 순) */
  ruleTypes: PhotoType[];
  /** 최종 사진 유형 = ruleTypes[0]. AI 유형과 엇갈리면 확신도를 낮춘다 */
  typeGuess: PhotoType;
  typeConfidence: number;
  modelAgrees: boolean;
  evidence: string;
  model: string;
}

export type VisionError = 'bad_request' | 'no_key' | 'rate_limited' | 'busy' | 'upstream' | 'too_large';

/** 2026-10 무료 키로 확인한 모델. gemini-2.5-flash 는 새 사용자에게 닫혔다(404). */
export const DEFAULT_MODEL = 'gemini-3.5-flash';
export const FALLBACK_MODELS = ['gemini-3-flash-preview', 'gemini-flash-latest'];

/** AI 유형과 규칙 유형이 엇갈릴 때 낮춰 주는 확신도 — 앱의 사진 유형 기준(0.5)보다 낮게 */
export const DISAGREE_CONFIDENCE = 0.4;

const TRI = { type: 'STRING', enum: ['yes', 'no', 'unclear'] };
const LABELS: BoxLabel[] = ['plate', 'vehicle', 'crosswalk', 'sidewalk', 'busstop_sign', 'schoolzone_mark', 'corner', 'hydrant'];

/** Gemini 구조화 출력 형식(사진 한 장) */
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
    typeGuess: { type: 'STRING', enum: ['busstop', 'crossing', 'corner', 'schoolzone', 'sidewalk', 'hydrant', 'none'] },
    typeConfidence: { type: 'NUMBER', description: '0~1' },
    evidence: { type: 'STRING', description: '판단 근거 한 문장(한국어). 사진에 보이는 것만' },
    boxes: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          label: { type: 'STRING', enum: LABELS },
          box_2d: { type: 'ARRAY', items: { type: 'INTEGER' }, description: '[ymin, xmin, ymax, xmax], 0~1000' },
        },
        required: ['label', 'box_2d'],
      },
    },
  },
  required: ['plate', 'scene', 'typeGuess', 'typeConfidence', 'evidence', 'boxes'],
};

export const PROMPT = `너는 한국의 불법 주정차 신고 사진 한 장을 판독한다. 사진에 실제로 보이는 것만 답한다. 추측으로 채우지 않는다.

1. plate: 단속 대상 차량의 번호판.
   - 한국 번호판 형식(예: 12가3456, 123가4567, 서울12가3456)으로 공백 없이 적는다.
   - 한 글자라도 확실하지 않으면 readable=false, text는 빈 문자열. 틀린 번호는 엉뚱한 사람에게 과태료가 간다.
   - confidence는 0~1.
2. scene: 단속 대상 차가 서 있는 자리에 대해 yes/no/unclear. 보이지 않으면 unclear.
   - onCrosswalk: 차가 횡단보도(흰 줄무늬) 위에 걸쳐 있다
   - onSidewalk: 차가 보도(인도) 위에 올라가 있다
   - busStopVisible: 버스정류장 표지판·승강장이 차 바로 옆에 보인다
   - schoolZoneMarking: 어린이보호구역 표시(빨간 노면, '어린이보호구역' 표지·글씨)가 보인다
   - intersectionCorner: 차가 교차로 모퉁이(도로가 꺾이거나 만나는 곳)에 붙어 있다
   - fireHydrantNear: 소화전·소방용수시설 표시가 차 바로 옆에 보인다
3. typeGuess: 가장 알맞은 위반 유형 하나. 해당 없으면 none.
   busstop=버스정류소, crossing=횡단보도, corner=교차로 모퉁이, schoolzone=어린이보호구역, sidewalk=인도, hydrant=소화전
4. typeConfidence: 0~1. evidence: 그렇게 본 근거 한 문장(한국어).
5. boxes: 근거가 된 것의 위치. 번호판(plate), 단속 차량(vehicle), 그리고 scene 에서 yes 로 답한 것마다
   (crosswalk, sidewalk, busstop_sign, schoolzone_mark, corner, hydrant) 상자 하나.
   box_2d 는 [ymin, xmin, ymax, xmax] 로, 사진 크기를 0~1000으로 본 정수.`;

/** data URL 에서 base64 와 형식을 꺼낸다. 이미지가 아니면 null. */
export function parseDataUrl(s: unknown): { mime: string; data: string } | null {
  if (typeof s !== 'string') return null;
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(s);
  return m ? { mime: m[1], data: m[2] } : null;
}

const clamp01 = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
const tri = (v: unknown): Tri => (v === 'yes' || v === 'no' ? v : 'unclear');
const TYPES: PhotoType[] = ['busstop', 'crossing', 'corner', 'schoolzone', 'sidewalk', 'hydrant', 'none'];
const SCENE_KEYS: (keyof Scene)[] = [
  'onCrosswalk',
  'onSidewalk',
  'busStopVisible',
  'schoolZoneMarking',
  'intersectionCorner',
  'fireHydrantNear',
];

function normalizeBox(b: unknown): Box | null {
  const r = b as { label?: unknown; box_2d?: unknown; box?: unknown };
  const arr = (Array.isArray(r?.box_2d) ? r.box_2d : r?.box) as unknown[];
  if (!LABELS.includes(r?.label as BoxLabel) || !Array.isArray(arr) || arr.length !== 4) return null;
  const n = arr.map((v) => Math.round(Math.min(1000, Math.max(0, Number(v)))));
  if (n.some((v) => !Number.isFinite(v))) return null;
  const [y0, x0, y1, x1] = n;
  if (y1 <= y0 || x1 <= x0) return null;
  return { label: r.label as BoxLabel, box: [y0, x0, y1, x1] };
}

/** 사진 한 장의 모델 출력을 다듬는다. 형식을 어겨도 앱이 깨지지 않게. */
export function normalizeRead(raw: unknown): PhotoRead | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, any>;
  const sc = (r.scene ?? {}) as Record<string, unknown>;
  const text = typeof r.plate?.text === 'string' ? r.plate.text.replace(/\s/g, '') : '';
  const scene = Object.fromEntries(SCENE_KEYS.map((k) => [k, tri(sc[k])])) as unknown as Scene;
  return {
    plate: { text, readable: Boolean(r.plate?.readable) && text.length > 0, confidence: clamp01(r.plate?.confidence) },
    scene,
    typeGuess: TYPES.includes(r.typeGuess) ? r.typeGuess : 'none',
    typeConfidence: clamp01(r.typeConfidence),
    evidence: typeof r.evidence === 'string' ? r.evidence.slice(0, 200) : '',
    boxes: Array.isArray(r.boxes) ? (r.boxes.map(normalizeBox).filter(Boolean) as Box[]) : [],
  };
}

/** 두 장의 yes/no 를 합친다. 한쪽 yes·한쪽 no 면 판단 보류. */
export function mergeTri(a?: Tri, b?: Tri): Tri {
  const v = [a, b].filter((x): x is Tri => Boolean(x));
  if (v.includes('yes') && v.includes('no')) return 'unclear';
  if (v.includes('yes')) return 'yes';
  if (v.includes('no')) return 'no';
  return 'unclear';
}

/**
 * 장면 항목 → 유형(규칙). 여러 개가 yes 면 이 순서로 앞선 것이 먼저다.
 * 차가 '어디에 올라섰나'(횡단보도·인도) → '무엇 옆인가'(소화전·정류장·모퉁이) → '어느 구역인가'(보호구역)
 */
export const SCENE_TO_TYPE: [keyof Scene, PhotoType][] = [
  ['onCrosswalk', 'crossing'],
  ['onSidewalk', 'sidewalk'],
  ['fireHydrantNear', 'hydrant'],
  ['busStopVisible', 'busstop'],
  ['intersectionCorner', 'corner'],
  ['schoolZoneMarking', 'schoolzone'],
];

export function typesFromScene(s: Scene): PhotoType[] {
  return SCENE_TO_TYPE.filter(([k]) => s[k] === 'yes').map(([, t]) => t);
}

/** 사진 두 장(또는 한 장)의 판독을 하나로 — 번호판 대조, 장면 합치기, 규칙 유형 */
export function mergeReads(reads: (PhotoRead | null)[], model: string): VisionResult | null {
  const ok = reads.filter((r): r is PhotoRead => Boolean(r));
  if (ok.length === 0) return null;
  const [a, b] = reads;

  // 번호판 — 두 장에서 따로 읽은 값이 같아야 확정
  const readable = ok.filter((r) => r.plate.readable);
  const texts = readable.map((r) => r.plate.text);
  const agree = a?.plate.readable && b?.plate.readable ? a.plate.text === b.plate.text : null;
  const plate = {
    text: agree ? texts[0] : texts.length === 1 ? texts[0] : '',
    readable: readable.length > 0,
    confidence: readable.length ? Math.min(...readable.map((r) => r.plate.confidence)) : 0,
    agree,
    reads: texts,
  };
  const sameVehicle: Tri = agree === true ? 'yes' : agree === false ? 'no' : 'unclear';

  const scene = Object.fromEntries(SCENE_KEYS.map((k) => [k, mergeTri(a?.scene[k], b?.scene[k])])) as unknown as Scene;
  const ruleTypes = typesFromScene(scene);
  const guesses = ok.map((r) => r.typeGuess).filter((t) => t !== 'none');
  const top = ruleTypes[0] ?? 'none';
  const modelAgrees = top === 'none' ? guesses.length === 0 : guesses.includes(top);
  const conf = Math.max(0, ...ok.filter((r) => r.typeGuess === top).map((r) => r.typeConfidence));
  const evidence = (ok.find((r) => r.typeGuess === top) ?? ok[0]).evidence;

  return {
    photos: reads,
    plate,
    sameVehicle,
    scene,
    ruleTypes,
    typeGuess: top,
    // 규칙과 AI가 같은 답이면 AI 확신도를, 엇갈리면 낮춘 값을 쓴다
    typeConfidence: top === 'none' ? 0 : modelAgrees ? conf : DISAGREE_CONFIDENCE,
    modelAgrees,
    evidence,
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

type CallOutcome = { read: PhotoRead; model: string } | 'rate_limited' | 'busy' | 'upstream';

/** 사진 한 장 판독. 지정 모델이 붐비거나(503) 없어지면(404) 다음 후보로 넘어간다. */
async function readOne(img: { mime: string; data: string }, key: string, models: string[]): Promise<CallOutcome> {
  for (const model of models) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: PROMPT }, { inline_data: { mime_type: img.mime, data: img.data } }] }],
        generationConfig: {
          temperature: 0,
          thinkingConfig: { thinkingLevel: 'low' },
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
        },
      }),
      signal: AbortSignal.timeout(40_000),
    });
    if (res.status === 503 || res.status === 404) continue;
    if (res.status === 429) return 'rate_limited';
    if (!res.ok) return 'upstream';
    const j = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    try {
      const read = normalizeRead(JSON.parse(text));
      return read ? { read, model } : 'upstream';
    } catch {
      return 'upstream';
    }
  }
  return 'busy';
}

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
  const models = [...new Set([process.env.VISION_MODEL || DEFAULT_MODEL, ...FALLBACK_MODELS])];

  try {
    const outcomes = await Promise.all(imgs.map((img) => readOne(img!, key, models)));
    const reads = outcomes.map((o) => (typeof o === 'object' ? o.read : null));
    const model = outcomes.find((o): o is { read: PhotoRead; model: string } => typeof o === 'object')?.model ?? '';
    const merged = mergeReads(reads, model);
    if (merged) return reply(merged);
    if (outcomes.includes('rate_limited')) return reply({ error: 'rate_limited' }, 429);
    if (outcomes.every((o) => o === 'busy')) return reply({ error: 'busy' }, 503);
    return reply({ error: 'upstream' }, 502);
  } catch {
    return reply({ error: 'upstream' }, 502);
  }
}
