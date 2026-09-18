import React from 'react';

/** 상태 배지 — KRDS 색 토큰 위에서 쓰는 공통 조각 */
export const Badge: React.FC<{
  tone?: 'blue' | 'slate' | 'amber' | 'green' | 'red';
  children: React.ReactNode;
}> = ({ tone = 'slate', children }) => {
  const cls = {
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
    slate: 'bg-slate-50 text-slate-700 border-slate-200',
    amber: 'bg-amber-50 text-amber-800 border-amber-200',
    green: 'bg-green-50 text-green-700 border-green-100',
    red: 'bg-red-50 text-red-700 border-red-200',
  }[tone];
  return (
    <span className={`px-2 py-0.5 rounded border text-xs font-bold whitespace-nowrap ${cls}`}>
      {children}
    </span>
  );
};

export const SectionTitle: React.FC<{
  children: React.ReactNode;
  count?: number;
  desc?: string;
}> = ({ children, count, desc }) => (
  <div className="flex items-baseline gap-2 flex-wrap">
    <h3 className="text-lg font-bold text-slate-900">{children}</h3>
    {count !== undefined && (
      <span className="text-sm font-bold text-blue-700 tabular-nums">{count}건</span>
    )}
    {desc && <span className="text-xs text-slate-500">{desc}</span>}
  </div>
);

export const EmptyState: React.FC<{
  icon: React.ReactNode;
  title: string;
  desc?: string;
  children?: React.ReactNode;
}> = ({ icon, title, desc, children }) => (
  <div className="bg-white rounded-lg border border-slate-200 p-8 text-center space-y-3">
    <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
      {icon}
    </div>
    <h3 className="text-base font-bold text-slate-800">{title}</h3>
    {desc && <p className="text-sm text-slate-500 max-w-md mx-auto">{desc}</p>}
    {children}
  </div>
);

/**
 * 신고서의 각 칸이 어디서 자동으로 왔는지 밝히는 배지.
 * 자동으로 채운 값은 근거를 같이 보여주지 않으면 국민이 제출 단추를 누르지 못한다.
 */
export type Evidence = 'gps' | 'photo' | 'time' | 'manual';

export const EvidenceBadge: React.FC<{ kind: Evidence }> = ({ kind }) => {
  const map = {
    gps: { tone: 'blue' as const, label: '위치에서 자동' },
    photo: { tone: 'amber' as const, label: '사진 판독(추정)' },
    time: { tone: 'green' as const, label: '촬영시각에서 자동' },
    manual: { tone: 'slate' as const, label: '직접 입력' },
  }[kind];
  return <Badge tone={map.tone}>{map.label}</Badge>;
};

/** 제안용 시제품임을 모든 화면에 밝히는 띠. 실제 기관 화면으로 오인되면 안 된다. */
export const ProtoNotice: React.FC = () => (
  <div role="note" className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-center">
    <p className="text-xs font-bold text-amber-900">
      개선 제안용 비공식 시제품 · 실제 신고는 접수되지 않습니다
    </p>
  </div>
);

/** 모바일 흐름을 데스크톱에서 볼 때 감싸는 기기 틀 */
export const PhoneFrame: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="w-full sm:max-w-[420px] sm:mx-auto sm:my-6 sm:rounded-[2rem] sm:border-8 sm:border-slate-900 sm:overflow-hidden sm:shadow-2xl bg-white min-h-screen sm:min-h-[860px] flex flex-col">
    {children}
  </div>
);
