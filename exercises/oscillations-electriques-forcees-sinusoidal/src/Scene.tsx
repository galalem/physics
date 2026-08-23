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
import { Gbf } from './art/Gbf'
import { Resistor } from './art/Resistor'
import { Inductor } from './art/Inductor'
import { Capacitor } from './art/Capacitor'

// ─── Scene constants ────────────────────────────────────────────────────
const W = 800
const H = 450

// Left panel: circuit schematic
const SCH_X = 32
const SCH_Y = 60
const SCH_W = 360
const SCH_H = 350

// Right panel: i(t) time-series plot
const PLOT_X = 412
const PLOT_Y = 60
const PLOT_W = 250
const PLOT_H = 350

// ─── Physics constants ─────────────────────────────────────────────────
const U_MAX = 5 // V — forced EMF amplitude
const L = 1 // H — fixed inductance
const C = 1e-3 // F — fixed capacitance (1 mF)
const OMEGA_0 = 1 / Math.sqrt(L * C) // ≈ 31.62 rad/s

const OMEGA_MIN = 10 // rad/s
const OMEGA_MAX = 100 // rad/s
const OMEGA_DEFAULT = 15

const R_MIN = 5 // Ω
const R_MAX = 50 // Ω
const R_DEFAULT = 25

const T_SIM_MAX = 2 // seconds (chart x-axis)

// y-axis range in amperes: max possible I_max is U_MAX / R_MIN = 1 A;
// clip for visual sanity to ±0.6 A so most curves stay in view.
const I_YMAX = 0.6 // A

// Tolerances
const STAGE2_TOL = 0.05 // ±5% on I_max
const STAGE3_TOL = 0.03 // ±3% on ω

// ─── Seeded targets (hand-authored) ────────────────────────────────────
// Stage 2: target peak current I_max* (A).
const STAGE2_TARGETS: { iMaxStar: number }[] = [
  { iMaxStar: 0.20 },
  { iMaxStar: 0.15 },
  { iMaxStar: 0.10 },
  { iMaxStar: 0.25 },
  { iMaxStar: 0.08 },
]

// Stage 3: hidden (ω*, R*) pairs — student reads ω* from the target period.
const STAGE3_TARGETS: { omegaStar: number; rStar: number }[] = [
  { omegaStar: OMEGA_0, rStar: 20 }, // resonance, I_max = 250 mA
  { omegaStar: 20, rStar: 25 }, // below resonance
  { omegaStar: 50, rStar: 15 }, // above resonance
  { omegaStar: 40, rStar: 10 },
  { omegaStar: 25, rStar: 30 },
]

// ─── i18n label helper ────────────────────────────────────────────────
const dict = { en, fr, ar } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── Physics helpers ───────────────────────────────────────────────────
/** Impedance Z(ω) of the series RLC. */
function impedance(omega: number, r: number): number {
  const x = L * omega - 1 / (C * omega)
  return Math.sqrt(r * r + x * x)
}
/** Steady-state phase shift φ(ω): tan φ = (Lω − 1/(Cω)) / R. */
function phaseShift(omega: number, r: number): number {
  return Math.atan2(L * omega - 1 / (C * omega), r)
}
/** Peak current I_max = U_max / Z. */
function iMaxOf(omega: number, r: number): number {
  return U_MAX / impedance(omega, r)
}

/** Format a small current for HUD display. */
function formatI(iAmps: number): string {
  const mA = iAmps * 1000
  if (mA >= 100) return `${mA.toFixed(0)} mA`
  return `${mA.toFixed(1)} mA`
}
/** Format ω for HUD display. */
function formatOmega(omega: number): string {
  return `${omega.toFixed(1)} rad/s`
}
/** Format R for HUD display. */
function formatR(r: number): string {
  return r >= 10 ? `${r.toFixed(0)} Ω` : `${r.toFixed(1)} Ω`
}

