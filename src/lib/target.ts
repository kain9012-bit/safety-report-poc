/**
 * 여러 대가 찍힌 사진에서 신고 대상 차 정하기.
 *
 * AI는 보이는 차를 모두 적기만 하고(차마다 상자·잘림·가림·그 차의 번호판), 대상은 이 규칙이 정한다.
 * 같은 목록이면 늘 같은 답이 나와 시험할 수 있다.
 *
 *  - 촬영 구도로 고른다: 사진 가운데 가까이, 크게, 잘리지 않게 찍힌 차.
 *  - 번호판이 읽히는지·위반처럼 보이는지는 점수에 넣지 않는다. 넣으면 '번호가 보이는 차'로 대상이 끌려간다.
 *  - 비슷한 후보가 있거나, 번호판이 확실한 차가 둘 이상이거나, 대상의 번호판은 안 보이는데 다른 차 번호판만 보이면
 *    '애매함'으로 두고 번호를 채우지 않는다. 다른 차 번호로 바꿔 채우지 않는다.
 *
 * 2026-10-16 실사진 시험(outputs/target_vehicle_rule_test_20261016): AI 판독만으로는 애매한 구도 9번 모두
 * 번호판이 보이는 쪽 차로 정했다. 이 규칙은 같은 사진에서 틀린 차 번호를 한 번도 채우지 않았다.
 * Vercel 함수 단독 번들에서도 쓰므로 다른 모듈을 가져오지 않는다(번호판 형식은 rules.ts 와 같게, 시험으로 맞춘다).
 */

/** [위, 왼쪽, 아래, 오른쪽], 사진 크기를 0~1000으로 본 값 */
export type Box4 = [number, number, number, number];
export type VehicleKind = 'car' | 'truck' | 'bus' | 'motorcycle' | 'other';
export type Degree = 'none' | 'partial' | 'most';

/** AI가 적은 차 한 대 */
export interface VehicleRead {
  box: Box4;
  kind: VehicleKind;
  /** 사진 한 장으로는 믿기 어렵다 — 운전자가 탄 채 움직이는 이륜차를 빼는 데만 쓴다 */
  motion: 'parked' | 'moving' | 'unclear';
  /** 사진 테두리에 잘린 정도 */
  cutOff: Degree;
  /** 다른 차·사람·물체에 가려진 정도 */
  occluded: Degree;
  /** 그 차 차체에 붙은 번호판만 */
  plate: { text: string; readable: boolean; confidence: number; box?: Box4 };
  /** 사람이 알아볼 짧은 설명(색·차종·위치) */
  note?: string;
}

/**
 * single: 후보가 한 대 · framing: 구도로 분명 · linked: 다른 사진에서 확정한 번호로 이음
 * close_scores: 1·2위 점수가 비슷 · multiple_plates: 번호판이 확실한 후보가 둘 이상
 * other_plate_only: 고른 차는 번호판이 안 보이는데 다른 차 번호판은 보임
 * model_mismatch: AI가 스스로 고른 차(번호판·차량 상자)와 규칙이 고른 차가 다름 · no_vehicle: 후보 없음
 */
export type TargetReason = 'single' | 'framing' | 'linked' | 'close_scores' | 'multiple_plates' | 'other_plate_only' | 'model_mismatch' | 'no_vehicle';

export interface TargetPick {
  status: 'clear' | 'ambiguous' | 'none';
  reason: TargetReason;
  /** 2위 점수 ÷ 1위 점수(후보가 한 대면 0) */
  ratio: number;
  /** 분명하면 대상, 애매하면 1위 후보 */
  box?: Box4;
  /** 물어볼 때 띄울 후보(점수 순, 최대 3) */
  candidates: { box: Box4; score: number; note?: string }[];
  /** 대상 차 번호판을 채워도 되는가 — 분명함 + 그 차 상자 안의 번호판 + 신뢰 기준 */
  plateOk: boolean;
  /** AI가 스스로 고른 차에서 확실히 읽은 번호(있을 때만). 다른 사진과 이을 때 어긋남을 막는 데 쓴다 */
  modelPlate?: string;
}

export const TARGET_RULE = {
  /** 사진 넓이의 1.5% 미만(멀리 작게 보이는 차)은 후보에서 뺀다 */
  minArea: 0.015,
  /** 2위 점수가 1위의 70% 이상이면 애매함(사용자 결정 2026-10-16: 시험값 0.75보다 조금 더 자주 묻는다) */
  ambiguousRatio: 0.7,
  cut: { none: 1, partial: 0.7, most: 0.4 } as Record<Degree, number>,
  occ: { none: 1, partial: 0.85, most: 0.6 } as Record<Degree, number>,
  /** AI가 고른 차의 상자와 이만큼 겹치지 않으면 다른 차로 본다 */
  sameBoxIou: 0.5,
  /** rules.ts PLATE_CONFIDENCE_FLOOR 와 같다 */
  plateFloor: 0.8,
};

