// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import type { ReportRecord } from './lib/reports';
import type { DraftReport } from './types/report';
import type { PhotoRead, VisionResult } from '../api/vision';
import App from './App';
import { normalizeDraft, primaryShots } from './lib/photoEvidence';
import { kstTime } from './lib/kst';

const mock = vi.hoisted(() => ({ list: vi.fn(), save: vi.fn(), remove: vi.fn(), read: vi.fn(), album: vi.fn(), albumFile: vi.fn(), geocode: vi.fn(), overlap: vi.fn() }));
vi.mock('./lib/reports', async (original) => ({ ...await original<object>(), listReports: mock.list, saveReport: mock.save, deleteReport: mock.remove }));
vi.mock('./lib/vision', () => ({ readOne: mock.read }));
vi.mock('./lib/album', () => ({ readAlbum: mock.album, readAlbumFile: mock.albumFile }));
vi.mock('./lib/reverseGeocode', () => ({ reverseGeocode: mock.geocode }));
vi.mock('./lib/facilities', () => ({ loadNearby: vi.fn(async () => ({ state: 'ok', busstops: [], crosswalks: [], schools: [], missing: [] })) }));
vi.mock('./lib/recommend', () => ({ recommend: () => [] }));
vi.mock('./lib/overlap', () => ({ OVERLAP_MIN: 0.7, compareShots: mock.overlap }));
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
  <output data-testid="step">{p.step}</output>
  {p.step === 0 && p.evidencePanel}
  <button onClick={() => p.onStep(p.step + 1)}>next step</button>
  <button onClick={p.onRetake}>retake</button><button onClick={p.onHome}>home</button><button onClick={p.onSubmit}>submit</button>
  <button onClick={() => p.onEdit('body', '수정한 수동 내용')}>edit body</button>
</div> }));

const NOW = kstTime(2026, 10, 7, 11);
const read: PhotoRead = { plate: { text: '12가3456', readable: true, confidence: .95 }, scene: { onCrosswalk: 'yes', onSidewalk: 'no', busStopVisible: 'no', schoolZoneMarking: 'no', intersectionCorner: 'no', fireHydrantNear: 'no' }, typeGuess: 'crossing', typeConfidence: .9, evidence: 'synthetic', boxes: [] };
const initial = (): ReportRecord => ({
  id: 'r1', phase: 'form', step: 0, createdAt: NOW - 120_000, updatedAt: NOW,
  draft: { shots: [0, 61_000].map((delta, i) => ({ takenAt: NOW - 120_000 + delta, dataUrl: `data:,original${i}`, lat: 35, lng: 127, source: 'camera' })),
    reads: [read, read], type: 'crossing', plate: '12가3456', address: '전북특별자치도 전주시 완산구 테스트길', body: '기존 수동 신고 내용',
    manual: { body: true, address: true, plate: true, type: true }, overlap: { ratio: .9, score: .9, same: true }, firstOk: true },
});
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
  mock.geocode.mockResolvedValue({ state: 'error' });
  mock.overlap.mockResolvedValue({ ratio: 0.9, score: 0.9, same: true });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const boot = async () => { render(<App />); await screen.findByTestId('form'); };

