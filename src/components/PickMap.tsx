import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { LocateFixed, MapPin, Minus, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

export interface LatLng {
  lat: number;
  lng: number;
}

interface Props {
  /** 지도를 처음 펼칠 자리 — 보통 사진 좌표 */
  origin: LatLng;
  /** 사진 좌표의 GPS 오차(m). 있으면 오차 범위를 원으로 그린다. */
  accuracy?: number;
  /** 지도를 움직여 멈출 때마다 가운데 좌표를 알린다 */
  onCenter: (c: LatLng) => void;
}

type Layer = 'Base' | 'Satellite';

/**
 * 위치찾기 지도 — 지금 앱과 같이 지도/스카이뷰, 확대·축소, 위치 초기화.
 * 핀은 화면 가운데 고정이고 지도를 끌어서 맞춘다. 타일은 /api/tile 이 키를 붙여 대신 받아온다.
 */
export default function PickMap({ origin, accuracy, onCenter }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const onCenterRef = useRef(onCenter);
  onCenterRef.current = onCenter;

  const [layer, setLayer] = useState<Layer>('Base');
  const [tileState, setTileState] = useState<'loading' | 'ok' | 'failed'>('loading');

  useEffect(() => {
    if (!el.current) return;
    const map = L.map(el.current, {
      center: [origin.lat, origin.lng],
      zoom: 17,
      minZoom: 7,
      maxZoom: 19,
      zoomControl: false,
      attributionControl: true,
    });
    map.attributionControl.setPrefix(false);
    if (accuracy !== undefined) {
      L.circle([origin.lat, origin.lng], {
        radius: accuracy,
        color: '#3a8fdb',
        weight: 1,
        fillOpacity: 0.12,
        interactive: false,
      }).addTo(map);
    }
    map.on('moveend', () => {
      const c = map.getCenter();
      onCenterRef.current({ lat: c.lat, lng: c.lng });
    });
    mapRef.current = map;
    // 시트가 펼쳐진 뒤 크기를 다시 잰다
    const t = setTimeout(() => map.invalidateSize(), 50);
    onCenterRef.current(origin);
    return () => {
      clearTimeout(t);
      map.remove();
      mapRef.current = null;
    };
    // 처음 한 번만 만든다. 다시 맞출 때는 recenter를 쓴다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let loaded = false;
    setTileState('loading');
    const tl = L.tileLayer(`/api/tile?layer=${layer}&z={z}&x={x}&y={y}`, {
      minZoom: 6,
      maxZoom: 19,
      attribution: '© 브이월드(국토교통부)',
    });
    tl.on('tileload', () => {
      loaded = true;
      setTileState('ok');
    });
    tl.on('tileerror', () => {
      if (!loaded) setTileState('failed');
    });
    tl.addTo(map);
    return () => {
      tl.remove();
    };
  }, [layer]);

  const recenter = () => mapRef.current?.setView([origin.lat, origin.lng], 17);

  return (
    <div className="relative isolate aspect-square border border-slate-300 bg-slate-100 overflow-hidden">
      <div ref={el} className="absolute inset-0" />

      {/* 가운데 고정 핀 — 핀 끝이 정확히 가운데에 오도록 위로 올린다 */}
      <MapPin
        className="pointer-events-none absolute left-1/2 top-1/2 z-[1001] -translate-x-1/2 -translate-y-full w-11 h-11 text-[#3a8fdb] fill-white drop-shadow"
        strokeWidth={2.5}
        aria-hidden="true"
      />

      <button
        onClick={recenter}
        className="absolute top-3 left-3 z-[1001] w-[76px] h-[76px] rounded-full bg-[#3a8fdb] text-white text-[14px] leading-tight flex flex-col items-center justify-center shadow"
      >
        <LocateFixed className="w-5 h-5" aria-hidden="true" />
        위치
        <br />
        초기화
      </button>

      <div className="absolute top-3 right-14 z-[1001] flex bg-white shadow rounded-sm overflow-hidden text-[15px]">
        {(['Base', 'Satellite'] as Layer[]).map((l) => (
          <button
            key={l}
            onClick={() => setLayer(l)}
            className={`px-3 h-10 ${layer === l ? 'bg-[#3a8fdb] text-white' : 'text-slate-800'}`}
          >
            {l === 'Base' ? '지도' : '스카이뷰'}
          </button>
        ))}
      </div>

      <div className="absolute top-3 right-2 z-[1001] flex flex-col bg-white shadow rounded-sm">
        <button
          onClick={() => mapRef.current?.zoomIn()}
          aria-label="확대"
          className="w-10 h-10 flex items-center justify-center border-b border-slate-200"
        >
          <Plus className="w-5 h-5 text-slate-700" aria-hidden="true" />
        </button>
        <button
          onClick={() => mapRef.current?.zoomOut()}
          aria-label="축소"
          className="w-10 h-10 flex items-center justify-center"
        >
          <Minus className="w-5 h-5 text-slate-700" aria-hidden="true" />
        </button>
      </div>

      {tileState === 'failed' && (
        <p className="absolute bottom-8 inset-x-3 z-[1001] text-center text-[13px] bg-white/90 rounded py-1.5 text-slate-600">
          지도를 불러오지 못했습니다 — 지도 키 설정을 확인해 주세요
        </p>
      )}
    </div>
  );
}
