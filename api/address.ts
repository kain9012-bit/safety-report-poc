/**
 * 좌표 → 주소 (역지오코딩) 중계 함수.  GET /api/address?lat=35.82&lng=127.14
 *
 * 키를 브라우저에 두지 않으려고 서버에서 부른다. VWORLD_KEY가 있으면 브이월드,
 * 없고 KAKAO_REST_KEY가 있으면 카카오를 쓴다. 둘 다 없으면 503 — 화면은 좌표만 보여준다.
 *
 * 좌표는 신고인의 위치다. 기록(log)하지 않고, 응답도 캐시하지 않는다.
 *
 * 이 파일은 다른 파일을 import 하지 않는다 — Vercel 함수로 따로 묶여도 깨지지 않게.
 */

export interface AddressResult {
  /** 도로명주소. 도로명이 없는 곳(논밭·산)은 비어 있다. */
  road?: string;
  /** 지번주소 */
  parcel?: string;
  provider: 'vworld' | 'kakao';
}

export type AddressError = 'bad_request' | 'no_key' | 'not_found' | 'upstream';

/** 대한민국 대략 범위. 밖이면 키를 쓰기 전에 거른다. */
export function parseLatLng(lat: string | null, lng: string | null): { lat: number; lng: number } | null {
  if (lat === null || lng === null || lat.trim() === '' || lng.trim() === '') return null;
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  if (la < 32.5 || la > 39 || ln < 124 || ln > 132.5) return null;
  return { lat: la, lng: ln };
}

/** 브이월드 Geocoder API 2.0 — getAddress. point는 '경도,위도' 순서다. */
export function vworldUrl(lat: number, lng: number, key: string, domain?: string): string {
  const q = new URLSearchParams({
    service: 'address',
    request: 'getAddress',
    version: '2.0',
    crs: 'epsg:4326',
    point: `${lng},${lat}`,
    format: 'json',
    type: 'both',
    zipcode: 'false',
    simple: 'false',
    key,
  });
  if (domain) q.set('domain', domain);
  return `https://api.vworld.kr/req/address?${q}`;
}

/** 브이월드 응답 해석. status가 OK가 아니면 이유를 돌려준다. */
export function parseVworld(json: unknown): Omit<AddressResult, 'provider'> | AddressError {
  const r = (json as { response?: { status?: string; result?: unknown } })?.response;
  if (!r) return 'upstream';
  if (r.status === 'NOT_FOUND') return 'not_found';
  if (r.status !== 'OK' || !Array.isArray(r.result)) return 'upstream';
  const items = r.result as { type?: string; text?: string }[];
  const road = items.find((i) => i.type === 'road')?.text?.trim() || undefined;
  const parcel = items.find((i) => i.type === 'parcel')?.text?.trim() || undefined;
  if (!road && !parcel) return 'not_found';
  return { road, parcel };
}

/** 카카오 로컬 API — 좌표로 주소 변환. x가 경도, y가 위도다. */
export function kakaoUrl(lat: number, lng: number): string {
  return `https://dapi.kakao.com/v2/local/geo/coord2address.json?x=${lng}&y=${lat}`;
}

export function parseKakao(json: unknown): Omit<AddressResult, 'provider'> | AddressError {
  const docs = (json as { documents?: unknown })?.documents;
  if (!Array.isArray(docs)) return 'upstream';
  const d = docs[0] as
    | { road_address?: { address_name?: string } | null; address?: { address_name?: string } | null }
    | undefined;
  const road = d?.road_address?.address_name?.trim() || undefined;
  const parcel = d?.address?.address_name?.trim() || undefined;
  if (!road && !parcel) return 'not_found';
  return { road, parcel };
}

const STATUS: Record<AddressError, number> = {
  bad_request: 400,
  no_key: 503,
  not_found: 404,
  upstream: 502,
};

function reply(body: AddressResult | { error: AddressError }, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export async function GET(request: Request): Promise<Response> {
  const u = new URL(request.url);
  const p = parseLatLng(u.searchParams.get('lat'), u.searchParams.get('lng'));
  if (!p) return reply({ error: 'bad_request' }, STATUS.bad_request);

  const vworld = process.env.VWORLD_KEY;
  const kakao = process.env.KAKAO_REST_KEY;

  try {
    if (vworld) {
      const res = await fetch(vworldUrl(p.lat, p.lng, vworld, process.env.VWORLD_DOMAIN), {
        signal: AbortSignal.timeout(6000),
      });
      const out = parseVworld(await res.json());
      if (typeof out === 'string') return reply({ error: out }, STATUS[out]);
      return reply({ ...out, provider: 'vworld' });
    }
    if (kakao) {
      const res = await fetch(kakaoUrl(p.lat, p.lng), {
        headers: { Authorization: `KakaoAK ${kakao}` },
        signal: AbortSignal.timeout(6000),
      });
      const out = parseKakao(await res.json());
      if (typeof out === 'string') return reply({ error: out }, STATUS[out]);
      return reply({ ...out, provider: 'kakao' });
    }
  } catch {
    return reply({ error: 'upstream' }, STATUS.upstream);
  }
  return reply({ error: 'no_key' }, STATUS.no_key);
}
