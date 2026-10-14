/** Whole scene first, then at most two bounded crops from the preserved original. */
import { mergeReads } from '../../api/vision';
import type { PhotoRead, VisionResult } from '../../api/vision';
import { constrainSupplementalRead, normalizeDetailRequests, normalizeObservations } from './evidence';
import type { DetailRequest, EvidenceBox, EvidenceObservation } from '../types/evidence';

export type VisionState = 'idle' | 'loading' | 'ok' | 'no_key' | 'rate_limited' | 'busy' | 'error';
export const VISION_EDGE = 1280;
export const MAX_DETAIL_CROPS = 2;
export interface ReadOptions {
  photoIds?: string[];
  inputVersion?: string | number;
  signal?: AbortSignal;
  /** Prior primary image used only to verify the target of a supplemental image. */
  reference?: { dataUrl: string; photoId: string };
  /** User hint is a search region, never a positive observation. */
  regionHints?: { type: DetailRequest['type']; box: EvidenceBox }[];
  /** Disable only for a deliberately requested whole-scene-only review. */
  detailReview?: boolean;
}

export function scaledSize(w: number, h: number, edge = VISION_EDGE): [number, number] {
  const k = Math.min(1, edge / Math.max(w, h));
  return [Math.round(w * k), Math.round(h * k)];
}

async function decode(dataUrl: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  return img;
}

export async function shrink(dataUrl: string): Promise<string> {
  const img = await decode(dataUrl);
  const [w, h] = scaledSize(img.naturalWidth, img.naturalHeight);
  if (w === img.naturalWidth && h === img.naturalHeight && dataUrl.length < 1_600_000) return dataUrl;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('canvas_unavailable');
  context.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', 0.85);
}

