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

// Left panel: R-2R DAC block schematic
const SCH_X = 32
const SCH_Y = 60
const SCH_W = 360
const SCH_H = 350

// Right panel: bar chart / scope
const PLOT_X = 412
const PLOT_Y = 60
const PLOT_W = 250
const PLOT_H = 350

// ─── DAC physics constants ────────────────────────────────────────────
const V_REF = 5 // reference voltage, V
const N_BITS_DEFAULT = 4 // display width for the DAC word

// Stage 2 bit-depth sweep
const N_BITS_STAGE2_MIN = 3
const N_BITS_STAGE2_MAX = 5
const N_BITS_STAGE2_DEFAULT = 3
const N_BITS_STAGE2_TARGET = 4 // must reach n >= 4 to advance
const SINE_OFFSET = V_REF / 2 // DC offset so sine sits in [0, V_ref]
const SINE_AMPLITUDE = V_REF / 2 - 0.15
const SINE_FREQ = 0.5 // Hz — one cycle per 2 s window
const SCOPE_WINDOW_S = 2

// Stage 1 coverage gates
const CODES_MID_REQUIRED = 4 // number of intermediate codes to visit
const STAGE1_LOW_CODE = 0
const STAGE1_HIGH_CODE = 15

// Stage 3 blind deck — three hand-picked targets, non-trivial bit patterns.
// Codes are chosen so that at least two bits are set and the student can't
// solve by pattern-matching a single MSB.
type Scenario = { code: number; vTarget: number }
const BLIND_DECK: readonly Scenario[] = [
  { code: 0b0110, vTarget: 6 * (V_REF / 16) }, // 6  → 1.8750 V
  { code: 0b1010, vTarget: 10 * (V_REF / 16) }, // 10 → 3.1250 V
  { code: 0b1101, vTarget: 13 * (V_REF / 16) }, // 13 → 4.0625 V
] as const

const dict = { en } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── Pure DAC helpers ──────────────────────────────────────────────────
function lsbFor(nBits: number): number {
  return V_REF / Math.pow(2, nBits)
}

/** Decimal code from a bits[] array where bits[0] is the LSB. */
function bitsToCode(bits: readonly boolean[]): number {
  let n = 0
  for (let i = 0; i < bits.length; i++) {
    if (bits[i]) n |= 1 << i
  }
  return n
}

/** Analogue output for a given decimal code at a given bit depth. */
function dacOut(code: number, nBits: number): number {
  return V_REF * (code / Math.pow(2, nBits))
}

/** MSB-first zero-padded binary string. */
function toBinaryString(code: number, width: number): string {
  let s = ''
  for (let i = width - 1; i >= 0; i--) {
    s += (code >> i) & 1 ? '1' : '0'
  }
  return s
}

/** Rounded quantized code for a target voltage (used for the sine sample). */
function quantizeSample(v: number, nBits: number): number {
  const steps = Math.pow(2, nBits)
  const raw = Math.round((v / V_REF) * steps)
  return Math.max(0, Math.min(steps - 1, raw))
}

// ─── Plot coord helpers ────────────────────────────────────────────────
// Stage 1: bar chart of V_s across all 16 codes.
function codeToBarX(code: number, total: number): number {
  const pad = 20
  const usable = PLOT_W - 2 * pad
  return PLOT_X + pad + (code + 0.5) * (usable / total)
}
function vToBarY(v: number): number {
  return PLOT_Y + PLOT_H - 30 - (v / V_REF) * (PLOT_H - 60)
}

