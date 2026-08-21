import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  useSetStage,
  useCurrentStage,
  useComplete,
  useDeclareStages,
  useHint,
  useInit,
  useNext,
  useProgress,
  useReset,
  useSeed,
  useTicker,
} from '@physics/sdk/react'
import { getHintFor, getStagesFor } from './stages'
import en from '../i18n/en.json'
import fr from '../i18n/fr.json'
import ar from '../i18n/ar.json'

// ─── Canvas ─────────────────────────────────────────────────────────────
const W = 800
const H = 450

// ─── Physics constants ──────────────────────────────────────────────────
const G = 10 // m/s² (2ème convention)
const H_MAX = 3 // metres
const MASS_OPTIONS = [0.5, 1.0, 2.0]

// Ramp geometry — inclined line from top-left to bottom-right.
const RAMP_TOP = { x: 100, y: 140 }
const RAMP_BOT = { x: 340, y: 340 }
const RAMP_DX = RAMP_BOT.x - RAMP_TOP.x // 240
const RAMP_DY = RAMP_BOT.y - RAMP_TOP.y // 200
const RAMP_LEN_PX = Math.hypot(RAMP_DX, RAMP_DY)
const SIN_THETA = RAMP_DY / RAMP_LEN_PX
const SIN_SQ = SIN_THETA * SIN_THETA
const PX_PER_M = 200 / H_MAX

const GROUND_Y = 340

// Bars area (inside the scene box, right of the ramp)
const BAR_X0 = 400, BAR_Y0 = 110, BAR_W = 160, BAR_H = 220
const BAR_LABELS_Y = BAR_Y0 + BAR_H + 20

// Max energy for bar scale: E_max = m_max * g * h_max = 2 * 10 * 3 = 60 J
const E_MAX = MASS_OPTIONS[MASS_OPTIONS.length - 1]! * G * H_MAX

// Stage 2 target: v_target at bottom → h₀ solution = v²/(2g)
const STAGE2_V_TARGET = 6 // m/s → h₀ = 1.8 m
const STAGE2_H_SOLUTION = (STAGE2_V_TARGET * STAGE2_V_TARGET) / (2 * G)
const STAGE2_H_TOL = 0.06

