import { describe, expect, it } from 'vitest';
import { bearingDifference, projectCameraAxis, snapshotHeading } from './heading';
import type { HeadingSample } from './heading';
const sample = (bearing = 0, at = 1000): HeadingSample => ({ bearing, observedAt: at, receivedAt: at, horizontalMagnitude: 1, reference: 'true', accuracy: 5, source: 'native_camera_axis', facingMode: 'environment' });
describe('camera axis and direction quality', () => {
  it('projects north/east/south/west rear axes rather than screen-top direction', () => {
    expect(projectCameraAxis(0, 90, 0).bearing).toBeCloseTo(0);
    expect(projectCameraAxis(270, 90, 0).bearing).toBeCloseTo(90);
    expect(projectCameraAxis(180, 90, 0).bearing).toBeCloseTo(180);
    expect(projectCameraAxis(90, 90, 0).bearing).toBeCloseTo(270);
    expect(projectCameraAxis(270, 0, 90).bearing).toBeCloseTo(0); // same scene in landscape
    expect(projectCameraAxis(0, 90, 0, 'user').bearing).toBeCloseTo(180);
  });
  it('does not invent a horizontal bearing when pointing at sky/ground or camera unknown', () => {
    expect(projectCameraAxis(0, 0, 0).bearing).toBeUndefined();
    expect(projectCameraAxis(0, 90, 0, 'unknown').bearing).toBeUndefined();
  });
  it('wraps 359°/1° and rejects rapid turns, missing accuracy, magnetic or unknown north', () => {
    expect(bearingDifference(359, 1)).toBe(2);
    expect(snapshotHeading([sample(359, 900), sample(1)], 1000).status).toBe('usable');
    expect(snapshotHeading([sample(0, 900), sample(90)], 1000).status).toBe('unstable');
    for (const changes of [{ accuracy: undefined }, { reference: 'magnetic' as const }, { reference: 'unknown' as const }]) expect(snapshotHeading([{ ...sample(), ...changes }], 1000).status).toBe('unknown');
  });
  it('does not backfill late headings or mutate a capture with future device turns', () => {
    const source = sample(10); const snap = snapshotHeading([source], 1000); source.bearing = 90;
    expect(snap.sample?.bearing).toBe(10);
    expect(snapshotHeading([{ ...sample(), receivedAt: 1001 }], 1000).sample).toBeUndefined();
    expect(snapshotHeading([sample()], 2001).status).toBe('stale');
    expect(snapshotHeading([], 1000, 'denied').status).toBe('denied');
  });
});
