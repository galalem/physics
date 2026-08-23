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
import { coulombForce, forceMatchesTolerance, SETUPS } from './physics'

// ─── Scene constants ────────────────────────────────────────────────────
const W = 800
const H = 450

// Bench geometry (SVG units)
const AXIS_Y = 225
const Q1_X = 200            // fixed x of q1
const PX_PER_CM = 8         // metric scale: r ∈ [5, 50] cm → [40, 400] px between charges
const Q2_MAX_X = 600        // max x of q2 (r = 50 cm)
const ARROW_MAX_PX = 190    // cap arrow length visually
const CHARGE_R = 12         // charge circle radius (SVG units)

// Physics parameters (display units)
const Q1_MIN = 0.5   // µC
const Q1_MAX = 10.0  // µC
const Q1_DEFAULT = 2.0
const Q2_MIN = 0.5
const Q2_MAX = 10.0
const Q2_DEFAULT = 2.0
const R_MIN = 5.0    // cm
const R_MAX = 50.0   // cm
const R_DEFAULT = 25.0

// Slider-coverage threshold for stage 1 advance
const COVERAGE_MIN_FRAC = 0.5

// ─── i18n dictionary — EN only (fr/ar bulk pass later) ───────────────
const dict = { en, fr, ar } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── Visual helpers ────────────────────────────────────────────────────
/** Log-scaled arrow length in SVG pixels for a given force magnitude in N. */
function arrowLenPx(fN: number): number {
  const raw = 15 + 55 * Math.log10(1 + Math.max(fN, 0))
  return Math.max(15, Math.min(ARROW_MAX_PX, raw))
}

/** Compact newton formatter with dynamic precision. */
function formatN(f: number): string {
  if (f >= 100) return `${f.toFixed(0)}N`
  if (f >= 10) return `${f.toFixed(1)}N`
  if (f >= 1) return `${f.toFixed(2)}N`
  return `${f.toFixed(3)}N`
}

/** Compact micro-coulomb formatter. */
function formatUC(q: number): string {
  return `${q.toFixed(1)}µC`
}

/** Compact centimetre formatter. */
function formatCm(r: number): string {
  return `${r.toFixed(1)}cm`
}

