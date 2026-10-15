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

describe('추천 문장', () => {
  it('하나뿐이면 그 유형으로 신고', () => {
    const o = rankTypes(['crossing'], { takenAt: weekday10, rules: national });
    expect(recommendLine(o)).toBe('횡단보도로 신고합니다.');
  });
  it('과태료가 더 큰 쪽을 추천한다는 이유를 댄다', () => {
    const o = rankTypes(['hydrant', 'schoolzone'], { takenAt: weekday10, rules: national });
    expect(o[0].type).toBe('schoolzone');
    expect(o[0].recommended).toBe(true);
    expect(recommendLine(o)).toContain('과태료가 더 큰');
  });
  it('단속 시간 밖인 유형은 뒤로 보내고 그 이유를 댄다', () => {
    const o = rankTypes(['schoolzone', 'crossing'], { takenAt: saturday10, rules: national });
    expect(o[0].type).toBe('crossing');
    expect(o.find((x) => x.type === 'schoolzone')?.enforceable).toBe(false);
    expect(recommendLine(o)).toContain('단속 시간이 아니어서');
  });
  it('모두 단속 시간 밖이면 추천하지 않는다', () => {
    const o = rankTypes(['schoolzone'], { takenAt: saturday10, rules: national });
    expect(o[0].recommended).toBe(false);
    expect(recommendLine(o)).toBe('보이는 유형 모두 지금은 단속 시간이 아닙니다.');
  });
  it('과태료가 같으면 사진 판독 규칙 순서', () => {
    const o = rankTypes(['crossing', 'sidewalk'], { takenAt: weekday10, rules: national });
    expect(o.map((x) => x.type)).toEqual(['crossing', 'sidewalk']);
    expect(recommendLine(o)).toContain('사진 판독 규칙 순서');
  });
  it('같은 유형이 두 번 들어와도 한 번만', () => {
    expect(rankTypes(['crossing', 'crossing'], { takenAt: weekday10, rules: national })).toHaveLength(1);
  });
});
