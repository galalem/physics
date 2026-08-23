import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  useComplete,
  useCurrentStage,
  useDeclareStages,
  useHint,
  useInit,
  useNext,
  usePeek,
  useProgress,
  useReset,
  useSeed,
  useSetStage,
  useTicker,
} from '@physics/sdk/react'
import { getHintFor, getStagesFor } from './stages'
import en from '../i18n/en.json'
import fr from '../i18n/fr.json'
import ar from '../i18n/ar.json'

// ─── Scene constants ────────────────────────────────────────────────────
const W = 800
const H = 450

// Left panel: circuit schematic
const SCH_X = 32
const SCH_Y = 60
const SCH_W = 360
const SCH_H = 350

// Right panel: u_C(t) time-series plot
const PLOT_X = 412
const PLOT_Y = 60
const PLOT_W = 250
const PLOT_H = 350

// ─── Physics constants ─────────────────────────────────────────────────
const E = 6 // V — initial capacitor charge
const L = 0.1 // H (fixed, displayed as "L = 100 mH")

// C log slider: 10 µF to 500 µF
const C_MIN = 10e-6
const C_MAX = 500e-6
const C_DEFAULT = 100e-6

// R log slider: 5 Ω to 200 Ω
const R_MIN = 5
const R_MAX = 200
const R_DEFAULT = 30

// Simulation window
const T_SIM_MAX = 0.1 // seconds of simulated physical time (100 ms)
// Wall-clock pacing: 5 s of animation = full sim window
const TIME_SCALE = 0.02 // simTime = animTime * TIME_SCALE

// Tolerances (on invariants T0 and lambda)
const STAGE2_TOL = 0.05
const STAGE3_TOL = 0.03

// Sampling density for closed-form curves (points along t ∈ [0, T_SIM_MAX])
const SAMPLE_STEPS = 200

// ─── Seeded targets ─────────────────────────────────────────────────
// Stage 2: (R*, C*) pairs — all under-damped, spread across T0 and lambda space
const STAGE2_TARGETS: { rStar: number; cStar: number }[] = [
  { rStar: 20, cStar: 200e-6 }, // T0=28.1ms, λ=100
  { rStar: 50, cStar: 100e-6 }, // T0=19.9ms, λ=250
  { rStar: 15, cStar: 400e-6 }, // T0=39.7ms, λ=75
  { rStar: 40, cStar: 50e-6 }, // T0=14.0ms, λ=200
  { rStar: 25, cStar: 150e-6 }, // T0=24.3ms, λ=125
]

// Stage 3: (R*, C*) pairs — all under-damped, distinct pedagogical cases
const STAGE3_TARGETS: { rStar: number; cStar: number }[] = [
  { rStar: 30, cStar: 250e-6 }, // T0=31.4ms, λ=150
  { rStar: 20, cStar: 100e-6 }, // T0=19.9ms, λ=100
  { rStar: 45, cStar: 200e-6 }, // T0=28.1ms, λ=225
  { rStar: 10, cStar: 500e-6 }, // T0=44.4ms, λ=50
  { rStar: 35, cStar: 150e-6 }, // T0=24.3ms, λ=175
]

// ─── Physics helpers ────────────────────────────────────────────────────
type Regime = 'under' | 'critical' | 'over'

interface RlcModel {
  regime: Regime
  omega0: number // rad/s
  lambda: number // decay rate 1/s
  omega1: number // damped angular frequency (under-damped only)
  T0: number // undamped period 2π√(LC)
  T1: number // pseudo-period (under-damped); else NaN
  Rc: number // critical resistance
}

function computeModel(r: number, c: number): RlcModel {
  const omega0 = 1 / Math.sqrt(L * c)
  const lambda = r / (2 * L)
  const Rc = 2 * Math.sqrt(L / c)
  const T0 = 2 * Math.PI * Math.sqrt(L * c)
  const disc = lambda * lambda - omega0 * omega0
  if (disc < -1e-3 * omega0 * omega0) {
    const omega1 = Math.sqrt(omega0 * omega0 - lambda * lambda)
    return {
      regime: 'under',
      omega0,
      lambda,
      omega1,
      T0,
      T1: (2 * Math.PI) / omega1,
      Rc,
    }
  }
  if (disc > 1e-3 * omega0 * omega0) {
    return { regime: 'over', omega0, lambda, omega1: 0, T0, T1: NaN, Rc }
  }
  return { regime: 'critical', omega0, lambda, omega1: 0, T0, T1: NaN, Rc }
}

