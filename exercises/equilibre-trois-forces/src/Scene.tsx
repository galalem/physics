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

// ─── Scene constants ────────────────────────────────────────────────────
const W = 800
const H = 450

// Ring (physical panel center)
const RING = { x: 260, y: 225 }
// Dynamique panel origin
const DYN = { x: 560, y: 240 }

// Force → SVG px scale
const K = 26 // px per Newton

// Panel bounds
const PHYS_BOX = { x: 24, y: 60, w: 440, h: 358 }
const DYN_BOX = { x: 480, y: 60, w: 296, h: 358 }

// Tolerance for hit-test on F3 vector match
const HIT_REL_TOL = 0.12 // 12% relative vector error
const HIT_ABS_TOL = 0.35 // 0.35 N absolute floor

// Stage-1 exploration criteria
const S1_MIN_MAG = 1.5      // must have pulled F3 to at least this magnitude
const S1_ANG_COVERAGE = 90  // cumulative rotation in degrees

// Stage-2 shot budget for 3 setups
const S2_SHOT_BUDGET = 5

// ─── Setup data ─────────────────────────────────────────────────────────
type Force = { m: number; a: number } // magnitude (N), angle (deg, Cartesian)
type Setup = { f1: Force; f2: Force }

const STAGE1_SETUP: Setup = { f1: { m: 3, a: 30 }, f2: { m: 3, a: 150 } }

const STAGE2_SETUPS: Setup[] = [
  { f1: { m: 4, a: 0 },  f2: { m: 3, a: 90  } },  // → F3 = 5 N @ 233.13°
  { f1: { m: 3, a: 30 }, f2: { m: 3, a: 150 } },  // → F3 = 3 N @ 270°
  { f1: { m: 4, a: 0 },  f2: { m: 4, a: 120 } },  // → F3 = 4 N @ 240°
]

const STAGE3_SETUP_BATCHES: Setup[][] = [
  [
    { f1: { m: 3, a: 0  }, f2: { m: 4, a: 90  } },  // F3 = 5 N @ 233.13°
    { f1: { m: 5, a: 0  }, f2: { m: 5, a: 120 } },  // F3 = 5 N @ 240°
    { f1: { m: 3, a: 90 }, f2: { m: 4, a: 180 } },  // F3 = 5 N @ 323.13°
  ],
  [
    { f1: { m: 6, a: 30 }, f2: { m: 6, a: 150 } },  // F3 = 6 N @ 270°
    { f1: { m: 4, a: 45 }, f2: { m: 4, a: 135 } },  // F3 = ~5.66 N @ 270°
    { f1: { m: 4, a: 0  }, f2: { m: 3, a: 90  } },  // F3 = 5 N @ 233.13°
  ],
  [
    { f1: { m: 3, a: 0 },  f2: { m: 4, a: 270 } },  // F3 = 5 N @ 126.87°
    { f1: { m: 4, a: 60 }, f2: { m: 4, a: 300 } },  // F3 = 4 N @ 180°
    { f1: { m: 5, a: 90 }, f2: { m: 5, a: 210 } },  // F3 = 5 N @ 330°
  ],
]

const dict = { en } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── Pure vector math ───────────────────────────────────────────────────
function toXY(f: Force): { x: number; y: number } {
  const rad = (f.a * Math.PI) / 180
  return { x: f.m * Math.cos(rad), y: f.m * Math.sin(rad) }
}
function fromXY(v: { x: number; y: number }): Force {
  const m = Math.hypot(v.x, v.y)
  let a = (Math.atan2(v.y, v.x) * 180) / Math.PI
  if (a < 0) a += 360
  return { m, a }
}
function solveF3(setup: Setup): { x: number; y: number } {
  const a = toXY(setup.f1)
  const b = toXY(setup.f2)
  return { x: -(a.x + b.x), y: -(a.y + b.y) }
}
function hit(f3: { x: number; y: number }, target: { x: number; y: number }) {
  const dx = f3.x - target.x
  const dy = f3.y - target.y
  const err = Math.hypot(dx, dy)
  const mag = Math.hypot(target.x, target.y) || 1
  return err < Math.max(HIT_REL_TOL * mag, HIT_ABS_TOL)
}

// Cartesian vector → SVG endpoint (y-flip, scaled by K)
function tipOf(origin: { x: number; y: number }, vec: { x: number; y: number }) {
  return { x: origin.x + vec.x * K, y: origin.y - vec.y * K }
}

