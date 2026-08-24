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
import { Block } from './art/Block'
import { Target } from './art/Target'
import { ForceArrow } from './art/ForceArrow'

// ─── Scene constants ────────────────────────────────────────────────────
const W = 800
const H = 450
const ORIGIN = { x: 80, y: 340 } // crate rest position on the ground
const GROUND_Y = ORIGIN.y
const PX_PER_M = 8 // metres → SVG units (max useful reach ~76 m ≈ 608 SVG)

// Physics constants (locked from the JSON handoff)
const F_APPLIED_MIN = 10 // N
const F_APPLIED_MAX = 100
const F_APPLIED_STEP = 2
const M_MIN = 1 // kg
const M_MAX = 10
const M_STEP = 1
const F_FRICTION = 5 // N — constant kinetic friction along the track
const T_SIM = 2.0 // s — burst duration
const HIT_R_M = 2.0 // metres — landing tolerance
const SPEED_FACTOR = 0.6 // wall-clock slowdown so the sim is watchable
const DEFAULT_F = 40
const DEFAULT_M = 4
const SHOT_BUDGET_STAGE3 = 3 // one shot per flag on the blind stage

// Force-arrow visual scale (SVG px per Newton)
const ARROW_SCALE = 0.55

// ─── Setups (seed-picked) ───────────────────────────────────────────────
type TargetSpec = { id: string; x: number }
type Setup = { targets: TargetSpec[] }

// Stage 2 setups: 3 flags. Each x is even so an exact-integer (F, m) combo exists.
const STAGE2_SETUPS: Setup[] = [
  { targets: [{ id: 's0a', x: 12 }, { id: 's0b', x: 30 }, { id: 's0c', x: 54 }] },
  { targets: [{ id: 's1a', x: 18 }, { id: 's1b', x: 40 }, { id: 's1c', x: 60 }] },
  { targets: [{ id: 's2a', x: 8 }, { id: 's2b', x: 24 }, { id: 's2c', x: 50 }] },
  { targets: [{ id: 's3a', x: 14 }, { id: 's3b', x: 36 }, { id: 's3c', x: 62 }] },
  { targets: [{ id: 's4a', x: 20 }, { id: 's4b', x: 42 }, { id: 's4c', x: 66 }] },
]

// Stage 3 setups: 3 flags, tighter spacing and at least one far reach.
// Blind-stage philosophy: each setup requires computing (F, m) — the ideal
// combo differs per flag, so a single-slider sweep can't clear the set.
const STAGE3_SETUPS: Setup[] = [
  { targets: [{ id: 't0a', x: 10 }, { id: 't0b', x: 28 }, { id: 't0c', x: 56 }] },
  { targets: [{ id: 't1a', x: 16 }, { id: 't1b', x: 34 }, { id: 't1c', x: 64 }] },
  { targets: [{ id: 't2a', x: 12 }, { id: 't2b', x: 38 }, { id: 't2c', x: 68 }] },
  { targets: [{ id: 't3a', x: 8 }, { id: 't3b', x: 44 }, { id: 't3c', x: 72 }] },
  { targets: [{ id: 't4a', x: 22 }, { id: 't4b', x: 46 }, { id: 't4c', x: 70 }] },
]

const dict = { en } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── Pure physics ───────────────────────────────────────────────────────
function accelOf(F: number, m: number): number {
  return (F - F_FRICTION) / m
}
function xFinalOf(F: number, m: number): number {
  const a = accelOf(F, m)
  return Math.max(0, 0.5 * a * T_SIM * T_SIM)
}
function positionAt(t: number, a: number): { x: number; v: number } {
  const tt = Math.max(0, Math.min(t, T_SIM))
  return {
    x: 0.5 * a * tt * tt,
    v: a * tt,
  }
}

// Physics ↔ SVG helpers
function toSvgX(m: number): number {
  return ORIGIN.x + m * PX_PER_M
}

// ─── Component ──────────────────────────────────────────────────────────
type Flight = { F: number; m: number; a: number; startedAt: number }

