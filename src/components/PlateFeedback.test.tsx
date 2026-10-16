// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mergeReads, normalizeRead } from '../../api/vision';
import type { PhotoRead, VisionResult } from '../../api/vision';
import { kstTime } from '../lib/kst';
import type { DraftReport } from '../types/report';
import CaptureFlow from './CaptureFlow';
import { PlateNote } from './FormParts';

// 실제 사진·권한·장치를 사용하지 않고 촬영 뒤 두 장 확인 화면을 검증한다.
vi.mock('../lib/camera', () => ({
  startCamera: vi.fn(async () => ({ getTracks: () => [] })),
  stopCamera: vi.fn(), captureFrame: vi.fn(),
}));

afterEach(cleanup);

const read = (plate = '12가3456', confidence = 0.95): PhotoRead => normalizeRead({
  plate: { text: plate, confidence, readable: true },
  scene: { onCrosswalk: 'yes' }, typeGuess: 'crossing', typeConfidence: 0.95,
})!;
const result = (a = read(), b: PhotoRead | null = read()): VisionResult => mergeReads([a, b], 'test')!;
const draft = (plate?: string, plateConfirmedFor?: string): DraftReport => ({ shots: [], plate, plateConfirmedFor });

function note(v: VisionResult, d = draft(), onUse = vi.fn(), onConfirm = vi.fn()) {
  return <PlateNote draft={d} vision={{ state: 'ok', result: v }} plateOk onUse={onUse} onConfirm={onConfirm} />;
}

describe('번호판 입력 단계의 판독 설명', () => {
  it('신뢰도 높은 두 번호와 자동 입력 번호가 같을 때 일치 배지를 표시한다', () => {
    render(note(result(), draft('12가3456')));
    expect(screen.getByText('두 장 판독 일치')).toBeTruthy();
  });

  it('저신뢰 두 장을 한 장 판독으로 잘못 설명하지 않고 기존 후보 선택을 유지한다', () => {
    const onUse = vi.fn();
    render(note(result(read(), read('12가3456', 0.6)), draft(), onUse));
    expect(screen.getByText(/확신도가 기준\(80%\) 미만/)).toBeTruthy();
    expect(screen.queryByText(/한 장에서만/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '12가3456 쓰기' }));
    expect(onUse).toHaveBeenCalledWith('12가3456');
  });

  it('실제로 한 장만 판독됐을 때는 한 장이라는 설명을 유지한다', () => {
    render(note(result(read(), null)));
    expect(screen.getByText(/한 장에서만 읽힘\(12가3456\)/)).toBeTruthy();
  });

  it('재판독 결과가 바뀌면 남아 있는 자동 입력 번호에 일치 배지를 붙이지 않는다', () => {
    const savedInput = draft('12가3456');
    const view = render(note(result(), savedInput));
    view.rerender(note(result(read('99나9999'), read('99나9999')), savedInput));
    expect(screen.queryByText('두 장 판독 일치')).toBeNull();
    expect(screen.getByText(/입력한 번호가 AI가 두 장에서 읽은 번호\(99나9999\)와 달라요/)).toBeTruthy();
    expect(savedInput.plate).toBe('12가3456');
  });

  it('재판독 신뢰도가 떨어지면 기존 번호를 지우지 않고 확인 필요를 알린다', () => {
    const savedInput = draft('12가3456');
    render(note(result(read(), read('12가3456', 0.6)), savedInput));
    expect(screen.queryByText('두 장 판독 일치')).toBeNull();
    expect(screen.getByText('사진에서 번호판을 확실히 읽지 못했어요')).toBeTruthy();
    expect(screen.getByText(/확신도가 기준/)).toBeTruthy();
    expect(savedInput.plate).toBe('12가3456');
  });

  it('잘못된 형식을 두 장에서 똑같이 읽어도 형식 오류로 설명한다', () => {
    render(note(result(read('ABC1234'), read('ABC1234'))));
    expect(screen.getByText(/읽은 값이 번호판 형식과 다름\(ABC1234 \/ ABC1234\)/)).toBeTruthy();
    expect(screen.queryByText(/한 장에서만/)).toBeNull();
  });

  it('못 읽었으면 사진에 보이는 번호를 직접 넣으라고 안내하고 사진별 판독을 보여 준다', () => {
    render(note(result(read('12가3456', 0.62), null), draft('12가3456')));
    expect(screen.getByText(/사진에 보이는 번호/)).toBeTruthy();
    expect(screen.getByText(/담당자가 사진으로 번호를 한 번 더 확인해요/)).toBeTruthy();
    expect(screen.getByText('12가3456 · 확신 62%')).toBeTruthy();
    expect(screen.getByText('못 읽음')).toBeTruthy();
  });

  it('AI 판독과 다르면 사진별 판독과 입력을 나란히 보여 주고 확인 체크를 받는다', () => {
    const onConfirm = vi.fn();
    render(note(result(read('12가3458'), read('12가3458')), draft('12가3456'), vi.fn(), onConfirm));
    expect(screen.getAllByText('12가3458 · 확신 95%')).toHaveLength(2);
    expect(screen.getByText(/확인하지 않으면 빨간불로 남고, 제출할 때 불수용 가능성 안내/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/사진을 보고 다시 확인했어요 \(12가3456\)/));
    expect(onConfirm).toHaveBeenCalledWith('12가3456');
    expect(screen.getByRole('button', { name: '12가3458 쓰기' })).toBeTruthy();
  });

  it('확인한 번호 그대로면 체크된 채 주황 안내, 번호를 바꾸면 확인이 풀린다', () => {
    const v = result(read('12가3458'), read('12가3458'));
    const view = render(note(v, draft('12가3456', '12가3456')));
    expect((screen.getByLabelText(/사진을 보고 다시 확인했어요/) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText(/확인한 번호로 냅니다/)).toBeTruthy();
    view.rerender(note(v, draft('12가3457', '12가3456')));
    expect((screen.getByLabelText(/사진을 보고 다시 확인했어요/) as HTMLInputElement).checked).toBe(false);
  });

  it('두 장에서 같은 번호를 읽었는데 칸을 비웠으면 쓰기 단추만 보여 준다', () => {
    const onUse = vi.fn();
    render(note(result(), draft(), onUse));
    fireEvent.click(screen.getByRole('button', { name: '12가3456 쓰기' }));
    expect(onUse).toHaveBeenCalledWith('12가3456');
    expect(screen.queryByText('사진에서 번호판을 확실히 읽지 못했어요')).toBeNull();
  });
});

