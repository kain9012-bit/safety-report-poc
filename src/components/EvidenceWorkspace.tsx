import { useEffect, useRef, useState } from 'react';
import type { DraftReport, PhotoRole, Shot } from '../types/report';
import { appendPhoto, assignRole, choosePrimary, evidenceKey, photoId, primaryShots, reviewedReads } from '../lib/photoEvidence';
import { EVIDENCE_LABEL, reviewSharedParking, summarizeEvidence, supplementalNeeds } from '../lib/evidence';
import { captureEvidenceFrame, startCamera, stopCamera, formatStamp } from '../lib/camera';
import type { VisionState } from '../lib/vision';
import { StopReview } from './StopReview';
import { createLocationTracker, GPS_POLICY, LOCATION_LABEL } from '../lib/locationQuality';
import type { LocationIssue } from '../lib/locationQuality';
import { snapshotHeading, startHeadingTracking } from '../lib/heading';
import type { HeadingSample } from '../lib/heading';
import type { EvidenceType, EvidenceBox } from '../types/evidence';

const roleNames: Record<PhotoRole, string> = { vehicle: '차량·번호판', marking: '표시·글씨', connection: '차량과 장소 연결', context: '주변 전경' };
const statusNames = { observed: '사진 근거 연결 확인', needs_context: '일부 근거 미확인', conflict: '사진 근거가 서로 다름', not_observed: '이 사진에서 확인 안 됨', legacy: '이전 판독 · 세부 근거 재확인 필요' };
const questions: Record<EvidenceType, string> = {
  hydrant: '소화전과 대상 차량이 같은 위치에서 함께 보이나요?',
  corner: '대상 차량과 해당 도로 모퉁이의 연결이 보이나요?',
  busstop: '사진 속 정류소와 지도에서 고른 정류소가 같은 곳인가요?',
  crossing: '차량과 횡단보도 구역의 위치 관계가 보이나요?',
  schoolzone: '어린이보호구역 표시가 이 차량이 있는 도로에 적용되나요?',
  sidewalk: '차량 바퀴·차체와 보도의 경계가 함께 보이나요?',
  disabled: '장애인 구역 표시가 이 차량이 있는 칸에 적용되나요?',
  firelane: '소방차전용 표시와 대상 구역·차량이 함께 보이나요?',
  evcharging: '충전·전용 표시가 이 차량이 있는 칸에 적용되나요?',
};
const button = 'rounded border border-slate-300 bg-white px-3 py-2 text-sm';

