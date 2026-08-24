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
import { BatterySymbol } from './art/Battery'
import { SwitchSymbol } from './art/Switch'
import { ResistorSymbol } from './art/Resistor'
import { AmmeterSymbol } from './art/Ammeter'
import { VoltmeterBubble } from './art/Voltmeter'

// ─── Scene constants ────────────────────────────────────────
const W = 800
const H = 450

// Rectangular loop. Top = battery, right = switch, bottom = ammeter, left = resistor.
const LOOP_LEFT = 200
const LOOP_RIGHT = 500
const LOOP_TOP = 180
const LOOP_BOTTOM = 360

const BATTERY = { x: (LOOP_LEFT + LOOP_RIGHT) / 2, y: LOOP_TOP, orient: 'h' as const }
const SWITCH = { x: LOOP_RIGHT, y: (LOOP_TOP + LOOP_BOTTOM) / 2, orient: 'v' as const }
const AMMETER = { x: (LOOP_LEFT + LOOP_RIGHT) / 2, y: LOOP_BOTTOM, orient: 'h' as const }
const RESISTOR = { x: LOOP_LEFT, y: (LOOP_TOP + LOOP_BOTTOM) / 2, orient: 'v' as const }

// Voltmeter parallel-branch pickup points on the resistor stubs
const V_TOP_Y = RESISTOR.y - 32
const V_BOT_Y = RESISTOR.y + 32
const V_BUBBLE_X = 105
const V_BUBBLE_Y = (V_TOP_Y + V_BOT_Y) / 2

// Slider ranges
const E_MIN = 1
const E_MAX = 30
const E_STEP = 1
const R_MIN = 1
const R_MAX = 100
const R_STEP = 1
const DT_MIN = 0
const DT_MAX = 300
const DT_STEP = 1

// ─── Scenarios (hand-authored; seed picks starting index) ───
// Each scenario: E (V), target power P (W). Answer R = E² / P (Ω, integer).
type Scenario = { E: number; P: number; R: number }
const SCENARIOS: Scenario[] = [
  { E: 12, P: 6, R: 24 },
  { E: 6, P: 3, R: 12 },
  { E: 24, P: 48, R: 12 },
  { E: 12, P: 36, R: 4 },
  { E: 10, P: 5, R: 20 },
]

// Stage 2 targets (2 seeded-picked sets of 2). Each requires E and R match.
type Target = { E: number; P: number; R: number }
const STAGE2_SETS: Target[][] = [
  [
    { E: 12, P: 6, R: 24 },
    { E: 6, P: 3, R: 12 },
  ],
  [
    { E: 10, P: 5, R: 20 },
    { E: 12, P: 36, R: 4 },
  ],
  [
    { E: 24, P: 48, R: 12 },
    { E: 6, P: 12, R: 3 },
  ],
]

// Tolerance for readouts and slider-based comparisons (fractional, both sides).
const TOL = 0.05

// ─── Physics — pure functions, all top-level ─────────────────
// Test: E=12, R=24 → I = 0.5 A, U = 12 V, P = 6 W ✓
// Test: E=6,  R=12 → I = 0.5 A, U = 6 V,  P = 3 W ✓
function solve(E: number, R: number): { I: number; U: number; P: number } {
  if (R <= 0) return { I: 0, U: 0, P: 0 }
  const I = E / R
  const U = R * I // = E for a pure-resistor loop with no internal r
  const P = U * I
  return { I, U, P }
}

function within(x: number, target: number, tol = TOL): boolean {
  if (target === 0) return Math.abs(x) < tol
  return Math.abs(x - target) / Math.abs(target) < tol
}

// Format helpers
function fmt(n: number, digits = 2): string {
  if (!isFinite(n)) return '—'
  return n.toFixed(digits)
}
function fmtCurrent(I: number, labels: Record<string, string>): string {
  if (I >= 1) return `${fmt(I, 2)} ${labels.unit_A}`
  return `${fmt(I * 1000, 0)} ${labels.unit_mA}`
}

// ─── Locale ─────────────────────────────────────────────────
const dict = { en } as const
type Locale = keyof typeof dict
function svgLabels(locale: string): Record<string, string> {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels as Record<string, string>
}

