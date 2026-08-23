// Physics for travail-puissance.
// W = F · d · cos(α)   (work in J, F in N, d in m, α in rad)
// P = W / Δt           (power in W)

export type Setup = {
  /** Stage 2 target power (W). */
  pStar: number
  /** Stage 3 target work (J). Distinct from the stage-2 target. */
  wStar: number
  /** Stage 3 anchor distance (m). Student must set d to this value. */
  dStar: number
}

// Hand-authored setups. Each entry probes a different regime:
// small/large power, small/large work, near/far distance.
export const SETUPS: Setup[] = [
  { pStar: 40, wStar: 320, dStar: 4 },
  { pStar: 60, wStar: 500, dStar: 5 },
  { pStar: 25, wStar: 480, dStar: 6 },
  { pStar: 90, wStar: 720, dStar: 8 },
  { pStar: 50, wStar: 240, dStar: 3 },
]

const DEG2RAD = Math.PI / 180

/** Work done by a constant force at angle α (deg) to the displacement. */
export function computeWork(fN: number, dM: number, alphaDeg: number): number {
  return fN * dM * Math.cos(alphaDeg * DEG2RAD)
}

/** Instantaneous mean power over Δt. */
export function computePower(workJ: number, dtS: number): number {
  return workJ / dtS
}

/** Horizontal projection of the force (N). */
export function horizontalForce(fN: number, alphaDeg: number): number {
  return fN * Math.cos(alphaDeg * DEG2RAD)
}

/** Vertical projection of the force (N). */
export function verticalForce(fN: number, alphaDeg: number): number {
  return fN * Math.sin(alphaDeg * DEG2RAD)
}

/** ±5% relative tolerance. */
export const TOL_REL = 0.05

export function withinTol(actual: number, target: number, tol = TOL_REL): boolean {
  if (target === 0) return Math.abs(actual) < tol
  return Math.abs(actual - target) / Math.abs(target) < tol
}
