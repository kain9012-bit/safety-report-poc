/**
 * 앨범 사진 진위 점검 — **전부 규칙이다. AI를 쓰지 않는다.**
 *
 * 지금 앱이 갤러리 사진을 막는 이유는 위·변조와 '지난 사진 재활용'을 걸러낼 수 없어서다.
 * 개선안은 막는 대신 사진 파일에 남은 촬영 정보(EXIF)를 읽어 같은 것을 확인한다.
 *
 *  - 촬영시각이 있는가 / 미래가 아닌가 / 접수 기한(촬영 익일) 안인가
 *  - 편집 앱을 거쳤거나 촬영 뒤 수정된 흔적이 있는가
 *  - 카메라 정보가 있는가(캡처·내려받은 그림은 대개 없다)
 *  - 위치가 남아 있는가(갤러리 사진은 폰이 지우는 경우가 많아 '확인'으로만 본다)
 *  - 두 장이 기준 간격(실제 1분, 지금은 테스트용 INTERVAL_SEC) 이상인가 / 같은 카메라인가 / 같은 파일을 두 번 고르지 않았나 / 같은 자리인가
 *
 * 통과(pass)·확인 필요(warn)·불가(fail). 불가가 하나라도 있으면 제출 점검에서 막힌다.
 */
import { distanceMeters } from './geo';
import { INTERVAL_SEC, intervalNote, submitDeadline } from './rules';
import type { CheckResult, CheckStatus } from './rules';

/** 사진 파일에서 읽은 촬영 정보 */
export interface PhotoMeta {
  /** EXIF 원본 촬영시각(DateTimeOriginal). 없으면 undefined */
  takenAt?: number;
  /** EXIF 수정시각(ModifyDate) */
  modifiedAt?: number;
  software?: string;
  make?: string;
  model?: string;
  lat?: number;
  lng?: number;
  width: number;
  height: number;
  fileName: string;
  fileSize: number;
}

/** 편집 앱 이름 — EXIF Software 칸에 이게 있으면 편집을 거친 것이다. 폰 카메라는 OS 버전 등을 적는다. */
export const EDIT_APPS =
  /photoshop|lightroom|snapseed|picsart|meitu|gimp|canva|vsco|facetune|polarr|pixlr|photo\s*editor|airbrush|b612|snow|foodie|편집/i;

/** 촬영시각보다 이만큼 늦게 수정됐으면 '촬영 뒤 수정'으로 본다(초) */
export const MODIFY_SLACK_SEC = 60;
/** 이보다 작으면 번호판 판독이 어렵다(긴 변, px) */
export const MIN_LONG_EDGE = 1000;
/** 두 장의 사진 속 위치가 이보다 멀면 같은 자리로 보기 어렵다(m) */
export const SAME_SPOT_M = 30;
/** 기기 시계 차이를 봐주는 여유(초) — 이보다 미래면 불가 */
const FUTURE_SLACK_SEC = 300;