// Stage 2 scope
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

  // ─── Bit-switch state (shared across stages — the student's DOFs) ─────
  // bits[0] = LSB (b0), bits[N_BITS_DEFAULT-1] = MSB (b3)
  const [bits, setBits] = useState<boolean[]>(() =>
    new Array(N_BITS_DEFAULT).fill(false),
  )
  const code = useMemo(() => bitsToCode(bits), [bits])

  // ─── Stage 1: coverage tracking ──────────────────────────────────────
  const [lowSeen, setLowSeen] = useState(false)
  const [highSeen, setHighSeen] = useState(false)
  const [midCodesSeen, setMidCodesSeen] = useState<Set<number>>(new Set())

  useEffect(() => {
    if (!isStage1) return
    if (code === STAGE1_LOW_CODE) setLowSeen(true)
    else if (code === STAGE1_HIGH_CODE) setHighSeen(true)
    else {
      setMidCodesSeen((prev) => {
        if (prev.has(code)) return prev
        const next = new Set(prev)
        next.add(code)
        return next
      })
    }
  }, [code, isStage1])

  // ─── Stage 2: bit-depth sweep + scope ticker ──────────────────────────
  const [nBits, setNBits] = useState(N_BITS_STAGE2_DEFAULT)
  const [nBitsTried, setNBitsTried] = useState<Set<number>>(
    new Set([N_BITS_STAGE2_DEFAULT]),
  )
  const [scopeT, setScopeT] = useState(0)

  useTicker((dt) => {
    if (!isStage2) return
    setScopeT((prev) => (prev + dt) % SCOPE_WINDOW_S)
  })

  // ─── Stage 3: blind deck ─────────────────────────────────────────────
  const deckOrder = useMemo(
    () => rootRng.shuffle([...BLIND_DECK]) as Scenario[],
    [rootRng],
  )
  const [deckIdx, setDeckIdx] = useState(0)
  const [blindSubmitted, setBlindSubmitted] = useState(false)
  const [blindCorrect, setBlindCorrect] = useState(false)
  const [blindSolved, setBlindSolved] = useState(0)
  const [peekTip, setPeekTip] = useState<string | null>(null)
  const [peekTipIdx, setPeekTipIdx] = useState(0)

  const currentScenario = deckOrder[deckIdx % deckOrder.length]!

  const resetStageState = useCallback(() => {
    setBits(new Array(N_BITS_DEFAULT).fill(false))
    setLowSeen(false)
    setHighSeen(false)
    setMidCodesSeen(new Set())
    setNBits(N_BITS_STAGE2_DEFAULT)
    setNBitsTried(new Set([N_BITS_STAGE2_DEFAULT]))
    setScopeT(0)
    setDeckIdx(0)
    setBlindSubmitted(false)
    setBlindCorrect(false)
    setBlindSolved(0)
    setPeekTip(null)
    setPeekTipIdx(0)
  }, [])

  useReset(resetStageState)

  // ─── Advance predicates ────────────────────────────────────────────────
  const stage1Done =
    lowSeen && highSeen && midCodesSeen.size >= CODES_MID_REQUIRED
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
      // Clear the bit switches when moving between stages so the student
      // starts each stage with a clean 0000 word.
      setBits(new Array(N_BITS_DEFAULT).fill(false))
      setBlindSubmitted(false)
      setBlindCorrect(false)
      setPeekTip(null)
      setStage(stageIdx + 1)
    } else {
      complete({ success: true })
    }
  })

  // ─── Stage 3: submit handler (ace-the-deck) ───────────────────────────
  const handleBlindSubmit = useCallback(() => {
    if (blindSubmitted) return
    const correct = code === currentScenario.code
    setBlindSubmitted(true)
    setBlindCorrect(correct)
    if (correct) {
      const nextSolved = blindSolved + 1
      setBlindSolved(nextSolved)
      if (nextSolved >= BLIND_DECK.length) {
        // Deck aced — waits for chrome Next to fire complete().
        return
      }
      setTimeout(() => {
        setDeckIdx((i) => i + 1)
        setBits(new Array(N_BITS_DEFAULT).fill(false))
        setBlindSubmitted(false)
        setBlindCorrect(false)
      }, 1200)
    } else {
      // Wrong — wipe deck progress and restart from scenario 1.
      setTimeout(() => {
        setDeckIdx(0)
        setBits(new Array(N_BITS_DEFAULT).fill(false))
        setBlindSubmitted(false)
        setBlindCorrect(false)
        setBlindSolved(0)
      }, 1400)
    }
  }, [code, blindSubmitted, blindSolved, currentScenario.code])

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
    const t = setTimeout(() => setPeekTip(null), 4500)
    return () => clearTimeout(t)
  }, [peekTip])

  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  // ─── Derived values ────────────────────────────────────────────────────
  // In Stage 3, we DELIBERATELY do not compute or show the current
  // candidate V_s — that would be help. The student computes on paper.
  const currentVs = dacOut(code, N_BITS_DEFAULT)

  // Stage 2 sine + reconstruction: the DAC replays a code stream that
  // approximates a sine at the chosen bit depth. The bit switches are
  // frozen (they belong to the DAC block schematic and follow the current
  // sample of the reconstruction, driven by the ticker).
  const stage2VinInstant =
    SINE_OFFSET + SINE_AMPLITUDE * Math.sin(2 * Math.PI * SINE_FREQ * scopeT)
  const stage2CodeInstant = quantizeSample(stage2VinInstant, nBits)
  const stage2VsInstant = dacOut(stage2CodeInstant, nBits)
  const stage2PeakErr = useMemo(() => lsbFor(nBits) / 2, [nBits])

  // Which bit pattern to display in the schematic LEDs.
  //  · Stage 1: the student's toggled bits (their DOF).
  //  · Stage 2: the running sine sample (frozen sample-and-hold at scopeT).
  //  · Stage 3: the student's toggled bits (their DOF — required per §4.7).
  const shownCode = isStage2 ? stage2CodeInstant : code
  const shownWidth = isStage2 ? Math.max(N_BITS_DEFAULT, nBits) : N_BITS_DEFAULT
  const shownStr = toBinaryString(shownCode, shownWidth)

  // Stage 2: pre-recorded sine + staircase reconstruction across window
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
    const samplesPerWindow = Math.max(8, Math.pow(2, nBits) * 2)
    let d = ''
    let prevY = 0
    for (let i = 0; i <= samplesPerWindow; i++) {
      const t = (i / samplesPerWindow) * SCOPE_WINDOW_S
      const v = SINE_OFFSET + SINE_AMPLITUDE * Math.sin(2 * Math.PI * SINE_FREQ * t)
      const codeI = quantizeSample(v, nBits)
      const vq = dacOut(codeI, nBits)
      const sx = tToScopeX(t)
      const sy = vToScopeY(vq)
      if (i === 0) {
        d += `M ${sx.toFixed(1)} ${sy.toFixed(1)} `
      } else {
        d += `L ${sx.toFixed(1)} ${prevY.toFixed(1)} L ${sx.toFixed(1)} ${sy.toFixed(1)} `
      }
      prevY = sy
    }
    return d
  }, [nBits])

  // ─── HUD strings ───────────────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`

  // TR readout of required info per stage.
  // Stage 3 does NOT show current V_s (that would be help — the student's
  // task is to compute it). It shows the target, V_ref/LSB (required
  // constants), and their current bit pattern.
  const hudTR = isStage1
    ? `${labels.vs_label} = ${currentVs.toFixed(3)} V · N = ${code}`
    : isStage2
      ? `n = ${nBits} · ${labels.lsb_label} = ${lsbFor(nBits).toFixed(3)} V`
      : `${labels.target_voltage} = ${currentScenario.vTarget.toFixed(4)} V · N = ${code}`

  const hudBL =
    isStage3 && peekTip
      ? peekTip
      : isStage1
        ? labels.tip1
        : isStage2
          ? labels.tip2
          : labels.tip3

  // Stage 1 chip: shows extremes seen + count of mid codes.
  const stage1Chip = `${lowSeen ? '✓' : '○'} 0000 · ${highSeen ? '✓' : '○'} 1111 · ${labels.codes_seen}: ${midCodesSeen.size}/${CODES_MID_REQUIRED}`
  // Stage 2 chip: which depths tried + peak error.
  const stage2Chip = `${labels.n_values}: ${nBitsTried.size}/2 · ${labels.error_peak} ≈ ${stage2PeakErr.toFixed(3)} V${nBits < N_BITS_STAGE2_TARGET ? ' · ' + labels.advance : ''}`
  // Stage 3 chip: deck progress.
  const stage3Chip = `${labels.scenario}: ${deckIdx + 1}/${BLIND_DECK.length} · ${blindSolved}/${BLIND_DECK.length} ${labels.solved}`
  const progressChip = isStage1 ? stage1Chip : isStage2 ? stage2Chip : stage3Chip

  // ─── Schematic geometry ────────────────────────────────────────────────
  const blk = {
    x: SCH_X + 60,
    y: SCH_Y + 130,
    w: 200,
    h: 90,
  }
  const bitsY = blk.y - 30
  const bitsStartX = blk.x + 18
  const bitSpacing = (blk.w - 36) / (N_BITS_DEFAULT - 1)
  const outX = blk.x + blk.w
  const outY = blk.y + blk.h / 2
  const loadX = outX + 40

  const activeColor = '#37C9B8'
  const wireStroke = '#54617A'

  // Stage 1 bar chart
  const totalCodes = Math.pow(2, N_BITS_DEFAULT)

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block', userSelect: 'none' }}
      >
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        {/* ─── Left panel: DAC block schematic ─────────────────────── */}
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

        {/* Bit rails coming into the DAC block from above */}
        {Array.from({ length: N_BITS_DEFAULT }).map((_, i) => {
          const bx = bitsStartX + i * bitSpacing
          return (
            <line
              key={`rail-${i}`}
              x1={bx}
              y1={bitsY + 14}
              x2={bx}
              y2={blk.y}
              stroke={wireStroke}
              strokeWidth={1.4}
            />
          )
        })}

        {/* Bit LEDs (visual echo of switches — Stage 2 shows sine sample) */}
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
                y={bitsY - 16}
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

        {/* DAC block body */}
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
          DAC (R-2R)
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

        {/* Analogue output wire + V_s label (voltage NOT shown in stage 3) */}
        <line
          x1={outX}
          y1={outY}
          x2={loadX}
          y2={outY}
          stroke={wireStroke}
          strokeWidth={1.6}
        />
        <circle
          cx={loadX}
          cy={outY}
          r={4}
          fill="#EAF0FA"
        />
        <text
          x={loadX + 10}
          y={outY + 4}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={10}
        >
          {labels.vs_label}
        </text>

        {/* Code readout under the DAC block */}
        <text
          x={blk.x + blk.w / 2}
          y={blk.y + blk.h + 30}
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
          y={blk.y + blk.h + 46}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={9}
          textAnchor="middle"
          letterSpacing="0.14em"
        >
          N = {isStage2 ? stage2CodeInstant : code}
        </text>

        {/* ─── Right panel: bar chart (stage 1) / scope (stage 2) /
              target readout (stage 3) ─────────────────────────────────── */}
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
          {isStage1 ? labels.characteristic : isStage2 ? labels.scope : labels.target}
        </text>

        <clipPath id="cna-plot-clip">
          <rect x={PLOT_X} y={PLOT_Y} width={PLOT_W} height={PLOT_H} />
        </clipPath>

        {isStage1 ? (
          <>
            {/* Grid — horizontal V lines */}
            {[1, 2, 3, 4].map((v) => (
              <line
                key={`hg-${v}`}
                x1={PLOT_X}
                y1={vToBarY(v)}
                x2={PLOT_X + PLOT_W}
                y2={vToBarY(v)}
                stroke="#12203a"
                strokeWidth={1}
              />
            ))}
            {/* Axes */}
            <line
              x1={PLOT_X}
              y1={vToBarY(0)}
              x2={PLOT_X + PLOT_W}
              y2={vToBarY(0)}
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
              N (binary code 0..15) →
            </text>
            <text
              x={PLOT_X + 6}
              y={PLOT_Y + 12}
              fill="#6C7A93"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
            >
              V_s ↑
            </text>

            {/* Bar for every code that has been visited (Stage 1 fill-as-you-go).
                Current code drawn in accent orange so the student sees where
                they are on the staircase. */}
            <g clipPath="url(#cna-plot-clip)">
              {(() => {
                const bars: JSX.Element[] = []
                const barW = ((PLOT_W - 40) / totalCodes) * 0.7
                const seenSet = new Set<number>(midCodesSeen)
                if (lowSeen) seenSet.add(STAGE1_LOW_CODE)
                if (highSeen) seenSet.add(STAGE1_HIGH_CODE)
                for (let c = 0; c < totalCodes; c++) {
                  const cx = codeToBarX(c, totalCodes)
                  const vy = vToBarY(dacOut(c, N_BITS_DEFAULT))
                  const bottom = vToBarY(0)
                  const seen = seenSet.has(c)
                  const isCurrent = c === code
                  if (!seen && !isCurrent) continue
                  bars.push(
                    <rect
                      key={`bar-${c}`}
                      x={cx - barW / 2}
                      y={vy}
                      width={barW}
                      height={bottom - vy}
                      fill={isCurrent ? '#F97316' : activeColor}
                      opacity={isCurrent ? 1 : 0.75}
                      rx={2}
                    />,
                  )
                }
                return bars
              })()}
            </g>
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

            <g clipPath="url(#cna-plot-clip)">
              {/* Continuous sine (target, orange dashed) */}
              <path
                d={sinePath}
                fill="none"
                stroke="#F97316"
                strokeWidth={2}
                strokeDasharray="4 4"
                opacity={0.8}
              />
              {/* DAC staircase reconstruction (green, live) */}
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
                cy={vToScopeY(stage2VsInstant)}
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
            {/* Stage 3: target voltage only. NO staircase preview. NO
                candidate V_s readout. Student computes on paper. */}
            <text
              x={PLOT_X + PLOT_W / 2}
              y={PLOT_Y + 60}
              fill="#6C7A93"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={11}
              textAnchor="middle"
              letterSpacing="0.16em"
            >
              {labels.target_voltage}
            </text>
            <text
              x={PLOT_X + PLOT_W / 2}
              y={PLOT_Y + 130}
              fill="#F97316"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={40}
              textAnchor="middle"
              letterSpacing="0.06em"
            >
              {currentScenario.vTarget.toFixed(4)} V
            </text>
            <text
              x={PLOT_X + PLOT_W / 2}
              y={PLOT_Y + 172}
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
              <>
                <text
                  x={PLOT_X + PLOT_W / 2}
                  y={PLOT_Y + 226}
                  fill={blindCorrect ? activeColor : '#EF476F'}
                  fontFamily="'JetBrains Mono', monospace"
                  fontSize={14}
                  textAnchor="middle"
                  letterSpacing="0.14em"
                >
                  {blindCorrect ? `✓ ${labels.correct}` : `✗ ${labels.wrong}`}
                </text>
                <text
                  x={PLOT_X + PLOT_W / 2}
                  y={PLOT_Y + 252}
                  fill="#6C7A93"
                  fontFamily="'JetBrains Mono', monospace"
                  fontSize={11}
                  textAnchor="middle"
                >
                  {labels.target}: {toBinaryString(currentScenario.code, N_BITS_DEFAULT)} · {labels.your_pick}: {toBinaryString(code, N_BITS_DEFAULT)}
                </text>
              </>
            )}
          </>
        )}
      </svg>

      {/* ─── HUD overlays ───────────────────────────────────────────────── */}
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

      {/* Secondary progress chip under TL */}
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

      {/* ─── Bit switches (stages 1 and 3 — the student's DOF) ────────── */}
      {(isStage1 || isStage3) && (
        <div
          style={{
            position: 'absolute',
            bottom: '10rem',
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            gap: '2rem',
            zIndex: 10,
            alignItems: 'flex-end',
          }}
        >
          {/* Render MSB first (b3), LSB last (b0) */}
          {[...bits].reverse().map((on, idxFromMsb) => {
            const bitIdx = N_BITS_DEFAULT - 1 - idxFromMsb // 3, 2, 1, 0
            return (
              <div
                key={`switch-${bitIdx}`}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '0.5rem',
                }}
              >
                <div
                  style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: '1.4rem',
                    color: '#6C7A93',
                    letterSpacing: '0.14em',
                  }}
                >
                  b{bitIdx}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    // Disable input while a stage-3 submission is being
                    // adjudicated so the student can't reroll during feedback.
                    if (isStage3 && blindSubmitted) return
                    setBits((prev) => {
                      const next = [...prev]
                      next[bitIdx] = !next[bitIdx]
                      return next
                    })
                  }}
                  disabled={isStage3 && blindSubmitted}
                  style={{
                    width: '4.5rem',
                    height: '4.5rem',
                    background: on ? activeColor : '#12203a',
                    color: on ? '#0D1524' : '#EAF0FA',
                    border: `1.5px solid ${on ? activeColor : '#3A4863'}`,
                    borderRadius: '0.8rem',
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: '2.4rem',
                    fontWeight: 700,
                    cursor: isStage3 && blindSubmitted ? 'default' : 'pointer',
                  }}
                >
                  {on ? '1' : '0'}
                </button>
                <div
                  style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: '1.1rem',
                    color: '#54617A',
                  }}
                >
                  ×{Math.pow(2, bitIdx)}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ─── Stage 2: n-bit depth picker ─────────────────────────────── */}
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

      {/* ─── Stage 3: submit button ─────────────────────────────────── */}
      {isStage3 && (
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
            disabled={blindSubmitted}
            style={{
              padding: '1.2rem 3rem',
              background: blindSubmitted
                ? blindCorrect
                  ? activeColor
                  : '#EF476F'
                : '#F97316',
              color: '#EAF0FA',
              border: 'none',
              borderRadius: '1rem',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '1.9rem',
              letterSpacing: '0.14em',
              cursor: blindSubmitted ? 'default' : 'pointer',
              opacity: blindSubmitted ? 0.7 : 1,
            }}
          >
            {labels.submit}
          </button>
        </div>
      )}
    </div>
  )
}
