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
import { IonSource } from './art/IonSource'
import { Accelerator } from './art/Accelerator'
import { FieldRegion } from './art/FieldRegion'
import { DetectorCell } from './art/DetectorCell'
import { Ion } from './art/Ion'

// ─── Scene constants ────────────────────────────────────────────────────
const W = 800
const H = 450

// Ion source outlet (right edge of source chamber) — beam launches to +x.
const SOURCE = { x: 60, y: 90 }
// Accelerator plates flanking the beam.
const ACC_X1 = 100 // + plate
const ACC_X2 = 170 // − plate
const ACC_HEIGHT = 44
// Entry point into the magnetic-field region — ion arrives here moving +x
// at speed v = sqrt(2·U/m) (q folded to 1 in exercise units).
const ENTRY = { x: 200, y: 90 }
// Field region rectangle.
const FIELD = { x: 200, y: 45, width: 520, height: 380 }
// Vertical detector strip on the LEFT boundary of the field, just inside
// the entry x. Ion exits the semi-circle back at x = 200 (the entry x),
// travelling in the −x direction, and slams into a cell along this strip.
const DETECTOR = { xCenter: 190, halfWidth: 10, yTop: 95, yBottom: 420 }

// Sliders — exercise units (see brief §9): treated as V, mT, u.
const U_MIN = 500
const U_MAX = 3000
const U_STEP = 50
const B_MIN = 4
const B_MAX = 15
const B_STEP = 0.5
const DEFAULT_U = 1500
const DEFAULT_B = 8

// Sim speed factor — game-feel tuning. Typical flight ≈ 1.2 s.
const SPEED_FACTOR = 8
// Hit tolerance on the radius axis, in mm (= SVG units).
const HIT_TOL_STAGE2 = 5
const HIT_TOL_STAGE3 = 4
// Stage-3 shot budget = one shot per ion in the queue.
const STAGE3_SHOTS = 3
// Stage-1 reference ion (fixed mass while student explores U/B).
const REF_ION_MASS = 20

// ─── Setups ──────────────────────────────────────────────────────────────
type IonTarget = { id: string; m: number; targetR: number } // targetR in mm
type Setup = { targets: IonTarget[] }

// Stage 2 (experiment) — 5 setups; each has 3 ions of distinct mass
// pointing at 3 distinct detector radii. All (U, B) solutions live inside
// the slider ranges.
const STAGE2_SETUPS: Setup[] = [
  {
    targets: [
      { id: 'a1', m: 20, targetR: 40 },
      { id: 'a2', m: 40, targetR: 60 },
      { id: 'a3', m: 60, targetR: 80 },
    ],
  },
  {
    targets: [
      { id: 'b1', m: 16, targetR: 35 },
      { id: 'b2', m: 32, targetR: 55 },
      { id: 'b3', m: 48, targetR: 75 },
    ],
  },
  {
    targets: [
      { id: 'c1', m: 24, targetR: 45 },
      { id: 'c2', m: 40, targetR: 70 },
      { id: 'c3', m: 56, targetR: 90 },
    ],
  },
  {
    targets: [
      { id: 'd1', m: 12, targetR: 45 },
      { id: 'd2', m: 28, targetR: 65 },
      { id: 'd3', m: 44, targetR: 85 },
    ],
  },
  {
    targets: [
      { id: 'e1', m: 20, targetR: 50 },
      { id: 'e2', m: 36, targetR: 70 },
      { id: 'e3', m: 52, targetR: 90 },
    ],
  },
]

