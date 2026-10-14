import L from 'leaflet';
import type { LatLng } from './geo';

export interface MapMark extends LatLng { label: string; color: string; accuracy?: number; bearing?: number; onClick?: () => void }
export interface MapController {
  provider: 'kakao' | 'vworld';
  center(p: LatLng): void;
  zoomIn(): void;
  zoomOut(): void;
  layer(satellite: boolean): void;
  marks(items: MapMark[]): void;
  destroy(): void;
}
interface KakaoPosition { getLat(): number; getLng(): number }
interface KakaoMap { getCenter(): KakaoPosition; setCenter(p: KakaoPosition): void; getLevel(): number; setLevel(level: number): void; setMapTypeId(id: number): void; relayout(): void }
interface KakaoOverlay { setMap(map: KakaoMap | null): void }
interface KakaoSDK {
  load(ready: () => void): void;
  LatLng: new (lat: number, lng: number) => KakaoPosition;
  Map: new (element: HTMLElement, options: { center: KakaoPosition; level: number }) => KakaoMap;
  Circle: new (options: { center: KakaoPosition; radius: number; strokeColor: string; strokeWeight: number; fillColor: string; fillOpacity: number; map: KakaoMap }) => KakaoOverlay;
  CustomOverlay: new (options: { position: KakaoPosition; content: HTMLElement; yAnchor: number; map: KakaoMap }) => KakaoOverlay;
  MapTypeId: { ROADMAP: number; HYBRID: number };
  event: { addListener(map: KakaoMap, name: string, handler: () => void): void; removeListener(map: KakaoMap, name: string, handler: () => void): void };
}
let sdkPromise: Promise<KakaoSDK> | undefined;
function kakaoSDK(key: string): Promise<KakaoSDK> {
  const existing = (window as Window & { kakao?: { maps?: KakaoSDK } }).kakao?.maps;
  if (existing) return new Promise((resolve) => existing.load(() => resolve(existing)));
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise<KakaoSDK>((resolve, reject) => {
    const script = document.createElement('script');
    const timer = setTimeout(() => { script.remove(); reject(new Error('map_timeout')); }, 8_000);
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(key)}&autoload=false`;
    script.async = true;
    script.onerror = () => { clearTimeout(timer); script.remove(); reject(new Error('map_load')); };
    script.onload = () => {
      const sdk = (window as Window & { kakao?: { maps?: KakaoSDK } }).kakao?.maps;
      if (!sdk) { clearTimeout(timer); reject(new Error('map_sdk')); return; }
      sdk.load(() => { clearTimeout(timer); resolve(sdk); });
    };
    document.head.appendChild(script);
  }).catch((error) => { sdkPromise = undefined; throw error; });
  return sdkPromise;
}
function markElement(mark: MapMark): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button'; el.textContent = mark.label; el.style.cssText = `border:2px solid ${mark.color};background:white;color:#0f172a;border-radius:8px;padding:3px 6px;font-size:11px;max-width:160px;white-space:normal;`;
  if (mark.bearing !== undefined) { const arrow = document.createElement('span'); arrow.textContent = '↑'; arrow.style.display = 'inline-block'; arrow.style.transform = `rotate(${mark.bearing}deg)`; el.prepend(arrow); }
  el.addEventListener('click', (event) => { event.stopPropagation(); mark.onClick?.(); });
  return el;
}
export async function createMapController(element: HTMLElement, origin: LatLng, onCenter: (p: LatLng) => void, onDrag: () => void, onTiles: (state: 'loading' | 'ok' | 'failed') => void, isCancelled: () => boolean = () => false): Promise<MapController> {
  const key = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_KAKAO_MAP_JS_KEY?.trim();
  if (key) {
    try {
      const sdk = await kakaoSDK(key);
      if (isCancelled()) throw new Error('cancelled');
      const map = new sdk.Map(element, { center: new sdk.LatLng(origin.lat, origin.lng), level: 3 });
      let overlays: KakaoOverlay[] = [];
      const idle = () => { const p = map.getCenter(); onCenter({ lat: p.getLat(), lng: p.getLng() }); };
      const loaded = () => onTiles('ok');
      sdk.event.addListener(map, 'idle', idle); sdk.event.addListener(map, 'dragstart', onDrag); sdk.event.addListener(map, 'tilesloaded', loaded);
      onTiles('loading');
      const timer = setTimeout(() => { map.relayout(); onCenter(origin); }, 50);
      return { provider: 'kakao', center(p) { map.setCenter(new sdk.LatLng(p.lat, p.lng)); }, zoomIn() { map.setLevel(Math.max(1, map.getLevel() - 1)); }, zoomOut() { map.setLevel(Math.min(14, map.getLevel() + 1)); }, layer(satellite) { map.setMapTypeId(satellite ? sdk.MapTypeId.HYBRID : sdk.MapTypeId.ROADMAP); }, marks(items) {
        overlays.forEach((o) => o.setMap(null)); overlays = [];
        for (const mark of items) {
          const p = new sdk.LatLng(mark.lat, mark.lng);
          if (mark.accuracy !== undefined && Number.isFinite(mark.accuracy) && mark.accuracy >= 0) overlays.push(new sdk.Circle({ center: p, radius: mark.accuracy, strokeColor: mark.color, strokeWeight: 1, fillColor: mark.color, fillOpacity: 0.1, map }));
          overlays.push(new sdk.CustomOverlay({ position: p, content: markElement(mark), yAnchor: 1, map }));
        }
      }, destroy() { clearTimeout(timer); overlays.forEach((o) => o.setMap(null)); sdk.event.removeListener(map, 'idle', idle); sdk.event.removeListener(map, 'dragstart', onDrag); sdk.event.removeListener(map, 'tilesloaded', loaded); element.replaceChildren(); } };
    } catch { /* Unconfigured/failed official SDK preserves the existing VWorld path. */ }
  }
  if (isCancelled()) throw new Error('cancelled');
  const map = L.map(element, { center: [origin.lat, origin.lng], zoom: 17, minZoom: 7, maxZoom: 19, zoomControl: false });
  map.attributionControl.setPrefix(false);
  const marks = L.layerGroup().addTo(map); let tiles: L.TileLayer | undefined;
  map.on('moveend', () => { const p = map.getCenter(); onCenter({ lat: p.lat, lng: p.lng }); });
  map.on('dragstart', onDrag);
  const layer = (satellite: boolean) => {
    tiles?.remove(); let loaded = false; onTiles('loading');
    tiles = L.tileLayer(`/api/tile?layer=${satellite ? 'Satellite' : 'Base'}&z={z}&x={x}&y={y}`, { minZoom: 6, maxZoom: 19, attribution: '© 브이월드(국토교통부)' });
    tiles.on('tileload', () => { loaded = true; onTiles('ok'); }); tiles.on('tileerror', () => { if (!loaded) onTiles('failed'); }); tiles.addTo(map);
  };
  layer(false);
  const timer = setTimeout(() => { map.invalidateSize(); onCenter(origin); }, 50);
  return { provider: 'vworld', center(p) { map.setView([p.lat, p.lng], map.getZoom()); }, zoomIn() { map.zoomIn(); }, zoomOut() { map.zoomOut(); }, layer, marks(items) {
    marks.clearLayers();
    for (const mark of items) {
      if (mark.accuracy !== undefined && Number.isFinite(mark.accuracy) && mark.accuracy >= 0) L.circle([mark.lat, mark.lng], { radius: mark.accuracy, color: mark.color, weight: 1, fillOpacity: 0.1, interactive: false }).addTo(marks);
      L.marker([mark.lat, mark.lng], { icon: L.divIcon({ html: markElement(mark), className: '', iconSize: [110, 30], iconAnchor: [55, 30] }) }).addTo(marks);
    }
  }, destroy() { clearTimeout(timer); map.remove(); } };
}
