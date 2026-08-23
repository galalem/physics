// Refraction of a mechanical wave (ripple-tank analogue).
// Two zones with celerities c₁, c₂. Fixed source period T.
// Snell: sin(i₁)/sin(i₂) = c₁/c₂ = λ₁/λ₂. Since f = 1/T is fixed,
// λ = c · T. Zone 1 is the incident medium, zone 2 is the refracted one.

// ─── Fixed source period ─────────────────────────────────────
export const T_PERIOD_S = 0.05 // 20 Hz — held constant across setups

// ─── Wavelength (mm) from celerity (m/s) ─────────────────────
export function lambdaMm(cMs: number): number {
  return cMs * T_PERIOD_S * 1000
}

// ─── Refracted angle (rad) from Snell — null when TIR ────────
export function refractedAngleRad(
  c1: number,
  c2: number,
  i1Rad: number,
): number | null {
  const sinI2 = Math.sin(i1Rad) * (c2 / c1)
  if (sinI2 > 1 || sinI2 < -1) return null
  return Math.asin(sinI2)
}

// ─── Setup: seeded target (i₂*, λ₂*) ─────────────────────────
export type Setup = {
  i2StarDeg: number
  lambda2StarMm: number
}

// Hand-authored — each setup pins a distinct combination of a
// refracted angle and a refracted wavelength that IS reachable by
// the slider ranges (c ∈ [0.10, 0.50] m/s → λ ∈ [5, 25] mm;
// i₁ ∈ [10°, 70°]).
export const SETUPS: Setup[] = [
  { i2StarDeg: 30, lambda2StarMm: 10 },
  { i2StarDeg: 20, lambda2StarMm: 12 },
  { i2StarDeg: 45, lambda2StarMm: 8 },
  { i2StarDeg: 25, lambda2StarMm: 15 },
]

// ─── Tolerance (see §9.2 of the pattern brief) ───────────────
export const I2_TOL_DEG = 3 // ±3° absolute (angle target)
export const LAMBDA2_TOL_REL = 0.05 // ±5% relative (wavelength target)

export function featureMatchesTolerance(
  i2Deg: number | null,
  lambda2MmValue: number,
  target: Setup,
): boolean {
  if (i2Deg === null) return false
  const angleErr = Math.abs(i2Deg - target.i2StarDeg)
  const lambdaErrRel =
    Math.abs(lambda2MmValue - target.lambda2StarMm) / target.lambda2StarMm
  return angleErr < I2_TOL_DEG && lambdaErrRel < LAMBDA2_TOL_REL
}
