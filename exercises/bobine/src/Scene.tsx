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
import { Inductor } from './art/Inductor'
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

// Right panel: u_L(t) time-series plot
const PLOT_X = 412
const PLOT_Y = 60
const PLOT_W = 250
const PLOT_H = 350

// Physics constants
const E = 12 // V — fixed source EMF
const L_MIN = 0.5 // H
const L_MAX = 10 // H
const L_DEFAULT = 2 // H
const R_MIN = 2 // Ω
const R_MAX = 40 // Ω
const R_DEFAULT = 8 // Ω

// Plot horizontal extent — comfortable window for 5τ across the useful τ range
const T_SIM_MAX = 15 // seconds

// Stage 2 seeded targets: (t*, u_L / E ratio) pairs on the u_L(t) decay curve
const STAGE2_TARGETS = [
  { tStar: 1.0, vRatio: 0.37 }, // τ* ≈ 1.0 s (canonical τ landmark)
  { tStar: 0.5, vRatio: 0.5 }, // τ* ≈ 0.72 s
  { tStar: 2.0, vRatio: 0.3 }, // τ* ≈ 1.66 s
  { tStar: 1.5, vRatio: 0.6 }, // τ* ≈ 2.94 s
  { tStar: 0.8, vRatio: 0.2 }, // τ* ≈ 0.50 s
]
const STAGE2_TOL = 0.05 // ±5% of E at t*

// Stage 3 seeded hidden τ* (via seeded L*, R* pairs)
const STAGE3_TARGETS: { lStar: number; rStar: number }[] = [
  { lStar: 2, rStar: 4 }, // τ = 0.50 s
  { lStar: 4, rStar: 4 }, // τ = 1.00 s
  { lStar: 3, rStar: 2 }, // τ = 1.50 s
  { lStar: 6, rStar: 3 }, // τ = 2.00 s
  { lStar: 1.6, rStar: 4 }, // τ = 0.40 s
]
const STAGE3_TOL = 0.03 // ±3% on τ

const dict = { en, fr, ar } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── Physics helpers ────────────────────────────────────────────────────
/** Exact integrator step: i evolves toward `target` with time constant τ = L/R. */
function stepRelax(x: number, target: number, dtSec: number, tau: number): number {
  if (tau <= 0) return target
  const decay = Math.exp(-dtSec / tau)
  return target + (x - target) * decay
}

/** Format τ for display (ms if <1 s, else s). */
function formatTau(tau: number): string {
  if (tau < 1) return `${(tau * 1000).toFixed(0)} ms`
  return `${tau.toFixed(2)} s`
}

/** Format current i (mA if <1 A, else A). */
function formatI(i: number): string {
  if (i < 1) return `${(i * 1000).toFixed(0)} mA`
  return `${i.toFixed(2)} A`
}

// ─── Log-slider mapping ─────────────────────────────────────────────────
function toLog(value: number, min: number, max: number): number {
  return (Math.log(value) - Math.log(min)) / (Math.log(max) - Math.log(min))
}
function fromLog(pos: number, min: number, max: number): number {
  return min * Math.pow(max / min, pos)
}

// ─── Plot coordinate helpers ────────────────────────────────────────────
function tToSvgX(t: number): number {
  return PLOT_X + (t / T_SIM_MAX) * PLOT_W
}
function uToSvgY(u: number): number {
  const yMax = 1.05 * E
  return PLOT_Y + PLOT_H - (u / yMax) * PLOT_H
}

