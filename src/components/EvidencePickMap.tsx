import 'leaflet/dist/leaflet.css';
import { LocateFixed, MapPin, Minus, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Facility, LatLng } from '../lib/geo';
import type { CaptureHeadingSnapshot } from '../lib/heading';
import { requestCurrentLocation, LOCATION_LABEL } from '../lib/locationQuality';
import type { CaptureLocationSnapshot } from '../lib/locationQuality';
import { createMapController } from '../lib/mapProvider';
import type { MapController, MapMark } from '../lib/mapProvider';
import { stopKey } from '../lib/stopCandidates';
export type { LatLng } from '../lib/geo';
interface Props {
  origin: LatLng;
  accuracy?: number;
  originRole?: 'photo' | 'search' | 'manual_vehicle';
  onCenter: (c: LatLng) => void;
  stops?: Facility[];
  selectedStopKey?: string;
  onStopSelect?: (stop: Facility) => void;
  heading?: CaptureHeadingSnapshot;
}
/** Moving the map changes only a draft center. Parent commits it through an explicit apply action. */
export default function PickMap({ origin, accuracy, originRole = 'photo', onCenter, stops = [], selectedStopKey, onStopSelect, heading }: Props) {
  const el = useRef<HTMLDivElement>(null); const controller = useRef<MapController | null>(null);
  const onCenterRef = useRef(onCenter); onCenterRef.current = onCenter;
  const dragVersion = useRef(0); const mounted = useRef(false);
  const [provider, setProvider] = useState<'kakao' | 'vworld'>('vworld');
  const [ready, setReady] = useState(false); const [satellite, setSatellite] = useState(false);
  const [tileState, setTileState] = useState<'loading' | 'ok' | 'failed'>('loading');
  const [current, setCurrent] = useState<CaptureLocationSnapshot>(); const [locating, setLocating] = useState(false);
  const [locationMessage, setLocationMessage] = useState('');
  useEffect(() => {
    if (!el.current) return;
    mounted.current = true; let cancelled = false;
    const element = el.current;
    void Promise.resolve().then(() => { if (cancelled) return; return createMapController(element, origin, (p) => { if (!cancelled) onCenterRef.current(p); }, () => { dragVersion.current++; }, (state) => { if (!cancelled) setTileState(state); }, () => cancelled); }).then((map) => {
      if (!map) return;
      if (cancelled) { map.destroy(); return; }
      controller.current = map; setProvider(map.provider); setReady(true);
    }).catch(() => { if (!cancelled) setTileState('failed'); });
    return () => { cancelled = true; mounted.current = false; controller.current?.destroy(); controller.current = null; };
    // A changed draft center is not a new origin. Reopening the sheet starts a fresh map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { controller.current?.layer(satellite); }, [satellite, ready]);
  useEffect(() => {
    const items: MapMark[] = [{ ...origin, accuracy: originRole === 'photo' ? accuracy : undefined, color: '#2563eb', label: originRole === 'photo' ? '사진 촬영 위치' : originRole === 'manual_vehicle' ? '사용자 지정 차량 위치' : '탐색 시작 위치', bearing: heading?.status === 'usable' ? heading.sample?.bearing : undefined }];
    if (current?.sample) items.push({ ...current.sample, color: '#7c3aed', label: '현재 기기 위치' });
    for (const stop of stops) items.push({ ...stop, label: `${selectedStopKey === stopKey(stop) ? '선택 · ' : ''}${stop.name || '정류소'}${stop.publicId ? ` (${stop.publicId})` : ''}`, color: selectedStopKey === stopKey(stop) ? '#b45309' : '#15803d', onClick: () => onStopSelect?.(stop) });
    controller.current?.marks(items);
  }, [origin, accuracy, originRole, current, stops, selectedStopKey, onStopSelect, heading, ready]);
  const locate = async () => {
    if (locating) return; setLocating(true); const atDrag = dragVersion.current;
    const result = await requestCurrentLocation();
    if (!mounted.current) return;
    setLocating(false);
    if (!result.sample || result.quality.status === 'stale') { setLocationMessage(result.quality.reasons[0] || '위치를 확인하지 못했어요. 기존 위치는 유지해요.'); return; }
    setCurrent(result); setLocationMessage(`${LOCATION_LABEL[result.quality.status]} · 현재 위치는 사진 GPS에 저장되지 않아요.`);
    if (atDrag === dragVersion.current) controller.current?.center(result.sample);
  };
  return (
    <div className="relative isolate aspect-square border border-slate-300 bg-slate-100 overflow-hidden">
      <div ref={el} className="absolute inset-0" />
      <MapPin className="pointer-events-none absolute left-1/2 top-1/2 z-[1001] -translate-x-1/2 -translate-y-full w-11 h-11 text-[#3a8fdb] fill-white drop-shadow" strokeWidth={2.5} aria-hidden="true" />
      <div className="absolute top-3 left-3 z-[1001] flex flex-col gap-1">
        <button type="button" onClick={() => { dragVersion.current++; controller.current?.center(origin); }} className="rounded bg-white shadow px-2 py-2 text-xs text-slate-800">{originRole === 'photo' ? '촬영 위치 보기' : originRole === 'manual_vehicle' ? '지정한 차량 위치 보기' : '시작 위치 보기'}</button>
        <button type="button" onClick={() => void locate()} disabled={locating} className="rounded bg-[#3a8fdb] text-white shadow px-2 py-2 text-xs flex items-center gap-1 disabled:opacity-50"><LocateFixed className="w-4 h-4" />{locating ? '현재 위치 확인 중' : '현재 위치 다시 찾기'}</button>
      </div>
      <div className="absolute top-3 right-14 z-[1001] flex bg-white shadow rounded-sm overflow-hidden text-xs">
        {[false, true].map((value) => <button type="button" key={String(value)} onClick={() => setSatellite(value)} className={`px-2 h-9 ${satellite === value ? 'bg-[#3a8fdb] text-white' : 'text-slate-800'}`}>{value ? '스카이뷰' : '지도'}</button>)}
      </div>
      <div className="absolute top-3 right-2 z-[1001] flex flex-col bg-white shadow rounded-sm">
        <button type="button" onClick={() => controller.current?.zoomIn()} aria-label="확대" className="w-10 h-10 flex items-center justify-center border-b border-slate-200"><Plus className="w-5 h-5 text-slate-700" /></button>
        <button type="button" onClick={() => controller.current?.zoomOut()} aria-label="축소" className="w-10 h-10 flex items-center justify-center"><Minus className="w-5 h-5 text-slate-700" /></button>
      </div>
      <div className="absolute bottom-6 inset-x-2 z-[1001] bg-white/95 text-[11px] text-slate-700 rounded px-2 py-1" aria-live="polite">
        <p>{provider === 'kakao' ? '카카오 지도' : '브이월드 지도'} · 가운데 핀은 선택 중인 위치예요. 적용 전에는 저장되지 않아요.</p>
        {locationMessage && <p>{locationMessage}</p>}
        {tileState === 'failed' && <p>지도를 불러오지 못했어요. 사진 보관과 주소 직접 입력은 계속할 수 있어요.</p>}
      </div>
    </div>
  );
}
