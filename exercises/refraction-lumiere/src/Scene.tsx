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
// 16:9 viewBox — matches the .canvas cell aspect on the frontend.
// SVG y is down; Cartesian y (shown to the student) is H − svgY.
const W = 800
const H = 450

// Air/water dioptre. Interface horizontal at y = 225 (canvas mid-line).
// Upper medium: air (n₁ = 1.00). Lower medium: water (n₂ = 1.33).
const INTERFACE_Y = 225
const I = { x: 400, y: INTERFACE_Y } // fixed incidence point
const N1 = 1.0
const N2 = 1.33

// The single DOF: source S is dragged horizontally along y = S_LOCK_Y.
// One-axis drag = one primitive (§5 rule). The incident angle i₁ varies
// with Sx; Sy is fixed, so students can only tune i₁.
const S_LOCK_Y = 100
const S_X_MIN = 40
const S_X_MAX = 760
const S_DEFAULT_X = 250 // ~ i₁ ≈ −50° — deliberately off-center for stage 1

// Beam animation phases (ms).
const BEAM_INCIDENT_MS = 100
const BEAM_REFRACTED_MS = 300
const BEAM_FADE_MS = 600
const BEAM_TOTAL_MS = BEAM_INCIDENT_MS + BEAM_REFRACTED_MS + BEAM_FADE_MS

type Target = { id: string; x: number; y: number }

// Stage-2 fixed targets, hand-picked so each is reachable inside the
// i₁ range that maps to Sx ∈ [S_X_MIN, S_X_MAX].
const STAGE2_TARGETS: Target[] = [
  { id: 'a', x: 300, y: 400 },
  { id: 'b', x: 500, y: 350 },
  { id: 'c', x: 400, y: 410 },
]
const STAGE2_SHOT_BUDGET = 7

// Stage-3 setups — deterministically picked by seed % length. Each pair
// is hand-verified reachable and geometrically distinct.
const STAGE3_SETUPS: { targets: Target[] }[] = [
  { targets: [{ id: 's0a', x: 280, y: 380 }, { id: 's0b', x: 520, y: 360 }] },
  { targets: [{ id: 's1a', x: 340, y: 360 }, { id: 's1b', x: 460, y: 400 }] },
  { targets: [{ id: 's2a', x: 300, y: 340 }, { id: 's2b', x: 510, y: 410 }] },
  { targets: [{ id: 's3a', x: 350, y: 410 }, { id: 's3b', x: 490, y: 380 }] },
  { targets: [{ id: 's4a', x: 280, y: 400 }, { id: 's4b', x: 500, y: 370 }] },
]

const dict = { en } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── Optical math ───────────────────────────────────────────────────────
// All math in SVG coords (y-down). Cartesian conversion only for display.

// Incidence angle i₁ from source Sx, measured from the vertical normal at
// I. Positive when S is to the right of I. Range roughly (−71°, +71°).
function incidenceAngle(sx: number): number {
  const dx = sx - I.x
  const dy = INTERFACE_Y - S_LOCK_Y // 125, > 0
  return Math.atan2(dx, dy)
}

// Snell-Descartes. Returns { i2, tir }. TIR only when |sin i₂| > 1, i.e.
// when going denser→rarer past critical angle. Air→water can never TIR;
// this returns tir=false for the whole DOF range in this exercise.
function refract(i1: number): { i2: number; sinI2: number; tir: boolean } {
  const sinI2 = (N1 / N2) * Math.sin(i1)
  if (Math.abs(sinI2) > 1) return { i2: Math.sign(sinI2) * Math.PI / 2, sinI2, tir: true }
  return { i2: Math.asin(sinI2), sinI2, tir: false }
}

// Refracted direction as a unit vector in SVG coords. Refracted ray
// travels into the lower medium (y increasing), keeps the sign of x
// from the incident ray.
function refractedDir(i2: number): { x: number; y: number } {
  return { x: Math.sin(i2), y: Math.cos(i2) }
}

