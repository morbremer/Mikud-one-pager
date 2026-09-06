import { json, options } from '../_shared/cors.ts';
import { getReportAmount } from '../_shared/cardcom.ts';

// מחזיר את מחיר הדוח (₪) מתוך אותו מקור שממנו נגבה החיוב בפועל, כדי שה-UI
// יציג בדיוק את הסכום שייגבה. משתנה רק דרך הסוד CARDCOM_AMOUNT.
Deno.serve((req) => {
  if (req.method === 'OPTIONS') return options();
  try {
    return json({ amount: getReportAmount(), currency: 'ILS' });
  } catch (error) {
    console.error('get-report-price failed:', error);
    return json({ error: 'Failed to read report price' }, { status: 500 });
  }
});
