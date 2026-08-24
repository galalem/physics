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
import { Emitter } from './art/Emitter'
import { Particle } from './art/Particle'
import { FieldRegion } from './art/FieldRegion'
import { Target } from './art/Target'

// ─── Scene constants ────────────────────────────────────────────────────
const W = 800
const H = 450

// Emitter pivot (muzzle base) in SVG coords. World origin sits here.
const EMITTER = { x: 80, y: 400 }
const GROUND_Y = EMITTER.y
const PX_PER_M = 6 // isotropic so circles render as circles

// Uniform magnetic field rectangle in SVG coords.
const FIELD = { x: 30, y: 30, width: 750, height: 385 }
// Same in WORLD (y up, origin at emitter):
const FIELD_WORLD = {
  xMin: (FIELD.x - EMITTER.x) / PX_PER_M,
  xMax: (FIELD.x + FIELD.width - EMITTER.x) / PX_PER_M,
  yMin: -(FIELD.y + FIELD.height - EMITTER.y) / PX_PER_M,
  yMax: -(FIELD.y - EMITTER.y) / PX_PER_M,
}

// Lorentz-force model, in dimensionless units chosen so the algebra is
// legible: mass = 1 kg, |q| = 1 C, |B| = 1 T. Therefore the cyclotron
// frequency ω_c = qB/m = 1 rad/s and the radius satisfies r = v
// numerically (metres per m/s). The pedagogy — r ∝ v, ω independent of
// v — carries over untouched to the textbook constants.
const OMEGA_C = 1 // rad/s. r_metres = v_ms / OMEGA_C.
const V0_MIN = 10 // m/s
const V0_MAX = 30 // m/s
const ANGLE_MIN_DEG = 15
const ANGLE_MAX_DEG = 165
const HIT_R_M = 2.2 // hit tolerance in metres
const SPEED_FACTOR = 3 // sim runs 3× real time
const DEFAULT_ANGLE_DEG = 60
const DEFAULT_V0 = 20

type TargetSpec = { id: string; x: number; z: number }
type Setup = { targets: TargetSpec[] }

// Stage-2 setups: 3 reachable targets each. Seed-picked.
const STAGE2_SETUPS: Setup[] = [
  { targets: [{ id: 's0a', x: 25, z: 12 }, { id: 's0b', x: 40, z: 8 }, { id: 's0c', x: 18, z: 22 }] },
  { targets: [{ id: 's1a', x: 30, z: 18 }, { id: 's1b', x: 22, z: 24 }, { id: 's1c', x: 45, z: 12 }] },
  { targets: [{ id: 's2a', x: 32, z: 20 }, { id: 's2b', x: 45, z: 15 }, { id: 's2c', x: 20, z: 8 }] },
  { targets: [{ id: 's3a', x: 20, z: 16 }, { id: 's3b', x: 35, z: 25 }, { id: 's3c', x: 50, z: 20 }] },
  { targets: [{ id: 's4a', x: 28, z: 10 }, { id: 's4b', x: 40, z: 22 }, { id: 's4c', x: 16, z: 28 }] },
]

// Stage-3 setups: harder targets, at least one requiring near-max radius.
const STAGE3_SETUPS: Setup[] = [
  { targets: [{ id: 't0a', x: 30, z: 15 }, { id: 't0b', x: 45, z: 25 }, { id: 't0c', x: 20, z: 30 }] },
  { targets: [{ id: 't1a', x: 40, z: 18 }, { id: 't1b', x: 25, z: 28 }, { id: 't1c', x: 55, z: 12 }] },
  { targets: [{ id: 't2a', x: 35, z: 25 }, { id: 't2b', x: 50, z: 15 }, { id: 't2c', x: 22, z: 20 }] },
  { targets: [{ id: 't3a', x: 28, z: 22 }, { id: 't3b', x: 42, z: 30 }, { id: 't3c', x: 18, z: 12 }] },
  { targets: [{ id: 't4a', x: 45, z: 20 }, { id: 't4b', x: 32, z: 28 }, { id: 't4c', x: 25, z: 8 }] },
]

