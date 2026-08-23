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
  fieldMagnitudeVm,
  forceMagnitudeUN,
  formatE,
  withinTol,
} from './physics'

// ─── Scene constants ────────────────────────────────────────
const W = 800
const H = 450

// Capacitor geometry (SVG units)
const CAP_CX = 270
const CAP_CY = 225
const PLATE_TOP = 100
const PLATE_BOT = 350
const PLATE_THICK = 8
const MIN_GAP_PX = 80
const MAX_GAP_PX = 260

// Physics DOF ranges
const U_MIN = 50 // V
const U_MAX = 500 // V
const U_DEFAULT = 200 // V
const D_MIN = 0.5 // cm
const D_MAX = 5.0 // cm
const D_DEFAULT = 2.0 // cm
const Q_MIN = 1 // nC
const Q_MAX = 20 // nC
const Q_DEFAULT = 5 // nC

// Field magnitude bounds for arrow-length scaling
const E_SCALE_MIN = fieldMagnitudeVm(U_MIN, D_MAX) // 1000 V/m
const E_SCALE_MAX = fieldMagnitudeVm(U_MAX, D_MIN) // 100000 V/m
const ARROW_LEN_MIN = 8
const ARROW_LEN_MAX = 40

// Force arrow bounds (μN)
const F_SCALE_MIN = 0.5
const F_SCALE_MAX = 4000
const F_ARROW_LEN_MIN = 6
const F_ARROW_LEN_MAX = 70

// Coverage threshold for stage 1
const COVERAGE_MIN_FRAC = 0.5

