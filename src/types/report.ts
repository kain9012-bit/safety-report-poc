import type { PhotoMeta } from '../lib/authenticity';
/** 안전신문고 불법주정차 신고서 한 건이 채워야 하는 칸 */
export type ViolationType =
  | 'hydrant'      // 소화전 5m 이내
  | 'crossing'     // 횡단보도
  | 'corner'       // 교차로 모퉁이 5m 이내
  | 'busstop'      // 버스정류소 10m 이내
  | 'schoolzone'   // 어린이보호구역
  | 'sidewalk';    // 인도

export const VIOLATION_LABEL: Record<ViolationType, string> = {
  hydrant: '소화전 5m 이내',
  crossing: '횡단보도',
  corner: '교차로 모퉁이 5m 이내',
  busstop: '버스정류소 10m 이내',
  schoolzone: '어린이보호구역',
  sidewalk: '인도',
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

/** 좌표가 있는 첫 컷. 첫 장에 좌표가 없어도 둘째 장에 있으면 그걸 쓴다. */
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
  /** 사람이 직접 고친 칸. 고친 칸은 자동 작성이 다시 덮어쓰지 않는다. */
  manual?: Partial<Record<EditableField, boolean>>;
}

export type EditableField = 'type' | 'address' | 'plate' | 'body';
