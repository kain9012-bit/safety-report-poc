import { describe, expect, it } from 'vitest';
import { kstTime } from './kst';
import { evidenceTier, josa, rankTypes, recommendLine } from './choose';
import type { Scene } from '../../api/vision';
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
  it('사진만으로 확인되는 유형을 먼저 — 거리를 재야 하는 소화전보다 표지가 보이는 어린이보호구역', () => {
    const o = rankTypes(['hydrant', 'schoolzone'], { takenAt: weekday10, rules: national });
    expect(o[0]).toMatchObject({ type: 'schoolzone', recommended: true, tier: 0 });
    expect(o[1].tier).toBe(1);
    expect(recommendLine(o)).toBe('사진만으로 확인되는 어린이보호구역을 추천합니다.');
  });
  it('과태료가 더 커도 사진만으로 확인되지 않으면 뒤로 — 횡단보도 위(4만) > 소화전 옆(8만)', () => {
    const o = rankTypes(['hydrant', 'crossing'], { takenAt: weekday10, rules: national });
    expect(o.map((x) => x.type)).toEqual(['crossing', 'hydrant']);
    expect(o[1].reasons).toContain('소화전과의 거리(5m)는 사진만으로 재지 못합니다');
  });
  it('둘 다 사진으로 확인되면 더 무거운 쪽 — 횡단보도 위 + 어린이보호구역(평일 낮)', () => {
    const o = rankTypes(['crossing', 'schoolzone'], { takenAt: weekday10, rules: national });
    expect(o[0].type).toBe('schoolzone');
    expect(recommendLine(o)).toContain('둘 다 사진으로 확인되어, 더 무거운 어린이보호구역을 추천합니다');
  });
  it('장애인전용구역은 앞유리에 표지가 없는 것까지 보여야 사진만으로 확인된다', () => {
    const scene = (disabledPermit: Scene['disabledPermit']) => ({ disabledPermit }) as Scene;
    expect(evidenceTier('disabled', scene('no'))).toBe(0);
    expect(evidenceTier('disabled', scene('unclear'))).toBe(1);
    expect(evidenceTier('firelane')).toBe(1);
    expect(evidenceTier('evcharge')).toBe(1);
  });
  it('위치자료는 순서를 바꾸지 않는다(참고로만 적는다)', () => {
    const o = rankTypes(['crossing', 'busstop'], {
      takenAt: weekday10, rules: national, candidates: [{ type: 'busstop', level: 'likely', distance: 4, reason: '' }],
    });
    expect(o[0].type).toBe('crossing');
    expect(o[1].reasons).toContain('위치자료도 근처라고 합니다(참고)');
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
  it('확인 정도와 과태료가 같으면 사진 판독 순서', () => {
    const o = rankTypes(['crossing', 'sidewalk'], { takenAt: weekday10, rules: national });
    expect(o.map((x) => x.type)).toEqual(['crossing', 'sidewalk']);
    expect(recommendLine(o)).toBe('사진 판독 순서로 횡단보도를 추천합니다.');
  });
  it('같은 유형이 두 번 들어와도 한 번만', () => {
    expect(rankTypes(['crossing', 'crossing'], { takenAt: weekday10, rules: national })).toHaveLength(1);
  });
});
