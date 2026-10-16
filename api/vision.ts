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
export type PhotoType =
  | 'busstop'
  | 'crossing'
  | 'corner'
  | 'schoolzone'
  | 'sidewalk'
  | 'hydrant'
  | 'disabled'
  | 'firelane'
  | 'evcharge'
  | 'none';
export type BoxLabel =
  | 'plate'
  | 'vehicle'
  | 'crosswalk'
  | 'sidewalk'
  | 'busstop_sign'
  | 'schoolzone_mark'
  | 'corner'
  | 'hydrant'
  | 'disabled_mark'
  | 'permit'
  | 'firelane_mark'
  | 'ev_charger';

export interface Scene {
  onCrosswalk: Tri;
  onSidewalk: Tri;
  busStopVisible: Tri;
  schoolZoneMarking: Tri;
  intersectionCorner: Tri;
  fireHydrantNear: Tri;
  /** 차가 장애인전용주차구역(휠체어 표시·구획) 안에 있다 */
  disabledSpace: Tri;
  /** 그 차 앞유리에 장애인자동차표지(주차가능)가 보인다 — yes 면 위반이 아닐 수 있다 */
  disabledPermit: Tri;
  /** 차가 소방차 전용구역(빨간·노란 빗금, '소방차 전용' 글씨) 안에 있다 */
  fireLane: Tri;
  /** 차가 친환경차 충전구역(충전기 앞 구획, '충전구역'·'전기차 전용' 표시) 안에 있다 */
  evChargingSpace: Tri;
  /** 그 차가 친환경차로 보인다(하늘색 번호판, 전기·수소차 표시) — yes 면 '일반차 주차' 위반이 아니다 */
  evVehicle: Tri;
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
  /** 바퀴가 닿은 바닥 — 횡단보도·인도 '위'는 이것으로만 정한다. 이전 판독에는 없다. */
  ground?: GroundRead;
}

/** 바퀴 하나가 닿은 바닥 — 하나만 고른다 */
export type WheelSurface = 'roadway' | 'crosswalk_stripe' | 'sidewalk_block' | 'curb' | 'unclear';
/** 차 전체로 하나 — 한 바퀴라도 흰 줄 위면 crosswalk, 보도블록 위면 sidewalk, 둘 다면 both, 보이는 바퀴가 모두 차도면 roadway */
export type GroundSurface = 'roadway' | 'crosswalk' | 'sidewalk' | 'both' | 'unclear';
/** 차와 횡단보도의 관계 — on(흰 줄 위)·adjacent(바로 앞뒤)·apart(떨어짐)·none(횡단보도 없음) */
export type CrosswalkRelation = 'on' | 'adjacent' | 'apart' | 'none' | 'unclear';
/**
 * '바퀴가 닿은 바닥' 판독(사진 한 장). 근처에 보이는 횡단보도·보도와 차가 그 위에 있는 것을 섞지 않으려고
 * 장면 항목과 따로 묻는다. 실제 사진에서 '횡단보도 위?·인도 위?'를 따로 물으면 바로 앞에 선 차를 '위'로 잘못 읽었다.
 */
export interface GroundRead {
  surface: GroundSurface;
  wheels: { wheel: string; surface: WheelSurface }[];
  crosswalkRelation: CrosswalkRelation;
  evidence: string;
}

export interface VisionResult {
  /** 장마다 읽은 결과(0: 첫 번째 사진, 1: 두 번째 사진). 한 장이 실패하면 null */
  photos: (PhotoRead | null)[];
  /** 두 장을 맞대어 정한 번호판. agree=true 일 때만 앱이 채운다 */
  plate: { text: string; readable: boolean; confidence: number; agree: boolean | null; reads: string[] };
  /** 두 장 모두 형식·확신도 기준을 충족하고 번호가 같으면 yes, 다르면 no */
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
  /** 횡단보도 바로 앞(바퀴는 횡단보도 밖)으로 읽힌 사진이 있다 — 유형으로 정하지 않고 따로 알린다 */
  crosswalkAdjacent?: boolean;
}

