import { describe, expect, it } from 'vitest';
import { kstTime } from './kst';
import { josa, rankTypes, recommendLine } from './choose';
import { rulesFor } from './localRules';

const weekday10 = kstTime(2026, 10, 7, 10, 0, 0);
const saturday10 = kstTime(2026, 10, 10, 10, 0, 0);
const national = rulesFor(undefined);

describe('조사 — 받침에 맞게', () => {
  it('받침이 있으면 앞의 것, 없으면 뒤의 것', () => {
    expect(josa('어린이보호구역', '을', '를')).toBe('어린이보호구역을');
    expect(josa('횡단보도', '을', '를')).toBe('횡단보도를');
  });
  it('한글로 끝나지 않으면 둘 다 적는다', () => {
    expect(josa('소화전 5m', '을', '를')).toBe('소화전 5m을(를)');
  });
});

describe('사진 근거 중심 후보 안내', () => {
  it('하나뿐이어도 신고 적합성 확정 대신 후보로 표시', () => {
    const options = rankTypes(['crossing'], { takenAt: weekday10, rules: national });
    expect(recommendLine(options)).toContain('후보');
    expect(recommendLine(options)).not.toContain('신고합니다');
  });
  it('큰 과태료·가까운 GPS 때문에 후보 순서를 바꾸지 않는다', () => {
    const options = rankTypes(['hydrant', 'schoolzone'], { takenAt: weekday10, rules: national, candidates: [{ type: 'schoolzone', level: 'likely', distance: 1, reason: 'near' }] });
    expect(options.map((o) => o.type)).toEqual(['hydrant', 'schoolzone']);
    expect(options.every((o) => !o.recommended)).toBe(true);
    expect(options.flatMap((o) => o.reasons).join()).not.toContain('과태료');
  });
  it('시간 조건은 사진 관찰과 분리하고 후보를 삭제하지 않는다', () => {
    const options = rankTypes(['schoolzone', 'crossing'], { takenAt: saturday10, rules: national });
    expect(options.map((o) => o.type)).toEqual(['schoolzone', 'crossing']);
    expect(options[0].enforceable).toBe(false);
    expect(options[0].reasons.join()).toContain('시간 조건');
  });
  it('전용구역은 기본 6개 규정 적용 없이 선택할 수 있다', () => {
    expect(rankTypes(['evcharging', 'disabled'], { takenAt: weekday10, rules: national }).every((o) => o.reasons.join().includes('별도 확인'))).toBe(true);
  });
  it('같은 유형은 중복하지 않는다', () => {
    expect(rankTypes(['crossing', 'crossing'], { takenAt: weekday10, rules: national })).toHaveLength(1);
  });
});
