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
import { Cart } from './art/Cart'
import { EnergyGauge } from './art/EnergyGauge'
import { TargetCard } from './art/TargetCard'

// ─── Scene constants ────────────────────────────────────────
const W = 800
const H = 450
const TRACK_Y = 380
const CART_X_START = 100
const CART_X_END = 760 // cart exits after crossing this
const PX_PER_M = 24 // display scale for cart x-motion
const SPEED_FACTOR = 3 // sim runs faster than real time (game feel)

// Sliders
const M_MIN = 1
const M_MAX = 5
const M_STEP = 0.5
const V_MIN = 2
const V_MAX = 10
const V_STEP = 0.5
const DEFAULT_M = 2
const DEFAULT_V = 4

// Energy scale + hit tolerance
const EC_MAX_J = 260 // gauge ceiling (max Ec = 0.5*5*10^2 = 250 J, +10 headroom)
const HIT_TOL_J = 1.0 // 1 J absolute tolerance (with 0.5 sliders, exact-match combos hit cleanly)

// Blind-stage shot budget (§5.2) — one shot per target
const SHOT_BUDGET_PER_TARGET = 1

// ─── Setups (seed-picked) ───────────────────────────────────
type TargetSpec = { id: string; energyJ: number }
type Setup = { targets: TargetSpec[] }

// Stage 2 — gauge visible, target Ec brackets on the gauge.
// Each set spans small / medium / large so students see Ec ∝ v².
const STAGE2_SETUPS: Setup[] = [
  {
    targets: [
      { id: 's0a', energyJ: 8 }, // m=1, v=4  or  m=4, v=2
      { id: 's0b', energyJ: 32 }, // m=1, v=8  or  m=4, v=4
      { id: 's0c', energyJ: 50 }, // m=1, v=10 or  m=4, v=5
    ],
  },
  {
    targets: [
      { id: 's1a', energyJ: 18 }, // m=1, v=6  or  m=4, v=3
      { id: 's1b', energyJ: 72 }, // m=4, v=6
      { id: 's1c', energyJ: 128 }, // m=4, v=8
    ],
  },
  {
    targets: [
      { id: 's2a', energyJ: 12.5 }, // m=1, v=5
      { id: 's2b', energyJ: 100 }, // m=2, v=10
      { id: 's2c', energyJ: 200 }, // m=4, v=10
    ],
  },
]

// Stage 3 — gauge hidden, targets shown as text cards. Slightly harder mixes.
const STAGE3_SETUPS: Setup[] = [
  {
    targets: [
      { id: 't0a', energyJ: 32 },
      { id: 't0b', energyJ: 50 },
      { id: 't0c', energyJ: 128 },
    ],
  },
  {
    targets: [
      { id: 't1a', energyJ: 18 },
      { id: 't1b', energyJ: 72 },
      { id: 't1c', energyJ: 200 },
    ],
  },
  {
    targets: [
      { id: 't2a', energyJ: 8 },
      { id: 't2b', energyJ: 50 },
      { id: 't2c', energyJ: 162 }, // m=4, v=9
    ],
  },
]

// ─── Pure physics ───────────────────────────────────────────
function kineticEnergy(m: number, v: number): number {
  return 0.5 * m * v * v
}

function pickHit(shotJ: number, targets: TargetSpec[], alreadyHit: string[]): string | null {
  let best: { id: string; delta: number } | null = null
  for (const t of targets) {
    if (alreadyHit.includes(t.id)) continue
    const d = Math.abs(t.energyJ - shotJ)
    if (d <= HIT_TOL_J && (!best || d < best.delta)) best = { id: t.id, delta: d }
  }
  return best?.id ?? null
}

// ─── Label loader ───────────────────────────────────────────
const dict = { en } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── Component ──────────────────────────────────────────────
type Flight = { m: number; v: number; startedAt: number }

