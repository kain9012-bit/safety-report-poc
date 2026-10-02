import { describe, expect, it } from 'vitest';
import { FINE_KRW, describeRules, effectiveInterval, inEnforcement, maxInterval, rulesFor } from './localRules';
import { rankTypes, recommendLine } from './choose';
import { precheck } from './precheck';
import { INTERVAL_SEC, MIN_INTERVAL_SEC } from './rules';
import type { Verdict } from './crosscheck';
import type { DraftReport, Shot } from '../types/report';

const at = (y: number, m: number, d: number, h: number, min = 0) => new Date(y, m - 1, d, h, min).getTime();
// 2026-10-02 금요일, 2026-10-03 토요일
const FRI_10 = at(2026, 10, 2, 10);
const FRI_22 = at(2026, 10, 2, 22);
const SAT_10 = at(2026, 10, 3, 10);

describe('지자체 규정 찾기', () => {
  it('표에 없는 지자체는 전국 기준(6대 유형 1분)', () => {
    const r = rulesFor('전북특별자치도 전주시 완산구 노송광장로 10');
    expect(r.region).toBeUndefined();
    expect(maxInterval(r)).toBe(60);
    expect(describeRules(r)).toBe('전국 기준 · 두 장 1분 간격');
  });
  it('주소로 지자체를 찾아 그 지역 값을 덮는다 — 광명시 인도 단속 시간', () => {
    const r = rulesFor('경기도 광명시 철산로 1');
    expect(r.region).toBe('경기 광명시');
    expect(r.types.sidewalk.weekday).toEqual({ from: 7, to: 21 });
    expect(r.types.crossing.intervalSec).toBe(60);
  });
  it('주소를 모르면 전국 기준', () => {
    expect(rulesFor(undefined).region).toBeUndefined();
  });
  it('테스트용 간격이 더 짧으면 그것을 쓰고, 아니면 규정 간격', () => {
    expect(effectiveInterval(60)).toBe(INTERVAL_SEC < MIN_INTERVAL_SEC ? INTERVAL_SEC : 60);
  });
});

describe('단속 시간', () => {
  const nat = rulesFor();
  it('어린이보호구역은 평일 08~20시, 주말 제외', () => {
    expect(inEnforcement(nat.types.schoolzone, FRI_10).ok).toBe(true);
    expect(inEnforcement(nat.types.schoolzone, FRI_22).ok).toBe(false);
    expect(inEnforcement(nat.types.schoolzone, SAT_10).ok).toBe(false);
  });
  it('시간 규정이 없으면 24시간', () => {
    expect(inEnforcement(nat.types.hydrant, FRI_22)).toEqual({ ok: true, text: '24시간 단속' });
  });
  it('광명시 인도는 주말 09~18시', () => {
    const gm = rulesFor('경기도 광명시');
    expect(inEnforcement(gm.types.sidewalk, at(2026, 10, 3, 19)).ok).toBe(false);
    expect(inEnforcement(gm.types.sidewalk, at(2026, 10, 3, 12)).ok).toBe(true);
  });
});

describe('유형이 둘 이상 보일 때 추천(규칙)', () => {
  const rules = rulesFor();
  it('과태료가 큰 유형을 추천 — 어린이보호구역(12만) > 소화전(8만)', () => {
    const o = rankTypes(['hydrant', 'schoolzone'], { takenAt: FRI_10, rules });
    expect(o[0]).toMatchObject({ type: 'schoolzone', recommended: true });
    expect(o[1].recommended).toBe(false);
    expect(FINE_KRW.schoolzone).toBeGreaterThan(FINE_KRW.hydrant);
    expect(recommendLine(o)).toContain('과태료가 더 큰');
  });
  it('단속 시간 밖인 유형은 추천하지 않는다 — 밤 10시엔 소화전', () => {
    const o = rankTypes(['schoolzone', 'hydrant'], { takenAt: FRI_22, rules });
    expect(o[0].type).toBe('hydrant');
    expect(o.find((x) => x.type === 'schoolzone')!.enforceable).toBe(false);
    expect(recommendLine(o)).toContain('단속 시간이 아니어서');
  });
  it('과태료가 같으면 위치자료가 맞는 쪽', () => {
    const o = rankTypes(['crossing', 'busstop'], {
      takenAt: FRI_10,
      rules,
      candidates: [{ type: 'busstop', level: 'likely', distance: 4, reason: '' }],
    });
    expect(o[0].type).toBe('busstop');
    expect(o[0].coordAgrees).toBe(true);
  });
  it('그것도 같으면 사진 판독 규칙 순서', () => {
    const o = rankTypes(['crossing', 'busstop'], { takenAt: FRI_10, rules });
    expect(o.map((x) => x.type)).toEqual(['crossing', 'busstop']);
  });
});

