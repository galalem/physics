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
// 16:9 SVG viewBox. Cartesian labels shown to the student flip Y so origin
// is bottom-left of the canvas.
const W = 800
const H = 450

// Source rail: S slides vertically at fixed x = 120. One DOF (Sy).
const SX = 120
const SY_INIT = 225
const SY_MIN = 40
const SY_MAX = 410

// Opaque vertical bar: rectangle centered on x = 400, half-width 6.
// The optical interface is the line x = OX; blocking interval is [OY1, OY2].
const OX = 400
const OY1 = 175
const OY2 = 275
const BAR_HALF_W = 6

// Fan of rays visualised in stages 1 & 2. Angles measured from +x axis,
// SVG y-down (so positive angle points down on screen).
const RAY_COUNT = 17
const RAY_HALF_SPAN = (75 * Math.PI) / 180

// Highlighted S→T fire-line animation (stage 2 only).
const BEAM_DRAW_MS = 220
const BEAM_HOLD_MS = 260
const BEAM_FADE_MS = 400
const BEAM_TOTAL_MS = BEAM_DRAW_MS + BEAM_HOLD_MS + BEAM_FADE_MS

// ─── Target sets ────────────────────────────────────────────────────────
type Target = { id: string; x: number; y: number }
type Setup = { targets: Target[] }

// Stage-2 targets (fixed). Verified by hand: each is reachable, but no single
// Sy lights all three — student must iterate.
//   a (700, 110): top-right. Ray from S must pass above bar top (y_hit<175).
//     y_hit = Sy + 280/580·(110-Sy). y_hit<175 ⇔ Sy < ~250.
//   b (720, 340): bottom-right. y_hit = Sy + 280/600·(340-Sy). y_hit>275
//     ⇔ Sy > ~217.
//   c (550, 60): high, close to bar. y_hit = Sy + 280/430·(60-Sy).
//     y_hit<175 ⇔ Sy < ~387. Reachable at almost any Sy above ~50.
const STAGE2_TARGETS: Target[] = [
  { id: 'a', x: 700, y: 110 },
  { id: 'b', x: 720, y: 340 },
  { id: 'c', x: 550, y: 60 },
]
const STAGE2_SHOT_BUDGET = 5

// Stage-3 setups — seed-picked. Each has exactly three targets. Each target
// is reachable (a valid Sy in [SY_MIN, SY_MAX] exists) and the three
// solutions overlap partially so the student must actually solve, not eyeball.
const STAGE3_SETUPS: Setup[] = [
  {
    targets: [
      { id: 's0a', x: 680, y: 90 },
      { id: 's0b', x: 700, y: 360 },
      { id: 's0c', x: 560, y: 210 },
    ],
  },
  {
    targets: [
      { id: 's1a', x: 720, y: 130 },
      { id: 's1b', x: 640, y: 380 },
      { id: 's1c', x: 500, y: 230 },
    ],
  },
  {
    targets: [
      { id: 's2a', x: 620, y: 70 },
      { id: 's2b', x: 700, y: 320 },
      { id: 's2c', x: 540, y: 200 },
    ],
  },
  {
    targets: [
      { id: 's3a', x: 700, y: 150 },
      { id: 's3b', x: 660, y: 350 },
      { id: 's3c', x: 520, y: 240 },
    ],
  },
  {
    targets: [
      { id: 's4a', x: 660, y: 100 },
      { id: 's4b', x: 720, y: 340 },
      { id: 's4c', x: 580, y: 220 },
    ],
  },
]
// Stage-3 shot budget = activeTargets.length (K=3). One shot per target,
// hit-or-miss (§5.2). Enforced via `targetIdx < activeTargets.length` gate.

const dict = { en } as const
type Locale = keyof typeof dict

function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── Physics ────────────────────────────────────────────────────────────
function cartY(y: number): number {
  return H - y
}

