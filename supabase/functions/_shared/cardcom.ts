import { service } from './supabase.ts';

const amount = Number(Deno.env.get('CARDCOM_AMOUNT') || '1');

// המחיר שמוצג בממשק חייב להיות זהה למה שנגבה בפועל. נחשף דרך הפונקציה
// get-report-price כדי שה-UI יקרא את אותו מקור אמת (הסוד CARDCOM_AMOUNT).
export function getReportAmount() {
  return amount;
}
const createUrl = 'https://secure.cardcom.solutions/api/v11/LowProfile/Create';
const resultUrl = 'https://secure.cardcom.solutions/api/v11/LowProfile/GetLpResult';

type LeadType = 'mortgage' | 'refinance';

export function isAllowedOrigin(value: unknown) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    const allowed = (Deno.env.get('ALLOWED_SITE_ORIGINS') || 'https://baduk-ai.co.il,https://www.baduk-ai.co.il').split(',').map((origin) => origin.trim());
    return allowed.includes(url.origin) || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname));
  } catch { return false; }
}

export function parseReturnValue(value: unknown): { leadType: LeadType; leadId: string } | null {
  if (typeof value !== 'string') return null;
  const [leadType, leadId] = value.split(':', 2);
  return (leadType === 'mortgage' || leadType === 'refinance') && leadId ? { leadType, leadId } : null;
}

async function lead(leadType: LeadType, id: string) {
  const table = leadType === 'mortgage' ? 'mortgage_leads' : 'refinance_leads';
  const { data, error } = await service.from(table).select(leadType === 'mortgage' ? 'id,full_name,email' : 'id,full_name,email').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function createCheckout(leadType: LeadType, leadId: string, origin: string) {
  const customer = await lead(leadType, leadId);
  if (!customer) throw new Error('Lead not found');
  const terminalNumber = Number(Deno.env.get('CARDCOM_TERMINAL_NUMBER'));
  const apiName = Deno.env.get('CARDCOM_API_NAME');
  const webHookUrl = Deno.env.get('CARDCOM_WEBHOOK_URL');
  if (!terminalNumber || !apiName || !webHookUrl) throw new Error('CardCom is not configured');
  const response = await fetch(createUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    TerminalNumber: terminalNumber, ApiName: apiName, Operation: 'ChargeOnly', Amount: amount, ISOCoinId: 1, Language: 'he',
    ProductName: 'דוח תמהיל משכנתא — מיקוד משכנתאות', ReturnValue: `${leadType}:${leadId}`,
    SuccessRedirectUrl: `${origin}/PaymentReturn?status=success`, FailedRedirectUrl: `${origin}/PaymentReturn?status=failed`, WebHookUrl: webHookUrl,
    Document: { Name: customer.full_name || 'לקוח', Email: customer.email || undefined, Products: [{ Description: 'דוח תמהיל משכנתא — מיקוד משכנתאות', UnitCost: amount, Quantity: 1 }], IsSendByEmail: Boolean(customer.email) },
  }) });
  const data = await response.json();
  if (!response.ok || data.ResponseCode !== 0 || !data.Url || !data.LowProfileId) throw new Error(data.Description || 'CardCom error');
  const payment = { lead_type: leadType, low_profile_id: data.LowProfileId, amount, status: 'created' } as Record<string, unknown>;
  if (leadType === 'mortgage') payment.mortgage_lead_id = leadId;
  else payment.refinance_lead_id = leadId;
  const { error } = await service.from('payment_transactions').upsert(payment, { onConflict: 'low_profile_id' });
  if (error) throw error;
  return { url: data.Url, lowProfileId: data.LowProfileId };
}

export async function cardComResult(lowProfileId: string) {
  const terminalNumber = Number(Deno.env.get('CARDCOM_TERMINAL_NUMBER'));
  const apiName = Deno.env.get('CARDCOM_API_NAME');
  if (!terminalNumber || !apiName) throw new Error('CardCom is not configured');
  const response = await fetch(resultUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ TerminalNumber: terminalNumber, ApiName: apiName, LowProfileId: lowProfileId }) });
  if (!response.ok) throw new Error(`CardCom verification failed (${response.status})`);
  return response.json();
}

export async function recordPaid(lowProfileId: string, result: any, expected?: { leadType: LeadType; leadId: string }) {
  if (result?.ResponseCode !== 0 || Number(result?.TranzactionInfo?.Amount) !== amount) return false;
  const returned = parseReturnValue(result.ReturnValue);
  if (!returned || (expected && (expected.leadType !== returned.leadType || expected.leadId !== returned.leadId))) return false;
  if (returned.leadType === 'mortgage') {
    const { error } = await service.from('mortgage_leads').update({ is_purchased: true, status: 'contacted' }).eq('id', returned.leadId);
    if (error) throw error;
  } else {
    const { error } = await service.from('refinance_leads').update({ tier: 'paid' }).eq('id', returned.leadId);
    if (error) throw error;
  }
  const { error } = await service.from('payment_transactions').update({ status: 'paid', transaction_id: String(result.TranzactionId || ''), provider_payload: result, paid_at: new Date().toISOString() }).eq('low_profile_id', lowProfileId);
  if (error) throw error;
  return true;
}
