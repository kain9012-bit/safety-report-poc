import { describe, expect, it } from 'vitest';
import { kstParts, kstShort, kstStamp, kstTime } from './kst';

describe('한국 시각 — 기기 시간대와 상관없이', () => {
  it('UTC 15시는 한국 다음 날 0시', () => {
    expect(kstParts(Date.UTC(2026, 9, 1, 15, 0, 0))).toMatchObject({ year: 2026, month: 10, day: 2, hour: 0, weekday: 5 });
  });
  it('kstTime 은 kstParts 의 역', () => {
    const ms = kstTime(2026, 10, 2, 14, 28, 5);
    expect(kstStamp(ms)).toBe('2026-10-02 14:28:05');
    expect(kstShort(ms)).toBe('10/2 14:28');
  });
  it('날짜가 넘치면 다음 달로', () => {
    expect(kstStamp(kstTime(2026, 10, 32, 0, 0, 0))).toBe('2026-11-01 00:00:00');
  });
});
