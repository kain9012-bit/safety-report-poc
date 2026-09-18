import { useState } from 'react';
import { Camera, FileText, MapPin, ShieldAlert } from 'lucide-react';
import { EmptyState, PhoneFrame, ProtoNotice } from './components/Ui';
import type { DraftReport } from './types/report';

type Step = 'intro' | 'capture' | 'review';

export default function App() {
  const [step, setStep] = useState<Step>('intro');
  const [draft] = useState<DraftReport>({ shots: [] });

  return (
    <div className="min-h-screen overflow-x-clip bg-slate-100 text-slate-800 font-sans antialiased selection:bg-blue-600 selection:text-white">
      <PhoneFrame>
        <ProtoNotice />

        <header className="px-4 py-3 border-b border-slate-200 flex items-center gap-2 shrink-0">
          <div className="w-9 h-9 rounded-lg bg-blue-600 text-white flex items-center justify-center shrink-0">
            <ShieldAlert className="w-5 h-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="font-bold text-slate-900 leading-tight">주정차 신고 자동작성</p>
            <p className="text-xs text-slate-500 leading-tight">안전신문고 개선 제안 시제품</p>
          </div>
        </header>

        <main className="flex-1 p-4 space-y-4">
          {step === 'intro' && (
            <>
              <div className="rounded-lg bg-blue-50 border border-blue-100 p-5 space-y-2">
                <h1 className="text-2xl font-bold text-slate-900 leading-snug">
                  사진만 찍으면
                  <br />
                  <span className="text-blue-700">신고서가 채워집니다</span>
                </h1>
                <p className="text-sm text-slate-600">
                  발생일시·주소·위반유형·차량번호는 사진 안에 이미 들어 있습니다. 국민이 다시
                  적을 이유가 없습니다.
                </p>
              </div>

              <ul className="space-y-2">
                {[
                  { icon: Camera, t: '1분 간격 두 장', d: '카운트다운과 첫 컷 겹쳐보기로 같은 구도를 잡아 줍니다' },
                  { icon: MapPin, t: '위치로 유형 판정', d: '소화전·횡단보도·버스정류소·어린이보호구역까지의 거리를 재서 후보를 냅니다' },
                  { icon: FileText, t: '신고서 자동작성', d: '판독 결과와 위치 계산이 맞아떨어질 때만 자동 확정합니다' },
                ].map(({ icon: Icon, t, d }) => (
                  <li key={t} className="bg-white rounded-lg border border-slate-200 p-4 flex gap-3">
                    <Icon className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" aria-hidden="true" />
                    <div>
                      <p className="font-bold text-sm text-slate-900">{t}</p>
                      <p className="text-sm text-slate-600">{d}</p>
                    </div>
                  </li>
                ))}
              </ul>

              <button
                onClick={() => setStep('capture')}
                className="w-full py-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold text-base transition-colors"
              >
                신고 시작
              </button>
            </>
          )}

          {step === 'capture' && (
            <EmptyState
              icon={<Camera className="w-6 h-6" aria-hidden="true" />}
              title="촬영 화면은 아직 만드는 중입니다"
              desc="60초 카운트다운과 첫 컷 겹쳐보기가 여기 들어갑니다."
            >
              <button
                onClick={() => setStep('review')}
                className="px-4 py-2 rounded-lg border border-slate-300 hover:border-blue-600 hover:text-blue-700 font-bold text-sm transition-colors"
              >
                다음 화면 보기
              </button>
            </EmptyState>
          )}

          {step === 'review' && (
            <EmptyState
              icon={<FileText className="w-6 h-6" aria-hidden="true" />}
              title="자동작성 결과를 보여줄 수 없습니다"
              desc={
                draft.shots.length === 0
                  ? '사진이 없고, 주소·유형·번호판을 알아낼 열쇠(공공데이터·판독 API)도 아직 연결되지 않았습니다. 없는 값을 지어내 채우지 않습니다.'
                  : undefined
              }
            >
              <button
                onClick={() => setStep('intro')}
                className="px-4 py-2 rounded-lg border border-slate-300 hover:border-blue-600 hover:text-blue-700 font-bold text-sm transition-colors"
              >
                처음으로
              </button>
            </EmptyState>
          )}
        </main>

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
