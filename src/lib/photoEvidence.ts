import { constrainSupplementalRead } from './evidence';
import { currentTypeName, locatedShot } from '../types/report';
import type { DraftReport, PhotoRole, Shot } from '../types/report';

export function photoId(shot: Shot, index: number): string {
  return shot.id ?? `legacy-${index}-${shot.takenAt}`;
}

/** 기존 사진·본문을 복제하거나 삭제하지 않는 읽기 호환. */
export function normalizeDraft(d: DraftReport): DraftReport {
  const type = currentTypeName(d.type);
  const shots = d.shots.map((s, i) => s.id ? s : { ...s, id: photoId(s, i) });
  return { ...d, type, schemaVersion: 2, shots, primaryPair: d.primaryPair ?? shots.slice(0, 2).map((s) => s.id!), evidenceRevision: d.evidenceRevision ?? 0 };
}

export function primaryShots(d: DraftReport): Shot[] {
  if (!d.primaryPair) return d.shots.slice(0, 2);
  return d.primaryPair.map((id) => d.shots.find((s, i) => photoId(s, i) === id)).filter((s): s is Shot => Boolean(s));
}

export function primaryReads(d: DraftReport) {
  return primaryShots(d).map((s) => d.reads?.[d.shots.indexOf(s)] ?? null);
}

/** 사진·역할·대상 선택이 바뀌면 이전 답을 지우지 않고 재확인한다. */
export function evidenceKey(d: DraftReport): string {
  return JSON.stringify([d.evidenceRevision ?? 0, d.type, d.shots.map((s, i) => [photoId(s, i), s.takenAt, s.roles]), d.primaryPair, d.selectedStopId, d.vehicleLocation, (d.reads ?? []).map((r) => r ? [r.analysisVersion, r.observations] : null)]);
}

export function appendPhoto(draft: DraftReport, photo: Shot, supplemental = false): DraftReport {
  const d = normalizeDraft(draft);
  const id = globalThis.crypto?.randomUUID?.() ?? `photo-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const s = { ...photo, id, roles: photo.roles ?? (supplemental ? ['context' as const] : ['vehicle' as const, 'connection' as const]) };
  return { ...d, shots: [...d.shots, s], primaryPair: supplemental || d.primaryPair!.length >= 2 ? d.primaryPair : [...d.primaryPair!, id], evidenceRevision: (d.evidenceRevision ?? 0) + 1 };
}

export function assignRole(draft: DraftReport, id: string, roles: PhotoRole[]): DraftReport {
  return { ...draft, shots: draft.shots.map((s) => s.id === id ? { ...s, roles } : s), evidenceRevision: (draft.evidenceRevision ?? 0) + 1 };
}

export function choosePrimary(draft: DraftReport, id: string, slot: 0 | 1): DraftReport {
  const d = normalizeDraft(draft);
  if (!d.shots.some((s) => s.id === id) || d.primaryPair?.[1 - slot] === id) return d;
  const chosen = d.shots.find((s) => s.id === id)!;
  const other = d.shots.find((s) => s.id === d.primaryPair?.[1 - slot]);
  if (other && sameImportedPhoto(chosen, other)) return d;
  const pair = [...d.primaryPair!];
  if (slot > pair.length) return d;
  pair[slot] = id;
  return { ...d, primaryPair: pair, overlap: undefined, evidenceRevision: (d.evidenceRevision ?? 0) + 1 };
}

export function sameImportedPhoto(a: Shot, b: Shot): boolean {
  return Boolean(a.originalDataUrl ?? a.dataUrl) && (a.source === 'album' || b.source === 'album' || a.takenAt === b.takenAt)
    && (a.originalDataUrl ?? a.dataUrl) === (b.originalDataUrl ?? b.dataUrl);
}

/** 보완사진은 현재 기본 첫 사진의 차량과 장소에 연결될 때만 공간 근거로 쓴다. */
export function reviewedReads(d: DraftReport) {
  const primary = primaryShots(d), referenceId = primary[0]?.id;
  return d.shots.map((s, i) => {
    const read = d.reads?.[i];
    if (!read) return read ?? null;
    const linked = { ...read, photoId: s.id ?? read.photoId };
    return primary.includes(s) ? linked : constrainSupplementalRead(linked, referenceId);
  });
}

export function activeLocatedShot(d: DraftReport): Shot | undefined {
  return locatedShot(primaryShots(d));
}

export function knownPhotoTime(shot: Shot): boolean {
  return Number.isFinite(shot.takenAt) && !(shot.source === 'album' && shot.meta?.takenAt === undefined);
}
