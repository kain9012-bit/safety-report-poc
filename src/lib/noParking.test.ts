import { describe, expect, it } from 'vitest';
import { findRegion, inWindow, roadMatches, roadOf, zoneNow, zonesOnRoad } from './noParking';
import type { NoParkingZone, RegionEntry } from './noParking';
import { kstTime } from './kst';

const zone = (o: Partial<NoParkingZone> = {}): NoParkingZone => ({
  road: '번영로234번길',
  desc: '문화낚시할인매장 ~ 동신초교',
  wd: ['08:00', '18:00'],
  wdOk: null,
  sat: ['00:00', '00:00'],
  satOk: null,
  hol: ['00:00', '00:00'],
  holOk: null,
  holFree: false,
  ref: '2025-05-12',
  org: '충청남도 아산시',
  tel: '041-540-2953',
  ...o,
});

// 2026-10-12(월), 10-17(토), 10-18(일)
const MON = (h: number, m = 0) => kstTime(2026, 10, 12, h, m);
const SAT = (h: number) => kstTime(2026, 10, 17, h);
const SUN = (h: number) => kstTime(2026, 10, 18, h);

describe('roadOf — 도로명주소에서 도로명', () => {
  it('붙여 쓴 번길', () => expect(roadOf('충청남도 아산시 번영로234번길 12')).toBe('번영로234번길'));
  it('로', () => expect(roadOf('경기도 양주시 옥정로 123')).toBe('옥정로'));
  it('띄어 쓴 번길도 붙인다', () => expect(roadOf('경기도 여주시 세종로 79번길 10')).toBe('세종로79번길'));
  it('건물번호에 부번', () => expect(roadOf('서울특별시 중구 세종대로 110-1')).toBe('세종대로'));
  it('지번주소는 모름', () => expect(roadOf('경기도 양주시 옥정동 935')).toBeUndefined());
});

describe('roadMatches — 같은 도로만', () => {
  it('그대로 같으면', () => expect(roadMatches('태평로', '태평로')).toBe(true));
  it('구간 표기 안의 도로', () => expect(roadMatches('세종로 45번길~세종로79번길', '세종로79번길')).toBe(true));
  it('큰길 이름이 번길에 걸리지 않음', () => expect(roadMatches('세종로 45번길~세종로79번길', '세종로')).toBe(false));
  it('앞 글자가 붙은 다른 도로는 아님', () => expect(roadMatches('신세종로', '세종로')).toBe(false));
  it('빈 도로명은 아님', () => expect(roadMatches('태평로', '')).toBe(false));
  it('목록에서 고르기', () =>
    expect(zonesOnRoad([zone(), zone({ road: '태평로' })], '태평로').map((z) => z.road)).toEqual(['태평로']));
});

describe('findRegion — 시도·시군구', () => {
  const regions: RegionEntry[] = [
    { code: '41630', sido: '경기도', sigungu: '양주시', count: 267 },
    { code: '41360', sido: '경기도', sigungu: '남양주시', count: 404 },
    { code: '11140', sido: '서울특별시', sigungu: '중구', count: 10 },
    { code: '26110', sido: '부산광역시', sigungu: '중구', count: 5 },
    { code: '46110', sido: '전남광주통합특별시', sigungu: '목포시', count: 3 },
  ];
  it('양주시와 남양주시를 가린다', () => expect(findRegion('경기도 양주시 옥정로 123', regions)?.code).toBe('41630'));
  it('같은 이름의 구는 시도로 가린다', () => expect(findRegion('부산광역시 중구 중앙대로 1', regions)?.code).toBe('26110'));
  it('바뀐 시도 이름도 맞춘다', () => expect(findRegion('전라남도 목포시 영산로 1', regions)?.code).toBe('46110'));
  it('자료에 없는 시군구', () => expect(findRegion('전북특별자치도 전주시 완산구 노송광장로 10', regions)).toBeUndefined());
});

describe('inWindow', () => {
  it('보통 시간대', () => {
    expect(inWindow(['08:00', '18:00'], 8 * 60)).toBe(true);
    expect(inWindow(['08:00', '18:00'], 18 * 60)).toBe(false);
  });
  it('자정을 넘는 시간대', () => expect(inWindow(['21:00', '09:00'], 23 * 60)).toBe(true));
  it('23:59는 자정까지', () => expect(inWindow(['00:00', '23:59'], 23 * 60 + 59)).toBe(true));
  it('시작=끝은 빈 시간대', () => expect(inWindow(['00:00', '00:00'], 10 * 60)).toBe(false));
});

describe('zoneNow — 지금 단속 시간인가(한국 시각)', () => {
  it('평일 단속 시간 안', () => expect(zoneNow(zone(), MON(10)).enforced).toBe(true));
  it('평일 단속 시간 밖', () => expect(zoneNow(zone(), MON(19)).enforced).toBe(false));
  it('점심 허용 시간은 단속 아님', () => {
    const z = zone({ wd: ['07:00', '21:00'], wdOk: ['11:30', '14:00'] });
    expect(zoneNow(z, MON(12)).enforced).toBe(false);
    expect(zoneNow(z, MON(12)).schedule).toBe('평일 07:00~21:00(11:30~14:00 허용)');
  });
  it('토요일 00:00~00:00은 단속 시간 없음', () => {
    const n = zoneNow(zone(), SAT(10));
    expect(n.enforced).toBe(false);
    expect(n.day).toBe('sat');
  });
  it('일요일은 공휴일 칸, 공휴일 허용이면 단속 아님', () => {
    const n = zoneNow(zone({ hol: ['00:00', '23:59'], holFree: true }), SUN(10));
    expect(n.enforced).toBe(false);
    expect(n.schedule).toBe('일요일·공휴일 주정차 허용');
  });
  it('24시간 구간', () => expect(zoneNow(zone({ hol: ['00:00', '23:59'] }), SUN(3)).enforced).toBe(true));
  it('시간 정보가 없으면 모름', () => expect(zoneNow(zone({ wd: null }), MON(10)).enforced).toBeNull());
});
