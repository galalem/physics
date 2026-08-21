import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  useSetStage,
  useCurrentStage,
  useComplete,
  useDeclareStages,
  useHint,
  useInit,
  useNext,
  usePeek,
  useProgress,
  useReset,
  useSeed,
} from '@physics/sdk/react'
import { getHintFor, getStagesFor } from './stages'
import en from '../i18n/en.json'
import fr from '../i18n/fr.json'
import ar from '../i18n/ar.json'
import { wavelengthCss, wavelengthToRgb } from './wavelengthToRgb'

// ─── Scene constants ────────────────────────────────────────────────────
const W = 800
const H = 450

// Bench geometry (SVG units)
const AXIS_Y = 225
const LASER_X = 90
const SLIT_X = 380
const SCREEN_X = 680
const SCREEN_TOP = 60
const SCREEN_BOT = 390
const SCREEN_H = SCREEN_BOT - SCREEN_TOP // 330 px
// Screen represents ±40 mm from center (80 mm total)
const SCREEN_HALF_MM = 40
const MM_PER_PX = SCREEN_HALF_MM / (SCREEN_H / 2) // ≈ 0.2424 mm/px

// Physics parameters (SI-derived display units)
const A_MIN = 0.05 // mm
const A_MAX = 0.50 // mm
const A_DEFAULT = 0.20 // mm
const LAMBDA_MIN = 400 // nm
const LAMBDA_MAX = 750 // nm
const LAMBDA_DEFAULT = 633 // nm (HeNe red)
const D_MIN = 0.5 // m
const D_MAX = 3.0 // m
const D_DEFAULT = 2.0 // m

// Stage 2 target set: (L* in mm, λ* in nm)
const STAGE2_TARGETS: { lStar: number; lambdaStar: number }[] = [
  { lStar: 12, lambdaStar: 633 },
  { lStar: 20, lambdaStar: 532 },
  { lStar: 8, lambdaStar: 450 },
  { lStar: 30, lambdaStar: 700 },
  { lStar: 16, lambdaStar: 490 },
]
const STAGE2_L_TOL = 0.05 // ±5% on L
const STAGE2_LAMBDA_TOL = 20 // ±20 nm

// Stage 3 target set: half-width of central fringe (L/2) in mm
const STAGE3_TARGETS = [6, 10, 15, 20, 25]
const STAGE3_TOL = 0.03 // ±3% on half-width

// Slider-coverage threshold for stage 1 advance
const COVERAGE_MIN_FRAC = 0.5

const dict = { en, fr, ar } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── Physics helpers ────────────────────────────────────────────────────
/** Sinc² normalized to I(0)=1. Uses standard sinc = sin(x)/x with limit 1 at 0. */
function sinc2(beta: number): number {
  if (Math.abs(beta) < 1e-6) return 1
  const s = Math.sin(beta) / beta
  return s * s
}

/** Central-fringe full width L = 2·λ·D / a, all inputs in SI. Returns mm. */
function centralWidthMm(aMm: number, lambdaNm: number, dM: number): number {
  const a = aMm * 1e-3
  const lambda = lambdaNm * 1e-9
  return (2 * lambda * dM / a) * 1e3
}

/** Half-angular width θ ≈ λ/a in mrad. */
function halfAngleMrad(aMm: number, lambdaNm: number): number {
  return (lambdaNm * 1e-9) / (aMm * 1e-3) * 1e3
}

