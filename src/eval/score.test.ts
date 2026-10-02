import { describe, expect, it } from 'vitest';
import { parseAnswers, parseCsv, parseType, samePlate, score, toCsv, wilson } from './score';
import type { Outcome, Row } from './score';
import { decide } from './run';

describe('정답표 읽기', () => {
  it('BOM·따옴표·주석 줄을 다룬다', () => {
    const rows = parseCsv('﻿번호,메모\r\n# 예시\r\n1,"쉼표, 있음"\r\n');
    expect(rows).toEqual([['번호', '메모'], ['1', '쉼표, 있음']]);
  });
  it('한글 유형 이름을 받는다', () => {
    expect(parseType('교차로 모퉁이')).toBe('corner');
    expect(parseType('버스정류장')).toBe('busstop');
    expect(parseType('위반 아님')).toBe('none');
    expect(parseType('주차장')).toBeNull();
  });
  it('줄마다 읽고, 못 읽은 줄은 이유를 남긴다', () => {
    const p = parseAnswers(
      '번호,파일명,구분,정답유형,함께보이는유형,번호판,번호판보임,시간대,날씨,애매,메모\n' +
        '1,A.jpg,개선,횡단보도,소화전/인도,12가 3456,O,주간,맑음,X,\n' +
        '2,B.jpg,시험,모르는유형,,,,,,,\n' +
        '3,,개선,인도,,,,,,,',
    );
    expect(p.rows).toHaveLength(1);
    expect(p.rows[0]).toMatchObject({ file: 'A.jpg', split: 'dev', truth: 'crossing', also: ['hydrant', 'sidewalk'], plate: '12가3456', plateVisible: true });
    expect(p.problems).toHaveLength(2);
  });
});

const row = (o: Partial<Row> = {}): Row => ({
  id: '1', file: 'a.jpg', split: 'dev', truth: 'crossing', also: [], plate: '12가3456', plateVisible: true,
  time: '주간', weather: '', ambiguous: false, note: '', ...o,
});
const out = (o: Partial<Outcome> & { row?: Row } = {}): Outcome => ({
  row: row(), ok: true, auto: 'crossing', recommended: 'crossing', candidates: ['crossing'],
  plateFilled: '12가3456', plateRead: '12가3456', plateConfidence: 0.9, evidence: '', model: 'm', ...o,
});

describe('채점', () => {
  it('정답·오답·보류를 나눠 센다', () => {
    const s = score([
      out(),
      out({ auto: 'sidewalk', recommended: 'sidewalk', candidates: ['sidewalk'] }),
      out({ auto: 'none', recommended: 'none', candidates: [] }),
      out({ ok: false, error: 'busy' }),
      out({ row: row({ ambiguous: true }) }),
    ]);
    expect(s.n).toBe(3);
    expect(s.failed).toBe(1);
    expect(s.ambiguous).toBe(1);
    expect(s.type).toMatchObject({ correct: 1, wrong: 1, abstain: 1 });
  });
  it('위반 아님 사진을 위반으로 잡으면 오탐', () => {
    const s = score([out({ row: row({ truth: 'none' }), auto: 'crossing' }), out({ row: row({ truth: 'none' }), auto: 'none' })]);
    expect(s.falseAlarm).toEqual({ n: 2, count: 1 });
    expect(s.type.correct).toBe(1);
  });
  it('번호판 — 틀린 번호를 채우면 오채움, 안 보이는데 채워도 오채움', () => {
    const s = score([
      out(),
      out({ plateFilled: '12가3457' }),
      out({ plateFilled: '' }),
      out({ row: row({ plate: '', plateVisible: false }), plateFilled: '99나9999' }),
    ]);
    expect(s.plate).toMatchObject({ n: 4, correct: 1, wrong: 2, abstain: 1 });
  });
  it('정답에 뒤 4자리만 적었으면 끝자리로 본다', () => {
    expect(samePlate('12가3456', '3456')).toBe(true);
    expect(samePlate('12가3456', '12가3457')).toBe(false);
  });
  it('100건 중 95건이면 실제 범위는 약 89~98%', () => {
    const [lo, hi] = wilson(95, 100);
    expect(lo).toBeCloseTo(0.888, 2);
    expect(hi).toBeCloseTo(0.978, 2);
  });
  it('결과 CSV는 한셀용 BOM과 원인 칸을 담는다', () => {
    const csv = toCsv([out({ auto: 'sidewalk' })], { '1': 'AI 판독' });
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('AI 판독');
  });
});

describe('앱과 같은 규칙으로 정하기', () => {
  const sc = { onCrosswalk: 'yes', onSidewalk: 'no', busStopVisible: 'no', schoolZoneMarking: 'yes', intersectionCorner: 'no', fireHydrantNear: 'no' } as const;
  const vr = (conf: number, plate = { text: '12가3456', readable: true, confidence: 0.9 }) =>
    ({ photos: [{ plate, scene: sc, typeGuess: 'crossing', typeConfidence: conf, evidence: 'e', boxes: [] }], plate: { ...plate, agree: null, reads: [plate.text] }, sameVehicle: 'unclear', scene: sc, ruleTypes: ['crossing', 'schoolzone'], typeGuess: 'crossing', typeConfidence: conf, modelAgrees: true, evidence: 'e', model: 'm' }) as never;
  it('유형은 규칙 1순위, 추천은 과태료 기준', () => {
    const o = decide(row(), vr(0.9));
    expect(o.auto).toBe('crossing');
    expect(o.recommended).toBe('schoolzone');
    expect(o.candidates).toEqual(['crossing', 'schoolzone']);
  });
  it('확신이 기준(0.5) 아래면 비워 둔다', () => {
    expect(decide(row(), vr(0.3)).auto).toBe('none');
  });
  it('번호판은 확신 0.8 미만이거나 형식이 틀리면 채우지 않는다', () => {
    expect(decide(row(), vr(0.9, { text: '12가3456', readable: true, confidence: 0.7 })).plateFilled).toBe('');
    expect(decide(row(), vr(0.9, { text: '12가345', readable: true, confidence: 0.95 })).plateFilled).toBe('');
  });
});
