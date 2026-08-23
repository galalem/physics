import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  useComplete,
  useCurrentStage,
  useDeclareStages,
  useHint,
  useInit,
  useNext,
  useProgress,
  useReset,
  useSeed,
  useSetStage,
} from '@physics/sdk/react'
import { getHintFor, getStagesFor } from './stages'
import en from '../i18n/en.json'
import fr from '../i18n/fr.json'
import ar from '../i18n/ar.json'

// ─── Scene constants ────────────────────────────────────────────────────
const W = 800
const H = 450

// Balance geometry
const FULCRUM_X = 260
const FULCRUM_Y = 240
const BEAM_HALF = 150
const BEAM_MAX_TILT_DEG = 12
const PAN_DROP = 70

// Balance mechanic
const BALANCE_TOL = 0.001 // grams — floating-point safety margin

// Sample bank (stage 1: only sample 0 usable; stage 2: cycle all three)
type Sample = { id: string; label: string; mass_g: number }
const SAMPLES: Sample[] = [
  { id: 's1', label: 'A', mass_g: 125 },
  { id: 's2', label: 'B', mass_g: 342 },
  { id: 's3', label: 'C', mass_g: 78 },
]

// Standard mass bank (grams). Sorted large-first for visual stacking.
const STANDARDS_G = [500, 200, 100, 50, 20, 10, 5, 2, 1] as const

// ─── Domain model: unit-conversion for stage 3 ──────────────────────────
type Unit = 'mg' | 'g' | 'kg' | 't'
const UNIT_ORDER: Unit[] = ['mg', 'g', 'kg', 't']

/** Convert a value from `from` unit into `to` unit — pure, deterministic. */
function convert(value: number, from: Unit, to: Unit): number {
  const fromIdx = UNIT_ORDER.indexOf(from)
  const toIdx = UNIT_ORDER.indexOf(to)
  const steps = fromIdx - toIdx // + means source-unit is smaller → divide by 1000^steps
  return value * Math.pow(1000, steps)
}

/** Format a mass value with unit — trim trailing zeros for readability. */
function fmt(value: number, unit: Unit): string {
  const abs = Math.abs(value)
  let str: string
  if (abs >= 1 && abs < 1_000_000) {
    // Whole or few decimals
    str = Number(value.toPrecision(10)).toString()
  } else {
    str = value.toString()
  }
  return `${str} ${unit}`
}

type Scenario = {
  value: number
  from: Unit
  to: Unit
  /** Three MCQ options, always includes the correct answer at `correctIdx`. */
  options: number[]
  correctIdx: number
}

/** Build 3 options for a scenario: the correct answer + 2 common-mistake distractors. */
function buildScenario(value: number, from: Unit, to: Unit): Scenario {
  const correct = convert(value, from, to)
  const fromIdx = UNIT_ORDER.indexOf(from)
  const toIdx = UNIT_ORDER.indexOf(to)
  const stepsSigned = fromIdx - toIdx
  // Distractor 1: student moved the decimal ONE step short (missed a factor of 1000)
  const shortSteps = stepsSigned + Math.sign(stepsSigned) * -1
  const short = value * Math.pow(1000, shortSteps)
  // Distractor 2: student went the wrong direction (multiplied where they should divide)
  const wrongDir = value * Math.pow(1000, -stepsSigned)
  // Assemble in a fixed slot order [correct, short, wrongDir]; picker will place by index.
  const raw = [correct, short, wrongDir]
  // Deduplicate: if a distractor equals the correct value (edge case), replace with x10.
  const seen = new Set<number>()
  const options = raw.map((v) => {
    let picked = v
    while (seen.has(picked)) picked = picked * 10
    seen.add(picked)
    return picked
  })
  return { value, from, to, options, correctIdx: 0 }
}

