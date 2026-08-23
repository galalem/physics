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
  computeFeature,
  featureMatches,
  fieldColor,
  formatG,
  formatM,
  gravField,
  M_DEFAULT,
  M_MAX,
  M_MIN,
  M_STEP,
  planetRadiusPx,
  R_DEFAULT,
  R_MAX,
  R_MIN,
  R_STEP,
  SETUPS,
} from './physics'

// ─── Scene constants ────────────────────────────────────────────────
const W = 800
const H = 450

// Field/scene region (SVG units). Right ≥ 580 kept clear for HTML slider column.
const FIELD_LEFT = 28
const FIELD_RIGHT = 560
const FIELD_TOP = 36
const FIELD_BOT = 414

const PLANET_CX = 120
const PLANET_CY = 225

// 1 Mm → 20 SVG px. Probe at r=20 Mm sits at x=520 (inside FIELD_RIGHT).
const PX_PER_MM = 20

// Heatmap grid — coarse enough to render cheaply, fine enough to look continuous.
const GRID_COLS = 44
const GRID_ROWS = 30
const CELL_W = (FIELD_RIGHT - FIELD_LEFT) / GRID_COLS
const CELL_H = (FIELD_BOT - FIELD_TOP) / GRID_ROWS

const dict = { en, fr, ar } as const
type Locale = keyof typeof dict

