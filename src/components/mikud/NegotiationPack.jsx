import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageSquare, FileCheck, Target, Download, ChevronDown, ChevronUp, Mail, Loader2, Rocket, Copy, Check } from 'lucide-react';
import { appClient } from '@/api/appClient';

const formatCurrency = (val) => {
  if (!val || isNaN(val)) return "0";
  return new Intl.NumberFormat('he-IL').format(Math.floor(val));
};

const Section = ({ icon: Icon, title, children, defaultOpen = false }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-periwinkle-300 rounded-2xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className={`w-full flex items-center justify-between px-6 py-5 bg-periwinkle-100 transition-colors text-right ${open ? '' : 'hover:bg-white'}`}
      >
        <div className="flex items-center gap-3">
          <Icon className="w-5 h-5 text-[#0153F4] flex-shrink-0" />
          <span className="text-[14.4px] sm:text-[16.2px] font-medium text-[#0C084A]">{title}</span>
        </div>
        {open ? <ChevronUp className="w-5 h-5 text-mist-400" /> : <ChevronDown className="w-5 h-5 text-mist-400" />}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="px-6 pb-6 pt-2 bg-periwinkle-100">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default function NegotiationPack({ formData, results, selectedMix, fullName, borrowers = [] }) {
  const letterRef = useRef(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [scoreExplainOpen, setScoreExplainOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const isRefinance = formData.mortgageType === 'refinance';
  const displayLoanAmount = isRefinance ? results.balance : results.loanAmount;
  const displayLTV = isRefinance ? null : results.ltv;
  const displayDTI = isRefinance ? null : results.dti;

  const downloadLetter = () => {
    downloadFullPack();
  };

  const copyLetter = async () => {
    if (!letterRef.current) return;
    try {
      await navigator.clipboard.writeText(letterRef.current.innerText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Copy failed:', err);
    }
  };

  // כוח מיקוח = ציון מהמנוע המתקדם + בונוסים
  const powerScore = isRefinance
    ? Math.min(100, Math.max(0,
        (results.isWorthwhile ? 75 : 45) +
        (results.monthlySaving > 1000 ? 15 : results.monthlySaving > 500 ? 10 : 5) +
        (results.breakEvenMonths && results.breakEvenMonths < 18 ? 10 : results.breakEvenMonths < 30 ? 5 : 0)
      ))
    : Math.min(100, Math.max(0,
        (results.score || 70) +                                    // ציון מנוע מתקדם
        (borrowers.length > 1 ? 5 : 0) +                          // בונוס לווה נוסף
        (results.ltv < 60 ? 5 : 0) -                              // בונוס LTV נמוך
        (borrowers.some(b => b.creditHistory === 'issues') ? 15 : 0) // קנס אשראי
      ));

  const isReverse = formData.mortgageType === 'reverse_mortgage';
  const isSeniorBank = formData.mortgageType === 'senior_bank';

  // מיפוי כל סוגי ההכנסה מכל הלווים
  const allEmpTypes = borrowers.flatMap(b => b.employmentTypes || []);
  const hasEmployee = allEmpTypes.includes('employee');
  const hasSelfEmployed = allEmpTypes.some(t => ['self_employed', 'controlling_shareholder'].includes(t));
  const hasForeignIncome = allEmpTypes.includes('foreign_income');
  const hasPensioner = allEmpTypes.includes('pensioner');
  const hasMultipleBorrowers = borrowers.length > 1;

  // הכנסות נוספות (rent, national_insurance, disability, child_allowance)
  const extraIncomeSources = borrowers.flatMap(b => {
    const sources = b.incomeSources || {};
    return Object.entries(sources)
      .filter(([key, src]) => src?.enabled && ['rent','national_insurance','disability','child_allowance'].includes(key))
      .map(([key]) => key);
  });
  const hasRent = extraIncomeSources.includes('rent');
  const hasDisability = extraIncomeSources.includes('disability');
  const hasNationalInsurance = extraIncomeSources.includes('national_insurance');

  // האם יש לווה עם דירוג אשראי לא תקין
  const hasCreditIssues = borrowers.some(b => b.creditHistory === 'issues');

  // מסמכים מחולקים לפי קטגוריה
  const docGroups = [
    {
      title: 'מסמכי בסיס — חובה לכולם',
      color: 'border-periwinkle-300 bg-periwinkle-100',
      textColor: 'text-[#0C084A]',
      icon: '📋',
      docs: [
        'תעודת זהות + ספח מעודכן (לכל לווה)',
        'דפי עו"ש 3 חודשים אחרונים',
        'דוח נתוני אשראי BDI',
        isReverse || isSeniorBank ? 'נסח טאבו מעודכן' : 'נסח טאבו / נסח בית משותף מעודכן',
        isReverse || isSeniorBank ? 'אישור הסכמת יורשים (חתום)' : 'חוזה רכישה / הסכם מכר (אם קיים)',
        'שמאות נכס (תואם מוסד פיננסי)',
        ...(hasCreditIssues ? ['הסבר בכתב על עיכובי תשלום עבר + אסמכתאות סיום'] : []),
      ],
    },
    ...(hasEmployee ? [{
      title: 'שכיר/ה',
      color: 'border-brand-200 bg-brand-50',
      textColor: 'text-brand-700',
      icon: '👔',
      docs: [
        '3 תלושי שכר אחרונים',
      ],
    }] : []),
    ...(hasSelfEmployed ? [{
      title: 'עצמאי/ת / בעל שליטה',
      color: 'border-periwinkle-300 bg-periwinkle-50',
      textColor: 'text-periwinkle-700',
      icon: '💼',
      docs: [
        'שומות מס הכנסה 2 שנים אחרונות + אישור רו"ח',
        'דפי עו"ש עסקי 3 חודשים אחרונים',
      ],
    }] : []),
    ...(hasPensioner ? [{
      title: 'פנסיונר/ית',
      color: 'border-green-200 bg-green-50',
      textColor: 'text-green-700',
      icon: '🏦',
      docs: [
        'אישור קצבה/גמלה חודשית מקרן פנסיה / ביטוח לאומי',
        'אישור יתרת זכויות קרן פנסיה',
      ],
    }] : []),
    ...(hasForeignIncome ? [{
      title: 'הכנסה מחו"ל',
      color: 'border-orange-200 bg-orange-50',
      textColor: 'text-orange-700',
      icon: '🌍',
      docs: [
        'Pay Stubs / תלושי שכר + תרגום נוטריוני',
        'אישור ניכוי מס במקור (אם רלוונטי)',
      ],
    }] : []),
    ...((hasRent || hasDisability || hasNationalInsurance) ? [{
      title: 'הכנסות נוספות',
      color: 'border-amber-200 bg-amber-50',
      textColor: 'text-amber-700',
      icon: '➕',
      docs: [
        ...(hasRent ? ['חוזה שכירות פעיל + קבלות תשלום', 'אישור תשלום מס על הכנסה מדמי שכירות (אם רלוונטי)'] : []),
        ...(hasDisability ? ['אישור קצבת נכות מביטוח לאומי'] : []),
        ...(hasNationalInsurance ? ['אישור קצבה מביטוח לאומי'] : []),
      ],
    }] : []),
  ];

  const targetRate = selectedMix?.tracks?.[0]?.rate || 0.05;
  const displayName = fullName || formData.fullName || '';
  const today = new Date().toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' });

  const mortgageTypeLabel = {
    purchase_first: 'רכישת דירה ראשונה',
    purchase_improve: 'משפרי דיור / חליפית',
    purchase_additional: 'נכס נוסף / דירה להשקעה',
    any_purpose: 'כל מטרה',
    reverse_mortgage: 'משכנתא הפוכה',
    senior_bank: 'משכנתא לגיל הזהב',
    refinance: 'מחזור משכנתא',
  }[formData.mortgageType] || formData.mortgageType;

  const downloadFullPack = async () => {
    setPdfLoading(true);

    // Open the tab synchronously, inside the click gesture — if we open it only
    // after the awaited request below, the browser treats it as an unsolicited
    // popup and blocks it (win === null). Write a placeholder so it isn't blank
    // while the report is being generated.
    const win = window.open('', '_blank');
    if (win) {
      win.document.write('<!DOCTYPE html><html dir="rtl" lang="he"><head><meta charset="UTF-8"/><title>מכין דוח…</title></head><body style="font-family:Arial,sans-serif;text-align:center;padding-top:40vh;color:#1e3a5f;font-size:18px;">מכין את הדוח…</body></html>');
    }

    try {
      const response = await appClient.functions.invoke('generatePdfReport', {
        formData,
        results: { ...results, aiAnalysis: results.aiAnalysis },
        fullName: displayName,
        borrowers,
      });

      // response.data היא HTML string
      const html = response?.data;
      if (typeof html === 'string' && html.includes('<!DOCTYPE')) {
        if (win) {
          win.document.open();
          win.document.write(html);
          win.document.close();
          win.focus();
          // document.write doesn't reliably fire onload, so guard with a timeout.
          let printed = false;
          const doPrint = () => { if (!printed) { printed = true; win.print(); } };
          win.onload = doPrint;
          setTimeout(doPrint, 700);
        } else {
          // Popup blocked despite opening in-gesture — fall back to a file download
          // so the user still gets the kit instead of a silent failure.
          const blob = new Blob([html], { type: 'text/html' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'מיקוד-ערכת-משא-ומתן.html';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }
      } else {
        win?.close();
        alert('שגיאה בהכנת הדוח. אנא נסה שנית.');
      }
    } catch (err) {
      win?.close();
      console.error('PDF generation error:', err);
      alert('אירעה שגיאה בהכנת הדוח. אנא נסה שנית.');
    } finally {
      setPdfLoading(false);
    }
  };

  return (
    <div className="space-y-4">

      {/* כותרת */}
      <h2 className="text-2xl sm:text-3xl font-black text-[#0C084A] text-center py-2">ערכת המשא ומתן המקצועית</h2>
      <p className="text-sm sm:text-base text-mist-600 leading-relaxed text-center max-w-2xl mx-auto -mt-2 mb-2">
        {isRefinance
          ? `משא ומתן נכון הוא אחד הדברים הכי חשובים בתהליך המחזור. חיסכון של ₪${formatCurrency(results.totalSaving)} על פני ${results.remainingYears} שנים הוא בהחלט אפשרי. בדיוק בשביל זה הכנו לכם את ערכת המשא ומתן המקצועית שבעזרתה תוכלו להתמקח ולקבל את המשכנתא המשתלמת ביותר.`
          : `משא ומתן נכון הוא אחד הדברים הכי חשובים בתהליך קבלת המשכנתא. הורדה של 0.5% בלבד בריבית הנוכחית שווה לחיסכון של ₪${formatCurrency(displayLoanAmount * 0.12)} על פני ${results.actualDuration ?? formData.loanDuration} שנים. בדיוק בשביל זה הכנו לכם את ערכת המשא ומתן המקצועית שבעזרתה תוכלו להתמקח ולקבל את המשכנתא המשתלמת ביותר.`
        }
      </p>

      {/* מדד כוח מיקוח */}
      <Section icon={Target} title="מדד כוח המיקוח שלך" defaultOpen={true}>
        <div className="relative w-full mt-8 mb-6">
          <div className="relative w-full h-1.5 bg-mist-200 rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${powerScore}%` }}
              transition={{ duration: 1.4, ease: 'easeOut' }}
              className="relative h-full rounded-full overflow-hidden"
            >
              <div
                className="absolute inset-0 animate-flow-gradient"
                style={{
                  backgroundImage: 'linear-gradient(90deg, #ABC7FF, #8E97FF, #6774FF, #7DA6FF, #ABC7FF)',
                  backgroundSize: '300% 100%',
                }}
              />
            </motion.div>
          </div>
          <motion.div
            className="absolute top-1/2"
            initial={{ right: '0%' }}
            animate={{ right: `${powerScore}%` }}
            transition={{ duration: 1.4, ease: 'easeOut' }}
          >
            <div className="relative translate-x-1/2 -translate-y-1/2">
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 text-[#0153F4] text-sm font-black whitespace-nowrap">
                {powerScore}
              </div>
              <Rocket size={25} className="text-[#0153F4]" style={{ transform: 'rotate(-135deg)' }} />
            </div>
          </motion.div>
        </div>
        <div className="bg-brand-50 rounded-xl overflow-hidden">
          <button
            onClick={() => setScoreExplainOpen(o => !o)}
            className="w-full flex items-center justify-between p-4 text-right"
          >
            <span className="text-sm font-bold text-brand-800">איך חישבנו את הציון?</span>
            {scoreExplainOpen ? <ChevronUp className="w-4 h-4 text-brand-600" /> : <ChevronDown className="w-4 h-4 text-brand-600" />}
          </button>
          {scoreExplainOpen && (
            <div className="px-4 pb-4 text-sm text-mist-800 leading-relaxed">
              {isRefinance ? (
                <>המחזור צפוי לחסוך ₪{formatCurrency(results.monthlySaving)} לחודש
                {results.isWorthwhile ? ' — כדאי מאוד למחזר!' : ' — כדאיות מוגבלת, מומלץ להתייעץ.'}{' '}
                ריבית קיימת משוערת: {results.impliedRate?.toFixed(2)}%.</>
              ) : (
                <>יחס ההחזר שלך עומד על {results.dti?.toFixed(1) || '—'}%
                {results.dti < 35 ? ' — נמוך מהממוצע, נקודת עוצמה משמעותית.' : results.dti < 40 ? ' — בגבול הסביר.' : ' — גבוה, מומלץ לשפר לפני הגשה.'}
                {' '}אחוז המימון (LTV) עומד על {results.ltv?.toFixed(1) || '—'}%
                {results.ltv < 70 ? ', מה שמסמן השקעה עצמית גבוהה — יתרון בעיני הבנק.' : '.'}</>
              )}
            </div>
          )}
        </div>
      </Section>

      {/* מכתב לבנקאי */}
      <Section icon={Mail} title="מכתב פנייה מקצועי לבנק">
        <div className="mt-3 bg-white border border-mist-200 rounded-2xl overflow-hidden shadow-sm" dir="rtl">
          <div className="flex items-center justify-end gap-2 px-6 pt-5">
            <button
              onClick={copyLetter}
              className="flex items-center gap-2 border border-[#0153F4] text-[#0153F4] px-4 py-2 rounded-lg font-bold text-xs hover:bg-[#0153F4]/10 transition-all"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? 'הועתק!' : 'העתק'}
            </button>
            <button
              onClick={downloadLetter}
              disabled={pdfLoading}
              className="flex items-center gap-2 bg-[#0153F4] text-white px-4 py-2 rounded-lg font-bold text-xs hover:bg-[#4C82FF] transition-all disabled:opacity-60"
            >
              {pdfLoading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              {pdfLoading ? 'מכין דוח...' : 'הורד מכתב'}
            </button>
          </div>
          <div ref={letterRef} className="p-6 sm:p-8 text-sm text-black leading-8 space-y-4" style={{ fontFamily: 'Assistant, Arial, sans-serif' }}>
           <div className="text-left text-mist-600 text-xs font-semibold">{today}</div>

           <div className="space-y-1">
             <p className="font-bold text-black">לכבוד,</p>
             <p className="text-black">מנהל/ת תחום משכנתאות</p>
             <p className="text-black font-bold">[שם הבנק]</p>
           </div>

           <div className="py-2">
             <p className="font-bold text-black">הנדון: {isRefinance ? `בקשה למחזור משכנתא — ${displayName}` : `בקשה לאישור עקרוני למשכנתא — ${displayName}`}</p>
           </div>

           <p className="text-black font-semibold">שלום רב,</p>
           <p className="text-black">{isRefinance
             ? <>הריני לפנות אליכם בבקשה לקבל הצעה למחזור משכנתא עבור <strong>{displayName}</strong>, ביתרה של ₪{formatCurrency(results.balance)} בתנאים המפורטים להלן.</>
             : <>הריני לפנות אליכם בבקשה לקבל אישור עקרוני למשכנתא עבור <strong>{displayName}</strong>, בתנאים המפורטים להלן.</>
           }</p>

           <div className="rounded-xl p-4 space-y-2 border border-mist-300">
             <p className="font-bold text-black mb-3 text-sm">פרטי התיק</p>
              <div className="space-y-2 text-sm">
                <div className="flex gap-4"><span className="font-bold w-28 sm:w-40 shrink-0">1. שם לווה</span><span className="text-black">{displayName}</span></div>
                {isRefinance ? (
                  <>
                    <div className="flex gap-4"><span className="font-bold w-28 sm:w-40 shrink-0">2. יתרת משכנתא קיימת</span><span className="text-black">₪{formatCurrency(results.balance)}</span></div>
                    <div className="flex gap-4"><span className="font-bold w-28 sm:w-40 shrink-0">3. החזר חודשי נוכחי</span><span className="text-black">₪{formatCurrency(results.currentMonthly)}</span></div>
                    <div className="flex gap-4"><span className="font-bold w-28 sm:w-40 shrink-0">4. ריבית משוערת קיימת</span><span className="text-black">{results.impliedRate?.toFixed(2)}%</span></div>
                    <div className="flex gap-4"><span className="font-bold w-28 sm:w-40 shrink-0">5. שנים שנשארו</span><span className="text-black">{results.remainingYears} שנים</span></div>
                    <div className="flex gap-4"><span className="font-bold w-28 sm:w-40 shrink-0">6. חיסכון חודשי צפוי</span><span className="text-black font-semibold">₪{formatCurrency(results.monthlySaving)}</span></div>
                  </>
                ) : (
                   <>
                    {(() => {
                      const baseEquity = Number(String(formData.equity || 0).replace(/,/g, ''));
                      const completionAmount = Number(String(formData.completionAmount || 0).replace(/,/g, ''));
                      const totalEquity = baseEquity + completionAmount;
                      const completionSources = formData.completionSources || [];
                      const sourceLabels = {
                        balloon_existing: 'שעבוד נכס קיים',
                        sale_proceeds: 'תמורת מכירת נכס',
                        family_help: 'עזרה ממשפחה מדרגה ראשונה',
                        savings: 'פירוק חסכונות / קרן השתלמות',
                        securities: 'מימוש ניירות ערך',
                        provident: 'משיכת קופת גמל',
                        other: 'מקור אחר',
                      };
                      let itemNum = 2;
                      return (
                        <>
                          <div className="flex gap-4"><span className="font-bold w-28 sm:w-40 shrink-0">{itemNum++}. סכום מבוקש</span><span className="text-black">₪{formatCurrency(results.loanAmount)}</span></div>
                          <div className="flex gap-4"><span className="font-bold w-28 sm:w-40 shrink-0">{itemNum++}. שווי נכס</span><span className="text-black">₪{formatCurrency(Number(String(formData.propertyPrice || 0).replace(/,/g, '')))}</span></div>
                          <div className="flex gap-4"><span className="font-bold w-28 sm:w-40 shrink-0">{itemNum++}. הון עצמי נזיל</span><span className="text-black">₪{formatCurrency(baseEquity)}</span></div>
                          {completionAmount > 0 && (
                            <>
                              <div className="flex gap-4"><span className="font-bold w-28 sm:w-40 shrink-0">{itemNum++}. השלמת הון עצמי</span><span className="text-black">₪{formatCurrency(completionAmount)} ({completionSources.map(s => sourceLabels[s] || s).join(', ')})</span></div>
                              <div className="flex gap-4"><span className="font-bold w-28 sm:w-40 shrink-0">{itemNum++}. סה"כ הון עצמי</span><span className="text-black font-semibold">₪{formatCurrency(totalEquity)}</span></div>
                            </>
                          )}
                          <div className="flex gap-4"><span className="font-bold w-28 sm:w-40 shrink-0">{itemNum++}. אחוז מימון (LTV)</span><span className="text-black">{results.ltv?.toFixed(1)}% (תקרה: {formData.mortgageType === 'purchase_first' ? '75%' : formData.mortgageType === 'purchase_improve' ? '70%' : formData.mortgageType === 'purchase_additional' ? '50%' : formData.mortgageType === 'any_purpose' ? '50%' : '50%'})</span></div>
                          <div className="flex gap-4"><span className="font-bold w-28 sm:w-40 shrink-0">{itemNum++}. תקופת הלוואה</span><span className="text-black">{results.actualDuration ?? formData.loanDuration} שנים</span></div>
                          <div className="flex gap-4"><span className="font-bold w-28 sm:w-40 shrink-0">{itemNum++}. מטרת ההלוואה</span><span className="text-black">{{
                            purchase_first: 'רכישת דירה ראשונה',
                            purchase_improve: 'משפרי דיור / חליפית',
                            purchase_additional: 'נכס נוסף / דירה להשקעה',
                            any_purpose: 'כל מטרה',
                            reverse_mortgage: 'משכנתא הפוכה',
                            senior_bank: 'משכנתא לגיל הזהב',
                          }[formData.mortgageType] || formData.mortgageType}</span></div>
                        </>
                      );
                    })()}
                  </>
                )}
              </div>
            </div>

            <p className="text-black font-semibold mt-6">בקשת ריבית תחרותית</p>
            <p className="text-black">אבקש לקבל הצעת ריבית תחרותית בהתאם לפרופיל התיק ולנתוני השוק העדכניים. כל הצעה טובה תיבחן ברצינות.</p>

            <p className="text-black">אבקש לקבל הצעת ריבית עקרונית בכתב תוך <strong>5 ימי עסקים</strong>. אשמח לשלוח את מלוא מסמכי ההגשה בעקבות הצעתכם.</p>

            <div className="pt-6 border-t-2 border-mist-400 space-y-1">
              <p className="font-bold text-black">בכבוד רב,</p>
              <p className="text-black font-semibold mt-3">{displayName}</p>
              {formData.phone && <p className="text-black">טל׳: {formData.phone}</p>}
              {formData.email && <p className="text-black">דוא״ל: {formData.email}</p>}
            </div>
          </div>
        </div>
        <p className="text-xs text-mist-700 mt-3 font-medium">* מלאו את שם הבנק לפני השליחה. ניתן לשלוח לכמה בנקים במקביל.</p>
      </Section>

      {/* תסריט השיחה */}
      <Section icon={MessageSquare} title="תסריט השיחה מול הבנקאי">
        <div className="space-y-4 mt-3">

          <div className="bg-periwinkle-100 border border-periwinkle-300 rounded-xl p-4">
            <p className="font-semibold text-[#0C084A] text-sm mb-2">שלב 1 — פתיחה</p>
            <p className="text-mist-800 text-sm leading-relaxed italic">
              {isRefinance
                ? `"שלום, קוראים לי ${displayName || '[שם]'}. יש לי משכנתא קיימת ביתרה של ₪${formatCurrency(results.balance)} עם ${results.remainingYears} שנים שנותרו. הריבית הנוכחית שלי עומדת על ${results.impliedRate?.toFixed(2)}% ואני בוחן אפשרות למחזור לתנאים טובים יותר. אשמח לשמוע מה הבנק שלכם יכול להציע."`
                : `"שלום, קוראים לי ${displayName || '[שם]'}. אני פונה אליכם בבקשה לאישור עקרוני למשכנתא בסך ₪${formatCurrency(results.loanAmount)} על רכישת נכס בשווי ₪${formatCurrency(Number(String(formData.propertyPrice || 0).replace(/,/g, '')))}. יחס המימון עומד על ${results.ltv?.toFixed(1)}% ויחס ההחזר שלי מתחת ל-${Math.ceil((results.dti || 20) / 5) * 5}%. פניתי למספר בנקים — אשמח לשמוע את הצעתכם."`
              }
            </p>
          </div>

          <div className="bg-periwinkle-100 border border-periwinkle-300 rounded-xl p-4">
            <p className="font-semibold text-[#0C084A] text-sm mb-2">שלב 2 — בניית אמינות</p>
            <p className="text-mist-800 text-sm leading-relaxed italic">
              "אני פועל בליווי יועץ משכנתאות מקצועי ויש לי את כל המסמכים מוכנים להגשה מיידית.
              התיק שלי מוכן ומסודר — מה שמקצר משמעותית את זמן האישור."
            </p>
          </div>

          <div className="bg-periwinkle-100 border border-brand-300 rounded-xl p-4">
            <p className="font-semibold text-[#0153F4] text-sm mb-2">שלב 3 — בקשת הצעה</p>
            <p className="text-mist-800 text-sm leading-relaxed italic">
              "על בסיס נתוני התיק שלי ונתוני השוק העדכניים, אבקש לקבל את הצעת הריבית הטובה ביותר שאתם יכולים להציע.
              אני מקבל מספר הצעות ואבחר את המשתלמת ביותר."
            </p>
          </div>

          <div className="bg-red-50 border border-red-300 rounded-xl p-4">
            <p className="font-semibold text-red-700 text-sm mb-2">שלב 4 — טיפול בהתנגדות</p>
            <p className="text-sm text-mist-600 mb-2">אם הבנקאי אומר <span className="font-semibold text-red-600">"הריבית שלנו גבוהה יותר"</span>:</p>
            <p className="text-mist-800 text-sm leading-relaxed italic">
              "אני מעריך את הכנות. אני מכיר את נתוני השוק ואת ממוצעי הריבית לתיקים בפרופיל שלי.
              אשמח אם תבדקו שוב — תיקים עם נתונים כמו שלי מקבלים בדרך כלל תנאים טובים יותר."
            </p>
          </div>

          <div className="bg-green-50 border border-green-300 rounded-xl p-4">
            <p className="font-semibold text-green-700 text-sm mb-2">שלב 5 — סגירה</p>
            <p className="text-mist-800 text-sm leading-relaxed italic">
              "אשמח לקבל את הצעתכם בכתב תוך יומיים. אני נמצא בתהליך עם מספר בנקים ואקבל החלטה עד סוף השבוע."
            </p>
          </div>

        </div>
      </Section>

      {/* רשימת מסמכים */}
      <Section icon={FileCheck} title="רשימת מסמכים להגשה">
        <div className="space-y-4 mt-3">
          {docGroups.map((group, gIdx) => (
            <div key={gIdx} className={`rounded-xl border p-4 ${group.color}`}>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-base">{group.icon}</span>
                <span className={`font-semibold text-sm ${group.textColor}`}>{group.title}</span>
              </div>
              <div className="space-y-2">
                {group.docs.map((doc, dIdx) => (
                  <div key={dIdx} className="flex items-start gap-2.5">
                    <Check size={15} className={`flex-shrink-0 mt-0.5 ${group.textColor}`} />
                    <p className="text-sm text-mist-800 leading-snug">{doc}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 p-4 bg-amber-50 border border-amber-200 rounded-xl">
          <p className="text-sm text-mist-800 leading-relaxed">
            <strong>טיפ מקצועי:</strong> הכן תיק PDF מסודר עם שם קובץ ברור לכל מסמך (לדוגמה: "תלושים_ינואר2026.pdf"). תיק מסודר מקצר את זמן האישור ומשדר אמינות.
          </p>
        </div>
      </Section>

      {/* כפתור הורדת PDF */}
      <div className="text-center">
        <button
          onClick={downloadFullPack}
          disabled={pdfLoading}
          className="bg-gradient-to-r from-[#0153F4] to-[#4C82FF] text-[#0C084A] px-8 py-4 rounded-2xl font-black text-base shadow-xl hover:scale-105 active:scale-95 transition-all flex items-center gap-3 mx-auto disabled:opacity-60 disabled:scale-100"
        >
          {pdfLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
          {pdfLoading ? 'מכין את הדוח...' : 'הורד ערכת משא ומתן (PDF)'}
        </button>
        <p className="text-xs text-mist-400 mt-2">דוח PDF בעברית — מכתב לבנק, תמהילים ורשימת מסמכים</p>
      </div>
    </div>
  );
}