const dict = { en } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── World ↔ SVG helpers ────────────────────────────────────────────────
function toSvgX(m: number): number {
  return EMITTER.x + m * PX_PER_M
}
function toSvgY(m: number): number {
  return EMITTER.y - m * PX_PER_M
}

// ─── Physics (closed-form circular motion) ──────────────────────────────
// Positive charge, B out of page, ω_c = qB/m > 0 → CLOCKWISE motion (as
// seen looking at the page). Centre of the circle is at 90° to the RIGHT
// of v, at distance r = v/ω_c.
//
// World frame is y-up. Angular coordinate θ decreases with time.
function centreOfCircle(v0: number, angleRad: number): { cx: number; cy: number; r: number } {
  const r = v0 / OMEGA_C
  const cx = r * Math.sin(angleRad)
  const cy = -r * Math.cos(angleRad)
  return { cx, cy, r }
}
function initialTheta(angleRad: number): number {
  // At t=0, particle sits at the origin. Vector from centre to particle
  // is (-r sin α, r cos α); its angle is atan2(cos α, -sin α).
  return Math.atan2(Math.cos(angleRad), -Math.sin(angleRad))
}
function positionAt(t: number, v0: number, angleRad: number): { x: number; z: number; theta: number } {
  const { cx, cy, r } = centreOfCircle(v0, angleRad)
  const theta = initialTheta(angleRad) - OMEGA_C * t
  return {
    x: cx + r * Math.cos(theta),
    z: cy + r * Math.sin(theta),
    theta,
  }
}
// SVG path for the FULL circle (used for preview + trail).
function circlePath(v0: number, angleRad: number): string {
  const { cx, cy, r } = centreOfCircle(v0, angleRad)
  const svgCx = toSvgX(cx)
  const svgCy = toSvgY(cy)
  const rPx = r * PX_PER_M
  return `M ${svgCx - rPx} ${svgCy} A ${rPx} ${rPx} 0 1 0 ${svgCx + rPx} ${svgCy} A ${rPx} ${rPx} 0 1 0 ${svgCx - rPx} ${svgCy}`
}

// ─── Component ──────────────────────────────────────────────────────────
type Flight = { angleRad: number; v0: number; startedAt: number }

