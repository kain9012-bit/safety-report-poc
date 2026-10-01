import { describe, expect, it } from 'vitest';
import {
  blocksSubmit,
  intervalSeconds,
  isExpired,
  isValidPlate,
  INTERVAL_SEC,
  MIN_INTERVAL_SEC,
  runChecks,
  submitDeadline,
} from './rules';

const AT = (iso: string) => new Date(iso).getTime();

describe('접수 기한', () => {
  it('촬영 익일 자정까지다', () => {
    const taken = AT('2026-09-18T14:30:00+09:00');
    expect(new Date(submitDeadline(taken)).toISOString()).toBe(
      new Date(AT('2026-09-19T23:59:59.999+09:00')).toISOString(),
    );
  });

  it('익일 자정 직전은 아직 살아 있다', () => {
    const taken = AT('2026-09-18T14:30:00+09:00');
    expect(isExpired(taken, AT('2026-09-19T23:59:00+09:00'))).toBe(false);
  });

  it('이틀 뒤는 죽는다', () => {
    const taken = AT('2026-09-18T14:30:00+09:00');
    expect(isExpired(taken, AT('2026-09-20T00:00:30+09:00'))).toBe(true);
  });
});

describe('두 컷 간격', () => {
  it('순서가 뒤바뀌어도 절댓값으로 본다', () => {
    expect(intervalSeconds(1000, 62_000)).toBe(61);
    expect(intervalSeconds(62_000, 1000)).toBe(61);
  });

  it('59초는 막고 60초는 통과시킨다', () => {
    const base = AT('2026-09-18T14:30:00+09:00');
    const fail = runChecks({
      shotTimes: [base, base + 59_000],
      hasTimestampOverlay: true,
      plate: '12가3456',
      lat: 35.8,
      lng: 127.1,
      accuracy: 8,
      now: base + 60_000,
    }, MIN_INTERVAL_SEC);
    expect(fail.find((c) => c.id === 'interval')?.status).toBe('fail');
    expect(blocksSubmit(fail)).toBe(true);

    const pass = runChecks({
      shotTimes: [base, base + 60_000],
      hasTimestampOverlay: true,
      plate: '12가3456',
      lat: 35.8,
      lng: 127.1,
      accuracy: 8,
      now: base + 61_000,
    }, MIN_INTERVAL_SEC);
    expect(pass.find((c) => c.id === 'interval')?.status).toBe('pass');
    expect(blocksSubmit(pass)).toBe(false);
  });

  it('테스트 중에는 INTERVAL_SEC(3초) 기준으로 보고, 그 사실을 적는다', () => {
    const base = AT('2026-09-18T14:30:00+09:00');
    const at = (gap: number) =>
      runChecks({ shotTimes: [base, base + gap * 1000], hasTimestampOverlay: true, plate: '12가3456', lat: 35.8, lng: 127.1, accuracy: 8, now: base + 70_000 })
        .find((c) => c.id === 'interval')!;
    expect(at(INTERVAL_SEC - 1).status).toBe('fail');
    expect(at(INTERVAL_SEC).status).toBe('pass');
    if (INTERVAL_SEC < MIN_INTERVAL_SEC) expect(at(INTERVAL_SEC).detail).toContain('테스트용');
  });
});

describe('차량번호 형식', () => {
  it('흔한 형식을 받는다', () => {
    expect(isValidPlate('12가3456')).toBe(true);
    expect(isValidPlate('123가4567')).toBe(true);
    expect(isValidPlate('서울12가3456')).toBe(true);
    expect(isValidPlate(' 12가 3456 ')).toBe(true);
  });

  it('판독이 흘린 값은 걸러낸다', () => {
    expect(isValidPlate('12가345')).toBe(false);
    expect(isValidPlate('ABC1234')).toBe(false);
    expect(isValidPlate('')).toBe(false);
  });

  it('형식이 어긋나면 막지는 않고 경고한다 — 사람이 고칠 몫이다', () => {
    const base = AT('2026-09-18T14:30:00+09:00');
    const checks = runChecks({
      shotTimes: [base, base + 61_000],
      hasTimestampOverlay: true,
      plate: '12가345',
      lat: 35.8,
      lng: 127.1,
      accuracy: 8,
      now: base + 62_000,
    });
    expect(checks.find((c) => c.id === 'plate')?.status).toBe('warn');
    expect(blocksSubmit(checks)).toBe(false);
  });
});

describe('위치', () => {
  it('좌표가 없으면 막는다', () => {
    const base = AT('2026-09-18T14:30:00+09:00');
    const checks = runChecks({
      shotTimes: [base, base + 61_000],
      hasTimestampOverlay: true,
      plate: '12가3456',
      now: base + 62_000,
    });
    expect(checks.find((c) => c.id === 'location')?.status).toBe('fail');
  });

  it('정확도가 나쁘면 알리되 막지 않는다', () => {
    const base = AT('2026-09-18T14:30:00+09:00');
    const checks = runChecks({
      shotTimes: [base, base + 61_000],
      hasTimestampOverlay: true,
      plate: '12가3456',
      lat: 35.8,
      lng: 127.1,
      accuracy: 45,
      now: base + 62_000,
    });
    expect(checks.find((c) => c.id === 'location')?.status).toBe('warn');
    expect(blocksSubmit(checks)).toBe(false);
  });
});
