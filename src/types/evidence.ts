/** Photo observations are separate from legal eligibility and user statements. */
export const EVIDENCE_TYPES = ['crossing', 'sidewalk', 'hydrant', 'busstop', 'corner', 'schoolzone', 'disabled', 'firelane', 'evcharging'] as const;
export type EvidenceType = typeof EVIDENCE_TYPES[number];
export type EvidenceTri = 'yes' | 'no' | 'unclear';
export type EvidenceBox = [number, number, number, number];
export type EvidenceRelation = 'inside' | 'boundary' | 'adjacent' | 'access' | 'unclear';

export interface SharedParkingNotice {
  kind: 'general_car' | 'ev_extra_time' | 'both' | 'other' | 'unclear';
  text: string;
  targetBayRelation: EvidenceTri;
  conditionsComplete: EvidenceTri;
  bayText: string;
  timeText: string;
  otherConditions: string;
  issuer: string;
  /** Text read in an image is not verified administrative permission. */
  legalPermission: 'unverified';
}

export interface EvidenceObservation {
  type: EvidenceType;
  identity: EvidenceTri;
  identityDetail: string;
  markingText: string;
  markingToTarget: EvidenceTri;
  vehicleRelation: EvidenceTri;
  boundary: EvidenceTri;
  chargerToTarget: EvidenceTri;
  zoneKind?: 'charging' | 'eco_parking' | 'priority' | 'shared' | 'unclear';
  busStop?: { publicId: string; name: string; publicIdNamespace?: string; readable: boolean };
  relation: EvidenceRelation;
  unknownReasons: string[];
  /** Server/client supplied, never trusted from the image model. */
  photoId?: string;
  inputVersion?: string;
  box?: EvidenceBox;
  source: 'photo';
  legalStatus: 'unverified';
  distance: 'unverified';
  sharedNotice?: SharedParkingNotice;
}

export interface DetailRequest {
  type: EvidenceType;
  box: EvidenceBox;
  reason: 'small' | 'unreadable_text' | 'blurred' | 'partly_hidden' | 'overlap_scan' | 'user_region';
}

export interface EvidenceSummary {
  type: EvidenceType;
  status: 'observed' | 'needs_context' | 'conflict' | 'not_observed' | 'legacy';
  photoIds: string[];
  observations: EvidenceObservation[];
  missing: string[];
  legalStatus: 'unverified';
  distance: 'unverified';
}

export interface SupplementalNeed {
  id: string;
  type: EvidenceType;
  role: 'connection' | 'marking' | 'context';
  message: string;
  photoIds: string[];
  reason: string;
}

/** 바퀴 하나가 닿은 바닥 — 하나만 고른다 */
export type WheelSurface = 'roadway' | 'crosswalk_stripe' | 'sidewalk_block' | 'curb' | 'unclear';
/** 차 전체로 하나 — 한 바퀴라도 흰 줄 위면 crosswalk, 보도블록 위면 sidewalk, 둘 다면 both, 보이는 바퀴가 모두 차도면 roadway */
export type GroundSurface = 'roadway' | 'crosswalk' | 'sidewalk' | 'both' | 'unclear';
/** 차와 횡단보도의 관계 — on(흰 줄 위)·adjacent(바로 앞뒤)·apart(떨어짐)·none(횡단보도 없음) */
export type CrosswalkRelation = 'on' | 'adjacent' | 'apart' | 'none' | 'unclear';

/**
 * '바퀴가 닿은 바닥' 판독(사진 한 장). 횡단보도·인도 '위'는 이 답으로만 정한다.
 * 근처에 보이는 표시와 차가 그 위에 있는 것을 섞지 않으려고, 표시 관찰(observations)과 따로 묻는다.
 */
export interface GroundRead {
  surface: GroundSurface;
  wheels: { wheel: string; surface: WheelSurface }[];
  crosswalkRelation: CrosswalkRelation;
  evidence: string;
}

/** Structural input avoids importing the API into the shared evidence rules. */
export interface EvidenceRead {
  /** 없으면(이전 판독) 횡단보도·인도 '위'를 확인하지 않은 것으로 본다 */
  ground?: GroundRead;
  observations?: EvidenceObservation[];
  analysisVersion?: number;
  photoId?: string;
  inputVersion?: string;
  scene?: Record<string, unknown> | object;
  typeGuess?: string;
}
