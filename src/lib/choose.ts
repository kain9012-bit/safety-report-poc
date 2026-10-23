/**
 * 첫 번째 사진에 위반 유형이 둘 이상 보일 때 — **사람이 고르고, 앱은 규칙으로 추천만 한다.**
 *
 * 추천 순서(규칙, 2026-10-23 결정):
 *  1. 찍은 시각이 그 유형의 단속 시간 안인가 (밖이면 신고해도 불수용 — 추천하지 않는다)
 *  2. 사진만으로 위반이 확인되는가 — 담당 공무원이 사진만 보고 "맞다"고 할 수 있는 유형 먼저(evidenceTier)
 *  3. 똑같이 확인되면 과태료가 무거운 유형 — 한 번 세운 차에 위반이 겹치면 가장 무거운 과태료 하나를
 *     매긴다(질서위반행위규제법 제13조 제1항). 입증되지 않은 위반은 매길 수 없으므로 2가 3보다 앞선다
 *  4. 사진 판독 규칙 순서(횡단보도·인도 위 → 소화전·정류장·모퉁이 옆 → 전용·보호구역 안)
 * 위치자료(공공데이터)는 판정 근거로 쓰지 않으므로 순서에 넣지 않고 이유 줄에만 적는다.
 */
import { FINE_KRW, inEnforcement } from './localRules';
import type { AppliedRules } from './localRules';
import type { Candidate } from './recommend';
import { VIOLATION_LABEL } from '../types/report';
import type { ViolationType } from '../types/report';
import type { Scene } from '../../api/vision';

export interface TypeOption {
  type: ViolationType;
  recommended: boolean;
  /** 단속 시간 안인가 */
  enforceable: boolean;
  /** 위치자료도 그렇다고 하는가(참고 — 순서에는 쓰지 않는다) */
  coordAgrees: boolean;
  /** 사진만으로 위반이 확인되는가(0) 따로 확인할 것이 남는가(1) */
  tier: 0 | 1;
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

/** 사진만으로는 확인되지 않아 따로 볼 것 — 이 유형이면 추천 순서가 뒤로 간다 */
const CHECK_NOTE: Partial<Record<ViolationType, string>> = {
  hydrant: '소화전과의 거리(5m)는 사진만으로 재지 못합니다',
  corner: '모퉁이와의 거리(5m)는 사진만으로 재지 못합니다',
  busstop: '정류소와의 거리(10m)는 사진만으로 재지 못합니다',
  firelane: '과태료 대상 건물(2018. 8. 10. 이후 허가)인지 따로 확인해야 합니다',
  evcharging: '일반 자동차도 세울 수 있는 칸인지 따로 확인해야 합니다',
  disabled: '앞유리에 장애인자동차표지가 없는지 확인되지 않았습니다',
  other: '사진 자동 판독 대상이 아닙니다',
};

/**
 * 사진만으로 위반이 확인되는 정도.
 *  0 — 횡단보도·인도 '위'(바퀴가 닿은 바닥), 어린이보호구역(표지·빨간 노면이 보일 때만 유형이 나온다),
 *      장애인전용구역(앞유리에 표지가 없는 것까지 보일 때)
 *  1 — 소화전·정류장·모퉁이(거리 요건), 소방차전용구역(대상 건물), 친환경차충전구역(일반차 겸용 구역),
 *      장애인전용구역(표지 여부 모름), 기타
 */
export function evidenceTier(type: ViolationType, scene?: Scene | null): 0 | 1 {
  if (type === 'disabled') return scene?.disabledPermit === 'no' ? 0 : 1;
  return CHECK_NOTE[type] ? 1 : 0;
}

export function rankTypes(
  photoTypes: ViolationType[],
  opts: { takenAt: number; rules: AppliedRules; candidates?: Candidate[]; scene?: Scene | null },
): TypeOption[] {
  const uniq = [...new Set(photoTypes)];
  const rows = uniq.map((type, order) => {
    const enf = inEnforcement(opts.rules.types[type], opts.takenAt);
    const coordAgrees = Boolean(opts.candidates?.some((c) => c.type === type));
    return { type, order, enf, coordAgrees, tier: evidenceTier(type, opts.scene), fine: FINE_KRW[type] };
  });
  rows.sort(
    (a, b) =>
      Number(b.enf.ok) - Number(a.enf.ok) ||
      a.tier - b.tier ||
      b.fine - a.fine ||
      a.order - b.order,
  );
  return rows.map((r, i) => {
    const reasons: string[] = [];
    if (!r.enf.ok) reasons.push(`지금은 단속 시간이 아닙니다(${r.enf.text})`);
    reasons.push(r.tier === 0 ? '사진만으로 확인됩니다' : CHECK_NOTE[r.type] ?? '따로 확인할 것이 있습니다');
    reasons.push(`과태료 승용 ${won(r.fine)}`);
    if (r.coordAgrees) reasons.push('위치자료도 근처라고 합니다(참고)');
    return {
      type: r.type,
      recommended: i === 0 && r.enf.ok,
      enforceable: r.enf.ok,
      coordAgrees: r.coordAgrees,
      tier: r.tier,
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
  if (top.tier < second.tier) return `사진만으로 확인되는 ${pick} 추천합니다.`;
  if (FINE_KRW[top.type] > FINE_KRW[second.type]) {
    return `둘 다 사진으로 확인되어, 더 무거운 ${pick} 추천합니다(한 번 세운 차에는 가장 무거운 과태료 하나가 매겨집니다).`;
  }
  return `사진 판독 순서로 ${pick} 추천합니다.`;
}
