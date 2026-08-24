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
import { Inductor } from './art/Inductor'
import { Capacitor } from './art/Capacitor'
import { Resistor } from './art/Resistor'
import { Amplifier } from './art/Amplifier'

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

// ─── Physics constants ──────────────────────────────────────────────────
// Series LC tank + resistive loss R, driven back to sustain by a
// negative-resistance amplifier −G that cancels dissipation.
// The amplifier saturates at ±U_sat, so once G > R the envelope grows
// exponentially until it hits U_sat and locks there.
const R = 10 // Ω — fixed dissipative loss
const U0 = 2 // V — initial trigger on the capacitor (u_C(0))
const U_SAT = 4 // V — amplifier saturation clamp
const L_MIN = 0.5 // H
const L_MAX = 5 // H
const L_DEFAULT = 1 // H
const C_MIN = 100e-6 // F
const C_MAX = 1000e-6 // F
const C_DEFAULT = 300e-6 // F
const G_MIN = 0 // Ω
const G_MAX = 20 // Ω
const G_DEFAULT = 0 // Ω — start dissipative

const T_SIM_MAX = 0.5 // seconds

const STAGE2_TOL = 0.08 // ±8% of U_sat at t*
const STAGE3_TOL_T = 0.04 // ±4% on period T
const G_SUSTAIN_MARGIN = 1 // G >= R + margin required to count as sustained

// ─── Seeded targets ─────────────────────────────────────────────────────
// Stage 2: hit the first-peak crosshair (t* = T*, u_C = +U_sat).
// This implicitly requires (a) T ≈ T* AND (b) envelope has reached U_sat
// (i.e., student pushed G past R). Both physical goals in one target.
const STAGE2_TARGETS = [
  { tStar: 0.16 }, // 160 ms
  { tStar: 0.1 }, // 100 ms
  { tStar: 0.24 }, // 240 ms
  { tStar: 0.2 }, // 200 ms
  { tStar: 0.12 }, // 120 ms
]

// Stage 3: hidden (L*, C*) pairs — the target curve on screen is a
// sustained sinusoid at T* = 2π√(L* C*) with amplitude U_sat.
// Student reads T* from peak-to-peak on the target and picks any (L, C)
// with L·C = (T*/2π)², then sets G > R to sustain.
const STAGE3_TARGETS = [
  { lStar: 1.0, cStar: 250e-6 }, // T* ≈ 99 ms
  { lStar: 2.0, cStar: 500e-6 }, // T* ≈ 199 ms
  { lStar: 3.0, cStar: 200e-6 }, // T* ≈ 154 ms
  { lStar: 1.0, cStar: 800e-6 }, // T* ≈ 178 ms
  { lStar: 3.0, cStar: 800e-6 }, // T* ≈ 308 ms
]

// ─── Physics helpers ────────────────────────────────────────────────────
/**
 * Closed-form solution of  L·q̈ + (R−G)·q̇ + q/C = 0,
 * with initial conditions u_C(0) = U₀, du_C/dt(0) = 0.
 *
 *   ω₀² = 1/(LC),  λ = (R−G)/(2L),  ω₁² = ω₀² − λ²   (always > 0 in our range)
 *   u_C(t) = env(t) · phase(t)
 *     phase(t) = [cos(ω₁ t) + (λ/ω₁)·sin(ω₁ t)] / √(1 + λ²/ω₁²)   (unit-amplitude)
 *     env(t)   = U₀ · exp(−λ t) · √(1 + λ²/ω₁²)                   (peak envelope)
 *
 * For λ < 0 (G > R) the envelope grows; the amplifier saturation clamps
 * it at U_sat, so we cap env at U_sat before multiplying by phase.
 * For λ = 0 (G = R exactly) env stays at U₀; for λ > 0 (G < R) it decays.
 */
