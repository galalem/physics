// ─── Physical constants ─────────────────────────────────────────────
export const G = 6.674e-11 // N·m²/kg²

// ─── Slider ranges ──────────────────────────────────────────────────
// Mass in units of 10²⁴ kg (Earth ≈ 5.97, Mars ≈ 0.64, Moon ≈ 0.073)
export const M_MIN = 0.05
export const M_MAX = 15.0
export const M_STEP = 0.05
export const M_DEFAULT = 6.0

// Probe distance from source in Mm (10⁶ m). Earth surface ≈ 6.4 Mm.
export const R_MIN = 1.5
export const R_MAX = 20.0
export const R_STEP = 0.1
export const R_DEFAULT = 6.4

// Coverage threshold on both sliders for stage 1 advance.
export const COVERAGE_MIN_FRAC = 0.5

// ─── Setup type + hand-authored setups ──────────────────────────────
export type Setup = {
  rStar: number // Mm
  gStar: number // N/kg
  mStar: number // 10²⁴ kg — informational (the value the student should compute)
}

// Six planet-like regimes. Each is reachable within the slider steps
// to within ±5% (checked before commit).
export const SETUPS: readonly Setup[] = [
  // Earth-like
  { rStar: 6.4, gStar: 9.8, mStar: 6.02 },
  // Mars-like
  { rStar: 3.4, gStar: 3.7, mStar: 0.64 },
  // Mid-mass rocky planet
  { rStar: 5.0, gStar: 6.0, mStar: 2.25 },
  // Cool giant (larger but lower g)
  { rStar: 8.0, gStar: 4.0, mStar: 3.84 },
  // Dense core, small radius
  { rStar: 4.0, gStar: 7.0, mStar: 1.68 },
  // Heavy planet at large radius
  { rStar: 9.0, gStar: 6.0, mStar: 7.28 },
]

// ─── Field formula ──────────────────────────────────────────────────
/** |g| = G·M/r² with M in 10²⁴ kg and r in Mm. Returns N/kg. */
export function gravField(mE24: number, rMm: number): number {
  const M = mE24 * 1e24
  const r = rMm * 1e6
  return (G * M) / (r * r)
}

/** Feature the student must match: gravity magnitude at the chosen probe. */
export function computeFeature(mE24: number, rMm: number): number {
  return gravField(mE24, rMm)
}

// ─── Tolerance ──────────────────────────────────────────────────────
export const G_TOL = 0.05 // ±5% relative on |g|
export const R_TOL = 0.05 // ±5% relative on r (student must land the probe near r*)

/** Both the probe radius AND the field magnitude must be within tolerance. */
export function featureMatches(mE24: number, rMm: number, setup: Setup): boolean {
  const rErr = Math.abs(rMm - setup.rStar) / setup.rStar
  if (rErr >= R_TOL) return false
  const g = computeFeature(mE24, rMm)
  const gErr = Math.abs(g - setup.gStar) / setup.gStar
  return gErr < G_TOL
}

// ─── Formatters ─────────────────────────────────────────────────────
export function formatG(v: number): string {
  if (v >= 100) return v.toFixed(0)
  if (v >= 10) return v.toFixed(1)
  if (v >= 1) return v.toFixed(2)
  if (v >= 0.1) return v.toFixed(3)
  return v.toExponential(1)
}

export function formatM(v: number): string {
  return v.toFixed(2)
}

// ─── Colormap ───────────────────────────────────────────────────────
/**
 * Perceptual sequential map from log|g|: dark (weak) → cyan (strong).
 * Range chosen so that g ∈ [0.01, 300] N/kg covers t ∈ [0, 1].
 */
export function fieldColor(g: number): string {
  const log = Math.log10(Math.max(g, 1e-3))
  const t = Math.max(0, Math.min(1, (log - -2) / 4.5))
  // dark navy (t=0) → deep blue → cyan → pale cyan (t=1)
  const r = Math.floor(4 + 40 * t * t)
  const gCh = Math.floor(10 + 210 * t)
  const b = Math.floor(24 + 200 * t * (1 - 0.15 * t))
  return `rgb(${r},${gCh},${b})`
}

// ─── Planet visual radius (SVG px) ──────────────────────────────────
/** Small visual growth with M so mass-change is perceivable. */
export function planetRadiusPx(mE24: number): number {
  return 14 + 3.5 * Math.sqrt(mE24)
}
