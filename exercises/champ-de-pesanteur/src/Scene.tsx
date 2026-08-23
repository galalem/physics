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
  altitudeForG,
  featureMatchesTolerance,
  gField,
  H_DEFAULT,
  H_MAX,
  H_MIN,
  H_STEP,
  M_DEFAULT,
  M_MAX,
  M_MIN,
  M_STEP,
  R_EARTH_KM,
  SETUPS,
} from './physics'

// ─── Scene constants ────────────────────────────────────────────────────
const W = 800
const H = 450

// Earth geometry (SVG units). Center is below canvas midline so top
// hemisphere occupies most of the drawable region.
const EARTH_CX = 240
const EARTH_CY = 420
const EARTH_R_PX = 100

// Altitude visualization scale: pixels per km, mapping h ∈ [0, H_MAX] onto
// the strip from the Earth's north pole (y = EARTH_CY − EARTH_R_PX = 320)
// up to y ≈ 70.
const SURFACE_Y = EARTH_CY - EARTH_R_PX // 320
const ALT_TOP_Y = 70
const ALT_PX_PER_KM = (SURFACE_Y - ALT_TOP_Y) / H_MAX // 250/20000 = 0.0125

// Arrow scale: 4 px per N/kg of gravitational field magnitude. At g₀ ≈ 9.73
// this gives ~39 px, well-sized for the strip.
const ARROW_PX_PER_G = 4

// Coverage
const COVERAGE_MIN_FRAC = 0.5

// ─── Label loader ──────────────────────────────────────────────────────
const dict = { en, fr, ar } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── Small helpers ─────────────────────────────────────────────────────
function fmtG(g: number): string {
  if (g >= 10) return g.toFixed(2)
  if (g >= 1) return g.toFixed(2)
  return g.toFixed(3)
}

function fmtH(h: number): string {
  if (h >= 10000) return h.toFixed(0)
  return h.toFixed(0)
}

function fmtM(m: number): string {
  return m.toFixed(2)
}

/** Convert current h (km) to SVG y coordinate above the Earth surface. */
function altYForKm(hKm: number): number {
  const clamped = Math.max(0, Math.min(H_MAX, hKm))
  return SURFACE_Y - clamped * ALT_PX_PER_KM
}

