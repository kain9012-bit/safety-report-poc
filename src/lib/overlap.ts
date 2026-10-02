/**
 * 두 사진이 같은 자리에서 찍혔는가 — **규칙 기반 영상 대조. AI를 쓰지 않는다.**
 *
 * 두 사진을 작게 줄여 윤곽(밝기 변화)만 남긴 뒤, 한 장을 상하좌우로 밀어 보며
 * 가장 잘 맞는 위치를 찾는다. 그 위치에서
 *  - 겹치는 면적 비율(ratio) — 같은 구도에서 얼마나 벗어났나
 *  - 겹친 부분의 닮은 정도(score, 정규화 상관계수 -1~1) — 정말 같은 장면인가
 * 를 돌려준다. 회의 결정: 일정 비율(예: 50%) 이상 겹쳐야 신고할 수 있다.
 *
 * 한계 — 확대·축소(가까이 다가가 찍음)나 큰 회전은 잡지 못한다. 그때는 겹침이 낮게 나온다.
 * 사진 아래쪽의 촬영시각 표시는 두 장이 달라 대조에서 뺀다.
 */

/** 겹침 기준(회의 결정 예시 50%) — 접수 측 기준 확인 후 조정 */
export const OVERLAP_MIN = 0.5;
/** 같은 장면으로 보는 닮음 기준 — 현장 사진으로 조정 필요 */
export const SCORE_MIN = 0.45;
/** 대조용 축소 너비(px) */
export const WORK_W = 96;
/** 사진 아래 이 비율은 촬영시각 표시가 있어 뺀다 */
export const STAMP_CUT = 0.15;

export interface Feature {
  w: number;
  h: number;
  data: Float32Array;
}

export interface OverlapResult {
  /** 겹치는 면적 비율 0~1 */
  ratio: number;
  /** 겹친 부분 닮음 -1~1 */
  score: number;
  dx: number;
  dy: number;
  /** ratio·score 가 둘 다 기준을 넘었는가 */
  same: boolean;
}

/** RGBA → 회색조 → 윤곽 세기(가로·세로 차이). 밝기가 달라도 윤곽은 비슷하다. */
export function toFeature(rgba: ArrayLike<number>, w: number, h: number): Feature {
  const g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    g[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
  }
  const e = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const gx = x + 1 < w ? g[i + 1] - g[i] : 0;
      const gy = y + 1 < h ? g[i + w] - g[i] : 0;
      e[i] = Math.sqrt(gx * gx + gy * gy);
    }
  }
  return { w, h, data: e };
}

/** b 를 (dx, dy) 만큼 옮겨 a 에 댔을 때의 상관계수와 겹친 면적 */
function corrAt(a: Feature, b: Feature, dx: number, dy: number): { score: number; area: number } {
  const x0 = Math.max(0, dx);
  const x1 = Math.min(a.w, b.w + dx);
  const y0 = Math.max(0, dy);
  const y1 = Math.min(a.h, b.h + dy);
  if (x1 <= x0 || y1 <= y0) return { score: -1, area: 0 };
  let n = 0;
  let sa = 0;
  let sb = 0;
  let saa = 0;
  let sbb = 0;
  let sab = 0;
  for (let y = y0; y < y1; y++) {
    const ra = y * a.w;
    const rb = (y - dy) * b.w - dx;
    for (let x = x0; x < x1; x++) {
      const va = a.data[ra + x];
      const vb = b.data[rb + x];
      sa += va;
      sb += vb;
      saa += va * va;
      sbb += vb * vb;
      sab += va * vb;
      n++;
    }
  }
  const cov = sab / n - (sa / n) * (sb / n);
  const va = saa / n - (sa / n) ** 2;
  const vb = sbb / n - (sb / n) ** 2;
  const score = va > 1e-6 && vb > 1e-6 ? cov / Math.sqrt(va * vb) : -1;
  return { score, area: n };
}

/**
 * 가장 잘 맞는 밀기를 찾는다. 겹침이 minArea 보다 작은 밀기는 보지 않는다
 * (작은 조각끼리는 우연히 닮기 쉽다).
 */
export function estimateOverlap(a: Feature, b: Feature, minArea = 0.3): OverlapResult {
  const total = a.w * a.h;
  const mx = Math.floor(a.w / 2);
  const my = Math.floor(a.h / 2);
  let best = { score: -1, area: 0, dx: 0, dy: 0 };
  // 2칸씩 훑고, 가장 좋은 곳 둘레를 1칸씩 다시 본다
  for (let dy = -my; dy <= my; dy += 2) {
    for (let dx = -mx; dx <= mx; dx += 2) {
      const r = corrAt(a, b, dx, dy);
      if (r.area / total < minArea) continue;
      if (r.score > best.score) best = { ...r, dx, dy };
    }
  }
  const c = best;
  for (let dy = c.dy - 1; dy <= c.dy + 1; dy++) {
    for (let dx = c.dx - 1; dx <= c.dx + 1; dx++) {
      const r = corrAt(a, b, dx, dy);
      if (r.area / total < minArea) continue;
      if (r.score > best.score) best = { ...r, dx, dy };
    }
  }
  const ratio = best.area / total;
  const score = Math.max(-1, Math.min(1, best.score));
  return { ratio, score, dx: best.dx, dy: best.dy, same: score >= SCORE_MIN && ratio >= OVERLAP_MIN };
}

/** 브라우저: 사진(data URL) → 대조용 윤곽. 촬영시각 표시 부분은 잘라낸다. */
export async function featureOf(dataUrl: string): Promise<Feature> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const w = WORK_W;
  const fullH = Math.max(8, Math.round((img.naturalHeight / img.naturalWidth) * w));
  const h = Math.max(8, Math.round(fullH * (1 - STAMP_CUT)));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  // 원본의 위쪽(1 - STAMP_CUT) 부분만 그린다
  ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight * (1 - STAMP_CUT), 0, 0, w, h);
  return toFeature(ctx.getImageData(0, 0, w, h).data, w, h);
}

/** 브라우저: 두 사진의 겹침. 실패하면 null(판정 보류). */
export async function compareShots(a: string, b: string): Promise<OverlapResult | null> {
  try {
    const [fa, fb] = await Promise.all([featureOf(a), featureOf(b)]);
    if (fa.w !== fb.w || Math.abs(fa.h - fb.h) > 1) return { ratio: 0, score: -1, dx: 0, dy: 0, same: false };
    const h = Math.min(fa.h, fb.h);
    const trim = (f: Feature): Feature => ({ w: f.w, h, data: f.data.subarray(0, f.w * h) });
    return estimateOverlap(trim(fa), trim(fb));
  } catch {
    return null;
  }
}
