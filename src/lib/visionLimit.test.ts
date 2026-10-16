import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_MODEL, FALLBACK_MODELS, POST } from '../../api/vision';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const ok = () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ plate: { text: '', readable: false, confidence: 0 }, scene: {}, typeGuess: 'none', typeConfidence: 0, evidence: '', boxes: [], observations: [], detailRequests: [], ground: { surface: 'roadway', wheels: [{ wheel: '앞', surface: 'roadway' }], crosswalkRelation: 'none', evidence: '' } }) }] } }] }));
const status = (code: number) => new Response('{}', { status: code });
const call = () => POST(new Request('http://x/api/vision', { method: 'POST', body: JSON.stringify({ images: ['data:image/jpeg;base64,AAAA'], photoIds: ['a'], inputVersion: '1' }) }));
const modelOf = (fetchMock: ReturnType<typeof vi.fn>, n: number) => String(fetchMock.mock.calls[n][0]).split('/models/')[1].split(':')[0];

describe('판독 한도(429)면 예비 모델로 넘긴다', () => {
  it('첫 모델이 한도에 걸리면 다음 모델의 결과를 쓴다', async () => {
    vi.stubEnv('VISION_API_KEY', 'synthetic-test-key'); vi.stubEnv('VISION_PROVIDER', 'gemini'); vi.stubEnv('VISION_MODEL', '');
    const fetchMock = vi.fn().mockResolvedValueOnce(status(429)).mockResolvedValueOnce(ok());
    vi.stubGlobal('fetch', fetchMock);
    const response = await call();
    expect(response.status).toBe(200);
    expect((await response.json()).model).toBe(FALLBACK_MODELS[0]);
    expect([modelOf(fetchMock, 0), modelOf(fetchMock, 1)]).toEqual([DEFAULT_MODEL, FALLBACK_MODELS[0]]);
  });
  it('모든 모델이 한도에 걸리면 한도 초과로 알린다', async () => {
    vi.stubEnv('VISION_API_KEY', 'synthetic-test-key'); vi.stubEnv('VISION_PROVIDER', 'gemini');
    const fetchMock = vi.fn().mockImplementation(async () => status(429));
    vi.stubGlobal('fetch', fetchMock);
    const response = await call();
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: 'rate_limited' });
    expect(fetchMock).toHaveBeenCalledTimes(1 + FALLBACK_MODELS.length);
  });
  it('한도에 걸린 뒤 예비 모델이 다른 오류를 내도 한도 초과로 알린다', async () => {
    vi.stubEnv('VISION_API_KEY', 'synthetic-test-key'); vi.stubEnv('VISION_PROVIDER', 'gemini');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(status(429)).mockResolvedValueOnce(status(400)));
    expect((await call()).status).toBe(429);
  });
  it('한도 초과가 없으면 지금처럼 — 다른 오류는 그대로, 모두 붐비면 busy', async () => {
    vi.stubEnv('VISION_API_KEY', 'synthetic-test-key'); vi.stubEnv('VISION_PROVIDER', 'gemini');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(status(400)));
    expect((await call()).status).toBe(502);
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => status(503)));
    expect((await call()).status).toBe(503);
  });
});
