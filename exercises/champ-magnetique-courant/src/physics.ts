// Physical constants and closed-form formulas for the straight-wire
// magnetic field exercise. All arithmetic stays in this module so
// Scene.tsx can remain rendering-focused.

// Vacuum permeability (T·m/A). μ₀ = 4π × 10⁻⁷.
export const MU0 = 4 * Math.PI * 1e-7

// Current slider range (amperes).
export const I_MIN = 1
export const I_MAX = 30
export const I_DEFAULT = 5
export const I_STEP = 0.1

// Probe-distance slider range (centimetres — the display unit for
// realistic classroom setups; SI conversion happens inside fieldB_uT).
export const R_MIN = 1
export const R_MAX = 20
export const R_DEFAULT = 5
export const R_STEP = 0.1

// ─── Closed-form formula ──────────────────────────────────────────────
// B = μ₀·I / (2π·r). Feed r in centimetres; result in microtesla (μT)
// so both the sliders and the readout stay at classroom-friendly scales.
//
// Analytical simplification (for verification / peek content):
//   B[T]   = μ₀·I / (2π·r)  =  (4π·10⁻⁷ / 2π) · I/r  =  2·10⁻⁷ · I / r_m
//   B[μT]  = 20 · I / r_cm
export function fieldB_uT(I_A: number, r_cm: number): number {
  const r_m = r_cm * 1e-2
  return (MU0 * I_A) / (2 * Math.PI * r_m) * 1e6
}

// ─── Hand-authored setups (seed-indexed, never RNG-generated) ─────────
// Each setup exposes a target field magnitude at a nominated probe
// distance. `hint_*` describe ONE working (I, r) pair — many others
// exist; the tolerance check only cares about B, not the specific
// (I, r) pair the student picked.
export type Setup = {
  targetB_uT: number   // the feature the student must match
  r_star_cm: number    // where the target point M is drawn in the schematic
  hint_I: number       // example working current (used only for internal sanity)
  hint_r_cm: number    // example working distance (used only for internal sanity)
}

export const SETUPS: Setup[] = [
  { targetB_uT: 40,  r_star_cm: 5,  hint_I: 10, hint_r_cm: 5 },
  { targetB_uT: 100, r_star_cm: 2,  hint_I: 10, hint_r_cm: 2 },
  { targetB_uT: 20,  r_star_cm: 10, hint_I: 10, hint_r_cm: 10 },
  { targetB_uT: 50,  r_star_cm: 8,  hint_I: 20, hint_r_cm: 8 },
  { targetB_uT: 200, r_star_cm: 2,  hint_I: 20, hint_r_cm: 2 },
]

// ─── Tolerance check ──────────────────────────────────────────────────
// Family B (linear / uniform-ish field): ±5% relative on the feature.
export const TOLERANCE = 0.05
export function fieldMatches(actual_uT: number, target_uT: number): boolean {
  if (target_uT <= 0) return false
  return Math.abs(actual_uT - target_uT) / target_uT < TOLERANCE
}

// ─── Formatter (dynamic precision) ────────────────────────────────────
export function formatUT(uT: number): string {
  if (uT >= 100) return `${uT.toFixed(0)}μT`
  if (uT >= 10)  return `${uT.toFixed(1)}μT`
  return `${uT.toFixed(2)}μT`
}
