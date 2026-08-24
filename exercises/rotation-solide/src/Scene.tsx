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
import { TangentArrow } from './art/TangentArrow'

// ─── Scene constants ────────────────────────────────────────────────────
const W = 800
const H = 450

const DISK_CX = 300
const DISK_CY = 225
const DISK_R = 170 // SVG units — outer rim
const PX_PER_M = 340 // rim = 0.5 m → 170 SVG units
const PX_PER_MPS = 12 // tangent-arrow length scale

// Marker radii (m). Kept round for readable r·ω arithmetic.
const R_A = 0.2
const R_B = 0.3
const R_C = 0.5

// Marker angular offsets on the disk (radians, from +x axis, disk frame).
// Spread markers so their arrows don't overlap.
const PHI_A = 0
const PHI_B = (2 * Math.PI) / 3 // 120°
const PHI_C = (4 * Math.PI) / 3 // 240°

const MARKER_COLORS: Record<'A' | 'B' | 'C', string> = {
  A: '#F9A968',
  B: '#37C9B8',
  C: '#B39DFF',
}

// Physics constants
const OMEGA_MIN = 0.5 // rad/s
const OMEGA_MAX = 8.0
const ALPHA_MIN = -2.0 // rad/s²
const ALPHA_MAX = 2.0
const T_MAX = 4.0 // sim seconds per spin
const SPEED_FACTOR = 1.0
const HIT_TOL_MPS = 0.10 // tangential-speed hit tolerance

const DEFAULT_OMEGA0 = 3.0
const DEFAULT_ALPHA = 0.0

// Blind-stage shot budget (§5.2). K = 3 targets → 3 spins.
const SHOTS_STAGE3 = 3

// ─── Setups (hand-authored, seed-picked) ────────────────────────────────
type MarkerId = 'A' | 'B' | 'C'
type TargetSpec = { id: string; marker: MarkerId; vTarget: number }
type Setup = { label: string; targets: TargetSpec[] }

// Stage 2: mostly uniform-rotation (α = 0) situations — teach v = rω first.
const STAGE2_SETUPS: Setup[] = [
  {
    label: 'S2·0',
    targets: [
      { id: 's20a', marker: 'A', vTarget: 0.8 },
      { id: 's20b', marker: 'B', vTarget: 1.2 },
      { id: 's20c', marker: 'C', vTarget: 2.0 },
    ],
  }, // ω = 4, α = 0
  {
    label: 'S2·1',
    targets: [
      { id: 's21a', marker: 'A', vTarget: 1.0 },
      { id: 's21b', marker: 'B', vTarget: 1.5 },
      { id: 's21c', marker: 'C', vTarget: 2.5 },
    ],
  }, // ω = 5, α = 0
  {
    label: 'S2·2',
    targets: [
      { id: 's22a', marker: 'A', vTarget: 0.6 },
      { id: 's22b', marker: 'B', vTarget: 0.9 },
      { id: 's22c', marker: 'C', vTarget: 1.5 },
    ],
  }, // ω = 3, α = 0
  {
    label: 'S2·3',
    targets: [
      { id: 's23a', marker: 'A', vTarget: 1.2 },
      { id: 's23b', marker: 'B', vTarget: 1.8 },
      { id: 's23c', marker: 'C', vTarget: 3.0 },
    ],
  }, // ω = 6, α = 0
  {
    label: 'S2·4',
    targets: [
      { id: 's24a', marker: 'A', vTarget: 0.4 },
      { id: 's24b', marker: 'B', vTarget: 0.6 },
      { id: 's24c', marker: 'C', vTarget: 1.0 },
    ],
  }, // ω = 2, α = 0
]

