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
import fr from '../i18n/fr.json'
import ar from '../i18n/ar.json'
import { wavelengthCss, wavelengthToRgb } from './wavelengthToRgb'
import {
  AC_DEFAULT,
  AC_MAX,
  AC_MIN,
  AC_STEP,
  BC_DEFAULT,
  BC_MAX,
  BC_MIN,
  BC_STEP,
  INCIDENCE_I1_DEG,
  LAMBDA_DEFAULT,
  LAMBDA_MAX,
  LAMBDA_MIN,
  LAMBDA_STEP,
  PRISM_A_DEG,
  SETUPS,
  cauchyIndex,
  computeExit,
  featureMatchesTolerance,
} from './physics'

// ─── Scene constants ────────────────────────────────────────────────────
const W = 800
const H = 450
const DEG = Math.PI / 180

// Prism (schematic) is fixed. Symmetric apex A = PRISM_A_DEG, apex at top.
const PRISM_CX = 340
const APEX_Y = 155
const BASE_Y = 305
const PRISM_H = BASE_Y - APEX_Y // 150 SVG units
const ALPHA = (PRISM_A_DEG / 2) * DEG // half-apex, radians
const HALF_BASE = PRISM_H * Math.tan(ALPHA)
const V_TOP: [number, number] = [PRISM_CX, APEX_Y]
const V_LEFT: [number, number] = [PRISM_CX - HALF_BASE, BASE_Y]
const V_RIGHT: [number, number] = [PRISM_CX + HALF_BASE, BASE_Y]
// Face-1 midpoint — fixed entry point for the incoming ray.
const P1_X = (V_TOP[0] + V_LEFT[0]) / 2
const P1_Y = (V_TOP[1] + V_LEFT[1]) / 2 // 230

// Incoming ray comes horizontally from the left at prism midheight.
// With i₁ = 30° and apex-half-angle α = 25°, the incoming ray is NOT
// exactly horizontal in general; but for our chosen α = 25°, i₁ = 30°,
// the ray angle from +x (SVG y-down) is (α − i₁) = −5°, ≈ horizontal.
// Using the derivation d_in = (cos(α − i₁), sin(α − i₁)) (SVG frame).
const I1_RAD = INCIDENCE_I1_DEG * DEG
const D_IN_X = Math.cos(ALPHA - I1_RAD)
const D_IN_Y = Math.sin(ALPHA - I1_RAD)

// Source point (where the incoming ray originates on the canvas).
const RAY_IN_LEN = 210
const SOURCE_X = P1_X - RAY_IN_LEN * D_IN_X
const SOURCE_Y = P1_Y - RAY_IN_LEN * D_IN_Y

// Ray extents (in SVG units).
const RAY_INTERNAL_LEN_MAX = 200 // capped for safety, actual to face-2 hit
const RAY_OUT_LEN = 180

// Slider-coverage threshold for stage 1 advance
const COVERAGE_MIN_FRAC = 0.5

const dict = { en, fr, ar } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// Compute where the internal refracted ray hits face 2, given d_1 (SVG frame).
// Returns { p2: [x,y], t } where t is the distance travelled from P1.
// Face 2 line: V_TOP + u * (sin α, cos α), u ∈ [0, PRISM_H/cos α].
function face2Hit(d1x: number, d1y: number): { p2x: number; p2y: number; t: number } | null {
  // Solve: P1 + t·d_1 = V_TOP + u·(sin α, cos α)
  // -->  t·(cos α · d1x − sin α · d1y)  proportional to something ... use algebra:
  const sinA = Math.sin(ALPHA)
  const cosA = Math.cos(ALPHA)
  // From derivation:  t = PRISM_H · sin(α) / cos(A − r₁),
  // but we want a generic ray-line intersection to be robust.
  // Face 2 direction: (sinA, cosA). Line 1: (P1_X + t d1x, P1_Y + t d1y).
  // Line 2: (V_TOP[0] + u sinA, V_TOP[1] + u cosA).
  const denom = d1x * cosA - d1y * sinA
  if (Math.abs(denom) < 1e-9) return null
  const t = ((V_TOP[0] - P1_X) * cosA - (V_TOP[1] - P1_Y) * sinA) / denom
  if (t <= 0 || t > RAY_INTERNAL_LEN_MAX + 500) return null
  return {
    p2x: P1_X + t * d1x,
    p2y: P1_Y + t * d1y,
    t,
  }
}

