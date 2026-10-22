import type { SharedParkingQuestion, SharedScope } from '../lib/followUps';

export interface FollowUpProps {
  shared?: SharedParkingQuestion;
  onSharedAnswer: (scope: SharedScope) => void;
}

const SHARED_ANSWERS: [SharedScope, string][] = [
  ['same_bay', '있어요'],
  ['different_bay', '없어요'],
  ['unknown', '모르겠어요'],
];

/**
 * 위반 유형 확인 단계의 후속 질문 — 해당할 때만 보인다(lib/followUps.ts). 병행주차는 친환경차 유형이면 늘 묻는다.
 * 답하지 않아도 다음 단계로 갈 수 있다(점검에 노란불로 남는다).
 */
export default function FollowUps({ shared, onSharedAnswer }: FollowUpProps) {
  if (!shared) return null;
  return (
    <div className="mt-3 rounded border border-slate-200 px-3 py-2.5">
      <p className="text-[14px] font-bold text-slate-800">이 칸에 일반 자동차도 주차할 수 있다는 안내가 있나요?</p>
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
  );
}
