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

// ─── Domain ─────────────────────────────────────────────────────────────
type Mode = 'aa' | 'ac' | 'cc'
type Orient = 1 | -1
type Kind = 'attract' | 'repel'

const MODES: Mode[] = ['aa', 'ac', 'cc']

// orient=1 convention:
//   magnet → N pole on the RIGHT half of the body
//   solenoid → top-lead current arrow points RIGHT → N pole on the LEFT end (RHR)
//   wire → current arrow points UP
function interaction(mode: Mode, left: Orient, right: Orient): Kind {
  if (mode === 'aa') {
    const leftMagRightFace = left === 1 ? 'N' : 'S'
    const rightMagLeftFace = right === 1 ? 'S' : 'N'
    return leftMagRightFace === rightMagLeftFace ? 'repel' : 'attract'
  }
  if (mode === 'ac') {
    const magnetRightFace = left === 1 ? 'N' : 'S'
    const solLeftFace = right === 1 ? 'N' : 'S'
    return magnetRightFace === solLeftFace ? 'repel' : 'attract'
  }
  return left === right ? 'attract' : 'repel'
}

// Stage 2: one target per mode, must hit all three
const STAGE2: { mode: Mode; target: Kind }[] = [
  { mode: 'aa', target: 'attract' },
  { mode: 'ac', target: 'repel' },
  { mode: 'cc', target: 'attract' },
]

// Stage 3: blind prediction problems
type BlindProblem = { mode: Mode; left: Orient; right: Orient; answer: Kind }
const STAGE3_RAW: Omit<BlindProblem, 'answer'>[] = [
  { mode: 'aa', left: 1, right: 1 },     // N face S → attract
  { mode: 'cc', left: 1, right: -1 },    // opposite currents → repel
  { mode: 'ac', left: 1, right: 1 },     // N vs N → repel
  { mode: 'aa', left: -1, right: -1 },   // S face N → attract
]
const STAGE3: BlindProblem[] = STAGE3_RAW.map((p) => ({
  ...p,
  answer: interaction(p.mode, p.left, p.right),
}))

// ─── Colors ─────────────────────────────────────────────────────────────
const N_COLOR = '#E04A4A'
const S_COLOR = '#4A6FE0'
const ATTRACT_COLOR = '#37C9B8'
const REPEL_COLOR = '#F97316'
const WIRE_COLOR = '#B9C4D6'
const CURRENT_COLOR = '#F9A968'

