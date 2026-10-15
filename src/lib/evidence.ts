import { EVIDENCE_TYPES } from '../types/evidence';
import type { DetailRequest, EvidenceBox, EvidenceObservation, EvidenceRead, EvidenceSummary, EvidenceTri, EvidenceType, SharedParkingNotice, SupplementalNeed } from '../types/evidence';

const tri = (value: unknown): EvidenceTri => value === 'yes' || value === 'no' ? value : 'unclear';
const text = (value: unknown, length = 300) => typeof value === 'string' ? value.slice(0, length) : '';
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
export const isEvidenceType = (value: unknown): value is EvidenceType => EVIDENCE_TYPES.includes(value as EvidenceType);
export const EVIDENCE_LABEL: Record<EvidenceType, string> = { hydrant: '소화전', crossing: '횡단보도', corner: '교차로 모퉁이', busstop: '버스정류소', schoolzone: '어린이보호구역', sidewalk: '인도', disabled: '장애인전용주차구역', firelane: '소방차전용구역', evcharging: '친환경차 충전구역' };

export function evidenceBox(value: unknown): EvidenceBox | undefined {
  if (!Array.isArray(value) || value.length !== 4 || value.some((n) => typeof n !== 'number' || !Number.isFinite(n))) return;
  const box = value.map((n) => Math.round(Math.max(0, Math.min(1000, n)))) as EvidenceBox;
  return box[2] > box[0] && box[3] > box[1] ? box : undefined;
}

export function normalizeSharedNotice(value: unknown): SharedParkingNotice | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const r = record(value);
  const kind = ['general_car', 'ev_extra_time', 'both', 'other', 'unclear'].includes(String(r.kind)) ? r.kind as SharedParkingNotice['kind'] : 'unclear';
  return { kind, text: text(r.text, 600), targetBayRelation: tri(r.targetBayRelation), conditionsComplete: tri(r.conditionsComplete), bayText: text(r.bayText), timeText: text(r.timeText), otherConditions: text(r.otherConditions, 600), issuer: text(r.issuer), legalPermission: 'unverified' };
}

/** Discard model claims about metres, legality, GPS and caller provenance. */
export function normalizeObservations(raw: unknown, context: { photoId?: string; inputVersion?: string } = {}): EvidenceObservation[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 18).flatMap((value): EvidenceObservation[] => {
    const r = record(value);
    if (!isEvidenceType(r.type)) return [];
    const stop = record(r.busStop);
    const busStop = r.type === 'busstop' && r.busStop ? { publicId: text(stop.publicId, 80), name: text(stop.name, 160), readable: stop.readable === true && Boolean(text(stop.publicId) || text(stop.name)) } : undefined;
    return [{ type: r.type, identity: tri(r.identity), identityDetail: text(r.identityDetail), markingText: text(r.markingText, 600), markingToTarget: tri(r.markingToTarget), vehicleRelation: tri(r.vehicleRelation), boundary: tri(r.boundary), chargerToTarget: tri(r.chargerToTarget), ...(r.type === 'evcharging' ? { zoneKind: ['charging', 'eco_parking', 'priority', 'shared'].includes(String(r.zoneKind)) ? r.zoneKind as EvidenceObservation['zoneKind'] : 'unclear' } : {}), ...(busStop ? { busStop } : {}), relation: ['inside', 'boundary', 'adjacent', 'access'].includes(String(r.relation)) ? r.relation as EvidenceObservation['relation'] : 'unclear', unknownReasons: Array.isArray(r.unknownReasons) ? r.unknownReasons.filter((v): v is string => typeof v === 'string').slice(0, 8).map((v) => v.slice(0, 160)) : [], box: evidenceBox(r.box ?? r.box_2d), ...context, source: 'photo', legalStatus: 'unverified', distance: 'unverified', ...(r.type === 'evcharging' && r.sharedNotice ? { sharedNotice: normalizeSharedNotice(r.sharedNotice) } : {}) }];
  });
}

export function normalizeDetailRequests(value: unknown): DetailRequest[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw): DetailRequest[] => {
    const r = record(raw), box = evidenceBox(r.box ?? r.box_2d);
    if (!isEvidenceType(r.type) || !box || !['small', 'unreadable_text', 'blurred', 'partly_hidden', 'overlap_scan', 'user_region'].includes(String(r.reason))) return [];
    return [{ type: r.type, box, reason: r.reason as DetailRequest['reason'] }];
  }).slice(0, 2);
}

const legacyFlags: Partial<Record<EvidenceType, string>> = { crossing: 'onCrosswalk', sidewalk: 'onSidewalk', hydrant: 'fireHydrantNear', busstop: 'busStopVisible', corner: 'intersectionCorner', schoolzone: 'schoolZoneMarking' };
const requiredFields = ['identity', 'markingToTarget', 'vehicleRelation'] as const;
const boundaryTypes = new Set<EvidenceType>(['crossing', 'sidewalk', 'corner', 'disabled', 'firelane', 'evcharging']);

