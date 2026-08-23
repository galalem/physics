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
import { Coil } from './art/Coil'
import { Capacitor } from './art/Capacitor'

// ─── Scene constants ────────────────────────────────────────────────────
const W = 800
const H = 450

// Left panel: LC circuit schematic
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
// Fixed initial capacitor voltage — the amplitude of the free oscillation.
const U0 = 6 // V

// L slider (log-scale): 0.2 H ↔ 1.5 H
const L_MIN = 0.2
const L_MAX = 1.5
const L_DEFAULT = 0.5

// C slider (log-scale): 100 µF ↔ 2000 µF
const C_MIN = 100e-6
const C_MAX = 2000e-6
const C_DEFAULT = 500e-6

// Time-scaling — animation slowdown so periods (~ 60–200 ms) are watchable.
// TIME_SCALE = 0.1 → 100 ms of simulated time per 1 s of wall clock.
const TIME_SCALE = 0.1

// Chart horizontal extent — sim time in seconds.
// 0.4 s covers ~2 periods of the slowest T0 and ~6 of the fastest.
const T_SIM_MAX = 0.4

const STAGE2_TOL = 0.05 // ±5% on T0
const STAGE3_TOL = 0.03 // ±3% on T0

// Stage-2 seeded targets: crosshair at (tStar, cos(2π tStar / targetT0) · U0).
// Each hits a different characteristic phase (peak-return, zero-cross, trough)
// so the student learns to read all three landmarks.
const STAGE2_TARGETS: { tStar: number; targetT0: number }[] = [
  { tStar: 0.06, targetT0: 0.06 }, // t* = T0 → first peak return (u_C = +U0)
  { tStar: 0.04, targetT0: 0.16 }, // t* = T0/4 → first zero-crossing (u_C = 0)
  { tStar: 0.05, targetT0: 0.10 }, // t* = T0/2 → first trough (u_C = -U0)
  { tStar: 0.08, targetT0: 0.16 }, // t* = T0/2 → first trough
  { tStar: 0.03, targetT0: 0.12 }, // t* = T0/4 → first zero-crossing
]

// Stage-3 seeded targets: hidden (L*, C*) pairs → T0* = 2π√(L*·C*).
// Values spread across the slider range so the student can always land it.
const STAGE3_TARGETS: { lStar: number; cStar: number }[] = [
  { lStar: 0.5, cStar: 200e-6 }, // T0 ≈ 62.8 ms
  { lStar: 1.0, cStar: 200e-6 }, // T0 ≈ 88.9 ms
  { lStar: 0.5, cStar: 750e-6 }, // T0 ≈ 121.7 ms
  { lStar: 0.8, cStar: 750e-6 }, // T0 ≈ 153.9 ms
  { lStar: 0.6, cStar: 1400e-6 }, // T0 ≈ 182 ms
]

const dict = { en, fr, ar } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── Physics helpers (closed form — undamped SHM is exact) ─────────────
function period(l: number, c: number): number {
  return 2 * Math.PI * Math.sqrt(l * c)
}
function omega0(l: number, c: number): number {
  return 1 / Math.sqrt(l * c)
}
function ucAt(t: number, l: number, c: number): number {
  return U0 * Math.cos(omega0(l, c) * t)
}
/** Angular frequency implied by target period. */
function omegaFromT0(t0: number): number {
  return (2 * Math.PI) / t0
}
/** Format T0 as milliseconds. */
function formatT0(t0: number): string {
  return `${(t0 * 1000).toFixed(1)} ms`
}
/** Format L for the slider chip. */
function formatL(l: number): string {
  return l >= 1 ? `${l.toFixed(2)} H` : `${(l * 1000).toFixed(0)} mH`
}
/** Format C for the slider chip. */
function formatC(c: number): string {
  return `${Math.round(c * 1e6)} µF`
}
/** Format total energy in mJ (E = ½ C U₀²). */
function formatEnergy(c: number): string {
  const e = 0.5 * c * U0 * U0
  return `${(e * 1000).toFixed(2)} mJ`
}

