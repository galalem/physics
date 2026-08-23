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
  COVERAGE_MIN_FRAC,
  fieldAtKvM,
  featureMatchesTolerance,
  Q_DEFAULT,
  Q_MAX,
  Q_MIN,
  Q_STEP,
  R_DEFAULT,
  R_MAX,
  R_MIN,
  R_STEP,
  SETUPS,
  targetEKvM,
} from './physics'

// ─── Scene constants ────────────────────────────────────────────────────
const W = 800
const H = 450

// Bench geometry
const BENCH_X = 32
const BENCH_Y = 60
const BENCH_W = 720
const BENCH_H = 358
const BENCH_RIGHT = BENCH_X + BENCH_W // 752

// Source charge position (SVG units)
const SRC_X = 290
const SRC_Y = 225

// Pixel-per-cm scale for the physical layout on screen.
// R_MAX = 15 cm → 225 px offset; probe at x=515, well inside the bench.
const PX_PER_CM = 15

// Grid sampling for field arrows (Q-driven, position-driven)
const GRID_MIN_X = 60
const GRID_MAX_X = 540
const GRID_MIN_Y = 80
const GRID_MAX_Y = 370
const GRID_STEP = 55 // px between arrows
const ARROW_LEN = 14 // fixed arrow length; opacity carries magnitude
const NEAR_SRC_PX = 24 // skip grid points too close to source

// Reference field for opacity mapping — arbitrary scale used only for
// visualization brightness. Tuned so ~10 nC at ~5 cm reads as mid-bright.
const E_VIS_REF = 30 // kV/m

// ─── Label loader ──────────────────────────────────────────────────────
const dict = { en, fr, ar } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── Formatters ────────────────────────────────────────────────────────
function fmtE(kv: number): string {
  if (!isFinite(kv)) return '∞'
  if (kv >= 100) return `${kv.toFixed(0)}`
  if (kv >= 10) return `${kv.toFixed(1)}`
  return `${kv.toFixed(2)}`
}
function fmtR(cm: number): string { return cm.toFixed(2) }
function fmtQ(nc: number): string { return nc.toFixed(1) }

