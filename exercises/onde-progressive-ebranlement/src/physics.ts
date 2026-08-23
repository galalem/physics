// Physics module for `onde-progressive-ebranlement`.
//
// Model: a Gaussian pulse (ébranlement) launched from a source at x = 0 at
// time t = 0 travels along a rope at celerity c. In the ideal case (no
// dispersion, no absorption), the shape propagates without deformation:
//
//   y(x, t) = A * exp( -((x - c*t) / σ_x)² )
//
// The retard (propagation delay) at position d is τ = d / c, and the peak
// of the pulse at time t is at x_peak = c * t. This exercise's feature is
// the peak position at a chosen snapshot time.

export type Setup = {
  d: number      // target position along the rope (m)
  tau: number    // target arrival time at that position (s)
  cStar: number  // required celerity (m/s) = d / tau
}

// Hand-authored setups, seed-indexed. Each targets a distinct celerity
// so the student can't just repeat the same computed answer across seeds.
export const SETUPS: Setup[] = [
  { d: 3.0, tau: 0.20, cStar: 15 },
  { d: 2.0, tau: 0.20, cStar: 10 },
  { d: 5.0, tau: 0.25, cStar: 20 },
  { d: 4.5, tau: 0.30, cStar: 15 },
  { d: 6.0, tau: 0.30, cStar: 20 },
]

// Peak position of the pulse at time t for a given celerity.
export function peakPositionAt(c: number, t: number): number {
  return c * t
}

// Retard at a fixed observation distance for a given celerity.
export function retard(d: number, c: number): number {
  return d / c
}

// Gaussian envelope value at physical coordinate xPhys.
export function gaussianAmplitude(
  xPhys: number,
  peakPhys: number,
  sigmaX: number,
  amplitude: number,
): number {
  const u = (xPhys - peakPhys) / sigmaX
  return amplitude * Math.exp(-u * u)
}

// Relative-tolerance check on celerity (±5%).
export const CELERITY_TOL = 0.05
export function celerityMatches(current: number, target: number): boolean {
  return Math.abs(current - target) / Math.abs(target) < CELERITY_TOL
}
