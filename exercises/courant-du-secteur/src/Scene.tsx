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
} from '@physics/sdk/react'
import { getHintFor, getStagesFor } from './stages'
import en from '../i18n/en.json'
import fr from '../i18n/fr.json'
import ar from '../i18n/ar.json'

// ─── Scene constants ─────────────────────────────────────────────────
const W = 800
const H = 450

// Diagram anchors — laid out on the left half of the scene box (x: 40..540)
const OUTLET_CX = 190
const OUTLET_CY = 250
const OUTLET_R = 60
const FUSEBOX_X = 340
const FUSEBOX_Y = 160
const FUSEBOX_W = 170
const FUSEBOX_H = 190
const SINE_X = 60
const SINE_Y = 100
const SINE_W = 220
const SINE_H = 40

// ─── Domain model ────────────────────────────────────────────────────
type PartId =
  | 'phase'
  | 'neutral'
  | 'earth'
  | 'outlet'
  | 'breaker'
  | 'rcd'

const ALL_PARTS: PartId[] = ['phase', 'neutral', 'earth', 'outlet', 'breaker', 'rcd']

// The five safety scenarios. Each has exactly one correct option.
// The scoring function is pure and lives at module scope.
type OptionId = 'earth' | 'rcd' | 'breaker' | 'insulation' | 'phase' | 'neutral' | 'body_resistance' | 'voltage_high'

type Scenario = {
  key: string
  correct: OptionId
  options: OptionId[]
}

const PREDICT_DECK: Scenario[] = [
  // 1) Why the third pin on modern outlets?
  {
    key: 'why_earth_pin',
    correct: 'earth',
    options: ['earth', 'rcd', 'phase'],
  },
  // 2) Which device trips when current leaks through a person to ground?
  {
    key: 'who_trips_on_leak',
    correct: 'rcd',
    options: ['rcd', 'breaker', 'earth'],
  },
  // 3) Which device trips on a short-circuit or heavy overload?
  {
    key: 'who_trips_on_overload',
    correct: 'breaker',
    options: ['breaker', 'rcd', 'insulation'],
  },
  // 4) Why does a wet hand make an electric shock more dangerous?
  {
    key: 'why_wet_hand',
    correct: 'body_resistance',
    options: ['body_resistance', 'voltage_high', 'earth'],
  },
  // 5) Which wire returns the current under normal operation?
  {
    key: 'which_wire_returns',
    correct: 'neutral',
    options: ['neutral', 'earth', 'phase'],
  },
]

function isCorrectAnswer(scenario: Scenario, pick: OptionId): boolean {
  return scenario.correct === pick
}

// ─── i18n label loader ───────────────────────────────────────────────
const dict = { en, fr, ar } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── Text tables for cards (inline; en-only per authoring scope) ─────
// Card prompts + option texts live here (rather than in labels) because
// they are strictly Stage-2 concept content, not chrome-facing SVG text.
type CardStrings = {
  prompt: string
  options: Record<OptionId, string>
}