export function EvidenceWorkspace({ draft, readStates, onChange, onRetry, onPendingChange }: {
  draft: DraftReport; readStates: (VisionState | undefined)[];
  onChange: (fn: (d: DraftReport) => DraftReport) => void; onRetry: (index: number) => void; onPendingChange?: (pending: boolean) => void;
}) {
  const reads = reviewedReads(draft);
  const summaries = summarizeEvidence(reads);
  const needs = supplementalNeeds(reads, draft.type).slice(0, 3);
  const key = evidenceKey(draft);
  const shared = reviewSharedParking(summaries.flatMap((s) => s.observations));
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [camera, setCamera] = useState(false);
  const [regionPhoto, setRegionPhoto] = useState<number>();
  const fileRef = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; onPendingChange?.(false); }, [onPendingChange]);
  const add = (photo: Shot) => { onChange((d) => appendPhoto(d, photo, true)); setCamera(false); };
  const fromFile = async (file?: File) => {
    if (!file) return;
    const run = ++generation.current;
    setAdding(true); onPendingChange?.(true); setError('');
    try {
      const { readAlbumFile } = await import('../lib/album');
      const shot = await readAlbumFile(file);
      if (generation.current === run) add(shot);
    } catch { if (generation.current === run) setError('사진을 읽지 못했어요. 기존 사진은 그대로 있어요.'); }
    finally { if (generation.current === run) { setAdding(false); onPendingChange?.(false); } }
  };
  const selected = summaries.find((s) => s.type === draft.type);
  const question = draft.type && draft.type !== 'other' && (!selected || selected.status !== 'observed') ? questions[draft.type] : undefined;
  const answer = draft.type ? draft.confirmations?.[draft.type] : undefined;
  const answerCurrent = answer?.inputKey === key;
  return <section className="mt-5 space-y-3 border-t border-slate-200 pt-4" aria-label="사진 근거와 보완">
    {selected?.status === 'conflict' ? <p role="status" className="text-sm text-amber-900">사진마다 확인된 내용이 달라요. 유형을 한 번 더 확인해 주세요.</p>
      : needs[0] ? <p className="text-sm text-amber-900">{needs[0].message}</p> : null}
    {shared.notices.length > 0 && <p className="text-sm text-amber-900">주차 안내가 보입니다. 이 차량에도 적용되는지는 추가 확인에서 살펴볼 수 있어요.</p>}
    <div className="flex flex-wrap gap-2">
      <button className={button} aria-expanded={addOpen} onClick={() => setAddOpen(!addOpen)}>사진 추가{draft.shots.length > 2 ? ` · ${draft.shots.length - 2}장 추가됨` : ''}</button>
      <button className={button} aria-expanded={detailsOpen} aria-controls="evidence-details" onClick={() => setDetailsOpen(!detailsOpen)}>{detailsOpen ? '추가 확인 닫기' : '추가 확인 · 선택'}</button>
    </div>
    {addOpen && <div className="flex gap-2"><button className={button} onClick={() => setCamera(true)} disabled={adding}>보완사진 찍기</button><button className={button} disabled={adding} onClick={() => fileRef.current?.click()}>사진에서 추가</button></div>}
    <p className="text-xs text-slate-500">추가 확인 없이 다음 단계로 진행할 수 있어요.</p>
    <div id="evidence-details" hidden={!detailsOpen} className="space-y-3 rounded border border-slate-200 p-3">
    <p className="text-sm text-slate-600">필요한 항목만 확인하세요. 미확인 항목은 그대로 보관되며, 실제 신고 요건과 주차 허용 여부는 별도 확인이 필요해요.</p>
    {summaries.filter((s) => s.status !== 'not_observed' || s.type === draft.type).map((s) => <details key={s.type} className="rounded border p-3" open={s.type === draft.type}>
      <summary className="font-bold text-sm">{EVIDENCE_LABEL[s.type]} · {statusNames[s.status]}</summary>
      {s.photoIds.length > 0 && <p className="mt-2 text-xs text-slate-500">근거 사진: {s.photoIds.map((id) => draft.shots.findIndex((p, i) => photoId(p, i) === id) + 1).filter((n) => n > 0).join(', ')}</p>}
      {s.observations.map((o, i) => <p key={i} className="text-sm mt-1">{o.identityDetail}{o.markingText ? ` · 읽은 표시: ${o.markingText}` : ''} · 차량 관계: {o.relation === 'inside' ? '구역 안' : o.relation === 'boundary' ? '경계' : o.relation === 'adjacent' ? '인접' : o.relation === 'access' ? '진입 관련' : '미확인'}</p>)}
      <ul className="text-xs text-amber-900 list-disc pl-4 mt-2">{s.missing.map((m) => <li key={m}>{m}</li>)}</ul>
      {s.status === 'observed' && s.type !== draft.type && <button className={`${button} mt-2`} onClick={() => onChange((d) => ({ ...d, type: s.type, manual: { ...d.manual, type: true } }))}>이 유형 선택</button>}
    </details>)}
    {(draft.type === 'busstop' || summaries.some((s) => s.type === 'busstop' && s.status !== 'not_observed')) && <StopReview draft={draft} onChange={onChange} />}
    {question && <div className="rounded bg-blue-50 p-3 text-sm space-y-2">
      <p>{question}</p>
      {answer && <p className="text-xs">이전 답: {answer.value}{answerCurrent ? ' · 기록됨' : ' · 사진이나 선택이 달라져 재확인 필요'}</p>}
      {!answerCurrent && <div className="flex flex-wrap gap-2">{['보여요', '보이지 않아요', '모르겠어요 · 건너뛰기'].map((value) => <button key={value} className={button} onClick={() => onChange((d) => ({ ...d, confirmations: { ...d.confirmations, [d.type!]: { value, inputKey: evidenceKey(d), answeredAt: Date.now() } } }))}>{value}</button>)}</div>}
      {answerCurrent && <button className="underline text-xs" onClick={() => onChange((d) => ({ ...d, confirmations: { ...d.confirmations, [d.type!]: { ...answer, inputKey: '' } } }))}>답 수정</button>}
      <p className="text-xs text-slate-500">답은 사용자 확인으로 보관하며 AI 관찰이나 법적 판단으로 바꾸지 않아요.</p>
    </div>}
    {(draft.type === 'evcharging' || summaries.some((s) => s.type === 'evcharging' && s.status !== 'not_observed')) && <SharedParking draft={draft} onChange={onChange} inputKey={key} readMessage={shared.message} notices={shared.notices.map((n) => n.text).filter(Boolean)} />}
    <h3 className="font-bold">기본 사진과 보완사진</h3>
    <p className="text-xs text-slate-600">기본 1·2만 시간·번호판·겹침을 비교합니다. 기본 사진을 바꾸면 다시 점검해요. 보완사진은 원본을 유지한 채 추가합니다.</p>
    <div className="space-y-3">{draft.shots.map((shot, i) => {
      const id = photoId(shot, i), pair = primaryShots(draft), slot = pair.indexOf(shot);
      return <div key={id} className="border rounded p-2 space-y-2">
        <div className="flex gap-3"><a href={shot.originalDataUrl ?? shot.dataUrl} target="_blank" rel="noreferrer" aria-label={`사진 ${i + 1} 원본 보기`}><img src={shot.dataUrl} alt={`사진 ${i + 1}`} className="w-20 h-20 object-contain bg-slate-100" /></a><div className="text-xs space-y-1"><p className="font-bold text-sm">사진 {i + 1} · {slot >= 0 ? `기본 ${slot + 1}` : '보완'}</p><p>{shot.source === 'album' && shot.meta?.takenAt === undefined ? '촬영 시각 미확인' : formatStamp(shot.takenAt)}</p><p>{readStates[i] === 'loading' ? '원본 분석 중…' : draft.reads?.[i] ? '판독 기록 있음' : '판독 미완료'}</p><button className="underline" disabled={readStates[i] === 'loading'} onClick={() => onRetry(i)}>원본 다시 분석</button><button className="block underline" onClick={() => setRegionPhoto(i)}>부분을 지정해서 분석</button></div></div>
        <div className="flex flex-wrap gap-2">{(Object.keys(roleNames) as PhotoRole[]).map((role) => <label key={role} className="text-xs"><input type="checkbox" checked={shot.roles?.includes(role) ?? false} onChange={(e) => onChange((d) => assignRole(d, id, e.target.checked ? [...(shot.roles ?? []), role] : (shot.roles ?? []).filter((r) => r !== role)))} /> {roleNames[role]}</label>)}</div>
        <div className="flex gap-2">{([0, 1] as const).map((n) => <button key={n} disabled={slot === n || pair[1 - n] === shot} className="text-xs underline disabled:text-slate-400" onClick={() => onChange((d) => choosePrimary(d, id, n))}>기본 {n + 1}로 지정</button>)}</div>
      </div>;
    })}</div>
    </div>
    <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { void fromFile(e.target.files?.[0]); e.target.value = ''; }} />
    {adding && <div role="status">사진을 읽는 중… <button className="underline" onClick={() => { generation.current++; setAdding(false); onPendingChange?.(false); }}>추가 취소</button></div>}
    {error && <p role="alert" className="text-red-700 text-sm">{error}</p>}
    {regionPhoto !== undefined && draft.shots[regionPhoto] && <RegionPicker photo={draft.shots[regionPhoto]} initialType={draft.type === 'other' ? 'hydrant' : draft.type ?? 'hydrant'} onCancel={() => setRegionPhoto(undefined)} onApply={(type, box) => {
      const index = regionPhoto;
      onChange((d) => {
        const reads = [...(d.reads ?? [])]; reads[index] = undefined as never;
        return { ...d, shots: d.shots.map((s, i) => i === index ? { ...s, analysisRegion: { type, box } } : s), reads, evidenceRevision: (d.evidenceRevision ?? 0) + 1 };
      });
      setRegionPhoto(undefined);
    }} />}
    {camera && <SupplementalCamera onCapture={add} onCancel={() => setCamera(false)} />}
  </section>;
}

