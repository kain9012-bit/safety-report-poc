import { distanceMeters } from './geo';
import type { LatLng } from './geo';

/** 주변 탐색 안내용 초기값. 법적 거리나 실제 위치 오차의 상한이 아니다. */
export const GPS_POLICY = Object.freeze({ historyMs: 10_000, maxSamples: 20, freshMs: 5_000, nearbyAccuracyM: 20, broadAccuracyM: 50, minimumSamples: 3, requestTimeoutMs: 15_000 });
export type LocationIssue = 'denied' | 'unavailable' | 'timeout';
export interface LocationSample extends LatLng {
  accuracy?: number;
  observedAt: number;
  receivedAt: number;
  source: 'device';
}
export interface LocationQuality {
  status: 'unavailable' | 'stale' | 'needs_map' | 'checking' | 'broad' | 'nearby';
  consistency: 'unknown' | 'checking' | 'consistent' | 'inconsistent';
  sampleCount: number;
  ageMs?: number;
  reasons: string[];
  issue?: LocationIssue;
}
export interface CaptureLocationSnapshot {
  capturedAt: number;
  sample?: LocationSample;
  quality: LocationQuality;
}

export function validCoordinate(p: LatLng): boolean {
  return Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
}
export function locationSample(g: GeolocationPosition, receivedAt = Date.now()): LocationSample | undefined {
  const p = { lat: g.coords.latitude, lng: g.coords.longitude };
  if (!validCoordinate(p) || !Number.isFinite(g.timestamp) || g.timestamp <= 0 || g.timestamp > receivedAt) return;
  const accuracy = Number.isFinite(g.coords.accuracy) && g.coords.accuracy >= 0 ? g.coords.accuracy : undefined;
  return { ...p, accuracy, observedAt: g.timestamp, receivedAt, source: 'device' };
}

export function evaluateLocation(samples: readonly LocationSample[], at: number, issue?: LocationIssue): CaptureLocationSnapshot {
  // A later callback never supplies information to an earlier shutter instant.
  const available = samples.filter((s) => validCoordinate(s) && s.observedAt <= at && s.receivedAt <= at && s.observedAt > 0);
  const byTime = new Map<number, LocationSample>();
  for (const s of available) if (!byTime.has(s.observedAt)) byTime.set(s.observedAt, s);
  const ordered = [...byTime.values()].sort((a, b) => a.observedAt - b.observedAt);
  const latest = ordered.at(-1);
  const recent = ordered.filter((s) => at - s.observedAt <= GPS_POLICY.historyMs).slice(-GPS_POLICY.maxSamples);
  const q: LocationQuality = { status: 'unavailable', consistency: 'unknown', sampleCount: recent.length, reasons: [], ...(issue ? { issue } : {}) };
  if (!latest) {
    q.reasons = [issue === 'denied' ? '위치 권한이 꺼져 있어요. 사진은 계속 찍을 수 있어요.' : issue === 'timeout' ? '위치 확인 시간이 지났어요. 사진은 계속 찍을 수 있어요.' : '위치 정보가 없어요. 사진은 계속 찍을 수 있어요.'];
    return { capturedAt: at, quality: q };
  }
  q.ageMs = at - latest.observedAt;
  const accuracy = latest.accuracy;
  const measured = recent.filter((s) => s.accuracy !== undefined && Number.isFinite(s.accuracy) && s.accuracy >= 0);
  if (measured.length < GPS_POLICY.minimumSamples) {
    q.consistency = 'checking';
    q.reasons.push('서로 다른 시각의 위치가 부족해 안정성을 확인 중이에요.');
  } else {
    // Pairwise overlap only means small contradictions, not independent observations or measured truth.
    q.consistency = measured.every((a, i) => measured.slice(i + 1).every((b) => distanceMeters(a, b) <= a.accuracy! + b.accuracy!)) ? 'consistent' : 'inconsistent';
    if (q.consistency === 'inconsistent') q.reasons.push('위치 변화가 보고 오차 범위보다 커요. 이동 또는 위치 튐을 확인해 주세요.');
  }
  if (q.ageMs > GPS_POLICY.freshMs) { q.status = 'stale'; q.reasons.unshift('위치 갱신이 필요해요.'); }
  else if (accuracy === undefined || !Number.isFinite(accuracy) || accuracy < 0 || accuracy > GPS_POLICY.broadAccuracyM) { q.status = 'needs_map'; q.reasons.unshift('위치 범위가 크거나 보고 오차를 알 수 없어 지도 확인이 필요해요.'); }
  else if (q.consistency === 'inconsistent') q.status = 'needs_map';
  else if (accuracy > GPS_POLICY.nearbyAccuracyM) { q.status = 'broad'; q.reasons.unshift('위치 범위가 넓어요. 주변 후보를 넓게 확인해 주세요.'); }
  else if (q.consistency !== 'consistent') q.status = 'checking';
  else { q.status = 'nearby'; q.reasons.unshift('주변 정류소를 찾는 데 참고할 수 있어요.'); }
  if (issue) { q.reasons.push('최근 위치 요청이 실패했어요. 기존 위치의 취득 시각을 확인해 주세요.'); if (q.status === 'nearby') q.status = 'needs_map'; }
  // Clone every persisted value; later sensor events cannot mutate a saved photograph.
  return { capturedAt: at, sample: { ...latest }, quality: q };
}

export function createLocationTracker() {
  let samples: LocationSample[] = [];
  return {
    ingest(g: GeolocationPosition, receivedAt = Date.now()) {
      const sample = locationSample(g, receivedAt);
      if (!sample) return false;
      if (!samples.some((s) => s.observedAt === sample.observedAt)) samples.push(sample);
      samples.sort((a, b) => a.observedAt - b.observedAt);
      // Retain the last sample even when stale, so its age remains visible.
      const latest = samples.at(-1)!;
      samples = samples.filter((s) => receivedAt - s.observedAt <= GPS_POLICY.historyMs || s === latest).slice(-GPS_POLICY.maxSamples);
      return true;
    },
    snapshot(at = Date.now(), issue?: LocationIssue) { return evaluateLocation(samples, at, issue); },
  };
}

export const LOCATION_LABEL: Record<LocationQuality['status'], string> = {
  unavailable: '위치 미확인', stale: '위치 갱신 필요', needs_map: '지도 확인 필요', checking: '위치 안정성 확인 중', broad: '위치 범위가 넓어요', nearby: '주변 탐색 참고 가능',
};

/** Current-position action for the map. This does not update any saved photo or address. */
export function requestCurrentLocation(): Promise<CaptureLocationSnapshot> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) { resolve(evaluateLocation([], Date.now(), 'unavailable')); return; }
    let finished = false;
    const finish = (result: CaptureLocationSnapshot) => { if (finished) return; finished = true; clearTimeout(timer); resolve(result); };
    const timer = setTimeout(() => finish(evaluateLocation([], Date.now(), 'timeout')), GPS_POLICY.requestTimeoutMs);
    navigator.geolocation.getCurrentPosition((g) => {
      const now = Date.now(); const sample = locationSample(g, now);
      finish(evaluateLocation(sample ? [sample] : [], now));
    }, (e) => finish(evaluateLocation([], Date.now(), e.code === 1 ? 'denied' : e.code === 3 ? 'timeout' : 'unavailable')),
    { enableHighAccuracy: true, maximumAge: 0, timeout: GPS_POLICY.requestTimeoutMs });
  });
}