const CARD_STRINGS: Record<string, CardStrings> = {
  why_earth_pin: {
    prompt: 'Why does a modern outlet have a third pin (earth) in addition to phase and neutral?',
    options: {
      earth: 'To divert any leakage from a metal appliance frame safely to the ground.',
      rcd: 'To carry the return current back to the fuse box.',
      breaker: 'To increase the mains voltage delivered to the appliance.',
      insulation: '',
      phase: '',
      neutral: '',
      body_resistance: '',
      voltage_high: '',
    },
  },
  who_trips_on_leak: {
    prompt: 'A person accidentally touches a live wire and current flows through them to ground. Which device cuts the supply?',
    options: {
      rcd: 'The différentiel — it detects the imbalance between phase and neutral currents.',
      breaker: 'The disjoncteur — it detects the drop in voltage on the phase wire.',
      earth: 'The earth wire alone stops the current without any device tripping.',
      insulation: '',
      phase: '',
      neutral: '',
      body_resistance: '',
      voltage_high: '',
    },
  },
  who_trips_on_overload: {
    prompt: 'Two live wires touch each other inside a broken appliance (short-circuit). Which device is designed to interrupt this?',
    options: {
      breaker: 'The disjoncteur — it opens the circuit when current exceeds its rating.',
      rcd: 'The différentiel — a short between phase and neutral is exactly what it detects.',
      insulation: 'The insulation of the wires alone is enough to stop the current.',
      earth: '',
      phase: '',
      neutral: '',
      body_resistance: '',
      voltage_high: '',
    },
  },
  why_wet_hand: {
    prompt: 'Why is touching a live wire with a wet hand far more dangerous than with a dry hand?',
    options: {
      body_resistance: 'Water lowers your skin resistance, so the same voltage drives a much larger current through you.',
      voltage_high: 'Water increases the mains voltage locally around your hand.',
      earth: 'Water carries the earth potential into your body.',
      insulation: '',
      phase: '',
      neutral: '',
      rcd: '',
      breaker: '',
    },
  },
  which_wire_returns: {
    prompt: 'In normal operation, which wire carries the current back from the appliance to the fuse box?',
    options: {
      neutral: 'The neutral wire — it is the return path of the alternating current.',
      earth: 'The earth wire — every appliance uses it to return current.',
      phase: 'The phase wire — it both delivers and returns the current.',
      insulation: '',
      rcd: '',
      breaker: '',
      body_resistance: '',
      voltage_high: '',
    },
  },
}

const OPTION_SHORT: Record<OptionId, string> = {
  earth: 'Earth wire',
  rcd: 'Différentiel (RCD)',
  breaker: 'Disjoncteur',
  insulation: 'Wire insulation',
  phase: 'Phase wire',
  neutral: 'Neutral wire',
  body_resistance: 'Body resistance drops',
  voltage_high: 'Mains voltage rises',
}

