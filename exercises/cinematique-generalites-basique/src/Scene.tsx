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
import { Road } from './art/Road'
import { Car, CAR_ROOF_OFFSET } from './art/Car'
import { Pedestrian } from './art/Pedestrian'
import { Fly } from './art/Fly'

// ─── Scene constants ────────────────────────────────────────────────────
const W = 800
const H = 450

// Physical scene band (bottom half of the canvas)
const ROAD_Y = 380
const SCENE_ORIGIN_X = 60 // metre x=0 in SVG px for the physical scene band
const PX_PER_M_SCENE = 5

// Trace panel (top half of the canvas)
const TRACE_CX = 400
const TRACE_CY = 145
const TRACE_HALF_W = 260
const TRACE_HALF_H = 70
const PX_PER_M_TRACE = 6.5

// Motion parameters
const V_A_MIN = 0
const V_A_MAX = 20
const V_A_STEP = 1
const DEFAULT_V_A = 8
const A_HOP = 3 // vertical hop amplitude (m)
const T_HOP = 1.2 // hop period (s)
const T_TRACE = 3 // trace duration (s)
const N_TRACE_SAMPLES = 60
const TRACE_HIT_TOL_M = 3.2 // max mean-point distance to count as a match (m)

// Frame identifiers
type FrameId = 'road' | 'pedestrian' | 'carB' | 'carA'
const ALL_FRAMES: FrameId[] = ['road', 'pedestrian', 'carB', 'carA']

// ─── Setups (seed-picked, hand-authored) ────────────────────────────────
// Each setup fixes the pedestrian and car-B velocities. Targets are triples
// (frame, v_A) that produce visually distinct ghost trajectories.
type Target = { id: string; frame: FrameId; vA: number }
type Setup = {
  vP: number // pedestrian ground velocity (m/s, +right)
  vB: number // car B ground velocity (m/s, +right)
  xP0: number // pedestrian initial x (m) — physical scene only
  xB0: number // car B initial x (m) — physical scene only
  targets: Target[]
  framesAllowed: FrameId[]
}

const STAGE2_SETUPS: Setup[] = [
  {
    vP: 2,
    vB: 12,
    xP0: 22,
    xB0: 4,
    framesAllowed: ['road', 'pedestrian', 'carA', 'carB'],
    targets: [
      { id: 's0a', frame: 'carA', vA: 10 }, // vertical hop (dot-like)
      { id: 's0b', frame: 'road', vA: 15 }, // rightward
      { id: 's0c', frame: 'carB', vA: 6 }, // leftward (v_A − v_B = −6)
    ],
  },
  {
    vP: 4,
    vB: 15,
    xP0: 18,
    xB0: 6,
    framesAllowed: ['road', 'pedestrian', 'carA', 'carB'],
    targets: [
      { id: 's1a', frame: 'pedestrian', vA: 4 }, // vertical (matches v_p)
      { id: 's1b', frame: 'road', vA: 8 }, // rightward
      { id: 's1c', frame: 'carB', vA: 9 }, // leftward
    ],
  },
  {
    vP: 3,
    vB: 8,
    xP0: 26,
    xB0: 4,
    framesAllowed: ['road', 'pedestrian', 'carA', 'carB'],
    targets: [
      { id: 's2a', frame: 'road', vA: 12 }, // rightward
      { id: 's2b', frame: 'carB', vA: 8 }, // vertical (v_A = v_B)
      { id: 's2c', frame: 'pedestrian', vA: 10 }, // slow rightward
    ],
  },
  {
    vP: 5,
    vB: 10,
    xP0: 20,
    xB0: 6,
    framesAllowed: ['road', 'pedestrian', 'carA', 'carB'],
    targets: [
      { id: 's3a', frame: 'carA', vA: 14 }, // vertical
      { id: 's3b', frame: 'pedestrian', vA: 5 }, // vertical (matches v_p)
      { id: 's3c', frame: 'road', vA: 10 }, // rightward
    ],
  },
  {
    vP: 2,
    vB: 14,
    xP0: 24,
    xB0: 4,
    framesAllowed: ['road', 'pedestrian', 'carA', 'carB'],
    targets: [
      { id: 's4a', frame: 'carB', vA: 5 }, // leftward
      { id: 's4b', frame: 'road', vA: 6 }, // slow rightward
      { id: 's4c', frame: 'pedestrian', vA: 12 }, // rightward
    ],
  },
]

