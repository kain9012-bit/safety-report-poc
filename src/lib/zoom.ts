/**
 * 촬영 배율 — 손가락으로 벌리거나 1·2·3배 단추로 **사진 부분만** 키운다(2026-10-22 결정).
 * 촬영 화면에서는 페이지 전체 확대를 막는다.
 *
 * 기기 카메라가 배율(zoom)을 지원하면 그 배율을 쓰고, 아니면 화면 가운데를 키워 보여 주고
 * 찍을 때 같은 부분을 잘라 낸다(디지털 확대 — 화소가 늘지는 않는다).
 * 많이 키우면 '차·번호판·위반 장소가 한 화면에'를 놓치기 쉬워 2배부터 한 줄 알린다.
 */
export const ZOOM_STEPS = [1, 2, 3] as const;
export const MAX_ZOOM = 3;
export const WIDE_ZOOM_NOTE = '확대하면 위반 장소가 화면 밖으로 나가기 쉬워요. 차·번호판·위반 장소가 함께 나오는지 확인해 주세요';

/** 1배~최대 배율, 0.1 단위 */
export function clampZoom(zoom: number, max = MAX_ZOOM): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(max, Math.max(1, Math.round(zoom * 10) / 10));
}

/** 화면에 보일 배율 — '2배', '1.6배' */
export function zoomLabel(zoom: number): string {
  return `${Number.isInteger(zoom) ? zoom : zoom.toFixed(1)}배`;
}

/** 기기 카메라가 지원하는 배율 범위(1배 이상만). 지원하지 않으면 undefined */
export function cameraZoomRange(track?: MediaStreamTrack | null): { min: number; max: number } | undefined {
  const caps = (track?.getCapabilities?.() ?? {}) as { zoom?: { min?: number; max?: number } };
  const max = caps.zoom?.max;
  if (typeof max !== 'number' || !Number.isFinite(max) || max <= 1) return;
  return { min: Math.max(1, caps.zoom?.min ?? 1), max };
}

/** 기기 카메라 배율을 바꾼다 — 안 되면 false(디지털 확대로 넘어간다) */
export async function setCameraZoom(track: MediaStreamTrack, zoom: number): Promise<boolean> {
  try {
    await track.applyConstraints({ advanced: [{ zoom } as MediaTrackConstraintSet] });
    return true;
  } catch {
    return false;
  }
}

/** 디지털 확대 — 원본 프레임에서 가운데 1/zoom 부분 */
export function centerCrop(w: number, h: number, zoom: number): { sx: number; sy: number; sw: number; sh: number } {
  const z = Math.max(1, Number.isFinite(zoom) ? zoom : 1);
  const sw = Math.round(w / z);
  const sh = Math.round(h / z);
  return { sx: Math.round((w - sw) / 2), sy: Math.round((h - sh) / 2), sw, sh };
}

/** 두 손가락 사이 거리 */
export function fingerDistance(a: { clientX: number; clientY: number }, b: { clientX: number; clientY: number }): number {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}
