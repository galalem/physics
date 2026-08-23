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

// ─── Scene constants ────────────────────────────────────────────────────
const W = 800
const H = 450

// Instrument bench geometry (SVG coords)
const BENCH_TOP = 90
const BENCH_ROW_H = 60
const INSTR_X = 80
const INSTR_LABEL_X = 145
const INSTR_VAL_X = 380

// Sample chip strip along the bottom of the scene panel
const CHIP_ROW_Y = 355
const CHIP_ROW_X = 60
const CHIP_W = 70
const CHIP_H = 30
const CHIP_GAP = 8

// ─── Domain model ───────────────────────────────────────────────────────
type SampleId =
  | 'iron'
  | 'aluminium'
  | 'copper'
  | 'water'
  | 'oil'
  | 'wood'

type Sample = {
  id: SampleId
  mass: number // grams
  volume: number // mL
  temperature: number // °C
  magnetic: boolean
  color: string
}

// Six samples. Note: iron + aluminium share mass (40 g) but not volume —
// qualitative density hint. iron + copper share volume (5 mL) but not mass.
const SAMPLES: Sample[] = [
  { id: 'iron', mass: 40, volume: 5, temperature: 20, magnetic: true, color: '#7A8FA8' },
  { id: 'aluminium', mass: 40, volume: 15, temperature: 20, magnetic: false, color: '#B9C4D6' },
  { id: 'copper', mass: 45, volume: 5, temperature: 20, magnetic: false, color: '#D68A5B' },
  { id: 'water', mass: 20, volume: 20, temperature: 15, magnetic: false, color: '#6EA8D6' },
  { id: 'oil', mass: 18, volume: 20, temperature: 20, magnetic: false, color: '#E3C46A' },
  { id: 'wood', mass: 10, volume: 15, temperature: 20, magnetic: false, color: '#8B6A47' },
]

function sampleById(id: SampleId): Sample {
  const s = SAMPLES.find((x) => x.id === id)
  if (!s) throw new Error(`unknown sample: ${id}`)
  return s
}

// ─── MCQ deck ───────────────────────────────────────────────────────────
// Each scenario shows the measured row of one truth-sample and offers 3
// candidates including the truth. The distractors are chosen so exactly one
// discriminating column identifies the truth — the student must actually
// read the row, not guess.
type Scenario = {
  truth: SampleId
  candidates: [SampleId, SampleId, SampleId]
}

const PREDICT_DECK: Scenario[] = [
  // Magnetic discriminator: iron sticks; copper + aluminium don't.
  { truth: 'iron', candidates: ['iron', 'copper', 'aluminium'] },
  // Volume discriminator: iron 5 mL vs aluminium 15 mL vs wood 15 mL.
  { truth: 'copper', candidates: ['copper', 'aluminium', 'wood'] },
  // Temperature discriminator: water is the cold one (15 °C).
  { truth: 'water', candidates: ['water', 'oil', 'aluminium'] },
  // Mass discriminator: oil 18 g vs water 20 g vs wood 10 g.
  { truth: 'oil', candidates: ['oil', 'water', 'wood'] },
  // Density-style pair: iron 40 g / 5 mL vs aluminium 40 g / 15 mL.
  // Same mass, so student must read the volume column.
  { truth: 'aluminium', candidates: ['aluminium', 'iron', 'copper'] },
]

// ─── Label loader ───────────────────────────────────────────────────────
const dict = { en, fr, ar } as const
type Locale = keyof typeof dict

function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

function sampleLabel(id: SampleId, labels: ReturnType<typeof svgLabels>): string {
  const key = ('sample_' + id) as keyof typeof labels
  return (labels[key] as string) ?? id
}

