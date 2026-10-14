import { describe, expect, it } from 'vitest';
import { createLocationTracker, evaluateLocation, locationSample } from './locationQuality';
import type { LocationSample } from './locationQuality';
const sample = (at: number, accuracy: number | undefined = 10, lat = 37): LocationSample => ({ lat, lng: 127, accuracy, observedAt: at, receivedAt: at, source: 'device' });
const g = (at: number, lat = 37, accuracy = 10) => ({ coords: { latitude: lat, longitude: 127, accuracy }, timestamp: at }) as GeolocationPosition;
describe('GPS observations belong to a shutter instant', () => {
  it('separates fresh observations, broad error, unknown error, and staleness at policy boundaries', () => {
    expect(evaluateLocation([sample(1000), sample(2000), sample(3000)], 8000).quality.status).toBe('nearby');
    expect(evaluateLocation([sample(3000)], 8001).quality.status).toBe('stale');
    expect(evaluateLocation([sample(3000, 20)], 3000).quality.status).toBe('checking');
    expect(evaluateLocation([sample(3000, 20.01)], 3000).quality.status).toBe('broad');
    expect(evaluateLocation([sample(3000, 50)], 3000).quality.status).toBe('broad');
    expect(evaluateLocation([sample(3000, 50.01)], 3000).quality.status).toBe('needs_map');
    expect(evaluateLocation([{ ...sample(3000), accuracy: undefined }], 3000).quality.status).toBe('needs_map');
  });
  it('duplicate timestamps do not inflate consistency evidence', () => {
    const tracker = createLocationTracker();
    for (let i = 0; i < 30; i++) tracker.ingest(g(1000), 1000 + i);
    expect(tracker.snapshot(1100).quality).toMatchObject({ sampleCount: 1, consistency: 'checking' });
  });
  it('a sudden jump stays uncertain even with three fresh timestamps', () => {
    const q = evaluateLocation([sample(1000), sample(2000), sample(3000, 10, 38)], 3000).quality;
    expect(q).toMatchObject({ status: 'needs_map', consistency: 'inconsistent' });
  });
  it('large circles may agree but still require map confirmation', () => {
    expect(evaluateLocation([sample(1000, 500), sample(2000, 500), sample(3000, 500)], 3000).quality).toMatchObject({ status: 'needs_map', consistency: 'consistent' });
  });
  it('filters late observations and creates isolated snapshots', () => {
    const tracker = createLocationTracker(); tracker.ingest(g(1000), 1000);
    const captured = tracker.snapshot(1000);
    tracker.ingest(g(1100, 38), 1200);
    expect(captured.sample?.lat).toBe(37);
    expect(tracker.snapshot(1150).sample?.lat).toBe(37);
    const changed = tracker.snapshot(1300); changed.sample!.lat = 35;
    expect(tracker.snapshot(1300).sample?.lat).toBe(38);
  });
  it('unknown/invalid accuracy is not zero; invalid coordinates/future timestamps are rejected', () => {
    expect(locationSample(g(1000, 37, NaN), 1000)?.accuracy).toBeUndefined();
    expect(locationSample(g(1000, 137), 1000)).toBeUndefined();
    expect(locationSample(g(1001), 1000)).toBeUndefined();
    expect(evaluateLocation([], 1000, 'denied').quality).toMatchObject({ status: 'unavailable', issue: 'denied' });
  });
  it('bounds the distinct history to 20 without fabricating samples', () => {
    const tracker = createLocationTracker(); for (let i = 1; i <= 100; i++) tracker.ingest(g(i * 100), i * 100);
    expect(tracker.snapshot(10000).quality.sampleCount).toBe(20);
    expect(tracker.snapshot(30000).quality.sampleCount).toBe(0);
    expect(tracker.snapshot(30000).sample?.observedAt).toBe(10000);
  });
});
