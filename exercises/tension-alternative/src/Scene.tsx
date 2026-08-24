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
import { ACSource } from './art/ACSource'
import { Resistor } from './art/Resistor'

// ─── Scene constants ────────────────────────────────────────────────────
const W = 800
const H = 450

// Left panel: circuit schematic
const SCH_X = 32
const SCH_Y = 60
const SCH_W = 360
const SCH_H = 350

// Right panel: u(t) time-series plot
const PLOT_X = 412
const PLOT_Y = 60
const PLOT_W = 250
const PLOT_H = 350

// Physics constants
const U_MAX_MIN = 2 // V
const U_MAX_MAX = 20 // V
const U_MAX_DEFAULT = 8

const F_MIN = 20 // Hz
const F_MAX = 100 // Hz
const F_DEFAULT = 40

// Chart horizontal extent — 100 ms shows ≥ 2 periods at F_MIN, 10 at F_MAX.
const T_SIM_MAX = 0.1 // seconds
// Real physical seconds are milliseconds-scale; slow the animation by this factor
// so the trace draws across the plot in ~5 seconds of wall-clock.
const TIME_SCALE = 0.02

// Y-axis window: ±22 V leaves headroom above U_MAX_MAX.
const Y_RANGE = 22

// Stage 2 seeded targets: (U_max*, f*) pairs. Student overlays a dashed curve.
const STAGE2_TARGETS: { uMaxStar: number; fStar: number }[] = [
  { uMaxStar: 10, fStar: 50 }, // 50 Hz mains, canonical
  { uMaxStar: 6, fStar: 25 }, // low freq, small amp
  { uMaxStar: 16, fStar: 80 }, // high freq, big amp
  { uMaxStar: 14, fStar: 60 },
  { uMaxStar: 4, fStar: 40 }, // small amp
]
const STAGE2_TOL = 0.08 // ±8% on each parameter

// Stage 3 seeded targets (hidden until submit).
const STAGE3_TARGETS: { uMaxStar: number; fStar: number }[] = [
  { uMaxStar: 12, fStar: 50 }, // mains
  { uMaxStar: 8, fStar: 30 },
  { uMaxStar: 16, fStar: 70 },
  { uMaxStar: 10, fStar: 45 },
  { uMaxStar: 6, fStar: 90 },
]
const STAGE3_TOL = 0.05 // ±5% on each parameter

const dict = { en } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── Physics helpers ────────────────────────────────────────────────────
function acVoltage(t: number, uMax: number, f: number): number {
  return uMax * Math.sin(2 * Math.PI * f * t)
}

function ueff(uMax: number): number {
  return uMax / Math.sqrt(2)
}

function periodMs(f: number): number {
  return 1000 / f
}

function formatMs(ms: number): string {
  if (ms >= 100) return `${ms.toFixed(0)} ms`
  if (ms >= 10) return `${ms.toFixed(1)} ms`
  return `${ms.toFixed(2)} ms`
}

// ─── Coordinate helpers for the plot ────────────────────────────────────
function tToSvgX(tSec: number): number {
  return PLOT_X + (tSec / T_SIM_MAX) * PLOT_W
}
function uToSvgY(u: number): number {
  // Center of plot = 0 V. Positive up, negative down.
  return PLOT_Y + PLOT_H / 2 - (u / Y_RANGE) * (PLOT_H / 2)
}