function SharedParking({ draft, onChange, inputKey, readMessage, notices }: { draft: DraftReport; onChange: (fn: (d: DraftReport) => DraftReport) => void; inputKey: string; readMessage: string; notices: string[] }) {
  const saved = draft.sharedParking;
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<NonNullable<DraftReport['sharedParking']>>(() => saved ?? { answer: 'unknown', notice: '', targetBay: '', scope: 'unknown', permission: 'unknown', timeCondition: '', timeMatch: 'unknown', conditions: '', inputKey: '', answeredAt: 0 });
  const current = saved?.inputKey === inputKey;
  const update = (patch: Partial<typeof value>) => setValue((v) => ({ ...v, ...patch }));
  return <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm space-y-2">
    <p className="font-bold">일반 자동차 병행주차 안내 확인</p><p>{readMessage}</p>
    {notices.map((n, i) => <blockquote key={i} className="border-l-2 pl-2 whitespace-pre-wrap">읽은 안내: {n}</blockquote>)}
    {saved && <p>사용자 기록: {saved.answer === 'yes' ? '안내 있음' : saved.answer === 'not_seen' ? '찾아봤지만 보이지 않음' : '확인 어려움'}{current ? '' : ' · 사진·유형 변경으로 재확인 필요'}</p>}
    {!editing && <button className={button} onClick={() => { setValue(saved ?? value); setEditing(true); }}>{saved ? '기록 확인·수정' : '안내 확인 또는 건너뛰기'}</button>}
    {editing && <div className="space-y-2">
      <label className="block">이 차량이 있는 칸에 일반 자동차도 주차할 수 있다는 안내가 있나요?<select className="block w-full border rounded p-2" value={value.answer} onChange={(e) => update({ answer: e.target.value as typeof value.answer })}><option value="unknown">확인하기 어려워요</option><option value="yes">있어요</option><option value="not_seen">찾아봤지만 보이지 않아요</option></select></label>
      {value.answer === 'yes' && <>
        <label className="block">안내 원문<textarea className="block border rounded w-full p-2" value={value.notice} onChange={(e) => update({ notice: e.target.value })} /></label>
        <label className="block">차량이 있는 층·칸<input className="block border rounded w-full p-2" value={value.targetBay} onChange={(e) => update({ targetBay: e.target.value })} /></label>
        <label className="block">안내 적용<select className="block border rounded w-full p-2" value={value.scope} onChange={(e) => update({ scope: e.target.value as typeof value.scope })}><option value="unknown">이 칸에 적용되는지 모름</option><option value="same_bay">이 칸에 적용된다고 확인함</option><option value="different_bay">다른 칸에 관한 안내</option></select></label>
        <label className="block">허용 대상<select className="block border rounded w-full p-2" value={value.permission} onChange={(e) => update({ permission: e.target.value as typeof value.permission })}><option value="unknown">모름</option><option value="general">일반 자동차 주차 안내</option><option value="ev_extra_time">전기차 시간 초과 안내만 있음</option></select></label>
        <label className="block">안내 시간·요일·적용 기간<input className="block border rounded w-full p-2" value={value.timeCondition} onChange={(e) => update({ timeCondition: e.target.value, timeMatch: 'unknown' })} /></label>
        <p className="text-xs">기본 사진 촬영 당시: {primaryShots(draft).map((s) => s.source === 'album' && s.meta?.takenAt === undefined ? '시각 미확인' : formatStamp(s.takenAt)).join(' / ')}. 두 사진의 시간이 경계를 넘으면 각각 확인해 주세요.</p>
        <label className="block">촬영 당시 시간 조건<select className="block border rounded w-full p-2" value={value.timeMatch} onChange={(e) => update({ timeMatch: e.target.value as typeof value.timeMatch })}><option value="unknown">미확인 · 경계 시각/공휴일 포함</option><option value="matches">두 사진 모두 해당한다고 확인함</option><option value="outside">적어도 한 사진은 해당하지 않음</option></select></label>
        <label className="block">게시 주체·이용 자격·그 밖의 조건<textarea className="block border rounded w-full p-2" value={value.conditions} onChange={(e) => update({ conditions: e.target.value })} /></label>
      </>}
      <div className="flex gap-2"><button className={button} onClick={() => { onChange((d) => ({ ...d, sharedParking: { ...value, inputKey: evidenceKey(d), answeredAt: Date.now() } })); setEditing(false); }}>미확인 내용도 함께 기록</button><button className={button} onClick={() => setEditing(false)}>취소</button></div>
    </div>}
    <p className="text-xs">공용·무료·고장·전기차 시간 초과 안내만으로 일반차 주차 허용을 확정하지 않아요. 안내 관찰과 법적 허용 판단은 별개예요.</p>
  </div>;
}

