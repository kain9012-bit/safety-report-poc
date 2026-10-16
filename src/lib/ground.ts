/** '바퀴가 닿은 바닥' 판독을 화면에 보일 말(작업 브랜치·iPhone 과 같은 문구) */
import type { GroundSurface } from '../../api/vision';

export const GROUND_TEXT: Record<GroundSurface, string> = { roadway: '차도', crosswalk: '횡단보도 흰 줄', sidewalk: '보도블록', both: '흰 줄·보도블록', unclear: '모름' };

/** 횡단보도 바로 앞으로 읽혔을 때 위반 유형 확인 단계에 한 줄로 알린다 */
export const CROSSWALK_ADJACENT_NOTE = '차가 횡단보도 바로 앞에 서 있는 것으로 보여요(바퀴는 횡단보도 밖). 횡단보도로부터 10m 이내도 정차·주차 금지 장소지만, 거리는 사진으로 확인하지 않았어요.';
