// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import PickMap from './PickMap';
import type { CaptureLocationSnapshot } from '../lib/locationQuality';
const state = vi.hoisted(() => ({
  onDrag: undefined as (() => void) | undefined,
  onCenter: undefined as ((p: { lat: number; lng: number }) => void) | undefined,
  center: vi.fn(), marks: vi.fn(), destroy: vi.fn(), request: vi.fn(),
}));
vi.mock('../lib/mapProvider', () => ({ createMapController: vi.fn(async (_el, _origin, onCenter, onDrag) => {
  state.onDrag = onDrag; state.onCenter = onCenter;
  return { provider: 'vworld', center: state.center, marks: state.marks, destroy: state.destroy, zoomIn: vi.fn(), zoomOut: vi.fn(), layer: vi.fn() };
}) }));
vi.mock('../lib/locationQuality', async (importOriginal) => ({ ...(await importOriginal<typeof import('../lib/locationQuality')>()), requestCurrentLocation: state.request }));
const origin = { lat: 37, lng: 127 };
const located: CaptureLocationSnapshot = { capturedAt: 1000, sample: { lat: 38, lng: 128, accuracy: 18, observedAt: 1000, receivedAt: 1000, source: 'device' }, quality: { status: 'checking', consistency: 'checking', sampleCount: 1, reasons: [] } };
beforeEach(() => { vi.clearAllMocks(); });
afterEach(cleanup);
describe('map draft position and current position', () => {
  it('keeps unknown photo accuracy absent and distinguishes search origins', async () => {
    render(<PickMap origin={origin} originRole="search" onCenter={vi.fn()} />);
    await waitFor(() => expect(state.marks).toHaveBeenCalled());
    const mark = state.marks.mock.calls.at(-1)![0][0];
    expect(mark).toMatchObject({ label: '탐색 시작 위치' }); expect(mark.accuracy).toBeUndefined();
    expect(screen.getByRole('button', { name: '시작 위치 보기' })).toBeTruthy();
  });
  it('does not pull a user-dragged map back when current-location response arrives late', async () => {
    let finish!: (result: CaptureLocationSnapshot) => void;
    state.request.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const onCenter = vi.fn(); render(<PickMap origin={origin} onCenter={onCenter} />);
    await waitFor(() => expect(state.onDrag).toBeTypeOf('function'));
    fireEvent.click(screen.getByRole('button', { name: '현재 위치 다시 찾기' }));
    act(() => state.onDrag?.());
    await act(async () => { finish(located); });
    expect(state.center).not.toHaveBeenCalled();
    expect(onCenter).not.toHaveBeenCalled();
    expect(state.marks.mock.calls.at(-1)![0].some((m: { label: string }) => m.label === '현재 기기 위치')).toBe(true);
  });
  it('an explicit successful reacquire can move draft center but does not rewrite the photo origin', async () => {
    state.request.mockResolvedValue(located);
    render(<PickMap origin={origin} onCenter={vi.fn()} />);
    await waitFor(() => expect(state.marks).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: '현재 위치 다시 찾기' }));
    await waitFor(() => expect(state.center).toHaveBeenCalledWith(located.sample));
    fireEvent.click(screen.getByRole('button', { name: '촬영 위치 보기' }));
    expect(state.center).toHaveBeenLastCalledWith(origin);
  });
  it('ignores a current-location response after close and removes the map', async () => {
    let finish!: (result: CaptureLocationSnapshot) => void;
    state.request.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const view = render(<PickMap origin={origin} onCenter={vi.fn()} />);
    await waitFor(() => expect(state.marks).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: '현재 위치 다시 찾기' })); view.unmount();
    await act(async () => { finish(located); });
    expect(state.center).not.toHaveBeenCalled(); expect(state.destroy).toHaveBeenCalledTimes(1);
  });
  it('StrictMode setup cleanup does not create two simultaneous maps', async () => {
    render(<StrictMode><PickMap origin={origin} onCenter={vi.fn()} /></StrictMode>);
    await waitFor(() => expect(state.marks).toHaveBeenCalled());
    expect(state.destroy).not.toHaveBeenCalled();
  });
});
