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

// Scene panel geometry (matches §6 template)
const SCENE_X = 40
const SCENE_Y = 60
const SCENE_W = 500
const SCENE_H = 340

// Three-box row (source, converter, device), all inside scene panel.
const BOX_W = 100
const BOX_H = 90
const BOX_Y = 200
const SRC_X = 70
const CONV_X = 240
const USE_X = 410

// Arrow segments between boxes
const ARROW_Y = BOX_Y + BOX_H / 2

// ─── Domain model ───────────────────────────────────────────────────────
type Form = 'chemical' | 'kinetic' | 'radiant' | 'electric' | 'thermal' | 'mechanical'

type SourceId = 'sun' | 'wind' | 'battery' | 'bike'
type UseId = 'bulb' | 'fan' | 'heater' | 'device'
type ConverterId =
  | 'solar_panel'
  | 'wind_turbine'
  | 'dynamo'
  | 'motor'
  | 'led'
  | 'incandescent'
  | 'resistor_heater'

type SourceSpec = { id: SourceId; form: Form; icon: string }
type UseSpec = { id: UseId; form: Form; icon: string }
type ConverterSpec = {
  id: ConverterId
  input: Form
  output: Form
  eta: number
  icon: string
}

const SOURCES: Record<SourceId, SourceSpec> = {
  sun: { id: 'sun', form: 'radiant', icon: 'bi-sun-fill' },
  wind: { id: 'wind', form: 'kinetic', icon: 'bi-wind' },
  battery: { id: 'battery', form: 'chemical', icon: 'bi-battery-full' },
  bike: { id: 'bike', form: 'kinetic', icon: 'bi-bicycle' },
}

const USES: Record<UseId, UseSpec> = {
  bulb: { id: 'bulb', form: 'radiant', icon: 'bi-lightbulb-fill' },
  fan: { id: 'fan', form: 'mechanical', icon: 'bi-fan' },
  heater: { id: 'heater', form: 'thermal', icon: 'bi-thermometer-high' },
  device: { id: 'device', form: 'electric', icon: 'bi-plug-fill' },
}

// Battery is chemical, but a battery in a real circuit converts chemical → electric
// internally; for 1ère depth we treat 'battery' as delivering chemical to the converter.
// The 'device' use accepts electric (no downstream converter needed).

const CONVERTERS: Record<ConverterId, ConverterSpec> = {
  solar_panel: { id: 'solar_panel', input: 'radiant', output: 'electric', eta: 0.20, icon: 'bi-grid-3x3' },
  wind_turbine: { id: 'wind_turbine', input: 'kinetic', output: 'electric', eta: 0.40, icon: 'bi-fan' },
  dynamo: { id: 'dynamo', input: 'kinetic', output: 'electric', eta: 0.70, icon: 'bi-lightning-charge-fill' },
  motor: { id: 'motor', input: 'electric', output: 'mechanical', eta: 0.80, icon: 'bi-gear-fill' },
  led: { id: 'led', input: 'electric', output: 'radiant', eta: 0.30, icon: 'bi-lightbulb' },
  incandescent: { id: 'incandescent', input: 'electric', output: 'radiant', eta: 0.05, icon: 'bi-lightbulb-off' },
  resistor_heater: { id: 'resistor_heater', input: 'electric', output: 'thermal', eta: 1.00, icon: 'bi-fire' },
}

// Battery is a special source: it delivers 'electric' (we abstract the chemical→electric
// internal step for 1ère depth). This keeps chains sensible.
// Override the source form:
SOURCES.battery.form = 'electric'
// bike (pedaling) is kinetic — OK.

// Chain validity: source.form === converter.input AND converter.output === use.form
function chainValid(sId: SourceId, cId: ConverterId, uId: UseId): boolean {
  const s = SOURCES[sId], c = CONVERTERS[cId], u = USES[uId]
  return s.form === c.input && c.output === u.form
}

function chainOutput(cId: ConverterId, pIn: number): number {
  return CONVERTERS[cId].eta * pIn
}

