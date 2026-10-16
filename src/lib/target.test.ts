import { afterEach, describe, expect, it, vi } from 'vitest';
import { linkTargets, mergeReads, normalizeRead, POST, RESPONSE_SCHEMA } from '../../api/vision';
import type { PhotoRead } from '../../api/vision';
import { isValidPlate, PLATE_CONFIDENCE_FLOOR } from './rules';
import { linkByPlate, normalizeVehicles, selectTarget, TARGET_RULE, targetNote, trustedPlate } from './target';
import { compatibleVisionResult } from './vision';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

// 상자 값은 2026-10-16 실사진 판독(gemini 3.6·3.8-flash)이 적은 차량 목록 그대로다. 번호는 가짜.
type Raw = { box_2d: number[]; kind: string; motion: string; cutOff: string; occluded: string; plate: { readable: boolean; text?: string; confidence: number; box_2d: number[] } };
const car = (box_2d: number[], kind: string, motion: string, cutOff: string, occluded: string, plate?: [string, number, number[]]): Raw =>
  ({ box_2d, kind, motion, cutOff, occluded, plate: plate ? { readable: true, text: plate[0], confidence: plate[1], box_2d: plate[2] } : { readable: false, text: '', confidence: 0, box_2d: [] } });
const pick = (raws: Raw[], model?: Parameters<typeof selectTarget>[1]) => selectTarget(normalizeVehicles(raws), model);

const P1 = '12가3456', P2 = '34나5678';
const SCENES = {
  // 흰 탑차 가운데(뒷모습) + 왼쪽에 잘린 로젠 트럭 + 지나가는 택시·버스
  centerTruck: [
    car([322, 260, 634, 680], 'truck', 'parked', 'none', 'partial', [P1, 0.95, [569, 359, 584, 439]]),
    car([347, 0, 755, 313], 'truck', 'parked', 'partial', 'none'),
    car([389, 655, 461, 775], 'car', 'moving', 'none', 'none'),
    car([328, 4, 442, 269], 'bus', 'moving', 'partial', 'partial'),
    car([330, 804, 412, 999], 'bus', 'moving', 'partial', 'partial'),
  ],
  // 운전자가 탄 오토바이가 앞을 지나가고 뒤에 포터
  passingMotorcycle: [
    car([516, 2, 848, 680], 'truck', 'parked', 'partial', 'partial', [P1, 0.95, [737, 467, 759, 567]]),
    car([595, 0, 1000, 521], 'motorcycle', 'moving', 'partial', 'none'),
  ],
  // 실사진을 잘라 만든 애매한 구도: 왼쪽 큰 로젠 트럭(번호판 안 보임) + 오른쪽 탑차(번호판 보임)
  truckAndTruck: [
    car([246, 478, 683, 1000], 'truck', 'parked', 'partial', 'none', [P1, 0.96, [598, 650, 626, 801]]),
    car([292, 0, 854, 561], 'truck', 'parked', 'partial', 'none'),
    car([250, 0, 417, 484], 'bus', 'unclear', 'partial', 'partial'),
  ],
  // 애매한 구도: 큰 버스(번호판 안 보임, AI는 '움직이는 중'으로 적음) + 로젠 트럭 뒷부분(번호판 보임)
  busAndTruck: [
    car([126, 0, 622, 728], 'bus', 'moving', 'partial', 'partial'),
    car([235, 548, 665, 1000], 'truck', 'parked', 'partial', 'none', [P1, 0.95, [587, 713, 616, 859]]),
  ],
};

