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
} from '@physics/sdk/react'
import { getHintFor, getStagesFor } from './stages'
import en from '../i18n/en.json'
import fr from '../i18n/fr.json'
import ar from '../i18n/ar.json'
import { VectorArrow } from './art/VectorArrow'
import { TrajectoryPath } from './art/TrajectoryPath'
import { PointMarker } from './art/PointMarker'

// ─── Scene constants ────────────────────────────────────────────────────
const W = 800
const H = 450
// Origin O: sits inside the canvas, left-of-center. Position vectors OM
// are drawn from this SVG pixel.
const ORIGIN = { x: 260, y: 260 }
const PX_PER_M = 8 // isometric: 1 m = 8 SVG units in both x and y

// Vector display scales (SVG px per m/s and per m/s²). Chosen so nominal
// arrows fit inside the canvas without clipping.
const V_SCALE = 6 // px per (m/s)
const A_SCALE = 12 // px per (m/s²)

// ─── Setup type ─────────────────────────────────────────────────────────
type Vec = { x: number; y: number }
type Setup = {
  labelKey: 'curve_parabola' | 'curve_circle' | 'curve_line'
  T: number
  pos: (t: number) => Vec
  vel: (t: number) => Vec
  acc: (t: number) => Vec
  stage2Probes: { t: number; expectedSpeed: number }[]
  stage3Points: { t: number; label: string }[]
}

// ─── Setup A: parabolic motion (projectile) ────────────────────────────
// x(t) = 3 t,   y(t) = 4 t − t²   (metres, seconds; g = 2 m/s² for tidy numbers)
// vx = 3, vy = 4 − 2 t.   ax = 0, ay = −2.
// |v(0)| = 5, |v(2)| = 3 (apex), |v(4)| = 5.
const SETUP_PARABOLA: Setup = {
  labelKey: 'curve_parabola',
  T: 4,
  pos: (t) => ({ x: 3 * t, y: 4 * t - t * t }),
  vel: (t) => ({ x: 3, y: 4 - 2 * t }),
  acc: () => ({ x: 0, y: -2 }),
  stage2Probes: [
    { t: 0, expectedSpeed: 5 },
    { t: 2, expectedSpeed: 3 },
    { t: 4, expectedSpeed: 5 },
  ],
  stage3Points: [
    { t: 0.5, label: 'P₁' },
    { t: 2.0, label: 'P₂' },
    { t: 3.5, label: 'P₃' },
  ],
}

// ─── Setup B: uniform circular motion (half-arc) ───────────────────────
// R = 15 m, ω = 0.4 rad/s. Half arc: t ∈ [0, π/ω] ≈ 7.85 s.
// |v| = Rω = 6 m/s (constant).  |a| = Rω² = 2.4 m/s² (centripetal).
const R_CIRC = 15
const OMEGA = 0.4
const SETUP_CIRCLE: Setup = {
  labelKey: 'curve_circle',
  T: Math.PI / OMEGA,
  pos: (t) => ({ x: R_CIRC * Math.cos(OMEGA * t), y: R_CIRC * Math.sin(OMEGA * t) }),
  vel: (t) => ({ x: -R_CIRC * OMEGA * Math.sin(OMEGA * t), y: R_CIRC * OMEGA * Math.cos(OMEGA * t) }),
  acc: (t) => ({
    x: -R_CIRC * OMEGA * OMEGA * Math.cos(OMEGA * t),
    y: -R_CIRC * OMEGA * OMEGA * Math.sin(OMEGA * t),
  }),
  stage2Probes: [
    { t: 0, expectedSpeed: 6 },
    { t: Math.PI / (2 * OMEGA), expectedSpeed: 6 },
    { t: Math.PI / OMEGA, expectedSpeed: 6 },
  ],
  stage3Points: [
    { t: Math.PI / (4 * OMEGA), label: 'P₁' },
    { t: Math.PI / (2 * OMEGA), label: 'P₂' },
    { t: (3 * Math.PI) / (4 * OMEGA), label: 'P₃' },
  ],
}

