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
  arrowLengthPx,
  computeForce,
  COVERAGE_MIN_FRAC,
  formatForce,
  forceMatchesTolerance,
  M1_DEFAULT,
  M1_MAX,
  M1_MIN,
  M1_STEP,
  M2_DEFAULT,
  M2_MAX,
  M2_MIN,
  M2_STEP,
  R_DEFAULT,
  R_MAX,
  R_MIN,
  R_STEP,
  SETUPS,
} from './physics'

// ─── Canvas ───────────────────────────────────────────────────────────
const W = 800
const H = 450

// Scene geometry (SVG units) — scene lives in the left/centre band;
// right ~10rem is reserved for the HTML slider overlay.
const SCENE_L = 32
const SCENE_R = 620
const SCENE_T = 60
const SCENE_B = 400
const AXIS_Y = 235

const M1_X = 200 // primary mass centre
const M2_X = 520 // secondary mass centre

// Sphere radius scales with cube root of mass coefficient (constant density),
// clamped so visuals stay legible at the extremes.
function m1RadiusPx(m1: number): number {
  return Math.max(14, Math.min(52, 6 + 3.6 * Math.cbrt(m1 * 30)))
}
function m2RadiusPx(m2: number): number {
  return Math.max(9, Math.min(34, 4 + 2.4 * Math.cbrt(m2)))
}