// ─── Component ─────────────────────────────────────────────────────────
export default function Scene() {
  const { locale, seed } = useInit()
  const stages = useMemo(() => getStagesFor(locale), [locale])
  useDeclareStages(stages)
  const labels = useMemo(() => svgLabels(locale), [locale])

  const stageIdx = useCurrentStage()
  const setStage = useSetStage()
  const progress = useProgress()
  const complete = useComplete()

  // ─── DOF state ───────────────────────────────────────────────────────
  const [mVal, setMVal] = useState(M_DEFAULT)
  const [hVal, setHVal] = useState(H_DEFAULT)
  const [peekVisible, setPeekVisible] = useState(false)
  const peekIdxRef = useRef(0)

  // Stage-1 coverage bits
  const [mMin, setMMin] = useState(M_DEFAULT)
  const [mMax, setMMax] = useState(M_DEFAULT)
  const [hMinSeen, setHMinSeen] = useState(H_DEFAULT)
  const [hMaxSeen, setHMaxSeen] = useState(H_DEFAULT)

  // Stage-3 fail-with-restart rotation
  const [failCount, setFailCount] = useState(0)

  // Seed-indexed setup; failed submits rotate to the next setup.
  const setup = useMemo(
    () => SETUPS[(seed + failCount) % SETUPS.length]!,
    [seed, failCount],
  )

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  const resetStageState = useCallback(() => {
    setMVal(M_DEFAULT)
    setHVal(H_DEFAULT)
    setMMin(M_DEFAULT)
    setMMax(M_DEFAULT)
    setHMinSeen(H_DEFAULT)
    setHMaxSeen(H_DEFAULT)
    setPeekVisible(false)
  }, [])
  useReset(resetStageState)

  // ─── Coverage (stage 1 advance predicate) ────────────────────────────
  const mCoverage = (mMax - mMin) / (M_MAX - M_MIN)
  const hCoverage = (hMaxSeen - hMinSeen) / (H_MAX - H_MIN)
  const stage1Done =
    mCoverage >= COVERAGE_MIN_FRAC && hCoverage >= COVERAGE_MIN_FRAC

  // ─── Feature match ───────────────────────────────────────────────────
  const gCurrent = gField(mVal, hVal)
  const featureMatch = featureMatchesTolerance(mVal, hVal, setup)

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
      // Stage 3 miss: rotate to the next setup, reset sliders. No second try
      // on the same planet (§5.2 single-submit).
      setFailCount((c) => c + 1)
      resetStageState()
    }
  })

  // ─── Peek (blind stage only — strategy text, never the rendering) ────
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

  // ─── Field arrow sampling ───────────────────────────────────────────
  // Two visualization elements when NOT on stage 3:
  //  1. A vertical column of reference arrows at x = EARTH_CX at fixed
  //     altitudes — shows the 1/r² fall-off.
  //  2. Two arrows at h = 0 offset laterally — shows that near the surface
  //     the field looks uniform (all radial pulls point toward centre).
  const showVisualization = !isStage3

  const referenceArrows = useMemo(() => {
    if (!showVisualization) return null
    // Sample altitudes across the visible strip.
    const sampleH = [0, 500, 2000, 5000, 10000, 15000]
    const nodes: React.ReactNode[] = []
    for (const h of sampleH) {
      const yTop = altYForKm(h)
      if (yTop < ALT_TOP_Y - 4) continue
      const g = gField(mVal, h)
      const len = Math.min(80, g * ARROW_PX_PER_G)
      // Skip vanishingly short arrows.
      if (len < 1.5) continue
      const x = EARTH_CX
      // Arrow points DOWN toward Earth centre (which lies straight below).
      nodes.push(
        <g key={`ref-${h}`} opacity={0.55}>
          <line
            x1={x}
            y1={yTop}
            x2={x}
            y2={yTop + len}
            stroke="#37C9B8"
            strokeWidth={1.4}
          />
          <path
            d={`M ${x - 3} ${yTop + len - 4} L ${x} ${yTop + len} L ${x + 3} ${yTop + len - 4}`}
            fill="none"
            stroke="#37C9B8"
            strokeWidth={1.4}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>,
      )
    }
    return nodes
  }, [mVal, showVisualization])

  const radialSurfaceArrows = useMemo(() => {
    if (!showVisualization) return null
    // Two arrows at the surface, one on each side of the pole. They point
    // toward the Earth's centre — showing the "radial" nature that becomes
    // "uniform" only at short distances.
    const gSurface = gField(mVal, 0)
    const len = Math.min(80, gSurface * ARROW_PX_PER_G)
    if (len < 1.5) return null
    const points: { x: number; y: number }[] = [
      { x: EARTH_CX - 68, y: SURFACE_Y + 4 }, // upper-left of surface
      { x: EARTH_CX + 68, y: SURFACE_Y + 4 }, // upper-right of surface
    ]
    const nodes: React.ReactNode[] = []
    for (let i = 0; i < points.length; i++) {
      const p = points[i]!
      const dx = EARTH_CX - p.x
      const dy = EARTH_CY - p.y
      const mag = Math.sqrt(dx * dx + dy * dy)
      const ux = dx / mag
      const uy = dy / mag
      const tipX = p.x + ux * len
      const tipY = p.y + uy * len
      // Arrowhead: 3px offset perpendicular
      const px = -uy
      const py = ux
      nodes.push(
        <g key={`rad-${i}`} opacity={0.5}>
          <line
            x1={p.x}
            y1={p.y}
            x2={tipX}
            y2={tipY}
            stroke="#37C9B8"
            strokeWidth={1.4}
          />
          <path
            d={`M ${tipX - ux * 4 + px * 3} ${tipY - uy * 4 + py * 3} L ${tipX} ${tipY} L ${tipX - ux * 4 - px * 3} ${tipY - uy * 4 - py * 3}`}
            fill="none"
            stroke="#37C9B8"
            strokeWidth={1.4}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>,
      )
    }
    return nodes
  }, [mVal, showVisualization])

  // ─── Probe position (current altitude) ──────────────────────────────
  const probeY = altYForKm(hVal)

  // Probe's own field arrow (part of the visualization — hidden on stage 3).
  const probeArrow = useMemo(() => {
    if (!showVisualization) return null
    const len = Math.min(90, gCurrent * ARROW_PX_PER_G)
    if (len < 1.5) return null
    return (
      <g>
        <line
          x1={EARTH_CX}
          y1={probeY}
          x2={EARTH_CX}
          y2={probeY + len}
          stroke="#F97316"
          strokeWidth={2}
        />
        <path
          d={`M ${EARTH_CX - 4} ${probeY + len - 5} L ${EARTH_CX} ${probeY + len} L ${EARTH_CX + 4} ${probeY + len - 5}`}
          fill="none"
          stroke="#F97316"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    )
  }, [gCurrent, probeY, showVisualization])

  // ─── Stage-2 guide ring: altitude at which g = g* for CURRENT M ─────
  // This is the training-wheels help of §4.7 — visible on stage 2 only.
  const stage2RingY = useMemo(() => {
    if (!isStage2) return null
    const h = altitudeForG(mVal, setup.gStar)
    if (!Number.isFinite(h) || h < 0 || h > H_MAX) return null
    return altYForKm(h)
  }, [isStage2, mVal, setup.gStar])

  // ─── HUD text ────────────────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`
  const hudTR = isStage1
    ? `${labels.mass_short}·${(mCoverage * 100).toFixed(0)}%  ${labels.altitude_short}·${(hCoverage * 100).toFixed(0)}%`
    : `${labels.target}  ${labels.mass_short}* = ${fmtM(setup.mStar)} ${labels.m_units}  |  ${labels.field_short}* = ${fmtG(setup.gStar)} ${labels.g_units}`
  const hudBL = peekVisible
    ? (PEEK_TIPS[(peekIdxRef.current - 1) % PEEK_TIPS.length] ?? '')
    : isStage1
      ? labels.tip1
      : isStage2
        ? labels.tip2
        : labels.tip3
  // BR intentionally empty — reserved for parent-side chrome.

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
          userSelect: 'none',
        }}
      >
        {/* Background — no rx. */}
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        {/* Scene panel border */}
        <rect
          x={32}
          y={60}
          width={720}
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
          {labels.panel}
        </text>

        {/* Altitude ruler (left of Earth) — reference axis */}
        <g>
          <line
            x1={100}
            y1={SURFACE_Y}
            x2={100}
            y2={ALT_TOP_Y}
            stroke="#2A3654"
            strokeWidth={1}
          />
          {[0, 5000, 10000, 15000, 20000].map((h) => {
            const y = altYForKm(h)
            return (
              <g key={`tick-${h}`}>
                <line
                  x1={95}
                  y1={y}
                  x2={105}
                  y2={y}
                  stroke="#2A3654"
                  strokeWidth={1}
                />
                <text
                  x={90}
                  y={y + 3}
                  fill="#54617A"
                  fontFamily="'JetBrains Mono', monospace"
                  fontSize={9}
                  textAnchor="end"
                >
                  {h}
                </text>
              </g>
            )
          })}
          <text
            x={90}
            y={ALT_TOP_Y - 6}
            fill="#54617A"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={9}
            textAnchor="end"
          >
            {labels.h_units}
          </text>
        </g>

        {/* Earth cross-section */}
        <defs>
          <radialGradient id="earthGrad" cx="0.4" cy="0.35" r="0.9">
            <stop offset="0%" stopColor="#2E5D8A" />
            <stop offset="55%" stopColor="#1B3A5B" />
            <stop offset="100%" stopColor="#0A1A2E" />
          </radialGradient>
        </defs>
        <circle
          cx={EARTH_CX}
          cy={EARTH_CY}
          r={EARTH_R_PX}
          fill="url(#earthGrad)"
          stroke="#3A6494"
          strokeWidth={1.2}
        />
        {/* Surface line (indicates R = 6400 km) */}
        <line
          x1={EARTH_CX - EARTH_R_PX - 8}
          y1={SURFACE_Y}
          x2={EARTH_CX + EARTH_R_PX + 8}
          y2={SURFACE_Y}
          stroke="#3A6494"
          strokeWidth={0.5}
          strokeDasharray="3 4"
          opacity={0.6}
        />
        {/* Centre marker */}
        <circle cx={EARTH_CX} cy={EARTH_CY} r={2} fill="#54617A" />
        <text
          x={EARTH_CX + 8}
          y={EARTH_CY + 3}
          fill="#54617A"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={9}
        >
          {labels.planet}
        </text>
        <text
          x={EARTH_CX + EARTH_R_PX + 12}
          y={SURFACE_Y + 3}
          fill="#54617A"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={9}
        >
          R = {R_EARTH_KM} km
        </text>

        {/* Field visualization — hidden on stage 3 (help per §4.7) */}
        {radialSurfaceArrows}
        {referenceArrows}

        {/* Stage-2 guide ring (help — visible on stage 2 only) */}
        {isStage2 && stage2RingY != null && (
          <g>
            <line
              x1={EARTH_CX - 60}
              y1={stage2RingY}
              x2={EARTH_CX + 60}
              y2={stage2RingY}
              stroke="#F97316"
              strokeWidth={1.2}
              strokeDasharray="5 4"
              opacity={0.75}
            />
            <text
              x={EARTH_CX + 66}
              y={stage2RingY + 3}
              fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={9}
            >
              {labels.field_short}* = {fmtG(setup.gStar)}
            </text>
          </g>
        )}

        {/* Probe arrow (its own field readout — part of visualization) */}
        {probeArrow}

        {/* Probe icon (current altitude — required info on all stages) */}
        <g>
          <circle
            cx={EARTH_CX}
            cy={probeY}
            r={6}
            fill="#B9C4D6"
            stroke="#F0F4FA"
            strokeWidth={1}
          />
          <circle
            cx={EARTH_CX}
            cy={probeY}
            r={2}
            fill="#0D1524"
          />
          <text
            x={EARTH_CX + 12}
            y={probeY + 3}
            fill="#B9C4D6"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={9}
          >
            {labels.probe} · h = {fmtH(hVal)} {labels.h_units}
          </text>
        </g>

        {/* Target label pane (stages 2 & 3) — the coordinates the student
            must aim at, drawn as SVG text near the probe strip. */}
        {(isStage2 || isStage3) && (
          <g>
            <rect
              x={380}
              y={90}
              width={260}
              height={100}
              fill="#0D1524"
              stroke="#F97316"
              strokeWidth={1}
              rx={6}
              opacity={0.85}
            />
            <text
              x={392}
              y={112}
              fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={11}
              letterSpacing="0.14em"
            >
              {labels.target.toUpperCase()}
            </text>
            <text
              x={392}
              y={140}
              fill="#F0F4FA"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={16}
            >
              {labels.mass_short}* = {fmtM(setup.mStar)} {labels.m_units}
            </text>
            <text
              x={392}
              y={168}
              fill="#F0F4FA"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={16}
            >
              {labels.field_short}* = {fmtG(setup.gStar)} {labels.g_units}
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
          fontSize: '2.1rem',
          letterSpacing: '0.08em',
          color: '#B9C4D6',
          zIndex: 5,
          pointerEvents: 'none',
          textAlign: 'right',
          maxWidth: '55%',
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
          fontSize: '2.1rem',
          letterSpacing: '0.06em',
          color: peekVisible ? '#F9A968' : '#6C7A93',
          zIndex: 5,
          pointerEvents: 'none',
          maxWidth: '46%',
        }}
      >
        {hudBL}
      </div>
      {/* BR intentionally omitted — reserved for parent-side chrome. */}

      {/* ─── Slider column (right side, HTML overlay) ────────────── */}
      <div
        style={{
          position: 'absolute',
          top: '9rem',
          right: '4rem',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '2rem',
          zIndex: 6,
        }}
      >
        <SliderVertical
          label={labels.mass_short}
          unit={labels.m_units}
          value={mVal}
          min={M_MIN}
          max={M_MAX}
          step={M_STEP}
          format={(v) => v.toFixed(1)}
          onChange={(v) => {
            setMVal(v)
            setMMin((prev) => Math.min(prev, v))
            setMMax((prev) => Math.max(prev, v))
          }}
        />
        <SliderVertical
          label={labels.altitude_short}
          unit={labels.h_units}
          value={hVal}
          min={H_MIN}
          max={H_MAX}
          step={H_STEP}
          format={(v) => v.toFixed(0)}
          onChange={(v) => {
            setHVal(v)
            setHMinSeen((prev) => Math.min(prev, v))
            setHMaxSeen((prev) => Math.max(prev, v))
          }}
        />
      </div>
    </div>
  )
}

// ─── Slider primitive (copied from diffraction reference) ─────────────
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
          height: '17rem',
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
            width: '17rem',
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
