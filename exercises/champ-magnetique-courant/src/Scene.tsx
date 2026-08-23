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
import en from '../i18n/en.json'
import fr from '../i18n/fr.json'
import ar from '../i18n/ar.json'
import { getHintFor, getStagesFor } from './stages'
import {
  fieldB_uT,
  fieldMatches,
  formatUT,
  I_DEFAULT,
  I_MAX,
  I_MIN,
  I_STEP,
  R_DEFAULT,
  R_MAX,
  R_MIN,
  R_STEP,
  SETUPS,
} from './physics'

// ─── Scene constants ────────────────────────────────────────────────────
const W = 800
const H = 450

// Cross-section geometry (SVG units). Wire is "into the page" at WIRE_X, WIRE_Y.
const WIRE_X = 260
const WIRE_Y = 225
const PX_PER_CM = 10 // 1 cm of physical space ≈ 10 SVG units

// Field lines at these radii (cm) — sampled logarithmically-ish so the
// falloff is visually obvious without cluttering the inner ring.
const FIELD_LINE_RADII_CM = [1, 1.5, 2, 3, 4, 6, 8, 12, 18]

// Reference field for opacity normalization. Above this the line is fully lit.
const B_REF_UT = 120

// Coverage threshold for stage 1 advance.
const COVERAGE_MIN_FRAC = 0.5

