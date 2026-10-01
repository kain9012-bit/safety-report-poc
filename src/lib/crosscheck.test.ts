import { describe, expect, it } from 'vitest';
import { crosscheck } from './crosscheck';
import { scaledSize } from './vision';
import { DISAGREE_CONFIDENCE, mergeReads, mergeTri, normalizeRead, parseDataUrl, typesFromScene } from '../../api/vision';
import type { Candidate } from './recommend';
import type { PhotoRead, PhotoType, Scene, VisionResult } from '../../api/vision';

const bus: Candidate = { type: 'busstop', level: 'likely', distance: 3, name: 'A', reason: 'A까지 약 3m' };
const school: Candidate = { type: 'schoolzone', level: 'possible', distance: 180, reason: '초교 180m' };

const FLAG: Partial<Record<PhotoType, keyof Scene>> = {
  crossing: 'onCrosswalk',
  sidewalk: 'onSidewalk',
  hydrant: 'fireHydrantNear',
  busstop: 'busStopVisible',
  corner: 'intersectionCorner',
  schoolzone: 'schoolZoneMarking',
};

/** 사진 한 장 판독 — 유형에 맞는 장면 항목을 yes 로 */
const read = (type: PhotoType, opts: { plate?: string; conf?: number; guess?: PhotoType } = {}): PhotoRead =>
  normalizeRead({
    plate: { text: opts.plate ?? '12가3456', readable: opts.plate !== '', confidence: 0.95 },
    scene: FLAG[type] ? { [FLAG[type]!]: 'yes' } : {},
    typeGuess: opts.guess ?? type,
    typeConfidence: opts.conf ?? 0.9,
    evidence: '근거',
    boxes: [],
  })!;

const photo = (type: PhotoType, conf = 0.9): VisionResult => mergeReads([read(type, { conf }), read(type, { conf })], 'test')!;

describe('교차검증', () => {
  it('사진 유형이 좌표 후보에 있으면 교차검증', () => {
    const v = crosscheck([bus, school], { busstop: true, schoolzone: true }, photo('busstop'));
    expect(v).toMatchObject({ type: 'busstop', source: 'verified', alternatives: ['schoolzone'] });
    expect(v.coordReason).toContain('3m');
    expect(v.photoReason).toBe('근거');
  });

  it('좌표 자료가 없는 유형(교차로 모퉁이)은 사진 판독으로', () => {
    const v = crosscheck([school], { schoolzone: true }, photo('corner'));
    expect(v).toMatchObject({ type: 'corner', source: 'photo', alternatives: ['schoolzone'] });
  });

  it('횡단보도 자료가 없는 지역(전주)에서 사진이 횡단보도라 하면 사진 판독으로 — 엇갈림이 아니다', () => {
    const v = crosscheck([school], { busstop: true, crossing: false, schoolzone: true }, photo('crossing'));
    expect(v.source).toBe('photo');
  });

  it('좌표 자료가 있는데 근처에 없으면 엇갈림', () => {
    const v = crosscheck([school], { busstop: true, schoolzone: true }, photo('busstop'));
    expect(v).toMatchObject({ type: 'busstop', source: 'conflict' });
  });

  it('사진이 확신 못 하면 좌표 추천 그대로', () => {
    expect(crosscheck([bus], { busstop: true }, photo('crossing', 0.3))).toMatchObject({ type: 'busstop', source: 'likely' });
    expect(crosscheck([school], { schoolzone: true }, photo('none'))).toMatchObject({ type: 'schoolzone', source: 'possible' });
    expect(crosscheck([bus], { busstop: true }, null)).toMatchObject({ type: 'busstop', source: 'likely' });
  });

  it('둘 다 없으면 비워 둔다', () => {
    expect(crosscheck([], {}, photo('none'))).toEqual({ source: 'none', alternatives: [] });
  });
});

