import React from 'react';
import { Check } from 'lucide-react';

const STEPS = [
  { id: 'consent', label: 'הסכמה' },
  { id: 'intake', label: 'מספרים בקול' },
  { id: 'review', label: 'בדיקה ואישור' },
  { id: 'case', label: 'התיק שלכם' },
];

export default function VoiceStepper({ stage }) {
  const current = STEPS.findIndex(s => s.id === stage);
  return (
    <ol className="flex items-center justify-center gap-2 sm:gap-4 mb-10" dir="rtl">
      {STEPS.map((s, i) => (
        <li key={s.id} className="flex items-center gap-2 sm:gap-4">
          <span className={`flex items-center gap-2 text-xs sm:text-sm font-bold ${i <= current ? 'text-[#0C084A]' : 'text-mist-400'}`}>
            <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs transition-all duration-500
              ${i < current ? 'bg-[#0153F4] text-white' : i === current ? 'bg-[#0C084A] text-white' : 'bg-mist-100 text-mist-500'}`}>
              {i < current ? <Check size={14} strokeWidth={3} /> : i + 1}
            </span>
            <span className="hidden sm:inline">{s.label}</span>
          </span>
          {i < STEPS.length - 1 && <span className={`w-6 sm:w-12 h-px ${i < current ? 'bg-[#0153F4]' : 'bg-mist-200'}`} />}
        </li>
      ))}
    </ol>
  );
}