function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// Position along horizontal axis for the probe / target ring.
function radiusToSvgX(rMm: number): number {
  return PLANET_CX + rMm * PX_PER_MM
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

  // Setup selection: seed-indexed, hand-authored. Stage 3 fail rotates
  // to the next setup via failCountRef so the same seed doesn't unlock
  // brute-force re-submission of the same setup.
  const failCountRef = useRef(0)
  const [setupIdx, setSetupIdx] = useState<number>(seed % SETUPS.length)
  const setup = SETUPS[setupIdx]!

  // DOF state
  const [M, setM] = useState(M_DEFAULT)
  const [r, setR] = useState(R_DEFAULT)

  // Peek (blind stage strategy hint — text only, rotating).
  const [peekVisible, setPeekVisible] = useState(false)
  const peekIdxRef = useRef(0)

  // Stage 1 coverage bits — track min/max sweep per slider.
  const [mMin, setMMin] = useState(M_DEFAULT)
  const [mMax, setMMax] = useState(M_DEFAULT)
  const [rMin, setRMin] = useState(R_DEFAULT)
  const [rMax, setRMax] = useState(R_DEFAULT)

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  const resetStageState = useCallback(() => {
    setM(M_DEFAULT)
    setR(R_DEFAULT)
    setMMin(M_DEFAULT); setMMax(M_DEFAULT)
    setRMin(R_DEFAULT); setRMax(R_DEFAULT)
    setPeekVisible(false)
  }, [])
  useReset(resetStageState)

  // ─── Coverage predicate for stage 1 ─────────────────────────────
  const mCoverage = (mMax - mMin) / (M_MAX - M_MIN)
  const rCoverage = (rMax - rMin) / (R_MAX - R_MIN)
  const stage1Done = mCoverage >= COVERAGE_MIN_FRAC && rCoverage >= COVERAGE_MIN_FRAC

  // ─── Feature match ──────────────────────────────────────────────
  const currentG = computeFeature(M, r)
  const stage23Match = featureMatches(M, r, setup)
  const canSubmit = isStage1 ? stage1Done : stage23Match

  useEffect(() => {
    progress(stageIdx / 3, { stage: stageIdx, canSubmit })
  }, [stageIdx, canSubmit, progress])

  // ─── Next: advance or stage-3 fail-with-restart ─────────────────
  useNext(() => {
    if (stageIdx < 3) {
      setStage(stageIdx + 1)
      resetStageState()
      return
    }
    if (stage23Match) {
      complete({ success: true })
      return
    }
    // Stage 3 fail: rotate to a different setup, reset sliders.
    failCountRef.current += 1
    setSetupIdx((i) => (i + 1) % SETUPS.length)
    resetStageState()
  })

  // ─── Peek (blind stage only, text hint, 4 s) ────────────────────
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

  // ─── Field heatmap cells (stages 1 + 2 only) ────────────────────
  const planetR = planetRadiusPx(M)
  const fieldCells = useMemo(() => {
    if (isStage3) return null // continuous visualization = help, hidden on blind stage
    const cells: React.ReactNode[] = []
    const pR = planetRadiusPx(M)
    for (let j = 0; j < GRID_ROWS; j++) {
      for (let i = 0; i < GRID_COLS; i++) {
        const cx = FIELD_LEFT + (i + 0.5) * CELL_W
        const cy = FIELD_TOP + (j + 0.5) * CELL_H
        const dPx = Math.hypot(cx - PLANET_CX, cy - PLANET_CY)
        if (dPx < pR + 1.5) continue
        const dMm = dPx / PX_PER_MM
        const g = gravField(M, dMm)
        cells.push(
          <rect
            key={`c${i}-${j}`}
            x={cx - CELL_W / 2}
            y={cy - CELL_H / 2}
            width={CELL_W + 0.4}
            height={CELL_H + 0.4}
            fill={fieldColor(g)}
            opacity={0.85}
          />,
        )
      }
    }
    return cells
  }, [isStage3, M])

  // ─── Radial field arrows (stages 1 + 2 only) ────────────────────
  // A sparse ring of small inward-pointing arrows to make the direction
  // (attractive, toward source) unambiguous — the heatmap alone only
  // conveys magnitude.
  const arrows = useMemo(() => {
    if (isStage3) return null
    const nodes: React.ReactNode[] = []
    const radiiPx = [80, 140, 210]
    const nAngles = 12
    const pR = planetRadiusPx(M)
    for (const rp of radiiPx) {
      if (rp < pR + 12) continue
      for (let k = 0; k < nAngles; k++) {
        const a = (k / nAngles) * Math.PI * 2
        const cx = PLANET_CX + rp * Math.cos(a)
        const cy = PLANET_CY + rp * Math.sin(a)
        if (cx < FIELD_LEFT + 6 || cx > FIELD_RIGHT - 6) continue
        if (cy < FIELD_TOP + 6 || cy > FIELD_BOT - 6) continue
        const ux = -Math.cos(a)
        const uy = -Math.sin(a)
        const len = 8
        const x1 = cx - ux * (len / 2)
        const y1 = cy - uy * (len / 2)
        const x2 = cx + ux * (len / 2)
        const y2 = cy + uy * (len / 2)
        // Arrowhead: short perpendicular whiskers at tip.
        const px = -uy
        const py = ux
        const hx = x2 - ux * 3
        const hy = y2 - uy * 3
        const h1x = hx + px * 2
        const h1y = hy + py * 2
        const h2x = hx - px * 2
        const h2y = hy - py * 2
        nodes.push(
          <g key={`arr-${rp}-${k}`} opacity={0.75}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#EAF0FA" strokeWidth={0.9} />
            <line x1={x2} y1={y2} x2={h1x} y2={h1y} stroke="#EAF0FA" strokeWidth={0.9} />
            <line x1={x2} y1={y2} x2={h2x} y2={h2y} stroke="#EAF0FA" strokeWidth={0.9} />
          </g>,
        )
      }
    }
    return nodes
  }, [isStage3, M])

  // ─── Probe marker + live readout (stages 1 + 2 only) ────────────
  const probeX = radiusToSvgX(r)
  const probeVisible = !isStage3 && probeX >= FIELD_LEFT + 4 && probeX <= FIELD_RIGHT - 4

  // ─── Target ring (stages 2 + 3) ─────────────────────────────────
  const targetRadiusPx = setup.rStar * PX_PER_MM
  const showTarget = isStage2 || isStage3

  // ─── HUD text ───────────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`

  const hudTR = isStage1
    ? `M·${(mCoverage * 100).toFixed(0)}%  r·${(rCoverage * 100).toFixed(0)}%`
    : isStage2
      ? stage23Match
        ? `✓ ${labels.match_ok}`
        : `|g| = ${formatG(currentG)} N/kg`
      : `r* = ${setup.rStar.toFixed(1)} Mm · |g*| = ${formatG(setup.gStar)} N/kg`

  const hudBL = peekVisible && isStage3
    ? (peekIdxRef.current % 2 === 1
        ? labels.peek_tip_formula
        : labels.peek_tip_anchor)
    : (isStage1 ? labels.tip1 : isStage2 ? labels.tip2 : labels.tip3)

  // BR reserved for parent chrome (fullscreen toggle) — leave empty.

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block', userSelect: 'none' }}
      >
        {/* Full-canvas background — NO rx. */}
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        {/* Field region frame */}
        <rect
          x={FIELD_LEFT - 4}
          y={FIELD_TOP - 4}
          width={FIELD_RIGHT - FIELD_LEFT + 8}
          height={FIELD_BOT - FIELD_TOP + 8}
          fill="none"
          stroke="#12203a"
          strokeWidth={1}
          rx={6}
        />
        <text
          x={FIELD_LEFT + 4}
          y={FIELD_TOP - 10}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={11}
          letterSpacing="0.1em"
        >
          {labels.field_label}
        </text>

        {/* Heatmap of |g|. Hidden on stage 3. */}
        {fieldCells}

        {/* Radial arrows (direction cue). Hidden on stage 3. */}
        {arrows}

        {/* Horizontal probe axis (subtle guide) */}
        <line
          x1={PLANET_CX}
          y1={PLANET_CY}
          x2={FIELD_RIGHT - 8}
          y2={PLANET_CY}
          stroke="#2A3654"
          strokeWidth={0.6}
          strokeDasharray="2 4"
          opacity={0.6}
        />

        {/* Distance scale ticks along the axis (every 5 Mm) */}
        {[5, 10, 15, 20].map((rMm) => {
          const tx = radiusToSvgX(rMm)
          if (tx > FIELD_RIGHT - 6) return null
          return (
            <g key={`tick-${rMm}`}>
              <line x1={tx} y1={PLANET_CY - 3} x2={tx} y2={PLANET_CY + 3} stroke="#3A4863" strokeWidth={1} />
              <text
                x={tx}
                y={PLANET_CY + 14}
                fill="#54617A"
                fontFamily="'JetBrains Mono', monospace"
                fontSize={9}
                textAnchor="middle"
              >
                {rMm}Mm
              </text>
            </g>
          )
        })}

        {/* Source planet — small body scales with M for visual continuity */}
        <circle
          cx={PLANET_CX}
          cy={PLANET_CY}
          r={planetR + 2}
          fill="none"
          stroke="#37C9B8"
          strokeWidth={0.6}
          opacity={0.35}
        />
        <circle cx={PLANET_CX} cy={PLANET_CY} r={planetR} fill="#8FA3C4" />
        <circle
          cx={PLANET_CX - planetR * 0.35}
          cy={PLANET_CY - planetR * 0.35}
          r={planetR * 0.28}
          fill="#B8C7E0"
          opacity={0.65}
        />
        <text
          x={PLANET_CX}
          y={PLANET_CY - planetR - 8}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={10}
          textAnchor="middle"
        >
          {labels.source_label}: M = {formatM(M)} × 10²⁴ kg
        </text>

        {/* Target ring at r* (stages 2 + 3) */}
        {showTarget && (() => {
          const tx = radiusToSvgX(setup.rStar)
          return (
            <g>
              <circle
                cx={PLANET_CX}
                cy={PLANET_CY}
                r={targetRadiusPx}
                fill="none"
                stroke="#F97316"
                strokeWidth={1.2}
                strokeDasharray="6 5"
                opacity={0.9}
              />
              {/* Marker where the target circle crosses the horizontal probe axis */}
              <circle cx={tx} cy={PLANET_CY} r={5} fill="none" stroke="#F97316" strokeWidth={1.5} />
              <circle cx={tx} cy={PLANET_CY} r={2} fill="#F97316" />
              <text
                x={tx + 10}
                y={PLANET_CY - 10}
                fill="#F9A968"
                fontFamily="'JetBrains Mono', monospace"
                fontSize={10}
              >
                r* = {setup.rStar.toFixed(1)} Mm
              </text>
              <text
                x={tx + 10}
                y={PLANET_CY + 20}
                fill="#F9A968"
                fontFamily="'JetBrains Mono', monospace"
                fontSize={10}
              >
                |g*| = {formatG(setup.gStar)} N/kg
              </text>
            </g>
          )
        })()}

        {/* Probe marker (stages 1 + 2 only) */}
        {probeVisible && (
          <g>
            <circle cx={probeX} cy={PLANET_CY} r={4.5} fill="#37C9B8" />
            <circle cx={probeX} cy={PLANET_CY} r={9} fill="none" stroke="#37C9B8" strokeWidth={0.8} opacity={0.5} />
            {/* Inward arrow: field direction at probe */}
            <line
              x1={probeX}
              y1={PLANET_CY - 12}
              x2={probeX - 14}
              y2={PLANET_CY - 12}
              stroke="#37C9B8"
              strokeWidth={1.2}
            />
            <line x1={probeX - 14} y1={PLANET_CY - 12} x2={probeX - 10} y2={PLANET_CY - 15} stroke="#37C9B8" strokeWidth={1.2} />
            <line x1={probeX - 14} y1={PLANET_CY - 12} x2={probeX - 10} y2={PLANET_CY - 9} stroke="#37C9B8" strokeWidth={1.2} />
            <text
              x={probeX}
              y={PLANET_CY - 22}
              fill="#37C9B8"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
              textAnchor="middle"
            >
              |g| = {formatG(currentG)} N/kg
            </text>
            <text
              x={probeX}
              y={PLANET_CY + 30}
              fill="#6C7A93"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={9}
              textAnchor="middle"
            >
              {labels.probe_label} · r = {r.toFixed(1)} Mm
            </text>
          </g>
        )}
      </svg>

      {/* ─── HUD overlays ────────────────────────────────────────── */}
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
          color: isStage2 && stage23Match ? '#37C9B8' : '#B9C4D6',
          textAlign: 'right',
          zIndex: 5,
          pointerEvents: 'none',
          maxWidth: '46%',
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
          fontSize: peekVisible && isStage3 ? '1.9rem' : '2.3rem',
          letterSpacing: '0.06em',
          color: peekVisible && isStage3 ? '#F9A968' : '#6C7A93',
          zIndex: 5,
          pointerEvents: 'none',
          maxWidth: '62%',
          lineHeight: 1.35,
        }}
      >
        {hudBL}
      </div>
      {/* NO bottom-right overlay — reserved for parent chrome. */}

      {/* ─── Slider column (right side, HTML overlay) ────────────── */}
      <div
        style={{
          position: 'absolute',
          top: '9rem',
          right: '3rem',
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'flex-start',
          gap: '2.5rem',
          zIndex: 6,
        }}
      >
        <SliderVertical
          label="M"
          unit="×10²⁴ kg"
          value={M}
          min={M_MIN}
          max={M_MAX}
          step={M_STEP}
          format={(v) => v.toFixed(2)}
          onChange={(v) => {
            setM(v)
            setMMin((prev) => Math.min(prev, v))
            setMMax((prev) => Math.max(prev, v))
          }}
        />
        <SliderVertical
          label="r"
          unit="Mm"
          value={r}
          min={R_MIN}
          max={R_MAX}
          step={R_STEP}
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
        {label} = {format(value)}
      </div>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.2rem', color: '#54617A' }}>
        {unit}
      </div>
    </div>
  )
}
