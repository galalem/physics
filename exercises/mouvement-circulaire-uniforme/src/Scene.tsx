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
import { Disk } from './art/Disk'
import { Marker } from './art/Marker'
import { TargetChip } from './art/TargetChip'

// ─── Scene constants ────────────────────────────────────────────────────
const W = 800
const H = 450
const CENTER = { x: 350, y: 235 }
const PX_PER_M = 34 // SVG units per metre of orbit radius (R=5m → 170 SVG units)

// DOF ranges
const R_MIN = 1
const R_MAX = 5
const R_STEP = 0.5
const OMEGA_MIN = 0.5
const OMEGA_MAX = 4
const OMEGA_STEP = 0.5
const DEFAULT_R = 3
const DEFAULT_OMEGA = 1.5

// Hit tolerance in stage 2 / 3 (per DOF, before rounding)
const V_TOL = 0.4
const A_TOL = 0.6

// Blind stage
const SHOT_BUDGET_STAGE3 = 3

// Feedback flash duration (ms)
const FLASH_MS = 700

// Arrow scaling from physical → SVG units (clamped to keep vectors on-screen)
const V_ARROW_PX_PER = 6
const A_ARROW_PX_PER = 2
const ARROW_MAX_SVG = 100

// ─── Setups (hand-authored, seed-picked) ───────────────────────────────
// Each target is a (v*, a*) pair with a canonical (R*, ω*) solution.
// R = v²/a and ω = a/v. All solutions live inside the DOF range.

type TargetSpec = { id: string; v: number; a: number }
type Setup = { targets: TargetSpec[] }

// Stage 2 — 3 targets each. Covers same-ω-diff-R, same-R-diff-ω, and
// "obvious" round numbers so the student can eyeball the answer.
const STAGE2_SETUPS: Setup[] = [
  {
    targets: [
      { id: 's0a', v: 2, a: 2 }, // R=2, ω=1
      { id: 's0b', v: 6, a: 12 }, // R=3, ω=2
      { id: 's0c', v: 3, a: 3 }, // R=3, ω=1
    ],
  },
  {
    targets: [
      { id: 's1a', v: 4, a: 8 }, // R=2, ω=2
      { id: 's1b', v: 6, a: 9 }, // R=4, ω=1.5
      { id: 's1c', v: 2, a: 1 }, // R=4, ω=0.5
    ],
  },
  {
    targets: [
      { id: 's2a', v: 3, a: 6 }, // R=1.5, ω=2
      { id: 's2b', v: 5, a: 10 }, // R=2.5, ω=2
      { id: 's2c', v: 4, a: 3.2 }, // R=5, ω=0.8 (rounds cleanly to grid at ω=1 with R=4)
    ],
  },
  {
    targets: [
      { id: 's3a', v: 6, a: 18 }, // R=2, ω=3
      { id: 's3b', v: 3, a: 9 }, // R=1, ω=3
      { id: 's3c', v: 4, a: 4 }, // R=4, ω=1
    ],
  },
  {
    targets: [
      { id: 's4a', v: 4, a: 16 }, // R=1, ω=4
      { id: 's4b', v: 3, a: 6 }, // R=1.5, ω=2
      { id: 's4c', v: 5, a: 5 }, // R=5, ω=1
    ],
  },
]

// Stage 3 — harder. Each setup contains at least one target that shares
// v or a with another, forcing the student to realise both R and ω
// matter (anti-misconception per the sketch).
const STAGE3_SETUPS: Setup[] = [
  {
    targets: [
      { id: 't0a', v: 4, a: 8 }, // R=2, ω=2
      { id: 't0b', v: 4, a: 16 }, // R=1, ω=4 (same v, half R, double a)
      { id: 't0c', v: 6, a: 12 }, // R=3, ω=2 (same ω as t0a)
    ],
  },
  {
    targets: [
      { id: 't1a', v: 3, a: 3 }, // R=3, ω=1
      { id: 't1b', v: 3, a: 6 }, // R=1.5, ω=2 (same v, different R)
      { id: 't1c', v: 6, a: 12 }, // R=3, ω=2
    ],
  },
  {
    targets: [
      { id: 't2a', v: 2, a: 4 }, // R=1, ω=2
      { id: 't2b', v: 4, a: 8 }, // R=2, ω=2 (same ω, double R)
      { id: 't2c', v: 5, a: 5 }, // R=5, ω=1
    ],
  },
  {
    targets: [
      { id: 't3a', v: 6, a: 18 }, // R=2, ω=3
      { id: 't3b', v: 2, a: 1 }, // R=4, ω=0.5
      { id: 't3c', v: 4, a: 16 }, // R=1, ω=4
    ],
  },
  {
    targets: [
      { id: 't4a', v: 5, a: 10 }, // R=2.5, ω=2
      { id: 't4b', v: 3, a: 9 }, // R=1, ω=3
      { id: 't4c', v: 4, a: 4 }, // R=4, ω=1
    ],
  },
]

