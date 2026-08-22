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
  useSeed,
  useTicker,
} from '@physics/sdk/react'
import { getHintFor, getStagesFor } from './stages'
import en from '../i18n/en.json'
import fr from '../i18n/fr.json'
import ar from '../i18n/ar.json'
import { Battery } from './art/Battery'
import { Capacitor } from './art/Capacitor'
import { Resistor } from './art/Resistor'
import { Switch, type SwitchPos } from './art/Switch'

// ─── Scene constants ────────────────────────────────────────────────────
const W = 800
const H = 450

// Left panel: circuit schematic
const SCH_X = 32
const SCH_Y = 60
const SCH_W = 360
const SCH_H = 350

// Right panel: u_C(t) time-series plot
const PLOT_X = 412
const PLOT_Y = 60
const PLOT_W = 250
const PLOT_H = 350

// Physics constants
const E = 6 // V — fixed
const R_MIN = 1000 // Ω
const R_MAX = 10000 // Ω
const R_DEFAULT = 2000 // Ω
const C_MIN = 100e-6 // F (100 µF)
const C_MAX = 1000e-6 // F (1000 µF = 1 mF)
const C_DEFAULT = 300e-6 // 300 µF

// Plot horizontal extent — sized to comfortably show 5τ_max
const T_SIM_MAX = 30 // seconds

// Stage 2 seeded targets: (t*, V*/E-ratio) pairs
const STAGE2_TARGETS = [
  { tStar: 4, vRatio: 0.63 },
  { tStar: 2, vRatio: 0.5 },
  { tStar: 6, vRatio: 0.75 },
  { tStar: 3, vRatio: 0.4 },
  { tStar: 5, vRatio: 0.86 },
]
const STAGE2_TOL = 0.05 // ±5% E at t*

// Stage 3 seeded hidden τ* (via seeded R*, C* pairs)
const STAGE3_TARGETS: { rStar: number; cStar: number }[] = [
  { rStar: 3000, cStar: 400e-6 }, // τ = 1.2s
  { rStar: 5000, cStar: 300e-6 }, // τ = 1.5s
  { rStar: 2500, cStar: 800e-6 }, // τ = 2.0s
  { rStar: 6000, cStar: 500e-6 }, // τ = 3.0s
  { rStar: 4000, cStar: 200e-6 }, // τ = 0.8s
]
const STAGE3_TOL = 0.03 // ±3% on τ

const dict = { en, fr, ar } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── Physics helpers ────────────────────────────────────────────────────
/** Exact integrator step: uC evolves toward `target` (E when charging, 0 when discharging). */
function stepUc(uC: number, target: number, dtSec: number, tau: number): number {
  if (tau <= 0) return target
  const decay = Math.exp(-dtSec / tau)
  return target + (uC - target) * decay
}

/** Format τ for display (ms if <1s, else s). */
function formatTau(tau: number): string {
  if (tau < 1) return `${(tau * 1000).toFixed(0)} ms`
  return `${tau.toFixed(2)} s`
}

// ─── Log-slider mapping (linear slider position ↔ log-scaled value) ────
function toLog(value: number, min: number, max: number): number {
  return (Math.log(value) - Math.log(min)) / (Math.log(max) - Math.log(min))
}
function fromLog(pos: number, min: number, max: number): number {
  return min * Math.pow(max / min, pos)
}

// ─── Coordinate helpers for the plot ────────────────────────────────────
function tToSvgX(t: number): number {
  return PLOT_X + (t / T_SIM_MAX) * PLOT_W
}
function ucToSvgY(uc: number): number {
  const yMax = 1.05 * E
  return PLOT_Y + PLOT_H - (uc / yMax) * PLOT_H
}

function chargePathFor(tau: number): string {
  const steps = 80
  let d = ''
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * T_SIM_MAX
    const uc = E * (1 - Math.exp(-t / tau))
    const sx = tToSvgX(t)
    const sy = ucToSvgY(uc)
    d += `${i === 0 ? 'M' : 'L'} ${sx.toFixed(1)} ${sy.toFixed(1)} `
  }
  return d
}