/** A crop or a separate photo cannot stitch unrelated yes answers into a confirmed relation. */
export function summarizeEvidence(reads: readonly (EvidenceRead | null | undefined)[]): EvidenceSummary[] {
  const valid = reads.filter((read): read is EvidenceRead => Boolean(read));
  return EVIDENCE_TYPES.flatMap((type): EvidenceSummary[] => {
    const obs = valid.flatMap((read) => (read.observations ?? []).filter((o) => o.type === type).map((o) => ({ ...o, photoId: read.photoId ?? o.photoId, inputVersion: read.inputVersion ?? o.inputVersion })));
    const legacy = valid.filter((r) => !r.observations && (record(r.scene)[legacyFlags[type] ?? ''] === 'yes' || r.typeGuess === type));
    if (obs.length === 0 && legacy.length === 0) return [];
    const linkedObservations = obs.filter((o) => !o.unknownReasons.includes('기본 사진과 같은 대상·장소 연결 미확인'));
    const checks = [...requiredFields, ...(boundaryTypes.has(type) ? ['boundary' as const] : []), ...(type === 'evcharging' && linkedObservations.some((o) => o.zoneKind === 'charging') ? ['chargerToTarget' as const] : [])];
    const conflict = checks.some((field) => linkedObservations.some((o) => o[field] === 'yes') && linkedObservations.some((o) => o[field] === 'no')) || linkedObservations.some((o) => o.unknownReasons.includes('전체 장면과 원본 부분의 관찰이 달라 재확인 필요'));
    const complete = linkedObservations.some((o) => requiredFields.every((field) => o[field] === 'yes') && (!boundaryTypes.has(type) || o.boundary === 'yes') && (type !== 'evcharging' || (o.zoneKind !== 'unclear' && o.zoneKind !== undefined && (o.zoneKind !== 'charging' || o.chargerToTarget === 'yes'))));
    const missing: string[] = [];
    if (!obs.some((o) => o.identity === 'yes')) missing.push('표시·시설의 종류 미확인');
    if (!obs.some((o) => o.markingToTarget === 'yes')) missing.push('표시와 대상 장소 연결 미확인');
    if (!obs.some((o) => o.vehicleRelation === 'yes')) missing.push('대상 차량과 장소 관계 미확인');
    if (boundaryTypes.has(type) && !obs.some((o) => o.boundary === 'yes')) missing.push('대상 장소의 경계 미확인');
    if (!complete && !missing.length && type !== 'evcharging') missing.push('같은 사진 안의 대상·표시 연결 미확인');
    if (type === 'evcharging' && !obs.some((o) => o.zoneKind && o.zoneKind !== 'unclear')) missing.push('충전·전용주차·우선주차 표시 구분 미확인');
    if (conflict) missing.unshift('사진 사이의 관찰이 서로 다름');
    if (['hydrant', 'busstop', 'corner'].includes(type)) missing.push('실제 거리 미확인');
    if (type === 'evcharging' && obs.some((o) => o.zoneKind === 'charging') && !obs.some((o) => o.chargerToTarget === 'yes')) missing.push('충전기와 대상 면 연결 미확인');
    missing.push('법적 적용·관할 접수 조건 별도 확인');
    const status: EvidenceSummary['status'] = obs.length === 0 ? 'legacy' : conflict ? 'conflict' : complete ? 'observed' : obs.every((o) => o.identity === 'no') ? 'not_observed' : 'needs_context';
    return [{ type, status, photoIds: [...new Set([...obs.map((o) => o.photoId), ...legacy.map((r) => r.photoId)].filter((id): id is string => Boolean(id)))], observations: obs, missing, legalStatus: 'unverified', distance: 'unverified' }];
  });
}

/** At most one actionable image request per candidate; never ask photos to prove legal distance. */
export function supplementalNeeds(reads: readonly (EvidenceRead | null | undefined)[], selectedType?: string): SupplementalNeed[] {
  return summarizeEvidence(reads).filter((s) => !selectedType || s.type === selectedType).flatMap((s): SupplementalNeed[] => {
    if (s.status === 'observed' || s.status === 'not_observed' || s.status === 'legacy') return [];
    const hasVisibleCue = s.observations.some((o) => o.identity === 'yes' || Boolean(o.markingText.trim()) || Boolean(o.box));
    if (!hasVisibleCue) return [];
    const identity = s.observations.some((o) => o.identity === 'yes');
    const connection = s.observations.some((o) => o.markingToTarget === 'yes' && o.vehicleRelation === 'yes' && (!boundaryTypes.has(o.type) || o.boundary === 'yes') && (o.type !== 'evcharging' || o.zoneKind !== 'charging' || o.chargerToTarget === 'yes'));
    const role = s.status === 'conflict' || (identity && !connection) ? 'connection' : 'marking';
    const message = s.type === 'evcharging' && s.missing.includes('충전기와 대상 면 연결 미확인') ? '차량·주차 칸·충전기가 연결되는 사진을 확인해 주세요. 연결이 보이지 않으면 미확인으로 저장할 수 있어요.' : role === 'connection' ? `차량·${EVIDENCE_LABEL[s.type]} 표시·경계가 함께 보이는 사진으로 연결을 확인해 주세요. 어려우면 미확인으로 저장할 수 있어요.` : `${EVIDENCE_LABEL[s.type]}의 글씨나 특징이 보이는 부분을 확인해 주세요. 보이지 않으면 미확인으로 저장할 수 있어요.`;
    return [{ id: `${s.type}:${role}`, type: s.type, role, message, photoIds: s.photoIds, reason: s.status === 'conflict' ? '상충하는 사진 근거' : identity ? '대상 연결 미확인' : '표시 식별 미확인' }];
  });
}

