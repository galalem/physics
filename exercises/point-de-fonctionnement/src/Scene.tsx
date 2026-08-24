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

// ─── Scene constants ──────────────────────────────────────────────────
const W = 800
const H = 450

// Panels
const LEFT_X = 32
const LEFT_W = 296
const PANEL_TOP = 60
const PANEL_H = 358

const RIGHT_X = 340
const RIGHT_W = 428

// Schematic sub-region (top of left panel)
const SCH_TOP = 76
const SCH_BOT = 236

// Controls sub-region (bottom of left panel)
const CTRL_TOP = 252
const CTRL_H = 162

// Graph plot area (kept above y=350 to leave the BR quadrant free of text
// per §4.3 — parent chrome such as the fullscreen button lives in BR).
const GPLOT_L = RIGHT_X + 52
const GPLOT_R = RIGHT_X + RIGHT_W - 18
const GPLOT_T = PANEL_TOP + 40
const GPLOT_B = 336

// Fixed graph scales
const I_MAX = 2.0   // A
const U_MAX = 20    // V

// Diode fixed threshold (silicon)
const V_D = 0.7

function xForI(I: number): number {
  return GPLOT_L + (I / I_MAX) * (GPLOT_R - GPLOT_L)
}
function yForU(U: number): number {
  return GPLOT_B - (U / U_MAX) * (GPLOT_B - GPLOT_T)
}

// ─── Physics — pure functions ─────────────────────────────────────────
type ReceiverKind = 'resistor' | 'motor' | 'diode'

type ReceiverParams = {
  R: number       // passive resistor value (Ω)
  Eprime: number  // motor back-emf (V)
  rprime: number  // motor internal resistance (Ω)
}

// Load line: U = E − r·I  (voltage across the receiver as a function of I).
function loadLineU(E: number, r: number, I: number): number {
  return E - r * I
}

// Receiver characteristic U(I).
function receiverU(kind: ReceiverKind, p: ReceiverParams, I: number): number {
  if (kind === 'resistor') return p.R * I
  if (kind === 'motor') return p.Eprime + p.rprime * I
  // diode (ideal): U pinned at Vd once conducting.
  return V_D
}

// Operating point = intersection of load line with receiver characteristic.
// Test vectors:
//  E=12, r=2, resistor R=10 → I*=12/12=1.0 A, U*=10 V
//  E=8,  r=2, motor E'=4, r'=2 → I*=(8−4)/(2+2)=1.0 A, U*=4+2·1=6 V
//  E=5,  r=2, diode Vd=0.7 → I*=(5−0.7)/2=2.15 A, U*=0.7 V
function operatingPoint(
  E: number,
  r: number,
  kind: ReceiverKind,
  p: ReceiverParams,
): { I: number; U: number } {
  if (kind === 'resistor') {
    const denom = r + p.R
    if (denom <= 0) return { I: 0, U: 0 }
    const I = Math.max(0, E) / denom
    return { I, U: p.R * I }
  }
  if (kind === 'motor') {
    if (E <= p.Eprime) return { I: 0, U: p.Eprime }
    const denom = r + p.rprime
    if (denom <= 0) return { I: 0, U: p.Eprime }
    const I = (E - p.Eprime) / denom
    return { I, U: p.Eprime + p.rprime * I }
  }
  // diode
  if (E <= V_D) return { I: 0, U: E }
  if (r <= 0) return { I: 0, U: V_D }
  return { I: (E - V_D) / r, U: V_D }
}

// ─── Labels ───────────────────────────────────────────────────────────
const dict = { en } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── Stage-2 target sets (HAND-AUTHORED — seed picks) ────────────────
type TargetSet = {
  kind: ReceiverKind
  R: number
  Eprime: number
  rprime: number
  target_I: number
  target_U: number
}
const TARGET_SETS: TargetSet[] = [
  // R=10 Ω: student needs E = 10 + r; any (E, r) on that line hits I*=1, U*=10.
  { kind: 'resistor', R: 10, Eprime: 0, rprime: 0, target_I: 1.0, target_U: 10.0 },
  // Motor E'=4, r'=2: student needs E = 5 + 0.5·r; hits I*=0.5, U*=5.
  { kind: 'motor', R: 10, Eprime: 4, rprime: 2, target_I: 0.5, target_U: 5.0 },
  // R=20 Ω: student needs E = 10 + 0.5·r; hits I*=0.5, U*=10.
  { kind: 'resistor', R: 20, Eprime: 0, rprime: 0, target_I: 0.5, target_U: 10.0 },
]

