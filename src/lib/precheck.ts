/**
 * 제출 전 반려 점검 — 담당 공무원이 불수용하는 흔한 사유를 제출 전에 미리 걸러낸다. **전부 규칙이다.**
 *
 * 빨간불(fail)이 하나라도 있으면 제출할 수 없다. 노란불(warn)은 알리되 막지 않는다.
 * 기본 다섯 가지(간격·접수 기한·촬영시각 표시·차량번호·위치)는 rules.ts 의 runChecks 를 그대로 쓰고,
 * 여기서 사진 증거·같은 차(두 장 번호판)·같은 자리(겹침)·지자체 단속 시간·앨범 진위·주소·내용을 더한다.
 * 간격과 단속 시간은 발생지역 주소로 찾은 지자체 규정(localRules.ts)을 따른다.
 */
import { checkAlbum, worst } from './authenticity';
import { BODY_MIN } from './compose';
import { runChecks } from './rules';
import { effectiveInterval, inEnforcement, maxInterval, rulesFor } from './localRules';
import { OVERLAP_MIN } from './overlap';
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
  /** 두 장 간격 기준(초). 기본은 지자체·유형 규정(지금은 테스트용 간격이 더 짧으면 그것) */
  minInterval?: number;
}

export interface Precheck {
  checks: CheckResult[];
  /** 앨범 사진이 있으면 그 진위 점검 항목(장별·두 장 관계) */
  album: CheckResult[];
  blocked: boolean;
}

export function precheck({ draft, body, verdict, vision, now = Date.now(), minInterval }: PrecheckInput): Precheck {
  const shots = draft.shots;
  const rules = rulesFor(draft.address);
  minInterval ??= effectiveInterval(draft.type ? rules.types[draft.type].intervalSec : maxInterval(rules));
  const at = locatedShot(shots);
  const albumShots = shots.filter((s) => s.source === 'album' && s.meta);
  const album = albumShots.length ? checkAlbum(albumShots.map((s) => s.meta!), now, minInterval) : [];

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
  }, minInterval).map((c) => {
    if (noTime && (c.id === 'interval' || c.id === 'timestamp')) {
      return { ...c, status: 'fail' as const, detail: '촬영시각 기록이 없는 앨범 사진이 있어 확인할 수 없습니다.' };
    }
    if (c.id === 'location' && albumShots.length > 0 && at && at.accuracy === undefined) {
      return { ...c, detail: '앨범 사진 파일에 남은 위치입니다(정확도 기록 없음).' };
    }
    return c;
  });

  const out: CheckResult[] = [...base];

  // 위반유형 — 사진 증거가 있어야 한다
  // 사람이 고른 유형이라도 사진 판독에서 보인 유형 중 하나면 사진 증거가 있다
  const seen = (vision?.ruleTypes ?? []) as string[];
  const manualType = Boolean(draft.manual?.type) && !(draft.type && seen.includes(draft.type));
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

  // 같은 차 — 두 장 모두에서 번호판이 읽히고, 따로 읽은 번호가 같아야 한다(회의 결정)
  const same = vision?.sameVehicle;
  const reads = vision?.plate.reads ?? [];
  out.push({
    id: 'vehicle',
    label: '두 장 번호판 일치',
    status: same === 'yes' ? 'pass' : 'fail',
    detail:
      same === 'yes'
        ? '두 장에서 따로 읽은 번호가 같습니다.'
        : same === 'no'
          ? `두 장에서 읽은 번호가 다릅니다(${reads.join(' / ')}).`
          : !vision
            ? '사진 판독 결과가 없습니다. 다시 판독해 주세요.'
            : reads.length === 1
              ? `한 장에서만 번호판이 읽혔습니다(${reads[0]}). 두 장 모두 번호판이 보이게 찍어야 합니다.`
              : '번호판이 읽히지 않았습니다. 두 장 모두 번호판이 보이게 찍어야 합니다.',
  });

  // 같은 자리 — 두 사진 겹침(규칙 기반 영상 대조)
  if (shots.length >= 2) {
    const ov = draft.overlap;
    const pct = ov ? Math.round(ov.ratio * 100) : 0;
    out.push({
      id: 'overlap',
      label: '같은 자리 두 장',
      status: !ov ? 'warn' : ov.same ? 'pass' : 'fail',
      detail: !ov
        ? '두 사진의 겹침을 재지 못했습니다. 같은 자리·같은 방향인지 직접 확인해 주세요.'
        : ov.same
          ? `두 사진이 ${pct}% 겹칩니다(기준 ${Math.round(OVERLAP_MIN * 100)}%).`
          : ov.ratio < OVERLAP_MIN
            ? `두 사진이 ${pct}%만 겹칩니다(기준 ${Math.round(OVERLAP_MIN * 100)}%). 첫 사진과 같은 자리·방향에서 다시 찍어 주세요.`
            : '두 사진이 같은 장면으로 보이지 않습니다. 첫 사진과 같은 자리·방향에서 다시 찍어 주세요.',
    });
  }

  // 단속 시간 — 지자체·유형 규정(어린이보호구역 평일 08~20시 등)
  if (draft.type && shots[0]) {
    const e = inEnforcement(rules.types[draft.type], shots[0].takenAt);
    if (e.text !== '24시간 단속') {
      const h = new Date(shots[0].takenAt).getHours();
      const where = rules.region ?? '전국';
      out.push({
        id: 'hours',
        label: '단속 시간',
        status: e.ok ? 'pass' : 'fail',
        detail: e.ok
          ? `${h}시에 찍었습니다(${where} 기준 ${e.text}).`
          : `${h}시에 찍었습니다. ${where} 기준 단속 시간 밖입니다(${e.text}).`,
      });
    }
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
