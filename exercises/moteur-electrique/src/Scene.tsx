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
import { Magnets } from './art/Magnets'
import { Rotor } from './art/Rotor'
import { TargetAngle } from './art/TargetAngle'

// ─── Scene constants ────────────────────────────────────────────────────
const W = 800
const H = 450
const CENTER = { x: 400, y: 235 } // rotor pivot; slight downward bias leaves TL for HUD
const R_TIP = 130 // SVG units — radius of the coil-tip circle

// Physics constants (fixed — student calibrates from these to solve stage 3)
const N_TURNS = 100 // number of coil turns
const S_AREA = 5e-4 // m² (5 cm²)
const B_FIELD = 0.15 // T
const J_INERTIA = 1e-3 // kg·m² (rotational inertia of the coil assembly)
const NSB = N_TURNS * S_AREA * B_FIELD // 7.5e-3 — pre-multiplied constant
const M_COEFF = (2 * NSB) / Math.PI // average moment per amp of current

// DOF ranges
const I_MIN = 0.5 // A
const I_MAX = 5.0 // A
const THETA0_MIN_DEG = 10 // avoid the cos(θ₀) = 0 dead zone at 90°
const THETA0_MAX_DEG = 80
const DEFAULT_I = 2.0
const DEFAULT_THETA0_DEG = 45

// Simulation
const SIM_T_STAGE12 = 1.5 // seconds — fixed sweep window for stages 1 & 2
const SPEED_FACTOR = 1 // real-time (the motor is already lively at these currents)
const HIT_ANGLE_TOL = Math.PI / 12 // ±15° at t = t_target
const HIT_TIME_TOL = 0.1 // ±0.1 s window
const STAGE2_TARGET_TOL = Math.PI / 20 // ±9° for stage-2 "coil sweeps past" test

// Stage-3 shot budget
const SHOT_BUDGET_STAGE3 = 3

// ─── Setups (seed-picked) ───────────────────────────────────────────────
type Stage2Target = { id: string; theta: number }
type Stage3Target = { id: string; theta: number; t: number }

type Setup2 = { targets: Stage2Target[] }
type Setup3 = { target: Stage3Target }

// Stage-2 setups: 3 monotonically-increasing target angles from θ₀ = 0.
// Higher current sweeps a wider arc → student cranks I to reach the farthest one.
const STAGE2_SETUPS: Setup2[] = [
  {
    targets: [
      { id: 's0a', theta: 1.0 },
      { id: 's0b', theta: 2.6 },
      { id: 's0c', theta: 4.6 },
    ],
  },
  {
    targets: [
      { id: 's1a', theta: 0.8 },
      { id: 's1b', theta: 3.0 },
      { id: 's1c', theta: 5.5 },
    ],
  },
  {
    targets: [
      { id: 's2a', theta: 1.5 },
      { id: 's2b', theta: 3.6 },
      { id: 's2c', theta: 6.4 },
    ],
  },
  {
    targets: [
      { id: 's3a', theta: 1.2 },
      { id: 's3b', theta: 4.0 },
      { id: 's3c', theta: 7.4 },
    ],
  },
  {
    targets: [
      { id: 's4a', theta: 0.6 },
      { id: 's4b', theta: 2.0 },
      { id: 's4c', theta: 3.8 },
    ],
  },
]

// Stage-3 setups: single (θ_target, t_target). All solutions land inside [0.5, 5] A.
// θ₀ is forced to 0 on stage 3 so the student has exactly one DOF to compute.
// I_solution = π · J · θ_tgt / (N · S · B · t_tgt²).
const STAGE3_SETUPS: Setup3[] = [
  { target: { id: 't0', theta: Math.PI, t: 1.0 } }, // ≈ 1.32 A
  { target: { id: 't1', theta: 2 * Math.PI, t: 1.5 } }, // ≈ 1.17 A
  { target: { id: 't2', theta: 1.5 * Math.PI, t: 1.2 } }, // ≈ 1.37 A
  { target: { id: 't3', theta: Math.PI, t: 0.8 } }, // ≈ 2.06 A
  { target: { id: 't4', theta: 2.5 * Math.PI, t: 1.5 } }, // ≈ 1.46 A
]

