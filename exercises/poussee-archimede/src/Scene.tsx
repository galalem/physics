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
  buoyancyN,
  featureMatchesTolerance,
  immersedFraction,
  SETUPS,
  weightN,
} from './physics'

// ─── Scene constants ────────────────────────────────────────────────────
const W = 800
const H = 450

// Beaker geometry (SVG units)
const BEAKER_X = 60
const BEAKER_Y = 90
const BEAKER_W = 350
const BEAKER_H = 300
const WALL = 6
const INNER_X = BEAKER_X + WALL              // 66
const INNER_Y = BEAKER_Y + WALL              // 96
const INNER_W = BEAKER_W - 2 * WALL          // 338
const INNER_H = BEAKER_H - WALL              // 294 (open top)
const INNER_BOTTOM = INNER_Y + INNER_H       // 390
const WATERLINE_Y = 140                      // fixed liquid level
// Block visual (fixed size so V does NOT bias the visualization)
const BLOCK_W = 90
const BLOCK_H = 100
const BLOCK_CX = INNER_X + INNER_W / 2       // 235
// A block with immersed fraction f has its bottom at:
//   y_bottom = WATERLINE_Y + f · BLOCK_H
// Clamped to the tank floor when sinking (f = 1 and block would go below floor).

// ─── DOF ranges ──────────────────────────────────────────────────────────
const V_MIN = 50, V_MAX = 500, V_DEFAULT = 200         // mL
const V_STEP = 10
const RHO_OBJ_MIN = 200, RHO_OBJ_MAX = 2000, RHO_OBJ_DEFAULT = 800   // kg/m³
const RHO_STEP = 10
const RHO_LIQ_MIN = 500, RHO_LIQ_MAX = 2000, RHO_LIQ_DEFAULT = 1000  // kg/m³

const COVERAGE_MIN_FRAC = 0.5

