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
  useSetStage,
} from '@physics/sdk/react'
import { getHintFor, getStagesFor } from './stages'
import en from '../i18n/en.json'

// ─── Scene constants ────────────────────────────────────────────────────
const W = 800
const H = 450

// Load resistor is fixed at 100 Ω throughout the exercise.
const R_LOAD = 100

// Slider ranges (turns and primary voltage)
const N_MIN = 100
const N_MAX = 2000
const N_STEP = 50
const U1_MIN = 24
const U1_MAX = 240
const U1_STEP = 12

const TOL = 0.05 // ±5 % tolerance for target-hit checks

// ─── Ideal transformer physics ─────────────────────────────────────────
// m = N₂/N₁, U₂ = m·U₁, I₂ = U₂/R, I₁ = m·I₂
// Test vector: N1=1000, N2=500, U1=220 → m=0.5, U2=110 V,
//              I2 = 110/100 = 1.1 A, I1 = 0.5*1.1 = 0.55 A.
function computeReadings(N1: number, N2: number, U1: number, R: number) {
  const m = N2 / N1
  const U2 = m * U1
  const I2 = R > 0 ? U2 / R : 0
  const I1 = m * I2
  return { m, U2, I2, I1 }
}

// ─── Stage-2 target sets (hand-authored, seed-picked) ──────────────────
// Each set fixes U₁ and N₁; student adjusts N₂ to reach each targetU₂.
type Stage2Set = { U1: number; N1: number; targets: number[] }
const STAGE2_SETS: Stage2Set[] = [
  { U1: 220, N1: 1000, targets: [110, 440, 22] },   // N₂ = 500, 2000, 100
  { U1: 120, N1: 1000, targets: [60, 240, 24] },    // N₂ = 500, 2000, 200
  { U1: 110, N1: 500,  targets: [220, 55, 440] },   // N₂ = 1000, 250, 2000
]

// ─── Stage-3 blind decks (hand-authored, seed-picked) ──────────────────
// Ace-the-deck: student must clear 3 scenarios in a row; 3 attempts each.
type Stage3Scenario = { U1: number; N1: number; targetU2: number; correctN2: number }
const STAGE3_DECKS: Stage3Scenario[][] = [
  [
    { U1: 220, N1: 1000, targetU2: 55,  correctN2: 250 },
    { U1: 110, N1: 200,  targetU2: 550, correctN2: 1000 },
    { U1: 48,  N1: 400,  targetU2: 12,  correctN2: 100 },
  ],
  [
    { U1: 120, N1: 500,  targetU2: 60,  correctN2: 250 },
    { U1: 220, N1: 800,  targetU2: 110, correctN2: 400 },
    { U1: 24,  N1: 100,  targetU2: 240, correctN2: 1000 },
  ],
  [
    { U1: 110, N1: 1000, targetU2: 22,  correctN2: 200 },
    { U1: 48,  N1: 200,  targetU2: 240, correctN2: 1000 },
    { U1: 220, N1: 2000, targetU2: 55,  correctN2: 500 },
  ],
]

// ─── Label loader ──────────────────────────────────────────────────────
const dict = { en } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── Formatting helpers ───────────────────────────────────────────────
function fmtV(v: number): string {
  if (!isFinite(v)) return '—'
  if (Math.abs(v) >= 100) return v.toFixed(0)
  if (Math.abs(v) >= 10) return v.toFixed(1)
  return v.toFixed(2)
}
function fmtI_mA(i_amps: number): string {
  const mA = i_amps * 1000
  if (!isFinite(mA)) return '—'
  if (Math.abs(mA) >= 1000) return (mA / 1000).toFixed(2) + ' A'
  if (Math.abs(mA) >= 100) return mA.toFixed(0) + ' mA'
  if (Math.abs(mA) >= 10) return mA.toFixed(1) + ' mA'
  return mA.toFixed(2) + ' mA'
}
function fmtRatio(m: number): string {
  if (!isFinite(m)) return '—'
  if (m >= 100) return m.toFixed(0)
  if (m >= 10) return m.toFixed(1)
  return m.toFixed(3)
}

// SVG → rem helper for HTML overlays that must stay glued to viewBox regions.
// Container is aspect-ratio 16:9 and :root font-size = 1 vh, so 1 SVG y-unit
// = (100 vh / 450) ≈ 0.2222 rem, and x units scale identically (16:9 meet).
function svgToRem(v: number): string {
  return `${(v * 100) / 450}rem`
}

