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
  equilibriumHeightM,
  fRepAt,
  featureMatchesTolerance,
  I_DEFAULT,
  I_MAX,
  I_MIN,
  I_STEP,
  M_DEFAULT,
  M_MAX,
  M_MIN,
  M_STEP,
  N_DEFAULT,
  N_MAX,
  N_MIN,
  N_STEP,
  SETUPS,
  weightN,
} from './physics'

// ─── Scene constants ─────────────────────────────────────────────────────
const W = 800
const H = 450

// Left column = schematic; right column = slider stack.
const COIL_X = 300
const BASE_Y = 390 // h = 0 cm on the SVG plane
const AXIS_TOP = 90 // h = 30 cm
const HEIGHT_SCALE_PX_PER_CM = 10 // 300 SVG px cover 30 cm
const RULER_X = 110
const H_SCALE_MAX_CM = 30

const COVERAGE_MIN_FRAC = 0.5

// Reference weight/force magnitude used to size force arrows visually.
// Chosen so a 20 g puck at ~1× g produces a comfortable-length arrow.
const ARROW_REF_N = 0.25

const dict = { en, fr, ar } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── Formatting helpers ─────────────────────────────────────────────────
function formatCm(cm: number): string {
  if (cm >= 100) return `${cm.toFixed(0)}cm`
  if (cm >= 10) return `${cm.toFixed(1)}cm`
  return `${cm.toFixed(2)}cm`
}
function formatI(a: number): string {
  return a.toFixed(2)
}
function formatN(n: number): string {
  return n.toFixed(0)
}
function formatM(g: number): string {
  return g.toFixed(1)
}

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

  // failCount lets us rotate to a different setup on stage-3 fail-with-restart.
  const failCountRef = useRef(0)
  const [failTick, setFailTick] = useState(0)
  const setup = useMemo(
    () => SETUPS[(seed + failCountRef.current) % SETUPS.length]!,
    // failTick forces re-eval after a fail
    [seed, failTick],
  )

  const [current, setCurrent] = useState(I_DEFAULT)
  const [turns, setTurns] = useState(N_DEFAULT)
  const [mass, setMass] = useState(M_DEFAULT)
  const [peekVisible, setPeekVisible] = useState(false)
  const peekIdxRef = useRef(0)

  const [iMin, setIMinCov] = useState(I_DEFAULT)
  const [iMax, setIMaxCov] = useState(I_DEFAULT)
  const [nMinCov, setNMinCov] = useState(N_DEFAULT)
  const [nMaxCov, setNMaxCov] = useState(N_DEFAULT)
  const [mMinCov, setMMinCov] = useState(M_DEFAULT)
  const [mMaxCov, setMMaxCov] = useState(M_DEFAULT)

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  const resetStageState = useCallback(() => {
    setCurrent(I_DEFAULT)
    setTurns(N_DEFAULT)
    setMass(M_DEFAULT)
    setIMinCov(I_DEFAULT); setIMaxCov(I_DEFAULT)
    setNMinCov(N_DEFAULT); setNMaxCov(N_DEFAULT)
    setMMinCov(M_DEFAULT); setMMaxCov(M_DEFAULT)
    setPeekVisible(false)
  }, [])
  useReset(() => {
    failCountRef.current = 0
    setFailTick((t) => t + 1)
    resetStageState()
  })

  // Coverage — each DOF must be swept ≥ 50 % of its range.
  const covI = (iMax - iMin) / (I_MAX - I_MIN)
  const covN = (nMaxCov - nMinCov) / (N_MAX - N_MIN)
  const covM = (mMaxCov - mMinCov) / (M_MAX - M_MIN)
  const stage1Done =
    covI >= COVERAGE_MIN_FRAC &&
    covN >= COVERAGE_MIN_FRAC &&
    covM >= COVERAGE_MIN_FRAC

  // Physics: current equilibrium height, in metres.
  const hEqM = equilibriumHeightM(current, mass, turns)
  const hEqCm = hEqM * 100
  const targetHM = setup.hTargetCm / 100
  const featureMatch = featureMatchesTolerance(hEqM, targetHM)

  // Live force magnitudes (used for arrows on stage 1+2 only).
  const fRep = fRepAt(current, turns, Math.max(hEqM, 1e-4))
  const pDown = weightN(mass)

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
      // Fail-with-restart: rotate to next seeded setup, reset sliders.
      failCountRef.current += 1
      setFailTick((t) => t + 1)
      resetStageState()
    }
  })

  // Peek: strategy hint only, blind stage only. Text — never the rendering.
  const PEEK_TIPS = useMemo(
    () => [labels.peek_tip_formula, labels.peek_tip_anchor],
    [labels],
  )
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

  // ─── Puck / arrow rendering (help — gated OFF on stage 3) ─────────────
  const showLiveScene = !isStage3
  const hEqPx = Math.min(
    Math.max(hEqCm, 0),
    H_SCALE_MAX_CM,
  ) * HEIGHT_SCALE_PX_PER_CM
  const puckY = BASE_Y - hEqPx

  const targetPx = setup.hTargetCm * HEIGHT_SCALE_PX_PER_CM
  const targetY = BASE_Y - targetPx

  // Force arrow lengths (SVG px), capped for readability.
  const arrowUp = Math.min(80, 40 * (fRep / ARROW_REF_N))
  const arrowDown = Math.min(80, 40 * (pDown / ARROW_REF_N))

  // ─── HUD ──────────────────────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`
  const hudTR = isStage1
    ? `I·${(covI * 100).toFixed(0)}% N·${(covN * 100).toFixed(0)}% m·${(covM * 100).toFixed(0)}%`
    : isStage2
      ? `h = ${formatCm(hEqCm)}`
      : `I=${formatI(current)}A N=${formatN(turns)} m=${formatM(mass)}g`
  const hudBL = peekVisible
    ? PEEK_TIPS[(peekIdxRef.current - 1) % PEEK_TIPS.length]!
    : (isStage1 ? labels.tip1 : isStage2 ? labels.tip2 : labels.tip3)
  // NO BR — reserved for parent chrome.

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
          width={490}
          height={358}
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

        {/* ─── Ruler (always visible) ────────────────────────────── */}
        <line
          x1={RULER_X}
          y1={AXIS_TOP}
          x2={RULER_X}
          y2={BASE_Y}
          stroke="#2A3654"
          strokeWidth={1}
        />
        {[0, 5, 10, 15, 20, 25, 30].map((cm) => {
          const y = BASE_Y - cm * HEIGHT_SCALE_PX_PER_CM
          const isMajor = cm % 10 === 0
          return (
            <g key={`tick-${cm}`}>
              <line
                x1={RULER_X - (isMajor ? 10 : 6)}
                y1={y}
                x2={RULER_X}
                y2={y}
                stroke="#54617A"
                strokeWidth={isMajor ? 1.2 : 0.8}
              />
              <text
                x={RULER_X - 14}
                y={y + 3}
                fill="#6C7A93"
                fontFamily="'JetBrains Mono', monospace"
                fontSize={9}
                textAnchor="end"
              >
                {cm}
              </text>
            </g>
          )
        })}
        <text
          x={RULER_X - 34}
          y={AXIS_TOP - 8}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={10}
          letterSpacing="0.06em"
        >
          {labels.height_axis}
        </text>

        {/* ─── Ground plate + coil (always visible) ───────────────── */}
        <line
          x1={40}
          y1={BASE_Y + 8}
          x2={514}
          y2={BASE_Y + 8}
          stroke="#2A3654"
          strokeWidth={1}
        />
        {/* Coil turns — a couple of shallow ellipses stacked for a coil silhouette */}
        <g>
          <ellipse cx={COIL_X} cy={BASE_Y - 6} rx={82} ry={10} fill="#1A2338" stroke="#54617A" strokeWidth={1} />
          <ellipse cx={COIL_X} cy={BASE_Y - 2} rx={82} ry={10} fill="#22314F" stroke="#54617A" strokeWidth={1} />
          <ellipse cx={COIL_X} cy={BASE_Y + 2} rx={82} ry={10} fill="#22314F" stroke="#54617A" strokeWidth={1} />
          <ellipse cx={COIL_X} cy={BASE_Y + 6} rx={82} ry={10} fill="#1A2338" stroke="#54617A" strokeWidth={1} />
          {/* Wire leads */}
          <line x1={COIL_X - 82} y1={BASE_Y + 6} x2={COIL_X - 100} y2={BASE_Y + 18} stroke="#54617A" strokeWidth={1.5} />
          <line x1={COIL_X + 82} y1={BASE_Y + 6} x2={COIL_X + 100} y2={BASE_Y + 18} stroke="#54617A" strokeWidth={1.5} />
        </g>
        <text
          x={COIL_X}
          y={BASE_Y + 34}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={10}
          textAnchor="middle"
          letterSpacing="0.06em"
        >
          {labels.coil_label} · N = {formatN(turns)} · I = {formatI(current)} A
        </text>

        {/* Height reference guide from ruler to the coil axis, dashed */}
        <line
          x1={RULER_X}
          y1={BASE_Y}
          x2={COIL_X - 82}
          y2={BASE_Y}
          stroke="#2A3654"
          strokeWidth={1}
          strokeDasharray="2 4"
        />

        {/* ─── Target line (stages 2 + 3) ─────────────────────────── */}
        {(isStage2 || isStage3) && (
          <g>
            <line
              x1={RULER_X}
              y1={targetY}
              x2={510}
              y2={targetY}
              stroke="#F97316"
              strokeWidth={1.2}
              strokeDasharray="6 4"
              opacity={0.85}
            />
            <text
              x={510}
              y={targetY - 6}
              fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={11}
              textAnchor="end"
              letterSpacing="0.05em"
            >
              {labels.target_line} = {setup.hTargetCm} cm
            </text>
            {/* Target tick on the ruler */}
            <line
              x1={RULER_X - 12}
              y1={targetY}
              x2={RULER_X}
              y2={targetY}
              stroke="#F97316"
              strokeWidth={2}
            />
          </g>
        )}

        {/* ─── Live puck + force arrows (help — gated on stages 1 + 2) ─ */}
        {showLiveScene && (
          <g>
            {/* Faint vertical guideline from coil to puck */}
            <line
              x1={COIL_X}
              y1={BASE_Y - 12}
              x2={COIL_X}
              y2={puckY}
              stroke="#2A3654"
              strokeWidth={0.6}
              strokeDasharray="1 3"
            />
            {/* Puck body */}
            <rect
              x={COIL_X - 26}
              y={puckY - 8}
              width={52}
              height={16}
              rx={4}
              fill="#3A4863"
              stroke="#8FA3C5"
              strokeWidth={1}
            />
            <rect
              x={COIL_X - 22}
              y={puckY - 4}
              width={44}
              height={8}
              rx={2}
              fill="#54617A"
            />
            {/* Force arrow: F_rep pointing up */}
            <line
              x1={COIL_X}
              y1={puckY - 8}
              x2={COIL_X}
              y2={puckY - 8 - arrowUp}
              stroke="#37C9B8"
              strokeWidth={2}
            />
            <polygon
              points={`${COIL_X - 4},${puckY - 8 - arrowUp + 6} ${COIL_X + 4},${puckY - 8 - arrowUp + 6} ${COIL_X},${puckY - 8 - arrowUp - 2}`}
              fill="#37C9B8"
            />
            <text
              x={COIL_X + 8}
              y={puckY - 8 - arrowUp + 4}
              fill="#37C9B8"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
            >
              {labels.force_up}
            </text>
            {/* Force arrow: P pointing down */}
            <line
              x1={COIL_X + 20}
              y1={puckY + 8}
              x2={COIL_X + 20}
              y2={puckY + 8 + arrowDown}
              stroke="#F97316"
              strokeWidth={2}
            />
            <polygon
              points={`${COIL_X + 16},${puckY + 8 + arrowDown - 6} ${COIL_X + 24},${puckY + 8 + arrowDown - 6} ${COIL_X + 20},${puckY + 8 + arrowDown + 2}`}
              fill="#F97316"
            />
            <text
              x={COIL_X + 28}
              y={puckY + 8 + arrowDown - 4}
              fill="#F97316"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
            >
              {labels.force_down}
            </text>
            {/* Puck label + live height */}
            <text
              x={COIL_X - 32}
              y={puckY + 3}
              fill="#B9C4D6"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
              textAnchor="end"
            >
              {labels.puck_label}
            </text>
          </g>
        )}
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
          maxWidth: '52%',
        }}
      >
        {hudBL}
      </div>
      {/* BR reserved — no overlay here. */}

      {/* Slider column (right side) */}
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
          label="I"
          unit="A"
          value={current}
          min={I_MIN}
          max={I_MAX}
          step={I_STEP}
          format={(v) => v.toFixed(2)}
          onChange={(v) => {
            setCurrent(v)
            setIMinCov((prev) => Math.min(prev, v))
            setIMaxCov((prev) => Math.max(prev, v))
          }}
        />
        <SliderVertical
          label="N"
          unit=""
          value={turns}
          min={N_MIN}
          max={N_MAX}
          step={N_STEP}
          format={(v) => v.toFixed(0)}
          onChange={(v) => {
            setTurns(v)
            setNMinCov((prev) => Math.min(prev, v))
            setNMaxCov((prev) => Math.max(prev, v))
          }}
        />
        <SliderVertical
          label="m"
          unit="g"
          value={mass}
          min={M_MIN}
          max={M_MAX}
          step={M_STEP}
          format={(v) => v.toFixed(1)}
          onChange={(v) => {
            setMass(v)
            setMMinCov((prev) => Math.min(prev, v))
            setMMaxCov((prev) => Math.max(prev, v))
          }}
        />
      </div>
    </div>
  )
}

// ─── Slider primitive (copied from diffraction, adapted) ────────────────
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
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.4rem' }}>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.5rem', color: '#54617A' }}>
        {format(max)}
      </div>
      <div style={{ width: '2.5rem', height: '12rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{
            width: '12rem',
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