// ─── Stage-3 scenario deck (seed picks starting index; ace 3 in a row) ──
type Scenario = {
  kind: ReceiverKind
  E: number
  r: number
  R: number
  Eprime: number
  rprime: number
  ans_I: number
  ans_U: number
}
const SCENARIOS: Scenario[] = [
  { kind: 'resistor', E: 12, r: 2, R: 10, Eprime: 0, rprime: 0, ans_I: 1.0, ans_U: 10.0 },
  { kind: 'motor', E: 8, r: 2, R: 10, Eprime: 4, rprime: 2, ans_I: 1.0, ans_U: 6.0 },
  { kind: 'resistor', E: 12, r: 4, R: 20, Eprime: 0, rprime: 0, ans_I: 0.5, ans_U: 10.0 },
  { kind: 'motor', E: 11, r: 2, R: 10, Eprime: 6, rprime: 3, ans_I: 1.0, ans_U: 9.0 },
  { kind: 'resistor', E: 15, r: 5, R: 25, Eprime: 0, rprime: 0, ans_I: 0.5, ans_U: 12.5 },
  { kind: 'motor', E: 10, r: 1, R: 10, Eprime: 4, rprime: 3, ans_I: 1.5, ans_U: 8.5 },
]

const DECK_SIZE = 3
const ATTEMPTS_PER_SCENARIO = 3
const NUMERIC_TOLERANCE = 0.05

// ─── Slider ranges ────────────────────────────────────────────────────
const E_MIN = 0, E_MAX = 20, E_STEP = 0.5
const R_INT_MIN = 0, R_INT_MAX = 10, R_INT_STEP = 0.5
const R_RECV_MIN = 5, R_RECV_MAX = 50, R_RECV_STEP = 1
const EPRIME_MIN = 0, EPRIME_MAX = 10, EPRIME_STEP = 0.5
const RPRIME_MIN = 0, RPRIME_MAX = 5, RPRIME_STEP = 0.5