// ─── Component ─────────────────────────────────────────────────────────
export default function Scene() {
  const { locale, seed } = useInit()
  const stages = useMemo(() => getStagesFor(locale), [locale])
  useDeclareStages(stages)
  const labels = useMemo(() => svgLabels(locale), [locale])

  const stageIdx = useCurrentStage()
  const setStage = useSetStage()
  const progress = useProgress()
  const complete = useComplete()

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  // Seed-picked hand-authored content
  const stage2Set = useMemo(() => STAGE2_SETS[seed % STAGE2_SETS.length]!, [seed])
  const stage3Deck = useMemo(() => STAGE3_DECKS[seed % STAGE3_DECKS.length]!, [seed])

  // ─── Adjustable state ─────────────────────────────────────────
  const [N1, setN1] = useState<number>(1000)
  const [N2, setN2] = useState<number>(500)
  const [U1, setU1] = useState<number>(120)

  // ─── Stage-1 coverage flags ───────────────────────────────────
  const [sawStepUp, setSawStepUp] = useState(false)
  const [sawStepDown, setSawStepDown] = useState(false)
  const [u1SeenCount, setU1SeenCount] = useState(1) // distinct U1 values touched
  const [u1SeenInit] = useState(() => new Set<number>())

  // ─── Stage-2 target tracking ──────────────────────────────────
  const [targetsHit, setTargetsHit] = useState<boolean[]>([false, false, false])

  // ─── Stage-3 blind state ──────────────────────────────────────
  const [scenarioIdx, setScenarioIdx] = useState(0)
  const [attemptsLeft, setAttemptsLeft] = useState(3)
  const [inputText, setInputText] = useState('')
  const [feedback, setFeedback] = useState<null | 'correct' | 'wrong' | 'resetting'>(null)
  const [showResult, setShowResult] = useState(false) // reveal U2/I2 on correct submit
  const [peekVisible, setPeekVisible] = useState(false)

  const readings = computeReadings(N1, N2, U1, R_LOAD)
  const { m, U2, I1, I2 } = readings

  // ─── Stage-2 init: lock U1/N1 to the chosen set on entering stage 2 ─
  useEffect(() => {
    if (!isStage2) return
    // Snap to the set the first time stage 2 is entered / after reset.
    if (U1 !== stage2Set.U1 || N1 !== stage2Set.N1) {
      setU1(stage2Set.U1)
      setN1(stage2Set.N1)
    }
  }, [isStage2, stage2Set, U1, N1])

  // ─── Stage-3 init: lock U1/N1 to the current scenario ────────
  const currentScenario = stage3Deck[scenarioIdx] ?? stage3Deck[0]!
  useEffect(() => {
    if (!isStage3) return
    if (U1 !== currentScenario.U1 || N1 !== currentScenario.N1) {
      setU1(currentScenario.U1)
      setN1(currentScenario.N1)
    }
  }, [isStage3, currentScenario, U1, N1])

  // ─── Stage-1 coverage: track step-up / step-down / U1 sweep ──
  useEffect(() => {
    if (!isStage1) return
    if (m > 1 && !sawStepUp) setSawStepUp(true)
    if (m < 1 && !sawStepDown) setSawStepDown(true)
  }, [isStage1, m, sawStepUp, sawStepDown])

  // ─── Stage-2 target hits (persistent) ────────────────────────
  useEffect(() => {
    if (!isStage2) return
    setTargetsHit((prev) => {
      let changed = false
      const next = prev.slice()
      stage2Set.targets.forEach((t, i) => {
        if (!prev[i] && Math.abs(U2 - t) / t < TOL) {
          next[i] = true
          changed = true
        }
      })
      return changed ? next : prev
    })
  }, [isStage2, U2, stage2Set.targets])

  const stage1Done = sawStepUp && sawStepDown && u1SeenCount >= 2
  const stage2Done = targetsHit.every(Boolean)
  const aceCount = scenarioIdx // scenarios cleared so far
  const stage3Done = isStage3 && aceCount >= stage3Deck.length

  const canSubmit = isStage1 ? stage1Done : isStage2 ? stage2Done : stage3Done

  // ─── Reset (per stage or from chrome) ────────────────────────
  const resetStageState = useCallback(() => {
    setN1(1000)
    setN2(500)
    setU1(120)
    setSawStepUp(false)
    setSawStepDown(false)
    setU1SeenCount(1)
    u1SeenInit.clear()
    setTargetsHit([false, false, false])
    setScenarioIdx(0)
    setAttemptsLeft(3)
    setInputText('')
    setFeedback(null)
    setShowResult(false)
    setPeekVisible(false)
  }, [u1SeenInit])
  useReset(resetStageState)

  // ─── Progress ─────────────────────────────────────────────────
  useEffect(() => {
    progress(stageIdx / stages.length, { stage: stageIdx, canSubmit })
  }, [stageIdx, canSubmit, stages.length, progress])

  // ─── Next handler ────────────────────────────────────────────
  useNext(() => {
    if (stageIdx < stages.length) {
      setStage(stageIdx + 1)
      resetStageState()
    } else {
      complete({ success: true })
    }
  })

  // ─── Peek (strategy hint — text only, never reveals the answer) ─
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

  // ─── U1 sweep tracker (wraps setU1) ──────────────────────────
  const updateU1 = useCallback((v: number) => {
    setU1(v)
    if (!u1SeenInit.has(v)) {
      u1SeenInit.add(v)
      setU1SeenCount(u1SeenInit.size)
    }
  }, [u1SeenInit])

  // ─── Stage-3 submit ──────────────────────────────────────────
  const submitStage3 = useCallback(() => {
    if (!isStage3 || feedback === 'resetting') return
    const parsed = Number(inputText.trim())
    if (!isFinite(parsed) || parsed <= 0) return
    // Enforce integer turn counts silently — round to nearest integer.
    const guess = Math.round(parsed)
    const correct = Math.abs(guess - currentScenario.correctN2) / currentScenario.correctN2 < TOL
    if (correct) {
      // Set N2 to the guessed value so on-scene readouts reflect success post-submit.
      setN2(guess)
      setFeedback('correct')
      setShowResult(true)
      // Advance to next scenario after a beat.
      setTimeout(() => {
        setScenarioIdx((i) => i + 1)
        setAttemptsLeft(3)
        setInputText('')
        setFeedback(null)
        setShowResult(false)
      }, 1400)
    } else {
      setFeedback('wrong')
      setAttemptsLeft((n) => {
        const next = n - 1
        if (next <= 0) {
          // Budget exhausted → reset deck (ace-the-deck: no misses tolerated).
          setFeedback('resetting')
          setTimeout(() => {
            setScenarioIdx(0)
            setAttemptsLeft(3)
            setInputText('')
            setFeedback(null)
          }, 1600)
        } else {
          setTimeout(() => {
            setInputText('')
            setFeedback(null)
          }, 900)
        }
        return next
      })
    }
  }, [isStage3, inputText, currentScenario, feedback])

  // ─── HUD text ─────────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`

  const check = (b: boolean) => (b ? '✓' : '·')
  const hudTR = isStage1
    ? `${check(sawStepUp)} ${labels.sawStepUp_label}   ${check(sawStepDown)} ${labels.sawStepDown_label}   ${check(u1SeenCount >= 2)} ${labels.sawU1_label}`
    : isStage2
      ? `${labels.targets}: ${targetsHit.filter(Boolean).length}/${stage2Set.targets.length}`
      : `${labels.scenario} ${scenarioIdx + 1}/${stage3Deck.length}   ${labels.attempts_left}: ${attemptsLeft}`

  const hudBL = isStage3
    ? (peekVisible ? labels.peek_tip : labels.tip3)
    : isStage2
      ? labels.tip2
      : labels.tip1

  // ─── Schematic geometry ──────────────────────────────────────
  // Primary loop: 80 ≤ x ≤ 270, 100 ≤ y ≤ 200
  // Iron core: two bars at x=286..294 and x=316..324, y=70..230
  // Secondary loop: 340 ≤ x ≤ 540, 100 ≤ y ≤ 200
  const P_L = 80, P_R = 270, P_T = 100, P_B = 200
  const S_L = 340, S_R = 540, S_T = 100, S_B = 200

  // Live-readout visibility rules (§4.7)
  const showU2 = !isStage3 || showResult
  const showI2 = !isStage3 || showResult
  const showI1 = !isStage3 || showResult
  const showRatioStrip = !isStage3

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block', userSelect: 'none' }}
      >
        {/* NO borderRadius on <svg>. NO rx on the bg <rect>. */}
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        {/* Schematic panel (top-left) */}
        <rect x={32} y={60} width={560} height={200} fill="none" stroke="#12203a" strokeWidth={1} rx={6} />
        <text x={40} y={52} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={11} letterSpacing="0.1em">
          {labels.schematic}
        </text>

        {/* Oscilloscope panel (bottom-left) */}
        <rect x={32} y={274} width={560} height={144} fill="none" stroke="#12203a" strokeWidth={1} rx={6} />
        <text x={40} y={266} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={11} letterSpacing="0.1em">
          {labels.scope}
        </text>

        {/* Controls panel (right) */}
        <rect x={608} y={60} width={160} height={358} fill="none" stroke="#12203a" strokeWidth={1} rx={6} />
        <text x={616} y={52} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={11} letterSpacing="0.1em">
          {labels.controls}
        </text>

        {/* ─── Primary side ─── */}
        <g>
          {/* Rectangular loop wires (with breaks at component slots) */}
          {/* Top rail (broken around A1 ammeter at x=175, r≈14) */}
          <line x1={P_L} y1={P_T} x2={161} y2={P_T} stroke="#54617A" strokeWidth={2} />
          <line x1={189} y1={P_T} x2={P_R} y2={P_T} stroke="#54617A" strokeWidth={2} />
          {/* Bottom rail */}
          <line x1={P_L} y1={P_B} x2={P_R} y2={P_B} stroke="#54617A" strokeWidth={2} />
          {/* Left rail (broken around AC source at y=150, r≈14) */}
          <line x1={P_L} y1={P_T} x2={P_L} y2={136} stroke="#54617A" strokeWidth={2} />
          <line x1={P_L} y1={164} x2={P_L} y2={P_B} stroke="#54617A" strokeWidth={2} />
          {/* Right rail (broken around primary coil at y=120..180) */}
          <line x1={P_R} y1={P_T} x2={P_R} y2={120} stroke="#54617A" strokeWidth={2} />
          <line x1={P_R} y1={180} x2={P_R} y2={P_B} stroke="#54617A" strokeWidth={2} />

          {/* Corner dots */}
          {[[P_L, P_T], [P_R, P_T], [P_R, P_B], [P_L, P_B]].map(([x, y], i) => (
            <circle key={`pc${i}`} cx={x} cy={y} r={2.4} fill="#3A4863" />
          ))}

          {/* AC source (left) */}
          <ACSourceSymbol cx={P_L} cy={150} labels={labels} />
          {/* U1 label above AC source */}
          <text x={P_L} y={100 - 8} fill="#7EE3D8" fontFamily="'JetBrains Mono', monospace" fontSize={11} textAnchor="middle">
            {`${labels.u1} = ${fmtV(U1)} ${labels.unit_v}`}
          </text>

          {/* A1 ammeter (top rail) */}
          <AmmeterSymbol cx={175} cy={P_T} label="A" />
          <text x={175} y={P_T - 20} fill={I1 > 0 ? '#37C9B8' : '#6C7A93'} fontFamily="'JetBrains Mono', monospace" fontSize={10} textAnchor="middle">
            {showI1 ? `${labels.i1} = ${fmtI_mA(I1)}` : `${labels.i1} = ?`}
          </text>

          {/* Primary coil (bulges right toward iron core) */}
          <CoilSymbol xr={P_R} y1={120} y2={180} bulge="right" />
          {/* N1 label to the left of coil */}
          <text x={P_R - 22} y={155} fill="#B9C4D6" fontFamily="'JetBrains Mono', monospace" fontSize={10} textAnchor="end">
            {`${labels.n1} = ${N1}`}
          </text>
        </g>

        {/* ─── Iron core ─── */}
        <IronCoreSymbol />

        {/* ─── Secondary side ─── */}
        <g>
          {/* Top rail (broken around A2 ammeter at x=440) */}
          <line x1={S_L} y1={S_T} x2={426} y2={S_T} stroke="#54617A" strokeWidth={2} />
          <line x1={454} y1={S_T} x2={S_R} y2={S_T} stroke="#54617A" strokeWidth={2} />
          {/* Bottom rail */}
          <line x1={S_L} y1={S_B} x2={S_R} y2={S_B} stroke="#54617A" strokeWidth={2} />
          {/* Left rail (broken around secondary coil at y=120..180) */}
          <line x1={S_L} y1={S_T} x2={S_L} y2={120} stroke="#54617A" strokeWidth={2} />
          <line x1={S_L} y1={180} x2={S_L} y2={S_B} stroke="#54617A" strokeWidth={2} />
          {/* Right rail (broken around load R at y=126..174) */}
          <line x1={S_R} y1={S_T} x2={S_R} y2={126} stroke="#54617A" strokeWidth={2} />
          <line x1={S_R} y1={174} x2={S_R} y2={S_B} stroke="#54617A" strokeWidth={2} />

          {/* Corner dots */}
          {[[S_L, S_T], [S_R, S_T], [S_R, S_B], [S_L, S_B]].map(([x, y], i) => (
            <circle key={`sc${i}`} cx={x} cy={y} r={2.4} fill="#3A4863" />
          ))}

          {/* Secondary coil (bulges left toward iron core) */}
          <CoilSymbol xr={S_L} y1={120} y2={180} bulge="left" />
          {/* N2 label to the right of coil */}
          <text x={S_L + 22} y={155} fill="#B9C4D6" fontFamily="'JetBrains Mono', monospace" fontSize={10} textAnchor="start">
            {`${labels.n2} = ${N2}`}
          </text>

          {/* A2 ammeter (top rail) */}
          <AmmeterSymbol cx={440} cy={S_T} label="A" />
          <text x={440} y={S_T - 20} fill={I2 > 0 && showI2 ? '#37C9B8' : '#6C7A93'} fontFamily="'JetBrains Mono', monospace" fontSize={10} textAnchor="middle">
            {showI2 ? `${labels.i2} = ${fmtI_mA(I2)}` : `${labels.i2} = ?`}
          </text>

          {/* Load resistor (right) */}
          <ResistorSymbol cx={S_R} cy={150} vertical />
          {/* R label to right of resistor */}
          <text x={S_R + 22} y={155} fill="#B9C4D6" fontFamily="'JetBrains Mono', monospace" fontSize={9} textAnchor="start">
            {labels.load_r}
          </text>

          {/* U2 label above secondary loop */}
          <text x={(S_L + S_R) / 2} y={92} fill="#F9A968" fontFamily="'JetBrains Mono', monospace" fontSize={11} textAnchor="middle">
            {showU2 ? `${labels.u2} = ${fmtV(U2)} ${labels.unit_v}` : `${labels.u2} = ?`}
          </text>
        </g>

        {/* ─── Primary/secondary sub-labels ─── */}
        <text x={P_L + (P_R - P_L) / 2} y={220} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={9} textAnchor="middle" letterSpacing="0.1em">
          {labels.primary.toUpperCase()}
        </text>
        <text x={S_L + (S_R - S_L) / 2} y={220} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={9} textAnchor="middle" letterSpacing="0.1em">
          {labels.secondary.toUpperCase()}
        </text>

        {/* ─── Live-ratio strip (stages 1+2 only) ─── */}
        {showRatioStrip && (
          <g>
            <rect x={44} y={236} width={140} height={20} fill="#131F35" stroke="#3A4863" strokeWidth={1} rx={4} />
            <text x={54} y={250} fill="#7EE3D8" fontFamily="'JetBrains Mono', monospace" fontSize={11}>
              {`${labels.m_ratio} = ${fmtRatio(m)}`}
            </text>
          </g>
        )}

        {/* ─── Oscilloscope traces ─── */}
        <Oscilloscope U1={U1} U2={U2} showU2={showU2} labels={labels} />

        {/* ─── Stage-3 target chip inside schematic ─── */}
        {isStage3 && !showResult && (
          <g>
            <rect x={S_L + 6} y={112} width={94} height={22} fill="#131F35" stroke="#F97316" strokeWidth={1.2} rx={4} />
            <text x={S_L + 12} y={127} fill="#F9A968" fontFamily="'JetBrains Mono', monospace" fontSize={11}>
              {`${labels.target_prefix} = ${fmtV(currentScenario.targetU2)} ${labels.unit_v}`}
            </text>
          </g>
        )}
        {isStage3 && showResult && feedback === 'correct' && (
          <g>
            <rect x={S_L + 6} y={112} width={94} height={22} fill="#0F241E" stroke="#37C9B8" strokeWidth={1.2} rx={4} />
            <text x={S_L + 12} y={127} fill="#37C9B8" fontFamily="'JetBrains Mono', monospace" fontSize={11}>
              {labels.correct}
            </text>
          </g>
        )}
      </svg>

      {/* ─── Controls overlay (HTML in rem, positioned over the right SVG panel) ─── */}
      <div
        style={{
          position: 'absolute',
          top: svgToRem(70),
          right: svgToRem(32),
          width: svgToRem(140),
          height: svgToRem(340),
          fontFamily: "'JetBrains Mono', monospace",
          color: '#B9C4D6',
          zIndex: 4,
          display: 'flex',
          flexDirection: 'column',
          gap: '1.2rem',
          pointerEvents: 'auto',
        }}
      >
        {/* Stage 1: all sliders free ─────────────────────────────── */}
        {isStage1 && (
          <>
            <SliderBlock
              label={labels.n1} unit={labels.unit_turns}
              value={N1} min={N_MIN} max={N_MAX} step={N_STEP}
              onChange={setN1}
            />
            <SliderBlock
              label={labels.n2} unit={labels.unit_turns}
              value={N2} min={N_MIN} max={N_MAX} step={N_STEP}
              onChange={setN2}
            />
            <SliderBlock
              label={labels.u1} unit={labels.unit_v}
              value={U1} min={U1_MIN} max={U1_MAX} step={U1_STEP}
              onChange={updateU1}
            />
            <LiveReadouts m={m} U2={U2} I1={I1} I2={I2} labels={labels} />
          </>
        )}

        {/* Stage 2: N1 + U1 locked to set, N2 adjustable ─────────── */}
        {isStage2 && (
          <>
            <FixedLine label={labels.n1} value={`${stage2Set.N1} ${labels.unit_turns}`} />
            <FixedLine label={labels.u1} value={`${stage2Set.U1} ${labels.unit_v}`} />
            <SliderBlock
              label={labels.n2} unit={labels.unit_turns}
              value={N2} min={N_MIN} max={N_MAX} step={N_STEP}
              onChange={setN2}
              accent
            />
            <LiveReadouts m={m} U2={U2} I1={I1} I2={I2} labels={labels} />
            <TargetList targets={stage2Set.targets} hit={targetsHit} labels={labels} />
          </>
        )}

        {/* Stage 3: everything locked, numeric-entry for N2 ──────── */}
        {isStage3 && (
          <>
            <FixedLine label={labels.n1} value={`${currentScenario.N1} ${labels.unit_turns}`} />
            <FixedLine label={labels.u1} value={`${currentScenario.U1} ${labels.unit_v}`} />
            <FixedLine
              label={labels.target_prefix}
              value={`${fmtV(currentScenario.targetU2)} ${labels.unit_v}`}
              accent
            />
            <NumericEntry
              label={labels.enter_n2}
              value={inputText}
              onChange={setInputText}
              onSubmit={submitStage3}
              disabled={feedback === 'resetting' || feedback === 'correct'}
              feedback={feedback}
              labels={labels}
            />
            <div style={{ fontSize: '1.15rem', color: '#6C7A93', letterSpacing: '0.05em', lineHeight: 1.5 }}>
              {labels.attempts_left}: <span style={{ color: attemptsLeft <= 1 ? '#F9A968' : '#B9C4D6' }}>{attemptsLeft}</span>
              <br />
              {labels.scenario} {scenarioIdx + 1}/{stage3Deck.length}
            </div>
          </>
        )}
      </div>

      {/* ─── HUD overlays (HTML in rem) ─── */}
      <div style={{ position: 'absolute', top: '3rem', left: '3rem', fontFamily: "'JetBrains Mono', monospace", fontSize: '2.3rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: '#6C7A93', zIndex: 5, pointerEvents: 'none' }}>
        {hudTL}
      </div>
      <div style={{ position: 'absolute', top: '3rem', right: '3rem', fontFamily: "'JetBrains Mono', monospace", fontSize: '1.4rem', letterSpacing: '0.08em', color: canSubmit ? '#37C9B8' : '#B9C4D6', zIndex: 5, pointerEvents: 'none', textAlign: 'right', maxWidth: '55%' }}>
        {hudTR}
      </div>
      <div style={{ position: 'absolute', bottom: '3rem', left: '3rem', fontFamily: "'JetBrains Mono', monospace", fontSize: '1.7rem', letterSpacing: '0.06em', color: peekVisible ? '#F9A968' : '#6C7A93', zIndex: 5, pointerEvents: 'none', maxWidth: '60%' }}>
        {hudBL}
      </div>
      {/* NO bottom-right overlay — reserved for parent chrome (§4.3). */}
    </div>
  )
}

// ─── Slider control (HTML) ──────────────────────────────────────────────
function SliderBlock({
  label, unit, value, min, max, step, onChange, accent = false,
}: {
  label: string
  unit: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  accent?: boolean
}) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.15rem', letterSpacing: '0.08em', color: '#B9C4D6' }}>
        <span>{label}</span>
        <span style={{ color: accent ? '#F9A968' : '#7EE3D8' }}>{value} {unit}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{
          width: '100%',
          marginTop: '0.3rem',
          accentColor: accent ? '#F97316' : '#37C9B8',
        }}
      />
    </div>
  )
}

