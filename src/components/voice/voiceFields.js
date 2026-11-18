// שדות מסלול השאלון הקולי — תת-קבוצה של שאלון ההיתכנות על פי הצהרה (ללא מחזור משכנתא).
export const MORTGAGE_TYPE_OPTIONS = [
  { val: 'purchase_first', label: 'רכישה - דירה ראשונה' },
  { val: 'purchase_improve', label: 'רכישה - משפרי דיור / חליפית' },
  { val: 'purchase_machir_matarah', label: 'רכישה - מחיר מטרה' },
  { val: 'purchase_additional', label: 'רכישה - נכס נוסף / השקעה' },
  { val: 'any_purpose', label: 'כל מטרה - סגירת חובות / שיפוץ' },
];

export const VOICE_FIELDS = [
  { key: 'firstName', label: 'שם פרטי', question: 'איך קוראים לך? (שם פרטי)', type: 'text' },
  { key: 'lastName', label: 'שם משפחה', question: 'מה שם המשפחה שלך?', type: 'text' },
  { key: 'idNumber', label: 'תעודת זהות', question: 'מה מספר תעודת הזהות שלך? (9 ספרות)', type: 'digits' },
  { key: 'birthDate', label: 'תאריך לידה', question: 'מה תאריך הלידה שלך?', type: 'date' },
  { key: 'phone', label: 'טלפון נייד', question: 'מה מספר הטלפון הנייד שלך?', type: 'digits' },
  { key: 'email', label: 'דוא״ל', question: 'מה כתובת הדוא״ל שלך? (מומלץ להקליד)', type: 'text' },
  { key: 'maritalStatus', label: 'מצב משפחתי', question: 'מה המצב המשפחתי שלך?', type: 'select', options: [
    { val: 'single', label: 'רווק/ה' }, { val: 'married', label: 'נשוי/אה' },
    { val: 'divorced', label: 'גרוש/ה' }, { val: 'widowed', label: 'אלמן/ה' },
  ] },
  { key: 'mortgageType', label: 'מטרת המשכנתא', question: 'לאיזו מטרה דרושה המשכנתא?', type: 'select', options: MORTGAGE_TYPE_OPTIONS },
  { key: 'propertyPrice', label: 'שווי / מחיר הנכס', question: 'מה מחיר או שווי הנכס?', type: 'money' },
  { key: 'loanAmount', label: 'סכום משכנתא מבוקש', question: 'כמה משכנתא אתם צריכים?', type: 'money' },
  { key: 'equity', label: 'הון עצמי', question: 'כמה הון עצמי יש לכם?', type: 'money' },
  { key: 'employmentType', label: 'סוג תעסוקה', question: 'האם אתה שכיר, עצמאי או פנסיונר?', type: 'select', options: [
    { val: 'employee', label: 'שכיר/ה' }, { val: 'self_employed', label: 'עצמאי/ת' }, { val: 'pensioner', label: 'פנסיונר/ית' },
  ] },
  { key: 'netIncome', label: 'הכנסה חודשית נטו', question: 'מה ההכנסה החודשית נטו שלך?', type: 'money' },
  { key: 'spouseIncome', label: 'הכנסת בן/בת זוג נטו', question: 'אם יש בן/בת זוג — מה ההכנסה החודשית נטו שלו/ה?', type: 'money', optional: true },
  { key: 'monthlyDebts', label: 'החזרי הלוואות חודשיים', question: 'כמה אתם מחזירים כל חודש על הלוואות קיימות?', type: 'money', optional: true },
  { key: 'monthlyRent', label: 'שכירות חודשית כיום', question: 'האם אתם משלמים היום שכירות? כמה?', type: 'money', optional: true },
  { key: 'loanDuration', label: 'תקופה רצויה (שנים)', question: 'לכמה שנים תרצו לפרוס את המשכנתא?', type: 'number', optional: true },
];

export const FIELD_KEYS = VOICE_FIELDS.map(f => f.key);
export const REQUIRED_KEYS = VOICE_FIELDS.filter(f => !f.optional).map(f => f.key);

export const SOURCE_LABELS = { typed: 'הוקלד', answer_recording: 'הקלטת תשובה', conversation: 'שיחה חופשית' };

export function displayValue(field, value) {
  if (value === undefined || value === null || value === '') return '';
  if (field.type === 'select') return field.options.find(o => o.val === value)?.label || value;
  if (field.type === 'money') return `₪${new Intl.NumberFormat('he-IL').format(Number(value) || 0)}`;
  return String(value);
}