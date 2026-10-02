import { describe, expect, it } from 'vitest';
import { OVERLAP_MIN, estimateOverlap, toFeature } from './overlap';

/** 재현 가능한 난수 */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** 거리 풍경 비슷한 큰 판 — 덩어리(차·건물) + 줄(차선) + 잔무늬 */
function scene(W: number, H: number, seed: number): Float32Array {
  const r = rng(seed);
  const g = new Float32Array(W * H).fill(120);
  for (let k = 0; k < 40; k++) {
    const x0 = Math.floor(r() * W);
    const y0 = Math.floor(r() * H);
    const w = 6 + Math.floor(r() * 30);
    const h = 4 + Math.floor(r() * 20);
    const v = 40 + r() * 180;
    for (let y = y0; y < Math.min(H, y0 + h); y++) for (let x = x0; x < Math.min(W, x0 + w); x++) g[y * W + x] = v;
  }
  for (let i = 0; i < g.length; i++) g[i] += (r() - 0.5) * 10;
  return g;
}

/** 큰 판에서 (ox, oy) 자리의 w×h 창을 RGBA로 떠 낸다. gain 으로 밝기를 바꿀 수 있다. */
function crop(g: Float32Array, W: number, ox: number, oy: number, w: number, h: number, gain = 1): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = g[(oy + y) * W + (ox + x)] * gain;
      const i = (y * w + x) * 4;
      out[i] = out[i + 1] = out[i + 2] = v;
      out[i + 3] = 255;
    }
  }
  return out;
}

const W = 200;
const H = 140;
const w = 96;
const h = 60;
const big = scene(W, H, 7);
const feat = (ox: number, oy: number, src = big, gain = 1) => toFeature(crop(src, W, ox, oy, w, h, gain), w, h);

describe('두 사진 겹침(규칙 기반 영상 대조)', () => {
  it('같은 구도면 거의 다 겹친다', () => {
    const r = estimateOverlap(feat(40, 30), feat(40, 30));
    expect(r.ratio).toBeGreaterThan(0.95);
    expect(r.score).toBeGreaterThan(0.9);
    expect(r.same).toBe(true);
  });

  it('조금 비켜 찍어도(가로 10·세로 4칸) 같은 자리로 본다 — 밀린 거리도 찾는다', () => {
    const r = estimateOverlap(feat(40, 30), feat(50, 34));
    expect(r.same).toBe(true);
    expect(Math.abs(r.dx)).toBe(10);
    expect(Math.abs(r.dy)).toBe(4);
    expect(r.ratio).toBeGreaterThan(0.75);
  });

  it('밝기가 달라도(해가 가림) 윤곽으로 맞춘다', () => {
    const r = estimateOverlap(feat(40, 30), feat(44, 32, big, 0.7));
    expect(r.same).toBe(true);
  });

  it('절반 넘게 벗어나면 기준 미달', () => {
    const r = estimateOverlap(feat(20, 30), feat(80, 30));
    expect(r.ratio).toBeLessThan(OVERLAP_MIN);
    expect(r.same).toBe(false);
  });

  it('전혀 다른 장면이면 닮음이 낮다', () => {
    const other = scene(W, H, 99);
    const r = estimateOverlap(feat(40, 30), feat(40, 30, other));
    expect(r.same).toBe(false);
  });
});