// Stage 3: fewer, more compressed choices — each answer must be reasoned.
const STAGE3_SETUPS: Setup[] = [
  {
    vP: 3,
    vB: 12,
    xP0: 22,
    xB0: 4,
    framesAllowed: ['road', 'pedestrian', 'carA', 'carB'],
    targets: [
      { id: 't0a', frame: 'carB', vA: 12 }, // vertical (v_A = v_B) — "the fly appears stationary from car B"
      { id: 't0b', frame: 'road', vA: 15 }, // clearly rightward
      { id: 't0c', frame: 'pedestrian', vA: 3 }, // vertical (matches v_p)
    ],
  },
  {
    vP: 2,
    vB: 15,
    xP0: 24,
    xB0: 6,
    framesAllowed: ['road', 'pedestrian', 'carA', 'carB'],
    targets: [
      { id: 't1a', frame: 'carA', vA: 8 }, // vertical
      { id: 't1b', frame: 'carB', vA: 5 }, // strongly leftward
      { id: 't1c', frame: 'road', vA: 10 }, // rightward
    ],
  },
  {
    vP: 5,
    vB: 10,
    xP0: 20,
    xB0: 4,
    framesAllowed: ['road', 'pedestrian', 'carA', 'carB'],
    targets: [
      { id: 't2a', frame: 'pedestrian', vA: 5 }, // vertical (matches v_p)
      { id: 't2b', frame: 'road', vA: 14 }, // rightward
      { id: 't2c', frame: 'carB', vA: 4 }, // leftward
    ],
  },
  {
    vP: 4,
    vB: 9,
    xP0: 22,
    xB0: 6,
    framesAllowed: ['road', 'pedestrian', 'carA', 'carB'],
    targets: [
      { id: 't3a', frame: 'carB', vA: 9 }, // vertical
      { id: 't3b', frame: 'pedestrian', vA: 12 }, // rightward
      { id: 't3c', frame: 'road', vA: 6 }, // slow rightward
    ],
  },
  {
    vP: 3,
    vB: 14,
    xP0: 24,
    xB0: 4,
    framesAllowed: ['road', 'pedestrian', 'carA', 'carB'],
    targets: [
      { id: 't4a', frame: 'road', vA: 12 }, // rightward
      { id: 't4b', frame: 'carA', vA: 10 }, // vertical
      { id: 't4c', frame: 'pedestrian', vA: 3 }, // vertical
    ],
  },
]

// ─── Pure kinematics ─────────────────────────────────────────────────────
// Frame velocity in the ground frame, in m/s.
function frameVelocity(frame: FrameId, vA: number, setup: Setup): number {
  switch (frame) {
    case 'road':
      return 0
    case 'pedestrian':
      return setup.vP
    case 'carB':
      return setup.vB
    case 'carA':
      return vA
  }
}

// Fly ground-frame position at time t.
function flyGround(t: number, vA: number, xFly0: number): { x: number; y: number } {
  const s = Math.sin((Math.PI * t) / T_HOP)
  return {
    x: xFly0 + vA * t,
    y: A_HOP * s * s, // ≥ 0, peaks at half-period
  }
}

// Fly position in the chosen frame relative to a fixed origin defined at t=0.
// (The frame's origin moves at vFrame; at t=0 we anchor it at x=0.)
function flyInFrame(t: number, vA: number, xFly0: number, vFrame: number): { x: number; y: number } {
  const g = flyGround(t, vA, xFly0)
  return { x: g.x - vFrame * t - xFly0, y: g.y }
}