const PLATE_RE = /^(?:[가-힣]{2})?\d{2,3}[가-힣]\d{4}$/;
const KINDS: VehicleKind[] = ['car', 'truck', 'bus', 'motorcycle', 'other'];
const DEGREES: Degree[] = ['none', 'partial', 'most'];
const clean = (t: unknown) => (typeof t === 'string' ? t.replace(/\s/g, '') : '');
const clamp01 = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

export function toBox(v: unknown): Box4 | null {
  if (!Array.isArray(v) || v.length !== 4) return null;
  const n = v.map((x) => Math.round(Math.min(1000, Math.max(0, Number(x)))));
  if (n.some((x) => !Number.isFinite(x)) || n[2] <= n[0] || n[3] <= n[1]) return null;
  return n as Box4;
}

/** AI 출력의 차량 목록을 다듬는다. 형식을 어긴 항목은 버린다. */
export function normalizeVehicles(raw: unknown): VehicleRead[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 12).flatMap((item): VehicleRead[] => {
    const r = item as Record<string, any>;
    const box = toBox(r?.box_2d ?? r?.box);
    if (!box) return [];
    const text = clean(r.plate?.text);
    const plateBox = toBox(r.plate?.box_2d ?? r.plate?.box);
    return [{
      box,
      kind: KINDS.includes(r.kind) ? r.kind : 'other',
      motion: r.motion === 'parked' || r.motion === 'moving' ? r.motion : 'unclear',
      cutOff: DEGREES.includes(r.cutOff) ? r.cutOff : 'partial',
      occluded: DEGREES.includes(r.occluded) ? r.occluded : 'partial',
      plate: { text, readable: r.plate?.readable === true && text.length > 0, confidence: clamp01(r.plate?.confidence), ...(plateBox ? { box: plateBox } : {}) },
      ...(typeof r.note === 'string' && r.note ? { note: r.note.slice(0, 80) } : {}),
    }];
  });
}

export function trustedPlate(p?: { text: string; readable: boolean; confidence: number }): boolean {
  return Boolean(p?.readable) && PLATE_RE.test(clean(p?.text)) && Number.isFinite(p?.confidence) && p!.confidence >= TARGET_RULE.plateFloor;
}

const area = (b: Box4) => ((b[2] - b[0]) * (b[3] - b[1])) / 1e6;

export function iou(a: Box4, b: Box4): number {
  const h = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])), w = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const inter = h * w, union = area(a) * 1e6 + area(b) * 1e6 - inter;
  return union > 0 ? inter / union : 0;
}

/** 번호판 상자의 가운데가 차 상자 안(가장자리 3% 여유)에 있어야 그 차의 번호판으로 인정한다 */
export function plateInside(v: VehicleRead): boolean {
  const p = v.plate.box;
  if (!p) return false;
  const cy = (p[0] + p[2]) / 2, cx = (p[1] + p[3]) / 2, b = v.box;
  return cy >= b[0] - 30 && cy <= b[2] + 30 && cx >= b[1] - 30 && cx <= b[3] + 30;
}

/** 가운데에 가까울수록 1. 가로 위치를 세로보다 무겁게 본다(차는 보통 사진 아래쪽에 찍힌다). */
export function centrality(b: Box4): number {
  const dx = ((b[1] + b[3]) / 2 - 500) / 500, dy = ((b[0] + b[2]) / 2 - 500) / 500;
  return 1 - Math.sqrt(dx * dx + 0.25 * dy * dy) / Math.sqrt(1.25);
}

const boundPlate = (v: VehicleRead) => trustedPlate(v.plate) && plateInside(v);
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * 한 장에서 대상 차 고르기.
 * model: AI가 스스로 고른 대상(응답의 vehicle 상자·번호판). 규칙이 고른 차와 다르면 애매함으로 둔다
 * — 같은 응답의 장면·바닥 답은 AI가 고른 차 기준이라, 번호판만 다른 차로 바꾸면 서로 어긋난다.
 */
