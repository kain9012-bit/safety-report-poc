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

export function composeBody(d: DraftReport): string {
  const first = d.shots[0];
  if (!first) return '';

  const when = formatStamp(first.takenAt).slice(0, 16); // 초는 뺀다

  let where: string | undefined;
  if (d.address) where = d.address;
  else {
    const at = locatedShot(d.shots);
    if (at) where = `좌표 ${at.lat!.toFixed(5)}, ${at.lng!.toFixed(5)} 부근`;
  }

  const plate = d.plate?.replace(/\s/g, '');
  const car = plate && isValidPlate(plate) ? `${plate} 차량이` : '차량이';
  const what = d.type
    ? `${VIOLATION_LABEL[d.type]}에 주정차되어 있어 신고합니다.`
    : '불법 주정차되어 있어 신고합니다.';

  const lines = [`${when}${where ? ` ${where}에서` : ''} ${car} ${what}`];

  const second = d.shots[1];
  if (second) {
    const gap = Math.floor(intervalSeconds(first.takenAt, second.takenAt));
    lines.push(`${gap}초 간격으로 같은 자리에서 2장 촬영했습니다.`);
  }
  return lines.join(' ');
}