const dict = { en } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// Round a scalar to the nearest step (helps R/ω match slider grid)
function snap(x: number, step: number): number {
  return Math.round(x / step) * step
}

export default function Scene() {
  const { locale, seed } = useInit()
  const stages = useMemo(() => getStagesFor(locale), [locale])
  useDeclareStages(stages)
  const labels = useMemo(() => svgLabels(locale), [locale])

  const setup2 = useMemo(() => STAGE2_SETUPS[seed % STAGE2_SETUPS.length]!, [seed])
  const setup3 = useMemo(() => STAGE3_SETUPS[seed % STAGE3_SETUPS.length]!, [seed])

  const stageIdx = useCurrentStage()
  const setStage = useSetStage()

  // ─── State ─────────────────────────────────────────────────────────
  const [R, setR] = useState(DEFAULT_R)
  const [omega, setOmega] = useState(DEFAULT_OMEGA)
  const [theta, setTheta] = useState(0) // radians
  const [hits, setHits] = useState<string[]>([])
  const [shotCount, setShotCount] = useState(0)
  const [distinctR, setDistinctR] = useState<number[]>([])
  const [omegaMoved, setOmegaMoved] = useState(false)
  const [shotsRemaining, setShotsRemaining] = useState(SHOT_BUDGET_STAGE3)
  const [flash, setFlash] = useState<'hit' | 'miss' | null>(null)
  const [peekTip, setPeekTip] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)

  const svgRef = useRef<SVGSVGElement>(null)

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  const activeTargets = isStage2 ? setup2.targets : isStage3 ? setup3.targets : []

  const complete = useComplete()
  const progress = useProgress()

  // Derived kinematics
  const v = R * omega
  const a = R * omega * omega

  // ─── Reset ─────────────────────────────────────────────────────────
  const resetStageState = useCallback(() => {
    setR(DEFAULT_R)
    setOmega(DEFAULT_OMEGA)
    setTheta(0)
    setHits([])
    setShotCount(0)
    setDistinctR([])
    setOmegaMoved(false)
    setShotsRemaining(SHOT_BUDGET_STAGE3)
    setFlash(null)
    setPeekTip(null)
  }, [])
  useReset(resetStageState)

  // ─── Ticker: advance θ at current ω ────────────────────────────────
  // Note: R can change any time; θ is independent of R. |v| = R·ω but
  // the angular position only depends on ω.
  useTicker((dt) => {
    // Clamp dt to avoid huge jumps if tab was throttled.
    const step = Math.min(dt, 0.1) * omega
    setTheta((prev) => (prev + step) % (Math.PI * 2))
  })

  // ─── CHECK button — commit current (R, ω) ──────────────────────────
  const canCheck = flash === null && (!isStage3 || shotsRemaining > 0)

  const check = useCallback(() => {
    if (!canCheck) return

    // Stage-1 accounting (advance predicate)
    if (isStage1) {
      const bucket = snap(R, R_STEP)
      setDistinctR((prev) => (prev.includes(bucket) ? prev : [...prev, bucket]))
      setShotCount((n) => n + 1)
      setFlash('hit') // neutral acknowledgement; no targets in stage 1
      return
    }

    // Stage 2 / 3: check current (v, a) against the first un-hit target
    // that matches within tolerance. Locks that target in.
    const match = activeTargets.find(
      (t) => !hits.includes(t.id) && Math.abs(v - t.v) <= V_TOL && Math.abs(a - t.a) <= A_TOL,
    )

    if (match) {
      setHits((prev) => [...prev, match.id])
      setFlash('hit')
    } else {
      setFlash('miss')
    }
    if (isStage3) setShotsRemaining((n) => n - 1)
  }, [canCheck, isStage1, isStage3, R, v, a, activeTargets, hits])

  // Clear the flash after a beat.
  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash(null), FLASH_MS)
    return () => clearTimeout(t)
  }, [flash])

  // Blind-stage fail-with-restart (§5.2)
  useEffect(() => {
    if (!isStage3) return
    if (shotsRemaining === 0 && flash === null && hits.length < activeTargets.length) {
      resetStageState()
    }
  }, [isStage3, shotsRemaining, flash, hits.length, activeTargets.length, resetStageState])

  // ─── Advance predicate ─────────────────────────────────────────────
  const canSubmit = isStage1
    ? shotCount >= 3 && distinctR.length >= 2 && omegaMoved
    : hits.length === activeTargets.length && activeTargets.length > 0

  const readout = isStage1
    ? `v = ${v.toFixed(1)} m/s · a = ${a.toFixed(1)} m/s²`
    : `${labels.hits} ${hits.length}/${activeTargets.length}`

  useEffect(() => {
    progress(stageIdx / 3, { stage: stageIdx, canSubmit, readout })
  }, [stageIdx, canSubmit, readout, progress])

  useNext(() => {
    if (stageIdx < 3) {
      setStage(stageIdx + 1)
      resetStageState()
    } else {
      complete({ success: true })
    }
  })

  // ─── Peek (blind-stage strategy tips — text only, never the arrows) ─
  const PEEK_TIPS = useMemo(
    () => [labels.peek_tip_invert, labels.peek_tip_misconception, labels.peek_tip_ratio],
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
    const t = setTimeout(() => setPeekTip(null), 4000)
    return () => clearTimeout(t)
  }, [peekTip])

  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  // ─── R drag ────────────────────────────────────────────────────────
  // Drag anywhere on the disk-hit-circle to set R = distance from center
  // (mapped physical → SVG units, then clamped and snapped).
  const svgPoint = (e: React.PointerEvent) => {
    const el = svgRef.current
    if (!el) return null
    const rect = el.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) / rect.width) * W,
      y: ((e.clientY - rect.top) / rect.height) * H,
    }
  }
  const applyRFromPoint = (p: { x: number; y: number }) => {
    const dx = p.x - CENTER.x
    const dy = p.y - CENTER.y
    const svgR = Math.hypot(dx, dy)
    const metres = svgR / PX_PER_M
    const clamped = Math.max(R_MIN, Math.min(R_MAX, metres))
    setR(snap(clamped, R_STEP))
  }
  const diskDown = (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragging(true)
    const p = svgPoint(e)
    if (p) applyRFromPoint(p)
  }
  const svgMove = (e: React.PointerEvent) => {
    if (!dragging) return
    const p = svgPoint(e)
    if (p) applyRFromPoint(p)
  }

  // ─── Grid ──────────────────────────────────────────────────────────
  const gridLines: React.ReactNode[] = []
  for (let gx = 40; gx < W; gx += 60) {
    gridLines.push(<line key={`gx${gx}`} x1={gx} y1={0} x2={gx} y2={H} stroke="#12203a" strokeWidth={1} />)
  }
  for (let gy = 40; gy < H; gy += 60) {
    gridLines.push(<line key={`gy${gy}`} x1={0} y1={gy} x2={W} y2={gy} stroke="#12203a" strokeWidth={1} />)
  }

  // ─── HUD text ──────────────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`
  const hudBL = isStage3 && peekTip
    ? peekTip
    : isStage1
      ? labels.tip1
      : isStage2
        ? labels.tip2
        : labels.tip3
  // BR is reserved (§4.3). Do NOT add a BR overlay.

  const showArrows = !isStage3 // arrows are HELP — hidden on the blind stage
  const showLiveVA = !isStage3 // v/a numeric readouts are also HELP — hidden

  const rSvg = R * PX_PER_M
  const vLen = Math.min(v * V_ARROW_PX_PER, ARROW_MAX_SVG)
  const aLen = Math.min(a * A_ARROW_PX_PER, ARROW_MAX_SVG)

  // Chip layout — top-left cluster
  const CHIP_X = 30
  const CHIP_Y0 = 68
  const CHIP_STEP = 58

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

        {/* Disk + rim */}
        <Disk cx={CENTER.x} cy={CENTER.y} rSvg={rSvg} />

        {/* Invisible pointer-catcher so drag works anywhere inside the max
            orbit region without hijacking the target chips. */}
        <circle
          cx={CENTER.x}
          cy={CENTER.y}
          r={R_MAX * PX_PER_M + 24}
          fill="transparent"
          onPointerDown={diskDown}
          style={{ cursor: dragging ? 'grabbing' : 'grab' }}
        />

        {/* R label near the horizontal radius line, so student can eyeball scale */}
        <line
          x1={CENTER.x}
          y1={CENTER.y}
          x2={CENTER.x + rSvg}
          y2={CENTER.y}
          stroke="#54617A"
          strokeWidth={1}
          strokeDasharray="3 3"
          opacity={0.6}
        />
        <text
          x={CENTER.x + rSvg / 2}
          y={CENTER.y - 6}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={11}
          textAnchor="middle"
        >
          R = {R.toFixed(1)} m
        </text>

        {/* Rim marker + vectors (arrows hidden on stage 3) */}
        <Marker
          cx={CENTER.x}
          cy={CENTER.y}
          theta={theta}
          rSvg={rSvg}
          vLen={vLen}
          aLen={aLen}
          showArrows={showArrows}
          flash={flash}
        />

        {/* Target chips (stages 2 + 3) */}
        {activeTargets.map((t, i) => (
          <TargetChip
            key={t.id}
            x={CHIP_X}
            y={CHIP_Y0 + i * CHIP_STEP}
            label={`${labels.target} ${i + 1}`}
            vTarget={t.v}
            aTarget={t.a}
            hit={hits.includes(t.id)}
          />
        ))}

        {/* Small "no drag" caption below disk to disambiguate */}
        <text
          x={CENTER.x}
          y={H - 22}
          fill="#54617A"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={10}
          textAnchor="middle"
        >
          drag inside disk to resize R
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
          right: '10rem',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '2.3rem',
          letterSpacing: '0.08em',
          color: '#37C9B8',
          zIndex: 5,
          pointerEvents: 'none',
          textAlign: 'right',
        }}
      >
        R = {R.toFixed(1)} m · ω = {omega.toFixed(1)} rad/s
        {showLiveVA && (
          <div style={{ marginTop: '0.6rem', color: '#6C7A93' }}>
            v = {v.toFixed(1)} m/s · a = {a.toFixed(1)} m/s²
          </div>
        )}
        {isStage3 && (
          <div style={{ marginTop: '0.6rem', color: '#F97316' }}>
            {labels.shots} {shotsRemaining}/{SHOT_BUDGET_STAGE3}
          </div>
        )}
        {(isStage2 || isStage3) && (
          <div style={{ marginTop: '0.6rem', color: '#6C7A93' }}>
            {labels.hits} {hits.length}/{activeTargets.length}
          </div>
        )}
      </div>
      <div
        style={{
          position: 'absolute',
          bottom: '3rem',
          left: '3rem',
          maxWidth: '55rem',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '2.3rem',
          letterSpacing: '0.06em',
          color: isStage3 && peekTip ? '#F9A968' : '#6C7A93',
          zIndex: 5,
          pointerEvents: 'none',
          lineHeight: 1.35,
        }}
      >
        {hudBL}
      </div>

      {/* ω slider — vertical, right side */}
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
          {OMEGA_MAX}
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
            min={OMEGA_MIN}
            max={OMEGA_MAX}
            step={OMEGA_STEP}
            value={omega}
            onChange={(e) => {
              setOmega(Number(e.target.value))
              setOmegaMoved(true)
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
          {OMEGA_MIN}
        </div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.7rem', color: '#54617A' }}>
          ω
        </div>
      </div>

      {/* CHECK button */}
      <button
        type="button"
        onClick={check}
        disabled={!canCheck}
        style={{
          position: 'absolute',
          bottom: '3rem',
          left: '50%',
          transform: 'translateX(-50%)',
          padding: '2rem 4rem',
          background: canCheck ? '#F97316' : 'rgba(30,42,64,0.85)',
          color: canCheck ? '#FFFFFF' : '#6C7A93',
          border: `0.3rem solid ${canCheck ? '#F97316' : 'rgba(58,72,99,0.6)'}`,
          borderRadius: '100rem',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '2.6rem',
          fontWeight: 700,
          letterSpacing: '0.12em',
          cursor: canCheck ? 'pointer' : 'not-allowed',
          zIndex: 10,
          transition: 'background 0.15s, transform 0.1s',
        }}
        onMouseDown={(e) => {
          if (canCheck) (e.currentTarget as HTMLButtonElement).style.transform = 'translateX(-50%) scale(0.96)'
        }}
        onMouseUp={(e) => {
          ;(e.currentTarget as HTMLButtonElement).style.transform = 'translateX(-50%) scale(1)'
        }}
        onMouseLeave={(e) => {
          ;(e.currentTarget as HTMLButtonElement).style.transform = 'translateX(-50%) scale(1)'
        }}
      >
        <i
          className="bi bi-check2-circle"
          style={{ marginInlineEnd: '0.8rem', fontSize: '2.8rem', verticalAlign: '-0.2rem' }}
        />
        {labels.fire}
      </button>
    </div>
  )
}
