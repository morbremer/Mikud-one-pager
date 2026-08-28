import React, { useState } from 'react';
import { Sparkles, ShieldCheck, Zap, ChevronDown, ChevronUp, Minus, TrendingDown, TrendingUp } from 'lucide-react';
import Amount from './Amount';

export const fmt = (val) => {
  if (!val || isNaN(val)) return "0";
  return new Intl.NumberFormat('he-IL').format(Math.round(val));
};

export function SavingsAnnotation({ value }) {
  if (value == null || !Number.isFinite(Number(value))) return null;

  const numericValue = Number(value);
  const sign = numericValue > 0 ? '+' : numericValue < 0 ? '-' : '';
  const colorClass = numericValue > 0
    ? 'text-green-600'
    : numericValue < 0
      ? 'text-red-600'
      : 'text-mist-500';

  return (
    <span className={`-mt-0.5 text-[10px] sm:text-[11px] font-bold leading-none ${colorClass}`}>
      {sign}₪{fmt(Math.abs(numericValue))}
    </span>
  );
}

const MIX_META = {
  recommended: {
    icon: Sparkles,
    labelColor: 'from-[#0153F4] to-[#4C82FF]',
    borderColor: 'border-[#0153F4]/40',
    accentColor: '#0153F4',
    strategy: 'תמהיל מותאם אישית',
    rationale: 'חושב דינמית לפי גיל, יחס ההחזר, ה-LTV ויציבות ההכנסה. מיקסום חיסכון תוך שמירה על רמת סיכון מתאימה.',
    pros: ['חלוקה מחושבת לפי פרופיל ספציפי', 'איזון בין חיסכון ליציבות', 'מותאם לתקני בנק ישראל'],
    cons: ['החזר עשוי להשתנות עם שינויי ריבית'],
    riskLabel: 'סיכון מאוזן',
    riskColor: 'text-[#0153F4]',
    riskIcon: Minus,
    badge: 'אסטרטגי',
  },
  conservative: {
    icon: ShieldCheck,
    labelColor: 'from-mist-500 to-mist-600',
    borderColor: 'border-mist-200',
    accentColor: '#54566B',
    strategy: 'יציבות מקסימלית',
    rationale: 'כל הסכום בריבית קבועה לא צמודה — ההחזר החודשי לא ישתנה לאורך כל התקופה.',
    pros: ['החזר קבוע ומוכר לכל החיים', 'אפס חשיפה לשינויי ריבית', 'תכנון תזרים פשוט'],
    cons: ['עלות כוללת גבוהה יותר', 'לא מנצל ירידות ריבית'],
    riskLabel: 'סיכון נמוך',
    riskColor: 'text-mist-600',
    riskIcon: TrendingDown,
    badge: 'בטוח',
  },
  prime: {
    icon: Zap,
    labelColor: 'from-mist-500 to-mist-600',
    borderColor: 'border-mist-200',
    accentColor: '#54566B',
    strategy: 'מקסום חיסכון',
    rationale: 'חצי בפריים וחצי בקל"צ. מתאים להכנסה גבוהה ולמי שמאמין שהריבית תרד.',
    pros: ['חיסכון משמעותי אם הפריים יורד', 'גמישות גבוהה'],
    cons: ['חשיפה גבוהה לעליות ריבית', 'החזר עשוי לעלות'],
    riskLabel: 'סיכון גבוה יותר',
    riskColor: 'text-mist-600',
    riskIcon: TrendingUp,
    badge: 'חיסכון',
  },
};

