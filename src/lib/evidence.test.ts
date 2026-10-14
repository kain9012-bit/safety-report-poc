import { afterEach, describe, expect, it, vi } from 'vitest';
import { mergeReads, normalizeRead, POST, PROMPT } from '../../api/vision';
import type { PhotoRead } from '../../api/vision';
import { compareNoticeTime, constrainSupplementalRead, normalizeDetailRequests, normalizeObservations, reviewSharedParking, summarizeEvidence, supplementalNeeds } from './evidence';
import { cropPixels, detailPlan, fallbackDetailPlan, mergeDetailRead, readPhotos } from './vision';
import type { EvidenceObservation, EvidenceType } from '../types/evidence';

const obs = (type: EvidenceType = 'hydrant', extra: Record<string, unknown> = {}): EvidenceObservation => normalizeObservations([{ type, identity: 'yes', markingToTarget: 'yes', vehicleRelation: 'yes', boundary: 'yes', identityDetail: 'synthetic visible cue', markingText: '', ...(type === 'evcharging' ? { zoneKind: 'charging', chargerToTarget: 'yes' } : {}), ...extra }], { photoId: 'a', inputVersion: '4' })[0];
const read = (observation = obs(), photoId = 'a'): PhotoRead => normalizeRead({ plate: { text: '12가3456', readable: true, confidence: .95 }, typeGuess: observation.type, typeConfidence: .9, observations: [observation] }, { photoId, inputVersion: '4', modern: true })!;

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('independent photo observations', () => {
  it.each(['hydrant', 'crossing', 'corner', 'busstop', 'schoolzone', 'sidewalk', 'disabled', 'firelane', 'evcharging'] as const)('supports %s without declaring legal proof', (type) => {
    const result = mergeReads([read(obs(type))], 'synthetic')!;
    expect(result.ruleTypes).toEqual([type]);
    expect(result.evidenceReview?.[0]).toMatchObject({ status: 'observed', distance: 'unverified', legalStatus: 'unverified', photoIds: ['a'] });
  });

  it('strips model claims of metres, legal permission and invented photo IDs', () => {
    const result = normalizeObservations([{ type: 'hydrant', identity: true, distance: 'within_5m', legalStatus: 'illegal', photoId: 'forged', source: 'official', inputVersion: 'old' }], { photoId: 'real', inputVersion: 'new' });
    expect(result[0]).toMatchObject({ identity: 'unclear', distance: 'unverified', legalStatus: 'unverified', source: 'photo', photoId: 'real', inputVersion: 'new' });
    expect(normalizeRead({ plate: { text: '12가3456', readable: 'false', confidence: 1 } })!.plate.readable).toBe(false);
  });

  it('a visible neighbouring sign does not establish target bay connection', () => {
    const result = mergeReads([read(obs('disabled', { markingToTarget: 'no' }))], 'test')!;
    expect(result.ruleTypes).toEqual([]);
    expect(result.candidateTypes).toEqual(['disabled']);
    expect(supplementalNeeds(result.photos)[0].role).toBe('connection');
  });

  it('does not stitch separate photos to invent the missing same-place relationship', () => {
    const a = read(obs('disabled', { markingToTarget: 'unclear' }));
    const b = read(obs('disabled', { identity: 'unclear', vehicleRelation: 'unclear' }), 'b');
    expect(summarizeEvidence([a, b])[0].status).toBe('needs_context');
    expect(mergeReads([a, b], 'test')!.ruleTypes).toEqual([]);
  });

  it('a later opposite observation remains conflict instead of maximum confidence', () => {
    const a = read();
    const b = read(obs('hydrant', { identity: 'no' }), 'b');
    const result = mergeReads([a, b], 'test')!;
    expect(result.evidenceReview?.[0].status).toBe('conflict');
    expect(result.ruleTypes).toEqual([]);
    expect(result.photos[0]?.observations?.[0].identity).toBe('yes');
  });

  it('does not force repeated overview pictures for distance-only uncertainty', () => {
    expect(summarizeEvidence([read()])[0].missing).toContain('실제 거리 미확인');
    expect(supplementalNeeds([read()])).toEqual([]);
  });

  it('retains both disabled and charging attributes of the same bay', () => {
    const r = read(); r.observations = [obs('disabled'), obs('evcharging')];
    expect(summarizeEvidence([r]).map((s) => s.type)).toEqual(['disabled', 'evcharging']);
  });

  it('historical single scene flag remains explicitly unverified in new summaries', () => {
    const historical = normalizeRead({ scene: { fireHydrantNear: 'yes' }, typeGuess: 'hydrant' })!;
    expect(summarizeEvidence([historical])[0].status).toBe('legacy');
    expect(supplementalNeeds([historical])).toEqual([]);
    // A live malformed response may not silently fall back to the historical flag.
    const live = normalizeRead({ scene: { fireHydrantNear: 'yes' }, typeGuess: 'hydrant' }, { modern: true })!;
    expect(mergeReads([live], 'test')!.ruleTypes).toEqual([]);
  });

  it('the same immutable photo ID is never two independent plate readings', () => {
    expect(mergeReads([read(), read()], 'test')!.plate.agree).toBeNull();
    expect(mergeReads([read(), read(obs(), 'b')], 'test')!.plate.agree).toBe(true);
  });

  it('charging requires a charger-to-bay link, but exclusive eco parking does not', () => {
    const charging = read(obs('evcharging', { zoneKind: 'charging', chargerToTarget: 'unclear' }));
    expect(summarizeEvidence([charging])[0].status).toBe('needs_context');
    expect(supplementalNeeds([charging])[0].message).toContain('충전기');
    const parking = read(obs('evcharging', { zoneKind: 'eco_parking', chargerToTarget: 'unclear' }));
    expect(summarizeEvidence([parking])[0].status).toBe('observed');
    expect(supplementalNeeds([parking])).toEqual([]);
  });

  it('a hidden boundary stays unresolved for a corner or bay, and conflicting charger links stay conflict', () => {
    const corner = read(obs('corner', { boundary: 'unclear' }));
    expect(summarizeEvidence([corner])[0].status).toBe('needs_context');
    expect(summarizeEvidence([corner])[0].missing).toContain('대상 장소의 경계 미확인');
    expect(supplementalNeeds([corner])[0].role).toBe('connection');
    const yes = read(obs('evcharging', { chargerToTarget: 'yes' }));
    const no = read(obs('evcharging', { chargerToTarget: 'no' }), 'b');
    expect(summarizeEvidence([yes, no])[0].status).toBe('conflict');
  });

  it('all-unclear rows without visible marks do not generate nine useless capture requests', () => {
    const r = read();
    r.observations = ['hydrant', 'disabled', 'evcharging'].map((type) => normalizeObservations([{ type, identity: 'unclear' }])[0]);
    expect(supplementalNeeds([r])).toEqual([]);
  });

  it('bus stop public ID remains text and no namespace is invented', () => {
    const observation = obs('busstop', { busStop: { publicId: '01234', name: '가상 정류소', publicIdNamespace: 'TAGO:23:nodeno', readable: true } });
    expect(observation.busStop).toEqual({ publicId: '01234', name: '가상 정류소', readable: true });
    expect(observation.busStop?.publicIdNamespace).toBeUndefined();
  });

  it('unlinked or stale-reference supplemental images cannot establish a target-bay relation', () => {
    const supplemental = read(obs('disabled'), 'detail');
    supplemental.targetLink = { referencePhotoId: 'primary-old', sameVehicle: 'yes', samePlace: 'yes', evidence: 'synthetic' };
    expect(constrainSupplementalRead(supplemental, 'primary-new').observations?.[0].vehicleRelation).toBe('unclear');
    expect(constrainSupplementalRead(supplemental).observations?.[0].markingToTarget).toBe('unclear');
    expect(constrainSupplementalRead(supplemental, 'primary-old').observations?.[0].vehicleRelation).toBe('yes');
    supplemental.targetLink.samePlace = 'unclear';
    const unlinked = constrainSupplementalRead(supplemental, 'primary-old');
    expect(summarizeEvidence([unlinked])[0].status).toBe('needs_context');
    expect(supplemental.observations?.[0].vehicleRelation).toBe('yes');
  });

  it('unlinked negative context does not contradict an independently linked primary observation', () => {
    const unrelated = constrainSupplementalRead(read(obs('hydrant', { identity: 'no' }), 'detail'), 'primary');
    expect(summarizeEvidence([read(), unrelated])[0].status).toBe('observed');
  });
});

