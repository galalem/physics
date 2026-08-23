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
  formatH,
  formatKPa,
  formatRho,
  G,
  H_DEFAULT,
  H_MAX,
  H_MIN,
  P0,
  pressureKPa,
  pressureMatches,
  pressureRelErr,
  RHO_DEFAULT,
  RHO_MAX,
  RHO_MIN,
  SETUPS,
} from './physics'

// ─── Scene constants ────────────────────────────────────────────────────
const W = 800
const H = 450

// Tank geometry (SVG units)
const TANK_X = 120
const TANK_Y_TOP = 60
const TANK_Y_BOT = 405
const TANK_W = 210
const TANK_H = TANK_Y_BOT - TANK_Y_TOP // 345 SVG units → maps to 20 m depth
// Inverse: SVG-units per meter
function yForDepth(hMeters: number): number {
  return TANK_Y_TOP + (hMeters / H_MAX) * TANK_H
}

// Scale bar (depth axis) is on the left of the tank
const SCALE_X = TANK_X - 20

// Coverage threshold
const COVERAGE_MIN_FRAC = 0.5

// ─── Label loader ──────────────────────────────────────────────────────
const dict = { en, fr, ar } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── Colormap: pressure → deep-blue single hue ─────────────────────────
// Higher pressure → deeper indigo. Anchors: 100 kPa (surface) ≈ pale cyan,
// 600 kPa (bottom of mercury tank) ≈ deep navy.
function pressureCss(kPa: number, alpha = 1): string {
  const t = Math.max(0, Math.min(1, (kPa - 100) / 500))
  // pale cyan (150, 210, 240) → deep navy (30, 60, 130)
  const r = Math.round(150 - t * 120)
  const g = Math.round(210 - t * 150)
  const b = Math.round(240 - t * 110)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
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

  // ─── DOF state ────────────────────────────────────────────────────────
  const [rho, setRho] = useState(RHO_DEFAULT)
  const [h, setH] = useState(H_DEFAULT)
  const [peekVisible, setPeekVisible] = useState(false)
  const [peekTipIdx, setPeekTipIdx] = useState(0)

  // Coverage tracking
  const [rhoMin, setRhoMin] = useState(RHO_DEFAULT)
  const [rhoMax, setRhoMax] = useState(RHO_DEFAULT)
  const [hSweepMin, setHSweepMin] = useState(H_DEFAULT)
  const [hSweepMax, setHSweepMax] = useState(H_DEFAULT)

  // Stage-3 fail-with-restart: rotate to next setup on miss
  const [failCount, setFailCount] = useState(0)

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  // Setup index (seed-indexed, rotates by failCount on stage 3 misses)
  const setup = useMemo(
    () => SETUPS[(seed + failCount) % SETUPS.length]!,
    [seed, failCount],
  )

  const resetStageState = useCallback(() => {
    setRho(RHO_DEFAULT)
    setH(H_DEFAULT)
    setRhoMin(RHO_DEFAULT); setRhoMax(RHO_DEFAULT)
    setHSweepMin(H_DEFAULT); setHSweepMax(H_DEFAULT)
    setPeekVisible(false)
    setPeekTipIdx(0)
  }, [])
  useReset(() => {
    resetStageState()
    setFailCount(0)
    setStage(1)
  })

  // ─── Coverage ────────────────────────────────────────────────────────
  const covRho = (rhoMax - rhoMin) / (RHO_MAX - RHO_MIN)
  const covH = (hSweepMax - hSweepMin) / (H_MAX - H_MIN)
  const stage1Done = covRho >= COVERAGE_MIN_FRAC && covH >= COVERAGE_MIN_FRAC

  // ─── Feature ─────────────────────────────────────────────────────────
  const pKPa = pressureKPa(rho, h)
  const targetKPa = setup.targetKPa
  const featureMatch = pressureMatches(rho, h, targetKPa)
  const relErr = pressureRelErr(rho, h, targetKPa)

  // Post-submit feedback state (stage 3 only): flashes AFTER useNext, not
  // during slider adjustment. §4.7 rule 3.
  const [postSubmit, setPostSubmit] = useState<null | { hit: boolean; errPct: number }>(null)
  useEffect(() => {
    if (!postSubmit) return
    const t = setTimeout(() => setPostSubmit(null), 2500)
    return () => clearTimeout(t)
  }, [postSubmit])

  const canSubmit = isStage1 ? stage1Done : isStage2 ? featureMatch : true // stage 3 = always submittable

  useEffect(() => {
    progress(stageIdx / stages.length, { stage: stageIdx, canSubmit })
  }, [stageIdx, canSubmit, progress, stages.length])

  useNext(() => {
    if (isStage1) {
      if (!stage1Done) return
      setStage(2)
      resetStageState()
      return
    }
    if (isStage2) {
      if (!featureMatch) return
      setStage(3)
      resetStageState()
      return
    }
    // Stage 3: single-submit
    if (featureMatch) {
      setPostSubmit({ hit: true, errPct: relErr * 100 })
      complete({ success: true })
    } else {
      // Show discrepancy briefly, rotate to next setup, reset sliders.
      setPostSubmit({ hit: false, errPct: relErr * 100 })
      setFailCount((f) => f + 1)
      // Reset DOF/coverage but stay on stage 3.
      setRho(RHO_DEFAULT)
      setH(H_DEFAULT)
      setRhoMin(RHO_DEFAULT); setRhoMax(RHO_DEFAULT)
      setHSweepMin(H_DEFAULT); setHSweepMax(H_DEFAULT)
      setPeekVisible(false)
    }
  })

  // ─── Peek (blind stage only — strategy text, never the rendering) ────
  const PEEK_TIPS = useMemo(
    () => [labels.peek_tip_formula, labels.peek_tip_anchor],
    [labels],
  )
  usePeek(() => {
    if (!isStage3) return
    setPeekTipIdx((i) => (i + 1) % PEEK_TIPS.length)
    setPeekVisible(true)
  })
  useEffect(() => {
    if (!peekVisible) return
    const t = setTimeout(() => setPeekVisible(false), 4000)
    return () => clearTimeout(t)
  }, [peekVisible])

  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  // ─── Visualization (Canvas 2D pressure gradient inside the tank) ─────
  // Hidden on stage 3 — the gradient IS the "help" per §4.7.
  const showVisualization = !isStage3
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (!showVisualization) return
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const cssW = canvas.offsetWidth
    const cssH = canvas.offsetHeight
    if (cssW === 0 || cssH === 0) return
    if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
      canvas.width = Math.round(cssW * dpr)
      canvas.height = Math.round(cssH * dpr)
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, cssW, cssH)
    // Vertical bands — each band represents a depth row.
    const BANDS = 60
    const bandH = cssH / BANDS
    for (let i = 0; i < BANDS; i++) {
      const bandDepth = ((i + 0.5) / BANDS) * H_MAX
      const kpa = (P0 + rho * G * bandDepth) / 1000
      ctx.fillStyle = pressureCss(kpa, 0.92)
      ctx.fillRect(0, i * bandH, cssW, bandH + 0.6)
    }
  }, [showVisualization, rho])

  // ─── HUD text ─────────────────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`
  const hudTR = isStage1
    ? `ρ·${(covRho * 100).toFixed(0)}% h·${(covH * 100).toFixed(0)}%`
    : `${labels.target_short}: p* = ${formatKPa(targetKPa)}`
  const hudBL = peekVisible
    ? PEEK_TIPS[peekTipIdx]!
    : isStage1
      ? labels.tip1
      : isStage2
        ? labels.tip2
        : labels.tip3
  // BR reserved — DO NOT render anything at bottom+right.

  // Probe SVG position
  const probeY = yForDepth(h)
  const probeCx = TANK_X + TANK_W / 2

  // Target-pressure ticks on the depth scale — depth where p* would be
  // reached with the CURRENT ρ. Rendered only on stage 2 (as a live "target
  // line" so student can see they need to reach that depth); on stage 3 we
  // only show the numeric target label (see hudTR).
  const targetHForCurrentRho = (targetKPa * 1000 - P0) / (rho * G) // m
  const targetInTank = targetHForCurrentRho >= H_MIN && targetHForCurrentRho <= H_MAX
  const targetYCurrent = targetInTank ? yForDepth(targetHForCurrentRho) : null

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block', userSelect: 'none' }}
      >
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        {/* Frame around scene */}
        <rect
          x={32} y={44} width={720} height={378}
          fill="none" stroke="#12203a" strokeWidth={1} rx={6}
        />
        <text
          x={40} y={36}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={11}
          letterSpacing="0.1em"
        >
          {labels.tank_label}
        </text>

        {/* ─── Tank frame ─── */}
        <rect
          x={TANK_X} y={TANK_Y_TOP}
          width={TANK_W} height={TANK_H}
          fill="#050B18"
          stroke="#3A4863"
          strokeWidth={1.4}
        />
        {/* Surface line (p₀) — always visible */}
        <line
          x1={TANK_X} y1={TANK_Y_TOP}
          x2={TANK_X + TANK_W} y2={TANK_Y_TOP}
          stroke="#54617A"
          strokeWidth={1.2}
        />
        <text
          x={TANK_X + TANK_W + 8} y={TANK_Y_TOP + 4}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={10}
        >
          {labels.surface_label}
        </text>

        {/* ─── Depth scale (SVG text ticks — always visible) ─── */}
        {[0, 5, 10, 15, 20].map((meters) => {
          const y = yForDepth(meters)
          return (
            <g key={`tick-${meters}`}>
              <line
                x1={SCALE_X - 4} y1={y}
                x2={SCALE_X + 2} y2={y}
                stroke="#54617A"
                strokeWidth={1}
              />
              <text
                x={SCALE_X - 8} y={y + 3}
                fill="#54617A"
                fontFamily="'JetBrains Mono', monospace"
                fontSize={9}
                textAnchor="end"
              >
                {meters}m
              </text>
            </g>
          )
        })}
        <text
          x={SCALE_X - 8} y={TANK_Y_TOP - 8}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={9}
          textAnchor="end"
        >
          h
        </text>

        {/* ─── Stage 2 target depth line (live, moves with ρ) ─── */}
        {isStage2 && targetYCurrent !== null && (
          <g>
            <line
              x1={TANK_X - 6} y1={targetYCurrent}
              x2={TANK_X + TANK_W + 6} y2={targetYCurrent}
              stroke="#F97316"
              strokeWidth={1}
              strokeDasharray="4 4"
              opacity={0.75}
            />
            <text
              x={TANK_X + TANK_W + 10} y={targetYCurrent + 3}
              fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
            >
              h for p*
            </text>
          </g>
        )}
        {/* If the target line falls out of tank, show an out-of-range chevron */}
        {isStage2 && !targetInTank && (
          <text
            x={TANK_X + TANK_W + 10}
            y={targetHForCurrentRho < 0 ? TANK_Y_TOP + 14 : TANK_Y_BOT - 4}
            fill="#F9A968"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={10}
          >
            {targetHForCurrentRho < 0 ? '↑ out of tank' : '↓ out of tank'}
          </text>
        )}

        {/* ─── Stage 3 target: numeric label near tank, no live depth line ─── */}
        {isStage3 && (
          <g>
            <rect
              x={TANK_X + TANK_W + 14} y={TANK_Y_TOP + 4}
              width={116} height={40}
              fill="none"
              stroke="#F97316"
              strokeWidth={1}
              strokeDasharray="4 4"
              rx={4}
            />
            <text
              x={TANK_X + TANK_W + 20} y={TANK_Y_TOP + 20}
              fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={11}
              letterSpacing="0.06em"
            >
              target
            </text>
            <text
              x={TANK_X + TANK_W + 20} y={TANK_Y_TOP + 36}
              fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={13}
            >
              p* = {formatKPa(targetKPa)}
            </text>
          </g>
        )}

        {/* ─── Probe (always shown; readout gauge hidden on stage 3) ─── */}
        <g>
          {/* Probe stem */}
          <line
            x1={TANK_X + TANK_W - 10} y1={TANK_Y_TOP}
            x2={TANK_X + TANK_W - 10} y2={probeY}
            stroke="#54617A"
            strokeWidth={1}
            strokeDasharray="2 3"
          />
          {/* Probe dot */}
          <circle cx={probeCx} cy={probeY} r={6} fill="#37C9B8" stroke="#0D1524" strokeWidth={1.5} />
          <circle cx={probeCx} cy={probeY} r={2} fill="#0D1524" />

          {/* Probe depth label — required info, ALWAYS shown */}
          <text
            x={probeCx + 12} y={probeY + 4}
            fill="#B9C4D6"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={10}
          >
            h = {formatH(h)}m
          </text>

          {/* Pressure gauge — HELP: hidden on stage 3 */}
          {!isStage3 && (
            <g>
              <rect
                x={probeCx - 42} y={probeY + 12}
                width={92} height={22}
                fill="#12203a"
                stroke="#37C9B8"
                strokeWidth={1}
                rx={4}
              />
              <text
                x={probeCx + 4} y={probeY + 27}
                fill="#37C9B8"
                fontFamily="'JetBrains Mono', monospace"
                fontSize={11}
                textAnchor="middle"
              >
                p = {formatKPa(pKPa)}
              </text>
            </g>
          )}
        </g>

        {/* ─── Post-submit feedback (stage 3 only, briefly) ─── */}
        {isStage3 && postSubmit && (
          <g>
            <rect
              x={TANK_X + 10} y={TANK_Y_BOT - 46}
              width={TANK_W - 20} height={36}
              fill={postSubmit.hit ? 'rgba(55,201,184,0.15)' : 'rgba(249,115,22,0.18)'}
              stroke={postSubmit.hit ? '#37C9B8' : '#F97316'}
              strokeWidth={1}
              rx={4}
            />
            <text
              x={TANK_X + TANK_W / 2} y={TANK_Y_BOT - 22}
              fill={postSubmit.hit ? '#37C9B8' : '#F9A968'}
              fontFamily="'JetBrains Mono', monospace"
              fontSize={11}
              textAnchor="middle"
            >
              {postSubmit.hit
                ? `match · Δp = ${postSubmit.errPct.toFixed(1)}%`
                : `miss · Δp = ${postSubmit.errPct.toFixed(1)}% · next setup`}
            </text>
          </g>
        )}
      </svg>

      {/* Canvas 2D pressure gradient — overlaid inside the tank, stages 1+2 only */}
      {showVisualization && (
        <canvas
          ref={canvasRef}
          style={{
            position: 'absolute',
            // Position the canvas overlay to cover the tank interior.
            // Values are % of the wrapper, matching the SVG viewBox proportions.
            left: `${((TANK_X + 1) / W) * 100}%`,
            top: `${((TANK_Y_TOP + 1) / H) * 100}%`,
            width: `${((TANK_W - 2) / W) * 100}%`,
            height: `${((TANK_H - 2) / H) * 100}%`,
            pointerEvents: 'none',
            zIndex: 3,
            opacity: 0.55,
          }}
        />
      )}

      {/* HUD overlays — HTML in rem */}
      <div style={{
        position: 'absolute', top: '3rem', left: '3rem',
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
        position: 'absolute', top: '3rem', right: '3rem',
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
        position: 'absolute', bottom: '3rem', left: '3rem',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '2.1rem',
        letterSpacing: '0.06em',
        color: peekVisible ? '#F9A968' : '#6C7A93',
        zIndex: 5,
        pointerEvents: 'none',
        maxWidth: '48%',
      }}>
        {hudBL}
      </div>
      {/* NO bottom-right overlay — reserved for parent chrome. */}

      {/* ─── Slider column (right side, HTML overlay) ─── */}
      <div style={{
        position: 'absolute',
        top: '10rem',
        right: '3rem',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '1.2rem',
        zIndex: 6,
      }}>
        <SliderVertical
          label="ρ"
          unit="kg/m³"
          value={rho}
          min={RHO_MIN}
          max={RHO_MAX}
          step={10}
          format={formatRho}
          onChange={(v) => {
            setRho(v)
            setRhoMin((prev) => Math.min(prev, v))
            setRhoMax((prev) => Math.max(prev, v))
          }}
        />
        <SliderVertical
          label="h"
          unit="m"
          value={h}
          min={H_MIN}
          max={H_MAX}
          step={0.05}
          format={formatH}
          onChange={(v) => {
            setH(v)
            setHSweepMin((prev) => Math.min(prev, v))
            setHSweepMax((prev) => Math.max(prev, v))
          }}
        />
      </div>
    </div>
  )
}

// ─── Slider primitive (adapted from diffraction reference) ────────────
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
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.4rem', color: '#54617A' }}>
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
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.4rem', color: '#54617A' }}>
        {format(min)}
      </div>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.8rem', color: accent }}>
        {label} = {format(value)}{unit}
      </div>
    </div>
  )
}
