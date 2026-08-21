// Pricing formula (will be revisited before Phase 4.75 exit).
// Currency: Tunisian dinar (TND). Minor unit: millime (1 TND = 1000 millimes).
//
// Curve: price = ceil(2.25 × days^0.76), floored at 5 TND.
// Anchors: 7d → 10 DT, 30d → 30 DT, 365d → 200 DT.
// Promo:  `discount` in percent, applied last, then re-ceiled to whole DT
//         so the user is never charged a sub-dinar amount.
export interface Price {
  amount_minor: number;
  currency: 'TND';
}

const CURVE_K = 2.25;
const CURVE_EXP = 0.76;
const FLOOR_TND = 5;

export function computePrice(validityUntil: Date, promoDiscount: number | null = null): Price {
  const days = Math.max(1, Math.ceil((validityUntil.getTime() - Date.now()) / 86_400_000));
  const gross = Math.max(FLOOR_TND, Math.ceil(CURVE_K * Math.pow(days, CURVE_EXP)));
  const withPromo = promoDiscount ? Math.ceil(gross * (1 - promoDiscount / 100)) : gross;
  return { amount_minor: withPromo * 1000, currency: 'TND' };
}
