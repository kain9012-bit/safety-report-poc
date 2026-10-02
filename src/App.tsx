import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { deleteReport, listReports, newId, pickResume, saveReport } from './lib/reports';
import type { ReportRecord } from './lib/reports';
import { reverseGeocode } from './lib/reverseGeocode';
import type { AddressState } from './lib/reverseGeocode';
import { loadNearby } from './lib/facilities';
import { recommend } from './lib/recommend';
import { crosscheck } from './lib/crosscheck';
import { readOne } from './lib/vision';
import type { VisionState } from './lib/vision';
import { compareShots } from './lib/overlap';
import { rulesFor } from './lib/localRules';
import { rankTypes } from './lib/choose';
import { mergeReads } from '../api/vision';
import { PLATE_CONFIDENCE_FLOOR, isValidPlate } from './lib/rules';
import { PhoneFrame, ProtoNotice } from './components/Ui';
import StartScreen from './components/StartScreen';
import CaptureFlow from './components/CaptureFlow';
import ReportSteps from './components/ReportSteps';
import type { PickedAddress, TypeInfo } from './components/FormParts';
import { locatedShot } from './types/report';
import type { DraftReport, EditableField, Shot, ViolationType } from './types/report';

type Screen = 'loading' | 'home' | 'capture' | 'form';

const EMPTY: DraftReport = { shots: [] };
const NO_TYPE: TypeInfo = { state: 'idle', candidates: [], missing: [], coverage: {} };

const statesOf = (d: DraftReport): (VisionState | undefined)[] =>
  d.shots.map((_, i) => (d.reads?.[i] === undefined ? undefined : d.reads[i] ? 'ok' : 'error'));

/**
 * 흐름(회의 결정)
 *   처음 화면 → 촬영(첫 사진 즉시 판독 → 남은 시간 → 둘째 사진 → 같은 자리·같은 번호판 확인)
 *   → 신고서 단계별 확인(유형 · 발생지역 · 차량번호 · 내용 · 점검·제출)
 * 진행 상태는 바뀔 때마다 기기에 저장한다 — 앱을 바꾸거나 꺼도 하던 신고부터 다시 시작한다.
 */