// ─── Arrow primitive (SVG) ──────────────────────────────────────────────
function Arrow({
  from,
  to,
  color,
  opacity = 1,
  width = 2.4,
  dashed = false,
  headLen = 11,
  headW = 8,
}: {
  from: { x: number; y: number }
  to: { x: number; y: number }
  color: string
  opacity?: number
  width?: number
  dashed?: boolean
  headLen?: number
  headW?: number
}) {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.hypot(dx, dy)
  if (len < 0.5) return null
  const ux = dx / len
  const uy = dy / len
  const hL = Math.min(headLen, len * 0.6)
  const bx = to.x - ux * hL
  const by = to.y - uy * hL
  const px = -uy
  const py = ux
  const h1x = bx + px * headW / 2
  const h1y = by + py * headW / 2
  const h2x = bx - px * headW / 2
  const h2y = by - py * headW / 2
  return (
    <g opacity={opacity}>
      <line
        x1={from.x}
        y1={from.y}
        x2={bx}
        y2={by}
        stroke={color}
        strokeWidth={width}
        strokeLinecap="round"
        strokeDasharray={dashed ? '4 3' : undefined}
      />
      <polygon
        points={`${to.x},${to.y} ${h1x},${h1y} ${h2x},${h2y}`}
        fill={color}
      />
    </g>
  )
}

