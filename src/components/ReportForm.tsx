import { Camera, ChevronRight, Info, MapPin, RotateCcw, X } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { formatStamp } from '../lib/camera';
import { BODY_MAX, BODY_MIN, composeBody } from '../lib/compose';
import { intervalSeconds, isValidPlate } from '../lib/rules';
import { VIOLATION_LABEL } from '../types/report';
import type { DraftReport, EditableField, ViolationType } from '../types/report';
import { Badge } from './Ui';

interface Props {
  draft: DraftReport;
  onCapture: () => void;
  /** 사람이 칸을 고쳤다. value가 undefined면 자동 값으로 되돌린다. */
  onEdit: (field: EditableField, value: string | undefined) => void;
  onReset: () => void;
}

type Source = 'gps' | 'photo' | 'time' | 'cross' | 'auto' | 'manual';

const SOURCE_BADGE: Record<Source, { tone: 'blue' | 'amber' | 'green' | 'slate'; text: string }> = {
  gps: { tone: 'blue', text: '좌표에서 자동' },
  photo: { tone: 'amber', text: '사진 판독 · 확인 필요' },
  time: { tone: 'green', text: '촬영시각에서 자동' },
  cross: { tone: 'blue', text: '좌표×사진 교차검증' },
  auto: { tone: 'green', text: '자동 작성' },
  manual: { tone: 'slate', text: '직접 입력' },
};

/**
 * 신고서 화면 — 지금 안전신문고 불법주정차 신고서와 **같은 칸, 같은 자리의 단추**를 쓴다.
 * (탭 · 유형선택 · 사진 · 발생지역[위치찾기] · 내용[5~900자] · 휴대전화 · 공유 동의 · 제출/닫기)
 *
 * 바꾼 것은 둘뿐이다.
 *  1. 사진이 맨 위로 온다. 지금은 유형선택이 먼저이고, 내용 칸에는
 *     "내용을 입력하기 전에 신고분야 및 유형을 먼저 선택해주세요"라고 적혀 있다.
 *  2. 사진을 찍으면 나머지 칸이 **채워진 채로** 돌아온다. 사람은 확인하고 고치기만 한다.
 *
 * 칸마다 값이 어디서 왔는지 배지로 밝힌다. 사람이 고친 칸은 자동 작성이 덮어쓰지 않는다.
 * 기관 로고·명칭·상단 메뉴는 쓰지 않는다 — 실제 기관 화면으로 오인되면 안 된다.
 */