describe('대상 차 고르기 — 실사진 구도', () => {
  it('가운데 크게 찍힌 차를 대상으로 정하고 그 차 번호판만 인정한다', () => {
    const p = pick(SCENES.centerTruck);
    expect(p).toMatchObject({ status: 'clear', reason: 'framing', plateOk: true, box: [322, 260, 634, 680] });
    expect(p.ratio).toBeLessThan(TARGET_RULE.ambiguousRatio);
  });

  it('운전자가 탄 채 지나가는 이륜차는 앞에 크게 찍혀도 대상이 아니다', () => {
    expect(pick(SCENES.passingMotorcycle)).toMatchObject({ status: 'clear', reason: 'single', plateOk: true, box: [516, 2, 848, 680] });
  });

  it('비슷한 차 두 대(번호판은 한쪽만 보임) — 번호판이 보이는 쪽으로 정하지 않고 애매함으로 둔다', () => {
    const p = pick(SCENES.truckAndTruck);
    expect(p).toMatchObject({ status: 'ambiguous', reason: 'close_scores', plateOk: false });
    expect(p.candidates.length).toBeGreaterThanOrEqual(2);
  });

  it("AI가 '움직이는 중'이라 적은 버스도 빼지 않는다 — 점수가 기준(0.7) 이상 가까우면 애매함", () => {
    const p = pick(SCENES.busAndTruck);
    expect(p.ratio).toBeGreaterThanOrEqual(0.7);
    expect(p.ratio).toBeLessThan(0.75); // 시험값(0.75) 기준이었다면 묻지 않았을 구도
    expect(p).toMatchObject({ status: 'ambiguous', reason: 'close_scores', plateOk: false });
  });
});

describe('대상 차 고르기 — 질문 조건', () => {
  const center = (plate?: [string, number, number[]]) => car([300, 250, 800, 750], 'car', 'parked', 'none', 'none', plate);
  const side = (plate?: [string, number, number[]]) => car([450, 820, 600, 990], 'car', 'parked', 'partial', 'none', plate);

  it('번호판이 확실히 읽히는 후보가 두 대 이상이면 구도가 분명해도 묻는다', () => {
    const p = pick([center([P1, 0.95, [700, 450, 730, 550]]), side([P2, 0.9, [560, 880, 580, 940]])]);
    expect(p.ratio).toBeLessThan(TARGET_RULE.ambiguousRatio);
    expect(p).toMatchObject({ status: 'ambiguous', reason: 'multiple_plates' });
  });

  it('고른 차 번호판은 안 보이고 다른 차 번호판만 보이면, 그 번호로 채우지 않고 묻는다', () => {
    expect(pick([center(), side([P2, 0.9, [560, 880, 580, 940]])])).toMatchObject({ status: 'ambiguous', reason: 'other_plate_only', plateOk: false });
  });

  it('고른 차 번호판이 보이지만 확신이 낮으면 묻지 않는다(기존 확신도 안내로 간다)', () => {
    expect(pick([center([P1, 0.6, [700, 450, 730, 550]]), side([P2, 0.9, [560, 880, 580, 940]])])).toMatchObject({ status: 'clear', plateOk: false });
  });

  it('AI가 스스로 고른 차와 규칙이 고른 차가 다르면 애매함 — 상자로도, 번호로도', () => {
    const raws = [center([P1, 0.95, [700, 450, 730, 550]]), side()];
    expect(pick(raws, { vehicleBox: [450, 820, 600, 990] })).toMatchObject({ status: 'ambiguous', reason: 'model_mismatch' });
    expect(pick(raws, { plate: { text: P2, readable: true, confidence: 0.95 } })).toMatchObject({ status: 'ambiguous', reason: 'model_mismatch', modelPlate: P2 });
    expect(pick(raws, { vehicleBox: [310, 260, 790, 740], plate: { text: P1, readable: true, confidence: 0.95 } })).toMatchObject({ status: 'clear', plateOk: true });
  });

  it('번호판 상자가 그 차 상자 밖이면 그 차 번호로 인정하지 않는다', () => {
    expect(pick([center([P1, 0.95, [100, 900, 130, 990]])])).toMatchObject({ status: 'clear', plateOk: false });
  });

  it('멀리 작게 보이는 차만 있으면 대상 없음', () => {
    expect(pick([car([100, 100, 150, 150], 'car', 'parked', 'none', 'none')])).toMatchObject({ status: 'none', reason: 'no_vehicle' });
    expect(selectTarget([])).toMatchObject({ status: 'none' });
  });

  it('기준값 — 애매함 0.7(사용자 결정), 번호판 확신 기준은 rules.ts 와 같다', () => {
    expect(TARGET_RULE.ambiguousRatio).toBe(0.7);
    expect(TARGET_RULE.plateFloor).toBe(PLATE_CONFIDENCE_FLOOR);
    for (const text of ['12가3456', '123가4567', '서울12가3456', '12가345', '가3456', 'A12가3456']) {
      expect(trustedPlate({ text, readable: true, confidence: 0.9 })).toBe(isValidPlate(text));
    }
    expect(trustedPlate({ text: P1, readable: true, confidence: 0.79 })).toBe(false);
  });

  it('형식을 어긴 목록 항목은 버리고 빠진 값은 보수적으로 채운다', () => {
    const v = normalizeVehicles([{ box_2d: [10, 10, 5, 5] }, { box_2d: [100, 100, 600, 600], kind: 'tank', plate: { readable: true, text: '  ', confidence: 2 } }, 'x']);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ kind: 'other', motion: 'unclear', cutOff: 'partial', occluded: 'partial', plate: { readable: false, confidence: 1 } });
    expect(normalizeVehicles(undefined)).toEqual([]);
  });

  it('안내 문구는 이유별로 다르다', () => {
    expect(targetNote(pick(SCENES.centerTruck))).toBeUndefined();
    expect(targetNote(pick(SCENES.truckAndTruck))).toBe('차가 여러 대라 신고할 차를 정하지 못함');
    expect(targetNote(pick([center(), side([P2, 0.9, [560, 880, 580, 940]])]))).toBe('가운데 차의 번호판은 안 보이고 다른 차 번호판만 보임');
    expect(targetNote(selectTarget([]))).toBe('사진에서 신고할 차를 찾지 못함');
  });
});

