/**
 * 첫 사진에 위반 유형이 둘 이상 보일 때 — **사람이 고르고, 앱은 규칙으로 추천만 한다.**
 *
 * 추천 순서(규칙):
 *  1. 찍은 시각이 그 유형의 단속 시간 안인가 (밖이면 신고해도 불수용)
 *  2. 과태료가 큰 유형 먼저 — 법이 더 무겁게 보는 위반 (예: 어린이보호구역 12만 원 > 소화전 8만 원)
 *  3. 위치자료(공공데이터)도 같은 말을 하는가 — 참고
 *  4. 사진 판독 규칙 순서(횡단보도·인도 → 소화전·정류장·모퉁이 → 보호구역)
 */
import { FINE_KRW, inEnforcement } from './localRules';
import type { AppliedRules } from './localRules';
import type { Candidate } from './recommend';
import { VIOLATION_LABEL } from '../types/report';
import type { ViolationType } from '../types/report';

export interface TypeOption {
  type: ViolationType;
  recommended: boolean;
  /** 단속 시간 안인가 */
  enforceable: boolean;
  /** 위치자료도 그렇다고 하는가 */
  coordAgrees: boolean;
  /** 화면에 보일 근거 한두 줄 */
  reasons: string[];
}

const won = (n: number) => `${n / 10_000}만 원`;

/** 받침에 맞는 조사 — '어린이보호구역을', '소화전 5m 이내를' */
export function josa(word: string, withFinal: string, withoutFinal: string): string {
  const c = word.charCodeAt(word.length - 1);
  if (c < 0xac00 || c > 0xd7a3) return `${word}${withFinal}(${withoutFinal})`;
  return word + ((c - 0xac00) % 28 ? withFinal : withoutFinal);
}
const L = (t: ViolationType) => VIOLATION_LABEL[t];

export function rankTypes(
  photoTypes: ViolationType[],
  opts: { takenAt: number; rules: AppliedRules; candidates?: Candidate[] },
): TypeOption[] {
  const uniq = [...new Set(photoTypes)];
  const rows = uniq.map((type, order) => {
    const enf = inEnforcement(opts.rules.types[type], opts.takenAt);
    const coordAgrees = Boolean(opts.candidates?.some((c) => c.type === type));
    return { type, order, enf, coordAgrees, fine: FINE_KRW[type] };
  });
  rows.sort(
    (a, b) =>
      Number(b.enf.ok) - Number(a.enf.ok) ||
      b.fine - a.fine ||
      Number(b.coordAgrees) - Number(a.coordAgrees) ||
      a.order - b.order,
  );
  return rows.map((r, i) => {
    const reasons: string[] = [];
    if (!r.enf.ok) reasons.push(`지금은 단속 시간이 아닙니다(${r.enf.text})`);
    reasons.push(`과태료 승용 ${won(r.fine)}`);
    if (r.coordAgrees) reasons.push('위치자료도 근처라고 합니다');
    return {
      type: r.type,
      recommended: i === 0 && r.enf.ok,
      enforceable: r.enf.ok,
      coordAgrees: r.coordAgrees,
      reasons,
    };
  });
}

/** 추천 이유 한 문장 — 목록 위에 쓴다 */
export function recommendLine(options: TypeOption[]): string {
  const top = options.find((o) => o.recommended);
  if (!top) return '보이는 유형 모두 지금은 단속 시간이 아닙니다.';
  const second = options.find((o) => o !== top);
  if (!second) return `${josa(L(top.type), '으로', '로')} 신고합니다.`;
  const pick = josa(L(top.type), '을', '를');
  if (!second.enforceable) return `${josa(L(second.type), '은', '는')} 지금 단속 시간이 아니어서 ${pick} 추천합니다.`;
  if (FINE_KRW[top.type] > FINE_KRW[second.type]) return `과태료가 더 큰 ${pick} 추천합니다.`;
  if (top.coordAgrees && !second.coordAgrees) return `위치자료와도 맞는 ${pick} 추천합니다.`;
  return `사진 판독 규칙 순서로 ${pick} 추천합니다.`;
}
