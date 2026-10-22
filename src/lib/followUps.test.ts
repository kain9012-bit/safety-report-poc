import { describe, expect, it } from 'vitest';
import { answerSharedParking, photoKey, sharedAnswerNeeded, sharedParkingQuestion } from './followUps';
import { precheck } from './precheck';
import { kstTime } from './kst';
import type { DraftReport, Shot } from '../types/report';

const at = kstTime(2026, 10, 22, 10);
const shot = (t: number, dataUrl = 'data:,a'): Shot => ({ takenAt: t, lat: 37.5665, lng: 126.978, accuracy: 6, dataUrl, source: 'camera' });
const ev = (extra: Partial<DraftReport> = {}): DraftReport => ({
  shots: [shot(at), shot(at + 70_000, 'data:,b')], type: 'evcharge', plate: '12가3456', address: '서울특별시 중구 세종대로 110', ...extra,
});
const row = (d: DraftReport) =>
  precheck({ draft: d, body: '친환경차 충전구역 주차', verdict: { type: 'evcharge', source: 'photo', suspicions: [], alternatives: [] }, vision: null, now: at + 120_000 })
    .checks.find((c) => c.id === 'shared_parking');

describe('친환경차 병행주차 질문 — 친환경차충전구역 유형이면 늘 한 번 묻는다', () => {
  it('친환경차 유형이고 사진이 있으면 묻는다(main 판독은 안내판을 읽지 않아 안내 문구는 없다)', () => {
    expect(sharedParkingQuestion(ev())).toEqual({ notice: '', answer: undefined });
  });
  it('다른 유형이거나 사진이 없으면 묻지 않는다', () => {
    expect(sharedParkingQuestion(ev({ type: 'hydrant' }))).toBeUndefined();
    expect(sharedParkingQuestion(ev({ shots: [] }))).toBeUndefined();
    const other = ev({ type: 'disabled' });
    expect(answerSharedParking(other, 'same_bay', at)).toBe(other);
  });
  it('답을 사진에서 못 봄으로 기록하고, 같은 사진에서는 그 답을 보여 준다', () => {
    const d = answerSharedParking(ev(), 'same_bay', at);
    expect(d.sharedParking).toMatchObject({ answer: 'not_seen', notice: '', scope: 'same_bay', permission: 'unknown', inputKey: photoKey(d), answeredAt: at });
    expect(sharedParkingQuestion(d)?.answer).toBe('same_bay');
  });
  it('답이 없을 때만 다음 단계로 못 가게 한다 — 모르겠어요도 답이다', () => {
    expect(sharedAnswerNeeded(sharedParkingQuestion(ev()))).toBe(true);
    for (const scope of ['same_bay', 'different_bay', 'unknown'] as const) {
      expect(sharedAnswerNeeded(sharedParkingQuestion(answerSharedParking(ev(), scope, at)))).toBe(false);
    }
    expect(sharedAnswerNeeded(sharedParkingQuestion(ev({ type: 'hydrant' })))).toBe(false);
  });
  it('사진이 바뀌면 다시 묻는다', () => {
    const d = answerSharedParking(ev(), 'different_bay', at);
    const changed = { ...d, shots: [d.shots[0], shot(at + 90_000, 'data:,c')] };
    expect(sharedParkingQuestion(changed)?.answer).toBeUndefined();
  });
});

describe('제출 전 점검 — 일반 자동차 주차 안내', () => {
  it('답하기 전에는 노란불로 묻는다', () => {
    expect(row(ev())).toMatchObject({ status: 'warn' });
    expect(row(ev())?.detail).toContain('일반 자동차도 세울 수 있는 칸');
  });
  it('있어요·모르겠어요면 노란불, 없어요면 줄이 없다', () => {
    expect(row(answerSharedParking(ev(), 'same_bay', at))?.detail).toContain('있다고 답했습니다');
    expect(row(answerSharedParking(ev(), 'unknown', at))?.status).toBe('warn');
    expect(row(answerSharedParking(ev(), 'different_bay', at))).toBeUndefined();
  });
  it('다른 유형에는 줄이 없다', () => {
    expect(row(ev({ type: 'hydrant' }))).toBeUndefined();
  });
});
