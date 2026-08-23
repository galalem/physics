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
  computeForceDisplay,
  formatForceDisplay,
  forceMatchesTolerance,
} from './physics'

// ─── Scene constants ────────────────────────────────────────────────
const W = 800
const H = 450

// Bench interior (SVG units)
const AXIS_Y = 240
const CENTER_X = 320 // horizontal midpoint between the two bodies
const SEP_MIN = 90 // separation in px at r = R_MIN
const SEP_MAX = 380 // separation in px at r = R_MAX

// ─── Physics DOF ranges ─────────────────────────────────────────────
// m in ×10²³ kg, r in ×10⁷ m — see physics.ts for the unit derivation.
const M1_MIN = 0.5
const M1_MAX = 10
const M1_DEFAULT = 2

const M2_MIN = 0.5
const M2_MAX = 10
const M2_DEFAULT = 2

const R_MIN = 1
const R_MAX = 10
const R_DEFAULT = 5

// Slider coverage threshold (fraction of full range)
const COVERAGE_MIN_FRAC = 0.5

// ─── Locale routing ─────────────────────────────────────────────────
const dict = { en, fr, ar } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── Visual helpers ─────────────────────────────────────────────────
// Body radius scales gently with mass (cube-root feel).
function bodyRadius(m: number): number {
  const t = (m - M1_MIN) / (M1_MAX - M1_MIN)
  return 12 + Math.cbrt(t) * 24
}

// Body separation in SVG px scales linearly with r.
function bodySeparation(r: number): number {
  const t = (r - R_MIN) / (R_MAX - R_MIN)
  return SEP_MIN + t * (SEP_MAX - SEP_MIN)
}

// Force-arrow length in px. Log compression across the F range so both
// tiny and huge forces read as arrows, not degenerate ticks.
function forceArrowLen(fDisplay: number): number {
  const f = Math.max(fDisplay, 0.02)
  const norm = (Math.log10(f) + 1.5) / 3.5 // 0.02 → 0.05, 700 → 1.05
  const clamped = Math.max(0.08, Math.min(1, norm))
  return 8 + clamped * 72
}

