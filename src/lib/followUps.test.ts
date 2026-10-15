import { describe, expect, it } from 'vitest';
import { answerSharedParking, busStopNumbers, sharedParkingQuestion, supplementRequest } from './followUps';
import { appendPhoto, normalizeDraft, primaryFirst, reviewedReads } from './photoEvidence';
import { crosscheck } from './crosscheck';
import { mergeReads } from '../../api/vision';
import { precheck } from './precheck';
import { kstTime } from './kst';
import type { DraftReport } from '../types/report';
import type { EvidenceObservation, SharedParkingNotice } from '../types/evidence';
import type { PhotoRead } from '../../api/vision';

const at = kstTime(2026, 10, 15, 10);
const verdict = { source: 'none' as const, suspicions: [], alternatives: [] };
const obs = (o: Partial<EvidenceObservation> & Pick<EvidenceObservation, 'type'>): EvidenceObservation => ({
  identity: 'yes', identityDetail: '', markingText: '', markingToTarget: 'yes', vehicleRelation: 'yes', boundary: 'yes', chargerToTarget: 'unclear',
  relation: 'inside', unknownReasons: [], source: 'photo', legalStatus: 'unverified', distance: 'unverified', ...o,
});
const read = (observations: EvidenceObservation[]): PhotoRead => ({
  plate: { text: '12가3456', readable: true, confidence: 0.95 }, scene: {} as PhotoRead['scene'], typeGuess: 'none', typeConfidence: 0,
  evidence: '', boxes: [], observations, analysisVersion: 2,
} as PhotoRead);
const draftWith = (reads: (PhotoRead | null | undefined)[], extra: Partial<DraftReport> = {}): DraftReport => normalizeDraft({
  shots: [{ takenAt: at, dataUrl: 'a' }, { takenAt: at + 65_000, dataUrl: 'b' }],
  reads: reads as DraftReport['reads'],
  ...extra,
});
const notice = (kind: SharedParkingNotice['kind']): SharedParkingNotice => ({
  kind, text: '일반 자동차 주차 가능 22:00~07:00', targetBayRelation: 'unclear', conditionsComplete: 'unclear', bayText: '13번', timeText: '22:00~07:00', otherConditions: '', issuer: '', legalPermission: 'unverified',
});

describe('보완 촬영 요청 — 사진으로 해결되는 부족 사유일 때만, 같은 사유는 한 번만', () => {
  it('시설은 보였지만 차와의 연결이 안 보이면 차와 함께 나오게 한 장 더 찍으라고 한다', () => {
    const d = draftWith([read([obs({ type: 'hydrant', vehicleRelation: 'unclear' })]), read([])]);
    expect(supplementRequest(d)).toEqual({ id: 'hydrant:connection', text: '소화전이나 소방용수 표시가 차와 함께 나오게 한 장 더 찍어 주세요' });
  });
  it('표시 자체를 알아보기 어려우면 가까이에서 잘 보이게 찍으라고 한다', () => {
    const d = draftWith([read([obs({ type: 'hydrant', identity: 'unclear', box: [100, 100, 150, 180] })]), read([])]);
    expect(supplementRequest(d)?.text).toBe('소화전이나 소방용수 표시가 잘 보이게 가까이에서 한 장 더 찍어 주세요');
  });
  it('근거가 모두 확인됐으면 거리가 미측정이어도 요청하지 않는다', () => {
    const d = draftWith([read([obs({ type: 'hydrant' })]), read([])]);
    expect(supplementRequest(d)).toBeUndefined();
  });
  it('한 번 요청한 사유는 다시 묻지 않는다', () => {
    const d = draftWith([read([obs({ type: 'hydrant', vehicleRelation: 'unclear' })]), read([])], { supplementAsked: ['hydrant:connection'] });
    expect(supplementRequest(d)).toBeUndefined();
  });
  it('판독이 끝나지 않았거나, 구형 서버 응답이거나, 기타 유형이면 요청하지 않는다', () => {
    expect(supplementRequest(draftWith([read([obs({ type: 'hydrant', vehicleRelation: 'unclear' })]), undefined]))).toBeUndefined();
    const legacy = { ...read([]), observations: undefined, analysisVersion: undefined, scene: { fireHydrantNear: 'yes' } } as unknown as PhotoRead;
    expect(supplementRequest(draftWith([legacy, legacy]))).toBeUndefined();
    expect(supplementRequest(draftWith([read([obs({ type: 'hydrant', vehicleRelation: 'unclear' })]), read([])], { type: 'other' }))).toBeUndefined();
  });
  it('보이는 단서가 하나도 없으면 사진으로 해결된다고 보지 않는다', () => {
    const d = draftWith([read([obs({ type: 'hydrant', identity: 'unclear', markingToTarget: 'unclear', vehicleRelation: 'unclear' })]), read([])]);
    expect(supplementRequest(d)).toBeUndefined();
  });
});