function sinePathFor(uMax: number, f: number): string {
  const steps = 240
  let d = ''
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * T_SIM_MAX
    const u = acVoltage(t, uMax, f)
    const sx = tToSvgX(t)
    const sy = uToSvgY(u)
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

  const stageIdx = useCurrentStage()
  const setStage = useSetStage()
  const progress = useProgress()
  const complete = useComplete()

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  const [uMax, setUMax] = useState(U_MAX_DEFAULT)
  const [f, setF] = useState(F_DEFAULT)
  const [tSim, setTSim] = useState(0)
  const [trace, setTrace] = useState<{ t: number; u: number }[]>([{ t: 0, u: 0 }])
  const [uMoved, setUMoved] = useState(false)
  const [fMoved, setFMoved] = useState(false)
  const [fullCycle, setFullCycle] = useState(false)
  const [stage2Hit, setStage2Hit] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [peekVisible, setPeekVisible] = useState(false)

  const resetStageState = useCallback(() => {
    setUMax(U_MAX_DEFAULT)
    setF(F_DEFAULT)
    setTSim(0)
    setTrace([{ t: 0, u: 0 }])
    setUMoved(false)
    setFMoved(false)
    setFullCycle(false)
    setStage2Hit(false)
    setSubmitted(false)
    setPeekVisible(false)
  }, [])
  useReset(resetStageState)

  // Parameter-space tolerance checks used for stage-2 hit + stage-3 grade.
  const uMaxErr = (uMax: number, star: number) => Math.abs(uMax - star) / star
  const fErr = (f: number, star: number) => Math.abs(f - star) / star

  useTicker((dt) => {
    // Stage 3 pre-submit: the live curve is HIDDEN — no ticker work needed
    // (target curve is drawn statically). Post-submit: ticker advances to
    // draw the student's live trace.
    if (isStage3 && !submitted) return
    if (tSim >= T_SIM_MAX) return

    // Advance sim clock (scaled from wall-clock)
    const scaledDt = dt * TIME_SCALE
    const nextT = Math.min(tSim + scaledDt, T_SIM_MAX)
    const nextU = acVoltage(nextT, uMax, f)

    // Stage-1 coverage: one full period observed.
    if (isStage1 && nextT >= 1 / f) setFullCycle(true)

    // Stage-2 hit: both parameters within tolerance of target.
    if (isStage2 && !stage2Hit) {
      if (
        uMaxErr(uMax, stage2Target.uMaxStar) < STAGE2_TOL &&
        fErr(f, stage2Target.fStar) < STAGE2_TOL
      ) {
        setStage2Hit(true)
      }
    }

    setTSim(nextT)
    setTrace((prev) => {
      const last = prev[prev.length - 1]
      // Throttle: don't push a point more often than every 0.5 ms of sim time.
      if (last && nextT - last.t < 0.0005) return prev
      return [...prev, { t: nextT, u: nextU }]
    })
  })

  const stage3Grade =
    submitted &&
    uMaxErr(uMax, stage3Target.uMaxStar) < STAGE3_TOL &&
    fErr(f, stage3Target.fStar) < STAGE3_TOL

  const canSubmit = isStage1
    ? uMoved && fMoved && fullCycle
    : isStage2
      ? stage2Hit
      : stage3Grade

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
    setTrace([{ t: 0, u: 0 }])
  }, [])

  // Peek: reading-method text overlay. Does NOT reveal target values.
  usePeek(() => {
    if (!isStage3) return
    setPeekVisible(true)
  })
  useEffect(() => {
    if (!peekVisible) return
    const to = setTimeout(() => setPeekVisible(false), 4000)
    return () => clearTimeout(to)
  }, [peekVisible])

  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  // ─── Pre-computed target paths ──────────────────────────────────────
  const stage2TargetPath = useMemo(() => {
    if (!isStage2) return ''
    return sinePathFor(stage2Target.uMaxStar, stage2Target.fStar)
  }, [isStage2, stage2Target])

  const stage3TargetPath = useMemo(() => {
    if (!isStage3) return ''
    return sinePathFor(stage3Target.uMaxStar, stage3Target.fStar)
  }, [isStage3, stage3Target])

  const tracePath = useMemo(() => {
    if (isStage3 && !submitted) return '' // live curve hidden on blind stage
    if (trace.length < 2) return ''
    let d = ''
    for (let i = 0; i < trace.length; i++) {
      const p = trace[i]!
      const sx = tToSvgX(p.t)
      const sy = uToSvgY(p.u)
      d += `${i === 0 ? 'M' : 'L'} ${sx.toFixed(1)} ${sy.toFixed(1)} `
    }
    return d
  }, [trace, isStage3, submitted])

  // ─── Chart grid + axes ──────────────────────────────────────────────
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

  // ─── Circuit schematic geometry ─────────────────────────────────────
  // Simple series loop: AC source (left) → wire up → Resistor (top-right of
  // schematic panel) → wire down → back to source. Occupies the SW+NE
  // diagonal of the panel; leaves plenty of blank margin around it.
  const loop = {
    left: SCH_X + 60,
    right: SCH_X + SCH_W - 60,
    top: SCH_Y + 90,
    bottom: SCH_Y + SCH_H - 90,
  }
  const source = { x: loop.left, y: (loop.top + loop.bottom) / 2 }
  const resistor = { x: (loop.left + loop.right) / 2 + 10, y: loop.top }
  const wireStroke = '#54617A'
  const wireW = 1.6

  // HUD strings
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`
  // Stages 1 & 2: show derived quantities live (U_eff, T) — pedagogical read.
  // Stage 3: show slider values only (U_max, f). U_eff and T are what the
  // student computes on paper; showing them would be help, not required info.
  const hudTR = isStage3
    ? `U_max = ${uMax.toFixed(1)} V · f = ${Math.round(f)} Hz`
    : `U_eff = ${ueff(uMax).toFixed(2)} V · T = ${formatMs(periodMs(f))}`
  const hudBL = isStage1 ? labels.tip1 : isStage2 ? labels.tip2 : labels.tip3
  // BR reserved for parent chrome (fullscreen toggle) — LEAVE EMPTY.

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block', userSelect: 'none' }}
      >
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        {/* ─── Left panel: AC circuit schematic ────────────────────── */}
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

        {/* Wires: source top → top rail → resistor left */}
        <line
          x1={source.x}
          y1={source.y - 22}
          x2={source.x}
          y2={loop.top}
          stroke={wireStroke}
          strokeWidth={wireW}
        />
        <line
          x1={source.x}
          y1={loop.top}
          x2={resistor.x - 22}
          y2={loop.top}
          stroke={wireStroke}
          strokeWidth={wireW}
        />
        {/* resistor right → down → back to source bottom */}
        <line
          x1={resistor.x + 22}
          y1={loop.top}
          x2={loop.right}
          y2={loop.top}
          stroke={wireStroke}
          strokeWidth={wireW}
        />
        <line
          x1={loop.right}
          y1={loop.top}
          x2={loop.right}
          y2={loop.bottom}
          stroke={wireStroke}
          strokeWidth={wireW}
        />
        <line
          x1={loop.right}
          y1={loop.bottom}
          x2={source.x}
          y2={loop.bottom}
          stroke={wireStroke}
          strokeWidth={wireW}
        />
        <line
          x1={source.x}
          y1={loop.bottom}
          x2={source.x}
          y2={source.y + 22}
          stroke={wireStroke}
          strokeWidth={wireW}
        />

        <ACSource x={source.x} y={source.y} uMax={uMax} f={f} />
        <Resistor x={resistor.x} y={resistor.y} label={labels.resistor_label} />

        {/* ─── Right panel: u(t) plot ──────────────────────────────── */}
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
        {/* Zero-line (t-axis at u=0) — always visible */}
        <line
          x1={PLOT_X}
          y1={uToSvgY(0)}
          x2={PLOT_X + PLOT_W}
          y2={uToSvgY(0)}
          stroke="#3A4863"
          strokeWidth={1.5}
        />
        {/* Y-axis */}
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
          y={uToSvgY(0) + 14}
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
          {labels.y_axis_label} →
        </text>
        {/* Time tick labels (in ms). T_SIM_MAX = 0.1s = 100 ms. */}
        {[0, 25, 50, 75, 100].map((tMs) => (
          <text
            key={`tk${tMs}`}
            x={tToSvgX(tMs / 1000)}
            y={uToSvgY(0) + 26}
            fill="#54617A"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={9}
            textAnchor="middle"
          >
            {tMs}
          </text>
        ))}
        {/* Y-axis tick labels — symmetric around zero. */}
        {[-20, -10, 0, 10, 20].map((v) => (
          <text
            key={`yk${v}`}
            x={PLOT_X - 6}
            y={uToSvgY(v) + 3}
            fill="#54617A"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={9}
            textAnchor="end"
          >
            {v}
          </text>
        ))}

        {/* Stage-1 canonical markers (training wheels — REMOVED on stages 2 & 3) */}
        {isStage1 && (
          <>
            {/* +U_max envelope */}
            <line
              x1={PLOT_X}
              y1={uToSvgY(uMax)}
              x2={PLOT_X + PLOT_W}
              y2={uToSvgY(uMax)}
              stroke="#37C9B8"
              strokeWidth={1}
              strokeDasharray="3 4"
              opacity={0.35}
            />
            <text
              x={PLOT_X + PLOT_W - 4}
              y={uToSvgY(uMax) - 4}
              fill="#37C9B8"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={9}
              textAnchor="end"
            >
              +U_max
            </text>
            {/* -U_max envelope */}
            <line
              x1={PLOT_X}
              y1={uToSvgY(-uMax)}
              x2={PLOT_X + PLOT_W}
              y2={uToSvgY(-uMax)}
              stroke="#37C9B8"
              strokeWidth={1}
              strokeDasharray="3 4"
              opacity={0.35}
            />
            {/* +U_eff and -U_eff — multimeter reading */}
            <line
              x1={PLOT_X}
              y1={uToSvgY(ueff(uMax))}
              x2={PLOT_X + PLOT_W}
              y2={uToSvgY(ueff(uMax))}
              stroke="#F9A968"
              strokeWidth={1}
              strokeDasharray="3 4"
              opacity={0.4}
            />
            <text
              x={PLOT_X + PLOT_W - 4}
              y={uToSvgY(ueff(uMax)) - 4}
              fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={9}
              textAnchor="end"
            >
              U_eff
            </text>
            <line
              x1={PLOT_X}
              y1={uToSvgY(-ueff(uMax))}
              x2={PLOT_X + PLOT_W}
              y2={uToSvgY(-ueff(uMax))}
              stroke="#F9A968"
              strokeWidth={1}
              strokeDasharray="3 4"
              opacity={0.4}
            />
            {/* Vertical marker at t = T (first period boundary) — hidden if
                T falls outside the visible window (safety at very low f). */}
            {1 / f <= T_SIM_MAX && (
              <>
                <line
                  x1={tToSvgX(1 / f)}
                  y1={PLOT_Y}
                  x2={tToSvgX(1 / f)}
                  y2={PLOT_Y + PLOT_H}
                  stroke="#F9A968"
                  strokeWidth={1}
                  strokeDasharray="3 4"
                  opacity={0.4}
                />
                <text
                  x={tToSvgX(1 / f)}
                  y={PLOT_Y - 4}
                  fill="#F9A968"
                  fontFamily="'JetBrains Mono', monospace"
                  fontSize={9}
                  textAnchor="middle"
                >
                  T
                </text>
              </>
            )}
          </>
        )}

        {/* Stage-2 target curve (dashed) */}
        {isStage2 && (
          <path
            d={stage2TargetPath}
            fill="none"
            stroke="#F97316"
            strokeWidth={1.6}
            opacity={0.7}
            strokeDasharray="4 5"
          />
        )}

        {/* Stage-3 target curve (solid, always visible on stage 3) */}
        {isStage3 && (
          <path d={stage3TargetPath} fill="none" stroke="#F97316" strokeWidth={2} opacity={0.9} />
        )}

        {/* Peek text: reading-method hint. Does NOT reveal U_max* or f*. */}
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
        {tracePath && <path d={tracePath} fill="none" stroke="#37C9B8" strokeWidth={2} />}

        {/* Sim time cursor (a subtle vertical) — only on stages 1 & 2. */}
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

      {/* ─── HUD overlays (HTML, rem-sized) ──────────────────────────── */}
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
      {/* BR corner: intentionally empty — reserved for parent chrome (fullscreen toggle). */}

      {/* Post-submit feedback line (stage 3 only) — under the plot title area */}
      {isStage3 && submitted && (
        <div
          style={{
            position: 'absolute',
            top: '6rem',
            left: '52rem',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '1.8rem',
            letterSpacing: '0.06em',
            color: stage3Grade ? '#37C9B8' : '#F97316',
            zIndex: 5,
            pointerEvents: 'none',
          }}
        >
          {stage3Grade
            ? `✓ ${labels.match_ok}`
            : `${labels.match_off} · ΔU=${(100 * uMaxErr(uMax, stage3Target.uMaxStar)).toFixed(0)}% · Δf=${(100 * fErr(f, stage3Target.fStar)).toFixed(0)}%`}
        </div>
      )}

      {/* ─── U_max and f vertical sliders (top-right, stacked column) ── */}
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
        {/* U_max slider */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.6rem' }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.6rem', color: '#6C7A93' }}>
            {U_MAX_MAX}V
          </div>
          <div style={{ width: '2rem', height: '20rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <input
              type="range"
              min={U_MAX_MIN}
              max={U_MAX_MAX}
              step={0.1}
              value={uMax}
              onChange={(e) => {
                setUMax(Number(e.target.value))
                setUMoved(true)
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
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.6rem', color: '#6C7A93' }}>
            {U_MAX_MIN}V
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.6rem', color: '#37C9B8' }}>
            {labels.param1_name} = {uMax.toFixed(1)}V
          </div>
        </div>
        {/* f slider */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.6rem' }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.6rem', color: '#6C7A93' }}>
            {F_MAX}Hz
          </div>
          <div style={{ width: '2rem', height: '20rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <input
              type="range"
              min={F_MIN}
              max={F_MAX}
              step={1}
              value={f}
              onChange={(e) => {
                setF(Number(e.target.value))
                setFMoved(true)
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
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.6rem', color: '#6C7A93' }}>
            {F_MIN}Hz
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.6rem', color: '#37C9B8' }}>
            {labels.param2_name} = {Math.round(f)}Hz
          </div>
        </div>
      </div>

      {/* Stage 3 SUBMIT button (bottom center, only pre-submit) */}
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