// ─── Component ─────────────────────────────────────────────────────────
export default function Scene() {
  const { locale, seed } = useInit()
  const stages = useMemo(() => getStagesFor(locale), [locale])
  useDeclareStages(stages)
  const labels = useMemo(() => svgLabels(locale), [locale])

  const stageIdx = useCurrentStage()
  const setStage = useSetStage()
  const complete = useComplete()
  const progress = useProgress()

  // Seed-indexed setup selection (hand-authored). failCount rotates on
  // stage-3 fail so the student cannot brute-force the same setup twice.
  const failCountRef = useRef(0)
  const [failCount, setFailCount] = useState(0)
  const setup = useMemo(
    () => SETUPS[(seed + failCount) % SETUPS.length]!,
    [seed, failCount],
  )
  const eStar = useMemo(() => targetEKvM(setup), [setup])

  // ─── DOF state ────────────────────────────────────────────────────
  const [q, setQ] = useState(Q_DEFAULT)
  const [r, setR] = useState(R_DEFAULT)
  const [peekVisible, setPeekVisible] = useState(false)

  // Stage-1 coverage bits
  const [qMin, setQMin] = useState(Q_DEFAULT)
  const [qMax, setQMax] = useState(Q_DEFAULT)
  const [rMin, setRMin] = useState(R_DEFAULT)
  const [rMax, setRMax] = useState(R_DEFAULT)

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  const resetStageState = useCallback(() => {
    setQ(Q_DEFAULT)
    setR(R_DEFAULT)
    setQMin(Q_DEFAULT); setQMax(Q_DEFAULT)
    setRMin(R_DEFAULT); setRMax(R_DEFAULT)
    setPeekVisible(false)
  }, [])
  useReset(() => {
    failCountRef.current = 0
    setFailCount(0)
    resetStageState()
  })

  // ─── Coverage (stage-1 advance predicate) ─────────────────────────
  const qCov = (qMax - qMin) / (Q_MAX - Q_MIN)
  const rCov = (rMax - rMin) / (R_MAX - R_MIN)
  const stage1Done = qCov >= COVERAGE_MIN_FRAC && rCov >= COVERAGE_MIN_FRAC

  // ─── Feature-match check ──────────────────────────────────────────
  // Computed for stage-2 canSubmit and stage-3 submit-time evaluation.
  // On stage 3, this value is NOT reflected visually before submit
  // (no live warmer/colder), only used inside useNext.
  const featureMatch = featureMatchesTolerance(q, r, setup)
  const eNow = fieldAtKvM(q, r)

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
    } else {
      // Fail-with-restart: rotate to next setup, reset all DOFs. Single
      // submit per setup — enforces paper math over brute tuning.
      failCountRef.current += 1
      setFailCount(failCountRef.current)
      resetStageState()
    }
  })

  // ─── Peek — strategy hint, text only ──────────────────────────────
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

  // ─── Field arrow grid (live visualization) ────────────────────────
  // Depends on Q only (positions are fixed grid). Hidden on stage 3
  // regardless of peek — the visualization IS the primary "help".
  const showVisualization = !isStage3
  const arrowNodes = useMemo(() => {
    if (!showVisualization) return null
    const nodes: React.ReactNode[] = []
    for (let x = GRID_MIN_X; x <= GRID_MAX_X; x += GRID_STEP) {
      for (let y = GRID_MIN_Y; y <= GRID_MAX_Y; y += GRID_STEP) {
        const dx = x - SRC_X
        const dy = y - SRC_Y
        const dPx = Math.hypot(dx, dy)
        if (dPx < NEAR_SRC_PX) continue
        const rCm = dPx / PX_PER_CM
        const eHere = fieldAtKvM(q, rCm)
        // Perceptual opacity via log scale
        const opacity = Math.min(1, Math.max(0.06, 0.35 * Math.log10(1 + eHere / E_VIS_REF)))
        const ux = dx / dPx
        const uy = dy / dPx
        const x1 = x - (ux * ARROW_LEN) / 2
        const y1 = y - (uy * ARROW_LEN) / 2
        const x2 = x + (ux * ARROW_LEN) / 2
        const y2 = y + (uy * ARROW_LEN) / 2
        // Arrowhead
        const hx = x2
        const hy = y2
        const wingLen = 4
        const nx = -uy
        const ny = ux
        const hx1 = hx - ux * wingLen + nx * (wingLen * 0.6)
        const hy1 = hy - uy * wingLen + ny * (wingLen * 0.6)
        const hx2 = hx - ux * wingLen - nx * (wingLen * 0.6)
        const hy2 = hy - uy * wingLen - ny * (wingLen * 0.6)
        nodes.push(
          <g key={`a${x}-${y}`} opacity={opacity}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#37C9B8" strokeWidth={1.2} strokeLinecap="round" />
            <path d={`M${hx} ${hy} L${hx1} ${hy1} L${hx2} ${hy2} Z`} fill="#37C9B8" />
          </g>,
        )
      }
    }
    return nodes
  }, [showVisualization, q])

  // ─── Probe marker (moves with r slider, along +x from source) ─────
  const probeX = SRC_X + r * PX_PER_CM
  const probeY = SRC_Y

  // Target marker at r* along +x from source; dashed circle at r*
  const targetX = SRC_X + setup.rStar * PX_PER_CM
  const targetY = SRC_Y
  const targetRadiusPx = setup.rStar * PX_PER_CM

  // Local field vector at probe (for stage 1+2 arrow, hidden on stage 3)
  const probeArrowLen = showVisualization
    ? Math.min(60, 12 + Math.log10(1 + eNow / E_VIS_REF) * 40)
    : 0

  // ─── HUD text ─────────────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`

  const hudTR = isStage1
    ? `Q·${(qCov * 100).toFixed(0)}% r·${(rCov * 100).toFixed(0)}%`
    : isStage2
      ? `r = ${fmtR(r)}${labels.r_units}  |E| = ${fmtE(eNow)} ${labels.e_units}`
      // Stage 3 — slider values only; no live |E|, no live delta.
      : `Q = ${fmtQ(q)}${labels.q_units}  r = ${fmtR(r)}${labels.r_units}`

  const hudBL = peekVisible
    ? PEEK_TIPS[(peekIdxRef.current - 1) % PEEK_TIPS.length]!
    : (isStage1 ? labels.tip1 : isStage2 ? labels.tip2 : labels.tip3)

  // No BR overlay — reserved for parent-side chrome.

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
        <rect
          x={BENCH_X}
          y={BENCH_Y}
          width={BENCH_W}
          height={BENCH_H}
          fill="none"
          stroke="#12203a"
          strokeWidth={1}
          rx={6}
        />
        <text
          x={BENCH_X + 8}
          y={BENCH_Y - 8}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={11}
          letterSpacing="0.1em"
        >
          {labels.scene_label}
        </text>

        {/* Scale ruler along +x from source (soft dashed baseline) */}
        <line
          x1={SRC_X}
          y1={SRC_Y}
          x2={SRC_X + R_MAX * PX_PER_CM + 5}
          y2={SRC_Y}
          stroke="#1E2B48"
          strokeWidth={1}
          strokeDasharray="2 4"
        />
        {[5, 10, 15].map((cm) => (
          <g key={`tick${cm}`}>
            <line
              x1={SRC_X + cm * PX_PER_CM}
              y1={SRC_Y - 4}
              x2={SRC_X + cm * PX_PER_CM}
              y2={SRC_Y + 4}
              stroke="#2A3654"
              strokeWidth={1}
            />
            <text
              x={SRC_X + cm * PX_PER_CM}
              y={SRC_Y + 16}
              fill="#54617A"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={9}
              textAnchor="middle"
            >
              {cm}cm
            </text>
          </g>
        ))}

        {/* Field arrows (stages 1+2 only) */}
        {arrowNodes}

        {/* Target marker (stages 2+3): dashed radius circle + labeled M* */}
        {(isStage2 || isStage3) && (
          <g>
            <circle
              cx={SRC_X}
              cy={SRC_Y}
              r={targetRadiusPx}
              fill="none"
              stroke="#F97316"
              strokeWidth={1}
              strokeDasharray="5 4"
              opacity={0.85}
            />
            <circle cx={targetX} cy={targetY} r={6} fill="none" stroke="#F97316" strokeWidth={1.8} />
            <circle cx={targetX} cy={targetY} r={2.5} fill="#F97316" />
            <text
              x={targetX + 12}
              y={targetY - 12}
              fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={11}
              letterSpacing="0.06em"
            >
              {labels.target_label}
            </text>
            <text
              x={targetX + 12}
              y={targetY + 4}
              fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
            >
              r* = {setup.rStar.toFixed(0)}{labels.r_units}
            </text>
            <text
              x={targetX + 12}
              y={targetY + 18}
              fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
            >
              |E*| = {fmtE(eStar)} {labels.e_units}
            </text>
          </g>
        )}

        {/* Probe marker (all stages) */}
        {probeX >= BENCH_X && probeX <= BENCH_RIGHT && (
          <g>
            <line
              x1={SRC_X}
              y1={SRC_Y}
              x2={probeX}
              y2={probeY}
              stroke="#37C9B8"
              strokeWidth={1}
              opacity={0.35}
              strokeDasharray="3 3"
            />
            <circle cx={probeX} cy={probeY} r={5} fill="#0D1524" stroke="#37C9B8" strokeWidth={1.8} />
            <text
              x={probeX}
              y={probeY - 12}
              fill="#37C9B8"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={11}
              textAnchor="middle"
              letterSpacing="0.06em"
            >
              {labels.probe_label}
            </text>
            <text
              x={probeX}
              y={probeY + 22}
              fill="#8FE4D8"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={9}
              textAnchor="middle"
            >
              r = {fmtR(r)}{labels.r_units}
            </text>
          </g>
        )}

        {/* Local field arrow at probe (stages 1+2 only) */}
        {showVisualization && probeX >= BENCH_X && probeX <= BENCH_RIGHT && (
          <g>
            <line
              x1={probeX + 8}
              y1={probeY}
              x2={probeX + 8 + probeArrowLen}
              y2={probeY}
              stroke="#37C9B8"
              strokeWidth={2}
              strokeLinecap="round"
            />
            <path
              d={`M${probeX + 8 + probeArrowLen} ${probeY} L${probeX + 8 + probeArrowLen - 6} ${probeY - 4} L${probeX + 8 + probeArrowLen - 6} ${probeY + 4} Z`}
              fill="#37C9B8"
            />
            <text
              x={probeX + 8}
              y={probeY - 8}
              fill="#8FE4D8"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={9}
            >
              |E| = {fmtE(eNow)} {labels.e_units}
            </text>
          </g>
        )}

        {/* Source charge — always visible */}
        <g>
          <circle cx={SRC_X} cy={SRC_Y} r={12} fill="#F9C74F" opacity={0.15} />
          <circle cx={SRC_X} cy={SRC_Y} r={7} fill="#F9C74F" stroke="#F9E4A0" strokeWidth={1.2} />
          <text
            x={SRC_X}
            y={SRC_Y + 3}
            fill="#0D1524"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={9}
            fontWeight={700}
            textAnchor="middle"
          >
            +
          </text>
          <text
            x={SRC_X}
            y={SRC_Y - 14}
            fill="#F9C74F"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={11}
            textAnchor="middle"
            letterSpacing="0.06em"
          >
            {labels.charge_label}
          </text>
          <text
            x={SRC_X}
            y={SRC_Y + 26}
            fill="#B9C4D6"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={10}
            textAnchor="middle"
          >
            q = {fmtQ(q)}{labels.q_units}
          </text>
        </g>
      </svg>

      {/* HUD overlays — HTML in rem */}
      <div style={{
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
      }}>
        {hudTL}
      </div>
      <div style={{
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
      }}>
        {hudTR}
      </div>
      <div style={{
        position: 'absolute',
        bottom: '3rem',
        left: '3rem',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '2.3rem',
        letterSpacing: '0.06em',
        color: peekVisible ? '#F9A968' : '#6C7A93',
        zIndex: 5,
        pointerEvents: 'none',
        maxWidth: '52%',
      }}>
        {hudBL}
      </div>
      {/* NO bottom-right overlay — reserved for parent chrome. */}

      {/* Slider column (right stack) */}
      <div style={{
        position: 'absolute',
        top: '9rem',
        right: '3rem',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '2rem',
        zIndex: 6,
      }}>
        <SliderVertical
          label="|q|"
          unit=" nC"
          value={q}
          min={Q_MIN}
          max={Q_MAX}
          step={Q_STEP}
          format={(v) => v.toFixed(1)}
          onChange={(v) => {
            setQ(v)
            if (isStage1) {
              setQMin((prev) => Math.min(prev, v))
              setQMax((prev) => Math.max(prev, v))
            }
          }}
        />
        <SliderVertical
          label="r"
          unit=" cm"
          value={r}
          min={R_MIN}
          max={R_MAX}
          step={R_STEP}
          format={(v) => v.toFixed(2)}
          onChange={(v) => {
            setR(v)
            if (isStage1) {
              setRMin((prev) => Math.min(prev, v))
              setRMax((prev) => Math.max(prev, v))
            }
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
