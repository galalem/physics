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
  computeForce,
  featureMatchesTolerance,
  formatForce,
} from './physics'

// ─── Scene constants ────────────────────────────────────────────────────
const W = 800
const H = 450

// Field region (SVG units)
const FIELD_X = 32
const FIELD_Y = 70
const FIELD_W = 528
const FIELD_H = 320
const ROD_CX = FIELD_X + FIELD_W / 2 // 296
const ROD_CY = FIELD_Y + FIELD_H / 2 // 230

// Rod length rendering: L in cm → pixels along rod
const ROD_LEN_MIN_PX = 30
const ROD_LEN_MAX_PX = 150

// Force → ring radius rendering. Cap at F_MAX = 0.5 N.
const F_MAX_N = 0.5
const RING_MIN_PX = 6
const RING_MAX_PX = 90
function forceRingRadius(fN: number): number {
  const clamped = Math.max(0, Math.min(F_MAX_N, fN))
  return RING_MIN_PX + (RING_MAX_PX - RING_MIN_PX) * (clamped / F_MAX_N)
}

// ─── Slider ranges ──────────────────────────────────────────────────────
const I_MIN = 1     // A
const I_MAX = 10    // A
const I_DEFAULT = 3 // A

const L_MIN = 5     // cm
const L_MAX = 25    // cm
const L_DEFAULT = 10 // cm

const B_MIN = 20     // mT
const B_MAX = 200    // mT
const B_DEFAULT = 50 // mT

const ALPHA_MIN = 0    // deg
const ALPHA_MAX = 90   // deg
const ALPHA_DEFAULT = 45 // deg

// Coverage threshold (fraction of full range each slider must sweep)
const COVERAGE_MIN_FRAC = 0.5

