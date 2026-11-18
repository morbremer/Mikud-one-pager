import React, { useState } from 'react';
import { MessageCircle } from 'lucide-react';
import RecordButton from './RecordButton';
import StoryInsights from './StoryInsights';
import { VOICE_FIELDS, REQUIRED_KEYS } from './voiceFields';

const OPENING = 'ספרו לנו בחופשיות: מי אתם, איזה נכס אתם רוצים, כמה אתם צריכים, מה ההכנסות וההתחייבויות שלכם — ומה מטריד אתכם בתהליך.';

export default function GuidedConversation({ fields, story, followUps, turns, processAudio, onFinish }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const missing = VOICE_FIELDS.filter(f => REQUIRED_KEYS.includes(f.key) && !fields[f.key]?.value);
  const prompt = followUps[0] || (turns.length ? (missing[0]?.question || 'יש עוד משהו שחשוב לכם שנדע?') : OPENING);

  const handleAudio = async (blob) => {
    setBusy(true);
    setError(null);
    try {
      await processAudio(blob, { source: 'conversation', questionKey: 'conversation', prompt });
    } catch (e) {
      console.error(e);
      setError('לא הצלחנו לעבד את ההקלטה. נסו שוב.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-3xl bg-[#0C084A] text-white p-8 sm:p-10 text-center">
        <MessageCircle size={22} className="mx-auto mb-4 text-[#7DA6FF]" />
        <p className="text-lg sm:text-xl font-bold leading-relaxed max-w-2xl mx-auto">{prompt}</p>
        <div className="mt-8 [&_button]:bg-white [&_button]:text-[#0C084A]">
          <RecordButton onAudio={handleAudio} busy={busy} label={turns.length ? 'הקליטו תשובה' : 'התחילו לספר'} size="lg" />
        </div>
        {error && <p className="text-xs text-red-300 font-bold mt-3">{error}</p>}
      </div>

      {turns.length > 0 && (
        <div className="rounded-3xl border border-mist-100 bg-white p-6">
          <p className="text-xs font-black text-mist-400 mb-3">השיחה עד עכשיו</p>
          <div className="space-y-3 max-h-64 overflow-y-auto">
            {turns.map((t, i) => (
              <div key={i}>
                <p className="text-[11px] font-bold text-[#0153F4]">{t.prompt}</p>
                <p className="text-sm text-mist-700 leading-relaxed">״{t.transcript}״</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-mist-500 mt-4">חסרים עדיין {missing.length} פרטי חובה{missing.length ? `: ${missing.slice(0, 4).map(m => m.label).join(', ')}${missing.length > 4 ? '...' : ''}` : ''}</p>
        </div>
      )}

      <StoryInsights story={story} />

      {turns.length > 0 && (
        <button onClick={onFinish} className="w-full h-12 rounded-full border border-[#0C084A] text-[#0C084A] font-bold text-sm hover:bg-[#0C084A] hover:text-white transition-all">
          סיימתי לספר — לבדיקה ואישור
        </button>
      )}
    </div>
  );
}