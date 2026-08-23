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
const SCH_W = 340
const SCH_H = 350

// Right panel: i(t) time-series plot. Kept within x ≤ 600 so no SVG <text>
// (tick labels) lands in the reserved BR quadrant (x > 600, y > 350).
const PLOT_X = 400
const PLOT_Y = 60
const PLOT_W = 200
const PLOT_H = 350

// Physics constants
const E = 6 // V — fixed
const R_MIN = 1 // Ω
const R_MAX = 10 // Ω
const R_DEFAULT = 3 // Ω
const L_MIN = 1 // H
const L_MAX = 10 // H
const L_DEFAULT = 3 // H

// Fixed y-axis maximum (in A) so target and live curves share a scale
// regardless of the student's chosen R. Sized to 1.05 · (E / R_MIN).
const I_AXIS_MAX = 1.05 * (E / R_MIN)

// Plot horizontal extent — sized to comfortably show 5·τ_max
const T_SIM_MAX = 15 // seconds

// Stage 2 seeded targets: (t*, iStar) with iStar in absolute Amps.
// Each hand-authored so multiple (R, L) pairs can solve it.
const STAGE2_TARGETS = [
  { tStar: 4, iStar: 1.26 },
  { tStar: 2, iStar: 1.0 },
  { tStar: 6, iStar: 0.9 },
  { tStar: 3, iStar: 1.5 },
  { tStar: 5, iStar: 2.6 },
]
// Absolute-current tolerance for stage 2, normalized by a reference I_max
// (E/R_DEFAULT = 2 A). ~ 0.16 A absolute → forgiving but not trivial.
const STAGE2_TOL = 0.08

// Stage 3 seeded hidden targets: (R*, L*) pairs — tauStar = L*/R*.
// Chosen to span the tau range 0.6s … 3.0s.
const STAGE3_TARGETS: { rStar: number; lStar: number }[] = [
  { rStar: 2, lStar: 2.4 }, // τ = 1.2 s
  { rStar: 3, lStar: 4.5 }, // τ = 1.5 s
  { rStar: 5, lStar: 3 }, // τ = 0.6 s
  { rStar: 2, lStar: 6 }, // τ = 3.0 s
  { rStar: 4, lStar: 3.2 }, // τ = 0.8 s
]
const STAGE3_TOL = 0.03 // ±3% on τ

const dict = { en, fr, ar } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── Physics helpers ────────────────────────────────────────────────────
/** Exact integrator step: i evolves toward `target` (I_max when establishing,
 *  0 when breaking). Unconditionally stable for any dt. */
function stepI(i: number, target: number, dtSec: number, tau: number): number {
  if (tau <= 0) return target
  const decay = Math.exp(-dtSec / tau)
  return target + (i - target) * decay
}

/** Format τ for display (ms if <1 s, else s). */
function formatTau(tau: number): string {
  if (tau < 1) return `${(tau * 1000).toFixed(0)} ms`
  return `${tau.toFixed(2)} s`
}

/** Format i / I_max readouts consistently. */
function formatI(a: number): string {
  return `${a.toFixed(2)} A`
}

// ─── Log-slider mapping ────────────────────────────────────────────────
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
function iToSvgY(a: number): number {
  return PLOT_Y + PLOT_H - (a / I_AXIS_MAX) * PLOT_H
}

