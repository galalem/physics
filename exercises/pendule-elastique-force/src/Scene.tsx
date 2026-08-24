import { useCallback, useEffect, useMemo, useState } from 'react'
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
  useSeed,
  useSetStage,
  useTicker,
} from '@physics/sdk/react'
import { getHintFor, getStagesFor } from './stages'
import en from '../i18n/en.json'
import { Wall } from './art/Wall'
import { Spring } from './art/Spring'
import { Damper } from './art/Damper'
import { Mass } from './art/Mass'
import { Driver } from './art/Driver'

// ─── Scene constants ────────────────────────────────────────────────────
const W = 800
const H = 450

// Left panel: mechanical schematic
const SCH_X = 32
const SCH_Y = 60
const SCH_W = 360
const SCH_H = 350

// Right panel: x(t) plot
const PLOT_X = 412
const PLOT_Y = 60
const PLOT_W = 250
const PLOT_H = 350

// Schematic layout (SVG units, inside the schematic panel)
const WALL_X = SCH_X + 32
const REST_X = SCH_X + 250
const BASE_Y = SCH_Y + 190
const DAMPER_Y = BASE_Y + 32
const MASS_W = 46
// Convert x_meters → SVG pixels (in the schematic)
const SCALE_PX_PER_M = 400

// ─── Physics constants ──────────────────────────────────────────────────
const M = 0.1 // kg
const K = 10 // N/m  → ω0 = 10 rad/s
const F0 = 0.2 // N
const OMEGA0 = Math.sqrt(K / M) // 10 rad/s
const OMEGA_MIN = 2
const OMEGA_MAX = 20
const OMEGA_DEFAULT = 6
const H_MIN = 0.2
const H_MAX = 1.0
const H_DEFAULT = 0.6

const T_SIM_MAX = 4 // seconds displayed on chart
const Y_MAX_M = 0.12 // chart y half-range (±12 cm)

const STAGE2_TOL = 0.05 // ±5% on amplitude
const STAGE3_TOL_A = 0.05 // ±5% on amplitude
const STAGE3_TOL_OMEGA = 0.05 // ±5% on Ω

// ─── Seeded targets ─────────────────────────────────────────────────────
// Stage 2: hand-authored target amplitudes A* (m). Each achievable at multiple (Ω, h).
const STAGE2_TARGETS: { aStar: number }[] = [
  { aStar: 0.03 }, // 3.0 cm — near-resonance moderate
  { aStar: 0.02 }, // 2.0 cm — quasi-static, achievable off-resonance
  { aStar: 0.04 }, // 4.0 cm — resonance with h=0.5
  { aStar: 0.025 }, // 2.5 cm — sub-resonance
  { aStar: 0.035 }, // 3.5 cm — near-resonance with modest h
]

// Stage 3: hand-authored (Ω*, h*) pairs — student must match BOTH amplitude and period.
const STAGE3_TARGETS: { omegaStar: number; hStar: number }[] = [
  { omegaStar: 6, hStar: 0.5 }, // T ≈ 1.05 s, A ≈ 2.83 cm — sub-resonance
  { omegaStar: 12, hStar: 0.4 }, // T ≈ 0.52 s, A ≈ 3.07 cm — supra-resonance
  { omegaStar: 8, hStar: 0.6 }, // T ≈ 0.79 s, A ≈ 3.33 cm — approach to resonance
  { omegaStar: 10, hStar: 0.7 }, // T ≈ 0.63 s, A ≈ 2.86 cm — exactly at ω0
  { omegaStar: 4, hStar: 0.5 }, // T ≈ 1.57 s, A ≈ 2.32 cm — well below ω0
]

const dict = { en } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── Physics helpers ────────────────────────────────────────────────────
/** Steady-state amplitude A(Ω, h). */
function amplitude(omega: number, h: number): number {
  const stiffness = K - M * omega * omega
  const damp = h * omega
  return F0 / Math.sqrt(stiffness * stiffness + damp * damp)
}

/** Steady-state phase lag φ(Ω, h) ∈ [0, π). */
function phase(omega: number, h: number): number {
  return Math.atan2(h * omega, K - M * omega * omega)
}

/** Formatter for amplitude display (cm). */
function fmtCm(aMeters: number): string {
  return `${(aMeters * 100).toFixed(2)} cm`
}

