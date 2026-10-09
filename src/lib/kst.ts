/**
 * 한국 표준시(KST, UTC+9, 일광절약시간 없음).
 *
 * 접수 기한(촬영 익일 자정)·단속 시간(평일 08~20시)·사진에 새기는 촬영시각은 **한국 시각**으로 따진다.
 * 기기·서버·CI의 시간대가 달라도 같은 답이 나와야 하므로 `Date#getHours()` 같은 현지 시각 함수를 쓰지 않는다.
 */
export const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export interface KstParts {
  year: number;
  /** 1~12 */
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0=일요일 … 6=토요일 */
  weekday: number;
}

export function kstParts(ms: number): KstParts {
  const d = new Date(ms + KST_OFFSET_MS);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
    weekday: d.getUTCDay(),
  };
}

/** 한국 시각으로 적은 날짜·시각 → 밀리초. 날짜가 넘치면(32일 등) 다음 달로 넘어간다. */
export function kstTime(year: number, month: number, day: number, hour = 0, minute = 0, second = 0, ms = 0): number {
  return Date.UTC(year, month - 1, day, hour, minute, second, ms) - KST_OFFSET_MS;
}

const p2 = (n: number) => String(n).padStart(2, '0');

/** 2026-10-02 14:28:05 */
export function kstStamp(ms: number): string {
  const t = kstParts(ms);
  return `${t.year}-${p2(t.month)}-${p2(t.day)} ${p2(t.hour)}:${p2(t.minute)}:${p2(t.second)}`;
}

/** 10/2 14:28 */
export function kstShort(ms: number): string {
  const t = kstParts(ms);
  return `${t.month}/${t.day} ${p2(t.hour)}:${p2(t.minute)}`;
}
