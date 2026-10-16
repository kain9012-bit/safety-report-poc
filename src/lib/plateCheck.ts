/**
 * 차량번호 — AI 판독과 신고인이 입력한 번호의 관계(제출 전 점검·차량번호 단계·담당자 요약이 같이 쓴다).
 *
 * AI 는 번호를 읽어 돕기만 한다. 사진이 작거나 흐려 AI 가 못 읽으면 신고인이 사진을 보고 직접 입력하고,
 * 담당자가 사진으로 한 번 더 확인한다(주황). AI 가 두 장에서 확실히 읽은 번호와 입력이 다르거나,
 * 두 장에서 확실히 서로 다른 번호를 읽었으면 오타·다른 차일 수 있어 신고인이 사진을 보고 확인해야 제출할 수 있다.
 * 확인한 뒤에도 담당자가 다시 보도록 주황으로 남긴다.
 */
import type { VisionResult } from '../../api/vision';
import type { DraftReport } from '../types/report';
import { PLATE_CONFIDENCE_FLOOR, isValidPlate } from './rules';

export interface PlateStatus {
  /** match: 두 장 판독·입력 일치 · empty: 두 장에서 같은 번호를 읽었는데 입력이 비었음
   *  unreadable: AI 가 확실히 읽지 못함 · conflict: AI 가 확실히 읽은 값과 어긋남 */
  kind: 'match' | 'empty' | 'unreadable' | 'conflict';
  /** conflict 의 종류 — entered: 입력이 두 장 판독과 다름 · reads: 두 장 판독이 서로 다름 */
  conflict?: 'entered' | 'reads';
  /** 신고인이 입력한 번호(공백 제거). 비었으면 '' */
  entered: string;
  /** 두 장에서 읽힌 번호(읽힌 것만, 공백 제거) */
  reads: string[];
  /** 신고인이 지금 입력한 번호를 사진을 보고 확인했다 */
  confirmed: boolean;
  /** unreadable 일 때 이유 */
  reason?: string;
}

const clean = (text?: string) => (text ?? '').replace(/\s/g, '');

export function plateStatus(draft: Pick<DraftReport, 'plate' | 'plateConfirmedFor'>, vision?: VisionResult | null): PlateStatus {
  const entered = clean(draft.plate);
  const plate = vision?.plate;
  const reads = (plate?.reads ?? []).map(clean);
  const valid = reads.length === 2 && reads.every(isValidPlate);
  const confident = typeof plate?.confidence === 'number' && Number.isFinite(plate.confidence) && plate.confidence >= PLATE_CONFIDENCE_FLOOR;
  const sure = valid && confident;
  const confirmed = Boolean(entered) && clean(draft.plateConfirmedFor) === entered;
  const trustedMatch = sure && reads[0] === reads[1] && vision?.sameVehicle === 'yes' && plate?.agree === true && Boolean(plate?.readable) && clean(plate?.text) === reads[0];
  if (trustedMatch && entered === reads[0]) return { kind: 'match', entered, reads, confirmed };
  if (sure && reads[0] !== reads[1]) return { kind: 'conflict', conflict: 'reads', entered, reads, confirmed };
  if (trustedMatch) return entered ? { kind: 'conflict', conflict: 'entered', entered, reads, confirmed } : { kind: 'empty', entered, reads, confirmed };
  const reason = !vision
    ? '판독 결과 없음'
    : reads.length === 0
      ? '번호판을 읽지 못함'
      : reads.length === 1
        ? `한 장에서만 읽힘(${reads[0]})`
        : !valid
          ? `읽은 값이 번호판 형식과 다름(${reads.join(' / ')})`
          : !confident
            ? `확신도가 기준(${Math.round(PLATE_CONFIDENCE_FLOOR * 100)}%) 미만`
            : '두 장 번호판 일치를 확정할 수 없음';
  return { kind: 'unreadable', entered, reads, confirmed, reason };
}

/** 사진마다 AI 가 읽은 번호 — 못 읽은 장은 null */
export function photoPlates(vision?: VisionResult | null): ({ text: string; confidence: number } | null)[] {
  return [0, 1].map((i) => {
    const p = vision?.photos?.[i];
    const text = clean(p?.plate.text);
    return p && p.plate.readable && text ? { text, confidence: p.plate.confidence } : null;
  });
}

/** 사진마다 AI 가 읽은 번호 — '1장 12가3456(확신 92%), 2장 못 읽음' */
export function perPhotoReads(vision?: VisionResult | null): string {
  if (!vision?.photos?.length) return '판독 결과 없음';
  return photoPlates(vision)
    .map((p, i) => (p ? `${i + 1}장 ${p.text}(확신 ${Math.round(p.confidence * 100)}%)` : `${i + 1}장 못 읽음`))
    .join(', ');
}