function uCAt(t: number, uStart: number, uSat: number, lambda: number, omega1: number): number {
  const ratio = lambda / omega1
  const norm = Math.sqrt(1 + ratio * ratio)
  const rawEnv = uStart * Math.exp(-lambda * t) * norm
  const env = lambda < 0 ? Math.min(rawEnv, uSat) : rawEnv
  const phase = (Math.cos(omega1 * t) + ratio * Math.sin(omega1 * t)) / norm
  return env * phase
}

function periodOf(l: number, c: number): number {
  return 2 * Math.PI * Math.sqrt(l * c)
}

function formatPeriod(t: number): string {
  if (t < 1) return `${(t * 1000).toFixed(0)} ms`
  return `${t.toFixed(2)} s`
}

function formatL(l: number): string {
  if (l >= 1) return `${l.toFixed(l >= 10 ? 0 : 2)} H`
  return `${(l * 1000).toFixed(0)} mH`
}

function formatC(c: number): string {
  if (c >= 1e-3) return `${(c * 1e3).toFixed(1)} mF`
  return `${(c * 1e6).toFixed(0)} µF`
}

// ─── Log-slider mapping (linear slider position ↔ log-scaled value) ────
function toLog(value: number, min: number, max: number): number {
  return (Math.log(value) - Math.log(min)) / (Math.log(max) - Math.log(min))
}
function fromLog(pos: number, min: number, max: number): number {
  return min * Math.pow(max / min, pos)
}

// ─── Coordinate helpers for the plot ────────────────────────────────────
function tToSvgX(t: number): number {
  return PLOT_X + (t / T_SIM_MAX) * PLOT_W
}
const Y_MAX = U_SAT * 1.15 // little headroom above U_sat
function ucToSvgY(uc: number): number {
  // Symmetric axis: -Y_MAX .. +Y_MAX mapped to full PLOT_H (top = +Y_MAX)
  return PLOT_Y + PLOT_H / 2 - (uc / Y_MAX) * (PLOT_H / 2)
}

/** Pre-computed target-curve sampler (dense polyline). */
function targetPathFor(lambda: number, omega1: number): string {
  const steps = 240
  let d = ''
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * T_SIM_MAX
    const uc = uCAt(t, U0, U_SAT, lambda, omega1)
    const sx = tToSvgX(t)
    const sy = ucToSvgY(uc)
    d += `${i === 0 ? 'M' : 'L'} ${sx.toFixed(1)} ${sy.toFixed(1)} `
  }
  return d
}