// ─── i18n dict — EN only (fr/ar bulk pass later) ────────────────────────
const dict = { en, fr, ar } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
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

  // Stage-3 fail rotation: increments on each blind-stage miss.
  const [failCount, setFailCount] = useState(0)

  // Stage 2 setup is fixed by seed. Stage 3 rotates on fail.
  const stage2Setup = useMemo(
    () => SETUPS[seed % SETUPS.length]!,
    [seed],
  )
  const stage3Setup = useMemo(
    () => SETUPS[(seed + 1 + failCount) % SETUPS.length]!,
    [seed, failCount],
  )

  // ─── DOF state ─────────────────────────────────────────────────────
  const [i, setI] = useState(I_DEFAULT)
  const [lCm, setLCm] = useState(L_DEFAULT)
  const [bMt, setBMt] = useState(B_DEFAULT)
  const [alphaDeg, setAlphaDeg] = useState(ALPHA_DEFAULT)
  const [peekVisible, setPeekVisible] = useState(false)

  // Stage 1 coverage tracking
  const [iMin, setIMin] = useState(I_DEFAULT)
  const [iMax, setIMax] = useState(I_DEFAULT)
  const [lMinS, setLMinS] = useState(L_DEFAULT)
  const [lMaxS, setLMaxS] = useState(L_DEFAULT)
  const [bMinS, setBMinS] = useState(B_DEFAULT)
  const [bMaxS, setBMaxS] = useState(B_DEFAULT)
  const [aMinS, setAMinS] = useState(ALPHA_DEFAULT)
  const [aMaxS, setAMaxS] = useState(ALPHA_DEFAULT)

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  const resetStageState = useCallback(() => {
    setI(I_DEFAULT)
    setLCm(L_DEFAULT)
    setBMt(B_DEFAULT)
    setAlphaDeg(ALPHA_DEFAULT)
    setIMin(I_DEFAULT); setIMax(I_DEFAULT)
    setLMinS(L_DEFAULT); setLMaxS(L_DEFAULT)
    setBMinS(B_DEFAULT); setBMaxS(B_DEFAULT)
    setAMinS(ALPHA_DEFAULT); setAMaxS(ALPHA_DEFAULT)
    setPeekVisible(false)
  }, [])

  useReset(() => {
    resetStageState()
    setFailCount(0)
  })

  // ─── Derived physics ────────────────────────────────────────────────
  const lM = lCm / 100
  const bT = bMt / 1000
  const alphaRad = (alphaDeg * Math.PI) / 180
  const currentForce = computeForce(i, lM, bT, alphaRad)

  // ─── Coverage (stage 1 advance predicate) ───────────────────────────
  const covI = (iMax - iMin) / (I_MAX - I_MIN)
  const covL = (lMaxS - lMinS) / (L_MAX - L_MIN)
  const covB = (bMaxS - bMinS) / (B_MAX - B_MIN)
  const covA = (aMaxS - aMinS) / (ALPHA_MAX - ALPHA_MIN)
  const stage1Done =
    covI >= COVERAGE_MIN_FRAC &&
    covL >= COVERAGE_MIN_FRAC &&
    covB >= COVERAGE_MIN_FRAC &&
    covA >= COVERAGE_MIN_FRAC

  // ─── Feature match (stages 2 + 3) ───────────────────────────────────
  const stage2Match = featureMatchesTolerance(currentForce, stage2Setup.fStar)
  const stage3Match = featureMatchesTolerance(currentForce, stage3Setup.fStar)

  const canSubmit = isStage1 ? stage1Done : isStage2 ? stage2Match : true
  // Stage 3 can always submit — the blind mechanic is that a wrong
  // submit rotates to the next setup rather than blocking submission.

  useEffect(() => {
    progress(stageIdx / 3, { stage: stageIdx, canSubmit })
  }, [stageIdx, canSubmit, progress])

  useNext(() => {
    if (stageIdx < 3) {
      setStage(stageIdx + 1)
      resetStageState()
    } else if (stage3Match) {
      complete({ success: true })
    } else {
      // Fail-with-restart: rotate to next setup, reset slider state.
      setFailCount((c) => c + 1)
      resetStageState()
    }
  })

  // ─── Peek (blind stage only — strategy text, never the rendering) ───
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

  // ─── Visualization gating (per §4.7) ────────────────────────────────
  // Field arrows + live/target force rings are the primary "help".
  // Removed on stage 3 (even during peek).
  const showFieldViz = !isStage3

  // ─── Geometry: rod half-length in px, rod endpoints at angle α ─────
  const rodHalfPx =
    (ROD_LEN_MIN_PX +
      ((lCm - L_MIN) / (L_MAX - L_MIN)) * (ROD_LEN_MAX_PX - ROD_LEN_MIN_PX)) /
    2
  // α is measured from horizontal B direction; rod rotates in-plane.
  const rx1 = ROD_CX - rodHalfPx * Math.cos(alphaRad)
  const ry1 = ROD_CY + rodHalfPx * Math.sin(alphaRad)
  const rx2 = ROD_CX + rodHalfPx * Math.cos(alphaRad)
  const ry2 = ROD_CY - rodHalfPx * Math.sin(alphaRad)

  // Current arrow: small chevron near rod midpoint pointing along rod
  const currDirX = Math.cos(alphaRad)
  const currDirY = -Math.sin(alphaRad)
  const currTipX = ROD_CX + 22 * currDirX
  const currTipY = ROD_CY + 22 * currDirY

  const liveRingR = forceRingRadius(currentForce)
  const stage2TargetR = forceRingRadius(stage2Setup.fStar)
  // stage3TargetR unused visually (blind stage) — value shown only as text.

  // ─── Field arrows (B) ───────────────────────────────────────────────
  // Draw 4 rows × 6 arrows across field region, opacity ∝ B.
  const bOpacity = 0.15 + 0.55 * ((bMt - B_MIN) / (B_MAX - B_MIN))
  const bArrows = useMemo(() => {
    if (!showFieldViz) return null
    const cols = 6
    const rows = 4
    const nodes: React.ReactNode[] = []
    const gapX = FIELD_W / (cols + 1)
    const gapY = FIELD_H / (rows + 1)
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cx = FIELD_X + gapX * (c + 1)
        const cy = FIELD_Y + gapY * (r + 1)
        // Skip arrows too close to the rod midpoint (visual clarity)
        const dx = cx - ROD_CX
        const dy = cy - ROD_CY
        if (dx * dx + dy * dy < 60 * 60) continue
        nodes.push(
          <g key={`b${r}-${c}`} opacity={bOpacity}>
            <line
              x1={cx - 12}
              y1={cy}
              x2={cx + 10}
              y2={cy}
              stroke="#5A6EA9"
              strokeWidth={1.2}
            />
            <polygon
              points={`${cx + 14},${cy} ${cx + 8},${cy - 3} ${cx + 8},${cy + 3}`}
              fill="#5A6EA9"
            />
          </g>,
        )
      }
    }
    return nodes
  }, [showFieldViz, bOpacity])

  // ─── HUD text ────────────────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`

  const hudTR = isStage1
    ? `I·${(covI * 100).toFixed(0)}% L·${(covL * 100).toFixed(0)}% B·${(covB * 100).toFixed(0)}% α·${(covA * 100).toFixed(0)}%`
    : isStage2
      ? stage2Match
        ? `✓ ${labels.match_ok}`
        : `|F| = ${formatForce(currentForce)}`
      : `${labels.target_prefix} ${formatForce(stage3Setup.fStar)}`

  const hudBL = peekVisible
    ? PEEK_TIPS[(peekIdxRef.current - 1) % PEEK_TIPS.length]!
    : isStage1
      ? labels.tip1
      : isStage2
        ? labels.tip2
        : labels.tip3
  // BR reserved — do NOT render anything at bottom-right.

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block', userSelect: 'none' }}
      >
        {/* Background — NO rx, NO borderRadius on the SVG or this rect */}
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        {/* Field region frame */}
        <rect
          x={FIELD_X}
          y={FIELD_Y}
          width={FIELD_W}
          height={FIELD_H}
          fill="none"
          stroke="#12203a"
          strokeWidth={1}
          rx={6}
        />
        <text
          x={FIELD_X + 8}
          y={FIELD_Y - 8}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={11}
          letterSpacing="0.1em"
        >
          {labels.field_label}
        </text>

        {/* Field arrows (B) — hidden on stage 3 */}
        {bArrows}

        {/* B legend arrow — always visible, top-right of field */}
        {showFieldViz && (
          <g>
            <line
              x1={FIELD_X + FIELD_W - 96}
              y1={FIELD_Y + 22}
              x2={FIELD_X + FIELD_W - 66}
              y2={FIELD_Y + 22}
              stroke="#8B9DD8"
              strokeWidth={1.8}
            />
            <polygon
              points={`${FIELD_X + FIELD_W - 60},${FIELD_Y + 22} ${FIELD_X + FIELD_W - 68},${FIELD_Y + 18} ${FIELD_X + FIELD_W - 68},${FIELD_Y + 26}`}
              fill="#8B9DD8"
            />
            <text
              x={FIELD_X + FIELD_W - 100}
              y={FIELD_Y + 26}
              fill="#8B9DD8"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={12}
              textAnchor="end"
            >
              {labels.b_arrow_label} = {bMt.toFixed(0)}mT
            </text>
          </g>
        )}

        {/* Target ring — stage 2 only, dashed orange */}
        {isStage2 && (
          <g>
            <circle
              cx={ROD_CX}
              cy={ROD_CY}
              r={stage2TargetR}
              fill="none"
              stroke="#F97316"
              strokeWidth={2}
              strokeDasharray="6 4"
              opacity={0.85}
            />
            <text
              x={ROD_CX + stage2TargetR + 8}
              y={ROD_CY - stage2TargetR}
              fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={11}
            >
              {labels.target_prefix} {formatForce(stage2Setup.fStar)}
            </text>
          </g>
        )}

        {/* Live force ring — stage 2 only (hidden on stage 3) */}
        {isStage2 && (
          <circle
            cx={ROD_CX}
            cy={ROD_CY}
            r={liveRingR}
            fill="rgba(55,201,184,0.10)"
            stroke="#37C9B8"
            strokeWidth={2}
          />
        )}

        {/* Stage 1: live force ring only (no target) — this IS help but
            stage 1 is exploration, so showing force response is the point. */}
        {isStage1 && (
          <circle
            cx={ROD_CX}
            cy={ROD_CY}
            r={liveRingR}
            fill="rgba(55,201,184,0.10)"
            stroke="#37C9B8"
            strokeWidth={2}
          />
        )}

        {/* Rod — always visible (rod length + angle are REQUIRED info) */}
        <line
          x1={rx1}
          y1={ry1}
          x2={rx2}
          y2={ry2}
          stroke="#C9D3E5"
          strokeWidth={5}
          strokeLinecap="round"
        />
        {/* Current-direction chevron */}
        <polygon
          points={`${currTipX},${currTipY} ${currTipX - 8 * currDirX + 4 * currDirY},${currTipY - 8 * currDirY - 4 * currDirX} ${currTipX - 8 * currDirX - 4 * currDirY},${currTipY - 8 * currDirY + 4 * currDirX}`}
          fill="#37C9B8"
        />
        {/* Rod label */}
        <text
          x={rx2 + 8 * currDirX}
          y={ry2 + 8 * currDirY - 6}
          fill="#8FA0C0"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={11}
        >
          I = {i.toFixed(1)}A
        </text>

        {/* Out-of-page force indicator ⊙ (drawn on top of rings) */}
        {!isStage3 && (
          <g>
            <circle
              cx={ROD_CX}
              cy={ROD_CY}
              r={4}
              fill="none"
              stroke="#37C9B8"
              strokeWidth={1.4}
            />
            <circle cx={ROD_CX} cy={ROD_CY} r={1.6} fill="#37C9B8" />
          </g>
        )}

        {/* Stage 3: blind target label — big prominent readout of F* */}
        {isStage3 && (
          <g>
            <rect
              x={ROD_CX - 90}
              y={ROD_CY - 24}
              width={180}
              height={48}
              fill="none"
              stroke="#F97316"
              strokeWidth={1.5}
              strokeDasharray="6 4"
              rx={4}
            />
            <text
              x={ROD_CX}
              y={ROD_CY - 6}
              fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={11}
              letterSpacing="0.1em"
              textAnchor="middle"
            >
              {labels.target_short}
            </text>
            <text
              x={ROD_CX}
              y={ROD_CY + 14}
              fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={16}
              textAnchor="middle"
            >
              {labels.target_prefix} {formatForce(stage3Setup.fStar)}
            </text>
          </g>
        )}

        {/* α arc — small arc indicating current angle, near rod pivot */}
        {(() => {
          const arcR = 20
          // Arc from horizontal (B direction) to rod direction, above axis.
          const arcEndX = ROD_CX + arcR * Math.cos(alphaRad)
          const arcEndY = ROD_CY - arcR * Math.sin(alphaRad)
          const largeArc = 0
          return (
            <g opacity={0.7}>
              <line
                x1={ROD_CX}
                y1={ROD_CY}
                x2={ROD_CX + arcR + 6}
                y2={ROD_CY}
                stroke="#3A4863"
                strokeWidth={1}
                strokeDasharray="2 3"
              />
              <path
                d={`M ${ROD_CX + arcR} ${ROD_CY} A ${arcR} ${arcR} 0 ${largeArc} 0 ${arcEndX} ${arcEndY}`}
                fill="none"
                stroke="#6C7A93"
                strokeWidth={1.2}
              />
              <text
                x={ROD_CX + arcR + 4}
                y={ROD_CY - 4}
                fill="#8FA0C0"
                fontFamily="'JetBrains Mono', monospace"
                fontSize={10}
              >
                α = {alphaDeg.toFixed(0)}°
              </text>
            </g>
          )
        })()}
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
        {hudTL}
      </div>
      <div
        style={{
          position: 'absolute',
          top: '3rem',
          right: '3rem',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: isStage1 ? '1.7rem' : '2.3rem',
          letterSpacing: isStage1 ? '0.04em' : '0.08em',
          color: stage2Match ? '#37C9B8' : '#B9C4D6',
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
          fontSize: '2rem',
          letterSpacing: '0.05em',
          color: peekVisible ? '#F9A968' : '#6C7A93',
          zIndex: 5,
          pointerEvents: 'none',
          maxWidth: '55%',
          lineHeight: 1.3,
        }}
      >
        {hudBL}
      </div>
      {/* NO bottom-right overlay — reserved for parent chrome */}

      {/* ─── Slider column (right side, HTML overlay) ─────────────── */}
      <div
        style={{
          position: 'absolute',
          top: '9rem',
          right: '2.5rem',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '1rem',
          zIndex: 6,
        }}
      >
        <SliderVertical
          label="I"
          unit="A"
          value={i}
          min={I_MIN}
          max={I_MAX}
          step={0.1}
          format={(v) => v.toFixed(1)}
          onChange={(v) => {
            setI(v)
            setIMin((prev) => Math.min(prev, v))
            setIMax((prev) => Math.max(prev, v))
          }}
        />
        <SliderVertical
          label="ℓ"
          unit="cm"
          value={lCm}
          min={L_MIN}
          max={L_MAX}
          step={0.5}
          format={(v) => v.toFixed(1)}
          onChange={(v) => {
            setLCm(v)
            setLMinS((prev) => Math.min(prev, v))
            setLMaxS((prev) => Math.max(prev, v))
          }}
        />
        <SliderVertical
          label="B"
          unit="mT"
          value={bMt}
          min={B_MIN}
          max={B_MAX}
          step={1}
          format={(v) => v.toFixed(0)}
          onChange={(v) => {
            setBMt(v)
            setBMinS((prev) => Math.min(prev, v))
            setBMaxS((prev) => Math.max(prev, v))
          }}
        />
        <SliderVertical
          label="α"
          unit="°"
          value={alphaDeg}
          min={ALPHA_MIN}
          max={ALPHA_MAX}
          step={1}
          format={(v) => v.toFixed(0)}
          onChange={(v) => {
            setAlphaDeg(v)
            setAMinS((prev) => Math.min(prev, v))
            setAMaxS((prev) => Math.max(prev, v))
          }}
        />
      </div>
    </div>
  )
}

// ─── Slider primitive (adapted from diffraction reference) ─────────────
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
        gap: '0.2rem',
      }}
    >
      <div
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '1.2rem',
          color: '#54617A',
        }}
      >
        {format(max)}
      </div>
      <div
        style={{
          width: '2.5rem',
          height: '12rem',
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
            width: '12rem',
            height: '2rem',
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
          fontSize: '1.2rem',
          color: '#54617A',
        }}
      >
        {format(min)}
      </div>
      <div
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '1.7rem',
          color: accent,
        }}
      >
        {label} = {format(value)}{unit}
      </div>
    </div>
  )
}
