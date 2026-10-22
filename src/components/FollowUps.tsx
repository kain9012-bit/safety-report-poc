import { Camera, Loader2 } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { SharedParkingQuestion, SharedScope, SupplementRequest } from '../lib/followUps';

export interface FollowUpProps {
  supplement?: SupplementRequest;
  supplementBusy?: boolean;
  onSupplement: (file: File, needId: string) => void;
  shared?: SharedParkingQuestion;
  onSharedAnswer: (scope: SharedScope) => void;
  /** 답하지 않고 다음·제출을 누른 횟수 — 0보다 크면 질문을 보여 주고 먼저 답하라고 알린다 */
  sharedNeeded?: number;
}

const SHARED_ANSWERS: [SharedScope, string][] = [
  ['same_bay', '있어요'],
  ['different_bay', '없어요'],
  ['unknown', '모르겠어요'],
];

/**
 * 위반 유형 확인 단계의 후속 질문 — 해당할 때만 한 줄씩 보인다(lib/followUps.ts). 병행주차는 친환경차 유형이면 늘 묻는다.
 * 병행주차 질문은 답해야 다음 단계로 갈 수 있다(ReportSteps). 판독 근거 목록·미확인 표시는 화면에 늘어놓지 않는다.
 */
export default function FollowUps({ supplement, supplementBusy, onSupplement, shared, onSharedAnswer, sharedNeeded = 0 }: FollowUpProps) {
  const sharedRef = useRef<HTMLDivElement>(null);
  const needed = sharedNeeded > 0 && !!shared && shared.answer === undefined;
  useEffect(() => {
    // 다음·제출을 누를 때마다(횟수가 바뀔 때만) 질문으로 옮긴다
    if (needed) sharedRef.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharedNeeded]);
  if (!supplement && !shared) return null;
  return (
    <div className="space-y-2">
      {supplement && (
        <div className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[14px] text-amber-900">
          <p>{supplement.text}</p>
          <label className={`mt-2 inline-flex items-center gap-1.5 h-10 px-3 rounded-lg border border-amber-300 bg-white font-bold ${supplementBusy ? 'opacity-60' : 'cursor-pointer'}`}>
            {supplementBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
            {supplementBusy ? '사진 읽는 중…' : '한 장 더 찍기'}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              disabled={supplementBusy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) onSupplement(file, supplement.id);
              }}
            />
          </label>
        </div>
      )}
      {shared && (
        <div ref={sharedRef} className={`mt-3 rounded border px-3 py-2.5 ${needed ? 'border-red-400 bg-red-50' : 'border-slate-200'}`}>
          <p className="text-[14px] font-bold text-slate-800">이 칸에 일반 자동차도 주차할 수 있다는 안내가 있나요?</p>
          {needed && (
            <p role="alert" className="mt-0.5 text-[13px] font-bold text-red-700">
              먼저 답해 주세요. 답해야 다음 단계로 넘어갈 수 있어요.
            </p>
          )}
          <p className="mt-0.5 text-[13px] text-slate-500 leading-snug">
            {shared.notice
              ? '사진에 그런 안내가 보이는 것 같아요. 이 차가 있는 칸에 해당하는지 확인해 주세요.'
              : '친환경차 충전구역 중에는 표지판이나 바닥 글씨로 일반 자동차도 세울 수 있다고 안내하는 칸이 있어요. 있으면 신고 대상이 아닐 수 있어요.'}
          </p>
          <div className="mt-2 flex gap-2" role="group" aria-label="일반 자동차 주차 안내">
            {SHARED_ANSWERS.map(([scope, label]) => (
              <button
                key={scope}
                onClick={() => onSharedAnswer(scope)}
                aria-pressed={shared.answer === scope}
                className={`h-10 px-3 rounded-lg border text-[14px] font-bold ${shared.answer === scope ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-slate-300 text-slate-700'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