describe('실제 App의 보존·저장 화면 전환', () => {
  it('두 번째 재촬영 중 기존 두 사진과 수동 입력을 저장소에 유지하고 취소하면 복원한다', async () => {
    await boot(); click('retake'); await screen.findByTestId('capture');
    expect(primaryShots(draft())).toHaveLength(1);
    expect(draft().shots).toHaveLength(2);
    click('shot');
    await act(() => new Promise((r) => setTimeout(r, 350)));
    expect(stored.draft.shots).toEqual(normalizeDraft(initial().draft).shots);
    expect(stored.draft.body).toBe(initial().draft.body);
    click('재촬영 취소 · 기존 자료로 돌아가기');
    await screen.findByTestId('form');
    expect(draft()).toEqual(normalizeDraft(initial().draft));
    cleanup(); await boot(); expect(draft()).toEqual(normalizeDraft(initial().draft));
  });

  it('첫 사진 재촬영도 수동 주소·본문을 유지하며 저장 실패 후 기존 사진을 복원한다', async () => {
    await boot(); click('retake'); await screen.findByTestId('capture'); click('retake first');
    expect(primaryShots(draft())).toHaveLength(0); expect(draft().shots).toHaveLength(2); expect(draft().address).toBe(initial().draft.address); expect(draft().body).toBe(initial().draft.body);
    click('shot'); click('shot'); mock.save.mockRejectedValueOnce(new Error('quota')); click('finish');
    await screen.findByRole('alert');
    expect(stored.draft.shots).toEqual(normalizeDraft(initial().draft).shots); expect(primaryShots(draft())[0].dataUrl).toBe('data:,replacement');
    click('재촬영 취소 · 기존 자료로 돌아가기'); await screen.findByTestId('form'); expect(draft()).toEqual(normalizeDraft(initial().draft));
  });

  it('교체 저장 커밋 전에는 촬영 화면에 머물고 성공 후에만 새 사진으로 넘어간다', async () => {
    await boot(); click('retake'); await screen.findByTestId('capture'); click('shot');
    const commit = deferred<void>(); mock.save.mockImplementationOnce(async (r: ReportRecord) => { await commit.promise; stored = structuredClone(r); });
    click('finish'); expect(screen.queryByTestId('form')).toBeNull(); expect(stored.draft.shots).toEqual(normalizeDraft(initial().draft).shots);
    await act(async () => commit.resolve()); await screen.findByTestId('form');
    expect(primaryShots(stored.draft)[1].dataUrl).toBe('data:,replacement'); expect(stored.draft.body).toBe(initial().draft.body);
  });

  it('제출 저장 실패를 성공으로 표시하지 않고 입력을 유지한 채 재시도한다', async () => {
    await boot(); mock.save.mockRejectedValueOnce(new Error('quota')); click('submit');
    await screen.findByRole('alert'); expect(screen.queryByTestId('home')).toBeNull(); expect(stored.phase).toBe('form'); expect(draft().body).toBe(initial().draft.body);
    await act(() => new Promise((r) => setTimeout(r, 350)));
    expect(screen.getByRole('alert')).toBeTruthy();
    click('다시 시도'); await screen.findByTestId('home'); expect(stored.phase).toBe('submitted');
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
    expect(draft().shots).toEqual(normalizeDraft(initial().draft).shots); expect(draft().body).toBe('수정한 수동 내용');
    click('다시 시도'); await screen.findByTestId('capture'); expect(stored.draft.body).toBe('수정한 수동 내용');
  });

  it('재촬영을 취소한 뒤 도착한 AI 결과가 복원한 사진·판독을 바꾸지 않는다', async () => {
    const reading = deferred<{ state: string; read: PhotoRead }>(); mock.read.mockReturnValueOnce(reading.promise);
    await boot(); click('retake'); await screen.findByTestId('capture'); click('shot');
    click('재촬영 취소 · 기존 자료로 돌아가기'); await screen.findByTestId('form');
    await act(async () => reading.resolve({ state: 'ok', read: { ...read, evidence: 'late replacement read' } }));
    expect(draft()).toEqual(normalizeDraft(initial().draft)); expect(stored.draft).toEqual(normalizeDraft(initial().draft));
  });

  it('삭제 실패 시 보관함에 기존 자료를 남기고 오류를 알린다', async () => {
    await boot(); click('home'); await screen.findByTestId('home'); mock.remove.mockRejectedValueOnce(new Error('abort'));
    click('delete r1'); await screen.findByRole('alert'); expect(screen.getByRole('button', { name: 'open r1' })).toBeTruthy();
    expect(stored.draft).toEqual(normalizeDraft(initial().draft));
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


describe('보완사진 비동기 추가의 화면 보존', () => {
  it('읽는 동안 단계 이동을 막아 보완 화면을 유지하고 완료 후에는 이동한다', async () => {
    const work = deferred<DraftReport['shots'][number]>(); mock.albumFile.mockReturnValue(work.promise);
    await boot();
    fireEvent.change(document.querySelector('input[type=file]')!, { target: { files: [new File(['synthetic'], 'extra.png')] } });
    await screen.findByText('사진을 읽는 중…');
    click('next step');
    expect(screen.getByTestId('step').textContent).toBe('0');
    expect(screen.getByRole('button', { name: '추가 취소' })).toBeTruthy();
    await act(async () => work.resolve({ takenAt: NOW, dataUrl: 'data:,extra', originalDataUrl: 'data:,extra-original', source: 'album' }));
    expect(draft().shots).toHaveLength(3);
    expect(draft().shots[2].originalDataUrl).toBe('data:,extra-original');
    click('next step'); expect(screen.getByTestId('step').textContent).toBe('1');
    expect(draft().shots).toHaveLength(3);
  });
  it('읽는 동안 홈 이동을 막고 완료 후 기본 쌍·수동 입력과 함께 저장한다', async () => {
    const work = deferred<DraftReport['shots'][number]>(); mock.albumFile.mockReturnValue(work.promise);
    await boot();
    fireEvent.change(document.querySelector('input[type=file]')!, { target: { files: [new File(['synthetic'], 'extra.png')] } });
    await screen.findByText('사진을 읽는 중…');
    click('home'); expect(screen.queryByTestId('home')).toBeNull();
    await act(async () => work.resolve({ takenAt: NOW, dataUrl: 'data:,extra', source: 'album' }));
    expect(draft().shots).toHaveLength(3); expect(primaryShots(draft())).toHaveLength(2);
    expect(draft().body).toBe(initial().draft.body); expect(draft().address).toBe(initial().draft.address);
    click('home'); await screen.findByTestId('home');
    expect(stored.draft.shots).toHaveLength(3); expect(primaryShots(stored.draft).map(s => s.dataUrl)).toEqual(initial().draft.shots.map(s => s.dataUrl));
  });
  it('추가 취소 후 늦게 읽힌 사진이 기록을 바꾸지 않는다', async () => {
    const work = deferred<DraftReport['shots'][number]>(); mock.albumFile.mockReturnValue(work.promise);
    await boot();
    fireEvent.change(document.querySelector('input[type=file]')!, { target: { files: [new File(['synthetic'], 'extra.png')] } });
    await screen.findByText('사진을 읽는 중…'); click('추가 취소');
    await act(async () => work.resolve({ takenAt: NOW, dataUrl: 'data:,late', source: 'album' }));
    expect(draft().shots).toHaveLength(2); expect(draft().body).toBe(initial().draft.body);
    click('home'); await screen.findByTestId('home'); expect(stored.draft.shots).toHaveLength(2);
  });
});

describe('사진 ID에 따른 주소·겹침 재점검', () => {
  it('촬영시각이 같은 다른 기본 사진을 고르면 주소와 겹침을 다시 확인한다', async () => {
    stored.draft.manual = { ...stored.draft.manual, address: false };
    stored.draft.overlap = undefined;
    stored.draft.shots.push({ id: 'other-photo', takenAt: stored.draft.shots[0].takenAt, dataUrl: 'data:,other-photo', source: 'album', lat: 36, lng: 128 });
    stored.draft.reads!.push(read);
    mock.geocode.mockResolvedValue({ state: 'ok', road: '새 사진의 자동 주소' });
    await boot();
    await waitFor(() => expect(draft().overlap?.same).toBe(true));
    expect(mock.overlap).toHaveBeenCalledTimes(1);
    expect(mock.geocode).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole('button', { name: '기본 1로 지정' })[2]);
    await waitFor(() => expect(mock.overlap).toHaveBeenCalledTimes(2));
    expect(mock.overlap).toHaveBeenLastCalledWith('data:,other-photo', 'data:,original1');
    expect(mock.geocode).toHaveBeenCalledWith(36, 128);
    await waitFor(() => expect(draft().address).toBe('새 사진의 자동 주소'));
    expect(primaryShots(draft())[0].id).toBe('other-photo');
    expect(draft().shots).toHaveLength(3);
  });

  it('비교 중 사진 역할만 바꿔도 같은 기본 사진의 겹침 결과를 보관한다', async () => {
    const comparison = deferred<{ ratio: number; score: number; same: boolean }>();
    stored.draft.overlap = undefined;
    mock.overlap.mockReturnValueOnce(comparison.promise);
    await boot();
    fireEvent.click(screen.getAllByRole('checkbox', { name: '주변 전경' })[0]);
    await act(async () => comparison.resolve({ ratio: .82, score: .91, same: true }));
    expect(draft().overlap).toEqual({ ratio: .82, score: .91, same: true });
    expect(mock.overlap).toHaveBeenCalledTimes(1);
  });
});