// ═════════════════════════════════════════════════════════════════════
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

  // ── Free-play state (stages 1 + 2) ─────────────────────────────────
  const [E, setE] = useState(10)
  const [rInt, setRInt] = useState(2)
  const [R_recv, setRRecv] = useState(10)
  const [Eprime, setEprime] = useState(4)
  const [rprime, setRprime] = useState(2)
  const [kind, setKind] = useState<ReceiverKind>('resistor')

  // Stage-2 target set — freeze receiver kind + receiver params.
  const targetSet = useMemo<TargetSet>(
    () => TARGET_SETS[seed % TARGET_SETS.length]!,
    [seed],
  )
  useEffect(() => {
    if (!isStage2) return
    setKind(targetSet.kind)
    if (targetSet.kind === 'resistor') setRRecv(targetSet.R)
    if (targetSet.kind === 'motor') {
      setEprime(targetSet.Eprime)
      setRprime(targetSet.rprime)
    }
  }, [isStage2, targetSet])

  const params: ReceiverParams = { R: R_recv, Eprime, rprime }
  const op = operatingPoint(E, rInt, kind, params)

  // ── Stage-1 coverage flags ─────────────────────────────────────────
  const [sawResistor, setSawResistor] = useState(false)
  const [sawMotor, setSawMotor] = useState(false)
  const [sawDiode, setSawDiode] = useState(false)
  const [sawMoved, setSawMoved] = useState(false)
  const [firstOpI, setFirstOpI] = useState<number | null>(null)

  useEffect(() => {
    if (!isStage1) return
    if (kind === 'resistor' && !sawResistor) setSawResistor(true)
    if (kind === 'motor' && !sawMotor) setSawMotor(true)
    if (kind === 'diode' && !sawDiode) setSawDiode(true)
  }, [isStage1, kind, sawResistor, sawMotor, sawDiode])

  useEffect(() => {
    if (!isStage1) return
    if (op.I <= 0.05) return
    if (firstOpI === null) { setFirstOpI(op.I); return }
    if (Math.abs(op.I - firstOpI) > 0.2 && !sawMoved) setSawMoved(true)
  }, [isStage1, op.I, firstOpI, sawMoved])

  // ── Stage-2 target-hit flags ───────────────────────────────────────
  const [hitI, setHitI] = useState(false)
  const [hitU, setHitU] = useState(false)
  useEffect(() => {
    if (!isStage2) return
    if (Math.abs(op.I - targetSet.target_I) / targetSet.target_I < NUMERIC_TOLERANCE && !hitI) {
      setHitI(true)
    }
    if (Math.abs(op.U - targetSet.target_U) / targetSet.target_U < NUMERIC_TOLERANCE && !hitU) {
      setHitU(true)
    }
  }, [isStage2, op, targetSet, hitI, hitU])

  // ── Stage-3 blind state ────────────────────────────────────────────
  const deckStart = seed % SCENARIOS.length
  const [deckIdx, setDeckIdx] = useState(0)
  const [scenarioOffset, setScenarioOffset] = useState(0)
  const [attemptsLeft, setAttemptsLeft] = useState(ATTEMPTS_PER_SCENARIO)
  const [inputI, setInputI] = useState('')
  const [inputU, setInputU] = useState('')
  const [feedback, setFeedback] = useState<null | 'correct' | 'wrong' | 'exhausted'>(null)
  const scenario = SCENARIOS[(deckStart + scenarioOffset) % SCENARIOS.length]!

  const parseNum = (s: string): number | null => {
    const cleaned = s.trim().replace(',', '.')
    if (cleaned === '') return null
    const n = Number(cleaned)
    return Number.isFinite(n) ? n : null
  }

  const submitStage3 = useCallback(() => {
    if (feedback === 'correct') return
    const vI = parseNum(inputI)
    const vU = parseNum(inputU)
    if (vI === null || vU === null) return
    const okI = Math.abs(vI - scenario.ans_I) / scenario.ans_I < NUMERIC_TOLERANCE
    const okU = Math.abs(vU - scenario.ans_U) / scenario.ans_U < NUMERIC_TOLERANCE
    if (okI && okU) {
      setFeedback('correct')
      const nextDeck = deckIdx + 1
      setTimeout(() => {
        if (nextDeck >= DECK_SIZE) {
          setDeckIdx(nextDeck)
        } else {
          setDeckIdx(nextDeck)
          setScenarioOffset((o) => o + 1)
          setAttemptsLeft(ATTEMPTS_PER_SCENARIO)
          setInputI('')
          setInputU('')
          setFeedback(null)
        }
      }, 900)
    } else {
      const remaining = attemptsLeft - 1
      if (remaining <= 0) {
        setFeedback('exhausted')
        setTimeout(() => {
          setDeckIdx(0)
          setScenarioOffset((o) => o + 1)
          setAttemptsLeft(ATTEMPTS_PER_SCENARIO)
          setInputI('')
          setInputU('')
          setFeedback(null)
        }, 1600)
      } else {
        setFeedback('wrong')
        setAttemptsLeft(remaining)
        setTimeout(() => {
          setInputI('')
          setInputU('')
          setFeedback(null)
        }, 900)
      }
    }
  }, [feedback, inputI, inputU, scenario, deckIdx, attemptsLeft])

  // ── Advance predicates ─────────────────────────────────────────────
  const stage1Done = sawResistor && sawMotor && sawDiode && sawMoved
  const stage2Done = hitI && hitU
  const stage3Done = deckIdx >= DECK_SIZE
  const canSubmit = isStage1 ? stage1Done : isStage2 ? stage2Done : stage3Done

  // ── Reset ──────────────────────────────────────────────────────────
  const resetStageState = useCallback(() => {
    setE(10); setRInt(2); setRRecv(10); setEprime(4); setRprime(2); setKind('resistor')
    setSawResistor(false); setSawMotor(false); setSawDiode(false); setSawMoved(false)
    setFirstOpI(null); setHitI(false); setHitU(false)
    setDeckIdx(0); setScenarioOffset(0); setAttemptsLeft(ATTEMPTS_PER_SCENARIO)
    setInputI(''); setInputU(''); setFeedback(null)
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

  // ── Peek — text strategy hint only, no numeric reveal ──────────────
  const [peekText, setPeekText] = useState<string | null>(null)
  usePeek(() => {
    if (!isStage3) return
    setPeekText(labels.peek_tip)
  })
  useEffect(() => {
    if (!peekText) return
    const t = setTimeout(() => setPeekText(null), 5500)
    return () => clearTimeout(t)
  }, [peekText])

  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  // ── Active circuit params (stage 3 uses scenario's fixed values) ───
  const activeE = isStage3 ? scenario.E : E
  const activeRint = isStage3 ? scenario.r : rInt
  const activeKind = isStage3 ? scenario.kind : kind
  const activeParams: ReceiverParams = isStage3
    ? { R: scenario.R, Eprime: scenario.Eprime, rprime: scenario.rprime }
    : params
  const activeOp = isStage3
    ? { I: scenario.ans_I, U: scenario.ans_U }
    : op

  // On stage 3 we reveal the OP only after correct or exhausted feedback.
  const hideOp = isStage3 && feedback !== 'correct' && feedback !== 'exhausted'

  // ── HUD text ───────────────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`

  const stage1Progress =
    `${sawResistor ? '✓' : '·'} R  ${sawMotor ? '✓' : '·'} M  ${sawDiode ? '✓' : '·'} D  ${sawMoved ? '✓' : '·'} ${labels.coverage_moved}`
  const fmt2 = (v: number) => v.toFixed(2)
  const stage2Progress =
    `${labels.targets}  I*=${fmt2(targetSet.target_I)}A ${hitI ? '✓' : ' '}   U*=${fmt2(targetSet.target_U)}V ${hitU ? '✓' : ' '}`
  const stage3Progress =
    `${labels.deck} ${Math.min(deckIdx, DECK_SIZE)}/${DECK_SIZE}   ${labels.attempts_left}: ${attemptsLeft}`
  const hudTR = isStage1 ? stage1Progress : isStage2 ? stage2Progress : stage3Progress

  const hudBL = isStage3
    ? (peekText ?? labels.tip3)
    : isStage2
      ? labels.tip2
      : labels.tip1

  const scenarioTarget = isStage2
    ? { I: targetSet.target_I, U: targetSet.target_U }
    : null

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block', userSelect: 'none' }}
      >
        {/* Background — no rx per §4.4 */}
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        {/* Left panel: schematic + controls */}
        <rect x={LEFT_X} y={PANEL_TOP} width={LEFT_W} height={PANEL_H}
              fill="none" stroke="#12203a" strokeWidth={1} rx={6} />
        <text x={LEFT_X + 8} y={PANEL_TOP - 8}
              fill="#6C7A93" fontFamily="'JetBrains Mono', monospace"
              fontSize={11} letterSpacing="0.1em">
          {labels.schematic}
        </text>

        <SchematicDiagram
          E={activeE}
          rInt={activeRint}
          kind={activeKind}
          params={activeParams}
        />

        {/* Controls (foreignObject) */}
        <foreignObject x={LEFT_X + 8} y={CTRL_TOP} width={LEFT_W - 16} height={CTRL_H}>
          <div
            {...({ xmlns: 'http://www.w3.org/1999/xhtml' } as { xmlns: string })}
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              fontFamily: "'JetBrains Mono', monospace",
              color: '#B9C4D6',
              fontSize: 10,
            }}
          >
            {isStage3 ? (
              <Stage3Entry
                labels={labels}
                deckIdx={deckIdx}
                scenario={scenario}
                inputI={inputI}
                setInputI={setInputI}
                inputU={inputU}
                setInputU={setInputU}
                feedback={feedback}
                onSubmit={submitStage3}
                parseNum={parseNum}
              />
            ) : (
              <>
                {isStage1 && (
                  <ReceiverToggle labels={labels} kind={kind} onChange={setKind} />
                )}
                <SliderRow
                  label={`E = ${E.toFixed(1)} V`}
                  min={E_MIN} max={E_MAX} step={E_STEP} value={E}
                  onChange={setE} accent="#F9A968"
                />
                <SliderRow
                  label={`r = ${rInt.toFixed(1)} Ω`}
                  min={R_INT_MIN} max={R_INT_MAX} step={R_INT_STEP} value={rInt}
                  onChange={setRInt} accent="#8AB3FF"
                />
                {kind === 'resistor' && (
                  <SliderRow
                    label={`R = ${R_recv} Ω`}
                    min={R_RECV_MIN} max={R_RECV_MAX} step={R_RECV_STEP} value={R_recv}
                    onChange={setRRecv} accent="#37C9B8"
                    disabled={isStage2}
                  />
                )}
                {kind === 'motor' && (
                  <>
                    <SliderRow
                      label={`E' = ${Eprime.toFixed(1)} V`}
                      min={EPRIME_MIN} max={EPRIME_MAX} step={EPRIME_STEP} value={Eprime}
                      onChange={setEprime} accent="#37C9B8"
                      disabled={isStage2}
                    />
                    <SliderRow
                      label={`r' = ${rprime.toFixed(1)} Ω`}
                      min={RPRIME_MIN} max={RPRIME_MAX} step={RPRIME_STEP} value={rprime}
                      onChange={setRprime} accent="#37C9B8"
                      disabled={isStage2}
                    />
                  </>
                )}
                {kind === 'diode' && (
                  <div style={{ color: '#6C7A93', fontSize: 10, marginTop: 2 }}>
                    {labels.diode_note}
                  </div>
                )}
                {/* Live formula strip — HIDDEN on stage 3 per §4.7 */}
                <div style={{
                  marginTop: 4,
                  padding: '4px 6px',
                  background: '#111c30',
                  border: '1px solid #3A4863',
                  borderRadius: 4,
                }}>
                  <div style={{ color: '#37C9B8' }}>
                    I* = {op.I.toFixed(2)} A
                  </div>
                  <div style={{ color: '#F9A968', marginTop: 2 }}>
                    U* = {op.U.toFixed(2)} V
                  </div>
                </div>
              </>
            )}
          </div>
        </foreignObject>

        {/* Right panel: I-U graph */}
        <rect x={RIGHT_X} y={PANEL_TOP} width={RIGHT_W} height={PANEL_H}
              fill="none" stroke="#12203a" strokeWidth={1} rx={6} />
        <text x={RIGHT_X + 8} y={PANEL_TOP - 8}
              fill="#6C7A93" fontFamily="'JetBrains Mono', monospace"
              fontSize={11} letterSpacing="0.1em">
          {labels.graph}
        </text>

        <IUGraph
          E={activeE}
          rInt={activeRint}
          kind={activeKind}
          params={activeParams}
          op={activeOp}
          hideOp={hideOp}
          scenarioTarget={scenarioTarget}
          labels={labels}
        />
      </svg>

      {/* HUD overlays — HTML in rem */}
      <div style={{
        position: 'absolute', top: '3rem', left: '3rem',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '2.3rem', letterSpacing: '0.14em', textTransform: 'uppercase',
        color: '#6C7A93', zIndex: 5, pointerEvents: 'none',
      }}>
        {hudTL}
      </div>
      <div style={{
        position: 'absolute', top: '3rem', right: '3rem',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '1.5rem', letterSpacing: '0.08em',
        color: canSubmit ? '#37C9B8' : '#B9C4D6',
        zIndex: 5, pointerEvents: 'none', textAlign: 'right', maxWidth: '55%',
      }}>
        {hudTR}
      </div>
      <div style={{
        position: 'absolute', bottom: '3rem', left: '3rem',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '1.5rem', letterSpacing: '0.06em',
        color: '#6C7A93', zIndex: 5, pointerEvents: 'none', maxWidth: '58%',
      }}>
        {hudBL}
      </div>
      {/* BR is intentionally empty — reserved for parent chrome (§4.3). */}
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════
//  Sub-components
// ═════════════════════════════════════════════════════════════════════

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <div style={{ color: disabled ? '#54617A' : accent, fontSize: 10 }}>{label}</div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{
          width: '100%', height: 10, accentColor: accent,
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
        }}
      />
    </div>
  )
}

