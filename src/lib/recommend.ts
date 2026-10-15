/** 주변 시설은 촬영 장소를 탐색하는 참고 후보다. 기기 좌표로 차량의 위반 거리를 확정하지 않는다. */
import { nearest } from './geo';
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
/** TAGO의 탐색 반경과 같은 초기값. 10m 위반 기준과 독립적이다. */
export const BUSSTOP_DISCOVERY_M = 500;

const ORDER: ViolationType[] = ['busstop', 'crossing', 'schoolzone'];

export function recommend(p: LatLng & { accuracy?: number }, n: Nearby): Candidate[] {
  const knownAccuracy = p.accuracy !== undefined && Number.isFinite(p.accuracy) && p.accuracy >= 0 ? p.accuracy : undefined;
  const acc = knownAccuracy ?? 0; // unknown is a display state; no fabricated precision
  const accText = knownAccuracy !== undefined ? `단말 보고 오차 약 ${Math.round(knownAccuracy)}m` : '단말 보고 오차 미확인';
  const out: Candidate[] = [];

  // The closest row summarizes discovery only; rankStopCandidates retains the complete candidate set.
  const bus = nearest(p, n.busstops);
  if (bus && bus.distance <= BUSSTOP_DISCOVERY_M) {
    out.push({
      type: 'busstop', level: 'possible', distance: bus.distance, name: bus.facility.name,
      reason: `기준 위치에서 ${bus.facility.name || '정류소 자료 좌표'}까지 지도상 약 ${Math.round(bus.distance)}m (${accText}) · 대상 정류소와 차량의 10m 이내 여부는 미확인`,
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

  // 탐색 범위에 견준 가까움으로 표시 순서만 정한다. 위반 우선순위가 아니다.
  const scale = (c: Candidate) =>
    c.distance / (c.type === 'busstop' ? BUSSTOP_DISCOVERY_M : c.type === 'crossing' ? CROSSWALK_NEAR_M : SCHOOLZONE_NEAR_M);
  return out.sort(
    (a, b) =>
      (a.level === b.level ? 0 : a.level === 'likely' ? -1 : 1) ||
      scale(a) - scale(b) ||
      ORDER.indexOf(a.type) - ORDER.indexOf(b.type),
  );
}