/** Closed-form u_C(t) given initial u_C(0)=E, i(0)=0. */
function uCat(t: number, m: RlcModel): number {
  if (m.regime === 'under') {
    // u_C(t) = E * e^(-λt) * [cos(ω₁t) + (λ/ω₁) sin(ω₁t)]
    const decay = Math.exp(-m.lambda * t)
    return E * decay * (Math.cos(m.omega1 * t) + (m.lambda / m.omega1) * Math.sin(m.omega1 * t))
  }
  if (m.regime === 'critical') {
    // u_C(t) = E * (1 + λt) * e^(-λt)
    return E * (1 + m.lambda * t) * Math.exp(-m.lambda * t)
  }
  // Over-damped: u_C(t) = E * (r2 e^(r1 t) − r1 e^(r2 t)) / (r2 − r1)
  const s = Math.sqrt(m.lambda * m.lambda - m.omega0 * m.omega0)
  const r1 = -m.lambda + s
  const r2 = -m.lambda - s
  return (E * (r2 * Math.exp(r1 * t) - r1 * Math.exp(r2 * t))) / (r2 - r1)
}

/** Format helpers */
function formatT(seconds: number): string {
  if (!isFinite(seconds)) return '—'
  return `${(seconds * 1000).toFixed(1)} ms`
}
function formatLambda(l: number): string {
  return `${l.toFixed(0)} s⁻¹`
}
function formatR(r: number): string {
  if (r >= 1000) return `${(r / 1000).toFixed(1)} kΩ`
  return `${r.toFixed(r < 10 ? 1 : 0)} Ω`
}
function formatC(c: number): string {
  return `${(c * 1e6).toFixed(0)} µF`
}

// ─── Log-slider mapping ─────────────────────────────────────────────────
function toLog(value: number, min: number, max: number): number {
  return (Math.log(value) - Math.log(min)) / (Math.log(max) - Math.log(min))
}
function fromLog(pos: number, min: number, max: number): number {
  return min * Math.pow(max / min, pos)
}

// ─── Plot coordinates ───────────────────────────────────────────────────
const Y_MAX = 1.05 * E // symmetric axis −Y_MAX..Y_MAX
function tToSvgX(t: number): number {
  return PLOT_X + (t / T_SIM_MAX) * PLOT_W
}
function ucToSvgY(uc: number): number {
  const clamped = Math.max(-Y_MAX, Math.min(Y_MAX, uc))
  return PLOT_Y + PLOT_H / 2 - (clamped / Y_MAX) * (PLOT_H / 2)
}

/** Pre-compute samples of u_C(t) over the full sim window for a given (R, C). */
function samplesFor(r: number, c: number): number[] {
  const m = computeModel(r, c)
  const arr = new Array<number>(SAMPLE_STEPS + 1)
  for (let i = 0; i <= SAMPLE_STEPS; i++) {
    const t = (i / SAMPLE_STEPS) * T_SIM_MAX
    arr[i] = uCat(t, m)
  }
  return arr
}

/** Build an SVG path from a samples array, truncated to t ≤ tCap. */
function pathFromSamples(samples: number[], tCap: number): string {
  const cap = Math.min(SAMPLE_STEPS, Math.floor((tCap / T_SIM_MAX) * SAMPLE_STEPS))
  if (cap < 1) return ''
  let d = ''
  for (let i = 0; i <= cap; i++) {
    const t = (i / SAMPLE_STEPS) * T_SIM_MAX
    const sx = tToSvgX(t)
    const sy = ucToSvgY(samples[i]!)
    d += `${i === 0 ? 'M' : 'L'} ${sx.toFixed(1)} ${sy.toFixed(1)} `
  }
  return d
}

// ─── i18n dict ──────────────────────────────────────────────────────────
const dict = { en, fr, ar } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── Inline art components ──────────────────────────────────────────────
function Resistor({ x, y, orient = 'h' }: { x: number; y: number; orient?: 'h' | 'v' }) {
  const w = 44
  const h = 12
  const stroke = '#B9C4D6'
  const pts: string[] = []
  if (orient === 'h') {
    const x0 = x - w / 2
    pts.push(`M ${x0} ${y}`)
    const seg = w / 7
    for (let i = 1; i <= 6; i++) {
      const px = x0 + i * seg
      const py = y + (i % 2 === 1 ? -h : h)
      pts.push(`L ${px} ${py}`)
    }
    pts.push(`L ${x + w / 2} ${y}`)
  } else {
    const y0 = y - w / 2
    pts.push(`M ${x} ${y0}`)
    const seg = w / 7
    for (let i = 1; i <= 6; i++) {
      const py = y0 + i * seg
      const px = x + (i % 2 === 1 ? -h : h)
      pts.push(`L ${px} ${py}`)
    }
    pts.push(`L ${x} ${y + w / 2}`)
  }
  return <path d={pts.join(' ')} fill="none" stroke={stroke} strokeWidth={2} strokeLinejoin="miter" />
}

