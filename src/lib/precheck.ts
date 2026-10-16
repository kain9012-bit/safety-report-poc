/**
 * 제출 전 반려 점검 — 담당 공무원이 불수용하는 흔한 사유를 제출 전에 미리 걸러낸다. **전부 규칙이다.**
 *
 * 빨간불(fail)이 하나라도 있으면 제출할 수 없다. 노란불(warn)은 알리되 막지 않는다.
 * 기본 다섯 가지(간격·접수 기한·촬영시각 표시·차량번호·위치)는 rules.ts 의 runChecks 를 그대로 쓰고,
 * 여기서 사진 증거·같은 차(두 장 번호판)·같은 자리(겹침)·지자체 단속 시간·앨범 진위·주소·내용을 더한다.
 * 간격과 단속 시간은 발생지역 주소로 찾은 지자체 규정(localRules.ts)을 따른다.
 */
import { kstShort } from './kst';
import { checkAlbum, worst } from './authenticity';
import { BODY_MIN } from './compose';
import { isValidPlate, runChecks } from './rules';
import { plateStatus } from './plateCheck';
import { effectiveInterval, inEnforcement, maxInterval, rulesFor } from './localRules';
import { OVERLAP_MIN } from './overlap';
import { extraTypeCheck } from './extraTypes';
import type { CheckResult } from './rules';
import type { Verdict } from './crosscheck';
import { primaryShots, reviewedReads, sameImportedPhoto } from './photoEvidence';
import { summarizeEvidence } from './evidence';
import { busStopNumbers, sharedParkingQuestion } from './followUps';
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
  const shots = primaryShots(draft);
  const rules = rulesFor(draft.address, now);
  minInterval ??= effectiveInterval(draft.type ? rules.types[draft.type].intervalSec : maxInterval(rules));
  const at = locatedShot(shots);
  const albumShots = shots.filter((s) => s.source === 'album' && s.meta);
  const album = albumShots.length ? checkAlbum(albumShots.map((s) => s.meta!), now, minInterval, rules.deadlineDays) : [];

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
    deadlineDays: rules.deadlineDays,
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
  if (shots.length === 2 && sameImportedPhoto(shots[0], shots[1])) out.push({ id: 'duplicate_photo', label: '서로 다른 촬영본', status: 'fail', detail: '같은 사진을 두 장으로 지정했습니다. 서로 다른 촬영본을 기본 사진으로 골라 주세요.' });

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

  // 6대 밖 유형 — 표지 붙은 차·친환경차는 위반이 아닐 수 있고, 소방차전용구역은 대상 건물이 정해져 있다
  const extra = extraTypeCheck(draft.type, vision?.scene);
  if (extra) out.push(extra);

  // 같은 차 — 두 장에서 따로 읽은 번호와 입력한 번호가 같으면 통과(회의 결정).
  // AI 가 확실히 읽지 못하면 신고인이 사진을 보고 입력한 번호로 내고 담당자가 다시 본다(주황).
  // AI 가 확실히 읽은 번호와 어긋나면 신고인이 사진을 보고 확인해야 낼 수 있고, 확인해도 주황으로 남긴다.
  const ps = plateStatus(draft, vision);
  const confirmedNote = '신고인이 사진을 보고 확인했습니다. 담당자가 사진으로 번호를 한 번 더 확인합니다.';
  out.push({
    id: 'vehicle',
    label: '두 장 번호판 일치',
    status: ps.kind === 'match' ? 'pass' : ps.kind === 'conflict' && !ps.confirmed ? 'fail' : 'warn',
    detail: ps.kind === 'match'
      ? '두 장에서 따로 읽은 번호와 입력한 차량번호가 같습니다.'
      : ps.kind === 'empty'
        ? `차량번호가 비어 있습니다. 두 장에서 읽은 번호는 ${ps.reads[0]}입니다. 사진을 보고 입력해 주세요.`
        : ps.kind === 'conflict'
          ? `${ps.conflict === 'reads'
            ? `두 장에서 읽은 번호가 다릅니다(${ps.reads.join(' / ')}).`
            : `입력한 차량번호(${ps.entered})가 두 장에서 읽은 번호(${ps.reads[0]})와 다릅니다.`} ${ps.confirmed ? confirmedNote : '차량번호 단계에서 사진을 보고 확인해 주세요.'}`
          : !isValidPlate(ps.entered)
            ? `사진에서 번호판을 확실히 읽지 못했습니다(${ps.reason}). 사진을 보고 차량번호를 바르게 입력해 주세요.`
            : `사진에서 번호판을 확실히 읽지 못했습니다(${ps.reason}). 신고인이 입력한 번호로 내고, 담당자가 사진으로 번호를 한 번 더 확인합니다.`,
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
            ? `두 사진이 ${pct}%만 겹칩니다(기준 ${Math.round(OVERLAP_MIN * 100)}%). 첫 번째 사진과 같은 자리·방향에서 다시 찍어 주세요.`
            : '두 사진이 같은 장면으로 보이지 않습니다. 첫 번째 사진과 같은 자리·방향에서 다시 찍어 주세요.',
    });
  }

  // 단속 시간 — 두 촬영 시각을 각각 검사한다(마감 시각·주말 경계를 넘은 두 번째 사진 포함).
  if (draft.type && shots.length) {
    const rule = rules.types[draft.type];
    const times = shots.map((shot, i) => ({
      ...inEnforcement(rule, shot.takenAt),
      label: `${i + 1}장 ${kstShort(shot.takenAt)}`,
    }));
    if (times.some((e) => e.text !== '24시간 단속')) {
      const ok = times.every((e) => e.ok);
      const where = rules.region ?? '전국';
      out.push({
        id: 'hours',
        label: '단속 시간',
        status: ok ? 'pass' : 'fail',
        detail: `${where} 기준 ${ok ? '두 사진 모두 단속 시간 안입니다' : '단속 시간 밖에 찍은 사진이 있습니다'}. `
          + times.map((e) => `${e.label}: ${e.ok ? '시간 안' : '시간 밖'}(${e.text})`).join(' / '),
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

  // 새 판독(사진별 관찰) — 결과를 바꿀 만큼 중요한 미확인만 노란불로 꺼낸다. 나머지 근거는 기록에만 남는다.
  if (draft.schemaVersion === 2) {
    const evidence = summarizeEvidence(reviewedReads(draft)).find((s) => s.type === draft.type);
    const check = out.find((c) => c.id === 'evidence');
    if (check && draft.type && draft.type !== 'other') {
      check.status = evidence?.status === 'observed' ? 'pass' : 'warn';
      check.detail = evidence?.status === 'observed'
        ? '사진에서 위반 장소의 근거를 찾았습니다.'
        : '사진에서 이 유형의 근거를 확인하지 못했습니다. 그 근거(표지판·노면 표시 등)가 사진에 보이는지 확인해 주세요.';
    }
    const shared = sharedParkingQuestion(draft);
    if (shared && shared.answer !== 'different_bay') {
      out.push({
        id: 'shared_parking',
        label: '일반 자동차 주차 안내',
        status: 'warn',
        detail: shared.answer === 'same_bay'
          ? '이 칸에 일반 자동차도 주차할 수 있다는 안내가 있다고 답했습니다. 안내의 시간·조건에 해당하면 신고 대상이 아닐 수 있습니다.'
          : shared.answer === 'unknown'
            ? '일반 자동차 주차 안내가 이 칸에 적용되는지 확인하지 못했습니다. 안내의 시간·조건에 해당하면 신고 대상이 아닐 수 있습니다.'
            : '사진에 일반 자동차 주차 안내가 보입니다. 위반 유형 확인 단계에서 이 칸에 적용되는지 답해 주세요.',
      });
    }
    const stops = draft.type === 'busstop' ? busStopNumbers(draft) : [];
    if (stops.length > 1) {
      out.push({ id: 'busstop_number', label: '정류소 표지', status: 'warn', detail: `사진에서 서로 다른 정류소 번호가 읽혔습니다(${stops.join(' / ')}). 차 옆 정류소 표지가 사진에 보이는지 확인해 주세요.` });
    }
  }
  return { checks: out, album, blocked: out.some((c) => c.status === 'fail') };
}