describe('일반 자동차 병행주차 질문 — 친환경차 구역에서 그런 안내가 보일 때만', () => {
  const ev = (kind: SharedParkingNotice['kind']) => draftWith([read([obs({ type: 'evcharging', zoneKind: 'eco_parking', sharedNotice: notice(kind) })]), read([])], { type: 'evcharging' });
  it('일반차 안내가 보이면 묻고, 답을 기록하면 같은 사진에서는 그 답을 보여 준다', () => {
    const d = ev('general_car');
    expect(sharedParkingQuestion(d)).toEqual({ notice: '일반 자동차 주차 가능 22:00~07:00', answer: undefined });
    const answered = answerSharedParking(d, 'same_bay', at);
    expect(sharedParkingQuestion(answered)?.answer).toBe('same_bay');
    expect(answered.sharedParking).toMatchObject({ answer: 'yes', scope: 'same_bay', targetBay: '13번', timeCondition: '22:00~07:00', permission: 'general', timeMatch: 'unknown' });
  });
  it('사진이 바뀌면 이전 답을 지우지 않고 다시 묻는다', () => {
    const answered = answerSharedParking(ev('general_car'), 'different_bay', at);
    const changed = appendPhoto(answered, { takenAt: at + 99_000, dataUrl: 'c' }, true);
    expect(changed.sharedParking?.scope).toBe('different_bay');
    expect(sharedParkingQuestion(changed)?.answer).toBeUndefined();
  });
  it('전기차 시간 안내만 있거나 다른 유형이면 묻지 않는다', () => {
    expect(sharedParkingQuestion(ev('ev_extra_time'))).toBeUndefined();
    expect(sharedParkingQuestion({ ...ev('general_car'), type: 'disabled' })).toBeUndefined();
  });
});

