import { useLocale } from '@galalem/react-localization'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'

/**
 * Inline replica of `exercises/reflexion-lumiere`'s Scene, for the guided
 * tutorial only.
 *
 * DELIBERATE SNAPSHOT — this is a hand-maintained copy pinned to
 * `reflexion-lumiere`, not a reuse of it. The tutorial runs in the LMS
 * document (no iframe, no SDK, no postMessage) so the tour can anchor to
 * real elements by ref and constrain what the student can touch. Revisit
 * this file when that exercise's scene or the exercise-page chrome changes.
 *
 * Geometry, colors and behavior mirror the original 1:1. The one
 * systematic difference: the sandboxed exercise sets `:root { font-size: 1vh }`
 * so its HUD is sized in `rem`. Here the canvas is a `container-type:
 * inline-size` box locked to 16:9, so 1 in-iframe `rem` == 0.5625cqi.
 * `u()` does that conversion — keep using it instead of raw px/rem.
 */

// ─── Scene constants (mirrored from the exercise) ───────────────────────
const W = 800
const H = 450
const S = { x: 100, y: 100 } // Source       — Cartesian (100, 350)
const M = { x: 400, y: 250 } // Mirror pivot — Cartesian (400, 200)
const L = 80 // mirror half-length
const DEFAULT_PHI = 0.62

const BEAM_INCIDENT_MS = 100
const BEAM_REFLECTED_MS = 300
const BEAM_FADE_MS = 600
const BEAM_TOTAL_MS = BEAM_INCIDENT_MS + BEAM_REFLECTED_MS + BEAM_FADE_MS

/**
 * In-iframe `1rem` (= 1vh of a 16:9 canvas) expressed in cqi of the scene
 * box. The container context is `.tutorial-scene`, NOT `.canvas` — in
 * fullscreen the canvas fills the screen while the scene stays letterboxed
 * to 16:9, so measuring against the canvas would blow the HUD up.
 */
const u = (n: number) => `${(n * 0.5625).toFixed(4)}cqi`

type Star = { id: string; x: number; y: number }

const STAGE2_STARS: Star[] = [
  { id: 'a', x: 680, y: 110 },
  { id: 'b', x: 720, y: 340 },
  { id: 'c', x: 500, y: 60 },
]
const STAGE2_MAX_SHOTS = 7

// The exercise picks one of five setups by `seed % 5`. The tutorial pins
// setup 0 so the tour script can quote real coordinates and a real answer.
const STAGE3_TARGETS: Star[] = [
  { id: 's0a', x: 700, y: 100 },
  { id: 's0b', x: 600, y: 400 },
]

// ─── Math (mirrored) ────────────────────────────────────────────────────
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
/** Mirror angle in the Cartesian (y-up) convention the student computes in. */
function displayDeg(phi: number) {
  let d = (-phi * 180) / Math.PI
  while (d > 90) d -= 180
  while (d <= -90) d += 180
  return d
}
function cartY(y: number) {
  return H - y
}

// ─── Public surface ─────────────────────────────────────────────────────
export type SceneSnapshot = {
  stage: number
  phi: number
  phiDeg: number
  moved: boolean
  fired: number
  lit: string[]
  shots: number
  maxShots: number
  targetIdx: number
  totalTargets: number
  canSubmit: boolean
  incidenceDeg: number
  readout: string
}

export type TutorialSceneHandle = {
  reset: () => void
  peek: () => void
}

/** Which affordances the student may use — the tour narrows this per step. */
export type SceneAllow = { drag: boolean; fire: boolean }

interface Props {
  stage: number
  allow?: SceneAllow
  onSnapshot?: (s: SceneSnapshot) => void
}

// SVG/HUD labels are drawn as plain text — no KaTeX, matching the
// exercise's own `labels.*` convention.
const LABEL_KEYS = ['fire', 'shots', 'lit', 'target', 'stage', 'exhausted', 'tip1', 'tip2', 'tip3'] as const
const STAGE_KEYS = ['observe', 'experiment', 'evaluate'] as const

