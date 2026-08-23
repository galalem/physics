// Wave reflection at a straight barrier.
//
// Screen convention: +x right, +y down, angles measured clockwise from +x
// (so a wave propagating "down-right" has a positive angle).
//
// Setup (see Scene.tsx for the SVG layout):
//   - Barrier pivots at a fixed point. Its surface tilts by αDeg from
//     vertical (positive = top leans right on screen).
//   - Barrier normal (source-side) has angle 180° + αDeg from +x.
//   - Incident wave propagates from the source side into the barrier at
//     angle iDeg from +x (in [20°, 70°] → wave comes from upper-left).
//
// Reflected propagation direction (world frame):
//   θ_out = 180° + 2·αDeg − iDeg  (mod 360°)
//
// Derivation: standard reflection formula d' = d − 2(d·n)n gives an angle
// of reflection equal to angle of incidence measured from the normal. In
// world frame this collapses to the closed form above.

export type Setup = {
  /** Target reflected direction, degrees from +x axis on screen. */
  targetOutDeg: number
}

/** Hand-authored setups — one is picked by (seed + failCount) % SETUPS.length. */
export const SETUPS: Setup[] = [
  { targetOutDeg: 100 },
  { targetOutDeg: 120 },
  { targetOutDeg: 145 },
  { targetOutDeg: 165 },
]

/** Reflected propagation direction (deg, [0, 360)) given sliders. */
export function reflectedAngleDeg(iDeg: number, alphaDeg: number): number {
  const r = 180 + 2 * alphaDeg - iDeg
  return ((r % 360) + 360) % 360
}

/** Absolute tolerance on the reflected direction (degrees). */
export const TOLERANCE_DEG = 5

/** Angular closeness on a circle (handles wrap). */
export function withinTolerance(actualDeg: number, targetDeg: number): boolean {
  const d = Math.abs(((actualDeg - targetDeg + 540) % 360) - 180)
  return d < TOLERANCE_DEG
}
