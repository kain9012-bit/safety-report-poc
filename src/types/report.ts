import type { PhotoMeta } from '../lib/authenticity';
import type { PhotoRead } from '../../api/vision';
/** 안전신문고 불법주정차 신고서 한 건이 채워야 하는 칸 */
export type ViolationType =
  | 'hydrant'      // 소화전 5m 이내
  | 'crossing'     // 횡단보도
  | 'corner'       // 교차로 모퉁이 5m 이내
  | 'busstop'      // 버스정류소 10m 이내
  | 'schoolzone'   // 어린이보호구역
  | 'sidewalk'     // 인도
  // 6대 밖 — 2026-10-09 회의 결정으로 불법주정차 안에서 함께 다룬다(규정은 그대로: 사진 2장·1분 간격)
  | 'disabled'     // 장애인전용구역
  | 'firelane'     // 소방차전용구역
  | 'evcharge'     // 친환경차충전구역
  // 기타 — 중앙선·황색 실선·안전지대·이중주차 등. 사진 자동 판독 없이 신고인이 직접 고르고 내용에 적는다
  | 'etc';

/** 6대 불법주정차(주민신고제) 유형 — 위치자료·지역 규정은 이 여섯 가지만 다룬다 */
export const SIX_TYPES = ['hydrant', 'crossing', 'corner', 'busstop', 'schoolzone', 'sidewalk'] as const;
/** 6대 밖에서 함께 다루는 유형(안전신문고 불법주정차 '일반' 유형) */
export const EXTRA_TYPES = ['disabled', 'firelane', 'evcharge'] as const;
/** 사진 자동 판독 없이 직접 고르는 유형 */
export const MANUAL_TYPES = ['etc'] as const;
export function isSixType(t: ViolationType): boolean {
  return (SIX_TYPES as readonly string[]).includes(t);
}

export const VIOLATION_LABEL: Record<ViolationType, string> = {
  hydrant: '소화전 5m 이내',
  crossing: '횡단보도',
  corner: '교차로 모퉁이 5m 이내',
  busstop: '버스정류소 10m 이내',
  schoolzone: '어린이보호구역',
  sidewalk: '인도',
  disabled: '장애인전용구역',
  firelane: '소방차전용구역',
  evcharge: '친환경차충전구역',
  etc: '기타',
};

export interface Shot {
  /** 촬영 시각 — 신고서의 '발생일시'이자 1분 간격 판정의 기준 */
  takenAt: number;
  lat?: number;
  lng?: number;
  /** 위치 정확도(m). 좌표 기반 유형 판정의 신뢰도를 좌우한다. */
  accuracy?: number;
  /** 좌표가 없을 때 그 이유 — 신고서가 무엇을 하라고 안내할지 정한다 */
  locIssue?: 'denied' | 'unavailable';
  dataUrl: string;
  /** 앱 카메라로 찍었는지, 앨범에서 골랐는지 */
  source?: 'camera' | 'album';
  /** 앨범 사진의 파일 촬영 정보(EXIF) — 진위 점검에 쓴다 */
  meta?: PhotoMeta;
}

/** 좌표가 있는 첫 번째 사진. 첫 번째 사진에 좌표가 없어도 두 번째 사진에 있으면 그걸 쓴다. */
export function locatedShot(shots: readonly Shot[]): Shot | undefined {
  return shots.find((s) => s.lat !== undefined && s.lng !== undefined);
}

export interface DraftReport {
  shots: Shot[];
  /** 발생지역 — 도로명주소가 있으면 도로명, 없으면 지번 */
  address?: string;
  /** 도로명과 함께 받은 지번주소(참고용) */
  addressParcel?: string;
  /** 사람이 고른 주소의 출처 — 위치찾기 지도에서 골랐는지, 글자로 쳤는지 */
  addressFrom?: 'map' | 'typed';
  plate?: string;
  type?: ViolationType;
  /** 좌표로 계산한 유형 후보와 사진으로 판독한 유형이 엇갈리면 사람에게 묻는다. */
  typeByLocation?: ViolationType;
  typeByPhoto?: ViolationType;
  body?: string;
  /** 사진마다 판독 결과(AI는 보이는 것만 읽는다) — shots 와 같은 순서. 실패한 장은 null */
  reads?: (PhotoRead | null)[];
  /** 판독에 쓴 모델 */
  model?: string;
  /** 첫 번째 사진 판독 결과를 사람이 확인했다(두 번째 사진 대기로 넘어감) */
  firstOk?: boolean;
  /** 두 사진 겹침 — 규칙 기반 영상 대조(overlap.ts) */
  overlap?: { ratio: number; score: number; same: boolean };
  /** 사람이 직접 고친 칸. 고친 칸은 자동 작성이 다시 덮어쓰지 않는다. */
  manual?: Partial<Record<EditableField, boolean>>;
}

export type EditableField = 'type' | 'address' | 'plate' | 'body';