// ─── Component ───────────────────────────────────────────────────────
export default function Scene() {
  const { locale, seed } = useInit()
  void seed
  const stages = useMemo(() => getStagesFor(locale), [locale])
  useDeclareStages(stages)
  const labels = useMemo(() => svgLabels(locale), [locale])
  const rootRng = useSeed()

  // Seeded deck order: MCQ order changes per attempt but is reproducible.
  const initialDeck = useMemo(() => rootRng.shuffle(PREDICT_DECK), [rootRng])
  const [deck, setDeck] = useState<Scenario[]>(initialDeck)

  const stageIdx = useCurrentStage()
  const setStage = useSetStage()
  const progress = useProgress()
  const complete = useComplete()

  // Stage roles:
  //   1 = Observe: labeled diagram, click parts to reveal callouts.
  //   2 = Evaluate: blind stage, MCQ deck, ace-the-deck.
  const isObserve = stageIdx === 1
  const isPredict = stageIdx === 2

  // ─── Stage 1 state ────────────────────────────────────────────────
  const [seenParts, setSeenParts] = useState<Set<PartId>>(new Set())
  const [selectedPart, setSelectedPart] = useState<PartId | null>(null)
  const [revealAll, setRevealAll] = useState(false)

  const revealPart = useCallback((p: PartId) => {
    setSelectedPart(p)
    setSeenParts((prev) => {
      if (prev.has(p)) return prev
      const next = new Set(prev)
      next.add(p)
      return next
    })
  }, [])

  const toggleRevealAll = useCallback(() => {
    setRevealAll((prev) => {
      const next = !prev
      if (next) {
        // Reveal-all marks everything seen (still counts as coverage).
        setSeenParts(new Set(ALL_PARTS))
      }
      return next
    })
  }, [])

  // ─── Stage 2 state ────────────────────────────────────────────────
  const [cardIdx, setCardIdx] = useState(0)
  const [pick, setPick] = useState<OptionId | null>(null)
  const [attemptFailed, setAttemptFailed] = useState(false)

  const currentScenario = deck[cardIdx] ?? deck[0]!
  const cardStrings = CARD_STRINGS[currentScenario.key]!

  const pickAnswer = useCallback((choice: OptionId) => {
    setPick(choice)
    if (!isCorrectAnswer(currentScenario, choice)) {
      setAttemptFailed(true)
    }
  }, [currentScenario])

  const nextCard = useCallback(() => {
    setPick(null)
    setCardIdx((i) => i + 1)
  }, [])

  const restartDeck = useCallback(() => {
    setDeck(rootRng.shuffle(PREDICT_DECK))
    setCardIdx(0)
    setPick(null)
    setAttemptFailed(false)
  }, [rootRng])

  // ─── Advance criteria ─────────────────────────────────────────────
  const observeDone = seenParts.size >= ALL_PARTS.length
  const predictDone = !attemptFailed && cardIdx >= deck.length
  const canSubmit = isObserve ? observeDone : predictDone

  // ─── SDK wiring ───────────────────────────────────────────────────
  const resetForStage = useCallback((_stage: number) => {
    void _stage
    setSeenParts(new Set())
    setSelectedPart(null)
    setRevealAll(false)
    setCardIdx(0)
    setPick(null)
    setAttemptFailed(false)
    setDeck(rootRng.shuffle(PREDICT_DECK))
  }, [rootRng])

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

  // Peek: strategy hint only, never reveals which option is correct.
  const [peekVisible, setPeekVisible] = useState(false)
  usePeek(() => {
    setPeekVisible(true)
    window.setTimeout(() => setPeekVisible(false), 4500)
  })

  // ─── HUD text ─────────────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`
  const hudTR = isPredict
    ? `${labels.cards_progress}: ${Math.min(cardIdx, deck.length)}/${deck.length}`
    : `${labels.cards_progress}: ${seenParts.size}/${ALL_PARTS.length}`
  const hudBL = isObserve
    ? 'click each labeled part — or press reveal all'
    : attemptFailed
      ? 'wrong answer — deck resets'
      : 'answer every card correctly in one pass'

  // Precompute the sine waveform points once.
  const sinePoints = useMemo(() => {
    const pts: string[] = []
    const cycles = 2
    for (let i = 0; i <= 60; i += 1) {
      const t = i / 60
      const x = SINE_X + t * SINE_W
      const y = SINE_Y + (SINE_H / 2) - Math.sin(t * cycles * 2 * Math.PI) * (SINE_H / 2 - 2)
      pts.push(`${x.toFixed(2)},${y.toFixed(2)}`)
    }
    return pts.join(' ')
  }, [])

  // Callout copy for the currently selected diagram part.
  const calloutFor = (p: PartId): string => {
    switch (p) {
      case 'phase':
        return labels.phase
      case 'neutral':
        return labels.neutral
      case 'earth':
        return labels.earth
      case 'outlet':
        return labels.outlet
      case 'breaker':
        return labels.breaker
      case 'rcd':
        return labels.rcd
    }
  }

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

        {isObserve && (
          <g>
            {/* Sine wave illustration */}
            <rect x={SINE_X} y={SINE_Y} width={SINE_W} height={SINE_H} fill="none" stroke="#12203a" strokeWidth={1} rx={4} />
            <line
              x1={SINE_X}
              y1={SINE_Y + SINE_H / 2}
              x2={SINE_X + SINE_W}
              y2={SINE_Y + SINE_H / 2}
              stroke="#3A4863"
              strokeWidth={0.6}
              strokeDasharray="2 3"
            />
            <polyline points={sinePoints} fill="none" stroke="#F9A968" strokeWidth={1.4} />
            <text x={SINE_X} y={SINE_Y - 8} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={10}>
              {labels.u_label} · {labels.f_label}
            </text>

            {/* Three wires running from the sine block down to the fuse box */}
            <line x1={SINE_X + 40} y1={SINE_Y + SINE_H} x2={FUSEBOX_X + 30} y2={FUSEBOX_Y} stroke="#F97316" strokeWidth={1.6} />
            <line x1={SINE_X + 80} y1={SINE_Y + SINE_H} x2={FUSEBOX_X + 85} y2={FUSEBOX_Y} stroke="#7EE3D8" strokeWidth={1.6} />
            <line x1={SINE_X + 120} y1={SINE_Y + SINE_H} x2={FUSEBOX_X + 140} y2={FUSEBOX_Y} stroke="#B9C4D6" strokeWidth={1.6} />

            {/* Fuse box */}
            <rect
              x={FUSEBOX_X}
              y={FUSEBOX_Y}
              width={FUSEBOX_W}
              height={FUSEBOX_H}
              fill="#12203a"
              stroke="#3A4863"
              strokeWidth={1.2}
              rx={4}
            />
            <text
              x={FUSEBOX_X + FUSEBOX_W / 2}
              y={FUSEBOX_Y + 16}
              fill="#6C7A93"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
              textAnchor="middle"
            >
              {labels.fuse_box}
            </text>

            {/* Disjoncteur switch */}
            <g
              transform={`translate(${FUSEBOX_X + FUSEBOX_W / 2 - 40}, ${FUSEBOX_Y + 45})`}
              style={{ cursor: 'pointer' }}
              onClick={() => revealPart('breaker')}
            >
              <rect x={0} y={0} width={70} height={38} rx={4}
                fill={selectedPart === 'breaker' ? '#3A4863' : '#0D1524'}
                stroke={seenParts.has('breaker') ? '#37C9B8' : '#3A4863'} strokeWidth={1.2} />
              <line x1={12} y1={19} x2={40} y2={12} stroke="#F9A968" strokeWidth={2} />
              <circle cx={12} cy={19} r={2.5} fill="#F9A968" />
              <circle cx={58} cy={19} r={2.5} fill="#F9A968" />
              <text x={35} y={31} fill="#B9C4D6" fontFamily="'JetBrains Mono', monospace" fontSize={9} textAnchor="middle">
                {labels.breaker}
              </text>
            </g>

            {/* Différentiel */}
            <g
              transform={`translate(${FUSEBOX_X + FUSEBOX_W / 2 - 40}, ${FUSEBOX_Y + 105})`}
              style={{ cursor: 'pointer' }}
              onClick={() => revealPart('rcd')}
            >
              <rect x={0} y={0} width={70} height={38} rx={4}
                fill={selectedPart === 'rcd' ? '#3A4863' : '#0D1524'}
                stroke={seenParts.has('rcd') ? '#37C9B8' : '#3A4863'} strokeWidth={1.2} />
              <text x={35} y={17} fill="#7EE3D8" fontFamily="'JetBrains Mono', monospace" fontSize={11} textAnchor="middle" fontWeight={700}>
                Δ
              </text>
              <text x={35} y={30} fill="#B9C4D6" fontFamily="'JetBrains Mono', monospace" fontSize={9} textAnchor="middle">
                30 mA
              </text>
            </g>

            {/* Outlet — circle with three pins */}
            <g style={{ cursor: 'pointer' }} onClick={() => revealPart('outlet')}>
              <circle
                cx={OUTLET_CX}
                cy={OUTLET_CY}
                r={OUTLET_R}
                fill="#12203a"
                stroke={seenParts.has('outlet') ? '#37C9B8' : '#3A4863'}
                strokeWidth={1.4}
              />
            </g>

            {/* Phase pin (left) */}
            <g style={{ cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); revealPart('phase') }}>
              <rect
                x={OUTLET_CX - 26}
                y={OUTLET_CY - 4}
                width={8}
                height={22}
                rx={2}
                fill={selectedPart === 'phase' ? '#F97316' : '#0D1524'}
                stroke={seenParts.has('phase') ? '#F97316' : '#6C7A93'}
                strokeWidth={1.2}
              />
              <text x={OUTLET_CX - 22} y={OUTLET_CY + 32} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={9} textAnchor="middle">
                L
              </text>
            </g>

            {/* Neutral pin (right) */}
            <g style={{ cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); revealPart('neutral') }}>
              <rect
                x={OUTLET_CX + 18}
                y={OUTLET_CY - 4}
                width={8}
                height={22}
                rx={2}
                fill={selectedPart === 'neutral' ? '#7EE3D8' : '#0D1524'}
                stroke={seenParts.has('neutral') ? '#7EE3D8' : '#6C7A93'}
                strokeWidth={1.2}
              />
              <text x={OUTLET_CX + 22} y={OUTLET_CY + 32} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={9} textAnchor="middle">
                N
              </text>
            </g>

            {/* Earth pin (top center) */}
            <g style={{ cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); revealPart('earth') }}>
              <rect
                x={OUTLET_CX - 4}
                y={OUTLET_CY - 34}
                width={8}
                height={16}
                rx={2}
                fill={selectedPart === 'earth' ? '#B9C4D6' : '#0D1524'}
                stroke={seenParts.has('earth') ? '#B9C4D6' : '#6C7A93'}
                strokeWidth={1.2}
              />
              <text x={OUTLET_CX} y={OUTLET_CY - 40} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={9} textAnchor="middle">
                PE
              </text>
            </g>

            {/* Ground symbol below the outlet, wired to the earth pin */}
            <line x1={OUTLET_CX} y1={OUTLET_CY + OUTLET_R} x2={OUTLET_CX} y2={OUTLET_CY + OUTLET_R + 22} stroke="#B9C4D6" strokeWidth={1.2} />
            <line x1={OUTLET_CX - 14} y1={OUTLET_CY + OUTLET_R + 22} x2={OUTLET_CX + 14} y2={OUTLET_CY + OUTLET_R + 22} stroke="#B9C4D6" strokeWidth={1.5} />
            <line x1={OUTLET_CX - 10} y1={OUTLET_CY + OUTLET_R + 27} x2={OUTLET_CX + 10} y2={OUTLET_CY + OUTLET_R + 27} stroke="#B9C4D6" strokeWidth={1.2} />
            <line x1={OUTLET_CX - 6} y1={OUTLET_CY + OUTLET_R + 32} x2={OUTLET_CX + 6} y2={OUTLET_CY + OUTLET_R + 32} stroke="#B9C4D6" strokeWidth={1} />

            {/* Callout for the currently selected (or last selected) part */}
            {selectedPart && (
              <g>
                <rect
                  x={48}
                  y={370}
                  width={484}
                  height={22}
                  fill="#12203a"
                  stroke="#3A4863"
                  strokeWidth={1}
                  rx={4}
                />
                <text
                  x={56}
                  y={385}
                  fill="#B9C4D6"
                  fontFamily="'JetBrains Mono', monospace"
                  fontSize={11}
                >
                  {calloutFor(selectedPart)}
                </text>
              </g>
            )}

            {/* Reveal-all mode paints all callouts stacked in the callout strip. */}
            {revealAll && (
              <g>
                {ALL_PARTS.map((p, i) => (
                  <text
                    key={p}
                    x={56}
                    y={86 + i * 14}
                    fill="#B9C4D6"
                    fontFamily="'JetBrains Mono', monospace"
                    fontSize={10}
                    opacity={0.9}
                  >
                    · {calloutFor(p)}
                  </text>
                ))}
                <rect
                  x={48}
                  y={72}
                  width={220}
                  height={94}
                  fill="none"
                  stroke="#12203a"
                  strokeWidth={1}
                  rx={4}
                />
              </g>
            )}
          </g>
        )}

        {isPredict && (
          <g>
            {/* Blind stage: replace the diagram with an abstract "card N" token.
                No visual hint about the answer — students think from the concept. */}
            <rect
              x={140}
              y={140}
              width={300}
              height={180}
              fill="none"
              stroke="#3A4863"
              strokeWidth={1.2}
              strokeDasharray="4 3"
              rx={8}
            />
            <text
              x={290}
              y={195}
              fill="#6C7A93"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={12}
              letterSpacing="0.2em"
              textAnchor="middle"
            >
              {labels.card.toUpperCase()} {Math.min(cardIdx, deck.length - 1) + 1} / {deck.length}
            </text>
            <text
              x={290}
              y={240}
              fill="#B9C4D6"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={32}
              fontWeight={700}
              textAnchor="middle"
            >
              ?
            </text>
            <text
              x={290}
              y={280}
              fill="#54617A"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
              textAnchor="middle"
            >
              diagram hidden — reason from the concept
            </text>
          </g>
        )}
      </svg>

      {/* HUD overlays — HTML in `rem` */}
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
          fontSize: '2.3rem',
          letterSpacing: '0.08em',
          color: canSubmit ? '#37C9B8' : attemptFailed ? '#F97316' : '#B9C4D6',
          zIndex: 5,
          pointerEvents: 'none',
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
          fontSize: '2.3rem',
          letterSpacing: '0.06em',
          color: attemptFailed ? '#F97316' : '#6C7A93',
          zIndex: 5,
          pointerEvents: 'none',
          maxWidth: '58%',
        }}
      >
        {hudBL}
      </div>
      {/* NO bottom-right — reserved for parent chrome. */}

      {/* Right panel — aligned with scene box (SVG y=60..400). */}
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
        <div
          style={{
            fontSize: '2.44rem',
            color: '#6C7A93',
            letterSpacing: '0.1em',
            marginBottom: '1.2rem',
            marginLeft: '0.4rem',
            textTransform: 'lowercase',
          }}
        >
          {isObserve ? labels.controls : labels.question}
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
          {isObserve && (
            <ObservePanel
              labels={labels}
              seenParts={seenParts}
              selectedPart={selectedPart}
              onPick={revealPart}
              onToggleAll={toggleRevealAll}
              revealAll={revealAll}
            />
          )}

          {isPredict && (
            <PredictPanel
              scenario={currentScenario}
              cardStrings={cardStrings}
              pick={pick}
              attemptFailed={attemptFailed}
              cardIdx={cardIdx}
              deckSize={deck.length}
              labels={labels}
              onPick={pickAnswer}
              onNext={nextCard}
              onRestart={restartDeck}
            />
          )}

          {peekVisible && isPredict && (
            <div
              style={{
                marginTop: '1rem',
                padding: '1rem 1.2rem',
                border: '1px solid #F97316',
                borderRadius: '0.5rem',
                background: 'rgba(249,115,22,0.08)',
                color: '#F9A968',
                fontSize: '1.7rem',
                lineHeight: 1.5,
              }}
            >
              {labels.peek_hint}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Panels ─────────────────────────────────────────────────────────
type Labels = ReturnType<typeof svgLabels>

function ObservePanel({
  labels,
  seenParts,
  selectedPart,
  onPick,
  onToggleAll,
  revealAll,
}: {
  labels: Labels
  seenParts: Set<PartId>
  selectedPart: PartId | null
  onPick: (p: PartId) => void
  onToggleAll: () => void
  revealAll: boolean
}) {
  const rows: { id: PartId; label: string }[] = [
    { id: 'phase', label: labels.phase },
    { id: 'neutral', label: labels.neutral },
    { id: 'earth', label: labels.earth },
    { id: 'outlet', label: labels.outlet },
    { id: 'breaker', label: labels.breaker },
    { id: 'rcd', label: labels.rcd },
  ]
  return (
    <>
      <div
        style={{
          fontSize: '1.5rem',
          color: '#54617A',
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
        }}
      >
        parts
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
        {rows.map((r) => {
          const seen = seenParts.has(r.id)
          const active = selectedPart === r.id
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => onPick(r.id)}
              style={{
                padding: '0.7rem 1rem',
                background: active ? '#3A4863' : 'transparent',
                color: seen ? '#EAF0FA' : '#B9C4D6',
                border: `1px solid ${seen ? '#37C9B8' : '#3A4863'}`,
                borderRadius: '0.4rem',
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '1.6rem',
                textAlign: 'left',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.6rem',
              }}
            >
              <span style={{ color: seen ? '#37C9B8' : '#54617A', width: '1.2em' }}>
                {seen ? '✓' : '·'}
              </span>
              <span>{r.label}</span>
            </button>
          )
        })}
      </div>
      <button
        type="button"
        onClick={onToggleAll}
        style={{
          padding: '0.8rem 1rem',
          background: revealAll ? '#3A4863' : 'transparent',
          color: '#B9C4D6',
          border: '1px solid #3A4863',
          borderRadius: '0.4rem',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '1.6rem',
          cursor: 'pointer',
        }}
      >
        {revealAll ? labels.hide : labels.reveal}
      </button>
    </>
  )
}

