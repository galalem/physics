// ─── Physics for bar-magnet compass exercise ───────────────────────────
// This exercise is about DIRECTION only (no numeric B). The compass at
// the probe reports the direction of the ideal-dipole field there. The
// student places (mx, my) and rotates the magnet (θ_m in compass
// bearing) to align the compass with a target bearing.

// ─── Setup type ──────────────────────────────────────────────────────
export type Setup = {
  targetBearingDeg: number   // 0=N, 90=E, 180=S, 270=W
  targetLabel: string        // human-readable direction (e.g. "E", "NE")
}

// ─── Hand-authored setups — cycle by (seed + failCount) % SETUPS.length
// Each entry exercises a different bearing.
export const SETUPS: Setup[] = [
  { targetBearingDeg:  90, targetLabel: 'E' },
  { targetBearingDeg:   0, targetLabel: 'N' },
  { targetBearingDeg: 180, targetLabel: 'S' },
  { targetBearingDeg: 270, targetLabel: 'W' },
  { targetBearingDeg:  45, targetLabel: 'NE' },
  { targetBearingDeg: 135, targetLabel: 'SE' },
]

// ─── Compass-bearing tolerance ───────────────────────────────────────
// 5° absolute — well above slider step of 1° (about ~1.4% of 360°).
export const BEARING_TOL_DEG = 5

// ─── Compass-bearing helpers ─────────────────────────────────────────
export function normBearing(deg: number): number {
  return ((deg % 360) + 360) % 360
}

/** Smallest signed angular difference (a − b), wrapped to (−180, +180]. */
export function bearingDiff(a: number, b: number): number {
  const d = normBearing(a - b + 180) - 180
  return d
}

export function bearingMatchesTolerance(
  actual: number,
  target: number,
  tolDeg = BEARING_TOL_DEG,
): boolean {
  return Math.abs(bearingDiff(actual, target)) < tolDeg
}

// ─── Compass ↔ SVG angle conversion ──────────────────────────────────
// SVG angle: 0° = right (+x SVG), 90° = down (+y SVG), CCW when looking
// at the screen (following SVG's rotate() semantics).
// Compass bearing: 0° = N (up in SVG), 90° = E (right), 180° = S (down),
// 270° = W (left).
// SVG_angle = bearing − 90° (mod 360)
export function bearingToSvgAngleDeg(bearingDeg: number): number {
  return normBearing(bearingDeg - 90)
}
export function svgAngleToBearingDeg(svgDeg: number): number {
  return normBearing(svgDeg + 90)
}

// ─── Ideal-dipole field direction at probe ───────────────────────────
// Inputs are in SVG-space:
//   mxSvg, mySvg      — magnet center
//   thetaMBearingDeg  — direction (bearing) that the N pole points to
//   pxSvg, pySvg      — probe point
// Returns compass BEARING of the field at the probe.
//
// Formula (ideal dipole): B ∝ 3(m·r̂)r̂ − m, where r = p − m.
// The formula works in any Cartesian frame regardless of y sign.
export function fieldBearingAtProbe(
  mxSvg: number,
  mySvg: number,
  thetaMBearingDeg: number,
  pxSvg: number,
  pySvg: number,
): number {
  const dx = pxSvg - mxSvg
  const dy = pySvg - mySvg
  const r2 = dx * dx + dy * dy
  if (r2 < 1e-6) return 0
  const r = Math.sqrt(r2)
  const rHatX = dx / r
  const rHatY = dy / r
  const svgAngleRad = (bearingToSvgAngleDeg(thetaMBearingDeg) * Math.PI) / 180
  const mX = Math.cos(svgAngleRad)
  const mY = Math.sin(svgAngleRad)
  const mDotRHat = mX * rHatX + mY * rHatY
  const bx = 3 * mDotRHat * rHatX - mX
  const by = 3 * mDotRHat * rHatY - mY
  const svgAngleOfB = (Math.atan2(by, bx) * 180) / Math.PI
  return svgAngleToBearingDeg(svgAngleOfB)
}

/** Raw dipole vector at (pxSvg, pySvg) — for visualization (unnormalized). */
export function dipoleVectorAt(
  mxSvg: number,
  mySvg: number,
  thetaMBearingDeg: number,
  pxSvg: number,
  pySvg: number,
): { bx: number; by: number; magnitude: number } {
  const dx = pxSvg - mxSvg
  const dy = pySvg - mySvg
  const r2 = dx * dx + dy * dy
  if (r2 < 1e-6) return { bx: 0, by: 0, magnitude: 0 }
  const r = Math.sqrt(r2)
  const rHatX = dx / r
  const rHatY = dy / r
  const svgAngleRad = (bearingToSvgAngleDeg(thetaMBearingDeg) * Math.PI) / 180
  const mX = Math.cos(svgAngleRad)
  const mY = Math.sin(svgAngleRad)
  const mDotRHat = mX * rHatX + mY * rHatY
  // 1/r³ decay for dipole magnitude
  const scale = 1 / (r2 * r)
  const bx = (3 * mDotRHat * rHatX - mX) * scale
  const by = (3 * mDotRHat * rHatY - mY) * scale
  const magnitude = Math.sqrt(bx * bx + by * by)
  return { bx, by, magnitude }
}
