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
import { Beaker } from './art/Beaker'
import { HotPlate } from './art/HotPlate'
import { Thermometer } from './art/Thermometer'

// ─── Scene constants ────────────────────────────────────────────────────
const W = 800
const H = 450

// Left panel: beaker + hot-plate schematic
const SCH_X = 32
const SCH_Y = 60
const SCH_W = 360
const SCH_H = 350

// Right panel: T(t) time-series plot
const PLOT_X = 412
const PLOT_Y = 60
const PLOT_W = 250
const PLOT_H = 350

// ─── Physics constants (2ème année — water, sensible heat) ──────────────
// c is the specific heat capacity of water. Q = m·c·ΔT.
const C_WATER = 4180 // J·kg⁻¹·K⁻¹
const T_INITIAL = 20 // °C — starting temperature of the water
const T_DISPLAY_MIN = 15 // °C — bottom of plot
const T_DISPLAY_MAX = 110 // °C — top of plot (above boiling)
const T_BOIL = 100 // °C — canonical boiling reference
const T_FULL_CYCLE = 80 // °C — stage 1 must reach this once
const T_SIM_MAX = 60 // seconds — plot horizontal extent

// Sliders (log-scaled, both single-decade)
const P_MIN = 200 // W
const P_MAX = 2000 // W
const P_DEFAULT = 600 // W
const M_MIN = 0.1 // kg
const M_MAX = 1.0 // kg
const M_DEFAULT = 0.5 // kg

// Tolerances (both on k = P/(m·c), the slope in °C/s)
const STAGE2_TOL = 0.05 // ±5 % T at t*
const STAGE3_TOL = 0.03 // ±3 % on slope k

// ─── Seeded targets (hand-authored — case-coverage) ─────────────────────
// Stage 2: (t*, T*) crosshair on the T(t) line. Slope k* = (T*−T0)/t*
// covers a decent spread across the achievable [k_min, k_max] range.
const STAGE2_TARGETS: { tStar: number; tempStar: number }[] = [
  { tStar: 30, tempStar: 50 }, // k* = 1.00 °C/s
  { tStar: 20, tempStar: 60 }, // k* = 2.00 °C/s
  { tStar: 40, tempStar: 90 }, // k* = 1.75 °C/s
  { tStar: 50, tempStar: 45 }, // k* = 0.50 °C/s
  { tStar: 25, tempStar: 70 }, // k* = 2.00 °C/s
]

// Stage 3: hidden (P*, m*) pairs producing distinct slopes k*.
// Spread across a wide range so the student can't guess a single answer.
const STAGE3_TARGETS: { pStar: number; mStar: number }[] = [
  { pStar: 1000, mStar: 0.5 }, // k* = 0.479 °C/s
  { pStar: 1500, mStar: 0.3 }, // k* = 1.197 °C/s
  { pStar: 800, mStar: 0.4 }, // k* = 0.478 °C/s (dupe slope OK — different (P,m))
  { pStar: 1200, mStar: 0.2 }, // k* = 1.435 °C/s
  { pStar: 600, mStar: 0.5 }, // k* = 0.287 °C/s
]

// ─── Physics helpers ────────────────────────────────────────────────────
/**
 * Exact integrator for a constant-rate ODE (dT/dt = k):
 *   T(t + dt) = T(t) + k·dt
 * With constant power P and mass m, dT/dt is a constant slope, so this
 * IS the exact closed-form update — no numerical approximation involved.
 * (The RC/RL exp-integrator form does not apply here: the ODE is not
 * first-order relaxation, it's a constant-drive linear rise.)
 */
function stepTemp(T: number, k: number, dt: number, tMax: number): number {
  return Math.min(T + k * dt, tMax)
}

/** k = P / (m · c) in °C/s */
function slopeFor(power: number, mass: number): number {
  return power / (mass * C_WATER)
}

function formatK(k: number): string {
  if (k < 0.01) return `${(k * 1000).toFixed(0)} m°C/s`
  if (k < 1) return `${k.toFixed(3)} °C/s`
  return `${k.toFixed(2)} °C/s`
}

