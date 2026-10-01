import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Check, Info, MapPin, RotateCcw, TriangleAlert, X } from 'lucide-react';
import { captureFrame, formatStamp, startCamera, stopCamera } from '../lib/camera';
import { clearDraft, loadDraft, saveDraft } from '../lib/draft';
import { MIN_INTERVAL_SEC } from '../lib/rules';
import type { Shot } from '../types/report';

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
 * 길 한복판에서 한 손으로 쓰는 화면이다. 그래서 **스크롤이 없다.**
 * 영상이 화면을 채우고 나머지는 전부 그 위에 겹친다 — 카메라 앱과 같은 구조다.
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
  const [why, setWhy] = useState(false);

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
      setPosError('위치를 쓸 수 없습니다');
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

  // 촬영 시각 기준으로 세기 때문에 앱을 나갔다 와도 남은 시간이 이어진다
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    loadDraft().then((d) => {
      if (d && d.shots.length > 0) {
        setShots(d.shots);
        setRestored(true);
      }
    });
  }, []);

  const first = shots[0];
  const remainSec = first ? Math.max(0, Math.ceil(MIN_INTERVAL_SEC - (now - first.takenAt) / 1000)) : 0;
  const canShootSecond = Boolean(first) && remainSec === 0;
  const done = shots.length >= 2;
  const shootable = (shots.length === 0 || canShootSecond) && !camError;

  const shoot = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) return;
    const takenAt = Date.now();
    const shot: Shot = {
      takenAt,
      lat: pos?.lat,
      lng: pos?.lng,
      accuracy: pos?.accuracy,
      dataUrl: captureFrame(video, {
        takenAt,
        lat: pos?.lat,
        lng: pos?.lng,
        accuracy: pos?.accuracy,
      }),
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

  const accTone = !pos
    ? 'bg-slate-900/70'
    : pos.accuracy <= 10
      ? 'bg-green-600/90'
      : pos.accuracy <= 30
        ? 'bg-amber-600/90'
        : 'bg-red-600/90';

  return (
    <div className="relative flex-1 min-h-0 bg-slate-900">
      {/* 영상이 화면을 채운다 */}
      <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 w-full h-full object-cover" />

      {/* 첫 컷 겹쳐보기 — 같은 구도를 잡으라고 자를 대 주는 것 */}
      {first && !done && (
        <img
          src={first.dataUrl}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 w-full h-full object-cover opacity-35 pointer-events-none"
        />
      )}

      {/* --- 위쪽 겹침: 위치·도움말 --- */}
      <div className="absolute top-0 inset-x-0 z-10 p-3 flex items-start justify-between gap-2">
        <div
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-white text-xs font-bold ${accTone}`}
        >
          <MapPin className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          {pos ? <span className="tabular-nums">±{Math.round(pos.accuracy)}m</span> : <span>{posError ? '위치 없음' : '위치 찾는 중'}</span>}
        </div>

        <button
          onClick={() => setWhy(true)}
          aria-label="이 화면이 바꾸는 것"
          className="w-9 h-9 rounded-full bg-slate-900/70 text-white flex items-center justify-center shrink-0"
        >
          <Info className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>

      {/* --- 가운데: 남은 시간 --- */}
      {first && !done && remainSec > 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900/45 text-white text-center px-8 pointer-events-none">
          <p className="text-7xl font-bold tabular-nums leading-none">{remainSec}</p>
          <p className="mt-3 text-sm font-bold">초 뒤에 둘째 장을 찍습니다</p>
          <p className="mt-2 text-xs text-slate-200">앱을 나가셔도 시간은 계속 흐릅니다</p>
        </div>
      )}

      {first && !done && remainSec === 0 && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full bg-green-600 text-white text-xs font-bold whitespace-nowrap">
          같은 자리에서 한 장 더
        </div>
      )}

      {restored && !done && (
        <button
          onClick={reset}
          className="absolute top-16 left-3 px-2.5 py-1.5 rounded-full bg-blue-600 text-white text-xs font-bold"
        >
          이어하는 중 · 처음부터
        </button>
      )}

      {camError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-800 text-white text-center px-8 gap-3">
          <TriangleAlert className="w-8 h-8 text-amber-400" aria-hidden="true" />
          <p className="font-bold">카메라를 열 수 없습니다</p>
          <p className="text-sm text-slate-300">{camError}</p>
          <p className="text-xs text-slate-400">카메라·위치 권한과 https 접속을 확인해 주세요</p>
        </div>
      )}

      {/* --- 아래쪽 겹침: 찍은 사진 + 단추 --- */}
      <div className="absolute bottom-0 inset-x-0 z-10 p-3 pb-4 bg-gradient-to-t from-slate-900/85 to-transparent">
        <div className="flex items-end gap-3">
          {/* 찍은 두 장 */}
          <div className="flex gap-2 shrink-0">
            {[0, 1].map((i) => {
              const s = shots[i];
              return (
                <div
                  key={i}
                  className={`w-14 h-14 rounded-lg overflow-hidden border-2 flex items-center justify-center ${
                    s ? 'border-green-500' : 'border-dashed border-white/40'
                  }`}
                >
                  {s ? (
                    <img src={s.dataUrl} alt={`${i + 1}번째 사진`} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-[11px] text-white/60 font-bold">{i + 1}</span>
                  )}
                </div>
              );
            })}
          </div>

          {/* 단추 */}
          <div className="flex-1 min-w-0">
            {done ? (
              <div className="flex gap-2">
                <button
                  onClick={reset}
                  aria-label="다시 찍기"
                  className="w-12 h-12 rounded-lg bg-slate-900/80 text-white flex items-center justify-center shrink-0"
                >
                  <RotateCcw className="w-5 h-5" aria-hidden="true" />
                </button>
                <button
                  onClick={() => onComplete(shots)}
                  className="flex-1 h-12 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm transition-colors flex items-center justify-center gap-2"
                >
                  <Check className="w-5 h-5" aria-hidden="true" />
                  신고서 작성으로
                </button>
              </div>
            ) : (
              <button
                onClick={shoot}
                disabled={!shootable}
                className="w-full h-12 rounded-lg bg-blue-600 enabled:hover:bg-blue-700 disabled:bg-slate-600 disabled:text-white/60 text-white font-bold text-sm transition-colors flex items-center justify-center gap-2"
              >
                <Camera className="w-5 h-5" aria-hidden="true" />
                {shots.length === 0 ? '첫 번째 사진' : '두 번째 사진'}
              </button>
            )}
          </div>
        </div>

        {done && (
          <p className="mt-2 text-center text-xs text-white/80 tabular-nums">
            {Math.floor((shots[1].takenAt - shots[0].takenAt) / 1000)}초 간격 ·{' '}
            {formatStamp(shots[0].takenAt).slice(11)} → {formatStamp(shots[1].takenAt).slice(11)}
          </p>
        )}
      </div>

      {/* --- 이 화면이 바꾸는 것 --- */}
      {why && (
        <div className="absolute inset-0 z-20 bg-white overflow-y-auto">
          <div className="sticky top-0 bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between">
            <p className="font-bold text-slate-900">이 화면이 바꾸는 것</p>
            <button onClick={() => setWhy(false)} aria-label="닫기" className="w-8 h-8 flex items-center justify-center">
              <X className="w-5 h-5 text-slate-500" aria-hidden="true" />
            </button>
          </div>
          <div className="p-4 space-y-3 text-sm text-slate-600">
            <p>
              <b className="text-slate-900">앱을 켜면 곧 촬영</b> — 지금은 팝업을 닫고 유형을 고른
              뒤에야 카메라가 열립니다. 그 사이 차가 떠납니다. (리뷰 13건)
            </p>
            <p>
              <b className="text-slate-900">60초를 앱이 대신 기다립니다</b> — 촬영 시각으로 세기
              때문에 앱을 나가도 카운트가 멈추지 않습니다. 차 옆에 서 있을 이유가 없습니다. (리뷰 22건)
            </p>
            <p>
              <b className="text-slate-900">첫 컷을 겹쳐 보여줍니다</b> — 같은 구도로 찍게 해 '사진
              구도·방향 불일치' 반려를 줄입니다.
            </p>
            <p>
              <b className="text-slate-900">촬영시각과 좌표를 사진에 박습니다</b> — '촬영시각 미표시',
              '위치 특정 불가'는 흔한 반려 사유입니다.
            </p>
            <p>
              <b className="text-slate-900">스크롤이 없습니다</b> — 길 한복판에서 한 손으로 쓰는
              화면이라 한눈에 들어와야 합니다.
            </p>
            <p className="text-xs text-slate-500 pt-2 border-t border-slate-200">
              근거: 2026년 구글플레이 리뷰 655건 분류 (docs/painpoints.md) · 국민제안 준비용
              비공식 시제품이며 실제 신고는 접수되지 않습니다.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
