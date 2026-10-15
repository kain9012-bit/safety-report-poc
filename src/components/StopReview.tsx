import { lazy, Suspense, useEffect, useState } from 'react';
import type { DraftReport } from '../types/report';
import { loadNearby } from '../lib/facilities';
import type { NearbyResult } from '../lib/facilities';
import { rankStopCandidates, stopKey, stopSelectionInputKey } from '../lib/stopCandidates';
import type { StopPhotoEvidence } from '../lib/stopCandidates';
import { LOCATION_LABEL } from '../lib/locationQuality';
import { activeLocatedShot, photoId, primaryShots, reviewedReads } from '../lib/photoEvidence';
// 정류소 후보·차량 위치를 표시하는 작업 브랜치 지도. main 화면의 PickMap 과 따로 둔다(아직 화면에 연결하지 않음)
const PickMap = lazy(() => import('./EvidencePickMap'));

export function StopReview({ draft, onChange }: { draft: DraftReport; onChange: (fn: (d: DraftReport) => DraftReport) => void }) {
  const primary = primaryShots(draft);
  const reviewed = reviewedReads(draft);
  const observations = reviewed.flatMap((read, index) => (read?.observations ?? []).filter((o) => o.type === 'busstop' && o.busStop?.readable).map((o) => ({ read, o, shot: draft.shots[index], index })));
  // Retained/replaced photographs never silently become the active source. A supplemental ID must be target-linked.
  const eligible = observations.filter(({ read, shot }) => primary.includes(shot) || (read?.targetLink?.referencePhotoId === primary[0]?.id && read?.targetLink?.sameVehicle === 'yes' && read?.targetLink?.samePlace === 'yes'));
  const observation = eligible.find(({ shot }) => primary.includes(shot)) ?? eligible[0];
  const evidence: StopPhotoEvidence | undefined = observation ? { photoId: photoId(observation.shot, observation.index), ...observation.o.busStop! } : undefined;
  const evidencePhoto = observation?.shot;
  const photo = evidencePhoto?.lat !== undefined && evidencePhoto.lng !== undefined ? evidencePhoto : activeLocatedShot(draft);
  const origin = draft.vehicleLocation ?? (photo ? { lat: photo.lat!, lng: photo.lng! } : undefined);
  const exactPhotoContext = Boolean(evidencePhoto && photo === evidencePhoto && !draft.vehicleLocation);
  const conflictingNumbers = new Set(eligible.map(({ o }) => o.busStop?.publicId?.trim()).filter(Boolean)).size > 1;
  const [nearby, setNearby] = useState<NearbyResult>();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [map, setMap] = useState(false);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => {
    setNearby(undefined); setFailed(false);
    if (!origin) { setBusy(false); return; }
    let stale = false; setBusy(true);
    void loadNearby(origin).then((n) => { if (!stale) { setNearby(n); setBusy(false); } }).catch(() => { if (!stale) { setBusy(false); setFailed(true); } });
    return () => { stale = true; };
  }, [origin?.lat, origin?.lng, retry]);
  const candidates = origin && nearby ? rankStopCandidates({ ...origin, accuracy: draft.vehicleLocation ? undefined : photo?.accuracy, role: draft.vehicleLocation ? 'manual_vehicle' : 'photo' }, nearby.busstops, { photoEvidence: evidence, heading: exactPhotoContext ? photo?.heading : undefined, location: exactPhotoContext ? photo?.location : undefined, incomplete: nearby.stopCoverage?.partial }).map((c) => conflictingNumbers ? { ...c, state: 'review' as const, conflicts: ['사진에서 서로 다른 공개 번호가 읽혀 대상 정류소를 확인해야 해요.', ...c.conflicts] } : c) : [];
  const inputKey = stopSelectionInputKey(draft);
  const selectedCandidate = candidates.find((c) => c.key === draft.stopSelection?.key);
  const changedFacility = selectedCandidate && draft.stopSelection && (['lat', 'lng', 'publicId', 'publicIdNamespace'] as const).some((field) => selectedCandidate.facility[field] !== draft.stopSelection!.facility[field]);
  const selectionCurrent = draft.stopSelection?.inputKey === inputKey && !changedFacility && !conflictingNumbers;
  const select = (key: string) => {
    const found = candidates.find((c) => c.key === key);
    if (found) onChange((d) => ({ ...d, selectedStopId: key, stopSelection: { key, facility: found.facility, selectedAt: Date.now(), source: 'user', photoEvidence: evidence, distanceStatus: 'unverified', inputKey: stopSelectionInputKey(d) } }));
  };
  const visibleCandidates = showAll ? candidates : candidates.slice(0, 3);
  return <details className="rounded border border-blue-200 p-3" open={draft.type === 'busstop'}><summary className="font-bold text-sm">주변 정류소 대조</summary>
    <div className="mt-2 space-y-2 text-sm">
      <p>가까운 한 곳으로 자동 확정하지 않아요. 사진의 공개 번호·이름과 자료를 비교해 주세요.</p>
      {photo?.location && <p className="text-xs">탐색에 쓴 사진 위치: {LOCATION_LABEL[photo.location.quality.status]} · {photo.location.quality.reasons.join(' ')}</p>}
      {!origin && <p>사진 좌표가 없어요. 발생지역 단계에서 차량 위치를 지정하거나 미확인으로 보관할 수 있어요.</p>}
      {evidence && <p>사진 {observation!.index + 1}에서 읽은 번호: {evidence.publicId || '미확인'} · {evidence.name || '이름 미확인'}</p>}
      {evidence && !exactPhotoContext && <p className="text-xs">번호를 읽은 사진의 위치·방향을 함께 확인하지 못해 방향 대조는 하지 않았어요.</p>}
      {observations.length > eligible.length && <p className="text-xs">기본 사진과 대상·장소가 연결되지 않은 보완사진의 번호는 자동 대조에 사용하지 않았어요.</p>}
      {conflictingNumbers && <p className="text-amber-900 text-xs">서로 다른 번호가 읽혔어요. 어느 정류소가 대상 차량과 연결되는지 확인해 주세요.</p>}
      {draft.stopSelection && <p className="font-bold">고른 후보: {draft.stopSelection.facility.name ?? draft.stopSelection.key} · 사용자 선택 · 거리 미확인{!selectionCurrent ? ' · 사진·위치·근거가 바뀌어 재확인 필요' : !busy && !selectedCandidate ? ' · 현재 자료에서 재확인 필요' : ''}</p>}
      {origin && <><button className="underline mr-3" onClick={() => setRetry((n) => n + 1)} disabled={busy}>{busy ? '후보 확인 중…' : '후보 다시 확인'}</button><button className="underline" onClick={() => setMap((v) => !v)}>{map ? '지도 접기' : '지도에서 후보 보기'}</button></>}
      {map && origin && <Suspense fallback={<p>지도 준비 중…</p>}><PickMap origin={origin} originRole={draft.vehicleLocation ? 'manual_vehicle' : 'photo'} accuracy={draft.vehicleLocation ? undefined : photo?.accuracy} stops={nearby?.busstops} selectedStopKey={draft.selectedStopId} onStopSelect={(stop) => select(stopKey(stop))} heading={exactPhotoContext ? photo?.heading : undefined} onCenter={() => {}} /></Suspense>}
      {nearby?.stopCoverage && <p className="text-xs text-slate-500">출처 {nearby.stopCoverage.source} · {nearby.stopCoverage.partial ? '일부 자료 · 누락 가능' : 'API 응답 수신 완료 · 현장 완전성 미확인'} · 자료 기준일 {nearby.stopCoverage.sourceUpdatedAt || '미확인'}</p>}
      {failed && <p>정류소 조회가 실패했어요. 기존 선택은 유지했어요.</p>}
      {!busy && !failed && origin && !candidates.length && <p>현재 자료에서 후보를 찾지 못했어요. 정류소가 없다는 뜻은 아니에요.</p>}
      <div className="max-h-64 overflow-y-auto space-y-2">{visibleCandidates.map((c) => <button key={c.key} onClick={() => select(c.key)} aria-pressed={draft.selectedStopId === c.key} className={`w-full text-left p-2 rounded border ${draft.selectedStopId === c.key ? 'border-blue-500 bg-blue-50' : 'border-slate-200'}`}><b>{c.facility.name ?? '이름 미확인'} {c.facility.publicId ? `(${c.facility.publicId})` : ''}</b><span className="block text-xs">{[...c.conflicts, ...c.reasons].join(' · ')}</span><span className="block text-xs text-slate-500">출처 {c.facility.source ?? '미확인'} · 기준일 {c.facility.sourceUpdatedAt ?? '미확인'}</span></button>)}</div>
      {candidates.length > 3 && <button className="underline" onClick={() => setShowAll((v) => !v)}>{showAll ? '상위 3개만 보기' : `전체 후보 ${candidates.length}개 보기`}</button>}
    </div>
  </details>;
}
