// Physics: superposition of two point-charge fields at a test point M.
//
// Geometry (fixed): charges live on the x-axis at (-d, 0) and (+d, 0).
// M is fixed above the midpoint at (0, H_M). The three DOFs are
// q1 (nC, signed), q2 (nC, signed) and d (m, half-separation).
//
// Closed form: with r² = d² + H_M² for both sources by symmetry,
//   E_x = k · d · (q1 − q2) / r³
//   E_y = k · h · (q1 + q2) / r³
// where q are in coulombs and k = 9e9 N·m²/C².

export const K_E = 9e9 // Coulomb constant, N·m²/C²
export const H_M = 1.5 // test-point height above midpoint, m

// ─── DOF ranges ─────────────────────────────────────────────
export const Q_MIN = -10 // nC
export const Q_MAX = 10 // nC
export const Q_DEFAULT = 0 // nC
export const Q_STEP = 0.1 // nC

export const D_MIN = 0.5 // m
export const D_MAX = 3.0 // m
export const D_DEFAULT = 1.5 // m
export const D_STEP = 0.05 // m

// ─── Setup (target vector at M) ─────────────────────────────
export type Setup = {
  targetEx: number // V/m
  targetEy: number // V/m
  // canonical solution kept as a design-time sanity check (not shown to student)
  solution: { q1: number; q2: number; d: number }
}

// Hand-authored, seed-indexed. Each setup probes a distinct regime:
//  A — symmetric same-sign  → purely vertical E
//  B — symmetric opposite   → purely horizontal E (pure dipole)
//  C — asymmetric same-sign → mostly vertical, tilted right
//  D — asymmetric opposite  → mostly horizontal, small vertical bias
//  E — mixed with wider d   → diagonal downward E
export const SETUPS: Setup[] = [
  {
    // q1=+6, q2=+6, d=1  → (0, 27.66)
    targetEx: 0,
    targetEy: 28,
    solution: { q1: 6, q2: 6, d: 1 },
  },
  {
    // q1=+8, q2=-8, d=1  → (24.58, 0)
    targetEx: 25,
    targetEy: 0,
    solution: { q1: 8, q2: -8, d: 1 },
  },
  {
    // q1=+4, q2=+10, d=1 → (-9.22, 32.28)
    targetEx: -9,
    targetEy: 32,
    solution: { q1: 4, q2: 10, d: 1 },
  },
  {
    // q1=-5, q2=+7, d=1.5 → (-16.96, 2.83)
    targetEx: -17,
    targetEy: 3,
    solution: { q1: -5, q2: 7, d: 1.5 },
  },
  {
    // q1=+3, q2=-9, d=2 → (13.82, -5.18)
    targetEx: 14,
    targetEy: -5,
    solution: { q1: 3, q2: -9, d: 2 },
  },
]

// ─── Field at M ──────────────────────────────────────────────
// q1, q2 in nC. d in m. Returns (Ex, Ey) in V/m at M = (0, H_M).
export function fieldAtM(
  q1_nC: number,
  q2_nC: number,
  d: number,
): { Ex: number; Ey: number } {
  const q1 = q1_nC * 1e-9
  const q2 = q2_nC * 1e-9
  const r2 = d * d + H_M * H_M
  const r3 = r2 * Math.sqrt(r2)
  const Ex = (K_E * d * (q1 - q2)) / r3
  const Ey = (K_E * H_M * (q1 + q2)) / r3
  return { Ex, Ey }
}

// Field from a single charge at position (xC, yC), evaluated at (xM, yM).
// Used for drawing the individual E1, E2 arrows in the scene.
export function fieldFromCharge(
  q_nC: number,
  xC: number,
  yC: number,
  xM: number,
  yM: number,
): { Ex: number; Ey: number } {
  const q = q_nC * 1e-9
  const rx = xM - xC
  const ry = yM - yC
  const r2 = rx * rx + ry * ry
  if (r2 < 1e-9) return { Ex: 0, Ey: 0 }
  const r3 = r2 * Math.sqrt(r2)
  return {
    Ex: (K_E * q * rx) / r3,
    Ey: (K_E * q * ry) / r3,
  }
}

// ─── Feature match ───────────────────────────────────────────
// Vector distance ratio: |E_actual − E_target| / |E_target| < TOL.
// Also require |E_target| itself is nontrivial (checked by design).
export const TOLERANCE = 0.1 // ±10% vector distance (2D target)

export function featureMatchesTolerance(
  actual: { Ex: number; Ey: number },
  target: { targetEx: number; targetEy: number },
): boolean {
  const dx = actual.Ex - target.targetEx
  const dy = actual.Ey - target.targetEy
  const dist = Math.sqrt(dx * dx + dy * dy)
  const tgtMag = Math.sqrt(
    target.targetEx * target.targetEx + target.targetEy * target.targetEy,
  )
  // Guard against tiny target magnitudes with an additive floor of 1 V/m.
  return dist / (tgtMag + 1) < TOLERANCE
}

export function magnitude(v: { Ex: number; Ey: number }): number {
  return Math.sqrt(v.Ex * v.Ex + v.Ey * v.Ey)
}
