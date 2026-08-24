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
import { ElectronGun } from './art/ElectronGun'
import { Particle } from './art/Particle'
import { Plates } from './art/Plates'
import { Screen } from './art/Screen'
import { Target } from './art/Target'

// ─── Canvas ─────────────────────────────────────────────────────────────
const W = 800
const H = 450

// ─── Physics constants (SI where noted) ─────────────────────────────────
// q/m for the electron. Sign convention: we use POSITIVE (q/m) here and
// let the direction of E (i.e. the sign of U between plates) drive the
// deflection sign. Positive U ⇒ upper plate at higher potential ⇒ E points
// downward ⇒ force on electron points UP (y is "up" in physics coords).
const QOM = 1.76e11 // C·kg⁻¹
const L = 0.10 // m — plate length
const D = 0.10 // m — field-free region from plate exit to screen
const D_GAP = 0.04 // m — plate separation
const SCREEN_X_M = L + D // 0.20 m — horizontal position of the screen
const HIT_R_M = 0.005 // 5 mm — hit tolerance on the screen (meters)

// UI ranges
const V0_MIN = 1.5 // in units of 1e7 m/s (slider label)
const V0_MAX = 3.0
const V0_STEP = 0.05
const U_MIN = -300 // V
const U_MAX = 300 // V
const U_STEP = 5
const DEFAULT_V0 = 2.0
const DEFAULT_U = 0

// Sim tuning
const SPEED_FACTOR = 4e-8 // sim seconds per real-time second; the electron
// takes ~10 ns to cross the tube — this stretches it to ~250 ms so the
// student can see it happen.

// ─── SVG geometry ──────────────────────────────────────────────────────
// Physics x = 0 is the plate entry (= gun exit / particle spawn point).
// The gun art extends visually to the left of BEAM_START_X, into the black.
const BEAM_Y = 225 // SVG y of the beam axis
const BEAM_START_X = 190 // SVG x of physics x=0 (plate entry)
const PLATE_L_X = BEAM_START_X // 190
const PX_PER_M_X = 3000 // SVG units per meter (L=0.1m → 300 units)
const PLATE_R_X = PLATE_L_X + L * PX_PER_M_X // 490
const SCREEN_X_SVG = PLATE_L_X + SCREEN_X_M * PX_PER_M_X // 790
const PX_PER_M_Y = 3000 // 1 cm = 30 SVG units, 1 mm = 3 SVG units
const PLATE_TOP_Y = BEAM_Y - (D_GAP / 2) * PX_PER_M_Y // 225 - 60 = 165
const PLATE_BOT_Y = BEAM_Y + (D_GAP / 2) * PX_PER_M_Y // 285
const SCREEN_TOP_Y = 60
const SCREEN_BOT_Y = 390

// ─── Setups (seed-picked) ──────────────────────────────────────────────
// Each target lives on the screen at x = SCREEN_X_M. Y is given in cm so
// the on-screen coordinate label reads naturally. We store meters internally.
type TargetSpec = { id: string; yCm: number }
type Setup = { targets: TargetSpec[] }

// Stage 2 — live preview visible. Mix of signs and magnitudes.
const STAGE2_SETUPS: Setup[] = [
  { targets: [{ id: 's0a', yCm: +2.0 }, { id: 's0b', yCm: -1.0 }, { id: 's0c', yCm: +3.0 }] },
  { targets: [{ id: 's1a', yCm: -2.0 }, { id: 's1b', yCm: +1.5 }, { id: 's1c', yCm: -3.0 }] },
  { targets: [{ id: 's2a', yCm: +2.5 }, { id: 's2b', yCm: -2.0 }, { id: 's2c', yCm: 0.0 }] },
  { targets: [{ id: 's3a', yCm: -1.5 }, { id: 's3b', yCm: +3.0 }, { id: 's3c', yCm: -2.5 }] },
  { targets: [{ id: 's4a', yCm: +1.0 }, { id: 's4b', yCm: +2.5 }, { id: 's4c', yCm: -2.5 }] },
]

