import React from 'react';
import { Check, X, Minus, Crown } from 'lucide-react';
import { useReportPrice } from '@/hooks/useReportPrice';

// שלוש דרכים לקחת משכנתא — לבד / יועץ רגיל / מיקוד.
// כל שורה היא קריטריון; ערך התא הוא true (✓), false (✗), 'partial' (◦) או טקסט.
const COLS = [
  { key: 'alone', label: 'לבד' },
  { key: 'advisor', label: 'יועץ משכנתאות רגיל' },
  { key: 'mikud', label: 'מיקוד משכנתאות', highlight: true },
];

const rows = [
  {
    criterion: 'עלות',
    alone: 'חינם — אבל עלול לעלות ביוקר',
    advisor: '~₪6,000–₪10,000',
    mikud: null, // מוזרק דינמית לפי מחיר הדוח (useReportPrice)
  },
  {
    criterion: 'אובייקטיביות / ללא ניגוד עניינים',
    alone: true,
    advisor: 'partial',
    mikud: true,
  },
  {
    criterion: 'תוצאות מקצועיות מבוססות שנות ניסיון',
    alone: false,
    advisor: true,
    mikud: true,
  },
  {
    criterion: 'אורך התהליך',
    alone: 'ימים של מחקר',
    advisor: 'ימים–שבועות',
    mikud: '5 דקות',
  },
  {
    criterion: 'ערכת מיקוח מלאה מוכנה לבנק',
    hint: 'מכתב פנייה, תסריט שיחה, רשימת מסמכים ועוד',
    alone: false,
    advisor: false,
    mikud: true,
  },
  {
    criterion: 'זמינות',
    alone: '—',
    advisor: 'שעות עבודה',
    mikud: '24/7',
  },
];

function Cell({ value, highlight }) {
  if (value === true) {
    return (
      <Check
        className={`w-5 h-5 mx-auto ${highlight ? 'text-[#0153F4]' : 'text-green-600'}`}
        strokeWidth={3}
      />
    );
  }
  if (value === false) {
    return <X className="w-5 h-5 mx-auto text-red-400" strokeWidth={3} />;
  }
  if (value === 'partial') {
    return <Minus className="w-5 h-5 mx-auto text-amber-500" strokeWidth={3} />;
  }
  return (
    <span
      className={`block text-xs sm:text-sm leading-snug whitespace-pre-line ${
        highlight ? 'text-[#0C084A] font-black' : 'text-mist-600 font-bold'
      }`}
    >
      {value}
    </span>
  );
}

export default function AdvisorComparison() {
  const { price: reportPrice } = useReportPrice();
  // מזריקים את מחיר הדוח (שנקרא מהשרת) לשורת "עלות". עד שהמחיר נטען מציגים
  // מציין טעינה במקום מספר קשיח.
  const displayRows = rows.map((row) =>
    row.criterion === 'עלות'
      ? { ...row, mikud: reportPrice != null ? `₪${reportPrice.toLocaleString('he-IL')} בלבד` : '…' }
      : row
  );
  return (
    <div
      className="bg-mist-50 p-4 sm:p-6 md:p-8 rounded-3xl border border-mist-200 mb-6 sm:mb-10 text-right animate-in fade-in slide-in-from-bottom-4 duration-500"
      dir="rtl"
    >
      <p className="text-[10px] sm:text-xs font-bold tracking-[0.3em] uppercase text-[#0153F4] mb-2">
        למה מיקוד
      </p>
      <h3 className="text-lg sm:text-2xl md:text-3xl font-black text-[#0C084A] mb-5 sm:mb-7 leading-tight">
        3 דרכים לקחת משכנתא — רק אחת עובדת בשבילך
      </h3>

      {/* טבלת השוואה — גריד רספונסיבי (4 עמודות: קריטריון + 3 אפשרויות) */}
      <div className="overflow-hidden rounded-3xl border border-mist-200 bg-white">
        {/* כותרות */}
        <div className="grid grid-cols-[1.4fr_repeat(3,1fr)] sm:grid-cols-[2fr_repeat(3,1fr)]">
          <div className="p-2 sm:p-4" />
          {COLS.map((col) => (
            <div
              key={col.key}
              className={`p-2 sm:p-4 text-center flex flex-col items-center justify-center gap-1 ${
                col.highlight ? 'bg-[#0C084A]' : 'bg-mist-50'
              }`}
            >
              {col.highlight && (
                <Crown className="w-4 h-4 text-[#0153F4]" fill="#0153F4" />
              )}
              <span
                className={`text-[11px] sm:text-sm font-black leading-tight ${
                  col.highlight ? 'text-[#0153F4]' : 'text-mist-600'
                }`}
              >
                {col.label}
              </span>
            </div>
          ))}
        </div>

        {/* שורות */}
        {displayRows.map((row, i) => (
          <div
            key={i}
            className="grid grid-cols-[1.4fr_repeat(3,1fr)] sm:grid-cols-[2fr_repeat(3,1fr)] border-t border-mist-100"
          >
            <div className="p-2 sm:p-4 flex flex-col justify-center">
              <span className="text-xs sm:text-base font-bold text-[#0C084A] leading-snug">
                {row.criterion}
              </span>
              {row.hint && (
                <span className="text-[10px] sm:text-xs text-mist-600 font-medium leading-snug mt-0.5">
                  ({row.hint})
                </span>
              )}
            </div>
            {COLS.map((col) => (
              <div
                key={col.key}
                className={`p-2 sm:p-4 flex items-center justify-center text-center ${
                  col.highlight ? 'bg-periwinkle-100' : ''
                }`}
              >
                <Cell value={row[col.key]} highlight={col.highlight} />
              </div>
            ))}
          </div>
        ))}
      </div>

      <p className="mt-4 sm:mt-5 text-sm sm:text-base font-bold text-[#0C084A] text-center leading-relaxed">
        כל היתרונות של יועץ מקצועי — בשבריר מהמחיר, תוך דקות.
      </p>
    </div>
  );
}
