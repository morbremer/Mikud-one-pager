import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  User, Home, AlertCircle, ChevronLeft, Loader2, Phone,
  Building2, Sparkles, Mail, BadgeCheck, Check,
  Coins, TrendingDown,
  Lock, Key, Target, ShieldAlert, X, UserPlus, Trash2
} from 'lucide-react';
import { appClient } from '@/api/appClient';
import {
  DEFAULT_RATES, formatCurrency, calculatePayment, cleanAiText,
  getReverseMortgageMaxLTV, calcTotalIncome, calculateResults, calculateRefinanceResults,
  SENIOR_BANK_MAX_LTV, SENIOR_BANK_MAX_TERM, BALLOON_MAX_TERM,
} from '@/components/mortgage/mortgageUtils';
import PremiumInput from '@/components/mikud/PremiumInput';
import { Checkbox } from '@/components/ui/checkbox';
import MixComparison from '@/components/mikud/MixComparison';
import MikoChat from '@/components/mikud/MikoChat';
import BankLogosCarousel from '@/components/mikud/BankLogosCarousel';
import HeroStepsShowcase from '@/components/mikud/HeroStepsShowcase';
import BeforeAfterSavings from '@/components/mikud/BeforeAfterSavings';
import NegotiationPack from '@/components/mikud/NegotiationPack.jsx';
import BorrowerForm from '@/components/mikud/BorrowerForm';
import ExistingPropertyForm from '@/components/mikud/ExistingPropertyForm';
import EquityCompletionForm from '@/components/mikud/EquityCompletionForm';
import SocialProof from '@/components/mikud/SocialProof';
import AdvisorComparison from '@/components/mikud/AdvisorComparison';
import FooterCTA from '@/components/mikud/FooterCTA';
import BirthDateInput from '@/components/mikud/BirthDateInput';
import Amount from '@/components/mikud/Amount';
import CelebratingScoreBadge from '@/components/mikud/CelebratingScoreBadge';
import MikudHeader from '@/components/mikud/MikudHeader';
import ProfessionalAnalysis from '@/components/mikud/ProfessionalAnalysis';
import { EMAIL_VERIFICATION_ENABLED, PAYMENT_BYPASS_ENABLED } from '@/lib/demoMode';
import CardComPaymentModal from '@/components/payment/CardComPaymentModal';
import { useCardComPayment } from '@/hooks/useCardComPayment';


// v2.2
const TODAY_DATE = new Date().toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' });

// טקסט דמו לבדיקה מקומית בלבד (מצב ?demo=1) — לבדיקת הרחבה/כיווץ של ניתוח מקצועי מלא
const DEMO_AI_ANALYSIS = `התיק שלך עומד בדרישות הבסיסיות של הבנקים, ונראה שיש לך סיכוי טוב לקבל אישור עקרוני למשכנתא המבוקשת.
יש לך כמה נקודות חוזק משמעותיות: הכנסה יציבה, היסטוריית אשראי נקייה, ואחוז המימון מהנכס (כמה מהדירה ממומן בהלוואה מתוך השווי שלה) נמוך יחסית ועומד על 75%, מה שנחשב תמהיל בטוח בעיני הבנק.
כדי לחזק עוד יותר את התיק, כדאי לשקול להקטין מעט את סכום ההלוואה המבוקש או להאריך את תקופת ההחזר, כך שההחזר החודשי יהיה נוח יותר ביחס להכנסה שלך.
בהתחשב בכל הנתונים, אנחנו מעריכים שהסיכוי לאישור גבוה, וממליצים להתקדם להגשה לבנק בהקדם כדי לנצל את התנאים הנוכחיים בשוק.`;