/** Formatter — dynamic precision by magnitude. */
function formatMm(mm: number): string {
  if (mm >= 100) return `${mm.toFixed(0)}mm`
  if (mm >= 10) return `${mm.toFixed(1)}mm`
  return `${mm.toFixed(2)}mm`
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
  const stage3Target = useMemo(() => {
    return STAGE3_TARGETS[(seed + 1) % STAGE3_TARGETS.length]!
  }, [seed])

  const stageIdx = useCurrentStage()
  const [a, setA] = useState(A_DEFAULT)
  const [lambda, setLambda] = useState(LAMBDA_DEFAULT)
  const [D, setD] = useState(D_DEFAULT)
  const [peekVisible, setPeekVisible] = useState(false)

  // Stage 1 coverage bits — each slider must sweep ≥ COVERAGE_MIN_FRAC of range
  const [aMin, setAMin] = useState(A_DEFAULT)
  const [aMax, setAMax] = useState(A_DEFAULT)
  const [lambdaMin, setLambdaMin] = useState(LAMBDA_DEFAULT)
  const [lambdaMax, setLambdaMax] = useState(LAMBDA_DEFAULT)
  const [dMin, setDMin] = useState(D_DEFAULT)
  const [dMax, setDMax] = useState(D_DEFAULT)

  const setStage = useSetStage()
  const progress = useProgress()
  const complete = useComplete()

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  const resetStageState = useCallback(() => {
    setA(A_DEFAULT)
    setLambda(LAMBDA_DEFAULT)
    setD(D_DEFAULT)
    setAMin(A_DEFAULT); setAMax(A_DEFAULT)
    setLambdaMin(LAMBDA_DEFAULT); setLambdaMax(LAMBDA_DEFAULT)
    setDMin(D_DEFAULT); setDMax(D_DEFAULT)
    setPeekVisible(false)
  }, [])

  const L = centralWidthMm(a, lambda, D)
  const theta = halfAngleMrad(a, lambda)

  const aCoverage = (aMax - aMin) / (A_MAX - A_MIN)
  const lambdaCoverage = (lambdaMax - lambdaMin) / (LAMBDA_MAX - LAMBDA_MIN)
  const dCoverage = (dMax - dMin) / (D_MAX - D_MIN)
  const stage1Done =
    aCoverage >= COVERAGE_MIN_FRAC &&
    lambdaCoverage >= COVERAGE_MIN_FRAC &&
    dCoverage >= COVERAGE_MIN_FRAC

  const lErrRel = Math.abs(L - stage2Target.lStar) / stage2Target.lStar
  const lambdaErr = Math.abs(lambda - stage2Target.lambdaStar)
  const stage2Match = lErrRel < STAGE2_L_TOL && lambdaErr < STAGE2_LAMBDA_TOL

  const halfWidth = L / 2
  const s3ErrRel = Math.abs(halfWidth - stage3Target) / stage3Target
  const stage3Match = s3ErrRel < STAGE3_TOL

  const canSubmit = isStage1 ? stage1Done : isStage2 ? stage2Match : stage3Match

  const readout = isStage1
    ? `L = ${formatMm(L)} · θ = ${theta.toFixed(2)} mrad`
    : isStage2
      ? stage2Match
        ? `${labels.match_ok} · L = ${formatMm(L)}`
        : `L = ${formatMm(L)} · ΔL = ${(100 * lErrRel).toFixed(1)}%`
      : stage3Match
        ? `${labels.match_ok} · L/2 = ${formatMm(halfWidth)}`
        : `L/2 = ${formatMm(halfWidth)}`

  useEffect(() => {
    progress(stageIdx / 3, { stage: stageIdx, canSubmit, readout })
  }, [stageIdx, canSubmit, readout, progress])

  useReset(resetStageState)

  useNext(() => {
    if (stageIdx < 3) {
      setStage(stageIdx + 1)
      resetStageState()
    } else {
      complete({ success: true })
    }
  })

  usePeek(() => {
    if (!isStage3) return
    setPeekVisible(true)
  })
  useEffect(() => {
    if (!peekVisible) return
    const t = setTimeout(() => setPeekVisible(false), 1500)
    return () => clearTimeout(t)
  }, [peekVisible])

  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  // ─── Intensity strip samples (rendered as vertical rects on the screen) ─
  const STRIP_SAMPLES = 120
  const intensityStrip = useMemo(() => {
    if (isStage3 && !peekVisible) return null
    // For stage 2 we render both target (dim) and live (bright).
    // Here we just render the live curve; target overlaid separately.
    const bandH = SCREEN_H / STRIP_SAMPLES
    const nodes: React.ReactNode[] = []
    for (let i = 0; i < STRIP_SAMPLES; i++) {
      const cy = SCREEN_TOP + (i + 0.5) * bandH
      const xMm = (cy - AXIS_Y) * MM_PER_PX // screen position in mm from center
      const beta = Math.PI * (a * 1e-3) * (xMm * 1e-3) / ((lambda * 1e-9) * D)
      const intensity = sinc2(beta)
      if (intensity < 0.01) continue
      nodes.push(
        <rect
          key={`s${i}`}
          x={SCREEN_X - 8}
          y={cy - bandH / 2}
          width={16}
          height={bandH + 0.3}
          fill={wavelengthCss(lambda, intensity)}
        />,
      )
    }
    return nodes
  }, [a, lambda, D, isStage3, peekVisible])

  const stage2TargetStrip = useMemo(() => {
    if (!isStage2) return null
    const { lStar, lambdaStar } = stage2Target
    // Reconstruct target intensity as if student had the correct (a, λ, D)
    // trio — we only need width and color: fake it via I(x) = sinc²(π·x / L*)
    // where L* pins the first zero at x = ±L*/2.
    const bandH = SCREEN_H / STRIP_SAMPLES
    const nodes: React.ReactNode[] = []
    for (let i = 0; i < STRIP_SAMPLES; i++) {
      const cy = SCREEN_TOP + (i + 0.5) * bandH
      const xMm = (cy - AXIS_Y) * MM_PER_PX
      const beta = Math.PI * xMm / (lStar / 2)
      const intensity = sinc2(beta)
      if (intensity < 0.02) continue
      nodes.push(
        <rect
          key={`t${i}`}
          x={SCREEN_X + 14}
          y={cy - bandH / 2}
          width={16}
          height={bandH + 0.3}
          fill={wavelengthCss(lambdaStar, intensity * 0.85)}
        />,
      )
    }
    return nodes
  }, [isStage2, stage2Target])

  // ─── Slit opening visual (proportional to a) ────────────────────────
  // Show slit half-opening ∝ a: at A_MAX (0.5mm) → 22px, at A_MIN → 3px.
  const slitHalfPx = 3 + ((a - A_MIN) / (A_MAX - A_MIN)) * 19

  // Beam rays: from laser through slit → diverge toward screen with half-angle θ
  // (visually amplified so the divergence is perceptible even at wide slits).
  const rayHalfAngle = Math.min(halfAngleMrad(a, lambda) * 30, 60) // display exaggeration
  const rayY = (screenX: number) => rayHalfAngle * (screenX - SLIT_X) / 100

  // ─── Render ─────────────────────────────────────────────────────────
  const laserRgb = wavelengthToRgb(lambda)
  const laserGlow = `rgb(${laserRgb[0]},${laserRgb[1]},${laserRgb[2]})`

  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`
  const hudTR = isStage1
    ? `L = ${formatMm(L)}`
    : isStage2
      ? stage2Match
        ? `✓ ${labels.match_ok}`
        : `L = ${formatMm(L)}`
      : peekVisible
        ? `${labels.peek_reveal} L/2 = ${formatMm(halfWidth)}`
        : `L/2 = ?`
  const hudBL = isStage1
    ? labels.tip1
    : isStage2
      ? labels.tip2
      : labels.tip3
  const hudBR = isStage1
    ? `a·${(aCoverage * 100).toFixed(0)}% λ·${(lambdaCoverage * 100).toFixed(0)}% D·${(dCoverage * 100).toFixed(0)}%`
    : isStage2
      ? stage2Match
        ? `✓ ${labels.match_ok}`
        : `${labels.target_short}: L*=${stage2Target.lStar}mm, λ*=${stage2Target.lambdaStar}nm`
      : stage3Match
        ? `✓ ${labels.match_ok}`
        : `Δ = ${(100 * s3ErrRel).toFixed(1)}%`

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block', borderRadius: 14, userSelect: 'none' }}
      >
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" rx={14} />

        {/* Bench frame */}
        <rect x={32} y={60} width={720} height={358} fill="none" stroke="#12203a" strokeWidth={1} rx={6} />
        <text x={40} y={52} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={11} letterSpacing="0.1em">
          {labels.bench}
        </text>

        {/* Optical axis */}
        <line x1={LASER_X} y1={AXIS_Y} x2={SLIT_X - slitHalfPx - 1} y2={AXIS_Y} stroke="#2A3654" strokeWidth={1} strokeDasharray="2 4" />

        {/* Beam rays: from slit spreading to screen */}
        <path
          d={`M ${SLIT_X} ${AXIS_Y - slitHalfPx} L ${SCREEN_X - 8} ${AXIS_Y - rayY(SCREEN_X)} L ${SCREEN_X - 8} ${AXIS_Y + rayY(SCREEN_X)} L ${SLIT_X} ${AXIS_Y + slitHalfPx} Z`}
          fill={wavelengthCss(lambda, 0.10)}
          stroke={wavelengthCss(lambda, 0.25)}
          strokeWidth={0.6}
        />

        {/* Laser body */}
        <rect x={LASER_X - 30} y={AXIS_Y - 10} width={30} height={20} fill="#1A2338" stroke="#54617A" strokeWidth={1} rx={2} />
        <circle cx={LASER_X + 2} cy={AXIS_Y} r={4} fill={laserGlow} opacity={0.9}>
          <animate attributeName="opacity" values="0.75;1;0.75" dur="1.6s" repeatCount="indefinite" />
        </circle>
        <text x={LASER_X - 15} y={AXIS_Y + 24} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={10} textAnchor="middle">
          {labels.laser}
        </text>

        {/* Slit — vertical opaque plate with a gap */}
        {/* Upper plate */}
        <rect x={SLIT_X - 4} y={SCREEN_TOP} width={8} height={AXIS_Y - slitHalfPx - SCREEN_TOP} fill="#3A4863" />
        {/* Lower plate */}
        <rect x={SLIT_X - 4} y={AXIS_Y + slitHalfPx} width={8} height={SCREEN_BOT - (AXIS_Y + slitHalfPx)} fill="#3A4863" />
        <text x={SLIT_X} y={SCREEN_TOP - 8} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={10} textAnchor="middle">
          a = {a.toFixed(2)}mm
        </text>

        {/* Screen — dark bar */}
        <rect x={SCREEN_X - 8} y={SCREEN_TOP} width={16} height={SCREEN_H} fill="#050B18" stroke="#2A3654" strokeWidth={1} />
        {/* Live intensity strip */}
        {intensityStrip}
        {/* Stage 2 target strip (right of live) */}
        {stage2TargetStrip}
        {/* Screen center tick */}
        <line x1={SCREEN_X - 12} y1={AXIS_Y} x2={SCREEN_X - 9} y2={AXIS_Y} stroke="#54617A" strokeWidth={1} />
        <line x1={SCREEN_X + 9} y1={AXIS_Y} x2={SCREEN_X + 12} y2={AXIS_Y} stroke="#54617A" strokeWidth={1} />
        <text x={SCREEN_X} y={SCREEN_TOP - 8} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={10} textAnchor="middle">
          {labels.screen}
        </text>
        <text x={SCREEN_X} y={SCREEN_BOT + 16} fill="#54617A" fontFamily="'JetBrains Mono', monospace" fontSize={9} textAnchor="middle">
          D = {D.toFixed(2)}m
        </text>

        {/* Stage 2: target markers — tick pair at plus/minus L-star over 2 on screen */}
        {isStage2 && (() => {
          const yTop = AXIS_Y - (stage2Target.lStar / 2) / MM_PER_PX
          const yBot = AXIS_Y + (stage2Target.lStar / 2) / MM_PER_PX
          return (
            <g>
              <line x1={SCREEN_X - 16} y1={yTop} x2={SCREEN_X + 30} y2={yTop} stroke="#F97316" strokeWidth={1} strokeDasharray="4 4" opacity={0.7} />
              <line x1={SCREEN_X - 16} y1={yBot} x2={SCREEN_X + 30} y2={yBot} stroke="#F97316" strokeWidth={1} strokeDasharray="4 4" opacity={0.7} />
              <text x={SCREEN_X + 34} y={yTop + 3} fill="#F9A968" fontFamily="'JetBrains Mono', monospace" fontSize={9}>
                +L*/2
              </text>
              <text x={SCREEN_X + 34} y={yBot + 3} fill="#F9A968" fontFamily="'JetBrains Mono', monospace" fontSize={9}>
                −L*/2
              </text>
            </g>
          )
        })()}

        {/* Stage 3: target dots (only ticks visible; pattern hidden) */}
        {isStage3 && (() => {
          const yTop = AXIS_Y - stage3Target / MM_PER_PX
          const yBot = AXIS_Y + stage3Target / MM_PER_PX
          return (
            <g>
              <circle cx={SCREEN_X} cy={yTop} r={5} fill="none" stroke="#F97316" strokeWidth={1.5} />
              <circle cx={SCREEN_X} cy={yTop} r={2} fill="#F97316" />
              <circle cx={SCREEN_X} cy={yBot} r={5} fill="none" stroke="#F97316" strokeWidth={1.5} />
              <circle cx={SCREEN_X} cy={yBot} r={2} fill="#F97316" />
              <text x={SCREEN_X + 14} y={yTop + 3} fill="#F9A968" fontFamily="'JetBrains Mono', monospace" fontSize={9}>
                +d*
              </text>
              <text x={SCREEN_X + 14} y={yBot + 3} fill="#F9A968" fontFamily="'JetBrains Mono', monospace" fontSize={9}>
                −d*
              </text>
              {/* Show student's predicted L/2 as green ticks */}
              {(() => {
                const yGT = AXIS_Y - halfWidth / MM_PER_PX
                const yGB = AXIS_Y + halfWidth / MM_PER_PX
                if (Math.abs(yGT - SCREEN_TOP) < 4 || halfWidth > SCREEN_HALF_MM) return null
                return (
                  <g>
                    <line x1={SCREEN_X - 14} y1={yGT} x2={SCREEN_X - 8} y2={yGT} stroke={stage3Match ? '#37C9B8' : '#54617A'} strokeWidth={1.5} />
                    <line x1={SCREEN_X - 14} y1={yGB} x2={SCREEN_X - 8} y2={yGB} stroke={stage3Match ? '#37C9B8' : '#54617A'} strokeWidth={1.5} />
                  </g>
                )
              })()}
            </g>
          )
        })()}
      </svg>

      {/* HUD */}
      <div style={{ position: 'absolute', top: '3rem', left: '3rem', fontFamily: "'JetBrains Mono', monospace", fontSize: '2.3rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: '#6C7A93', zIndex: 5, pointerEvents: 'none' }}>
        {hudTL}
      </div>
      <div style={{ position: 'absolute', top: '3rem', right: '3rem', fontFamily: "'JetBrains Mono', monospace", fontSize: '2.3rem', letterSpacing: '0.08em', color: stage2Match || stage3Match ? '#37C9B8' : '#B9C4D6', zIndex: 5, pointerEvents: 'none', textAlign: 'right' }}>
        {hudTR}
      </div>
      <div style={{ position: 'absolute', bottom: '3rem', left: '3rem', fontFamily: "'JetBrains Mono', monospace", fontSize: '2.3rem', letterSpacing: '0.06em', color: '#6C7A93', zIndex: 5, pointerEvents: 'none', maxWidth: '48%' }}>
        {hudBL}
      </div>
      {hudBR && (
        <div style={{ position: 'absolute', bottom: '3rem', right: '3rem', fontFamily: "'JetBrains Mono', monospace", fontSize: '2.3rem', letterSpacing: '0.08em', color: (stage2Match || stage3Match || stage1Done) ? '#37C9B8' : '#B9C4D6', textAlign: 'right', zIndex: 5, pointerEvents: 'none' }}>
          {hudBR}
        </div>
      )}

      {/* ─── Sliders (right stacked column) ────────────────────────── */}
      <div
        style={{
          position: 'absolute',
          top: '6rem',
          right: '3rem',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '1.5rem',
          zIndex: 6,
        }}
      >
        <SliderVertical
          label="a"
          unit="mm"
          value={a}
          min={A_MIN}
          max={A_MAX}
          step={0.005}
          format={(v) => v.toFixed(2)}
          onChange={(v) => {
            setA(v)
            setAMin((prev) => Math.min(prev, v))
            setAMax((prev) => Math.max(prev, v))
          }}
        />
        <SliderVertical
          label="λ"
          unit="nm"
          value={lambda}
          min={LAMBDA_MIN}
          max={LAMBDA_MAX}
          step={1}
          format={(v) => v.toFixed(0)}
          onChange={(v) => {
            setLambda(v)
            setLambdaMin((prev) => Math.min(prev, v))
            setLambdaMax((prev) => Math.max(prev, v))
          }}
          accent={wavelengthCss(lambda)}
        />
        <SliderVertical
          label="D"
          unit="m"
          value={D}
          min={D_MIN}
          max={D_MAX}
          step={0.05}
          format={(v) => v.toFixed(2)}
          onChange={(v) => {
            setD(v)
            setDMin((prev) => Math.min(prev, v))
            setDMax((prev) => Math.max(prev, v))
          }}
        />
      </div>
    </div>
  )
}

// ─── Slider primitive ────────────────────────────────────────────────────
function SliderVertical({
  label, unit, value, min, max, step, format, onChange, accent = '#37C9B8',
}: {
  label: string
  unit: string
  value: number
  min: number
  max: number
  step: number
  format: (v: number) => string
  onChange: (v: number) => void
  accent?: string
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.4rem' }}>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.5rem', color: '#54617A' }}>
        {format(max)}
      </div>
      <div style={{ width: '2.5rem', height: '17rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{
            width: '17rem',
            height: '2.2rem',
            transform: 'rotate(-90deg)',
            transformOrigin: 'center',
            accentColor: accent,
            cursor: 'pointer',
          }}
        />
      </div>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.5rem', color: '#54617A' }}>
        {format(min)}
      </div>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.9rem', color: accent }}>
        {label} = {format(value)}{unit}
      </div>
    </div>
  )
}
