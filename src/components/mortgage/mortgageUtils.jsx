// ─── mortgageUtils.js ────────────────────────────────────────────────────────
// כל הלוגיקה הפיננסית של המשכנתא – נפרדת מה-UI לחלוטין

// ריביות ברירת מחדל - ינואר 2026
// פריים בסיסי: 5.5% (ב"י 4% + 1.5%)
// פריים אפקטיבי ללקוח: 4.9% (פריים מינוס 0.6% הנחה)
export const DEFAULT_RATES = {
  PRIME:          0.0550, // פריים בסיסי
  PRIME_CALC:     0.0490, // פריים אפקטיבי ללקוח (P - 0.6%)
  FIXED_UNLINKED: 0.0470, // קבועה לא צמודה
  VAR_UNLINKED:   0.0458, // משתנה לא צמודה
  FIXED_LINKED:   0.0320, // קבועה צמודה
  VAR_LINKED:     0.0315, // משתנה צמודה
};

export const SENIOR_BANK_MAX_LTV  = 45;
export const SENIOR_BANK_MAX_TERM = 30;
export const BALLOON_MAX_TERM     = 15;

export const formatCurrency = (val) => {
  if (!val || isNaN(val)) return "0";
  return new Intl.NumberFormat('he-IL').format(Math.round(val));
};

export const calculatePayment = (principal, rate, years) => {
  if (!principal || !rate || !years || years <= 0) return 0;
  const i = rate / 12;
  const n = years * 12;
  if (i === 0) return principal / n;
  return (principal * i * Math.pow(1 + i, n)) / (Math.pow(1 + i, n) - 1);
};

