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

// ─── Scene constants ────────────────────────────────────────────────────
const W = 800
const H = 450

// Left panel: circuit schematic
const SCH_X = 32
const SCH_Y = 60
const SCH_W = 360
const SCH_H = 350

// Right panel: I_C(V_CE) fan (Stage 1) / V_CE(t) scope (Stages 2, 3)
const PLOT_X = 412
const PLOT_Y = 60
const PLOT_W = 250
const PLOT_H = 350

// ─── BJT physics constants ─────────────────────────────────────────────
const BETA = 100 // DC current gain
const V_CC = 12 // supply rail (V)
const R_C = 1000 // collector resistor (Ω)
const V_CE_SAT = 0.2 // saturation residual (V)
const IB_SAT_A = V_CC / (BETA * R_C) // 120 µA
const IC_MAX_A = V_CC / R_C // 12 mA

// Stage 1 sweep
const IB_MIN_UA = 0
const IB_MAX_UA = 160
const IB_DEFAULT_UA = 0

// Regime witness thresholds (Stage 1)
const IB_CUTOFF_UA = 3 // I_B ≤ 3 µA → cut-off
const IB_ACTIVE_LO_UA = 20 // active band
const IB_ACTIVE_HI_UA = 100
const IB_SAT_WITNESS_UA = 130 // I_B ≥ 130 µA → saturation

// Stage 2 / 3 scope
const SCOPE_WINDOW_S = 2
const AC_FREQ = 1 // Hz

// Plot ranges (I_C(V_CE))
const VCE_MIN = 0
const VCE_MAX = 14
const IC_MIN_MA = 0
const IC_MAX_MA = 15

// Scope voltage range (V_CE)
const SCOPE_V_MIN = -1
const SCOPE_V_MAX = 14

// ─── Types ─────────────────────────────────────────────────────────────
type Mode = 'switch' | 'amp'
type ScenarioId = 'cutoff' | 'active' | 'saturated'
const BLIND_DECK: ScenarioId[] = ['cutoff', 'active', 'saturated']

// ─── Label loader ───────────────────────────────────────────────────────
const dict = { en } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── Pure physics ───────────────────────────────────────────────────────
/** Collector current given a base current (Amps → Amps). Clamped at saturation. */
function bjtIc(iB_A: number): number {
  if (iB_A <= 0) return 0
  const iActive = BETA * iB_A
  return Math.min(iActive, IC_MAX_A)
}

/** Collector–emitter voltage given a base current (Amps → Volts). */
function bjtVce(iB_A: number): number {
  const iC = bjtIc(iB_A)
  const vce = V_CC - iC * R_C
  return Math.max(V_CE_SAT, vce)
}

/** I_B(t) for stage-2 experimental waveforms. */
function ibWaveform(mode: Mode, t: number): number {
  if (mode === 'switch') {
    // Square wave 0 / 150 µA at AC_FREQ Hz — drives cutoff ↔ saturation
    const period = 1 / AC_FREQ
    return (t % period) < period / 2 ? 0 : 150e-6
  }
  // Amplifier: bias 60 µA, small ±30 µA sine → stays inside active region
  return 60e-6 + 30e-6 * Math.sin(2 * Math.PI * AC_FREQ * t)
}

/** I_B(t) for stage-3 blind scenarios. */
function scenarioIb(s: ScenarioId, t: number): number {
  if (s === 'cutoff') return 0
  if (s === 'active') return ibWaveform('amp', t)
  // 'saturated': large-amplitude drive that pushes past IB_SAT and below 0
  const raw = 80e-6 + 100e-6 * Math.sin(2 * Math.PI * AC_FREQ * t)
  return Math.max(0, raw)
}

// ─── Plot coord helpers (I_C vs V_CE fan) ──────────────────────────────
function vceToSvgX(v: number): number {
  return PLOT_X + ((v - VCE_MIN) / (VCE_MAX - VCE_MIN)) * PLOT_W
}
function icToSvgY(iMa: number): number {
  return PLOT_Y + PLOT_H - ((iMa - IC_MIN_MA) / (IC_MAX_MA - IC_MIN_MA)) * PLOT_H
}

// Scope coord helpers (V_CE(t))
function tToScopeX(t: number): number {
  return PLOT_X + (t / SCOPE_WINDOW_S) * PLOT_W
}
function vToScopeY(v: number): number {
  return PLOT_Y + PLOT_H - ((v - SCOPE_V_MIN) / (SCOPE_V_MAX - SCOPE_V_MIN)) * PLOT_H
}

