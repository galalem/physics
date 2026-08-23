// Newton's law of universal gravitation — scaled-slider units.
//
// F = G · m1 · m2 / r²
//
// Slider units:
//   m1 → coefficient of 10²⁴ kg (Earth mass ≈ 6.0)
//   m2 → coefficient of 10²² kg (Moon mass ≈ 7.35)
//   r  → megameters (10⁶ m). Distance in Mm.
//
// Prefactor: G · M1_SCALE · M2_SCALE / R_SCALE²
//          = 6.67e-11 · 10²⁴ · 10²² / 10¹²
//          = 6.67e²³ N per (m1_coef · m2_coef / r_Mm²)

export const G_CONST = 6.67e-11 // N·m²/kg²

export const M1_SCALE = 1e24 // kg per slider unit
export const M2_SCALE = 1e22 // kg per slider unit
export const R_SCALE = 1e6 // m per slider unit (Mm)

export const F_PREFACTOR = G_CONST * M1_SCALE * M2_SCALE / (R_SCALE * R_SCALE)
// = 6.67e23

// Slider ranges — matched so every SETUP target has multiple achievable triples.
export const M1_MIN = 0.5
export const M1_MAX = 20
export const M1_DEFAULT = 6.0
export const M1_STEP = 0.1

export const M2_MIN = 0.5
export const M2_MAX = 50
export const M2_DEFAULT = 7.4
export const M2_STEP = 0.1

export const R_MIN = 20
export const R_MAX = 500
export const R_DEFAULT = 100
export const R_STEP = 1

export const COVERAGE_MIN_FRAC = 0.5

/** Force magnitude in Newtons given slider coefficients. */
export function computeForce(m1: number, m2: number, r: number): number {
  return (F_PREFACTOR * m1 * m2) / (r * r)
}

/** Relative tolerance (±5%) on force magnitude — see brief §9.2. */
export const TOLERANCE = 0.05

export function forceMatchesTolerance(actual: number, target: number): boolean {
  return Math.abs(actual - target) / Math.abs(target) < TOLERANCE
}

// ─── Hand-authored setups (never RNG-generated) ────────────────────────
// Each entry probes a different physical regime. Multiple parameter triples
// hit each target — students discover many valid combos on stage 2, then
// commit to one specific triple (via algebra on paper) on stage 3.
export type Setup = {
  /** Target force magnitude, in Newtons. */
  targetForce: number
}

export const SETUPS: Setup[] = [
  { targetForce: 1.0e21 }, // planet ↔ small satellite class
  { targetForce: 5.0e20 }, // moon-orbit class
  { targetForce: 2.0e22 }, // heavy binary
  { targetForce: 8.0e19 }, // small moon, far orbit
  { targetForce: 3.0e21 }, // planet ↔ planet close pass
]

// ─── Force-arrow visual scaling ────────────────────────────────────────
// F ranges over ~6 orders of magnitude → arrow length is a clamped log map.
export function arrowLengthPx(F: number): number {
  const logF = Math.log10(Math.max(F, 1e10))
  return Math.max(15, Math.min(140, 40 + 20 * (logF - 20)))
}

// ─── Formatters ────────────────────────────────────────────────────────
const SUPERS: Record<string, string> = {
  '0': '⁰',
  '1': '¹',
  '2': '²',
  '3': '³',
  '4': '⁴',
  '5': '⁵',
  '6': '⁶',
  '7': '⁷',
  '8': '⁸',
  '9': '⁹',
  '-': '⁻',
  '+': '⁺',
}

function superscript(n: number): string {
  return String(n)
    .split('')
    .map((c) => SUPERS[c] ?? c)
    .join('')
}

/** Format a Newton value like "5.00×10²⁰ N" (physics-textbook style). */
export function formatForce(F: number): string {
  if (!Number.isFinite(F) || F === 0) return '0 N'
  const exp = Math.floor(Math.log10(Math.abs(F)))
  const coef = F / Math.pow(10, exp)
  return `${coef.toFixed(2)}×10${superscript(exp)} N`
}

/** Compact scientific form without units, for tighter HUD lines. */
export function formatSci(x: number, unit = ''): string {
  if (!Number.isFinite(x) || x === 0) return unit ? `0 ${unit}` : '0'
  const exp = Math.floor(Math.log10(Math.abs(x)))
  const coef = x / Math.pow(10, exp)
  const s = `${coef.toFixed(2)}×10${superscript(exp)}`
  return unit ? `${s} ${unit}` : s
}