/** Normalized rectangle is always in the original, never the thumbnail's pixel units. */
export function cropPixels(box: EvidenceBox, width: number, height: number): [number, number, number, number] | null {
  if (![width, height, ...box].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  const [y0, x0, y1, x1] = box;
  if (x0 < 0 || y0 < 0 || x1 > 1000 || y1 > 1000 || x1 <= x0 || y1 <= y0) return null;
  const x = Math.floor(x0 / 1000 * width), y = Math.floor(y0 / 1000 * height);
  const w = Math.ceil(x1 / 1000 * width) - x, h = Math.ceil(y1 / 1000 * height) - y;
  if (w < 24 || h < 24 || w * h >= width * height * 0.85) return null;
  return [x, y, w, h];
}

async function originalCrop(dataUrl: string, box: EvidenceBox): Promise<string | null> {
  const img = await decode(dataUrl), pixels = cropPixels(box, img.naturalWidth, img.naturalHeight);
  if (!pixels) return null;
  const [x, y, w, h] = pixels, [cw, ch] = scaledSize(w, h, VISION_EDGE);
  const canvas = document.createElement('canvas');
  canvas.width = cw; canvas.height = ch;
  const context = canvas.getContext('2d');
  if (!context) return null;
  // No upscaling, restoration or original mutation.
  context.drawImage(img, x, y, w, h, 0, 0, cw, ch);
  return canvas.toDataURL('image/jpeg', 0.9);
}

export function detailPlan(reads: readonly (PhotoRead | null)[]): { imageIndex: number; request: DetailRequest }[] {
  const plan: { imageIndex: number; request: DetailRequest }[] = [];
  reads.forEach((read, imageIndex) => {
    for (const request of normalizeDetailRequests(read?.detailRequests)) {
      const observation = read?.observations?.find((o) => o.type === request.type);
      if (!observation || observation.identity === 'no') continue;
      const onlyLegalUnknown = observation.identity === 'yes' && observation.markingToTarget === 'yes' && observation.vehicleRelation === 'yes';
      const unreadNotice = observation.type === 'evcharging' && observation.sharedNotice && observation.sharedNotice.conditionsComplete !== 'yes';
      if (onlyLegalUnknown && !unreadNotice) continue;
      if (plan.some((p) => p.imageIndex === imageIndex && p.request.type === request.type)) continue;
      plan.push({ imageIndex, request });
    }
  });
  return plan.slice(0, MAX_DETAIL_CROPS);
}

/** First detector may miss a tiny facility: bounded overlapping strips also search unproposed regions. */
export function fallbackDetailPlan(reads: readonly (PhotoRead | null)[], dimensions: readonly [number, number][], existing: { imageIndex: number; request: DetailRequest }[] = []): { imageIndex: number; request: DetailRequest }[] {
  const result = [...existing].slice(0, MAX_DETAIL_CROPS);
  for (let imageIndex = 0; imageIndex < reads.length && result.length < MAX_DETAIL_CROPS; imageIndex++) {
    const read = reads[imageIndex], [width, height] = dimensions[imageIndex] ?? [0, 0];
    if (!read || read.analysisVersion !== 2 || read.observations?.some((o) => o.type === 'hydrant' && o.identity === 'yes') || Math.max(width, height) <= VISION_EDGE || !Number.isFinite(width + height)) continue;
    // Split along the long edge. A square image may gain attention rather than sampling resolution.
    const boxes: EvidenceBox[] = width >= height ? [[0, 0, 1000, 600], [0, 400, 1000, 1000]] : [[0, 0, 600, 1000], [400, 0, 1000, 1000]];
    for (const box of boxes) {
      if (result.length >= MAX_DETAIL_CROPS) break;
      if (!cropPixels(box, width, height)) continue;
      if (result.some((p) => p.imageIndex === imageIndex && p.request.box.join(',') === box.join(','))) continue;
      result.push({ imageIndex, request: { type: 'hydrant', box, reason: 'overlap_scan' } });
    }
  }
  return result;
}

const conflict = (a: string, b: string) => (a === 'yes' && b === 'no') || (a === 'no' && b === 'yes');

/** Crops can clarify identities/text; they cannot create a vehicle/bay relation. */
export function mergeDetailRead(first: PhotoRead, second: PhotoRead | null, requests: readonly DetailRequest[]): PhotoRead {
  if (!second) return { ...first, detailReview: 'unavailable' };
  const reviewed = new Set(requests.map((r) => r.type));
  const observations = (first.observations ?? []).map((before): EvidenceObservation => {
    const after = second.observations?.find((o) => o.type === before.type);
    if (!reviewed.has(before.type) || !after) return before;
    const identityConflict = conflict(before.identity, after.identity);
    const relationConflict = ['markingToTarget', 'vehicleRelation', 'boundary', 'chargerToTarget'].some((k) => conflict(before[k as 'markingToTarget'], after[k as 'markingToTarget']));
    return {
      ...before,
      identity: identityConflict ? 'unclear' : after.identity === 'unclear' ? before.identity : after.identity,
      identityDetail: after.identityDetail || before.identityDetail,
      markingText: after.markingText || before.markingText,
      ...(after.busStop ? { busStop: after.busStop } : {}),
      ...(after.zoneKind && after.zoneKind !== 'unclear' ? { zoneKind: after.zoneKind } : {}),
      markingToTarget: conflict(before.markingToTarget, after.markingToTarget) ? 'unclear' : before.markingToTarget,
      vehicleRelation: conflict(before.vehicleRelation, after.vehicleRelation) ? 'unclear' : before.vehicleRelation,
      boundary: conflict(before.boundary, after.boundary) ? 'unclear' : before.boundary,
      chargerToTarget: conflict(before.chargerToTarget, after.chargerToTarget) ? 'unclear' : before.chargerToTarget,
      unknownReasons: [...new Set([...before.unknownReasons, ...after.unknownReasons, ...(identityConflict || relationConflict ? ['전체 장면과 원본 부분의 관찰이 달라 재확인 필요'] : [])])].slice(0, 10),
      ...(after.sharedNotice ? { sharedNotice: { ...after.sharedNotice, targetBayRelation: before.sharedNotice?.targetBayRelation ?? 'unclear', legalPermission: 'unverified' } } : {}),
    };
  });
  for (const discovered of second.observations ?? []) {
    if (!reviewed.has(discovered.type) || observations.some((o) => o.type === discovered.type)) continue;
    observations.push({ ...discovered, photoId: first.photoId, inputVersion: first.inputVersion, markingToTarget: 'unclear', vehicleRelation: 'unclear', chargerToTarget: 'unclear', unknownReasons: [...discovered.unknownReasons, '원본 부분에서 새 후보 발견 · 전체 장면과 대상 연결 재확인 필요'], ...(discovered.sharedNotice ? { sharedNotice: { ...discovered.sharedNotice, targetBayRelation: 'unclear' } } : {}) });
  }
  // Plate and all spatial links remain tied to the first independent whole-scene read.
  return { ...first, observations, detailReview: 'completed', detailRegions: [...requests], detailRequests: [] };
}

async function requestRead(images: string[], options: ReadOptions, detailImages?: { imageIndex: number; dataUrl: string; box: EvidenceBox; type: string }[]): Promise<{ state: VisionState; result?: VisionResult }> {
  const res = await fetch('/api/vision', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ images, photoIds: options.photoIds?.slice(0, images.length), inputVersion: options.inputVersion, ...(options.reference ? { reference: options.reference } : {}), ...(detailImages ? { detailImages } : {}) }),
    signal: options.signal ?? AbortSignal.timeout(55_000),
  });
  const j = await res.json().catch(() => ({})) as VisionResult & { error?: string };
  if (res.ok && j.plate && Array.isArray(j.photos)) {
    j.photos = j.photos.map((read, index) => read ? {
      ...read,
      photoId: options.photoIds?.[index] ?? read.photoId,
      inputVersion: options.inputVersion === undefined ? read.inputVersion : String(options.inputVersion),
      ...(read.observations ? { observations: normalizeObservations(read.observations, { photoId: options.photoIds?.[index] ?? read.photoId, inputVersion: options.inputVersion === undefined ? read.inputVersion : String(options.inputVersion) }) } : {}),
    } : null);
    if (options.reference) j.photos = j.photos.map((read) => read ? constrainSupplementalRead(read, options.reference!.photoId) : read);
    return { state: 'ok', result: j };
  }
  if (j.error === 'no_key') return { state: 'no_key' };
  if (j.error === 'rate_limited') return { state: 'rate_limited' };
  if (j.error === 'busy') return { state: 'busy' };
  return { state: 'error' };
}

