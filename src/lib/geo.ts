/**
 * 좌표 계산 — AI가 손대지 않는 영역.
 * 같은 입력이면 항상 같은 답이 나와야 하고, 누가 검산해도 재현되어야 한다.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

/** 두 지점 사이 거리(m). 수백 m 안쪽에서 쓰므로 하버사인으로 충분하다. */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const R = 6_371_008.8; // 지구 평균 반지름(m)
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface Facility extends LatLng {
  id: string;
  name?: string;
}

export interface NearestHit<T extends Facility = Facility> {
  facility: T;
  distance: number;
}

/** 가장 가까운 시설 하나. 후보가 없으면 null. */
export function nearest<T extends Facility>(at: LatLng, list: readonly T[]): NearestHit<T> | null {
  let best: NearestHit<T> | null = null;
  for (const f of list) {
    const d = distanceMeters(at, f);
    if (!best || d < best.distance) best = { facility: f, distance: d };
  }
  return best;
}

/**
 * 좌표만으로 유형을 확정할 수 있는지.
 *
 * GPS 정확도가 기준 거리보다 나쁘면 "5m 이내"라는 말 자체가 성립하지 않는다.
 * 소화전 기준은 5m 인데 폰 정확도는 흔히 5~10m 라서, 이 함수는 자주 false 를 준다.
 * 그게 맞다 — 확정할 수 없을 때 확정한 척하지 않는 것이 이 앱의 약속이다.
 */
export function isDecisive(distance: number, threshold: number, accuracy?: number): boolean {
  if (accuracy === undefined) return false;
  // 실제 위치는 [distance-accuracy, distance+accuracy] 어딘가에 있다.
  // 그 구간이 통째로 기준 안쪽이거나 통째로 바깥일 때만 말이 된다.
  return distance + accuracy <= threshold || distance - accuracy > threshold;
}
