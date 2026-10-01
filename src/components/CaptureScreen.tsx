import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Check, MapPin, RotateCcw, TriangleAlert } from 'lucide-react';
import { captureFrame, formatStamp, startCamera, stopCamera } from '../lib/camera';
import { clearDraft, loadDraft, saveDraft } from '../lib/draft';
import { MIN_INTERVAL_SEC } from '../lib/rules';
import type { Shot } from '../types/report';
import { Badge } from './Ui';

interface Props {
  onComplete: (shots: Shot[]) => void;
}

interface Pos {
  lat: number;
  lng: number;
  accuracy: number;
}

/**
 * 촬영 화면 — 요구사항 R5(앱을 켜면 곧 촬영), R3(60초를 앱이 대신 기다림), R7(이어하기).
 *
 * 지금 앱은 사용자가 1분을 직접 재야 하고, 화면이 꺼지면 카운트가 멈춘다.
 * 여기서는 촬영 시각을 기준으로 세므로 앱을 나갔다 와도 남은 시간이 그대로다.
 */
export default function CaptureScreen({ onComplete }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [shots, setShots] = useState<Shot[]>([]);
  const [pos, setPos] = useState<Pos | null>(null);
  const [posError, setPosError] = useState<string | null>(null);
  const [camError, setCamError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [restored, setRestored] = useState(false);

  // --- 카메라 ---
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

  // --- 위치 ---
  useEffect(() => {
    if (!navigator.geolocation) {
      setPosError('이 브라우저에서는 위치를 쓸 수 없습니다');
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setPosError(null);
        setPos({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy });
      },
      (e) => setPosError(e.message || '위치를 받을 수 없습니다'),
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  // --- 1초마다 남은 시간 갱신. 촬영 시각 기준이라 앱을 나갔다 와도 이어진다 ---
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  // --- 이어하기 ---
  useEffect(() => {
    loadDraft().then((d) => {
      if (d && d.shots.length > 0) {
        setShots(d.shots);
        setRestored(true);
      }
    });
  }, []);

  const first = shots[0];
  const waitedSec = first ? (now - first.takenAt) / 1000 : 0;
  const remainSec = first ? Math.max(0, Math.ceil(MIN_INTERVAL_SEC - waitedSec)) : 0;
  const canShootSecond = Boolean(first) && remainSec === 0;
  const done = shots.length >= 2;

  const shoot = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) return;
    const takenAt = Date.now();
    const dataUrl = captureFrame(video, {
      takenAt,
      lat: pos?.lat,
      lng: pos?.lng,
      accuracy: pos?.accuracy,
    });
    const shot: Shot = {
      takenAt,
      lat: pos?.lat,
      lng: pos?.lng,
      accuracy: pos?.accuracy,
      dataUrl,
    };
    setShots((prev) => {
      const next = [...prev, shot].slice(0, 2);
      void saveDraft(next);
      return next;
    });
  }, [pos]);

  const reset = useCallback(() => {
    setShots([]);
    setRestored(false);
    void clearDraft();
  }, []);

  const shootable = shots.length === 0 || canShootSecond;

  return (
    <div className="flex flex-col h-full">
      {/* --- 화면 --- */}
      <div className="relative bg-slate-900 aspect-[3/4] overflow-hidden">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-full object-cover"
        />

        {/* 첫 컷 겹쳐보기 — 같은 구도를 잡으라고 자를 대 주는 것 */}
        {first && !done && (
          <img
            src={first.dataUrl}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 w-full h-full object-cover opacity-35 pointer-events-none"
          />
        )}

        {/* 남은 시간 */}
        {first && !done && remainSec > 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900/45 text-white text-center px-6">
            <p className="text-6xl font-bold tabular-nums">{remainSec}</p>
            <p className="mt-2 text-sm font-bold">초 뒤에 둘째 장을 찍습니다</p>
            <p className="mt-4 text-xs text-slate-200 leading-relaxed">
              앱을 나가셔도 됩니다. 시간은 계속 흐릅니다.
              <br />
              돌아오면 남은 시간이 그대로 보입니다.
            </p>
          </div>
        )}

        {first && !done && remainSec === 0 && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full bg-green-600 text-white text-xs font-bold">
            이제 같은 자리에서 한 장 더
          </div>
        )}

        {camError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-800 text-white text-center px-8 gap-3">
            <TriangleAlert className="w-8 h-8 text-amber-400" aria-hidden="true" />
            <p className="font-bold">카메라를 열 수 없습니다</p>
            <p className="text-sm text-slate-300">{camError}</p>
            <p className="text-xs text-slate-400">
              카메라와 위치 권한이 필요합니다. https 로 접속했는지도 확인해 주세요.
            </p>
          </div>
        )}
      </div>

      {/* --- 상태 줄 --- */}
      <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-2 flex-wrap">
        <MapPin className="w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" />
        {pos ? (
          <>
            <span className="text-sm text-slate-700 tabular-nums">
              {pos.lat.toFixed(5)}, {pos.lng.toFixed(5)}
            </span>
            <Badge tone={pos.accuracy <= 10 ? 'green' : pos.accuracy <= 30 ? 'amber' : 'red'}>
              정확도 ±{Math.round(pos.accuracy)}m
            </Badge>
          </>
        ) : (
          <span className="text-sm text-slate-500">{posError ?? '위치를 찾는 중…'}</span>
        )}
      </div>

      {restored && !done && (
        <div className="px-4 py-2 bg-blue-50 border-b border-blue-100 text-sm text-blue-900">
          찍다 만 신고를 이어서 하고 있습니다.
          <button onClick={reset} className="ml-2 underline font-bold">
            처음부터
          </button>
        </div>
      )}

      {/* --- 찍은 사진 --- */}
      <div className="px-4 py-3 flex gap-3">
        {[0, 1].map((i) => {
          const s = shots[i];
          return (
            <div key={i} className="flex-1">
              <div
                className={`aspect-[4/3] rounded-lg border-2 overflow-hidden flex items-center justify-center ${
                  s ? 'border-green-600' : 'border-dashed border-slate-300 bg-slate-50'
                }`}
              >
                {s ? (
                  <img src={s.dataUrl} alt={`${i + 1}번째 사진`} className="w-full h-full object-cover" />
                ) : (
                  <span className="text-xs text-slate-400">{i + 1}번째</span>
                )}
              </div>
              <p className="mt-1 text-xs text-slate-500 tabular-nums text-center">
                {s ? formatStamp(s.takenAt).slice(11) : '—'}
              </p>
            </div>
          );
        })}
      </div>

      {/* --- 단추 --- */}
      <div className="mt-auto p-4 space-y-2">
        {done ? (
          <>
            <p className="text-center text-sm text-slate-600">
              {Math.floor((shots[1].takenAt - shots[0].takenAt) / 1000)}초 간격으로 두 장 찍었습니다
            </p>
            <button
              onClick={() => onComplete(shots)}
              className="w-full py-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold text-base transition-colors flex items-center justify-center gap-2"
            >
              <Check className="w-5 h-5" aria-hidden="true" />
              신고서 작성으로
            </button>
            <button
              onClick={reset}
              className="w-full py-3 rounded-lg border border-slate-300 hover:border-blue-600 hover:text-blue-700 font-bold text-sm transition-colors flex items-center justify-center gap-2"
            >
              <RotateCcw className="w-4 h-4" aria-hidden="true" />
              다시 찍기
            </button>
          </>
        ) : (
          <button
            onClick={shoot}
            disabled={!shootable || Boolean(camError)}
            className="w-full py-4 rounded-lg bg-blue-600 enabled:hover:bg-blue-700 disabled:bg-slate-300 text-white font-bold text-base transition-colors flex items-center justify-center gap-2"
          >
            <Camera className="w-5 h-5" aria-hidden="true" />
            {shots.length === 0 ? '첫 번째 사진 찍기' : `두 번째 사진 찍기`}
          </button>
        )}
      </div>
    </div>
  );
}