describe('번호판 — 두 장 따로 읽어 대조', () => {
  it('두 장이 같으면 확정', () => {
    const r = mergeReads([read('none'), read('none')], 'm')!;
    expect(r.plate).toMatchObject({ text: '12가3456', agree: true });
    expect(r.sameVehicle).toBe('yes');
  });
  it('두 장이 다르면 비우고 둘 다 보여준다 — 다른 차일 수 있다', () => {
    const r = mergeReads([read('none'), read('none', { plate: '12가3458' })], 'm')!;
    expect(r.plate).toMatchObject({ text: '', agree: false, reads: ['12가3456', '12가3458'] });
    expect(r.sameVehicle).toBe('no');
  });
  it('한 장만 읽히면 확정하지 않는다', () => {
    const r = mergeReads([read('none'), read('none', { plate: '' })], 'm')!;
    expect(r.plate.agree).toBeNull();
    expect(r.plate.reads).toEqual(['12가3456']);
  });
  it('한 장 판독이 실패해도 나머지로 결과를 낸다', () => {
    const r = mergeReads([read('crossing'), null], 'm')!;
    expect(r.typeGuess).toBe('crossing');
    expect(r.plate.agree).toBeNull();
  });
  it('둘 다 실패면 결과 없음', () => {
    expect(mergeReads([null, null], 'm')).toBeNull();
  });
});

describe('유형은 장면 항목에서 규칙으로', () => {
  it('항목 우선순위: 횡단보도·인도 → 소화전·정류장·모퉁이 → 보호구역', () => {
    const s = normalizeRead({ scene: { schoolZoneMarking: 'yes', busStopVisible: 'yes', onCrosswalk: 'yes' } })!.scene;
    expect(typesFromScene(s)).toEqual(['crossing', 'busstop', 'schoolzone']);
  });
  it('두 장이 엇갈리면(보임/아님) 모름', () => {
    expect(mergeTri('yes', 'no')).toBe('unclear');
    expect(mergeTri('yes', 'unclear')).toBe('yes');
    expect(mergeTri(undefined, 'no')).toBe('no');
  });
  it('AI가 낸 유형이 규칙과 다르면 확신을 낮춘다 → 교차검증에서 사진 판단을 믿지 않음', () => {
    const r = mergeReads([read('busstop', { guess: 'crossing' }), read('busstop', { guess: 'crossing' })], 'm')!;
    expect(r.typeGuess).toBe('busstop');
    expect(r.modelAgrees).toBe(false);
    expect(r.typeConfidence).toBe(DISAGREE_CONFIDENCE);
    expect(crosscheck([bus], { busstop: true }, r).source).toBe('likely');
  });
  it('항목은 아무것도 안 보이는데 AI만 유형을 냈으면 유형 없음', () => {
    const r = mergeReads([read('none', { guess: 'sidewalk' }), read('none', { guess: 'sidewalk' })], 'm')!;
    expect(r.typeGuess).toBe('none');
  });
});

describe('판독 응답 다듬기', () => {
  it('형식을 어긴 값은 안전한 기본값으로', () => {
    const r = normalizeRead({ plate: { text: '12 가 3456', readable: true, confidence: 7 }, typeGuess: 'parking', scene: { onCrosswalk: 'maybe' } })!;
    expect(r.plate).toEqual({ text: '12가3456', readable: true, confidence: 1 });
    expect(r.typeGuess).toBe('none');
    expect(r.scene.onCrosswalk).toBe('unclear');
  });
  it('글자가 비었으면 읽었다고 하지 않는다', () => {
    expect(normalizeRead({ plate: { text: '', readable: true, confidence: 0.9 } })!.plate.readable).toBe(false);
  });
  it('근거 상자: 모르는 이름·뒤집힌 상자는 버리고 0~1000으로 자른다', () => {
    const r = normalizeRead({
      boxes: [
        { label: 'plate', box_2d: [600, 400, 700, 600] },
        { label: 'tree', box_2d: [0, 0, 10, 10] },
        { label: 'vehicle', box_2d: [500, 500, 400, 400] },
        { label: 'crosswalk', box_2d: [-5, 100, 1200, 900] },
      ],
    })!;
    expect(r.boxes).toEqual([
      { label: 'plate', box: [600, 400, 700, 600] },
      { label: 'crosswalk', box: [0, 100, 1000, 900] },
    ]);
  });
  it('이미지 data URL만 받는다', () => {
    expect(parseDataUrl('data:image/jpeg;base64,AAAA')).toEqual({ mime: 'image/jpeg', data: 'AAAA' });
    expect(parseDataUrl('data:text/html;base64,AAAA')).toBeNull();
    expect(parseDataUrl('https://example.com/a.jpg')).toBeNull();
  });
  it('판독용 사본은 긴 변 1280px, 작은 사진은 그대로', () => {
    expect(scaledSize(1920, 1080)).toEqual([1280, 720]);
    expect(scaledSize(1080, 1920)).toEqual([720, 1280]);
    expect(scaledSize(800, 600)).toEqual([800, 600]);
  });
});
