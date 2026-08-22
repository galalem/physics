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
  useTicker,
} from '@physics/sdk/react'
import { getHintFor, getStagesFor } from './stages'
import en from '../i18n/en.json'
import fr from '../i18n/fr.json'
import ar from '../i18n/ar.json'
import { Cannon } from './art/Cannon'
import { Projectile } from './art/Projectile'
import { Target } from './art/Target'
import { Wall } from './art/Wall'

// ─── Scene constants ────────────────────────────────────────────────────
const W = 800
const H = 450
const CANNON = { x: 80, y: 380 } // SVG pivot (wheel centre = barrel origin)
const GROUND_Y = CANNON.y
const PX_PER_M = 8 // equal x/y so parabolas render undistorted

// Physics constants (locked from textbook — see deep-dive)
const G = 9.81 // m/s²
const V0_MIN = 10
const V0_MAX = 30
const ANGLE_MIN_DEG = 5
const ANGLE_MAX_DEG = 88
const HIT_R_M = 2.2 // hit tolerance in meters
const SPEED_FACTOR = 2 // sim runs 2× real time (game feel)
const DEFAULT_ANGLE_DEG = 45
const DEFAULT_V0 = 20

type TargetSpec = { id: string; x: number; z: number }
type WallSpec = { x: number; width: number; height: number }
type Setup2 = { targets: TargetSpec[] }
type Setup3 = { targets: TargetSpec[]; wall: WallSpec }

// Stage 2 setups: 2 ground targets + 1 elevated. Seed-picked.
const STAGE2_SETUPS: Setup2[] = [
  { targets: [{ id: 's0a', x: 30, z: 0 }, { id: 's0b', x: 60, z: 0 }, { id: 's0c', x: 45, z: 15 }] },
  { targets: [{ id: 's1a', x: 25, z: 0 }, { id: 's1b', x: 70, z: 0 }, { id: 's1c', x: 50, z: 12 }] },
  { targets: [{ id: 's2a', x: 40, z: 0 }, { id: 's2b', x: 75, z: 0 }, { id: 's2c', x: 35, z: 20 }] },
  { targets: [{ id: 's3a', x: 35, z: 0 }, { id: 's3b', x: 65, z: 0 }, { id: 's3c', x: 55, z: 8 }] },
  { targets: [{ id: 's4a', x: 20, z: 0 }, { id: 's4b', x: 80, z: 0 }, { id: 's4c', x: 40, z: 18 }] },
]

// Stage 3 setups: 3 targets + a wall to clear.
const STAGE3_SETUPS: Setup3[] = [
  {
    targets: [{ id: 't0a', x: 30, z: 0 }, { id: 't0b', x: 65, z: 10 }, { id: 't0c', x: 25, z: 15 }],
    wall: { x: 40, width: 8, height: 12 },
  },
  {
    targets: [{ id: 't1a', x: 50, z: 0 }, { id: 't1b', x: 30, z: 15 }, { id: 't1c', x: 75, z: 5 }],
    wall: { x: 55, width: 6, height: 14 },
  },
  {
    targets: [{ id: 't2a', x: 40, z: 0 }, { id: 't2b', x: 70, z: 8 }, { id: 't2c', x: 20, z: 20 }],
    wall: { x: 45, width: 10, height: 10 },
  },
  {
    targets: [{ id: 't3a', x: 25, z: 0 }, { id: 't3b', x: 60, z: 12 }, { id: 't3c', x: 45, z: 18 }],
    wall: { x: 35, width: 7, height: 15 },
  },
  {
    targets: [{ id: 't4a', x: 35, z: 0 }, { id: 't4b', x: 80, z: 6 }, { id: 't4c', x: 50, z: 22 }],
    wall: { x: 60, width: 8, height: 13 },
  },
]

const dict = { en, fr, ar } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── Physics ↔ SVG helpers ──────────────────────────────────────────────
function toSvgX(m: number): number {
  return CANNON.x + m * PX_PER_M
}
function toSvgY(m: number): number {
  return CANNON.y - m * PX_PER_M
}

function positionAt(t: number, v0: number, angleRad: number): { x: number; z: number } {
  return {
    x: v0 * Math.cos(angleRad) * t,
    z: v0 * Math.sin(angleRad) * t - 0.5 * G * t * t,
  }
}

