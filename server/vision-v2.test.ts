import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from '../api/vision';
import { PROMPT } from './vision-v2';

const whole = 'data:image/jpeg;base64,AAAA';
const detail = 'data:image/jpeg;base64,BBBB';
const post = (body: unknown) => POST(new Request('https://example.test/api/vision', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }));
const observation = { type: 'hydrant', identity: 'unclear', identityDetail: '차량 뒤 작은 빨간 물체로 연결구를 구별할 수 없음', markingText: '', markingToTarget: 'unclear', vehicleRelation: 'unclear', boundary: 'unclear', chargerToTarget: 'unclear', relation: 'unclear', unknownReasons: ['몸체가 가려져 시설 종류 미확인'] };
const modelRead = (extra = {}) => ({ plate: { text: '', readable: false, confidence: 0 }, scene: { fireHydrantNear: 'unclear' }, typeGuess: 'hydrant', typeConfidence: .3, evidence: '작고 가려진 빨간 시설의 종류는 미확인', observations: [observation], detailRequests: [{ type: 'hydrant', box: [100, 400, 400, 700], reason: 'partly_hidden' }], boxes: [], ...extra });
const providerResponse = (raw: unknown) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(raw) }] } }] }));
const setup = (raw: unknown = modelRead()) => {
  vi.stubEnv('VISION_API_KEY', 'synthetic-test-key');
  const provider = vi.fn().mockImplementation(async () => providerResponse(raw)); vi.stubGlobal('fetch', provider); return provider;
};
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('API-only deployment without changing existing web', () => {
  it('reports protocol capabilities without calling the provider or returning a secret', async () => {
    const fetch = setup(); const response = GET(); const text = await response.text();
    expect(JSON.parse(text)).toMatchObject({ analysisVersion: 2, legacyClientsSupported: true });
    expect(text).not.toContain('synthetic-test-key'); expect(fetch).not.toHaveBeenCalled();
  });
  it('returns bound detailed evidence and preserves uncertainty for the current iPhone/web request', async () => {
    setup();
    const response = await post({ images: [whole], photoIds: ['photo-a'], inputVersion: '7' });
    expect(response.status).toBe(200); const result = await response.json();
    expect(result.analysisVersion).toBe(2);
    expect(result.photos[0]).toMatchObject({ photoId: 'photo-a', inputVersion: '7', analysisVersion: 2 });
    expect(result.evidenceReview[0]).toMatchObject({ type: 'hydrant', status: 'needs_context', legalStatus: 'unverified', distance: 'unverified' });
    expect(result.evidenceReview[0].observations[0]).toMatchObject({ photoId: 'photo-a', identity: 'unclear', vehicleRelation: 'unclear' });
    expect(result.ruleTypes).toEqual([]);
  });
  it('forwards the original scene and requested original crop to the provider as related images', async () => {
    const provider = setup();
    const response = await post({ images: [whole], photoIds: ['photo-a'], inputVersion: '7', detailImages: [{ imageIndex: 0, type: 'hydrant', box: [100, 400, 400, 700], dataUrl: detail }] });
    expect(response.status).toBe(200);
    const request = JSON.parse(provider.mock.calls[0][1].body);
    const parts = request.contents[0].parts;
    expect(parts[0].text).toBe(PROMPT);
    expect(parts.filter((p: any) => p.inline_data).map((p: any) => p.inline_data.data)).toEqual(['AAAA', 'BBBB']);
    expect(parts.some((p: any) => p.text?.includes('독립 촬영이 아니다'))).toBe(true);
  });
  it('does not disguise a provider response missing the required detailed schema as empty valid evidence', async () => {
    setup({ plate: { text: '', readable: false }, scene: { fireHydrantNear: 'yes' }, evidence: 'old provider reply' });
    const response = await post({ images: [whole], photoIds: ['photo-a'], inputVersion: '7' });
    expect(response.status).toBe(502); expect(await response.json()).toEqual({ error: 'upstream' });
  });
  it('accepts a genuinely empty detailed observation array', async () => {
    setup(modelRead({ observations: [], detailRequests: [], typeGuess: 'none' }));
    const response = await post({ images: [whole], photoIds: ['photo-a'], inputVersion: '7' });
    expect(response.status).toBe(200); expect((await response.json()).evidenceReview).toEqual([]);
  });
  it('keeps the already-deployed web protocol for a request without photo IDs', async () => {
    setup({ plate: { text: '', readable: false, confidence: 0 }, scene: { fireHydrantNear: 'no', evChargingSpace: 'yes', evVehicle: 'unclear' }, typeGuess: 'evcharge', typeConfidence: .9, evidence: '합성 기존 웹 응답', boxes: [] });
    const response = await post({ images: [whole] });
    const result = await response.json();
    expect(response.status).toBe(200); expect(result.typeGuess).toBe('evcharge');
    expect(result.photos[0].scene.evChargingSpace).toBe('yes'); expect(result.analysisVersion).toBeUndefined();
  });
  it('rejects invalid versions and crop indices without making a provider call', async () => {
    const provider = setup();
    expect((await post({ images: [whole], analysisVersion: 99 })).status).toBe(400);
    expect((await post({ images: [whole], photoIds: ['a'], detailImages: [{ imageIndex: 1, type: 'hydrant', box: [0, 0, 600, 600], dataUrl: detail }] })).status).toBe(400);
    expect(provider).not.toHaveBeenCalled();
  });
});
