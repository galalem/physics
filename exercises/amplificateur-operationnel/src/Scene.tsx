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

// Left panel: op-amp schematic
const SCH_X = 32
const SCH_Y = 60
const SCH_W = 360
const SCH_H = 350

// Right panel: scope
const PLOT_X = 412
const PLOT_Y = 60
const PLOT_W = 250
const PLOT_H = 350

// Op-amp physics
const V_SAT = 12 // supply rail, ±V (ideal saturation clamp)

// AC input
const AC_FREQ = 1 // Hz
const SCOPE_WINDOW_S = 2 // seconds visible

// Slider ranges
const VP_MIN = 1 // V
const VP_MAX = 6 // V
const VP_DEFAULT = 2 // V
const RATIO_MIN = 0.1
const RATIO_MAX = 5
const RATIO_DEFAULT = 1

// Scope voltage range (covers ±V_SAT + a small margin)
const SCOPE_V_MAX = V_SAT + 2

// Montages
type Montage = 'follower' | 'inv' | 'noninv'
const ALL_MONTAGES: Montage[] = ['follower', 'inv', 'noninv']

// Stage 2 seeded target list (rotating on seed)
type Stage2Target = { montage: Montage; gain: number; vP: number }
const STAGE2_TARGETS: Stage2Target[] = [
  { montage: 'inv', gain: -2, vP: 2 },
  { montage: 'noninv', gain: 3, vP: 1.5 },
  { montage: 'inv', gain: -1.5, vP: 3 },
]

// Stage 3 blind deck — ace-the-deck, wrong = restart
type BlindMontage = 'inv' | 'noninv'
type BlindScenario = { id: BlindMontage; gain: number; vP: number }
const BLIND_DECK: BlindScenario[] = [
  { id: 'inv', gain: -2, vP: 2 },
  { id: 'noninv', gain: 3, vP: 1.5 },
]

const dict = { en } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── Pure physics helpers ───────────────────────────────────────────────
function opampGain(montage: Montage, ratio: number): number {
  if (montage === 'follower') return 1
  if (montage === 'inv') return -ratio
  return 1 + ratio
}

function opampOut(vIn: number, montage: Montage, ratio: number): number {
  const linear = opampGain(montage, ratio) * vIn
  if (linear > V_SAT) return V_SAT
  if (linear < -V_SAT) return -V_SAT
  return linear
}

// ─── Scope coord helpers ────────────────────────────────────────────────
function tToScopeX(t: number): number {
  return PLOT_X + (t / SCOPE_WINDOW_S) * PLOT_W
}
function vToScopeY(v: number): number {
  return PLOT_Y + PLOT_H / 2 - (v / SCOPE_V_MAX) * (PLOT_H / 2)
}

