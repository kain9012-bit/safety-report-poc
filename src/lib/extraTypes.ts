/**
 * 6대 밖 불법주정차 유형(장애인전용구역·소방차전용구역·친환경차충전구역)의 추가 점검 — **전부 규칙이다.**
 *
 * 2026-10-09 회의 결정: 불법주정차 안에서 이 세 유형을 함께 다루고, 기존 규정(사진 2장·1분 간격)은 그대로 둔다.
 * 6대와 다른 점은 '구역 안에 차가 있다'만으로는 위반이 아닐 수 있다는 것이다.
 *  - 장애인전용구역: 장애인자동차표지를 붙인 차는 세워도 된다 → 앞유리에 표지가 **없음**이 사진에 보여야 한다
 *    (서울 스마트불편신고 안내: 자동차 전면에 표지가 없거나 위반장소 표식이 들어가도록 촬영)
 *  - 친환경차충전구역: 친환경차가 아닌 차의 주차가 위반이다 → 일반차인지 보여야 한다.
 *    충전 후 장시간 주차(급속 1시간·완속 14시간)는 몇 시간 간격 사진이 필요해 이 앱은 다루지 않는다
 *  - 소방차전용구역: 2018. 8. 10. 이후 건축허가를 받은 100세대 이상 아파트·3층 이상 기숙사만 과태료 대상
 *
 * AI는 장면 항목(disabledPermit·evVehicle)을 보기만 하고, 통과 여부는 여기서 정한다.
 */
import type { CheckResult } from './rules';
import type { ViolationType } from '../types/report';
import type { Scene } from '../../api/vision';

/** 그 유형만의 추가 점검. 6대 유형이면 undefined */
export function extraTypeCheck(type: ViolationType | undefined, scene?: Scene | null): CheckResult | undefined {
  if (type === 'disabled') {
    const v = scene?.disabledPermit;
    return {
      id: 'permit',
      label: '장애인자동차표지',
      status: v === 'yes' ? 'fail' : v === 'no' ? 'pass' : 'warn',
      detail:
        v === 'yes'
          ? '차 앞유리에 장애인자동차표지가 보입니다. 표지를 붙인 차는 장애인전용구역에 세울 수 있어 위반이 아닙니다.'
          : v === 'no'
            ? '차 앞유리에 장애인자동차표지가 보이지 않습니다.'
            : '앞유리가 잘 보이지 않습니다. 표지가 없다는 것이 보이게 차 앞쪽을 찍어 주세요.',
    };
  }
  if (type === 'evcharge') {
    const v = scene?.evVehicle;
    return {
      id: 'ev',
      label: '일반차 여부',
      status: v === 'yes' ? 'fail' : v === 'no' ? 'pass' : 'warn',
      detail:
        v === 'yes'
          ? '친환경차(하늘색 번호판)로 보입니다. 일반차 주차 위반이 아닙니다. 충전 후 오래 세운 차(급속 1시간·완속 14시간 초과)는 몇 시간 간격 사진이 필요해 이 앱에서는 신고하지 않습니다.'
          : v === 'no'
            ? '친환경차가 아닌 차로 보입니다.'
            : '번호판 색이 잘 보이지 않습니다. 친환경차가 아닌지 확인해 주세요.',
    };
  }
  if (type === 'firelane') {
    return {
      id: 'firelane',
      label: '소방차전용구역 대상 건물',
      status: 'warn',
      detail:
        '2018. 8. 10. 이후 건축허가를 받은 100세대 이상 아파트·3층 이상 기숙사의 전용구역만 과태료 대상입니다. 그 밖의 건물은 계도로 끝날 수 있습니다.',
    };
  }
  if (type === 'etc') {
    return {
      id: 'etc',
      label: '기타 유형',
      status: 'warn',
      detail: '기타는 사진 자동 판독 대상이 아닙니다. 무엇을 위반했는지(예: 황색 실선, 이중주차) 내용에 적고, 그 근거가 사진에 보이는지 확인해 주세요.',
    };
  }
  return undefined;
}

/** 유형 선택 창 아래에 적는 안내 — 회의에서 자동 판독을 보류한 '기타' 유형 */
export const OTHER_TYPES_NOTE =
  "기타(중앙선·황색 실선·안전지대·이중주차·자전거도로·철길 건널목 등)는 사진 자동 판독 없이 직접 골라 신고합니다. 무엇을 위반했는지 내용에 적어 주세요.";
