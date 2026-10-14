// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mergeReads, normalizeRead } from '../../api/vision';
import { kstTime } from '../lib/kst';
import { rulesFor } from '../lib/localRules';
import ReportSteps from './ReportSteps';

const TAKEN = kstTime(2026, 10, 7, 10);
const BEFORE_MIDNIGHT = kstTime(2026, 10, 8, 23, 59, 59, 500);
const AFTER_MIDNIGHT = kstTime(2026, 10, 9, 0, 0, 1);

function props(takenAt = TAKEN): ComponentProps<typeof ReportSteps> {
  const read = normalizeRead({
    plate: { text: '12가3456', readable: true, confidence: 0.95 },
    scene: { onCrosswalk: 'yes' }, typeGuess: 'crossing', typeConfidence: 0.95,
  })!;
  const address = '전북특별자치도 전주시 완산구 노송광장로 10';
  return {
    draft: {
      shots: [takenAt, takenAt + 61_000].map((takenAt) => ({
        takenAt, source: 'camera', dataUrl: 'data:,', lat: 35.8242, lng: 127.148, accuracy: 6,
      })),
      type: 'crossing', plate: '12가3456', address,
      body: '횡단보도 위에 주차한 차량입니다.', manual: { body: true },
      overlap: { ratio: 0.9, score: 0.8, same: true },
    },
    step: 4, onStep: vi.fn(), addressState: 'ok',
    typeInfo: { state: 'idle', candidates: [], missing: [], coverage: {} },
    vision: { state: 'ok', result: mergeReads([read, read], 'test')! },
    verdict: { type: 'crossing', source: 'photo', suspicions: [], alternatives: [] },
    options: [], rules: rulesFor(address),
    onRetryVision: vi.fn(), onEdit: vi.fn(), onPickAddress: vi.fn(),
    onRetake: vi.fn(), onHome: vi.fn(), onSubmit: vi.fn(),
  };
}

function expectExpired() {
  const row = screen.getByText('접수 기한').closest('li')!;
  expect(within(row).getByLabelText('불가')).toBeTruthy();
  expect(row.textContent).toContain('접수 기한(10/8 23:59)을 넘겼습니다.');
  expect((screen.getByRole('button', { name: '빨간불 1개' }) as HTMLButtonElement).disabled).toBe(true);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(BEFORE_MIDNIGHT);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('신고서를 그대로 열어 둔 동안의 점검 갱신', () => {
  it('보완사진을 읽는 동안 단계·홈·재촬영 버튼을 비활성화하고 추가 취소는 유지한다', () => {
    const p = props();
    const cancel = vi.fn();
    const view = render(<ReportSteps {...p} step={0} photoImporting evidencePanel={<button onClick={cancel}>추가 취소</button>} />);
    for (const name of ['처음 화면', '발생지역', '다시 찍기', '다음']) {
      const button = screen.getByRole('button', { name });
      expect((button as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(button);
    }
    expect(p.onStep).not.toHaveBeenCalled(); expect(p.onHome).not.toHaveBeenCalled(); expect(p.onRetake).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '추가 취소' })); expect(cancel).toHaveBeenCalledOnce();
    view.rerender(<ReportSteps {...p} step={0} photoImporting={false} />);
    fireEvent.click(screen.getByRole('button', { name: '다음' })); expect(p.onStep).toHaveBeenCalledWith(1);
  });
  it('입력을 수정하지 않아도 한국 자정이 지나면 기한 실패와 제출 불가로 바뀐다', () => {
    const p = props();
    render(<ReportSteps {...p} />);
    expect((screen.getByRole('button', { name: '제출' }) as HTMLButtonElement).disabled).toBe(false);

    act(() => { vi.advanceTimersByTime(1000); });

    expectExpired();
    expect(p.onEdit).not.toHaveBeenCalled();
    expect(p.onStep).not.toHaveBeenCalled();
    expect(p.onSubmit).not.toHaveBeenCalled();
  });

  it.each([
    ['창에 다시 초점이 올 때', () => fireEvent(window, new Event('focus'))],
    ['페이지 표시 상태가 바뀔 때', () => fireEvent(document, new Event('visibilitychange'))],
  ])('%s 타이머를 기다리지 않고 현재 시각으로 점검한다', (_, resume) => {
    render(<ReportSteps {...props()} />);
    vi.setSystemTime(AFTER_MIDNIGHT); // 절전·백그라운드처럼 콜백 실행 없이 벽시계만 이동
    expect((screen.getByRole('button', { name: '제출' }) as HTMLButtonElement).disabled).toBe(false);

    resume();

    expectExpired();
  });
});

it('지역 규정 유효기간을 넘으면 안내 카드·점검·전달 요약이 함께 전국 기준으로 바뀐다', () => {
  // 대전 동구 확인일 2026-09-18: 365일까지 사용, 366일째 한국 자정부터 전국 기준.
  vi.setSystemTime(kstTime(2027, 9, 18, 23, 59, 59, 500));
  const p = props(kstTime(2027, 9, 17, 10));
  p.draft.address = '대전광역시 동구 동구청로 147';
  p.rules = rulesFor(p.draft.address);
  const view = render(<ReportSteps {...p} step={1} />);
  expect(screen.getByText('기본 6개 유형의 참고 접수 기한: 촬영일 2일 뒤 자정까지')).toBeTruthy();

  act(() => { vi.advanceTimersByTime(1000); });

  expect(screen.getByText('기본 6개 유형의 참고 접수 기한: 촬영일 다음 날 자정까지')).toBeTruthy();
  expect(screen.getByText(/전국 기준 · 두 장 1분 간격.*대전 동구 규정은 확인한 지 1년이 넘어 쓰지 않음/)).toBeTruthy();
  // 부모가 넘긴 규정 객체는 그대로여도, 현재 시각의 규정이 세 화면에 일관되게 적용된다.
  view.rerender(<ReportSteps {...p} step={4} />);
  const deadline = screen.getByText('접수 기한').closest('li')!;
  expect(within(deadline).getByLabelText('불가')).toBeTruthy();
  const summary = view.container.querySelector('pre')!;
  expect(summary.textContent).toContain('- 적용 기준: 전국 기준(6대 유형)');
  expect(summary.textContent).not.toContain('대전 동구 규정');
  expect(summary.textContent).toContain('접수 기한 미달');
});
