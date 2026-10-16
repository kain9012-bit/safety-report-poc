import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { deleteReport, listReports, measure, newId, pickResume, saveReport } from './lib/reports';
import type { ReportRecord } from './lib/reports';
import { composeBody } from './lib/compose';
import { precheck } from './lib/precheck';
import { cameraDraft, removePhoto, replacePhoto, replacementDraft } from './lib/replacement';
import { reverseGeocode } from './lib/reverseGeocode';
import type { AddressState } from './lib/reverseGeocode';
import { loadNearby } from './lib/facilities';
import { recommend } from './lib/recommend';
import { crosscheck } from './lib/crosscheck';
import { readOne } from './lib/vision';
import { RATE_LIMIT_RETRY_MS } from './lib/vision';
import type { VisionState } from './lib/vision';
import { compareShots } from './lib/overlap';
import { rulesFor } from './lib/localRules';
import { rankTypes } from './lib/choose';
import { mergeReads } from '../api/vision';
import { PLATE_CONFIDENCE_FLOOR, isValidPlate } from './lib/rules';
import { BuildBadge, PhoneFrame, ProtoNotice } from './components/Ui';
import StartScreen from './components/StartScreen';
import CaptureFlow from './components/CaptureFlow';
import ReportSteps from './components/ReportSteps';
import type { PickedAddress, TypeInfo } from './components/FormParts';
import { activeLocatedShot, appendPhoto, normalizeDraft, primaryFirst, primaryReads, primaryShots, reviewedReads } from './lib/photoEvidence';
import { answerSharedParking, sharedParkingQuestion, supplementRequest } from './lib/followUps';
import type { SharedScope } from './lib/followUps';
import type { DraftReport, EditableField, Shot, ViolationType } from './types/report';

type Screen = 'loading' | 'home' | 'capture' | 'form';

const EMPTY: DraftReport = { shots: [] };
const NO_TYPE: TypeInfo = { state: 'idle', candidates: [], missing: [], coverage: {} };

const statesOf = (d: DraftReport): (VisionState | undefined)[] =>
  d.shots.map((_, i) => (d.reads?.[i] === undefined ? undefined : d.reads[i] ? 'ok' : 'error'));

