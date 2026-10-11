/**
 * 판정 규칙 파일은 화면·브라우저·네트워크에 기대지 않는다.
 *
 * "AI는 보기만, 판정은 규칙이" 원칙을 지키려면 규칙이 어디서 돌든(브라우저·서버·채점 화면·시험) 같은 답을
 * 내야 한다. 주석으로만 적어 두면 지켜지지 않으므로 시험으로 강제한다.
 * (팀원 저장소 kjy-arch/parking-report 의 domain-purity 시험을 따랐다.)
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));

/** 판정 규칙 파일 — 새 규칙 파일을 만들면 여기에 더한다 */
const RULE_FILES = [
  'rules.ts',
  'precheck.ts',
  'crosscheck.ts',
  'choose.ts',
  'localRules.ts',
  'compose.ts',
  'officer.ts',
  'geo.ts',
  'recommend.ts',
  'kst.ts',
  'exifTime.ts',
  'authenticity.ts',
  'noParking.ts',
  '../eval/score.ts',
];

const FORBIDDEN: [string, RegExp][] = [
  ['react', /from\s+['"]react(-dom)?['"]/],
  ['lucide-react', /from\s+['"]lucide-react['"]/],
  ['window', /(^|[^.\w])window\b/],
  ['document', /(^|[^.\w])document\b/],
  ['navigator', /(^|[^.\w])navigator\b/],
  ['localStorage', /(^|[^.\w])localStorage\b/],
  ['indexedDB', /(^|[^.\w])indexedDB\b/],
  ['fetch()', /(^|[^.\w])fetch\s*\(/],
  ['process.env', /(^|[^.\w])process\.env\b/],
  ['Math.random', /Math\.random\s*\(/],
  ['현지 시각(getHours 등)', /\.(getHours|getDay|getDate|getMonth|getFullYear|setHours|setDate)\s*\(/],
];

/** 주석은 빼고 본다 — 설명 글에 'window' 가 나와도 걸리지 않게 */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('판정 규칙 파일의 순수성', () => {
  for (const f of RULE_FILES) {
    it(`${f} — 화면·브라우저·네트워크·현지 시각에 기대지 않는다`, () => {
      const src = code(readFileSync(path.join(here, f), 'utf8'));
      const hits = FORBIDDEN.filter(([, re]) => re.test(src)).map(([name]) => name);
      expect(hits).toEqual([]);
    });
  }
});
