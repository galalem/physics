import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  useSetStage,
  useCurrentStage,
  useComplete,
  useDeclareStages,
  useHint,
  useInit,
  useNext,
  usePeek,
  useProgress,
  useReset,
} from '@physics/sdk/react'
import { getHintFor, getStagesFor } from './stages'
import en from '../i18n/en.json'
import fr from '../i18n/fr.json'
import ar from '../i18n/ar.json'

// ─── Canvas ─────────────────────────────────────────────────────────────
const W = 800
const H = 450

// ─── Physics ────────────────────────────────────────────────────────────
// 1 u × c² = 931.494 MeV. Round to 931.5 for classroom convention.
const C2_MEV_PER_U = 931.5

function eMeV(dm_u: number): number {
  return dm_u * C2_MEV_PER_U
}

// ─── Reactions (for stage-1 ledger) ────────────────────────────────────
type Reaction = {
  id: 'fusion' | 'alpha' | 'fission'
  before: { symbol: string; mass: number }[]
  after: { symbol: string; mass: number }[]
}

const REACTIONS: Reaction[] = [
  {
    id: 'fusion',
    before: [
      { symbol: '²H', mass: 2.01410 },
      { symbol: '³H', mass: 3.01605 },
    ],
    after: [
      { symbol: '⁴He', mass: 4.00260 },
      { symbol: 'n', mass: 1.00867 },
    ],
  },
  {
    id: 'alpha',
    before: [{ symbol: '²¹⁰Po', mass: 209.98287 }],
    after: [
      { symbol: '²⁰⁶Pb', mass: 205.97445 },
      { symbol: '⁴He', mass: 4.00260 },
    ],
  },
  {
    id: 'fission',
    before: [
      { symbol: '²³⁵U', mass: 235.04393 },
      { symbol: 'n', mass: 1.00867 },
    ],
    after: [
      { symbol: '¹⁴¹Ba', mass: 140.91442 },
      { symbol: '⁹²Kr', mass: 91.92617 },
      { symbol: '3n', mass: 3 * 1.00867 },
    ],
  },
]

function sumMass(items: { mass: number }[]): number {
  return items.reduce((s, x) => s + x.mass, 0)
}
function reactionDeltaM(r: Reaction): number {
  return sumMass(r.before) - sumMass(r.after)
}

// ─── Stage 2 & 3 problems ─────────────────────────────────────────────
type Problem = { dm: number; e: number; tol: number }
function makeProblem(dm: number): Problem {
  const e = eMeV(dm)
  return { dm, e, tol: Math.max(0.5, e * 0.03) } // ±0.5 MeV or ±3%
}
const STAGE2_PROBLEMS: Problem[] = [
  makeProblem(0.030),  // 27.9 MeV
  makeProblem(0.090),  // 83.8 MeV
  makeProblem(0.005),  // 4.66 MeV
]
const STAGE3_PROBLEMS: Problem[] = [
  makeProblem(0.020),  // 18.6 MeV
  makeProblem(0.150),  // 139.7 MeV
  makeProblem(0.001),  // 0.93 MeV
]

function withinTol(user: number, p: Problem): boolean {
  return Math.abs(user - p.e) <= p.tol
}

// ─── Colors ─────────────────────────────────────────────────────────────
const E_COLOR = '#37C9B8'   // teal — computed energy
const DM_COLOR = '#F9A968'  // amber — mass defect
const C_COLOR = '#B87CE0'   // purple — constant
const OK_COLOR = '#37C9B8'
const BAD_COLOR = '#F97316'

// ─── i18n ───────────────────────────────────────────────────────────────
const dict = { en, fr, ar } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels as Record<string, string>
}

