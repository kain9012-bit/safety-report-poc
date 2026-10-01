import { describe, expect, it } from 'vitest';
import { distanceMeters, isDecisive, nearest } from './geo';
import { THRESHOLD_METERS } from './rules';

/**
 * 실제 공공데이터가 오기 전에 판정 로직부터 굳혀 둔다.
 * 여기서 걸러야 하는 건 "GPS 오차가 기준 거리를 삼키는 경우"다.
 */

// 전주 시청 앞 어딘가. 좌표 자체에는 의미가 없고, 거리 관계만 본다.
const BASE = { lat: 35.8242, lng: 127.1480 };

/** 북쪽으로 d미터 떨어진 지점 */
function north(d: number) {
  return { lat: BASE.lat + d / 111_320, lng: BASE.lng };
}

describe('거리 계산', () => {
  it('같은 지점은 0m', () => {
    expect(distanceMeters(BASE, BASE)).toBeCloseTo(0, 5);
  });

  it('북쪽 10m는 10m로 나온다', () => {
    expect(distanceMeters(BASE, north(10))).toBeCloseTo(10, 1);
  });

  it('방향이 바뀌어도 거리는 같다', () => {
    expect(distanceMeters(BASE, north(25))).toBeCloseTo(distanceMeters(north(25), BASE), 6);
  });
});

describe('가장 가까운 시설', () => {
  const list = [
    { id: 'a', ...north(40) },
    { id: 'b', ...north(8) },
    { id: 'c', ...north(120) },
  ];

  it('가장 가까운 것을 고른다', () => {
    const hit = nearest(BASE, list);
    expect(hit?.facility.id).toBe('b');
    expect(hit?.distance).toBeCloseTo(8, 1);
  });

  it('후보가 없으면 null — 빈 결과를 0m로 둔갑시키지 않는다', () => {
    expect(nearest(BASE, [])).toBeNull();
  });
});

describe('좌표만으로 확정할 수 있는가', () => {
  const BUS = THRESHOLD_METERS.busstop!; // 10m

  it('정확도가 기준을 넘나들면 확정하지 않는다', () => {
    // 9.5m 지점에 정확도 3m — 실제 위치는 6.5~12.5m 어딘가라 안쪽인지 알 수 없다
    expect(isDecisive(9.5, BUS, 3)).toBe(false);
  });

  it('구간이 통째로 안쪽이면 확정한다', () => {
    expect(isDecisive(6, BUS, 3)).toBe(true);
  });

  it('구간이 통째로 바깥이면 확정한다', () => {
    expect(isDecisive(20, BUS, 5)).toBe(true);
  });

  it('기준 거리 바로 양쪽은 정확도가 좋아야만 갈린다', () => {
    expect(isDecisive(9.5, BUS, 0.4)).toBe(true);
    expect(isDecisive(10.5, BUS, 0.4)).toBe(true);
    expect(isDecisive(9.5, BUS, 1)).toBe(false);
    expect(isDecisive(10.5, BUS, 1)).toBe(false);
  });

  it('정확도를 모르면 언제나 확정 불가 — 모르면 모른다고 한다', () => {
    expect(isDecisive(1, BUS, undefined)).toBe(false);
    expect(isDecisive(999, BUS, undefined)).toBe(false);
  });

  it('흔한 폰 GPS 정확도(8m)로는 기준 근처를 거의 못 가른다', () => {
    // 아주 가깝거나(2m) 아주 멀 때(20m)만 갈린다. 4~16m 구간은 전부 확정 불가다.
    // 이게 이 PoC가 "판정"이 아니라 "추천"을 하는 이유다.
    const decisiveAt = [2, 4, 6, 8, 12, 16, 20].filter((d) => isDecisive(d, BUS, 8));
    expect(decisiveAt).toEqual([2, 20]);
  });
});