// Build a path string for the target dashed arrow.
// Target anchor at (TARGET_ANCHOR_X, TARGET_ANCHOR_Y), extends at angle
// θ_target from +x (SVG y-down) with length TARGET_LEN.
// θ_target (from +x in SVG frame): using θ_in + D*.
// Incoming ray angle from +x (SVG): atan2(D_IN_Y, D_IN_X) = ALPHA − I1_RAD.
const THETA_IN = ALPHA - I1_RAD // ≈ −5° for our fixed geometry (deg = -5)
const TARGET_ANCHOR_X = 445
const TARGET_ANCHOR_Y = 220
const TARGET_LEN = 220

// ─── Component ──────────────────────────────────────────────────────────
export default function Scene() {
  const { locale, seed } = useInit()
  const stages = useMemo(() => getStagesFor(locale), [locale])
  useDeclareStages(stages)
  const labels = useMemo(() => svgLabels(locale), [locale])

  const stageIdx = useCurrentStage()
  const setStage = useSetStage()
  const progress = useProgress()
  const complete = useComplete()

  // ─── Slider state ──────────────────────────────────────────
  const [lambda, setLambda] = useState(LAMBDA_DEFAULT)
  const [Ac, setAc] = useState(AC_DEFAULT)
  const [Bc, setBc] = useState(BC_DEFAULT)
  const [peekVisible, setPeekVisible] = useState(false)

  // Stage-1 coverage tracking (min/max seen per slider).
  const [lambdaMin, setLambdaMin] = useState(LAMBDA_DEFAULT)
  const [lambdaMax, setLambdaMax] = useState(LAMBDA_DEFAULT)
  const [acMin, setAcMin] = useState(AC_DEFAULT)
  const [acMax, setAcMax] = useState(AC_DEFAULT)
  const [bcMin, setBcMin] = useState(BC_DEFAULT)
  const [bcMax, setBcMax] = useState(BC_DEFAULT)

  // Stage-3 fail-with-restart rotates the target through SETUPS.
  const [failCount, setFailCount] = useState(0)
  const setup = useMemo(
    () => SETUPS[(seed + failCount) % SETUPS.length]!,
    [seed, failCount],
  )

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  const resetStageState = useCallback(() => {
    setLambda(LAMBDA_DEFAULT)
    setAc(AC_DEFAULT)
    setBc(BC_DEFAULT)
    setLambdaMin(LAMBDA_DEFAULT); setLambdaMax(LAMBDA_DEFAULT)
    setAcMin(AC_DEFAULT); setAcMax(AC_DEFAULT)
    setBcMin(BC_DEFAULT); setBcMax(BC_DEFAULT)
    setPeekVisible(false)
  }, [])
  useReset(resetStageState)

  // ─── Physics ────────────────────────────────────────────────
  const n = cauchyIndex(Ac, Bc, lambda)
  const exit = computeExit(n)

  // ─── Coverage (stage 1) ─────────────────────────────────────
  const lambdaCov = (lambdaMax - lambdaMin) / (LAMBDA_MAX - LAMBDA_MIN)
  const acCov = (acMax - acMin) / (AC_MAX - AC_MIN)
  const bcCov = (bcMax - bcMin) / (BC_MAX - BC_MIN)
  const stage1Done =
    lambdaCov >= COVERAGE_MIN_FRAC &&
    acCov >= COVERAGE_MIN_FRAC &&
    bcCov >= COVERAGE_MIN_FRAC

  const featureMatch = !exit.tir && featureMatchesTolerance(exit.D, setup.targetD)
  const canSubmit = isStage1 ? stage1Done : featureMatch

  useEffect(() => {
    progress(stageIdx / 3, { stage: stageIdx, canSubmit })
  }, [stageIdx, canSubmit, progress])

  useNext(() => {
    if (stageIdx < 3) {
      setStage(stageIdx + 1)
      resetStageState()
    } else if (featureMatch) {
      complete({ success: true })
    } else {
      // Stage-3 miss → rotate to a new seeded setup, reset slider state.
      // No retry on the same setup: forces calculation (§5.2).
      setFailCount((c) => c + 1)
      resetStageState()
    }
  })

  // Peek (blind stage only) — rotating text tips. NEVER reveals the rays.
  const PEEK_TIPS = useMemo(
    () => [labels.peek_tip_formula, labels.peek_tip_anchor] as const,
    [labels],
  )
  const peekIdxRef = useRef(0)
  usePeek(() => {
    if (!isStage3) return
    setPeekVisible(true)
    peekIdxRef.current += 1
  })
  useEffect(() => {
    if (!peekVisible) return
    const t = setTimeout(() => setPeekVisible(false), 4000)
    return () => clearTimeout(t)
  }, [peekVisible])

  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  // ─── Ray geometry (SVG frame) ───────────────────────────────
  // Refracted internal ray direction, computed from r1.
  const r1Rad = exit.r1Deg * DEG
  const D1_X = Math.cos(ALPHA - r1Rad)
  const D1_Y = Math.sin(ALPHA - r1Rad)
  const face2 = face2Hit(D1_X, D1_Y)

  // Exit ray direction (SVG): (cos(α − i₂), −sin(α − i₂)).
  const i2Rad = (exit.i2Deg || 0) * DEG
  const D_OUT_X = Math.cos(ALPHA - i2Rad)
  const D_OUT_Y = -Math.sin(ALPHA - i2Rad)

  const showLive = !isStage3 // rays hidden on the blind stage

  // Target arrow direction (SVG frame). Incoming ray angle THETA_IN + target D*.
  const targetTheta = THETA_IN + setup.targetD * DEG
  const TARGET_END_X = TARGET_ANCHOR_X + TARGET_LEN * Math.cos(targetTheta)
  const TARGET_END_Y = TARGET_ANCHOR_Y + TARGET_LEN * Math.sin(targetTheta)

  const [laserR, laserG, laserB] = wavelengthToRgb(lambda)
  const laserGlow = `rgb(${laserR},${laserG},${laserB})`

  // ─── HUD text ───────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`
  // TR: on stages 1-2 show current D readout; on stage 3 it MUST NOT show
  // the derived deviation (that would be help / live delta). Instead show
  // only what the student is setting (their λ / n readout is on the sliders).
  const hudTR = isStage1
    ? exit.tir
      ? labels.tir
      : `n = ${n.toFixed(3)} · D = ${exit.D.toFixed(1)}°`
    : isStage2
      ? exit.tir
        ? labels.tir
        : `D = ${exit.D.toFixed(1)}° · D* = ${setup.targetD}°`
      : `D* = ${setup.targetD}°`
  // BL: tip / peek text. BR reserved for parent chrome (empty).
  const hudBL = peekVisible
    ? PEEK_TIPS[(peekIdxRef.current - 1) % PEEK_TIPS.length]!
    : isStage1
      ? labels.tip1
      : isStage2
        ? labels.tip2
        : labels.tip3
  const coverageText = `λ·${(lambdaCov * 100).toFixed(0)}% A·${(acCov * 100).toFixed(0)}% B·${(bcCov * 100).toFixed(0)}%`

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block', userSelect: 'none' }}
      >
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        {/* Bench frame */}
        <rect x={32} y={60} width={545} height={358} fill="none" stroke="#12203a" strokeWidth={1} rx={6} />
        <text
          x={40} y={52} fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace" fontSize={11}
          letterSpacing="0.1em"
        >
          {labels.bench}
        </text>

        {/* Optical axis (dashed) - drawn only when live rays are visible so
            stage 3 stays clean. */}
        {showLive && (
          <line
            x1={40} y1={P1_Y} x2={P1_X - 4} y2={P1_Y}
            stroke="#2A3654" strokeWidth={1} strokeDasharray="2 4"
          />
        )}

        {/* Prism polygon (schematic, always visible) */}
        <polygon
          points={`${V_TOP[0]},${V_TOP[1]} ${V_LEFT[0]},${V_LEFT[1]} ${V_RIGHT[0]},${V_RIGHT[1]}`}
          fill="rgba(85, 108, 145, 0.08)"
          stroke="#54617A"
          strokeWidth={1.4}
          strokeLinejoin="round"
        />
        {/* Prism apex label */}
        <text
          x={V_TOP[0]} y={V_TOP[1] - 8} fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace" fontSize={10}
          textAnchor="middle"
        >
          A = {PRISM_A_DEG}°
        </text>
        {/* Face-1 hit point marker (always visible so student sees where
            the ray would enter) */}
        <circle cx={P1_X} cy={P1_Y} r={2.4} fill="#54617A" />
        <text
          x={P1_X - 8} y={P1_Y - 6} fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace" fontSize={9}
          textAnchor="end"
        >
          i₁ = {INCIDENCE_I1_DEG}°
        </text>

        {/* ─── Live rays (Stages 1 & 2 only) ────────────────── */}
        {showLive && !exit.tir && face2 && (
          <g>
            {/* Incoming ray (source → P1) */}
            <line
              x1={SOURCE_X} y1={SOURCE_Y} x2={P1_X} y2={P1_Y}
              stroke={wavelengthCss(lambda, 0.85)} strokeWidth={2}
            />
            {/* Source glyph */}
            <circle
              cx={SOURCE_X} cy={SOURCE_Y} r={4.5}
              fill={laserGlow} opacity={0.9}
            >
              <animate attributeName="opacity" values="0.75;1;0.75" dur="1.8s" repeatCount="indefinite" />
            </circle>
            <text
              x={SOURCE_X} y={SOURCE_Y + 18} fill="#6C7A93"
              fontFamily="'JetBrains Mono', monospace" fontSize={10}
              textAnchor="middle"
            >
              {labels.source}
            </text>

            {/* Internal refracted ray (P1 → P2) */}
            <line
              x1={P1_X} y1={P1_Y} x2={face2.p2x} y2={face2.p2y}
              stroke={wavelengthCss(lambda, 0.55)} strokeWidth={1.6}
            />

            {/* Exit ray (P2 → onward) */}
            <line
              x1={face2.p2x} y1={face2.p2y}
              x2={face2.p2x + RAY_OUT_LEN * D_OUT_X}
              y2={face2.p2y + RAY_OUT_LEN * D_OUT_Y}
              stroke={wavelengthCss(lambda, 0.9)} strokeWidth={2}
            />
            <circle cx={face2.p2x} cy={face2.p2y} r={2.2} fill="#54617A" />
          </g>
        )}

        {/* TIR notice (live-stages only) */}
        {showLive && exit.tir && (
          <text
            x={P1_X + 40} y={P1_Y - 30} fill="#F97316"
            fontFamily="'JetBrains Mono', monospace" fontSize={11}
            letterSpacing="0.08em"
          >
            {labels.tir}
          </text>
        )}

        {/* ─── Target arrow (Stages 2 & 3) ─────────────────── */}
        {(isStage2 || isStage3) && (
          <g>
            <line
              x1={TARGET_ANCHOR_X} y1={TARGET_ANCHOR_Y}
              x2={TARGET_END_X} y2={TARGET_END_Y}
              stroke="#F97316" strokeWidth={2}
              strokeDasharray="6 5" opacity={0.85}
            />
            {/* Target arrowhead */}
            <circle
              cx={TARGET_END_X} cy={TARGET_END_Y}
              r={4} fill="none" stroke="#F97316" strokeWidth={1.5}
            />
            <circle
              cx={TARGET_END_X} cy={TARGET_END_Y}
              r={1.6} fill="#F97316"
            />
            {/* Target anchor tick */}
            <line
              x1={TARGET_ANCHOR_X - 4} y1={TARGET_ANCHOR_Y}
              x2={TARGET_ANCHOR_X + 4} y2={TARGET_ANCHOR_Y}
              stroke="#F9A968" strokeWidth={1.4}
            />
            <text
              x={TARGET_END_X + 8} y={TARGET_END_Y + 3} fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace" fontSize={10}
            >
              D* = {setup.targetD}°
            </text>
          </g>
        )}

        {/* Slider readouts inline near the prism (required info per §5.2) */}
        <text
          x={44} y={78} fill="#B9C4D6"
          fontFamily="'JetBrains Mono', monospace" fontSize={10}
          letterSpacing="0.08em"
        >
          λ = {lambda}nm
        </text>
        <text
          x={44} y={94} fill="#B9C4D6"
          fontFamily="'JetBrains Mono', monospace" fontSize={10}
          letterSpacing="0.08em"
        >
          A_c = {Ac.toFixed(3)}
        </text>
        <text
          x={44} y={110} fill="#B9C4D6"
          fontFamily="'JetBrains Mono', monospace" fontSize={10}
          letterSpacing="0.08em"
        >
          B_c = {Bc.toFixed(4)} μm²
        </text>

        {/* Stage-1 coverage strip in-scene (small text — full HUD lives above) */}
        {isStage1 && (
          <text
            x={44} y={404} fill="#6C7A93"
            fontFamily="'JetBrains Mono', monospace" fontSize={9}
            letterSpacing="0.06em"
          >
            {coverageText}
          </text>
        )}
      </svg>

      {/* ─── HUD overlays (HTML in rem) ───────────────────── */}
      <div
        style={{
          position: 'absolute', top: '3rem', left: '3rem',
          fontFamily: "'JetBrains Mono', monospace", fontSize: '2.3rem',
          letterSpacing: '0.14em', textTransform: 'uppercase',
          color: '#6C7A93', zIndex: 5, pointerEvents: 'none',
        }}
      >
        {hudTL}
      </div>
      <div
        style={{
          position: 'absolute', top: '3rem', right: '3rem',
          fontFamily: "'JetBrains Mono', monospace", fontSize: '2.3rem',
          letterSpacing: '0.08em',
          color: featureMatch && isStage2 ? '#37C9B8' : '#B9C4D6',
          zIndex: 5, pointerEvents: 'none', textAlign: 'right',
        }}
      >
        {hudTR}
      </div>
      <div
        style={{
          position: 'absolute', bottom: '3rem', left: '3rem',
          fontFamily: "'JetBrains Mono', monospace", fontSize: '2.3rem',
          letterSpacing: '0.06em', color: '#6C7A93', zIndex: 5,
          pointerEvents: 'none', maxWidth: '48%',
        }}
      >
        {hudBL}
      </div>
      {/* BR intentionally empty — reserved for parent chrome. */}

      {/* Slider column (right side, HTML overlay) */}
      <div
        style={{
          position: 'absolute',
          top: '6rem',
          right: '3rem',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '1.2rem',
          zIndex: 6,
        }}
      >
        <SliderVertical
          label="λ"
          unit="nm"
          value={lambda}
          min={LAMBDA_MIN}
          max={LAMBDA_MAX}
          step={LAMBDA_STEP}
          format={(v) => v.toFixed(0)}
          onChange={(v) => {
            setLambda(v)
            setLambdaMin((prev) => Math.min(prev, v))
            setLambdaMax((prev) => Math.max(prev, v))
          }}
          accent={wavelengthCss(lambda)}
        />
        <SliderVertical
          label="A_c"
          unit=""
          value={Ac}
          min={AC_MIN}
          max={AC_MAX}
          step={AC_STEP}
          format={(v) => v.toFixed(3)}
          onChange={(v) => {
            setAc(v)
            setAcMin((prev) => Math.min(prev, v))
            setAcMax((prev) => Math.max(prev, v))
          }}
        />
        <SliderVertical
          label="B_c"
          unit="μm²"
          value={Bc}
          min={BC_MIN}
          max={BC_MAX}
          step={BC_STEP}
          format={(v) => v.toFixed(4)}
          onChange={(v) => {
            setBc(v)
            setBcMin((prev) => Math.min(prev, v))
            setBcMax((prev) => Math.max(prev, v))
          }}
        />
      </div>
    </div>
  )
}

// ─── Slider primitive (adapted from diffraction reference) ─────────────
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
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.3rem' }}>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.3rem', color: '#54617A' }}>
        {format(max)}
      </div>
      <div style={{ width: '2.5rem', height: '11rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{
            width: '11rem',
            height: '2.2rem',
            transform: 'rotate(-90deg)',
            transformOrigin: 'center',
            accentColor: accent,
            cursor: 'pointer',
          }}
        />
      </div>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.3rem', color: '#54617A' }}>
        {format(min)}
      </div>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.7rem', color: accent }}>
        {label} = {format(value)}{unit ? ` ${unit}` : ''}
      </div>
    </div>
  )
}
