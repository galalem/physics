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
} from '@physics/sdk/react'
import { getHintFor, getStagesFor } from './stages'
import en from '../i18n/en.json'
import fr from '../i18n/fr.json'
import ar from '../i18n/ar.json'

// ─── Canvas ─────────────────────────────────────────────────────────────
const W = 800
const H = 450

// Circuit box
const CIRC_X0 = 40, CIRC_Y0 = 90, CIRC_W = 220, CIRC_H = 220

// Bode plot area
const BODE_X0 = 300, BODE_Y0 = 80
const BODE_W = 300, BODE_H = 310
const BODE_X1 = BODE_X0 + BODE_W
const BODE_Y1 = BODE_Y0 + BODE_H

// Frequency axis (log10): 10 Hz → 100 kHz (4 decades)
const F_MIN = 10
const F_MAX = 100000
const LOG_F_MIN = Math.log10(F_MIN)
const LOG_F_MAX = Math.log10(F_MAX)

// Magnitude axis: -60 dB → +10 dB
const DB_MIN = -60
const DB_MAX = 10

// Component ranges (log)
const R_MIN = 100    // Ω
const R_MAX = 100000 // 100 kΩ
const C_MIN = 1e-9   // 1 nF
const C_MAX = 10e-6  // 10 µF

// Stage 2 target
const STAGE2_FC_TARGET = 1000 // Hz
const STAGE2_TOL = 0.06       // ±6%

// Stage 3 problems: (f_c, choices)
type Problem = { fc: number; choices: number[] }
const STAGE3_PROBLEMS: Problem[] = [
  { fc: 1000,  choices: [100, 500, 1000, 5000] },
  { fc: 100,   choices: [10, 100, 1000, 3000] },
  { fc: 10000, choices: [1000, 3000, 10000, 30000] },
]

// ─── Helpers ────────────────────────────────────────────────────────────
function magDb(f: number, fc: number): number {
  return -10 * Math.log10(1 + (f / fc) * (f / fc))
}

function fToX(f: number): number {
  const t = (Math.log10(f) - LOG_F_MIN) / (LOG_F_MAX - LOG_F_MIN)
  return BODE_X0 + t * BODE_W
}

function dbToY(db: number): number {
  const t = (db - DB_MIN) / (DB_MAX - DB_MIN)
  return BODE_Y1 - t * BODE_H
}

function bodePath(fc: number, samples = 200): string {
  let d = ''
  for (let i = 0; i <= samples; i++) {
    const t = i / samples
    const f = Math.pow(10, LOG_F_MIN + t * (LOG_F_MAX - LOG_F_MIN))
    const y = dbToY(magDb(f, fc))
    d += (i === 0 ? 'M ' : 'L ') + `${fToX(f).toFixed(2)} ${y.toFixed(2)} `
  }
  return d
}

function formatHz(f: number): string {
  if (f >= 1000) return `${(f / 1000).toFixed(f >= 10000 ? 0 : 1)} kHz`
  return `${f.toFixed(0)} Hz`
}

function formatOhm(r: number): string {
  if (r >= 1000) return `${(r / 1000).toFixed(r >= 10000 ? 0 : 2)} kΩ`
  return `${r.toFixed(0)} Ω`
}