/** Closed-form u_L(t) = E · e^(-t/τ) sampled across the plot window. */
function decayPathFor(tau: number): string {
  const steps = 80
  let d = ''
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * T_SIM_MAX
    const u = E * Math.exp(-t / tau)
    const sx = tToSvgX(t)
    const sy = uToSvgY(u)
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

  const tauStar = stage3Target.lStar / stage3Target.rStar

  const stageIdx = useCurrentStage()
  const [L, setL] = useState(L_DEFAULT)
  const [R, setR] = useState(R_DEFAULT)
  const [switchPos, setSwitchPos] = useState<SwitchPos>('open')
  const [iCurrent, setICurrent] = useState(0)
  const [tSim, setTSim] = useState(0)
  const [trace, setTrace] = useState<{ t: number; u: number }[]>([{ t: 0, u: 0 }])
  const [lMoved, setLMoved] = useState(false)
  const [rMoved, setRMoved] = useState(false)
  const [fullRamp, setFullRamp] = useState(false)
  const [peekVisible, setPeekVisible] = useState(false)
  const [stage2Hit, setStage2Hit] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  const tau = L / R
  const iInf = E / R

  const setStage = useSetStage()
  const progress = useProgress()
  const complete = useComplete()

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  const resetStageState = useCallback(() => {
    setL(L_DEFAULT)
    setR(R_DEFAULT)
    setSwitchPos('open')
    setICurrent(0)
    setTSim(0)
    setTrace([{ t: 0, u: 0 }])
    setLMoved(false)
    setRMoved(false)
    setFullRamp(false)
    setPeekVisible(false)
    setStage2Hit(false)
    setSubmitted(false)
  }, [])

  useTicker((dt) => {
    // Stage 3: physics only runs after submit (to draw the reveal curve)
    if (isStage3 && !submitted) return
    if (tSim >= T_SIM_MAX) return
    // Non-stage-3 stages: pause when switch is open
    if (switchPos === 'open' && !isStage3) return

    // Exact-integrator advance of current toward its steady-state E/R
    const nextI = stepRelax(iCurrent, iInf, dt, tau)
    setICurrent(nextI)
    // Corresponding u_L via KVL: u_L = E - R·i
    const nextU = Math.max(0, E - R * nextI)

    if (isStage1) {
      if (nextI / iInf >= 0.99) setFullRamp(true)
    }
    if (isStage2 && !stage2Hit) {
      const { tStar, vRatio } = stage2Target
      if (Math.abs(tSim - tStar) < 0.2) {
        const uStar = vRatio * E
        if (Math.abs(nextU - uStar) / E < STAGE2_TOL) {
          setStage2Hit(true)
        }
      }
    }

    setTSim((prev) => {
      const nxt = Math.min(prev + dt, T_SIM_MAX)
      setTrace((prevTrace) => {
        const last = prevTrace[prevTrace.length - 1]
        if (last && nxt - last.t < 0.03) return prevTrace
        return [...prevTrace, { t: nxt, u: nextU }]
      })
      return nxt
    })
  })

  const canSubmit = isStage1
    ? fullRamp && lMoved && rMoved
    : isStage2
      ? stage2Hit
      : submitted && Math.abs(tau - tauStar) / tauStar < STAGE3_TOL

  useEffect(() => {
    progress(stageIdx / 3, { stage: stageIdx, canSubmit })
  }, [stageIdx, canSubmit, progress])

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
    const t = setTimeout(() => setPeekVisible(false), 4000)
    return () => clearTimeout(t)
  }, [peekVisible])

  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  const cycleSwitch = useCallback(() => {
    if (isStage3) return
    setSwitchPos((prev) => {
      if (prev === 'open') return 'closed'
      // Closing → opening resets the sim so student can re-run
      setICurrent(0)
      setTSim(0)
      setTrace([{ t: 0, u: 0 }])
      return 'open'
    })
  }, [isStage3])

  const submitStage3 = useCallback(() => {
    setSubmitted(true)
    setSwitchPos('closed')
    setICurrent(0)
    setTSim(0)
    setTrace([{ t: 0, u: 0 }])
  }, [])

  // ─── Circuit schematic geometry ──────────────────────────────────────
  const rect = {
    left: SCH_X + 40,
    right: SCH_X + SCH_W - 40,
    top: SCH_Y + 80,
    bottom: SCH_Y + SCH_H - 80,
  }
  const battery = { x: rect.left, y: (rect.top + rect.bottom) / 2 }
  const switchCenter = { x: (rect.left + rect.right) / 2 - 40, y: rect.top }
  const inductor = { x: (rect.left + rect.right) / 2 + 40, y: rect.top }
  const resistor = { x: rect.right, y: (rect.top + rect.bottom) / 2 }

  const wireStroke = '#54617A'
  const wireW = 1.6
  const activeColor = '#37C9B8'
  const isActive = switchPos === 'closed'
  const strokeCol = isActive ? activeColor : wireStroke
  const strokeWid = isActive ? wireW + 0.8 : wireW

  // Flow-path SVG `d` string for animated current dots.
  const flowD = [
    // battery+ up to top-left corner
    `M ${rect.left} ${battery.y - 3}`,
    `L ${rect.left} ${rect.top}`,
    // across top-left rail to switch left contact
    `L ${switchCenter.x - 11} ${rect.top}`,
    // across switch to switch right contact
    `L ${switchCenter.x + 11} ${rect.top}`,
    // across to inductor left
    `L ${inductor.x - 24} ${rect.top}`,
    // through inductor coil area (visually inside the symbol)
    `M ${inductor.x + 24} ${rect.top}`,
    // across to top-right corner
    `L ${rect.right} ${rect.top}`,
    // down right side to resistor
    `L ${rect.right} ${resistor.y - 12}`,
    // through resistor
    `M ${rect.right} ${resistor.y + 12}`,
    // down right side to bottom-right corner
    `L ${rect.right} ${rect.bottom}`,
    // across bottom to battery−
    `L ${rect.left} ${rect.bottom}`,
    `L ${rect.left} ${battery.y + 3}`,
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
    // Blind stage: live curve HIDDEN before submit (§4.7)
    if (isStage3 && !submitted) return ''
    if (trace.length < 2) return ''
    let d = ''
    for (let i = 0; i < trace.length; i++) {
      const p = trace[i]!
      const sx = tToSvgX(p.t)
      const sy = uToSvgY(p.u)
      d += `${i === 0 ? 'M' : 'L'} ${sx.toFixed(1)} ${sy.toFixed(1)} `
    }
    return d
  }, [trace, isStage3, submitted])

  const stage2TargetPath = useMemo(() => {
    if (!isStage2) return ''
    const { tStar, vRatio } = stage2Target
    const targetTau = -tStar / Math.log(vRatio)
    return decayPathFor(targetTau)
  }, [isStage2, stage2Target])

  const stage3TargetPath = useMemo(() => {
    if (!isStage3) return ''
    return decayPathFor(tauStar)
  }, [isStage3, tauStar])

  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`
  // HUD TR: current τ readout (required info per §4.7 — student aligns paper math with sim)
  const hudTR = isStage3 && submitted && Math.abs(tau - tauStar) / tauStar >= STAGE3_TOL
    ? `Δτ = ${(100 * Math.abs(tau - tauStar) / tauStar).toFixed(1)}%`
    : isStage2 && stage2Hit
      ? `${labels.hit} · τ = ${formatTau(tau)}`
      : `τ = ${formatTau(tau)}`
  const hudBL = isStage1 ? labels.tip1 : isStage2 ? labels.tip2 : labels.tip3
  // BR quadrant: reserved (fullscreen chrome). No overlay.

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

        {/* Left vertical: battery+ up + battery− down */}
        <line x1={rect.left} y1={battery.y - 3} x2={rect.left} y2={rect.top} stroke={strokeCol} strokeWidth={strokeWid} />
        <line x1={rect.left} y1={rect.bottom} x2={rect.left} y2={battery.y + 3} stroke={strokeCol} strokeWidth={strokeWid} />
        {/* Top-left horizontal: top-left corner to switch left contact */}
        <line x1={rect.left} y1={rect.top} x2={switchCenter.x - 11} y2={rect.top} stroke={strokeCol} strokeWidth={strokeWid} />
        {/* Top mid horizontal: switch right contact to inductor left */}
        <line x1={switchCenter.x + 11} y1={rect.top} x2={inductor.x - 24} y2={rect.top} stroke={strokeCol} strokeWidth={strokeWid} />
        {/* Top-right horizontal: inductor right to top-right corner */}
        <line x1={inductor.x + 24} y1={rect.top} x2={rect.right} y2={rect.top} stroke={strokeCol} strokeWidth={strokeWid} />
        {/* Right vertical: split at resistor */}
        <line x1={rect.right} y1={rect.top} x2={rect.right} y2={resistor.y - 12} stroke={strokeCol} strokeWidth={strokeWid} />
        <line x1={rect.right} y1={resistor.y + 12} x2={rect.right} y2={rect.bottom} stroke={strokeCol} strokeWidth={strokeWid} />
        {/* Bottom horizontal */}
        <line x1={rect.right} y1={rect.bottom} x2={rect.left} y2={rect.bottom} stroke={strokeCol} strokeWidth={strokeWid} />

        <Battery x={battery.x} y={battery.y} e={E} />
        <Inductor x={inductor.x} y={inductor.y} l={L} />
        {/* Resistor is drawn vertically (the reference component is horizontal — rotate) */}
        <g transform={`rotate(90 ${resistor.x} ${resistor.y})`}>
          <Resistor x={resistor.x} y={resistor.y} r={R} />
        </g>
        <g onClick={cycleSwitch} style={{ cursor: isStage3 ? 'default' : 'pointer' }}>
          <rect x={switchCenter.x - 22} y={switchCenter.y - 30} width={44} height={40} fill="transparent" />
          <Switch x={switchCenter.x} y={switchCenter.y} pos={switchPos} />
        </g>

        {/* Flowing-current dots along active loop (visualization only) */}
        {isActive && !isStage3 && (
          <g key="flow">
            <path id="flow-path" d={flowD} fill="none" stroke="none" />
            {[0, 0.5, 1.0, 1.5].map((delay) => (
              <circle key={`fl${delay}`} r={2.6} fill={activeColor}>
                <animateMotion dur="2s" repeatCount="indefinite" begin={`${delay}s`} rotate="auto">
                  <mpath href="#flow-path" />
                </animateMotion>
              </circle>
            ))}
          </g>
        )}

        {/* Switch state label */}
        <text
          x={switchCenter.x}
          y={SCH_Y + SCH_H - 10}
          fill="#54617A"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={10}
          textAnchor="middle"
        >
          {isStage3 ? '' : labels.click_switch}
        </text>

        {/* Stage 1 only: live i readout inside the schematic (pedagogical aid, not needed later) */}
        {isStage1 && (
          <text
            x={inductor.x}
            y={rect.top + 60}
            fill="#37C9B8"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={11}
            textAnchor="middle"
          >
            i = {formatI(iCurrent)} · Em = {(0.5 * L * iCurrent * iCurrent).toFixed(2)} J
          </text>
        )}

        {/* ─── Right panel: u_L(t) plot ────────────────────────────── */}
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
          {labels.chart_title}
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
          {labels.y_axis_label}
        </text>
        {[0, 5, 10, 15].map((tv) => (
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
            y={uToSvgY(v) + 3}
            fill="#54617A"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={9}
            textAnchor="end"
          >
            {v.toFixed(v === Math.round(v) ? 0 : 1)}
          </text>
        ))}

        {/* Stage 1 canonical markers — REMOVED on stages 2 & 3 per §4.7 */}
        {isStage1 && (
          <>
            {/* E asymptote (peak at t=0) */}
            <line
              x1={PLOT_X}
              y1={uToSvgY(E)}
              x2={PLOT_X + PLOT_W}
              y2={uToSvgY(E)}
              stroke="#37C9B8"
              strokeWidth={1}
              strokeDasharray="3 4"
              opacity={0.35}
            />
            {/* 0.37·E landmark (canonical τ crossing for a decay) */}
            <line
              x1={PLOT_X}
              y1={uToSvgY(0.37 * E)}
              x2={PLOT_X + PLOT_W}
              y2={uToSvgY(0.37 * E)}
              stroke="#F9A968"
              strokeWidth={1}
              strokeDasharray="3 4"
              opacity={0.4}
            />
            <text
              x={PLOT_X + PLOT_W - 4}
              y={uToSvgY(0.37 * E) - 4}
              fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={9}
              textAnchor="end"
            >
              0.37·E
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

        {/* Stage 2 target crosshair + guide curve */}
        {isStage2 && (
          <>
            <path d={stage2TargetPath} fill="none" stroke="#F97316" strokeWidth={1.6} opacity={0.6} strokeDasharray="4 5" />
            <g>
              <circle cx={tToSvgX(stage2Target.tStar)} cy={uToSvgY(stage2Target.vRatio * E)} r={6} fill="#F97316" />
              <circle
                cx={tToSvgX(stage2Target.tStar)}
                cy={uToSvgY(stage2Target.vRatio * E)}
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
                y2={uToSvgY(stage2Target.vRatio * E)}
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
                y={uToSvgY(stage2Target.vRatio * E) + 3}
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

        {/* Stage 3 target curve — always visible on stage 3 */}
        {isStage3 && (
          <path d={stage3TargetPath} fill="none" stroke="#F97316" strokeWidth={2} opacity={0.9} />
        )}

        {/* Stage 3 peek: reading-method strategy text ONLY (§4.7 rule 4) —
            NOT a τ* reveal, NOT a dashed vertical at τ*. */}
        {isStage3 && peekVisible && (
          <>
            <rect
              x={PLOT_X + 8}
              y={PLOT_Y + 8}
              width={PLOT_W - 16}
              height={40}
              fill="#0D1524"
              stroke="#37C9B8"
              strokeWidth={1}
              rx={4}
              opacity={0.95}
            />
            <text
              x={PLOT_X + PLOT_W / 2}
              y={PLOT_Y + 32}
              fill="#37C9B8"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={9}
              textAnchor="middle"
            >
              {labels.peek_hint}
            </text>
          </>
        )}

        {/* Live trace — hidden on stage 3 pre-submit (§4.7) */}
        {tracePath && <path d={tracePath} fill="none" stroke="#37C9B8" strokeWidth={2} />}
      </svg>

      {/* ─── HUD overlays (HTML in rem, NOT SVG text) ───────────────── */}
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
      {/* BR quadrant: reserved for parent chrome. No overlay. */}

      {/* ─── L and R vertical sliders (top-right, stacked column) ───── */}
      <div
        style={{
          position: 'absolute',
          top: '8rem',
          right: '3rem',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '2rem',
          zIndex: 6,
        }}
      >
        {/* L slider */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.6rem' }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.6rem', color: '#6C7A93' }}>
            {L_MAX}H
          </div>
          <div style={{ width: '2rem', height: '22rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <input
              type="range"
              min={0}
              max={1000}
              step={1}
              value={Math.round(toLog(L, L_MIN, L_MAX) * 1000)}
              onChange={(e) => {
                setL(fromLog(Number(e.target.value) / 1000, L_MIN, L_MAX))
                setLMoved(true)
              }}
              disabled={isStage3 && submitted}
              style={{
                width: '22rem',
                height: '2rem',
                transform: 'rotate(-90deg)',
                transformOrigin: 'center',
                accentColor: '#37C9B8',
                cursor: isStage3 && submitted ? 'not-allowed' : 'pointer',
              }}
            />
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.6rem', color: '#6C7A93' }}>
            {L_MIN}H
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.6rem', color: '#37C9B8' }}>
            L = {L >= 1 ? `${L.toFixed(L >= 10 ? 0 : 2)}H` : `${(L * 1000).toFixed(0)}mH`}
          </div>
        </div>
        {/* R slider */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.6rem' }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.6rem', color: '#6C7A93' }}>
            {R_MAX}Ω
          </div>
          <div style={{ width: '2rem', height: '22rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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
                width: '22rem',
                height: '2rem',
                transform: 'rotate(-90deg)',
                transformOrigin: 'center',
                accentColor: '#37C9B8',
                cursor: isStage3 && submitted ? 'not-allowed' : 'pointer',
              }}
            />
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.6rem', color: '#6C7A93' }}>
            {R_MIN}Ω
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.6rem', color: '#37C9B8' }}>
            R = {R >= 10 ? `${R.toFixed(0)}Ω` : `${R.toFixed(1)}Ω`}
          </div>
        </div>
      </div>

      {/* Stage 3 only: SUBMIT button (bottom-center, pre-submit only) */}
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