// ─── Pure physics helpers (INLINE — average-torque model) ───────────────
// With the commutator the current sign flips at every half-turn so the
// torque τ(θ) = N·I·S·B·|cos(θ)| is π-periodic and strictly positive.
// Its average over one revolution is 2·N·I·S·B/π. Because that average is
// constant, integrating from rest gives closed-form kinematics.

function alphaAvg(i: number): number {
  return (M_COEFF * i) / J_INERTIA // rad/s²
}
function thetaAt(t: number, theta0: number, i: number): number {
  return theta0 + 0.5 * alphaAvg(i) * t * t
}
function omegaAt(t: number, i: number): number {
  return alphaAvg(i) * t
}

// Solve for the current that lands θ(t) = θ_tgt starting from θ = 0.
// Kept for reference / potential UI reveal; not used in the sim loop itself.
function currentForTarget(thetaTgt: number, tTgt: number): number {
  return (Math.PI * J_INERTIA * thetaTgt) / (NSB * tTgt * tTgt)
}

// SVG projection of a (theta, r) polar position.
function polarSvg(cx: number, cy: number, r: number, theta: number) {
  return { x: cx + r * Math.cos(theta), y: cy - r * Math.sin(theta) }
}

// Sample the sweep-arc as an SVG polyline path (M x0 y0 L x1 y1 …).
// Used for preview (stage 1 & 2) and trail (stage 1). Steps = 32 points.
function sweepPath(theta0: number, i: number, T: number, steps = 32): string {
  const parts: string[] = []
  for (let k = 0; k <= steps; k++) {
    const t = (k / steps) * T
    const th = thetaAt(t, theta0, i)
    const p = polarSvg(CENTER.x, CENTER.y, R_TIP, th)
    parts.push(`${k === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
  }
  return parts.join(' ')
}

// ─── Label loader ───────────────────────────────────────────────────────
const dict = { en } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── Component ──────────────────────────────────────────────────────────
type Flight = { theta0: number; i: number; startedAt: number }

export default function Scene() {
  const { locale, seed } = useInit()
  const stages = useMemo(() => getStagesFor(locale), [locale])
  useDeclareStages(stages)
  const labels = useMemo(() => svgLabels(locale), [locale])

  const setup2 = useMemo(() => STAGE2_SETUPS[seed % STAGE2_SETUPS.length]!, [seed])
  // Stage 3 setup rotates with each fail-restart. We seed the offset here and
  // bump it with `stage3Rotation` when the student busts the shot budget.
  const [stage3Rotation, setStage3Rotation] = useState(0)
  const setup3 = useMemo(
    () => STAGE3_SETUPS[(seed + stage3Rotation) % STAGE3_SETUPS.length]!,
    [seed, stage3Rotation],
  )

  const stageIdx = useCurrentStage()
  const setStage = useSetStage()

  // ─── State ────────────────────────────────────────────────────────────
  const [current, setCurrent] = useState(DEFAULT_I)
  const [theta0Deg, setTheta0Deg] = useState(DEFAULT_THETA0_DEG)
  const [flight, setFlight] = useState<Flight | null>(null)
  const [rotorAngle, setRotorAngle] = useState(0) // live θ during flight (rad)
  const [hits, setHits] = useState<string[]>([])
  const [shotCount, setShotCount] = useState(0)
  const [distinctCurrents, setDistinctCurrents] = useState<number[]>([])
  const [theta0Moved, setTheta0Moved] = useState(false)
  const [trail, setTrail] = useState<{ theta0: number; i: number }[]>([])
  const [peekTip, setPeekTip] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [shotsRemaining, setShotsRemaining] = useState(SHOT_BUDGET_STAGE3)
  const [stage3Result, setStage3Result] = useState<'hit' | 'miss' | null>(null)

  const svgRef = useRef<SVGSVGElement>(null)
  const theta0Rad = (theta0Deg * Math.PI) / 180

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3
  // Stage 3 pins θ₀ = 0 so there's a single DOF to solve for.
  const effectiveTheta0 = isStage3 ? 0 : theta0Rad
  const activeTargets = isStage2 ? setup2.targets : []
  const stage3Target = isStage3 ? setup3.target : null

  const complete = useComplete()
  const progress = useProgress()

  // ─── Reset ────────────────────────────────────────────────────────────
  const resetStageState = useCallback(() => {
    setCurrent(DEFAULT_I)
    setTheta0Deg(DEFAULT_THETA0_DEG)
    setFlight(null)
    setRotorAngle(0)
    setHits([])
    setShotCount(0)
    setDistinctCurrents([])
    setTheta0Moved(false)
    setTrail([])
    setPeekTip(null)
    setShotsRemaining(SHOT_BUDGET_STAGE3)
    setStage3Result(null)
  }, [])
  useReset(resetStageState)

  // Reset when the SDK changes the stage from outside.
  useEffect(() => {
    resetStageState()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageIdx])

  // ─── Fire ─────────────────────────────────────────────────────────────
  const canFire = !flight && (!isStage3 || (shotsRemaining > 0 && stage3Result !== 'hit'))
  const fire = useCallback(() => {
    if (!canFire) return
    const usedTheta0 = effectiveTheta0
    setFlight({ theta0: usedTheta0, i: current, startedAt: performance.now() })
    setRotorAngle(usedTheta0)
    setShotCount((n) => n + 1)
    if (isStage3) setShotsRemaining((n) => n - 1)
    if (isStage1) {
      const bucket = Math.round(current * 2) / 2 // 0.5-A buckets
      setDistinctCurrents((prev) => (prev.includes(bucket) ? prev : [...prev, bucket]))
    }
  }, [canFire, effectiveTheta0, current, isStage1, isStage3])

  // ─── Simulation ticker (closed-form, average-torque) ──────────────────
  useTicker(() => {
    if (!flight) return
    const tSecReal = (performance.now() - flight.startedAt) / 1000
    const tSec = tSecReal * SPEED_FACTOR
    const simEnd = isStage3
      ? (stage3Target?.t ?? SIM_T_STAGE12) + 0.5 // let the coil overshoot briefly on stage 3
      : SIM_T_STAGE12

    const theta = thetaAt(tSec, flight.theta0, flight.i)
    setRotorAngle(theta)

    // Stage-2 sweep-through hit test: if the coil's θ has now passed a
    // target angle by less than STAGE2_TARGET_TOL, count it hit.
    if (isStage2) {
      const newlyHit: string[] = []
      for (const t of activeTargets) {
        if (hits.includes(t.id)) continue
        if (theta >= t.theta - STAGE2_TARGET_TOL) newlyHit.push(t.id)
      }
      if (newlyHit.length) setHits((prev) => [...prev, ...newlyHit])
    }

    if (tSec >= simEnd) {
      // Stage-3 hit test: angle at t_target within ±15°.
      if (isStage3 && stage3Target && stage3Result === null) {
        const thetaAtT = thetaAt(stage3Target.t, flight.theta0, flight.i)
        const dAngle = Math.abs(thetaAtT - stage3Target.theta)
        // Also allow the tolerance in time if the student is close but early.
        const closeEnough = dAngle <= HIT_ANGLE_TOL
        if (closeEnough) {
          setStage3Result('hit')
          setHits([stage3Target.id])
        }
      }
      setFlight(null)
      if (isStage1) {
        setTrail((prev) => [...prev.slice(-2), { theta0: flight.theta0, i: flight.i }])
      }
      // Freeze rotor at final position so student can read the outcome.
    }

    // Time-tolerance early hit: if we're inside the ±HIT_TIME_TOL window
    // around t_target on stage 3, accept as soon as the angle passes.
    if (isStage3 && stage3Target && stage3Result === null) {
      const dt = Math.abs(tSec - stage3Target.t)
      if (dt <= HIT_TIME_TOL) {
        const dAngle = Math.abs(theta - stage3Target.theta)
        if (dAngle <= HIT_ANGLE_TOL) {
          setStage3Result('hit')
          setHits([stage3Target.id])
        }
      }
    }
  })

  // ─── Blind-stage fail-with-restart ────────────────────────────────────
  useEffect(() => {
    if (!isStage3) return
    if (stage3Result === 'hit') return
    if (flight) return
    if (shotsRemaining === 0) {
      // Bust — rotate to a fresh setup and refill the shot budget.
      const timer = setTimeout(() => {
        setStage3Rotation((r) => r + 1)
        setShotsRemaining(SHOT_BUDGET_STAGE3)
        setHits([])
        setStage3Result(null)
        setCurrent(DEFAULT_I)
      }, 1000)
      return () => clearTimeout(timer)
    }
    return
  }, [isStage3, stage3Result, flight, shotsRemaining])

  // ─── Advance predicate ────────────────────────────────────────────────
  const canSubmit = isStage1
    ? shotCount >= 3 && distinctCurrents.length >= 2 && theta0Moved
    : isStage2
      ? hits.length === activeTargets.length && activeTargets.length > 0
      : stage3Result === 'hit'

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

  // ─── Peek (strategy hint text — NEVER the arc) ────────────────────────
  const PEEK_TIPS = useMemo(
    () => [labels.peek_tip_avg, labels.peek_tip_formula, labels.peek_tip_scaling],
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
    const timer = setTimeout(() => setPeekTip(null), 4500)
    return () => clearTimeout(timer)
  }, [peekTip])

  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  // ─── Rotor drag → θ₀ ──────────────────────────────────────────────────
  const svgPoint = (e: React.PointerEvent) => {
    const el = svgRef.current
    if (!el) return null
    const rect = el.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) / rect.width) * W,
      y: ((e.clientY - rect.top) / rect.height) * H,
    }
  }
  const applyTheta0FromPoint = (p: { x: number; y: number }) => {
    if (isStage3) return // θ₀ is locked on the blind stage
    const dx = p.x - CENTER.x
    const dy = CENTER.y - p.y
    const deg = (Math.atan2(dy, dx) * 180) / Math.PI
    setTheta0Deg(Math.max(THETA0_MIN_DEG, Math.min(THETA0_MAX_DEG, deg)))
    setTheta0Moved(true)
  }
  const rotorDown = (e: React.PointerEvent) => {
    if (flight || isStage3) return
    e.preventDefault()
    e.stopPropagation()
    setDragging(true)
    const p = svgPoint(e)
    if (p) applyTheta0FromPoint(p)
  }
  const svgMove = (e: React.PointerEvent) => {
    if (!dragging) return
    const p = svgPoint(e)
    if (p) applyTheta0FromPoint(p)
  }

  // ─── Grid backdrop ────────────────────────────────────────────────────
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

  // ─── HUD strings ──────────────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const thetaShown = flight
    ? rotorAngle
    : isStage3
      ? 0
      : theta0Rad
  const omegaShown = flight
    ? omegaAt((performance.now() - flight.startedAt) / 1000, flight.i)
    : 0
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`
  const thetaDegShown = ((thetaShown * 180) / Math.PI).toFixed(0)
  const iShown = current.toFixed(1)
  const hudTR = isStage3
    ? `I = ${iShown} A · ω = ${omegaShown.toFixed(1)} rad/s`
    : `θ = ${thetaDegShown}° · I = ${iShown} A`
  const hudBL = isStage3 && peekTip
    ? peekTip
    : isStage1
      ? labels.tip1
      : isStage2
        ? labels.tip2
        : labels.tip3

  // Auxiliary TL / TR line for stage state
  const hitsLine = isStage2
    ? `${labels.hits} ${hits.length}/${activeTargets.length}`
    : isStage3
      ? `${labels.shots} ${shotsRemaining}/${SHOT_BUDGET_STAGE3}`
      : null

  // ─── Preview arc (stages 1 & 2 only — NEVER stage 3) ──────────────────
  const showPreview = isStage1 || isStage2
  const previewD = showPreview && !flight
    ? sweepPath(effectiveTheta0, current, SIM_T_STAGE12)
    : ''

  // ─── Rotor visual: full circle path for target ring ───────────────────
  const ringD = `M ${CENTER.x + R_TIP} ${CENTER.y}
                 A ${R_TIP} ${R_TIP} 0 1 0 ${CENTER.x - R_TIP} ${CENTER.y}
                 A ${R_TIP} ${R_TIP} 0 1 0 ${CENTER.x + R_TIP} ${CENTER.y}`

  // Stage-3 target label like "θ = 180° · t = 1.0 s"
  const stage3TargetLabel = stage3Target
    ? `θ = ${Math.round((stage3Target.theta * 180) / Math.PI)}° · t = ${stage3Target.t.toFixed(1)} s`
    : ''

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
        {/* NO borderRadius on <svg>. NO rx on the bg <rect>. */}
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />
        {gridLines}

        {/* Magnets + field arrows */}
        <Magnets cx={CENTER.x} cy={CENTER.y} R={R_TIP} nLabel={labels.np} sLabel={labels.sp} />

        {/* Tip-circle guide (dashed) */}
        <path
          d={ringD}
          fill="none"
          stroke="#2A3244"
          strokeWidth={1.4}
          strokeDasharray="3 4"
          opacity={0.7}
        />

        {/* Stage-1 trail (last 2 sweeps, fading) */}
        {isStage1 &&
          trail.map((t, i) => (
            <path
              key={`trail${i}`}
              d={sweepPath(t.theta0, t.i, SIM_T_STAGE12)}
              fill="none"
              stroke="#F97316"
              strokeWidth={2}
              strokeDasharray="2 5"
              opacity={0.18 + i * 0.14}
            />
          ))}

        {/* Preview arc (stages 1 & 2 only) */}
        {previewD && (
          <path
            d={previewD}
            fill="none"
            stroke="#37C9B8"
            strokeWidth={2}
            strokeDasharray="4 5"
            opacity={0.75}
          />
        )}

        {/* Stage-2 target markers (bullseyes on the ring) */}
        {isStage2 &&
          activeTargets.map((t) => (
            <TargetAngle
              key={t.id}
              cx={CENTER.x}
              cy={CENTER.y}
              R={R_TIP}
              theta={t.theta}
              hit={hits.includes(t.id)}
            />
          ))}

        {/* Stage-3 single target with coord label (required info) */}
        {isStage3 && stage3Target && (
          <TargetAngle
            cx={CENTER.x}
            cy={CENTER.y}
            R={R_TIP}
            theta={stage3Target.theta}
            hit={stage3Result === 'hit'}
            label={stage3TargetLabel}
          />
        )}

        {/* Rotor — draggable to set θ₀ (stages 1 & 2 only). */}
        <g
          onPointerDown={rotorDown}
          style={{ cursor: isStage3 ? 'default' : flight ? 'default' : dragging ? 'grabbing' : 'grab' }}
        >
          <Rotor cx={CENTER.x} cy={CENTER.y} R={R_TIP} angleRad={thetaShown} live={!!flight} />
        </g>

        {/* Constants readout, top-left of scene area */}
        <text
          x={16}
          y={H - 12}
          fill="#54617A"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={10}
        >
          J = 10⁻³ kg·m² · {labels.field}
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
        {hitsLine && (
          <div style={{ marginTop: '0.6rem', color: '#37C9B8', letterSpacing: '0.08em' }}>
            {hitsLine}
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
          zIndex: 5,
          pointerEvents: 'none',
          textAlign: 'right',
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
          color: peekTip ? '#F9A968' : '#6C7A93',
          zIndex: 5,
          pointerEvents: 'none',
          maxWidth: '55rem',
        }}
      >
        {hudBL}
      </div>

      {/* BR is reserved for parent-side chrome — do NOT add a BR overlay. */}

      {/* I slider (right side of canvas) */}
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
        <div
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '1.9rem',
            color: '#6C7A93',
          }}
        >
          {I_MAX.toFixed(1)}
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
            min={I_MIN}
            max={I_MAX}
            step={0.1}
            value={current}
            onChange={(e) => setCurrent(Number(e.target.value))}
            disabled={!!flight}
            style={{
              width: '30rem',
              height: '2rem',
              transform: 'rotate(-90deg)',
              transformOrigin: 'center',
              accentColor: '#F97316',
              cursor: flight ? 'not-allowed' : 'pointer',
            }}
          />
        </div>
        <div
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '1.9rem',
            color: '#6C7A93',
          }}
        >
          {I_MIN.toFixed(1)}
        </div>
        <div
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '1.7rem',
            color: '#54617A',
          }}
        >
          {labels.current} (A)
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
          className="bi bi-lightning-charge-fill"
          style={{ marginInlineEnd: '0.8rem', fontSize: '2.8rem', verticalAlign: '-0.2rem' }}
        />
        {labels.fire}
      </button>
    </div>
  )
}

// currentForTarget stays exported to the module scope for reference; silence
// an unused-symbol warning without stripping the helpful documentation.
void currentForTarget
