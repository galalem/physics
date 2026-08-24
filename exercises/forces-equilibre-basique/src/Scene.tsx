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
import { Spring } from './art/Spring'
import { Mass } from './art/Mass'
import { Support } from './art/Support'
import { ForceArrow } from './art/ForceArrow'

// ─── Scene constants ────────────────────────────────────────────────────
const W = 800
const H = 450

// The spring hangs from a fixed support beam at the top of the canvas.
const SUPPORT_X = 380
const SUPPORT_Y = 60

// Physics constants (1ère depth — 2 collinear forces, no damping).
const G = 9.81 // m/s²
const L0 = 0.5 // natural spring length, meters
const PX_PER_M = 90 // vertical scale

// DOF ranges.
const M_MIN = 0.5
const M_MAX = 5.0
const M_STEP = 0.1
const K_MIN = 20
const K_MAX = 100
const K_STEP = 1
const M_DEFAULT = 1.5
const K_DEFAULT = 40

// Hit tolerance for a target ΔL in meters.
const TARGET_TOL_M = 0.10

// ─── Setups (seed-picked, hand-authored) ───────────────────────────────
type Target = { id: string; dL: number; k: number }
type Setup = { targets: Target[] }

// Stage 2 — targeted ΔL matching. k is fixed across the 3 targets of a
// setup so the student learns the direct ΔL ↔ m relation.
const STAGE2_SETUPS: Setup[] = [
  { targets: [
    { id: 's0a', dL: 0.5, k: 30 },
    { id: 's0b', dL: 1.0, k: 30 },
    { id: 's0c', dL: 1.5, k: 30 },
  ] },
  { targets: [
    { id: 's1a', dL: 0.3, k: 40 },
    { id: 's1b', dL: 0.7, k: 40 },
    { id: 's1c', dL: 1.2, k: 40 },
  ] },
  { targets: [
    { id: 's2a', dL: 0.6, k: 25 },
    { id: 's2b', dL: 0.9, k: 25 },
    { id: 's2c', dL: 1.4, k: 25 },
  ] },
  { targets: [
    { id: 's3a', dL: 0.4, k: 50 },
    { id: 's3b', dL: 0.8, k: 50 },
    { id: 's3c', dL: 1.0, k: 50 },
  ] },
]

// Stage 3 — blind evaluation. Each target has its OWN k so the student
// must repeat the m = k·ΔL/g computation for every submission.
const STAGE3_SETUPS: Setup[] = [
  { targets: [
    { id: 't0a', dL: 0.4, k: 50 },  // m ≈ 2.04 kg
    { id: 't0b', dL: 0.8, k: 25 },  // m ≈ 2.04 kg (same target m — trap)
    { id: 't0c', dL: 1.0, k: 40 },  // m ≈ 4.08 kg
  ] },
  { targets: [
    { id: 't1a', dL: 0.6, k: 30 },  // m ≈ 1.83 kg
    { id: 't1b', dL: 1.2, k: 25 },  // m ≈ 3.06 kg
    { id: 't1c', dL: 0.5, k: 80 },  // m ≈ 4.08 kg
  ] },
  { targets: [
    { id: 't2a', dL: 0.3, k: 100 }, // m ≈ 3.06 kg
    { id: 't2b', dL: 0.9, k: 45 },  // m ≈ 4.13 kg
    { id: 't2c', dL: 1.5, k: 20 },  // m ≈ 3.06 kg
  ] },
  { targets: [
    { id: 't3a', dL: 0.5, k: 60 },  // m ≈ 3.06 kg
    { id: 't3b', dL: 0.8, k: 50 },  // m ≈ 4.08 kg
    { id: 't3c', dL: 1.1, k: 35 },  // m ≈ 3.93 kg
  ] },
]

const dict = { en } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── Physics helpers (INLINE) ───────────────────────────────────────────
function equilibriumElongation(m: number, k: number): number {
  return (m * G) / k
}
function weight(m: number): number {
  return m * G
}
function springForce(k: number, dL: number): number {
  return k * dL
}

