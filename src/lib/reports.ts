/**
 * 신고 보관함 — 앱을 바꾸거나 꺼도 하던 신고부터 다시 시작한다(회의 결정 · 요구사항 R7).
 *
 * 리뷰에서 가장 많은 불만: 한 장 찍고 다른 앱을 쓰다 돌아오면 처음부터 다시.
 * 그래서 사진·판독·칸 값·진행 단계를 바뀔 때마다 기기(IndexedDB)에 저장하고,
 * 다시 열면 가장 최근에 하던 신고로 바로 돌아간다. 처음 화면에는 이어할 신고 목록을 보여 준다.
 * 사진이 커서 localStorage 는 금방 넘치므로 IndexedDB 를 쓴다. 서버로는 보내지 않는다.
 */
import type { DraftReport } from '../types/report';

export type Phase = 'capture' | 'form' | 'submitted';

export interface ReportRecord {
  id: string;
  draft: DraftReport;
  phase: Phase;
  /** 단계별 화면에서 보던 단계 */
  step: number;
  createdAt: number;
  updatedAt: number;
  /** 제출한 시각 — 걸린 시간을 재는 끝점(현장 확인 ⑦ 'After' 칸) */
  submittedAt?: number;
  /** 시작부터 제출까지 화면을 누른 횟수 */
  taps?: number;
}

const DB_NAME = 'parking-report-poc';
const STORE = 'reports';
const OLD_STORE = 'draft';

/** 접수 기한(촬영 익일)이 지나면 이어해도 소용없다 — 이 시간 지나면 목록에서 '기한 지남' */
export const RESUME_MAX_MS = 36 * 60 * 60 * 1000;
/** 이만큼 지난 신고는 보관함에서 지운다 */
export const KEEP_MS = 7 * 24 * 60 * 60 * 1000;

export function newId(now = Date.now()): string {
  return `r${now.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(OLD_STORE)) db.createObjectStore(OLD_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T | null> {
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
    // 사생활 보호 모드 등 저장소가 막힌 환경 — 저장을 포기할 뿐 신고는 계속된다
    return null;
  }
}

export async function saveReport(r: ReportRecord): Promise<void> {
  await run('readwrite', (s) => s.put({ ...r, updatedAt: Date.now() }));
}

export async function deleteReport(id: string): Promise<void> {
  await run('readwrite', (s) => s.delete(id));
}

/** 최근 것부터. 오래된 것은 지운다. */
export async function listReports(now = Date.now()): Promise<ReportRecord[]> {
  const all = (await run<ReportRecord[]>('readonly', (s) => s.getAll())) ?? [];
  const stale = all.filter((r) => now - r.updatedAt > KEEP_MS);
  await Promise.all(stale.map((r) => deleteReport(r.id)));
  return all.filter((r) => !stale.includes(r)).sort((a, b) => b.updatedAt - a.updatedAt);
}

/** 앱을 열었을 때 바로 이어할 신고 — 제출하지 않았고, 사진이 있고, 기한 안의 가장 최근 것 */
export function pickResume(list: ReportRecord[], now = Date.now()): ReportRecord | undefined {
  return list.find((r) => r.phase !== 'submitted' && r.draft.shots.length > 0 && now - r.createdAt <= RESUME_MAX_MS);
}

/**
 * 걸린 시간과 누른 횟수 — 지금 앱과 나란히 잴 'After' 숫자(docs/field-test.md ⑦).
 * 시작(사진부터 찍기)부터 제출까지. 두 사진 사이 기다린 시간도 따로 적는다.
 * 하던 신고를 다음 날 이어 냈다면 시간이 부풀므로 그 사실도 밝힌다.
 */
export interface Measure {
  totalSec: number;
  waitSec?: number;
  taps?: number;
  resumed: boolean;
  text: string;
}

export function measure(r: ReportRecord): Measure | null {
  if (r.submittedAt === undefined) return null;
  const totalSec = Math.max(0, Math.round((r.submittedAt - r.createdAt) / 1000));
  const [a, b] = r.draft.shots;
  const waitSec = a && b ? Math.round(Math.abs(b.takenAt - a.takenAt) / 1000) : undefined;
  const resumed = totalSec > 30 * 60;
  const dur = (sec: number) => (sec >= 60 ? `${Math.floor(sec / 60)}분 ${sec % 60}초` : `${sec}초`);
  const parts = [`걸린 시간 ${dur(totalSec)}`];
  if (waitSec !== undefined) parts.push(`그중 두 사진 간격 ${dur(waitSec)}`);
  if (r.taps !== undefined) parts.push(`누른 횟수 ${r.taps}회`);
  return { totalSec, waitSec, taps: r.taps, resumed, text: parts.join(' · ') + (resumed ? ' (이어서 낸 신고)' : '') };
}