export async function readPhotos(dataUrls: string[], options: ReadOptions = {}): Promise<{ state: VisionState; result?: VisionResult }> {
  try {
    const originals = dataUrls.slice(0, 2), images = await Promise.all(originals.map(shrink));
    if (options.reference) {
      if (originals.length !== 1) return { state: 'error' };
      options = { ...options, reference: { ...options.reference, dataUrl: await shrink(options.reference.dataUrl) } };
    }
    const first = await requestRead(images, options);
    if (!first.result || options.detailReview === false || options.signal?.aborted) return first;
    const dimensions = await Promise.all(originals.map(async (original): Promise<[number, number]> => { try { const image = await decode(original); return [image.naturalWidth, image.naturalHeight]; } catch { return [0, 0]; } }));
    const hinted = options.regionHints?.slice(0, MAX_DETAIL_CROPS).flatMap((hint) => normalizeDetailRequests([{ ...hint, reason: 'user_region' }]).map((request) => ({ imageIndex: 0, request }))) ?? [];
    const plan = fallbackDetailPlan(first.result.photos, dimensions, [...hinted, ...detailPlan(first.result.photos)]);
    if (plan.length === 0) return first;
    try {
      const details = (await Promise.all(plan.map(async ({ imageIndex, request }) => {
        const dataUrl = await originalCrop(originals[imageIndex], request.box);
        return dataUrl ? { imageIndex, dataUrl, box: request.box, type: request.type } : null;
      }))).filter((d): d is NonNullable<typeof d> => Boolean(d));
      // Request budget includes original thumbnails plus crops. Failing detail review never discards first result.
      if (details.length === 0 || images.reduce((sum, image) => sum + image.length, 0) + details.reduce((sum, detail) => sum + detail.dataUrl.length, 0) + (options.reference?.dataUrl.length ?? 0) > 3_950_000) {
        return { ...first, result: { ...first.result, photos: first.result.photos.map((r) => r ? { ...r, detailReview: 'unavailable' } : r) } };
      }
      const indices = [...new Set(details.map((detail) => detail.imageIndex))];
      const second = await requestRead(indices.map((index) => images[index]), { ...options, photoIds: options.photoIds ? indices.map((index) => options.photoIds![index]) : undefined }, details.map((detail) => ({ ...detail, imageIndex: indices.indexOf(detail.imageIndex) })));
      const reads = first.result.photos.map((read, index) => {
        const requests = plan.filter((p) => p.imageIndex === index && details.some((d) => d.imageIndex === index && d.type === p.request.type && d.box.join(',') === p.request.box.join(','))).map((p) => p.request);
        return read && requests.length ? mergeDetailRead(read, second.result?.photos[indices.indexOf(index)] ?? null, requests) : read;
      });
      return { state: 'ok', result: mergeReads(reads, first.result.model) ?? first.result };
    } catch {
      return { ...first, result: { ...first.result, photos: first.result.photos.map((r) => r ? { ...r, detailReview: 'unavailable' } : r) } };
    }
  } catch {
    return { state: 'error' };
  }
}

export async function readOne(dataUrl: string, options: ReadOptions = {}): Promise<{ state: VisionState; read?: PhotoRead | null; model?: string }> {
  const r = await readPhotos([dataUrl], options);
  return r.result ? { state: r.state, read: r.result.photos[0] ?? null, model: r.result.model } : { state: r.state };
}
