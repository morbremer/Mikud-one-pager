import { supabase } from '@/components/refinance/supabaseClient';

const functionNames = {
  getBankOfIsraelRates: 'get-bank-of-israel-rates',
  getReportPrice: 'get-report-price',
  sendEmailVerification: 'send-email-verification',
  verifyEmailCode: 'verify-email-code',
  createCardComPayment: 'create-cardcom-payment',
  verifyCardComPayment: 'verify-cardcom-payment',
  generatePdfReport: 'generate-pdf-report',
  mortgageAi: 'mortgage-ai',
};

async function invoke(name, body) {
  if (!supabase) throw new Error('Supabase is not configured');
  const { data, error } = await supabase.functions.invoke(functionNames[name] || name, { body });
  if (error) throw error;
  return { data };
}

async function leadRequest(action, body = {}) {
  const { data } = await invoke('mortgage-leads', { action, ...body });
  return data;
}

export const appClient = {
  functions: { invoke },
  entities: {
    Lead: {
      create: (payload) => leadRequest('create', { payload }),
      update: (id, payload) => leadRequest('update', { id, payload }),
      filter: async ({ id }) => {
        const lead = await leadRequest('get', { id });
        return lead ? [lead] : [];
      },
      list: (_sort, limit = 100) => leadRequest('list', { limit }),
    },
  },
  ai: {
    generate: async (prompt) => {
      const { data } = await invoke('mortgageAi', { prompt });
      return data?.output || data?.text || '';
    },
  },
};