function FixedLine({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.15rem', letterSpacing: '0.08em' }}>
      <span style={{ color: '#6C7A93' }}>{label}</span>
      <span style={{ color: accent ? '#F9A968' : '#B9C4D6' }}>{value}</span>
    </div>
  )
}

function LiveReadouts({
  m, U2, I1, I2, labels,
}: {
  m: number
  U2: number
  I1: number
  I2: number
  labels: Record<string, string>
}) {
  return (
    <div style={{ marginTop: '0.4rem', fontSize: '1.15rem', lineHeight: 1.55, color: '#6C7A93', letterSpacing: '0.05em' }}>
      <Line k={labels.m_ratio ?? ''} v={fmtRatio(m)} tone="teal" />
      <Line k={labels.u2 ?? ''} v={`${fmtV(U2)} ${labels.unit_v ?? ''}`} tone="amber" />
      <Line k={labels.i1 ?? ''} v={fmtI_mA(I1)} tone="teal" />
      <Line k={labels.i2 ?? ''} v={fmtI_mA(I2)} tone="teal" />
    </div>
  )
}
function Line({ k, v, tone }: { k: string; v: string; tone: 'teal' | 'amber' }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <span>{k}</span>
      <span style={{ color: tone === 'teal' ? '#7EE3D8' : '#F9A968' }}>{v}</span>
    </div>
  )
}

