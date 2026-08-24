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
} from '@physics/sdk/react'
import { getHintFor, getStagesFor } from './stages'
import en from '../i18n/en.json'

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

// ─── Gate physics (pure, total) ─────────────────────────────────────────
type GateType = 'AND' | 'OR' | 'NAND' | 'NOR' | 'XOR'
const GATE_TYPES: GateType[] = ['AND', 'OR', 'NAND', 'NOR', 'XOR']

function gateOut(type: GateType, a: 0 | 1, b: 0 | 1): 0 | 1 {
  switch (type) {
    case 'AND':  return (a & b) as 0 | 1
    case 'OR':   return (a | b) as 0 | 1
    case 'NAND': return ((a & b) === 0 ? 1 : 0) as 0 | 1
    case 'NOR':  return ((a | b) === 0 ? 1 : 0) as 0 | 1
    case 'XOR':  return (a ^ b) as 0 | 1
  }
}

const INPUT_ROWS: ReadonlyArray<readonly [0 | 1, 0 | 1]> = [
  [0, 0],
  [0, 1],
  [1, 0],
  [1, 1],
]
const rowKey = (a: 0 | 1, b: 0 | 1) => `${a}${b}`

// Half-adder target for Stage 2
const TARGET_SUM: GateType = 'XOR'
const TARGET_CARRY: GateType = 'AND'

// Blind deck for Stage 3 — 3 gate types the student must identify in one pass
const BLIND_DECK: GateType[] = ['NAND', 'XOR', 'NOR']

// ─── Label loader ───────────────────────────────────────────────────────
const dict = { en } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── Colors ─────────────────────────────────────────────────────────────
const LIT = '#37C9B8'
const DIM = '#3A4863'
const WIRE = '#54617A'
const TARGET_ORANGE = '#F97316'
const WRONG_RED = '#EF476F'

