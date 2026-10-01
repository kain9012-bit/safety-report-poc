import { useEffect, useState } from 'react';
import { clearDraft, loadDraft } from './lib/draft';
import { reverseGeocode } from './lib/reverseGeocode';
import type { AddressState } from './lib/reverseGeocode';
import { PhoneFrame, ProtoNotice } from './components/Ui';
import CaptureScreen from './components/CaptureScreen';
import ReportForm from './components/ReportForm';
import type { PickedAddress } from './components/ReportForm';
import { locatedShot } from './types/report';
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
  const [addressState, setAddressState] = useState<AddressState>('idle');

  // 요구사항 R7 — 앱을 껐다 켜도 찍던 사진이 남아 있다.
  useEffect(() => {
    void loadDraft().then((d) => {
      if (d && d.shots.length > 0) setDraft((prev) => ({ ...prev, shots: d.shots }));
    });
  }, []);

  // 사진 좌표 → 발생지역. 사람이 직접 고친 주소는 덮어쓰지 않는다.
  const first = locatedShot(draft.shots);
  const manualAddress = Boolean(draft.manual?.address);
  useEffect(() => {
    if (!first || first.lat === undefined || first.lng === undefined || manualAddress) {
      setAddressState('idle');
      return;
    }
    let stale = false;
    setAddressState('loading');
    setDraft((prev) => ({ ...prev, address: undefined, addressParcel: undefined }));
    void reverseGeocode(first.lat, first.lng).then((r) => {
      if (stale) return;
      setAddressState(r.state);
      if (r.state === 'ok') {
        setDraft((prev) =>
          prev.manual?.address
            ? prev
            : { ...prev, address: r.road ?? r.parcel, addressParcel: r.road ? r.parcel : undefined },
        );
      }
    });
    return () => {
      stale = true;
    };
    // 첫 컷이 바뀌거나, 직접 입력을 되돌렸을 때만 다시 찾는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [first?.takenAt, manualAddress]);

  const onCaptured = (shots: Shot[]) => {
    setDraft((prev) => ({ ...prev, shots }));
    setStep('form');
  };

  const onEdit = (field: EditableField, value: string | undefined) => {
    setDraft((prev) => ({
      ...prev,
      [field]: value,
      ...(field === 'address' ? { addressParcel: undefined, addressFrom: undefined } : {}),
      manual: { ...prev.manual, [field]: value !== undefined },
    }));
  };

  const onPickAddress = (a: PickedAddress) => {
    setDraft((prev) => ({
      ...prev,
      address: a.address,
      addressParcel: a.parcel,
      addressFrom: a.from,
      manual: { ...prev.manual, address: true },
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
            addressState={addressState}
            onCapture={() => setStep('capture')}
            onEdit={onEdit}
            onPickAddress={onPickAddress}
            onReset={onReset}
          />
        ) : (
          <CaptureScreen onComplete={onCaptured} onCancel={onCaptured} />
        )}
      </PhoneFrame>
    </div>
  );
}
