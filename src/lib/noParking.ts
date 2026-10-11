/**
 * 주정차금지(지정)구역 — **참고 안내용** 규칙. 판정(수용·불수용, 유형)에는 쓰지 않는다.
 *
 * 자료: 공공데이터포털 전국주정차금지(지정)구역표준데이터(scripts/collect_noparking.py → public/noparking/).
 * 이 자료에는 좌표가 없고 도로명·구간 설명뿐이다. 그래서 휴대폰 위치의 **도로명주소**와
 * 같은 시군구·같은 도로명인 구간을 찾는다. 같은 도로라도 구간 밖일 수 있고, 자료가 낡았을 수 있다.
 * 화면에는 언제나 '참고'와 기준일을 함께 적는다.
 *
 * 시각은 한국 시각(kst.ts)으로 따진다. 공휴일 목록은 없으므로 **일요일만** 공휴일 칸으로 본다.
 */
import { kstParts } from './kst';

/** 'HH:MM' 두 개 — 시작·끝. 끝이 시작보다 이르면 자정을 넘는 구간 */
export type Window = [string, string];

export interface NoParkingZone {
  /** 도로명(예: '번영로234번길', '세종로 45번길~세종로79번길') */
  road: string;
  /** 구간 설명(예: '인터파크호텔 ~ 이화약국') */
  desc: string;
  /** 평일 금지 시간 */
  wd: Window | null;
  /** 평일 허용 시간(점심 유예 등) */
  wdOk: Window | null;
  sat: Window | null;
  satOk: Window | null;
  /** 일요일·공휴일 */
  hol: Window | null;
  holOk: Window | null;
  /** 공휴일 주정차 허용 */
  holFree: boolean;
  /** 데이터 기준일 YYYY-MM-DD */
  ref: string;
  org: string;
  tel: string;
}

export interface RegionEntry {
  code: string;
  sido: string;
  sigungu: string;
  count: number;
}

/** 시도 이름의 다른 표기 — 주소와 자료의 시도 이름이 바뀌었거나 줄여 쓴 경우 */
const SIDO_ALIASES: [RegExp, string[]][] = [
  [/^서울/, ['서울']],
  [/^부산/, ['부산']],
  [/^대구/, ['대구']],
  [/^인천/, ['인천']],
  [/^광주/, ['광주']],
  [/^대전/, ['대전']],
  [/^울산/, ['울산']],
  [/^세종/, ['세종']],
  [/^경기/, ['경기']],
  [/^강원/, ['강원']],
  [/^(충청북|충북)/, ['충청북', '충북']],
  [/^(충청남|충남)/, ['충청남', '충남']],
  [/^(전라북|전북)/, ['전라북', '전북']],
  [/^(전라남|전남)/, ['전라남', '전남', '광주']],
  [/^(경상북|경북)/, ['경상북', '경북']],
  [/^(경상남|경남)/, ['경상남', '경남']],
  [/^제주/, ['제주']],
];

function sidoKeys(sido: string): string[] {
  const hit = SIDO_ALIASES.find(([re]) => re.test(sido));
  return hit ? hit[1] : [sido.slice(0, 2)];
}

/** 주소 → 자료의 시군구. 시군구 이름이 주소에 있고, 시도 이름(다른 표기 포함)이 주소 앞에 맞아야 한다. */
export function findRegion(address: string, regions: RegionEntry[]): RegionEntry | undefined {
  const a = ` ${address.trim().replace(/\s+/g, ' ')} `;
  const head = a.trim().split(' ')[0] ?? '';
  return regions
    .filter((r) => a.includes(` ${r.sigungu} `))
    .filter((r) => sidoKeys(r.sido).some((k) => head.startsWith(k)) || sidoKeys(head).some((k) => r.sido.startsWith(k)))
    .sort((x, y) => y.sigungu.length - x.sigungu.length)[0];
}