// ─── Log-slider mapping ────────────────────────────────────────────────
function toLog(value: number, min: number, max: number): number {
  return (Math.log(value) - Math.log(min)) / (Math.log(max) - Math.log(min))
}
function fromLog(pos: number, min: number, max: number): number {
  return min * Math.pow(max / min, pos)
}

// ─── Plot coordinate helpers ───────────────────────────────────────────
function tToSvgX(t: number): number {
  return PLOT_X + (t / T_SIM_MAX) * PLOT_W
}
/** u_C range is [-U0, +U0]; add 5% padding so the peaks don't graze the border. */
function ucToSvgY(uc: number): number {
  const yMax = 1.05 * U0
  const mid = PLOT_Y + PLOT_H / 2
  return mid - (uc / yMax) * (PLOT_H / 2)
}

/** Closed-form target curve for a given T0. */
function curvePathForT0(t0: number): string {
  const w = omegaFromT0(t0)
  const steps = 120
  let d = ''
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * T_SIM_MAX
    const uc = U0 * Math.cos(w * t)
    const sx = tToSvgX(t)
    const sy = ucToSvgY(uc)
    d += `${i === 0 ? 'M' : 'L'} ${sx.toFixed(1)} ${sy.toFixed(1)} `
  }
  return d
}

// ─── Component ─────────────────────────────────────────────────────────
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
  const t0Star = period(stage3Target.lStar, stage3Target.cStar)

  const stageIdx = useCurrentStage()
  const setStage = useSetStage()
  const progress = useProgress()
  const complete = useComplete()

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  // ─── Physical state ────────────────────────────────────────────────
  const [L, setL] = useState(L_DEFAULT)
  const [C, setC] = useState(C_DEFAULT)
  const [tSim, setTSim] = useState(0)

  // Stage-1 coverage flags
  const [lMoved, setLMoved] = useState(false)
  const [cMoved, setCMoved] = useState(false)
  const [fullPeriod, setFullPeriod] = useState(false)

  // Stage-2 hit flag
  const [stage2Hit, setStage2Hit] = useState(false)

  // Stage-3 blind-submit flag
  const [submitted, setSubmitted] = useState(false)

  // Stage-3 peek (strategy hint, NOT the answer)
  const [peekVisible, setPeekVisible] = useState(false)

  const T0 = period(L, C)
  const uC = ucAt(tSim, L, C)

  const resetStageState = useCallback(() => {
    setL(L_DEFAULT)
    setC(C_DEFAULT)
    setTSim(0)
    setLMoved(false)
    setCMoved(false)
    setFullPeriod(false)
    setStage2Hit(false)
    setSubmitted(false)
    setPeekVisible(false)
  }, [])
  useReset(resetStageState)

  // ─── Ticker: closed-form SHM, advance sim clock ───────────────────
  useTicker((dt) => {
    // Stage 3 pre-submit: sim is frozen (live curve must not leak into chart)
    if (isStage3 && !submitted) return
    if (tSim >= T_SIM_MAX) return

    setTSim((prev) => {
      const nxt = Math.min(prev + dt * TIME_SCALE, T_SIM_MAX)

      // Stage-1 coverage: witnessed one full period end-to-end
      if (isStage1 && nxt >= T0) setFullPeriod(true)

      // Stage-2 hit: at t*, u_C must reach V* within tolerance, AND
      // the sim has actually reached t*. Tolerance is on T0 (the physical
      // scalar the student is tuning), not on the pixel-space u_C error.
      if (isStage2 && !stage2Hit && nxt >= stage2Target.tStar) {
        const rel = Math.abs(T0 - stage2Target.targetT0) / stage2Target.targetT0
        if (rel < STAGE2_TOL) setStage2Hit(true)
      }

      return nxt
    })
  })

  // ─── Advance predicate ─────────────────────────────────────────────
  const stage3Match =
    submitted && Math.abs(T0 - t0Star) / t0Star < STAGE3_TOL
  const canSubmit = isStage1
    ? lMoved && cMoved && fullPeriod
    : isStage2
      ? stage2Hit
      : stage3Match

  const readout = isStage1
    ? `T0 = ${formatT0(T0)} · E = ${formatEnergy(C)}`
    : isStage2
      ? stage2Hit
        ? `${labels.hit} · T0 = ${formatT0(T0)}`
        : `T0 = ${formatT0(T0)}`
      : submitted
        ? stage3Match
          ? `${labels.match_ok} · T0 = ${formatT0(T0)}`
          : `${labels.match_off} · ΔT0 = ${(100 * Math.abs(T0 - t0Star) / t0Star).toFixed(1)}%`
        : `T0 = ${formatT0(T0)}`

  useEffect(() => {
    progress(stageIdx / 3, { stage: stageIdx, canSubmit, readout })
  }, [stageIdx, canSubmit, readout, progress])

  useNext(() => {
    if (stageIdx < 3) {
      setStage(stageIdx + 1)
      resetStageState()
    } else {
      complete({ success: true })
    }
  })

  // ─── Peek: strategy hint, NOT the T0* value (see §4.7 rule 4) ────
  usePeek(() => {
    if (!isStage3) return
    setPeekVisible(true)
  })
  useEffect(() => {
    if (!peekVisible) return
    const t = setTimeout(() => setPeekVisible(false), 4000)
    return () => clearTimeout(t)
  }, [peekVisible])

  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  const submitStage3 = useCallback(() => {
    setSubmitted(true)
    // Reset the sim clock so the reveal animation draws the student's curve
    // fresh from t=0 across the whole chart.
    setTSim(0)
  }, [])

  // ─── Pre-computed paths ────────────────────────────────────────────
  const tracePath = useMemo(() => {
    // Stage 3 pre-submit: live curve is help → HIDDEN (§4.7).
    if (isStage3 && !submitted) return ''
    if (tSim <= 0) return ''
    const w = omega0(L, C)
    const steps = 120
    const tMax = Math.min(tSim, T_SIM_MAX)
    let d = ''
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * tMax
      const uc = U0 * Math.cos(w * t)
      const sx = tToSvgX(t)
      const sy = ucToSvgY(uc)
      d += `${i === 0 ? 'M' : 'L'} ${sx.toFixed(1)} ${sy.toFixed(1)} `
    }
    return d
  }, [L, C, tSim, isStage3, submitted])

  const stage2TargetPath = useMemo(() => {
    if (!isStage2) return ''
    return curvePathForT0(stage2Target.targetT0)
  }, [isStage2, stage2Target])

  const stage3TargetPath = useMemo(() => {
    if (!isStage3) return ''
    return curvePathForT0(t0Star)
  }, [isStage3, t0Star])

  // Stage-2 crosshair point (from closed form, so it lies exactly on the target)
  const stage2CrosshairY = useMemo(() => {
    const w = omegaFromT0(stage2Target.targetT0)
    return U0 * Math.cos(w * stage2Target.tStar)
  }, [stage2Target])

  // ─── Circuit geometry (LC loop: L on top rail, C on right rail) ──
  const rect = {
    left: SCH_X + 60,
    right: SCH_X + SCH_W - 60,
    top: SCH_Y + 100,
    bottom: SCH_Y + SCH_H - 100,
  }
  const coilCenter = { x: (rect.left + rect.right) / 2, y: rect.top }
  const capCenter = { x: rect.right, y: (rect.top + rect.bottom) / 2 }

  // Approximate loop current direction from -du_C/dt (i = -C du_C/dt).
  // For u_C = U0 cos(ω t), i = C U0 ω sin(ω t). We only need its sign for tinting.
  const loopI = C * U0 * omega0(L, C) * Math.sin(omega0(L, C) * tSim)
  const flowActive = Math.abs(loopI) > 0.02 * (C * U0 * omega0(L, C))
  const flowDir = loopI > 0 ? 1 : -1 // +1 = clockwise, -1 = counter-clockwise
  const wireColor = flowActive ? '#37C9B8' : '#54617A'
  const wireW = flowActive ? 2.0 : 1.6

  // ─── Chart grid ────────────────────────────────────────────────────
  const plotGrid: React.ReactNode[] = []
  for (let i = 1; i < 5; i++) {
    const gx = PLOT_X + (i / 5) * PLOT_W
    plotGrid.push(
      <line
        key={`vx${i}`}
        x1={gx}
        y1={PLOT_Y}
        x2={gx}
        y2={PLOT_Y + PLOT_H}
        stroke="#12203a"
        strokeWidth={1}
      />,
    )
  }
  for (let i = 1; i < 5; i++) {
    const gy = PLOT_Y + (i / 5) * PLOT_H
    plotGrid.push(
      <line
        key={`gy${i}`}
        x1={PLOT_X}
        y1={gy}
        x2={PLOT_X + PLOT_W}
        y2={gy}
        stroke="#12203a"
        strokeWidth={1}
      />,
    )
  }

  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`
  const hudTR = isStage1
    ? `T0 = ${formatT0(T0)}`
    : isStage2
      ? stage2Hit
        ? `✓ T0 = ${formatT0(T0)}`
        : `T0 = ${formatT0(T0)}`
      : submitted
        ? stage3Match
          ? `✓ T0 = ${formatT0(T0)}`
          : `ΔT0 = ${(100 * Math.abs(T0 - t0Star) / t0Star).toFixed(1)}%`
        : `T0 = ${formatT0(T0)}`
  const hudTR2 = isStage1
    ? `E = ${formatEnergy(C)}`
    : peekVisible && isStage3
      ? labels.peek_hint
      : ''
  const hudBL = isStage1 ? labels.tip1 : isStage2 ? labels.tip2 : labels.tip3
  // hudBR: intentionally empty — BR reserved for parent chrome.

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block', userSelect: 'none' }}
      >
        {/* Background — NO rx, NO borderRadius on outer <svg> */}
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        {/* ─── Left panel: LC circuit ────────────────────────────── */}
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

        {/* Wire loop (LC only — no battery, no switch) */}
        {/* Top-left segment: left rail up to coil left stub */}
        <line
          x1={rect.left}
          y1={rect.top}
          x2={coilCenter.x - 30}
          y2={rect.top}
          stroke={wireColor}
          strokeWidth={wireW}
        />
        {/* Top-right segment: coil right stub across to top-right corner */}
        <line
          x1={coilCenter.x + 30}
          y1={rect.top}
          x2={rect.right}
          y2={rect.top}
          stroke={wireColor}
          strokeWidth={wireW}
        />
        {/* Left vertical */}
        <line
          x1={rect.left}
          y1={rect.top}
          x2={rect.left}
          y2={rect.bottom}
          stroke={wireColor}
          strokeWidth={wireW}
        />
        {/* Bottom horizontal */}
        <line
          x1={rect.left}
          y1={rect.bottom}
          x2={rect.right}
          y2={rect.bottom}
          stroke={wireColor}
          strokeWidth={wireW}
        />
        {/* Right vertical: top to cap top, cap bottom to bottom rail */}
        <line
          x1={rect.right}
          y1={rect.top}
          x2={rect.right}
          y2={capCenter.y - 12}
          stroke={wireColor}
          strokeWidth={wireW}
        />
        <line
          x1={rect.right}
          y1={capCenter.y + 12}
          x2={rect.right}
          y2={rect.bottom}
          stroke={wireColor}
          strokeWidth={wireW}
        />

        <Coil x={coilCenter.x} y={coilCenter.y} l={L} active={flowActive} />
        <Capacitor x={capCenter.x} y={capCenter.y} c={C} uC={uC} u0={U0} />

        {/* Initial-condition annotation */}
        <text
          x={SCH_X + 8}
          y={SCH_Y + SCH_H - 10}
          fill="#54617A"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={10}
        >
          {labels.u0_label} = {U0} V, i(0) = 0
        </text>

        {/* Flow-direction dots (animated along the loop when |i| > threshold) */}
        {flowActive && (
          <g key={`flow-${flowDir}`}>
            <path
              id="lc-flow-path"
              d={
                flowDir > 0
                  ? // Clockwise: top-left → top-right → cap → bottom → left → top-left
                    `M ${rect.left} ${rect.top} ` +
                    `L ${coilCenter.x - 30} ${rect.top} ` +
                    `M ${coilCenter.x + 30} ${rect.top} ` +
                    `L ${rect.right} ${rect.top} ` +
                    `L ${rect.right} ${capCenter.y - 12} ` +
                    `M ${rect.right} ${capCenter.y + 12} ` +
                    `L ${rect.right} ${rect.bottom} ` +
                    `L ${rect.left} ${rect.bottom} ` +
                    `L ${rect.left} ${rect.top}`
                  : // Counter-clockwise
                    `M ${rect.left} ${rect.top} ` +
                    `L ${rect.left} ${rect.bottom} ` +
                    `L ${rect.right} ${rect.bottom} ` +
                    `L ${rect.right} ${capCenter.y + 12} ` +
                    `M ${rect.right} ${capCenter.y - 12} ` +
                    `L ${rect.right} ${rect.top} ` +
                    `L ${coilCenter.x + 30} ${rect.top} ` +
                    `M ${coilCenter.x - 30} ${rect.top} ` +
                    `L ${rect.left} ${rect.top}`
              }
              fill="none"
              stroke="none"
            />
            {[0, 0.5, 1.0, 1.5].map((delay) => (
              <circle key={`fd${delay}`} r={2.4} fill="#37C9B8">
                <animateMotion
                  dur="2s"
                  repeatCount="indefinite"
                  begin={`${delay}s`}
                  rotate="auto"
                >
                  <mpath href="#lc-flow-path" />
                </animateMotion>
              </circle>
            ))}
          </g>
        )}

        {/* ─── Right panel: u_C(t) plot ─────────────────────────── */}
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
        {/* Axes */}
        <line
          x1={PLOT_X}
          y1={PLOT_Y + PLOT_H}
          x2={PLOT_X + PLOT_W}
          y2={PLOT_Y + PLOT_H}
          stroke="#3A4863"
          strokeWidth={1.5}
        />
        <line
          x1={PLOT_X}
          y1={PLOT_Y}
          x2={PLOT_X}
          y2={PLOT_Y + PLOT_H}
          stroke="#3A4863"
          strokeWidth={1.5}
        />
        {/* Zero baseline through the middle */}
        <line
          x1={PLOT_X}
          y1={ucToSvgY(0)}
          x2={PLOT_X + PLOT_W}
          y2={ucToSvgY(0)}
          stroke="#3A4863"
          strokeWidth={1}
          strokeDasharray="2 3"
          opacity={0.6}
        />

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
          transform={`rotate(-90 ${PLOT_X - 18} ${PLOT_Y + 6})`}
          x={PLOT_X - 18}
          y={PLOT_Y + 6}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={10}
          textAnchor="end"
        >
          {labels.y_axis_label}
        </text>

        {/* Time ticks in milliseconds */}
        {[0, 100, 200, 300, 400].map((tvMs) => (
          <text
            key={`tk${tvMs}`}
            x={tToSvgX(tvMs / 1000)}
            y={PLOT_Y + PLOT_H + 14}
            fill="#54617A"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={9}
            textAnchor="middle"
          >
            {tvMs}
          </text>
        ))}
        {/* Y-axis ticks: -U0, 0, +U0 */}
        {[-U0, 0, U0].map((v) => (
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

        {/* Stage-1 canonical markers — "help" per §4.7, REMOVED on stages 2/3 */}
        {isStage1 && (
          <>
            {/* +U0 and -U0 asymptote lines */}
            <line
              x1={PLOT_X}
              y1={ucToSvgY(U0)}
              x2={PLOT_X + PLOT_W}
              y2={ucToSvgY(U0)}
              stroke="#37C9B8"
              strokeWidth={1}
              strokeDasharray="3 4"
              opacity={0.3}
            />
            <line
              x1={PLOT_X}
              y1={ucToSvgY(-U0)}
              x2={PLOT_X + PLOT_W}
              y2={ucToSvgY(-U0)}
              stroke="#37C9B8"
              strokeWidth={1}
              strokeDasharray="3 4"
              opacity={0.3}
            />
            {/* T0 vertical marker + label — training wheels: only stage 1 */}
            {T0 <= T_SIM_MAX && (
              <>
                <line
                  x1={tToSvgX(T0)}
                  y1={PLOT_Y}
                  x2={tToSvgX(T0)}
                  y2={PLOT_Y + PLOT_H}
                  stroke="#F9A968"
                  strokeWidth={1}
                  strokeDasharray="3 4"
                  opacity={0.5}
                />
                <text
                  x={tToSvgX(T0)}
                  y={PLOT_Y - 4}
                  fill="#F9A968"
                  fontFamily="'JetBrains Mono', monospace"
                  fontSize={9}
                  textAnchor="middle"
                >
                  T₀
                </text>
              </>
            )}
          </>
        )}

        {/* Stage-2: target curve + crosshair */}
        {isStage2 && (
          <>
            <path
              d={stage2TargetPath}
              fill="none"
              stroke="#F97316"
              strokeWidth={1.6}
              opacity={0.6}
              strokeDasharray="4 5"
            />
            <g>
              <circle
                cx={tToSvgX(stage2Target.tStar)}
                cy={ucToSvgY(stage2CrosshairY)}
                r={6}
                fill="#F97316"
              />
              <circle
                cx={tToSvgX(stage2Target.tStar)}
                cy={ucToSvgY(stage2CrosshairY)}
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
                y2={ucToSvgY(stage2CrosshairY)}
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
                t* = {Math.round(stage2Target.tStar * 1000)} ms
              </text>
              <text
                x={PLOT_X - 6}
                y={ucToSvgY(stage2CrosshairY) + 3}
                fill="#F9A968"
                fontFamily="'JetBrains Mono', monospace"
                fontSize={10}
                textAnchor="end"
              >
                V*={stage2CrosshairY.toFixed(1)}
              </text>
            </g>
          </>
        )}

        {/* Stage-3: target curve only (live curve gated behind submit) */}
        {isStage3 && (
          <path
            d={stage3TargetPath}
            fill="none"
            stroke="#F97316"
            strokeWidth={2}
            opacity={0.9}
          />
        )}

        {/* Live trace — HIDDEN on stage 3 pre-submit (§4.7) */}
        {tracePath && (
          <path d={tracePath} fill="none" stroke="#37C9B8" strokeWidth={2} />
        )}

        {/* Live time cursor — only when sim is running visibly (stages 1, 2, or stage-3 post-submit) */}
        {!(isStage3 && !submitted) && tSim > 0 && (
          <line
            x1={tToSvgX(tSim)}
            y1={PLOT_Y}
            x2={tToSvgX(tSim)}
            y2={PLOT_Y + PLOT_H}
            stroke="#F9A968"
            strokeWidth={1}
            opacity={0.25}
          />
        )}
      </svg>

      {/* ─── HUD overlays ──────────────────────────────────────────── */}
      {/* TL: stage badge */}
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
      {/* TR: primary T0 readout (line 1) + energy or peek hint (line 2) */}
      <div
        style={{
          position: 'absolute',
          top: '3rem',
          right: '3rem',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '2.3rem',
          letterSpacing: '0.08em',
          color: '#37C9B8',
          textAlign: 'right',
          zIndex: 5,
          pointerEvents: 'none',
          maxWidth: '48%',
        }}
      >
        <div>{hudTR}</div>
        {hudTR2 && (
          <div
            style={{
              fontSize: '1.6rem',
              marginTop: '0.4rem',
              color: peekVisible && isStage3 ? '#F9A968' : '#6C7A93',
              letterSpacing: '0.06em',
              textTransform: 'none',
            }}
          >
            {hudTR2}
          </div>
        )}
      </div>
      {/* BL: tip */}
      <div
        style={{
          position: 'absolute',
          bottom: '3rem',
          left: '3rem',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '2.3rem',
          letterSpacing: '0.06em',
          color: '#6C7A93',
          zIndex: 5,
          pointerEvents: 'none',
          maxWidth: '48%',
        }}
      >
        {hudBL}
      </div>
      {/* BR: intentionally EMPTY — reserved for parent chrome (fullscreen). */}

      {/* ─── L and C vertical sliders (right column, stacked) ─────── */}
      <div
        style={{
          position: 'absolute',
          top: '9rem',
          right: '3rem',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '2rem',
          zIndex: 6,
        }}
      >
        {/* L slider */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '0.6rem',
          }}
        >
          <div
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '1.6rem',
              color: '#6C7A93',
            }}
          >
            {formatL(L_MAX)}
          </div>
          <div
            style={{
              width: '2rem',
              height: '20rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <input
              type="range"
              min={0}
              max={1000}
              step={1}
              value={Math.round(toLog(L, L_MIN, L_MAX) * 1000)}
              onChange={(e) => {
                setL(fromLog(Number(e.target.value) / 1000, L_MIN, L_MAX))
                setLMoved(true)
              }}
              disabled={isStage3 && submitted}
              style={{
                width: '20rem',
                height: '2rem',
                transform: 'rotate(-90deg)',
                transformOrigin: 'center',
                accentColor: '#37C9B8',
                cursor: isStage3 && submitted ? 'not-allowed' : 'pointer',
              }}
            />
          </div>
          <div
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '1.6rem',
              color: '#6C7A93',
            }}
          >
            {formatL(L_MIN)}
          </div>
          <div
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '1.6rem',
              color: '#37C9B8',
            }}
          >
            L = {formatL(L)}
          </div>
        </div>

        {/* C slider */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '0.6rem',
          }}
        >
          <div
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '1.6rem',
              color: '#6C7A93',
            }}
          >
            {(C_MAX * 1e6).toFixed(0)}µ
          </div>
          <div
            style={{
              width: '2rem',
              height: '20rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
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
                width: '20rem',
                height: '2rem',
                transform: 'rotate(-90deg)',
                transformOrigin: 'center',
                accentColor: '#37C9B8',
                cursor: isStage3 && submitted ? 'not-allowed' : 'pointer',
              }}
            />
          </div>
          <div
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '1.6rem',
              color: '#6C7A93',
            }}
          >
            {(C_MIN * 1e6).toFixed(0)}µ
          </div>
          <div
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '1.6rem',
              color: '#37C9B8',
            }}
          >
            C = {formatC(C)}
          </div>
        </div>
      </div>

      {/* Stage-3 SUBMIT button (bottom-center, pre-submit only) */}
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
          <i
            className="bi bi-play-fill"
            style={{
              marginInlineEnd: '0.6rem',
              fontSize: '2.2rem',
              verticalAlign: '-0.3rem',
            }}
          />
          {labels.submit_button}
        </button>
      )}
    </div>
  )
}
