/**
 * 담당 공무원에게 함께 가는 '사전 점검 요약' — **전부 규칙이다.**
 *
 * 주민신고는 공무원이 현장에 나가지 않고 사진만으로 과태료를 매긴다. 그래서 담당자는 건마다
 * 두 사진의 시각 차, 같은 자리·같은 차인지, 위반 장소가 사진에 보이는지, 그 지역 기준(간격·단속 시간·기한)에
 * 맞는지를 눈으로 다시 잰다. 앱이 이미 규칙으로 잰 값을 숫자와 근거로 함께 보내면, 담당자는 다시 재는 대신
 * **확인만** 하면 된다. 통과하지 못한 항목은 숨기지 않고 '확인 필요'로 적는다.
 *
 * 이 요약은 판정이 아니다 — 수용 여부는 담당자가 정한다. 문구도 그렇게 쓴다.
 */
import { BODY_MAX } from './compose';
import { OVERLAP_MIN } from './overlap';
import { intervalSeconds } from './rules';
import { primaryShots, knownPhotoTime } from './photoEvidence';
import { VIOLATION_LABEL, isSixType, locatedShot } from '../types/report';
import type { AppliedRules } from './localRules';
import type { Precheck } from './precheck';
import type { DraftReport } from '../types/report';

export const OFFICER_HEADER = '[신고 앱 사전 점검 — 규칙으로 잰 값, 수용 여부는 담당자 판단]';

export interface OfficerInput {
  draft: DraftReport;
  precheck: Precheck;
  rules: AppliedRules;
  /** 두 사진 간격 기준(초) */
  minInterval: number;
}

const st = (pc: Precheck, id: string) => pc.checks.find((c) => c.id === id)?.status;
const mark = (s?: string) => (s === 'pass' ? '충족' : s === 'warn' ? '확인 필요' : '미달');

/** 요약 줄들 — 값이 없는 항목은 지어내지 않고 뺀다 */
export function officerLines({ draft, precheck: pc, rules, minInterval }: OfficerInput): string[] {
  const [a, b] = primaryShots(draft);
  const lines: string[] = [];
  if (a && b && knownPhotoTime(a) && knownPhotoTime(b)) {
    lines.push(`- 간격: ${Math.floor(intervalSeconds(a.takenAt, b.takenAt))}초(기준 ${minInterval}초) ${mark(st(pc, 'interval'))}`);
  }
  if (draft.overlap) {
    lines.push(`- 같은 자리: 두 사진 겹침 ${Math.round(draft.overlap.ratio * 100)}%(기준 ${Math.round(OVERLAP_MIN * 100)}%) ${mark(st(pc, 'overlap'))}`);
  }
  const v = st(pc, 'vehicle');
  if (v) lines.push(`- 같은 차: ${v === 'pass' ? '두 장에서 따로 읽은 번호 일치' : '두 장 번호 대조 안 됨 — 확인 필요'}`);
  if (draft.type) {
    const e = st(pc, 'evidence');
    lines.push(`- 위반 근거: ${e === 'pass' ? `사진에 ${VIOLATION_LABEL[draft.type]} 근거 보임` : `${VIOLATION_LABEL[draft.type]} — 신고인이 직접 고름, 사진 확인 필요`}`);
  }
  const extra = pc.checks.find((c) => ['permit', 'ev'].includes(c.id));
  if (extra) lines.push(`- ${extra.label}: ${extra.status === 'pass' ? extra.detail.replace(/\.$/, '') : mark(extra.status)}`);
  const album = draft.shots.some((s) => s.source === 'album');
  // 점검하지 않은 항목을 '없음·미달'로 적지 않는다
  const stamp = st(pc, 'timestamp');
  if (stamp) lines.push(`- 촬영시각: ${stamp === 'pass' ? '사진에 표시' : '표시 없음'}${album ? '(앨범 사진 — 파일 기록·편집 흔적 점검함)' : '(앱 카메라 촬영)'}`);
  const at = locatedShot(draft.shots);
  if (at) lines.push(`- 위치: ${at.accuracy !== undefined ? `오차 약 ${Math.round(at.accuracy)}m` : '오차 기록 없음'}${draft.address ? '' : ' · 주소 미확인(좌표만)'}`);
  const hours = st(pc, 'hours');
  const base = draft.type && !isSixType(draft.type)
    ? `${VIOLATION_LABEL[draft.type]} 기준(사진 2장·1분 간격)`
    : rules.region ? `${rules.region} 규정(확인 ${rules.local!.checkedAt})` : '전국 기준(6대 유형)';
  const deadline = st(pc, 'deadline');
  lines.push(`- 적용 기준: ${base}${hours ? ` · 단속 시간 ${hours === 'pass' ? '안' : '밖'}` : ''}${deadline ? ` · 접수 기한 ${mark(deadline)}` : ''}`);
  const need = pc.checks.filter((c) => c.status !== 'pass' && !['body'].includes(c.id)).map((c) => c.label);
  lines.push(`- 확인 필요: ${need.length ? need.join(', ') : '없음'}`);
  return lines;
}

/**
 * 신고 내용 + 사전 점검 요약. 내용 칸 글자 수(900자)를 넘지 않게, 넘치면 확인 필요 항목을 남기고 나머지 요약을 뒤에서부터 줄인다.
 * 신고인이 쓴 내용은 줄이지 않는다.
 */
export function withOfficerSummary(body: string, lines: string[], max = BODY_MAX): string {
  const head = body.trimEnd();
  let block = [OFFICER_HEADER, ...lines];
  const join = (bl: string[]) => (head ? `${head}\n\n${bl.join('\n')}` : bl.join('\n'));
  const caution = (line: string) => line.startsWith('- 확인 필요:') && line !== '- 확인 필요: 없음';
  while (block.length > 1 && join(block).length > max) {
    const removable = block.map((line, i) => i > 0 && !caution(line)).lastIndexOf(true);
    // 경고를 담을 공간조차 없으면 통과 항목만 붙여 오해하게 만들지 않는다.
    if (removable < 0) return head;
    block = block.filter((_, i) => i !== removable);
  }
  return block.length > 1 ? join(block) : head;
}