function SupplementalCamera({ onCapture, onCancel }: { onCapture: (s: Shot) => void; onCancel: () => void }) {
  const video = useRef<HTMLVideoElement>(null), stream = useRef<MediaStream | null>(null);
  const tracker = useRef(createLocationTracker());
  const heading = useRef<HeadingSample[]>([]), headingStop = useRef<(() => void) | undefined>(undefined);
  const alive = useRef(true), headingRun = useRef(0);
  const [issue, setIssue] = useState<LocationIssue>();
  const [headingIssue, setHeadingIssue] = useState<'denied' | 'unsupported'>();
  const [headingStarted, setHeadingStarted] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState('');
  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    void startCamera().then((s) => { if (cancelled) return stopCamera(s); stream.current = s; if (video.current) video.current.srcObject = s; }).catch(() => { if (!cancelled) setError('카메라를 열지 못했어요. 취소하거나 사진에서 추가해 주세요.'); });
    const watch = navigator.geolocation?.watchPosition((g) => { if (!cancelled) { tracker.current.ingest(g); setIssue(undefined); } }, (e) => { if (!cancelled) setIssue(e.code === 1 ? 'denied' : e.code === 3 ? 'timeout' : 'unavailable'); }, { enableHighAccuracy: true, maximumAge: 0, timeout: GPS_POLICY.requestTimeoutMs });
    if (!navigator.geolocation) setIssue('unavailable');
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => { cancelled = true; alive.current = false; headingRun.current++; headingStop.current?.(); stopCamera(stream.current); if (watch !== undefined) navigator.geolocation.clearWatch(watch); clearInterval(timer); };
  }, []);
  const enableHeading = async () => {
    const run = ++headingRun.current;
    headingStop.current?.(); heading.current = [];
    const facing = stream.current?.getVideoTracks()[0]?.getSettings().facingMode;
    const tracked = await startHeadingTracking({ facingMode: facing === 'environment' || facing === 'user' ? facing : 'unknown', onSample: (sample) => { if (alive.current && run === headingRun.current) heading.current = [...heading.current.slice(-19), sample]; } });
    if (!alive.current || run !== headingRun.current) { tracked.stop(); return; }
    headingStop.current = tracked.stop; setHeadingIssue(tracked.issue); setHeadingStarted(true);
  };
  const capture = () => {
    if (!video.current || video.current.readyState < 2) return;
    try {
      const takenAt = Date.now(), location = tracker.current.snapshot(takenAt, issue);
      const at = ['stale', 'unavailable'].includes(location.quality.status) ? undefined : location.sample;
      onCapture({ takenAt, ...captureEvidenceFrame(video.current, { takenAt, lat: at?.lat, lng: at?.lng, accuracy: at?.accuracy }), source: 'camera', location, heading: snapshotHeading(heading.current, takenAt, headingIssue), lat: at?.lat, lng: at?.lng, accuracy: at?.accuracy, locIssue: at ? undefined : issue === 'denied' ? 'denied' : 'unavailable', roles: ['connection', 'context'] });
    } catch { setError('사진을 담지 못했어요. 기존 자료는 유지돼요.'); }
  };
  return <div role="dialog" aria-label="보완사진 촬영" className="fixed inset-0 z-50 bg-slate-900 flex flex-col p-4 gap-3 text-white">
    <p>차량과 확인할 표시가 함께 보이도록 찍어 주세요.</p>
    <p className="text-xs">{LOCATION_LABEL[tracker.current.snapshot(now, issue).quality.status]} · 위치가 없어도 촬영할 수 있어요.</p>
    <button className="text-sm underline" onClick={() => void enableHeading()}>{headingStarted ? (snapshotHeading(heading.current, now, headingIssue).status === 'usable' ? '촬영 방향 기록 중' : '촬영 방향 미확인 · 다시 확인') : '촬영 방향 함께 확인'}</button>
    <video ref={video} muted playsInline autoPlay className="flex-1 min-h-0 object-contain" />
    {error && <p role="alert">{error}</p>}
    <button className="bg-blue-600 rounded py-3" onClick={capture}>보완사진 추가</button><button className="border rounded py-3" onClick={onCancel}>취소 · 기존 사진 유지</button>
  </div>;
}

