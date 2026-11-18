import React from 'react';
import { CheckCircle2 } from 'lucide-react';
import Amount from '@/components/mikud/Amount';
import MixComparison from '@/components/mikud/MixComparison';
import StoryInsights from './StoryInsights';
import CaseCompletion from './CaseCompletion';

export default function CaseStep({ results, firstName, story, leadId, isPurchased, onPaid }) {
  return (
    <div className="animate-in fade-in zoom-in-95 duration-700 space-y-6">
      <div className="text-center">
        <CheckCircle2 size={40} className="text-[#0153F4] mx-auto mb-3" />
        <h1 className="text-2xl sm:text-3xl font-extrabold text-[#0C084A]">{firstName ? `${firstName}, ` : ''}התיק שלכם נבנה</h1>
        <p className="text-mist-500 text-sm mt-2">התיק נשמר והועבר לצוות מיקוד משכנתאות להמשך טיפול.</p>
      </div>

      <div className="rounded-3xl bg-periwinkle-100 p-6 sm:p-8">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
          {[
            { l: 'ציון כשירות', v: `${results.score}/100` },
            { l: 'משכנתא לבדיקה', v: <Amount value={results.loanAmount} /> },
            { l: 'אחוז מימון', v: `${(results.ltv || 0).toFixed(1)}%` },
            { l: 'יחס החזר', v: `${(results.dti || 0).toFixed(1)}%` },
          ].map(x => (
            <div key={x.l} className="bg-white/70 rounded-xl p-3">
              <p className="text-[11px] text-mist-500 font-semibold">{x.l}</p>
              <p className="text-lg sm:text-xl font-semibold text-[#0C084A] mt-1">{x.v}</p>
            </div>
          ))}
        </div>
        {results.status?.action && <p className="text-sm text-[#0C084A] mt-4"><strong>המלצת מיקוד:</strong> {results.status.action}</p>}
      </div>

      <StoryInsights story={story} />

      <CaseCompletion leadId={leadId} isPurchased={isPurchased} onPaid={onPaid} />

      <div className={`transition-all duration-1000 ${!isPurchased ? 'opacity-60 pointer-events-none select-none blur-md' : ''}`}>
        <MixComparison
          mixA={results.mixA} mixB={results.mixB} mixC={results.mixC} cpiMix={results.cpiMix}
          loanAmount={results.loanAmount} durationYears={results.actualDuration}
          isPurchased={isPurchased} isDeclarationApprovalPossible={results.isDeclarationApprovalPossible}
          minMix={results.minMix} totalIncome={results.totalIncome}
        />
      </div>

      <p className="text-[11px] text-mist-400 text-center leading-relaxed">
        * מסמך זה הוא בדיקת היתכנות על פי הצהרת הלקוח בלבד, ואינו אישור בנקאי או התחייבות למתן הלוואה.
      </p>
    </div>
  );
}