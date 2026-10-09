import { describe, expect, it } from 'vitest';
import { CELL_DEG, cellOf, cellsAround, mergeCells, mergeStops } from './facilities';

describe('시설 격자 — 수집 스크립트와 같은 규칙', () => {
  it('칸 크기는 0.01도(scripts/collect_facilities.py 의 CELL_DEG 와 같아야 한다)', () => {
    expect(CELL_DEG).toBe(0.01);
  });
  it('좌표를 내림으로 칸에 넣는다', () => {
    expect(cellOf({ lat: 35.8242, lng: 127.148 })).toEqual([3582, 12714]);
  });
  it('주변 3×3칸, 가운데가 자기 칸', () => {
    const cells = cellsAround({ lat: 35.8242, lng: 127.148 });
    expect(cells).toHaveLength(9);
    expect(cells[4]).toBe('3582_12714');
    expect(cells).toContain('3581_12713');
    expect(cells).toContain('3583_12715');
  });
  it('여러 칸을 합치고, 빈 칸(null)은 건너뛴다', () => {
    const n = mergeCells([{ c: [[35.1, 127.1]], s: [[35.2, 127.2, '초교']] }, null, { b: [[35.3, 127.3, '정류장']] }]);
    expect(n.crosswalks).toHaveLength(1);
    expect(n.schools[0].name).toBe('초교');
    expect(n.busstops[0].name).toBe('정류장');
  });
  it('실시간 정류장과 파일 정류장이 3m 안이면 하나로(실시간 쪽을 남김)', () => {
    const live = [{ id: 'L', lat: 35.8, lng: 127.1, name: '실시간' }];
    const file = [
      { id: 'F1', lat: 35.80001, lng: 127.1, name: '파일-같은 곳' },
      { id: 'F2', lat: 35.801, lng: 127.1, name: '파일-다른 곳' },
    ];
    expect(mergeStops(live, file).map((s) => s.id)).toEqual(['L', 'F2']);
  });
});