describe('two-stage client transport using synthetic canvas and responses', () => {
  const setupCanvas = () => {
    vi.stubGlobal('Image', class { src = ''; naturalWidth = 4000; naturalHeight = 3000; async decode() {} });
    vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage: vi.fn() }), toDataURL: () => 'data:image/jpeg;base64,AAAA' }) });
  };
  const candidate = () => {
    const r = read(obs('hydrant', { identity: 'unclear' }));
    r.detailRequests = [{ type: 'hydrant', box: [100, 100, 400, 400], reason: 'small' }];
    return r;
  };

  it('sends untouched original scenes once, then only the photo needing a crop; IDs and plate pair remain original', async () => {
    setupCanvas();
    const first = mergeReads([candidate(), read(obs(), 'b')], 'synthetic')!;
    const second = mergeReads([read()], 'synthetic')!;
    const send = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(first))).mockResolvedValueOnce(new Response(JSON.stringify(second)));
    vi.stubGlobal('fetch', send);
    const originals = ['data:image/jpeg;base64,ORIGINALA', 'data:image/jpeg;base64,ORIGINALB'];
    const result = await readPhotos(originals, { photoIds: ['a', 'b'], inputVersion: '4' });
    expect(send).toHaveBeenCalledTimes(2);
    const wholeBody = JSON.parse(send.mock.calls[0][1].body), detailBody = JSON.parse(send.mock.calls[1][1].body);
    expect(wholeBody.images).toHaveLength(2);
    expect(detailBody.images).toHaveLength(1);
    expect(detailBody.photoIds).toEqual(['a']);
    expect(detailBody.detailImages).toHaveLength(2);
    expect(detailBody.detailImages[0]).toMatchObject({ imageIndex: 0, box: [100, 100, 400, 400] });
    expect(result.result?.photos).toHaveLength(2);
    expect(result.result?.plate.agree).toBe(true);
    expect(result.result?.photos[0]?.detailReview).toBe('completed');
    expect(originals[0]).toBe('data:image/jpeg;base64,ORIGINALA');
  });

  it('second-stage network failure keeps saved first-stage readings and does not loop', async () => {
    setupCanvas();
    const first = mergeReads([candidate()], 'synthetic')!;
    const send = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(first))).mockRejectedValueOnce(new Error('synthetic failure'));
    vi.stubGlobal('fetch', send);
    const result = await readPhotos(['data:image/jpeg;base64,ORIGINAL'], { photoIds: ['a'] });
    expect(result.state).toBe('ok');
    expect(result.result?.photos[0]?.detailReview).toBe('unavailable');
    expect(result.result?.photos[0]?.plate.text).toBe('12가3456');
    expect(send).toHaveBeenCalledTimes(2);
  });
});