// Hit-test: does the refracted ray from I in direction d pass within
// TOL of target T?
const HIT_TOL = 15
function hitTarget(d: { x: number; y: number }, t: Target): boolean {
  const vx = t.x - I.x
  const vy = t.y - I.y
  const proj = vx * d.x + vy * d.y
  if (proj < 20) return false
  const fx = I.x + d.x * proj
  const fy = I.y + d.y * proj
  return Math.hypot(t.x - fx, t.y - fy) < HIT_TOL
}

function cartY(y: number): number {
  return H - y
}

function rad2deg(r: number): number {
  return (r * 180) / Math.PI
}

// Format i₁ / i₂ for the HUD readout. Signed integer degrees.
function fmtDeg(r: number): string {
  const d = Math.round(rad2deg(r))
  return `${d}°`
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
  const setStage = useSetStage()

  // ─── State ──────────────────────────────────────────────────────────
  const [sx, setSx] = useState(S_DEFAULT_X)
  const [dragging, setDragging] = useState(false)
  const [movedRange, setMovedRange] = useState({ min: S_DEFAULT_X, max: S_DEFAULT_X })
  const [lit, setLit] = useState<string[]>([])
  const [shots, setShots] = useState(0)
  const [beamAnim, setBeamAnim] = useState<{ sx: number; at: number } | null>(null)
  const [tick, setTick] = useState(0)
  const [peekVisible, setPeekVisible] = useState(false)
  const [targetIdx, setTargetIdx] = useState(0)

  const svgRef = useRef<SVGSVGElement>(null)
  const rafRef = useRef<number>(0)

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  const activeTargets = isStage2
    ? STAGE2_TARGETS
    : isStage3
      ? stage3Setup.targets
      : []

  const complete = useComplete()
  const progress = useProgress()

  // ─── Reset ───────────────────────────────────────────────────────────
  const resetStageState = useCallback(() => {
    setSx(S_DEFAULT_X)
    setMovedRange({ min: S_DEFAULT_X, max: S_DEFAULT_X })
    setLit([])
    setShots(0)
    setBeamAnim(null)
    setPeekVisible(false)
    setTargetIdx(0)
  }, [])
  useReset(resetStageState)

  // ─── Derived optics ──────────────────────────────────────────────────
  const i1 = incidenceAngle(sx)
  const { i2, tir } = refract(i1)
  const rDir = refractedDir(i2)

  // Ratio n₁·sin(i₁) / (n₂·sin(i₂)) — should stay ≈ 1.00 as sx changes.
  // Snap to 1 near normal incidence to avoid 0/0 flicker.
  const snellRatio = useMemo(() => {
    const num = N1 * Math.sin(i1)
    const den = N2 * Math.sin(i2)
    if (Math.abs(i1) < 0.02 || Math.abs(den) < 1e-6) return 1
    return num / den
  }, [i1, i2])

  // ─── Fire ────────────────────────────────────────────────────────────
  const canFire = isStage2
    ? shots < STAGE2_SHOT_BUDGET
    : isStage3
      ? targetIdx < activeTargets.length
      : false

  const fire = useCallback(() => {
    if (!canFire) return
    if (tir) {
      // Total internal reflection — beam does not refract; the fire still
      // counts as a shot on stage 3 (§5.2 no silent miss).
      if (isStage2) setShots((s) => s + 1)
      if (isStage3) setTargetIdx((i) => i + 1)
      setBeamAnim(isStage3 ? null : { sx, at: Date.now() })
      setTick(Date.now())
      return
    }
    if (isStage2) {
      const newlyLit = activeTargets
        .filter((t) => !lit.includes(t.id) && hitTarget(rDir, t))
        .map((t) => t.id)
      setShots((s) => s + 1)
      if (newlyLit.length) setLit((prev) => [...prev, ...newlyLit])
    } else if (isStage3) {
      const current = activeTargets[targetIdx]
      if (current && hitTarget(rDir, current)) {
        setLit((prev) => [...prev, current.id])
      }
      // §5.2 one-shot-per-target — advance regardless of hit.
      setTargetIdx((i) => i + 1)
    }
    setBeamAnim(isStage3 ? null : { sx, at: Date.now() })
    setTick(Date.now())
  }, [canFire, tir, isStage2, isStage3, sx, activeTargets, lit, targetIdx, rDir])

  // Blind-stage fail (§5.2) — all shots spent, not all lit → reset.
  useEffect(() => {
    if (!isStage3) return
    if (targetIdx >= activeTargets.length && lit.length < activeTargets.length) {
      const t = setTimeout(() => resetStageState(), 1000)
      return () => clearTimeout(t)
    }
    return
  }, [isStage3, targetIdx, lit.length, activeTargets.length, resetStageState])

  // ─── Beam animation (rAF, not useTicker — cosmetic only) ────────────
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

  // ─── Advance predicate ──────────────────────────────────────────────
  // Stage 1: student swept the source across enough range to see i₁
  // vary meaningfully. 200 SVG px on the source line ≈ ~55° i₁ swing.
  const sweptRange = movedRange.max - movedRange.min
  const canSubmit = isStage1
    ? sweptRange >= 200
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

  // ─── Peek (§4.7 rule 4 — strategy hint, not answer) ──────────────────
  usePeek(() => {
    if (!isStage3) return
    setPeekVisible(true)
  })
  useEffect(() => {
    if (!peekVisible) return
    const t = setTimeout(() => setPeekVisible(false), 2000)
    return () => clearTimeout(t)
  }, [peekVisible])

  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  // ─── Spacebar fires (stages 2 & 3) ──────────────────────────────────
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

  // ─── Pointer / drag ─────────────────────────────────────────────────
  const svgPoint = (e: React.PointerEvent) => {
    const el = svgRef.current
    if (!el) return null
    const rect = el.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) / rect.width) * W,
      y: ((e.clientY - rect.top) / rect.height) * H,
    }
  }
  const applySource = (p: { x: number; y: number }) => {
    const clamped = Math.max(S_X_MIN, Math.min(S_X_MAX, p.x))
    setSx(clamped)
    if (isStage1) {
      setMovedRange((r) => ({
        min: Math.min(r.min, clamped),
        max: Math.max(r.max, clamped),
      }))
    }
  }
  const sourceDown = (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragging(true)
    const p = svgPoint(e)
    if (p) applySource(p)
  }
  const svgMove = (e: React.PointerEvent) => {
    if (!dragging) return
    const p = svgPoint(e)
    if (p) applySource(p)
  }

  // ─── Beam geometry for rendering ─────────────────────────────────────
  const S = { x: sx, y: S_LOCK_Y }
  // Refracted end point, extended out of the canvas so the line reaches
  // even for shallow angles.
  const R_END = { x: I.x + rDir.x * 900, y: I.y + rDir.y * 900 }

  // Beam trail interpolation (stage 2 animation only).
  let iFrac = 0
  let rFrac = 0
  let beamOp = 0
  let trailMid = { x: I.x, y: I.y }
  let trailEnd = { x: 0, y: 0 }
  let trailTir = false
  if (beamAnim) {
    const elapsed = Math.max(0, tick - beamAnim.at)
    if (elapsed < BEAM_INCIDENT_MS) {
      iFrac = elapsed / BEAM_INCIDENT_MS
      beamOp = 1
    } else if (elapsed < BEAM_INCIDENT_MS + BEAM_REFRACTED_MS) {
      iFrac = 1
      rFrac = (elapsed - BEAM_INCIDENT_MS) / BEAM_REFRACTED_MS
      beamOp = 1
    } else {
      iFrac = 1
      rFrac = 1
      beamOp = 1 - (elapsed - BEAM_INCIDENT_MS - BEAM_REFRACTED_MS) / BEAM_FADE_MS
    }
    const shotI1 = incidenceAngle(beamAnim.sx)
    const shotSnell = refract(shotI1)
    trailTir = shotSnell.tir
    const shotDir = refractedDir(shotSnell.i2)
    const shotS = { x: beamAnim.sx, y: S_LOCK_Y }
    trailMid = {
      x: shotS.x + (I.x - shotS.x) * iFrac,
      y: shotS.y + (I.y - shotS.y) * iFrac,
    }
    trailEnd = { x: I.x + shotDir.x * 900 * rFrac, y: I.y + shotDir.y * 900 * rFrac }
  }

  const showContinuousBeam = isStage1
  const showIncidentGuide = isStage2 // dim S→I trace between fires
  const showTrail = isStage2 && !!beamAnim && beamOp > 0

  // ─── HUD content ────────────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`

  // TR — required-info readout. Always shows the DOFs the student is
  // setting so paper math can be verified against the sim (§4.7).
  let hudTR = ''
  if (isStage1) {
    hudTR = `i₁ ${fmtDeg(i1)} · i₂ ${tir ? '—' : fmtDeg(i2)}`
  } else if (isStage2 || isStage3) {
    hudTR = `i₁ ${fmtDeg(i1)}`
  }

  const hudBL = isStage1 ? labels.tip1 : isStage2 ? labels.tip2 : labels.tip3

  // Grid + axis labels (stage 3 blind — required info).
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
    for (let y = 50; y <= 400; y += 50) {
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

  const showFireButton = !isStage1
  const currentTarget = isStage3 ? activeTargets[targetIdx] : null

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
        {/* No borderRadius on <svg>, no rx on the bg <rect>. */}
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        {gridLines}
        {axisLabels}

        {/* Water tint under the interface (visual — not a hint). */}
        <rect
          x={0}
          y={INTERFACE_Y}
          width={W}
          height={H - INTERFACE_Y}
          fill="#1e3a5f"
          opacity={0.35}
        />
        {/* Interface line */}
        <line
          x1={0}
          y1={INTERFACE_Y}
          x2={W}
          y2={INTERFACE_Y}
          stroke="#37C9B8"
          strokeWidth={1.5}
          opacity={0.85}
        />

        {/* Normal — dashed vertical line at I on both sides of interface */}
        <line
          x1={I.x}
          y1={INTERFACE_Y - 130}
          x2={I.x}
          y2={INTERFACE_Y + 130}
          stroke="#6C7A93"
          strokeWidth={1.5}
          strokeDasharray="5 6"
        />

        {/* Medium indices — small chips near the interface, left edge */}
        {!isStage3 && (
          <>
            <text
              x={22}
              y={INTERFACE_Y - 12}
              fill="#EAF0FA"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={12}
              opacity={0.85}
            >
              n₁ = {N1.toFixed(2)} · air
            </text>
            <text
              x={22}
              y={INTERFACE_Y + 22}
              fill="#EAF0FA"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={12}
              opacity={0.85}
            >
              n₂ = {N2.toFixed(2)} · water
            </text>
          </>
        )}

        {/* Continuous rays (stage 1) — incident then refracted */}
        {showContinuousBeam && (
          <>
            <line
              x1={S.x}
              y1={S.y}
              x2={I.x}
              y2={I.y}
              stroke="rgba(249,115,22,.22)"
              strokeWidth={9}
              strokeLinecap="round"
            />
            <line
              x1={S.x}
              y1={S.y}
              x2={I.x}
              y2={I.y}
              stroke="#F97316"
              strokeWidth={2.4}
              strokeLinecap="round"
            />
            {!tir && (
              <>
                <line
                  x1={I.x}
                  y1={I.y}
                  x2={R_END.x}
                  y2={R_END.y}
                  stroke="rgba(249,115,22,.22)"
                  strokeWidth={9}
                  strokeLinecap="round"
                />
                <line
                  x1={I.x}
                  y1={I.y}
                  x2={R_END.x}
                  y2={R_END.y}
                  stroke="#F97316"
                  strokeWidth={2.4}
                  strokeLinecap="round"
                />
              </>
            )}
          </>
        )}

        {/* Dim incident guide (stage 2) between fires */}
        {showIncidentGuide && (
          <line
            x1={S.x}
            y1={S.y}
            x2={I.x}
            y2={I.y}
            stroke="rgba(234,240,250,0.22)"
            strokeWidth={2}
            strokeLinecap="round"
          />
        )}

        {/* Fire trail (stage 2) */}
        {showTrail && (
          <g opacity={beamOp}>
            {iFrac > 0 && (
              <>
                <line
                  x1={S.x}
                  y1={S.y}
                  x2={trailMid.x}
                  y2={trailMid.y}
                  stroke="rgba(249,115,22,.22)"
                  strokeWidth={9}
                  strokeLinecap="round"
                />
                <line
                  x1={S.x}
                  y1={S.y}
                  x2={trailMid.x}
                  y2={trailMid.y}
                  stroke="#F97316"
                  strokeWidth={2.4}
                  strokeLinecap="round"
                />
              </>
            )}
            {rFrac > 0 && !trailTir && (
              <>
                <line
                  x1={I.x}
                  y1={I.y}
                  x2={trailEnd.x}
                  y2={trailEnd.y}
                  stroke="rgba(249,115,22,.22)"
                  strokeWidth={9}
                  strokeLinecap="round"
                />
                <line
                  x1={I.x}
                  y1={I.y}
                  x2={trailEnd.x}
                  y2={trailEnd.y}
                  stroke="#F97316"
                  strokeWidth={2.4}
                  strokeLinecap="round"
                />
              </>
            )}
          </g>
        )}
        {/* Stage 3: no beam, no trail — student computes from coords. */}

        {/* Stage-2 targets */}
        {isStage2 &&
          STAGE2_TARGETS.map((t) => {
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

        {/* Stage-3 targets — current pulses; lit stay teal; coords labeled */}
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
                  <text
                    x={t.x + 14}
                    y={t.y - 12}
                    fill="#F9A968"
                    fontFamily="'JetBrains Mono', monospace"
                    fontSize={11}
                  >
                    T ({t.x}, {cartY(t.y)})
                  </text>
                </g>
              ))}
            {currentTarget && (
              <g key={currentTarget.id}>
                <circle
                  cx={currentTarget.x}
                  cy={currentTarget.y}
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
                  cx={currentTarget.x}
                  cy={currentTarget.y}
                  r={9}
                  fill="none"
                  stroke="#F97316"
                  strokeWidth={2.4}
                />
                <text
                  x={currentTarget.x + 14}
                  y={currentTarget.y - 12}
                  fill="#F9A968"
                  fontFamily="'JetBrains Mono', monospace"
                  fontSize={11}
                >
                  T ({currentTarget.x}, {cartY(currentTarget.y)})
                </text>
              </g>
            )}
            {/* I coordinate label */}
            <text
              x={I.x + 10}
              y={I.y - 6}
              fill="#EAF0FA"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={11}
            >
              I ({I.x}, {cartY(I.y)})
            </text>
            {/* S coordinate label */}
            <text
              x={S.x + 12}
              y={S.y - 10}
              fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={11}
            >
              S ({Math.round(S.x)}, {cartY(S_LOCK_Y)})
            </text>
            {/* Medium indices — moved to right edge on stage 3 */}
            <text
              x={W - 22}
              y={INTERFACE_Y - 12}
              fill="#EAF0FA"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={11}
              textAnchor="end"
              opacity={0.9}
            >
              n₁ = {N1.toFixed(2)}
            </text>
            <text
              x={W - 22}
              y={INTERFACE_Y + 22}
              fill="#EAF0FA"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={11}
              textAnchor="end"
              opacity={0.9}
            >
              n₂ = {N2.toFixed(2)}
            </text>
          </>
        )}

        {/* Interface incidence marker (small dot at I) */}
        <circle cx={I.x} cy={I.y} r={4} fill="#EAF0FA" />

        {/* Snell ratio badge (stage 1 only — validates the invariant) */}
        {isStage1 && (
          <g>
            <rect
              x={W / 2 - 130}
              y={16}
              width={260}
              height={30}
              rx={15}
              fill="rgba(13,21,36,.7)"
              stroke="#37C9B8"
              strokeWidth={1}
            />
            <text
              x={W / 2}
              y={36}
              fill="#37C9B8"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={12}
              fontWeight={700}
              letterSpacing="0.08em"
              textAnchor="middle"
            >
              n₁·sin(i₁) / n₂·sin(i₂) = {snellRatio.toFixed(2)}
            </text>
          </g>
        )}

        {/* Draggable source S — glowing dot on a horizontal track above */}
        <line
          x1={S_X_MIN}
          y1={S_LOCK_Y}
          x2={S_X_MAX}
          y2={S_LOCK_Y}
          stroke="rgba(234,240,250,.08)"
          strokeWidth={2}
          strokeDasharray="3 6"
        />
        <g
          onPointerDown={sourceDown}
          style={{ cursor: dragging ? 'grabbing' : 'grab' }}
        >
          <circle cx={S.x} cy={S.y} r={18} fill="#F97316" opacity={0.28} />
          <circle cx={S.x} cy={S.y} r={9} fill="#F97316" />
          <circle cx={S.x} cy={S.y} r={3} fill="#FFFFFF" />
        </g>

        {/* Peek strategy badge (stage 3, top-center) */}
        {isStage3 && peekVisible && (
          <g>
            <rect
              x={W / 2 - 220}
              y={12}
              width={440}
              height={54}
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
              fontWeight={700}
              letterSpacing="0.05em"
              textAnchor="middle"
            >
              {labels.peek_strategy}
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
              i₁ = {rad2deg(i1).toFixed(1)}°
            </text>
          </g>
        )}

        {/* TIR indicator (stage 2/3 — pattern's wrinkle from sketch).
            Air→water can't TIR, so this only surfaces if a future setup
            uses reversed media. Kept as a defensive rendering. */}
        {tir && !isStage1 && (
          <g>
            <rect
              x={W / 2 - 130}
              y={INTERFACE_Y + 60}
              width={260}
              height={26}
              rx={13}
              fill="rgba(249,115,22,0.15)"
              stroke="#F97316"
              strokeWidth={1}
            />
            <text
              x={W / 2}
              y={INTERFACE_Y + 77}
              fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={11}
              fontWeight={700}
              letterSpacing="0.08em"
              textAnchor="middle"
            >
              {labels.tir}
            </text>
          </g>
        )}
      </svg>

      {/* HUD overlays — HTML in rem, NOT SVG text */}
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
      {/* Secondary TL line — stage-2 shots + lit, stage-3 target progress.
          Placed under TL (not BR — BR is reserved for parent chrome). */}
      {(isStage2 || isStage3) && (
        <div
          style={{
            position: 'absolute',
            top: '8rem',
            left: '3rem',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '2rem',
            letterSpacing: '0.08em',
            color: '#37C9B8',
            zIndex: 5,
            pointerEvents: 'none',
          }}
        >
          {isStage2
            ? `${labels.shots} ${shots}/${STAGE2_SHOT_BUDGET} · ${labels.lit} ${lit.length}/${activeTargets.length}`
            : `${labels.target} ${Math.min(targetIdx + 1, activeTargets.length)}/${activeTargets.length} · ${labels.lit} ${lit.length}/${activeTargets.length}`}
        </div>
      )}

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
          maxWidth: '55%',
        }}
      >
        {hudBL}
      </div>
      {/* NO bottom-right overlay — reserved for parent chrome (fullscreen). */}

      {/* Fire button */}
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