export default function MortgageCalculator() {
  const [step, setStep] = useState(1);
  const mainRef = useRef(null);
  const didMountRef = useRef(false);
  const [loading, setLoading] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState(null);
  const [aiInsights, setAiInsights] = useState(null);
  const [insightLoading, setInsightLoading] = useState(false);
  const [bankerEmail, setBankerEmail] = useState("");
  const [isPurchased, setIsPurchased] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [codeSent, setCodeSent] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false);
  const [userInputCode, setUserInputCode] = useState("");
  const [isSendingCode, setIsSendingCode] = useState(false);
  const [isVerifyingCode, setIsVerifyingCode] = useState(false);
  const [birthDateInvalid, setBirthDateInvalid] = useState(false);
  const [heroStarted, setHeroStarted] = useState(false);
  const [currentLeadId, setCurrentLeadId] = useState(null);
  const [rates, setRates] = useState(DEFAULT_RATES);

  const [showCreditModal, setShowCreditModal] = useState(false);
  const [showSpouseReminderModal, setShowSpouseReminderModal] = useState(false);
  // Move focus into each modal's dialog container when it opens, so screen
  // reader users land on it instead of it opening silently behind the backdrop.
  const spouseReminderModalRef = useRef(null);
  const creditModalRef = useRef(null);
  useEffect(() => { if (showSpouseReminderModal) spouseReminderModalRef.current?.focus(); }, [showSpouseReminderModal]);
  useEffect(() => { if (showCreditModal) creditModalRef.current?.focus(); }, [showCreditModal]);
  const [demoPending, setDemoPending] = useState(false);
  const [formData, setFormData] = useState({
    firstName: '', lastName: '', phone: '', email: '', idNumber: '', birthDate: '', consent: false, creditConsent: false,
    mortgageType: 'purchase_first', loanDuration: '25', seniorBalloon: false, balloonExitStrategy: '',
    propertyPrice: '', loanAmount: '',
    monthlyDebts: '0', monthlyOverdraft: '0', equity: '',
    willRentPurchased: 'no', rentIncomeFromPurchased: '',
    youngestBorrowerAge: '',
    // שדות מחזור
    refinanceBalance: '', currentMonthlyPayment: '', refinanceRemainingYears: '20', refinanceGoal: 'savings',
    refinanceCanIncreasePayment: 'no', refinanceIncreaseAmount: '',
  });

  const {
    paymentLoading,
    paymentNotice,
    paymentUrl,
    handlePurchaseClick,
    handlePaymentModalClose,
  } = useCardComPayment({
    leadId: currentLeadId,
    onPaid: () => setIsPurchased(true),
  });

  const defaultBorrower = () => ({
    maritalStatus: 'single',
    childrenUnder18: '0',
    creditHistory: 'clean',
    employmentTypes: ['employee'],
    incomeSources: {},
    youngestBorrowerAge: '',
    borrowerType: 'primary', // primary | additional
  });

  const [borrowers, setBorrowers] = useState([defaultBorrower()]);
  const [activeBorrowerTab, setActiveBorrowerTab] = useState(0);
  const [existingProperties, setExistingProperties] = useState([{}]);
  const [equityCompletion, setEquityCompletion] = useState({});

  const updateBorrower = (index, data) => {
    setBorrowers(prev => prev.map((b, i) => i === index ? data : b));
  };

  const handleMaritalChange = (maritalStatus) => {
    const isMarried = maritalStatus === 'married';
    setBorrowers(prev => {
      const hasSpouse = prev.length > 1 && prev[1].isSpouse;
      if (isMarried && !hasSpouse) {
        // הוסף לווה בן/בת זוג אוטומטית
        return [...prev, { ...defaultBorrower(), borrowerType: 'primary', isSpouse: true }];
      } else if (!isMarried && hasSpouse) {
        // הסר לווה בן/בת זוג אוטומטית
        return [prev[0]];
      }
      return prev;
    });
  };

  const addBorrower = () => {
    setBorrowers(prev => [...prev, { ...defaultBorrower(), borrowerType: 'primary' }]);
    setActiveBorrowerTab(borrowers.length);
  };

  const removeBorrower = (index) => {
    if (borrowers.length <= 1) return;
    // אם מסיר בן/בת זוג — עדכן גם מצב משפחתי ללווה ראשון
    if (borrowers[index]?.isSpouse) {
      setBorrowers(prev => {
        const updated = [{ ...prev[0], maritalStatus: 'single' }];
        return updated;
      });
      setActiveBorrowerTab(0);
      return;
    }
    setBorrowers(prev => prev.filter((_, i) => i !== index));
    setActiveBorrowerTab(Math.max(0, activeBorrowerTab - 1));
  };

  // fullName computed for display/save
  const fullName = `${formData.firstName || ''} ${formData.lastName || ''}`.trim();

  // wrapper נוח לשימוש ב-component בלי להעביר borrowers בכל פעם
  const getTotalIncome = () => calcTotalIncome(borrowers);

  useEffect(() => {
    const loadRates = async () => {
      try {
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000));
        const response = await Promise.race([
          appClient.functions.invoke('getBankOfIsraelRates'),
          timeoutPromise
        ]);
        if (response.data?.success && response.data?.rates) {
          setRates(response.data.rates);
        }
      } catch (error) {
        console.error('Failed to load rates, using defaults:', error);
      }
    };
    loadRates();
  }, []);

  // קיצור דרך לבדיקה מקומית בלבד: ?demo=1 בכתובת ממלא נתוני דמו וקופץ ישר לדוח
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    if (new URLSearchParams(window.location.search).get('demo') !== '1') return;
    setFormData(prev => ({
      ...prev,
      firstName: 'מור', lastName: 'ברמר', idNumber: '200000008', birthDate: '1990-06-15', age: '36',
      phone: '0501234567', email: 'test@example.com', consent: true, creditConsent: true,
      mortgageType: 'purchase_first', propertyPrice: '1200000', loanAmount: '900000',
    }));
    setBorrowers(prev => {
      const b = [...prev];
      b[0] = { ...b[0], maritalStatus: 'single', creditHistory: 'clean', employmentTypes: ['employee'], incomeSources: { employee: { amount: '25000' } } };
      return b;
    });
    setIsPurchased(true);
    setDemoPending(true);
  }, []);

  useEffect(() => {
    if (demoPending) {
      setStep(7);
      setAiAnalysis(DEMO_AI_ANALYSIS);
      setDemoPending(false);
    }
  }, [demoPending]);

  const isReverseMortgage = formData.mortgageType === 'reverse_mortgage';
  const isSeniorBankMortgage = formData.mortgageType === 'senior_bank';

  const ALL_PURPOSE_RATES = useMemo(() => ({
    FIXED_UNLINKED: (rates.FIXED_UNLINKED || 0.0470) + 0.004,
    VAR_LINKED: (rates.VAR_LINKED || 0.0315) + 0.003,
    PRIME_CALC: rates.PRIME_CALC || 0.0490,
  }), [rates]);

  const maxTerm = useMemo(() => {
    if (isSeniorBankMortgage && formData.seniorBalloon) return BALLOON_MAX_TERM;
    if (isSeniorBankMortgage) return SENIOR_BANK_MAX_TERM;
    const ageNum = Number(formData.age) || 35;
    return Math.min(30, Math.max(1, 85 - ageNum));
  }, [formData.age, isSeniorBankMortgage, formData.seniorBalloon]);

  const handleInputChange = (name, value) => {
    setFormData(prev => ({ ...prev, [name]: value }));
    if (fieldErrors[name]) setFieldErrors(prev => ({ ...prev, [name]: null }));
  };

  const scrollToTop = () => window.scrollTo({ top: 0, behavior: 'smooth' });

  // Whenever the user moves forward/back between form steps, bring the top of
  // the <main> content area into view. Skip the initial mount so the hero above
  // the form stays visible on first load.
  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    mainRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [step]);

  const startVerification = async () => {
    const errors = {};
    if (!formData.firstName || formData.firstName.trim().length < 2) errors.firstName = "אנא הזן שם פרטי תקין";
    if (!formData.lastName || formData.lastName.trim().length < 2) errors.lastName = "אנא הזן שם משפחה תקין";
    if (!/^05\d{8}$/.test(formData.phone)) errors.phone = "טלפון נייד לא תקין (10 ספרות)";
    
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(formData.email)) errors.email = "נא להזין כתובת אימייל אמיתית ותקינה";
    
    if (!/^\d{9}$/.test(formData.idNumber)) {
      errors.idNumber = "ת.ז לא תקינה (9 ספרות)";
    } else {
      // אלגוריתם לוהן לבדיקת תקינות ת.ז ישראלית
      let idSum = 0;
      for (let i = 0; i < 9; i++) {
        let d = Number(formData.idNumber[i]) * ((i % 2) + 1);
        if (d > 9) d -= 9;
        idSum += d;
      }
      if (idSum % 10 !== 0) errors.idNumber = "מספר ת.ז לא תקין — אנא הזן ת.ז אמיתית";
    }
    
    // חישוב גיל מ-input type=date
    if (!formData.birthDate) {
      errors.birthDate = "נא להזין תאריך לידה";
    } else {
      const [by, bm, bd] = formData.birthDate.split('-').map(Number);
      const birthDate = new Date(formData.birthDate);
      // מוודא שהתאריך לא "גלש" (למשל 30 בפברואר שהופך למרץ) ושהוא בכלל תקין
      const isValidCalendarDate = !isNaN(birthDate.getTime()) && birthDate.getFullYear() === by && birthDate.getMonth() + 1 === bm && birthDate.getDate() === bd;
      if (!isValidCalendarDate) {
        errors.birthDate = "תאריך לידה לא תקין";
      } else {
        const today = new Date();
        let age = today.getFullYear() - birthDate.getFullYear();
        const monthDiff = today.getMonth() - birthDate.getMonth();
        if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) age--;
        if (age < 18 || age > 100) {
          errors.birthDate = "גיל לא תקין (18–100)";
        } else {
          setFormData(prev => ({ ...prev, age: age.toString() }));
        }
      }
    }
    
    if (!formData.consent) errors.consent = "חובה לאשר יצירת קשר";

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    // אימות מייל מושבת — מדלגים על שליחת הקוד ומציגים את מסך האימות (כל ערך יעבור)
    if (!EMAIL_VERIFICATION_ENABLED) {
      setUserInputCode("");
      setCodeSent(true);
      savePartialLead();
      scrollToTop();
      return;
    }
    // שליחת קוד אימות אמיתי לכתובת הדוא״ל — הקוד נוצר ונבדק בצד השרת בלבד
    setIsSendingCode(true);
    try {
      await appClient.functions.invoke('sendEmailVerification', { email: formData.email });
      setUserInputCode("");
      setCodeSent(true);
      // שמירת ליד חלקי ראשוני ברגע בקשת קוד האימות (פרטי קשר הוזנו) — לשיחת המשך.
      // בבקשת קוד חוזרת באותו סשן זה מעדכן את אותו הליד ולא יוצר כפילות.
      savePartialLead();
      scrollToTop();
    } catch (err) {
      const cooldown = err?.response?.status === 429;
      setFieldErrors({
        email: cooldown
          ? "נשלח קוד לאחרונה — המתן מספר שניות ונסה שוב"
          : "שליחת קוד האימות נכשלה, נסה שוב",
      });
    } finally {
      setIsSendingCode(false);
    }
  };

  const verifyEmailCode = async () => {
    // אימות מייל מושבת — כל ערך מאפשר להמשיך
    if (!EMAIL_VERIFICATION_ENABLED) {
      setEmailVerified(true);
      setStep(2);
      return;
    }
    setIsVerifyingCode(true);
    try {
      const res = await appClient.functions.invoke('verifyEmailCode', {
        email: formData.email,
        code: userInputCode,
      });
      if (res?.data?.verified || res?.verified) {
        setEmailVerified(true);
        setStep(2);
        return;
      }
      const reason = res?.data?.reason || res?.reason;
      const messages = {
        expired: "הקוד פג תוקף, שלח קוד חדש",
        too_many_attempts: "יותר מדי ניסיונות, שלח קוד חדש",
      };
      setFieldErrors({ otp: messages[reason] || "קוד שגוי" });
    } catch {
      setFieldErrors({ otp: "אירעה שגיאה באימות, נסה שוב" });
    } finally {
      setIsVerifyingCode(false);
    }
  };

  const validateStep = (currentStep) => {
    const errors = {};
    if (currentStep === 2 && !formData.age) errors.age = "חובה להזין גיל";
    if (currentStep === 2 && isReverseMortgage && !formData.youngestBorrowerAge) errors.youngestBorrowerAge = "חובה להזין גיל הלווה הצעיר ביותר";
    if (currentStep === 2 && isReverseMortgage && Number(formData.youngestBorrowerAge) < 60) errors.youngestBorrowerAge = "מינימום גיל 60 למשכנתא לגיל הזהב";
    if (currentStep === 3 && !isRefinance && !formData.propertyPrice) errors.propertyPrice = "חובה להזין שווי נכס";
    if (currentStep === 3 && !isRefinance && !formData.loanAmount) errors.loanAmount = "חובה להזין סכום מבוקש";
    if (currentStep === 3 && isRefinance && !formData.refinanceBalance) errors.refinanceBalance = "חובה להזין יתרת משכנתא";
    if (currentStep === 3 && isRefinance && !formData.currentMonthlyPayment) errors.currentMonthlyPayment = "חובה להזין החזר חודשי נוכחי";
    if (currentStep === 4 && !isReverseMortgage && getTotalIncome() <= 0) errors.netIncome = "חובה להזין הכנסה לפחות ללווה אחד";
    if (currentStep === 4 && formData.willRentPurchased === 'yes' && Number(String(formData.rentIncomeFromPurchased || '0').replace(/,/g, '')) <= 0) errors.rentIncomeFromPurchased = "חובה להזין את הכנסת השכירות הצפויה";
    if (currentStep === 5 && !isReverseMortgage && !isRefinance && equityGap > 0) errors.equity = `נדרשת השלמת הון עצמי נוסף בסך ₪${new Intl.NumberFormat('he-IL').format(equityGap)}`;
    setFieldErrors(errors);
    return Object.keys(errors).filter(k => errors[k]).length === 0;
  };

  const isRefinance = formData.mortgageType === 'refinance';

  // האם נדרשים נתוני נכס קיים (כל סוג עסקה חוץ מדירה ראשונה ומחזור)
  const needsExistingProperty = !isRefinance && !isReverseMortgage && !isSeniorBankMortgage &&
    ['purchase_improve', 'purchase_additional', 'any_purpose'].includes(formData.mortgageType);

  // נכס קיים ראשון (backward compat לטפסים שמשתמשים ב-existingProperty יחיד)
  const existingProperty = existingProperties[0] || {};
  const setExistingProperty = (val) => setExistingProperties(prev => [val, ...prev.slice(1)]);

  // סה"כ החזרים חודשיים של נכסים קיימים (ללא הסכם מכירה)
  const totalExistingMortgagePayments = existingProperties.reduce((acc, prop) => {
    if (prop.hasExistingMortgage === 'yes' && prop.existingMortgagePayment && prop.hasSaleAgreement !== 'yes') {
      return acc + Number(String(prop.existingMortgagePayment || '0').replace(/,/g, ''));
    }
    return acc;
  }, 0);

  const addExistingProperty = () => setExistingProperties(prev => [...prev, {}]);
  const removeExistingProperty = (idx) => setExistingProperties(prev => prev.filter((_, i) => i !== idx));
  const updateExistingProperty = (idx, val) => setExistingProperties(prev => prev.map((p, i) => i === idx ? val : p));

  // סך הון עצמי = הון עצמי נזיל + סכום מכל מקורות ההשלמה שסומנו
  const totalEquity = useMemo(() => {
    const base = Number(String(equityCompletion.equity || formData.equity || '0').replace(/,/g, ''));
    const sourceAmounts = equityCompletion.sourceAmounts || {};
    const completion = Object.values(sourceAmounts).reduce((sum, v) => sum + Number(String(v || '0').replace(/,/g, '')), 0);
    return base + completion;
  }, [equityCompletion.equity, equityCompletion.sourceAmounts, formData.equity]);

  // סך ההון העצמי הנדרש לעסקה (ללא תלות במה שכבר הוזן)
  const requiredEquity = useMemo(() => {
    if (isRefinance || isReverseMortgage) return 0;
    const price = Number(String(formData.propertyPrice || '0').replace(/,/g, ''));
    const loan = Number(String(formData.loanAmount || '0').replace(/,/g, ''));
    if (!price || !loan) return 0;
    return Math.max(0, price - loan);
  }, [formData.propertyPrice, formData.loanAmount, isRefinance, isReverseMortgage]);

  // חישוב פער השלמת עסקה (מה שעוד חסר לאחר מה שכבר הוזן)
  const equityGap = useMemo(() => {
    return Math.max(0, requiredEquity - totalEquity);
  }, [requiredEquity, totalEquity]);

  const results = useMemo(() => {
    try {
      // צרף את ההחזרים על נכסים קיימים (ללא הסכם מכירה) לחובות החודשיים
      const adjustedDebts = Number(String(formData.monthlyDebts || '0').replace(/,/g, '')) + totalExistingMortgagePayments;
      const adjustedFormData = needsExistingProperty && totalExistingMortgagePayments > 0
        ? { ...formData, monthlyDebts: String(adjustedDebts) }
        : formData;
      if (isRefinance) {
        return calculateRefinanceResults({ formData: adjustedFormData, borrowers, rates });
      }
      // שלב את סך ההון העצמי (כולל השלמות) לחישוב
      const formDataWithTotalEquity = totalEquity > 0
        ? { ...adjustedFormData, equity: String(totalEquity) }
        : adjustedFormData;
      return calculateResults({ formData: formDataWithTotalEquity, borrowers, maxTerm, rates, ALL_PURPOSE_RATES });
    } catch (e) {
      console.error('results calculation error:', e);
      return { loanAmount: 0, ltv: 0, dti: 0, score: 0, status: { color: 'green', text: '', subtitle: '', action: null, icon: 'check' }, mixA: { tracks: [], total: 0 }, mixB: { tracks: [], total: 0 }, mixC: { tracks: [], total: 0 }, actualDuration: 25, isReverse: false, isSenior: false, isBalloon: false };
    }
  }, [formData, borrowers, maxTerm, rates, ALL_PURPOSE_RATES, isRefinance, totalExistingMortgagePayments, needsExistingProperty, totalEquity]);

  // בונה את מטען הנתונים של הליד מהמצב הנוכחי של הטופס (משותף לשמירה חלקית ולסופית)
  /** @param {{ status?: string, aiAnalysis?: string }} [opts] */
  const buildLeadPayload = ({ status, aiAnalysis: analysisText } = {}) => ({
    fullName,
    phone: formData.phone,
    email: formData.email,
    emailVerified,
    idNumber: formData.idNumber,
    birthDate: formData.birthDate,
    age: formData.age ? Number(formData.age) : undefined,
    mortgageType: formData.mortgageType,
    loanDuration: isRefinance ? results.remainingYears : (formData.loanDuration ? Number(formData.loanDuration) : undefined),
    loanAmount: isRefinance ? results.balance : results.loanAmount,
    propertyPrice: isRefinance ? undefined : (formData.propertyPrice ? Number(String(formData.propertyPrice).replace(/,/g,'')) : undefined),
    equity: isRefinance ? undefined : (formData.equity ? Number(String(formData.equity).replace(/,/g,'')) : undefined),
    monthlyDebts: formData.monthlyDebts ? Number(String(formData.monthlyDebts).replace(/,/g,'')) : 0,
    ltv: isRefinance ? 0 : results.ltv,
    score: results.score,
    netIncome: getTotalIncome(),
    // שדות מחזור
    ...(isRefinance ? {
      refinanceBalance: results.balance,
      currentMonthlyPayment: results.currentMonthly,
      refinanceRemainingYears: results.remainingYears,
    } : {}),
    ...(analysisText !== undefined ? { aiAnalysis: analysisText } : {}),
    isPurchased: false,
    status,
  });

  // שמירת ליד חלקי (ליד "לא הושלם" שמתעדכן בכל שלב) — fire-and-forget, לעולם לא חוסם ניווט.
  // הזהות נקבעת לפי currentLeadId של הסשן הנוכחי בלבד; אין חיפוש/מיזוג לפי טלפון/ת.ז,
  // כך שכל מילוי חוזר של הטופס נשמר כליד חדש ואינו דורס נתונים קיימים.
  const savePartialLead = async () => {
    try {
      if (!currentLeadId) {
        const lead = await appClient.entities.Lead.create(buildLeadPayload({ status: 'partial' }));
        setCurrentLeadId(lead.id);
      } else {
        await appClient.entities.Lead.update(currentLeadId, buildLeadPayload({ status: 'partial' }));
      }
    } catch (err) {
      console.error('savePartialLead failed:', err);
    }
  };

  const generateFullAnalysis = async () => {
    if (!isRefinance && !validateStep(6)) return;
    setLoading(true);
    setStep(7);
    
    const borrowersSummary = borrowers.map((b, i) => {
      const types = (b.employmentTypes || []).join(', ');
      const sources = b.incomeSources || {};
      const factor = i > 0 && b.borrowerType === 'additional' ? 0.5 : 1;
      // Breakdown per income type
      const breakdown = Object.entries(sources)
        .filter(([, src]) => src && (src.amount || src.enabled))
        .map(([type, src]) => {
          const amt = Number(String(src.amount || '0').replace(/,/g, ''));
          const sen = src.seniority ? `, ותק: ${src.seniority} שנים` : '';
          const typeLabel = { employee: 'שכיר', self_employed: 'עצמאי', pensioner: 'פנסיה', controlling_shareholder: 'בעל שליטה', foreign_income: 'הכנסה מחו"ל' }[type] || type;
          return `  - ${typeLabel}: ₪${formatCurrency(amt)}${sen}`;
        }).join('\n');
      const totalB = Object.values(sources).reduce((acc, src) => acc + Number(String(src?.amount || '0').replace(/,/g, '')), 0);
      return `לווה ${i+1}: ${b.borrowerType === 'additional' ? 'נוסף (50%)' : 'עיקרי'}, סוגי הכנסה: ${types}\n${breakdown}\n  סה"כ מוכר לבנק: ₪${formatCurrency(totalB * factor)}`;
    }).join('\n');
    const isRefinanceFlow = isRefinance;

    // פרופיל הלווים המפורט
    const primaryBorrower = borrowers[0] || {};
    const maritalLabel = { single: 'רווק/ה', married: 'נשוי/אה', divorced: 'גרוש/ה', widowed: 'אלמן/ה' }[primaryBorrower.maritalStatus] || '';
    const creditLabel = primaryBorrower.creditHistory === 'clean' ? 'תקינה ללא הערות' : primaryBorrower.creditHistory === 'minor_issues' ? 'עם הערות קלות' : 'עם בעיות בעבר';
    const empTypes = (primaryBorrower.employmentTypes || []).join(', ');

    const prompt = isRefinanceFlow
      ? `אתה יועץ משכנתאות ותיק עם 20 שנות ניסיון בישראל. לפניך בקשת מחזור משכנתא מפורטת. כתוב ניתוח מקצועי שיועיל ללקוח וגם לבנקאי שיקרא אותו.

===פרטי הלקוח===
שם: ${fullName} | גיל: ${formData.age} | מצב משפחתי: ${maritalLabel}
היסטוריית אשראי: ${creditLabel}
${borrowersSummary}
הכנסה כוללת מוכרת לבנק: ₪${Math.floor(getTotalIncome()).toLocaleString()}

===נתוני משכנתא קיימת===
יתרת קרן: ₪${results.balance?.toLocaleString()}
החזר חודשי נוכחי: ₪${results.currentMonthly?.toLocaleString()}
ריבית ממוצעת קיימת (משוערת): ${results.impliedRate?.toFixed(2)}%
שנים שנותרו: ${results.remainingYears}

===תוצאות ניתוח המחזור===
חיסכון חודשי בתמהיל המומלץ: ₪${results.monthlySaving?.toLocaleString()}
חיסכון כולל לאורך הקופה: ₪${results.totalSaving?.toLocaleString()}
נקודת האיזון (break-even): ${results.breakEvenMonths ? results.breakEvenMonths + ' חודשים' : 'מיידי'}
${results.canIncrease && results.increaseAmount > 0 ? `הלקוח מעוניין להגדיל החזר ב-₪${formatCurrency(results.increaseAmount)} לחודש לקיצור תקופה` : ''}

כתוב ניתוח בפורמט הבא (ללא כוכביות, ללא Markdown):
1. המלצת מחזור — כן או לא ומדוע (2-3 משפטים)
2. ניתוח ריבית קיימת מול שוק — האם הלקוח משלם יותר מהמקובל?
3. השוואת 3 תמהילים: א) קבועה מלאה ב) מאוזן ג) ${results.canIncrease && results.increaseAmount > 0 ? 'הגדלת החזר לקיצור תקופה' : 'פריים+קבועה'}
4. פרופיל סיכון הלקוח וההמלצה האסטרטגית
5. שלבי ביצוע מעשיים (3-4 נקודות)
ענה בעברית בלבד, שפה מקצועית אך ברורה ללקוח.`
      : `אתה יועץ משכנתאות ותיק עם 20 שנות ניסיון בישראל. לפניך תיק לקוח מלא לניתוח. הניתוח ישמש גם את הלקוח להבנה וגם את הבנקאי לאישור — כתוב בהתאם.

===פרטי הלקוח===
שם: ${fullName} | גיל: ${formData.age} | מצב משפחתי: ${maritalLabel}
ילדים מתחת ל-18: ${primaryBorrower.childrenUnder18 || 0}
היסטוריית אשראי: ${creditLabel}
סוג תעסוקה: ${empTypes}
${borrowersSummary}
הכנסה כוללת מוכרת לבנק: ₪${Math.floor(getTotalIncome()).toLocaleString()}

===פרטי הנכס והמשכנתא===
שווי נכס: ₪${Number(String(formData.propertyPrice||0).replace(/,/g,'')).toLocaleString()}
סכום מבוקש: ₪${results.loanAmount?.toLocaleString()}
הון עצמי: ₪${Number(String(formData.equity||0).replace(/,/g,'')).toLocaleString()}
LTV: ${results.ltv?.toFixed(1)}%
${!results.isReverse ? `DTI: ${results.dti?.toFixed(1)}% (תקן בנק ישראל: עד 40%)` : 'משכנתא הפוכה — ללא חובת DTI'}
תקופה: ${results.actualDuration ?? formData.loanDuration} שנים
סוג עסקה: ${formData.mortgageType}
חובות חודשיים קיימים: ₪${formatCurrency(Number(String(formData.monthlyDebts || 0).replace(/,/g, '')))}

===ציון האיכות של התיק===
${results.score}/100

כתוב ניתוח קצר וברור ב-3-4 פסקאות קצרות ורציפות בלבד (ללא כותרות, ללא מספור, ללא כוכביות, ללא Markdown, ללא נקודות רשימה). כל פסקה מופרדת בשורה חדשה.
כתוב בשפה פשוטה ויומיומית, כאילו אתה מסביר ללקוח שאינו בקיא בעולם הפיננסי. הימנע ממונחים מקצועיים ללא הסבר — אם אתה מזכיר מונח כמו LTV או DTI, כתוב אותו תמיד בעברית עם הסבר קצר בסוגריים (למשל: "אחוז המימון מהנכס (כמה מהדירה ממומן בהלוואה מתוך השווי שלה)" או "יחס ההחזר מההכנסה (כמה מהמשכורת החודשית הולכת להחזר המשכנתא)").
פסקה 1: האם התיק כשיר להגשה לבנק ומה רמת הסיכון, בשפה פשוטה וברורה.
פסקה 2: מה הנקודות החזקות בתיק.
פסקה 3: מה אפשר לשפר כדי לקבל תנאים טובים יותר.
פסקה 4: מה הסיכוי לאישור וההמלצה שלנו להגשה.
ענה בעברית בלבד, בטון חם ואישי אך מקצועי.`;
    
    const emailPrompt = isRefinanceFlow
      ? `כתוב מכתב פנייה מקצועי לבנקאי עבור לקוח בשם ${fullName}, גיל ${formData.age}, המבקש מחזור משכנתא.
יתרה קיימת: ₪${formatCurrency(results.balance)} | ריבית קיימת: ${results.impliedRate?.toFixed(2)}% | חיסכון צפוי: ₪${formatCurrency(results.monthlySaving)} לחודש.
המכתב צריך: פנייה רשמית, פרטי התיק בטבלה, נקודות חוזק הלקוח, בקשה להצעת ריבית.
ענה בעברית בלבד, פורמט מכתב עסקי.`
      : `כתוב מכתב פנייה מקצועי לבנקאי עבור לקוח בשם ${fullName}, גיל ${formData.age}, ${maritalLabel}.
סכום: ₪${formatCurrency(results.loanAmount)} | LTV: ${(results.ltv || 0).toFixed(1)}% | DTI: ${(results.dti || 0).toFixed(1)}% | ציון תיק: ${results.score}/100.
הכנסה: ₪${Math.floor(getTotalIncome()).toLocaleString()} | היסטוריית אשראי: ${creditLabel}.
המכתב צריך: פנייה רשמית, פרטי התיק בטבלה, 3 נקודות חוזק, בקשה לאישור עקרוני.
ענה בעברית בלבד, פורמט מכתב עסקי מלא.`;

    try {
      const [analysisResponse, emailResponse] = await Promise.all([
        appClient.ai.generate(prompt),
        appClient.ai.generate(emailPrompt)
      ]);
      
      const analysis = analysisResponse || "הניתוח הושלם. קיימת היתכנות גבוהה לעסקה.";
      const email = emailResponse || "";
      
      setAiAnalysis(cleanAiText(analysis));
      setBankerEmail(email.replace(/[*#]/g, ''));
      
      // בניית פרטי לווים נוספים לשמירה
      const additionalBorrowersData = borrowers.slice(1).map(b => ({
        fullName: `${b.firstName || ''} ${b.lastName || ''}`.trim(),
        idNumber: b.idNumber || '',
        phone: b.phone || '',
        isSpouse: b.isSpouse || false,
      })).filter(b => b.fullName || b.idNumber);

      // שדרוג הליד החלקי של הסשן (אם קיים) לליד מלא, אחרת יצירה (fallback אם השמירות החלקיות נכשלו)
      const leadPayload = buildLeadPayload({ status: 'new', aiAnalysis: analysis });
      if (currentLeadId) {
        await appClient.entities.Lead.update(currentLeadId, leadPayload);
      } else {
        const lead = await appClient.entities.Lead.create(leadPayload);
        setCurrentLeadId(lead.id);
      }
    } catch (err) {
      console.error(err);
      setAiAnalysis("הניתוח הושלם. קיימת היתכנות גבוהה לעסקה.");
    } finally { 
      setLoading(false); 
    }
  };

  const getAiInsight = async (type) => {
    if (!isPurchased) return;
    setInsightLoading(true);
    
    const isPensioner = borrowers.some(b => (b.employmentTypes || []).includes('pensioner'));
    const isSelfEmployed = borrowers.some(b => (b.employmentTypes || []).includes('self_employed'));
    const isEmployee = borrowers.some(b => (b.employmentTypes || []).includes('employee'));
    
    const isSeniorBank = formData.mortgageType === 'senior_bank';

    // Build combined docs list based on ALL income types present
    const buildDocsList = () => {
      if (isSeniorBank) {
        return `רשימת מסמכים נדרשים – משכנתא בנקאית לגיל הזהב (כל מטרה):\n1. תעודת זהות + ספח מעודכן (לכל לווה)\n2. טופס חתימת ילדים/יורשים על מודעות למשכנתא (חובה!)\n3. אישור קצבה/פנסיה חודשית (3 חודשים אחרונים)\n4. דפי בנק 3 חודשים אחרונים\n5. נסח טאבו מעודכן\n6. שמאות נכס (תואם מוסד פיננסי)\n7. אישור BDI / דוח נתוני אשראי${formData.seniorBalloon ? '\n8. הצהרת אסטרטגיית יציאה (בלון) – חתומה' : ''}`;
      }
      if (isReverseMortgage) {
        return `רשימת מסמכים נדרשים למשכנתא הפוכה:\n1. תעודת זהות + ספח מעודכן\n2. נסח טאבו מעודכן\n3. דפי בנק 3 חודשים אחרונים\n4. אישור הסכמת יורשים חתום\n5. אישור קצבה/פנסיה חודשית\n6. שמאות נכס (תואם מוסד פיננסי)`;
      }

      let docNum = 1;
      let docs = `רשימת מסמכים נדרשים – בהתאם לסוגי ההכנסה בתיק:\n`;
      docs += `\n📋 מסמכים בסיסיים (חובה לכולם):\n${docNum++}. תעודת זהות + ספח מעודכן (לכל לווה)\n${docNum++}. דפי בנק 3 חודשים אחרונים\n${docNum++}. נסח טאבו מעודכן\n${docNum++}. חוזה רכישה / הסכם\n${docNum++}. שמאות נכס (תואם מוסד פיננסי)\n${docNum++}. אישור BDI / דוח נתוני אשראי`;

      if (isEmployee) {
        docs += `\n\n👔 כשכיר/ה:\n${docNum++}. 3 תלושי שכר אחרונים\n${docNum++}. אישור מעסיק על המשכת העסקה (ניסיון מעל שנה – יתרון)`;
      }
      if (isSelfEmployed) {
        docs += `\n\n💼 כעצמאי/ת:\n${docNum++}. 2 שנות דוחות מס הכנסה אחרונים (עם אישור רו"ח)\n${docNum++}. דפי בנק 3 חודשים – חשבון עסקי + פרטי\n${docNum++}. אישור ניהול ספרים מרשות המסים\n${docNum++}. אישור תשלום מקדמות מס הכנסה שוטף`;
      }
      if (isPensioner) {
        docs += `\n\n🏦 כפנסיונר/ית:\n${docNum++}. אישור גמלה/פנסיה חודשית (מקרן הפנסיה / ביטוח לאומי)\n${docNum++}. אישור יתרת זכויות קרן הפנסיה`;
      }

      return docs;
    };

    const docsList = buildDocsList();

    const types = {
      roadmap: { label: "אסטרטגיית חיסכון", prompt: `צור 3 טיפים אסטרטגיים מדויקים לחיסכון בריבית ו/או קיצור תקופת משכנתא של ₪${formatCurrency(results.loanAmount)} ל-${results.actualDuration ?? formData.loanDuration} שנים. ענה כרשימה ממוספרת נקייה בעברית.` },
      negotiation: { label: "הכנה למשא ומתן", prompt: `צור 3 שאלות חדות ומקצועיות לבנקאי לשיפור תנאי משכנתא של ₪${formatCurrency(results.loanAmount)}, LTV ${results.ltv.toFixed(1)}%. ענה כרשימה ממוספרת בעברית.` },
      documents: { label: "רשימת מסמכים להגשה", prompt: docsList }
    };
    
    try {
      if (type === 'documents') {
        // רשימת מסמכים - קבועה ומדויקת, לא LLM
        setAiInsights({ type: types[type].label, content: types[type].prompt });
        setInsightLoading(false);
        return;
      }
      const data = await appClient.ai.generate(types[type].prompt) || "פנה ליועץ לקבלת המידע המלא.";
      setAiInsights({ type: types[type].label, content: cleanAiText(data) });
    } catch (e) {
      setAiInsights({ type: types[type].label, content: "פנה ליועץ לקבלת המידע המלא." });
    } finally { 
      setInsightLoading(false); 
    }
  };

  return (
    <div className="min-h-screen font-sans text-right bg-white overflow-x-hidden" dir="rtl">
      <CardComPaymentModal paymentUrl={paymentUrl} onClose={handlePaymentModalClose} />

      <MikudHeader isChatOpen={isChatOpen} setIsChatOpen={setIsChatOpen} onBrandClick={() => window.location.reload()} />

      <main ref={mainRef} className="max-w-6xl mx-auto px-4 py-16 flex flex-col items-center">
        {step <= 6 ? (
          <div className="w-full max-w-4xl">
            {/* Hero Section Above Form */}
            {step === 1 && !codeSent && !heroStarted && (
              <div className="text-center mb-16 animate-in fade-in slide-in-from-top-8 duration-1000">
                <h1 className="text-[1.89rem] sm:text-[2.835rem] font-extrabold text-[#0C084A] mb-6 leading-tight tracking-tight">
                  המשכנתא הנכונה<br/>
                  <span className="text-[#0153F4]">
                    מתחילה כאן
                  </span>
                </h1>
                <p className="text-lg text-[#A7A8AB] max-w-2xl mx-auto leading-relaxed font-normal">
                  להבין מה המשכנתא הכי משתלמת עבורכם תוך שלוש דקות
                </p>
                <div className="flex justify-center gap-6 sm:gap-10 mt-6 sm:mt-8 text-sm">
                  <div className="flex flex-col items-center gap-2">
                    <div className="text-3xl font-bold text-[#0C084A]">₪150K</div>
                    <span className="text-mist-500">חיסכון ממוצע</span>
                  </div>
                  <div className="flex flex-col items-center gap-2">
                    <div className="text-3xl font-bold text-[#0C084A]">3 דק׳</div>
                    <span className="text-mist-500">זמן תגובה</span>
                  </div>
                  <div className="flex flex-col items-center gap-2">
                    <div className="text-3xl font-bold text-[#0C084A]">0₪</div>
                    <span className="text-mist-500">עלות</span>
                  </div>
                </div>
                <button
                  onClick={() => setHeroStarted(true)}
                  className="mt-10 h-11 px-16 rounded-full font-semibold text-lg shadow-md transition-all bg-[#0C084A] text-white hover:bg-[#0153F4] active:scale-95"
                >
                  בואו נתחיל
                </button>
                <HeroStepsShowcase />
              </div>
            )}

            {step === 1 && !codeSent && !heroStarted && (
              <div className="w-screen relative left-1/2 right-1/2 -mx-[50vw] mb-16">
                <BankLogosCarousel />
              </div>
            )}

            {step === 1 && !codeSent && !heroStarted && <BeforeAfterSavings />}

            {(step > 1 || codeSent || heroStarted) && (
            <div className="bg-white rounded-3xl shadow-xl p-8 sm:p-12 md:p-16 border border-mist-100 transition-all duration-700 relative overflow-hidden">
              <div className="mb-6 text-right">
                <h1 className="text-lg sm:text-2xl font-bold text-[#0C084A] leading-none">
                  {step === 1 && !codeSent && "בואו נכיר"}
                  {step === 1 && codeSent && "אימות זהות"}
                  {step === 2 && "פרופיל אישי"}
                  {step === 3 && "הנכס שלכם"}
                  {step === 4 && "מצב כלכלי"}
                  {step === 5 && "הון עצמי והשלמת עסקה"}
                  {step === 6 && "העדפות"}
                </h1>
                <p className="text-[#0153F4] font-medium text-xs mt-2">שלב {step} מתוך 6</p>
              </div>

              <div className="min-h-[220px] relative z-10">
              {step === 1 && !codeSent && (
                <div className="animate-in fade-in slide-in-from-left-4 duration-500">
                  {/* שם פרטי + שם משפחה */}
                  <div className="grid grid-cols-2 gap-3 mb-1">
                    <PremiumInput label="שם פרטי" name="firstName" value={formData.firstName} icon={User} onChange={handleInputChange} error={fieldErrors.firstName} tooltip="שם פרטי כפי שמופיע בתעודת זהות" />
                    <PremiumInput label="שם משפחה" name="lastName" value={formData.lastName} icon={User} onChange={handleInputChange} error={fieldErrors.lastName} tooltip="שם משפחה כפי שמופיע בתעודת זהות" />
                  </div>
                  <PremiumInput label="מספר תעודת זהות" name="idNumber" value={formData.idNumber} icon={BadgeCheck} onChange={handleInputChange} error={fieldErrors.idNumber} tooltip="9 ספרות של תעודת הזהות שלך לאימות זהות" />

                  {/* תאריך לידה - 3 שדות נפרדים */}
                  <BirthDateInput
                    value={formData.birthDate || ''}
                    onChange={(val) => handleInputChange('birthDate', val)}
                    error={fieldErrors.birthDate}
                    onInvalidChange={setBirthDateInvalid}
                  />

                  <PremiumInput label="טלפון נייד" name="phone" value={formData.phone} icon={Phone} onChange={handleInputChange} error={fieldErrors.phone} tooltip="מספר נייד לקבלת קוד אימות ויצירת קשר מהיועץ" />
                  <PremiumInput label="כתובת דוא״ל" name="email" value={formData.email} icon={Mail} onChange={handleInputChange} type="email" error={fieldErrors.email} tooltip="דוא״ל לקבלת הדוח המפורט והתכתבות עם היועץ" />

                  {/* אישור יצירת קשר */}
                  <div className="mt-4 flex items-center gap-3 p-2.5 rounded-xl border bg-mist-50 shadow-inner">
                    <Checkbox checked={formData.consent} onCheckedChange={(checked) => handleInputChange('consent', checked)} aria-labelledby="consent-contact-label" />
                    <p id="consent-contact-label" className="text-[11px] text-mist-600 font-bold leading-relaxed text-right">אני מאשר ליועץ ממיקוד משכנתאות ליצור איתי קשר לצורך קידום התיק.</p>
                  </div>
                  {fieldErrors.consent && <p className="text-red-600 text-xs font-bold mt-1 text-right">{fieldErrors.consent}</p>}

                  {/* אישור בדיקת חווי אשראי */}
                  <div className="mt-3 flex items-center gap-3 p-2.5 rounded-xl border bg-periwinkle-100 border-periwinkle-200">
                    <Checkbox
                      checked={formData.creditConsent}
                      onCheckedChange={(checked) => {
                        handleInputChange('creditConsent', checked);
                        if (checked) setShowCreditModal(true);
                      }}
                      aria-labelledby="consent-credit-label"
                    />
                    <p id="consent-credit-label" className="text-[11px] text-[#0C084A] font-bold leading-relaxed text-right">
                      אני מאשר לבנק לבצע בדיקת חווי אשראי (BDI) במסגרת בחינת הבקשה.{' '}
                      <button type="button" onClick={() => setShowCreditModal(true)} className="underline text-[#0C084A] hover:text-[#0153F4]">מה זה אומר?</button>
                    </p>
                  </div>
                </div>
              )}

              {/* מודל תזכורת למלא פרטי בן/בת זוג */}
              {showSpouseReminderModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setShowSpouseReminderModal(false)}>
                  <div
                    ref={spouseReminderModalRef}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="spouse-reminder-modal-title"
                    tabIndex={-1}
                    className="bg-white rounded-3xl shadow-2xl max-w-sm w-full p-8 border border-[#0153F4] text-right animate-in zoom-in-95 duration-300 outline-none"
                    onClick={e => e.stopPropagation()}
                  >
                    <div className="flex items-center justify-between mb-5">
                      <button onClick={() => setShowSpouseReminderModal(false)} className="text-mist-400 hover:text-mist-600"><X size={24} /></button>
                      <h3 id="spouse-reminder-modal-title" className="text-xl font-black text-[#0C084A]">שכחת למלא פרטי בן/בת זוג</h3>
                    </div>
                    <div className="bg-amber-50 border border-amber-300 rounded-2xl p-5 mb-6 text-center">
                      <div className="text-4xl mb-3">👫</div>
                      <p className="text-amber-800 font-bold text-sm leading-relaxed">
                        זיהינו שאתה נשוי/אה — הוספנו לווה ב' (בן/בת זוג) אוטומטית.
                      </p>
                      <p className="text-amber-700 text-xs mt-2 leading-relaxed">
                        כדי לקבל חישוב מדויק, יש להזין את פרטי ההכנסה של בן/בת הזוג. זה יכול להגדיל משמעותית את סכום המשכנתא המאושרת.
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        onClick={() => {
                          setShowSpouseReminderModal(false);
                          setActiveBorrowerTab(1);
                        }}
                        className="py-3 px-4 rounded-2xl bg-[#0C084A] text-white font-black text-sm hover:bg-[#0153F4] transition-all"
                      >
                        למלא פרטים →
                      </button>
                      <button
                        onClick={() => {
                          setShowSpouseReminderModal(false);
                          setStep(s => s + 1);
                          scrollToTop();
                        }}
                        className="py-3 px-4 rounded-2xl border border-mist-300 font-bold text-sm text-mist-600 hover:bg-mist-50 transition-all"
                      >
                        המשך בלי זה
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* מודל הסבר חווי אשראי */}
              {showCreditModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => setShowCreditModal(false)}>
                  <div
                    ref={creditModalRef}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="credit-modal-title"
                    tabIndex={-1}
                    className="bg-white rounded-3xl shadow-2xl max-w-md w-full p-8 border border-[#0C084A] text-right animate-in zoom-in-95 duration-300 outline-none"
                    onClick={e => e.stopPropagation()}
                  >
                    <div className="flex items-center justify-between mb-5">
                      <button onClick={() => setShowCreditModal(false)} className="text-mist-400 hover:text-mist-600"><X size={24} /></button>
                      <h3 id="credit-modal-title" className="text-xl font-black text-[#0C084A]">מהי בדיקת חווי אשראי?</h3>
                    </div>
                    <div className="space-y-4 text-sm text-mist-700 leading-relaxed">
                      <p className="font-bold text-[#0C084A] text-base">בדיקת BDI (Credit Check) היא בדיקה שגרתית שהבנק מבצע לפני אישור משכנתא.</p>
                      <div className="bg-brand-50 border-r-4 border-brand-500 p-4 rounded-xl">
                        <p className="font-bold text-brand-800 mb-2">מה הבנק בודק?</p>
                        <ul className="space-y-1 text-brand-700 text-xs">
                          <li>• היסטוריית תשלומים (הלוואות, כרטיסי אשראי)</li>
                          <li>• חובות ועיקולים קיימים אם יש</li>
                          <li>• תיקים בהוצאה לפועל אם יש</li>
                          <li>• דירוג האשראי הכללי שלך</li>
                        </ul>
                      </div>
                      <div className="bg-green-50 border-r-4 border-green-500 p-4 rounded-xl">
                        <p className="font-bold text-green-800 mb-1">מה אתה מאשר?</p>
                        <p className="text-green-700 text-xs">אתה מאשר לבנק לפנות לחברת BDI ולקבל דוח אשראי עליך לצורך בחינת הבקשה למשכנתא בלבד. המידע משמש לצורך הערכת כשירות ההלוואה ואינו מועבר לגורם שלישי.</p>
                      </div>
                      <p className="text-xs text-mist-600 font-medium">הבדיקה אינה פוגעת בדירוג האשראי שלך.</p>
                    </div>
                    <button
                      onClick={() => { setShowCreditModal(false); handleInputChange('creditConsent', true); }}
                      className="mt-6 w-full bg-[#0C084A] text-white py-3 rounded-2xl font-black text-base hover:bg-[#0153F4] transition-all"
                    >
                      הבנתי ומאשר ✓
                    </button>
                  </div>
                </div>
              )}

              {step === 1 && codeSent && !emailVerified && (
                <div className="animate-in zoom-in-95 duration-500 text-center py-8">
                  <Mail size={40} className="text-[#0C084A] mx-auto mb-4" />
                  <h2 className="text-lg font-black text-[#0C084A] mb-2 text-center">הזן קוד אימות</h2>
                  {EMAIL_VERIFICATION_ENABLED ? (
                    <p className="mb-4 text-sm text-mist-600 text-center">
                      שלחנו קוד אימות בן 6 ספרות לכתובת <span className="font-bold text-[#0C084A]" dir="ltr">{formData.email}</span>
                    </p>
                  ) : (
                    <div className="mb-4 p-3 bg-amber-50 border border-amber-300 rounded-xl text-xs text-amber-800 font-bold text-center">
                      אימות המייל מושבת כרגע — ניתן להזין כל ערך ולהמשיך
                    </div>
                  )}
                  <PremiumInput label="הזן קוד" name="otp" value={userInputCode} onChange={(n, v) => setUserInputCode(v)} placeholder="______" icon={Key} error={fieldErrors.otp} />
                  {EMAIL_VERIFICATION_ENABLED && (
                    <button
                      type="button"
                      onClick={startVerification}
                      disabled={isSendingCode}
                      className="mt-4 text-sm font-bold text-[#0153F4] hover:underline disabled:opacity-50 disabled:no-underline"
                    >
                      {isSendingCode ? "שולח..." : "שלח קוד מחדש"}
                    </button>
                  )}
                </div>
              )}

              {step === 2 && (
                <div className="animate-in fade-in slide-in-from-left-4 duration-500">
                  {/* טאבים לווים */}
                  <div className="flex gap-2 mb-5 flex-wrap">
                    {borrowers.map((b, idx) => {
                      const bIncome = Object.values(b.incomeSources || {}).reduce((acc, src) => {
                        return acc + (src?.amount ? Number(String(src.amount).replace(/,/g,'')) : 0);
                      }, 0);
                      const needsAttention = idx > 0 && bIncome === 0;
                      return (
                      <div
                        key={idx}
                        className={`flex items-center gap-1.5 px-4 py-2 rounded-full font-bold text-sm transition-all border ${activeBorrowerTab === idx ? 'bg-[#0C084A] text-white border-[#0C084A]' : needsAttention ? 'bg-amber-50 text-amber-700 border-amber-400 animate-pulse' : 'bg-white text-[#0C084A] border-[#0C084A]/30 hover:border-[#0C084A]'}`}
                      >
                        <button
                          type="button"
                          onClick={() => setActiveBorrowerTab(idx)}
                          className="flex items-center gap-1.5 bg-transparent text-inherit"
                        >
                          <User size={14} />
                          לווה {['א', 'ב', 'ג', 'ד', 'ה'][idx] || (idx + 1)}
                          {needsAttention && <span className="text-amber-500 text-xs font-black">!</span>}
                        </button>
                        {idx > 0 && (
                          <button
                            type="button"
                            onClick={() => removeBorrower(idx)}
                            aria-label={`הסר לווה ${['א', 'ב', 'ג', 'ד', 'ה'][idx] || (idx + 1)}`}
                            className="mr-1 text-red-400 hover:text-red-600 font-black bg-transparent"
                          >×</button>
                        )}
                      </div>
                      );
                    })}
                    {borrowers.length < 5 && (
                      <button
                        onClick={addBorrower}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-full font-bold text-sm border border-dashed border-[#0153F4] text-[#0153F4] hover:bg-[#0153F4]/10 transition-all"
                      >
                        <UserPlus size={14} /> הוסף לווה
                      </button>
                    )}
                  </div>

                  {/* תווית גיל */}
                  <div className="mb-4 p-3 bg-[#0C084A]/5 rounded-xl border border-[#0C084A]/15 flex items-center gap-2">
                    <User size={16} className="text-[#0153F4]" />
                    <p className="text-sm font-bold text-[#0C084A]">
                      לווה {['א', 'ב', 'ג', 'ד', 'ה'][activeBorrowerTab] || (activeBorrowerTab + 1)} – גיל מחושב: <span className="text-[#0153F4]">{formData.age || 'ממלא בשלב 1'}</span>
                    </p>
                  </div>

                  <BorrowerForm
                    key={activeBorrowerTab}
                    borrower={borrowers[activeBorrowerTab]}
                    index={activeBorrowerTab}
                    onChange={(data) => updateBorrower(activeBorrowerTab, data)}
                    isReverseMortgage={isReverseMortgage}
                    errors={fieldErrors}
                    borrowerAge={formData.age}
                    onMaritalChange={activeBorrowerTab === 0 ? handleMaritalChange : undefined}
                  />
                </div>
              )}

              {step === 3 && (
                <div className="animate-in fade-in slide-in-from-left-4 duration-500">
                  <PremiumInput label="סוג ומטרת המשכנתא" name="mortgageType" value={formData.mortgageType} icon={Target} onChange={handleInputChange} 
                    options={[
                    {val:'purchase_first', label:'רכישה - דירה ראשונה (עד 75%)'},
                    {val:'purchase_improve', label:'רכישה - משפרי דיור / חליפית (עד 70%)'},
                    {val:'purchase_machir_matarah', label:'רכישה - מחיר מטרה (עד 90% ממחיר הרכישה, לא יותר מ-75% משמאות)'},
                    {val:'purchase_additional', label:'רכישה - נכס נוסף / דירה להשקעה (עד 50%)'},
                    {val:'refinance', label:'מחזור משכנתא (שיפור תנאים)'},
                    {val:'any_purpose', label:'כל מטרה - סגירת חובות/שיפוץ (עד 50%)'},
                    {val:'reverse_mortgage', label:'משכנתא הפוכה (Reverse Mortgage)'},
                    {val:'senior_bank', label:'משכנתא בנקאית לגיל הזהב – כל מטרה (45% LTV | עד 30 שנה)'}
                    ]} 
                    tooltip="מטרת המשכנתא קובעת את אחוז המימון המקסימלי ותנאי ההלוואה" />
                  
                  {isRefinance && (
                    <div className="animate-in fade-in duration-300">
                      <div className="mb-5 p-4 bg-brand-50 border border-brand-400 rounded-2xl">
                        <p className="text-brand-900 font-black text-sm">מחזור משכנתא — שיפור תנאים</p>
                        <p className="text-brand-700 text-xs mt-1 leading-relaxed">נחשב כמה תחסכו על המשכנתא הקיימת שלכם ונציג 3 תמהילים חדשים.</p>
                      </div>
                      <PremiumInput label="יתרת משכנתא קיימת" name="refinanceBalance" value={formData.refinanceBalance} placeholder="כמה נשאר לשלם?" icon={Coins} onChange={handleInputChange} error={fieldErrors.refinanceBalance} tooltip="הסכום שנשאר לכם לשלם על המשכנתא הנוכחית" />
                      <PremiumInput label="החזר חודשי נוכחי" name="currentMonthlyPayment" value={formData.currentMonthlyPayment} placeholder="כמה משלמים היום?" icon={TrendingDown} onChange={handleInputChange} error={fieldErrors.currentMonthlyPayment} tooltip="הסכום שאתם משלמים כרגע כל חודש" />
                      <PremiumInput label="תקופה שנשארה (שנים)" name="refinanceRemainingYears" value={formData.refinanceRemainingYears} type="range" min={1} max={30} icon={Building2} onChange={handleInputChange} tooltip="כמה שנים נשארו במשכנתא הנוכחית" />
                      <PremiumInput label="האם תוכלו להגדיל את ההחזר החודשי?" name="refinanceCanIncreasePayment" value={formData.refinanceCanIncreasePayment} icon={Target} onChange={handleInputChange}
                        options={[
                          {val:'no', label:'לא — נשאר על אותו החזר חודשי'},
                          {val:'yes', label:'כן — אני יכול לשלם יותר בחודש'},
                        ]} />
                      {formData.refinanceCanIncreasePayment === 'yes' && (
                        <PremiumInput label="בכמה תוכלו להגדיל? (₪ לחודש)" name="refinanceIncreaseAmount" value={formData.refinanceIncreaseAmount} placeholder="לדוגמה: 500 או 1000" icon={Coins} onChange={handleInputChange} tooltip="הגדלת ההחזר מקצרת את התקופה וחוסכת ריבית רבה" />
                      )}
                    </div>
                  )}

                  {isReverseMortgage && (
                    <div className="mb-5 p-4 bg-amber-50 border border-amber-400 rounded-2xl animate-in slide-in-from-top-2 duration-300">
                      <p className="text-amber-800 font-bold text-sm">משכנתא הפוכה</p>
                      <p className="text-amber-700 text-xs mt-1 leading-relaxed">ללא החזר חודשי חובה. הסכום נפרע מהנכס בסיום. אחוז המימון נקבע לפי גיל הלווה הצעיר ביותר.</p>
                    </div>
                  )}

                  {formData.mortgageType === 'purchase_machir_matarah' && (
                    <div className="mb-5 p-4 bg-green-50 border border-green-500 rounded-2xl animate-in slide-in-from-top-2 duration-300">
                      <p className="text-green-900 font-black text-sm mb-2">✅ מחיר מטרה — תנאי מימון מועדפים</p>
                      <ul className="text-green-800 text-xs space-y-1 list-none">
                        <li>• ניתן לממן עד <strong>90% ממחיר הרכישה</strong></li>
                        <li>• אך <strong>לא יותר מ-75% מערך הנכס לפי שמאות</strong></li>
                        <li>• נדרש: הזן את <strong>מחיר הרכישה</strong> ואת <strong>שווי שמאות</strong> בנפרד</li>
                        <li>• הטבה זו שמורה לזכאים לדיור בר-השגה ע"פ קריטריוני משרד הבינוי</li>
                      </ul>
                    </div>
                  )}
                  {formData.mortgageType === 'purchase_machir_matarah' && !isRefinance && (
                    <PremiumInput label="שווי נכס לפי שמאות (₪)" name="appraisalValue" value={formData.appraisalValue || ''} placeholder="שווי שמאות — לא מחיר הרכישה" icon={Home} onChange={handleInputChange} tooltip="חובה: הבנק מחשב LTV לפי ערך השמאות, לא לפי מחיר הרכישה בפועל" />
                  )}

                  {formData.mortgageType === 'purchase_additional' && (
                    <div className="mb-5 p-4 bg-orange-50 border border-orange-400 rounded-2xl animate-in slide-in-from-top-2 duration-300">
                      <p className="text-orange-900 font-black text-sm mb-2">⚠️ נכס נוסף / דירה להשקעה — 50% מימון בלבד</p>
                      <ul className="text-orange-800 text-xs space-y-1 list-none">
                        <li>• לפי תקנות בנק ישראל — מקסימום 50% LTV על נכס שאינו יחיד</li>
                        <li>• <strong>מס רכישה: 8% על הנכס הנוסף</strong> (יש לקחת בחשבון בהון העצמי)</li>
                        <li>• מס שבח ישולם בעת מכירה עתידית</li>
                        <li>• מומלץ להתייעץ עם עורך דין נדל"ן לפני הרכישה</li>
                      </ul>
                    </div>
                  )}

                  {isSeniorBankMortgage && (
                    <div className="mb-5 p-4 bg-brand-50 border border-brand-500 rounded-2xl animate-in slide-in-from-top-2 duration-300">
                      <p className="text-brand-900 font-black text-sm mb-2">משכנתא בנקאית לגיל הזהב – כל מטרה</p>
                      <ul className="text-brand-800 text-xs space-y-1 list-none">
                        <li>פריסה עד 30 שנה ללא הגבלת גיל עליונה</li>
                        <li>LTV מקסימלי: 45% (עד 50% בבנקים ספציפיים)</li>
                        <li>ללא חובת ביטוח חיים</li>
                        <li>ריביות מחירון "כל מטרה" (All-Purpose)</li>
                        <li className="font-bold">חובת יידוע יורשים וחתימתם</li>
                      </ul>
                    </div>
                  )}

                  {!isRefinance && (
                    <>
                      <PremiumInput label="שווי הנכס המשוער" name="propertyPrice" value={formData.propertyPrice} placeholder="שווי שוק מוערך" icon={Home} onChange={handleInputChange} error={fieldErrors.propertyPrice} tooltip="שווי הנכס על פי הערכה או חוזה רכישה" />
                      <PremiumInput label="סכום מבוקש למשכנתא" name="loanAmount" value={formData.loanAmount} icon={Coins} onChange={handleInputChange} error={fieldErrors.loanAmount} tooltip="הסכום שברצונכם לקבל כמשכנתא" />
                    </>
                  )}

                  {/* נתוני נכסים קיימים — רק למשפרי דיור / נכס נוסף / כל מטרה */}
                  {needsExistingProperty && (
                    <div className="mt-2">
                      <div className="flex items-center gap-2 mb-4">
                        <div className="h-px flex-1 bg-[#0C084A]/20" />
                        <span className="text-xs font-bold text-[#0C084A] px-3 py-1 bg-[#0C084A]/5 rounded-full">
                          נכסים קיימים בבעלותך ({existingProperties.length})
                        </span>
                        <div className="h-px flex-1 bg-[#0C084A]/20" />
                      </div>

                      {existingProperties.map((prop, idx) => (
                        <div key={idx} className="mb-6">
                          {existingProperties.length > 1 && (
                            <div className="flex items-center justify-between mb-3">
                              <button
                                onClick={() => removeExistingProperty(idx)}
                                className="flex items-center gap-1 text-red-500 hover:text-red-700 text-xs font-bold"
                              >
                                <Trash2 size={13} /> הסר נכס
                              </button>
                              <span className="text-sm font-black text-[#0C084A]">נכס קיים #{idx + 1}</span>
                            </div>
                          )}
                          <ExistingPropertyForm
                            data={prop}
                            onChange={(val) => updateExistingProperty(idx, val)}
                            errors={fieldErrors}
                          />
                          {idx < existingProperties.length - 1 && (
                            <div className="mt-4 border-t-2 border-dashed border-[#0C084A]/20" />
                          )}
                        </div>
                      ))}

                      {existingProperties.length < 5 && (
                        <button
                          onClick={addExistingProperty}
                          className="w-full mt-2 py-3 rounded-2xl border border-dashed border-[#0153F4] text-[#0153F4] font-bold text-sm hover:bg-[#0153F4]/10 transition-all flex items-center justify-center gap-2"
                        >
                          <Building2 size={15} /> + הוסף נכס קיים נוסף
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {step === 4 && (
                <div className="animate-in fade-in slide-in-from-left-4 duration-500">
                  {isReverseMortgage && (
                    <div className="mb-5 p-4 bg-brand-50 border border-brand-300 rounded-2xl">
                      <p className="text-brand-800 font-bold text-sm">משכנתא לגיל הזהב — מסלול ייעודי</p>
                      <p className="text-brand-700 text-xs mt-1">אין חובת הוכחת יחס החזר (DTI). הכנסות משמשות לחיזוק התיק בלבד.</p>
                    </div>
                  )}

                  {/* סיכום הכנסות לפי לווה */}
                  <div className="mb-5 p-4 bg-[#0C084A]/5 rounded-xl border border-[#0C084A]/15">
                    <p className="text-sm font-bold text-[#0C084A] mb-3 flex items-center gap-2"><Coins size={16} className="text-[#0153F4]" /> סיכום הכנסות לווים</p>
                    {borrowers.map((b, idx) => {
                      const sources = b.incomeSources || {};
                      const isSpouse = b.isSpouse === true;
                      const factor = idx > 0 && b.borrowerType === 'additional' && !isSpouse ? 0.5 : 1;
                      const totalB = Object.values(sources).reduce((acc, src) => {
                        if (!src || (!src.amount && !src.enabled)) return acc;
                        return acc + Number(String(src.amount || '0').replace(/,/g, ''));
                      }, 0);
                      return (
                        <div key={idx} className="flex justify-between items-center py-1.5 border-b border-mist-200 last:border-0 text-sm">
                          <span className="text-mist-600 font-medium">
                            לווה {['א','ב','ג','ד','ה'][idx] || idx+1}
                            {isSpouse ? <span className="text-green-600 text-xs"> (בן/בת זוג - 100%)</span> : idx > 0 && b.borrowerType === 'additional' ? <span className="text-amber-600 text-xs"> (נוסף - 50%)</span> : ''}
                          </span>
                          <span className="font-bold text-[#0C084A]">₪{new Intl.NumberFormat('he-IL').format(Math.floor(totalB * factor))}</span>
                        </div>
                      );
                    })}
                    <div className="flex justify-between items-center pt-2 text-sm font-black text-[#0C084A]">
                      <span>סה"כ מוכר לבנק</span>
                      <span className="text-[#0153F4]">₪{new Intl.NumberFormat('he-IL').format(Math.floor(getTotalIncome()))}</span>
                    </div>
                  </div>

                  {!isReverseMortgage && (
                    <>
                      <PremiumInput label="החזרי הלוואות חודשיים" name="monthlyDebts" value={formData.monthlyDebts} placeholder="סכום חודשי" icon={TrendingDown} onChange={handleInputChange} tooltip="סכום ההחזרים החודשיים הקיימים (הלוואות, אשראי, ליסינג)" />
                      <PremiumInput label="שכירות חודשית שאתם משלמים כיום (אם יש)" name="monthlyOverdraft" value={formData.monthlyOverdraft} placeholder="0" icon={TrendingDown} onChange={handleInputChange} tooltip="סכום השכירות החודשית שאתם משלמים" />
                    </>
                  )}

                  {/* שכירות — דירה ראשונה / חליפית שמשכירים ומשלמים שכירות בנפרד */}
                  {!isReverseMortgage && !isRefinance && ['purchase_first', 'purchase_improve'].includes(formData.mortgageType) && (
                    <div className="mt-3 p-4 bg-brand-50 border border-brand-400 rounded-2xl animate-in fade-in duration-300">
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          const next = formData.willRentPurchased === 'yes' ? 'no' : 'yes';
                          handleInputChange('willRentPurchased', next);
                          if (next !== 'yes') handleInputChange('rentIncomeFromPurchased', '');
                        }}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.click(); } }}
                        className="flex items-center gap-3 cursor-pointer"
                      >
                        <Checkbox checked={formData.willRentPurchased === 'yes'} tabIndex={-1} className="pointer-events-none flex-shrink-0" />
                        <span className="font-black text-brand-800 text-sm">🏠 אני מתכנן להשכיר את הדירה הנרכשת ולגור בשכירות בנפרד</span>
                      </div>
                      {formData.willRentPurchased === 'yes' && (
                        <div className="mt-3">
                          <PremiumInput label="הכנסת שכירות מהדירה הנרכשת (₪/חודש)" name="rentIncomeFromPurchased" value={formData.rentIncomeFromPurchased || ''} icon={Coins} onChange={handleInputChange} error={fieldErrors.rentIncomeFromPurchased} tooltip="אם תשכירו את הנכס הנרכש, ההכנסה משמשת לחיזוק כושר ההחזר" />
                        </div>
                      )}
                      {formData.willRentPurchased === 'yes' && formData.rentIncomeFromPurchased && Number(String(formData.rentIncomeFromPurchased).replace(/,/g,'')) > 0 && (() => {
                        const rentIn  = Number(String(formData.rentIncomeFromPurchased || '0').replace(/,/g, ''));
                        const rentOut = Number(String(formData.monthlyOverdraft || '0').replace(/,/g, ''));
                        const diff = rentIn - rentOut;
                        return (
                          <div className={`mt-3 p-3 rounded-xl border ${diff >= 0 ? 'bg-green-50 border-green-400' : 'bg-red-50 border-red-400'}`}>
                            <p className={`text-sm font-black ${diff >= 0 ? 'text-green-800' : 'text-red-800'}`}>
                              {diff >= 0
                                ? `✅ הפרש חיובי: +₪${new Intl.NumberFormat('he-IL').format(Math.abs(diff))} — יתווסף להכנסה המוכרת`
                                : `⚠️ הפרש שלילי: -₪${new Intl.NumberFormat('he-IL').format(Math.abs(diff))} — יופחת מההכנסה המוכרת`
                              }
                            </p>
                            {diff < 0 && (
                              <div className="mt-2">
                                <div
                                  role="button"
                                  tabIndex={0}
                                  onClick={() => handleInputChange('ignoreRentDiff', !formData.ignoreRentDiff)}
                                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleInputChange('ignoreRentDiff', !formData.ignoreRentDiff); } }}
                                  className="flex items-center gap-2 cursor-pointer"
                                >
                                  <Checkbox checked={!!formData.ignoreRentDiff} tabIndex={-1} className="pointer-events-none h-4 w-4" />
                                  <span className="text-xs font-bold text-red-700">לא לדווח לבנק על השכרויות (לא להשפיע על ההכנסה)</span>
                                </div>
                                <p className="text-[10px] text-red-500 mt-1 mr-6">* שקול את ההשלכות עם יועץ לפני שמחליטים</p>
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  )}

                  {/* אזהרה כשיש משכנתאות קיימות בלי הסכם מכירה */}
                  {needsExistingProperty && totalExistingMortgagePayments > 0 && (
                    <div className="mt-3 p-4 bg-red-50 border border-red-400 rounded-2xl animate-in fade-in duration-300">
                      <div className="flex items-start gap-3">
                        <AlertCircle size={18} className="text-red-500 flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="font-black text-red-700 text-sm">⚠️ משכנתאות קיימות יחושבו ב-DTI שלך!</p>
                          <p className="text-xs text-red-600 mt-1 leading-relaxed">
                            הבנק יוסיף סה"כ ₪{totalExistingMortgagePayments.toLocaleString()} לחודש לחישוב יחס ההחזר שלך.
                            כדי לנטרל זאת — יש להציג <strong>הסכם מכירה חתום</strong> על הנכסים הרלוונטיים.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {step === 5 && (
                <div className="animate-in fade-in slide-in-from-left-4 duration-500">
                  {!isReverseMortgage && !isRefinance && (
                    <EquityCompletionForm
                      data={{ ...equityCompletion, equity: equityCompletion.equity || formData.equity }}
                      onChange={(d) => {
                        setEquityCompletion(d);
                        if (d.equity !== undefined) handleInputChange('equity', d.equity);
                      }}
                      errors={fieldErrors}
                      gap={equityGap}
                      requiredEquity={requiredEquity}
                    />
                  )}
                  {isRefinance && (
                    <div className="p-6 bg-brand-50 border border-brand-400 rounded-2xl text-right">
                      <p className="text-brand-900 font-black text-base mb-3">📋 מסמכים נדרשים למחזור</p>
                      <ul className="text-brand-800 text-sm space-y-2">
                        <li>• תעודת זהות + ספח מעודכן (לכל לווה)</li>
                        <li>• יתרת סילוק משכנתא מהבנק (מסמך רשמי)</li>
                        <li>• 3 תלושי שכר אחרונים (לכל לווה שכיר)</li>
                        <li>• דפי בנק 3 חודשים אחרונים</li>
                        <li>• נסח טאבו מעודכן</li>
                        <li>• אישור BDI / דוח נתוני אשראי</li>
                      </ul>
                      <p className="text-brand-600 text-xs mt-3 font-bold">* המסמכים יוגשו לאחר הפגישה עם יועץ מיקוד</p>
                    </div>
                  )}
                  {isReverseMortgage && (
                    <div className="mb-5 p-4 bg-amber-50 border border-amber-300 rounded-2xl">
                      <p className="text-amber-800 font-bold text-sm">מסמכים נדרשים — משכנתא לגיל הזהב</p>
                      <ul className="mt-2 text-amber-700 text-xs space-y-1 list-disc list-inside">
                        <li>תעודת זהות + ספח (לווידוא גיל)</li>
                        <li>אישור הסכמת יורשים (חתום)</li>
                        <li>נסח טאבו מעודכן</li>
                        <li>דפי בנק 3 חודשים אחרונים</li>
                      </ul>
                    </div>
                  )}
                  {borrowers.some(b => (b.employmentTypes || []).includes('pensioner')) && !isReverseMortgage && (
                    <div className="mb-5 p-4 bg-brand-50 border border-brand-300 rounded-2xl">
                      <p className="text-brand-800 font-bold text-sm">מסמכים נדרשים — פנסיונר/ית</p>
                      <ul className="mt-2 text-brand-700 text-xs space-y-1 list-disc list-inside">
                        <li>אישור גמלה/פנסיה (מקרן/ביטוח לאומי)</li>
                        <li>דפי בנק 3 חודשים אחרונים</li>
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {step === 6 && !isRefinance && (
                <div className="animate-in fade-in slide-in-from-left-4 duration-500 text-center py-10">
                  <PremiumInput label={isSeniorBankMortgage ? "תקופת הלוואה (עד 30 שנה, ללא הגבלת גיל)" : "תקופת הלוואה רצויה (בשנים)"} name="loanDuration" type="range" value={formData.loanDuration} min={4} max={maxTerm} onChange={handleInputChange} icon={Building2} tooltip="תקופה ארוכה יותר = החזר חודשי נמוך יותר אך ריבית כוללת גבוהה יותר" />

                  {isSeniorBankMortgage && (
                    <div className="mt-6 space-y-4 text-right animate-in slide-in-from-top-2 duration-300">
                      {/* מתג בלון */}
                      <div
                        role="button"
                        tabIndex={0}
                        aria-pressed={formData.seniorBalloon}
                        className={`p-5 rounded-2xl border cursor-pointer transition-all ${formData.seniorBalloon ? 'bg-brand-900 border-brand-400 text-white' : 'bg-brand-50 border-brand-300 text-brand-900'}`}
                        onClick={() => {
                          const next = !formData.seniorBalloon;
                          handleInputChange('seniorBalloon', next);
                          if (next) handleInputChange('loanDuration', Math.min(Number(formData.loanDuration), 15).toString());
                        }}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.click(); } }}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className={`w-12 h-6 rounded-full flex items-center px-1 transition-all ${formData.seniorBalloon ? 'bg-brand-400 justify-end' : 'bg-mist-300 justify-start'}`}>
                            <div className="w-4 h-4 rounded-full bg-white shadow" />
                          </div>
                          <p className="font-black text-base">מסלול בלון (ריבית בלבד)</p>
                        </div>
                        <p className={`text-xs leading-relaxed ${formData.seniorBalloon ? 'text-brand-200' : 'text-brand-700'}`}>
                          תשלום חודשי של ריבית בלבד. הקרן נפרעת בתום התקופה. מקסימום 15 שנה.
                          {formData.seniorBalloon && results.loanAmount > 0 && (
                            <span className="block mt-2 font-black text-green-300 text-sm">
                              החזר חודשי בלון: ₪{formatCurrency(Math.floor(results.loanAmount * ALL_PURPOSE_RATES.FIXED_UNLINKED / 12))} | במשכנתא רגילה: ₪{formatCurrency(Math.floor(calculatePayment(results.loanAmount, ALL_PURPOSE_RATES.FIXED_UNLINKED, Number(formData.loanDuration))))} | חיסכון חודשי: ₪{formatCurrency(Math.floor(calculatePayment(results.loanAmount, ALL_PURPOSE_RATES.FIXED_UNLINKED, Number(formData.loanDuration)) - results.loanAmount * ALL_PURPOSE_RATES.FIXED_UNLINKED / 12))}
                            </span>
                          )}
                        </p>
                      </div>

                      {formData.seniorBalloon && (
                        <div className="animate-in slide-in-from-top-2 duration-300">
                          <div className="p-4 bg-red-50 border border-red-400 rounded-xl mb-4">
                            <p className="text-red-800 font-black text-xs">גילוי נאות חובה: מדובר בהלוואת בלון. הקרן אינה נפרעת במהלך התקופה ותשולם במלואה בתום {formData.loanDuration} שנה.</p>
                          </div>
                          <PremiumInput label="אסטרטגיית יציאה – כיצד תפרע הקרן בסיום?" name="balloonExitStrategy" value={formData.balloonExitStrategy} icon={Target} onChange={handleInputChange}
                            options={[
                              {val: '', label: 'בחר אסטרטגיית יציאה...'},
                              {val: 'sell_property', label: 'מכירת הנכס'},
                              {val: 'inheritance', label: 'פירעון מירושה / עזבון'},
                              {val: 'refinance', label: 'מעבר למשכנתא רגילה'},
                              {val: 'savings', label: 'חסכונות / השקעות עתידיות'},
                              {val: 'other', label: 'אחר (יפורט מול יועץ)'},
                            ]}
                            tooltip="שדה חובה: הבנק ידרוש הצהרה מפורשת על אופן פירעון הקרן" />
                        </div>
                      )}

                      {/* מסמך יורשים */}
                      <div className="p-4 bg-amber-50 border border-amber-400 rounded-xl text-right">
                        <p className="text-amber-900 font-black text-xs mb-1">מסמך חובה: חתימת ילדים / יורשים</p>
                        <p className="text-amber-700 text-xs">טופס יידוע ואישור יורשים על נטילת המשכנתא יידרש על ידי הבנק ויצורף להגשה.</p>
                      </div>
                    </div>
                  )}
                  <div className="mt-16 w-full text-center">
                    <p className="text-2xl sm:text-3xl font-black text-[#1362FF] italic animate-pulse tracking-tight drop-shadow-md leading-tight">
                      מיד מסיימים <br/> מיקוד משכנתאות - המטרה שלנו, החיסכון שלכם
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-8 flex gap-4 text-right" dir="rtl">
              {step > 1 && (
                <button 
                  onClick={() => { if(step === 1 && codeSent) setCodeSent(false); else if(step > 1) setStep(s => s - 1); }}
                  className="flex-1 h-14 rounded-full font-bold text-base text-mist-600 border border-mist-200 hover:border-mist-300 hover:bg-mist-50 transition-all active:scale-95 text-center group"
                >
                  <span className="group-hover:translate-x-1 inline-block transition-transform">→ חזור</span>
                </button>
              )}
              <button 
                onClick={() => {
                  if (step === 1 && !codeSent) startVerification();
                  else if (step === 1 && codeSent) verifyEmailCode();
                  else if (validateStep(step)) {
                    // אם בשלב 2 ויש לווה ב' (בן/בת זוג) שלא מילא הכנסות - הזכר למלא
                    if (step === 2 && borrowers.length > 1) {
                      const spouseBorrower = borrowers[1];
                      const spouseIncome = Object.values(spouseBorrower.incomeSources || {}).reduce((acc, src) => {
                        if (src?.amount) return acc + Number(String(src.amount).replace(/,/g,''));
                        if (src?.enabled && src?.amount) return acc + Number(String(src.amount).replace(/,/g,''));
                        return acc;
                      }, 0);
                      if (spouseIncome === 0 && activeBorrowerTab === 0) {
                        setShowSpouseReminderModal(true);
                        return;
                      }
                    }
                    // מחזור: דלג על שלב 5 (הון עצמי) ושלב 6 (תקופה) — לא רלוונטיים
                    if (isRefinance && step === 4) { generateFullAnalysis(); scrollToTop(); }
                    else if (step === 6) { generateFullAnalysis(); scrollToTop(); }
                    else { setStep(s => s + 1); savePartialLead(); scrollToTop(); }
                  }
                }}
                disabled={isSendingCode || isVerifyingCode || (step === 1 && !codeSent && birthDateInvalid)}
                className={`h-14 rounded-full font-semibold text-lg shadow-md transition-all bg-[#0C084A] text-white hover:bg-[#0153F4] active:scale-95 text-center group disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-[#0C084A] disabled:active:scale-100 ${step > 1 ? 'flex-[2]' : 'flex-1'}`}
              >
                <span className="flex items-center justify-center gap-2">
                  {isSendingCode || isVerifyingCode ? (
                    <>
                      <Loader2 size={24} className="animate-spin" />
                      {isVerifyingCode ? "מאמת..." : "שולח קוד..."}
                    </>
                  ) : step === 6 ? (
                    <>
                      <Sparkles size={19} className="group-hover:rotate-12 transition-transform" />
                      הפקת דוח מסכם
                    </>
                  ) : step === 1 && !codeSent ? (
                    <>
                      שלח קוד אימות
                      <ChevronLeft size={24} className="group-hover:translate-x-1 transition-transform" />
                    </>
                  ) : (
                    <>
                      המשך לשלב הבא
                      <ChevronLeft size={24} className="group-hover:translate-x-1 transition-transform" />
                    </>
                  )}
                </span>
              </button>
            </div>
            </div>
            )}
          </div>
        ) : loading ? (
          <div className="w-full max-w-2xl mx-auto flex flex-col items-center justify-center text-center py-24 sm:py-32" dir="rtl">
            <Loader2 size={52} className="animate-spin text-[#0153F4] mb-8" strokeWidth={2} />
            <p className="text-2xl sm:text-3xl font-black text-[#0C084A] leading-relaxed">עוד רגע זה מוכן...</p>
            <p className="text-lg sm:text-xl font-bold text-mist-500 mt-3">אנחנו מרכיבים עבורכם את הצעות המשכנתא הטובות ביותר</p>
          </div>
        ) : (
          <div className="animate-in fade-in zoom-in-95 duration-1000 max-w-5xl mx-auto text-right px-3 sm:px-4" dir="rtl">
              <div className="bg-white rounded-2xl sm:rounded-3xl shadow-xl border border-mist-100 relative overflow-hidden">
                {/* כותרת הדוח */}
                <div className="px-6 sm:px-10 py-6 sm:py-8 text-right border-b border-mist-100">
                  <h1 className="text-[21.6px] sm:text-[27px] md:text-[32.4px] font-semibold text-[#0C084A] leading-tight">דוח היתכנות משכנתא</h1>
                  <p className="text-mist-600 text-sm sm:text-base font-medium mt-2 leading-relaxed">
                    היי {formData.firstName}! ניתחנו את הנתונים הפיננסיים שלך ומצאנו את מסלולי המשכנתא המשתלמים ביותר עבורך.
                  </p>
                  <p className="text-mist-400 text-xs font-medium mt-4 text-left">מעודכן לתאריך {TODAY_DATE}</p>
                </div>

                <div className="p-4 sm:p-6 md:p-8">

              {/* באנר פער מימון — מוצג כשהסכום המבוקש עולה על המקסימום */}
              {!isRefinance && results.excessAmount > 0 && (
                <div className="mb-6 p-5 rounded-2xl border border-amber-300 bg-amber-50 text-right animate-in slide-in-from-top-4 duration-500">
                  <div className="flex items-start gap-3">
                    <div className="text-3xl flex-shrink-0">⚠️</div>
                    <div>
                      <p className="font-black text-amber-900 text-base mb-1">
                        הבנק יאשר עד ₪{formatCurrency(results.loanAmount)} — לא את הסכום המבוקש
                      </p>
                      <p className="text-amber-800 text-sm font-bold leading-relaxed mb-3">
                        ביקשת ₪{formatCurrency(results.requestedLoanAmount)}, אך לפי תקנות בנק ישראל ניתן לקבל עד{" "}
                        ₪{formatCurrency(results.loanAmount)}.<br/>
                        <span className="text-amber-900">פער של ₪{formatCurrency(results.excessAmount)} לא מכוסה על ידי הבנק.</span>
                      </p>
                      <div className="bg-amber-100 border border-amber-300 rounded-xl p-4 space-y-1">
                        <p className="font-black text-amber-900 text-sm mb-2">אפשרויות לכיסוי הפער:</p>
                        <p className="text-amber-800 text-xs">🏦 מימון חוץ-בנקאי — ריביות 8%–18%, ללא הגבלת LTV</p>
                        <p className="text-amber-800 text-xs">📈 מימון עד 85% — בתנאים מיוחדים, ריביות גבוהות יותר</p>
                        <p className="text-amber-800 text-xs">💰 הגדלת הון עצמי — מחסכונות, קרן השתלמות או עזרת משפחה</p>
                        <p className="text-red-700 text-xs font-bold mt-2">⚡ מומלץ להתייעץ עם יועץ לפני התחייבות לכל מסלול חוץ-בנקאי.</p>
                      </div>
                      <p className="text-amber-700 text-xs mt-3 italic">* הניתוח הבא מתבצע על הסכום הבנקאי המאושר: ₪{formatCurrency(results.loanAmount)}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* תעודת כשירות / תוצאת מחזור */}
              {isRefinance ? (
                <div className="mb-6 sm:mb-8">
                  {/* כרטיס חיסכון ראשי */}
                  <div className={`p-6 sm:p-10 rounded-2xl sm:rounded-3xl text-center relative overflow-hidden mb-6 ${results.isWorthwhile ? 'bg-periwinkle-100' : 'bg-amber-50'}`}>
                    <div className="flex justify-center mb-4">
                      {results.isWorthwhile ? <Check size={56} className="text-[#0C084A]" strokeWidth={2.5} /> : <ShieldAlert size={56} className="text-amber-500" />}
                    </div>
                    <h2 className="text-2xl sm:text-3xl font-black text-[#0C084A] mb-2">
                      {results.isWorthwhile ? 'כדאי למחזר!' : 'כדאיות נמוכה'}
                    </h2>
                    <p className="text-mist-600 font-bold text-sm mb-6">
                      {results.isWorthwhile ? `חיסכון צפוי של ₪${formatCurrency(results.totalSaving)} לאורך כל התקופה` : 'החיסכון הצפוי נמוך יחסית לעלויות המחזור'}
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                      <div className="bg-white/70 p-4 rounded-xl">
                        <p className="text-xs text-mist-500 font-semibold mb-1">חיסכון חודשי</p>
                        <p className={`text-2xl font-semibold ${results.monthlySaving > 0 ? 'text-green-600' : 'text-red-500'}`}>
                          {results.monthlySaving > 0 ? '+' : ''}<Amount value={Math.abs(results.monthlySaving)} />
                        </p>
                        <p className="text-[10px] text-mist-400 mt-1">לחודש</p>
                      </div>
                      <div className="bg-white/70 p-4 rounded-xl">
                        <p className="text-xs text-mist-500 font-semibold mb-1">חיסכון כולל</p>
                        <p className={`text-2xl font-semibold ${results.totalSaving > 0 ? 'text-green-600' : 'text-red-500'}`}>
                          <Amount value={Math.abs(results.totalSaving)} />
                        </p>
                        <p className="text-[10px] text-mist-400 mt-1">סה"כ לאורך התקופה</p>
                      </div>
                      <div className="bg-white/70 p-4 rounded-xl">
                        <p className="text-xs text-mist-500 font-semibold mb-1">break-even</p>
                        <p className="text-2xl font-black text-[#0C084A]">
                          {results.breakEvenMonths ? `${results.breakEvenMonths} חודש` : '—'}
                        </p>
                        <p className="text-[10px] text-mist-400 mt-1">עד שהמחזור משתלם</p>
                      </div>
                    </div>
                    <div className="text-xs text-mist-400 mt-2 font-bold italic">
                      * על בסיס יתרה ₪{formatCurrency(results.balance)} | החזר נוכחי ₪{formatCurrency(results.currentMonthly)} | ריבית משוערת {results.impliedRate?.toFixed(2)}%
                    </div>
                  </div>
                </div>
              ) : (
              <>
                {/* ציון כשירות — רקע כחלחל */}
                <div className="flex items-center justify-between gap-4 mb-5 sm:mb-6 p-6 sm:p-8 rounded-2xl sm:rounded-3xl bg-periwinkle-100 text-right">
                  <p className="text-base sm:text-lg font-normal text-[#0C084A] leading-snug flex items-center gap-2">
                    {results.score >= 85 && <Check size={20} className="text-[#0153F4] flex-shrink-0" strokeWidth={3} />}
                    <span>
                      {results.score >= 85
                        ? 'ציון הכשירות שלך מצוין! זה נותן לך כוח מיקוח אל מול הבנקים'
                        : 'ציון הכשירות שלך תקין. יש עוד מקום לשיפור כדי לחזק את העמדה שלך מול הבנקים'}
                    </span>
                  </p>
                  <CelebratingScoreBadge
                    score={results.score}
                    textClassName={
                      results.score >= 85 ? 'text-[#0153F4]' :
                      results.score >= 60 ? 'text-amber-600' :
                      'text-red-600'
                    }
                  />
                </div>

                {/* שווי הנכס, משכנתא מבוקשת, LTV */}
                <div className="p-2 sm:p-3 rounded-2xl sm:rounded-3xl mb-5 sm:mb-6 text-center border border-mist-200">
                  <h3 className="text-xs sm:text-sm font-semibold text-[#0C084A] pt-1 sm:pt-2 pr-1 sm:pr-2 mb-3 sm:mb-4 text-right">פרטי הבקשה</h3>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="bg-white/60 backdrop-blur-sm p-2 rounded-xl">
                      <p className="text-xs text-mist-500 font-semibold mb-1">שווי הנכס</p>
                      <p className="text-lg sm:text-2xl font-semibold text-[#0C084A]"><Amount value={formData.propertyPrice} /></p>
                    </div>

                    <div className="bg-white/60 backdrop-blur-sm p-2 rounded-xl">
                      <p className="text-xs text-mist-500 font-semibold mb-1">משכנתא מבוקשת</p>
                      <p className="text-lg sm:text-2xl font-semibold text-[#0153F4]"><Amount value={results.loanAmount} /></p>
                    </div>

                    <div className="bg-white/60 backdrop-blur-sm p-2 rounded-xl">
                      <p className="text-xs text-mist-500 font-semibold mb-1">אחוז מימון (LTV)</p>
                      {(() => {
                         const isFirst = formData.mortgageType === 'purchase_first';
                         const isImprove = formData.mortgageType === 'purchase_improve';
                         const isAdditional = formData.mortgageType === 'purchase_additional';
                         const isAnyPurpose = formData.mortgageType === 'any_purpose';
                         const maxLTV = results.isReverse ? getReverseMortgageMaxLTV(formData.youngestBorrowerAge || formData.age) : results.isSenior ? SENIOR_BANK_MAX_LTV : isFirst ? 75 : isImprove ? 70 : isAdditional || isAnyPurpose ? 50 : 75;
                        return (
                          <>
                            <p className="text-lg sm:text-2xl font-semibold text-[#0C084A]">
                              {results.ltv.toFixed(1)}%
                            </p>
                            <p className="text-[10px] text-mist-400 mt-1">תקרה: עד {maxLTV}%</p>
                          </>
                        );
                      })()}
                    </div>
                  </div>
                </div>

                {/* ניתוח מקצועי מלא */}
                <ProfessionalAnalysis text={aiAnalysis} />

                {/* תשלום מינימלי + הכנסה נדרשת */}
                {!isRefinance && results.minMix && (
                  <div className="p-6 sm:p-8 rounded-2xl sm:rounded-3xl mb-5 sm:mb-6 text-center bg-periwinkle-100">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-white/60 backdrop-blur-sm p-4 rounded-xl">
                        <p className="text-xs text-mist-500 font-semibold mb-1">תשלום חודשי מינימלי</p>
                        <p className="text-lg sm:text-2xl font-semibold text-[#0153F4]"><Amount value={Math.floor(results.minMix.minMonthlyPayment)} /></p>
                      </div>
                      <div className="bg-white/60 backdrop-blur-sm p-4 rounded-xl">
                        <p className="text-xs text-mist-500 font-semibold mb-1">הכנסה חודשית נדרשת לאישור</p>
                        <p className="text-lg sm:text-2xl font-semibold text-[#0C084A]"><Amount value={Math.floor(results.minMix.requiredIncome)} /></p>
                      </div>
                    </div>
                  </div>
                )}

                {results.status.action && (
                  <div className={`mb-5 sm:mb-6 p-4 sm:p-6 rounded-xl border ${
                    results.status.color === 'red' ? 'bg-red-100 border-red-300 shadow-sm' : 'border-mist-200'
                  }`}>
                    <p className={`font-bold text-sm sm:text-base leading-relaxed ${
                      results.status.color === 'red' ? 'text-red-800' : 'text-mist-700'
                    }`}>
                      <strong>המלצת מיקוד:</strong> {results.status.action}
                    </p>
                  </div>
                )}

                <div className="mb-8 sm:mb-12 pt-4 border-t border-mist-200">
                  <p className="text-[10px] text-mist-400 text-center">* הדירוג מבוסס על תקני בנק ישראל ונתוני ההצהרה שמילאת</p>
                </div>
              </>
              )}

              {isRefinance && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6 mb-6 sm:mb-10 text-right">
                  <div className="p-5 sm:p-6 md:p-8 rounded-xl sm:rounded-2xl bg-[#0C084A] text-white">
                    <span className="font-semibold text-[10px] sm:text-xs uppercase tracking-wide text-[#0153F4]">יתרת משכנתא קיימת</span>
                    <div className="text-2xl sm:text-3xl md:text-4xl font-semibold mt-2 sm:mt-3 leading-none break-all"><Amount value={results.balance} /></div>
                    <div className="mt-2 sm:mt-3 font-medium text-xs sm:text-sm text-mist-300">ריבית קיימת משוערת: {results.impliedRate?.toFixed(2)}%</div>
                  </div>
                  <div className="p-5 sm:p-6 md:p-8 rounded-xl sm:rounded-2xl border bg-periwinkle-100 border-transparent">
                    <span className="font-semibold text-[10px] sm:text-xs uppercase tracking-wide text-[#023090]">החזר חודשי חדש</span>
                    <div className="text-2xl sm:text-3xl md:text-4xl font-semibold mt-2 sm:mt-3 leading-none text-[#0C084A]"><Amount value={Math.floor(results.mixB.total)} /></div>
                    <div className="mt-2 sm:mt-3 font-medium text-xs sm:text-sm text-mist-600">חיסכון: ₪{formatCurrency(results.monthlySaving)} לחודש</div>
                  </div>
                </div>
              )}

              {/* פאנל השוואת בלון */}
              {results.isSenior && results.isBalloon && results.balloonMonthly > 0 && (
                <div className="mb-6 sm:mb-10 p-5 sm:p-8 rounded-2xl bg-gradient-to-br from-brand-900 to-brand-800 text-white animate-in slide-in-from-bottom-4 duration-700">
                  <h3 className="text-xl font-black mb-5 flex items-center gap-2">השוואת תזרים — מסלול בלון מול משכנתא רגילה</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
                    <div className="bg-white/10 rounded-xl p-4 text-center border border-white/20">
                      <p className="text-xs text-brand-300 font-semibold mb-1">בלון – ריבית בלבד</p>
                      <p className="text-3xl font-semibold text-green-300"><Amount value={Math.floor(results.balloonMonthly)} /></p>
                      <p className="text-[10px] text-brand-300 mt-1">לחודש</p>
                    </div>
                    <div className="bg-white/10 rounded-xl p-4 text-center border border-white/20">
                      <p className="text-xs text-brand-300 font-semibold mb-1">משכנתא רגילה</p>
                      <p className="text-3xl font-semibold text-white"><Amount value={Math.floor(results.regularMonthly)} /></p>
                      <p className="text-[10px] text-brand-300 mt-1">לחודש</p>
                    </div>
                    <div className="bg-green-500/20 rounded-xl p-4 text-center border border-green-400">
                      <p className="text-xs text-green-300 font-semibold mb-1">תזרים פנוי נוסף</p>
                      <p className="text-3xl font-semibold text-green-300"><Amount value={Math.floor(results.regularMonthly - results.balloonMonthly)} /></p>
                      <p className="text-[10px] text-green-300 mt-1">לחודש לשימושך האישי</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="bg-white/10 rounded-xl p-4 border border-white/20">
                      <p className="text-xs text-brand-300 font-semibold mb-2">כרית הון (Equity Buffer)</p>
                      <p className="text-sm text-white leading-relaxed">בהנחת עליית ערך של 3% בשנה, הנכס יהיה שווה כ-₪{formatCurrency(Math.floor(Number(String(formData.propertyPrice).replace(/,/g,'')) * Math.pow(1.03, Number(formData.loanDuration))))} בתום {formData.loanDuration} שנה, כאשר הקרן הנפרעת תהיה ₪{formatCurrency(Math.floor(results.loanAmount))} בלבד.</p>
                    </div>
                    <div className="bg-red-500/20 rounded-xl p-4 border border-red-400">
                      <p className="text-xs text-red-300 font-semibold mb-2">גילוי נאות חובה</p>
                      <p className="text-xs text-red-200 leading-relaxed">הלוואת בלון: הקרן (₪{formatCurrency(Math.floor(results.loanAmount))}) אינה נפרעת במהלך התקופה ותשולם במלואה בתום {formData.loanDuration} שנה לפי אסטרטגיית היציאה שבחרת.</p>
                    </div>
                  </div>
                </div>
              )}

              {!isPurchased && <AdvisorComparison />}

              {!isPurchased && (
                <div className="mb-6 p-5 rounded-2xl border border-dashed border-[#0153F4] bg-periwinkle-100 flex flex-col sm:flex-row items-center gap-4 text-center sm:text-right">
                  <Lock size={28} className="text-[#0C084A] flex-shrink-0" />
                  <div className="flex-1">
                    <h4 className="font-black text-[#06042A] text-base mb-1">התמהילים המלאים נעולים</h4>
                    <p className="text-mist-600 font-medium text-xs leading-relaxed">הפקת פירוט הריביות והחזרים מדויקים דורשת פתיחת תיק במיקוד משכנתאות.</p>
                    {paymentNotice && (
                      <p className="mt-2 text-[#0C084A] font-bold text-xs leading-relaxed">{paymentNotice}</p>
                    )}
                  </div>
                  <button onClick={handlePurchaseClick} disabled={paymentLoading} className="bg-[#0C084A] text-white px-6 py-3 rounded-full font-black text-sm shadow-lg hover:bg-[#1362FF] hover:text-[#06042A] transition-all flex-shrink-0 whitespace-nowrap disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2">
                    {paymentLoading && <Loader2 size={16} className="animate-spin" />}
                    רכוש דוח ₪499
                  </button>
                  {PAYMENT_BYPASS_ENABLED && (
                    <button onClick={() => setIsPurchased(true)} className="border border-[#0153F4] text-[#0C084A] px-5 py-3 rounded-full font-bold text-sm hover:bg-white transition-all flex-shrink-0 whitespace-nowrap">
                      דלג על התשלום (דמו)
                    </button>
                  )}
                </div>
              )}

              <div className={`mb-6 sm:mb-10 transition-all duration-1000 ${!isPurchased ? 'opacity-60 pointer-events-none select-none' : ''}`} style={!isPurchased ? {filter: 'blur(8px)'} : {}}>
                <MixComparison
                   mixA={results.mixA}
                   mixB={results.mixB}
                   mixC={results.mixC}
                   cpiMix={results.cpiMix}
                   loanAmount={isRefinance ? results.balance : results.loanAmount}
                   durationYears={isRefinance ? results.mixC_duration : results.actualDuration}
                   isRefinance={isRefinance}
                   isPurchased={isPurchased}
                   isDeclarationApprovalPossible={results.isDeclarationApprovalPossible}
                   minMix={results.minMix}
                   totalIncome={results.totalIncome}
                 />
              </div>



              {isPurchased && (
                <div className="mt-8 sm:mt-12">
                  <NegotiationPack 
                    formData={{
                      ...formData,
                      completionAmount: Object.values(equityCompletion.sourceAmounts || {}).reduce((sum, v) => sum + Number(String(v || '0').replace(/,/g, '')), 0),
                      completionSources: (equityCompletion.completionSources || []).filter(s => s !== 'liquid_equity'),
                    }} 
                    results={{ ...results, aiAnalysis }}
                    selectedMix={results.mixB}
                    fullName={fullName}
                    borrowers={borrowers}
                  />
                </div>
              )}

              </div>{/* סגירת p-4 */}
              </div>{/* סגירת bg-white */}

              <div className="mt-6 sm:mt-10 bg-[#06042A] rounded-xl sm:rounded-[2rem] p-5 sm:p-8 md:p-12 text-white flex flex-col items-center gap-5 sm:gap-8 shadow-2xl text-center">
                <div className="max-w-xl">
                  <h4 className="text-xl sm:text-2xl md:text-3xl lg:text-4xl font-black mb-3 sm:mb-5 leading-tight tracking-tight italic">המטרה שלנו היא<br/>החיסכון הגדול שלכם.</h4>
                  <p className="text-mist-400 text-xs sm:text-sm md:text-base font-bold leading-relaxed italic">הניתוח הוא רק ההתחלה. מומחי מיקוד משכנתאות ישיגו לכם את התנאים המנצחים במערכת הבנקאית.</p>
                </div>
                <div className="flex flex-col items-center gap-3 sm:gap-5">
                  <a href="tel:2324" className="bg-[#1362FF] text-[#06042A] px-12 sm:px-16 md:px-20 py-5 sm:py-6 md:py-7 rounded-[1.5rem] font-black text-4xl sm:text-5xl md:text-6xl shadow-2xl hover:bg-white transition-all transform hover:scale-105 active:scale-95 leading-none">2324*</a>
                  <p className="text-[#1362FF] font-black tracking-widest uppercase text-[9px] sm:text-[10px]">פגישת ייעוץ אישית ללא התחייבות</p>
                </div>
              </div>
          </div>
        )}
      </main>

      <MikoChat formData={formData} results={results} isPurchased={isPurchased} isOpen={isChatOpen} setIsOpen={setIsChatOpen} rates={rates} />

      {/* סקשנים תחתונים — מוצגים רק בשלב 1 לפני מילוי */}
      {step === 1 && !codeSent && (
        <>
          <SocialProof />
        </>
      )}

      <FooterCTA />
    </div>
  );
}
