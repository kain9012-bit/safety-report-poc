import type { DraftReport } from '../types/report';

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