// ─── Component ──────────────────────────────────────────────────────────
export default function Scene() {
  const { locale, seed } = useInit()
  const stages = useMemo(() => getStagesFor(locale), [locale])
  useDeclareStages(stages)
  const labels = useMemo(() => svgLabels(locale), [locale])

  // Seed-indexed setup selection + fail rotation (stage 3 fail-with-restart)
  const failCountRef = useRef(0)
  const [failTick, setFailTick] = useState(0)
  const setup = useMemo(
    () => SETUPS[(seed + failTick) % SETUPS.length]!,
    [seed, failTick],
  )

  const stageIdx = useCurrentStage()
  const setStage = useSetStage()
  const progress = useProgress()
  const complete = useComplete()

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  // ─── DOF state ────────────────────────────────────────────────────
  const [q1, setQ1] = useState(Q1_DEFAULT)
  const [q2, setQ2] = useState(Q2_DEFAULT)
  const [r, setR] = useState(R_DEFAULT)
  const [peekVisible, setPeekVisible] = useState(false)
  const peekIdxRef = useRef(0)

  // Stage 1 coverage tracking (min/max seen per DOF)
  const [q1Min, setQ1Min] = useState(Q1_DEFAULT)
  const [q1Max, setQ1Max] = useState(Q1_DEFAULT)
  const [q2Min, setQ2Min] = useState(Q2_DEFAULT)
  const [q2Max, setQ2Max] = useState(Q2_DEFAULT)
  const [rMin, setRMin] = useState(R_DEFAULT)
  const [rMax, setRMax] = useState(R_DEFAULT)

  const resetStageState = useCallback(() => {
    setQ1(Q1_DEFAULT); setQ2(Q2_DEFAULT); setR(R_DEFAULT)
    setQ1Min(Q1_DEFAULT); setQ1Max(Q1_DEFAULT)
    setQ2Min(Q2_DEFAULT); setQ2Max(Q2_DEFAULT)
    setRMin(R_DEFAULT); setRMax(R_DEFAULT)
    setPeekVisible(false)
  }, [])
  useReset(resetStageState)

  // ─── Physics ─────────────────────────────────────────────────────
  const F = coulombForce(q1, q2, r)
  const featureMatch = forceMatchesTolerance(F, setup.targetF)

  // ─── Coverage (stage 1) ─────────────────────────────────────────
  const q1Cov = (q1Max - q1Min) / (Q1_MAX - Q1_MIN)
  const q2Cov = (q2Max - q2Min) / (Q2_MAX - Q2_MIN)
  const rCov = (rMax - rMin) / (R_MAX - R_MIN)
  const stage1Done =
    q1Cov >= COVERAGE_MIN_FRAC &&
    q2Cov >= COVERAGE_MIN_FRAC &&
    rCov >= COVERAGE_MIN_FRAC

  const canSubmit = isStage1 ? stage1Done : featureMatch

  useEffect(() => {
    progress(stageIdx / 3, { stage: stageIdx, canSubmit })
  }, [stageIdx, canSubmit, progress])

  useNext(() => {
    if (stageIdx < 3) {
      setStage(stageIdx + 1)
      resetStageState()
      return
    }
    if (featureMatch) {
      complete({ success: true })
      return
    }
    // Stage 3 fail-with-restart: rotate to next setup, reset sliders.
    failCountRef.current += 1
    setFailTick(failCountRef.current)
    resetStageState()
  })

  // ─── Peek (blind stage only — strategy hint, text only) ──────────
  const PEEK_TIPS = useMemo(
    () => [labels.peek_tip_formula, labels.peek_tip_anchor],
    [labels],
  )
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

  // ─── Layout — charge positions along axis ────────────────────────
  const q2X = Math.min(Q2_MAX_X, Q1_X + r * PX_PER_CM)
  const rMidX = (Q1_X + q2X) / 2

  // ─── Force arrow lengths (visualization = "help" per §4.7) ──────
  // Live arrow — hidden on stage 3.
  const liveArrowLen = arrowLenPx(F)
  // Target arrow — visible on stages 2+3 (target marker = required info).
  const targetArrowLen = arrowLenPx(setup.targetF)

  const showVisualization = !isStage3   // hides live arrow on stage 3

  // ─── HUD text ────────────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`
  const hudTR = isStage1
    ? `q1·${(q1Cov * 100).toFixed(0)}% q2·${(q2Cov * 100).toFixed(0)}% r·${(rCov * 100).toFixed(0)}%`
    : isStage2
      ? `F = ${formatN(F)}`
      : `F* = ${formatN(setup.targetF)}`
  const hudBL = peekVisible
    ? PEEK_TIPS[(peekIdxRef.current - 1) % PEEK_TIPS.length]!
    : isStage1
      ? labels.tip1
      : isStage2
        ? labels.tip2
        : labels.tip3
  // BR reserved for parent chrome — do NOT add a bottom-right overlay.

  const tickBottomY = AXIS_Y + CHARGE_R + 26

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block', userSelect: 'none' }}
      >
        {/* Full-canvas background — NO rx. */}
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        {/* Bench frame */}
        <rect x={32} y={60} width={720} height={358} fill="none" stroke="#12203a" strokeWidth={1} rx={6} />
        <text x={40} y={52} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={11} letterSpacing="0.1em">
          {labels.bench}
        </text>

        {/* Metric ruler (below charges) */}
        <line x1={Q1_X} y1={tickBottomY} x2={q2X} y2={tickBottomY} stroke="#2A3654" strokeWidth={1} />
        <line x1={Q1_X} y1={tickBottomY - 4} x2={Q1_X} y2={tickBottomY + 4} stroke="#2A3654" strokeWidth={1} />
        <line x1={q2X} y1={tickBottomY - 4} x2={q2X} y2={tickBottomY + 4} stroke="#2A3654" strokeWidth={1} />
        <text
          x={rMidX} y={tickBottomY + 18}
          fill="#B9C4D6"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={12} textAnchor="middle"
        >
          r = {formatCm(r)}
        </text>

        {/* Charge q1 (fixed) */}
        <circle cx={Q1_X} cy={AXIS_Y} r={CHARGE_R} fill="#37C9B8" stroke="#0D1524" strokeWidth={1.5} />
        <text
          x={Q1_X} y={AXIS_Y + 4}
          fill="#0D1524"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={12} fontWeight={700} textAnchor="middle"
        >
          +
        </text>
        <text
          x={Q1_X} y={AXIS_Y - CHARGE_R - 8}
          fill="#B9C4D6"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={11} textAnchor="middle"
        >
          {labels.q1_label} = {formatUC(q1)}
        </text>

        {/* Charge q2 (moves with r) */}
        <circle cx={q2X} cy={AXIS_Y} r={CHARGE_R} fill="#37C9B8" stroke="#0D1524" strokeWidth={1.5} />
        <text
          x={q2X} y={AXIS_Y + 4}
          fill="#0D1524"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={12} fontWeight={700} textAnchor="middle"
        >
          +
        </text>
        <text
          x={q2X} y={AXIS_Y - CHARGE_R - 8}
          fill="#B9C4D6"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={11} textAnchor="middle"
        >
          {labels.q2_label} = {formatUC(q2)}
        </text>

        {/* Target arrow (dashed) on stages 2 + 3 — target marker = required info. */}
        {(isStage2 || isStage3) && (() => {
          const startX = q2X + CHARGE_R + 4
          const endX = startX + targetArrowLen
          const arrY = AXIS_Y - 22
          return (
            <g>
              <line
                x1={startX} y1={arrY} x2={endX} y2={arrY}
                stroke="#F97316" strokeWidth={2} strokeDasharray="6 4"
                opacity={0.85}
              />
              {/* arrow head */}
              <polygon
                points={`${endX},${arrY} ${endX - 8},${arrY - 4} ${endX - 8},${arrY + 4}`}
                fill="#F97316" opacity={0.85}
              />
              <text
                x={startX + 4} y={arrY - 8}
                fill="#F9A968"
                fontFamily="'JetBrains Mono', monospace"
                fontSize={11}
              >
                {labels.target_short}: F* = {formatN(setup.targetF)}
              </text>
            </g>
          )
        })()}

        {/* Live force arrow on q2 — hidden on stage 3 (continuous "help"). */}
        {showVisualization && (() => {
          const startX = q2X + CHARGE_R + 4
          const endX = startX + liveArrowLen
          const arrY = AXIS_Y + 4
          return (
            <g>
              <line
                x1={startX} y1={arrY} x2={endX} y2={arrY}
                stroke="#37C9B8" strokeWidth={3}
              />
              <polygon
                points={`${endX},${arrY} ${endX - 10},${arrY - 5} ${endX - 10},${arrY + 5}`}
                fill="#37C9B8"
              />
              <text
                x={startX + 4} y={arrY + 18}
                fill="#37C9B8"
                fontFamily="'JetBrains Mono', monospace"
                fontSize={11}
              >
                F₁₂
              </text>
            </g>
          )
        })()}
      </svg>

      {/* HUD overlays — HTML in `rem`. */}
      <div style={{
        position: 'absolute', top: '3rem', left: '3rem',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '2.3rem', letterSpacing: '0.14em',
        textTransform: 'uppercase', color: '#6C7A93',
        zIndex: 5, pointerEvents: 'none',
      }}>
        {hudTL}
      </div>
      <div style={{
        position: 'absolute', top: '3rem', right: '3rem',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '2.3rem', letterSpacing: '0.08em',
        color: '#B9C4D6',
        zIndex: 5, pointerEvents: 'none',
        textAlign: 'right',
      }}>
        {hudTR}
      </div>
      <div style={{
        position: 'absolute', bottom: '3rem', left: '3rem',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '2.3rem', letterSpacing: '0.06em',
        color: '#6C7A93',
        zIndex: 5, pointerEvents: 'none',
        maxWidth: '55%',
      }}>
        {hudBL}
      </div>
      {/* NO bottom-right overlay — reserved for parent chrome. */}

      {/* ─── Slider column (right side, HTML overlay) ─────────────── */}
      <div style={{
        position: 'absolute',
        top: '6rem',
        right: '3rem',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '1.5rem',
        zIndex: 6,
      }}>
        <SliderVertical
          label={labels.q1_label}
          unit="µC"
          value={q1}
          min={Q1_MIN}
          max={Q1_MAX}
          step={0.1}
          format={(v) => v.toFixed(1)}
          onChange={(v) => {
            setQ1(v)
            setQ1Min((prev) => Math.min(prev, v))
            setQ1Max((prev) => Math.max(prev, v))
          }}
        />
        <SliderVertical
          label={labels.q2_label}
          unit="µC"
          value={q2}
          min={Q2_MIN}
          max={Q2_MAX}
          step={0.1}
          format={(v) => v.toFixed(1)}
          onChange={(v) => {
            setQ2(v)
            setQ2Min((prev) => Math.min(prev, v))
            setQ2Max((prev) => Math.max(prev, v))
          }}
        />
        <SliderVertical
          label={labels.r_label}
          unit="cm"
          value={r}
          min={R_MIN}
          max={R_MAX}
          step={0.5}
          format={(v) => v.toFixed(1)}
          onChange={(v) => {
            setR(v)
            setRMin((prev) => Math.min(prev, v))
            setRMax((prev) => Math.max(prev, v))
          }}
        />
      </div>
    </div>
  )
}

// ─── Slider primitive ────────────────────────────────────────────────
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
      <div style={{ width: '2.5rem', height: '13rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{
            width: '13rem',
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
