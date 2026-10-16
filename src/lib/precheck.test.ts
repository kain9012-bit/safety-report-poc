import { describe, expect, it } from 'vitest';
import { kstTime } from './kst';
import { fixStep, precheck } from './precheck';
import type { PrecheckInput } from './precheck';
import type { DraftReport, Shot } from '../types/report';
import type { VisionResult } from '../../api/vision';

// 평일(2026-10-07 수) 오전 10시(한국 시각)
const T0 = kstTime(2026, 10, 7, 10, 0, 0);
const shot = (t: number): Shot => ({ takenAt: t, lat: 35.8242, lng: 127.148, accuracy: 6, dataUrl: `data:,synthetic-${t}`, source: 'camera' });

const vision = (over: Partial<VisionResult> = {}): VisionResult =>
  ({
    photos: [],
    plate: { text: '12가3456', readable: true, confidence: 0.95, agree: true, reads: ['12가3456', '12가3456'] },
    sameVehicle: 'yes',
    scene: {} as VisionResult['scene'],
    ruleTypes: ['crossing'],
    typeGuess: 'crossing',
    typeConfidence: 0.9,
    modelAgrees: true,
    evidence: '',
    model: 'test',
    ...over,
  }) as VisionResult;

/** 모든 점검을 통과하는 신고 한 건 — 시험마다 한 군데만 바꾼다 */
function input(draft: Partial<DraftReport> = {}, over: Partial<PrecheckInput> = {}): PrecheckInput {
  return {
    draft: {
      shots: [shot(T0), shot(T0 + 61_000)],
      address: '전북특별자치도 전주시 완산구 노송광장로 10',
      plate: '12가3456',
      type: 'crossing',
      overlap: { ratio: 0.9, score: 0.8, same: true },
      ...draft,
    },
    body: '횡단보도 위 주차 차량 신고합니다.',
    verdict: { type: 'crossing', source: 'photo', suspicions: [], alternatives: [] },
    vision: vision(),
    now: T0 + 120_000,
    minInterval: 60,
    ...over,
  };
}
const status = (r: ReturnType<typeof precheck>, id: string) => r.checks.find((c) => c.id === id)?.status;

describe('제출 전 점검 — 모두 갖추면 제출할 수 있다', () => {
  it('기준 신고 한 건은 막히지 않는다', () => {
    const r = precheck(input());
    expect(r.blocked).toBe(false);
    expect(r.checks.filter((c) => c.status === 'fail')).toEqual([]);
  });
});

describe('위반유형 사진 증거', () => {
  it('유형이 비면 막는다', () => {
    const r = precheck(input({ type: undefined }));
    expect(status(r, 'evidence')).toBe('fail');
    expect(r.blocked).toBe(true);
  });
  it('사진에 안 보인 유형을 직접 골랐으면 경고만 한다', () => {
    const r = precheck(input({ type: 'sidewalk', manual: { type: true } }));
    expect(status(r, 'evidence')).toBe('warn');
  });
  it('사진에 함께 보인 유형을 골랐으면 통과', () => {
    const r = precheck(input({ type: 'corner', manual: { type: true } }, { vision: vision({ ruleTypes: ['crossing', 'corner'] }) }));
    expect(status(r, 'evidence')).toBe('pass');
  });
});

describe('두 장 번호판 일치 — 같은 차', () => {
  it('두 장 번호가 다르면 막는다', () => {
    const r = precheck(input({}, { vision: vision({ sameVehicle: 'no', plate: { text: '', readable: true, confidence: 0.9, agree: false, reads: ['12가3456', '12가3457'] } }) }));
    expect(status(r, 'vehicle')).toBe('fail');
    expect(r.checks.find((c) => c.id === 'vehicle')?.detail).toContain('12가3457');
  });
  it('두 장 번호가 달라도 신고인이 사진을 보고 확인하면 주황으로 낸다', () => {
    const v = vision({ sameVehicle: 'no', plate: { text: '', readable: true, confidence: 0.9, agree: false, reads: ['12가3456', '12가3457'] } });
    const r = precheck(input({ plateConfirmedFor: '12가3456' }, { vision: v }));
    expect(status(r, 'vehicle')).toBe('warn');
    expect(r.blocked).toBe(false);
    expect(r.checks.find((c) => c.id === 'vehicle')?.detail).toContain('담당자가 사진으로');
  });
  it('한 장만 읽히면 막지 않고 주황 — 신고인이 입력한 번호로 내고 담당자가 다시 본다', () => {
    const r = precheck(input({}, { vision: vision({ sameVehicle: 'unclear', plate: { text: '12가3456', readable: true, confidence: 0.9, agree: null, reads: ['12가3456'] } }) }));
    expect(status(r, 'vehicle')).toBe('warn');
    expect(r.blocked).toBe(false);
    expect(r.checks.find((c) => c.id === 'vehicle')?.detail).toContain('한 장에서만');
  });
  it('판독 결과가 없어도 입력한 번호가 있으면 주황', () => {
    const r = precheck(input({}, { vision: null }));
    expect(status(r, 'vehicle')).toBe('warn');
    expect(r.checks.find((c) => c.id === 'vehicle')?.detail).toContain('판독 결과 없음');
  });
  it('못 읽었는데 번호도 비었으면 차량번호 칸이 빨간불', () => {
    const r = precheck(input({ plate: undefined }, { vision: null }));
    expect(status(r, 'plate')).toBe('fail');
    expect(status(r, 'vehicle')).toBe('warn');
    expect(r.blocked).toBe(true);
  });
  it('두 장에서 같은 번호를 읽었는데 칸을 비웠으면 읽은 번호를 알려 준다', () => {
    const r = precheck(input({ plate: undefined, manual: { plate: true } }));
    expect(status(r, 'plate')).toBe('fail');
    expect(r.checks.find((c) => c.id === 'vehicle')?.detail).toContain('12가3456');
  });
});