export const TutorialScene = forwardRef<TutorialSceneHandle, Props>(function TutorialScene(
  { stage, allow = { drag: true, fire: true }, onSnapshot },
  ref,
) {
  const { __ } = useLocale()
  const LABELS = useMemo(
    () =>
      Object.fromEntries(LABEL_KEYS.map((k) => [k, __(`pages.tutorial.scene.${k}`)])) as Record<
        (typeof LABEL_KEYS)[number],
        string
      >,
    [__],
  )

  const [phi, setPhi] = useState(DEFAULT_PHI)
  const [dragging, setDragging] = useState(false)
  const [moved, setMoved] = useState(false)
  const [lit, setLit] = useState<string[]>([])
  const [shots, setShots] = useState(0)
  const [fired, setFired] = useState(0)
  const [beamAnim, setBeamAnim] = useState<{ phi: number; at: number } | null>(null)
  const [tick, setTick] = useState(0)
  const [peekPhi, setPeekPhi] = useState<number | null>(null)
  const [targetIdx, setTargetIdx] = useState(0)

  const svgRef = useRef<SVGSVGElement>(null)
  const rafRef = useRef<number>(0)

  const isStage1 = stage === 1
  const isStage2 = stage === 2
  const isStage3 = stage === 3
  const activeStars = isStage3 ? STAGE3_TARGETS : isStage2 ? STAGE2_STARS : []
  const maxShots = isStage2 ? STAGE2_MAX_SHOTS : 0

  const resetStageState = useCallback(() => {
    setPhi(DEFAULT_PHI)
    setMoved(false)
    setLit([])
    setShots(0)
    setFired(0)
    setBeamAnim(null)
    setPeekPhi(null)
    setTargetIdx(0)
  }, [])

  // Fresh state on every stage change, matching the exercise's Next handler.
  useEffect(() => {
    resetStageState()
  }, [stage, resetStageState])

  const fire = useCallback(() => {
    if (isStage1 || !allow.fire) return
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
    setFired((f) => f + 1)
    setBeamAnim({ phi, at: now })
    setTick(now)
  }, [isStage1, isStage2, isStage3, allow.fire, phi, shots, maxShots, lit, targetIdx, activeStars])

  useImperativeHandle(
    ref,
    () => ({
      reset: resetStageState,
      peek: () => {
        if (isStage3) setPeekPhi(phi)
      },
    }),
    [resetStageState, isStage3, phi],
  )

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
      ? `${LABELS.shots} ${shots}/${maxShots} · ${LABELS.lit} ${lit.length}/${activeStars.length}${
          shots >= maxShots && lit.length < activeStars.length ? ` · ${LABELS.exhausted}` : ''
        }`
      : `${LABELS.target} ${Math.min(targetIdx + 1, activeStars.length)}/${activeStars.length} · ${LABELS.lit} ${lit.length}/${activeStars.length}`

  // Report state upward so the tour can advance on real student actions —
  // the same signals the real chrome receives through PROGRESS.
  useEffect(() => {
    onSnapshot?.({
      stage,
      phi,
      phiDeg: displayDeg(phi),
      moved,
      fired,
      lit,
      shots,
      maxShots,
      targetIdx,
      totalTargets: activeStars.length,
      canSubmit,
      incidenceDeg,
      readout,
    })
  }, [
    onSnapshot, stage, phi, moved, fired, lit, shots, maxShots,
    targetIdx, activeStars.length, canSubmit, incidenceDeg, readout,
  ])

  useEffect(() => {
    if (peekPhi === null) return
    const t = setTimeout(() => setPeekPhi(null), 1500)
    return () => clearTimeout(t)
  }, [peekPhi])

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
    if (!allow.drag) return
    e.preventDefault()
    e.stopPropagation()
    setDragging(true)
    const p = svgPoint(e)
    if (p) applyMirror(p)
  }
  const svgMove = (e: React.PointerEvent) => {
    if (!dragging || !allow.drag) return
    const p = svgPoint(e)
    if (p) applyMirror(p)
  }

  // ─── Geometry for rendering ───────────────────────────────────────────
  const dir = { x: Math.cos(phi), y: Math.sin(phi) }
  const { r, n } = reflectDir(phi)
  const m1 = { x: M.x - dir.x * L, y: M.y - dir.y * L }
  const m2 = { x: M.x + dir.x * L, y: M.y + dir.y * L }
  const R2 = { x: M.x + r.x * 1500, y: M.y + r.y * 1500 }

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
      beamOp = Math.max(0, 1 - (elapsed - BEAM_INCIDENT_MS - BEAM_REFLECTED_MS) / BEAM_FADE_MS)
    }
    const br = reflectDir(beamAnim.phi).r
    trailMid = { x: S.x + (M.x - S.x) * iFrac, y: S.y + (M.y - S.y) * iFrac }
    trailEnd = { x: M.x + br.x * 1500 * rFrac, y: M.y + br.y * 1500 * rFrac }
  }

  const aIn = Math.atan2(S.y - M.y, S.x - M.x)
  const aOut = Math.atan2(r.y, r.x)
  const nSide = { x: n.x, y: n.y }
  if ((S.x - M.x) * n.x + (S.y - M.y) * n.y < 0) {
    nSide.x = -n.x
    nSide.y = -n.y
  }
  const aN = Math.atan2(nSide.y, nSide.x)

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

  const gridLines: React.ReactNode[] = []
  if (isStage3) {
    for (let gx = 0; gx <= W; gx += 50) {
      gridLines.push(
        <line key={`gx${gx}`} x1={gx} y1={0} x2={gx} y2={H} stroke="#12203a"
          strokeWidth={gx % 100 === 0 ? 1 : 0.5} opacity={gx % 100 === 0 ? 1 : 0.6} />,
      )
    }
    for (let gy = 0; gy <= H; gy += 50) {
      gridLines.push(
        <line key={`gy${gy}`} x1={0} y1={gy} x2={W} y2={gy} stroke="#12203a"
          strokeWidth={gy % 100 === 0 ? 1 : 0.5} opacity={gy % 100 === 0 ? 1 : 0.6} />,
      )
    }
  } else {
    for (let gx = 40; gx < W; gx += 60) {
      gridLines.push(<line key={`gx${gx}`} x1={gx} y1={0} x2={gx} y2={H} stroke="#12203a" strokeWidth={1} />)
    }
    for (let gy = 40; gy < H; gy += 60) {
      gridLines.push(<line key={`gy${gy}`} x1={0} y1={gy} x2={W} y2={gy} stroke="#12203a" strokeWidth={1} />)
    }
  }

  const axisLabels: React.ReactNode[] = []
  if (isStage3) {
    for (let x = 100; x <= 700; x += 100) {
      axisLabels.push(
        <text key={`ax${x}`} x={x} y={H - 6} fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace" fontSize={9} textAnchor="middle">{x}</text>,
      )
    }
    for (let y = 100; y <= 400; y += 100) {
      axisLabels.push(
        <text key={`ay${y}`} x={6} y={y + 3} fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace" fontSize={9}>{cartY(y)}</text>,
      )
    }
  }

  const showContinuousBeam = isStage1
  const showIncidentGuide = !isStage1
  const showTrail = (isStage2 || isStage3) && !!beamAnim && beamOp > 0
  const showIncidenceArc = !isStage3
  const showReflectionArc = isStage1

  const stageName = __(`pages.tutorial.stage.${STAGE_KEYS[stage - 1] ?? 'observe'}.name`)
  const hudTL = `${LABELS.stage} 0${stage} · ${stageName}`
  const hudTR = isStage1 ? `θᵢ = θᵣ = ${incidenceDeg}°` : isStage2 ? `θᵢ = ${incidenceDeg}°` : null
  const hudBL = isStage1 ? LABELS.tip1 : isStage2 ? LABELS.tip2 : LABELS.tip3
  const hudBR = isStage2
    ? `${LABELS.shots} ${shots}/${maxShots} · ${LABELS.lit} ${lit.length}/${activeStars.length}`
    : isStage3
      ? `${LABELS.target} ${Math.min(targetIdx + 1, activeStars.length)}/${activeStars.length} · ${LABELS.lit} ${lit.length}/${activeStars.length}`
      : null

  const canFire = isStage2 ? shots < maxShots : isStage3 ? targetIdx < activeStars.length : false
  const showFireButton = !isStage1

  const hudBase: React.CSSProperties = {
    position: 'absolute',
    fontFamily: "'JetBrains Mono', monospace",
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    color: '#6C7A93',
    zIndex: 5,
    pointerEvents: 'none',
    fontSize: u(2.3),
  }

  return (
    <div className="tutorial-scene" style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block', touchAction: 'none', userSelect: 'none' }}
        onPointerMove={svgMove}
        onPointerUp={() => setDragging(false)}
        onPointerLeave={() => setDragging(false)}
      >
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />
        {gridLines}
        {axisLabels}

        <line
          x1={M.x - n.x * 130} y1={M.y - n.y * 130}
          x2={M.x + n.x * 130} y2={M.y + n.y * 130}
          stroke="#6C7A93" strokeWidth={1.5} strokeDasharray="5 6"
          data-tour="normal"
        />

        {showIncidentGuide && (
          <line x1={S.x} y1={S.y} x2={M.x} y2={M.y} stroke="rgba(234,240,250,0.22)" strokeWidth={2} strokeLinecap="round" />
        )}

        {showIncidenceArc && (
          <path d={arcPath(aIn, aN, 34)} fill="none" stroke="#37C9B8" strokeWidth={1.5} data-tour="arc-in" />
        )}
        {showReflectionArc && (
          <path d={arcPath(aN, aOut, 34)} fill="none" stroke="#37C9B8" strokeWidth={1.5} data-tour="arc-out" />
        )}

        {showContinuousBeam && (
          <g data-tour="beam">
            <line x1={S.x} y1={S.y} x2={M.x} y2={M.y} stroke="rgba(249,115,22,.22)" strokeWidth={9} strokeLinecap="round" />
            <line x1={S.x} y1={S.y} x2={M.x} y2={M.y} stroke="#F97316" strokeWidth={2.4} strokeLinecap="round" />
            <line x1={M.x} y1={M.y} x2={R2.x} y2={R2.y} stroke="rgba(249,115,22,.22)" strokeWidth={9} strokeLinecap="round" />
            <line x1={M.x} y1={M.y} x2={R2.x} y2={R2.y} stroke="#F97316" strokeWidth={2.4} strokeLinecap="round" />
          </g>
        )}

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

        {isStage2 && (
          <g data-tour="stars">
            {activeStars.map((s) => {
              const on = lit.includes(s.id)
              return (
                <g key={s.id}>
                  {on && <circle cx={s.x} cy={s.y} r={20} fill="#37C9B8" opacity={0.22} />}
                  <circle cx={s.x} cy={s.y} r={9} fill={on ? '#37C9B8' : 'none'}
                    stroke={on ? '#37C9B8' : '#6C7A93'} strokeWidth={2} />
                </g>
              )
            })}
          </g>
        )}

        {isStage3 && (
          <>
            {activeStars.filter((s) => lit.includes(s.id)).map((s) => (
              <g key={s.id}>
                <circle cx={s.x} cy={s.y} r={20} fill="#37C9B8" opacity={0.22} />
                <circle cx={s.x} cy={s.y} r={9} fill="#37C9B8" stroke="#37C9B8" strokeWidth={2} />
              </g>
            ))}
            {activeStars[targetIdx] && (
              <g data-tour="target">
                <circle cx={activeStars[targetIdx].x} cy={activeStars[targetIdx].y} r={22} fill="none" stroke="#F97316" strokeWidth={1.5} opacity={0.5}>
                  <animate attributeName="r" values="18;26;18" dur="1.6s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.7;0.15;0.7" dur="1.6s" repeatCount="indefinite" />
                </circle>
                <circle cx={activeStars[targetIdx].x} cy={activeStars[targetIdx].y} r={9} fill="none" stroke="#F97316" strokeWidth={2.4} />
                <text x={activeStars[targetIdx].x + 14} y={activeStars[targetIdx].y - 12} fill="#F9A968"
                  fontFamily="'JetBrains Mono', monospace" fontSize={11}>
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

        <g data-tour="source">
          <circle cx={S.x} cy={S.y} r={16} fill="#F97316" opacity={0.28} />
          <circle cx={S.x} cy={S.y} r={8} fill="#F97316" />
        </g>

        <g data-tour="mirror" onPointerDown={mirrorDown} style={{ cursor: allow.drag ? 'grab' : 'default' }}>
          <line x1={m1.x} y1={m1.y} x2={m2.x} y2={m2.y} stroke="rgba(234,240,250,.12)" strokeWidth={18} strokeLinecap="round" />
          <line x1={m1.x} y1={m1.y} x2={m2.x} y2={m2.y} stroke="#EAF0FA" strokeWidth={3} strokeLinecap="round" />
          <circle cx={m1.x} cy={m1.y} r={6} fill="#37C9B8" />
          <circle cx={m2.x} cy={m2.y} r={6} fill="#37C9B8" />
        </g>

        {isStage3 && peekPhi !== null && (
          <g>
            <rect x={W / 2 - 90} y={16} width={180} height={34} rx={17} fill="rgba(13,21,36,.85)" stroke="#F97316" strokeWidth={1.5} />
            <text x={W / 2} y={38} fill="#F9A968" fontFamily="'JetBrains Mono', monospace"
              fontSize={13} fontWeight={700} letterSpacing="0.1em" textAnchor="middle">
              φ = {displayDeg(peekPhi).toFixed(1)}°
            </text>
          </g>
        )}
      </svg>

      {/* HUD overlays — one per corner, mirroring the exercise's 4-corner HUD. */}
      <div style={{ ...hudBase, top: u(3), left: u(3) }} data-tour="hud-tl">{hudTL}</div>
      {hudTR && (
        <div style={{ ...hudBase, top: u(3), right: u(3), letterSpacing: '0.08em', color: '#37C9B8' }} data-tour="hud-tr">
          {hudTR}
        </div>
      )}
      <div style={{ ...hudBase, bottom: u(3), left: u(3), letterSpacing: '0.08em', textTransform: 'none' }} data-tour="hud-bl">
        {hudBL}
      </div>
      {hudBR && (
        <div style={{ ...hudBase, bottom: u(3), insetInlineEnd: u(10), letterSpacing: '0.08em' }} data-tour="hud-br">
          {hudBR}
        </div>
      )}

      {showFireButton && (
        <button
          type="button"
          onClick={fire}
          disabled={!canFire || !allow.fire}
          data-tour="fire"
          style={{
            position: 'absolute',
            bottom: u(3),
            left: '50%',
            transform: 'translateX(-50%)',
            padding: `${u(2)} ${u(4)}`,
            background: canFire && allow.fire ? '#F97316' : 'rgba(30,42,64,0.85)',
            color: canFire && allow.fire ? '#FFFFFF' : '#6C7A93',
            border: `${u(0.3)} solid ${canFire && allow.fire ? '#F97316' : 'rgba(58,72,99,0.6)'}`,
            borderRadius: '100rem',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: u(2.6),
            fontWeight: 700,
            letterSpacing: '0.12em',
            cursor: canFire && allow.fire ? 'pointer' : 'not-allowed',
            zIndex: 10,
            transition: 'background 0.15s, transform 0.1s',
          }}
        >
          <i className="bi bi-lightning-charge-fill" style={{ marginInlineEnd: u(0.8), fontSize: u(2.8), verticalAlign: '-0.2em' }} />
          {LABELS.fire}
        </button>
      )}
    </div>
  )
})

export { W as SCENE_W, H as SCENE_H, S as SCENE_SOURCE, M as SCENE_MIRROR, STAGE3_TARGETS, cartY, displayDeg }
