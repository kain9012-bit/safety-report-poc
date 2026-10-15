/** 사진 근거가 연결된 후보만 표시한다. 금액·GPS 근접으로 순서를 바꾸지 않는다. */
import { inEnforcement } from './localRules';
import type { AppliedRules } from './localRules';
import type { Candidate } from './recommend';
import { VIOLATION_LABEL, isBasicType } from '../types/report';
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
  return uniq.map((type) => {
    const enf = isBasicType(type) ? inEnforcement(opts.rules.types[type], opts.takenAt) : undefined;
    const coordAgrees = Boolean(opts.candidates?.some((c) => c.type === type));
    const reasons = ['사진 표시와 대상 차량의 연결을 확인한 후보'];
    if (enf && !enf.ok) reasons.push(`지역 시간 조건 확인 필요: ${enf.text}`);
    if (!enf) reasons.push('이 유형의 접수 요건은 별도 확인 필요');
    if (coordAgrees) reasons.push('주변 위치자료 있음 · 실제 거리 증명 아님');
    return { type, recommended: uniq.length === 1, enforceable: enf?.ok ?? true, coordAgrees, reasons };
  });
}

export function recommendLine(options: TypeOption[]): string {
  if (!options.length) return '사진 근거가 부족합니다. 유형을 직접 고르거나 미확인으로 보관할 수 있습니다.';
  if (options.length === 1) return `${L(options[0].type)} 후보입니다. 사진 근거를 확인해 주세요.`;
  return '여러 후보의 사진 근거를 비교하고 유형을 골라 주세요. 선택한 유형은 자동으로 바꾸지 않습니다.';
}