// ─── Physics ↔ SVG helpers ──────────────────────────────────────────────
function springBottomY(dL: number): number {
  return SUPPORT_Y + (L0 + dL) * PX_PER_M
}
function elongationY(dL: number): number {
  // y position corresponding to a given elongation on the ruler
  // (ruler zero sits at the natural-length spring end).
  return SUPPORT_Y + L0 * PX_PER_M + dL * PX_PER_M
}

// ─── Component ──────────────────────────────────────────────────────────
export default function Scene() {
  const { locale, seed } = useInit()
  const stages = useMemo(() => getStagesFor(locale), [locale])
  useDeclareStages(stages)
  const labels = useMemo(() => svgLabels(locale), [locale])

  const setup2 = useMemo(() => STAGE2_SETUPS[seed % STAGE2_SETUPS.length]!, [seed])
  const [stage3Setup, setStage3Setup] = useState<Setup>(
    () => STAGE3_SETUPS[seed % STAGE3_SETUPS.length]!,
  )
  const stage3RotationRef = useRef(0)

  const stageIdx = useCurrentStage()
  const setStage = useSetStage()

  // ─── State ────────────────────────────────────────────────────────────
  const [mass, setMass] = useState(M_DEFAULT)
  const [k, setK] = useState(K_DEFAULT)
  const [confirmCount, setConfirmCount] = useState(0)
  const [distinctMasses, setDistinctMasses] = useState<number[]>([])
  const [kMoved, setKMoved] = useState(false)
  const [hits, setHits] = useState<string[]>([])
  const [peekTip, setPeekTip] = useState<string | null>(null)
  const [flash, setFlash] = useState<null | { kind: 'hit' | 'miss'; at: number }>(null)

  // Blind-stage: one submission per target (K submissions total).
  const SHOT_BUDGET_STAGE3 = stage3Setup.targets.length
  const [shotsRemaining, setShotsRemaining] = useState(SHOT_BUDGET_STAGE3)

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  const activeSetup = isStage2 ? setup2 : isStage3 ? stage3Setup : null
  const activeTargets = activeSetup ? activeSetup.targets : []

  const complete = useComplete()
  const progress = useProgress()

  // ─── Live physics (static equilibrium — no dynamics) ─────────────────
  const dL = equilibriumElongation(mass, k)
  const P = weight(mass)
  const R = springForce(k, dL)
  const sumF = R - P // ≈ 0 by construction; kept explicit for HUD

  // ─── Reset ────────────────────────────────────────────────────────────
  const resetStageState = useCallback(() => {
    setMass(M_DEFAULT)
    setK(K_DEFAULT)
    setConfirmCount(0)
    setDistinctMasses([])
    setKMoved(false)
    setHits([])
    setPeekTip(null)
    setFlash(null)
    setShotsRemaining(SHOT_BUDGET_STAGE3)
  }, [SHOT_BUDGET_STAGE3])
  useReset(resetStageState)

  // ─── Confirm (analog of FIRE) ────────────────────────────────────────
  const confirm = useCallback(() => {
    setConfirmCount((n) => n + 1)

    if (isStage1) {
      // Log distinct mass buckets (rounded to 0.5 kg for exploration credit).
      const bucket = Math.round(mass * 2) / 2
      setDistinctMasses((prev) => (prev.includes(bucket) ? prev : [...prev, bucket]))
      setFlash({ kind: 'hit', at: performance.now() })
      return
    }

    // Stage 2 & 3: check hit against un-hit targets.
    const currentDL = dL
    let hitId: string | null = null
    for (const t of activeTargets) {
      if (hits.includes(t.id)) continue
      // Stage 3 also requires the shown k to match (or be very close) so
      // students can't spoof by tuning k+m to match ΔL only.
      const kMatches = !isStage3 || Math.abs(k - t.k) < 0.5
      if (Math.abs(currentDL - t.dL) < TARGET_TOL_M && kMatches) {
        hitId = t.id
        break
      }
    }

    if (isStage3) {
      setShotsRemaining((n) => n - 1)
    }

    if (hitId) {
      setHits((prev) => [...prev, hitId!])
      setFlash({ kind: 'hit', at: performance.now() })
    } else {
      setFlash({ kind: 'miss', at: performance.now() })
    }
  }, [isStage1, isStage3, mass, dL, k, activeTargets, hits])

  // Auto-fade flash indicator.
  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash(null), 900)
    return () => clearTimeout(t)
  }, [flash])

  // ─── Blind-stage restart when budget exhausted without full clear ───
  useEffect(() => {
    if (!isStage3) return
    if (shotsRemaining !== 0) return
    if (hits.length === activeTargets.length) return
    // Fresh setup, back to shot 1. Rotate through STAGE3_SETUPS so the
    // student doesn't just retry the exact same layout.
    stage3RotationRef.current += 1
    const nextIdx = (seed + stage3RotationRef.current) % STAGE3_SETUPS.length
    setStage3Setup(STAGE3_SETUPS[nextIdx]!)
    // Reset per-stage state (but keep stage index).
    setMass(M_DEFAULT)
    setK(K_DEFAULT)
    setHits([])
    setFlash(null)
    setShotsRemaining(STAGE3_SETUPS[nextIdx]!.targets.length)
  }, [isStage3, shotsRemaining, hits.length, activeTargets.length, seed])

  // ─── Advance predicate ──────────────────────────────────────────────
  const canSubmit = isStage1
    ? confirmCount >= 3 && distinctMasses.length >= 2 && kMoved
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

  // ─── Peek (blind-stage strategy hint, text only) ────────────────────
  const PEEK_TIPS = useMemo(
    () => [labels.peek_tip_balance, labels.peek_tip_double, labels.peek_tip_units],
    [labels],
  )
  const peekIdxRef = useRef(0)
  usePeek(() => {
    if (!isStage3) return
    setPeekTip(PEEK_TIPS[peekIdxRef.current % PEEK_TIPS.length] ?? null)
    peekIdxRef.current += 1
  })
  useEffect(() => {
    if (!peekTip) return
    const t = setTimeout(() => setPeekTip(null), 4500)
    return () => clearTimeout(t)
  }, [peekTip])

  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  // ─── Derived UI values ──────────────────────────────────────────────
  const massSvgY = springBottomY(dL)
  const stageName = stages[stageIdx - 1]?.name ?? ''

  // Force arrows — hidden on stage 3.
  const showForceArrows = !isStage3
  const showForceReadouts = !isStage3

  // ─── HUD text ────────────────────────────────────────────────────────
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`
  const hudTR = `${labels.mass} = ${mass.toFixed(1)} kg · ${labels.stiffness} = ${k} N/m`
  const hudTRLine2 = `${labels.elongation} = ${dL.toFixed(2)} m`
  const hudBLTip = isStage1 ? labels.tip1 : isStage2 ? labels.tip2 : labels.tip3
  const hudBL = isStage3 && peekTip ? peekTip : hudBLTip
  const hudForceLine = showForceReadouts
    ? `${labels.weight} = ${P.toFixed(1)} N · ${labels.reaction} = ${R.toFixed(1)} N · ${labels.netforce} = ${sumF.toFixed(2)} N`
    : null
  const hudHitsLine =
    isStage2 || isStage3
      ? `${labels.hits} ${hits.length}/${activeTargets.length}`
      : null
  const hudShotsLine = isStage3
    ? `${labels.shots} ${shotsRemaining}/${SHOT_BUDGET_STAGE3}`
    : null

  // ─── Grid ───────────────────────────────────────────────────────────
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

  // ─── Ruler ticks next to the spring (ΔL scale in meters) ────────────
  const rulerX = SUPPORT_X + 60
  const rulerTop = elongationY(0)
  const rulerBottom = elongationY(2.6)
  const rulerTicks: React.ReactNode[] = []
  for (let m = 0; m <= 2.6 + 0.001; m += 0.5) {
    const yTick = elongationY(m)
    if (yTick > H - 20) break
    rulerTicks.push(
      <g key={`rt${m}`}>
        <line x1={rulerX} y1={yTick} x2={rulerX + 12} y2={yTick} stroke="#3A4863" strokeWidth={1.2} />
        <text
          x={rulerX + 16}
          y={yTick + 3}
          fill="#54617A"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={9}
        >
          {m.toFixed(1)}
        </text>
      </g>,
    )
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
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

        {/* Support beam (top) */}
        <Support x={SUPPORT_X} y={SUPPORT_Y} width={180} />

        {/* Ruler (ΔL scale) */}
        <line x1={rulerX} y1={rulerTop} x2={rulerX} y2={rulerBottom} stroke="#3A4863" strokeWidth={1.2} />
        {rulerTicks}
        <text
          x={rulerX}
          y={rulerTop - 8}
          fill="#8FA0BE"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={9}
          fontWeight={700}
        >
          ΔL (m)
        </text>
        {/* Zero marker at natural length */}
        <line
          x1={rulerX - 4}
          y1={rulerTop}
          x2={rulerX + 20}
          y2={rulerTop}
          stroke="#8FA0BE"
          strokeWidth={1.4}
          strokeDasharray="3 3"
        />

        {/* Target markers (stage 2 & 3) */}
        {activeTargets.map((t) => {
          const yT = elongationY(t.dL)
          const isHit = hits.includes(t.id)
          const color = isHit ? '#37C9B8' : '#F9A968'
          return (
            <g key={t.id}>
              {/* Horizontal target line across the spring column */}
              <line
                x1={SUPPORT_X - 55}
                y1={yT}
                x2={SUPPORT_X + 55}
                y2={yT}
                stroke={color}
                strokeWidth={isHit ? 2 : 1.4}
                strokeDasharray={isHit ? '0' : '5 4'}
                opacity={isHit ? 0.9 : 0.7}
              />
              {/* Target chip */}
              <g transform={`translate(${SUPPORT_X - 90} ${yT - 8})`}>
                <rect
                  x={0}
                  y={0}
                  width={70}
                  height={16}
                  rx={3}
                  fill="rgba(15,22,38,0.85)"
                  stroke={color}
                  strokeWidth={1.2}
                />
                <text
                  x={35}
                  y={11}
                  fill={color}
                  fontFamily="'JetBrains Mono', monospace"
                  fontSize={9}
                  fontWeight={700}
                  textAnchor="middle"
                >
                  ΔL = {t.dL.toFixed(2)} m
                </text>
              </g>
              {/* Stage 3: also show k on target chip */}
              {isStage3 && (
                <g transform={`translate(${SUPPORT_X + 130} ${yT - 8})`}>
                  <rect
                    x={0}
                    y={0}
                    width={70}
                    height={16}
                    rx={3}
                    fill="rgba(15,22,38,0.85)"
                    stroke={color}
                    strokeWidth={1.2}
                  />
                  <text
                    x={35}
                    y={11}
                    fill={color}
                    fontFamily="'JetBrains Mono', monospace"
                    fontSize={9}
                    fontWeight={700}
                    textAnchor="middle"
                  >
                    k = {t.k} N/m
                  </text>
                </g>
              )}
            </g>
          )
        })}

        {/* Spring */}
        <Spring x={SUPPORT_X} yTop={SUPPORT_Y} yBottom={massSvgY} coils={10} />

        {/* Mass */}
        <Mass x={SUPPORT_X} y={massSvgY} size={30} label={`${mass.toFixed(1)} kg`} />

        {/* Force arrows on mass (hidden in blind stage) */}
        {showForceArrows && (
          <g>
            {/* Weight P: downward from mass center */}
            <ForceArrow
              x={SUPPORT_X + 24}
              y={massSvgY + 20}
              dy={Math.min(70, 8 + P * 1.2)}
              color="#F97316"
              label={`P = ${P.toFixed(1)} N`}
            />
            {/* Reaction R: upward from mass hook (equal magnitude to P at equilibrium) */}
            <ForceArrow
              x={SUPPORT_X - 24}
              y={massSvgY + 20}
              dy={-Math.min(70, 8 + R * 1.2)}
              color="#37C9B8"
              label={`R = ${R.toFixed(1)} N`}
            />
          </g>
        )}

        {/* g reference — kept in TR quadrant (BR reserved for chrome). */}
        <text
          x={W - 20}
          y={45}
          fill="#54617A"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={9}
          textAnchor="end"
        >
          g ↓ {G} m/s²
        </text>
      </svg>

      {/* ─── HUD overlays (HTML, rem units) ─── */}
      {/* TL */}
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

      {/* TR — DOF readouts + elongation */}
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
        <div style={{ marginTop: '0.6rem', color: '#6C7A93' }}>{hudTRLine2}</div>
        {hudForceLine && (
          <div style={{ marginTop: '0.4rem', color: '#8FA0BE', fontSize: '1.9rem' }}>
            {hudForceLine}
          </div>
        )}
        {hudHitsLine && (
          <div style={{ marginTop: '0.6rem', color: '#F9A968' }}>{hudHitsLine}</div>
        )}
        {hudShotsLine && (
          <div style={{ marginTop: '0.4rem', color: '#F9A968' }}>{hudShotsLine}</div>
        )}
      </div>

      {/* BL — tip / peek text */}
      <div
        style={{
          position: 'absolute',
          bottom: '3rem',
          left: '3rem',
          maxWidth: '46rem',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '2.1rem',
          letterSpacing: '0.06em',
          color: peekTip ? '#F9A968' : '#6C7A93',
          zIndex: 5,
          pointerEvents: 'none',
        }}
      >
        {hudBL}
      </div>

      {/* BR intentionally left empty — reserved for parent-side chrome. */}

      {/* Mass slider (horizontal, bottom-left area above the confirm button) */}
      <div
        style={{
          position: 'absolute',
          bottom: '18rem',
          left: '3rem',
          width: '32rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.8rem',
          zIndex: 6,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '1.9rem',
            color: '#8FA0BE',
          }}
        >
          <span>m (kg)</span>
          <span style={{ color: '#F97316' }}>{mass.toFixed(1)}</span>
        </div>
        <input
          type="range"
          min={M_MIN}
          max={M_MAX}
          step={M_STEP}
          value={mass}
          onChange={(e) => setMass(Number(e.target.value))}
          style={{
            width: '100%',
            accentColor: '#F97316',
            cursor: 'pointer',
          }}
        />
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '1.5rem',
            color: '#54617A',
          }}
        >
          <span>{M_MIN.toFixed(1)}</span>
          <span>{M_MAX.toFixed(1)}</span>
        </div>
      </div>

      {/* Stiffness slider (vertical, right side) */}
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
          {K_MAX}
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
            min={K_MIN}
            max={K_MAX}
            step={K_STEP}
            value={k}
            onChange={(e) => {
              setK(Number(e.target.value))
              setKMoved(true)
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
          {K_MIN}
        </div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.7rem', color: '#54617A' }}>
          k (N/m)
        </div>
      </div>

      {/* CONFIRM button */}
      <button
        type="button"
        onClick={confirm}
        disabled={isStage3 && shotsRemaining === 0}
        style={{
          position: 'absolute',
          bottom: '3rem',
          left: '50%',
          transform: 'translateX(-50%)',
          padding: '2rem 4rem',
          background: !(isStage3 && shotsRemaining === 0) ? '#F97316' : 'rgba(30,42,64,0.85)',
          color: !(isStage3 && shotsRemaining === 0) ? '#FFFFFF' : '#6C7A93',
          border: `0.3rem solid ${
            !(isStage3 && shotsRemaining === 0) ? '#F97316' : 'rgba(58,72,99,0.6)'
          }`,
          borderRadius: '100rem',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '2.6rem',
          fontWeight: 700,
          letterSpacing: '0.12em',
          cursor: !(isStage3 && shotsRemaining === 0) ? 'pointer' : 'not-allowed',
          zIndex: 10,
        }}
      >
        <i
          className="bi bi-check2-circle"
          style={{ marginInlineEnd: '0.8rem', fontSize: '2.8rem', verticalAlign: '-0.2rem' }}
        />
        {labels.confirm}
      </button>

      {/* Flash indicator (hit / miss) — appears briefly after confirm */}
      {flash && (
        <div
          style={{
            position: 'absolute',
            bottom: '13rem',
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '1rem 2rem',
            borderRadius: '0.6rem',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '2rem',
            fontWeight: 700,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: flash.kind === 'hit' ? '#37C9B8' : '#F97316',
            background:
              flash.kind === 'hit' ? 'rgba(55,201,184,0.12)' : 'rgba(249,115,22,0.12)',
            border: `1.5px solid ${flash.kind === 'hit' ? '#37C9B8' : '#F97316'}`,
            zIndex: 11,
            pointerEvents: 'none',
          }}
        >
          {flash.kind === 'hit' ? labels.success : labels.fail}
        </div>
      )}
    </div>
  )
}