/** Coil (inductor) — 4 loops. */
function Coil({ x, y, orient = 'h' }: { x: number; y: number; orient?: 'h' | 'v' }) {
  const w = 56 // total length along axis
  const r = 7 // loop radius
  const loops = 4
  const stroke = '#B9C4D6'
  const parts: React.ReactNode[] = []
  if (orient === 'h') {
    const x0 = x - w / 2
    for (let i = 0; i < loops; i++) {
      const cx = x0 + (w / loops) * (i + 0.5)
      parts.push(
        <path
          key={i}
          d={`M ${cx - r} ${y} A ${r} ${r} 0 0 1 ${cx + r} ${y}`}
          fill="none"
          stroke={stroke}
          strokeWidth={2}
        />,
      )
    }
    parts.push(<line key="l0" x1={x - w / 2 - 2} y1={y} x2={x - w / 2} y2={y} stroke={stroke} strokeWidth={2} />)
    parts.push(<line key="l1" x1={x + w / 2} y1={y} x2={x + w / 2 + 2} y2={y} stroke={stroke} strokeWidth={2} />)
  } else {
    const y0 = y - w / 2
    for (let i = 0; i < loops; i++) {
      const cy = y0 + (w / loops) * (i + 0.5)
      parts.push(
        <path
          key={i}
          d={`M ${x} ${cy - r} A ${r} ${r} 0 0 1 ${x} ${cy + r}`}
          fill="none"
          stroke={stroke}
          strokeWidth={2}
        />,
      )
    }
    parts.push(<line key="l0" x1={x} y1={y - w / 2 - 2} x2={x} y2={y - w / 2} stroke={stroke} strokeWidth={2} />)
    parts.push(<line key="l1" x1={x} y1={y + w / 2} x2={x} y2={y + w / 2 + 2} stroke={stroke} strokeWidth={2} />)
  }
  return <g>{parts}</g>
}

/** Capacitor — two parallel plates, drawn on a vertical wire, with fill indicator. */
function CapacitorV({ x, y, chargeRatio }: { x: number; y: number; chargeRatio: number }) {
  const plateGap = 8
  const plateW = 30
  const stroke = '#B9C4D6'
  const fill = Math.max(-1, Math.min(1, chargeRatio))
  const activeColor = fill > 0.02 ? '#37C9B8' : fill < -0.02 ? '#F97316' : stroke
  return (
    <g>
      {/* Top plate */}
      <line
        x1={x - plateW / 2}
        y1={y - plateGap / 2}
        x2={x + plateW / 2}
        y2={y - plateGap / 2}
        stroke={fill > 0.02 ? '#37C9B8' : stroke}
        strokeWidth={3}
      />
      {/* Bottom plate */}
      <line
        x1={x - plateW / 2}
        y1={y + plateGap / 2}
        x2={x + plateW / 2}
        y2={y + plateGap / 2}
        stroke={fill < -0.02 ? '#F97316' : stroke}
        strokeWidth={3}
      />
      {/* Charge dots on the currently-positive plate */}
      {Array.from({ length: 6 }).map((_, i) => {
        const active = i < Math.round(Math.abs(fill) * 6)
        const cy = fill >= 0 ? y - plateGap / 2 - 6 : y + plateGap / 2 + 6
        return (
          <circle
            key={i}
            cx={x - plateW / 2 + 4 + i * ((plateW - 8) / 5)}
            cy={cy}
            r={1.8}
            fill={active ? activeColor : '#3A4863'}
          />
        )
      })}
    </g>
  )
}

/** Switch — closed / open toggle. Horizontal, pivot at (x, y). */
function SwitchH({ x, y, closed }: { x: number; y: number; closed: boolean }) {
  const armLen = 22
  const stroke = closed ? '#37C9B8' : '#B9C4D6'
  const angle = closed ? 0 : -35
  const rad = (angle * Math.PI) / 180
  const x2 = x + armLen * Math.cos(rad)
  const y2 = y + armLen * Math.sin(rad)
  return (
    <g>
      <circle cx={x} cy={y} r={2.6} fill={stroke} />
      <circle cx={x + armLen} cy={y} r={2.6} fill={stroke} />
      <line x1={x} y1={y} x2={x2} y2={y2} stroke={stroke} strokeWidth={2.2} strokeLinecap="round" />
    </g>
  )
}

