/** TAGO nearby stop discovery. Server key stays private; no coordinate logs/cache. */
export interface Stop {
  id: string;
  name: string;
  lat: number;
  lng: number;
  source: 'TAGO';
  regionCode?: string;
  publicId?: string;
  publicIdNamespace?: string;
}
export type StopsError = 'bad_request' | 'no_key' | 'upstream';
export function parseLatLng(lat: string | null, lng: string | null): { lat: number; lng: number } | null {
  if (lat === null || lng === null || lat.trim() === '' || lng.trim() === '') return null;
  const la = Number(lat); const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln) || la < 32.5 || la > 39 || ln < 124 || ln > 132.5) return null;
  return { lat: la, lng: ln };
}
export function tagoUrl(lat: number, lng: number, key: string, page = 1): string {
  const q = new URLSearchParams({ serviceKey: key, gpsLati: String(lat), gpsLong: String(lng), numOfRows: '50', pageNo: String(page), _type: 'json' });
  return `https://apis.data.go.kr/1613000/BusSttnInfoInqireService/getCrdntPrxmtSttnList?${q}`;
}
export interface TagoPage { stops: Stop[]; totalCount?: number; rawCount: number }
export function parseTagoPage(json: unknown): TagoPage | 'upstream' {
  const j = json as { response?: { header?: { resultCode?: string | number }; body?: { items?: unknown; totalCount?: unknown } } };
  const r = j?.response;
  if (!r?.body || (r.header?.resultCode !== undefined && String(r.header.resultCode) !== '00' && String(r.header.resultCode) !== '0')) return 'upstream';
  const raw = r.body.items && typeof r.body.items === 'object' ? (r.body.items as { item?: unknown }).item : undefined;
  const arr = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const stops: Stop[] = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const it = item as Record<string, unknown>;
    if (it.gpslati === null || it.gpslati === '' || it.gpslong === null || it.gpslong === '') continue;
    const p = parseLatLng(String(it.gpslati), String(it.gpslong));
    const id = String(it.nodeid ?? '').trim();
    if (!p || !id) continue;
    const regionCode = String(it.citycode ?? '').trim() || undefined;
    const publicId = String(it.nodeno ?? '').trim() || undefined;
    stops.push({ id, name: String(it.nodenm ?? '').trim(), ...p, source: 'TAGO', ...(regionCode ? { regionCode } : {}), ...(publicId ? { publicId } : {}), ...(publicId && regionCode ? { publicIdNamespace: `TAGO:${regionCode}:nodeno` } : {}) });
  }
  const total = r.body.totalCount === null || r.body.totalCount === '' || r.body.totalCount === undefined ? NaN : Number(r.body.totalCount);
  return { stops, rawCount: arr.length, ...(Number.isSafeInteger(total) && total >= 0 ? { totalCount: total } : {}) };
}
export function parseTago(json: unknown): Stop[] | 'upstream' {
  const page = parseTagoPage(json); return page === 'upstream' ? page : page.stops;
}
function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}
export async function GET(request: Request): Promise<Response> {
  const u = new URL(request.url);
  const p = parseLatLng(u.searchParams.get('lat'), u.searchParams.get('lng'));
  if (!p) return reply({ error: 'bad_request' }, 400);
  const key = process.env.DATA_GO_KR_KEY;
  if (!key) return reply({ error: 'no_key' }, 503);
  const stops = new Map<string, Stop>();
  let pages = 0; let partial = false; let totalCount: number | undefined;
  const start = Date.now();
  try {
    for (let pageNo = 1; pageNo <= 5; pageNo++) {
      const remaining = 12_000 - (Date.now() - start);
      if (remaining <= 0) { partial = true; break; }
      const res = await fetch(tagoUrl(p.lat, p.lng, key, pageNo), { signal: AbortSignal.timeout(Math.min(6_000, remaining)) });
      if (!res.ok) throw new Error('upstream');
      const page = parseTagoPage(await res.json());
      if (page === 'upstream') throw new Error('upstream');
      pages += 1; totalCount = page.totalCount ?? totalCount;
      const previous = stops.size;
      for (const stop of page.stops) stops.set(`${stop.regionCode ?? ''}:${stop.id}`, stop);
      // A malformed record or duplicated row does not become an absence claim.
      if (page.stops.length < page.rawCount) partial = true;
      const complete = totalCount !== undefined ? pageNo * 50 >= totalCount : page.rawCount < 50;
      if (complete) { if (totalCount !== undefined && stops.size < totalCount) partial = true; break; }
      if (pageNo === 5 || stops.size === previous) { partial = true; break; }
    }
  } catch {
    if (pages === 0) return reply({ error: 'upstream' }, 502);
    partial = true;
  }
  return reply({ stops: [...stops.values()], coverage: { source: 'TAGO', radiusMeters: 500, pages, totalCount, partial, retrievedAt: new Date().toISOString(), sourceUpdatedAt: null } });
}
