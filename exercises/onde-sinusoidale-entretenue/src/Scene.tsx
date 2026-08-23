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
import {
  SETUPS,
  waveSnapshot,
  wavelength,
  wavelengthMatchesTolerance,
} from './physics'

// ─── Scene constants ─────────────────────────────────────────
const W = 800
const H = 450

// Rope geometry (SVG units)
const ROPE_X_START = 90
const ROPE_X_END = 590
const ROPE_Y = 230
const ROPE_LENGTH_PHYS = 4.0 // meters
const PX_PER_M = (ROPE_X_END - ROPE_X_START) / ROPE_LENGTH_PHYS // = 125
const Y_SCALE = 5 // SVG units per cm of amplitude (max ±25)

// Stage 2/3 target bracket anchor (physical x of first marker)
const TARGET_START_M = 0.5

// ─── Physics DOF constants ───────────────────────────────────
const A_MIN = 0.5 // cm
const A_MAX = 5.0 // cm
const A_DEFAULT = 2.5 // cm

const T_MIN = 0.10 // s
const T_MAX = 1.00 // s
const T_DEFAULT = 0.50 // s

const C_MIN = 0.5 // m/s
const C_MAX = 5.0 // m/s
const C_DEFAULT = 2.0 // m/s

// Coverage threshold for stage 1
const COVERAGE_MIN_FRAC = 0.5

// Wave sampling count
const WAVE_SAMPLES = 200

// ─── Label loader ────────────────────────────────────────────
const dict = { en, fr, ar } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── Formatters ──────────────────────────────────────────────
function fmtM(m: number): string {
  return `${m.toFixed(2)}m`
}

// Convert physical x (meters) → SVG x.
function pxToSvgX(xM: number): number {
  return ROPE_X_START + xM * PX_PER_M
}