// ─── Log-slider mapping ────────────────────────────────────────────────
function toLog(value: number, min: number, max: number): number {
  return (Math.log(value) - Math.log(min)) / (Math.log(max) - Math.log(min))
}
function fromLog(pos: number, min: number, max: number): number {
  return min * Math.pow(max / min, pos)
}

// ─── Plot coordinate helpers ───────────────────────────────────────────
function tToSvgX(t: number): number {
  return PLOT_X + (t / T_SIM_MAX) * PLOT_W
}
function iToSvgY(iAmps: number): number {
  // y=0 in the vertical middle of the plot; positive current goes up.
  const mid = PLOT_Y + PLOT_H / 2
  return mid - (iAmps / I_YMAX) * (PLOT_H / 2)
}

/** Sample the steady-state sinusoid i(t) = I_max·cos(ωt − φ) into an SVG path. */
function sinusoidPath(iMax: number, omega: number, phi: number): string {
  const steps = 240
  let d = ''
  for (let k = 0; k <= steps; k++) {
    const t = (k / steps) * T_SIM_MAX
    const i = iMax * Math.cos(omega * t - phi)
    // Clip vertically so out-of-range peaks don't spill into HUD.
    const clipped = Math.max(-I_YMAX, Math.min(I_YMAX, i))
    const sx = tToSvgX(t)
    const sy = iToSvgY(clipped)
    d += `${k === 0 ? 'M' : 'L'} ${sx.toFixed(1)} ${sy.toFixed(1)} `
  }
  return d
}