function ReceiverToggle({
  labels, kind, onChange,
}: {
  labels: Record<string, string>
  kind: ReceiverKind
  onChange: (k: ReceiverKind) => void
}) {
  const items: Array<[ReceiverKind, string]> = [
    ['resistor', labels.recv_resistor ?? 'resistor'],
    ['motor', labels.recv_motor ?? 'motor'],
    ['diode', labels.recv_diode ?? 'diode'],
  ]
  return (
    <div style={{ display: 'flex', gap: 3, marginBottom: 2 }}>
      {items.map(([k, name]) => {
        const active = k === kind
        return (
          <button
            key={k}
            type="button"
            onClick={() => onChange(k)}
            style={{
              flex: 1,
              padding: '4px 2px',
              background: active ? '#1a2a44' : '#111c30',
              color: active ? '#F9A968' : '#6C7A93',
              border: `1px solid ${active ? '#F9A968' : '#3A4863'}`,
              borderRadius: 4,
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 9,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              cursor: 'pointer',
            }}
          >
            {name}
          </button>
        )
      })}
    </div>
  )
}

function Stage3Entry({
  labels, deckIdx, scenario, inputI, setInputI, inputU, setInputU,
  feedback, onSubmit, parseNum,
}: {
  labels: Record<string, string>
  deckIdx: number
  scenario: Scenario
  inputI: string
  setInputI: (s: string) => void
  inputU: string
  setInputU: (s: string) => void
  feedback: null | 'correct' | 'wrong' | 'exhausted'
  onSubmit: () => void
  parseNum: (s: string) => number | null
}) {
  const kindLabel =
    scenario.kind === 'resistor' ? labels.recv_resistor
    : scenario.kind === 'motor' ? labels.recv_motor
    : labels.recv_diode
  const recvParams =
    scenario.kind === 'resistor' ? `R=${scenario.R}Ω`
    : scenario.kind === 'motor' ? `E'=${scenario.Eprime}V · r'=${scenario.rprime}Ω`
    : `Vd=${V_D}V`
  const borderColor =
    feedback === 'correct' ? '#37C9B8'
    : feedback === 'wrong' || feedback === 'exhausted' ? '#EF4444'
    : '#3A4863'
  const inputsDisabled = feedback === 'correct' || feedback === 'exhausted'
  const bothParsed = parseNum(inputI) !== null && parseNum(inputU) !== null
  return (
    <>
      <div style={{ color: '#6C7A93' }}>
        {labels.scenario_progress} {Math.min(deckIdx + 1, DECK_SIZE)} {labels.of} {DECK_SIZE} · {kindLabel}
      </div>
      <div style={{ color: '#B9C4D6', marginTop: 2 }}>
        {labels.given}: E={scenario.E}V · r={scenario.r}Ω
      </div>
      <div style={{ color: '#B9C4D6' }}>{recvParams}</div>
      <div style={{ color: '#8AB3FF', marginTop: 2 }}>
        {labels.solve_for} I* ({labels.unit_amp}), U* ({labels.unit_volt})
      </div>
      <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
        <div style={{
          flex: 1, padding: 3, background: '#111c30',
          border: `1px solid ${borderColor}`, borderRadius: 4,
        }}>
          <input
            type="text" inputMode="decimal" value={inputI}
            onChange={(e) => setInputI(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') onSubmit() }}
            disabled={inputsDisabled}
            placeholder="I* (A)"
            style={{
              width: '100%', background: 'transparent', color: '#EAF0FA',
              border: 'none', outline: 'none',
              fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
            }}
          />
        </div>
        <div style={{
          flex: 1, padding: 3, background: '#111c30',
          border: `1px solid ${borderColor}`, borderRadius: 4,
        }}>
          <input
            type="text" inputMode="decimal" value={inputU}
            onChange={(e) => setInputU(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') onSubmit() }}
            disabled={inputsDisabled}
            placeholder="U* (V)"
            style={{
              width: '100%', background: 'transparent', color: '#EAF0FA',
              border: 'none', outline: 'none',
              fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
            }}
          />
        </div>
      </div>
      <button
        type="button" onClick={onSubmit}
        disabled={inputsDisabled || !bothParsed}
        style={{
          marginTop: 4, padding: '5px 8px',
          background:
            feedback === 'correct' ? '#37C9B8'
            : feedback === 'wrong' || feedback === 'exhausted' ? '#EF4444'
            : '#1a2a44',
          color: '#EAF0FA',
          border: `1px solid ${borderColor}`,
          borderRadius: 4,
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase',
          cursor: inputsDisabled || !bothParsed ? 'not-allowed' : 'pointer',
        }}
      >
        {feedback === 'correct' ? labels.correct
          : feedback === 'wrong' || feedback === 'exhausted' ? labels.wrong
          : labels.submit}
      </button>
      {feedback === 'exhausted' && (
        <div style={{ marginTop: 3, color: '#EF4444', fontSize: 10 }}>
          I* = {scenario.ans_I.toFixed(2)} A · U* = {scenario.ans_U.toFixed(2)} V
        </div>
      )}
    </>
  )
}

// ─── Schematic (compact rectangular loop) ─────────────────────────────
function SchematicDiagram({
  E, rInt, kind, params,
}: {
  E: number
  rInt: number
  kind: ReceiverKind
  params: ReceiverParams
}) {
  const L = LEFT_X + 44
  const R = LEFT_X + LEFT_W - 44
  const T = SCH_TOP + 8
  const B = SCH_BOT - 8
  const mid = (T + B) / 2
  const stroke = '#54617A'
  return (
    <g>
      {/* Loop wires with cutouts on left arm (generator) and right arm (receiver). */}
      <line x1={L} y1={T} x2={R} y2={T} stroke={stroke} strokeWidth={2} />
      <line x1={L} y1={B} x2={R} y2={B} stroke={stroke} strokeWidth={2} />
      <line x1={L} y1={T} x2={L} y2={mid - 22} stroke={stroke} strokeWidth={2} />
      <line x1={L} y1={mid + 22} x2={L} y2={B} stroke={stroke} strokeWidth={2} />
      <line x1={R} y1={T} x2={R} y2={mid - 22} stroke={stroke} strokeWidth={2} />
      <line x1={R} y1={mid + 22} x2={R} y2={B} stroke={stroke} strokeWidth={2} />

      {/* Corner dots */}
      {[[L, T], [R, T], [L, B], [R, B]].map(([x, y], i) => (
        <circle key={`c${i}`} cx={x} cy={y} r={2.5} fill="#3A4863" />
      ))}

      {/* Generator (battery symbol) on left arm */}
      <g transform={`translate(${L}, ${mid})`}>
        <line x1={0} y1={-14} x2={0} y2={-4} stroke={stroke} strokeWidth={2} />
        <line x1={0} y1={4} x2={0} y2={14} stroke={stroke} strokeWidth={2} />
        <line x1={-9} y1={-4} x2={9} y2={-4} stroke="#B9C4D6" strokeWidth={2} />
        <line x1={-6} y1={4} x2={6} y2={4} stroke="#B9C4D6" strokeWidth={5} />
      </g>
      <text x={L - 8} y={mid - 3}
            fill="#F9A968" fontFamily="'JetBrains Mono', monospace"
            fontSize={11} textAnchor="end">
        E={E.toFixed(1)}V
      </text>
      <text x={L - 8} y={mid + 12}
            fill="#8AB3FF" fontFamily="'JetBrains Mono', monospace"
            fontSize={10} textAnchor="end">
        r={rInt.toFixed(1)}Ω
      </text>

      {/* Receiver on right arm */}
      <g transform={`translate(${R}, ${mid})`}>
        {kind === 'resistor' && <ResistorGlyph />}
        {kind === 'motor' && <MotorGlyph />}
        {kind === 'diode' && <DiodeGlyph />}
      </g>
      {kind === 'resistor' && (
        <text x={R + 12} y={mid + 4}
              fill="#37C9B8" fontFamily="'JetBrains Mono', monospace" fontSize={11}>
          R={params.R}Ω
        </text>
      )}
      {kind === 'motor' && (
        <>
          <text x={R + 12} y={mid - 3}
                fill="#37C9B8" fontFamily="'JetBrains Mono', monospace" fontSize={11}>
            E'={params.Eprime.toFixed(1)}V
          </text>
          <text x={R + 12} y={mid + 12}
                fill="#37C9B8" fontFamily="'JetBrains Mono', monospace" fontSize={10}>
            r'={params.rprime.toFixed(1)}Ω
          </text>
        </>
      )}
      {kind === 'diode' && (
        <text x={R + 12} y={mid + 4}
              fill="#37C9B8" fontFamily="'JetBrains Mono', monospace" fontSize={11}>
          Vd={V_D}V
        </text>
      )}
    </g>
  )
}

function ResistorGlyph() {
  // Vertical resistor centered on origin (rotate 90°).
  return (
    <g transform="rotate(90)">
      <line x1={-22} y1={0} x2={-14} y2={0} stroke="#54617A" strokeWidth={2} />
      <line x1={14} y1={0} x2={22} y2={0} stroke="#54617A" strokeWidth={2} />
      <rect x={-14} y={-6} width={28} height={12}
            fill="#131F35" stroke="#B9C4D6" strokeWidth={1.4} rx={2} />
    </g>
  )
}

function MotorGlyph() {
  return (
    <g>
      <line x1={0} y1={-22} x2={0} y2={-13} stroke="#54617A" strokeWidth={2} />
      <line x1={0} y1={13} x2={0} y2={22} stroke="#54617A" strokeWidth={2} />
      <circle cx={0} cy={0} r={13}
              fill="#131F35" stroke="#B9C4D6" strokeWidth={1.4} />
      <text x={0} y={4}
            fill="#B9C4D6" fontFamily="'JetBrains Mono', monospace"
            fontSize={11} textAnchor="middle">M</text>
    </g>
  )
}

function DiodeGlyph() {
  return (
    <g>
      <line x1={0} y1={-22} x2={0} y2={-10} stroke="#54617A" strokeWidth={2} />
      <line x1={0} y1={8} x2={0} y2={22} stroke="#54617A" strokeWidth={2} />
      <polygon points="-9,-10 9,-10 0,8" fill="#B9C4D6" />
      <line x1={-9} y1={8} x2={9} y2={8} stroke="#B9C4D6" strokeWidth={2} />
    </g>
  )
}

// ─── I-U graph ────────────────────────────────────────────────────────
function IUGraph({
  E, rInt, kind, params, op, hideOp, scenarioTarget, labels,
}: {
  E: number
  rInt: number
  kind: ReceiverKind
  params: ReceiverParams
  op: { I: number; U: number }
  hideOp: boolean
  scenarioTarget: { I: number; U: number } | null
  labels: Record<string, string>
}) {
  // Load line: two clipped endpoints inside the plot rectangle.
  const loadEndpoints: Array<[number, number]> = []
  // Left endpoint at I=0: U=E (clip to U_MAX).
  loadEndpoints.push([0, Math.min(Math.max(E, 0), U_MAX)])
  // Right endpoint: either at I=I_MAX (U = E − r·I_MAX, possibly negative)
  // or at U=0 (I = E/r) if that's smaller than I_MAX.
  const I_atU0 = rInt > 0 ? E / rInt : I_MAX
  const rightI = Math.min(I_MAX, Math.max(0, I_atU0))
  const rightU = Math.max(0, loadLineU(E, rInt, rightI))
  loadEndpoints.push([rightI, rightU])
  const loadPath = loadEndpoints
    .map(([I, U]) => `${xForI(I)},${yForU(U)}`)
    .join(' ')

  // Receiver characteristic — sample or explicit segments.
  let recvSegments: React.ReactNode
  if (kind === 'diode') {
    // Vertical rise at I=0 from U=0 to U=Vd, then horizontal at U=Vd.
    recvSegments = (
      <>
        <line
          x1={xForI(0)} y1={yForU(0)}
          x2={xForI(0)} y2={yForU(V_D)}
          stroke="#37C9B8" strokeWidth={2} strokeLinecap="round"
        />
        <line
          x1={xForI(0)} y1={yForU(V_D)}
          x2={xForI(I_MAX)} y2={yForU(V_D)}
          stroke="#37C9B8" strokeWidth={2} strokeLinecap="round"
        />
      </>
    )
  } else {
    // Linear receiver — straight line from (0, U(0)) to (I_MAX, U(I_MAX))
    // clipped to top of plot.
    const U0 = receiverU(kind, params, 0)
    const U1 = receiverU(kind, params, I_MAX)
    // Clip the top-out point: if U1 > U_MAX, find I where U = U_MAX.
    let clipI = I_MAX
    let clipU = U1
    if (U1 > U_MAX) {
      // U = U0 + slope*I ; slope = (U1-U0)/I_MAX
      const slope = (U1 - U0) / I_MAX
      if (slope > 0) clipI = (U_MAX - U0) / slope
      clipU = U_MAX
    }
    recvSegments = (
      <line
        x1={xForI(0)} y1={yForU(U0)}
        x2={xForI(clipI)} y2={yForU(clipU)}
        stroke="#37C9B8" strokeWidth={2} strokeLinecap="round"
      />
    )
  }

  const iTicks = [0, 0.5, 1.0, 1.5, 2.0]
  const uTicks = [0, 5, 10, 15, 20]

  return (
    <g>
      {/* Grid */}
      {iTicks.map((I) => (
        <line
          key={`ig${I}`}
          x1={xForI(I)} y1={GPLOT_T}
          x2={xForI(I)} y2={GPLOT_B}
          stroke="#12203a" strokeWidth={0.6}
        />
      ))}
      {uTicks.map((U) => (
        <line
          key={`ug${U}`}
          x1={GPLOT_L} y1={yForU(U)}
          x2={GPLOT_R} y2={yForU(U)}
          stroke="#12203a" strokeWidth={0.6}
        />
      ))}

      {/* Axes */}
      <line x1={GPLOT_L} y1={GPLOT_T} x2={GPLOT_L} y2={GPLOT_B}
            stroke="#3A4863" strokeWidth={1} />
      <line x1={GPLOT_L} y1={GPLOT_B} x2={GPLOT_R} y2={GPLOT_B}
            stroke="#3A4863" strokeWidth={1} />

      {/* Tick labels — I labels sit at y=346 which is safely above y=350 (§4.3) */}
      {iTicks.map((I) => (
        <text
          key={`it${I}`}
          x={xForI(I)} y={346}
          fill="#6C7A93" fontFamily="'JetBrains Mono', monospace"
          fontSize={9} textAnchor="middle"
        >
          {I.toFixed(1)}
        </text>
      ))}
      {uTicks.map((U) => (
        <text
          key={`ut${U}`}
          x={GPLOT_L - 6} y={yForU(U) + 3}
          fill="#6C7A93" fontFamily="'JetBrains Mono', monospace"
          fontSize={9} textAnchor="end"
        >
          {U}
        </text>
      ))}

      {/* Axis captions — both stay OUT of the BR quadrant (§4.3, check #8) */}
      <text x={GPLOT_L - 30} y={GPLOT_T - 6}
            fill="#B9C4D6" fontFamily="'JetBrains Mono', monospace" fontSize={10}>
        U (V)
      </text>
      <text x={GPLOT_L + 8} y={346}
            fill="#B9C4D6" fontFamily="'JetBrains Mono', monospace" fontSize={10}>
        I (A) →
      </text>

      {/* Legend — top-left of plot area, safely inside */}
      <g transform={`translate(${GPLOT_L + 10}, ${GPLOT_T + 6})`}>
        <line x1={0} y1={4} x2={16} y2={4} stroke="#F9A968" strokeWidth={2} />
        <text x={20} y={7}
              fill="#F9A968" fontFamily="'JetBrains Mono', monospace" fontSize={9}>
          {labels.load_line}
        </text>
        <line x1={0} y1={16} x2={16} y2={16} stroke="#37C9B8" strokeWidth={2} />
        <text x={20} y={19}
              fill="#37C9B8" fontFamily="'JetBrains Mono', monospace" fontSize={9}>
          {labels.recv_curve}
        </text>
      </g>

      {/* Load line */}
      <polyline points={loadPath} fill="none"
                stroke="#F9A968" strokeWidth={2} strokeLinecap="round" />
      {/* Receiver characteristic */}
      {recvSegments}

      {/* Stage-2 target reticle */}
      {scenarioTarget && (
        <g>
          <circle
            cx={xForI(scenarioTarget.I)} cy={yForU(scenarioTarget.U)}
            r={9} fill="none"
            stroke="#EF4444" strokeWidth={1.6} strokeDasharray="3 2"
          />
          <line
            x1={xForI(scenarioTarget.I) - 12} y1={yForU(scenarioTarget.U)}
            x2={xForI(scenarioTarget.I) + 12} y2={yForU(scenarioTarget.U)}
            stroke="#EF4444" strokeWidth={0.8} strokeDasharray="2 2"
          />
          <line
            x1={xForI(scenarioTarget.I)} y1={yForU(scenarioTarget.U) - 12}
            x2={xForI(scenarioTarget.I)} y2={yForU(scenarioTarget.U) + 12}
            stroke="#EF4444" strokeWidth={0.8} strokeDasharray="2 2"
          />
        </g>
      )}

      {/* Operating point — hidden on stage 3 until submit-post feedback */}
      {!hideOp && op.I > 0 && op.I <= I_MAX && op.U >= 0 && op.U <= U_MAX && (
        <g>
          <line
            x1={xForI(op.I)} y1={GPLOT_B}
            x2={xForI(op.I)} y2={yForU(op.U)}
            stroke="#8AB3FF" strokeWidth={1} strokeDasharray="2 2"
          />
          <line
            x1={GPLOT_L} y1={yForU(op.U)}
            x2={xForI(op.I)} y2={yForU(op.U)}
            stroke="#8AB3FF" strokeWidth={1} strokeDasharray="2 2"
          />
          <circle
            cx={xForI(op.I)} cy={yForU(op.U)} r={6}
            fill="#F9A968" stroke="#EAF0FA" strokeWidth={1.4}
          />
        </g>
      )}
    </g>
  )
}
