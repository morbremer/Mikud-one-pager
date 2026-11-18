import React, { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { VOICE_FIELDS } from './voiceFields';
import QuestionCard from './QuestionCard';

export default function QuestionByQuestion({ fields, onType, processAudio, onFinish }) {
  const [index, setIndex] = useState(() => {
    const firstMissing = VOICE_FIELDS.findIndex(f => !fields[f.key]?.value);
    return firstMissing === -1 ? 0 : firstMissing;
  });
  const field = VOICE_FIELDS[index];
  const isLast = index === VOICE_FIELDS.length - 1;

  return (
    <div>
      <div className="flex items-center justify-between mb-3 text-xs text-mist-500 font-bold">
        <span>שאלה {index + 1} מתוך {VOICE_FIELDS.length}</span>
        <div className="h-1.5 w-40 rounded-full bg-mist-100 overflow-hidden">
          <div className="h-full bg-[#0153F4] transition-all duration-500" style={{ width: `${((index + 1) / VOICE_FIELDS.length) * 100}%` }} />
        </div>
      </div>

      <QuestionCard
        key={field.key}
        field={field}
        state={fields[field.key]}
        onType={(v) => onType(field.key, v)}
        processAudio={processAudio}
      />

      <div className="flex gap-3 mt-6">
        <button
          onClick={() => setIndex(i => Math.max(0, i - 1))}
          disabled={index === 0}
          className="flex-1 h-12 rounded-full border border-mist-200 text-mist-600 font-bold text-sm flex items-center justify-center gap-1 hover:bg-mist-50 disabled:opacity-40"
        >
          <ChevronRight size={18} /> הקודמת
        </button>
        <button
          onClick={() => (isLast ? onFinish() : setIndex(i => i + 1))}
          className="flex-[2] h-12 rounded-full bg-[#0C084A] text-white font-semibold text-sm flex items-center justify-center gap-1 hover:bg-[#0153F4] transition-all"
        >
          {isLast ? 'לבדיקה ואישור' : 'השאלה הבאה'} <ChevronLeft size={18} />
        </button>
      </div>
    </div>
  );
}