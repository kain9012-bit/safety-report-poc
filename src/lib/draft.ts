/**
 * 작성 중인 신고를 기기에 저장해 두는 곳 — 요구사항 R7.
 *
 * 화면이 꺼지거나 전화가 와서 앱을 나갔다 와도 첫 컷과 60초 타이머가 살아 있어야 한다.
 * 사진이 커서 localStorage 는 금방 넘치므로 IndexedDB 를 쓴다.
 */

import type { Shot } from '../types/report';

const DB_NAME = 'parking-report-poc';
const STORE = 'draft';
const KEY = 'current';

export interface Draft {
  shots: Shot[];
  /** 저장 시각. 너무 오래된 초안은 복구하지 않는다. */
  savedAt: number;
}

/** 초안이 살아 있다고 보는 시간. 신고 기한이 촬영 익일까지라 하루면 충분하다. */
const MAX_AGE_MS = 36 * 60 * 60 * 1000;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest,
): Promise<T | null> {
  try {
    const db = await open();
    return await new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      req.onsuccess = () => resolve((req.result as T) ?? null);
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => db.close();
    });
  } catch {
    // 사생활 보호 모드나 저장소 차단 환경에서는 그냥 저장을 포기한다.
    // 저장이 안 된다고 신고를 못 하게 만들면 안 된다.
    return null;
  }
}

export async function saveDraft(shots: Shot[]): Promise<void> {
  if (shots.length === 0) return clearDraft();
  await withStore('readwrite', (s) => s.put({ shots, savedAt: Date.now() } as Draft, KEY));
}

export async function loadDraft(): Promise<Draft | null> {
  const d = await withStore<Draft>('readonly', (s) => s.get(KEY));
  if (!d) return null;
  if (Date.now() - d.savedAt > MAX_AGE_MS) {
    await clearDraft();
    return null;
  }
  return d;
}

export async function clearDraft(): Promise<void> {
  await withStore('readwrite', (s) => s.delete(KEY));
}
