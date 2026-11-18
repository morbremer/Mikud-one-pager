import React from 'react';
import { SOURCE_LABELS } from './voiceFields';

const STATUS = {
  draft: { text: 'טיוטה', cls: 'bg-periwinkle-100 text-[#0153F4]' },
  needs_check: { text: 'דורש בדיקה', cls: 'bg-amber-100 text-amber-800' },
  confirmed: { text: 'אושר', cls: 'bg-green-100 text-green-700' },
};

export default function SourceBadge({ state }) {
  if (!state?.value) return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-mist-100 text-mist-500">לא ידוע</span>;
  const s = STATUS[state.status] || STATUS.draft;
  return (
    <span className="flex items-center gap-1.5">
      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${s.cls}`}>{s.text}</span>
      <span className="text-[10px] text-mist-500">{SOURCE_LABELS[state.source] || ''}</span>
    </span>
  );
}