import React, { useState, useRef, useEffect } from 'react';
import { X, Send, RefreshCw } from 'lucide-react';
import MikoAvatar from './MikoAvatar';
import { appClient } from '@/api/appClient';

const QUICK_QUESTIONS = [
  "מה התמהיל המומלץ?",
  "איך להוריד DTI?",
  "מה הריביות היום?",
  "אילו מסמכים צריך?",
  "כמה אפשר לחסוך?",
  "קל\"צ מול פריים?",
];

const WELCOME_MSG = {
  role: 'ai',
  text: `שלום! 👋 אני מיקו, היועץ הדיגיטלי של מיקוד משכנתאות.

אני רואה את נתוני התיק שלך ויכול לענות על כל שאלה — מחישובים, דרך השוואת מסלולים, ועד טקטיקות מול הבנק.

שאל אותי כל דבר 😊`,
};

const buildSystemPrompt = (formData, results, isPurchased, rates) => {
  const fmt = (n) => n ? Number(n).toLocaleString('he-IL') : 'לא צוין';

  // נתוני נכס ומשכנתא
  const propertyPrice = Number(String(formData.propertyPrice || 0).replace(/,/g, ''));
  const equity = Number(String(formData.equity || 0).replace(/,/g, ''));

  const mortgageTypeMap = {
    purchase_first: 'רכישת דירה ראשונה',
    purchase_improve: 'משפרי דיור',
    refinance: 'מחזור משכנתא',
    any_purpose: 'כל מטרה',
    reverse_mortgage: 'משכנתא הפוכה',
    senior_bank: 'בנק לגיל הזהב',
  };

  const creditMap = { clean: 'תקין (ירוק)', issues: 'מורכב (היו עיכובים)' };
  const maritalMap = { single: 'רווק/ה', married: 'נשוי/אה', divorced: 'גרוש/ה', widowed: 'אלמן/ה' };

  let borrowerInfo = '';
  if (formData.borrowers?.length) {
    formData.borrowers.forEach((b, idx) => {
      const types = (b.employmentTypes || ['employee']).join(', ');
      const sources = b.incomeSources || {};
      const incomeLines = Object.entries(sources)
        .filter(([, s]) => s?.amount)
        .map(([k, s]) => `  - ${k}: ₪${fmt(s.amount)}/חודש, ותק: ${s.seniority || '?'} שנים`)
        .join('\n');
      borrowerInfo += `לווה ${idx + 1}: סוגי הכנסה: ${types}, אשראי: ${creditMap[b.creditHistory] || b.creditHistory}\n${incomeLines}\n`;
    });
  } else {
    borrowerInfo = `סטטוס תעסוקה: ${formData.employmentStatusA || 'לא צוין'}, אשראי: ${creditMap[formData.creditHistory] || 'לא צוין'}\n`;
  }

  // תמהילים
  let mixInfo = '';
  if (results?.mixA && results?.mixB && results?.mixC) {
    const descMix = (m, name) => {
      const tracks = (m.tracks || []).map(t => `${t.name || t.type}: ${t.rate ? (t.rate * 100).toFixed(2) + '%' : ''} / ${t.years || t.period_years}שנ / ₪${fmt(Math.floor(t.pmt || t.monthly || 0))}/חודש`).join(' | ');
      return `${name}: סה"כ ₪${fmt(Math.floor(m.total || 0))}/חודש — ${tracks}`;
    };
    mixInfo = `
תמהילים מחושבים:
• ${descMix(results.mixB, 'תמהיל מאוזן (מומלץ)')}
• ${descMix(results.mixA, 'תמהיל שמרני')}
• ${descMix(results.mixC, 'תמהיל פריים')}`;
  }

  const excessAmount = results?.excessAmount || 0;
  const excessNote = excessAmount > 0
    ? `\n⚠️ פער מימון: הלקוח ביקש ₪${fmt(results.requestedLoanAmount)} אך הבנק יאשר עד ₪${fmt(results.loanAmount)} בלבד. פער של ₪${fmt(excessAmount)} לא מכוסה בנקאית.`
    : '';

  const baseData = `
===== נתוני תיק הלקוח =====
מטרת משכנתא: ${mortgageTypeMap[formData.mortgageType] || 'לא צוין'}
שווי נכס: ₪${fmt(propertyPrice)}
הון עצמי: ₪${fmt(equity)}
סכום משכנתא מאושר: ₪${fmt(results?.loanAmount || 0)}${results?.requestedLoanAmount > results?.loanAmount ? ` (מבוקש: ₪${fmt(results.requestedLoanAmount)})` : ''}
אחוז מימון (LTV): ${results?.ltv?.toFixed(1) || '?'}%
יחס החזר (DTI): ${results?.isReverse ? 'לא רלוונטי (משכנתא הפוכה)' : (results?.dti?.toFixed(1) + '%' || '?')}
תקופה: ${results?.actualDuration ?? formData.loanDuration} שנים
החזר חודשי מומלץ: ₪${fmt(Math.floor(results?.mixB?.total || 0))}
ציון איכות: ${results?.score || '?'}/100
מצב משפחתי: ${maritalMap[formData.maritalStatus] || 'לא צוין'}
ילדים מתחת לגיל 18: ${formData.childrenUnder18 || 0}${excessNote}

===== לווים =====
${borrowerInfo}
${mixInfo}
===========================`;

  return `אתה מיקו — יועץ משכנתאות AI מקצועי, חמים ואנושי של מיקוד משכנתאות ישראל.
אתה מומחה בתחום המשכנתאות הישראלי: תקני בנק ישראל, מסלולי ריבית (פריים, קל"צ, קצ"מ, משתנה כל 5), LTV, DTI, תמהילים, ומשא ומתן מול בנקים.

${isPurchased ? baseData : `הלקוח טרם רכש דוח מלא. נתונים חלקיים בלבד:\nשווי נכס: ₪${fmt(propertyPrice)}, הון עצמי: ₪${fmt(equity)}.`}

הנחיות תגובה:
- ענה בעברית נקייה, ברורה ומקצועית
- היה ספציפי ומעשי — אל תהיה גנרי
- ${isPurchased ? 'התייחס לנתוני התיק הספציפיים של הלקוח בתשובותיך' : 'ענה תשובות כלליות מועילות. בסוף הזכר שלניתוח מדויק כדאי לרכוש דוח מלא או לפנות ל-2324*'}
- ריביות עדכניות שמשמשות את המערכת כעת: פריים=${rates?.PRIME ? (rates.PRIME * 100).toFixed(2) : '5.50'}%, פריים ללקוח (P-0.6%)=${rates?.PRIME_CALC ? (rates.PRIME_CALC * 100).toFixed(2) : '4.90'}%, קל"צ=${rates?.FIXED_UNLINKED ? (rates.FIXED_UNLINKED * 100).toFixed(2) : '4.70'}%, קצ"מ=${rates?.VAR_LINKED ? (rates.VAR_LINKED * 100).toFixed(2) : '3.15'}%, משתנה לא צמודה=${rates?.VAR_UNLINKED ? (rates.VAR_UNLINKED * 100).toFixed(2) : '4.58'}%, קבועה צמודה=${rates?.FIXED_LINKED ? (rates.FIXED_LINKED * 100).toFixed(2) : '3.20'}%
- אם רלוונטי — המלץ לפנות ליועץ אנושי ב-2324*
- תשובה מפורטת ככל שנדרש, אל תקצר אם השאלה מורכבת`;
};

