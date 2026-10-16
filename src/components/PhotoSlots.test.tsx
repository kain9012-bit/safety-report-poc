// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { kstTime } from '../lib/kst';
import PhotoSlots from './PhotoSlots';

const at = kstTime(2026, 10, 15, 10);
const shot = (dataUrl: string, takenAt: number) => ({ takenAt, dataUrl, source: 'camera' as const });

function props(over: Partial<ComponentProps<typeof PhotoSlots>> = {}): ComponentProps<typeof PhotoSlots> {
  return {
    shots: [shot('data:,a', at), shot('data:,b', at + 65_000)],
    supplements: 0, minInterval: 60,
    onCamera: vi.fn(), onAlbum: vi.fn(), onRemove: vi.fn(), onEvidence: vi.fn(),
    ...over,
  };
}

afterEach(cleanup);

describe('신고서 사진 칸', () => {
  it('사진마다 바꾸기·지우기가 있고, 바꾸기는 앨범·카메라 중에서 고른다', () => {
    const p = props();
    render(<PhotoSlots {...p} />);
    expect(screen.getByRole('button', { name: '1번째 사진 지우기' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '2번째 사진 지우기' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '1번째 사진 바꾸기' }));
    const dialog = screen.getByRole('dialog', { name: '1번째 사진 바꾸기' });
    expect(within(dialog).getByText('앨범에서 고르기')).toBeTruthy();
    expect(dialog.textContent).toContain('남은 사진 다음, 2번째 사진이 됩니다');
    fireEvent.click(within(dialog).getByRole('button', { name: /카메라로 찍기/ }));
    expect(p.onCamera).toHaveBeenCalledWith(0);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('앨범에서 고른 한 장을 그 칸에 넣는다', () => {
    const p = props();
    const { container } = render(<PhotoSlots {...p} />);
    fireEvent.click(screen.getByRole('button', { name: '2번째 사진 바꾸기' }));
    const file = new File(['x'], 'b.jpg', { type: 'image/jpeg' });
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.multiple).toBe(false);
    fireEvent.change(input, { target: { files: [file] } });
    expect(p.onAlbum).toHaveBeenCalledWith(1, file);
  });

  it('지우기는 한 번 더 묻고, 보완 사진이 함께 빠지는 것도 알린다', () => {
    const p = props({ supplements: 1 });
    render(<PhotoSlots {...p} />);
    fireEvent.click(screen.getByRole('button', { name: '2번째 사진 지우기' }));
    const dialog = screen.getByRole('dialog', { name: '2번째 사진을 지울까요?' });
    expect(dialog.textContent).toContain('보완 사진 1장은 함께 빠집니다');
    fireEvent.click(within(dialog).getByRole('button', { name: '취소' }));
    expect(p.onRemove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '2번째 사진 지우기' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '지우기' }));
    expect(p.onRemove).toHaveBeenCalledWith(1);
  });

  it('사진이 1장이면 빈 칸에 사진 넣기가 보이고(따로 안내 줄은 두지 않는다), 마지막 한 장을 지우면 신고도 지운다고 알린다', () => {
    const p = props({ shots: [shot('data:,a', at), undefined], minInterval: 300 });
    render(<PhotoSlots {...p} />);
    expect(screen.queryByText(/사진이 1장입니다/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '2번째 사진 넣기' }));
    const add = screen.getByRole('dialog', { name: '2번째 사진 넣기' });
    expect(add.textContent).toContain('남은 사진 다음, 2번째 사진이 됩니다');
    fireEvent.click(within(add).getByRole('button', { name: '취소' }));
    fireEvent.click(screen.getByRole('button', { name: '1번째 사진 지우기' }));
    const dialog = screen.getByRole('dialog', { name: '1번째 사진을 지울까요?' });
    expect(dialog.textContent).toContain('지우면 이 신고도 함께 지워집니다');
    fireEvent.click(within(dialog).getByRole('button', { name: '다른 사진으로 바꾸기' }));
    expect(screen.getByRole('dialog', { name: '1번째 사진 바꾸기' }).textContent).toContain('1번째·2번째 사진을 차례로 찍습니다');
  });

  it('앨범에서 1장만 골라 들어오면 열자마자 1장 더 넣기를 묻는다', () => {
    const onAsked = vi.fn();
    render(<PhotoSlots {...props({ shots: [shot('data:,a', at), undefined], askMore: true, onAsked })} />);
    const dialog = screen.getByRole('dialog', { name: '사진 1장 더 넣기' });
    expect(dialog.textContent).toContain('사진이 2장 있어야 신고할 수 있습니다');
    expect(onAsked).toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: '나중에' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: '2번째 사진 넣기' })).toBeTruthy();
  });

  it('앨범 사진을 읽는 동안 다른 칸을 바꾸지 못한다', () => {
    render(<PhotoSlots {...props({ busySlot: 1 })} />);
    expect(screen.getByText('사진 읽는 중…')).toBeTruthy();
    expect((screen.getByRole('button', { name: '1번째 사진 바꾸기' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