// Sample the fly-in-frame trajectory as a polyline of {x, y} pairs (metres).
function sampleTrace(
  vA: number,
  vFrame: number,
  steps = N_TRACE_SAMPLES,
): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = []
  const dt = T_TRACE / steps
  for (let i = 0; i <= steps; i++) {
    out.push(flyInFrame(i * dt, vA, 0, vFrame))
  }
  return out
}

// Compare two traces: mean pointwise distance in metres.
function traceDistance(a: { x: number; y: number }[], b: { x: number; y: number }[]): number {
  const n = Math.min(a.length, b.length)
  if (n === 0) return Infinity
  let sum = 0
  for (let i = 0; i < n; i++) {
    const pa = a[i]!
    const pb = b[i]!
    sum += Math.hypot(pa.x - pb.x, pa.y - pb.y)
  }
  return sum / n
}

// Trace-panel coordinate transform: metre → SVG px, centered on (TRACE_CX, TRACE_CY).
function traceToSvgX(m: number): number {
  return TRACE_CX + m * PX_PER_M_TRACE
}
function traceToSvgY(m: number): number {
  // metre y is "height above baseline"; SVG y goes down.
  return TRACE_CY + TRACE_HALF_H - 12 - m * PX_PER_M_TRACE
}
function tracePath(pts: { x: number; y: number }[]): string {
  if (!pts.length) return ''
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${traceToSvgX(p.x)} ${traceToSvgY(p.y)}`).join(' ')
}

// Physical-scene coordinate transform (metres → SVG px).
function sceneToSvgX(m: number): number {
  return SCENE_ORIGIN_X + m * PX_PER_M_SCENE
}
function sceneToSvgY(m: number): number {
  // metre y is "height above road"; SVG y is down; ROAD_Y is baseline.
  return ROAD_Y - m * PX_PER_M_SCENE
}

// ─── Label loader ────────────────────────────────────────────────────────
const dict = { en, fr, ar } as const
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

  const setup2 = useMemo(() => STAGE2_SETUPS[seed % STAGE2_SETUPS.length]!, [seed])
  const setup3 = useMemo(() => STAGE3_SETUPS[seed % STAGE3_SETUPS.length]!, [seed])

  const stageIdx = useCurrentStage()
  const setStage = useSetStage()

  const [frame, setFrame] = useState<FrameId>('road')
  const [vA, setVA] = useState(DEFAULT_V_A)
  const [tracing, setTracing] = useState(false) // true while a trace is drawing
  const [traceStartedAt, setTraceStartedAt] = useState<number | null>(null)
  const [drawnFraction, setDrawnFraction] = useState(0) // 0..1 progress of current trace
  const [committedTrace, setCommittedTrace] = useState<{
    frame: FrameId
    vA: number
    pts: { x: number; y: number }[]
  } | null>(null)
  const [matches, setMatches] = useState<string[]>([])
  const [traceCount, setTraceCount] = useState(0)
  const [distinctFrames, setDistinctFrames] = useState<FrameId[]>([])
  const [vaMoved, setVaMoved] = useState(false)
  const [peekTip, setPeekTip] = useState<string | null>(null)
  // Ground-frame scene animation timer (never stops — for the ambient scene).
  const [sceneT, setSceneT] = useState(0)

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  const activeSetup: Setup = isStage3
    ? setup3
    : isStage2
      ? setup2
      : {
          vP: 3,
          vB: 12,
          xP0: 24,
          xB0: 4,
          framesAllowed: ['road', 'pedestrian', 'carA', 'carB'],
          targets: [],
        }

  const SHOT_BUDGET_STAGE3 = activeSetup.targets.length // one trace per target
  const [tracesRemaining, setTracesRemaining] = useState(SHOT_BUDGET_STAGE3)

  const complete = useComplete()
  const progress = useProgress()

  // Reseed the trace budget whenever the setup / stage changes.
  useEffect(() => {
    setTracesRemaining(SHOT_BUDGET_STAGE3)
  }, [SHOT_BUDGET_STAGE3, stageIdx])

  // ─── Reset ─────────────────────────────────────────────────────────────
  const resetStageState = useCallback(() => {
    setFrame('road')
    setVA(DEFAULT_V_A)
    setTracing(false)
    setTraceStartedAt(null)
    setDrawnFraction(0)
    setCommittedTrace(null)
    setMatches([])
    setTraceCount(0)
    setDistinctFrames([])
    setVaMoved(false)
    setPeekTip(null)
    setTracesRemaining(SHOT_BUDGET_STAGE3)
  }, [SHOT_BUDGET_STAGE3])
  useReset(resetStageState)

  // ─── Trace action ──────────────────────────────────────────────────────
  const canTrace = !tracing && (!isStage3 || tracesRemaining > 0)
  const startTrace = useCallback(() => {
    if (!canTrace) return
    setTracing(true)
    setTraceStartedAt(performance.now())
    setDrawnFraction(0)
    setCommittedTrace(null)
    setTraceCount((n) => n + 1)
    if (isStage3) setTracesRemaining((n) => n - 1)
    if (isStage1) {
      setDistinctFrames((prev) => (prev.includes(frame) ? prev : [...prev, frame]))
    }
  }, [canTrace, frame, isStage1, isStage3])

  // ─── Ticker: drives BOTH the scene animation and the active trace ──────
  useTicker(() => {
    // Scene ambient clock (loops).
    setSceneT((t) => (t + 1 / 60) % 8)

    // Active trace progress.
    if (tracing && traceStartedAt !== null) {
      const elapsed = (performance.now() - traceStartedAt) / 1000
      const frac = Math.min(1, elapsed / T_TRACE)
      setDrawnFraction(frac)
      if (frac >= 1) {
        // Commit the trace.
        const vFrame = frameVelocity(frame, vA, activeSetup)
        const pts = sampleTrace(vA, vFrame)
        setCommittedTrace({ frame, vA, pts })
        setTracing(false)
        setTraceStartedAt(null)
        // Match against remaining targets (stage 2 / 3).
        if (isStage2 || isStage3) {
          const remaining = activeSetup.targets.filter((t) => !matches.includes(t.id))
          let best: { id: string; d: number } | null = null
          for (const tgt of remaining) {
            const tgtVFrame = frameVelocity(tgt.frame, tgt.vA, activeSetup)
            const tgtPts = sampleTrace(tgt.vA, tgtVFrame)
            const d = traceDistance(pts, tgtPts)
            if (best === null || d < best.d) best = { id: tgt.id, d }
          }
          if (best && best.d < TRACE_HIT_TOL_M) {
            setMatches((prev) => (prev.includes(best!.id) ? prev : [...prev, best!.id]))
          }
        }
      }
    }
  })

  // ─── Live scene positions (metres) ──────────────────────────────────────
  const carAx0 = 8 // metres — car A starting position along road
  const flyXOffset = 0 // fly sits above the car's centre → x relative to car centre = 0
  const carAX_now = carAx0 + vA * sceneT
  const flyGroundNow = flyGround(sceneT, vA, carAx0 + flyXOffset)
  const pedX_now = activeSetup.xP0 + activeSetup.vP * sceneT
  const carBX_now = activeSetup.xB0 + activeSetup.vB * sceneT

  // ─── Blind-stage fail — out of traces without full match ───────────────
  useEffect(() => {
    if (!isStage3) return
    if (
      tracesRemaining === 0 &&
      !tracing &&
      matches.length < activeSetup.targets.length
    ) {
      resetStageState()
    }
  }, [
    isStage3,
    tracesRemaining,
    tracing,
    matches.length,
    activeSetup.targets.length,
    resetStageState,
  ])

  // ─── Advance predicate ─────────────────────────────────────────────────
  const canSubmit = isStage1
    ? traceCount >= 3 && distinctFrames.length >= 2 && vaMoved
    : matches.length === activeSetup.targets.length && activeSetup.targets.length > 0

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

  // ─── Peek (blind-stage strategy hint, TEXT only — never the preview) ───
  const PEEK_TIPS = useMemo(
    () => [labels.peek_tip_relative, labels.peek_tip_dot, labels.peek_tip_length],
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
    const t = setTimeout(() => setPeekTip(null), 4500)
    return () => clearTimeout(t)
  }, [peekTip])

  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  // ─── Preview (only shown on stages 1 & 2; HIDDEN on stage 3 per §5.2) ──
  const previewVFrame = frameVelocity(frame, vA, activeSetup)
  const previewPts = useMemo(
    () => sampleTrace(vA, previewVFrame),
    [vA, previewVFrame],
  )
  const previewD = tracePath(previewPts)
  const showPreview = isStage1 || isStage2

  // Partial-in-progress trace path (drawn as the fly moves during animation).
  const inFlightPts = useMemo(() => {
    if (!tracing) return []
    const n = Math.max(1, Math.floor(N_TRACE_SAMPLES * drawnFraction))
    const vFrame = frameVelocity(frame, vA, activeSetup)
    return sampleTrace(vA, vFrame).slice(0, n + 1)
  }, [tracing, drawnFraction, frame, vA, activeSetup])
  const inFlightD = tracePath(inFlightPts)

  const committedD = committedTrace ? tracePath(committedTrace.pts) : ''

  // Target ghost paths (stage 2 & 3).
  const targetGhosts = (isStage2 || isStage3)
    ? activeSetup.targets.map((tgt) => {
        const vF = frameVelocity(tgt.frame, tgt.vA, activeSetup)
        return { id: tgt.id, d: tracePath(sampleTrace(tgt.vA, vF)) }
      })
    : []

  // ─── HUD text ──────────────────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`
  const hudTR = `${labels.vA} = ${vA} m/s`
  const hudBL = isStage3 && peekTip
    ? peekTip
    : isStage1
      ? labels.tip1
      : isStage2
        ? labels.tip2
        : labels.tip3

  const framesInUI = activeSetup.framesAllowed
  const svgRef = useRef<SVGSVGElement>(null)

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        ref={svgRef}
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
        {/* Uniform background — NO borderRadius on <svg>, NO rx on this rect. */}
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        {/* Faint grid */}
        {Array.from({ length: 12 }).map((_, i) => (
          <line
            key={`gx${i}`}
            x1={(i + 1) * 60}
            y1={0}
            x2={(i + 1) * 60}
            y2={H}
            stroke="#12203a"
            strokeWidth={1}
          />
        ))}

        {/* ═══ Trace panel (top) — the "fly's trajectory in chosen frame" ═══ */}
        <rect
          x={TRACE_CX - TRACE_HALF_W}
          y={TRACE_CY - TRACE_HALF_H}
          width={TRACE_HALF_W * 2}
          height={TRACE_HALF_H * 2}
          fill="rgba(20,30,52,0.55)"
          stroke="#2A3244"
          strokeWidth={1}
          rx={6}
        />
        {/* Baseline (y=0) */}
        <line
          x1={TRACE_CX - TRACE_HALF_W + 6}
          y1={traceToSvgY(0)}
          x2={TRACE_CX + TRACE_HALF_W - 6}
          y2={traceToSvgY(0)}
          stroke="#3A4863"
          strokeWidth={1}
          strokeDasharray="2 3"
        />
        {/* Origin tick (x=0) */}
        <line
          x1={traceToSvgX(0)}
          y1={TRACE_CY - TRACE_HALF_H + 6}
          x2={traceToSvgX(0)}
          y2={TRACE_CY + TRACE_HALF_H - 6}
          stroke="#3A4863"
          strokeWidth={1}
          strokeDasharray="2 3"
        />
        {/* Panel caption (SVG text stays plain — no $...$) */}
        <text
          x={TRACE_CX - TRACE_HALF_W + 8}
          y={TRACE_CY - TRACE_HALF_H + 12}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={9}
          letterSpacing="0.1em"
        >
          FLY TRAJECTORY · {frameLabelSvg(frame, labels)}
        </text>

        {/* Target ghosts (stage 2 & 3) */}
        {targetGhosts.map((g) => (
          <path
            key={g.id}
            d={g.d}
            fill="none"
            stroke={matches.includes(g.id) ? '#37C9B8' : '#54617A'}
            strokeWidth={matches.includes(g.id) ? 2.4 : 1.8}
            strokeDasharray={matches.includes(g.id) ? undefined : '3 4'}
            opacity={matches.includes(g.id) ? 0.9 : 0.55}
          />
        ))}

        {/* Preview (stage 1 & 2 only — hidden on stage 3) */}
        {showPreview && previewD && !tracing && (
          <path
            d={previewD}
            fill="none"
            stroke="#37C9B8"
            strokeWidth={1.4}
            strokeDasharray="1 4"
            opacity={0.5}
          />
        )}

        {/* Committed trace from the last completed TRACE action */}
        {committedTrace && !tracing && (
          <path
            d={committedD}
            fill="none"
            stroke="#F97316"
            strokeWidth={2.2}
            opacity={0.9}
          />
        )}

        {/* Actively-drawing trace (grows with drawnFraction) */}
        {tracing && inFlightD && (
          <path
            d={inFlightD}
            fill="none"
            stroke="#F97316"
            strokeWidth={2.2}
            opacity={0.95}
          />
        )}

        {/* ═══ Physical scene (bottom) ═══ */}
        <Road y={ROAD_Y} width={W} />

        {/* Car B (drawn first / dimmer than car A) */}
        <Car
          x={sceneToSvgX(carBX_now)}
          y={sceneToSvgY(0)}
          color="#37C9B8"
          dim={frame !== 'carB'}
        />
        {/* Pedestrian */}
        <Pedestrian
          x={sceneToSvgX(pedX_now)}
          y={sceneToSvgY(0)}
          dim={frame !== 'pedestrian'}
        />
        {/* Car A */}
        <Car
          x={sceneToSvgX(carAX_now)}
          y={sceneToSvgY(0)}
          color="#F97316"
        />
        {/* Fly on car A roof */}
        <Fly
          x={sceneToSvgX(flyGroundNow.x)}
          y={sceneToSvgY(0) - CAR_ROOF_OFFSET - flyGroundNow.y * PX_PER_M_SCENE}
        />

        {/* Small legend under scene (SVG text — plain, no KaTeX) */}
        <text
          x={16}
          y={ROAD_Y + 40}
          fill="#54617A"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={10}
          letterSpacing="0.08em"
        >
          {labels.vP} = {activeSetup.vP} m/s · {labels.vB} = {activeSetup.vB} m/s
        </text>
      </svg>

      {/* HUD overlays (HTML in rem) */}
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
        {(isStage2 || isStage3) && (
          <div style={{ marginTop: '0.6rem', color: '#6C7A93' }}>
            {labels.matches} {matches.length}/{activeSetup.targets.length}
          </div>
        )}
        {isStage3 && (
          <div style={{ marginTop: '0.4rem', color: '#F9A968' }}>
            {labels.traces}: {tracesRemaining}/{SHOT_BUDGET_STAGE3}
          </div>
        )}
      </div>
      <div
        style={{
          position: 'absolute',
          bottom: '3rem',
          left: '3rem',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '2.1rem',
          letterSpacing: '0.06em',
          color: isStage3 && peekTip ? '#F9A968' : '#6C7A93',
          zIndex: 5,
          pointerEvents: 'none',
          maxWidth: '60rem',
          lineHeight: 1.3,
        }}
      >
        {hudBL}
      </div>
      {/* BR reserved for parent-side chrome (fullscreen toggle). Leave empty. */}

      {/* Reference frame picker — top-left column, below TL */}
      <div
        style={{
          position: 'absolute',
          top: '8rem',
          left: '3rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.8rem',
          zIndex: 6,
        }}
      >
        <div
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '1.7rem',
            color: '#54617A',
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            marginBottom: '0.4rem',
          }}
        >
          {labels.frame}
        </div>
        {ALL_FRAMES.filter((f) => framesInUI.includes(f)).map((f) => {
          const active = frame === f
          return (
            <button
              key={f}
              type="button"
              onClick={() => setFrame(f)}
              disabled={tracing}
              style={{
                padding: '1rem 1.6rem',
                background: active ? 'rgba(55,201,184,0.18)' : 'rgba(20,30,52,0.75)',
                border: `0.2rem solid ${active ? '#37C9B8' : 'rgba(58,72,99,0.6)'}`,
                borderRadius: '0.8rem',
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '1.9rem',
                color: active ? '#37C9B8' : '#B9C4D6',
                letterSpacing: '0.06em',
                cursor: tracing ? 'not-allowed' : 'pointer',
                textAlign: 'left',
                opacity: tracing ? 0.55 : 1,
                transition: 'background 0.15s, border-color 0.15s',
              }}
            >
              {frameLabel(f, labels)}
            </button>
          )
        })}
      </div>

      {/* v_A slider — vertical, right side of canvas */}
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
        }}
      >
        <div
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '1.9rem',
            color: '#6C7A93',
          }}
        >
          {V_A_MAX}
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
            min={V_A_MIN}
            max={V_A_MAX}
            step={V_A_STEP}
            value={vA}
            disabled={tracing}
            onChange={(e) => {
              setVA(Number(e.target.value))
              setVaMoved(true)
            }}
            style={{
              width: '30rem',
              height: '2rem',
              transform: 'rotate(-90deg)',
              transformOrigin: 'center',
              accentColor: '#F97316',
              cursor: tracing ? 'not-allowed' : 'pointer',
            }}
          />
        </div>
        <div
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '1.9rem',
            color: '#6C7A93',
          }}
        >
          {V_A_MIN}
        </div>
        <div
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '1.7rem',
            color: '#54617A',
          }}
        >
          {labels.vA}
        </div>
      </div>

      {/* TRACE button — pill, bottom-centre. Disabled while tracing / out of budget. */}
      <button
        type="button"
        onClick={startTrace}
        disabled={!canTrace}
        style={{
          position: 'absolute',
          bottom: '3rem',
          left: '50%',
          transform: 'translateX(-50%)',
          padding: '2rem 4rem',
          background: canTrace ? '#F97316' : 'rgba(30,42,64,0.85)',
          color: canTrace ? '#FFFFFF' : '#6C7A93',
          border: `0.3rem solid ${canTrace ? '#F97316' : 'rgba(58,72,99,0.6)'}`,
          borderRadius: '100rem',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '2.6rem',
          fontWeight: 700,
          letterSpacing: '0.12em',
          cursor: canTrace ? 'pointer' : 'not-allowed',
          zIndex: 10,
          transition: 'background 0.15s, transform 0.1s',
        }}
      >
        <i
          className="bi bi-vector-pen"
          style={{ marginInlineEnd: '0.8rem', fontSize: '2.8rem', verticalAlign: '-0.2rem' }}
        />
        {labels.trace}
      </button>
    </div>
  )
}

// ─── Small helpers (kept at module scope) ──────────────────────────────
function frameLabel(f: FrameId, labels: Record<string, string>): string {
  switch (f) {
    case 'road':
      return labels.frame_road!
    case 'pedestrian':
      return labels.frame_pedestrian!
    case 'carB':
      return labels.frame_carB!
    case 'carA':
      return labels.frame_carA!
  }
}

// SVG-safe (no diacritics avoided intentionally; JetBrains Mono handles them).
function frameLabelSvg(f: FrameId, labels: Record<string, string>): string {
  return frameLabel(f, labels).toUpperCase()
}
