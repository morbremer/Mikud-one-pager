import React from 'react';
import { Mic, Square, Loader2 } from 'lucide-react';
import { useVoiceRecorder } from './useVoiceRecorder';

const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export default function RecordButton({ onAudio, busy, label = 'הקליטו תשובה', maxSeconds = 180, size = 'md' }) {
  const { recording, seconds, error, start, stop } = useVoiceRecorder(onAudio, maxSeconds);
  const big = size === 'lg';

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={recording ? stop : start}
        disabled={busy}
        aria-label={recording ? 'עצור הקלטה' : label}
        className={`relative flex items-center justify-center gap-2 rounded-full font-bold transition-all active:scale-95 disabled:opacity-50
          ${big ? 'h-16 px-10 text-base' : 'h-11 px-6 text-sm'}
          ${recording ? 'bg-red-600 text-white' : 'bg-[#0C084A] text-white hover:bg-[#0153F4]'}`}
      >
        {recording && <span className="absolute inset-0 rounded-full bg-red-500/40 animate-ping" />}
        <span className="relative flex items-center gap-2">
          {busy ? <Loader2 size={18} className="animate-spin" /> : recording ? <Square size={16} fill="currentColor" /> : <Mic size={18} />}
          {busy ? 'מתמללים ומנתחים...' : recording ? `עצירה · ${mmss(seconds)}` : label}
        </span>
      </button>
      {recording && <p className="text-[11px] text-mist-500">מקסימום {mmss(maxSeconds)} להקלטה</p>}
      {error && <p className="text-xs text-red-600 font-bold text-center">{error}</p>}
    </div>
  );
}