export default function Scene() {
  const { locale, seed } = useInit()
  const stages = useMemo(() => getStagesFor(locale), [locale])
  useDeclareStages(stages)
  const labels = useMemo(() => svgLabels(locale), [locale])

  const setup2 = useMemo(() => STAGE2_SETUPS[seed % STAGE2_SETUPS.length]!, [seed])
  const setup3 = useMemo(() => STAGE3_SETUPS[seed % STAGE3_SETUPS.length]!, [seed])

  const stageIdx = useCurrentStage()
  const setStage = useSetStage()

  // ─── State ──────────────────────────────────────────────
  const [m, setM] = useState(DEFAULT_M)
  const [v, setV] = useState(DEFAULT_V)
  const [flight, setFlight] = useState<Flight | null>(null)
  const [cartX, setCartX] = useState(CART_X_START)
  const [hits, setHits] = useState<string[]>([])
  const [shotCount, setShotCount] = useState(0)
  const [distinctV, setDistinctV] = useState<number[]>([])
  const [mMoved, setMMoved] = useState(false)
  const [lastShotJ, setLastShotJ] = useState<number | null>(null) // post-submit feedback
  const [peekTip, setPeekTip] = useState<string | null>(null)

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3
  const activeTargets = isStage2 ? setup2.targets : isStage3 ? setup3.targets : []
  const kTargets = activeTargets.length
  const shotBudget = kTargets * SHOT_BUDGET_PER_TARGET

  const complete = useComplete()
  const progress = useProgress()

  // Live Ec (from current slider values)
  const liveEc = useMemo(() => kineticEnergy(m, v), [m, v])

  // ─── Reset ──────────────────────────────────────────────
  const resetStageState = useCallback(() => {
    setM(DEFAULT_M)
    setV(DEFAULT_V)
    setFlight(null)
    setCartX(CART_X_START)
    setHits([])
    setShotCount(0)
    setDistinctV([])
    setMMoved(false)
    setLastShotJ(null)
    setPeekTip(null)
  }, [])
  useReset(resetStageState)

  // Whenever the SDK-owned stage index changes, wipe per-stage state.
  const prevStageRef = useRef(stageIdx)
  useEffect(() => {
    if (prevStageRef.current !== stageIdx) {
      resetStageState()
      prevStageRef.current = stageIdx
    }
  }, [stageIdx, resetStageState])

  // ─── Fire ───────────────────────────────────────────────
  const shotsUsed = shotCount
  const canFire =
    !flight && (!isStage3 || shotsUsed < shotBudget) && (!isStage3 || hits.length < kTargets)
  const fire = useCallback(() => {
    if (!canFire) return
    const now = performance.now()
    setFlight({ m, v, startedAt: now })
    setCartX(CART_X_START)
    setShotCount((n) => n + 1)

    // Stage-1 accounting
    if (isStage1) {
      const bucket = Math.round(v) // 1 m/s bucket
      setDistinctV((prev) => (prev.includes(bucket) ? prev : [...prev, bucket]))
    }

    // Hit-test (Ec matching)
    if (isStage2 || isStage3) {
      const shotJ = kineticEnergy(m, v)
      setLastShotJ(shotJ)
      const hitId = pickHit(shotJ, activeTargets, hits)
      if (hitId) setHits((prev) => [...prev, hitId])
    }
  }, [canFire, m, v, isStage1, isStage2, isStage3, activeTargets, hits])

  // ─── Ticker (cart animation) ────────────────────────────
  useTicker((dt) => {
    if (!flight) return
    const elapsed = (performance.now() - flight.startedAt) / 1000
    // Cart moves at constant velocity: xSvg = start + v * elapsed * PX_PER_M * SPEED_FACTOR
    const nextX = CART_X_START + flight.v * elapsed * PX_PER_M * SPEED_FACTOR * (dt > 0 ? 1 : 1)
    setCartX(nextX)
    // Exit condition — flight ends when cart leaves the visible track
    if (nextX >= CART_X_END + 40) {
      setFlight(null)
      setCartX(CART_X_START)
    }
  })

  // ─── Blind-stage fail (§5.2) ────────────────────────────
  useEffect(() => {
    if (!isStage3) return
    if (shotsUsed >= shotBudget && !flight && hits.length < kTargets) {
      // Out of shots without full clearance — restart with fresh state (seed rotates via SETUPS on next mount).
      resetStageState()
    }
  }, [isStage3, shotsUsed, shotBudget, flight, hits.length, kTargets, resetStageState])

  // ─── Advance predicate ──────────────────────────────────
  const canSubmit = isStage1
    ? shotCount >= 3 && distinctV.length >= 2 && mMoved
    : hits.length === kTargets && kTargets > 0

  useEffect(() => {
    progress(stageIdx / 3, { stage: stageIdx, canSubmit })
  }, [stageIdx, canSubmit, progress])

  useNext(() => {
    if (stageIdx < 3) {
      setStage(stageIdx + 1)
    } else {
      complete({ success: true })
    }
  })

  // ─── Peek (blind stage strategy hint — text only, never the gauge) ─
  const PEEK_TIPS = useMemo(
    () => [labels.peek_tip_v_squared, labels.peek_tip_solve_v, labels.peek_tip_pairs],
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

  // ─── Slider handlers ────────────────────────────────────
  const onMChange = (val: number) => {
    setM(val)
    setMMoved(true)
  }
  const onVChange = (val: number) => setV(val)

  // ─── Grid ────────────────────────────────────────────────
  const gridLines: React.ReactNode[] = []
  for (let gx = 40; gx < W; gx += 60) {
    gridLines.push(<line key={`gx${gx}`} x1={gx} y1={0} x2={gx} y2={H} stroke="#12203a" strokeWidth={1} />)
  }
  for (let gy = 40; gy < H; gy += 60) {
    gridLines.push(<line key={`gy${gy}`} x1={0} y1={gy} x2={W} y2={gy} stroke="#12203a" strokeWidth={1} />)
  }

  // ─── HUD text ────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`
  const hudTR = `${labels.mass} = ${m.toFixed(1)} ${labels.unitMass} · ${labels.speed} = ${v.toFixed(1)} ${labels.unitSpeed}`
  const hudBLDefault = isStage1 ? labels.tip1 : isStage2 ? labels.tip2 : labels.tip3
  const hudBL = isStage3 && peekTip ? peekTip : hudBLDefault

  // Cart scale from mass (visual feedback for m). m=1 → 0.75, m=5 → 1.35.
  const cartScale = 0.75 + ((m - M_MIN) / (M_MAX - M_MIN)) * 0.6

  // Gauge geometry
  const GAUGE_X = 170
  const GAUGE_Y = 90
  const GAUGE_W = 460
  const GAUGE_H = 30

  const gaugeTargets = activeTargets.map((t) => ({
    id: t.id,
    energyJ: t.energyJ,
    hit: hits.includes(t.id),
  }))

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block', touchAction: 'none', userSelect: 'none' }}
      >
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />
        {gridLines}

        {/* Track (ground line + hatched ties) */}
        <line x1={0} y1={TRACK_Y} x2={W} y2={TRACK_Y} stroke="#3A4863" strokeWidth={1.5} />
        {Array.from({ length: 36 }).map((_, i) => (
          <line
            key={`h${i}`}
            x1={i * 24 + 6}
            y1={TRACK_Y + 2}
            x2={i * 24 - 6}
            y2={TRACK_Y + 10}
            stroke="#3A4863"
            strokeWidth={0.8}
          />
        ))}

        {/* Energy gauge — hidden on stage 3 (§4.7: this is the primary "help") */}
        <EnergyGauge
          x={GAUGE_X}
          y={GAUGE_Y}
          w={GAUGE_W}
          h={GAUGE_H}
          currentJ={liveEc}
          maxJ={EC_MAX_J}
          targets={gaugeTargets}
          showTargets={isStage2}
          hidden={isStage3}
        />

        {/* Live Ec numeric — visible in stages 1 & 2 only. On stage 3 the exact
            value is post-submit feedback only. */}
        {!isStage3 && (
          <text
            x={GAUGE_X + GAUGE_W}
            y={GAUGE_Y - 6}
            fill="#F97316"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={12}
            textAnchor="end"
          >
            {liveEc.toFixed(1)} J
          </text>
        )}

        {/* Stage-3 target cards — required info, coordinates of the problem */}
        {isStage3 && (
          <>
            <text
              x={W / 2}
              y={165}
              fill="#6C7A93"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={11}
              textAnchor="middle"
              letterSpacing="2"
            >
              {labels.targets}
            </text>
            {activeTargets.map((t, i) => {
              const cx = W / 2 + (i - (kTargets - 1) / 2) * 116
              const cy = 200
              return (
                <TargetCard
                  key={t.id}
                  x={cx}
                  y={cy}
                  energyJ={t.energyJ}
                  index={i + 1}
                  hit={hits.includes(t.id)}
                />
              )
            })}
          </>
        )}

        {/* Post-submit feedback: last shot's Ec value.
            Only shown on stages 2 & 3, and only when NOT currently flying. */}
        {(isStage2 || isStage3) && lastShotJ !== null && !flight && (
          <text
            x={W / 2}
            y={260}
            fill="#B9C4D6"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={13}
            textAnchor="middle"
          >
            last shot: Ec = {lastShotJ.toFixed(1)} J
          </text>
        )}

        {/* Cart */}
        <Cart x={cartX} y={TRACK_Y} scale={cartScale} />
      </svg>

      {/* HUD overlays — top-left (stage), top-right (m·v readout), bottom-left (tip / peek) */}
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
          textAlign: 'right',
          zIndex: 5,
          pointerEvents: 'none',
        }}
      >
        <div>{hudTR}</div>
        {(isStage2 || isStage3) && (
          <div style={{ marginTop: '0.6rem', color: '#6C7A93' }}>
            {labels.hits} {hits.length}/{kTargets}
            {isStage3 && (
              <>
                {' '}
                · {labels.shots} {Math.max(0, shotBudget - shotsUsed)}/{shotBudget}
              </>
            )}
          </div>
        )}
      </div>
      <div
        style={{
          position: 'absolute',
          bottom: '3rem',
          left: '3rem',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '2.3rem',
          letterSpacing: '0.06em',
          color: isStage3 && peekTip ? '#F9A968' : '#6C7A93',
          zIndex: 5,
          pointerEvents: 'none',
          maxWidth: '60%',
          lineHeight: 1.3,
        }}
      >
        {hudBL}
      </div>
      {/* NO bottom-right — reserved for parent chrome (§4.3). */}

      {/* Mass slider — LEFT side, vertical */}
      <div
        style={{
          position: 'absolute',
          top: '18rem',
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
            type="range"
            min={M_MIN}
            max={M_MAX}
            step={M_STEP}
            value={m}
            onChange={(e) => onMChange(Number(e.target.value))}
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
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.7rem', color: '#54617A' }}>
          m (kg)
        </div>
      </div>

      {/* Velocity slider — RIGHT side, vertical */}
      <div
        style={{
          position: 'absolute',
          top: '18rem',
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
          {V_MAX}
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
            min={V_MIN}
            max={V_MAX}
            step={V_STEP}
            value={v}
            onChange={(e) => onVChange(Number(e.target.value))}
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
          {V_MIN}
        </div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.7rem', color: '#54617A' }}>
          v (m/s)
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
