import { useCallback, useEffect, useMemo, useState } from 'react'
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
  useSeed,
  useSetStage,
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

const SCH_X = 32
const SCH_Y = 60
const SCH_W = 360
const SCH_H = 350

const PLOT_X = 412
const PLOT_Y = 60
const PLOT_W = 250
const PLOT_H = 350

// ─── Physics constants ──────────────────────────────────────────────────
const R_INT = 2000            // Ω — fixed internal resistance (gives a nice charging curve)
const U_MIN = 3               // V
const U_MAX = 12              // V
const U_DEFAULT = 6           // V
const C_MIN = 100e-6          // F
const C_MAX = 1000e-6         // F
const C_DEFAULT = 300e-6      // F
const T_SIM_MAX = 12          // s (~6 × τ_max)
const Q_AXIS_MAX = 13e-3      // C — y-axis upper bound (C_MAX × U_MAX = 12 mC + headroom)

// Stage-2: target Q plateau values (in Coulombs)
const STAGE2_TARGETS: { qStar: number }[] = [
  { qStar: 1.2e-3 },
  { qStar: 2.5e-3 },
  { qStar: 4.0e-3 },
  { qStar: 0.9e-3 },
  { qStar: 3.0e-3 },
]
const STAGE2_TOL = 0.05

// Stage-3: hidden (C*, U*) pairs → Q* = C* · U*
const STAGE3_TARGETS: { cStar: number; uStar: number }[] = [
  { cStar: 200e-6, uStar: 8 },   // Q* = 1.6 mC
  { cStar: 400e-6, uStar: 5 },   // Q* = 2.0 mC
  { cStar: 300e-6, uStar: 10 },  // Q* = 3.0 mC
  { cStar: 600e-6, uStar: 4 },   // Q* = 2.4 mC
  { cStar: 500e-6, uStar: 7 },   // Q* = 3.5 mC
]
const STAGE3_TOL = 0.03

const dict = { en, fr, ar } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── Physics helpers ────────────────────────────────────────────────────
/** Exact-integrator step: u_C evolves toward `target` with time constant τ. */
function stepUc(uC: number, target: number, dtSec: number, tau: number): number {
  if (tau <= 0) return target
  const decay = Math.exp(-dtSec / tau)
  return target + (uC - target) * decay
}

function formatQ(q: number): string {
  // q in Coulombs → show in mC
  return `${(q * 1000).toFixed(2)} mC`
}

function formatU(u: number): string {
  return `${u.toFixed(1)} V`
}

