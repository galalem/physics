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

// Panels
const LEFT_X = 32
const LEFT_W = 468
const PANEL_TOP = 60
const PANEL_H = 358

// Voltage-divider schematic frame (top of left panel)
const VD_TOP = 80
const VD_BOT = 210
// Current-divider schematic frame (bottom of left panel)
const CD_TOP = 240
const CD_BOT = 400

// Right controls panel
const RIGHT_X = 512
const RIGHT_W = 258

const dict = { en } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── Physics — pure divider formulas ─────────────────────────────────────
// Voltage divider (series): U2 = E * R2 / (R1 + R2)
// Current divider (parallel): I1 = I * R2 / (R1 + R2)
// Test: E=12 V, R1=200, R2=100 → U2 = 12·100/300 = 4 V ✓
// Test: I=100 mA, R1=300, R2=100 → I1 = 100·100/400 = 25 mA ✓
function voltageDividerU2(E: number, R1: number, R2: number): number {
  const denom = R1 + R2
  return denom > 0 ? (E * R2) / denom : 0
}
function currentDividerI1(I: number, R1: number, R2: number): number {
  const denom = R1 + R2
  return denom > 0 ? (I * R2) / denom : 0
}

// ─── Slider ranges ──────────────────────────────────────────────────────
const E_MIN = 0, E_MAX = 24, E_STEP = 0.5
const I_MIN = 0, I_MAX = 120, I_STEP = 5 // mA
const R_MIN = 10, R_MAX = 500, R_STEP = 10

// ─── Stage-2 target sets (HAND-AUTHORED, seed picks) ─────────────────────
// Each pair (target_U2, target_I1) is chosen so the SAME ratio R2/(R1+R2)
// hits both. Student picks R1, R2 to match; E and I are given (fixed).
type TargetSet = { E: number; I: number; target_U2: number; target_I1: number }
const TARGET_SETS: TargetSet[] = [
  { E: 12, I: 90, target_U2: 4, target_I1: 30 }, // ratio 1/3
  { E: 10, I: 100, target_U2: 6, target_I1: 60 }, // ratio 3/5
  { E: 15, I: 60, target_U2: 6, target_I1: 24 }, // ratio 2/5
]

// ─── Stage-3 scenario deck (HAND-AUTHORED, seed picks starting index) ────
type ScenarioType = 'voltage' | 'current'
type Scenario = {
  type: ScenarioType
  E: number // used if voltage
  I: number // used if current, mA
  R2: number
  target: number // target U2 (V) if voltage, target I1 (mA) if current
  answer: number // R1 in Ω
}
const SCENARIOS: Scenario[] = [
  { type: 'voltage', E: 12, I: 0, R2: 100, target: 4, answer: 200 },
  { type: 'current', E: 0, I: 100, R2: 100, target: 25, answer: 300 },
  { type: 'voltage', E: 15, I: 0, R2: 50, target: 3, answer: 200 },
  { type: 'current', E: 0, I: 60, R2: 200, target: 20, answer: 400 },
  { type: 'voltage', E: 9, I: 0, R2: 150, target: 6, answer: 75 },
  { type: 'current', E: 0, I: 80, R2: 100, target: 40, answer: 100 },
]
const DECK_SIZE = 3
const ATTEMPTS_PER_SCENARIO = 3
const NUMERIC_TOLERANCE = 0.05 // ±5%

