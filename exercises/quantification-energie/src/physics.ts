// ─── Bohr / hydrogen atom energy quantization ────────────────
//
// E_n = -E1 / n²   (Bohr model, hydrogen: E1 = 13.6 eV)
//
// Absorption transition n_start → n_final (n_final > n_start):
//   ΔE = E_final − E_start
//       = -E1/n_final² − (-E1/n_start²)
//       = E1 · (1/n_start² − 1/n_final²)
//
// If an incoming photon carries hν = ΔE for some allowed pair,
// it is absorbed and the atom jumps to n_final. Otherwise it
// passes through — this is the "quantization" idea.

export const E1_EV = 13.6            // hydrogen ionization / |E_1|
export const N_MAX = 6               // levels rendered on the diagram
export const N_START_MIN = 1
export const N_START_MAX = 5
export const HV_MIN = 0.5            // eV — slider floor
export const HV_MAX = 13.5           // eV — slider ceiling (< E1)
export const HV_STEP = 0.02          // eV

// Relative tolerance on hν for a transition to be considered matched.
// 5% relative — the same convention as diffraction / Coulomb.
export const HV_TOL = 0.05

/** Energy of level n (eV, negative). */
export function levelEnergy(n: number): number {
  return -E1_EV / (n * n)
}

/** Absorption transition energy n_start → n_final. */
export function transitionEnergy(nStart: number, nFinal: number): number {
  return E1_EV * (1 / (nStart * nStart) - 1 / (nFinal * nFinal))
}

/**
 * Given a starting level and a photon energy, return the exact real n_final
 * (not necessarily integer). The atom lands on an allowed level only when
 * this value is close to an integer > nStart.
 *
 *   E_start + hν = E_final = -E1/n_final²
 *   → 1/n_final² = 1/n_start² − hν/E1
 */
export function landingLevel(nStart: number, hv: number): number | null {
  const inv2 = 1 / (nStart * nStart) - hv / E1_EV
  if (inv2 <= 0) return null // ionized — photon exceeds threshold from this level
  return 1 / Math.sqrt(inv2)
}

/**
 * Find the nearest integer landing level and its distance. Used to
 * flag absorption on stages 1 & 2 (visual highlight).
 */
export function nearestAbsorption(nStart: number, hv: number): {
  nFinal: number
  hvExact: number
  err: number
} | null {
  const nReal = landingLevel(nStart, hv)
  if (nReal === null) return null
  const nInt = Math.round(nReal)
  if (nInt <= nStart || nInt > N_MAX) return null
  const hvExact = transitionEnergy(nStart, nInt)
  return { nFinal: nInt, hvExact, err: Math.abs(hv - hvExact) / hvExact }
}

// ─── Hand-authored setups (seed-indexed, NOT RNG-generated) ──
// Each entry probes a different region of the hydrogen spectrum:
// Balmer (start=2, visible), Lyman (start=1, UV), Paschen (start=3, IR).
export type Setup = {
  nStart: number
  nFinal: number
  hvTarget: number    // eV, cached from transitionEnergy(nStart, nFinal)
  seriesLabel: string // "balmer" | "lyman" | "paschen" (informational only)
}

function mkSetup(nStart: number, nFinal: number, seriesLabel: string): Setup {
  return {
    nStart,
    nFinal,
    hvTarget: transitionEnergy(nStart, nFinal),
    seriesLabel,
  }
}

export const SETUPS: Setup[] = [
  mkSetup(2, 4, 'balmer'),   // 2.550 eV — H-β, blue
  mkSetup(1, 3, 'lyman'),    // 12.089 eV — Lyman-β, deep UV
  mkSetup(2, 3, 'balmer'),   // 1.889 eV — H-α, red
  mkSetup(1, 2, 'lyman'),    // 10.200 eV — Lyman-α
  mkSetup(2, 5, 'balmer'),   // 2.856 eV — H-γ, violet
]

/** Stage 2 / 3 tolerance check on (n_start, hν) vs. setup target. */
export function featureMatches(
  nStart: number,
  hv: number,
  setup: Setup,
): boolean {
  if (nStart !== setup.nStart) return false
  return Math.abs(hv - setup.hvTarget) / setup.hvTarget < HV_TOL
}
