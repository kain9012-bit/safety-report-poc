import { describe, expect, it } from 'vitest';
import { recommend } from './recommend';
import { cellsAround, mergeCells, mergeStops } from './facilities';
import { parseTago, tagoUrl } from '../../api/stops';

const BASE = { lat: 35.8242, lng: 127.148 };
const north = (d: number) => ({ lat: BASE.lat + d / 111_320, lng: BASE.lng });
const empty = { busstops: [], crosswalks: [], schools: [] };

describe('위반유형 추천', () => {
  it('주변에 아무것도 없으면 후보 없음 — 유형을 지어내지 않는다', () => {
    expect(recommend({ ...BASE, accuracy: 5 }, empty)).toEqual([]);
  });

  it('정류장 3m, 오차 5m라도 촬영자의 탐색 후보일 뿐 위반 유력이 아니다', () => {
    const c = recommend({ ...BASE, accuracy: 5 }, { ...empty, busstops: [{ id: '1', name: '전주시청', ...north(3) }] });
    expect(c[0]).toMatchObject({ type: 'busstop', level: 'possible', name: '전주시청' });
    expect(c[0].reason).toContain('약 3m');
  });

  it('정류장 8m, 오차 8m → 가능(확정 못 함)', () => {
    const c = recommend({ ...BASE, accuracy: 8 }, { ...empty, busstops: [{ id: '1', name: 'A', ...north(8) }] });
    expect(c[0]).toMatchObject({ type: 'busstop', level: 'possible' });
  });

  it('정류장 40m도 탐색에 남고 500m 밖은 이 탐색 요약에서 제외한다', () => {
    expect(recommend({ ...BASE, accuracy: 8 }, { ...empty, busstops: [{ id: '1', ...north(40) }] })[0]).toMatchObject({ level: 'possible', type: 'busstop' });
    expect(recommend({ ...BASE, accuracy: 8 }, { ...empty, busstops: [{ id: '1', ...north(600) }] })).toEqual([]);
  });

  it('횡단보도는 가까워도 가능까지만 — 위에 섰는지는 사진으로', () => {
    const c = recommend({ ...BASE, accuracy: 3 }, { ...empty, crosswalks: [{ id: 'c', ...north(2) }] });
    expect(c[0]).toMatchObject({ type: 'crossing', level: 'possible' });
  });

  it('학교 200m → 어린이보호구역 가능, 400m → 아님', () => {
    const near = recommend({ ...BASE, accuracy: 5 }, { ...empty, schools: [{ id: 's', name: '중앙초등학교', ...north(200) }] });
    expect(near[0]).toMatchObject({ type: 'schoolzone', level: 'possible', name: '중앙초등학교' });
    expect(recommend({ ...BASE, accuracy: 5 }, { ...empty, schools: [{ id: 's', ...north(400) }] })).toEqual([]);
  });

  it('모두 참고 후보이며 각 탐색 범위 대비 가까움으로만 나열한다', () => {
    const c = recommend(
      { ...BASE, accuracy: 3 },
      {
        busstops: [{ id: 'b', name: 'B', ...north(4) }],
        crosswalks: [{ id: 'c', ...north(1) }],
        schools: [{ id: 's', ...north(50) }],
      },
    );
    expect(c.map((x) => x.type)).toEqual(['busstop', 'crossing', 'schoolzone']);
  });
});

describe('격자 파일', () => {
  it('주변 3×3칸', () => {
    const cells = cellsAround({ lat: 35.8242, lng: 127.148 });
    expect(cells).toHaveLength(9);
    expect(cells).toContain('3582_12714');
    expect(cells).toContain('3581_12713');
    expect(cells).toContain('3583_12715');
  });
  it('칸을 합치면 시설 목록이 된다(빈 칸은 건너뜀)', () => {
    const m = mergeCells([{ c: [[35.1, 127.1]], s: [[35.2, 127.2, '초등학교']] }, null, { c: [[35.3, 127.3]] }]);
    expect(m.crosswalks).toHaveLength(2);
    expect(m.schools[0].name).toBe('초등학교');
  });
});

describe('정류장 합치기', () => {
  it('가까운 정류장도 출처·ID가 다르면 합치지 않는다', () => {
    const live = [{ id: 'L', name: '실시간', ...north(0) }];
    const file = [{ id: 'F1', name: '파일', ...north(1) }, { id: 'F2', name: '파일2', ...north(30) }];
    expect(mergeStops(live, file).map((s) => s.id)).toEqual(['L', 'F1', 'F2']);
  });
  it('격자 파일의 정류장(b)도 읽는다 — 서울은 실시간 API에 없다', () => {
    expect(mergeCells([{ b: [[37.5665, 126.978, '시청앞']] }]).busstops[0].name).toBe('시청앞');
  });
});

describe('버스정류장 API 응답', () => {
  it('요청 주소에 위도·경도를 그대로', () => {
    expect(tagoUrl(35.8, 127.1, 'K')).toContain('gpsLati=35.8&gpsLong=127.1');
  });
  it('여러 건은 배열, 한 건은 객체, 0건은 빈 문자열로 온다', () => {
    const many = { response: { header: { resultCode: '00' }, body: { items: { item: [
      { nodeid: 'JJB1', nodenm: '전주시청', gpslati: 35.8243, gpslong: 127.1481 },
      { nodeid: 'JJB2', nodenm: '시청 건너편', gpslati: '35.8240', gpslong: '127.1479' },
    ] } } } };
    expect(parseTago(many)).toHaveLength(2);
    const one = { response: { header: { resultCode: '00' }, body: { items: { item: { nodeid: 'X', nodenm: 'A', gpslati: 35.1, gpslong: 127.1 } } } } };
    expect(parseTago(one)).toEqual([{ id: 'X', name: 'A', lat: 35.1, lng: 127.1, source: 'TAGO' }]);
    const none = { response: { header: { resultCode: '00' }, body: { items: '' } } };
    expect(parseTago(none)).toEqual([]);
  });
  it('키 오류 응답은 상류 오류', () => {
    expect(parseTago({ OpenAPI_ServiceResponse: { cmmMsgHeader: { errMsg: 'SERVICE_KEY_IS_NOT_REGISTERED_ERROR' } } })).toBe('upstream');
    expect(parseTago({ response: { header: { resultCode: '30' } } })).toBe('upstream');
  });
});