export default function App() {
  const [screen, setScreen] = useState<Screen>('loading');
  const [rec, setRec] = useState<ReportRecord | null>(null);
  const [reports, setReports] = useState<ReportRecord[]>([]);
  const [readStates, setReadStates] = useState<(VisionState | undefined)[]>([]);
  const [addressState, setAddressState] = useState<AddressState>('idle');
  const [typeInfo, setTypeInfo] = useState<TypeInfo>(NO_TYPE);
  const [albumState, setAlbumState] = useState<'idle' | 'busy' | 'error'>('idle');
  const [toast, setToast] = useState<string | null>(null);

  const draft = rec?.draft ?? EMPTY;
  const setDraft = useCallback((fn: (d: DraftReport) => DraftReport) => {
    setRec((r) => (r ? { ...r, draft: fn(r.draft) } : r));
  }, []);

  const refresh = useCallback(() => listReports().then(setReports), []);

  // 앱을 열면 — 하던 신고가 있으면 바로 그 자리로
  const geoKey = useRef<number | undefined>(undefined);
  const open = useCallback((r: ReportRecord) => {
    setRec(r);
    setReadStates(statesOf(r.draft));
    const at = locatedShot(r.draft.shots);
    geoKey.current = r.draft.address && at ? at.takenAt : undefined;
    setScreen(r.phase === 'capture' ? 'capture' : 'form');
  }, []);
  useEffect(() => {
    void listReports().then((list) => {
      setReports(list);
      const r = pickResume(list);
      if (r) open(r);
      else setScreen('home');
    });
  }, [open]);

  // 바뀔 때마다 저장(0.3초 모아서)
  useEffect(() => {
    if (!rec || rec.draft.shots.length === 0) return;
    const t = setTimeout(() => void saveReport(rec), 300);
    return () => clearTimeout(t);
  }, [rec]);

  // 사진마다 판독 — 첫 사진은 찍자마자, 둘째 사진도 찍자마자. 한 장씩 따로 읽는다.
  const inflight = useRef(new Set<number>());
  useEffect(() => {
    draft.shots.forEach((s, i) => {
      if (draft.reads?.[i] !== undefined || inflight.current.has(s.takenAt)) return;
      inflight.current.add(s.takenAt);
      setReadStates((st) => Object.assign([...st], { [i]: 'loading' }));
      void readOne(s.dataUrl).then((r) => {
        inflight.current.delete(s.takenAt);
        setDraft((d) => {
          if (d.shots[i]?.takenAt !== s.takenAt) return d; // 그사이 다시 찍었다
          const reads = [...(d.reads ?? [])];
          reads[i] = r.read ?? null;
          return { ...d, reads, model: r.model ?? d.model };
        });
        setReadStates((st) => Object.assign([...st], { [i]: r.state }));
      });
    });
  }, [draft.shots, draft.reads, setDraft]);

  // 두 사진 겹침 — 규칙 기반 영상 대조
  const ovKey = useRef('');
  useEffect(() => {
    const [a, b] = draft.shots;
    if (!a || !b || draft.overlap) return;
    const key = `${a.takenAt}-${b.takenAt}`;
    if (ovKey.current === key) return;
    ovKey.current = key;
    void compareShots(a.dataUrl, b.dataUrl).then((o) => {
      setDraft((d) =>
        d.shots[0]?.takenAt === a.takenAt && d.shots[1]?.takenAt === b.takenAt
          ? { ...d, overlap: o ? { ratio: o.ratio, score: o.score, same: o.same } : { ratio: 0, score: -1, same: false } }
          : d,
      );
    });
  }, [draft.shots, draft.overlap, setDraft]);

  // 사진 좌표 → 발생지역. 사람이 고친 주소는 덮어쓰지 않는다.
  const located = locatedShot(draft.shots);
  const manualAddress = Boolean(draft.manual?.address);
  useEffect(() => {
    if (!located || manualAddress) {
      setAddressState('idle');
      return;
    }
    if (geoKey.current === located.takenAt) {
      setAddressState('ok');
      return;
    }
    let stale = false;
    setAddressState('loading');
    void reverseGeocode(located.lat!, located.lng!).then((r) => {
      if (stale) return;
      geoKey.current = located.takenAt;
      setAddressState(r.state);
      if (r.state === 'ok') {
        setDraft((d) => (d.manual?.address ? d : { ...d, address: r.road ?? r.parcel, addressParcel: r.road ? r.parcel : undefined }));
      }
    });
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [located?.takenAt, manualAddress]);

  // 사진 좌표 → 주변 시설(참고용 '의심')
  useEffect(() => {
    if (!located) {
      setTypeInfo(NO_TYPE);
      return;
    }
    let stale = false;
    const at = { lat: located.lat!, lng: located.lng!, accuracy: located.accuracy };
    setTypeInfo({ ...NO_TYPE, state: 'loading' });
    void loadNearby(at).then((n) => {
      if (stale) return;
      setTypeInfo({
        state: n.state,
        candidates: recommend(at, n),
        missing: n.missing,
        coverage: { busstop: n.busstops.length > 0, crossing: n.crosswalks.length > 0, schoolzone: n.schools.length > 0 },
      });
    });
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [located?.takenAt]);

  // 판독 합본(읽힌 장만) → 유형 판정(사진 증거)
  const merged = useMemo(() => {
    const reads = (draft.reads ?? []).map((r) => r ?? null);
    return reads.some(Boolean) ? mergeReads(reads, draft.model ?? '') ?? undefined : undefined;
  }, [draft.reads, draft.model]);
  const verdict = useMemo(() => crosscheck(typeInfo.candidates, typeInfo.coverage, merged), [typeInfo, merged]);
  const rules = useMemo(() => rulesFor(draft.address), [draft.address]);
  const options = useMemo(() => {
    if (!verdict.type || !draft.shots[0]) return [];
    return rankTypes([verdict.type, ...verdict.alternatives], { takenAt: draft.shots[0].takenAt, rules, candidates: typeInfo.candidates });
  }, [verdict, rules, typeInfo.candidates, draft.shots]);

  useEffect(() => {
    setDraft((d) => (d.manual?.type || d.type === verdict.type ? d : { ...d, type: verdict.type }));
  }, [verdict, setDraft]);

  // 번호판 — 두 장에서 따로 읽은 값이 같고, 확신이 높고, 형식이 맞을 때만 채운다
  useEffect(() => {
    const pl = merged?.plate;
    const ok = pl && pl.agree === true && pl.confidence >= PLATE_CONFIDENCE_FLOOR && isValidPlate(pl.text);
    setDraft((d) => (d.manual?.plate || d.plate === (ok ? pl!.text : undefined) ? d : { ...d, plate: ok ? pl!.text : undefined }));
  }, [merged, setDraft]);

  const visionState: VisionState = readStates.some((s) => s === 'loading')
    ? 'loading'
    : merged
      ? 'ok'
      : (readStates.find((s) => s && s !== 'ok') ?? 'idle');

  /* ---------------- 동작 ---------------- */

  const startNew = () => {
    const t = Date.now();
    setRec({ id: newId(t), draft: { shots: [] }, phase: 'capture', step: 0, createdAt: t, updatedAt: t });
    setReadStates([]);
    geoKey.current = undefined;
    setScreen('capture');
  };

  const goHome = () => {
    if (rec && rec.draft.shots.length > 0) void saveReport(rec).then(refresh);
    else void refresh();
    setScreen('home');
  };

  const onEdit = (field: EditableField, value: string | undefined) =>
    setDraft((d) => ({
      ...d,
      [field]: value,
      ...(field === 'address' ? { addressParcel: undefined, addressFrom: undefined } : {}),
      manual: { ...d.manual, [field]: value !== undefined },
    }));

  const onPickAddress = (a: PickedAddress) =>
    setDraft((d) => ({ ...d, address: a.address, addressParcel: a.parcel, addressFrom: a.from, manual: { ...d.manual, address: true } }));

  const onShot = (s: Shot) => setDraft((d) => ({ ...d, shots: [...d.shots, s].slice(0, 2) }));

  const retakeFirst = () => {
    geoKey.current = undefined;
    setReadStates([]);
    setDraft(() => ({ shots: [] }));
    setRec((r) => (r ? { ...r, phase: 'capture', step: 0 } : r));
    setScreen('capture');
  };
  const retakeSecond = () => {
    setReadStates((st) => st.slice(0, 1));
    setDraft((d) => ({ ...d, shots: d.shots.slice(0, 1), reads: (d.reads ?? []).slice(0, 1), overlap: undefined, firstOk: true }));
    setRec((r) => (r ? { ...r, phase: 'capture' } : r));
    setScreen('capture');
  };
  const retryRead = (i: number) =>
    setDraft((d) => {
      const reads = [...(d.reads ?? [])];
      reads[i] = undefined as never;
      return { ...d, reads };
    });

  const onAlbum = (files: File[]) => {
    setAlbumState('busy');
    void import('./lib/album')
      .then(({ readAlbum }) => readAlbum(files))
      .then((shots) => {
        const t = Date.now();
        setRec({ id: newId(t), draft: { shots, firstOk: true }, phase: 'form', step: 0, createdAt: t, updatedAt: t });
        setReadStates([]);
        geoKey.current = undefined;
        setAlbumState('idle');
        setScreen('form');
      })
      .catch(() => setAlbumState('error'));
  };

  const onSubmit = () => {
    if (!rec) return;
    const done: ReportRecord = { ...rec, phase: 'submitted' };
    setRec(done);
    void saveReport(done).then(refresh);
    setToast('시제품이라 접수되지 않습니다 — 제출한 신고에 남겼습니다');
    setTimeout(() => setToast(null), 2500);
    setScreen('home');
  };

  return (
    <div className="bg-slate-100 text-slate-800 font-sans antialiased selection:bg-blue-600 selection:text-white">
      <PhoneFrame>
        <ProtoNotice />

        {screen === 'loading' && <div className="flex-1" />}

        {screen === 'home' && (
          <StartScreen
            reports={reports}
            onCamera={startNew}
            onAlbum={onAlbum}
            albumState={albumState}
            onResume={open}
            onDelete={(id) => {
              void deleteReport(id).then(refresh);
              if (rec?.id === id) setRec(null);
            }}
          />
        )}

        {screen === 'capture' && rec && (
          <CaptureFlow
            draft={draft}
            readStates={readStates}
            vision={merged}
            verdict={verdict}
            options={options}
            onShot={onShot}
            onRetakeFirst={retakeFirst}
            onRetakeSecond={retakeSecond}
            onAcceptFirst={() => setDraft((d) => ({ ...d, firstOk: true }))}
            onChooseType={(t: ViolationType) => onEdit('type', t)}
            onRetryRead={retryRead}
            onDone={() => {
              setRec((r) => (r ? { ...r, phase: 'form', step: 0 } : r));
              setScreen('form');
            }}
            onExit={goHome}
          />
        )}

        {screen === 'form' && rec && (
          <ReportSteps
            draft={draft}
            step={rec.step}
            onStep={(n) => setRec((r) => (r ? { ...r, step: n } : r))}
            addressState={addressState}
            typeInfo={typeInfo}
            vision={{ state: visionState, result: merged }}
            verdict={verdict}
            options={options}
            rules={rules}
            onRetryVision={() => draft.reads?.forEach((r, i) => r === null && retryRead(i))}
            onEdit={onEdit}
            onPickAddress={onPickAddress}
            onRetake={retakeSecond}
            onHome={goHome}
            onSubmit={onSubmit}
          />
        )}

        {toast && (
          <div role="status" className="absolute bottom-24 inset-x-6 z-40 rounded-lg bg-slate-900/90 text-white text-center text-[15px] font-bold py-3 px-3">
            {toast}
          </div>
        )}
      </PhoneFrame>
    </div>
  );
}
