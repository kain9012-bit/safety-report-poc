import { ArrowLeft, Check, CopyPlus, MapPin, Pointer, RotateCcw } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { formatStamp } from '../lib/camera';
import { BODY_MAX, composeBody } from '../lib/compose';
import { precheck } from '../lib/precheck';
import { describeRules } from '../lib/localRules';
import type { AppliedRules } from '../lib/localRules';
import type { TypeOption } from '../lib/choose';
import type { CheckStatus } from '../lib/rules';
import { intervalSeconds, isValidPlate } from '../lib/rules';
import type { Verdict } from '../lib/crosscheck';
import type { VisionState } from '../lib/vision';
import type { VisionResult } from '../../api/vision';
import type { AddressState } from '../lib/reverseGeocode';
import { VIOLATION_LABEL } from '../types/report';
import type { DraftReport, EditableField } from '../types/report';
import {
  CheckLine,
  EvidenceSheet,
  Light,
  OutlineButton,
  PlaceSheet,
  PlaceValue,
  PlateNote,
  SOURCE,
  TypeDialog,
  TypeValue,
  VisionLine,
} from './FormParts';
import type { PickedAddress, TypeInfo } from './FormParts';

export const STEPS = ['유형', '발생지역', '차량번호', '내용', '점검·제출'] as const;

interface Props {
  draft: DraftReport;
  step: number;
  onStep: (n: number) => void;
  addressState: AddressState;
  typeInfo: TypeInfo;
  vision: { state: VisionState; result?: VisionResult };
  verdict: Verdict;
  options: TypeOption[];
  rules: AppliedRules;
  onRetryVision: () => void;
  onEdit: (field: EditableField, value: string | undefined) => void;
  onPickAddress: (a: PickedAddress) => void;
  /** 촬영 화면으로 돌아가 사진을 다시 찍는다 */
  onRetake: () => void;
  onHome: () => void;
  onSubmit: () => void;
}

/**
 * 신고서 — **단계별 화면**(회의 결정: 스크롤 대신 한 화면에 한 작업).
 * 칸과 모양은 지금 안전신문고 신고서를 따르고, 순서만 사진 다음으로 둔다.
 * 각 단계는 사진에서 미리 채운 값을 '확인'하는 화면이다. 사람은 확인하고 고치기만 한다.
 */
