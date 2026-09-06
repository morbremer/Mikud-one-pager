import { useState, useEffect } from 'react';
import { appClient } from '@/api/appClient';

// מחיר ברירת מחדל לתצוגה עד שהבקשה לשרת חוזרת (ואם היא נכשלת), כדי שהמחיר
// לא יופיע ריק. מקור האמת בפועל הוא הסוד CARDCOM_AMOUNT שנקרא דרך get-report-price.
const FALLBACK_PRICE = 499;

/**
 * קורא את מחיר הדוח מהשרת (מאותו מקור שממנו נגבה החיוב), כך שכל מקום שמציג
 * את המחיר יישאר מסונכרן עם הסכום שייגבה בפועל. מחזיר מספר בשקלים.
 */
export function useReportPrice() {
  const [price, setPrice] = useState(FALLBACK_PRICE);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data } = await appClient.functions.invoke('getReportPrice');
        const amount = Number(data?.amount);
        if (active && Number.isFinite(amount) && amount > 0) setPrice(amount);
      } catch (err) {
        console.error('Failed to load report price:', err);
      }
    })();
    return () => { active = false; };
  }, []);

  return price;
}