// ─── Component ──────────────────────────────────────────────────────────
export default function Scene() {
  const { locale } = useInit()
  const stages = useMemo(() => getStagesFor(locale), [locale])
  useDeclareStages(stages)
  const labels = useMemo(() => svgLabels(locale), [locale])
  const rootRng = useSeed()

  // Seeded deck order — deterministic per seed
  const deckOrder = useMemo(() => rootRng.shuffle([...BLIND_DECK]), [rootRng])

  const stageIdx = useCurrentStage()
  const setStage = useSetStage()
  const progress = useProgress()
  const complete = useComplete()

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  // ─── Stage 1 state ────────────────────────────────────────────────────
  const [ibUa, setIbUa] = useState<number>(IB_DEFAULT_UA)
  const [seenCutoff, setSeenCutoff] = useState(false)
  const [seenActive, setSeenActive] = useState(false)
  const [seenSat, setSeenSat] = useState(false)

  // ─── Stage 2 state ────────────────────────────────────────────────────
  const [mode, setMode] = useState<Mode>('switch')
  const [seenSwitch, setSeenSwitch] = useState(false)
  const [seenAmp, setSeenAmp] = useState(false)
  const [modeToggles, setModeToggles] = useState(0)

  // ─── Stage 3 state ────────────────────────────────────────────────────
  const [deckIdx, setDeckIdx] = useState(0)
  const [blindPick, setBlindPick] = useState<ScenarioId | null>(null)
  const [blindSubmitted, setBlindSubmitted] = useState(false)
  const [blindCorrect, setBlindCorrect] = useState(false)
  const [blindSolved, setBlindSolved] = useState(0)
  const [peekTipIdx, setPeekTipIdx] = useState(0)
  const [peekTip, setPeekTip] = useState<string | null>(null)

  const currentTarget = deckOrder[deckIdx % deckOrder.length]!

  // Scope animation clock (stages 2 & 3)
  const [scopeT, setScopeT] = useState(0)
  useTicker((dt) => {
    if (!isStage2 && !isStage3) return
    setScopeT((prev) => (prev + dt) % SCOPE_WINDOW_S)
  })

  // Stage 1 regime witness tracking (derived from ibUa)
  useEffect(() => {
    if (!isStage1) return
    if (ibUa <= IB_CUTOFF_UA) setSeenCutoff(true)
    if (ibUa >= IB_ACTIVE_LO_UA && ibUa <= IB_ACTIVE_HI_UA) setSeenActive(true)
    if (ibUa >= IB_SAT_WITNESS_UA) setSeenSat(true)
  }, [ibUa, isStage1])

  const resetStageState = useCallback(() => {
    setIbUa(IB_DEFAULT_UA)
    setSeenCutoff(false)
    setSeenActive(false)
    setSeenSat(false)
    setMode('switch')
    setSeenSwitch(false)
    setSeenAmp(false)
    setModeToggles(0)
    setDeckIdx(0)
    setBlindPick(null)
    setBlindSubmitted(false)
    setBlindCorrect(false)
    setBlindSolved(0)
    setScopeT(0)
    setPeekTip(null)
    setPeekTipIdx(0)
  }, [])

  useReset(resetStageState)

  // ─── Advance predicates ────────────────────────────────────────────────
  const stage1Done = seenCutoff && seenActive && seenSat
  const stage2Done = seenSwitch && seenAmp && modeToggles >= 1
  const stage3Done = blindSolved >= BLIND_DECK.length

  const canSubmit = isStage1 ? stage1Done : isStage2 ? stage2Done : stage3Done

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

  // ─── Stage 3: submit handler (only fires on SUBMIT click) ──────────────
  const handleBlindSubmit = useCallback(() => {
    if (!blindPick || blindSubmitted) return
    const correct = blindPick === currentTarget
    setBlindSubmitted(true)
    setBlindCorrect(correct)
    if (correct) {
      const newSolved = blindSolved + 1
      setBlindSolved(newSolved)
      if (newSolved < BLIND_DECK.length) {
        setTimeout(() => {
          setDeckIdx((i) => i + 1)
          setBlindPick(null)
          setBlindSubmitted(false)
          setBlindCorrect(false)
        }, 1200)
      }
      // else: last-scenario ace — stays visible until Next is pressed
    } else {
      setTimeout(() => {
        setDeckIdx(0)
        setBlindPick(null)
        setBlindSubmitted(false)
        setBlindCorrect(false)
        setBlindSolved(0)
      }, 1400)
    }
  }, [blindPick, blindSubmitted, blindSolved, currentTarget])

  // ─── Peek: strategy hint, NOT the answer ───────────────────────────────
  const PEEK_TIPS = useMemo(
    () => [labels.peek_tip_1, labels.peek_tip_2],
    [labels],
  )
  usePeek(() => {
    if (!isStage3) return
    setPeekTip(PEEK_TIPS[peekTipIdx % PEEK_TIPS.length]!)
    setPeekTipIdx((n) => n + 1)
  })
  useEffect(() => {
    if (!peekTip) return
    const t = setTimeout(() => setPeekTip(null), 4000)
    return () => clearTimeout(t)
  }, [peekTip])

  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  // ─── Operating point (Stage 1) ─────────────────────────────────────────
  const ibA = ibUa * 1e-6
  const icMa = bjtIc(ibA) * 1000
  const vceV = bjtVce(ibA)
  const conducting = icMa > 0.5
  const regime: 'cutoff' | 'active' | 'saturated' =
    ibUa <= IB_CUTOFF_UA
      ? 'cutoff'
      : ibA >= IB_SAT_A - 1e-9
        ? 'saturated'
        : 'active'

  // ─── Scope traces (Stage 2 + 3) ────────────────────────────────────────
  function buildScopeTrace(fn: (t: number) => number): string {
    const steps = 200
    let d = ''
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * SCOPE_WINDOW_S
      const v = Math.min(SCOPE_V_MAX, Math.max(SCOPE_V_MIN, fn(t)))
      const sx = tToScopeX(t)
      const sy = vToScopeY(v)
      d += `${i === 0 ? 'M' : 'L'} ${sx.toFixed(1)} ${sy.toFixed(1)} `
    }
    return d
  }

  const stage2InputPath = useMemo(
    () => buildScopeTrace((t) => {
      // Scale I_B waveform onto scope as 0..V_CC visualization
      const ib = ibWaveform(mode, t)
      return (ib / 200e-6) * V_CC * 0.5 + 0.5 // pseudo-signal cue (dashed)
    }),
    [mode],
  )
  const stage2OutputPath = useMemo(
    () => buildScopeTrace((t) => bjtVce(ibWaveform(mode, t))),
    [mode],
  )

  const targetScopePath = useMemo(
    () => buildScopeTrace((t) => bjtVce(scenarioIb(currentTarget, t))),
    [currentTarget],
  )
  const pickScopePath = useMemo(
    () =>
      blindPick
        ? buildScopeTrace((t) => bjtVce(scenarioIb(blindPick, t)))
        : '',
    [blindPick],
  )

  // ─── Circuit schematic geometry ───────────────────────────────────────
  const rail = {
    vcc: SCH_Y + 55,
    gnd: SCH_Y + SCH_H - 55,
    left: SCH_X + 55,
    right: SCH_X + SCH_W - 55,
  }
  const bjt = {
    // Base at left, collector top-right, emitter bottom-right
    baseX: SCH_X + 175,
    baseY: (rail.vcc + rail.gnd) / 2,
    circleR: 22,
  }
  const collectorNode = { x: bjt.baseX + 40, y: bjt.baseY - 22 }
  const emitterNode = { x: bjt.baseX + 40, y: bjt.baseY + 22 }
  const rcMid = { x: collectorNode.x, y: (rail.vcc + collectorNode.y) / 2 }
  const rbMid = { x: (rail.left + bjt.baseX - 8) / 2, y: bjt.baseY }
  const sourceCenter = { x: rail.left, y: bjt.baseY }

  const wireIdle = '#54617A'
  const active = '#37C9B8'
  const wireW = 1.6
  const collectorColor = conducting ? active : wireIdle
  const collectorWidth = conducting ? wireW + 0.6 : wireW

  // ─── HUD strings ──────────────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`

  const hudTR = isStage1
    ? `I_B = ${ibUa.toFixed(0)} uA · V_CE = ${vceV.toFixed(2)} V · I_C = ${icMa.toFixed(1)} mA`
    : isStage2
      ? `MODE: ${mode === 'switch' ? labels.mode_switch : labels.mode_amp}`
      : `${labels.scenario}: ${deckIdx + 1}/${BLIND_DECK.length} · ${blindSolved}/${BLIND_DECK.length} ${labels.solved}`

  const hudBL = isStage3 && peekTip
    ? peekTip
    : blindSubmitted && !blindCorrect
      ? labels.wrong
      : blindSubmitted && blindCorrect
        ? labels.correct
        : isStage1
          ? labels.tip1
          : isStage2
            ? labels.tip2
            : labels.tip3

  // Progress chip below TL — never in BR (§4.3 / §4.7)
  const progressChip = isStage1
    ? `${seenCutoff ? '✓' : '○'} ${labels.cutoff_seen} · ${seenActive ? '✓' : '○'} ${labels.active_seen} · ${seenSat ? '✓' : '○'} ${labels.sat_seen}`
    : isStage2
      ? `${seenSwitch ? '✓' : '○'} ${labels.mode_switch} · ${seenAmp ? '✓' : '○'} ${labels.mode_amp}`
      : null

  const handleModeToggle = useCallback((next: Mode) => {
    setMode((prev) => {
      if (prev !== next) setModeToggles((n) => n + 1)
      return next
    })
    if (next === 'switch') setSeenSwitch(true)
    else setSeenAmp(true)
  }, [])

  // ─── Load line + fan-of-characteristics guide paths ───────────────────
  const loadLinePath = useMemo(() => {
    // I_C(V_CE) = (V_CC - V_CE) / R_C
    const a = { x: vceToSvgX(V_CC), y: icToSvgY(0) }
    const b = { x: vceToSvgX(V_CE_SAT), y: icToSvgY(IC_MAX_A * 1000) }
    return `M ${a.x} ${a.y} L ${b.x} ${b.y}`
  }, [])

  // Family of I_C = β·I_B_k horizontals, saturating at V_CE = V_CE_sat
  const fanCurves = useMemo(() => {
    const ibs = [0, 20, 40, 60, 80, 100, 120] // µA
    return ibs.map((ibK) => {
      const iCA = Math.min(BETA * ibK * 1e-6, IC_MAX_A)
      const iCMa = iCA * 1000
      const yFlat = icToSvgY(iCMa)
      const xLeft = vceToSvgX(V_CE_SAT)
      const xRight = vceToSvgX(VCE_MAX)
      // Vertical segment from (V_CE_sat, 0) to (V_CE_sat, iCMa) then horizontal
      return {
        ibK,
        d: `M ${vceToSvgX(V_CE_SAT).toFixed(1)} ${icToSvgY(0).toFixed(1)} L ${xLeft.toFixed(1)} ${yFlat.toFixed(1)} L ${xRight.toFixed(1)} ${yFlat.toFixed(1)}`,
      }
    })
  }, [])

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

        {/* V_CC rail */}
        <line
          x1={rail.left}
          y1={rail.vcc}
          x2={rail.right}
          y2={rail.vcc}
          stroke="#EAF0FA"
          strokeWidth={1.6}
        />
        <text
          x={rail.right}
          y={rail.vcc - 6}
          fill="#37C9B8"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={10}
          textAnchor="end"
        >
          {labels.vcc_label}
        </text>

        {/* Ground rail */}
        <line
          x1={rail.left}
          y1={rail.gnd}
          x2={rail.right}
          y2={rail.gnd}
          stroke="#EAF0FA"
          strokeWidth={1.6}
        />
        {/* GND ticks */}
        {[0, 1, 2].map((i) => (
          <line
            key={`gnd${i}`}
            x1={rail.left + 40 + i * 8}
            y1={rail.gnd + 2}
            x2={rail.left + 46 + i * 8}
            y2={rail.gnd + 8}
            stroke="#EAF0FA"
            strokeWidth={1}
          />
        ))}

        {/* Collector wire: V_CC rail → R_C → collector node */}
        <line
          x1={collectorNode.x}
          y1={rail.vcc}
          x2={collectorNode.x}
          y2={rcMid.y - 14}
          stroke={collectorColor}
          strokeWidth={collectorWidth}
        />
        <line
          x1={collectorNode.x}
          y1={rcMid.y + 14}
          x2={collectorNode.x}
          y2={collectorNode.y}
          stroke={collectorColor}
          strokeWidth={collectorWidth}
        />

        {/* R_C: zigzag (vertical) */}
        {(() => {
          const rx = rcMid.x
          const ry = rcMid.y
          const zw = 6
          const zh = 22
          const pts: Array<[number, number]> = [
            [rx, ry - zh],
            [rx + zw, ry - zh + 4],
            [rx - zw, ry - zh + 12],
            [rx + zw, ry - zh + 20],
            [rx - zw, ry - zh + 28],
            [rx + zw, ry - zh + 36],
            [rx, ry + zh],
          ]
          const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`).join(' ')
          return (
            <>
              <path d={path} fill="none" stroke="#EAF0FA" strokeWidth={1.8} />
              <text
                x={rx + 14}
                y={ry + 4}
                fill="#6C7A93"
                fontFamily="'JetBrains Mono', monospace"
                fontSize={10}
              >
                R_C=1kΩ
              </text>
            </>
          )
        })()}

        {/* Lamp (below R_C on collector, indicates conducting when bright) */}
        {(() => {
          const lx = collectorNode.x + 40
          const ly = collectorNode.y - 6
          const brightness = Math.min(1, icMa / 10)
          return (
            <g>
              <line
                x1={collectorNode.x}
                y1={collectorNode.y}
                x2={lx - 10}
                y2={ly}
                stroke={conducting ? active : wireIdle}
                strokeWidth={1.2}
                strokeDasharray="2 2"
                opacity={0.6}
              />
              <circle
                cx={lx}
                cy={ly}
                r={8}
                fill="#F97316"
                opacity={0.15 + 0.55 * brightness}
              />
              <circle
                cx={lx}
                cy={ly}
                r={4}
                fill={conducting ? '#F97316' : '#3A4863'}
              />
            </g>
          )
        })()}

        {/* Emitter wire: emitter node → ground rail */}
        <line
          x1={emitterNode.x}
          y1={emitterNode.y}
          x2={emitterNode.x}
          y2={rail.gnd}
          stroke={collectorColor}
          strokeWidth={collectorWidth}
        />

        {/* NPN transistor symbol */}
        {(() => {
          const cx = bjt.baseX + 20
          const cy = bjt.baseY
          const r = bjt.circleR
          // Base line from external base wire into transistor
          const baseWireStart = { x: bjt.baseX - 12, y: cy }
          const baseWireEnd = { x: cx - 8, y: cy }
          // Collector diagonal
          const cLineStart = { x: cx - 8, y: cy - 4 }
          const cLineEnd = collectorNode
          // Emitter diagonal (arrow out)
          const eLineStart = { x: cx - 8, y: cy + 4 }
          const eLineEnd = emitterNode
          return (
            <g>
              <circle cx={cx} cy={cy} r={r} fill="none" stroke="#EAF0FA" strokeWidth={1.4} />
              {/* Vertical base plate */}
              <line
                x1={cx - 8}
                y1={cy - 12}
                x2={cx - 8}
                y2={cy + 12}
                stroke="#EAF0FA"
                strokeWidth={2}
              />
              {/* Base lead */}
              <line
                x1={baseWireStart.x}
                y1={baseWireStart.y}
                x2={baseWireEnd.x}
                y2={baseWireEnd.y}
                stroke="#EAF0FA"
                strokeWidth={1.5}
              />
              {/* Collector lead */}
              <line
                x1={cLineStart.x}
                y1={cLineStart.y}
                x2={cLineEnd.x}
                y2={cLineEnd.y}
                stroke={collectorColor}
                strokeWidth={collectorWidth}
              />
              {/* Emitter lead + arrow */}
              <line
                x1={eLineStart.x}
                y1={eLineStart.y}
                x2={eLineEnd.x}
                y2={eLineEnd.y}
                stroke={collectorColor}
                strokeWidth={collectorWidth}
              />
              {/* Emitter arrow (points AWAY from base = NPN convention) */}
              <polygon
                points={`${eLineEnd.x - 6},${eLineEnd.y - 8} ${eLineEnd.x + 2},${eLineEnd.y - 4} ${eLineEnd.x - 2},${eLineEnd.y}`}
                fill={conducting ? active : '#EAF0FA'}
              />
              {/* Terminal labels */}
              <text
                x={cx + 12}
                y={cy - r - 4}
                fill="#6C7A93"
                fontFamily="'JetBrains Mono', monospace"
                fontSize={10}
              >
                C
              </text>
              <text
                x={cx + 12}
                y={cy + r + 12}
                fill="#6C7A93"
                fontFamily="'JetBrains Mono', monospace"
                fontSize={10}
              >
                E
              </text>
              <text
                x={cx - r - 8}
                y={cy - 4}
                fill="#6C7A93"
                fontFamily="'JetBrains Mono', monospace"
                fontSize={10}
                textAnchor="end"
              >
                B
              </text>
              <text
                x={cx + 4}
                y={cy + r + 26}
                fill="#37C9B8"
                fontFamily="'JetBrains Mono', monospace"
                fontSize={10}
              >
                β={BETA}
              </text>
            </g>
          )
        })()}

        {/* R_B: horizontal zigzag between source and base */}
        {(() => {
          const rx = rbMid.x
          const ry = rbMid.y
          const zw = 22
          const zh = 6
          const pts: Array<[number, number]> = [
            [rx - zw, ry],
            [rx - zw + 4, ry - zh],
            [rx - zw + 12, ry + zh],
            [rx - zw + 20, ry - zh],
            [rx - zw + 28, ry + zh],
            [rx - zw + 36, ry - zh],
            [rx - zw + 44, ry],
          ]
          const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`).join(' ')
          return (
            <>
              <path d={path} fill="none" stroke="#EAF0FA" strokeWidth={1.8} />
              <text
                x={rx}
                y={ry - 12}
                fill="#6C7A93"
                fontFamily="'JetBrains Mono', monospace"
                fontSize={10}
                textAnchor="middle"
              >
                R_B
              </text>
            </>
          )
        })()}

        {/* Base wire from source to R_B */}
        <line
          x1={sourceCenter.x + 16}
          y1={sourceCenter.y}
          x2={rbMid.x - 22}
          y2={sourceCenter.y}
          stroke={wireIdle}
          strokeWidth={wireW}
        />
        {/* Base wire from R_B to transistor base lead */}
        <line
          x1={rbMid.x + 22}
          y1={sourceCenter.y}
          x2={bjt.baseX - 12}
          y2={sourceCenter.y}
          stroke={wireIdle}
          strokeWidth={wireW}
        />

        {/* Source: current source symbol (circle with arrow — I_B) */}
        {(() => {
          const sx = sourceCenter.x
          const sy = sourceCenter.y
          return (
            <g>
              <circle cx={sx} cy={sy} r={16} fill="none" stroke="#EAF0FA" strokeWidth={1.4} />
              {isStage1 ? (
                <>
                  {/* Up arrow */}
                  <line x1={sx} y1={sy + 8} x2={sx} y2={sy - 8} stroke="#EAF0FA" strokeWidth={1.5} />
                  <polygon
                    points={`${sx - 4},${sy - 4} ${sx + 4},${sy - 4} ${sx},${sy - 10}`}
                    fill="#EAF0FA"
                  />
                </>
              ) : (
                <>
                  {/* Sine tilde for AC/square driven mode */}
                  <path
                    d={`M ${sx - 10} ${sy} Q ${sx - 5} ${sy - 8}, ${sx} ${sy} T ${sx + 10} ${sy}`}
                    fill="none"
                    stroke="#EAF0FA"
                    strokeWidth={1.4}
                  />
                </>
              )}
              <text
                x={sx}
                y={sy + 30}
                fill="#37C9B8"
                fontFamily="'JetBrains Mono', monospace"
                fontSize={10}
                textAnchor="middle"
              >
                I_B
              </text>
            </g>
          )
        })()}

        {/* Ground drop from source */}
        <line
          x1={sourceCenter.x}
          y1={sourceCenter.y + 16}
          x2={sourceCenter.x}
          y2={rail.gnd}
          stroke={wireIdle}
          strokeWidth={wireW}
        />

        {/* Current-flow dots along collector path when conducting */}
        {conducting && (
          <g key="flow">
            <path
              id="tr-flow"
              d={`M ${collectorNode.x} ${rail.vcc} L ${collectorNode.x} ${collectorNode.y} L ${bjt.baseX + 12} ${bjt.baseY - 4} L ${bjt.baseX + 12} ${bjt.baseY + 4} L ${emitterNode.x} ${emitterNode.y} L ${emitterNode.x} ${rail.gnd}`}
              fill="none"
              stroke="none"
            />
            {[0, 0.6, 1.2].map((delay) => (
              <circle key={`f${delay}`} r={2.6} fill={active}>
                <animateMotion dur="1.6s" repeatCount="indefinite" begin={`${delay}s`}>
                  <mpath href="#tr-flow" />
                </animateMotion>
              </circle>
            ))}
          </g>
        )}

        {/* ─── Right panel: I_C(V_CE) fan or V_CE(t) scope ─────────── */}
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
          {isStage1 ? labels.characteristic : labels.scope}
        </text>

        {isStage1 ? (
          <>
            {/* Grid */}
            {[3, 6, 9, 12].map((v) => (
              <line
                key={`vg${v}`}
                x1={vceToSvgX(v)}
                y1={PLOT_Y}
                x2={vceToSvgX(v)}
                y2={PLOT_Y + PLOT_H}
                stroke="#12203a"
                strokeWidth={1}
              />
            ))}
            {[3, 6, 9, 12].map((iv) => (
              <line
                key={`hg${iv}`}
                x1={PLOT_X}
                y1={icToSvgY(iv)}
                x2={PLOT_X + PLOT_W}
                y2={icToSvgY(iv)}
                stroke="#12203a"
                strokeWidth={1}
              />
            ))}

            {/* Region bands */}
            {/* Saturation band (V_CE ~ 0..0.5V) */}
            <rect
              x={vceToSvgX(0)}
              y={PLOT_Y}
              width={vceToSvgX(V_CE_SAT + 0.4) - vceToSvgX(0)}
              height={PLOT_H}
              fill="#F97316"
              opacity={0.06}
            />
            {/* Cut-off band (I_C ~ 0..0.5 mA) */}
            <rect
              x={PLOT_X}
              y={icToSvgY(0.5)}
              width={PLOT_W}
              height={icToSvgY(0) - icToSvgY(0.5)}
              fill="#6C7A93"
              opacity={0.08}
            />

            {/* Axes */}
            <line
              x1={PLOT_X}
              y1={icToSvgY(0)}
              x2={PLOT_X + PLOT_W}
              y2={icToSvgY(0)}
              stroke="#3A4863"
              strokeWidth={1.5}
            />
            <line
              x1={PLOT_X}
              y1={PLOT_Y}
              x2={PLOT_X}
              y2={PLOT_Y + PLOT_H}
              stroke="#3A4863"
              strokeWidth={1.5}
            />
            {/* Axis ticks */}
            {[3, 6, 9, 12].map((v) => (
              <text
                key={`vt${v}`}
                x={vceToSvgX(v)}
                y={icToSvgY(0) + 12}
                fill="#54617A"
                fontFamily="'JetBrains Mono', monospace"
                fontSize={9}
                textAnchor="middle"
              >
                {v}
              </text>
            ))}
            {[3, 6, 9, 12].map((iv) => (
              <text
                key={`it${iv}`}
                x={PLOT_X - 4}
                y={icToSvgY(iv) + 3}
                fill="#54617A"
                fontFamily="'JetBrains Mono', monospace"
                fontSize={9}
                textAnchor="end"
              >
                {iv}
              </text>
            ))}
            <text
              x={PLOT_X + PLOT_W - 4}
              y={icToSvgY(0) - 6}
              fill="#6C7A93"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
              textAnchor="end"
            >
              V_CE (V) →
            </text>
            <text
              x={PLOT_X + 6}
              y={PLOT_Y + 10}
              fill="#6C7A93"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
            >
              I_C (mA) ↑
            </text>

            <clipPath id="tr-plot-clip">
              <rect x={PLOT_X} y={PLOT_Y} width={PLOT_W} height={PLOT_H} />
            </clipPath>
            <g clipPath="url(#tr-plot-clip)">
              {/* Fan of I_B curves */}
              {fanCurves.map((c) => (
                <path
                  key={`fan${c.ibK}`}
                  d={c.d}
                  fill="none"
                  stroke="#54617A"
                  strokeWidth={1.0}
                  strokeDasharray="2 3"
                  opacity={0.55}
                />
              ))}
              {/* Load line (solid orange dashed) */}
              <path
                d={loadLinePath}
                fill="none"
                stroke="#F9A968"
                strokeWidth={1.3}
                strokeDasharray="4 4"
                opacity={0.7}
              />
              {/* Operating point marker */}
              <circle
                cx={vceToSvgX(vceV)}
                cy={icToSvgY(icMa)}
                r={5}
                fill="#F97316"
              />
              <circle
                cx={vceToSvgX(vceV)}
                cy={icToSvgY(icMa)}
                r={10}
                fill="none"
                stroke="#F97316"
                strokeWidth={1}
                opacity={0.5}
              />
            </g>

            {/* Load-line legend */}
            <g transform={`translate(${PLOT_X + 10}, ${PLOT_Y + PLOT_H - 24})`}>
              <line
                x1={0}
                y1={0}
                x2={16}
                y2={0}
                stroke="#F9A968"
                strokeWidth={1.3}
                strokeDasharray="4 4"
              />
              <text
                x={20}
                y={3}
                fill="#F9A968"
                fontFamily="'JetBrains Mono', monospace"
                fontSize={9}
              >
                {labels.load_line}
              </text>
            </g>
          </>
        ) : (
          <>
            {/* Scope grid */}
            {[0.5, 1, 1.5].map((t) => (
              <line
                key={`sg${t}`}
                x1={tToScopeX(t)}
                y1={PLOT_Y}
                x2={tToScopeX(t)}
                y2={PLOT_Y + PLOT_H}
                stroke="#12203a"
                strokeWidth={1}
              />
            ))}
            {[3, 6, 9, 12].map((v) => (
              <line
                key={`hs${v}`}
                x1={PLOT_X}
                y1={vToScopeY(v)}
                x2={PLOT_X + PLOT_W}
                y2={vToScopeY(v)}
                stroke="#12203a"
                strokeWidth={1}
              />
            ))}
            {/* Zero + V_CC guide lines */}
            <line
              x1={PLOT_X}
              y1={vToScopeY(0)}
              x2={PLOT_X + PLOT_W}
              y2={vToScopeY(0)}
              stroke="#3A4863"
              strokeWidth={1.2}
            />
            <line
              x1={PLOT_X}
              y1={vToScopeY(V_CC)}
              x2={PLOT_X + PLOT_W}
              y2={vToScopeY(V_CC)}
              stroke="#3A4863"
              strokeWidth={1}
              strokeDasharray="3 4"
              opacity={0.6}
            />
            <line
              x1={PLOT_X}
              y1={PLOT_Y}
              x2={PLOT_X}
              y2={PLOT_Y + PLOT_H}
              stroke="#3A4863"
              strokeWidth={1.5}
            />
            {/* Axis text */}
            <text
              x={PLOT_X + PLOT_W - 4}
              y={vToScopeY(0) - 4}
              fill="#6C7A93"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
              textAnchor="end"
            >
              t (s) →
            </text>
            <text
              x={PLOT_X + 6}
              y={PLOT_Y + 10}
              fill="#6C7A93"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
            >
              V_CE ↑
            </text>
            {[3, 6, 9, 12].map((v) => (
              <text
                key={`vt${v}`}
                x={PLOT_X - 4}
                y={vToScopeY(v) + 3}
                fill="#54617A"
                fontFamily="'JetBrains Mono', monospace"
                fontSize={9}
                textAnchor="end"
              >
                {v}
              </text>
            ))}

            <clipPath id="tr-scope-clip">
              <rect x={PLOT_X} y={PLOT_Y} width={PLOT_W} height={PLOT_H} />
            </clipPath>
            <g clipPath="url(#tr-scope-clip)">
              {isStage2 && (
                <>
                  <path
                    d={stage2InputPath}
                    fill="none"
                    stroke="#B9C4D6"
                    strokeWidth={1.4}
                    strokeDasharray="4 4"
                    opacity={0.6}
                  />
                  <path
                    d={stage2OutputPath}
                    fill="none"
                    stroke={active}
                    strokeWidth={2.2}
                  />
                </>
              )}
              {isStage3 && (
                <>
                  {/* Target trace — required info, always visible */}
                  <path
                    d={targetScopePath}
                    fill="none"
                    stroke="#F97316"
                    strokeWidth={2.2}
                  />
                  {/* Student candidate trace — HIDDEN until submit */}
                  {blindSubmitted && blindPick && (
                    <path
                      d={pickScopePath}
                      fill="none"
                      stroke={blindCorrect ? active : '#EF476F'}
                      strokeWidth={1.8}
                      strokeDasharray="4 3"
                      opacity={0.85}
                    />
                  )}
                </>
              )}
              {/* Sweep cursor */}
              {isStage2 && (
                <line
                  x1={tToScopeX(scopeT)}
                  y1={PLOT_Y}
                  x2={tToScopeX(scopeT)}
                  y2={PLOT_Y + PLOT_H}
                  stroke="#F9A968"
                  strokeWidth={1}
                  opacity={0.35}
                />
              )}
            </g>

            {/* Legends */}
            {isStage2 && (
              <g transform={`translate(${PLOT_X + 10}, ${PLOT_Y + PLOT_H - 24})`}>
                <line
                  x1={0}
                  y1={0}
                  x2={16}
                  y2={0}
                  stroke="#B9C4D6"
                  strokeWidth={1.4}
                  strokeDasharray="4 4"
                />
                <text
                  x={20}
                  y={3}
                  fill="#B9C4D6"
                  fontFamily="'JetBrains Mono', monospace"
                  fontSize={9}
                >
                  I_B in
                </text>
                <line x1={0} y1={14} x2={16} y2={14} stroke={active} strokeWidth={2} />
                <text
                  x={20}
                  y={17}
                  fill={active}
                  fontFamily="'JetBrains Mono', monospace"
                  fontSize={9}
                >
                  V_CE out
                </text>
              </g>
            )}
            {isStage3 && (
              <g transform={`translate(${PLOT_X + 10}, ${PLOT_Y + PLOT_H - 24})`}>
                <line x1={0} y1={0} x2={16} y2={0} stroke="#F97316" strokeWidth={2} />
                <text
                  x={20}
                  y={3}
                  fill="#F97316"
                  fontFamily="'JetBrains Mono', monospace"
                  fontSize={9}
                >
                  {labels.target}
                </text>
                {blindSubmitted && blindPick && (
                  <>
                    <line
                      x1={0}
                      y1={14}
                      x2={16}
                      y2={14}
                      stroke={blindCorrect ? active : '#EF476F'}
                      strokeWidth={1.8}
                      strokeDasharray="4 3"
                    />
                    <text
                      x={20}
                      y={17}
                      fill={blindCorrect ? active : '#EF476F'}
                      fontFamily="'JetBrains Mono', monospace"
                      fontSize={9}
                    >
                      {labels.your_pick}
                    </text>
                  </>
                )}
              </g>
            )}
          </>
        )}
      </svg>

      {/* ─── HUD overlays (HTML, rem-scaled) ─────────────────────────── */}
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
          fontSize: '2.1rem',
          letterSpacing: '0.08em',
          color: '#37C9B8',
          zIndex: 5,
          pointerEvents: 'none',
          textAlign: 'right',
          maxWidth: '50%',
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
          fontSize: '2.1rem',
          letterSpacing: '0.06em',
          color: peekTip ? '#F9A968' : '#6C7A93',
          zIndex: 5,
          pointerEvents: 'none',
          maxWidth: '48%',
        }}
      >
        {hudBL}
      </div>
      {/* NO bottom-right overlay — reserved for parent chrome (fullscreen). */}

      {/* Progress chip — under TL, never in BR */}
      {progressChip && (
        <div
          style={{
            position: 'absolute',
            top: '7.5rem',
            left: '3rem',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '1.8rem',
            letterSpacing: '0.08em',
            color: '#37C9B8',
            zIndex: 5,
            pointerEvents: 'none',
          }}
        >
          {progressChip}
        </div>
      )}

      {/* Live regime chip during stage 1 — under progress chip */}
      {isStage1 && (
        <div
          style={{
            position: 'absolute',
            top: '11rem',
            left: '3rem',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '1.7rem',
            letterSpacing: '0.08em',
            color:
              regime === 'active'
                ? '#37C9B8'
                : regime === 'saturated'
                  ? '#F97316'
                  : '#6C7A93',
            zIndex: 5,
            pointerEvents: 'none',
          }}
        >
          → {regime === 'cutoff'
            ? labels.regime_cutoff
            : regime === 'active'
              ? labels.regime_active
              : labels.regime_saturated}
        </div>
      )}

      {/* Stage 1 vertical slider: I_B */}
      {isStage1 && (
        <div
          style={{
            position: 'absolute',
            top: '6rem',
            right: '3rem',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '0.6rem',
            zIndex: 6,
          }}
        >
          <div
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '1.5rem',
              color: '#6C7A93',
            }}
          >
            {IB_MAX_UA} µA
          </div>
          <div
            style={{
              width: '2rem',
              height: '30rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <input
              type="range"
              min={IB_MIN_UA}
              max={IB_MAX_UA}
              step={1}
              value={ibUa}
              onChange={(e) => setIbUa(Number(e.target.value))}
              style={{
                width: '30rem',
                height: '2rem',
                transform: 'rotate(-90deg)',
                transformOrigin: 'center',
                accentColor: '#37C9B8',
                cursor: 'pointer',
              }}
            />
          </div>
          <div
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '1.5rem',
              color: '#6C7A93',
            }}
          >
            {IB_MIN_UA} µA
          </div>
          <div
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '1.6rem',
              color: '#37C9B8',
            }}
          >
            I_B = {ibUa} µA
          </div>
        </div>
      )}

      {/* Stage 2 mode toggle */}
      {isStage2 && (
        <div
          style={{
            position: 'absolute',
            bottom: '10rem',
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            gap: '2rem',
            zIndex: 10,
          }}
        >
          {(['switch', 'amp'] as Mode[]).map((m) => {
            const isActive = mode === m
            return (
              <button
                key={m}
                type="button"
                onClick={() => handleModeToggle(m)}
                style={{
                  padding: '1.2rem 2.4rem',
                  background: isActive ? '#37C9B8' : '#12203a',
                  color: isActive ? '#0D1524' : '#EAF0FA',
                  border: `1.5px solid ${isActive ? '#37C9B8' : '#3A4863'}`,
                  borderRadius: '1rem',
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: '1.8rem',
                  letterSpacing: '0.08em',
                  cursor: 'pointer',
                  minWidth: '14rem',
                }}
              >
                {m === 'switch' ? labels.mode_switch : labels.mode_amp}
              </button>
            )
          })}
        </div>
      )}

      {/* Stage 3 regime buttons — dark until submit; color only after submit */}
      {isStage3 && (
        <div
          style={{
            position: 'absolute',
            bottom: '11rem',
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            gap: '1.6rem',
            zIndex: 10,
          }}
        >
          {BLIND_DECK.map((s) => {
            const isPicked = blindPick === s
            const showResult = blindSubmitted && isPicked
            const bg = showResult
              ? blindCorrect
                ? '#37C9B8'
                : '#EF476F'
              : '#12203a'
            const border = isPicked ? '#B9C4D6' : '#3A4863'
            return (
              <button
                key={s}
                type="button"
                onClick={() => {
                  if (blindSubmitted) return
                  setBlindPick(s)
                }}
                disabled={blindSubmitted}
                style={{
                  padding: '1.2rem 1.6rem',
                  background: bg,
                  color: '#EAF0FA',
                  border: `1.5px solid ${border}`,
                  borderRadius: '1rem',
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: '1.6rem',
                  letterSpacing: '0.08em',
                  cursor: blindSubmitted ? 'default' : 'pointer',
                  minWidth: '12rem',
                }}
              >
                {s === 'cutoff'
                  ? labels.regime_cutoff
                  : s === 'active'
                    ? labels.regime_active
                    : labels.regime_saturated}
              </button>
            )
          })}
        </div>
      )}

      {/* Stage 3 SUBMIT button */}
      {isStage3 && (
        <div
          style={{
            position: 'absolute',
            bottom: '4.5rem',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 10,
          }}
        >
          <button
            type="button"
            onClick={handleBlindSubmit}
            disabled={!blindPick || blindSubmitted}
            style={{
              padding: '1.2rem 3rem',
              background: blindSubmitted
                ? blindCorrect
                  ? '#37C9B8'
                  : '#EF476F'
                : '#F97316',
              color: '#0D1524',
              border: 'none',
              borderRadius: '1rem',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '1.9rem',
              letterSpacing: '0.12em',
              cursor: !blindPick || blindSubmitted ? 'default' : 'pointer',
              opacity: !blindPick || blindSubmitted ? 0.5 : 1,
              fontWeight: 700,
            }}
          >
            {labels.submit}
          </button>
        </div>
      )}
    </div>
  )
}