export type VisionError = 'bad_request' | 'no_key' | 'rate_limited' | 'busy' | 'upstream' | 'too_large';

/** 2026-10 무료 키로 확인한 모델. gemini-2.5-flash 는 새 사용자에게 닫혔다(404). */
export const DEFAULT_MODEL = 'gemini-3.5-flash';
export const FALLBACK_MODELS = ['gemini-3-flash-preview', 'gemini-flash-latest'];

/** AI 유형과 규칙 유형이 엇갈릴 때 낮춰 주는 확신도 — 앱의 사진 유형 기준(0.5)보다 낮게 */
export const DISAGREE_CONFIDENCE = 0.4;

const TRI = { type: 'STRING', enum: ['yes', 'no', 'unclear'] };
const LABELS: BoxLabel[] = [
  'plate',
  'vehicle',
  'crosswalk',
  'sidewalk',
  'busstop_sign',
  'schoolzone_mark',
  'corner',
  'hydrant',
  'disabled_mark',
  'permit',
  'firelane_mark',
  'ev_charger',
];

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
        disabledSpace: TRI,
        disabledPermit: TRI,
        fireLane: TRI,
        evChargingSpace: TRI,
        evVehicle: TRI,
      },
      required: [
        'onCrosswalk',
        'onSidewalk',
        'busStopVisible',
        'schoolZoneMarking',
        'intersectionCorner',
        'fireHydrantNear',
        'disabledSpace',
        'disabledPermit',
        'fireLane',
        'evChargingSpace',
        'evVehicle',
      ],
    },
    typeGuess: {
      type: 'STRING',
      enum: ['busstop', 'crossing', 'corner', 'schoolzone', 'sidewalk', 'hydrant', 'disabled', 'firelane', 'evcharge', 'none'],
    },
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
    ground: {
      type: 'OBJECT',
      properties: {
        wheels: { type: 'ARRAY', items: { type: 'OBJECT', properties: { wheel: { type: 'STRING' }, surface: { type: 'STRING', enum: ['roadway', 'crosswalk_stripe', 'sidewalk_block', 'curb', 'unclear'] } }, required: ['wheel', 'surface'] } },
        surface: { type: 'STRING', enum: ['roadway', 'crosswalk', 'sidewalk', 'both', 'unclear'] },
        crosswalkRelation: { type: 'STRING', enum: ['on', 'adjacent', 'apart', 'none', 'unclear'] },
        evidence: { type: 'STRING' },
      },
      required: ['wheels', 'surface', 'crosswalkRelation', 'evidence'],
    },
  },
  required: ['plate', 'scene', 'typeGuess', 'typeConfidence', 'evidence', 'boxes', 'ground'],
};