// ─── Coordinate helpers ─────────────────────────────────────────────────
function tToSvgX(t: number): number {
  return PLOT_X + (t / T_SIM_MAX) * PLOT_W
}
function xMetersToSvgY(xM: number): number {
  return PLOT_Y + PLOT_H / 2 - (xM / Y_MAX_M) * (PLOT_H / 2)
}

/**
 * Analytic sample of x(t) = A·cos(Ω·t − φ) as an SVG path.
 * `tMax` bounds the horizontal extent drawn (used as an animation cursor
 * when tMax < T_SIM_MAX).
 */
function cosineCurvePath(omega: number, h: number, tMax: number): string {
  const A = amplitude(omega, h)
  const phi = phase(omega, h)
  const steps = 200
  const tEnd = Math.min(tMax, T_SIM_MAX)
  if (tEnd <= 0) return ''
  let d = ''
  const n = Math.max(4, Math.round(steps * (tEnd / T_SIM_MAX)))
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * tEnd
    const x = A * Math.cos(omega * t - phi)
    const sx = tToSvgX(t)
    const sy = xMetersToSvgY(x)
    d += `${i === 0 ? 'M' : 'L'} ${sx.toFixed(1)} ${sy.toFixed(1)} `
  }
  return d
}

// ─── Component ──────────────────────────────────────────────────────────
export default function Scene() {
  const { locale, seed } = useInit()
  const stages = useMemo(() => getStagesFor(locale), [locale])
  useDeclareStages(stages)
  const labels = useMemo(() => svgLabels(locale), [locale])
  const rootRng = useSeed()

  const stage2Target = useMemo(() => {
    void rootRng
    return STAGE2_TARGETS[seed % STAGE2_TARGETS.length]!
  }, [seed, rootRng])
  const stage3Target = useMemo(
    () => STAGE3_TARGETS[(seed + 1) % STAGE3_TARGETS.length]!,
    [seed],
  )
  const omegaStar = stage3Target.omegaStar
  const hStar = stage3Target.hStar
  const aStar3 = amplitude(omegaStar, hStar)

  const stageIdx = useCurrentStage()
  const setStage = useSetStage()
  const progress = useProgress()
  const complete = useComplete()

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  // ─── Physical DOF state ─────────────────────────────────────────────
  const [omega, setOmega] = useState(OMEGA_DEFAULT)
  const [h, setH] = useState(H_DEFAULT)

  // Wall-clock time driving the mass animation
  const [tSim, setTSim] = useState(0)

  // Coverage tracking (stage 1)
  const [omegaMoved, setOmegaMoved] = useState(false)
  const [hMoved, setHMoved] = useState(false)
  const [sweptLow, setSweptLow] = useState(false) // saw Ω < 5
  const [sweptHigh, setSweptHigh] = useState(false) // saw Ω > 15
  const [fullPeriodSeen, setFullPeriodSeen] = useState(false)

  // Stage-2 hit flag (must hold for a moment to prevent thrash)
  const [stage2Hit, setStage2Hit] = useState(false)

  // Stage-3 flow
  const [submitted, setSubmitted] = useState(false)

  // Peek visibility for the reading-method hint text
  const [peekVisible, setPeekVisible] = useState(false)

  // Current computed quantities
  const A = amplitude(omega, h)
  const T_period = (2 * Math.PI) / omega

  const resetStageState = useCallback(() => {
    setOmega(OMEGA_DEFAULT)
    setH(H_DEFAULT)
    setTSim(0)
    setOmegaMoved(false)
    setHMoved(false)
    setSweptLow(false)
    setSweptHigh(false)
    setFullPeriodSeen(false)
    setStage2Hit(false)
    setSubmitted(false)
    setPeekVisible(false)
  }, [])
  useReset(resetStageState)

  // ─── Ticker ─────────────────────────────────────────────────────────
  // tSim accumulates wall time for the mass animation. The chart's curve
  // clamps its own extent to T_SIM_MAX internally — so tSim can run past.
  useTicker((dt) => {
    // Stage 3 pre-submit: sim is frozen (no live evolution)
    if (isStage3 && !submitted) return
    setTSim((prev) => {
      const nxt = prev + dt
      if (isStage1 && nxt >= T_period && !fullPeriodSeen) setFullPeriodSeen(true)
      return nxt
    })
  })

  // Track sweep coverage on omega changes
  useEffect(() => {
    if (!isStage1) return
    if (omega < 5) setSweptLow(true)
    if (omega > 15) setSweptHigh(true)
  }, [omega, isStage1])

  // Stage-2 hit detection (based on amplitude)
  useEffect(() => {
    if (!isStage2) return
    if (Math.abs(A - stage2Target.aStar) / stage2Target.aStar < STAGE2_TOL) {
      setStage2Hit(true)
    } else if (Math.abs(A - stage2Target.aStar) / stage2Target.aStar > 0.15) {
      // Only clear if student has moved well away — sticky-latch feel
      setStage2Hit(false)
    }
  }, [A, isStage2, stage2Target])

  // ─── Advance predicate ──────────────────────────────────────────────
  const stage3Correct = useMemo(() => {
    if (!isStage3 || !submitted) return false
    const dA = Math.abs(A - aStar3) / aStar3
    const dOmega = Math.abs(omega - omegaStar) / omegaStar
    return dA < STAGE3_TOL_A && dOmega < STAGE3_TOL_OMEGA
  }, [A, aStar3, omega, omegaStar, isStage3, submitted])

  const canSubmit = isStage1
    ? omegaMoved && hMoved && sweptLow && sweptHigh && fullPeriodSeen
    : isStage2
      ? stage2Hit
      : stage3Correct

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

  // ─── Peek: reading-method hint text only ────────────────────────────
  usePeek(() => {
    if (!isStage3) return
    setPeekVisible(true)
  })
  useEffect(() => {
    if (!peekVisible) return
    const t = setTimeout(() => setPeekVisible(false), 4000)
    return () => clearTimeout(t)
  }, [peekVisible])

  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  // ─── Stage-3 submit → reveal live curve + drive mass ────────────────
  const submitStage3 = useCallback(() => {
    setSubmitted(true)
    setTSim(0) // start the reveal animation from the left edge
  }, [])

  // ─── Precomputed paths ──────────────────────────────────────────────
  // Live curve: analytic cosine at current (Ω, h), swept as tSim advances.
  // Snap tSim to fixed steps once it exceeds T_SIM_MAX so the memo settles
  // and doesn't recompute every ticker frame.
  const drawT = Math.min(tSim, T_SIM_MAX)
  const livePath = useMemo(() => {
    if (isStage3 && !submitted) return ''
    return cosineCurvePath(omega, h, drawT)
  }, [omega, h, drawT, isStage3, submitted])

  // Stage-2 target: horizontal band at ±A* (no period info).
  // Not a cosine — just amplitude envelope lines.

  // Stage-3 target: full cosine at (Ω*, h*) drawn always (student's read source).
  const stage3TargetPath = useMemo(() => {
    if (!isStage3) return ''
    return cosineCurvePath(omegaStar, hStar, T_SIM_MAX)
  }, [isStage3, omegaStar, hStar])

  // ─── Mass position and driver force (visual only) ───────────────────
  const showMotion = !(isStage3 && !submitted)
  const massX = REST_X + (showMotion ? A * Math.cos(omega * tSim - phase(omega, h)) * SCALE_PX_PER_M : 0)
  const driveNorm = showMotion ? Math.cos(omega * tSim) : 0

  // ─── HUD strings ────────────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`

  const hudTR = isStage1
    ? `A = ${fmtCm(A)}`
    : isStage2
      ? stage2Hit
        ? `${labels.hit} · A = ${fmtCm(A)}`
        : `A = ${fmtCm(A)} · A* = ${fmtCm(stage2Target.aStar)}`
      : submitted
        ? stage3Correct
          ? `${labels.match_ok} · A = ${fmtCm(A)}`
          : `${labels.match_off} · ΔA = ${(100 * Math.abs(A - aStar3) / aStar3).toFixed(1)}%`
        : `A = ${fmtCm(A)}`

  const hudBL = isStage1 ? labels.tip1 : isStage2 ? labels.tip2 : labels.tip3
  // BR quadrant intentionally empty (reserved for parent chrome).

  // ─── Plot grid ──────────────────────────────────────────────────────
  const plotGrid: React.ReactNode[] = []
  for (let i = 1; i < 5; i++) {
    const gx = PLOT_X + (i / 5) * PLOT_W
    plotGrid.push(
      <line key={`vx${i}`} x1={gx} y1={PLOT_Y} x2={gx} y2={PLOT_Y + PLOT_H} stroke="#12203a" strokeWidth={1} />,
    )
  }
  for (let i = 1; i < 5; i++) {
    const gy = PLOT_Y + (i / 5) * PLOT_H
    plotGrid.push(
      <line key={`gy${i}`} x1={PLOT_X} y1={gy} x2={PLOT_X + PLOT_W} y2={gy} stroke="#12203a" strokeWidth={1} />,
    )
  }

  // Schematic geometry
  const wallTopY = SCH_Y + 90
  const wallBottomY = SCH_Y + SCH_H - 40

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block', userSelect: 'none' }}
      >
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        {/* ─── Left panel: schematic border + title ─────────────────── */}
        <rect
          x={SCH_X - 8}
          y={SCH_Y - 8}
          width={SCH_W + 16}
          height={SCH_H + 16}
          fill="none"
          stroke="#12203a"
          strokeWidth={1}
          rx={6}
        />
        <text
          x={SCH_X}
          y={SCH_Y - 14}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={11}
          letterSpacing="0.1em"
        >
          {labels.schematic}
        </text>

        {/* Constants readout inside schematic */}
        <text
          x={SCH_X + 8}
          y={SCH_Y + 20}
          fill="#54617A"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={10}
        >
          m = {M} kg · k = {K} N/m · F0 = {F0} N
        </text>
        <text
          x={SCH_X + 8}
          y={SCH_Y + 36}
          fill="#F9A968"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={10}
        >
          {labels.omega0_label} = {OMEGA0.toFixed(1)} rad/s
        </text>

        {/* Wall */}
        <Wall x={WALL_X} yTop={wallTopY} yBottom={wallBottomY} />

        {/* Rest-position tick on baseline (reference axis for the mass) */}
        <line
          x1={REST_X}
          y1={BASE_Y + MASS_W / 2 + 22}
          x2={REST_X}
          y2={BASE_Y + MASS_W / 2 + 32}
          stroke="#3A4863"
          strokeWidth={1}
        />
        <text
          x={REST_X}
          y={BASE_Y + MASS_W / 2 + 44}
          fill="#54617A"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={9}
          textAnchor="middle"
        >
          x = 0
        </text>

        {/* Spring on top, damper on bottom, both wall→mass */}
        <Spring x1={WALL_X} x2={massX - MASS_W / 2} y={BASE_Y} active={showMotion} />
        <Damper x1={WALL_X} x2={massX - MASS_W / 2} y={DAMPER_Y} active={showMotion && h < 0.5} />

        {/* Spring label */}
        <text
          x={(WALL_X + REST_X) / 2}
          y={BASE_Y - 16}
          fill="#B9C4D6"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={11}
          textAnchor="middle"
        >
          {labels.spring_label}
        </text>
        {/* Damper label */}
        <text
          x={(WALL_X + REST_X) / 2}
          y={DAMPER_Y + 26}
          fill="#B9C4D6"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={11}
          textAnchor="middle"
        >
          {labels.damper_label}
        </text>

        {/* Mass */}
        <Mass cx={massX} cy={BASE_Y + 12} m={M} />

        {/* Driving force arrow above the mass */}
        <Driver cx={massX} cy={BASE_Y - 40} forceNorm={driveNorm} />
        <text
          x={massX + 42}
          y={BASE_Y - 46}
          fill="#F9A968"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={10}
          textAnchor="start"
        >
          {labels.F0_label} cos({labels.omega_name} t)
        </text>

        {/* ─── Right panel: chart border + title ────────────────────── */}
        <rect
          x={PLOT_X - 8}
          y={PLOT_Y - 8}
          width={PLOT_W + 16}
          height={PLOT_H + 16}
          fill="none"
          stroke="#12203a"
          strokeWidth={1}
          rx={6}
        />
        <text
          x={PLOT_X}
          y={PLOT_Y - 14}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={11}
          letterSpacing="0.1em"
        >
          {labels.chart_title}
        </text>
        {plotGrid}

        {/* Axes */}
        <line
          x1={PLOT_X}
          y1={PLOT_Y + PLOT_H / 2}
          x2={PLOT_X + PLOT_W}
          y2={PLOT_Y + PLOT_H / 2}
          stroke="#3A4863"
          strokeWidth={1.5}
        />
        <line x1={PLOT_X} y1={PLOT_Y} x2={PLOT_X} y2={PLOT_Y + PLOT_H} stroke="#3A4863" strokeWidth={1.5} />

        {/* Axis labels */}
        <text
          x={PLOT_X + PLOT_W - 6}
          y={PLOT_Y + PLOT_H + 18}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={10}
          textAnchor="end"
        >
          {labels.x_axis}
        </text>
        <text
          transform={`rotate(-90 ${PLOT_X - 18} ${PLOT_Y + 6})`}
          x={PLOT_X - 18}
          y={PLOT_Y + 6}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={10}
          textAnchor="end"
        >
          {labels.y_axis} →
        </text>

        {/* Time ticks */}
        {[0, 1, 2, 3, 4].map((tv) => (
          <text
            key={`tk${tv}`}
            x={tToSvgX(tv)}
            y={PLOT_Y + PLOT_H + 14}
            fill="#54617A"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={9}
            textAnchor="middle"
          >
            {tv}
          </text>
        ))}
        {/* Y ticks in cm */}
        {[-10, -5, 0, 5, 10].map((vCm) => (
          <text
            key={`yk${vCm}`}
            x={PLOT_X - 6}
            y={xMetersToSvgY(vCm / 100) + 3}
            fill="#54617A"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={9}
            textAnchor="end"
          >
            {vCm}
          </text>
        ))}

        {/* ─── Stage-1 canonical markers (removed on stage 3) ────────── */}
        {isStage1 && (
          <>
            {/* Current amplitude envelope — helps student see A change */}
            <line
              x1={PLOT_X}
              y1={xMetersToSvgY(A)}
              x2={PLOT_X + PLOT_W}
              y2={xMetersToSvgY(A)}
              stroke="#37C9B8"
              strokeWidth={1}
              strokeDasharray="3 4"
              opacity={0.35}
            />
            <line
              x1={PLOT_X}
              y1={xMetersToSvgY(-A)}
              x2={PLOT_X + PLOT_W}
              y2={xMetersToSvgY(-A)}
              stroke="#37C9B8"
              strokeWidth={1}
              strokeDasharray="3 4"
              opacity={0.35}
            />
            <text
              x={PLOT_X + PLOT_W - 4}
              y={xMetersToSvgY(A) - 4}
              fill="#37C9B8"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={9}
              textAnchor="end"
            >
              +A
            </text>
            <text
              x={PLOT_X + PLOT_W - 4}
              y={xMetersToSvgY(-A) + 12}
              fill="#37C9B8"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={9}
              textAnchor="end"
            >
              −A
            </text>
          </>
        )}

        {/* ─── Stage-2 target: horizontal amplitude band ────────────── */}
        {isStage2 && (
          <>
            <line
              x1={PLOT_X}
              y1={xMetersToSvgY(stage2Target.aStar)}
              x2={PLOT_X + PLOT_W}
              y2={xMetersToSvgY(stage2Target.aStar)}
              stroke="#F97316"
              strokeWidth={1.4}
              strokeDasharray="5 4"
              opacity={0.85}
            />
            <line
              x1={PLOT_X}
              y1={xMetersToSvgY(-stage2Target.aStar)}
              x2={PLOT_X + PLOT_W}
              y2={xMetersToSvgY(-stage2Target.aStar)}
              stroke="#F97316"
              strokeWidth={1.4}
              strokeDasharray="5 4"
              opacity={0.85}
            />
            <text
              x={PLOT_X + 4}
              y={xMetersToSvgY(stage2Target.aStar) - 4}
              fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
            >
              A* = {(stage2Target.aStar * 100).toFixed(2)} cm
            </text>
          </>
        )}

        {/* ─── Stage-3 target curve (student reads T* and A* from this) ─ */}
        {isStage3 && (
          <path d={stage3TargetPath} fill="none" stroke="#F97316" strokeWidth={2} opacity={0.9} />
        )}

        {/* ─── Live curve (hidden on stage 3 pre-submit) ─────────────── */}
        {livePath && <path d={livePath} fill="none" stroke="#37C9B8" strokeWidth={2} />}

        {/* Time cursor (only on stages where sim is running visibly) */}
        {(isStage1 || isStage2 || (isStage3 && submitted)) && tSim > 0 && tSim < T_SIM_MAX && (
          <line
            x1={tToSvgX(tSim)}
            y1={PLOT_Y}
            x2={tToSvgX(tSim)}
            y2={PLOT_Y + PLOT_H}
            stroke="#F9A968"
            strokeWidth={1}
            opacity={0.25}
          />
        )}

        {/* ─── Peek: reading-method text (NOT the answer) ────────────── */}
        {isStage3 && peekVisible && (
          <>
            <rect
              x={PLOT_X - 4}
              y={PLOT_Y - 4}
              width={PLOT_W + 8}
              height={26}
              fill="#0D1524"
              stroke="#37C9B8"
              strokeWidth={0.8}
              opacity={0.9}
              rx={4}
            />
            <text
              x={PLOT_X + PLOT_W / 2}
              y={PLOT_Y + 12}
              fill="#37C9B8"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={9}
              textAnchor="middle"
            >
              {labels.peek_hint}
            </text>
          </>
        )}
      </svg>

      {/* ─── HUD overlays (HTML in rem) ─────────────────────────────── */}
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
          maxWidth: '48%',
        }}
      >
        {hudBL}
      </div>
      {/* BR quadrant intentionally empty — reserved for parent chrome */}

      {/* ─── Vertical parameter sliders (right column, TR-anchored) ─── */}
      <div
        style={{
          position: 'absolute',
          top: '10rem',
          right: '3rem',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '2rem',
          zIndex: 6,
        }}
      >
        {/* Ω slider (linear) */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.6rem' }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.6rem', color: '#6C7A93' }}>
            {OMEGA_MAX}
          </div>
          <div
            style={{
              width: '2rem',
              height: '22rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <input
              type="range"
              min={OMEGA_MIN * 100}
              max={OMEGA_MAX * 100}
              step={5}
              value={Math.round(omega * 100)}
              onChange={(e) => {
                setOmega(Number(e.target.value) / 100)
                setOmegaMoved(true)
              }}
              disabled={isStage3 && submitted}
              style={{
                width: '22rem',
                height: '2rem',
                transform: 'rotate(-90deg)',
                transformOrigin: 'center',
                accentColor: '#37C9B8',
                cursor: isStage3 && submitted ? 'not-allowed' : 'pointer',
              }}
            />
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.6rem', color: '#6C7A93' }}>
            {OMEGA_MIN}
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.6rem', color: '#37C9B8' }}>
            Ω = {omega.toFixed(2)}
          </div>
        </div>
        {/* h slider (linear) */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.6rem' }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.6rem', color: '#6C7A93' }}>
            {H_MAX.toFixed(1)}
          </div>
          <div
            style={{
              width: '2rem',
              height: '18rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <input
              type="range"
              min={H_MIN * 1000}
              max={H_MAX * 1000}
              step={5}
              value={Math.round(h * 1000)}
              onChange={(e) => {
                setH(Number(e.target.value) / 1000)
                setHMoved(true)
              }}
              disabled={isStage3 && submitted}
              style={{
                width: '18rem',
                height: '2rem',
                transform: 'rotate(-90deg)',
                transformOrigin: 'center',
                accentColor: '#F97316',
                cursor: isStage3 && submitted ? 'not-allowed' : 'pointer',
              }}
            />
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.6rem', color: '#6C7A93' }}>
            {H_MIN.toFixed(1)}
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.6rem', color: '#F97316' }}>
            h = {h.toFixed(2)}
          </div>
        </div>
      </div>

      {/* ─── Stage-3 SUBMIT button (bottom-center, pre-submit only) ─── */}
      {isStage3 && !submitted && (
        <button
          type="button"
          onClick={submitStage3}
          style={{
            position: 'absolute',
            bottom: '10rem',
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '1.4rem 3.2rem',
            background: '#F97316',
            color: '#FFFFFF',
            border: 'none',
            borderRadius: '10rem',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '2rem',
            fontWeight: 700,
            letterSpacing: '0.12em',
            cursor: 'pointer',
            zIndex: 10,
          }}
        >
          <i
            className="bi bi-play-fill"
            style={{ marginInlineEnd: '0.6rem', fontSize: '2.2rem', verticalAlign: '-0.3rem' }}
          />
          {labels.submit_button}
        </button>
      )}
    </div>
  )
}
