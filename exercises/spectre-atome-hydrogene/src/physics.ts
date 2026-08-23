// ─── Rydberg constants ───────────────────────────────────────────────────
// R_H = 1.09737e7 m⁻¹ (Rydberg constant for hydrogen)
// 1/λ = R_H · (1/n_f² − 1/n_i²), emission when n_i > n_f.
// E_n = −13.6 / n²  eV
export const R_H = 1.09737315e7 // m⁻¹
export const E_ION = 13.6 // eV, |E_1|

// Allowed integer ranges. Emission requires n_i > n_f.
export const NI_MIN = 2
export const NI_MAX = 7
export const NF_MIN = 1
export const NF_MAX = 4
export const NI_DEFAULT = 3
export const NF_DEFAULT = 2

/** Emitted photon wavelength (nm) for the n_i → n_f transition, or null if invalid (n_i ≤ n_f). */
export function transitionWavelengthNm(nI: number, nF: number): number | null {
  if (nI <= nF) return null
  const invLambdaM = R_H * (1 / (nF * nF) - 1 / (nI * nI))
  return (1 / invLambdaM) * 1e9
}

/** Emitted photon energy (eV) for the n_i → n_f transition. Positive for emission. */
export function transitionEnergyEv(nI: number, nF: number): number {
  return E_ION * (1 / (nF * nF) - 1 / (nI * nI))
}

/** Spectral series classification from n_f. */
export function seriesName(nF: number): 'Lyman' | 'Balmer' | 'Paschen' | 'Brackett' | 'Higher' {
  if (nF === 1) return 'Lyman'
  if (nF === 2) return 'Balmer'
  if (nF === 3) return 'Paschen'
  if (nF === 4) return 'Brackett'
  return 'Higher'
}

/** Spectral band a wavelength (nm) falls into. */
export function spectralBand(lambdaNm: number): 'UV' | 'visible' | 'IR' {
  if (lambdaNm < 380) return 'UV'
  if (lambdaNm > 780) return 'IR'
  return 'visible'
}

// ─── Hand-authored setup array (not RNG-generated) ──────────────────────
// Each setup exercises a different physical regime:
//  - Balmer α, β, γ:      visible red / blue-green / violet   (n_f = 2)
//  - Lyman α:             UV                                  (n_f = 1)
//  - Paschen α:           IR                                  (n_f = 3)
// Together they force the student to reason across series, not just Balmer.
export type Setup = {
  targetNi: number
  targetNf: number
  /** Cached wavelength in nm (must equal transitionWavelengthNm(targetNi, targetNf)). */
  targetLambdaNm: number
  series: 'Lyman' | 'Balmer' | 'Paschen' | 'Brackett' | 'Higher'
  band: 'UV' | 'visible' | 'IR'
}

export const SETUPS: Setup[] = [
  { targetNi: 3, targetNf: 2, targetLambdaNm: 656.28, series: 'Balmer', band: 'visible' }, // H-α
  { targetNi: 4, targetNf: 2, targetLambdaNm: 486.13, series: 'Balmer', band: 'visible' }, // H-β
  { targetNi: 5, targetNf: 2, targetLambdaNm: 434.05, series: 'Balmer', band: 'visible' }, // H-γ
  { targetNi: 2, targetNf: 1, targetLambdaNm: 121.57, series: 'Lyman',  band: 'UV' },      // Ly-α
  { targetNi: 4, targetNf: 3, targetLambdaNm: 1875.1, series: 'Paschen', band: 'IR' },     // Pa-α
]

/** Deterministic setup selection (§5.3). */
export function pickSetup(seed: number, offset = 0): Setup {
  return SETUPS[(seed + offset) % SETUPS.length]!
}

/** Match check — integer parameters, so equality is exact. */
export function transitionMatches(nI: number, nF: number, setup: Setup): boolean {
  return nI === setup.targetNi && nF === setup.targetNf
}
