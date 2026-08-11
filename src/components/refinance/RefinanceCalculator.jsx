export default function RefinanceCalculator({ currentLoan }) {
  const hasLinkedTracks = currentLoan?.tracks?.some(track =>
    track.track_type?.toLowerCase().includes('צמוד') || track.track_type?.toLowerCase().includes('linked')
  );

  if (!hasLinkedTracks) return null;

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 sm:rounded-3xl sm:p-6">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 bg-amber-100 rounded-xl flex items-center justify-center flex-shrink-0">
          <span className="text-2xl">📈</span>
        </div>
        <div>
          <h4 className="font-bold text-amber-700 text-lg mb-2">
            ⚠️ השפעת המדד על התשלומים העתידיים
          </h4>
          <p className="text-sm text-mist-500 leading-relaxed mb-3">
            יש לך מסלולים צמודים למדד. תחזית המדד לשנים הבאות היא 2.5% שנתי, מה שאומר שהתשלום החודשי שלך
            <span className="font-bold text-mist-900"> יעלה בכל חודש</span>. המערכת כבר לקחה זאת בחשבון בחישוב החיסכון.
          </p>
          <div className="rounded-lg p-3 text-xs border border-amber-200 bg-white">
            <div className="flex justify-between mb-1">
              <span className="text-amber-700/80">תשלום היום:</span>
              <span className="font-bold text-mist-900">₪{currentLoan.monthlyPayment?.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-amber-700/80">תשלום משוער בעוד 10 שנים (עם מדד):</span>
              <span className="font-bold text-mist-900">
                ₪{Math.round(currentLoan.monthlyPayment * Math.pow(1.025, 10)).toLocaleString()}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