function MixCard({
  title,
  tracks = [],
  totalPmt,
  mixType = 'recommended',
  loanAmount,
  durationYears,
  saving,
  monthlySaving,
  totalSaving,
  isValid = true,
}) {
  const [expanded, setExpanded] = useState(false);
  const meta = MIX_META[mixType] || MIX_META.recommended;
  const Icon = meta.icon;
  const RiskIcon = meta.riskIcon;
  const isRecommended = mixType === 'recommended';

  const years = tracks?.[0]?.years || durationYears || 25;
  const totalPayment = totalPmt * years * 12;
  const totalInterest = loanAmount ? totalPayment - loanAmount : null;

  return (
    <div
      dir="rtl"
      className={`relative rounded-3xl border overflow-hidden text-right ${isRecommended ? 'bg-periwinkle-100' : 'bg-white'} ${isValid ? meta.borderColor : 'border-mist-200'} transition-all duration-500`}
    >
      {/* אזהרת כושר החזר — לא חוסמת: התמהיל נשאר גלוי, עם ההכנסה הנדרשת כדי לעמוד בו */}
      {!isValid && (
        <div className="bg-mist-50 border-b border-mist-200 px-4 py-3 text-center">
          <p className="text-mist-600 text-[11px] leading-relaxed">
            כדי שהבנק יאשר תמהיל זה בסטנדרט רגיל נדרשת הכנסה נטו של{' '}
            <strong className="font-black text-mist-900">₪{fmt(Math.ceil(totalPmt / 0.4))}</strong> לחודש.
          </p>
        </div>
      )}

      {/* כרטיס מרובע — תמיד גלוי */}
      <button
        onClick={() => setExpanded(e => !e)}
        className={`w-full flex flex-col items-center text-center px-4 sm:px-5 pt-6 pb-4 ${expanded ? '' : 'aspect-square justify-between'}`}
      >
        <div className="flex flex-col items-center mb-6">
          <div className="flex items-center gap-2">
            <Icon size={14} style={{ color: meta.accentColor }} className="flex-shrink-0" />
            <h3 className="text-[#0C084A] font-black text-[15.4px] sm:text-[17.6px] leading-tight">{title}</h3>
          </div>
          <span
            className={`text-[9px] sm:text-[10px] font-black px-2.5 py-0.5 rounded-full bg-gradient-to-r ${meta.labelColor} text-white mt-2`}
          >
            {meta.badge}
          </span>
          <div className="flex items-center gap-1 mt-2">
            <RiskIcon size={12} className={meta.riskColor} />
            <span className={`text-[11px] font-bold ${meta.riskColor}`}>{meta.riskLabel}</span>
          </div>
        </div>

        <div className="w-full">
          <div className="w-full flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <span className="flex-shrink-0 whitespace-nowrap text-sm text-mist-700 font-semibold">תשלום חודשי</span>
              <span
                className={`font-semibold text-base sm:text-lg text-right ${monthlySaving != null ? 'flex flex-col items-end leading-none' : ''}`}
                style={{ color: meta.accentColor }}
              >
                <Amount value={Math.floor(totalPmt)} />
                <SavingsAnnotation value={monthlySaving} />
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="flex-shrink-0 whitespace-nowrap text-sm text-mist-700 font-semibold">משך זמן</span>
              <span className="font-semibold text-base sm:text-lg text-[#0C084A]">{years} שנה</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="flex-shrink-0 whitespace-nowrap text-sm text-mist-700 font-semibold">סך החזר כולל</span>
              <span className={`font-semibold text-base sm:text-lg text-right text-[#0C084A] ${totalSaving != null ? 'flex flex-col items-end leading-none' : ''}`}>
                <Amount value={Math.floor(totalPayment)} />
                <SavingsAnnotation value={totalSaving} />
              </span>
            </div>
          </div>
          {!expanded && (
            <div className="w-full flex justify-center mt-3">
              <ChevronDown size={18} className="text-[#7DA6FF]" />
            </div>
          )}
        </div>
      </button>

      {/* פירוט מורחב */}
      {expanded && (
        <div className="px-4 sm:px-6 pb-6 animate-in fade-in duration-300 border-t border-mist-100 pt-5">
          {/* חיסכון / ריבית */}
          {saving != null ? (
            <div className="mb-4 rounded-xl p-3 text-center bg-green-50 border border-green-200">
              <p className="text-green-700/70 text-[10px] font-semibold">חיסכון כולל בתקופה</p>
              <p className={`text-base font-black ${saving > 0 ? 'text-green-600' : 'text-red-600'}`}>
                {saving > 0 ? '+' : ''}₪{fmt(Math.abs(Math.floor(saving)))}
              </p>
            </div>
          ) : totalInterest !== null && (
            <div className="mb-4 rounded-xl p-3 text-center bg-mist-50 border border-mist-200">
              <p className="text-mist-500 text-[9px] font-semibold">סה"כ ריבית</p>
              <p className="text-[#0C084A] font-black text-sm">₪{fmt(Math.floor(totalInterest))}</p>
            </div>
          )}

          {/* מסלולים */}
          <div className="space-y-2 mb-4">
            {tracks.map((track, idx) => (
              <div key={idx} className="flex items-center justify-between gap-2 py-1.5">
                <div className="flex-1 min-w-0">
                  <p className="text-mist-800 font-bold text-xs leading-tight truncate">{track.name}</p>
                  <p className="text-mist-400 text-[10px] truncate">{track.desc}</p>
                </div>
                <div className="text-center flex-shrink-0 px-2">
                  <p className="font-black text-xs" style={{ color: meta.accentColor }}>
                    {(track.rate * 100).toFixed(2)}%
                  </p>
                  <p className="text-mist-400 text-[9px]">{track.years} שנה</p>
                </div>
                <div className="text-left flex-shrink-0">
                  <p className="font-black text-sm text-[#0C084A]">₪{fmt(Math.floor(track.pmt))}</p>
                </div>
              </div>
            ))}
          </div>

          {/* הסבר אסטרטגי */}
          <div className="space-y-3">
            <p className="text-mist-500 text-xs leading-relaxed">{meta.rationale}</p>
            <div className="space-y-2">
              <div className="rounded-xl p-3 bg-green-50 border border-green-200">
                <p className="text-green-700 text-[10px] font-bold mb-1">יתרונות</p>
                {meta.pros.map((p, i) => (
                  <p key={i} className="text-green-700/70 text-[10px]">✓ {p}</p>
                ))}
              </div>
              <div className="rounded-xl p-3 bg-red-50 border border-red-200">
                <p className="text-red-700 text-[10px] font-bold mb-1">חסרונות</p>
                {meta.cons.map((c, i) => (
                  <p key={i} className="text-red-700/70 text-[10px]">✗ {c}</p>
                ))}
              </div>
            </div>
          </div>

          <button onClick={() => setExpanded(e => !e)} className="w-full flex justify-center mt-4">
            <ChevronUp size={18} className="text-[#7DA6FF]" />
          </button>
        </div>
      )}
    </div>
  );
}

