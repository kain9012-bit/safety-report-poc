/**
 * 좌표 주변 버스정류장 중계.  GET /api/stops?lat=35.82&lng=127.14
 *
 * 국토교통부 (TAGO) 버스정류소정보 — 좌표기반 근접정류소 목록조회(반경 500m).
 * 공공데이터포털 키는 브라우저에 두지 않는다. 좌표는 기록·캐시하지 않는다.
 *
 * 이 파일은 다른 파일을 import 하지 않는다 — Vercel 함수로 따로 묶여도 깨지지 않게.
 */

export interface Stop {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

export type StopsError = 'bad_request' | 'no_key' | 'upstream';

export function parseLatLng(lat: string | null, lng: string | null): { lat: number; lng: number } | null {
  if (lat === null || lng === null || lat.trim() === '' || lng.trim() === '') return null;
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  if (la < 32.5 || la > 39 || ln < 124 || ln > 132.5) return null;
  return { lat: la, lng: ln };
}

export function tagoUrl(lat: number, lng: number, key: string): string {
  const q = new URLSearchParams({
    serviceKey: key,
    gpsLati: String(lat),
    gpsLong: String(lng),
    numOfRows: '50',
    pageNo: '1',
    _type: 'json',
  });
  return `https://apis.data.go.kr/1613000/BusSttnInfoInqireService/getCrdntPrxmtSttnList?${q}`;
}

/**
 * TAGO 응답 해석. 결과가 1건이면 item이 배열이 아니라 객체로, 0건이면 items가 빈 문자열로 온다.
 * 키 오류는 정상 JSON이 아니라 OpenAPI_ServiceResponse 로 온다.
 */
export function parseTago(json: unknown): Stop[] | 'upstream' {
  const j = json as {
    response?: { header?: { resultCode?: string }; body?: { items?: unknown } };
  };
  const r = j?.response;
  if (!r || (r.header?.resultCode && r.header.resultCode !== '00')) return 'upstream';
  const items = r.body?.items;
  if (!items || typeof items !== 'object') return [];
  const raw = (items as { item?: unknown }).item;
  const arr = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const out: Stop[] = [];
  for (const it of arr as Record<string, unknown>[]) {
    const lat = Number(it.gpslati);
    const lng = Number(it.gpslong);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    out.push({ id: String(it.nodeid ?? ''), name: String(it.nodenm ?? '').trim(), lat, lng });
  }
  return out;
}

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export async function GET(request: Request): Promise<Response> {
  const u = new URL(request.url);
  const p = parseLatLng(u.searchParams.get('lat'), u.searchParams.get('lng'));
  if (!p) return reply({ error: 'bad_request' }, 400);

  const key = process.env.DATA_GO_KR_KEY;
  if (!key) return reply({ error: 'no_key' }, 503);

  try {
    const res = await fetch(tagoUrl(p.lat, p.lng, key), { signal: AbortSignal.timeout(6000) });
    const text = await res.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return reply({ error: 'upstream' }, 502); // 키 오류는 XML로 오기도 한다
    }
    const out = parseTago(json);
    if (out === 'upstream') return reply({ error: 'upstream' }, 502);
    return reply({ stops: out });
  } catch {
    return reply({ error: 'upstream' }, 502);
  }
}
