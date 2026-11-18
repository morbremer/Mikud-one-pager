import React, { useState } from 'react';
import RecordButton from './RecordButton';
import FieldInput from './FieldInput';
import SourceBadge from './SourceBadge';

// שאלה בודדת: הקלטת תשובה או הקלדה. התמלול מוצג וניתן לתיקון.
export default function QuestionCard({ field, state, onType, processAudio }) {
  const [busy, setBusy] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState(null);

  const handleAudio = async (blob) => {
    setBusy(true);
    setError(null);
    try {
      const text = await processAudio(blob, { fieldKeys: [field.key], source: 'answer_recording', questionKey: field.key });
      setTranscript(text);
    } catch (e) {
      console.error(e);
      setError('לא הצלחנו לתמלל את ההקלטה. נסו שוב או הקלידו.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-3xl border border-mist-100 bg-white p-6 sm:p-8 shadow-sm animate-in fade-in slide-in-from-left-4 duration-500">
      <div className="flex items-center justify-between gap-3 mb-2">
        <p className="text-xs font-bold text-mist-400">{field.label}{field.optional ? ' · לא חובה' : ''}</p>
        <SourceBadge state={state} />
      </div>
      <h2 className="text-xl sm:text-2xl font-bold text-[#0C084A] mb-6">{field.question}</h2>

      <div className="flex justify-center mb-6">
        <RecordButton onAudio={handleAudio} busy={busy} maxSeconds={60} />
      </div>
      {error && <p className="text-xs text-red-600 font-bold text-center mb-3">{error}</p>}

      {transcript && (
        <div className="mb-4 p-3 rounded-xl bg-mist-50 border border-mist-100">
          <p className="text-[10px] font-bold text-mist-400 mb-1">מה ששמענו</p>
          <p className="text-sm text-mist-700">״{transcript}״</p>
        </div>
      )}
      {state?.note && <p className="text-xs text-amber-700 font-bold mb-2">{state.note}</p>}

      <p className="text-[11px] font-bold text-mist-500 mb-1.5">התשובה שנשמרה (אפשר לתקן או להקליד)</p>
      <FieldInput field={field} value={state?.value} onChange={onType} />
    </div>
  );
}