// ─── Component ──────────────────────────────────────────────────────────
export default function Scene() {
  const { locale } = useInit()
  const stages = useMemo(() => getStagesFor(locale), [locale])
  useDeclareStages(stages)
  const labels = useMemo(() => svgLabels(locale), [locale])
  const L = useCallback((k: string) => labels[k] ?? k, [labels])

  const stageIdx = useCurrentStage()
  const isObserve = stageIdx === 1
  const isExperiment = stageIdx === 2
  const isEvaluate = stageIdx === 3

  // Stage 1
  const initialReaction = REACTIONS[0]!
  const [reactionId, setReactionId] = useState<Reaction['id']>(initialReaction.id)
  const [dm, setDm] = useState<number>(reactionDeltaM(initialReaction))
  const [reactionsTried, setReactionsTried] = useState<Set<string>>(new Set([initialReaction.id]))
  const [slidedOnce, setSlidedOnce] = useState(false)

  // Stage 2
  const [q2Idx, setQ2Idx] = useState(0)
  const [q2Answers, setQ2Answers] = useState<(number | null)[]>(() => STAGE2_PROBLEMS.map(() => null))
  const [q2Input, setQ2Input] = useState('')

  // Stage 3
  const [q3Idx, setQ3Idx] = useState(0)
  const [q3Answers, setQ3Answers] = useState<(number | null)[]>(() => STAGE3_PROBLEMS.map(() => null))
  const [q3Input, setQ3Input] = useState('')
  const [peekFlash, setPeekFlash] = useState(false)

  const activeReaction = useMemo(
    () => REACTIONS.find((r) => r.id === reactionId)!,
    [reactionId],
  )

  const setStage = useSetStage()
  const progress = useProgress()
  const complete = useComplete()

  const problems = isExperiment ? STAGE2_PROBLEMS : STAGE3_PROBLEMS
  const qIdx = isExperiment ? q2Idx : q3Idx
  const currentProblem = problems[qIdx]!
  const currentAnswers = isExperiment ? q2Answers : q3Answers
  const currentInput = isExperiment ? q2Input : q3Input
  const currentAnswer: number | null = currentAnswers[qIdx] ?? null

  const displayedDm = isObserve ? dm : currentProblem.dm
  const displayedE = isObserve
    ? eMeV(dm)
    : currentAnswer !== null
      ? currentAnswer
      : null

  const pickReaction = useCallback((r: Reaction) => {
    setReactionId(r.id)
    setDm(reactionDeltaM(r))
    setReactionsTried((prev) => (prev.has(r.id) ? prev : new Set(prev).add(r.id)))
  }, [])

  const onDmSlider = (v: number) => {
    setDm(v)
    if (isObserve) setSlidedOnce(true)
  }

  const submitAnswer = () => {
    const val = parseFloat(currentInput)
    if (Number.isNaN(val)) return
    if (isExperiment) {
      setQ2Answers((prev) => { const next = [...prev]; next[q2Idx] = val; return next })
    } else if (isEvaluate) {
      setQ3Answers((prev) => { const next = [...prev]; next[q3Idx] = val; return next })
    }
  }

  const goNextQuestion = () => {
    if (isExperiment && q2Idx < STAGE2_PROBLEMS.length - 1) {
      setQ2Idx((n) => n + 1)
      setQ2Input('')
    } else if (isEvaluate && q3Idx < STAGE3_PROBLEMS.length - 1) {
      setQ3Idx((n) => n + 1)
      setQ3Input('')
    }
  }

  const observeDone = reactionsTried.size === 3 && slidedOnce
  const experimentDone = q2Answers.every((a, i) => a !== null && withinTol(a, STAGE2_PROBLEMS[i]!))
  const evaluateDone = q3Answers.every((a, i) => a !== null && withinTol(a, STAGE3_PROBLEMS[i]!))
  const canSubmit = isObserve ? observeDone : isExperiment ? experimentDone : evaluateDone

  const resetForStage = useCallback((_s: number) => {
    setReactionId(initialReaction.id)
    setDm(reactionDeltaM(initialReaction))
    setReactionsTried(new Set([initialReaction.id]))
    setSlidedOnce(false)
    setQ2Idx(0)
    setQ2Answers(STAGE2_PROBLEMS.map(() => null))
    setQ2Input('')
    setQ3Idx(0)
    setQ3Answers(STAGE3_PROBLEMS.map(() => null))
    setQ3Input('')
    setPeekFlash(false)
  }, [initialReaction])

  useReset(() => resetForStage(stageIdx))

  useEffect(() => {
    progress(stageIdx / 3, { stage: stageIdx, canSubmit })
  }, [stageIdx, canSubmit, progress])

  useNext(() => {
    if (stageIdx < 3) {
      const next = stageIdx + 1
      setStage(next)
      resetForStage(next)
    } else {
      complete({ success: true })
    }
  })

  usePeek(() => {
    if (!isEvaluate) return
    setPeekFlash(true)
    setTimeout(() => setPeekFlash(false), 1500)
  })

  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  const helperVisible = isExperiment || (isEvaluate && peekFlash)

  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${L('stage')} 0${stageIdx} · ${stageName}`
  const hudTR = isObserve
    ? `${L('reactions')}: ${reactionsTried.size}/3  ·  ${slidedOnce ? '✓' : '○'} ${L('adjusted')}`
    : isExperiment
      ? `${L('question')} ${q2Idx + 1}/${STAGE2_PROBLEMS.length}  ·  ${countSolved(q2Answers, STAGE2_PROBLEMS)}/${STAGE2_PROBLEMS.length} ${L('solved')}`
      : `${L('question')} ${q3Idx + 1}/${STAGE3_PROBLEMS.length}  ·  ${countSolved(q3Answers, STAGE3_PROBLEMS)}/${STAGE3_PROBLEMS.length} ${L('solved')}`
  const hudBL = isObserve ? L('tip1') : isExperiment ? L('tip2') : L('tip3')

  const SCENE_X = 40, SCENE_Y = 60
  const SCENE_W = 500, SCENE_H = 320
  const FORMULA_Y = 140
  const LEDGER_X = 60, LEDGER_Y = 210
  const LEDGER_W = 460, LEDGER_H = 160

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block', userSelect: 'none' }}
      >
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        <rect x={SCENE_X} y={SCENE_Y} width={SCENE_W} height={SCENE_H}
          fill="none" stroke="#12203a" strokeWidth={1} rx={6} />
        <text x={SCENE_X + 8} y={SCENE_Y - 8}
          fill="#6C7A93" fontFamily="'JetBrains Mono', monospace"
          fontSize={11} letterSpacing="0.1em">
          {L('scene_title')}
        </text>

        <FormulaDisplay
          cx={SCENE_X + SCENE_W / 2}
          y={FORMULA_Y}
          eValue={displayedE}
          dmValue={displayedDm}
          isInput={!isObserve}
          isAnswered={!isObserve && currentAnswer !== null}
          isCorrect={!isObserve && currentAnswer !== null && withinTol(currentAnswer, currentProblem)}
          L={L}
        />

        {isObserve && (
          <ReactionLedger
            x={LEDGER_X} y={LEDGER_Y} w={LEDGER_W} h={LEDGER_H}
            reaction={activeReaction} L={L}
          />
        )}

        {!isObserve && (
          <HelperCard
            x={LEDGER_X} y={LEDGER_Y} w={LEDGER_W} h={LEDGER_H}
            visible={helperVisible} L={L}
          />
        )}
      </svg>

      <div style={hudTLStyle}>{hudTL}</div>
      <div style={{ ...hudTRStyle, color: canSubmit ? OK_COLOR : '#B9C4D6' }}>{hudTR}</div>
      <div style={hudBLStyle}>{hudBL}</div>

      <div style={rightPanelWrapperStyle}>
        <div style={rightPanelTitleStyle}>{L('controls_title')}</div>
        <div style={rightPanelBoxStyle}>
        {isObserve && (
          <>
            <FieldGroup label={L('field_reaction')}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                {REACTIONS.map((r) => {
                  const active = r.id === reactionId
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => pickReaction(r)}
                      style={{
                        padding: '0.9rem 1.1rem',
                        background: active ? '#3A4863' : 'transparent',
                        color: active ? '#EAF0FA' : '#B9C4D6',
                        border: '1px solid #3A4863',
                        borderRadius: '0.5rem',
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: '1.8rem',
                        cursor: 'pointer',
                        textAlign: 'left',
                        display: 'flex',
                        justifyContent: 'space-between',
                      }}
                    >
                      <span>{L(`reaction_${r.id}`)}</span>
                      {reactionsTried.has(r.id) && (
                        <span style={{ color: OK_COLOR, fontWeight: 700 }}>✓</span>
                      )}
                    </button>
                  )
                })}
              </div>
            </FieldGroup>

            <FieldGroup label={`${L('field_dm')}: ${dm.toFixed(4)} u`}>
              <NumberSlider
                min={0} max={0.3} step={0.001}
                value={dm}
                onChange={onDmSlider}
              />
            </FieldGroup>

            <div style={statusBoxStyle}>
              <div style={statusLabelStyle}>{L('computed')}</div>
              <div style={{ fontSize: '2.1rem', color: E_COLOR, fontWeight: 700 }}>
                E = {eMeV(dm).toFixed(2)} MeV
              </div>
              <div style={{ fontSize: '1.5rem', color: '#54617A' }}>
                = {(eMeV(dm) * 1.602e-13).toExponential(2)} J
              </div>
            </div>
          </>
        )}

        {!isObserve && (
          <>
            <div style={{ fontSize: '1.8rem', color: '#B9C4D6', lineHeight: 1.5 }}>
              {L('problem_prompt')}
            </div>

            <div style={{
              padding: '0.9rem 1rem',
              border: '1px solid #12203a', borderRadius: '0.5rem',
              display: 'flex', flexDirection: 'column', gap: '0.35rem',
            }}>
              <div style={statusLabelStyle}>{L('given')}</div>
              <div style={{ fontSize: '2.1rem', color: DM_COLOR, fontWeight: 700 }}>
                Δm = {currentProblem.dm.toFixed(3)} u
              </div>
              <div style={{ fontSize: '1.5rem', color: '#54617A', marginTop: '0.2rem' }}>
                {L('question')} {qIdx + 1}/{problems.length}
              </div>
            </div>

            <FieldGroup label={`${L('answer_E')} (MeV)`}>
              <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'stretch' }}>
                <input
                  type="number"
                  value={currentInput}
                  step="0.01"
                  disabled={currentAnswer !== null}
                  onChange={(e) =>
                    isExperiment ? setQ2Input(e.target.value) : setQ3Input(e.target.value)
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && currentAnswer === null && currentInput.trim() !== '') {
                      submitAnswer()
                    }
                  }}
                  placeholder="? MeV"
                  style={{
                    flex: 1, minWidth: 0,
                    padding: '1rem 1.2rem',
                    background: '#12203a',
                    color: '#EAF0FA',
                    border: '1px solid #3A4863',
                    borderRadius: '0.5rem',
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: '2rem',
                    fontWeight: 700,
                    outline: 'none',
                  }}
                />
                <button
                  type="button"
                  onClick={submitAnswer}
                  disabled={currentAnswer !== null || currentInput.trim() === ''}
                  style={{
                    ...submitBtnStyle,
                    opacity: currentAnswer !== null || currentInput.trim() === '' ? 0.45 : 1,
                    cursor: currentAnswer !== null || currentInput.trim() === '' ? 'not-allowed' : 'pointer',
                  }}
                >
                  ✓
                </button>
              </div>
            </FieldGroup>

            {currentAnswer !== null && (
              <div style={{
                padding: '0.7rem 0.9rem',
                border: `1px solid ${withinTol(currentAnswer, currentProblem) ? OK_COLOR : BAD_COLOR}`,
                borderRadius: '0.4rem',
                background: withinTol(currentAnswer, currentProblem)
                  ? 'rgba(55,201,184,0.08)'
                  : 'rgba(249,115,22,0.08)',
                color: withinTol(currentAnswer, currentProblem) ? OK_COLOR : BAD_COLOR,
                fontSize: '2.1rem',
              }}>
                {withinTol(currentAnswer, currentProblem)
                  ? `✓ ${L('correct')} — E = ${currentProblem.e.toFixed(2)} MeV`
                  : `✗ ${L('exact_was')} ${currentProblem.e.toFixed(2)} MeV`}
              </div>
            )}

            {currentAnswer !== null && qIdx < problems.length - 1 && (
              <button type="button" onClick={goNextQuestion} style={nextBtnStyle}>
                {L('next_q')} →
              </button>
            )}
          </>
        )}
        </div>
      </div>
    </div>
  )
}

// ─── SVG sub-components ─────────────────────────────────────────────────
function FormulaDisplay({
  cx, y, eValue, dmValue, isInput, isAnswered, isCorrect, L,
}: {
  cx: number; y: number
  eValue: number | null
  dmValue: number
  isInput: boolean
  isAnswered: boolean
  isCorrect: boolean
  L: (k: string) => string
}) {
  const eText = eValue === null ? '?' : eValue.toFixed(2)
  const eChipColor = !isInput
    ? E_COLOR
    : isAnswered
      ? isCorrect ? OK_COLOR : BAD_COLOR
      : '#8AA0BF'
  const dmText = dmValue.toFixed(3)
  // Layout: 3 uniform chips w=150 h=58, gaps of 20px with operator centered.
  const chipW = 150
  const chipH = 58
  const gap = 20
  const totalW = 3 * chipW + 2 * gap  // 490 → fits in 500-wide scene
  const leftX = cx - totalW / 2 + chipW / 2
  const eCX = leftX
  const dmCX = leftX + chipW + gap
  const cCX = leftX + 2 * (chipW + gap)
  const opY = y + 8
  return (
    <g fontFamily="'JetBrains Mono', monospace">
      <Chip cx={eCX} cy={y} w={chipW} h={chipH}
        value={eText} unit="MeV" label="E"
        color={eChipColor} valueColor={eChipColor}
        dashed={isInput && !isAnswered}
      />
      <text x={(eCX + dmCX) / 2} y={opY} fontSize={26} fill="#B9C4D6" textAnchor="middle" fontWeight={700}>=</text>
      <Chip cx={dmCX} cy={y} w={chipW} h={chipH}
        value={dmText} unit="u" label="Δm"
        color={DM_COLOR} valueColor={DM_COLOR}
      />
      <text x={(dmCX + cCX) / 2} y={opY} fontSize={26} fill="#B9C4D6" textAnchor="middle" fontWeight={700}>·</text>
      <Chip cx={cCX} cy={y} w={chipW} h={chipH}
        value="c²" unit="931.5 MeV/u" label={L('constant')}
        color={C_COLOR} valueColor={C_COLOR}
        isConstant
      />
    </g>
  )
}

function Chip({
  cx, cy, w, h, value, unit, label, color, valueColor, dashed, isConstant,
}: {
  cx: number; cy: number; w: number; h: number
  value: string; unit: string; label: string
  color: string; valueColor: string
  dashed?: boolean; isConstant?: boolean
}) {
  const x0 = cx - w / 2
  const y0 = cy - h / 2
  return (
    <g>
      {/* label above rect */}
      <text x={cx} y={y0 - 8}
        fontSize={13} fill={color}
        textAnchor="middle" letterSpacing="0.15em"
        fontWeight={600}
      >{label}</text>
      {/* rect */}
      <rect
        x={x0} y={y0} width={w} height={h}
        fill="rgba(255,255,255,0.03)"
        stroke={color}
        strokeWidth={1.6}
        strokeDasharray={dashed ? '5 5' : undefined}
        rx={6}
      />
      {/* value centered in rect */}
      <text x={cx} y={cy + (isConstant ? 8 : 8)}
        fontSize={isConstant ? 24 : 20}
        fontWeight={800} fill={valueColor}
        textAnchor="middle"
      >{value}</text>
      {/* unit below rect */}
      {unit && (
        <text x={cx} y={y0 + h + 18}
          fontSize={12} fill={color}
          textAnchor="middle" letterSpacing="0.1em"
        >{unit}</text>
      )}
    </g>
  )
}

function ReactionLedger({ x, y, w, h, reaction, L }: {
  x: number; y: number; w: number; h: number
  reaction: Reaction
  L: (k: string) => string
}) {
  const beforeSum = sumMass(reaction.before)
  const afterSum = sumMass(reaction.after)
  const dm = beforeSum - afterSum
  const eMev = eMeV(dm)
  const colY = y + 44
  const rowH = 18
  const beforeX = x + 90
  const arrowX = x + w / 2
  const afterX = x + w - 90
  return (
    <g fontFamily="'JetBrains Mono', monospace">
      <rect x={x} y={y} width={w} height={h}
        fill="none" stroke="#12203a" strokeWidth={1} rx={6} />
      <text x={x + w / 2} y={y + 20}
        fontSize={12} fill="#B9C4D6"
        textAnchor="middle" letterSpacing="0.15em"
      >{L(`reaction_${reaction.id}`)}</text>

      <text x={beforeX} y={y + 40}
        fontSize={10} fill="#54617A"
        textAnchor="middle" letterSpacing="0.15em"
      >{L('before')}</text>
      <text x={afterX} y={y + 40}
        fontSize={10} fill="#54617A"
        textAnchor="middle" letterSpacing="0.15em"
      >{L('after')}</text>

      <line x1={arrowX - 20} y1={y + 60} x2={arrowX + 20} y2={y + 60}
        stroke="#54617A" strokeWidth={1.5} />
      <polygon points={`${arrowX + 20},${y + 60} ${arrowX + 12},${y + 56} ${arrowX + 12},${y + 64}`}
        fill="#54617A" />

      {reaction.before.map((it, i) => (
        <g key={`b${i}`}>
          <text x={beforeX - 8} y={colY + 24 + i * rowH}
            fontSize={13} fill="#EAF0FA" textAnchor="end" fontWeight={700}
          >{it.symbol}</text>
          <text x={beforeX + 60} y={colY + 24 + i * rowH}
            fontSize={13} fill="#B9C4D6" textAnchor="end"
          >{it.mass.toFixed(4)}</text>
        </g>
      ))}

      {reaction.after.map((it, i) => (
        <g key={`a${i}`}>
          <text x={afterX - 8} y={colY + 24 + i * rowH}
            fontSize={13} fill="#EAF0FA" textAnchor="end" fontWeight={700}
          >{it.symbol}</text>
          <text x={afterX + 60} y={colY + 24 + i * rowH}
            fontSize={13} fill="#B9C4D6" textAnchor="end"
          >{it.mass.toFixed(4)}</text>
        </g>
      ))}

      {(() => {
        const sumY = y + h - 46
        return (
          <g>
            <line x1={beforeX - 24} y1={sumY - 12} x2={beforeX + 64} y2={sumY - 12}
              stroke="#3A4863" strokeWidth={0.8} />
            <text x={beforeX - 8} y={sumY}
              fontSize={13} fill="#54617A" textAnchor="end" letterSpacing="0.1em"
            >Σ</text>
            <text x={beforeX + 60} y={sumY}
              fontSize={13} fill="#EAF0FA" textAnchor="end" fontWeight={700}
            >{beforeSum.toFixed(4)}</text>

            <line x1={afterX - 24} y1={sumY - 12} x2={afterX + 64} y2={sumY - 12}
              stroke="#3A4863" strokeWidth={0.8} />
            <text x={afterX - 8} y={sumY}
              fontSize={13} fill="#54617A" textAnchor="end" letterSpacing="0.1em"
            >Σ</text>
            <text x={afterX + 60} y={sumY}
              fontSize={13} fill="#EAF0FA" textAnchor="end" fontWeight={700}
            >{afterSum.toFixed(4)}</text>
          </g>
        )
      })()}

      <text x={x + w / 2} y={y + h - 18}
        fontSize={13} fill={DM_COLOR}
        textAnchor="middle" fontWeight={700} letterSpacing="0.05em"
      >
        Δm = {dm.toFixed(5)} u  →  E = {eMev.toFixed(2)} MeV
      </text>
    </g>
  )
}

function HelperCard({ x, y, w, h, visible, L }: {
  x: number; y: number; w: number; h: number
  visible: boolean
  L: (k: string) => string
}) {
  return (
    <g fontFamily="'JetBrains Mono', monospace">
      <rect x={x} y={y} width={w} height={h}
        fill="none" stroke="#12203a" strokeWidth={1} rx={6} />
      <text x={x + w / 2} y={y + 20}
        fontSize={12} fill="#B9C4D6"
        textAnchor="middle" letterSpacing="0.15em"
      >{L('unit_converter')}</text>

      {visible ? (
        <g>
          <text x={x + w / 2} y={y + 60}
            fontSize={22} fill={C_COLOR} fontWeight={800}
            textAnchor="middle"
          >1 u × c² = 931.5 MeV</text>
          <text x={x + w / 2} y={y + 92}
            fontSize={14} fill="#B9C4D6"
            textAnchor="middle"
          >{L('so')}: E (MeV) = Δm (u) × 931.5</text>
          <text x={x + w / 2} y={y + 122}
            fontSize={12} fill="#54617A"
            textAnchor="middle"
          >c = 3 × 10⁸ m/s  ·  1 MeV = 1.602 × 10⁻¹³ J</text>
          <text x={x + w / 2} y={y + 152}
            fontSize={12} fill="#54617A"
            textAnchor="middle"
          >1 u = 1.6605 × 10⁻²⁷ kg</text>
        </g>
      ) : (
        <text x={x + w / 2} y={y + h / 2 + 4}
          fontSize={14} fill="#54617A"
          textAnchor="middle" letterSpacing="0.1em"
        >{L('helper_hidden')}</text>
      )}
    </g>
  )
}

// ─── Helpers ────────────────────────────────────────────────────────────
function countSolved(answers: (number | null)[], probs: Problem[]): number {
  return answers.filter((a, i) => a !== null && withinTol(a, probs[i]!)).length
}

// ─── UI sub-components ──────────────────────────────────────────────────
function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
      <div style={{
        fontSize: '1.5rem',
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        color: '#54617A',
      }}>{label}</div>
      {children}
    </div>
  )
}

function NumberSlider({ min, max, step, value, onChange }: {
  min: number; max: number; step: number
  value: number
  onChange: (v: number) => void
}) {
  const bump = (delta: number) =>
    onChange(Math.min(max, Math.max(min, +(value + delta).toFixed(4))))
  return (
    <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', width: '100%', minWidth: 0 }}>
      <button type="button" onClick={() => bump(-step)} disabled={value <= min} style={sliderBtnStyle}>−</button>
      <input
        type="range"
        min={min} max={max} step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ flex: 1, minWidth: 0, width: 0, accentColor: DM_COLOR }}
      />
      <button type="button" onClick={() => bump(step)} disabled={value >= max} style={sliderBtnStyle}>+</button>
    </div>
  )
}

// ─── Styles ─────────────────────────────────────────────────────────────
const hudTLStyle: React.CSSProperties = {
  position: 'absolute', top: '3rem', left: '3rem',
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: '2.3rem', letterSpacing: '0.14em', textTransform: 'uppercase',
  color: '#6C7A93', zIndex: 5, pointerEvents: 'none',
}
const hudTRStyle: React.CSSProperties = {
  position: 'absolute', top: '3rem', right: '3rem',
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: '2.3rem', letterSpacing: '0.08em',
  zIndex: 5, pointerEvents: 'none',
}
const hudBLStyle: React.CSSProperties = {
  position: 'absolute', bottom: '3rem', left: '3rem',
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: '2.3rem', letterSpacing: '0.06em',
  color: '#6C7A93', zIndex: 5, pointerEvents: 'none', maxWidth: '58%',
}
// Panel aligned to scene box (SVG y=60..380, H=320).
// top:9.7rem = title at SVG y≈52; bottom:15.6rem = box bottom at y=380.
const rightPanelWrapperStyle: React.CSSProperties = {
  position: 'absolute',
  top: '9.7rem', bottom: '15.6rem',
  right: '6.7rem',
  width: '40rem',
  boxSizing: 'border-box',
  zIndex: 6,
  color: '#B9C4D6',
  fontFamily: "'JetBrains Mono', monospace",
  display: 'flex', flexDirection: 'column',
}
const rightPanelTitleStyle: React.CSSProperties = {
  fontSize: '2.44rem',
  color: '#6C7A93', letterSpacing: '0.1em',
  marginBottom: '1.2rem', marginLeft: '0.4rem',
}
const rightPanelBoxStyle: React.CSSProperties = {
  flex: 1,
  border: '1px solid #12203a', borderRadius: '0.6rem',
  padding: '2.5rem',
  display: 'flex', flexDirection: 'column', gap: '2.5rem',
  fontSize: '2rem',
  overflow: 'auto',
}
const statusBoxStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: '0.6rem',
  padding: '1rem 1.2rem',
  border: '1px solid #12203a', borderRadius: '0.6rem',
}
const statusLabelStyle: React.CSSProperties = {
  fontSize: '1.5rem', color: '#54617A',
  letterSpacing: '0.1em', textTransform: 'uppercase',
}
const submitBtnStyle: React.CSSProperties = {
  padding: '1rem 1.4rem',
  background: E_COLOR,
  color: '#0D1524',
  border: '1px solid ' + E_COLOR,
  borderRadius: '0.5rem',
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: '2rem',
  fontWeight: 800,
}
const nextBtnStyle: React.CSSProperties = {
  padding: '1rem 1.4rem',
  background: '#F9A968',
  color: '#0D1524',
  border: '1px solid #F9A968',
  borderRadius: '0.5rem',
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: '1.9rem',
  fontWeight: 700,
  cursor: 'pointer',
}
const sliderBtnStyle: React.CSSProperties = {
  width: '3.2rem', height: '3.2rem',
  background: 'transparent',
  color: '#B9C4D6',
  border: '1px solid #3A4863',
  borderRadius: '0.5rem',
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: '2rem',
  cursor: 'pointer',
}
