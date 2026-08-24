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
import { Target } from './art/Target'
import { FieldGrid } from './art/FieldGrid'

// ─── Scene constants ────────────────────────────────────────────────────
const W = 800
const H = 450
const EMITTER = { x: 200, y: 225 } // SVG coords: particle exit aperture
const PX_PER_M = 7 // equal x/y so circles render undistorted

// Physics constants (simulation units — the on-screen slider values
// index into the same formula r = mv/(|q|B) with a fixed q/m ratio
// scaled so that r stays inside the visible canvas region).
//
// In sim units we take q/m = 1, so r = v / B and ω = B directly.
// v is presented as a proxy for particle speed (labelled "v"),
// B is presented in mT-scale.
const V_MIN = 10
const V_MAX = 60
const B_MIN = 3
const B_MAX = 15
const HIT_R_M = 1.4 // hit tolerance in meters (tight — circle passes through target once)
const SPEED_FACTOR = 1 // real-time sim
const DEFAULT_V = 30
const DEFAULT_B = 6

// Stage 3 shot budget = number of targets (one-shot-per-target rule, §5.2)
const STAGE3_TARGET_COUNT = 3

type TargetSpec = { id: string; x: number; y: number }
type Setup = { targets: TargetSpec[] }

// Stage 2 — 3 targets each; mix of q+ (target below initial line) and
// q− (target above). Radii within [V_MIN/B_MAX, V_MAX/B_MIN] = [~0.7, 20] m.
const STAGE2_SETUPS: Setup[] = [
  { targets: [{ id: 's0a', x: 10, y: -5 }, { id: 's0b', x: 15, y: -10 }, { id: 's0c', x: 18, y: -12 }] },
  { targets: [{ id: 's1a', x: 12, y: -8 }, { id: 's1b', x: 10, y: 8 }, { id: 's1c', x: 16, y: -14 }] },
  { targets: [{ id: 's2a', x: 8, y: -8 }, { id: 's2b', x: 10, y: -5 }, { id: 's2c', x: 14, y: -14 }] },
  { targets: [{ id: 's3a', x: 12, y: -6 }, { id: 's3b', x: 18, y: -16 }, { id: 's3c', x: 14, y: 10 }] },
  { targets: [{ id: 's4a', x: 10, y: 8 }, { id: 's4b', x: 15, y: 12 }, { id: 's4c', x: 12, y: -10 }] },
]

// Stage 3 — coordinates are LABELED on screen; radii cover different
// physical scenarios (mixed q sign; same-R different-q pairs; near-max R).
const STAGE3_SETUPS: Setup[] = [
  { targets: [{ id: 't0a', x: 12, y: -8 }, { id: 't0b', x: 16, y: -10 }, { id: 't0c', x: 10, y: 6 }] },
  { targets: [{ id: 't1a', x: 15, y: -12 }, { id: 't1b', x: 10, y: 8 }, { id: 't1c', x: 18, y: -16 }] },
  { targets: [{ id: 't2a', x: 8, y: 8 }, { id: 't2b', x: 14, y: -14 }, { id: 't2c', x: 16, y: 10 }] },
  { targets: [{ id: 't3a', x: 10, y: -5 }, { id: 't3b', x: 18, y: -12 }, { id: 't3c', x: 12, y: 9 }] },
  { targets: [{ id: 't4a', x: 12, y: 10 }, { id: 't4b', x: 16, y: -14 }, { id: 't4c', x: 14, y: 7 }] },
]

const dict = { en } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── Physics ↔ SVG helpers ──────────────────────────────────────────────
function toSvgX(m: number): number {
  return EMITTER.x + m * PX_PER_M
}
function toSvgY(m: number): number {
  // physics y is up; SVG y is down
  return EMITTER.y - m * PX_PER_M
}

function radius(v: number, B: number): number {
  return v / B
}
function omegaOf(B: number): number {
  // sim units: ω = |q|B/m with q/m = 1
  return B
}

// Position of the particle at time t (seconds since fire) — closed-form
// circular motion. s = qSign: +1 (q>0, curves DOWN on screen) or −1 (q<0, UP).
function positionAt(t: number, v: number, B: number, s: 1 | -1): { x: number; y: number } {
  const R = radius(v, B)
  const w = omegaOf(B)
  return {
    x: R * Math.sin(w * t),
    y: s * R * (Math.cos(w * t) - 1),
  }
}

// SVG circle representing the FULL trajectory for given (v, B, s).
function trajectoryCircle(v: number, B: number, s: 1 | -1) {
  const R = radius(v, B)
  return {
    cx: EMITTER.x, // physics x=0 → SVG x = EMITTER.x
    cy: EMITTER.y + s * R * PX_PER_M, // physics y=-s*R → SVG y = EMITTER.y - (-s*R)*PX_PER_M
    r: R * PX_PER_M,
  }
}