// ─── Component ──────────────────────────────────────────────────────
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

  // Stage 3 rotates through setups on fail. Stage 2 stays on the first.
  const failCountRef = useRef(0)
  const [failTick, setFailTick] = useState(0)
  const setup2 = useMemo(() => SETUPS[seed % SETUPS.length]!, [seed])
  const setup3 = useMemo(
    () => SETUPS[(seed + failCountRef.current) % SETUPS.length]!,
    // failTick is the state twin of failCountRef so the memo re-runs
    // when the ref updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [seed, failTick],
  )
  const activeSetup = isStage3 ? setup3 : setup2

  // ─── DOF state ────────────────────────────────────────────────────
  const [m1, setM1] = useState(M1_DEFAULT)
  const [m2, setM2] = useState(M2_DEFAULT)
  const [r, setR] = useState(R_DEFAULT)
  const [peekVisible, setPeekVisible] = useState(false)
  const [lastFail, setLastFail] = useState<{ f: number; target: number } | null>(null)

  // ─── Stage 1 coverage tracking ────────────────────────────────────
  const [m1Min, setM1Min] = useState(M1_DEFAULT)
  const [m1Max, setM1Max] = useState(M1_DEFAULT)
  const [m2Min, setM2Min] = useState(M2_DEFAULT)
  const [m2Max, setM2Max] = useState(M2_DEFAULT)
  const [rMin, setRMin] = useState(R_DEFAULT)
  const [rMax, setRMax] = useState(R_DEFAULT)

  const resetStageState = useCallback(() => {
    setM1(M1_DEFAULT)
    setM2(M2_DEFAULT)
    setR(R_DEFAULT)
    setM1Min(M1_DEFAULT); setM1Max(M1_DEFAULT)
    setM2Min(M2_DEFAULT); setM2Max(M2_DEFAULT)
    setRMin(R_DEFAULT); setRMax(R_DEFAULT)
    setPeekVisible(false)
  }, [])
  useReset(() => {
    failCountRef.current = 0
    setFailTick((v) => v + 1)
    setLastFail(null)
    resetStageState()
  })

  // Coverage predicate for stage 1 advance
  const m1Cov = (m1Max - m1Min) / (M1_MAX - M1_MIN)
  const m2Cov = (m2Max - m2Min) / (M2_MAX - M2_MIN)
  const rCov = (rMax - rMin) / (R_MAX - R_MIN)
  const stage1Done = m1Cov >= COVERAGE_MIN_FRAC
    && m2Cov >= COVERAGE_MIN_FRAC
    && rCov >= COVERAGE_MIN_FRAC

  // Feature = current force in display units (×10²¹ N)
  const fLive = computeForceDisplay(m1, m2, r)
  const fTarget = activeSetup.targetFDisplay
  const featureMatch = forceMatchesTolerance(fLive, fTarget)

  const canSubmit = isStage1 ? stage1Done : featureMatch

  useEffect(() => {
    progress(stageIdx / 3, { stage: stageIdx, canSubmit })
  }, [stageIdx, canSubmit, progress])

  useNext(() => {
    if (stageIdx === 1) {
      setStage(2)
      resetStageState()
      setLastFail(null)
    } else if (stageIdx === 2) {
      setStage(3)
      resetStageState()
      setLastFail(null)
    } else if (featureMatch) {
      complete({ success: true })
    } else {
      // Stage 3 fail: record discrepancy, rotate to next setup, reset.
      setLastFail({ f: fLive, target: fTarget })
      failCountRef.current += 1
      setFailTick((v) => v + 1)
      resetStageState()
    }
  })

  // ─── Peek — strategy tip only, never the visualization ───────────
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

  // Clear the "last submit" hint after 4 seconds so it does not act as
  // live warmer/colder feedback while the student re-tunes.
  useEffect(() => {
    if (!lastFail) return
    const t = setTimeout(() => setLastFail(null), 4000)
    return () => clearTimeout(t)
  }, [lastFail])

  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  // ─── Geometry ─────────────────────────────────────────────────────
  const rad1 = bodyRadius(m1)
  const rad2 = bodyRadius(m2)
  const sep = bodySeparation(r)
  const body1X = CENTER_X - sep / 2
  const body2X = CENTER_X + sep / 2

  // Force arrow lengths
  const liveLen = forceArrowLen(fLive)
  const targetLen = forceArrowLen(fTarget)

  // Live arrows: draw from each body surface inward.
  const arrow1Live = { x1: body1X + rad1, x2: body1X + rad1 + liveLen }
  const arrow2Live = { x1: body2X - rad2, x2: body2X - rad2 - liveLen }
  // Target arrows (dashed, above the pair) — anchored to same body edges.
  const TARGET_Y = AXIS_Y - Math.max(rad1, rad2) - 26
  const arrow1Tgt = { x1: body1X + rad1, x2: body1X + rad1 + targetLen }
  const arrow2Tgt = { x1: body2X - rad2, x2: body2X - rad2 - targetLen }

  // ─── HUD text ─────────────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`

  let hudTR = ''
  if (isStage1) {
    hudTR = `m1·${(m1Cov * 100).toFixed(0)}% m2·${(m2Cov * 100).toFixed(0)}% r·${(rCov * 100).toFixed(0)}%`
  } else if (isStage2) {
    hudTR = featureMatch
      ? `✓ ${labels.match_ok}`
      : `${labels.force_target} = ${formatForceDisplay(fTarget)} ×10²¹ N`
  } else {
    // Stage 3: only target and current param values — never live F.
    hudTR = `${labels.force_target} = ${formatForceDisplay(fTarget)} ×10²¹ N`
  }

  let hudBL: string
  if (peekVisible) {
    hudBL = PEEK_TIPS[(peekIdxRef.current - 1) % PEEK_TIPS.length]!
  } else if (lastFail && isStage3) {
    hudBL = `${labels.last_fail}: ${labels.force_live} = ${formatForceDisplay(lastFail.f)} · ${labels.force_target} = ${formatForceDisplay(lastFail.target)}`
  } else if (isStage1) {
    hudBL = labels.tip1
  } else if (isStage2) {
    hudBL = labels.tip2
  } else {
    hudBL = labels.tip3
  }
  // BR quadrant reserved for parent-side chrome — no overlay here.

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block', userSelect: 'none' }}
      >
        {/* NO borderRadius on <svg>. NO rx on the bg <rect>. */}
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        {/* Bench frame */}
        <rect x={32} y={60} width={720} height={358}
              fill="none" stroke="#12203a" strokeWidth={1} rx={6} />
        <text x={40} y={52} fill="#6C7A93"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={11} letterSpacing="0.1em">
          {labels.bench_label}
        </text>

        {/* Deterministic star field — static positions, purely decorative. */}
        <g opacity={0.55}>
          {STAR_POSITIONS.map(([sx, sy, sr], i) => (
            <circle key={`st${i}`} cx={sx} cy={sy} r={sr} fill="#2A3654" />
          ))}
        </g>

        {/* Distance baseline (dashed, connecting the two body centres) */}
        <line x1={body1X} y1={AXIS_Y} x2={body2X} y2={AXIS_Y}
              stroke="#2A3654" strokeWidth={1} strokeDasharray="3 4" />

        {/* Distance label between the bodies */}
        <text x={CENTER_X} y={AXIS_Y + Math.max(rad1, rad2) + 30}
              fill="#6C7A93" fontFamily="'JetBrains Mono', monospace"
              fontSize={11} textAnchor="middle" letterSpacing="0.06em">
          r = {r.toFixed(2)} ×10⁷ m
        </text>
        {/* Distance end caps */}
        <line x1={body1X} y1={AXIS_Y + Math.max(rad1, rad2) + 10}
              x2={body1X} y2={AXIS_Y + Math.max(rad1, rad2) + 18}
              stroke="#3A4863" strokeWidth={1} />
        <line x1={body2X} y1={AXIS_Y + Math.max(rad1, rad2) + 10}
              x2={body2X} y2={AXIS_Y + Math.max(rad1, rad2) + 18}
              stroke="#3A4863" strokeWidth={1} />
        <line x1={body1X} y1={AXIS_Y + Math.max(rad1, rad2) + 14}
              x2={body2X} y2={AXIS_Y + Math.max(rad1, rad2) + 14}
              stroke="#3A4863" strokeWidth={1} />

        {/* Body 1 (primary planet) */}
        <circle cx={body1X} cy={AXIS_Y} r={rad1}
                fill="url(#body1Grad)" stroke="#4C6390" strokeWidth={1} />
        <text x={body1X} y={AXIS_Y - rad1 - 8}
              fill="#8EA0C0" fontFamily="'JetBrains Mono', monospace"
              fontSize={11} textAnchor="middle" letterSpacing="0.1em">
          {labels.body1}
        </text>
        <text x={body1X} y={AXIS_Y + rad1 + 14}
              fill="#54617A" fontFamily="'JetBrains Mono', monospace"
              fontSize={9} textAnchor="middle">
          m1 = {m1.toFixed(2)} ×10²³ kg
        </text>

        {/* Body 2 (secondary) */}
        <circle cx={body2X} cy={AXIS_Y} r={rad2}
                fill="url(#body2Grad)" stroke="#B98E5A" strokeWidth={1} />
        <text x={body2X} y={AXIS_Y - rad2 - 8}
              fill="#D8B08A" fontFamily="'JetBrains Mono', monospace"
              fontSize={11} textAnchor="middle" letterSpacing="0.1em">
          {labels.body2}
        </text>
        <text x={body2X} y={AXIS_Y + rad2 + 14}
              fill="#54617A" fontFamily="'JetBrains Mono', monospace"
              fontSize={9} textAnchor="middle">
          m2 = {m2.toFixed(2)} ×10²³ kg
        </text>

        {/* Gradients for the two bodies */}
        <defs>
          <radialGradient id="body1Grad" cx="0.35" cy="0.35" r="0.7">
            <stop offset="0%" stopColor="#5A78B2" />
            <stop offset="100%" stopColor="#1F2C48" />
          </radialGradient>
          <radialGradient id="body2Grad" cx="0.35" cy="0.35" r="0.7">
            <stop offset="0%" stopColor="#D89B5C" />
            <stop offset="100%" stopColor="#4A3320" />
          </radialGradient>
          <marker id="arrowLiveHead" viewBox="0 0 10 10" refX="9" refY="5"
                  markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="#37C9B8" />
          </marker>
          <marker id="arrowTgtHead" viewBox="0 0 10 10" refX="9" refY="5"
                  markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="#F97316" />
          </marker>
        </defs>

        {/* Live force arrows — HIDDEN on stage 3 (this is the primary "help"
            per §4.7 / §5.2). Peek does NOT reveal them either. */}
        {!isStage3 && (
          <g>
            <line x1={arrow1Live.x1} y1={AXIS_Y}
                  x2={arrow1Live.x2} y2={AXIS_Y}
                  stroke="#37C9B8" strokeWidth={2}
                  markerEnd="url(#arrowLiveHead)" />
            <line x1={arrow2Live.x1} y1={AXIS_Y}
                  x2={arrow2Live.x2} y2={AXIS_Y}
                  stroke="#37C9B8" strokeWidth={2}
                  markerEnd="url(#arrowLiveHead)" />
          </g>
        )}

        {/* Target force arrows (dashed) — visible on stages 2 and 3,
            drawn slightly above the bodies so they read as a reference. */}
        {(isStage2 || isStage3) && (
          <g>
            <line x1={arrow1Tgt.x1} y1={TARGET_Y}
                  x2={arrow1Tgt.x2} y2={TARGET_Y}
                  stroke="#F97316" strokeWidth={1.5}
                  strokeDasharray="5 4" opacity={0.85}
                  markerEnd="url(#arrowTgtHead)" />
            <line x1={arrow2Tgt.x1} y1={TARGET_Y}
                  x2={arrow2Tgt.x2} y2={TARGET_Y}
                  stroke="#F97316" strokeWidth={1.5}
                  strokeDasharray="5 4" opacity={0.85}
                  markerEnd="url(#arrowTgtHead)" />
            <text x={CENTER_X} y={TARGET_Y - 8}
                  fill="#F9A968" fontFamily="'JetBrains Mono', monospace"
                  fontSize={10} textAnchor="middle" letterSpacing="0.06em">
              {labels.force_target} = {formatForceDisplay(fTarget)} ×10²¹ N
            </text>
          </g>
        )}

        {/* Live F readout inside the bench — stages 1 & 2 only.
            Stage 3 shows only params + target, never live F (that would
            be the "warmer/colder" §4.7 violation). */}
        {!isStage3 && (
          <text x={CENTER_X} y={AXIS_Y + Math.max(rad1, rad2) + 50}
                fill="#37C9B8" fontFamily="'JetBrains Mono', monospace"
                fontSize={11} textAnchor="middle" letterSpacing="0.06em">
            {labels.force_live} = {formatForceDisplay(fLive)} ×10²¹ N
          </text>
        )}
        {isStage3 && (
          <text x={CENTER_X} y={AXIS_Y + Math.max(rad1, rad2) + 50}
                fill="#54617A" fontFamily="'JetBrains Mono', monospace"
                fontSize={10} textAnchor="middle" letterSpacing="0.06em">
            attempt {failCountRef.current + 1}
          </text>
        )}
      </svg>

      {/* HUD overlays (HTML in rem units) */}
      <div style={{
        position: 'absolute', top: '3rem', left: '3rem',
        fontFamily: "'JetBrains Mono', monospace", fontSize: '2.3rem',
        letterSpacing: '0.14em', textTransform: 'uppercase',
        color: '#6C7A93', zIndex: 5, pointerEvents: 'none',
      }}>
        {hudTL}
      </div>
      <div style={{
        position: 'absolute', top: '3rem', right: '3rem',
        fontFamily: "'JetBrains Mono', monospace", fontSize: '2.3rem',
        letterSpacing: '0.08em',
        color: (isStage1 && stage1Done) || (isStage2 && featureMatch) ? '#37C9B8' : '#B9C4D6',
        textAlign: 'right', zIndex: 5, pointerEvents: 'none',
      }}>
        {hudTR}
      </div>
      <div style={{
        position: 'absolute', bottom: '3rem', left: '3rem',
        fontFamily: "'JetBrains Mono', monospace", fontSize: '2.3rem',
        letterSpacing: '0.06em', color: '#6C7A93',
        zIndex: 5, pointerEvents: 'none', maxWidth: '48%',
      }}>
        {hudBL}
      </div>
      {/* NO bottom-right — reserved for parent chrome. */}

      {/* ─── Slider column (right stack) ─────────────────────────── */}
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
          label="m₁"
          unit="×10²³ kg"
          value={m1}
          min={M1_MIN}
          max={M1_MAX}
          step={0.1}
          format={(v) => v.toFixed(1)}
          onChange={(v) => {
            setM1(v)
            setM1Min((prev) => Math.min(prev, v))
            setM1Max((prev) => Math.max(prev, v))
          }}
        />
        <SliderVertical
          label="m₂"
          unit="×10²³ kg"
          value={m2}
          min={M2_MIN}
          max={M2_MAX}
          step={0.1}
          format={(v) => v.toFixed(1)}
          onChange={(v) => {
            setM2(v)
            setM2Min((prev) => Math.min(prev, v))
            setM2Max((prev) => Math.max(prev, v))
          }}
        />
        <SliderVertical
          label="r"
          unit="×10⁷ m"
          value={r}
          min={R_MIN}
          max={R_MAX}
          step={0.05}
          format={(v) => v.toFixed(2)}
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

