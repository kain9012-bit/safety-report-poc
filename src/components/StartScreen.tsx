import { useRef, useState } from 'react';
import { Camera, ChevronRight, Image as ImageIcon, Info, Menu, Trash2, ZoomIn } from 'lucide-react';
import { formatStamp } from '../lib/camera';
import { RESUME_MAX_MS } from '../lib/reports';
import type { ReportRecord } from '../lib/reports';
import { VIOLATION_LABEL } from '../types/report';
import { WhyPanel } from './FormParts';

interface Props {
  reports: ReportRecord[];
  onCamera: () => void;
  onAlbum: (files: File[]) => void;
  albumState: 'idle' | 'busy' | 'error';
  onResume: (r: ReportRecord) => void;
  onDelete: (id: string) => void;
}

const PHASE_TEXT = { capture: '촬영 중', form: '신고서 확인 중', submitted: '제출함(시제품)' } as const;

/**
 * 처음 화면 — 지금 앱의 불법주정차 탭 모양(파란 띠·탭)을 따르되, 할 일은 하나만 크게: **사진부터 찍기.**
 * 아래에 이어할 신고(앱을 바꾸거나 껐다 켜도 남는다)와 제출한 신고를 둔다.
 */
export default function StartScreen({ reports, onCamera, onAlbum, albumState, onResume, onDelete }: Props) {
  const album = useRef<HTMLInputElement>(null);
  const [why, setWhy] = useState(false);
  const now = Date.now();
  const open = reports.filter((r) => r.phase !== 'submitted' && r.draft.shots.length > 0);
  const done = reports.filter((r) => r.phase === 'submitted');

  return (
    <div className="relative flex-1 min-h-0 flex flex-col bg-white text-slate-900">
      <div className="shrink-0 h-12 bg-[#3a8fdb] flex items-stretch justify-between pl-3">
        <p className="self-center text-[13px] font-bold text-white/90">개선안 시제품</p>
        <div className="flex items-stretch">
          <span className="w-[58px] flex flex-col items-center justify-center text-white gap-0.5" aria-hidden="true">
            <ZoomIn className="w-6 h-6" />
            <span className="text-[11px] leading-none">돋보기</span>
          </span>
          <span className="w-14 bg-[#2f7cc4] flex items-center justify-center" aria-hidden="true">
            <Menu className="w-8 h-8 text-white" />
          </span>
        </div>
      </div>
      <div className="shrink-0 bg-slate-100 grid grid-cols-5 text-center text-[16px] leading-[1.15]" aria-hidden="true">
        {['안전', '불법\n주정차', '자동차·\n교통위반', '생활\n불편'].map((t) => (
          <span
            key={t}
            className={`h-[52px] flex items-center justify-center whitespace-pre-line border-b-[3px] ${
              t.startsWith('불법') ? 'text-[#2f7cc4] font-bold border-[#3a8fdb]' : 'text-slate-800 border-transparent'
            }`}
          >
            {t}
          </span>
        ))}
        <span className="h-[52px] flex flex-col items-center justify-center text-[13px] text-slate-800">
          <span className="tracking-[0.2em] font-bold leading-none">•••</span>
          퀵메뉴
        </span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-5 pb-6 space-y-6">
        <section>
          <button
            onClick={onCamera}
            className="w-full rounded-2xl bg-[#3a8fdb] text-white px-5 py-6 flex items-center gap-4 text-left active:bg-[#2f7cc4]"
          >
            <span className="w-16 h-16 rounded-full bg-white/20 flex items-center justify-center shrink-0">
              <Camera className="w-9 h-9" aria-hidden="true" />
            </span>
            <span>
              <span className="block text-[24px] font-bold leading-tight">사진부터 찍기</span>
              <span className="block mt-1 text-[15px] text-white/90">찍으면 유형·발생지역·내용이 채워집니다</span>
            </span>
          </button>
          <button
            onClick={() => album.current?.click()}
            disabled={albumState === 'busy'}
            className="mt-2.5 w-full h-12 rounded-lg border-2 border-slate-300 text-slate-800 text-[16px] font-bold flex items-center justify-center gap-2"
          >
            <ImageIcon className="w-5 h-5 text-slate-500" aria-hidden="true" />
            {albumState === 'busy' ? '앨범 사진 읽는 중…' : '앨범에서 2장 고르기'}
          </button>
          {albumState === 'error' && <p className="mt-1.5 text-[13px] text-red-600">앨범 사진을 읽지 못했습니다. 다른 사진을 골라 주세요.</p>}
          <input
            ref={album}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = '';
              if (files.length) onAlbum(files);
            }}
          />
        </section>

        <section>
          <h2 className="text-[17px] font-bold">이어할 신고 <span className="text-blue-700 tabular-nums">{open.length}</span></h2>
          {open.length === 0 ? (
            <p className="mt-1.5 text-[14px] text-slate-500">하던 신고가 없습니다. 앱을 바꾸거나 꺼도 하던 신고는 여기 남습니다.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {open.map((r) => (
                <ReportItem key={r.id} r={r} expired={now - r.createdAt > RESUME_MAX_MS} onOpen={() => onResume(r)} onDelete={() => onDelete(r.id)} />
              ))}
            </ul>
          )}
        </section>

        {done.length > 0 && (
          <section>
            <h2 className="text-[17px] font-bold">제출한 신고 <span className="text-slate-500 tabular-nums">{done.length}</span></h2>
            <ul className="mt-2 space-y-2">
              {done.map((r) => (
                <ReportItem key={r.id} r={r} onOpen={() => onResume(r)} onDelete={() => onDelete(r.id)} />
              ))}
            </ul>
          </section>
        )}

        <button onClick={() => setWhy(true)} className="flex items-center gap-1.5 text-[14px] font-bold text-blue-700">
          <Info className="w-4 h-4" aria-hidden="true" /> 지금 앱과 무엇이 다른가
        </button>
      </div>

      {why && <WhyPanel onClose={() => setWhy(false)} />}
    </div>
  );
}

function ReportItem({ r, expired, onOpen, onDelete }: { r: ReportRecord; expired?: boolean; onOpen: () => void; onDelete: () => void }) {
  const s = r.draft.shots[0];
  return (
    <li className="flex items-stretch rounded-lg border border-slate-200 overflow-hidden">
      <button onClick={onOpen} className="flex-1 min-w-0 flex items-center gap-3 p-2 text-left hover:bg-slate-50">
        {s && <img src={s.dataUrl} alt="" className="w-14 h-14 rounded object-cover shrink-0" />}
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-bold truncate">
            {r.draft.type ? VIOLATION_LABEL[r.draft.type] : '유형 미정'} · {r.draft.shots.length}장
          </span>
          <span className="block text-[13px] text-slate-500 truncate">{r.draft.address ?? (s ? formatStamp(s.takenAt).slice(5, 16) : '')}</span>
          <span className={`block text-[12px] font-bold ${expired ? 'text-red-600' : 'text-blue-700'}`}>
            {expired ? '접수 기한 지남' : PHASE_TEXT[r.phase]}
          </span>
        </span>
        <ChevronRight className="w-5 h-5 text-slate-400 shrink-0" aria-hidden="true" />
      </button>
      <button onClick={onDelete} aria-label="지우기" className="w-11 flex items-center justify-center border-l border-slate-200 text-slate-400 hover:text-red-600">
        <Trash2 className="w-4 h-4" aria-hidden="true" />
      </button>
    </li>
  );
}
