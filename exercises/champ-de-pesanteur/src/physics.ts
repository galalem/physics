// ─── Constants ──────────────────────────────────────────────────────────
export const G = 6.674e-11 // N·m²/kg²
export const M_EARTH = 5.972e24 // kg
export const R_EARTH_M = 6.4e6 // m — baked per spec ("R_Earth = 6400 km")
export const R_EARTH_KM = 6400 // km
export const G_0 = (G * M_EARTH) / (R_EARTH_M * R_EARTH_M) // ≈ 9.73 N/kg (with R=6400km)

// ─── DOF ranges ─────────────────────────────────────────────────────────
export const M_MIN = 0.1 // Earth masses
export const M_MAX = 10.0
export const M_DEFAULT = 1.0
export const M_STEP = 0.1

export const H_MIN = 0 // km
export const H_MAX = 20000
export const H_DEFAULT = 0
export const H_STEP = 50

// ─── Formula ────────────────────────────────────────────────────────────
/** g(h, M) = G·M/(R+h)², with M in Earth masses and h in km. Returns N/kg. */
export function gField(mEarthMasses: number, hKm: number): number {
  const M = mEarthMasses * M_EARTH
  const r = R_EARTH_M + hKm * 1000
  return (G * M) / (r * r)
}

/** Inverse: altitude (km) such that g(h, M) = gTarget. */
export function altitudeForG(mEarthMasses: number, gTarget: number): number {
  const M = mEarthMasses * M_EARTH
  const r = Math.sqrt((G * M) / gTarget)
  return (r - R_EARTH_M) / 1000
}

// ─── Setup type ─────────────────────────────────────────────────────────
export type Setup = {
  /** Planet mass in Earth masses (student must set M slider here). */
  mStar: number
  /** Target g at the altitude the student must find. */
  gStar: number
}

// Hand-authored setups (never RNG-generated). Each one probes a distinct
// physical regime (near-surface, high orbit, weak / massive planet, etc.).
// Chosen so that the solution h lands cleanly on the slider grid (step 50 km).
export const SETUPS: Setup[] = [
  // M=1, h≈2038 km → g = G·M_E / (R+h)² ≈ 5.6 N/kg. Earth, low satellite.
  { mStar: 1.0, gStar: 5.6 },
  // M=2, h≈8086 km → 3.8 N/kg. Twice-Earth planet, mid orbit.
  { mStar: 2.0, gStar: 3.8 },
  // M=0.5, h≈489 km → 4.2 N/kg. Small planet, near surface.
  { mStar: 0.5, gStar: 4.2 },
  // M=3, h≈5001 km → 9.2 N/kg. Massive planet, moderate orbit.
  { mStar: 3.0, gStar: 9.2 },
]

// ─── Tolerance check ────────────────────────────────────────────────────
export const TOL_M_REL = 0.05 // ±5% on M
export const TOL_G_REL = 0.05 // ±5% on g

export function featureMatchesTolerance(
  mCurrent: number,
  hCurrent: number,
  setup: Setup,
): boolean {
  const gCurrent = gField(mCurrent, hCurrent)
  const mErr = Math.abs(mCurrent - setup.mStar) / setup.mStar
  const gErr = Math.abs(gCurrent - setup.gStar) / setup.gStar
  return mErr < TOL_M_REL && gErr < TOL_G_REL
}