export default function Scene() {
  const { locale, seed } = useInit()
  const stages = useMemo(() => getStagesFor(locale), [locale])
  useDeclareStages(stages)
  const labels = useMemo(() => svgLabels(locale), [locale])

  const setup2 = useMemo(() => STAGE2_SETUPS[seed % STAGE2_SETUPS.length]!, [seed])

  const stageIdx = useCurrentStage()
  const setStage = useSetStage()

  // ─── State ────────────────────────────────────────────────────────────
  const [F, setF] = useState(DEFAULT_F)
  const [m, setM] = useState(DEFAULT_M)
  const [flight, setFlight] = useState<Flight | null>(null)
  const [blockPos, setBlockPos] = useState(0) // metres from origin
  const [blockVel, setBlockVel] = useState(0) // m/s
  const [hits, setHits] = useState<string[]>([])
  const [shotCount, setShotCount] = useState(0)
  const [distinctF, setDistinctF] = useState<number[]>([])
  const [mMoved, setMMoved] = useState(false)
  const [peekTip, setPeekTip] = useState<string | null>(null)
  const [shotsRemaining, setShotsRemaining] = useState(SHOT_BUDGET_STAGE3)
  const [stage3SetupIdx, setStage3SetupIdx] = useState(seed % STAGE3_SETUPS.length)
  const peekIdxRef = useRef(0)

  const setup3 = STAGE3_SETUPS[stage3SetupIdx]!

  const svgRef = useRef<SVGSVGElement>(null)

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3
  const activeTargets = isStage2 ? setup2.targets : isStage3 ? setup3.targets : []

  const complete = useComplete()
  const progress = useProgress()

  // ─── Reset ────────────────────────────────────────────────────────────
  const resetStageState = useCallback(() => {
    setF(DEFAULT_F)
    setM(DEFAULT_M)
    setFlight(null)
    setBlockPos(0)
    setBlockVel(0)
    setHits([])
    setShotCount(0)
    setDistinctF([])
    setMMoved(false)
    setPeekTip(null)
    setShotsRemaining(SHOT_BUDGET_STAGE3)
  }, [])
  useReset(resetStageState)

  // ─── Fire ─────────────────────────────────────────────────────────────
  const canFire = !flight && (!isStage3 || shotsRemaining > 0)
  const fire = useCallback(() => {
    if (!canFire) return
    const a = accelOf(F, m)
    setFlight({ F, m, a, startedAt: performance.now() })
    setShotCount((n) => n + 1)
    if (isStage3) setShotsRemaining((n) => n - 1)
    if (isStage1) {
      const bucket = Math.round(F / 10) * 10
      setDistinctF((prev) => (prev.includes(bucket) ? prev : [...prev, bucket]))
    }
  }, [canFire, F, m, isStage1, isStage3])

  // ─── Simulation ticker ────────────────────────────────────────────────
  useTicker((dt) => {
    if (!flight) return
    const tSec = ((performance.now() - flight.startedAt) / 1000) * SPEED_FACTOR
    if (tSec >= T_SIM) {
      // Landing tick: freeze at x_final and score against the nearest unhit flag.
      const xFinal = xFinalOf(flight.F, flight.m)
      setBlockPos(xFinal)
      setBlockVel(0)
      let bestId: string | null = null
      let bestDist = HIT_R_M
      for (const t of activeTargets) {
        if (hits.includes(t.id)) continue
        const d = Math.abs(xFinal - t.x)
        if (d < bestDist) {
          bestDist = d
          bestId = t.id
        }
      }
      if (bestId) setHits((prev) => [...prev, bestId!])
      setFlight(null)
      return
    }
    const p = positionAt(tSec, flight.a)
    setBlockPos(p.x)
    setBlockVel(p.v)
    void dt
  })

  // ─── Blind-stage fail (§5.2 rotate to next setup) ─────────────────────
  useEffect(() => {
    if (!isStage3) return
    if (shotsRemaining === 0 && !flight && hits.length < activeTargets.length) {
      setStage3SetupIdx((prev) => (prev + 1) % STAGE3_SETUPS.length)
      // Delay the state reset so the setup change and shot budget reset don't fight each other
      const id = setTimeout(() => {
        resetStageState()
      }, 900)
      return () => clearTimeout(id)
    }
    return
  }, [isStage3, shotsRemaining, flight, hits.length, activeTargets.length, resetStageState])

  // ─── Advance predicate ────────────────────────────────────────────────
  const canSubmit = isStage1
    ? shotCount >= 3 && distinctF.length >= 2 && mMoved
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

  // ─── Peek (blind-stage strategy tips — text only, never a preview) ───
  const PEEK_TIPS = useMemo(
    () => [labels.peek_tip_solve, labels.peek_tip_mass, labels.peek_tip_friction],
    [labels],
  )
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

  // ─── Derived visuals ──────────────────────────────────────────────────
  const netF = F - F_FRICTION
  const showForceArrows = !isStage3 // help removed on blind stage
  const showPreviewMarker = isStage2 // preview help only on stage 2
  const showTargetLabels = isStage3 // required info on blind stage

  const xPredicted = xFinalOf(F, m)
  const blockSvgX = toSvgX(blockPos)
  const blockSize = 0.85 + m * 0.05 // subtle visual hint for mass (0.9–1.35)

  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`
  const hudTR = `${labels.force_F} = ${F} N · ${labels.mass} = ${m} kg`
  const hudBL = isStage3 && peekTip
    ? peekTip
    : isStage1
      ? labels.tip1
      : isStage2
        ? labels.tip2
        : labels.tip3

  // ─── Grid ─────────────────────────────────────────────────────────────
  const gridLines: React.ReactNode[] = []
  for (let gx = 40; gx < W; gx += 60) {
    gridLines.push(<line key={`gx${gx}`} x1={gx} y1={0} x2={gx} y2={H} stroke="#12203a" strokeWidth={1} />)
  }
  for (let gy = 40; gy < H; gy += 60) {
    gridLines.push(<line key={`gy${gy}`} x1={0} y1={gy} x2={W} y2={gy} stroke="#12203a" strokeWidth={1} />)
  }

  // Metre tick marks along the ground (every 10 m, labelled every 20 m).
  const groundTicks: React.ReactNode[] = []
  for (let mx = 0; mx <= 80; mx += 10) {
    const gx = toSvgX(mx)
    if (gx > W - 10) break
    const major = mx % 20 === 0
    groundTicks.push(
      <line
        key={`t${mx}`}
        x1={gx}
        y1={GROUND_Y + 2}
        x2={gx}
        y2={GROUND_Y + (major ? 12 : 6)}
        stroke="#3A4863"
        strokeWidth={0.8}
      />,
    )
    if (major && mx > 0 && !isStage3) {
      groundTicks.push(
        <text
          key={`tl${mx}`}
          x={gx}
          y={GROUND_Y + 26}
          fill="#4A5570"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={10}
          textAnchor="middle"
        >
          {mx} m
        </text>,
      )
    }
  }

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
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />
        {gridLines}

        {/* Ground line + hatch */}
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
        {groundTicks}

        {/* Flags — drawn behind the block so a landing crate covers the base */}
        {activeTargets.map((t) => (
          <g key={t.id}>
            <Target x={toSvgX(t.x)} y={GROUND_Y} hit={hits.includes(t.id)} />
            {showTargetLabels && (
              <text
                x={toSvgX(t.x)}
                y={GROUND_Y - 40}
                fill="#F9A968"
                fontFamily="'JetBrains Mono', monospace"
                fontSize={11}
                textAnchor="middle"
              >
                x = {t.x} m
              </text>
            )}
          </g>
        ))}

        {/* Preview marker (stage 2 only): where the crate WILL stop */}
        {showPreviewMarker && (
          <g>
            <line
              x1={toSvgX(xPredicted)}
              y1={GROUND_Y - 34}
              x2={toSvgX(xPredicted)}
              y2={GROUND_Y + 14}
              stroke="#37C9B8"
              strokeWidth={1.4}
              strokeDasharray="4 4"
              opacity={0.85}
            />
            <text
              x={toSvgX(xPredicted)}
              y={GROUND_Y - 40}
              fill="#37C9B8"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
              textAnchor="middle"
            >
              {labels.predicted}: {xPredicted.toFixed(1)} m
            </text>
          </g>
        )}

        {/* Force arrows above the block (stages 1 & 2 only — help) */}
        {showForceArrows && (
          <g>
            <ForceArrow
              x={blockSvgX}
              y={GROUND_Y - 62}
              length={netF * ARROW_SCALE}
              color="#37C9B8"
              label={`${labels.net_F} = ${netF} N`}
            />
            <ForceArrow
              x={blockSvgX}
              y={GROUND_Y - 44}
              length={F * ARROW_SCALE}
              color="#F97316"
              label={`${labels.force_F} = ${F} N`}
            />
            <ForceArrow
              x={blockSvgX}
              y={GROUND_Y - 28}
              length={-F_FRICTION * ARROW_SCALE}
              color="#6C7A93"
              label={`${labels.force_f} = ${F_FRICTION} N`}
            />
          </g>
        )}

        {/* Block */}
        <Block x={blockSvgX} y={GROUND_Y} size={blockSize} />

        {/* Galilean-frame reminder, top-centre inside the SVG */}
        <text
          x={W / 2}
          y={30}
          fill="#4A5570"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={10}
          textAnchor="middle"
        >
          {labels.galilean}
        </text>
      </svg>

      {/* ─── HUD overlays ─────────────────────────────────────────────── */}
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
        {(isStage2 || isStage3) && (
          <div style={{ marginTop: '0.8rem', color: '#37C9B8', fontSize: '2.0rem' }}>
            {labels.hits} {hits.length}/{activeTargets.length}
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
        {hudTR}
        {isStage3 && (
          <div style={{ marginTop: '0.8rem', color: '#F9A968', fontSize: '2.0rem' }}>
            {labels.shots} {shotsRemaining}/{SHOT_BUDGET_STAGE3}
          </div>
        )}
      </div>
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
      {/* BR is reserved for parent-side chrome (fullscreen). No overlay here. */}

      {/* F slider — outer, rightmost */}
      <div
        style={{
          position: 'absolute',
          top: '10rem',
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
          {F_APPLIED_MAX}
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
            aria-label={labels.force_F}
            type="range"
            min={F_APPLIED_MIN}
            max={F_APPLIED_MAX}
            step={F_APPLIED_STEP}
            value={F}
            onChange={(e) => setF(Number(e.target.value))}
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
          {F_APPLIED_MIN}
        </div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.7rem', color: '#F97316' }}>
          {labels.force_F} (N)
        </div>
      </div>

      {/* m slider — inner (kg) */}
      <div
        style={{
          position: 'absolute',
          top: '10rem',
          right: '13rem',
          height: '38rem',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '1rem',
          zIndex: 6,
        }}
      >
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.9rem', color: '#6C7A93' }}>
          {M_MAX}
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
            aria-label={labels.mass}
            type="range"
            min={M_MIN}
            max={M_MAX}
            step={M_STEP}
            value={m}
            onChange={(e) => {
              setM(Number(e.target.value))
              setMMoved(true)
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
          {M_MIN}
        </div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.7rem', color: '#37C9B8' }}>
          {labels.mass} (kg)
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
          left: '38%',
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
          className="bi bi-play-fill"
          style={{ marginInlineEnd: '0.8rem', fontSize: '2.8rem', verticalAlign: '-0.2rem' }}
        />
        {labels.fire}
      </button>

      {/* Live velocity readout while a shot is airborne (helps students see acceleration) */}
      {flight && (
        <div
          style={{
            position: 'absolute',
            top: '9rem',
            left: '3rem',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '1.9rem',
            color: '#37C9B8',
            zIndex: 5,
            pointerEvents: 'none',
          }}
        >
          v = {blockVel.toFixed(1)} m/s · x = {blockPos.toFixed(1)} m
        </div>
      )}
    </div>
  )
}
