import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  useSetStage,
  useTicker,
} from '@physics/sdk/react'
import { getHintFor, getStagesFor } from './stages'
import en from '../i18n/en.json'
import fr from '../i18n/fr.json'
import ar from '../i18n/ar.json'
import { Car } from './art/Car'
import { Track } from './art/Track'
import { Wall } from './art/Wall'
import { StopZone } from './art/StopZone'

// ─── Scene constants ────────────────────────────────────────────────────
const W = 800
const H = 450

// Track scene (left half): car origin at SVG (ORIGIN_X, ROAD_Y).
// Right half hosts the mini-graphs.
const ORIGIN_X = 70
const ROAD_Y = 260
const TRACK_END_X = 520
const PX_PER_M = 4.2 // ~100 m of track in ~420 SVG units

// Right-panel mini-graphs.
const PANEL_X = 550
const PANEL_W = 220
const GRAPH_ROW_H = 100
const GRAPH_GAP = 18
const GRAPH_TOP = 30 // first graph top edge

// Physics constants.
const V0_MIN = 5
const V0_MAX = 30 // m/s
const A_MIN = -6
const A_MAX = 6 // m/s²
const A_STEP = 0.1
const V0_STEP = 1
const HIT_R_M = 1.5 // metres — tolerance for "stopped at target"
const SPEED_FACTOR = 2
const T_MAX = 12 // seconds of sim clock before we auto-stop (safety)
const DEFAULT_V0 = 15
const DEFAULT_A = -2

// ─── Setup types ────────────────────────────────────────────────────────
type StopTarget = { id: string; deltaX: number } // metres from car origin
type Setup2 = { wallX: number; targets: StopTarget[] } // wallX in metres; targets ordered
type Setup3 = { wallX: number; v0: number; targets: StopTarget[] } // v0 fixed; a is the unknown

// Stage 2: student is free on v0 and a. Three ordered targets per setup;
// each is completed by stopping the car within HIT_R_M of the target Δx.
// Wall is further than the furthest target so overshoots crash.
const STAGE2_SETUPS: Setup2[] = [
  { wallX: 90, targets: [{ id: 's0a', deltaX: 30 }, { id: 's0b', deltaX: 55 }, { id: 's0c', deltaX: 75 }] },
  { wallX: 95, targets: [{ id: 's1a', deltaX: 25 }, { id: 's1b', deltaX: 60 }, { id: 's1c', deltaX: 80 }] },
  { wallX: 85, targets: [{ id: 's2a', deltaX: 40 }, { id: 's2b', deltaX: 65 }, { id: 's2c', deltaX: 78 }] },
  { wallX: 92, targets: [{ id: 's3a', deltaX: 35 }, { id: 's3b', deltaX: 50 }, { id: 's3c', deltaX: 82 }] },
  { wallX: 88, targets: [{ id: 's4a', deltaX: 28 }, { id: 's4b', deltaX: 58 }, { id: 's4c', deltaX: 76 }] },
]

// Stage 3: v0 fixed by setup, single target Δx per shot. Student computes
// a = -v0² / (2·Δx). Numbers picked so a lands on clean slider values.
// Each setup contains 3 (v0, Δx) pairs; per §5.2 the shot budget = number
// of targets so miss counts irreversibly.
//
// Solutions per setup (a in m/s²):
//   Setup 0:  v0=20 Δx=50 → a=-4.0;  v0=15 Δx=45 → a=-2.5;  v0=10 Δx=25 → a=-2.0
//   Setup 1:  v0=18 Δx=54 → a=-3.0;  v0=24 Δx=48 → a=-6.0;  v0=12 Δx=36 → a=-2.0
//   Setup 2:  v0=25 Δx=62.5 → a=-5.0; v0=15 Δx=37.5 → a=-3.0; v0=20 Δx=40 → a=-5.0
//   Setup 3:  v0=16 Δx=64 → a=-2.0;  v0=20 Δx=50 → a=-4.0;  v0=22 Δx=44 → a=-5.5
//   Setup 4:  v0=14 Δx=49 → a=-2.0;  v0=21 Δx=63 → a=-3.5;  v0=18 Δx=40.5 → a=-4.0
const STAGE3_SETUPS: Setup3[] = [
  { wallX: 80, v0: 20, targets: [{ id: 'e0a', deltaX: 50 }] },
  { wallX: 80, v0: 18, targets: [{ id: 'e1a', deltaX: 54 }] },
  { wallX: 80, v0: 25, targets: [{ id: 'e2a', deltaX: 62.5 }] },
  { wallX: 80, v0: 16, targets: [{ id: 'e3a', deltaX: 64 }] },
  { wallX: 80, v0: 14, targets: [{ id: 'e4a', deltaX: 49 }] },
]

