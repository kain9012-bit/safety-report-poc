import { activeLocatedShot, knownPhotoTime, normalizeDraft, primaryShots } from './photoEvidence';
import type { DraftReport, Shot } from '../types/report';

/**
 * Only the candidate loses old photo-derived data. The original record stays stored until commit.
 * 화면(main)은 첫 두 장을 기본 사진으로 읽는다 — 다시 찍는 장부터 뒤의 사진(보완사진 포함)은 후보에서 뺀다.
 */
export function replacementDraft(draft: DraftReport, index: 0 | 1): DraftReport {
  const kept = draft.shots.slice(0, index);
  return {
    ...draft,
    shots: kept,
    ...(draft.schemaVersion === 2 ? {
      primaryPair: (draft.primaryPair ?? []).slice(0, index),
      evidenceRevision: (draft.evidenceRevision ?? 0) + 1,
      supplementAsked: undefined,
      sharedParking: undefined,
    } : {}),
    reads: (draft.reads ?? []).slice(0, index),
    overlap: undefined,
    firstOk: index === 1,
    ...(index === 0 ? {
      model: undefined,
      typeByLocation: undefined,
      typeByPhoto: undefined,
      ...(!draft.manual?.address ? { address: undefined, addressParcel: undefined, addressFrom: undefined } : {}),
      ...(!draft.manual?.type ? { type: undefined } : {}),
    } : {}),
    ...(!draft.manual?.plate ? { plate: undefined } : {}),
  };
}

const newPhotoId = () => globalThis.crypto?.randomUUID?.() ?? `photo-${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** 촬영 시각을 모르는 앨범 사진은 뒤로 — 시각을 지어내 순서를 정하지 않는다(iPhone 앨범 가져오기와 같다). */
const timeOrder = (s: Shot) => (knownPhotoTime(s) ? s.takenAt : Number.POSITIVE_INFINITY);

/**
 * 신고서 단계에서 기본 사진 칸을 다시 정한다(바꾸기·넣기·지우기).
 * - 남는 사진의 판독은 그대로 두고, 새 사진은 판독을 비워 다시 읽게 한다.
 * - 두 장은 촬영 시각 순으로 1·2번째에 둔다(화면·점검은 첫 두 장을 기본 사진으로 읽는다).
 * - 보완사진은 이전 두 장의 부족한 근거를 채우려고 받은 것이라 함께 뺀다. 같은 부족이 남으면 다시 묻는다.
 * - 발생지역을 정한 사진이 바뀌면 직접 고치지 않은 주소는 비워 남은 사진에서 다시 찾는다.
 * `d` 는 normalizeDraft 를 거친 기록이어야 한다(사진 객체를 그대로 비교한다).
 */
function withPair(d: DraftReport, pair: Shot[]): DraftReport {
  const sorted = [...pair].sort((a, b) => timeOrder(a) - timeOrder(b));
  const readOf = (s: Shot) => {
    const i = d.shots.indexOf(s);
    return i >= 0 ? d.reads?.[i] : undefined;
  };
  const next: DraftReport = {
    ...d,
    shots: sorted,
    reads: sorted.map(readOf) as DraftReport['reads'],
    primaryPair: sorted.map((s) => s.id!),
    evidenceRevision: (d.evidenceRevision ?? 0) + 1,
    overlap: undefined,
    firstOk: true,
    supplementAsked: undefined,
    sharedParking: undefined,
    ...(!d.manual?.plate ? { plate: undefined } : {}),
  };
  return activeLocatedShot(d) !== activeLocatedShot(next) && !d.manual?.address
    ? { ...next, address: undefined, addressParcel: undefined, addressFrom: undefined }
    : next;
}

/** 기본 사진 한 칸을 앨범 사진으로 바꾸거나, 빈 칸(slot 이 사진 수 이상)에 넣는다. */
export function replacePhoto(draft: DraftReport, slot: 0 | 1, photo: Shot): DraftReport {
  const d = normalizeDraft(draft);
  const pair = primaryShots(d);
  const s: Shot = { ...photo, id: newPhotoId(), roles: photo.roles ?? ['vehicle', 'connection'] };
  if (slot < pair.length) pair[slot] = s;
  else pair.push(s);
  return withPair(d, pair.slice(0, 2));
}

/** 기본 사진 한 칸을 지운다. 남은 사진이 1번째가 된다. 마지막 한 장을 지우는 일은 신고 자체를 지우는 것이라 여기서 다루지 않는다. */
export function removePhoto(draft: DraftReport, slot: 0 | 1): DraftReport {
  const d = normalizeDraft(draft);
  return withPair(d, primaryShots(d).filter((_, i) => i !== slot));
}

/**
 * 카메라로 바꾸기·넣기 — 남길 사진(keep)을 1번째로 두고 새 사진을 2번째로 찍는 후보.
 * 지금 찍는 사진이 늘 더 늦으므로 촬영 시각 순서와 맞는다. 남길 사진이 없으면 두 장을 처음부터 찍는다.
 * 원래 기록은 replacementDraft 와 같이 교체 저장이 끝날 때까지 그대로다.
 */
export function cameraDraft(draft: DraftReport, keep: 0 | 1 | undefined): DraftReport {
  const d = normalizeDraft(draft);
  const kept = keep === undefined ? undefined : primaryShots(d)[keep];
  return kept ? withPair(d, [kept]) : replacementDraft(d, 0);
}
