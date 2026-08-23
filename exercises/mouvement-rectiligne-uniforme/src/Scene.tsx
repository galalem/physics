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
import { Puck } from './art/Puck'
import { Track } from './art/Track'
import { Rendezvous } from './art/Rendezvous'

// ─── Scene constants ────────────────────────────────────────────────────
const W = 800
const H = 450

// World ranges (meters, seconds, m/s)
const X_MIN = -5
const X_MAX = 55
const T_MAX = 10 // horizon for graph and rendezvous times
const V_MIN = -10
const V_MAX = 10
const X0_MIN = 0
const X0_MAX = 40

// Physics defaults
const DEFAULT_X0 = 10
const DEFAULT_V = 4
const HIT_R_M = 1.5 // rendezvous hit tolerance (meters at t*)
const SPEED_FACTOR = 1 // sim runs at real time (10 s window)

// SVG geometry
// Graph box (top): position-vs-time
const GRAPH_X0 = 100 // svg_x at t=0
const GRAPH_X1 = 700 // svg_x at t=T_MAX
const GRAPH_Y_TOP = 60 // svg_y at x=X_MAX
const GRAPH_Y_BOT = 200 // svg_y at x=X_MIN
// Track (bottom): 1D rail
const TRACK_Y = 340 // svg_y of track
const TRACK_X0 = 100 // svg_x at world x=0
const PX_PER_M = 10 // for track

// Blind stage
const SHOT_BUDGET_STAGE3 = 3

// ─── Coord helpers ──────────────────────────────────────────────────────
function trackSvgX(m: number): number {
  return TRACK_X0 + m * PX_PER_M
}
function graphSvgX(t: number): number {
  return GRAPH_X0 + (t / T_MAX) * (GRAPH_X1 - GRAPH_X0)
}
function graphSvgY(x: number): number {
  const frac = (x - X_MIN) / (X_MAX - X_MIN)
  return GRAPH_Y_BOT - frac * (GRAPH_Y_BOT - GRAPH_Y_TOP)
}
function clampX(x: number): number {
  return Math.max(X_MIN, Math.min(X_MAX, x))
}

// ─── Setups ─────────────────────────────────────────────────────────────
// Each rendezvous = (x*, t*) with a fixed x₀ (given). Student sets v.
// v_solution = (x* - x₀) / t*. Setups hand-authored to cover positive,
// negative (retour, per JSON wrinkle), and non-integer velocities.
type Rdv = { id: string; x: number; t: number }
type Setup = { x0: number; targets: Rdv[] }

const STAGE2_SETUPS: Setup[] = [
  // x0=5: v=+3, v=-1, v=+6
  { x0: 5, targets: [
    { id: 's0a', x: 20, t: 5 },
    { id: 's0b', x: 1, t: 4 },
    { id: 's0c', x: 35, t: 5 },
  ]},
  // x0=25 (middle): v=-3, v=+3, small positive
  { x0: 25, targets: [
    { id: 's1a', x: 10, t: 5 },
    { id: 's1b', x: 40, t: 5 },
    { id: 's1c', x: 28, t: 4 },
  ]},
  // x0=30: v=-4, v=+2, v=-1.5
  { x0: 30, targets: [
    { id: 's2a', x: 10, t: 5 },
    { id: 's2b', x: 46, t: 8 },
    { id: 's2c', x: 21, t: 6 },
  ]},
  // x0=15: v=+5, v=-2, v=+2.5
  { x0: 15, targets: [
    { id: 's3a', x: 40, t: 5 },
    { id: 's3b', x: 3, t: 6 },
    { id: 's3c', x: 35, t: 8 },
  ]},
]

const STAGE3_SETUPS: Setup[] = [
  { x0: 8, targets: [
    { id: 't0a', x: 32, t: 6 },   // v = 4
    { id: 't0b', x: 2, t: 4 },    // v = -1.5
    { id: 't0c', x: 44, t: 9 },   // v = 4
  ]},
  { x0: 20, targets: [
    { id: 't1a', x: 44, t: 8 },   // v = 3
    { id: 't1b', x: 5, t: 5 },    // v = -3
    { id: 't1c', x: 32, t: 6 },   // v = 2
  ]},
  { x0: 35, targets: [
    { id: 't2a', x: 15, t: 5 },   // v = -4
    { id: 't2b', x: 45, t: 5 },   // v = 2
    { id: 't2c', x: 5, t: 6 },    // v = -5
  ]},
  { x0: 12, targets: [
    { id: 't3a', x: 42, t: 6 },   // v = 5
    { id: 't3b', x: 3, t: 6 },    // v = -1.5
    { id: 't3c', x: 30, t: 9 },   // v = 2
  ]},
]

