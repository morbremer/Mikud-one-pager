// מצב שדה: { value, source: typed|answer_recording|conversation, status: draft|needs_check|confirmed, quote, note }
export function mergeExtraction(prev, extracted = {}, source) {
  const next = { ...prev };
  for (const [key, item] of Object.entries(extracted)) {
    if (!item || item.value === null || item.value === undefined || item.value === '') continue;
    const value = String(item.value);
    const old = prev[key];
    const conflict = old?.value && String(old.value) !== value;
    next[key] = {
      value,
      source,
      status: conflict || item.certainty !== 'clear' ? 'needs_check' : 'draft',
      quote: item.quote || '',
      note: conflict ? `נאמר קודם ערך אחר: ${old.value}` : '',
    };
  }
  return next;
}

export function mergeStory(prev, story) {
  if (!story) return prev;
  const join = (a = [], b = []) => [...new Set([...(a || []), ...(b || [])].filter(Boolean))];
  return {
    goals: join(prev?.goals, story.goals),
    concerns: join(prev?.concerns, story.concerns),
    missing: join(prev?.missing, story.missing),
  };
}

function ageFrom(birthDate) {
  const d = new Date(birthDate);
  if (!birthDate || isNaN(d.getTime())) return '';
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return String(age);
}

// ממיר את הנתונים שאושרו למבנה של שאלון ההיתכנות הקיים (formData + borrowers)
export function toCalculatorInput(fields) {
  const v = (k) => fields[k]?.value ?? '';
  const emp = v('employmentType') || 'employee';
  const formData = {
    firstName: v('firstName'), lastName: v('lastName'), phone: v('phone'), email: v('email'),
    idNumber: v('idNumber'), birthDate: v('birthDate'), age: ageFrom(v('birthDate')),
    mortgageType: v('mortgageType') || 'purchase_first',
    propertyPrice: v('propertyPrice'), loanAmount: v('loanAmount'), equity: v('equity'),
    monthlyDebts: v('monthlyDebts') || '0', monthlyOverdraft: v('monthlyRent') || '0',
    loanDuration: v('loanDuration') || '25',
  };
  const borrowers = [{
    maritalStatus: v('maritalStatus') || 'single', childrenUnder18: '0', creditHistory: 'clean',
    employmentTypes: [emp], incomeSources: { [emp]: { amount: v('netIncome') } }, borrowerType: 'primary',
  }];
  if (Number(v('spouseIncome')) > 0) {
    borrowers.push({
      maritalStatus: 'married', childrenUnder18: '0', creditHistory: 'clean', employmentTypes: ['employee'],
      incomeSources: { employee: { amount: v('spouseIncome') } }, borrowerType: 'primary', isSpouse: true,
    });
  }
  return { formData, borrowers };
}