/**
 * 흐름(회의 결정)
 *   처음 화면 → 촬영(첫 번째 사진 즉시 판독 → 남은 시간 → 두 번째 사진 → 같은 자리·같은 번호판 확인)
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
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const saved = useRef<ReportRecord | null>(null);
  const autoPaused = useRef(false);
  const navigation = useRef(0);
  const current = useRef(rec);
  current.current = rec;
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [storageError, setStorageError] = useState<{ text: string; retry: () => void } | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [replacement, setReplacement] = useState<ReportRecord | null>(null);
  const replacementRef = useRef(replacement);
  replacementRef.current = replacement;
  const [toast, setToast] = useState<string | null>(null);

  const draft = rec?.draft ?? EMPTY;
  const setDraft = useCallback((fn: (d: DraftReport) => DraftReport) => {
    setRec((r) => {
      if (!r) return r;
      const next = fn(r.draft);
      return next === r.draft ? r : { ...r, draft: next };
    });
  }, []);

  const refresh = useCallback(async () => {
    try {
      setReports(await listReports());
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
      setStorageError({ text: '보관함을 읽지 못했습니다. 저장된 자료를 지우지 않았습니다.', retry: () => void refresh() });
    }
  }, []);

  // 앱을 열면 — 하던 신고가 있으면 바로 그 자리로
  const geoKey = useRef<number | undefined>(undefined);
  const open = useCallback((stored: ReportRecord) => {
    // 이전 형식 기록도 사진 ID·기본 두 장을 붙여 읽는다(원본·본문은 그대로). 기본 두 장을 앞에 둔다.
    const r = { ...stored, draft: primaryFirst(normalizeDraft(stored.draft)) };
    navigation.current += 1;
    autoPaused.current = false;
    saved.current = r;
    setRec(r);
    setReplacement(null);
    ovKey.current = '';
    setSaveState('saved');
    setStorageError(null);
    setReadStates(statesOf(r.draft));
    const at = activeLocatedShot(r.draft);
    geoKey.current = r.draft.address && at ? at.takenAt : undefined;
    setScreen(r.phase === 'capture' ? 'capture' : 'form');
  }, []);
  useEffect(() => {
    let active = true;
    const load = async () => {
      const started = navigation.current;
      try {
        const list = await listReports();
        if (!active || navigation.current !== started) return;
        setReports(list);
        setLoadFailed(false);
        setStorageError(null);
        const r = pickResume(list);
        if (r) open(r);
        else setScreen('home');
      } catch {
        if (!active || navigation.current !== started) return;
        setLoadFailed(true);
        setScreen('home');
        setStorageError({ text: '보관함을 읽지 못했습니다. 저장된 자료를 지우지 않았습니다.', retry: () => void load() });
      }
    };
    void load();
    return () => { active = false; };
  }, [open]);

  const autosave = useCallback(async (snapshot: ReportRecord) => {
    setSaveState('saving');
    try {
      await saveReport(snapshot);
      if (current.current !== snapshot || busyRef.current || replacementRef.current) return;
      saved.current = snapshot;
      setSaveState('saved');
      setStorageError(null);
    } catch {
      if (current.current !== snapshot || busyRef.current || replacementRef.current) return;
      setSaveState('error');
      setStorageError({
        text: '저장하지 못했습니다. 사진과 입력은 이 화면에 남아 있습니다. 저장을 다시 시도해 주세요.',
        retry: () => { if (current.current) void autosave(current.current); },
      });
    }
  }, []);

  // 교체 촬영본은 기존 기록과 분리한다. 완료 버튼에서 저장이 확정될 때만 교체한다.
  useEffect(() => {
    if (!rec || rec.draft.shots.length === 0 || replacement || busy || autoPaused.current || rec === saved.current) return;
    setSaveState('saving');
    saveTimer.current = setTimeout(() => { if (!busyRef.current) void autosave(rec); }, 300);
    return () => clearTimeout(saveTimer.current);
  }, [rec, replacement, busy, autosave]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (replacementRef.current || (current.current?.draft.shots.length && current.current !== saved.current)) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  // 사진마다 판독 — 첫 번째 사진은 찍자마자, 두 번째 사진도 찍자마자. 한 장씩 따로 읽는다.
  // 시각을 새기기 전 원본으로 읽고, 보완사진은 기본 첫 사진과 같은 차·장소인지 함께 확인한다.
  const inflight = useRef(new Set<Shot>());
  // 판독 한도에 걸린 사진은 한 번만, 천천히 자동으로 다시 판독한다(사람이 '다시 판독'을 연달아 눌러 한도를 더 쓰지 않게)
  const autoRetried = useRef(new Set<Shot>());
  useEffect(() => {
    const primary = primaryShots(draft);
    draft.shots.forEach((s, i) => {
      if (draft.reads?.[i] !== undefined || inflight.current.has(s)) return;
      inflight.current.add(s);
      setReadStates((st) => Object.assign([...st], { [i]: 'loading' }));
      const reference = !primary.includes(s) && primary[0]?.id
        ? { dataUrl: primary[0].originalDataUrl ?? primary[0].dataUrl, photoId: primary[0].id }
        : undefined;
      void readOne(s.originalDataUrl ?? s.dataUrl, {
        reference,
        photoIds: [s.id ?? `legacy-${i}-${s.takenAt}`],
        inputVersion: String(draft.evidenceRevision ?? 0),
      }).then((r) => {
        inflight.current.delete(s);
        if (current.current?.id !== rec?.id || current.current?.draft.shots[i] !== s) return;
        setDraft((d) => {
          if (d.shots[i] !== s) return d; // 그사이 다시 찍었다
          const reads = [...(d.reads ?? [])];
          reads[i] = r.read ?? null;
          return { ...d, reads, model: r.model ?? d.model };
        });
        const retry = r.state === 'rate_limited' && !autoRetried.current.has(s);
        setReadStates((st) => Object.assign([...st], { [i]: retry ? 'retrying' : r.state }));
        if (!retry) return;
        autoRetried.current.add(s);
        // 두 장이 함께 걸렸으면 조금씩 어긋나게 다시 부른다
        setTimeout(() => {
          if (current.current?.draft.shots[i] !== s || current.current.draft.reads?.[i] !== null) return;
          setDraft((d) => {
            if (d.shots[i] !== s) return d;
            const reads = [...(d.reads ?? [])];
            reads[i] = undefined as never;
            return { ...d, reads };
          });
        }, RATE_LIMIT_RETRY_MS * (1 + i / 8));
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.shots, draft.reads, rec?.id, setDraft]);

  // 두 사진 겹침 — 규칙 기반 영상 대조
  const ovKey = useRef('');
  useEffect(() => {
    const [a, b] = primaryShots(draft);
    if (!a || !b || draft.overlap) return;
    const key = `${rec?.id}-${a.takenAt}-${b.takenAt}`;
    if (ovKey.current === key) return;
    ovKey.current = key;
    void compareShots(a.dataUrl, b.dataUrl).then((o) => {
      if (current.current?.id !== rec?.id) return;
      setDraft((d) =>
        primaryShots(d)[0] === a && primaryShots(d)[1] === b
          ? { ...d, overlap: o ? { ratio: o.ratio, score: o.score, same: o.same } : { ratio: 0, score: -1, same: false } }
          : d,
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.shots, draft.primaryPair, draft.overlap, rec?.id, setDraft]);

  // 사진 좌표 → 발생지역. 사람이 고친 주소는 덮어쓰지 않는다.
  const located = activeLocatedShot(draft);
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
      if (r.state === 'ok') geoKey.current = located.takenAt;
      setAddressState(r.state);
      if (r.state === 'ok') {
        setDraft((d) => (d.manual?.address ? d : { ...d, address: r.road ?? r.parcel, addressParcel: r.road ? r.parcel : undefined }));
      }
    });
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [located, manualAddress]);

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
  }, [located]);

  // 판독 합본(읽힌 장만) → 유형 판정(사진 증거)
  // 번호판·같은 차는 기본 두 장으로만 맞춘다. 유형 근거에는 기본 사진과 연결이 확인된 보완사진도 더한다.
  // 유형은 사진에서 표시·대상 차량·경계가 모두 확인됐을 때만 채워지고, 아니면 비워 두어 직접 고르게 한다.
  const merged = useMemo(() => {
    const reads = primaryReads(draft).map((r) => r ?? null);
    return reads.some(Boolean) ? mergeReads(reads, draft.model ?? '') ?? undefined : undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.reads, draft.model, draft.primaryPair, draft.shots]);
  const evidenceMerged = useMemo(() => {
    const reads = reviewedReads(draft).map((r) => r ?? null);
    return reads.some(Boolean) ? mergeReads(reads, draft.model ?? '') ?? undefined : undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.reads, draft.model, draft.primaryPair, draft.shots]);
  const verdict = useMemo(() => crosscheck(typeInfo.candidates, typeInfo.coverage, evidenceMerged), [typeInfo, evidenceMerged]);
  const validation = useRef({ verdict, merged });
  validation.current = { verdict, merged };
  const rules = useMemo(() => rulesFor(draft.address), [draft.address]);
  const options = useMemo(() => {
    const first = primaryShots(draft)[0];
    if (!verdict.type || !first) return [];
    return rankTypes([verdict.type, ...verdict.alternatives], { takenAt: first.takenAt, rules, candidates: typeInfo.candidates });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verdict, rules, typeInfo.candidates, draft.shots, draft.primaryPair]);

  // 화면에 꺼낼 후속 질문 — 민원인이 직접 해야 할 일이 있을 때만
  const supplement = useMemo(() => supplementRequest(draft), [draft]);
  const shared = useMemo(() => sharedParkingQuestion(draft), [draft]);
  const [supplementBusy, setSupplementBusy] = useState(false);

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
    : readStates.some((s) => s === 'retrying')
      ? 'retrying'
      : merged
      ? 'ok'
      : (readStates.find((s) => s && s !== 'ok') ?? 'idle');

  /* ---------------- 동작 ---------------- */

  const startNew = () => {
    if (busyRef.current) return;
    navigation.current += 1;
    autoPaused.current = false;
    saved.current = null;
    setSaveState('idle');
    setStorageError(null);
    const t = Date.now();
    setRec({ id: newId(t), draft: normalizeDraft({ shots: [] }), phase: 'capture', step: 0, createdAt: t, updatedAt: t });
    setReadStates([]);
    geoKey.current = undefined;
    setScreen('capture');
  };

  // 저장 중에는 화면 조작과 지연 자동저장을 멈추고, 커밋 뒤에만 화면을 바꾼다.
  const persist = async (snapshot: ReportRecord, next: () => void, retry: () => void) => {
    if (busyRef.current) return;
    busyRef.current = true;
    autoPaused.current = false;
    setBusy(true);
    clearTimeout(saveTimer.current);
    setSaveState('saving');
    setStorageError(null);
    try {
      await saveReport(snapshot);
      saved.current = snapshot;
      setSaveState('saved');
      next();
    } catch {
      autoPaused.current = true;
      setSaveState('error');
      setStorageError({ text: '저장하지 못했습니다. 기존 자료와 현재 입력을 유지했습니다. 다시 시도해 주세요.', retry });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const cancelReplacement = () => {
    if (busyRef.current || !replacementRef.current) return;
    clearTimeout(saveTimer.current);
    ovKey.current = '';
    open(replacementRef.current);
  };

  const goHome = () => {
    if (replacementRef.current) return cancelReplacement();
    const snapshot = current.current;
    const leave = () => { setRec(null); setScreen('home'); void refresh(); };
    if (snapshot && snapshot.draft.shots.length > 0) void persist(snapshot, leave, goHome);
    else leave();
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

  const onShot = (s: Shot) => setDraft((d) => (primaryShots(d).length < 2 ? appendPhoto(d, s) : d));

  // 보완사진 한 장 — 기본 두 장은 그대로 두고 뒤에 붙인다. 같은 부족 사유로는 다시 요청하지 않는다.
  const onSupplement = (file: File, needId: string) => {
    if (busyRef.current || supplementBusy) return;
    const id = rec?.id;
    setSupplementBusy(true);
    void import('./lib/album')
      .then(({ readAlbumFile }) => readAlbumFile(file))
      .then((shot) => {
        if (current.current?.id !== id) return;
        setDraft((d) => ({ ...appendPhoto(d, shot, true), supplementAsked: [...new Set([...(d.supplementAsked ?? []), needId])] }));
      })
      .catch(() => {
        setToast('사진을 읽지 못했습니다. 기존 사진과 입력은 그대로입니다.');
        setTimeout(() => setToast(null), 4000);
      })
      .finally(() => setSupplementBusy(false));
  };

  const onSharedAnswer = (scope: SharedScope) => setDraft((d) => answerSharedParking(d, scope));

  // 교체 촬영 — 원래 기록은 저장해 두고 후보만 촬영 화면으로 보낸다. 완료 버튼에서 저장이 확정될 때만 바뀐다.
  const recapture = (build: (d: DraftReport) => DraftReport) => {
    const snapshot = current.current;
    if (!snapshot || busyRef.current) return;
    const begin = () => {
      setReplacement((old) => old ?? snapshot);
      const next = build(snapshot.draft);
      setRec({ ...snapshot, draft: next, phase: 'capture' });
      setReadStates(statesOf(next));
      geoKey.current = undefined;
      ovKey.current = '';
      setScreen('capture');
    };
    if (replacementRef.current) begin();
    else void persist(snapshot, begin, () => recapture(build));
  };
  const retake = (index: 0 | 1) => recapture((d) => replacementDraft(d, index));
  const retakeFirst = () => retake(0);
  const retakeSecond = () => retake(1);

  /* 신고서의 사진 칸 — 바꾸기·넣기(앨범·카메라)·지우기 */
  const [photoBusy, setPhotoBusy] = useState<0 | 1 | undefined>(undefined);
  const [askMore, setAskMore] = useState(false);
  const applyPhotos = (next: DraftReport) => {
    setRec((r) => (r ? { ...r, draft: next } : r));
    setReadStates(statesOf(next));
    ovKey.current = '';
  };
  const photoByCamera = (slot: 0 | 1) => {
    const n = primaryShots(current.current?.draft ?? EMPTY).length;
    // 바꾸는 칸이 아닌 다른 한 장을 남긴다. 빈 칸에 넣을 때는 있는 한 장을 남긴다.
    const keep: 0 | 1 | undefined = slot < n ? (n === 2 ? ((1 - slot) as 0 | 1) : undefined) : n > 0 ? 0 : undefined;
    recapture((d) => cameraDraft(d, keep));
  };
  const photoByAlbum = (slot: 0 | 1, file: File) => {
    if (busyRef.current || photoBusy !== undefined) return;
    const id = rec?.id;
    setPhotoBusy(slot);
    void import('./lib/album')
      .then(({ readAlbumFile }) => readAlbumFile(file))
      .then((shot) => {
        // 새 사진을 다 읽은 뒤에만 바꾼다 — 읽기에 실패하면 기존 사진·입력은 그대로다
        const snapshot = current.current;
        if (!snapshot || snapshot.id !== id) return;
        applyPhotos(replacePhoto(snapshot.draft, slot, shot));
      })
      .catch(() => {
        setToast('사진을 읽지 못했습니다. 기존 사진과 입력은 그대로입니다.');
        setTimeout(() => setToast(null), 4000);
      })
      .finally(() => setPhotoBusy(undefined));
  };
  const photoRemove = (slot: 0 | 1) => {
    const snapshot = current.current;
    if (!snapshot || busyRef.current) return;
    if (primaryShots(snapshot.draft).length <= 1) {
      // 사진이 한 장도 없는 신고는 남기지 않는다(처음 화면 목록의 지우기와 같다)
      void remove(snapshot.id);
      return;
    }
    applyPhotos(removePhoto(snapshot.draft, slot));
  };
  const finishCapture = () => {
    const snapshot = current.current;
    if (!snapshot || snapshot.draft.shots.length !== 2) return;
    const completed: ReportRecord = { ...snapshot, phase: 'form', step: 0, submittedAt: undefined };
    void persist(completed, () => {
      setReplacement(null);
      setRec(completed);
      setScreen('form');
    }, finishCapture);
  };
  const retryRead = (i: number) =>
    setDraft((d) => {
      const reads = [...(d.reads ?? [])];
      reads[i] = undefined as never;
      return { ...d, reads };
    });

  const onAlbum = (files: File[]) => {
    if (busyRef.current) return;
    navigation.current += 1;
    busyRef.current = true;
    setBusy(true);
    setStorageError(null);
    autoPaused.current = false;
    setAlbumState('busy');
    void import('./lib/album')
      .then(({ readAlbum }) => readAlbum(files))
      .then((shots) => {
        const t = Date.now();
        setRec({ id: newId(t), draft: normalizeDraft({ shots, firstOk: true }), phase: 'form', step: 0, createdAt: t, updatedAt: t });
        setReadStates([]);
        geoKey.current = undefined;
        // 한 장만 골랐으면 신고서를 열자마자 1장 더 넣기를 묻는다
        setAskMore(shots.length < 2);
        setAlbumState('idle');
        setScreen('form');
      })
      .catch(() => setAlbumState('error'))
      .finally(() => { busyRef.current = false; setBusy(false); });
  };

  /** confirmPlate: 차량번호가 AI 판독과 다르다는 안내를 보고 '그래도 제출하기'를 누른 번호 — 사진을 보고 확인한 것으로 함께 저장한다 */
  const onSubmit = (confirmPlate?: string) => {
    const latest = current.current;
    if (!latest || busyRef.current) return;
    const snapshot = confirmPlate ? { ...latest, draft: { ...latest.draft, plateConfirmedFor: confirmPlate } } : latest;
    const body = snapshot.draft.manual?.body ? snapshot.draft.body ?? '' : composeBody(snapshot.draft);
    const checked = precheck({ draft: snapshot.draft, body, verdict: validation.current.verdict, vision: validation.current.merged, now: Date.now() });
    if (checked.blocked || checked.notice.length > 0) {
      setToast(checked.blocked ? '현재 시각으로 다시 점검했습니다. 빨간불 항목을 확인해 주세요.' : '차량번호가 사진 판독과 다릅니다. 안내를 확인해 주세요.');
      setTimeout(() => setToast(null), 4000);
      setRec({ ...snapshot, step: 4 });
      return;
    }
    const done: ReportRecord = { ...snapshot, phase: 'submitted', submittedAt: Date.now() };
    void persist(done, () => {
      setRec(null);
      const m = measure(done);
      setToast(`개선 제안용 화면이라 접수되지 않습니다 — 제출한 신고에 저장했습니다${m ? `\n${m.text}` : ''}`);
      setTimeout(() => setToast(null), 4000);
      setScreen('home');
      void refresh();
    }, () => onSubmit(confirmPlate));
  };

  const remove = async (id: string) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    clearTimeout(saveTimer.current);
    try {
      await deleteReport(id);
      if (current.current?.id === id) {
        setRec(null);
        setScreen('home');
      }
      setStorageError(null);
      await refresh();
    } catch {
      setStorageError({ text: '삭제하지 못했습니다. 기존 자료를 유지했습니다.', retry: () => void remove(id) });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <div
      className="bg-slate-100 text-slate-800 font-sans antialiased selection:bg-blue-600 selection:text-white"
      onPointerDown={() => {
        // 걸린 시간·누른 횟수 재기(현장 확인 ⑦) — 신고를 하는 동안만 센다
        if (!busyRef.current && (screen === 'capture' || screen === 'form')) setRec((r) => (r && r.phase !== 'submitted' ? { ...r, taps: (r.taps ?? 0) + 1 } : r));
      }}
    >
      <PhoneFrame>
        <ProtoNotice />
        {storageError && (
          <div role="alert" className="shrink-0 px-4 py-2 bg-red-50 text-red-800 text-sm">
            <p>{storageError.text}</p>
            <button disabled={busy} onClick={storageError.retry} className="font-bold underline py-1">다시 시도</button>
          </div>
        )}
        {replacement && (
          <div role="status" className="shrink-0 px-4 py-2 bg-amber-50 text-amber-900 text-sm">
            <p>교체 촬영 중입니다. 새 사진 저장이 끝날 때까지 기존 사진·주소·내용을 보관합니다.</p>
            <button disabled={busy} onClick={cancelReplacement} className="font-bold underline py-1">재촬영 취소 · 기존 자료로 돌아가기</button>
          </div>
        )}
        {rec && !replacement && (
          <p role="status" className="shrink-0 px-4 py-1 text-xs text-slate-600">
            {saveState === 'saving' ? '기기에 저장 중…' : saveState === 'saved' ? '기기에 저장됨' : saveState === 'error' ? '저장 안 됨 · 이 화면의 자료를 유지하세요' : '사진을 찍으면 기기에 저장합니다'}
          </p>
        )}
        {busy && albumState !== 'busy' && <p role="status" className="shrink-0 px-4 py-1 text-sm text-blue-700">저장 완료를 기다리는 중…</p>}
        <fieldset disabled={busy} className="contents">

        {screen === 'loading' && <div className="flex-1" />}

        {screen === 'home' && (
          <StartScreen
            reports={reports}
            storageUnavailable={loadFailed}
            onCamera={startNew}
            onAlbum={onAlbum}
            albumState={albumState}
            onResume={open}
            onDelete={(id) => void remove(id)}
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
            onDone={finishCapture}
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
            onConfirmPlate={(value) => setDraft((d) => ({ ...d, plateConfirmedFor: value }))}
            onPickAddress={onPickAddress}
            followUps={{
              supplement,
              supplementBusy,
              onSupplement,
              shared,
              onSharedAnswer,
            }}
            onRetake={retakeSecond}
            photos={{ busySlot: photoBusy, onCamera: photoByCamera, onAlbum: photoByAlbum, onRemove: photoRemove }}
            askMore={askMore}
            onAsked={() => setAskMore(false)}
            onHome={goHome}
            onSubmit={onSubmit}
          />
        )}

        </fieldset>
        {toast && (
          <div role="status" className="absolute bottom-24 inset-x-6 z-40 rounded-lg bg-slate-900/90 text-white text-center text-[15px] font-bold py-3 px-3 whitespace-pre-line">
            {toast}
          </div>
        )}
      </PhoneFrame>

      {/* 넓은 화면(PC)에서만 — 팀원용 발표자료·판독 채점 화면으로 가는 단추. 휴대폰 화면에는 두지 않는다. */}
      <nav aria-label="팀원용" className="hidden lg:flex fixed top-5 right-5 gap-2">
        {[
          { href: '/deck/', label: '발표자료 →' },
          { href: '/eval.html', label: '판독 채점 화면 →' },
        ].map((l) => (
          <a
            key={l.href}
            href={l.href}
            className="flex items-center h-11 px-4 rounded-lg bg-white border border-slate-300 shadow-sm text-[15px] font-bold text-slate-800 hover:border-blue-600 hover:text-blue-700"
          >
            {l.label}
          </a>
        ))}
      </nav>
      <BuildBadge className="hidden lg:block fixed bottom-4 right-5" />
    </div>
  );
}