// ─── Label loader ───────────────────────────────────────────────────────
const dict = { en } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
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
  const stage3Target = useMemo(
    () => STAGE3_TARGETS[(seed + 1) % STAGE3_TARGETS.length]!,
    [seed],
  )

  const tStar = periodOf(stage3Target.lStar, stage3Target.cStar)

  const stageIdx = useCurrentStage()
  const setStage = useSetStage()
  const progress = useProgress()
  const complete = useComplete()

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  const [L, setL] = useState(L_DEFAULT)
  const [C, setC] = useState(C_DEFAULT)
  const [G, setG] = useState(G_DEFAULT)
  const [tSim, setTSim] = useState(0)
  const [uC, setUc] = useState(U0)
  const [trace, setTrace] = useState<{ t: number; uc: number }[]>([{ t: 0, uc: U0 }])
  const [lMoved, setLMoved] = useState(false)
  const [cMoved, setCMoved] = useState(false)
  const [gMoved, setGMoved] = useState(false)
  const [sawSustain, setSawSustain] = useState(false) // stage-1 coverage: envelope reached U_sat once
  const [sawDecay, setSawDecay] = useState(false) // stage-1 coverage: envelope decayed to near 0 once
  const [stage2Hit, setStage2Hit] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [peekVisible, setPeekVisible] = useState(false)

  // Live physics scalars
  const omega0 = 1 / Math.sqrt(L * C)
  const lambda = (R - G) / (2 * L)
  const omega1sq = omega0 * omega0 - lambda * lambda
  const omega1 = omega1sq > 0 ? Math.sqrt(omega1sq) : omega0 // always underdamped in our range
  const T0 = (2 * Math.PI) / omega1

  const resetStageState = useCallback(() => {
    setL(L_DEFAULT)
    setC(C_DEFAULT)
    setG(G_DEFAULT)
    setTSim(0)
    setUc(U0)
    setTrace([{ t: 0, uc: U0 }])
    setLMoved(false)
    setCMoved(false)
    setGMoved(false)
    setSawSustain(false)
    setSawDecay(false)
    setStage2Hit(false)
    setSubmitted(false)
    setPeekVisible(false)
  }, [])
  useReset(resetStageState)

  // Any slider change on stages 1/2 restarts the oscillator with a fresh
  // trigger — the closed-form is keyed to (L, C, G) so we must reset t=0.
  const onSliderChange = useCallback(() => {
    if (isStage3) return
    setTSim(0)
    setUc(U0)
    setTrace([{ t: 0, uc: U0 }])
    setStage2Hit(false)
  }, [isStage3])

  // ─── Ticker ─────────────────────────────────────────────────────────
  useTicker((dt) => {
    // Stage 3: sim only runs AFTER submit
    if (isStage3 && !submitted) return
    if (tSim >= T_SIM_MAX) return

    const nextT = Math.min(tSim + dt, T_SIM_MAX)
    const nextUc = uCAt(nextT, U0, U_SAT, lambda, omega1)
    setUc(nextUc)
    setTSim(nextT)
    setTrace((prev) => {
      const last = prev[prev.length - 1]
      if (last && nextT - last.t < 0.003) return prev // ~3 ms throttle
      return [...prev, { t: nextT, uc: nextUc }]
    })

    // Stage-1 coverage tracking
    if (isStage1) {
      if (Math.abs(nextUc) > 0.95 * U_SAT) setSawSustain(true)
      if (nextT > T_SIM_MAX * 0.4 && Math.abs(nextUc) < 0.05 * U_SAT) setSawDecay(true)
    }

    // Stage-2 hit detection: close to the crosshair at (t* = T_target, +U_sat)
    if (isStage2 && !stage2Hit) {
      const dT = Math.abs(nextT - stage2Target.tStar)
      if (dT < 0.01) {
        if (nextUc > (1 - STAGE2_TOL) * U_SAT) setStage2Hit(true)
      }
    }
  })

  // ─── Advance predicate ──────────────────────────────────────────────
  const stage3Ok = submitted && Math.abs(T0 - tStar) / tStar < STAGE3_TOL_T && G >= R + G_SUSTAIN_MARGIN
  const canSubmit = isStage1
    ? lMoved && cMoved && gMoved && sawSustain && sawDecay
    : isStage2
      ? stage2Hit
      : stage3Ok

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

  // ─── Peek: reading-method hint, NOT the T* value ────────────────────
  usePeek(() => {
    if (!isStage3) return
    setPeekVisible(true)
  })
  useEffect(() => {
    if (!peekVisible) return
    const t = setTimeout(() => setPeekVisible(false), 5000)
    return () => clearTimeout(t)
  }, [peekVisible])

  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  const submitStage3 = useCallback(() => {
    setSubmitted(true)
    setTSim(0)
    setUc(U0)
    setTrace([{ t: 0, uc: U0 }])
  }, [])

  // ─── Circuit geometry (series loop: L on top, C on right, R on bottom, −G on left) ──
  const rect = {
    left: SCH_X + 50,
    right: SCH_X + SCH_W - 40,
    top: SCH_Y + 90,
    bottom: SCH_Y + SCH_H - 90,
  }
  const midY = (rect.top + rect.bottom) / 2
  const midX = (rect.left + rect.right) / 2
  const inductor = { x: midX, y: rect.top }
  const capacitor = { x: rect.right, y: midY }
  const resistor = { x: midX, y: rect.bottom }
  const amplifier = { x: rect.left, y: midY }

  const wireStroke = '#54617A'
  const wireW = 1.6
  const activeColor = '#37C9B8'
  const satColor = '#F97316'

  const envelopeMag = Math.abs(uC)
  const saturated = lambda < 0 && envelopeMag > 0.95 * U_SAT
  const sustainActive = G >= R + G_SUSTAIN_MARGIN
  const loopColor = saturated ? satColor : sustainActive ? activeColor : wireStroke
  const loopW = sustainActive ? wireW + 0.6 : wireW

  // ─── Plot grid ──────────────────────────────────────────────────────
  const plotGrid: React.ReactNode[] = []
  for (let i = 1; i < 5; i++) {
    const gx = PLOT_X + (i / 5) * PLOT_W
    plotGrid.push(
      <line key={`vx${i}`} x1={gx} y1={PLOT_Y} x2={gx} y2={PLOT_Y + PLOT_H}
            stroke="#12203a" strokeWidth={1} />,
    )
  }
  for (let i = 1; i < 4; i++) {
    const gy = PLOT_Y + (i / 4) * PLOT_H
    plotGrid.push(
      <line key={`gy${i}`} x1={PLOT_X} y1={gy} x2={PLOT_X + PLOT_W} y2={gy}
            stroke="#12203a" strokeWidth={1} />,
    )
  }

  // ─── Pre-computed target paths ──────────────────────────────────────
  const stage2TargetPath = useMemo(() => {
    if (!isStage2) return ''
    // Draw a canonical sustained sinusoid at the target period, saturated envelope.
    // omega1 = 2π/T*; lambda = 0 (perfectly sustained target).
    return targetPathFor(0, (2 * Math.PI) / stage2Target.tStar)
  }, [isStage2, stage2Target])

  const stage3TargetPath = useMemo(() => {
    if (!isStage3) return ''
    // Grown-then-saturated sinusoid at T*. Use small negative lambda so
    // the envelope reaches U_sat within a few periods — realistic shape.
    return targetPathFor(-4, (2 * Math.PI) / tStar)
  }, [isStage3, tStar])

  const tracePath = useMemo(() => {
    if (isStage3 && !submitted) return ''
    if (trace.length < 2) return ''
    let d = ''
    for (let i = 0; i < trace.length; i++) {
      const p = trace[i]!
      const sx = tToSvgX(p.t)
      const sy = ucToSvgY(p.uc)
      d += `${i === 0 ? 'M' : 'L'} ${sx.toFixed(1)} ${sy.toFixed(1)} `
    }
    return d
  }, [trace, isStage3, submitted])

  // ─── HUD strings ────────────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`
  // T₀ readout is REQUIRED info on every stage (student's paper math anchor).
  // We NEVER surface T* — that's the answer. See §4.7 rule 4.
  const gStatus = G < R
    ? labels.status_decay
    : G > R + G_SUSTAIN_MARGIN
      ? labels.status_sustain
      : labels.status_edge
  const hudTR = isStage3 && submitted
    ? Math.abs(T0 - tStar) / tStar < STAGE3_TOL_T
      ? `${labels.match_ok} · T = ${formatPeriod(T0)}`
      : `${labels.match_off} · ΔT = ${(100 * Math.abs(T0 - tStar) / tStar).toFixed(1)}%`
    : `T = ${formatPeriod(T0)} · ${gStatus}`
  const hudBL = isStage1 ? labels.tip1 : isStage2 ? labels.tip2 : labels.tip3
  // BR RESERVED — no overlay.

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block', userSelect: 'none' }}
      >
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        {/* ─── Left panel: circuit ────────────────────────────────────── */}
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

        {/* Loop wires (four rails) */}
        {/* Top rail: amplifier → inductor → capacitor */}
        <line x1={rect.left} y1={rect.top} x2={inductor.x - 32} y2={rect.top}
              stroke={loopColor} strokeWidth={loopW} />
        <line x1={inductor.x + 32} y1={rect.top} x2={rect.right} y2={rect.top}
              stroke={loopColor} strokeWidth={loopW} />
        {/* Right rail: capacitor stub above and below */}
        <line x1={rect.right} y1={rect.top} x2={rect.right} y2={capacitor.y - 4}
              stroke={loopColor} strokeWidth={loopW} />
        <line x1={rect.right} y1={capacitor.y + 4} x2={rect.right} y2={rect.bottom}
              stroke={loopColor} strokeWidth={loopW} />
        {/* Bottom rail: capacitor → resistor → amplifier */}
        <line x1={rect.right} y1={rect.bottom} x2={resistor.x + 22} y2={rect.bottom}
              stroke={loopColor} strokeWidth={loopW} />
        <line x1={resistor.x - 22} y1={rect.bottom} x2={rect.left} y2={rect.bottom}
              stroke={loopColor} strokeWidth={loopW} />
        {/* Left rail: amplifier stubs above and below */}
        <line x1={rect.left} y1={rect.top} x2={rect.left} y2={amplifier.y - 20}
              stroke={loopColor} strokeWidth={loopW} />
        <line x1={rect.left} y1={amplifier.y + 20} x2={rect.left} y2={rect.bottom}
              stroke={loopColor} strokeWidth={loopW} />

        <Inductor x={inductor.x} y={inductor.y} l={L} />
        <Capacitor x={capacitor.x} y={capacitor.y} c={C} uC={uC} uSat={U_SAT} />
        <Resistor x={resistor.x} y={resistor.y} r={R} labelBelow />
        <Amplifier x={amplifier.x} y={amplifier.y} g={G} active={sustainActive} saturated={saturated} />

        {/* "no external drive" annotation — distinguishes entretenues from forcées */}
        <text
          x={SCH_X + SCH_W / 2}
          y={SCH_Y + SCH_H - 6}
          fill="#54617A"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={10}
          textAnchor="middle"
        >
          {labels.no_drive}
        </text>

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
          {labels.chart_title}
        </text>
        {plotGrid}
        {/* Zero baseline (bipolar signal) */}
        <line
          x1={PLOT_X}
          y1={ucToSvgY(0)}
          x2={PLOT_X + PLOT_W}
          y2={ucToSvgY(0)}
          stroke="#3A4863"
          strokeWidth={1.5}
        />
        <line x1={PLOT_X} y1={PLOT_Y} x2={PLOT_X} y2={PLOT_Y + PLOT_H}
              stroke="#3A4863" strokeWidth={1.5} />
        {/* Axis labels */}
        <text
          x={PLOT_X + PLOT_W - 6}
          y={PLOT_Y + PLOT_H + 18}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={10}
          textAnchor="end"
        >
          {labels.x_axis_label}
        </text>
        <text
          transform={`rotate(-90 ${PLOT_X - 22} ${PLOT_Y + 6})`}
          x={PLOT_X - 22}
          y={PLOT_Y + 6}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={10}
          textAnchor="end"
        >
          {labels.y_axis_label}
        </text>
        {/* Time tick labels — displayed as ms */}
        {[0, 0.1, 0.2, 0.3, 0.4, 0.5].map((tv) => (
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
        {/* Y-axis tick labels */}
        {[-U_SAT, 0, U_SAT].map((v) => (
          <text
            key={`uk${v}`}
            x={PLOT_X - 6}
            y={ucToSvgY(v) + 3}
            fill="#54617A"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={9}
            textAnchor="end"
          >
            {v > 0 ? `+${v}` : v}
          </text>
        ))}

        {/* Stage-1 canonical markers — saturation ceiling & floor (help; removed on stage 3) */}
        {isStage1 && (
          <>
            <line
              x1={PLOT_X}
              y1={ucToSvgY(U_SAT)}
              x2={PLOT_X + PLOT_W}
              y2={ucToSvgY(U_SAT)}
              stroke="#F9A968"
              strokeWidth={1}
              strokeDasharray="3 4"
              opacity={0.35}
            />
            <line
              x1={PLOT_X}
              y1={ucToSvgY(-U_SAT)}
              x2={PLOT_X + PLOT_W}
              y2={ucToSvgY(-U_SAT)}
              stroke="#F9A968"
              strokeWidth={1}
              strokeDasharray="3 4"
              opacity={0.35}
            />
            <text
              x={PLOT_X + PLOT_W - 4}
              y={ucToSvgY(U_SAT) - 4}
              fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={9}
              textAnchor="end"
            >
              +U_sat
            </text>
            <text
              x={PLOT_X + PLOT_W - 4}
              y={ucToSvgY(-U_SAT) + 11}
              fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={9}
              textAnchor="end"
            >
              −U_sat
            </text>
          </>
        )}

        {/* Stage-2: target curve + first-peak crosshair */}
        {isStage2 && (
          <>
            <path
              d={stage2TargetPath}
              fill="none"
              stroke="#F97316"
              strokeWidth={1.6}
              opacity={0.55}
              strokeDasharray="4 5"
            />
            <circle
              cx={tToSvgX(stage2Target.tStar)}
              cy={ucToSvgY(U_SAT)}
              r={6}
              fill="#F97316"
            />
            <circle
              cx={tToSvgX(stage2Target.tStar)}
              cy={ucToSvgY(U_SAT)}
              r={11}
              fill="none"
              stroke="#F97316"
              strokeWidth={1}
              opacity={0.5}
            />
            <line
              x1={tToSvgX(stage2Target.tStar)}
              y1={PLOT_Y + PLOT_H}
              x2={tToSvgX(stage2Target.tStar)}
              y2={ucToSvgY(U_SAT)}
              stroke="#F97316"
              strokeWidth={0.8}
              strokeDasharray="2 3"
              opacity={0.4}
            />
            <text
              x={tToSvgX(stage2Target.tStar)}
              y={PLOT_Y + PLOT_H + 26}
              fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
              textAnchor="middle"
            >
              t* = {(stage2Target.tStar * 1000).toFixed(0)} ms
            </text>
          </>
        )}

        {/* Stage-3: target curve only (target period, saturated envelope) */}
        {isStage3 && (
          <path
            d={stage3TargetPath}
            fill="none"
            stroke="#F97316"
            strokeWidth={2}
            opacity={0.9}
          />
        )}

        {/* Peek: reading-method banner over the plot (§4.7 rule 4) */}
        {isStage3 && peekVisible && (
          <>
            <rect
              x={PLOT_X - 2}
              y={PLOT_Y - 34}
              width={PLOT_W + 4}
              height={22}
              fill="#12203a"
              rx={4}
            />
            <text
              x={PLOT_X + PLOT_W / 2}
              y={PLOT_Y - 20}
              fill="#37C9B8"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={9}
              textAnchor="middle"
            >
              {labels.peek_hint}
            </text>
          </>
        )}

        {/* Live trace — hidden pre-submit on stage 3 */}
        {tracePath && (
          <path d={tracePath} fill="none" stroke="#37C9B8" strokeWidth={2} />
        )}
      </svg>

      {/* ─── HUD overlays ────────────────────────────────────────────── */}
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
          fontSize: '2.1rem',
          letterSpacing: '0.08em',
          color: '#37C9B8',
          textAlign: 'right',
          zIndex: 5,
          pointerEvents: 'none',
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
          fontSize: '2.1rem',
          letterSpacing: '0.06em',
          color: '#6C7A93',
          zIndex: 5,
          pointerEvents: 'none',
          maxWidth: '52%',
        }}
      >
        {hudBL}
      </div>
      {/* BR reserved for parent-side chrome — no overlay */}

      {/* ─── Slider column (L, C, G) ────────────────────────────────── */}
      <div
        style={{
          position: 'absolute',
          top: '8rem',
          right: '3rem',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'stretch',
          gap: '1.4rem',
          zIndex: 6,
        }}
      >
        {/* L slider */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.4rem' }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.4rem', color: '#6C7A93' }}>
            {formatL(L_MAX)}
          </div>
          <div style={{ width: '2rem', height: '10rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <input
              type="range"
              min={0}
              max={1000}
              step={1}
              value={Math.round(toLog(L, L_MIN, L_MAX) * 1000)}
              onChange={(e) => {
                setL(fromLog(Number(e.target.value) / 1000, L_MIN, L_MAX))
                setLMoved(true)
                onSliderChange()
              }}
              disabled={isStage3 && submitted}
              style={{
                width: '10rem',
                height: '1.6rem',
                transform: 'rotate(-90deg)',
                transformOrigin: 'center',
                accentColor: '#37C9B8',
                cursor: isStage3 && submitted ? 'not-allowed' : 'pointer',
              }}
            />
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.4rem', color: '#6C7A93' }}>
            {formatL(L_MIN)}
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.5rem', color: '#37C9B8' }}>
            L = {formatL(L)}
          </div>
        </div>
        {/* C slider */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.4rem' }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.4rem', color: '#6C7A93' }}>
            {formatC(C_MAX)}
          </div>
          <div style={{ width: '2rem', height: '10rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <input
              type="range"
              min={0}
              max={1000}
              step={1}
              value={Math.round(toLog(C, C_MIN, C_MAX) * 1000)}
              onChange={(e) => {
                setC(fromLog(Number(e.target.value) / 1000, C_MIN, C_MAX))
                setCMoved(true)
                onSliderChange()
              }}
              disabled={isStage3 && submitted}
              style={{
                width: '10rem',
                height: '1.6rem',
                transform: 'rotate(-90deg)',
                transformOrigin: 'center',
                accentColor: '#37C9B8',
                cursor: isStage3 && submitted ? 'not-allowed' : 'pointer',
              }}
            />
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.4rem', color: '#6C7A93' }}>
            {formatC(C_MIN)}
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.5rem', color: '#37C9B8' }}>
            C = {formatC(C)}
          </div>
        </div>
        {/* G slider (linear) */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.4rem' }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.4rem', color: '#6C7A93' }}>
            {G_MAX} Ω
          </div>
          <div style={{ width: '2rem', height: '10rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <input
              type="range"
              min={G_MIN}
              max={G_MAX}
              step={0.1}
              value={G}
              onChange={(e) => {
                setG(Number(e.target.value))
                setGMoved(true)
                onSliderChange()
              }}
              disabled={isStage3 && submitted}
              style={{
                width: '10rem',
                height: '1.6rem',
                transform: 'rotate(-90deg)',
                transformOrigin: 'center',
                accentColor: G >= R + G_SUSTAIN_MARGIN ? '#F97316' : '#37C9B8',
                cursor: isStage3 && submitted ? 'not-allowed' : 'pointer',
              }}
            />
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.4rem', color: '#6C7A93' }}>
            {G_MIN} Ω
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.5rem', color: G >= R + G_SUSTAIN_MARGIN ? '#F97316' : '#37C9B8' }}>
            G = {G.toFixed(1)} Ω
          </div>
        </div>
      </div>

      {/* Stage 3 SUBMIT button */}
      {isStage3 && !submitted && (
        <button
          type="button"
          onClick={submitStage3}
          style={{
            position: 'absolute',
            bottom: '10rem',
            left: '50%',
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
          <i className="bi bi-play-fill" style={{ marginInlineEnd: '0.6rem', fontSize: '2.2rem', verticalAlign: '-0.3rem' }} />
          {labels.submit_button}
        </button>
      )}
    </div>
  )
}
