import { useState } from 'react';
import { FileText, Info } from 'lucide-react';
import { EmptyState, PhoneFrame, ProtoNotice } from './components/Ui';
import CaptureScreen from './components/CaptureScreen';
import type { Shot } from './types/report';

type Step = 'capture' | 'review';

export default function App() {
  const [step, setStep] = useState<Step>('capture');
  const [shots, setShots] = useState<Shot[]>([]);
  const [why, setWhy] = useState(false);

  return (
    <div className="min-h-screen overflow-x-clip bg-slate-100 text-slate-800 font-sans antialiased selection:bg-blue-600 selection:text-white">
      <PhoneFrame>
        <ProtoNotice />

        {/* 요구사항 R5 — 앱을 켜면 곧 촬영. 유형 선택은 찍은 뒤로 미룬다. */}
        {step === 'capture' && (
          <CaptureScreen
            onComplete={(s) => {
              setShots(s);
              setStep('review');
            }}
          />
        )}

        {step === 'review' && (
          <main className="flex-1 p-4 space-y-4">
            <EmptyState
              icon={<FileText className="w-6 h-6" aria-hidden="true" />}
              title="신고서 자동작성은 아직 붙이지 않았습니다"
              desc="사진 두 장과 촬영시각·좌표는 받아 두었습니다. 주소 변환과 유형 추천, 번호판 판독을 붙이면 이 화면이 채워집니다. 없는 값을 지어내 보여주지 않습니다."
            >
              <button
                onClick={() => setStep('capture')}
                className="px-4 py-2 rounded-lg border border-slate-300 hover:border-blue-600 hover:text-blue-700 font-bold text-sm transition-colors"
              >
                촬영으로 돌아가기
              </button>
            </EmptyState>

            <div className="bg-white rounded-lg border border-slate-200 p-4 space-y-2">
              <p className="text-sm font-bold text-slate-900">지금 확보된 값</p>
              {shots.map((s, i) => (
                <div key={i} className="text-sm text-slate-600 tabular-nums">
                  {i + 1}번째 — {new Date(s.takenAt).toLocaleString('ko-KR')}
                  {s.lat !== undefined
                    ? ` · ${s.lat.toFixed(5)}, ${s.lng?.toFixed(5)} (±${Math.round(s.accuracy ?? 0)}m)`
                    : ' · 위치 없음'}
                </div>
              ))}
            </div>
          </main>
        )}

        {/* 왜 이렇게 바꿨는지 — 시연을 보는 사람이 근거를 바로 볼 수 있게 */}
        <div className="border-t border-slate-200">
          <button
            onClick={() => setWhy((v) => !v)}
            className="w-full px-4 py-3 flex items-center gap-2 text-sm font-bold text-slate-600 hover:text-blue-700 transition-colors"
          >
            <Info className="w-4 h-4" aria-hidden="true" />
            이 화면이 바꾸는 것
          </button>
          {why && (
            <div className="px-4 pb-4 space-y-2 text-sm text-slate-600">
              <p>
                <b className="text-slate-900">앱을 켜면 곧 촬영</b> — 지금은 팝업을 닫고 유형을 고른
                뒤에야 카메라가 열립니다. 그 사이 차가 떠납니다. (리뷰 13건)
              </p>
              <p>
                <b className="text-slate-900">60초를 앱이 대신 기다립니다</b> — 촬영 시각으로 세기
                때문에 앱을 나가도 카운트가 멈추지 않습니다. 차 옆에 서 있을 이유가 없습니다.
                (리뷰 22건)
              </p>
              <p>
                <b className="text-slate-900">첫 컷을 겹쳐 보여줍니다</b> — 같은 구도로 찍게 해
                '사진 구도·방향 불일치' 반려를 줄입니다.
              </p>
              <p>
                <b className="text-slate-900">촬영시각과 좌표를 사진에 박습니다</b> — '촬영시각
                미표시'와 '위치 특정 불가'는 흔한 반려 사유입니다.
              </p>
              <p className="text-xs text-slate-500 pt-1">
                근거: 2026년 구글플레이 리뷰 655건 분류 결과 (저장소 docs/painpoints.md)
              </p>
            </div>
          )}
        </div>

        <footer className="bg-slate-900 text-slate-300 px-4 py-4 text-xs shrink-0">
          <p className="font-bold text-white">주정차 신고 자동작성 시제품</p>
          <p className="mt-1 text-slate-400">
            국민제안 준비용 비공식 시제품입니다. 실제 신고는 안전신문고 앱을 이용하세요.
          </p>
        </footer>
      </PhoneFrame>
    </div>
  );
}
