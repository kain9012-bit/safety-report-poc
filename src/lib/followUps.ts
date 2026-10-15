/**
 * 화면에 꺼내는 후속 질문 — 민원인이 직접 해야 할 일이 생겼을 때만 만든다(2026-10-15 결정: 화면은 main, 개선 로직은 뒤에서).
 *
 *  1. 보완 촬영 — 사진으로 해결되는 부족 사유일 때만, 한 번에 하나, 같은 사유는 한 번만 요청한다.
 *     거리·법적 요건만 부족한 경우는 사진으로 해결되지 않으므로 요청하지 않는다(evidence.supplementalNeeds).
 *  2. 병행주차 — 친환경차 충전·전용구역에서 '일반 자동차도 주차할 수 있다'는 안내가 사진에 보일 때만 묻는다.
 *
 * 그 밖의 판독 근거(관찰·미확인 사유·GPS 품질·촬영 방향)는 기록에만 남기고 화면에 늘어놓지 않는다.
 */
import { reviewSharedParking, summarizeEvidence, supplementalNeeds } from './evidence';
import { evidenceKey, primaryShots, reviewedReads } from './photoEvidence';
import { SHOW_IN_PHOTO } from './crosscheck';
import type { DraftReport } from '../types/report';

export interface SupplementRequest {
  /** 부족 사유 ID — 한 번 요청한 사유는 draft.supplementAsked 에 남겨 다시 묻지 않는다 */
  id: string;
  text: string;
}

export function supplementRequest(d: DraftReport): SupplementRequest | undefined {
  if (d.schemaVersion !== 2 || primaryShots(d).length < 2 || d.type === 'other') return;
  // 판독이 끝나지 않은 사진이 있으면 기다린다 — 곧 해결될 수도 있다
  if (d.shots.some((_, i) => d.reads?.[i] === undefined)) return;
  const asked = d.supplementAsked ?? [];
  const need = supplementalNeeds(reviewedReads(d), d.type).find((n) => !asked.includes(n.id));
  if (!need) return;
  const what = SHOW_IN_PHOTO[need.type];
  if (!what) return;
  return {
    id: need.id,
    text: need.role === 'marking'
      ? `${what} 잘 보이게 가까이에서 한 장 더 찍어 주세요`
      : `${what} 차와 함께 나오게 한 장 더 찍어 주세요`,
  };
}

export type SharedScope = 'same_bay' | 'different_bay' | 'unknown';

export interface SharedParkingQuestion {
  /** 사진에서 읽은 안내 문구(그대로 보여 주지는 않고 기록에 남긴다) */
  notice: string;
  /** 지금 사진 기준으로 받은 답. 사진이 바뀌었으면 undefined(다시 묻는다) */
  answer?: SharedScope;
}

function generalNotice(d: DraftReport) {
  if (d.schemaVersion !== 2 || d.type !== 'evcharging') return;
  const observations = summarizeEvidence(reviewedReads(d)).find((s) => s.type === 'evcharging')?.observations ?? [];
  return reviewSharedParking(observations).notices.find((n) => n.kind === 'general_car' || n.kind === 'both');
}

export function sharedParkingQuestion(d: DraftReport): SharedParkingQuestion | undefined {
  const notice = generalNotice(d);
  if (!notice) return;
  const p = d.sharedParking;
  return { notice: notice.text, answer: p && p.inputKey === evidenceKey(d) ? p.scope : undefined };
}

/** 사람이 고른 답과 사진에서 읽은 안내를 함께 기록한다. 법적 허용 여부는 정하지 않는다. */
export function answerSharedParking(d: DraftReport, scope: SharedScope, now = Date.now()): DraftReport {
  const notice = generalNotice(d);
  if (!notice) return d;
  return {
    ...d,
    sharedParking: {
      answer: 'yes',
      notice: notice.text,
      targetBay: notice.bayText,
      scope,
      permission: notice.kind === 'general_car' || notice.kind === 'both' ? 'general' : 'unknown',
      timeCondition: notice.timeText,
      timeMatch: 'unknown',
      conditions: notice.otherConditions,
      inputKey: evidenceKey(d),
      answeredAt: now,
    },
  };
}

/** 사진에서 읽은 정류소 공개 번호 — 서로 다르면 대상 정류소를 정할 수 없다 */
export function busStopNumbers(d: DraftReport): string[] {
  const observations = summarizeEvidence(reviewedReads(d)).find((s) => s.type === 'busstop')?.observations ?? [];
  return [...new Set(observations.flatMap((o) => (o.busStop?.readable && o.busStop.publicId.trim() ? [o.busStop.publicId.trim()] : [])))];
}
