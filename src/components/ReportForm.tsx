import {
  Camera,
  Check,
  CopyPlus,
  FileCheck2,
  Image as ImageIcon,
  MapPin,
  Menu,
  Pointer,
  RotateCcw,
  X,
  ZoomIn,
} from 'lucide-react';
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { formatStamp } from '../lib/camera';
import { BODY_MAX, composeBody } from '../lib/compose';
import { reverseGeocode } from '../lib/reverseGeocode';
import type { NearbyState } from '../lib/facilities';
import type { Candidate } from '../lib/recommend';
import { SHOW_IN_PHOTO } from '../lib/crosscheck';
import { precheck } from '../lib/precheck';
import type { Precheck } from '../lib/precheck';
import { worst } from '../lib/authenticity';
import type { CheckResult, CheckStatus } from '../lib/rules';
import type { Coverage, Verdict } from '../lib/crosscheck';
import type { VisionState } from '../lib/vision';
import type { BoxLabel, Scene, VisionResult } from '../../api/vision';
import { PLATE_CONFIDENCE_FLOOR } from '../lib/rules';
import type { AddressState } from '../lib/reverseGeocode';
import type { LatLng } from './PickMap';
import { intervalSeconds, isValidPlate } from '../lib/rules';
import { VIOLATION_LABEL, locatedShot } from '../types/report';
import type { DraftReport, EditableField, Shot, ViolationType } from '../types/report';

interface Props {
  draft: DraftReport;
  addressState: AddressState;
  typeInfo: TypeInfo;
  vision: { state: VisionState; result?: VisionResult };
  verdict: Verdict;
  onRetryVision: () => void;
  onCapture: () => void;
  /** 사람이 칸을 고쳤다. value가 undefined면 자동 값으로 되돌린다. */
  onEdit: (field: EditableField, value: string | undefined) => void;
  /** 위치찾기에서 고른 주소 */
  onPickAddress: (a: PickedAddress) => void;
  onReset: () => void;
  /** 앨범에서 고른 사진 파일 */
  onPickAlbum: (files: File[]) => void;
  albumState: 'idle' | 'busy' | 'error';
}

export interface TypeInfo {
  state: 'idle' | 'loading' | NearbyState;
  candidates: Candidate[];
  missing: string[];
  coverage: Coverage;
}

export interface PickedAddress {
  address: string;
  parcel?: string;
  from: 'map' | 'typed';
}

/** 지도 라이브러리는 위치찾기를 열 때만 받는다 — 현장에서 첫 화면이 빨리 떠야 한다 */
const PickMap = lazy(() => import('./PickMap'));

/** 사진에 좌표가 없을 때 지도를 펼칠 자리 — 전주시청 */
const DEFAULT_ORIGIN: LatLng = { lat: 35.8242, lng: 127.148 };

type Source = 'gps' | 'photo' | 'auto' | 'manual' | 'map' | 'photo_confirmed' | 'photo_only';

const SOURCE: Record<Source, { cls: string; text: string }> = {
  gps: { cls: 'bg-blue-50 text-blue-700 border-blue-200', text: '사진 좌표에서 자동' },
  photo: { cls: 'bg-amber-50 text-amber-800 border-amber-200', text: '사진 판독 · 확인 필요' },
  auto: { cls: 'bg-green-50 text-green-700 border-green-200', text: '자동 작성' },
  manual: { cls: 'bg-slate-50 text-slate-600 border-slate-300', text: '직접 입력' },
  map: { cls: 'bg-slate-50 text-slate-600 border-slate-300', text: '지도에서 선택' },
  photo_confirmed: { cls: 'bg-green-50 text-green-700 border-green-200', text: '사진 증거 · 위치자료 일치' },
  photo_only: { cls: 'bg-amber-50 text-amber-800 border-amber-200', text: '사진 증거 · 확인 필요' },
};

/**
 * 신고서 화면 — 지금 앱의 불법주정차 신고서를 **모양 그대로** 옮겼다.
 * (상단 파란 띠 · 5칸 탭 · 주황 별표와 파란 물음표 · 오른쪽 테두리 단추 · 사진 4칸(필수 2) ·
 *  파란 글씨 주소 · 회색 내용칸 · 공유 동의 · 제출/닫기)
 *
 * 추천 단어 · 주민점검신청제 · 음성 · 휴대전화 인증은 이번 개선과 관계없어 뺐다.
 *
 * 바꾼 것은 둘뿐이다.
 *  1. 사진 칸이 '불법 주정차 신고(유형선택)'보다 위로 온다.
 *  2. 사진을 찍으면 유형·발생지역·내용이 채워진 채로 돌아온다. 채운 칸에는 출처 배지를 단다.
 *
 * 기관 로고·명칭, 범죄예방·로그인 메뉴, 행사 배너는 옮기지 않는다 — 실제 기관 화면으로 오인되면 안 된다.
 */
