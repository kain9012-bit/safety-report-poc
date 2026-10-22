// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import FollowUps from './FollowUps';

afterEach(() => cleanup());

describe('위반 유형 확인 단계의 후속 질문', () => {
  it('해당할 것이 없으면 아무것도 그리지 않는다', () => {
    const { container } = render(<FollowUps onSupplement={vi.fn()} onSharedAnswer={vi.fn()} />);
    expect(container.innerHTML).toBe('');
  });

  it('보완 촬영은 한 문장과 "한 장 더 찍기"만 보이고, 고른 사진을 사유 ID와 함께 넘긴다', () => {
    const onSupplement = vi.fn();
    render(<FollowUps supplement={{ id: 'hydrant:connection', text: '소화전이나 소방용수 표시가 차와 함께 나오게 한 장 더 찍어 주세요' }} onSupplement={onSupplement} onSharedAnswer={vi.fn()} />);
    expect(screen.getByText('소화전이나 소방용수 표시가 차와 함께 나오게 한 장 더 찍어 주세요')).toBeTruthy();
    const input = screen.getByLabelText('한 장 더 찍기') as HTMLInputElement;
    expect(input.getAttribute('capture')).toBe('environment');
    const file = new File(['x'], 'more.jpg', { type: 'image/jpeg' });
    fireEvent.change(input, { target: { files: [file] } });
    expect(onSupplement).toHaveBeenCalledWith(file, 'hydrant:connection');
  });

  it('사진을 읽는 동안에는 다시 고를 수 없다', () => {
    render(<FollowUps supplement={{ id: 'x', text: '한 장 더' }} supplementBusy onSupplement={vi.fn()} onSharedAnswer={vi.fn()} />);
    expect((screen.getByLabelText('사진 읽는 중…') as HTMLInputElement).disabled).toBe(true);
  });

  it('병행주차는 질문 하나와 세 답만 보이고, 고른 답을 표시한다', () => {
    const onSharedAnswer = vi.fn();
    render(<FollowUps shared={{ notice: '일반 자동차 주차 가능', answer: 'unknown' }} onSupplement={vi.fn()} onSharedAnswer={onSharedAnswer} />);
    expect(screen.getByText('이 칸에 일반 자동차도 주차할 수 있다는 안내가 있나요?')).toBeTruthy();
    expect(screen.queryByText('일반 자동차 주차 가능')).toBeNull();
    expect(screen.getByRole('button', { name: '모르겠어요' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '있어요' }));
    expect(onSharedAnswer).toHaveBeenCalledWith('same_bay');
    fireEvent.click(screen.getByRole('button', { name: '없어요' }));
    expect(onSharedAnswer).toHaveBeenCalledWith('different_bay');
  });
  it('사진에서 안내를 못 읽었어도 친환경차면 묻고, 왜 묻는지 한 줄로 알린다', () => {
    const onSharedAnswer = vi.fn();
    render(<FollowUps shared={{ notice: '' }} onSupplement={vi.fn()} onSharedAnswer={onSharedAnswer} />);
    expect(screen.getByText('이 칸에 일반 자동차도 주차할 수 있다는 안내가 있나요?')).toBeTruthy();
    expect(screen.getByText(/일반 자동차도 세울 수 있다고 안내하는 칸이 있어요/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '없어요' }));
    expect(onSharedAnswer).toHaveBeenCalledWith('different_bay');
  });

});
