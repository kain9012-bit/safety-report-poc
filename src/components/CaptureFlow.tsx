import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowLeft, Camera, Check, Loader2, MapPin, RotateCcw, Scale, TriangleAlert, X } from 'lucide-react';
import { captureEvidenceFrame, startCamera, stopCamera } from '../lib/camera';
import { isValidPlate, IS_TEST_INTERVAL, MIN_INTERVAL_SEC, PLATE_CONFIDENCE_FLOOR } from '../lib/rules';
import { distanceMeters } from '../lib/geo';
import { loadNearby } from '../lib/facilities';
import { recommend } from '../lib/recommend';
import type { Candidate } from '../lib/recommend';
import { SHOW_IN_PHOTO } from '../lib/crosscheck';
import type { Verdict } from '../lib/crosscheck';
import { reverseGeocode } from '../lib/reverseGeocode';
import { noParkingFor } from '../lib/noParkingData';
import type { NoParkingHere } from '../lib/noParkingData';
import { zoneNow } from '../lib/noParking';
import { describeRules, effectiveInterval, maxInterval, rulesFor } from '../lib/localRules';
import type { AppliedRules } from '../lib/localRules';
import type { TypeOption } from '../lib/choose';
import { OVERLAP_MIN } from '../lib/overlap';
import { primeAlerts, ringReady, titleCountdown } from '../lib/alert';
import type { VisionState } from '../lib/vision';
import type { VisionResult } from '../../api/vision';
import { primaryShots } from '../lib/photoEvidence';
import { createLocationTracker, LOCATION_LABEL, GPS_POLICY } from '../lib/locationQuality';
import { snapshotHeading, startHeadingTracking } from '../lib/heading';
import type { HeadingSample } from '../lib/heading';
import { VIOLATION_LABEL, isBasicType } from '../types/report';
import type { DraftReport, Shot, ViolationType } from '../types/report';
import { TypeChooser } from './FormParts';

/** 찍기 전 안내에 쓰는 짧은 이름 */
const NEAR_LABEL: Partial<Record<ViolationType, string>> = {
  busstop: '버스정류장',
  crossing: '횡단보도',
  schoolzone: '어린이보호구역 시설',
};

/** 위치를 기다리는 최대 시간(초). 넘으면 위치 없이도 찍게 한다. */
const LOC_WAIT_SEC = 15;

interface Pos {
  lat: number;
  lng: number;
  accuracy: number;
}

interface Props {
  draft: DraftReport;
  /** 사진마다 판독 상태 */
  readStates: (VisionState | undefined)[];
  /** 지금까지 읽은 사진으로 낸 판독 합본 */
  vision?: VisionResult;
  verdict: Verdict;
  /** 첫 번째 사진에 보인 유형이 둘 이상일 때 고를 목록 */
  options: TypeOption[];
  onShot: (s: Shot) => void;
  onRetakeFirst: () => void;
  onRetakeSecond: () => void;
  /** 첫 번째 사진 판독을 확인했다 — 두 번째 사진 대기로 */
  onAcceptFirst: () => void;
  onChooseType: (t: ViolationType) => void;
  onRetryRead: (i: number) => void;
  /** 두 장 확인이 끝났다 — 신고서 확인 단계로 */
  onDone: () => void;
  onExit: () => void;
}

/**
 * 촬영 흐름 — 회의에서 정한 순서 그대로.
 *
 *  1. 첫 번째 사진 → **바로 판독**(유형·번호판). 유형 근거나 번호판이 안 보이면 이유를 알려 주고 첫 번째 사진을 다시 찍게 한다.
 *     유형이 둘 이상 보이면 사람이 고르고, 앱은 규칙으로 추천만 한다.
 *  2. 남은 시간 카운트다운(60→0초). 간격은 그 자리 지자체·유형 규정. 0초에 소리·진동. 자리를 떠도 된다.
 *  3. 두 번째 사진 — 첫 번째 사진 잔상을 겹쳐 같은 구도로.
 *  4. 두 사진 겹침(규칙 기반 영상 대조)과 두 장 번호판 일치를 확인 → 맞으면 신고서 확인으로.
 *
 * 길에서 한 손으로 쓰는 화면이라 스크롤이 없다. 영상이 화면을 채우고 나머지는 위에 겹친다.
 */