export default function MikoChat({ formData, results, isPurchased, isOpen, setIsOpen, rates }) {
  const [messages, setMessages] = useState([WELCOME_MSG]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const chatEndRef = useRef(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const resetChat = () => {
    setMessages([WELCOME_MSG]);
    setInput("");
  };

  const sendMessage = async (text) => {
    if (!text.trim() || loading) return;
    setInput("");

    const newUserMsg = { role: 'user', text };
    const updatedMessages = [...messages, newUserMsg];
    setMessages(updatedMessages);
    setLoading(true);

    // בניית היסטוריית שיחה ל-LLM
    const conversationHistory = updatedMessages
      .filter(m => m.role !== 'system')
      .map(m => `${m.role === 'user' ? 'לקוח' : 'מיקו'}: ${m.text}`)
      .join('\n\n');

    const systemPrompt = buildSystemPrompt(formData, results, isPurchased, rates);

    try {
      const response = await appClient.ai.generate(`${systemPrompt}\n\n===== היסטוריית השיחה =====\n${conversationHistory}\n\nמיקו:`);

      const reply = typeof response === 'string'
        ? response.trim()
        : (response?.output || response?.text || JSON.stringify(response) || '').trim();

      setMessages(prev => [...prev, {
        role: 'ai',
        text: reply || "אשמח לעזור! פנה ליועץ שלנו ב-2324* לכל שאלה."
      }]);
    } catch {
      setMessages(prev => [...prev, {
        role: 'ai',
        text: "מצטער, נתקלתי בתקלה טכנית. 😅 לכל שאלה ניתן לפנות ליועץ האנושי שלנו ב-2324*"
      }]);
    } finally {
      setLoading(false);
    }
  };

  const showQuickQuestions = messages.length <= 1;

  return (
    <div className="fixed bottom-4 left-4 z-[300] flex flex-col items-start" dir="rtl">
      {isOpen && (
        <div className="bg-white w-[85vw] sm:w-[360px] h-[500px] mb-3 rounded-2xl shadow-2xl border border-[#1362FF]/30 flex flex-col overflow-hidden animate-in slide-in-from-bottom-4">
          {/* Header */}
          <div className="bg-gradient-to-r from-[#06042A] to-[#0141C2] p-3 text-white flex justify-between items-center flex-shrink-0">
            <div className="flex items-center gap-2">
              <MikoAvatar className="w-9 h-9 ring-2 ring-[#1362FF] rounded-full" />
              <div>
                <span className="text-sm font-bold block">מיקו AI</span>
                <span className="text-[10px] text-[#1362FF] block">יועץ משכנתאות חכם ✨</span>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={resetChat}
                className="hover:text-[#1362FF] transition-colors p-1.5 hover:bg-white/10 rounded-lg"
                title="שיחה חדשה"
              >
                <RefreshCw size={15} />
              </button>
              <button onClick={() => setIsOpen(false)} className="hover:text-[#1362FF] transition-colors p-1.5 hover:bg-white/10 rounded-lg">
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3 bg-mist-50">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-start' : 'justify-end'}`}>
                <div className={`px-4 py-3 rounded-2xl max-w-[88%] text-sm leading-relaxed whitespace-pre-line ${
                  m.role === 'user'
                    ? 'bg-white text-mist-800 rounded-br-none border border-mist-200 shadow-sm'
                    : 'bg-gradient-to-br from-[#06042A] to-[#0C084A] text-white rounded-bl-none shadow-md'
                }`}>
                  {m.text}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-end">
                <div className="bg-[#06042A] rounded-2xl rounded-bl-none px-4 py-3 flex gap-1 items-center">
                  <span className="w-2 h-2 bg-[#1362FF] rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-2 h-2 bg-[#1362FF] rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-2 h-2 bg-[#1362FF] rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Quick questions */}
          {showQuickQuestions && (
            <div className="px-3 pb-2 grid grid-cols-3 gap-1.5 bg-mist-50 border-t border-mist-100 pt-2 flex-shrink-0">
              {QUICK_QUESTIONS.map((q, i) => (
                <button
                  key={i}
                  onClick={() => sendMessage(q)}
                  className="text-[11px] bg-white border border-[#1362FF]/50 text-[#0C084A] font-semibold px-2 py-1.5 rounded-xl hover:bg-[#1362FF]/10 transition-all text-center leading-tight"
                >
                  {q}
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <div className="p-3 bg-white border-t border-mist-200 flex gap-2 flex-shrink-0">
            <input
              className="flex-1 bg-mist-50 border border-mist-200 focus:border-[#1362FF] rounded-xl px-3 py-2 text-sm outline-none text-right font-medium transition-all"
              placeholder="שאל את מיקו..."
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage(input)}
            />
            <button
              onClick={() => sendMessage(input)}
              disabled={loading || !input.trim()}
              className="bg-[#1362FF] text-[#06042A] p-2.5 rounded-xl active:scale-95 transition-all disabled:opacity-40"
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      )}

      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-16 h-16 sm:w-20 sm:h-20 shadow-2xl hover:scale-110 transition-all rounded-full overflow-hidden border-4 border-[#1362FF] bg-white relative group"
      >
        <MikoAvatar className="w-full h-full" />
        {!isOpen && (
          <div className="absolute -top-1 -right-1 w-5 h-5 bg-green-500 rounded-full border-2 border-white animate-pulse" />
        )}
      </button>
    </div>
  );
}
