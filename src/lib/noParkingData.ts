/**
 * 주정차금지구역 자료 읽기(public/noparking/). 규칙은 noParking.ts — 이 파일은 내려받기만 한다.
 * 못 받으면 조용히 '없음'으로 둔다. 참고 안내라서 신고 흐름을 막지 않는다.
 */
import { findRegion, roadOf, zonesOnRoad } from './noParking';
import type { NoParkingZone, RegionEntry } from './noParking';

interface IndexFile {
  collectedAt: string;
  regions: RegionEntry[];
}

let indexP: Promise<IndexFile | null> | null = null;
const regionCache = new Map<string, Promise<NoParkingZone[]>>();

function loadIndex(): Promise<IndexFile | null> {
  indexP ??= fetch('/noparking/index.json')
    .then((r) => (r.ok ? (r.json() as Promise<IndexFile>) : null))
    .catch(() => null);
  return indexP;
}

function loadRegion(code: string): Promise<NoParkingZone[]> {
  let p = regionCache.get(code);
  if (!p) {
    p = fetch(`/noparking/${code}.json`)
      .then((r) => (r.ok ? (r.json() as Promise<NoParkingZone[]>) : []))
      .catch(() => []);
    regionCache.set(code, p);
  }
  return p;
}

export interface NoParkingHere {
  road: string;
  region: string;
  zones: NoParkingZone[];
}

/** 도로명주소 → 같은 도로의 주정차금지 구간. 도로명주소가 아니거나 자료가 없으면 null */
export async function noParkingFor(roadAddress?: string): Promise<NoParkingHere | null> {
  const road = roadAddress ? roadOf(roadAddress) : undefined;
  if (!roadAddress || !road) return null;
  const idx = await loadIndex();
  const region = idx ? findRegion(roadAddress, idx.regions) : undefined;
  if (!region) return null;
  const zones = zonesOnRoad(await loadRegion(region.code), road);
  return zones.length ? { road, region: `${region.sido} ${region.sigungu}`, zones } : null;
}
