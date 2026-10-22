/**
 * 화면에 꺼내는 후속 질문 — 민원인이 직접 확인해야 할 일이 있을 때만 만든다.
 *
 * 병행주차 — 친환경차충전구역 유형이면 늘 한 번 묻는다(2026-10-22 결정, 작업 브랜치 lib/followUps.ts 와 같은 규칙).
 * 일반 자동차도 세울 수 있는 칸이 있어 확인하고 신고하게 한다. 법적 허용 여부는 앱이 정하지 않는다.
 * 답해야 위반 유형 확인 단계를 떠날 수 있다('모르겠어요'도 답이다, 2026-10-22 결정).
 * main 판독은 안내판 문구를 따로 읽지 않으므로 사진에서 읽은 안내는 없다(notice 는 늘 '').
 */
import type { DraftReport } from '../types/report';

export type SharedScope = 'same_bay' | 'different_bay' | 'unknown';

export interface SharedParkingQuestion {
  /** 사진에서 읽은 안내 문구(그대로 보여 주지는 않고 기록에 남긴다). 읽지 못했으면 '' */
  notice: string;
  /** 지금 사진 기준으로 받은 답. 사진이 바뀌었으면 undefined(다시 묻는다) */
  answer?: SharedScope;
}

/** 기본 두 장이 바뀌었는지 가리는 열쇠 — 촬영시각과 사진 크기 */
export function photoKey(d: Pick<DraftReport, 'shots'>): string {
  return d.shots.slice(0, 2).map((s) => `${s.takenAt}:${s.dataUrl.length}`).join('|');
}

export function sharedParkingQuestion(d: DraftReport): SharedParkingQuestion | undefined {
  if (d.type !== 'evcharge' || d.shots.length === 0) return;
  const p = d.sharedParking;
  return { notice: '', answer: p && p.inputKey === photoKey(d) ? p.scope : undefined };
}

/** 병행주차 질문에 아직 답하지 않았다 — 답하기 전에는 다음 단계로 넘어가거나 제출하지 못한다 */
export function sharedAnswerNeeded(q: SharedParkingQuestion | undefined): boolean {
  return !!q && q.answer === undefined;
}

/** 사람이 고른 답을 기록한다. 사진에서 안내를 읽지 않았으므로 '사진에서 못 봄'으로 남긴다. */
export function answerSharedParking(d: DraftReport, scope: SharedScope, now = Date.now()): DraftReport {
  if (d.type !== 'evcharge') return d;
  return {
    ...d,
    sharedParking: {
      answer: 'not_seen',
      notice: '',
      targetBay: '',
      scope,
      permission: 'unknown',
      timeCondition: '',
      timeMatch: 'unknown',
      conditions: '',
      inputKey: photoKey(d),
      answeredAt: now,
    },
  };
}
