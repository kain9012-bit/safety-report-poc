import { describe, expect, it } from 'vitest';
import { extraTypeCheck } from './extraTypes';
import { typesFromScene, mergeReads } from '../../api/vision';
import type { PhotoRead, Scene } from '../../api/vision';
import { FINE_KRW, NATIONAL, inEnforcement } from './localRules';
import { EXTRA_TYPES, MANUAL_TYPES, SIX_TYPES, VIOLATION_LABEL, isSixType } from '../types/report';
import { parseType } from '../eval/score';

const base: Scene = {
  onCrosswalk: 'no',
  onSidewalk: 'no',
  busStopVisible: 'no',
  schoolZoneMarking: 'no',
  intersectionCorner: 'no',
  fireHydrantNear: 'no',
  disabledSpace: 'no',
  disabledPermit: 'unclear',
  fireLane: 'no',
  evChargingSpace: 'no',
  evVehicle: 'unclear',
};
const scene = (o: Partial<Scene>): Scene => ({ ...base, ...o });

describe('typesFromScene — 6대 밖 세 유형', () => {
  it('장애인전용구역, 표지 안 보임 → disabled', () =>
    expect(typesFromScene(scene({ disabledSpace: 'yes', disabledPermit: 'no' }))).toEqual(['disabled']));
  it('표지가 모호해도 유형은 남긴다(제출 전 점검에서 묻는다)', () =>
    expect(typesFromScene(scene({ disabledSpace: 'yes' }))).toEqual(['disabled']));
  it('표지가 보이면 위반 유형에서 뺀다', () =>
    expect(typesFromScene(scene({ disabledSpace: 'yes', disabledPermit: 'yes' }))).toEqual([]));
  it('충전구역에 일반차 → evcharge', () =>
    expect(typesFromScene(scene({ evChargingSpace: 'yes', evVehicle: 'no' }))).toEqual(['evcharge']));
  it('충전구역에 친환경차는 일반차 주차 위반이 아님', () =>
    expect(typesFromScene(scene({ evChargingSpace: 'yes', evVehicle: 'yes' }))).toEqual([]));
  it('소방차 전용구역', () => expect(typesFromScene(scene({ fireLane: 'yes' }))).toEqual(['firelane']));
  it('횡단보도가 먼저, 보호구역이 마지막', () =>
    expect(typesFromScene(scene({ onCrosswalk: 'yes', fireLane: 'yes', schoolZoneMarking: 'yes' }))).toEqual([
      'crossing',
      'firelane',
      'schoolzone',
    ]));
});

describe('mergeReads — 두 장 장면 합치기', () => {
  const read = (s: Partial<Scene>): PhotoRead => ({
    plate: { text: '12가3456', readable: true, confidence: 0.9 },
    scene: scene(s),
    typeGuess: 'disabled',
    typeConfidence: 0.8,
    evidence: '휠체어 표시 구획',
    boxes: [],
  });
  it('한 장에서 표지가 보이고 한 장은 안 보이면 모호 → 유형은 남김', () => {
    const m = mergeReads([read({ disabledSpace: 'yes', disabledPermit: 'yes' }), read({ disabledSpace: 'yes', disabledPermit: 'no' })], 'm');
    expect(m?.scene.disabledPermit).toBe('unclear');
    expect(m?.typeGuess).toBe('disabled');
  });
});

describe('extraTypeCheck — 제출 전 점검', () => {
  it('6대 유형은 추가 점검 없음', () => expect(extraTypeCheck('crossing', base)).toBeUndefined());
  it('표지가 보이면 빨간불', () => expect(extraTypeCheck('disabled', scene({ disabledPermit: 'yes' }))?.status).toBe('fail'));
  it('표지가 안 보이면 통과', () => expect(extraTypeCheck('disabled', scene({ disabledPermit: 'no' }))?.status).toBe('pass'));
  it('앞유리가 안 보이면 노란불', () => expect(extraTypeCheck('disabled', base)?.status).toBe('warn'));
  it('판독이 없어도 노란불', () => expect(extraTypeCheck('evcharge', null)?.status).toBe('warn'));
  it('친환경차면 빨간불', () => expect(extraTypeCheck('evcharge', scene({ evVehicle: 'yes' }))?.status).toBe('fail'));
  it('기타는 자동 판독 대상이 아님을 알림(노란불, 막지 않음)', () => {
    const c = extraTypeCheck('etc', base);
    expect(c?.status).toBe('warn');
    expect(c?.detail).toContain('내용에 적고');
  });
  it('소방차전용구역은 대상 건물 안내(노란불)', () => {
    const c = extraTypeCheck('firelane', base);
    expect(c?.status).toBe('warn');
    expect(c?.detail).toContain('2018. 8. 10.');
  });
});

describe('규정 — 회의 결정대로 기존 규정 유지', () => {
  it('세 유형 모두 1분 간격·24시간', () => {
    for (const t of EXTRA_TYPES) {
      expect(NATIONAL[t].intervalSec).toBe(60);
      expect(inEnforcement(NATIONAL[t], Date.UTC(2026, 9, 12, 15)).text).toBe('24시간 단속');
    }
  });
  it('과태료(승용)', () => {
    expect(FINE_KRW.disabled).toBe(100_000);
    expect(FINE_KRW.firelane).toBe(500_000);
    expect(FINE_KRW.evcharge).toBe(100_000);
  });
  it('6대·그 밖 구분', () => {
    expect(SIX_TYPES.length + EXTRA_TYPES.length + MANUAL_TYPES.length).toBe(Object.keys(VIOLATION_LABEL).length);
    expect(isSixType('crossing')).toBe(true);
    expect(isSixType('evcharge')).toBe(false);
  });
  it('채점 정답표에서 새 유형 이름을 읽는다', () => {
    expect(parseType('장애인전용구역')).toBe('disabled');
    expect(parseType('소방차전용구역')).toBe('firelane');
    expect(parseType('소화전')).toBe('hydrant');
    expect(parseType('전기차충전구역')).toBe('evcharge');
  });
});
