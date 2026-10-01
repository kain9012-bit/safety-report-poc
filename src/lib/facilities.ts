/**
 * 주변 시설 불러오기 — 버스정류장(실시간 API) + 횡단보도·어린이보호구역(미리 모아 둔 격자 파일).
 *
 * 횡단보도·어린이보호구역 표준데이터 API는 "이 좌표 근처" 검색이 없고, 실시간 정류장 API(TAGO)에는
 * 서울이 없다. 그래서
 * scripts/collect_facilities.py 가 전북·서울 자료를 받아 0.01° 격자(약 1km)로 쪼개
 * public/fac/{위도칸}_{경도칸}.json 에 둔다. 사진 좌표 주변 3×3칸만 받아 앱 안에서 거리를 잰다.
 */
import { distanceMeters } from './geo';
import type { Facility, LatLng } from './geo';

/** 격자 한 칸 크기(도). 수집 스크립트와 같아야 한다. */
export const CELL_DEG = 0.01;

export function cellOf(p: LatLng): [number, number] {
  return [Math.floor(p.lat / CELL_DEG), Math.floor(p.lng / CELL_DEG)];
}

/** 주변 3×3칸. 어린이보호구역(300m)까지 보려면 옆 칸도 필요하다. */
export function cellsAround(p: LatLng): string[] {
  const [a, b] = cellOf(p);
  const out: string[] = [];
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) out.push(`${a + i}_${b + j}`);
  return out;
}

/** 격자 파일 한 칸. c: 횡단보도 [위도,경도], s: 어린이보호구역 대상시설 [위도,경도,이름], b: 버스정류장 [위도,경도,이름] */
export interface CellData {
  c?: [number, number][];
  s?: [number, number, string][];
  b?: [number, number, string][];
}

export interface Nearby {
  busstops: Facility[];
  crosswalks: Facility[];
  schools: Facility[];
}

export type NearbyState = 'ok' | 'partial' | 'no_data' | 'error';

export interface NearbyResult extends Nearby {
  state: NearbyState;
  /** 무엇이 빠졌는지 — 화면에 그대로 적는다 */
  missing: string[];
}

export function mergeCells(cells: (CellData | null)[]): Nearby {
  const crosswalks: Facility[] = [];
  const schools: Facility[] = [];
  const busstops: Facility[] = [];
  cells.forEach((c, ci) => {
    c?.c?.forEach(([lat, lng], i) => crosswalks.push({ id: `c${ci}-${i}`, lat, lng }));
    c?.s?.forEach(([lat, lng, name], i) => schools.push({ id: `s${ci}-${i}`, lat, lng, name }));
    c?.b?.forEach(([lat, lng, name], i) => busstops.push({ id: `b${ci}-${i}`, lat, lng, name }));
  });
  return { crosswalks, schools, busstops };
}

/** 실시간 API 정류장과 파일 정류장을 합친다. 3m 안에 겹치면 같은 정류장으로 본다(실시간 쪽을 남김). */
export function mergeStops(live: Facility[], file: Facility[]): Facility[] {
  const out = [...live];
  for (const f of file) {
    if (!out.some((s) => distanceMeters(s, f) < 3)) out.push(f);
  }
  return out;
}

async function loadCell(key: string): Promise<CellData | null> {
  const res = await fetch(`/fac/${key}.json`);
  if (res.status === 404) return null; // 그 칸에 시설이 없다
  if (!res.ok) throw new Error(`cell ${key} ${res.status}`);
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('json')) return null; // 없는 파일 대신 index.html 이 오는 호스팅
  return (await res.json()) as CellData;
}

export async function loadNearby(p: LatLng): Promise<NearbyResult> {
  const missing: string[] = [];

  const stopsP = fetch(`/api/stops?lat=${p.lat}&lng=${p.lng}`, { cache: 'no-store' })
    .then(async (r) => {
      const j = (await r.json().catch(() => ({}))) as { stops?: Facility[]; error?: string };
      if (!r.ok || !j.stops) {
        missing.push(j.error === 'no_key' ? '버스정류장(키 없음)' : '버스정류장(조회 실패)');
        return [] as Facility[];
      }
      return j.stops;
    })
    .catch(() => {
      missing.push('버스정류장(조회 실패)');
      return [] as Facility[];
    });

  // 자료를 아직 안 모았으면 meta.json 이 없다
  const gridP = (async () => {
    const meta = await fetch('/fac/meta.json').catch(() => null);
    const metaOk = meta?.ok && (meta.headers.get('content-type') ?? '').includes('json');
    if (!metaOk) {
      missing.push('횡단보도·어린이보호구역(자료 수집 전)');
      return { crosswalks: [], schools: [], busstops: [] as Facility[], noData: true };
    }
    try {
      const cells = await Promise.all(cellsAround(p).map(loadCell));
      return { ...mergeCells(cells), noData: false };
    } catch {
      missing.push('횡단보도·어린이보호구역(불러오기 실패)');
      return { crosswalks: [], schools: [], busstops: [] as Facility[], noData: false };
    }
  })();

  const [live, grid] = await Promise.all([stopsP, gridP]);
  const busstops = mergeStops(live, grid.busstops);
  // 실시간 조회가 실패해도 파일 정류장이 있으면 정류장 판단은 할 수 있다
  if (grid.busstops.length > 0) {
    const i = missing.findIndex((m) => m.startsWith('버스정류장'));
    if (i >= 0) missing.splice(i, 1);
  }
  const state: NearbyState =
    missing.length === 0 ? 'ok' : missing.length >= 2 ? (grid.noData ? 'no_data' : 'error') : 'partial';
  return { busstops, crosswalks: grid.crosswalks, schools: grid.schools, state, missing };
}
