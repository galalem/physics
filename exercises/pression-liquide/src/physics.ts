// ─── Hydrostatic pressure — inline physics module ────────────────────────
// Formula: p(h) = p₀ + ρ · g · h
// Constants baked in per JSON handoff (p₀ ≈ 10⁵ Pa, g = 10 m/s²).

export const P0 = 100_000 // Pa (atmospheric)
export const G = 10 // m/s²

// DOF ranges
export const RHO_MIN = 600 // kg/m³ (light oils / gasoline)
export const RHO_MAX = 14_000 // kg/m³ (mercury)
export const RHO_DEFAULT = 1_000 // kg/m³ (water)

export const H_MIN = 0 // m
export const H_MAX = 20 // m
export const H_DEFAULT = 5 // m

// Tolerance: ±3% relative on the absolute pressure (Family C convention)
export const TOL = 0.03

// ─── Hand-authored setups (seed-indexed, NOT RNG-generated) ─────────────
export type Setup = {
  targetKPa: number // target absolute pressure in kPa
  hint: string // one-line strategy anchor
}

export const SETUPS: Setup[] = [
  // Solvable with any liquid; water → h = 5 m, oil (800) → 6.25 m.
  { targetKPa: 150, hint: 'water at h=5m works, oil (800) at h=6.25m works too' },
  // Requires denser liquid or deeper h; water → 10m, seawater → ~9.7m.
  { targetKPa: 200, hint: 'water at h=10m; mercury barely needed (h≈0.74m)' },
  // Water → 15m (allowed); glycerin (1260) → ~11.9m.
  { targetKPa: 250, hint: 'water at 15m or glycerin at ≈12m' },
  // Needs mercury or near-max depth; water at 30m is out of range.
  { targetKPa: 400, hint: 'mercury (13600) at h≈2.2m; glycerin at h≈23.8m (out of range)' },
  // Only mercury reaches it in range.
  { targetKPa: 600, hint: 'mercury (13600) at h≈3.7m — lighter liquids run out of tank' },
]

// ─── Feature extractor ─────────────────────────────────────────────────
/** Pressure at depth h (Pa). Formula: p = p₀ + ρ·g·h. */
export function pressureAt(rho: number, h: number): number {
  return P0 + rho * G * h
}

/** Same, but returned in kPa for display. */
export function pressureKPa(rho: number, h: number): number {
  return pressureAt(rho, h) / 1_000
}

/** Tolerance check on absolute pressure (±TOL relative). */
export function pressureMatches(rho: number, h: number, targetKPa: number): boolean {
  const actual = pressureKPa(rho, h)
  return Math.abs(actual - targetKPa) / Math.abs(targetKPa) < TOL
}

/** Relative discrepancy Δp/p* (used post-submit only). */
export function pressureRelErr(rho: number, h: number, targetKPa: number): number {
  const actual = pressureKPa(rho, h)
  return Math.abs(actual - targetKPa) / Math.abs(targetKPa)
}

// ─── Formatters ─────────────────────────────────────────────────────────
export function formatRho(rho: number): string {
  return `${rho.toFixed(0)}`
}

export function formatH(h: number): string {
  return `${h.toFixed(2)}`
}

export function formatKPa(kPa: number): string {
  if (kPa >= 1_000) return `${(kPa / 1_000).toFixed(2)}MPa`
  if (kPa >= 100) return `${kPa.toFixed(0)}kPa`
  return `${kPa.toFixed(1)}kPa`
}