// ─── Label loader ───────────────────────────────────────────────────────
const dict = { en, fr, ar } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── Component ──────────────────────────────────────────────────────────
type Motion = { x0: number; v: number; startedAt: number }

export default function Scene() {
  const { locale, seed } = useInit()
  const stages = useMemo(() => getStagesFor(locale), [locale])
  useDeclareStages(stages)
  const labels = useMemo(() => svgLabels(locale), [locale])

  const setup2 = useMemo(() => STAGE2_SETUPS[seed % STAGE2_SETUPS.length]!, [seed])
  const setup3 = useMemo(() => STAGE3_SETUPS[seed % STAGE3_SETUPS.length]!, [seed])

  const stageIdx = useCurrentStage()
  const setStage = useSetStage()

  // ─── State ────────────────────────────────────────────────────────────
  const [x0, setX0] = useState(DEFAULT_X0)
  const [v, setV] = useState(DEFAULT_V)
  const [motion, setMotion] = useState<Motion | null>(null)
  const [pos, setPos] = useState<number>(DEFAULT_X0)
  const [tNow, setTNow] = useState<number>(0)
  const [hits, setHits] = useState<string[]>([])
  const [runCount, setRunCount] = useState(0)
  const [distinctVBuckets, setDistinctVBuckets] = useState<number[]>([])
  const [x0Moved, setX0Moved] = useState(false)
  const [trail, setTrail] = useState<{ x0: number; v: number }[]>([])
  const [peekTip, setPeekTip] = useState<string | null>(null)
  const [shotsRemaining, setShotsRemaining] = useState(SHOT_BUDGET_STAGE3)

  const svgRef = useRef<SVGSVGElement>(null)
  const [dragging, setDragging] = useState(false)

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  // Stages 2/3 lock x₀ to the setup's value; stage 1 uses the student's x₀.
  const effectiveX0 = isStage2 ? setup2.x0 : isStage3 ? setup3.x0 : x0
  const activeTargets = isStage2 ? setup2.targets : isStage3 ? setup3.targets : []

  const complete = useComplete()
  const progress = useProgress()

  // ─── Reset ────────────────────────────────────────────────────────────
  const resetStageState = useCallback(() => {
    setX0(DEFAULT_X0)
    setV(DEFAULT_V)
    setMotion(null)
    setPos(DEFAULT_X0)
    setTNow(0)
    setHits([])
    setRunCount(0)
    setDistinctVBuckets([])
    setX0Moved(false)
    setTrail([])
    setPeekTip(null)
    setShotsRemaining(SHOT_BUDGET_STAGE3)
  }, [])
  useReset(resetStageState)

  // Snap displayed position to effectiveX0 when idle
  useEffect(() => {
    if (!motion) setPos(effectiveX0)
  }, [effectiveX0, motion])

  // ─── GO (start motion) ────────────────────────────────────────────────
  const canGo = !motion && (!isStage3 || shotsRemaining > 0)
  const go = useCallback(() => {
    if (!canGo) return
    setMotion({ x0: effectiveX0, v, startedAt: performance.now() })
    setTNow(0)
    setPos(effectiveX0)
    setRunCount((n) => n + 1)
    if (isStage3) setShotsRemaining((n) => n - 1)
    if (isStage1) {
      const bucket = Math.round(v / 2) * 2
      setDistinctVBuckets((prev) => (prev.includes(bucket) ? prev : [...prev, bucket]))
    }
  }, [canGo, effectiveX0, v, isStage1, isStage3])

  // ─── Ticker (motion sim) ──────────────────────────────────────────────
  useTicker(() => {
    if (!motion) return
    const t = ((performance.now() - motion.startedAt) / 1000) * SPEED_FACTOR
    const rawX = motion.x0 + motion.v * t
    const p = clampX(rawX)
    setPos(p)
    setTNow(t)

    // Rendezvous check: for each target, evaluate closed-form position AT t*
    // (independent of ticker drift) and register a hit when the ticker time
    // has reached that instant.
    for (const target of activeTargets) {
      if (hits.includes(target.id)) continue
      if (t >= target.t) {
        const posAtT = motion.x0 + motion.v * target.t
        if (Math.abs(posAtT - target.x) < HIT_R_M) {
          setHits((prev) => (prev.includes(target.id) ? prev : [...prev, target.id]))
        }
      }
    }

    // End motion at T_MAX or if the puck leaves the visible range
    if (t >= T_MAX || rawX < X_MIN - 2 || rawX > X_MAX + 2) {
      setMotion(null)
      if (isStage1) {
        setTrail((prev) => [...prev.slice(-2), { x0: motion.x0, v: motion.v }])
      }
    }
  })

  // ─── Blind-stage fail (§5.2) ──────────────────────────────────────────
  useEffect(() => {
    if (!isStage3) return
    if (shotsRemaining === 0 && !motion && hits.length < activeTargets.length) {
      // Out of shots without full clearance — reset stage-3 state.
      resetStageState()
    }
  }, [isStage3, shotsRemaining, motion, hits.length, activeTargets.length, resetStageState])

  // ─── Advance predicate ────────────────────────────────────────────────
  const canSubmit = isStage1
    ? runCount >= 3 && distinctVBuckets.length >= 2 && x0Moved
    : hits.length === activeTargets.length && activeTargets.length > 0

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

  // ─── Peek — strategy hint text on stage 3, NEVER the graph ────────────
  const PEEK_TIPS = useMemo(
    () => [labels.peek_tip_formula, labels.peek_tip_sign, labels.peek_tip_bounds],
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

  // ─── Draggable puck for x₀ (stage 1 only, when idle) ──────────────────
  const svgPoint = (e: React.PointerEvent) => {
    const el = svgRef.current
    if (!el) return null
    const rect = el.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) / rect.width) * W,
      y: ((e.clientY - rect.top) / rect.height) * H,
    }
  }
  const applyX0FromPoint = (p: { x: number; y: number }) => {
    const worldX = (p.x - TRACK_X0) / PX_PER_M
    const clamped = Math.max(X0_MIN, Math.min(X0_MAX, worldX))
    setX0(clamped)
    setX0Moved(true)
  }
  const puckDown = (e: React.PointerEvent) => {
    if (motion) return
    if (!isStage1) return
    e.preventDefault()
    e.stopPropagation()
    setDragging(true)
  }
  const svgMove = (e: React.PointerEvent) => {
    if (!dragging) return
    const p = svgPoint(e)
    if (p) applyX0FromPoint(p)
  }

  // ─── HUD text ─────────────────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`
  const hudTR = `x₀ = ${effectiveX0.toFixed(1)} m · v = ${v.toFixed(1)} m/s`
  const hudTR2 = motion
    ? `t = ${tNow.toFixed(1)} s · x = ${pos.toFixed(1)} m`
    : isStage2 || isStage3
      ? `${labels.hits} ${hits.length}/${activeTargets.length}`
      : null
  const hudBL =
    isStage3 && peekTip
      ? peekTip
      : isStage1
        ? labels.tip1
        : isStage2
          ? labels.tip2
          : labels.tip3
  // BR reserved — empty per §4.3

  // ─── Show/hide layers per stage ───────────────────────────────────────
  const showGraph = isStage1 || isStage2 // hidden on stage 3 (blind)
  const showTrack = isStage1 || isStage2 // hidden on stage 3 (blind)
  const showPreviewLine = isStage2 // ghost x(t) preview only in stage 2
  const showX0Slider = isStage1 // x₀ set only in stage 1

  // Preview line (stage 2): x(t) = x₀ + v·t, clamped to graph box
  const previewLinePts = useMemo(() => {
    if (!showPreviewLine) return ''
    const y0 = graphSvgY(clampX(effectiveX0))
    const y1 = graphSvgY(clampX(effectiveX0 + v * T_MAX))
    return `M ${graphSvgX(0)} ${y0} L ${graphSvgX(T_MAX)} ${y1}`
  }, [showPreviewLine, effectiveX0, v])

  // Live x(t) trace of the current motion
  const liveTracePts = useMemo(() => {
    if (!motion || !showGraph) return ''
    const steps = 24
    const parts: string[] = []
    for (let i = 0; i <= steps; i++) {
      const tt = (tNow * i) / steps
      const xx = clampX(motion.x0 + motion.v * tt)
      parts.push(`${i === 0 ? 'M' : 'L'} ${graphSvgX(tt)} ${graphSvgY(xx)}`)
    }
    return parts.join(' ')
  }, [motion, tNow, showGraph])

  // Stage-1 fading trail: last 2-3 runs as straight x(t) lines
  const trailLines =
    isStage1 && showGraph
      ? trail.map((tr, i) => {
          const y0 = graphSvgY(clampX(tr.x0))
          const y1 = graphSvgY(clampX(tr.x0 + tr.v * T_MAX))
          return {
            d: `M ${graphSvgX(0)} ${y0} L ${graphSvgX(T_MAX)} ${y1}`,
            opacity: 0.18 + i * 0.14,
          }
        })
      : []

  const showLiveTraceOnGraph = motion && showGraph

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
        onPointerMove={svgMove}
        onPointerUp={() => setDragging(false)}
        onPointerLeave={() => setDragging(false)}
      >
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        {/* Subtle background grid */}
        {Array.from({ length: 12 }).map((_, i) => (
          <line
            key={`bgx${i}`}
            x1={i * 60 + 40}
            y1={0}
            x2={i * 60 + 40}
            y2={H}
            stroke="#12203a"
            strokeWidth={1}
          />
        ))}
        {Array.from({ length: 7 }).map((_, i) => (
          <line
            key={`bgy${i}`}
            x1={0}
            y1={i * 60 + 40}
            x2={W}
            y2={i * 60 + 40}
            stroke="#12203a"
            strokeWidth={1}
          />
        ))}

        {/* ─── Position-vs-time graph (stages 1 & 2) ─────────────── */}
        {showGraph && (
          <g>
            <rect
              x={GRAPH_X0 - 30}
              y={GRAPH_Y_TOP - 20}
              width={GRAPH_X1 - GRAPH_X0 + 60}
              height={GRAPH_Y_BOT - GRAPH_Y_TOP + 50}
              fill="#12203a"
              opacity={0.4}
              rx={6}
            />
            {/* Axes */}
            <line
              x1={GRAPH_X0}
              y1={GRAPH_Y_BOT}
              x2={GRAPH_X1}
              y2={GRAPH_Y_BOT}
              stroke="#3A4863"
              strokeWidth={1.5}
            />
            <line
              x1={GRAPH_X0}
              y1={GRAPH_Y_TOP}
              x2={GRAPH_X0}
              y2={GRAPH_Y_BOT}
              stroke="#3A4863"
              strokeWidth={1.5}
            />
            {/* t-axis ticks every 2 s */}
            {Array.from({ length: 6 }).map((_, i) => {
              const t = i * 2
              const px = graphSvgX(t)
              return (
                <g key={`gt${i}`}>
                  <line
                    x1={px}
                    y1={GRAPH_Y_BOT}
                    x2={px}
                    y2={GRAPH_Y_BOT + 4}
                    stroke="#54617A"
                    strokeWidth={1}
                  />
                  <text
                    x={px}
                    y={GRAPH_Y_BOT + 14}
                    fill="#54617A"
                    fontFamily="'JetBrains Mono', monospace"
                    fontSize={9}
                    textAnchor="middle"
                  >
                    {t}
                  </text>
                </g>
              )
            })}
            {/* x-axis ticks */}
            {[X_MIN, 10, 25, 40, X_MAX].map((xv, i) => {
              const py = graphSvgY(xv)
              return (
                <g key={`gx${i}`}>
                  <line x1={GRAPH_X0 - 4} y1={py} x2={GRAPH_X0} y2={py} stroke="#54617A" strokeWidth={1} />
                  <text
                    x={GRAPH_X0 - 8}
                    y={py + 3}
                    fill="#54617A"
                    fontFamily="'JetBrains Mono', monospace"
                    fontSize={9}
                    textAnchor="end"
                  >
                    {xv}
                  </text>
                </g>
              )
            })}
            {/* Axis labels */}
            <text
              x={GRAPH_X1 + 12}
              y={GRAPH_Y_BOT + 4}
              fill="#6C7A93"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={11}
            >
              {labels.t_axis}
            </text>
            <text
              x={GRAPH_X0 - 24}
              y={GRAPH_Y_TOP - 6}
              fill="#6C7A93"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={11}
            >
              {labels.x_axis}
            </text>

            {/* Stage-1 trail */}
            {trailLines.map((tl, i) => (
              <path
                key={`tl${i}`}
                d={tl.d}
                fill="none"
                stroke="#F97316"
                strokeWidth={1.4}
                strokeDasharray="2 5"
                opacity={tl.opacity}
              />
            ))}

            {/* Preview line (stage 2 only) */}
            {previewLinePts && (
              <path
                d={previewLinePts}
                fill="none"
                stroke="#37C9B8"
                strokeWidth={1.6}
                strokeDasharray="4 5"
                opacity={0.7}
              />
            )}

            {/* Live trace of current motion */}
            {showLiveTraceOnGraph && liveTracePts && (
              <path d={liveTracePts} fill="none" stroke="#F97316" strokeWidth={2} />
            )}

            {/* Rendezvous dots on graph — stage 2 only */}
            {isStage2 &&
              activeTargets.map((tg) => {
                const isHit = hits.includes(tg.id)
                return (
                  <circle
                    key={`gr${tg.id}`}
                    cx={graphSvgX(tg.t)}
                    cy={graphSvgY(tg.x)}
                    r={4}
                    fill={isHit ? '#37C9B8' : '#6C7A93'}
                    stroke={isHit ? '#1FA595' : '#54617A'}
                    strokeWidth={1.5}
                  />
                )
              })}
          </g>
        )}

        {/* ─── Track + puck (stages 1 & 2) ────────────────────────── */}
        {showTrack && (
          <>
            <Track xMin={0} xMax={50} yPx={TRACK_Y} toSvgX={trackSvgX} />

            {/* Stage-2 rendezvous beacons above the track */}
            {isStage2 &&
              activeTargets.map((tg, i) => (
                <g key={`rv${tg.id}`}>
                  <Rendezvous
                    x={trackSvgX(tg.x)}
                    y={TRACK_Y - 22 - i * 30}
                    hit={hits.includes(tg.id)}
                  />
                  <text
                    x={trackSvgX(tg.x)}
                    y={TRACK_Y - 22 - i * 30 - 18}
                    fill="#F9A968"
                    fontFamily="'JetBrains Mono', monospace"
                    fontSize={10}
                    textAnchor="middle"
                  >
                    t* = {tg.t}s
                  </text>
                </g>
              ))}

            {/* Puck */}
            <g
              onPointerDown={puckDown}
              style={{
                cursor: isStage1 && !motion ? (dragging ? 'grabbing' : 'grab') : 'default',
              }}
            >
              <Puck x={trackSvgX(pos)} y={TRACK_Y - 8} />
            </g>
          </>
        )}

        {/* ─── Stage 3 blind view: only x₀ mark, targets w/ labels, live puck ─ */}
        {isStage3 && (
          <g>
            {/* Reference line — no ticks, no numbers on the rail itself */}
            <line
              x1={trackSvgX(0)}
              y1={TRACK_Y}
              x2={trackSvgX(50)}
              y2={TRACK_Y}
              stroke="#3A4863"
              strokeWidth={1.2}
              strokeDasharray="3 5"
              opacity={0.55}
            />
            {/* Puck starting mark at x₀ (REQUIRED info) */}
            <g>
              <circle
                cx={trackSvgX(effectiveX0)}
                cy={TRACK_Y}
                r={4}
                fill="#F97316"
                opacity={0.7}
              />
              <text
                x={trackSvgX(effectiveX0)}
                y={TRACK_Y + 20}
                fill="#F9A968"
                fontFamily="'JetBrains Mono', monospace"
                fontSize={11}
                textAnchor="middle"
              >
                x₀ = {effectiveX0} m
              </text>
            </g>

            {/* Live puck during motion */}
            {motion && (
              <>
                <Puck x={trackSvgX(pos)} y={TRACK_Y - 8} />
                <text
                  x={trackSvgX(pos)}
                  y={TRACK_Y - 24}
                  fill="#F97316"
                  fontFamily="'JetBrains Mono', monospace"
                  fontSize={10}
                  textAnchor="middle"
                >
                  t = {tNow.toFixed(1)} s
                </text>
              </>
            )}

            {/* Rendezvous targets with (x*, t*) labels — REQUIRED info per §4.7 */}
            {activeTargets.map((tg, i) => (
              <g key={`bt${tg.id}`}>
                <Rendezvous
                  x={trackSvgX(tg.x)}
                  y={TRACK_Y - 40 - i * 34}
                  hit={hits.includes(tg.id)}
                />
                <text
                  x={trackSvgX(tg.x)}
                  y={TRACK_Y - 40 - i * 34 - 18}
                  fill="#F9A968"
                  fontFamily="'JetBrains Mono', monospace"
                  fontSize={10}
                  textAnchor="middle"
                >
                  (x*, t*) = ({tg.x} m, {tg.t} s)
                </text>
              </g>
            ))}
          </g>
        )}
      </svg>

      {/* ─── HUD overlays (HTML, rem) ─────────────────────────────── */}
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
          textAlign: 'right',
          zIndex: 5,
          pointerEvents: 'none',
        }}
      >
        {hudTR}
        {hudTR2 && <div style={{ marginTop: '0.6rem', color: '#6C7A93' }}>{hudTR2}</div>}
      </div>
      <div
        style={{
          position: 'absolute',
          bottom: '3rem',
          left: '3rem',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '2.1rem',
          letterSpacing: '0.06em',
          color: peekTip ? '#F9A968' : '#6C7A93',
          maxWidth: '52rem',
          lineHeight: 1.3,
          zIndex: 5,
          pointerEvents: 'none',
        }}
      >
        {hudBL}
      </div>

      {/* Stage-3 shot budget chip — NOT in BR */}
      {isStage3 && (
        <div
          style={{
            position: 'absolute',
            top: '9rem',
            left: '3rem',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '2.1rem',
            letterSpacing: '0.08em',
            color: '#F97316',
            padding: '0.6rem 1.4rem',
            background: 'rgba(249,115,22,0.12)',
            border: '0.2rem solid rgba(249,115,22,0.6)',
            borderRadius: '2rem',
            zIndex: 5,
            pointerEvents: 'none',
          }}
        >
          {labels.shots} {shotsRemaining}/{SHOT_BUDGET_STAGE3}
        </div>
      )}

      {/* ─── v slider (right side, vertical) ──────────────────────── */}
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
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.9rem', color: '#6C7A93' }}>
          {V_MAX}
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
            min={V_MIN}
            max={V_MAX}
            step={0.25}
            value={v}
            onChange={(e) => setV(Number(e.target.value))}
            disabled={!!motion}
            style={{
              width: '30rem',
              height: '2rem',
              transform: 'rotate(-90deg)',
              transformOrigin: 'center',
              accentColor: '#F97316',
              cursor: motion ? 'not-allowed' : 'pointer',
            }}
          />
        </div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.9rem', color: '#6C7A93' }}>
          {V_MIN}
        </div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.7rem', color: '#54617A' }}>
          v
        </div>
      </div>

      {/* ─── x₀ slider (left side, vertical) — stage 1 only ─────────── */}
      {showX0Slider && (
        <div
          style={{
            position: 'absolute',
            top: '14rem',
            left: '3rem',
            height: '38rem',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '1rem',
            zIndex: 6,
            marginTop: '5rem',
          }}
        >
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.9rem', color: '#6C7A93' }}>
            {X0_MAX}
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
              min={X0_MIN}
              max={X0_MAX}
              step={0.5}
              value={x0}
              onChange={(e) => {
                setX0(Number(e.target.value))
                setX0Moved(true)
              }}
              disabled={!!motion}
              style={{
                width: '30rem',
                height: '2rem',
                transform: 'rotate(-90deg)',
                transformOrigin: 'center',
                accentColor: '#37C9B8',
                cursor: motion ? 'not-allowed' : 'pointer',
              }}
            />
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.9rem', color: '#6C7A93' }}>
            {X0_MIN}
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.7rem', color: '#54617A' }}>
            x₀
          </div>
        </div>
      )}

      {/* ─── GO button (bottom-center) ────────────────────────────── */}
      <button
        type="button"
        onClick={go}
        disabled={!canGo}
        style={{
          position: 'absolute',
          bottom: '3rem',
          left: '50%',
          transform: 'translateX(-50%)',
          padding: '2rem 4rem',
          background: canGo ? '#F97316' : 'rgba(30,42,64,0.85)',
          color: canGo ? '#FFFFFF' : '#6C7A93',
          border: `0.3rem solid ${canGo ? '#F97316' : 'rgba(58,72,99,0.6)'}`,
          borderRadius: '100rem',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '2.6rem',
          fontWeight: 700,
          letterSpacing: '0.12em',
          cursor: canGo ? 'pointer' : 'not-allowed',
          zIndex: 10,
          transition: 'background 0.15s, transform 0.1s',
        }}
      >
        <i
          className="bi bi-play-fill"
          style={{ marginInlineEnd: '0.8rem', fontSize: '2.8rem', verticalAlign: '-0.2rem' }}
        />
        {labels.go}
      </button>
    </div>
  )
}