// ─── Component ──────────────────────────────────────────────
export default function Scene() {
  const { locale, seed } = useInit()
  const stages = useMemo(() => getStagesFor(locale), [locale])
  useDeclareStages(stages)
  const labels = useMemo(() => svgLabels(locale), [locale])

  // Seed-indexed setup selection (hand-authored)
  const failCountRef = useRef(0)
  const [setupIdx, setSetupIdx] = useState(() => seed % SETUPS.length)
  const setup = SETUPS[setupIdx]!

  const stageIdx = useCurrentStage()
  const setStage = useSetStage()
  const progress = useProgress()
  const complete = useComplete()

  // ─── DOF state ─────────────────────────────────────────────
  const [A, setA] = useState(A_DEFAULT)
  const [T, setT] = useState(T_DEFAULT)
  const [c, setC] = useState(C_DEFAULT)
  const [peekVisible, setPeekVisible] = useState(false)

  // Stage 1 coverage tracking
  const [aMin, setAMinCov] = useState(A_DEFAULT)
  const [aMax, setAMaxCov] = useState(A_DEFAULT)
  const [tMin, setTMinCov] = useState(T_DEFAULT)
  const [tMax, setTMaxCov] = useState(T_DEFAULT)
  const [cMin, setCMinCov] = useState(C_DEFAULT)
  const [cMax, setCMaxCov] = useState(C_DEFAULT)

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  const resetStageState = useCallback(() => {
    setA(A_DEFAULT)
    setT(T_DEFAULT)
    setC(C_DEFAULT)
    setAMinCov(A_DEFAULT); setAMaxCov(A_DEFAULT)
    setTMinCov(T_DEFAULT); setTMaxCov(T_DEFAULT)
    setCMinCov(C_DEFAULT); setCMaxCov(C_DEFAULT)
    setPeekVisible(false)
  }, [])
  useReset(resetStageState)

  // Coverage (stage 1 advance predicate)
  const covA = (aMax - aMin) / (A_MAX - A_MIN)
  const covT = (tMax - tMin) / (T_MAX - T_MIN)
  const covC = (cMax - cMin) / (C_MAX - C_MIN)
  const stage1Done =
    covA >= COVERAGE_MIN_FRAC &&
    covT >= COVERAGE_MIN_FRAC &&
    covC >= COVERAGE_MIN_FRAC

  // Feature: current wavelength
  const currentLambda = wavelength(c, T)
  const featureMatch = wavelengthMatchesTolerance(currentLambda, setup.targetLambda)

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
      // Stage 3 fail: rotate to next setup, reset sliders.
      failCountRef.current += 1
      setSetupIdx((prev) => (prev + 1) % SETUPS.length)
      resetStageState()
    }
  })

  // Peek — text-only strategy hints. Rotates through two tips.
  const PEEK_TIPS = useMemo(
    () => [labels.peek_tip_formula, labels.peek_tip_anchor],
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

  // ─── Wave polyline points (spatial snapshot at t = 0) ─────
  // Rendered only on stages 1 and 2 — this IS the "help" per §4.7.
  const showWave = !isStage3
  const wavePath = useMemo(() => {
    if (!showWave) return ''
    const pts: string[] = []
    for (let i = 0; i <= WAVE_SAMPLES; i++) {
      const xM = (i / WAVE_SAMPLES) * ROPE_LENGTH_PHYS
      const yCm = waveSnapshot(A, c, T, xM)
      const sx = pxToSvgX(xM)
      const sy = ROPE_Y - yCm * Y_SCALE
      pts.push(`${sx.toFixed(2)},${sy.toFixed(2)}`)
    }
    return `M ${pts.join(' L ')}`
  }, [showWave, A, c, T])

  // Target bracket geometry (used on stage 2 as a bracket, stage 3 as markers)
  const targetX1M = TARGET_START_M
  const targetX2M = TARGET_START_M + setup.targetLambda
  const targetSvgX1 = pxToSvgX(targetX1M)
  const targetSvgX2 = pxToSvgX(targetX2M)

  // ─── HUD text ─────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`
  const hudTR = isStage1
    ? `A·${(covA * 100).toFixed(0)}% T·${(covT * 100).toFixed(0)}% c·${(covC * 100).toFixed(0)}%`
    : `λ = c · T = ${fmtM(currentLambda)}`
  const hudBL = peekVisible
    ? PEEK_TIPS[(peekIdxRef.current - 1) % PEEK_TIPS.length]!
    : isStage1
      ? labels.tip1
      : isStage2
        ? labels.tip2
        : labels.tip3
  // BR reserved for parent chrome — DO NOT add a BR overlay.

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block', userSelect: 'none' }}
      >
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        {/* Bench frame */}
        <rect
          x={32}
          y={60}
          width={560}
          height={340}
          fill="none"
          stroke="#12203a"
          strokeWidth={1}
          rx={6}
        />
        <text
          x={40}
          y={52}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={11}
          letterSpacing="0.1em"
        >
          {labels.bench_label}
        </text>

        {/* Rope rest axis (dashed) */}
        <line
          x1={ROPE_X_START}
          y1={ROPE_Y}
          x2={ROPE_X_END}
          y2={ROPE_Y}
          stroke="#2A3654"
          strokeWidth={1}
          strokeDasharray="3 4"
        />

        {/* x-scale ticks: every 0.5 m */}
        {Array.from({ length: 9 }, (_, i) => {
          const xM = i * 0.5
          const sx = pxToSvgX(xM)
          return (
            <g key={`tick-${i}`}>
              <line
                x1={sx}
                y1={ROPE_Y + 30}
                x2={sx}
                y2={ROPE_Y + 34}
                stroke="#2A3654"
                strokeWidth={1}
              />
              <text
                x={sx}
                y={ROPE_Y + 46}
                fill="#54617A"
                fontFamily="'JetBrains Mono', monospace"
                fontSize={9}
                textAnchor="middle"
              >
                {xM.toFixed(1)}
              </text>
            </g>
          )
        })}
        <text
          x={ROPE_X_END + 10}
          y={ROPE_Y + 48}
          fill="#54617A"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={9}
        >
          x (m)
        </text>

        {/* Source S — vibrating knob at rope origin */}
        <rect
          x={ROPE_X_START - 22}
          y={ROPE_Y - 14}
          width={16}
          height={28}
          fill="#1A2338"
          stroke="#54617A"
          strokeWidth={1}
          rx={2}
        />
        <circle
          cx={ROPE_X_START - 14}
          cy={ROPE_Y}
          r={4}
          fill="#37C9B8"
          opacity={0.9}
        >
          <animate
            attributeName="opacity"
            values="0.6;1;0.6"
            dur="1.6s"
            repeatCount="indefinite"
          />
        </circle>
        <text
          x={ROPE_X_START - 14}
          y={ROPE_Y - 24}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={10}
          textAnchor="middle"
        >
          {labels.source_label}
        </text>

        {/* Wave polyline (spatial snapshot at t=0) — hidden on stage 3 */}
        {showWave && (
          <path
            d={wavePath}
            fill="none"
            stroke="#37C9B8"
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {/* Amplitude scale gauge (left side of rope area) — reference lines */}
        <line
          x1={ROPE_X_START - 4}
          y1={ROPE_Y - A_MAX * Y_SCALE}
          x2={ROPE_X_START - 4}
          y2={ROPE_Y + A_MAX * Y_SCALE}
          stroke="#2A3654"
          strokeWidth={0.8}
        />
        <line
          x1={ROPE_X_START - 8}
          y1={ROPE_Y - A_MAX * Y_SCALE}
          x2={ROPE_X_START}
          y2={ROPE_Y - A_MAX * Y_SCALE}
          stroke="#2A3654"
          strokeWidth={0.8}
        />
        <line
          x1={ROPE_X_START - 8}
          y1={ROPE_Y + A_MAX * Y_SCALE}
          x2={ROPE_X_START}
          y2={ROPE_Y + A_MAX * Y_SCALE}
          stroke="#2A3654"
          strokeWidth={0.8}
        />
        <text
          x={ROPE_X_START - 12}
          y={ROPE_Y - A_MAX * Y_SCALE + 4}
          fill="#54617A"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={9}
          textAnchor="end"
        >
          +5cm
        </text>
        <text
          x={ROPE_X_START - 12}
          y={ROPE_Y + A_MAX * Y_SCALE + 4}
          fill="#54617A"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={9}
          textAnchor="end"
        >
          −5cm
        </text>

        {/* Stage 2 target bracket — dashed span across one wavelength */}
        {isStage2 && (
          <g>
            {/* Vertical dashed markers at x1 and x2 */}
            <line
              x1={targetSvgX1}
              y1={ROPE_Y - 40}
              x2={targetSvgX1}
              y2={ROPE_Y + 20}
              stroke="#F97316"
              strokeWidth={1}
              strokeDasharray="4 4"
              opacity={0.75}
            />
            <line
              x1={targetSvgX2}
              y1={ROPE_Y - 40}
              x2={targetSvgX2}
              y2={ROPE_Y + 20}
              stroke="#F97316"
              strokeWidth={1}
              strokeDasharray="4 4"
              opacity={0.75}
            />
            {/* Horizontal bracket above */}
            <line
              x1={targetSvgX1}
              y1={ROPE_Y - 40}
              x2={targetSvgX2}
              y2={ROPE_Y - 40}
              stroke="#F97316"
              strokeWidth={1}
              opacity={0.8}
            />
            <text
              x={(targetSvgX1 + targetSvgX2) / 2}
              y={ROPE_Y - 46}
              fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={11}
              textAnchor="middle"
            >
              {labels.lambda_target} = {fmtM(setup.targetLambda)}
            </text>
          </g>
        )}

        {/* Stage 3 markers — M_A, M_B at Δx = λ* apart */}
        {isStage3 && (
          <g>
            <circle
              cx={targetSvgX1}
              cy={ROPE_Y}
              r={5}
              fill="none"
              stroke="#F97316"
              strokeWidth={1.5}
            />
            <circle cx={targetSvgX1} cy={ROPE_Y} r={2.5} fill="#F97316" />
            <text
              x={targetSvgX1}
              y={ROPE_Y - 14}
              fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
              textAnchor="middle"
            >
              {labels.marker_a}
            </text>

            <circle
              cx={targetSvgX2}
              cy={ROPE_Y}
              r={5}
              fill="none"
              stroke="#F97316"
              strokeWidth={1.5}
            />
            <circle cx={targetSvgX2} cy={ROPE_Y} r={2.5} fill="#F97316" />
            <text
              x={targetSvgX2}
              y={ROPE_Y - 14}
              fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
              textAnchor="middle"
            >
              {labels.marker_b}
            </text>

            {/* Δx annotation between markers */}
            <line
              x1={targetSvgX1}
              y1={ROPE_Y + 14}
              x2={targetSvgX2}
              y2={ROPE_Y + 14}
              stroke="#F97316"
              strokeWidth={1}
              opacity={0.8}
            />
            <line
              x1={targetSvgX1}
              y1={ROPE_Y + 11}
              x2={targetSvgX1}
              y2={ROPE_Y + 17}
              stroke="#F97316"
              strokeWidth={1}
              opacity={0.8}
            />
            <line
              x1={targetSvgX2}
              y1={ROPE_Y + 11}
              x2={targetSvgX2}
              y2={ROPE_Y + 17}
              stroke="#F97316"
              strokeWidth={1}
              opacity={0.8}
            />
            <text
              x={(targetSvgX1 + targetSvgX2) / 2}
              y={ROPE_Y + 26}
              fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={11}
              textAnchor="middle"
            >
              {labels.delta_x} = {fmtM(setup.targetLambda)}
            </text>
          </g>
        )}
      </svg>

      {/* HUD overlays — HTML in rem */}
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
          color: '#B9C4D6',
          zIndex: 5,
          pointerEvents: 'none',
          textAlign: 'right',
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
          maxWidth: '55%',
        }}
      >
        {hudBL}
      </div>
      {/* NO bottom-right — reserved for parent chrome. */}

      {/* Slider column (right side, HTML overlay) */}
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
          label="A"
          unit="cm"
          value={A}
          min={A_MIN}
          max={A_MAX}
          step={0.1}
          format={(v) => v.toFixed(1)}
          onChange={(v) => {
            setA(v)
            setAMinCov((prev) => Math.min(prev, v))
            setAMaxCov((prev) => Math.max(prev, v))
          }}
        />
        <SliderVertical
          label="T"
          unit="s"
          value={T}
          min={T_MIN}
          max={T_MAX}
          step={0.01}
          format={(v) => v.toFixed(2)}
          onChange={(v) => {
            setT(v)
            setTMinCov((prev) => Math.min(prev, v))
            setTMaxCov((prev) => Math.max(prev, v))
          }}
        />
        <SliderVertical
          label="c"
          unit="m/s"
          value={c}
          min={C_MIN}
          max={C_MAX}
          step={0.05}
          format={(v) => v.toFixed(2)}
          onChange={(v) => {
            setC(v)
            setCMinCov((prev) => Math.min(prev, v))
            setCMaxCov((prev) => Math.max(prev, v))
          }}
        />
      </div>

    </div>
  )
}

// ─── Slider primitive ────────────────────────────────────────
function SliderVertical({
  label,
  unit,
  value,
  min,
  max,
  step,
  format,
  onChange,
  accent = '#37C9B8',
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
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '0.4rem',
      }}
    >
      <div
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '1.5rem',
          color: '#54617A',
        }}
      >
        {format(max)}
      </div>
      <div
        style={{
          width: '2.5rem',
          height: '15rem',
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
            width: '15rem',
            height: '2.2rem',
            transform: 'rotate(-90deg)',
            transformOrigin: 'center',
            accentColor: accent,
            cursor: 'pointer',
          }}
        />
      </div>
      <div
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '1.5rem',
          color: '#54617A',
        }}
      >
        {format(min)}
      </div>
      <div
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '1.9rem',
          color: accent,
        }}
      >
        {label} = {format(value)}
        {unit}
      </div>
    </div>
  )
}
