import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  uploadFileToStorage, isSupabaseConfigured
} from '@/components/refinance/supabaseClient';
import { analyzeRefinanceDocument } from '@/components/refinance/analysisClient';
import { refinanceLeads } from '@/api/refinanceLeads';
import { calculateRefinanceMixes } from '@/api/refinanceMixes';
import {
  canRestoreRefinanceMixes,
  getRefinanceMixPresentation,
} from '@/utils/refinanceMixState';
import {
  Upload, Loader2, DollarSign,
  CheckCircle, AlertCircle, TrendingUp, X, ChevronDown, ChevronUp, ChevronLeft, Download, Sparkle, Info
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverTrigger, PopoverContent, PopoverClose } from '@/components/ui/popover';
import RefinanceCalculator from '@/components/refinance/RefinanceCalculator';
import BalloonTrapAlert from '@/components/refinance/BalloonTrapAlert';
import ExecutiveSummary from '@/components/refinance/ExecutiveSummary';
import MortgageChatbot from '@/components/refinance/MortgageChatbot';
import FooterCTA from '@/components/mikud/FooterCTA';
import PremiumInput from '@/components/mikud/PremiumInput';
import MikudHeader from '@/components/mikud/MikudHeader';
import ProfessionalAnalysis from '@/components/mikud/ProfessionalAnalysis';
import MixComparison, { SavingsAnnotation } from '@/components/mikud/MixComparison';
import { isValidIsraeliID, isValidEmail, isValidIsraeliPhone } from '@/components/refinance/validators';
import CardComPaymentModal from '@/components/payment/CardComPaymentModal';
import { useCardComPayment } from '@/hooks/useCardComPayment';
import { PAYMENT_BYPASS_ENABLED } from '@/lib/demoMode';
import { Checkbox } from '@/components/ui/checkbox';
import { createPageUrl } from '@/utils';

// מקור אמת יחיד למספרי הליבה שחוזרים על עצמם בכמה מקומות בדוח (חיסכון נטו, החזר חדש, ריבית חדשה וכו')
function buildHeadline(analysisResult) {
  const { currentLoan, savings } = analysisResult;
  const era = savings?.equityReleaseAnalysis;
  const useEquityRelease = !!era; // תיק איחוד חובות: המספרים המשולבים הם מה שתג סוג התיק כבר מבטיח למשתמש

  return {
    currentMonthlyPayment: currentLoan?.monthlyPayment,
    currentAverageRate: currentLoan?.averageInterestRate,
    newMonthlyPayment: useEquityRelease ? era.newMonthlyPayment : savings?.newMonthlyPayment,
    newAverageRate: useEquityRelease ? era.allPurposeRate : savings?.newAverageRate,
    monthlySavings: useEquityRelease ? era.monthlyCashFlowImprovement : savings?.monthlySavings,
    netSavings: savings?.netSavings,
    isWorthwhile: savings?.isWorthwhile,
    breakEvenMonths: savings?.breakEvenMonths
  };
}

const LOW_RISK_LEVELS = new Set(['conservative', 'low']);
const BALANCED_RISK_LEVELS = new Set(['balanced', 'medium']);
const HIGH_RISK_LEVELS = new Set(['aggressive', 'high']);

function calculateTrackMonthlyPayment(track, mixMonthlyPayment) {
  const explicitPayment = Number(track?.monthly_payment ?? track?.monthlyPayment);
  if (Number.isFinite(explicitPayment) && explicitPayment >= 0) return explicitPayment;

  const years = Number(track?.period_years);
  const months = years * 12;
  const percentage = Number(track?.percentage);
  const amount = Number(track?.amount);
  const fallbackPayment = Number.isFinite(percentage) && Number.isFinite(Number(mixMonthlyPayment))
    ? Number(mixMonthlyPayment) * percentage / 100
    : 0;

  if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(months) || months <= 0) {
    return fallbackPayment;
  }

  const rawRate = Number(track?.interest_rate);
  if (!Number.isFinite(rawRate) || rawRate === 0) return amount / months;

  const annualRate = Math.abs(rawRate) > 1 ? rawRate / 100 : rawRate;
  const monthlyRate = annualRate / 12;
  const growth = Math.pow(1 + monthlyRate, months);
  const payment = amount * monthlyRate * growth / (growth - 1);

  return Number.isFinite(payment) ? payment : fallbackPayment;
}

function normalizeTrackRate(rate) {
  const numericRate = Number(rate);
  if (!Number.isFinite(numericRate)) return 0;
  return Math.abs(numericRate) > 1 ? numericRate / 100 : numericRate;
}

function buildTrackDescription(track) {
  const details = [];
  const percentage = Number(track?.percentage);
  const amount = Number(track?.amount);

  if (Number.isFinite(percentage)) details.push(`${percentage}% מהסכום`);
  if (Number.isFinite(amount) && amount > 0) {
    details.push(`₪${Math.round(amount).toLocaleString('he-IL')}`);
  }

  return details.join(' · ');
}

function chooseRefinanceMixes(mixes) {
  const sortedMixes = (mixes || [])
    .filter(Boolean)
    .slice()
    .sort((a, b) => Number(a.mix_number || 0) - Number(b.mix_number || 0));

  if (sortedMixes.length <= 3) return sortedMixes;

  const recommended = sortedMixes.find((mix) => Number(mix.mix_number) === 2)
    || sortedMixes.find((mix) => BALANCED_RISK_LEVELS.has(mix.risk_level))
    || sortedMixes[0];
  const selected = [recommended];
  const addFirstMatch = (predicate) => {
    const match = sortedMixes.find((mix) => !selected.includes(mix) && predicate(mix));
    if (match) selected.push(match);
  };

  addFirstMatch((mix) => LOW_RISK_LEVELS.has(mix.risk_level));
  addFirstMatch((mix) => HIGH_RISK_LEVELS.has(mix.risk_level));

  sortedMixes.forEach((mix) => {
    if (selected.length < 3 && !selected.includes(mix)) selected.push(mix);
  });

  return selected.slice(0, 3);
}

function buildRefinanceMixCards(mixes) {
  const selectedMixes = chooseRefinanceMixes(mixes);
  const recommended = selectedMixes.find((mix) => Number(mix.mix_number) === 2)
    || selectedMixes.find((mix) => BALANCED_RISK_LEVELS.has(mix.risk_level))
    || selectedMixes[0];
  const orderedMixes = selectedMixes
    .slice()
    .sort((a, b) => Number(a.mix_number || 0) - Number(b.mix_number || 0));
  const recommendedIndex = orderedMixes.indexOf(recommended);

  return orderedMixes
    .map((mix, index) => {
      const isRecommended = mix === recommended;
      const mixType = isRecommended
        ? 'recommended'
        : LOW_RISK_LEVELS.has(mix.risk_level)
          ? 'conservative'
          : HIGH_RISK_LEVELS.has(mix.risk_level)
            ? 'prime'
            : index < recommendedIndex ? 'conservative' : 'prime';
      const durationYears = Number(mix.tracks?.[0]?.period_years)
        || Math.round(
          (mix.tracks || []).reduce(
            (sum, track) => sum + Number(track.period_years || 0) * Number(track.percentage || 0),
            0
          ) / 100
        )
        || 20;

      return {
        id: mix.mix_number ?? `${mix.mix_name}-${index}`,
        title: mix.mix_name,
        mixType,
        totalPmt: Number(mix.total_monthly_payment) || 0,
        durationYears,
        monthlySaving: mix.monthly_savings,
        totalSaving: mix.net_savings,
        tracks: (mix.tracks || []).map((track) => ({
          name: track.track_type,
          desc: buildTrackDescription(track),
          rate: normalizeTrackRate(track.interest_rate),
          years: Number(track.period_years) || durationYears,
          pmt: calculateTrackMonthlyPayment(track, mix.total_monthly_payment),
        })),
        isValid: mix.is_valid !== false,
      };
    });
}

const REFINANCE_OUTCOME = {
  DOCUMENT_INVALID: 'document_invalid',
  FINANCIAL_INELIGIBLE: 'financial_ineligible',
  ELIGIBLE: 'eligible',
};

function getRefinanceOutcome(analysisResult, ignoreDocumentValidity) {
  if (!analysisResult) return null;

  if (analysisResult.statementDateWarning && !ignoreDocumentValidity) {
    return REFINANCE_OUTCOME.DOCUMENT_INVALID;
  }

  // The analyzer will populate this when financial-eligibility rules are added.
  // Keep the UI path ready without inferring an eligibility decision today.
  if (analysisResult.eligibility?.status === REFINANCE_OUTCOME.FINANCIAL_INELIGIBLE) {
    return REFINANCE_OUTCOME.FINANCIAL_INELIGIBLE;
  }

  return REFINANCE_OUTCOME.ELIGIBLE;
}

