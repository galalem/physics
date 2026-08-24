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
import { Wall } from './art/Wall'
import { Spring } from './art/Spring'
import { Mass } from './art/Mass'
import { Ground } from './art/Ground'

// ─── Scene constants ────────────────────────────────────────────────────
const W = 800
const H = 450

// Left panel: mass-spring schematic
const SCH_X = 32
const SCH_Y = 60
const SCH_W = 360
const SCH_H = 350

// Right panel: x(t) plot
const PLOT_X = 412
const PLOT_Y = 60
const PLOT_W = 250
const PLOT_H = 350

// ─── Physics constants ─────────────────────────────────────────────────
// Ranges chosen so that period T0 = 2π√(m/k) sits comfortably in [0.3s, 2.8s].
const M_MIN = 0.1 // kg
const M_MAX = 1.0 // kg
const M_DEFAULT = 0.4

const K_MIN = 5 // N/m
const K_MAX = 50 // N/m
const K_DEFAULT = 20

const X0_MIN = 2 // cm (author-facing unit for the graph)
const X0_MAX = 10 // cm
const X0_DEFAULT = 6

// Plot horizontal extent — 6 s shows ~2 full periods at slowest ranges.
const T_SIM_MAX = 6 // seconds

// SHM stays energetic forever; we sample the whole T_SIM_MAX window
// for stage-1 fullCycle detection to work.
const STAGE2_TOL_X = 0.4 // cm — passes through target marker if within ±0.4 cm at t*
const STAGE3_TOL = 0.04 // 4% tolerance on both T0 and x0 in blind stage

// Stage 2 seeded targets: hand-authored (T0*, x0*, t*) triples spanning the
// (period, amplitude) plane. The point marker sits at (t*, x0*·cos(2π·t*/T0*)).
type Stage2Target = { T0Star: number; x0Star: number; tStar: number }
const STAGE2_TARGETS: Stage2Target[] = [
  { T0Star: 1.0, x0Star: 8, tStar: 1.5 }, // marker sits at a peak (t* = 1.5 T0)
  { T0Star: 1.5, x0Star: 6, tStar: 0.75 }, // t* at half-period → x = -6
  { T0Star: 2.0, x0Star: 5, tStar: 0.5 }, // t* at quarter-period → x = 0
  { T0Star: 0.8, x0Star: 9, tStar: 1.0 }, // t* between peaks
  { T0Star: 1.2, x0Star: 7, tStar: 2.4 }, // multi-period, marker at +peak
]

// Stage 3 seeded blind targets: (m*, k*, x0*) — student computes T0* on paper.
type Stage3Target = { mStar: number; kStar: number; x0Star: number }
const STAGE3_TARGETS: Stage3Target[] = [
  { mStar: 0.4, kStar: 25, x0Star: 8 }, // T0* ≈ 0.795 s
  { mStar: 0.5, kStar: 20, x0Star: 6 }, // T0* ≈ 0.993 s
  { mStar: 0.2, kStar: 8, x0Star: 5 }, // T0* ≈ 0.993 s (same T0, different (m,k))
  { mStar: 0.8, kStar: 40, x0Star: 7 }, // T0* ≈ 0.888 s
  { mStar: 0.3, kStar: 12, x0Star: 9 }, // T0* ≈ 0.993 s
]

const dict = { en } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── Physics helpers ────────────────────────────────────────────────────
function omegaOf(m: number, k: number): number {
  return Math.sqrt(k / m)
}
function periodOf(m: number, k: number): number {
  return (2 * Math.PI) / omegaOf(m, k)
}
function xOfT(t: number, x0: number, omega0: number): number {
  return x0 * Math.cos(omega0 * t)
}
function formatT(t: number): string {
  return `${t.toFixed(2)} s`
}
function formatX(x: number): string {
  return `${x.toFixed(1)} cm`
}

// ─── Log-slider mapping ─────────────────────────────────────────────────
function toLog(value: number, min: number, max: number): number {
  return (Math.log(value) - Math.log(min)) / (Math.log(max) - Math.log(min))
}
function fromLog(pos: number, min: number, max: number): number {
  return min * Math.pow(max / min, pos)
}

