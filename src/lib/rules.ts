/**
 * 신고 요건 규칙 — AI가 손대지 않는 영역.
 *
 * 여기 있는 값은 안전신문고 불법주정차 신고 안내에서 그대로 옮긴 것이다.
 * 지자체마다 대상 유형이 다를 수 있어(인도 운영 여부 등) 유형 목록은 지역 설정으로 덮을 수 있게 둔다.
 */

import type { ViolationType } from '../types/report';

/** 유형별 기준 거리(m). 거리 기준이 없는 유형은 undefined. */
export const THRESHOLD_METERS: Record<ViolationType, number | undefined> = {
  hydrant: 5,
  corner: 5,
  busstop: 10,
  crossing: undefined, // 정지선 침범 여부라 거리로 못 가른다
  schoolzone: undefined, // 구역 안인지 밖인지로 가른다
  sidewalk: undefined, // 좌표 데이터가 없다. 사진 판독에만 기댄다
};

/** 두 컷 사이 최소 간격(초) */
export const MIN_INTERVAL_SEC = 60;

/** 어린이보호구역 단속 시간대(평일) */
export const SCHOOLZONE_HOURS = { from: 8, to: 20 } as const;

/** 촬영 시각 기준 접수 기한 — 익일 자정까지 */
export function submitDeadline(takenAt: number): number {
  const d = new Date(takenAt);
  d.setDate(d.getDate() + 1);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

export function isExpired(takenAt: number, now: number = Date.now()): boolean {
  return now > submitDeadline(takenAt);
}

/** 두 컷 간격(초). 순서가 뒤바뀌어 들어와도 절댓값으로 본다. */
export function intervalSeconds(a: number, b: number): number {
  return Math.abs(b - a) / 1000;
}

/**
 * 차량번호 형식 검사 — 규칙이 AI를 검증하는 자리.
 * 판독기가 내놓은 값이 형식조차 맞지 않으면 채우지 않는다.
 * 예: 12가3456, 123가4567, 서울12가3456
 */
const PLATE_RE = /^(?:[가-힣]{2})?\d{2,3}[가-힣]\d{4}$/;

export function isValidPlate(plate: string): boolean {
  return PLATE_RE.test(plate.replace(/\s/g, ''));
}

/** 판독 결과를 그대로 믿지 않는 기준. 이 아래면 빈칸으로 두고 사람에게 묻는다. */
export const PLATE_CONFIDENCE_FLOOR = 0.8;

export type CheckStatus = 'pass' | 'warn' | 'fail';

export interface CheckResult {
  id: string;
  label: string;
  status: CheckStatus;
  /** 왜 이 결과가 나왔는지. 통과든 실패든 근거를 남긴다. */
  detail: string;
}

export interface CheckInput {
  shotTimes: number[];
  hasTimestampOverlay: boolean;
  plate?: string;
  lat?: number;
  lng?: number;
  accuracy?: number;
  now?: number;
}

/**
 * 제출 직전 점검 — 자주 나오는 반려 사유 다섯 가지.
 * fail 이 하나라도 있으면 제출을 막는다. warn 은 알리되 막지 않는다.
 */
export function runChecks(input: CheckInput): CheckResult[] {
  const now = input.now ?? Date.now();
  const [first, second] = [...input.shotTimes].sort((a, b) => a - b);
  const out: CheckResult[] = [];

  // 1. 두 컷 간격
  if (first === undefined || second === undefined) {
    out.push({
      id: 'interval',
      label: '1분 간격 두 장',
      status: 'fail',
      detail: '사진이 두 장 필요합니다.',
    });
  } else {
    const gap = intervalSeconds(first, second);
    out.push({
      id: 'interval',
      label: '1분 간격 두 장',
      status: gap >= MIN_INTERVAL_SEC ? 'pass' : 'fail',
      detail:
        gap >= MIN_INTERVAL_SEC
          ? `${Math.floor(gap)}초 간격으로 찍혔습니다.`
          : `${Math.floor(gap)}초 간격입니다. ${MIN_INTERVAL_SEC}초 이상이어야 합니다.`,
    });
  }

  // 2. 접수 기한
  if (first !== undefined) {
    const left = submitDeadline(first) - now;
    const hours = Math.floor(left / 3_600_000);
    out.push({
      id: 'deadline',
      label: '접수 기한',
      status: left <= 0 ? 'fail' : hours < 6 ? 'warn' : 'pass',
      detail:
        left <= 0
          ? '촬영 익일이 지났습니다. 이 사진으로는 접수되지 않습니다.'
          : `제출 기한까지 약 ${hours}시간 남았습니다.`,
    });
  }

  // 3. 촬영시각 표시
  out.push({
    id: 'timestamp',
    label: '촬영시각 표시',
    status: input.hasTimestampOverlay ? 'pass' : 'fail',
    detail: input.hasTimestampOverlay
      ? '사진에 촬영시각이 찍혀 있습니다.'
      : '사진에 촬영시각 표시가 없습니다.',
  });

  // 4. 차량번호
  const plate = input.plate?.trim();
  out.push({
    id: 'plate',
    label: '차량번호',
    status: !plate ? 'fail' : isValidPlate(plate) ? 'pass' : 'warn',
    detail: !plate
      ? '차량번호가 비어 있습니다.'
      : isValidPlate(plate)
        ? `${plate} — 형식이 맞습니다.`
        : `${plate} — 번호판 형식과 다릅니다. 다시 확인해 주세요.`,
  });

  // 5. 위치
  const hasCoord = input.lat !== undefined && input.lng !== undefined;
  const acc = input.accuracy;
  out.push({
    id: 'location',
    label: '위치 특정',
    status: !hasCoord ? 'fail' : acc === undefined || acc > 30 ? 'warn' : 'pass',
    detail: !hasCoord
      ? '좌표가 없습니다. 위치 권한을 켜고 다시 찍어 주세요.'
      : acc === undefined
        ? '좌표는 있으나 정확도를 알 수 없습니다.'
        : `좌표 정확도 약 ${Math.round(acc)}m.`,
  });

  return out;
}

export function blocksSubmit(checks: readonly CheckResult[]): boolean {
  return checks.some((c) => c.status === 'fail');
}
