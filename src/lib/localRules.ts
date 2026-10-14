/**
 * 지자체별 주민신고 규정 — **출처를 확인한 것만** 적는다. 전부 규칙이다.
 *
 * 6대 유형(소화전·교차로 모퉁이·버스정류소·횡단보도·어린이보호구역·인도)은 2023년 8월 전국 기준이
 * 통일됐다(1분 간격). 지자체마다 다른 것은 주로 **단속 시간·유예 시간·추가 유형**이다.
 *
 * 촬영 전에 휴대폰 좌표 → 주소 → 관할 지자체를 찾아 이 표를 적용한다.
 * 표에 없는 지자체는 전국 기준을 쓰고, 화면에 '전국 기준'이라고 밝힌다.
 * 규정은 바뀐다 — 지역마다 확인한 날짜와 출처를 함께 둔다.
 *
 * **오래 확인하지 않은 규정으로는 안내하지 않는다(신선도).** 확인한 지 180일이 지나면 경고하고,
 * 365일이 지나면 그 지역 값을 쓰지 않고 전국 기준으로 돌아가며 그 사실을 화면에 적는다.
 * 지자체가 안내를 바꿔도 우리는 알 수 없으므로 코드가 스스로 멈추는 편이 낫다.
 * (팀원 저장소 kjy-arch/parking-report 의 정책 신선도 게이트를 따랐다.)
 */
import { kstParts, kstTime } from './kst';
import { INTERVAL_SEC, MIN_INTERVAL_SEC } from './rules';
import type { BasicViolationType as ViolationType } from '../types/report';

/** 단속 시간대. to 는 그 시각 직전까지(24 = 자정). */
export interface Hours {
  from: number;
  to: number;
}

export interface TypeRule {
  /** 두 장 사이 최소 간격(초) */
  intervalSec: number;
  /** 단속 시간. 없으면 24시간 */
  weekday?: Hours;
  /** 주말 단속 시간. null 이면 주말 단속 안 함. 없으면 weekday 와 같다 */
  weekend?: Hours | null;
}

export interface LocalRule {
  /** 화면에 쓰는 이름 */
  region: string;
  /** 주소에 이 글자가 들어 있으면 이 지자체로 본다 */
  match: RegExp;
  types: Partial<Record<ViolationType, Partial<TypeRule>>>;
  /** 이 시스템이 다루지 않는 그 지역 추가 유형(안내용) */
  extra?: string[];
  /** 단속을 미루는 시간 등 — 유형별 적용 범위가 안내문에 분명하지 않아 안내만 한다 */
  notes?: string[];
  /** 접수 기한 — 촬영일 다음 며칠째 자정까지. 없으면 전국 기준(익일) */
  deadlineDays?: number;
  source: string;
  /** 출처를 마지막으로 확인한 날(한국 날짜 YYYY-MM-DD) */
  checkedAt: string;
}

/** 전국 기준 — 정책브리핑(2023-08-10) 6대 불법주정차 신고 기준 */
export const NATIONAL: Record<ViolationType, TypeRule> = {
  hydrant: { intervalSec: 60 },
  corner: { intervalSec: 60 },
  busstop: { intervalSec: 60 },
  crossing: { intervalSec: 60 },
  // 어린이보호구역: 주말·공휴일 제외, 평일 08~20시
  schoolzone: { intervalSec: 60, weekday: { from: 8, to: 20 }, weekend: null },
  sidewalk: { intervalSec: 60 },
};
export const NATIONAL_SOURCE = 'https://www.korea.kr/multi/visualNewsView.do?newsId=148918697';

/** 승용차 기준 과태료(원) — 유형이 여럿 보일 때 추천 순서에 쓴다. 출처: 정책브리핑(2023-08-10) */
export const FINE_KRW: Record<ViolationType, number> = {
  hydrant: 80_000,
  corner: 40_000,
  busstop: 40_000,
  crossing: 40_000,
  schoolzone: 120_000,
  sidewalk: 40_000,
};

