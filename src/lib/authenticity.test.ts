import { describe, expect, it } from 'vitest';
import { EDIT_APPS, checkAlbum, checkAlbumPair, checkAlbumPhoto, worst } from './authenticity';
import { precheck } from './precheck';
import { INTERVAL_SEC, MIN_INTERVAL_SEC } from './rules';
import type { PhotoMeta } from './authenticity';
import type { Verdict } from './crosscheck';
import type { DraftReport, Shot } from '../types/report';

const T = new Date(2026, 9, 2, 14, 0, 0).getTime();
const NOW = T + 10 * 60_000;
const meta = (o: Partial<PhotoMeta> = {}): PhotoMeta => ({
  takenAt: T,
  modifiedAt: T,
  software: '17.5.1',
  make: 'Apple',
  model: 'iPhone 15',
  lat: 35.8242,
  lng: 127.148,
  width: 4032,
  height: 3024,
  fileName: 'IMG_0001.JPG',
  fileSize: 2_000_000,
  ...o,
});
const status = (cs: { id: string; status: string }[], idPart: string) => cs.find((c) => c.id.includes(idPart))?.status;

describe('앨범 사진 한 장', () => {
  it('폰 카메라 원본은 모두 통과', () => {
    expect(worst(checkAlbumPhoto(meta(), NOW))).toBe('pass');
  });
  it('촬영시각이 없으면 받을 수 없다 — 캡처·메신저 전송 사진', () => {
    expect(status(checkAlbumPhoto(meta({ takenAt: undefined }), NOW), 'time')).toBe('fail');
  });
  it('촬영 익일이 지났으면 받을 수 없다 — 지난 사진 재활용', () => {
    const old = new Date(2026, 8, 28, 9, 0).getTime();
    expect(status(checkAlbumPhoto(meta({ takenAt: old, modifiedAt: old }), NOW), 'time')).toBe('fail');
  });
  it('미래 시각은 받을 수 없다', () => {
    expect(status(checkAlbumPhoto(meta({ takenAt: NOW + 3_600_000 }), NOW), 'time')).toBe('fail');
  });
  it('편집 앱 기록·촬영 뒤 수정은 확인 필요', () => {
    expect(status(checkAlbumPhoto(meta({ software: 'Adobe Photoshop Lightroom' }), NOW), 'edit')).toBe('warn');
    expect(status(checkAlbumPhoto(meta({ software: 'Snapseed 2.0' }), NOW), 'edit')).toBe('warn');
    expect(status(checkAlbumPhoto(meta({ modifiedAt: T + 5 * 60_000 }), NOW), 'edit')).toBe('warn');
  });
  it('폰 OS 버전·제조사 펌웨어 표기는 편집으로 보지 않는다', () => {
    for (const sw of ['17.5.1', 'G998NKSU5EWA3', 'HDR+ 1.0.540104767zd', 'Android']) expect(EDIT_APPS.test(sw)).toBe(false);
  });
  it('카메라 정보가 없으면 확인 필요(캡처·내려받은 그림)', () => {
    expect(status(checkAlbumPhoto(meta({ make: undefined, model: undefined }), NOW), 'camera')).toBe('warn');
  });
  it('위치가 지워졌으면 확인 필요 — 불가가 아니다(폰이 지우는 경우가 많음)', () => {
    expect(status(checkAlbumPhoto(meta({ lat: undefined, lng: undefined }), NOW), 'gps')).toBe('warn');
  });
  it('작은 사진은 확인 필요', () => {
    expect(status(checkAlbumPhoto(meta({ width: 640, height: 480 }), NOW), 'size')).toBe('warn');
  });
});

describe('앨범 사진 두 장', () => {
  it('61초 간격·같은 카메라·같은 자리 → 통과', () => {
    expect(worst(checkAlbum([meta(), meta({ takenAt: T + 61_000, modifiedAt: T + 61_000, fileName: 'IMG_0002.JPG' })], NOW))).toBe('pass');
  });
  it('1분 미만 간격은 받을 수 없다(실제 기준)', () => {
    expect(status(checkAlbumPair(meta(), meta({ takenAt: T + 20_000, fileName: 'b' }), MIN_INTERVAL_SEC), 'gap')).toBe('fail');
  });
  it('테스트 중에는 앨범도 카메라와 같은 INTERVAL_SEC 기준', () => {
    const gap = (s: number) => checkAlbumPair(meta(), meta({ takenAt: T + s * 1000, fileName: 'b' })).find((c) => c.id === 'pair-gap')!;
    expect(gap(INTERVAL_SEC - 1).status).toBe('fail');
    expect(gap(INTERVAL_SEC).status).toBe('pass');
    if (INTERVAL_SEC < MIN_INTERVAL_SEC) expect(gap(INTERVAL_SEC).detail).toContain('테스트용');
  });
  it('같은 파일 두 번', () => {
    expect(status(checkAlbumPair(meta(), meta()), 'dup')).toBe('fail');
  });
  it('카메라가 다르거나 40m 떨어졌으면 확인 필요', () => {
    expect(status(checkAlbumPair(meta(), meta({ takenAt: T + 70_000, model: 'Galaxy S24', fileName: 'b' })), 'camera')).toBe('warn');
    expect(status(checkAlbumPair(meta(), meta({ takenAt: T + 70_000, lat: 35.8242 + 40 / 111_320, fileName: 'b' })), 'spot')).toBe('warn');
  });
});