export default function ReportForm({ draft, addressState, typeInfo, vision, verdict, onRetryVision, onCapture, onEdit, onPickAddress, onReset, onPickAlbum, albumState }: Props) {
  const [sheet, setSheet] = useState<'why' | 'type' | 'place' | 'evidence' | 'source' | 'checks' | null>(null);
  const albumInput = useRef<HTMLInputElement>(null);
  const [agree, setAgree] = useState(true);
  const [copied, setCopied] = useState(false);
  const [toast, setToast] = useState(false);

  const shots = draft.shots;
  const first = shots[0];
  const second = shots[1];
  const hasShots = shots.length >= 2;
  const manual = draft.manual ?? {};

  const body = manual.body ? (draft.body ?? '') : composeBody(draft);
  const plateOk = draft.plate ? isValidPlate(draft.plate) : false;

  // 제출 전 반려 점검 — 전부 규칙(precheck.ts)
  const pc = useMemo(() => precheck({ draft, body, verdict, vision: vision.result }), [draft, body, verdict, vision.result]);
  const count = (st: CheckStatus) => pc.checks.filter((c) => c.status === st).length;
  const isAlbum = shots.some((s) => s.source === 'album');

  const copyBody = async () => {
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* 복사가 막힌 브라우저 — 조용히 넘어간다 */
    }
  };

  return (
    <div className="relative flex-1 min-h-0 flex flex-col bg-white text-slate-900">
      {/* --- 상단 파란 띠 --- 기관 메뉴(범죄예방·로그인)는 옮기지 않고, 시제품임을 밝힌다 */}
      <div className="shrink-0 h-12 bg-[#3a8fdb] flex items-stretch justify-between pl-3">
        <p className="self-center text-[13px] font-bold text-white/90">개선안 시제품</p>
        <div className="flex items-stretch">
          <TopIcon icon={<Camera className="w-6 h-6" />} label="사진촬영" onClick={onCapture} />
          <TopIcon icon={<ZoomIn className="w-6 h-6" />} label="돋보기" />
          <span className="w-14 bg-[#2f7cc4] flex items-center justify-center" aria-hidden="true">
            <Menu className="w-8 h-8 text-white" />
          </span>
        </div>
      </div>

      {/* --- 탭 --- */}
      <div className="shrink-0 bg-slate-100 grid grid-cols-5 text-center text-[16px] leading-[1.15]">
        {['안전', '불법\n주정차', '자동차·\n교통위반', '생활\n불편'].map((t) => {
          const on = t.startsWith('불법');
          return (
            <span
              key={t}
              className={`h-[52px] flex items-center justify-center whitespace-pre-line border-b-[3px] ${
                on ? 'text-[#2f7cc4] font-bold border-[#3a8fdb]' : 'text-slate-800 border-transparent'
              }`}
            >
              {t}
            </span>
          );
        })}
        <span className="h-[52px] flex flex-col items-center justify-center text-[13px] text-slate-800 border-b-[3px] border-transparent">
          <span className="tracking-[0.2em] font-bold leading-none">•••</span>
          퀵메뉴
        </span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="px-4 pt-5 pb-6 space-y-7">
          {/* ===== 사진 — 맨 위로 올렸다 (지금은 유형선택 다음) ===== */}
          <section>
            <Row
              label="사진"
              help={() => setSheet('why')}
              button={
                <OutlineButton onClick={() => setSheet('source')} icon={<ImageIcon className="w-5 h-5" />}>
                  촬영/앨범
                </OutlineButton>
              }
            />
            <div className="mt-4 grid grid-cols-4 gap-2.5">
              {[0, 1, 2, 3].map((i) => {
                const s = shots[i];
                return (
                  <button
                    key={i}
                    onClick={i < 2 ? () => setSheet('source') : undefined}
                    className="relative aspect-square rounded-xl bg-slate-100 overflow-visible flex items-center justify-center"
                    aria-label={s ? `${i + 1}번째 사진` : `${i + 1}번째 사진 칸`}
                  >
                    {s ? (
                      <img src={s.dataUrl} alt="" className="absolute inset-0 w-full h-full object-cover rounded-xl" />
                    ) : (
                      <Camera className="w-9 h-9 text-slate-400" strokeWidth={1.5} aria-hidden="true" />
                    )}
                    {i < 2 && (
                      <span className="absolute -top-2 -left-1 px-2 py-0.5 rounded-full bg-red-500 text-white text-[12px] font-bold">
                        필수
                      </span>
                    )}
                    {s?.source === 'album' && (
                      <span className="absolute -top-2 -right-1 px-1.5 py-0.5 rounded-full bg-slate-700 text-white text-[11px] font-bold">
                        앨범
                      </span>
                    )}
                    {s && (
                      <span className="absolute bottom-0 inset-x-0 rounded-b-xl bg-slate-900/60 text-white text-[10px] tabular-nums py-0.5">
                        {s.source === 'album' && s.meta?.takenAt === undefined ? '시각 없음' : formatStamp(s.takenAt).slice(11)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <Changed>
              {albumState === 'busy'
                ? '앨범 사진의 촬영 정보를 읽는 중…'
                : albumState === 'error'
                  ? '앨범 사진을 읽지 못했습니다. 다른 사진을 골라 주세요.'
                  : hasShots
                  ? isAlbum
                    ? shots.some((x) => x.source === 'album' && x.meta?.takenAt === undefined)
                      ? '촬영시각 기록이 없는 사진이 있습니다 — 캡처·메신저로 받은 사진은 받을 수 없습니다'
                      : `${Math.floor(intervalSeconds(first.takenAt, second.takenAt))}초 간격 · 앨범 사진의 파일 기록을 사진에 박았습니다`
                    : `${Math.floor(intervalSeconds(first.takenAt, second.takenAt))}초 간격 · 촬영시각과 좌표가 사진에 찍혔습니다`
                  : '사진부터 찍으면 아래 칸이 자동으로 채워집니다'}
            </Changed>
            {isAlbum && pc.album.length > 0 && (
              <button onClick={() => setSheet('checks')} className="mt-1.5 flex items-center gap-2 text-[13px]">
                <Light status={worst(pc.album)} />
                <span className="text-slate-700">
                  앨범 사진 진위 점검 —{' '}
                  {worst(pc.album) === 'pass' ? '통과' : worst(pc.album) === 'warn' ? '확인 필요' : '받을 수 없음'}
                </span>
                <span className="font-bold text-blue-700 underline underline-offset-2">자세히</span>
              </button>
            )}
            {hasShots && <VisionLine vision={vision} onRetry={onRetryVision} onEvidence={() => setSheet('evidence')} />}
          </section>

          {/* ===== 불법 주정차 신고 (유형선택) ===== */}
          <section>
            <Row
              label="불법 주정차 신고"
              button={
                <OutlineButton onClick={() => setSheet('type')} icon={<Pointer className="w-5 h-5" />}>
                  유형선택
                </OutlineButton>
              }
            />
            <TypeValue
              draft={draft}
              info={typeInfo}
              verdict={verdict}
              photoLoading={vision.state === 'loading'}
              hasShots={hasShots}
              onPick={(t) => onEdit('type', t)}
            />
          </section>

          {/* ===== 발생지역 ===== */}
          <section>
            <Row
              label="발생지역"
              help={() => setSheet('why')}
              button={
                <OutlineButton onClick={() => setSheet('place')} icon={<MapPin className="w-5 h-5" />}>
                  위치찾기
                </OutlineButton>
              }
            />
            <PlaceValue draft={draft} state={addressState} onRevert={() => onEdit('address', undefined)} />
          </section>

          {/* ===== 차량번호 — 지금 불법주정차 신고서에는 없는 칸(교통위반 탭에는 있음) ===== */}
          <section>
            <Row label="차량번호" />
            <input
              value={draft.plate ?? ''}
              onChange={(e) => onEdit('plate', e.target.value || undefined)}
              placeholder={
                vision.state === 'loading'
                  ? '사진에서 번호판을 읽는 중…'
                  : first
                    ? '직접 입력 (예: 12가3456)'
                    : '사진에서 번호판을 읽어 채웁니다'
              }
              className="mt-3 w-full h-12 px-4 rounded border border-slate-300 bg-slate-100 text-[18px] tabular-nums placeholder:text-[15px] placeholder:text-slate-400"
            />
            <PlateNote draft={draft} vision={vision} plateOk={plateOk} onUse={(t) => onEdit('plate', t)} />
          </section>

          {/* ===== 내용 ===== */}
          <section>
            <Row
              label="내용"
              sub="(추가·수정가능, 5~900자)"
              button={
                manual.body ? (
                  <OutlineButton onClick={() => onEdit('body', undefined)} icon={<RotateCcw className="w-5 h-5" />}>
                    자동문장
                  </OutlineButton>
                ) : undefined
              }
            />
            <textarea
              value={body}
              onChange={(e) => onEdit('body', e.target.value.slice(0, BODY_MAX))}
              rows={5}
              placeholder="사진을 찍으면 촬영시각·위치·유형·차량번호로 문장을 만들어 채웁니다."
              className="mt-3 w-full px-4 py-3 rounded border border-slate-300 bg-slate-100 text-[17px] leading-relaxed placeholder:text-slate-400"
            />
            <div className="flex items-center justify-between">
              {body ? (
                <span className={`px-2 py-0.5 rounded border text-xs font-bold ${SOURCE[manual.body ? 'manual' : 'auto'].cls}`}>
                  {SOURCE[manual.body ? 'manual' : 'auto'].text}
                </span>
              ) : (
                <span />
              )}
              <span className="flex items-center gap-3">
                <button onClick={copyBody} className="flex items-center gap-1 text-[15px] text-slate-700">
                  <CopyPlus className="w-5 h-5 text-slate-500" strokeWidth={1.5} aria-hidden="true" />
                  {copied ? '복사됨' : '내용복사'}
                </button>
                <span className="text-[15px] text-slate-500 tabular-nums">
                  {body.length} / {BODY_MAX}
                </span>
              </span>
            </div>
          </section>

          <section className="flex items-center justify-between">
            <CheckLine checked={agree} onChange={setAgree} label="신고 내용 공유 동의" />
            <OutlineButton>내용보기</OutlineButton>
          </section>
        </div>
      </div>

      {/* ===== 아래 고정: 제출 / 닫기 ===== */}
      <div className="shrink-0 bg-white px-1.5 pb-1.5">
        <button onClick={() => setSheet('checks')} className="w-full text-[12px] py-1 flex items-center justify-center gap-3 text-slate-600">
          제출 전 점검
          <span className="flex items-center gap-1"><Light status="pass" />{count('pass')}</span>
          <span className="flex items-center gap-1"><Light status="warn" />{count('warn')}</span>
          <span className="flex items-center gap-1"><Light status="fail" />{count('fail')}</span>
          <span className="font-bold text-blue-700 underline underline-offset-2">보기</span>
        </button>
        <div className="grid grid-cols-2 gap-1.5">
          <button
            onClick={() => setSheet('checks')}
            className="h-14 rounded bg-[#3a8fdb] text-white text-[22px] font-bold flex items-center justify-center gap-2"
          >
            <FileCheck2 className="w-7 h-7" aria-hidden="true" />
            제출
          </button>
          <button onClick={onReset} className="h-14 rounded bg-slate-400 text-white text-[22px] font-bold">
            닫기
          </button>
        </div>
      </div>

      {toast && (
        <div role="status" className="absolute bottom-24 inset-x-6 z-40 rounded-lg bg-slate-900/90 text-white text-center text-[15px] font-bold py-3">
          시제품이라 접수되지 않습니다
        </div>
      )}

      <input
        ref={albumInput}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length) onPickAlbum(files);
        }}
      />
      {sheet === 'source' && (
        <SourceSheet
          onCamera={() => {
            setSheet(null);
            onCapture();
          }}
          onAlbum={() => {
            setSheet(null);
            albumInput.current?.click();
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'checks' && (
        <CheckSheet
          pc={pc}
          onSubmit={() => {
            setSheet(null);
            setToast(true);
            setTimeout(() => setToast(false), 2000);
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'why' && <WhyPanel onClose={() => setSheet(null)} />}
      {sheet === 'evidence' && vision.result && (
        <EvidenceSheet shots={draft.shots} result={vision.result} onClose={() => setSheet(null)} />
      )}
      {sheet === 'type' && (
        <TypeDialog
          current={draft.type}
          onPick={(t) => {
            onEdit('type', t);
            setSheet(null);
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'place' && (
        <PlaceSheet
          draft={draft}
          onPick={(a) => {
            onPickAddress(a);
            setSheet(null);
          }}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  );
}

/* ================================================================== */

function TopIcon({ icon, label, onClick }: { icon: ReactNode; label: string; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className="w-[58px] flex flex-col items-center justify-center text-white gap-0.5"
    >
      {icon}
      <span className="text-[11px] leading-none">{label}</span>
    </button>
  );
}

/** 칸 제목 줄 — 주황 별표 · 이름 · 파란 물음표 · 오른쪽 테두리 단추 */
function Row({
  label,
  sub,
  help,
  button,
}: {
  label: string;
  sub?: string;
  help?: () => void;
  button?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2 min-h-11">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span
            aria-label="필수"
            className="w-7 h-7 rounded-full bg-[#f5a35b] text-white text-[20px] font-bold flex items-center justify-center shrink-0 leading-none pt-1"
          >
            *
          </span>
          <span className="text-[22px] text-slate-900 whitespace-nowrap">{label}</span>
          {help && (
            <button
              onClick={help}
              aria-label={`${label} 도움말`}
              className="w-7 h-7 rounded-full bg-[#3a8fdb] text-white text-[17px] font-bold flex items-center justify-center shrink-0"
            >
              ?
            </button>
          )}
        </div>
        {sub && <p className="text-[15px] text-slate-800 mt-0.5">{sub}</p>}
      </div>
      {button}
    </div>
  );
}

function OutlineButton({
  onClick,
  icon,
  children,
}: {
  onClick?: () => void;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="shrink-0 h-11 px-3 rounded-sm border-2 border-slate-300 bg-white text-[16px] font-bold text-slate-800 flex items-center gap-1.5 active:bg-slate-50"
    >
      {icon && <span className="text-slate-500">{icon}</span>}
      {children}
    </button>
  );
}

function CheckLine({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange?: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-center gap-2.5 text-[17px] text-slate-800">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange?.(e.target.checked)}
        readOnly={!onChange}
        className="sr-only peer"
      />
      <span
        className={`w-7 h-7 rounded flex items-center justify-center border-2 ${
          checked ? 'bg-blue-600 border-blue-600' : 'bg-white border-slate-400'
        }`}
        aria-hidden="true"
      >
        {checked && <Check className="w-5 h-5 text-white" strokeWidth={3} />}
      </span>
      {label}
    </label>
  );
}

/** 자동으로 채운 값 — 지금 앱처럼 파란 글씨로, 아래에 출처 배지 */
function Value({ source, children, extra }: { source: Source; children: ReactNode; extra?: ReactNode }) {
  return (
    <div className="mt-2 pl-9">
      <p className="text-[22px] text-[#3a8fdb] leading-snug">{children}</p>
      <div className="mt-1 flex items-center gap-2 flex-wrap">
        <span className={`px-2 py-0.5 rounded border text-xs font-bold ${SOURCE[source].cls}`}>
          {SOURCE[source].text}
        </span>
        {extra}
      </div>
    </div>
  );
}

/** 바뀐 동작을 알리는 한 줄 — 지금 앱에는 없는, 개선안이 덧붙인 설명 */
function Changed({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return (
    <p className={`mt-2 text-[14px] ${muted ? 'text-slate-500 pl-9' : 'text-blue-700 font-bold'}`}>{children}</p>
  );
}

/**
 * 위반유형 값 — 판정 근거는 사진뿐이다(crosscheck).
 * 위치자료(좌표×공공데이터)는 '의심'으로만 보여주고, 사진에 증거가 없으면 유형을 채우지 않는다.
 */
function TypeValue({
  draft,
  info,
  verdict,
  photoLoading,
  hasShots,
  onPick,
}: {
  draft: DraftReport;
  info: TypeInfo;
  verdict: Verdict;
  photoLoading: boolean;
  hasShots: boolean;
  onPick: (t: ViolationType) => void;
}) {
  const manual = Boolean(draft.manual?.type);
  const others = (manual && verdict.type ? [verdict.type, ...verdict.alternatives] : verdict.alternatives).filter(
    (t) => t !== draft.type,
  );
  const missingLine = info.missing.length > 0 && (
    <p className="mt-1 text-[13px] text-slate-500">아직 못 본 위치자료: {info.missing.join(', ')}</p>
  );
  const suspicions = verdict.suspicions.length > 0 && (
    <div className="mt-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900 space-y-1">
      <p className="font-bold">위치자료로는 의심되지만 사진에 증거가 없습니다</p>
      {verdict.suspicions.map((c) => (
        <p key={c.type}>
          · {VIOLATION_LABEL[c.type]} — {c.reason}
          {SHOW_IN_PHOTO[c.type] && <> → <b>{SHOW_IN_PHOTO[c.type]}</b> 나오게 다시 찍으면 신고할 수 있습니다</>}
        </p>
      ))}
    </div>
  );
  const chips = others.length > 0 && (
    <div className="mt-2 flex items-center gap-1.5 flex-wrap text-[13px] text-slate-500">
      사진에 함께 보인 유형
      {others.map((t) => (
        <button key={t} onClick={() => onPick(t)} className="px-2 py-0.5 rounded border border-slate-300 text-slate-700 font-bold">
          {VIOLATION_LABEL[t]}
        </button>
      ))}
    </div>
  );

  if (draft.type) {
    const src: Source = manual ? 'manual' : verdict.source === 'photo_confirmed' ? 'photo_confirmed' : 'photo_only';
    return (
      <>
        <Value source={src}>{VIOLATION_LABEL[draft.type]}</Value>
        <div className="pl-9">
          {!manual && verdict.photoReason && (
            <p className="mt-1 text-[14px] text-slate-600">
              <b className="text-slate-800">사진</b> {verdict.photoReason}
            </p>
          )}
          {!manual && verdict.coordNote && (
            <p className="mt-0.5 text-[14px] text-slate-500">
              <b className="text-slate-700">위치자료(참고)</b> {verdict.coordNote}
            </p>
          )}
          {manual && <p className="mt-1 text-[13px] text-slate-500">직접 고른 유형입니다. 사진에 그 근거가 보이는지 확인해 주세요.</p>}
          {chips}
          {!manual && verdict.suspicions.length > 0 && (
            <p className="mt-1.5 text-[13px] text-slate-500">
              위치자료 의심(참고): {verdict.suspicions.map((c) => `${VIOLATION_LABEL[c.type]} ${Math.round(c.distance)}m`).join(', ')}
            </p>
          )}
        </div>
      </>
    );
  }

  if (!hasShots && info.state === 'idle') {
    return <Changed muted>찍기 전에 고르지 않습니다. 사진에 보이는 것으로 정합니다</Changed>;
  }
  return (
    <div className="pl-9 mt-2">
      <p className="text-[14px] text-slate-500">
        {photoLoading
          ? '사진 판독 중… 유형은 사진에 보이는 것으로만 정합니다'
          : '사진에서 위반 유형의 증거를 찾지 못했습니다. 근거 보기에서 확인하거나 유형선택에서 골라 주세요'}
      </p>
      {chips}
      {suspicions}
      {missingLine}
    </div>
  );
}

/** 사진 판독 상태 한 줄 — 무엇을 보냈고, 근거는 어디서 보는지 */
function VisionLine({
  vision,
  onRetry,
  onEvidence,
}: {
  vision: { state: VisionState; result?: VisionResult };
  onRetry: () => void;
  onEvidence: () => void;
}) {
  const r = vision.result;
  const msg: Record<VisionState, string> = {
    idle: '',
    loading: '사진 판독 중… (두 장을 따로 읽어 맞대 봅니다, 15초 안팎)',
    ok: '사진 판독 완료',
    no_key: '사진 판독 키가 연결되지 않았습니다',
    rate_limited: '사진 판독 한도에 걸렸습니다. 잠시 후 다시 시도해 주세요',
    busy: '판독 서버가 붐빕니다. 잠시 후 다시 시도해 주세요',
    error: '사진 판독에 실패했습니다',
  };
  const retry = vision.state === 'rate_limited' || vision.state === 'busy' || vision.state === 'error';
  const oneFailed = r && r.photos.some((p) => !p);
  return (
    <div className="mt-1.5 text-[13px] text-slate-500 space-y-0.5">
      <p>
        {msg[vision.state]}
        {oneFailed && ' (한 장만 읽힘)'}
        {r && (
          <button onClick={onEvidence} className="ml-2 font-bold text-blue-700 underline underline-offset-2">
            근거 보기
          </button>
        )}
        {retry && (
          <button onClick={onRetry} className="ml-2 font-bold text-blue-700 underline underline-offset-2">
            다시 판독
          </button>
        )}
      </p>
      {r?.sameVehicle === 'no' && (
        <p className="text-red-600 font-bold">두 장에서 읽은 번호가 다릅니다 — 같은 차가 아니면 반려됩니다</p>
      )}
      <p className="text-[12px] text-slate-400">판독을 위해 사진을 Google Gemini로 보냅니다(시제품 · 테스트 사진만)</p>
    </div>
  );
}

/** 차량번호 아래 한 줄 — 두 장에서 따로 읽은 번호가 같을 때만 채운다. 아니면 왜 비웠는지 */
function PlateNote({
  draft,
  vision,
  plateOk,
  onUse,
}: {
  draft: DraftReport;
  vision: { state: VisionState; result?: VisionResult };
  plateOk: boolean;
  onUse: (text: string) => void;
}) {
  const r = vision.result;
  if (draft.plate && !plateOk) {
    return <p className="mt-1 text-sm text-red-600">형식이 맞지 않습니다. 예: 12가3456, 123가4567</p>;
  }
  if (draft.plate && !draft.manual?.plate && r) {
    return (
      <div className="mt-1.5 flex items-center gap-2 flex-wrap">
        <span className={`px-2 py-0.5 rounded border text-xs font-bold ${SOURCE.photo.cls}`}>두 장 판독 일치</span>
        <span className="text-[13px] text-slate-500">신뢰도 {Math.round(r.plate.confidence * 100)}% · 한 글자씩 확인해 주세요</span>
      </div>
    );
  }
  if (!draft.plate && r) {
    const reads = [...new Set(r.plate.reads)];
    const why =
      r.plate.agree === false
        ? `두 장에서 읽은 번호가 다릅니다(${r.plate.reads.join(' / ')})`
        : reads.length === 1 && r.plate.agree === null
          ? `한 장에서만 읽혔습니다(${reads[0]})`
          : !r.plate.readable
            ? '사진에서 번호판을 확실히 읽지 못했습니다'
            : r.plate.confidence < PLATE_CONFIDENCE_FLOOR
              ? `읽은 값(${r.plate.text})의 신뢰도가 낮습니다`
              : `읽은 값(${r.plate.text})이 번호판 형식과 다릅니다`;
    return (
      <div className="mt-1.5 text-[13px] text-slate-500">
        <p>{why} — 틀린 번호는 다른 사람에게 과태료가 가므로 비워 두었습니다</p>
        {reads.length > 0 && (
          <div className="mt-1 flex items-center gap-1.5 flex-wrap">
            사진을 보고 맞으면
            {reads.map((t) => (
              <button key={t} onClick={() => onUse(t)} className="px-2 py-0.5 rounded border border-slate-300 text-slate-700 font-bold tabular-nums">
                {t} 쓰기
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }
  return null;
}

const BOX_STYLE: Record<BoxLabel, { color: string; text: string }> = {
  plate: { color: '#dc2626', text: '번호판' },
  vehicle: { color: '#2563eb', text: '단속 차량' },
  crosswalk: { color: '#16a34a', text: '횡단보도' },
  sidewalk: { color: '#16a34a', text: '인도' },
  busstop_sign: { color: '#16a34a', text: '정류장 표지' },
  schoolzone_mark: { color: '#16a34a', text: '보호구역 표시' },
  corner: { color: '#16a34a', text: '교차로 모퉁이' },
  hydrant: { color: '#16a34a', text: '소화전' },
};

const SCENE_TEXT: Record<keyof Scene, string> = {
  onCrosswalk: '횡단보도 위',
  onSidewalk: '인도 위',
  busStopVisible: '정류장 표지',
  schoolZoneMarking: '보호구역 표시',
  intersectionCorner: '교차로 모퉁이',
  fireHydrantNear: '소화전',
};
const TRI_TEXT = { yes: '보임', no: '아님', unclear: '모름' } as const;

function Light({ status }: { status: CheckStatus }) {
  const cls = { pass: 'bg-green-600', warn: 'bg-amber-500', fail: 'bg-red-600' }[status];
  return <span className={`inline-block w-3 h-3 rounded-full ${cls}`} aria-label={{ pass: '통과', warn: '확인 필요', fail: '불가' }[status]} />;
}

/** 촬영/앨범 고르기 — 지금 앱은 앱 카메라만 받는다. 개선안은 앨범도 받고 파일 기록으로 진위를 점검한다. */
function SourceSheet({ onCamera, onAlbum, onClose }: { onCamera: () => void; onAlbum: () => void; onClose: () => void }) {
  return (
    <div className="absolute inset-0 z-30 bg-slate-900/50 flex items-end">
      <div className="w-full bg-white rounded-t-2xl p-4 pb-6 space-y-2.5">
        <p className="text-[18px] font-bold text-slate-900 mb-1">사진 넣기</p>
        <button onClick={onCamera} className="w-full h-14 rounded-lg bg-[#3a8fdb] text-white text-[18px] font-bold flex items-center justify-center gap-2">
          <Camera className="w-6 h-6" aria-hidden="true" /> 카메라로 찍기
        </button>
        <button onClick={onAlbum} className="w-full h-14 rounded-lg border-2 border-slate-300 text-slate-800 text-[18px] font-bold flex items-center justify-center gap-2">
          <ImageIcon className="w-6 h-6" aria-hidden="true" /> 앨범에서 2장 고르기
        </button>
        <p className="text-[13px] text-slate-500 leading-snug">
          앨범 사진은 파일에 남은 촬영시각·카메라 정보·위치로 진위를 점검합니다. 캡처·메신저로 받은 사진처럼 촬영 기록이 없으면 받을 수 없습니다.
        </p>
        <button onClick={onClose} className="w-full h-12 rounded-lg bg-slate-100 text-slate-600 text-[16px]">취소</button>
      </div>
    </div>
  );
}

/** 제출 전 점검 — 신호등. 빨간불이 있으면 제출할 수 없다 */
function CheckSheet({ pc, onSubmit, onClose }: { pc: Precheck; onSubmit: () => void; onClose: () => void }) {
  const fails = pc.checks.filter((c) => c.status === 'fail').length;
  const Item = ({ c }: { c: CheckResult }) => (
    <li className="flex gap-2.5 py-2 border-b border-slate-100">
      <span className="pt-1"><Light status={c.status} /></span>
      <div className="min-w-0">
        <p className="text-[15px] font-bold text-slate-900">{c.label}</p>
        <p className="text-[13px] text-slate-600 leading-snug">{c.detail}</p>
      </div>
    </li>
  );
  return (
    <div className="absolute inset-0 z-30 bg-white flex flex-col">
      <BlueBar title="제출 전 점검" onClose={onClose} />
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
        <p className="text-[13px] text-slate-500 mb-2">
          담당 공무원이 불수용하는 흔한 사유를 미리 봅니다. 빨간불은 고쳐야 제출할 수 있고, 노란불은 확인만 하면 됩니다.
        </p>
        <ul>
          {pc.checks.map((c) => (
            <Item key={c.id} c={c} />
          ))}
        </ul>
        {pc.album.length > 0 && (
          <>
            <p className="mt-4 mb-1 text-[15px] font-bold text-slate-900">앨범 사진 진위 — 항목별</p>
            <ul>
              {pc.album.map((c) => (
                <Item key={c.id} c={c} />
              ))}
            </ul>
          </>
        )}
      </div>
      <div className="shrink-0 p-3 border-t border-slate-200">
        <button
          onClick={onSubmit}
          disabled={pc.blocked}
          className="w-full h-14 rounded bg-[#3a8fdb] disabled:bg-slate-300 text-white text-[18px] font-bold"
        >
          {pc.blocked ? `제출할 수 없습니다 — 빨간불 ${fails}개` : '제출'}
        </button>
      </div>
    </div>
  );
}

/** 근거 보기 — 사진 위에 AI가 근거로 짚은 자리를 상자로, 아래에 장면 항목을 장별로 */
function EvidenceSheet({ shots, result, onClose }: { shots: Shot[]; result: VisionResult; onClose: () => void }) {
  return (
    <div className="absolute inset-0 z-30 bg-white flex flex-col">
      <BlueBar title="사진 판독 근거" onClose={onClose} />
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-5">
        {shots.slice(0, 2).map((s, i) => {
          const read = result.photos[i];
          return (
            <div key={s.takenAt}>
              <p className="text-[15px] font-bold text-slate-900 mb-1.5">
                {i + 1}번째 사진 {read ? `· 번호 ${read.plate.readable ? read.plate.text : '못 읽음'}` : '· 판독 실패'}
              </p>
              <div className="relative">
                <img src={s.dataUrl} alt={`${i + 1}번째 사진`} className="w-full rounded" />
                {read && (
                  <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" className="absolute inset-0 w-full h-full">
                    {read.boxes.map((b, j) => {
                      const [y0, x0, y1, x1] = b.box;
                      const st = BOX_STYLE[b.label];
                      return (
                        <g key={j}>
                          <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} fill="none" stroke={st.color} strokeWidth={6} vectorEffect="non-scaling-stroke" />
                        </g>
                      );
                    })}
                  </svg>
                )}
                {read?.boxes.map((b, j) => (
                  <span
                    key={j}
                    className="absolute text-[11px] font-bold text-white px-1 rounded-sm -translate-y-full"
                    style={{ left: `${b.box[1] / 10}%`, top: `${b.box[0] / 10}%`, background: BOX_STYLE[b.label].color }}
                  >
                    {BOX_STYLE[b.label].text}
                  </span>
                ))}
              </div>
            </div>
          );
        })}

        <table className="w-full text-[14px]">
          <thead>
            <tr className="text-slate-500 text-left">
              <th className="py-1 font-normal">항목</th>
              <th className="py-1 font-normal text-center">1장</th>
              <th className="py-1 font-normal text-center">2장</th>
              <th className="py-1 font-normal text-center">합친 값</th>
            </tr>
          </thead>
          <tbody>
            {(Object.keys(SCENE_TEXT) as (keyof Scene)[]).map((k) => (
              <tr key={k} className="border-t border-slate-100">
                <td className="py-1.5 text-slate-800">{SCENE_TEXT[k]}</td>
                {[0, 1].map((i) => (
                  <td key={i} className="py-1.5 text-center text-slate-600">
                    {result.photos[i] ? TRI_TEXT[result.photos[i]!.scene[k]] : '—'}
                  </td>
                ))}
                <td className={`py-1.5 text-center font-bold ${result.scene[k] === 'yes' ? 'text-green-700' : 'text-slate-500'}`}>
                  {TRI_TEXT[result.scene[k]]}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="text-[13px] text-slate-500 space-y-1 border-t border-slate-200 pt-3">
          <p>
            <b className="text-slate-700">유형은 위 표에서 규칙으로 정합니다.</b> 두 장의 값이 엇갈리면(보임/아님) '모름'으로
            봅니다. 여러 개가 보이면 횡단보도·인도 → 소화전·정류장·모퉁이 → 보호구역 순으로 앞선 것을 고릅니다.
          </p>
          {!result.modelAgrees && (
            <p className="text-amber-800">AI가 따로 낸 유형이 규칙 결과와 달라 확신을 낮췄습니다 — 직접 확인해 주세요.</p>
          )}
          <p>번호판은 두 장에서 따로 읽어 같을 때만 채웁니다. 모델: {result.model}</p>
        </div>
      </div>
    </div>
  );
}

function PlaceValue({
  draft,
  state,
  onRevert,
}: {
  draft: DraftReport;
  state: AddressState;
  onRevert: () => void;
}) {
  const first = locatedShot(draft.shots);
  const acc = first?.accuracy !== undefined ? `±${Math.round(first.accuracy)}m` : undefined;
  const taken = draft.shots[0];

  if (draft.address) {
    return (
      <Value
        source={draft.manual?.address ? (draft.addressFrom === 'map' ? 'map' : 'manual') : 'gps'}
        extra={
          draft.manual?.address ? (
            first && (
              <button onClick={onRevert} className="text-xs font-bold text-slate-500 underline underline-offset-2">
                사진 좌표 주소로 되돌리기
              </button>
            )
          ) : (
            <span className="text-xs text-slate-500">
              {acc}
              {draft.addressParcel && ` · 지번 ${draft.addressParcel.split(' ').slice(-2).join(' ')}`}
            </span>
          )
        }
      >
        {draft.address}
      </Value>
    );
  }
  if (!first) {
    return (
      <Changed muted>
        {!taken
          ? '사진을 찍은 자리가 그대로 들어갑니다'
          : taken.locIssue === 'denied'
            ? '브라우저의 위치 권한이 꺼져 있어 좌표를 받지 못했습니다. 위치를 허용하고 다시 찍거나, 위치찾기로 넣어 주세요.'
            : '찍을 때 위치를 잡지 못했습니다(실내·지하 등). 위치찾기로 넣어 주세요.'}
      </Changed>
    );
  }
  const note: Record<AddressState, string> = {
    idle: '',
    loading: '주소를 찾는 중입니다…',
    ok: '',
    no_key: '주소 변환 키가 아직 연결되지 않아 좌표로 둡니다',
    not_found: '이 좌표에는 주소가 없습니다. 위치찾기로 넣어 주세요',
    error: '주소 변환에 실패했습니다. 위치찾기로 넣어 주세요',
  };
  return (
    <div className="mt-2 pl-9">
      <p className="text-[20px] text-[#3a8fdb] tabular-nums">
        {first.lat!.toFixed(5)}, {first.lng!.toFixed(5)}
        {acc && <span className="text-[14px] text-slate-500"> ({acc})</span>}
      </p>
      {note[state] && <p className="mt-1 text-[14px] text-slate-500">{note[state]}</p>}
    </div>
  );
}

/* ----------------------------- 팝업들 ----------------------------- */

function BlueBar({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="shrink-0 h-14 bg-[#3a8fdb] text-white pl-4 pr-2 flex items-center justify-between">
      <p className="text-[21px] font-bold">{title}</p>
      <button onClick={onClose} aria-label="닫기" className="w-11 h-11 flex items-center justify-center">
        <X className="w-8 h-8" strokeWidth={3} aria-hidden="true" />
      </button>
    </div>
  );
}

/** 유형 선택 — 지금 앱과 같은 가운데 팝업. 다만 처음에 뜨지 않고, 추천을 바꿀 때만 연다. */
function TypeDialog({
  current,
  onPick,
  onClose,
}: {
  current?: ViolationType;
  onPick: (t: ViolationType) => void;
  onClose: () => void;
}) {
  return (
    <div className="absolute inset-0 z-30 bg-slate-900/50 flex items-center justify-center px-6">
      <div className="w-full bg-white shadow-xl max-h-full flex flex-col">
        <BlueBar title="불법 주정차 유형 선택" onClose={onClose} />
        <div className="p-4 space-y-2 overflow-y-auto">
          {(Object.keys(VIOLATION_LABEL) as ViolationType[]).map((t) => (
            <button
              key={t}
              onClick={() => onPick(t)}
              className={`w-full h-14 border-2 text-[19px] ${
                t === current ? 'border-[#3a8fdb] text-blue-600 font-bold' : 'border-slate-200 text-slate-800'
              }`}
            >
              {VIOLATION_LABEL[t]}
            </button>
          ))}
          <button onClick={onClose} className="w-full h-14 bg-slate-400 text-white text-[19px]">
            취소
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * 위치찾기 — 지금 앱과 같은 전체 화면(검색 단추 셋 · 지도 · 주소 · 위치선택).
 * 지금은 여기서 핀을 옮겨야 주소가 들어가지만, 개선안은 사진 좌표로 이미 들어와 있어 고칠 때만 연다.
 * 지도를 끌면 가운데 핀 자리의 주소를 바로 보여주고, '위치선택'으로 그 주소를 넣는다.
 */
function PlaceSheet({
  draft,
  onPick,
  onClose,
}: {
  draft: DraftReport;
  onPick: (a: PickedAddress) => void;
  onClose: () => void;
}) {
  const shot = locatedShot(draft.shots);
  const origin: LatLng = shot ? { lat: shot.lat!, lng: shot.lng! } : DEFAULT_ORIGIN;
  const [typed, setTyped] = useState('');
  const [here, setHere] = useState<{ state: 'loading' | 'ok' | 'fail'; road?: string; parcel?: string }>({
    state: 'loading',
  });
  const inputRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const focus = () => inputRef.current?.focus();

  // 지도가 멈추면 가운데 자리의 주소를 찾는다(0.4초 기다렸다가 — 끄는 동안 매번 부르지 않게)
  const onCenter = (c: LatLng) => {
    clearTimeout(timer.current);
    const my = ++seq.current;
    setHere({ state: 'loading' });
    timer.current = setTimeout(() => {
      void reverseGeocode(c.lat, c.lng).then((r) => {
        if (my !== seq.current) return;
        setHere(r.state === 'ok' ? { state: 'ok', road: r.road, parcel: r.parcel } : { state: 'fail' });
      });
    }, 400);
  };
  useEffect(() => () => clearTimeout(timer.current), []);

  const hereText = here.road ?? here.parcel;
  const pick = () => {
    if (typed.trim()) onPick({ address: typed.trim(), from: 'typed' });
    else if (here.state === 'ok' && hereText)
      onPick({ address: hereText, parcel: here.road ? here.parcel : undefined, from: 'map' });
  };

  return (
    <div className="absolute inset-0 z-30 bg-white flex flex-col">
      <BlueBar title="위치찾기" onClose={onClose} />
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4">
        <div className="grid grid-cols-3 gap-2">
          <button onClick={focus} className="h-12 rounded-sm bg-[#3a8fdb] text-white text-[16px]">도로명검색</button>
          <button onClick={focus} className="h-12 rounded-sm bg-slate-700 text-white text-[16px]">지번검색</button>
          <button onClick={focus} className="h-12 rounded-sm bg-green-600 text-white text-[16px]">키워드검색</button>
        </div>

        <div className="mt-3">
          <Suspense fallback={<div className="aspect-square border border-slate-300 bg-slate-100" />}>
            <PickMap origin={origin} accuracy={shot?.accuracy} onCenter={onCenter} />
          </Suspense>
        </div>

        <p className="mt-4 text-[22px] text-slate-900 leading-snug min-h-[1.4em]">
          {here.state === 'loading' ? (
            <span className="text-slate-400">주소 찾는 중…</span>
          ) : here.state === 'ok' ? (
            hereText
          ) : (
            <span className="text-slate-500 text-[17px]">이 자리의 주소를 찾지 못했습니다. 지도를 조금 옮겨 보세요.</span>
          )}
        </p>
        <p className="mt-1 text-[14px] text-slate-500">
          {shot
            ? `파란 원은 사진을 찍은 자리의 GPS 오차 범위(±${Math.round(shot.accuracy ?? 0)}m)입니다`
            : '사진에 좌표가 없어 기본 위치에서 시작합니다. 지도를 끌어 핀을 맞춰 주세요'}
        </p>

        <input
          ref={inputRef}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder="지도에서 못 찾으면 주소 직접 입력"
          className="mt-4 w-full h-12 px-4 rounded border border-slate-300 bg-slate-100 text-[17px] placeholder:text-[15px] placeholder:text-slate-400"
        />
        <button
          onClick={pick}
          disabled={!typed.trim() && here.state !== 'ok'}
          className="mt-4 w-full h-14 rounded-sm bg-[#3a8fdb] text-white text-[21px] disabled:opacity-50"
        >
          위치선택
        </button>
      </div>
    </div>
  );
}

function WhyPanel({ onClose }: { onClose: () => void }) {
  return (
    <div className="absolute inset-0 z-30 bg-white flex flex-col">
      <BlueBar title="지금 화면과 무엇이 다른가" onClose={onClose} />
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4 text-[15px] text-slate-600">
        <div>
          <p className="font-bold text-slate-900 mb-1">화면 틀은 그대로</p>
          <p>
            유형선택 · 사진 · 발생지역(위치찾기) · 내용(5~900자) · 공유 동의 · 제출/닫기.
            지금 신고서의 칸과 단추 모양을 그대로 씁니다. 바꾼 것은 <b>순서</b>와 <b>누가 채우는가</b>입니다.
            추천 단어 · 주민점검신청제 · 음성 · 휴대전화 인증은 이번 개선과 관계없어 시제품에서 뺐습니다.
          </p>
        </div>
        <div>
          <p className="font-bold text-slate-900 mb-1">① 사진이 맨 위로</p>
          <p>
            지금은 유형선택이 먼저이고, 내용 칸에도 "유형을 먼저 선택해주세요"라고 적혀 있습니다.
            찍기도 전에 횡단보도인지 교차로 모퉁이인지 고르는 동안 차가 떠납니다.
          </p>
        </div>
        <div>
          <p className="font-bold text-slate-900 mb-1">② 나머지는 사진에서</p>
          <p>
            발생지역은 사진 좌표를 주소로 바꿔 넣습니다 — 위치찾기에서 핀을 옮길 일이 줄어듭니다.
            유형은 사진에 보이는 것으로 정하고(위치자료는 의심 표시용 참고), 내용은 그 값들로 문장을 만듭니다. <b>사람은 확인하고 고치기만 합니다.</b>
          </p>
        </div>
        <div>
          <p className="font-bold text-slate-900 mb-1">③ 값마다 출처 표시</p>
          <p>
            자동으로 채운 칸에는 어디서 온 값인지 배지를 답니다. 사람이 고친 칸은 다시 덮어쓰지 않습니다.
          </p>
        </div>
        <p className="text-xs text-slate-500 pt-3 border-t border-slate-200">
          근거: 2026년 구글플레이 리뷰 655건 분류 (docs/painpoints.md) · 국민제안 준비용 비공식 시제품이며
          실제 신고는 접수되지 않습니다.
        </p>
      </div>
    </div>
  );
}
