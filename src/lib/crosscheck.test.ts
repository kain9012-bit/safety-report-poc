import { describe, expect, it } from 'vitest';
import { crosscheck } from './crosscheck';
import { scaledSize } from './vision';
import { normalize, parseDataUrl } from '../../api/vision';
import type { Candidate } from './recommend';
import type { VisionResult } from '../../api/vision';

const bus: Candidate = { type: 'busstop', level: 'likely', distance: 3, name: 'A', reason: 'A까지 약 3m' };
const school: Candidate = { type: 'schoolzone', level: 'possible', distance: 180, reason: '초교 180m' };

const photo = (typeGuess: VisionResult['typeGuess'], typeConfidence = 0.9): VisionResult =>
  normalize(
    {
      plate: { text: '12가3456', readable: true, confidence: 0.95 },
      sameVehicle: 'yes',
      sameSpot: 'yes',
      scene: {},
      typeGuess,
      typeConfidence,
      evidence: '근거',
    },
    'test',
  )!;

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

describe('판독 응답 다듬기', () => {
  it('형식을 어긴 값은 안전한 기본값으로', () => {
    const r = normalize({ plate: { text: '12 가 3456', readable: true, confidence: 7 }, typeGuess: 'parking', scene: { onCrosswalk: 'maybe' } }, 'm')!;
    expect(r.plate).toEqual({ text: '12가3456', readable: true, confidence: 1 });
    expect(r.typeGuess).toBe('none');
    expect(r.scene.onCrosswalk).toBe('unclear');
    expect(r.sameVehicle).toBe('unclear');
  });
  it('글자가 비었으면 읽었다고 하지 않는다', () => {
    expect(normalize({ plate: { text: '', readable: true, confidence: 0.9 } }, 'm')!.plate.readable).toBe(false);
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
