import { corsHeaders } from '../_shared/cors.ts';

const fmt = (val) => {
  if (!val || isNaN(val)) return '0';
  return new Intl.NumberFormat('he-IL').format(Math.floor(Number(val)));
};

// formData/results/borrowers all arrive from the client (this function trusts
// whatever calls it) and get interpolated into an HTML document that's later
// written straight into a browser tab — anything that isn't already numeric
// (and therefore self-sanitizing via fmt() above) must be escaped before use.
const esc = (val) => {
  if (val === null || val === undefined) return '';
  return String(val)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

const TRACK_LABELS = {
  prime: 'פריים (Prime)',
  fixed: 'קבועה לא צמודה (קל"צ)',
  variable_5: 'משתנה כל 5 שנים',
  variable_every_5: 'משתנה כל 5 שנים צמודה',
  eligibility: 'זכאות',
  cpi_fixed: 'קבועה צמודה',
  cpi_variable: 'משתנה צמודה',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { formData, results, fullName, borrowers = [] } = await req.json();

    const isRefinance = formData?.mortgageType === 'refinance';
    const today = new Date().toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' });

    // All of these are free text or attacker-influenceable numbers coming
    // straight from the request body — escape once here so every place
    // below that renders them is safe by construction.
    const name = esc(fullName || formData?.fullName || 'לקוח');
    const idNumber = esc(formData?.idNumber);
    const phone = esc(formData?.phone);
    const email = esc(formData?.email);
    const age = esc(formData?.age);
    // תקופת ההלוואה בפועל היא זו שחושבה (ולעיתים נחתכה לפי גיל/תקרת מקסימום),
    // ולא בהכרח מה שהוקלד. מציגים את actualDuration כדי שהמכתב יתאים ללוח שחושב.
    const loanDuration = esc(results?.actualDuration ?? formData?.loanDuration);
    const remainingYears = esc(results?.remainingYears);
    const score = esc(results?.score);
    const statusAction = esc(results?.status?.action);

    // --- helpers ---
    const empLabel = (types = []) => types.map(t => ({
      employee: 'שכיר/ה', self_employed: 'עצמאי/ת',
      controlling_shareholder: 'בעל שליטה', foreign_income: 'הכנסה מחו"ל', pensioner: 'פנסיונר/ית'
    }[t] || esc(t))).join(', ');

    const creditLabel = (c) => c === 'clean' ? 'תקין ✓' : 'דורש בדיקה';

    // --- doc groups by employment ---
    const allEmpTypes = borrowers.flatMap(b => b.employmentTypes || []);
    const hasEmployee = allEmpTypes.includes('employee');
    const hasSelf = allEmpTypes.some(t => ['self_employed','controlling_shareholder'].includes(t));
    const hasPensioner = allEmpTypes.includes('pensioner');
    const hasForeign = allEmpTypes.includes('foreign_income');
    const hasCreditIssues = borrowers.some(b => b.creditHistory === 'issues');

    // --- Mix table HTML ---
    const mixTable = (mix, label, isRec) => {
      const border = isRec ? '#c9a961' : '#d1d5db';
      const headerBg = isRec ? '#1e3a5f' : '#f3f4f6';
      const headerColor = isRec ? '#ffffff' : '#1e3a5f';
      const badge = isRec ? `<span style="background:#c9a961;color:#1e3a5f;font-size:9px;font-weight:900;padding:2px 8px;border-radius:999px;margin-right:8px;">★ מומלץ</span>` : '';
      const tracks = (mix?.tracks || []);
      const total = mix?.total || 0;
      const rows = tracks.map(t => `
        <tr>
          <td style="padding:6px 10px;font-size:11px;color:#374151;border-bottom:1px solid #f3f4f6;">${esc(t.name || '')}</td>
          <td style="padding:6px 10px;font-size:11px;text-align:center;color:#c9a961;font-weight:700;border-bottom:1px solid #f3f4f6;">${t.rate ? (t.rate * 100).toFixed(2) + '%' : '—'}</td>
          <td style="padding:6px 10px;font-size:11px;text-align:center;border-bottom:1px solid #f3f4f6;">${esc(t.years || '—')} שנה</td>
          <td style="padding:6px 10px;font-size:12px;font-weight:700;text-align:left;color:#1e3a5f;border-bottom:1px solid #f3f4f6;">₪${fmt(t.pmt)}</td>
        </tr>
      `).join('');
      return `
        <div style="border:2px solid ${border};border-radius:12px;overflow:hidden;margin-bottom:16px;break-inside:avoid;">
          <div style="background:${headerBg};padding:10px 14px;display:flex;align-items:center;justify-content:space-between;">
            <span style="font-size:13px;font-weight:900;color:${headerColor};">${badge}${esc(label)}</span>
            <span style="font-size:18px;font-weight:900;color:${isRec ? '#c9a961' : '#1e3a5f'};">₪${fmt(total)} / חודש</span>
          </div>
          <table style="width:100%;border-collapse:collapse;background:#fff;">
            <thead>
              <tr style="background:#f9fafb;">
                <th style="padding:6px 10px;font-size:10px;color:#6b7280;text-align:right;">מסלול</th>
                <th style="padding:6px 10px;font-size:10px;color:#6b7280;text-align:center;">ריבית</th>
                <th style="padding:6px 10px;font-size:10px;color:#6b7280;text-align:center;">תקופה</th>
                <th style="padding:6px 10px;font-size:10px;color:#6b7280;text-align:left;">החזר</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
            <tfoot>
              <tr style="background:#1e3a5f;">
                <td colspan="3" style="padding:8px 10px;font-size:12px;font-weight:900;color:#ffffff;">סה"כ החזר חודשי</td>
                <td style="padding:8px 10px;font-size:14px;font-weight:900;color:#c9a961;text-align:left;">₪${fmt(total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      `;
    };

    const html = `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
<meta charset="UTF-8"/>
<title>דוח משכנתא — ${name}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, 'Helvetica Neue', sans-serif; font-size: 13px; color: #1a1a1a; background: #fff; direction: rtl; }
  .page { width: 210mm; min-height: 297mm; padding: 18mm 16mm; page-break-after: always; position: relative; }
  .page:last-child { page-break-after: auto; }
  @media print {
    body { margin: 0; }
    .page { page-break-after: always; padding: 14mm 14mm; }
  }
  h1 { font-size: 26px; font-weight: 900; color: #1e3a5f; }
  h2 { font-size: 18px; font-weight: 900; color: #1e3a5f; margin-bottom: 12px; }
  h3 { font-size: 14px; font-weight: 700; color: #1e3a5f; margin-bottom: 8px; }
  .gold { color: #c9a961; }
  .header-bar { background: linear-gradient(135deg, #1e3a5f, #162e4a); color: #fff; padding: 18px 22px; border-radius: 10px; margin-bottom: 20px; }
  .header-bar .sub { color: #c9a961; font-size: 10px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 4px; }
  .section { margin-bottom: 20px; }
  .label { font-size: 10px; color: #6b7280; font-weight: 600; margin-bottom: 2px; }
  .value { font-size: 13px; font-weight: 700; color: #1e3a5f; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .grid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; }
  .card { background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 14px; }
  .card-blue { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 12px 14px; }
  .card-green { background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; padding: 12px 14px; }
  .card-red { background: #fef2f2; border: 1px solid #fca5a5; border-radius: 8px; padding: 12px 14px; }
  .card-gold { background: #fffbeb; border: 2px solid #c9a961; border-radius: 8px; padding: 12px 14px; }
  .big-num { font-size: 28px; font-weight: 900; color: #1e3a5f; line-height: 1; }
  .badge { display: inline-block; background: #1e3a5f; color: #c9a961; font-size: 10px; font-weight: 900; padding: 3px 10px; border-radius: 999px; margin-bottom: 6px; }
  .divider { border: none; border-top: 2px solid #e5e7eb; margin: 16px 0; }
  .step-box { border-right: 4px solid #1e3a5f; padding: 10px 14px; margin-bottom: 12px; background: #f8fafc; border-radius: 0 8px 8px 0; }
  .step-box.gold-border { border-right-color: #c9a961; }
  .step-box.red-border { border-right-color: #ef4444; }
  .step-box.green-border { border-right-color: #22c55e; }
  .doc-group { margin-bottom: 14px; }
  .doc-group-header { padding: 6px 12px; border-radius: 6px 6px 0 0; font-size: 11px; font-weight: 900; }
  .doc-item { padding: 5px 12px; font-size: 11px; border-right: 3px solid #e5e7eb; margin-bottom: 2px; }
  .footer { position: absolute; bottom: 12mm; left: 16mm; right: 16mm; text-align: center; font-size: 9px; color: #9ca3af; border-top: 1px solid #e5e7eb; padding-top: 6px; }
  .page-num { position: absolute; top: 10mm; left: 16mm; font-size: 9px; color: #9ca3af; }
  ul { padding-right: 18px; }
  li { margin-bottom: 4px; font-size: 12px; line-height: 1.5; }
  .analysis-text { font-size: 12px; line-height: 1.8; color: #374151; white-space: pre-line; }
</style>
</head>
<body>

<!-- ═══════════════════════════════════════════════════
     עמוד 1 — נתוני לקוח + תוצאת כשירות
═══════════════════════════════════════════════════ -->
<div class="page">
  <div class="page-num">1 / 6</div>

  <div class="header-bar">
    <div class="sub">מיקוד משכנתאות — המטרה שלנו, החיסכון שלכם</div>
    <h1 style="color:#fff;margin-bottom:4px;">דוח היתכנות משכנתא</h1>
    <div style="font-size:12px;color:#c9a961;font-weight:700;">${name} &nbsp;|&nbsp; ${today}</div>
  </div>

  <!-- פרטי לקוח -->
  <div class="section">
    <h2>פרטי הלקוח</h2>
    <div class="grid2">
      <div class="card">
        <div class="label">שם מלא</div>
        <div class="value">${name}</div>
      </div>
      <div class="card">
        <div class="label">ת.ז.</div>
        <div class="value">${idNumber || '—'}</div>
      </div>
      <div class="card">
        <div class="label">טלפון</div>
        <div class="value" dir="ltr">${phone || '—'}</div>
      </div>
      <div class="card">
        <div class="label">דוא"ל</div>
        <div class="value">${email || '—'}</div>
      </div>
      <div class="card">
        <div class="label">גיל</div>
        <div class="value">${age || '—'}</div>
      </div>
      <div class="card">
        <div class="label">מצב משפחתי</div>
        <div class="value">${{single:'רווק/ה',married:'נשוי/אה',divorced:'גרוש/ה',widowed:'אלמן/ה'}[borrowers[0]?.maritalStatus] || '—'}</div>
      </div>
    </div>
  </div>

  <!-- לווים -->
  ${borrowers.length > 0 ? `
  <div class="section">
    <h2>פרופיל לווים</h2>
    ${borrowers.map((b, i) => {
      const sources = b.incomeSources || {};
      const total = Object.values(sources).reduce((acc, s) => acc + Number(String(s?.amount || '0').replace(/,/g,'')), 0);
      const factor = i > 0 && b.borrowerType === 'additional' ? 0.5 : 1;
      return `<div class="card" style="margin-bottom:8px;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:12px;font-weight:900;color:#1e3a5f;">לווה ${['א','ב','ג','ד','ה'][i] || i+1} ${b.isSpouse ? '(בן/בת זוג)' : i > 0 && b.borrowerType === 'additional' ? '(לווה נוסף — 50%)' : ''}</span>
          <span style="font-size:12px;font-weight:700;color:#c9a961;">₪${fmt(total * factor)} / חודש מוכר</span>
        </div>
        <div style="font-size:11px;color:#6b7280;margin-top:4px;">
          סוג תעסוקה: ${empLabel(b.employmentTypes)} &nbsp;|&nbsp; היסטוריית אשראי: ${creditLabel(b.creditHistory)}
        </div>
      </div>`;
    }).join('')}
  </div>
  ` : ''}

  <!-- תוצאת כשירות -->
  <div class="section">
    <h2>${isRefinance ? 'תוצאת ניתוח מחזור' : 'תוצאת בדיקת כשירות'}</h2>
    <div class="grid3">
      ${!isRefinance ? `
      <div class="card" style="text-align:center;">
        <div class="label">יחס החזר (DTI)</div>
        <div class="big-num" style="color:${(results?.dti||0) > 40 ? '#ef4444' : (results?.dti||0) > 35 ? '#f59e0b' : '#22c55e'};">${(results?.dti||0).toFixed(1)}%</div>
        <div style="font-size:10px;color:#6b7280;margin-top:4px;">תקן: עד 40%</div>
      </div>
      <div class="card" style="text-align:center;">
        <div class="label">אחוז מימון (LTV)</div>
        <div class="big-num" style="color:${(results?.ltv||0) > 75 ? '#ef4444' : '#22c55e'};">${(results?.ltv||0).toFixed(1)}%</div>
        <div style="font-size:10px;color:#6b7280;margin-top:4px;">מקסימום לפי סוג עסקה</div>
      </div>
      ` : `
      <div class="card" style="text-align:center;">
        <div class="label">חיסכון חודשי</div>
        <div class="big-num" style="color:#22c55e;">₪${fmt(results?.monthlySaving)}</div>
      </div>
      <div class="card" style="text-align:center;">
        <div class="label">חיסכון כולל</div>
        <div class="big-num" style="color:#22c55e;">₪${fmt(results?.totalSaving)}</div>
      </div>
      `}
      <div class="card" style="text-align:center;">
        <div class="label">ציון כשירות</div>
        <div class="big-num" style="color:${(results?.score||0) >= 80 ? '#22c55e' : (results?.score||0) >= 60 ? '#f59e0b' : '#ef4444'};">${score || 0}</div>
        <div style="font-size:10px;color:#6b7280;margin-top:4px;">/100</div>
      </div>
    </div>

    ${results?.status?.action ? `
    <div class="card-gold" style="margin-top:12px;">
      <div style="font-size:11px;font-weight:900;color:#92400e;margin-bottom:4px;">המלצת מיקוד:</div>
      <div style="font-size:12px;color:#92400e;">${statusAction}</div>
    </div>
    ` : ''}
  </div>

  <!-- פרטי עסקה -->
  <div class="section">
    <h2>${isRefinance ? 'פרטי המשכנתא הקיימת' : 'פרטי הנכס והמשכנתא'}</h2>
    <div class="grid2">
      ${isRefinance ? `
      <div class="card"><div class="label">יתרת משכנתא</div><div class="value">₪${fmt(results?.balance)}</div></div>
      <div class="card"><div class="label">החזר חודשי נוכחי</div><div class="value">₪${fmt(results?.currentMonthly)}</div></div>
      <div class="card"><div class="label">ריבית קיימת משוערת</div><div class="value">${results?.impliedRate?.toFixed(2) || '—'}%</div></div>
      <div class="card"><div class="label">שנים שנותרו</div><div class="value">${remainingYears || '—'} שנים</div></div>
      ` : `
      <div class="card"><div class="label">שווי הנכס</div><div class="value">₪${fmt(Number(String(formData?.propertyPrice||0).replace(/,/g,'')))}</div></div>
      <div class="card"><div class="label">סכום משכנתא מבוקש</div><div class="value">₪${fmt(results?.loanAmount)}</div></div>
      <div class="card"><div class="label">הון עצמי</div><div class="value">₪${fmt(Number(String(formData?.equity||0).replace(/,/g,'')))}</div></div>
      <div class="card"><div class="label">תקופת הלוואה</div><div class="value">${loanDuration || '—'} שנים</div></div>
      <div class="card"><div class="label">הכנסה מוכרת לבנק</div><div class="value">₪${fmt(results?.totalIncome)}</div></div>
      <div class="card"><div class="label">חובות חודשיים</div><div class="value">₪${fmt(Number(String(formData?.monthlyDebts||0).replace(/,/g,'')))}</div></div>
      `}
    </div>
  </div>

  <div class="footer">מיקוד משכנתאות | *2324 | mikud4me.co.il | הדוח הופק בתאריך ${today} | מזהה תיק: MC-${Date.now().toString(36).toUpperCase()}</div>
</div>


<!-- ═══════════════════════════════════════════════════
     עמוד 2 — שלושת התמהילים
═══════════════════════════════════════════════════ -->
<div class="page">
  <div class="page-num">2 / 6</div>
  <div class="header-bar">
    <div class="sub">מיקוד משכנתאות — ${name}</div>
    <h1 style="color:#fff;">תמהילי משכנתא מומלצים</h1>
  </div>

  <div style="background:#fffbeb;border:2px solid #c9a961;border-radius:8px;padding:10px 14px;margin-bottom:16px;font-size:11px;color:#92400e;">
    <strong>הנחיה חשובה לגבי ריביות:</strong> הריביות המוצגות הן הערכות שוק לצורך השוואה בלבד.
    <strong>אל תציין ריביות ספציפיות מול הבנק</strong> — תן לבנקאי להציע את הצעתו ותקבל את הטובה ביותר.
    אם תקבע תקרה עליונה מראש, תגביל את עצמך.
  </div>

  <div class="section">
    <h2>תמהיל א׳ — מומלץ (מותאם אישית לפרופילך)</h2>
    ${mixTable(results?.mixB, isRefinance ? (results?.mixB?.label || 'תמהיל מאוזן') : 'תמהיל אסטרטגי — מותאם אישית', true)}
  </div>

  <div class="section">
    <h2>תמהיל ב׳ — שמרני</h2>
    ${mixTable(results?.mixA, isRefinance ? (results?.mixA?.label || 'תמהיל שמרני') : 'קבועה לא צמודה — יציבות מקסימלית', false)}
  </div>

  <div class="section">
    <h2>תמהיל ג׳ — ממונף</h2>
    ${mixTable(results?.mixC, isRefinance ? (results?.mixC?.label || 'תמהיל ממונף') : 'פריים + קבועה — מיקסום חיסכון', false)}
  </div>

  <div class="card-gold" style="margin-top:12px;">
    <strong>סיכום השוואתי:</strong><br/>
    <span style="font-size:11px;">תמהיל א׳ (מומלץ): ₪${fmt(results?.mixB?.total)} / חודש &nbsp;|&nbsp;
    תמהיל ב׳ (שמרני): ₪${fmt(results?.mixA?.total)} / חודש &nbsp;|&nbsp;
    תמהיל ג׳ (ממונף): ₪${fmt(results?.mixC?.total)} / חודש</span>
  </div>

  <div class="footer">מיקוד משכנתאות | *2324 | mikud4me.co.il</div>
</div>


<!-- ═══════════════════════════════════════════════════
     עמוד 3 — ניתוח מקצועי מלא
═══════════════════════════════════════════════════ -->
<div class="page">
  <div class="page-num">3 / 6</div>
  <div class="header-bar">
    <div class="sub">מיקוד משכנתאות — ${name}</div>
    <h1 style="color:#fff;">ניתוח מקצועי מלא</h1>
  </div>

  <div class="section">
    <div class="analysis-text">${esc(results?.aiAnalysis || 'הניתוח יופיע כאן לאחר עיבוד הנתונים.')}</div>
  </div>

  <!-- נקודות חוזק -->
  <div class="section">
    <h2>נקודות חוזק מרכזיות</h2>
    <div class="card-green" style="margin-bottom:8px;">
      <ul>
        ${(results?.dti||0) < 35 ? '<li>✓ יחס החזר נמוך (' + (results?.dti||0).toFixed(1) + '%) — מתחת לממוצע בשוק, יתרון משמעותי מול הבנק</li>' : ''}
        ${(results?.ltv||0) < 70 ? '<li>✓ אחוז מימון נמוך (' + (results?.ltv||0).toFixed(1) + '%) — הון עצמי גבוה מחזק את התיק</li>' : ''}
        ${borrowers.length > 1 ? '<li>✓ מספר לווים — מחזק את כושר ההחזר המוצג לבנק</li>' : ''}
        ${!hasCreditIssues ? '<li>✓ היסטוריית אשראי תקינה — ציון חיובי בעיני הבנק</li>' : ''}
        ${hasEmployee ? '<li>✓ הכנסת שכיר יציבה — בנקים מעדיפים שכירים עם ותק</li>' : ''}
        <li>✓ תיק מסודר ומוכן — מקצר זמן עיבוד ומשדר אמינות</li>
      </ul>
    </div>
  </div>

  ${hasCreditIssues ? `
  <div class="section">
    <h2>נקודות לשיפור</h2>
    <div class="card-red">
      <ul>
        <li>⚠ היסטוריית אשראי לא תקינה — הכן הסבר בכתב + אסמכתאות סגירת חובות</li>
      </ul>
    </div>
  </div>
  ` : ''}

  <div class="footer">מיקוד משכנתאות | *2324 | mikud4me.co.il</div>
</div>


<!-- ═══════════════════════════════════════════════════
     עמוד 4 — מכתב פנייה לבנק
═══════════════════════════════════════════════════ -->
<div class="page">
  <div class="page-num">4 / 6</div>
  <div class="header-bar">
    <div class="sub">מיקוד משכנתאות — ${name}</div>
    <h1 style="color:#fff;">מכתב פנייה לבנק</h1>
  </div>

  <div style="border:1px solid #e5e7eb;border-radius:8px;padding:24px 28px;background:#fff;font-size:13px;line-height:2;">
    <div style="color:#6b7280;font-size:11px;margin-bottom:16px;">${today}</div>

    <div style="margin-bottom:16px;">
      <strong>לכבוד,</strong><br/>
      מנהל/ת תחום משכנתאות<br/>
      <span style="color:#1e3a5f;font-weight:700;">[שם הבנק]</span>
    </div>

    <div style="border-right:4px solid #c9a961;padding-right:12px;margin-bottom:16px;">
      <strong>הנדון: ${isRefinance ? `בקשה למחזור משכנתא — ${name}` : `בקשה לאישור עקרוני למשכנתא — ${name}`}</strong>
    </div>

    <p>שלום רב,</p>
    <p style="margin-top:8px;">
      ${isRefinance
        ? `הריני לפנות אליכם בבקשה לקבל הצעה למחזור משכנתא עבור <strong>${name}</strong>,
           ביתרה של ₪${fmt(results?.balance)} ועם ${remainingYears || '—'} שנים שנותרו לפירעון.`
        : `הריני לפנות אליכם בבקשה לקבל אישור עקרוני למשכנתא עבור <strong>${name}</strong>.`
      }
    </p>

    <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:12px;">
      <tr style="background:#f3f4f6;">
        <td style="padding:7px 10px;font-weight:700;color:#1e3a5f;width:45%;">שם לווה</td>
        <td style="padding:7px 10px;">${name}</td>
      </tr>
      ${isRefinance ? `
      <tr><td style="padding:7px 10px;font-weight:700;color:#1e3a5f;background:#f9fafb;">יתרת משכנתא קיימת</td><td style="padding:7px 10px;">₪${fmt(results?.balance)}</td></tr>
      <tr style="background:#f3f4f6;"><td style="padding:7px 10px;font-weight:700;color:#1e3a5f;">החזר חודשי נוכחי</td><td style="padding:7px 10px;">₪${fmt(results?.currentMonthly)}</td></tr>
      <tr><td style="padding:7px 10px;font-weight:700;color:#1e3a5f;background:#f9fafb;">שנים שנותרו</td><td style="padding:7px 10px;">${remainingYears || '—'} שנים</td></tr>
      ` : `
      <tr><td style="padding:7px 10px;font-weight:700;color:#1e3a5f;background:#f9fafb;">סכום מבוקש</td><td style="padding:7px 10px;">₪${fmt(results?.loanAmount)}</td></tr>
      <tr style="background:#f3f4f6;"><td style="padding:7px 10px;font-weight:700;color:#1e3a5f;">שווי הנכס</td><td style="padding:7px 10px;">₪${fmt(Number(String(formData?.propertyPrice||0).replace(/,/g,'')))}</td></tr>
      <tr><td style="padding:7px 10px;font-weight:700;color:#1e3a5f;background:#f9fafb;">אחוז מימון (LTV)</td><td style="padding:7px 10px;">${(results?.ltv||0).toFixed(1)}%</td></tr>
      <tr style="background:#f3f4f6;"><td style="padding:7px 10px;font-weight:700;color:#1e3a5f;">יחס החזר (DTI)</td><td style="padding:7px 10px;">${(results?.dti||0).toFixed(1)}% (תקרה: 40%)</td></tr>
      <tr><td style="padding:7px 10px;font-weight:700;color:#1e3a5f;background:#f9fafb;">תקופת הלוואה</td><td style="padding:7px 10px;">${loanDuration || '—'} שנים</td></tr>
      <tr style="background:#f3f4f6;"><td style="padding:7px 10px;font-weight:700;color:#1e3a5f;">מטרת ההלוואה</td><td style="padding:7px 10px;">${{purchase_first:'רכישת דירה ראשונה',purchase_improve:'משפרי דיור',purchase_additional:'נכס להשקעה',any_purpose:'כל מטרה',refinance:'מחזור'}[formData?.mortgageType] || esc(formData?.mortgageType)}</td></tr>
      `}
    </table>

    <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:12px 14px;margin-bottom:16px;">
      <strong style="color:#1e3a5f;">בקשת הצעת ריבית תחרותית:</strong><br/>
      <span style="font-size:12px;color:#374151;">אבקש לקבל את הצעת הריבית הטובה ביותר שהבנק יכול להציע, בהתאם לנתוני התיק ולשוק הנוכחי. 
      הנני פונה למספר בנקים בו-זמנית ואבחר את ההצעה המשתלמת ביותר.</span>
    </div>

    <p style="margin-bottom:8px;">אבקש לקבל הצעת ריבית עקרונית בכתב תוך <strong>5 ימי עסקים</strong>. אשמח לשלוח את מלוא מסמכי ההגשה בעקבות הצעתכם.</p>

    <div style="margin-top:24px;border-top:1px solid #e5e7eb;padding-top:16px;">
      <p><strong>בכבוד רב,</strong></p>
      <p style="margin-top:6px;">${name}</p>
      ${phone ? `<p dir="ltr">טל׳: ${phone}</p>` : ''}
      ${email ? `<p>דוא"ל: ${email}</p>` : ''}
    </div>
  </div>

  <p style="font-size:10px;color:#9ca3af;margin-top:8px;">* מלאו את שם הבנק לפני השליחה. ניתן לשלוח לכמה בנקים במקביל.</p>

  <div class="footer">מיקוד משכנתאות | *2324 | mikud4me.co.il</div>
</div>


<!-- ═══════════════════════════════════════════════════
     עמוד 5 — תסריט השיחה מול הבנקאי
═══════════════════════════════════════════════════ -->
<div class="page">
  <div class="page-num">5 / 6</div>
  <div class="header-bar">
    <div class="sub">מיקוד משכנתאות — ${name}</div>
    <h1 style="color:#fff;">תסריט השיחה מול הבנקאי</h1>
  </div>

  <div style="background:#fffbeb;border:2px solid #c9a961;border-radius:8px;padding:10px 14px;margin-bottom:16px;font-size:11px;color:#92400e;">
    <strong>טיפ זהב:</strong> לעולם אל תציין ריביות ספציפיות שאתה "מחפש" — תן לבנק להציע ותהנה מהצעות טובות יותר.
    ציון מספר מראש רק מגביל אותך.
  </div>

  <div class="step-box">
    <h3>שלב 1 — פתיחה</h3>
    <p style="font-size:12px;font-style:italic;color:#374151;">
      "${isRefinance
        ? `שלום, קוראים לי ${name}. יש לי משכנתא קיימת ביתרה של ₪${fmt(results?.balance)} עם ${remainingYears || '—'} שנים שנותרו. אני בוחן אפשרות למחזור לתנאים טובים יותר ואשמח לשמוע מה הבנק שלכם יכול להציע.`
        : `שלום, קוראים לי ${name}. אני מחפש משכנתא בסך ₪${fmt(results?.loanAmount)} על נכס בשווי ₪${fmt(Number(String(formData?.propertyPrice||0).replace(/,/g,'')))}. יחס ההחזר שלי עומד על ${(results?.dti||0).toFixed(1)}% ופניתי למספר בנקים — אשמח לשמוע את הצעתכם.`
      }"
    </p>
  </div>

  <div class="step-box">
    <h3>שלב 2 — בניית אמינות</h3>
    <p style="font-size:12px;font-style:italic;color:#374151;">
      "אני פועל בליווי יועץ משכנתאות מקצועי ויש לי את כל המסמכים מוכנים להגשה מיידית.
      התיק שלי מסודר ומלא — מה שמקצר משמעותית את זמן האישור."
    </p>
  </div>

  <div class="step-box gold-border">
    <h3>שלב 3 — בקשת הצעה (חשוב!)</h3>
    <p style="font-size:12px;font-style:italic;color:#374151;">
      "על בסיס נתוני התיק שלי ונתוני השוק העדכניים, אבקש לקבל את הצעת הריבית הטובה ביותר שאתם יכולים להציע.
      <strong>אני לא נועל עצמי לריביות ספציפיות</strong> — אני מחפש את ההצעה המשתלמת ביותר."
    </p>
  </div>

  <div class="step-box red-border">
    <h3>שלב 4 — טיפול בהתנגדות</h3>
    <p style="font-size:11px;color:#6b7280;margin-bottom:6px;">אם הבנקאי אומר "הריבית שלנו גבוהה":</p>
    <p style="font-size:12px;font-style:italic;color:#374151;">
      "אני מעריך את הכנות. קיבלתי הצעות מספר בנקים — אם תוכלו לשפר את ההצעה, אשמח להישאר אצלכם.
      אבקש שתבדקו שנית עם הדרג הבכיר."
    </p>
  </div>

  <div class="step-box green-border">
    <h3>שלב 5 — סגירה</h3>
    <p style="font-size:12px;font-style:italic;color:#374151;">
      "אשמח לקבל את הצעתכם בכתב תוך יומיים. אני נמצא בתהליך עם מספר בנקים ואקבל החלטה עד סוף השבוע."
    </p>
  </div>

  <div class="card-gold" style="margin-top:16px;">
    <h3>3 שאלות שחובה לשאול את הבנקאי</h3>
    <ul style="margin-top:8px;">
      <li>1. "מה ריבית הפריים הטובה ביותר שאתם יכולים להציע לתיק כמו שלי?"</li>
      <li>2. "האם יש עמלות פירעון מוקדם? ומה התנאים להקטנת הריבית בעתיד?"</li>
      <li>3. "כמה זמן לוקח לקבל אישור עקרוני אם אגיש את כל המסמכים היום?"</li>
    </ul>
  </div>

  <div class="footer">מיקוד משכנתאות | *2324 | mikud4me.co.il</div>
</div>


<!-- ═══════════════════════════════════════════════════
     עמוד 6 — רשימת מסמכים להגשה
═══════════════════════════════════════════════════ -->
<div class="page">
  <div class="page-num">6 / 6</div>
  <div class="header-bar">
    <div class="sub">מיקוד משכנתאות — ${name}</div>
    <h1 style="color:#fff;">רשימת מסמכים להגשה</h1>
  </div>

  <div style="background:#f0fdf4;border:2px solid #86efac;border-radius:8px;padding:10px 14px;margin-bottom:16px;font-size:11px;color:#166534;">
    <strong>טיפ מקצועי:</strong> הכן תיק PDF מסודר עם שם קובץ ברור לכל מסמך (למשל: "תלושים_ינואר2026.pdf").
    תיק מסודר מקצר את זמן האישור ומשדר אמינות.
  </div>

  <!-- מסמכי בסיס -->
  <div class="doc-group">
    <div class="doc-group-header" style="background:#1e3a5f;color:#c9a961;">📋 מסמכי בסיס — חובה לכולם</div>
    ${['תעודת זהות + ספח מעודכן (לכל לווה)',
       'דפי עו"ש 3 חודשים אחרונים',
       'דוח נתוני אשראי BDI',
       isRefinance ? 'יתרת סילוק משכנתא מהבנק (מסמך רשמי)' : 'חוזה רכישה / הסכם מכר',
       'נסח טאבו מעודכן',
       'שמאות נכס (תואם מוסד פיננסי)',
       ...(hasCreditIssues ? ['הסבר בכתב על עיכובי תשלום עבר + אסמכתאות סגירה'] : [])
    ].map((d,i) => `<div class="doc-item">☐ ${i+1}. ${d}</div>`).join('')}
  </div>

  ${hasEmployee ? `
  <div class="doc-group">
    <div class="doc-group-header" style="background:#1d4ed8;color:#fff;">👔 שכיר/ה</div>
    ${['3 תלושי שכר אחרונים',
       'אישור מעסיק על המשך העסקה'
    ].map((d,i) => `<div class="doc-item" style="border-right-color:#1d4ed8;">☐ ${i+1}. ${d}</div>`).join('')}
  </div>
  ` : ''}

  ${hasSelf ? `
  <div class="doc-group">
    <div class="doc-group-header" style="background:#7c3aed;color:#fff;">💼 עצמאי/ת / בעל שליטה</div>
    ${['שומות מס הכנסה 2 שנים אחרונות + אישור רו"ח',
       'דפי עו"ש עסקי 3 חודשים אחרונים',
       'אישור ניהול ספרים מרשות המסים'
    ].map((d,i) => `<div class="doc-item" style="border-right-color:#7c3aed;">☐ ${i+1}. ${d}</div>`).join('')}
  </div>
  ` : ''}

  ${hasPensioner ? `
  <div class="doc-group">
    <div class="doc-group-header" style="background:#059669;color:#fff;">🏦 פנסיונר/ית</div>
    ${['אישור קצבה/גמלה חודשית מקרן פנסיה / ביטוח לאומי',
       'אישור יתרת זכויות קרן פנסיה'
    ].map((d,i) => `<div class="doc-item" style="border-right-color:#059669;">☐ ${i+1}. ${d}</div>`).join('')}
  </div>
  ` : ''}

  ${hasForeign ? `
  <div class="doc-group">
    <div class="doc-group-header" style="background:#d97706;color:#fff;">🌍 הכנסה מחו"ל</div>
    ${['Pay Stubs / תלושי שכר + תרגום נוטריוני',
       'אישור ניכוי מס במקור (אם רלוונטי)'
    ].map((d,i) => `<div class="doc-item" style="border-right-color:#d97706;">☐ ${i+1}. ${d}</div>`).join('')}
  </div>
  ` : ''}

  <div style="margin-top:20px;border:2px solid #1e3a5f;border-radius:8px;padding:14px 18px;background:#1e3a5f;color:#fff;text-align:center;">
    <div style="font-size:22px;font-weight:900;color:#c9a961;margin-bottom:4px;">מיקוד משכנתאות</div>
    <div style="font-size:13px;font-weight:700;">המטרה שלנו — החיסכון שלכם</div>
    <div style="font-size:18px;font-weight:900;color:#c9a961;margin-top:8px;">2324*</div>
    <div style="font-size:11px;color:#cbd5e1;margin-top:4px;">פגישת ייעוץ אישית ללא התחייבות</div>
  </div>

  <div class="footer">מיקוד משכנתאות | *2324 | mikud4me.co.il | ${today}</div>
</div>

</body>
</html>`;

    return new Response(html, {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' }
    });

  } catch (error) {
    console.error('generatePdfReport error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
