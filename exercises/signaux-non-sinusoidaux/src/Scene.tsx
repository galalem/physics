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

// Right panel: scope
const PLOT_X = 412
const PLOT_Y = 60
const PLOT_W = 250
const PLOT_H = 350

// ─── Physics ────────────────────────────────────────────────────────────
const V_CC = 5 // V (rail)
const LN2 = Math.log(2)
const C_FIXED = 33e-9 // 33 nF fixed
const R_MIN = 10e3 // 10 kΩ
const R_MAX = 100e3 // 100 kΩ
const R_DEFAULT = 30e3 // f ≈ 728 Hz

const STAGE1_LOW_F = 400 // must witness f < this
const STAGE1_HIGH_F = 1500 // must witness f > this

const STAGE2_TARGET_FREQS = [500, 800, 1500] // Hz, seed-picked
const STAGE2_TOL = 0.10 // ±10%

// Scope window (fixed)
const SCOPE_WINDOW_S = 0.008 // 8 ms

// Voltage axis on scope
const V_LO = -0.5
const V_HI = 6

// Fixed reference frequency for Stage 3 traces (so shape is identifiable)
const REF_FREQ = 750 // Hz

type Variant = 'square' | 'triangular'
const BLIND_DECK: Variant[] = ['square', 'triangular']

// ─── Label loader ───────────────────────────────────────────────────────
const dict = { en } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── Pure waveform functions ────────────────────────────────────────────
/** Symmetric square wave in [0, V_CC], period T. */
function squareWave(t: number, T: number): number {
  const phase = ((t % T) + T) % T
  return phase < T / 2 ? V_CC : 0
}

/** Symmetric triangular wave in [0, V_CC], period T. */
function triangularWave(t: number, T: number): number {
  const phase = (((t % T) + T) % T) / T
  return phase < 0.5 ? 2 * V_CC * phase : 2 * V_CC * (1 - phase)
}

function variantWave(v: Variant, t: number, T: number): number {
  return v === 'square' ? squareWave(t, T) : triangularWave(t, T)
}

function periodFromR(R: number, C = C_FIXED): number {
  return 2 * R * C * LN2
}
function freqFromR(R: number, C = C_FIXED): number {
  return 1 / periodFromR(R, C)
}

// ─── Scope coord helpers ────────────────────────────────────────────────
function tToScopeX(t: number): number {
  return PLOT_X + (t / SCOPE_WINDOW_S) * PLOT_W
}
function vToScopeY(v: number): number {
  return PLOT_Y + PLOT_H - ((v - V_LO) / (V_HI - V_LO)) * PLOT_H
}

