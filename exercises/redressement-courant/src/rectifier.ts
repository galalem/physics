// ─── Rectifier + filter simulation ──────────────────────────────────────
//
// Idealized diode: cuts off below V_DIODE (0.6 V) forward voltage.
//   Half-wave  : one diode         → drop = V_D    → v_out = max(0, v_in − V_D)
//   Full-wave  : bridge of 4       → drop = 2·V_D  → v_out = max(0, |v_in| − 2·V_D)
//
// Filter capacitor C in parallel with load R:
//   Cap charges to peak, discharges through R with τ = R·C between peaks.
//   Ripple frequency:   half-wave = F_MAINS,   full-wave = 2·F_MAINS.
//   Approximate ripple ΔU ≈ V_peak / (f_ripple · R · C) when R·C ≫ 1/f_ripple.
//
// Test vectors (checked against §9 identities):
//   simulate({rect:'half',   filter:'wire', U_max:20, R:1000, C_uf:0}) →
//     U_avg ≈ (20−0.6)/π ≈ 6.17 V, U_ripple ≈ 19.4 V
//   simulate({rect:'bridge', filter:'wire', U_max:20, R:1000, C_uf:0}) →
//     U_avg ≈ 2·(20−1.2)/π ≈ 11.97 V, U_ripple ≈ 18.8 V
//   simulate({rect:'bridge', filter:'cap',  U_max:20, R:1000, C_uf:470}) →
//     τ = 0.47 s ≫ T/2 = 0.01 s → U_avg ≈ 18.6 V, U_ripple ≈ 0.4 V
// ─────────────────────────────────────────────────────────────────────────

export const F_MAINS = 50 // Hz
export const V_DIODE = 0.6 // V

export type Rect = 'half' | 'bridge' | 'none'
export type Filter = 'cap' | 'wire'

export type SimParams = {
  rect: Rect
  filter: Filter
  U_max: number // V
  R: number // Ω
  C_uf: number // µF (used only when filter === 'cap')
}

export type SimResult = {
  U_avg: number // V
  U_ripple: number // V, peak-to-peak
  samples: number[] // v_out values
  times: number[] // ms
  windowMs: number // total time span of samples
}

const N = 480 // sample count over the observation window
const PERIODS = 2 // observation window in mains periods

function rectifiedInput(rect: Rect, U_max: number, omegaT: number): number {
  const v_ac = U_max * Math.sin(omegaT)
  if (rect === 'none') return v_ac
  if (rect === 'half') return Math.max(0, v_ac - V_DIODE)
  // bridge: full-wave
  return Math.max(0, Math.abs(v_ac) - 2 * V_DIODE)
}

export function simulate(p: SimParams): SimResult {
  const T = 1 / F_MAINS
  const totalSec = PERIODS * T
  const dt = totalSec / N
  const omega = 2 * Math.PI * F_MAINS

  const times: number[] = []
  const samples: number[] = []

  if (p.filter === 'wire' || p.rect === 'none') {
    for (let i = 0; i < N; i++) {
      const t = i * dt
      times.push(t * 1000)
      samples.push(rectifiedInput(p.rect, p.U_max, omega * t))
    }
  } else {
    // Capacitor smoothing — warm to steady state before sampling.
    const C = p.C_uf * 1e-6
    const tau = Math.max(1e-6, p.R * C)
    let V = p.U_max
    const warm = 4 * T
    let t = -warm
    while (t < 0) {
      const v_in = rectifiedInput(p.rect, p.U_max, omega * t)
      if (v_in > V) V = v_in
      else V = V * Math.exp(-dt / tau)
      t += dt
    }
    for (let i = 0; i < N; i++) {
      t = i * dt
      const v_in = rectifiedInput(p.rect, p.U_max, omega * t)
      if (v_in > V) V = v_in
      else V = V * Math.exp(-dt / tau)
      times.push(t * 1000)
      samples.push(V)
    }
  }

  // Compute avg / ripple over the last full period only, to avoid the
  // half-warm first-period sag on ripple estimates.
  const startIdx = Math.floor(N / 2)
  const stable = samples.slice(startIdx)
  const U_avg = stable.reduce((s, v) => s + v, 0) / stable.length
  const U_ripple = Math.max(...stable) - Math.min(...stable)

  return { U_avg, U_ripple, samples, times, windowMs: totalSec * 1000 }
}

// Classification helpers used by stage-1 coverage checks and stage-2 target hits.
export function tolerance(target: number, value: number, tol = 0.1): boolean {
  if (target === 0) return Math.abs(value) < tol
  return Math.abs(value - target) / Math.abs(target) < tol
}
