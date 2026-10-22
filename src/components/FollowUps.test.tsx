// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import FollowUps from './FollowUps';

afterEach(cleanup);

describe('친환경차 병행주차 질문', () => {
  it('해당할 것이 없으면 아무것도 그리지 않는다', () => {
    const { container } = render(<FollowUps onSharedAnswer={vi.fn()} />);
    expect(container.textContent).toBe('');
  });
  it('질문과 왜 묻는지 한 줄, 세 답을 보이고 고른 답을 넘긴다', () => {
    const onSharedAnswer = vi.fn();
    render(<FollowUps shared={{ notice: '', answer: 'unknown' }} onSharedAnswer={onSharedAnswer} />);
    expect(screen.getByText('이 칸에 일반 자동차도 주차할 수 있다는 안내가 있나요?')).toBeTruthy();
    expect(screen.getByText(/일반 자동차도 세울 수 있다고 안내하는 칸이 있어요/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '모르겠어요' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '없어요' }));
    expect(onSharedAnswer).toHaveBeenCalledWith('different_bay');
  });
});