// ─── i18n loader ─────────────────────────────────────────────────────────
const dict = { en, fr, ar } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── Small utils ─────────────────────────────────────────────────────────
function fmtRho(v: number): string {
  return v.toFixed(0)
}
function fmtV(v: number): string {
  return v.toFixed(0)
}
function fmtN(n: number): string {
  if (n >= 100) return `${n.toFixed(0)}N`
  if (n >= 10) return `${n.toFixed(1)}N`
  return `${n.toFixed(2)}N`
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

  const [volume, setVolume] = useState(V_DEFAULT)
  const [rhoObj, setRhoObj] = useState(RHO_OBJ_DEFAULT)
  const [rhoLiq, setRhoLiq] = useState(RHO_LIQ_DEFAULT)
  const [peekVisible, setPeekVisible] = useState(false)

  // Coverage tracking
  const [vMin, setVMin] = useState(V_DEFAULT)
  const [vMax, setVMax] = useState(V_DEFAULT)
  const [roMin, setRoMin] = useState(RHO_OBJ_DEFAULT)
  const [roMax, setRoMax] = useState(RHO_OBJ_DEFAULT)
  const [rlMin, setRlMin] = useState(RHO_LIQ_DEFAULT)
  const [rlMax, setRlMax] = useState(RHO_LIQ_DEFAULT)

  // Setup rotation for stage-3 fail-with-restart
  const failCountRef = useRef(0)
  const setupIndex = (seed + failCountRef.current) % SETUPS.length
  const setup = SETUPS[setupIndex]!

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  const resetStageState = useCallback(() => {
    setVolume(V_DEFAULT)
    setRhoObj(RHO_OBJ_DEFAULT)
    setRhoLiq(RHO_LIQ_DEFAULT)
    setVMin(V_DEFAULT); setVMax(V_DEFAULT)
    setRoMin(RHO_OBJ_DEFAULT); setRoMax(RHO_OBJ_DEFAULT)
    setRlMin(RHO_LIQ_DEFAULT); setRlMax(RHO_LIQ_DEFAULT)
    setPeekVisible(false)
  }, [])
  useReset(resetStageState)

  // Coverage fractions
  const covV = (vMax - vMin) / (V_MAX - V_MIN)
  const covRo = (roMax - roMin) / (RHO_OBJ_MAX - RHO_OBJ_MIN)
  const covRl = (rlMax - rlMin) / (RHO_LIQ_MAX - RHO_LIQ_MIN)
  const stage1Done = covV >= COVERAGE_MIN_FRAC
    && covRo >= COVERAGE_MIN_FRAC
    && covRl >= COVERAGE_MIN_FRAC

  // Feature
  const fraction = immersedFraction(rhoObj, rhoLiq)
  const featureMatch = featureMatchesTolerance(fraction, setup.targetFraction)
  const isFloating = rhoObj < rhoLiq
  const P = weightN(rhoObj, volume)
  const Pi = buoyancyN(rhoObj, rhoLiq, volume)

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
      // Stage 3 fail: rotate to next setup, reset sliders.
      failCountRef.current += 1
      resetStageState()
    }
  })

  // Peek: text-only strategy tip (blind stage). Rotates through 2 tips.
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

  // ─── Block visual geometry (stages 1+2 only) ────────────────────────
  // Block bottom y: WATERLINE + fraction · BLOCK_H, clamped so the block
  // sits on the tank floor when it would otherwise go through it.
  const blockBottomY = Math.min(
    WATERLINE_Y + fraction * BLOCK_H,
    INNER_BOTTOM,
  )
  const blockTopY = blockBottomY - BLOCK_H
  // Fraction submerged actually displayed (respects the floor clamp):
  const shownSubmergedY0 = Math.max(blockTopY, WATERLINE_Y)
  const shownSubmergedH = blockBottomY - shownSubmergedY0
  const objectShown = !isStage3

  // Target line y (stages 2+3): where the block bottom lands when
  // fraction == targetFraction (block visual identical).
  const targetBottomY = WATERLINE_Y + setup.targetFraction * BLOCK_H

  // ─── HUD text ────────────────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`

  // TR: stage-specific readouts (required info, never live match feedback on s3).
  const hudTR = isStage1
    ? `V·${(covV * 100).toFixed(0)}% ρo·${(covRo * 100).toFixed(0)}% ρl·${(covRl * 100).toFixed(0)}%`
    : isStage2
      ? `ρo=${fmtRho(rhoObj)} ρl=${fmtRho(rhoLiq)} V=${fmtV(volume)}`
      : `ρo=${fmtRho(rhoObj)} ρl=${fmtRho(rhoLiq)} V=${fmtV(volume)}`

  // BL: tip / peek. Peek only in stage 3.
  const hudBL = peekVisible
    ? PEEK_TIPS[(peekIdxRef.current - 1) % PEEK_TIPS.length]!
    : isStage1
      ? labels.tip1
      : isStage2
        ? labels.tip2
        : labels.tip3

  // BR: reserved for parent chrome (fullscreen). No HUD overlay here.

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block', userSelect: 'none' }}
      >
        {/* NO borderRadius on <svg>. NO rx on the bg <rect>. */}
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        {/* Scene frame */}
        <rect x={32} y={60} width={720} height={358} fill="none" stroke="#12203a" strokeWidth={1} rx={6} />
        <text x={40} y={52} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={11} letterSpacing="0.1em">
          {labels.bench}
        </text>

        {/* Beaker walls (open-top U shape) */}
        {/* Left wall */}
        <rect x={BEAKER_X} y={BEAKER_Y} width={WALL} height={BEAKER_H} fill="#3A4863" />
        {/* Right wall */}
        <rect x={BEAKER_X + BEAKER_W - WALL} y={BEAKER_Y} width={WALL} height={BEAKER_H} fill="#3A4863" />
        {/* Bottom */}
        <rect x={BEAKER_X} y={BEAKER_Y + BEAKER_H - WALL} width={BEAKER_W} height={WALL} fill="#3A4863" />
        {/* Rim ticks */}
        <line x1={BEAKER_X - 8} y1={BEAKER_Y} x2={BEAKER_X} y2={BEAKER_Y} stroke="#54617A" strokeWidth={1} />
        <line x1={BEAKER_X + BEAKER_W} y1={BEAKER_Y} x2={BEAKER_X + BEAKER_W + 8} y2={BEAKER_Y} stroke="#54617A" strokeWidth={1} />
        <text x={BEAKER_X + BEAKER_W / 2} y={BEAKER_Y - 10} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={10} textAnchor="middle">
          {labels.beaker}
        </text>

        {/* Liquid fill (from waterline down to floor) */}
        <rect
          x={INNER_X}
          y={WATERLINE_Y}
          width={INNER_W}
          height={INNER_BOTTOM - WATERLINE_Y}
          fill="#1E4870"
          opacity={0.85}
        />
        {/* Waterline surface highlight */}
        <line x1={INNER_X} y1={WATERLINE_Y} x2={INNER_X + INNER_W} y2={WATERLINE_Y} stroke="#5FA4D8" strokeWidth={1.2} />
        <text x={INNER_X + INNER_W + 12} y={WATERLINE_Y + 4} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={9}>
          {labels.waterline}
        </text>

        {/* Target waterline (stages 2 + 3) — where the block bottom should land */}
        {(isStage2 || isStage3) && (
          <g>
            <line
              x1={INNER_X - 6}
              y1={targetBottomY}
              x2={INNER_X + INNER_W + 6}
              y2={targetBottomY}
              stroke="#F97316"
              strokeWidth={1.5}
              strokeDasharray="6 4"
              opacity={0.85}
            />
            <text
              x={INNER_X + INNER_W + 12}
              y={targetBottomY + 4}
              fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
            >
              f* = {(setup.targetFraction * 100).toFixed(0)}%
            </text>
            <text
              x={INNER_X + INNER_W + 12}
              y={targetBottomY + 16}
              fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={8}
            >
              {labels.target_waterline}
            </text>
          </g>
        )}

        {/* Block (stages 1 + 2 only — hidden on stage 3) */}
        {objectShown && (
          <g>
            {/* Block body */}
            <rect
              x={BLOCK_CX - BLOCK_W / 2}
              y={blockTopY}
              width={BLOCK_W}
              height={BLOCK_H}
              fill="#B27B4C"
              stroke="#7A5230"
              strokeWidth={1.2}
              rx={2}
            />
            {/* Submerged portion overlay — darker tint below waterline */}
            {shownSubmergedH > 0 && (
              <rect
                x={BLOCK_CX - BLOCK_W / 2}
                y={shownSubmergedY0}
                width={BLOCK_W}
                height={shownSubmergedH}
                fill="#0D1524"
                opacity={0.25}
              />
            )}
            <text
              x={BLOCK_CX}
              y={blockTopY - 6}
              fill="#6C7A93"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={9}
              textAnchor="middle"
            >
              {labels.block}
            </text>

            {/* Force arrows (stages 1+2 only) */}
            {/* Weight P: pointing down from block center */}
            <g>
              <line
                x1={BLOCK_CX}
                y1={(blockTopY + blockBottomY) / 2}
                x2={BLOCK_CX}
                y2={(blockTopY + blockBottomY) / 2 + 44}
                stroke="#F87171"
                strokeWidth={2}
              />
              <polygon
                points={`${BLOCK_CX - 5},${(blockTopY + blockBottomY) / 2 + 40} ${BLOCK_CX + 5},${(blockTopY + blockBottomY) / 2 + 40} ${BLOCK_CX},${(blockTopY + blockBottomY) / 2 + 50}`}
                fill="#F87171"
              />
              <text
                x={BLOCK_CX + 10}
                y={(blockTopY + blockBottomY) / 2 + 50}
                fill="#F87171"
                fontFamily="'JetBrains Mono', monospace"
                fontSize={10}
              >
                {labels.weight_arrow} = {fmtN(P)}
              </text>
            </g>
            {/* Buoyancy Π: pointing up from block center */}
            <g>
              <line
                x1={BLOCK_CX - 24}
                y1={(blockTopY + blockBottomY) / 2}
                x2={BLOCK_CX - 24}
                y2={(blockTopY + blockBottomY) / 2 - 44}
                stroke="#37C9B8"
                strokeWidth={2}
              />
              <polygon
                points={`${BLOCK_CX - 29},${(blockTopY + blockBottomY) / 2 - 40} ${BLOCK_CX - 19},${(blockTopY + blockBottomY) / 2 - 40} ${BLOCK_CX - 24},${(blockTopY + blockBottomY) / 2 - 50}`}
                fill="#37C9B8"
              />
              <text
                x={BLOCK_CX - 66}
                y={(blockTopY + blockBottomY) / 2 - 50}
                fill="#37C9B8"
                fontFamily="'JetBrains Mono', monospace"
                fontSize={10}
              >
                {labels.buoyancy_arrow} = {fmtN(Pi)}
              </text>
            </g>

            {/* Float / sink badge */}
            <text
              x={INNER_X + 8}
              y={INNER_BOTTOM - 10}
              fill={isFloating ? '#37C9B8' : '#F87171'}
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
              letterSpacing="0.14em"
            >
              {isFloating ? labels.float_state : labels.sink_state}
            </text>
          </g>
        )}

        {/* Stage 3: label the target coordinate more prominently since block is hidden */}
        {isStage3 && (
          <g>
            <text
              x={INNER_X + INNER_W / 2}
              y={INNER_BOTTOM + 18}
              fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={11}
              textAnchor="middle"
              letterSpacing="0.08em"
            >
              f* = {(setup.targetFraction * 100).toFixed(0)}%
            </text>
          </g>
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
        color: '#B9C4D6', zIndex: 5, pointerEvents: 'none',
        textAlign: 'right',
      }}>
        {hudTR}
      </div>
      <div style={{
        position: 'absolute', bottom: '3rem', left: '3rem',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '2.3rem', letterSpacing: '0.06em',
        color: peekVisible ? '#F9A968' : '#6C7A93',
        zIndex: 5, pointerEvents: 'none', maxWidth: '48%',
      }}>
        {hudBL}
      </div>
      {/* NO bottom-right overlay — reserved for parent chrome. */}

      {/* Slider column (right side, HTML overlay) */}
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
          label="V"
          unit="mL"
          value={volume}
          min={V_MIN}
          max={V_MAX}
          step={V_STEP}
          format={(v) => v.toFixed(0)}
          onChange={(v) => {
            setVolume(v)
            setVMin((prev) => Math.min(prev, v))
            setVMax((prev) => Math.max(prev, v))
          }}
        />
        <SliderVertical
          label="ρ_obj"
          unit=""
          value={rhoObj}
          min={RHO_OBJ_MIN}
          max={RHO_OBJ_MAX}
          step={RHO_STEP}
          format={(v) => v.toFixed(0)}
          onChange={(v) => {
            setRhoObj(v)
            setRoMin((prev) => Math.min(prev, v))
            setRoMax((prev) => Math.max(prev, v))
          }}
        />
        <SliderVertical
          label="ρ_liq"
          unit=""
          value={rhoLiq}
          min={RHO_LIQ_MIN}
          max={RHO_LIQ_MAX}
          step={RHO_STEP}
          format={(v) => v.toFixed(0)}
          onChange={(v) => {
            setRhoLiq(v)
            setRlMin((prev) => Math.min(prev, v))
            setRlMax((prev) => Math.max(prev, v))
          }}
          accent="#5FA4D8"
        />
      </div>
    </div>
  )
}

// ─── Slider primitive (adapted from diffraction reference) ──────────────
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
        {label} = {format(value)}{unit}
      </div>
    </div>
  )
}