describe('제출 전 점검 — 결과를 바꿀 만큼 중요한 미확인만 노란불', () => {
  const ev = (scope?: 'same_bay' | 'different_bay' | 'unknown') => {
    const d = draftWith([read([obs({ type: 'evcharging', zoneKind: 'eco_parking', sharedNotice: notice('general_car') })]), read([])], { type: 'evcharging' });
    return scope ? answerSharedParking(d, scope, at) : d;
  };
  const rows = (d: DraftReport) => precheck({ draft: d, verdict, body: '내용 입력', now: at + 120_000, minInterval: 60 }).checks;
  it('병행주차 안내 — 이 칸에 적용되거나 모르면 노란불, 다른 칸 안내면 줄을 만들지 않는다', () => {
    expect(rows(ev()).find((c) => c.id === 'shared_parking')?.detail).toContain('위반 유형 확인 단계에서');
    expect(rows(ev('same_bay')).find((c) => c.id === 'shared_parking')?.status).toBe('warn');
    expect(rows(ev('unknown')).find((c) => c.id === 'shared_parking')?.status).toBe('warn');
    expect(rows(ev('different_bay')).some((c) => c.id === 'shared_parking')).toBe(false);
  });
  it('서로 다른 정류소 번호가 읽히면 노란불 한 줄', () => {
    const stop = (publicId: string) => obs({ type: 'busstop', busStop: { publicId, name: '', readable: true } });
    const d = draftWith([read([stop('12-345')]), read([stop('12-346')])], { type: 'busstop' });
    expect(busStopNumbers(d)).toEqual(['12-345', '12-346']);
    expect(rows(d).find((c) => c.id === 'busstop_number')?.status).toBe('warn');
    expect(rows(draftWith([read([stop('12-345')]), read([stop('12-345')])], { type: 'busstop' })).some((c) => c.id === 'busstop_number')).toBe(false);
  });
  it('민원인이 할 수 없는 확인(실제 거리·지정 구간)은 점검 줄로 꺼내지 않는다', () => {
    for (const type of ['hydrant', 'corner', 'busstop', 'schoolzone'] as const) {
      const ids = rows(draftWith([read([]), read([])], { type })).map((c) => c.id);
      expect(ids).not.toContain('distance');
      expect(ids).not.toContain('school_scope');
    }
  });
  it('근거가 확인된 유형은 통과, 확인하지 못한 유형은 main 문구로 노란불', () => {
    expect(rows(draftWith([read([obs({ type: 'crossing' })]), read([])], { type: 'crossing' })).find((c) => c.id === 'evidence')?.status).toBe('pass');
    const weak = rows(draftWith([read([]), read([])], { type: 'crossing', manual: { type: true } })).find((c) => c.id === 'evidence');
    expect(weak?.status).toBe('warn'); expect(weak?.detail).toContain('표지판·노면 표시');
  });
});

describe('유형은 확신할 때만 채운다 — App 과 같은 경로(보완사진 대조 → 판독 합본 → 유형 판정)', () => {
  const typeOf = (d: DraftReport) => crosscheck([], {}, mergeReads(reviewedReads(d).map((r) => r ?? null) as (PhotoRead | null)[], 'm') ?? undefined).type;
  const guess = (r: PhotoRead): PhotoRead => ({ ...r, typeGuess: 'hydrant', typeConfidence: 0.9 });
  it('표시·차량 관계가 한 사진에서 모두 확인되고 AI 판단도 같으면 채운다', () => {
    expect(typeOf(draftWith([guess(read([obs({ type: 'hydrant' })])), read([])]))).toBe('hydrant');
  });
  it('차와의 관계가 미확인이면 AI가 소화전이라고 해도 비워 둔다(직접 고르게 한다)', () => {
    expect(typeOf(draftWith([guess(read([obs({ type: 'hydrant', vehicleRelation: 'unclear' })])), read([])]))).toBeUndefined();
  });
  it('기본 사진과 연결이 확인되지 않은 보완사진만으로는 채우지 않는다', () => {
    const d = appendPhoto(draftWith([guess(read([obs({ type: 'hydrant', vehicleRelation: 'unclear' })])), read([])]), { takenAt: at + 99_000, dataUrl: 'c' }, true);
    d.reads = [...d.reads!, guess(read([obs({ type: 'hydrant' })]))];
    expect(typeOf(d)).toBeUndefined();
  });
});

describe('기본 두 장을 앞에 두기 — main 화면은 첫 두 장을 기본 사진으로 읽는다', () => {
  it('다른 순서로 저장된 기록도 기본 두 장과 판독을 앞으로 옮긴다', () => {
    const d = normalizeDraft({ shots: [{ takenAt: at, dataUrl: 'x' }, { takenAt: at + 1, dataUrl: 'p1' }, { takenAt: at + 2, dataUrl: 'p2' }], reads: [null, read([]), null] });
    const swapped = { ...d, primaryPair: [d.shots[1].id!, d.shots[2].id!] };
    const fixed = primaryFirst(swapped);
    expect(fixed.shots.map((s) => s.dataUrl)).toEqual(['p1', 'p2', 'x']);
    expect(fixed.reads?.[0]).toEqual(read([]));
    expect(primaryFirst(fixed)).toBe(fixed);
  });
});