// Stage 3 (evaluate) — 5 harder setups; wider R spread, mixed masses.
const STAGE3_SETUPS: Setup[] = [
  {
    targets: [
      { id: '3a1', m: 14, targetR: 45 },
      { id: '3a2', m: 32, targetR: 70 },
      { id: '3a3', m: 52, targetR: 95 },
    ],
  },
  {
    targets: [
      { id: '3b1', m: 18, targetR: 40 },
      { id: '3b2', m: 36, targetR: 65 },
      { id: '3b3', m: 54, targetR: 90 },
    ],
  },
  {
    targets: [
      { id: '3c1', m: 22, targetR: 50 },
      { id: '3c2', m: 40, targetR: 75 },
      { id: '3c3', m: 58, targetR: 95 },
    ],
  },
  {
    targets: [
      { id: '3d1', m: 16, targetR: 45 },
      { id: '3d2', m: 34, targetR: 70 },
      { id: '3d3', m: 50, targetR: 90 },
    ],
  },
  {
    targets: [
      { id: '3e1', m: 24, targetR: 55 },
      { id: '3e2', m: 40, targetR: 80 },
      { id: '3e3', m: 56, targetR: 95 },
    ],
  },
]

// ─── Physics helpers (inline — no shared package) ────────────────────────
// R (mm) = sqrt(2 · U · m) / B, with q folded to 1 in exercise units.
function radiusOf(U: number, B: number, m: number): number {
  if (B <= 0) return 0
  return Math.sqrt(2 * U * m) / B
}
// Ion speed in exercise units (arbitrary "mm/s"): v = sqrt(2·U/m).
function speedOf(U: number, m: number): number {
  return Math.sqrt(Math.max(0, (2 * U) / Math.max(m, 0.001)))
}
// SVG position along the semi-circle. θ ∈ [0, π], θ=0 at entry, θ=π at
// exit. Center at (ENTRY.x, ENTRY.y + R). x-motion moves +x then −x.
function arcPoint(R: number, theta: number): { x: number; y: number } {
  return {
    x: ENTRY.x + R * Math.sin(theta),
    y: ENTRY.y + R * (1 - Math.cos(theta)),
  }
}
// SVG arc path for a preview / trail semi-circle of radius R starting at
// ENTRY, sweep-flag=1 (clockwise as rendered with y-down).
function arcPath(R: number): string {
  const x0 = ENTRY.x
  const y0 = ENTRY.y
  const x1 = ENTRY.x
  const y1 = ENTRY.y + 2 * R
  return `M ${x0} ${y0} A ${R} ${R} 0 0 1 ${x1} ${y1}`
}

// ─── Locale routing ──────────────────────────────────────────────────────
const dict = { en } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── Types ───────────────────────────────────────────────────────────────
type Flight = {
  ionId: string
  m: number
  U: number
  B: number
  R_svg: number
  speed: number
  startedAt: number
}
type TrailShot = { R_svg: number; m: number }