// ─── Label loader (EN-only) ─────────────────────────────────────────────
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

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  // Rotating setup so a stage-3 fail cycles to a different physical scenario
  // (student cannot brute-force by re-submitting the same target).
  const [failCount, setFailCount] = useState(0)
  const setup = useMemo(
    () => SETUPS[(seed + failCount) % SETUPS.length]!,
    [seed, failCount],
  )

  // ─── DOF state ────────────────────────────────────────────────────────
  const [current, setCurrent] = useState(I_DEFAULT)
  const [rProbe, setRProbe] = useState(R_DEFAULT)
  const [peekVisible, setPeekVisible] = useState(false)

  // Stage 1 coverage tracking.
  const [iMinSeen, setIMinSeen] = useState(I_DEFAULT)
  const [iMaxSeen, setIMaxSeen] = useState(I_DEFAULT)
  const [rMinSeen, setRMinSeen] = useState(R_DEFAULT)
  const [rMaxSeen, setRMaxSeen] = useState(R_DEFAULT)

  const resetStageState = useCallback(() => {
    setCurrent(I_DEFAULT)
    setRProbe(R_DEFAULT)
    setIMinSeen(I_DEFAULT); setIMaxSeen(I_DEFAULT)
    setRMinSeen(R_DEFAULT); setRMaxSeen(R_DEFAULT)
    setPeekVisible(false)
  }, [])
  useReset(resetStageState)

  // ─── Coverage (stage 1 advance predicate) ─────────────────────────────
  const iCoverage = (iMaxSeen - iMinSeen) / (I_MAX - I_MIN)
  const rCoverage = (rMaxSeen - rMinSeen) / (R_MAX - R_MIN)
  const stage1Done = iCoverage >= COVERAGE_MIN_FRAC && rCoverage >= COVERAGE_MIN_FRAC

  // ─── Feature extraction ───────────────────────────────────────────────
  const bAtProbe = fieldB_uT(current, rProbe)
  const featureMatch = fieldMatches(bAtProbe, setup.targetB_uT)

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
      // Stage 3 fail: rotate setup and reset. One attempt per setup.
      setFailCount((c) => c + 1)
      resetStageState()
    }
  })

  // ─── Peek (blind stage only — text hint, never the rendering) ─────────
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

  // ─── Derived scene geometry ───────────────────────────────────────────
  const probeX = WIRE_X + rProbe * PX_PER_CM
  const targetX = WIRE_X + setup.r_star_cm * PX_PER_CM

  // Visualization gating — the continuous rendering is HIDDEN on stage 3.
  const showVisualization = !isStage3

  // ─── HUD strings ──────────────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`

  // TR: stage-appropriate readout.
  //   Stage 1: coverage percentages (drives stage-advance affordance).
  //   Stage 2: live |B| at probe (guided tuning is fair game here).
  //   Stage 3: current slider values only — NO live |B|, NO Δ delta.
  const hudTR = isStage1
    ? `I·${(iCoverage * 100).toFixed(0)}% r·${(rCoverage * 100).toFixed(0)}%`
    : isStage2
      ? `|B| = ${formatUT(bAtProbe)}`
      : `I=${current.toFixed(1)}A · r=${rProbe.toFixed(1)}cm`

  const hudBL = peekVisible
    ? PEEK_TIPS[(peekIdxRef.current - 1) % PEEK_TIPS.length]!
    : (isStage1 ? labels.tip1 : isStage2 ? labels.tip2 : labels.tip3)
  // NB: no BR overlay — that quadrant is reserved for parent chrome.

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block', userSelect: 'none' }}
      >
        {/* Full-canvas background — NO rx, NO borderRadius on <svg>. */}
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        {/* Bench frame */}
        <rect x={32} y={60} width={720} height={358}
              fill="none" stroke="#12203a" strokeWidth={1} rx={6} />
        <text x={40} y={52} fill="#6C7A93"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={11} letterSpacing="0.1em">
          {labels.bench}
        </text>

        {/* ─── Field lines (concentric circles around wire) ───────── */}
        {/* Removed on stage 3 — this is the primary "help" per §4.7. */}
        {showVisualization && (
          <g>
            {FIELD_LINE_RADII_CM.map((rCm) => {
              const rPx = rCm * PX_PER_CM
              const bHere = fieldB_uT(current, rCm)
              const opacity = Math.min(0.85, bHere / B_REF_UT)
              if (opacity < 0.03) return null
              return (
                <circle
                  key={`fl-${rCm}`}
                  cx={WIRE_X}
                  cy={WIRE_Y}
                  r={rPx}
                  fill="none"
                  stroke="#37C9B8"
                  strokeWidth={0.8}
                  strokeDasharray="3 4"
                  opacity={opacity}
                />
              )
            })}
            {/* Small arrows on the outermost visible circle to imply the
                direction (right-hand rule, current into page → CCW). */}
            {(() => {
              const rCm = 4
              const rPx = rCm * PX_PER_CM
              const bHere = fieldB_uT(current, rCm)
              const op = Math.min(0.9, bHere / B_REF_UT)
              if (op < 0.05) return null
              // 4 arrowheads at 45°, 135°, 225°, 315°.
              const marks = [45, 135, 225, 315].map((deg) => {
                const rad = (deg * Math.PI) / 180
                const cx = WIRE_X + rPx * Math.cos(rad)
                const cy = WIRE_Y - rPx * Math.sin(rad)
                // Tangent direction (CCW): perpendicular to radial vector.
                const tx = -Math.sin(rad)
                const ty = -Math.cos(rad)
                const tipX = cx + tx * 5
                const tipY = cy + ty * 5
                const backX = cx - tx * 3
                const backY = cy - ty * 3
                // Small triangle arrowhead
                const perpX = -ty
                const perpY = tx
                const p1x = backX + perpX * 2.5
                const p1y = backY + perpY * 2.5
                const p2x = backX - perpX * 2.5
                const p2y = backY - perpY * 2.5
                return (
                  <polygon
                    key={`arr-${deg}`}
                    points={`${tipX},${tipY} ${p1x},${p1y} ${p2x},${p2y}`}
                    fill="#37C9B8"
                    opacity={op}
                  />
                )
              })
              return <g>{marks}</g>
            })()}
          </g>
        )}

        {/* ─── Wire (cross-section, current into page) ────────────── */}
        <circle cx={WIRE_X} cy={WIRE_Y} r={10} fill="#1A2338" stroke="#B9C4D6" strokeWidth={1.4} />
        {/* × mark = current INTO the page (right-hand-rule convention). */}
        <line x1={WIRE_X - 5} y1={WIRE_Y - 5} x2={WIRE_X + 5} y2={WIRE_Y + 5}
              stroke="#B9C4D6" strokeWidth={1.4} />
        <line x1={WIRE_X - 5} y1={WIRE_Y + 5} x2={WIRE_X + 5} y2={WIRE_Y - 5}
              stroke="#B9C4D6" strokeWidth={1.4} />
        <text x={WIRE_X} y={WIRE_Y + 28} fill="#6C7A93"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10} textAnchor="middle">
          {labels.wire}
        </text>
        <text x={WIRE_X} y={WIRE_Y + 42} fill="#B9C4D6"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10} textAnchor="middle">
          I = {current.toFixed(1)} A
        </text>

        {/* ─── Probe point (always visible — student's active measurement) ─ */}
        <line x1={WIRE_X + 12} y1={WIRE_Y} x2={probeX - 6} y2={WIRE_Y}
              stroke="#54617A" strokeWidth={0.8} strokeDasharray="2 3" />
        <circle cx={probeX} cy={WIRE_Y} r={5} fill="#F97316" stroke="#0D1524" strokeWidth={1.4} />
        <text x={probeX} y={WIRE_Y - 12} fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10} textAnchor="middle">
          {labels.probe}
        </text>
        <text x={probeX} y={WIRE_Y + 22} fill="#B9C4D6"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={9} textAnchor="middle">
          r = {rProbe.toFixed(1)} cm
        </text>

        {/* ─── Target marker M (stages 2 + 3) ────────────────────── */}
        {(isStage2 || isStage3) && (
          <g>
            {/* Dashed radial line from wire to target distance */}
            <line
              x1={WIRE_X + 12} y1={WIRE_Y - 60}
              x2={targetX} y2={WIRE_Y - 60}
              stroke="#F97316" strokeWidth={0.8} strokeDasharray="4 4" opacity={0.55}
            />
            {/* M dot */}
            <circle cx={targetX} cy={WIRE_Y - 60} r={5}
                    fill="none" stroke="#F97316" strokeWidth={1.5} />
            <circle cx={targetX} cy={WIRE_Y - 60} r={2} fill="#F97316" />
            {/* M label + target field magnitude + target radius (both required info) */}
            <text x={targetX} y={WIRE_Y - 72} fill="#F9A968"
                  fontFamily="'JetBrains Mono', monospace"
                  fontSize={10} textAnchor="middle">
              M
            </text>
            <text x={targetX + 12} y={WIRE_Y - 58} fill="#F9A968"
                  fontFamily="'JetBrains Mono', monospace"
                  fontSize={9}>
              r* = {setup.r_star_cm} cm
            </text>
            <text x={targetX + 12} y={WIRE_Y - 46} fill="#F9A968"
                  fontFamily="'JetBrains Mono', monospace"
                  fontSize={10}>
              B* = {formatUT(setup.targetB_uT)}
            </text>
          </g>
        )}

        {/* Scale ruler along the axis so students can eyeball distances */}
        <line x1={WIRE_X} y1={WIRE_Y + 90} x2={WIRE_X + 20 * PX_PER_CM} y2={WIRE_Y + 90}
              stroke="#2A3654" strokeWidth={0.8} />
        {[0, 5, 10, 15, 20].map((cm) => (
          <g key={`tick-${cm}`}>
            <line
              x1={WIRE_X + cm * PX_PER_CM} y1={WIRE_Y + 87}
              x2={WIRE_X + cm * PX_PER_CM} y2={WIRE_Y + 93}
              stroke="#54617A" strokeWidth={0.8}
            />
            <text
              x={WIRE_X + cm * PX_PER_CM} y={WIRE_Y + 106}
              fill="#54617A"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={9} textAnchor="middle"
            >
              {cm} cm
            </text>
          </g>
        ))}
      </svg>

      {/* ─── HUD overlays (HTML, sized in rem = 1vh) ──────────────────── */}
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
        color: '#B9C4D6', textAlign: 'right',
        zIndex: 5, pointerEvents: 'none',
      }}>
        {hudTR}
      </div>
      <div style={{
        position: 'absolute', bottom: '3rem', left: '3rem',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '2.3rem', letterSpacing: '0.06em',
        color: peekVisible ? '#F9A968' : '#6C7A93',
        maxWidth: '48%',
        zIndex: 5, pointerEvents: 'none',
      }}>
        {hudBL}
      </div>
      {/* NO bottom-right overlay — reserved for parent-side chrome. */}

      {/* ─── Slider column ──────────────────────────────────────────── */}
      <div style={{
        position: 'absolute',
        top: '6rem',
        right: '4rem',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '1.5rem',
        zIndex: 6,
      }}>
        <SliderVertical
          label="I"
          unit="A"
          value={current}
          min={I_MIN}
          max={I_MAX}
          step={I_STEP}
          format={(v) => v.toFixed(1)}
          onChange={(v) => {
            setCurrent(v)
            setIMinSeen((prev) => Math.min(prev, v))
            setIMaxSeen((prev) => Math.max(prev, v))
          }}
        />
        <SliderVertical
          label="r"
          unit="cm"
          value={rProbe}
          min={R_MIN}
          max={R_MAX}
          step={R_STEP}
          format={(v) => v.toFixed(1)}
          onChange={(v) => {
            setRProbe(v)
            setRMinSeen((prev) => Math.min(prev, v))
            setRMaxSeen((prev) => Math.max(prev, v))
          }}
        />
      </div>
    </div>
  )
}

// ─── Slider primitive (copied from the diffraction reference) ──────────
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
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.9rem', color: accent }}>
        {label} = {format(value)}{unit}
      </div>
    </div>
  )
}