// Y where the segment from A to B crosses the vertical plane x = X.
// Returns null if the segment doesn't cross (A and B on the same side).
function crossingY(
  A: { x: number; y: number },
  B: { x: number; y: number },
  X: number,
): number | null {
  const dx = B.x - A.x
  if (dx === 0) return null
  const t = (X - A.x) / dx
  if (t < 0 || t > 1) return null
  return A.y + t * (B.y - A.y)
}

// A target T is illuminated iff segment S→T does not intersect the bar
// (vertical segment at x = OX, y ∈ [OY1, OY2]).
function lineOfSight(
  S: { x: number; y: number },
  T: { x: number; y: number },
): boolean {
  const y = crossingY(S, T, OX)
  if (y === null) return true
  return y < OY1 || y > OY2
}

// Distance along a ray of unit direction `d` from origin S to the first
// intersection with the bar segment. Returns Infinity if the ray does not
// hit the bar.
function rayToBar(S: { x: number; y: number }, d: { x: number; y: number }): number {
  if (d.x === 0) return Infinity
  const t = (OX - S.x) / d.x
  if (t <= 0) return Infinity
  const y = S.y + t * d.y
  if (y < OY1 || y > OY2) return Infinity
  return t
}

// Distance along a ray of unit direction `d` from origin S to the canvas
// bounding box, so we can clip rays at the frame.
function rayToFrame(S: { x: number; y: number }, d: { x: number; y: number }): number {
  const cands: number[] = []
  if (d.x > 0) cands.push((W - S.x) / d.x)
  if (d.x < 0) cands.push(-S.x / d.x)
  if (d.y > 0) cands.push((H - S.y) / d.y)
  if (d.y < 0) cands.push(-S.y / d.y)
  return cands.length ? Math.min(...cands.filter((t) => t > 0)) : W
}

