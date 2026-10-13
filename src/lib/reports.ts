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

/** 앱을 열 때 자동으로 이어할 신고를 고르는 기준. 저장 기간이나 법적 신고 기한이 아니다. */
export const RESUME_MAX_MS = 36 * 60 * 60 * 1000;
/** @deprecated 예전 자동 삭제 기준. 이제 자료는 사용자가 삭제할 때까지 보존한다. */
export const KEEP_MS = 7 * 24 * 60 * 60 * 1000;

export function newId(now = Date.now()): string {
  return `r${now.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    let settled = false;
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(OLD_STORE)) db.createObjectStore(OLD_STORE);
    };
    req.onsuccess = () => {
      const db = req.result;
      // 차단 오류를 이미 알린 뒤 다른 탭이 연결을 풀었다면, 뒤늦은 연결을 남기지 않는다.
      if (settled) { db.close(); return; }
      settled = true;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => {
      settled = true;
      reject(req.error ?? new Error('신고 보관함을 열지 못했습니다.'));
    };
    req.onblocked = () => {
      settled = true;
      reject(new Error('다른 탭에서 신고 보관함을 사용 중입니다. 다른 탭을 닫고 다시 시도해 주세요.'));
    };
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    let tx: IDBTransaction;
    try {
      tx = db.transaction(STORE, mode);
    } catch (error) {
      db.close();
      reject(error);
      return;
    }
    let result: T;
    let failure: unknown;
    // 요청 성공 뒤에도 quota/abort 등으로 트랜잭션이 실패할 수 있다.
    // 저장 완료는 반드시 commit(oncomplete)을 확인한 뒤에만 알린다.
    tx.oncomplete = () => { db.close(); resolve(result); };
    tx.onabort = () => {
      db.close();
      reject(failure ?? tx.error ?? new DOMException('신고 보관함 작업이 취소되었습니다.', 'AbortError'));
    };
    tx.onerror = () => { failure ??= tx.error; };
    try {
      const req = fn(tx.objectStore(STORE));
      req.onsuccess = () => { result = req.result; };
      req.onerror = () => { failure = req.error ?? new Error('신고 보관함 작업에 실패했습니다.'); };
    } catch (error) {
      failure = error;
      tx.abort();
    }
  });
}

// 자동 저장보다 늦게 요청한 최종 저장/삭제가 먼저 끝나거나, 조회가 저장을 추월하지 않게 한다.
// 한 번 실패한 작업은 호출자에게 전달하되 다음 재시도를 막지 않는다.
let pending: Promise<unknown> = Promise.resolve();
function ordered<T>(operation: () => Promise<T>): Promise<T> {
  const next = pending.then(operation);
  pending = next.catch(() => undefined);
  return next;
}

export async function saveReport(r: ReportRecord): Promise<void> {
  // 큐를 기다리는 동안 호출자가 사진/입력값을 변경해도 이 저장의 내용은 바뀌지 않는다.
  const snapshot = structuredClone({ ...r, updatedAt: Date.now() });
  await ordered(() => run('readwrite', (s) => s.put(snapshot)));
}

export async function deleteReport(id: string): Promise<void> {
  await ordered(() => run('readwrite', (s) => s.delete(id)));
}

/** 최근 것부터. 오래된 자료와 기한이 지난 자료도 명시적으로 삭제하기 전까지 보존한다. */
export async function listReports(_now = Date.now()): Promise<ReportRecord[]> {
  const all = await ordered(() => run<ReportRecord[]>('readonly', (s) => s.getAll()));
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
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

