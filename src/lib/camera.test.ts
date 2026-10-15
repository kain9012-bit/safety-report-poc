// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureEvidenceFrame } from './camera';
afterEach(() => vi.restoreAllMocks());
describe('preserved camera frame', () => {
  it('draws exactly one frame then serializes the original before stamping a separate display copy', () => {
    const actions: string[] = [];
    const ctx = { drawImage: vi.fn(() => actions.push('frame')), measureText: () => ({ width: 20 }), fillRect: () => actions.push('stamp-background'), fillText: () => actions.push('stamp-text') };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(() => { actions.push('serialize'); return `data:${actions.length}`; });
    const video = { videoWidth: 1920, videoHeight: 1080, readyState: 2 } as HTMLVideoElement;
    const result = captureEvidenceFrame(video, { takenAt: 1000 });
    expect(ctx.drawImage).toHaveBeenCalledTimes(1);
    expect(actions.slice(0, 3)).toEqual(['frame', 'serialize', 'stamp-background']);
    expect(result.originalDataUrl).not.toBe(result.dataUrl);
  });
  it('does not produce an empty original before the video is ready', () => {
    expect(() => captureEvidenceFrame({ videoWidth: 0, videoHeight: 0, readyState: 0 } as HTMLVideoElement, { takenAt: 1000 })).toThrow('준비');
  });
});
