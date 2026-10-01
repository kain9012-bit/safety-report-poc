import {
  Camera,
  Check,
  CopyPlus,
  FileCheck2,
  Image as ImageIcon,
  LocateFixed,
  MapPin,
  Menu,
  Pointer,
  RotateCcw,
  X,
  ZoomIn,
} from 'lucide-react';
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { formatStamp } from '../lib/camera';
import { BODY_MAX, BODY_MIN, composeBody } from '../lib/compose';
import type { AddressState } from '../lib/reverseGeocode';
import { intervalSeconds, isValidPlate } from '../lib/rules';
import { VIOLATION_LABEL } from '../types/report';
import type { DraftReport, EditableField, ViolationType } from '../types/report';

interface Props {
  draft: DraftReport;
  addressState: AddressState;
  onCapture: () => void;
  /** 사람이 칸을 고쳤다. value가 undefined면 자동 값으로 되돌린다. */
  onEdit: (field: EditableField, value: string | undefined) => void;
  onReset: () => void;
}

type Source = 'gps' | 'photo' | 'cross' | 'auto' | 'manual';

const SOURCE: Record<Source, { cls: string; text: string }> = {
  gps: { cls: 'bg-blue-50 text-blue-700 border-blue-200', text: '사진 좌표에서 자동' },
  photo: { cls: 'bg-amber-50 text-amber-800 border-amber-200', text: '사진 판독 · 확인 필요' },
  cross: { cls: 'bg-blue-50 text-blue-700 border-blue-200', text: '좌표×사진 추천' },
  auto: { cls: 'bg-green-50 text-green-700 border-green-200', text: '자동 작성' },
  manual: { cls: 'bg-slate-50 text-slate-600 border-slate-300', text: '직접 입력' },
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
export default function ReportForm({ draft, addressState, onCapture, onEdit, onReset }: Props) {
  const [sheet, setSheet] = useState<'why' | 'type' | 'place' | null>(null);
  const [agree, setAgree] = useState(true);
  const [copied, setCopied] = useState(false);
  const [toast, setToast] = useState(false);

  const shots = draft.shots;
  const first = shots[0];
  const second = shots[1];
  const hasShots = shots.length >= 2;
  const hasCoord = first?.lat !== undefined && first?.lng !== undefined;
  const manual = draft.manual ?? {};

  const body = manual.body ? (draft.body ?? '') : composeBody(draft);
  const plateOk = draft.plate ? isValidPlate(draft.plate) : false;

  const missing = [
    !hasShots && '사진 2장',
    !draft.type && '유형',
    !draft.address && !hasCoord && '발생지역',
    !plateOk && '차량번호',
    body.length < BODY_MIN && '내용',
  ].filter(Boolean) as string[];

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
                <OutlineButton onClick={onCapture} icon={<ImageIcon className="w-5 h-5" />}>
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
                    onClick={i < 2 ? onCapture : undefined}
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
                    {s && (
                      <span className="absolute bottom-0 inset-x-0 rounded-b-xl bg-slate-900/60 text-white text-[10px] tabular-nums py-0.5">
                        {formatStamp(s.takenAt).slice(11)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <Changed>
              {hasShots
                ? `${Math.floor(intervalSeconds(first.takenAt, second.takenAt))}초 간격 · 촬영시각과 좌표가 사진에 찍혔습니다`
                : '사진부터 찍으면 아래 칸이 자동으로 채워집니다'}
            </Changed>
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
            {draft.type ? (
              <Value source={manual.type ? 'manual' : 'cross'}>{VIOLATION_LABEL[draft.type]}</Value>
            ) : (
              <Changed muted>
                {hasShots
                  ? '좌표와 사진으로 추천합니다 — 공공데이터 연결 전이라 아직 비어 있습니다'
                  : '찍기 전에 고르지 않습니다. 사진으로 추천합니다'}
              </Changed>
            )}
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
            <PlaceValue draft={draft} state={addressState} />
          </section>

          {/* ===== 차량번호 — 지금 불법주정차 신고서에는 없는 칸(교통위반 탭에는 있음) ===== */}
          <section>
            <Row label="차량번호" />
            <input
              value={draft.plate ?? ''}
              onChange={(e) => onEdit('plate', e.target.value || undefined)}
              placeholder={first ? '판독 연결 전 — 직접 입력 (예: 12가3456)' : '사진에서 번호판을 읽어 채웁니다'}
              className="mt-3 w-full h-12 px-4 rounded border border-slate-300 bg-slate-100 text-[18px] tabular-nums placeholder:text-[15px] placeholder:text-slate-400"
            />
            {draft.plate && !plateOk && (
              <p className="mt-1 text-sm text-red-600">형식이 맞지 않습니다. 예: 12가3456, 123가4567</p>
            )}
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
        <p className="text-[12px] text-center py-1 text-slate-500">
          {missing.length === 0 ? (
            <span className="text-green-700 font-bold">모든 칸이 채워졌습니다</span>
          ) : (
            <>
              남은 칸 <b className="text-slate-800">{missing.length}</b> · {missing.join(', ')}
            </>
          )}
        </p>
        <div className="grid grid-cols-2 gap-1.5">
          <button
            onClick={() => {
              setToast(true);
              setTimeout(() => setToast(false), 2000);
            }}
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

      {sheet === 'why' && <WhyPanel onClose={() => setSheet(null)} />}
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
          onPick={(addr) => {
            onEdit('address', addr);
            setSheet(null);
          }}
          onReset={() => {
            onEdit('address', undefined);
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

function PlaceValue({ draft, state }: { draft: DraftReport; state: AddressState }) {
  const first = draft.shots[0];
  const hasCoord = first?.lat !== undefined && first?.lng !== undefined;
  const acc = first?.accuracy !== undefined ? `±${Math.round(first.accuracy)}m` : undefined;

  if (draft.address) {
    return (
      <Value
        source={draft.manual?.address ? 'manual' : 'gps'}
        extra={
          !draft.manual?.address && (
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
  if (!hasCoord) {
    return (
      <Changed muted>
        {first ? '사진에 위치가 없습니다. 위치찾기로 넣어 주세요.' : '사진을 찍은 자리가 그대로 들어갑니다'}
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
 * 지도는 지도 키 연결 후 붙이고, 그 전에는 주소를 직접 넣을 수 있게 둔다.
 */
function PlaceSheet({
  draft,
  onPick,
  onReset,
  onClose,
}: {
  draft: DraftReport;
  onPick: (addr: string) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const first = draft.shots[0];
  const hasCoord = first?.lat !== undefined && first?.lng !== undefined;
  const [addr, setAddr] = useState(draft.address ?? '');
  const inputRef = useRef<HTMLInputElement>(null);
  const focus = () => inputRef.current?.focus();

  return (
    <div className="absolute inset-0 z-30 bg-white flex flex-col">
      <BlueBar title="위치찾기" onClose={onClose} />
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4">
        <div className="grid grid-cols-3 gap-2">
          <button onClick={focus} className="h-12 rounded-sm bg-[#3a8fdb] text-white text-[16px]">도로명검색</button>
          <button onClick={focus} className="h-12 rounded-sm bg-slate-700 text-white text-[16px]">지번검색</button>
          <button onClick={focus} className="h-12 rounded-sm bg-green-600 text-white text-[16px]">키워드검색</button>
        </div>

        {/* 지도 자리 */}
        <div className="relative mt-3 aspect-square border border-slate-300 bg-slate-100 overflow-hidden">
          <div
            className="absolute inset-0 opacity-60"
            style={{
              backgroundImage:
                'linear-gradient(#cbd5e1 1px, transparent 1px), linear-gradient(90deg, #cbd5e1 1px, transparent 1px)',
              backgroundSize: '32px 32px',
            }}
            aria-hidden="true"
          />
          <button
            onClick={onReset}
            className="absolute top-3 left-3 w-[76px] h-[76px] rounded-full bg-[#3a8fdb] text-white text-[14px] leading-tight flex flex-col items-center justify-center"
          >
            <LocateFixed className="w-5 h-5" aria-hidden="true" />
            위치
            <br />
            초기화
          </button>
          <MapPin
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-full w-11 h-11 text-[#3a8fdb] fill-[#3a8fdb]/30"
            aria-hidden="true"
          />
          <p className="absolute bottom-2 inset-x-2 text-center text-[13px] text-slate-500">
            지도는 지도 키 연결 후 표시됩니다
          </p>
        </div>

        <p className="mt-4 text-[22px] text-slate-900 leading-snug">
          {draft.address ??
            (hasCoord ? `${first.lat!.toFixed(5)}, ${first.lng!.toFixed(5)}` : '사진에 좌표가 없습니다')}
        </p>
        {hasCoord && first.accuracy !== undefined && (
          <p className="mt-1 text-[14px] text-slate-500">
            사진을 찍은 자리 · 정확도 ±{Math.round(first.accuracy)}m
            {first.accuracy > 10 && ' — 오차가 커서 옆 건물로 잡힐 수 있습니다'}
          </p>
        )}

        <input
          ref={inputRef}
          value={addr}
          onChange={(e) => setAddr(e.target.value)}
          placeholder="주소 직접 입력 (예: 전주시 완산구 노송광장로 10)"
          className="mt-4 w-full h-12 px-4 rounded border border-slate-300 bg-slate-100 text-[17px] placeholder:text-[15px] placeholder:text-slate-400"
        />
        <button
          onClick={() => (addr.trim() ? onPick(addr.trim()) : onClose())}
          className="mt-4 w-full h-14 rounded-sm bg-[#3a8fdb] text-white text-[21px]"
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
            유형은 좌표와 사진으로 추천, 내용은 그 값들로 문장을 만듭니다. <b>사람은 확인하고 고치기만 합니다.</b>
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
