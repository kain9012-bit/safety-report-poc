/**
 * 사진 판독 부르기 — 사진 두 장을 줄여서 /api/vision 에 보낸다.
 * 신고서에 붙는 원본 사진은 그대로 두고, 판독용 사본만 줄인다(전송량·대기시간).
 */
import type { PhotoRead, VisionResult } from '../../api/vision';

export type VisionState = 'idle' | 'loading' | 'ok' | 'no_key' | 'rate_limited' | 'busy' | 'error';

/** 판독용 사본의 긴 변(px). 번호판 글자가 읽힐 만큼은 남긴다. */
export const VISION_EDGE = 1280;

export function scaledSize(w: number, h: number, edge = VISION_EDGE): [number, number] {
  const k = Math.min(1, edge / Math.max(w, h));
  return [Math.round(w * k), Math.round(h * k)];
}

async function shrink(dataUrl: string): Promise<string> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const [w, h] = scaledSize(img.naturalWidth, img.naturalHeight);
  if (w === img.naturalWidth) return dataUrl;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d')!.drawImage(img, 0, 0, w, h);
  return c.toDataURL('image/jpeg', 0.85);
}

export async function readPhotos(dataUrls: string[]): Promise<{ state: VisionState; result?: VisionResult }> {
  try {
    const images = await Promise.all(dataUrls.slice(0, 2).map(shrink));
    const res = await fetch('/api/vision', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ images }),
    });
    const j = (await res.json().catch(() => ({}))) as VisionResult & { error?: string };
    if (res.ok && j.plate) return { state: 'ok', result: j };
    if (j.error === 'no_key') return { state: 'no_key' };
    if (j.error === 'rate_limited') return { state: 'rate_limited' };
    if (j.error === 'busy') return { state: 'busy' };
    return { state: 'error' };
  } catch {
    return { state: 'error' };
  }
}

/** 사진 한 장 판독 — 첫 사진을 찍자마자 부른다(회의 결정: 둘째 사진 전에 판독·안내) */
export async function readOne(
  dataUrl: string,
): Promise<{ state: VisionState; read?: PhotoRead | null; model?: string }> {
  const r = await readPhotos([dataUrl]);
  return r.result ? { state: r.state, read: r.result.photos[0] ?? null, model: r.result.model } : { state: r.state };
}
