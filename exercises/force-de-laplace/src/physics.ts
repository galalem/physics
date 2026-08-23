// ─── Physics for Force de Laplace ───────────────────────────────────────
// |F| = B · I · L · sin(alpha)
//   B in tesla, I in ampere, L in meter, alpha in radians
//   → F in newton
//
// SETUPS are hand-authored target force magnitudes (in newtons). Seed
// picks which one runs. Each target is reachable with many (I, L, B, α)
// combinations inside the slider ranges.

export type Setup = {
  /** Target force magnitude in newtons. */
  fStar: number
}

/**
 * Hand-authored setups. Each entry probes a distinct regime:
 *   - fStar = 0.10 N — mid-range, many valid combos, gentle intro.
 *   - fStar = 0.20 N — needs at least one large parameter.
 *   - fStar = 0.05 N — low end; encourages small α or small B.
 *   - fStar = 0.30 N — high end; forces near-max I·L·B and α close to 90°.
 *   - fStar = 0.15 N — middle-high; several unique routes.
 */
export const SETUPS: Setup[] = [
  { fStar: 0.10 },
  { fStar: 0.20 },
  { fStar: 0.05 },
  { fStar: 0.30 },
  { fStar: 0.15 },
]

/**
 * Feature: force magnitude in newtons.
 *
 * @param i   current in amperes
 * @param lM  rod length in meters
 * @param bT  field magnitude in tesla
 * @param alphaRad angle between I and B, in radians
 */
export function computeForce(
  i: number,
  lM: number,
  bT: number,
  alphaRad: number,
): number {
  return bT * i * lM * Math.sin(alphaRad)
}

/** Relative tolerance on the target feature. */
export const TOLERANCE = 0.05 // ±5%

export function featureMatchesTolerance(actual: number, target: number): boolean {
  if (target <= 0) return false
  return Math.abs(actual - target) / target < TOLERANCE
}

/** Dynamic-precision formatter for force in newtons. */
export function formatForce(f: number): string {
  if (f >= 1) return `${f.toFixed(2)}N`
  if (f >= 0.01) return `${f.toFixed(3)}N`
  return `${(f * 1000).toFixed(1)}mN`
}
