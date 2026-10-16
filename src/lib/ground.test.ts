import { afterEach, describe, expect, it, vi } from 'vitest';
import { mergeReads, normalizeRead, POST } from '../../api/vision';
import type { PhotoRead } from '../../api/vision';
import { constrainSupplementalRead, crosswalkAdjacent, normalizeGround, normalizeObservations, summarizeEvidence } from './evidence';
import { compatibleVisionResult } from './vision';
import type { EvidenceType } from '../types/evidence';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const full = (type: EvidenceType, photoId = 'a') => normalizeObservations([{ type, identity: 'yes', markingToTarget: 'yes', vehicleRelation: 'yes', boundary: 'yes', identityDetail: '', markingText: '' }], { photoId, inputVersion: '1' })[0];
const ground = (surface: string, wheels: string[], crosswalkRelation = 'none') => ({ surface, wheels: wheels.map((w, i) => ({ wheel: `바퀴 ${i + 1}`, surface: w })), crosswalkRelation, evidence: '합성' });
const read = (photoId: string, observations: EvidenceType[], g?: unknown): PhotoRead => normalizeRead({
  plate: { text: '', readable: false, confidence: 0 }, typeGuess: observations[0] ?? 'none', typeConfidence: 0.9,
  scene: { onCrosswalk: 'yes', onSidewalk: 'yes' }, observations: observations.map((t) => full(t, photoId)), detailRequests: [], ...(g ? { ground: g } : {}),
}, { photoId, inputVersion: '1', modern: true })!;
const status = (reads: PhotoRead[], type: EvidenceType) => summarizeEvidence(reads).find((s) => s.type === type)?.status;

describe("횡단보도·인도 '위'는 바퀴가 닿은 바닥 답으로만 정한다", () => {
  it('실제 사진 사례 — 표시 관찰이 모두 예여도 두 장 모두 바퀴가 차도면 횡단보도·인도로 정하지 않고, 바로 앞을 따로 남긴다', () => {
    const reads = [
      read('a', ['crossing', 'sidewalk'], ground('roadway', ['roadway', 'roadway', 'roadway', 'roadway'], 'adjacent')),
      read('b', ['crossing'], ground('roadway', ['roadway'], 'adjacent')),
    ];
    const merged = mergeReads(reads, 'm')!;
    expect(merged.ruleTypes).toEqual([]);
    expect(status(reads, 'crossing')).toBe('not_observed');
    expect(status(reads, 'sidewalk')).toBe('not_observed');
    expect(merged.crosswalkAdjacent).toBe(true);
    // 호환용 장면 항목도 바닥 답과 같게 맞춘다(모델이 '예'라고 해도)
    expect(reads[0].scene.onCrosswalk).toBe('no');
    expect(reads[0].scene.onSidewalk).toBe('no');
  });

  it('바퀴가 흰 줄 위면 표시 관찰이 없어도 횡단보도로 확인한다', () => {
    const reads = [read('a', [], ground('crosswalk', ['crosswalk_stripe', 'roadway'], 'on')), read('b', [], ground('unclear', []))];
    expect(status(reads, 'crossing')).toBe('observed');
    expect(mergeReads(reads, 'm')!.ruleTypes).toEqual(['crossing']);
    expect(mergeReads(reads, 'm')!.crosswalkAdjacent).toBeUndefined();
  });

  it('둘 다(흰 줄·보도블록)면 횡단보도와 인도 모두 확인한다', () => {
    const reads = [read('a', [], ground('both', ['crosswalk_stripe', 'sidewalk_block']))];
    expect(mergeReads(reads, 'm')!.ruleTypes).toEqual(['crossing', 'sidewalk']);
  });

  it('두 사진의 바닥 답이 서로 다르면 엇갈림으로 두고 채우지 않는다', () => {
    const reads = [read('a', ['crossing'], ground('crosswalk', ['crosswalk_stripe'])), read('b', ['crossing'], ground('roadway', ['roadway']))];
    expect(status(reads, 'crossing')).toBe('conflict');
    expect(summarizeEvidence(reads).find((s) => s.type === 'crossing')?.missing[0]).toBe('사진 사이의 바닥 판독이 서로 다름');
    expect(mergeReads(reads, 'm')!.ruleTypes).toEqual([]);
  });

  it('번호판 확대처럼 바닥이 안 보이는 사진은 엇갈림으로 세지 않는다', () => {
    const reads = [read('a', ['crossing'], ground('crosswalk', ['crosswalk_stripe'])), read('b', [], ground('unclear', ['unclear']))];
    expect(status(reads, 'crossing')).toBe('observed');
  });

  it('바닥 답이 없는 이전 판독은 표시 관찰이 모두 예여도 확인되지 않은 것으로 본다', () => {
    const reads = [read('a', ['crossing'])];
    const s = summarizeEvidence(reads).find((x) => x.type === 'crossing')!;
    expect(s.status).toBe('needs_context');
    expect(s.missing).toContain('바퀴가 닿은 바닥 미확인');
    expect(mergeReads(reads, 'm')!.ruleTypes).toEqual([]);
  });

  it('다른 유형(소화전 등)은 지금처럼 표시 관찰로 정한다', () => {
    const reads = [read('a', ['hydrant', 'crossing'], ground('roadway', ['roadway'], 'adjacent'))];
    expect(mergeReads(reads, 'm')!.ruleTypes).toEqual(['hydrant']);
  });
});