describe('제출 전 점검', () => {
  const shot = (dt: number, o: Partial<Shot> = {}): Shot => ({ takenAt: T + dt * 1000, lat: 35.8242, lng: 127.148, accuracy: 5, dataUrl: '', ...o });
  const ok: Verdict = { type: 'busstop', source: 'photo_confirmed', suspicions: [], alternatives: [] };
  const draft = (o: Partial<DraftReport> = {}): DraftReport => ({
    shots: [shot(0), shot(65)],
    type: 'busstop',
    plate: '12가3456',
    address: '전북특별자치도 전주시 완산구 노송광장로 10',
    ...o,
  });
  const vision = { sameVehicle: 'yes', plate: { reads: ['12가3456', '12가3456'] } } as never;

  it('다 채워지고 사진 증거가 있으면 제출할 수 있다', () => {
    const r = precheck({ draft: draft(), body: '내용 다섯 자 이상', verdict: ok, vision, now: NOW });
    expect(r.blocked).toBe(false);
  });
  it('유형이 비면 막는다', () => {
    const r = precheck({ draft: draft({ type: undefined }), body: '내용입니다', verdict: { ...ok, type: undefined, source: 'none' }, vision, now: NOW });
    expect(r.blocked).toBe(true);
    expect(status(r.checks, 'evidence')).toBe('fail');
  });
  it('두 장 번호가 다르면 막는다', () => {
    const r = precheck({ draft: draft(), body: '내용입니다', verdict: ok, vision: { sameVehicle: 'no', plate: { reads: ['12가3456', '34나5678'] } } as never, now: NOW });
    expect(status(r.checks, 'vehicle')).toBe('fail');
  });
  it('어린이보호구역은 08~20시 밖이면 막는다', () => {
    const night = new Date(2026, 9, 2, 22, 0).getTime();
    const d = draft({ type: 'schoolzone', shots: [{ ...shot(0), takenAt: night }, { ...shot(0), takenAt: night + 65_000 }] });
    const r = precheck({ draft: d, body: '내용입니다', verdict: { ...ok, type: 'schoolzone' }, vision, now: night + 120_000 });
    expect(status(r.checks, 'hours')).toBe('fail');
  });
  it('실제 기준(1분)이면 3초 간격은 막는다', () => {
    const r = precheck({ draft: draft({ shots: [shot(0), shot(3)] }), body: '내용입니다', verdict: ok, vision, now: NOW, minInterval: MIN_INTERVAL_SEC });
    expect(r.checks.find((x) => x.id === 'interval')!.status).toBe('fail');
  });
  it('테스트 중에는 카메라·앨범 모두 INTERVAL_SEC로 보고 그 사실을 적는다', () => {
    const cam = precheck({ draft: draft({ shots: [shot(0), shot(INTERVAL_SEC)] }), body: '내용입니다', verdict: ok, vision, now: NOW });
    expect(cam.checks.find((x) => x.id === 'interval')!.status).toBe('pass');
    const alb = precheck({
      draft: draft({
        shots: [
          shot(0, { source: 'album', meta: meta() }),
          shot(INTERVAL_SEC, { source: 'album', meta: meta({ takenAt: T + INTERVAL_SEC * 1000, modifiedAt: T + INTERVAL_SEC * 1000, fileName: 'b' }) }),
        ],
      }),
      body: '내용입니다', verdict: ok, vision, now: NOW,
    });
    expect(alb.checks.find((x) => x.id === 'interval')!.status).toBe('pass');
    expect(alb.album.find((x) => x.id === 'pair-gap')!.status).toBe('pass');
    if (INTERVAL_SEC < MIN_INTERVAL_SEC) expect(alb.album.find((x) => x.id === 'pair-gap')!.detail).toContain('테스트용');
  });
  it('앨범 사진은 진위 점검이 함께 들어가고, 촬영시각이 없으면 막는다', () => {
    const d = draft({
      shots: [shot(0, { source: 'album', meta: meta({ takenAt: undefined }) }), shot(65, { source: 'album', meta: meta({ takenAt: T + 65_000, fileName: 'b' }) })],
    });
    const r = precheck({ draft: d, body: '내용입니다', verdict: ok, vision, now: NOW });
    expect(status(r.checks, 'album')).toBe('fail');
    expect(r.album.length).toBeGreaterThan(0);
    expect(r.blocked).toBe(true);
  });
});
