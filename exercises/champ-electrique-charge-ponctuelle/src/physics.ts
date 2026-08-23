// ─── Point-charge electric field — physics module ────────────────────
// Working units chosen so student arithmetic lands on friendly numbers:
//   |q| in nC, r in cm, |E| in kV/m
//
//   k_SI = 8.99e9 N·m²/C²
//   |E|_SI = k · |q|_C / r²_m
//   |E|(kV/m) = (k · |q|·1e-9) / (r·1e-2)² / 1000
//              = 8.99e9 · 1e-9 / 1e-4 / 1e3 · |q|(nC) / r²(cm²)
//              = 89.9 · |q|(nC) / r²(cm²)
export const K_UNIT = 89.9 // |E|(kV/m) per (nC / cm²)

// DOF ranges — Q as magnitude only (sign is not needed to match |E*|).
export const Q_MIN = 1 // nC
export const Q_MAX = 60 // nC
export const Q_DEFAULT = 10 // nC
export const Q_STEP = 0.2 // nC — gives ~250 steps across range

export const R_MIN = 2 // cm
export const R_MAX = 15 // cm
export const R_DEFAULT = 6 // cm
export const R_STEP = 0.05 // cm — 260 steps, well inside 5% relative tolerance

// Stage-1 coverage bit threshold
export const COVERAGE_MIN_FRAC = 0.5

// Tolerance (universal §9.2): ±5% relative on both r and |E|.
export const TOL = 0.05

export type Setup = {
  /** Target probe distance in cm. */
  rStar: number
  /** Target charge magnitude in nC — anchor value used to derive eStar. */
  qStar: number
}

// Hand-authored setups (seed-indexed via SETUPS[seed % SETUPS.length]).
// Each entry probes a different (r*, |E*|) regime so no single setup can be
// brute-forced by remembering a previous answer.
export const SETUPS: Setup[] = [
  { rStar: 3, qStar: 10 }, // |E*| ≈ 99.9 kV/m — tight radius, small charge
  { rStar: 5, qStar: 20 }, // |E*| ≈ 71.9 kV/m — mid radius, mid charge
  { rStar: 8, qStar: 40 }, // |E*| ≈ 56.2 kV/m — wide radius, large charge
  { rStar: 6, qStar: 15 }, // |E*| ≈ 37.5 kV/m — low-magnitude regime
  { rStar: 4, qStar: 30 }, // |E*| ≈ 168.6 kV/m — high-magnitude regime
]

/** Coulomb field magnitude at radius r from a point charge Q (unit-system). */
export function fieldAtKvM(qNc: number, rCm: number): number {
  if (rCm <= 0) return Infinity
  return (K_UNIT * qNc) / (rCm * rCm)
}

/** Target field magnitude (kV/m) implied by a setup's (r*, q*). */
export function targetEKvM(setup: Setup): number {
  return fieldAtKvM(setup.qStar, setup.rStar)
}

/** Relative match on both DOFs, per §9.2. */
export function featureMatchesTolerance(
  qNc: number,
  rCm: number,
  setup: Setup,
  tol: number = TOL,
): boolean {
  const rDelta = Math.abs(rCm - setup.rStar) / setup.rStar
  const eNow = fieldAtKvM(qNc, rCm)
  const eStar = targetEKvM(setup)
  const eDelta = Math.abs(eNow - eStar) / eStar
  return rDelta < tol && eDelta < tol
}