// ─── Setup C: uniformly accelerated straight line ──────────────────────
// x(t) = 2 t + 0.5 t², y(t) = 5.  vx = 2 + t, vy = 0.  ax = 1, ay = 0.
// |v| = 2 + t (linear).  (v, a) collinear → angle 0°.
const SETUP_LINE: Setup = {
  labelKey: 'curve_line',
  T: 6,
  pos: (t) => ({ x: 2 * t + 0.5 * t * t, y: 5 }),
  vel: (t) => ({ x: 2 + t, y: 0 }),
  acc: () => ({ x: 1, y: 0 }),
  stage2Probes: [
    { t: 0, expectedSpeed: 2 },
    { t: 2, expectedSpeed: 4 },
    { t: 4, expectedSpeed: 6 },
  ],
  stage3Points: [
    { t: 1, label: 'P₁' },
    { t: 3, label: 'P₂' },
    { t: 5, label: 'P₃' },
  ],
}

const SETUPS: Setup[] = [SETUP_PARABOLA, SETUP_CIRCLE, SETUP_LINE]

// ─── Physics helpers (pure) ────────────────────────────────────────────
function toSvgX(m: number): number {
  return ORIGIN.x + m * PX_PER_M
}
function toSvgY(m: number): number {
  return ORIGIN.y - m * PX_PER_M
}
function mag(v: Vec): number {
  return Math.hypot(v.x, v.y)
}
function angleBetween(u: Vec, v: Vec): number {
  const mu = mag(u)
  const mv = mag(v)
  if (mu < 1e-9 || mv < 1e-9) return 0
  const cos = (u.x * v.x + u.y * v.y) / (mu * mv)
  return Math.acos(Math.max(-1, Math.min(1, cos)))
}
function sampleTrajectory(setup: Setup, steps = 80): Vec[] {
  const out: Vec[] = []
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * setup.T
    const p = setup.pos(t)
    out.push({ x: toSvgX(p.x), y: toSvgY(p.y) })
  }
  return out
}
// Angular difference in radians wrapped to [-π, π].
function angleDelta(a: number, b: number): number {
  let d = a - b
  while (d > Math.PI) d -= 2 * Math.PI
  while (d < -Math.PI) d += 2 * Math.PI
  return d
}
// Math-axes angle (ccw from +x) of a velocity vector, in radians.
function velDirRad(v: Vec): number {
  return Math.atan2(v.y, v.x)
}

