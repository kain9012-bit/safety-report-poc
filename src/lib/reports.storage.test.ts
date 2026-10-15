import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { deleteReport, KEEP_MS, listReports, saveReport, type ReportRecord } from './reports';

const NOW = 1_800_000_000_000;
const record = (id = 'r'): ReportRecord => ({
  id, phase: 'form', step: 2, createdAt: NOW - 1_000, updatedAt: NOW - 1_000,
  draft: {
    shots: [{ takenAt: NOW - 1_000, dataUrl: 'data:image/jpeg;base64,old-photo' }],
    address: '직접 작성한 주소', body: '직접 작성한 내용', manual: { address: true, body: true },
  },
});

async function seed(records: ReportRecord[], version = 2): Promise<IDBDatabase> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open('parking-report-poc', version);
    req.onupgradeneeded = () => req.result.createObjectStore('reports', { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('reports', 'readwrite');
    records.forEach((r) => tx.objectStore('reports').put(r));
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
  return db;
}

beforeEach(() => vi.stubGlobal('indexedDB', new IDBFactory()));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('보관함의 실제 트랜잭션과 자료 보존', () => {
  it('put 요청 성공 뒤 트랜잭션이 중단되면 저장 성공으로 알리지 않고 이전 사진·입력을 보존한다', async () => {
    const original = record();
    await saveReport(original);
    const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args) {
      const req = put.apply(this, args);
      req.addEventListener('success', () => req.transaction!.abort());
      return req;
    });
    const replacement = { ...original, draft: { ...original.draft, shots: [{ takenAt: NOW, dataUrl: 'new-photo' }] } };
    await expect(saveReport(replacement)).rejects.toMatchObject({ name: 'AbortError' });
    expect((await listReports())[0].draft).toEqual(original.draft);
  });

  it('삭제 요청 성공 뒤 중단된 트랜잭션도 실패이며 기존 기록이 남는다', async () => {
    await saveReport(record());
    const remove = IDBObjectStore.prototype.delete;
    vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(function (this: IDBObjectStore, ...args) {
      const req = remove.apply(this, args);
      req.addEventListener('success', () => req.transaction!.abort());
      return req;
    });
    await expect(deleteReport('r')).rejects.toMatchObject({ name: 'AbortError' });
    expect(await listReports()).toHaveLength(1);
  });

  it('7일 넘은 작성 중·완료 자료를 목록 조회에서 삭제하거나 숨기지 않는다', async () => {
    const oldDraft = { ...record('draft'), updatedAt: NOW - KEEP_MS - 1 };
    const oldSubmitted = { ...record('done'), phase: 'submitted' as const, updatedAt: NOW - KEEP_MS * 10 };
    const db = await seed([oldDraft, oldSubmitted]);
    db.close();
    expect(await listReports(NOW)).toEqual([oldDraft, oldSubmitted]);
    expect(await listReports(NOW + KEEP_MS * 100)).toEqual([oldDraft, oldSubmitted]);
  });

  it('이전 유형 이름(evcharge·etc)으로 저장된 기록을 지금 이름으로 읽고 나머지는 그대로 둔다', async () => {
    const ev = { ...record('ev'), updatedAt: NOW, draft: { ...record('ev').draft, type: 'evcharge' } } as unknown as ReportRecord;
    const etc = { ...record('etc'), updatedAt: NOW - 1, draft: { ...record('etc').draft, type: 'etc' } } as unknown as ReportRecord;
    const db = await seed([ev, etc]);
    db.close();
    const [a, b] = await listReports(NOW);
    expect(a.draft).toEqual({ ...ev.draft, type: 'evcharging' });
    expect(b.draft).toEqual({ ...etc.draft, type: 'other' });
  });

  it('빠르게 연속 호출한 자동 저장·최종 저장·조회는 호출 순서대로 완료한다', async () => {
    const draft = record();
    const firstSave = saveReport(draft);
    draft.draft.address = '수정한 주소';
    const final = { ...draft, phase: 'submitted' as const, submittedAt: NOW };
    const finalSave = saveReport(final);
    const after = listReports();
    await Promise.all([firstSave, finalSave]);
    expect((await after)[0]).toMatchObject({ phase: 'submitted', draft: { address: '수정한 주소' } });
  });

  it('대기 중인 저장 내용은 호출 시점의 복사본이다', async () => {
    const draft = record();
    const save = saveReport(draft);
    draft.draft.address = '저장 요청 이후 메모리 수정';
    draft.draft.shots[0].dataUrl = '저장 요청 이후 사진 수정';
    await save;
    const saved = (await listReports())[0];
    expect(saved.draft.address).toBe('직접 작성한 주소');
    expect(saved.draft.shots[0].dataUrl).toBe('data:image/jpeg;base64,old-photo');
  });

  it('진행 중인 자동 저장 이후 삭제하면 늦게 끝난 저장 때문에 자료가 되살아나지 않는다', async () => {
    const save = saveReport(record());
    const remove = deleteReport('r');
    const after = listReports();
    await Promise.all([save, remove]);
    expect(await after).toEqual([]);
  });

  it('저장소 접근 거부는 빈 보관함이나 저장 성공으로 숨기지 않으며 이후 재시도가 가능하다', async () => {
    const open = vi.spyOn(indexedDB, 'open').mockImplementation(() => { throw new DOMException('disabled', 'SecurityError'); });
    await expect(saveReport(record())).rejects.toMatchObject({ name: 'SecurityError' });
    await expect(deleteReport('r')).rejects.toMatchObject({ name: 'SecurityError' });
    await expect(listReports()).rejects.toMatchObject({ name: 'SecurityError' });
    open.mockRestore();
    await saveReport(record());
    expect(await listReports()).toHaveLength(1);
  });

  it('비동기 open 오류도 호출자에게 전달한다', async () => {
    const db = await seed([], 3);
    db.close();
    await expect(listReports()).rejects.toMatchObject({ name: 'VersionError' });
  });

  it('조회 요청 성공 뒤에도 트랜잭션이 중단되면 빈 목록 대신 오류를 전달한다', async () => {
    await saveReport(record());
    const getAll = IDBObjectStore.prototype.getAll;
    vi.spyOn(IDBObjectStore.prototype, 'getAll').mockImplementation(function (this: IDBObjectStore, ...args) {
      const req = getAll.apply(this, args);
      req.addEventListener('success', () => req.transaction!.abort());
      return req;
    });
    await expect(listReports()).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('다른 탭이 이전 저장소 버전을 붙잡고 있으면 대기만 하지 않고 오류를 전달한다', async () => {
    const oldConnection = await seed([], 1);
    try {
      await expect(listReports()).rejects.toThrow('다른 탭');
    } finally {
      oldConnection.close();
    }
  });
});
