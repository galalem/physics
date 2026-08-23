// ─── Centered-dipole geomagnetic model ─────────────────────────────
// Simple centered-dipole approximation of Earth's magnetic field.
// The magnetic axis is tilted by angle α from the geographic rotation
// axis; the magnetic north pole sits at geographic (lat=90°−α, lon=0°).
//
// All angles here are in DEGREES for the public API. Internal use
// converts to radians at the boundary.

export const DEG = Math.PI / 180

/**
 * Angular distance between the compass (lat, lon) and the magnetic
 * north pole located at (lat=90°−α, lon=0°).
 * Returns colatitude θ_m in degrees.
 */
export function magneticColatitude(latDeg: number, lonDeg: number, alphaDeg: number): number {
  const latP = 90 - alphaDeg
  const cosTheta =
    Math.sin(latDeg * DEG) * Math.sin(latP * DEG) +
    Math.cos(latDeg * DEG) * Math.cos(latP * DEG) * Math.cos(lonDeg * DEG)
  const clamped = Math.max(-1, Math.min(1, cosTheta))
  return Math.acos(clamped) / DEG
}

/** Magnetic latitude λ_m = 90° − θ_m (positive in the northern magnetic hemisphere). */
export function magneticLatitude(latDeg: number, lonDeg: number, alphaDeg: number): number {
  return 90 - magneticColatitude(latDeg, lonDeg, alphaDeg)
}

/**
 * Inclinaison (dip angle) at the compass position.
 * Closed-form dipole formula: tan(I) = 2 · tan(λ_m).
 * Positive I means B̄ points downward (northern magnetic hemisphere).
 */
export function inclinaison(latDeg: number, lonDeg: number, alphaDeg: number): number {
  const lambdaM = magneticLatitude(latDeg, lonDeg, alphaDeg)
  return Math.atan(2 * Math.tan(lambdaM * DEG)) / DEG
}

/**
 * Declinaison (magnetic declination) — angle between geographic north
 * and the horizontal projection of B̄, measured east-positive.
 * Great-circle bearing from compass to magnetic north pole.
 */
export function declinaison(latDeg: number, lonDeg: number, alphaDeg: number): number {
  const latP = 90 - alphaDeg
  // Δlon from compass to pole = 0 − lon = −lon
  const dLon = -lonDeg
  const y = Math.sin(dLon * DEG) * Math.cos(latP * DEG)
  const x =
    Math.cos(latDeg * DEG) * Math.sin(latP * DEG) -
    Math.sin(latDeg * DEG) * Math.cos(latP * DEG) * Math.cos(dLon * DEG)
  return Math.atan2(y, x) / DEG
}

// ─── Hand-authored setup array (indexed by seed) ──────────────────
// Each setup targets a specific inclinaison at a labeled physical
// regime. Solutions form a 2-parameter family (λ_m fixed → circle
// around magnetic pole on the sphere).

export type Setup = {
  targetInclinaison: number
  labelKey: 'setup_equatorial' | 'setup_temperate' | 'setup_mid_northern' | 'setup_high_northern' | 'setup_southern'
}

export const SETUPS: Setup[] = [
  { targetInclinaison: 60, labelKey: 'setup_mid_northern' },
  { targetInclinaison: 0, labelKey: 'setup_equatorial' },
  { targetInclinaison: 45, labelKey: 'setup_temperate' },
  { targetInclinaison: 75, labelKey: 'setup_high_northern' },
  { targetInclinaison: -50, labelKey: 'setup_southern' },
]

// ─── Tolerance ─────────────────────────────────────────────────────
// Absolute-degree tolerance on inclinaison. 3° works uniformly for
// targets from equatorial (0°) to polar (85°) and is achievable with
// 1° latitude slider steps (dI/dλ ≈ 2 near equator).
export const INCLINAISON_TOL_DEG = 3

export function featureMatchesTolerance(actual: number, target: number): boolean {
  return Math.abs(actual - target) < INCLINAISON_TOL_DEG
}

// ─── Isocline curve generator (for stage 2 target marker) ─────────
// The locus of geographic points where inclinaison = target is a circle
// on the sphere centered at the magnetic pole, at magnetic colatitude
// θ_m_target = 90° − atan(tan(target)/2).
//
// Parameterize by bearing β around the magnetic pole; recover (lat, lon).
// Returns an array of [lat, lon] points (skipping wrap-around jumps
// across the antimeridian).
export function isoclinePoints(targetInclDeg: number, alphaDeg: number, steps = 96): [number, number][] {
  // Target magnetic latitude
  const lambdaM = Math.atan(Math.tan(targetInclDeg * DEG) / 2) / DEG
  const thetaM = 90 - lambdaM  // colatitude on sphere from magnetic pole
  const latP = 90 - alphaDeg
  const pts: [number, number][] = []
  for (let i = 0; i <= steps; i++) {
    const beta = (i / steps) * 360
    // Geographic coords of a point at colatitude θ_m from magnetic pole,
    // at bearing β (measured from magnetic pole toward geographic north).
    const lat =
      Math.asin(
        Math.sin(latP * DEG) * Math.cos(thetaM * DEG) +
          Math.cos(latP * DEG) * Math.sin(thetaM * DEG) * Math.cos(beta * DEG),
      ) / DEG
    const dLon =
      Math.atan2(
        Math.sin(beta * DEG) * Math.sin(thetaM * DEG) * Math.cos(latP * DEG),
        Math.cos(thetaM * DEG) - Math.sin(latP * DEG) * Math.sin(lat * DEG),
      ) / DEG
    let lon = 0 + dLon
    // Normalize to [-180, 180]
    while (lon > 180) lon -= 360
    while (lon < -180) lon += 360
    pts.push([lat, lon])
  }
  return pts
}
