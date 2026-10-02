/**
 * 판독 채점 — **사진 1장**을 앱과 같은 규칙으로 돌린 최종 결과를 정답표와 맞대 본다.
 *
 * 채점 대상은 AI 단독 답이 아니라 '규칙까지 거친 앱의 답'이다.
 *  - 유형: 서버 mergeReads(장면 항목 → 규칙 유형) → crosscheck(사진 증거 기준 0.5) → 앱이 채우는 유형
 *  - 추천: 유형이 여럿이면 rankTypes 가 맨 위에 올리는 유형
 *  - 번호판: 읽힘 · 확신 0.8 이상 · 형식 맞음 일 때만 채운다(한 장 기준). 아니면 비워 둔다(보류)
 *
 * 지표는 셋으로 나눈다 — 정답률 / 오답률 / 보류율. 앱은 모르면 비워 두므로 보류와 오답을 섞지 않는다.
 * 번호판은 '틀린 번호를 채운 비율'(오채움)이 가장 중요하다. 다른 사람에게 과태료가 가기 때문이다.
 */
import type { PhotoType, Scene } from '../../api/vision';

export type Truth = PhotoType; // 'none' = 위반 아님

export interface Row {
  id: string;
  file: string;
  /** 개선용 / 시험용 — 시험용은 발표 직전 한 번만 돌린다 */
  split: 'dev' | 'test' | '';
  truth: Truth;
  /** 사진에 함께 보이는 다른 유형 */
  also: Truth[];
  plate: string;
  plateVisible: boolean;
  time: string;
  weather: string;
  ambiguous: boolean;
  note: string;
}

export interface Outcome {
  row: Row;
  ok: boolean;
  error?: string;
  /** 앱이 자동으로 채우는 유형('none' = 비움) */
  auto: Truth;
  /** 유형이 여럿일 때 추천 맨 위(없으면 auto) */
  recommended: Truth;
  /** 사진에서 규칙이 뽑은 유형 전부 */
  candidates: Truth[];
  /** 앱이 채우는 번호판('' = 비움) */
  plateFilled: string;
  /** AI가 읽은 값(채우지 않았더라도) */
  plateRead: string;
  plateConfidence: number;
  scene?: Scene;
  evidence: string;
  model: string;
}

/* ---------------- 정답표 읽기 ---------------- */

const TYPE_WORDS: [RegExp, Truth][] = [
  [/^(hydrant|소화전)/, 'hydrant'],
  [/^(corner|교차로|모퉁이)/, 'corner'],
  [/^(busstop|버스|정류)/, 'busstop'],
  [/^(crossing|횡단)/, 'crossing'],
  [/^(schoolzone|어린이|보호구역)/, 'schoolzone'],
  [/^(sidewalk|인도|보도)/, 'sidewalk'],
  [/^(none|위반\s*아님|아님|없음|정상)/, 'none'],
];

export function parseType(s: string): Truth | null {
  const t = s.trim().replace(/\s+/g, '').toLowerCase();
  if (!t) return null;
  for (const [re, v] of TYPE_WORDS) if (re.test(t)) return v;
  return null;
}

const yes = (s: string) => /^(o|y|yes|예|네|1|true|보임|있음)$/i.test(s.trim());

/** CSV 한 줄씩 — 따옴표 안의 쉼표·줄바꿈을 지킨다 */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()) && !r[0].trim().startsWith('#'));
}

export const HEADER = ['번호', '파일명', '구분', '정답유형', '함께보이는유형', '번호판', '번호판보임', '시간대', '날씨', '애매', '메모'] as const;

export interface ParsedAnswers {
  rows: Row[];
  /** 읽지 못한 줄과 이유 */
  problems: string[];
}

export function parseAnswers(text: string): ParsedAnswers {
  const [head, ...body] = parseCsv(text);
  const problems: string[] = [];
  if (!head) return { rows: [], problems: ['빈 파일입니다'] };
  const col = (name: string) => head.findIndex((h) => h.trim() === name);
  const idx = Object.fromEntries(HEADER.map((h) => [h, col(h)])) as Record<(typeof HEADER)[number], number>;
  if (idx['파일명'] < 0 || idx['정답유형'] < 0) return { rows: [], problems: ['머리줄에 파일명·정답유형 칸이 없습니다'] };
  const get = (r: string[], k: (typeof HEADER)[number]) => (idx[k] >= 0 ? (r[idx[k]] ?? '').trim() : '');

  const rows: Row[] = [];
  body.forEach((r, i) => {
    const line = i + 2;
    const file = get(r, '파일명');
    const truth = parseType(get(r, '정답유형'));
    if (!file) return problems.push(`${line}줄: 파일명이 없습니다`);
    if (!truth) return problems.push(`${line}줄: 정답유형 '${get(r, '정답유형')}'을(를) 알 수 없습니다`);
    const split = get(r, '구분');
    rows.push({
      id: get(r, '번호') || String(rows.length + 1),
      file,
      split: /시험|test/i.test(split) ? 'test' : /개선|dev/i.test(split) ? 'dev' : '',
      truth,
      also: get(r, '함께보이는유형')
        .split(/[\/·,;]/)
        .map(parseType)
        .filter((t): t is Truth => Boolean(t) && t !== 'none'),
      plate: get(r, '번호판').replace(/\s/g, ''),
      plateVisible: idx['번호판보임'] >= 0 ? yes(get(r, '번호판보임')) : Boolean(get(r, '번호판')),
      time: get(r, '시간대'),
      weather: get(r, '날씨'),
      ambiguous: yes(get(r, '애매')),
      note: get(r, '메모'),
    });
  });
  return { rows, problems };
}