// ─── Label loader ───────────────────────────────────────────
const dict = { en, fr, ar } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── Utility: log-scale mapping for arrow lengths ───────────
function logScale(value: number, vMin: number, vMax: number, oMin: number, oMax: number): number {
  const lv = Math.log(Math.max(value, vMin))
  const lMin = Math.log(vMin)
  const lMax = Math.log(vMax)
  const t = Math.min(1, Math.max(0, (lv - lMin) / (lMax - lMin)))
  return oMin + t * (oMax - oMin)
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

  // ─── DOF state ────────────────────────────────────────────
  const [U, setU] = useState(U_DEFAULT)
  const [d, setD] = useState(D_DEFAULT)
  const [q, setQ] = useState(Q_DEFAULT)
  const [peekVisible, setPeekVisible] = useState(false)

  // Stage 1 coverage tracking
  const [uMin, setUMin] = useState(U_DEFAULT)
  const [uMax, setUMax] = useState(U_DEFAULT)
  const [dMin, setDMin] = useState(D_DEFAULT)
  const [dMax, setDMax] = useState(D_DEFAULT)
  const [qMin, setQMin] = useState(Q_DEFAULT)
  const [qMax, setQMax] = useState(Q_DEFAULT)

  // Stage 3 fail-with-restart (rotates to next SETUPS entry)
  const [failCount, setFailCount] = useState(0)

  const setup = useMemo(
    () => SETUPS[(seed + failCount) % SETUPS.length]!,
    [seed, failCount],
  )

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  const resetStageState = useCallback(() => {
    setU(U_DEFAULT)
    setD(D_DEFAULT)
    setQ(Q_DEFAULT)
    setUMin(U_DEFAULT); setUMax(U_DEFAULT)
    setDMin(D_DEFAULT); setDMax(D_DEFAULT)
    setQMin(Q_DEFAULT); setQMax(Q_DEFAULT)
    setPeekVisible(false)
  }, [])

  // ─── Physics (current values) ─────────────────────────────
  const E_Vm = fieldMagnitudeVm(U, d)
  const F_uN = forceMagnitudeUN(q, E_Vm)

  // ─── Coverage (stage 1 advance) ───────────────────────────
  const covU = (uMax - uMin) / (U_MAX - U_MIN)
  const covD = (dMax - dMin) / (D_MAX - D_MIN)
  const covQ = (qMax - qMin) / (Q_MAX - Q_MIN)
  const stage1Done =
    covU >= COVERAGE_MIN_FRAC && covD >= COVERAGE_MIN_FRAC && covQ >= COVERAGE_MIN_FRAC

  // ─── Feature matches ──────────────────────────────────────
  const targetE_Vm = setup.targetE_kVm * 1000
  const stage2Match = withinTol(E_Vm, targetE_Vm)
  const stage3Match = withinTol(F_uN, setup.targetF_uN)

  const canSubmit = isStage1 ? stage1Done : isStage2 ? stage2Match : true
  // Stage 3: submit always allowed; correctness is checked on Next (fail rotates)

  useEffect(() => {
    progress(stageIdx / 3, { stage: stageIdx, canSubmit })
  }, [stageIdx, canSubmit, progress])

  useReset(() => {
    resetStageState()
    setFailCount(0)
  })

  useNext(() => {
    if (stageIdx < 3) {
      setStage(stageIdx + 1)
      resetStageState()
    } else if (stage3Match) {
      complete({ success: true })
    } else {
      // Stage 3 fail: rotate setup, reset DOFs.
      setFailCount((n) => n + 1)
      resetStageState()
    }
  })

  // ─── Peek (stage 3 only — text tip, never the rendering) ──
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

  // ─── Derived layout — plate positions from d ─────────────
  const gapPx = MIN_GAP_PX + ((d - D_MIN) / (D_MAX - D_MIN)) * (MAX_GAP_PX - MIN_GAP_PX)
  const plateLeftX = CAP_CX - gapPx / 2 - PLATE_THICK
  const plateRightX = CAP_CX + gapPx / 2
  const chargeX = CAP_CX
  const chargeY = CAP_CY

  // Field arrows (grid inside gap, drawn only when visible)
  const showField = !isStage3
  const fieldArrows = useMemo(() => {
    if (!showField) return null
    const rows = [PLATE_TOP + 40, CAP_CY, PLATE_BOT - 40]
    const cols = 4
    const arrLen = logScale(E_Vm, E_SCALE_MIN, E_SCALE_MAX, ARROW_LEN_MIN, ARROW_LEN_MAX)
    const nodes: React.ReactNode[] = []
    for (let ri = 0; ri < rows.length; ri++) {
      for (let ci = 0; ci < cols; ci++) {
        const t = (ci + 0.5) / cols
        const xStart = CAP_CX - gapPx / 2 + t * gapPx - arrLen / 2
        const y = rows[ri]!
        nodes.push(
          <g key={`fa-${ri}-${ci}`} opacity={0.85}>
            <line
              x1={xStart}
              y1={y}
              x2={xStart + arrLen - 3}
              y2={y}
              stroke="#37C9B8"
              strokeWidth={1.6}
            />
            <polygon
              points={`${xStart + arrLen},${y} ${xStart + arrLen - 5},${y - 3} ${xStart + arrLen - 5},${y + 3}`}
              fill="#37C9B8"
            />
          </g>,
        )
      }
    }
    return nodes
  }, [showField, E_Vm, gapPx])

  // Force arrow from test charge (shown when field is visible)
  const forceArrowLen = logScale(Math.max(F_uN, F_SCALE_MIN), F_SCALE_MIN, F_SCALE_MAX, F_ARROW_LEN_MIN, F_ARROW_LEN_MAX)
  const showForceArrow = !isStage3

  // ─── HUD text ────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`
  const hudTR = isStage1
    ? `U·${(covU * 100).toFixed(0)}% d·${(covD * 100).toFixed(0)}% q·${(covQ * 100).toFixed(0)}%`
    : isStage2
      ? (stage2Match ? `✓ ${labels.match_ok}` : `E = ${formatE(E_Vm)}`)
      : '' // stage 3: NO live feature readout (help)
  const hudBL = peekVisible && isStage3
    ? PEEK_TIPS[(peekIdxRef.current - 1) % PEEK_TIPS.length]!
    : (isStage1 ? labels.tip1 : isStage2 ? labels.tip2 : labels.tip3)
  // BR reserved — do not render.

  // ─── Target labels ────────────────────────────────────────
  // Stage 2 probe: label at fixed probe position (charge location).
  // Stage 3 target: F* label near test charge.
  const probeY = CAP_CY - 22

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block', userSelect: 'none' }}
      >
        {/* Solid canvas background — NO rx, NO borderRadius */}
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        {/* Bench frame */}
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
          {labels.bench}
        </text>

        {/* Capacitor plates */}
        {/* Left plate (positive) */}
        <rect
          x={plateLeftX}
          y={PLATE_TOP}
          width={PLATE_THICK}
          height={PLATE_BOT - PLATE_TOP}
          fill="#B94A4A"
        />
        <text
          x={plateLeftX + PLATE_THICK / 2}
          y={PLATE_TOP - 10}
          fill="#E39B9B"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={14}
          textAnchor="middle"
        >
          {labels.plate_pos}
        </text>
        {/* Right plate (negative) */}
        <rect
          x={plateRightX}
          y={PLATE_TOP}
          width={PLATE_THICK}
          height={PLATE_BOT - PLATE_TOP}
          fill="#3F72B0"
        />
        <text
          x={plateRightX + PLATE_THICK / 2}
          y={PLATE_TOP - 10}
          fill="#8DB5DB"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={14}
          textAnchor="middle"
        >
          {labels.plate_neg}
        </text>

        {/* Gap separation label (d) */}
        <line
          x1={plateLeftX + PLATE_THICK}
          y1={PLATE_BOT + 14}
          x2={plateRightX}
          y2={PLATE_BOT + 14}
          stroke="#54617A"
          strokeWidth={0.8}
        />
        <line
          x1={plateLeftX + PLATE_THICK}
          y1={PLATE_BOT + 10}
          x2={plateLeftX + PLATE_THICK}
          y2={PLATE_BOT + 18}
          stroke="#54617A"
          strokeWidth={0.8}
        />
        <line
          x1={plateRightX}
          y1={PLATE_BOT + 10}
          x2={plateRightX}
          y2={PLATE_BOT + 18}
          stroke="#54617A"
          strokeWidth={0.8}
        />
        <text
          x={(plateLeftX + PLATE_THICK + plateRightX) / 2}
          y={PLATE_BOT + 30}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={10}
          textAnchor="middle"
        >
          d = {d.toFixed(2)} cm
        </text>

        {/* Field arrows (hidden on stage 3) */}
        {fieldArrows}

        {/* Test charge */}
        <circle cx={chargeX} cy={chargeY} r={7} fill="#F97316" stroke="#E39B4E" strokeWidth={1} />
        <text
          x={chargeX + 11}
          y={chargeY + 3}
          fill="#F9A968"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={10}
        >
          {labels.charge}
        </text>

        {/* Force arrow on charge (hidden on stage 3) */}
        {showForceArrow && (
          <g>
            <line
              x1={chargeX}
              y1={chargeY}
              x2={chargeX + forceArrowLen - 4}
              y2={chargeY}
              stroke="#F97316"
              strokeWidth={2}
            />
            <polygon
              points={`${chargeX + forceArrowLen},${chargeY} ${chargeX + forceArrowLen - 6},${chargeY - 4} ${chargeX + forceArrowLen - 6},${chargeY + 4}`}
              fill="#F97316"
            />
          </g>
        )}

        {/* Stage 2 target: E* label at probe M */}
        {isStage2 && (
          <g>
            <line
              x1={chargeX - 10}
              y1={probeY}
              x2={chargeX + 40}
              y2={probeY}
              stroke="#F97316"
              strokeWidth={1}
              strokeDasharray="3 3"
              opacity={0.7}
            />
            <text
              x={chargeX + 44}
              y={probeY + 3}
              fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
            >
              E* = {setup.targetE_kVm} kV/m
            </text>
            <text
              x={chargeX - 14}
              y={probeY + 3}
              fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
              textAnchor="end"
            >
              {labels.probe}
            </text>
          </g>
        )}

        {/* Stage 3 target: F* label near the test charge */}
        {isStage3 && (
          <g>
            <circle cx={chargeX} cy={chargeY} r={13} fill="none" stroke="#F97316" strokeWidth={1.2} strokeDasharray="3 3" />
            <text
              x={chargeX + 20}
              y={chargeY - 8}
              fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={11}
            >
              F* = {setup.targetF_uN} μN
            </text>
          </g>
        )}
      </svg>

      {/* HUD overlays */}
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
      {hudTR && (
        <div
          style={{
            position: 'absolute',
            top: '3rem',
            right: '3rem',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '2.3rem',
            letterSpacing: '0.08em',
            color: stage2Match ? '#37C9B8' : '#B9C4D6',
            zIndex: 5,
            pointerEvents: 'none',
            textAlign: 'right',
          }}
        >
          {hudTR}
        </div>
      )}
      <div
        style={{
          position: 'absolute',
          bottom: '3rem',
          left: '3rem',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '2.3rem',
          letterSpacing: '0.06em',
          color: peekVisible && isStage3 ? '#F9A968' : '#6C7A93',
          zIndex: 5,
          pointerEvents: 'none',
          maxWidth: '48%',
        }}
      >
        {hudBL}
      </div>
      {/* NO bottom-right overlay — reserved for parent chrome. */}

      {/* Slider column (right side) */}
      <div
        style={{
          position: 'absolute',
          top: '4rem',
          right: '3rem',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '1.2rem',
          zIndex: 6,
        }}
      >
        <SliderVertical
          label="U"
          unit="V"
          value={U}
          min={U_MIN}
          max={U_MAX}
          step={5}
          format={(v) => v.toFixed(0)}
          onChange={(v) => {
            setU(v)
            setUMin((prev) => Math.min(prev, v))
            setUMax((prev) => Math.max(prev, v))
          }}
        />
        <SliderVertical
          label="d"
          unit="cm"
          value={d}
          min={D_MIN}
          max={D_MAX}
          step={0.05}
          format={(v) => v.toFixed(2)}
          onChange={(v) => {
            setD(v)
            setDMin((prev) => Math.min(prev, v))
            setDMax((prev) => Math.max(prev, v))
          }}
        />
        <SliderVertical
          label="q"
          unit="nC"
          value={q}
          min={Q_MIN}
          max={Q_MAX}
          step={0.1}
          format={(v) => v.toFixed(1)}
          onChange={(v) => {
            setQ(v)
            setQMin((prev) => Math.min(prev, v))
            setQMax((prev) => Math.max(prev, v))
          }}
          accent="#F97316"
        />
      </div>
    </div>
  )
}

// ─── Slider primitive (copied from diffraction reference) ───
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
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.3rem' }}>
      <div
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '1.4rem',
          color: '#54617A',
        }}
      >
        {format(max)}
      </div>
      <div
        style={{
          width: '2.5rem',
          height: '11rem',
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
            width: '11rem',
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
          fontSize: '1.4rem',
          color: '#54617A',
        }}
      >
        {format(min)}
      </div>
      <div
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '1.8rem',
          color: accent,
        }}
      >
        {label} = {format(value)}
        {unit}
      </div>
    </div>
  )
}

