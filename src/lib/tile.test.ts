import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET, parseTile, vworldTileUrl } from '../../api/tile';

const q = (s: string) => new URLSearchParams(s);

describe('타일 요청 검사', () => {
  it('정상 요청', () => {
    expect(parseTile(q('layer=Base&z=17&x=111833&y=51327'))).toEqual({
      layer: 'Base',
      z: 17,
      x: 111833,
      y: 51327,
    });
  });
  it('레이어가 없으면 바탕지도', () => {
    expect(parseTile(q('z=10&x=1&y=1'))?.layer).toBe('Base');
  });
  it('모르는 레이어·범위 밖 레벨·범위 밖 번호·숫자 아님은 거른다', () => {
    expect(parseTile(q('layer=../../etc&z=10&x=1&y=1'))).toBeNull();
    expect(parseTile(q('z=5&x=1&y=1'))).toBeNull();
    expect(parseTile(q('z=20&x=1&y=1'))).toBeNull();
    expect(parseTile(q('z=10&x=1024&y=1'))).toBeNull(); // 10레벨은 0~1023
    expect(parseTile(q('z=10&x=-1&y=1'))).toBeNull();
    expect(parseTile(q('z=10&x=1.5&y=1'))).toBeNull();
  });
});

describe('타일 주소', () => {
  it('브이월드 WMTS는 {z}/{y}/{x} 순서, 항공사진은 jpeg', () => {
    expect(vworldTileUrl({ layer: 'Base', z: 17, x: 111833, y: 51327 }, 'K')).toBe(
      'https://api.vworld.kr/req/wmts/1.0.0/K/Base/17/51327/111833.png',
    );
    expect(vworldTileUrl({ layer: 'Satellite', z: 17, x: 1, y: 2 }, 'K')).toMatch(/\/Satellite\/17\/2\/1\.jpeg$/);
  });
});

describe('타일 서버 함수', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('키가 없으면 503', async () => {
    vi.stubEnv('VWORLD_KEY', '');
    const res = await GET(new Request('http://x/api/tile?z=10&x=1&y=1'));
    expect(res.status).toBe(503);
  });

  it('그림이 오면 오래 캐시한다', async () => {
    vi.stubEnv('VWORLD_KEY', 'K');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png' } })),
    );
    const res = await GET(new Request('http://x/api/tile?z=10&x=1&y=1'));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('s-maxage');
  });

  it('키 오류 문서(그림 아님)는 캐시하지 않고 502', async () => {
    vi.stubEnv('VWORLD_KEY', 'K');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<error>INVALID_KEY</error>', { headers: { 'content-type': 'text/xml' } })),
    );
    const res = await GET(new Request('http://x/api/tile?z=10&x=1&y=1'));
    expect(res.status).toBe(502);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});