describe('다른 사진에서 확정한 번호로 잇기', () => {
  it('후보 안에 같은 번호판을 단 차가 있을 때만 잇는다', () => {
    const vehicles = normalizeVehicles(SCENES.truckAndTruck);
    const p = selectTarget(vehicles);
    expect(linkByPlate(vehicles, p, P1)?.pick).toMatchObject({ status: 'clear', reason: 'linked', plateOk: true, box: [246, 478, 683, 1000] });
    expect(linkByPlate(vehicles, p, P2)).toBeNull();
    expect(linkByPlate(vehicles, { ...p, modelPlate: P2 }, P1)).toBeNull(); // AI가 이 사진에서 다른 번호를 읽었으면 잇지 않는다
  });
});

// ── 판독 서버(normalizeRead·mergeReads·POST)와 앱
const modelOutput = (vehicles?: Raw[], plate = { text: '', readable: false, confidence: 0 }, boxes: unknown[] = []) => ({
  plate, scene: {}, typeGuess: 'none', typeConfidence: 0, evidence: '합성', boxes, observations: [], detailRequests: [],
  ground: { surface: 'roadway', wheels: [], crosswalkRelation: 'none', evidence: '' }, ...(vehicles ? { vehicles } : {}),
});
const read = (id: string, vehicles?: Raw[], plate?: { text: string; readable: boolean; confidence: number }) =>
  normalizeRead(modelOutput(vehicles, plate), { photoId: id, inputVersion: '1', modern: true })!;

