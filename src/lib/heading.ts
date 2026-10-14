/** Camera optical axis projection, separate from travel course and screen-top compass. */
export type NorthReference = 'true' | 'magnetic' | 'unknown';
export interface HeadingSample {
  bearing?: number;
  observedAt: number;
  receivedAt: number;
  reference: NorthReference;
  accuracy?: number;
  horizontalMagnitude: number;
  source: 'device_orientation' | 'native_camera_axis';
  facingMode: 'environment' | 'user' | 'unknown';
}
export interface CaptureHeadingSnapshot {
  capturedAt: number;
  sample?: HeadingSample;
  status: 'usable' | 'unknown' | 'stale' | 'unstable' | 'denied' | 'unsupported';
  reasons: string[];
}
export const HEADING_POLICY = Object.freeze({ freshMs: 1_000, minimumHorizontalMagnitude: 0.25, maximumAccuracyDegrees: 30, maximumChangeDegrees: 30, historyMs: 1_000 });
export function normalizeBearing(value: number): number { return ((value % 360) + 360) % 360; }
export function bearingDifference(a: number, b: number): number { return Math.abs(((a - b + 540) % 360) - 180); }

/** W3C Z-X'-Y'' rotation of the rear camera axis [0,0,-1]. Screen rotation changes no device axes. */
export function projectCameraAxis(alpha: number, beta: number, gamma: number, facingMode: HeadingSample['facingMode'] = 'environment'): { bearing?: number; horizontalMagnitude: number } {
  if (![alpha, beta, gamma].every(Number.isFinite) || facingMode === 'unknown') return { horizontalMagnitude: 0 };
  const [a, b, g] = [alpha, beta, gamma].map((v) => v * Math.PI / 180);
  const sign = facingMode === 'user' ? -1 : 1;
  const east = sign * (-Math.cos(a) * Math.sin(g) - Math.sin(a) * Math.sin(b) * Math.cos(g));
  const north = sign * (-Math.sin(a) * Math.sin(g) + Math.cos(a) * Math.sin(b) * Math.cos(g));
  const horizontalMagnitude = Math.hypot(east, north);
  return { bearing: horizontalMagnitude >= HEADING_POLICY.minimumHorizontalMagnitude ? normalizeBearing(Math.atan2(east, north) * 180 / Math.PI) : undefined, horizontalMagnitude };
}

export function snapshotHeading(samples: readonly HeadingSample[], capturedAt: number, issue?: 'denied' | 'unsupported'): CaptureHeadingSnapshot {
  const available = samples.filter((s) => s.observedAt <= capturedAt && s.receivedAt <= capturedAt).sort((a, b) => a.observedAt - b.observedAt);
  const last = available.at(-1);
  const result: CaptureHeadingSnapshot = { capturedAt, sample: last ? { ...last } : undefined, status: issue ?? 'unknown', reasons: [] };
  if (issue) { result.reasons.push(issue === 'denied' ? '방향 센서 권한이 꺼져 있어요.' : '이 환경은 검증 가능한 촬영 방향을 제공하지 않아요.'); return result; }
  if (!last) { result.reasons.push('촬영 방향 정보가 없어요.'); return result; }
  if (capturedAt - last.observedAt > HEADING_POLICY.freshMs) { result.status = 'stale'; result.reasons.push('방향 정보가 오래되었어요.'); return result; }
  if (last.bearing === undefined || !Number.isFinite(last.bearing) || last.horizontalMagnitude < HEADING_POLICY.minimumHorizontalMagnitude) result.reasons.push('카메라의 수평 방향을 확인하기 어려워요.');
  if (last.reference !== 'true') result.reasons.push('지도와 같은 참북 기준인지 확인되지 않았어요.');
  if (last.accuracy === undefined || !Number.isFinite(last.accuracy) || last.accuracy < 0 || last.accuracy > HEADING_POLICY.maximumAccuracyDegrees) result.reasons.push('방향 센서의 보고 오차를 확인할 수 없거나 오차가 커요.');
  if (last.facingMode === 'unknown') result.reasons.push('전면·후면 카메라 방향이 확인되지 않았어요.');
  const recent = available.filter((s) => capturedAt - s.observedAt <= HEADING_POLICY.historyMs && s.bearing !== undefined);
  if (recent.some((s) => last.bearing !== undefined && bearingDifference(s.bearing!, last.bearing) > HEADING_POLICY.maximumChangeDegrees)) { result.status = 'unstable'; result.reasons.push('방향이 크게 바뀌고 있어요.'); }
  else if (result.reasons.length === 0) result.status = 'usable';
  return result;
}

/** Invoke in a user click. Browser absolute orientation has no standardized accuracy or guaranteed true-north datum. */
export async function startHeadingTracking(options: { facingMode: HeadingSample['facingMode']; onSample: (sample: HeadingSample) => void }): Promise<{ stop: () => void; issue?: 'denied' | 'unsupported' }> {
  if (typeof window === 'undefined' || !('DeviceOrientationEvent' in window)) return { stop() {}, issue: 'unsupported' };
  const constructor = window.DeviceOrientationEvent as typeof DeviceOrientationEvent & { requestPermission?: (absolute?: boolean) => Promise<string> };
  try {
    if (constructor.requestPermission && await constructor.requestPermission(true) !== 'granted') return { stop() {}, issue: 'denied' };
  } catch { return { stop() {}, issue: 'denied' }; }
  const listener = (event: DeviceOrientationEvent) => {
    const now = Date.now();
    // Relative alpha and webkitCompassHeading (screen-top axis) are not camera azimuth.
    const projection = event.absolute && event.alpha !== null && event.beta !== null && event.gamma !== null
      ? projectCameraAxis(event.alpha, event.beta, event.gamma, options.facingMode) : { horizontalMagnitude: 0 };
    const observedAt = event.timeStamp > 1e12 ? event.timeStamp : performance.timeOrigin + event.timeStamp;
    options.onSample({ ...projection, observedAt, receivedAt: now, reference: 'unknown', source: 'device_orientation', facingMode: options.facingMode });
  };
  window.addEventListener('deviceorientationabsolute', listener as EventListener);
  window.addEventListener('deviceorientation', listener);
  return { stop() { window.removeEventListener('deviceorientationabsolute', listener as EventListener); window.removeEventListener('deviceorientation', listener); } };
}