const at = (ms: number) => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** 사진 한 장 점검 */
export function checkAlbumPhoto(m: PhotoMeta, now: number = Date.now(), n = 1): CheckResult[] {
  const out: CheckResult[] = [];
  const tag = `${n}장`;

  if (m.takenAt === undefined) {
    out.push({
      id: `a${n}-time`,
      label: `${tag} 촬영시각`,
      status: 'fail',
      detail: '사진 파일에 촬영시각이 없습니다. 캡처·메신저 전송·편집 과정에서 지워진 사진은 받을 수 없습니다.',
    });
  } else if (m.takenAt > now + FUTURE_SLACK_SEC * 1000) {
    out.push({ id: `a${n}-time`, label: `${tag} 촬영시각`, status: 'fail', detail: `촬영시각(${at(m.takenAt)})이 지금보다 늦습니다.` });
  } else if (now > submitDeadline(m.takenAt)) {
    out.push({
      id: `a${n}-time`,
      label: `${tag} 촬영시각`,
      status: 'fail',
      detail: `${at(m.takenAt)}에 찍은 사진입니다. 촬영 익일이 지나 접수 기한을 넘겼습니다.`,
    });
  } else {
    out.push({ id: `a${n}-time`, label: `${tag} 촬영시각`, status: 'pass', detail: `${at(m.takenAt)}에 찍었습니다(사진 파일 기록).` });
  }

  const edited = m.software && EDIT_APPS.test(m.software);
  const modifiedLater =
    m.takenAt !== undefined && m.modifiedAt !== undefined && m.modifiedAt - m.takenAt > MODIFY_SLACK_SEC * 1000;
  out.push({
    id: `a${n}-edit`,
    label: `${tag} 편집 흔적`,
    status: edited || modifiedLater ? 'warn' : 'pass',
    detail: edited
      ? `편집 앱(${m.software}) 기록이 있습니다. 담당자가 원본 여부를 확인할 수 있습니다.`
      : modifiedLater
        ? `촬영(${at(m.takenAt!)}) 뒤 ${at(m.modifiedAt!)}에 수정된 기록이 있습니다.`
        : '편집 앱이나 촬영 뒤 수정 기록이 없습니다.',
  });

  const camera = [m.make, m.model].filter(Boolean).join(' ');
  out.push({
    id: `a${n}-camera`,
    label: `${tag} 카메라 정보`,
    status: camera ? 'pass' : 'warn',
    detail: camera ? `${camera}로 찍었습니다.` : '카메라 정보가 없습니다. 화면 캡처나 내려받은 그림일 수 있습니다.',
  });

  out.push({
    id: `a${n}-gps`,
    label: `${tag} 위치 기록`,
    status: m.lat !== undefined && m.lng !== undefined ? 'pass' : 'warn',
    detail:
      m.lat !== undefined && m.lng !== undefined
        ? `사진 파일에 위치(${m.lat.toFixed(5)}, ${m.lng.toFixed(5)})가 남아 있습니다.`
        : '사진 파일에 위치가 없습니다. 갤러리에서 고르면 폰이 위치를 지우는 경우가 많습니다 — 위치찾기로 확인해 주세요.',
  });

  const edge = Math.max(m.width, m.height);
  out.push({
    id: `a${n}-size`,
    label: `${tag} 화질`,
    status: edge >= MIN_LONG_EDGE ? 'pass' : 'warn',
    detail: edge >= MIN_LONG_EDGE ? `${m.width}×${m.height}` : `${m.width}×${m.height} — 번호판을 읽기 어려울 만큼 작습니다.`,
  });
  return out;
}

/** 두 장 관계 점검 — a가 먼저 찍은 사진이어야 한다 */
export function checkAlbumPair(a: PhotoMeta, b: PhotoMeta, minInterval: number = INTERVAL_SEC): CheckResult[] {
  const out: CheckResult[] = [];

  if (a.fileName === b.fileName && a.fileSize === b.fileSize && a.takenAt === b.takenAt) {
    out.push({ id: 'pair-dup', label: '같은 사진 두 번', status: 'fail', detail: '같은 사진 파일을 두 번 골랐습니다.' });
  }

  if (a.takenAt !== undefined && b.takenAt !== undefined) {
    const gap = Math.abs(b.takenAt - a.takenAt) / 1000;
    out.push({
      id: 'pair-gap',
      label: '두 장 간격',
      status: gap >= minInterval ? 'pass' : 'fail',
      detail:
        (gap >= minInterval
          ? `${Math.floor(gap)}초 간격으로 찍었습니다(사진 파일 기록).`
          : `${Math.floor(gap)}초 간격입니다. ${minInterval}초 이상이어야 합니다.`) + intervalNote(minInterval),
    });
  }

  const camA = [a.make, a.model].filter(Boolean).join(' ');
  const camB = [b.make, b.model].filter(Boolean).join(' ');
  if (camA && camB && camA !== camB) {
    out.push({ id: 'pair-camera', label: '같은 카메라', status: 'warn', detail: `두 장의 카메라가 다릅니다(${camA} / ${camB}).` });
  }

  if (a.lat !== undefined && a.lng !== undefined && b.lat !== undefined && b.lng !== undefined) {
    const d = distanceMeters({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng });
    out.push({
      id: 'pair-spot',
      label: '같은 자리',
      status: d <= SAME_SPOT_M ? 'pass' : 'warn',
      detail: d <= SAME_SPOT_M ? `두 장의 위치 차이 약 ${Math.round(d)}m.` : `두 장의 위치가 약 ${Math.round(d)}m 떨어져 있습니다.`,
    });
  }
  return out;
}

/** 앨범 사진 전체 점검 — 촬영시각 순으로 넣는다 */
export function checkAlbum(metas: PhotoMeta[], now: number = Date.now(), minInterval: number = INTERVAL_SEC): CheckResult[] {
  const one = metas.flatMap((m, i) => checkAlbumPhoto(m, now, i + 1));
  return metas.length >= 2 ? [...one, ...checkAlbumPair(metas[0], metas[1], minInterval)] : one;
}

export function worst(checks: readonly CheckResult[]): CheckStatus {
  return checks.some((c) => c.status === 'fail') ? 'fail' : checks.some((c) => c.status === 'warn') ? 'warn' : 'pass';
}
