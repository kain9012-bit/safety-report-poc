import { describe, expect, it } from 'vitest';
import { rankStopCandidates, stopKey, stopSelectionInputKey } from './stopCandidates';
import type { Facility } from './geo';
import { evaluateLocation } from './locationQuality';
const origin = { lat: 37, lng: 127, accuracy: 5, role: 'photo' as const };
const stop = (id: string, north: number, publicId = id): Facility => ({ id, name: '동명 정류소', lat: 37 + north / 111_320, lng: 127, source: 'TAGO', regionCode: '1', publicId, publicIdNamespace: 'TAGO:1:nodeno' });
describe('stop selection preserves competing candidates', () => {
  it('photo public number outranks closer stop but does not assert vehicle distance', () => {
    const candidates = rankStopCandidates(origin, [stop('A', 10), stop('B', 40)], { photoEvidence: { photoId: 'p1', publicId: 'B', publicIdNamespace: 'TAGO:1:nodeno', readable: true } });
    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toMatchObject({ facility: { id: 'B' }, numberMatch: 'match', state: 'number_match' });
    expect(candidates[0].reasons.join(' ')).toContain('위반 거리 미확인');
  });
  it('unknown number namespace or blurred digits do not become an ID match', () => {
    expect(rankStopCandidates(origin, [stop('A', 10)], { photoEvidence: { photoId: 'p', publicId: 'A', readable: true } })[0].numberMatch).toBe('text_only');
    expect(rankStopCandidates(origin, [stop('A', 10)], { photoEvidence: { photoId: 'p', publicId: 'A', publicIdNamespace: 'TAGO:1:nodeno', readable: false } })[0].numberMatch).toBe('unknown');
  });
  it('duplicate public numbers are unresolved, provider and region IDs never collide', () => {
    const candidates = rankStopCandidates(origin, [stop('A', 10, '001'), stop('B', -10, '001')], { photoEvidence: { photoId: 'p', publicId: '001', publicIdNamespace: 'TAGO:1:nodeno', readable: true } });
    expect(candidates.every((c) => c.state === 'review')).toBe(true);
    expect(stopKey(stop('A', 10))).not.toBe(stopKey({ ...stop('A', 10), regionCode: '2' }));
  });
  it('usable direction conflicting with ID produces review, but wide GPS does not rank bearings', () => {
    const location = evaluateLocation([1000, 2000, 3000].map((at) => ({ ...origin, observedAt: at, receivedAt: at, source: 'device' as const })), 3000);
    const heading = { capturedAt: 3000, status: 'usable' as const, reasons: [], sample: { bearing: 180, observedAt: 3000, receivedAt: 3000, reference: 'true' as const, accuracy: 5, horizontalMagnitude: 1, source: 'native_camera_axis' as const, facingMode: 'environment' as const } };
    const opts = { location, heading, photoEvidence: { photoId: 'p', publicId: 'A', publicIdNamespace: 'TAGO:1:nodeno', readable: true } };
    expect(rankStopCandidates(origin, [stop('A', 100)], opts)[0].state).toBe('review');
    expect(rankStopCandidates({ ...origin, accuracy: 150 }, [stop('A', 100)], opts)[0].directionDifference).toBeUndefined();
    expect(rankStopCandidates({ ...origin, role: 'manual_vehicle' }, [stop('A', 100)], opts)[0].directionDifference).toBeUndefined();
  });
  it('partial data and multiple same-direction candidates remain visible', () => {
    const ranked = rankStopCandidates(origin, [stop('A', 10), stop('B', 100), stop('C', 300), stop('D', 400)], { incomplete: true });
    expect(ranked).toHaveLength(4); expect(ranked.every((c) => c.reasons.some((r) => r.includes('빠진 후보')))).toBe(true);
  });
});

it('stop selection context survives choosing but requires recheck after new primary/photo evidence', () => {
  const draft = { shots: [{ id: 'p', dataUrl: 'x', takenAt: 1000 }], primaryPair: ['p'] };
  const key = stopSelectionInputKey(draft);
  expect(stopSelectionInputKey({ ...draft, selectedStopId: 's' })).toBe(key);
  expect(stopSelectionInputKey({ ...draft, primaryPair: ['other'] })).not.toBe(key);
  expect(stopSelectionInputKey({ ...draft, vehicleLocation: { lat: 37, lng: 127, source: 'user_map', selectedAt: 2000 } })).not.toBe(key);
});