// ─── Locale routing ────────────────────────────────────────────────────
const dict = { en, fr, ar } as const
type Locale = keyof typeof dict
function labelsFor(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── Blind-stage constants ─────────────────────────────────────────────
const ATTEMPT_BUDGET_STAGE3 = 2
const DIR_TOLERANCE_DEG = 15
const T_TOLERANCE_S = 0.25

export default function Scene() {
  const { locale, seed } = useInit()
  const stages = useMemo(() => getStagesFor(locale), [locale])
  useDeclareStages(stages)
  const labels = useMemo(() => labelsFor(locale), [locale])

  const setup = useMemo(() => SETUPS[seed % SETUPS.length]!, [seed])
  const trajectorySvg = useMemo(() => sampleTrajectory(setup), [setup])

  const stageIdx = useCurrentStage()
  const setStage = useSetStage()
  const complete = useComplete()
  const progress = useProgress()

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  // ─── Time scrub + stage-1 distinct-bucket tracking ──────────────────
  const [tSec, setTSec] = useState(0)
  const [distinctBuckets, setDistinctBuckets] = useState<number[]>([])

  // ─── Stage 2 ────────────────────────────────────────────────────────
  const [probeIdx, setProbeIdx] = useState(0)
  const [probeHits, setProbeHits] = useState<boolean[]>([false, false, false])
  const [feedback, setFeedback] = useState<'none' | 'ok' | 'miss'>('none')

  // ─── Stage 3 ────────────────────────────────────────────────────────
  const [arrowAngles, setArrowAngles] = useState<number[]>([0, 0, 0])
  const [attemptsRemaining, setAttemptsRemaining] = useState(ATTEMPT_BUDGET_STAGE3)
  const [pointResults, setPointResults] = useState<('default' | 'hit' | 'wrong')[]>([
    'default',
    'default',
    'default',
  ])
  const [submitted, setSubmitted] = useState(false)
  const [allCorrect, setAllCorrect] = useState(false)
  const [peekTip, setPeekTip] = useState<string | null>(null)
  const [draggingArrow, setDraggingArrow] = useState<number | null>(null)

  const svgRef = useRef<SVGSVGElement>(null)

  // ─── Derived instant values ─────────────────────────────────────────
  const posNow = useMemo(() => setup.pos(tSec), [setup, tSec])
  const velNow = useMemo(() => setup.vel(tSec), [setup, tSec])
  const accNow = useMemo(() => setup.acc(tSec), [setup, tSec])
  const speedNow = mag(velNow)
  const accMagNow = mag(accNow)
  const vaAngleDeg = (angleBetween(velNow, accNow) * 180) / Math.PI

  // ─── Reset ──────────────────────────────────────────────────────────
  const resetStageState = useCallback(() => {
    setTSec(0)
    setDistinctBuckets([])
    setProbeIdx(0)
    setProbeHits([false, false, false])
    setFeedback('none')
    setArrowAngles([0, 0, 0])
    setAttemptsRemaining(ATTEMPT_BUDGET_STAGE3)
    setPointResults(['default', 'default', 'default'])
    setSubmitted(false)
    setAllCorrect(false)
    setPeekTip(null)
    setDraggingArrow(null)
  }, [])
  useReset(resetStageState)

  // ─── Scrub handler ──────────────────────────────────────────────────
  const onScrub = useCallback(
    (v: number) => {
      setTSec(v)
      if (isStage1) {
        const bucket = Math.floor((v / setup.T) * 10)
        setDistinctBuckets((prev) => (prev.includes(bucket) ? prev : [...prev, bucket]))
      }
    },
    [isStage1, setup.T],
  )

  // ─── Stage 2 confirm ────────────────────────────────────────────────
  const confirmProbe = useCallback(() => {
    if (!isStage2) return
    const probe = setup.stage2Probes[probeIdx]
    if (!probe) return
    if (Math.abs(tSec - probe.t) <= T_TOLERANCE_S) {
      setProbeHits((prev) => {
        const next = [...prev]
        next[probeIdx] = true
        return next
      })
      setFeedback('ok')
      setTimeout(() => {
        setFeedback('none')
        setProbeIdx((n) => Math.min(n + 1, setup.stage2Probes.length - 1))
      }, 700)
    } else {
      setFeedback('miss')
      setTimeout(() => setFeedback('none'), 700)
    }
  }, [isStage2, probeIdx, setup.stage2Probes, tSec])

  // ─── Stage 3 arrow drag ─────────────────────────────────────────────
  const svgPoint = useCallback((e: React.PointerEvent) => {
    const el = svgRef.current
    if (!el) return null
    const rect = el.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) / rect.width) * W,
      y: ((e.clientY - rect.top) / rect.height) * H,
    }
  }, [])

  const startArrowDrag = useCallback(
    (idx: number, e: React.PointerEvent) => {
      if (!isStage3 || submitted) return
      e.stopPropagation()
      setDraggingArrow(idx)
    },
    [isStage3, submitted],
  )

  const svgMove = useCallback(
    (e: React.PointerEvent) => {
      if (draggingArrow === null) return
      const p = svgPoint(e)
      if (!p) return
      const point = setup.stage3Points[draggingArrow]
      if (!point) return
      const pos = setup.pos(point.t)
      const cx = toSvgX(pos.x)
      const cy = toSvgY(pos.y)
      const svgAngle = Math.atan2(p.y - cy, p.x - cx)
      // SVG y grows downward → math-axes angle is the negation.
      const mathAngle = -svgAngle
      setArrowAngles((prev) => {
        const next = [...prev]
        next[draggingArrow] = mathAngle
        return next
      })
    },
    [draggingArrow, setup, svgPoint],
  )

  const stopDrag = useCallback(() => {
    setDraggingArrow(null)
  }, [])

  // ─── Stage 3 submit ─────────────────────────────────────────────────
  const submit = useCallback(() => {
    if (!isStage3 || submitted || attemptsRemaining <= 0) return
    const results: ('default' | 'hit' | 'wrong')[] = ['default', 'default', 'default']
    let correct = true
    setup.stage3Points.forEach((pt, i) => {
      const expected = velDirRad(setup.vel(pt.t))
      const guess = arrowAngles[i] ?? 0
      const diffDeg = Math.abs((angleDelta(guess, expected) * 180) / Math.PI)
      if (diffDeg <= DIR_TOLERANCE_DEG) {
        results[i] = 'hit'
      } else {
        results[i] = 'wrong'
        correct = false
      }
    })
    setPointResults(results)
    setSubmitted(true)
    setAllCorrect(correct)
    if (!correct) setAttemptsRemaining((n) => n - 1)
  }, [arrowAngles, attemptsRemaining, isStage3, setup, submitted])

  const retryStage3 = useCallback(() => {
    setSubmitted(false)
    setPointResults(['default', 'default', 'default'])
  }, [])

  // Fail-with-restart: budget exhausted and not all correct.
  useEffect(() => {
    if (!isStage3) return
    if (submitted && !allCorrect && attemptsRemaining === 0) {
      const to = setTimeout(() => {
        resetStageState()
      }, 1200)
      return () => clearTimeout(to)
    }
    return undefined
  }, [isStage3, submitted, allCorrect, attemptsRemaining, resetStageState])

  // ─── Advance predicate ──────────────────────────────────────────────
  const canSubmit = isStage1
    ? distinctBuckets.length >= 4
    : isStage2
      ? probeHits.every(Boolean)
      : allCorrect

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

  // ─── Peek (blind-stage strategy hint — text only, never the answer) ──
  const PEEK_TIPS = useMemo(
    () => [labels.peek_tip_tangent, labels.peek_tip_direction, labels.peek_tip_circle],
    [labels],
  )
  const peekIdxRef = useRef(0)
  usePeek(() => {
    if (!isStage3) return
    const tip = PEEK_TIPS[peekIdxRef.current % PEEK_TIPS.length]!
    setPeekTip(tip)
    peekIdxRef.current += 1
  })
  useEffect(() => {
    if (!peekTip) return
    const to = setTimeout(() => setPeekTip(null), 4500)
    return () => clearTimeout(to)
  }, [peekTip])

  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  // ─── Grid ────────────────────────────────────────────────────────────
  const gridLines: React.ReactNode[] = []
  for (let gx = 40; gx < W; gx += 60) {
    gridLines.push(
      <line key={`gx${gx}`} x1={gx} y1={0} x2={gx} y2={H} stroke="#12203a" strokeWidth={1} />,
    )
  }
  for (let gy = 40; gy < H; gy += 60) {
    gridLines.push(
      <line key={`gy${gy}`} x1={0} y1={gy} x2={W} y2={gy} stroke="#12203a" strokeWidth={1} />,
    )
  }

  // ─── Positions of the moving point + vector tips ────────────────────
  const mSvg = { x: toSvgX(posNow.x), y: toSvgY(posNow.y) }
  const vTip = { x: mSvg.x + velNow.x * V_SCALE, y: mSvg.y - velNow.y * V_SCALE }
  const aTip = { x: mSvg.x + accNow.x * A_SCALE, y: mSvg.y - accNow.y * A_SCALE }

  const currentProbe = isStage2 ? setup.stage2Probes[probeIdx] : undefined

  // ─── HUD strings ─────────────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`
  const hudTR1 = `${labels.time} = ${tSec.toFixed(2)} s`
  // Speed KEPT on stages 1 + 2 (required to answer the stage-2 prompt).
  // Speed HIDDEN on stage 3 (magnitude is help, direction is what's tested).
  const hudTR2 = isStage3
    ? `${labels.accel} = ${accMagNow.toFixed(2)} m/s²`
    : `${labels.speed} = ${speedNow.toFixed(2)} m/s`
  const hudTR3 = isStage1
    ? `${labels.accel} = ${accMagNow.toFixed(2)} m/s² · ${labels.va_angle} = ${vaAngleDeg.toFixed(0)}°`
    : isStage2
      ? currentProbe
        ? `${labels.target} ${probeIdx + 1}/${setup.stage2Probes.length}: ${labels.time} = ${currentProbe.t.toFixed(2)} s`
        : ''
      : `${labels.attempts}: ${attemptsRemaining}/${ATTEMPT_BUDGET_STAGE3}`
  const hudBL =
    isStage3 && peekTip
      ? peekTip
      : isStage1
        ? labels.tip1
        : isStage2
          ? labels.tip2
          : labels.tip3

  const showVectorsVA = !isStage3 // v + a arrows hidden on the blind stage

  const primaryColor = '#37C9B8'
  const accentColor = '#F97316'
  const accelColor = '#F9A968'
  const posColor = '#8DA2C7'

  const feedbackStroke =
    feedback === 'ok' ? primaryColor : feedback === 'miss' ? '#EF4444' : 'transparent'

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
        onPointerUp={stopDrag}
        onPointerLeave={stopDrag}
      >
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />
        {gridLines}

        {/* Axes through origin */}
        <line
          x1={ORIGIN.x - 200}
          y1={ORIGIN.y}
          x2={ORIGIN.x + 200}
          y2={ORIGIN.y}
          stroke="#3A4863"
          strokeWidth={1}
          strokeDasharray="3 4"
        />
        <line
          x1={ORIGIN.x}
          y1={ORIGIN.y - 180}
          x2={ORIGIN.x}
          y2={ORIGIN.y + 180}
          stroke="#3A4863"
          strokeWidth={1}
          strokeDasharray="3 4"
        />

        {/* Trajectory */}
        <TrajectoryPath points={trajectorySvg} color="#3A4863" width={1.6} opacity={0.85} />

        {/* Origin */}
        <g transform={`translate(${ORIGIN.x} ${ORIGIN.y})`}>
          <circle cx={0} cy={0} r={3.5} fill="#B9C4D6" />
          <text
            x={-12}
            y={-8}
            fill="#B9C4D6"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={12}
            textAnchor="end"
          >
            {labels.origin}
          </text>
        </g>

        {/* Stage 3: probe points on trajectory, with coord labels (required info) */}
        {isStage3 &&
          setup.stage3Points.map((pt, i) => {
            const p = setup.pos(pt.t)
            const cx = toSvgX(p.x)
            const cy = toSvgY(p.y)
            return (
              <g key={`sp${i}`}>
                <PointMarker x={cx} y={cy} label={pt.label} state={pointResults[i] ?? 'default'} />
                <text
                  x={cx}
                  y={cy + 22}
                  fill="#B9C4D6"
                  fontFamily="'JetBrains Mono', monospace"
                  fontSize={10}
                  textAnchor="middle"
                >
                  ({p.x.toFixed(1)}, {p.y.toFixed(1)}) m · {labels.time}={pt.t.toFixed(1)}s
                </text>
              </g>
            )
          })}

        {/* Stage 3: student-controlled velocity arrows */}
        {isStage3 &&
          setup.stage3Points.map((pt, i) => {
            const p = setup.pos(pt.t)
            const cx = toSvgX(p.x)
            const cy = toSvgY(p.y)
            const angle = arrowAngles[i] ?? 0
            const armLen = 32
            const tipX = cx + armLen * Math.cos(angle)
            const tipY = cy - armLen * Math.sin(angle)
            const color =
              pointResults[i] === 'hit'
                ? primaryColor
                : pointResults[i] === 'wrong'
                  ? '#EF4444'
                  : accentColor
            return (
              <g key={`arr${i}`}>
                <VectorArrow
                  x1={cx}
                  y1={cy}
                  x2={tipX}
                  y2={tipY}
                  color={color}
                  label={labels.vector_v}
                  strokeWidth={2.6}
                  headSize={10}
                />
                <circle
                  cx={tipX}
                  cy={tipY}
                  r={14}
                  fill="rgba(249,115,22,0.12)"
                  stroke={color}
                  strokeWidth={1.2}
                  style={{ cursor: submitted ? 'default' : 'grab' }}
                  onPointerDown={(e) => startArrowDrag(i, e)}
                />
                {/* Live angle readout — required info per §4.7 */}
                <text
                  x={tipX + 16}
                  y={tipY - 10}
                  fill={color}
                  fontFamily="'JetBrains Mono', monospace"
                  fontSize={10}
                >
                  {((angle * 180) / Math.PI).toFixed(0)}°
                </text>
              </g>
            )
          })}

        {/* Stages 1 + 2: OM (position vector) + v + a */}
        {!isStage3 && (
          <>
            <VectorArrow
              x1={ORIGIN.x}
              y1={ORIGIN.y}
              x2={mSvg.x}
              y2={mSvg.y}
              color={posColor}
              label={`${labels.origin}${labels.point_m}`}
              strokeWidth={1.8}
              headSize={8}
              opacity={0.85}
            />
            {showVectorsVA && (
              <>
                <VectorArrow
                  x1={mSvg.x}
                  y1={mSvg.y}
                  x2={vTip.x}
                  y2={vTip.y}
                  color={primaryColor}
                  label={labels.vector_v}
                  strokeWidth={2.6}
                  headSize={10}
                />
                <VectorArrow
                  x1={mSvg.x}
                  y1={mSvg.y}
                  x2={aTip.x}
                  y2={aTip.y}
                  color={accelColor}
                  label={labels.vector_a}
                  strokeWidth={2.2}
                  headSize={9}
                />
              </>
            )}
          </>
        )}

        {/* Moving point M (stages 1 + 2) */}
        {!isStage3 && <PointMarker x={mSvg.x} y={mSvg.y} label={labels.point_m} radius={6} />}

        {/* Stage-2 confirmation flash */}
        {isStage2 && feedback !== 'none' && (
          <rect
            x={0}
            y={0}
            width={W}
            height={H}
            fill="none"
            stroke={feedbackStroke}
            strokeWidth={4}
            opacity={0.8}
          />
        )}

        {/* Curve family badge — subtle, top-right INSIDE the SVG. BR quadrant untouched. */}
        <text
          x={W - 20}
          y={30}
          fill="#54617A"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={10}
          textAnchor="end"
        >
          {labels[setup.labelKey]}
        </text>
      </svg>

      {/* HUD overlays */}
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
          letterSpacing: '0.06em',
          color: '#37C9B8',
          zIndex: 5,
          pointerEvents: 'none',
          textAlign: 'right',
          lineHeight: 1.4,
        }}
      >
        <div>{hudTR1}</div>
        <div style={{ color: '#F9A968', marginTop: '0.5rem' }}>{hudTR2}</div>
        {hudTR3 && <div style={{ color: '#6C7A93', marginTop: '0.5rem' }}>{hudTR3}</div>}
      </div>
      <div
        style={{
          position: 'absolute',
          bottom: '3rem',
          left: '3rem',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '2rem',
          letterSpacing: '0.06em',
          color: isStage3 && peekTip ? '#F9A968' : '#6C7A93',
          zIndex: 5,
          pointerEvents: 'none',
          maxWidth: '54rem',
          lineHeight: 1.35,
        }}
      >
        {hudBL}
      </div>
      {/* BR reserved for parent chrome (fullscreen). No overlay here. */}

      {/* Time slider — bottom-center strip */}
      <div
        style={{
          position: 'absolute',
          bottom: '11rem',
          left: '18rem',
          right: '18rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.6rem',
          zIndex: 6,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '1.7rem',
            color: '#6C7A93',
          }}
        >
          <span>0.00 s</span>
          <span>{setup.T.toFixed(2)} s</span>
        </div>
        <input
          type="range"
          min={0}
          max={setup.T}
          step={setup.T / 200}
          value={tSec}
          onChange={(e) => onScrub(Number(e.target.value))}
          style={{
            width: '100%',
            height: '2rem',
            accentColor: accentColor,
            cursor: 'pointer',
          }}
        />
      </div>

      {/* Stage-2 CONFIRM button */}
      {isStage2 && (
        <button
          type="button"
          onClick={confirmProbe}
          disabled={probeHits.every(Boolean)}
          style={{
            position: 'absolute',
            bottom: '3rem',
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '2rem 4rem',
            background: probeHits.every(Boolean) ? 'rgba(30,42,64,0.85)' : accentColor,
            color: probeHits.every(Boolean) ? '#6C7A93' : '#FFFFFF',
            border: `0.3rem solid ${
              probeHits.every(Boolean) ? 'rgba(58,72,99,0.6)' : accentColor
            }`,
            borderRadius: '100rem',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '2.4rem',
            fontWeight: 700,
            letterSpacing: '0.12em',
            cursor: probeHits.every(Boolean) ? 'not-allowed' : 'pointer',
            zIndex: 10,
          }}
        >
          <i
            className="bi bi-crosshair"
            style={{ marginInlineEnd: '0.8rem', fontSize: '2.6rem', verticalAlign: '-0.2rem' }}
          />
          {labels.fire}
        </button>
      )}

      {/* Stage-3 SUBMIT / RETRY button */}
      {isStage3 && (
        <button
          type="button"
          onClick={submitted && !allCorrect && attemptsRemaining > 0 ? retryStage3 : submit}
          disabled={submitted && (allCorrect || attemptsRemaining === 0)}
          style={{
            position: 'absolute',
            bottom: '3rem',
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '2rem 4rem',
            background:
              submitted && (allCorrect || attemptsRemaining === 0)
                ? 'rgba(30,42,64,0.85)'
                : accentColor,
            color:
              submitted && (allCorrect || attemptsRemaining === 0) ? '#6C7A93' : '#FFFFFF',
            border: `0.3rem solid ${
              submitted && (allCorrect || attemptsRemaining === 0)
                ? 'rgba(58,72,99,0.6)'
                : accentColor
            }`,
            borderRadius: '100rem',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '2.4rem',
            fontWeight: 700,
            letterSpacing: '0.12em',
            cursor:
              submitted && (allCorrect || attemptsRemaining === 0) ? 'not-allowed' : 'pointer',
            zIndex: 10,
          }}
        >
          <i
            className="bi bi-check2-circle"
            style={{ marginInlineEnd: '0.8rem', fontSize: '2.6rem', verticalAlign: '-0.2rem' }}
          />
          {labels.submit}
        </button>
      )}
    </div>
  )
}
