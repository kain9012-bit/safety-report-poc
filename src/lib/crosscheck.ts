/**
 * 위반유형 정하기 — **판정 근거는 사진뿐이다.** 위치자료(좌표 × 공공데이터)는 참고용 '의심'이다.
 *
 * 왜: 폰 GPS는 트인 곳에서도 ±5~10m, 건물 사이에선 수십 m 틀린다. 공공데이터 좌표도 틀리거나 빠진다.
 * 무엇보다 신고·과태료의 증거는 사진이다. "3m 안에 정류장이 있다"는 자료가 있어도
 * 사진에 정류장이 안 보이면 그 유형으로는 신고할 수 없다.
 *
 *  - 사진에 증거가 있고, 위치자료도 같은 말을 한다 → photo_confirmed (사진 증거 · 위치자료 일치)
 *  - 사진에 증거가 있고, 위치자료는 없거나 다른 말 → photo (사진 증거) — 자료 누락·GPS 오차일 수 있다고 적는다
 *  - 사진에 증거가 없다                            → none  — 유형을 채우지 않는다.
 *    위치자료가 의심하는 유형은 '의심'으로만 보여주고, 그게 보이게 다시 찍으라고 안내한다.
 */
import type { Candidate } from './recommend';
import type { ViolationType } from '../types/report';
import type { VisionResult } from '../../api/vision';

export type VerdictSource = 'photo_confirmed' | 'photo' | 'none';

export interface Verdict {
  /** 사진 증거가 있을 때만 채운다 */
  type?: ViolationType;
  source: VerdictSource;
  /** 사진에서 본 근거 */
  photoReason?: string;
  /** 위치자료가 그 유형에 대해 하는 말(참고) */
  coordNote?: string;
  /** 위치자료로는 의심되지만 사진에 증거가 없는 유형 — 신고 근거가 아니다 */
  suspicions: Candidate[];
  /** 사진에 함께 보인 다른 유형 — 사람이 바로 바꿀 수 있게 */
  alternatives: ViolationType[];
}

/** 이 자리에 그 유형을 가늠할 공공 위치자료가 있는가 */
export type Coverage = Partial<Record<ViolationType, boolean>>;

/** 사진 판단을 증거로 쓰는 최소 확신도 */
export const PHOTO_TYPE_FLOOR = 0.5;

export function crosscheck(cands: Candidate[], coverage: Coverage, photo?: VisionResult | null): Verdict {
  const evidenced =
    photo && photo.typeGuess !== 'none' && photo.typeConfidence >= PHOTO_TYPE_FLOOR ? photo.typeGuess : undefined;
  const suspicions = cands.filter((c) => c.type !== evidenced);
  const alternatives = (photo?.ruleTypes ?? []).filter(
    (t): t is ViolationType => t !== 'none' && t !== evidenced,
  );

  if (!evidenced) return { source: 'none', suspicions, alternatives };

  const hit = cands.find((c) => c.type === evidenced);
  if (hit) {
    return {
      type: evidenced,
      source: 'photo_confirmed',
      photoReason: photo!.evidence,
      coordNote: hit.reason,
      suspicions,
      alternatives,
    };
  }
  return {
    type: evidenced,
    source: 'photo',
    photoReason: photo!.evidence,
    coordNote: coverage[evidenced]
      ? '위치자료에는 근처에 없습니다 — 자료 누락이나 GPS 오차일 수 있습니다'
      : '이 자리에는 이 유형을 가늠할 위치자료가 없습니다',
    suspicions,
    alternatives,
  };
}

/** 의심 유형마다 "무엇이 사진에 나오게 찍어야 하는가" (조사까지 붙여 둔다) */
export const SHOW_IN_PHOTO: Partial<Record<ViolationType, string>> = {
  busstop: '정류장 표지판이나 승강장이',
  crossing: '횡단보도 흰 줄무늬와 차 바퀴가',
  schoolzone: '빨간 노면이나 어린이보호구역 표지가',
  corner: '교차로 모퉁이가',
  sidewalk: '보도 위에 올라선 바퀴가',
  hydrant: '소화전이나 소방용수 표시가',
};