export const LOCAL_RULES: LocalRule[] = [
  {
    region: '경기 광명시',
    match: /광명시/,
    types: { sidewalk: { weekday: { from: 7, to: 21 }, weekend: { from: 9, to: 18 } } },
    extra: ['황색 실선·안전지대·주정차금지구역 10분', '장애인전용구역 1분', '전기차 충전구역 1분~14시간'],
    source: 'https://www.gm.go.kr/gmpm/vinf/rsdnt_rept_info.jsp',
    checkedAt: '2026-10-02',
  },
  {
    region: '경북 안동시',
    match: /안동시/,
    types: { busstop: { weekday: { from: 6, to: 24 }, weekend: { from: 6, to: 24 } } },
    extra: ['유턴지역·이중주차·안전지대·다리 위·주차장 출입구 5분'],
    notes: ['점심시간(11:30~13:30)·주말·공휴일 유예 안내', '일부 어린이보호구역 주출입구 특례 15분'],
    source: 'https://www.andong.go.kr/portal/contents.do?mId=0606040700',
    checkedAt: '2026-10-02',
  },
  {
    region: '충남 아산시',
    match: /아산시/,
    types: {},
    extra: ['안전지대 1분'],
    source: 'https://www.asan.go.kr/main/cms/?no=475',
    checkedAt: '2026-10-02',
  },
  // 아래 서울·대전은 팀원 저장소(kjy-arch/parking-report)의 확인 기록을 옮겼다.
  // 근거: 그 저장소의 docs/evidence/2026-10-02-seoul.md, docs/evidence/2026-09-18-daejeon.md
  {
    region: '서울특별시',
    match: /^서울(특별시)?\s/,
    types: {},
    extra: ['소방활동장애지역 24시간', '안전지대 24시간'],
    notes: [
      '서울시 공통 안내 기준 — 25개 자치구를 하나씩 확인하지는 않아 구에 따라 다를 수 있습니다',
      '서울시 스마트 불편신고 앱으로 내면 기한이 3일로 다릅니다(이 화면은 안전신문고 기준 익일)',
    ],
    deadlineDays: 1,
    source: 'https://smartreport.seoul.go.kr/w100/w142.do',
    checkedAt: '2026-10-02',
  },
  {
    region: '대전 동구',
    match: /^대전(광역시)?\s+동구/,
    // 어린이보호구역은 24시간 접수 — 평일 08~20시는 접수 여부가 아니라 과태료(3배) 구간이다
    types: { schoolzone: { weekday: undefined, weekend: undefined } },
    extra: ['황색복선 24시간(점심 11:30~14:00 유예)', '그 밖의 구역 24시간(점심 유예)'],
    notes: ['어린이보호구역은 평일 08~20시 과태료 3배, 그 밖의 시간 1배', '터널·다리 위는 촬영 간격 5분 초과'],
    deadlineDays: 2,
    source: 'https://www.donggu.go.kr/dg/kor/contents/235',
    checkedAt: '2026-09-18',
  },
  {
    region: '대전 중구',
    match: /^대전(광역시)?\s+중구/,
    types: { schoolzone: { weekday: undefined, weekend: undefined } },
    extra: ['황색복선 07~20시(점심 11:30~14:00 유예)'],
    notes: ['어린이보호구역은 평일 08:00~20:00 과태료 3배, 그 밖의 시간 1배'],
    deadlineDays: 1,
    source: 'https://www.djjunggu.go.kr/kr/sub02_03_13.do',
    checkedAt: '2026-09-18',
  },
  {
    region: '대전 대덕구',
    match: /^대전(광역시)?\s+대덕구/,
    types: { schoolzone: { weekday: undefined, weekend: undefined } },
    extra: ['황색복선·그 밖의 구역 07~20시(점심 11:30~14:00 유예)'],
    notes: [
      '어린이보호구역은 평일 08:00~18:00 과태료 3배, 그 밖의 시간 1배',
      '구청 안내에 신고 기한이 없어 가장 짧은 기준(익일)으로 안내합니다',
    ],
    deadlineDays: 1,
    source: 'https://www.daedeok.go.kr/dpt/goContents.do?link=/dpt/dpt06/DPT06010409&menuId=DPT06010409',
    checkedAt: '2026-09-18',
  },
];

/** 이 날수를 넘기면 경고한다 */
export const RULE_AGING_DAYS = 180;
/** 이 날수를 넘기면 그 지역 값을 쓰지 않는다 */
export const RULE_STALE_DAYS = 365;

export type Freshness = 'fresh' | 'aging' | 'stale';

