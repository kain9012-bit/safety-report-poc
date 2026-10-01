import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET, kakaoUrl, parseKakao, parseLatLng, parseVworld, vworldUrl } from '../../api/address';

describe('좌표 입력 검사', () => {
  it('정상 좌표', () => {
    expect(parseLatLng('35.8242', '127.148')).toEqual({ lat: 35.8242, lng: 127.148 });
  });
  it('빈값·숫자 아님·국외 좌표는 키를 쓰기 전에 거른다', () => {
    expect(parseLatLng(null, '127')).toBeNull();
    expect(parseLatLng('', '127')).toBeNull();
    expect(parseLatLng('abc', '127')).toBeNull();
    expect(parseLatLng('37.77', '-122.41')).toBeNull(); // 샌프란시스코
    expect(parseLatLng('127.148', '35.8242')).toBeNull(); // 위도·경도 뒤바뀜
  });
});

describe('요청 주소 — 경도·위도 순서', () => {
  it('브이월드 point는 경도,위도', () => {
    expect(vworldUrl(35.8, 127.1, 'K')).toContain('point=127.1%2C35.8');
  });
  it('카카오 x는 경도, y는 위도', () => {
    expect(kakaoUrl(35.8, 127.1)).toContain('x=127.1&y=35.8');
  });
});

describe('브이월드 응답', () => {
  it('도로명과 지번을 모두 꺼낸다', () => {
    const json = {
      response: {
        status: 'OK',
        result: [
          { type: 'parcel', text: '전북특별자치도 전주시 완산구 서노송동 568-1' },
          { type: 'road', text: '전북특별자치도 전주시 완산구 노송광장로 10' },
        ],
      },
    };
    expect(parseVworld(json)).toEqual({
      road: '전북특별자치도 전주시 완산구 노송광장로 10',
      parcel: '전북특별자치도 전주시 완산구 서노송동 568-1',
    });
  });
  it('도로명이 없는 곳은 지번만', () => {
    const json = { response: { status: 'OK', result: [{ type: 'parcel', text: '전북 완주군 ○○면 산1' }] } };
    expect(parseVworld(json)).toEqual({ road: undefined, parcel: '전북 완주군 ○○면 산1' });
  });
  it('NOT_FOUND는 못 찾음, 키 오류는 상류 오류', () => {
    expect(parseVworld({ response: { status: 'NOT_FOUND' } })).toBe('not_found');
    expect(
      parseVworld({ response: { status: 'ERROR', error: { code: 'INVALID_KEY' } } }),
    ).toBe('upstream');
    expect(parseVworld('이상한 응답')).toBe('upstream');
  });
});

describe('카카오 응답', () => {
  it('road_address가 null이면 지번만', () => {
    const json = { documents: [{ road_address: null, address: { address_name: '전북 전주시 완산구 서노송동 568-1' } }] };
    expect(parseKakao(json)).toEqual({ road: undefined, parcel: '전북 전주시 완산구 서노송동 568-1' });
  });
  it('빈 결과는 못 찾음', () => {
    expect(parseKakao({ documents: [] })).toBe('not_found');
  });
});

describe('서버 함수', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('키가 없으면 503 no_key — 지어낸 주소를 돌려주지 않는다', async () => {
    vi.stubEnv('VWORLD_KEY', '');
    vi.stubEnv('KAKAO_REST_KEY', '');
    const res = await GET(new Request('http://x/api/address?lat=35.8&lng=127.1'));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'no_key' });
  });

  it('브이월드 키가 있으면 브이월드를 부르고, 응답은 캐시하지 않는다', async () => {
    vi.stubEnv('VWORLD_KEY', 'K');
    const fetchMock = vi.fn(async () =>
      Response.json({ response: { status: 'OK', result: [{ type: 'road', text: '도로명 1' }] } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const res = await GET(new Request('http://x/api/address?lat=35.8&lng=127.1'));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ road: '도로명 1', provider: 'vworld' });
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain('api.vworld.kr');
  });

  it('상류가 죽으면 502', async () => {
    vi.stubEnv('VWORLD_KEY', 'K');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
    const res = await GET(new Request('http://x/api/address?lat=35.8&lng=127.1'));
    expect(res.status).toBe(502);
  });
});
