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

// Left panel: ADC block schematic
const SCH_X = 32
const SCH_Y = 60
const SCH_W = 360
const SCH_H = 350

// Right panel: staircase / scope
const PLOT_X = 412
const PLOT_Y = 60
const PLOT_W = 250
const PLOT_H = 350

// ─── ADC physics constants ────────────────────────────────────────────
const V_REF = 5 // V — reference (full-scale) voltage
const N_BITS_DEFAULT = 4 // display width for the code readout

// Stage 1 sweep controls
const VIN_MIN = 0
const VIN_MAX = V_REF
const VIN_DEFAULT = 2.5

// Coverage bands used both to gate stage 1 and to gate scenarios in stage 3.
// The upper edges match a 4-bit uniform quantizer with V_ref = 5 V.
const BAND_LOW_MAX = 1.25 // codes 0000–0011
const BAND_MID_MIN = 1.875 // codes 0110–1001
const BAND_MID_MAX = 3.125
const BAND_HIGH_MIN = 3.75 // codes 1100–1111

// Stage 2 sine + bit-depth sweep
const N_BITS_STAGE2_MIN = 2
const N_BITS_STAGE2_MAX = 5
const N_BITS_STAGE2_DEFAULT = 2
const SINE_OFFSET = V_REF / 2 // DC offset so the sine sits in [0, V_ref]
const SINE_AMPLITUDE = V_REF / 2 - 0.15
const SINE_FREQ = 0.5 // Hz — 2 s per cycle
const SCOPE_WINDOW_S = 2 // seconds visible in the scope

// Advance criterion for stage 2: student must both raise n and try >= 2
// distinct bit depths so they feel the trade-off.
const N_BITS_STAGE2_TARGET = 4

// Stage 3 blind deck: one hand-picked code per band. Codes are 4 bits
// (0..15). The correct answer is the band the code lands in.
type Band = 'low' | 'mid' | 'high'
type Scenario = { code: number; band: Band }
const BLIND_DECK: readonly Scenario[] = [
  { code: 0b0010, band: 'low' }, // decimal 2  → V ≈ 0.625 V
  { code: 0b1000, band: 'mid' }, // decimal 8  → V ≈ 2.500 V
  { code: 0b1110, band: 'high' }, // decimal 14 → V ≈ 4.375 V
] as const

const dict = { en } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── Pure quantization helpers ─────────────────────────────────────────
function lsbFor(nBits: number): number {
  return V_REF / Math.pow(2, nBits)
}

/** Quantize V_in to an integer code in [0, 2^n − 1] via floor. */
function quantize(vIn: number, nBits: number): number {
  const clamped = Math.max(0, Math.min(V_REF, vIn))
  const step = lsbFor(nBits)
  const raw = Math.floor(clamped / step)
  return Math.min(Math.pow(2, nBits) - 1, raw)
}

/** Reconstructed analogue level (staircase midpoint of the code). */
function dequantize(code: number, nBits: number): number {
  return code * lsbFor(nBits)
}

/** 4-bit binary string, MSB first, always zero-padded to width. */
function toBinaryString(code: number, width: number): string {
  let s = ''
  for (let i = width - 1; i >= 0; i--) {
    s += (code >> i) & 1 ? '1' : '0'
  }
  return s
}

function bandOf(vIn: number): Band | null {
  if (vIn < BAND_LOW_MAX) return 'low'
  if (vIn >= BAND_MID_MIN && vIn < BAND_MID_MAX) return 'mid'
  if (vIn >= BAND_HIGH_MIN) return 'high'
  return null // dead-zone between bands (not used for scoring)
}

// ─── Plot coord helpers ─────────────────────────────────────────────────
// Stage 1 staircase: V_in on x, V_q on y (both 0..V_ref)
function vinToSvgX(v: number): number {
  return PLOT_X + (v / V_REF) * PLOT_W
}
function vqToSvgY(v: number): number {
  return PLOT_Y + PLOT_H - (v / V_REF) * PLOT_H
}

// Stage 2 scope: t on x, V on y (0..V_ref)
function tToScopeX(t: number): number {
  return PLOT_X + (t / SCOPE_WINDOW_S) * PLOT_W
}
function vToScopeY(v: number): number {
  return PLOT_Y + PLOT_H - (v / V_REF) * PLOT_H
}