export const PROMPT = `너는 한국의 불법 주정차 신고 사진 한 장을 판독한다. 사진에 실제로 보이는 것만 답한다. 추측으로 채우지 않는다.

1. plate: 단속 대상 차량의 번호판.
   - 한국 번호판 형식(예: 12가3456, 123가4567, 서울12가3456)으로 공백 없이 적는다.
   - 한 글자라도 확실하지 않으면 readable=false, text는 빈 문자열. 틀린 번호는 엉뚱한 사람에게 과태료가 간다.
   - confidence는 0~1.
2. scene: 단속 대상 차가 서 있는 자리에 대해 yes/no/unclear. 보이지 않으면 unclear.
   - onCrosswalk·onSidewalk: 6번 ground 의 답과 같게 적는다(바퀴가 흰 줄·보도블록 위에 있을 때만 yes)
   - busStopVisible: 버스정류장 표지판·승강장이 차 바로 옆에 보인다
   - schoolZoneMarking: 어린이보호구역 표시(빨간 노면, '어린이보호구역' 표지·글씨)가 보인다
   - intersectionCorner: 차가 교차로 모퉁이(도로가 꺾이거나 만나는 곳)에 붙어 있다
   - fireHydrantNear: 소화전·소방용수시설 표시가 차 바로 옆에 보인다
   - disabledSpace: 차가 장애인전용주차구역 안에 있다(바닥·표지판의 휠체어 표시, 장애인 전용 구획)
   - disabledPermit: 그 차 앞유리에 장애인자동차표지(노란·파란 '주차가능' 표지)가 보인다. 앞유리가 안 보이면 unclear
   - fireLane: 차가 소방차 전용구역 안에 있다(빨간·노란 빗금 구획, '소방차 전용' 글씨)
   - evChargingSpace: 차가 친환경차 충전구역 안에 있다(충전기 바로 앞 구획, '충전구역'·'전기차 전용' 표시)
   - evVehicle: 그 차가 친환경차로 보인다(하늘색 번호판, 전기·수소차 표시). 번호판 색이 안 보이면 unclear
3. typeGuess: 가장 알맞은 위반 유형 하나. 해당 없으면 none.
   busstop=버스정류소, crossing=횡단보도, corner=교차로 모퉁이, schoolzone=어린이보호구역, sidewalk=인도, hydrant=소화전,
   disabled=장애인전용구역(표지 없는 차), firelane=소방차전용구역, evcharge=친환경차충전구역(친환경차가 아닌 차)
4. typeConfidence: 0~1. evidence: 그렇게 본 근거 한 문장(한국어).
5. boxes: 근거가 된 것의 위치. 번호판(plate), 단속 차량(vehicle), 그리고 scene 에서 yes 로 답한 것마다
   (crosswalk, sidewalk, busstop_sign, schoolzone_mark, corner, hydrant, disabled_mark, permit, firelane_mark, ev_charger) 상자 하나.
   box_2d 는 [ymin, xmin, ymax, xmax] 로, 사진 크기를 0~1000으로 본 정수.
6. ground: 단속 대상 차의 바퀴가 실제로 닿아 있는 바닥만 본다. 근처에 보이는 횡단보도·보도는 바퀴가 그 위에 있지 않으면 넣지 않는다.
   - wheels: 보이는 바퀴마다 하나만 — roadway(차도 아스팔트), crosswalk_stripe(횡단보도 흰 줄 위), sidewalk_block(보도블록·인도 포장 위), curb(연석에 걸침), unclear(안 보임).
   - surface: 차 전체로 하나만 — 한 바퀴라도 흰 줄 위면 crosswalk, 한 바퀴라도 보도블록·인도 위로 올라가 있으면 sidewalk, 둘 다면 both, 보이는 바퀴가 모두 차도면 roadway, 바퀴와 바닥이 안 보이면 unclear.
   - crosswalkRelation: on(차가 흰 줄 위), adjacent(바로 앞뒤에 붙어 있음), apart(떨어져 있음), none(횡단보도 없음), unclear. 실제 m 거리는 정하지 않는다.
   - evidence: 판단 근거 한 문장(한국어).`;

/** data URL 에서 base64 와 형식을 꺼낸다. 이미지가 아니면 null. */
export function parseDataUrl(s: unknown): { mime: string; data: string } | null {
  if (typeof s !== 'string') return null;
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(s);
  return m ? { mime: m[1], data: m[2] } : null;
}

const clamp01 = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
const tri = (v: unknown): Tri => (v === 'yes' || v === 'no' ? v : 'unclear');
const TYPES: PhotoType[] = [
  'busstop',
  'crossing',
  'corner',
  'schoolzone',
  'sidewalk',
  'hydrant',
  'disabled',
  'firelane',
  'evcharge',
  'none',
];
const SCENE_KEYS: (keyof Scene)[] = [
  'onCrosswalk',
  'onSidewalk',
  'busStopVisible',
  'schoolZoneMarking',
  'intersectionCorner',
  'fireHydrantNear',
  'disabledSpace',
  'disabledPermit',
  'fireLane',
  'evChargingSpace',
  'evVehicle',
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
  const ground = normalizeGround(r.ground);
  return {
    plate: { text, readable: Boolean(r.plate?.readable) && text.length > 0, confidence: clamp01(r.plate?.confidence) },
    scene: effectiveScene({ scene, ground }),
    ...(ground ? { ground } : {}),
    typeGuess: TYPES.includes(r.typeGuess) ? r.typeGuess : 'none',
    typeConfidence: clamp01(r.typeConfidence),
    evidence: typeof r.evidence === 'string' ? r.evidence.slice(0, 200) : '',
    boxes: Array.isArray(r.boxes) ? (r.boxes.map(normalizeBox).filter(Boolean) as Box[]) : [],
  };
}