// ─── Component ──────────────────────────────────────────────────────────
export default function Scene() {
  const { locale, seed } = useInit()
  const stages = useMemo(() => getStagesFor(locale), [locale])
  useDeclareStages(stages)
  const labels = useMemo(() => svgLabels(locale), [locale])

  const stageIdx = useCurrentStage()
  const setStage = useSetStage()
  const complete = useComplete()
  const progress = useProgress()

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  // Stage-3 setup batch — chosen by seed, rotates on miss-restart.
  const [batchOffset, setBatchOffset] = useState(0)
  const stage3Setups = useMemo(
    () =>
      STAGE3_SETUP_BATCHES[(seed + batchOffset) % STAGE3_SETUP_BATCHES.length]!,
    [seed, batchOffset],
  )

  // State
  const [f3, setF3] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const [pairIdx, setPairIdx] = useState(0)
  const [cleared, setCleared] = useState<boolean[]>([])
  const [shots, setShots] = useState(0)
  const [peekVisible, setPeekVisible] = useState(false)
  const [postReveal, setPostReveal] = useState(false)
  const [cumRot, setCumRot] = useState(0)
  const [maxMagExplored, setMaxMagExplored] = useState(0)

  const prevAngleRef = useRef<number | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const revealTimerRef = useRef<number | null>(null)

  const currentSetup: Setup = isStage1
    ? STAGE1_SETUP
    : isStage2
      ? (STAGE2_SETUPS[Math.min(pairIdx, STAGE2_SETUPS.length - 1)] ??
        STAGE2_SETUPS[0]!)
      : (stage3Setups[Math.min(pairIdx, stage3Setups.length - 1)] ??
        stage3Setups[0]!)

  const target = useMemo(() => solveF3(currentSetup), [currentSetup])
  const isClosed = hit(f3, target)

  const resetStageState = useCallback(() => {
    setF3({ x: 0, y: 0 })
    setPairIdx(0)
    setCleared([])
    setShots(0)
    setPeekVisible(false)
    setPostReveal(false)
    setCumRot(0)
    setMaxMagExplored(0)
    prevAngleRef.current = null
    if (revealTimerRef.current !== null) {
      clearTimeout(revealTimerRef.current)
      revealTimerRef.current = null
    }
  }, [])
  useReset(resetStageState)

  // Advance predicate per stage
  const stage1Done = cumRot > S1_ANG_COVERAGE && maxMagExplored > S1_MIN_MAG
  const stage2Done =
    cleared.filter(Boolean).length >= STAGE2_SETUPS.length
  const stage3AllShotsFired = pairIdx >= stage3Setups.length && !postReveal
  const stage3AllLit =
    cleared.filter(Boolean).length >= stage3Setups.length
  const stage3Done = stage3AllShotsFired && stage3AllLit
  const canSubmit = isStage1 ? stage1Done : isStage2 ? stage2Done : stage3Done

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

  // Confirm action for stages 2, 3
  const canConfirm = isStage2
    ? shots < S2_SHOT_BUDGET && !stage2Done
    : isStage3
      ? pairIdx < stage3Setups.length && !postReveal
      : false

  const confirm = useCallback(() => {
    if (!canConfirm) return
    const ok = hit(f3, target)
    if (isStage2) {
      setShots((s) => s + 1)
      if (ok) {
        setCleared((prev) => {
          const next = [...prev]
          next[pairIdx] = true
          return next
        })
        // advance pair on hit; on miss student can retry the same pair
        // until shots exhausted (§5.2 budget-then-restart).
        if (pairIdx + 1 < STAGE2_SETUPS.length) {
          setPairIdx(pairIdx + 1)
          setF3({ x: 0, y: 0 })
        }
      }
    } else if (isStage3) {
      // one-shot-per-target — advance regardless of hit
      setShots((s) => s + 1)
      setCleared((prev) => {
        const next = [...prev]
        next[pairIdx] = ok
        return next
      })
      setPostReveal(true)
      if (revealTimerRef.current !== null) clearTimeout(revealTimerRef.current)
      revealTimerRef.current = window.setTimeout(() => {
        setPostReveal(false)
        setPairIdx((i) => i + 1)
        setF3({ x: 0, y: 0 })
        revealTimerRef.current = null
      }, 1300)
    }
  }, [canConfirm, isStage2, isStage3, f3, target, pairIdx])

  // Stage-3 restart on any miss after all setups shot
  useEffect(() => {
    if (!isStage3) return
    if (pairIdx < stage3Setups.length) return
    if (postReveal) return
    const allLit = cleared.filter(Boolean).length >= stage3Setups.length
    if (allLit) return
    // Missed at least one — rotate batch and reset after a beat.
    const t = window.setTimeout(() => {
      setBatchOffset((o) => o + 1)
      resetStageState()
    }, 800)
    return () => clearTimeout(t)
  }, [
    isStage3,
    pairIdx,
    postReveal,
    cleared,
    stage3Setups.length,
    resetStageState,
  ])

  // Peek — strategy hint + current DOF value (§4.7 rule 4)
  usePeek(() => {
    if (!isStage3) return
    setPeekVisible(true)
  })
  useEffect(() => {
    if (!peekVisible) return
    const t = setTimeout(() => setPeekVisible(false), 1800)
    return () => clearTimeout(t)
  }, [peekVisible])

  // Hints
  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  // Spacebar → confirm (stages 2 & 3)
  useEffect(() => {
    if (isStage1) return
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault()
        confirm()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isStage1, confirm])

  // Cleanup timers on unmount
  useEffect(
    () => () => {
      if (revealTimerRef.current !== null)
        clearTimeout(revealTimerRef.current)
    },
    [],
  )

  // ─── Pointer / drag ──────────────────────────────────────────────────
  const svgPoint = (e: React.PointerEvent) => {
    const el = svgRef.current
    if (!el) return null
    const rect = el.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) / rect.width) * W,
      y: ((e.clientY - rect.top) / rect.height) * H,
    }
  }
  const applyDrag = (p: { x: number; y: number }) => {
    // Ignore drag during stage-3 post-reveal (feedback is showing)
    if (isStage3 && postReveal) return
    if (isStage3 && pairIdx >= stage3Setups.length) return
    if (isStage2 && (shots >= S2_SHOT_BUDGET || stage2Done)) return

    const dx = (p.x - RING.x) / K
    const dy = -(p.y - RING.y) / K
    const mag = Math.hypot(dx, dy)
    const clamped = Math.min(mag, 10)
    let vx = 0
    let vy = 0
    if (mag > 0) {
      vx = (dx / mag) * clamped
      vy = (dy / mag) * clamped
    }
    setF3({ x: vx, y: vy })

    if (isStage1 && mag > 0) {
      const ang = Math.atan2(dy, dx)
      if (prevAngleRef.current !== null) {
        let d = ang - prevAngleRef.current
        while (d > Math.PI) d -= 2 * Math.PI
        while (d < -Math.PI) d += 2 * Math.PI
        setCumRot((c) => c + (Math.abs(d) * 180) / Math.PI)
      }
      prevAngleRef.current = ang
      setMaxMagExplored((m) => Math.max(m, clamped))
    }
  }

  // ─── Derived geometry ────────────────────────────────────────────────
  const v1 = toXY(currentSetup.f1)
  const v2 = toXY(currentSetup.f2)
  const gapVec = { x: v1.x + v2.x + f3.x, y: v1.y + v2.y + f3.y }
  const gapMag = Math.hypot(gapVec.x, gapVec.y)

  // Physical panel arrow tips
  const T1 = tipOf(RING, v1)
  const T2 = tipOf(RING, v2)
  const T3 = tipOf(RING, f3)

  // Dynamique panel head-to-tail chain
  const A = DYN
  const B = tipOf(A, v1)
  const C = tipOf(B, v2)
  const D = tipOf(C, f3)

  const showDyn =
    isStage1 ||
    isStage2 ||
    (isStage3 && (peekVisible || postReveal))

  const showConfirm = !isStage1

  const f3Force = fromXY(f3)
  const stageName = stages[stageIdx - 1]?.name ?? ''

  // HUD strings
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`
  const hudTR = isStage1
    ? isClosed
      ? `${labels.closed} · F3 ${f3Force.m.toFixed(2)}N @ ${f3Force.a.toFixed(0)}°`
      : `F3 ${f3Force.m.toFixed(2)}N @ ${f3Force.a.toFixed(0)}°  ·  ${labels.gap} ${gapMag.toFixed(2)}N`
    : isStage2
      ? isClosed && canConfirm
        ? `${labels.closed} · F3 ${f3Force.m.toFixed(2)}N @ ${f3Force.a.toFixed(0)}°`
        : `F3 ${f3Force.m.toFixed(2)}N @ ${f3Force.a.toFixed(0)}°  ·  ${labels.gap} ${gapMag.toFixed(2)}N`
      : postReveal
        ? isClosed
          ? `${labels.closed} · F3 ${f3Force.m.toFixed(2)}N @ ${f3Force.a.toFixed(0)}°`
          : `${labels.gap} ${gapMag.toFixed(2)}N · F3 ${f3Force.m.toFixed(2)}N @ ${f3Force.a.toFixed(0)}°`
        : `F3 ${f3Force.m.toFixed(2)}N @ ${f3Force.a.toFixed(0)}°`
  const hudBL = isStage1 ? labels.tip1 : isStage2 ? labels.tip2 : labels.tip3

  // Stage-2 progress line (under TR)
  const stage2Status = isStage2
    ? `${labels.setup} ${Math.min(pairIdx + 1, STAGE2_SETUPS.length)}/${STAGE2_SETUPS.length}  ·  ${labels.shots} ${shots}/${S2_SHOT_BUDGET}  ·  ${labels.cleared} ${cleared.filter(Boolean).length}/${STAGE2_SETUPS.length}`
    : ''

  // Stage-3 progress line (under TR)
  const stage3Status = isStage3
    ? `${labels.setup} ${Math.min(pairIdx + 1, stage3Setups.length)}/${stage3Setups.length}  ·  ${labels.cleared} ${cleared.filter(Boolean).length}/${stage3Setups.length}`
    : ''

  // Colors
  const F1_COLOR = '#8AB4F8'
  const F2_COLOR = '#B48CE8'
  const F3_COLOR = '#F97316'
  const OK_COLOR = '#37C9B8'
  const GAP_COLOR = '#E85D75'
  const AXIS_COLOR = '#2A3654'

  // ─── Render ─────────────────────────────────────────────────────────
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
        onPointerMove={(e) => {
          if (dragging) {
            const p = svgPoint(e)
            if (p) applyDrag(p)
          }
        }}
        onPointerUp={() => setDragging(false)}
        onPointerLeave={() => setDragging(false)}
      >
        {/* Full-canvas background — NO rx */}
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        {/* Panel frames */}
        <rect
          x={PHYS_BOX.x}
          y={PHYS_BOX.y}
          width={PHYS_BOX.w}
          height={PHYS_BOX.h}
          fill="none"
          stroke="#12203a"
          strokeWidth={1}
          rx={6}
        />
        <text
          x={PHYS_BOX.x + 8}
          y={PHYS_BOX.y - 8}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={11}
          letterSpacing="0.1em"
        >
          {labels.ring}
        </text>

        {showDyn && (
          <>
            <rect
              x={DYN_BOX.x}
              y={DYN_BOX.y}
              width={DYN_BOX.w}
              height={DYN_BOX.h}
              fill="none"
              stroke="#12203a"
              strokeWidth={1}
              rx={6}
            />
            <text
              x={DYN_BOX.x + 8}
              y={DYN_BOX.y - 8}
              fill="#6C7A93"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={11}
              letterSpacing="0.1em"
            >
              {labels.dynamique}
            </text>
          </>
        )}

        {/* ── Physical panel axes through ring ── */}
        <line
          x1={PHYS_BOX.x + 8}
          y1={RING.y}
          x2={PHYS_BOX.x + PHYS_BOX.w - 8}
          y2={RING.y}
          stroke={AXIS_COLOR}
          strokeWidth={0.7}
          strokeDasharray="2 4"
        />
        <line
          x1={RING.x}
          y1={PHYS_BOX.y + 8}
          x2={RING.x}
          y2={PHYS_BOX.y + PHYS_BOX.h - 8}
          stroke={AXIS_COLOR}
          strokeWidth={0.7}
          strokeDasharray="2 4"
        />

        {/* ── F1 arrow (physical) ── */}
        <Arrow from={RING} to={T1} color={F1_COLOR} />
        <text
          x={T1.x + (T1.x >= RING.x ? 8 : -8)}
          y={T1.y + (T1.y >= RING.y ? 16 : -8)}
          fill={F1_COLOR}
          fontFamily="'JetBrains Mono', monospace"
          fontSize={11}
          textAnchor={T1.x >= RING.x ? 'start' : 'end'}
        >
          F1 = {currentSetup.f1.m.toFixed(1)}N @ {currentSetup.f1.a.toFixed(0)}°
        </text>

        {/* ── F2 arrow (physical) ── */}
        <Arrow from={RING} to={T2} color={F2_COLOR} />
        <text
          x={T2.x + (T2.x >= RING.x ? 8 : -8)}
          y={T2.y + (T2.y >= RING.y ? 16 : -8)}
          fill={F2_COLOR}
          fontFamily="'JetBrains Mono', monospace"
          fontSize={11}
          textAnchor={T2.x >= RING.x ? 'start' : 'end'}
        >
          F2 = {currentSetup.f2.m.toFixed(1)}N @ {currentSetup.f2.a.toFixed(0)}°
        </text>

        {/* ── F3 arrow (physical) — draggable ── */}
        {(f3.x !== 0 || f3.y !== 0) && (
          <Arrow
            from={RING}
            to={T3}
            color={isClosed ? OK_COLOR : F3_COLOR}
            width={2.8}
          />
        )}

        {/* Ring itself (drawn after F1/F2, before drag handle) */}
        <circle
          cx={RING.x}
          cy={RING.y}
          r={9}
          fill="#0D1524"
          stroke="#EAF0FA"
          strokeWidth={2}
        />
        <text
          x={RING.x - 12}
          y={RING.y - 12}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={10}
        >
          O
        </text>

        {/* F3 drag handle */}
        <g
          onPointerDown={(e) => {
            e.preventDefault()
            setDragging(true)
            const p = svgPoint(e)
            if (p) applyDrag(p)
          }}
          style={{ cursor: 'grab' }}
        >
          {/* Wide invisible hit ring around F3 tip (or around ring if F3 = 0) */}
          <circle
            cx={T3.x}
            cy={T3.y}
            r={22}
            fill="rgba(249,115,22,0)"
          />
          <circle
            cx={T3.x}
            cy={T3.y}
            r={8}
            fill={isClosed ? OK_COLOR : F3_COLOR}
            stroke="#0D1524"
            strokeWidth={2}
          />
        </g>
        <text
          x={T3.x + (T3.x >= RING.x ? 10 : -10)}
          y={T3.y + (T3.y >= RING.y ? 18 : -10)}
          fill={isClosed ? OK_COLOR : '#F9A968'}
          fontFamily="'JetBrains Mono', monospace"
          fontSize={11}
          textAnchor={T3.x >= RING.x ? 'start' : 'end'}
        >
          F3 = {f3Force.m.toFixed(2)}N @ {f3Force.a.toFixed(0)}°
        </text>

        {/* ── Dynamique panel ── */}
        {showDyn && (
          <>
            {/* Origin marker */}
            <circle
              cx={DYN.x}
              cy={DYN.y}
              r={4}
              fill="#EAF0FA"
            />
            <text
              x={DYN.x - 10}
              y={DYN.y - 8}
              fill="#6C7A93"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
            >
              O'
            </text>
            {/* Closed-triangle green fill */}
            {isClosed && (
              <polygon
                points={`${A.x},${A.y} ${B.x},${B.y} ${C.x},${C.y}`}
                fill={OK_COLOR}
                opacity={0.12}
              />
            )}
            {/* F1 → F2 → F3 chain */}
            <Arrow from={A} to={B} color={F1_COLOR} width={2.2} />
            <Arrow from={B} to={C} color={F2_COLOR} width={2.2} />
            {(f3.x !== 0 || f3.y !== 0) && (
              <Arrow
                from={C}
                to={D}
                color={isClosed ? OK_COLOR : F3_COLOR}
                width={2.6}
              />
            )}
            {/* Closure gap: from F3 tip back to origin */}
            {!isClosed && (f3.x !== 0 || f3.y !== 0) && (
              <Arrow
                from={D}
                to={A}
                color={GAP_COLOR}
                width={1.6}
                dashed
                headLen={7}
                headW={6}
              />
            )}
          </>
        )}

        {/* Peek badge (stage 3) */}
        {isStage3 && peekVisible && (
          <g>
            <rect
              x={W / 2 - 220}
              y={16}
              width={440}
              height={44}
              rx={22}
              fill="rgba(13,21,36,.92)"
              stroke="#F97316"
              strokeWidth={1.5}
            />
            <text
              x={W / 2}
              y={34}
              fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={11}
              fontWeight={700}
              letterSpacing="0.1em"
              textAnchor="middle"
            >
              {labels.peek_lead}
            </text>
            <text
              x={W / 2}
              y={51}
              fill="#EAF0FA"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={11}
              letterSpacing="0.08em"
              textAnchor="middle"
            >
              current: F3 = {f3Force.m.toFixed(2)} N @ {f3Force.a.toFixed(1)}°
            </text>
          </g>
        )}

        {/* Stage-3 post-reveal banner (top of dynamique panel — BR reserved for chrome) */}
        {isStage3 && postReveal && (
          <g>
            <rect
              x={DYN_BOX.x + 8}
              y={DYN_BOX.y + 8}
              width={DYN_BOX.w - 16}
              height={22}
              rx={4}
              fill="rgba(13,21,36,.85)"
            />
            <text
              x={DYN_BOX.x + DYN_BOX.w / 2}
              y={DYN_BOX.y + 23}
              fill={isClosed ? OK_COLOR : GAP_COLOR}
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
              letterSpacing="0.1em"
              textAnchor="middle"
            >
              {labels.post_reveal}
            </text>
          </g>
        )}
      </svg>

      {/* ── HUD (HTML overlays in rem) ── */}
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
          color: isClosed ? '#37C9B8' : '#B9C4D6',
          zIndex: 5,
          pointerEvents: 'none',
          textAlign: 'right',
        }}
      >
        {hudTR}
      </div>
      {stage2Status && (
        <div
          style={{
            position: 'absolute',
            top: '7rem',
            right: '3rem',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '1.8rem',
            letterSpacing: '0.08em',
            color: stage2Done ? '#37C9B8' : '#6C7A93',
            zIndex: 5,
            pointerEvents: 'none',
            textAlign: 'right',
          }}
        >
          {stage2Status}
        </div>
      )}
      {stage3Status && (
        <div
          style={{
            position: 'absolute',
            top: '7rem',
            right: '3rem',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '1.8rem',
            letterSpacing: '0.08em',
            color: stage3Done ? '#37C9B8' : '#6C7A93',
            zIndex: 5,
            pointerEvents: 'none',
            textAlign: 'right',
          }}
        >
          {stage3Status}
        </div>
      )}
      <div
        style={{
          position: 'absolute',
          bottom: '3rem',
          left: '3rem',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '2.2rem',
          letterSpacing: '0.06em',
          color: '#6C7A93',
          zIndex: 5,
          pointerEvents: 'none',
          maxWidth: '55%',
        }}
      >
        {hudBL}
      </div>
      {/* BR corner is RESERVED — do not render anything here */}

      {/* Confirm button (stages 2 & 3) */}
      {showConfirm && (
        <button
          type="button"
          onClick={confirm}
          disabled={!canConfirm}
          style={{
            position: 'absolute',
            bottom: '3rem',
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '1.8rem 3.6rem',
            background: canConfirm ? '#F97316' : 'rgba(30,42,64,0.85)',
            color: canConfirm ? '#FFFFFF' : '#6C7A93',
            border: `0.3rem solid ${canConfirm ? '#F97316' : 'rgba(58,72,99,0.6)'}`,
            borderRadius: '100rem',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '2.4rem',
            fontWeight: 700,
            letterSpacing: '0.12em',
            cursor: canConfirm ? 'pointer' : 'not-allowed',
            zIndex: 10,
          }}
        >
          <i
            className="bi bi-crosshair"
            style={{
              marginInlineEnd: '0.8rem',
              fontSize: '2.6rem',
              verticalAlign: '-0.2rem',
            }}
          />
          {labels.confirm}
        </button>
      )}
    </div>
  )
}