// ─── Component ──────────────────────────────────────────────────────────
export default function Scene() {
  const { locale, seed } = useInit()
  const stages = useMemo(() => getStagesFor(locale), [locale])
  useDeclareStages(stages)
  const labels = useMemo(() => svgLabels(locale), [locale])
  const rootRng = useSeed()

  const stage2Target = useMemo(() => {
    void rootRng
    return STAGE2_TARGETS[seed % STAGE2_TARGETS.length]!
  }, [seed, rootRng])

  // Stage 3 target index — rotates on wrong-submit
  const [stage3Rot, setStage3Rot] = useState(0)
  const stage3Target = useMemo(
    () => STAGE3_TARGETS[(seed + 1 + stage3Rot) % STAGE3_TARGETS.length]!,
    [seed, stage3Rot],
  )

  const stageIdx = useCurrentStage()
  const setStage = useSetStage()
  const progress = useProgress()
  const complete = useComplete()

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  // ─── Live physical state ────────────────────────────────────────────
  const [R, setR] = useState(R_DEFAULT)
  const [C, setC] = useState(C_DEFAULT)
  const [closed, setClosed] = useState(false)
  const [tSim, setTSim] = useState(0)
  const [rMoved, setRMoved] = useState(false)
  const [cMoved, setCMoved] = useState(false)
  const [fullCycle, setFullCycle] = useState(false)
  const [stage2Hit, setStage2Hit] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [peekVisible, setPeekVisible] = useState(false)
  const [showFail, setShowFail] = useState(false)

  // Live model of current (R, C)
  const model = useMemo(() => computeModel(R, C), [R, C])
  // Target model (stage 3)
  const targetModel = useMemo(
    () => computeModel(stage3Target.rStar, stage3Target.cStar),
    [stage3Target],
  )
  const stage2TargetModel = useMemo(
    () => computeModel(stage2Target.rStar, stage2Target.cStar),
    [stage2Target],
  )

  // Current instantaneous u_C for cap visualization
  const uCNow = useMemo(() => (closed ? uCat(tSim, model) : E), [tSim, model, closed])

  const resetStageState = useCallback(() => {
    setR(R_DEFAULT)
    setC(C_DEFAULT)
    setClosed(false)
    setTSim(0)
    setRMoved(false)
    setCMoved(false)
    setFullCycle(false)
    setStage2Hit(false)
    setSubmitted(false)
    setPeekVisible(false)
    setShowFail(false)
  }, [])
  useReset(resetStageState)

  // Auto-close switch on entering stage 2 (target-matching, no need to fiddle)
  useEffect(() => {
    if (isStage2 && !closed) {
      setClosed(true)
    }
  }, [isStage2, closed])

  // Advance simulation clock. For stage 3, only tick after SUBMIT.
  useTicker((dt) => {
    if (isStage3 && !submitted) return
    if (!closed && !isStage3) return
    if (tSim >= T_SIM_MAX) return
    setTSim((prev) => {
      const nxt = Math.min(prev + dt * TIME_SCALE, T_SIM_MAX)
      // Stage-1 full-cycle detection: reached end of sim window
      if (isStage1 && nxt >= T_SIM_MAX * 0.98) setFullCycle(true)
      return nxt
    })
  })

  // Stage-2 hit detection: match both T and λ within STAGE2_TOL
  const stage2Match = useMemo(() => {
    if (!isStage2) return false
    if (model.regime !== 'under') return false
    const dT = Math.abs(model.T0 - stage2TargetModel.T0) / stage2TargetModel.T0
    const dL = Math.abs(model.lambda - stage2TargetModel.lambda) / stage2TargetModel.lambda
    return dT < STAGE2_TOL && dL < STAGE2_TOL
  }, [isStage2, model, stage2TargetModel])
  useEffect(() => {
    if (stage2Match && !stage2Hit) setStage2Hit(true)
  }, [stage2Match, stage2Hit])

  // Stage-3 grade (only meaningful after submit)
  const stage3Score = useMemo(() => {
    const dT = Math.abs(model.T0 - targetModel.T0) / targetModel.T0
    const dL = Math.abs(model.lambda - targetModel.lambda) / targetModel.lambda
    return { dT, dL, pass: dT < STAGE3_TOL && dL < STAGE3_TOL }
  }, [model, targetModel])

  const canSubmit = isStage1
    ? rMoved && cMoved && fullCycle
    : isStage2
      ? stage2Hit
      : submitted && stage3Score.pass

  useEffect(() => {
    progress(stageIdx / 3, { stage: stageIdx, canSubmit })
  }, [stageIdx, canSubmit, progress])

  useNext(() => {
    if (stageIdx < 3) {
      setStage(stageIdx + 1)
      resetStageState()
    } else {
      complete({ success: true })
    }
  })

  // Peek: reading-method hint only — NO answer reveal
  usePeek(() => {
    if (!isStage3) return
    setPeekVisible(true)
  })
  useEffect(() => {
    if (!peekVisible) return
    const t = setTimeout(() => setPeekVisible(false), 6000)
    return () => clearTimeout(t)
  }, [peekVisible])

  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  // Stage-3 SUBMIT: close switch, reset sim to 0, start ticker
  const submitStage3 = useCallback(() => {
    setSubmitted(true)
    setClosed(true)
    setTSim(0)
  }, [])

  // On fail (post-submit, sim done, not passed): show fail badge for 2s then rotate target
  useEffect(() => {
    if (!isStage3) return
    if (!submitted) return
    if (tSim < T_SIM_MAX) return
    if (stage3Score.pass) return
    setShowFail(true)
    const t = setTimeout(() => {
      setShowFail(false)
      setStage3Rot((r) => r + 1)
      setR(R_DEFAULT)
      setC(C_DEFAULT)
      setClosed(false)
      setTSim(0)
      setSubmitted(false)
    }, 2000)
    return () => clearTimeout(t)
  }, [isStage3, submitted, tSim, stage3Score.pass])

  // ─── Pre-computed sample arrays ─────────────────────────────────────
  const liveSamples = useMemo(() => samplesFor(R, C), [R, C])
  const stage2TargetSamples = useMemo(
    () => samplesFor(stage2Target.rStar, stage2Target.cStar),
    [stage2Target],
  )
  const stage3TargetSamples = useMemo(
    () => samplesFor(stage3Target.rStar, stage3Target.cStar),
    [stage3Target],
  )

  // Target curves always drawn in full
  const stage2TargetPath = useMemo(
    () => (isStage2 ? pathFromSamples(stage2TargetSamples, T_SIM_MAX) : ''),
    [isStage2, stage2TargetSamples],
  )
  const stage3TargetPath = useMemo(
    () => (isStage3 ? pathFromSamples(stage3TargetSamples, T_SIM_MAX) : ''),
    [isStage3, stage3TargetSamples],
  )
  // Live curve: hidden on stage 3 pre-submit
  const livePath = useMemo(() => {
    if (isStage3 && !submitted) return ''
    return pathFromSamples(liveSamples, tSim)
  }, [liveSamples, tSim, isStage3, submitted])

  // Stage-1 envelope (help — removed on stage 3)
  const envUpperPath = useMemo(() => {
    if (!isStage1) return ''
    if (model.regime !== 'under') return ''
    let d = ''
    for (let i = 0; i <= 60; i++) {
      const t = (i / 60) * T_SIM_MAX
      const y = E * Math.exp(-model.lambda * t)
      d += `${i === 0 ? 'M' : 'L'} ${tToSvgX(t).toFixed(1)} ${ucToSvgY(y).toFixed(1)} `
    }
    return d
  }, [isStage1, model])
  const envLowerPath = useMemo(() => {
    if (!isStage1) return ''
    if (model.regime !== 'under') return ''
    let d = ''
    for (let i = 0; i <= 60; i++) {
      const t = (i / 60) * T_SIM_MAX
      const y = -E * Math.exp(-model.lambda * t)
      d += `${i === 0 ? 'M' : 'L'} ${tToSvgX(t).toFixed(1)} ${ucToSvgY(y).toFixed(1)} `
    }
    return d
  }, [isStage1, model])

  // ─── Circuit schematic geometry ─────────────────────────────────────
  const rect = {
    left: SCH_X + 40,
    right: SCH_X + SCH_W - 40,
    top: SCH_Y + 80,
    bottom: SCH_Y + SCH_H - 80,
  }
  const topMid = (rect.left + rect.right) / 2
  const midY = (rect.top + rect.bottom) / 2

  // Component positions
  const switchPivot = { x: topMid - 24, y: rect.top }
  const capPos = { x: rect.left, y: midY }
  const coilPos = { x: topMid, y: rect.bottom }
  const resistorPos = { x: rect.right, y: midY }

  // ─── Plot grid ──────────────────────────────────────────────────────
  const plotGrid: React.ReactNode[] = []
  for (let i = 1; i < 5; i++) {
    const gx = PLOT_X + (i / 5) * PLOT_W
    plotGrid.push(
      <line key={`vx${i}`} x1={gx} y1={PLOT_Y} x2={gx} y2={PLOT_Y + PLOT_H} stroke="#12203a" strokeWidth={1} />,
    )
  }
  for (let i = 1; i < 5; i++) {
    const gy = PLOT_Y + (i / 5) * PLOT_H
    plotGrid.push(
      <line key={`gy${i}`} x1={PLOT_X} y1={gy} x2={PLOT_X + PLOT_W} y2={gy} stroke="#12203a" strokeWidth={1} />,
    )
  }

  // ─── HUD text ────────────────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`

  // TR: required-info readout — always show current invariants (student needs to align paper math)
  const regimeLabel =
    model.regime === 'under'
      ? labels.regime_under
      : model.regime === 'critical'
        ? labels.regime_critical
        : labels.regime_over
  const hudTR =
    model.regime === 'under'
      ? `T = ${formatT(model.T0)} · λ = ${formatLambda(model.lambda)}`
      : `${regimeLabel} · R_c = ${formatR(model.Rc)}`

  const hudBL = isStage1 ? labels.tip1 : isStage2 ? labels.tip2 : labels.tip3
  // No BR overlay — reserved for parent chrome.

  const cycleSwitch = useCallback(() => {
    if (isStage3) return
    setClosed((prev) => {
      if (!prev) {
        // closing → reset sim
        setTSim(0)
      }
      return !prev
    })
  }, [isStage3])

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block', userSelect: 'none' }}
      >
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        {/* ─── Left panel: circuit schematic ────────────────────────── */}
        <rect
          x={SCH_X - 8}
          y={SCH_Y - 8}
          width={SCH_W + 16}
          height={SCH_H + 16}
          fill="none"
          stroke="#12203a"
          strokeWidth={1}
          rx={6}
        />
        <text
          x={SCH_X}
          y={SCH_Y - 14}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={11}
          letterSpacing="0.1em"
        >
          {labels.circuit}
        </text>

        {/* Loop wires (drawn under components) */}
        {/* Top rail: left corner → switch left, switch right → resistor top */}
        <line x1={rect.left} y1={rect.top} x2={switchPivot.x} y2={rect.top} stroke="#54617A" strokeWidth={1.6} />
        <line
          x1={switchPivot.x + 22}
          y1={rect.top}
          x2={rect.right}
          y2={rect.top}
          stroke="#54617A"
          strokeWidth={1.6}
        />
        {/* Left vertical: cap sits mid-way */}
        <line x1={rect.left} y1={rect.top} x2={rect.left} y2={capPos.y - 8} stroke="#54617A" strokeWidth={1.6} />
        <line
          x1={rect.left}
          y1={capPos.y + 8}
          x2={rect.left}
          y2={rect.bottom}
          stroke="#54617A"
          strokeWidth={1.6}
        />
        {/* Right vertical: resistor sits mid-way */}
        <line
          x1={rect.right}
          y1={rect.top}
          x2={rect.right}
          y2={resistorPos.y - 22}
          stroke="#54617A"
          strokeWidth={1.6}
        />
        <line
          x1={rect.right}
          y1={resistorPos.y + 22}
          x2={rect.right}
          y2={rect.bottom}
          stroke="#54617A"
          strokeWidth={1.6}
        />
        {/* Bottom rail: coil sits mid-way */}
        <line
          x1={rect.left}
          y1={rect.bottom}
          x2={coilPos.x - 28}
          y2={rect.bottom}
          stroke="#54617A"
          strokeWidth={1.6}
        />
        <line
          x1={coilPos.x + 28}
          y1={rect.bottom}
          x2={rect.right}
          y2={rect.bottom}
          stroke="#54617A"
          strokeWidth={1.6}
        />

        {/* Components */}
        <CapacitorV x={capPos.x} y={capPos.y} chargeRatio={uCNow / E} />
        <text
          x={capPos.x - 24}
          y={capPos.y + 4}
          fill="#F9A968"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={12}
          textAnchor="end"
        >
          {labels.capacitor} = {formatC(C)}
        </text>
        <Coil x={coilPos.x} y={coilPos.y} orient="h" />
        <text
          x={coilPos.x}
          y={coilPos.y + 22}
          fill="#F9A968"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={12}
          textAnchor="middle"
        >
          {labels.coil} = 100 mH
        </text>
        <Resistor x={resistorPos.x} y={resistorPos.y} orient="v" />
        <text
          x={resistorPos.x + 18}
          y={resistorPos.y + 4}
          fill="#F9A968"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={12}
        >
          {labels.resistor} = {formatR(R)}
        </text>

        {/* Switch (top rail center-left) */}
        <g onClick={cycleSwitch} style={{ cursor: isStage3 ? 'default' : 'pointer' }}>
          <rect
            x={switchPivot.x - 8}
            y={switchPivot.y - 22}
            width={40}
            height={30}
            fill="transparent"
          />
          <SwitchH x={switchPivot.x} y={switchPivot.y} closed={closed} />
        </g>
        <text
          x={switchPivot.x + 11}
          y={switchPivot.y - 8}
          fill="#54617A"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={10}
          textAnchor="middle"
        >
          K
        </text>
        {!closed && !isStage3 && (
          <text
            x={switchPivot.x + 11}
            y={rect.top - 26}
            fill="#54617A"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={10}
            textAnchor="middle"
          >
            {labels.close_switch}
          </text>
        )}

        {/* ─── Right panel: u_C(t) plot ───────────────────────────────── */}
        <rect
          x={PLOT_X - 8}
          y={PLOT_Y - 8}
          width={PLOT_W + 16}
          height={PLOT_H + 16}
          fill="none"
          stroke="#12203a"
          strokeWidth={1}
          rx={6}
        />
        <text
          x={PLOT_X}
          y={PLOT_Y - 14}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={11}
          letterSpacing="0.1em"
        >
          u_C (t)
        </text>
        {plotGrid}
        {/* Zero line (bold, since axis is symmetric) */}
        <line
          x1={PLOT_X}
          y1={PLOT_Y + PLOT_H / 2}
          x2={PLOT_X + PLOT_W}
          y2={PLOT_Y + PLOT_H / 2}
          stroke="#3A4863"
          strokeWidth={1.5}
        />
        <line x1={PLOT_X} y1={PLOT_Y} x2={PLOT_X} y2={PLOT_Y + PLOT_H} stroke="#3A4863" strokeWidth={1.5} />
        <text
          x={PLOT_X + PLOT_W - 6}
          y={PLOT_Y + PLOT_H + 18}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={10}
          textAnchor="end"
        >
          t (ms) →
        </text>
        <text
          transform={`rotate(-90 ${PLOT_X - 18} ${PLOT_Y + 6})`}
          x={PLOT_X - 18}
          y={PLOT_Y + 6}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={10}
          textAnchor="end"
        >
          u_C (V) →
        </text>
        {/* Time tick labels in ms */}
        {[0, T_SIM_MAX / 4, T_SIM_MAX / 2, (3 * T_SIM_MAX) / 4, T_SIM_MAX].map((tv) => (
          <text
            key={`tk${tv}`}
            x={tToSvgX(tv)}
            y={PLOT_Y + PLOT_H + 14}
            fill="#54617A"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={9}
            textAnchor="middle"
          >
            {(tv * 1000).toFixed(0)}
          </text>
        ))}
        {/* Y tick labels: -E, -E/2, 0, E/2, E */}
        {[-E, -E / 2, 0, E / 2, E].map((v) => (
          <text
            key={`yk${v}`}
            x={PLOT_X - 6}
            y={ucToSvgY(v) + 3}
            fill="#54617A"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={9}
            textAnchor="end"
          >
            {v.toFixed(0)}
          </text>
        ))}

        {/* Stage-1 canonical envelope (training-wheel — REMOVED on stages 2, 3) */}
        {isStage1 && envUpperPath && (
          <path d={envUpperPath} fill="none" stroke="#F9A968" strokeWidth={1} strokeDasharray="3 4" opacity={0.4} />
        )}
        {isStage1 && envLowerPath && (
          <path d={envLowerPath} fill="none" stroke="#F9A968" strokeWidth={1} strokeDasharray="3 4" opacity={0.4} />
        )}
        {isStage1 && envUpperPath && (
          <text
            x={PLOT_X + PLOT_W - 4}
            y={ucToSvgY(E) + 12}
            fill="#F9A968"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={9}
            textAnchor="end"
          >
            ±E·e^(−λt)
          </text>
        )}

        {/* Stage-2 target curve */}
        {isStage2 && (
          <path
            d={stage2TargetPath}
            fill="none"
            stroke="#F97316"
            strokeWidth={1.8}
            opacity={0.65}
            strokeDasharray="4 5"
          />
        )}

        {/* Stage-3 target curve (always visible on stage 3) */}
        {isStage3 && (
          <path d={stage3TargetPath} fill="none" stroke="#F97316" strokeWidth={2} opacity={0.9} />
        )}

        {/* Peek: strategy-hint text (reading method only — no answer reveal) */}
        {isStage3 && peekVisible && (
          <foreignObject x={PLOT_X + 4} y={PLOT_Y + 4} width={PLOT_W - 8} height={70}>
            <div
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 9,
                color: '#37C9B8',
                lineHeight: 1.35,
                background: 'rgba(13, 21, 36, 0.85)',
                padding: '4px 6px',
                borderRadius: 3,
                border: '1px solid #1c3050',
              }}
            >
              {labels.peek_hint}
            </div>
          </foreignObject>
        )}

        {/* Live trace (hidden on stage 3 pre-submit) */}
        {livePath && <path d={livePath} fill="none" stroke="#37C9B8" strokeWidth={2} />}
      </svg>

      {/* ─── HUD overlays (HTML, in rem) ────────────────────────────── */}
      <div
        style={{
          position: 'absolute',
          top: '3rem',
          left: '3rem',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '2.3rem',
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: '#6C7A93',
          zIndex: 5,
          pointerEvents: 'none',
        }}
      >
        {hudTL}
      </div>
      <div
        style={{
          position: 'absolute',
          top: '3rem',
          right: '3rem',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '2rem',
          letterSpacing: '0.06em',
          color: '#37C9B8',
          zIndex: 5,
          pointerEvents: 'none',
          textAlign: 'right',
        }}
      >
        {hudTR}
      </div>
      <div
        style={{
          position: 'absolute',
          bottom: '3rem',
          left: '3rem',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '1.9rem',
          letterSpacing: '0.06em',
          color: '#6C7A93',
          zIndex: 5,
          pointerEvents: 'none',
          maxWidth: '52%',
        }}
      >
        {hudBL}
      </div>
      {/* Bottom-right corner intentionally empty — reserved for parent chrome. */}

      {/* Stage-2 hit toast */}
      {isStage2 && stage2Hit && (
        <div
          style={{
            position: 'absolute',
            top: '30%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '3rem',
            color: '#37C9B8',
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            zIndex: 8,
            pointerEvents: 'none',
          }}
        >
          ✓ {labels.hit}
        </div>
      )}

      {/* Stage-3 submitted feedback */}
      {isStage3 && submitted && tSim >= T_SIM_MAX && (
        <div
          style={{
            position: 'absolute',
            top: '30%',
            left: '65%',
            transform: 'translate(-50%, -50%)',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '2.4rem',
            color: stage3Score.pass ? '#37C9B8' : '#F97316',
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            zIndex: 8,
            pointerEvents: 'none',
            textAlign: 'center',
          }}
        >
          {stage3Score.pass ? (
            <>✓ {labels.match_ok}</>
          ) : (
            <>
              {labels.match_off}
              <div style={{ fontSize: '1.6rem', marginTop: '0.4rem', letterSpacing: '0.06em' }}>
                ΔT = {(stage3Score.dT * 100).toFixed(1)}% · Δλ = {(stage3Score.dL * 100).toFixed(1)}%
              </div>
            </>
          )}
        </div>
      )}
      {isStage3 && showFail && (
        <div
          style={{
            position: 'absolute',
            bottom: '18rem',
            left: '50%',
            transform: 'translateX(-50%)',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '1.6rem',
            color: '#F97316',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            zIndex: 8,
            pointerEvents: 'none',
          }}
        >
          rotating target…
        </div>
      )}

      {/* ─── R and C vertical sliders (top-right column) ────────────── */}
      <div
        style={{
          position: 'absolute',
          top: '10rem',
          right: '3rem',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '2rem',
          zIndex: 6,
        }}
      >
        {/* R slider */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.4rem' }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.4rem', color: '#6C7A93' }}>
            {R_MAX}Ω
          </div>
          <div style={{ width: '2rem', height: '18rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <input
              type="range"
              min={0}
              max={1000}
              step={1}
              value={Math.round(toLog(R, R_MIN, R_MAX) * 1000)}
              onChange={(e) => {
                setR(fromLog(Number(e.target.value) / 1000, R_MIN, R_MAX))
                setRMoved(true)
              }}
              disabled={isStage3 && submitted}
              style={{
                width: '18rem',
                height: '2rem',
                transform: 'rotate(-90deg)',
                transformOrigin: 'center',
                accentColor: '#37C9B8',
                cursor: isStage3 && submitted ? 'not-allowed' : 'pointer',
              }}
            />
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.4rem', color: '#6C7A93' }}>
            {R_MIN}Ω
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.5rem', color: '#37C9B8' }}>
            R = {formatR(R)}
          </div>
        </div>
        {/* C slider */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.4rem' }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.4rem', color: '#6C7A93' }}>
            {(C_MAX * 1e6).toFixed(0)}µ
          </div>
          <div style={{ width: '2rem', height: '18rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <input
              type="range"
              min={0}
              max={1000}
              step={1}
              value={Math.round(toLog(C, C_MIN, C_MAX) * 1000)}
              onChange={(e) => {
                setC(fromLog(Number(e.target.value) / 1000, C_MIN, C_MAX))
                setCMoved(true)
              }}
              disabled={isStage3 && submitted}
              style={{
                width: '18rem',
                height: '2rem',
                transform: 'rotate(-90deg)',
                transformOrigin: 'center',
                accentColor: '#37C9B8',
                cursor: isStage3 && submitted ? 'not-allowed' : 'pointer',
              }}
            />
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.4rem', color: '#6C7A93' }}>
            {(C_MIN * 1e6).toFixed(0)}µ
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.5rem', color: '#37C9B8' }}>
            C = {formatC(C)}
          </div>
        </div>
      </div>

      {/* Stage-3 SUBMIT button (bottom center, only before submit) */}
      {isStage3 && !submitted && (
        <button
          type="button"
          onClick={submitStage3}
          style={{
            position: 'absolute',
            bottom: '10rem',
            left: '38%',
            transform: 'translateX(-50%)',
            padding: '1.4rem 3.2rem',
            background: '#F97316',
            color: '#FFFFFF',
            border: 'none',
            borderRadius: '10rem',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '2rem',
            fontWeight: 700,
            letterSpacing: '0.12em',
            cursor: 'pointer',
            zIndex: 10,
          }}
        >
          <i
            className="bi bi-play-fill"
            style={{ marginInlineEnd: '0.6rem', fontSize: '2.2rem', verticalAlign: '-0.3rem' }}
          />
          {labels.submit_button}
        </button>
      )}
    </div>
  )
}
