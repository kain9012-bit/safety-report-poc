// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureEvidenceFrame, startCamera } from '../lib/camera';
import CaptureFlow from './CaptureFlow';

// 실제 카메라·위치·공공데이터 없이 촬영 화면의 배율만 본다
vi.mock('../lib/camera', () => ({
  startCamera: vi.fn(),
  stopCamera: vi.fn(),
  captureEvidenceFrame: vi.fn(() => ({ dataUrl: 'data:,shot', originalDataUrl: 'data:,original' })),
}));
vi.mock('../lib/facilities', () => ({ loadNearby: vi.fn(async () => ({})) }));
vi.mock('../lib/recommend', () => ({ recommend: vi.fn(() => []) }));
vi.mock('../lib/reverseGeocode', () => ({ reverseGeocode: vi.fn(async () => ({ state: 'error' })) }));
vi.mock('../lib/noParkingData', () => ({ noParkingFor: vi.fn(async () => null) }));

const track = (extra: Record<string, unknown> = {}) => ({ stop: vi.fn(), ...extra });
const stream = (t: ReturnType<typeof track>) => ({ getTracks: () => [t], getVideoTracks: () => [t] }) as unknown as MediaStream;

function props(): ComponentProps<typeof CaptureFlow> {
  return {
    draft: { shots: [] },
    readStates: [],
    verdict: { source: 'none', suspicions: [], alternatives: [] },
    options: [],
    onShot: vi.fn(), onRetakeFirst: vi.fn(), onRetakeSecond: vi.fn(),
    onAcceptFirst: vi.fn(), onChooseType: vi.fn(), onRetryRead: vi.fn(), onDone: vi.fn(), onExit: vi.fn(),
  };
}

async function open(t: ReturnType<typeof track>) {
  vi.mocked(startCamera).mockResolvedValue(stream(t));
  const view = render(<CaptureFlow {...props()} />);
  await act(async () => {});
  const video = view.container.querySelector('video')!;
  Object.defineProperty(video, 'readyState', { value: 4, configurable: true });
  return video;
}

beforeEach(() => {
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      watchPosition: (ok: PositionCallback) => {
        ok({ coords: { latitude: 35.8242, longitude: 127.148, accuracy: 5 }, timestamp: Date.now() } as GeolocationPosition);
        return 1;
      },
      clearWatch: vi.fn(),
    },
  });
});
afterEach(() => {
  cleanup();
  vi.mocked(captureEvidenceFrame).mockClear();
});

describe('촬영 배율 — 사진 부분만 키우고 페이지는 확대하지 않는다', () => {
  it('기기 카메라가 배율을 지원하지 않으면 화면 가운데를 키우고, 찍을 때 같은 배율로 잘라 낸다', async () => {
    const video = await open(track());
    fireEvent.click(screen.getByRole('button', { name: '2배' }));
    expect(video.style.transform).toBe('scale(2)');
    expect(screen.getByText(/확대하면 위반 장소가 화면 밖으로 나가기 쉬워요/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /첫 번째 사진/ }));
    expect(vi.mocked(captureEvidenceFrame).mock.calls[0][1]).toMatchObject({ digitalZoom: 2 });
  });

  it('기기 카메라가 배율을 지원하면 카메라 배율을 바꾸고, 사진을 따로 자르지 않는다', async () => {
    const applyConstraints = vi.fn(async () => undefined);
    const video = await open(track({ getCapabilities: () => ({ zoom: { min: 1, max: 10 } }), applyConstraints }));
    fireEvent.click(screen.getByRole('button', { name: '3배' }));
    await act(async () => {});
    expect(applyConstraints).toHaveBeenCalledWith({ advanced: [{ zoom: 3 }] });
    expect(video.style.transform).toBe('');
    fireEvent.click(screen.getByRole('button', { name: /첫 번째 사진/ }));
    expect(vi.mocked(captureEvidenceFrame).mock.calls[0][1]).toMatchObject({ digitalZoom: 1 });
  });

  it('두 손가락으로 벌리면 카메라 배율이 바뀌고 페이지 확대는 막힌다', async () => {
    const video = await open(track());
    fireEvent.touchStart(document, { touches: [{ clientX: 0, clientY: 0 }, { clientX: 100, clientY: 0 }] });
    const notPrevented = fireEvent.touchMove(document, { touches: [{ clientX: 0, clientY: 0 }, { clientX: 160, clientY: 0 }] });
    expect(notPrevented).toBe(false);
    expect(video.style.transform).toBe('scale(1.6)');
    expect(screen.getByText('1.6배')).toBeTruthy();
    expect(fireEvent(document, new Event('gesturestart', { cancelable: true }))).toBe(false);
  });

  it('한 손가락 움직임은 막지 않는다', async () => {
    await open(track());
    expect(fireEvent.touchMove(document, { touches: [{ clientX: 0, clientY: 0 }] })).toBe(true);
  });
});
