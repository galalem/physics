import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  useSetStage,
  useCurrentStage,
  useComplete,
  useDeclareStages,
  useHint,
  useInit,
  useNext,
  usePeek,
  useProgress,
  useReset,
} from '@physics/sdk/react'
import { getHintFor, getStagesFor } from './stages'
import en from '../i18n/en.json'
import fr from '../i18n/fr.json'
import ar from '../i18n/ar.json'
import {
  featureMatchesTolerance,
  lambdaMm,
  refractedAngleRad,
  SETUPS,
  T_PERIOD_S,
} from './physics'

// ─── Canvas constants ───────────────────────────────────────
const W = 800
const H = 450

// Ripple-tank frame
const FRAME_X = 32
const FRAME_Y = 60
const FRAME_W = 720
const FRAME_H = 358

// Working region for the two zones (leaves room for the HTML slider
// column overlay on the right).
const ZONE_X0 = 60
const ZONE_X1 = 560
const ZONE_TOP = 70
const ZONE_BOT = 410
const INTERFACE_Y = 225
const REF_X = 300 // reference point where a "central" wavefront crosses the interface

// Wavelength scale: SVG-units per mm.
// Slider range c ∈ [0.10, 0.50] m/s → λ = c·T·1000 ∈ [5, 25] mm.
// At 5 units/mm that maps to λ ∈ [25, 125] SVG units — a good density
// for the ~340-unit-wide working region.
const PX_PER_MM = 5

// ─── Physics DOF ranges ─────────────────────────────────────
const C1_MIN = 0.10 // m/s
const C1_MAX = 0.50
const C1_DEFAULT = 0.30
const C2_MIN = 0.10
const C2_MAX = 0.50
const C2_DEFAULT = 0.20
const I1_MIN_DEG = 10
const I1_MAX_DEG = 70
const I1_DEFAULT_DEG = 40

const COVERAGE_MIN_FRAC = 0.5

// ─── Locale dict (EN only for now) ──────────────────────────
const dict = { en, fr, ar } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── Helpers ────────────────────────────────────────────────
const deg2rad = (d: number) => (d * Math.PI) / 180
const rad2deg = (r: number) => (r * 180) / Math.PI

function fmtDeg(d: number): string {
  return `${d.toFixed(0)}°`
}
function fmtMm(mm: number): string {
  if (mm >= 100) return `${mm.toFixed(0)}mm`
  if (mm >= 10) return `${mm.toFixed(1)}mm`
  return `${mm.toFixed(2)}mm`
}

// Build a wavefront line, long enough to span the frame diagonal,
// perpendicular to propagation direction n=(nx,ny). Anchored at (ax,ay).
function wavefrontEndpoints(ax: number, ay: number, nx: number, ny: number, halfLen = 900) {
  // Perpendicular to n:  (px,py) = (-ny, nx)  (or its negative)
  const px = -ny
  const py = nx
  return {
    x1: ax - halfLen * px,
    y1: ay - halfLen * py,
    x2: ax + halfLen * px,
    y2: ay + halfLen * py,
  }
}