// Stage 3 — blind. Same shape; each Y is labeled on-screen as required info.
const STAGE3_SETUPS: Setup[] = [
  { targets: [{ id: 't0a', yCm: -2.0 }, { id: 't0b', yCm: +1.5 }, { id: 't0c', yCm: +3.0 }] },
  { targets: [{ id: 't1a', yCm: +2.5 }, { id: 't1b', yCm: -2.5 }, { id: 't1c', yCm: -1.0 }] },
  { targets: [{ id: 't2a', yCm: -3.0 }, { id: 't2b', yCm: +2.0 }, { id: 't2c', yCm: -1.5 }] },
  { targets: [{ id: 't3a', yCm: +2.0 }, { id: 't3b', yCm: -3.0 }, { id: 't3c', yCm: +1.0 }] },
  { targets: [{ id: 't4a', yCm: -2.0 }, { id: 't4b', yCm: +1.5 }, { id: 't4c', yCm: -2.5 }] },
]

const SHOT_BUDGET_STAGE3 = 3

// ─── Pure physics ──────────────────────────────────────────────────────
// Meters + real seconds. y > 0 = up.
function accel(u: number): number {
  return (QOM * u) / D_GAP // m·s⁻²
}

// Trajectory y(x) in meters. Returns null once the electron would leave
// the scene through a plate (|y| > d/2 while x ∈ [0, L]).
function trajectoryY(x: number, u: number, v0: number): number | null {
  const a = accel(u)
  if (x <= L) {
    const t = x / v0
    const y = 0.5 * a * t * t
    if (Math.abs(y) > D_GAP / 2) return null
    return y
  }
  const tL = L / v0
  const yExit = 0.5 * a * tL * tL
  if (Math.abs(yExit) > D_GAP / 2) return null
  const vyExit = a * tL
  return yExit + (vyExit / v0) * (x - L)
}

// Sample the trajectory for the SVG preview path. Stops on plate impact.
function trajectoryPoints(u: number, v0: number, xMax: number, steps = 60): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = []
  for (let i = 0; i <= steps; i++) {
    const x = (i / steps) * xMax
    const y = trajectoryY(x, u, v0)
    if (y === null) return pts
    pts.push({ x, y })
  }
  return pts
}