describe('whole scene and bounded original crops', () => {
  it('maps normalized original coordinates without upscaling tiny or whole-scene crops', () => {
    expect(cropPixels([100, 200, 500, 600], 4000, 3000)).toEqual([800, 300, 1600, 1200]);
    expect(cropPixels([0, 0, 1000, 1000], 4000, 3000)).toBeNull();
    expect(cropPixels([1, 1, 2, 2], 4000, 3000)).toBeNull();
    expect(cropPixels([50, 50, 20, 20], 4000, 3000)).toBeNull();
  });

  it('only real candidate regions are eligible and at most two crops are sent', () => {
    const candidate = (id: string) => { const r = read(obs('hydrant', { identity: 'unclear' }), id); r.detailRequests = [{ type: 'hydrant', box: [1, 1, 300, 300], reason: 'small' }]; return r; };
    expect(detailPlan([candidate('a'), candidate('b'), candidate('c')])).toHaveLength(2);
    const noCandidate = candidate('d'); noCandidate.observations = [];
    expect(detailPlan([noCandidate])).toEqual([]);
    const distanceOnly = candidate('e'); distanceOnly.observations = [obs()];
    expect(detailPlan([distanceOnly])).toEqual([]);
    expect(normalizeDetailRequests([{ type: 'hydrant', box: [1, 1, 2, 2], reason: 'measure_distance' }])).toEqual([]);
  });

  it('detail may read a small hydrant but cannot create the missing spatial relationship', () => {
    const a = read(obs('hydrant', { identity: 'unclear', vehicleRelation: 'unclear' }));
    const b = read(obs('hydrant', { markingText: '소화전', vehicleRelation: 'yes' }));
    b.plate.text = '99나9999';
    const result = mergeDetailRead(a, b, [{ type: 'hydrant', box: [1, 1, 300, 300], reason: 'small' }]);
    expect(result.observations?.[0]).toMatchObject({ identity: 'yes', markingText: '소화전', vehicleRelation: 'unclear', photoId: 'a' });
    expect(result.plate.text).toBe('12가3456');
    expect(result.detailRegions).toHaveLength(1);
    expect(summarizeEvidence([result])[0].status).toBe('needs_context');
  });

  it('detail failure preserves the whole-scene result and observations', () => {
    const a = read();
    const result = mergeDetailRead(a, null, []);
    expect(result).toMatchObject({ ...a, detailReview: 'unavailable' });
  });

  it('an opposite detail result downgrades rather than silently overwrites the original', () => {
    const result = mergeDetailRead(read(), read(obs('hydrant', { identity: 'no' })), [{ type: 'hydrant', box: [1, 1, 300, 300], reason: 'small' }]);
    expect(result.observations?.[0].identity).toBe('unclear');
    expect(result.observations?.[0].unknownReasons.join(' ')).toContain('관찰이 달라');
  });

  it('scans overlapping original regions when the first pass found no facility at all', () => {
    const empty = normalizeRead({ observations: [], typeGuess: 'none' }, { modern: true, photoId: 'a' })!;
    const plan = fallbackDetailPlan([empty], [[4000, 3000]]);
    expect(plan.map((p) => p.request.box)).toEqual([[0, 0, 1000, 600], [0, 400, 1000, 1000]]);
    expect(plan.every((p) => p.request.reason === 'overlap_scan')).toBe(true);
    expect(fallbackDetailPlan([empty], [[800, 600]])).toEqual([]);
    expect(fallbackDetailPlan([read()], [[4000, 3000]])).toEqual([]);
    const discovered = mergeDetailRead(empty, read(), plan.map((p) => p.request));
    expect(discovered.observations?.[0]).toMatchObject({ type: 'hydrant', identity: 'yes', vehicleRelation: 'unclear', markingToTarget: 'unclear', photoId: 'a' });
    expect(mergeReads([discovered], 'synthetic')!.ruleTypes).toEqual([]);
  });

  it('detail text can clarify a stop number and EV subtype without upgrading spatial links', () => {
    const before = read(obs('busstop', { identity: 'unclear' }));
    const after = read(obs('busstop', { busStop: { publicId: '01234', name: '가상', readable: true } }));
    const result = mergeDetailRead(before, after, [{ type: 'busstop', box: [1, 1, 300, 300], reason: 'small' }]);
    expect(result.observations?.[0].busStop?.publicId).toBe('01234');
    const ev = mergeDetailRead(read(obs('evcharging', { zoneKind: 'unclear', chargerToTarget: 'unclear' })), read(obs('evcharging', { zoneKind: 'charging' })), [{ type: 'evcharging', box: [1, 1, 300, 300], reason: 'unreadable_text' }]);
    expect(ev.observations?.[0].zoneKind).toBe('charging');
    expect(ev.observations?.[0].chargerToTarget).toBe('unclear');
  });
});