// ─── Component ────────────────────────────────────────────────────────
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
  const omegaStar = stage3Target.omegaStar
  const rStar = stage3Target.rStar

  const stageIdx = useCurrentStage()
  const setStage = useSetStage()
  const progress = useProgress()
  const complete = useComplete()

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  // ─── Sliders (DOFs) ─────────────────────────────────────────────────
  const [omega, setOmega] = useState(OMEGA_DEFAULT)
  const [rVal, setR] = useState(R_DEFAULT)

  // Stage-1 coverage flags
  const [omegaMoved, setOmegaMoved] = useState(false)
  const [rMoved, setRMoved] = useState(false)
  const [crossedResonance, setCrossedResonance] = useState(false)

  // Stage-2 hit flag
  const [stage2Hit, setStage2Hit] = useState(false)

  // Stage-3 submit state
  const [submitted, setSubmitted] = useState(false)

  // Peek text visibility
  const [peekVisible, setPeekVisible] = useState(false)

  // Wall-clock t for playhead cursor (visual heartbeat)
  const [tCursor, setTCursor] = useState(0)

  // Derived physics
  const iMax = iMaxOf(omega, rVal)
  const phi = phaseShift(omega, rVal)
  const z = impedance(omega, rVal)

  // Target-curve derived values (stage 3)
  const iMaxTarget = iMaxOf(omegaStar, rStar)
  const phiTarget = phaseShift(omegaStar, rStar)

  const resetStageState = useCallback(() => {
    setOmega(OMEGA_DEFAULT)
    setR(R_DEFAULT)
    setOmegaMoved(false)
    setRMoved(false)
    setCrossedResonance(false)
    setStage2Hit(false)
    setSubmitted(false)
    setPeekVisible(false)
    setTCursor(0)
  }, [])
  useReset(resetStageState)

  // ─── Ticker: playhead animation + stage-1 resonance crossing ──────
  useTicker((dt) => {
    if (isStage3 && !submitted) {
      // No visual heartbeat while student is thinking blind
      if (tCursor !== 0) setTCursor(0)
      return
    }
    setTCursor((prev) => {
      const nxt = prev + dt
      return nxt > T_SIM_MAX ? 0 : nxt
    })
    if (isStage1 && !crossedResonance) {
      if (Math.abs(omega - OMEGA_0) / OMEGA_0 < 0.15) setCrossedResonance(true)
    }
  })

  // ─── Stage-2 hit detection (react to iMax change) ────────────────
  useEffect(() => {
    if (!isStage2 || stage2Hit) return
    const rel = Math.abs(iMax - stage2Target.iMaxStar) / stage2Target.iMaxStar
    if (rel < STAGE2_TOL) setStage2Hit(true)
  }, [isStage2, iMax, stage2Target, stage2Hit])

  const canSubmit = isStage1
    ? omegaMoved && rMoved && crossedResonance
    : isStage2
      ? stage2Hit
      : submitted && Math.abs(omega - omegaStar) / omegaStar < STAGE3_TOL

  useEffect(() => {
    progress(stageIdx / 3, { stage: stageIdx, canSubmit })
  }, [stageIdx, canSubmit, progress])

  useNext(() => {
    if (stageIdx < 3) {
      setStage(stageIdx + 1)
      resetStageState()
    } else {
      complete({ success: true })
    }
  })

  // ─── Peek: reading-method hint only (NO reveal of ω*) ─────────────
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

  const submitStage3 = useCallback(() => {
    setSubmitted(true)
    setTCursor(0)
  }, [])

  // ─── Pre-computed curve paths ────────────────────────────────────
  const livePath = useMemo(() => {
    // Hide live curve on stage 3 before submit (blind stage)
    if (isStage3 && !submitted) return ''
    return sinusoidPath(iMax, omega, phi)
  }, [iMax, omega, phi, isStage3, submitted])

  const stage3TargetPath = useMemo(() => {
    if (!isStage3) return ''
    return sinusoidPath(iMaxTarget, omegaStar, phiTarget)
  }, [isStage3, iMaxTarget, omegaStar, phiTarget])

  // ─── Chart grid ──────────────────────────────────────────────────
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

  // ─── Circuit schematic geometry ─────────────────────────────────
  const rect = {
    left: SCH_X + 40,
    right: SCH_X + SCH_W - 40,
    top: SCH_Y + 80,
    bottom: SCH_Y + SCH_H - 80,
  }
  const gbf = { x: rect.left, y: (rect.top + rect.bottom) / 2 }
  const seg = (rect.right - rect.left) / 3
  const resistor = { x: rect.left + seg * 0.5, y: rect.top }
  const inductor = { x: rect.left + seg * 1.5, y: rect.top }
  const capacitor = { x: rect.left + seg * 2.5, y: rect.top }

  const wireStroke = '#54617A'
  const wireW = 1.6
  const activeColor = '#37C9B8'
  const showFlow = !(isStage3 && !submitted)
  const wireColor = showFlow ? activeColor : wireStroke
  const wireWidth = showFlow ? wireW + 0.6 : wireW

  // Current-direction dots animation path (loop around the mesh)
  const flowD = [
    `M ${gbf.x} ${gbf.y - 18}`,
    `L ${gbf.x} ${rect.top}`,
    `L ${rect.right} ${rect.top}`,
    `L ${rect.right} ${rect.bottom}`,
    `L ${gbf.x} ${rect.bottom}`,
    `L ${gbf.x} ${gbf.y + 18}`,
  ].join(' ')

  // Animation speed proportional to ω for pedagogical realism
  const flowDur = Math.max(0.6, 6.0 / Math.max(1, omega / 5))

  // ─── HUD strings ─────────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`

  // TR: required info — student needs to know their current ω, Z, and I_max
  // to align paper math with the sim on stage 3.
  const hudTR = isStage3
    ? submitted
      ? Math.abs(omega - omegaStar) / omegaStar < STAGE3_TOL
        ? `${labels.match_ok} · ω = ${formatOmega(omega)}`
        : `${labels.match_off} · Δω = ${(100 * Math.abs(omega - omegaStar) / omegaStar).toFixed(1)}%`
      : `ω = ${formatOmega(omega)} · Z = ${z.toFixed(1)} Ω`
    : isStage2
      ? stage2Hit
        ? `${labels.hit} · I = ${formatI(iMax)}`
        : `I = ${formatI(iMax)} · ω = ${formatOmega(omega)}`
      : `I = ${formatI(iMax)} · ω = ${formatOmega(omega)}`

  const hudBL = isStage1 ? labels.tip1 : isStage2 ? labels.tip2 : labels.tip3
  // BR: intentionally empty — reserved for parent-side chrome (fullscreen).

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block', userSelect: 'none' }}
      >
        {/* NO borderRadius on <svg>. NO rx on the bg <rect>. */}
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        {/* ─── Left panel: circuit schematic ─────────────────────── */}
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

        {/* Wires — series loop */}
        {/* Left vertical: GBF top → rect.top */}
        <line x1={gbf.x} y1={gbf.y - 18} x2={gbf.x} y2={rect.top} stroke={wireColor} strokeWidth={wireWidth} />
        {/* Left vertical: GBF bottom → rect.bottom */}
        <line x1={gbf.x} y1={gbf.y + 18} x2={gbf.x} y2={rect.bottom} stroke={wireColor} strokeWidth={wireWidth} />
        {/* Top rail: rect.left → resistor.left */}
        <line x1={gbf.x} y1={rect.top} x2={resistor.x - 22} y2={rect.top} stroke={wireColor} strokeWidth={wireWidth} />
        {/* Top rail: resistor.right → inductor.left */}
        <line x1={resistor.x + 22} y1={rect.top} x2={inductor.x - 22} y2={rect.top} stroke={wireColor} strokeWidth={wireWidth} />
        {/* Top rail: inductor.right → capacitor.left */}
        <line x1={inductor.x + 22} y1={rect.top} x2={capacitor.x - 4} y2={rect.top} stroke={wireColor} strokeWidth={wireWidth} />
        {/* Top rail: capacitor.right → rect.right */}
        <line x1={capacitor.x + 4} y1={rect.top} x2={rect.right} y2={rect.top} stroke={wireColor} strokeWidth={wireWidth} />
        {/* Right vertical */}
        <line x1={rect.right} y1={rect.top} x2={rect.right} y2={rect.bottom} stroke={wireColor} strokeWidth={wireWidth} />
        {/* Bottom rail */}
        <line x1={gbf.x} y1={rect.bottom} x2={rect.right} y2={rect.bottom} stroke={wireColor} strokeWidth={wireWidth} />

        {/* Components */}
        <Gbf x={gbf.x} y={gbf.y} uMax={U_MAX} label={labels.gbf_label} />
        <Resistor x={resistor.x} y={resistor.y} r={rVal} />
        <Inductor x={inductor.x} y={inductor.y} l={L} />
        <Capacitor x={capacitor.x} y={capacitor.y} c={C} />

        {/* Flowing current dots (paused on blind stage pre-submit) */}
        {showFlow && (
          <g key={`flow-${flowDur.toFixed(2)}`}>
            <path id="rlc-flow-path" d={flowD} fill="none" stroke="none" />
            {[0, 0.25, 0.5, 0.75].map((delay) => (
              <circle key={`fdot${delay}`} r={2.4} fill={activeColor}>
                <animateMotion dur={`${flowDur}s`} repeatCount="indefinite" begin={`${delay * flowDur}s`}>
                  <mpath href="#rlc-flow-path" />
                </animateMotion>
              </circle>
            ))}
          </g>
        )}

        {/* ─── Right panel: i(t) plot ─────────────────────────────── */}
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

        {/* Zero-line (i = 0) */}
        <line
          x1={PLOT_X}
          y1={iToSvgY(0)}
          x2={PLOT_X + PLOT_W}
          y2={iToSvgY(0)}
          stroke="#3A4863"
          strokeWidth={1.2}
        />
        {/* Y-axis */}
        <line x1={PLOT_X} y1={PLOT_Y} x2={PLOT_X} y2={PLOT_Y + PLOT_H} stroke="#3A4863" strokeWidth={1.5} />

        {/* Axis labels */}
        <text
          x={PLOT_X + PLOT_W - 6}
          y={iToSvgY(0) - 4}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={10}
          textAnchor="end"
        >
          {labels.t_axis_label} →
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

        {/* t tick labels */}
        {[0, 0.5, 1.0, 1.5, 2.0].map((tv) => (
          <text
            key={`tk${tv}`}
            x={tToSvgX(tv)}
            y={iToSvgY(0) + 12}
            fill="#54617A"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={9}
            textAnchor="middle"
          >
            {tv.toFixed(1)}
          </text>
        ))}
        {/* i tick labels (in mA, ±) */}
        {[-500, -250, 0, 250, 500].map((mA) => (
          <text
            key={`ik${mA}`}
            x={PLOT_X - 6}
            y={iToSvgY(mA / 1000) + 3}
            fill="#54617A"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={9}
            textAnchor="end"
          >
            {mA}
          </text>
        ))}

        {/* ─── Stage-1 canonical markers (help — REMOVED on stage 3) ── */}
        {isStage1 && (
          <>
            {/* Envelope lines at current ±I_max */}
            <line
              x1={PLOT_X}
              y1={iToSvgY(Math.min(iMax, I_YMAX))}
              x2={PLOT_X + PLOT_W}
              y2={iToSvgY(Math.min(iMax, I_YMAX))}
              stroke="#F9A968"
              strokeWidth={1}
              strokeDasharray="3 4"
              opacity={0.5}
            />
            <line
              x1={PLOT_X}
              y1={iToSvgY(-Math.min(iMax, I_YMAX))}
              x2={PLOT_X + PLOT_W}
              y2={iToSvgY(-Math.min(iMax, I_YMAX))}
              stroke="#F9A968"
              strokeWidth={1}
              strokeDasharray="3 4"
              opacity={0.5}
            />
            <text
              x={PLOT_X + PLOT_W - 4}
              y={iToSvgY(Math.min(iMax, I_YMAX)) - 4}
              fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={9}
              textAnchor="end"
            >
              +Imax
            </text>
            {/* Resonance status chip */}
            {Math.abs(omega - OMEGA_0) / OMEGA_0 < 0.15 && (
              <text
                x={PLOT_X + PLOT_W / 2}
                y={PLOT_Y - 2}
                fill="#37C9B8"
                fontFamily="'JetBrains Mono', monospace"
                fontSize={10}
                textAnchor="middle"
              >
                {labels.resonance_marker} ≈ {OMEGA_0.toFixed(1)}
              </text>
            )}
          </>
        )}

        {/* ─── Stage-2 target amplitude marker (help kept: it IS the target) ── */}
        {isStage2 && (
          <>
            <line
              x1={PLOT_X}
              y1={iToSvgY(stage2Target.iMaxStar)}
              x2={PLOT_X + PLOT_W}
              y2={iToSvgY(stage2Target.iMaxStar)}
              stroke="#F97316"
              strokeWidth={1.4}
              strokeDasharray="4 5"
              opacity={0.85}
            />
            <line
              x1={PLOT_X}
              y1={iToSvgY(-stage2Target.iMaxStar)}
              x2={PLOT_X + PLOT_W}
              y2={iToSvgY(-stage2Target.iMaxStar)}
              stroke="#F97316"
              strokeWidth={1.4}
              strokeDasharray="4 5"
              opacity={0.85}
            />
            <text
              x={PLOT_X + PLOT_W - 4}
              y={iToSvgY(stage2Target.iMaxStar) - 4}
              fill="#F97316"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
              textAnchor="end"
            >
              I* = {formatI(stage2Target.iMaxStar)}
            </text>
          </>
        )}

        {/* ─── Stage-3 target sinusoid (always visible) ── */}
        {isStage3 && (
          <path d={stage3TargetPath} fill="none" stroke="#F97316" strokeWidth={2} opacity={0.9} />
        )}

        {/* Stage-3 peek: reading-method text overlay (NOT ω* reveal) */}
        {isStage3 && peekVisible && (
          <>
            <rect
              x={PLOT_X + 4}
              y={PLOT_Y + 6}
              width={PLOT_W - 8}
              height={26}
              fill="#0D1524"
              stroke="#37C9B8"
              strokeWidth={0.8}
              opacity={0.92}
              rx={4}
            />
            <text
              x={PLOT_X + PLOT_W / 2}
              y={PLOT_Y + 22}
              fill="#37C9B8"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={9}
              textAnchor="middle"
            >
              {labels.peek_hint}
            </text>
          </>
        )}

        {/* ─── Live curve (hidden on stage 3 before submit) ── */}
        {livePath && (
          <path d={livePath} fill="none" stroke="#37C9B8" strokeWidth={2} />
        )}

        {/* Stage-1/2 playhead cursor (visual heartbeat) */}
        {!isStage3 && tCursor > 0 && (
          <line
            x1={tToSvgX(tCursor)}
            y1={PLOT_Y}
            x2={tToSvgX(tCursor)}
            y2={PLOT_Y + PLOT_H}
            stroke="#F9A968"
            strokeWidth={0.8}
            opacity={0.3}
          />
        )}

        {/* ω₀ (resonance) reference dashed vertical on t-axis?  It is a
            frequency, not a time — no corresponding vertical on i(t) chart.
            Show it as text label only on stage 1 (already done above). */}
      </svg>

      {/* ─── HUD overlays (HTML in rem) ────────────────────────────── */}
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
          textAlign: 'right',
          maxWidth: '46%',
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
      {/* BR overlay OMITTED — reserved for parent-side chrome. */}

      {/* ─── ω and R vertical sliders (top-right stacked column) ── */}
      <div
        style={{
          position: 'absolute',
          top: '18rem',
          right: '3rem',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '2rem',
          zIndex: 6,
        }}
      >
        {/* ω slider */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.6rem' }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.6rem', color: '#6C7A93' }}>
            {OMEGA_MAX}
          </div>
          <div style={{ width: '2rem', height: '18rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <input
              type="range"
              min={0}
              max={1000}
              step={1}
              value={Math.round(toLog(omega, OMEGA_MIN, OMEGA_MAX) * 1000)}
              onChange={(e) => {
                setOmega(fromLog(Number(e.target.value) / 1000, OMEGA_MIN, OMEGA_MAX))
                setOmegaMoved(true)
              }}
              disabled={isStage3 && submitted}
              style={{
                width: '18rem',
                height: '2rem',
                transform: 'rotate(-90deg)',
                transformOrigin: 'center',
                accentColor: '#37C9B8',
                cursor: isStage3 && submitted ? 'not-allowed' : 'pointer',
              }}
            />
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.6rem', color: '#6C7A93' }}>
            {OMEGA_MIN}
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.6rem', color: '#37C9B8' }}>
            ω = {omega.toFixed(1)}
          </div>
        </div>
        {/* R slider */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.6rem' }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.6rem', color: '#6C7A93' }}>
            {R_MAX}Ω
          </div>
          <div style={{ width: '2rem', height: '14rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <input
              type="range"
              min={0}
              max={1000}
              step={1}
              value={Math.round(toLog(rVal, R_MIN, R_MAX) * 1000)}
              onChange={(e) => {
                setR(fromLog(Number(e.target.value) / 1000, R_MIN, R_MAX))
                setRMoved(true)
              }}
              disabled={isStage3 && submitted}
              style={{
                width: '14rem',
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
            R = {formatR(rVal)}
          </div>
        </div>
      </div>

      {/* Stage-3 SUBMIT button (bottom-center, only before submit) */}
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