// ─── Slider primitive (adapted from diffraction reference) ──────────
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
      <div style={{ width: '2.5rem', height: '15rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.5rem', color: '#54617A' }}>
        {format(min)}
      </div>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.7rem', color: accent, textAlign: 'center' }}>
        {label} = {format(value)}
        <div style={{ fontSize: '1.1rem', color: '#54617A' }}>{unit}</div>
      </div>
    </div>
  )
}

// ─── Decorative star field (deterministic static positions) ────────
// Bounded within the bench frame, avoiding the central body corridor.
const STAR_POSITIONS: Array<[number, number, number]> = [
  [90, 90, 0.9], [130, 130, 0.6], [180, 100, 0.7], [220, 80, 0.5],
  [260, 130, 0.8], [300, 90, 0.55], [340, 110, 0.7], [420, 90, 0.8],
  [470, 130, 0.6], [510, 100, 0.55], [560, 80, 0.9], [610, 120, 0.7],
  [660, 90, 0.55], [700, 130, 0.8], [740, 100, 0.65],
  [90, 380, 0.7], [140, 400, 0.5], [200, 385, 0.9], [270, 400, 0.6],
  [340, 395, 0.55], [420, 395, 0.7], [500, 385, 0.6], [570, 400, 0.55],
  [640, 385, 0.9], [710, 400, 0.7], [70, 200, 0.6], [740, 200, 0.7],
  [70, 300, 0.55], [740, 280, 0.6],
]
