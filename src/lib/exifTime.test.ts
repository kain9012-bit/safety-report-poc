import { describe, expect, it } from 'vitest';
import { offsetMs, parseExifInstant } from './exifTime';
import { kstStamp } from './kst';

describe('EXIF 촬영시각 — 시간대가 없는 기록 읽기', () => {
  it('시간대 기록이 없으면 한국 시각으로 가정하고 그 사실을 남긴다', () => {
    const r = parseExifInstant('2026:09:19 14:30:00')!;
    expect(kstStamp(r.at)).toBe('2026-09-19 14:30:00');
    expect(r.assumedKst).toBe(true);
  });
  it('OffsetTimeOriginal 이 있으면 그것을 쓴다', () => {
    const r = parseExifInstant('2026:09:19 14:30:00', '+00:00')!;
    expect(kstStamp(r.at)).toBe('2026-09-19 23:30:00');
    expect(r.assumedKst).toBe(false);
  });
  it('달력에 없는 날짜·형식이 다른 값은 버린다', () => {
    expect(parseExifInstant('2026:13:01 10:00:00')).toBeNull();
    expect(parseExifInstant('2026:02:30 10:00:00')).toBeNull();
    expect(parseExifInstant('어제')).toBeNull();
    expect(parseExifInstant(undefined)).toBeNull();
  });
  it('말이 안 되는 시간대는 없는 것으로 본다', () => {
    expect(offsetMs('+15:00')).toBeNull();
    expect(offsetMs('-05:30')).toBe(-(5 * 60 + 30) * 60_000);
  });
});
