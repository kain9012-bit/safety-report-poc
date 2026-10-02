import { describe, expect, it } from 'vitest';
import { BODY_MAX, BODY_MIN, composeBody } from './compose';
import { locatedShot } from '../types/report';
import type { Shot } from '../types/report';

const T0 = new Date(2026, 9, 1, 14, 2, 11).getTime();
const shot = (dt: number, coord = true): Shot => ({
  takenAt: T0 + dt * 1000,
  dataUrl: '',
  ...(coord ? { lat: 35.82421, lng: 127.148, accuracy: 6 } : {}),
});

describe('내용 자동 작성 — 개조식', () => {
  it('사진이 없으면 아무것도 쓰지 않는다', () => {
    expect(composeBody({ shots: [] })).toBe('');
  });

  it('좌표가 없으면 장소 줄을 지어내지 않는다', () => {
    expect(composeBody({ shots: [shot(0, false)] })).toBe('- 일시: 2026-10-01 14:02\n- 위반: 불법 주정차');
  });

  it('주소가 없으면 좌표를 그대로 쓴다', () => {
    expect(composeBody({ shots: [shot(0)] })).toContain('- 장소: 좌표 35.82421, 127.14800 부근');
  });

  it('모든 값이 있으면 항목마다 한 줄', () => {
    const s = composeBody({
      shots: [shot(0), shot(64)],
      address: '전북특별자치도 전주시 완산구 노송광장로 10',
      plate: '12가 3456',
      type: 'crossing',
      overlap: { ratio: 0.82, score: 0.9, same: true },
    });
    expect(s).toBe(
      [
        '- 일시: 2026-10-01 14:02',
        '- 장소: 전북특별자치도 전주시 완산구 노송광장로 10',
        '- 위반: 횡단보도 불법 주정차',
        '- 차량: 12가3456',
        '- 증거: 같은 자리 사진 2장(64초 간격, 겹침 82%)',
      ].join('\n'),
    );
  });

  it('형식이 틀린 차량번호는 넣지 않는다', () => {
    const s = composeBody({ shots: [shot(0)], plate: '12가34' });
    expect(s).not.toContain('12가34');
    expect(s).not.toContain('- 차량');
  });

  it('지금 앱의 글자 수 제한(5~900자) 안에 든다', () => {
    const s = composeBody({
      shots: [shot(0), shot(61)],
      address: '서울특별시 '.repeat(20),
      plate: '서울123가4567',
      type: 'schoolzone',
    });
    expect(s.length).toBeGreaterThanOrEqual(BODY_MIN);
    expect(s.length).toBeLessThanOrEqual(BODY_MAX);
  });
});

describe('좌표가 한 장에만 있을 때', () => {
  it('첫 장에 좌표가 없어도 둘째 장 좌표로 장소를 쓴다', () => {
    expect(composeBody({ shots: [shot(0, false), shot(61)] })).toContain('- 장소: 좌표 35.82421, 127.14800 부근');
  });
  it('locatedShot은 좌표 있는 첫 컷을 고른다', () => {
    expect(locatedShot([shot(0, false), shot(61)])?.takenAt).toBe(T0 + 61_000);
    expect(locatedShot([shot(0, false)])).toBeUndefined();
  });
});