function PredictPanel({
  scenario,
  cardStrings,
  pick,
  attemptFailed,
  cardIdx,
  deckSize,
  labels,
  onPick,
  onNext,
  onRestart,
}: {
  scenario: Scenario
  cardStrings: CardStrings
  pick: OptionId | null
  attemptFailed: boolean
  cardIdx: number
  deckSize: number
  labels: Labels
  onPick: (choice: OptionId) => void
  onNext: () => void
  onRestart: () => void
}) {
  const done = !attemptFailed && cardIdx >= deckSize
  const isCorrect = pick !== null && pick === scenario.correct
  const isWrong = pick !== null && pick !== scenario.correct

  if (done) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '1.2rem',
          fontSize: '1.9rem',
        }}
      >
        <div style={{ color: '#37C9B8', fontSize: '2.2rem', fontWeight: 700 }}>
          Deck cleared.
        </div>
        <div style={{ color: '#B9C4D6', lineHeight: 1.5 }}>
          You answered all {deckSize} safety scenarios correctly in one pass.
        </div>
      </div>
    )
  }

  return (
    <>
      <div style={{ fontSize: '1.8rem', color: '#B9C4D6', lineHeight: 1.5 }}>
        {cardStrings.prompt}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
        {scenario.options.map((o) => {
          const isPicked = pick === o
          const showCorrect = pick !== null && o === scenario.correct
          const showWrong = pick !== null && isPicked && o !== scenario.correct
          const bg = showCorrect ? '#37C9B8' : showWrong ? '#F97316' : isPicked ? '#3A4863' : 'transparent'
          const fg = showCorrect || showWrong ? '#0D1524' : '#B9C4D6'
          const shortLabel = OPTION_SHORT[o]
          const longLabel = cardStrings.options[o] || shortLabel
          return (
            <button
              key={o}
              type="button"
              disabled={pick !== null}
              onClick={() => onPick(o)}
              style={{
                padding: '0.9rem 1.1rem',
                background: bg,
                color: fg,
                border: '1px solid #3A4863',
                borderRadius: '0.5rem',
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '1.6rem',
                textAlign: 'left',
                cursor: pick !== null ? 'default' : 'pointer',
                opacity: pick !== null && !isPicked && !showCorrect ? 0.4 : 1,
                lineHeight: 1.4,
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: '0.3rem' }}>
                {shortLabel}
                {showCorrect ? '  ✓' : showWrong ? '  ✗' : ''}
              </div>
              <div style={{ fontSize: '1.4rem', opacity: 0.85 }}>{longLabel}</div>
            </button>
          )
        })}
      </div>
      {isCorrect && (
        <button
          type="button"
          onClick={onNext}
          style={{
            padding: '1rem 1.4rem',
            background: '#37C9B8',
            color: '#0D1524',
            border: '1px solid #37C9B8',
            borderRadius: '0.5rem',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '1.9rem',
            cursor: 'pointer',
            fontWeight: 700,
          }}
        >
          {labels.next} →
        </button>
      )}
      {isWrong && (
        <button
          type="button"
          onClick={onRestart}
          style={{
            padding: '1rem 1.4rem',
            background: 'transparent',
            color: '#F97316',
            border: '1px solid #F97316',
            borderRadius: '0.5rem',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '1.9rem',
            cursor: 'pointer',
            fontWeight: 700,
          }}
        >
          ↻ {labels.restart}
        </button>
      )}
    </>
  )
}