// ─── MCQ deck ───────────────────────────────────────────────────────────
type Scenario = {
  source: SourceId
  use: UseId
  pIn: number
  pOut: number       // target useful output
  correct: ConverterId
  options: ConverterId[]  // 4 options including the correct one
}

// 5 scenarios covering distinct case-classes:
//  - radiant → electric (solar panel)
//  - kinetic → electric, high eta (dynamo vs turbine)
//  - electric → mechanical (motor)
//  - electric → radiant, needs high-eta pick (led vs incandescent)
//  - electric → thermal (heater)
const PREDICT_DECK: Scenario[] = [
  {
    source: 'sun', use: 'device',
    pIn: 500, pOut: 100,
    correct: 'solar_panel',
    options: ['solar_panel', 'wind_turbine', 'motor', 'led'],
  },
  {
    source: 'bike', use: 'device',
    pIn: 100, pOut: 70,
    correct: 'dynamo',
    options: ['dynamo', 'wind_turbine', 'solar_panel', 'motor'],
  },
  {
    source: 'battery', use: 'fan',
    pIn: 50, pOut: 40,
    correct: 'motor',
    options: ['motor', 'resistor_heater', 'led', 'incandescent'],
  },
  {
    source: 'battery', use: 'bulb',
    pIn: 60, pOut: 18,
    correct: 'led',
    options: ['led', 'incandescent', 'resistor_heater', 'motor'],
  },
  {
    source: 'battery', use: 'heater',
    pIn: 200, pOut: 200,
    correct: 'resistor_heater',
    options: ['resistor_heater', 'motor', 'led', 'incandescent'],
  },
]

// Progress targets
const EXPLORE_TARGET = 4  // witness ≥ 4 distinct converters
const PREDICT_TOL = 0.10  // ±10% tolerance on P_out match

// ─── Label loader ──────────────────────────────────────────────────────
const dict = { en, fr, ar } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

