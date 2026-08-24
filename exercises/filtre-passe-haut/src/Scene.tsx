import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  useSeed,
} from '@physics/sdk/react'
import { getHintFor, getStagesFor } from './stages'
import en from '../i18n/en.json'

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

// Stage 2 target (high-pass to reject 50 Hz mains hum)
const STAGE2_FC_TARGET = 200 // Hz
const STAGE2_TOL = 0.06       // ±6%

// Stage 3 problems: (f_c, choices)
type Problem = { fc: number; choices: number[] }
const STAGE3_PROBLEMS: Problem[] = [
  { fc: 200,   choices: [50, 200, 600, 2000] },
  { fc: 3000,  choices: [300, 1000, 3000, 10000] },
  { fc: 20000, choices: [2000, 6000, 20000, 60000] },
  { fc: 100,   choices: [30, 100, 300, 1000] },
]

// ─── Helpers ────────────────────────────────────────────────────────────
// CR high-pass: |H|_dB = 10·log10( (f/fc)^2 / (1 + (f/fc)^2) )
function magDb(f: number, fc: number): number {
  const r = f / fc
  const r2 = r * r
  return 10 * Math.log10(r2 / (1 + r2))
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
const dict = { en } as const
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

  // Track distinct f_c decade buckets (~1/3 decade granularity) for stage 1
  useEffect(() => {
    if (!isObserve) return
    const bucket = Math.round(Math.log10(fc) * 3)
    setFcSeen((prev) => {
      const key = String(bucket)
      if (prev.has(key)) return prev
      const next = new Set(prev)
      next.add(key)
      return next
    })
  }, [isObserve, fc])

  // Stage 3 — ace-the-deck
  const [deckOrder, setDeckOrder] = useState<number[]>(
    () => rootRng.shuffle(STAGE3_PROBLEMS.map((_, i) => i)),
  )
  const [passIdx, setPassIdx] = useState(0)
  const [pick, setPick] = useState<number | null>(null)
  const [showResult, setShowResult] = useState(false)
  const [wrongBanner, setWrongBanner] = useState(false)

  const currentProblem = STAGE3_PROBLEMS[deckOrder[passIdx] ?? 0]!
  const choicesShuffled = useMemo(
    () => rootRng.fork().shuffle(currentProblem.choices),
    [rootRng, currentProblem],
  )

  const reshuffleDeck = useCallback(() => {
    setDeckOrder(rootRng.fork().shuffle(STAGE3_PROBLEMS.map((_, i) => i)))
    setPassIdx(0)
    setPick(null)
    setShowResult(false)
    setWrongBanner(false)
  }, [rootRng])

  const handlePick = useCallback((choice: number) => {
    if (showResult || pick !== null) return
    setPick(choice)
    setShowResult(true)
    if (choice === currentProblem.fc) {
      setTimeout(() => {
        setPick(null)
        setShowResult(false)
        setPassIdx((n) => n + 1)
      }, 900)
    } else {
      setWrongBanner(true)
      setTimeout(() => {
        setWrongBanner(false)
        reshuffleDeck()
      }, 1400)
    }
  }, [showResult, pick, currentProblem, reshuffleDeck])

  const setStage = useSetStage()
  const progress = useProgress()
  const complete = useComplete()

  // Advance criteria
  const observeDone = fcSeen.size >= 3
  const experimentDone = Math.abs(fc - STAGE2_FC_TARGET) / STAGE2_FC_TARGET < STAGE2_TOL
  const evaluateDone = passIdx >= STAGE3_PROBLEMS.length && !showResult
  const canSubmit = isObserve ? observeDone : isExperiment ? experimentDone : evaluateDone

  const resetForStage = useCallback((stage: number) => {
    setLogR(Math.log10(1000))
    setLogC(Math.log10(100e-9))
    setFcSeen(new Set())
    reshuffleDeck()
    void stage
  }, [reshuffleDeck])

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

  // Peek — rotate through 3 method tips (stage 3 only)
  const peekIdxRef = useRef(0)
  const [peekTip, setPeekTip] = useState<string | null>(null)
  usePeek(() => {
    if (!isEvaluate) return
    const key = `peek_tip_${(peekIdxRef.current % 3) + 1}`
    setPeekTip(L(key))
    peekIdxRef.current += 1
  })
  useEffect(() => {
    if (!peekTip) return
    const t = setTimeout(() => setPeekTip(null), 4000)
    return () => clearTimeout(t)
  }, [peekTip])

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
      : `${L('question')} ${Math.min(passIdx + 1, STAGE3_PROBLEMS.length)}/${STAGE3_PROBLEMS.length}`
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

        {/* Asymptotes — high-pass: rising +20 dB/dec below fc, flat 0 dB above */}
        {(() => {
          // Left endpoint of the rising asymptote at f = F_MIN
          const leftDb = 20 * Math.log10(F_MIN / plotFc)
          const clampedLeftDb = Math.max(leftDb, DB_MIN)
          // Clamp x so we don't overshoot the plot if leftDb was below DB_MIN
          let leftX = fToX(F_MIN)
          if (leftDb < DB_MIN) {
            // Find frequency at which the +20 dB/dec asymptote crosses DB_MIN
            // magDb_asym(f) = 20 log10(f/fc) = DB_MIN  →  f = fc * 10^(DB_MIN/20)
            const fAtBottom = plotFc * Math.pow(10, DB_MIN / 20)
            leftX = fToX(Math.max(fAtBottom, F_MIN))
          }
          return (
            <>
              <line
                x1={leftX} y1={dbToY(clampedLeftDb < DB_MIN ? DB_MIN : leftDb < DB_MIN ? DB_MIN : leftDb)}
                x2={fcX} y2={dbToY(0)}
                stroke="#37C9B8" strokeWidth={1.2} strokeDasharray="5 4" opacity={0.6}
              />
              <line
                x1={fcX} y1={dbToY(0)}
                x2={fToX(F_MAX)} y2={dbToY(0)}
                stroke="#37C9B8" strokeWidth={1.2} strokeDasharray="5 4" opacity={0.6}
              />
            </>
          )
        })()}

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
          {isEvaluate ? 'f_c = ?' : `f_c = ${formatHz(plotFc)}`}
        </text>
      </svg>

      <div style={hudTLStyle}>{hudTL}</div>
      <div style={{ ...hudTRStyle, color: canSubmit ? '#37C9B8' : '#B9C4D6' }}>{hudTR}</div>
      <div style={hudBLStyle}>{hudBL}</div>

      {wrongBanner && (
        <div style={wrongBannerStyle}>{L('wrong_restart')}</div>
      )}

      {peekTip && (
        <div style={peekTipStyle}>{peekTip}</div>
      )}

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

        {isEvaluate && passIdx < STAGE3_PROBLEMS.length && (
          <>
            <div style={{ fontSize: '1.8rem', color: '#B9C4D6', lineHeight: 1.5 }}>
              {L('evaluate_prompt')}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
              {choicesShuffled.map((choice) => {
                const isPicked = pick === choice
                const isCorrect = choice === currentProblem.fc
                const bg = showResult
                  ? isCorrect ? '#37C9B8' : isPicked ? '#F97316' : 'transparent'
                  : 'transparent'
                const color = showResult && (isCorrect || isPicked) ? '#0D1524' : '#EAF0FA'
                return (
                  <button
                    key={choice}
                    type="button"
                    disabled={showResult}
                    onClick={() => handlePick(choice)}
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

            <div style={{ fontSize: '1.5rem', color: '#54617A' }}>
              Q {passIdx + 1}/{STAGE3_PROBLEMS.length}
            </div>
          </>
        )}

        {isEvaluate && passIdx >= STAGE3_PROBLEMS.length && (
          <div style={{ fontSize: '1.8rem', color: '#37C9B8' }}>✓ {L('all_correct')}</div>
        )}
        </div>
      </div>
    </div>
  )
}

// ─── Sub-components ─────────────────────────────────────────────────────
// CR high-pass topology: series C on the top rail, shunt R to ground on the output side.
// Output taken across R.
function CircuitDiagram({ x0, y0, w, h, R, C, hideValues, L }: {
  x0: number; y0: number; w: number; h: number
  R: number; C: number
  hideValues: boolean
  L: (k: string) => string
}) {
  const inX = x0 + 30
  const outX = x0 + w - 30
  const topY = y0 + 50
  const botY = y0 + h - 50
  const midX = (inX + outX) / 2

  // Capacitor: vertical plates on the top rail, left half
  const capX = inX + 55
  const capPlateW = 20
  const capGap = 8
  const capLeftX = capX - capGap / 2
  const capRightX = capX + capGap / 2

  // Resistor: vertical zigzag on the output side (shunt to ground)
  const rX = outX
  const rY0 = topY + 20
  const rY1 = rY0 + 60

  return (
    <g>
      {/* Input node label */}
      <text x={inX} y={topY - 12} fill="#54617A" fontFamily="'JetBrains Mono', monospace" fontSize={10} textAnchor="middle">
        {L('v_in')}
      </text>
      <circle cx={inX} cy={topY} r={3} fill="#B9C4D6" />

      {/* Top rail: input → cap-left */}
      <line x1={inX} y1={topY} x2={capLeftX} y2={topY} stroke="#B9C4D6" strokeWidth={1.5} />

      {/* Capacitor plates (series, in top rail) */}
      <line x1={capLeftX} y1={topY - capPlateW / 2} x2={capLeftX} y2={topY + capPlateW / 2} stroke="#B9C4D6" strokeWidth={2} />
      <line x1={capRightX} y1={topY - capPlateW / 2} x2={capRightX} y2={topY + capPlateW / 2} stroke="#B9C4D6" strokeWidth={2} />
      <text x={capX} y={topY - 16} fill="#F9A968" fontFamily="'JetBrains Mono', monospace" fontSize={11} fontWeight={700} textAnchor="middle">
        C{hideValues ? '' : ` = ${formatFarad(C)}`}
      </text>

      {/* Top rail: cap-right → output node */}
      <line x1={capRightX} y1={topY} x2={outX + 20} y2={topY} stroke="#B9C4D6" strokeWidth={1.5} />

      {/* Output node */}
      <circle cx={outX + 20} cy={topY} r={3} fill="#B9C4D6" />
      <text x={outX + 30} y={topY - 4} fill="#54617A" fontFamily="'JetBrains Mono', monospace" fontSize={10}>
        {L('v_out')}
      </text>

      {/* Vertical drop from top rail to resistor top */}
      <line x1={rX} y1={topY} x2={rX} y2={rY0} stroke="#B9C4D6" strokeWidth={1.5} />

      {/* Resistor zigzag (vertical) — shunt to ground */}
      <polyline
        points={[
          [rX, rY0],
          [rX - 8, rY0 + 6],
          [rX + 8, rY0 + 18],
          [rX - 8, rY0 + 30],
          [rX + 8, rY0 + 42],
          [rX - 8, rY0 + 54],
          [rX, rY1],
        ].map((p) => p.join(',')).join(' ')}
        fill="none" stroke="#B9C4D6" strokeWidth={1.5}
      />
      <text x={rX + 12} y={(rY0 + rY1) / 2 + 3} fill="#37C9B8" fontFamily="'JetBrains Mono', monospace" fontSize={11} fontWeight={700}>
        R{hideValues ? '' : ` = ${formatOhm(R)}`}
      </text>

      {/* Resistor bottom → ground rail */}
      <line x1={rX} y1={rY1} x2={rX} y2={botY} stroke="#B9C4D6" strokeWidth={1.5} />

      {/* Input side vertical to ground rail */}
      <line x1={inX} y1={topY} x2={inX} y2={botY} stroke="#B9C4D6" strokeWidth={1.5} />

      {/* Ground rail */}
      <line x1={inX} y1={botY} x2={rX} y2={botY} stroke="#B9C4D6" strokeWidth={1.5} />

      {/* Ground symbol */}
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
const wrongBannerStyle: React.CSSProperties = {
  position: 'absolute', top: '50%', left: '50%',
  transform: 'translate(-50%, -50%)',
  padding: '1.5rem 3rem', background: '#F97316', color: '#0D1524',
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: '2.5rem', fontWeight: 700, letterSpacing: '0.08em',
  borderRadius: '0.8rem', zIndex: 20, pointerEvents: 'none',
}
const peekTipStyle: React.CSSProperties = {
  position: 'absolute', top: '9rem', left: '3rem',
  maxWidth: '55%',
  padding: '1rem 1.4rem',
  background: '#12203a', color: '#EAF0FA',
  border: '1px solid #B87CE0',
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: '1.8rem', lineHeight: 1.4,
  borderRadius: '0.5rem', zIndex: 15, pointerEvents: 'none',
}
