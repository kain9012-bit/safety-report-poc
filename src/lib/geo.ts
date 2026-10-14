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
  /** Stable provider identity is distinct from the number printed on the stop sign. */
  source?: string;
  regionCode?: string;
  publicId?: string;
  publicIdNamespace?: string;
  sourceUpdatedAt?: string;
}

export interface NearestHit<T extends Facility = Facility> {
  facility: T;
  distance: number;
}

/** Geographic initial bearing uses true north; it is not camera direction or legal distance. */
export function bearingDegrees(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180;
  const dl = (b.lng - a.lng) * rad;
  const y = Math.sin(dl) * Math.cos(b.lat * rad);
  const x = Math.cos(a.lat * rad) * Math.sin(b.lat * rad) - Math.sin(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos(dl);
  return ((Math.atan2(y, x) / rad) + 360) % 360;
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
 * 주어진 보고 오차 원이 기준 경계를 가로지르는지 확인하는 수학적 보조 함수.
 *
 * 반환값은 실측 성공 또는 법적 거리 확정이 아니다. 단말 보고 오차는 절대 오차 상한이 아니며,
 * 촬영자 위치와 차량 위치도 다르다. 위반 유형 확정에 사용하지 않는다.
 */
export function isDecisive(distance: number, threshold: number, accuracy?: number): boolean {
  if (accuracy === undefined || ![distance, threshold, accuracy].every(Number.isFinite) || distance < 0 || threshold < 0 || accuracy < 0) return false;
  // 보고된 원을 수학적으로 대조할 뿐 실제 위치가 이 안에 있음을 보장하지 않는다.
  // 그 구간이 통째로 기준 안쪽이거나 통째로 바깥일 때만 말이 된다.
  return distance + accuracy <= threshold || distance - accuracy > threshold;
}
