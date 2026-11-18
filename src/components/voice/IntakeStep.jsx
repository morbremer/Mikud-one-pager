import React, { useState } from 'react';
import { MessageCircle, ListChecks } from 'lucide-react';
import GuidedConversation from './GuidedConversation';
import QuestionByQuestion from './QuestionByQuestion';

const MODES = [
  { id: 'conversation', label: 'שיחה חופשית מונחית', icon: MessageCircle },
  { id: 'questions', label: 'שאלה אחרי שאלה', icon: ListChecks },
];

export default function IntakeStep(props) {
  const [mode, setMode] = useState('conversation');
  return (
    <div className="animate-in fade-in duration-500">
      <div className="flex justify-center mb-8">
        <div className="inline-flex p-1 rounded-full bg-mist-100">
          {MODES.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setMode(id)}
              className={`flex items-center gap-2 px-5 h-10 rounded-full text-sm font-bold transition-all ${mode === id ? 'bg-white text-[#0C084A] shadow-sm' : 'text-mist-500 hover:text-[#0C084A]'}`}
            >
              <Icon size={15} /> {label}
            </button>
          ))}
        </div>
      </div>
      <p className="text-center text-xs text-mist-500 -mt-4 mb-8">אפשר לעבור בין הדרכים בכל רגע — כל מה שנאמר נשמר באותו תיק.</p>
      {mode === 'conversation' ? <GuidedConversation {...props} /> : <QuestionByQuestion {...props} />}
    </div>
  );
}