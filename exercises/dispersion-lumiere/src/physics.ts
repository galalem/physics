// Cauchy's dispersion formula:  n(λ) = A_c + B_c / λ_μm²   (λ in μm)
// with λ in nm we use λ_μm = λ_nm / 1000.
export function cauchyIndex(A_c: number, B_c: number, lambdaNm: number): number {
  const lambdaMicron = lambdaNm / 1000
  return A_c + B_c / (lambdaMicron * lambdaMicron)
}

// ─── Fixed prism geometry (schematic) ───────────────────────────────
export const PRISM_A_DEG = 50   // apex angle A
export const INCIDENCE_I1_DEG = 30 // fixed angle of incidence at face 1

const DEG = Math.PI / 180

export type ExitResult = {
  r1Deg: number
  r2Deg: number
  i2Deg: number
  D: number  // deviation angle (degrees), NaN if TIR
  tir: boolean
}

// Snell + geometry: for a symmetric prism (apex A) with incidence angle i₁
// on face 1, the internal ray hits face 2 at angle r₂ = A − r₁ from face-2
// normal (r₁ = arcsin(sin(i₁)/n)), and exits at i₂ where sin(i₂) = n·sin(r₂).
// Deviation D = i₁ + i₂ − A. TIR occurs when n·sin(r₂) > 1.
export function computeExit(
  n: number,
  A_deg: number = PRISM_A_DEG,
  i1Deg: number = INCIDENCE_I1_DEG,
): ExitResult {
  const i1 = i1Deg * DEG
  const A = A_deg * DEG
  const sinR1 = Math.sin(i1) / n
  const r1 = Math.asin(Math.min(1, Math.max(-1, sinR1)))
  const r2 = A - r1
  const sinI2 = n * Math.sin(r2)
  if (sinI2 > 1 || sinI2 < -1) {
    return { r1Deg: r1 / DEG, r2Deg: r2 / DEG, i2Deg: NaN, D: NaN, tir: true }
  }
  const i2 = Math.asin(sinI2)
  return {
    r1Deg: r1 / DEG,
    r2Deg: r2 / DEG,
    i2Deg: i2 / DEG,
    D: (i1 + i2 - A) / DEG,
    tir: false,
  }
}

// ─── Slider parameter ranges (module-wide constants) ────────────────
export const LAMBDA_MIN = 400  // nm
export const LAMBDA_MAX = 750  // nm
export const LAMBDA_DEFAULT = 550
export const LAMBDA_STEP = 5

export const AC_MIN = 1.45
export const AC_MAX = 1.65
export const AC_DEFAULT = 1.52
export const AC_STEP = 0.005

export const BC_MIN = 0.001
export const BC_MAX = 0.020
export const BC_DEFAULT = 0.005
export const BC_STEP = 0.0005

// ─── Hand-authored setups (seed % SETUPS.length picks one) ──────────
// targetD is the deviation angle the student must produce at Stage 2 & 3.
// Each setup targets a distinct region of the achievable D range (roughly
// 27° → 50° for the parameter box above with A=50°, i₁=30°).
export type Setup = { targetD: number }
export const SETUPS: Setup[] = [
  { targetD: 30 },  // low-index regime  (n ≈ 1.51)
  { targetD: 38 },  // moderate          (n ≈ 1.60)
  { targetD: 43 },  // moderate-strong   (n ≈ 1.66)
  { targetD: 47 },  // strong dispersion (n ≈ 1.71)
]

// ±5% relative tolerance on D (see §9.2 of the pattern brief).
export const TOLERANCE_D = 0.05
export function featureMatchesTolerance(D: number, targetD: number, tol = TOLERANCE_D): boolean {
  if (!Number.isFinite(D)) return false
  return Math.abs(D - targetD) / Math.abs(targetD) < tol
}