// ─── Component ──────────────────────────────────────────────────────────
export default function Scene() {
  const { locale } = useInit()
  const stages = useMemo(() => getStagesFor(locale), [locale])
  useDeclareStages(stages)
  const labels = useMemo(() => svgLabels(locale), [locale])
  const rootRng = useSeed()

  const deckOrder = useMemo(() => rootRng.shuffle([...BLIND_DECK]) as GateType[], [rootRng])
  const [deckIdx, setDeckIdx] = useState(0)
  const currentTarget = deckOrder[deckIdx % deckOrder.length] ?? 'NAND'

  const stageIdx = useCurrentStage()
  const setStage = useSetStage()
  const progress = useProgress()
  const complete = useComplete()

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  // ─── Stage 1 state ────────────────────────────────────────────────────
  const [gate1, setGate1] = useState<GateType>('AND')
  const [a1, setA1] = useState<0 | 1>(0)
  const [b1, setB1] = useState<0 | 1>(0)
  const [filled1, setFilled1] = useState<Record<GateType, Set<string>>>({
    AND: new Set(), OR: new Set(), NAND: new Set(), NOR: new Set(), XOR: new Set(),
  })

  // Auto-record whenever inputs or gate change
  useEffect(() => {
    if (!isStage1) return
    const k = rowKey(a1, b1)
    setFilled1((prev) => {
      const cur = prev[gate1]
      if (cur.has(k)) return prev
      const nextSet = new Set(cur)
      nextSet.add(k)
      return { ...prev, [gate1]: nextSet }
    })
  }, [a1, b1, gate1, isStage1])

  const gatesFullyCovered = useMemo(
    () => GATE_TYPES.filter((g) => filled1[g].size === 4).length,
    [filled1],
  )

  // ─── Stage 2 state ────────────────────────────────────────────────────
  const [slotSum, setSlotSum] = useState<GateType>('AND')
  const [slotCarry, setSlotCarry] = useState<GateType>('AND')
  const [a2, setA2] = useState<0 | 1>(0)
  const [b2, setB2] = useState<0 | 1>(0)
  const stage2Match = useMemo(() => (
    INPUT_ROWS.every(([a, b]) =>
      gateOut(slotSum, a, b) === gateOut(TARGET_SUM, a, b) &&
      gateOut(slotCarry, a, b) === gateOut(TARGET_CARRY, a, b),
    )
  ), [slotSum, slotCarry])

  // ─── Stage 3 state ────────────────────────────────────────────────────
  const [a3, setA3] = useState<0 | 1>(0)
  const [b3, setB3] = useState<0 | 1>(0)
  const [studentTable, setStudentTable] = useState<Array<0 | 1 | null>>([null, null, null, null])
  const [blindSubmitted, setBlindSubmitted] = useState(false)
  const [blindCorrect, setBlindCorrect] = useState(false)
  const [blindSolved, setBlindSolved] = useState(0)
  const [peekTip, setPeekTip] = useState<string | null>(null)
  const peekIdxRef = useRef(0)

  const stage3AllFilled = studentTable.every((v) => v !== null)
  const stage3Done = blindSolved >= BLIND_DECK.length

  const resetStage3Round = useCallback(() => {
    setStudentTable([null, null, null, null])
    setBlindSubmitted(false)
    setBlindCorrect(false)
    setA3(0)
    setB3(0)
  }, [])

  const resetStageState = useCallback(() => {
    setGate1('AND')
    setA1(0); setB1(0)
    setFilled1({ AND: new Set(), OR: new Set(), NAND: new Set(), NOR: new Set(), XOR: new Set() })
    setSlotSum('AND'); setSlotCarry('AND')
    setA2(0); setB2(0)
    setDeckIdx(0)
    setBlindSolved(0)
    setPeekTip(null)
    peekIdxRef.current = 0
    resetStage3Round()
  }, [resetStage3Round])

  useReset(resetStageState)

  const stage1Done = gatesFullyCovered >= 2
  const canSubmit = isStage1 ? stage1Done : isStage2 ? stage2Match : stage3Done

  useEffect(() => {
    progress(stageIdx / 3, { stage: stageIdx, canSubmit })
  }, [stageIdx, canSubmit, progress])

  useNext(() => {
    if (stageIdx < 3) {
      setStage(stageIdx + 1)
      // Prep stage 3 when arriving there so the deck begins at scenario 1
      if (stageIdx === 2) {
        setDeckIdx(0)
        setBlindSolved(0)
        resetStage3Round()
      }
    } else {
      complete({ success: true })
    }
  })

  const PEEK_TIPS = useMemo(() => [labels.peek_tip_1, labels.peek_tip_2], [labels])
  usePeek(() => {
    if (!isStage3) return
    const tip = PEEK_TIPS[peekIdxRef.current % PEEK_TIPS.length] ?? ''
    setPeekTip(tip)
    peekIdxRef.current += 1
  })
  useEffect(() => {
    if (!peekTip) return
    const t = setTimeout(() => setPeekTip(null), 4000)
    return () => clearTimeout(t)
  }, [peekTip])

  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  const handleBlindSubmit = useCallback(() => {
    if (!stage3AllFilled || blindSubmitted) return
    const correct = INPUT_ROWS.every(([a, b], i) =>
      studentTable[i] === gateOut(currentTarget, a, b),
    )
    setBlindSubmitted(true)
    setBlindCorrect(correct)
    if (correct) {
      const nextSolved = blindSolved + 1
      setTimeout(() => {
        setBlindSolved(nextSolved)
        if (nextSolved < BLIND_DECK.length) {
          setDeckIdx((i) => i + 1)
          resetStage3Round()
        }
      }, 1200)
    } else {
      setTimeout(() => {
        setDeckIdx(0)
        setBlindSolved(0)
        resetStage3Round()
      }, 1500)
    }
  }, [stage3AllFilled, blindSubmitted, studentTable, currentTarget, blindSolved, resetStage3Round])

  const handleCellClick = useCallback((rowIdx: number) => {
    if (blindSubmitted) return
    setStudentTable((prev) => {
      const next = [...prev]
      const cur = next[rowIdx]
      next[rowIdx] = cur === null ? 0 : cur === 0 ? 1 : null
      return next
    })
  }, [blindSubmitted])

  // ─── HUD strings ──────────────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`

  const hudTR = isStage1
    ? `${labels.coverage} ${gatesFullyCovered}/2`
    : isStage2
      ? `SUM=${slotSum} · CARRY=${slotCarry}`
      : `${labels.scenario} ${deckIdx + 1}/${BLIND_DECK.length} · ${blindSolved}/${BLIND_DECK.length} ${labels.solved}`

  const hudBL = isStage3 && peekTip
    ? peekTip
    : (isStage1 ? labels.tip1 : isStage2 ? labels.tip2 : labels.tip3)

  const progressChip = isStage1
    ? `${gate1}: ${filled1[gate1].size}/4 ${labels.row}s`
    : isStage2 && stage2Match
      ? `✓ ${labels.match_ok}`
      : null

  // ─── Circuit geometry (single-gate layout, stages 1 & 3) ──────────────
  const swAX = SCH_X + 40, swAY = SCH_Y + 110
  const swBX = SCH_X + 40, swBY = SCH_Y + 240
  const gateBoxCX = SCH_X + SCH_W / 2, gateBoxCY = SCH_Y + 175
  const gateBoxW = 100, gateBoxH = 90
  const ledX = SCH_X + SCH_W - 40, ledY = SCH_Y + 175

  // Stage 2 layout (two-gate half-adder)
  const g2SumCY = SCH_Y + 105
  const g2CarryCY = SCH_Y + 250
  const g2CX = SCH_X + SCH_W / 2 + 10
  const ledSumX = SCH_X + SCH_W - 40, ledSumY = g2SumCY
  const ledCarryX = SCH_X + SCH_W - 40, ledCarryY = g2CarryCY

  // Truth table layout
  const tblX = PLOT_X + 12
  const tblY = PLOT_Y + 30
  const rowH = 40

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block', userSelect: 'none' }}
      >
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        {/* Left panel outline */}
        <rect x={SCH_X - 8} y={SCH_Y - 8}
              width={SCH_W + 16} height={SCH_H + 16}
              fill="none" stroke="#12203a" strokeWidth={1} rx={6} />
        <text x={SCH_X} y={SCH_Y - 14}
              fill="#6C7A93" fontFamily="'JetBrains Mono', monospace"
              fontSize={11} letterSpacing="0.1em">{labels.circuit}</text>

        {/* Right panel outline */}
        <rect x={PLOT_X - 8} y={PLOT_Y - 8}
              width={PLOT_W + 16} height={PLOT_H + 16}
              fill="none" stroke="#12203a" strokeWidth={1} rx={6} />
        <text x={PLOT_X} y={PLOT_Y - 14}
              fill="#6C7A93" fontFamily="'JetBrains Mono', monospace"
              fontSize={11} letterSpacing="0.1em">{labels.table}</text>

        {/* ═══ Stage 1: single-gate circuit ═══════════════════════════════ */}
        {isStage1 && (() => {
          const outVal = gateOut(gate1, a1, b1)
          const aHot = a1 === 1
          const bHot = b1 === 1
          const outHot = outVal === 1
          return (
            <g>
              {/* A wire */}
              <line x1={swAX + 16} y1={swAY} x2={gateBoxCX - 60} y2={swAY} stroke={aHot ? LIT : WIRE} strokeWidth={aHot ? 2.2 : 1.6} />
              <line x1={gateBoxCX - 60} y1={swAY} x2={gateBoxCX - 60} y2={gateBoxCY - 20} stroke={aHot ? LIT : WIRE} strokeWidth={aHot ? 2.2 : 1.6} />
              <line x1={gateBoxCX - 60} y1={gateBoxCY - 20} x2={gateBoxCX - gateBoxW / 2} y2={gateBoxCY - 20} stroke={aHot ? LIT : WIRE} strokeWidth={aHot ? 2.2 : 1.6} />
              {/* B wire */}
              <line x1={swBX + 16} y1={swBY} x2={gateBoxCX - 60} y2={swBY} stroke={bHot ? LIT : WIRE} strokeWidth={bHot ? 2.2 : 1.6} />
              <line x1={gateBoxCX - 60} y1={swBY} x2={gateBoxCX - 60} y2={gateBoxCY + 20} stroke={bHot ? LIT : WIRE} strokeWidth={bHot ? 2.2 : 1.6} />
              <line x1={gateBoxCX - 60} y1={gateBoxCY + 20} x2={gateBoxCX - gateBoxW / 2} y2={gateBoxCY + 20} stroke={bHot ? LIT : WIRE} strokeWidth={bHot ? 2.2 : 1.6} />
              {/* Output wire */}
              <line x1={gateBoxCX + gateBoxW / 2} y1={gateBoxCY} x2={ledX - 12} y2={ledY} stroke={outHot ? LIT : WIRE} strokeWidth={outHot ? 2.2 : 1.6} />

              {/* Gate box */}
              <rect x={gateBoxCX - gateBoxW / 2} y={gateBoxCY - gateBoxH / 2}
                    width={gateBoxW} height={gateBoxH} rx={8}
                    fill="#12203a" stroke={LIT} strokeWidth={1.5} />
              <text x={gateBoxCX} y={gateBoxCY + 6} fill="#EAF0FA"
                    fontFamily="'JetBrains Mono', monospace" fontSize={18}
                    textAnchor="middle" fontWeight={700}>{gate1}</text>

              {/* Input switches */}
              <g style={{ cursor: 'pointer' }} onClick={() => setA1((v) => (v === 0 ? 1 : 0))}>
                <circle cx={swAX} cy={swAY} r={16} fill={aHot ? LIT : '#12203a'} stroke={aHot ? LIT : WIRE} strokeWidth={1.5} />
                <text x={swAX} y={swAY + 5} fill={aHot ? '#0D1524' : '#EAF0FA'}
                      fontFamily="'JetBrains Mono', monospace" fontSize={14}
                      textAnchor="middle" fontWeight={700}>{a1}</text>
                <text x={swAX - 24} y={swAY + 5} fill="#6C7A93"
                      fontFamily="'JetBrains Mono', monospace" fontSize={12} textAnchor="end">A</text>
              </g>
              <g style={{ cursor: 'pointer' }} onClick={() => setB1((v) => (v === 0 ? 1 : 0))}>
                <circle cx={swBX} cy={swBY} r={16} fill={bHot ? LIT : '#12203a'} stroke={bHot ? LIT : WIRE} strokeWidth={1.5} />
                <text x={swBX} y={swBY + 5} fill={bHot ? '#0D1524' : '#EAF0FA'}
                      fontFamily="'JetBrains Mono', monospace" fontSize={14}
                      textAnchor="middle" fontWeight={700}>{b1}</text>
                <text x={swBX - 24} y={swBY + 5} fill="#6C7A93"
                      fontFamily="'JetBrains Mono', monospace" fontSize={12} textAnchor="end">B</text>
              </g>

              {/* LED */}
              {outHot && <circle cx={ledX} cy={ledY} r={22} fill={LIT} opacity={0.28} />}
              <circle cx={ledX} cy={ledY} r={12} fill={outHot ? LIT : DIM} stroke="#EAF0FA" strokeWidth={1.2} />
              <text x={ledX + 22} y={ledY + 5} fill="#6C7A93"
                    fontFamily="'JetBrains Mono', monospace" fontSize={12}>S</text>
            </g>
          )
        })()}

        {/* ═══ Stage 2: half-adder network ═══════════════════════════════ */}
        {isStage2 && (() => {
          const sOut = gateOut(slotSum, a2, b2)
          const cOut = gateOut(slotCarry, a2, b2)
          const aHot = a2 === 1
          const bHot = b2 === 1

          return (
            <g>
              {/* A fanout */}
              <line x1={swAX + 16} y1={swAY} x2={SCH_X + 100} y2={swAY} stroke={aHot ? LIT : WIRE} strokeWidth={aHot ? 2.2 : 1.6} />
              <line x1={SCH_X + 100} y1={swAY} x2={SCH_X + 100} y2={g2SumCY - 20} stroke={aHot ? LIT : WIRE} strokeWidth={aHot ? 2.2 : 1.6} />
              <line x1={SCH_X + 100} y1={g2SumCY - 20} x2={g2CX - 50} y2={g2SumCY - 20} stroke={aHot ? LIT : WIRE} strokeWidth={aHot ? 2.2 : 1.6} />
              <line x1={SCH_X + 100} y1={swAY} x2={SCH_X + 100} y2={g2CarryCY - 20} stroke={aHot ? LIT : WIRE} strokeWidth={aHot ? 2.2 : 1.6} />
              <line x1={SCH_X + 100} y1={g2CarryCY - 20} x2={g2CX - 50} y2={g2CarryCY - 20} stroke={aHot ? LIT : WIRE} strokeWidth={aHot ? 2.2 : 1.6} />

              {/* B fanout */}
              <line x1={swBX + 16} y1={swBY} x2={SCH_X + 120} y2={swBY} stroke={bHot ? LIT : WIRE} strokeWidth={bHot ? 2.2 : 1.6} />
              <line x1={SCH_X + 120} y1={swBY} x2={SCH_X + 120} y2={g2SumCY + 20} stroke={bHot ? LIT : WIRE} strokeWidth={bHot ? 2.2 : 1.6} />
              <line x1={SCH_X + 120} y1={g2SumCY + 20} x2={g2CX - 50} y2={g2SumCY + 20} stroke={bHot ? LIT : WIRE} strokeWidth={bHot ? 2.2 : 1.6} />
              <line x1={SCH_X + 120} y1={swBY} x2={SCH_X + 120} y2={g2CarryCY + 20} stroke={bHot ? LIT : WIRE} strokeWidth={bHot ? 2.2 : 1.6} />
              <line x1={SCH_X + 120} y1={g2CarryCY + 20} x2={g2CX - 50} y2={g2CarryCY + 20} stroke={bHot ? LIT : WIRE} strokeWidth={bHot ? 2.2 : 1.6} />

              {/* Output wires */}
              <line x1={g2CX + 50} y1={g2SumCY} x2={ledSumX - 12} y2={ledSumY} stroke={sOut === 1 ? LIT : WIRE} strokeWidth={sOut === 1 ? 2.2 : 1.6} />
              <line x1={g2CX + 50} y1={g2CarryCY} x2={ledCarryX - 12} y2={ledCarryY} stroke={cOut === 1 ? LIT : WIRE} strokeWidth={cOut === 1 ? 2.2 : 1.6} />

              {/* SUM gate */}
              <rect x={g2CX - 50} y={g2SumCY - 34}
                    width={100} height={68} rx={8}
                    fill="#12203a" stroke={LIT} strokeWidth={1.5} />
              <text x={g2CX} y={g2SumCY + 6} fill="#EAF0FA"
                    fontFamily="'JetBrains Mono', monospace" fontSize={16}
                    textAnchor="middle" fontWeight={700}>{slotSum}</text>
              <text x={g2CX} y={g2SumCY - 42} fill="#6C7A93"
                    fontFamily="'JetBrains Mono', monospace" fontSize={9}
                    textAnchor="middle" letterSpacing="0.12em">{labels.slot_sum}</text>

              {/* CARRY gate */}
              <rect x={g2CX - 50} y={g2CarryCY - 34}
                    width={100} height={68} rx={8}
                    fill="#12203a" stroke={LIT} strokeWidth={1.5} />
              <text x={g2CX} y={g2CarryCY + 6} fill="#EAF0FA"
                    fontFamily="'JetBrains Mono', monospace" fontSize={16}
                    textAnchor="middle" fontWeight={700}>{slotCarry}</text>
              <text x={g2CX} y={g2CarryCY + 50} fill="#6C7A93"
                    fontFamily="'JetBrains Mono', monospace" fontSize={9}
                    textAnchor="middle" letterSpacing="0.12em">{labels.slot_carry}</text>

              {/* Input switches */}
              <g style={{ cursor: 'pointer' }} onClick={() => setA2((v) => (v === 0 ? 1 : 0))}>
                <circle cx={swAX} cy={swAY} r={16} fill={aHot ? LIT : '#12203a'} stroke={aHot ? LIT : WIRE} strokeWidth={1.5} />
                <text x={swAX} y={swAY + 5} fill={aHot ? '#0D1524' : '#EAF0FA'}
                      fontFamily="'JetBrains Mono', monospace" fontSize={14}
                      textAnchor="middle" fontWeight={700}>{a2}</text>
                <text x={swAX - 24} y={swAY + 5} fill="#6C7A93"
                      fontFamily="'JetBrains Mono', monospace" fontSize={12} textAnchor="end">A</text>
              </g>
              <g style={{ cursor: 'pointer' }} onClick={() => setB2((v) => (v === 0 ? 1 : 0))}>
                <circle cx={swBX} cy={swBY} r={16} fill={bHot ? LIT : '#12203a'} stroke={bHot ? LIT : WIRE} strokeWidth={1.5} />
                <text x={swBX} y={swBY + 5} fill={bHot ? '#0D1524' : '#EAF0FA'}
                      fontFamily="'JetBrains Mono', monospace" fontSize={14}
                      textAnchor="middle" fontWeight={700}>{b2}</text>
                <text x={swBX - 24} y={swBY + 5} fill="#6C7A93"
                      fontFamily="'JetBrains Mono', monospace" fontSize={12} textAnchor="end">B</text>
              </g>

              {/* LEDs */}
              {sOut === 1 && <circle cx={ledSumX} cy={ledSumY} r={22} fill={LIT} opacity={0.28} />}
              <circle cx={ledSumX} cy={ledSumY} r={12} fill={sOut === 1 ? LIT : DIM} stroke="#EAF0FA" strokeWidth={1.2} />
              <text x={ledSumX + 22} y={ledSumY + 5} fill="#6C7A93"
                    fontFamily="'JetBrains Mono', monospace" fontSize={12}>S</text>

              {cOut === 1 && <circle cx={ledCarryX} cy={ledCarryY} r={22} fill={LIT} opacity={0.28} />}
              <circle cx={ledCarryX} cy={ledCarryY} r={12} fill={cOut === 1 ? LIT : DIM} stroke="#EAF0FA" strokeWidth={1.2} />
              <text x={ledCarryX + 22} y={ledCarryY + 5} fill="#6C7A93"
                    fontFamily="'JetBrains Mono', monospace" fontSize={12}>C</text>
            </g>
          )
        })()}

        {/* ═══ Stage 3: black-box circuit ═══════════════════════════════ */}
        {isStage3 && (() => {
          const outVal = gateOut(currentTarget, a3, b3)
          const aHot = a3 === 1
          const bHot = b3 === 1
          const outHot = outVal === 1
          return (
            <g>
              {/* wires */}
              <line x1={swAX + 16} y1={swAY} x2={gateBoxCX - 60} y2={swAY} stroke={aHot ? LIT : WIRE} strokeWidth={aHot ? 2.2 : 1.6} />
              <line x1={gateBoxCX - 60} y1={swAY} x2={gateBoxCX - 60} y2={gateBoxCY - 20} stroke={aHot ? LIT : WIRE} strokeWidth={aHot ? 2.2 : 1.6} />
              <line x1={gateBoxCX - 60} y1={gateBoxCY - 20} x2={gateBoxCX - gateBoxW / 2} y2={gateBoxCY - 20} stroke={aHot ? LIT : WIRE} strokeWidth={aHot ? 2.2 : 1.6} />
              <line x1={swBX + 16} y1={swBY} x2={gateBoxCX - 60} y2={swBY} stroke={bHot ? LIT : WIRE} strokeWidth={bHot ? 2.2 : 1.6} />
              <line x1={gateBoxCX - 60} y1={swBY} x2={gateBoxCX - 60} y2={gateBoxCY + 20} stroke={bHot ? LIT : WIRE} strokeWidth={bHot ? 2.2 : 1.6} />
              <line x1={gateBoxCX - 60} y1={gateBoxCY + 20} x2={gateBoxCX - gateBoxW / 2} y2={gateBoxCY + 20} stroke={bHot ? LIT : WIRE} strokeWidth={bHot ? 2.2 : 1.6} />
              <line x1={gateBoxCX + gateBoxW / 2} y1={gateBoxCY} x2={ledX - 12} y2={ledY} stroke={outHot ? LIT : WIRE} strokeWidth={outHot ? 2.2 : 1.6} />

              {/* Black box (identity hidden) */}
              <rect x={gateBoxCX - gateBoxW / 2} y={gateBoxCY - gateBoxH / 2}
                    width={gateBoxW} height={gateBoxH} rx={8}
                    fill="#0D1524" stroke={WIRE} strokeWidth={1.5}
                    strokeDasharray="6 4" />
              <text x={gateBoxCX} y={gateBoxCY + 12} fill="#6C7A93"
                    fontFamily="'JetBrains Mono', monospace" fontSize={36}
                    textAnchor="middle" fontWeight={700}>?</text>

              {/* Input switches */}
              <g style={{ cursor: 'pointer' }} onClick={() => setA3((v) => (v === 0 ? 1 : 0))}>
                <circle cx={swAX} cy={swAY} r={16} fill={aHot ? LIT : '#12203a'} stroke={aHot ? LIT : WIRE} strokeWidth={1.5} />
                <text x={swAX} y={swAY + 5} fill={aHot ? '#0D1524' : '#EAF0FA'}
                      fontFamily="'JetBrains Mono', monospace" fontSize={14}
                      textAnchor="middle" fontWeight={700}>{a3}</text>
                <text x={swAX - 24} y={swAY + 5} fill="#6C7A93"
                      fontFamily="'JetBrains Mono', monospace" fontSize={12} textAnchor="end">A</text>
              </g>
              <g style={{ cursor: 'pointer' }} onClick={() => setB3((v) => (v === 0 ? 1 : 0))}>
                <circle cx={swBX} cy={swBY} r={16} fill={bHot ? LIT : '#12203a'} stroke={bHot ? LIT : WIRE} strokeWidth={1.5} />
                <text x={swBX} y={swBY + 5} fill={bHot ? '#0D1524' : '#EAF0FA'}
                      fontFamily="'JetBrains Mono', monospace" fontSize={14}
                      textAnchor="middle" fontWeight={700}>{b3}</text>
                <text x={swBX - 24} y={swBY + 5} fill="#6C7A93"
                      fontFamily="'JetBrains Mono', monospace" fontSize={12} textAnchor="end">B</text>
              </g>

              {/* Output LED */}
              {outHot && <circle cx={ledX} cy={ledY} r={22} fill={LIT} opacity={0.28} />}
              <circle cx={ledX} cy={ledY} r={12} fill={outHot ? LIT : DIM} stroke="#EAF0FA" strokeWidth={1.2} />
              <text x={ledX + 22} y={ledY + 5} fill="#6C7A93"
                    fontFamily="'JetBrains Mono', monospace" fontSize={12}>S</text>
            </g>
          )
        })()}

        {/* ═══ Truth table ═══════════════════════════════════════════════ */}
        {isStage1 && (() => {
          const cols = ['A', 'B', labels.output_s]
          const colW = 60
          return (
            <g fontFamily="'JetBrains Mono', monospace">
              {cols.map((c, i) => (
                <text key={i} x={tblX + i * colW + colW / 2} y={tblY}
                      fill="#6C7A93" fontSize={12} textAnchor="middle">{c}</text>
              ))}
              <line x1={tblX} y1={tblY + 8}
                    x2={tblX + cols.length * colW} y2={tblY + 8}
                    stroke="#3A4863" strokeWidth={1} />
              {INPUT_ROWS.map(([a, b], i) => {
                const k = rowKey(a, b)
                const visited = filled1[gate1].has(k)
                const outVal = gateOut(gate1, a, b)
                const highlight = a1 === a && b1 === b
                const yy = tblY + 30 + i * rowH
                return (
                  <g key={i}>
                    {highlight && (
                      <rect x={tblX - 4} y={yy - 22}
                            width={cols.length * colW + 8} height={30}
                            fill={LIT} opacity={0.1} rx={4} />
                    )}
                    <text x={tblX + colW / 2} y={yy} fill="#EAF0FA" fontSize={14} textAnchor="middle">{a}</text>
                    <text x={tblX + colW * 1.5} y={yy} fill="#EAF0FA" fontSize={14} textAnchor="middle">{b}</text>
                    <text x={tblX + colW * 2.5} y={yy}
                          fill={visited ? LIT : DIM} fontSize={14}
                          textAnchor="middle" fontWeight={600}>
                      {visited ? outVal : '·'}
                    </text>
                  </g>
                )
              })}
            </g>
          )
        })()}

        {isStage2 && (() => {
          const cols = ['A', 'B', 'St', 'Sy', 'Ct', 'Cy']
          const cw = (PLOT_W - 24) / cols.length
          return (
            <g fontFamily="'JetBrains Mono', monospace">
              {cols.map((c, i) => (
                <text key={i} x={tblX + i * cw + cw / 2} y={tblY}
                      fill="#6C7A93" fontSize={11} textAnchor="middle">{c}</text>
              ))}
              <line x1={tblX} y1={tblY + 8}
                    x2={tblX + cols.length * cw} y2={tblY + 8}
                    stroke="#3A4863" strokeWidth={1} />
              {INPUT_ROWS.map(([a, b], i) => {
                const sT = gateOut(TARGET_SUM, a, b)
                const sY = gateOut(slotSum, a, b)
                const cT = gateOut(TARGET_CARRY, a, b)
                const cY = gateOut(slotCarry, a, b)
                const sOk = sT === sY
                const cOk = cT === cY
                const yy = tblY + 30 + i * rowH
                const highlight = a2 === a && b2 === b
                return (
                  <g key={i}>
                    {highlight && (
                      <rect x={tblX - 4} y={yy - 22}
                            width={cols.length * cw + 8} height={30}
                            fill={LIT} opacity={0.1} rx={4} />
                    )}
                    <text x={tblX + cw / 2} y={yy} fill="#EAF0FA" fontSize={13} textAnchor="middle">{a}</text>
                    <text x={tblX + cw * 1.5} y={yy} fill="#EAF0FA" fontSize={13} textAnchor="middle">{b}</text>
                    <text x={tblX + cw * 2.5} y={yy} fill={TARGET_ORANGE} fontSize={13} textAnchor="middle">{sT}</text>
                    <text x={tblX + cw * 3.5} y={yy}
                          fill={sOk ? LIT : WRONG_RED} fontSize={13}
                          textAnchor="middle" fontWeight={600}>{sY}</text>
                    <text x={tblX + cw * 4.5} y={yy} fill={TARGET_ORANGE} fontSize={13} textAnchor="middle">{cT}</text>
                    <text x={tblX + cw * 5.5} y={yy}
                          fill={cOk ? LIT : WRONG_RED} fontSize={13}
                          textAnchor="middle" fontWeight={600}>{cY}</text>
                  </g>
                )
              })}
              {/* Legend */}
              <g transform={`translate(${PLOT_X + 10}, ${PLOT_Y + PLOT_H - 20})`}>
                <rect x={0} y={-8} width={10} height={10} fill={TARGET_ORANGE} />
                <text x={16} y={0} fill={TARGET_ORANGE} fontSize={10}>{labels.target}</text>
                <rect x={70} y={-8} width={10} height={10} fill={LIT} />
                <text x={86} y={0} fill={LIT} fontSize={10}>{labels.yours}</text>
              </g>
            </g>
          )
        })()}

        {isStage3 && (() => {
          const cols = ['A', 'B', labels.output_s]
          const colW = 60
          return (
            <g fontFamily="'JetBrains Mono', monospace">
              {cols.map((c, i) => (
                <text key={i} x={tblX + i * colW + colW / 2} y={tblY}
                      fill="#6C7A93" fontSize={12} textAnchor="middle">{c}</text>
              ))}
              <line x1={tblX} y1={tblY + 8}
                    x2={tblX + cols.length * colW} y2={tblY + 8}
                    stroke="#3A4863" strokeWidth={1} />
              {INPUT_ROWS.map(([a, b], i) => {
                const val = studentTable[i] ?? null
                const highlight = a3 === a && b3 === b
                const yy = tblY + 30 + i * rowH
                const correct = blindSubmitted
                  ? val === gateOut(currentTarget, a, b)
                  : null
                const cellStroke = blindSubmitted
                  ? (correct ? LIT : WRONG_RED)
                  : DIM
                const cellText = blindSubmitted
                  ? (correct ? LIT : WRONG_RED)
                  : (val === null ? DIM : '#EAF0FA')
                return (
                  <g key={i}>
                    {highlight && (
                      <rect x={tblX - 4} y={yy - 22}
                            width={cols.length * colW + 8} height={30}
                            fill={LIT} opacity={0.1} rx={4} />
                    )}
                    <text x={tblX + colW / 2} y={yy} fill="#EAF0FA" fontSize={14} textAnchor="middle">{a}</text>
                    <text x={tblX + colW * 1.5} y={yy} fill="#EAF0FA" fontSize={14} textAnchor="middle">{b}</text>
                    <g style={{ cursor: blindSubmitted ? 'default' : 'pointer' }}
                       onClick={() => handleCellClick(i)}>
                      <rect x={tblX + colW * 2 + 10} y={yy - 20}
                            width={colW - 20} height={28}
                            fill="#0D1524" stroke={cellStroke} strokeWidth={1.5} rx={4} />
                      <text x={tblX + colW * 2.5} y={yy}
                            fill={cellText} fontSize={14}
                            textAnchor="middle" fontWeight={700}>
                        {val === null ? '·' : val}
                      </text>
                    </g>
                  </g>
                )
              })}
            </g>
          )
        })()}
      </svg>

      {/* ─── HUD overlays (HTML, in rem) ─────────────────────────────── */}
      <div style={{
        position: 'absolute', top: '3rem', left: '3rem',
        fontFamily: "'JetBrains Mono', monospace", fontSize: '2.3rem',
        letterSpacing: '0.14em', textTransform: 'uppercase',
        color: '#6C7A93', zIndex: 5, pointerEvents: 'none',
      }}>
        {hudTL}
      </div>

      <div style={{
        position: 'absolute', top: '3rem', right: '3rem',
        fontFamily: "'JetBrains Mono', monospace", fontSize: '2.3rem',
        letterSpacing: '0.08em', color: LIT, zIndex: 5,
        pointerEvents: 'none', textAlign: 'right',
      }}>
        {hudTR}
      </div>

      <div style={{
        position: 'absolute', bottom: '3rem', left: '3rem',
        fontFamily: "'JetBrains Mono', monospace", fontSize: '2.3rem',
        letterSpacing: '0.06em', color: '#6C7A93', zIndex: 5,
        pointerEvents: 'none', maxWidth: '52%',
      }}>
        {hudBL}
      </div>

      {progressChip && (
        <div style={{
          position: 'absolute', top: '7.5rem', left: '3rem',
          fontFamily: "'JetBrains Mono', monospace", fontSize: '1.9rem',
          letterSpacing: '0.08em', color: LIT,
          zIndex: 5, pointerEvents: 'none',
        }}>
          {progressChip}
        </div>
      )}

      {/* ─── Stage 1: gate palette ───────────────────────────────────── */}
      {isStage1 && (
        <div style={{
          position: 'absolute', bottom: '4rem', left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex', gap: '1rem', zIndex: 10,
        }}>
          {GATE_TYPES.map((g) => {
            const isSel = gate1 === g
            const isFull = filled1[g].size === 4
            return (
              <button key={g} type="button" onClick={() => setGate1(g)}
                style={{
                  padding: '1rem 1.4rem',
                  background: isSel ? LIT : '#12203a',
                  color: isSel ? '#0D1524' : '#EAF0FA',
                  border: `1.5px solid ${isFull ? LIT : '#3A4863'}`,
                  borderRadius: '1rem',
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: '1.7rem', cursor: 'pointer', minWidth: '7rem',
                  fontWeight: 700, letterSpacing: '0.05em',
                }}>
                {g}
                <div style={{
                  fontSize: '1.1rem', opacity: 0.7, marginTop: '0.2rem',
                  fontWeight: 400,
                }}>
                  {filled1[g].size}/4
                </div>
              </button>
            )
          })}
        </div>
      )}

      {/* ─── Stage 2: two gate pickers ─────────────────────────────── */}
      {isStage2 && (
        <div style={{
          position: 'absolute', bottom: '3rem', left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex', gap: '2rem', zIndex: 10, alignItems: 'flex-end',
        }}>
          {(['sum', 'carry'] as const).map((slot) => {
            const val = slot === 'sum' ? slotSum : slotCarry
            const setter = slot === 'sum' ? setSlotSum : setSlotCarry
            const title = slot === 'sum' ? labels.slot_sum : labels.slot_carry
            return (
              <div key={slot} style={{
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', gap: '0.5rem',
              }}>
                <div style={{
                  fontFamily: "'JetBrains Mono', monospace", fontSize: '1.3rem',
                  letterSpacing: '0.14em', color: '#6C7A93', textTransform: 'uppercase',
                }}>
                  {title}
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  {GATE_TYPES.map((g) => (
                    <button key={g} type="button" onClick={() => setter(g)}
                      style={{
                        padding: '0.8rem 1.1rem',
                        background: val === g ? LIT : '#12203a',
                        color: val === g ? '#0D1524' : '#EAF0FA',
                        border: '1.5px solid #3A4863', borderRadius: '0.8rem',
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: '1.4rem', cursor: 'pointer', fontWeight: 700,
                        minWidth: '5rem',
                      }}>
                      {g}
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ─── Stage 3: Submit button ─────────────────────────────────── */}
      {isStage3 && (
        <div style={{
          position: 'absolute', bottom: '4rem', left: '50%',
          transform: 'translateX(-50%)', zIndex: 10,
        }}>
          <button type="button" onClick={handleBlindSubmit}
            disabled={!stage3AllFilled || blindSubmitted}
            style={{
              padding: '1.2rem 3rem',
              background: blindSubmitted ? (blindCorrect ? LIT : WRONG_RED) : TARGET_ORANGE,
              color: blindSubmitted && blindCorrect ? '#0D1524' : '#EAF0FA',
              border: 'none', borderRadius: '1rem',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '1.9rem',
              cursor: (!stage3AllFilled || blindSubmitted) ? 'default' : 'pointer',
              opacity: (!stage3AllFilled || blindSubmitted) ? 0.55 : 1,
              fontWeight: 700, letterSpacing: '0.14em', minWidth: '18rem',
            }}>
            {blindSubmitted ? (blindCorrect ? labels.correct : labels.wrong) : labels.submit}
          </button>
        </div>
      )}
    </div>
  )
}