describe('판독 서버 — 번호판 안전장치', () => {
  it('대상이 애매하면 AI가 읽은 번호가 있어도 비운다', () => {
    const r = read('a', SCENES.truckAndTruck, { text: P1, readable: true, confidence: 0.98 });
    expect(r.plate).toEqual({ text: '', readable: false, confidence: 0 });
    expect(r.target).toMatchObject({ status: 'ambiguous', modelPlate: P1 });
    expect(r.vehicles).toHaveLength(3);
  });

  it('대상이 분명하면 그 차 상자 안의 번호판을 쓴다', () => {
    expect(read('a', SCENES.centerTruck, { text: P1, readable: true, confidence: 0.97 }).plate).toEqual({ text: P1, readable: true, confidence: 0.95 });
  });

  it('고른 차 번호판의 확신이 낮으면 그대로 넘겨 확신도 안내를 받게 한다(채우지는 않는다)', () => {
    const r = read('a', [car([300, 250, 800, 750], 'car', 'parked', 'none', 'none', [P1, 0.5, [700, 450, 730, 550]])]);
    expect(r.plate).toEqual({ text: P1, readable: true, confidence: 0.5 });
    expect(mergeReads([r, r], 'm')!.plate.agree).toBeNull();
  });

  it('차량 목록이 없는 이전 판독·빈 목록은 지금처럼 둔다', () => {
    for (const r of [read('a', undefined, { text: P1, readable: true, confidence: 0.9 }), read('a', [], { text: P1, readable: true, confidence: 0.9 })]) {
      expect(r.plate.text).toBe(P1);
      expect(r.target).toBeUndefined();
    }
  });

  it('두 장 — 한 장이 애매해도 다른 장에서 확정한 번호의 차가 후보에 있으면 잇고 일치로 본다', () => {
    const merged = mergeReads([read('a', SCENES.centerTruck), read('b', SCENES.truckAndTruck)], 'm')!;
    expect(merged.plate).toMatchObject({ text: P1, agree: true });
    expect(merged.sameVehicle).toBe('yes');
    expect(merged.photos[1]!.target).toMatchObject({ status: 'clear', reason: 'linked' });
    expect(merged.photos[1]!.plate.text).toBe(P1);
  });

  it('두 장 — 애매한 장에 같은 번호의 차가 없으면 채우지 않는다', () => {
    const other = SCENES.truckAndTruck.map((v) => (v.plate.readable ? { ...v, plate: { ...v.plate, text: P2 } } : v));
    const merged = mergeReads([read('a', SCENES.centerTruck), read('b', other)], 'm')!;
    expect(merged.plate.agree).toBeNull();
    expect(merged.photos[1]!.target?.status).toBe('ambiguous');
  });

  it('두 장 — 둘 다 애매하면 번호를 채우지 않는다(지금 앱은 이 경우 한쪽 차 번호를 두 장 모두 같게 채웠다)', () => {
    const merged = mergeReads([read('a', SCENES.truckAndTruck, { text: P1, readable: true, confidence: 0.98 }), read('b', SCENES.truckAndTruck, { text: P1, readable: true, confidence: 0.98 })], 'm')!;
    expect(merged.plate).toMatchObject({ text: '', agree: null });
  });

  it('같은 사진을 두 번 넣으면 잇지 않는다', () => {
    const reads = [read('a', SCENES.centerTruck), read('a', SCENES.truckAndTruck)];
    expect(linkTargets(reads)[1]!.target?.status).toBe('ambiguous');
  });

  it('응답 형식에 차량 목록이 필수다', () => {
    expect(RESPONSE_SCHEMA.required).toContain('vehicles');
  });

  it('서버 응답과 앱 — 애매한 사진은 번호 없이 돌려주고, 앱도 대상 정보를 그대로 받는다', async () => {
    vi.stubEnv('VISION_API_KEY', 'synthetic-test-key'); vi.stubEnv('VISION_PROVIDER', 'gemini');
    const body = modelOutput(SCENES.truckAndTruck, { text: P1, readable: true, confidence: 0.98 }, [{ label: 'vehicle', box_2d: [246, 478, 683, 1000] }, { label: 'plate', box_2d: [598, 650, 626, 801] }]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(body) }] } }] }))));
    const response = await POST(new Request('http://x/api/vision', { method: 'POST', body: JSON.stringify({ images: ['data:image/jpeg;base64,AAAA'], photoIds: ['a'], inputVersion: '1' }) }));
    const json = await response.json();
    expect(json.photos[0].plate.readable).toBe(false);
    expect(json.photos[0].target.status).toBe('ambiguous');
    const app = compatibleVisionResult(json, 1, { photoIds: ['a'], inputVersion: '1' })!;
    expect(app.photos[0]!.target?.reason).toBe('close_scores');
    expect(app.photos[0]!.vehicles).toHaveLength(3);
  });
});

// PhotoRead 타입이 대상 정보를 담는지(컴파일 확인)
export const _typeCheck = (r: PhotoRead) => r.target?.candidates.length;
