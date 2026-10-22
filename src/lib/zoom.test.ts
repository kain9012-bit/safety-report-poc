import { describe, expect, it, vi } from 'vitest';
import { cameraZoomRange, centerCrop, clampZoom, fingerDistance, setCameraZoom, zoomLabel } from './zoom';

describe('촬영 배율', () => {
  it('1배~최대 배율 사이, 0.1 단위로 맞춘다', () => {
    expect(clampZoom(0.5)).toBe(1);
    expect(clampZoom(1.64)).toBe(1.6);
    expect(clampZoom(9)).toBe(3);
    expect(clampZoom(2.5, 2)).toBe(2);
    expect(clampZoom(NaN)).toBe(1);
  });
  it('배율 표시는 정수면 그대로, 아니면 소수 한 자리', () => {
    expect(zoomLabel(2)).toBe('2배');
    expect(zoomLabel(1.6)).toBe('1.6배');
  });
  it('디지털 확대는 원본 가운데 1/배율 부분을 잘라 낸다', () => {
    expect(centerCrop(1920, 1080, 1)).toEqual({ sx: 0, sy: 0, sw: 1920, sh: 1080 });
    expect(centerCrop(1920, 1080, 2)).toEqual({ sx: 480, sy: 270, sw: 960, sh: 540 });
    expect(centerCrop(1920, 1080, 3)).toEqual({ sx: 640, sy: 360, sw: 640, sh: 360 });
  });
  it('기기 카메라가 1배보다 큰 배율을 지원할 때만 그 범위를 쓴다', () => {
    const track = (zoom?: { min?: number; max?: number }) => ({ getCapabilities: () => (zoom ? { zoom } : {}) }) as unknown as MediaStreamTrack;
    expect(cameraZoomRange(track({ min: 1, max: 10 }))).toEqual({ min: 1, max: 10 });
    expect(cameraZoomRange(track({ min: 0.5, max: 6 }))).toEqual({ min: 1, max: 6 });
    expect(cameraZoomRange(track({ min: 1, max: 1 }))).toBeUndefined();
    expect(cameraZoomRange(track())).toBeUndefined();
    expect(cameraZoomRange({} as MediaStreamTrack)).toBeUndefined();
    expect(cameraZoomRange(null)).toBeUndefined();
  });
  it('기기 카메라 배율을 못 바꾸면 false — 디지털 확대로 넘어간다', async () => {
    const ok = { applyConstraints: vi.fn(async () => undefined) } as unknown as MediaStreamTrack;
    const bad = { applyConstraints: vi.fn(async () => { throw new Error('OverconstrainedError'); }) } as unknown as MediaStreamTrack;
    expect(await setCameraZoom(ok, 2)).toBe(true);
    expect(ok.applyConstraints).toHaveBeenCalledWith({ advanced: [{ zoom: 2 }] });
    expect(await setCameraZoom(bad, 2)).toBe(false);
  });
  it('두 손가락 사이 거리', () => {
    expect(fingerDistance({ clientX: 0, clientY: 0 }, { clientX: 30, clientY: 40 })).toBe(50);
  });
});
