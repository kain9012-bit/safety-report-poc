import { describe, expect, it } from 'vitest';
import { appendPhoto, choosePrimary, evidenceKey, normalizeDraft, primaryShots, activeLocatedShot } from './photoEvidence';
import { replacementDraft } from './replacement';
import { precheck } from './precheck';
import { composeBody } from './compose';
import type { DraftReport } from '../types/report';
import { kstTime } from './kst';
const at = kstTime(2026, 10, 15, 10);
const original: DraftReport = { shots: [{ takenAt: at, dataUrl: 'first', originalDataUrl: 'original-first' }, { takenAt: at + 65_000, dataUrl: 'second' }], address: '사용자가 입력한 주소', body: '수동 본문', manual: { address: true, body: true, type: true }, type: 'hydrant' };
const verdict = { source: 'none' as const, suspicions: [], alternatives: [] };

describe('사진 보존과 명시적인 기본 쌍', () => {
  it('이전 기록을 읽어도 내용·원본을 바꾸지 않고 안정적인 ID를 부여한다', () => {
    const a = normalizeDraft(original), b = normalizeDraft(original);
    expect(a.primaryPair).toEqual(b.primaryPair);
    expect(a.shots[0].originalDataUrl).toBe('original-first');
    expect(original.shots[0].id).toBeUndefined();
    expect(a.body).toBe(original.body); expect(a.address).toBe(original.address);
  });
  it('보완사진의 늦은 시간이 기본 촬영 간격을 바꾸지 않는다', () => {
    const d = appendPhoto(original, { takenAt: at + 999_000, dataUrl: 'supplement' }, true);
    expect(d.shots).toHaveLength(3);
    expect(primaryShots(d).map((s) => s.dataUrl)).toEqual(['first', 'second']);
    expect(composeBody(d)).toContain('65초');
    expect(composeBody(d)).toContain('보완사진: 1장');
    const result = precheck({ draft: d, verdict, body: d.body!, now: at + 1000_000, minInterval: 60 });
    expect(result.checks.find((c) => c.id === 'interval')?.status).toBe('pass');
    expect(result.checks.find((c) => c.id === 'distance')?.status).toBe('warn');
  });
  it('한 장을 두 슬롯에 지정할 수 없고 쌍을 바꾸면 겹침을 무효화한다', () => {
    const d = { ...appendPhoto(original, { takenAt: at + 500, dataUrl: 'near' }, true), overlap: { same: true, ratio: 1, score: 1 } };
    expect(choosePrimary(d, d.primaryPair![0], 1).primaryPair).toEqual(d.primaryPair);
    const changed = choosePrimary(d, d.shots[2].id!, 1);
    expect(changed.overlap).toBeUndefined(); expect(changed.shots).toHaveLength(3);
    const checked = precheck({ draft: changed, verdict, body: '내용 입력', minInterval: 60, now: at + 1000_000 });
    expect(checked.checks.find((c) => c.id === 'interval')?.status).toBe('fail');
  });
  it('재촬영을 시작해도 기존 두 장과 보완사진이 후보 기록에 남는다', () => {
    const d = appendPhoto(original, { takenAt: at + 200_000, dataUrl: 'notice' }, true);
    const next = replacementDraft(d, 0);
    expect(primaryShots(next)).toHaveLength(0);
    expect(next.shots).toEqual(d.shots);
    expect(next.body).toBe(d.body); expect(next.address).toBe(d.address);
    expect(d.primaryPair).toHaveLength(2);
  });
  it('사진·기본 쌍·유형·정류소 변경은 확인 질문과 병행주차 재확인의 입력을 바꾼다', () => {
    const d = normalizeDraft(original), key = evidenceKey(d);
    expect(evidenceKey({ ...d, type: 'evcharging' })).not.toBe(key);
    expect(evidenceKey({ ...d, selectedStopId: 'different-stop' })).not.toBe(key);
    expect(evidenceKey(appendPhoto(d, { takenAt: at, dataUrl: 'another' }, true))).not.toBe(key);
    expect(evidenceKey({ ...d, body: '수정한 본문' })).toBe(key);
  });
  it('다시 지정한 기본 사진만 주소의 자동 위치로 쓴다', () => {
    const old = normalizeDraft({ ...original, shots: original.shots.map((s) => ({ ...s, lat: 35, lng: 127 })) });
    const d = appendPhoto(replacementDraft(old, 0), { takenAt: at + 200_000, dataUrl: 'newplace', lat: 37, lng: 128 });
    expect(d.shots).toHaveLength(3); expect(activeLocatedShot(d)?.lat).toBe(37);
  });
  it('같은 앨범 원본은 ID가 달라도 두 번의 촬영으로 세지 않는다', () => {
    const d = appendPhoto({ shots: [{ takenAt: at, dataUrl: 'copy-1', originalDataUrl: 'same', source: 'album' }] }, { takenAt: at + 65_000, dataUrl: 'copy-2', originalDataUrl: 'same', source: 'album' }, true);
    expect(choosePrimary(d, d.shots[1].id!, 1).primaryPair).toHaveLength(1);
  });
  it('EXIF 없는 앨범의 파일 수정 시각을 촬영 시각·간격으로 쓰지 않는다', () => {
    const d = normalizeDraft({ ...original, shots: original.shots.map((s) => ({ ...s, source: 'album' as const })) });
    expect(composeBody(d)).toContain('일시: 촬영 시각 미확인');
    expect(composeBody(d)).toContain('촬영 간격 미확인');
    expect(composeBody(d)).not.toContain('65초');
  });
  it('6대 밖 3개 유형·기타도 회의 결정대로 기본 규정(간격·접수 기한)을 점검하고 유형별 확인을 더한다', () => {
    for (const type of ['disabled', 'firelane', 'evcharging', 'other'] as const) {
      const d = { ...normalizeDraft(original), type, shots: normalizeDraft(original).shots.slice(0, 1) };
      const checked = precheck({ draft: d, verdict, body: '', now: at + 999_999_999 });
      expect(checked.checks.some((c) => c.id === 'interval')).toBe(true);
      expect(checked.checks.some((c) => c.id === 'deadline')).toBe(true);
      expect(checked.checks.some((c) => ['permit', 'ev', 'firelane', 'other'].includes(c.id))).toBe(true);
    }
  });
  it('자동 본문은 확인된 위반·동일 위치를 단정하지 않고 예외 안내를 남긴다', () => {
    const d = normalizeDraft(original);
    d.type = 'evcharging';
    d.sharedParking = { answer: 'yes', notice: '일반차 22시부터 가능', targetBay: '13', scope: 'unknown', permission: 'general', timeCondition: '22:00~07:00', timeMatch: 'unknown', conditions: '입주민에 한함', inputKey: evidenceKey(d), answeredAt: at };
    expect(composeBody(d)).toContain('입주민'); expect(composeBody(d)).toContain('위반 여부 별도 확인');
    expect(composeBody(d)).not.toContain('같은 자리 사진'); expect(composeBody(d)).not.toContain('불법 주정차');
    expect(composeBody(appendPhoto(d, { takenAt: at, dataUrl: 'new' }, true))).toContain('재확인 필요');
  });
});