function TargetList({
  targets, hit, labels,
}: {
  targets: number[]
  hit: boolean[]
  labels: Record<string, string>
}) {
  return (
    <div style={{ marginTop: '0.4rem', fontSize: '1.15rem', lineHeight: 1.55 }}>
      <div style={{ color: '#6C7A93', letterSpacing: '0.08em' }}>{labels.targets}</div>
      {targets.map((t, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', color: hit[i] ? '#37C9B8' : '#B9C4D6' }}>
          <span>{hit[i] ? '✓' : '·'} {labels.target_prefix}</span>
          <span>{fmtV(t)} {labels.unit_v}</span>
        </div>
      ))}
    </div>
  )
}

function NumericEntry({
  label, value, onChange, onSubmit, disabled, feedback, labels,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  disabled: boolean
  feedback: null | 'correct' | 'wrong' | 'resetting'
  labels: Record<string, string>
}) {
  const borderColor = feedback === 'correct' ? '#37C9B8'
    : feedback === 'wrong' ? '#EF4444'
    : feedback === 'resetting' ? '#F97316'
    : '#3A4863'
  return (
    <div>
      <div style={{ fontSize: '1.15rem', color: '#6C7A93', letterSpacing: '0.08em', marginBottom: '0.3rem' }}>
        {label}
      </div>
      <input
        type="number"
        inputMode="numeric"
        value={value}
        placeholder="—"
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') onSubmit() }}
        style={{
          width: '100%',
          background: '#131F35',
          border: `1px solid ${borderColor}`,
          borderRadius: '0.5rem',
          padding: '0.6rem 0.8rem',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '1.6rem',
          color: '#EAF0FA',
          outline: 'none',
        }}
      />
      <button
        onClick={onSubmit}
        disabled={disabled || value.trim() === ''}
        style={{
          marginTop: '0.5rem',
          width: '100%',
          background: disabled || value.trim() === '' ? '#1a2540' : '#37C9B8',
          color: disabled || value.trim() === '' ? '#6C7A93' : '#0D1524',
          border: 'none',
          borderRadius: '0.5rem',
          padding: '0.5rem 0.8rem',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '1.25rem',
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          cursor: disabled || value.trim() === '' ? 'default' : 'pointer',
        }}
      >
        {labels.submit}
      </button>
      {feedback === 'wrong' && (
        <div style={{ marginTop: '0.4rem', fontSize: '1.1rem', color: '#EF4444', letterSpacing: '0.08em' }}>{labels.wrong}</div>
      )}
      {feedback === 'correct' && (
        <div style={{ marginTop: '0.4rem', fontSize: '1.1rem', color: '#37C9B8', letterSpacing: '0.08em' }}>{labels.correct}</div>
      )}
      {feedback === 'resetting' && (
        <div style={{ marginTop: '0.4rem', fontSize: '1.1rem', color: '#F9A968', letterSpacing: '0.08em' }}>{labels.resetting}</div>
      )}
    </div>
  )
}