function formatP(p: number): string {
  if (p >= 1000) return `${(p / 1000).toFixed(p >= 10000 ? 0 : 2)} kW`
  return `${Math.round(p)} W`
}

function formatMass(m: number): string {
  if (m < 1) return `${(m * 1000).toFixed(0)} g`
  return `${m.toFixed(2)} kg`
}

function formatQ(qJoules: number): string {
  if (qJoules >= 1000) return `${(qJoules / 1000).toFixed(1)} kJ`
  return `${qJoules.toFixed(0)} J`
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
function tempToSvgY(temp: number): number {
  const frac = (temp - T_DISPLAY_MIN) / (T_DISPLAY_MAX - T_DISPLAY_MIN)
  return PLOT_Y + PLOT_H - frac * PLOT_H
}

/** Pre-compute a linear temperature-rise path clipped at plot top. */
function tempPathFor(k: number): string {
  const steps = 40
  let d = ''
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * T_SIM_MAX
    const temp = Math.min(T_DISPLAY_MAX, T_INITIAL + k * t)
    const sx = tToSvgX(t)
    const sy = tempToSvgY(temp)
    d += `${i === 0 ? 'M' : 'L'} ${sx.toFixed(1)} ${sy.toFixed(1)} `
  }
  return d
}

// ─── Label loader ──────────────────────────────────────────────────────
const dict = { en } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── Component ─────────────────────────────────────────────────────────
export default function Scene() {
  const { locale, seed } = useInit()
  const stages = useMemo(() => getStagesFor(locale), [locale])
  useDeclareStages(stages)
  const labels = useMemo(() => svgLabels(locale), [locale])
  const rootRng = useSeed()

  // Seed-indexed target picks (deterministic)
  const stage2Target = useMemo(() => {
    void rootRng
    return STAGE2_TARGETS[seed % STAGE2_TARGETS.length]!
  }, [seed, rootRng])
  const stage3Target = useMemo(
    () => STAGE3_TARGETS[(seed + 1) % STAGE3_TARGETS.length]!,
    [seed],
  )
  const kStar = slopeFor(stage3Target.pStar, stage3Target.mStar)

  const stageIdx = useCurrentStage()
  const setStage = useSetStage()
  const progress = useProgress()
  const complete = useComplete()

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  // ─── Physical state ─────────────────────────────────────────────────
  const [power, setPower] = useState(P_DEFAULT)
  const [mass, setMass] = useState(M_DEFAULT)
  const [temp, setTemp] = useState(T_INITIAL)
  const [tSim, setTSim] = useState(0)
  const [trace, setTrace] = useState<{ t: number; temp: number }[]>([
    { t: 0, temp: T_INITIAL },
  ])

  // Stage 1 coverage flags
  const [pMoved, setPMoved] = useState(false)
  const [mMoved, setMMoved] = useState(false)
  const [reachedTarget, setReachedTarget] = useState(false)

  // Stage 2 hit flag
  const [stage2Hit, setStage2Hit] = useState(false)

  // Stage 3 flow
  const [submitted, setSubmitted] = useState(false)
  const [peekVisible, setPeekVisible] = useState(false)

  const k = slopeFor(power, mass)
  // Q from Q = m·c·ΔT (equivalently P·tSim for constant power; we use the
  // ΔT form to keep the readout aligned with what the student computes).
  const qJoules = mass * C_WATER * Math.max(0, temp - T_INITIAL)

  const resetStageState = useCallback(() => {
    setPower(P_DEFAULT)
    setMass(M_DEFAULT)
    setTemp(T_INITIAL)
    setTSim(0)
    setTrace([{ t: 0, temp: T_INITIAL }])
    setPMoved(false)
    setMMoved(false)
    setReachedTarget(false)
    setStage2Hit(false)
    setSubmitted(false)
    setPeekVisible(false)
  }, [])
  useReset(resetStageState)

  // ─── Ticker (linear closed-form advance) ─────────────────────────────
  useTicker((dt) => {
    // Stage 3: sim only runs AFTER submit (draws the student's line then).
    if (isStage3 && !submitted) return
    if (tSim >= T_SIM_MAX) return

    const next = stepTemp(temp, k, dt, T_DISPLAY_MAX)
    setTemp(next)

    // Stage 1 coverage: has the student crossed T_FULL_CYCLE at least once?
    if (isStage1 && next >= T_FULL_CYCLE) setReachedTarget(true)

    // Stage 2 hit detection: line passes through (t*, T*) crosshair
    if (isStage2 && !stage2Hit) {
      const { tStar, tempStar } = stage2Target
      if (Math.abs(tSim - tStar) < 0.35) {
        const tempSpan = T_DISPLAY_MAX - T_INITIAL
        if (Math.abs(next - tempStar) / tempSpan < STAGE2_TOL) {
          setStage2Hit(true)
        }
      }
    }

    setTSim((prev) => {
      const nxt = Math.min(prev + dt, T_SIM_MAX)
      setTrace((prevTrace) => {
        const last = prevTrace[prevTrace.length - 1]
        if (last && nxt - last.t < 0.05) return prevTrace
        return [...prevTrace, { t: nxt, temp: next }]
      })
      return nxt
    })
  })

  // ─── Advance predicate ───────────────────────────────────────────────
  const canSubmit = isStage1
    ? pMoved && mMoved && reachedTarget
    : isStage2
      ? stage2Hit
      : submitted && Math.abs(k - kStar) / kStar < STAGE3_TOL

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

  // Stage 3 submit: reveal the student's line by re-running the sim from 0.
  const submitStage3 = useCallback(() => {
    setSubmitted(true)
    setTemp(T_INITIAL)
    setTSim(0)
    setTrace([{ t: 0, temp: T_INITIAL }])
  }, [])

  // ─── Peek: reading-method hint ONLY (§4.7 rule 4) ────────────────────
  // Does NOT reveal k*, does NOT draw the live line. Copy is a static
  // reading method from `labels.peek_hint`.
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

  // ─── Pre-computed paths (memoized) ───────────────────────────────────
  const stage2TargetPath = useMemo(() => {
    if (!isStage2) return ''
    const { tStar, tempStar } = stage2Target
    const kTarget = (tempStar - T_INITIAL) / tStar
    return tempPathFor(kTarget)
  }, [isStage2, stage2Target])

  const stage3TargetPath = useMemo(() => {
    if (!isStage3) return ''
    return tempPathFor(kStar)
  }, [isStage3, kStar])

  const tracePath = useMemo(() => {
    if (isStage3 && !submitted) return '' // blind stage: hide live line pre-submit
    if (trace.length < 2) return ''
    return trace
      .map(
        (p, i) =>
          `${i === 0 ? 'M' : 'L'} ${tToSvgX(p.t).toFixed(1)} ${tempToSvgY(p.temp).toFixed(1)}`,
      )
      .join(' ')
  }, [trace, isStage3, submitted])

  // Plot grid (built inline)
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

  // ─── HUD strings ─────────────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`
  // TR = the invariant scalar the student is targeting (analogous to τ).
  // On stage 3 after submit, augment with diff percentage.
  const kDiffPct = submitted && isStage3 ? (100 * Math.abs(k - kStar)) / kStar : 0
  const hudTR = isStage3
    ? submitted
      ? kDiffPct < STAGE3_TOL * 100
        ? `${labels.match_ok} · k = ${formatK(k)}`
        : `${labels.match_off} · Δk = ${kDiffPct.toFixed(1)}%`
      : `k = ${formatK(k)}` // required info during blind adjustment
    : isStage2
      ? stage2Hit
        ? `${labels.hit} · k = ${formatK(k)}`
        : `k = ${formatK(k)}`
      : `k = ${formatK(k)}`
  const hudBL = isStage1 ? labels.tip1 : isStage2 ? labels.tip2 : labels.tip3
  // BR: reserved for parent chrome (fullscreen). Leave empty.

  // ─── Beaker + hot plate geometry ─────────────────────────────────────
  const beakerW = 130
  const beakerH = 170
  const beakerX = SCH_X + 40
  const beakerY = SCH_Y + 80
  const plateW = 200
  const plateH = 26
  const plateX = beakerX - 35
  const plateY = beakerY + beakerH + 6
  const thermoX = beakerX + beakerW + 26
  const thermoY = beakerY + beakerH - 10
  const thermoH = 160

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block', userSelect: 'none' }}
      >
        {/* NO borderRadius on <svg>. NO rx on the bg <rect>. */}
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        {/* ── Left panel: beaker + hot plate ───────────────────────── */}
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
          {labels.scene}
        </text>

        <Beaker x={beakerX} y={beakerY} w={beakerW} h={beakerH} tempC={temp} />
        <HotPlate
          x={plateX}
          y={plateY}
          w={plateW}
          h={plateH}
          power={power}
          pMin={P_MIN}
          pMax={P_MAX}
        />
        <Thermometer
          x={thermoX}
          y={thermoY}
          h={thermoH}
          tempC={temp}
          tMin={T_DISPLAY_MIN}
          tMax={T_DISPLAY_MAX}
        />

        {/* Component labels */}
        <text
          x={beakerX + beakerW / 2}
          y={beakerY - 6}
          fill="#B9C4D6"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={11}
          textAnchor="middle"
        >
          {labels.water} · m = {formatMass(mass)}
        </text>
        <text
          x={plateX + plateW / 2}
          y={plateY + plateH + 18}
          fill="#B9C4D6"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={11}
          textAnchor="middle"
        >
          {labels.hot_plate} · P = {formatP(power)}
        </text>
        <text
          x={thermoX}
          y={thermoY - thermoH - 8}
          fill="#F9A968"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={11}
          textAnchor="middle"
        >
          T = {temp.toFixed(1)}°C
        </text>
        {/* Q readout under thermometer */}
        <text
          x={thermoX}
          y={thermoY + 20}
          fill="#54617A"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={9}
          textAnchor="middle"
        >
          Q = {formatQ(qJoules)}
        </text>

        {/* ── Right panel: T(t) plot ──────────────────────────────── */}
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
        {/* Time ticks */}
        {[0, 20, 40, 60].map((tv) => (
          <text
            key={`tk${tv}`}
            x={tToSvgX(tv)}
            y={PLOT_Y + PLOT_H + 14}
            fill="#54617A"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={9}
            textAnchor="middle"
          >
            {tv}
          </text>
        ))}
        {/* Temperature ticks */}
        {[20, 40, 60, 80, 100].map((tv) => (
          <text
            key={`yk${tv}`}
            x={PLOT_X - 6}
            y={tempToSvgY(tv) + 3}
            fill="#54617A"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={9}
            textAnchor="end"
          >
            {tv}
          </text>
        ))}

        {/* Fixed physical reference — boiling line — always visible.
            This is a physical fact (100 °C is water's boiling point), NOT
            a training-wheel derived from the student's slider values, so
            it stays on stage 3. */}
        <line
          x1={PLOT_X}
          y1={tempToSvgY(T_BOIL)}
          x2={PLOT_X + PLOT_W}
          y2={tempToSvgY(T_BOIL)}
          stroke="#F97316"
          strokeWidth={1}
          strokeDasharray="3 4"
          opacity={0.35}
        />
        <text
          x={PLOT_X + PLOT_W - 4}
          y={tempToSvgY(T_BOIL) - 4}
          fill="#F9A968"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={9}
          textAnchor="end"
        >
          {labels.boiling}
        </text>

        {/* ── Stage-1 canonical markers (TRAINING WHEELS — removed on stages 2 & 3) ── */}
        {isStage1 && (
          <>
            {/* Current-slope preview: dashed line showing where the
                student's k would land at t = T_SIM_MAX. Removed on
                blind stage — this is "help". */}
            <path
              d={tempPathFor(k)}
              fill="none"
              stroke="#37C9B8"
              strokeWidth={1}
              strokeDasharray="2 4"
              opacity={0.35}
            />
            {/* T_FULL_CYCLE marker */}
            <line
              x1={PLOT_X}
              y1={tempToSvgY(T_FULL_CYCLE)}
              x2={PLOT_X + PLOT_W}
              y2={tempToSvgY(T_FULL_CYCLE)}
              stroke="#F9A968"
              strokeWidth={1}
              strokeDasharray="3 4"
              opacity={0.3}
            />
            <text
              x={PLOT_X + 4}
              y={tempToSvgY(T_FULL_CYCLE) - 4}
              fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={9}
            >
              80°C
            </text>
          </>
        )}

        {/* ── Stage-2 target crosshair ────────────────────────────── */}
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
            <circle
              cx={tToSvgX(stage2Target.tStar)}
              cy={tempToSvgY(stage2Target.tempStar)}
              r={6}
              fill="#F97316"
            />
            <circle
              cx={tToSvgX(stage2Target.tStar)}
              cy={tempToSvgY(stage2Target.tempStar)}
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
              y2={tempToSvgY(stage2Target.tempStar)}
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
              t* = {stage2Target.tStar}s
            </text>
            <text
              x={PLOT_X - 6}
              y={tempToSvgY(stage2Target.tempStar) + 3}
              fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
              textAnchor="end"
            >
              T*={stage2Target.tempStar}
            </text>
          </>
        )}

        {/* ── Stage-3 target line (always visible on stage 3) ────── */}
        {isStage3 && (
          <path
            d={stage3TargetPath}
            fill="none"
            stroke="#F97316"
            strokeWidth={2}
            opacity={0.9}
          />
        )}

        {/* Peek — text overlay above the chart, ONLY the reading method */}
        {isStage3 && peekVisible && (
          <>
            <rect
              x={PLOT_X}
              y={PLOT_Y - 44}
              width={PLOT_W}
              height={26}
              rx={4}
              fill="#0D1524"
              stroke="#37C9B8"
              strokeWidth={1}
              opacity={0.9}
            />
            <text
              x={PLOT_X + PLOT_W / 2}
              y={PLOT_Y - 27}
              fill="#37C9B8"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={9}
              textAnchor="middle"
            >
              {labels.peek_hint}
            </text>
          </>
        )}

        {/* Live trace (hidden on stage 3 pre-submit — see tracePath memo) */}
        {tracePath && (
          <path d={tracePath} fill="none" stroke="#37C9B8" strokeWidth={2} />
        )}

        {/* Live time cursor — hidden on stage 3 pre-submit; also hidden
            when sim hasn't started */}
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

      {/* ── HUD overlays (HTML in rem — NOT SVG text) ───────────────── */}
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
          fontSize: '2.3rem',
          letterSpacing: '0.08em',
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
      {/* NO bottom-right overlay — reserved for parent chrome. */}

      {/* ── Vertical parameter sliders (P and m) ────────────────────── */}
      <div
        style={{
          position: 'absolute',
          top: '6rem',
          right: '3rem',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '2rem',
          zIndex: 6,
        }}
      >
        {/* P slider */}
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
            {P_MAX} W
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
              value={Math.round(toLog(power, P_MIN, P_MAX) * 1000)}
              onChange={(e) => {
                setPower(fromLog(Number(e.target.value) / 1000, P_MIN, P_MAX))
                setPMoved(true)
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
            {P_MIN} W
          </div>
          <div
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '1.6rem',
              color: '#37C9B8',
            }}
          >
            P = {formatP(power)}
          </div>
        </div>
        {/* m slider */}
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
            {M_MAX.toFixed(1)} kg
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
              value={Math.round(toLog(mass, M_MIN, M_MAX) * 1000)}
              onChange={(e) => {
                setMass(fromLog(Number(e.target.value) / 1000, M_MIN, M_MAX))
                setMMoved(true)
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
            {(M_MIN * 1000).toFixed(0)} g
          </div>
          <div
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '1.6rem',
              color: '#37C9B8',
            }}
          >
            m = {formatMass(mass)}
          </div>
        </div>
      </div>

      {/* ── Stage-3 SUBMIT button ───────────────────────────────────── */}
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
