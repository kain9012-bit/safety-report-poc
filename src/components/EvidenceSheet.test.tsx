// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mergeReads, normalizeRead } from '../../api/vision';
import { EvidenceSheet } from './FormParts';

afterEach(cleanup);

describe('근거 보기 — 여러 유형일 때의 설명은 실제 추천 방식(lib/choose.ts)과 같다', () => {
  it('단속 시간 → 사진만으로 확인 → 판독 순서로 추천한다고 적고, 과태료로 고르지 않는다고 밝힌다', () => {
    const read = normalizeRead({
      plate: { text: '12가3456', readable: true, confidence: 0.95 },
      scene: { schoolZoneMarking: 'yes' }, typeGuess: 'crossing', typeConfidence: 0.9,
      ground: { wheels: [{ wheel: '앞', surface: 'crosswalk_stripe' }], surface: 'crosswalk', crosswalkRelation: 'on', evidence: '' },
    })!;
    const shot = { takenAt: 1, source: 'camera' as const, dataUrl: 'data:,', lat: 37.5, lng: 127, accuracy: 6 };
    render(<EvidenceSheet shots={[shot, { ...shot, takenAt: 70_001 }]} result={mergeReads([read, read], 'test')!} onClose={vi.fn()} />);
    const text = document.body.textContent ?? '';
    expect(screen.getByText(/여러 개가 보이면 직접 고르게 하고 하나를 추천합니다/)).toBeTruthy();
    expect(text).toContain('지금 단속 시간인 유형 → 사진만으로 확인되는 유형');
    expect(text).toContain('사진만으로 확인되는 유형(거리·대상');
    expect(text).toContain('과태료로는 고르지 않습니다');
    expect(text).not.toContain('과태료가 무거운 유형');
    expect(text).toContain("'함께 보인 위반'으로 알립니다");
    expect(text).not.toContain('위치자료도 근처라고 하는 유형');
    expect(text).toContain('모두 단속 시간이 아니면 추천하지 않습니다');
    expect(text).not.toContain('앞선 것을 고릅니다');
  });
});
