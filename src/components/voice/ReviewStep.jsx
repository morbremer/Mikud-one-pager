import React, { useState } from 'react';
import { Loader2, ChevronRight } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { VOICE_FIELDS, REQUIRED_KEYS } from './voiceFields';
import FieldInput from './FieldInput';
import SourceBadge from './SourceBadge';
import StoryInsights from './StoryInsights';

export default function ReviewStep({ fields, onType, story, onBack, onConfirm, saving, error }) {
  const [approved, setApproved] = useState(false);
  const missing = REQUIRED_KEYS.filter(k => !fields[k]?.value);
  const toCheck = VOICE_FIELDS.filter(f => fields[f.key]?.status === 'needs_check').length;

  return (
    <div className="animate-in fade-in duration-500 space-y-6">
      <div className="text-center">
        <h1 className="text-2xl sm:text-3xl font-extrabold text-[#0C084A]">בדקו ואשרו את הפרטים</h1>
        <p className="text-mist-500 text-sm mt-2">זה מה שהבנו מהדברים שלכם. תקנו כל מה שלא מדויק — רק נתונים שתאשרו ייכנסו לבדיקת ההיתכנות.</p>
      </div>

      {(missing.length > 0 || toCheck > 0) && (
        <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-900">
          {missing.length > 0 && <p>חסרים {missing.length} פרטי חובה — השלימו אותם למטה.</p>}
          {toCheck > 0 && <p>{toCheck} פרטים מסומנים ״דורש בדיקה״ — ודאו שהם נכונים.</p>}
        </div>
      )}

      <div className="rounded-3xl border border-mist-100 bg-white divide-y divide-mist-100">
        {VOICE_FIELDS.map(f => (
          <div key={f.key} className="p-4 sm:p-5 grid sm:grid-cols-[1fr_1.4fr] gap-2 sm:gap-6 items-center">
            <div>
              <p className="text-sm font-bold text-[#0C084A]">{f.label}{!f.optional && <span className="text-red-500"> *</span>}</p>
              <div className="mt-1"><SourceBadge state={fields[f.key]} /></div>
              {fields[f.key]?.quote && <p className="text-[11px] text-mist-400 mt-1 truncate">״{fields[f.key].quote}״</p>}
              {fields[f.key]?.note && <p className="text-[11px] text-amber-700 font-bold mt-1">{fields[f.key].note}</p>}
            </div>
            <FieldInput field={f} value={fields[f.key]?.value} onChange={(v) => onType(f.key, v)} />
          </div>
        ))}
      </div>

      <StoryInsights story={story} />

      <label className="flex items-start gap-3 p-4 rounded-2xl bg-periwinkle-100 cursor-pointer">
        <Checkbox checked={approved} onCheckedChange={(c) => setApproved(!!c)} className="mt-0.5" />
        <span className="text-xs text-[#0C084A] font-bold leading-relaxed">
          בדקתי את הפרטים ואני מצהיר/ה שהם נכונים. ידוע לי שהבדיקה מבוססת על הצהרתי בלבד ואינה אישור בנקאי.
        </span>
      </label>
      {error && <p className="text-sm text-red-600 font-bold text-center">{error}</p>}

      <div className="flex gap-3">
        <button onClick={onBack} className="flex-1 h-12 rounded-full border border-mist-200 text-mist-600 font-bold text-sm flex items-center justify-center gap-1 hover:bg-mist-50">
          <ChevronRight size={18} /> חזרה לדיבור
        </button>
        <button
          onClick={onConfirm}
          disabled={!approved || missing.length > 0 || saving}
          className="flex-[2] h-12 rounded-full bg-[#0C084A] text-white font-semibold text-sm hover:bg-[#0153F4] transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {saving && <Loader2 size={16} className="animate-spin" />} אישור ובניית התיק
        </button>
      </div>
    </div>
  );
}