// ─── Component ──────────────────────────────────────────────────────────
export default function Scene() {
  const { locale } = useInit()
  const stages = useMemo(() => getStagesFor(locale), [locale])
  useDeclareStages(stages)
  const labels = useMemo(() => svgLabels(locale), [locale])
  const rootRng = useSeed()

  // Seeded deck order — deterministic per attempt seed.
  const [deckSalt, setDeckSalt] = useState(0)
  const deck = useMemo(() => {
    void deckSalt
    return rootRng.shuffle(PREDICT_DECK)
  }, [rootRng, deckSalt])

  const stageIdx = useCurrentStage()
  const setStage = useSetStage()
  const progress = useProgress()
  const complete = useComplete()

  const isObserve = stageIdx === 1
  const isPredict = stageIdx === 2

  // ─── Stage 1 state ─────────────────────────────────────────────
  const [activeSample, setActiveSample] = useState<SampleId | null>(null)
  const [measured, setMeasured] = useState<Set<SampleId>>(new Set())

  const pickSample = useCallback((id: SampleId) => {
    setActiveSample(id)
    setMeasured((prev) => {
      if (prev.has(id)) return prev
      const next = new Set(prev)
      next.add(id)
      return next
    })
  }, [])

  // ─── Stage 2 state ─────────────────────────────────────────────
  const [scenarioIdx, setScenarioIdx] = useState(0)
  const [pick, setPick] = useState<SampleId | null>(null)
  // "streak" = correct-in-a-row within the current pass through the deck.
  // Ace-the-deck: wrong resets streak AND re-shuffles + restarts at 0.
  const [streak, setStreak] = useState(0)
  const [peekVisible, setPeekVisible] = useState(false)

  const scenario = deck[scenarioIdx % deck.length]!
  const truthSample = sampleById(scenario.truth)
  const correctAnswer = scenario.truth

  const observeDone = measured.size >= SAMPLES.length
  const predictDone = streak >= deck.length
  const canSubmit = isObserve ? observeDone : predictDone

  const resetForStage = useCallback((_stage: number) => {
    void _stage
    setActiveSample(null)
    setMeasured(new Set())
    setScenarioIdx(0)
    setPick(null)
    setStreak(0)
    setPeekVisible(false)
    // fresh deck shuffle on reset
    setDeckSalt((n) => n + 1)
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

  // Peek: strategy hint on the blind stage. Never reveals the answer.
  // Points at the discriminating column for the current scenario class,
  // teaching method ("look at magnetic first — fastest column").
  usePeek(() => {
    if (!isPredict) return
    setPeekVisible(true)
    setTimeout(() => setPeekVisible(false), 2500)
  })

  const pickAnswer = useCallback((choice: SampleId) => {
    setPick(choice)
    const ok = choice === correctAnswer
    if (ok) {
      setStreak((s) => s + 1)
    } else {
      // Wrong = restart the deck with a fresh shuffle. Anti-brute-force.
      setStreak(0)
    }
  }, [correctAnswer])

  const advanceScenario = useCallback(() => {
    const wasCorrect = pick === correctAnswer
    setPick(null)
    if (wasCorrect) {
      // Completion is triggered when streak fills — chrome's Next fires complete().
      // Otherwise move to next scenario.
      const nextIdx = (scenarioIdx + 1) % deck.length
      setScenarioIdx(nextIdx)
    } else {
      // Wrong: restart pass. Re-shuffle deck, back to scenario 0.
      setScenarioIdx(0)
      setDeckSalt((n) => n + 1)
    }
  }, [pick, correctAnswer, scenarioIdx, deck.length])

  // HUD text ─────────────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`
  const hudTR = isObserve
    ? `${labels.measured}: ${measured.size}/${SAMPLES.length}`
    : `${labels.streak}: ${streak}/${deck.length}`
  const hudBL = isObserve ? labels.tip1 : labels.tip2

  // Reading rows: in Observe use activeSample; in Predict use scenario truth.
  const displaySample: Sample | null = isObserve
    ? (activeSample ? sampleById(activeSample) : null)
    : truthSample

  const readMass = displaySample ? `${displaySample.mass} ${labels.unit_g}` : labels.unknown
  const readVolume = displaySample ? `${displaySample.volume} ${labels.unit_ml}` : labels.unknown
  const readTemp = displaySample ? `${displaySample.temperature} ${labels.unit_c}` : labels.unknown
  const readMagnetic = displaySample
    ? (displaySample.magnetic ? labels.yes : labels.no)
    : labels.unknown

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block', userSelect: 'none' }}
      >
        {/* NO borderRadius on <svg>. NO rx on the bg <rect>. */}
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        {/* Scene panel */}
        <rect x={40} y={60} width={500} height={340} fill="none" stroke="#12203a" strokeWidth={1} rx={6} />
        <text x={48} y={52} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={11} letterSpacing="0.1em">
          {labels.bench}
        </text>

        {/* Instrument rows: balance, cylinder, thermometer, magnet */}
        {[
          { key: 'balance', icon: 'balance', label: labels.balance, value: readMass },
          { key: 'cylinder', icon: 'cylinder', label: labels.cylinder, value: readVolume },
          { key: 'thermometer', icon: 'thermometer', label: labels.thermometer, value: readTemp },
          { key: 'magnet', icon: 'magnet', label: labels.magnet, value: readMagnetic },
        ].map((row, i) => {
          const y = BENCH_TOP + i * BENCH_ROW_H
          return (
            <g key={row.key}>
              {/* Row separator */}
              {i > 0 && (
                <line x1={60} y1={y - 12} x2={520} y2={y - 12} stroke="#12203a" strokeWidth={0.5} />
              )}
              {/* Instrument glyph */}
              <InstrumentGlyph kind={row.key as InstrumentKind} x={INSTR_X} y={y + 6} />
              {/* Label */}
              <text
                x={INSTR_LABEL_X}
                y={y + 12}
                fill="#6C7A93"
                fontFamily="'JetBrains Mono', monospace"
                fontSize={12}
                letterSpacing="0.08em"
              >
                {row.label}
              </text>
              {/* Reading */}
              <text
                x={INSTR_VAL_X}
                y={y + 12}
                fill={displaySample ? '#EAF0FA' : '#3A4863'}
                fontFamily="'JetBrains Mono', monospace"
                fontSize={16}
                fontWeight={600}
                textAnchor="start"
              >
                {row.value}
              </text>
            </g>
          )
        })}

        {/* Sample chips (Observe only) — click to place on instruments */}
        {isObserve && (
          <g>
            <text
              x={48}
              y={CHIP_ROW_Y - 12}
              fill="#54617A"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
              letterSpacing="0.1em"
            >
              {labels.hint_click_sample.toUpperCase()}
            </text>
            {SAMPLES.map((s, i) => {
              const x = CHIP_ROW_X + i * (CHIP_W + CHIP_GAP)
              const isActive = activeSample === s.id
              const isMeasured = measured.has(s.id)
              return (
                <g
                  key={s.id}
                  transform={`translate(${x}, ${CHIP_ROW_Y})`}
                  onClick={() => pickSample(s.id)}
                  style={{ cursor: 'pointer' }}
                >
                  <rect
                    x={0}
                    y={0}
                    width={CHIP_W}
                    height={CHIP_H}
                    rx={4}
                    fill={isActive ? s.color : 'transparent'}
                    stroke={isMeasured ? s.color : '#3A4863'}
                    strokeWidth={isActive ? 1.6 : 1}
                    opacity={isActive ? 1 : isMeasured ? 0.9 : 0.7}
                  />
                  <text
                    x={CHIP_W / 2}
                    y={CHIP_H / 2 + 4}
                    fill={isActive ? '#0D1524' : isMeasured ? s.color : '#B9C4D6'}
                    fontFamily="'JetBrains Mono', monospace"
                    fontSize={11}
                    textAnchor="middle"
                    pointerEvents="none"
                  >
                    {sampleLabel(s.id, labels)}
                  </text>
                </g>
              )
            })}
          </g>
        )}

        {/* Predict-stage badge: opaque token in place of the sample */}
        {isPredict && (
          <g transform={`translate(${CHIP_ROW_X}, ${CHIP_ROW_Y})`}>
            <rect
              x={0}
              y={0}
              width={CHIP_W}
              height={CHIP_H}
              rx={4}
              fill="#12203a"
              stroke="#3A4863"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            <text
              x={CHIP_W / 2}
              y={CHIP_H / 2 + 4}
              fill="#6C7A93"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={14}
              textAnchor="middle"
              pointerEvents="none"
            >
              {labels.unknown}
            </text>
            <text
              x={CHIP_W + 12}
              y={CHIP_H / 2 + 4}
              fill="#54617A"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
              letterSpacing="0.06em"
            >
              {labels.sample}
            </text>
          </g>
        )}
      </svg>

      {/* HUD overlays — HTML in rem, NOT SVG text. NO bottom-right. */}
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
        letterSpacing: '0.08em',
        color: canSubmit ? '#37C9B8' : '#B9C4D6',
        zIndex: 5, pointerEvents: 'none',
      }}>
        {hudTR}
      </div>
      <div style={{
        position: 'absolute', bottom: '3rem', left: '3rem',
        fontFamily: "'JetBrains Mono', monospace", fontSize: '2.3rem',
        letterSpacing: '0.06em', color: '#6C7A93',
        zIndex: 5, pointerEvents: 'none', maxWidth: '58%',
      }}>
        {hudBL}
      </div>

      {/* Right panel — aligned with scene box (SVG y=60..400) */}
      <div style={{
        position: 'absolute',
        top: '9.7rem', bottom: '11.1rem',
        right: '6.7rem',
        width: '40rem',
        boxSizing: 'border-box',
        zIndex: 6,
        color: '#B9C4D6',
        fontFamily: "'JetBrains Mono', monospace",
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{
          fontSize: '2.44rem', color: '#6C7A93',
          letterSpacing: '0.1em', marginBottom: '1.2rem', marginLeft: '0.4rem',
        }}>
          {isObserve ? labels.controls : labels.question}
        </div>
        <div style={{
          flex: 1,
          border: '1px solid #12203a', borderRadius: '0.6rem',
          padding: '2.5rem',
          display: 'flex', flexDirection: 'column', gap: '2rem',
          fontSize: '2rem',
          overflow: 'auto',
        }}>
          {isObserve && (
            <ObservePanel labels={labels} activeSample={activeSample} measured={measured} />
          )}
          {isPredict && (
            <PredictPanel
              labels={labels}
              scenario={scenario}
              scenarioIdx={scenarioIdx}
              deckLen={deck.length}
              pick={pick}
              correctAnswer={correctAnswer}
              onPick={pickAnswer}
              onAdvance={advanceScenario}
              peekVisible={peekVisible}
            />
          )}
        </div>
      </div>
    </div>
  )
}