export default function ReportSteps(p: Props) {
  const { draft, step, onStep, vision, verdict } = p;
  const [sheet, setSheet] = useState<'type' | 'place' | 'evidence' | null>(null);
  const [agree, setAgree] = useState(true);
  const [copied, setCopied] = useState(false);

  const manual = draft.manual ?? {};
  const body = manual.body ? (draft.body ?? '') : composeBody(draft);
  const pc = useMemo(() => precheck({ draft, body, verdict, vision: vision.result }), [draft, body, verdict, vision.result]);
  const fails = pc.checks.filter((c) => c.status === 'fail').length;
  const count = (st: CheckStatus) => pc.checks.filter((c) => c.status === st).length;
  const last = STEPS.length - 1;

  const copyBody = async () => {
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* 복사가 막힌 브라우저 */
    }
  };

  const [first, second] = draft.shots;

  return (
    <div className="relative flex-1 min-h-0 flex flex-col bg-white text-slate-900">
      {/* 파란 띠 — 지금 앱의 상단 띠 색. 기관 메뉴는 옮기지 않는다 */}
      <div className="shrink-0 h-12 bg-[#3a8fdb] text-white flex items-center gap-1 pr-3">
        <button onClick={p.onHome} aria-label="처음 화면" className="w-12 h-12 flex items-center justify-center">
          <ArrowLeft className="w-6 h-6" aria-hidden="true" />
        </button>
        <p className="flex-1 text-[18px] font-bold">불법 주정차 신고</p>
        <p className="text-[14px] font-bold tabular-nums">
          {step + 1} / {STEPS.length}
        </p>
      </div>

      {/* 단계 표시 — 눌러서 오갈 수 있다 */}
      <ol className="shrink-0 grid grid-cols-5 gap-1 px-3 pt-2 pb-1 bg-white" aria-label="신고 단계">
        {STEPS.map((s, i) => (
          <li key={s}>
            <button onClick={() => onStep(i)} className="w-full text-center" aria-current={i === step ? 'step' : undefined}>
              <span className={`block h-1.5 rounded-full ${i <= step ? 'bg-[#3a8fdb]' : 'bg-slate-200'}`} />
              <span className={`block mt-1 text-[11px] ${i === step ? 'font-bold text-blue-700' : 'text-slate-500'}`}>{s}</span>
            </button>
          </li>
        ))}
      </ol>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-3 pb-6">
        {step === 0 && (
          <Step title="위반 유형 확인" sub="사진에 보이는 것으로 정했습니다">
            <div className="grid grid-cols-2 gap-2">
              {[first, second].map((s, i) => (
                <button
                  key={i}
                  onClick={() => vision.result && setSheet('evidence')}
                  className="relative aspect-[4/3] rounded-lg bg-slate-100 overflow-hidden"
                  aria-label={`${i + 1}번째 사진 근거 보기`}
                >
                  {s && <img src={s.dataUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />}
                  {s && (
                    <span className="absolute bottom-0 inset-x-0 bg-slate-900/60 text-white text-[11px] tabular-nums py-0.5 text-center">
                      {s.source === 'album' && s.meta?.takenAt === undefined ? '시각 없음' : formatStamp(s.takenAt).slice(11)}
                    </span>
                  )}
                </button>
              ))}
            </div>
            {first && second && (
              <p className="mt-1.5 text-[13px] text-slate-500">
                {Math.floor(intervalSeconds(first.takenAt, second.takenAt))}초 간격
                {draft.overlap && ` · 두 사진 겹침 ${Math.round(draft.overlap.ratio * 100)}%`}
              </p>
            )}
            <VisionLine vision={vision} onRetry={p.onRetryVision} onEvidence={() => setSheet('evidence')} />

            <div className="mt-5 flex items-center justify-between">
              <p className="text-[15px] font-bold text-slate-700">불법 주정차 유형</p>
              <OutlineButton onClick={() => setSheet('type')} icon={<Pointer className="w-5 h-5" />}>
                유형선택
              </OutlineButton>
            </div>
            <div className="-ml-9">
              <TypeValue
                draft={draft}
                info={p.typeInfo}
                verdict={verdict}
                photoLoading={vision.state === 'loading'}
                hasShots={draft.shots.length >= 2}
                onPick={(t) => p.onEdit('type', t)}
                options={p.options}
              />
            </div>
          </Step>
        )}

        {step === 1 && (
          <Step title="발생지역 확인" sub="사진을 찍은 자리의 주소입니다">
            <div className="flex justify-end">
              <OutlineButton onClick={() => setSheet('place')} icon={<MapPin className="w-5 h-5" />}>
                위치찾기
              </OutlineButton>
            </div>
            <div className="-ml-9">
              <PlaceValue draft={draft} state={p.addressState} onRevert={() => p.onEdit('address', undefined)} />
            </div>
            <div className="mt-5 rounded-lg border border-slate-200 px-3 py-2.5 text-[13px] text-slate-600 space-y-1">
              <p>
                <b className="text-slate-800">적용 규정</b> {describeRules(p.rules)}
              </p>
              {draft.type && (
                <p>
                  {VIOLATION_LABEL[draft.type]} 단속 시간:{' '}
                  {p.rules.types[draft.type].weekday
                    ? `평일 ${p.rules.types[draft.type].weekday!.from}~${p.rules.types[draft.type].weekday!.to}시${
                        p.rules.types[draft.type].weekend === null ? ', 주말 없음' : ''
                      }`
                    : '24시간'}
                </p>
              )}
              {p.rules.local?.extra && <p>이 지역 추가 유형: {p.rules.local.extra.join(', ')}</p>}
              {p.rules.local?.notes && <p>{p.rules.local.notes.join(' · ')}</p>}
              <p className="text-slate-400">
                {p.rules.local ? `출처 ${p.rules.local.region} 누리집 · 확인 ${p.rules.local.checkedAt}` : '출처 정책브리핑(2023-08) 6대 유형 전국 기준'}
              </p>
            </div>
          </Step>
        )}

        {step === 2 && (
          <Step title="차량번호 확인" sub="두 사진에서 따로 읽은 번호가 같을 때만 채웁니다">
            <input
              value={draft.plate ?? ''}
              onChange={(e) => p.onEdit('plate', e.target.value || undefined)}
              placeholder={vision.state === 'loading' ? '번호판을 읽는 중…' : '직접 입력 (예: 12가3456)'}
              className="w-full h-14 px-4 rounded border border-slate-300 bg-slate-100 text-[22px] tabular-nums tracking-wide placeholder:text-[16px] placeholder:tracking-normal placeholder:text-slate-400"
            />
            <PlateNote
              draft={draft}
              vision={vision}
              plateOk={draft.plate ? isValidPlate(draft.plate) : false}
              onUse={(t) => p.onEdit('plate', t)}
            />
          </Step>
        )}

        {step === 3 && (
          <Step title="내용 확인" sub="담당자가 빨리 읽게 항목으로 썼습니다 (5~900자)">
            <textarea
              value={body}
              onChange={(e) => p.onEdit('body', e.target.value.slice(0, BODY_MAX))}
              rows={7}
              className="w-full px-4 py-3 rounded border border-slate-300 bg-slate-100 text-[17px] leading-relaxed"
            />
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className={`px-2 py-0.5 rounded border text-xs font-bold ${SOURCE[manual.body ? 'manual' : 'auto'].cls}`}>
                {SOURCE[manual.body ? 'manual' : 'auto'].text}
              </span>
              <span className="flex items-center gap-3">
                {manual.body && (
                  <button onClick={() => p.onEdit('body', undefined)} className="flex items-center gap-1 text-[15px] text-slate-700">
                    <RotateCcw className="w-4 h-4 text-slate-500" aria-hidden="true" />
                    자동 내용
                  </button>
                )}
                <button onClick={copyBody} className="flex items-center gap-1 text-[15px] text-slate-700">
                  <CopyPlus className="w-5 h-5 text-slate-500" strokeWidth={1.5} aria-hidden="true" />
                  {copied ? '복사됨' : '내용복사'}
                </button>
                <span className="text-[15px] text-slate-500 tabular-nums">
                  {body.length} / {BODY_MAX}
                </span>
              </span>
            </div>
            <div className="mt-6">
              <CheckLine checked={agree} onChange={setAgree} label="신고 내용 공유 동의" />
            </div>
          </Step>
        )}

        {step === last && (
          <Step title="제출 전 점검" sub="빨간불은 고쳐야 제출할 수 있습니다">
            <ul className="rounded-lg border border-slate-200 divide-y divide-slate-100">
              <Summary label="유형" value={draft.type ? VIOLATION_LABEL[draft.type] : '비어 있음'} onFix={() => onStep(0)} />
              <Summary label="발생지역" value={draft.address ?? '비어 있음'} onFix={() => onStep(1)} />
              <Summary label="차량번호" value={draft.plate ?? '비어 있음'} onFix={() => onStep(2)} />
              <Summary label="내용" value={`${body.length}자`} onFix={() => onStep(3)} />
            </ul>
            <p className="mt-4 mb-1 flex items-center gap-3 text-[13px] text-slate-600">
              <span className="flex items-center gap-1"><Light status="pass" />{count('pass')}</span>
              <span className="flex items-center gap-1"><Light status="warn" />{count('warn')}</span>
              <span className="flex items-center gap-1"><Light status="fail" />{count('fail')}</span>
            </p>
            <ul>
              {[...pc.checks]
                .sort((a, b) => rank(a.status) - rank(b.status))
                .map((c) => (
                  <li key={c.id} className="flex gap-2.5 py-2 border-b border-slate-100">
                    <span className="pt-1"><Light status={c.status} /></span>
                    <div className="min-w-0">
                      <p className="text-[15px] font-bold text-slate-900">{c.label}</p>
                      <p className="text-[13px] text-slate-600 leading-snug">{c.detail}</p>
                    </div>
                  </li>
                ))}
            </ul>
            {pc.album.length > 0 && (
              <>
                <p className="mt-4 mb-1 text-[15px] font-bold text-slate-900">앨범 사진 진위 — 항목별</p>
                <ul>
                  {pc.album.map((c) => (
                    <li key={c.id} className="flex gap-2.5 py-2 border-b border-slate-100">
                      <span className="pt-1"><Light status={c.status} /></span>
                      <div className="min-w-0">
                        <p className="text-[15px] font-bold text-slate-900">{c.label}</p>
                        <p className="text-[13px] text-slate-600 leading-snug">{c.detail}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Step>
        )}
      </div>

      {/* 아래 고정 단추 — 이전 / 다음(마지막은 제출) */}
      <div className="shrink-0 bg-white px-1.5 pb-1.5 pt-1 border-t border-slate-100">
        <div className="grid grid-cols-2 gap-1.5">
          {step === 0 ? (
            <button onClick={p.onRetake} className="h-14 rounded bg-slate-400 text-white text-[19px] font-bold">
              다시 찍기
            </button>
          ) : (
            <button onClick={() => onStep(step - 1)} className="h-14 rounded bg-slate-400 text-white text-[19px] font-bold">
              이전
            </button>
          )}
          {step < last ? (
            <button onClick={() => onStep(step + 1)} className="h-14 rounded bg-[#3a8fdb] text-white text-[19px] font-bold">
              다음
            </button>
          ) : (
            <button
              onClick={p.onSubmit}
              disabled={pc.blocked}
              className="h-14 rounded bg-[#3a8fdb] disabled:bg-slate-300 text-white text-[19px] font-bold flex items-center justify-center gap-1.5"
            >
              {pc.blocked ? (
                `빨간불 ${fails}개`
              ) : (
                <>
                  <Check className="w-6 h-6" aria-hidden="true" /> 제출
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {sheet === 'evidence' && vision.result && (
        <EvidenceSheet shots={draft.shots} result={vision.result} onClose={() => setSheet(null)} />
      )}
      {sheet === 'type' && (
        <TypeDialog
          current={draft.type}
          onPick={(t) => {
            p.onEdit('type', t);
            setSheet(null);
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'place' && (
        <PlaceSheet
          draft={draft}
          onPick={(a) => {
            p.onPickAddress(a);
            setSheet(null);
          }}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  );
}

const rank = (s: CheckStatus) => ({ fail: 0, warn: 1, pass: 2 })[s];

function Step({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-[24px] font-bold text-slate-900 leading-snug">{title}</h2>
      {sub && <p className="mt-0.5 mb-4 text-[15px] text-slate-500">{sub}</p>}
      {children}
    </section>
  );
}

function Summary({ label, value, onFix }: { label: string; value: string; onFix: () => void }) {
  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      <span className="w-16 shrink-0 text-[13px] font-bold text-slate-500">{label}</span>
      <span className="flex-1 min-w-0 text-[15px] text-slate-900 truncate">{value}</span>
      <button onClick={onFix} className="shrink-0 text-[13px] font-bold text-blue-700 underline underline-offset-2">
        고치기
      </button>
    </li>
  );
}