describe('같은 자리 두 장 — 겹침', () => {
  it('겹침이 기준 미만이면 막는다', () => {
    expect(status(precheck(input({ overlap: { ratio: 0.3, score: 0.8, same: false } })), 'overlap')).toBe('fail');
  });
  it('겹침을 못 쟀으면 경고만 한다', () => {
    const r = precheck(input({ overlap: undefined }));
    expect(status(r, 'overlap')).toBe('warn');
    expect(r.blocked).toBe(false);
  });
});

describe('두 사진 간격', () => {
  it('지자체 간격(60초) 미만이면 막는다', () => {
    expect(status(precheck(input({ shots: [shot(T0), shot(T0 + 30_000)] })), 'interval')).toBe('fail');
  });
});

describe('단속 시간 — 지자체·유형 규정', () => {
  it('어린이보호구역은 주말에 막는다', () => {
    const sat = kstTime(2026, 10, 10, 10, 0, 0); // 토요일
    const r = precheck(input({ type: 'schoolzone', shots: [shot(sat), shot(sat + 61_000)] }, { now: sat + 120_000 }));
    expect(status(r, 'hours')).toBe('fail');
  });
  it('어린이보호구역 평일 낮은 통과', () => {
    expect(status(precheck(input({ type: 'schoolzone' })), 'hours')).toBe('pass');
  });
  it('24시간 단속 유형은 이 항목을 따로 띄우지 않는다', () => {
    expect(status(precheck(input()), 'hours')).toBeUndefined();
  });
});

describe('발생지역·내용', () => {
  it('주소가 없어도 좌표가 있으면 경고만', () => {
    expect(status(precheck(input({ address: undefined })), 'address')).toBe('warn');
  });
  it('좌표도 주소도 없으면 막는다', () => {
    const bare: Shot = { takenAt: T0, dataUrl: 'data:,synthetic-first', source: 'camera' };
    const r = precheck(input({ address: undefined, shots: [bare, { ...bare, takenAt: T0 + 61_000 }] }));
    expect(status(r, 'address')).toBe('fail');
  });
  it('내용이 5자 미만이면 막는다', () => {
    expect(status(precheck(input({}, { body: '신고' })), 'body')).toBe('fail');
  });
});

describe('앨범 사진', () => {
  it('촬영시각 기록이 없는 앨범 사진은 간격·촬영시각을 확인할 수 없어 막는다', () => {
    const album: Shot = { ...shot(T0), source: 'album', meta: {} as Shot['meta'] };
    const r = precheck(input({ shots: [album, { ...album, takenAt: T0 + 61_000 }] }));
    expect(status(r, 'interval')).toBe('fail');
    expect(status(r, 'timestamp')).toBe('fail');
  });
});

describe('지역별 접수 기한', () => {
  it('대전 동구는 촬영 이틀 뒤 자정까지 받는다 — 익일이 지나도 막지 않는다', () => {
    const later = kstTime(2026, 10, 9, 10, 0); // 촬영(10/7) 이틀 뒤
    const r = precheck(input({ address: '대전광역시 동구 동구청로 147' }, { now: later }));
    expect(status(r, 'deadline')).not.toBe('fail');
  });
  it('전국 기준(익일)이면 같은 시각에 막는다', () => {
    const later = kstTime(2026, 10, 9, 10, 0);
    expect(status(precheck(input({}, { now: later })), 'deadline')).toBe('fail');
  });
});


