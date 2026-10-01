import { useEffect, useMemo, useState } from 'react';
import { clearDraft, loadDraft } from './lib/draft';
import { reverseGeocode } from './lib/reverseGeocode';
import { loadNearby } from './lib/facilities';
import { recommend } from './lib/recommend';
import { crosscheck } from './lib/crosscheck';
import { readPhotos } from './lib/vision';
import type { VisionState } from './lib/vision';
import type { VisionResult } from '../api/vision';
import { PLATE_CONFIDENCE_FLOOR, isValidPlate } from './lib/rules';
import type { AddressState } from './lib/reverseGeocode';
import { PhoneFrame, ProtoNotice } from './components/Ui';
import CaptureScreen from './components/CaptureScreen';
import ReportForm from './components/ReportForm';
import type { PickedAddress, TypeInfo } from './components/ReportForm';
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
  const [typeInfo, setTypeInfo] = useState<TypeInfo>({ state: 'idle', candidates: [], missing: [], coverage: {} });
  const [vision, setVision] = useState<{ state: VisionState; result?: VisionResult }>({ state: 'idle' });
  const [visionTry, setVisionTry] = useState(0);

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

  // 사진 좌표 → 주변 시설 → 위반유형 추천. 사람이 고른 유형은 덮어쓰지 않는다.
  useEffect(() => {
    if (!first || first.lat === undefined || first.lng === undefined) {
      setTypeInfo({ state: 'idle', candidates: [], missing: [], coverage: {} });
      return;
    }
    let stale = false;
    const at = { lat: first.lat, lng: first.lng, accuracy: first.accuracy };
    setTypeInfo({ state: 'loading', candidates: [], missing: [], coverage: {} });
    void loadNearby(at).then((n) => {
      if (stale) return;
      const candidates = recommend(at, n);
      // 이 자리에 그 유형을 가늠할 공공 위치자료가 있는가 — 없으면 사진 판단과 '엇갈림'으로 보지 않는다
      const coverage = {
        busstop: n.busstops.length > 0,
        crossing: n.crosswalks.length > 0,
        schoolzone: n.schools.length > 0,
      };
      setTypeInfo({ state: n.state, candidates, missing: n.missing, coverage });
    });
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [first?.takenAt]);

  // 사진 두 장 → 판독(번호판·장면). 같은 사진으로는 한 번만 부른다.
  const pairKey = draft.shots.length >= 2 ? `${draft.shots[0].takenAt}-${draft.shots[1].takenAt}` : '';
  useEffect(() => {
    if (!pairKey) {
      setVision({ state: 'idle' });
      return;
    }
    let stale = false;
    setVision({ state: 'loading' });
    // 사진이 바뀌었으니 전에 자동으로 채운 번호는 지운다
    setDraft((prev) => (prev.manual?.plate ? prev : { ...prev, plate: undefined }));
    void readPhotos(draft.shots.map((s) => s.dataUrl)).then((r) => {
      if (stale) return;
      setVision(r);
      // 번호판 — 읽었고, 확신이 높고, 형식이 맞을 때만 채운다. 사람이 친 값은 덮지 않는다.
      const p = r.result?.plate;
      if (p && p.readable && p.confidence >= PLATE_CONFIDENCE_FLOOR && isValidPlate(p.text)) {
        setDraft((prev) => (prev.manual?.plate ? prev : { ...prev, plate: p.text }));
      }
    });
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairKey, visionTry]);

  // 좌표 추천 × 사진 판독 → 위반유형. 사람이 고른 유형은 덮어쓰지 않는다.
  const verdict = useMemo(
    () => crosscheck(typeInfo.candidates, typeInfo.coverage, vision.result),
    [typeInfo, vision.result],
  );
  useEffect(() => {
    setDraft((prev) => (prev.manual?.type || prev.type === verdict.type ? prev : { ...prev, type: verdict.type }));
  }, [verdict]);

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
            typeInfo={typeInfo}
            vision={vision}
            verdict={verdict}
            onRetryVision={() => setVisionTry((n) => n + 1)}
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