export default function Scene() {
  const { locale, seed } = useInit()
  const stages = useMemo(() => getStagesFor(locale), [locale])
  useDeclareStages(stages)
  const labels = useMemo(() => svgLabels(locale), [locale])

  const setup2 = useMemo(() => STAGE2_SETUPS[seed % STAGE2_SETUPS.length]!, [seed])
  const setup3 = useMemo(() => STAGE3_SETUPS[seed % STAGE3_SETUPS.length]!, [seed])

  const stageIdx = useCurrentStage()
  const setStage = useSetStage()

  const [angleDeg, setAngleDeg] = useState(DEFAULT_ANGLE_DEG)
  const [v0, setV0] = useState(DEFAULT_V0)
  const [flight, setFlight] = useState<Flight | null>(null)
  const [particle, setParticle] = useState<{ x: number; z: number; theta: number } | null>(null)
  const [hits, setHits] = useState<string[]>([])
  const [shotCount, setShotCount] = useState(0)
  const [distinctAngles, setDistinctAngles] = useState<number[]>([])
  const [v0Moved, setV0Moved] = useState(false)
  const [trail, setTrail] = useState<{ angleRad: number; v0: number }[]>([])
  const [peekTip, setPeekTip] = useState<string | null>(null)
  const [peekIdx, setPeekIdx] = useState(0)
  const [dragging, setDragging] = useState(false)

  // Stage-3 shot budget: one shot per target (§5.2 preferred variant).
  const stage3TargetCount = setup3.targets.length
  const [shotsRemaining, setShotsRemaining] = useState(stage3TargetCount)

  const svgRef = useRef<SVGSVGElement>(null)
  const angleRad = (angleDeg * Math.PI) / 180

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  const activeTargets = isStage2 ? setup2.targets : isStage3 ? setup3.targets : []

  const complete = useComplete()
  const progress = useProgress()

  const resetStageState = useCallback(() => {
    setAngleDeg(DEFAULT_ANGLE_DEG)
    setV0(DEFAULT_V0)
    setFlight(null)
    setParticle(null)
    setHits([])
    setShotCount(0)
    setDistinctAngles([])
    setV0Moved(false)
    setTrail([])
    setPeekTip(null)
    setShotsRemaining(stage3TargetCount)
  }, [stage3TargetCount])

  const canFire = !flight && (!isStage3 || shotsRemaining > 0)

  const fire = useCallback(() => {
    if (!canFire) return
    setFlight({ angleRad, v0, startedAt: performance.now() })
    setShotCount((n) => n + 1)
    if (isStage3) setShotsRemaining((n) => n - 1)
    if (isStage1) {
      const bucket = Math.round(angleDeg / 15) * 15
      setDistinctAngles((prev) => (prev.includes(bucket) ? prev : [...prev, bucket]))
    }
  }, [canFire, angleRad, v0, angleDeg, isStage1, isStage3])

  // ─── Simulation ticker ────────────────────────────────────────────────
  useTicker((dt) => {
    if (!flight) return
    void dt
    const tSec = ((performance.now() - flight.startedAt) / 1000) * SPEED_FACTOR
    const p = positionAt(tSec, flight.v0, flight.angleRad)
    setParticle(p)

    // Hit test (metre space).
    const newlyHit: string[] = []
    for (const t of activeTargets) {
      if (hits.includes(t.id)) continue
      if (Math.hypot(p.x - t.x, p.z - t.z) < HIT_R_M) newlyHit.push(t.id)
    }
    if (newlyHit.length) setHits((prev) => [...prev, ...newlyHit])

    // Terminate on ground (y = 0) or exit of the field region.
    const hitGround = tSec > 0.05 && p.z <= 0
    const outOfField =
      p.x < FIELD_WORLD.xMin || p.x > FIELD_WORLD.xMax || p.z > FIELD_WORLD.yMax
    if (hitGround || outOfField) {
      setFlight(null)
      if (isStage1) {
        setTrail((prev) => [...prev.slice(-2), { angleRad: flight.angleRad, v0: flight.v0 }])
      }
    }
  })

  // ─── Blind-stage fail — out of shots without full clearance ──────────
  useEffect(() => {
    if (!isStage3) return
    if (shotsRemaining === 0 && !flight && hits.length < activeTargets.length) {
      // §5.2: fail-with-restart. Re-seat stage state for another attempt.
      resetStageState()
    }
  }, [isStage3, shotsRemaining, flight, hits.length, activeTargets.length, resetStageState])

  // ─── Advance predicate ───────────────────────────────────────────────
  const canSubmit = isStage1
    ? shotCount >= 3 && distinctAngles.length >= 2 && v0Moved
    : hits.length === activeTargets.length && activeTargets.length > 0

  useEffect(() => {
    progress(stageIdx / 3, { stage: stageIdx, canSubmit })
  }, [stageIdx, canSubmit, progress])

  useReset(resetStageState)

  useNext(() => {
    if (stageIdx < 3) {
      setStage(stageIdx + 1)
      resetStageState()
    } else {
      complete({ success: true })
    }
  })

  // ─── Peek: strategy hint TEXT only (§5.2 rule 4) ─────────────────────
  const PEEK_TIPS = useMemo(
    () => [labels.peek_tip_radius, labels.peek_tip_centre, labels.peek_tip_geometry],
    [labels],
  )
  usePeek(() => {
    if (!isStage3) return
    const tip = PEEK_TIPS[peekIdx % PEEK_TIPS.length]!
    setPeekTip(tip)
    setPeekIdx((n) => n + 1)
  })
  useEffect(() => {
    if (!peekTip) return
    const t = setTimeout(() => setPeekTip(null), 5000)
    return () => clearTimeout(t)
  }, [peekTip])

  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  // ─── Emitter drag → angle ────────────────────────────────────────────
  const svgPoint = (e: React.PointerEvent) => {
    const el = svgRef.current
    if (!el) return null
    const rect = el.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) / rect.width) * W,
      y: ((e.clientY - rect.top) / rect.height) * H,
    }
  }
  const applyAngleFromPoint = (p: { x: number; y: number }) => {
    const dx = p.x - EMITTER.x
    const dy = EMITTER.y - p.y // invert y so up is positive
    if (dy <= 0 && Math.abs(dx) < 0.001) return
    let deg = (Math.atan2(dy, dx) * 180) / Math.PI
    if (deg < 0) deg = 0 // don't let the barrel dip below the horizon
    deg = Math.max(ANGLE_MIN_DEG, Math.min(ANGLE_MAX_DEG, deg))
    setAngleDeg(deg)
  }
  const emitterDown = (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragging(true)
    const p = svgPoint(e)
    if (p) applyAngleFromPoint(p)
  }
  const svgMove = (e: React.PointerEvent) => {
    if (!dragging) return
    const p = svgPoint(e)
    if (p) applyAngleFromPoint(p)
  }

  // ─── HUD text ─────────────────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const rMetres = v0 / OMEGA_C
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`
  const hudTR_line1 = `α = ${Math.round(angleDeg)}° · v₀ = ${Math.round(v0)} m/s`
  const hudTR_line2 = `r = ${rMetres.toFixed(1)} m`
  const hudBL = isStage3 && peekTip
    ? peekTip
    : isStage1
      ? labels.tip1
      : isStage2
        ? labels.tip2
        : labels.tip3

  // Preview circle: stage 2 only. Never on stage 3 (§5.2 rule 3).
  const showPreviewCircle = isStage2
  const previewD = showPreviewCircle ? circlePath(v0, angleRad) : ''

  // Current F direction (particle → centre) in SVG space, for stage-1
  // pedagogy only. World unit vector to centre = (-cos θ, -sin θ);
  // SVG flips y → (-cos θ, +sin θ).
  const fArrow = isStage1 && particle
    ? { fxu: -Math.cos(particle.theta), fyu: Math.sin(particle.theta) }
    : { fxu: 0, fyu: 0 }

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

        {/* Uniform magnetic field region — B out of page */}
        <FieldRegion x={FIELD.x} y={FIELD.y} width={FIELD.width} height={FIELD.height} />

        {/* Ground line — sits at emitter's z = 0 */}
        <line x1={0} y1={GROUND_Y} x2={W} y2={GROUND_Y} stroke="#3A4863" strokeWidth={1.5} />
        {Array.from({ length: 40 }).map((_, i) => (
          <line
            key={`h${i}`}
            x1={i * 22 + 6}
            y1={GROUND_Y + 2}
            x2={i * 22 - 6}
            y2={GROUND_Y + 10}
            stroke="#3A4863"
            strokeWidth={0.8}
          />
        ))}

        {/* Stage-1 trail: past 2–3 circular paths, fading. */}
        {isStage1 &&
          trail.map((t, i) => (
            <path
              key={i}
              d={circlePath(t.v0, t.angleRad)}
              fill="none"
              stroke="#F97316"
              strokeWidth={1.4}
              strokeDasharray="2 5"
              opacity={0.15 + i * 0.12}
            />
          ))}

        {/* Preview circle (stage 2 only). */}
        {previewD && (
          <path
            d={previewD}
            fill="none"
            stroke="#37C9B8"
            strokeWidth={1.6}
            strokeDasharray="4 5"
            opacity={0.6}
          />
        )}

        {/* Targets. On stage 3 label each with its (x, z) coordinates —
            required information per §4.7. */}
        {activeTargets.map((t) => (
          <g key={t.id}>
            <Target x={toSvgX(t.x)} y={toSvgY(t.z)} hit={hits.includes(t.id)} />
            {isStage3 && (
              <text
                x={toSvgX(t.x)}
                y={toSvgY(t.z) - 18}
                fill="#F9A968"
                fontFamily="'JetBrains Mono', monospace"
                fontSize={10}
                textAnchor="middle"
                style={{ userSelect: 'none' }}
              >
                ({t.x}, {t.z})
              </text>
            )}
          </g>
        ))}

        {/* Emitter (draggable to aim α). */}
        <g onPointerDown={emitterDown} style={{ cursor: dragging ? 'grabbing' : 'grab' }}>
          <Emitter x={EMITTER.x} y={EMITTER.y} angleRad={angleRad} />
        </g>

        {/* Live particle. F arrow only visible on stage 1 (help). */}
        {particle && particle.z >= 0 && (
          <Particle
            x={toSvgX(particle.x)}
            y={toSvgY(particle.z)}
            showF={isStage1}
            fxu={fArrow.fxu}
            fyu={fArrow.fyu}
          />
        )}

        {/* Field-strength annotation, top-left of field. */}
        <text
          x={FIELD.x + 12}
          y={FIELD.y + 20}
          fill="#37C9B8"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={11}
          style={{ userSelect: 'none' }}
        >
          {labels.field}
        </text>
        <text
          x={FIELD.x + 12}
          y={FIELD.y + 36}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={9}
          style={{ userSelect: 'none' }}
        >
          {labels.charge}
        </text>
      </svg>

      {/* HUD — HTML overlays in rem. TL / TR / BL only; BR reserved. */}
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

      {/* Stage-2 hits and stage-3 shot budget — under TL, not in BR. */}
      {(isStage2 || isStage3) && (
        <div
          style={{
            position: 'absolute',
            top: '7rem',
            left: '3rem',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '2rem',
            letterSpacing: '0.08em',
            color: isStage3 && shotsRemaining <= 1 ? '#F97316' : '#37C9B8',
            zIndex: 5,
            pointerEvents: 'none',
          }}
        >
          {isStage2
            ? `${labels.hits} ${hits.length}/${activeTargets.length}`
            : `${labels.hits} ${hits.length}/${activeTargets.length} · ${labels.shots} ${shotsRemaining}/${stage3TargetCount}`}
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
          textAlign: 'right',
        }}
      >
        <div>{hudTR_line1}</div>
        <div style={{ marginTop: '0.6rem', color: '#6C7A93', fontSize: '2rem' }}>{hudTR_line2}</div>
      </div>

      <div
        style={{
          position: 'absolute',
          bottom: '3rem',
          left: '3rem',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '2rem',
          letterSpacing: '0.06em',
          color: peekTip ? '#F9A968' : '#6C7A93',
          maxWidth: '55%',
          lineHeight: 1.35,
          zIndex: 5,
          pointerEvents: 'none',
        }}
      >
        {hudBL}
      </div>

      {/* v₀ slider — vertical (rotated -90°) on the right side. */}
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
            step={1}
            value={v0}
            onChange={(e) => {
              setV0(Number(e.target.value))
              setV0Moved(true)
            }}
            style={{
              width: '30rem',
              height: '2rem',
              transform: 'rotate(-90deg)',
              transformOrigin: 'center',
              accentColor: '#F97316',
              cursor: 'pointer',
            }}
          />
        </div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.9rem', color: '#6C7A93' }}>
          {V0_MIN}
        </div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.7rem', color: '#54617A' }}>
          v₀
        </div>
      </div>

      {/* Fire button. */}
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
          className="bi bi-crosshair"
          style={{ marginInlineEnd: '0.8rem', fontSize: '2.8rem', verticalAlign: '-0.2rem' }}
        />
        {labels.fire}
      </button>
    </div>
  )
}