const WHEEL_SURFACES: WheelSurface[] = ['roadway', 'crosswalk_stripe', 'sidewalk_block', 'curb', 'unclear'];
const GROUND_SURFACES: GroundSurface[] = ['roadway', 'crosswalk', 'sidewalk', 'both', 'unclear'];
const CROSSWALK_RELATIONS: CrosswalkRelation[] = ['on', 'adjacent', 'apart', 'none', 'unclear'];

/**
 * '바퀴가 닿은 바닥' 응답을 다듬는다. 바퀴별 답과 차 전체 답이 서로 맞지 않으면 전체 답을 'unclear'로 둔다
 * (예: 바퀴는 모두 차도인데 전체 답이 횡단보도). 바퀴 답이 없거나 연석·모름뿐이면 전체 답을 그대로 쓴다.
 */
export function normalizeGround(value: unknown): GroundRead | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const r = value as Record<string, any>;
  const wheels = (Array.isArray(r.wheels) ? r.wheels : []).slice(0, 8).flatMap((w: any) =>
    w && WHEEL_SURFACES.includes(w.surface) ? [{ wheel: typeof w.wheel === 'string' ? w.wheel.slice(0, 40) : '', surface: w.surface as WheelSurface }] : [],
  );
  let surface: GroundSurface = GROUND_SURFACES.includes(r.surface) ? r.surface : 'unclear';
  const cross = wheels.some((w: { surface: WheelSurface }) => w.surface === 'crosswalk_stripe');
  const side = wheels.some((w: { surface: WheelSurface }) => w.surface === 'sidewalk_block');
  const fromWheels: GroundSurface = cross && side ? 'both' : cross ? 'crosswalk' : side ? 'sidewalk'
    : wheels.length && wheels.every((w: { surface: WheelSurface }) => w.surface === 'roadway') ? 'roadway' : 'unclear';
  if (fromWheels !== 'unclear' && fromWheels !== surface) surface = 'unclear';
  return {
    surface,
    wheels,
    crosswalkRelation: CROSSWALK_RELATIONS.includes(r.crosswalkRelation) ? r.crosswalkRelation : 'unclear',
    evidence: typeof r.evidence === 'string' ? r.evidence.slice(0, 300) : '',
  };
}

/** 횡단보도·인도 '위' — 바닥 답으로만 정한다. 바닥 답이 없거나 모름이면 unclear. */
export function groundOn(type: 'crossing' | 'sidewalk', ground?: GroundRead): Tri {
  if (!ground || ground.surface === 'unclear') return 'unclear';
  return ground.surface === 'both' || ground.surface === (type === 'crossing' ? 'crosswalk' : 'sidewalk') ? 'yes' : 'no';
}

/**
 * 규칙이 쓰는 장면 — 횡단보도·인도 '위'를 바닥 답으로 바꾼다.
 * 바닥 답이 없는 이전 판독은 그 두 항목을 '모름'으로 본다(근처에 보이기만 해도 '예'라고 답한 적이 있어서).
 */
export function effectiveScene(read: { scene: Scene; ground?: GroundRead }): Scene {
  return { ...read.scene, onCrosswalk: groundOn('crossing', read.ground), onSidewalk: groundOn('sidewalk', read.ground) };
}