describe('제출 전 점검 — 회의 결정 반영', () => {
  const shot = (t: number): Shot => ({ takenAt: t, lat: 35.8242, lng: 127.148, accuracy: 5, dataUrl: '' });
  const ok: Verdict = { type: 'busstop', source: 'photo_confirmed', suspicions: [], alternatives: [] };
  const base = (o: Partial<DraftReport> = {}): DraftReport => ({
    shots: [shot(FRI_10), shot(FRI_10 + 65_000)],
    type: 'busstop',
    plate: '12가3456',
    address: '전북특별자치도 전주시 완산구 노송광장로 10',
    overlap: { ratio: 0.8, score: 0.9, same: true },
    ...o,
  });
  const v = (sameVehicle: string, reads: string[]) => ({ sameVehicle, plate: { reads }, ruleTypes: ['busstop'] }) as never;
  const st = (d: DraftReport, vision: never, id: string) =>
    precheck({ draft: d, body: '내용입니다', verdict: ok, vision, now: FRI_10 + 600_000 }).checks.find((c) => c.id === id);

  it('번호판이 한 장에서만 읽히면 막는다', () => {
    const c = st(base(), v('unclear', ['12가3456']), 'vehicle')!;
    expect(c.status).toBe('fail');
    expect(c.detail).toContain('한 장에서만');
  });
  it('두 장 번호가 같으면 통과', () => {
    expect(st(base(), v('yes', ['12가3456', '12가3456']), 'vehicle')!.status).toBe('pass');
  });
  it('겹침이 기준 미달이면 막는다', () => {
    const c = st(base({ overlap: { ratio: 0.3, score: 0.7, same: false } }), v('yes', []), 'overlap')!;
    expect(c.status).toBe('fail');
    expect(c.detail).toContain('30%');
  });
  it('겹침을 못 쟀으면 확인만 요청', () => {
    expect(st(base({ overlap: undefined }), v('yes', []), 'overlap')!.status).toBe('warn');
  });
  it('주말에 찍은 어린이보호구역은 막는다', () => {
    const d = base({ type: 'schoolzone', shots: [shot(SAT_10), shot(SAT_10 + 65_000)] });
    const r = precheck({ draft: d, body: '내용입니다', verdict: { ...ok, type: 'schoolzone' }, vision: v('yes', []), now: SAT_10 + 600_000 });
    expect(r.checks.find((c) => c.id === 'hours')!.status).toBe('fail');
  });
  it('24시간 유형은 단속 시간 항목을 띄우지 않는다', () => {
    expect(st(base(), v('yes', []), 'hours')).toBeUndefined();
  });
  it('직접 골랐어도 사진에 보인 유형이면 사진 증거로 본다', () => {
    const d = base({ type: 'crossing', manual: { type: true } });
    const vision = { sameVehicle: 'yes', plate: { reads: [] }, ruleTypes: ['busstop', 'crossing'] } as never;
    const r = precheck({ draft: d, body: '내용입니다', verdict: ok, vision, now: FRI_10 + 600_000 });
    expect(r.checks.find((c) => c.id === 'evidence')!.status).toBe('pass');
  });
});

import { josa } from './choose';
import { pickResume } from './reports';
import type { ReportRecord } from './reports';

describe('문장 다듬기', () => {
  it('받침에 맞춰 조사를 붙인다', () => {
    expect(josa('어린이보호구역', '을', '를')).toBe('어린이보호구역을');
    expect(josa('소화전 5m 이내', '을', '를')).toBe('소화전 5m 이내를');
    expect(josa('ABC', '을', '를')).toBe('ABC을(를)');
  });
});

describe('이어하기', () => {
  const rec = (o: Partial<ReportRecord>): ReportRecord => ({
    id: 'x', phase: 'capture', step: 0, createdAt: FRI_10, updatedAt: FRI_10,
    draft: { shots: [{ takenAt: FRI_10, dataUrl: '' }] }, ...o,
  });
  it('제출 안 했고 사진이 있는 가장 최근 신고로 돌아간다', () => {
    const list = [rec({ id: 'a', phase: 'submitted' }), rec({ id: 'b' }), rec({ id: 'c' })];
    expect(pickResume(list, FRI_10 + 60_000)?.id).toBe('b');
  });
  it('사진이 없거나 기한이 지난 신고는 저절로 열지 않는다', () => {
    expect(pickResume([rec({ draft: { shots: [] } })], FRI_10)).toBeUndefined();
    expect(pickResume([rec({})], FRI_10 + 40 * 3600_000)).toBeUndefined();
  });
});