function sampleParabola(v0: number, angleRad: number, steps = 40): { x: number; z: number }[] {
  const T = (2 * v0 * Math.sin(angleRad)) / G
  if (T <= 0) return [{ x: 0, z: 0 }]
  const dt = T / steps
  const out: { x: number; z: number }[] = []
  for (let i = 0; i <= steps; i++) {
    const p = positionAt(i * dt, v0, angleRad)
    if (p.z < 0) break
    out.push(p)
  }
  return out
}

function parabolaPath(v0: number, angleRad: number): string {
  const pts = sampleParabola(v0, angleRad)
  if (!pts.length) return ''
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${toSvgX(p.x)} ${toSvgY(p.z)}`).join(' ')
}

function portee(v0: number, angleRad: number): number {
  return (v0 * v0 * Math.sin(2 * angleRad)) / G
}
function fleche(v0: number, angleRad: number): number {
  const s = Math.sin(angleRad)
  return (v0 * v0 * s * s) / (2 * G)
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
  const [angleDeg, setAngleDeg] = useState(DEFAULT_ANGLE_DEG)
  const [v0, setV0] = useState(DEFAULT_V0)
  const [flight, setFlight] = useState<Flight | null>(null)
  const [projectile, setProjectile] = useState<{ x: number; z: number } | null>(null)
  const [hits, setHits] = useState<string[]>([])
  const [shotCount, setShotCount] = useState(0)
  const [distinctAngles, setDistinctAngles] = useState<number[]>([])
  const [v0Moved, setV0Moved] = useState(false)
  const [trail, setTrail] = useState<{ angleRad: number; v0: number }[]>([])
  const [peekArc, setPeekArc] = useState(false)
  const [dragging, setDragging] = useState(false)

  const svgRef = useRef<SVGSVGElement>(null)
  const angleRad = (angleDeg * Math.PI) / 180

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  const activeTargets = isStage2 ? setup2.targets : isStage3 ? setup3.targets : []
  const activeWall = isStage3 ? setup3.wall : null

  const complete = useComplete()
  const progress = useProgress()
  const setStage = useSetStage()

  const resetStageState = useCallback(() => {
    setAngleDeg(DEFAULT_ANGLE_DEG)
    setV0(DEFAULT_V0)
    setFlight(null)
    setProjectile(null)
    setHits([])
    setShotCount(0)
    setDistinctAngles([])
    setV0Moved(false)
    setTrail([])
    setPeekArc(false)
  }, [])

  const fire = useCallback(() => {
    if (flight) return
    setFlight({ angleRad, v0, startedAt: performance.now() })
    setShotCount((n) => n + 1)
    const bucket = Math.round(angleDeg / 5) * 5
    setDistinctAngles((prev) => (prev.includes(bucket) ? prev : [...prev, bucket]))
  }, [flight, angleRad, v0, angleDeg])

  // ─── Simulation ticker ────────────────────────────────────────────────
  useTicker((dt) => {
    if (!flight) return
    const tSec = ((performance.now() - flight.startedAt) / 1000) * SPEED_FACTOR
    const p = positionAt(tSec, flight.v0, flight.angleRad)
    setProjectile(p)

    const newlyHit: string[] = []
    for (const t of activeTargets) {
      if (hits.includes(t.id)) continue
      if (Math.hypot(p.x - t.x, p.z - t.z) < HIT_R_M) newlyHit.push(t.id)
    }
    if (newlyHit.length) setHits((prev) => [...prev, ...newlyHit])

    if (activeWall) {
      const inX = p.x >= activeWall.x && p.x <= activeWall.x + activeWall.width
      const inZ = p.z >= 0 && p.z <= activeWall.height
      if (inX && inZ) {
        setFlight(null)
        return
      }
    }

    if (tSec > 0.05 && p.z <= 0) {
      setFlight(null)
      if (isStage1) {
        setTrail((prev) => [...prev.slice(-2), { angleRad: flight.angleRad, v0: flight.v0 }])
      }
    }
    void dt
  })

  // Advance rules
  const canSubmit = isStage1
    ? shotCount >= 3 && distinctAngles.length >= 2 && v0Moved
    : hits.length === activeTargets.length && activeTargets.length > 0

  const porteeM = portee(v0, angleRad)
  const flecheM = fleche(v0, angleRad)

  const readout = isStage1
    ? `portée = ${porteeM.toFixed(1)} m · flèche = ${flecheM.toFixed(1)} m`
    : isStage2
      ? `${labels.hits} ${hits.length}/${activeTargets.length} · portée = ${porteeM.toFixed(1)} m`
      : `${labels.hits} ${hits.length}/${activeTargets.length}`

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
    setPeekArc(true)
  })
  useEffect(() => {
    if (!peekArc) return
    const t = setTimeout(() => setPeekArc(false), 1500)
    return () => clearTimeout(t)
  }, [peekArc])

  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  // ─── Barrel drag → angle ─────────────────────────────────────────────
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
    const dx = p.x - CANNON.x
    const dy = CANNON.y - p.y // invert y so up is positive
    if (dx <= 0 && dy <= 0) return
    let deg = (Math.atan2(dy, dx) * 180) / Math.PI
    deg = Math.max(ANGLE_MIN_DEG, Math.min(ANGLE_MAX_DEG, deg))
    setAngleDeg(deg)
  }
  const cannonDown = (e: React.PointerEvent) => {
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

  // ─── Grid ─────────────────────────────────────────────────────────────
  const gridLines: React.ReactNode[] = []
  for (let gx = 40; gx < W; gx += 60) {
    gridLines.push(<line key={`gx${gx}`} x1={gx} y1={0} x2={gx} y2={H} stroke="#12203a" strokeWidth={1} />)
  }
  for (let gy = 40; gy < H; gy += 60) {
    gridLines.push(<line key={`gy${gy}`} x1={0} y1={gy} x2={W} y2={gy} stroke="#12203a" strokeWidth={1} />)
  }

  // ─── HUD text ─────────────────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`
  const hudTR = `α = ${Math.round(angleDeg)}° · v₀ = ${Math.round(v0)} m/s`
  const hudBL = isStage1 ? labels.tip1 : isStage2 ? labels.tip2 : labels.tip3
  const hudBR = isStage1
    ? `portée = ${porteeM.toFixed(1)} m · flèche = ${flecheM.toFixed(1)} m`
    : `${labels.hits} ${hits.length}/${activeTargets.length}`
  const hudBR2 = isStage2 ? `portée = ${porteeM.toFixed(1)} m · flèche = ${flecheM.toFixed(1)} m` : null

  const canFire = !flight
  const showPreviewArc = isStage2 || (isStage3 && peekArc)
  const previewD = showPreviewArc ? parabolaPath(v0, angleRad) : ''

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

        {isStage1 &&
          trail.map((t, i) => (
            <path
              key={i}
              d={parabolaPath(t.v0, t.angleRad)}
              fill="none"
              stroke="#F97316"
              strokeWidth={1.4}
              strokeDasharray="2 5"
              opacity={0.18 + i * 0.14}
            />
          ))}

        {previewD && (
          <path
            d={previewD}
            fill="none"
            stroke="#37C9B8"
            strokeWidth={1.6}
            strokeDasharray="4 5"
            opacity={0.7}
          />
        )}

        {activeWall && (
          <>
            <Wall
              x={toSvgX(activeWall.x)}
              y={toSvgY(activeWall.height)}
              width={activeWall.width * PX_PER_M}
              height={activeWall.height * PX_PER_M}
            />
            <text
              x={toSvgX(activeWall.x + activeWall.width / 2)}
              y={toSvgY(activeWall.height) - 6}
              fill="#B9C4D6"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
              textAnchor="middle"
            >
              h = {activeWall.height} m
            </text>
          </>
        )}

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
              >
                ({t.x}, {t.z})
              </text>
            )}
          </g>
        ))}

        <g onPointerDown={cannonDown} style={{ cursor: dragging ? 'grabbing' : 'grab' }}>
          <Cannon x={CANNON.x} y={CANNON.y} angleRad={angleRad} />
        </g>

        {projectile && projectile.z >= 0 && (
          <Projectile x={toSvgX(projectile.x)} y={toSvgY(projectile.z)} />
        )}

        <text
          x={W - 20}
          y={45}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={10}
          textAnchor="end"
        >
          g ↓ {G} m/s²
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
        {hudBR2 && <div style={{ marginTop: '0.6rem', color: '#6C7A93' }}>{hudBR2}</div>}
      </div>

      {/* v₀ slider — horizontal input rotated -90° so max is at top, drag-up = increase */}
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

      {/* Fire button */}
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
