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

/** Structural input avoids importing the API into the shared evidence rules. */
export interface EvidenceRead {
  observations?: EvidenceObservation[];
  analysisVersion?: number;
  photoId?: string;
  inputVersion?: string;
  scene?: Record<string, unknown> | object;
  typeGuess?: string;
}
