/**
 * 교차검증 — 좌표 추천(recommend.ts)과 사진 판독(api/vision.ts)을 맞대어 위반유형을 정한다.
 *
 * 두 축은 서로 모른다. 사진 판독에는 좌표·주변 시설을 알려주지 않았다.
 * 그래서 둘이 같은 답을 내면 믿을 만하고, 엇갈리면 사람에게 둘 다 보여준다.
 *
 *  - 사진 유형이 좌표 후보에 있다      → verified (좌표×사진 교차검증)
 *  - 그 유형은 좌표 자료가 아예 없다    → photo    (사진 판독 · 확인 필요)  예: 교차로 모퉁이, 인도
 *  - 좌표 자료가 있는데 근처에 없다     → conflict (좌표·사진 엇갈림 · 확인 필요)
 *  - 사진이 판단을 못 했다              → 좌표 추천 그대로(likely / possible)
 */
import type { Candidate } from './recommend';
import type { ViolationType } from '../types/report';
import type { VisionResult } from '../../api/vision';

export type VerdictSource = 'verified' | 'photo' | 'conflict' | 'likely' | 'possible' | 'none';

export interface Verdict {
  type?: ViolationType;
  source: VerdictSource;
  coordReason?: string;
  photoReason?: string;
  /** 사람이 바로 바꿀 수 있게 보여줄 다른 후보 */
  alternatives: ViolationType[];
}

/** 이 좌표 주변에 그 유형을 가늠할 공공데이터가 있는가 */
export type Coverage = Partial<Record<ViolationType, boolean>>;

/** 사진 판단을 믿는 최소 확신도 */
export const PHOTO_TYPE_FLOOR = 0.5;

export function crosscheck(cands: Candidate[], coverage: Coverage, photo?: VisionResult | null): Verdict {
  const guess = photo && photo.typeGuess !== 'none' && photo.typeConfidence >= PHOTO_TYPE_FLOOR ? photo.typeGuess : undefined;
  const others = (t?: ViolationType) => cands.map((c) => c.type).filter((x) => x !== t);

  if (guess) {
    const hit = cands.find((c) => c.type === guess);
    if (hit) {
      return { type: guess, source: 'verified', coordReason: hit.reason, photoReason: photo!.evidence, alternatives: others(guess) };
    }
    if (!coverage[guess]) {
      return {
        type: guess,
        source: 'photo',
        coordReason: '이 유형은 이 자리에 쓸 공공 위치자료가 없어 사진으로만 판단했습니다',
        photoReason: photo!.evidence,
        alternatives: others(guess),
      };
    }
    return {
      type: guess,
      source: 'conflict',
      coordReason: cands[0] ? `좌표로는 ${cands[0].reason}` : '좌표로는 근처에 해당 시설이 없습니다',
      photoReason: photo!.evidence,
      alternatives: others(guess),
    };
  }

  const top = cands[0];
  if (top) return { type: top.type, source: top.level, coordReason: top.reason, alternatives: others(top.type) };
  return { source: 'none', alternatives: [] };
}
