/**
 * 제출 전 반려 점검 — 담당 공무원이 불수용하는 흔한 사유를 제출 전에 미리 걸러낸다. **전부 규칙이다.**
 *
 * 빨간불(fail)이 하나라도 있으면 제출할 수 없다. 노란불(warn)은 알리되 막지 않는다.
 * 기본 다섯 가지(1분 간격·접수 기한·촬영시각 표시·차량번호·위치)는 rules.ts 의 runChecks 를 그대로 쓰고,
 * 여기서 사진 증거·같은 차·보호구역 시간·앨범 진위·주소·내용을 더한다.
 */
import { checkAlbum, worst } from './authenticity';
import { BODY_MIN } from './compose';
import { CAPTURE_WAIT_SEC, MIN_INTERVAL_SEC, SCHOOLZONE_HOURS, runChecks } from './rules';
import type { CheckResult } from './rules';
import type { Verdict } from './crosscheck';
import { locatedShot } from '../types/report';
import type { DraftReport } from '../types/report';
import type { VisionResult } from '../../api/vision';

export interface PrecheckInput {
  draft: DraftReport;
  body: string;
  verdict: Verdict;
  vision?: VisionResult | null;
  now?: number;
}

export interface Precheck {
  checks: CheckResult[];
  /** 앨범 사진이 있으면 그 진위 점검 항목(장별·두 장 관계) */
  album: CheckResult[];
  blocked: boolean;
}

export function precheck({ draft, body, verdict, vision, now = Date.now() }: PrecheckInput): Precheck {
  const shots = draft.shots;
  const at = locatedShot(shots);
  const albumShots = shots.filter((s) => s.source === 'album' && s.meta);
  const album = albumShots.length ? checkAlbum(albumShots.map((s) => s.meta!), now) : [];

  // 촬영시각 기록이 없는 앨범 사진은 시각을 모르는 것으로 본다(파일 수정시각으로 대신하지 않는다)
  const noTime = albumShots.some((s) => s.meta!.takenAt === undefined);
  const base = runChecks({
    shotTimes: shots.filter((s) => !(s.source === 'album' && s.meta?.takenAt === undefined)).map((s) => s.takenAt),
    // 카메라 사진도 앨범 사진도 촬영시각을 사진 위에 박는다(camera.ts drawStamp) — 단 시각 기록이 있을 때만
    hasTimestampOverlay: shots.length > 0 && !noTime,
    plate: draft.plate,
    lat: at?.lat,
    lng: at?.lng,
    accuracy: at?.accuracy,
    now,
  }).map((c) => {
    if (noTime && (c.id === 'interval' || c.id === 'timestamp')) {
      return { ...c, status: 'fail' as const, detail: '촬영시각 기록이 없는 앨범 사진이 있어 확인할 수 없습니다.' };
    }
    // 현장 테스트용 짧은 대기로 찍었으면 그 사실을 함께 적는다(기준 자체는 그대로)
    if (c.id === 'interval' && c.status === 'fail' && CAPTURE_WAIT_SEC < MIN_INTERVAL_SEC && albumShots.length === 0) {
      return { ...c, detail: `${c.detail} (지금은 테스트용 ${CAPTURE_WAIT_SEC}초 대기로 찍습니다)` };
    }
    if (c.id === 'location' && albumShots.length > 0 && at && at.accuracy === undefined) {
      return { ...c, detail: '앨범 사진 파일에 남은 위치입니다(정확도 기록 없음).' };
    }
    return c;
  });

  const out: CheckResult[] = [...base];

  // 위반유형 — 사진 증거가 있어야 한다
  const manualType = Boolean(draft.manual?.type);
  out.push({
    id: 'evidence',
    label: '위반유형 사진 증거',
    status: !draft.type ? 'fail' : manualType && verdict.type !== draft.type ? 'warn' : 'pass',
    detail: !draft.type
      ? '위반유형이 비어 있습니다. 위반 장소가 사진에 보이게 찍거나 유형을 골라 주세요.'
      : manualType && verdict.type !== draft.type
        ? '직접 고른 유형입니다. 그 근거(표지판·노면 표시 등)가 사진에 보이는지 확인해 주세요.'
        : '사진에서 위반 장소의 근거를 찾았습니다.',
  });

  // 같은 차 — 두 장에서 따로 읽은 번호
  const same = vision?.sameVehicle;
  out.push({
    id: 'vehicle',
    label: '두 장 같은 차',
    status: same === 'no' ? 'fail' : same === 'yes' ? 'pass' : 'warn',
    detail:
      same === 'no'
        ? `두 장에서 읽은 번호가 다릅니다(${vision!.plate.reads.join(' / ')}).`
        : same === 'yes'
          ? '두 장에서 따로 읽은 번호가 같습니다.'
          : '두 장이 같은 차인지 사진 판독으로 확인하지 못했습니다. 직접 확인해 주세요.',
  });

  // 어린이보호구역 — 주민신고 단속 시간
  if (draft.type === 'schoolzone' && shots[0]) {
    const h = new Date(shots[0].takenAt).getHours();
    const inHours = h >= SCHOOLZONE_HOURS.from && h < SCHOOLZONE_HOURS.to;
    out.push({
      id: 'schoolzone-hours',
      label: '보호구역 단속 시간',
      status: inHours ? 'pass' : 'fail',
      detail: inHours
        ? `${h}시에 찍었습니다(단속 ${SCHOOLZONE_HOURS.from}~${SCHOOLZONE_HOURS.to}시).`
        : `${h}시에 찍었습니다. 주민신고 단속 시간(${SCHOOLZONE_HOURS.from}~${SCHOOLZONE_HOURS.to}시) 밖입니다.`,
    });
  }

  // 앨범 사진 진위 — 장별 항목 중 가장 나쁜 것
  if (album.length) {
    const w = worst(album);
    const bad = album.filter((c) => c.status === w && w !== 'pass');
    out.push({
      id: 'album',
      label: '앨범 사진 진위',
      status: w,
      detail: w === 'pass' ? '촬영시각·편집 흔적·카메라 정보·위치 기록이 모두 정상입니다.' : bad.map((c) => `${c.label}: ${c.detail}`).join(' '),
    });
  }

  // 발생지역·내용
  out.push({
    id: 'address',
    label: '발생지역',
    status: draft.address ? 'pass' : at ? 'warn' : 'fail',
    detail: draft.address ? draft.address : at ? '주소가 아직 없고 좌표만 있습니다.' : '발생지역이 없습니다. 위치찾기로 넣어 주세요.',
  });
  out.push({
    id: 'body',
    label: '내용',
    status: body.trim().length >= BODY_MIN ? 'pass' : 'fail',
    detail: body.trim().length >= BODY_MIN ? `${body.length}자` : `${BODY_MIN}자 이상 적어야 합니다.`,
  });

  return { checks: out, album, blocked: out.some((c) => c.status === 'fail') };
}