/** 횡단보도 바로 앞(바퀴는 횡단보도 밖)으로 읽힌 사진이 있는가 — 유형으로 정하지 않고 따로 알린다 */
export function crosswalkAdjacent(reads: readonly (PhotoRead | null | undefined)[]): boolean {
  const grounds = reads.flatMap((r) => (r?.ground ? [r.ground] : []));
  return grounds.some((g) => g.crosswalkRelation === 'adjacent') && !grounds.some((g) => groundOn('crossing', g) === 'yes');
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
  ['fireLane', 'firelane'],
  ['disabledSpace', 'disabled'],
  ['evChargingSpace', 'evcharge'],
  ['schoolZoneMarking', 'schoolzone'],
];

/**
 * 구역만으로는 위반이 아닌 유형 — 그 차가 '허용된 차'로 보이면 뺀다.
 * 장애인전용구역에 표지를 붙인 차, 충전구역에 친환경차는 '일반차 주차' 위반이 아니다.
 * (unclear 는 빼지 않는다 — 앱이 제출 전 점검에서 '확인 필요'로 묻는다)
 */
const EXEMPT_IF: Partial<Record<PhotoType, keyof Scene>> = {
  disabled: 'disabledPermit',
  evcharge: 'evVehicle',
};

export function typesFromScene(s: Scene): PhotoType[] {
  return SCENE_TO_TYPE.filter(([k, t]) => s[k] === 'yes' && !(EXEMPT_IF[t] && s[EXEMPT_IF[t]!] === 'yes')).map(
    ([, t]) => t,
  );
}

/** 사진 두 장(또는 한 장)의 판독을 하나로 — 번호판 대조, 장면 합치기, 규칙 유형 */
export function mergeReads(reads: (PhotoRead | null)[], model: string): VisionResult | null {
  const ok = reads.filter((r): r is PhotoRead => Boolean(r));
  if (ok.length === 0) return null;
  const [a, b] = reads;

  // 번호판 — 두 장 모두 형식과 확신도를 충족한 뒤 대조한다.
  // Vercel 함수의 단독 번들을 위해 rules.ts 기준을 여기서도 적용하며 회귀시험으로 일치를 확인한다.
  const trusted = (r: PhotoRead | null | undefined) => Boolean(
    r?.plate.readable && /^(?:[가-힣]{2})?\d{2,3}[가-힣]\d{4}$/.test(r.plate.text.replace(/\s/g, ''))
    && Number.isFinite(r.plate.confidence) && r.plate.confidence >= 0.8,
  );
  const readable = ok.filter((r) => r.plate.readable);
  const texts = readable.map((r) => r.plate.text.replace(/\s/g, ''));
  const agree = trusted(a) && trusted(b) ? a!.plate.text.replace(/\s/g, '') === b!.plate.text.replace(/\s/g, '') : null;
  const plate = {
    text: agree ? texts[0] : texts.length === 1 ? texts[0] : '',
    readable: readable.length > 0,
    confidence: readable.length ? Math.min(...readable.map((r) => r.plate.confidence)) : 0,
    agree,
    reads: texts,
  };
  const sameVehicle: Tri = agree === true ? 'yes' : agree === false ? 'no' : 'unclear';

  // 이전에 저장된 판독(바닥 답 없음)도 같은 규칙으로 읽는다
  const [sa, sb] = [a && effectiveScene(a), b && effectiveScene(b)];
  const scene = Object.fromEntries(SCENE_KEYS.map((k) => [k, mergeTri(sa?.[k], sb?.[k])])) as unknown as Scene;
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
    ...(crosswalkAdjacent(reads) ? { crosswalkAdjacent: true } : {}),
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
  // 한도 초과(429)면 예비 모델로 넘긴다 — 무료 등급은 모델마다 한도를 따로 센다. 모두 막히면 그때 한도 초과로 알린다.
  let limited = false;
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
    if (res.status === 429) {
      limited = true;
      continue;
    }
    if (!res.ok) return limited ? 'rate_limited' : 'upstream';
    const j = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    try {
      const read = normalizeRead(JSON.parse(text));
      return read ? { read, model } : 'upstream';
    } catch {
      return 'upstream';
    }
  }
  return limited ? 'rate_limited' : 'busy';
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