describe('바닥 답 다듬기', () => {
  it('바퀴 답과 전체 답이 어긋나면 전체 답을 모름으로 둔다', () => {
    expect(normalizeGround(ground('crosswalk', ['roadway', 'roadway']))!.surface).toBe('unclear');
    expect(normalizeGround(ground('roadway', ['roadway', 'roadway']))!.surface).toBe('roadway');
    expect(normalizeGround(ground('sidewalk', ['curb']))!.surface).toBe('sidewalk');
    expect(normalizeGround(ground('sidewalk', []))!.surface).toBe('sidewalk');
  });
  it('형식에 없는 값은 버리거나 모름으로 바꾼다', () => {
    const g = normalizeGround({ surface: 'grass', wheels: [{ wheel: 'x', surface: 'mud' }, { wheel: 'y', surface: 'roadway' }], crosswalkRelation: 'near' })!;
    expect(g.wheels).toEqual([{ wheel: 'y', surface: 'roadway' }]);
    expect(g.surface).toBe('unclear');
    expect(g.crosswalkRelation).toBe('unclear');
    expect(normalizeGround(null)).toBeUndefined();
  });
  it('대상·장소 연결이 확인되지 않은 보완사진의 바닥 답은 쓰지 않는다', () => {
    const supplemental = { ...read('c', [], ground('crosswalk', ['crosswalk_stripe'], 'on')), targetLink: { referencePhotoId: 'a', sameVehicle: 'unclear' as const, samePlace: 'yes' as const, evidence: '' } };
    expect(constrainSupplementalRead(supplemental, 'a').ground!.surface).toBe('unclear');
    const linked = { ...supplemental, targetLink: { ...supplemental.targetLink, sameVehicle: 'yes' as const } };
    expect(constrainSupplementalRead(linked, 'a').ground!.surface).toBe('crosswalk');
  });
  it('바로 앞은 횡단보도 위가 확인된 사진이 있으면 따로 알리지 않는다', () => {
    expect(crosswalkAdjacent([read('a', [], ground('roadway', ['roadway'], 'adjacent'))])).toBe(true);
    expect(crosswalkAdjacent([read('a', [], ground('roadway', ['roadway'], 'adjacent')), read('b', [], ground('crosswalk', ['crosswalk_stripe'], 'on'))])).toBe(false);
    expect(crosswalkAdjacent([read('a', [], ground('roadway', ['roadway'], 'apart'))])).toBe(false);
  });
});

describe('판독 서버와 앱 사이', () => {
  it('서버는 모델의 바닥 답을 다듬어 사진마다 돌려주고, 바로 앞을 함께 알린다', async () => {
    vi.stubEnv('VISION_API_KEY', 'synthetic-test-key'); vi.stubEnv('VISION_PROVIDER', 'gemini');
    const body = { plate: { text: '', readable: false, confidence: 0 }, scene: { onCrosswalk: 'yes', onSidewalk: 'no' }, typeGuess: 'crossing', typeConfidence: 0.9, evidence: '', boxes: [], observations: [{ type: 'crossing', identity: 'yes', markingToTarget: 'yes', vehicleRelation: 'yes', boundary: 'yes', identityDetail: '', markingText: '', chargerToTarget: 'unclear', relation: 'inside', unknownReasons: [] }], detailRequests: [], ground: ground('roadway', ['roadway', 'roadway'], 'adjacent') };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(body) }] } }] }))));
    const response = await POST(new Request('http://x/api/vision', { method: 'POST', body: JSON.stringify({ images: ['data:image/jpeg;base64,AAAA'], photoIds: ['a'], inputVersion: '1' }) }));
    const json = await response.json();
    expect(json.photos[0].ground).toMatchObject({ surface: 'roadway', crosswalkRelation: 'adjacent' });
    expect(json.photos[0].scene.onCrosswalk).toBe('no');
    expect(json.ruleTypes).toEqual([]);
    expect(json.crosswalkAdjacent).toBe(true);
    // 앱도 같은 결과로 읽는다
    const app = compatibleVisionResult(json, 1, { photoIds: ['a'], inputVersion: '1' })!;
    expect(app.photos[0]!.ground!.surface).toBe('roadway');
    expect(app.crosswalkAdjacent).toBe(true);
    expect(app.evidenceReview?.find((s) => s.type === 'crossing')?.status).toBe('not_observed');
  });
});
