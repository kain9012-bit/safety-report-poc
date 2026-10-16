import { afterEach, describe, expect, it, vi } from 'vitest';
import { crosswalkAdjacent, mergeReads, normalizeGround, normalizeRead, POST } from '../../api/vision';
import type { PhotoRead } from '../../api/vision';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const ground = (surface: string, wheels: string[], crosswalkRelation = 'none') => ({ surface, wheels: wheels.map((w, i) => ({ wheel: `바퀴 ${i + 1}`, surface: w })), crosswalkRelation, evidence: '합성' });
// 모델이 장면 항목에서 '횡단보도 위·인도 위'를 예라고 답한 경우에도 바닥 답이 이긴다
const read = (g?: unknown, scene: Record<string, string> = { onCrosswalk: 'yes', onSidewalk: 'yes' }, typeGuess = 'crossing'): PhotoRead =>
  normalizeRead({ plate: { text: '', readable: false, confidence: 0 }, scene, typeGuess, typeConfidence: 0.9, evidence: '', boxes: [], ...(g ? { ground: g } : {}) })!;

describe("횡단보도·인도 '위'는 바퀴가 닿은 바닥 답으로만 정한다", () => {
  it('실제 사진 사례 — 두 장 모두 바퀴가 차도면 횡단보도·인도로 정하지 않고, 바로 앞을 따로 남긴다', () => {
    const reads = [read(ground('roadway', ['roadway', 'roadway', 'roadway', 'roadway'], 'adjacent')), read(ground('roadway', ['roadway'], 'adjacent'))];
    expect(reads[0].scene.onCrosswalk).toBe('no');
    expect(reads[0].scene.onSidewalk).toBe('no');
    const merged = mergeReads(reads, 'm')!;
    expect(merged.ruleTypes).toEqual([]);
    expect(merged.crosswalkAdjacent).toBe(true);
  });
  it('바퀴가 흰 줄 위면 횡단보도, 둘 다면 횡단보도·인도', () => {
    expect(mergeReads([read(ground('crosswalk', ['crosswalk_stripe', 'roadway'], 'on'), {}, 'crossing')], 'm')!.ruleTypes).toEqual(['crossing']);
    expect(mergeReads([read(ground('both', ['crosswalk_stripe', 'sidewalk_block']), {})], 'm')!.ruleTypes).toEqual(['crossing', 'sidewalk']);
  });
  it('두 사진의 바닥 답이 서로 다르면 모름으로 두고 채우지 않는다', () => {
    const merged = mergeReads([read(ground('crosswalk', ['crosswalk_stripe'])), read(ground('roadway', ['roadway']))], 'm')!;
    expect(merged.scene.onCrosswalk).toBe('unclear');
    expect(merged.ruleTypes).toEqual([]);
  });
  it('번호판 확대처럼 바닥이 안 보이는 사진은 엇갈림으로 세지 않는다', () => {
    expect(mergeReads([read(ground('crosswalk', ['crosswalk_stripe'])), read(ground('unclear', ['unclear']))], 'm')!.ruleTypes).toEqual(['crossing']);
  });
  it('이전에 저장된 판독(바닥 답 없음)은 횡단보도·인도 위를 모름으로 본다 — 다른 유형은 그대로', () => {
    const old = { plate: { text: '', readable: false, confidence: 0 }, scene: { onCrosswalk: 'yes', onSidewalk: 'yes', fireHydrantNear: 'yes' }, typeGuess: 'crossing', typeConfidence: 0.9, evidence: '', boxes: [] } as unknown as PhotoRead;
    const merged = mergeReads([old, old], 'm')!;
    expect(merged.scene.onCrosswalk).toBe('unclear');
    expect(merged.ruleTypes).toEqual(['hydrant']);
  });
});

describe('바닥 답 다듬기', () => {
  it('바퀴 답과 전체 답이 어긋나면 전체 답을 모름으로 둔다', () => {
    expect(normalizeGround(ground('crosswalk', ['roadway', 'roadway']))!.surface).toBe('unclear');
    expect(normalizeGround(ground('roadway', ['roadway']))!.surface).toBe('roadway');
    expect(normalizeGround(ground('sidewalk', ['curb']))!.surface).toBe('sidewalk');
  });
  it('형식에 없는 값은 버리거나 모름으로 바꾼다', () => {
    const g = normalizeGround({ surface: 'grass', wheels: [{ wheel: 'x', surface: 'mud' }, { wheel: 'y', surface: 'roadway' }], crosswalkRelation: 'near' })!;
    expect(g.wheels).toEqual([{ wheel: 'y', surface: 'roadway' }]);
    expect(g.surface).toBe('unclear');
    expect(g.crosswalkRelation).toBe('unclear');
    expect(normalizeGround(null)).toBeUndefined();
  });
  it('바로 앞은 횡단보도 위로 읽힌 사진이 있으면 따로 알리지 않는다', () => {
    expect(crosswalkAdjacent([read(ground('roadway', ['roadway'], 'adjacent'))])).toBe(true);
    expect(crosswalkAdjacent([read(ground('roadway', ['roadway'], 'adjacent')), read(ground('crosswalk', ['crosswalk_stripe'], 'on'))])).toBe(false);
    expect(crosswalkAdjacent([read(ground('roadway', ['roadway'], 'apart'))])).toBe(false);
  });
});

describe('판독 서버', () => {
  it('모델의 바닥 답을 다듬어 사진마다 돌려주고, 바로 앞을 함께 알린다', async () => {
    vi.stubEnv('VISION_API_KEY', 'synthetic-test-key'); vi.stubEnv('VISION_PROVIDER', 'gemini');
    const body = { plate: { text: '', readable: false, confidence: 0 }, scene: { onCrosswalk: 'yes', onSidewalk: 'no' }, typeGuess: 'crossing', typeConfidence: 0.9, evidence: '', boxes: [], ground: ground('roadway', ['roadway', 'roadway'], 'adjacent') };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(body) }] } }] }))));
    const response = await POST(new Request('http://x/api/vision', { method: 'POST', body: JSON.stringify({ images: ['data:image/jpeg;base64,AAAA'] }) }));
    const json = await response.json();
    expect(json.photos[0].ground).toMatchObject({ surface: 'roadway', crosswalkRelation: 'adjacent' });
    expect(json.photos[0].scene.onCrosswalk).toBe('no');
    expect(json.ruleTypes).toEqual([]);
    expect(json.crosswalkAdjacent).toBe(true);
  });
});
