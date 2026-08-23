// Buoyancy / Archimedes physics module.
// All formulas SI-internal; units at call sites (mL for V, kg/m³ for ρ, N for forces).

export type Setup = {
  /** Target immersed fraction (0..1). Iceberg = 0.90. */
  targetFraction: number
}

// Hand-authored setups, seed-indexed via SETUPS[seed % SETUPS.length].
// Each entry probes a different regime of the density ratio.
export const SETUPS: Setup[] = [
  { targetFraction: 0.90 }, // "iceberg" — dense object, barely floats
  { targetFraction: 0.50 }, // half-submerged (ρ_obj = ρ_liq / 2)
  { targetFraction: 0.80 }, // ship hull
  { targetFraction: 0.75 }, // cork in oil-like
  { targetFraction: 0.60 }, // moderate float
]

export const G = 9.81 // m/s²

/**
 * Immersed volume fraction at equilibrium.
 * Floating: f = ρ_obj / ρ_liq (Archimedes: ρ_liq·V_imm·g = ρ_obj·V·g).
 * Sinking (ρ_obj ≥ ρ_liq): fully submerged, f = 1.
 */
export function immersedFraction(rhoObj: number, rhoLiq: number): number {
  if (rhoLiq <= 0) return 1
  return Math.min(rhoObj / rhoLiq, 1)
}

/** Object weight (N). V in mL, ρ in kg/m³. */
export function weightN(rhoObj: number, vMl: number): number {
  return rhoObj * vMl * 1e-6 * G
}

/** Buoyancy magnitude (N) at equilibrium. */
export function buoyancyN(rhoObj: number, rhoLiq: number, vMl: number): number {
  const vM3 = vMl * 1e-6
  const vImmM3 = immersedFraction(rhoObj, rhoLiq) * vM3
  return rhoLiq * vImmM3 * G
}

// ±3% relative — Family C convention (see AUTHORING §9.1 / §9.2).
const TOL = 0.03
export function featureMatchesTolerance(actual: number, target: number): boolean {
  if (target === 0) return Math.abs(actual) < 1e-6
  return Math.abs(actual - target) / Math.abs(target) < TOL
}
