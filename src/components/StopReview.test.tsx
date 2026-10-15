// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { StopReview } from './StopReview';
import type { DraftReport, Shot } from '../types/report';
import type { PhotoRead } from '../../api/vision';
import { stopKey, stopSelectionInputKey } from '../lib/stopCandidates';
const mocked = vi.hoisted(() => ({ nearby: vi.fn(), rank: vi.fn() }));
vi.mock('../lib/facilities', () => ({ loadNearby: mocked.nearby }));
vi.mock('../lib/stopCandidates', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/stopCandidates')>();
  return { ...original, rankStopCandidates: (...args: Parameters<typeof original.rankStopCandidates>) => { mocked.rank(...args); return original.rankStopCandidates(...args); } };
});
const stop = { id: 'stop', name: '시청 정류소', source: 'TAGO', lat: 38, lng: 128 };
const shot = (id: string, lat: number, lng: number): Shot => ({ id, lat, lng, takenAt: 1000, dataUrl: id });
const read = (id: string, publicId = '001'): PhotoRead => ({ photoId: id, observations: [{ type: 'busstop', identity: 'yes', markingToTarget: 'yes', vehicleRelation: 'yes', unknownReasons: [], busStop: { publicId, name: '시청 정류소', readable: true } }] }) as unknown as PhotoRead;
beforeEach(() => { vi.clearAllMocks(); mocked.nearby.mockResolvedValue({ busstops: [stop], crosswalks: [], schools: [], state: 'ok', missing: [] }); });
afterEach(cleanup);
describe('stop review source photograph', () => {
  it('uses new primary coordinates instead of preserved old retake photo', async () => {
    const old = shot('old', 35, 125), current = shot('current', 38, 128);
    render(<StopReview draft={{ shots: [old, current], primaryPair: ['current'] }} onChange={vi.fn()} />);
    await waitFor(() => expect(mocked.nearby).toHaveBeenCalledWith({ lat: 38, lng: 128 }));
  });
  it('uses the exact number photograph GPS and heading, not first photo heading', async () => {
    const a = { ...shot('a', 35, 125), heading: { capturedAt: 1000, status: 'unknown' as const, reasons: ['a'] } };
    const b = { ...shot('b', 38, 128), heading: { capturedAt: 1000, status: 'unknown' as const, reasons: ['b'] } };
    render(<StopReview draft={{ shots: [a, b], primaryPair: ['a', 'b'], reads: [null, read('b')] }} onChange={vi.fn()} />);
    await waitFor(() => expect(mocked.rank).toHaveBeenCalled());
    expect(mocked.rank.mock.calls.at(-1)![0]).toMatchObject({ lat: 38, lng: 128 });
    expect(mocked.rank.mock.calls.at(-1)![2].heading).toEqual(b.heading);
    expect(screen.getByText(/사진 2에서 읽은 번호/)).toBeTruthy();
  });
  it('unlinked retained supplemental number is not automatically matched', async () => {
    render(<StopReview draft={{ shots: [shot('old', 35, 125), shot('active', 38, 128)], primaryPair: ['active'], reads: [read('old'), null] }} onChange={vi.fn()} />);
    await waitFor(() => expect(mocked.rank).toHaveBeenCalled());
    expect(mocked.rank.mock.calls.at(-1)![2].photoEvidence).toBeUndefined();
    expect(screen.getByText(/연결되지 않은 보완사진/)).toBeTruthy();
  });
  it('keeps saved candidate visible but flags changed primary context', async () => {
    const base: DraftReport = { shots: [shot('a', 38, 128)], primaryPair: ['a'] };
    const draft: DraftReport = { ...base, evidenceRevision: 2, selectedStopId: stopKey(stop), stopSelection: { key: stopKey(stop), facility: stop, source: 'user', selectedAt: 1000, distanceStatus: 'unverified', inputKey: stopSelectionInputKey(base) } };
    render(<StopReview draft={draft} onChange={vi.fn()} />);
    await waitFor(() => expect(mocked.rank).toHaveBeenCalled());
    expect(screen.getByText(/고른 후보:.*재확인 필요/)).toBeTruthy();
  });
});
