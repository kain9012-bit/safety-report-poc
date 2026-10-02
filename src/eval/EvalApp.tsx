import { useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Download, FileSpreadsheet, FolderOpen, Play, Square } from 'lucide-react';
import { HEADER, TYPE_ORDER, parseAnswers, score, toCsv } from './score';
import type { Outcome, Rate, Row, Truth } from './score';
import { runOne } from './run';
import type { Scene } from '../../api/vision';

const NAME: Record<Truth, string> = {
  crossing: '횡단보도',
  sidewalk: '인도',
  hydrant: '소화전',
  busstop: '버스정류소',
  corner: '교차로 모퉁이',
  schoolzone: '어린이보호구역',
  none: '위반 아님·비움',
};
const SCENE_NAME: Record<keyof Scene, string> = {
  onCrosswalk: '횡단보도 위',
  onSidewalk: '인도 위',
  busStopVisible: '정류장 표지',
  schoolZoneMarking: '보호구역 표시',
  intersectionCorner: '교차로 모퉁이',
  fireHydrantNear: '소화전',
};
const CAUSES = ['사진 문제', 'AI 판독', '규칙', '정답 애매'];
const TARGET = 0.95;
const HISTORY_KEY = 'eval-history';

interface Past {
  at: string;
  label: string;
  model: string;
  split: string;
  n: number;
  type: number;
  rec: number;
  plate: number;
  plateWrong: number;
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

function template(): string {
  return (
    '﻿' +
    [
      HEADER.join(','),
      '# 예시 — 이 줄처럼 #으로 시작하는 줄은 읽지 않습니다',
      '# 1,IMG_0001.jpg,개선,횡단보도,,12가3456,O,주간,맑음,X,',
      '# 2,IMG_0002.jpg,시험,소화전,어린이보호구역,,X,야간,비,X,번호판 가려짐',
    ].join('\r\n')
  );
}

function download(name: string, text: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function loadHistory(): Past[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]') as Past[];
  } catch {
    return [];
  }
}

/**
 * 판독 채점 화면 — 팀이 찍은 사진과 정답표를 넣으면, 사진 1장씩 앱과 같은 규칙으로 돌려
 * 유형 정답률·오답률·보류율, 번호판 정확률·오채움을 계산한다.
 * 사진은 이 브라우저에서 줄여 판독 서버로 보낼 뿐 어디에도 저장하지 않는다.
 */
