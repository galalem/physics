// ─── Setup type ───────────────────────────────────────────────
// One setup per seed slot. Each specifies a target wavelength in
// meters. The two in-phase markers on stage 3 are placed exactly
// one wavelength apart on the rope (Δx = λ*), so a valid answer
// is any (c, T) pair with c · T = λ*.
export type Setup = {
  targetLambda: number // meters
}

// Hand-authored setups — NOT RNG-generated.
// Each covers a different regime of the (c, T) space:
//   1.20 m  ← easy: c = 2 · T = 0.6 → 1.2  (many neat factorings)
//   0.75 m  ← short: forces smaller T at moderate c
//   2.00 m  ← long : forces larger T or higher c
//   1.50 m  ← intuitive round product (e.g. c=3, T=0.5)
//   0.90 m  ← awkward: forces non-round T at typical c
export const SETUPS: Setup[] = [
  { targetLambda: 1.20 },
  { targetLambda: 0.75 },
  { targetLambda: 2.00 },
  { targetLambda: 1.50 },
  { targetLambda: 0.90 },
]

// ─── Closed-form formula ──────────────────────────────────────
/** Spatial wavelength from wave speed and period: λ = c · T. */
export function wavelength(c: number, T: number): number {
  return c * T
}

/** Instantaneous displacement snapshot at t=0: y(x, 0) = A · sin(2π x / λ). */
export function waveSnapshot(A: number, c: number, T: number, x: number): number {
  const lambda = wavelength(c, T)
  if (lambda <= 0) return 0
  return A * Math.sin((2 * Math.PI * x) / lambda)
}

// ─── Tolerance check ──────────────────────────────────────────
// Relative tolerance on the wavelength feature.
const TOLERANCE = 0.05 // ±5%
export function wavelengthMatchesTolerance(actualLambda: number, targetLambda: number): boolean {
  if (targetLambda <= 0) return false
  return Math.abs(actualLambda - targetLambda) / targetLambda < TOLERANCE
}