// Enumerate distinct case-classes so streak-of-4 cannot be brute-forced.
// 8 scenarios covering all four units as both source and target, up + down.
const PREDICT_DECK: Scenario[] = [
  buildScenario(500, 'g', 'kg'),        // 0.5
  buildScenario(2.5, 'kg', 'g'),         // 2500
  buildScenario(1500, 'mg', 'g'),        // 1.5
  buildScenario(0.75, 't', 'kg'),        // 750
  buildScenario(3, 'kg', 'mg'),          // 3_000_000
  buildScenario(250, 'g', 'kg'),         // 0.25
  buildScenario(0.02, 't', 'g'),         // 20_000
  buildScenario(4000, 'mg', 'g'),        // 4
]
const PREDICT_TARGET = 4

// ─── Label loader (locale → SVG labels only) ────────────────────────────
const dict = { en, fr, ar } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── Component ──────────────────────────────────────────────────────────
export default function Scene() {
  const { locale } = useInit()
  const stages = useMemo(() => getStagesFor(locale), [locale])
  useDeclareStages(stages)
  const labels = useMemo(() => svgLabels(locale), [locale])
  const rootRng = useSeed()

  // Seeded shuffles — deck order + option shuffle per scenario.
  const deck = useMemo(() => rootRng.shuffle(PREDICT_DECK), [rootRng])
  // For each scenario in the deck, pre-shuffle a mapping of [correct, short, wrongDir]
  // to display slots [0,1,2]. Deterministic per seed.
  const optionOrder = useMemo(
    () => deck.map(() => rootRng.shuffle([0, 1, 2])),
    [deck, rootRng],
  )

  const stageIdx = useCurrentStage()
  const setStage = useSetStage()
  const progress = useProgress()
  const complete = useComplete()

  // Stage roles:
  //   1 = Observe: sample fixed, add/remove standards, must witness 3 tilt states.
  //   2 = Experiment: sample cycles, must balance 3 different samples in a row of
  //       distinct-samples-set membership.
  //   3 = Predict: unit-conversion MCQ, streak-with-reset.
  const isObserve = stageIdx === 1
  const isExperiment = stageIdx === 2
  const isInteractive = isObserve || isExperiment
  const isPredict = stageIdx === 3

  // ─── Interactive state ─────────────────────────────────────
  const [sampleIdx, setSampleIdx] = useState(0)
  // Right pan holds a multiset of standard-mass indices (index into STANDARDS_G).
  // We track counts per denomination (there is an effectively unlimited supply
  // in the bench drawer of any real classroom balance).
  const [rightCounts, setRightCounts] = useState<number[]>(() => STANDARDS_G.map(() => 0))

  // Observation log for stage 1: which tilt states have been witnessed.
  const [seenStates, setSeenStates] = useState<Set<'left' | 'right' | 'balanced'>>(new Set())
  // Stage 2: which samples have been successfully balanced.
  const [balancedSamples, setBalancedSamples] = useState<Set<string>>(new Set())

  // ─── Predict state ─────────────────────────────────────────
  const [scenarioIdx, setScenarioIdx] = useState(0)
  const [pick, setPick] = useState<number | null>(null) // slot index picked
  const [streak, setStreak] = useState(0)

  const scenario = deck[scenarioIdx % deck.length]!
  const displayOrder = optionOrder[scenarioIdx % deck.length]!
  const displayedOptions = displayOrder.map((rawIdx) => scenario.options[rawIdx]!)
  // The "correct slot" is the display-slot whose displayOrder entry maps to rawIdx 0
  // (raw index of the correct option — see buildScenario).
  const correctSlot = displayOrder.indexOf(scenario.correctIdx)

  // ─── Derived: balance state ────────────────────────────────
  const sample = SAMPLES[sampleIdx % SAMPLES.length]!
  const rightMass = rightCounts.reduce((sum, c, i) => sum + c * (STANDARDS_G[i] ?? 0), 0)
  const leftMass = sample.mass_g
  const diff = leftMass - rightMass // + means left heavier → beam tilts left-down
  const isBalanced = Math.abs(diff) < BALANCE_TOL
  const tiltDeg = isBalanced
    ? 0
    : Math.max(-BEAM_MAX_TILT_DEG, Math.min(BEAM_MAX_TILT_DEG, (diff / Math.max(leftMass, 1)) * BEAM_MAX_TILT_DEG * 2))

  const currentTiltState: 'left' | 'right' | 'balanced' = isBalanced
    ? 'balanced'
    : diff > 0
      ? 'left'
      : 'right'

  // Record witnessed tilt states (stage 1 only)
  useEffect(() => {
    if (!isObserve) return
    setSeenStates((prev) => {
      if (prev.has(currentTiltState)) return prev
      const next = new Set(prev)
      next.add(currentTiltState)
      return next
    })
  }, [isObserve, currentTiltState])

  // Record balanced samples (stage 2)
  useEffect(() => {
    if (!isExperiment) return
    if (!isBalanced) return
    setBalancedSamples((prev) => {
      if (prev.has(sample.id)) return prev
      const next = new Set(prev)
      next.add(sample.id)
      return next
    })
  }, [isExperiment, isBalanced, sample.id])

  // Advance criteria
  const observeDone = seenStates.size >= 3
  const experimentDone = balancedSamples.size >= SAMPLES.length
  const predictDone = streak >= PREDICT_TARGET
  const canSubmit = isObserve ? observeDone : isExperiment ? experimentDone : predictDone

  // ─── Handlers ──────────────────────────────────────────────
  const resetForStage = useCallback((stage: number) => {
    setRightCounts(STANDARDS_G.map(() => 0))
    setSampleIdx(0)
    setSeenStates(new Set())
    setBalancedSamples(new Set())
    setScenarioIdx(0)
    setPick(null)
    setStreak(0)
    void stage
  }, [])

  useReset(() => resetForStage(stageIdx))

  useEffect(() => {
    progress(stageIdx / stages.length, { stage: stageIdx, canSubmit })
  }, [stageIdx, canSubmit, stages.length, progress])

  useNext(() => {
    if (stageIdx < stages.length) {
      const next = stageIdx + 1
      setStage(next)
      resetForStage(next)
    } else {
      complete({ success: true })
    }
  })

  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  const toggleStandard = useCallback((denomIdx: number) => {
    if (!isInteractive) return
    setRightCounts((prev) => {
      const next = prev.slice()
      // Click adds one; long-press-like removal by right-click is unwieldy in this
      // sandboxed context. Simpler UX: click cycles the count 0→1→2→3→0.
      next[denomIdx] = (next[denomIdx]! + 1) % 4
      return next
    })
  }, [isInteractive])

  const cycleSample = useCallback(() => {
    if (!isExperiment) return
    setSampleIdx((i) => (i + 1) % SAMPLES.length)
    // Reset right pan when swapping sample so the student rebuilds cleanly.
    setRightCounts(STANDARDS_G.map(() => 0))
  }, [isExperiment])

  const pickAnswer = useCallback((slot: number) => {
    if (pick !== null) return
    setPick(slot)
    if (slot === correctSlot) {
      setStreak((s) => s + 1)
    } else {
      setStreak(0)
    }
  }, [pick, correctSlot])

  const nextScenario = useCallback(() => {
    setPick(null)
    setScenarioIdx((i) => i + 1)
  }, [])

  // ─── HUD text ──────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`
  const hudTR = isObserve
    ? `${labels.outcomes_seen}: ${seenStates.size}/3`
    : isExperiment
      ? `${labels.balanced_seen}: ${balancedSamples.size}/${SAMPLES.length}`
      : `${labels.streak}: ${streak}/${PREDICT_TARGET}`
  const hudBL = isObserve ? labels.tip1 : isExperiment ? labels.tip2 : labels.tip3

  // ─── Render helpers ────────────────────────────────────────
  const beamLeftEnd = { x: -BEAM_HALF, y: 0 }
  const beamRightEnd = { x: BEAM_HALF, y: 0 }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block', userSelect: 'none' }}
      >
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        {/* Scene panel — title outside above box */}
        <rect x={40} y={60} width={500} height={340} fill="none" stroke="#12203a" strokeWidth={1} rx={6} />
        <text x={48} y={52} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={11} letterSpacing="0.1em">
          {labels.scene_title}
        </text>

        {/* On the blind stage, the balance is COVERED. Help visual is removed;
            required info (current pick) is shown by the buttons themselves. */}
        {isPredict ? (
          <g>
            {/* Cover overlay */}
            <rect x={70} y={110} width={440} height={240} fill="#0F1A30" stroke="#12203a" strokeWidth={1} rx={6} />
            <text
              x={290}
              y={230}
              fill="#3A4863"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={14}
              letterSpacing="0.2em"
              style={{ textTransform: 'uppercase' }}
              textAnchor="middle"
            >
              {labels.hidden}
            </text>
            {/* Small icon */}
            <text
              x={290}
              y={200}
              fill="#3A4863"
              fontSize={38}
              textAnchor="middle"
              dominantBaseline="middle"
            >
              ⊘
            </text>
          </g>
        ) : (
          <g transform={`translate(${FULCRUM_X}, ${FULCRUM_Y})`}>
            {/* Base stand */}
            <polygon points={`-40,110 40,110 20,0 -20,0`} fill="#22304A" stroke="#3A4863" strokeWidth={1} />
            {/* Column */}
            <rect x={-3} y={-90} width={6} height={90} fill="#3A4863" />
            {/* Fulcrum knob */}
            <circle cx={0} cy={-90} r={5} fill="#6C7A93" />

            {/* Beam + pans rotate together around the fulcrum */}
            <g
              transform={`rotate(${tiltDeg} 0 -90)`}
              style={{ transition: 'transform 0.4s ease-out' }}
            >
              {/* Beam */}
              <line
                x1={beamLeftEnd.x}
                y1={-90}
                x2={beamRightEnd.x}
                y2={-90}
                stroke="#B9C4D6"
                strokeWidth={3}
                strokeLinecap="round"
              />
              {/* Left pan: chains + dish */}
              <line x1={beamLeftEnd.x} y1={-90} x2={beamLeftEnd.x - 20} y2={-90 + PAN_DROP} stroke="#6C7A93" strokeWidth={1} />
              <line x1={beamLeftEnd.x} y1={-90} x2={beamLeftEnd.x + 20} y2={-90 + PAN_DROP} stroke="#6C7A93" strokeWidth={1} />
              <path
                d={`M ${beamLeftEnd.x - 42} ${-90 + PAN_DROP} L ${beamLeftEnd.x + 42} ${-90 + PAN_DROP} L ${beamLeftEnd.x + 30} ${-90 + PAN_DROP + 14} L ${beamLeftEnd.x - 30} ${-90 + PAN_DROP + 14} Z`}
                fill="#22304A"
                stroke="#54617A"
                strokeWidth={1.2}
              />
              {/* Sample object on the left pan */}
              <g
                transform={`translate(${beamLeftEnd.x}, ${-90 + PAN_DROP - 14})`}
                onClick={isExperiment ? cycleSample : undefined}
                style={isExperiment ? { cursor: 'pointer' } : undefined}
              >
                <rect
                  x={-16}
                  y={-16}
                  width={32}
                  height={16}
                  rx={2}
                  fill="#F9A968"
                  stroke="#B47A46"
                  strokeWidth={1}
                />
                <text
                  x={0}
                  y={-4}
                  fill="#0D1524"
                  fontFamily="'JetBrains Mono', monospace"
                  fontSize={11}
                  fontWeight={700}
                  textAnchor="middle"
                  pointerEvents="none"
                >
                  {sample.label}
                </text>
              </g>

              {/* Right pan: chains + dish */}
              <line x1={beamRightEnd.x} y1={-90} x2={beamRightEnd.x - 20} y2={-90 + PAN_DROP} stroke="#6C7A93" strokeWidth={1} />
              <line x1={beamRightEnd.x} y1={-90} x2={beamRightEnd.x + 20} y2={-90 + PAN_DROP} stroke="#6C7A93" strokeWidth={1} />
              <path
                d={`M ${beamRightEnd.x - 42} ${-90 + PAN_DROP} L ${beamRightEnd.x + 42} ${-90 + PAN_DROP} L ${beamRightEnd.x + 30} ${-90 + PAN_DROP + 14} L ${beamRightEnd.x - 30} ${-90 + PAN_DROP + 14} Z`}
                fill="#22304A"
                stroke="#54617A"
                strokeWidth={1.2}
              />
              {/* Standards stacked on the right pan (visual only — one small chip per unit) */}
              <g transform={`translate(${beamRightEnd.x - 30}, ${-90 + PAN_DROP - 10})`}>
                {(() => {
                  const chips: React.ReactNode[] = []
                  let cx = 0
                  let cy = 0
                  let colCount = 0
                  rightCounts.forEach((count, i) => {
                    for (let k = 0; k < count; k++) {
                      chips.push(
                        <rect
                          key={`${i}-${k}`}
                          x={cx}
                          y={cy}
                          width={9}
                          height={6}
                          rx={1}
                          fill="#7EE3D8"
                          stroke="#3B8F86"
                          strokeWidth={0.6}
                        />,
                      )
                      cx += 10
                      colCount += 1
                      if (colCount >= 6) {
                        colCount = 0
                        cx = 0
                        cy -= 7
                      }
                    }
                  })
                  return chips
                })()}
              </g>
            </g>

            {/* Reading label under the base */}
            <text
              x={0}
              y={135}
              fill="#B9C4D6"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={12}
              textAnchor="middle"
            >
              {labels.reading}: {rightMass} g
            </text>
            {/* Verdict chip */}
            <text
              x={0}
              y={152}
              fill={isBalanced ? '#37C9B8' : '#F9A968'}
              fontFamily="'JetBrains Mono', monospace"
              fontSize={11}
              textAnchor="middle"
              letterSpacing="0.08em"
              style={{ textTransform: 'uppercase' }}
            >
              {isBalanced
                ? labels.verdict_balanced
                : diff > 0
                  ? labels.verdict_left
                  : labels.verdict_right}
            </text>
          </g>
        )}
      </svg>

      {/* HUD overlays */}
      <div style={{ position: 'absolute', top: '3rem', left: '3rem', fontFamily: "'JetBrains Mono', monospace", fontSize: '2.3rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: '#6C7A93', zIndex: 5, pointerEvents: 'none' }}>
        {hudTL}
      </div>
      <div style={{ position: 'absolute', top: '3rem', right: '3rem', fontFamily: "'JetBrains Mono', monospace", fontSize: '2.3rem', letterSpacing: '0.08em', color: canSubmit ? '#37C9B8' : '#B9C4D6', zIndex: 5, pointerEvents: 'none' }}>
        {hudTR}
      </div>
      <div style={{ position: 'absolute', bottom: '3rem', left: '3rem', fontFamily: "'JetBrains Mono', monospace", fontSize: '2.3rem', letterSpacing: '0.06em', color: '#6C7A93', zIndex: 5, pointerEvents: 'none', maxWidth: '58%' }}>
        {hudBL}
      </div>
      {/* NO bottom-right — reserved for parent chrome (fullscreen button). */}

      {/* Right panel — aligned with scene box */}
      <div
        style={{
          position: 'absolute',
          top: '9.7rem',
          bottom: '11.1rem',
          right: '6.7rem',
          width: '40rem',
          boxSizing: 'border-box',
          zIndex: 6,
          color: '#B9C4D6',
          fontFamily: "'JetBrains Mono', monospace",
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{ fontSize: '2.44rem', color: '#6C7A93', letterSpacing: '0.1em', marginBottom: '1.2rem', marginLeft: '0.4rem' }}>
          {isPredict ? labels.question : labels.controls}
        </div>
        <div
          style={{
            flex: 1,
            border: '1px solid #12203a',
            borderRadius: '0.6rem',
            padding: '2.5rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '2rem',
            fontSize: '2rem',
            overflow: 'auto',
          }}
        >
          {isInteractive && (
            <>
              <FieldGroup label={labels.field_standards}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.6rem' }}>
                  {STANDARDS_G.map((g, i) => {
                    const count = rightCounts[i]!
                    const active = count > 0
                    return (
                      <button
                        key={g}
                        type="button"
                        onClick={() => toggleStandard(i)}
                        style={{
                          padding: '0.9rem 0.6rem',
                          background: active ? '#3A4863' : 'transparent',
                          color: active ? '#EAF0FA' : '#6C7A93',
                          border: '1px solid #3A4863',
                          borderRadius: '0.5rem',
                          fontFamily: "'JetBrains Mono', monospace",
                          fontSize: '1.7rem',
                          cursor: 'pointer',
                          textAlign: 'center',
                        }}
                      >
                        {g} g{count > 1 ? ` ×${count}` : ''}
                      </button>
                    )
                  })}
                </div>
                <div style={{ fontSize: '1.4rem', color: '#54617A', marginTop: '0.4rem' }}>
                  {labels.click_standard_hint}
                </div>
              </FieldGroup>

              <FieldGroup label={labels.field_sample}>
                <div style={{ fontSize: '1.7rem', color: '#B9C4D6' }}>
                  {sample.label}
                  {isExperiment && (
                    <span style={{ color: '#6C7A93', fontSize: '1.4rem', marginLeft: '0.6rem' }}>
                      · {labels.click_sample_hint}
                    </span>
                  )}
                </div>
              </FieldGroup>

              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.4rem',
                  padding: '0.7rem 0.9rem',
                  border: '1px solid #12203a',
                  borderRadius: '0.5rem',
                }}
              >
                <div style={{ fontSize: '1.5rem', color: '#54617A', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                  {labels.field_status}
                </div>
                <div style={{ fontSize: '1.7rem', color: '#B9C4D6' }}>
                  {labels.right_pan_total}: {rightMass} g
                </div>
                <div style={{ fontSize: '1.5rem', color: isBalanced ? '#37C9B8' : '#6C7A93' }}>
                  {isBalanced
                    ? labels.verdict_balanced
                    : diff > 0
                      ? labels.verdict_left
                      : labels.verdict_right}
                </div>
              </div>
            </>
          )}

          {isPredict && (
            <>
              <div style={{ fontSize: '1.7rem', color: '#6C7A93' }}>
                {labels.convert_prompt}
              </div>
              <div style={{ fontSize: '2.6rem', color: '#EAF0FA', textAlign: 'center', lineHeight: 1.2 }}>
                {fmt(scenario.value, scenario.from)}
                <span style={{ color: '#6C7A93', margin: '0 0.6rem', fontSize: '1.9rem' }}>
                  {labels.target_unit}
                </span>
                <span style={{ color: '#F9A968' }}>{scenario.to}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                {displayedOptions.map((val, slot) => {
                  const isPicked = pick === slot
                  const isCorrect = pick !== null && slot === correctSlot
                  const isWrong = pick !== null && isPicked && slot !== correctSlot
                  const bg = isCorrect ? '#37C9B8' : isWrong ? '#F97316' : isPicked ? '#3A4863' : 'transparent'
                  const fg = isCorrect || isWrong ? '#0D1524' : '#B9C4D6'
                  return (
                    <button
                      key={slot}
                      type="button"
                      disabled={pick !== null}
                      onClick={() => pickAnswer(slot)}
                      style={{
                        padding: '0.9rem 1.2rem',
                        background: bg,
                        color: fg,
                        border: '1px solid #3A4863',
                        borderRadius: '0.5rem',
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: '1.9rem',
                        textAlign: 'left',
                        cursor: pick !== null ? 'default' : 'pointer',
                        opacity: pick !== null && !isPicked && !isCorrect ? 0.4 : 1,
                      }}
                    >
                      {fmt(val, scenario.to)}
                      {isCorrect ? '  ✓' : isWrong ? '  ✗' : ''}
                    </button>
                  )
                })}
              </div>
              {pick !== null && (
                <button
                  type="button"
                  onClick={nextScenario}
                  style={{
                    padding: '1rem 1.4rem',
                    background: '#37C9B8',
                    color: '#0D1524',
                    border: '1px solid #37C9B8',
                    borderRadius: '0.5rem',
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: '2rem',
                    cursor: 'pointer',
                  }}
                >
                  {labels.next_q} →
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Small HTML components ────────────────────────────────────────
function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
      <div style={{ fontSize: '1.5rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: '#54617A' }}>{label}</div>
      {children}
    </div>
  )
}
