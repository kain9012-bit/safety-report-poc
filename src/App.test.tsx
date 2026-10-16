// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import type { ReportRecord } from './lib/reports';
import type { DraftReport } from './types/report';
import type { PhotoRead, VisionResult } from '../api/vision';
import App from './App';
import { kstTime } from './lib/kst';
import { normalizeDraft } from './lib/photoEvidence';

const mock = vi.hoisted(() => ({ list: vi.fn(), save: vi.fn(), remove: vi.fn(), read: vi.fn(), album: vi.fn(), albumFile: vi.fn() }));
vi.mock('./lib/reports', async (original) => ({ ...await original<object>(), listReports: mock.list, saveReport: mock.save, deleteReport: mock.remove }));
vi.mock('./lib/vision', () => ({ readOne: mock.read, RATE_LIMIT_RETRY_MS: 30, RETRYING_TEXT: '자동 재판독 대기' }));
vi.mock('./lib/album', () => ({ readAlbum: mock.album, readAlbumFile: mock.albumFile }));
vi.mock('./lib/reverseGeocode', () => ({ reverseGeocode: vi.fn(async () => ({ state: 'error' })) }));
vi.mock('./lib/facilities', () => ({ loadNearby: vi.fn(async () => ({ state: 'ok', busstops: [], crosswalks: [], schools: [], missing: [] })) }));
vi.mock('./lib/recommend', () => ({ recommend: () => [] }));
vi.mock('./lib/overlap', () => ({ OVERLAP_MIN: 0.7, compareShots: vi.fn(async () => ({ ratio: 0.9, score: 0.9, same: true })) }));
vi.mock('./lib/crosscheck', () => ({ crosscheck: () => ({ type: 'crossing', source: 'photo', suspicions: [], alternatives: [] }) }));
vi.mock('../api/vision', () => ({ mergeReads: () => ({ plate: { text: '12가3456', reads: ['12가3456', '12가3456'], agree: true, confidence: 0.95, readable: true }, sameVehicle: 'yes', ruleTypes: ['crossing'] } as VisionResult) }));
vi.mock('./components/Ui', () => ({ PhoneFrame: ({ children }: { children: React.ReactNode }) => <main>{children}</main>, ProtoNotice: () => null, BuildBadge: () => null }));
vi.mock('./components/StartScreen', () => ({ default: (p: ComponentProps<typeof import('./components/StartScreen').default>) => <div data-testid="home">
  <button onClick={p.onCamera}>new</button><button onClick={() => p.onAlbum([new File(['fake'], 'synthetic.png')])}>album</button>
  {p.reports.map((r) => <div key={r.id}><button onClick={() => p.onResume(r)}>open {r.id}</button><button onClick={() => p.onDelete(r.id)}>delete {r.id}</button></div>)}
</div> }));
vi.mock('./components/CaptureFlow', () => ({ default: (p: ComponentProps<typeof import('./components/CaptureFlow').default>) => <div data-testid="capture">
  <output data-testid="draft">{JSON.stringify(p.draft)}</output>
  <button onClick={() => p.onShot({ takenAt: Date.now() + p.draft.shots.length * 61_000, dataUrl: 'data:,replacement', lat: 35, lng: 127, source: 'camera' })}>shot</button>
  <button onClick={p.onRetakeFirst}>retake first</button><button onClick={p.onRetakeSecond}>retake second</button>
  <button onClick={p.onDone}>finish</button><button onClick={p.onExit}>exit</button>
</div> }));
vi.mock('./components/ReportSteps', () => ({ default: (p: ComponentProps<typeof import('./components/ReportSteps').default>) => <div data-testid="form">
  <output data-testid="draft">{JSON.stringify(p.draft)}</output>
  <button onClick={p.onRetake}>retake</button><button onClick={p.onHome}>home</button><button onClick={() => p.onSubmit()}>submit</button><button onClick={() => p.onSubmit(p.draft.plate)}>submit anyway</button>
  <button onClick={() => p.onEdit('body', '수정한 수동 내용')}>edit body</button><button onClick={() => p.onEdit('plate', '99나9999')}>edit plate</button>
  <button onClick={() => p.followUps?.onSupplement(new File(['more'], 'more.jpg'), 'hydrant:connection')}>supplement</button>
  <button onClick={() => p.photos.onCamera(0)}>camera 0</button><button onClick={() => p.photos.onCamera(1)}>camera 1</button>
  <button onClick={() => p.photos.onAlbum(0, new File(['new'], 'new.jpg'))}>album 0</button><button onClick={() => p.photos.onAlbum(1, new File(['new'], 'new.jpg'))}>album 1</button>
  <button onClick={() => p.photos.onRemove(0)}>remove 0</button>
  <output data-testid="ask">{String(Boolean(p.askMore))}</output><button onClick={p.onAsked}>asked</button>
</div> }));