describe('EV shared-parking notice', () => {
  const notice = (extra = {}) => obs('evcharging', { sharedNotice: { kind: 'general_car', text: '일반차 22:00~07:00', targetBayRelation: 'yes', conditionsComplete: 'yes', timeText: '22:00~07:00', ...extra } });
  it('distinguishes EV extra time from permission for general vehicles', () => {
    expect(reviewSharedParking([notice({ kind: 'ev_extra_time' })]).state).toBe('ev_time_only');
    expect(reviewSharedParking([notice({ kind: 'other', text: '공용·무료' })]).state).toBe('not_observed');
  });
  it('requires target bay and full conditions before reporting a read notice', () => {
    expect(reviewSharedParking([notice({ targetBayRelation: 'unclear' })]).state).toBe('needs_bay');
    expect(reviewSharedParking([notice({ conditionsComplete: 'unclear' })]).state).toBe('needs_conditions');
    expect(reviewSharedParking([notice()])).toMatchObject({ state: 'notice_observed', legalPermission: 'unverified' });
  });
  it('preserves conflicting notices and never grants permission', () => {
    expect(reviewSharedParking([notice(), notice({ timeText: '23:00~06:00' })])).toMatchObject({ state: 'conflict', legalPermission: 'unverified' });
  });
  it('matches a midnight interval against each capture time, with boundary and holiday uncertainty', () => {
    const base = { timezone: 'Asia/Seoul' as const, startMinute: 1320, endMinute: 420, conditionsComplete: true, validityConfirmed: true, dayCondition: 'none' as const };
    const at = (time: string) => Date.parse(`2026-10-15T${time}:00+09:00`);
    expect(compareNoticeTime({ ...base, takenAt: at('23:10') })).toBe('matches_time');
    expect(compareNoticeTime({ ...base, takenAt: at('02:10') })).toBe('matches_time');
    expect(compareNoticeTime({ ...base, takenAt: at('21:59') })).toBe('outside_time');
    expect(compareNoticeTime({ ...base, takenAt: at('22:00') })).toBe('unknown');
    expect(compareNoticeTime({ ...base, takenAt: at('23:10'), dayCondition: 'holiday' })).toBe('unknown');
    expect(compareNoticeTime({ ...base, takenAt: at('23:10'), validityConfirmed: false })).toBe('unknown');
    expect(compareNoticeTime({ ...base })).toBe('unknown');
    expect(compareNoticeTime({ ...base, takenAt: 1e100 })).toBe('unknown');
  });
});