// ─── Component ──────────────────────────────────────────────
export default function Scene() {
  const { locale, seed } = useInit()
  const stages = useMemo(() => getStagesFor(locale), [locale])
  useDeclareStages(stages)
  const labels = useMemo(() => svgLabels(locale), [locale])

  const stageIdx = useCurrentStage()
  const setStage = useSetStage()
  const progress = useProgress()
  const complete = useComplete()

  // ─── DOF state ──────────────────────────────────────────
  const [c1, setC1] = useState(C1_DEFAULT)
  const [c2, setC2] = useState(C2_DEFAULT)
  const [i1Deg, setI1Deg] = useState(I1_DEFAULT_DEG)
  const [peekVisible, setPeekVisible] = useState(false)
  const [peekTipIdx, setPeekTipIdx] = useState(0)

  // Stage 1 coverage tracking
  const [c1Min, setC1Min] = useState(C1_DEFAULT)
  const [c1Max, setC1Max] = useState(C1_DEFAULT)
  const [c2Min, setC2Min] = useState(C2_DEFAULT)
  const [c2Max, setC2Max] = useState(C2_DEFAULT)
  const [i1Min, setI1Min] = useState(I1_DEFAULT_DEG)
  const [i1Max, setI1Max] = useState(I1_DEFAULT_DEG)

  // Stage 3 fail-with-restart rotation
  const [failCount, setFailCount] = useState(0)

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  // Seed-indexed hand-authored setups (§5.3)
  const stage2Setup = useMemo(
    () => SETUPS[seed % SETUPS.length]!,
    [seed],
  )
  const stage3Setup = useMemo(
    () => SETUPS[(seed + 1 + failCount) % SETUPS.length]!,
    [seed, failCount],
  )
  const activeTarget = isStage2 ? stage2Setup : stage3Setup

  const resetStageState = useCallback(() => {
    setC1(C1_DEFAULT)
    setC2(C2_DEFAULT)
    setI1Deg(I1_DEFAULT_DEG)
    setC1Min(C1_DEFAULT); setC1Max(C1_DEFAULT)
    setC2Min(C2_DEFAULT); setC2Max(C2_DEFAULT)
    setI1Min(I1_DEFAULT_DEG); setI1Max(I1_DEFAULT_DEG)
    setPeekVisible(false)
  }, [])
  useReset(() => {
    resetStageState()
    setFailCount(0)
  })

  // ─── Derived physics ────────────────────────────────────
  const i1Rad = deg2rad(i1Deg)
  const lambda1 = lambdaMm(c1) // mm
  const lambda2 = lambdaMm(c2) // mm
  const i2Rad = refractedAngleRad(c1, c2, i1Rad) // rad | null (TIR)
  const i2Deg = i2Rad === null ? null : rad2deg(i2Rad)

  // ─── Coverage predicate ─────────────────────────────────
  const c1Cov = (c1Max - c1Min) / (C1_MAX - C1_MIN)
  const c2Cov = (c2Max - c2Min) / (C2_MAX - C2_MIN)
  const i1Cov = (i1Max - i1Min) / (I1_MAX_DEG - I1_MIN_DEG)
  const stage1Done =
    c1Cov >= COVERAGE_MIN_FRAC &&
    c2Cov >= COVERAGE_MIN_FRAC &&
    i1Cov >= COVERAGE_MIN_FRAC

  // ─── Feature match ──────────────────────────────────────
  const stage2Match = featureMatchesTolerance(i2Deg, lambda2, stage2Setup)
  const stage3Match = featureMatchesTolerance(i2Deg, lambda2, stage3Setup)

  // Stage 3: canSubmit is ALWAYS true — the whole point is a single
  // blind submit; adjudication happens inside useNext, not before.
  const canSubmit = isStage1
    ? stage1Done
    : isStage2
      ? stage2Match
      : true

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
      // Fail: rotate to next setup, reset sliders.
      setFailCount((f) => f + 1)
      resetStageState()
    }
  })

  // ─── Peek — text only, never reveals refracted wavefronts ──
  const PEEK_TIPS = useMemo(
    () => [labels.peek_tip_formula, labels.peek_tip_anchor],
    [labels],
  )
  usePeek(() => {
    if (!isStage3) return
    setPeekTipIdx((k) => (k + 1) % PEEK_TIPS.length)
    setPeekVisible(true)
  })
  useEffect(() => {
    if (!peekVisible) return
    const t = setTimeout(() => setPeekVisible(false), 4000)
    return () => clearTimeout(t)
  }, [peekVisible])

  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  // ─── Wavefront geometry ─────────────────────────────────
  const sinI1 = Math.sin(i1Rad)
  const cosI1 = Math.cos(i1Rad)
  const nZone1 = { x: sinI1, y: cosI1 } // propagation into interface (down-right)
  const lambda1Px = lambda1 * PX_PER_MM

  // Zone-1 wavefronts:
  // For each k, wavefront passes through interface at
  // (REF_X - k · λ₁/sin(i₁), INTERFACE_Y). We anchor there and draw
  // perpendicular to nZone1. Clip via zone1Rect.
  // sinI1 ≥ sin(10°) ≈ 0.174 → safe division across the whole slider range.
  const interfaceSpacingPx = lambda1Px / Math.max(sinI1, 1e-3)
  const K_RANGE = 12
  const zone1Wavefronts = useMemo(() => {
    const nodes: React.ReactNode[] = []
    for (let k = -K_RANGE; k <= K_RANGE; k++) {
      const ax = REF_X - k * interfaceSpacingPx
      // Skip lines that can't intersect the working area at all.
      if (ax < -400 || ax > ZONE_X1 + 400) continue
      const ay = INTERFACE_Y
      const { x1, y1, x2, y2 } = wavefrontEndpoints(ax, ay, nZone1.x, nZone1.y)
      nodes.push(
        <line
          key={`w1-${k}`}
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          stroke="#7FB3D5"
          strokeWidth={1.2}
          opacity={0.85}
        />,
      )
    }
    return nodes
  }, [interfaceSpacingPx, nZone1.x, nZone1.y])

  // Zone-2 wavefronts (hidden on stage 3, even during peek).
  const showRefracted = !isStage3
  const zone2Wavefronts = useMemo(() => {
    if (!showRefracted) return null
    if (i2Rad === null) return null
    const sinI2 = Math.sin(i2Rad)
    const cosI2 = Math.cos(i2Rad)
    const nodes: React.ReactNode[] = []
    for (let k = -K_RANGE; k <= K_RANGE; k++) {
      const ax = REF_X - k * interfaceSpacingPx
      if (ax < -400 || ax > ZONE_X1 + 400) continue
      const ay = INTERFACE_Y
      const { x1, y1, x2, y2 } = wavefrontEndpoints(ax, ay, sinI2, cosI2)
      nodes.push(
        <line
          key={`w2-${k}`}
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          stroke="#37C9B8"
          strokeWidth={1.2}
          opacity={0.9}
        />,
      )
    }
    return nodes
  }, [showRefracted, i2Rad, interfaceSpacingPx])

  // ─── Propagation arrows ─────────────────────────────────
  // Incident: from a point up-left of REF_X down-right along nZone1.
  const incArrowStart = {
    x: REF_X - 90 * nZone1.x,
    y: INTERFACE_Y - 90 * nZone1.y,
  }
  const incArrowEnd = {
    x: REF_X - 40 * nZone1.x,
    y: INTERFACE_Y - 40 * nZone1.y,
  }
  // Refracted arrow only when zone-2 shown and not TIR.
  const refArrow = (() => {
    if (!showRefracted || i2Rad === null) return null
    const sinI2 = Math.sin(i2Rad)
    const cosI2 = Math.cos(i2Rad)
    return {
      start: { x: REF_X + 40 * sinI2, y: INTERFACE_Y + 40 * cosI2 },
      end: { x: REF_X + 95 * sinI2, y: INTERFACE_Y + 95 * cosI2 },
    }
  })()

  // ─── Target markers (stages 2 + 3) ──────────────────────
  // Dashed ray at angle i₂* in zone 2 from (REF_X, INTERFACE_Y).
  const i2StarRad = deg2rad(activeTarget.i2StarDeg)
  const targetRayEnd = {
    x: REF_X + 130 * Math.sin(i2StarRad),
    y: INTERFACE_Y + 130 * Math.cos(i2StarRad),
  }
  // Wavelength target: a horizontal bracket in zone 2 of length λ₂*·PX_PER_MM.
  const lambdaTargetLenPx = activeTarget.lambda2StarMm * PX_PER_MM
  const lambdaBracketY = 388
  const lambdaBracketX0 = ZONE_X0 + 24
  const lambdaBracketX1 = lambdaBracketX0 + lambdaTargetLenPx

  // ─── HUD ────────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`
  const hudTR = isStage1
    ? `c1·${(c1Cov * 100).toFixed(0)}% c2·${(c2Cov * 100).toFixed(0)}% i1·${(i1Cov * 100).toFixed(0)}%`
    : `→ i2* = ${fmtDeg(activeTarget.i2StarDeg)} · λ2* = ${fmtMm(activeTarget.lambda2StarMm)}`
  const hudBL = peekVisible
    ? PEEK_TIPS[peekTipIdx]!
    : isStage1
      ? labels.tip1
      : isStage2
        ? labels.tip2
        : labels.tip3

  const tirActive = i2Rad === null

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block', userSelect: 'none' }}
      >
        {/* Full-canvas background — NO rx. */}
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        {/* Zone clip paths */}
        <defs>
          <clipPath id="zone1clip">
            <rect x={ZONE_X0} y={ZONE_TOP} width={ZONE_X1 - ZONE_X0} height={INTERFACE_Y - ZONE_TOP} />
          </clipPath>
          <clipPath id="zone2clip">
            <rect x={ZONE_X0} y={INTERFACE_Y} width={ZONE_X1 - ZONE_X0} height={ZONE_BOT - INTERFACE_Y} />
          </clipPath>
          <marker id="arrowhead" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#B9C4D6" />
          </marker>
          <marker id="arrowheadTarget" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#F97316" />
          </marker>
        </defs>

        {/* Tank frame */}
        <rect x={FRAME_X} y={FRAME_Y} width={FRAME_W} height={FRAME_H} fill="none" stroke="#12203a" strokeWidth={1} rx={6} />
        <text x={FRAME_X + 8} y={FRAME_Y - 8} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={11} letterSpacing="0.1em">
          {labels.tank_label}
        </text>

        {/* Zone tints */}
        <rect x={ZONE_X0} y={ZONE_TOP} width={ZONE_X1 - ZONE_X0} height={INTERFACE_Y - ZONE_TOP} fill="#132038" opacity={0.55} />
        <rect x={ZONE_X0} y={INTERFACE_Y} width={ZONE_X1 - ZONE_X0} height={ZONE_BOT - INTERFACE_Y} fill="#1B2E4C" opacity={0.55} />

        {/* Zone labels */}
        <text x={ZONE_X0 + 8} y={ZONE_TOP + 16} fill="#8FA5C4" fontFamily="'JetBrains Mono', monospace" fontSize={11}>
          {labels.medium1_label}  ·  c₁ = {c1.toFixed(2)} m/s
        </text>
        <text x={ZONE_X0 + 8} y={INTERFACE_Y + 18} fill="#8FA5C4" fontFamily="'JetBrains Mono', monospace" fontSize={11}>
          {labels.medium2_label}  ·  c₂ = {c2.toFixed(2)} m/s
        </text>

        {/* Wavefronts */}
        <g clipPath="url(#zone1clip)">{zone1Wavefronts}</g>
        {zone2Wavefronts && <g clipPath="url(#zone2clip)">{zone2Wavefronts}</g>}

        {/* Interface line (drawn AFTER wavefronts) */}
        <line x1={ZONE_X0} y1={INTERFACE_Y} x2={ZONE_X1} y2={INTERFACE_Y} stroke="#8FA5C4" strokeWidth={1.5} />
        <text x={ZONE_X1 - 8} y={INTERFACE_Y - 4} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={10} textAnchor="end">
          {labels.interface_label}
        </text>

        {/* Normal at REF_X (dashed vertical) */}
        <line x1={REF_X} y1={ZONE_TOP} x2={REF_X} y2={ZONE_BOT} stroke="#54617A" strokeWidth={1} strokeDasharray="3 4" />
        <text x={REF_X + 4} y={ZONE_TOP + 12} fill="#54617A" fontFamily="'JetBrains Mono', monospace" fontSize={9}>
          {labels.normal_label}
        </text>

        {/* Incident propagation arrow */}
        <line
          x1={incArrowStart.x}
          y1={incArrowStart.y}
          x2={incArrowEnd.x}
          y2={incArrowEnd.y}
          stroke="#B9C4D6"
          strokeWidth={1.6}
          markerEnd="url(#arrowhead)"
        />
        {/* Incidence angle label near tip */}
        <text
          x={REF_X - 34 * nZone1.x + 8}
          y={INTERFACE_Y - 34 * nZone1.y - 4}
          fill="#B9C4D6"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={10}
        >
          {labels.incidence_label} = {fmtDeg(i1Deg)}
        </text>

        {/* Refracted propagation arrow (hidden on stage 3 + hidden when TIR) */}
        {refArrow && (
          <>
            <line
              x1={refArrow.start.x}
              y1={refArrow.start.y}
              x2={refArrow.end.x}
              y2={refArrow.end.y}
              stroke="#B9C4D6"
              strokeWidth={1.6}
              markerEnd="url(#arrowhead)"
            />
            <text
              x={refArrow.end.x + 6}
              y={refArrow.end.y + 6}
              fill="#B9C4D6"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
            >
              {labels.refraction_label} = {i2Deg === null ? '—' : fmtDeg(i2Deg)}
            </text>
          </>
        )}

        {/* TIR notice (only on stages 1+2 when refraction is not possible) */}
        {tirActive && !isStage3 && (
          <text x={ZONE_X0 + 8} y={ZONE_BOT - 8} fill="#F97316" fontFamily="'JetBrains Mono', monospace" fontSize={11}>
            total internal reflection (sin i₁ · c₂/c₁ &gt; 1)
          </text>
        )}

        {/* ─── Target markers ─── shown on stages 2 + 3 (required info) */}
        {(isStage2 || isStage3) && (
          <g>
            {/* Dashed target ray at i₂* */}
            <line
              x1={REF_X}
              y1={INTERFACE_Y}
              x2={targetRayEnd.x}
              y2={targetRayEnd.y}
              stroke="#F97316"
              strokeWidth={1.4}
              strokeDasharray="5 4"
              markerEnd="url(#arrowheadTarget)"
              opacity={0.9}
            />
            <text
              x={targetRayEnd.x + 6}
              y={targetRayEnd.y - 2}
              fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
            >
              i₂* = {fmtDeg(activeTarget.i2StarDeg)}
            </text>

            {/* Wavelength target bracket in zone 2 */}
            <line x1={lambdaBracketX0} y1={lambdaBracketY} x2={lambdaBracketX1} y2={lambdaBracketY} stroke="#F97316" strokeWidth={1.6} />
            <line x1={lambdaBracketX0} y1={lambdaBracketY - 5} x2={lambdaBracketX0} y2={lambdaBracketY + 5} stroke="#F97316" strokeWidth={1.6} />
            <line x1={lambdaBracketX1} y1={lambdaBracketY - 5} x2={lambdaBracketX1} y2={lambdaBracketY + 5} stroke="#F97316" strokeWidth={1.6} />
            <text
              x={lambdaBracketX0}
              y={lambdaBracketY - 8}
              fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
            >
              λ₂* = {fmtMm(activeTarget.lambda2StarMm)}
            </text>
          </g>
        )}

        {/* Static reference values (fixed period + λ₁ readout — required info) */}
        <text x={ZONE_X0 + 8} y={ZONE_BOT + 4} fill="#54617A" fontFamily="'JetBrains Mono', monospace" fontSize={10}>
          T = {(T_PERIOD_S * 1000).toFixed(0)} ms  ·  λ₁ = {fmtMm(lambda1)}
        </text>
      </svg>

      {/* ─── HUD ─── HTML overlays in rem (NO bottom-right) */}
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
          left: '3rem',
          marginTop: '3rem',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '1.9rem',
          letterSpacing: '0.08em',
          color: (isStage1 && stage1Done) || (isStage2 && stage2Match) ? '#37C9B8' : '#B9C4D6',
          zIndex: 5,
          pointerEvents: 'none',
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
          fontSize: '2.0rem',
          letterSpacing: '0.06em',
          color: peekVisible ? '#F9A968' : '#6C7A93',
          zIndex: 5,
          pointerEvents: 'none',
          maxWidth: '48%',
          lineHeight: 1.35,
        }}
      >
        {hudBL}
      </div>
      {/* Bottom-right INTENTIONALLY EMPTY — reserved for parent chrome. */}

      {/* ─── Slider column (HTML overlay) ─────────────────── */}
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
          label="c₁"
          unit="m/s"
          value={c1}
          min={C1_MIN}
          max={C1_MAX}
          step={0.01}
          format={(v) => v.toFixed(2)}
          onChange={(v) => {
            setC1(v)
            setC1Min((p) => Math.min(p, v))
            setC1Max((p) => Math.max(p, v))
          }}
        />
        <SliderVertical
          label="c₂"
          unit="m/s"
          value={c2}
          min={C2_MIN}
          max={C2_MAX}
          step={0.01}
          format={(v) => v.toFixed(2)}
          onChange={(v) => {
            setC2(v)
            setC2Min((p) => Math.min(p, v))
            setC2Max((p) => Math.max(p, v))
          }}
        />
        <SliderVertical
          label="i₁"
          unit="°"
          value={i1Deg}
          min={I1_MIN_DEG}
          max={I1_MAX_DEG}
          step={1}
          format={(v) => v.toFixed(0)}
          onChange={(v) => {
            setI1Deg(v)
            setI1Min((p) => Math.min(p, v))
            setI1Max((p) => Math.max(p, v))
          }}
        />
      </div>
    </div>
  )
}

// ─── Slider primitive (adapted from diffraction reference) ──
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