export function selectTarget(vehicles: VehicleRead[], model: { vehicleBox?: Box4; plate?: { text: string; readable: boolean; confidence: number } } = {}): TargetPick {
  // 운전자가 탄 채 움직이는 이륜차만 뺀다. AI는 서 있는 트럭도 '움직이는 중'으로 자주 적었다.
  const cands = vehicles.filter((v) => !(v.kind === 'motorcycle' && v.motion === 'moving') && area(v.box) >= TARGET_RULE.minArea);
  if (cands.length === 0) return { status: 'none', reason: 'no_vehicle', ratio: 0, candidates: [], plateOk: false };
  const maxA = Math.max(...cands.map((v) => area(v.box)));
  const scored = cands
    .map((v) => ({ v, score: (0.5 * (area(v.box) / maxA) + 0.5 * centrality(v.box)) * TARGET_RULE.cut[v.cutOff] * TARGET_RULE.occ[v.occluded] }))
    .sort((a, b) => b.score - a.score);
  const [top, second] = scored;
  const ratio = second && top.score > 0 ? second.score / top.score : 0;
  const candidates = scored.slice(0, 3).map((s) => ({ box: s.v.box, score: round2(s.score), ...(s.v.note ? { note: s.v.note } : {}) }));
  const modelPlate = trustedPlate(model.plate) ? clean(model.plate!.text) : '';
  const base = { ratio: round2(ratio), box: top.v.box, candidates, ...(modelPlate ? { modelPlate } : {}) };

  const ambiguous = (reason: TargetReason): TargetPick => ({ status: 'ambiguous', reason, ...base, plateOk: false });
  if (second && ratio >= TARGET_RULE.ambiguousRatio) return ambiguous('close_scores');
  if (cands.filter(boundPlate).length >= 2) return ambiguous('multiple_plates');
  // 고른 차의 번호판이 보이지만 확신이 낮은 경우는 여기서 묻지 않는다 — 기존 '확신도 미만' 안내로 간다
  if (!top.v.plate.readable && cands.some((v) => v !== top.v && boundPlate(v))) return ambiguous('other_plate_only');
  const differentBox = model.vehicleBox && iou(model.vehicleBox, top.v.box) < TARGET_RULE.sameBoxIou;
  const differentPlate = modelPlate && trustedPlate(top.v.plate) && clean(top.v.plate.text) !== modelPlate;
  if (differentBox || differentPlate) return ambiguous('model_mismatch');
  return { status: 'clear', reason: second ? 'framing' : 'single', ...base, plateOk: boundPlate(top.v) };
}

/**
 * 다른 사진에서 확정한 번호로 애매한 사진의 대상을 잇는다.
 * 그 번호판을 단 차가 이 사진의 후보(점수 상위)에 있을 때만 잇는다.
 */
export function linkByPlate(vehicles: VehicleRead[], pick: TargetPick, plateText: string): { pick: TargetPick; vehicle: VehicleRead } | null {
  if (pick.status !== 'ambiguous' || !plateText) return null;
  // AI가 이 사진에서 스스로 고른 차의 번호가 다르면 잇지 않는다(장면·바닥 답이 그 차 기준이다)
  if (pick.modelPlate && pick.modelPlate !== plateText) return null;
  const hit = vehicles.find((v) => boundPlate(v) && clean(v.plate.text) === plateText && pick.candidates.some((c) => c.box.join(',') === v.box.join(',')));
  return hit ? { pick: { ...pick, status: 'clear', reason: 'linked', box: hit.box, plateOk: true }, vehicle: hit } : null;
}

/** 첫 사진 확인 화면의 다시 찍기 안내 — 대상이 애매할 때만. iPhone(PlateStatus)도 같은 말을 쓴다 */
export function targetRetake(pick?: TargetPick | null): { title: string; fix: string } | undefined {
  if (pick?.status !== 'ambiguous') return undefined;
  const fix = pick.reason === 'other_plate_only'
    ? '가운데 차의 번호판은 안 보이고 다른 차 번호판만 보입니다. 신고할 차의 번호판이 보이게 다시 찍어 주세요'
    : pick.reason === 'multiple_plates'
      ? '번호판이 보이는 차가 여러 대입니다. 신고할 차가 사진 가운데에 크게 나오게 다시 찍어 주세요'
      : '차가 여러 대 찍혔습니다. 신고할 차가 사진 가운데에 크게, 번호판까지 보이게 다시 찍어 주세요';
  return { title: '신고할 차를 정하지 못했습니다', fix };
}

/** 화면 안내 — 대상을 정하지 못한 이유(신고자에게 보이는 말) */
export function targetNote(pick?: TargetPick | null): string | undefined {
  if (!pick || pick.status === 'clear') return undefined;
  if (pick.status === 'none') return '사진에서 신고할 차를 찾지 못함';
  return pick.reason === 'multiple_plates'
    ? '번호판이 보이는 차가 여러 대라 신고할 차를 정하지 못함'
    : pick.reason === 'other_plate_only'
      ? '가운데 차의 번호판은 안 보이고 다른 차 번호판만 보임'
      : '차가 여러 대라 신고할 차를 정하지 못함';
}