const NOW = kstTime(2026, 10, 7, 11);
const read: PhotoRead = { plate: { text: '12가3456', readable: true, confidence: .95 }, scene: { onCrosswalk: 'yes', onSidewalk: 'no', busStopVisible: 'no', schoolZoneMarking: 'no', intersectionCorner: 'no', fireHydrantNear: 'no', disabledSpace: 'no', disabledPermit: 'unclear', fireLane: 'no', evChargingSpace: 'no', evVehicle: 'unclear' }, typeGuess: 'crossing', typeConfidence: .9, evidence: 'synthetic', boxes: [] };
const initial = (): ReportRecord => ({
  id: 'r1', phase: 'form', step: 0, createdAt: NOW - 120_000, updatedAt: NOW,
  draft: { shots: [0, 61_000].map((delta, i) => ({ takenAt: NOW - 120_000 + delta, dataUrl: `data:,original${i}`, lat: 35, lng: 127, source: 'camera' })),
    reads: [read, read], type: 'crossing', plate: '12가3456', address: '전북특별자치도 전주시 완산구 테스트길', body: '기존 수동 신고 내용',
    manual: { body: true, address: true, plate: true, type: true }, overlap: { ratio: .9, score: .9, same: true }, firstOk: true },
});
// 예전 형식 기록은 열 때 사진 ID·기본 두 장 표시만 더해 읽는다(사진·주소·본문은 그대로)
const opened = () => normalizeDraft(initial().draft);
const draft = () => JSON.parse(screen.getByTestId('draft').textContent!) as DraftReport;
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
const deferred = <T,>() => { let resolve!: (v: T) => void; let reject!: (e: Error) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
let stored: ReportRecord;
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  stored = initial();
  mock.list.mockImplementation(async () => [structuredClone(stored)]);
  mock.save.mockImplementation(async (r: ReportRecord) => { stored = structuredClone(r); });
  mock.remove.mockResolvedValue(undefined);
  mock.read.mockImplementation(() => new Promise(() => {}));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const boot = async () => { render(<App />); await screen.findByTestId('form'); };

describe('실제 App의 보존·저장 화면 전환', () => {
  it('두 번째 재촬영 중 기존 두 사진과 수동 입력을 저장소에 유지하고 취소하면 복원한다', async () => {
    await boot(); click('retake'); await screen.findByTestId('capture');
    expect(draft().shots).toHaveLength(1);
    click('shot');
    await act(() => new Promise((r) => setTimeout(r, 350)));
    expect(stored.draft.shots).toEqual(opened().shots);
    expect(stored.draft.body).toBe(initial().draft.body);
    click('재촬영 취소 · 기존 자료로 돌아가기');
    await screen.findByTestId('form');
    expect(draft()).toEqual(opened());
    cleanup(); await boot(); expect(draft()).toEqual(opened());
  });

  it('첫 사진 재촬영도 수동 주소·본문을 유지하며 저장 실패 후 기존 사진을 복원한다', async () => {
    await boot(); click('retake'); await screen.findByTestId('capture'); click('retake first');
    expect(draft().shots).toHaveLength(0); expect(draft().address).toBe(initial().draft.address); expect(draft().body).toBe(initial().draft.body);
    click('shot'); click('shot'); mock.save.mockRejectedValueOnce(new Error('quota')); click('finish');
    await screen.findByRole('alert');
    expect(stored.draft.shots).toEqual(opened().shots); expect(draft().shots[0].dataUrl).toBe('data:,replacement');
    click('재촬영 취소 · 기존 자료로 돌아가기'); await screen.findByTestId('form'); expect(draft()).toEqual(opened());
  });

  it('교체 저장 커밋 전에는 촬영 화면에 머물고 성공 후에만 새 사진으로 넘어간다', async () => {
    await boot(); click('retake'); await screen.findByTestId('capture'); click('shot');
    const commit = deferred<void>(); mock.save.mockImplementationOnce(async (r: ReportRecord) => { await commit.promise; stored = structuredClone(r); });
    click('finish'); expect(screen.queryByTestId('form')).toBeNull(); expect(stored.draft.shots).toEqual(opened().shots);
    await act(async () => commit.resolve()); await screen.findByTestId('form');
    expect(stored.draft.shots[1].dataUrl).toBe('data:,replacement'); expect(stored.draft.body).toBe(initial().draft.body);
  });

  it('제출 저장 실패를 성공으로 표시하지 않고 입력을 유지한 채 재시도한다', async () => {
    await boot(); mock.save.mockRejectedValueOnce(new Error('quota')); click('submit');
    await screen.findByRole('alert'); expect(screen.queryByTestId('home')).toBeNull(); expect(stored.phase).toBe('form'); expect(draft().body).toBe(initial().draft.body);
    await act(() => new Promise((r) => setTimeout(r, 350)));
    expect(screen.getByRole('alert')).toBeTruthy();
    click('다시 시도'); await screen.findByTestId('home'); expect(stored.phase).toBe('submitted');
  });

  it('차량번호가 판독과 다르면 안내 없이 제출되지 않고, 그래도 제출하면 그 번호를 확인한 것으로 저장한다', async () => {
    await boot(); click('edit plate'); click('submit');
    expect(mock.save).not.toHaveBeenCalled(); expect(screen.getByText(/차량번호가 사진 판독과 다릅니다/)).toBeTruthy();
    mock.save.mockRejectedValueOnce(new Error('quota')); click('submit anyway');
    await screen.findByRole('alert'); click('다시 시도'); await screen.findByTestId('home');
    expect(stored.phase).toBe('submitted'); expect(stored.draft.plate).toBe('99나9999'); expect(stored.draft.plateConfirmedFor).toBe('99나9999');
  });

  it('화면을 그대로 둔 채 기한이 지나면 클릭 시점 점검으로 제출을 차단한다', async () => {
    await boot(); vi.mocked(Date.now).mockReturnValue(kstTime(2026, 10, 9, 0)); click('submit');
    expect(mock.save).not.toHaveBeenCalled(); expect(screen.queryByTestId('home')).toBeNull();
    expect(screen.getByText(/현재 시각으로 다시 점검/)).toBeTruthy();
  });

  it('최신 수동 입력 저장 실패 시 홈으로 이동하지 않으며 재시도에 최신 값을 저장한다', async () => {
    await boot(); click('edit body'); mock.save.mockRejectedValueOnce(new Error('quota')); click('home');
    await screen.findByRole('alert'); expect(draft().body).toBe('수정한 수동 내용'); expect(stored.draft.body).toBe(initial().draft.body);
    click('다시 시도'); await screen.findByTestId('home'); expect(stored.draft.body).toBe('수정한 수동 내용');
  });

  it('저장소 읽기 오류를 빈 보관함 성공으로 취급하지 않고 재시도한다', async () => {
    mock.list.mockRejectedValueOnce(new Error('blocked')); render(<App />); await screen.findByRole('alert');
    expect(screen.getByText(/보관함을 읽지 못했습니다/)).toBeTruthy(); click('다시 시도'); await screen.findByTestId('form');
  });

  it('앨범 읽기 동안 다른 기록을 열거나 새 촬영을 시작할 수 없어 늦은 응답의 덮어쓰기를 막는다', async () => {
    mock.list.mockResolvedValue([]); render(<App />); await screen.findByTestId('home');
    const reading = deferred<DraftReport['shots']>(); mock.album.mockReturnValueOnce(reading.promise); click('album');
    expect((screen.getByRole('button', { name: 'new' }) as HTMLButtonElement).closest('fieldset')?.disabled).toBe(true);
    await act(async () => reading.resolve(initial().draft.shots)); await screen.findByTestId('form');
  });
  it('재촬영 시작 전 최신 입력 저장이 실패하면 원래 화면과 사진을 유지한다', async () => {
    await boot(); click('edit body'); mock.save.mockRejectedValueOnce(new Error('quota')); click('retake');
    await screen.findByRole('alert'); expect(screen.queryByTestId('capture')).toBeNull();
    expect(draft().shots).toEqual(opened().shots); expect(draft().body).toBe('수정한 수동 내용');
    click('다시 시도'); await screen.findByTestId('capture'); expect(stored.draft.body).toBe('수정한 수동 내용');
  });

  it('재촬영을 취소한 뒤 도착한 AI 결과가 복원한 사진·판독을 바꾸지 않는다', async () => {
    const reading = deferred<{ state: string; read: PhotoRead }>(); mock.read.mockReturnValueOnce(reading.promise);
    await boot(); click('retake'); await screen.findByTestId('capture'); click('shot');
    click('재촬영 취소 · 기존 자료로 돌아가기'); await screen.findByTestId('form');
    await act(async () => reading.resolve({ state: 'ok', read: { ...read, evidence: 'late replacement read' } }));
    expect(draft()).toEqual(opened()); expect(stored.draft).toEqual(opened());
  });

  it('삭제 실패 시 보관함에 기존 자료를 남기고 오류를 알린다', async () => {
    await boot(); click('home'); await screen.findByTestId('home'); mock.remove.mockRejectedValueOnce(new Error('abort'));
    click('delete r1'); await screen.findByRole('alert'); expect(screen.getByRole('button', { name: 'open r1' })).toBeTruthy();
    expect(stored.draft).toEqual(opened());
  });

  it('보관함 재시도의 늦은 실패가 새 촬영 화면을 홈으로 돌려보내지 않는다', async () => {
    mock.list.mockRejectedValueOnce(new Error('initial blocked'));
    render(<App />); await screen.findByRole('alert');
    const loading = deferred<ReportRecord[]>(); mock.list.mockReturnValueOnce(loading.promise);
    click('다시 시도'); click('new'); await screen.findByTestId('capture');
    await act(async () => loading.reject(new Error('late blocked')));
    expect(screen.queryByTestId('home')).toBeNull(); expect(screen.getByTestId('capture')).toBeTruthy();
  });

});

describe('main 화면 뒤에서 도는 개선 로직', () => {
  it('새 촬영은 사진 ID·기본 두 장을 가진 새 형식으로 만들고, 세 번째 촬영은 받지 않으며, 사진 ID를 붙여 판독한다', async () => {
    mock.list.mockResolvedValue([]); render(<App />); await screen.findByTestId('home');
    click('new'); await screen.findByTestId('capture');
    click('shot'); click('shot'); click('shot');
    const d = draft();
    expect(d.schemaVersion).toBe(2);
    expect(d.shots).toHaveLength(2);
    expect(d.primaryPair).toEqual(d.shots.map((s) => s.id));
    expect(mock.read).toHaveBeenCalledWith('data:,replacement', expect.objectContaining({ photoIds: [d.shots[0].id] }));
  });

  it('보완사진은 기본 두 장 뒤에 붙고 같은 사유를 기록하며, 기본 첫 사진과 대조해 판독한다. 두 번째 재촬영 후보에서는 빠진다', async () => {
    mock.albumFile.mockResolvedValue({ takenAt: NOW, dataUrl: 'data:,stamped', originalDataUrl: 'data:,more', source: 'album' });
    await boot(); click('supplement');
    await act(() => new Promise((r) => setTimeout(r, 0)));
    const d = draft();
    expect(d.shots.map((s) => s.dataUrl)).toEqual(['data:,original0', 'data:,original1', 'data:,stamped']);
    expect(d.primaryPair).toEqual(opened().primaryPair);
    expect(d.supplementAsked).toEqual(['hydrant:connection']);
    expect(mock.read).toHaveBeenCalledWith('data:,more', expect.objectContaining({ reference: { dataUrl: 'data:,original0', photoId: opened().primaryPair![0] } }));
    click('retake'); await screen.findByTestId('capture');
    expect(draft().shots.map((s) => s.dataUrl)).toEqual(['data:,original0']);
  });
});

describe('신고서 사진 칸 — 바꾸기·지우기·1장 더 넣기', () => {
  const settle = () => act(() => new Promise((r) => setTimeout(r, 350)));

  it('앨범으로 바꾸면 새 사진을 다 읽은 뒤에만 바꾸고 저장하며, 새 사진만 다시 판독한다', async () => {
    const reading = deferred<DraftReport['shots'][number]>(); mock.albumFile.mockReturnValueOnce(reading.promise);
    await boot(); click('album 1');
    expect(draft().shots.map((s) => s.dataUrl)).toEqual(['data:,original0', 'data:,original1']);
    await act(async () => reading.resolve({ takenAt: NOW - 30_000, dataUrl: 'data:,stamped', originalDataUrl: 'data:,picked', source: 'album', meta: { takenAt: NOW - 30_000 } as never }));
    expect(draft().shots.map((s) => s.dataUrl)).toEqual(['data:,original0', 'data:,stamped']);
    expect(mock.read).toHaveBeenCalledWith('data:,picked', expect.anything());
    expect(mock.read).not.toHaveBeenCalledWith('data:,original0', expect.anything());
    await settle();
    expect(stored.draft.shots.map((s) => s.dataUrl)).toEqual(['data:,original0', 'data:,stamped']);
    expect(stored.draft.body).toBe(initial().draft.body);
  });

  it('앨범 사진을 읽지 못하면 기존 사진과 입력을 그대로 두고 알린다', async () => {
    mock.albumFile.mockRejectedValueOnce(new Error('decode'));
    await boot(); click('album 0');
    await screen.findByText('사진을 읽지 못했습니다. 기존 사진과 입력은 그대로입니다.');
    expect(draft()).toEqual(opened());
  });

  it('카메라로 1번째를 바꾸면 2번째를 남겨 1번째로 두고 새 사진을 2번째로 찍으며, 취소하면 원래대로 돌아간다', async () => {
    await boot(); click('camera 0'); await screen.findByTestId('capture');
    expect(draft().shots.map((s) => s.dataUrl)).toEqual(['data:,original1']);
    expect(draft().firstOk).toBe(true);
    click('재촬영 취소 · 기존 자료로 돌아가기'); await screen.findByTestId('form');
    expect(draft()).toEqual(opened());
    click('camera 0'); await screen.findByTestId('capture'); click('shot'); click('finish');
    await screen.findByTestId('form');
    expect(stored.draft.shots.map((s) => s.dataUrl)).toEqual(['data:,original1', 'data:,replacement']);
  });

  it('두 장 중 한 장을 지우면 남은 한 장으로 신고서에 머물고 저장한다', async () => {
    await boot(); click('remove 0');
    expect(draft().shots.map((s) => s.dataUrl)).toEqual(['data:,original1']);
    expect(screen.getByTestId('form')).toBeTruthy();
    await settle();
    expect(stored.draft.shots.map((s) => s.dataUrl)).toEqual(['data:,original1']);
    expect(mock.remove).not.toHaveBeenCalled();
  });

  it('앨범에서 1장만 고르면 1장 더 넣기를 묻고, 마지막 한 장을 지우면 신고를 지우고 처음 화면으로 간다', async () => {
    mock.list.mockResolvedValue([]); render(<App />); await screen.findByTestId('home');
    mock.album.mockResolvedValueOnce([{ takenAt: NOW - 600_000, dataUrl: 'data:,one', source: 'album' }]);
    click('album'); await screen.findByTestId('form');
    expect(screen.getByTestId('ask').textContent).toBe('true');
    click('asked'); expect(screen.getByTestId('ask').textContent).toBe('false');
    click('remove 0'); await screen.findByTestId('home');
    expect(mock.remove).toHaveBeenCalledTimes(1);
    expect(mock.remove.mock.calls[0][0]).toMatch(/\S/);
  });

  it('카메라로 빈 칸에 넣으면 있는 한 장을 1번째로 남기고 2번째만 찍는다', async () => {
    mock.list.mockResolvedValue([]); render(<App />); await screen.findByTestId('home');
    mock.album.mockResolvedValueOnce([{ takenAt: NOW - 600_000, dataUrl: 'data:,one', source: 'album' }]);
    click('album'); await screen.findByTestId('form');
    click('camera 1'); await screen.findByTestId('capture');
    expect(draft().shots.map((s) => s.dataUrl)).toEqual(['data:,one']);
  });
});

describe('판독 한도(429) — 한 번만, 천천히 자동으로 다시 판독', () => {
  it('한도에 걸린 사진은 잠시 뒤 한 번만 다시 부르고, 또 걸리면 더 부르지 않는다', async () => {
    mock.list.mockResolvedValue([]); render(<App />); await screen.findByTestId('home');
    mock.album.mockResolvedValueOnce([{ takenAt: NOW - 600_000, dataUrl: 'data:,one', source: 'album' }, { takenAt: NOW - 500_000, dataUrl: 'data:,two', source: 'album' }]);
    mock.read.mockImplementation(async () => ({ state: 'rate_limited' }));
    click('album'); await screen.findByTestId('form');
    await act(() => new Promise((r) => setTimeout(r, 10)));
    expect(mock.read).toHaveBeenCalledTimes(2);
    await act(() => new Promise((r) => setTimeout(r, 120)));
    expect(mock.read).toHaveBeenCalledTimes(4);
    await act(() => new Promise((r) => setTimeout(r, 200)));
    expect(mock.read).toHaveBeenCalledTimes(4);
  });

  it('다시 부른 판독이 성공하면 그 결과를 쓴다', async () => {
    mock.list.mockResolvedValue([]); render(<App />); await screen.findByTestId('home');
    mock.album.mockResolvedValueOnce([{ takenAt: NOW - 600_000, dataUrl: 'data:,one', source: 'album' }]);
    mock.read.mockResolvedValueOnce({ state: 'rate_limited' }).mockResolvedValueOnce({ state: 'ok', read, model: 'gemini-3-flash-preview' });
    click('album'); await screen.findByTestId('form');
    await act(() => new Promise((r) => setTimeout(r, 120)));
    expect(mock.read).toHaveBeenCalledTimes(2);
    expect(draft().reads?.[0]).toMatchObject({ evidence: read.evidence });
  });
});
