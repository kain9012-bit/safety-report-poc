/**
 * '내용' 칸 자동 작성 — AI 없이 템플릿으로 만든다.
 *
 * 지금 앱은 내용 칸이 빈칸이고, 신고인이 매번 "몇 시에 어디서 무슨 차가…"를 손으로 쓴다.
 * 그런데 그 문장의 재료(촬영시각·위치·유형·차량번호)는 이미 다른 칸에 있다.
 * 그래서 있는 값만 이어 붙인다. **없는 값은 지어내지 않고 문장에서 뺀다.**
 */
import { formatStamp } from './camera';
import { intervalSeconds, isValidPlate } from './rules';
import { VIOLATION_LABEL, locatedShot } from '../types/report';
import type { DraftReport } from '../types/report';

/** 지금 앱의 내용 칸 글자 수 제한 */
export const BODY_MIN = 5;
export const BODY_MAX = 900;

/**
 * 개조식으로 쓴다(회의 결정) — 받는 사람이 담당 공무원이라 줄글보다 항목이 빨리 읽힌다.
 * 값이 없는 항목은 줄째로 뺀다.
 */
export function composeBody(d: DraftReport): string {
  const first = d.shots[0];
  if (!first) return '';

  let where: string | undefined;
  if (d.address) where = d.address;
  else {
    const at = locatedShot(d.shots);
    if (at) where = `좌표 ${at.lat!.toFixed(5)}, ${at.lng!.toFixed(5)} 부근`;
  }
  const plate = d.plate?.replace(/\s/g, '');

  const lines = [`- 일시: ${formatStamp(first.takenAt).slice(0, 16)}`];
  if (where) lines.push(`- 장소: ${where}`);
  lines.push(`- 위반: ${d.type ? `${VIOLATION_LABEL[d.type]} 불법 주정차` : '불법 주정차'}`);
  if (plate && isValidPlate(plate)) lines.push(`- 차량: ${plate}`);

  const second = d.shots[1];
  if (second) {
    const gap = Math.floor(intervalSeconds(first.takenAt, second.takenAt));
    const ov = d.overlap ? `, 겹침 ${Math.round(d.overlap.ratio * 100)}%` : '';
    lines.push(`- 증거: 같은 자리 사진 2장(${gap}초 간격${ov})`);
  }
  return lines.join('\n');
}