// Stage 3: sweep + uniform mixed. Each requires paper math.
const STAGE3_SETUPS: Setup[] = [
  {
    label: 'S3·0',
    targets: [
      { id: 's30a', marker: 'A', vTarget: 0.4 },
      { id: 's30b', marker: 'B', vTarget: 1.2 },
      { id: 's30c', marker: 'C', vTarget: 3.0 },
    ],
  }, // sweep 2→6 → ω₀=2, α=1
  {
    label: 'S3·1',
    targets: [
      { id: 's31a', marker: 'A', vTarget: 1.0 },
      { id: 's31b', marker: 'B', vTarget: 1.5 },
      { id: 's31c', marker: 'C', vTarget: 2.5 },
    ],
  }, // uniform ω=5 (trap: no α needed)
  {
    label: 'S3·2',
    targets: [
      { id: 's32a', marker: 'A', vTarget: 1.2 },
      { id: 's32b', marker: 'B', vTarget: 1.2 },
      { id: 's32c', marker: 'C', vTarget: 1.0 },
    ],
  }, // decel sweep 6→2 → ω_A=6, ω_B=4, ω_C=2, α = -1
  {
    label: 'S3·3',
    targets: [
      { id: 's33a', marker: 'A', vTarget: 0.6 },
      { id: 's33b', marker: 'B', vTarget: 1.5 },
      { id: 's33c', marker: 'C', vTarget: 3.5 },
    ],
  }, // sweep 3→7 → ω₀=3, α=1
  {
    label: 'S3·4',
    targets: [
      { id: 's34a', marker: 'A', vTarget: 0.8 },
      { id: 's34b', marker: 'B', vTarget: 1.8 },
      { id: 's34c', marker: 'C', vTarget: 4.0 },
    ],
  }, // sweep 4→8 → ω₀=4, α=1
]

const MARKER_META: Record<MarkerId, { r: number; phi0: number; label: string }> = {
  A: { r: R_A, phi0: PHI_A, label: 'A' },
  B: { r: R_B, phi0: PHI_B, label: 'B' },
  C: { r: R_C, phi0: PHI_C, label: 'C' },
}

const dict = { en } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── Pure physics helpers ───────────────────────────────────────────────
function omegaAt(t: number, omega0: number, alpha: number): number {
  return omega0 + alpha * t
}
function thetaAt(t: number, omega0: number, alpha: number): number {
  return omega0 * t + 0.5 * alpha * t * t
}
function markerXY(cx: number, cy: number, r: number, phi0: number, theta: number) {
  // Screen-space marker position given disk rotation theta.
  // SVG y-axis is inverted: rotating "counter-clockwise in physics" =
  // clockwise on screen. To keep sign-of-ω = sign-of-visual-rotation
  // matching the arrow direction, we invert the y contribution.
  const ang = phi0 + theta
  return {
    x: cx + r * PX_PER_M * Math.cos(ang),
    y: cy - r * PX_PER_M * Math.sin(ang),
  }
}

type Spin = { omega0: number; alpha: number; startedAt: number }
type Trail = { omega0: number; alpha: number }