// ─── SVG symbols ────────────────────────────────────────────────────────
function ACSourceSymbol({
  cx, cy, labels,
}: { cx: number; cy: number; labels: Record<string, string> }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={14} fill="#131F35" stroke="#54617A" strokeWidth={1.4} />
      {/* Sine glyph inside */}
      <path
        d={`M ${cx - 8} ${cy} Q ${cx - 4} ${cy - 6} ${cx} ${cy} T ${cx + 8} ${cy}`}
        fill="none" stroke="#7EE3D8" strokeWidth={1.4}
      />
      <text x={cx} y={cy + 22} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={9} textAnchor="middle">
        {labels.ac_source}
      </text>
    </g>
  )
}

function AmmeterSymbol({ cx, cy, label }: { cx: number; cy: number; label: string }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={12} fill="#131F35" stroke="#54617A" strokeWidth={1.4} />
      <text x={cx} y={cy + 4} fill="#B9C4D6" fontFamily="'JetBrains Mono', monospace" fontSize={11} textAnchor="middle" fontWeight={700}>
        {label}
      </text>
    </g>
  )
}

function ResistorSymbol({ cx, cy, vertical = false }: { cx: number; cy: number; vertical?: boolean }) {
  // IEC rectangle body; wire stubs run along the axis.
  return (
    <g transform={vertical ? `translate(${cx}, ${cy}) rotate(90)` : `translate(${cx}, ${cy})`}>
      <line x1={-24} y1={0} x2={-14} y2={0} stroke="#54617A" strokeWidth={2} />
      <line x1={14} y1={0} x2={24} y2={0} stroke="#54617A" strokeWidth={2} />
      <rect x={-14} y={-7} width={28} height={14} fill="#131F35" stroke="#54617A" strokeWidth={1.2} />
      <text x={0} y={3} fill="#B9C4D6" fontFamily="'JetBrains Mono', monospace" fontSize={9} textAnchor="middle" transform={vertical ? 'rotate(-90)' : ''}>R</text>
    </g>
  )
}