// ─── Component ──────────────────────────────────────────────────────────
export default function Scene() {
  const { locale } = useInit()
  const stages = useMemo(() => getStagesFor(locale), [locale])
  useDeclareStages(stages)
  const labels = useMemo(() => svgLabels(locale), [locale])
  const rootRng = useSeed()

  const stageIdx = useCurrentStage()
  const setStage = useSetStage()
  const progress = useProgress()
  const complete = useComplete()

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  // ─── Stage 1 state ─────────────────────────────────────────────────────
  const [vIn, setVIn] = useState(VIN_DEFAULT)
  const [regionsSeen, setRegionsSeen] = useState<Set<Band>>(new Set())

  useEffect(() => {
    if (!isStage1) return
    const b = bandOf(vIn)
    if (!b) return
    setRegionsSeen((prev) => {
      if (prev.has(b)) return prev
      const next = new Set(prev)
      next.add(b)
      return next
    })
  }, [vIn, isStage1])

  // ─── Stage 2 state ─────────────────────────────────────────────────────
  const [nBits, setNBits] = useState(N_BITS_STAGE2_DEFAULT)
  const [nBitsTried, setNBitsTried] = useState<Set<number>>(
    new Set([N_BITS_STAGE2_DEFAULT]),
  )
  const [scopeT, setScopeT] = useState(0)

  useTicker((dt) => {
    if (!isStage2) return
    setScopeT((prev) => (prev + dt) % SCOPE_WINDOW_S)
  })

  // ─── Stage 3 state ─────────────────────────────────────────────────────
  // Seeded deck shuffle (deterministic per seed, stable across rerenders).
  const deckOrder = useMemo(
    () => rootRng.shuffle([...BLIND_DECK]) as Scenario[],
    [rootRng],
  )
  const [deckIdx, setDeckIdx] = useState(0)
  const [blindPick, setBlindPick] = useState<Band | null>(null)
  const [blindSubmitted, setBlindSubmitted] = useState(false)
  const [blindCorrect, setBlindCorrect] = useState(false)
  const [blindSolved, setBlindSolved] = useState(0)
  const [peekTip, setPeekTip] = useState<string | null>(null)
  const [peekTipIdx, setPeekTipIdx] = useState(0)

  const currentScenario = deckOrder[deckIdx % deckOrder.length]!

  const resetStageState = useCallback(() => {
    setVIn(VIN_DEFAULT)
    setRegionsSeen(new Set())
    setNBits(N_BITS_STAGE2_DEFAULT)
    setNBitsTried(new Set([N_BITS_STAGE2_DEFAULT]))
    setScopeT(0)
    setDeckIdx(0)
    setBlindPick(null)
    setBlindSubmitted(false)
    setBlindCorrect(false)
    setBlindSolved(0)
    setPeekTip(null)
    setPeekTipIdx(0)
  }, [])

  useReset(resetStageState)

  // ─── Advance predicates ────────────────────────────────────────────────
  const stage1Done = regionsSeen.size >= 3
  const stage2Done =
    nBits >= N_BITS_STAGE2_TARGET && nBitsTried.size >= 2
  const stage3Done = blindSolved >= BLIND_DECK.length

  const canSubmit = isStage1
    ? stage1Done
    : isStage2
      ? stage2Done
      : stage3Done

  useEffect(() => {
    progress(stageIdx / 3, { stage: stageIdx, canSubmit })
  }, [stageIdx, canSubmit, progress])

  useNext(() => {
    if (stageIdx < 3) {
      setStage(stageIdx + 1)
      // Reset transient stage-locals so re-entry is clean.
      setBlindPick(null)
      setBlindSubmitted(false)
      setBlindCorrect(false)
      setPeekTip(null)
    } else {
      complete({ success: true })
    }
  })

  // ─── Stage 3: submit handler (ace-the-deck) ───────────────────────────
  const handleBlindSubmit = useCallback(() => {
    if (!blindPick || blindSubmitted) return
    const correct = blindPick === currentScenario.band
    setBlindSubmitted(true)
    setBlindCorrect(correct)
    if (correct) {
      const nextSolved = blindSolved + 1
      setBlindSolved(nextSolved)
      if (nextSolved >= BLIND_DECK.length) {
        // Deck aced — wait for the chrome Next to fire complete().
        return
      }
      setTimeout(() => {
        setDeckIdx((i) => i + 1)
        setBlindPick(null)
        setBlindSubmitted(false)
        setBlindCorrect(false)
      }, 1200)
    } else {
      // Wrong — restart the deck from scenario 1, wipe progress.
      setTimeout(() => {
        setDeckIdx(0)
        setBlindPick(null)
        setBlindSubmitted(false)
        setBlindCorrect(false)
        setBlindSolved(0)
      }, 1400)
    }
  }, [blindPick, blindSubmitted, blindSolved, currentScenario.band])

  // ─── Peek (blind-stage strategy hints, NOT answers) ───────────────────
  const PEEK_TIPS = useMemo(
    () => [labels.peek_tip_1, labels.peek_tip_2],
    [labels],
  )
  usePeek(() => {
    if (!isStage3) return
    const tip = PEEK_TIPS[peekTipIdx % PEEK_TIPS.length]!
    setPeekTip(tip)
    setPeekTipIdx((i) => i + 1)
  })
  useEffect(() => {
    if (!peekTip) return
    const t = setTimeout(() => setPeekTip(null), 4000)
    return () => clearTimeout(t)
  }, [peekTip])

  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  // ─── Derived values for rendering ──────────────────────────────────────
  const stage1Code = quantize(vIn, N_BITS_DEFAULT)
  const stage1CodeStr = toBinaryString(stage1Code, N_BITS_DEFAULT)
  const stage1Vq = dequantize(stage1Code, N_BITS_DEFAULT)
  const stage1Err = vIn - stage1Vq

  // Stage 2 live sample from the sine wave.
  const stage2VinInstant =
    SINE_OFFSET + SINE_AMPLITUDE * Math.sin(2 * Math.PI * SINE_FREQ * scopeT)
  const stage2CodeInstant = quantize(stage2VinInstant, nBits)
  const stage2VqInstant = dequantize(stage2CodeInstant, nBits)

  // Peak reconstruction error for the current n over one period.
  const stage2PeakErr = useMemo(() => {
    let peak = 0
    const step = lsbFor(nBits)
    // Peak quantization error for a signal that spans the full range is ~LSB.
    // The exact peak on a floor quantizer is one LSB (just below a step edge).
    peak = step
    return peak
  }, [nBits])

  // Stage 1 staircase path — pure step function over V_in ∈ [0, V_ref].
  const staircasePath = useMemo(() => {
    const N = Math.pow(2, N_BITS_DEFAULT)
    const step = lsbFor(N_BITS_DEFAULT)
    let d = ''
    for (let i = 0; i < N; i++) {
      const x0 = vinToSvgX(i * step)
      const x1 = vinToSvgX((i + 1) * step)
      const y = vqToSvgY(i * step)
      d += `${i === 0 ? 'M' : 'L'} ${x0.toFixed(1)} ${y.toFixed(1)} `
      d += `L ${x1.toFixed(1)} ${y.toFixed(1)} `
    }
    return d
  }, [])

  // Stage 2: continuous sine + staircase reconstruction across the window.
  const sinePath = useMemo(() => {
    const steps = 200
    let d = ''
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * SCOPE_WINDOW_S
      const v = SINE_OFFSET + SINE_AMPLITUDE * Math.sin(2 * Math.PI * SINE_FREQ * t)
      d += `${i === 0 ? 'M' : 'L'} ${tToScopeX(t).toFixed(1)} ${vToScopeY(v).toFixed(1)} `
    }
    return d
  }, [])

  const reconPath = useMemo(() => {
    // Sample-and-hold at 2^n samples per scope window (approx).
    const samplesPerWindow = Math.max(8, Math.pow(2, nBits) * 2)
    let d = ''
    let prevY = 0
    for (let i = 0; i <= samplesPerWindow; i++) {
      const t = (i / samplesPerWindow) * SCOPE_WINDOW_S
      const v = SINE_OFFSET + SINE_AMPLITUDE * Math.sin(2 * Math.PI * SINE_FREQ * t)
      const code = quantize(v, nBits)
      const vq = dequantize(code, nBits)
      const sx = tToScopeX(t)
      const sy = vToScopeY(vq)
      if (i === 0) {
        d += `M ${sx.toFixed(1)} ${sy.toFixed(1)} `
      } else {
        // sample-and-hold: horizontal to sx at prevY, then vertical to sy
        d += `L ${sx.toFixed(1)} ${prevY.toFixed(1)} L ${sx.toFixed(1)} ${sy.toFixed(1)} `
      }
      prevY = sy
    }
    return d
  }, [nBits])

  // ─── HUD strings ───────────────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`

  const hudTR = isStage1
    ? `V_in = ${vIn.toFixed(2)} V · code = ${stage1CodeStr}`
    : isStage2
      ? `n = ${nBits} · LSB = ${lsbFor(nBits).toFixed(3)} V · V_in = ${stage2VinInstant.toFixed(2)} V`
      : `${labels.scenario}: ${deckIdx + 1}/${BLIND_DECK.length} · ${blindSolved}/${BLIND_DECK.length} ${labels.solved}`

  const hudBL =
    isStage3 && peekTip
      ? peekTip
      : isStage1
        ? labels.tip1
        : isStage2
          ? labels.tip2
          : labels.tip3

  // Secondary progress chip under TL (NOT in the BR corner).
  const stage1Chip = `${regionsSeen.has('low') ? '✓' : '○'} ${labels.low_seen} · ${regionsSeen.has('mid') ? '✓' : '○'} ${labels.mid_seen} · ${regionsSeen.has('high') ? '✓' : '○'} ${labels.high_seen}`
  const stage2Chip = `${labels.n_values}: ${nBitsTried.size}/2 · ${labels.error_peak} ≈ ${stage2PeakErr.toFixed(3)} V${nBits < N_BITS_STAGE2_TARGET ? ' · ' + labels.advance : ''}`
  const progressChip = isStage1 ? stage1Chip : isStage2 ? stage2Chip : null

  // ─── Circuit-block geometry ────────────────────────────────────────────
  const blk = {
    x: SCH_X + 60,
    y: SCH_Y + 130,
    w: 200,
    h: 90,
  }
  const src = { x: SCH_X + 24, y: blk.y + blk.h / 2 }
  const bitsY = blk.y + blk.h + 60
  const bitsStartX = blk.x + 18
  const bitSpacing = (blk.w - 36) / (N_BITS_DEFAULT - 1)

  // Active bits list depends on the stage:
  //  · Stage 1: current V_in code
  //  · Stage 2: current instantaneous sine sample
  //  · Stage 3: the captured code the student must classify
  const shownCode =
    isStage3
      ? currentScenario.code
      : isStage2
        ? stage2CodeInstant
        : stage1Code
  const shownWidth = isStage2 ? Math.max(N_BITS_DEFAULT, nBits) : N_BITS_DEFAULT
  const shownStr = toBinaryString(shownCode, shownWidth)

  const activeColor = '#37C9B8'
  const wireStroke = '#54617A'

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block', userSelect: 'none' }}
      >
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        {/* ─── Left panel: ADC block schematic ─────────────────────── */}
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

        {/* Analogue source symbol */}
        <circle cx={src.x} cy={src.y} r={16} fill="none" stroke="#EAF0FA" strokeWidth={1.6} />
        <path
          d={`M ${src.x - 10} ${src.y} Q ${src.x - 5} ${src.y - 8}, ${src.x} ${src.y} T ${src.x + 10} ${src.y}`}
          fill="none"
          stroke="#EAF0FA"
          strokeWidth={1.4}
        />
        <text
          x={src.x}
          y={src.y + 30}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={10}
          textAnchor="middle"
        >
          {labels.vin_label}
        </text>

        {/* Wire from source into the ADC block */}
        <line
          x1={src.x + 16}
          y1={src.y}
          x2={blk.x}
          y2={src.y}
          stroke={wireStroke}
          strokeWidth={1.6}
        />

        {/* ADC block body */}
        <rect
          x={blk.x}
          y={blk.y}
          width={blk.w}
          height={blk.h}
          fill="#12203a"
          stroke="#3A4863"
          strokeWidth={1.4}
          rx={6}
        />
        <text
          x={blk.x + blk.w / 2}
          y={blk.y + blk.h / 2 - 6}
          fill="#EAF0FA"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={16}
          textAnchor="middle"
          letterSpacing="0.14em"
        >
          ADC
        </text>
        <text
          x={blk.x + blk.w / 2}
          y={blk.y + blk.h / 2 + 14}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={10}
          textAnchor="middle"
        >
          {labels.vref_label} = {V_REF.toFixed(0)} V
        </text>
        <text
          x={blk.x + blk.w / 2}
          y={blk.y + blk.h / 2 + 28}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={10}
          textAnchor="middle"
        >
          n = {isStage2 ? nBits : N_BITS_DEFAULT} {labels.bits_label}
        </text>

        {/* Bit output rails from ADC block downward */}
        {Array.from({ length: N_BITS_DEFAULT }).map((_, i) => {
          const bx = bitsStartX + i * bitSpacing
          return (
            <line
              key={`rail-${i}`}
              x1={bx}
              y1={blk.y + blk.h}
              x2={bx}
              y2={bitsY - 14}
              stroke={wireStroke}
              strokeWidth={1.4}
            />
          )
        })}

        {/* Bit LEDs + labels */}
        {Array.from({ length: N_BITS_DEFAULT }).map((_, i) => {
          const bx = bitsStartX + i * bitSpacing
          const bitLabelIdx = N_BITS_DEFAULT - 1 - i
          const bitVal = (shownCode >> bitLabelIdx) & 1
          const bright = bitVal === 1
          return (
            <g key={`bit-${i}`}>
              <circle
                cx={bx}
                cy={bitsY}
                r={9}
                fill={bright ? activeColor : '#0D1524'}
                stroke={bright ? activeColor : '#3A4863'}
                strokeWidth={1.4}
              />
              <text
                x={bx}
                y={bitsY + 4}
                fill={bright ? '#0D1524' : '#54617A'}
                fontFamily="'JetBrains Mono', monospace"
                fontSize={10}
                textAnchor="middle"
              >
                {bitVal}
              </text>
              <text
                x={bx}
                y={bitsY + 26}
                fill="#6C7A93"
                fontFamily="'JetBrains Mono', monospace"
                fontSize={9}
                textAnchor="middle"
              >
                b{bitLabelIdx}
              </text>
            </g>
          )
        })}

        {/* Captured-code readout under the LEDs */}
        <text
          x={blk.x + blk.w / 2}
          y={bitsY + 54}
          fill="#EAF0FA"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={14}
          textAnchor="middle"
          letterSpacing="0.2em"
        >
          {shownStr}
        </text>
        <text
          x={blk.x + blk.w / 2}
          y={bitsY + 70}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={9}
          textAnchor="middle"
          letterSpacing="0.14em"
        >
          {isStage3 ? labels.captured_code : labels.code_label}
        </text>

        {/* ─── Right panel: staircase (stage 1) / scope (stages 2, 3) ─ */}
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

        <clipPath id="can-plot-clip">
          <rect x={PLOT_X} y={PLOT_Y} width={PLOT_W} height={PLOT_H} />
        </clipPath>

        {isStage1 ? (
          <>
            {/* Grid */}
            {[1, 2, 3, 4].map((v) => (
              <line
                key={`vg-${v}`}
                x1={vinToSvgX(v)}
                y1={PLOT_Y}
                x2={vinToSvgX(v)}
                y2={PLOT_Y + PLOT_H}
                stroke="#12203a"
                strokeWidth={1}
              />
            ))}
            {[1, 2, 3, 4].map((v) => (
              <line
                key={`hg-${v}`}
                x1={PLOT_X}
                y1={vqToSvgY(v)}
                x2={PLOT_X + PLOT_W}
                y2={vqToSvgY(v)}
                stroke="#12203a"
                strokeWidth={1}
              />
            ))}

            {/* Axes */}
            <line
              x1={PLOT_X}
              y1={PLOT_Y + PLOT_H}
              x2={PLOT_X + PLOT_W}
              y2={PLOT_Y + PLOT_H}
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
            <text
              x={PLOT_X + PLOT_W / 2}
              y={PLOT_Y + PLOT_H - 4}
              fill="#6C7A93"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
              textAnchor="middle"
            >
              V_in (V) →
            </text>
            <text
              x={PLOT_X + 6}
              y={PLOT_Y + 12}
              fill="#6C7A93"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
            >
              V_q ↑
            </text>

            {/* Band shading — encoded so students can align bands to V_in */}
            <rect
              x={vinToSvgX(0)}
              y={PLOT_Y}
              width={vinToSvgX(BAND_LOW_MAX) - vinToSvgX(0)}
              height={PLOT_H}
              fill="#37C9B8"
              opacity={0.05}
            />
            <rect
              x={vinToSvgX(BAND_MID_MIN)}
              y={PLOT_Y}
              width={vinToSvgX(BAND_MID_MAX) - vinToSvgX(BAND_MID_MIN)}
              height={PLOT_H}
              fill="#37C9B8"
              opacity={0.05}
            />
            <rect
              x={vinToSvgX(BAND_HIGH_MIN)}
              y={PLOT_Y}
              width={vinToSvgX(V_REF) - vinToSvgX(BAND_HIGH_MIN)}
              height={PLOT_H}
              fill="#37C9B8"
              opacity={0.05}
            />

            {/* Ideal 45° line (dashed) */}
            <line
              x1={vinToSvgX(0)}
              y1={vqToSvgY(0)}
              x2={vinToSvgX(V_REF)}
              y2={vqToSvgY(V_REF)}
              stroke="#54617A"
              strokeWidth={1}
              strokeDasharray="3 4"
              opacity={0.5}
            />

            <g clipPath="url(#can-plot-clip)">
              {/* Staircase */}
              <path
                d={staircasePath}
                fill="none"
                stroke={activeColor}
                strokeWidth={2.2}
                strokeLinejoin="miter"
              />
              {/* Operating-point marker (V_in, V_q) */}
              <line
                x1={vinToSvgX(vIn)}
                y1={PLOT_Y}
                x2={vinToSvgX(vIn)}
                y2={PLOT_Y + PLOT_H}
                stroke="#F9A968"
                strokeWidth={1}
                opacity={0.5}
              />
              <circle
                cx={vinToSvgX(vIn)}
                cy={vqToSvgY(stage1Vq)}
                r={5}
                fill="#F97316"
              />
            </g>

            {/* Legend: error line callout */}
            <text
              x={PLOT_X + PLOT_W - 6}
              y={PLOT_Y + 12}
              fill="#F97316"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={9}
              textAnchor="end"
            >
              ε = {stage1Err.toFixed(3)} V
            </text>
          </>
        ) : isStage2 ? (
          <>
            {/* Scope grid */}
            {[0.5, 1, 1.5].map((t) => (
              <line
                key={`sg-${t}`}
                x1={tToScopeX(t)}
                y1={PLOT_Y}
                x2={tToScopeX(t)}
                y2={PLOT_Y + PLOT_H}
                stroke="#12203a"
                strokeWidth={1}
              />
            ))}
            {[1, 2, 3, 4].map((v) => (
              <line
                key={`hs-${v}`}
                x1={PLOT_X}
                y1={vToScopeY(v)}
                x2={PLOT_X + PLOT_W}
                y2={vToScopeY(v)}
                stroke="#12203a"
                strokeWidth={1}
              />
            ))}
            <line
              x1={PLOT_X}
              y1={PLOT_Y + PLOT_H}
              x2={PLOT_X + PLOT_W}
              y2={PLOT_Y + PLOT_H}
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
            <text
              x={PLOT_X + PLOT_W / 2}
              y={PLOT_Y + PLOT_H - 4}
              fill="#6C7A93"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
              textAnchor="middle"
            >
              t (s) →
            </text>
            <text
              x={PLOT_X + 6}
              y={PLOT_Y + 12}
              fill="#6C7A93"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
            >
              V ↑
            </text>

            <g clipPath="url(#can-plot-clip)">
              {/* Continuous sine (target) */}
              <path
                d={sinePath}
                fill="none"
                stroke="#F97316"
                strokeWidth={2}
                strokeDasharray="4 4"
                opacity={0.8}
              />
              {/* Staircase reconstruction */}
              <path
                d={reconPath}
                fill="none"
                stroke={activeColor}
                strokeWidth={2}
              />
              {/* Sample cursor + live dot */}
              <line
                x1={tToScopeX(scopeT)}
                y1={PLOT_Y}
                x2={tToScopeX(scopeT)}
                y2={PLOT_Y + PLOT_H}
                stroke="#F9A968"
                strokeWidth={1}
                opacity={0.35}
              />
              <circle
                cx={tToScopeX(scopeT)}
                cy={vToScopeY(stage2VqInstant)}
                r={4}
                fill={activeColor}
              />
            </g>

            {/* Legend */}
            <g transform={`translate(${PLOT_X + 10}, ${PLOT_Y + PLOT_H - 26})`}>
              <line
                x1={0}
                y1={0}
                x2={16}
                y2={0}
                stroke="#F97316"
                strokeWidth={2}
                strokeDasharray="4 4"
              />
              <text
                x={20}
                y={3}
                fill="#F97316"
                fontFamily="'JetBrains Mono', monospace"
                fontSize={9}
              >
                {labels.sine_label}
              </text>
              <line x1={0} y1={14} x2={16} y2={14} stroke={activeColor} strokeWidth={2} />
              <text
                x={20}
                y={17}
                fill={activeColor}
                fontFamily="'JetBrains Mono', monospace"
                fontSize={9}
              >
                {labels.recon_label}
              </text>
            </g>
          </>
        ) : (
          <>
            {/* Stage 3: show the captured code big + prompt. NO band hint,
                NO staircase, NO V_in reveal. Student computes on paper. */}
            <text
              x={PLOT_X + PLOT_W / 2}
              y={PLOT_Y + 60}
              fill="#6C7A93"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={11}
              textAnchor="middle"
              letterSpacing="0.16em"
            >
              {labels.captured_code}
            </text>
            <text
              x={PLOT_X + PLOT_W / 2}
              y={PLOT_Y + 130}
              fill={activeColor}
              fontFamily="'JetBrains Mono', monospace"
              fontSize={44}
              textAnchor="middle"
              letterSpacing="0.3em"
            >
              {toBinaryString(currentScenario.code, N_BITS_DEFAULT)}
            </text>
            <text
              x={PLOT_X + PLOT_W / 2}
              y={PLOT_Y + 170}
              fill="#6C7A93"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={11}
              textAnchor="middle"
              letterSpacing="0.14em"
            >
              {labels.vref_label} = {V_REF.toFixed(0)} V · n = {N_BITS_DEFAULT} · {labels.lsb_label} = {lsbFor(N_BITS_DEFAULT).toFixed(4)} V
            </text>

            {/* Post-submit feedback (never before) */}
            {blindSubmitted && (
              <text
                x={PLOT_X + PLOT_W / 2}
                y={PLOT_Y + 220}
                fill={blindCorrect ? activeColor : '#EF476F'}
                fontFamily="'JetBrains Mono', monospace"
                fontSize={14}
                textAnchor="middle"
                letterSpacing="0.14em"
              >
                {blindCorrect ? `✓ ${labels.correct}` : `✗ ${labels.wrong}`}
              </text>
            )}
            {blindSubmitted && (
              <text
                x={PLOT_X + PLOT_W / 2}
                y={PLOT_Y + 246}
                fill="#6C7A93"
                fontFamily="'JetBrains Mono', monospace"
                fontSize={11}
                textAnchor="middle"
              >
                V_in ≈ {(currentScenario.code * lsbFor(N_BITS_DEFAULT)).toFixed(3)} V
              </text>
            )}
          </>
        )}
      </svg>

      {/* ─── HUD overlays (HTML, rem-sized) ───────────────────────────── */}
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
          maxWidth: '55%',
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
          color: peekTip && isStage3 ? '#F9A968' : '#6C7A93',
          zIndex: 5,
          pointerEvents: 'none',
          maxWidth: '48%',
        }}
      >
        {hudBL}
      </div>
      {/* NO bottom-right overlay — reserved for parent chrome */}

      {/* Secondary progress chip under TL (stages 1 & 2 only) */}
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

      {/* ─── Stage 1: V_in slider ───────────────────────────────────── */}
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
              fontSize: '1.6rem',
              color: '#6C7A93',
            }}
          >
            {VIN_MAX.toFixed(1)}
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
              min={0}
              max={500}
              step={1}
              value={Math.round(vIn * 100)}
              onChange={(e) => setVIn(Number(e.target.value) / 100)}
              style={{
                width: '30rem',
                height: '2rem',
                transform: 'rotate(-90deg)',
                transformOrigin: 'center',
                accentColor: activeColor,
                cursor: 'pointer',
              }}
            />
          </div>
          <div
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '1.6rem',
              color: '#6C7A93',
            }}
          >
            {VIN_MIN.toFixed(1)}
          </div>
          <div
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '1.6rem',
              color: activeColor,
            }}
          >
            V_in = {vIn.toFixed(2)} V
          </div>
        </div>
      )}

      {/* ─── Stage 2: n-bits picker (bottom center) ───────────────── */}
      {isStage2 && (
        <div
          style={{
            position: 'absolute',
            bottom: '4rem',
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            gap: '1.5rem',
            zIndex: 10,
            alignItems: 'center',
          }}
        >
          <div
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '1.8rem',
              color: '#6C7A93',
              letterSpacing: '0.14em',
            }}
          >
            n =
          </div>
          {Array.from(
            { length: N_BITS_STAGE2_MAX - N_BITS_STAGE2_MIN + 1 },
            (_, i) => N_BITS_STAGE2_MIN + i,
          ).map((n) => {
            const active = n === nBits
            return (
              <button
                key={`n-${n}`}
                type="button"
                onClick={() => {
                  setNBits(n)
                  setNBitsTried((prev) => {
                    if (prev.has(n)) return prev
                    const next = new Set(prev)
                    next.add(n)
                    return next
                  })
                }}
                style={{
                  padding: '1rem 1.6rem',
                  background: active ? activeColor : '#12203a',
                  color: active ? '#0D1524' : '#EAF0FA',
                  border: `1.5px solid ${active ? activeColor : '#3A4863'}`,
                  borderRadius: '1rem',
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: '1.9rem',
                  cursor: 'pointer',
                  minWidth: '5rem',
                }}
              >
                {n}
              </button>
            )
          })}
        </div>
      )}

      {/* ─── Stage 3: band-picker + submit ──────────────────────────── */}
      {isStage3 && (
        <>
          <div
            style={{
              position: 'absolute',
              bottom: '10rem',
              left: '50%',
              transform: 'translateX(-50%)',
              display: 'flex',
              gap: '1.6rem',
              zIndex: 10,
            }}
          >
            {(['low', 'mid', 'high'] as Band[]).map((b) => {
              const selected = blindPick === b
              // Idle color stays dark until submit. Only after submit do we
              // colour the picked button teal/red — never pre-submit hover
              // hints or preview.
              const isRevealed = blindSubmitted && selected
              const bg = isRevealed
                ? blindCorrect
                  ? activeColor
                  : '#EF476F'
                : selected
                  ? '#1E2F4F'
                  : '#12203a'
              const border = selected ? '#EAF0FA' : '#3A4863'
              const bandLabel =
                b === 'low'
                  ? labels.band_low
                  : b === 'mid'
                    ? labels.band_mid
                    : labels.band_high
              return (
                <button
                  key={`band-${b}`}
                  type="button"
                  onClick={() => {
                    if (blindSubmitted) return
                    setBlindPick(b)
                  }}
                  disabled={blindSubmitted}
                  style={{
                    padding: '1.2rem 1.6rem',
                    background: bg,
                    color: isRevealed && blindCorrect ? '#0D1524' : '#EAF0FA',
                    border: `1.5px solid ${border}`,
                    borderRadius: '1rem',
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: '1.6rem',
                    cursor: blindSubmitted ? 'default' : 'pointer',
                    minWidth: '17rem',
                    textAlign: 'center',
                  }}
                >
                  {bandLabel}
                </button>
              )
            })}
          </div>

          <div
            style={{
              position: 'absolute',
              bottom: '4rem',
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
                background: !blindPick || blindSubmitted ? '#3A4863' : '#F97316',
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
