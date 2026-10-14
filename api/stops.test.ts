import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET, parseTagoPage } from './stops';
const row = (id: number) => ({ nodeid: `internal${id}`, nodeno: `00${id}`, citycode: '25', nodenm: '같은 이름', gpslati: 37, gpslong: 127 });
const page = (count: number, total: number | undefined, offset = 0) => ({ response: { header: { resultCode: '00' }, body: { totalCount: total, items: { item: Array.from({ length: count }, (_, i) => row(offset + i)) } } } });
const request = () => new Request('http://localhost/api/stops?lat=37&lng=127');
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe('stop pagination and identity', () => {
  it('keeps printed ID separate from internal ID and labels its provider/region namespace', () => {
    const parsed = parseTagoPage(page(1, 1));
    expect(parsed).not.toBe('upstream');
    if (parsed === 'upstream') return;
    expect(parsed.stops[0]).toMatchObject({ id: 'internal0', publicId: '000', publicIdNamespace: 'TAGO:25:nodeno', regionCode: '25', source: 'TAGO' });
  });
  it('invalid coordinate or missing internal ID never creates fabricated stop', () => {
    const invalid = { response: { body: { items: { item: [{ ...row(1), gpslati: null }, { ...row(2), gpslong: '' }, { ...row(3), nodeid: '' }] } } } };
    expect(parseTagoPage(invalid)).toMatchObject({ stops: [], rawCount: 3 });
  });
  it('fetches the second page and retains all 51 candidates', async () => {
    vi.stubEnv('DATA_GO_KR_KEY', 'test-only');
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(page(50, 51))).mockResolvedValueOnce(Response.json(page(1, 51, 50)));
    vi.stubGlobal('fetch', fetcher);
    const result = await GET(request()); const body = await result.json();
    expect(body.stops).toHaveLength(51); expect(body.coverage).toMatchObject({ pages: 2, totalCount: 51, partial: false });
    expect(fetcher.mock.calls[1][0]).toContain('pageNo=2');
    expect(result.headers.get('cache-control')).toBe('no-store');
  });
  it('a later page failure returns available candidates with partial coverage', async () => {
    vi.stubEnv('DATA_GO_KR_KEY', 'test-only');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json(page(50, 51))).mockRejectedValueOnce(new Error('network')));
    const result = await GET(request()); const body = await result.json();
    expect(result.status).toBe(200); expect(body.stops).toHaveLength(50); expect(body.coverage.partial).toBe(true);
  });
  it('a page cap is partial and never claims no other stops', async () => {
    vi.stubEnv('DATA_GO_KR_KEY', 'test-only');
    let index = 0; vi.stubGlobal('fetch', vi.fn(async () => Response.json(page(50, 500, index++ * 50))));
    const body = await (await GET(request())).json();
    expect(body.stops).toHaveLength(250); expect(body.coverage).toMatchObject({ pages: 5, partial: true });
  });
  it('missing key is a distinct unavailable response with no request', async () => {
    vi.stubEnv('DATA_GO_KR_KEY', ''); const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    expect((await GET(request())).status).toBe(503); expect(fetcher).not.toHaveBeenCalled();
  });
});