/** 도로명주소에서 도로명만: '경기도 양주시 옥정로 123' → '옥정로', '… 세종로79번길 10' → '세종로79번길' */
export function roadOf(address: string): string | undefined {
  const t = address.trim().split(/\s+/);
  for (let i = t.length - 1; i > 0; i--) {
    if (/^\d+(-\d+)?$/.test(t[i]) && /(로|길)$/.test(t[i - 1])) {
      // '세종로 79번길 10'처럼 띄어 쓴 경우도 붙인다
      if (/^\d+번?길$/.test(t[i - 1]) && i > 1 && /(로|길)$/.test(t[i - 2])) return t[i - 2] + t[i - 1];
      return t[i - 1];
    }
  }
  return undefined;
}

/** 구간의 도로명 칸에 그 도로가 들어 있나. '세종로'가 '세종로45번길'에 걸리지 않게 뒤 글자를 본다. */
export function roadMatches(zoneRoad: string, road: string): boolean {
  const z = zoneRoad.replace(/\s+/g, '');
  const r = road.replace(/\s+/g, '');
  if (!r) return false;
  let i = z.indexOf(r);
  while (i >= 0) {
    const next = z[i + r.length];
    const prev = z[i - 1];
    const okNext = next === undefined || !/[0-9번가-힣]/.test(next) || next === '~';
    const okPrev = prev === undefined || !/[가-힣0-9]/.test(prev);
    if (okNext && okPrev) return true;
    i = z.indexOf(r, i + 1);
  }
  return false;
}

export function zonesOnRoad(zones: NoParkingZone[], road: string): NoParkingZone[] {
  return zones.filter((z) => roadMatches(z.road, road));
}

const mins = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/** 그 시각이 시간대 안인가. 끝이 23:59면 자정까지로 본다. 시작=끝이면 비어 있는 시간대. */
export function inWindow(w: Window | null, minute: number): boolean {
  if (!w) return false;
  const a = mins(w[0]);
  let b = mins(w[1]);
  if (b === 23 * 60 + 59) b = 24 * 60;
  if (a === b) return false;
  return a < b ? minute >= a && minute < b : minute >= a || minute < b;
}

export type DayKind = 'weekday' | 'sat' | 'holiday';

export interface ZoneNow {
  day: DayKind;
  /** 지금 단속 시간이면 true, 아니면 false, 그 요일 시간 정보가 없으면 null */
  enforced: boolean | null;
  /** 화면에 쓰는 그 요일 시간 설명 */
  schedule: string;
}

const DAY_LABEL: Record<DayKind, string> = { weekday: '평일', sat: '토요일', holiday: '일요일·공휴일' };

function fmt(w: Window): string {
  return `${w[0]}~${w[1] === '23:59' ? '24:00' : w[1]}`;
}

/** 지금(한국 시각) 그 구간이 단속 시간인가 */
export function zoneNow(z: NoParkingZone, ms: number): ZoneNow {
  const t = kstParts(ms);
  const day: DayKind = t.weekday === 0 ? 'holiday' : t.weekday === 6 ? 'sat' : 'weekday';
  const minute = t.hour * 60 + t.minute;
  const [w, ok] = day === 'weekday' ? [z.wd, z.wdOk] : day === 'sat' ? [z.sat, z.satOk] : [z.hol, z.holOk];
  const label = DAY_LABEL[day];
  if (day === 'holiday' && z.holFree) return { day, enforced: false, schedule: `${label} 주정차 허용` };
  if (!w) return { day, enforced: null, schedule: `${label} 시간 정보 없음` };
  if (mins(w[0]) === mins(w[1])) return { day, enforced: false, schedule: `${label} 단속 시간 없음(자료 기준)` };
  const okText = ok && mins(ok[0]) !== mins(ok[1]) ? `(${fmt(ok)} 허용)` : '';
  const enforced = inWindow(w, minute) && !inWindow(ok, minute);
  return { day, enforced, schedule: `${label} ${fmt(w)}${okText}` };
}