function buildScopeTrace(vP: number, fn: (v: number) => number): string {
  const steps = 220
  let d = ''
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * SCOPE_WINDOW_S
    const vin = vP * Math.sin(2 * Math.PI * AC_FREQ * t)
    const vout = fn(vin)
    const sx = tToScopeX(t)
    const sy = vToScopeY(vout)
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

  // Stage 2 target (seeded — one target per attempt)
  const stage2Target = useMemo<Stage2Target>(() => {
    return STAGE2_TARGETS[seed % STAGE2_TARGETS.length]!
  }, [seed])

  // Stage 3 deck (shuffled from seeded PRNG)
  const initialDeck = useMemo(() => rootRng.shuffle([...BLIND_DECK]), [rootRng])
  const [deck, setDeck] = useState<BlindScenario[]>(initialDeck)
  const [deckIdx, setDeckIdx] = useState(0)
  const currentBlind = deck[deckIdx % deck.length]!

  const stageIdx = useCurrentStage()
  const setStage = useSetStage()
  const progress = useProgress()
  const complete = useComplete()

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  // ─── Stage 1 + 2 shared state (montage picker + AC + ratio) ───────────
  const [montage, setMontage] = useState<Montage>('follower')
  const [vP, setVp] = useState(VP_DEFAULT)
  const [ratio, setRatio] = useState(RATIO_DEFAULT)

  // Stage 1 coverage
  const [montagesVisited, setMontagesVisited] = useState<Set<Montage>>(() => new Set(['follower']))
  const [sawClipping, setSawClipping] = useState(false)

  // Stage 2 solved sticky flag (once matched, don't require holding it)
  const [stage2Matched, setStage2Matched] = useState(false)

  // Scope animation clock
  const [scopeT, setScopeT] = useState(0)

  // Stage 3 state
  const [blindPick, setBlindPick] = useState<BlindMontage | null>(null)
  const [blindSubmitted, setBlindSubmitted] = useState(false)
  const [blindCorrect, setBlindCorrect] = useState(false)
  const [blindSolved, setBlindSolved] = useState(0)
  const [peekTip, setPeekTip] = useState<string | null>(null)
  const peekTipIdxRef = useRef(0)

  // Register montage visit + clipping detection during stage 1
  useEffect(() => {
    if (!isStage1) return
    setMontagesVisited((prev) => {
      if (prev.has(montage)) return prev
      const next = new Set(prev)
      next.add(montage)
      return next
    })
  }, [montage, isStage1])

  // Detect clipping over the AC cycle (linear |G|·V_p exceeds V_SAT)
  useEffect(() => {
    if (!isStage1) return
    const g = opampGain(montage, ratio)
    if (Math.abs(g * vP) > V_SAT) setSawClipping(true)
  }, [montage, ratio, vP, isStage1])

  // Stage 2: match target gain within 5% AND correct montage sign class
  const userGain = useMemo(() => opampGain(montage, ratio), [montage, ratio])
  const stage2Match = useMemo(() => {
    if (!isStage2) return false
    if (montage !== stage2Target.montage) return false
    const err = Math.abs(userGain - stage2Target.gain) / Math.abs(stage2Target.gain)
    return err <= 0.05
  }, [isStage2, montage, userGain, stage2Target])
  useEffect(() => {
    if (stage2Match) setStage2Matched(true)
  }, [stage2Match])

  useTicker((dt) => {
    if (!isStage1 && !isStage2 && !isStage3) return
    setScopeT((prev) => (prev + dt) % SCOPE_WINDOW_S)
  })

  const resetStageState = useCallback(() => {
    setMontage('follower')
    setVp(VP_DEFAULT)
    setRatio(RATIO_DEFAULT)
    setMontagesVisited(new Set(['follower']))
    setSawClipping(false)
    setStage2Matched(false)
    setScopeT(0)
    setBlindPick(null)
    setBlindSubmitted(false)
    setBlindCorrect(false)
    setBlindSolved(0)
    setDeck(rootRng.shuffle([...BLIND_DECK]))
    setDeckIdx(0)
    setPeekTip(null)
    peekTipIdxRef.current = 0
  }, [rootRng])

  useReset(resetStageState)

  // Advance predicates
  const stage1Done = montagesVisited.size >= 2 && sawClipping
  const stage2Done = stage2Matched
  const stage3Done = blindSolved >= BLIND_DECK.length

  const canSubmit = isStage1 ? stage1Done : isStage2 ? stage2Done : stage3Done

  useEffect(() => {
    progress(stageIdx / 3, { stage: stageIdx, canSubmit })
  }, [stageIdx, canSubmit, progress])

  useNext(() => {
    if (stageIdx < 3) {
      setStage(stageIdx + 1)
      // Preserve deck order (already seeded) across stage transitions.
      setMontage('follower')
      setVp(stageIdx === 1 ? stage2Target.vP : VP_DEFAULT)
      setRatio(RATIO_DEFAULT)
      setStage2Matched(false)
      setSawClipping(false)
      setBlindPick(null)
      setBlindSubmitted(false)
      setBlindCorrect(false)
      setScopeT(0)
    } else {
      complete({ success: true })
    }
  })

  // ─── Stage 3 submit — ace-the-deck ─────────────────────────────────────
  const handleBlindSubmit = useCallback(() => {
    if (!blindPick || blindSubmitted) return
    const correct = blindPick === currentBlind.id
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
        }, 1400)
      }
      // else: stay on the success frame; useNext advances via chrome
    } else {
      // Wrong — restart deck with a fresh shuffle
      setTimeout(() => {
        setDeck(rootRng.shuffle([...BLIND_DECK]))
        setDeckIdx(0)
        setBlindPick(null)
        setBlindSubmitted(false)
        setBlindCorrect(false)
        setBlindSolved(0)
      }, 1400)
    }
  }, [blindPick, blindSubmitted, blindSolved, currentBlind, rootRng])

  // ─── Peek (blind stage strategy hint — NEVER the answer) ──────────────
  const PEEK_TIPS = useMemo(
    () => [labels.peek_tip_1, labels.peek_tip_2],
    [labels],
  )
  usePeek(() => {
    if (!isStage3) return
    const tip = PEEK_TIPS[peekTipIdxRef.current % PEEK_TIPS.length]!
    setPeekTip(tip)
    peekTipIdxRef.current += 1
  })
  useEffect(() => {
    if (!peekTip) return
    const t = setTimeout(() => setPeekTip(null), 4000)
    return () => clearTimeout(t)
  }, [peekTip])

  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  // ─── Circuit anchors ───────────────────────────────────────────────────
  const opCx = SCH_X + SCH_W - 130 // op-amp triangle center-x
  const opCy = SCH_Y + SCH_H / 2 - 10
  const opW = 78
  const opH = 78
  const opInPlusY = opCy - 20
  const opInMinusY = opCy + 20
  const opInX = opCx - opW / 2
  const opOutX = opCx + opW / 2
  const outNodeX = opOutX + 60 // V_s node (right of op-amp)
  const inputSourceX = SCH_X + 30 // V_e source location
  const inputSourceY = SCH_Y + SCH_H - 60
  const gndY = SCH_Y + SCH_H - 30

  // Scope traces
  const vInScopePath = useMemo(() => buildScopeTrace(vP, (v) => v), [vP])
  const vOutStage1Path = useMemo(
    () => buildScopeTrace(vP, (v) => opampOut(v, montage, ratio)),
    [vP, montage, ratio],
  )
  const vOutStage2Path = vOutStage1Path
  const vInStage2Path = vInScopePath
  const targetStage2Path = useMemo(
    () => buildScopeTrace(stage2Target.vP, (v) => opampOut(v, stage2Target.montage, Math.abs(stage2Target.gain - (stage2Target.montage === 'noninv' ? 1 : 0)))),
    [stage2Target],
  )
  // For stage 2 target, gain is directly given; buildScopeTrace with a
  // custom mapper is simpler than back-computing a ratio:
  const targetStage2PathDirect = useMemo(
    () => buildScopeTrace(stage2Target.vP, (v) => {
      const linear = stage2Target.gain * v
      return Math.max(-V_SAT, Math.min(V_SAT, linear))
    }),
    [stage2Target],
  )
  // (Use the direct one; keep the fallback dead-code out of the render.)
  void targetStage2Path

  // Stage 3 target trace (from currentBlind)
  const blindInputPath = useMemo(
    () => buildScopeTrace(currentBlind.vP, (v) => v),
    [currentBlind],
  )
  const blindTargetPath = useMemo(
    () =>
      buildScopeTrace(currentBlind.vP, (v) => {
        const linear = currentBlind.gain * v
        return Math.max(-V_SAT, Math.min(V_SAT, linear))
      }),
    [currentBlind],
  )
  // Candidate trace only rendered post-submit
  const blindCandidatePath = useMemo(() => {
    if (!blindSubmitted || !blindPick) return ''
    // Show a canonical trace at |G|=2 for inv or |G|=3 for noninv so the
    // student sees WHY they were right/wrong (shape overlap or mismatch).
    const g = blindPick === 'inv' ? -2 : 3
    return buildScopeTrace(currentBlind.vP, (v) => {
      const linear = g * v
      return Math.max(-V_SAT, Math.min(V_SAT, linear))
    })
  }, [blindSubmitted, blindPick, currentBlind])

  const scopeMidY = PLOT_Y + PLOT_H / 2
  const railYPos = vToScopeY(V_SAT)
  const railYNeg = vToScopeY(-V_SAT)

  // ─── HUD text ──────────────────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`

  const activeColor = '#37C9B8'
  const wireStroke = '#54617A'
  const wireW = 1.6

  const hudTR = isStage1
    ? `${labels.gain_label} = ${formatGain(userGain)}`
    : isStage2
      ? `${labels.your_gain} = ${formatGain(userGain)} · ${labels.target_gain} = ${formatGain(stage2Target.gain)}`
      : `${labels.scenario}: ${Math.min(deckIdx + 1, BLIND_DECK.length)}/${BLIND_DECK.length} · ${blindSolved}/${BLIND_DECK.length} ${labels.solved}`

  const hudBL = isStage3 && peekTip
    ? peekTip
    : isStage1
      ? labels.tip1
      : isStage2
        ? labels.tip2
        : labels.tip3

  // Secondary progress chip (below TL). Never in BR — reserved.
  const progressChip = isStage1
    ? `${labels.montages_seen}: ${montagesVisited.size}/2 · ${sawClipping ? '✓' : '○'} ${labels.vsat_label}`
    : isStage2
      ? stage2Matched
        ? `✓ ${labels.target_matched}`
        : `${labels.adjust}`
      : null

  // ─── Render ────────────────────────────────────────────────────────────
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block', userSelect: 'none' }}
      >
        {/* NO borderRadius on <svg>. NO rx on the bg <rect>. */}
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

        {/* Op-amp triangle */}
        <polygon
          points={`${opInX},${opCy - opH / 2} ${opInX},${opCy + opH / 2} ${opOutX},${opCy}`}
          fill="none"
          stroke="#EAF0FA"
          strokeWidth={1.8}
        />
        {/* + and - marks inside triangle */}
        <text
          x={opInX + 12}
          y={opInPlusY + 4}
          fill="#EAF0FA"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={12}
          fontWeight="bold"
        >
          +
        </text>
        <text
          x={opInX + 12}
          y={opInMinusY + 4}
          fill="#EAF0FA"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={12}
          fontWeight="bold"
        >
          −
        </text>
        {/* Rails */}
        <text
          x={opCx}
          y={opCy - opH / 2 - 6}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={9}
          textAnchor="middle"
        >
          {labels.rail_pos}
        </text>
        <text
          x={opCx}
          y={opCy + opH / 2 + 14}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={9}
          textAnchor="middle"
        >
          {labels.rail_neg}
        </text>

        {/* Input pins */}
        <circle cx={opInX} cy={opInPlusY} r={2.5} fill="#EAF0FA" />
        <circle cx={opInX} cy={opInMinusY} r={2.5} fill="#EAF0FA" />
        {/* Output pin + node */}
        <line x1={opOutX} y1={opCy} x2={outNodeX} y2={opCy} stroke={wireStroke} strokeWidth={wireW} />
        <circle cx={outNodeX} cy={opCy} r={2.8} fill="#EAF0FA" />
        <text
          x={outNodeX + 6}
          y={opCy + 4}
          fill="#37C9B8"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={11}
        >
          {labels.op_out}
        </text>

        {/* Input source (V_e) — always drawn as AC circle at left */}
        <circle cx={inputSourceX} cy={inputSourceY} r={16} fill="none" stroke="#EAF0FA" strokeWidth={1.6} />
        <path
          d={`M ${inputSourceX - 10} ${inputSourceY} Q ${inputSourceX - 5} ${inputSourceY - 8}, ${inputSourceX} ${inputSourceY} T ${inputSourceX + 10} ${inputSourceY}`}
          fill="none"
          stroke="#EAF0FA"
          strokeWidth={1.4}
        />
        <text
          x={inputSourceX - 22}
          y={inputSourceY + 4}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={10}
          textAnchor="end"
        >
          {labels.input}
        </text>
        {/* Wire from source top to horizontal input rail */}
        <line
          x1={inputSourceX}
          y1={inputSourceY - 16}
          x2={inputSourceX}
          y2={SCH_Y + 40}
          stroke={wireStroke}
          strokeWidth={wireW}
        />
        {/* Ground rail */}
        <line
          x1={inputSourceX}
          y1={inputSourceY + 16}
          x2={inputSourceX}
          y2={gndY}
          stroke={wireStroke}
          strokeWidth={wireW}
        />
        <line
          x1={inputSourceX - 10}
          y1={gndY}
          x2={inputSourceX + 10}
          y2={gndY}
          stroke="#EAF0FA"
          strokeWidth={1.6}
        />
        <line
          x1={inputSourceX - 6}
          y1={gndY + 4}
          x2={inputSourceX + 6}
          y2={gndY + 4}
          stroke="#EAF0FA"
          strokeWidth={1.4}
        />
        <line
          x1={inputSourceX - 3}
          y1={gndY + 8}
          x2={inputSourceX + 3}
          y2={gndY + 8}
          stroke="#EAF0FA"
          strokeWidth={1.2}
        />

        {/* Montage-specific wiring (Stages 1 & 2). Stage 3 shows a
            neutral "hidden circuit" placeholder — the student must
            identify montage from the scope, not read it off the schematic. */}
        {(isStage1 || isStage2) &&
          renderMontageWiring(montage, {
            inputSourceX,
            opInX,
            opInPlusY,
            opInMinusY,
            outNodeX,
            opCy,
            gndY,
            ratio,
            labels,
            wireStroke,
            wireW,
          })}

        {isStage3 && (
          <>
            {/* Placeholder: wires enter/leave a hidden box between input
                and op-amp. Student cannot see the montage. */}
            <line
              x1={inputSourceX}
              y1={SCH_Y + 40}
              x2={opInX - 90}
              y2={SCH_Y + 40}
              stroke={wireStroke}
              strokeWidth={wireW}
            />
            <rect
              x={opInX - 90}
              y={opCy - 40}
              width={70}
              height={80}
              fill="#12203a"
              stroke="#3A4863"
              strokeWidth={1.5}
              strokeDasharray="5 4"
              rx={4}
            />
            <text
              x={opInX - 55}
              y={opCy + 4}
              fill="#6C7A93"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={11}
              textAnchor="middle"
            >
              ?
            </text>
            <line
              x1={opInX - 20}
              y1={opInPlusY}
              x2={opInX}
              y2={opInPlusY}
              stroke={wireStroke}
              strokeWidth={wireW}
            />
            <line
              x1={opInX - 20}
              y1={opInMinusY}
              x2={opInX}
              y2={opInMinusY}
              stroke={wireStroke}
              strokeWidth={wireW}
            />
          </>
        )}

        {/* ─── Right panel: scope ─────────────────────────────────────── */}
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
          {labels.scope}
        </text>

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
        {[-10, -5, 5, 10].map((v) => (
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

        {/* V_sat rails */}
        <line
          x1={PLOT_X}
          y1={railYPos}
          x2={PLOT_X + PLOT_W}
          y2={railYPos}
          stroke="#F9A968"
          strokeWidth={1}
          strokeDasharray="3 4"
          opacity={0.35}
        />
        <line
          x1={PLOT_X}
          y1={railYNeg}
          x2={PLOT_X + PLOT_W}
          y2={railYNeg}
          stroke="#F9A968"
          strokeWidth={1}
          strokeDasharray="3 4"
          opacity={0.35}
        />
        <text
          x={PLOT_X + PLOT_W - 4}
          y={railYPos - 3}
          fill="#F9A968"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={9}
          textAnchor="end"
        >
          +V_sat
        </text>
        <text
          x={PLOT_X + PLOT_W - 4}
          y={railYNeg + 10}
          fill="#F9A968"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={9}
          textAnchor="end"
        >
          -V_sat
        </text>

        {/* Zero axis */}
        <line
          x1={PLOT_X}
          y1={scopeMidY}
          x2={PLOT_X + PLOT_W}
          y2={scopeMidY}
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
          x={PLOT_X + PLOT_W - 4}
          y={scopeMidY - 4}
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
          V ↑
        </text>
        {[-10, -5, 5, 10].map((v) => (
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

        <clipPath id="scope-clip-aop">
          <rect x={PLOT_X} y={PLOT_Y} width={PLOT_W} height={PLOT_H} />
        </clipPath>
        <g clipPath="url(#scope-clip-aop)">
          {isStage1 && (
            <>
              <path
                d={vInScopePath}
                fill="none"
                stroke="#B9C4D6"
                strokeWidth={1.4}
                strokeDasharray="4 4"
                opacity={0.75}
              />
              <path d={vOutStage1Path} fill="none" stroke={activeColor} strokeWidth={2.2} />
            </>
          )}
          {isStage2 && (
            <>
              <path
                d={vInStage2Path}
                fill="none"
                stroke="#B9C4D6"
                strokeWidth={1.2}
                strokeDasharray="4 4"
                opacity={0.5}
              />
              <path
                d={targetStage2PathDirect}
                fill="none"
                stroke="#F97316"
                strokeWidth={2.2}
              />
              <path
                d={vOutStage2Path}
                fill="none"
                stroke={activeColor}
                strokeWidth={1.8}
                strokeDasharray="4 3"
                opacity={0.9}
              />
            </>
          )}
          {isStage3 && (
            <>
              <path
                d={blindInputPath}
                fill="none"
                stroke="#B9C4D6"
                strokeWidth={1.4}
                strokeDasharray="4 4"
                opacity={0.75}
              />
              <path d={blindTargetPath} fill="none" stroke="#F97316" strokeWidth={2.2} />
              {blindSubmitted && blindCandidatePath && (
                <path
                  d={blindCandidatePath}
                  fill="none"
                  stroke={blindCorrect ? activeColor : '#EF476F'}
                  strokeWidth={1.8}
                  strokeDasharray="4 3"
                  opacity={0.9}
                />
              )}
            </>
          )}
          {/* Sweep cursor */}
          {(isStage1 || isStage2) && (
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

        {/* Legend */}
        {isStage1 && (
          <g transform={`translate(${PLOT_X + 10}, ${PLOT_Y + PLOT_H - 24})`}>
            <line x1={0} y1={0} x2={16} y2={0} stroke="#B9C4D6" strokeWidth={1.4} strokeDasharray="4 4" />
            <text x={20} y={3} fill="#B9C4D6" fontFamily="'JetBrains Mono', monospace" fontSize={9}>
              V_e
            </text>
            <line x1={0} y1={14} x2={16} y2={14} stroke={activeColor} strokeWidth={2} />
            <text x={20} y={17} fill={activeColor} fontFamily="'JetBrains Mono', monospace" fontSize={9}>
              V_s
            </text>
          </g>
        )}
        {isStage2 && (
          <g transform={`translate(${PLOT_X + 10}, ${PLOT_Y + PLOT_H - 36})`}>
            <line x1={0} y1={0} x2={16} y2={0} stroke="#F97316" strokeWidth={2} />
            <text x={20} y={3} fill="#F97316" fontFamily="'JetBrains Mono', monospace" fontSize={9}>
              {labels.target}
            </text>
            <line x1={0} y1={12} x2={16} y2={12} stroke={activeColor} strokeWidth={1.8} strokeDasharray="4 3" />
            <text x={20} y={15} fill={activeColor} fontFamily="'JetBrains Mono', monospace" fontSize={9}>
              {labels.your_pick}
            </text>
            <line x1={0} y1={24} x2={16} y2={24} stroke="#B9C4D6" strokeWidth={1.2} strokeDasharray="4 4" />
            <text x={20} y={27} fill="#B9C4D6" fontFamily="'JetBrains Mono', monospace" fontSize={9}>
              V_e
            </text>
          </g>
        )}
        {isStage3 && (
          <g transform={`translate(${PLOT_X + 10}, ${PLOT_Y + PLOT_H - 36})`}>
            <line x1={0} y1={0} x2={16} y2={0} stroke="#F97316" strokeWidth={2} />
            <text x={20} y={3} fill="#F97316" fontFamily="'JetBrains Mono', monospace" fontSize={9}>
              {labels.target}
            </text>
            <line x1={0} y1={12} x2={16} y2={12} stroke="#B9C4D6" strokeWidth={1.2} strokeDasharray="4 4" />
            <text x={20} y={15} fill="#B9C4D6" fontFamily="'JetBrains Mono', monospace" fontSize={9}>
              V_e
            </text>
            {blindSubmitted && (
              <>
                <line
                  x1={0}
                  y1={24}
                  x2={16}
                  y2={24}
                  stroke={blindCorrect ? activeColor : '#EF476F'}
                  strokeWidth={1.8}
                  strokeDasharray="4 3"
                />
                <text
                  x={20}
                  y={27}
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
      </svg>

      {/* ─── HUD overlays (HTML, rem-sized) ─────────────────────────── */}
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
          fontSize: '2.2rem',
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
          color: '#6C7A93',
          zIndex: 5,
          pointerEvents: 'none',
          maxWidth: '55%',
        }}
      >
        {hudBL}
      </div>
      {/* NO bottom-right overlay — RESERVED for parent chrome. */}

      {/* Secondary progress chip below TL — never in BR. */}
      {progressChip && (
        <div
          style={{
            position: 'absolute',
            top: '7.5rem',
            left: '3rem',
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

      {/* ─── Stage 1 & 2 controls ─────────────────────────────────────── */}
      {(isStage1 || isStage2) && (
        <>
          {/* Montage picker (bottom-left cluster) */}
          <div
            style={{
              position: 'absolute',
              bottom: '10rem',
              left: '3rem',
              display: 'flex',
              flexDirection: 'row',
              gap: '1rem',
              zIndex: 6,
            }}
          >
            {ALL_MONTAGES.map((m) => {
              const active = montage === m
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMontage(m)}
                  style={{
                    padding: '0.9rem 1.4rem',
                    background: active ? '#37C9B8' : '#12203a',
                    color: active ? '#0D1524' : '#EAF0FA',
                    border: `1.5px solid ${active ? '#37C9B8' : '#3A4863'}`,
                    borderRadius: '0.8rem',
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: '1.6rem',
                    cursor: 'pointer',
                    minWidth: '9rem',
                  }}
                >
                  {m === 'follower'
                    ? labels.montage_follower
                    : m === 'inv'
                      ? labels.montage_inv
                      : labels.montage_noninv}
                </button>
              )
            })}
          </div>

          {/* V_p slider (right side) */}
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
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.5rem', color: '#6C7A93' }}>
              {VP_MAX}
            </div>
            <div
              style={{
                width: '2rem',
                height: '22rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <input
                type="range"
                min={VP_MIN * 100}
                max={VP_MAX * 100}
                step={5}
                value={Math.round(vP * 100)}
                onChange={(e) => setVp(Number(e.target.value) / 100)}
                style={{
                  width: '22rem',
                  height: '2rem',
                  transform: 'rotate(-90deg)',
                  transformOrigin: 'center',
                  accentColor: activeColor,
                  cursor: 'pointer',
                }}
              />
            </div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.5rem', color: '#6C7A93' }}>
              {VP_MIN}
            </div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.5rem', color: activeColor }}>
              V_p = {vP.toFixed(2)} V
            </div>
          </div>

          {/* R2/R1 slider (bottom-left row, above montage picker, only when not a follower).
              NOTE: intentionally uses bottom + left (NOT right) to keep the BR quadrant empty. */}
          {montage !== 'follower' && (
            <div
              style={{
                position: 'absolute',
                bottom: '15rem',
                left: '3rem',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                gap: '0.4rem',
                zIndex: 6,
                pointerEvents: 'auto',
              }}
            >
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.5rem', color: '#6C7A93' }}>
                {labels.ratio_label} = {ratio.toFixed(2)}
              </div>
              <input
                type="range"
                min={RATIO_MIN * 100}
                max={RATIO_MAX * 100}
                step={5}
                value={Math.round(ratio * 100)}
                onChange={(e) => setRatio(Number(e.target.value) / 100)}
                style={{
                  width: '20rem',
                  height: '2rem',
                  accentColor: activeColor,
                  cursor: 'pointer',
                }}
              />
            </div>
          )}
        </>
      )}

      {/* ─── Stage 3: montage-pick buttons + Submit ─────────────────── */}
      {isStage3 && (
        <>
          <div
            style={{
              position: 'absolute',
              bottom: '11rem',
              left: '50%',
              transform: 'translateX(-50%)',
              display: 'flex',
              gap: '2rem',
              zIndex: 10,
            }}
          >
            {(['inv', 'noninv'] as BlindMontage[]).map((m) => {
              const active = blindPick === m
              // §4.7: no correctness color pre-submit. Background stays
              // constant until Submit. Selection is signalled only by a
              // neutral (non-teal, non-red) border so the student can see
              // which button they clicked without any hint of right/wrong.
              const bg =
                blindSubmitted && active
                  ? blindCorrect
                    ? '#37C9B8'
                    : '#EF476F'
                  : '#12203a'
              const border =
                blindSubmitted && active
                  ? blindCorrect
                    ? '#37C9B8'
                    : '#EF476F'
                  : active
                    ? '#B9C4D6'
                    : '#3A4863'
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    if (blindSubmitted) return
                    setBlindPick(m)
                  }}
                  disabled={blindSubmitted}
                  style={{
                    padding: '1.2rem 2rem',
                    background: bg,
                    color: '#EAF0FA',
                    border: `1.5px solid ${border}`,
                    borderRadius: '1rem',
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: '1.7rem',
                    cursor: blindSubmitted ? 'default' : 'pointer',
                    minWidth: '14rem',
                  }}
                >
                  {m === 'inv' ? labels.montage_inv : labels.montage_noninv}
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
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                cursor: !blindPick || blindSubmitted ? 'default' : 'pointer',
                opacity: !blindPick || blindSubmitted ? 0.55 : 1,
                fontWeight: 700,
              }}
            >
              {blindSubmitted
                ? blindCorrect
                  ? '✓ ' + labels.correct
                  : '✗ ' + labels.wrong
                : labels.submit}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ─── Format helpers ─────────────────────────────────────────────────────
function formatGain(g: number): string {
  const sign = g >= 0 ? '+' : '−'
  const mag = Math.abs(g)
  return `${sign}${mag.toFixed(2)}`
}

// ─── Montage-specific SVG wiring ────────────────────────────────────────
type WiringCtx = {
  inputSourceX: number
  opInX: number
  opInPlusY: number
  opInMinusY: number
  outNodeX: number
  opCy: number
  gndY: number
  ratio: number
  labels: ReturnType<typeof svgLabels>
  wireStroke: string
  wireW: number
}

function renderMontageWiring(montage: Montage, ctx: WiringCtx) {
  const { inputSourceX, opInX, opInPlusY, opInMinusY, outNodeX, opCy, gndY, ratio, labels, wireStroke, wireW } = ctx
  const railTopY = opInPlusY - 40
  const invNodeX = opInX - 40 // summing node for inverting montage
  const gndTie = opInMinusY // for follower / non-inv, V- connects here

  if (montage === 'follower') {
    // V_e → V+; V- shorted to V_s (output)
    return (
      <g key="wiring-follower">
        {/* V_e → V+ */}
        <line
          x1={inputSourceX}
          y1={railTopY}
          x2={opInX - 20}
          y2={railTopY}
          stroke={wireStroke}
          strokeWidth={wireW}
        />
        <line
          x1={opInX - 20}
          y1={railTopY}
          x2={opInX - 20}
          y2={opInPlusY}
          stroke={wireStroke}
          strokeWidth={wireW}
        />
        <line
          x1={opInX - 20}
          y1={opInPlusY}
          x2={opInX}
          y2={opInPlusY}
          stroke={wireStroke}
          strokeWidth={wireW}
        />
        {/* V- → V_s (feedback short) */}
        <line
          x1={opInX}
          y1={opInMinusY}
          x2={opInX - 12}
          y2={opInMinusY}
          stroke={wireStroke}
          strokeWidth={wireW}
        />
        <line
          x1={opInX - 12}
          y1={opInMinusY}
          x2={opInX - 12}
          y2={opCy + 55}
          stroke={wireStroke}
          strokeWidth={wireW}
        />
        <line
          x1={opInX - 12}
          y1={opCy + 55}
          x2={outNodeX}
          y2={opCy + 55}
          stroke={wireStroke}
          strokeWidth={wireW}
        />
        <line
          x1={outNodeX}
          y1={opCy + 55}
          x2={outNodeX}
          y2={opCy}
          stroke={wireStroke}
          strokeWidth={wireW}
        />
      </g>
    )
  }

  if (montage === 'inv') {
    // V_e → R1 → V-, V+ → GND, R2 from V- to V_s
    const r1x1 = inputSourceX + 20
    const r1x2 = invNodeX - 4
    return (
      <g key="wiring-inv">
        {/* input rail to R1 */}
        <line
          x1={inputSourceX}
          y1={railTopY}
          x2={r1x1}
          y2={railTopY}
          stroke={wireStroke}
          strokeWidth={wireW}
        />
        {/* R1 zigzag */}
        {renderResistor(r1x1, r1x2, railTopY, '#EAF0FA', 'R1')}
        <line
          x1={r1x2}
          y1={railTopY}
          x2={invNodeX}
          y2={railTopY}
          stroke={wireStroke}
          strokeWidth={wireW}
        />
        {/* down to V- */}
        <line
          x1={invNodeX}
          y1={railTopY}
          x2={invNodeX}
          y2={opInMinusY}
          stroke={wireStroke}
          strokeWidth={wireW}
        />
        <line
          x1={invNodeX}
          y1={opInMinusY}
          x2={opInX}
          y2={opInMinusY}
          stroke={wireStroke}
          strokeWidth={wireW}
        />
        <circle cx={invNodeX} cy={opInMinusY} r={2.5} fill="#EAF0FA" />
        {/* V+ to GND */}
        <line
          x1={opInX}
          y1={opInPlusY}
          x2={opInX - 12}
          y2={opInPlusY}
          stroke={wireStroke}
          strokeWidth={wireW}
        />
        <line
          x1={opInX - 12}
          y1={opInPlusY}
          x2={opInX - 12}
          y2={gndY - 6}
          stroke={wireStroke}
          strokeWidth={wireW}
        />
        <line
          x1={opInX - 20}
          y1={gndY - 6}
          x2={opInX - 4}
          y2={gndY - 6}
          stroke="#EAF0FA"
          strokeWidth={1.6}
        />
        <line
          x1={opInX - 17}
          y1={gndY - 3}
          x2={opInX - 7}
          y2={gndY - 3}
          stroke="#EAF0FA"
          strokeWidth={1.2}
        />
        {/* R2 feedback: V- (top branch) → V_s */}
        <line
          x1={invNodeX}
          y1={railTopY - 40}
          x2={invNodeX}
          y2={railTopY}
          stroke={wireStroke}
          strokeWidth={wireW}
        />
        {renderResistor(invNodeX, invNodeX + 60, railTopY - 40, '#EAF0FA', `R2 (${ratio.toFixed(2)}·R1)`)}
        <line
          x1={invNodeX + 60}
          y1={railTopY - 40}
          x2={outNodeX}
          y2={railTopY - 40}
          stroke={wireStroke}
          strokeWidth={wireW}
        />
        <line
          x1={outNodeX}
          y1={railTopY - 40}
          x2={outNodeX}
          y2={opCy}
          stroke={wireStroke}
          strokeWidth={wireW}
        />
        <text
          x={opInX + 4}
          y={opInMinusY + 16}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={9}
        >
          {labels.op_minus}
        </text>
      </g>
    )
  }

  // Non-inverting: V_e → V+; V- → R1 → GND; R2 feedback V_s → V-
  const r1y1 = gndTie + 30
  const r1y2 = gndY - 10
  return (
    <g key="wiring-noninv">
      {/* V_e straight into V+ */}
      <line
        x1={inputSourceX}
        y1={railTopY}
        x2={opInX - 20}
        y2={railTopY}
        stroke={wireStroke}
        strokeWidth={wireW}
      />
      <line
        x1={opInX - 20}
        y1={railTopY}
        x2={opInX - 20}
        y2={opInPlusY}
        stroke={wireStroke}
        strokeWidth={wireW}
      />
      <line
        x1={opInX - 20}
        y1={opInPlusY}
        x2={opInX}
        y2={opInPlusY}
        stroke={wireStroke}
        strokeWidth={wireW}
      />
      {/* V- node */}
      <line
        x1={opInX}
        y1={opInMinusY}
        x2={opInX - 14}
        y2={opInMinusY}
        stroke={wireStroke}
        strokeWidth={wireW}
      />
      <circle cx={opInX - 14} cy={opInMinusY} r={2.5} fill="#EAF0FA" />
      {/* R1 from V- down to GND */}
      <line
        x1={opInX - 14}
        y1={opInMinusY}
        x2={opInX - 14}
        y2={r1y1}
        stroke={wireStroke}
        strokeWidth={wireW}
      />
      {renderResistorVertical(opInX - 14, r1y1, r1y2, '#EAF0FA', 'R1')}
      <line
        x1={opInX - 14}
        y1={r1y2}
        x2={opInX - 14}
        y2={gndY}
        stroke={wireStroke}
        strokeWidth={wireW}
      />
      <line
        x1={opInX - 22}
        y1={gndY}
        x2={opInX - 6}
        y2={gndY}
        stroke="#EAF0FA"
        strokeWidth={1.6}
      />
      <line
        x1={opInX - 19}
        y1={gndY + 3}
        x2={opInX - 9}
        y2={gndY + 3}
        stroke="#EAF0FA"
        strokeWidth={1.2}
      />
      {/* R2 feedback: V_s → V- via top rail */}
      <line
        x1={opInX - 14}
        y1={opInMinusY}
        x2={opInX - 14}
        y2={railTopY + 60}
        stroke={wireStroke}
        strokeWidth={wireW}
      />
      <line
        x1={opInX - 14}
        y1={railTopY + 60}
        x2={opInX + 40}
        y2={railTopY + 60}
        stroke={wireStroke}
        strokeWidth={wireW}
      />
      {renderResistor(opInX + 40, opInX + 100, railTopY + 60, '#EAF0FA', `R2 (${ratio.toFixed(2)}·R1)`)}
      <line
        x1={opInX + 100}
        y1={railTopY + 60}
        x2={outNodeX}
        y2={railTopY + 60}
        stroke={wireStroke}
        strokeWidth={wireW}
      />
      <line
        x1={outNodeX}
        y1={railTopY + 60}
        x2={outNodeX}
        y2={opCy}
        stroke={wireStroke}
        strokeWidth={wireW}
      />
    </g>
  )
}

function renderResistor(x1: number, x2: number, y: number, color: string, label: string) {
  const zw = x2 - x1
  const zh = 5
  const segs = 6
  const pts: [number, number][] = []
  for (let i = 0; i <= segs; i++) {
    const px = x1 + (i / segs) * zw
    const py = i === 0 || i === segs ? y : y + (i % 2 === 1 ? -zh : zh)
    pts.push([px, py])
  }
  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`).join(' ')
  return (
    <g>
      <path d={path} fill="none" stroke={color} strokeWidth={1.6} />
      <text
        x={(x1 + x2) / 2}
        y={y - 10}
        fill="#6C7A93"
        fontFamily="'JetBrains Mono', monospace"
        fontSize={9}
        textAnchor="middle"
      >
        {label}
      </text>
    </g>
  )
}

function renderResistorVertical(x: number, y1: number, y2: number, color: string, label: string) {
  const zh = y2 - y1
  const zw = 5
  const segs = 6
  const pts: [number, number][] = []
  for (let i = 0; i <= segs; i++) {
    const py = y1 + (i / segs) * zh
    const px = i === 0 || i === segs ? x : x + (i % 2 === 1 ? -zw : zw)
    pts.push([px, py])
  }
  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`).join(' ')
  return (
    <g>
      <path d={path} fill="none" stroke={color} strokeWidth={1.6} />
      <text
        x={x + 10}
        y={(y1 + y2) / 2 + 3}
        fill="#6C7A93"
        fontFamily="'JetBrains Mono', monospace"
        fontSize={9}
      >
        {label}
      </text>
    </g>
  )
}
