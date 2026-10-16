import { Camera, Image as ImageIcon, Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { formatStamp } from '../lib/camera';
import { intervalNote } from '../lib/rules';
import type { Shot } from '../types/report';
import { BlueBar } from './FormParts';

export interface PhotoSlotActions {
  /** 앨범 사진을 읽는 중인 칸 */
  busySlot?: 0 | 1;
  /** 카메라로 바꾸기·넣기 — 남은 사진이 있으면 그 사진 다음(2번째)으로 한 장, 없으면 두 장을 처음부터 찍는다 */
  onCamera: (slot: 0 | 1) => void;
  onAlbum: (slot: 0 | 1, file: File) => void;
  /** 마지막 한 장을 지우면 신고도 함께 지운다 */
  onRemove: (slot: 0 | 1) => void;
}

interface Props extends PhotoSlotActions {
  shots: (Shot | undefined)[];
  /** 기본 두 장 밖의 보완사진 수 — 기본 사진을 바꾸거나 지우면 함께 빠진다 */
  supplements: number;
  /** 두 사진 사이 최소 간격(초) — 1장 더 넣을 때 안내 */
  minInterval: number;
  /** 앨범에서 1장만 골라 들어왔을 때 — 화면을 열자마자 1장 더 넣기를 묻는다 */
  askMore?: boolean;
  onAsked?: () => void;
  onEvidence: () => void;
}

type Sheet = { kind: 'source'; slot: 0 | 1; more?: boolean } | { kind: 'remove'; slot: 0 | 1 };

const nth = (slot: 0 | 1) => `${slot + 1}번째`;
const span = (sec: number) => (sec >= 60 && sec % 60 === 0 ? `${sec / 60}분` : `${sec}초`);

/**
 * 위반 유형 확인 단계의 사진 두 칸 — 칸마다 바꾸기·지우기, 빈 칸은 사진 넣기.
 * 바꾸기·넣기는 앨범과 카메라 중에서 고른다. iPhone(ReportStepsScreen.photoSlots)과 같은 흐름·문구다.
 */
export default function PhotoSlots(p: Props) {
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const count = p.shots.filter(Boolean).length;
  const { askMore, onAsked } = p;

  useEffect(() => {
    if (!askMore) return;
    if (count === 1) setSheet({ kind: 'source', slot: 1, more: true });
    onAsked?.();
  }, [askMore, onAsked, count]);

  const close = () => setSheet(null);
  const supplementNote = p.supplements > 0 ? `보완 사진 ${p.supplements}장은 함께 빠집니다.` : undefined;

  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        {([0, 1] as const).map((slot) => {
          const s = p.shots[slot];
          const busy = p.busySlot === slot;
          if (!s) {
            return (
              <button
                key={slot}
                onClick={() => setSheet({ kind: 'source', slot })}
                disabled={p.busySlot !== undefined}
                className="aspect-[4/3] rounded-lg border-2 border-dashed border-[#3a8fdb] bg-blue-50/50 text-blue-700 flex flex-col items-center justify-center gap-1 text-[15px] font-bold"
                aria-label={`${nth(slot)} 사진 넣기`}
              >
                {busy ? <Loader2 className="w-6 h-6 animate-spin" aria-hidden="true" /> : <Plus className="w-6 h-6" aria-hidden="true" />}
                {busy ? '사진 읽는 중…' : '사진 넣기'}
              </button>
            );
          }
          return (
            <div key={slot} className="min-w-0">
              <button
                onClick={p.onEvidence}
                className="relative w-full aspect-[4/3] rounded-lg bg-slate-100 overflow-hidden"
                aria-label={`${nth(slot)} 사진 근거 보기`}
              >
                <img src={s.dataUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
                <span className="absolute bottom-0 inset-x-0 bg-slate-900/60 text-white text-[11px] tabular-nums py-0.5 text-center">
                  {s.source === 'album' && s.meta?.takenAt === undefined ? '시각 없음' : formatStamp(s.takenAt).slice(11)}
                </span>
                {busy && (
                  <span className="absolute inset-0 bg-white/80 flex items-center justify-center gap-1.5 text-[14px] font-bold text-slate-700">
                    <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" /> 사진 읽는 중…
                  </span>
                )}
              </button>
              <div className="mt-1 grid grid-cols-2 gap-1">
                <button
                  onClick={() => setSheet({ kind: 'source', slot })}
                  disabled={p.busySlot !== undefined}
                  aria-label={`${nth(slot)} 사진 바꾸기`}
                  className="h-10 rounded border border-slate-300 text-[14px] font-bold text-slate-700 flex items-center justify-center gap-1"
                >
                  <RefreshCw className="w-4 h-4 text-slate-500" aria-hidden="true" /> 바꾸기
                </button>
                <button
                  onClick={() => setSheet({ kind: 'remove', slot })}
                  disabled={p.busySlot !== undefined}
                  aria-label={`${nth(slot)} 사진 지우기`}
                  className="h-10 rounded border border-slate-300 text-[14px] font-bold text-red-600 flex items-center justify-center gap-1"
                >
                  <Trash2 className="w-4 h-4" aria-hidden="true" /> 지우기
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {sheet?.kind === 'source' && (
        <Dialog title={sheet.more ? '사진 1장 더 넣기' : p.shots[sheet.slot] ? `${nth(sheet.slot)} 사진 바꾸기` : `${nth(sheet.slot)} 사진 넣기`} onClose={close}>
          {sheet.more && (
            <p className="text-[15px] text-slate-800 leading-snug">
              사진이 2장 있어야 신고할 수 있습니다. 같은 자리에서 {span(p.minInterval)} 이상 간격을 두고 찍은 사진을 골라 주세요.{intervalNote(p.minInterval)}
            </p>
          )}
          <label className="w-full h-14 border-2 border-slate-200 text-[19px] text-slate-800 flex items-center justify-center gap-2 cursor-pointer">
            <ImageIcon className="w-5 h-5 text-slate-500" aria-hidden="true" /> 앨범에서 고르기
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                close();
                p.onAlbum(sheet.slot, file);
              }}
            />
          </label>
          <button
            onClick={() => { close(); p.onCamera(sheet.slot); }}
            className="w-full h-14 border-2 border-slate-200 text-[19px] text-slate-800 flex items-center justify-center gap-2"
          >
            <Camera className="w-5 h-5 text-slate-500" aria-hidden="true" /> 카메라로 찍기
          </button>
          <p className="text-[13px] text-slate-500 leading-snug">
            {count - (p.shots[sheet.slot] ? 1 : 0) > 0
              ? '카메라로 찍은 사진은 남은 사진 다음, 2번째 사진이 됩니다.'
              : '카메라로는 1번째·2번째 사진을 차례로 찍습니다.'}{' '}
            두 사진은 촬영 시각 순서로 1·2번째가 정해집니다.
            {p.shots[sheet.slot] && supplementNote ? ` ${supplementNote}` : ''}
          </p>
          <button onClick={close} className="w-full h-14 bg-slate-400 text-white text-[19px]">
            {sheet.more ? '나중에' : '취소'}
          </button>
        </Dialog>
      )}

      {sheet?.kind === 'remove' && (
        <Dialog title={`${nth(sheet.slot)} 사진을 지울까요?`} onClose={close}>
          <p className="text-[15px] text-slate-800 leading-snug">
            {count <= 1
              ? '사진이 이 1장뿐이라, 지우면 이 신고도 함께 지워집니다.'
              : `이 사진과 판독 결과를 지웁니다. 빈 칸에 다른 사진을 넣으면 됩니다.${supplementNote ? ` ${supplementNote}` : ''}`}
          </p>
          <button
            onClick={() => { close(); p.onRemove(sheet.slot); }}
            className="w-full h-14 bg-red-600 text-white text-[19px] font-bold"
          >
            {count <= 1 ? '신고 지우기' : '지우기'}
          </button>
          {count <= 1 && (
            <button
              onClick={() => setSheet({ kind: 'source', slot: sheet.slot })}
              className="w-full h-14 border-2 border-slate-200 text-[19px] text-slate-800"
            >
              다른 사진으로 바꾸기
            </button>
          )}
          <button onClick={close} className="w-full h-14 bg-slate-400 text-white text-[19px]">
            취소
          </button>
        </Dialog>
      )}
    </>
  );
}

/** 가운데 뜨는 창 — 신고서 화면에서 같이 쓴다 */
export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="absolute inset-0 z-30 bg-slate-900/50 flex items-center justify-center px-6">
      <div role="dialog" aria-modal="true" aria-label={title} className="w-full bg-white shadow-xl max-h-full flex flex-col">
        <BlueBar title={title} onClose={onClose} />
        <div className="p-4 space-y-2 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
