// ─── Physics constants ─────────────────────────────────────────────────
export const G = 9.81 // m/s²
/** Geometric constant of the coil, chosen so slider ranges yield
 *  hover heights in the 2–30 cm band. F₀ = C · N · I.  [N·m² per A·turn]
 */
export const C = 5e-6

// ─── Parameter ranges ──────────────────────────────────────────────────
export const I_MIN = 0.5 // A
export const I_MAX = 5.0 // A
export const I_DEFAULT = 2.0
export const I_STEP = 0.05

export const N_MIN = 100 // turns
export const N_MAX = 500
export const N_DEFAULT = 300
export const N_STEP = 5

export const M_MIN = 5 // g
export const M_MAX = 50 // g
export const M_DEFAULT = 20
export const M_STEP = 0.5

// ─── Setup ─────────────────────────────────────────────────────────────
export type Setup = {
  hTargetCm: number // target hover height, cm — student computes params to hit it
}

/** Hand-authored setups, indexed by seed. Each probes a different regime:
 *  low-hover (dominated by weight), mid-range, high-hover (dominated by F₀).
 */
export const SETUPS: Setup[] = [
  { hTargetCm: 8 },
  { hTargetCm: 4 },
  { hTargetCm: 12 },
  { hTargetCm: 6 },
  { hTargetCm: 15 },
  { hTargetCm: 10 },
]

// ─── Formula ───────────────────────────────────────────────────────────
/** F₀ = C · N · I  — units: N·m² (dimensional constant absorbs geometry). */
export function computeF0(iA: number, nTurns: number): number {
  return C * nTurns * iA
}

/** Weight P = m·g.  m in grams (as slider), returns N. */
export function weightN(mG: number): number {
  return (mG / 1000) * G
}

/** Repulsive force at height h (m).  F_rep = F₀ / h². */
export function fRepAt(iA: number, nTurns: number, hM: number): number {
  return computeF0(iA, nTurns) / (hM * hM)
}

/** Equilibrium height: solve F_rep(h) = m·g → h = √(F₀ / (m·g)).
 *  Returns meters. Guaranteed positive.
 */
export function equilibriumHeightM(iA: number, mG: number, nTurns: number): number {
  const P = weightN(mG)
  const F0 = computeF0(iA, nTurns)
  return Math.sqrt(F0 / P)
}

// ─── Tolerance check ───────────────────────────────────────────────────
export const TOLERANCE = 0.05
export function featureMatchesTolerance(
  actual: number,
  target: number,
  tol: number = TOLERANCE,
): boolean {
  return Math.abs(actual - target) / Math.abs(target) < tol
}