// ─── Component ──────────────────────────────────────────────────────────
export default function Scene() {
  const { locale, seed } = useInit()
  const stages = useMemo(() => getStagesFor(locale), [locale])
  useDeclareStages(stages)
  const labels = useMemo(() => svgLabels(locale), [locale])

  const stageIdx = useCurrentStage()
  const setStage = useSetStage()

  // Stage-3 setup rotates on retry (fresh seed each attempt)
  const [stage3Offset, setStage3Offset] = useState(0)

  const setup2 = useMemo(
    () => STAGE2_SETUPS[seed % STAGE2_SETUPS.length]!,
    [seed],
  )
  const setup3 = useMemo(
    () => STAGE3_SETUPS[(seed + stage3Offset) % STAGE3_SETUPS.length]!,
    [seed, stage3Offset],
  )

  const [omega0, setOmega0] = useState(DEFAULT_OMEGA0)
  const [alpha, setAlpha] = useState(DEFAULT_ALPHA)
  const [spin, setSpin] = useState<Spin | null>(null)
  const [tSim, setTSim] = useState(0) // current sim time (s)
  const [theta, setTheta] = useState(0) // current disk angle (rad)
  const [hits, setHits] = useState<string[]>([])
  const [shotCount, setShotCount] = useState(0)
  const [distinctOmegas, setDistinctOmegas] = useState<number[]>([])
  const [alphaMoved, setAlphaMoved] = useState(false)
  const [trail, setTrail] = useState<Trail[]>([])
  const [peekTip, setPeekTip] = useState<string | null>(null)
  const [shotsRemaining, setShotsRemaining] = useState(SHOTS_STAGE3)

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  const activeSetup = isStage2 ? setup2 : isStage3 ? setup3 : null
  const activeTargets = activeSetup?.targets ?? []

  const complete = useComplete()
  const progress = useProgress()

  const resetStageState = useCallback(() => {
    setOmega0(DEFAULT_OMEGA0)
    setAlpha(DEFAULT_ALPHA)
    setSpin(null)
    setTSim(0)
    setTheta(0)
    setHits([])
    setShotCount(0)
    setDistinctOmegas([])
    setAlphaMoved(false)
    setTrail([])
    setPeekTip(null)
    setShotsRemaining(SHOTS_STAGE3)
  }, [])
  useReset(resetStageState)

  const canFire = !spin && (!isStage3 || shotsRemaining > 0)
  const fire = useCallback(() => {
    if (!canFire) return
    setSpin({ omega0, alpha, startedAt: performance.now() })
    setTSim(0)
    setTheta(0)
    setShotCount((n) => n + 1)
    if (isStage3) setShotsRemaining((n) => n - 1)
    if (isStage1) {
      const bucket = Math.round(omega0) // 1-rad/s buckets
      setDistinctOmegas((prev) => (prev.includes(bucket) ? prev : [...prev, bucket]))
    }
  }, [canFire, omega0, alpha, isStage1, isStage3])

  // ─── Ticker (angular kinematics sim) ─────────────────────────────────
  useTicker(() => {
    if (!spin) return
    const elapsed = ((performance.now() - spin.startedAt) / 1000) * SPEED_FACTOR
    const t = Math.min(elapsed, T_MAX)
    const w = omegaAt(t, spin.omega0, spin.alpha)
    const th = thetaAt(t, spin.omega0, spin.alpha)
    setTSim(t)
    setTheta(th)

    // Hit test: on each target, marker's tangential speed r·|ω| vs vTarget.
    const newlyHit: string[] = []
    for (const tgt of activeTargets) {
      if (hits.includes(tgt.id)) continue
      const r = MARKER_META[tgt.marker].r
      const v = r * Math.abs(w)
      if (Math.abs(v - tgt.vTarget) < HIT_TOL_MPS) newlyHit.push(tgt.id)
    }
    if (newlyHit.length) setHits((prev) => [...prev, ...newlyHit])

    // End of spin
    if (elapsed >= T_MAX) {
      setSpin(null)
      if (isStage1) {
        setTrail((prev) => [...prev.slice(-2), { omega0: spin.omega0, alpha: spin.alpha }])
      }
    }
  })

  // ─── Blind-stage restart on empty budget (§5.2) ──────────────────────
  useEffect(() => {
    if (!isStage3) return
    if (shotsRemaining === 0 && !spin && hits.length < activeTargets.length) {
      // Rotate setup and reset.
      setStage3Offset((n) => n + 1)
      // Give a beat for React to swap `setup3`, then reset state.
      const id = setTimeout(() => {
        setOmega0(DEFAULT_OMEGA0)
        setAlpha(DEFAULT_ALPHA)
        setSpin(null)
        setTSim(0)
        setTheta(0)
        setHits([])
        setShotCount(0)
        setDistinctOmegas([])
        setAlphaMoved(false)
        setTrail([])
        setShotsRemaining(SHOTS_STAGE3)
      }, 700)
      return () => clearTimeout(id)
    }
    return undefined
  }, [isStage3, shotsRemaining, spin, hits.length, activeTargets.length])

  // ─── Advance predicate ───────────────────────────────────────────────
  const canSubmit = isStage1
    ? shotCount >= 3 && distinctOmegas.length >= 2 && alphaMoved
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

  // ─── Peek: rotating strategy TEXT tips (never visuals) ───────────────
  const PEEK_TIPS = useMemo(
    () => [labels.peek_tip_vromega, labels.peek_tip_uniform, labels.peek_tip_sweep],
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
    const id = setTimeout(() => setPeekTip(null), 4500)
    return () => clearTimeout(id)
  }, [peekTip])

  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  // ─── Derived values ──────────────────────────────────────────────────
  const currentOmega = spin ? omegaAt(tSim, spin.omega0, spin.alpha) : omega0
  const omegaSign = currentOmega >= 0 ? 1 : -1

  // Marker positions in screen space (from current theta)
  const markerA = markerXY(DISK_CX, DISK_CY, R_A, PHI_A, theta)
  const markerB = markerXY(DISK_CX, DISK_CY, R_B, PHI_B, theta)
  const markerC = markerXY(DISK_CX, DISK_CY, R_C, PHI_C, theta)
  const markerXYFor: Record<MarkerId, { x: number; y: number; r: number }> = {
    A: { ...markerA, r: R_A },
    B: { ...markerB, r: R_B },
    C: { ...markerC, r: R_C },
  }

  // Current tangential speed per marker
  const vA = R_A * Math.abs(currentOmega)
  const vB = R_B * Math.abs(currentOmega)
  const vC = R_C * Math.abs(currentOmega)

  // Show arrows (help) on stage 1 + 2 only. Hide on stage 3.
  const showArrows = isStage1 || isStage2

  // Grid for depth
  const gridLines: React.ReactNode[] = []
  for (let gx = 40; gx < W; gx += 60) {
    gridLines.push(<line key={`gx${gx}`} x1={gx} y1={0} x2={gx} y2={H} stroke="#12203a" strokeWidth={1} />)
  }
  for (let gy = 40; gy < H; gy += 60) {
    gridLines.push(<line key={`gy${gy}`} x1={0} y1={gy} x2={W} y2={gy} stroke="#12203a" strokeWidth={1} />)
  }

  // Trail (stage 1): faded previous spins as thin arcs traced by marker C
  function trailArcPath(entry: Trail): string {
    const steps = 32
    const pts: string[] = []
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * T_MAX
      const th = thetaAt(t, entry.omega0, entry.alpha)
      const p = markerXY(DISK_CX, DISK_CY, R_C, PHI_C, th)
      pts.push(`${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    }
    return pts.join(' ')
  }

  // Stage name for HUD
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`
  const hudTR1 = `ω₀ = ${omega0.toFixed(1)} · α = ${alpha.toFixed(2)}`
  const hudTR2 = spin
    ? `ω = ${currentOmega.toFixed(2)} rad/s · ${labels.time} = ${tSim.toFixed(2)} s`
    : `${labels.hits} ${hits.length}/${activeTargets.length || 0}`
  const hudBL = isStage3 && peekTip
    ? peekTip
    : isStage1
      ? labels.tip1
      : isStage2
        ? labels.tip2
        : labels.tip3

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
        {/* NO borderRadius on <svg>. NO rx on this bg rect. */}
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />
        {gridLines}

        {/* Stage-1 trail: last spin arcs (marker C's path) */}
        {isStage1 &&
          trail.map((entry, i) => (
            <path
              key={i}
              d={trailArcPath(entry)}
              fill="none"
              stroke="#F97316"
              strokeWidth={1.4}
              strokeDasharray="2 5"
              opacity={0.18 + i * 0.14}
            />
          ))}

        {/* Disk */}
        <Disk
          cx={DISK_CX}
          cy={DISK_CY}
          radius={DISK_R}
          guideRadii={[R_A * PX_PER_M, R_B * PX_PER_M, R_C * PX_PER_M]}
          thetaRad={theta}
        />

        {/* Markers */}
        {(['A', 'B', 'C'] as MarkerId[]).map((m) => {
          const meta = MARKER_META[m]
          const pos = markerXYFor[m]
          // Marker is "hit" if any of its targets have been cleared this spin.
          const hitFlag = activeTargets.some(
            (t) => t.marker === m && hits.includes(t.id),
          )
          return (
            <Marker
              key={m}
              x={pos.x}
              y={pos.y}
              color={MARKER_COLORS[m]}
              label={meta.label}
              hit={hitFlag}
            />
          )
        })}

        {/* Tangential arrows (help — hidden on stage 3) */}
        {showArrows && (
          <>
            <TangentArrow
              cx={DISK_CX}
              cy={DISK_CY}
              mx={markerA.x}
              my={markerA.y}
              vMps={vA}
              omegaSign={omegaSign}
              pxPerMps={PX_PER_MPS}
              color={MARKER_COLORS.A}
            />
            <TangentArrow
              cx={DISK_CX}
              cy={DISK_CY}
              mx={markerB.x}
              my={markerB.y}
              vMps={vB}
              omegaSign={omegaSign}
              pxPerMps={PX_PER_MPS}
              color={MARKER_COLORS.B}
            />
            <TangentArrow
              cx={DISK_CX}
              cy={DISK_CY}
              mx={markerC.x}
              my={markerC.y}
              vMps={vC}
              omegaSign={omegaSign}
              pxPerMps={PX_PER_MPS}
              color={MARKER_COLORS.C}
            />
          </>
        )}

        {/* Axis label */}
        <text
          x={DISK_CX}
          y={DISK_CY + DISK_R + 22}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={11}
          textAnchor="middle"
        >
          fixed axis · rigid disk
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

      {/* TR: readouts (top line + secondary) */}
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
        <div style={{ marginTop: '0.6rem', color: '#6C7A93', fontSize: '1.9rem' }}>{hudTR2}</div>
      </div>

      {/* BL: tip / peek text */}
      <div
        style={{
          position: 'absolute',
          bottom: '3rem',
          left: '3rem',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '2.0rem',
          letterSpacing: '0.06em',
          color: peekTip ? '#F9A968' : '#6C7A93',
          maxWidth: '52rem',
          lineHeight: 1.4,
          zIndex: 5,
          pointerEvents: 'none',
        }}
      >
        {hudBL}
      </div>

      {/* BR intentionally empty (§4.3 — reserved for parent chrome). */}

      {/* Target panel — below TL */}
      {activeTargets.length > 0 && (
        <div
          style={{
            position: 'absolute',
            top: '9rem',
            left: '3rem',
            padding: '1.2rem 1.6rem',
            background: 'rgba(21, 34, 56, 0.72)',
            border: '0.15rem solid rgba(58, 72, 99, 0.55)',
            borderRadius: '0.6rem',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '1.9rem',
            letterSpacing: '0.06em',
            color: '#B9C4D6',
            zIndex: 5,
            pointerEvents: 'none',
            minWidth: '22rem',
          }}
        >
          <div style={{ fontSize: '1.5rem', color: '#54617A', letterSpacing: '0.14em', marginBottom: '0.8rem' }}>
            {labels.targets}
          </div>
          {activeTargets.map((t) => {
            const meta = MARKER_META[t.marker]
            const isHit = hits.includes(t.id)
            return (
              <div
                key={t.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.8rem',
                  marginTop: '0.4rem',
                  opacity: isHit ? 0.55 : 1,
                }}
              >
                <span
                  style={{
                    display: 'inline-block',
                    width: '1.4rem',
                    height: '1.4rem',
                    borderRadius: '50%',
                    background: MARKER_COLORS[t.marker],
                  }}
                />
                <span style={{ color: '#EAF0FA', fontWeight: 700 }}>{meta.label}</span>
                {isStage3 && (
                  <span style={{ color: '#6C7A93', fontSize: '1.6rem' }}>
                    r={meta.r.toFixed(2)}m
                  </span>
                )}
                <span style={{ color: '#54617A' }}>→</span>
                <span style={{ color: '#37C9B8' }}>{t.vTarget.toFixed(2)} m/s</span>
                {isHit && (
                  <span style={{ color: '#37C9B8', marginInlineStart: '0.4rem' }}>✓</span>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ω₀ slider — vertical, right side */}
      <div
        style={{
          position: 'absolute',
          top: '16rem',
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
          {OMEGA_MAX.toFixed(0)}
        </div>
        <div
          style={{
            width: '2rem',
            height: '24rem',
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
            step={0.1}
            value={omega0}
            onChange={(e) => setOmega0(Number(e.target.value))}
            style={{
              width: '24rem',
              height: '2rem',
              transform: 'rotate(-90deg)',
              transformOrigin: 'center',
              accentColor: '#37C9B8',
              cursor: 'pointer',
            }}
          />
        </div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.7rem', color: '#6C7A93' }}>
          {OMEGA_MIN.toFixed(1)}
        </div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.7rem', color: '#54617A' }}>
          ω₀
        </div>
      </div>

      {/* α slider — horizontal, above the SPIN button */}
      <div
        style={{
          position: 'absolute',
          bottom: '11rem',
          left: '50%',
          transform: 'translateX(-50%)',
          width: '38rem',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '0.4rem',
          zIndex: 6,
          pointerEvents: 'auto',
        }}
      >
        <input
          type="range"
          min={ALPHA_MIN}
          max={ALPHA_MAX}
          step={0.05}
          value={alpha}
          onChange={(e) => {
            setAlpha(Number(e.target.value))
            setAlphaMoved(true)
          }}
          style={{
            width: '100%',
            height: '2rem',
            accentColor: '#F97316',
            cursor: 'pointer',
          }}
        />
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            width: '100%',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '1.5rem',
            color: '#54617A',
          }}
        >
          <span>{ALPHA_MIN.toFixed(1)}</span>
          <span style={{ color: '#6C7A93' }}>α · rad/s²</span>
          <span>+{ALPHA_MAX.toFixed(1)}</span>
        </div>
      </div>

      {/* SPIN button (bottom-center) */}
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
          className="bi bi-arrow-clockwise"
          style={{ marginInlineEnd: '0.8rem', fontSize: '2.8rem', verticalAlign: '-0.2rem' }}
        />
        {labels.spin}
        {isStage3 && (
          <span style={{ marginInlineStart: '1.2rem', fontSize: '1.9rem', color: canFire ? '#FFE4CC' : '#54617A' }}>
            {shotsRemaining}/{SHOTS_STAGE3}
          </span>
        )}
      </button>
    </div>
  )
}
