import { useState, useEffect } from 'react';
import { appClient } from '@/api/appClient';

/**
 * מחיר הדוח נקרא תמיד מהשרת (get-report-price), מאותו מקור שממנו נגבה החיוב
 * (הסוד CARDCOM_AMOUNT). אין מחיר קשיח ב-UI — כל עוד המחיר לא נטען מציגים
 * מצב טעינה, כדי שלעולם לא יוצג מספר שאינו המחיר האמיתי.
 *
 * מחזיר { price, status }:
 *   price  — המחיר בשקלים, או null עד שנטען.
 *   status — 'loading' | 'ready' | 'error'.
 */
export function useReportPrice() {
  const [price, setPrice] = useState(null);
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    let active = true;
    let timer;
    let attempts = 0;

    const attempt = async () => {
      try {
        const { data } = await appClient.functions.invoke('getReportPrice');
        const amount = Number(data?.amount);
        if (!Number.isFinite(amount) || amount <= 0) throw new Error('Invalid price payload');
        if (active) { setPrice(amount); setStatus('ready'); }
      } catch (err) {
        console.error('Failed to load report price:', err);
        if (!active) return;
        attempts += 1;
        if (attempts < 4) {
          timer = setTimeout(attempt, 1500 * attempts); // backoff, then keep trying
        } else {
          setStatus('error');
        }
      }
    };

    attempt();
    return () => { active = false; clearTimeout(timer); };
  }, []);

  return { price, status };
}