describe('vision endpoint defensive contract (mock provider only)', () => {
  const request = (body: unknown) => new Request('http://localhost/api/vision', { method: 'POST', body: JSON.stringify(body) });
  const mockResponse = (observation = obs()) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ plate: { text: '12가3456', readable: true, confidence: .95 }, observations: [observation], typeGuess: observation.type, typeConfidence: .9 }) }] } }] }));
  it.each([null, {}, { images: 'bad' }, { images: ['data:image/jpeg;base64,AAAA'], detailImages: 'bad' }])('rejects malformed body %j without contacting a provider', async (body) => {
    const provider = vi.fn(); vi.stubGlobal('fetch', provider);
    expect((await POST(request(body))).status).toBe(400);
    expect(provider).not.toHaveBeenCalled();
  });
  it('binds photo IDs and input version from caller, never model output', async () => {
    vi.stubEnv('VISION_API_KEY', 'synthetic-test-key'); vi.stubEnv('VISION_PROVIDER', 'gemini');
    const provider = vi.fn().mockResolvedValue(mockResponse(obs('disabled', { photoId: 'forged' })));
    vi.stubGlobal('fetch', provider);
    const response = await POST(request({ images: ['data:image/jpeg;base64,AAAA'], photoIds: ['caller-id'], inputVersion: 7 }));
    const result = await response.json();
    expect(result.photos[0]).toMatchObject({ photoId: 'caller-id', inputVersion: '7', analysisVersion: 2 });
    expect(result.photos[0].observations[0]).toMatchObject({ photoId: 'caller-id', inputVersion: '7' });
    expect(result.plate.agree).toBeNull();
    const sent = JSON.parse(provider.mock.calls[0][1].body);
    expect(sent.contents[0].parts[0].text).toBe(PROMPT);
    expect(sent.contents[0].parts.filter((p: { inline_data?: unknown }) => p.inline_data)).toHaveLength(1);
  });
  it('detail request includes original scene and crop together, never a standalone extra plate photo', async () => {
    vi.stubEnv('VISION_API_KEY', 'synthetic-test-key'); vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse()));
    const response = await POST(request({ images: ['data:image/jpeg;base64,AAAA'], photoIds: ['a'], detailImages: [{ imageIndex: 0, dataUrl: 'data:image/jpeg;base64,BBBB', box: [100, 100, 400, 400], type: 'hydrant' }] }));
    const result = await response.json();
    expect(result.photos).toHaveLength(1);
    expect(result.plate.agree).toBeNull();
    const sent = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
    expect(sent.contents[0].parts.filter((p: { inline_data?: unknown }) => p.inline_data)).toHaveLength(2);
  });
  it('one transport failure does not erase the other independent photo result', async () => {
    vi.stubEnv('VISION_API_KEY', 'synthetic-test-key');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('synthetic timeout')).mockResolvedValueOnce(mockResponse()));
    const response = await POST(request({ images: ['data:image/jpeg;base64,AAAA', 'data:image/jpeg;base64,BBBB'], photoIds: ['a', 'b'] }));
    const result = await response.json();
    expect(response.status).toBe(200);
    expect(result.photos[0]).toBeNull();
    expect(result.photos[1].photoId).toBe('b');
    expect(result.plate.agree).toBeNull();
  });

  it('reference context is not counted as another independent photo and missing linkage is clamped', async () => {
    vi.stubEnv('VISION_API_KEY', 'synthetic-test-key');
    const provider = vi.fn().mockResolvedValue(mockResponse(obs('disabled'))); vi.stubGlobal('fetch', provider);
    const response = await POST(request({ images: ['data:image/jpeg;base64,AAAA'], photoIds: ['detail'], reference: { dataUrl: 'data:image/jpeg;base64,BBBB', photoId: 'primary' } }));
    const result = await response.json();
    expect(result.photos).toHaveLength(1);
    expect(result.photos[0].targetLink).toMatchObject({ referencePhotoId: 'primary', sameVehicle: 'unclear', samePlace: 'unclear' });
    expect(result.photos[0].observations[0]).toMatchObject({ identity: 'yes', markingToTarget: 'unclear', vehicleRelation: 'unclear' });
    expect(result.ruleTypes).toEqual([]);
    expect(result.plate.agree).toBeNull();
    const sent = JSON.parse(provider.mock.calls[0][1].body);
    expect(sent.contents[0].parts.filter((p: { inline_data?: unknown }) => p.inline_data)).toHaveLength(2);
  });

  it('a reference cannot contaminate a pair of independent plate photos', async () => {
    const response = await POST(request({ images: ['data:image/jpeg;base64,AAAA', 'data:image/jpeg;base64,BBBB'], reference: { dataUrl: 'data:image/jpeg;base64,CCCC', photoId: 'primary' } }));
    expect(response.status).toBe(400);
  });
});