export default function ReportForm({ draft, onCapture, onEdit, onReset }: Props) {
  const [sheet, setSheet] = useState<'why' | 'type' | 'place' | null>(null);
  const [phone, setPhone] = useState('');
  const [agree, setAgree] = useState(true);

  const shots = draft.shots;
  const first = shots[0];
  const second = shots[1];
  const hasShots = shots.length >= 2;
  const hasCoord = first?.lat !== undefined && first?.lng !== undefined;
  const manual = draft.manual ?? {};

  // 내용 — 사람이 고치지 않았으면 다른 칸에서 매번 새로 만든다
  const body = manual.body ? (draft.body ?? '') : composeBody(draft);
  const plateOk = draft.plate ? isValidPlate(draft.plate) : false;

  const missing = [
    !hasShots && '사진 2장',
    !draft.type && '위반유형',
    !draft.address && !hasCoord && '발생지역',
    !plateOk && '차량번호',
    body.length < BODY_MIN && '내용',
    !phone && '휴대전화',
  ].filter(Boolean) as string[];

  return (
    <div className="relative flex-1 min-h-0 flex flex-col bg-white">
      {/* 지금 앱과 같은 자리의 탭. 기관 로고·상단 메뉴는 쓰지 않는다. */}
      <div className="shrink-0 bg-slate-100 border-b border-slate-200 grid grid-cols-4 text-center text-[13px] leading-tight">
        {['안전', '불법\n주정차', '자동차·\n교통위반', '생활\n불편'].map((t) => {
          const on = t.startsWith('불법');
          return (
            <span
              key={t}
              className={`py-2.5 font-bold whitespace-pre-line ${
                on ? 'text-blue-700 border-b-[3px] border-blue-600 bg-white' : 'text-slate-500'
              }`}
            >
              {t}
            </span>
          );
        })}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="px-4 py-4 space-y-6">
          {/* --- 사진 — 맨 위로 올렸다 --- */}
          <section>
            <Head label="사진" right={<Badge tone="red">필수 2장</Badge>} />
            <div className="flex gap-2 mt-2">
              {[0, 1].map((i) => {
                const s = shots[i];
                return (
                  <div key={i} className="flex-1 min-w-0">
                    <div
                      className={`aspect-[4/3] rounded-lg overflow-hidden border-2 flex items-center justify-center ${
                        s ? 'border-green-600' : 'border-dashed border-slate-300 bg-slate-50'
                      }`}
                    >
                      {s ? (
                        <img src={s.dataUrl} alt={`${i + 1}번째 사진`} className="w-full h-full object-cover" />
                      ) : (
                        <Camera className="w-6 h-6 text-slate-300" aria-hidden="true" />
                      )}
                    </div>
                    <p className="mt-1 text-[11px] text-slate-500 tabular-nums text-center">
                      {s ? formatStamp(s.takenAt).slice(11) : `${i + 1}번째`}
                    </p>
                  </div>
                );
              })}
            </div>
            <p className="mt-1 text-sm text-slate-500">
              {hasShots
                ? `${Math.floor(intervalSeconds(first.takenAt, second.takenAt))}초 간격 · 촬영시각과 좌표가 사진에 찍혀 있습니다`
                : '먼저 찍으세요. 아래 칸은 사진에서 자동으로 채워집니다.'}
            </p>
            <button
              onClick={onCapture}
              className={`mt-3 w-full py-3.5 rounded-lg font-bold transition-colors flex items-center justify-center gap-2 ${
                hasShots
                  ? 'border border-slate-300 text-slate-700 hover:border-blue-600 hover:text-blue-700'
                  : 'bg-blue-600 hover:bg-blue-700 text-white'
              }`}
            >
              <Camera className="w-5 h-5" aria-hidden="true" />
              {hasShots ? '다시 찍기' : first ? '이어서 찍기' : '촬영 시작'}
            </button>
          </section>

          {/* --- 위반유형 — 지금은 맨 처음 고르는 칸. 여기서는 추천을 받고, 바꿀 때만 고른다 --- */}
          <section>
            <Head
              label="위반유형"
              source={draft.type ? (manual.type ? 'manual' : 'cross') : undefined}
              right={
                <SideButton onClick={() => setSheet('type')}>{draft.type ? '변경' : '선택'}</SideButton>
              }
            />
            {draft.type ? (
              <p className="mt-2 text-lg font-bold text-blue-700">{VIOLATION_LABEL[draft.type]}</p>
            ) : (
              <Pending>
                {hasShots
                  ? '좌표와 사진으로 추천합니다 — 공공데이터 연결 전이라 아직 비어 있습니다. 직접 고를 수 있습니다.'
                  : '사진을 찍으면 좌표와 사진으로 추천합니다.'}
              </Pending>
            )}
          </section>

          {/* --- 발생지역 --- */}
          <section>
            <Head
              label="발생지역"
              source={draft.address ? (manual.address ? 'manual' : 'gps') : hasCoord ? 'gps' : undefined}
              right={
                <SideButton onClick={() => setSheet('place')}>
                  <MapPin className="w-4 h-4" aria-hidden="true" /> 위치찾기
                </SideButton>
              }
            />
            {draft.address ? (
              <p className="mt-2 text-lg text-blue-700">{draft.address}</p>
            ) : hasCoord ? (
              <>
                <p className="mt-2 text-lg text-blue-700 tabular-nums">
                  {first.lat!.toFixed(5)}, {first.lng!.toFixed(5)}
                  {first.accuracy !== undefined && (
                    <span className="text-sm text-slate-500"> (±{Math.round(first.accuracy)}m)</span>
                  )}
                </p>
                <Pending>좌표는 사진에서 받았습니다. 도로명주소로 바꾸는 연결은 아직입니다.</Pending>
              </>
            ) : (
              <Pending>
                {first
                  ? '사진에 위치가 없습니다. 위치찾기로 직접 넣어 주세요.'
                  : '사진을 찍은 자리가 그대로 들어갑니다. 위치찾기를 누를 일이 없어집니다.'}
              </Pending>
            )}
          </section>

          {/* --- 차량번호 --- */}
          <section>
            <Head
              label="차량번호"
              source={draft.plate ? (manual.plate ? 'manual' : 'photo') : undefined}
            />
            <input
              value={draft.plate ?? ''}
              onChange={(e) => onEdit('plate', e.target.value || undefined)}
              placeholder={first ? '번호판 판독 연결 전 — 직접 입력 (예: 12가3456)' : '사진에서 번호판을 읽어 채웁니다'}
              className="mt-2 w-full px-3 py-3 rounded border border-slate-300 text-lg font-bold tabular-nums placeholder:text-sm placeholder:font-normal placeholder:text-slate-400"
            />
            {draft.plate && !plateOk && (
              <p className="mt-1 text-sm text-red-600">형식이 맞지 않습니다. 예: 12가3456, 123가4567</p>
            )}
          </section>

          {/* --- 내용 --- */}
          <section>
            <Head
              label="내용"
              sub="(추가·수정가능, 5~900자)"
              source={body ? (manual.body ? 'manual' : 'auto') : undefined}
              right={
                manual.body ? (
                  <SideButton onClick={() => onEdit('body', undefined)}>
                    <RotateCcw className="w-4 h-4" aria-hidden="true" /> 자동 문장
                  </SideButton>
                ) : undefined
              }
            />
            <textarea
              value={body}
              onChange={(e) => onEdit('body', e.target.value.slice(0, BODY_MAX))}
              rows={5}
              placeholder="사진을 찍으면 촬영시각·위치·유형·차량번호로 문장을 만들어 채웁니다. 고쳐 쓸 수 있습니다."
              className="mt-2 w-full px-3 py-2.5 rounded border border-slate-300 bg-slate-50 text-[15px] leading-relaxed placeholder:text-slate-400"
            />
            <p className="text-right text-xs text-slate-500 tabular-nums">
              {body.length} / {BODY_MAX}
            </p>
          </section>

          {/* --- 휴대전화 — 지금과 같다. 시제품이라 문자는 보내지 않는다 --- */}
          <section>
            <Head label="휴대전화" />
            <div className="mt-2 flex gap-2">
              <input
                type="tel"
                inputMode="numeric"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="010-0000-0000"
                className="flex-1 min-w-0 px-3 py-3 rounded border border-slate-300 tabular-nums"
              />
              <button
                disabled
                className="shrink-0 px-3 rounded bg-slate-300 text-white text-sm font-bold cursor-not-allowed"
              >
                인증번호받기
              </button>
            </div>
            <p className="mt-1 text-xs text-slate-500">시제품이라 문자를 보내지 않으며, 번호는 저장하지 않습니다.</p>
          </section>

          <label className="flex items-center gap-2.5 text-slate-800">
            <input
              type="checkbox"
              checked={agree}
              onChange={(e) => setAgree(e.target.checked)}
              className="w-5 h-5 accent-blue-600"
            />
            신고 내용 공유 동의
          </label>

          <button
            onClick={() => setSheet('why')}
            className="w-full flex items-center justify-center gap-1.5 py-2 text-sm font-bold text-slate-500 hover:text-blue-700 transition-colors"
          >
            <Info className="w-4 h-4" aria-hidden="true" />
            지금 화면과 무엇이 다른가
            <ChevronRight className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* --- 아래 고정: 제출 / 닫기 — 지금 앱과 같은 자리 --- */}
      <div className="shrink-0 border-t border-slate-200 bg-white px-3 pt-2 pb-3">
        <p className="text-xs text-center mb-2 text-slate-500">
          {missing.length === 0 ? (
            <span className="text-green-700 font-bold">모든 칸이 채워졌습니다</span>
          ) : (
            <>
              남은 칸 <b className="text-slate-800">{missing.length}</b> · {missing.join(', ')}
            </>
          )}
        </p>
        <div className="flex gap-2">
          <button
            disabled
            title="시제품이라 접수되지 않습니다"
            className="flex-1 py-3.5 rounded-lg bg-blue-600 text-white font-bold disabled:opacity-40 cursor-not-allowed"
          >
            제출
          </button>
          <button
            onClick={onReset}
            className="flex-1 py-3.5 rounded-lg bg-slate-500 hover:bg-slate-600 text-white font-bold transition-colors"
          >
            닫기
          </button>
        </div>
      </div>

      {sheet === 'why' && <WhyPanel onClose={() => setSheet(null)} />}
      {sheet === 'type' && (
        <TypeSheet
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
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

/** 칸 제목 — 지금 앱처럼 동그란 필수 표시 + 이름, 오른쪽에 단추 */
function Head({
  label,
  sub,
  source,
  right,
}: {
  label: string;
  sub?: string;
  source?: Source;
  right?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            aria-label="필수"
            className="w-5 h-5 rounded-full bg-amber-500 text-white text-sm font-bold flex items-center justify-center shrink-0"
          >
            *
          </span>
          <span className="text-lg font-bold text-slate-900">{label}</span>
          {source && <Badge tone={SOURCE_BADGE[source].tone}>{SOURCE_BADGE[source].text}</Badge>}
        </div>
        {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

function SideButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="shrink-0 px-3 py-2 rounded border border-slate-400 text-sm font-bold text-slate-700 hover:border-blue-600 hover:text-blue-700 transition-colors flex items-center gap-1"
    >
      {children}
    </button>
  );
}

function Pending({ children }: { children: ReactNode }) {
  return <p className="mt-2 text-sm text-slate-500">{children}</p>;
}

/** 시트 껍데기 — 지금 앱의 팝업처럼 위에 제목 띠와 닫기 */
function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="absolute inset-0 z-30 bg-white flex flex-col">
      <div className="shrink-0 bg-blue-600 text-white px-4 py-3 flex items-center justify-between">
        <p className="font-bold text-lg">{title}</p>
        <button onClick={onClose} aria-label="닫기" className="w-9 h-9 flex items-center justify-center">
          <X className="w-6 h-6" aria-hidden="true" />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-4">{children}</div>
    </div>
  );
}

/** 위반유형 선택 — 지금 앱의 유형 선택 팝업과 같은 목록형. 다만 처음이 아니라 '바꿀 때'만 연다. */
function TypeSheet({
  current,
  onPick,
  onClose,
}: {
  current?: ViolationType;
  onPick: (t: ViolationType) => void;
  onClose: () => void;
}) {
  return (
    <Sheet title="위반유형 선택" onClose={onClose}>
      <p className="text-sm text-slate-500 mb-3">
        사진을 찍으면 좌표와 사진으로 추천합니다. 추천이 틀렸을 때만 여기서 고릅니다.
      </p>
      <div className="space-y-2">
        {(Object.keys(VIOLATION_LABEL) as ViolationType[]).map((t) => (
          <button
            key={t}
            onClick={() => onPick(t)}
            className={`w-full py-3.5 rounded border text-lg transition-colors ${
              t === current
                ? 'border-blue-600 bg-blue-50 text-blue-700 font-bold'
                : 'border-slate-300 text-slate-800 hover:border-blue-600'
            }`}
          >
            {VIOLATION_LABEL[t]}
          </button>
        ))}
        <button onClick={onClose} className="w-full py-3.5 rounded bg-slate-400 text-white text-lg font-bold">
          취소
        </button>
      </div>
    </Sheet>
  );
}

/**
 * 위치찾기 — 지금 앱은 지도에서 핀을 옮기고 '위치선택'을 눌러야 한다.
 * 여기서는 사진 좌표가 이미 들어와 있으므로 보정이 필요할 때만 연다.
 * 지도는 지도 키(VWorld) 연결 후 붙이고, 그 전에는 주소를 직접 넣을 수 있게 둔다.
 */
function PlaceSheet({
  draft,
  onPick,
  onClose,
}: {
  draft: DraftReport;
  onPick: (addr: string) => void;
  onClose: () => void;
}) {
  const first = draft.shots[0];
  const [addr, setAddr] = useState(draft.address ?? '');
  const hasCoord = first?.lat !== undefined && first?.lng !== undefined;

  return (
    <Sheet title="위치찾기" onClose={onClose}>
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <p className="text-sm font-bold text-slate-900 mb-1">사진을 찍은 자리</p>
        {hasCoord ? (
          <>
            <p className="text-blue-700 tabular-nums">
              {first.lat!.toFixed(6)}, {first.lng!.toFixed(6)}
            </p>
            {first.accuracy !== undefined && (
              <p className="text-sm text-slate-500 mt-0.5">
                정확도 ±{Math.round(first.accuracy)}m
                {first.accuracy > 10 && ' — 오차가 커서 주소가 옆 건물로 잡힐 수 있습니다'}
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-slate-500">사진에 좌표가 없습니다.</p>
        )}
        <p className="text-xs text-slate-500 mt-3 pt-3 border-t border-slate-200">
          지도에서 핀을 옮겨 고치는 화면은 지도 키 연결 후 이 자리에 들어갑니다.
        </p>
      </div>

      <label className="block mt-5 text-sm font-bold text-slate-900" htmlFor="addr">
        주소 직접 입력
      </label>
      <input
        id="addr"
        value={addr}
        onChange={(e) => setAddr(e.target.value)}
        placeholder="예: 전주시 완산구 노송광장로 10"
        className="mt-1.5 w-full px-3 py-3 rounded border border-slate-300"
      />
      <button
        onClick={() => onPick(addr.trim())}
        disabled={!addr.trim()}
        className="mt-4 w-full py-3.5 rounded-lg bg-blue-600 enabled:hover:bg-blue-700 disabled:opacity-40 text-white text-lg font-bold transition-colors"
      >
        위치선택
      </button>
    </Sheet>
  );
}

function WhyPanel({ onClose }: { onClose: () => void }) {
  return (
    <Sheet title="지금 화면과 무엇이 다른가" onClose={onClose}>
      <div className="space-y-4 text-sm text-slate-600">
        <div>
          <p className="font-bold text-slate-900 mb-1">칸은 그대로입니다</p>
          <p>
            유형 · 사진 · 발생지역(위치찾기) · 내용(5~900자) · 휴대전화 · 공유 동의 · 제출/닫기.
            지금 신고서와 같은 칸을 같은 자리에 둡니다. 바꾼 것은 <b>순서</b>와 <b>누가 채우는가</b>
            둘뿐입니다. (추천 단어 · 주민점검신청제 · 음성 입력은 바뀌지 않아 시제품에서 뺐습니다.)
          </p>
        </div>
        <div>
          <p className="font-bold text-slate-900 mb-1">① 사진이 맨 위로</p>
          <p>
            지금은 유형 선택 팝업이 먼저 뜨고, 내용 칸에도 "유형을 먼저 선택해주세요"라고 적혀 있습니다.
            찍기도 전에 "횡단보도인지 교차로 모퉁이인지"를 고르는 동안 차가 떠납니다.
          </p>
        </div>
        <div>
          <p className="font-bold text-slate-900 mb-1">② 나머지는 사진에서 나옵니다</p>
          <p>
            발생지역은 사진 좌표 — 위치찾기에서 핀을 옮길 일이 줄어듭니다. 위반유형은 좌표와 사진을
            맞대어 추천, 차량번호는 번호판 판독, 내용은 그 값들로 문장을 만듭니다.
            <b> 사람은 확인하고 고치기만 합니다.</b>
          </p>
        </div>
        <div>
          <p className="font-bold text-slate-900 mb-1">③ 값마다 출처를 밝힙니다</p>
          <p>
            자동으로 채운 칸에는 어디서 온 값인지 배지를 답니다. 사람이 고친 칸은 다시 덮어쓰지
            않습니다. 번호판은 한 글자만 틀려도 엉뚱한 사람에게 과태료가 가므로, 확신이 낮으면 채우지
            않고 직접 입력받습니다.
          </p>
        </div>
        <p className="text-xs text-slate-500 pt-3 border-t border-slate-200">
          근거: 2026년 구글플레이 리뷰 655건 분류 (docs/painpoints.md) · 국민제안 준비용 비공식
          시제품이며 실제 신고는 접수되지 않습니다.
        </p>
      </div>
    </Sheet>
  );
}
