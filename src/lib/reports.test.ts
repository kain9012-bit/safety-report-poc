import { describe, expect, it } from 'vitest';
import { RESUME_MAX_MS, measure, newId, pickResume } from './reports';
import type { ReportRecord } from './reports';

const NOW = 1_800_000_000_000;
const rec = (over: Partial<ReportRecord> & { shots?: number }): ReportRecord => ({
  id: over.id ?? 'r',
  phase: over.phase ?? 'capture',
  step: 0,
  createdAt: over.createdAt ?? NOW - 60_000,
  updatedAt: over.updatedAt ?? NOW - 60_000,
  draft: { shots: Array.from({ length: over.shots ?? 1 }, () => ({ takenAt: NOW, dataUrl: 'data:,' })) },
});

describe('이어하기 — 앱을 다시 열면 하던 신고로', () => {
  it('목록 순서(최근 것부터)에서 첫 번째 진행 중 신고를 고른다', () => {
    const list = [rec({ id: 'a' }), rec({ id: 'b' })];
    expect(pickResume(list, NOW)?.id).toBe('a');
  });
  it('제출한 신고는 이어하지 않는다', () => {
    expect(pickResume([rec({ id: 'a', phase: 'submitted' }), rec({ id: 'b' })], NOW)?.id).toBe('b');
  });
  it('사진이 없는 신고는 이어하지 않는다', () => {
    expect(pickResume([rec({ id: 'a', shots: 0 })], NOW)).toBeUndefined();
  });
  it('자동 이어하기 기준인 36시간을 넘기면 자동 선택하지 않는다', () => {
    expect(pickResume([rec({ createdAt: NOW - RESUME_MAX_MS - 1 })], NOW)).toBeUndefined();
    expect(pickResume([rec({ createdAt: NOW - RESUME_MAX_MS })], NOW)).toBeDefined();
  });
});

describe('신고 번호', () => {
  it('겹치지 않는다', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newId(NOW)));
    expect(ids.size).toBe(200);
  });
});

describe('걸린 시간·누른 횟수 — 현장 확인 ⑦', () => {
  const base = rec({ shots: 2 });
  base.draft.shots[1] = { ...base.draft.shots[0], takenAt: base.draft.shots[0].takenAt + 61_000 };
  it('제출하지 않았으면 재지 않는다', () => {
    expect(measure(base)).toBeNull();
  });
  it('시작부터 제출까지, 두 사진 간격과 누른 횟수를 함께', () => {
    const m = measure({ ...base, submittedAt: base.createdAt + 92_000, taps: 14 })!;
    expect(m.totalSec).toBe(92);
    expect(m.waitSec).toBe(61);
    expect(m.text).toBe('걸린 시간 1분 32초 · 그중 두 사진 간격 1분 1초 · 누른 횟수 14회');
  });
  it('30분 넘게 걸렸으면 이어서 낸 신고라고 밝힌다', () => {
    expect(measure({ ...base, submittedAt: base.createdAt + 40 * 60_000 })!.text).toContain('이어서 낸 신고');
  });
});