// ─── Plot coordinate helpers ────────────────────────────────────────────
function tToSvgX(t: number): number {
  return PLOT_X + (t / T_SIM_MAX) * PLOT_W
}
// Y range is symmetric around 0: [-X0_MAX * 1.1, +X0_MAX * 1.1].
const Y_ABS = X0_MAX * 1.1
function xToSvgY(x: number): number {
  return PLOT_Y + PLOT_H / 2 - (x / Y_ABS) * (PLOT_H / 2)
}

function curvePathFor(x0: number, omega0: number): string {
  const steps = 120
  let d = ''
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * T_SIM_MAX
    const x = xOfT(t, x0, omega0)
    const sx = tToSvgX(t)
    const sy = xToSvgY(x)
    d += `${i === 0 ? 'M' : 'L'} ${sx.toFixed(1)} ${sy.toFixed(1)} `
  }
  return d
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

  const T0Star = periodOf(stage3Target.mStar, stage3Target.kStar)
  const x0StarStage3 = stage3Target.x0Star

  const stageIdx = useCurrentStage()
  const setStage = useSetStage()
  const progress = useProgress()
  const complete = useComplete()

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  // ─── Physical state ─────────────────────────────────────────────────
  const [m, setM] = useState(M_DEFAULT)
  const [k, setK] = useState(K_DEFAULT)
  const [x0, setX0] = useState<number>(X0_DEFAULT)
  const [tSim, setTSim] = useState(0)
  const [trace, setTrace] = useState<{ t: number; x: number }[]>([{ t: 0, x: X0_DEFAULT }])

  // Observation coverage (stage 1)
  const [mMoved, setMMoved] = useState(false)
  const [kMoved, setKMoved] = useState(false)
  const [x0Moved, setX0Moved] = useState(false)
  const [fullCycle, setFullCycle] = useState(false)

  // Stage 2 hit
  const [stage2Hit, setStage2Hit] = useState(false)

  // Stage 3 submit
  const [submitted, setSubmitted] = useState(false)

  const omega0 = omegaOf(m, k)
  const T0 = periodOf(m, k)
  const xNow = xOfT(tSim, x0, omega0)

  // Marker point for stage 2 (derived from the seeded triple)
  const stage2Marker = useMemo(() => {
    const { T0Star: T0s, x0Star, tStar } = stage2Target
    const omegaStar = (2 * Math.PI) / T0s
    return { tStar, xStar: x0Star * Math.cos(omegaStar * tStar) }
  }, [stage2Target])

  const resetStageState = useCallback(() => {
    setM(M_DEFAULT)
    setK(K_DEFAULT)
    setX0(X0_DEFAULT)
    setTSim(0)
    setTrace([{ t: 0, x: X0_DEFAULT }])
    setMMoved(false)
    setKMoved(false)
    setX0Moved(false)
    setFullCycle(false)
    setStage2Hit(false)
    setSubmitted(false)
  }, [])
  useReset(resetStageState)

  // ─── Ticker ─────────────────────────────────────────────────────────
  useTicker((dt) => {
    if (isStage3 && !submitted) return
    if (tSim >= T_SIM_MAX) return

    const nxtT = Math.min(tSim + dt, T_SIM_MAX)
    const nxtX = xOfT(nxtT, x0, omega0)

    // Stage 1: full cycle detected when we've simulated at least one T0.
    if (isStage1 && !fullCycle && nxtT >= T0) {
      setFullCycle(true)
    }

    // Stage 2: check hit against the marker point (t*, x*).
    if (isStage2 && !stage2Hit) {
      const { tStar, xStar } = stage2Marker
      if (Math.abs(nxtT - tStar) < 0.08 && Math.abs(nxtX - xStar) < STAGE2_TOL_X) {
        setStage2Hit(true)
      }
    }

    setTSim(nxtT)
    setTrace((prev) => {
      const last = prev[prev.length - 1]
      if (last && nxtT - last.t < 0.03) return prev
      return [...prev, { t: nxtT, x: nxtX }]
    })
  })

  // Recompute trace baseline whenever the student changes params in stages 1/2
  // (so the live curve reflects the current (m, k, x0) without waiting for the
  // whole T_SIM_MAX to replay). We do NOT do this on stage 3 pre-submit.
  useEffect(() => {
    if (isStage3) return
    // Re-sample the trace up to tSim using current parameters.
    setTrace(() => {
      const steps = 100
      const upTo = Math.max(tSim, 0.001)
      const arr: { t: number; x: number }[] = []
      for (let i = 0; i <= steps; i++) {
        const t = (i / steps) * upTo
        arr.push({ t, x: xOfT(t, x0, omega0) })
      }
      return arr
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m, k, x0, isStage3])

  // ─── Advance predicate ──────────────────────────────────────────────
  const stage3Match =
    submitted &&
    Math.abs(T0 - T0Star) / T0Star < STAGE3_TOL &&
    Math.abs(x0 - x0StarStage3) / x0StarStage3 < STAGE3_TOL

  const canSubmit = isStage1
    ? mMoved && kMoved && x0Moved && fullCycle
    : isStage2
      ? stage2Hit
      : stage3Match

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

  const submitStage3 = useCallback(() => {
    setSubmitted(true)
    setTSim(0)
    setTrace([{ t: 0, x: x0 }])
  }, [x0])

  // ─── Peek: reading-method strategy hint, NOT the T0*/x0* values ─────
  const [peekVisible, setPeekVisible] = useState(false)
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

  // ─── Pre-computed paths ─────────────────────────────────────────────
  const stage2TargetPath = useMemo(() => {
    if (!isStage2) return ''
    const { T0Star: T0s, x0Star } = stage2Target
    return curvePathFor(x0Star, (2 * Math.PI) / T0s)
  }, [isStage2, stage2Target])

  const stage3TargetPath = useMemo(() => {
    if (!isStage3) return ''
    return curvePathFor(x0StarStage3, (2 * Math.PI) / T0Star)
  }, [isStage3, x0StarStage3, T0Star])

  const tracePath = useMemo(() => {
    if (isStage3 && !submitted) return ''
    if (trace.length < 2) return ''
    return trace
      .map(
        (p, i) =>
          `${i === 0 ? 'M' : 'L'} ${tToSvgX(p.t).toFixed(1)} ${xToSvgY(p.x).toFixed(1)}`,
      )
      .join(' ')
  }, [trace, isStage3, submitted])

  // ─── Chart machinery ────────────────────────────────────────────────
  const plotGrid: React.ReactNode[] = []
  for (let i = 1; i < 6; i++) {
    const gx = PLOT_X + (i / 6) * PLOT_W
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

  // ─── Schematic geometry ─────────────────────────────────────────────
  const wallX = SCH_X + 30
  const railY = SCH_Y + SCH_H / 2 - 20
  const eqX = SCH_X + SCH_W - 100 // equilibrium position of the mass center
  // Mass visual displacement: map cm → schematic px. 1 cm = 8 px so full
  // amplitude (10 cm) uses 80 px of horizontal travel.
  const CM_TO_PX = 8
  const massX = eqX + xNow * CM_TO_PX
  const groundY = railY + 34

  // ─── HUD strings ────────────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`
  // TR: required-info readouts. On stage 3 shows current T0 and x0 (what the
  // student is aiming to line up with their paper values) — NOT T0* or x0*.
  const hudTR = isStage1
    ? `T0 = ${formatT(T0)} · x = ${formatX(xNow)}`
    : isStage2
      ? stage2Hit
        ? `${labels.hit} · T0 = ${formatT(T0)}`
        : `T0 = ${formatT(T0)} · x0 = ${formatX(x0)}`
      : submitted
        ? stage3Match
          ? `${labels.match_ok} · T0 = ${formatT(T0)}`
          : `${labels.match_off} · ΔT0 = ${((100 * Math.abs(T0 - T0Star)) / T0Star).toFixed(1)}%`
        : `T0 = ${formatT(T0)} · x0 = ${formatX(x0)}`
  const hudBL = isStage1 ? labels.tip1 : isStage2 ? labels.tip2 : labels.tip3
  // BR is reserved for parent chrome (fullscreen). Leave empty.

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block', userSelect: 'none' }}
      >
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        {/* ─── Left panel: schematic ─────────────────────────────────── */}
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

        <Wall x={wallX} y={railY - 40} height={80} />
        <Ground x1={wallX} x2={SCH_X + SCH_W - 20} y={groundY} />

        {/* Equilibrium reference line */}
        <line
          x1={eqX}
          y1={railY - 24}
          x2={eqX}
          y2={groundY}
          stroke="#3A4863"
          strokeWidth={1}
          strokeDasharray="3 4"
          opacity={0.5}
        />
        <text
          x={eqX}
          y={groundY + 14}
          fill="#54617A"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={10}
          textAnchor="middle"
        >
          {labels.equilibrium_label}
        </text>

        {/* Spring + Mass */}
        <Spring
          x1={wallX}
          x2={massX - 10}
          y={railY}
          coils={Math.max(6, Math.round(6 + k / 4))}
          amplitude={7}
        />
        <Mass x={massX} y={railY} m={m} mMin={M_MIN} mMax={M_MAX} />

        {/* Spring label */}
        <text
          x={(wallX + eqX) / 2}
          y={railY - 22}
          fill="#54617A"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={10}
          textAnchor="middle"
        >
          {labels.spring_label}
        </text>
        {/* Mass label above the block */}
        <text
          x={massX}
          y={railY - 20}
          fill="#54617A"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={10}
          textAnchor="middle"
        >
          {labels.mass_label}
        </text>

        {/* ─── Right panel: x(t) chart ────────────────────────────────── */}
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

        {/* Zero line — the equilibrium reference in x(t) space */}
        <line
          x1={PLOT_X}
          y1={xToSvgY(0)}
          x2={PLOT_X + PLOT_W}
          y2={xToSvgY(0)}
          stroke="#3A4863"
          strokeWidth={1.2}
        />
        {/* Left axis */}
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
          y={xToSvgY(0) - 4}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={10}
          textAnchor="end"
        >
          t (s) →
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
          {labels.y_axis_label} →
        </text>

        {/* Time tick labels */}
        {[0, 2, 4, 6].map((tv) => (
          <text
            key={`tk${tv}`}
            x={tToSvgX(tv)}
            y={xToSvgY(0) + 14}
            fill="#54617A"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={9}
            textAnchor="middle"
          >
            {tv}
          </text>
        ))}
        {/* Y-axis tick labels (symmetric) */}
        {[-10, -5, 5, 10].map((xv) => (
          <text
            key={`yk${xv}`}
            x={PLOT_X - 6}
            y={xToSvgY(xv) + 3}
            fill="#54617A"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={9}
            textAnchor="end"
          >
            {xv}
          </text>
        ))}

        {/* Stage 1 canonical markers — training wheels, removed on stage 3 */}
        {isStage1 && (
          <>
            {/* Amplitude horizontal at +x0 and -x0 */}
            <line
              x1={PLOT_X}
              y1={xToSvgY(x0)}
              x2={PLOT_X + PLOT_W}
              y2={xToSvgY(x0)}
              stroke="#37C9B8"
              strokeWidth={1}
              strokeDasharray="3 4"
              opacity={0.35}
            />
            <line
              x1={PLOT_X}
              y1={xToSvgY(-x0)}
              x2={PLOT_X + PLOT_W}
              y2={xToSvgY(-x0)}
              stroke="#37C9B8"
              strokeWidth={1}
              strokeDasharray="3 4"
              opacity={0.35}
            />
            <text
              x={PLOT_X + PLOT_W - 4}
              y={xToSvgY(x0) - 4}
              fill="#37C9B8"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={9}
              textAnchor="end"
            >
              +x0
            </text>
            {/* Period vertical marker at T0 */}
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
                  T0
                </text>
              </>
            )}
          </>
        )}

        {/* Stage 2 target curve + marker point */}
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
              cx={tToSvgX(stage2Marker.tStar)}
              cy={xToSvgY(stage2Marker.xStar)}
              r={6}
              fill="#F97316"
            />
            <circle
              cx={tToSvgX(stage2Marker.tStar)}
              cy={xToSvgY(stage2Marker.xStar)}
              r={11}
              fill="none"
              stroke="#F97316"
              strokeWidth={1}
              opacity={0.5}
            />
            <text
              x={tToSvgX(stage2Marker.tStar)}
              y={xToSvgY(0) + 26}
              fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
              textAnchor="middle"
            >
              t* = {stage2Marker.tStar}s
            </text>
            <text
              x={PLOT_X - 6}
              y={xToSvgY(stage2Marker.xStar) + 3}
              fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
              textAnchor="end"
            >
              x*={stage2Marker.xStar.toFixed(1)}
            </text>
          </>
        )}

        {/* Stage 3 target curve — always visible on stage 3 */}
        {isStage3 && (
          <path
            d={stage3TargetPath}
            fill="none"
            stroke="#F97316"
            strokeWidth={2}
            opacity={0.9}
          />
        )}

        {/* Peek: reading-method text — never a T0 star or x0 star reveal */}
        {isStage3 && peekVisible && (
          <text
            x={PLOT_X + PLOT_W / 2}
            y={PLOT_Y - 22}
            fill="#37C9B8"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={9}
            textAnchor="middle"
          >
            {labels.peek_hint}
          </text>
        )}

        {/* Live trace (hidden on stage 3 pre-submit) */}
        {tracePath && (
          <path d={tracePath} fill="none" stroke="#37C9B8" strokeWidth={2} />
        )}

        {/* Time cursor line — only during observe/experiment, never on stage 3 */}
        {!isStage3 && tSim > 0 && tSim < T_SIM_MAX && (
          <line
            x1={tToSvgX(tSim)}
            y1={PLOT_Y}
            x2={tToSvgX(tSim)}
            y2={PLOT_Y + PLOT_H}
            stroke="#F9A968"
            strokeWidth={1}
            opacity={0.3}
          />
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
      {/* BR: reserved for parent chrome — no overlay */}

      {/* ─── Sliders: m, k, x0 stacked column ─────────────────────────── */}
      <div
        style={{
          position: 'absolute',
          top: '9rem',
          right: '2rem',
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'flex-start',
          gap: '1.4rem',
          zIndex: 6,
        }}
      >
        {/* m slider */}
        <SliderColumn
          topLabel={`${M_MAX.toFixed(1)}`}
          bottomLabel={`${M_MIN.toFixed(1)}`}
          valueLabel={`m = ${m.toFixed(2)} kg`}
          position={toLog(m, M_MIN, M_MAX)}
          onPosition={(p) => {
            setM(fromLog(p, M_MIN, M_MAX))
            setMMoved(true)
          }}
          disabled={isStage3 && submitted}
        />
        {/* k slider */}
        <SliderColumn
          topLabel={`${K_MAX}`}
          bottomLabel={`${K_MIN}`}
          valueLabel={`k = ${k.toFixed(1)} N/m`}
          position={toLog(k, K_MIN, K_MAX)}
          onPosition={(p) => {
            setK(fromLog(p, K_MIN, K_MAX))
            setKMoved(true)
          }}
          disabled={isStage3 && submitted}
        />
        {/* x0 slider (linear) */}
        <SliderColumn
          topLabel={`${X0_MAX}`}
          bottomLabel={`${X0_MIN}`}
          valueLabel={`x0 = ${x0.toFixed(1)} cm`}
          position={(x0 - X0_MIN) / (X0_MAX - X0_MIN)}
          onPosition={(p) => {
            setX0(X0_MIN + p * (X0_MAX - X0_MIN))
            setX0Moved(true)
          }}
          disabled={isStage3 && submitted}
        />
      </div>

      {/* Stage 3: SUBMIT button (bottom center, only before submit) */}
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
            style={{ marginInlineEnd: '0.6rem', fontSize: '2.2rem', verticalAlign: '-0.3rem' }}
          />
          {labels.submit_button}
        </button>
      )}
    </div>
  )
}

