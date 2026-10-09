// 발표자료 조판 점검 — 장마다 모든 조각을 띄운 뒤 글 상자의 실제 줄바꿈을 읽어 문제를 찾는다.
// 준비: npm i --no-save playwright && npx playwright install chromium
// 사용: node scripts/deck-check.mjs [public/deck/index.html] [장마다 대기 ms]
//  - 외톨이 줄: 두 줄 이상인데 마지막 줄이 어절 1개이거나 4글자 이하
//  - 불균형: 두 줄인데 마지막 줄이 첫 줄의 45% 미만
//  - 어절 쪼개짐: 한 어절이 두 줄에 걸침
//  - 내어쓰기 없음: 첫 줄이 !·✕·번호로 시작하면 둘째 줄은 그 다음 글자에 맞춘다
//  - 넘침·화면 밖, 본문 자간 -0.03em보다 좁음
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const here = path.dirname(fileURLToPath(import.meta.url));
const [fileArg, waitArg] = process.argv.slice(2);
const file = path.resolve(fileArg || path.join(here, '../public/deck/index.html'));
const WAIT = +(waitArg || 3500);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
await p.goto('file://' + file + '#1', { waitUntil: 'load' }); await p.waitForTimeout(800);
const N = await p.evaluate(() => window.__deck.count);
await p.evaluate(() => document.fonts.ready);
let total = 0;
for (let i = 1; i <= N; i++) {
  await p.evaluate((i) => window.__deck.go(i - 1), i);
  await p.waitForTimeout(WAIT);
  const issues = await p.evaluate(() => {
    const slide = document.querySelector('.slide.active');
    const out = [];
    const blocks = [...slide.querySelectorAll('*')].filter((el) => {
      const cs = getComputedStyle(el);
      if (cs.display === 'inline' || cs.visibility === 'hidden' || +cs.opacity === 0) return false;
      if (['SCRIPT', 'STYLE', 'SVG', 'svg', 'VIDEO', 'IMG'].includes(el.tagName)) return false;
      // 직접 글자를 가진 블록만
      return [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    });
    for (const el of blocks) {
      const words = [];
      const walk = (node) => {
        for (const n of node.childNodes) {
          if (n.nodeType === 3) {
            const re = /\S+/g; let m;
            while ((m = re.exec(n.textContent))) {
              const r = document.createRange(); r.setStart(n, m.index); r.setEnd(n, m.index + m[0].length);
              const rects = [...r.getClientRects()].filter((q) => q.width > 0);
              if (rects.length) words.push({ w: m[0], rects, marker: node !== el && node.childNodes.length === 1 && m[0].length <= 2 && /^[!✕•·※\-\d①-⑳]+$/.test(m[0]) && node === el.firstElementChild });
            }
          } else if (n.nodeType === 1 && n.tagName === 'BR') words.push({ br: true });
          else if (n.nodeType === 1 && getComputedStyle(n).display.startsWith('inline')) walk(n);
        }
      };
      walk(el);
      if (!words.length) continue;
      const text = el.innerText.replace(/\s+/g, ' ').trim().slice(0, 60);
      // 줄 묶기
      // 줄 묶기 — 앞 줄의 아래끝보다 아래에서 시작하면 새 줄(크기가 다른 글자가 섞여도 같은 줄로 본다)
      const lines = []; let lineBottom = -1e9;
      for (const wd of words) {
        if (wd.br) continue;
        const r0 = wd.rects[0], r1 = wd.rects.at(-1);
        if (wd.rects.length > 1 && r1.top >= r0.bottom - 2) out.push({ kind: '어절 쪼개짐', text, word: wd.w });
        if (r0.top >= lineBottom - 2) { lines.push([]); lineBottom = r0.bottom; } else lineBottom = Math.max(lineBottom, r0.bottom);
        lines.at(-1).push(wd.w);
      }
      // 내어쓰기 — 첫 줄이 표지(!, ✕, 번호)로 시작하면 둘째 줄은 표지 다음 글자에 맞춘다
      const ws = words.filter((w) => !w.br);
      if (ws.length > 2 && ws[0].marker) {
        const body = ws[1].rects[0].left;
        const l2 = ws.find((w, k) => k > 0 && w.rects[0].top >= ws[0].rects[0].bottom - 2);
        if (l2 && Math.abs(l2.rects[0].left - body) > 3) out.push({ kind: '내어쓰기 없음', text });
      }
      const len = (l) => l.join(' ').length;
      // 사람이 <br>로 나눈 줄은 의도된 것 — 자동 줄바꿈만 검사
      const hasBr = words.some((w) => w.br);
      if (lines.length >= 2 && !hasBr) {
        const last = lines.at(-1), first = lines[0];
        if (last.length === 1 || len(last) <= 4) out.push({ kind: '외톨이 줄', text, lines: lines.map((l) => l.join(' ')) });
        else if (lines.length === 2 && len(last) < len(first) * 0.45) out.push({ kind: '불균형', text, lines: lines.map((l) => l.join(' ')) });
      }
      const cs = getComputedStyle(el);
      const fs = parseFloat(cs.fontSize), ls = cs.letterSpacing === 'normal' ? 0 : parseFloat(cs.letterSpacing);
      if (fs < 24 && ls / fs < -0.031) out.push({ kind: '자간 좁음', text, ratio: (ls / fs).toFixed(3) });
      const er = el.getBoundingClientRect();
      if (el.scrollWidth > el.clientWidth + 2 && cs.overflow !== 'visible') out.push({ kind: '넘침', text });
      const st = slide.getBoundingClientRect();
      if (er.right > st.right + 1 || er.bottom > st.bottom + 1) out.push({ kind: '화면 밖', text });
    }
    return out;
  });
  total += issues.length; 
  for (const it of issues) console.log(`[${i}] ${it.kind} · ${it.text}${it.lines ? '  →  ' + it.lines.join(' / ') : ''}${it.word ? ' (' + it.word + ')' : ''}${it.ratio ? ' ' + it.ratio : ''}`);
}
console.log(total ? `문제 ${total}건` : '문제 없음');
process.exitCode = total ? 1 : 0;
await b.close();
