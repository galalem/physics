// ─── Physics module — universal gravitation ────────────────────────────
//
// Newton's law of universal gravitation:
//   F = G · m1 · m2 / r²
//
// Slider scaling (natural units for a 2eme-sciences intro):
//   m1, m2 in ×10²³ kg    (Moon = 0.735, Earth = 59.7)
//   r      in ×10⁷ m      (Earth radius ≈ 0.64, Earth-Moon ≈ 38)
//
// Substituting units into Newton's law:
//   F [N] = G · (m1·10²³) · (m2·10²³) / (r·10⁷)²
//         = G · m1·m2 / r² · 10^(46-14)
//         = 6.674e-11 · m1·m2/r² · 10³²
//         = 6.674 · m1·m2/r² · 10²¹  N
//
// So we display F in units of 10²¹ N:
//   F_display [×10²¹ N] = 6.674 · m1·m2/r²
//
// This is the same physics as SI; only the numeric magnitude is
// re-scaled for readability. The formula chip shown to the student is
// the untranslated F = G·m1·m2/r².

export const G_SI = 6.674e-11 // N·m²/kg²
export const G_SCALED = 6.674 // when m in ×10²³ kg and r in ×10⁷ m → F in ×10²¹ N

// ─── Setup type ─────────────────────────────────────────────────────
export type Setup = {
  // Target force, in units of 10²¹ N (matches the display scale).
  targetFDisplay: number
  // A canonical (m1, m2, r) triple that satisfies the target. Used only
  // for internal sanity checks — the student is not shown this triple.
  canonical: { m1: number; m2: number; r: number }
}

// ─── Hand-authored setups (seed-indexed) ────────────────────────────
// Chosen so each entry probes a different regime:
//   - low-mass close pair       (small numbers everywhere)
//   - massive pair far apart    (large masses, large r — same F)
//   - asymmetric masses         (m1 >> m2)
//   - short distance dominates  (small r wins the ratio)
//   - moderate all-round        (round numbers)
export const SETUPS: Setup[] = [
  // 1) Moderate F ≈ 13.3 ×10²¹ N. Canonical: m1=2, m2=4, r=2 → 6.674·8/4 = 13.35
  { targetFDisplay: 13.35, canonical: { m1: 2, m2: 4, r: 2 } },
  // 2) Weak F ≈ 3.34 ×10²¹ N. Canonical: m1=2, m2=1, r=2 → 6.674·2/4 = 3.337
  { targetFDisplay: 3.34, canonical: { m1: 2, m2: 1, r: 2 } },
  // 3) Strong F ≈ 33.4 ×10²¹ N. Canonical: m1=5, m2=5, r=√5 ≈ 2.24 → 6.674·25/5 = 33.37
  { targetFDisplay: 33.37, canonical: { m1: 5, m2: 5, r: 2.24 } },
  // 4) Very strong F ≈ 66.7 ×10²¹ N. Canonical: m1=10, m2=10, r=√10 ≈ 3.16 → 66.74
  { targetFDisplay: 66.74, canonical: { m1: 10, m2: 10, r: 3.16 } },
  // 5) Moderate F ≈ 10.0 ×10²¹ N. Canonical: m1=3, m2=2, r=2 → 6.674·6/4 = 10.01
  { targetFDisplay: 10.01, canonical: { m1: 3, m2: 2, r: 2 } },
]

// ─── Feature = force in display units (×10²¹ N) ─────────────────────
export function computeForceDisplay(m1: number, m2: number, r: number): number {
  return (G_SCALED * m1 * m2) / (r * r)
}

// ─── Tolerance check ────────────────────────────────────────────────
// Family A convention: ±5% relative on the feature value.
export const F_TOL = 0.05
export function forceMatchesTolerance(actual: number, target: number, tol = F_TOL): boolean {
  return Math.abs(actual - target) / Math.abs(target) < tol
}

// ─── Display formatting ─────────────────────────────────────────────
export function formatForceDisplay(fDisplay: number): string {
  if (fDisplay >= 100) return `${fDisplay.toFixed(0)}`
  if (fDisplay >= 10) return `${fDisplay.toFixed(1)}`
  return `${fDisplay.toFixed(2)}`
}