// ─── Component ───────────────────────────────────────────────────────────
export default function Scene() {
  const { locale, seed } = useInit()
  const stages = useMemo(() => getStagesFor(locale), [locale])
  useDeclareStages(stages)
  const labels = useMemo(() => svgLabels(locale), [locale])

  const stageIdx = useCurrentStage()
  const setStage = useSetStage()
  const complete = useComplete()
  const progress = useProgress()

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  // Rotating setup for stage 3 (fresh seed on each failure).
  const [stage3Attempt, setStage3Attempt] = useState(0)

  const setup2 = useMemo(() => STAGE2_SETUPS[seed % STAGE2_SETUPS.length]!, [seed])
  const setup3 = useMemo(
    () => STAGE3_SETUPS[(seed + stage3Attempt) % STAGE3_SETUPS.length]!,
    [seed, stage3Attempt],
  )

  const activeSetup = isStage2 ? setup2 : isStage3 ? setup3 : null
  const activeTargets = activeSetup?.targets ?? []

  // ─── Controls state ────────────────────────────────────────────────────
  const [U, setU] = useState(DEFAULT_U)
  const [B, setB] = useState(DEFAULT_B)
  const [ionPos, setIonPos] = useState<{ x: number; y: number } | null>(null)
  const [flight, setFlight] = useState<Flight | null>(null)

  // Queue index — which target's ion is loaded next.
  const [queueIdx, setQueueIdx] = useState(0)
  // Correct hits (target ids that landed on their matching cell).
  const [hits, setHits] = useState<string[]>([])
  // Last landing marker (small dot on detector strip).
  const [landing, setLanding] = useState<{ y: number; correct: boolean } | null>(null)

  // Stage-1 advance accounting.
  const [shotCount, setShotCount] = useState(0)
  const [distinctU, setDistinctU] = useState<number[]>([])
  const [BMoved, setBMoved] = useState(false)
  const [trail, setTrail] = useState<TrailShot[]>([])

  // Stage-3 shot budget.
  const [shotsRemaining, setShotsRemaining] = useState(STAGE3_SHOTS)

  // Peek strategy tip (stage 3 only).
  const [peekTip, setPeekTip] = useState<string | null>(null)
  const peekIdxRef = useRef(0)

  // ─── Loaded ion for the active stage ───────────────────────────────────
  const loadedTarget: IonTarget | null = isStage1
    ? { id: 'ref', m: REF_ION_MASS, targetR: 0 }
    : queueIdx < activeTargets.length
      ? activeTargets[queueIdx] ?? null
      : null
  const loadedMass = loadedTarget?.m ?? REF_ION_MASS

  // Current-radius preview (for HUD readout + preview arc on stage 2).
  const previewR = useMemo(() => radiusOf(U, B, loadedMass), [U, B, loadedMass])

  // ─── Reset ─────────────────────────────────────────────────────────────
  const resetStageState = useCallback(() => {
    setU(DEFAULT_U)
    setB(DEFAULT_B)
    setFlight(null)
    setIonPos(null)
    setLanding(null)
    setHits([])
    setQueueIdx(0)
    setShotCount(0)
    setDistinctU([])
    setBMoved(false)
    setTrail([])
    setShotsRemaining(STAGE3_SHOTS)
    setPeekTip(null)
  }, [])
  useReset(resetStageState)

  // ─── Fire ──────────────────────────────────────────────────────────────
  const canFire =
    !flight &&
    loadedTarget !== null &&
    (!isStage3 || shotsRemaining > 0) &&
    (isStage1 || queueIdx < activeTargets.length)

  const fire = useCallback(() => {
    if (!canFire || !loadedTarget) return
    const m = loadedTarget.m
    const R = radiusOf(U, B, m)
    const v = speedOf(U, m)
    setFlight({
      ionId: loadedTarget.id,
      m,
      U,
      B,
      R_svg: R,
      speed: v,
      startedAt: performance.now(),
    })
    setIonPos({ x: ENTRY.x, y: ENTRY.y })
    setLanding(null)
    setShotCount((n) => n + 1)
    if (isStage1) {
      const bucket = Math.round(U / 250) * 250
      setDistinctU((prev) => (prev.includes(bucket) ? prev : [...prev, bucket]))
    }
    if (isStage3) setShotsRemaining((n) => n - 1)
  }, [canFire, loadedTarget, U, B, isStage1, isStage3])

  // ─── Sim ticker ────────────────────────────────────────────────────────
  useTicker(() => {
    if (!flight) return
    const R = flight.R_svg
    if (R <= 0.5) {
      // Ion never leaves the entry — treat as instant landing at entry y.
      finishFlight(flight, ENTRY.y)
      return
    }
    const tReal = (performance.now() - flight.startedAt) / 1000
    const tSim = tReal * SPEED_FACTOR
    const omega = flight.speed / R
    const theta = omega * tSim
    if (theta >= Math.PI) {
      const landingY = ENTRY.y + 2 * R
      finishFlight(flight, landingY)
    } else {
      const p = arcPoint(R, theta)
      setIonPos(p)
    }
  })

  // Ends a flight: record landing, hit-test, advance queue.
  function finishFlight(f: Flight, landingY: number) {
    setFlight(null)
    const finalPoint = { x: ENTRY.x, y: landingY }
    setIonPos(finalPoint)
    if (isStage1) {
      setTrail((prev) => [...prev.slice(-2), { R_svg: f.R_svg, m: f.m }])
      setLanding({ y: landingY, correct: false })
      return
    }
    // Stage 2 / 3: check landing against loaded target's cell.
    const target = activeTargets[queueIdx]
    if (!target) return
    const tol = isStage3 ? HIT_TOL_STAGE3 : HIT_TOL_STAGE2
    const isHit = Math.abs(f.R_svg - target.targetR) <= tol
    setLanding({ y: landingY, correct: isHit })
    if (isHit) {
      setHits((prev) => (prev.includes(target.id) ? prev : [...prev, target.id]))
    }
    if (isStage2) {
      // Advance queue only on hit; miss = retry same ion.
      if (isHit) setQueueIdx((n) => n + 1)
    } else if (isStage3) {
      // One shot per ion — always advance.
      setQueueIdx((n) => n + 1)
    }
  }

  // ─── Stage-3 fail-with-reset ──────────────────────────────────────────
  useEffect(() => {
    if (!isStage3) return
    if (flight) return
    if (shotsRemaining > 0) return
    // Budget exhausted — did we clear all targets?
    if (hits.length === activeTargets.length && activeTargets.length > 0) return
    // Fail: rotate to next setup and reset stage state.
    const t = setTimeout(() => {
      setStage3Attempt((n) => n + 1)
      resetStageState()
    }, 900)
    return () => clearTimeout(t)
  }, [isStage3, shotsRemaining, flight, hits.length, activeTargets.length, resetStageState])

  // ─── Advance predicate ────────────────────────────────────────────────
  const canSubmit = isStage1
    ? shotCount >= 3 && distinctU.length >= 2 && BMoved
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

  // ─── Peek (strategy tip, never the arc) ───────────────────────────────
  const PEEK_TIPS = useMemo(
    () => [labels.peek_tip_scaling, labels.peek_tip_solve_b, labels.peek_tip_solve_u],
    [labels],
  )
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

  // ─── Grid ─────────────────────────────────────────────────────────────
  const gridLines: React.ReactNode[] = []
  for (let gx = 40; gx < W; gx += 60) {
    gridLines.push(<line key={`gx${gx}`} x1={gx} y1={0} x2={gx} y2={H} stroke="#12203a" strokeWidth={1} />)
  }
  for (let gy = 40; gy < H; gy += 60) {
    gridLines.push(<line key={`gy${gy}`} x1={0} y1={gy} x2={W} y2={gy} stroke="#12203a" strokeWidth={1} />)
  }

  // ─── HUD ──────────────────────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const showPreviewArc = isStage2 && !flight && previewR > 0.5

  const tip = isStage1 ? labels.tip1 : isStage2 ? labels.tip2 : labels.tip3
  const hudBL = isStage3 && peekTip ? peekTip : tip

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

        {/* Magnetic-field region behind the arc */}
        <FieldRegion x={FIELD.x} y={FIELD.y} width={FIELD.width} height={FIELD.height} />

        {/* "B ⊙ out of page" caption near the top of the field */}
        <text
          x={FIELD.x + FIELD.width - 12}
          y={FIELD.y + 16}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={10}
          textAnchor="end"
        >
          B ⊙ out of page
        </text>

        {/* Detector strip backdrop */}
        <rect
          x={DETECTOR.xCenter - DETECTOR.halfWidth}
          y={DETECTOR.yTop}
          width={DETECTOR.halfWidth * 2}
          height={DETECTOR.yBottom - DETECTOR.yTop}
          fill="#111C33"
          stroke="#2A3244"
          strokeWidth={1}
          rx={2}
        />
        <text
          x={DETECTOR.xCenter}
          y={DETECTOR.yBottom + 14}
          fill="#54617A"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={9}
          textAnchor="middle"
        >
          {labels.detector}
        </text>

        {/* Detector cells (stages 2 & 3) */}
        {!isStage1 &&
          activeTargets.map((t, idx) => {
            const cellY = ENTRY.y + 2 * t.targetR
            const isCurrent = idx === queueIdx
            const wasHit = hits.includes(t.id)
            return (
              <g key={t.id}>
                <DetectorCell
                  x={DETECTOR.xCenter}
                  y={cellY}
                  width={DETECTOR.halfWidth * 2 - 2}
                  height={9}
                  hit={wasHit}
                />
                {/* Focus ring around currently-loaded ion's cell */}
                {isCurrent && !wasHit && (
                  <rect
                    x={DETECTOR.xCenter - DETECTOR.halfWidth - 3}
                    y={cellY - 7}
                    width={DETECTOR.halfWidth * 2 + 6}
                    height={14}
                    fill="none"
                    stroke="#F97316"
                    strokeWidth={1.2}
                    strokeDasharray="3 3"
                    rx={2}
                  />
                )}
                {/* Cell label (mass — always; radius — stage 3 required info) */}
                <text
                  x={DETECTOR.xCenter - DETECTOR.halfWidth - 8}
                  y={cellY - 1}
                  fill={wasHit ? '#37C9B8' : isCurrent ? '#F9A968' : '#8797B0'}
                  fontFamily="'JetBrains Mono', monospace"
                  fontSize={10}
                  textAnchor="end"
                >
                  {labels.cell_prefix} {t.m} {labels.m_unit}
                </text>
                {isStage3 && (
                  <text
                    x={DETECTOR.xCenter - DETECTOR.halfWidth - 8}
                    y={cellY + 10}
                    fill={wasHit ? '#37C9B8' : isCurrent ? '#F9A968' : '#54617A'}
                    fontFamily="'JetBrains Mono', monospace"
                    fontSize={8}
                    textAnchor="end"
                  >
                    R = {t.targetR} {labels.r_unit}
                  </text>
                )}
              </g>
            )
          })}

        {/* Stage-1 trail — fading semi-circles of last 2–3 shots */}
        {isStage1 &&
          trail.map((t, i) => (
            <path
              key={`trail-${i}`}
              d={arcPath(t.R_svg)}
              fill="none"
              stroke="#F97316"
              strokeWidth={1.2}
              strokeDasharray="2 5"
              opacity={0.18 + i * 0.14}
            />
          ))}

        {/* Preview arc — stage 2 only, hidden during flight */}
        {showPreviewArc && (
          <path
            d={arcPath(previewR)}
            fill="none"
            stroke="#37C9B8"
            strokeWidth={1.4}
            strokeDasharray="4 5"
            opacity={0.7}
          />
        )}

        {/* Landing marker on the detector after a shot ends */}
        {landing && !flight && (
          <g>
            <circle
              cx={ENTRY.x}
              cy={landing.y}
              r={5.5}
              fill="none"
              stroke={landing.correct ? '#37C9B8' : '#F97316'}
              strokeWidth={1.4}
              opacity={0.9}
            />
            <circle
              cx={ENTRY.x}
              cy={landing.y}
              r={2}
              fill={landing.correct ? '#37C9B8' : '#F97316'}
            />
          </g>
        )}

        {/* Ion source + accelerator */}
        <IonSource x={SOURCE.x} y={SOURCE.y} />
        <text
          x={SOURCE.x - 22}
          y={SOURCE.y + 30}
          fill="#54617A"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={8}
          textAnchor="middle"
        >
          {labels.ion_source}
        </text>
        <Accelerator x1={ACC_X1} x2={ACC_X2} y={SOURCE.y} height={ACC_HEIGHT} />
        <text
          x={(ACC_X1 + ACC_X2) / 2}
          y={SOURCE.y + ACC_HEIGHT / 2 + 12}
          fill="#54617A"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={8}
          textAnchor="middle"
        >
          {labels.accelerator}
        </text>
        {/* Beam guide from + plate to entry */}
        <line
          x1={SOURCE.x}
          y1={SOURCE.y}
          x2={ENTRY.x}
          y2={ENTRY.y}
          stroke="#2E3A57"
          strokeWidth={0.8}
          strokeDasharray="2 3"
        />

        {/* Live ion during flight */}
        {flight && ionPos && <Ion x={ionPos.x} y={ionPos.y} />}
      </svg>

      {/* ─── HUD overlays (HTML in rem) ────────────────────────────── */}
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
        <div>
          {labels.stage} 0{stageIdx} · {stageName}
        </div>
        {!isStage1 && (
          <div style={{ marginTop: '0.6rem', fontSize: '1.9rem', color: '#F9A968' }}>
            {labels.loaded} · m = {loadedMass} {labels.m_unit}
          </div>
        )}
        {isStage3 && (
          <div style={{ marginTop: '0.4rem', fontSize: '1.9rem', color: '#8797B0' }}>
            {labels.shots} {shotsRemaining}/{STAGE3_SHOTS}
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
        <div>
          {labels.u_label} = {U} {labels.u_unit}
        </div>
        <div style={{ marginTop: '0.4rem' }}>
          {labels.b_label} = {B.toFixed(1)} {labels.b_unit}
        </div>
        <div style={{ marginTop: '0.4rem', fontSize: '1.9rem', color: '#8797B0' }}>
          R = {previewR.toFixed(1)} {labels.r_unit}
        </div>
        {!isStage1 && (
          <div style={{ marginTop: '0.4rem', fontSize: '1.9rem', color: '#6C7A93' }}>
            {labels.hits} {hits.length}/{activeTargets.length}
          </div>
        )}
      </div>

      <div
        style={{
          position: 'absolute',
          bottom: '3rem',
          left: '3rem',
          maxWidth: '60%',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: peekTip ? '1.9rem' : '2.3rem',
          letterSpacing: '0.06em',
          color: peekTip ? '#F9A968' : '#6C7A93',
          zIndex: 5,
          pointerEvents: 'none',
          lineHeight: 1.35,
        }}
      >
        {hudBL}
      </div>
      {/* BR-corner intentionally empty — reserved for parent chrome. */}

      {/* B slider (left vertical) */}
      <SliderColumn
        label={labels.b_label}
        unit={labels.b_unit}
        min={B_MIN}
        max={B_MAX}
        step={B_STEP}
        value={B}
        color="#37C9B8"
        onChange={(v) => {
          setB(v)
          setBMoved(true)
        }}
        anchor="left"
      />

      {/* U slider (right vertical) */}
      <SliderColumn
        label={labels.u_label}
        unit={labels.u_unit}
        min={U_MIN}
        max={U_MAX}
        step={U_STEP}
        value={U}
        color="#F97316"
        onChange={setU}
        anchor="right"
      />

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
          className="bi bi-crosshair"
          style={{ marginInlineEnd: '0.8rem', fontSize: '2.8rem', verticalAlign: '-0.2rem' }}
        />
        {labels.fire}
      </button>
    </div>
  )
}

// ─── Slider column ────────────────────────────────────────────────────────
function SliderColumn({
  label,
  unit,
  min,
  max,
  step,
  value,
  color,
  onChange,
  anchor,
}: {
  label: string
  unit: string
  min: number
  max: number
  step: number
  value: number
  color: string
  onChange: (v: number) => void
  anchor: 'left' | 'right'
}) {
  const side = anchor === 'left' ? { left: '3rem' } : { right: '3rem' }
  const display = step >= 1 ? Math.round(value).toString() : value.toFixed(1)
  return (
    <div
      style={{
        position: 'absolute',
        top: '14rem',
        ...side,
        height: '40rem',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '0.6rem',
        zIndex: 6,
      }}
    >
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.7rem', color: '#6C7A93' }}>
        {max}
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
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{
            width: '30rem',
            height: '2rem',
            transform: 'rotate(-90deg)',
            transformOrigin: 'center',
            accentColor: color,
            cursor: 'pointer',
          }}
        />
      </div>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.7rem', color: '#6C7A93' }}>
        {min}
      </div>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.7rem', color }}>
        {label} = {display} {unit}
      </div>
    </div>
  )
}