// ─── Layout ─────────────────────────────────────────────────────────────
const SCENE_X = 40
const SCENE_Y = 60
const SCENE_W = 500
const SCENE_H = 320
const OBJ_A_CX = SCENE_X + 130     // 170
const OBJ_B_CX = SCENE_X + 370     // 410
const OBJ_CY = SCENE_Y + SCENE_H / 2 // 220
const IND_LEFT = OBJ_A_CX + 60
const IND_RIGHT = OBJ_B_CX - 60
const IND_MID = (IND_LEFT + IND_RIGHT) / 2

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

  const [mode, setMode] = useState<Mode>('aa')
  const [left, setLeft] = useState<Orient>(1)
  const [right, setRight] = useState<Orient>(1)

  const outcome = interaction(mode, left, right)

  // Stage 1 tracking
  const [modesVisited, setModesVisited] = useState<Set<Mode>>(new Set(['aa']))
  const [outcomesSeen, setOutcomesSeen] = useState<Set<Kind>>(
    new Set([interaction('aa', 1, 1)]),
  )

  // Stage 2 tracking
  const [stage2Solved, setStage2Solved] = useState<Set<Mode>>(new Set())

  // Stage 3 state
  const [q3Idx, setQ3Idx] = useState(0)
  const [q3Answers, setQ3Answers] = useState<(Kind | null)[]>(() =>
    STAGE3.map(() => null),
  )
  const [peekFlash, setPeekFlash] = useState(false)

  const setStage = useSetStage()
  const progress = useProgress()
  const complete = useComplete()

  useEffect(() => {
    if (isObserve) {
      setModesVisited((prev) => (prev.has(mode) ? prev : new Set(prev).add(mode)))
      setOutcomesSeen((prev) => (prev.has(outcome) ? prev : new Set(prev).add(outcome)))
    }
    if (isExperiment) {
      const target = STAGE2.find((t) => t.mode === mode)?.target
      if (target === outcome && !stage2Solved.has(mode)) {
        setStage2Solved((prev) => new Set(prev).add(mode))
      }
    }
  }, [mode, outcome, isObserve, isExperiment, stage2Solved])

  // Sync config to current stage-3 problem
  useEffect(() => {
    if (isEvaluate) {
      const p = STAGE3[q3Idx]!
      setMode(p.mode)
      setLeft(p.left)
      setRight(p.right)
    }
  }, [isEvaluate, q3Idx])

  const observeDone = modesVisited.size === 3 && outcomesSeen.size === 2
  const experimentDone = stage2Solved.size === STAGE2.length
  const evaluateDone = q3Answers.every(
    (a, i) => a !== null && a === STAGE3[i]!.answer,
  )
  const canSubmit = isObserve
    ? observeDone
    : isExperiment
      ? experimentDone
      : evaluateDone

  const resetForStage = useCallback((s: number) => {
    setMode('aa')
    setLeft(1)
    setRight(1)
    setModesVisited(new Set(['aa']))
    setOutcomesSeen(new Set([interaction('aa', 1, 1)]))
    setStage2Solved(new Set())
    setQ3Idx(0)
    setQ3Answers(STAGE3.map(() => null))
    setPeekFlash(false)
    if (s === 3) {
      const p = STAGE3[0]!
      setMode(p.mode)
      setLeft(p.left)
      setRight(p.right)
    }
  }, [])

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

  const showOutcome = !isEvaluate || peekFlash || q3Answers[q3Idx] !== null

  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${L('stage')} 0${stageIdx} · ${stageName}`
  const hudTR = isObserve
    ? `${L('modes_tried')}: ${modesVisited.size}/3  ·  ${L('outcomes_seen')}: ${outcomesSeen.size}/2`
    : isExperiment
      ? experimentDone
        ? `${L('all_targets_hit')} ✓`
        : `${L('targets')}: ${stage2Solved.size}/${STAGE2.length}`
      : `${L('question')} ${q3Idx + 1}/${STAGE3.length}`
  const hudBL = isObserve
    ? L('tip1')
    : isExperiment
      ? L('tip2')
      : L('tip3')

  const flipDisabled = isEvaluate

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block', borderRadius: 14, userSelect: 'none' }}
      >
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" rx={14} />

        {/* Scene box */}
        <rect x={SCENE_X} y={SCENE_Y} width={SCENE_W} height={SCENE_H} fill="none" stroke="#12203a" strokeWidth={1} rx={6} />
        <text x={SCENE_X + 8} y={SCENE_Y - 8} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={11} letterSpacing="0.1em">
          {L('scene_title')}
        </text>

        {/* Mode header inside scene */}
        <text
          x={SCENE_X + SCENE_W / 2}
          y={SCENE_Y + 30}
          fill="#B9C4D6"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={13}
          textAnchor="middle"
          letterSpacing="0.15em"
        >
          {L(`mode_${mode}`)}
        </text>

        {/* Object A */}
        {(mode === 'aa' || mode === 'ac') && (
          <BarMagnet cx={OBJ_A_CX} cy={OBJ_CY} orient={left} />
        )}
        {mode === 'cc' && <Wire cx={OBJ_A_CX} cy={OBJ_CY} orient={left} />}

        {/* Object B */}
        {mode === 'aa' && <BarMagnet cx={OBJ_B_CX} cy={OBJ_CY} orient={right} />}
        {mode === 'ac' && <Solenoid cx={OBJ_B_CX} cy={OBJ_CY} orient={right} />}
        {mode === 'cc' && <Wire cx={OBJ_B_CX} cy={OBJ_CY} orient={right} />}

        {/* Object badges */}
        <text
          x={OBJ_A_CX} y={OBJ_CY + 70}
          fill="#54617A" fontFamily="'JetBrains Mono', monospace" fontSize={11}
          textAnchor="middle" letterSpacing="0.1em"
        >
          A · {L(objectKey(mode, 'A'))}
        </text>
        <text
          x={OBJ_B_CX} y={OBJ_CY + 70}
          fill="#54617A" fontFamily="'JetBrains Mono', monospace" fontSize={11}
          textAnchor="middle" letterSpacing="0.1em"
        >
          B · {L(objectKey(mode, 'B'))}
        </text>

        {/* Interaction indicator */}
        <InteractionIndicator
          x1={IND_LEFT}
          x2={IND_RIGHT}
          y={OBJ_CY}
          kind={showOutcome ? outcome : 'hidden'}
        />

        {/* Outcome label */}
        {showOutcome ? (
          <text
            x={IND_MID}
            y={OBJ_CY - 40}
            fill={outcome === 'attract' ? ATTRACT_COLOR : REPEL_COLOR}
            fontFamily="'JetBrains Mono', monospace"
            fontSize={16}
            fontWeight={800}
            textAnchor="middle"
            letterSpacing="0.2em"
          >
            {L(outcome).toUpperCase()}
          </text>
        ) : (
          <text
            x={IND_MID}
            y={OBJ_CY - 40}
            fill="#54617A"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={16}
            fontWeight={800}
            textAnchor="middle"
            letterSpacing="0.2em"
          >
            ?
          </text>
        )}

        {/* Stage-2 target chip */}
        {isExperiment && (() => {
          const target = STAGE2.find((t) => t.mode === mode)!.target
          const solved = stage2Solved.has(mode)
          const targetColor = solved ? ATTRACT_COLOR : '#F9A968'
          return (
            <g>
              <rect
                x={SCENE_X + 12} y={SCENE_Y + SCENE_H - 40}
                width={200} height={26}
                fill="none" stroke={targetColor} strokeWidth={1.2} rx={4}
              />
              <text
                x={SCENE_X + 22} y={SCENE_Y + SCENE_H - 22}
                fill={targetColor}
                fontFamily="'JetBrains Mono', monospace"
                fontSize={12}
                letterSpacing="0.1em"
              >
                {L('target')}: {L(target).toUpperCase()} {solved ? '✓' : ''}
              </text>
            </g>
          )
        })()}
      </svg>

      <div style={hudTLStyle}>{hudTL}</div>
      <div style={{ ...hudTRStyle, color: canSubmit ? '#37C9B8' : '#B9C4D6' }}>{hudTR}</div>
      <div style={hudBLStyle}>{hudBL}</div>

      <div style={rightPanelWrapperStyle}>
        <div style={rightPanelTitleStyle}>{L('controls_title')}</div>
        <div style={rightPanelBoxStyle}>
        {(isObserve || isExperiment) && (
          <>
            <FieldGroup label={L('field_mode')}>
              <Toggle
                options={MODES.map((m) => ({ value: m, label: L(`mode_${m}_short`) }))}
                value={mode}
                onChange={(v) => setMode(v as Mode)}
              />
            </FieldGroup>

            <FieldGroup label={`A · ${L(objectKey(mode, 'A'))}`}>
              <button
                type="button"
                onClick={() => setLeft((o) => (o === 1 ? -1 : 1) as Orient)}
                disabled={flipDisabled}
                style={flipBtnStyle}
              >
                ↺ {L(flipKey(mode, 'A'))}
              </button>
            </FieldGroup>

            <FieldGroup label={`B · ${L(objectKey(mode, 'B'))}`}>
              <button
                type="button"
                onClick={() => setRight((o) => (o === 1 ? -1 : 1) as Orient)}
                disabled={flipDisabled}
                style={flipBtnStyle}
              >
                ↺ {L(flipKey(mode, 'B'))}
              </button>
            </FieldGroup>

            {isExperiment && (
              <div style={statusBoxStyle}>
                <div style={statusLabelStyle}>{L('targets')}</div>
                {STAGE2.map((t) => {
                  const solved = stage2Solved.has(t.mode)
                  return (
                    <div
                      key={t.mode}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: '1.6rem',
                        color: solved ? '#EAF0FA' : '#B9C4D6',
                        opacity: solved ? 1 : 0.75,
                      }}
                    >
                      <span>
                        {L(`mode_${t.mode}_short`)} → {L(t.target)}
                      </span>
                      <span style={{ color: solved ? ATTRACT_COLOR : '#54617A', fontWeight: 700 }}>
                        {solved ? '✓' : '○'}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}

            {isObserve && (
              <div style={statusBoxStyle}>
                <div style={statusLabelStyle}>{L('progress')}</div>
                <div style={{ fontSize: '1.6rem', color: '#B9C4D6' }}>
                  {L('modes_tried')}: <span style={{ color: '#37C9B8', fontWeight: 700 }}>{modesVisited.size}</span>/3
                </div>
                <div style={{ fontSize: '1.6rem', color: '#B9C4D6' }}>
                  {L('outcomes_seen')}: <span style={{ color: '#37C9B8', fontWeight: 700 }}>{outcomesSeen.size}</span>/2
                </div>
              </div>
            )}
          </>
        )}

        {isEvaluate && (() => {
          const answered = q3Answers[q3Idx]
          const problem = STAGE3[q3Idx]!
          return (
            <>
              <div style={{ fontSize: '1.8rem', color: '#B9C4D6', lineHeight: 1.5 }}>
                {L('predict_prompt')}
              </div>

              <div style={{
                padding: '0.9rem 1rem',
                border: '1px solid #12203a', borderRadius: '0.5rem',
                display: 'flex', flexDirection: 'column', gap: '0.35rem',
              }}>
                <div style={statusLabelStyle}>{L('given_config')}</div>
                <div style={{ fontSize: '1.6rem', color: '#EAF0FA' }}>
                  {L(`mode_${mode}`)}
                </div>
                <div style={{ fontSize: '1.5rem', color: '#54617A', marginTop: '0.2rem' }}>
                  {L('question')} {q3Idx + 1}/{STAGE3.length}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                {(['attract', 'repel'] as Kind[]).map((k) => {
                  const isPicked = answered === k
                  const isCorrect = k === problem.answer
                  const showResult = answered !== null
                  const bg = showResult
                    ? isCorrect
                      ? ATTRACT_COLOR
                      : isPicked
                        ? REPEL_COLOR
                        : 'transparent'
                    : isPicked
                      ? '#3A4863'
                      : 'transparent'
                  const color =
                    showResult && (isCorrect || isPicked) ? '#0D1524' : '#EAF0FA'
                  return (
                    <button
                      key={k}
                      type="button"
                      disabled={showResult}
                      onClick={() => {
                        setQ3Answers((prev) => {
                          const next = [...prev]
                          next[q3Idx] = k
                          return next
                        })
                      }}
                      style={{
                        padding: '1.2rem 1rem',
                        background: bg,
                        color,
                        border: '1px solid #3A4863',
                        borderRadius: '0.5rem',
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: '2rem',
                        fontWeight: 700,
                        cursor: showResult ? 'default' : 'pointer',
                      }}
                    >
                      {L(k).toUpperCase()}
                    </button>
                  )
                })}
              </div>

              {answered !== null && q3Idx < STAGE3.length - 1 && (
                <button
                  type="button"
                  onClick={() => setQ3Idx((n) => n + 1)}
                  style={nextBtnStyle}
                >
                  {L('next_q')} →
                </button>
              )}

              <div style={{ fontSize: '1.5rem', color: '#54617A', marginTop: '0.3rem' }}>
                {q3Answers.filter((a, i) => a === STAGE3[i]!.answer).length}/{STAGE3.length} {L('correct')}
              </div>
            </>
          )
        })()}
        </div>
      </div>
    </div>
  )
}

// ─── SVG sub-components ─────────────────────────────────────────────────
function BarMagnet({ cx, cy, orient }: { cx: number; cy: number; orient: Orient }) {
  const w = 100
  const h = 44
  const halfW = w / 2
  const x0 = cx - w / 2
  const y0 = cy - h / 2
  const leftColor = orient === 1 ? S_COLOR : N_COLOR
  const rightColor = orient === 1 ? N_COLOR : S_COLOR
  const leftLabel = orient === 1 ? 'S' : 'N'
  const rightLabel = orient === 1 ? 'N' : 'S'
  return (
    <g>
      <rect x={x0} y={y0} width={halfW} height={h} fill={leftColor} stroke="#0D1524" strokeWidth={2} />
      <rect x={x0 + halfW} y={y0} width={halfW} height={h} fill={rightColor} stroke="#0D1524" strokeWidth={2} />
      <text
        x={x0 + halfW / 2} y={cy + 7}
        fontFamily="'JetBrains Mono', monospace"
        fontSize={22} fontWeight={800} fill="#EAF0FA" textAnchor="middle"
      >{leftLabel}</text>
      <text
        x={x0 + halfW + halfW / 2} y={cy + 7}
        fontFamily="'JetBrains Mono', monospace"
        fontSize={22} fontWeight={800} fill="#EAF0FA" textAnchor="middle"
      >{rightLabel}</text>
    </g>
  )
}

function Solenoid({ cx, cy, orient }: { cx: number; cy: number; orient: Orient }) {
  const w = 110
  const h = 44
  const x0 = cx - w / 2
  const y0 = cy - h / 2
  const nCoils = 5
  const coilGap = w / (nCoils + 1)
  const leftLabel = orient === 1 ? 'N' : 'S'
  const rightLabel = orient === 1 ? 'S' : 'N'
  const leftColor = orient === 1 ? N_COLOR : S_COLOR
  const rightColor = orient === 1 ? S_COLOR : N_COLOR
  // Current top-lead direction: orient=1 → arrow points RIGHT
  const topDir = orient
  const leadY = y0 - 16
  const leadX1 = x0 + coilGap * 0.6
  const leadX2 = x0 + w - coilGap * 0.6
  return (
    <g>
      {/* barrel */}
      <rect x={x0} y={y0} width={w} height={h} fill="#12203a" stroke="#3A4863" strokeWidth={2} rx={4} />
      {/* pole caps */}
      <rect x={x0} y={y0} width={7} height={h} fill={leftColor} />
      <rect x={x0 + w - 7} y={y0} width={7} height={h} fill={rightColor} />
      {/* coil marks */}
      {Array.from({ length: nCoils }, (_, i) => {
        const x = x0 + coilGap * (i + 1)
        return (
          <line
            key={i}
            x1={x} y1={y0 + 2}
            x2={x} y2={y0 + h - 2}
            stroke="#54617A" strokeWidth={1.5}
          />
        )
      })}
      {/* N/S labels near caps */}
      <text
        x={x0 + 14} y={cy + 6}
        fontFamily="'JetBrains Mono', monospace"
        fontSize={17} fontWeight={800} fill="#EAF0FA" textAnchor="middle"
      >{leftLabel}</text>
      <text
        x={x0 + w - 14} y={cy + 6}
        fontFamily="'JetBrains Mono', monospace"
        fontSize={17} fontWeight={800} fill="#EAF0FA" textAnchor="middle"
      >{rightLabel}</text>
      {/* leads: verticals + horizontal top */}
      <line x1={leadX1} y1={leadY} x2={leadX1} y2={y0} stroke={WIRE_COLOR} strokeWidth={1.8} />
      <line x1={leadX2} y1={leadY} x2={leadX2} y2={y0} stroke={WIRE_COLOR} strokeWidth={1.8} />
      <line x1={leadX1} y1={leadY} x2={leadX2} y2={leadY} stroke={WIRE_COLOR} strokeWidth={1.8} />
      {/* current arrow on top lead */}
      <HorizontalArrow x1={leadX1 + 6} x2={leadX2 - 6} y={leadY} dir={topDir} color={CURRENT_COLOR} />
      {/* small "i" tag */}
      <text
        x={(leadX1 + leadX2) / 2} y={leadY - 8}
        fontFamily="'JetBrains Mono', monospace"
        fontSize={11} fontWeight={700} fill={CURRENT_COLOR}
        textAnchor="middle"
      >i</text>
    </g>
  )
}

function Wire({ cx, cy, orient }: { cx: number; cy: number; orient: Orient }) {
  const hLen = 150
  const y0 = cy - hLen / 2
  const y1 = cy + hLen / 2
  return (
    <g>
      <line x1={cx} y1={y0} x2={cx} y2={y1} stroke={WIRE_COLOR} strokeWidth={3.5} strokeLinecap="round" />
      {/* current arrow at midpoint */}
      <VerticalArrow x={cx} y={cy} dir={orient} color={CURRENT_COLOR} />
      {/* small "i" tag beside arrow */}
      <text
        x={cx + 14} y={cy + 4}
        fontFamily="'JetBrains Mono', monospace"
        fontSize={13} fontWeight={700} fill={CURRENT_COLOR}
      >i</text>
    </g>
  )
}

function HorizontalArrow({ x1, x2, y, dir, color }: {
  x1: number; x2: number; y: number; dir: Orient; color: string
}) {
  const midX = (x1 + x2) / 2
  const shaftFrom = dir === 1 ? x1 : x2
  const shaftTo = dir === 1 ? x2 : x1
  const tipX = shaftTo
  const baseX = shaftTo + (dir === 1 ? -10 : 10)
  return (
    <g>
      <line x1={shaftFrom} y1={y} x2={baseX} y2={y} stroke={color} strokeWidth={2.4} strokeLinecap="round" />
      <polygon
        points={`${tipX},${y} ${baseX},${y - 5} ${baseX},${y + 5}`}
        fill={color}
      />
      <text
        x={midX} y={y - 4}
        fontFamily="'JetBrains Mono', monospace"
        fontSize={10} fill={color}
        textAnchor="middle"
        opacity={0}
      >{dir === 1 ? '→' : '←'}</text>
    </g>
  )
}

function VerticalArrow({ x, y, dir, color }: {
  x: number; y: number; dir: Orient; color: string
}) {
  const tipY = dir === 1 ? y - 12 : y + 12
  const baseY = dir === 1 ? y + 2 : y - 2
  return (
    <polygon
      points={`${x},${tipY} ${x - 7},${baseY} ${x + 7},${baseY}`}
      fill={color}
    />
  )
}

function InteractionIndicator({ x1, x2, y, kind }: {
  x1: number; x2: number; y: number; kind: Kind | 'hidden'
}) {
  if (kind === 'hidden') {
    return (
      <g opacity={0.7}>
        <line
          x1={x1} y1={y} x2={x2} y2={y}
          stroke="#3A4863" strokeWidth={1.5} strokeDasharray="4 5"
        />
      </g>
    )
  }
  const color = kind === 'attract' ? ATTRACT_COLOR : REPEL_COLOR
  const midX = (x1 + x2) / 2
  const gap = 22
  // attract: arrows from outer edges point inward toward center
  // repel:   arrows from center point outward toward edges
  const drawArrow = (from: number, to: number) => {
    const sign = Math.sign(to - from)
    const tipX = to
    const baseX = to - sign * 10
    return (
      <g>
        <line x1={from} y1={y} x2={baseX} y2={y} stroke={color} strokeWidth={3} strokeLinecap="round" />
        <polygon
          points={`${tipX},${y} ${baseX},${y - 6} ${baseX},${y + 6}`}
          fill={color}
        />
      </g>
    )
  }
  if (kind === 'attract') {
    return (
      <g>
        {drawArrow(x1, midX - gap / 2)}
        {drawArrow(x2, midX + gap / 2)}
      </g>
    )
  }
  return (
    <g>
      {drawArrow(midX - gap / 2, x1)}
      {drawArrow(midX + gap / 2, x2)}
    </g>
  )
}

// ─── Helpers ────────────────────────────────────────────────────────────
function objectKey(mode: Mode, side: 'A' | 'B'): string {
  if (mode === 'aa') return 'obj_magnet'
  if (mode === 'ac') return side === 'A' ? 'obj_magnet' : 'obj_solenoid'
  return 'obj_wire'
}

function flipKey(mode: Mode, side: 'A' | 'B'): string {
  if (mode === 'aa') return 'flip_poles'
  if (mode === 'ac') return side === 'A' ? 'flip_poles' : 'flip_current'
  return 'flip_current'
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

function Toggle<T extends string>({ options, value, onChange }: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div style={{ display: 'flex', gap: '0.6rem' }}>
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            style={{
              flex: 1,
              padding: '1rem 1rem',
              background: active ? '#3A4863' : 'transparent',
              color: active ? '#EAF0FA' : '#6C7A93',
              border: '1px solid #3A4863',
              borderRadius: '0.5rem',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '1.9rem',
              cursor: 'pointer',
            }}
          >
            {o.label}
          </button>
        )
      })}
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
// 1 SVG unit = 0.222rem. top: 52*0.222 - 2.44*0.75 ≈ 9.7. bottom: (450-380)*0.222 = 15.6.
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
const flipBtnStyle: React.CSSProperties = {
  padding: '1rem 1.2rem',
  background: 'transparent',
  color: '#EAF0FA',
  border: '1px solid #3A4863',
  borderRadius: '0.5rem',
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: '2rem',
  cursor: 'pointer',
  textAlign: 'left',
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