// Stage 3 problems: (mass, h₀) → v = √(2·g·h)
type Problem = { m: number; h: number; correct: number; choices: number[] }
const STAGE3_PROBLEMS: Problem[] = [
  { m: 1.0, h: 1.25, correct: 5, choices: [4, 5, 6, 12.5] },
  { m: 0.5, h: 0.8,  correct: 4, choices: [3, 4, 5, 8] },
  { m: 2.0, h: 1.8,  correct: 6, choices: [5, 6, 8, 18] },
]

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
  const rootRng = useSeed()

  const stageIdx = useCurrentStage()
  const isObserve = stageIdx === 1
  const isExperiment = stageIdx === 2
  const isEvaluate = stageIdx === 3

  // Sim state (stages 1 + 2)
  const [mass, setMass] = useState<number>(1.0)
  const [h0, setH0] = useState<number>(1.5)
  const [h, setH] = useState<number>(1.5)
  const [tSim, setTSim] = useState<number>(0)
  const [running, setRunning] = useState<boolean>(false)
  const [reachedBottom, setReachedBottom] = useState<boolean>(false)
  const [heightsSeen, setHeightsSeen] = useState<Set<string>>(new Set())
  const [releaseCount, setReleaseCount] = useState<number>(0)

  // Stage 3
  const stage3Order = useMemo(
    () => rootRng.shuffle(STAGE3_PROBLEMS.map((_, i) => i)),
    [rootRng],
  )
  const [q3Idx, setQ3Idx] = useState<number>(0)
  const [q3Answers, setQ3Answers] = useState<(number | null)[]>(
    () => STAGE3_PROBLEMS.map(() => null),
  )
  const currentProblem = STAGE3_PROBLEMS[stage3Order[q3Idx]!]!
  const q3ChoicesShuffled = useMemo(
    () => rootRng.fork().shuffle(currentProblem.choices),
    [rootRng, currentProblem],
  )
  const q3CurrentAnswer = q3Answers[stage3Order[q3Idx]!]

  const setStage = useSetStage()
  const progress = useProgress()
  const complete = useComplete()

  // Speed derived from energy conservation
  const v = Math.sqrt(Math.max(0, 2 * G * (h0 - h)))

  // Energies
  const Ep = mass * G * h
  const Ec = 0.5 * mass * v * v
  const Em = Ep + Ec

  // Advance criteria
  const observeDone = releaseCount >= 2 && heightsSeen.size >= 2
  const experimentDone =
    reachedBottom && Math.abs(h0 - STAGE2_H_SOLUTION) < STAGE2_H_TOL
  const evaluateDone = q3Answers.every(
    (a, i) => a !== null && a === STAGE3_PROBLEMS[i]!.correct,
  )
  const canSubmit = isObserve ? observeDone : isExperiment ? experimentDone : evaluateDone

  // Ticker
  useTicker((dt) => {
    if (!running) return
    const newT = tSim + dt
    const drop = 0.5 * G * SIN_SQ * newT * newT
    const newH = h0 - drop
    if (newH <= 0) {
      setH(0)
      setRunning(false)
      setReachedBottom(true)
      return
    }
    setTSim(newT)
    setH(newH)
  })

  // Snap ball to slider height when not running
  useEffect(() => {
    if (!running) {
      setH(h0)
      setTSim(0)
    }
  }, [h0, running])

  const release = useCallback(() => {
    if (running || h0 <= 0.01) return
    setH(h0)
    setTSim(0)
    setReachedBottom(false)
    setRunning(true)
    setReleaseCount((n) => n + 1)
    setHeightsSeen((prev) => {
      const key = h0.toFixed(1)
      if (prev.has(key)) return prev
      const next = new Set(prev)
      next.add(key)
      return next
    })
  }, [h0, running])

  const resetForStage = useCallback((stage: number) => {
    setMass(1.0)
    setH0(1.5)
    setH(1.5)
    setTSim(0)
    setRunning(false)
    setReachedBottom(false)
    setHeightsSeen(new Set())
    setReleaseCount(0)
    setQ3Idx(0)
    setQ3Answers(STAGE3_PROBLEMS.map(() => null))
    void stage
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

  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  // Ball position on ramp
  const rampT = h / H_MAX
  const ballX = RAMP_BOT.x - RAMP_DX * rampT
  const ballY = RAMP_BOT.y - RAMP_DY * rampT

  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${L('stage')} 0${stageIdx} · ${stageName}`
  const hudTR = isObserve
    ? `${L('drops')}: ${releaseCount}  ·  ${L('heights')}: ${heightsSeen.size}`
    : isExperiment
      ? experimentDone
        ? `${L('matched')} ✓`
        : `${L('target')}: v = ${STAGE2_V_TARGET} m/s`
      : `${L('question')} ${q3Idx + 1}/${STAGE3_PROBLEMS.length}`
  const hudBL = isObserve ? L('tip1') : isExperiment ? L('tip2') : L('tip3')

  const barsHidden = isEvaluate
  const barValueToH = (val: number) => (val / E_MAX) * BAR_H

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block', borderRadius: 14, userSelect: 'none' }}
      >
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" rx={14} />

        {/* Scene box (ramp + bars) */}
        <rect x={40} y={60} width={540} height={320} fill="none" stroke="#12203a" strokeWidth={1} rx={6} />
        <text x={48} y={52} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={11} letterSpacing="0.1em">
          {L('scene_title')}
        </text>
        {/* Divider between ramp area and bars area */}
        <line x1={385} y1={68} x2={385} y2={372} stroke="#12203a" strokeWidth={1} strokeDasharray="3 4" opacity={0.7} />

        {/* Height axis */}
        <line x1={80} y1={GROUND_Y} x2={80} y2={GROUND_Y - H_MAX * PX_PER_M} stroke="#3A4863" strokeWidth={1} />
        {[0, 1, 2, 3].map((hMark) => {
          const y = GROUND_Y - hMark * PX_PER_M
          return (
            <g key={hMark}>
              <line x1={76} y1={y} x2={84} y2={y} stroke="#3A4863" strokeWidth={1} />
              <text x={72} y={y + 4} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={10} textAnchor="end">
                {hMark}
              </text>
            </g>
          )
        })}
        <text x={72} y={GROUND_Y - H_MAX * PX_PER_M - 8} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={10} textAnchor="end">
          h (m)
        </text>

        {/* Ground */}
        <line x1={90} y1={GROUND_Y} x2={378} y2={GROUND_Y} stroke="#3A4863" strokeWidth={1.4} />
        {Array.from({ length: 10 }, (_, i) => {
          const x = 100 + i * 28
          return (
            <line key={i} x1={x} y1={GROUND_Y} x2={x - 6} y2={GROUND_Y + 8} stroke="#3A4863" strokeWidth={0.8} />
          )
        })}

        {/* Ramp */}
        <polygon
          points={`${RAMP_TOP.x},${RAMP_TOP.y} ${RAMP_BOT.x},${RAMP_BOT.y} ${RAMP_TOP.x},${RAMP_BOT.y}`}
          fill="#12203a" opacity={0.6}
        />
        <line
          x1={RAMP_TOP.x} y1={RAMP_TOP.y}
          x2={RAMP_BOT.x} y2={RAMP_BOT.y}
          stroke="#B9C4D6" strokeWidth={3} strokeLinecap="round"
        />

        {/* h₀ guide */}
        {!isEvaluate && (
          <g opacity={0.55}>
            <line
              x1={RAMP_BOT.x - RAMP_DX * (h0 / H_MAX)}
              y1={GROUND_Y}
              x2={RAMP_BOT.x - RAMP_DX * (h0 / H_MAX)}
              y2={GROUND_Y - h0 * PX_PER_M}
              stroke="#37C9B8" strokeWidth={1} strokeDasharray="3 4"
            />
            <line
              x1={80}
              y1={GROUND_Y - h0 * PX_PER_M}
              x2={RAMP_BOT.x - RAMP_DX * (h0 / H_MAX)}
              y2={GROUND_Y - h0 * PX_PER_M}
              stroke="#37C9B8" strokeWidth={1} strokeDasharray="3 4"
            />
          </g>
        )}

        {/* Stage 2 target height guide */}
        {isExperiment && (
          <g opacity={0.75}>
            <line
              x1={80}
              y1={GROUND_Y - STAGE2_H_SOLUTION * PX_PER_M}
              x2={378}
              y2={GROUND_Y - STAGE2_H_SOLUTION * PX_PER_M}
              stroke="#F9A968" strokeWidth={1.2} strokeDasharray="5 4"
            />
            <text
              x={378} y={GROUND_Y - STAGE2_H_SOLUTION * PX_PER_M - 4}
              fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
              textAnchor="end"
            >
              {L('target_h')}
            </text>
          </g>
        )}

        {/* Ball */}
        <circle cx={ballX} cy={ballY - 10} r={10} fill="#F9A968" stroke="#0D1524" strokeWidth={1.5} />

        {/* Velocity arrow */}
        {running && v > 0.1 && (() => {
          const arrLen = Math.min(50, 6 + v * 4)
          const nx = RAMP_DX / RAMP_LEN_PX
          const ny = RAMP_DY / RAMP_LEN_PX
          const tipX = ballX + nx * arrLen
          const tipY = ballY - 10 + ny * arrLen
          return (
            <g>
              <line
                x1={ballX} y1={ballY - 10}
                x2={tipX} y2={tipY}
                stroke="#F9A968" strokeWidth={2}
              />
              <polygon
                points={`${tipX},${tipY} ${tipX - nx * 8 - ny * 4},${tipY - ny * 8 + nx * 4} ${tipX - nx * 8 + ny * 4},${tipY - ny * 8 - nx * 4}`}
                fill="#F9A968"
              />
            </g>
          )
        })()}

        {/* Speed readout by ball */}
        {!isEvaluate && (
          <text
            x={ballX + 16} y={ballY - 14}
            fill="#F9A968"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={12}
            fontWeight={700}
          >
            v = {v.toFixed(1)} m/s
          </text>
        )}

        {/* Bars title (inside scene box, above bars) */}
        <text x={BAR_X0} y={BAR_Y0 - 20} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={11} letterSpacing="0.1em">
          {L('bars_title')}
        </text>

        {barsHidden ? (
          <g>
            <rect x={BAR_X0} y={BAR_Y0} width={BAR_W} height={BAR_H} fill="#0F1A2E" stroke="#12203a" strokeWidth={1} rx={4} />
            <text
              x={BAR_X0 + BAR_W / 2} y={BAR_Y0 + BAR_H / 2}
              fill="#6C7A93"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={14}
              textAnchor="middle"
            >
              {L('bars_hidden')}
            </text>
          </g>
        ) : (() => {
          const barSlotW = BAR_W / 3
          const barInnerW = barSlotW * 0.55
          const bars = [
            { key: 'Ep', label: 'E_p', value: Ep, color: '#37C9B8' },
            { key: 'Ec', label: 'E_c', value: Ec, color: '#F9A968' },
            { key: 'Em', label: 'E_m', value: Em, color: '#B87CE0' },
          ]
          return (
            <g>
              {bars.map((b, i) => {
                const cx = BAR_X0 + barSlotW * i + barSlotW / 2
                const barH = barValueToH(b.value)
                const barTop = BAR_Y0 + BAR_H - barH
                return (
                  <g key={b.key}>
                    <rect
                      x={cx - barInnerW / 2}
                      y={BAR_Y0}
                      width={barInnerW}
                      height={BAR_H}
                      fill="#0F1A2E"
                      stroke="#12203a"
                      strokeWidth={1}
                      rx={3}
                    />
                    <rect
                      x={cx - barInnerW / 2}
                      y={barTop}
                      width={barInnerW}
                      height={barH}
                      fill={b.color}
                      opacity={0.85}
                      rx={3}
                    />
                    <text
                      x={cx} y={BAR_Y0 - 8}
                      fill={b.color}
                      fontFamily="'JetBrains Mono', monospace"
                      fontSize={13}
                      fontWeight={700}
                      textAnchor="middle"
                    >
                      {b.label}
                    </text>
                    <text
                      x={cx} y={BAR_LABELS_Y}
                      fill="#B9C4D6"
                      fontFamily="'JetBrains Mono', monospace"
                      fontSize={12}
                      textAnchor="middle"
                    >
                      {b.value.toFixed(1)}
                    </text>
                    <text
                      x={cx} y={BAR_LABELS_Y + 16}
                      fill="#54617A"
                      fontFamily="'JetBrains Mono', monospace"
                      fontSize={10}
                      textAnchor="middle"
                    >
                      J
                    </text>
                  </g>
                )
              })}
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
        {!isEvaluate && (
          <>
            <FieldGroup label={`${L('field_mass')}: ${mass.toFixed(1)} kg`}>
              <Toggle
                options={MASS_OPTIONS.map((m) => ({ value: String(m), label: `${m.toFixed(1)}` }))}
                value={String(mass)}
                onChange={(v) => setMass(parseFloat(v))}
              />
            </FieldGroup>

            <FieldGroup label={`${L('field_h0')}: ${h0.toFixed(2)} m`}>
              <NumberSlider
                min={0} max={H_MAX} step={0.05}
                value={h0}
                onChange={(val) => {
                  if (running) return
                  setH0(val)
                  setReachedBottom(false)
                }}
                disabled={running}
              />
            </FieldGroup>

            <button
              type="button"
              onClick={release}
              disabled={running || h0 <= 0.01}
              style={{
                ...releaseBtnStyle,
                opacity: running || h0 <= 0.01 ? 0.4 : 1,
                cursor: running || h0 <= 0.01 ? 'not-allowed' : 'pointer',
              }}
            >
              {running ? `▶ ${L('running')}` : `▶ ${L('release')}`}
            </button>

            <div style={statusBoxStyle}>
              <div style={statusLabelStyle}>{L('field_status')}</div>
              <div style={{ fontSize: '1.9rem', color: '#B9C4D6' }}>
                h = <span style={{ color: '#37C9B8', fontWeight: 700 }}>{h.toFixed(2)}</span> m
              </div>
              <div style={{ fontSize: '1.9rem', color: '#B9C4D6' }}>
                v = <span style={{ color: '#F9A968', fontWeight: 700 }}>{v.toFixed(2)}</span> m/s
              </div>
              {reachedBottom && (
                <div style={{ fontSize: '1.7rem', color: '#37C9B8', marginTop: '0.5rem' }}>
                  ✓ {L('at_bottom')}: v = {Math.sqrt(2 * G * h0).toFixed(2)} m/s
                </div>
              )}
            </div>
          </>
        )}

        {isEvaluate && (
          <>
            <div style={{ fontSize: '1.8rem', color: '#B9C4D6', lineHeight: 1.5 }}>
              {L('evaluate_prompt')}
            </div>

            <div style={{
              padding: '1.2rem 1.4rem',
              border: '1px solid #12203a', borderRadius: '0.5rem',
              display: 'flex', flexDirection: 'column', gap: '0.6rem',
            }}>
              <div style={{ fontSize: '1.5rem', color: '#54617A', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                {L('given')}
              </div>
              <div style={{ fontSize: '1.9rem', color: '#EAF0FA' }}>
                m = <span style={{ color: '#37C9B8', fontWeight: 700 }}>{currentProblem.m.toFixed(1)}</span> kg
              </div>
              <div style={{ fontSize: '1.9rem', color: '#EAF0FA' }}>
                h₀ = <span style={{ color: '#37C9B8', fontWeight: 700 }}>{currentProblem.h.toFixed(2)}</span> m
              </div>
              <div style={{ fontSize: '1.5rem', color: '#54617A', marginTop: '0.3rem' }}>
                g = {G} m/s²
              </div>
            </div>

            <div style={{ fontSize: '1.8rem', color: '#B9C4D6' }}>
              {L('v_at_bottom')}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem' }}>
              {q3ChoicesShuffled.map((choice) => {
                const isPicked = q3CurrentAnswer === choice
                const isCorrect = choice === currentProblem.correct
                const showResult = q3CurrentAnswer !== null
                const bg = showResult
                  ? isCorrect
                    ? '#37C9B8'
                    : isPicked
                      ? '#F97316'
                      : 'transparent'
                  : isPicked
                    ? '#3A4863'
                    : 'transparent'
                const color = showResult && (isCorrect || isPicked) ? '#0D1524' : '#EAF0FA'
                return (
                  <button
                    key={choice}
                    type="button"
                    disabled={showResult}
                    onClick={() => {
                      setQ3Answers((prev) => {
                        const next = [...prev]
                        next[stage3Order[q3Idx]!] = choice
                        return next
                      })
                    }}
                    style={{
                      padding: '1.2rem 1rem',
                      background: bg,
                      color,
                      border: '1px solid #3A4863',
                      borderRadius: '0.4rem',
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: '2rem',
                      fontWeight: 700,
                      cursor: showResult ? 'default' : 'pointer',
                    }}
                  >
                    {choice} m/s
                  </button>
                )
              })}
            </div>

            {q3CurrentAnswer !== null && q3Idx < STAGE3_PROBLEMS.length - 1 && (
              <button
                type="button"
                onClick={() => setQ3Idx((n) => n + 1)}
                style={releaseBtnStyle}
              >
                {L('next_q')} →
              </button>
            )}

            <div style={{ fontSize: '1.5rem', color: '#54617A', marginTop: '0.5rem' }}>
              {q3Answers.filter((a, i) => a === STAGE3_PROBLEMS[i]!.correct).length}/{STAGE3_PROBLEMS.length} {L('correct')}
            </div>
          </>
        )}
        </div>
      </div>
    </div>
  )
}

// ─── Sub-components ─────────────────────────────────────────────────────
function NumberSlider({ min, max, step, value, onChange, disabled }: {
  min: number; max: number; step: number
  value: number
  onChange: (v: number) => void
  disabled?: boolean
}) {
  const bump = (delta: number) => onChange(Math.min(max, Math.max(min, +(value + delta).toFixed(2))))
  return (
    <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', width: '100%', minWidth: 0 }}>
      <button
        type="button"
        onClick={() => bump(-step)}
        disabled={disabled || value <= min}
        style={sliderBtnStyle}
      >−</button>
      <input
        type="range"
        min={min} max={max} step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        disabled={disabled}
        style={{ flex: 1, minWidth: 0, width: 0, accentColor: '#F9A968' }}
      />
      <button
        type="button"
        onClick={() => bump(step)}
        disabled={disabled || value >= max}
        style={sliderBtnStyle}
      >+</button>
    </div>
  )
}

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
      <div style={{ fontSize: '1.5rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: '#54617A' }}>{label}</div>
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
              borderRadius: '0.4rem',
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
const rightPanelWrapperStyle: React.CSSProperties = {
  position: 'absolute',
  top: '9.7rem', bottom: '15.6rem',
  right: '6.7rem', width: '40rem',
  boxSizing: 'border-box', zIndex: 6,
  color: '#B9C4D6', fontFamily: "'JetBrains Mono', monospace",
  display: 'flex', flexDirection: 'column',
}
const rightPanelTitleStyle: React.CSSProperties = {
  fontSize: '2.44rem', color: '#6C7A93',
  letterSpacing: '0.1em', marginBottom: '1.2rem', marginLeft: '0.4rem',
}
const rightPanelBoxStyle: React.CSSProperties = {
  flex: 1, border: '1px solid #12203a', borderRadius: '0.6rem',
  padding: '2rem',
  display: 'flex', flexDirection: 'column', gap: '1.8rem',
  fontSize: '2rem', overflow: 'auto',
}
const statusBoxStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: '0.6rem',
  padding: '1.2rem 1.4rem',
  border: '1px solid #12203a', borderRadius: '0.5rem',
}
const statusLabelStyle: React.CSSProperties = {
  fontSize: '1.5rem', color: '#54617A',
  letterSpacing: '0.08em', textTransform: 'uppercase',
}
const releaseBtnStyle: React.CSSProperties = {
  padding: '1.2rem 1.4rem',
  background: '#F9A968',
  color: '#0D1524',
  border: '1px solid #F9A968',
  borderRadius: '0.4rem',
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: '2rem',
  fontWeight: 700,
  cursor: 'pointer',
}
const sliderBtnStyle: React.CSSProperties = {
  width: '3.2rem', height: '3.2rem',
  background: 'transparent',
  color: '#B9C4D6',
  border: '1px solid #3A4863',
  borderRadius: '0.4rem',
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: '2rem',
  cursor: 'pointer',
}
