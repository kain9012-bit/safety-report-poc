import { Camera, Loader2 } from 'lucide-react';
import type { SharedParkingQuestion, SharedScope, SupplementRequest } from '../lib/followUps';

export interface FollowUpProps {
  supplement?: SupplementRequest;
  supplementBusy?: boolean;
  onSupplement: (file: File, needId: string) => void;
  shared?: SharedParkingQuestion;
  onSharedAnswer: (scope: SharedScope) => void;
}

const SHARED_ANSWERS: [SharedScope, string][] = [
  ['same_bay', '있어요'],
  ['different_bay', '없어요'],
  ['unknown', '모르겠어요'],
];

/**
 * 위반 유형 확인 단계의 후속 질문 — 해당할 때만 한 줄씩 보인다(lib/followUps.ts).
 * 답하지 않아도 다음 단계로 갈 수 있다. 판독 근거 목록·미확인 표시는 화면에 늘어놓지 않는다.
 */
export default function FollowUps({ supplement, supplementBusy, onSupplement, shared, onSharedAnswer }: FollowUpProps) {
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
        <div className="mt-3 rounded border border-slate-200 px-3 py-2.5">
          <p className="text-[14px] font-bold text-slate-800">이 칸에 일반 자동차도 주차할 수 있다는 안내가 있나요?</p>
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