/** Closed-form establishment curve for a target (tau, I_max). */
function establishPathFor(tau: number, iMax: number): string {
  const steps = 80
  let d = ''
  for (let k = 0; k <= steps; k++) {
    const t = (k / steps) * T_SIM_MAX
    const a = iMax * (1 - Math.exp(-t / tau))
    const sx = tToSvgX(t)
    const sy = iToSvgY(a)
    d += `${k === 0 ? 'M' : 'L'} ${sx.toFixed(1)} ${sy.toFixed(1)} `
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
  const iMaxStar = E / stage3Target.rStar

  const stageIdx = useCurrentStage()
  const [R, setR] = useState(R_DEFAULT)
  const [L, setL] = useState(L_DEFAULT)
  const [switchPos, setSwitchPos] = useState<SwitchPos>('open')
  const [iL, setIl] = useState(0)
  const [tSim, setTSim] = useState(0)
  const [trace, setTrace] = useState<{ t: number; i: number }[]>([{ t: 0, i: 0 }])
  const [rMoved, setRMoved] = useState(false)
  const [lMoved, setLMoved] = useState(false)
  const [fullEstablished, setFullEstablished] = useState(false)
  const [fullBroken, setFullBroken] = useState(true)
  const [peekVisible, setPeekVisible] = useState(false)
  const [stage2Hit, setStage2Hit] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  const tau = L / R
  const iMax = E / R

  const setStage = useSetStage()
  const progress = useProgress()
  const complete = useComplete()

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  const resetStageState = useCallback(() => {
    setR(R_DEFAULT)
    setL(L_DEFAULT)
    setSwitchPos('open')
    setIl(0)
    setTSim(0)
    setTrace([{ t: 0, i: 0 }])
    setRMoved(false)
    setLMoved(false)
    setFullEstablished(false)
    setFullBroken(true)
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
    // Stage 3 post-submit: sim always runs in "establish" mode to draw
    // the student's curve on the fresh clock.
    const effectivePos: SwitchPos = isStage3 ? 'establish' : switchPos
    const target = effectivePos === 'establish' ? iMax : 0
    const next = stepI(iL, target, dt, tau)
    setIl(next)
    if (isStage1) {
      if (target === iMax && iMax > 0 && next / iMax >= 0.99) setFullEstablished(true)
      if (target === 0 && iMax > 0 && next / iMax <= 0.01) setFullBroken(true)
    }
    if (isStage2 && !stage2Hit) {
      const { tStar, iStar } = stage2Target
      if (Math.abs(tSim - tStar) < 0.2) {
        // Normalize to a reference I_max so tolerance stays comparable
        // across student's R choices. Reference = E/R_DEFAULT.
        const iRef = E / R_DEFAULT
        if (Math.abs(next - iStar) / iRef < STAGE2_TOL) {
          setStage2Hit(true)
        }
      }
    }
    setTSim((prev) => {
      const nxt = Math.min(prev + dt, T_SIM_MAX)
      setTrace((prevTrace) => {
        const last = prevTrace[prevTrace.length - 1]
        if (last && nxt - last.t < 0.03) return prevTrace
        return [...prevTrace, { t: nxt, i: next }]
      })
      return nxt
    })
  })

  const canSubmit = isStage1
    ? fullEstablished && fullBroken && rMoved && lMoved
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

  // §4.7 rule 4: peek is a STRATEGY HINT, never the answer. It only toggles
  // the reading-method text overlay — no tauStar reveal, no chart marker at
  // tToSvgX(tauStar).
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
    setSwitchPos((prev) =>
      prev === 'open' ? 'establish' : prev === 'establish' ? 'break' : 'open',
    )
  }, [])

  const submitStage3 = useCallback(() => {
    setSubmitted(true)
    setSwitchPos('establish')
    setIl(0)
    setTSim(0)
    setTrace([{ t: 0, i: 0 }])
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
  const resistor = { x: (topMid + rect.right) / 2 + 10, y: rect.top }
  const inductor = { x: rect.right, y: (rect.top + rect.bottom) / 2 }
  const breakBottomX = switchPivot.x + 22

  const wireStroke = '#54617A'
  const wireW = 1.6
  const establishColor = '#37C9B8'
  const breakColor = '#F97316'

  const establishActive = switchPos === 'establish'
  const breakActive = switchPos === 'break'
  const inEstablishLoop = (seg: string) =>
    seg === 'left-vert' ||
    seg === 'top-left-h' ||
    seg === 'switch-common' ||
    seg === 'top-h' ||
    seg === 'right-vert' ||
    seg === 'bottom-left-h' ||
    seg === 'bottom-right-h'
  const inBreakLoop = (seg: string) =>
    seg === 'switch-common' ||
    seg === 'top-h' ||
    seg === 'right-vert' ||
    seg === 'bottom-right-h' ||
    seg === 'break-branch'
  function wireColor(seg: string): string {
    if (establishActive && inEstablishLoop(seg)) return establishColor
    if (breakActive && inBreakLoop(seg)) return breakColor
    return wireStroke
  }
  function wireWidth(seg: string): number {
    if (establishActive && inEstablishLoop(seg)) return wireW + 0.8
    if (breakActive && inBreakLoop(seg)) return wireW + 0.8
    return wireW
  }

  // Flow-dot paths (for the animated current dots)
  const establishFlowD = [
    `M ${rect.left} ${battery.y - 3}`,
    `L ${rect.left} ${rect.top}`,
    `L ${switchPivot.x - 22} ${switchPivot.y - 10}`,
    `L ${switchPivot.x} ${switchPivot.y}`,
    `L ${switchPivot.x} ${rect.top}`,
    `L ${rect.right} ${rect.top}`,
    `L ${rect.right} ${inductor.y - 18}`,
    `M ${rect.right} ${inductor.y + 18}`,
    `L ${rect.right} ${rect.bottom}`,
    `L ${rect.left} ${rect.bottom}`,
    `L ${rect.left} ${battery.y + 3}`,
  ].join(' ')

  const breakFlowD = [
    // Inductor keeps pushing current: coil-top → up → across via break contact
    // → down break branch → across bottom → up right side → coil-bottom.
    `M ${rect.right} ${inductor.y - 18}`,
    `L ${rect.right} ${rect.top}`,
    `L ${switchPivot.x} ${rect.top}`,
    `L ${switchPivot.x} ${switchPivot.y}`,
    `L ${switchPivot.x + 22} ${switchPivot.y - 10}`,
    `L ${breakBottomX} ${rect.bottom}`,
    `L ${rect.right} ${rect.bottom}`,
    `L ${rect.right} ${inductor.y + 18}`,
  ].join(' ')

  const plotGrid: React.ReactNode[] = []
  for (let k = 1; k < 5; k++) {
    const gx = PLOT_X + (k / 5) * PLOT_W
    plotGrid.push(
      <line key={`vx${k}`} x1={gx} y1={PLOT_Y} x2={gx} y2={PLOT_Y + PLOT_H} stroke="#12203a" strokeWidth={1} />,
    )
  }
  for (let k = 1; k < 5; k++) {
    const gy = PLOT_Y + (k / 5) * PLOT_H
    plotGrid.push(
      <line key={`gy${k}`} x1={PLOT_X} y1={gy} x2={PLOT_X + PLOT_W} y2={gy} stroke="#12203a" strokeWidth={1} />,
    )
  }

  const tracePath = useMemo(() => {
    // §4.7: live curve is HELP on stage 3 — hide it until student submits.
    if (isStage3 && !submitted) return ''
    if (trace.length < 2) return ''
    let d = ''
    for (let k = 0; k < trace.length; k++) {
      const p = trace[k]!
      const sx = tToSvgX(p.t)
      const sy = iToSvgY(p.i)
      d += `${k === 0 ? 'M' : 'L'} ${sx.toFixed(1)} ${sy.toFixed(1)} `
    }
    return d
  }, [trace, isStage3, submitted])

  const stage2TargetPath = useMemo(() => {
    if (!isStage2) return ''
    // Draw the establishment curve that passes through (tStar, iStar) using
    // a canonical reference I_max (E/R_DEFAULT). This is one visualization
    // of a family of (R, L) solutions — the crosshair is what actually
    // scores.
    const { tStar, iStar } = stage2Target
    const iRef = E / R_DEFAULT
    // Solve iStar = iRef · (1 − e^{−tStar/τ}) for τ (visualization only).
    const clamped = Math.min(0.98, iStar / iRef)
    const tauViz = clamped > 0 ? -tStar / Math.log(1 - clamped) : 1
    return establishPathFor(tauViz, iRef)
  }, [isStage2, stage2Target])

  const stage3TargetPath = useMemo(() => {
    if (!isStage3) return ''
    return establishPathFor(tauStar, iMaxStar)
  }, [isStage3, tauStar, iMaxStar])

  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`
  // TR carries the required-info scalars (τ, I_max) plus a post-submit
  // verdict on stage 3. Peek does NOT alter this — peek is chart-side only.
  const hudTR = isStage3
    ? submitted
      ? Math.abs(tau - tauStar) / tauStar < STAGE3_TOL
        ? `${labels.match_ok} · Δτ = ${(100 * Math.abs(tau - tauStar) / tauStar).toFixed(1)}%`
        : `${labels.match_off} · Δτ = ${(100 * Math.abs(tau - tauStar) / tauStar).toFixed(1)}%`
      : `τ = ${formatTau(tau)} · I_max = ${formatI(iMax)}`
    : isStage2
      ? stage2Hit
        ? `${labels.hit} · τ = ${formatTau(tau)}`
        : `τ = ${formatTau(tau)} · I_max = ${formatI(iMax)}`
      : `τ = ${formatTau(tau)} · I_max = ${formatI(iMax)}`
  const hudBL = isStage1 ? labels.tip1 : isStage2 ? labels.tip2 : labels.tip3
  // BR: reserved for parent-side chrome (fullscreen button). No overlay here.

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

        {/* Left vertical (battery+ up to top-left corner, and battery− down to bottom-left) */}
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
        {/* Break branch (switch break contact down to bottom rail) */}
        <line
          x1={breakBottomX} y1={switchPivot.y - 10}
          x2={breakBottomX} y2={rect.bottom}
          stroke={wireColor('break-branch')} strokeWidth={wireWidth('break-branch')}
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
        {/* Right vertical (top-right corner down through L to bottom-right corner) */}
        <line
          x1={rect.right} y1={rect.top} x2={rect.right} y2={inductor.y - 18}
          stroke={wireColor('right-vert')} strokeWidth={wireWidth('right-vert')}
        />
        <line
          x1={rect.right} y1={inductor.y + 18} x2={rect.right} y2={rect.bottom}
          stroke={wireColor('right-vert')} strokeWidth={wireWidth('right-vert')}
        />
        {/* Bottom rail (split at breakBottomX) */}
        <line
          x1={rect.left} y1={rect.bottom} x2={breakBottomX} y2={rect.bottom}
          stroke={wireColor('bottom-left-h')} strokeWidth={wireWidth('bottom-left-h')}
        />
        <line
          x1={breakBottomX} y1={rect.bottom} x2={rect.right} y2={rect.bottom}
          stroke={wireColor('bottom-right-h')} strokeWidth={wireWidth('bottom-right-h')}
        />

        <Battery x={battery.x} y={battery.y} e={E} />
        <Resistor x={resistor.x} y={resistor.y} r={R} />
        <Inductor x={inductor.x} y={inductor.y} l={L} i={iL} iMax={iMax} />
        <g onClick={cycleSwitch} style={{ cursor: 'pointer' }}>
          <rect x={switchPivot.x - 34} y={switchPivot.y - 34} width={68} height={44} fill="transparent" />
          <Switch x={switchPivot.x} y={switchPivot.y} pos={switchPos} />
        </g>

        {/* ─── Flowing-current dots along active loop ────────────────── */}
        {establishActive && (
          <g key="establish-flow">
            <path id="establish-flow-path" d={establishFlowD} fill="none" stroke="none" />
            {[0, 0.5, 1.0, 1.5].map((delay) => (
              <circle key={`ef${delay}`} r={2.6} fill={establishColor}>
                <animateMotion dur="2s" repeatCount="indefinite" begin={`${delay}s`} rotate="auto">
                  <mpath href="#establish-flow-path" />
                </animateMotion>
              </circle>
            ))}
          </g>
        )}
        {breakActive && (
          <g key="break-flow">
            <path id="break-flow-path" d={breakFlowD} fill="none" stroke="none" />
            {[0, 0.4, 0.8, 1.2].map((delay) => (
              <circle key={`bf${delay}`} r={2.6} fill={breakColor}>
                <animateMotion dur="1.6s" repeatCount="indefinite" begin={`${delay}s`} rotate="auto">
                  <mpath href="#break-flow-path" />
                </animateMotion>
              </circle>
            ))}
          </g>
        )}

        {/* Switch labels */}
        <text
          x={switchPivot.x - 30}
          y={switchPivot.y - 22}
          fill={switchPos === 'establish' ? '#37C9B8' : '#54617A'}
          fontFamily="'JetBrains Mono', monospace"
          fontSize={10}
          textAnchor="end"
        >
          {labels.establish_label}
        </text>
        <text
          x={switchPivot.x + 30}
          y={switchPivot.y - 22}
          fill={switchPos === 'break' ? '#F97316' : '#54617A'}
          fontFamily="'JetBrains Mono', monospace"
          fontSize={10}
          textAnchor="start"
        >
          {labels.break_label}
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

        {/* ─── Right panel: i(t) plot ─────────────────────────────────── */}
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
          i (t)
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
          i (A) →
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
        {[0, I_AXIS_MAX / 2, I_AXIS_MAX * (4 / 5)].map((v) => (
          <text
            key={`ik${v.toFixed(2)}`}
            x={PLOT_X - 6}
            y={iToSvgY(v) + 3}
            fill="#54617A"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={9}
            textAnchor="end"
          >
            {v.toFixed(1)}
          </text>
        ))}
        {/* Stage 1 canonical markers (training wheels — REMOVED on later stages) */}
        {isStage1 && (
          <>
            {/* I_max asymptote (student's current I_max) */}
            {iMax <= I_AXIS_MAX && (
              <line
                x1={PLOT_X}
                y1={iToSvgY(iMax)}
                x2={PLOT_X + PLOT_W}
                y2={iToSvgY(iMax)}
                stroke="#37C9B8"
                strokeWidth={1}
                strokeDasharray="3 4"
                opacity={0.35}
              />
            )}
            {/* 0.63 · I_max dashed marker */}
            {iMax <= I_AXIS_MAX && (
              <>
                <line
                  x1={PLOT_X}
                  y1={iToSvgY(0.63 * iMax)}
                  x2={PLOT_X + PLOT_W}
                  y2={iToSvgY(0.63 * iMax)}
                  stroke="#F9A968"
                  strokeWidth={1}
                  strokeDasharray="3 4"
                  opacity={0.4}
                />
                <text
                  x={PLOT_X + PLOT_W - 4}
                  y={iToSvgY(0.63 * iMax) - 4}
                  fill="#F9A968"
                  fontFamily="'JetBrains Mono', monospace"
                  fontSize={9}
                  textAnchor="end"
                >
                  0.63·I_max
                </text>
              </>
            )}
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
              <circle cx={tToSvgX(stage2Target.tStar)} cy={iToSvgY(stage2Target.iStar)} r={6} fill="#F97316" />
              <circle
                cx={tToSvgX(stage2Target.tStar)}
                cy={iToSvgY(stage2Target.iStar)}
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
                y2={iToSvgY(stage2Target.iStar)}
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
                y={iToSvgY(stage2Target.iStar) + 3}
                fill="#F9A968"
                fontFamily="'JetBrains Mono', monospace"
                fontSize={10}
                textAnchor="end"
              >
                i*={stage2Target.iStar.toFixed(2)}
              </text>
            </g>
          </>
        )}
        {isStage3 && (
          <path d={stage3TargetPath} fill="none" stroke="#F97316" strokeWidth={2} opacity={0.9} />
        )}
        {/* §4.7 rule 4: peek shows a READING-METHOD hint, never τ*.
            No dashed line at tToSvgX(tauStar), no τ* value in HUD. */}
        {isStage3 && peekVisible && (
          <text
            x={PLOT_X + PLOT_W / 2}
            y={PLOT_Y - 26}
            fill="#37C9B8"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={9}
            textAnchor="middle"
          >
            {labels.peek_hint}
          </text>
        )}
        {tracePath && (
          <path d={tracePath} fill="none" stroke="#37C9B8" strokeWidth={2} />
        )}
        {/* Live time cursor: suppressed on stage 3 entirely so pre-submit
            reveals nothing about the sim's progress. */}
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
      {/* BR corner: intentionally EMPTY — reserved for parent-side chrome. */}

      {/* ─── R and L vertical sliders (top-right, stacked column) ────── */}
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
            {R_MAX}Ω
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
            {R_MIN}Ω
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.6rem', color: '#37C9B8' }}>
            R = {R >= 10 ? R.toFixed(1) : R.toFixed(2)}Ω
          </div>
        </div>
        {/* L slider */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.6rem' }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.6rem', color: '#6C7A93' }}>
            {L_MAX}H
          </div>
          <div style={{ width: '2rem', height: '24rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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
            {L_MIN}H
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.6rem', color: '#37C9B8' }}>
            L = {L.toFixed(2)}H
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