describe('판독 근거와 최종 입력 번호의 일치', () => {
  it('정상 형식이어도 사진과 다른 번호를 직접 입력하면 빨간불', () => {
    const r = precheck(input({ plate: '99나9999', manual: { plate: true } }));
    expect(status(r, 'plate')).toBe('pass');
    expect(status(r, 'vehicle')).toBe('fail');
    expect(r.blocked).toBe(true);
    expect(r.checks.find((c) => c.id === 'vehicle')?.detail).toContain('99나9999');
  });
  it('사진을 보고 확인했다고 체크하면 주황으로 낸다', () => {
    const r = precheck(input({ plate: '99나9999', manual: { plate: true }, plateConfirmedFor: '99 나 9999' }));
    expect(status(r, 'vehicle')).toBe('warn');
    expect(r.blocked).toBe(false);
    expect(r.checks.find((c) => c.id === 'vehicle')?.detail).toContain('신고인이 사진을 보고 확인했습니다');
  });
  it('확인한 뒤 번호를 또 바꾸면 확인이 풀린다', () => {
    const r = precheck(input({ plate: '99나9998', manual: { plate: true }, plateConfirmedFor: '99나9999' }));
    expect(status(r, 'vehicle')).toBe('fail');
  });
  it('공백만 다르고 실제 번호가 같으면 통과한다', () => {
    expect(precheck(input({ plate: ' 12 가 3456 ', manual: { plate: true } })).blocked).toBe(false);
  });
  it('형식이 틀린 최종 번호는 통과하지 않는다', () => {
    const r = precheck(input({ plate: 'hello', manual: { plate: true } }));
    expect(status(r, 'plate')).toBe('fail');
    expect(r.blocked).toBe(true);
  });
  it.each([0.79, NaN, undefined])('과거 요약이 yes여도 확신도 %s이면 통과시키지 않고 주황으로 남긴다', (confidence) => {
    const v = vision();
    const r = precheck(input({}, { vision: vision({ plate: { ...v.plate, confidence: confidence as number } }) }));
    expect(status(r, 'vehicle')).toBe('warn');
    expect(r.checks.find((c) => c.id === 'vehicle')?.detail).toContain('확신도');
  });
  it('판독된 두 번호의 형식이 틀리면 yes 요약으로 우회하지 못한다', () => {
    const v = vision({ plate: { text: 'ABC', reads: ['ABC', 'ABC'], readable: true, confidence: 0.99, agree: true } });
    const r = precheck(input({}, { vision: v }));
    expect(status(r, 'vehicle')).toBe('warn');
    expect(r.checks.find((c) => c.id === 'vehicle')?.detail).toContain('형식');
  });
  it('요약 번호와 개별 판독 번호가 다르면 확정하지 않는다', () => {
    const v = vision();
    expect(status(precheck(input({}, { vision: vision({ plate: { ...v.plate, text: '99나9999' } }) })), 'vehicle')).toBe('warn');
  });
});

describe('두 번째 촬영의 단속 시간', () => {
  it('첫 사진은 19:59여도 두 번째가 20:00이면 막는다', () => {
    const first = kstTime(2026, 10, 7, 19, 59, 30);
    const r = precheck(input({ type: 'schoolzone', shots: [shot(first), shot(first + 61_000)] }, { now: first + 120_000 }));
    expect(status(r, 'hours')).toBe('fail');
    expect(r.checks.find((c) => c.id === 'hours')?.detail).toContain('2장 10/7 20:00: 시간 밖');
  });
  it('입력 순서가 뒤집혀도 시간 밖 사진을 놓치지 않는다', () => {
    const first = kstTime(2026, 10, 7, 7, 59, 30);
    const r = precheck(input({ type: 'schoolzone', shots: [shot(first + 61_000), shot(first)] }, { now: first + 120_000 }));
    expect(status(r, 'hours')).toBe('fail');
  });
});

describe('지역 기한과 앨범 점검의 일관성', () => {
  const albumShot = (t: number, name: string): Shot => ({
    ...shot(t), source: 'album', meta: {
      takenAt: t, modifiedAt: t, make: 'Apple', model: 'iPhone', lat: 35.8242, lng: 127.148,
      width: 4032, height: 3024, fileName: name, fileSize: 2_000_000,
    },
  });
  const shots = [albumShot(T0, 'a.jpg'), albumShot(T0 + 61_000, 'b.jpg')];
  it('대전 동구 이틀 기한이면 기본 점검과 앨범 점검이 모두 통과한다', () => {
    const r = precheck(input({ shots, address: '대전광역시 동구 동구청로 147' }, { now: kstTime(2026, 10, 9, 10) }));
    expect(status(r, 'deadline')).toBe('pass');
    expect(status(r, 'album')).toBe('pass');
    expect(r.blocked).toBe(false);
  });
  it('같은 사진도 익일 기준 지역에서는 양쪽 모두 만료된다', () => {
    const r = precheck(input({ shots }, { now: kstTime(2026, 10, 9, 10) }));
    expect(status(r, 'deadline')).toBe('fail');
    expect(status(r, 'album')).toBe('fail');
  });
});

describe('빨간불을 고치는 단계', () => {
  it.each([['address', 1], ['location', 1], ['plate', 2], ['vehicle', 2], ['body', 3], ['interval', 0], ['deadline', 0], ['evidence', 0]] as const)('%s → %i단계', (id, step) => {
    expect(fixStep(id)).toBe(step);
  });
});
