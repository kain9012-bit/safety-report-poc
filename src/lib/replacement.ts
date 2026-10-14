import type { DraftReport } from '../types/report';

/** Only the candidate loses old photo-derived data. The original record stays stored until commit. */
export function replacementDraft(draft: DraftReport, index: 0 | 1): DraftReport {
  return {
    ...draft,
    shots: draft.schemaVersion === 2 ? draft.shots : draft.shots.slice(0, index),
    ...(draft.schemaVersion === 2 ? { primaryPair: (draft.primaryPair ?? []).slice(0, index), evidenceRevision: (draft.evidenceRevision ?? 0) + 1 } : {}),
    reads: draft.schemaVersion === 2 ? draft.reads : (draft.reads ?? []).slice(0, index),
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