// ─── Component ──────────────────────────────────────────────
export default function Scene() {
  const { locale, seed } = useInit()
  const stages = useMemo(() => getStagesFor(locale), [locale])
  useDeclareStages(stages)
  const labels = useMemo(() => svgLabels(locale), [locale])

  const stageIdx = useCurrentStage()
  const setStage = useSetStage()
  const complete = useComplete()
  const progress = useProgress()

  // Seed-picked stage-2 target set
  const stage2Targets = useMemo(
    () => STAGE2_SETS[seed % STAGE2_SETS.length]!,
    [seed],
  )

  // ─── Slider + switch state ────────────────────────────────
  const [E, setE] = useState(12)
  const [R, setR] = useState(50)
  const [dt, setDt] = useState(60)
  const [switchClosed, setSwitchClosed] = useState(false)

  // ─── Stage-1 coverage tracking ────────────────────────────
  const [visitedE, setVisitedE] = useState<Set<number>>(new Set())
  const [visitedR, setVisitedR] = useState<Set<number>>(new Set())
  const [sawPower, setSawPower] = useState(false)

  // ─── Stage-2 target tracking ──────────────────────────────
  const [hitTargets, setHitTargets] = useState<Set<number>>(new Set())

  // ─── Stage-3 blind state ──────────────────────────────────
  const [scenarioIdx, setScenarioIdx] = useState(0) // relative to seed rotation
  const [attemptsLeft, setAttemptsLeft] = useState(3)
  const [correctStreak, setCorrectStreak] = useState(0)
  const [submitted, setSubmitted] = useState(false)
  const [lastCorrect, setLastCorrect] = useState<boolean | null>(null)
  const [peekText, setPeekText] = useState<string | null>(null)

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  const scenario = useMemo(
    () => SCENARIOS[(seed + scenarioIdx) % SCENARIOS.length]!,
    [seed, scenarioIdx],
  )

  // Live-solved circuit values (used for stages 1+2 live display).
  const solved = useMemo(() => solve(E, R), [E, R])
  const currentFlowing = switchClosed && solved.I > 0

  // ─── Stage-1 coverage side-effects ─────────────────────────
  useEffect(() => {
    if (!isStage1) return
    setVisitedE((prev) => (prev.has(E) ? prev : new Set(prev).add(E)))
  }, [isStage1, E])
  useEffect(() => {
    if (!isStage1) return
    setVisitedR((prev) => (prev.has(R) ? prev : new Set(prev).add(R)))
  }, [isStage1, R])
  useEffect(() => {
    if (!isStage1) return
    if (currentFlowing && solved.P > 0 && !sawPower) setSawPower(true)
  }, [isStage1, currentFlowing, solved.P, sawPower])

  // ─── Stage-2 target hit tracking ──────────────────────────
  useEffect(() => {
    if (!isStage2 || !currentFlowing) return
    for (let i = 0; i < stage2Targets.length; i++) {
      if (hitTargets.has(i)) continue
      const t = stage2Targets[i]!
      if (within(E, t.E) && within(solved.P, t.P)) {
        setHitTargets((prev) => new Set(prev).add(i))
      }
    }
  }, [isStage2, currentFlowing, E, solved.P, stage2Targets, hitTargets])

  // ─── Stage-3 scenario initialization ──────────────────────
  // Snap E to scenario.E on stage-3 entry; disable the E slider on this stage.
  useEffect(() => {
    if (!isStage3) return
    setE(scenario.E)
    // Do NOT reset R here — student is expected to set it. Keep as-is or default 50.
  }, [isStage3, scenario.E])

  // ─── Advance predicates ───────────────────────────────────
  const stage1Done = visitedE.size >= 2 && visitedR.size >= 2 && sawPower
  const stage2Done = hitTargets.size >= stage2Targets.length
  const stage3Done = correctStreak >= 3

  const canSubmit = isStage1 ? stage1Done : isStage2 ? stage2Done : stage3Done

  // ─── Reset ────────────────────────────────────────────────
  const resetStageState = useCallback(() => {
    setE(12)
    setR(50)
    setDt(60)
    setSwitchClosed(false)
    setVisitedE(new Set())
    setVisitedR(new Set())
    setSawPower(false)
    setHitTargets(new Set())
    setScenarioIdx(0)
    setAttemptsLeft(3)
    setCorrectStreak(0)
    setSubmitted(false)
    setLastCorrect(null)
    setPeekText(null)
  }, [])
  useReset(resetStageState)

  useEffect(() => {
    progress(stageIdx / stages.length, { stage: stageIdx, canSubmit })
  }, [stageIdx, canSubmit, stages.length, progress])

  useNext(() => {
    if (stageIdx < stages.length) {
      setStage(stageIdx + 1)
      resetStageState()
    } else {
      complete({ success: true })
    }
  })

  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  // ─── Peek (stage 3 only, text-only strategy hint) ─────────
  usePeek(() => {
    if (!isStage3) return
    setPeekText(labels.peek_tip ?? labels.tip3 ?? '')
  })
  useEffect(() => {
    if (!peekText) return
    const t = setTimeout(() => setPeekText(null), 4500)
    return () => clearTimeout(t)
  }, [peekText])

  // ─── Stage-3 submit: closing the switch commits R and reveals meters ─
  const submitStage3 = useCallback(() => {
    const correct = within(R, scenario.R)
    setSubmitted(true)
    setLastCorrect(correct)
    if (correct) {
      // Correct: consume this scenario, advance to next, refill attempts.
      // Wait a moment so student sees the reveal + green ring before scenario flips.
      setTimeout(() => {
        setCorrectStreak((s) => s + 1)
        setScenarioIdx((i) => i + 1)
        setAttemptsLeft(3)
        setSubmitted(false)
        setLastCorrect(null)
        setSwitchClosed(false)
      }, 1400)
    } else {
      // Wrong: decrement attempt budget.
      setTimeout(() => {
        setAttemptsLeft((n) => {
          const next = n - 1
          if (next <= 0) {
            // Budget exhausted: reset streak, rotate scenario, refill budget.
            setCorrectStreak(0)
            setScenarioIdx((i) => i + 1)
            setSubmitted(false)
            setLastCorrect(null)
            setSwitchClosed(false)
            return 3
          }
          // Retry same scenario: hide meters again, re-open the switch.
          setSubmitted(false)
          setLastCorrect(null)
          setSwitchClosed(false)
          return next
        })
      }, 1400)
    }
  }, [R, scenario.R])

  // ─── Switch click handler ─────────────────────────────────
  const onSwitchClick = useCallback(() => {
    if (isStage3) {
      // On stage 3, closing the switch = submit.
      if (submitted) return // ignore while feedback is showing
      if (!switchClosed) {
        setSwitchClosed(true)
        submitStage3()
      } else {
        setSwitchClosed(false)
      }
      return
    }
    // Stages 1 & 2: normal toggle
    setSwitchClosed((v) => !v)
  }, [isStage3, switchClosed, submitted, submitStage3])

  // ─── Meter readings (hidden on stage 3 pre-submit) ────────
  const metersHidden = isStage3 && !submitted
  const showAmmeter = switchClosed && solved.I > 0
  const ammeterReading = showAmmeter ? fmtCurrent(solved.I, labels) : ''
  const voltmeterReading = showAmmeter ? `${fmt(solved.U, 2)} ${labels.unit_V}` : ''

  // ─── HUD text ─────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`

  let hudTR = ''
  if (isStage1) {
    const cE = visitedE.size >= 2 ? '✓' : '·'
    const cR = visitedR.size >= 2 ? '✓' : '·'
    const cP = sawPower ? '✓' : '·'
    hudTR = `${cE} ${labels.coverage_E}  ${cR} ${labels.coverage_R}  ${cP} ${labels.coverage_P}`
  } else if (isStage2) {
    hudTR = `${labels.targets}: ${hitTargets.size}/${stage2Targets.length}`
  } else {
    // Stage 3: scenarios + attempts
    if (submitted && lastCorrect === true) {
      hudTR = labels.correct ?? 'correct'
    } else if (submitted && lastCorrect === false) {
      hudTR = `${labels.wrong}  ·  ${labels.attempts_left}: ${attemptsLeft - 1 < 0 ? 0 : attemptsLeft - 1}`
    } else {
      hudTR = `${labels.scenarios}: ${correctStreak}/3  ·  ${labels.attempts_left}: ${attemptsLeft}`
    }
  }

  const hudBL = isStage3
    ? (peekText ?? labels.tip3)
    : isStage1
      ? labels.tip1
      : labels.tip2

  // ─── Rendering ────────────────────────────────────────────
  const eSliderDisabled = isStage3

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block', userSelect: 'none', touchAction: 'none' }}
      >
        {/* Full-canvas background — no rx */}
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        {/* Schematic panel */}
        <rect x={32} y={60} width={560} height={358} fill="none" stroke="#12203a" strokeWidth={1} rx={6} />
        <text x={40} y={52} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={11} letterSpacing="0.1em">
          {labels.schematic}
        </text>

        {/* Controls panel */}
        <rect x={608} y={60} width={160} height={358} fill="none" stroke="#12203a" strokeWidth={1} rx={6} />
        <text x={616} y={52} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={11} letterSpacing="0.1em">
          {labels.controls}
        </text>

        {/* Loop wires (structural) — with a break in the top segment where the battery sits, etc. */}
        <g>
          {/* Corner dots */}
          {[
            [LOOP_LEFT, LOOP_TOP], [LOOP_RIGHT, LOOP_TOP],
            [LOOP_RIGHT, LOOP_BOTTOM], [LOOP_LEFT, LOOP_BOTTOM],
          ].map(([x, y], i) => (
            <circle key={`c${i}`} cx={x} cy={y} r={2.5} fill="#3A4863" />
          ))}
          {/* Top segments (around battery) */}
          <line x1={LOOP_LEFT} y1={LOOP_TOP} x2={BATTERY.x - 32} y2={LOOP_TOP} stroke="#3A4863" strokeWidth={2} />
          <line x1={BATTERY.x + 32} y1={LOOP_TOP} x2={LOOP_RIGHT} y2={LOOP_TOP} stroke="#3A4863" strokeWidth={2} />
          {/* Right segments (around switch) */}
          <line x1={LOOP_RIGHT} y1={LOOP_TOP} x2={LOOP_RIGHT} y2={SWITCH.y - 32} stroke="#3A4863" strokeWidth={2} />
          <line x1={LOOP_RIGHT} y1={SWITCH.y + 32} x2={LOOP_RIGHT} y2={LOOP_BOTTOM} stroke="#3A4863" strokeWidth={2} />
          {/* Bottom segments (around ammeter) */}
          <line x1={LOOP_LEFT} y1={LOOP_BOTTOM} x2={AMMETER.x - 32} y2={LOOP_BOTTOM} stroke="#3A4863" strokeWidth={2} />
          <line x1={AMMETER.x + 32} y1={LOOP_BOTTOM} x2={LOOP_RIGHT} y2={LOOP_BOTTOM} stroke="#3A4863" strokeWidth={2} />
          {/* Left segments (around resistor) */}
          <line x1={LOOP_LEFT} y1={LOOP_TOP} x2={LOOP_LEFT} y2={RESISTOR.y - 32} stroke="#3A4863" strokeWidth={2} />
          <line x1={LOOP_LEFT} y1={RESISTOR.y + 32} x2={LOOP_LEFT} y2={LOOP_BOTTOM} stroke="#3A4863" strokeWidth={2} />
        </g>

        {/* Voltmeter across R (parallel branch, dashed) */}
        <VoltmeterBubble
          resistorX={LOOP_LEFT}
          topY={V_TOP_Y}
          botY={V_BOT_Y}
          bubbleX={V_BUBBLE_X}
          bubbleY={V_BUBBLE_Y}
          reading={voltmeterReading}
          hidden={metersHidden}
        />

        {/* Battery */}
        <g transform={`translate(${BATTERY.x}, ${BATTERY.y})`}>
          <BatterySymbol />
          <text x={0} y={26} fill="#B9C4D6" fontFamily="'JetBrains Mono', monospace" fontSize={11} textAnchor="middle">
            {`E = ${fmt(E, 0)} ${labels.unit_V}`}
          </text>
        </g>

        {/* Switch (right side, vertical) */}
        <g
          transform={`translate(${SWITCH.x}, ${SWITCH.y}) rotate(90)`}
          style={{ cursor: submitted ? 'default' : 'pointer' }}
          onClick={onSwitchClick}
        >
          <SwitchSymbol closed={switchClosed} />
        </g>

        {/* Ammeter (bottom, horizontal, in series) */}
        <g transform={`translate(${AMMETER.x}, ${AMMETER.y})`}>
          <AmmeterSymbol reading={ammeterReading} hidden={metersHidden} />
        </g>

        {/* Resistor (left side, vertical) */}
        <g transform={`translate(${RESISTOR.x}, ${RESISTOR.y}) rotate(90)`}>
          <ResistorSymbol active={currentFlowing} />
        </g>
        {/* R value label — placed to the RIGHT of the vertical resistor (inside the loop) */}
        <text
          x={RESISTOR.x + 22}
          y={RESISTOR.y + 4}
          fill="#B9C4D6"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={11}
          textAnchor="start"
        >
          {`= ${fmt(R, 0)} ${labels.unit_ohm}`}
        </text>

        {/* Current-flow animation (stages 1 & 2 only) */}
        {currentFlowing && !isStage3 && (
          <g>
            <path
              id="flow-path-pee"
              d={`M ${LOOP_LEFT} ${LOOP_TOP} L ${LOOP_RIGHT} ${LOOP_TOP} L ${LOOP_RIGHT} ${LOOP_BOTTOM} L ${LOOP_LEFT} ${LOOP_BOTTOM} Z`}
              fill="none"
              stroke="none"
            />
            {[0, 0.5, 1.0, 1.5].map((delay) => (
              <circle key={`f${delay}`} r={2.5} fill="#37C9B8">
                <animateMotion dur="2s" repeatCount="indefinite" begin={`${delay}s`}>
                  <mpath href="#flow-path-pee" />
                </animateMotion>
              </circle>
            ))}
          </g>
        )}

        {/* Live formula strip — stages 1 & 2 only (help, hidden on stage 3) */}
        {!isStage3 && (
          <g>
            <text
              x={40}
              y={392}
              fill={currentFlowing ? '#37C9B8' : '#6C7A93'}
              fontFamily="'JetBrains Mono', monospace"
              fontSize={12}
            >
              {currentFlowing
                ? `P = U·I = ${fmt(solved.U, 2)} · ${fmt(solved.I, 3)} = ${fmt(solved.P, 2)} ${labels.unit_W}`
                : `P = U·I    (${labels.reveal_hint})`}
            </text>
            <text
              x={40}
              y={410}
              fill={currentFlowing && dt > 0 ? '#B9C4D6' : '#6C7A93'}
              fontFamily="'JetBrains Mono', monospace"
              fontSize={11}
            >
              {currentFlowing && dt > 0
                ? `W = P·Δt = ${fmt(solved.P, 2)} · ${dt} = ${fmt(solved.P * dt, 1)} ${labels.unit_J}`
                : `W = P·Δt`}
            </text>
          </g>
        )}

        {/* Stage-2 target chips */}
        {isStage2 && (
          <g>
            {stage2Targets.map((t, i) => {
              const yy = 80 + i * 34
              const hit = hitTargets.has(i)
              return (
                <g key={`t${i}`} transform={`translate(40, ${yy})`}>
                  <rect
                    x={0}
                    y={0}
                    width={230}
                    height={26}
                    fill={hit ? '#0F2A26' : '#131F35'}
                    stroke={hit ? '#37C9B8' : '#3A4863'}
                    strokeWidth={1}
                    rx={4}
                  />
                  <text
                    x={10}
                    y={17}
                    fill={hit ? '#37C9B8' : '#B9C4D6'}
                    fontFamily="'JetBrains Mono', monospace"
                    fontSize={11}
                  >
                    {`${hit ? '✓' : '·'} ${labels.target_label} ${i + 1}: E = ${t.E} ${labels.unit_V}, P = ${t.P} ${labels.unit_W}`}
                  </text>
                </g>
              )
            })}
          </g>
        )}

        {/* Stage-3 scenario chip */}
        {isStage3 && (
          <g transform="translate(40, 80)">
            <rect
              x={0}
              y={0}
              width={260}
              height={44}
              fill="#131F35"
              stroke={submitted && lastCorrect === true ? '#37C9B8' : submitted && lastCorrect === false ? '#EF4444' : '#3A4863'}
              strokeWidth={1.4}
              rx={4}
            />
            <text
              x={10}
              y={18}
              fill="#6C7A93"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
              letterSpacing="0.14em"
            >
              {`${(labels.target_label ?? 'target').toUpperCase()} · ${correctStreak + 1}/3`}
            </text>
            <text
              x={10}
              y={36}
              fill="#B9C4D6"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={13}
            >
              {`E = ${scenario.E} ${labels.unit_V}   P = ${scenario.P} ${labels.unit_W}`}
            </text>
          </g>
        )}

        {/* Sliders — HTML via foreignObject */}
        <foreignObject x={618} y={80} width={140} height={340}>
          <div
            /* @ts-expect-error xmlns is a valid attribute for embedded XHTML */
            xmlns="http://www.w3.org/1999/xhtml"
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              fontFamily: "'JetBrains Mono', monospace",
              color: '#B9C4D6',
              fontSize: 11,
            }}
          >
            <SliderBlock
              label={`${labels.slider_E} = ${E} ${labels.unit_V}`}
              min={E_MIN}
              max={E_MAX}
              step={E_STEP}
              value={E}
              onChange={setE}
              disabled={eSliderDisabled}
            />
            <SliderBlock
              label={`${labels.slider_R} = ${R} ${labels.unit_ohm}`}
              min={R_MIN}
              max={R_MAX}
              step={R_STEP}
              value={R}
              onChange={setR}
              disabled={isStage3 && submitted}
            />
            {!isStage3 && (
              <SliderBlock
                label={`${labels.slider_dt} = ${dt} ${labels.unit_s}`}
                min={DT_MIN}
                max={DT_MAX}
                step={DT_STEP}
                value={dt}
                onChange={setDt}
                disabled={false}
              />
            )}
          </div>
        </foreignObject>

        {/* Stage-3 post-submit rings around the R value area */}
        {isStage3 && submitted && (
          <g transform={`translate(${RESISTOR.x}, ${RESISTOR.y})`}>
            <circle
              cx={0}
              cy={0}
              r={38}
              fill="none"
              stroke={lastCorrect ? '#37C9B8' : '#EF4444'}
              strokeWidth={2}
              opacity={0.9}
            />
          </g>
        )}
      </svg>

      {/* HUD overlays — HTML in rem */}
      <div style={{ position: 'absolute', top: '3rem', left: '3rem', fontFamily: "'JetBrains Mono', monospace", fontSize: '2.3rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: '#6C7A93', zIndex: 5, pointerEvents: 'none' }}>
        {hudTL}
      </div>
      <div style={{ position: 'absolute', top: '3rem', right: '3rem', fontFamily: "'JetBrains Mono', monospace", fontSize: '1.5rem', letterSpacing: '0.08em', color: canSubmit ? '#37C9B8' : '#B9C4D6', zIndex: 5, pointerEvents: 'none', textAlign: 'right', maxWidth: '40%' }}>
        {hudTR}
      </div>
      <div style={{ position: 'absolute', bottom: '3rem', left: '3rem', fontFamily: "'JetBrains Mono', monospace", fontSize: '1.5rem', letterSpacing: '0.06em', color: '#6C7A93', zIndex: 5, pointerEvents: 'none', maxWidth: '58%' }}>
        {hudBL}
      </div>
      {/* BR reserved for parent chrome (§4.3) — intentionally empty */}
    </div>
  )
}

// ─── SliderBlock (HTML inside foreignObject) ───────────────────
function SliderBlock({
  label,
  min,
  max,
  step,
  value,
  onChange,
  disabled,
}: {
  label: string
  min: number
  max: number
  step: number
  value: number
  onChange: (v: number) => void
  disabled: boolean
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ opacity: disabled ? 0.55 : 1, fontSize: 12 }}>{label}</div>
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
          accentColor: '#37C9B8',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.4 : 1,
        }}
      />
    </div>
  )
}