// שם שחולץ ממסמך עשוי לכלול ניקוד/רווחים כפולים/סדר מילים שונה מהשם שהוזן
// בטופס. משווים לפי קבוצת המילים ולא לפי שוויון מדויק כדי לא לתפוס הבדלי
// פורמט כאילו זה מסמך של אדם אחר.
function normalizeNameForComparison(name) {
  return String(name || '')
    .trim()
    .replace(/[֑-ׇ]/g, '') // ניקוד/טעמים
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function borrowerNameMatchesContact(borrowersNames, contactName) {
  const expectedTokens = normalizeNameForComparison(contactName).split(' ').filter(Boolean);
  if (expectedTokens.length === 0) return true;
  return (borrowersNames || []).some((name) => {
    const nameTokens = new Set(normalizeNameForComparison(name).split(' ').filter(Boolean));
    return expectedTokens.every((token) => nameTokens.has(token));
  });
}

function EffectiveRateInfo() {
  return (
    <Popover>
      <PopoverTrigger
        type="button"
        onClick={(e) => e.stopPropagation()}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full text-mist-400 hover:text-[#0153F4] focus:outline-none"
        aria-label="מהי ריבית אפקטיבית"
      >
        <Info className="h-3.5 w-3.5" />
      </PopoverTrigger>
      <PopoverContent
        align="center"
        sideOffset={8}
        className="z-[60] w-72 rounded-xl border border-mist-200 bg-white p-3 text-right shadow-lg"
      >
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs leading-relaxed text-mist-700">
            הריבית האפקטיבית משקפת את העלות השנתית האמיתית של ההלוואה, כולל השפעת ריבית-דריבית לאורך זמן — בעוד הריבית הנומינלית אינה כוללת זאת. במסלולים צמודי מדד היא כוללת גם תוספת של מדד שנתי משוער (2.5%) מעבר לריבית הנקובה, ולכן גבוהה ממנה; במסלולים לא צמודים הריבית האפקטיבית שווה לריבית הנומינלית.
          </p>
          <PopoverClose
            className="flex-shrink-0 rounded-full p-0.5 text-mist-400 hover:text-mist-700 focus:outline-none"
            aria-label="סגור"
          >
            <X className="h-3.5 w-3.5" />
          </PopoverClose>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function CelebratingSavingsAmount({ value }) {
  const isPositive = value >= 0;

  return (
    <div className="relative inline-flex items-center justify-center leading-none">
      <span className={`text-3xl font-black leading-none ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
        {isPositive ? '' : '-'}₪{Math.abs(value || 0).toLocaleString()}
      </span>
    </div>
  );
}

export default function RefinanceQuickCheck() {
  const [files, setFiles] = useState([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [error, setError] = useState(null);
  const transactionType = 'refinance';
  const [progress, setProgress] = useState(0);
  const [showAdvancedAnalysis, setShowAdvancedAnalysis] = useState(false);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);
  const [pdfTrigger, setPdfTrigger] = useState(0);
  const [hasExtraDebts, setHasExtraDebts] = useState(null); // null=לא נבחר, true/false
  const [extraDebts, setExtraDebts] = useState([{ creditor: '', monthly_repayment: '', remaining_balance: '', estimated_interest: 15 }]);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [demoDocumentOverride, setDemoDocumentOverride] = useState(false);
  // כשמשתמש חוזר להעלות מסמך עדכני (אחרי דחיית המסמך הקודם), יש לוודא שהשם
  // שחולץ מהמסמך החדש תואם לשם שמילא בטופס הפרטים המקורי — כדי לתפוס העלאה
  // בטעות של מסמך של אדם אחר. לא נבדק בהעלאה הראשונה, רק בחזרה דרך הכפתור הזה.
  const [verifyBorrowerName, setVerifyBorrowerName] = useState(false);
  const [strategyMixes, setStrategyMixes] = useState([]);
  const [isCalculatingMixes, setIsCalculatingMixes] = useState(false);
  const [mixCalculationError, setMixCalculationError] = useState('');

  // פרטי קשר — נאספים לפני העלאת המסמך ונשמרים כליד
  const [leadId, setLeadId] = useState(null);
  const [tier, setTier] = useState('free');
  const [isPurchased, setIsPurchased] = useState(false);
  const [isResumingLead, setIsResumingLead] = useState(true);
  const [contactFullName, setContactFullName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactIdNumber, setContactIdNumber] = useState('');
  const [contactConsent, setContactConsent] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [contactErrors, setContactErrors] = useState({});
  const [contactTouched, setContactTouched] = useState({});
  const [isSubmittingContact, setIsSubmittingContact] = useState(false);
  const markContactTouched = (field) => setContactTouched(t => ({ ...t, [field]: true }));

  // These details are collected in their own step before the document upload.
  // Keep the values as strings while editing so PremiumInput can apply its
  // existing currency formatting without losing an in-progress value.
  const [monthlyIncome, setMonthlyIncome] = useState('');
  const [propertyPurchasePrice, setPropertyPurchasePrice] = useState('');
  const [estimatedCurrentPropertyValue, setEstimatedCurrentPropertyValue] = useState('');
  const [financialDetailsTouched, setFinancialDetailsTouched] = useState({});
  const [financialDetailsError, setFinancialDetailsError] = useState('');
  const [isSubmittingFinancialDetails, setIsSubmittingFinancialDetails] = useState(false);
  const [hasFinancialDetails, setHasFinancialDetails] = useState(false);

  useEffect(() => {
    document.title = 'בדיקת מחזור משכנתא | מיקוד';
  }, []);

  // שחזור ליד קיים לפי ?lead= בכתובת (למשל אחרי רענון דף)
  useEffect(() => {
    if (!isSupabaseConfigured) { setIsResumingLead(false); return; }
    const id = new URLSearchParams(window.location.search).get('lead');
    if (!id) { setIsResumingLead(false); return; }

    (async () => {
      try {
        const lead = await refinanceLeads.get(id);
        if (!lead) return;
        setLeadId(lead.id);
        setTier(lead.tier || 'free');
        setIsPurchased(lead.tier === 'paid');
        setContactFullName(lead.full_name || '');
        setContactEmail(lead.email || '');
        setContactPhone(lead.phone || '');
        setContactIdNumber(lead.id_number || '');
        setContactConsent(Boolean(lead.contact_consent));
        setTermsAccepted(Boolean(lead.terms_accepted));
        setMonthlyIncome(lead.monthly_income?.toString() || '');
        setPropertyPurchasePrice(lead.property_purchase_price?.toString() || '');
        setEstimatedCurrentPropertyValue(lead.estimated_current_property_value?.toString() || '');
        setHasFinancialDetails(
          Number(lead.monthly_income) > 0 && Number(lead.property_purchase_price) > 0
        );
        if (lead.status === 'analyzed' && lead.analysis_result) {
          setAnalysisResult({ ...lead.analysis_result, mixes: [], file_url: lead.file_url });
          if (canRestoreRefinanceMixes(lead.has_mix_calculation_context, lead.has_cached_mixes)) {
            try {
              const cachedResult = await calculateRefinanceMixes(lead.id);
              setStrategyMixes(cachedResult?.mixes || []);
            } catch (mixError) {
              console.error('Failed to restore refinance strategy mixes:', mixError);
            }
          }
        }
      } catch (err) {
        console.error('Failed to resume lead from URL:', err);
      } finally {
        setIsResumingLead(false);
      }
    })();
  }, []);

  const headline = useMemo(
    () => analysisResult ? buildHeadline(analysisResult) : null,
    [analysisResult]
  );
  const refinanceMixes = useMemo(
    () => buildRefinanceMixCards(strategyMixes),
    [strategyMixes]
  );
  const mixPresentation = useMemo(
    () => getRefinanceMixPresentation(strategyMixes, isPurchased),
    [strategyMixes, isPurchased]
  );
  const reportAnalysisResult = useMemo(() => (
    analysisResult
      ? { ...analysisResult, mixes: mixPresentation.reportMixes }
      : null
  ), [analysisResult, mixPresentation.reportMixes]);
  const refinanceOutcome = useMemo(
    () => getRefinanceOutcome(analysisResult, demoDocumentOverride),
    [analysisResult, demoDocumentOverride]
  );

  useEffect(() => {
    if (!isAnalyzing) { setProgress(0); return; }
    setProgress(10);
    // Paced for the real 60-120s range the analyzer can take (per-call
    // Gemini timeout is 120s) rather than the old ~20-40s assumption -
    // otherwise the bar would sit stalled at 88% for up to another 100s.
    const t1 = setTimeout(() => setProgress(30), 8000);
    const t2 = setTimeout(() => setProgress(55), 25000);
    const t3 = setTimeout(() => setProgress(75), 55000);
    const t4 = setTimeout(() => setProgress(90), 95000);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(t4); };
  }, [isAnalyzing]);


  const getContactErrors = () => {
    const errors = {};
    if (!contactFullName.trim() || contactFullName.trim().length < 2) errors.fullName = 'אנא הזן שם מלא';
    if (!isValidEmail(contactEmail)) errors.email = 'כתובת אימייל לא תקינה';
    if (!isValidIsraeliPhone(contactPhone)) errors.phone = 'מספר טלפון לא תקין';
    if (!isValidIsraeliID(contactIdNumber)) errors.idNumber = 'תעודת זהות לא תקינה';
    if (!contactConsent) errors.contactConsent = 'חובה לאשר יצירת קשר';
    if (!termsAccepted) errors.termsAccepted = 'חובה לאשר את תנאי השימוש ומדיניות הפרטיות';
    return errors;
  };

  const liveContactErrors = useMemo(
    () => getContactErrors(),
    [contactFullName, contactEmail, contactPhone, contactIdNumber, contactConsent, termsAccepted]
  );
  const isContactFormValid = Object.keys(liveContactErrors).length === 0;

  const handleContactSubmit = async () => {
    const errors = getContactErrors();

    if (Object.keys(errors).length > 0) {
      setContactTouched({ fullName: true, idNumber: true, phone: true, email: true, contactConsent: true, termsAccepted: true });
      return;
    }

    setContactErrors({});
    setIsSubmittingContact(true);
    try {
      const lead = await refinanceLeads.create({
          full_name: contactFullName.trim(),
          email: contactEmail.trim(),
          phone: contactPhone.trim(),
          id_number: contactIdNumber.trim(),
          contact_consent: contactConsent,
          terms_accepted: termsAccepted,
          terms_accepted_at: new Date().toISOString()
        });
      setLeadId(lead.id);
      setHasFinancialDetails(false);
      const url = new URL(window.location.href);
      url.searchParams.set('lead', lead.id);
      window.history.replaceState(null, '', url);
    } catch (err) {
      console.error('Failed to save contact details:', err);
      setContactErrors({ submit: 'שגיאה בשמירת הפרטים. נסה שוב.' });
    } finally {
      setIsSubmittingContact(false);
    }
  };

  const updateLead = async (data) => {
    if (!leadId) return;
    try {
      await refinanceLeads.update(leadId, data);
    } catch (err) {
      console.error('Failed to update lead record:', err);
    }
  };

  const getFinancialDetailsErrors = () => {
    const errors = {};
    if (Number(monthlyIncome) <= 0) errors.monthlyIncome = 'יש להזין הכנסה חודשית נטו גדולה מאפס';
    if (Number(propertyPurchasePrice) <= 0) errors.propertyPurchasePrice = 'יש להזין את מחיר הרכישה המקורי של הנכס';
    if (estimatedCurrentPropertyValue && Number(estimatedCurrentPropertyValue) <= 0) {
      errors.estimatedCurrentPropertyValue = 'אם מזינים שווי נוכחי, הוא חייב להיות גדול מאפס';
    }
    return errors;
  };

  const financialDetailsErrors = useMemo(
    () => getFinancialDetailsErrors(),
    [monthlyIncome, propertyPurchasePrice, estimatedCurrentPropertyValue]
  );
  const {
    paymentLoading,
    paymentNotice,
    paymentUrl,
    handlePurchaseClick,
    handlePaymentModalClose,
  } = useCardComPayment({
    leadId,
    leadType: 'refinance',
    onPaid: () => {
      setTier('paid');
      setIsPurchased(true);
    },
  });

  const handlePaymentBypass = () => {
    setTier('paid');
    setIsPurchased(true);
  };
  const handleCalculateMixes = async () => {
    if (!leadId) {
      setMixCalculationError('לא הצלחנו לזהות את הבקשה. נסו לרענן את העמוד.');
      return;
    }

    setIsCalculatingMixes(true);
    setMixCalculationError('');
    try {
      const result = await calculateRefinanceMixes(leadId);
      if (!Array.isArray(result?.mixes) || result.mixes.length !== 3) {
        throw new Error('The refinance mix response is incomplete');
      }
      setStrategyMixes(result.mixes);
    } catch (mixError) {
      console.error('Failed to calculate refinance strategy mixes:', mixError);
      setStrategyMixes([]);
      setMixCalculationError(
        'לא הצלחנו לחשב את התמהילים. אם הניתוח בוצע לפני השדרוג, יש להעלות מחדש את דף יתרת הסילוק.'
      );
    } finally {
      setIsCalculatingMixes(false);
    }
  };
  const isFinancialDetailsValid = Object.keys(financialDetailsErrors).length === 0;

  const handleFinancialDetailsSubmit = async () => {
    const errors = getFinancialDetailsErrors();
    if (Object.keys(errors).length > 0) {
      setFinancialDetailsTouched({ monthlyIncome: true, propertyPurchasePrice: true, estimatedCurrentPropertyValue: true });
      return;
    }

    setFinancialDetailsError('');
    setIsSubmittingFinancialDetails(true);
    try {
      const updatedLead = await refinanceLeads.update(leadId, {
          monthly_income: Number(monthlyIncome),
          property_purchase_price: Number(propertyPurchasePrice),
          estimated_current_property_value: estimatedCurrentPropertyValue ? Number(estimatedCurrentPropertyValue) : null
        });
      if (!updatedLead) throw new Error('The refinance lead was not updated');
      setHasFinancialDetails(true);
    } catch (err) {
      console.error('Failed to save refinance financial details:', err);
      setFinancialDetailsError(
        'לא הצלחנו לשמור את הנתונים. יש לוודא שמסד הנתונים עודכן עם העמודות החדשות למחזור, ואז לנסות שוב.'
      );
    } finally {
      setIsSubmittingFinancialDetails(false);
    }
  };

  const handleFileSelect = (e) => {
    const selectedFiles = Array.from(e.target.files || []);
    if (selectedFiles.length > 0) {
      setFiles([selectedFiles[0]]); // רק קובץ אחד
    }
    setError(null);
  };

  const removeFile = (index) => {
    setFiles(files.filter((_, i) => i !== index));
  };

  const handleAnalyze = async () => {
    if (files.length === 0) {
      setError('אנא העלה לפחות קובץ אחד');
      return;
    }

    setError(null);
    setDemoDocumentOverride(false);
    setIsAnalyzing(true);

    let file_url = null;
    const externalDebtsInput = hasExtraDebts
      ? extraDebts
          .filter(d => d.creditor && Number(d.monthly_repayment) > 0)
          .map(d => ({
            creditor: d.creditor,
            monthly_repayment: Number.parseFloat(String(d.monthly_repayment)) || 0,
            remaining_balance: Number.parseFloat(String(d.remaining_balance)) || 0,
            estimated_interest: Number.parseFloat(String(d.estimated_interest)) || 15
          }))
      : [];

    try {
      file_url = await uploadFileToStorage(files[0]);

      const data = await analyzeRefinanceDocument({
        file_url,
        loan_period_years: 20,
        transaction_type: transactionType,
        external_debts_input: externalDebtsInput
      });

      if (!data?.success) {
        const errorMsg = data?.error || 'שגיאה בניתוח הקובץ. ודא שהמסמך הוא דף יתרת סילוק תקין מהבנק.';
        setError(`❌ ${errorMsg}`);
        // Record the failed attempt. Without this the lead row keeps its
        // initial state and we lose both the fact that an analysis was tried
        // and the file that failed — the two things needed to follow it up.
        updateLead({
          status: 'error',
          file_url,
          has_extra_debts: hasExtraDebts,
          external_debts: externalDebtsInput
        });
        return;
      }

      if (verifyBorrowerName && !borrowerNameMatchesContact(data.currentLoan?.borrowers_names, contactFullName)) {
        setError(`❌ השם שחולץ מהמסמך שהעלית אינו תואם לשם שהוזן בתחילת התהליך (${contactFullName}). ודא שהעלית את המסמך של האדם הנכון.`);
        updateLead({
          status: 'error',
          file_url,
          has_extra_debts: hasExtraDebts,
          external_debts: externalDebtsInput
        });
        return;
      }
      setVerifyBorrowerName(false);

      const { mixCalculationContext, ...publicAnalysis } = data;
      setStrategyMixes([]);
      setMixCalculationError('');
      await updateLead({
        status: 'analyzed',
        file_url,
        has_extra_debts: hasExtraDebts,
        external_debts: externalDebtsInput,
        analysis_result: publicAnalysis,
        mix_calculation_context: mixCalculationContext,
        strategy_mix_results: {},
        analyzed_at: new Date().toISOString()
      });
      setAnalysisResult({ ...publicAnalysis, file_url });
      window.scrollTo({ top: 0, behavior: 'smooth' });

    } catch (err) {
      console.error('Analysis error:', err);

      // Retry only true transport failures. A 503 from the analyzer already
      // means it exhausted its own retries, so repeating the whole request just
      // makes the borrower sit through a second full failure.
      const errorMessage = err?.message?.toLowerCase() || '';
      const isRetryable = [0, 502, 504].includes(err?.status)
        || errorMessage.includes('timeout')
        || errorMessage.includes('network');
      let finalMessage = err?.message || 'שגיאה לא צפויה';

      if (file_url && isRetryable) {
        try {
          const retryData = await analyzeRefinanceDocument({
            file_url,
            loan_period_years: 20,
            transaction_type: transactionType,
            external_debts_input: externalDebtsInput
          });
          if (!retryData?.success) {
            throw new Error(retryData?.error || 'שגיאה בניתוח הקובץ');
          }
          if (verifyBorrowerName && !borrowerNameMatchesContact(retryData.currentLoan?.borrowers_names, contactFullName)) {
            throw new Error(`השם שחולץ מהמסמך שהעלית אינו תואם לשם שהוזן בתחילת התהליך (${contactFullName}). ודא שהעלית את המסמך של האדם הנכון.`);
          }
          setVerifyBorrowerName(false);

          const { mixCalculationContext, ...publicAnalysis } = retryData;
          setStrategyMixes([]);
          setMixCalculationError('');
          await updateLead({
            status: 'analyzed',
            file_url,
            has_extra_debts: hasExtraDebts,
            external_debts: externalDebtsInput,
            analysis_result: publicAnalysis,
            mix_calculation_context: mixCalculationContext,
            strategy_mix_results: {},
            analyzed_at: new Date().toISOString()
          });
          setAnalysisResult({ ...publicAnalysis, file_url });
          window.scrollTo({ top: 0, behavior: 'smooth' });
          return;
        } catch (retryErr) {
          finalMessage = retryErr?.message || finalMessage;
        }
      }

      // Show what actually went wrong. The old copy here blamed file size for
      // every failure, which sent people re-exporting perfectly good statements
      // while the real fault was server-side.
      setError(`❌ ${finalMessage}`);
      if (file_url) {
        updateLead({
          status: 'error',
          file_url,
          has_extra_debts: hasExtraDebts,
          external_debts: externalDebtsInput
        });
      }
    } finally {
      setIsAnalyzing(false);
    }
  };

  const returnToDocumentUpload = () => {
    setAnalysisResult(null);
    setStrategyMixes([]);
    setMixCalculationError('');
    setFiles([]);
    setError(null);
    setShowAdvancedAnalysis(false);
    setIsDownloadingPdf(false);
    setDemoDocumentOverride(false);
    setVerifyBorrowerName(true);
    window.requestAnimationFrame(() => document.getElementById('refinance-files')?.click());
  };

  const startRefinanceOver = () => {
    setAnalysisResult(null);
    setStrategyMixes([]);
    setMixCalculationError('');
    setFiles([]);
    setError(null);
    setShowAdvancedAnalysis(false);
    setIsDownloadingPdf(false);
    setDemoDocumentOverride(false);
    setVerifyBorrowerName(false);
    setLeadId(null);
    setTier('free');
    setIsPurchased(false);
    setContactFullName('');
    setContactEmail('');
    setContactPhone('');
    setContactIdNumber('');
    setContactConsent(false);
    setTermsAccepted(false);
    setContactErrors({});
    setContactTouched({});
    setMonthlyIncome('');
    setPropertyPurchasePrice('');
    setEstimatedCurrentPropertyValue('');
    setFinancialDetailsTouched({});
    setFinancialDetailsError('');
    setHasFinancialDetails(false);
    setHasExtraDebts(null);
    setExtraDebts([{ creditor: '', monthly_repayment: '', remaining_balance: '', estimated_interest: 15 }]);
    const url = new URL(window.location.href);
    url.searchParams.delete('lead');
    window.history.replaceState(null, '', url);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (!isSupabaseConfigured) {
    return (
      <div className="min-h-screen bg-white overflow-x-hidden" dir="rtl">
        <MikudHeader activePage="refinance" />
        <div className="max-w-2xl mx-auto px-4 py-24 text-center">
          <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-amber-100 flex items-center justify-center">
            <AlertCircle className="w-8 h-8 text-amber-600" />
          </div>
          <h1 className="text-2xl font-black text-mist-900 mb-3">בדיקת המחזור אינה זמינה כרגע</h1>
          <p className="text-mist-500">
            נתקלנו בתקלה טכנית זמנית. אפשר לנסות שוב בעוד כמה דקות, או ליצור קשר ישיר בטלפון{' '}
            <a href="tel:2324" className="text-[#0153F4] font-bold">2324*</a>.
          </p>
        </div>
        <FooterCTA />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white overflow-x-hidden" dir="rtl">
      <CardComPaymentModal paymentUrl={paymentUrl} onClose={handlePaymentModalClose} />
      <MikudHeader activePage="refinance" isChatOpen={isChatOpen} setIsChatOpen={setIsChatOpen} />
      <main className="max-w-6xl mx-auto px-4 py-16 flex flex-col items-center">
      <div className="w-full max-w-4xl">
        {!analysisResult && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-16 animate-in fade-in slide-in-from-top-8 duration-1000">
          <h1 className="text-[1.89rem] sm:text-[2.835rem] font-extrabold text-[#0C084A] mb-6 leading-tight tracking-tight">
            המחזור החכם<br/>
            <span className="text-[#0153F4]">מתחיל כאן</span>
          </h1>
          <p className="text-lg text-[#A7A8AB] max-w-2xl mx-auto leading-relaxed font-normal">העלו יתרת סילוק וקבלו ניתוח אישי של אפשרויות המחזור שלכם</p>
          <div className="flex justify-center gap-6 sm:gap-10 mt-6 sm:mt-8 text-sm">
            <div className="flex flex-col items-center gap-2">
              <div className="text-2xl sm:text-3xl font-bold text-[#0C084A]">ריביות שוק</div>
              <span className="text-mist-500">נתונים עדכניים</span>
            </div>
            <div className="flex flex-col items-center gap-2">
              <div className="text-2xl sm:text-3xl font-bold text-[#0C084A]">20–40 שנ׳</div>
              <span className="text-mist-500">זמן ניתוח</span>
            </div>
            <div className="flex flex-col items-center gap-2">
              <div className="text-2xl sm:text-3xl font-bold text-[#0C084A]">0₪</div>
              <span className="text-mist-500">עלות הבדיקה</span>
            </div>
          </div>
        </motion.div>
        )}

        {isResumingLead && !analysisResult && (
          <div className="flex justify-center py-12">
            <Loader2 className="w-8 h-8 text-[#0153F4] animate-spin" />
          </div>
        )}

        {!isResumingLead && !leadId && !analysisResult && (
          <div className="bg-white rounded-3xl shadow-xl p-8 sm:p-12 md:p-16 border border-mist-100 transition-all duration-700 relative overflow-hidden">
            <div className="space-y-5">
              <div className="mb-6 text-right">
                <h2 className="text-lg sm:text-2xl font-bold text-[#0C084A] leading-none">בואו נכיר</h2>
                <p className="text-[#0153F4] font-medium text-xs mt-2">לפני העלאת המסמך, נשמח לקבל כמה פרטים ליצירת קשר</p>
              </div>

              <div className="grid sm:grid-cols-2 gap-3 mb-1">
                <PremiumInput label="שם מלא" name="refinanceFullName" value={contactFullName} onChange={(_, value) => setContactFullName(value)} onBlur={() => markContactTouched('fullName')} disabled={isSubmittingContact} autoComplete="name" error={contactTouched.fullName ? liveContactErrors.fullName : undefined} />
                <PremiumInput label="מספר תעודת זהות" name="refinanceIdNumber" value={contactIdNumber} onChange={(_, value) => setContactIdNumber(value)} onBlur={() => markContactTouched('idNumber')} disabled={isSubmittingContact} inputMode="numeric" maxLength={9} autoComplete="off" error={contactTouched.idNumber ? liveContactErrors.idNumber : undefined} />
                <PremiumInput label="טלפון נייד" name="refinancePhone" value={contactPhone} onChange={(_, value) => setContactPhone(value)} onBlur={() => markContactTouched('phone')} disabled={isSubmittingContact} inputMode="tel" autoComplete="tel" error={contactTouched.phone ? liveContactErrors.phone : undefined} />
                <PremiumInput label="כתובת דוא״ל" name="refinanceEmail" value={contactEmail} onChange={(_, value) => setContactEmail(value)} onBlur={() => markContactTouched('email')} disabled={isSubmittingContact} type="email" autoComplete="email" error={contactTouched.email ? liveContactErrors.email : undefined} />
              </div>

              <div className="space-y-3 rounded-2xl bg-mist-50 p-4 text-right">
                <div className="flex items-start gap-3">
                  <Checkbox
                    id="refinance-contact-consent"
                    checked={contactConsent}
                    onCheckedChange={(checked) => setContactConsent(checked === true)}
                    disabled={isSubmittingContact}
                    aria-labelledby="refinance-contact-consent-label"
                    className="mt-0.5"
                  />
                  <label id="refinance-contact-consent-label" htmlFor="refinance-contact-consent" className="cursor-pointer text-xs font-bold leading-relaxed text-mist-600">
                    אני מאשר ליועץ ממיקוד משכנתאות ליצור איתי קשר לצורך קידום התיק.
                  </label>
                </div>
                {contactTouched.contactConsent && liveContactErrors.contactConsent && <p className="text-xs font-bold text-red-600">{liveContactErrors.contactConsent}</p>}

                <div className="flex items-start gap-3">
                  <Checkbox
                    id="refinance-terms-accepted"
                    checked={termsAccepted}
                    onCheckedChange={(checked) => setTermsAccepted(checked === true)}
                    disabled={isSubmittingContact}
                    aria-labelledby="refinance-terms-accepted-label"
                    className="mt-0.5"
                  />
                  <label id="refinance-terms-accepted-label" htmlFor="refinance-terms-accepted" className="cursor-pointer text-xs font-bold leading-relaxed text-mist-600">
                    קראתי ואני מסכים/ה ל
                    <a
                      href={`${createPageUrl('TermsAndPrivacy')}#terms`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline text-[#0153F4] hover:text-brand-700"
                      onClick={(e) => e.stopPropagation()}
                    >
                      תנאי השימוש
                    </a>
                    {' '}ול
                    <a
                      href={`${createPageUrl('TermsAndPrivacy')}#privacy`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline text-[#0153F4] hover:text-brand-700"
                      onClick={(e) => e.stopPropagation()}
                    >
                      מדיניות הפרטיות
                    </a>
                    {' '}של האתר.
                  </label>
                </div>
                {contactTouched.termsAccepted && liveContactErrors.termsAccepted && <p className="text-xs font-bold text-red-600">{liveContactErrors.termsAccepted}</p>}
              </div>

              {contactErrors.submit && (
                <div className="bg-red-50 border border-red-300 rounded-xl p-4 flex items-start gap-3">
                  <AlertCircle size={20} className="text-red-600 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-red-700">{contactErrors.submit}</p>
                </div>
              )}

              <Button
                onClick={handleContactSubmit}
                disabled={isSubmittingContact || !isContactFormValid}
                className="w-full h-14 rounded-full font-semibold text-lg shadow-md transition-all bg-[#0C084A] text-white hover:bg-[#0153F4] active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isSubmittingContact ? (
                  <><Loader2 className="w-5 h-5 ml-2 animate-spin" /> שומר...</>
                ) : (
                  <span className="flex items-center justify-center gap-2">המשך להעלאת מסמך <ChevronLeft size={24} /></span>
                )}
              </Button>
            </div>
          </div>
        )}

        {leadId && !hasFinancialDetails && !analysisResult && (
          <div className="bg-white rounded-3xl shadow-xl p-8 sm:p-12 md:p-16 border border-mist-100 transition-all duration-700 relative overflow-hidden">
            <div className="space-y-5">
              <div className="mb-6 text-right">
                <h2 className="text-lg sm:text-2xl font-bold text-[#0C084A] leading-none">עוד כמה פרטים ונמשיך</h2>
                <p className="text-[#0153F4] font-medium text-xs mt-2">הנתונים עוזרים לנו להתאים את בדיקת המחזור למצבכם</p>
              </div>

              <div className="grid sm:grid-cols-2 gap-3 mb-1">
                <PremiumInput
                  label="הכנסה חודשית נטו (₪)"
                  name="refinanceMonthlyIncome"
                  value={monthlyIncome}
                  onChange={(_, value) => setMonthlyIncome(value)}
                  onBlur={() => setFinancialDetailsTouched(t => ({ ...t, monthlyIncome: true }))}
                  disabled={isSubmittingFinancialDetails}
                  inputMode="numeric"
                  error={financialDetailsTouched.monthlyIncome ? financialDetailsErrors.monthlyIncome : undefined}
                />
                <PremiumInput
                  label="מחיר הרכישה המקורי של הנכס (₪)"
                  name="refinancePropertyPurchasePrice"
                  value={propertyPurchasePrice}
                  onChange={(_, value) => setPropertyPurchasePrice(value)}
                  onBlur={() => setFinancialDetailsTouched(t => ({ ...t, propertyPurchasePrice: true }))}
                  disabled={isSubmittingFinancialDetails}
                  inputMode="numeric"
                  error={financialDetailsTouched.propertyPurchasePrice ? financialDetailsErrors.propertyPurchasePrice : undefined}
                />
                <div className="sm:col-span-2">
                  <PremiumInput
                    label="שווי הנכס המשוער כיום (₪) — אופציונלי"
                    name="refinanceEstimatedCurrentPropertyValue"
                    value={estimatedCurrentPropertyValue}
                    onChange={(_, value) => setEstimatedCurrentPropertyValue(value)}
                    onBlur={() => setFinancialDetailsTouched(t => ({ ...t, estimatedCurrentPropertyValue: true }))}
                    disabled={isSubmittingFinancialDetails}
                    inputMode="numeric"
                    error={financialDetailsTouched.estimatedCurrentPropertyValue ? financialDetailsErrors.estimatedCurrentPropertyValue : undefined}
                  />
                </div>
              </div>

              {financialDetailsError && (
                <div className="bg-red-50 border border-red-300 rounded-xl p-4 flex items-start gap-3">
                  <AlertCircle size={20} className="text-red-600 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-red-700">{financialDetailsError}</p>
                </div>
              )}

              <Button
                onClick={handleFinancialDetailsSubmit}
                disabled={isSubmittingFinancialDetails || !isFinancialDetailsValid}
                className="w-full h-14 rounded-full font-semibold text-lg shadow-md transition-all bg-[#0C084A] text-white hover:bg-[#0153F4] active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isSubmittingFinancialDetails ? (
                  <><Loader2 className="w-5 h-5 ml-2 animate-spin" /> שומר...</>
                ) : (
                  <span className="flex items-center justify-center gap-2">המשך להעלאת מסמך <ChevronLeft size={24} /></span>
                )}
              </Button>
            </div>
          </div>
        )}

        {leadId && hasFinancialDetails && !analysisResult && (
          <div className="bg-white rounded-3xl shadow-xl p-8 sm:p-12 md:p-16 border border-mist-100 transition-all duration-700 relative overflow-hidden">
            <div className="space-y-6">

              {/* מה להעלות */}
              <div className="border border-mist-200 rounded-xl p-4 bg-mist-50">
                <div className="flex items-center gap-2 mb-2">
                  <AlertCircle className="w-4 h-4 text-[#0153F4]" />
                  <h3 className="font-bold text-mist-900 text-sm">מה להעלות?</h3>
                </div>
                <ul className="text-xs text-mist-500 space-y-1">
                  <li>✓ דף יתרת סילוק משכנתא מהבנק המלווה בלבד</li>
                  <li>אין צורך להעלות מסמכים נוספים בשלב זה</li>
                </ul>
              </div>

              {/* אזור העלאה */}
              <div>
                <div className="mb-6 text-right">
                  <h2 className="text-lg sm:text-2xl font-bold text-[#0C084A] leading-none">העלאת מסמך</h2>
                  <p className="text-[#0153F4] font-medium text-xs mt-2">דף יתרת סילוק עדכני מהבנק</p>
                </div>
                <div
                  onClick={() => document.getElementById('refinance-files').click()}
                  className="border border-dashed border-mist-300 rounded-xl p-10 text-center hover:border-[#0153F4]/60 hover:bg-[#0153F4]/5 transition-all cursor-pointer focus-within:border-[#0153F4] focus-within:bg-periwinkle-100"
                >
                  <Upload className="w-12 h-12 text-mist-400 mx-auto mb-3" />
                  <p className="text-base font-bold text-mist-900 mb-1">גרור לכאן או לחץ להעלאה</p>
                  <p className="text-sm text-mist-500">PDF, JPG, PNG — העלה דף יתרת סילוק בלבד (קובץ אחד)</p>
                  <input
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png"
                    onChange={handleFileSelect}
                    className="hidden"
                    id="refinance-files"
                    disabled={isAnalyzing}
                  />
                </div>

                {files.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {files.map((file, index) => (
                      <div key={index} className="flex items-center gap-3 bg-white p-3 rounded-xl border border-mist-200">
                        <span className="w-6 h-6 bg-brand-50 rounded-lg flex items-center justify-center text-xs font-bold text-[#0153F4] flex-shrink-0">{index + 1}</span>
                        <span className="flex-1 font-medium text-sm text-mist-900 truncate">{file.name}</span>
                        <span className="text-xs text-mist-500">{(file.size / 1024 / 1024).toFixed(1)} MB</span>
                        <button onClick={() => removeFile(index)} className="text-mist-400 hover:text-red-600 transition-colors p-1">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Progress bar */}
              {isAnalyzing && (
                <div className="border border-mist-200 rounded-xl p-5 space-y-3 bg-mist-50">
                  <div className="flex justify-between text-sm">
                    <div className="flex items-center gap-2 text-mist-900 font-bold">
                      <Loader2 className="w-4 h-4 animate-spin text-[#0153F4]" />
                      מנתח מסמך...
                    </div>
                    <span className="font-black text-[#0153F4]">{progress}%</span>
                  </div>
                  <div className="w-full bg-mist-200 rounded-full h-2">
                    <div className="bg-[#0153F4] h-2 rounded-full transition-all duration-1000" style={{ width: `${progress}%` }} />
                  </div>
                  <p className="text-xs text-mist-500 text-center">ניתוח מעמיק — עשוי לקחת 60-120 שניות</p>
                </div>
              )}

              {/* שאלת הלוואות נוספות */}
              {files.length > 0 && !isAnalyzing && (
                <div className="border border-mist-200 rounded-xl p-4 space-y-3 bg-mist-50">
                  <p className="text-sm font-bold text-mist-900">האם יש לך הלוואות/חובות נוספים מחוץ למשכנתא?</p>
                  <p className="text-xs text-mist-500">הלוואות רכב, אשראי, מינוס בעו"ש — ניתן לאחד הכל למשכנתא אחת</p>
                  <div className="flex gap-3">
                    <button
                      onClick={() => setHasExtraDebts(false)}
                      className={`flex-1 py-3 rounded-xl text-sm font-semibold transition-all border ${hasExtraDebts === false ? 'bg-[#0C084A] text-white border-[#0C084A]' : 'border-mist-300 text-mist-600 hover:border-[#0C084A]/40 hover:bg-mist-50'}`}
                    >
                      לא, רק המשכנתא
                    </button>
                    <button
                      onClick={() => setHasExtraDebts(true)}
                      className={`flex-1 py-3 rounded-xl text-sm font-semibold transition-all border ${hasExtraDebts === true ? 'bg-[#0C084A] text-white border-[#0C084A]' : 'border-mist-300 text-mist-600 hover:border-[#0C084A]/40 hover:bg-mist-50'}`}
                    >
                      כן, יש לי חובות נוספים
                    </button>
                  </div>

                  {hasExtraDebts === true && (
                    <div className="space-y-2 mt-2">
                      {extraDebts.map((debt, idx) => (
                        <div key={idx} className="grid grid-cols-2 gap-3 rounded-xl bg-white p-3 border border-mist-200">
                          <div className="col-span-2">
                            <label htmlFor={`debt-creditor-${idx}`} className="block text-[#0C084A] font-normal text-sm mb-2">מקור החוב</label>
                            <input
                              id={`debt-creditor-${idx}`}
                              placeholder="לדוגמה: הלוואת רכב"
                              value={debt.creditor}
                              onChange={e => { const d = [...extraDebts]; d[idx].creditor = e.target.value; setExtraDebts(d); }}
                              className="w-full bg-periwinkle-100 h-[2.8rem] px-5 border border-transparent rounded-lg outline-none focus:border-[#0153F4] focus:ring-4 focus:ring-[#0153F4]/20 transition-all text-mist-900 font-semibold text-base placeholder-mist-400"
                            />
                          </div>
                          <div>
                            <label htmlFor={`debt-payment-${idx}`} className="block text-[#0C084A] font-normal text-sm mb-2">החזר חודשי</label>
                            <input
                              id={`debt-payment-${idx}`}
                              placeholder="₪"
                              type="number"
                              value={debt.monthly_repayment}
                              onChange={e => { const d = [...extraDebts]; d[idx].monthly_repayment = e.target.value; setExtraDebts(d); }}
                              className="w-full bg-periwinkle-100 h-[2.8rem] px-5 border border-transparent rounded-lg outline-none focus:border-[#0153F4] focus:ring-4 focus:ring-[#0153F4]/20 transition-all text-mist-900 font-semibold text-base placeholder-mist-400"
                            />
                          </div>
                          <div>
                            <label htmlFor={`debt-balance-${idx}`} className="block text-[#0C084A] font-normal text-sm mb-2">יתרה לסילוק</label>
                            <input
                              id={`debt-balance-${idx}`}
                              placeholder="₪"
                              type="number"
                              value={debt.remaining_balance}
                              onChange={e => { const d = [...extraDebts]; d[idx].remaining_balance = e.target.value; setExtraDebts(d); }}
                              className="w-full bg-periwinkle-100 h-[2.8rem] px-5 border border-transparent rounded-lg outline-none focus:border-[#0153F4] focus:ring-4 focus:ring-[#0153F4]/20 transition-all text-mist-900 font-semibold text-base placeholder-mist-400"
                            />
                          </div>
                        </div>
                      ))}
                      <button type="button"
                        onClick={() => setExtraDebts([...extraDebts, { creditor: '', monthly_repayment: '', remaining_balance: '', estimated_interest: 15 }])}
                        className="w-full py-3 rounded-xl border border-dashed border-[#0153F4] text-[#0153F4] font-bold text-sm hover:bg-[#0153F4]/10 transition-all"
                      >
                        הוסף חוב נוסף
                      </button>
                    </div>
                  )}
                </div>
              )}

              {error && (
                <div className="bg-red-50 border border-red-300 rounded-xl p-4 flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}

              <Button
                onClick={handleAnalyze}
                disabled={files.length === 0 || isAnalyzing || hasExtraDebts === null}
                className="w-full h-14 rounded-full font-semibold text-lg shadow-md transition-all bg-[#0C084A] text-white hover:bg-[#0153F4] active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isAnalyzing ? (
                  <><Loader2 className="w-5 h-5 ml-2 animate-spin" /> מנתח...</>
                ) : (
                  files.length > 0 && hasExtraDebts !== null ? <span className="flex items-center justify-center gap-2">נתח מסמך <ChevronLeft size={24} /></span> : files.length > 0 ? 'בחר סוג חובות כדי להמשיך' : 'העלה מסמך והתחל ניתוח'
                )}
              </Button>
            </div>
          </div>
        )}

        <AnimatePresence>
          {analysisResult && (
            <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -30 }} className="refinance-report space-y-6">
              {refinanceOutcome === REFINANCE_OUTCOME.DOCUMENT_INVALID && (
                <motion.section
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="max-w-2xl mx-auto rounded-3xl border border-red-200 bg-gradient-to-br from-red-50 via-white to-amber-50 p-7 sm:p-10 text-center shadow-xl"
                >
                  <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-red-100">
                    <AlertCircle className="h-9 w-9 text-red-600" />
                  </div>
                  <Badge className="mb-4 border border-red-200 bg-red-100 text-red-800">נדרש מסמך עדכני</Badge>
                  <h2 className="text-2xl font-black text-[#0C084A] sm:text-3xl">עדיין לא ניתן להמשיך למחזור</h2>
                  <p className="mt-3 text-sm font-semibold leading-relaxed text-red-800">{analysisResult.statementDateWarning}</p>
                  <div className="mt-6 rounded-2xl border border-red-100 bg-white p-4 text-right">
                    <p className="font-black text-red-900">מה עושים עכשיו?</p>
                    <p className="mt-1 text-sm leading-relaxed text-red-700">בקשו מהבנק דף יתרת סילוק עדכני, ואז העלו אותו כאן לבדיקה מחדש. הפרטים שכבר מילאתם נשמרו.</p>
                  </div>
                  <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
                    <Button onClick={returnToDocumentUpload} className="h-14 rounded-full bg-[#0C084A] px-6 font-black text-white hover:bg-[#0153F4]">
                      <Upload className="ml-2 h-5 w-5" />
                      העלאת מסמך עדכני
                    </Button>
                    <Button variant="outline" onClick={startRefinanceOver} className="h-14 rounded-full border-mist-300 px-6 font-bold text-mist-600 hover:bg-mist-50">
                      התחל מחדש
                    </Button>
                    {PAYMENT_BYPASS_ENABLED && (
                      <Button variant="outline" onClick={() => setDemoDocumentOverride(true)} className="h-14 rounded-full border-[#0153F4] px-6 font-bold text-[#0C084A] hover:bg-periwinkle-100">
                        דלג על בדיקת תוקף המסמך (דמו)
                      </Button>
                    )}
                  </div>
                </motion.section>
              )}

              {refinanceOutcome === REFINANCE_OUTCOME.FINANCIAL_INELIGIBLE && (
                <motion.section
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="max-w-2xl mx-auto rounded-3xl border border-amber-200 bg-gradient-to-br from-amber-50 via-white to-orange-50 p-7 sm:p-10 text-center shadow-xl"
                >
                  <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-amber-100">
                    <AlertCircle className="h-9 w-9 text-amber-600" />
                  </div>
                  <Badge className="mb-4 border border-amber-200 bg-amber-100 text-amber-800">לא ניתן להתקדם כרגע</Badge>
                  <h2 className="text-2xl font-black text-[#0C084A] sm:text-3xl">המחזור אינו מתאים לנתונים הפיננסיים שהוזנו</h2>
                  <p className="mt-3 text-sm leading-relaxed text-amber-900">לפי הנתונים שנבדקו, אין כרגע מסלול מחזור שאפשר להתקדם איתו. לא בוצע חיוב ולא נפתח דוח מלא.</p>
                  <p className="mt-3 text-xs leading-relaxed text-amber-800">ההחלטה הסופית על אישור אשראי מתקבלת תמיד על ידי הבנק.</p>
                  <Button onClick={startRefinanceOver} className="mt-6 h-14 rounded-full bg-[#0C084A] px-6 font-black text-white hover:bg-[#0153F4]">
                    להתחלת תהליך מחדש
                    <ChevronLeft className="mr-2 h-5 w-5" />
                  </Button>
                </motion.section>
              )}

              {refinanceOutcome === REFINANCE_OUTCOME.ELIGIBLE && (
                <>
                  {/* 📄 אסטרטגיית המחזור והדוח המלא — מחוץ לכרטיס כי היא מוצגת מחוץ למסך לצורך ה-PDF */}
                  <ExecutiveSummary
                    analysisResult={reportAnalysisResult}
                    headline={headline}
                    externalTrigger={pdfTrigger}
                    onTriggerDone={() => setIsDownloadingPdf(false)}
                  />

                  <div className="bg-white rounded-2xl sm:rounded-3xl shadow-xl border border-mist-100 relative overflow-hidden">
                    <div className="p-4 sm:p-6 md:p-8 space-y-5 sm:space-y-6">

                  {/* תמצית פרטי הבקשה */}
                  <div className="rounded-3xl border border-mist-200 bg-mist-50 p-6 sm:p-8">
                    <h3 className="text-sm font-bold text-mist-500 mb-4">פרטי הבקשה</h3>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {[analysisResult.borrower_1, analysisResult.borrower_2].filter(Boolean).map((borrower, i) => (
                        <div key={i} className="rounded-xl p-3 border border-mist-200 bg-white/60 flex flex-col justify-center">
                          <p className="text-xs text-mist-500 mb-1">{i === 0 ? 'לווה' : 'לווה נוסף'}</p>
                          <p className="text-base font-bold text-mist-900">{borrower.full_name || `${borrower.first_name || ''} ${borrower.last_name || ''}`.trim()}</p>
                          {borrower.id_number && <p className="text-xs text-mist-500 mt-1">ת.ז. {borrower.id_number}</p>}
                        </div>
                      ))}
                    </div>
                    <div className="grid grid-cols-2 gap-3 mt-3">
                      <div className="rounded-xl p-3 border border-mist-200 bg-white/60 flex flex-col justify-center">
                        <p className="text-xs text-mist-500 mb-1">יתרה לסילוק</p>
                        <p className="text-lg font-bold text-mist-900">₪{analysisResult.currentLoan.remainingBalance?.toLocaleString()}</p>
                      </div>
                      <div className="rounded-xl p-3 border border-mist-200 bg-white/60 flex flex-col justify-center">
                        <p className="text-xs text-mist-500 mb-1">תקופה נותרת</p>
                        <p className="text-lg font-bold text-mist-900">{Math.round((analysisResult.currentLoan.remainingMonths || 0) / 12)} שנים</p>
                      </div>
                    </div>
                  </div>

                  <motion.section
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="overflow-hidden rounded-3xl border border-[#0153F4]/20 bg-gradient-to-br from-periwinkle-100 via-white to-green-50 p-6 sm:p-8 shadow-xl"
                  >
                    <div className="flex flex-col items-center justify-center gap-4 text-center md:flex-row md:justify-start md:text-right">
                      <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-[#0153F4] shadow-lg shadow-brand-200">
                        <CheckCircle className="h-11 w-11 text-white" />
                      </div>
                      <h2 className="text-2xl font-black text-[#0C084A] sm:text-3xl">מדהים! אפשר למחזר את המשכנתא</h2>
                    </div>
                    <div className="mt-6 rounded-2xl border border-[#0153F4]/15 bg-white/80 p-4 pt-5 pr-5 text-right">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="flex items-center gap-2">
                            <TrendingUp className="h-5 w-5 text-[#0153F4]" />
                            <h3 className="text-lg font-black text-[#0C084A]">כמה שווה לי למחזר?</h3>
                          </div>
                          {headline?.isWorthwhile === true ? (
                            <p className="mt-2 text-sm font-bold text-green-700">מומלץ בחום — הניתוח מצביע על כדאיות כלכלית ברורה למחזור.</p>
                          ) : headline?.isWorthwhile === false ? (
                            <p className="mt-2 text-sm font-bold text-amber-700">כדאי לבחון בזהירות — קיימת אפשרות למחזור, אך הכדאיות הכלכלית אינה חד-משמעית.</p>
                          ) : (
                            <p className="mt-2 text-sm font-bold text-[#0C084A]">כדאי לקבל חוות דעת מקצועית לפני שמתקדמים.</p>
                          )}
                        </div>
                        <div className="rounded-2xl border border-green-200 bg-white/80 p-3 text-center">
                          <p className="mb-1 text-xs font-bold leading-none text-mist-500">חיסכון כלכלי נטו</p>
                          <CelebratingSavingsAmount value={headline?.netSavings || 0} />
                        </div>
                      </div>
                    </div>
                  </motion.section>
              {analysisResult.savings?.arrearsDebt > 0 && (
                <div className="flex flex-col items-center gap-3">
                  <div className="bg-red-50 border border-red-300 text-red-800 px-6 py-3 rounded-xl flex items-center gap-3">
                    <AlertCircle className="w-6 h-6 text-red-600" />
                    <div>
                      <p className="font-black text-lg">🚨 זוהה פיגור במשכנתא: ₪{analysisResult.savings.arrearsDebt.toLocaleString()}</p>
                      <p className="text-sm">תיק מורכב - המחזור נועד להצלת הנכס והסדרת החוב</p>
                    </div>
                  </div>
                </div>
              )}

              <ProfessionalAnalysis text={analysisResult.conclusionText} title="ניתוח כדאיות מחזור" />

              {!isPurchased && (
                <div className="p-5 rounded-2xl border border-dashed border-[#0153F4] bg-periwinkle-100 text-center sm:text-right">
                  <p className="font-black text-[#0C084A] text-base mb-4">
                    אז למה אתם מחכים? כדי לחסוך ₪{Math.max(0, Math.round(headline?.netSavings || 0)).toLocaleString()}, קבלו את הניתוח המלא, פירוט ריביות ושלושה תמהילים מותאמים אישית
                  </p>
                  <div className="flex flex-col sm:flex-row items-center gap-4">
                    <div className="flex-1">
                      <h4 className="font-black text-[#06042A] text-base mb-1">הניתוח המלא נעול</h4>
                      <p className="text-mist-600 font-medium text-xs leading-relaxed">הפקת פירוט הריביות, ההשוואה המלאה והתמהילים המותאמים דורשת פתיחת תיק במיקוד משכנתאות.</p>
                      {paymentNotice && <p className="mt-2 text-[#0C084A] font-bold text-xs leading-relaxed">{paymentNotice}</p>}
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2 flex-shrink-0">
                      <button onClick={handlePurchaseClick} disabled={paymentLoading} className="bg-[#0C084A] text-white px-6 py-3 rounded-full font-black text-sm shadow-lg hover:bg-[#1362FF] hover:text-[#06042A] transition-all whitespace-nowrap disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                        {paymentLoading && <Loader2 size={16} className="animate-spin" />}
                        רכוש דוח ₪499
                      </button>
                      {PAYMENT_BYPASS_ENABLED && (
                        <button onClick={handlePaymentBypass} className="border border-[#0153F4] text-[#0C084A] px-5 py-3 rounded-full font-bold text-sm hover:bg-white transition-all whitespace-nowrap">
                          דלג על התשלום (דמו)
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              <div className={`space-y-5 sm:space-y-6 transition-all duration-1000 ${!isPurchased ? 'opacity-60 pointer-events-none select-none' : ''}`} style={!isPurchased ? { filter: 'blur(8px)' } : {}}>

              {/* אזור השוואה נקי וברור - לפני מול אחרי, כשני בלוקים נפרדים, שדות באותו מיקום בשתי הכרטיסיות */}
              <div className="grid md:grid-cols-2 gap-6 items-start">
                {/* המשכנתא הנוכחית */}
                <div className="rounded-3xl border border-mist-200 bg-mist-50 p-6 sm:p-8">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center">
                      <X className="w-4 h-4 text-red-600" />
                    </div>
                    <span className="inline-block bg-mist-100 text-mist-700 text-xs font-bold rounded-full px-3 py-1.5">לפני · המשכנתא הנוכחית</span>
                  </div>
                  <div className="rounded-xl p-4 border border-mist-200 bg-white/60 mb-3">
                    <p className="text-sm text-mist-500 mb-1">החזר חודשי</p>
                    <p className="text-3xl font-bold text-mist-900">₪{headline.currentMonthlyPayment?.toLocaleString()}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div className="rounded-xl p-3 border border-mist-200 bg-white/60 flex flex-col justify-center">
                      <p className="text-xs text-mist-500 mb-1 flex items-center gap-1">ריבית אפקטיבית<EffectiveRateInfo /></p>
                      <p className="text-lg font-bold text-mist-900">{(analysisResult.currentLoan.effectiveInterestRate ?? headline.currentAverageRate)?.toFixed(2)}%</p>
                    </div>
                    <div className="rounded-xl p-3 border border-mist-200 bg-white/60 flex flex-col justify-center">
                      <p className="text-xs text-mist-500 mb-1">תקופה נותרת</p>
                      <p className="text-lg font-bold text-mist-900">{Math.round((analysisResult.currentLoan.remainingMonths || 0) / 12)} שנים</p>
                    </div>
                  </div>
                  <div className="rounded-xl p-3 border border-mist-200 bg-white/60 flex flex-col justify-center">
                    <p className="text-xs text-mist-500 mb-1">יתרה לסילוק</p>
                    <p className="text-lg font-bold text-mist-900">₪{analysisResult.currentLoan.remainingBalance?.toLocaleString()}</p>
                  </div>
                </div>

                {/* אחרי המחזור */}
                <div className="rounded-3xl border border-[#0153F4] bg-white p-6 sm:p-8">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center">
                      <CheckCircle className="w-4 h-4 text-green-600" />
                    </div>
                    <span className="inline-block bg-periwinkle-100 text-[#0153F4] text-xs font-bold rounded-full px-3 py-1.5">אחרי · המחזור החדש</span>
                  </div>
                  <div className="rounded-xl p-4 border border-periwinkle-200 bg-periwinkle-100 mb-3">
                    <p className="text-sm text-mist-500 mb-1">החזר חודשי חדש</p>
                    <p className="text-3xl font-bold text-[#0153F4]">₪{headline.newMonthlyPayment?.toLocaleString()}</p>
                    <SavingsAnnotation value={(headline.currentMonthlyPayment || 0) - (headline.newMonthlyPayment || 0)} />
                  </div>
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div className="rounded-xl p-3 border border-periwinkle-200 bg-periwinkle-100 flex flex-col justify-center">
                      <p className="text-xs text-mist-500 mb-1 flex items-center gap-1">ריבית אפקטיבית<EffectiveRateInfo /></p>
                      <p className="text-lg font-bold text-[#0153F4]">{headline.newAverageRate?.toFixed(2)}%</p>
                    </div>
                    <div className="rounded-xl p-3 border border-periwinkle-200 bg-periwinkle-100 flex flex-col justify-center">
                      <p className="text-xs text-mist-500 mb-1">תקופה חדשה</p>
                      <p className="text-lg font-bold text-mist-900">{analysisResult.newLoan?.periodYears} שנים</p>
                    </div>
                  </div>
                  <div className="rounded-xl p-3 border border-periwinkle-200 bg-periwinkle-100 flex flex-col justify-center">
                    <p className="text-xs text-mist-500 mb-1">יתרה לסילוק</p>
                    <p className="text-lg font-bold text-mist-900">₪{analysisResult.currentLoan.remainingBalance?.toLocaleString()}</p>
                  </div>
                </div>
              </div>

              {/* ניתוח משכנתא מעמיק */}
              <div className="text-center">
                <Button
                  variant="outline"
                  onClick={() => setShowAdvancedAnalysis(!showAdvancedAnalysis)}
                  className="bg-white border border-mist-200 text-[#0C084A] hover:border-[#0153F4] hover:bg-periwinkle-100 gap-2 h-14 px-6 rounded-full font-semibold text-lg shadow-sm transition-all active:scale-95"
                >
                  {showAdvancedAnalysis ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                  <span className="font-bold text-base">
                    {showAdvancedAnalysis ? 'הסתר ניתוח משכנתא מעמיק' : 'הצג ניתוח משכנתא מעמיק'}
                  </span>
                </Button>
              </div>

              <AnimatePresence>
                {showAdvancedAnalysis && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden space-y-6"
                  >
                    <div className="p-6 sm:p-8 border border-mist-100 rounded-2xl sm:rounded-3xl bg-white space-y-6">
                      <h3 className="text-xl font-semibold text-[#0C084A] text-center mb-4">ניתוח משכנתא מעמיק</h3>

                      {/* פירוט המסלולים הקיימים */}
                      {analysisResult.currentLoan.tracks && analysisResult.currentLoan.tracks.length > 0 && (
                        <Card className="border border-mist-200 bg-white">
                          <CardHeader className="pb-2"><CardTitle className="text-sm text-mist-500">פירוט מסלולים קיימים</CardTitle></CardHeader>
                          <CardContent>
                            <div className="space-y-2">
                              {analysisResult.currentLoan.tracks.map((track, i) => (
                                <div key={i} className="bg-mist-50 p-3 rounded-lg border border-mist-200 text-sm">
                                  <div className="flex justify-between items-center mb-1">
                                    <span className="font-bold text-mist-900">{track.track_type}</span>
                                    <span className="text-red-600 font-bold">{track.interest_rate?.toFixed(2)}%</span>
                                  </div>
                                  <div className="flex justify-between text-xs text-mist-500">
                                    <span>יתרה: ₪{track.remaining_balance?.toLocaleString()}</span>
                                    <span>
                                      נותרו: {track.remaining_months > 12
                                        ? `${(track.remaining_months / 12).toFixed(1)} שנים`
                                        : `${track.remaining_months} חודשים`}
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </CardContent>
                        </Card>
                      )}

                      <RefinanceCalculator currentLoan={analysisResult.currentLoan} />

                      {/* ⚠️ Balloon Trap Alert */}
                      <BalloonTrapAlert
                        externalDebts={analysisResult.savings?.equityReleaseAnalysis?.externalDebts}
                      />

                      {/* 🔥 נזק מדד */}
                      {analysisResult.savings?.indexDamageAlerts?.length > 0 && (
                        <Card className="border border-red-300 bg-red-50">
                          <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-red-700">
                              <AlertCircle className="w-5 h-5" />
                              🔥 נזק המדד - כמה כסף "נשרף" בגלל ההצמדה
                            </CardTitle>
                          </CardHeader>
                          <CardContent className="space-y-3">
                            <p className="text-sm text-mist-500">המסלולים הצמודים למדד גורמים לתשלום נוסף שאינו נראה בתשלום החודשי הנוכחי:</p>
                            {analysisResult.savings.indexDamageAlerts.map((alert, i) => (
                              <div key={i} className="bg-white rounded-lg p-3 border border-red-200">
                                <div className="flex justify-between items-center">
                                  <span className="font-semibold text-mist-900">{alert.track_type}</span>
                                  <span className="text-2xl font-black text-red-600">+₪{alert.indexDamage?.toLocaleString()}</span>
                                </div>
                              </div>
                            ))}
                            <div className="bg-white rounded-lg p-3 border border-red-300 text-center">
                              <p className="text-sm font-bold text-mist-900">סך נזק המדד הכולל:</p>
                              <p className="text-3xl font-black text-red-600">
                                +₪{analysisResult.savings.indexDamageAlerts.reduce((s, a) => s + (a.indexDamage || 0), 0).toLocaleString()}
                              </p>
                              <p className="text-xs text-red-600/80 mt-1">💡 המחזור יבטל את ה"הצמדה" הזו לחלוטין ויחסוך גם כסף זה!</p>
                            </div>
                          </CardContent>
                        </Card>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="text-center">
                <button
                  type="button"
                  onClick={handleCalculateMixes}
                  disabled={isCalculatingMixes}
                  className="inline-flex h-14 min-w-56 items-center justify-center gap-2 rounded-full bg-[#0C084A] px-8 text-base font-black text-white shadow-md transition-all hover:bg-[#0153F4] active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isCalculatingMixes ? (
                    <><Loader2 className="h-5 w-5 animate-spin" /> מחשב תמהילים...</>
                  ) : (
                    <><Sparkle className="h-5 w-5" /> חשב תמהילים</>
                  )}
                </button>
                {mixCalculationError && (
                  <p className="mx-auto mt-3 max-w-xl text-sm font-bold leading-relaxed text-red-600">
                    {mixCalculationError}
                  </p>
                )}
              </div>

              {analysisResult.savings?.feeWarning && (
                <Card className="border border-red-500 bg-red-50">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                      <div>
                        <h3 className="font-bold text-red-900 text-sm">שים לב: עמלת פירעון</h3>
                        <p className="text-xs text-red-800 mt-1">{analysisResult.savings.feeWarning}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {analysisResult.savings?.equityReleaseAnalysis && (
                <Card className="border border-purple-500 bg-gradient-to-br from-purple-50 to-white">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <DollarSign className="w-5 h-5 text-purple-600" />
                      💰 ניתוח הלוואה לכל מטרה (איחוד חובות)
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    {/* 📊 בלוק 6: מודול פיצול ואיחוד (Split & Consolidation) */}
                    {analysisResult.savings.equityReleaseAnalysis.splitAnalysis && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.5 }}
                        className="bg-white border border-blue-500 rounded-xl p-6"
                      >
                        <div className="text-center mb-6">
                          <h3 className="font-bold text-blue-900 text-2xl mb-2">🔍 הפרדה אסטרטגית - מה באמת קורה?</h3>
                          <p className="text-sm text-slate-600">המשכנתא "גדלה", אבל הריבית הממוצעת נשארת הגיונית</p>
                        </div>

                        {/* 🎨 ויזואליזציה דרמטית: לפני ואחרי */}
                        <div className="grid md:grid-cols-2 gap-6 mb-8">
                          {/* 🔴 לפני */}
                          <motion.div
                            initial={{ x: -50, opacity: 0 }}
                            animate={{ x: 0, opacity: 1 }}
                            transition={{ delay: 0.2 }}
                            className="bg-gradient-to-br from-red-50 to-red-100 border border-red-400 rounded-2xl p-6 relative overflow-hidden"
                          >
                            <div className="absolute top-0 right-0 w-32 h-32 bg-red-300 rounded-full opacity-20 -mr-16 -mt-16"></div>
                            <div className="relative z-10">
                              <div className="flex items-center gap-3 mb-4">
                                <div className="w-12 h-12 bg-red-500 rounded-full flex items-center justify-center">
                                  <span className="text-white text-2xl">❌</span>
                                </div>
                                <div>
                                  <p className="font-bold text-red-900 text-lg">לפני המהלך</p>
                                  <p className="text-xs text-red-700">מצב תזרימי קשה</p>
                                </div>
                              </div>
                              <div className="space-y-3">
                                <div className="bg-white/50 rounded-lg p-3 border border-red-200">
                                  <p className="text-xs text-red-800 mb-1">משכנתא קיימת</p>
                                  <p className="text-lg font-bold text-red-900">₪{analysisResult.currentLoan.monthlyPayment.toLocaleString()}</p>
                                </div>
                                {analysisResult.savings.equityReleaseAnalysis.externalDebts.map((debt, i) => (
                                  <div key={i} className="bg-white/50 rounded-lg p-3 border border-red-200">
                                    <p className="text-xs text-red-800 mb-1">{debt.creditor}</p>
                                    <p className="text-sm font-bold text-red-900">₪{debt.monthly_repayment.toLocaleString()} ({debt.estimated_interest}%)</p>
                                  </div>
                                ))}
                              </div>
                              <div className="mt-4 pt-4 border-t-2 border-red-300">
                                <p className="text-xs text-red-700 mb-1">סך הכל יוצא מהעו"ש:</p>
                                <p className="text-4xl font-black text-red-600">
                                  ₪{analysisResult.savings.equityReleaseAnalysis.splitAnalysis.combinedTotal.beforeTotal.toLocaleString()}
                                </p>
                              </div>
                            </div>
                          </motion.div>

                          {/* 🟢 אחרי */}
                          <motion.div
                            initial={{ x: 50, opacity: 0 }}
                            animate={{ x: 0, opacity: 1 }}
                            transition={{ delay: 0.4 }}
                            className="bg-gradient-to-br from-green-50 to-green-100 border border-green-400 rounded-2xl p-6 relative overflow-hidden"
                          >
                            <div className="absolute top-0 left-0 w-32 h-32 bg-green-300 rounded-full opacity-20 -ml-16 -mt-16"></div>
                            <div className="relative z-10">
                              <div className="flex items-center gap-3 mb-4">
                                <div className="w-12 h-12 bg-green-500 rounded-full flex items-center justify-center">
                                  <span className="text-white text-2xl">✓</span>
                                </div>
                                <div>
                                  <p className="font-bold text-green-900 text-lg">אחרי המהלך</p>
                                  <p className="text-xs text-green-700">תזרים בריא ויציב</p>
                                </div>
                              </div>
                              <div className="bg-white/70 rounded-lg p-4 border border-green-200 mb-4">
                                <p className="text-xs text-green-800 mb-2">משכנתא מאוחדת אחת</p>
                                <div className="flex items-center justify-between mb-2">
                                  <span className="text-xs text-slate-600">חלק דיור ({analysisResult.savings.equityReleaseAnalysis.splitAnalysis.housingPortion.rate}%)</span>
                                  <span className="font-semibold text-green-800">₪{analysisResult.savings.equityReleaseAnalysis.splitAnalysis.housingPortion.monthlyImpact.toLocaleString()}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className="text-xs text-slate-600">חלק לכל מטרה ({analysisResult.savings.equityReleaseAnalysis.splitAnalysis.allPurposePortion.rate}%)</span>
                                  <span className="font-semibold text-purple-700">₪{analysisResult.savings.equityReleaseAnalysis.splitAnalysis.allPurposePortion.monthlyImpact.toLocaleString()}</span>
                                </div>
                              </div>
                              <div className="mt-4 pt-4 border-t-2 border-green-300">
                                <p className="text-xs text-green-700 mb-1">תשלום חודשי חדש:</p>
                                <p className="text-4xl font-black text-green-600">
                                  ₪{analysisResult.savings.equityReleaseAnalysis.splitAnalysis.combinedTotal.totalMonthly.toLocaleString()}
                                </p>
                              </div>
                            </div>
                          </motion.div>
                        </div>

                        {/* 📊 טבלת פירוט מקצועית */}
                        <div className="bg-slate-50 rounded-xl p-4 mb-6">
                          <h4 className="font-bold text-slate-900 mb-3 text-center">📋 פירוט רכיבי המימון</h4>
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="bg-blue-50 border-b-2 border-blue-200">
                                  <th className="text-right py-3 px-4 font-bold text-blue-900">רכיב</th>
                                  <th className="text-center py-3 px-4 font-bold text-blue-900">סכום</th>
                                  <th className="text-center py-3 px-4 font-bold text-blue-900">ריבית</th>
                                  <th className="text-center py-3 px-4 font-bold text-blue-900">החזר חודשי</th>
                                </tr>
                              </thead>
                              <tbody>
                                <tr className="border-b border-slate-200 hover:bg-green-50/50 transition-colors">
                                  <td className="py-3 px-4 font-semibold text-slate-900">
                                    {analysisResult.savings.equityReleaseAnalysis.splitAnalysis.housingPortion.label}
                                  </td>
                                  <td className="text-center py-3 px-4 font-bold text-green-700">
                                    ₪{analysisResult.savings.equityReleaseAnalysis.splitAnalysis.housingPortion.amount.toLocaleString()}
                                  </td>
                                  <td className="text-center py-3 px-4 font-bold text-blue-600">
                                    {analysisResult.savings.equityReleaseAnalysis.splitAnalysis.housingPortion.rate}%
                                  </td>
                                  <td className="text-center py-3 px-4 font-bold text-slate-900">
                                    ₪{analysisResult.savings.equityReleaseAnalysis.splitAnalysis.housingPortion.monthlyImpact.toLocaleString()}
                                  </td>
                                </tr>
                                <tr className="border-b border-slate-200 hover:bg-purple-50/50 transition-colors">
                                  <td className="py-3 px-4 font-semibold text-slate-900">
                                    {analysisResult.savings.equityReleaseAnalysis.splitAnalysis.allPurposePortion.label}
                                  </td>
                                  <td className="text-center py-3 px-4 font-bold text-purple-700">
                                    ₪{analysisResult.savings.equityReleaseAnalysis.splitAnalysis.allPurposePortion.amount.toLocaleString()}
                                  </td>
                                  <td className="text-center py-3 px-4 font-bold text-purple-600">
                                    {analysisResult.savings.equityReleaseAnalysis.splitAnalysis.allPurposePortion.rate}%
                                  </td>
                                  <td className="text-center py-3 px-4 font-bold text-slate-900">
                                    ₪{analysisResult.savings.equityReleaseAnalysis.splitAnalysis.allPurposePortion.monthlyImpact.toLocaleString()}
                                  </td>
                                </tr>
                                <tr className="bg-gradient-to-r from-blue-100 to-purple-100 border-t-2 border-blue-300">
                                  <td className="py-4 px-4 font-bold text-blue-900">סה"כ משכנתא חדשה</td>
                                  <td className="text-center py-4 px-4 font-black text-blue-900">
                                    ₪{analysisResult.savings.equityReleaseAnalysis.splitAnalysis.combinedTotal.totalPrincipal.toLocaleString()}
                                  </td>
                                  <td className="text-center py-4 px-4 font-bold text-blue-700">
                                    {analysisResult.savings.equityReleaseAnalysis.splitAnalysis.combinedTotal.weightedRate}%
                                    <div className="text-xs text-blue-600 font-normal">(ממוצע משוקלל)</div>
                                  </td>
                                  <td className="text-center py-4 px-4 font-black text-blue-900">
                                    ₪{analysisResult.savings.equityReleaseAnalysis.splitAnalysis.combinedTotal.totalMonthly.toLocaleString()}
                                  </td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        </div>

                        {/* 💥 שורת המחץ - מהפך תזרימי */}
                        <motion.div
                          initial={{ scale: 0.9, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          transition={{ delay: 0.6, type: "spring" }}
                          className="bg-gradient-to-r from-green-100 via-emerald-100 to-teal-100 border border-green-500 rounded-2xl p-6 shadow-xl"
                        >
                          <div className="text-center space-y-3">
                            <div className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-full mb-2">
                              <TrendingUp className="w-5 h-5" />
                              <span className="font-bold">מהפך תזרימי</span>
                            </div>
                            <p className="text-base text-slate-900 leading-relaxed">
                              <strong className="text-red-700">לפני:</strong> שילמתם{' '}
                              <span className="font-black text-red-800 text-2xl inline-block px-2 py-1 bg-red-200 rounded">
                                ₪{analysisResult.savings.equityReleaseAnalysis.splitAnalysis.combinedTotal.beforeTotal.toLocaleString()}
                              </span>{' '}
                              על כל החובות
                            </p>
                            <div className="flex items-center justify-center gap-3 my-4">
                              <div className="h-1 w-20 bg-gradient-to-r from-red-500 to-green-500"></div>
                              <span className="text-3xl">→</span>
                              <div className="h-1 w-20 bg-gradient-to-r from-green-500 to-emerald-500"></div>
                            </div>
                            <p className="text-base text-slate-900 leading-relaxed">
                              <strong className="text-green-700">אחרי איחוד ב"מיקוד":</strong> תשלום אחד של{' '}
                              <span className="font-black text-green-800 text-2xl inline-block px-2 py-1 bg-green-200 rounded">
                                ₪{analysisResult.savings.equityReleaseAnalysis.splitAnalysis.combinedTotal.totalMonthly.toLocaleString()}
                              </span>
                            </p>
                            <div className="pt-4 border-t-2 border-green-400 mt-4">
                              <p className="text-sm text-slate-700 mb-2">💰 תוספת נטו לעו"ש בכל חודש:</p>
                              <p className="text-5xl font-black text-green-600">
                                ₪{analysisResult.savings.equityReleaseAnalysis.splitAnalysis.combinedTotal.netSavings.toLocaleString()}
                              </p>
                              <p className="text-xs text-slate-600 mt-2">זה הכסף שנשאר לך לחיים!</p>
                            </div>
                          </div>
                        </motion.div>
                      </motion.div>
                    )}
                    <div className="bg-purple-50 border border-purple-300 rounded-xl p-4">
                      <h3 className="font-bold text-purple-900 mb-3">🎯 המצב הנוכחי שלך</h3>
                      <div className="grid md:grid-cols-3 gap-4">
                        <div className="bg-white rounded-lg p-3">
                          <p className="text-xs text-slate-600 mb-1">משכנתא נוכחית</p>
                          <p className="text-lg font-bold text-slate-900">₪{analysisResult.savings.equityReleaseAnalysis.currentMortgageBalance.toLocaleString()}</p>
                        </div>
                        <div className="bg-white rounded-lg p-3 border border-red-300">
                          <p className="text-xs text-red-700 mb-1">חובות חיצוניים (בנקים/מינוס)</p>
                          <p className="text-lg font-bold text-red-600">₪{analysisResult.savings.equityReleaseAnalysis.totalExternalDebt.toLocaleString()}</p>
                        </div>
                        <div className="bg-white rounded-lg p-3 border border-blue-300">
                          <p className="text-xs text-blue-700 mb-1">שווי הנכס</p>
                          <p className="text-lg font-bold text-blue-600">₪{analysisResult.savings.equityReleaseAnalysis.propertyValue.toLocaleString()}</p>
                        </div>
                      </div>
                    </div>

                    <div className="grid md:grid-cols-2 gap-6">
                      <div className="bg-red-50 border border-red-300 rounded-xl p-4">
                        <h4 className="font-bold text-red-900 mb-2">❌ לפני - תזרים יוצא חודשי</h4>
                        <p className="text-3xl font-bold text-red-600 mb-3">₪{analysisResult.savings.equityReleaseAnalysis.currentMonthlyBurden.toLocaleString()}</p>
                        <div className="text-xs text-red-800 space-y-1">
                          <p>• משכנתא: ₪{analysisResult.currentLoan.monthlyPayment.toLocaleString()}</p>
                          {analysisResult.savings.equityReleaseAnalysis.externalDebts.map((debt, i) => (
                            <p key={i}>• {debt.creditor}: ₪{debt.monthly_repayment.toLocaleString()} ({debt.estimated_interest}%)</p>
                          ))}
                        </div>
                      </div>

                      <div className="bg-green-50 border border-green-300 rounded-xl p-4">
                        <h4 className="font-bold text-green-900 mb-2">✅ אחרי - תשלום חודשי אחד</h4>
                        <p className="text-3xl font-bold text-green-600 mb-3">₪{analysisResult.savings.equityReleaseAnalysis.newMonthlyPayment.toLocaleString()}</p>
                        <div className="text-xs text-green-800 space-y-1">
                          <p>• ריבית משוערת: {analysisResult.savings.equityReleaseAnalysis.allPurposeRate}%</p>
                          <p>• פריסה: 20 שנה</p>
                          <p>• כל החובות מאוחדים למשכנתא אחת</p>
                        </div>
                      </div>
                    </div>

                    <div className={`rounded-xl p-6 text-center ${
                      analysisResult.savings.equityReleaseAnalysis.monthlyCashFlowImprovement > 0
                        ? 'bg-gradient-to-r from-green-100 to-emerald-100 border border-green-400'
                        : 'bg-gradient-to-r from-red-100 to-orange-100 border border-red-400'
                    }`}>
                      <p className="text-sm font-semibold mb-2">🚀 שיפור תזרים חודשי</p>
                      <p className={`text-5xl font-black ${
                        analysisResult.savings.equityReleaseAnalysis.monthlyCashFlowImprovement > 0 ? 'text-green-600' : 'text-red-600'
                      }`}>
                        {analysisResult.savings.equityReleaseAnalysis.monthlyCashFlowImprovement > 0 ? '+' : ''}
                        ₪{Math.abs(analysisResult.savings.equityReleaseAnalysis.monthlyCashFlowImprovement).toLocaleString()}
                      </p>
                      <p className="text-xs text-slate-700 mt-2">
                        {analysisResult.savings.equityReleaseAnalysis.monthlyCashFlowImprovement > 0
                          ? 'כסף נוסף לעו״ש שלך בכל חודש!'
                          : 'שים לב: התשלום החודשי יגדל'}
                      </p>
                    </div>

                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <AlertCircle className="w-5 h-5 text-blue-600" />
                        <h4 className="font-bold text-blue-900">📊 אחוז מימון (LTV)</h4>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="flex-1 bg-slate-200 rounded-full h-4">
                          <div
                            className={`h-4 rounded-full transition-all ${
                              analysisResult.savings.equityReleaseAnalysis.status === 'HEALTHY_LTV' ? 'bg-green-500' :
                              analysisResult.savings.equityReleaseAnalysis.status === 'MODERATE_LTV' ? 'bg-yellow-500' :
                              'bg-red-500'
                            }`}
                            style={{width: `${Math.min(analysisResult.savings.equityReleaseAnalysis.ltvRatio, 100)}%`}}
                          />
                        </div>
                        <span className="font-bold text-2xl text-blue-900">{analysisResult.savings.equityReleaseAnalysis.ltvRatio}%</span>
                      </div>
                      <p className="text-xs text-blue-800 mt-2">
                        {analysisResult.savings.equityReleaseAnalysis.status === 'HEALTHY_LTV' && '✅ בטווח בריא (עד 50%) - סיכוי גבוה לאישור'}
                        {analysisResult.savings.equityReleaseAnalysis.status === 'MODERATE_LTV' && '⚠️ בטווח בינוני (50-70%) - דורש חיתום מדוקדק'}
                        {analysisResult.savings.equityReleaseAnalysis.status === 'HIGH_RISK_LTV' && '🚨 LTV גבוה (מעל 70%) - סיכוי נמוך לאישור'}
                      </p>
                    </div>

                    <div className="bg-amber-50 border border-amber-300 rounded-lg p-4">
                      <p className="text-sm text-amber-900 leading-relaxed">
                        💡 <strong>חשוב לדעת:</strong> הלוואה לכל מטרה נושאת ריבית גבוהה יותר ממשכנתא רגילה (כ-{analysisResult.savings.equityReleaseAnalysis.allPurposeRate}% לעומת ~5% בדיור),
                        אבל היא מאפשרת לך לשחרר את הנכס שלך ולסגור חובות יקרים (כרטיסי אשראי, מינוס וכו').
                        {analysisResult.savings.equityReleaseAnalysis.monthlyCashFlowImprovement > 2000 &&
                          ` במקרה שלך, התזרים משתפר ב-₪${analysisResult.savings.equityReleaseAnalysis.monthlyCashFlowImprovement.toLocaleString()} בחודש - זה יכול לשנות את איכות החיים שלך!`
                        }
                      </p>
                    </div>
                  </CardContent>
                </Card>
              )}

              {mixPresentation.hasMixes && (
                <>
                  <MixComparison
                    mixes={refinanceMixes}
                    loanAmount={analysisResult.currentLoan?.remainingBalance}
                    isRefinance
                    isPurchased={isPurchased}
                  />
                  {isPurchased && (
                    <div className="flex justify-center">
                      <Button
                        onClick={() => { setIsDownloadingPdf(true); setPdfTrigger(t => t + 1); }}
                        disabled={isDownloadingPdf}
                        className="flex items-center gap-2 h-14 px-6 bg-[#0C084A] hover:bg-[#0153F4] text-white font-semibold text-lg rounded-full shadow-md transition-all active:scale-95"
                      >
                        {isDownloadingPdf ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
                        {isDownloadingPdf ? 'מייצר PDF...' : 'הורד דוח PDF'}
                      </Button>
                    </div>
                  )}
                </>
              )}
              </div>
                    </div>
                  </div>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      </main>
      <FooterCTA />
      <MortgageChatbot isOpen={isChatOpen} setIsOpen={setIsChatOpen} />
    </div>
  );
}
