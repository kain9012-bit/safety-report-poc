import { describe, expect, it } from 'vitest';
import { OFFICER_HEADER, officerLines, withOfficerSummary } from './officer';
import { precheck } from './precheck';
import { rulesFor } from './localRules';
import { kstTime } from './kst';
import type { DraftReport, Shot } from '../types/report';
import type { VisionResult } from '../../api/vision';

const T0 = kstTime(2026, 10, 7, 10, 0, 0);
const shot = (t: number): Shot => ({ takenAt: t, lat: 35.8242, lng: 127.148, accuracy: 6, dataUrl: 'data:,', source: 'camera' });
const vision = { sameVehicle: 'yes', ruleTypes: ['crossing'], plate: { text: '12가3456', readable: true, confidence: 0.95, agree: true, reads: ['12가3456', '12가3456'] } } as unknown as VisionResult;
const draft: DraftReport = {
  shots: [shot(T0), shot(T0 + 61_000)],
  address: '전북특별자치도 전주시 완산구 노송광장로 10',
  plate: '12가3456',
  type: 'crossing',
  overlap: { ratio: 0.92, score: 0.8, same: true },
};
const pc = (d: DraftReport, v: VisionResult | null = vision) =>
  precheck({ draft: d, body: '횡단보도 위 주차', verdict: { type: 'crossing', source: 'photo', suspicions: [], alternatives: [] }, vision: v, now: T0 + 120_000, minInterval: 60 });
const lines = (d: DraftReport, v?: VisionResult | null) => officerLines({ draft: d, precheck: pc(d, v), rules: rulesFor(d.address), minInterval: 60 });

describe('담당 공무원용 사전 점검 요약', () => {
  it('규칙으로 잰 값을 숫자로 적는다', () => {
    const l = lines(draft).join('\n');
    expect(l).toContain('- 간격: 61초(기준 60초) 충족');
    expect(l).toContain('- 같은 자리: 두 사진 겹침 92%(기준 50%) 충족');
    expect(l).toContain('- 같은 차: 두 장에서 따로 읽은 번호 일치');
    expect(l).toContain('- 위반 근거: 사진에 횡단보도 근거 보임');
    expect(l).toContain('- 위치: 오차 약 6m');
    expect(l).toContain('- 적용 기준: 전국 기준(6대 유형)');
    expect(l).toContain('- 확인 필요: 없음');
  });
  it('통과하지 못한 항목은 숨기지 않는다', () => {
    const l = lines({ ...draft, overlap: { ratio: 0.3, score: 0.2, same: false } }, null).join('\n');
    expect(l).toContain('겹침 30%(기준 50%) 미달');
    expect(l).toContain('두 장 번호 대조 안 됨');
    expect(l).toMatch(/확인 필요: .*두 장 번호판 일치/);
  });
  it('지역 규정을 쓰면 그 지역과 확인일을 밝힌다', () => {
    const l = lines({ ...draft, address: '대전광역시 동구 동구청로 147' }).join('\n');
    expect(l).toContain('대전 동구 규정(확인 2026-09-18)');
  });
  it('없는 값은 지어내지 않는다 — 겹침을 못 쟀으면 그 줄을 뺀다', () => {
    expect(lines({ ...draft, overlap: undefined }).some((x) => x.startsWith('- 같은 자리'))).toBe(false);
  });
  it('내용 칸 900자를 넘지 않게 요약을 뒤에서부터 줄이고, 신고인 내용은 그대로 둔다', () => {
    const body = '가'.repeat(800);
    const out = withOfficerSummary(body, lines(draft));
    expect(out.length).toBeLessThanOrEqual(900);
    expect(out.startsWith(body)).toBe(true);
  });
  it('넉넉하면 머리말과 함께 전부 붙인다', () => {
    const out = withOfficerSummary('- 일시: 2026-10-07 10:00', lines(draft));
    expect(out).toContain(OFFICER_HEADER);
    expect(out.split('\n').length).toBeGreaterThan(8);
  });
});
