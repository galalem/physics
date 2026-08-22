import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  useSetStage,
  useCurrentStage,
  useComplete,
  useDeclareStages,
  useHint,
  useInit,
  useNext,
  usePeek,
  useProgress,
  useReset,
} from '@physics/sdk/react'
import { getHintFor, getStagesFor } from './stages'
import en from '../i18n/en.json'
import fr from '../i18n/fr.json'
import ar from '../i18n/ar.json'

// ─── Scene constants ────────────────────────────────────────────────────
// SVG viewBox is 16:9 (matches the design's canvas card).
// Cartesian coordinates shown to the student flip Y so origin is bottom-left.
const W = 800
const H = 450
const S = { x: 100, y: 100 } // Source        — Cartesian (100, 350)
const M = { x: 400, y: 250 } // Mirror pivot  — Cartesian (400, 200)
const L = 80 // mirror half-length
const DEFAULT_PHI = 0.62 // ~35.5° — matches design reference

// Beam animation phases (ms). Fire ⇒ incident draw ⇒ reflected draw ⇒ fade.
const BEAM_INCIDENT_MS = 100
const BEAM_REFLECTED_MS = 300
const BEAM_FADE_MS = 600
const BEAM_TOTAL_MS = BEAM_INCIDENT_MS + BEAM_REFLECTED_MS + BEAM_FADE_MS

type Star = { id: string; x: number; y: number }
type StageKind = 'observe' | 'experiment' | 'evaluate'

const STAGE_DEFS: Record<number, { kind: StageKind; stars: Star[]; maxShots?: number }> = {
  1: { kind: 'observe', stars: [] },
  2: {
    kind: 'experiment',
    stars: [
      { id: 'a', x: 680, y: 110 },
      { id: 'b', x: 720, y: 340 },
      { id: 'c', x: 500, y: 60 },
    ],
    maxShots: 7,
  },
  3: { kind: 'evaluate', stars: [] },
}

// Stage 3 setups — deterministically picked by `seed % setups.length` on
// mount. Reset within stage 3 keeps the same setup; a fresh mount rerolls.
// Each setup: 2 targets with workable non-degenerate geometry from S/M.
const STAGE3_SETUPS: { targets: Star[] }[] = [
  { targets: [{ id: 's0a', x: 700, y: 100 }, { id: 's0b', x: 600, y: 400 }] },
  { targets: [{ id: 's1a', x: 720, y: 180 }, { id: 's1b', x: 450, y: 420 }] },
  { targets: [{ id: 's2a', x: 680, y: 320 }, { id: 's2b', x: 550, y: 80 }] },
  { targets: [{ id: 's3a', x: 640, y: 150 }, { id: 's3b', x: 500, y: 380 }] },
  { targets: [{ id: 's4a', x: 750, y: 220 }, { id: 's4b', x: 620, y: 90 }] },
]

const dict = { en, fr, ar } as const
type Locale = keyof typeof dict

function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── Math ───────────────────────────────────────────────────────────────
function norm(v: { x: number; y: number }) {
  const l = Math.hypot(v.x, v.y) || 1
  return { x: v.x / l, y: v.y / l }
}
function reflectDir(phi: number) {
  const n = { x: -Math.sin(phi), y: Math.cos(phi) }
  const d0 = norm({ x: M.x - S.x, y: M.y - S.y })
  const dot = d0.x * n.x + d0.y * n.y
  return { r: { x: d0.x - 2 * dot * n.x, y: d0.y - 2 * dot * n.y }, n, d0 }
}
function hitStar(r: { x: number; y: number }, st: { x: number; y: number }) {
  const vx = st.x - M.x
  const vy = st.y - M.y
  const t = vx * r.x + vy * r.y
  if (t < 22) return false
  const px = M.x + r.x * t
  const py = M.y + r.y * t
  return Math.hypot(st.x - px, st.y - py) < 17
}

// Display phi in Cartesian convention (y-up) — negate the SVG (y-down) angle
// so it matches the formula the student applies to the on-scene coordinates.
// Normalised to (−90°, 90°] since a mirror line has 180° period.
function displayDeg(phi: number) {
  let d = (-phi * 180) / Math.PI
  while (d > 90) d -= 180
  while (d <= -90) d += 180
  return d
}

function cartY(y: number) {
  return H - y
}