// ─── Component ─────────────────────────────────────────────────────────
export default function Scene() {
  const { locale } = useInit()
  const stages = useMemo(() => getStagesFor(locale), [locale])
  useDeclareStages(stages)
  const labels = useMemo(() => svgLabels(locale), [locale])
  const rootRng = useSeed()

  // Seeded deck shuffle — order changes per attempt but is reproducible.
  const deck = useMemo(() => rootRng.shuffle(PREDICT_DECK) as Scenario[], [rootRng])

  const stageIdx = useCurrentStage()
  const setStage = useSetStage()
  const progress = useProgress()
  const complete = useComplete()

  // Stage roles:
  //  1 = Observe: source/converter/use fixed to a canonical chain (sun→solar→device).
  //      Only DOF: input power slider. Student must see chain react to a change.
  //  2 = Explore: all three dropdowns unlocked + input slider. Must witness N distinct
  //      converters delivering useful output.
  //  3 = Predict: arrows hidden. Scenario shows source, use, pIn, pOut. Student picks
  //      converter from 4 options. Ace-the-deck — one wrong → restart deck.
  const isObserve = stageIdx === 1
  const isExplore = stageIdx === 2
  const isInteractive = isObserve || isExplore
  const isPredict = stageIdx === 3

  // ─── Interactive state ────────────────────────────────────────────
  const [source, setSource] = useState<SourceId>('sun')
  const [converter, setConverter] = useState<ConverterId>('solar_panel')
  const [use_, setUse] = useState<UseId>('device')
  const [pIn, setPIn] = useState(200)  // watts, 0..1000
  const [initialPIn] = useState(200)
  const [pInTouched, setPInTouched] = useState(false)
  const [seenConverters, setSeenConverters] = useState<Set<ConverterId>>(new Set())

  // ─── Predict state ────────────────────────────────────────────────
  const [scenarioIdx, setScenarioIdx] = useState(0)
  const [pick, setPick] = useState<ConverterId | null>(null)
  const [solved, setSolved] = useState(0)  // solved-in-current-pass
  const [failedAt, setFailedAt] = useState<number | null>(null)

  const scenario = deck[scenarioIdx % deck.length]!

  // Chain validity + output for the interactive stages
  const valid = chainValid(source, converter, use_)
  const pOutLive = valid ? chainOutput(converter, pIn) : 0
  const pLostLive = valid ? pIn - pOutLive : 0

  // Progress predicates
  const observeDone = pInTouched && pIn !== initialPIn && valid
  const exploreDone = seenConverters.size >= EXPLORE_TARGET
  const predictDone = solved >= deck.length
  const canSubmit = isObserve ? observeDone : isExplore ? exploreDone : predictDone

  // Record seen converter when the chain is valid + non-zero output
  useEffect(() => {
    if (!isExplore) return
    if (!valid) return
    if (pIn <= 0) return
    setSeenConverters((prev) => {
      if (prev.has(converter)) return prev
      const next = new Set(prev)
      next.add(converter)
      return next
    })
  }, [isExplore, valid, converter, pIn])

  const resetForStage = useCallback((stage: number) => {
    if (stage === 1) {
      setSource('sun')
      setConverter('solar_panel')
      setUse('device')
      setPIn(200)
      setPInTouched(false)
    } else if (stage === 2) {
      setSource('sun')
      setConverter('solar_panel')
      setUse('device')
      setPIn(300)
      setPInTouched(false)
    } else {
      // predict
    }
    setSeenConverters(new Set())
    setScenarioIdx(0)
    setPick(null)
    setSolved(0)
    setFailedAt(null)
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

  // ─── MCQ pick handler ────────────────────────────────────────────
  const pickAnswer = useCallback((cId: ConverterId) => {
    if (pick !== null) return
    setPick(cId)
    const spec = CONVERTERS[cId]
    const srcOk = SOURCES[scenario.source].form === spec.input
    const useOk = USES[scenario.use].form === spec.output
    const powerOk = Math.abs(spec.eta * scenario.pIn - scenario.pOut) <= PREDICT_TOL * scenario.pOut
    const ok = srcOk && useOk && powerOk
    if (ok) {
      setSolved((s) => s + 1)
    } else {
      setFailedAt(scenarioIdx)
    }
  }, [pick, scenario, scenarioIdx])

  const nextScenario = useCallback(() => {
    setPick(null)
    setScenarioIdx((i) => i + 1)
  }, [])

  const restartDeck = useCallback(() => {
    setPick(null)
    setScenarioIdx(0)
    setSolved(0)
    setFailedAt(null)
  }, [])

  // ─── HUD text ────────────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`
  const hudTR = isPredict
    ? `${labels.streak}: ${solved}/${deck.length}`
    : isExplore
      ? `${labels.outcomes_seen}: ${seenConverters.size}/${EXPLORE_TARGET}`
      : `${labels.input_power}: ${Math.round(pIn)} ${labels.watts}`
  const hudBL = isObserve ? labels.tip1 : isExplore ? labels.tip2 : labels.tip3

  // Arrow thickness scales with power (capped visually)
  const maxP = 1000
  const inThickness = clamp(2 + (pIn / maxP) * 16, 2, 18)
  const outThickness = clamp(2 + (pOutLive / maxP) * 16, 2, 18)
  const lostThickness = clamp(1 + (pLostLive / maxP) * 12, 1, 13)

  // Show arrows only on interactive stages
  const showArrows = isInteractive

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block', userSelect: 'none' }}
      >
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        {/* Scene panel — title outside above box */}
        <rect x={SCENE_X} y={SCENE_Y} width={SCENE_W} height={SCENE_H}
              fill="none" stroke="#12203a" strokeWidth={1} rx={6} />
        <text x={SCENE_X + 8} y={SCENE_Y - 8} fill="#6C7A93"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={11} letterSpacing="0.1em">
          {labels.scene_title}
        </text>

        {/* ── Three boxes: source | converter | device ────────────── */}
        <ChainBox
          x={SRC_X}
          y={BOX_Y}
          w={BOX_W}
          h={BOX_H}
          label={labels.source}
          name={isPredict ? sourceName(scenario.source, labels) : sourceName(source, labels)}
          form={isPredict ? SOURCES[scenario.source].form : SOURCES[source].form}
          formLabel={formLabel(isPredict ? SOURCES[scenario.source].form : SOURCES[source].form, labels)}
          iconClass={isPredict ? SOURCES[scenario.source].icon : SOURCES[source].icon}
          accent="#F9A968"
        />
        <ChainBox
          x={CONV_X}
          y={BOX_Y}
          w={BOX_W}
          h={BOX_H}
          label={labels.converter}
          // Blind stage: hide the converter identity behind a "?"
          name={isPredict ? '?' : converterName(converter, labels)}
          form={null}
          formLabel={isPredict ? '' : `η = ${Math.round(CONVERTERS[converter].eta * 100)}%`}
          iconClass={isPredict ? 'bi-question-lg' : CONVERTERS[converter].icon}
          accent={isPredict ? '#6C7A93' : (valid ? '#37C9B8' : '#F97316')}
        />
        <ChainBox
          x={USE_X}
          y={BOX_Y}
          w={BOX_W}
          h={BOX_H}
          label={labels.use}
          name={isPredict ? useName(scenario.use, labels) : useName(use_, labels)}
          form={isPredict ? USES[scenario.use].form : USES[use_].form}
          formLabel={formLabel(isPredict ? USES[scenario.use].form : USES[use_].form, labels)}
          iconClass={isPredict ? USES[scenario.use].icon : USES[use_].icon}
          accent="#7EE3D8"
        />

        {/* ── Arrows (interactive stages only) ────────────────────── */}
        {showArrows && (
          <>
            {/* Input arrow: source → converter */}
            <FlowArrow
              x1={SRC_X + BOX_W} x2={CONV_X}
              y={ARROW_Y}
              thickness={inThickness}
              color="#F9A968"
              label={`${Math.round(pIn)} ${labels.watts}`}
            />
            {/* Useful output arrow: converter → device */}
            <FlowArrow
              x1={CONV_X + BOX_W} x2={USE_X}
              y={ARROW_Y}
              thickness={outThickness}
              color={valid ? '#37C9B8' : '#3A4863'}
              label={valid ? `${Math.round(pOutLive)} ${labels.watts}` : ''}
              dashed={!valid}
            />
            {/* Lost-as-heat band under the converter */}
            {valid && pLostLive > 0 && (
              <g>
                <rect
                  x={CONV_X + 6}
                  y={BOX_Y + BOX_H + 12}
                  width={BOX_W - 12}
                  height={Math.min(18, lostThickness + 3)}
                  fill="#F97316"
                  opacity={0.35}
                  rx={3}
                />
                <text
                  x={CONV_X + BOX_W / 2}
                  y={BOX_Y + BOX_H + 26 + Math.min(18, lostThickness + 3)}
                  fill="#F97316"
                  fontFamily="'JetBrains Mono', monospace"
                  fontSize={10}
                  textAnchor="middle"
                >
                  {labels.lost_power}: {Math.round(pLostLive)} {labels.watts}
                </text>
              </g>
            )}
          </>
        )}

        {/* Blind-stage chain: dashed neutral connectors, no thickness cue */}
        {isPredict && (
          <>
            <line
              x1={SRC_X + BOX_W} y1={ARROW_Y}
              x2={CONV_X} y2={ARROW_Y}
              stroke="#3A4863" strokeWidth={2} strokeDasharray="6 4"
            />
            <line
              x1={CONV_X + BOX_W} y1={ARROW_Y}
              x2={USE_X} y2={ARROW_Y}
              stroke="#3A4863" strokeWidth={2} strokeDasharray="6 4"
            />
          </>
        )}

      </svg>

      {/* HUD overlays — top-left, top-right, bottom-left. BR reserved. */}
      <div style={hudStyleTL}>{hudTL}</div>
      <div style={{ ...hudStyleTR, color: canSubmit ? '#37C9B8' : '#B9C4D6' }}>{hudTR}</div>
      <div style={hudStyleBL}>{hudBL}</div>

      {/* Right panel — controls (interactive) OR question (blind) */}
      <div
        style={{
          position: 'absolute',
          top: '9.7rem', bottom: '11.1rem',
          right: '6.7rem',
          width: '40rem',
          boxSizing: 'border-box',
          zIndex: 6,
          color: '#B9C4D6',
          fontFamily: "'JetBrains Mono', monospace",
          display: 'flex', flexDirection: 'column',
        }}
      >
        <div style={{ fontSize: '2.44rem', color: '#6C7A93', letterSpacing: '0.1em', marginBottom: '1.2rem', marginLeft: '0.4rem' }}>
          {isPredict ? labels.question : labels.controls}
        </div>
        <div
          style={{
            flex: 1,
            border: '1px solid #12203a', borderRadius: '0.6rem',
            padding: '2.2rem',
            display: 'flex', flexDirection: 'column', gap: '2.2rem',
            fontSize: '1.8rem',
            overflow: 'auto',
          }}
        >
          {isInteractive && (
            <>
              <FieldGroup label={labels.field_source}>
                <Select<SourceId>
                  disabled={isObserve}
                  options={(['sun', 'wind', 'battery', 'bike'] as SourceId[]).map((s) => ({
                    value: s, label: sourceName(s, labels),
                  }))}
                  value={source}
                  onChange={setSource}
                />
              </FieldGroup>
              <FieldGroup label={labels.field_converter}>
                <Select<ConverterId>
                  disabled={isObserve}
                  options={(Object.keys(CONVERTERS) as ConverterId[]).map((c) => ({
                    value: c, label: `${converterName(c, labels)} (η=${Math.round(CONVERTERS[c].eta * 100)}%)`,
                  }))}
                  value={converter}
                  onChange={setConverter}
                />
              </FieldGroup>
              <FieldGroup label={labels.field_use}>
                <Select<UseId>
                  disabled={isObserve}
                  options={(['device', 'fan', 'bulb', 'heater'] as UseId[]).map((u) => ({
                    value: u, label: useName(u, labels),
                  }))}
                  value={use_}
                  onChange={setUse}
                />
              </FieldGroup>
              <FieldGroup label={`${labels.field_input}: ${Math.round(pIn)} ${labels.watts}`}>
                <input
                  type="range"
                  min={0}
                  max={1000}
                  step={10}
                  value={pIn}
                  onChange={(e) => {
                    setPIn(Number(e.target.value))
                    setPInTouched(true)
                  }}
                  style={{
                    width: '100%',
                    accentColor: '#F9A968',
                  }}
                />
              </FieldGroup>
              <div style={{
                display: 'flex', flexDirection: 'column', gap: '0.4rem',
                padding: '0.9rem 1rem', border: '1px solid #12203a', borderRadius: '0.5rem',
              }}>
                <div style={{ fontSize: '1.5rem', color: '#54617A', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                  {labels.field_status}
                </div>
                {valid ? (
                  <>
                    <div style={{ fontSize: '1.7rem', color: '#37C9B8' }}>
                      {labels.chain_ok}
                    </div>
                    <div style={{ fontSize: '1.6rem', color: '#B9C4D6' }}>
                      {labels.output_power}: {Math.round(pOutLive)} {labels.watts}
                    </div>
                    <div style={{ fontSize: '1.5rem', color: '#F9A968' }}>
                      {labels.lost_power}: {Math.round(pLostLive)} {labels.watts}
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize: '1.7rem', color: '#F97316' }}>
                    {labels.chain_bad_forms}
                  </div>
                )}
              </div>
            </>
          )}

          {isPredict && (
            <>
              <div style={{ fontSize: '1.7rem', color: '#B9C4D6', lineHeight: 1.5 }}>
                <div style={{ marginBottom: '0.4rem' }}>
                  <span style={{ color: '#6C7A93' }}>{labels.source}:</span>{' '}
                  <strong>{sourceName(scenario.source, labels)}</strong>{' '}
                  <span style={{ color: '#6C7A93' }}>({formLabel(SOURCES[scenario.source].form, labels)})</span>
                </div>
                <div style={{ marginBottom: '0.4rem' }}>
                  <span style={{ color: '#6C7A93' }}>{labels.use}:</span>{' '}
                  <strong>{useName(scenario.use, labels)}</strong>{' '}
                  <span style={{ color: '#6C7A93' }}>({formLabel(USES[scenario.use].form, labels)})</span>
                </div>
                <div style={{ marginBottom: '0.4rem' }}>
                  <span style={{ color: '#6C7A93' }}>{labels.given}:</span>{' '}
                  P<sub>in</sub> = <strong>{scenario.pIn} {labels.watts}</strong>
                </div>
                <div>
                  <span style={{ color: '#6C7A93' }}>{labels.target}:</span>{' '}
                  P<sub>out</sub> ≈ <strong>{scenario.pOut} {labels.watts}</strong>{' '}
                  <span style={{ color: '#6C7A93', fontSize: '1.4rem' }}>
                    (±{Math.round(PREDICT_TOL * 100)}%)
                  </span>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {scenario.options.map((cId) => {
                  const isPicked = pick === cId
                  const isCorrectPick = pick !== null && cId === scenario.correct
                  const isWrongPick = pick !== null && isPicked && cId !== scenario.correct
                  const bg = isCorrectPick ? '#37C9B8' : isWrongPick ? '#F97316' : isPicked ? '#3A4863' : 'transparent'
                  const fg = isCorrectPick || isWrongPick ? '#0D1524' : '#B9C4D6'
                  return (
                    <button
                      key={cId}
                      type="button"
                      disabled={pick !== null}
                      onClick={() => pickAnswer(cId)}
                      style={{
                        padding: '0.9rem 1.2rem',
                        background: bg,
                        color: fg,
                        border: '1px solid #3A4863',
                        borderRadius: '0.5rem',
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: '1.7rem',
                        textAlign: 'left',
                        cursor: pick !== null ? 'default' : 'pointer',
                        opacity: pick !== null && !isPicked && !isCorrectPick ? 0.4 : 1,
                      }}
                    >
                      {converterName(cId, labels)}{' '}
                      <span style={{ opacity: 0.7, fontSize: '1.4rem' }}>
                        (η={Math.round(CONVERTERS[cId].eta * 100)}%)
                      </span>
                      {isCorrectPick ? '  ✓' : isWrongPick ? '  ✗' : ''}
                    </button>
                  )
                })}
              </div>

              {pick !== null && failedAt === null && solved < deck.length && (
                <button type="button" onClick={nextScenario} style={btnStyle('#37C9B8')}>
                  {labels.next_q} →
                </button>
              )}
              {failedAt !== null && (
                <button type="button" onClick={restartDeck} style={btnStyle('#F97316')}>
                  {labels.restart_deck} ↺
                </button>
              )}
              {solved >= deck.length && (
                <div style={{ fontSize: '1.8rem', color: '#37C9B8', textAlign: 'center' }}>
                  ✓ {labels.correct}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── HUD overlay style presets ─────────────────────────────────────────
const hudStyleTL: React.CSSProperties = {
  position: 'absolute', top: '3rem', left: '3rem',
  fontFamily: "'JetBrains Mono', monospace", fontSize: '2.3rem',
  letterSpacing: '0.14em', textTransform: 'uppercase', color: '#6C7A93',
  zIndex: 5, pointerEvents: 'none',
}
const hudStyleTR: React.CSSProperties = {
  position: 'absolute', top: '3rem', right: '3rem',
  fontFamily: "'JetBrains Mono', monospace", fontSize: '2.3rem',
  letterSpacing: '0.08em',
  zIndex: 5, pointerEvents: 'none',
}
const hudStyleBL: React.CSSProperties = {
  position: 'absolute', bottom: '3rem', left: '3rem',
  fontFamily: "'JetBrains Mono', monospace", fontSize: '2.3rem',
  letterSpacing: '0.06em', color: '#6C7A93',
  zIndex: 5, pointerEvents: 'none', maxWidth: '58%',
}

// ─── Small SVG helpers ─────────────────────────────────────────────────
function ChainBox({
  x, y, w, h, label, name, formLabel, iconClass, accent,
}: {
  x: number; y: number; w: number; h: number
  label: string; name: string
  form: Form | null
  formLabel: string
  iconClass: string
  accent: string
}) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      <rect x={0} y={0} width={w} height={h}
        fill="#12203a" stroke={accent} strokeWidth={1.2} rx={6} />
      {/* Top label (outside above the box top-left) */}
      <text x={2} y={-4} fill="#54617A"
        fontFamily="'JetBrains Mono', monospace"
        fontSize={9} letterSpacing="0.1em"
        style={{ textTransform: 'uppercase' }}>
        {label}
      </text>
      {/* Icon — use foreignObject to render Bootstrap Icons glyph */}
      <foreignObject x={w / 2 - 18} y={10} width={36} height={36}>
        <div style={{
          width: 36, height: 36,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: accent, fontSize: 28, lineHeight: 1,
        }}>
          <i className={`bi ${iconClass}`} />
        </div>
      </foreignObject>
      {/* Name */}
      <text x={w / 2} y={h - 22}
        fill="#EAF0FA"
        fontFamily="'JetBrains Mono', monospace"
        fontSize={11}
        textAnchor="middle">
        {name}
      </text>
      {/* Sub-label (form or efficiency) */}
      {formLabel && (
        <text x={w / 2} y={h - 8}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={9}
          textAnchor="middle">
          {formLabel}
        </text>
      )}
    </g>
  )
}

function FlowArrow({
  x1, x2, y, thickness, color, label, dashed = false,
}: {
  x1: number; x2: number; y: number
  thickness: number; color: string
  label: string; dashed?: boolean
}) {
  const headSize = Math.max(6, thickness * 0.9)
  const shaftEnd = x2 - headSize
  return (
    <g>
      <line
        x1={x1} y1={y} x2={shaftEnd} y2={y}
        stroke={color} strokeWidth={thickness}
        strokeLinecap="butt"
        strokeDasharray={dashed ? '6 4' : undefined}
        opacity={0.9}
      />
      <polygon
        points={`${shaftEnd},${y - headSize} ${x2},${y} ${shaftEnd},${y + headSize}`}
        fill={color}
        opacity={0.9}
      />
      {label && (
        <text
          x={(x1 + x2) / 2}
          y={y - Math.max(10, thickness * 0.9) - 4}
          fill={color}
          fontFamily="'JetBrains Mono', monospace"
          fontSize={10}
          textAnchor="middle"
          opacity={0.9}
        >
          {label}
        </text>
      )}
    </g>
  )
}

// ─── HTML control helpers ──────────────────────────────────────────────
function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
      <div style={{
        fontSize: '1.4rem', letterSpacing: '0.1em',
        textTransform: 'uppercase', color: '#54617A',
      }}>
        {label}
      </div>
      {children}
    </div>
  )
}

function Select<T extends string>({
  options, value, onChange, disabled,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
  disabled?: boolean
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as T)}
      style={{
        padding: '0.7rem 0.9rem',
        background: disabled ? 'transparent' : '#12203a',
        color: disabled ? '#54617A' : '#EAF0FA',
        border: '1px solid #3A4863',
        borderRadius: '0.5rem',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '1.6rem',
        cursor: disabled ? 'not-allowed' : 'pointer',
        appearance: 'none',
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} style={{ background: '#0D1524', color: '#EAF0FA' }}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

function btnStyle(color: string): React.CSSProperties {
  return {
    padding: '0.9rem 1.2rem',
    background: 'transparent',
    color,
    border: `1px solid ${color}`,
    borderRadius: '0.5rem',
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: '1.7rem',
    cursor: 'pointer',
  }
}

// ─── Label lookup helpers ──────────────────────────────────────────────
function sourceName(id: SourceId, labels: Record<string, string>): string {
  return labels[`src_${id}`] ?? id
}
function useName(id: UseId, labels: Record<string, string>): string {
  return labels[`use_${id}`] ?? id
}
function converterName(id: ConverterId, labels: Record<string, string>): string {
  return labels[`conv_${id}`] ?? id
}
function formLabel(f: Form, labels: Record<string, string>): string {
  return labels[`form_${f}`] ?? f
}