function formatFarad(c: number): string {
  if (c >= 1e-6) return `${(c * 1e6).toFixed(c >= 1e-5 ? 1 : 2)} µF`
  if (c >= 1e-9) return `${(c * 1e9).toFixed(c >= 1e-8 ? 0 : 1)} nF`
  return `${(c * 1e12).toFixed(0)} pF`
}

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

  // Component state
  const [logR, setLogR] = useState<number>(Math.log10(1000))   // 1 kΩ
  const [logC, setLogC] = useState<number>(Math.log10(100e-9)) // 100 nF

  const R = Math.pow(10, logR)
  const C = Math.pow(10, logC)
  const fc = 1 / (2 * Math.PI * R * C)
  const tau = R * C

  const [fcSeen, setFcSeen] = useState<Set<string>>(new Set())

  // Track distinct f_c values (rounded to 1 significant digit for stage 1 progress)
  useEffect(() => {
    if (!isObserve) return
    const bucket = Math.round(Math.log10(fc) * 3) // ~1/3 decade buckets
    setFcSeen((prev) => {
      const key = String(bucket)
      if (prev.has(key)) return prev
      const next = new Set(prev)
      next.add(key)
      return next
    })
  }, [isObserve, fc])

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

  // Advance criteria
  const observeDone = fcSeen.size >= 3
  const experimentDone = Math.abs(fc - STAGE2_FC_TARGET) / STAGE2_FC_TARGET < STAGE2_TOL
  const evaluateDone = q3Answers.every(
    (a, i) => a !== null && a === STAGE3_PROBLEMS[i]!.fc,
  )
  const canSubmit = isObserve ? observeDone : isExperiment ? experimentDone : evaluateDone

  const resetForStage = useCallback((stage: number) => {
    setLogR(Math.log10(1000))
    setLogC(Math.log10(100e-9))
    setFcSeen(new Set())
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

  // Which f_c drives the plot in each stage
  const plotFc = isEvaluate ? currentProblem.fc : fc

  // HUD
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${L('stage')} 0${stageIdx} · ${stageName}`
  const hudTR = isObserve
    ? `${L('fc_seen')}: ${fcSeen.size}/3`
    : isExperiment
      ? experimentDone
        ? `${L('matched')} ✓`
        : `${L('target')}: f_c = ${STAGE2_FC_TARGET} Hz`
      : `${L('question')} ${q3Idx + 1}/${STAGE3_PROBLEMS.length}`
  const hudBL = isObserve ? L('tip1') : isExperiment ? L('tip2') : L('tip3')

  // Bode marker at (f_c, -3 dB)
  const fcX = fToX(plotFc)
  const fcY = dbToY(-3)

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block', userSelect: 'none' }}
      >
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        {/* Circuit box */}
        <rect x={CIRC_X0} y={CIRC_Y0} width={CIRC_W} height={CIRC_H} fill="none" stroke="#12203a" strokeWidth={1} rx={6} />
        <text x={CIRC_X0 + 8} y={CIRC_Y0 - 10} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={11} letterSpacing="0.1em">
          {L('circuit_title')}
        </text>

        <CircuitDiagram
          x0={CIRC_X0} y0={CIRC_Y0}
          w={CIRC_W} h={CIRC_H}
          R={R} C={C}
          hideValues={isEvaluate}
          L={L}
        />

        {/* Bode plot */}
        <rect x={BODE_X0} y={BODE_Y0} width={BODE_W} height={BODE_H} fill="none" stroke="#12203a" strokeWidth={1} rx={6} />
        <text x={BODE_X0 + 8} y={BODE_Y0 - 10} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={11} letterSpacing="0.1em">
          {L('bode_title')}
        </text>

        {/* Axis labels */}
        <text x={BODE_X0 - 6} y={BODE_Y0 - 2} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={10} textAnchor="end">
          |H| (dB)
        </text>
        <text x={BODE_X1 + 4} y={BODE_Y1 + 12} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={10}>
          f (Hz)
        </text>

        {/* Y-axis gridlines / ticks */}
        {[10, 0, -10, -20, -30, -40, -50, -60].map((db) => {
          const y = dbToY(db)
          return (
            <g key={db}>
              <line x1={BODE_X0} y1={y} x2={BODE_X1} y2={y} stroke="#12203a" strokeWidth={1} strokeDasharray={db === 0 ? undefined : '2 4'} opacity={db === 0 ? 0.9 : 0.7} />
              <text x={BODE_X0 - 4} y={y + 3} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={9} textAnchor="end">
                {db}
              </text>
            </g>
          )
        })}

        {/* X-axis gridlines: decades + minor lines */}
        {[10, 100, 1000, 10000, 100000].map((f) => {
          const x = fToX(f)
          return (
            <g key={f}>
              <line x1={x} y1={BODE_Y0} x2={x} y2={BODE_Y1} stroke="#12203a" strokeWidth={1} strokeDasharray="2 4" />
              <text x={x} y={BODE_Y1 + 12} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={9} textAnchor="middle">
                {f >= 1000 ? `${f / 1000}k` : String(f)}
              </text>
            </g>
          )
        })}
        {/* Minor log gridlines (2..9 of each decade) */}
        {[10, 100, 1000, 10000].flatMap((base) =>
          [2, 3, 4, 5, 6, 7, 8, 9].map((k) => {
            const f = base * k
            if (f > F_MAX) return null
            const x = fToX(f)
            return (
              <line
                key={`${base}-${k}`}
                x1={x} y1={BODE_Y0} x2={x} y2={BODE_Y1}
                stroke="#12203a" strokeWidth={0.5} opacity={0.4}
              />
            )
          }),
        )}

        {/* -3 dB reference line */}
        <line
          x1={BODE_X0} y1={dbToY(-3)} x2={BODE_X1} y2={dbToY(-3)}
          stroke="#F9A968" strokeWidth={1} strokeDasharray="4 3" opacity={0.4}
        />
        <text x={BODE_X0 + 4} y={dbToY(-3) - 3} fill="#F9A968" fontFamily="'JetBrains Mono', monospace" fontSize={9} opacity={0.7}>
          −3 dB
        </text>

        {/* Asymptotes */}
        <line
          x1={BODE_X0} y1={dbToY(0)} x2={fcX} y2={dbToY(0)}
          stroke="#37C9B8" strokeWidth={1.2} strokeDasharray="5 4" opacity={0.6}
        />
        {/* -20 dB/decade slope: from (fc, 0) to lower-right */}
        <line
          x1={fcX} y1={dbToY(0)}
          x2={fToX(F_MAX)} y2={dbToY(-20 * Math.log10(F_MAX / plotFc))}
          stroke="#37C9B8" strokeWidth={1.2} strokeDasharray="5 4" opacity={0.6}
        />

        {/* Stage 2 target f_c vertical guide */}
        {isExperiment && (() => {
          const tX = fToX(STAGE2_FC_TARGET)
          return (
            <g opacity={0.75}>
              <line x1={tX} y1={BODE_Y0} x2={tX} y2={BODE_Y1} stroke="#F9A968" strokeWidth={1.4} strokeDasharray="6 4" />
              <text x={tX + 4} y={BODE_Y0 + 12} fill="#F9A968" fontFamily="'JetBrains Mono', monospace" fontSize={10}>
                {L('target_fc')}: {STAGE2_FC_TARGET} Hz
              </text>
            </g>
          )
        })()}

        {/* Bode curve */}
        <path d={bodePath(plotFc)} fill="none" stroke="#F9A968" strokeWidth={2.5} strokeLinejoin="round" />

        {/* f_c marker */}
        <line x1={fcX} y1={BODE_Y0} x2={fcX} y2={BODE_Y1} stroke="#B87CE0" strokeWidth={1} strokeDasharray="3 3" opacity={0.7} />
        <circle cx={fcX} cy={fcY} r={5} fill="#B87CE0" stroke="#0D1524" strokeWidth={1.5} />
        <text
          x={Math.min(fcX + 6, BODE_X1 - 60)}
          y={fcY - 8}
          fill="#B87CE0"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={11}
          fontWeight={700}
        >
          f_c = {formatHz(plotFc)}
        </text>
      </svg>

      <div style={hudTLStyle}>{hudTL}</div>
      <div style={{ ...hudTRStyle, color: canSubmit ? '#37C9B8' : '#B9C4D6' }}>{hudTR}</div>
      <div style={hudBLStyle}>{hudBL}</div>

      <div style={rightPanelWrapperStyle}>
        <div style={rightPanelTitleStyle}>{L('controls_title')}</div>
        <div style={rightPanelBoxStyle}>
        {!isEvaluate && (
          <>
            <FieldGroup label={`${L('field_R')}: ${formatOhm(R)}`}>
              <NumberSlider
                min={Math.log10(R_MIN)} max={Math.log10(R_MAX)}
                step={0.05}
                value={logR}
                onChange={setLogR}
              />
            </FieldGroup>

            <FieldGroup label={`${L('field_C')}: ${formatFarad(C)}`}>
              <NumberSlider
                min={Math.log10(C_MIN)} max={Math.log10(C_MAX)}
                step={0.05}
                value={logC}
                onChange={setLogC}
              />
            </FieldGroup>

            <div style={statusBoxStyle}>
              <div style={statusLabelStyle}>{L('field_derived')}</div>
              <div style={{ fontSize: '1.8rem', color: '#B9C4D6' }}>
                f_c = <span style={{ color: '#B87CE0', fontWeight: 700 }}>{formatHz(fc)}</span>
              </div>
              <div style={{ fontSize: '1.8rem', color: '#B9C4D6' }}>
                τ = <span style={{ color: '#37C9B8', fontWeight: 700 }}>{(tau * 1000).toFixed(3)}</span> ms
              </div>
              {isExperiment && experimentDone && (
                <div style={{ fontSize: '1.6rem', color: '#37C9B8', marginTop: '0.3rem' }}>
                  ✓ {L('matched')}
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
              padding: '0.9rem 1rem',
              border: '1px solid #12203a', borderRadius: '0.5rem',
            }}>
              <div style={{ fontSize: '1.5rem', color: '#54617A', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '0.3rem' }}>
                {L('read_fc')}
              </div>
              <div style={{ fontSize: '1.6rem', color: '#54617A' }}>
                {L('fc_definition')}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
              {q3ChoicesShuffled.map((choice) => {
                const isPicked = q3CurrentAnswer === choice
                const isCorrect = choice === currentProblem.fc
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
                      padding: '0.7rem 0.5rem',
                      background: bg,
                      color,
                      border: '1px solid #3A4863',
                      borderRadius: '0.4rem',
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: '1.7rem',
                      fontWeight: 700,
                      cursor: showResult ? 'default' : 'pointer',
                    }}
                  >
                    {formatHz(choice)}
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

            <div style={{ fontSize: '1.5rem', color: '#54617A', marginTop: '0.3rem' }}>
              {q3Answers.filter((a, i) => a === STAGE3_PROBLEMS[i]!.fc).length}/{STAGE3_PROBLEMS.length} {L('correct')}
            </div>
          </>
        )}
        </div>
      </div>
    </div>
  )
}

// ─── Sub-components ─────────────────────────────────────────────────────
function CircuitDiagram({ x0, y0, w, h, R, C, hideValues, L }: {
  x0: number; y0: number; w: number; h: number
  R: number; C: number
  hideValues: boolean
  L: (k: string) => string
}) {
  // Layout inside the circuit box
  const inX = x0 + 30
  const outX = x0 + w - 30
  const topY = y0 + 50
  const botY = y0 + h - 50
  const midX = (inX + outX) / 2

  // Resistor: horizontal zigzag at top
  const rL = 60
  const rX0 = midX - rL / 2
  const rX1 = midX + rL / 2
  const rY = topY

  // Capacitor: vertical, right of R, between top rail and ground
  const capX = outX
  const capTop = topY + 20
  const capBot = capTop + 30
  const capW = 20

  return (
    <g>
      {/* Input node label + arrow */}
      <text x={inX} y={topY - 12} fill="#54617A" fontFamily="'JetBrains Mono', monospace" fontSize={10} textAnchor="middle">
        {L('v_in')}
      </text>
      <circle cx={inX} cy={topY} r={3} fill="#B9C4D6" />

      {/* Top rail: input → R → cap top → output */}
      <line x1={inX} y1={topY} x2={rX0} y2={topY} stroke="#B9C4D6" strokeWidth={1.5} />
      {/* Resistor zigzag */}
      <polyline
        points={[
          [rX0, rY],
          [rX0 + 6, rY - 8],
          [rX0 + 18, rY + 8],
          [rX0 + 30, rY - 8],
          [rX0 + 42, rY + 8],
          [rX0 + 54, rY - 8],
          [rX1, rY],
        ].map((p) => p.join(',')).join(' ')}
        fill="none" stroke="#B9C4D6" strokeWidth={1.5}
      />
      <text x={midX} y={rY - 16} fill="#37C9B8" fontFamily="'JetBrains Mono', monospace" fontSize={11} fontWeight={700} textAnchor="middle">
        R{hideValues ? '' : ` = ${formatOhm(R)}`}
      </text>
      <line x1={rX1} y1={topY} x2={capX} y2={topY} stroke="#B9C4D6" strokeWidth={1.5} />

      {/* Output node */}
      <line x1={capX} y1={topY} x2={capX} y2={capTop} stroke="#B9C4D6" strokeWidth={1.5} />
      <circle cx={outX + 20} cy={topY} r={3} fill="#B9C4D6" />
      <line x1={capX} y1={topY} x2={outX + 20} y2={topY} stroke="#B9C4D6" strokeWidth={1.5} />
      <text x={outX + 30} y={topY - 4} fill="#54617A" fontFamily="'JetBrains Mono', monospace" fontSize={10}>
        {L('v_out')}
      </text>

      {/* Capacitor plates */}
      <line x1={capX - capW / 2} y1={capTop} x2={capX + capW / 2} y2={capTop} stroke="#B9C4D6" strokeWidth={2} />
      <line x1={capX - capW / 2} y1={capBot - 8} x2={capX + capW / 2} y2={capBot - 8} stroke="#B9C4D6" strokeWidth={2} />
      <line x1={capX} y1={capBot - 8} x2={capX} y2={botY} stroke="#B9C4D6" strokeWidth={1.5} />
      <text x={capX + 16} y={(capTop + capBot) / 2} fill="#F9A968" fontFamily="'JetBrains Mono', monospace" fontSize={11} fontWeight={700}>
        C{hideValues ? '' : ` = ${formatFarad(C)}`}
      </text>

      {/* Ground rail — input and output share the reference bottom rail */}
      <line x1={inX} y1={topY} x2={inX} y2={botY} stroke="#B9C4D6" strokeWidth={1.5} />
      <line x1={inX} y1={botY} x2={capX} y2={botY} stroke="#B9C4D6" strokeWidth={1.5} />

      {/* Ground symbol — vertical stub below the rail, then the 3-line ⏚ glyph */}
      <line x1={midX} y1={botY} x2={midX} y2={botY + 10} stroke="#B9C4D6" strokeWidth={1.5} />
      <line x1={midX - 12} y1={botY + 10} x2={midX + 12} y2={botY + 10} stroke="#B9C4D6" strokeWidth={2} />
      <line x1={midX - 8}  y1={botY + 14} x2={midX + 8}  y2={botY + 14} stroke="#B9C4D6" strokeWidth={1.5} />
      <line x1={midX - 4}  y1={botY + 18} x2={midX + 4}  y2={botY + 18} stroke="#B9C4D6" strokeWidth={1.5} />
    </g>
  )
}

function NumberSlider({ min, max, step, value, onChange, disabled }: {
  min: number; max: number; step: number
  value: number
  onChange: (v: number) => void
  disabled?: boolean
}) {
  const bump = (delta: number) => onChange(Math.min(max, Math.max(min, +(value + delta).toFixed(3))))
  return (
    <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', width: '100%', minWidth: 0 }}>
      <button type="button" onClick={() => bump(-step)} disabled={disabled || value <= min} style={sliderBtnStyle}>−</button>
      <input
        type="range"
        min={min} max={max} step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        disabled={disabled}
        style={{ flex: 1, minWidth: 0, width: 0, accentColor: '#F9A968' }}
      />
      <button type="button" onClick={() => bump(step)} disabled={disabled || value >= max} style={sliderBtnStyle}>+</button>
    </div>
  )
}

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
      <div style={{ fontSize: '1.5rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: '#54617A' }}>{label}</div>
      {children}
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
// Panel aligned to bode plot (SVG y=80..390, H=310).
// bode ends at SVG x=600 so controls start further right (width 33rem = SVG 150 units).
const rightPanelWrapperStyle: React.CSSProperties = {
  position: 'absolute',
  top: '13.7rem', bottom: '13.3rem',
  right: '6.7rem',
  width: '33rem',
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
const releaseBtnStyle: React.CSSProperties = {
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