// ─── Component ──────────────────────────────────────────────────────────
export default function Scene() {
  const { locale, seed } = useInit()
  const stages = useMemo(() => getStagesFor(locale), [locale])
  useDeclareStages(stages)
  const labels = useMemo(() => svgLabels(locale), [locale])
  const stage3Setup = useMemo(
    () => STAGE3_SETUPS[seed % STAGE3_SETUPS.length]!,
    [seed],
  )

  const stageIdx = useCurrentStage()
  const [phi, setPhi] = useState(DEFAULT_PHI)
  const [dragging, setDragging] = useState(false)
  const [moved, setMoved] = useState(false)
  const [lit, setLit] = useState<string[]>([])
  const [shots, setShots] = useState(0)
  const [beamAnim, setBeamAnim] = useState<{ phi: number; at: number } | null>(null)
  const [tick, setTick] = useState(0)
  const [peekPhi, setPeekPhi] = useState<number | null>(null)
  const [targetIdx, setTargetIdx] = useState(0)

  const svgRef = useRef<SVGSVGElement>(null)
  const rafRef = useRef<number>(0)
  const stage = STAGE_DEFS[stageIdx] ?? STAGE_DEFS[1]!
  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3
  const maxShots = stage.maxShots ?? 0
  const activeStars = isStage3 ? stage3Setup.targets : stage.stars

  const complete = useComplete()
  const progress = useProgress()
  const setStage = useSetStage()

  const resetStageState = useCallback(() => {
    setPhi(DEFAULT_PHI)
    setMoved(false)
    setLit([])
    setShots(0)
    setBeamAnim(null)
    setPeekPhi(null)
    setTargetIdx(0)
  }, [])

  const fire = useCallback(() => {
    if (isStage1) return
    if (isStage2 && shots >= maxShots) return
    if (isStage3 && targetIdx >= activeStars.length) return
    const { r } = reflectDir(phi)
    if (isStage2) {
      const newlyLit = activeStars
        .filter((st) => !lit.includes(st.id) && hitStar(r, st))
        .map((st) => st.id)
      setShots((s) => s + 1)
      if (newlyLit.length) setLit((prev) => [...prev, ...newlyLit])
    } else if (isStage3) {
      const active = activeStars[targetIdx]
      if (active && hitStar(r, active)) {
        setLit((prev) => [...prev, active.id])
        setTargetIdx((i) => i + 1)
      }
    }
    const now = Date.now()
    setBeamAnim({ phi, at: now })
    setTick(now)
  }, [isStage1, isStage2, isStage3, phi, shots, maxShots, lit, targetIdx, activeStars])

  const canSubmit = isStage1
    ? moved
    : isStage2
      ? lit.length === activeStars.length
      : targetIdx >= activeStars.length

  const incidenceDeg = useMemo(() => {
    const { n, d0 } = reflectDir(phi)
    const dot = Math.min(1, Math.abs(d0.x * n.x + d0.y * n.y))
    return Math.round((Math.acos(dot) * 180) / Math.PI)
  }, [phi])

  const readout = isStage1
    ? `θᵢ = θᵣ = ${incidenceDeg}°`
    : isStage2
      ? `${labels.shots} ${shots}/${maxShots} · ${labels.lit} ${lit.length}/${activeStars.length}${
          shots >= maxShots && lit.length < activeStars.length ? ` · ${labels.exhausted}` : ''
        }`
      : `${labels.target} ${Math.min(targetIdx + 1, activeStars.length)}/${activeStars.length} · ${labels.lit} ${lit.length}/${activeStars.length}`

  useEffect(() => {
    progress(stageIdx / 3, { stage: stageIdx, canSubmit, readout })
  }, [stageIdx, canSubmit, readout, progress])

  useReset(resetStageState)

  useNext(() => {
    if (stageIdx < 3) {
      setStage(stageIdx + 1)
      resetStageState()
    } else {
      complete({ success: true })
    }
  })

  usePeek(() => {
    if (!isStage3) return
    setPeekPhi(phi)
  })

  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  useEffect(() => {
    if (peekPhi === null) return
    const t = setTimeout(() => setPeekPhi(null), 1500)
    return () => clearTimeout(t)
  }, [peekPhi])

  // Beam animation ticker — runs rAF while a beamAnim is active.
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

  // Spacebar fires on stages 2 & 3.
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

  // ─── Pointer / drag ───────────────────────────────────────────────────
  const svgPoint = (e: React.PointerEvent) => {
    const el = svgRef.current
    if (!el) return null
    const rect = el.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) / rect.width) * W,
      y: ((e.clientY - rect.top) / rect.height) * H,
    }
  }
  const applyMirror = (p: { x: number; y: number }) => {
    setPhi(Math.atan2(p.y - M.y, p.x - M.x))
    if (isStage1 && !moved) setMoved(true)
  }
  const mirrorDown = (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragging(true)
    const p = svgPoint(e)
    if (p) applyMirror(p)
  }
  const svgMove = (e: React.PointerEvent) => {
    if (!dragging) return
    const p = svgPoint(e)
    if (p) applyMirror(p)
  }

  // ─── Geometry for rendering ───────────────────────────────────────────
  const u = { x: Math.cos(phi), y: Math.sin(phi) }
  const { r, n } = reflectDir(phi)
  const m1 = { x: M.x - u.x * L, y: M.y - u.y * L }
  const m2 = { x: M.x + u.x * L, y: M.y + u.y * L }
  const R2 = { x: M.x + r.x * 1500, y: M.y + r.y * 1500 }

  // Beam trail rendering (stages 2 & 3): compute per-frame incident/reflected
  // draw fractions + opacity from the animation phase.
  let iFrac = 0
  let rFrac = 0
  let beamOp = 0
  let trailEnd = { x: 0, y: 0 }
  let trailMid = { x: M.x, y: M.y }
  if (beamAnim) {
    const elapsed = Math.max(0, tick - beamAnim.at)
    if (elapsed < BEAM_INCIDENT_MS) {
      iFrac = elapsed / BEAM_INCIDENT_MS
      beamOp = 1
    } else if (elapsed < BEAM_INCIDENT_MS + BEAM_REFLECTED_MS) {
      iFrac = 1
      rFrac = (elapsed - BEAM_INCIDENT_MS) / BEAM_REFLECTED_MS
      beamOp = 1
    } else {
      iFrac = 1
      rFrac = 1
      beamOp = 1 - (elapsed - BEAM_INCIDENT_MS - BEAM_REFLECTED_MS) / BEAM_FADE_MS
    }
    const trail = reflectDir(beamAnim.phi)
    trailMid = { x: S.x + (M.x - S.x) * iFrac, y: S.y + (M.y - S.y) * iFrac }
    trailEnd = { x: M.x + trail.r.x * 1500 * rFrac, y: M.y + trail.r.y * 1500 * rFrac }
  }

  const showContinuousBeam = isStage1
  const showIncidentGuide = !isStage1 // dim S→M reference on stages 2 & 3
  const showTrail = (isStage2 || isStage3) && !!beamAnim && beamOp > 0
  const showNormal = true
  const showIncidenceArc = !isStage3 // stage 3 hides all angle aids
  const showReflectionArc = isStage1 // only stage 1 reveals θᵣ (the equality)

  const arcPath = (a0: number, a1: number, rad: number) => {
    let d = a1 - a0
    while (d <= -Math.PI) d += 2 * Math.PI
    while (d > Math.PI) d -= 2 * Math.PI
    const large = Math.abs(d) > Math.PI ? 1 : 0
    const sweep = d > 0 ? 1 : 0
    const x0 = M.x + rad * Math.cos(a0)
    const y0 = M.y + rad * Math.sin(a0)
    const x1 = M.x + rad * Math.cos(a1)
    const y1 = M.y + rad * Math.sin(a1)
    return `M ${x0} ${y0} A ${rad} ${rad} 0 ${large} ${sweep} ${x1} ${y1}`
  }
  const aIn = Math.atan2(S.y - M.y, S.x - M.x)
  const aOut = Math.atan2(r.y, r.x)
  const nSide = { x: n.x, y: n.y }
  if ((S.x - M.x) * n.x + (S.y - M.y) * n.y < 0) {
    nSide.x = -n.x
    nSide.y = -n.y
  }
  const aN = Math.atan2(nSide.y, nSide.x)

  // ─── Background grid ─────────────────────────────────────────────────
  const gridLines: React.ReactNode[] = []
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

  const axisLabels: React.ReactNode[] = []
  if (isStage3) {
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
  }

  // ─── HUD content per stage ────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`
  const hudTR = isStage1
    ? `θᵢ = θᵣ = ${incidenceDeg}°`
    : isStage2
      ? `θᵢ = ${incidenceDeg}°`
      : null
  const hudBL = isStage1 ? labels.tip1 : isStage2 ? labels.tip2 : labels.tip3
  const hudBR = isStage2
    ? `${labels.shots} ${shots}/${maxShots} · ${labels.lit} ${lit.length}/${activeStars.length}`
    : isStage3
      ? `${labels.target} ${Math.min(targetIdx + 1, activeStars.length)}/${activeStars.length} · ${labels.lit} ${lit.length}/${activeStars.length}`
      : null
  const showExhaustedWarn = isStage2 && shots >= maxShots && lit.length < activeStars.length

  const canFire = isStage2 ? shots < maxShots : isStage3 ? targetIdx < activeStars.length : false
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
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />
        {gridLines}
        {axisLabels}

        {/* Normal (stage 1) */}
        {showNormal && (
          <line
            x1={M.x - n.x * 130}
            y1={M.y - n.y * 130}
            x2={M.x + n.x * 130}
            y2={M.y + n.y * 130}
            stroke="#6C7A93"
            strokeWidth={1.5}
            strokeDasharray="5 6"
          />
        )}

        {/* Dim incident guide (stages 2 & 3) — ghost of the S→M light path */}
        {showIncidentGuide && (
          <line
            x1={S.x}
            y1={S.y}
            x2={M.x}
            y2={M.y}
            stroke="rgba(234,240,250,0.22)"
            strokeWidth={2}
            strokeLinecap="round"
          />
        )}

        {/* Incidence arc — the θᵢ callout, shown on all stages */}
        {showIncidenceArc && (
          <path d={arcPath(aIn, aN, 34)} fill="none" stroke="#37C9B8" strokeWidth={1.5} />
        )}
        {/* Reflection arc — only stage 1 (reveals the equality) */}
        {showReflectionArc && (
          <path d={arcPath(aN, aOut, 34)} fill="none" stroke="#37C9B8" strokeWidth={1.5} />
        )}

        {/* Continuous beam (stage 1) */}
        {showContinuousBeam && (
          <>
            <line x1={S.x} y1={S.y} x2={M.x} y2={M.y} stroke="rgba(249,115,22,.22)" strokeWidth={9} strokeLinecap="round" />
            <line x1={S.x} y1={S.y} x2={M.x} y2={M.y} stroke="#F97316" strokeWidth={2.4} strokeLinecap="round" />
            <line x1={M.x} y1={M.y} x2={R2.x} y2={R2.y} stroke="rgba(249,115,22,.22)" strokeWidth={9} strokeLinecap="round" />
            <line x1={M.x} y1={M.y} x2={R2.x} y2={R2.y} stroke="#F97316" strokeWidth={2.4} strokeLinecap="round" />
          </>
        )}

        {/* Fire trail (stages 2 & 3, during animation) */}
        {showTrail && (
          <g opacity={beamOp}>
            {iFrac > 0 && (
              <>
                <line x1={S.x} y1={S.y} x2={trailMid.x} y2={trailMid.y} stroke="rgba(249,115,22,.22)" strokeWidth={9} strokeLinecap="round" />
                <line x1={S.x} y1={S.y} x2={trailMid.x} y2={trailMid.y} stroke="#F97316" strokeWidth={2.4} strokeLinecap="round" />
              </>
            )}
            {rFrac > 0 && (
              <>
                <line x1={M.x} y1={M.y} x2={trailEnd.x} y2={trailEnd.y} stroke="rgba(249,115,22,.22)" strokeWidth={9} strokeLinecap="round" />
                <line x1={M.x} y1={M.y} x2={trailEnd.x} y2={trailEnd.y} stroke="#F97316" strokeWidth={2.4} strokeLinecap="round" />
              </>
            )}
          </g>
        )}

        {/* Stars */}
        {isStage2 &&
          activeStars.map((s) => {
            const on = lit.includes(s.id)
            return (
              <g key={s.id}>
                {on && <circle cx={s.x} cy={s.y} r={20} fill="#37C9B8" opacity={0.22} />}
                <circle cx={s.x} cy={s.y} r={9} fill={on ? '#37C9B8' : 'none'} stroke={on ? '#37C9B8' : '#6C7A93'} strokeWidth={2} />
              </g>
            )
          })}

        {isStage3 && (
          <>
            {activeStars
              .filter((s) => lit.includes(s.id))
              .map((s) => (
                <g key={s.id}>
                  <circle cx={s.x} cy={s.y} r={20} fill="#37C9B8" opacity={0.22} />
                  <circle cx={s.x} cy={s.y} r={9} fill="#37C9B8" stroke="#37C9B8" strokeWidth={2} />
                </g>
              ))}
            {activeStars[targetIdx] && (
              <g key={activeStars[targetIdx].id}>
                <circle cx={activeStars[targetIdx].x} cy={activeStars[targetIdx].y} r={22} fill="none" stroke="#F97316" strokeWidth={1.5} opacity={0.5}>
                  <animate attributeName="r" values="18;26;18" dur="1.6s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.7;0.15;0.7" dur="1.6s" repeatCount="indefinite" />
                </circle>
                <circle cx={activeStars[targetIdx].x} cy={activeStars[targetIdx].y} r={9} fill="none" stroke="#F97316" strokeWidth={2.4} />
                <text
                  x={activeStars[targetIdx].x + 14}
                  y={activeStars[targetIdx].y - 12}
                  fill="#F9A968"
                  fontFamily="'JetBrains Mono', monospace"
                  fontSize={11}
                >
                  T ({activeStars[targetIdx].x}, {cartY(activeStars[targetIdx].y)})
                </text>
              </g>
            )}
            <text x={S.x + 14} y={S.y - 12} fill="#F9A968" fontFamily="'JetBrains Mono', monospace" fontSize={11}>
              S ({S.x}, {cartY(S.y)})
            </text>
            <text x={M.x + 14} y={M.y - 12} fill="#EAF0FA" fontFamily="'JetBrains Mono', monospace" fontSize={11}>
              M ({M.x}, {cartY(M.y)})
            </text>
          </>
        )}

        {/* Source */}
        <circle cx={S.x} cy={S.y} r={16} fill="#F97316" opacity={0.28} />
        <circle cx={S.x} cy={S.y} r={8} fill="#F97316" />

        {/* Mirror (draggable) */}
        <g onPointerDown={mirrorDown} style={{ cursor: 'grab' }}>
          <line x1={m1.x} y1={m1.y} x2={m2.x} y2={m2.y} stroke="rgba(234,240,250,.12)" strokeWidth={18} strokeLinecap="round" />
          <line x1={m1.x} y1={m1.y} x2={m2.x} y2={m2.y} stroke="#EAF0FA" strokeWidth={3} strokeLinecap="round" />
          <circle cx={m1.x} cy={m1.y} r={6} fill="#37C9B8" />
          <circle cx={m2.x} cy={m2.y} r={6} fill="#37C9B8" />
        </g>

        {/* Peek angle badge (stage 3, top-center) */}
        {isStage3 && peekPhi !== null && (
          <g>
            <rect x={W / 2 - 90} y={16} width={180} height={34} rx={17} fill="rgba(13,21,36,.85)" stroke="#F97316" strokeWidth={1.5} />
            <text
              x={W / 2}
              y={38}
              fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={13}
              fontWeight={700}
              letterSpacing="0.1em"
              textAnchor="middle"
            >
              φ = {displayDeg(peekPhi).toFixed(1)}°
            </text>
          </g>
        )}
      </svg>

      {/* HUD overlays (HTML, one per corner) */}
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
      {hudTR && (
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
      )}
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
      {hudBR && (
        <div
          style={{
            position: 'absolute',
            bottom: '3rem',
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
          {hudBR}
          {showExhaustedWarn && (
            <div style={{ color: '#F9A968', marginTop: '0.6rem' }}>{labels.exhausted}</div>
          )}
        </div>
      )}

      {/* Fire button — HTML overlay for proper pill styling */}
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
          onMouseDown={(e) => {
            if (canFire) (e.currentTarget as HTMLButtonElement).style.transform = 'translateX(-50%) scale(0.96)'
          }}
          onMouseUp={(e) => {
            ;(e.currentTarget as HTMLButtonElement).style.transform = 'translateX(-50%) scale(1)'
          }}
          onMouseLeave={(e) => {
            ;(e.currentTarget as HTMLButtonElement).style.transform = 'translateX(-50%) scale(1)'
          }}
        >
          <i
            className="bi bi-lightning-charge-fill"
            style={{ marginInlineEnd: '0.8rem', fontSize: '2.8rem', verticalAlign: '-0.2rem' }}
          />
          {labels.fire}
        </button>
      )}
    </div>
  )
}
