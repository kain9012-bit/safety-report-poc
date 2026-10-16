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
const lines = (d: DraftReport, v: VisionResult | null = vision) => officerLines({ draft: d, precheck: pc(d, v), rules: rulesFor(d.address), minInterval: 60, vision: v });
/** 사진마다 AI 가 읽은 번호 — null 은 못 읽은 장 */
const perPhoto = (reads: ([string, number] | null)[], plate: Partial<VisionResult['plate']>) => ({
  ...vision,
  sameVehicle: 'unclear',
  photos: reads.map((r) => ({ plate: r ? { text: r[0], readable: true, confidence: r[1] } : { text: '', readable: false, confidence: 0 } })),
  plate: { ...vision.plate, ...plate },
}) as unknown as VisionResult;

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
    expect(l).toContain('- 차량번호: 12가3456(신고인 직접 입력) · AI 판독: 판독 결과 없음 — AI가 확실히 읽지 못함, 사진으로 번호 확인 필요');
    expect(l).toMatch(/확인 필요: .*두 장 번호판 일치/);
  });
  it('AI 가 못 읽은 번호는 출처와 사진별 판독을 맨 위에 적는다', () => {
    const v = perPhoto([null, ['12가3458', 0.62]], { text: '12가3458', readable: true, confidence: 0.62, agree: null, reads: ['12가3458'] });
    const l = lines({ ...draft, manual: { plate: true } }, v);
    expect(l[0]).toBe('- 차량번호: 12가3456(신고인 직접 입력) · AI 판독: 1장 못 읽음, 2장 12가3458(확신 62%) — AI가 확실히 읽지 못함, 사진으로 번호 확인 필요');
    expect(l.some((x) => x.startsWith('- 같은 차'))).toBe(false);
  });
  it('AI 판독과 다른 번호를 신고인이 확인하고 냈으면 그렇게 적는다', () => {
    const v = perPhoto([['12가3458', 0.93], ['12가3458', 0.91]], { text: '12가3458', reads: ['12가3458', '12가3458'], confidence: 0.91 });
    const l = lines({ ...draft, plateConfirmedFor: '12가3456' }, { ...v, sameVehicle: 'yes' });
    expect(l[0]).toBe('- 차량번호: 12가3456(신고인이 사진 보고 확인) · AI 판독: 1장 12가3458(확신 93%), 2장 12가3458(확신 91%) — AI 판독과 다름, 사진으로 번호 확인 필요');
  });
  it('빨간불 안내를 보고 그대로 냈으면 그 항목을 적고, 요약을 줄여도 남긴다', () => {
    const d = { ...draft, overlap: { ratio: 0.3, score: 0.2, same: false }, submittedWithReds: ['같은 자리 두 장'] };
    const l = lines(d);
    expect(l).toContain('- 고지 후 제출: 빨간불(같은 자리 두 장)과 불수용될 수 있다는 안내를 보고 신고인이 그대로 제출');
    expect(withOfficerSummary('가'.repeat(700), l)).toContain('- 고지 후 제출:');
  });
  it('요약을 줄여도 차량번호 확인 줄은 남긴다', () => {
    const body = '가'.repeat(700);
    const out = withOfficerSummary(body, lines(draft, null));
    expect(out.length).toBeLessThanOrEqual(900);
    expect(out).toContain('- 차량번호: 12가3456(신고인 직접 입력)');
  });
  it('지역 규정을 쓰면 그 지역과 확인일을 밝힌다', () => {
    const l = lines({ ...draft, address: '대전광역시 동구 동구청로 147' }).join('\n');
    expect(l).toContain('대전 동구 규정(확인 2026-09-18)');
  });
  it('없는 값은 지어내지 않는다 — 겹침을 못 쟀으면 그 줄을 뺀다', () => {
    expect(lines({ ...draft, overlap: undefined }).some((x) => x.startsWith('- 같은 자리'))).toBe(false);
  });
  it('6대 밖 유형은 그 유형 기준(사진 2장·1분 간격)으로 적고 같은 항목을 잰다', () => {
    const l = lines({ ...draft, type: 'disabled' }).join('\n');
    expect(l).toContain('- 적용 기준: 장애인전용주차구역 기준(사진 2장·1분 간격)');
    expect(l).toContain('- 간격: 61초(기준 60초) 충족');
    expect(l).toContain('접수 기한 충족');
  });
  it('내용 칸 900자를 넘지 않게 요약을 줄이고, 신고인 내용은 그대로 둔다', () => {
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


describe('요약 축약에도 확인 필요 항목을 보존한다', () => {
  it('공간이 부족하면 통과 항목부터 빼고 경고를 남긴다', () => {
    const body = '가'.repeat(800);
    const caution = '- 확인 필요: 위치 특정, 같은 자리 두 장';
    const result = withOfficerSummary(body, [
      '- 간격: 61초(기준 60초) 충족', '- 같은 차: 두 장에서 따로 읽은 번호 일치', caution,
    ]);
    expect(result.length).toBeLessThanOrEqual(900);
    expect(result.startsWith(body)).toBe(true);
    expect(result).toContain(caution);
  });
  it('경고까지 담을 공간이 없으면 통과 요약만 남기지 않는다', () => {
    const body = '가'.repeat(880);
    expect(withOfficerSummary(body, ['- 간격: 충족', '- 확인 필요: 위치 특정'])).toBe(body);
  });
});
