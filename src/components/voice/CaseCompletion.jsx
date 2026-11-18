import React from 'react';
import { Loader2, CreditCard, PenLine, CheckCircle2, Clock } from 'lucide-react';
import CardComPaymentModal from '@/components/payment/CardComPaymentModal';
import { useCardComPayment } from '@/hooks/useCardComPayment';
import { useReportPrice } from '@/hooks/useReportPrice';

// תשלום (CardCom הקיים) וחתימה. החתימה הדיגיטלית ממתינה לבחירת ספק — לא מסומנת כהושלמה.
export default function CaseCompletion({ leadId, isPurchased, onPaid }) {
  const { price } = useReportPrice();
  const { paymentLoading, paymentNotice, paymentUrl, handlePurchaseClick, handlePaymentModalClose } =
    useCardComPayment({ leadId, onPaid });

  return (
    <div className="grid sm:grid-cols-2 gap-4">
      <CardComPaymentModal paymentUrl={paymentUrl} onClose={handlePaymentModalClose} />

      <div className={`rounded-3xl p-6 border ${isPurchased ? 'border-green-200 bg-green-50' : 'border-mist-100 bg-white'}`}>
        <div className="flex items-center gap-2 mb-2">
          {isPurchased ? <CheckCircle2 size={18} className="text-green-600" /> : <CreditCard size={18} className="text-[#0153F4]" />}
          <p className="font-black text-[#0C084A]">1. תשלום</p>
        </div>
        {isPurchased ? (
          <p className="text-sm text-green-700">התשלום התקבל ואומת. התמהילים המלאים פתוחים למטה.</p>
        ) : (
          <>
            <p className="text-sm text-mist-600 mb-4">פתיחת התיק המלא: תמהילים, ריביות והחזרים מדויקים.</p>
            <button
              onClick={handlePurchaseClick}
              disabled={paymentLoading || price == null}
              className="h-11 px-6 rounded-full bg-[#0C084A] text-white text-sm font-bold hover:bg-[#0153F4] transition-all disabled:opacity-50 flex items-center gap-2"
            >
              {(paymentLoading || price == null) && <Loader2 size={15} className="animate-spin" />}
              לתשלום{price != null ? ` ₪${price.toLocaleString('he-IL')}` : ''}
            </button>
            {paymentNotice && <p className="text-xs text-[#0C084A] font-bold mt-2">{paymentNotice}</p>}
          </>
        )}
      </div>

      <div className="rounded-3xl p-6 border border-mist-100 bg-white">
        <div className="flex items-center gap-2 mb-2">
          <PenLine size={18} className="text-[#0153F4]" />
          <p className="font-black text-[#0C084A]">2. חתימה על הסכם</p>
        </div>
        <p className="text-sm text-mist-600 mb-4">החתימה הדיגיטלית תתווסף בקרוב. בינתיים יועץ ממיקוד ישלח לכם את ההסכם לחתימה.</p>
        <span className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full bg-mist-100 text-mist-600">
          <Clock size={13} /> ממתין לחיבור ספק חתימה
        </span>
      </div>
    </div>
  );
}