export default function CaptureFlow(p: Props) {
  const { draft } = p;
  const shots = primaryShots(draft);
  const first = shots[0];
  const second = shots[1];

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const locationTracker = useRef(createLocationTracker());
  const headingSamples = useRef<HeadingSample[]>([]);
  const headingStop = useRef<(() => void) | undefined>(undefined);
  const [headingIssue, setHeadingIssue] = useState<'denied' | 'unsupported' | undefined>();
  const [headingStarted, setHeadingStarted] = useState(false);
  const alive = useRef(true);
  const headingRequest = useRef(0);
  const enableHeading = async () => {
    const request = ++headingRequest.current;
    headingStop.current?.(); headingSamples.current = [];
    const facing = streamRef.current?.getVideoTracks()[0]?.getSettings().facingMode;
    const tracked = await startHeadingTracking({ facingMode: facing === 'environment' || facing === 'user' ? facing : 'unknown', onSample: (sample) => { if (alive.current && request === headingRequest.current) headingSamples.current = [...headingSamples.current.slice(-19), sample]; } });
    if (!alive.current || request !== headingRequest.current) { tracked.stop(); return; }
    headingStop.current = tracked.stop;
    setHeadingIssue(tracked.issue);
    setHeadingStarted(true);
  };
  useEffect(() => { alive.current = true; return () => { alive.current = false; headingRequest.current++; headingStop.current?.(); }; }, []);
  const [camError, setCamError] = useState<string | null>(null);
  const [pos, setPos] = useState<Pos | null>(null);
  const [posErrCode, setPosErrCode] = useState<number | null>(null);
  const mountedAt = useRef(Date.now());
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let cancelled = false;
    startCamera()
      .then((stream) => {
        if (cancelled) return stopCamera(stream);
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      })
      .catch((e: Error) => setCamError(e.message || '카메라를 열 수 없습니다'));
    return () => {
      cancelled = true;
      stopCamera(streamRef.current);
      streamRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!navigator.geolocation) {
      setPosErrCode(2);
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (g) => {
        setPosErrCode(null);
        locationTracker.current.ingest(g);
        const sample = locationTracker.current.snapshot(Date.now()).sample;
        setPos(sample ? { lat: sample.lat, lng: sample.lng, accuracy: sample.accuracy ?? Infinity } : null);
      },
      (e) => setPosErrCode(e.code),
      { enableHighAccuracy: true, maximumAge: 0, timeout: GPS_POLICY.requestTimeoutMs },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  // 촬영 시각 기준으로 센다 — 앱을 나갔다 와도 남은 시간이 이어진다
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  // 찍기 전: 휴대폰 위치 → 주변 시설(무엇을 사진에 담을지) + 관할 지자체 규정
  const [hint, setHint] = useState<Candidate[]>([]);
  const [hereRules, setHereRules] = useState<AppliedRules>(() => rulesFor(draft.address));
  // 같은 도로의 주정차금지(지정)구역 — 참고 안내만. 판정에는 쓰지 않는다(좌표 없는 자료라 도로명으로 맞춘다)
  const [noPark, setNoPark] = useState<NoParkingHere | null>(null);
  const hintAt = useRef<{ lat: number; lng: number } | null>(null);
  useEffect(() => {
    if (!pos || !Number.isFinite(pos.accuracy) || pos.accuracy > 50 || locationTracker.current.snapshot(Date.now()).quality.status === 'stale') return;
    if (hintAt.current && distanceMeters(hintAt.current, pos) < 15) return;
    let stale = false;
    hintAt.current = { lat: pos.lat, lng: pos.lng };
    void loadNearby(pos).then((n) => { if (!stale) setHint(recommend(pos, n).slice(0, 2)); }).catch(() => { if (!stale) setHint([]); });
    void reverseGeocode(pos.lat, pos.lng).then(async (r) => {
      if (stale) return;
      if (r.state === 'ok') setHereRules(rulesFor(r.road ?? r.parcel));
      const result = await noParkingFor(r.state === 'ok' ? r.road : undefined);
      if (!stale) setNoPark(result);
    }).catch(() => { if (!stale) setNoPark(null); });
    return () => { stale = true; hintAt.current = null; };
  }, [pos]);
  const noParkZone = noPark?.zones[0];
  const noParkNow = noParkZone ? zoneNow(noParkZone, now) : null;

  // 사진 주소가 들어오면 그 주소의 규정이 우선
  const rules = draft.address ? rulesFor(draft.address) : hereRules;
  const intervalSec = effectiveInterval(isBasicType(draft.type) ? rules.types[draft.type].intervalSec : draft.type ? 0 : maxInterval(rules));
  const remainSec = first ? Math.max(0, Math.ceil(intervalSec - (now - first.takenAt) / 1000)) : 0;

  const firstOk = Boolean(draft.firstOk);
  const phase: 'first' | 'review' | 'wait' | 'second' | 'check' = !first
    ? 'first'
    : !second
      ? !firstOk
        ? 'review'
        : remainSec > 0
          ? 'wait'
          : 'second'
      : 'check';

  // 0초 — 소리·진동·알림 한 번. 다시 열었을 때 이미 지난 시간이면 울리지 않는다
  const rang = useRef<number | null>(null);
  useEffect(() => {
    if (!first || second) {
      titleCountdown(null);
      return;
    }
    titleCountdown(remainSec);
    if (remainSec === 0 && rang.current !== first.takenAt) {
      rang.current = first.takenAt;
      if ((now - first.takenAt) / 1000 < intervalSec + 5) ringReady();
    }
  }, [first, second, remainSec, now, intervalSec]);
  useEffect(() => () => titleCountdown(null), []);

  const waitedSec = Math.floor((now - mountedAt.current) / 1000);
  const locBlocking = false; // 위치 대기와 촬영은 분리한다.
  const locationNow = locationTracker.current.snapshot(now, posErrCode === 1 ? 'denied' : posErrCode ? 'unavailable' : undefined);
  const shootable = (phase === 'first' || phase === 'second') && !camError && !locBlocking;

  const shoot = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) return;
    primeAlerts();
    const takenAt = Date.now();
    const location = locationTracker.current.snapshot(takenAt, posErrCode === 1 ? 'denied' : posErrCode ? 'unavailable' : undefined);
    const at = location.quality.status === 'stale' || location.quality.status === 'unavailable' ? undefined : location.sample;
    const images = captureEvidenceFrame(video, { takenAt, lat: at?.lat, lng: at?.lng, accuracy: at?.accuracy });
    p.onShot({
      takenAt,
      ...images,
      location,
      heading: snapshotHeading(headingSamples.current, takenAt, headingIssue),
      lat: at?.lat,
      lng: at?.lng,
      accuracy: at?.accuracy,
      locIssue: at ? undefined : posErrCode === 1 ? 'denied' : 'unavailable',
      source: 'camera',
    });
  }, [pos, posErrCode, p, headingIssue]);

  const accTone = locationNow.quality.status === 'nearby' ? 'bg-green-600/90' : locationNow.quality.status === 'broad' ? 'bg-amber-600/90' : 'bg-slate-900/70';

  return (
    <div className="relative flex-1 min-h-0 bg-slate-900 overflow-hidden">
      <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 w-full h-full object-cover" />

      {/* 첫 번째 사진 잔상 — 같은 구도를 잡게 */}
      {first && !second && (
        <img src={first.dataUrl} alt="" aria-hidden="true" className="absolute inset-0 w-full h-full object-cover opacity-35 pointer-events-none" />
      )}

      {/* 위: 나가기 · 위치 · 남은 시간 */}
      <div className="absolute top-0 inset-x-0 z-10 p-3 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <button onClick={p.onExit} aria-label="처음 화면" className="w-9 h-9 rounded-full bg-slate-900/70 text-white flex items-center justify-center shrink-0">
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          </button>
          <span className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-white text-xs font-bold ${accTone}`}>
            <MapPin className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>{LOCATION_LABEL[locationNow.quality.status]}{pos && Number.isFinite(pos.accuracy) ? ` · ±${Math.round(pos.accuracy)}m` : ''}</span>
          </span>
        </div>
        {first && !second && (
          <span
            role="timer"
            aria-live="off"
            className={`px-3 py-1.5 rounded-full text-white text-sm font-bold tabular-nums ${remainSec > 0 ? 'bg-slate-900/80' : 'bg-green-600'}`}
          >
            {remainSec > 0 ? `두 번째 사진까지 ${remainSec}초` : '지금 두 번째 사진'}
          </span>
        )}
      </div>

      <button onClick={() => void enableHeading()} className="absolute top-14 left-3 z-10 text-xs text-white bg-slate-900/75 rounded px-2 py-1">
        {headingStarted ? (snapshotHeading(headingSamples.current, now, headingIssue).status === 'usable' ? '촬영 방향 기록 중' : '촬영 방향 미확인 · 다시 확인') : '촬영 방향 함께 확인'}
      </button>
      {/* 가운데: 큰 카운트다운(첫 번째 사진 확인 뒤) */}
      {phase === 'wait' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900/50 text-white text-center px-8 pointer-events-none">
          <p className="text-[96px] font-bold tabular-nums leading-none">{remainSec}</p>
          <p className="mt-3 text-[17px] font-bold">초 뒤에 두 번째 사진</p>
          <p className="mt-2 text-[14px] text-slate-200 leading-snug">
            자리를 옮겨도 됩니다.
            <br />
            0초가 되면 소리·진동으로 알려 드립니다.
          </p>
          {IS_TEST_INTERVAL && (
            <p className="mt-3 px-2.5 py-1 rounded-full bg-amber-500 text-xs font-bold">
              테스트용 {intervalSec}초 · 실제 기준 {MIN_INTERVAL_SEC}초
            </p>
          )}
        </div>
      )}
      {phase === 'second' && (
        <p className="absolute top-16 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full bg-green-600 text-white text-sm font-bold whitespace-nowrap">
          첫 번째 사진과 같은 자리·방향에서
        </p>
      )}

      {camError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-800 text-white text-center px-8 gap-3">
          <TriangleAlert className="w-8 h-8 text-amber-400" aria-hidden="true" />
          <p className="font-bold">카메라를 열 수 없습니다</p>
          <p className="text-sm text-slate-300">{camError}</p>
          <p className="text-xs text-slate-400">카메라·위치 권한과 https 접속을 확인해 주세요</p>
        </div>
      )}

      {/* 아래: 안내 + 셔터 */}
      {(phase === 'first' || phase === 'second' || phase === 'wait') && (
        <div className="absolute bottom-0 inset-x-0 z-10 p-3 pb-4 bg-gradient-to-t from-slate-900/90 to-transparent">
          {phase === 'first' && (
            <div className="mb-2 rounded-lg bg-slate-900/75 px-3 py-2 text-[12px] leading-snug text-white space-y-0.5">
              <p className="flex items-center gap-1.5">
                <Scale className="w-3.5 h-3.5 text-sky-300 shrink-0" aria-hidden="true" />
                <b>{describeRules(rules)}</b>
              </p>
              {hint.map((c) => (
                <p key={c.type}>
                  <b className="text-amber-300">근처 {NEAR_LABEL[c.type] ?? VIOLATION_LABEL[c.type]}</b>
                  {` (약 ${Math.round(c.distance)}m)`}
                  {SHOW_IN_PHOTO[c.type] && <> — {SHOW_IN_PHOTO[c.type]} 사진에 나오게</>}
                </p>
              ))}
              {noPark && noParkZone && noParkNow && (
                <div>
                  <p>
                    <b className="text-sky-300">참고 · 주정차금지 구간</b>
                    {` ${noPark.road}${noPark.zones.length > 1 ? ` 등 ${noPark.zones.length}곳` : ''} — ${noParkNow.schedule}`}
                    {noParkNow.enforced === true && <b> · 지금 단속 시간</b>}
                    {noParkNow.enforced === false && ' · 지금은 단속 시간 아님'}
                  </p>
                  <p className="text-[11px] text-white/60">
                    {noParkZone.desc && `${noParkZone.desc} · `}공공데이터 {noParkZone.ref || '기준일 없음'} 기준 · 구간 밖이거나 표지판과 다를 수 있어 참고만
                  </p>
                </div>
              )}
              <p className="text-white/70">차·번호판·위반 장소가 한 화면에 나오게 찍어 주세요</p>
            </div>
          )}
          {phase === 'wait' && <WaitCard draft={draft} />}
          <div className="flex items-center gap-3">
            <Thumbs shots={shots} />
            <button
              onClick={shoot}
              disabled={!shootable}
              className={`flex-1 h-14 rounded-lg ${!pos && !locBlocking ? 'bg-amber-600' : 'bg-blue-600 enabled:hover:bg-blue-700'} disabled:bg-slate-600 disabled:text-white/60 text-white font-bold text-[17px] flex items-center justify-center gap-2`}
            >
              <Camera className="w-6 h-6" aria-hidden="true" />
              {phase === 'wait'
                ? `${remainSec}초 뒤 두 번째 사진`
                : locBlocking
                  ? `위치 찾는 중… ${Math.max(0, LOC_WAIT_SEC - waitedSec)}초`
                  : !pos
                    ? '위치 없이 찍기'
                    : phase === 'first'
                      ? '첫 번째 사진'
                      : '두 번째 사진'}
            </button>
          </div>
        </div>
      )}

      {phase === 'review' && (
        <Sheet>
          <FirstReview {...p} remainSec={remainSec} rules={rules} />
        </Sheet>
      )}
      {phase === 'check' && (
        <Sheet>
          <SecondCheck {...p} />
        </Sheet>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Sheet({ children }: { children: ReactNode }) {
  return (
    <div className="absolute inset-x-0 bottom-0 z-20 max-h-[78%] overflow-y-auto rounded-t-2xl bg-white text-slate-900 shadow-2xl">
      <div className="p-4 pb-5">{children}</div>
    </div>
  );
}

function Thumbs({ shots }: { shots: Shot[] }) {
  return (
    <div className="flex gap-2 shrink-0">
      {[0, 1].map((i) => (
        <div
          key={i}
          className={`w-14 h-14 rounded-lg overflow-hidden border-2 flex items-center justify-center ${shots[i] ? 'border-green-500' : 'border-dashed border-white/40'}`}
        >
          {shots[i] ? (
            <img src={shots[i].dataUrl} alt={`${i + 1}번째 사진`} className="w-full h-full object-cover" />
          ) : (
            <span className="text-[11px] text-white/60 font-bold">{i + 1}</span>
          )}
        </div>
      ))}
    </div>
  );
}

/** 기다리는 동안 — 이미 채워진 신고 내용을 보여 준다 */
function WaitCard({ draft }: { draft: DraftReport }) {
  return (
    <div className="mb-2 rounded-lg bg-white/95 px-3 py-2 text-[13px] text-slate-800 space-y-0.5">
      <p className="font-bold text-slate-900">기다리는 동안 채워 둔 신고 내용</p>
      <p>유형 · {draft.type ? VIOLATION_LABEL[draft.type] : '사진으로 정하지 못함'}</p>
      <p className="truncate">발생지역 · {draft.address ?? '주소 찾는 중…'}</p>
    </div>
  );
}

function Spinner({ text }: { text: string }) {
  return (
    <p className="flex items-center gap-2 text-[15px] text-slate-600">
      <Loader2 className="w-5 h-5 animate-spin text-blue-600" aria-hidden="true" />
      {text}
    </p>
  );
}

const READ_FAIL: Partial<Record<VisionState, string>> = {
  no_key: '사진 판독 키가 연결되지 않았습니다',
  rate_limited: '사진 판독 한도에 걸렸습니다. 잠시 후 다시 시도해 주세요',
  busy: '판독 서버가 붐빕니다. 잠시 후 다시 시도해 주세요',
  error: '사진 판독에 실패했습니다',
};

/** 1단계 — 첫 번째 사진 판독 결과: 부적합이면 이유와 재촬영, 유형이 여럿이면 고르기, 맞으면 확인 */
function FirstReview(p: Props & { remainSec: number; rules: AppliedRules }) {
  const { draft, verdict, options } = p;
  const index = draft.shots.indexOf(primaryShots(draft)[0]);
  const st = p.readStates[index];
  const read = draft.reads?.[index];
  const [pick, setPick] = useState<ViolationType | undefined>(undefined);

  if (!st || st === 'loading' || read === undefined) {
    return (
      <div className="space-y-2">
        <p className="text-[19px] font-bold">첫 번째 사진 확인 중</p>
        <Spinner text="유형과 번호판을 읽고 있습니다" />
        <p className="text-[13px] text-slate-500">판독하는 동안에도 두 번째 사진까지 남은 시간은 줄어듭니다.</p>
        <button onClick={p.onAcceptFirst} className="w-full py-3 rounded bg-blue-600 text-white font-bold">분석을 기다리지 않고 두 번째 촬영으로</button>
      </div>
    );
  }

  if (st !== 'ok' || !read) {
    return (
      <div className="space-y-3">
        <p className="text-[19px] font-bold">첫 번째 사진을 판독하지 못했습니다</p>
        <p className="text-[14px] text-slate-600">{READ_FAIL[st] ?? '사진 판독에 실패했습니다'}</p>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => p.onRetryRead(index)} className="h-12 rounded-lg bg-[#3a8fdb] text-white font-bold">다시 판독</button>
          <button onClick={p.onAcceptFirst} className="h-12 rounded-lg border-2 border-slate-300 text-slate-700 font-bold">판독 없이 계속</button>
        </div>
      </div>
    );
  }

  // 부적합 사유 — 규칙: 유형 근거(사진) · 번호판
  const reasons: { title: string; fix: string }[] = [];
  if (!verdict.type) {
    const sus = verdict.suspicions.filter((c) => SHOW_IN_PHOTO[c.type]);
    reasons.push({
      title: '위반 장소의 근거가 사진에 보이지 않습니다',
      fix: sus.length
        ? `근처에 ${sus.map((c) => VIOLATION_LABEL[c.type]).join('·')}이(가) 있습니다 — ${SHOW_IN_PHOTO[sus[0].type]} 차와 함께 나오게 찍어 주세요`
        : '횡단보도·정류장 표지·소화전처럼 위반 장소가 차와 함께 나오게 찍어 주세요',
    });
  }
  if (!read.plate.readable) {
    reasons.push({ title: '번호판이 읽히지 않습니다', fix: '번호판이 또렷하게 나오게 조금 더 가까이에서 찍어 주세요' });
  }

  if (reasons.length) {
    return (
      <div className="space-y-3">
        <p className="text-[19px] font-bold text-red-700">사진에서 확인하지 못한 내용이 있습니다</p>
        <ul className="space-y-2">
          {reasons.map((r) => (
            <li key={r.title} className="rounded-lg border border-red-200 bg-red-50 px-3 py-2">
              <p className="text-[15px] font-bold text-red-800">{r.title}</p>
              <p className="text-[14px] text-red-900/80">{r.fix}</p>
            </li>
          ))}
        </ul>
        <button onClick={p.onRetakeFirst} className="w-full h-14 rounded-lg bg-[#3a8fdb] text-white text-[18px] font-bold flex items-center justify-center gap-2">
          <RotateCcw className="w-5 h-5" aria-hidden="true" /> 첫 번째 사진 다시 찍기
        </button>
        <button onClick={p.onAcceptFirst} className="w-full text-[13px] text-slate-500 underline underline-offset-2">
          원본을 보관하고 계속 · 보완사진은 나중에 추가
        </button>
      </div>
    );
  }

  const multiple = options.length >= 2;
  const chosen = pick ?? (draft.manual?.type ? draft.type : options.find((o) => o.recommended)?.type);
  const accept = () => {
    if (multiple && chosen && chosen !== draft.type) p.onChooseType(chosen);
    p.onAcceptFirst();
  };

  return (
    <div className="space-y-3">
      <p className="text-[19px] font-bold text-green-700 flex items-center gap-1.5">
        <Check className="w-6 h-6" aria-hidden="true" /> 첫 번째 사진 확인
      </p>
      {multiple ? (
        <>
          <p className="text-[15px] font-bold">사진에 위반 유형이 {options.length}개 보입니다 — 하나를 골라 주세요</p>
          <TypeChooser options={options} current={chosen} onPick={setPick} />
        </>
      ) : (
        <dl className="rounded-lg border border-slate-200 divide-y divide-slate-100 text-[15px]">
          <Item k="유형" v={draft.type ? VIOLATION_LABEL[draft.type] : '—'} note={verdict.photoReason} />
          <Item k="번호판" v={read.plate.text || '—'} note="두 번째 사진에서 한 번 더 읽어 맞춰 봅니다" />
          <Item k="발생지역" v={draft.address ?? '주소 찾는 중…'} />
        </dl>
      )}
      <p className="text-[13px] text-slate-500">{describeRules(p.rules)} · 내용은 자동으로 씁니다</p>
      <button onClick={accept} className="w-full h-14 rounded-lg bg-[#3a8fdb] text-white text-[18px] font-bold">
        {p.remainSec > 0 ? `확인 · 두 번째 사진까지 ${p.remainSec}초` : '확인 · 두 번째 사진 찍기'}
      </button>
      <button onClick={p.onRetakeFirst} className="w-full text-[13px] text-slate-500 underline underline-offset-2">
        첫 번째 사진 다시 찍기
      </button>
    </div>
  );
}

function Item({ k, v, note }: { k: string; v: string; note?: string }) {
  return (
    <div className="px-3 py-2">
      <dt className="text-[12px] font-bold text-slate-500">{k}</dt>
      <dd className="text-[17px] text-[#3a8fdb]">{v}</dd>
      {note && <dd className="text-[12px] text-slate-500">{note}</dd>}
    </div>
  );
}

/** 4단계 — 두 사진 같은 자리(겹침)·같은 번호판 확인 */
function SecondCheck(p: Props) {
  const { draft, vision } = p;
  const index = draft.shots.indexOf(primaryShots(draft)[1]);
  const st = p.readStates[index];
  const ov = draft.overlap;
  const read2 = draft.reads?.[index];
  const reading = !st || st === 'loading' || read2 === undefined;
  const measuring = ov === undefined;

  const same = vision?.sameVehicle;
  const reads = vision?.plate.reads ?? [];
  const validReads = reads.length === 2 && reads.every(isValidPlate);
  const confident = Number.isFinite(vision?.plate.confidence) && (vision?.plate.confidence ?? 0) >= PLATE_CONFIDENCE_FLOOR;
  const plateOk = same === 'yes' && vision?.plate.agree === true && validReads && confident;
  const ovOk = Boolean(ov?.same);
  const done = !reading && !measuring;

  const plateText = reading
    ? '읽는 중…'
    : st !== 'ok'
      ? READ_FAIL[st] ?? '판독 실패'
      : plateOk
        ? `${vision!.plate.text} — 두 장 일치`
        : reads.length === 2 && !validReads
          ? `읽은 번호가 번호판 형식과 다릅니다(${reads.join(' / ')})`
          : reads.length === 2 && !confident
            ? `번호판 판독 신뢰도가 기준(${Math.round(PLATE_CONFIDENCE_FLOOR * 100)}%)에 못 미치거나 확인되지 않습니다`
            : same === 'no'
              ? `번호가 다릅니다(${reads.join(' / ')})`
              : '한 장 이상에서 번호판을 확실히 읽지 못했습니다';
  const ovText = measuring
    ? '재는 중…'
    : ov!.same
      ? `${Math.round(ov!.ratio * 100)}% 겹침 (기준 ${Math.round(OVERLAP_MIN * 100)}%)`
      : ov!.ratio < OVERLAP_MIN
        ? `${Math.round(ov!.ratio * 100)}%만 겹칩니다 (기준 ${Math.round(OVERLAP_MIN * 100)}%)`
        : '같은 장면으로 보이지 않습니다';

  return (
    <div className="space-y-3">
      <p className="text-[19px] font-bold">두 사진 확인</p>
      <ul className="rounded-lg border border-slate-200 divide-y divide-slate-100">
        <CheckRow ok={measuring ? undefined : ovOk} label="같은 자리·방향" text={ovText} />
        <CheckRow ok={reading ? undefined : plateOk} label="같은 번호판" text={plateText} />
      </ul>
      {done && plateOk && ovOk ? (
        <button onClick={p.onDone} className="w-full h-14 rounded-lg bg-[#3a8fdb] text-white text-[18px] font-bold">
          신고서 확인으로
        </button>
      ) : done ? (
        <>
          <p className="text-[14px] text-slate-600">첫 번째 사진과 같은 자리·방향에서, 번호판이 보이게 다시 찍어 주세요. 기다릴 필요는 없습니다.</p>
          <button onClick={p.onRetakeSecond} className="w-full h-14 rounded-lg bg-[#3a8fdb] text-white text-[18px] font-bold flex items-center justify-center gap-2">
            <RotateCcw className="w-5 h-5" aria-hidden="true" /> 두 번째 다시 찍기
          </button>
          <div className="flex items-center justify-between text-[13px]">
            {st !== 'ok' ? (
              <button onClick={() => p.onRetryRead(index)} className="font-bold text-blue-700 underline underline-offset-2">다시 판독</button>
            ) : (
              <span />
            )}
            <button onClick={p.onDone} className="text-slate-500 underline underline-offset-2">그래도 신고서로</button>
          </div>
        </>
      ) : (
        <><Spinner text="확인하는 중입니다" /><button onClick={p.onDone} className="w-full py-3 rounded bg-blue-600 text-white">사진을 보관하고 내용 확인으로</button></>
      )}
      <button onClick={p.onRetakeFirst} className="w-full flex items-center justify-center gap-1 text-[13px] text-slate-500">
        <X className="w-4 h-4" aria-hidden="true" /> 처음부터 다시 찍기
      </button>
    </div>
  );
}

function CheckRow({ ok, label, text }: { ok?: boolean; label: string; text: string }) {
  return (
    <li className="flex items-start gap-2.5 px-3 py-2.5">
      <span
        className={`mt-1 w-3 h-3 rounded-full shrink-0 ${ok === undefined ? 'bg-slate-300' : ok ? 'bg-green-600' : 'bg-red-600'}`}
        aria-label={ok === undefined ? '확인 중' : ok ? '통과' : '불가'}
      />
      <span className="min-w-0">
        <span className="block text-[15px] font-bold">{label}</span>
        <span className="block text-[14px] text-slate-600">{text}</span>
      </span>
    </li>
  );
}