// ─── Component ──────────────────────────────────────────────────────────
type Flight = { v: number; B: number; qSign: 1 | -1; startedAt: number }

export default function Scene() {
  const { locale, seed } = useInit()
  const stages = useMemo(() => getStagesFor(locale), [locale])
  useDeclareStages(stages)
  const labels = useMemo(() => svgLabels(locale), [locale])

  const setup2 = useMemo(() => STAGE2_SETUPS[seed % STAGE2_SETUPS.length]!, [seed])

  const stageIdx = useCurrentStage()
  const setStage = useSetStage()

  const [v, setV] = useState(DEFAULT_V)
  const [B, setB] = useState(DEFAULT_B)
  const [qSign, setQSign] = useState<1 | -1>(1)
  const [flight, setFlight] = useState<Flight | null>(null)
  const [particle, setParticle] = useState<{ x: number; y: number } | null>(null)
  const [hits, setHits] = useState<string[]>([])
  const [shotCount, setShotCount] = useState(0)
  const [distinctB, setDistinctB] = useState<number[]>([])
  const [vMoved, setVMoved] = useState(false)
  const [trail, setTrail] = useState<{ v: number; B: number; qSign: 1 | -1 }[]>([])
  const [shotsRemaining, setShotsRemaining] = useState(STAGE3_TARGET_COUNT)
  const [setup3Idx, setSetup3Idx] = useState(seed % STAGE3_SETUPS.length)
  const [peekTip, setPeekTip] = useState<string | null>(null)

  const svgRef = useRef<SVGSVGElement>(null)

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  const setup3 = STAGE3_SETUPS[setup3Idx]!
  const activeTargets = isStage2 ? setup2.targets : isStage3 ? setup3.targets : []

  const complete = useComplete()
  const progress = useProgress()

  const R = radius(v, B)
  const omega = omegaOf(B)

  // ─── Reset ──────────────────────────────────────────────
  const resetStageState = useCallback(() => {
    setV(DEFAULT_V)
    setB(DEFAULT_B)
    setQSign(1)
    setFlight(null)
    setParticle(null)
    setHits([])
    setShotCount(0)
    setDistinctB([])
    setVMoved(false)
    setTrail([])
    setShotsRemaining(STAGE3_TARGET_COUNT)
    setPeekTip(null)
  }, [])
  useReset(resetStageState)

  // ─── Fire ───────────────────────────────────────────────
  const canFire = !flight && (!isStage3 || shotsRemaining > 0)
  const fire = useCallback(() => {
    if (!canFire) return
    setFlight({ v, B, qSign, startedAt: performance.now() })
    setShotCount((n) => n + 1)
    if (isStage3) setShotsRemaining((n) => n - 1)
    if (isStage1) {
      const bucket = Math.round(B)
      setDistinctB((prev) => (prev.includes(bucket) ? prev : [...prev, bucket]))
    }
  }, [canFire, v, B, qSign, isStage1, isStage3])

  // ─── Simulation ticker ──────────────────────────────────
  useTicker(() => {
    if (!flight) return
    const tSec = ((performance.now() - flight.startedAt) / 1000) * SPEED_FACTOR
    const p = positionAt(tSec, flight.v, flight.B, flight.qSign)
    setParticle(p)

    // Hit test — meter space
    const newlyHit: string[] = []
    for (const tg of activeTargets) {
      if (hits.includes(tg.id)) continue
      if (Math.hypot(p.x - tg.x, p.y - tg.y) < HIT_R_M) newlyHit.push(tg.id)
    }
    if (newlyHit.length) setHits((prev) => [...prev, ...newlyHit])

    // Terminate after one full revolution
    const period = (2 * Math.PI) / omegaOf(flight.B)
    if (tSec > period) {
      setFlight(null)
      if (isStage1) {
        setTrail((prev) => [
          ...prev.slice(-1),
          { v: flight.v, B: flight.B, qSign: flight.qSign },
        ])
      }
    }
  })

  // ─── Blind-stage fail (§5.2 — rotate to next setup) ─────
  useEffect(() => {
    if (!isStage3) return
    if (shotsRemaining === 0 && !flight && hits.length < activeTargets.length) {
      setSetup3Idx((idx) => (idx + 1) % STAGE3_SETUPS.length)
      setV(DEFAULT_V)
      setB(DEFAULT_B)
      setQSign(1)
      setFlight(null)
      setParticle(null)
      setHits([])
      setShotCount(0)
      setTrail([])
      setShotsRemaining(STAGE3_TARGET_COUNT)
      setPeekTip(null)
    }
  }, [isStage3, shotsRemaining, flight, hits.length, activeTargets.length])

  // ─── Advance predicate ──────────────────────────────────
  const canSubmit = isStage1
    ? shotCount >= 3 && distinctB.length >= 2 && vMoved
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

  // ─── Peek (blind-stage strategy hint — TEXT ONLY) ───────
  const PEEK_TIPS = useMemo(
    () => [labels.peek_tip_radius, labels.peek_tip_sign, labels.peek_tip_geometry],
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

  // ─── HUD text ───────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`
  const qStr = qSign === 1 ? '+e' : '−e'
  const hudTR1 = `v = ${v.toFixed(0)} · B = ${B.toFixed(0)} ${labels.b_unit} · q = ${qStr}`
  const hudTR2 = `r = ${R.toFixed(1)} m · ω = ${omega.toFixed(1)} rad/s`
  const hudBL = isStage3 && peekTip
    ? peekTip
    : isStage1
      ? labels.tip1
      : isStage2
        ? labels.tip2
        : labels.tip3
  // BR is reserved for parent chrome (fullscreen toggle) — do NOT overlay content there.

  // Preview circle: visible on stages 1 (live) and 2 (line-up). HIDDEN on stage 3 (§5.2).
  const showPreviewCircle = isStage1 || isStage2
  const preview = showPreviewCircle ? trajectoryCircle(v, B, qSign) : null

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
        {/* Background — NO rx, NO borderRadius */}
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        {/* B field region ("B out of page" dots ⊙) */}
        <rect
          x={40}
          y={40}
          width={W - 80}
          height={H - 80}
          fill="none"
          stroke="#1B2740"
          strokeWidth={1}
          strokeDasharray="3 3"
          rx={6}
        />
        <FieldGrid x={40} y={40} width={W - 80} height={H - 80} spacing={44} />

        {/* Baseline through emitter (initial velocity direction reference) */}
        <line
          x1={EMITTER.x - 4}
          y1={EMITTER.y}
          x2={W - 40}
          y2={EMITTER.y}
          stroke="#22314C"
          strokeWidth={1}
          strokeDasharray="1 4"
        />

        {/* Axis arrows at emitter (small) */}
        <g>
          <line
            x1={EMITTER.x + 6}
            y1={EMITTER.y}
            x2={EMITTER.x + 30}
            y2={EMITTER.y}
            stroke="#3A4863"
            strokeWidth={1}
            markerEnd="url(#axisArrow)"
          />
          <line
            x1={EMITTER.x}
            y1={EMITTER.y - 6}
            x2={EMITTER.x}
            y2={EMITTER.y - 30}
            stroke="#3A4863"
            strokeWidth={1}
            markerEnd="url(#axisArrow)"
          />
          <text
            x={EMITTER.x + 34}
            y={EMITTER.y + 3}
            fill="#6C7A93"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={9}
          >
            x
          </text>
          <text
            x={EMITTER.x - 3}
            y={EMITTER.y - 34}
            fill="#6C7A93"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={9}
            textAnchor="end"
          >
            y
          </text>
        </g>
        <defs>
          <marker id="axisArrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="#3A4863" />
          </marker>
        </defs>

        {/* Trail (stage 1) — last 1–2 shot circles, dashed + faint */}
        {isStage1 &&
          trail.map((tr, i) => {
            const c = trajectoryCircle(tr.v, tr.B, tr.qSign)
            const col = tr.qSign === 1 ? '#F97316' : '#37C9B8'
            return (
              <circle
                key={i}
                cx={c.cx}
                cy={c.cy}
                r={c.r}
                fill="none"
                stroke={col}
                strokeWidth={1.2}
                strokeDasharray="2 5"
                opacity={0.18 + i * 0.14}
              />
            )
          })}

        {/* Preview circle (stages 1 + 2 only — NEVER on stage 3) */}
        {preview && (
          <circle
            cx={preview.cx}
            cy={preview.cy}
            r={preview.r}
            fill="none"
            stroke={qSign === 1 ? '#F97316' : '#37C9B8'}
            strokeWidth={1.6}
            strokeDasharray="4 5"
            opacity={0.7}
          />
        )}

        {/* Targets */}
        {activeTargets.map((tg) => (
          <g key={tg.id}>
            <Target x={toSvgX(tg.x)} y={toSvgY(tg.y)} hit={hits.includes(tg.id)} />
            {isStage3 && (
              <text
                x={toSvgX(tg.x)}
                y={toSvgY(tg.y) - 18}
                fill="#F9A968"
                fontFamily="'JetBrains Mono', monospace"
                fontSize={10}
                textAnchor="middle"
              >
                ({tg.x}, {tg.y})
              </text>
            )}
          </g>
        ))}

        {/* Emitter */}
        <Emitter x={EMITTER.x} y={EMITTER.y} />

        {/* Particle in flight */}
        {particle && (
          <Particle x={toSvgX(particle.x)} y={toSvgY(particle.y)} sign={flight?.qSign ?? qSign} />
        )}

        {/* Static "B ⊙" corner label (top of scene, not in BR) */}
        <text
          x={W - 60}
          y={62}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={10}
          textAnchor="end"
        >
          B ⊙ {labels.b_out}
        </text>
      </svg>

      {/* HUD overlays — HTML in rem (font-size: 1vh) */}
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
        {isStage2 && (
          <div style={{ marginTop: '0.6rem', fontSize: '1.9rem', color: '#37C9B8' }}>
            {labels.hits} {hits.length}/{activeTargets.length}
          </div>
        )}
        {isStage3 && (
          <div style={{ marginTop: '0.6rem', fontSize: '1.9rem', color: '#37C9B8' }}>
            {labels.hits} {hits.length}/{activeTargets.length}
            <span style={{ marginInlineStart: '1.4rem', color: '#F97316' }}>
              {labels.shots} {shotsRemaining}/{STAGE3_TARGET_COUNT}
            </span>
          </div>
        )}
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
        {hudTR1}
        <div style={{ marginTop: '0.6rem', color: '#6C7A93', fontSize: '2rem' }}>{hudTR2}</div>
      </div>

      <div
        style={{
          position: 'absolute',
          bottom: '3rem',
          left: '3rem',
          maxWidth: '60rem',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '2.1rem',
          letterSpacing: '0.06em',
          color: peekTip && isStage3 ? '#F97316' : '#6C7A93',
          zIndex: 5,
          pointerEvents: 'none',
        }}
      >
        {hudBL}
      </div>
      {/* NO bottom-right overlay — reserved (§4.3) */}

      {/* v slider — LEFT side, rotated so top = higher v */}
      <div
        style={{
          position: 'absolute',
          top: '18rem',
          left: '3rem',
          height: '32rem',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '1rem',
          zIndex: 6,
        }}
      >
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.7rem', color: '#6C7A93' }}>
          {V_MAX}
        </div>
        <div
          style={{
            width: '2rem',
            height: '25rem',
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
            step={1}
            value={v}
            onChange={(e) => {
              setV(Number(e.target.value))
              setVMoved(true)
            }}
            style={{
              width: '25rem',
              height: '2rem',
              transform: 'rotate(-90deg)',
              transformOrigin: 'center',
              accentColor: '#37C9B8',
              cursor: 'pointer',
            }}
          />
        </div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.7rem', color: '#6C7A93' }}>
          {V_MIN}
        </div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.7rem', color: '#54617A' }}>
          v
        </div>
      </div>

      {/* B slider — RIGHT side, rotated so top = higher B */}
      <div
        style={{
          position: 'absolute',
          top: '18rem',
          right: '3rem',
          height: '32rem',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '1rem',
          zIndex: 6,
        }}
      >
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.7rem', color: '#6C7A93' }}>
          {B_MAX}
        </div>
        <div
          style={{
            width: '2rem',
            height: '25rem',
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <input
            type="range"
            min={B_MIN}
            max={B_MAX}
            step={1}
            value={B}
            onChange={(e) => setB(Number(e.target.value))}
            style={{
              width: '25rem',
              height: '2rem',
              transform: 'rotate(-90deg)',
              transformOrigin: 'center',
              accentColor: '#F97316',
              cursor: 'pointer',
            }}
          />
        </div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.7rem', color: '#6C7A93' }}>
          {B_MIN}
        </div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.7rem', color: '#54617A' }}>
          B
        </div>
      </div>

      {/* q-sign toggle — bottom-center-left, above the fire button */}
      <button
        type="button"
        onClick={() => setQSign((s) => (s === 1 ? -1 : 1))}
        disabled={!!flight}
        style={{
          position: 'absolute',
          bottom: '12rem',
          left: '50%',
          transform: 'translateX(-50%)',
          padding: '1rem 2.4rem',
          background: 'rgba(30,42,64,0.85)',
          color: qSign === 1 ? '#F97316' : '#37C9B8',
          border: `0.25rem solid ${qSign === 1 ? '#F97316' : '#37C9B8'}`,
          borderRadius: '100rem',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '2rem',
          fontWeight: 700,
          letterSpacing: '0.1em',
          cursor: flight ? 'not-allowed' : 'pointer',
          zIndex: 10,
          opacity: flight ? 0.5 : 1,
        }}
      >
        {labels.charge_sign}: {qSign === 1 ? '+e' : '−e'}
      </button>

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
          className="bi bi-lightning-charge-fill"
          style={{ marginInlineEnd: '0.8rem', fontSize: '2.8rem', verticalAlign: '-0.2rem' }}
        />
        {labels.fire}
      </button>
    </div>
  )
}
