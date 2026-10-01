import { useEffect, useState } from 'react';
import { clearDraft, loadDraft } from './lib/draft';
import { PhoneFrame, ProtoNotice } from './components/Ui';
import CaptureScreen from './components/CaptureScreen';
import ReportForm from './components/ReportForm';
import type { DraftReport, EditableField, Shot } from './types/report';

type Step = 'form' | 'capture';

/**
 * 첫 화면은 **지금 안전신문고와 같은 신고서**다. 칸을 바꾸지 않았다.
 * 바꾼 것은 둘뿐이다 — 사진이 맨 위로 오고, 나머지 칸은 사진에서 채워진다.
 *
 * 촬영은 전체 화면으로 잠깐 열렸다 닫히는 단계로 둔다(요구사항 R5).
 * 길에서 쓰는 화면이라 스크롤이 없어야 하기 때문이다.
 */
export default function App() {
  const [step, setStep] = useState<Step>('form');
  const [draft, setDraft] = useState<DraftReport>({ shots: [] });

  // 요구사항 R7 — 앱을 껐다 켜도 찍던 사진이 남아 있다.
  useEffect(() => {
    void loadDraft().then((d) => {
      if (d && d.shots.length > 0) setDraft((prev) => ({ ...prev, shots: d.shots }));
    });
  }, []);

  const onCaptured = (shots: Shot[]) => {
    // 사진이 들어오는 순간 발생일시·좌표가 함께 들어오고, 내용 문장은 그걸로 다시 만들어진다.
    // 주소 변환·유형 추천·번호판 판독은 아직 붙이지 않았으므로 비워 둔다 — 없는 값을 지어내지 않는다.
    setDraft((prev) => ({ ...prev, shots }));
    setStep('form');
  };

  const onEdit = (field: EditableField, value: string | undefined) => {
    setDraft((prev) => ({
      ...prev,
      [field]: value,
      manual: { ...prev.manual, [field]: value !== undefined },
    }));
  };

  const onReset = () => {
    setDraft({ shots: [] });
    void clearDraft();
  };

  return (
    <div className="bg-slate-100 text-slate-800 font-sans antialiased selection:bg-blue-600 selection:text-white">
      <PhoneFrame>
        <ProtoNotice />

        {step === 'form' ? (
          <ReportForm
            draft={draft}
            onCapture={() => setStep('capture')}
            onEdit={onEdit}
            onReset={onReset}
          />
        ) : (
          <CaptureScreen onComplete={onCaptured} onCancel={() => setStep('form')} />
        )}
      </PhoneFrame>
    </div>
  );
}
