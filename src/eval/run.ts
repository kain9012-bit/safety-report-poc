/**
 * 사진 한 장을 앱과 똑같이 돌린다 — 줄이기(1280px) → /api/vision → 규칙(crosscheck·rankTypes·번호판 기준).
 * 채점 화면 전용. 사진은 저장하지 않는다.
 */
import { crosscheck } from '../lib/crosscheck';
import { rankTypes } from '../lib/choose';
import { rulesFor } from '../lib/localRules';
import { PLATE_CONFIDENCE_FLOOR, isValidPlate } from '../lib/rules';
import { shrink } from '../lib/vision';
import type { VisionResult } from '../../api/vision';
import type { Outcome, Row, Truth } from './score';

/** 단속 시간이 추천을 흔들지 않게 평일 오전 10시로 고정해 본다 */
const NEUTRAL_TIME = new Date(2026, 9, 7, 10, 0).getTime();

const toDataUrl = (f: File) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(f);
  });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 판독 한도(429)에 걸리면 기다렸다 다시 — 무료 키는 분당 호출 수가 적다 */
async function callVision(image: string, onWait: (sec: number) => void): Promise<VisionResult | string> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch('/api/vision', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ images: [image] }),
    }).catch(() => null);
    if (!res) return 'network';
    const j = (await res.json().catch(() => ({}))) as VisionResult & { error?: string };
    if (res.ok && j.plate) return j;
    if (j.error === 'rate_limited' || j.error === 'busy') {
      const wait = 15 + attempt * 15;
      onWait(wait);
      await sleep(wait * 1000);
      continue;
    }
    return j.error ?? `http_${res.status}`;
  }
  return 'rate_limited';
}

export function decide(row: Row, r: VisionResult): Outcome {
  const verdict = crosscheck([], {}, r);
  const auto: Truth = verdict.type ?? 'none';
  const opts = verdict.type
    ? rankTypes([verdict.type, ...verdict.alternatives], { takenAt: NEUTRAL_TIME, rules: rulesFor() })
    : [];
  const read = r.photos[0]?.plate ?? { text: '', readable: false, confidence: 0 };
  const fill = read.readable && read.confidence >= PLATE_CONFIDENCE_FLOOR && isValidPlate(read.text);
  return {
    row,
    ok: true,
    auto,
    recommended: opts.find((o) => o.recommended)?.type ?? auto,
    candidates: r.ruleTypes.filter((t): t is Truth => t !== 'none'),
    plateFilled: fill ? read.text : '',
    plateRead: read.text,
    plateConfidence: read.confidence,
    scene: r.photos[0]?.scene,
    evidence: r.evidence,
    model: r.model,
  };
}

export async function runOne(row: Row, file: File, onWait: (sec: number) => void): Promise<Outcome> {
  const fail = (error: string): Outcome => ({
    row,
    ok: false,
    error,
    auto: 'none',
    recommended: 'none',
    candidates: [],
    plateFilled: '',
    plateRead: '',
    plateConfidence: 0,
    evidence: '',
    model: '',
  });
  try {
    const img = await shrink(await toDataUrl(file));
    const r = await callVision(img, onWait);
    return typeof r === 'string' ? fail(r) : decide(row, r);
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'error');
  }
}