export default function EvalApp() {
  const [rows, setRows] = useState<Row[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [files, setFiles] = useState<Map<string, File>>(new Map());
  const [split, setSplit] = useState<'all' | 'dev' | 'test'>('dev');
  const [label, setLabel] = useState('');
  const [outs, setOuts] = useState<Outcome[]>([]);
  const [running, setRunning] = useState(false);
  const [waitMsg, setWaitMsg] = useState('');
  const [causes, setCauses] = useState<Record<string, string>>({});
  const [show, setShow] = useState<'wrong' | 'all'>('wrong');
  const [history, setHistory] = useState<Past[]>(loadHistory);
  const stop = useRef(false);
  const urls = useRef(new Map<string, string>());

  const target = rows.filter((r) => split === 'all' || r.split === split);
  const matched = target.filter((r) => files.has(r.file.toLowerCase()));
  const missing = target.filter((r) => !files.has(r.file.toLowerCase()));
  const sc = useMemo(() => (outs.length ? score(outs) : null), [outs]);

  const onAnswers = async (f?: File) => {
    if (!f) return;
    const p = parseAnswers(await f.text());
    setRows(p.rows);
    setProblems(p.problems);
    setOuts([]);
  };
  const onPhotos = (list: FileList | null) => {
    const m = new Map<string, File>();
    Array.from(list ?? []).forEach((f) => /\.(jpe?g|png|webp|heic)$/i.test(f.name) && m.set(f.name.toLowerCase(), f));
    setFiles(m);
  };
  const thumb = (r: Row) => {
    const f = files.get(r.file.toLowerCase());
    if (!f) return '';
    if (!urls.current.has(r.file)) urls.current.set(r.file, URL.createObjectURL(f));
    return urls.current.get(r.file)!;
  };

  const run = async () => {
    stop.current = false;
    setRunning(true);
    setOuts([]);
    const done: Outcome[] = [];
    for (const r of matched) {
      if (stop.current) break;
      const o = await runOne(r, files.get(r.file.toLowerCase())!, (s) => setWaitMsg(`판독 한도 — ${s}초 기다렸다 다시 보냅니다`));
      setWaitMsg('');
      done.push(o);
      setOuts([...done]);
    }
    setRunning(false);
    const s = score(done);
    if (s.n > 0) {
      const past: Past = {
        at: new Date().toLocaleString('ko-KR'),
        label: label || '이름 없음',
        model: done.find((o) => o.model)?.model ?? '',
        split: { all: '전체', dev: '개선용', test: '시험용' }[split],
        n: s.n,
        type: s.type.rate,
        rec: s.recommended.rate,
        plate: s.plate.rate,
        plateWrong: s.plate.n ? s.plate.wrong / s.plate.n : 0,
      };
      const next = [past, ...history].slice(0, 30);
      setHistory(next);
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
      } catch {
        /* 저장 못 해도 결과는 화면에 있다 */
      }
    }
  };

  const listed = outs.filter((o) => show === 'all' || !o.ok || o.auto !== o.row.truth || (o.plateFilled && o.row.plate && o.plateFilled !== o.row.plate));

  return (
    <div className="min-h-screen bg-white text-slate-800 font-sans antialiased">
      <div className="bg-slate-50 border-b border-slate-200 text-[13px] text-slate-500">
        <div className="max-w-6xl mx-auto px-4 py-1.5 flex justify-between gap-3 flex-wrap">
          <span>국민제안 준비용 내부 도구 · 본인·팀원 차량 사진만 넣어 주세요</span>
          <span>사진은 저장하지 않습니다</span>
        </div>
      </div>
      <header className="bg-blue-50 border-b border-blue-100">
        <div className="max-w-6xl mx-auto px-4 py-6">
          <p className="text-sm font-bold text-blue-700">안전신문고 불법주정차 개선안 · 시제품</p>
          <h1 className="text-3xl font-bold text-slate-900 mt-1">판독 채점</h1>
          <p className="mt-1 text-slate-600">사진 1장씩, 앱과 같은 규칙(AI 장면 판독 → 규칙 유형 → 번호판 기준)으로 돌려 정답표와 맞대 봅니다.</p>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-8">
        {/* 준비 */}
        <section className="grid md:grid-cols-3 gap-3">
          <Card n="1" title="정답표(CSV)">
            <label className="flex items-center gap-2 h-11 px-3 rounded border border-slate-300 hover:border-blue-600 cursor-pointer font-bold text-sm">
              <FileSpreadsheet className="w-4 h-4 text-slate-500" aria-hidden="true" /> 정답표 고르기
              <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => void onAnswers(e.target.files?.[0])} />
            </label>
            <button onClick={() => download('answers-template.csv', template())} className="mt-2 text-sm font-bold text-blue-700 underline underline-offset-2">
              빈 양식 내려받기
            </button>
            <p className="mt-2 text-sm text-slate-600">{rows.length ? `${rows.length}건 읽음` : '아직 없음'}</p>
            {problems.length > 0 && (
              <ul className="mt-1 text-xs text-red-700 space-y-0.5">
                {problems.slice(0, 6).map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
          </Card>
          <Card n="2" title="사진 폴더">
            <label className="flex items-center gap-2 h-11 px-3 rounded border border-slate-300 hover:border-blue-600 cursor-pointer font-bold text-sm">
              <FolderOpen className="w-4 h-4 text-slate-500" aria-hidden="true" /> 폴더 고르기
              <input
                type="file"
                multiple
                className="hidden"
                // 폴더째 고르기(크롬·엣지)
                {...({ webkitdirectory: '' } as Record<string, string>)}
                onChange={(e) => onPhotos(e.target.files)}
              />
            </label>
            <p className="mt-2 text-sm text-slate-600">
              사진 {files.size}장 · 정답표와 맞는 사진 {matched.length}/{target.length}건
            </p>
            {missing.length > 0 && files.size > 0 && (
              <p className="mt-1 text-xs text-amber-800">사진 없음: {missing.slice(0, 8).map((r) => r.file).join(', ')}{missing.length > 8 ? ' …' : ''}</p>
            )}
          </Card>
          <Card n="3" title="돌리기">
            <div className="flex gap-1.5" role="radiogroup" aria-label="범위">
              {(['dev', 'test', 'all'] as const).map((s) => (
                <button
                  key={s}
                  role="radio"
                  aria-checked={split === s}
                  onClick={() => setSplit(s)}
                  className={`px-3 h-9 rounded border text-sm font-bold ${split === s ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-300'}`}
                >
                  {{ dev: '개선용', test: '시험용', all: '전체' }[s]}
                </button>
              ))}
            </div>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="이번 실행 이름 (예: 프롬프트 v2)"
              className="mt-2 w-full h-9 px-3 rounded border border-slate-300 text-sm"
            />
            {running ? (
              <button onClick={() => (stop.current = true)} className="mt-2 w-full h-11 rounded bg-slate-200 font-bold flex items-center justify-center gap-2">
                <Square className="w-4 h-4" aria-hidden="true" /> 멈추기
              </button>
            ) : (
              <button
                onClick={() => void run()}
                disabled={!matched.length}
                className="mt-2 w-full h-11 rounded bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 text-white font-bold flex items-center justify-center gap-2"
              >
                <Play className="w-4 h-4" aria-hidden="true" /> 채점 시작 ({matched.length}건)
              </button>
            )}
            {split === 'test' && <p className="mt-1.5 text-xs text-amber-800">시험용은 발표 직전에 한 번만 돌리세요. 여러 번 보면 시험용도 '맞춘' 자료가 됩니다.</p>}
          </Card>
        </section>

        {(running || outs.length > 0) && (
          <div>
            <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
              <div className="h-full bg-blue-600 transition-all" style={{ width: `${(outs.length / Math.max(1, matched.length)) * 100}%` }} />
            </div>
            <p className="mt-1 text-sm text-slate-600 tabular-nums">
              {outs.length} / {matched.length}건 {running && '판독 중…'} {waitMsg}
            </p>
          </div>
        )}

        {sc && (
          <>
            <section>
              <h2 className="text-lg font-bold">유형 <span className="text-sm text-slate-500 font-normal">채점 {sc.n}건 · 판독 실패 {sc.failed} · 애매 제외 {sc.ambiguous}</span></h2>
              <div className="mt-2 grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <Stat label="유형 정답률(앱이 채우는 유형)" r={sc.type} main />
                <Stat label="추천 기준 정답률" r={sc.recommended} />
                <Stat label="정답이 후보 안에 있음" r={sc.contained} />
                <div className="rounded-lg border border-slate-200 p-4">
                  <p className="text-xs font-bold text-slate-500">위반 아님을 위반으로 잡음</p>
                  <p className="text-2xl font-bold tabular-nums mt-1">
                    {sc.falseAlarm.count}<span className="text-base text-slate-500"> / {sc.falseAlarm.n}건</span>
                  </p>
                </div>
              </div>
            </section>

            <section>
              <h2 className="text-lg font-bold">번호판 <span className="text-sm text-slate-500 font-normal">한 장 기준 · 읽힘·확신 0.8·형식이 맞을 때만 채움</span></h2>
              <div className="mt-2 grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <Stat label="번호판 정확률" r={sc.plate} main />
                <div className="rounded-lg border border-slate-200 p-4">
                  <p className="text-xs font-bold text-slate-500">틀린 번호를 채움(가장 중요)</p>
                  <p className={`text-2xl font-bold tabular-nums mt-1 ${sc.plate.wrong ? 'text-red-700' : 'text-green-700'}`}>
                    {sc.plate.wrong}<span className="text-base text-slate-500"> / {sc.plate.n}건</span>
                  </p>
                  <p className="text-xs text-slate-500">목표 0건(1% 이하)</p>
                </div>
              </div>
            </section>

            <section>
              <h2 className="text-lg font-bold">어디서 틀리나 <span className="text-sm text-slate-500 font-normal">줄 = 정답, 칸 = 앱이 채운 유형</span></h2>
              <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50">
                      <th className="text-left px-3 py-2">정답 \ 앱</th>
                      {TYPE_ORDER.map((t) => (
                        <th key={t} className="px-2 py-2 whitespace-nowrap">{NAME[t]}</th>
                      ))}
                      <th className="px-2 py-2">정답률</th>
                    </tr>
                  </thead>
                  <tbody>
                    {TYPE_ORDER.filter((t) => sc.confusion[t]).map((t) => {
                      const row = sc.confusion[t];
                      const n = Object.values(row).reduce((a, b) => a + b, 0);
                      return (
                        <tr key={t} className="border-t border-slate-100">
                          <th className="text-left px-3 py-2 whitespace-nowrap">{NAME[t]}</th>
                          {TYPE_ORDER.map((p) => (
                            <td
                              key={p}
                              className={`text-center px-2 py-2 tabular-nums ${row[p] ? (p === t ? 'bg-green-50 text-green-800 font-bold' : 'bg-red-50 text-red-800') : 'text-slate-300'}`}
                            >
                              {row[p] ?? 0}
                            </td>
                          ))}
                          <td className="text-center px-2 py-2 tabular-nums font-bold">{pct((row[t] ?? 0) / n)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {Object.keys(sc.byTime).length > 1 && (
                <p className="mt-2 text-sm text-slate-600">
                  시간대별 유형 정답률:{' '}
                  {Object.entries(sc.byTime)
                    .map(([k, r]) => `${k} ${pct(r.rate)}(${r.n}건)`)
                    .join(' · ')}
                </p>
              )}
            </section>

            <section>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <h2 className="text-lg font-bold">사진별 결과</h2>
                <div className="flex items-center gap-2">
                  <button onClick={() => setShow(show === 'wrong' ? 'all' : 'wrong')} className="px-3 h-9 rounded border border-slate-300 hover:border-blue-600 text-sm font-bold">
                    {show === 'wrong' ? '전체 보기' : '틀린 것만'}
                  </button>
                  <button
                    onClick={() => download(`eval-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(outs, causes))}
                    className="px-3 h-9 rounded bg-slate-900 text-white text-sm font-bold flex items-center gap-1.5"
                  >
                    <Download className="w-4 h-4" aria-hidden="true" /> 결과 CSV
                  </button>
                </div>
              </div>
              <p className="mt-1 text-sm text-slate-500">틀린 사진마다 원인을 골라 두면 결과 CSV에 같이 담깁니다. 원인별로 고칠 곳이 다릅니다.</p>
              <ul className="mt-3 space-y-2">
                {listed.map((o) => {
                  const right = o.ok && o.auto === o.row.truth;
                  const yesItems = o.scene ? (Object.keys(SCENE_NAME) as (keyof Scene)[]).filter((k) => o.scene![k] === 'yes') : [];
                  return (
                    <li key={o.row.id + o.row.file} className="flex gap-3 rounded-lg border border-slate-200 p-3">
                      <img src={thumb(o.row)} alt="" className="w-28 h-20 rounded object-cover bg-slate-100 shrink-0" />
                      <div className="min-w-0 flex-1 text-sm space-y-0.5">
                        <p className="font-bold">
                          <span className="text-slate-500">#{o.row.id}</span> {o.row.file}{' '}
                          <span className={`ml-1 px-2 py-0.5 rounded border text-xs ${!o.ok ? 'bg-slate-50 border-slate-300' : right ? 'bg-green-50 border-green-200 text-green-700' : o.auto === 'none' ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-red-50 border-red-200 text-red-700'}`}>
                            {!o.ok ? `판독 실패(${o.error})` : right ? '정답' : o.auto === 'none' ? '보류' : '오답'}
                          </span>
                        </p>
                        <p>
                          정답 <b>{NAME[o.row.truth]}</b> · 앱 <b>{NAME[o.auto]}</b>
                          {o.recommended !== o.auto && <> · 추천 {NAME[o.recommended]}</>}
                          {o.candidates.length > 1 && <> · 후보 {o.candidates.map((t) => NAME[t]).join('/')}</>}
                        </p>
                        <p className="text-slate-600">AI가 '보임'이라 한 것: {yesItems.length ? yesItems.map((k) => SCENE_NAME[k]).join(', ') : '없음'}</p>
                        {o.evidence && <p className="text-slate-500 truncate">근거: {o.evidence}</p>}
                        <p className="text-slate-600 tabular-nums">
                          번호판 정답 {o.row.plate || '—'} · 앱 {o.plateFilled || '비움'}
                          {o.plateRead && o.plateRead !== o.plateFilled && ` (읽은 값 ${o.plateRead}, 확신 ${o.plateConfidence.toFixed(2)})`}
                        </p>
                      </div>
                      {!right && o.ok && (
                        <select
                          value={causes[o.row.id] ?? ''}
                          onChange={(e) => setCauses({ ...causes, [o.row.id]: e.target.value })}
                          className="self-start h-9 px-2 rounded border border-slate-300 text-sm"
                          aria-label="틀린 원인"
                        >
                          <option value="">원인 고르기</option>
                          {CAUSES.map((c) => (
                            <option key={c}>{c}</option>
                          ))}
                        </select>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          </>
        )}

        {history.length > 0 && (
          <section>
            <h2 className="text-lg font-bold">지난 실행 <span className="text-sm text-slate-500 font-normal">이 브라우저에만 남습니다 · 개선 전후 비교용</span></h2>
            <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-left">
                    {['시각', '이름', '범위', '모델', '건수', '유형', '추천', '번호판', '번호판 오채움'].map((h) => (
                      <th key={h} className="px-3 py-2 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {history.map((h, i) => (
                    <tr key={i} className="border-t border-slate-100 tabular-nums">
                      <td className="px-3 py-2 whitespace-nowrap">{h.at}</td>
                      <td className="px-3 py-2">{h.label}</td>
                      <td className="px-3 py-2">{h.split}</td>
                      <td className="px-3 py-2">{h.model}</td>
                      <td className="px-3 py-2">{h.n}</td>
                      <td className={`px-3 py-2 font-bold ${h.type >= TARGET ? 'text-green-700' : ''}`}>{pct(h.type)}</td>
                      <td className="px-3 py-2">{pct(h.rec)}</td>
                      <td className="px-3 py-2">{pct(h.plate)}</td>
                      <td className="px-3 py-2">{pct(h.plateWrong)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>
      <footer className="bg-slate-900 text-slate-300 text-sm mt-10">
        <div className="max-w-6xl mx-auto px-4 py-5">판독 채점 — 목표 유형 정답률 {pct(TARGET)} · 번호판 오채움 0건</div>
      </footer>
    </div>
  );
}

function Card({ n, title, children }: { n: string; title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <p className="font-bold mb-2">
        <span className="inline-flex w-6 h-6 rounded-full bg-blue-600 text-white text-xs items-center justify-center mr-1.5">{n}</span>
        {title}
      </p>
      {children}
    </div>
  );
}

function Stat({ label, r, main }: { label: string; r: Rate; main?: boolean }) {
  const hit = r.rate >= TARGET;
  return (
    <div className={`rounded-lg border p-4 ${main ? (hit ? 'border-green-300 bg-green-50/40' : 'border-amber-300 bg-amber-50/40') : 'border-slate-200'}`}>
      <p className="text-xs font-bold text-slate-500">{label}</p>
      <p className="text-2xl font-bold tabular-nums mt-1">{pct(r.rate)}</p>
      <p className="text-xs text-slate-500 tabular-nums">
        {r.correct}/{r.n}건 · 실제 범위 {pct(r.ci[0])}~{pct(r.ci[1])}
      </p>
      <p className="text-xs text-slate-500 tabular-nums">
        오답 {r.wrong} · 보류 {r.abstain}
      </p>
    </div>
  );
}