// ─── Component ──────────────────────────────────────────────────────────
export default function Scene() {
  const { locale, seed } = useInit()
  const stages = useMemo(() => getStagesFor(locale), [locale])
  useDeclareStages(stages)
  const labels = useMemo(() => svgLabels(locale), [locale])

  const stageIdx = useCurrentStage()
  const setStage = useSetStage()

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  // ─── Free-play state (stages 1 + 2) ─────────────────────────────────
  const [E, setE] = useState(0)
  const [I, setI] = useState(0)
  const [R1, setR1] = useState(100)
  const [R2, setR2] = useState(100)

  // ─── Stage-2 target set ───────────────────────────────────────────
  const targetSet = useMemo<TargetSet>(
    () => TARGET_SETS[seed % TARGET_SETS.length]!,
    [seed],
  )
  // Freeze E and I to the target set's values on stage 2 (student only
  // has R1 / R2 as DOFs) — makes the problem well-posed.
  useEffect(() => {
    if (isStage2) {
      setE(targetSet.E)
      setI(targetSet.I)
    }
  }, [isStage2, targetSet])

  // ─── Stage-1 coverage flags ────────────────────────────────────────
  const [sawVoltageOut, setSawVoltageOut] = useState(false)
  const [sawCurrentOut, setSawCurrentOut] = useState(false)
  const [sawAsymmetric, setSawAsymmetric] = useState(false)

  // Live-computed readings (used everywhere except stage 3).
  const U2 = voltageDividerU2(E, R1, R2)
  const I1 = currentDividerI1(I, R1, R2)

  useEffect(() => {
    if (!isStage1) return
    if (U2 > 1 && !sawVoltageOut) setSawVoltageOut(true)
    if (I1 > 5 && !sawCurrentOut) setSawCurrentOut(true)
    if (Math.abs(R1 - R2) > 50 && !sawAsymmetric) setSawAsymmetric(true)
  }, [isStage1, U2, I1, R1, R2, sawVoltageOut, sawCurrentOut, sawAsymmetric])

  // ─── Stage-2 target-hit flags (persistent once achieved) ────────────
  const [hitU2, setHitU2] = useState(false)
  const [hitI1, setHitI1] = useState(false)
  useEffect(() => {
    if (!isStage2) return
    if (Math.abs(U2 - targetSet.target_U2) / targetSet.target_U2 < NUMERIC_TOLERANCE && !hitU2) {
      setHitU2(true)
    }
    if (Math.abs(I1 - targetSet.target_I1) / targetSet.target_I1 < NUMERIC_TOLERANCE && !hitI1) {
      setHitI1(true)
    }
  }, [isStage2, U2, I1, targetSet, hitU2, hitI1])

  // ─── Stage-3 blind state ───────────────────────────────────────────
  // Ace-the-deck: cycle DECK_SIZE scenarios; 3 attempts per scenario;
  // wrong = attempts decrement, blank input on next try;
  // exhausted attempts = advance to next scenario but RESET deck-progress
  // (must chain DECK_SIZE consecutive corrects).
  const deckStart = seed % SCENARIOS.length
  const [deckIdx, setDeckIdx] = useState(0) // 0..DECK_SIZE (== consecutive corrects)
  const [scenarioOffset, setScenarioOffset] = useState(0) // cycles through SCENARIOS
  const [attemptsLeft, setAttemptsLeft] = useState(ATTEMPTS_PER_SCENARIO)
  const [inputValue, setInputValue] = useState('')
  const [feedback, setFeedback] = useState<null | 'correct' | 'wrong' | 'exhausted'>(null)
  const scenario = SCENARIOS[(deckStart + scenarioOffset) % SCENARIOS.length]!

  const parseInput = (s: string): number | null => {
    const cleaned = s.trim().replace(',', '.').replace(/[^\d.\-eE]/g, '')
    if (cleaned === '') return null
    const n = Number(cleaned)
    return Number.isFinite(n) ? n : null
  }

  const submitStage3 = useCallback(() => {
    if (feedback === 'correct') return
    const val = parseInput(inputValue)
    if (val === null) return
    const target = scenario.answer
    const isCorrect = Math.abs(val - target) / target < NUMERIC_TOLERANCE
    if (isCorrect) {
      setFeedback('correct')
      const nextDeck = deckIdx + 1
      // Advance after brief pause so student sees the feedback.
      setTimeout(() => {
        if (nextDeck >= DECK_SIZE) {
          setDeckIdx(nextDeck) // triggers canSubmit true → chrome enables Next
        } else {
          setDeckIdx(nextDeck)
          setScenarioOffset((o) => o + 1)
          setAttemptsLeft(ATTEMPTS_PER_SCENARIO)
          setInputValue('')
          setFeedback(null)
        }
      }, 900)
    } else {
      const remaining = attemptsLeft - 1
      if (remaining <= 0) {
        setFeedback('exhausted')
        // Reset consecutive-correct count and rotate to next scenario.
        setTimeout(() => {
          setDeckIdx(0)
          setScenarioOffset((o) => o + 1)
          setAttemptsLeft(ATTEMPTS_PER_SCENARIO)
          setInputValue('')
          setFeedback(null)
        }, 1400)
      } else {
        setFeedback('wrong')
        setAttemptsLeft(remaining)
        setTimeout(() => {
          setInputValue('')
          setFeedback(null)
        }, 900)
      }
    }
  }, [feedback, inputValue, scenario.answer, deckIdx, attemptsLeft])

  // Advance predicates
  const stage1Done = sawVoltageOut && sawCurrentOut && sawAsymmetric
  const stage2Done = hitU2 && hitI1
  const stage3Done = deckIdx >= DECK_SIZE
  const canSubmit = isStage1 ? stage1Done : isStage2 ? stage2Done : stage3Done

  // ─── Reset ─────────────────────────────────────────────────────────
  const resetStageState = useCallback(() => {
    setE(0)
    setI(0)
    setR1(100)
    setR2(100)
    setSawVoltageOut(false)
    setSawCurrentOut(false)
    setSawAsymmetric(false)
    setHitU2(false)
    setHitI1(false)
    setDeckIdx(0)
    setScenarioOffset(0)
    setAttemptsLeft(ATTEMPTS_PER_SCENARIO)
    setInputValue('')
    setFeedback(null)
  }, [])
  useReset(resetStageState)

  const complete = useComplete()
  const progress = useProgress()
  useEffect(() => {
    progress(stageIdx / stages.length, { stage: stageIdx, canSubmit })
  }, [stageIdx, stages.length, canSubmit, progress])

  useNext(() => {
    if (stageIdx < stages.length) {
      setStage(stageIdx + 1)
      resetStageState()
    } else {
      complete({ success: true })
    }
  })

  // ─── Peek — strategy hint only (no numeric reveal) ─────────────────
  const [peekText, setPeekText] = useState<string | null>(null)
  usePeek(() => {
    if (!isStage3) return
    setPeekText(labels.peek_tip)
  })
  useEffect(() => {
    if (!peekText) return
    const t = setTimeout(() => setPeekText(null), 5000)
    return () => clearTimeout(t)
  }, [peekText])

  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  // ─── HUD text ──────────────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`
  const stage1Progress = `${sawVoltageOut ? '✓' : '·'} ${labels.coverage_voltage_seen}   ${sawCurrentOut ? '✓' : '·'} ${labels.coverage_current_seen}   ${sawAsymmetric ? '✓' : '·'} ${labels.coverage_asymmetric}`
  const fmtV = (v: number) => `${v.toFixed(1)} V`
  const fmtmA = (v: number) => `${v.toFixed(1)} mA`
  const stage2Progress = `${labels.targets}  ${labels.label_U2}=${fmtV(targetSet.target_U2)} ${hitU2 ? '✓' : ' '}   ${labels.label_I1}=${fmtmA(targetSet.target_I1)} ${hitI1 ? '✓' : ' '}`
  const stage3Progress = `${labels.deck} ${Math.min(deckIdx, DECK_SIZE)}/${DECK_SIZE}   ${labels.attempts_left}: ${attemptsLeft}`
  const hudTR = isStage1 ? stage1Progress : isStage2 ? stage2Progress : stage3Progress
  const hudBL = isStage3
    ? (peekText ?? labels.tip3)
    : isStage2
      ? labels.tip2
      : labels.tip1

  // Stage-3 scenario given/target chips (shown near active schematic).
  const activeIsVoltage = isStage3 && scenario.type === 'voltage'
  const activeIsCurrent = isStage3 && scenario.type === 'current'

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block', userSelect: 'none' }}
      >
        {/* Background — no rx per §4.4 */}
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        {/* Left panel outline */}
        <rect x={LEFT_X} y={PANEL_TOP} width={LEFT_W} height={PANEL_H} fill="none" stroke="#12203a" strokeWidth={1} rx={6} />
        <text x={LEFT_X + 8} y={PANEL_TOP - 8} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={11} letterSpacing="0.1em">
          {labels.voltage_divider}  ·  {labels.current_divider}
        </text>

        {/* Right panel outline */}
        <rect x={RIGHT_X} y={PANEL_TOP} width={RIGHT_W} height={PANEL_H} fill="none" stroke="#12203a" strokeWidth={1} rx={6} />
        <text x={RIGHT_X + 8} y={PANEL_TOP - 8} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={11} letterSpacing="0.1em">
          {labels.controls}
        </text>

        {/* ─── Voltage divider schematic (top of left panel) ────── */}
        <VoltageDividerDiagram
          x={LEFT_X + 20}
          y={VD_TOP}
          width={LEFT_W - 40}
          height={VD_BOT - VD_TOP}
          E={E}
          R1={R1}
          R2={R2}
          U2={U2}
          hideReading={isStage3}
          hideR1Value={isStage3}
          dim={activeIsCurrent}
          labels={labels}
        />
        {/* Stage-3 voltage scenario given/target chip */}
        {activeIsVoltage && (
          <g>
            <rect x={LEFT_X + 20} y={VD_TOP + 4} width={200} height={22} rx={4} fill="#111c30" stroke="#3A4863" />
            <text x={LEFT_X + 28} y={VD_TOP + 19} fill="#B9C4D6" fontFamily="'JetBrains Mono', monospace" fontSize={11}>
              {labels.given} E={scenario.E}V, R₂={scenario.R2}Ω → {labels.target} U₂={scenario.target}V
            </text>
          </g>
        )}

        {/* ─── Current divider schematic (bottom of left panel) ── */}
        <CurrentDividerDiagram
          x={LEFT_X + 20}
          y={CD_TOP}
          width={LEFT_W - 40}
          height={CD_BOT - CD_TOP}
          I={I}
          R1={R1}
          R2={R2}
          I1={I1}
          hideReading={isStage3}
          hideR1Value={isStage3}
          dim={activeIsVoltage}
          labels={labels}
        />
        {activeIsCurrent && (
          <g>
            <rect x={LEFT_X + 20} y={CD_TOP + 4} width={200} height={22} rx={4} fill="#111c30" stroke="#3A4863" />
            <text x={LEFT_X + 28} y={CD_TOP + 19} fill="#B9C4D6" fontFamily="'JetBrains Mono', monospace" fontSize={11}>
              {labels.given} I={scenario.I}mA, R₂={scenario.R2}Ω → {labels.target} I₁={scenario.target}mA
            </text>
          </g>
        )}

        {/* ─── Right panel: controls (HTML in foreignObject) ────── */}
        <foreignObject x={RIGHT_X + 6} y={PANEL_TOP + 8} width={RIGHT_W - 12} height={PANEL_H - 16}>
          <div
            {...({ xmlns: 'http://www.w3.org/1999/xhtml' } as { xmlns: string })}
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              fontFamily: "'JetBrains Mono', monospace",
              color: '#B9C4D6',
              fontSize: 11,
            }}
          >
            {/* Formula strip — HIDDEN on stage 3 per §4.7 */}
            {!isStage3 && (
              <div style={{ padding: '4px 6px', background: '#111c30', border: '1px solid #3A4863', borderRadius: 4 }}>
                <div style={{ color: '#37C9B8' }}>
                  {labels.label_U2} = {U2.toFixed(2)} V
                </div>
                <div style={{ color: '#F9A968', marginTop: 2 }}>
                  {labels.label_I1} = {I1.toFixed(1)} mA
                </div>
              </div>
            )}

            {/* Sliders — always visible on stages 1+2. On stage 3 we show only R2
                (locked) for the active scenario, and a numeric input for R1. */}
            {!isStage3 && (
              <>
                <SliderRow
                  label={`${labels.label_E} = ${E.toFixed(1)} V`}
                  min={E_MIN} max={E_MAX} step={E_STEP} value={E}
                  onChange={setE} accent="#37C9B8"
                  disabled={isStage2}
                />
                <SliderRow
                  label={`${labels.label_I} = ${I.toFixed(0)} mA`}
                  min={I_MIN} max={I_MAX} step={I_STEP} value={I}
                  onChange={setI} accent="#F9A968"
                  disabled={isStage2}
                />
                <SliderRow
                  label={`${labels.label_R1} = ${R1} Ω`}
                  min={R_MIN} max={R_MAX} step={R_STEP} value={R1}
                  onChange={setR1} accent="#8AB3FF"
                />
                <SliderRow
                  label={`${labels.label_R2} = ${R2} Ω`}
                  min={R_MIN} max={R_MAX} step={R_STEP} value={R2}
                  onChange={setR2} accent="#8AB3FF"
                />
              </>
            )}

            {/* Stage-3 numeric entry */}
            {isStage3 && (
              <>
                <div style={{ marginTop: 4, color: '#6C7A93' }}>
                  {labels.scenario_progress} {Math.min(deckIdx + 1, DECK_SIZE)} {labels.of} {DECK_SIZE}
                  {' · '}
                  {scenario.type === 'voltage' ? labels.scenario_type_voltage : labels.scenario_type_current}
                </div>
                <div style={{ marginTop: 6 }}>
                  {labels.solve_for}{' '}
                  <span style={{ color: '#8AB3FF' }}>{labels.label_R1}</span>
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    marginTop: 4,
                    padding: 4,
                    background: '#111c30',
                    border: `1px solid ${
                      feedback === 'correct'
                        ? '#37C9B8'
                        : feedback === 'wrong' || feedback === 'exhausted'
                          ? '#EF4444'
                          : '#3A4863'
                    }`,
                    borderRadius: 4,
                  }}
                >
                  <input
                    type="text"
                    inputMode="decimal"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') submitStage3()
                    }}
                    disabled={feedback === 'correct' || feedback === 'exhausted'}
                    placeholder="R₁ (Ω)"
                    style={{
                      flex: 1,
                      background: 'transparent',
                      color: '#EAF0FA',
                      border: 'none',
                      outline: 'none',
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: 12,
                      padding: '2px 4px',
                    }}
                  />
                  <span style={{ color: '#6C7A93', fontSize: 10 }}>{labels.unit_ohm}</span>
                </div>
                <button
                  type="button"
                  onClick={submitStage3}
                  disabled={
                    feedback === 'correct' ||
                    feedback === 'exhausted' ||
                    parseInput(inputValue) === null
                  }
                  style={{
                    marginTop: 4,
                    padding: '6px 8px',
                    background:
                      feedback === 'correct'
                        ? '#37C9B8'
                        : feedback === 'wrong' || feedback === 'exhausted'
                          ? '#EF4444'
                          : '#1a2a44',
                    color: '#EAF0FA',
                    border: `1px solid ${
                      feedback === 'correct'
                        ? '#37C9B8'
                        : feedback === 'wrong' || feedback === 'exhausted'
                          ? '#EF4444'
                          : '#3A4863'
                    }`,
                    borderRadius: 4,
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 11,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    cursor:
                      feedback === 'correct' ||
                      feedback === 'exhausted' ||
                      parseInput(inputValue) === null
                        ? 'not-allowed'
                        : 'pointer',
                  }}
                >
                  {feedback === 'correct'
                    ? labels.correct
                    : feedback === 'wrong' || feedback === 'exhausted'
                      ? labels.wrong
                      : labels.submit}
                </button>
                {feedback === 'exhausted' && (
                  <div style={{ marginTop: 4, color: '#EF4444', fontSize: 10 }}>
                    R₁ = {scenario.answer} Ω
                  </div>
                )}
              </>
            )}
          </div>
        </foreignObject>
        {/* Leave BR (x>600 && y>350) SVG region free of dedicated content. */}
      </svg>

      {/* HUD overlays — HTML in rem */}
      <div style={{ position: 'absolute', top: '3rem', left: '3rem', fontFamily: "'JetBrains Mono', monospace", fontSize: '2.3rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: '#6C7A93', zIndex: 5, pointerEvents: 'none' }}>
        {hudTL}
      </div>
      <div style={{ position: 'absolute', top: '3rem', right: '3rem', fontFamily: "'JetBrains Mono', monospace", fontSize: '1.5rem', letterSpacing: '0.08em', color: canSubmit ? '#37C9B8' : '#B9C4D6', zIndex: 5, pointerEvents: 'none', textAlign: 'right', maxWidth: '55%' }}>
        {hudTR}
      </div>
      <div style={{ position: 'absolute', bottom: '3rem', left: '3rem', fontFamily: "'JetBrains Mono', monospace", fontSize: '1.5rem', letterSpacing: '0.06em', color: '#6C7A93', zIndex: 5, pointerEvents: 'none', maxWidth: '58%' }}>
        {hudBL}
      </div>
      {/* NO bottom-right overlay — BR reserved for parent chrome (§4.3). */}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════
//  Sub-components
// ═══════════════════════════════════════════════════════════════════════

function SliderRow({
  label, min, max, step, value, onChange, accent, disabled,
}: {
  label: string
  min: number
  max: number
  step: number
  value: number
  onChange: (v: number) => void
  accent: string
  disabled?: boolean
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div style={{ color: disabled ? '#54617A' : accent, fontSize: 10 }}>{label}</div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{
          width: '100%',
          height: 12,
          accentColor: accent,
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
        }}
      />
    </div>
  )
}

// ─── Voltage-divider schematic (series loop) ──────────────────────────
function VoltageDividerDiagram({
  x, y, width, height, E, R1, R2, U2, hideReading, hideR1Value, dim, labels,
}: {
  x: number; y: number; width: number; height: number
  E: number; R1: number; R2: number; U2: number
  hideReading: boolean; hideR1Value: boolean; dim: boolean
  labels: Record<string, string>
}) {
  const opacity = dim ? 0.35 : 1
  // Loop rectangle (world coords for this sub-scene).
  const L = x + 40
  const R = x + width - 40
  const T = y + 24
  const B = y + height - 20
  const mid = (L + R) / 2
  const stroke = '#54617A'
  const active = E > 0 && (R1 + R2) > 0
  const flowColor = active ? '#37C9B8' : stroke

  // Positions on loop:
  //  Left arm (top-left → bottom-left): battery E (label near mid-left)
  //  Top arm: R1
  //  Right arm: R2 with voltmeter across (V) tapping top-right node ↔ bottom-right node
  //  Bottom arm: return wire

  return (
    <g opacity={opacity}>
      {/* Loop wires */}
      <line x1={L} y1={T} x2={mid - 30} y2={T} stroke={flowColor} strokeWidth={2} />
      <line x1={mid + 30} y1={T} x2={R} y2={T} stroke={flowColor} strokeWidth={2} />
      <line x1={R} y1={T} x2={R} y2={(T + B) / 2 - 22} stroke={flowColor} strokeWidth={2} />
      <line x1={R} y1={(T + B) / 2 + 22} x2={R} y2={B} stroke={flowColor} strokeWidth={2} />
      <line x1={R} y1={B} x2={L} y2={B} stroke={flowColor} strokeWidth={2} />
      <line x1={L} y1={B} x2={L} y2={(T + B) / 2 + 14} stroke={flowColor} strokeWidth={2} />
      <line x1={L} y1={(T + B) / 2 - 14} x2={L} y2={T} stroke={flowColor} strokeWidth={2} />

      {/* Battery on left arm — plates at mid-left */}
      <BatterySymbol cx={L} cy={(T + B) / 2} orient="v" />
      <text x={L - 30} y={(T + B) / 2 + 4} fill="#F9A968" fontFamily="'JetBrains Mono', monospace" fontSize={11} textAnchor="end">
        E={E.toFixed(1)}V
      </text>

      {/* R1 on top arm */}
      <ResistorSymbol cx={mid} cy={T} orient="h" />
      <text x={mid} y={T - 18} fill="#8AB3FF" fontFamily="'JetBrains Mono', monospace" fontSize={11} textAnchor="middle">
        {labels.label_R1}={hideR1Value ? labels.hidden : `${R1}Ω`}
      </text>

      {/* R2 on right arm */}
      <ResistorSymbol cx={R} cy={(T + B) / 2} orient="v" />
      <text x={R + 10} y={(T + B) / 2 + 4} fill="#8AB3FF" fontFamily="'JetBrains Mono', monospace" fontSize={11}>
        {labels.label_R2}={R2}Ω
      </text>

      {/* Voltmeter across R2 — small circle to the right of R2 */}
      <g transform={`translate(${R + 50}, ${(T + B) / 2})`}>
        <line x1={-20} y1={-22} x2={-20} y2={0} stroke={stroke} strokeWidth={1.2} />
        <line x1={-20} y1={0} x2={-8} y2={0} stroke={stroke} strokeWidth={1.2} />
        <line x1={-20} y1={22} x2={-20} y2={0} stroke={stroke} strokeWidth={1.2} />
        <circle cx={0} cy={0} r={11} fill="#131F35" stroke={stroke} strokeWidth={1.4} />
        <text x={0} y={4} fill="#B9C4D6" fontFamily="'JetBrains Mono', monospace" fontSize={11} textAnchor="middle">V</text>
        {/* Reading */}
        {!hideReading ? (
          <text x={0} y={-16} fill="#37C9B8" fontFamily="'JetBrains Mono', monospace" fontSize={11} textAnchor="middle">
            {U2.toFixed(2)}V
          </text>
        ) : (
          <text x={0} y={-16} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={11} textAnchor="middle">
            ?
          </text>
        )}
      </g>
    </g>
  )
}

// ─── Current-divider schematic (parallel branches) ────────────────────
function CurrentDividerDiagram({
  x, y, width, height, I, R1, R2, I1, hideReading, hideR1Value, dim, labels,
}: {
  x: number; y: number; width: number; height: number
  I: number; R1: number; R2: number; I1: number
  hideReading: boolean; hideR1Value: boolean; dim: boolean
  labels: Record<string, string>
}) {
  const opacity = dim ? 0.35 : 1
  const L = x + 40
  const R = x + width - 40
  const T = y + 24
  const B = y + height - 20
  const midY = (T + B) / 2
  const stroke = '#54617A'
  const active = I > 0 && (R1 + R2) > 0
  const flowColor = active ? '#F9A968' : stroke

  // Current source on left, two horizontal branches (R1 top, R2 bottom) meeting on the right.
  return (
    <g opacity={opacity}>
      {/* Current source on left */}
      <g transform={`translate(${L}, ${midY})`}>
        <circle cx={0} cy={0} r={13} fill="#131F35" stroke={stroke} strokeWidth={1.4} />
        <line x1={0} y1={8} x2={0} y2={-6} stroke={flowColor} strokeWidth={1.6} />
        <polygon points="-3,-6 3,-6 0,-11" fill={flowColor} />
        <text x={-24} y={4} fill="#F9A968" fontFamily="'JetBrains Mono', monospace" fontSize={11} textAnchor="end">
          I={I.toFixed(0)}mA
        </text>
      </g>

      {/* Wires from source to top node (T) and to bottom node (B) — via left rail */}
      <line x1={L} y1={-13 + midY} x2={L} y2={T} stroke={flowColor} strokeWidth={2} />
      <line x1={L} y1={13 + midY} x2={L} y2={B} stroke={flowColor} strokeWidth={2} />

      {/* Top branch: L → R1 → R (with ammeter A1 in series) */}
      <line x1={L} y1={T} x2={(L + R) / 2 - 42} y2={T} stroke={flowColor} strokeWidth={2} />
      <ResistorSymbol cx={(L + R) / 2 - 10} cy={T} orient="h" />
      <text x={(L + R) / 2 - 10} y={T - 18} fill="#8AB3FF" fontFamily="'JetBrains Mono', monospace" fontSize={11} textAnchor="middle">
        {labels.label_R1}={hideR1Value ? labels.hidden : `${R1}Ω`}
      </text>
      {/* Ammeter A1 to the right of R1 */}
      <line x1={(L + R) / 2 + 22} y1={T} x2={(L + R) / 2 + 42} y2={T} stroke={flowColor} strokeWidth={2} />
      <g transform={`translate(${(L + R) / 2 + 54}, ${T})`}>
        <circle cx={0} cy={0} r={11} fill="#131F35" stroke={stroke} strokeWidth={1.4} />
        <text x={0} y={4} fill="#B9C4D6" fontFamily="'JetBrains Mono', monospace" fontSize={11} textAnchor="middle">A</text>
        {!hideReading ? (
          <text x={0} y={-16} fill="#F9A968" fontFamily="'JetBrains Mono', monospace" fontSize={11} textAnchor="middle">
            {I1.toFixed(1)}mA
          </text>
        ) : (
          <text x={0} y={-16} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={11} textAnchor="middle">
            ?
          </text>
        )}
      </g>
      <line x1={(L + R) / 2 + 66} y1={T} x2={R} y2={T} stroke={flowColor} strokeWidth={2} />

      {/* Bottom branch: L → R2 → R */}
      <line x1={L} y1={B} x2={(L + R) / 2 - 22} y2={B} stroke={flowColor} strokeWidth={2} />
      <ResistorSymbol cx={(L + R) / 2} cy={B} orient="h" />
      <text x={(L + R) / 2} y={B + 22} fill="#8AB3FF" fontFamily="'JetBrains Mono', monospace" fontSize={11} textAnchor="middle">
        {labels.label_R2}={R2}Ω
      </text>
      <line x1={(L + R) / 2 + 22} y1={B} x2={R} y2={B} stroke={flowColor} strokeWidth={2} />

      {/* Right rail joining the two branches */}
      <line x1={R} y1={T} x2={R} y2={B} stroke={flowColor} strokeWidth={2} />

      {/* Node dots at junctions */}
      <circle cx={L} cy={T} r={3} fill="#B9C4D6" />
      <circle cx={L} cy={B} r={3} fill="#B9C4D6" />
      <circle cx={R} cy={T} r={3} fill="#B9C4D6" />
      <circle cx={R} cy={B} r={3} fill="#B9C4D6" />
    </g>
  )
}

// ─── Component art (inlined) ──────────────────────────────────────────
function BatterySymbol({ cx, cy, orient }: { cx: number; cy: number; orient: 'h' | 'v' }) {
  const rot = orient === 'v' ? 90 : 0
  return (
    <g transform={`translate(${cx}, ${cy}) rotate(${rot})`}>
      <line x1={-14} y1={0} x2={-4} y2={0} stroke="#54617A" strokeWidth={2} />
      <line x1={4} y1={0} x2={14} y2={0} stroke="#54617A" strokeWidth={2} />
      <line x1={-4} y1={-12} x2={-4} y2={12} stroke="#B9C4D6" strokeWidth={2} />
      <line x1={4} y1={-8} x2={4} y2={8} stroke="#B9C4D6" strokeWidth={5} />
    </g>
  )
}

function ResistorSymbol({ cx, cy, orient }: { cx: number; cy: number; orient: 'h' | 'v' }) {
  const rot = orient === 'v' ? 90 : 0
  return (
    <g transform={`translate(${cx}, ${cy}) rotate(${rot})`}>
      <line x1={-22} y1={0} x2={-14} y2={0} stroke="#54617A" strokeWidth={2} />
      <line x1={14} y1={0} x2={22} y2={0} stroke="#54617A" strokeWidth={2} />
      <rect x={-14} y={-6} width={28} height={12} fill="#131F35" stroke="#54617A" strokeWidth={1.2} rx={2} />
    </g>
  )
}