export interface SharedNoticeReview {
  state: 'not_observed' | 'ev_time_only' | 'needs_bay' | 'needs_conditions' | 'notice_observed' | 'conflict';
  message: string;
  legalPermission: 'unverified';
  notices: SharedParkingNotice[];
}

export function reviewSharedParking(observations: readonly EvidenceObservation[]): SharedNoticeReview {
  const notices = observations.filter((o) => o.type === 'evcharging').flatMap((o) => o.sharedNotice ? [o.sharedNotice] : []);
  let state: SharedNoticeReview['state'] = 'not_observed';
  const general = notices.filter((n) => n.kind === 'general_car' || n.kind === 'both');
  if (general.length) {
    if ((general.some((n) => n.targetBayRelation === 'yes') && general.some((n) => n.targetBayRelation === 'no')) || new Set(general.map((n) => n.timeText.trim()).filter(Boolean)).size > 1 || new Set(general.map((n) => n.otherConditions.trim()).filter(Boolean)).size > 1) state = 'conflict';
    else if (general.some((n) => n.targetBayRelation !== 'yes')) state = 'needs_bay';
    else if (general.some((n) => n.conditionsComplete !== 'yes')) state = 'needs_conditions';
    else state = 'notice_observed';
  } else if (notices.some((n) => n.kind === 'ev_extra_time')) state = 'ev_time_only';
  const messages: Record<SharedNoticeReview['state'], string> = { not_observed: '일반 자동차도 주차할 수 있다는 안내는 아직 확인하지 못했어요.', ev_time_only: '전기차의 주차 시간에 관한 안내예요. 일반 자동차 허용 내용은 미확인이에요.', needs_bay: '일반차 안내가 이 차량의 칸에 적용되는지 확인해 주세요.', needs_conditions: '일반차 안내의 시간·이용 대상 등 조건을 끝까지 확인하지 못했어요.', notice_observed: '일반차 병행주차 안내를 읽었어요. 촬영 당시 시간·이용 자격·운영 조건의 적용은 별도 확인이 필요해요.', conflict: '안내가 적용되는 칸에 관한 근거가 서로 달라요. 미확인으로 저장할 수 있어요.' };
  return { state, message: messages[state], legalPermission: 'unverified', notices };
}

/** Explicitly entered notice times only; unknown dates, holidays or eligibility never become permission. */
export function compareNoticeTime(input: { takenAt?: number; timezone?: 'Asia/Seoul'; startMinute?: number; endMinute?: number; allDay?: boolean; conditionsComplete: boolean; dayCondition?: 'none' | 'weekday' | 'holiday' | 'unknown'; validityConfirmed?: boolean }): 'matches_time' | 'outside_time' | 'unknown' {
  if (!Number.isFinite(input.takenAt) || input.timezone !== 'Asia/Seoul' || !input.conditionsComplete || input.validityConfirmed !== true || (input.dayCondition && input.dayCondition !== 'none')) return 'unknown';
  if (input.allDay === true) return 'matches_time';
  const { startMinute: start, endMinute: end } = input;
  if (start === undefined || end === undefined || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < 0 || start >= 1440 || end >= 1440 || start === end) return 'unknown';
  const date = new Date(input.takenAt! + 9 * 3600_000), minute = date.getUTCHours() * 60 + date.getUTCMinutes();
  if (!Number.isFinite(minute)) return 'unknown';
  // Inclusion of an endpoint is ambiguous unless explicitly established separately.
  if (minute === start || minute === end) return 'unknown';
  const matches = start < end ? minute > start && minute < end : minute > start || minute < end;
  return matches ? 'matches_time' : 'outside_time';
}

/** A supplemental image must be linked to the exact primary target before using its spatial assertions. */
export function constrainSupplementalRead<T extends EvidenceRead & { targetLink?: { referencePhotoId: string; sameVehicle: EvidenceTri; samePlace: EvidenceTri } }>(read: T, referencePhotoId?: string): T {
  const linked = Boolean(referencePhotoId) && read.targetLink?.referencePhotoId === referencePhotoId && read.targetLink?.sameVehicle === 'yes' && read.targetLink?.samePlace === 'yes';
  if (linked) return read;
  return {
    ...read,
    observations: read.observations?.map((observation) => ({ ...observation, markingToTarget: 'unclear', vehicleRelation: 'unclear', chargerToTarget: 'unclear', unknownReasons: [...new Set([...observation.unknownReasons, '기본 사진과 같은 대상·장소 연결 미확인'])], ...(observation.sharedNotice ? { sharedNotice: { ...observation.sharedNotice, targetBayRelation: 'unclear' } } : {}) })),
  };
}
