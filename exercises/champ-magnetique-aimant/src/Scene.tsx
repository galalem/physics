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
  BEARING_TOL_DEG,
  SETUPS,
  bearingToSvgAngleDeg,
  bearingMatchesTolerance,
  dipoleVectorAt,
  fieldBearingAtProbe,
  normBearing,
} from './physics'

// ─── Scene constants ────────────────────────────────────────────────
const W = 800
const H = 450

// Probe (fixed) — SVG coordinates
const PROBE_X = 250
const PROBE_Y = 225
const COMPASS_R = 32       // compass ring radius (SVG units)

// Physical → SVG scale: 10 SVG units per cm.
const SVG_PER_CM = 10
const cmToSvgX = (cm: number) => PROBE_X + cm * SVG_PER_CM
const cmToSvgY = (cm: number) => PROBE_Y - cm * SVG_PER_CM

// ─── Physics DOF ranges (physical units for student-facing sliders) ──
const MX_MIN = 15   // cm, magnet center X relative to probe
const MX_MAX = 45
const MX_DEFAULT = 30
const MY_MIN = -12  // cm, magnet center Y relative to probe (up positive)
const MY_MAX = 12
const MY_DEFAULT = 0
const THETA_MIN = 0     // compass bearing (deg) that N pole points to
const THETA_MAX = 359
const THETA_DEFAULT = 90 // N points East by default

const COVERAGE_MIN_FRAC = 0.5

// Field-arrow visualization grid
const ARROW_COLS = 22
const ARROW_ROWS = 12
const ARROW_MARGIN = 24