// ─── SVG instrument glyphs ──────────────────────────────────────────────
type InstrumentKind = 'balance' | 'cylinder' | 'thermometer' | 'magnet'

function InstrumentGlyph({ kind, x, y }: { kind: InstrumentKind; x: number; y: number }) {
  const stroke = '#6C7A93'
  const strokeAcc = '#8FA1BE'
  if (kind === 'balance') {
    return (
      <g transform={`translate(${x}, ${y})`}>
        <line x1={-14} y1={0} x2={14} y2={0} stroke={strokeAcc} strokeWidth={1.5} />
        <line x1={0} y1={0} x2={0} y2={12} stroke={stroke} strokeWidth={1.2} />
        <rect x={-6} y={12} width={12} height={4} fill="none" stroke={stroke} strokeWidth={1} />
        <circle cx={-14} cy={0} r={2.2} fill={strokeAcc} />
        <circle cx={14} cy={0} r={2.2} fill={strokeAcc} />
      </g>
    )
  }
  if (kind === 'cylinder') {
    return (
      <g transform={`translate(${x}, ${y})`}>
        <rect x={-6} y={-10} width={12} height={22} fill="none" stroke={stroke} strokeWidth={1.2} rx={1} />
        <line x1={-6} y1={-4} x2={-2} y2={-4} stroke={strokeAcc} strokeWidth={0.8} />
        <line x1={-6} y1={2} x2={-2} y2={2} stroke={strokeAcc} strokeWidth={0.8} />
        <line x1={-6} y1={8} x2={-2} y2={8} stroke={strokeAcc} strokeWidth={0.8} />
      </g>
    )
  }
  if (kind === 'thermometer') {
    return (
      <g transform={`translate(${x}, ${y})`}>
        <rect x={-2.5} y={-10} width={5} height={16} fill="none" stroke={stroke} strokeWidth={1.2} rx={2.5} />
        <circle cx={0} cy={9} r={4.5} fill="none" stroke={stroke} strokeWidth={1.2} />
        <line x1={-2.5} y1={-2} x2={-4.5} y2={-2} stroke={strokeAcc} strokeWidth={0.8} />
        <line x1={-2.5} y1={2} x2={-4.5} y2={2} stroke={strokeAcc} strokeWidth={0.8} />
      </g>
    )
  }
  // magnet — horseshoe
  return (
    <g transform={`translate(${x}, ${y})`}>
      <path
        d="M -8 8 L -8 -2 A 8 8 0 0 1 8 -2 L 8 8 L 4 8 L 4 -2 A 4 4 0 0 0 -4 -2 L -4 8 Z"
        fill="none"
        stroke={stroke}
        strokeWidth={1.4}
      />
      <rect x={-8} y={7} width={4} height={4} fill={strokeAcc} />
      <rect x={4} y={7} width={4} height={4} fill={strokeAcc} />
    </g>
  )
}