/** Build an SVG path over the scope window sampling a v(t) function. */
function buildTrace(v: (t: number) => number, samples = 400): string {
  let d = ''
  for (let i = 0; i <= samples; i++) {
    const t = (i / samples) * SCOPE_WINDOW_S
    const y = vToScopeY(v(t))
    const x = tToScopeX(t)
    d += `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)} `
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

  // Seed-picked target frequency for Stage 2
  const stage2Target = useMemo(
    () => STAGE2_TARGET_FREQS[seed % STAGE2_TARGET_FREQS.length]!,
    [seed],
  )

  // Seeded blind-stage deck order
  const deckOrder = useMemo(() => rootRng.shuffle([...BLIND_DECK]) as Variant[], [rootRng])

  const stageIdx = useCurrentStage()
  const setStage = useSetStage()
  const progress = useProgress()
  const complete = useComplete()

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  // Continuous slider
  const [R, setR] = useState(R_DEFAULT)

  // Stage 1 coverage
  const [sweptLow, setSweptLow] = useState(false)
  const [sweptHigh, setSweptHigh] = useState(false)

  // Stage 2 match (sticky)
  const [stage2Matched, setStage2Matched] = useState(false)

  // Stage 3 blind state
  const [deckIdx, setDeckIdx] = useState(0)
  const [blindPick, setBlindPick] = useState<Variant | null>(null)
  const [blindSubmitted, setBlindSubmitted] = useState(false)
  const [blindCorrect, setBlindCorrect] = useState(false)
  const [blindSolved, setBlindSolved] = useState(0)
  const currentTarget = deckOrder[deckIdx % deckOrder.length]!

  // Peek (rotating strategy tip)
  const [peekTip, setPeekTip] = useState<string | null>(null)
  const peekTipIdxRef = useRef(0)

  // Scope scroll offset (decorative animation)
  const [scopePhase, setScopePhase] = useState(0)
  useTicker((dt) => {
    if (!isStage1 && !isStage2 && !isStage3) return
    setScopePhase((prev) => (prev + dt) % 1)
  })

  // Track coverage on R change
  const currentF = freqFromR(R)
  const currentT = periodFromR(R)
  useEffect(() => {
    if (!isStage1) return
    if (currentF < STAGE1_LOW_F) setSweptLow(true)
    if (currentF > STAGE1_HIGH_F) setSweptHigh(true)
  }, [currentF, isStage1])

  // Track stage 2 match (sticky once achieved)
  useEffect(() => {
    if (!isStage2) return
    const err = Math.abs(currentF - stage2Target) / stage2Target
    if (err < STAGE2_TOL) setStage2Matched(true)
  }, [currentF, isStage2, stage2Target])

  const resetStageState = useCallback(() => {
    setR(R_DEFAULT)
    setSweptLow(false)
    setSweptHigh(false)
    setStage2Matched(false)
    setDeckIdx(0)
    setBlindPick(null)
    setBlindSubmitted(false)
    setBlindCorrect(false)
    setBlindSolved(0)
    setPeekTip(null)
    peekTipIdxRef.current = 0
    setScopePhase(0)
  }, [])

  useReset(resetStageState)

  const stage1Done = sweptLow && sweptHigh
  const stage2Done = stage2Matched
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

  // ─── Stage 3: submit handler ───────────────────────────────────────────
  const handleBlindSubmit = useCallback(() => {
    if (!blindPick || blindSubmitted) return
    const correct = blindPick === currentTarget
    setBlindSubmitted(true)
    setBlindCorrect(correct)
    if (correct) {
      const newSolved = blindSolved + 1
      setBlindSolved(newSolved)
      if (newSolved < BLIND_DECK.length) {
        // advance to next scenario after brief pause
        window.setTimeout(() => {
          setDeckIdx((i) => i + 1)
          setBlindPick(null)
          setBlindSubmitted(false)
          setBlindCorrect(false)
        }, 1200)
      }
      // if newSolved === deck.length → stay on scenario, chrome shows Finish
    } else {
      // wrong: reset deck
      window.setTimeout(() => {
        setDeckIdx(0)
        setBlindPick(null)
        setBlindSubmitted(false)
        setBlindCorrect(false)
        setBlindSolved(0)
      }, 1200)
    }
  }, [blindPick, blindSubmitted, blindSolved, currentTarget])

  // ─── Peek — rotating strategy tips (blind stage only) ─────────────────
  const PEEK_TIPS = useMemo(
    () => [labels.peek_tip_1, labels.peek_tip_2],
    [labels],
  )
  usePeek(() => {
    if (!isStage3) return
    setPeekTip(PEEK_TIPS[peekTipIdxRef.current % PEEK_TIPS.length]!)
    peekTipIdxRef.current += 1
  })
  useEffect(() => {
    if (!peekTip) return
    const t = window.setTimeout(() => setPeekTip(null), 4000)
    return () => window.clearTimeout(t)
  }, [peekTip])

  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  // ─── Circuit schematic geometry (2-transistor astable) ─────────────────
  // Layout:
  //   V_CC rail (top) ── R_C1 ── C1 ── R_B2 ── R_B1 ── C2 ── R_C2 ─
  //                     │              │       │              │
  //                    v_Q1          Q2.B     Q1.B          v_Q2
  //                     │                                     │
  //                    Q1                                    Q2
  //                     │                                     │
  //                    GND rail (bottom)
  const railTopY = SCH_Y + 40
  const railBotY = SCH_Y + SCH_H - 40
  const q1X = SCH_X + 90
  const q2X = SCH_X + 270
  const rC1Y = railTopY + 40
  const rC2Y = rC1Y
  const collectorY = railTopY + 100 // where R_C bottom + collector meet
  const emitterY = railBotY - 30
  const baseY = collectorY + 60
  const capY = collectorY - 4

  const scaleTint = Math.min(1, Math.max(0, (currentF - STAGE1_LOW_F) / (STAGE1_HIGH_F - STAGE1_LOW_F)))
  const activeColor = '#37C9B8'
  const wireColor = '#54617A'
  const rectStroke = '#12203a'

  // ─── Traces ─────────────────────────────────────────────────────────────
  // Stage 1&2: green trace = student's Q1 collector square wave at current f
  // Stage 2 also shows an orange target square wave at target frequency
  // Stage 3: orange target (variant, f = REF_FREQ), and post-submit dashed candidate

  // Scope scroll offset in seconds (decorative)
  const scrollOffsetS = 0.0 // set to something nonzero if you want scroll; we keep static

  const studentTrace = useMemo(() => {
    if (!isStage1 && !isStage2) return ''
    const T = currentT
    return buildTrace((t) => squareWave(t + scrollOffsetS, T), 500)
  }, [currentT, isStage1, isStage2])

  const targetTrace = useMemo(() => {
    if (!isStage2 && !isStage3) return ''
    if (isStage2) {
      const T = 1 / stage2Target
      return buildTrace((t) => squareWave(t, T), 500)
    }
    // Stage 3: variant target at reference freq
    const T = 1 / REF_FREQ
    return buildTrace((t) => variantWave(currentTarget, t, T), 500)
  }, [isStage2, isStage3, stage2Target, currentTarget])

  const candidateTrace = useMemo(() => {
    if (!isStage3 || !blindSubmitted || !blindPick) return ''
    const T = 1 / REF_FREQ
    return buildTrace((t) => variantWave(blindPick, t, T), 500)
  }, [isStage3, blindSubmitted, blindPick])

  // ─── HUD strings ────────────────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`

  const fFmt = (f: number): string =>
    f >= 1000 ? `${(f / 1000).toFixed(2)} kHz` : `${f.toFixed(0)} Hz`

  const hudTR = isStage1
    ? `R = ${(R / 1000).toFixed(1)} kΩ · f = ${fFmt(currentF)}`
    : isStage2
      ? `f = ${fFmt(currentF)} · ${labels.target} ${fFmt(stage2Target)}${stage2Matched ? ' · ✓' : ''}`
      : `${labels.scenario} ${deckIdx + 1}/${BLIND_DECK.length} · ${blindSolved}/${BLIND_DECK.length} ${labels.solved}`

  const hudBL = isStage3 && peekTip
    ? peekTip
    : isStage1 ? labels.tip1 : isStage2 ? labels.tip2 : labels.tip3

  // Coverage / status chip (below TL, never in BR)
  const progressChip = isStage1
    ? (sweptLow && sweptHigh
        ? `✓ ${labels.coverage_lo} · ✓ ${labels.coverage_hi}`
        : `${sweptLow ? '✓' : '○'} ${labels.coverage_lo} · ${sweptHigh ? '✓' : '○'} ${labels.coverage_hi}`)
    : isStage2
      ? (stage2Matched ? `✓ ${labels.matched}` : `${labels.target} ${fFmt(stage2Target)}`)
      : blindSubmitted
        ? (blindCorrect ? `✓ ${labels.correct}` : `✗ ${labels.wrong}`)
        : null

  // ─── Render ─────────────────────────────────────────────────────────────
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block', userSelect: 'none' }}
      >
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        {/* ─── Left panel: astable schematic ───────────────────────────── */}
        <rect
          x={SCH_X - 8} y={SCH_Y - 8}
          width={SCH_W + 16} height={SCH_H + 16}
          fill="none" stroke={rectStroke} strokeWidth={1} rx={6}
        />
        <text
          x={SCH_X} y={SCH_Y - 14}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={11} letterSpacing="0.1em"
        >
          {labels.circuit}
        </text>

        {/* V_CC rail */}
        <line x1={SCH_X + 20} y1={railTopY} x2={SCH_X + SCH_W - 20} y2={railTopY} stroke="#EAF0FA" strokeWidth={1.8} />
        <text x={SCH_X + 24} y={railTopY - 6} fill="#37C9B8" fontFamily="'JetBrains Mono', monospace" fontSize={10}>
          {labels.vcc} = {V_CC} V
        </text>

        {/* Left branch — Q1 */}
        {/* R_C1 (collector resistor, drawn as a small box) */}
        <line x1={q1X} y1={railTopY} x2={q1X} y2={rC1Y} stroke={wireColor} strokeWidth={1.6} />
        <rect x={q1X - 8} y={rC1Y} width={16} height={30} fill="none" stroke="#EAF0FA" strokeWidth={1.4} />
        <text x={q1X + 12} y={rC1Y + 20} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={9}>
          R_C
        </text>
        <line x1={q1X} y1={rC1Y + 30} x2={q1X} y2={collectorY} stroke={wireColor} strokeWidth={1.6} />

        {/* Q1 transistor body (simplified rectangle with label) */}
        <line x1={q1X} y1={collectorY} x2={q1X} y2={baseY - 12} stroke={wireColor} strokeWidth={1.6} />
        <rect x={q1X - 14} y={baseY - 12} width={28} height={30} fill="#0D1524" stroke="#EAF0FA" strokeWidth={1.4} rx={4} />
        <text x={q1X} y={baseY + 6} fill="#EAF0FA" fontFamily="'JetBrains Mono', monospace" fontSize={11} textAnchor="middle">
          {labels.Q1}
        </text>
        <line x1={q1X} y1={baseY + 18} x2={q1X} y2={emitterY} stroke={wireColor} strokeWidth={1.6} />
        <line x1={q1X} y1={emitterY} x2={q1X} y2={railBotY} stroke={wireColor} strokeWidth={1.6} />
        {/* v_Q1 output tap */}
        <circle cx={q1X} cy={collectorY} r={2.4} fill="#EAF0FA" />
        <line x1={q1X} y1={collectorY} x2={q1X - 30} y2={collectorY} stroke={wireColor} strokeWidth={1.2} strokeDasharray="2 3" />
        <text x={q1X - 32} y={collectorY - 4} fill="#37C9B8" fontFamily="'JetBrains Mono', monospace" fontSize={9} textAnchor="end">
          {labels.out1}
        </text>

        {/* Right branch — Q2 (mirror) */}
        <line x1={q2X} y1={railTopY} x2={q2X} y2={rC2Y} stroke={wireColor} strokeWidth={1.6} />
        <rect x={q2X - 8} y={rC2Y} width={16} height={30} fill="none" stroke="#EAF0FA" strokeWidth={1.4} />
        <text x={q2X - 12} y={rC2Y + 20} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={9} textAnchor="end">
          R_C
        </text>
        <line x1={q2X} y1={rC2Y + 30} x2={q2X} y2={collectorY} stroke={wireColor} strokeWidth={1.6} />
        <line x1={q2X} y1={collectorY} x2={q2X} y2={baseY - 12} stroke={wireColor} strokeWidth={1.6} />
        <rect x={q2X - 14} y={baseY - 12} width={28} height={30} fill="#0D1524" stroke="#EAF0FA" strokeWidth={1.4} rx={4} />
        <text x={q2X} y={baseY + 6} fill="#EAF0FA" fontFamily="'JetBrains Mono', monospace" fontSize={11} textAnchor="middle">
          {labels.Q2}
        </text>
        <line x1={q2X} y1={baseY + 18} x2={q2X} y2={emitterY} stroke={wireColor} strokeWidth={1.6} />
        <line x1={q2X} y1={emitterY} x2={q2X} y2={railBotY} stroke={wireColor} strokeWidth={1.6} />
        <circle cx={q2X} cy={collectorY} r={2.4} fill="#EAF0FA" />
        <line x1={q2X} y1={collectorY} x2={q2X + 30} y2={collectorY} stroke={wireColor} strokeWidth={1.2} strokeDasharray="2 3" />
        <text x={q2X + 32} y={collectorY - 4} fill="#37C9B8" fontFamily="'JetBrains Mono', monospace" fontSize={9}>
          {labels.out2}
        </text>

        {/* GND rail */}
        <line x1={SCH_X + 20} y1={railBotY} x2={SCH_X + SCH_W - 20} y2={railBotY} stroke="#EAF0FA" strokeWidth={1.8} />
        <text x={SCH_X + 24} y={railBotY + 14} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={10}>
          {labels.gnd}
        </text>

        {/* Cross-coupling caps C1 (Q1 collector → Q2 base) and C2 (Q2 collector → Q1 base) */}
        {/* C1: from q1X collector to q2X base */}
        <line x1={q1X} y1={collectorY} x2={q1X + 30} y2={collectorY} stroke={wireColor} strokeWidth={1.4} />
        <line x1={q1X + 30} y1={collectorY} x2={q1X + 30} y2={capY} stroke={wireColor} strokeWidth={1.4} />
        {/* Cap C1 symbol (two parallel plates, vertical) */}
        <line x1={q1X + 24} y1={capY - 8} x2={q1X + 36} y2={capY - 8} stroke="#EAF0FA" strokeWidth={2.4} />
        <line x1={q1X + 24} y1={capY - 12} x2={q1X + 36} y2={capY - 12} stroke="#EAF0FA" strokeWidth={2.4} />
        <text x={q1X + 40} y={capY - 8} fill="#F97316" fontFamily="'JetBrains Mono', monospace" fontSize={9}>
          C1
        </text>
        <line x1={q1X + 30} y1={capY - 12} x2={q1X + 30} y2={baseY} stroke={wireColor} strokeWidth={1.4} />
        <line x1={q1X + 30} y1={baseY} x2={q2X - 14} y2={baseY} stroke={wireColor} strokeWidth={1.4} />

        {/* C2: from q2X collector to q1X base (mirror) */}
        <line x1={q2X} y1={collectorY} x2={q2X - 30} y2={collectorY} stroke={wireColor} strokeWidth={1.4} />
        <line x1={q2X - 30} y1={collectorY} x2={q2X - 30} y2={capY} stroke={wireColor} strokeWidth={1.4} />
        <line x1={q2X - 36} y1={capY - 8} x2={q2X - 24} y2={capY - 8} stroke="#EAF0FA" strokeWidth={2.4} />
        <line x1={q2X - 36} y1={capY - 12} x2={q2X - 24} y2={capY - 12} stroke="#EAF0FA" strokeWidth={2.4} />
        <text x={q2X - 40} y={capY - 8} fill="#F97316" fontFamily="'JetBrains Mono', monospace" fontSize={9} textAnchor="end">
          C2
        </text>
        <line x1={q2X - 30} y1={capY - 12} x2={q2X - 30} y2={baseY} stroke={wireColor} strokeWidth={1.4} />
        <line x1={q2X - 30} y1={baseY} x2={q1X + 14} y2={baseY} stroke={wireColor} strokeWidth={1.4} />

        {/* Base-pullup resistors R (from V_CC rail down to each base) */}
        {/* R_B1: from railTopY down to base of Q1 at q1X+14 */}
        <line x1={q1X + 60} y1={railTopY} x2={q1X + 60} y2={baseY - 30} stroke={wireColor} strokeWidth={1.4} />
        <rect x={q1X + 52} y={baseY - 30} width={16} height={22} fill="none" stroke="#EAF0FA" strokeWidth={1.4} />
        <text x={q1X + 72} y={baseY - 15} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={9}>
          {labels.R_label}
        </text>
        <line x1={q1X + 60} y1={baseY - 8} x2={q1X + 60} y2={baseY} stroke={wireColor} strokeWidth={1.4} />
        <circle cx={q1X + 60} cy={baseY} r={2} fill="#EAF0FA" />

        <line x1={q2X - 60} y1={railTopY} x2={q2X - 60} y2={baseY - 30} stroke={wireColor} strokeWidth={1.4} />
        <rect x={q2X - 68} y={baseY - 30} width={16} height={22} fill="none" stroke="#EAF0FA" strokeWidth={1.4} />
        <text x={q2X - 72} y={baseY - 15} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={9} textAnchor="end">
          {labels.R_label}
        </text>
        <line x1={q2X - 60} y1={baseY - 8} x2={q2X - 60} y2={baseY} stroke={wireColor} strokeWidth={1.4} />
        <circle cx={q2X - 60} cy={baseY} r={2} fill="#EAF0FA" />

        {/* Live R and C values annotation (bottom of left panel, not in BR quadrant) */}
        <text x={SCH_X + 20} y={SCH_Y + SCH_H - 12} fill={activeColor} fontFamily="'JetBrains Mono', monospace" fontSize={10}>
          {labels.R_label} = {(R / 1000).toFixed(1)} kΩ  ·  {labels.C_label} = {(C_FIXED * 1e9).toFixed(0)} nF
        </text>
        {/* Small "beating heart" pulse tied to conducting state */}
        <circle
          cx={SCH_X + SCH_W - 40}
          cy={SCH_Y + SCH_H - 16}
          r={4}
          fill={activeColor}
          opacity={0.4 + 0.4 * scaleTint}
        >
          <animate attributeName="opacity" values={`${0.35};${0.85};${0.35}`} dur={`${Math.max(0.05, Math.min(0.6, currentT * 500))}s`} repeatCount="indefinite" />
        </circle>

        {/* ─── Right panel: scope ─────────────────────────────────────── */}
        <rect
          x={PLOT_X - 8} y={PLOT_Y - 8}
          width={PLOT_W + 16} height={PLOT_H + 16}
          fill="none" stroke={rectStroke} strokeWidth={1} rx={6}
        />
        <text
          x={PLOT_X} y={PLOT_Y - 14}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={11} letterSpacing="0.1em"
        >
          {labels.scope}
        </text>

        {/* Grid */}
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={`vg${f}`}
            x1={PLOT_X + f * PLOT_W} y1={PLOT_Y} x2={PLOT_X + f * PLOT_W} y2={PLOT_Y + PLOT_H}
            stroke={rectStroke} strokeWidth={1}
          />
        ))}
        {[1, 2, 3, 4, 5].map((v) => (
          <line
            key={`hg${v}`}
            x1={PLOT_X} y1={vToScopeY(v)} x2={PLOT_X + PLOT_W} y2={vToScopeY(v)}
            stroke={rectStroke} strokeWidth={1}
          />
        ))}

        {/* Zero and left axes */}
        <line x1={PLOT_X} y1={vToScopeY(0)} x2={PLOT_X + PLOT_W} y2={vToScopeY(0)} stroke="#3A4863" strokeWidth={1.5} />
        <line x1={PLOT_X} y1={PLOT_Y} x2={PLOT_X} y2={PLOT_Y + PLOT_H} stroke="#3A4863" strokeWidth={1.5} />

        {/* Voltage tick labels */}
        {[0, V_CC].map((v) => (
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
        <text
          x={PLOT_X + PLOT_W - 4}
          y={vToScopeY(0) - 4}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={10}
          textAnchor="end"
        >
          t →
        </text>
        <text
          x={PLOT_X + 6}
          y={PLOT_Y + 10}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={10}
        >
          V ↑
        </text>

        <clipPath id="scope-clip">
          <rect x={PLOT_X} y={PLOT_Y} width={PLOT_W} height={PLOT_H} />
        </clipPath>

        <g clipPath="url(#scope-clip)">
          {/* Stage 1: student's trace only */}
          {isStage1 && studentTrace && (
            <path d={studentTrace} fill="none" stroke={activeColor} strokeWidth={2.2} />
          )}

          {/* Stage 2: target orange + student's green */}
          {isStage2 && (
            <>
              {targetTrace && (
                <path d={targetTrace} fill="none" stroke="#F97316" strokeWidth={2} opacity={0.9} />
              )}
              {studentTrace && (
                <path d={studentTrace} fill="none" stroke={activeColor} strokeWidth={2.2} />
              )}
            </>
          )}

          {/* Stage 3: only the target trace until submission; then dashed candidate */}
          {isStage3 && (
            <>
              {targetTrace && (
                <path d={targetTrace} fill="none" stroke="#F97316" strokeWidth={2.4} />
              )}
              {blindSubmitted && candidateTrace && (
                <path
                  d={candidateTrace}
                  fill="none"
                  stroke={blindCorrect ? activeColor : '#EF476F'}
                  strokeWidth={1.8}
                  strokeDasharray="4 3"
                  opacity={0.9}
                />
              )}
            </>
          )}
        </g>

        {/* Legend */}
        {isStage2 && (
          <g transform={`translate(${PLOT_X + 10}, ${PLOT_Y + PLOT_H - 24})`}>
            <line x1={0} y1={0} x2={16} y2={0} stroke="#F97316" strokeWidth={2} />
            <text x={20} y={3} fill="#F97316" fontFamily="'JetBrains Mono', monospace" fontSize={9}>
              {labels.target}
            </text>
            <line x1={0} y1={14} x2={16} y2={14} stroke={activeColor} strokeWidth={2} />
            <text x={20} y={17} fill={activeColor} fontFamily="'JetBrains Mono', monospace" fontSize={9}>
              {labels.out1}
            </text>
          </g>
        )}
        {isStage3 && (
          <g transform={`translate(${PLOT_X + 10}, ${PLOT_Y + PLOT_H - 24})`}>
            <line x1={0} y1={0} x2={16} y2={0} stroke="#F97316" strokeWidth={2} />
            <text x={20} y={3} fill="#F97316" fontFamily="'JetBrains Mono', monospace" fontSize={9}>
              {labels.target}
            </text>
            {blindSubmitted && (
              <>
                <line x1={0} y1={14} x2={16} y2={14} stroke={blindCorrect ? activeColor : '#EF476F'} strokeWidth={1.8} strokeDasharray="4 3" />
                <text
                  x={20} y={17}
                  fill={blindCorrect ? activeColor : '#EF476F'}
                  fontFamily="'JetBrains Mono', monospace"
                  fontSize={9}
                >
                  {labels.your_pick}
                </text>
              </>
            )}
          </g>
        )}

        {/* subtle scroll indicator (uses scopePhase so the ticker isn't dead) */}
        {(isStage1 || isStage2) && (
          <circle
            cx={PLOT_X + scopePhase * PLOT_W}
            cy={PLOT_Y + 6}
            r={1.6}
            fill={activeColor}
            opacity={0.7}
          />
        )}
      </svg>

      {/* ─── HUD overlays (HTML in rem, NOT SVG text) ────────────────── */}
      <div
        style={{
          position: 'absolute',
          top: '3rem', left: '3rem',
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
          top: '3rem', right: '3rem',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '2.3rem',
          letterSpacing: '0.08em',
          color: '#37C9B8',
          zIndex: 5,
          pointerEvents: 'none',
          textAlign: 'right',
        }}
      >
        {hudTR}
      </div>
      <div
        style={{
          position: 'absolute',
          bottom: '3rem', left: '3rem',
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
      {/* NO bottom-right overlay — RESERVED for parent chrome (fullscreen). */}

      {/* Progress / status chip below TL */}
      {progressChip && (
        <div
          style={{
            position: 'absolute',
            top: '7.5rem', left: '3rem',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '1.9rem',
            letterSpacing: '0.08em',
            color: '#37C9B8',
            zIndex: 5,
            pointerEvents: 'none',
          }}
        >
          {progressChip}
        </div>
      )}

      {/* ─── Stage 1 & 2: vertical R slider on the right side ────────── */}
      {(isStage1 || isStage2) && (
        <div
          style={{
            position: 'absolute',
            top: '10rem', right: '3rem',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '0.6rem',
            zIndex: 6,
          }}
        >
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.6rem', color: '#6C7A93' }}>
            {(R_MAX / 1000).toFixed(0)} kΩ
          </div>
          <div style={{ width: '2rem', height: '28rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <input
              type="range"
              min={R_MIN}
              max={R_MAX}
              step={100}
              value={R}
              onChange={(e) => setR(Number(e.target.value))}
              style={{
                width: '28rem',
                height: '2rem',
                transform: 'rotate(-90deg)',
                transformOrigin: 'center',
                accentColor: activeColor,
                cursor: 'pointer',
              }}
            />
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.6rem', color: '#6C7A93' }}>
            {(R_MIN / 1000).toFixed(0)} kΩ
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.6rem', color: activeColor }}>
            R = {(R / 1000).toFixed(1)} kΩ
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.6rem', color: '#B9C4D6' }}>
            f = {fFmt(currentF)}
          </div>
        </div>
      )}

      {/* ─── Stage 3: variant picker + SUBMIT ─────────────────────────── */}
      {isStage3 && (
        <>
          <div
            style={{
              position: 'absolute',
              bottom: '11rem', left: '50%',
              transform: 'translateX(-50%)',
              display: 'flex',
              gap: '2rem',
              zIndex: 10,
            }}
          >
            {(BLIND_DECK as Variant[]).map((v) => {
              const selected = blindPick === v
              // No pre-submit color reveal: idle = dark, selected = subtle border,
              // color only changes AFTER SUBMIT.
              const bg = blindSubmitted
                ? selected
                  ? (blindCorrect ? '#37C9B8' : '#EF476F')
                  : '#12203a'
                : '#12203a'
              const border = blindSubmitted
                ? selected
                  ? (blindCorrect ? '#37C9B8' : '#EF476F')
                  : '#3A4863'
                : selected
                  ? '#EAF0FA'
                  : '#3A4863'
              return (
                <button
                  key={v}
                  type="button"
                  onClick={() => {
                    if (blindSubmitted) return
                    setBlindPick(v)
                  }}
                  disabled={blindSubmitted}
                  style={{
                    padding: '1.2rem 1.8rem',
                    background: bg,
                    color: '#EAF0FA',
                    border: `1.5px solid ${border}`,
                    borderRadius: '1rem',
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: '1.7rem',
                    cursor: blindSubmitted ? 'default' : 'pointer',
                    minWidth: '18rem',
                  }}
                >
                  {v === 'square' ? labels.variant_square : labels.variant_triangular}
                </button>
              )
            })}
          </div>

          <div
            style={{
              position: 'absolute',
              bottom: '4.5rem', left: '50%',
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
                  ? (blindCorrect ? '#37C9B8' : '#EF476F')
                  : '#F97316',
                color: '#EAF0FA',
                border: 'none',
                borderRadius: '1rem',
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '1.9rem',
                letterSpacing: '0.14em',
                cursor: !blindPick || blindSubmitted ? 'default' : 'pointer',
                opacity: !blindPick || blindSubmitted ? 0.5 : 1,
              }}
            >
              {labels.submit}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