export default function MixComparison({
  mixes = null,
  mixA = null,
  mixB = null,
  mixC = null,
  cpiMix = null,
  loanAmount = 0,
  durationYears = 25,
  isRefinance = false,
  isPurchased = false,
  isDeclarationApprovalPossible = true,
  minMix = null,
  totalIncome = 0,
}) {
  const cards = mixes?.length
    ? mixes.slice(0, 3)
    : [
        {
          id: 'recommended',
          title: isRefinance ? mixB.label : 'תמהיל אסטרטגי',
          tracks: mixB.tracks,
          totalPmt: mixB.total,
          mixType: 'recommended',
          saving: isRefinance ? mixB.saving : undefined,
          isValid: mixB.isValid !== false,
        },
        {
          id: 'conservative',
          title: isRefinance ? mixA.label : 'תמהיל שמרני',
          tracks: mixA.tracks,
          totalPmt: mixA.total,
          mixType: 'conservative',
          saving: isRefinance ? mixA.saving : undefined,
          isValid: mixA.isValid !== false,
        },
        {
          id: 'prime',
          title: isRefinance ? mixC.label : 'תמהיל פריים',
          tracks: mixC.tracks,
          totalPmt: mixC.total,
          mixType: 'prime',
          saving: isRefinance ? mixC.saving : undefined,
          isValid: mixC.isValid !== false,
        },
      ];

  const anyMixExceedsDti = cards.some((card) => card.isValid === false);

  return (
    <div dir="rtl" className="space-y-6">
      {/* כותרת */}
      <div className="text-center relative">
        <h3 className="text-2xl sm:text-3xl font-black text-[#0C084A] leading-tight">
          בחרו את המשכנתא שמתאימה לכם
        </h3>
      </div>

      {/* הסבר כללי על יחס ההחזר — מוצג פעם אחת כשלפחות תמהיל אחד חורג */}
      {anyMixExceedsDti && (
        <div className="rounded-2xl bg-amber-50 border border-amber-300 p-4 text-center">
          <p className="text-amber-800 text-sm leading-relaxed">
            חשוב להכיר שלפי בנק ישראל, נדרש יחס החזר של 40% במשכנתא. כלומר, החזר המשכנתא החודשי לא יהווה מעל ל-40% מההכנסה החודשית.
          </p>
        </div>
      )}

      {/* גריד הכרטיסים */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-start">
        {cards.map((card) => (
          <MixCard
            key={card.id}
            title={card.title}
            tracks={card.tracks}
            totalPmt={card.totalPmt}
            mixType={card.mixType}
            loanAmount={card.loanAmount ?? loanAmount}
            durationYears={card.durationYears ?? durationYears}
            saving={card.saving}
            monthlySaving={card.monthlySaving}
            totalSaving={card.totalSaving}
            isValid={card.isValid !== false}
          />
        ))}
      </div>

      {/* תמהיל חירום צמוד מדד — מוצג כש-DTI חורג מ-40% */}
      {!isRefinance && cpiMix && (
        <div dir="rtl" className="rounded-2xl p-5 bg-amber-50 border border-amber-300">
          <div className="flex items-start gap-3 mb-4">
            <span className="text-2xl flex-shrink-0">💰</span>
            <div>
              <p className="text-amber-800 font-black text-sm mb-1">תמהיל חירום: צמוד מדד — החזר מינימלי אפשרי</p>
              <p className="text-amber-700/80 text-xs leading-relaxed">
                סינון 100% צמוד מדד (קבועה + משתנה) מקטין את ההחזר החודשי למקסימום אפשרי.
                {cpiMix.isValid
                  ? <span className="text-green-700 font-bold"> ✔ תמהיל זה עומד בדרישת יחס ההחזר!</span>
                  : <span className="text-red-600 font-bold"> ⚠️ גם תמהיל זה חורג מיחס ההחזר המותר — נדרשת הכנסה נוספת או הקטנת סכום</span>
                }
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
            {cpiMix.tracks.map((t, i) => (
              <div key={i} className="rounded-xl p-3 bg-white border border-amber-200">
                <p className="text-amber-700/70 text-[10px] font-semibold">{t.name}</p>
                <p className="text-[#0C084A] font-black text-sm mt-1">₪{fmt(Math.floor(t.pmt))}/חודש</p>
                <p className="text-amber-600/70 text-[9px]">{(t.rate * 100).toFixed(2)}% על {t.years} שנה</p>
              </div>
            ))}
            <div className={`rounded-xl p-3 text-center border ${cpiMix.isValid ? 'bg-green-50 border-green-300' : 'bg-red-50 border-red-300'}`}>
              <p className="text-mist-500 text-[10px] font-semibold">סה"כ לחודש</p>
              <p className={`font-black text-xl mt-1 ${cpiMix.isValid ? 'text-green-700' : 'text-red-600'}`}>₪{fmt(Math.floor(cpiMix.total))}</p>
            </div>
          </div>
          <div className="rounded-xl p-3 bg-white border border-amber-200">
            <p className="text-amber-800 text-[11px] font-bold mb-1">⚠️ סיכוני צמד מדד:</p>
            <p className="text-mist-600 text-[10px] leading-relaxed">החזר חודשי נדד עם המדד ועלול לעלות. בתרחיש אינפלציה גבוהה התשלום הכולל עלול לגדול משמעותית. <strong className="text-amber-700">מומלץ מאוד להתייעץ עם יועץ לפני בחירת מסלול זה.</strong></p>
          </div>
        </div>
      )}

      {/* אזהרה: לא ניתן לאשר בכלל — גם לא על בסיס תצהיר */}
      {!isRefinance && !isDeclarationApprovalPossible && totalIncome > 0 && minMix && (
        <div dir="rtl" className="rounded-3xl overflow-hidden bg-red-50 border border-red-300">
          <div className="h-1 w-full bg-gradient-to-r from-red-500 to-red-600" />

          <div className="p-6">
            {/* כותרת */}
            <div className="flex items-center gap-3 mb-5">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 bg-red-100 border border-red-300">
                <span className="text-2xl">🚫</span>
              </div>
              <div>
                <p className="text-red-700 font-black text-base leading-tight">לא ניתן לאשר אישור עקרוני</p>
                <p className="text-red-500 text-xs mt-0.5">גם לא על בסיס תצהיר הכנסה</p>
              </div>
            </div>

            {/* כרטיס פער */}
            <div className="rounded-2xl p-4 mb-5 text-center bg-white border border-red-200">
              <p className="text-red-600/80 text-xs font-semibold mb-1">הכנסה נוכחית</p>
              <p className="text-[#0C084A] font-black text-2xl">₪{fmt(Math.floor(totalIncome))}</p>
              <div className="flex items-center justify-center gap-2 my-2">
                <div className="h-px flex-1 bg-red-200" />
                <span className="text-red-600 text-xs font-bold">חסר</span>
                <div className="h-px flex-1 bg-red-200" />
              </div>
              <p className="text-red-600 font-black text-3xl">
                ₪{fmt(Math.floor(minMix.requiredIncome - totalIncome))}
              </p>
              <p className="text-red-500/70 text-[10px] mt-1">
                נדרש ₪{fmt(Math.floor(minMix.requiredIncome))} נטו לחודש (יחס החזר 40%)
              </p>
            </div>

            {/* אפשרויות פתרון */}
            <p className="text-mist-500 text-[11px] font-black uppercase tracking-widest mb-3">אפשרויות לפתרון</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                {
                  emoji: '💰',
                  title: 'הגדלת הכנסות',
                  desc: `נדרשת הכנסה נוספת של ₪${fmt(Math.floor(minMix.requiredIncome - totalIncome))} נטו/חודש`,
                  color: '#d97706',
                  bg: 'bg-amber-50',
                  border: 'border-amber-200',
                },
                {
                  emoji: '👤',
                  title: 'הוספת לווה נוסף',
                  desc: `לווה עם הכנסה ₪${fmt(Math.floor((minMix.requiredIncome - totalIncome) * 2))}+ (מוכר ב-50%)`,
                  color: '#0153F4',
                  bg: 'bg-periwinkle-100',
                  border: 'border-periwinkle-200',
                },
                {
                  emoji: '🏦',
                  title: 'מימון חוץ-בנקאי',
                  desc: 'קריטריונים גמישים יותר — ריביות 8%–18%',
                  color: '#059669',
                  bg: 'bg-green-50',
                  border: 'border-green-200',
                },
                {
                  emoji: '📞',
                  title: 'ייעוץ מקצועי',
                  desc: 'פנה ליועץ ב-2324* לתכנון אסטרטגי מותאם',
                  color: '#0C084A',
                  bg: 'bg-mist-50',
                  border: 'border-mist-200',
                },
              ].map((item, i) => (
                <div key={i} className={`rounded-xl p-3.5 ${item.bg} border ${item.border}`}>
                  <p className="font-black text-xs mb-1 flex items-center gap-1.5" style={{ color: item.color }}>
                    <span>{item.emoji}</span> {item.title}
                  </p>
                  <p className="text-mist-600 text-[11px] leading-relaxed">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
