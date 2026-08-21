// Must stay in sync with backend/src/routes/v1/checkout/pricing.helper.ts.
// Curve: price = ceil(2.25 × days^0.76), floored at 5 TND.
// Anchors: 7d → 10 DT, 30d → 30 DT, 365d → 200 DT.
const CURVE_K = 2.25
const CURVE_EXP = 0.76
const FLOOR_TND = 5

export function computePriceTND(days: number): number {
  return Math.max(FLOOR_TND, Math.ceil(CURVE_K * Math.pow(Math.max(1, days), CURVE_EXP)))
}

export function formatTND(amount: number): string {
  return `${amount} DT`
}

export function daysFromNowToISO(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString()
}

export interface PresetTier {
  key: 'week' | 'month' | 'year'
  days: number
  labelKey: string
  taglineKey: string
  bulletKeys: string[]
  popular?: boolean
}

export const PRESETS: PresetTier[] = [
  {
    key: 'week',
    days: 7,
    labelKey: 'pages.pricing.tier_week_label',
    taglineKey: 'pages.pricing.tier_week_tagline',
    bulletKeys: [
      'pages.pricing.bullet_full_catalog',
      'pages.pricing.bullet_all_125',
      'pages.pricing.bullet_no_renew',
    ],
  },
  {
    key: 'month',
    days: 30,
    labelKey: 'pages.pricing.tier_month_label',
    taglineKey: 'pages.pricing.tier_month_tagline',
    bulletKeys: [
      'pages.pricing.bullet_full_catalog',
      'pages.pricing.bullet_all_125',
      'pages.pricing.bullet_exam_prep',
    ],
  },
  {
    key: 'year',
    days: 365,
    labelKey: 'pages.pricing.tier_year_label',
    taglineKey: 'pages.pricing.tier_year_tagline',
    bulletKeys: [
      'pages.pricing.bullet_full_catalog',
      'pages.pricing.bullet_all_125',
      'pages.pricing.bullet_best_value',
    ],
    popular: true,
  },
]
