import { describe, expect, it } from 'vitest';
import { cameraDraft, removePhoto, replacePhoto } from './replacement';
import { normalizeRead } from '../../api/vision';
import type { PhotoRead } from '../../api/vision';
import { locatedShot } from '../types/report';
import type { DraftReport } from '../types/report';
import { kstTime } from './kst';

const at = kstTime(2026, 10, 15, 10);
const read = (text: string) => normalizeRead({ plate: { text, readable: true, confidence: 0.9 } }) as PhotoRead;
const base: DraftReport = {
  shots: [
    { takenAt: at, dataUrl: 'first', lat: 37.5, lng: 127, source: 'camera' },
    { takenAt: at + 65_000, dataUrl: 'second', source: 'camera' },
  ],
  reads: [read('12가3456'), read('12가3456')],
  address: '첫 사진 자리의 주소', plate: '12가3456', body: '수동 본문', manual: { body: true },
  overlap: { ratio: 0.9, score: 0.8, same: true },
};
const album = (dataUrl: string, takenAt: number, exif = true) =>
  ({ takenAt, dataUrl, source: 'album' as const, meta: exif ? { takenAt } : {} }) as DraftReport['shots'][number];

describe('신고서 사진 칸 — 바꾸기·넣기·지우기', () => {
  it('앨범으로 바꾼 사진은 판독을 비워 다시 읽고, 남은 사진의 판독은 그대로 둔다', () => {
    const d = replacePhoto(base, 1, album('new', at + 120_000));
    expect(d.shots.map((s) => s.dataUrl)).toEqual(['first', 'new']);
    expect(d.reads?.[0]).toBe(base.reads?.[0]);
    expect(d.reads?.[1]).toBeUndefined();
    expect(d.overlap).toBeUndefined();
    // 원래 기록은 바꾸지 않는다
    expect(base.shots.map((s) => s.dataUrl)).toEqual(['first', 'second']);
  });
  it('두 장은 촬영 시각 순으로 1·2번째가 된다 — 1번째를 더 늦은 사진으로 바꾸면 순서가 바뀐다', () => {
    const d = replacePhoto(base, 0, album('later', at + 300_000));
    expect(d.shots.map((s) => s.dataUrl)).toEqual(['second', 'later']);
    expect(d.reads?.[0]).toBe(base.reads?.[1]);
  });
  it('촬영 시각 기록이 없는 앨범 사진은 시각을 지어내지 않고 2번째에 둔다', () => {
    const d = replacePhoto(base, 1, album('no-exif', at - 999_000, false));
    expect(d.shots.map((s) => s.dataUrl)).toEqual(['first', 'no-exif']);
  });
  it('사진이 1장일 때 빈 칸에 넣으면 2장이 된다', () => {
    const one: DraftReport = { shots: [album('only', at)], firstOk: true };
    expect(replacePhoto(one, 1, album('more', at + 70_000)).shots.map((s) => s.dataUrl)).toEqual(['only', 'more']);
  });
  it('지우면 남은 사진이 1번째가 되고 판독도 같이 따라간다', () => {
    const d = removePhoto(base, 0);
    expect(d.shots.map((s) => s.dataUrl)).toEqual(['second']);
    expect(d.reads).toEqual([base.reads?.[1]]);
  });
  it('발생지역을 정한 사진이 빠지면 직접 고치지 않은 주소는 비우고, 직접 고친 주소·내용은 그대로 둔다', () => {
    const removed = removePhoto(base, 0);
    expect(locatedShot(removed.shots)).toBeUndefined();
    expect(removed.address).toBeUndefined();
    expect(removed.body).toBe('수동 본문');
    expect(removePhoto({ ...base, manual: { ...base.manual, address: true } }, 0).address).toBe('첫 사진 자리의 주소');
    // 위치 사진이 남으면 주소도 남는다
    expect(removePhoto(base, 1).address).toBe('첫 사진 자리의 주소');
  });
  it('직접 입력하지 않은 차량번호는 비워 두 장에서 다시 맞추고, 직접 입력한 번호는 둔다', () => {
    expect(replacePhoto(base, 1, album('new', at + 120_000)).plate).toBeUndefined();
    expect(replacePhoto({ ...base, manual: { plate: true } }, 1, album('new', at + 120_000)).plate).toBe('12가3456');
  });
  it('카메라로 바꾸면 다른 한 장을 1번째로 남기고 2번째를 새로 찍는다 — 남길 사진이 없으면 두 장을 처음부터', () => {
    const keepSecond = cameraDraft(base, 1);
    expect(keepSecond.shots.map((s) => s.dataUrl)).toEqual(['second']);
    expect(keepSecond.firstOk).toBe(true);
    expect(keepSecond.reads).toEqual([base.reads?.[1]]);
    expect(cameraDraft(base, 0).shots.map((s) => s.dataUrl)).toEqual(['first']);
    const fresh = cameraDraft(base, undefined);
    expect(fresh.shots).toHaveLength(0);
    expect(fresh.firstOk).toBe(false);
    expect(base.shots).toHaveLength(2);
  });
});