// ─── Locale routing ───────────────────────────────────────────────────
const dict = { en, fr, ar } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── Component ────────────────────────────────────────────────────────
export default function Scene() {
  const { locale, seed } = useInit()
  const stages = useMemo(() => getStagesFor(locale), [locale])
  useDeclareStages(stages)
  const labels = useMemo(() => svgLabels(locale), [locale])

  const stageIdx = useCurrentStage()
  const setStage = useSetStage()
  const progress = useProgress()
  const complete = useComplete()

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  // Seed + fail-count → rotating setup index. Stage-3 miss advances the
  // rotation so the student can't brute-force the same target.
  const failCountRef = useRef(0)
  const [setupCursor, setSetupCursor] = useState(0)
  const setup = useMemo(
    () => SETUPS[(seed + setupCursor) % SETUPS.length]!,
    [seed, setupCursor],
  )

  // ─── DOF state ─────────────────────────────────────────────────────
  const [m1, setM1] = useState(M1_DEFAULT)
  const [m2, setM2] = useState(M2_DEFAULT)
  const [r, setR] = useState(R_DEFAULT)
  const [peekVisible, setPeekVisible] = useState(false)

  // Stage 1 coverage tracking (per DOF)
  const [m1Min, setM1SweepMin] = useState(M1_DEFAULT)
  const [m1Max, setM1SweepMax] = useState(M1_DEFAULT)
  const [m2Min, setM2SweepMin] = useState(M2_DEFAULT)
  const [m2Max, setM2SweepMax] = useState(M2_DEFAULT)
  const [rMin, setRSweepMin] = useState(R_DEFAULT)
  const [rMax, setRSweepMax] = useState(R_DEFAULT)

  const resetStageState = useCallback(() => {
    setM1(M1_DEFAULT)
    setM2(M2_DEFAULT)
    setR(R_DEFAULT)
    setM1SweepMin(M1_DEFAULT); setM1SweepMax(M1_DEFAULT)
    setM2SweepMin(M2_DEFAULT); setM2SweepMax(M2_DEFAULT)
    setRSweepMin(R_DEFAULT); setRSweepMax(R_DEFAULT)
    setPeekVisible(false)
  }, [])
  useReset(resetStageState)

  // ─── Derived ───────────────────────────────────────────────────────
  const F = computeForce(m1, m2, r)
  const featureMatch = forceMatchesTolerance(F, setup.targetForce)

  const cov1 = (m1Max - m1Min) / (M1_MAX - M1_MIN)
  const cov2 = (m2Max - m2Min) / (M2_MAX - M2_MIN)
  const cov3 = (rMax - rMin) / (R_MAX - R_MIN)
  const stage1Done =
    cov1 >= COVERAGE_MIN_FRAC &&
    cov2 >= COVERAGE_MIN_FRAC &&
    cov3 >= COVERAGE_MIN_FRAC

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
      // Stage-3 fail-with-restart: rotate to next setup, reset state.
      failCountRef.current += 1
      setSetupCursor((c) => c + 1)
      resetStageState()
    }
  })

  // ─── Peek (stage 3 only — text-only strategy tip) ──────────────────
  const PEEK_TIPS = useMemo(
    () => [labels.peek_tip_formula, labels.peek_tip_anchor],
    [labels],
  )
  const peekIdxRef = useRef(0)
  usePeek(() => {
    if (!isStage3) return
    peekIdxRef.current += 1
    setPeekVisible(true)
  })
  useEffect(() => {
    if (!peekVisible) return
    const t = setTimeout(() => setPeekVisible(false), 4000)
    return () => clearTimeout(t)
  }, [peekVisible])

  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  // ─── Rendering geometry ────────────────────────────────────────────
  const R1 = m1RadiusPx(m1)
  const R2 = m2RadiusPx(m2)

  // Live and target arrow lengths (log-scaled). Only used on stages 1+2.
  const liveArrowLen = arrowLengthPx(F)
  const targetArrowLen = arrowLengthPx(setup.targetForce)

  // Distance ruler: draw a dashed line between the two masses with an r label.
  // Position ticks span from just outside m1 to just outside m2 — r is text-only,
  // spheres are at fixed x positions (the drawing is schematic, not to scale
  // in r; the number in the ruler carries the actual distance information).
  const rulerL = M1_X + R1 + 4
  const rulerR = M2_X - R2 - 4

  const showLiveArrows = !isStage3
  const showTargetArrow = isStage2

  // HUD strings (BR reserved — must remain unassigned)
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`

  const targetForceText = formatForce(setup.targetForce)
  const liveForceText = formatForce(F)

  const hudTR = isStage1
    ? `m1·${(cov1 * 100).toFixed(0)}% m2·${(cov2 * 100).toFixed(0)}% r·${(cov3 * 100).toFixed(0)}%`
    : isStage2
      ? featureMatch
        ? `✓ ${labels.match_ok} · |F| = ${liveForceText}`
        : `|F| = ${liveForceText}`
      : `${labels.target}: |F*| = ${targetForceText}`

  const hudBL = peekVisible
    ? PEEK_TIPS[(peekIdxRef.current - 1) % PEEK_TIPS.length]!
    : isStage1
      ? labels.tip1
      : isStage2
        ? labels.tip2
        : labels.tip3

  // Stage 2 target readout (SVG text near the target arrow). Stage 3 also
  // shows the target readout as SVG text near the midpoint (required info).
  const midX = (M1_X + M2_X) / 2
  const targetReadoutY = AXIS_Y - 90

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block', userSelect: 'none' }}
      >
        {/* Full-canvas background — NO rx */}
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        {/* Scene frame */}
        <rect
          x={SCENE_L}
          y={SCENE_T}
          width={SCENE_R - SCENE_L}
          height={SCENE_B - SCENE_T}
          fill="none"
          stroke="#12203a"
          strokeWidth={1}
          rx={6}
        />
        <text
          x={SCENE_L + 8}
          y={SCENE_T - 8}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={11}
          letterSpacing="0.1em"
        >
          {labels.bench}
        </text>

        {/* Distance ruler between spheres */}
        <line
          x1={rulerL}
          y1={AXIS_Y}
          x2={rulerR}
          y2={AXIS_Y}
          stroke="#2A3654"
          strokeWidth={1}
          strokeDasharray="3 4"
        />
        <line x1={rulerL} y1={AXIS_Y - 5} x2={rulerL} y2={AXIS_Y + 5} stroke="#3A4863" strokeWidth={1} />
        <line x1={rulerR} y1={AXIS_Y - 5} x2={rulerR} y2={AXIS_Y + 5} stroke="#3A4863" strokeWidth={1} />
        <text
          x={midX}
          y={AXIS_Y + 22}
          fill="#8A96AE"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={11}
          textAnchor="middle"
        >
          r = {r.toFixed(0)} Mm
        </text>

        {/* Primary mass m1 (Earth-like) — left */}
        <defs>
          <radialGradient id="grad-m1" cx="35%" cy="35%" r="70%">
            <stop offset="0%" stopColor="#5F7BB0" />
            <stop offset="60%" stopColor="#2E4778" />
            <stop offset="100%" stopColor="#12203A" />
          </radialGradient>
          <radialGradient id="grad-m2" cx="35%" cy="35%" r="70%">
            <stop offset="0%" stopColor="#B9C4D6" />
            <stop offset="60%" stopColor="#6C7A93" />
            <stop offset="100%" stopColor="#2A3654" />
          </radialGradient>
        </defs>
        <circle cx={M1_X} cy={AXIS_Y} r={R1} fill="url(#grad-m1)" stroke="#5F7BB0" strokeWidth={0.8} />
        <text
          x={M1_X}
          y={AXIS_Y + R1 + 18}
          fill="#8A96AE"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={11}
          textAnchor="middle"
        >
          {labels.primary} = {m1.toFixed(1)}×10²⁴ kg
        </text>

        {/* Secondary mass m2 (satellite) — right */}
        <circle cx={M2_X} cy={AXIS_Y} r={R2} fill="url(#grad-m2)" stroke="#B9C4D6" strokeWidth={0.8} />
        <text
          x={M2_X}
          y={AXIS_Y + R2 + 18}
          fill="#8A96AE"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={11}
          textAnchor="middle"
        >
          {labels.secondary} = {m2.toFixed(1)}×10²² kg
        </text>

        {/* ─── Live force arrows (stages 1 + 2 only — the "help" per §4.7) ─── */}
        {showLiveArrows && (
          <g>
            {/* On m1, pointing RIGHT toward m2 */}
            <ArrowRight
              x0={M1_X + R1 + 2}
              y0={AXIS_Y}
              len={liveArrowLen}
              color="#37C9B8"
            />
            {/* On m2, pointing LEFT toward m1 */}
            <ArrowLeft
              x0={M2_X - R2 - 2}
              y0={AXIS_Y}
              len={liveArrowLen}
              color="#37C9B8"
            />
            {/* Force magnitude label above axis, centred */}
            <text
              x={midX}
              y={AXIS_Y - 26}
              fill="#37C9B8"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={11}
              textAnchor="middle"
            >
              |F| = {liveForceText}
            </text>
          </g>
        )}

        {/* ─── Stage 2 target arrow (dashed outline) ─── */}
        {showTargetArrow && (
          <g>
            <ArrowRightOutline
              x0={M1_X + R1 + 2}
              y0={AXIS_Y - 44}
              len={targetArrowLen}
              color="#F9A968"
            />
            <ArrowLeftOutline
              x0={M2_X - R2 - 2}
              y0={AXIS_Y - 44}
              len={targetArrowLen}
              color="#F9A968"
            />
            <text
              x={midX}
              y={targetReadoutY}
              fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={11}
              textAnchor="middle"
            >
              |F*| = {targetForceText}
            </text>
          </g>
        )}

        {/* ─── Stage 3 target readout (required info — no arrow) ─── */}
        {isStage3 && (
          <g>
            <rect
              x={midX - 100}
              y={targetReadoutY - 20}
              width={200}
              height={30}
              rx={4}
              fill="none"
              stroke="#F9A968"
              strokeWidth={1}
              strokeDasharray="4 3"
              opacity={0.9}
            />
            <text
              x={midX}
              y={targetReadoutY}
              fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={13}
              textAnchor="middle"
            >
              |F*| = {targetForceText}
            </text>
          </g>
        )}
      </svg>

      {/* ─── HUD overlays (HTML in rem — no BR) ───────────────────────── */}
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
          color: isStage2 && featureMatch ? '#37C9B8' : '#B9C4D6',
          zIndex: 5,
          pointerEvents: 'none',
          textAlign: 'right',
          maxWidth: '48%',
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
          color: peekVisible ? '#F9A968' : '#6C7A93',
          zIndex: 5,
          pointerEvents: 'none',
          maxWidth: '55%',
        }}
      >
        {hudBL}
      </div>
      {/* BR corner reserved for parent-side chrome (fullscreen toggle). */}

      {/* ─── Slider column (right, HTML overlay) ─────────────────────── */}
      <div
        style={{
          position: 'absolute',
          top: '8rem',
          right: '3rem',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '1.4rem',
          zIndex: 6,
        }}
      >
        <SliderVertical
          label="m₁"
          unit="×10²⁴kg"
          value={m1}
          min={M1_MIN}
          max={M1_MAX}
          step={M1_STEP}
          format={(v) => v.toFixed(1)}
          onChange={(v) => {
            setM1(v)
            setM1SweepMin((prev) => Math.min(prev, v))
            setM1SweepMax((prev) => Math.max(prev, v))
          }}
        />
        <SliderVertical
          label="m₂"
          unit="×10²²kg"
          value={m2}
          min={M2_MIN}
          max={M2_MAX}
          step={M2_STEP}
          format={(v) => v.toFixed(1)}
          onChange={(v) => {
            setM2(v)
            setM2SweepMin((prev) => Math.min(prev, v))
            setM2SweepMax((prev) => Math.max(prev, v))
          }}
        />
        <SliderVertical
          label="r"
          unit="Mm"
          value={r}
          min={R_MIN}
          max={R_MAX}
          step={R_STEP}
          format={(v) => v.toFixed(0)}
          onChange={(v) => {
            setR(v)
            setRSweepMin((prev) => Math.min(prev, v))
            setRSweepMax((prev) => Math.max(prev, v))
          }}
        />
      </div>
    </div>
  )
}

// ─── Arrow primitives ───────────────────────────────────────────────
function ArrowRight({
  x0, y0, len, color,
}: { x0: number; y0: number; len: number; color: string }) {
  const tipX = x0 + len
  const headW = 8
  const headH = 5
  return (
    <g>
      <line x1={x0} y1={y0} x2={tipX - headW} y2={y0} stroke={color} strokeWidth={2.5} />
      <polygon
        points={`${tipX},${y0} ${tipX - headW},${y0 - headH} ${tipX - headW},${y0 + headH}`}
        fill={color}
      />
    </g>
  )
}

function ArrowLeft({
  x0, y0, len, color,
}: { x0: number; y0: number; len: number; color: string }) {
  const tipX = x0 - len
  const headW = 8
  const headH = 5
  return (
    <g>
      <line x1={x0} y1={y0} x2={tipX + headW} y2={y0} stroke={color} strokeWidth={2.5} />
      <polygon
        points={`${tipX},${y0} ${tipX + headW},${y0 - headH} ${tipX + headW},${y0 + headH}`}
        fill={color}
      />
    </g>
  )
}

function ArrowRightOutline({
  x0, y0, len, color,
}: { x0: number; y0: number; len: number; color: string }) {
  const tipX = x0 + len
  const headW = 8
  const headH = 5
  return (
    <g>
      <line
        x1={x0}
        y1={y0}
        x2={tipX - headW}
        y2={y0}
        stroke={color}
        strokeWidth={1.5}
        strokeDasharray="4 3"
      />
      <polygon
        points={`${tipX},${y0} ${tipX - headW},${y0 - headH} ${tipX - headW},${y0 + headH}`}
        fill="none"
        stroke={color}
        strokeWidth={1.2}
      />
    </g>
  )
}

function ArrowLeftOutline({
  x0, y0, len, color,
}: { x0: number; y0: number; len: number; color: string }) {
  const tipX = x0 - len
  const headW = 8
  const headH = 5
  return (
    <g>
      <line
        x1={x0}
        y1={y0}
        x2={tipX + headW}
        y2={y0}
        stroke={color}
        strokeWidth={1.5}
        strokeDasharray="4 3"
      />
      <polygon
        points={`${tipX},${y0} ${tipX + headW},${y0 - headH} ${tipX + headW},${y0 + headH}`}
        fill="none"
        stroke={color}
        strokeWidth={1.2}
      />
    </g>
  )
}

// ─── Slider primitive (rotated vertical range input) ─────────────────
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
      <div style={{ width: '2.5rem', height: '14rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{
            width: '14rem',
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
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.9rem', color: accent, textAlign: 'center' }}>
        {label} = {format(value)} {unit}
      </div>
    </div>
  )
}
