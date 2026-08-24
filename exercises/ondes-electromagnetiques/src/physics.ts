// ─── EM wave physics ─────────────────────────────────────────────
// Fundamental relation for all electromagnetic waves in vacuum: c = λ·f
// where c is the speed of light. Given any two, the third follows.
export const C = 3e8 // m/s

// ─── DOF ranges ──────────────────────────────────────────────────
// Frequency slider is LOG-scale: input value = log10(f).
// Range covers radio (~10 MHz) through soft X-ray (~10^18 Hz).
export const S_MIN = 7 // → f = 10 MHz  → λ = 30 m
export const S_MAX = 18 // → f = 10^18 Hz → λ = 3·10^-10 m
export const S_DEFAULT = 12 // → f = 10^12 Hz → λ = 3·10^-4 m (far infrared)

export const E0_MIN = 0.1 // V/m
export const E0_MAX = 10 // V/m
export const E0_DEFAULT = 5 // V/m

export const THETA_MIN = 0 // degrees
export const THETA_MAX = 90 // degrees
export const THETA_DEFAULT = 30 // degrees

// ─── Feature: wavelength ─────────────────────────────────────────
export function frequencyFromS(s: number): number {
  return Math.pow(10, s)
}

export function wavelengthFromS(s: number): number {
  return C / frequencyFromS(s)
}

export function sFromWavelength(lambda: number): number {
  return Math.log10(C / lambda)
}

// ─── Tolerance check ─────────────────────────────────────────────
// ±5% relative on λ (equivalently ±5% on f, since λ·f = c).
export const TOLERANCE = 0.05
export function lambdaMatchesTol(actual: number, target: number): boolean {
  return Math.abs(actual - target) / target < TOLERANCE
}

// ─── Hand-authored setups (seed-indexed, NOT RNG-generated) ──────
// Each setup probes a different band of the EM spectrum.
export type Setup = {
  lambdaTarget: number // meters
  bandKey: 'radio' | 'microwave' | 'infrared' | 'visible' | 'uv'
  labelKey: 'band_radio' | 'band_microwave' | 'band_infrared' | 'band_visible' | 'band_uv'
}

export const SETUPS: Setup[] = [
  { lambdaTarget: 3.0, bandKey: 'radio', labelKey: 'band_radio' },
  { lambdaTarget: 0.125, bandKey: 'microwave', labelKey: 'band_microwave' },
  { lambdaTarget: 1e-5, bandKey: 'infrared', labelKey: 'band_infrared' },
  { lambdaTarget: 6.5e-7, bandKey: 'visible', labelKey: 'band_visible' },
  { lambdaTarget: 2.5e-7, bandKey: 'uv', labelKey: 'band_uv' },
]

// ─── Wavelength formatter (SI-scaled) ────────────────────────────
export function formatLambda(lambda: number): string {
  const abs = Math.abs(lambda)
  if (abs >= 1) return `${lambda.toFixed(2)} m`
  if (abs >= 1e-2) return `${(lambda * 100).toFixed(1)} cm`
  if (abs >= 1e-3) return `${(lambda * 1e3).toFixed(1)} mm`
  if (abs >= 1e-6) return `${(lambda * 1e6).toFixed(2)} um`
  if (abs >= 1e-9) return `${(lambda * 1e9).toFixed(0)} nm`
  return `${(lambda * 1e12).toFixed(0)} pm`
}

// ─── Frequency formatter (scientific notation, ASCII) ────────────
export function formatFrequency(f: number): string {
  if (f >= 1e15) return `${(f / 1e15).toFixed(2)} PHz`
  if (f >= 1e12) return `${(f / 1e12).toFixed(2)} THz`
  if (f >= 1e9) return `${(f / 1e9).toFixed(2)} GHz`
  if (f >= 1e6) return `${(f / 1e6).toFixed(2)} MHz`
  if (f >= 1e3) return `${(f / 1e3).toFixed(2)} kHz`
  return `${f.toFixed(1)} Hz`
}