// ─── Observe right-panel: sample readings summary ───────────────────────
function ObservePanel({
  labels,
  activeSample,
  measured,
}: {
  labels: ReturnType<typeof svgLabels>
  activeSample: SampleId | null
  measured: Set<SampleId>
}) {
  return (
    <>
      <div style={{ fontSize: '1.9rem', color: '#B9C4D6', lineHeight: 1.5 }}>
        {activeSample ? (
          <>
            {labels.reading}: <strong style={{ color: '#EAF0FA' }}>{sampleLabel(activeSample, labels)}</strong>
          </>
        ) : (
          <span style={{ color: '#6C7A93' }}>{labels.click_prompt}</span>
        )}
      </div>

      {/* Progress table: each sample is a row with its four readings.
          Fills in as they get measured. Serves as the student's memory
          bank for Stage 2. */}
      <div style={{
        border: '1px solid #12203a', borderRadius: '0.5rem',
        overflow: 'hidden',
      }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1.4fr 0.9fr 0.9fr 0.9fr 0.9fr',
          gap: 0,
          fontSize: '1.4rem', color: '#54617A',
          letterSpacing: '0.06em', textTransform: 'uppercase',
          background: '#0F1A2E',
        }}>
          <HeadCell>{labels.sample}</HeadCell>
          <HeadCell>{labels.mass}</HeadCell>
          <HeadCell>{labels.volume}</HeadCell>
          <HeadCell>{labels.temperature}</HeadCell>
          <HeadCell>{labels.magnetic}</HeadCell>
        </div>
        {SAMPLES.map((s) => {
          const seen = measured.has(s.id)
          const active = activeSample === s.id
          return (
            <div
              key={s.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '1.4fr 0.9fr 0.9fr 0.9fr 0.9fr',
                fontSize: '1.5rem',
                background: active ? '#132244' : 'transparent',
                borderTop: '1px solid #12203a',
                color: seen ? '#B9C4D6' : '#3A4863',
              }}
            >
              <BodyCell strong={active} {...(seen ? { color: s.color } : {})}>
                {sampleLabel(s.id, labels)}
              </BodyCell>
              <BodyCell>{seen ? `${s.mass} ${labels.unit_g}` : '·'}</BodyCell>
              <BodyCell>{seen ? `${s.volume} ${labels.unit_ml}` : '·'}</BodyCell>
              <BodyCell>{seen ? `${s.temperature} ${labels.unit_c}` : '·'}</BodyCell>
              <BodyCell>{seen ? (s.magnetic ? labels.yes : labels.no) : '·'}</BodyCell>
            </div>
          )
        })}
      </div>
    </>
  )
}

