// ─── Setup type ──────────────────────────────────────────────
export type Setup = {
  // Stage 2 target: field magnitude at the probe point, in kV/m.
  targetE_kVm: number
  // Stage 3 target: force magnitude on the test charge, in μN.
  targetF_uN: number
}

// ─── Hand-authored setups (seed-indexed) ─────────────────────
// Each entry probes a different regime of (U, d, q). Every target is
// reachable within slider ranges: U ∈ [50, 500] V, d ∈ [0.5, 5] cm,
// q ∈ [1, 20] nC. Sample solutions in comments.
export const SETUPS: Setup[] = [
  // U=200V, d=2cm → E=10 kV/m; q=5nC, F=50μN
  { targetE_kVm: 10, targetF_uN: 50 },
  // U=300V, d=1.5cm → E=20 kV/m; q=3nC, F=60μN
  { targetE_kVm: 20, targetF_uN: 60 },
  // U=250V, d=5cm → E=5 kV/m; q=8nC, F=40μN
  { targetE_kVm: 5, targetF_uN: 40 },
  // U=450V, d=3cm → E=15 kV/m; q=10nC, F=150μN
  { targetE_kVm: 15, targetF_uN: 150 },
  // U=400V, d=1cm → E=40 kV/m; q=2nC, F=80μN
  { targetE_kVm: 40, targetF_uN: 80 },
  // U=100V, d=4cm → E=2.5 kV/m; q=12nC, F=30μN
  { targetE_kVm: 2.5, targetF_uN: 30 },
]

// ─── Closed-form formulas ────────────────────────────────────
/** Uniform field magnitude between parallel plates. U in V, d in cm → V/m. */
export function fieldMagnitudeVm(U_V: number, d_cm: number): number {
  return U_V / (d_cm * 1e-2)
}

/** Force on test charge in μN. q in nC, E in V/m. F = qE. */
export function forceMagnitudeUN(q_nC: number, E_Vm: number): number {
  return q_nC * 1e-9 * E_Vm * 1e6
}

// ─── Tolerance check ─────────────────────────────────────────
const TOL = 0.05 // ±5% relative — Family B convention per pattern brief §9.2
export function withinTol(actual: number, target: number, tol = TOL): boolean {
  if (target === 0) return false
  return Math.abs(actual - target) / Math.abs(target) < tol
}

// ─── Formatters ──────────────────────────────────────────────
export function formatE(vm: number): string {
  const kVm = vm / 1000
  if (kVm >= 100) return `${kVm.toFixed(0)}kV/m`
  if (kVm >= 10) return `${kVm.toFixed(1)}kV/m`
  return `${kVm.toFixed(2)}kV/m`
}

export function formatF(uN: number): string {
  if (uN >= 100) return `${uN.toFixed(0)}μN`
  if (uN >= 10) return `${uN.toFixed(1)}μN`
  return `${uN.toFixed(2)}μN`
}
