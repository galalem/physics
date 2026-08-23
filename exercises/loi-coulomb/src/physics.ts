// Coulomb's law: F = k · |q1·q2| / r²
// Units used across the scene:
//   q1, q2 in microcoulombs (µC)
//   r      in centimetres (cm)
//   F      in newtons (N)
//
// Substituting k = 9·10⁹ N·m²/C²:
//   F(N) = 9e9 · (q1·1e-6) · (q2·1e-6) / (r·1e-2)²
//        = 9e9 · 1e-12 · q1·q2 / (r²·1e-4)
//        = 90 · q1·q2 / r²   (with q in µC, r in cm)

/** Compact factor k' = 90 that folds SI k into the µC/cm display units. */
export const K_DISPLAY = 90

/** Coulomb force magnitude in N, given q in µC and r in cm. */
export function coulombForce(q1uC: number, q2uC: number, rCm: number): number {
  if (rCm <= 0) return 0
  return K_DISPLAY * Math.abs(q1uC * q2uC) / (rCm * rCm)
}

// ─── Hand-authored setups ───────────────────────────────────────────────
// Each seed picks one setup via SETUPS[seed % SETUPS.length].
// Chosen to span the reachable |F| range with distinct anchor triples so
// each setup exercises a different physical regime.
export type Setup = {
  /** Target force magnitude in N. */
  targetF: number
  /** One valid anchor triple {q1, q2, r} the student could arrive at.
   *  For author reference only — not shown to the student. */
  anchor: { q1: number; q2: number; r: number }
}

export const SETUPS: Setup[] = [
  { targetF: 0.9,  anchor: { q1: 1, q2: 1,  r: 10 } },  // small-scale anchor
  { targetF: 1.6,  anchor: { q1: 2, q2: 2,  r: 15 } },  // small tweak
  { targetF: 3.6,  anchor: { q1: 2, q2: 2,  r: 10 } },  // mid-range
  { targetF: 10.0, anchor: { q1: 5, q2: 5,  r: 15 } },  // mid-strong
  { targetF: 22.5, anchor: { q1: 10, q2: 10, r: 20 } }, // strong
]

/** ±5 % relative tolerance on |F|. */
export const TOLERANCE = 0.05

export function forceMatchesTolerance(actualF: number, targetF: number): boolean {
  if (targetF <= 0) return false
  return Math.abs(actualF - targetF) / targetF < TOLERANCE
}