function trajectoryPath(u: number, v0: number): string {
  const pts = trajectoryPoints(u, v0, SCREEN_X_M)
  if (!pts.length) return ''
  return pts
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${toSvgX(p.x)} ${toSvgY(p.y)}`)
    .join(' ')
}

// Bracket: highest x reached before plate impact, if any.
function plateHitX(u: number, v0: number): number | null {
  const a = accel(u)
  if (a === 0) return null
  // Solve 0.5·a·(x/v0)² = ±d/2 for x
  const xHit = v0 * Math.sqrt(D_GAP / Math.abs(a))
  return xHit < L ? xHit : null
}

function screenY(u: number, v0: number): number | null {
  return trajectoryY(SCREEN_X_M, u, v0)
}

// ─── Coord conversion ─────────────────────────────────────────────────
function toSvgX(m: number): number {
  return BEAM_START_X + m * PX_PER_M_X
}
function toSvgY(m: number): number {
  // physics y is UP; SVG y grows downward
  return BEAM_Y - m * PX_PER_M_Y
}

// ─── Locale routing ────────────────────────────────────────────────────
const dict = { en } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── Component ────────────────────────────────────────────────────────
type Flight = { u: number; v0Real: number; startedAt: number }

export default function Scene() {
  const { locale, seed } = useInit()
  const stages = useMemo(() => getStagesFor(locale), [locale])
  useDeclareStages(stages)
  const labels = useMemo(() => svgLabels(locale), [locale])

  const setup2 = useMemo(() => STAGE2_SETUPS[seed % STAGE2_SETUPS.length]!, [seed])
  const [setup3Idx, setSetup3Idx] = useState(seed % STAGE3_SETUPS.length)
  const setup3 = STAGE3_SETUPS[setup3Idx]!

  const stageIdx = useCurrentStage()
  const setStage = useSetStage()

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  // ─── State ─────────────────────────────────────────────────────────
  const [u, setU] = useState(DEFAULT_U) // volts
  const [v0Slider, setV0Slider] = useState(DEFAULT_V0) // in 1e7 m/s
  const v0Real = v0Slider * 1e7 // m/s
  const [flight, setFlight] = useState<Flight | null>(null)
  const [particle, setParticle] = useState<{ x: number; y: number } | null>(null)
  const [hits, setHits] = useState<string[]>([])
  const [shotCount, setShotCount] = useState(0)
  const [distinctU, setDistinctU] = useState<number[]>([])
  const [v0Moved, setV0Moved] = useState(false)
  const [trail, setTrail] = useState<{ u: number; v0Real: number }[]>([])
  const [peekTip, setPeekTip] = useState<string | null>(null)
  const [shotsRemaining, setShotsRemaining] = useState(SHOT_BUDGET_STAGE3)
  const [screenHit, setScreenHit] = useState<{ y: number } | null>(null)
  const [plateBurn, setPlateBurn] = useState<{ x: number; y: number } | null>(null)

  const activeTargets = isStage2 ? setup2.targets : isStage3 ? setup3.targets : []

  const complete = useComplete()
  const progress = useProgress()

  // ─── Reset ─────────────────────────────────────────────────────────
  const resetStageState = useCallback(() => {
    setU(DEFAULT_U)
    setV0Slider(DEFAULT_V0)
    setFlight(null)
    setParticle(null)
    setHits([])
    setShotCount(0)
    setDistinctU([])
    setV0Moved(false)
    setTrail([])
    setPeekTip(null)
    setShotsRemaining(SHOT_BUDGET_STAGE3)
    setScreenHit(null)
    setPlateBurn(null)
  }, [])
  useReset(resetStageState)

  // ─── Fire ──────────────────────────────────────────────────────────
  const canFire = !flight && (!isStage3 || shotsRemaining > 0)
  const fire = useCallback(() => {
    if (!canFire) return
    setScreenHit(null)
    setPlateBurn(null)
    setFlight({ u, v0Real, startedAt: performance.now() })
    setShotCount((n) => n + 1)
    if (isStage3) setShotsRemaining((n) => n - 1)
    if (isStage1) {
      const bucket = Math.round(u / 100) * 100
      setDistinctU((prev) => (prev.includes(bucket) ? prev : [...prev, bucket]))
    }
  }, [canFire, u, v0Real, isStage1, isStage3])

  // ─── Ticker ────────────────────────────────────────────────────────
  useTicker(() => {
    if (!flight) return
    const tSimSec = ((performance.now() - flight.startedAt) / 1000) * SPEED_FACTOR
    const x = flight.v0Real * tSimSec
    // Reached screen?
    if (x >= SCREEN_X_M) {
      const yScreen = trajectoryY(SCREEN_X_M, flight.u, flight.v0Real)
      if (yScreen !== null) {
        setParticle({ x: SCREEN_X_M, y: yScreen })
        setScreenHit({ y: yScreen })
        // Hit test against targets (screen y only)
        const newlyHit: string[] = []
        for (const t of activeTargets) {
          if (hits.includes(t.id)) continue
          const dy = yScreen - t.yCm / 100
          if (Math.abs(dy) < HIT_R_M) newlyHit.push(t.id)
        }
        if (newlyHit.length) setHits((prev) => [...prev, ...newlyHit])
      }
      setFlight(null)
      if (isStage1) {
        setTrail((prev) => [...prev.slice(-2), { u: flight.u, v0Real: flight.v0Real }])
      }
      return
    }
    const y = trajectoryY(x, flight.u, flight.v0Real)
    if (y === null) {
      // Plate impact
      const xHit = plateHitX(flight.u, flight.v0Real)
      if (xHit !== null) {
        const a = accel(flight.u)
        const yHit = Math.sign(a) * (D_GAP / 2)
        setPlateBurn({ x: xHit, y: yHit })
        setParticle({ x: xHit, y: yHit })
      }
      setFlight(null)
      return
    }
    setParticle({ x, y })
  })

  // ─── Blind-stage fail (§5.2 rule 1) ────────────────────────────────
  useEffect(() => {
    if (!isStage3) return
    if (shotsRemaining === 0 && !flight && hits.length < activeTargets.length) {
      const nextIdx = (setup3Idx + 1) % STAGE3_SETUPS.length
      setSetup3Idx(nextIdx)
      resetStageState()
    }
  }, [isStage3, shotsRemaining, flight, hits.length, activeTargets.length, setup3Idx, resetStageState])

  // ─── Advance predicate ────────────────────────────────────────────
  const canSubmit = isStage1
    ? shotCount >= 3 && distinctU.length >= 2 && v0Moved
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

  // ─── Peek (strategy hint TEXT only — never the preview line) ──────
  const PEEK_TIPS = useMemo(
    () => [labels.peek_tip_scaling, labels.peek_tip_survives, labels.peek_tip_lever],
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
    const t = setTimeout(() => setPeekTip(null), 4500)
    return () => clearTimeout(t)
  }, [peekTip])

  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  // ─── Derived readouts ─────────────────────────────────────────────
  const yScreenNow = screenY(u, v0Real)
  const yExit = trajectoryY(L, u, v0Real)
  const willHitPlate = yExit === null

  // ─── HUD text ─────────────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`
  const uSign = u > 0 ? '+' : u < 0 ? '−' : ' '
  const hudTR = `U = ${uSign}${Math.abs(Math.round(u))} V · v₀ = ${v0Slider.toFixed(2)}×10⁷ m/s`
  const hudTR2 = isStage2
    ? `${labels.hits} ${hits.length}/${activeTargets.length}`
    : isStage3
      ? `${labels.hits} ${hits.length}/${activeTargets.length} · ${labels.shots} ${shotsRemaining}/${SHOT_BUDGET_STAGE3}`
      : yScreenNow !== null
        ? `Y = ${(yScreenNow * 100).toFixed(1)} cm`
        : `Y = — (plate hit)`
  const hudBL = isStage3 && peekTip
    ? peekTip
    : isStage1
      ? labels.tip1
      : isStage2
        ? labels.tip2
        : labels.tip3

  // Preview line is visible on stages 1–2 only. Blind stage: never.
  const showPreview = !isStage3
  const previewD = showPreview ? trajectoryPath(u, v0Real) : ''

  // Polarity sign for the plates art (0 → neutral rendering)
  const polarity = u === 0 ? 0 : u > 0 ? 1 : -1

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block', touchAction: 'none', userSelect: 'none' }}
      >
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        {/* Faint grid */}
        {Array.from({ length: 14 }).map((_, i) => (
          <line key={`gx${i}`} x1={i * 60} y1={0} x2={i * 60} y2={H} stroke="#12203a" strokeWidth={1} />
        ))}
        {Array.from({ length: 8 }).map((_, i) => (
          <line key={`gy${i}`} x1={0} y1={i * 60} x2={W} y2={i * 60} stroke="#12203a" strokeWidth={1} />
        ))}

        {/* Beam axis (very faint) */}
        <line x1={0} y1={BEAM_Y} x2={W} y2={BEAM_Y} stroke="#1F2A44" strokeWidth={1} strokeDasharray="1 6" />

        {/* Deflection plates */}
        <Plates
          x1={PLATE_L_X}
          x2={PLATE_R_X}
          yTop={PLATE_TOP_Y}
          yBot={PLATE_BOT_Y}
          polarity={polarity}
          labelTop={labels.plate_top}
          labelBot={labels.plate_bot}
        />

        {/* Stage 1 trail — fading dashed trajectories of recent shots */}
        {isStage1 &&
          trail.map((s, i) => (
            <path
              key={i}
              d={trajectoryPath(s.u, s.v0Real)}
              fill="none"
              stroke="#F97316"
              strokeWidth={1.4}
              strokeDasharray="2 5"
              opacity={0.18 + i * 0.14}
            />
          ))}

        {/* Live preview line (stages 1 + 2 only) */}
        {previewD && (
          <path
            d={previewD}
            fill="none"
            stroke={willHitPlate ? '#F97316' : '#37C9B8'}
            strokeWidth={1.6}
            strokeDasharray="4 5"
            opacity={0.75}
          />
        )}

        {/* Screen (with center tick markings) */}
        <Screen
          x={SCREEN_X_SVG}
          yTop={SCREEN_TOP_Y}
          yBot={SCREEN_BOT_Y}
          pxPerCm={PX_PER_M_Y / 100}
          yCenter={BEAM_Y}
          hitY={screenHit ? toSvgY(screenHit.y) : null}
        />

        {/* Screen label */}
        <text
          x={SCREEN_X_SVG}
          y={SCREEN_TOP_Y - 8}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={10}
          textAnchor="middle"
        >
          {labels.screen}
        </text>

        {/* Targets on the screen */}
        {activeTargets.map((t) => (
          <g key={t.id}>
            <Target x={SCREEN_X_SVG} y={toSvgY(t.yCm / 100)} hit={hits.includes(t.id)} />
            {isStage3 && (
              <text
                x={SCREEN_X_SVG - 12}
                y={toSvgY(t.yCm / 100) + 4}
                fill="#F9A968"
                fontFamily="'JetBrains Mono', monospace"
                fontSize={11}
                textAnchor="end"
              >
                Y = {t.yCm > 0 ? '+' : t.yCm < 0 ? '−' : ''}
                {Math.abs(t.yCm).toFixed(1)} cm
              </text>
            )}
          </g>
        ))}

        {/* Plate-impact burn mark */}
        {plateBurn && (
          <g transform={`translate(${toSvgX(plateBurn.x)} ${toSvgY(plateBurn.y)})`}>
            <circle cx={0} cy={0} r={5} fill="#F97316" opacity={0.6} />
            <circle cx={0} cy={0} r={2} fill="#F9A968" />
          </g>
        )}

        {/* Electron gun */}
        <ElectronGun x={BEAM_START_X} y={BEAM_Y} />

        {/* Live particle */}
        {particle && (
          <Particle x={toSvgX(particle.x)} y={toSvgY(particle.y)} />
        )}

        {/* Scene metadata (top-center, out of BR quadrant) */}
        <text
          x={W / 2}
          y={40}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={10}
          textAnchor="middle"
        >
          L = 10 cm · d = 4 cm · D = 10 cm · {labels.particle_electron}
        </text>
      </svg>

      {/* HUD — TL */}
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

      {/* HUD — TR (stacked: sliders + hits/shots or Y readout) */}
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
        {hudTR}
        <div style={{ marginTop: '0.6rem', color: '#6C7A93' }}>{hudTR2}</div>
      </div>

      {/* HUD — BL */}
      <div
        style={{
          position: 'absolute',
          bottom: '3rem',
          left: '3rem',
          maxWidth: '55%',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '2.1rem',
          letterSpacing: '0.06em',
          color: peekTip ? '#F9A968' : '#6C7A93',
          zIndex: 5,
          pointerEvents: 'none',
          lineHeight: 1.35,
        }}
      >
        {hudBL}
      </div>

      {/* NOTE: BR corner intentionally empty — reserved for host chrome. */}

      {/* U slider — vertical, right side. Signed: max at top, min at bottom,
          center at 0 (visually neutral). */}
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
          +{U_MAX}
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
            min={U_MIN}
            max={U_MAX}
            step={U_STEP}
            value={u}
            onChange={(e) => setU(Number(e.target.value))}
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
          {U_MIN}
        </div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.7rem', color: '#54617A' }}>
          {labels.voltage}
        </div>
      </div>

      {/* v₀ slider — vertical, left side. Same shape. */}
      <div
        style={{
          position: 'absolute',
          top: '14rem',
          left: '3rem',
          height: '38rem',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '1rem',
          zIndex: 6,
        }}
      >
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.9rem', color: '#6C7A93' }}>
          {V0_MAX.toFixed(1)}
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
            step={V0_STEP}
            value={v0Slider}
            onChange={(e) => {
              setV0Slider(Number(e.target.value))
              setV0Moved(true)
            }}
            style={{
              width: '30rem',
              height: '2rem',
              transform: 'rotate(-90deg)',
              transformOrigin: 'center',
              accentColor: '#37C9B8',
              cursor: 'pointer',
            }}
          />
        </div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.9rem', color: '#6C7A93' }}>
          {V0_MIN.toFixed(1)}
        </div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.7rem', color: '#54617A' }}>
          {labels.speed} (×10⁷)
        </div>
      </div>

      {/* Fire button — bottom-center, clear of both sliders + BR corner */}
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