/* ---------------- 채점 ---------------- */

/** 95% 신뢰구간(윌슨) — 표본이 작을 때 '실제 실력'의 범위 */
export function wilson(k: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 0];
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

export interface Rate {
  n: number;
  correct: number;
  wrong: number;
  abstain: number;
  rate: number;
  ci: [number, number];
}

const rate = (n: number, correct: number, wrong: number, abstain: number): Rate => ({
  n,
  correct,
  wrong,
  abstain,
  rate: n ? correct / n : 0,
  ci: wilson(correct, n),
});

/** 번호판 비교 — 정답에 뒤 4자리만 적었으면 끝자리로 본다 */
export function samePlate(read: string, truth: string): boolean {
  const a = read.replace(/\s/g, '');
  const b = truth.replace(/\s/g, '');
  if (!a || !b) return false;
  return /^\d{4}$/.test(b) ? a.endsWith(b) : a === b;
}

export interface Score {
  /** 채점한 장수(판독 실패·애매 제외) */
  n: number;
  failed: number;
  ambiguous: number;
  /** 앱이 자동으로 채우는 유형 기준 */
  type: Rate;
  /** 유형이 여럿일 때 추천 맨 위 기준 */
  recommended: Rate;
  /** 정답 유형이 사진 판독 후보 안에 있었나 */
  contained: Rate;
  /** 위반 아님 사진을 위반으로 잡은 수 */
  falseAlarm: { n: number; count: number };
  plate: Rate;
  /** 정답 → 앱 답 */
  confusion: Record<string, Record<string, number>>;
  byTime: Record<string, Rate>;
}

export const TYPE_ORDER: Truth[] = ['crossing', 'sidewalk', 'hydrant', 'busstop', 'corner', 'schoolzone', 'none'];

export function score(outs: Outcome[]): Score {
  const failed = outs.filter((o) => !o.ok).length;
  const amb = outs.filter((o) => o.ok && o.row.ambiguous).length;
  const use = outs.filter((o) => o.ok && !o.row.ambiguous);

  const typeOf = (pick: (o: Outcome) => Truth, list: Outcome[]) => {
    let c = 0;
    let w = 0;
    let a = 0;
    for (const o of list) {
      const got = pick(o);
      if (got === o.row.truth) c++;
      else if (got === 'none') a++;
      else w++;
    }
    return rate(list.length, c, w, a);
  };

  const viol = use.filter((o) => o.row.truth !== 'none');
  const contained = viol.filter((o) => o.candidates.includes(o.row.truth)).length;
  const neg = use.filter((o) => o.row.truth === 'none');

  // 번호판 — 보이는 사진: 맞게 채움/틀리게 채움/비움, 안 보이는 사진: 채우면 오채움
  let pc = 0;
  let pw = 0;
  let pa = 0;
  for (const o of use) {
    if (o.row.plateVisible && o.row.plate) {
      if (!o.plateFilled) pa++;
      else if (samePlate(o.plateFilled, o.row.plate)) pc++;
      else pw++;
    } else if (o.plateFilled) pw++;
  }
  const plateN = use.filter((o) => (o.row.plateVisible && o.row.plate) || o.plateFilled).length;

  const confusion: Score['confusion'] = {};
  for (const o of use) {
    confusion[o.row.truth] ??= {};
    confusion[o.row.truth][o.auto] = (confusion[o.row.truth][o.auto] ?? 0) + 1;
  }

  const byTime: Score['byTime'] = {};
  for (const t of [...new Set(use.map((o) => o.row.time || '미기재'))]) {
    byTime[t] = typeOf((o) => o.auto, use.filter((o) => (o.row.time || '미기재') === t));
  }

  return {
    n: use.length,
    failed,
    ambiguous: amb,
    type: typeOf((o) => o.auto, use),
    recommended: typeOf((o) => o.recommended, use),
    contained: rate(viol.length, contained, viol.length - contained, 0),
    falseAlarm: { n: neg.length, count: neg.filter((o) => o.auto !== 'none').length },
    plate: rate(plateN, pc, pw, pa),
    confusion,
    byTime,
  };
}

/** 결과 내보내기 — 한셀·엑셀에서 열리게 BOM 붙인 CSV */
export function toCsv(outs: Outcome[], causes: Record<string, string>): string {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const head = ['번호', '파일명', '구분', '정답유형', '앱유형', '추천유형', '후보', '정답여부', '정답번호판', '앱번호판', '읽은값', '확신', '근거', '틀린원인', '모델', '오류'];
  const lines = outs.map((o) =>
    [
      o.row.id,
      o.row.file,
      o.row.split,
      o.row.truth,
      o.auto,
      o.recommended,
      o.candidates.join('/'),
      !o.ok ? '판독실패' : o.auto === o.row.truth ? 'O' : o.auto === 'none' ? '보류' : 'X',
      o.row.plate,
      o.plateFilled,
      o.plateRead,
      o.plateConfidence.toFixed(2),
      o.evidence,
      causes[o.row.id] ?? '',
      o.model,
      o.error ?? '',
    ]
      .map((v) => esc(String(v)))
      .join(','),
  );
  return '﻿' + [head.join(','), ...lines].join('\r\n');
}