function RegionPicker({ photo, initialType, onApply, onCancel }: { photo: Shot; initialType: EvidenceType; onApply: (type: EvidenceType, box: EvidenceBox) => void; onCancel: () => void }) {
  const [type, setType] = useState(initialType);
  const [box, setBox] = useState<EvidenceBox>();
  return <div role="dialog" aria-label="원본 부분 지정" className="fixed inset-0 z-50 bg-slate-900/95 text-white overflow-y-auto p-4 flex flex-col gap-3">
    <h3 className="text-lg font-bold">확인할 물체나 글씨를 눌러 주세요</h3>
    <p className="text-sm">누른 곳 주변을 원본에서 잘라 전체 장면과 함께 분석합니다. 지정만으로 식별 성공이 되지 않아요.</p>
    <label>확인할 유형<select className="ml-2 bg-slate-800 border rounded p-2" value={type} onChange={(e) => setType(e.target.value as EvidenceType)}>{(Object.keys(EVIDENCE_LABEL) as EvidenceType[]).map((t) => <option key={t} value={t}>{EVIDENCE_LABEL[t]}</option>)}</select></label>
    <div className="relative w-full max-w-3xl mx-auto"><img src={photo.originalDataUrl ?? photo.dataUrl} alt="확인할 부분을 선택할 원본" className="w-full h-auto cursor-crosshair" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); const x = Math.max(0, Math.min(600, (e.clientX - r.left) / r.width * 1000 - 200)); const y = Math.max(0, Math.min(600, (e.clientY - r.top) / r.height * 1000 - 200)); setBox([y, x, y + 400, x + 400]); }} />{box && <div className="absolute border-4 border-yellow-400 bg-yellow-400/10 pointer-events-none" style={{ left: `${box[1] / 10}%`, top: `${box[0] / 10}%`, width: '40%', height: '40%' }} />}</div>
    <button className="bg-blue-600 disabled:bg-slate-600 rounded py-3" disabled={!box} onClick={() => box && onApply(type, box)}>선택한 부분 다시 분석</button><button className="border rounded py-3" onClick={onCancel}>취소 · 원본 유지</button>
  </div>;
}