/** 규정 신선도 — 확인일로부터 지난 날수(한국 날짜 기준). 확인일을 못 읽으면 확인하지 않은 것과 같다. */
export function ruleFreshness(rule: LocalRule, now = Date.now()): { level: Freshness; ageDays: number | null } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(rule.checkedAt);
  if (!m) return { level: 'stale', ageDays: null };
  const checked = kstTime(Number(m[1]), Number(m[2]), Number(m[3]));
  const t = kstParts(now);
  const today = kstTime(t.year, t.month, t.day);
  const ageDays = Math.floor((today - checked) / 86_400_000);
  return { level: ageDays > RULE_STALE_DAYS ? 'stale' : ageDays > RULE_AGING_DAYS ? 'aging' : 'fresh', ageDays };
}

export interface AppliedRules {
  /** 표에 있는 지자체면 그 이름, 아니면 undefined(전국 기준) */
  region?: string;
  local?: LocalRule;
  /** 유형마다 전국 기준에 지역 값을 덮은 결과 */
  types: Record<ViolationType, TypeRule>;
  /** 접수 기한 — 촬영일 다음 며칠째 자정까지 */
  deadlineDays: number;
  /** 표에 있는데 확인한 지 오래돼 쓰지 않은 지역(전국 기준으로 돌아감) */
  staleRegion?: string;
  /** 쓰고 있는 지역 규정이 확인한 지 180일을 넘었다 */
  aging?: boolean;
}

/** 주소 → 적용 규정. 주소를 모르거나 표에 없으면 전국 기준. 오래된 지역 규정은 쓰지 않는다. */
export function rulesFor(address?: string, now = Date.now()): AppliedRules {
  const found = address ? LOCAL_RULES.find((r) => r.match.test(address.trim())) : undefined;
  const fresh = found ? ruleFreshness(found, now) : undefined;
  const local = found && fresh?.level !== 'stale' ? found : undefined;
  const types = Object.fromEntries(
    (Object.keys(NATIONAL) as ViolationType[]).map((t) => [t, { ...NATIONAL[t], ...(local?.types[t] ?? {}) }]),
  ) as Record<ViolationType, TypeRule>;
  return {
    region: local?.region,
    local,
    types,
    deadlineDays: local?.deadlineDays ?? 1,
    staleRegion: found && !local ? found.region : undefined,
    aging: fresh?.level === 'aging' || undefined,
  };
}

/** 유형을 아직 모를 때 쓰는 간격 — 6대 유형 중 가장 긴 값(놓치지 않게) */
export function maxInterval(rules: AppliedRules): number {
  return Math.max(...Object.values(rules.types).map((r) => r.intervalSec));
}

const isWeekend = (weekday: number) => weekday === 0 || weekday === 6;
const hm = (h: Hours) => `${String(h.from).padStart(2, '0')}~${String(h.to).padStart(2, '0')}시`;

/** 그 시각이 단속 시간 안인가(한국 시각). 공휴일은 판단하지 않는다(달력 자료 없음). */
export function inEnforcement(rule: TypeRule, at: number): { ok: boolean; text: string } {
  const t = kstParts(at);
  const weekend = isWeekend(t.weekday);
  const hours = weekend ? (rule.weekend === undefined ? rule.weekday : rule.weekend) : rule.weekday;
  if (hours === null) return { ok: false, text: '주말에는 단속하지 않습니다' };
  if (!hours) return { ok: true, text: '24시간 단속' };
  const h = t.hour;
  const ok = h >= hours.from && h < hours.to;
  return { ok, text: `${weekend ? '주말' : '평일'} ${hm(hours)} 단속` };
}

/** 한 줄 요약 — 촬영 화면 안내용 */
export function describeRules(rules: AppliedRules): string {
  const sec = maxInterval(rules);
  const gap = sec % 60 === 0 ? `${sec / 60}분` : `${sec}초`;
  const stale = rules.staleRegion ? ` (${rules.staleRegion} 규정은 확인한 지 1년이 넘어 쓰지 않음)` : '';
  const aging = rules.aging ? ' (규정 확인한 지 반년 넘음)' : '';
  return `${rules.region ?? '전국'} 기준 · 두 장 ${gap} 간격${stale}${aging}`;
}

/**
 * 실제로 기다릴 간격 — 지금은 현장 테스트용(INTERVAL_SEC)이 규정보다 짧으면 그것을 쓴다.
 * 시연 전 INTERVAL_SEC 를 MIN_INTERVAL_SEC 로 되돌리면 규정 간격이 그대로 적용된다.
 */
export function effectiveInterval(ruleSec: number): number {
  return INTERVAL_SEC < MIN_INTERVAL_SEC ? INTERVAL_SEC : ruleSec;
}
