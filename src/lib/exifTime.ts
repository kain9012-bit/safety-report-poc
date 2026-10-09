/**
 * 사진 파일(EXIF)의 촬영시각을 절대 시각으로 읽는다.
 *
 * **EXIF `DateTimeOriginal`에는 시간대가 없다**("2026:09:19 14:30:00"이 전부다).
 * 이를 기기 현지 시각으로 읽으면 시간대가 다른 기기·서버에서 몇 시간씩 어긋나 접수 기한 판정이 틀린다.
 * `OffsetTimeOriginal`("+09:00")이 있으면 그것을 쓰고, 없으면 **한국 시각으로 가정**한다.
 * 가정했다는 사실(assumedKst)은 화면에 드러낸다.
 * (팀원 저장소 kjy-arch/parking-report 의 exif-time 처리를 따랐다.)
 */
import { KST_OFFSET_MS } from './kst';

export interface ExifInstant {
  at: number;
  /** 시간대 기록이 없어 한국 시각으로 가정했다 */
  assumedKst: boolean;
}

const DATETIME = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/;
const OFFSET = /^([+-])(\d{2}):?(\d{2})$/;

/** "+09:00" → 밀리초. 못 읽거나 ±14시간을 넘으면(실재하지 않음) null */
export function offsetMs(offset: unknown): number | null {
  if (typeof offset !== 'string') return null;
  const m = OFFSET.exec(offset.trim());
  if (!m) return null;
  const mag = Number(m[2]) * 3_600_000 + Number(m[3]) * 60_000;
  if (mag > 14 * 3_600_000) return null;
  return m[1] === '-' ? -mag : mag;
}

export function parseExifInstant(dateTime: unknown, offset?: unknown): ExifInstant | null {
  if (typeof dateTime !== 'string') return null;
  const m = DATETIME.exec(dateTime.trim());
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  const naive = Date.UTC(y, mo - 1, d, h, mi, s);
  // 달력에 없는 날짜(13월·32일)는 Date.UTC 가 조용히 넘기므로 되짚어 막는다
  const back = new Date(naive);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d || h > 23 || mi > 59 || s > 59) {
    return null;
  }
  const explicit = offsetMs(offset);
  return { at: naive - (explicit ?? KST_OFFSET_MS), assumedKst: explicit === null };
}