// ─── Component ──────────────────────────────────────────────────────────
export default function Scene() {
  const { locale, seed } = useInit()
  const stages = useMemo(() => getStagesFor(locale), [locale])
  useDeclareStages(stages)
  const labels = useMemo(() => svgLabels(locale), [locale])
  const rootRng = useSeed()

  const stage2Target = useMemo(() => {
    void rootRng
    return STAGE2_TARGETS[seed % STAGE2_TARGETS.length]!
  }, [seed, rootRng])
  const stage3Target = useMemo(() => {
    return STAGE3_TARGETS[(seed + 1) % STAGE3_TARGETS.length]!
  }, [seed])

  const tauStar = stage3Target.rStar * stage3Target.cStar

  const stageIdx = useCurrentStage()
  const [R, setR] = useState(R_DEFAULT)
  const [C, setC] = useState(C_DEFAULT)
  const [switchPos, setSwitchPos] = useState<SwitchPos>('open')
  const [uC, setUc] = useState(0)
  const [tSim, setTSim] = useState(0)
  const [trace, setTrace] = useState<{ t: number; uc: number }[]>([{ t: 0, uc: 0 }])
  const [rMoved, setRMoved] = useState(false)
  const [cMoved, setCMoved] = useState(false)
  const [fullCharged, setFullCharged] = useState(false)
  const [fullDischarged, setFullDischarged] = useState(true)
  const [peekVisible, setPeekVisible] = useState(false)
  const [stage2Hit, setStage2Hit] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  const tau = R * C

  const setStage = useSetStage()
  const progress = useProgress()
  const complete = useComplete()

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  const resetStageState = useCallback(() => {
    setR(R_DEFAULT)
    setC(C_DEFAULT)
    setSwitchPos('open')
    setUc(0)
    setTSim(0)
    setTrace([{ t: 0, uc: 0 }])
    setRMoved(false)
    setCMoved(false)
    setFullCharged(false)
    setFullDischarged(true)
    setPeekVisible(false)
    setStage2Hit(false)
    setSubmitted(false)
  }, [])

  useTicker((dt) => {
    if (isStage3 && !submitted) return
    if (tSim >= T_SIM_MAX) return
    if (switchPos === 'open' && !isStage3) {
      setTSim((prev) => Math.min(prev + dt, T_SIM_MAX))
      return
    }
    const target = switchPos === 'charge' ? E : 0
    const next = stepUc(uC, target, dt, tau)
    setUc(next)
    if (isStage1) {
      if (target === E && next / E >= 0.99) setFullCharged(true)
      if (target === 0 && next / E <= 0.01) setFullDischarged(true)
    }
    if (isStage2 && !stage2Hit) {
      const { tStar, vRatio } = stage2Target
      if (Math.abs(tSim - tStar) < 0.2) {
        const vStar = vRatio * E
        if (Math.abs(next - vStar) / E < STAGE2_TOL) {
          setStage2Hit(true)
        }
      }
    }
    setTSim((prev) => {
      const nxt = Math.min(prev + dt, T_SIM_MAX)
      setTrace((prevTrace) => {
        const last = prevTrace[prevTrace.length - 1]
        if (last && nxt - last.t < 0.03) return prevTrace
        return [...prevTrace, { t: nxt, uc: next }]
      })
      return nxt
    })
  })

  const canSubmit = isStage1
    ? fullCharged && fullDischarged && rMoved && cMoved
    : isStage2
      ? stage2Hit
      : submitted && Math.abs(tau - tauStar) / tauStar < STAGE3_TOL

  const readout = isStage1
    ? `u_C = ${uC.toFixed(2)} V · τ = ${formatTau(tau)}`
    : isStage2
      ? stage2Hit
        ? `${labels.hit} · τ = ${formatTau(tau)}`
        : `τ = ${formatTau(tau)}`
      : submitted
        ? Math.abs(tau - tauStar) / tauStar < STAGE3_TOL
          ? `${labels.match_ok} · τ = ${formatTau(tau)}`
          : `${labels.match_off} · Δτ = ${(100 * Math.abs(tau - tauStar) / tauStar).toFixed(1)}%`
        : `τ = ${formatTau(tau)}`

  useEffect(() => {
    progress(stageIdx / 3, { stage: stageIdx, canSubmit, readout })
  }, [stageIdx, canSubmit, readout, progress])

  useReset(resetStageState)

  useNext(() => {
    if (stageIdx < 3) {
      setStage(stageIdx + 1)
      resetStageState()
    } else {
      complete({ success: true })
    }
  })

  usePeek(() => {
    if (!isStage3) return
    setPeekVisible(true)
  })
  useEffect(() => {
    if (!peekVisible) return
    const t = setTimeout(() => setPeekVisible(false), 1500)
    return () => clearTimeout(t)
  }, [peekVisible])

  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  const cycleSwitch = useCallback(() => {
    setSwitchPos((prev) => (prev === 'open' ? 'charge' : prev === 'charge' ? 'discharge' : 'open'))
  }, [])

  const submitStage3 = useCallback(() => {
    setSubmitted(true)
    setSwitchPos('charge')
    setUc(0)
    setTSim(0)
    setTrace([{ t: 0, uc: 0 }])
  }, [])

  // ─── Circuit schematic geometry ──────────────────────────────────────
  const rect = {
    left: SCH_X + 40,
    right: SCH_X + SCH_W - 40,
    top: SCH_Y + 80,
    bottom: SCH_Y + SCH_H - 80,
  }
  const topMid = (rect.left + rect.right) / 2
  const switchPivot = { x: topMid, y: rect.top - 8 }
  const battery = { x: rect.left, y: (rect.top + rect.bottom) / 2 }
  const resistor = { x: (topMid + rect.right) / 2 + 20, y: rect.top }
  const capacitor = { x: rect.right, y: (rect.top + rect.bottom) / 2 }
  // Discharge branch hits the bottom rail at this x (splits bottom-h into left/right halves)
  const dischargeBottomX = switchPivot.x + 22

  const wireStroke = '#54617A'
  const wireW = 1.6
  const chargeColor = '#37C9B8'
  const dischargeColor = '#F97316'

  // Phase-aware color for a given wire segment
  const chargeActive = switchPos === 'charge'
  const dischargeActive = switchPos === 'discharge'
  const inChargeLoop = (seg: string) =>
    seg === 'left-vert' ||
    seg === 'top-left-h' ||
    seg === 'switch-common' ||
    seg === 'top-h' ||
    seg === 'right-vert' ||
    seg === 'bottom-left-h' ||
    seg === 'bottom-right-h'
  const inDischargeLoop = (seg: string) =>
    seg === 'switch-common' ||
    seg === 'top-h' ||
    seg === 'right-vert' ||
    seg === 'bottom-right-h' ||
    seg === 'discharge-branch'
  function wireColor(seg: string): string {
    if (chargeActive && inChargeLoop(seg)) return chargeColor
    if (dischargeActive && inDischargeLoop(seg)) return dischargeColor
    return wireStroke
  }
  function wireWidth(seg: string): number {
    if (chargeActive && inChargeLoop(seg)) return wireW + 0.8
    if (dischargeActive && inDischargeLoop(seg)) return wireW + 0.8
    return wireW
  }

  // Flow-path SVG `d` strings for animated current dots.
  // Small "seams" through the battery and capacitor are visually inside the
  // component symbols and read as continuous flow.
  const chargeFlowD = [
    // Start at battery+ (top plate), go up to top-left corner
    `M ${rect.left} ${battery.y - 3}`,
    `L ${rect.left} ${rect.top}`,
    // across to switch left contact, through pivot, down to top wire
    `L ${switchPivot.x - 22} ${switchPivot.y - 10}`,
    `L ${switchPivot.x} ${switchPivot.y}`,
    `L ${switchPivot.x} ${rect.top}`,
    // across top past R to top-right corner
    `L ${rect.right} ${rect.top}`,
    // down right side to cap top
    `L ${rect.right} ${capacitor.y - 4}`,
    // jump across cap
    `M ${rect.right} ${capacitor.y + 4}`,
    // continue down to bottom-right, across bottom to bottom-left, up to battery−
    `L ${rect.right} ${rect.bottom}`,
    `L ${rect.left} ${rect.bottom}`,
    `L ${rect.left} ${battery.y + 3}`,
  ].join(' ')

  const dischargeFlowD = [
    // Start at cap top (positive side of cap), go up to top-right corner
    `M ${rect.right} ${capacitor.y - 4}`,
    `L ${rect.right} ${rect.top}`,
    // across (right → left) past R to switch pivot
    `L ${switchPivot.x} ${rect.top}`,
    `L ${switchPivot.x} ${switchPivot.y}`,
    // through switch to discharge contact, down to bottom rail
    `L ${switchPivot.x + 22} ${switchPivot.y - 10}`,
    `L ${dischargeBottomX} ${rect.bottom}`,
    // across bottom (right portion) to bottom-right corner
    `L ${rect.right} ${rect.bottom}`,
    // up right side to cap bottom
    `L ${rect.right} ${capacitor.y + 4}`,
  ].join(' ')

  const plotGrid: React.ReactNode[] = []
  for (let i = 1; i < 5; i++) {
    const gx = PLOT_X + (i / 5) * PLOT_W
    plotGrid.push(
      <line key={`vx${i}`} x1={gx} y1={PLOT_Y} x2={gx} y2={PLOT_Y + PLOT_H} stroke="#12203a" strokeWidth={1} />,
    )
  }
  for (let i = 1; i < 5; i++) {
    const gy = PLOT_Y + (i / 5) * PLOT_H
    plotGrid.push(
      <line key={`gy${i}`} x1={PLOT_X} y1={gy} x2={PLOT_X + PLOT_W} y2={gy} stroke="#12203a" strokeWidth={1} />,
    )
  }

  const tracePath = useMemo(() => {
    if (isStage3 && !submitted) return ''
    if (trace.length < 2) return ''
    let d = ''
    for (let i = 0; i < trace.length; i++) {
      const p = trace[i]!
      const sx = tToSvgX(p.t)
      const sy = ucToSvgY(p.uc)
      d += `${i === 0 ? 'M' : 'L'} ${sx.toFixed(1)} ${sy.toFixed(1)} `
    }
    return d
  }, [trace, isStage3, submitted])

  const stage2TargetPath = useMemo(() => {
    if (!isStage2) return ''
    const { tStar, vRatio } = stage2Target
    const targetTau = -tStar / Math.log(1 - vRatio)
    return chargePathFor(targetTau)
  }, [isStage2, stage2Target])

  const stage3TargetPath = useMemo(() => {
    if (!isStage3) return ''
    return chargePathFor(tauStar)
  }, [isStage3, tauStar])

  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`
  const hudTR = isStage3
    ? peekVisible
      ? `${labels.peek_reveal} τ* = ${formatTau(tauStar)}`
      : `τ* = ?`
    : `τ = ${formatTau(tau)}`
  const hudBL = isStage1 ? labels.tip1 : isStage2 ? labels.tip2 : labels.tip3
  const hudBR = isStage1
    ? `u_C = ${uC.toFixed(2)} V / ${E} V`
    : isStage2
      ? stage2Hit
        ? `✓ ${labels.hit}`
        : `${labels.target_short}: t* = ${stage2Target.tStar}s, V* = ${(stage2Target.vRatio * E).toFixed(2)}V`
      : submitted && Math.abs(tau - tauStar) / tauStar < STAGE3_TOL
        ? `✓ ${labels.match_ok}`
        : submitted
          ? `Δτ = ${(100 * Math.abs(tau - tauStar) / tauStar).toFixed(1)}%`
          : ''

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block', userSelect: 'none' }}
      >
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        {/* ─── Left panel: circuit schematic ─────────────────────────── */}
        <rect
          x={SCH_X - 8}
          y={SCH_Y - 8}
          width={SCH_W + 16}
          height={SCH_H + 16}
          fill="none"
          stroke="#12203a"
          strokeWidth={1}
          rx={6}
        />
        <text
          x={SCH_X}
          y={SCH_Y - 14}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={11}
          letterSpacing="0.1em"
        >
          {labels.circuit}
        </text>

        {/* Left vertical (battery+ up to top-left corner, and battery- down to bottom-left) */}
        <line
          x1={rect.left} y1={battery.y - 3} x2={rect.left} y2={rect.top}
          stroke={wireColor('left-vert')} strokeWidth={wireWidth('left-vert')}
        />
        <line
          x1={rect.left} y1={rect.bottom} x2={rect.left} y2={battery.y + 3}
          stroke={wireColor('left-vert')} strokeWidth={wireWidth('left-vert')}
        />
        {/* Top-left horizontal (top-left corner to switch left contact) */}
        <line
          x1={rect.left} y1={rect.top} x2={switchPivot.x - 22} y2={switchPivot.y - 10}
          stroke={wireColor('top-left-h')} strokeWidth={wireWidth('top-left-h')}
        />
        {/* Discharge branch (switch discharge contact down to bottom rail) */}
        <line
          x1={dischargeBottomX} y1={switchPivot.y - 10}
          x2={dischargeBottomX} y2={rect.bottom}
          stroke={wireColor('discharge-branch')} strokeWidth={wireWidth('discharge-branch')}
        />
        {/* Switch-common down (pivot to top rail) */}
        <line
          x1={switchPivot.x} y1={switchPivot.y} x2={switchPivot.x} y2={rect.top}
          stroke={wireColor('switch-common')} strokeWidth={wireWidth('switch-common')}
        />
        {/* Top rail (switch pivot across through R to top-right corner) */}
        <line
          x1={switchPivot.x} y1={rect.top} x2={resistor.x - 22} y2={rect.top}
          stroke={wireColor('top-h')} strokeWidth={wireWidth('top-h')}
        />
        <line
          x1={resistor.x + 22} y1={rect.top} x2={rect.right} y2={rect.top}
          stroke={wireColor('top-h')} strokeWidth={wireWidth('top-h')}
        />
        {/* Right vertical (top-right corner down through cap to bottom-right corner) */}
        <line
          x1={rect.right} y1={rect.top} x2={rect.right} y2={capacitor.y - 4}
          stroke={wireColor('right-vert')} strokeWidth={wireWidth('right-vert')}
        />
        <line
          x1={rect.right} y1={capacitor.y + 4} x2={rect.right} y2={rect.bottom}
          stroke={wireColor('right-vert')} strokeWidth={wireWidth('right-vert')}
        />
        {/* Bottom rail (split at dischargeBottomX) */}
        <line
          x1={rect.left} y1={rect.bottom} x2={dischargeBottomX} y2={rect.bottom}
          stroke={wireColor('bottom-left-h')} strokeWidth={wireWidth('bottom-left-h')}
        />
        <line
          x1={dischargeBottomX} y1={rect.bottom} x2={rect.right} y2={rect.bottom}
          stroke={wireColor('bottom-right-h')} strokeWidth={wireWidth('bottom-right-h')}
        />

        <Battery x={battery.x} y={battery.y} e={E} />
        <Resistor x={resistor.x} y={resistor.y} r={R} />
        <Capacitor x={capacitor.x} y={capacitor.y} c={C} uC={uC} e={E} />
        <g onClick={cycleSwitch} style={{ cursor: 'pointer' }}>
          <rect x={switchPivot.x - 34} y={switchPivot.y - 34} width={68} height={44} fill="transparent" />
          <Switch x={switchPivot.x} y={switchPivot.y} pos={switchPos} />
        </g>

        {/* ─── Flowing-current dots along active loop ────────────────── */}
        {chargeActive && (
          <g key="charge-flow">
            <path id="charge-flow-path" d={chargeFlowD} fill="none" stroke="none" />
            {[0, 0.5, 1.0, 1.5].map((delay) => (
              <circle key={`cf${delay}`} r={2.6} fill={chargeColor}>
                <animateMotion dur="2s" repeatCount="indefinite" begin={`${delay}s`} rotate="auto">
                  <mpath href="#charge-flow-path" />
                </animateMotion>
              </circle>
            ))}
          </g>
        )}
        {dischargeActive && (
          <g key="discharge-flow">
            <path id="discharge-flow-path" d={dischargeFlowD} fill="none" stroke="none" />
            {[0, 0.4, 0.8, 1.2].map((delay) => (
              <circle key={`df${delay}`} r={2.6} fill={dischargeColor}>
                <animateMotion dur="1.6s" repeatCount="indefinite" begin={`${delay}s`} rotate="auto">
                  <mpath href="#discharge-flow-path" />
                </animateMotion>
              </circle>
            ))}
          </g>
        )}

        {/* Switch labels */}
        <text
          x={switchPivot.x - 30}
          y={switchPivot.y - 22}
          fill={switchPos === 'charge' ? '#37C9B8' : '#54617A'}
          fontFamily="'JetBrains Mono', monospace"
          fontSize={10}
          textAnchor="end"
        >
          {labels.charge_label}
        </text>
        <text
          x={switchPivot.x + 30}
          y={switchPivot.y - 22}
          fill={switchPos === 'discharge' ? '#F97316' : '#54617A'}
          fontFamily="'JetBrains Mono', monospace"
          fontSize={10}
          textAnchor="start"
        >
          {labels.discharge_label}
        </text>
        <text
          x={switchPivot.x}
          y={SCH_Y + SCH_H - 10}
          fill="#54617A"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={10}
          textAnchor="middle"
        >
          {labels.click_switch}
        </text>

        {/* ─── Right panel: u_C(t) plot ───────────────────────────────── */}
        <rect
          x={PLOT_X - 8}
          y={PLOT_Y - 8}
          width={PLOT_W + 16}
          height={PLOT_H + 16}
          fill="none"
          stroke="#12203a"
          strokeWidth={1}
          rx={6}
        />
        <text
          x={PLOT_X}
          y={PLOT_Y - 14}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={11}
          letterSpacing="0.1em"
        >
          u_C (t)
        </text>
        {plotGrid}
        <line x1={PLOT_X} y1={PLOT_Y + PLOT_H} x2={PLOT_X + PLOT_W} y2={PLOT_Y + PLOT_H} stroke="#3A4863" strokeWidth={1.5} />
        <line x1={PLOT_X} y1={PLOT_Y} x2={PLOT_X} y2={PLOT_Y + PLOT_H} stroke="#3A4863" strokeWidth={1.5} />
        <text
          x={PLOT_X + PLOT_W - 6}
          y={PLOT_Y + PLOT_H + 18}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={10}
          textAnchor="end"
        >
          t (s) →
        </text>
        <text
          transform={`rotate(-90 ${PLOT_X - 18} ${PLOT_Y + 6})`}
          x={PLOT_X - 18}
          y={PLOT_Y + 6}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={10}
          textAnchor="end"
        >
          u_C (V) →
        </text>
        {[0, 10, 20, 30].map((tv) => (
          <text
            key={`tk${tv}`}
            x={tToSvgX(tv)}
            y={PLOT_Y + PLOT_H + 14}
            fill="#54617A"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={9}
            textAnchor="middle"
          >
            {tv}
          </text>
        ))}
        {[0, E / 2, E].map((v) => (
          <text
            key={`uk${v}`}
            x={PLOT_X - 6}
            y={ucToSvgY(v) + 3}
            fill="#54617A"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={9}
            textAnchor="end"
          >
            {v.toFixed(v === Math.round(v) ? 0 : 1)}
          </text>
        ))}
        {/* Stage 1 canonical markers */}
        {isStage1 && (
          <>
            <line
              x1={PLOT_X}
              y1={ucToSvgY(E)}
              x2={PLOT_X + PLOT_W}
              y2={ucToSvgY(E)}
              stroke="#37C9B8"
              strokeWidth={1}
              strokeDasharray="3 4"
              opacity={0.35}
            />
            <line
              x1={PLOT_X}
              y1={ucToSvgY(0.63 * E)}
              x2={PLOT_X + PLOT_W}
              y2={ucToSvgY(0.63 * E)}
              stroke="#F9A968"
              strokeWidth={1}
              strokeDasharray="3 4"
              opacity={0.4}
            />
            <text
              x={PLOT_X + PLOT_W - 4}
              y={ucToSvgY(0.63 * E) - 4}
              fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={9}
              textAnchor="end"
            >
              0.63·E
            </text>
            {tau <= T_SIM_MAX && (
              <>
                <line
                  x1={tToSvgX(tau)}
                  y1={PLOT_Y}
                  x2={tToSvgX(tau)}
                  y2={PLOT_Y + PLOT_H}
                  stroke="#F9A968"
                  strokeWidth={1}
                  strokeDasharray="3 4"
                  opacity={0.4}
                />
                <text
                  x={tToSvgX(tau)}
                  y={PLOT_Y - 4}
                  fill="#F9A968"
                  fontFamily="'JetBrains Mono', monospace"
                  fontSize={9}
                  textAnchor="middle"
                >
                  τ
                </text>
              </>
            )}
          </>
        )}
        {isStage2 && (
          <>
            <path d={stage2TargetPath} fill="none" stroke="#F97316" strokeWidth={1.6} opacity={0.6} strokeDasharray="4 5" />
            <g>
              <circle cx={tToSvgX(stage2Target.tStar)} cy={ucToSvgY(stage2Target.vRatio * E)} r={6} fill="#F97316" />
              <circle
                cx={tToSvgX(stage2Target.tStar)}
                cy={ucToSvgY(stage2Target.vRatio * E)}
                r={11}
                fill="none"
                stroke="#F97316"
                strokeWidth={1}
                opacity={0.5}
              />
              <line
                x1={tToSvgX(stage2Target.tStar)}
                y1={PLOT_Y + PLOT_H}
                x2={tToSvgX(stage2Target.tStar)}
                y2={ucToSvgY(stage2Target.vRatio * E)}
                stroke="#F97316"
                strokeWidth={0.8}
                strokeDasharray="2 3"
                opacity={0.4}
              />
              <text
                x={tToSvgX(stage2Target.tStar)}
                y={PLOT_Y + PLOT_H + 26}
                fill="#F9A968"
                fontFamily="'JetBrains Mono', monospace"
                fontSize={10}
                textAnchor="middle"
              >
                t* = {stage2Target.tStar}s
              </text>
              <text
                x={PLOT_X - 6}
                y={ucToSvgY(stage2Target.vRatio * E) + 3}
                fill="#F9A968"
                fontFamily="'JetBrains Mono', monospace"
                fontSize={10}
                textAnchor="end"
              >
                V*={(stage2Target.vRatio * E).toFixed(1)}
              </text>
            </g>
          </>
        )}
        {isStage3 && (
          <path d={stage3TargetPath} fill="none" stroke="#F97316" strokeWidth={2} opacity={0.9} />
        )}
        {isStage3 && peekVisible && (
          <>
            <line
              x1={tToSvgX(tauStar)}
              y1={PLOT_Y}
              x2={tToSvgX(tauStar)}
              y2={PLOT_Y + PLOT_H}
              stroke="#37C9B8"
              strokeWidth={1}
              strokeDasharray="3 4"
              opacity={0.6}
            />
            <text
              x={tToSvgX(tauStar)}
              y={PLOT_Y - 4}
              fill="#37C9B8"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={9}
              textAnchor="middle"
            >
              τ* = {formatTau(tauStar)}
            </text>
          </>
        )}
        {tracePath && (
          <path d={tracePath} fill="none" stroke="#37C9B8" strokeWidth={2} />
        )}
        {!isStage3 && switchPos !== 'open' && (
          <line
            x1={tToSvgX(tSim)}
            y1={PLOT_Y}
            x2={tToSvgX(tSim)}
            y2={PLOT_Y + PLOT_H}
            stroke="#F9A968"
            strokeWidth={1}
            opacity={0.3}
          />
        )}
      </svg>

      {/* ─── HUD overlays ────────────────────────────────────────────── */}
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
          color: '#37C9B8',
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
          fontSize: '2.3rem',
          letterSpacing: '0.06em',
          color: '#6C7A93',
          zIndex: 5,
          pointerEvents: 'none',
          maxWidth: '48%',
        }}
      >
        {hudBL}
      </div>
      {hudBR && (
        <div
          style={{
            position: 'absolute',
            bottom: '3rem',
            right: '3rem',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '2.3rem',
            letterSpacing: '0.08em',
            color: '#37C9B8',
            textAlign: 'right',
            zIndex: 5,
            pointerEvents: 'none',
          }}
        >
          {hudBR}
        </div>
      )}

      {/* ─── R and C vertical sliders (top-right, stacked column) ───── */}
      <div
        style={{
          position: 'absolute',
          top: '6rem',
          right: '3rem',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '2rem',
          zIndex: 6,
        }}
      >
        {/* R slider */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.6rem' }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.6rem', color: '#6C7A93' }}>
            {R_MAX / 1000}k
          </div>
          <div style={{ width: '2rem', height: '24rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <input
              type="range"
              min={0}
              max={1000}
              step={1}
              value={Math.round(toLog(R, R_MIN, R_MAX) * 1000)}
              onChange={(e) => {
                setR(fromLog(Number(e.target.value) / 1000, R_MIN, R_MAX))
                setRMoved(true)
              }}
              disabled={isStage3 && submitted}
              style={{
                width: '24rem',
                height: '2rem',
                transform: 'rotate(-90deg)',
                transformOrigin: 'center',
                accentColor: '#37C9B8',
                cursor: isStage3 && submitted ? 'not-allowed' : 'pointer',
              }}
            />
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.6rem', color: '#6C7A93' }}>
            {R_MIN / 1000}k
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.6rem', color: '#37C9B8' }}>
            R = {R >= 1000 ? `${(R / 1000).toFixed(R >= 10000 ? 0 : 1)}k` : Math.round(R)}Ω
          </div>
        </div>
        {/* C slider */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.6rem' }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.6rem', color: '#6C7A93' }}>
            {(C_MAX * 1e6).toFixed(0)}µ
          </div>
          <div style={{ width: '2rem', height: '24rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <input
              type="range"
              min={0}
              max={1000}
              step={1}
              value={Math.round(toLog(C, C_MIN, C_MAX) * 1000)}
              onChange={(e) => {
                setC(fromLog(Number(e.target.value) / 1000, C_MIN, C_MAX))
                setCMoved(true)
              }}
              disabled={isStage3 && submitted}
              style={{
                width: '24rem',
                height: '2rem',
                transform: 'rotate(-90deg)',
                transformOrigin: 'center',
                accentColor: '#37C9B8',
                cursor: isStage3 && submitted ? 'not-allowed' : 'pointer',
              }}
            />
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.6rem', color: '#6C7A93' }}>
            {(C_MIN * 1e6).toFixed(0)}µ
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.6rem', color: '#37C9B8' }}>
            C = {Math.round(C * 1e6)}µF
          </div>
        </div>
      </div>

      {/* Stage 3 only: submit button (bottom center) */}
      {isStage3 && !submitted && (
        <button
          type="button"
          onClick={submitStage3}
          style={{
            position: 'absolute',
            bottom: '10rem',
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '1.4rem 3.2rem',
            background: '#F97316',
            color: '#FFFFFF',
            border: 'none',
            borderRadius: '10rem',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '2rem',
            fontWeight: 700,
            letterSpacing: '0.12em',
            cursor: 'pointer',
            zIndex: 10,
          }}
        >
          <i className="bi bi-play-fill" style={{ marginInlineEnd: '0.6rem', fontSize: '2.2rem', verticalAlign: '-0.3rem' }} />
          {labels.submit_button}
        </button>
      )}
    </div>
  )
}
