/**
 * 위반유형 추천 — 사진 좌표와 주변 시설 거리로 후보를 고른다. AI 없이 규칙만 쓴다.
 *
 * 판정이 아니라 추천이다. GPS 오차(±m)가 기준 거리와 비슷해서 좌표만으로는
 * "10m 안"을 확정하지 못하는 경우가 많다(geo.test.ts). 그래서 후보마다
 * '유력'과 '가능'을 나누고, 근거(시설 이름·거리·오차)를 같이 돌려준다.
 */
import { THRESHOLD_METERS } from './rules';
import { isDecisive, nearest } from './geo';
import type { LatLng } from './geo';
import type { Nearby } from './facilities';
import type { ViolationType } from '../types/report';

export type Level = 'likely' | 'possible';

export interface Candidate {
  type: ViolationType;
  level: Level;
  distance: number;
  name?: string;
  reason: string;
}

/** 횡단보도 자료는 중심점 하나뿐이다. 중심에서 이 거리 안이면 횡단보도 위일 수 있다(도로 폭의 절반쯤). */
export const CROSSWALK_NEAR_M = 15;
/** 어린이보호구역 자료는 대상시설(학교 등) 위치다. 구역은 보통 주출입문 반경 300m 안에서 지정된다. */
export const SCHOOLZONE_NEAR_M = 300;
/** 정확도를 모를 때 가정하는 오차 */
const DEFAULT_ACC = 20;

const ORDER: ViolationType[] = ['busstop', 'crossing', 'schoolzone'];

export function recommend(p: LatLng & { accuracy?: number }, n: Nearby): Candidate[] {
  const acc = p.accuracy ?? DEFAULT_ACC;
  const accText = p.accuracy !== undefined ? `GPS 오차 ±${Math.round(p.accuracy)}m` : 'GPS 오차 모름';
  const out: Candidate[] = [];

  // 버스정류소 10m
  const bus = nearest(p, n.busstops);
  const busTh = THRESHOLD_METERS.busstop!;
  if (bus && bus.distance - acc <= busTh) {
    const d = Math.round(bus.distance);
    const sure = isDecisive(bus.distance, busTh, p.accuracy) && bus.distance + acc <= busTh;
    out.push({
      type: 'busstop',
      level: sure ? 'likely' : 'possible',
      distance: bus.distance,
      name: bus.facility.name,
      reason: `${bus.facility.name || '버스정류장'}까지 약 ${d}m (기준 ${busTh}m, ${accText})`,
    });
  }

  // 횡단보도 — 위에 섰는지는 사진으로만 확정된다
  const cw = nearest(p, n.crosswalks);
  if (cw && cw.distance - acc <= CROSSWALK_NEAR_M) {
    out.push({
      type: 'crossing',
      level: 'possible',
      distance: cw.distance,
      reason: `횡단보도 중심까지 약 ${Math.round(cw.distance)}m — 횡단보도 위인지는 사진으로 확인 (${accText})`,
    });
  }

  // 어린이보호구역 — 대상시설 거리로만 가늠한다
  const sc = nearest(p, n.schools);
  if (sc && sc.distance <= SCHOOLZONE_NEAR_M) {
    out.push({
      type: 'schoolzone',
      level: 'possible',
      distance: sc.distance,
      name: sc.facility.name,
      reason: `${sc.facility.name || '보호구역 대상시설'}에서 약 ${Math.round(sc.distance)}m — 보호구역 안일 수 있음(지정 범위는 지자체 고시)`,
    });
  }

  // 유력 먼저, 같은 등급이면 기준 거리에 견준 가까움 → 유형 순서
  const scale = (c: Candidate) =>
    c.distance / (c.type === 'busstop' ? busTh : c.type === 'crossing' ? CROSSWALK_NEAR_M : SCHOOLZONE_NEAR_M);
  return out.sort(
    (a, b) =>
      (a.level === b.level ? 0 : a.level === 'likely' ? -1 : 1) ||
      scale(a) - scale(b) ||
      ORDER.indexOf(a.type) - ORDER.indexOf(b.type),
  );
}
