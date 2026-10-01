/**
 * 지도 타일 중계.  GET /api/tile?layer=Base&z=17&x=111833&y=51327
 *
 * 브이월드 WMTS 타일 주소에는 인증키가 그대로 들어간다. 키를 브라우저에 두지 않으려고 서버에서 받아 넘긴다.
 * 바탕지도는 누구에게나 같은 그림이라 CDN에 오래 캐시해 함수 호출을 줄인다(좌표가 아니라 타일 번호만 오간다).
 *
 * 이 파일은 다른 파일을 import 하지 않는다 — Vercel 함수로 따로 묶여도 깨지지 않게.
 */

const LAYERS = {
  Base: { ext: 'png', type: 'image/png' },
  Satellite: { ext: 'jpeg', type: 'image/jpeg' },
  Hybrid: { ext: 'png', type: 'image/png' },
} as const;

export type TileLayer = keyof typeof LAYERS;

export interface TileReq {
  layer: TileLayer;
  z: number;
  x: number;
  y: number;
}

/** 브이월드 바탕지도는 6~19 레벨. 범위 밖·숫자 아님은 키를 쓰기 전에 거른다. */
export function parseTile(q: URLSearchParams): TileReq | null {
  const layer = (q.get('layer') ?? 'Base') as TileLayer;
  if (!(layer in LAYERS)) return null;
  const [z, x, y] = ['z', 'x', 'y'].map((k) => {
    const v = q.get(k);
    return v !== null && /^\d+$/.test(v) ? Number(v) : NaN;
  });
  if (![z, x, y].every(Number.isInteger)) return null;
  if (z < 6 || z > 19) return null;
  const n = 2 ** z;
  if (x >= n || y >= n) return null;
  return { layer, z, x, y };
}

/** WMTS 타일 주소 — 순서가 {z}/{y}/{x} 다(행이 먼저). */
export function vworldTileUrl(t: TileReq, key: string): string {
  return `https://api.vworld.kr/req/wmts/1.0.0/${key}/${t.layer}/${t.z}/${t.y}/${t.x}.${LAYERS[t.layer].ext}`;
}

export async function GET(request: Request): Promise<Response> {
  const t = parseTile(new URL(request.url).searchParams);
  if (!t) return new Response('bad tile', { status: 400 });

  const key = process.env.VWORLD_KEY;
  if (!key) return new Response('no key', { status: 503, headers: { 'cache-control': 'no-store' } });

  try {
    const domain = process.env.VWORLD_DOMAIN;
    const up = await fetch(vworldTileUrl(t, key), {
      headers: domain ? { Referer: domain.endsWith('/') ? domain : `${domain}/` } : undefined,
      signal: AbortSignal.timeout(8000),
    });
    const type = up.headers.get('content-type') ?? '';
    // 키 오류는 이미지가 아니라 오류 문서로 온다 — 그걸 그림인 척 캐시하지 않는다
    if (!up.ok || !type.startsWith('image/')) {
      return new Response('upstream', { status: 502, headers: { 'cache-control': 'no-store' } });
    }
    return new Response(await up.arrayBuffer(), {
      status: 200,
      headers: {
        'content-type': LAYERS[t.layer].type,
        'cache-control': 'public, max-age=86400, s-maxage=2592000, immutable',
      },
    });
  } catch {
    return new Response('upstream', { status: 502, headers: { 'cache-control': 'no-store' } });
  }
}
