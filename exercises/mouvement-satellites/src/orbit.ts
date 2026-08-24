// ─── Pure orbital mechanics ─────────────────────────────────────────────
// Units throughout: distances in km, speeds in km/s, times in s, GM in km³/s².
// All physics is CLOSED-FORM (Kepler's laws) — no numerical integrator.
// The launch condition is always tangential: satellite at (r, 0), velocity
// (0, v). Angular momentum L = r·v is positive → orbit is counter-clockwise.

export const GM = 4e5 // Earth's μ_T = GM_T ≈ 3.986·10⁵ km³/s² — rounded

// Circular orbit speed at radius r.
export function vCirc(rKm: number): number {
  return Math.sqrt(GM / rKm)
}

// Orbital period (any bound orbit) from semi-major axis a. For a circular
// orbit a = r.
export function period(aKm: number): number {
  return 2 * Math.PI * Math.sqrt((aKm * aKm * aKm) / GM)
}

// Radius of a circular orbit with period T (seconds). Inverse of period(r).
export function radiusForPeriod(TSec: number): number {
  return Math.cbrt((GM * TSec * TSec) / (4 * Math.PI * Math.PI))
}

// ─── Orbit shape from launch conditions ────────────────────────────────
export type Orbit =
  | { kind: 'circular'; r: number; T: number }
  | {
      kind: 'ellipse'
      a: number
      e: number
      T: number
      // orientation: angle from +x axis to periapsis direction.
      // v > vCirc → periapsis at launch point (+x) → thetaPeri = 0
      // v < vCirc → apoapsis at launch point (+x)  → thetaPeri = π
      thetaPeri: number
      // true-anomaly at launch (t = 0)
      nu0: number
    }
  | { kind: 'escape'; r0: number; v0: number }

const CIRC_TOL = 0.03 // 3% band around v_circ classifies as circular

export function orbitFromLaunch(rKm: number, vKmPerS: number): Orbit {
  const vc = vCirc(rKm)
  if (Math.abs(vKmPerS - vc) / vc < CIRC_TOL) {
    return { kind: 'circular', r: rKm, T: (2 * Math.PI * rKm) / vKmPerS }
  }
  const E = 0.5 * vKmPerS * vKmPerS - GM / rKm // specific orbital energy
  if (E >= 0) {
    // Constrained upstream — V slider capped below escape at every r.
    return { kind: 'escape', r0: rKm, v0: vKmPerS }
  }
  const a = -GM / (2 * E)
  const L = rKm * vKmPerS
  const eSq = 1 - (L * L) / (GM * a)
  const e = Math.sqrt(Math.max(0, eSq))
  const T = period(a)
  const isPeriapsisLaunch = vKmPerS > vc
  return {
    kind: 'ellipse',
    a,
    e,
    T,
    thetaPeri: isPeriapsisLaunch ? 0 : Math.PI,
    nu0: isPeriapsisLaunch ? 0 : Math.PI,
  }
}

// Position at cinematic time t (seconds since fire). One full orbit takes
// exactly `simPeriodSec` cinematic seconds regardless of the physical period.
// For circular orbits this is exact uniform sweep; for elliptical orbits
// this is a uniform-in-true-anomaly parametrization, which draws the
// correct ellipse but is not Kepler's-2nd-law-accurate on speed. That's a
// deliberate simplification for 3ème depth — the target case is circular
// anyway.
export function positionAt(
  orbit: Orbit,
  t: number,
  simPeriodSec: number,
): { x: number; y: number } | null {
  if (orbit.kind === 'circular') {
    const theta = (2 * Math.PI * t) / simPeriodSec
    return { x: orbit.r * Math.cos(theta), y: orbit.r * Math.sin(theta) }
  }
  if (orbit.kind === 'ellipse') {
    const nu = orbit.nu0 + (2 * Math.PI * t) / simPeriodSec
    const rNu = (orbit.a * (1 - orbit.e * orbit.e)) / (1 + orbit.e * Math.cos(nu))
    const theta = orbit.thetaPeri + nu
    return { x: rNu * Math.cos(theta), y: rNu * Math.sin(theta) }
  }
  return null // escape — should not happen with the current V range
}

// Sample the full orbit path (one period). Used for preview and for
// rendering the shape after a fire in stage 1 exploration.
export function sampleOrbit(orbit: Orbit, steps = 96): Array<{ x: number; y: number }> {
  if (orbit.kind === 'circular') {
    const out: Array<{ x: number; y: number }> = []
    for (let i = 0; i <= steps; i++) {
      const th = (2 * Math.PI * i) / steps
      out.push({ x: orbit.r * Math.cos(th), y: orbit.r * Math.sin(th) })
    }
    return out
  }
  if (orbit.kind === 'ellipse') {
    const out: Array<{ x: number; y: number }> = []
    for (let i = 0; i <= steps; i++) {
      const nu = orbit.nu0 + (2 * Math.PI * i) / steps
      const rNu = (orbit.a * (1 - orbit.e * orbit.e)) / (1 + orbit.e * Math.cos(nu))
      const th = orbit.thetaPeri + nu
      out.push({ x: rNu * Math.cos(th), y: rNu * Math.sin(th) })
    }
    return out
  }
  return []
}

// Minimum radial distance from focus over the orbit — for "crashes into Earth" checks.
export function periapsisR(orbit: Orbit): number {
  if (orbit.kind === 'circular') return orbit.r
  if (orbit.kind === 'ellipse') return orbit.a * (1 - orbit.e)
  return orbit.r0
}
