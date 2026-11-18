import React, { useState } from 'react';
import { Mic, ShieldCheck, FileText } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';

export default function ConsentStep({ onAccept }) {
  const [agreeRecord, setAgreeRecord] = useState(false);
  const [agreeContact, setAgreeContact] = useState(false);
  const ready = agreeRecord && agreeContact;

  return (
    <div className="text-center animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-periwinkle-100 flex items-center justify-center">
        <Mic size={28} className="text-[#0153F4]" />
      </div>
      <h1 className="text-3xl sm:text-4xl font-extrabold text-[#0C084A] leading-tight tracking-tight">
        ספרו לנו בקול.<br /><span className="text-[#0153F4]">אנחנו נבנה את התיק.</span>
      </h1>
      <p className="text-mist-500 mt-4 max-w-xl mx-auto leading-relaxed">
        במקום להקליד — עונים בדיבור על שאלות השאלון, ומספרים במילים שלכם מה אתם צריכים ומה מטריד אתכם. אתם בודקים ומאשרים כל נתון לפני שהוא נכנס לתיק.
      </p>

      <div className="grid sm:grid-cols-3 gap-3 mt-10 text-right">
        {[
          { icon: Mic, t: 'מדברים', d: 'הקלטה לכל שאלה או שיחה חופשית מונחית' },
          { icon: ShieldCheck, t: 'מאשרים', d: 'שום נתון לא נחשב סופי לפני האישור שלכם' },
          { icon: FileText, t: 'מקבלים תיק', d: 'בדיקת היתכנות על פי הצהרה, מוכנה להמשך' },
        ].map(({ icon: Icon, t, d }) => (
          <div key={t} className="p-5 rounded-2xl border border-mist-100 bg-white">
            <Icon size={18} className="text-[#0153F4] mb-3" />
            <p className="font-bold text-[#0C084A] text-sm">{t}</p>
            <p className="text-mist-500 text-xs mt-1 leading-relaxed">{d}</p>
          </div>
        ))}
      </div>

      <div className="mt-8 space-y-3 text-right">
        <label className="flex items-start gap-3 p-3 rounded-xl bg-mist-50 border border-mist-100 cursor-pointer">
          <Checkbox checked={agreeRecord} onCheckedChange={(c) => setAgreeRecord(!!c)} className="mt-0.5" />
          <span className="text-xs text-mist-700 leading-relaxed">
            אני מסכים/ה שהדברים שאומר יוקלטו, יתומללו וינותחו באופן אוטומטי לצורך בניית התיק, ושההקלטות והתמלול יישמרו באופן מאובטח אצל מיקוד משכנתאות.
          </span>
        </label>
        <label className="flex items-start gap-3 p-3 rounded-xl bg-mist-50 border border-mist-100 cursor-pointer">
          <Checkbox checked={agreeContact} onCheckedChange={(c) => setAgreeContact(!!c)} className="mt-0.5" />
          <span className="text-xs text-mist-700 leading-relaxed">
            אני מאשר/ת ליועץ ממיקוד משכנתאות ליצור איתי קשר לצורך קידום התיק. ידוע לי שהתוצאה היא בדיקת היתכנות על פי הצהרתי בלבד ואינה אישור בנקאי.
          </span>
        </label>
      </div>

      <button
        onClick={onAccept}
        disabled={!ready}
        className="mt-8 h-12 px-14 rounded-full font-semibold text-base bg-[#0C084A] text-white hover:bg-[#0153F4] transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        מתחילים
      </button>
    </div>
  );
}