function formatEnergy(e: number): string {
  // Joules → mJ
  return `${(e * 1000).toFixed(2)} mJ`
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
function qToSvgY(q: number): number {
  return PLOT_Y + PLOT_H - (q / Q_AXIS_MAX) * PLOT_H
}

/** Closed-form charging curve q(t) = C·U·(1 - exp(-t / (R_INT·C))). */
function chargePathFor(cVal: number, uVal: number): string {
  const tau = R_INT * cVal
  const qMax = cVal * uVal
  const steps = 80
  let d = ''
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * T_SIM_MAX
    const q = qMax * (1 - Math.exp(-t / tau))
    const sx = tToSvgX(t)
    const sy = qToSvgY(q)
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
  const stage3Target = useMemo(
    () => STAGE3_TARGETS[(seed + 1) % STAGE3_TARGETS.length]!,
    [seed],
  )
  const qStar3 = stage3Target.cStar * stage3Target.uStar

  const stageIdx = useCurrentStage()
  const setStage = useSetStage()
  const progress = useProgress()
  const complete = useComplete()

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  // ─── Physical state ─────────────────────────────────────────────────
  const [C, setC] = useState(C_DEFAULT)
  const [U, setU] = useState(U_DEFAULT)
  const [switchPos, setSwitchPos] = useState<SwitchPos>('open')
  const [uC, setUc] = useState(0)
  const [tSim, setTSim] = useState(0)
  const [trace, setTrace] = useState<{ t: number; q: number }[]>([{ t: 0, q: 0 }])

  // Stage-1 coverage
  const [cMoved, setCMoved] = useState(false)
  const [uMoved, setUMoved] = useState(false)
  const [fullCharged, setFullCharged] = useState(false)

  // Stage-2 match flag (parameter-space match sustained while sim runs)
  const [stage2Hit, setStage2Hit] = useState(false)

  // Stage-3
  const [submitted, setSubmitted] = useState(false)
  const [peekVisible, setPeekVisible] = useState(false)

  const tau = R_INT * C
  const qNow = C * uC
  const qMax = C * U
  const energyNow = 0.5 * C * uC * uC

  const resetStageState = useCallback(() => {
    setC(C_DEFAULT)
    setU(U_DEFAULT)
    setSwitchPos('open')
    setUc(0)
    setTSim(0)
    setTrace([{ t: 0, q: 0 }])
    setCMoved(false)
    setUMoved(false)
    setFullCharged(false)
    setStage2Hit(false)
    setSubmitted(false)
    setPeekVisible(false)
  }, [])

  // Re-set live uC and reset the trace whenever C or U changes on stages 1/2
  // (so the plot always reflects a fresh charging run from the current parameters).
  // Not done on stage 3: we don't want the trace redrawn while sliders move
  // pre-submit — the live curve stays hidden until RUN.
  const paramSignature = `${C.toFixed(9)}|${U.toFixed(3)}`
  useEffect(() => {
    if (isStage3) return
    setUc(0)
    setTSim(0)
    setTrace([{ t: 0, q: 0 }])
    setStage2Hit(false)
    if (isStage1) setFullCharged(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramSignature, isStage3, isStage1])

  // ─── Ticker ─────────────────────────────────────────────────────────
  useTicker((dt) => {
    // Stage 3 pre-submit: no live simulation at all
    if (isStage3 && !submitted) return
    if (tSim >= T_SIM_MAX) return

    // Time advances even when the switch is open on stages 1 & 2, so the
    // student sees the flat line; but u_C only changes when the switch is closed.
    const target = switchPos === 'closed' ? U : uC
    const next = switchPos === 'closed' ? stepUc(uC, target, dt, tau) : uC

    if (switchPos === 'closed') setUc(next)

    // Stage-1 coverage tracking
    if (isStage1 && U > 0 && next / U >= 0.99) setFullCharged(true)

    // Stage-2 match (sustained parameter-space match while the sim runs into the plateau)
    if (isStage2 && !stage2Hit) {
      // Only count a match once the sim has progressed enough to actually see the plateau.
      if (tSim >= 3 * tau) {
        const err = Math.abs(qMax - stage2Target.qStar) / stage2Target.qStar
        if (err < STAGE2_TOL) setStage2Hit(true)
      }
    }

    setTSim((prev) => {
      const nxt = Math.min(prev + dt, T_SIM_MAX)
      setTrace((prevTrace) => {
        const last = prevTrace[prevTrace.length - 1]
        if (last && nxt - last.t < 0.03) return prevTrace
        const qSample = C * (switchPos === 'closed' ? next : uC)
        return [...prevTrace, { t: nxt, q: qSample }]
      })
      return nxt
    })
  })

  // ─── Advance predicate ──────────────────────────────────────────────
  const canSubmit = isStage1
    ? cMoved && uMoved && fullCharged
    : isStage2
      ? stage2Hit
      : submitted && Math.abs(qMax - qStar3) / qStar3 < STAGE3_TOL

  const readout = isStage1
    ? `u_C = ${uC.toFixed(2)} V · Q = ${formatQ(qNow)}`
    : isStage2
      ? stage2Hit
        ? `${labels.hit} · Q_max = ${formatQ(qMax)}`
        : `Q_max = ${formatQ(qMax)}`
      : submitted
        ? Math.abs(qMax - qStar3) / qStar3 < STAGE3_TOL
          ? `${labels.match_ok} · Q_max = ${formatQ(qMax)}`
          : `${labels.match_off} · ΔQ = ${(100 * Math.abs(qMax - qStar3) / qStar3).toFixed(1)}%`
        : `Q_max = ${formatQ(qMax)}`

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
    const t = setTimeout(() => setPeekVisible(false), 4500)
    return () => clearTimeout(t)
  }, [peekVisible])

  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  const toggleSwitch = useCallback(() => {
    setSwitchPos((prev) => (prev === 'open' ? 'closed' : 'open'))
  }, [])

  const submitStage3 = useCallback(() => {
    setSubmitted(true)
    setSwitchPos('closed')
    setUc(0)
    setTSim(0)
    setTrace([{ t: 0, q: 0 }])
  }, [])

  // ─── Circuit schematic geometry ──────────────────────────────────────
  const rect = {
    left: SCH_X + 50,
    right: SCH_X + SCH_W - 40,
    top: SCH_Y + 80,
    bottom: SCH_Y + SCH_H - 90,
  }
  const battery = { x: rect.left, y: (rect.top + rect.bottom) / 2 }
  const capacitor = { x: rect.right, y: (rect.top + rect.bottom) / 2 }
  const switchPivot = { x: rect.left + 60, y: rect.top }
  const resistor = { x: (switchPivot.x + rect.right) / 2 + 20, y: rect.top }

  const wireStroke = '#54617A'
  const wireW = 1.6
  const chargeColor = '#37C9B8'
  const closedActive = switchPos === 'closed'

  const wireColor = closedActive ? chargeColor : wireStroke
  const wireWidth = closedActive ? wireW + 0.8 : wireW

  // Flow-path for current dots (charging loop)
  const chargeFlowD = [
    // Start above battery (positive terminal), go up to top-left corner
    `M ${rect.left} ${battery.y - 3}`,
    `L ${rect.left} ${rect.top}`,
    // across top to switch pivot
    `L ${switchPivot.x} ${rect.top}`,
    // across through resistor to top-right corner
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

  // ─── Plot grid ──────────────────────────────────────────────────────
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

  // ─── Curve paths ────────────────────────────────────────────────────
  const tracePath = useMemo(() => {
    if (isStage3 && !submitted) return ''
    if (trace.length < 2) return ''
    let d = ''
    for (let i = 0; i < trace.length; i++) {
      const p = trace[i]!
      const sx = tToSvgX(p.t)
      const sy = qToSvgY(p.q)
      d += `${i === 0 ? 'M' : 'L'} ${sx.toFixed(1)} ${sy.toFixed(1)} `
    }
    return d
  }, [trace, isStage3, submitted])

  const stage2TargetPath = useMemo(() => {
    if (!isStage2) return ''
    // Author a canonical target curve with a mid-range τ so students see a
    // well-shaped curve. The tolerance is on Q_max only — the exact target
    // τ used to render the target curve is illustrative.
    const targetTau = 0.6 // s
    const cRef = targetTau / R_INT
    const uRef = stage2Target.qStar / cRef
    return chargePathFor(cRef, uRef)
  }, [isStage2, stage2Target])

  const stage3TargetPath = useMemo(() => {
    if (!isStage3) return ''
    return chargePathFor(stage3Target.cStar, stage3Target.uStar)
  }, [isStage3, stage3Target])

  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`
  const hudTR = isStage1
    ? `Q_max = ${formatQ(qMax)}`
    : isStage2
      ? stage2Hit
        ? `${labels.hit} · Q_max = ${formatQ(qMax)}`
        : `Q_max = ${formatQ(qMax)}`
      : submitted
        ? Math.abs(qMax - qStar3) / qStar3 < STAGE3_TOL
          ? `${labels.match_ok} · Q_max = ${formatQ(qMax)}`
          : `ΔQ = ${(100 * Math.abs(qMax - qStar3) / qStar3).toFixed(1)}%`
        : `Q_max = ${formatQ(qMax)}`
  const hudBL = isStage1 ? labels.tip1 : isStage2 ? labels.tip2 : labels.tip3

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

        {/* Left vertical wires (battery+ up to top-left; battery- down to bottom-left) */}
        <line x1={rect.left} y1={battery.y - 3} x2={rect.left} y2={rect.top} stroke={wireColor} strokeWidth={wireWidth} />
        <line x1={rect.left} y1={rect.bottom} x2={rect.left} y2={battery.y + 3} stroke={wireColor} strokeWidth={wireWidth} />
        {/* Top wire: top-left → switch pivot */}
        <line x1={rect.left} y1={rect.top} x2={switchPivot.x} y2={rect.top} stroke={wireColor} strokeWidth={wireWidth} />
        {/* Top wire: past switch → resistor left → resistor right → top-right corner */}
        <line
          x1={switchPivot.x + 30}
          y1={rect.top}
          x2={resistor.x - 22}
          y2={rect.top}
          stroke={wireColor}
          strokeWidth={wireWidth}
        />
        <line
          x1={resistor.x + 22}
          y1={rect.top}
          x2={rect.right}
          y2={rect.top}
          stroke={wireColor}
          strokeWidth={wireWidth}
        />
        {/* Right vertical (top-right → cap top; cap bottom → bottom-right) */}
        <line x1={rect.right} y1={rect.top} x2={rect.right} y2={capacitor.y - 4} stroke={wireColor} strokeWidth={wireWidth} />
        <line x1={rect.right} y1={capacitor.y + 4} x2={rect.right} y2={rect.bottom} stroke={wireColor} strokeWidth={wireWidth} />
        {/* Bottom wire */}
        <line x1={rect.left} y1={rect.bottom} x2={rect.right} y2={rect.bottom} stroke={wireColor} strokeWidth={wireWidth} />

        <Battery x={battery.x} y={battery.y} u={U} />
        <Resistor x={resistor.x} y={resistor.y} r={R_INT} />
        <Capacitor x={capacitor.x} y={capacitor.y} c={C} uC={uC} u={U} />
        <g onClick={toggleSwitch} style={{ cursor: 'pointer' }}>
          <rect x={switchPivot.x - 6} y={switchPivot.y - 30} width={44} height={38} fill="transparent" />
          <Switch x={switchPivot.x} y={switchPivot.y} pos={switchPos} />
        </g>

        {/* Flowing-current dots along the charging loop */}
        {closedActive && (
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

        {/* Switch state label */}
        <text
          x={switchPivot.x + 15}
          y={SCH_Y + SCH_H - 20}
          fill="#54617A"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={10}
          textAnchor="middle"
        >
          {labels.click_switch}
        </text>

        {/* Stage-1 energy readout (visible on stage 1 only — HELP that is removed on stage 3) */}
        {isStage1 && (
          <text
            x={capacitor.x}
            y={SCH_Y + SCH_H - 40}
            fill="#F9A968"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={10}
            textAnchor="middle"
          >
            E_e = {formatEnergy(energyNow)}
          </text>
        )}

        {/* ─── Right panel: q(t) plot ────────────────────────────────── */}
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
          {labels.x_axis_label}
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
          {labels.y_axis_label} →
        </text>
        {/* Time tick labels */}
        {[0, 4, 8, 12].map((tv) => (
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
        {/* Charge tick labels (in mC) */}
        {[0, 3e-3, 6e-3, 9e-3, 12e-3].map((qv) => (
          <text
            key={`qk${qv}`}
            x={PLOT_X - 6}
            y={qToSvgY(qv) + 3}
            fill="#54617A"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={9}
            textAnchor="end"
          >
            {(qv * 1000).toFixed(0)}
          </text>
        ))}

        {/* Stage-1 canonical markers (HELP — removed on stages 2 & 3) */}
        {isStage1 && qMax <= Q_AXIS_MAX && (
          <>
            {/* Q_max plateau (current-parameter asymptote) */}
            <line
              x1={PLOT_X}
              y1={qToSvgY(qMax)}
              x2={PLOT_X + PLOT_W}
              y2={qToSvgY(qMax)}
              stroke="#F9A968"
              strokeWidth={1}
              strokeDasharray="3 4"
              opacity={0.5}
            />
            <text
              x={PLOT_X + PLOT_W - 4}
              y={qToSvgY(qMax) - 4}
              fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={9}
              textAnchor="end"
            >
              {labels.qmax_label} = {formatQ(qMax)}
            </text>
          </>
        )}

        {/* Stage-2 target: dashed target curve + target plateau line + Q* label */}
        {isStage2 && (
          <>
            <path
              d={stage2TargetPath}
              fill="none"
              stroke="#F97316"
              strokeWidth={1.6}
              opacity={0.6}
              strokeDasharray="4 5"
            />
            <line
              x1={PLOT_X}
              y1={qToSvgY(stage2Target.qStar)}
              x2={PLOT_X + PLOT_W}
              y2={qToSvgY(stage2Target.qStar)}
              stroke="#F97316"
              strokeWidth={1}
              strokeDasharray="2 3"
              opacity={0.55}
            />
            <text
              x={PLOT_X - 6}
              y={qToSvgY(stage2Target.qStar) + 3}
              fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
              textAnchor="end"
            >
              Q*={formatQ(stage2Target.qStar)}
            </text>
          </>
        )}

        {/* Stage-3 target curve (solid orange) */}
        {isStage3 && (
          <path d={stage3TargetPath} fill="none" stroke="#F97316" strokeWidth={2} opacity={0.9} />
        )}

        {/* Stage-3 peek: reading-method hint (NO Q* reveal, NO markers) */}
        {isStage3 && peekVisible && (
          <g>
            <rect
              x={PLOT_X + 8}
              y={PLOT_Y + 8}
              width={PLOT_W - 16}
              height={54}
              rx={4}
              fill="#0D1524"
              stroke="#37C9B8"
              strokeWidth={1}
              opacity={0.92}
            />
            <foreignObject x={PLOT_X + 12} y={PLOT_Y + 12} width={PLOT_W - 24} height={46}>
              <div
                style={{
                  color: '#37C9B8',
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: '9px',
                  lineHeight: 1.3,
                }}
              >
                {labels.peek_hint}
              </div>
            </foreignObject>
          </g>
        )}

        {/* Live trace (hidden on stage 3 pre-submit) */}
        {tracePath && (
          <path d={tracePath} fill="none" stroke="#37C9B8" strokeWidth={2} />
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
      {/* BR quadrant: reserved for parent chrome (fullscreen). Do NOT add overlay. */}

      {/* ─── C and U vertical sliders (top-right, stacked column) ────── */}
      <div
        style={{
          position: 'absolute',
          top: '7rem',
          right: '3rem',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '2rem',
          zIndex: 6,
        }}
      >
        {/* C slider (log scale) */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.6rem' }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.6rem', color: '#6C7A93' }}>
            {(C_MAX * 1e6).toFixed(0)}µ
          </div>
          <div style={{ width: '2rem', height: '20rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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
                width: '20rem',
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
        {/* U slider (linear) */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.6rem' }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.6rem', color: '#6C7A93' }}>
            {U_MAX}V
          </div>
          <div style={{ width: '2rem', height: '20rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <input
              type="range"
              min={U_MIN * 10}
              max={U_MAX * 10}
              step={1}
              value={Math.round(U * 10)}
              onChange={(e) => {
                setU(Number(e.target.value) / 10)
                setUMoved(true)
              }}
              disabled={isStage3 && submitted}
              style={{
                width: '20rem',
                height: '2rem',
                transform: 'rotate(-90deg)',
                transformOrigin: 'center',
                accentColor: '#37C9B8',
                cursor: isStage3 && submitted ? 'not-allowed' : 'pointer',
              }}
            />
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.6rem', color: '#6C7A93' }}>
            {U_MIN}V
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.6rem', color: '#37C9B8' }}>
            U = {formatU(U)}
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