function CoilSymbol({
  xr, y1, y2, bulge,
}: { xr: number; y1: number; y2: number; bulge: 'left' | 'right' }) {
  // Series of half-circle arcs stacked from y1 to y2, bulging left or right.
  const N_ARCS = 5
  const step = (y2 - y1) / N_ARCS
  const rx = 7
  const ry = step / 2
  // Sweep flag: for downward traversal, 1 = bulge right, 0 = bulge left.
  const sweep = bulge === 'right' ? 1 : 0
  let d = `M ${xr} ${y1}`
  for (let i = 0; i < N_ARCS; i++) {
    d += ` a ${rx} ${ry} 0 0 ${sweep} 0 ${step}`
  }
  return (
    <g>
      <path d={d} fill="none" stroke="#B9C4D6" strokeWidth={1.8} />
    </g>
  )
}

function IronCoreSymbol() {
  // Two vertical bars representing the laminated core.
  return (
    <g>
      <rect x={286} y={68} width={8} height={164} fill="#2A3550" stroke="#54617A" strokeWidth={1} />
      <rect x={316} y={68} width={8} height={164} fill="#2A3550" stroke="#54617A" strokeWidth={1} />
      {/* Hatching for iron */}
      {[80, 100, 120, 140, 160, 180, 200, 220].map((y) => (
        <g key={y}>
          <line x1={288} y1={y} x2={292} y2={y - 4} stroke="#3A4863" strokeWidth={0.8} />
          <line x1={318} y1={y} x2={322} y2={y - 4} stroke="#3A4863" strokeWidth={0.8} />
        </g>
      ))}
      {/* Flux arrows between the bars */}
      <path d="M 296 110 L 314 110" stroke="#7EE3D8" strokeWidth={1} strokeDasharray="2 2" opacity={0.6} />
      <path d="M 296 150 L 314 150" stroke="#7EE3D8" strokeWidth={1} strokeDasharray="2 2" opacity={0.6} />
      <path d="M 296 190 L 314 190" stroke="#7EE3D8" strokeWidth={1} strokeDasharray="2 2" opacity={0.6} />
    </g>
  )
}