// ─── SliderColumn: rotated vertical slider with min/max/value chips ────
type SliderColumnProps = {
  topLabel: string
  bottomLabel: string
  valueLabel: string
  position: number // 0..1
  onPosition: (p: number) => void
  disabled: boolean
}
function SliderColumn({
  topLabel,
  bottomLabel,
  valueLabel,
  position,
  onPosition,
  disabled,
}: SliderColumnProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '0.5rem',
      }}
    >
      <div
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '1.5rem',
          color: '#6C7A93',
        }}
      >
        {topLabel}
      </div>
      <div
        style={{
          width: '2rem',
          height: '22rem',
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
          value={Math.round(Math.max(0, Math.min(1, position)) * 1000)}
          onChange={(e) => onPosition(Number(e.target.value) / 1000)}
          disabled={disabled}
          style={{
            width: '22rem',
            height: '2rem',
            transform: 'rotate(-90deg)',
            transformOrigin: 'center',
            accentColor: '#37C9B8',
            cursor: disabled ? 'not-allowed' : 'pointer',
          }}
        />
      </div>
      <div
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '1.5rem',
          color: '#6C7A93',
        }}
      >
        {bottomLabel}
      </div>
      <div
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '1.5rem',
          color: '#37C9B8',
        }}
      >
        {valueLabel}
      </div>
    </div>
  )
}
