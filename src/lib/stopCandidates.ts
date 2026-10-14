import { bearingDegrees, distanceMeters } from './geo';
import type { Facility, LatLng } from './geo';
import { bearingDifference } from './heading';
import type { CaptureHeadingSnapshot } from './heading';
import type { CaptureLocationSnapshot } from './locationQuality';
import type { DraftReport } from '../types/report';

export interface StopPhotoEvidence {
  photoId: string;
  publicId?: string;
  publicIdNamespace?: string;
  readable: boolean;
  name?: string;
}
export interface StopOrigin extends LatLng {
  accuracy?: number;
  role: 'photo' | 'manual_vehicle' | 'map_search' | 'current';
}
export interface StopCandidate {
  key: string;
  facility: Facility;
  distance: number;
  bearing: number;
  directionDifference?: number;
  numberMatch: 'match' | 'text_only' | 'different' | 'unknown';
  state: 'number_match' | 'candidate' | 'review';
  reasons: string[];
  conflicts: string[];
}
export interface StopSelection {
  key: string;
  facility: Facility;
  selectedAt: number;
  source: 'user';
  photoEvidence?: StopPhotoEvidence;
  /** Selection identifies a candidate; it never proves a 10 m distance or photo recognition. */
  distanceStatus: 'unverified';
  inputKey?: string;
}
/** Selection context deliberately excludes selectedStopId, so choosing does not invalidate itself. */
export function stopSelectionInputKey(draft: DraftReport): string {
  return JSON.stringify([
    draft.evidenceRevision ?? 0, draft.primaryPair,
    draft.shots.map((photo) => [photo.id, photo.takenAt, photo.lat, photo.lng, photo.accuracy, photo.roles]),
    draft.vehicleLocation,
    (draft.reads ?? []).map((read) => read ? [read.photoId, read.analysisVersion, read.observations, read.targetLink] : null),
  ]);
}
export function stopKey(stop: Facility): string {
  return [stop.source ?? 'unknown', stop.regionCode ?? 'unknown', stop.id].map(encodeURIComponent).join(':');
}
const cleanId = (s?: string) => s?.trim().replace(/\s+/g, '');
const ORIGIN_LABEL = { photo: '촬영 위치', manual_vehicle: '사용자가 지정한 차량 위치', map_search: '지도 탐색 위치', current: '현재 기기 위치' };

/** Keep every supplied candidate. IDs outrank auxiliary direction; distance only orders discovery. */
export function rankStopCandidates(origin: StopOrigin, stops: readonly Facility[], options: { photoEvidence?: StopPhotoEvidence; heading?: CaptureHeadingSnapshot; location?: CaptureLocationSnapshot; incomplete?: boolean } = {}): StopCandidate[] {
  const photo = options.photoEvidence;
  const ranked = stops.map((facility): StopCandidate => {
    const distance = distanceMeters(origin, facility);
    const bearing = bearingDegrees(origin, facility);
    const out: StopCandidate = { key: stopKey(facility), facility: { ...facility }, distance, bearing, numberMatch: 'unknown', state: 'candidate', reasons: [`${ORIGIN_LABEL[origin.role]}에서 정류소 자료 좌표까지 지도상 약 ${Math.round(distance)}m · 위반 거리 미확인`], conflicts: [] };
    if (photo?.readable && cleanId(photo.publicId) && cleanId(facility.publicId)) {
      const sameText = cleanId(photo.publicId) === cleanId(facility.publicId);
      const sameNamespace = Boolean(photo.publicIdNamespace && photo.publicIdNamespace === facility.publicIdNamespace);
      out.numberMatch = sameNamespace ? sameText ? 'match' : 'different' : sameText ? 'text_only' : 'unknown';
      if (out.numberMatch === 'match') { out.state = 'number_match'; out.reasons.unshift('사진 공개 번호와 자료의 같은 번호 체계가 일치해요.'); }
      if (out.numberMatch === 'text_only') out.reasons.unshift('번호 글자는 같지만 지역·번호 체계가 확인되지 않았어요.');
    }
    if (photo?.readable && photo.name && facility.name === photo.name.trim()) out.reasons.push('사진의 이름과 같아요. 동명 정류소가 있을 수 있어요.');
    const heading = options.heading;
    const eligiblePosition = origin.role === 'photo' && options.location?.quality.status === 'nearby' && origin.accuracy !== undefined && origin.accuracy >= 0 && origin.accuracy < distance;
    if (eligiblePosition && heading?.status === 'usable' && heading.sample?.reference === 'true' && heading.sample.bearing !== undefined) {
      out.directionDifference = bearingDifference(heading.sample.bearing, bearing);
      if (out.directionDifference <= 30) out.reasons.push('품질을 확인한 촬영 방향과 비슷해요. 사진 가시성은 별도 확인이 필요해요.');
      if (out.numberMatch === 'match' && out.directionDifference > 90) { out.state = 'review'; out.conflicts.push('사진 번호와 촬영 방향이 맞지 않아 재확인이 필요해요.'); }
    } else out.reasons.push('방향은 후보 순위에 반영하지 않았어요.');
    if (options.incomplete) out.reasons.push('주변 자료가 일부여서 빠진 후보가 있을 수 있어요.');
    return out;
  });
  const matches = ranked.filter((c) => c.numberMatch === 'match');
  if (matches.length > 1) for (const c of matches) { c.state = 'review'; c.conflicts.push('같은 번호 체계에 일치 후보가 여러 개 있어 선택을 확인해야 해요.'); }
  return ranked.sort((a, b) => (b.numberMatch === 'match' ? 1 : 0) - (a.numberMatch === 'match' ? 1 : 0)
    || (b.numberMatch === 'text_only' ? 1 : 0) - (a.numberMatch === 'text_only' ? 1 : 0)
    || (a.directionDifference ?? 361) - (b.directionDifference ?? 361) || a.distance - b.distance || a.key.localeCompare(b.key));
}