// ─── Oscilloscope (two sines, in phase, amplitudes ∝ U1, U2) ───────────
function Oscilloscope({
  U1, U2, showU2, labels,
}: {
  U1: number
  U2: number
  showU2: boolean
  labels: Record<string, string>
}) {
  // Panel: x=32..592, y=274..418. Draw area: x=44..584, y=286..410. Center y ≈ 348.
  const X0 = 44, X1 = 584, cy = 348
  const spanX = X1 - X0
  const cycles = 2.5

  // Amplitude scale: 240 V → 45 SVG units, clamped to 55 (in-panel).
  const scale = (v: number) => Math.max(-55, Math.min(55, (v / 240) * 45))
  const A1 = scale(U1)
  const A2 = scale(U2)

  const samples = 120
  let path1 = ''
  let path2 = ''
  for (let i = 0; i <= samples; i++) {
    const x = X0 + (spanX * i) / samples
    const t = (i / samples) * cycles * 2 * Math.PI
    const y1 = cy - A1 * Math.sin(t)
    const y2 = cy - A2 * Math.sin(t)
    path1 += (i === 0 ? 'M' : 'L') + ` ${x.toFixed(2)} ${y1.toFixed(2)} `
    path2 += (i === 0 ? 'M' : 'L') + ` ${x.toFixed(2)} ${y2.toFixed(2)} `
  }

  return (
    <g>
      {/* Grid */}
      <line x1={X0} y1={cy} x2={X1} y2={cy} stroke="#3A4863" strokeWidth={0.8} strokeDasharray="3 3" />
      {[286, 306, 326, 346, 366, 386, 406].map((y) => (
        <line key={y} x1={X0} y1={y} x2={X1} y2={y} stroke="#12203a" strokeWidth={0.6} />
      ))}
      {[44, 154, 264, 374, 484, 584].map((x) => (
        <line key={x} x1={x} y1={286} x2={x} y2={410} stroke="#12203a" strokeWidth={0.6} />
      ))}

      {/* u1 trace (teal) */}
      <path d={path1} fill="none" stroke="#7EE3D8" strokeWidth={1.6} />
      {/* u2 trace (amber, hidden on stage 3 pre-submit) */}
      {showU2 && (
        <path d={path2} fill="none" stroke="#F9A968" strokeWidth={1.6} />
      )}

      {/* Legend (top-right of scope panel) */}
      <g>
        <rect x={478} y={280} width={104} height={30} fill="#131F35" stroke="#3A4863" strokeWidth={0.8} rx={3} />
        <line x1={486} y1={289} x2={498} y2={289} stroke="#7EE3D8" strokeWidth={2} />
        <text x={502} y={292} fill="#B9C4D6" fontFamily="'JetBrains Mono', monospace" fontSize={9}>
          {labels.u1_wave}
        </text>
        <line x1={486} y1={303} x2={498} y2={303} stroke={showU2 ? '#F9A968' : '#3A4863'} strokeWidth={2} strokeDasharray={showU2 ? undefined : '2 2'} />
        <text x={502} y={306} fill={showU2 ? '#B9C4D6' : '#54617A'} fontFamily="'JetBrains Mono', monospace" fontSize={9}>
          {labels.u2_wave}
        </text>
      </g>
    </g>
  )
}
