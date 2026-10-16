import { locatedShot } from '../types/report';
import type { DraftReport, Shot } from '../types/report';

/** Only the candidate loses old photo-derived data. The original record stays stored until commit. */
export function replacementDraft(draft: DraftReport, index: 0 | 1): DraftReport {
  return {
    ...draft,
    shots: draft.shots.slice(0, index),
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

/** 촬영 시각을 모르는 앨범 사진은 뒤로 — 시각을 지어내 순서를 정하지 않는다. */
const timeOrder = (s: Shot) =>
  s.source === 'album' && s.meta?.takenAt === undefined ? Number.POSITIVE_INFINITY : s.takenAt;

/**
 * 신고서 단계에서 사진 두 칸을 다시 정한다(바꾸기·넣기·지우기).
 * - 남는 사진의 판독은 그대로 두고, 새 사진은 판독을 비워 다시 읽게 한다.
 * - 두 장은 촬영 시각 순으로 1·2번째에 둔다(화면·점검은 첫 장을 먼저 찍은 사진으로 읽는다).
 * - 발생지역을 정한 사진이 바뀌면 직접 고치지 않은 주소는 비워 남은 사진에서 다시 찾는다.
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
    overlap: undefined,
    firstOk: true,
    ...(!d.manual?.plate ? { plate: undefined } : {}),
  };
  return locatedShot(d.shots) !== locatedShot(next.shots) && !d.manual?.address
    ? { ...next, address: undefined, addressParcel: undefined, addressFrom: undefined }
    : next;
}

/** 사진 한 칸을 앨범 사진으로 바꾸거나, 빈 칸(slot 이 사진 수 이상)에 넣는다. */
export function replacePhoto(draft: DraftReport, slot: 0 | 1, photo: Shot): DraftReport {
  const pair = draft.shots.slice(0, 2);
  if (slot < pair.length) pair[slot] = photo;
  else pair.push(photo);
  return withPair(draft, pair.slice(0, 2));
}

/** 사진 한 칸을 지운다. 남은 사진이 1번째가 된다. 마지막 한 장을 지우는 일은 신고 자체를 지우는 것이라 여기서 다루지 않는다. */
export function removePhoto(draft: DraftReport, slot: 0 | 1): DraftReport {
  return withPair(draft, draft.shots.slice(0, 2).filter((_, i) => i !== slot));
}

/**
 * 카메라로 바꾸기·넣기 — 남길 사진(keep)을 1번째로 두고 새 사진을 2번째로 찍는 후보.
 * 지금 찍는 사진이 늘 더 늦으므로 촬영 시각 순서와 맞는다. 남길 사진이 없으면 두 장을 처음부터 찍는다.
 * 원래 기록은 replacementDraft 와 같이 교체 저장이 끝날 때까지 그대로다.
 */
export function cameraDraft(draft: DraftReport, keep: 0 | 1 | undefined): DraftReport {
  const kept = keep === undefined ? undefined : draft.shots[keep];
  return kept ? withPair(draft, [kept]) : replacementDraft(draft, 0);
}
