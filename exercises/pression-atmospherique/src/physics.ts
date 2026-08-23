// Physical constants
export const RHO_HG = 13595 // kg/m³, density of mercury at 0 °C
export const G_STD = 9.81 // m/s²
export const R_GAS = 8.314 // J/(mol·K)
export const M_AIR = 0.02896 // kg/mol, molar mass of dry air
export const PA_PER_MMHG = 133.322 // 1 mmHg = 133.322 Pa

// Barometric scale height H = R·T / (M·g), meters
export function scaleHeight(tKelvin: number): number {
  return (R_GAS * tKelvin) / (M_AIR * G_STD)
}

// p(z) = p₀ · exp(-z / H(T)). Inputs: p0 in Pa, z in m, T in K. Output: Pa.
export function pressureAtAltitude(p0Pa: number, zMeters: number, tKelvin: number): number {
  return p0Pa * Math.exp(-zMeters / scaleHeight(tKelvin))
}

// Torricelli mercury column height: h = p / (ρ_Hg · g), pressure in Pa, output in mm.
export function mercuryHeightMm(pPa: number): number {
  const hMeters = pPa / (RHO_HG * G_STD)
  return hMeters * 1000
}

// The feature: mercury column height in mm Hg for the current (z, p0, T) triple.
export function computeFeature(
  zMeters: number,
  p0Kpa: number,
  tKelvin: number,
): number {
  const pPa = pressureAtAltitude(p0Kpa * 1000, zMeters, tKelvin)
  return mercuryHeightMm(pPa)
}

// Convenience: pressure in kPa given the (z, p0, T) triple.
export function pressureKpa(
  zMeters: number,
  p0Kpa: number,
  tKelvin: number,
): number {
  return pressureAtAltitude(p0Kpa * 1000, zMeters, tKelvin) / 1000
}

// ±3% relative tolerance — Family C (hydrostatic) convention from the brief.
export const TOLERANCE = 0.03
export function featureMatchesTolerance(actual: number, target: number): boolean {
  if (!Number.isFinite(actual) || target <= 0) return false
  return Math.abs(actual - target) / target < TOLERANCE
}

// Hand-authored setups, one per physical regime.
// Each target h* is achievable from many (z, p0, T) triples; the exercise
// asks the student to find any triple that reproduces h* within tolerance.
export type Setup = {
  hStar: number // target mercury column height in mm Hg
  regime: string // short slug for debugging / labels
}
export const SETUPS: Setup[] = [
  { hStar: 760, regime: 'sea-level' },
  { hStar: 700, regime: 'low-altitude' },
  { hStar: 620, regime: 'highland' },
  { hStar: 500, regime: 'mountain' },
  { hStar: 400, regime: 'high-altitude' },
]