const dict = { en, fr, ar } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── Helpers ─────────────────────────────────────────────────────────
function fmtCm(v: number): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}cm`
}
function fmtDeg(v: number): string {
  return `${v.toFixed(0)}°`
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

  // Stage 3 fail-with-restart rotates the setup index.
  const [failCount, setFailCount] = useState(0)
  const setup = useMemo(
    () => SETUPS[(seed + failCount) % SETUPS.length]!,
    [seed, failCount],
  )

  // ─── DOF state ─────────────────────────────────────────────────
  const [mxCm, setMxCm] = useState(MX_DEFAULT)
  const [myCm, setMyCm] = useState(MY_DEFAULT)
  const [thetaDeg, setThetaDeg] = useState(THETA_DEFAULT)
  const [peekVisible, setPeekVisible] = useState(false)

  // Stage 1 coverage (per DOF min/max)
  const [mxMin, setMxMin] = useState(MX_DEFAULT)
  const [mxMax, setMxMax] = useState(MX_DEFAULT)
  const [myMin, setMyMin] = useState(MY_DEFAULT)
  const [myMax, setMyMax] = useState(MY_DEFAULT)
  const [thMin, setThMin] = useState(THETA_DEFAULT)
  const [thMax, setThMax] = useState(THETA_DEFAULT)

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  const resetStageState = useCallback(() => {
    setMxCm(MX_DEFAULT)
    setMyCm(MY_DEFAULT)
    setThetaDeg(THETA_DEFAULT)
    setMxMin(MX_DEFAULT); setMxMax(MX_DEFAULT)
    setMyMin(MY_DEFAULT); setMyMax(MY_DEFAULT)
    setThMin(THETA_DEFAULT); setThMax(THETA_DEFAULT)
    setPeekVisible(false)
  }, [])
  useReset(resetStageState)

  // ─── Coverage ──────────────────────────────────────────────────
  const covMx = (mxMax - mxMin) / (MX_MAX - MX_MIN)
  const covMy = (myMax - myMin) / (MY_MAX - MY_MIN)
  const covTh = (thMax - thMin) / (THETA_MAX - THETA_MIN)
  const stage1Done =
    covMx >= COVERAGE_MIN_FRAC &&
    covMy >= COVERAGE_MIN_FRAC &&
    covTh >= COVERAGE_MIN_FRAC

  // ─── Feature: compass bearing at probe ─────────────────────────
  const mxSvg = cmToSvgX(mxCm)
  const mySvg = cmToSvgY(myCm)
  const currentBearing = fieldBearingAtProbe(
    mxSvg, mySvg, thetaDeg, PROBE_X, PROBE_Y,
  )
  const bearingMatch = bearingMatchesTolerance(currentBearing, setup.targetBearingDeg)

  // canSubmit gates the chrome's Next button:
  //  - Stage 1: all sliders swept
  //  - Stage 2: compass aligned with target (guided practice)
  //  - Stage 3: always true — single-submit fail-with-restart
  const canSubmit = isStage1 ? stage1Done : isStage2 ? bearingMatch : true

  useEffect(() => {
    progress(stageIdx / 3, { stage: stageIdx, canSubmit })
  }, [stageIdx, canSubmit, progress])

  useNext(() => {
    if (stageIdx < 3) {
      setStage(stageIdx + 1)
      resetStageState()
      return
    }
    if (bearingMatch) {
      complete({ success: true })
    } else {
      setFailCount((c) => c + 1)
      resetStageState()
    }
  })

  // ─── Peek (blind stage only — strategy tips, NEVER the rendering) ─
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

  // ─── Continuous visualization: dipole arrows on Canvas 2D ──────
  // §4.7: hidden on stage 3, even during peek. Peek is text-only.
  const showVisualization = !isStage3
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!showVisualization) return
    const canvas = canvasRef.current
    if (!canvas) return
    // The canvas is styled to fill 100% of the SVG's cell (same 800x450
    // display ratio). Match the drawing buffer to viewBox units so we
    // can draw in the same coordinate system as the SVG.
    const cssW = canvas.offsetWidth
    const cssH = canvas.offsetHeight
    if (cssW === 0 || cssH === 0) return
    const dpr = window.devicePixelRatio || 1
    const bufW = Math.round(cssW * dpr)
    const bufH = Math.round(cssH * dpr)
    if (canvas.width !== bufW || canvas.height !== bufH) {
      canvas.width = bufW
      canvas.height = bufH
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, bufW, bufH)
    // Draw in viewBox units (W × H). Map viewBox → buffer.
    const sx = bufW / W
    const sy = bufH / H
    ctx.setTransform(sx, 0, 0, sy, 0, 0)

    // Sample grid of dipole vectors → local arrows.
    const cellW = (W - 2 * ARROW_MARGIN) / (ARROW_COLS - 1)
    const cellH = (H - 2 * ARROW_MARGIN) / (ARROW_ROWS - 1)
    // Estimate a magnitude reference so alpha is stable across DOFs.
    // Sample the field at r = 20cm from magnet along its axis.
    const magRef = 1 / Math.pow(20 * SVG_PER_CM, 3)
    for (let iy = 0; iy < ARROW_ROWS; iy++) {
      for (let ix = 0; ix < ARROW_COLS; ix++) {
        const gx = ARROW_MARGIN + ix * cellW
        const gy = ARROW_MARGIN + iy * cellH
        // Skip cells that overlap the magnet body (avoid clutter).
        const ddx = gx - mxSvg
        const ddy = gy - mySvg
        if (ddx * ddx + ddy * ddy < 22 * 22) continue
        const { bx, by, magnitude } = dipoleVectorAt(mxSvg, mySvg, thetaDeg, gx, gy)
        if (magnitude === 0) continue
        const ux = bx / magnitude
        const uy = by / magnitude
        // Arrow length: fixed; alpha modulated by magnitude.
        const armLen = 8
        const x0 = gx - ux * armLen
        const y0 = gy - uy * armLen
        const x1 = gx + ux * armLen
        const y1 = gy + uy * armLen
        // Alpha: log-shape so near-field doesn't blow out and far-field
        // is still faintly visible.
        const relMag = magnitude / magRef
        const alpha = Math.min(0.55, 0.14 + 0.14 * Math.log10(1 + relMag))
        ctx.strokeStyle = `rgba(147, 210, 255, ${alpha})`
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(x0, y0)
        ctx.lineTo(x1, y1)
        ctx.stroke()
        // Arrowhead
        const headLen = 3.2
        const perpX = -uy
        const perpY = ux
        ctx.fillStyle = `rgba(147, 210, 255, ${Math.min(0.7, alpha + 0.15)})`
        ctx.beginPath()
        ctx.moveTo(x1, y1)
        ctx.lineTo(x1 - ux * headLen + perpX * headLen * 0.55,
                   y1 - uy * headLen + perpY * headLen * 0.55)
        ctx.lineTo(x1 - ux * headLen - perpX * headLen * 0.55,
                   y1 - uy * headLen - perpY * headLen * 0.55)
        ctx.closePath()
        ctx.fill()
      }
    }
  }, [showVisualization, mxSvg, mySvg, thetaDeg])

  // ─── HUD text ──────────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`
  const hudTR = isStage1
    ? `X·${(covMx * 100).toFixed(0)}% Y·${(covMy * 100).toFixed(0)}% θ·${(covTh * 100).toFixed(0)}%`
    : isStage2
      ? bearingMatch
        ? `✓ ${labels.match_ok}`
        : `${labels.target}: ${setup.targetLabel} (${fmtDeg(setup.targetBearingDeg)})`
      : `${labels.target}: ${setup.targetLabel} (${fmtDeg(setup.targetBearingDeg)})`
  const hudBL = peekVisible
    ? PEEK_TIPS[(peekIdxRef.current - 1) % PEEK_TIPS.length]!
    : (isStage1 ? labels.tip1 : isStage2 ? labels.tip2 : labels.tip3)
  // BR reserved — NO overlay.

  // ─── Compass / needle geometry ─────────────────────────────────
  // Needle points along the local B bearing on stages 1 & 2 (help).
  // Hidden on stage 3 (§4.7).
  const needleSvgAngle = bearingToSvgAngleDeg(currentBearing)
  const showNeedle = !isStage3

  // Target arrow (on stages 2, 3): orange arrow inside compass ring
  // pointing at the target bearing. Required info.
  const targetSvgAngle = bearingToSvgAngleDeg(setup.targetBearingDeg)
  const showTargetArrow = isStage2 || isStage3

  // Magnet geometry: bar rotated by θ_svg around (mxSvg, mySvg).
  const magSvgAngle = bearingToSvgAngleDeg(thetaDeg)

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block', userSelect: 'none' }}
      >
        {/* NO borderRadius on <svg>. NO rx on the bg <rect>. */}
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        {/* Workspace frame */}
        <rect
          x={16} y={40}
          width={W - 32} height={H - 56}
          fill="none" stroke="#12203a" strokeWidth={1} rx={6}
        />
        <text
          x={24} y={32}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={11} letterSpacing="0.1em"
        >
          {labels.workspace}
        </text>

        {/* Faint reference grid at the compass — 4 cardinals */}
        <g opacity={0.35}>
          <line x1={16} y1={PROBE_Y} x2={W - 16} y2={PROBE_Y} stroke="#1A2A48" strokeWidth={1} strokeDasharray="2 6" />
          <line x1={PROBE_X} y1={40} x2={PROBE_X} y2={H - 16} stroke="#1A2A48" strokeWidth={1} strokeDasharray="2 6" />
        </g>
      </svg>

      {/* Canvas 2D dipole-arrow overlay — stage 1 & 2 only */}
      {showVisualization && (
        <canvas
          ref={canvasRef}
          style={{
            position: 'absolute',
            top: 0, left: 0,
            width: '100%', height: '100%',
            pointerEvents: 'none',
            zIndex: 2,
          }}
        />
      )}

      {/* SVG top-layer — magnet, compass, target arrow, labels */}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{
          position: 'absolute',
          top: 0, left: 0,
          width: '100%', height: '100%',
          pointerEvents: 'none',
          zIndex: 3,
          display: 'block',
        }}
      >
        {/* ─── Bar magnet (rotated N/S bar centered at (mxSvg, mySvg)) ── */}
        <g transform={`translate(${mxSvg} ${mySvg}) rotate(${magSvgAngle})`}>
          {/* body: from -40 to +40 along local x-axis; N pole at +x end */}
          <rect x={-40} y={-11} width={40} height={22} fill="#3E6BFF" stroke="#7FA0FF" strokeWidth={1} rx={2} />
          <rect x={0} y={-11} width={40} height={22} fill="#FF5252" stroke="#FF8A8A" strokeWidth={1} rx={2} />
          <text x={-20} y={4} textAnchor="middle"
                fontFamily="'JetBrains Mono', monospace"
                fontSize={12} fill="#FFFFFF" fontWeight={600}>
            S
          </text>
          <text x={20} y={4} textAnchor="middle"
                fontFamily="'JetBrains Mono', monospace"
                fontSize={12} fill="#FFFFFF" fontWeight={600}>
            N
          </text>
        </g>

        {/* ─── Compass at probe ─────────────────────────────────── */}
        {/* Ring */}
        <circle
          cx={PROBE_X} cy={PROBE_Y} r={COMPASS_R}
          fill="#0A1220" stroke="#54617A" strokeWidth={1.2}
        />
        {/* Cardinal marks */}
        <text x={PROBE_X} y={PROBE_Y - COMPASS_R - 4} textAnchor="middle"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={9} fill="#B9C4D6">
          {labels.n}
        </text>
        <text x={PROBE_X + COMPASS_R + 8} y={PROBE_Y + 3} textAnchor="middle"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={9} fill="#6C7A93">
          {labels.e}
        </text>
        <text x={PROBE_X} y={PROBE_Y + COMPASS_R + 12} textAnchor="middle"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={9} fill="#6C7A93">
          {labels.s}
        </text>
        <text x={PROBE_X - COMPASS_R - 8} y={PROBE_Y + 3} textAnchor="middle"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={9} fill="#6C7A93">
          {labels.w}
        </text>
        {/* Center dot (probe) */}
        <circle cx={PROBE_X} cy={PROBE_Y} r={1.6} fill="#B9C4D6" />

        {/* Target arrow (stages 2, 3) — REQUIRED info */}
        {showTargetArrow && (
          <g transform={`translate(${PROBE_X} ${PROBE_Y}) rotate(${targetSvgAngle})`}>
            {/* Arrow points along +x local before rotation, i.e. bearing E, then rotates. */}
            <line x1={0} y1={0} x2={COMPASS_R - 4} y2={0}
                  stroke="#F97316" strokeWidth={1.8} strokeDasharray="3 3" />
            <polygon
              points={`${COMPASS_R - 4},0 ${COMPASS_R - 10},-4 ${COMPASS_R - 10},4`}
              fill="#F97316"
            />
          </g>
        )}

        {/* Live compass needle (stages 1, 2 only — HELP, hidden on stage 3) */}
        {showNeedle && (
          <g transform={`translate(${PROBE_X} ${PROBE_Y}) rotate(${needleSvgAngle})`}>
            {/* Blue tail (south end) + red head (north end) */}
            <rect x={-COMPASS_R + 6} y={-1.5} width={COMPASS_R - 6} height={3}
                  fill="#3E6BFF" />
            <rect x={0} y={-1.5} width={COMPASS_R - 6} height={3}
                  fill="#FF5252" />
            <polygon
              points={`${COMPASS_R - 6},0 ${COMPASS_R - 12},-3 ${COMPASS_R - 12},3`}
              fill="#FF5252"
            />
          </g>
        )}

        {/* Probe label */}
        <text x={PROBE_X} y={PROBE_Y + COMPASS_R + 26} textAnchor="middle"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={9} fill="#6C7A93">
          {labels.probe}
        </text>

        {/* Target coordinate label (stages 2 & 3) — REQUIRED info per §5.2.
            The student needs the target bearing to compute the parameters. */}
        {showTargetArrow && (
          <text x={PROBE_X} y={PROBE_Y + COMPASS_R + 40} textAnchor="middle"
                fontFamily="'JetBrains Mono', monospace"
                fontSize={10} fill="#F9A968">
            {labels.target_label_prefix} {setup.targetLabel} · {fmtDeg(setup.targetBearingDeg)}
          </text>
        )}
      </svg>

      {/* HUD overlays — HTML in rem */}
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
        color: (isStage2 && bearingMatch) ? '#37C9B8' : '#B9C4D6',
        zIndex: 5, pointerEvents: 'none', textAlign: 'right',
      }}>
        {hudTR}
      </div>
      <div style={{
        position: 'absolute', bottom: '3rem', left: '3rem',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '2.3rem', letterSpacing: '0.06em',
        color: peekVisible ? '#37C9B8' : '#6C7A93',
        zIndex: 5, pointerEvents: 'none', maxWidth: '48%',
      }}>
        {hudBL}
      </div>
      {/* NO bottom-right overlay — reserved for parent chrome. */}

      {/* Slider column — right edge, HTML overlay */}
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
          label="X"
          unit="cm"
          value={mxCm}
          min={MX_MIN}
          max={MX_MAX}
          step={0.5}
          format={(v) => v.toFixed(1)}
          onChange={(v) => {
            setMxCm(v)
            setMxMin((prev) => Math.min(prev, v))
            setMxMax((prev) => Math.max(prev, v))
          }}
        />
        <SliderVertical
          label="Y"
          unit="cm"
          value={myCm}
          min={MY_MIN}
          max={MY_MAX}
          step={0.5}
          format={(v) => v.toFixed(1)}
          onChange={(v) => {
            setMyCm(v)
            setMyMin((prev) => Math.min(prev, v))
            setMyMax((prev) => Math.max(prev, v))
          }}
        />
        <SliderVertical
          label="θ"
          unit="°"
          value={thetaDeg}
          min={THETA_MIN}
          max={THETA_MAX}
          step={1}
          format={(v) => v.toFixed(0)}
          onChange={(v) => {
            const nv = normBearing(v)
            setThetaDeg(nv)
            setThMin((prev) => Math.min(prev, nv))
            setThMax((prev) => Math.max(prev, nv))
          }}
        />
      </div>

      {/* Sliders footer with parameter readouts — mirrors the required
          info on stage 3. Since sliders themselves already show live
          numeric readouts, no extra HUD is needed. */}

      {/* Suppress unused-vars: fmtCm reserved for future readouts. */}
      <span style={{ display: 'none' }}>{fmtCm(0)}</span>
    </div>
  )
}

// ─── Slider primitive ──────────────────────────────────────────────
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

// Reference the tolerance constant so future tweaks land visibly.
void BEARING_TOL_DEG