function captureProps(v: VisionResult): ComponentProps<typeof CaptureFlow> {
  const at = kstTime(2026, 10, 7, 10);
  return {
    draft: {
      shots: [at, at + 61_000].map((takenAt) => ({ takenAt, dataUrl: 'data:,', source: 'camera' })),
      reads: v.photos, overlap: { ratio: 0.9, score: 0.8, same: true },
    },
    readStates: ['ok', 'ok'], vision: v,
    verdict: { type: 'crossing', source: 'photo', suspicions: [], alternatives: [] }, options: [],
    onShot: vi.fn(), onRetakeFirst: vi.fn(), onRetakeSecond: vi.fn(),
    onAcceptFirst: vi.fn(), onChooseType: vi.fn(), onRetryRead: vi.fn(), onDone: vi.fn(), onExit: vi.fn(),
  };
}

describe('촬영 직후 두 장 확인의 판독 설명', () => {
  it('저신뢰 일치를 확정하지 않고 신뢰도 부족과 재촬영 경로를 보여 준다', () => {
    const p = captureProps(result(read(), read('12가3456', 0.6)));
    render(<CaptureFlow {...p} />);
    expect(screen.getByText(/번호판 판독 신뢰도가 기준\(80%\)에 못 미치거나 확인되지 않습니다/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '신고서 확인으로' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '두 번째 다시 찍기' }));
    expect(p.onRetakeSecond).toHaveBeenCalledOnce();
  });

  it('형식 오류를 번호판이 안 읽힌 것으로 뭉뚱그리지 않는다', () => {
    render(<CaptureFlow {...captureProps(result(read('ABC1234'), read('ABC1234')))} />);
    expect(screen.getByText('읽은 번호가 번호판 형식과 다릅니다(ABC1234 / ABC1234)')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '신고서 확인으로' })).toBeNull();
  });
});