function HeadCell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: '0.7rem 0.8rem', borderRight: '1px solid #12203a' }}>{children}</div>
  )
}

function BodyCell({
  children,
  strong,
  color,
}: {
  children: React.ReactNode
  strong?: boolean
  color?: string
}) {
  const style: React.CSSProperties = {
    padding: '0.6rem 0.8rem',
    borderRight: '1px solid #12203a',
    fontWeight: strong ? 700 : 400,
  }
  if (color) style.color = color
  return <div style={style}>{children}</div>
}

// ─── Predict right-panel: MCQ over candidates ───────────────────────────
function PredictPanel({
  labels,
  scenario,
  scenarioIdx,
  deckLen,
  pick,
  correctAnswer,
  onPick,
  onAdvance,
  peekVisible,
}: {
  labels: ReturnType<typeof svgLabels>
  scenario: Scenario
  scenarioIdx: number
  deckLen: number
  pick: SampleId | null
  correctAnswer: SampleId
  onPick: (choice: SampleId) => void
  onAdvance: () => void
  peekVisible: boolean
}) {
  const truth = sampleById(scenario.truth)
  const wasCorrect = pick !== null && pick === correctAnswer

  return (
    <>
      {/* Scenario counter */}
      <div style={{ fontSize: '1.5rem', color: '#54617A', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
        {scenarioIdx + 1} / {deckLen}
      </div>

      {/* The measured row — this is the student's question data */}
      <div style={{
        border: '1px solid #12203a', borderRadius: '0.5rem',
        padding: '1.2rem',
        background: '#0F1A2E',
      }}>
        <div style={{
          fontSize: '1.4rem', color: '#54617A',
          letterSpacing: '0.08em', textTransform: 'uppercase',
          marginBottom: '0.8rem',
        }}>
          {labels.row_title}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem 1.2rem', fontSize: '1.7rem', color: '#EAF0FA' }}>
          <ReadingRow labels={labels} label={labels.mass} value={`${truth.mass} ${labels.unit_g}`} />
          <ReadingRow labels={labels} label={labels.volume} value={`${truth.volume} ${labels.unit_ml}`} />
          <ReadingRow labels={labels} label={labels.temperature} value={`${truth.temperature} ${labels.unit_c}`} />
          <ReadingRow labels={labels} label={labels.magnetic} value={truth.magnetic ? labels.yes : labels.no} />
        </div>
      </div>

      <div style={{ fontSize: '1.6rem', color: '#6C7A93', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
        {labels.candidates}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {scenario.candidates.map((cid) => {
          const isPicked = pick === cid
          const isCorrect = pick !== null && cid === correctAnswer
          const isWrong = pick !== null && isPicked && cid !== correctAnswer
          const bg = isCorrect ? '#37C9B8' : isWrong ? '#F97316' : isPicked ? '#3A4863' : 'transparent'
          const fg = isCorrect || isWrong ? '#0D1524' : '#B9C4D6'
          return (
            <button
              key={cid}
              type="button"
              disabled={pick !== null}
              onClick={() => onPick(cid)}
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
              {sampleLabel(cid, labels)}
              {isCorrect ? '  ✓' : isWrong ? '  ✗' : ''}
            </button>
          )
        })}
      </div>

      {peekVisible && (
        <div style={{
          padding: '0.9rem 1rem',
          background: 'rgba(249,169,104,0.12)',
          border: '1px solid #F9A968',
          borderRadius: '0.5rem',
          color: '#F9A968',
          fontSize: '1.55rem',
          lineHeight: 1.4,
        }}>
          {/* Strategy hint, NOT the answer. Points at the discriminating column. */}
          {peekStrategy(scenario, labels)}
        </div>
      )}

      {pick !== null && (
        <button
          type="button"
          onClick={onAdvance}
          style={{
            padding: '1rem 1.4rem',
            background: wasCorrect ? '#37C9B8' : '#F97316',
            color: '#0D1524',
            border: `1px solid ${wasCorrect ? '#37C9B8' : '#F97316'}`,
            borderRadius: '0.5rem',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '1.9rem',
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          {wasCorrect ? `${labels.next_q} →` : `${labels.restart_deck} ↺`}
        </button>
      )}
    </>
  )
}

function ReadingRow({
  labels,
  label,
  value,
}: {
  labels: ReturnType<typeof svgLabels>
  label: string
  value: string
}) {
  void labels
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.6rem' }}>
      <span style={{ color: '#6C7A93', textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: '1.35rem', alignSelf: 'center' }}>
        {label}
      </span>
      <span style={{ color: '#EAF0FA', fontWeight: 600 }}>{value}</span>
    </div>
  )
}

// Peek strategy: for each scenario class, name the discriminating column
// as a physics-of-measurement hint. Never reveals which candidate is right.
function peekStrategy(scenario: Scenario, labels: ReturnType<typeof svgLabels>): string {
  const cands = scenario.candidates.map(sampleById)
  const truth = sampleById(scenario.truth)

  // Find the smallest set of columns that discriminates truth from all distractors.
  const cols: Array<{ key: string; distinct: boolean }> = [
    { key: labels.magnetic, distinct: cands.every((c) => c.id === truth.id || c.magnetic !== truth.magnetic) },
    { key: labels.mass, distinct: cands.every((c) => c.id === truth.id || c.mass !== truth.mass) },
    { key: labels.volume, distinct: cands.every((c) => c.id === truth.id || c.volume !== truth.volume) },
    { key: labels.temperature, distinct: cands.every((c) => c.id === truth.id || c.temperature !== truth.temperature) },
  ]
  const winners = cols.filter((c) => c.distinct).map((c) => c.key)
  if (winners.length > 0) {
    return `Focus on: ${winners.join(' · ')}. That column alone separates the truth from the distractors.`
  }
  // Fallback: no single-column discriminator — teach the compound approach.
  return 'No single column tells them apart — combine two readings (e.g. mass AND volume) to eliminate candidates one by one.'
}