// תיקון: הוסרה הסרת "-" שפגמה במספרי טלפון
export const cleanAiText = (text) => {
  if (!text) return "";
  const lines = text
    .replace(/[*#_]/g, '')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0);
  return lines.map((line, i) => `${i + 1}. ${line.replace(/^[0-9]+\.\s*/, '')}`).join('\n\n');
};

export const getReverseMortgageMaxLTV = (age) => {
  const a = Number(age) || 60;
  if (a >= 80) return 50;
  if (a >= 75) return 40;
  if (a >= 70) return 30;
  if (a >= 65) return 25;
  return 20;
};

export const calcTotalIncome = (borrowers, formData = {}) => {
  let total = 0;
  borrowers.forEach((b, idx) => {
    // בן/בת זוג (isSpouse) מוכרים ב-100% כמו הלווה הראשי.
    // לווה נוסף שאינו בן/בת זוג — 50% בלבד.
    const isSpouse = b.isSpouse === true;
    const factor = (idx > 0 && b.borrowerType === 'additional' && !isSpouse) ? 0.5 : 1.0;
    const sources = b.incomeSources || {};
    Object.values(sources).forEach(src => {
      if (src && (src.amount || src.enabled)) {
        total += Number(String(src.amount || '0').replace(/,/g, '')) * factor;
      }
    });
  });

  // טיפול בהפרש שכירות: רכישה ראשונה / משפרי דיור שמשכירים נכס נרכש וגרים בשכירות
  const mortgageType = formData.mortgageType;
  if (['purchase_first', 'purchase_improve'].includes(mortgageType) && formData.rentIncomeFromPurchased) {
    const rentIn  = Number(String(formData.rentIncomeFromPurchased || '0').replace(/,/g, ''));
    const rentOut = Number(String(formData.monthlyOverdraft || '0').replace(/,/g, ''));
    const diff = rentIn - rentOut;
    if (!formData.ignoreRentDiff) {
      total += diff; // חיובי = מוסיף להכנסה | שלילי = מוריד מהכנסה
    }
  }

  return total;
};

// ─── תמהיל מינימלי: ⅓ קבועה צמודה + ⅔ משתנה צמודה לתקופה מקסימלית ──────────
export const calcMinMix = (loanAmount, maxTerm, rates) => {
  const term = Math.min(30, maxTerm || 30);
  const fixedRate = rates.FIXED_LINKED || 0.0320;
  const varRate   = rates.VAR_LINKED   || 0.0315;
  const pmtFixed  = calculatePayment(loanAmount * (1 / 3), fixedRate, term);
  const pmtVar    = calculatePayment(loanAmount * (2 / 3), varRate,   term);
  const minMonthlyPayment = pmtFixed + pmtVar;
  const requiredIncome    = minMonthlyPayment / 0.40; // DTI 40% → הכנסה נדרשת
  return {
    minMonthlyPayment,
    requiredIncome,
    term,
    tracks: [
      { name: 'קבועה צמודה (⅓)', amount: loanAmount * (1 / 3), rate: fixedRate, years: term, pmt: pmtFixed },
      { name: 'משתנה צמודה (⅔)', amount: loanAmount * (2 / 3), rate: varRate,   years: term, pmt: pmtVar  },
    ],
  };
};

// חישוב כדאיות מחזור משכנתא
export const calculateRefinanceResults = ({ formData, borrowers, rates }) => {
  const balance = Number(String(formData.refinanceBalance || '0').replace(/,/g, ''));
  const currentMonthly = Number(String(formData.currentMonthlyPayment || '0').replace(/,/g, ''));
  const remainingYears = Number(formData.refinanceRemainingYears || 20);
  const totalInc = calcTotalIncome(borrowers, formData);
  const debts = Number(String(formData.monthlyDebts || '0').replace(/,/g, ''));

  // חישוב ריבית ממוצעת קיימת (לפי יתרה, החזר ותקופה)
  let impliedRate = rates.FIXED_UNLINKED; // ברירת מחדל
  if (balance > 0 && currentMonthly > 0 && remainingYears > 0) {
    // נסיון למצוא ריבית שמסבירה את הנתונים
    const n = remainingYears * 12;
    const p = balance;
    const pmt = currentMonthly;
    // קירוב: r = (pmt/p) * (1 - 1/(1+r)^n) - iterative
    let r = 0.004;
    for (let i = 0; i < 50; i++) {
      const f = p * r * Math.pow(1+r, n) / (Math.pow(1+r, n) - 1) - pmt;
      const df = p * (Math.pow(1+r,n) * (1 + r*n) - Math.pow(1+r,n) + 1) / Math.pow(Math.pow(1+r,n)-1, 2);
      const rNew = r - f/df;
      if (Math.abs(rNew - r) < 0.0000001) break;
      r = Math.max(0.0001, rNew);
    }
    impliedRate = r * 12;
  }

  // האם הלקוח יכול להגדיל החזר
  const canIncrease = formData.refinanceCanIncreasePayment === 'yes';
  const increaseAmount = canIncrease ? Number(String(formData.refinanceIncreaseAmount || '0').replace(/,/g, '')) : 0;

  const calcPmt = (principal, rate, years) => calculatePayment(principal, rate, years);

  // תרחיש א: אותו החזר חודשי — תקופה קצרה יותר
  // מחשב כמה שנים נחסוך עם תמהיל חדש על אותה תקופה
  const durationSamePayment = remainingYears;
  const mixA_pmt = calcPmt(balance, rates.FIXED_UNLINKED, durationSamePayment);
  const mixA_totalCost = mixA_pmt * durationSamePayment * 12;

  // תרחיש ב (מומלץ): תמהיל מאוזן — אותה תקופה
  const newDuration = remainingYears;
  const mixB_T1_pmt = calcPmt(balance * 0.33, rates.PRIME_CALC, newDuration);
  const mixB_T2_pmt = calcPmt(balance * 0.33, rates.FIXED_UNLINKED, newDuration);
  const mixB_T3_pmt = calcPmt(balance * 0.34, rates.VAR_LINKED, newDuration);
  const mixB_pmt = mixB_T1_pmt + mixB_T2_pmt + mixB_T3_pmt;
  const mixB_totalCost = mixB_pmt * newDuration * 12;

  // תרחיש ג: הגדלת החזר (אם רלוונטי) — מקצר תקופה
  // מחשב תקופה קצרה יותר עם ההחזר המוגדל
  let mixC_duration = newDuration;
  let mixC_pmt_monthly = calcPmt(balance * 0.5, rates.PRIME_CALC, newDuration) + calcPmt(balance * 0.5, rates.FIXED_UNLINKED, newDuration);
  if (canIncrease && increaseAmount > 0) {
    const targetPmt = mixB_pmt + increaseAmount;
    // מחשב תקופה שמתאימה להחזר המוגדל (קירוב)
    const r = rates.FIXED_UNLINKED / 12;
    if (r > 0 && targetPmt > balance * r) {
      mixC_duration = Math.ceil(Math.log(targetPmt / (targetPmt - balance * r)) / Math.log(1 + r) / 12);
      mixC_duration = Math.max(1, Math.min(mixC_duration, newDuration));
    }
    const mixC_T1_pmt = calcPmt(balance * 0.5, rates.PRIME_CALC, mixC_duration);
    const mixC_T2_pmt = calcPmt(balance * 0.5, rates.FIXED_UNLINKED, mixC_duration);
    mixC_pmt_monthly = mixC_T1_pmt + mixC_T2_pmt;
  }
  const mixC_totalCost = mixC_pmt_monthly * mixC_duration * 12;

  // חיסכון בהשוואה לעלות נוכחית
  const totalCurrentCost = currentMonthly * remainingYears * 12;
  const monthlySaving = currentMonthly - mixB_pmt;
  const totalSaving = totalCurrentCost - mixB_totalCost;

  // break-even: עלות פתיחת תיק ~5000 שח
  const breakEvenMonths = monthlySaving > 0 ? Math.ceil(5000 / monthlySaving) : null;

  const freeIncome = Math.max(1, totalInc - debts);
  const dti = (mixB_pmt / freeIncome) * 100;
  const isWorthwhile = totalSaving > 5000 && monthlySaving > 0;

  return {
    balance,
    currentMonthly,
    remainingYears,
    impliedRate: impliedRate * 100,
    monthlySaving: Math.floor(monthlySaving),
    totalSaving: Math.floor(totalSaving),
    breakEvenMonths,
    isWorthwhile,
    dti,
    totalIncome: totalInc,
    canIncrease,
    increaseAmount,
    mixC_duration,
    score: Math.min(100, Math.max(0, isWorthwhile ? 80 + Math.min(20, totalSaving / 10000) : 40)),
    // תרחיש א: קבועה לא צמודה — הגנה מלאה, אותה תקופה
    mixA: {
      label: 'תרחיש א׳ — הגנה מלאה',
      subtitle: `אותה תקופה (${remainingYears} שנים) — ריבית קבועה`,
      tracks: [{ name: "100% קבועה לא צמודה", amount: balance, rate: rates.FIXED_UNLINKED, years: durationSamePayment, pmt: mixA_pmt, desc: "הגנה מלאה" }],
      total: mixA_pmt,
      totalCost: mixA_totalCost,
      saving: totalCurrentCost - mixA_totalCost,
    },
    // תרחיש ב (מומלץ): תמהיל מאוזן
    mixB: {
      label: 'תרחיש ב׳ — תמהיל מאוזן (מומלץ)',
      subtitle: `אותה תקופה — חיסכון מקסימלי בריבית`,
      tracks: [
        { name: "פריים (Prime)", amount: balance * 0.33, rate: rates.PRIME_CALC, years: newDuration, pmt: mixB_T1_pmt, desc: "P-0.5%" },
        { name: "קבועה לא צמודה", amount: balance * 0.33, rate: rates.FIXED_UNLINKED, years: newDuration, pmt: mixB_T2_pmt, desc: "החזר קבוע" },
        { name: "משתנה כל 5 שנים צמודה", amount: balance * 0.34, rate: rates.VAR_LINKED, years: newDuration, pmt: mixB_T3_pmt, desc: "משתנה צמודה" },
      ],
      total: mixB_pmt,
      totalCost: mixB_totalCost,
      saving: totalCurrentCost - mixB_totalCost,
    },
    // תרחיש ג: הגדלת החזר / פריים+קבועה
    mixC: {
      label: canIncrease && increaseAmount > 0
        ? `תרחיש ג׳ — הגדלת ₪${increaseAmount} לחודש`
        : `תרחיש ג׳ — פריים + קבועה`,
      subtitle: canIncrease && increaseAmount > 0
        ? `קיצור תקופה ל-${mixC_duration} שנים — חיסכון ריבית מקסימלי`
        : `50% פריים + 50% קבועה — גמישות`,
      tracks: canIncrease && increaseAmount > 0
        ? [
            { name: "50% פריים (תקופה מקוצרת)", amount: balance * 0.5, rate: rates.PRIME_CALC, years: mixC_duration, pmt: calcPmt(balance * 0.5, rates.PRIME_CALC, mixC_duration), desc: `${mixC_duration} שנים` },
            { name: "50% קבועה לא צמודה", amount: balance * 0.5, rate: rates.FIXED_UNLINKED, years: mixC_duration, pmt: calcPmt(balance * 0.5, rates.FIXED_UNLINKED, mixC_duration), desc: `${mixC_duration} שנים` },
          ]
        : [
            { name: "50% פריים", amount: balance * 0.5, rate: rates.PRIME_CALC, years: newDuration, pmt: calcPmt(balance * 0.5, rates.PRIME_CALC, newDuration), desc: "גמישות" },
            { name: "50% קבועה לא צמודה", amount: balance * 0.5, rate: rates.FIXED_UNLINKED, years: newDuration, pmt: calcPmt(balance * 0.5, rates.FIXED_UNLINKED, newDuration), desc: "יציבות" },
          ],
      total: mixC_pmt_monthly,
      totalCost: mixC_totalCost,
      saving: totalCurrentCost - mixC_totalCost,
    },
    actualDuration: newDuration,
  };
};

// ─── ציון מתקדם (0-100) לפי תקני בנק ישראל האמיתיים ───────────────────────
export const calcAdvancedScore = ({ dti, ltv, borrowers, formData, isReverse, isSenior }) => {
  if (isReverse || isSenior) return Math.min(100, Math.max(0, 100 - (ltv > 45 ? (ltv - 45) * 2 : 0)));

  let score = 100;

  // DTI — הגורם הכבד ביותר (40 נקודות)
  if (dti > 45) score -= 45;
  else if (dti > 40) score -= 30;
  else if (dti > 35) score -= 15;
  else if (dti > 30) score -= 5;
  // בונוס DTI נמוך
  if (dti < 25) score += 5;

  // LTV — (25 נקודות)
  if (ltv > 80) score -= 30;
  else if (ltv > 75) score -= 20;
  else if (ltv > 70) score -= 10;
  else if (ltv > 65) score -= 5;
  if (ltv < 60) score += 5;

  // היסטוריית אשראי — (20 נקודות)
  const creditIssues = borrowers.some(b => b.creditHistory === 'issues');
  const creditWarning = borrowers.some(b => b.creditHistory === 'minor_issues');
  if (creditIssues) score -= 25;
  else if (creditWarning) score -= 10;
  else score += 5; // נקי — בונוס

  // ותק תעסוקה — (10 נקודות)
  const maxSeniority = Math.max(...borrowers.map(b => {
    const sources = b.incomeSources || {};
    const emp = sources.employee || sources.self_employed || {};
    return Number(emp.seniority || 0);
  }));
  if (maxSeniority >= 5) score += 5;
  else if (maxSeniority >= 2) score += 2;
  else if (maxSeniority < 1) score -= 10;

  // מספר לווים — מחזק תיק
  if (borrowers.length > 1) score += 5;

  // עצמאי — סיכון גבוה יותר
  const hasSelfEmployed = borrowers.some(b => (b.employmentTypes || []).some(t => ['self_employed','controlling_shareholder'].includes(t)));
  if (hasSelfEmployed) score -= 5;

  return Math.min(100, Math.max(10, Math.round(score)));
};

// ─── תמהיל חירום: צמוד מדד בלבד — להחזר מינימלי כשDTI>40 ──────────────────
export const calcCpiMix = (loanAmount, duration, rates, freeIncome) => {
  const term = Math.min(30, duration || 30);
  // ⅓ קבועה צמודה + ⅔ משתנה צמודה — הריביות הנמוכות ביותר
  const fixedLinkedRate = rates.FIXED_LINKED || 0.0320;
  const varLinkedRate   = rates.VAR_LINKED   || 0.0315;
  const pmt1 = calculatePayment(loanAmount * (1/3), fixedLinkedRate, term);
  const pmt2 = calculatePayment(loanAmount * (2/3), varLinkedRate,   term);
  const total = pmt1 + pmt2;
  const dtiWithMix = freeIncome > 0 ? (total / freeIncome) * 100 : 999;
  const isValid = dtiWithMix <= 40;
  return {
    tracks: [
      { name: 'קבועה צמודה מדד (⅓)', amount: loanAmount*(1/3), rate: fixedLinkedRate, years: term, pmt: pmt1, desc: 'הגנה מלאה' },
      { name: 'משתנה צמודה מדד (⅔)', amount: loanAmount*(2/3), rate: varLinkedRate,   years: term, pmt: pmt2, desc: 'ריבית נמוכה' },
    ],
    total,
    isValid,
    dti: dtiWithMix,
    term,
  };
};

export const calculateResults = ({ formData, borrowers, maxTerm = 30, rates, ALL_PURPOSE_RATES }) => {
  const price         = Number(String(formData.propertyPrice).replace(/,/g, '')) || 0;
  const eq            = Number(String(formData.equity).replace(/,/g, '')) || 0;
  const duration      = Math.min(maxTerm, Number(formData.loanDuration) || maxTerm);
  const requestedLoan = Number(String(formData.loanAmount || '').replace(/,/g, '')) || 0;
  const rawLoanAmount = requestedLoan > 0 ? requestedLoan : Math.max(0, price - eq);

  // חישוב LTV מקסימלי לפי סוג עסקה
  const isFirst      = formData.mortgageType === 'purchase_first';
  const isImproveT   = formData.mortgageType === 'purchase_improve';
  const isAdditionalT = formData.mortgageType === 'purchase_additional';
  const isAnyPurposeT = formData.mortgageType === 'any_purpose';
  const isMachirMataraT = formData.mortgageType === 'purchase_machir_matarah';
  // מחיר מטרה: עד 90% ממחיר הרכישה, אך לא יותר מ-75% משווי הנכס לפי שמאות
  const machirMataraPrice = Number(String(formData.propertyPrice || '0').replace(/,/g, ''));
  const machirMataraAppraisalValue = Number(String(formData.appraisalValue || formData.propertyPrice || '0').replace(/,/g, ''));
  const maxLTVPct    = isFirst ? 0.75 : isImproveT ? 0.70 : (isAdditionalT || isAnyPurposeT) ? 0.50 : isMachirMataraT ? 0.75 : 0.75;
  // עבור מחיר מטרה: המקסימום הוא המינימום בין 90% ממחיר הרכישה ל-75% מהשמאות
  const maxAllowedLoanRaw = price > 0 ? price * maxLTVPct : rawLoanAmount;
  const maxAllowedLoan = isMachirMataraT && machirMataraPrice > 0
    ? Math.min(machirMataraPrice * 0.90, machirMataraAppraisalValue * 0.75)
    : maxAllowedLoanRaw;

  // סכום אמיתי לניתוח = לא יותר מהמותר
  const loanAmount    = Math.min(rawLoanAmount, maxAllowedLoan);
  const excessAmount  = Math.max(0, rawLoanAmount - maxAllowedLoan);

  const ltv           = price > 0 ? (loanAmount / price) : 0;
  const totalInc      = calcTotalIncome(borrowers, formData);
  const debts         = Number(String(formData.monthlyDebts).replace(/,/g, '')) || 0;
  const freeIncome    = Math.max(1, totalInc - debts);
  const isReverse     = formData.mortgageType === 'reverse_mortgage';
  const isSenior      = formData.mortgageType === 'senior_bank';
  const isBalloon     = formData.seniorBalloon === true;

  const activeRates = isSenior ? ALL_PURPOSE_RATES : rates;

  const calcPmt = (principal, rate, years) => {
    if (isSenior && isBalloon) return principal * rate / 12;
    return calculatePayment(principal, rate, years);
  };

  const mixB_T1 = {
    name: "פריים (Prime)",
    amount: loanAmount * 0.33,
    rate: activeRates.PRIME_CALC,
    years: duration,
    pmt: calcPmt(loanAmount * 0.33, activeRates.PRIME_CALC, duration),
    desc: isSenior && isBalloon ? "ריבית בלבד" : "P-0.5%",
  };
  const mixB_T2 = {
    name: "קבועה לא צמודה (קל\"צ)",
    amount: loanAmount * 0.33,
    rate: activeRates.FIXED_UNLINKED,
    years: duration,
    pmt: calcPmt(loanAmount * 0.33, activeRates.FIXED_UNLINKED, duration),
    desc: isSenior && isBalloon ? "ריבית בלבד" : "החזר קבוע",
  };
  const mixB_T3 = {
    name: "משתנה כל 5 שנים צמודה",
    amount: loanAmount * 0.34,
    rate: activeRates.VAR_LINKED,
    years: duration,
    pmt: calcPmt(loanAmount * 0.34, activeRates.VAR_LINKED, duration),
    desc: isSenior && isBalloon ? "ריבית בלבד" : "משתנה צמודה",
  };
  const pmtB = mixB_T1.pmt + mixB_T2.pmt + mixB_T3.pmt;

  const balloonInterestOnly = isSenior && isBalloon ? loanAmount * activeRates.FIXED_UNLINKED / 12 : null;
  // חישוב DTI על בסיס תמהיל מינימלי (⅓ קבועה צמודה + ⅔ משתנה צמודה, תקופה מקס)
  const minMixData = calcMinMix(loanAmount, duration, activeRates);
  const dtiBase  = isSenior && isBalloon ? balloonInterestOnly : minMixData.minMonthlyPayment;
  const dti      = (isReverse || isSenior) ? 0 : (dtiBase / freeIncome) * 100;
  const ltvPercent  = ltv * 100;
  const youngestAge = Number(formData.youngestBorrowerAge) || Number(formData.age) || 60;
  const maxReverseLTV = isReverse ? getReverseMortgageMaxLTV(youngestAge) : 75;

  // אזהרת פער מימון — כשהסכום המבוקש עולה על המותר
  const excessWarning = excessAmount > 0
    ? `⚠️ הסכום המבוקש (₪${formatCurrency(rawLoanAmount)}) עולה על המקסימום הבנקאי (₪${formatCurrency(Math.floor(maxAllowedLoan))} — ${Math.round(maxLTVPct * 100)}% LTV). הניתוח מבוצע על ₪${formatCurrency(loanAmount)}. הפרש של ₪${formatCurrency(excessAmount)} ניתן לגייס דרך מימון חוץ-בנקאי (ריביות 8%-18%) או עד 85% מימון בתנאים מיוחדים — מומלץ להתייעץ עם יועץ לפני התחייבות.`
    : null;

  let status = {
    color: 'green',
    text: isReverse ? 'כשיר למשכנתא לגיל הזהב' : isSenior ? 'כשיר - משכנתא בנקאית לגיל הזהב' : 'כשיר להגשה לבנק',
    subtitle: isReverse ? `אחוז מימון מקסימלי לגילך: ${maxReverseLTV}%` : isSenior ? `מקסימום ${SENIOR_BANK_MAX_LTV}% מימון | עד 30 שנה | ללא ביטוח חיים חובה` : formData.mortgageType === 'purchase_additional' ? 'התיק עומד בתקני בנק ישראל — שים לב: מס רכישה 8% על נכס נוסף' : 'התיק עומד בתקני בנק ישראל',
    action: excessWarning,
    icon: excessAmount > 0 ? 'warning' : 'check',
    excessAmount,
    excessWarning,
  };

  if (isReverse) {
    if (ltvPercent > maxReverseLTV) {
      const excessLoan = loanAmount - (price * maxReverseLTV / 100);
      status = { ...status, color: 'red', text: 'דורש התאמה', subtitle: `אחוז מימון ${ltvPercent.toFixed(1)}% חורג מהמותר לגילך`, action: `יש להקטין את הסכום המבוקש ב-₪${formatCurrency(Math.floor(excessLoan))} (מקסימום ${maxReverseLTV}% מימון בגיל ${youngestAge}).`, icon: 'alert' };
    }
  } else if (isSenior) {
    if (ltvPercent > SENIOR_BANK_MAX_LTV) {
      const excessLoan = loanAmount - (price * SENIOR_BANK_MAX_LTV / 100);
      status = { ...status, color: 'red', text: 'דורש התאמה', subtitle: `אחוז מימון ${ltvPercent.toFixed(1)}% חורג מהמותר (מקסימום ${SENIOR_BANK_MAX_LTV}%)`, action: `יש להקטין את הסכום המבוקש ב-₪${formatCurrency(Math.floor(excessLoan))} להורדת המימון ל-${SENIOR_BANK_MAX_LTV}%.`, icon: 'alert' };
    }
  } else {
    if (dti > 45) {
      const excessPayment = pmtB - (freeIncome * 0.40);
      const baseAction = `יש להקטין את ההחזר החודשי ב-₪${formatCurrency(Math.floor(excessPayment))} או להגדיל הכנסות.`;
      status = { ...status, color: 'red', text: 'דורש התאמת נתונים', subtitle: `יחס החזר ${dti.toFixed(1)}% חורג מהמותר`, action: excessWarning ? `${baseAction}\n${excessWarning}` : baseAction, icon: 'alert' };
    } else if (dti > 40) {
      const baseAction = 'מומלץ להאריך תקופת הלוואה, לצמצם הלוואות קיימות, או להגדיל הכנסות.';
      status = { ...status, color: 'yellow', text: 'דורש אישור מיוחד', subtitle: `יחס החזר ${dti.toFixed(1)}% גבולי`, action: excessWarning ? `${baseAction}\n${excessWarning}` : baseAction, icon: 'warning' };
    } else if (dti > 35) {
      const baseAction = 'תיק תקין. ניתן לשפר ע"י הארכת תקופה או תמהיל אסטרטגי לחיסכון בריבית.';
      status = { ...status, color: 'yellow', text: 'כשיר עם המלצה לשיפור', subtitle: `יחס החזר ${dti.toFixed(1)}% טוב`, action: excessWarning ? `${baseAction}\n${excessWarning}` : baseAction, icon: 'info' };
    } else if (excessWarning) {
      // כשיר אבל יש פער מימון
      status = { ...status, color: 'yellow', text: 'כשיר — אך שים לב לפער המימון', subtitle: `הבנק יאשר ₪${formatCurrency(loanAmount)} (${Math.round(maxLTVPct * 100)}% מימון מקסימלי)`, action: excessWarning, icon: 'warning' };
    }
  }

  const qualityScore = calcAdvancedScore({ dti, ltv: ltvPercent, borrowers, formData, isReverse, isSenior });

  const balloonMonthly = isSenior && isBalloon ? loanAmount * activeRates.FIXED_UNLINKED / 12 : null;
  const regularMonthly = isSenior ? calculatePayment(loanAmount, activeRates.FIXED_UNLINKED, duration) : null;

  // ━━━ שלושת "הסלים האחידים" (התמהילים המנדטוריים) — לפי הנחיות בנק ישראל ━━━
  // תקופה אחידה לכל הסלים: ברירת המחדל ("כפי שמופיע בטפסים הרשמיים") היא
  // 360 חודשים, מוגבלת רק לפי גיל — maxTerm כבר מייצג את זה (min(30, 85-גיל)),
  // בלי קשר למחוון התקופה שהמשתמש בחר. הסלים הם השוואה תקנית קבועה, לא
  // התאמה אישית — הכשירות/ה-DTI בהמשך עדיין מבוססים על duration שהמשתמש בחר.
  const basketTerm = maxTerm;
  const basketThird = loanAmount / 3;
  const basketHalf = loanAmount / 2;

  // בדיקת תקינות פרטנית לכל תמהיל — האם ההחזר עומד בתקרת 40% DTI
  const maxAllowedPayment = freeIncome * 0.40;
  const mixATotal = calcPmt(loanAmount, activeRates.FIXED_UNLINKED, basketTerm);

  const basket2T1 = { name: "משתנה פריים", amount: basketThird, rate: activeRates.PRIME_CALC, years: basketTerm, pmt: calcPmt(basketThird, activeRates.PRIME_CALC, basketTerm), desc: isSenior && isBalloon ? "ריבית בלבד" : "P-0.5%" };
  const basket2T2 = { name: "קבועה לא צמודה (קל\"צ)", amount: basketThird, rate: activeRates.FIXED_UNLINKED, years: basketTerm, pmt: calcPmt(basketThird, activeRates.FIXED_UNLINKED, basketTerm), desc: isSenior && isBalloon ? "ריבית בלבד" : "החזר קבוע" };
  const basket2T3 = { name: "משתנה צמודה מדד (כל 5 שנים)", amount: basketThird, rate: activeRates.VAR_LINKED, years: basketTerm, pmt: calcPmt(basketThird, activeRates.VAR_LINKED, basketTerm), desc: isSenior && isBalloon ? "ריבית בלבד" : "משתנה צמודה" };
  const mixBTotal = basket2T1.pmt + basket2T2.pmt + basket2T3.pmt;

  const mixCTotal = calcPmt(basketHalf, activeRates.PRIME_CALC, basketTerm) + calcPmt(basketHalf, activeRates.FIXED_UNLINKED, basketTerm);

  // האם ניתן לקבל אישור על בסיס תצהיר (התשלום המינימלי עובר את הבדיקה)
  const isDeclarationApprovalPossible = !isReverse && !isSenior && totalInc > 0 && totalInc >= minMixData.requiredIncome;

  // תמהיל CPI — מוצג כשסל 2 (שלושת השלישים) חורג מ-40% DTI
  // (DTI העיקרי מבוסס על minMix, לכן בודקים כאן את mixBTotal יחסית)
  const cpiMixData = (!isReverse && !isSenior && mixBTotal > maxAllowedPayment)
    ? calcCpiMix(loanAmount, duration, activeRates, freeIncome)
    : null;

  // סכום משכנתא מקסימלי שניתן לקבל לפי הכנסה ותקופה (DTI 40%)
  const maxMonthlyByDTI = freeIncome * 0.40;
  // מחשבים: maxLoanByIncome = PMT^-1(maxMonthlyByDTI, minRate, maxTerm)
  // נשתמש בריבית הנמוכה ביותר (משתנה צמודה) ותקופה מקסימלית
  const minRateForMaxLoan = (activeRates.VAR_LINKED || 0.0315);
  const maxTermMonths = (maxTerm || 30) * 12;
  const rMonthly = minRateForMaxLoan / 12;
  const maxLoanByIncome = rMonthly > 0
    ? maxMonthlyByDTI * (Math.pow(1 + rMonthly, maxTermMonths) - 1) / (rMonthly * Math.pow(1 + rMonthly, maxTermMonths))
    : maxMonthlyByDTI * maxTermMonths;

  return {
    loanAmount, ltv: ltvPercent, totalIncome: totalInc, dti, actualDuration: duration,
    maxLoanByIncome: Math.floor(maxLoanByIncome),
    status, score: qualityScore, isReverse, isSenior, isBalloon,
    cpiMix: cpiMixData,
    balloonMonthly, regularMonthly,
    requestedLoanAmount: rawLoanAmount,
    excessAmount,
    minMix: minMixData,
    isDeclarationApprovalPossible,
    // סל אחיד 1: 100% קל"צ
    mixA: {
      tracks: [{ name: isSenior ? "100% קבועה לא צמודה (כל מטרה)" : "100% קבועה לא צמודה", amount: loanAmount, rate: activeRates.FIXED_UNLINKED, years: basketTerm, pmt: mixATotal, desc: isSenior && isBalloon ? "⚠️ בלון - ריבית בלבד" : "הגנה מלאה" }],
      total: mixATotal,
      isValid: isReverse || isSenior || mixATotal <= maxAllowedPayment,
    },
    // סל אחיד 2 ("סל שלושת השלישים"): 33.3% קל"צ + 33.3% משתנה פריים + 33.3% משתנה צמודה (כל 5 שנים)
    mixB: {
      tracks: [basket2T1, basket2T2, basket2T3],
      total: mixBTotal,
      isValid: isReverse || isSenior || mixBTotal <= maxAllowedPayment,
    },
    // סל אחיד 3 ("סל חצי-חצי"): 50% קל"צ + 50% משתנה פריים, ללא רכיבים צמודי מדד
    mixC: {
      tracks: [
        { name: "50% פריים (Prime)", amount: basketHalf, rate: activeRates.PRIME_CALC, years: basketTerm, pmt: calcPmt(basketHalf, activeRates.PRIME_CALC, basketTerm), desc: isSenior && isBalloon ? "ריבית בלבד" : "ניצול שוק" },
        { name: isSenior ? "50% קבועה (כל מטרה)" : "50% קבועה (קל\"צ)", amount: basketHalf, rate: activeRates.FIXED_UNLINKED, years: basketTerm, pmt: calcPmt(basketHalf, activeRates.FIXED_UNLINKED, basketTerm), desc: isSenior && isBalloon ? "ריבית בלבד" : "עוגן יציבות" },
      ],
      total: mixCTotal,
      isValid: isReverse || isSenior || mixCTotal <= maxAllowedPayment,
    },
  };
};