// ─── Locale label loader ────────────────────────────────────────────────
const dict = { en, fr, ar } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── Physics ────────────────────────────────────────────────────────────
// x(t) = v0 * t + 0.5 * a * t^2   (with x0 = 0)
// v(t) = v0 + a * t
// Stops when v hits 0 (only meaningful for a < 0 and v0 > 0), or at T_MAX.
function positionAt(t: number, v0: number, a: number): number {
  return v0 * t + 0.5 * a * t * t
}
function velocityAt(t: number, v0: number, a: number): number {
  return v0 + a * t
}
function stopTime(v0: number, a: number): number {
  // t at which v = 0. Only positive-real if v0 and a have opposite signs.
  if (a === 0) return Infinity
  const t = -v0 / a
  return t > 0 ? t : Infinity
}
// SVG mapping.
function toSvgX(m: number): number {
  return ORIGIN_X + m * PX_PER_M
}

// ─── Component ──────────────────────────────────────────────────────────
type Run = { v0: number; a: number; startedAt: number }

export default function Scene() {
  const { locale, seed } = useInit()
  const stages = useMemo(() => getStagesFor(locale), [locale])
  useDeclareStages(stages)
  const labels = useMemo(() => svgLabels(locale), [locale])

  const setup2 = useMemo(() => STAGE2_SETUPS[seed % STAGE2_SETUPS.length]!, [seed])
  const setup3 = useMemo(() => STAGE3_SETUPS[seed % STAGE3_SETUPS.length]!, [seed])

  const stageIdx = useCurrentStage()
  const setStage = useSetStage()

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  // ─── State ────────────────────────────────────────────────────────────
  const [v0, setV0] = useState(DEFAULT_V0)
  const [a, setA] = useState(DEFAULT_A)
  const [run, setRun] = useState<Run | null>(null)
  const [carX, setCarX] = useState(0) // metres from origin
  const [carV, setCarV] = useState(0) // instantaneous m/s during run
  const [runElapsed, setRunElapsed] = useState(0) // seconds of sim clock at end of run
  const [runOutcome, setRunOutcome] = useState<'idle' | 'stopped' | 'crashed' | 'ran-off'>('idle')
  const [hits, setHits] = useState<string[]>([])
  const [shotCount, setShotCount] = useState(0)
  const [distinctA, setDistinctA] = useState<number[]>([])
  const [v0Moved, setV0Moved] = useState(false)
  const [peekTip, setPeekTip] = useState<string | null>(null)
  const [failFlash, setFailFlash] = useState(false)

  // Stage-2 sequential target index (0..K-1).
  const [s2Idx, setS2Idx] = useState(0)
  // Stage-3 sequential target index — single target per setup, but keep symmetric.
  const [s3Idx, setS3Idx] = useState(0)
  const SHOT_BUDGET_STAGE3 = setup3.targets.length
  const [shotsRemaining, setShotsRemaining] = useState(SHOT_BUDGET_STAGE3)

  const activeSetup = isStage2 ? setup2 : isStage3 ? setup3 : null
  const activeTarget: StopTarget | null = isStage2
    ? setup2.targets[s2Idx] ?? null
    : isStage3
      ? setup3.targets[s3Idx] ?? null
      : null
  const wallX = activeSetup?.wallX ?? 100

  const complete = useComplete()
  const progress = useProgress()

  // ─── Reset stage state ────────────────────────────────────────────────
  const resetStageState = useCallback(() => {
    // On stage 3, v0 is locked by the setup.
    if (isStage3) {
      setV0(setup3.v0)
    } else {
      setV0(DEFAULT_V0)
    }
    setA(DEFAULT_A)
    setRun(null)
    setCarX(0)
    setCarV(0)
    setRunElapsed(0)
    setRunOutcome('idle')
    setHits([])
    setShotCount(0)
    setDistinctA([])
    setV0Moved(false)
    setPeekTip(null)
    setS2Idx(0)
    setS3Idx(0)
    setShotsRemaining(SHOT_BUDGET_STAGE3)
    setFailFlash(false)
  }, [isStage3, setup3.v0, SHOT_BUDGET_STAGE3])
  useReset(resetStageState)

  // When the stage changes, snap v0 for stage 3 (locked to setup).
  useEffect(() => {
    if (isStage3) setV0(setup3.v0)
  }, [isStage3, setup3.v0])

  // ─── Launch ───────────────────────────────────────────────────────────
  const canLaunch = !run && (!isStage3 || shotsRemaining > 0)
  const launch = useCallback(() => {
    if (!canLaunch) return
    setRun({ v0, a, startedAt: performance.now() })
    setCarX(0)
    setCarV(v0)
    setRunElapsed(0)
    setRunOutcome('idle')
    setShotCount((n) => n + 1)
    if (isStage3) setShotsRemaining((n) => n - 1)
    // Stage-1 accounting: distinct sign+magnitude buckets of a; v0 moved.
    if (isStage1) {
      const bucket = Math.round(a * 2) / 2 // 0.5 m/s² buckets
      setDistinctA((prev) => (prev.includes(bucket) ? prev : [...prev, bucket]))
    }
  }, [canLaunch, v0, a, isStage1, isStage3])

  // ─── Ticker ───────────────────────────────────────────────────────────
  useTicker(() => {
    if (!run) return
    const tSec = ((performance.now() - run.startedAt) / 1000) * SPEED_FACTOR
    const vNow = velocityAt(tSec, run.v0, run.a)
    // Cap position at the stop point if v has reversed sign (car reversed).
    const tStop = stopTime(run.v0, run.a)
    const tEff = Math.min(tSec, tStop)
    const xNow = positionAt(tEff, run.v0, run.a)
    setCarX(xNow)
    setCarV(tSec >= tStop ? 0 : vNow)
    setRunElapsed(tEff)

    // Wall crash — car body reaches the wall's near face.
    if (xNow >= wallX) {
      setCarX(wallX)
      setRun(null)
      setRunOutcome('crashed')
      if (!isStage1) setFailFlash(true)
      return
    }

    // Stopped for good (velocity reached zero, or clamp reached).
    const stoppedNow = tSec >= tStop
    // Safety time-out for a >= 0 stage-1 runs where the car would leave the frame.
    const ranOff = xNow >= 100 || tSec >= T_MAX
    if (stoppedNow || ranOff) {
      setRun(null)
      const finalX = stoppedNow ? positionAt(tStop, run.v0, run.a) : xNow
      // Evaluate hit/miss for stages 2+3.
      if (activeTarget) {
        if (Math.abs(finalX - activeTarget.deltaX) < HIT_R_M) {
          setRunOutcome('stopped')
          setHits((prev) => [...prev, activeTarget.id])
          // Advance sequential target index.
          if (isStage2) setS2Idx((i) => i + 1)
          if (isStage3) setS3Idx((i) => i + 1)
        } else {
          setRunOutcome(stoppedNow ? 'stopped' : 'ran-off')
          if (!isStage1) setFailFlash(true)
        }
      } else {
        setRunOutcome(stoppedNow ? 'stopped' : 'ran-off')
      }
    }
  })

  // Clear the miss/crash flash after a moment.
  useEffect(() => {
    if (!failFlash) return
    const t = setTimeout(() => setFailFlash(false), 1200)
    return () => clearTimeout(t)
  }, [failFlash])

  // ─── Blind-stage fail (§5.2) ──────────────────────────────────────────
  // Ran out of shots before clearing all stage-3 targets → restart the stage.
  useEffect(() => {
    if (!isStage3) return
    if (!run && shotsRemaining === 0 && hits.length < setup3.targets.length) {
      const t = setTimeout(() => resetStageState(), 1400)
      return () => clearTimeout(t)
    }
  }, [isStage3, shotsRemaining, run, hits.length, setup3.targets.length, resetStageState])

  // ─── Advance predicate ────────────────────────────────────────────────
  const canSubmit = isStage1
    ? shotCount >= 3 && distinctA.length >= 2 && v0Moved
    : isStage2
      ? hits.length === setup2.targets.length
      : hits.length === setup3.targets.length

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

  // ─── Peek (blind-stage strategy hint — TEXT only) ─────────────────────
  const PEEK_TIPS = useMemo(
    () => [labels.peek_tip_formula, labels.peek_tip_sign, labels.peek_tip_units],
    [labels],
  )
  const peekIdxRef = useRef(0)
  usePeek(() => {
    if (!isStage3) return
    setPeekTip(PEEK_TIPS[peekIdxRef.current % PEEK_TIPS.length]!)
    peekIdxRef.current += 1
  })
  useEffect(() => {
    if (!peekTip) return
    const t = setTimeout(() => setPeekTip(null), 5000)
    return () => clearTimeout(t)
  }, [peekTip])

  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  // ─── Live curves for the right-panel mini-graphs (stages 1 + 2) ──────
  const showGraphs = isStage1 || isStage2
  // Sample the analytic curves over a fixed t window so the graph stays
  // steady rather than rescaling every frame.
  const T_WINDOW = 8 // seconds shown on the t axis
  const V_ABS_MAX = 32 // m/s axis limit
  const X_ABS_MAX = 100 // metres axis limit
  const A_ABS_MAX = 8 // m/s² axis limit

  const graphPaths = useMemo(() => {
    if (!showGraphs) return { x: '', v: '', a: '' }
    const steps = 60
    const xs: string[] = []
    const vs: string[] = []
    const as: string[] = []
    const tStop = stopTime(v0, a)
    const tEndCurve = Math.min(T_WINDOW, tStop)
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * tEndCurve
      const px = positionAt(t, v0, a)
      const pv = velocityAt(t, v0, a)
      const gx = PANEL_X + 30 + (t / T_WINDOW) * (PANEL_W - 40)
      const gyX = GRAPH_TOP + GRAPH_ROW_H - 10 - Math.max(0, Math.min(1, px / X_ABS_MAX)) * (GRAPH_ROW_H - 20)
      const gyV = GRAPH_TOP + GRAPH_ROW_H + GRAPH_GAP + (GRAPH_ROW_H / 2) - (pv / V_ABS_MAX) * (GRAPH_ROW_H / 2 - 10)
      xs.push(`${i === 0 ? 'M' : 'L'} ${gx} ${gyX}`)
      vs.push(`${i === 0 ? 'M' : 'L'} ${gx} ${gyV}`)
    }
    // a(t) is a flat line at a.
    const gyA = GRAPH_TOP + 2 * (GRAPH_ROW_H + GRAPH_GAP) + (GRAPH_ROW_H / 2) - (a / A_ABS_MAX) * (GRAPH_ROW_H / 2 - 10)
    as.push(
      `M ${PANEL_X + 30} ${gyA}`,
      `L ${PANEL_X + PANEL_W - 10} ${gyA}`,
    )
    return { x: xs.join(' '), v: vs.join(' '), a: as.join(' ') }
  }, [showGraphs, v0, a])

  // Live-run markers on the mini-graphs — a small dot at the current sim time.
  const showRunMarker = showGraphs && !!run
  const runMarkerT = run ? runElapsed : 0
  const runMarker = useMemo(() => {
    if (!showRunMarker || !run) return null
    const gx = PANEL_X + 30 + (runMarkerT / T_WINDOW) * (PANEL_W - 40)
    if (gx > PANEL_X + PANEL_W - 10) return null
    const gyX = GRAPH_TOP + GRAPH_ROW_H - 10 - Math.max(0, Math.min(1, carX / X_ABS_MAX)) * (GRAPH_ROW_H - 20)
    const gyV = GRAPH_TOP + GRAPH_ROW_H + GRAPH_GAP + (GRAPH_ROW_H / 2) - (carV / V_ABS_MAX) * (GRAPH_ROW_H / 2 - 10)
    const gyA = GRAPH_TOP + 2 * (GRAPH_ROW_H + GRAPH_GAP) + (GRAPH_ROW_H / 2) - (run.a / A_ABS_MAX) * (GRAPH_ROW_H / 2 - 10)
    return { gx, gyX, gyV, gyA }
  }, [showRunMarker, run, runMarkerT, carX, carV])

  // ─── HUD text ─────────────────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`
  const hudTR = `v₀ = ${v0.toFixed(0)} m/s · a = ${a.toFixed(1)} m/s²`
  const hudBL = peekTip ?? (isStage1 ? labels.tip1 : isStage2 ? labels.tip2 : labels.tip3)
  // BR is reserved — leave empty.

  // Stage-2 / stage-3 progress chip stacks under the TL corner.
  const progressChip = isStage2
    ? `${labels.hits} ${hits.length}/${setup2.targets.length}`
    : isStage3
      ? `${labels.hits} ${hits.length}/${setup3.targets.length} · ${labels.shots} ${shotsRemaining}/${SHOT_BUDGET_STAGE3}`
      : null

  // Car SVG x-position (clamped so it never overshoots the visible track).
  const carSvgX = Math.max(ORIGIN_X, Math.min(TRACK_END_X - 30, toSvgX(carX)))
  const wallSvgX = toSvgX(wallX)

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
          touchAction: 'none',
          userSelect: 'none',
        }}
      >
        {/* NO borderRadius on <svg>. NO rx on the bg <rect>. */}
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        {/* Faint background grid — left half only, so the graph panel stays clean. */}
        {Array.from({ length: 8 }).map((_, i) => (
          <line
            key={`gx${i}`}
            x1={ORIGIN_X + i * 60}
            y1={40}
            x2={ORIGIN_X + i * 60}
            y2={H - 40}
            stroke="#12203a"
            strokeWidth={1}
          />
        ))}

        {/* Track */}
        <Track y={ROAD_Y} x1={ORIGIN_X - 20} x2={TRACK_END_X} />

        {/* Distance ruler ticks under the track — every 10 m */}
        {Array.from({ length: 11 }).map((_, i) => {
          const m = i * 10
          const tx = toSvgX(m)
          if (tx > TRACK_END_X) return null
          return (
            <g key={`tick${i}`}>
              <line x1={tx} y1={ROAD_Y + 18} x2={tx} y2={ROAD_Y + 24} stroke="#3A4863" strokeWidth={0.8} />
              <text
                x={tx}
                y={ROAD_Y + 34}
                fill="#54617A"
                fontFamily="'JetBrains Mono', monospace"
                fontSize={9}
                textAnchor="middle"
              >
                {m}
              </text>
            </g>
          )
        })}

        {/* Start line at x = 0 */}
        <line x1={ORIGIN_X} y1={ROAD_Y - 20} x2={ORIGIN_X} y2={ROAD_Y + 20} stroke="#F97316" strokeWidth={1.5} />
        <text
          x={ORIGIN_X}
          y={ROAD_Y - 26}
          fill="#F97316"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={9}
          textAnchor="middle"
        >
          0
        </text>

        {/* Wall at the far end of the track (stages 2 + 3) */}
        {(isStage2 || isStage3) && (
          <>
            <Wall
              x={wallSvgX}
              y={ROAD_Y - 44}
              width={16}
              height={44}
            />
            <text
              x={wallSvgX + 8}
              y={ROAD_Y - 50}
              fill="#B9C4D6"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={9}
              textAnchor="middle"
            >
              {labels.wall} @ {wallX} m
            </text>
          </>
        )}

        {/* Active stop-target (stage 2 + 3) */}
        {activeTarget && (
          <>
            <StopZone
              cx={toSvgX(activeTarget.deltaX)}
              y1={ROAD_Y - 22}
              y2={ROAD_Y + 22}
              halfWidth={HIT_R_M * PX_PER_M}
              hit={hits.includes(activeTarget.id)}
            />
            {/* On stage 3, coordinates are REQUIRED info (§4.7) — always visible. */}
            {/* On stage 2, showing the number is fine because graphs already help. */}
            <text
              x={toSvgX(activeTarget.deltaX)}
              y={ROAD_Y - 32}
              fill={isStage3 ? '#F9A968' : '#B9C4D6'}
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
              textAnchor="middle"
            >
              Δx = {activeTarget.deltaX} m
            </text>
          </>
        )}

        {/* Car */}
        <Car x={carSvgX} y={ROAD_Y} moving={!!run} />

        {/* Skid mark under the car (visual flavour when a is strongly negative) */}
        {run && run.a < -1 && (
          <line
            x1={ORIGIN_X}
            y1={ROAD_Y + 12}
            x2={carSvgX - 18}
            y2={ROAD_Y + 12}
            stroke="#1A1F2E"
            strokeWidth={1.4}
            opacity={0.7}
          />
        )}

        {/* ── Right-panel graphs (hidden on stage 3 per §4.7) ── */}
        {showGraphs && (
          <>
            {/* Panel background */}
            <rect
              x={PANEL_X - 6}
              y={20}
              width={PANEL_W + 12}
              height={3 * GRAPH_ROW_H + 2 * GRAPH_GAP + 20}
              fill="#111a2c"
              stroke="#2A3244"
              strokeWidth={1}
              rx={6}
            />

            {/* x(t) */}
            <GraphAxes
              x={PANEL_X}
              y={GRAPH_TOP}
              w={PANEL_W}
              h={GRAPH_ROW_H}
              title={labels.graph_x}
              zeroFrac={0.9}
            />
            {graphPaths.x && (
              <path d={graphPaths.x} fill="none" stroke="#37C9B8" strokeWidth={1.6} />
            )}
            {runMarker && (
              <circle cx={runMarker.gx} cy={runMarker.gyX} r={2.6} fill="#F97316" />
            )}

            {/* v(t) */}
            <GraphAxes
              x={PANEL_X}
              y={GRAPH_TOP + GRAPH_ROW_H + GRAPH_GAP}
              w={PANEL_W}
              h={GRAPH_ROW_H}
              title={labels.graph_v}
              zeroFrac={0.5}
            />
            {graphPaths.v && (
              <path d={graphPaths.v} fill="none" stroke="#F9A968" strokeWidth={1.6} />
            )}
            {runMarker && (
              <circle cx={runMarker.gx} cy={runMarker.gyV} r={2.6} fill="#F97316" />
            )}

            {/* a(t) */}
            <GraphAxes
              x={PANEL_X}
              y={GRAPH_TOP + 2 * (GRAPH_ROW_H + GRAPH_GAP)}
              w={PANEL_W}
              h={GRAPH_ROW_H}
              title={labels.graph_a}
              zeroFrac={0.5}
            />
            {graphPaths.a && (
              <path d={graphPaths.a} fill="none" stroke="#B48CE8" strokeWidth={1.6} />
            )}
            {runMarker && (
              <circle cx={runMarker.gx} cy={runMarker.gyA} r={2.6} fill="#F97316" />
            )}
          </>
        )}
      </svg>

      {/* ── HUD overlays ── */}
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
        {progressChip && (
          <div
            style={{
              marginTop: '0.9rem',
              fontSize: '1.9rem',
              letterSpacing: '0.08em',
              color: failFlash ? '#F97316' : '#B9C4D6',
              transition: 'color 0.2s',
            }}
          >
            {progressChip}
          </div>
        )}
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
          fontSize: peekTip ? '1.9rem' : '2.3rem',
          letterSpacing: '0.06em',
          color: peekTip ? '#F9A968' : '#6C7A93',
          maxWidth: '55rem',
          zIndex: 5,
          pointerEvents: 'none',
        }}
      >
        {hudBL}
      </div>
      {/* BR is reserved for parent chrome — intentionally empty. */}

      {/* ── v₀ vertical slider (right edge of canvas) ── */}
      {/* Locked on stage 3 — DOF is a only. */}
      <div
        style={{
          position: 'absolute',
          top: '14rem',
          right: '3rem',
          height: '38rem',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '1rem',
          zIndex: 6,
          opacity: isStage3 ? 0.5 : 1,
        }}
      >
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.9rem', color: '#6C7A93' }}>
          {V0_MAX}
        </div>
        <div
          style={{
            width: '2rem',
            height: '30rem',
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <input
            type="range"
            min={V0_MIN}
            max={V0_MAX}
            step={V0_STEP}
            value={v0}
            disabled={isStage3 || !!run}
            onChange={(e) => {
              setV0(Number(e.target.value))
              setV0Moved(true)
            }}
            style={{
              width: '30rem',
              height: '2rem',
              transform: 'rotate(-90deg)',
              transformOrigin: 'center',
              accentColor: '#37C9B8',
              cursor: isStage3 || run ? 'not-allowed' : 'pointer',
            }}
          />
        </div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.9rem', color: '#6C7A93' }}>
          {V0_MIN}
        </div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.7rem', color: '#54617A' }}>
          {labels.v0}
        </div>
      </div>

      {/* ── a horizontal slider (bottom of the track scene, above FIRE) ── */}
      <div
        style={{
          position: 'absolute',
          bottom: '13rem',
          left: '10rem',
          width: '48rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.4rem',
          zIndex: 6,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '1.7rem',
            color: '#54617A',
          }}
        >
          <span>{A_MIN}</span>
          <span style={{ color: '#B48CE8' }}>{labels.a} = {a.toFixed(1)} m/s²</span>
          <span>+{A_MAX}</span>
        </div>
        <input
          type="range"
          min={A_MIN}
          max={A_MAX}
          step={A_STEP}
          value={a}
          disabled={!!run}
          onChange={(e) => setA(Number(e.target.value))}
          style={{
            width: '100%',
            height: '2rem',
            accentColor: '#B48CE8',
            cursor: run ? 'not-allowed' : 'pointer',
          }}
        />
      </div>

      {/* ── LAUNCH button ── */}
      <button
        type="button"
        onClick={launch}
        disabled={!canLaunch}
        style={{
          position: 'absolute',
          bottom: '3rem',
          left: '50%',
          transform: 'translateX(-50%)',
          padding: '2rem 4rem',
          background: canLaunch ? '#F97316' : 'rgba(30,42,64,0.85)',
          color: canLaunch ? '#FFFFFF' : '#6C7A93',
          border: `0.3rem solid ${canLaunch ? '#F97316' : 'rgba(58,72,99,0.6)'}`,
          borderRadius: '100rem',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '2.6rem',
          fontWeight: 700,
          letterSpacing: '0.12em',
          cursor: canLaunch ? 'pointer' : 'not-allowed',
          zIndex: 10,
          transition: 'background 0.15s, transform 0.1s',
        }}
      >
        <i
          className="bi bi-play-fill"
          style={{ marginInlineEnd: '0.8rem', fontSize: '2.8rem', verticalAlign: '-0.2rem' }}
        />
        {labels.launch}
      </button>

      {/* Suppress unused-var warnings in TS strict mode. */}
      <span style={{ display: 'none' }}>{runOutcome}</span>
    </div>
  )
}

// ─── Small helper for graph axes ────────────────────────────────────────
function GraphAxes({
  x,
  y,
  w,
  h,
  title,
  zeroFrac,
}: {
  x: number
  y: number
  w: number
  h: number
  title: string
  zeroFrac: number // fraction from top where the zero line sits (0..1)
}) {
  const zeroY = y + h * zeroFrac
  return (
    <g>
      <text
        x={x + 30}
        y={y + 12}
        fill="#6C7A93"
        fontFamily="'JetBrains Mono', monospace"
        fontSize={9}
      >
        {title}
      </text>
      {/* axes frame */}
      <line x1={x + 30} y1={y + 6} x2={x + 30} y2={y + h - 6} stroke="#3A4863" strokeWidth={0.8} />
      <line x1={x + 30} y1={y + h - 6} x2={x + w - 10} y2={y + h - 6} stroke="#3A4863" strokeWidth={0.8} />
      {/* zero line if within range */}
      {zeroFrac > 0.05 && zeroFrac < 0.95 && (
        <line
          x1={x + 30}
          y1={zeroY}
          x2={x + w - 10}
          y2={zeroY}
          stroke="#2A3244"
          strokeWidth={0.8}
          strokeDasharray="2 3"
        />
      )}
    </g>
  )
}