// ─── Component ──────────────────────────────────────────────────────────
export default function Scene() {
  const { locale, seed } = useInit()
  const stages = useMemo(() => getStagesFor(locale), [locale])
  useDeclareStages(stages)
  const labels = useMemo(() => svgLabels(locale), [locale])

  // Cycle stage-3 setups within one mount so a fail-restart advances to a
  // fresh geometry instead of repeating the same failed one.
  const [setupIdx, setSetupIdx] = useState(0)
  const stage3Setup = useMemo(
    () => STAGE3_SETUPS[(seed + setupIdx) % STAGE3_SETUPS.length]!,
    [seed, setupIdx],
  )

  const stageIdx = useCurrentStage()
  const setStage = useSetStage()

  const [sy, setSy] = useState(SY_INIT)
  const [dragging, setDragging] = useState(false)
  const [moved, setMoved] = useState(false)
  const [lit, setLit] = useState<string[]>([])
  const [shots, setShots] = useState(0)
  const [targetIdx, setTargetIdx] = useState(0)
  const [beamAnim, setBeamAnim] = useState<
    { S: { x: number; y: number }; T: Target; blocked: boolean; at: number } | null
  >(null)
  const [tick, setTick] = useState(0)
  const [peekVisible, setPeekVisible] = useState(false)

  const svgRef = useRef<SVGSVGElement>(null)
  const rafRef = useRef<number>(0)

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  const activeTargets: Target[] = isStage2
    ? STAGE2_TARGETS
    : isStage3
      ? stage3Setup.targets
      : []

  const S = { x: SX, y: sy }

  const complete = useComplete()
  const progress = useProgress()

  // ─── Reset ─────────────────────────────────────────────────────────
  const resetStageState = useCallback(() => {
    setSy(SY_INIT)
    setMoved(false)
    setLit([])
    setShots(0)
    setTargetIdx(0)
    setBeamAnim(null)
    setPeekVisible(false)
  }, [])
  useReset(resetStageState)

  // ─── Fire ──────────────────────────────────────────────────────────
  const canFireStage2 = isStage2 && shots < STAGE2_SHOT_BUDGET && lit.length < activeTargets.length
  const canFireStage3 = isStage3 && targetIdx < activeTargets.length
  const canFire = canFireStage2 || canFireStage3

  const fire = useCallback(() => {
    if (isStage2 && canFireStage2) {
      // Fire commits current S. Light every unlit target with clear
      // line-of-sight to S.
      const newlyLit = activeTargets
        .filter((t) => !lit.includes(t.id) && lineOfSight(S, t))
        .map((t) => t.id)
      setShots((s) => s + 1)
      if (newlyLit.length) setLit((prev) => [...prev, ...newlyLit])
      // Highlight-line animation: pick the currently-focused target (first
      // unlit) so the student sees which ray was drawn.
      const focusT = activeTargets.find((t) => !lit.includes(t.id))
      if (focusT) {
        setBeamAnim({ S, T: focusT, blocked: !lineOfSight(S, focusT), at: Date.now() })
        setTick(Date.now())
      }
      return
    }
    if (isStage3 && canFireStage3) {
      // One shot per target: always advance targetIdx, hit or miss.
      const t = activeTargets[targetIdx]
      if (t && lineOfSight(S, t)) {
        setLit((prev) => [...prev, t.id])
      }
      setTargetIdx((i) => i + 1)
      // No beam animation on the blind stage.
      return
    }
  }, [isStage2, isStage3, canFireStage2, canFireStage3, activeTargets, lit, targetIdx, S])

  // ─── Blind-stage fail-restart (§5.2) ───────────────────────────────
  useEffect(() => {
    if (!isStage3) return
    const allShotsFired = targetIdx >= activeTargets.length
    const allLit = lit.length === activeTargets.length
    if (allShotsFired && !allLit) {
      // Missed at least one — advance to next setup and reset stage state.
      setSetupIdx((i) => i + 1)
      setSy(SY_INIT)
      setMoved(false)
      setLit([])
      setShots(0)
      setTargetIdx(0)
      setBeamAnim(null)
      setPeekVisible(false)
    }
  }, [isStage3, targetIdx, lit.length, activeTargets.length])

  // ─── Stage-2 exhaustion auto-reset (silent) ────────────────────────
  useEffect(() => {
    if (!isStage2) return
    if (shots >= STAGE2_SHOT_BUDGET && lit.length < STAGE2_TARGETS.length) {
      const t = setTimeout(() => resetStageState(), 900)
      return () => clearTimeout(t)
    }
  }, [isStage2, shots, lit.length, resetStageState])

  // ─── Beam animation (rAF, stage 2 only) ────────────────────────────
  useEffect(() => {
    if (!beamAnim) return
    const step = () => {
      const now = Date.now()
      if (now - beamAnim.at >= BEAM_TOTAL_MS) {
        setBeamAnim(null)
        return
      }
      setTick(now)
      rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(rafRef.current)
  }, [beamAnim])

  // ─── Advance predicate ─────────────────────────────────────────────
  const canSubmit = isStage1
    ? moved
    : isStage2
      ? lit.length === activeTargets.length
      : targetIdx >= activeTargets.length && lit.length === activeTargets.length

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

  // ─── Peek (strategy hint + current Sy) ─────────────────────────────
  usePeek(() => {
    if (!isStage3) return
    setPeekVisible(true)
  })
  useEffect(() => {
    if (!peekVisible) return
    const t = setTimeout(() => setPeekVisible(false), 2200)
    return () => clearTimeout(t)
  }, [peekVisible])

  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  // ─── Spacebar fires (stages 2 & 3) ─────────────────────────────────
  useEffect(() => {
    if (isStage1) return
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault()
        fire()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isStage1, fire])

  // ─── Pointer / drag ────────────────────────────────────────────────
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
    const clamped = Math.max(SY_MIN, Math.min(SY_MAX, p.y))
    setSy(clamped)
    if (isStage1 && !moved) setMoved(true)
  }
  const sourceDown = (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragging(true)
    const p = svgPoint(e)
    if (p) applyDrag(p)
  }
  const svgMove = (e: React.PointerEvent) => {
    if (!dragging) return
    const p = svgPoint(e)
    if (p) applyDrag(p)
  }

  // ─── Ray fan geometry (stages 1 & 2) ───────────────────────────────
  const rays = useMemo(() => {
    if (isStage3) return []
    const out: { x1: number; y1: number; x2: number; y2: number; blocked: boolean }[] = []
    for (let i = 0; i < RAY_COUNT; i++) {
      const frac = (i / (RAY_COUNT - 1)) * 2 - 1 // -1 .. 1
      const angle = frac * RAY_HALF_SPAN
      const d = { x: Math.cos(angle), y: Math.sin(angle) }
      const tBar = rayToBar(S, d)
      const tFrame = rayToFrame(S, d)
      const t = Math.min(tBar, tFrame)
      out.push({
        x1: S.x,
        y1: S.y,
        x2: S.x + d.x * t,
        y2: S.y + d.y * t,
        blocked: tBar < tFrame,
      })
    }
    return out
  }, [isStage3, S.x, S.y])

  // ─── Shadow polygon (stages 1 & 2 only) ────────────────────────────
  // Behind the bar: bounded by two tangent rays from S through the bar
  // endpoints (OX, OY1) and (OX, OY2), extended to the canvas right edge.
  const shadow = useMemo(() => {
    if (isStage3) return null
    const dTop = { x: OX - S.x, y: OY1 - S.y }
    const dBot = { x: OX - S.x, y: OY2 - S.y }
    const tTop = rayToFrame({ x: OX, y: OY1 }, { x: dTop.x, y: dTop.y })
    const tBot = rayToFrame({ x: OX, y: OY2 }, { x: dBot.x, y: dBot.y })
    const topEnd = { x: OX + dTop.x * tTop, y: OY1 + dTop.y * tTop }
    const botEnd = { x: OX + dBot.x * tBot, y: OY2 + dBot.y * tBot }
    return {
      d: `M ${OX} ${OY1} L ${topEnd.x} ${topEnd.y} L ${botEnd.x} ${botEnd.y} L ${OX} ${OY2} Z`,
    }
  }, [isStage3, S.x, S.y])

  // ─── Beam-animation interpolation (stage 2) ────────────────────────
  let beamOp = 0
  let beamDrawFrac = 0
  let beamMid = { x: 0, y: 0 }
  if (beamAnim) {
    const elapsed = Math.max(0, tick - beamAnim.at)
    if (elapsed < BEAM_DRAW_MS) {
      beamDrawFrac = elapsed / BEAM_DRAW_MS
      beamOp = 1
    } else if (elapsed < BEAM_DRAW_MS + BEAM_HOLD_MS) {
      beamDrawFrac = 1
      beamOp = 1
    } else {
      beamDrawFrac = 1
      beamOp = 1 - (elapsed - BEAM_DRAW_MS - BEAM_HOLD_MS) / BEAM_FADE_MS
    }
    // If blocked, cap the drawn segment at the bar.
    if (beamAnim.blocked) {
      const yCross = crossingY(beamAnim.S, beamAnim.T, OX)
      const frac = (OX - beamAnim.S.x) / (beamAnim.T.x - beamAnim.S.x)
      beamMid = {
        x: beamAnim.S.x + (OX - beamAnim.S.x) * beamDrawFrac,
        y: beamAnim.S.y + ((yCross ?? beamAnim.S.y) - beamAnim.S.y) * beamDrawFrac,
      }
      void frac // (kept in case rendering wants raw frac)
    } else {
      beamMid = {
        x: beamAnim.S.x + (beamAnim.T.x - beamAnim.S.x) * beamDrawFrac,
        y: beamAnim.S.y + (beamAnim.T.y - beamAnim.S.y) * beamDrawFrac,
      }
    }
  }
  const showBeamAnim = !!beamAnim && beamOp > 0 && !isStage3

  // ─── Grid & axis labels (stage 3) ──────────────────────────────────
  const gridLines: React.ReactNode[] = []
  const axisLabels: React.ReactNode[] = []
  if (isStage3) {
    for (let gx = 0; gx <= W; gx += 50) {
      gridLines.push(
        <line
          key={`gx${gx}`}
          x1={gx}
          y1={0}
          x2={gx}
          y2={H}
          stroke="#12203a"
          strokeWidth={gx % 100 === 0 ? 1 : 0.5}
          opacity={gx % 100 === 0 ? 1 : 0.6}
        />,
      )
    }
    for (let gy = 0; gy <= H; gy += 50) {
      gridLines.push(
        <line
          key={`gy${gy}`}
          x1={0}
          y1={gy}
          x2={W}
          y2={gy}
          stroke="#12203a"
          strokeWidth={gy % 100 === 0 ? 1 : 0.5}
          opacity={gy % 100 === 0 ? 1 : 0.6}
        />,
      )
    }
    for (let x = 100; x <= 700; x += 100) {
      axisLabels.push(
        <text
          key={`ax${x}`}
          x={x}
          y={H - 6}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={9}
          textAnchor="middle"
        >
          {x}
        </text>,
      )
    }
    for (let y = 100; y <= 400; y += 100) {
      axisLabels.push(
        <text
          key={`ay${y}`}
          x={6}
          y={y + 3}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={9}
        >
          {cartY(y)}
        </text>,
      )
    }
  } else {
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
  }

  // ─── HUD ────────────────────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`
  // TR: live DOF readout (required-information — stays on all stages).
  const hudTR = `Sy = ${cartY(sy).toFixed(0)}`
  // Secondary TL line: progress info (stage 2 & 3), replaces the ref's
  // forbidden BR block.
  const hudTL2 = isStage2
    ? `${labels.shots} ${shots}/${STAGE2_SHOT_BUDGET} · ${labels.lit} ${lit.length}/${activeTargets.length}`
    : isStage3
      ? `${labels.target} ${Math.min(targetIdx + 1, activeTargets.length)}/${activeTargets.length} · ${labels.lit} ${lit.length}/${activeTargets.length}`
      : null
  const hudBL = isStage1 ? labels.tip1 : isStage2 ? labels.tip2 : labels.tip3
  const showExhaustedWarn =
    isStage2 && shots >= STAGE2_SHOT_BUDGET && lit.length < activeTargets.length

  const showFireButton = !isStage1

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
        {/* No borderRadius on <svg>, no rx on the bg rect. */}
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />
        {gridLines}
        {axisLabels}

        {/* Source rail (dashed vertical guide, stages 1 & 2 mostly; ok to
            show in stage 3 too — it's passive geometry). */}
        <line
          x1={SX}
          y1={SY_MIN - 10}
          x2={SX}
          y2={SY_MAX + 10}
          stroke="#3A4863"
          strokeWidth={1}
          strokeDasharray="4 6"
        />

        {/* Shadow polygon (stages 1 & 2 only — HELP, removed on stage 3) */}
        {shadow && !isStage3 && (
          <path d={shadow.d} fill="#0D1524" opacity={0.55} />
        )}
        {shadow && !isStage3 && (
          <path d={shadow.d} fill="#000" opacity={0.35} />
        )}

        {/* Ray fan (stages 1 & 2 only — HELP, removed on stage 3) */}
        {!isStage3 &&
          rays.map((r, i) => (
            <g key={`ray${i}`}>
              <line
                x1={r.x1}
                y1={r.y1}
                x2={r.x2}
                y2={r.y2}
                stroke="rgba(249,115,22,.18)"
                strokeWidth={6}
                strokeLinecap="round"
              />
              <line
                x1={r.x1}
                y1={r.y1}
                x2={r.x2}
                y2={r.y2}
                stroke={r.blocked ? 'rgba(249,115,22,.55)' : '#F97316'}
                strokeWidth={1.4}
                strokeLinecap="round"
              />
            </g>
          ))}

        {/* Highlighted S→T fire animation (stage 2 only) */}
        {showBeamAnim && beamAnim && (
          <g opacity={beamOp}>
            <line
              x1={beamAnim.S.x}
              y1={beamAnim.S.y}
              x2={beamMid.x}
              y2={beamMid.y}
              stroke={beamAnim.blocked ? '#B84326' : '#F9A968'}
              strokeWidth={10}
              strokeLinecap="round"
              opacity={0.32}
            />
            <line
              x1={beamAnim.S.x}
              y1={beamAnim.S.y}
              x2={beamMid.x}
              y2={beamMid.y}
              stroke={beamAnim.blocked ? '#F97316' : '#EAF0FA'}
              strokeWidth={2.4}
              strokeLinecap="round"
            />
          </g>
        )}

        {/* Bar (opaque obstacle) */}
        <rect
          x={OX - BAR_HALF_W}
          y={OY1}
          width={BAR_HALF_W * 2}
          height={OY2 - OY1}
          fill="#EAF0FA"
          stroke="#37C9B8"
          strokeWidth={1.5}
        />
        {/* Bar endpoint dots — pedagogical anchors for the shadow edges */}
        <circle cx={OX} cy={OY1} r={3.2} fill="#37C9B8" />
        <circle cx={OX} cy={OY2} r={3.2} fill="#37C9B8" />

        {/* Stage-2 targets */}
        {isStage2 &&
          activeTargets.map((t) => {
            const on = lit.includes(t.id)
            return (
              <g key={t.id}>
                {on && <circle cx={t.x} cy={t.y} r={20} fill="#37C9B8" opacity={0.22} />}
                <circle
                  cx={t.x}
                  cy={t.y}
                  r={9}
                  fill={on ? '#37C9B8' : 'none'}
                  stroke={on ? '#37C9B8' : '#6C7A93'}
                  strokeWidth={2}
                />
              </g>
            )
          })}

        {/* Stage-3 targets */}
        {isStage3 && (
          <>
            {activeTargets
              .filter((t) => lit.includes(t.id))
              .map((t) => (
                <g key={t.id}>
                  <circle cx={t.x} cy={t.y} r={20} fill="#37C9B8" opacity={0.22} />
                  <circle
                    cx={t.x}
                    cy={t.y}
                    r={9}
                    fill="#37C9B8"
                    stroke="#37C9B8"
                    strokeWidth={2}
                  />
                </g>
              ))}
            {activeTargets[targetIdx] && (
              <g key={activeTargets[targetIdx].id}>
                <circle
                  cx={activeTargets[targetIdx].x}
                  cy={activeTargets[targetIdx].y}
                  r={22}
                  fill="none"
                  stroke="#F97316"
                  strokeWidth={1.5}
                  opacity={0.5}
                >
                  <animate attributeName="r" values="18;26;18" dur="1.6s" repeatCount="indefinite" />
                  <animate
                    attributeName="opacity"
                    values="0.7;0.15;0.7"
                    dur="1.6s"
                    repeatCount="indefinite"
                  />
                </circle>
                <circle
                  cx={activeTargets[targetIdx].x}
                  cy={activeTargets[targetIdx].y}
                  r={9}
                  fill="none"
                  stroke="#F97316"
                  strokeWidth={2.4}
                />
                <text
                  x={activeTargets[targetIdx].x + 14}
                  y={activeTargets[targetIdx].y - 12}
                  fill="#F9A968"
                  fontFamily="'JetBrains Mono', monospace"
                  fontSize={11}
                >
                  T ({activeTargets[targetIdx].x}, {cartY(activeTargets[targetIdx].y)})
                </text>
              </g>
            )}

            {/* Bar coordinate labels (required-information on blind stage) */}
            <text
              x={OX + 12}
              y={OY1 - 6}
              fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={11}
            >
              ({OX}, {cartY(OY1)})
            </text>
            <text
              x={OX + 12}
              y={OY2 + 14}
              fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={11}
            >
              ({OX}, {cartY(OY2)})
            </text>
          </>
        )}

        {/* Source (draggable) — orange disk with glow */}
        <g onPointerDown={sourceDown} style={{ cursor: 'grab' }}>
          <circle cx={S.x} cy={S.y} r={18} fill="#F97316" opacity={0.28} />
          <circle cx={S.x} cy={S.y} r={9} fill="#F97316" />
          <circle cx={S.x} cy={S.y} r={3.2} fill="#EAF0FA" />
        </g>
        {isStage3 && (
          <text
            x={S.x + 14}
            y={S.y - 12}
            fill="#F9A968"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={11}
          >
            S ({S.x}, {cartY(S.y).toFixed(0)})
          </text>
        )}

        {/* Peek badge (stage 3, top-center) — strategy hint + current Sy */}
        {isStage3 && peekVisible && (
          <g>
            <rect
              x={W / 2 - 210}
              y={10}
              width={420}
              height={60}
              rx={12}
              fill="rgba(13,21,36,.9)"
              stroke="#F97316"
              strokeWidth={1.5}
            />
            <text
              x={W / 2}
              y={32}
              fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={11}
              letterSpacing="0.05em"
              textAnchor="middle"
            >
              y_hit at x=400 = Sy + (400−Sx)/(Tx−Sx)·(Ty−Sy)
            </text>
            <text
              x={W / 2}
              y={54}
              fill="#EAF0FA"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={13}
              fontWeight={700}
              letterSpacing="0.1em"
              textAnchor="middle"
            >
              current Sy = {cartY(sy).toFixed(1)}
            </text>
          </g>
        )}
      </svg>

      {/* HUD overlays — HTML in rem, NOT SVG text. */}
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
      {hudTL2 && (
        <div
          style={{
            position: 'absolute',
            top: '7rem',
            left: '3rem',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '2rem',
            letterSpacing: '0.08em',
            color: '#37C9B8',
            zIndex: 5,
            pointerEvents: 'none',
          }}
        >
          {hudTL2}
          {showExhaustedWarn && (
            <div style={{ color: '#F9A968', marginTop: '0.4rem' }}>{labels.exhausted}</div>
          )}
        </div>
      )}
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
        }}
      >
        {hudBL}
      </div>
      {/* NO bottom-right overlay — reserved for parent chrome. */}

      {/* Fire button — HTML overlay pill */}
      {showFireButton && (
        <button
          type="button"
          onClick={fire}
          disabled={!canFire}
          style={{
            position: 'absolute',
            bottom: '3rem',
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '2rem 4rem',
            background: canFire ? '#F97316' : 'rgba(30,42,64,0.85)',
            color: canFire ? '#FFFFFF' : '#6C7A93',
            border: `0.3rem solid ${canFire ? '#F97316' : 'rgba(58,72,99,0.6)'}`,
            borderRadius: '100rem',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '2.6rem',
            fontWeight: 700,
            letterSpacing: '0.12em',
            cursor: canFire ? 'pointer' : 'not-allowed',
            zIndex: 10,
            transition: 'background 0.15s, transform 0.1s',
          }}
        >
          <i
            className="bi bi-lightning-charge-fill"
            style={{
              marginInlineEnd: '0.8rem',
              fontSize: '2.8rem',
              verticalAlign: '-0.2rem',
            }}
          />
          {labels.fire}
        </button>
      )}
    </div>
  )
}
