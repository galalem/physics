import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
const R_MIN = 1        // Ω
const R_MAX = 10000    // 10 kΩ
const L_MIN = 1e-4     // 0.1 mH
const L_MAX = 1        // 1 H
const C_MIN = 1e-9     // 1 nF
const C_MAX = 1e-5     // 10 µF

// Stage 2 target: bandwidth
const STAGE2_DF_TARGET = 200 // Hz
const STAGE2_TOL = 0.06      // ±6%

// Stage 3 problems — hardcoded (f0, Q) so the plot is deterministic
// and choices probe reading Δf off the −3 dB span on a log axis.
type Problem = { f0: number; Q: number; df: number; choices: number[] }
const STAGE3_PROBLEMS: Problem[] = [
  { f0: 500,  Q: 5,  df: 100, choices: [30, 100, 300, 1000] },
  { f0: 1000, Q: 2,  df: 500, choices: [100, 500, 1500, 5000] },
  { f0: 2000, Q: 10, df: 200, choices: [50, 200, 800, 3000] },
  { f0: 200,  Q: 4,  df: 50,  choices: [15, 50, 150, 500] },
]

// ─── Physics helpers (RLC series band-pass, output across R) ────────────
function f0From(L: number, C: number): number {
  return 1 / (2 * Math.PI * Math.sqrt(L * C))
}
function qFrom(R: number, L: number, f0: number): number {
  return (2 * Math.PI * f0 * L) / R
}
function dfFrom(R: number, L: number): number {
  return R / (2 * Math.PI * L)
}
function magDb(f: number, f0: number, Q: number): number {
  const d = Q * (f / f0 - f0 / f)
  return -10 * Math.log10(1 + d * d)
}
// Cut-off frequencies at −3 dB (Q(f/f0 − f0/f) = ±1)
function cutoffs(f0: number, Q: number): { fL: number; fH: number } {
  const root = Math.sqrt(1 / (4 * Q * Q) + 1)
  const fL = f0 * (root - 1 / (2 * Q))
  const fH = f0 * (root + 1 / (2 * Q))
  return { fL, fH }
}
// For the stage-2 target guide: given f0 and desired Δf, the f_L,f_H that
// satisfy f_L·f_H = f0² and f_H − f_L = Δf.
function targetSpan(f0: number, df: number): { fL: number; fH: number } {
  const fL = (Math.sqrt(4 * f0 * f0 + df * df) - df) / 2
  return { fL, fH: fL + df }
}

// ─── Axis mapping ───────────────────────────────────────────────────────
function fToX(f: number): number {
  const t = (Math.log10(f) - LOG_F_MIN) / (LOG_F_MAX - LOG_F_MIN)
  return BODE_X0 + t * BODE_W
}
function dbToY(db: number): number {
  const t = (db - DB_MIN) / (DB_MAX - DB_MIN)
  return BODE_Y1 - t * BODE_H
}

function bodePath(f0: number, Q: number, samples = 240): string {
  let d = ''
  for (let i = 0; i <= samples; i++) {
    const t = i / samples
    const f = Math.pow(10, LOG_F_MIN + t * (LOG_F_MAX - LOG_F_MIN))
    const y = dbToY(magDb(f, f0, Q))
    d += (i === 0 ? 'M ' : 'L ') + `${fToX(f).toFixed(2)} ${y.toFixed(2)} `
  }
  return d
}

// ─── Format helpers ─────────────────────────────────────────────────────
function formatHz(f: number): string {
  if (f >= 1000) return `${(f / 1000).toFixed(f >= 10000 ? 0 : 1)} kHz`
  return `${f.toFixed(0)} Hz`
}
function formatOhm(r: number): string {
  if (r >= 1000) return `${(r / 1000).toFixed(r >= 10000 ? 0 : 2)} kΩ`
  return `${r.toFixed(0)} Ω`
}
function formatHenry(l: number): string {
  if (l >= 1) return `${l.toFixed(2)} H`
  if (l >= 1e-3) return `${(l * 1e3).toFixed(l >= 1e-2 ? 0 : 1)} mH`
  return `${(l * 1e6).toFixed(0)} µH`
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

  // Component state (log-scale sliders)
  const [logR, setLogR] = useState<number>(Math.log10(100))    // 100 Ω
  const [logL, setLogL] = useState<number>(Math.log10(100e-3)) // 100 mH
  const [logC, setLogC] = useState<number>(Math.log10(1e-6))   // 1 µF

  const R = Math.pow(10, logR)
  const Lval = Math.pow(10, logL)
  const Cval = Math.pow(10, logC)
  const f0 = f0From(Lval, Cval)
  const Q = qFrom(R, Lval, f0)
  const df = dfFrom(R, Lval)

  const [dfSeen, setDfSeen] = useState<Set<string>>(new Set())

  // Stage 1 progress: bucket by log10(Δf)*3 (~1/3 decade)
  useEffect(() => {
    if (!isObserve) return
    const bucket = Math.round(Math.log10(df) * 3)
    setDfSeen((prev) => {
      const key = String(bucket)
      if (prev.has(key)) return prev
      const next = new Set(prev)
      next.add(key)
      return next
    })
  }, [isObserve, df])

  // Stage 3 — ace-the-deck
  const [deckOrder, setDeckOrder] = useState<number[]>(() =>
    rootRng.shuffle(STAGE3_PROBLEMS.map((_, i) => i)),
  )
  const [passIdx, setPassIdx] = useState(0)
  const [pick, setPick] = useState<number | null>(null)
  const [showResult, setShowResult] = useState(false)
  const [wrongBanner, setWrongBanner] = useState(false)

  const currentProblem = STAGE3_PROBLEMS[deckOrder[passIdx] ?? deckOrder[0]!]!
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
    if (choice === currentProblem.df) {
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
  const observeDone = dfSeen.size >= 3
  const experimentDone = Math.abs(df - STAGE2_DF_TARGET) / STAGE2_DF_TARGET < STAGE2_TOL
  const evaluateDone = passIdx >= STAGE3_PROBLEMS.length && !showResult
  const canSubmit = isObserve ? observeDone : isExperiment ? experimentDone : evaluateDone

  const resetForStage = useCallback(() => {
    setLogR(Math.log10(100))
    setLogL(Math.log10(100e-3))
    setLogC(Math.log10(1e-6))
    setDfSeen(new Set())
    setPassIdx(0)
    setPick(null)
    setShowResult(false)
    setWrongBanner(false)
    setDeckOrder(rootRng.fork().shuffle(STAGE3_PROBLEMS.map((_, i) => i)))
  }, [rootRng])

  useReset(() => resetForStage())

  useEffect(() => {
    progress(stageIdx / 3, { stage: stageIdx, canSubmit })
  }, [stageIdx, canSubmit, progress])

  useNext(() => {
    if (stageIdx < 3) {
      const next = stageIdx + 1
      setStage(next)
      resetForStage()
    } else {
      complete({ success: true })
    }
  })

  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  // Peek — stage 3 method tips, rotate through 3, auto-dismiss 4 s
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

  // Which (f0, Q) drives the plot
  const plotF0 = isEvaluate ? currentProblem.f0 : f0
  const plotQ = isEvaluate ? currentProblem.Q : Q
  const { fL: plotFL, fH: plotFH } = cutoffs(plotF0, plotQ)
  const plotDf = plotFH - plotFL

  // Stage-2 target span (drawn as a fixed-width orange bracket centered at current f0)
  const targetGuide = isExperiment ? targetSpan(f0, STAGE2_DF_TARGET) : null

  // HUD
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${L('stage')} 0${stageIdx} · ${stageName}`
  const hudTR = isObserve
    ? `${L('regions')}: ${dfSeen.size}/3`
    : isExperiment
      ? experimentDone
        ? `${L('matched')} ✓`
        : `${L('target')}: Δf = ${STAGE2_DF_TARGET} Hz`
      : `${L('question')} ${Math.min(passIdx + 1, STAGE3_PROBLEMS.length)}/${STAGE3_PROBLEMS.length}`
  const hudBL = isObserve ? L('tip1') : isExperiment ? L('tip2') : L('tip3')

  // Bode markers
  const fLX = fToX(plotFL)
  const fHX = fToX(plotFH)
  const f0X = fToX(plotF0)
  const y3 = dbToY(-3)
  const y0line = dbToY(0)

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
          R={R} Lval={Lval} Cval={Cval}
          hideValues={isEvaluate}
          L={L}
        />

        {/* Bode plot frame */}
        <rect x={BODE_X0} y={BODE_Y0} width={BODE_W} height={BODE_H} fill="none" stroke="#12203a" strokeWidth={1} rx={6} />
        <text x={BODE_X0 + 8} y={BODE_Y0 - 10} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={11} letterSpacing="0.1em">
          {L('bode_title')}
        </text>

        {/* Axis labels */}
        <text x={BODE_X0 - 6} y={BODE_Y0 - 2} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={10} textAnchor="end">
          |H| (dB)
        </text>
        <text x={BODE_X1 - 4} y={BODE_Y1 + 12} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={10} textAnchor="end">
          f (Hz)
        </text>

        {/* Y gridlines */}
        {[10, 0, -10, -20, -30, -40, -50, -60].map((db) => {
          const y = dbToY(db)
          return (
            <g key={db}>
              <line
                x1={BODE_X0} y1={y} x2={BODE_X1} y2={y}
                stroke="#12203a" strokeWidth={1}
                strokeDasharray={db === 0 ? undefined : '2 4'}
                opacity={db === 0 ? 0.9 : 0.7}
              />
              <text x={BODE_X0 - 4} y={y + 3} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={9} textAnchor="end">
                {db}
              </text>
            </g>
          )
        })}

        {/* X gridlines: major decades */}
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

        {/* −3 dB reference line */}
        <line x1={BODE_X0} y1={y3} x2={BODE_X1} y2={y3} stroke="#F9A968" strokeWidth={1} strokeDasharray="4 3" opacity={0.45} />
        <text x={BODE_X0 + 4} y={y3 - 3} fill="#F9A968" fontFamily="'JetBrains Mono', monospace" fontSize={9} opacity={0.7}>
          −3 dB
        </text>

        {/* 0 dB reference tint (peak level) */}
        <line x1={BODE_X0} y1={y0line} x2={BODE_X1} y2={y0line} stroke="#37C9B8" strokeWidth={0.8} opacity={0.35} />

        {/* Stage 2 target span at −3 dB level: fixed width matching target Δf,
            centered at current f_0 so the student iterates until current width matches. */}
        {targetGuide && (() => {
          const tLX = fToX(targetGuide.fL)
          const tHX = fToX(targetGuide.fH)
          const yTgt = y3 - 12
          return (
            <g opacity={0.85}>
              <line x1={tLX} y1={yTgt - 4} x2={tLX} y2={yTgt + 4} stroke="#F9A968" strokeWidth={1.4} />
              <line x1={tHX} y1={yTgt - 4} x2={tHX} y2={yTgt + 4} stroke="#F9A968" strokeWidth={1.4} />
              <line x1={tLX} y1={yTgt} x2={tHX} y2={yTgt} stroke="#F9A968" strokeWidth={1.4} strokeDasharray="4 3" />
              <text x={(tLX + tHX) / 2} y={yTgt - 6} fill="#F9A968" fontFamily="'JetBrains Mono', monospace" fontSize={10} textAnchor="middle">
                {L('target_df')} = {STAGE2_DF_TARGET} Hz
              </text>
            </g>
          )
        })()}

        {/* Bode curve */}
        <path d={bodePath(plotF0, plotQ)} fill="none" stroke="#F9A968" strokeWidth={2.5} strokeLinejoin="round" />

        {/* f_0 marker (small cyan tick at peak) */}
        <line x1={f0X} y1={y0line} x2={f0X} y2={y0line + 6} stroke="#37C9B8" strokeWidth={1.4} />
        <circle cx={f0X} cy={y0line} r={3.5} fill="#37C9B8" stroke="#0D1524" strokeWidth={1.2} />

        {/* Purple markers at f_L and f_H (both at −3 dB) */}
        <line x1={fLX} y1={BODE_Y0} x2={fLX} y2={BODE_Y1} stroke="#B87CE0" strokeWidth={1} strokeDasharray="3 3" opacity={0.7} />
        <line x1={fHX} y1={BODE_Y0} x2={fHX} y2={BODE_Y1} stroke="#B87CE0" strokeWidth={1} strokeDasharray="3 3" opacity={0.7} />
        <circle cx={fLX} cy={y3} r={5} fill="#B87CE0" stroke="#0D1524" strokeWidth={1.5} />
        <circle cx={fHX} cy={y3} r={5} fill="#B87CE0" stroke="#0D1524" strokeWidth={1.5} />

        {/* Δf horizontal bracket connecting f_L and f_H at −3 dB */}
        <line x1={fLX} y1={y3 + 14} x2={fHX} y2={y3 + 14} stroke="#B87CE0" strokeWidth={1.4} />
        <line x1={fLX} y1={y3 + 10} x2={fLX} y2={y3 + 18} stroke="#B87CE0" strokeWidth={1.4} />
        <line x1={fHX} y1={y3 + 10} x2={fHX} y2={y3 + 18} stroke="#B87CE0" strokeWidth={1.4} />

        {/* f_L / f_H / Δf labels — hidden as "?" in stage 3 */}
        <text
          x={Math.max(fLX - 4, BODE_X0 + 4)}
          y={y3 - 8}
          fill="#B87CE0" fontFamily="'JetBrains Mono', monospace" fontSize={10} fontWeight={700}
          textAnchor="end"
        >
          {L('fL_label')} = {isEvaluate ? '?' : formatHz(plotFL)}
        </text>
        <text
          x={Math.min(fHX + 4, BODE_X1 - 4)}
          y={y3 - 8}
          fill="#B87CE0" fontFamily="'JetBrains Mono', monospace" fontSize={10} fontWeight={700}
        >
          {L('fH_label')} = {isEvaluate ? '?' : formatHz(plotFH)}
        </text>
        <text
          x={(fLX + fHX) / 2}
          y={y3 + 28}
          fill="#B87CE0" fontFamily="'JetBrains Mono', monospace" fontSize={11} fontWeight={700}
          textAnchor="middle"
        >
          {L('df_label')} = {isEvaluate ? '?' : formatHz(plotDf)}
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

              <FieldGroup label={`${L('field_L')}: ${formatHenry(Lval)}`}>
                <NumberSlider
                  min={Math.log10(L_MIN)} max={Math.log10(L_MAX)}
                  step={0.05}
                  value={logL}
                  onChange={setLogL}
                />
              </FieldGroup>

              <FieldGroup label={`${L('field_C')}: ${formatFarad(Cval)}`}>
                <NumberSlider
                  min={Math.log10(C_MIN)} max={Math.log10(C_MAX)}
                  step={0.05}
                  value={logC}
                  onChange={setLogC}
                />
              </FieldGroup>

              <div style={statusBoxStyle}>
                <div style={statusLabelStyle}>{L('field_derived')}</div>
                <div style={{ fontSize: '1.7rem', color: '#B9C4D6' }}>
                  {L('f0_label')} = <span style={{ color: '#37C9B8', fontWeight: 700 }}>{formatHz(f0)}</span>
                </div>
                <div style={{ fontSize: '1.7rem', color: '#B9C4D6' }}>
                  {L('q_label')} = <span style={{ color: '#B9C4D6', fontWeight: 700 }}>{Q.toFixed(2)}</span>
                </div>
                <div style={{ fontSize: '1.7rem', color: '#B9C4D6' }}>
                  {L('df_label')} = <span style={{ color: '#B87CE0', fontWeight: 700 }}>{formatHz(df)}</span>
                </div>
                {isExperiment && experimentDone && (
                  <div style={{ fontSize: '1.5rem', color: '#37C9B8', marginTop: '0.3rem' }}>
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
                  const isCorrect = choice === currentProblem.df
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
function CircuitDiagram({ x0, y0, w, h, R, Lval, Cval, hideValues, L }: {
  x0: number; y0: number; w: number; h: number
  R: number; Lval: number; Cval: number
  hideValues: boolean
  L: (k: string) => string
}) {
  const inX = x0 + 20
  const topY = y0 + 60
  const botY = y0 + h - 50
  const nodeX = x0 + w - 30

  // Layout on the top rail: L then C in series, from inX → nodeX
  const lX0 = inX + 20
  const lX1 = lX0 + 45
  const cX0 = lX1 + 15
  const cPlate1 = cX0 + 8
  const cPlate2 = cX0 + 16

  return (
    <g>
      {/* Input node label */}
      <text x={inX} y={topY - 12} fill="#54617A" fontFamily="'JetBrains Mono', monospace" fontSize={10} textAnchor="middle">
        {L('v_in')}
      </text>
      <circle cx={inX} cy={topY} r={3} fill="#B9C4D6" />

      {/* Top rail: in → L (coil) → C (plates) → node */}
      <line x1={inX} y1={topY} x2={lX0} y2={topY} stroke="#B9C4D6" strokeWidth={1.5} />
      {/* Inductor: 4 semicircle humps */}
      {[0, 1, 2, 3].map((i) => {
        const cx = lX0 + 5.5 + i * 11
        return (
          <path
            key={i}
            d={`M ${cx - 5.5} ${topY} A 5.5 5.5 0 0 1 ${cx + 5.5} ${topY}`}
            fill="none" stroke="#B9C4D6" strokeWidth={1.5}
          />
        )
      })}
      <text x={(lX0 + lX1) / 2} y={topY - 12} fill="#37C9B8" fontFamily="'JetBrains Mono', monospace" fontSize={11} fontWeight={700} textAnchor="middle">
        L{hideValues ? '' : ` = ${formatHenry(Lval)}`}
      </text>

      <line x1={lX1} y1={topY} x2={cX0} y2={topY} stroke="#B9C4D6" strokeWidth={1.5} />
      {/* Capacitor plates */}
      <line x1={cPlate1} y1={topY - 8} x2={cPlate1} y2={topY + 8} stroke="#B9C4D6" strokeWidth={2} />
      <line x1={cPlate2} y1={topY - 8} x2={cPlate2} y2={topY + 8} stroke="#B9C4D6" strokeWidth={2} />
      <text x={(cPlate1 + cPlate2) / 2} y={topY - 12} fill="#F9A968" fontFamily="'JetBrains Mono', monospace" fontSize={11} fontWeight={700} textAnchor="middle">
        C{hideValues ? '' : ` = ${formatFarad(Cval)}`}
      </text>
      <line x1={cPlate2} y1={topY} x2={nodeX} y2={topY} stroke="#B9C4D6" strokeWidth={1.5} />

      {/* Vertical resistor from node down to bottom rail */}
      <circle cx={nodeX} cy={topY} r={3} fill="#B9C4D6" />
      <line x1={nodeX} y1={topY} x2={nodeX} y2={topY + 12} stroke="#B9C4D6" strokeWidth={1.5} />
      {/* Resistor zigzag vertically from topY+12 to botY-4 */}
      {(() => {
        const y0z = topY + 12
        const y1z = botY - 4
        const steps = 6
        const dy = (y1z - y0z) / steps
        const pts: [number, number][] = [[nodeX, y0z]]
        for (let i = 0; i < steps; i++) {
          const yStep = y0z + (i + 0.5) * dy
          const xOff = i % 2 === 0 ? -6 : 6
          pts.push([nodeX + xOff, yStep])
        }
        pts.push([nodeX, y1z])
        return (
          <polyline
            points={pts.map((p) => p.join(',')).join(' ')}
            fill="none" stroke="#B9C4D6" strokeWidth={1.5}
          />
        )
      })()}
      <text x={nodeX + 14} y={(topY + botY) / 2} fill="#B87CE0" fontFamily="'JetBrains Mono', monospace" fontSize={11} fontWeight={700}>
        R{hideValues ? '' : ` = ${formatOhm(R)}`}
      </text>
      <line x1={nodeX} y1={botY - 4} x2={nodeX} y2={botY} stroke="#B9C4D6" strokeWidth={1.5} />

      {/* u_out label — across R, right side */}
      <text x={nodeX + 14} y={topY + 4} fill="#54617A" fontFamily="'JetBrains Mono', monospace" fontSize={10}>
        {L('v_out')}
      </text>

      {/* Bottom rail: in − ground → resistor bottom */}
      <line x1={inX} y1={topY} x2={inX} y2={botY} stroke="#B9C4D6" strokeWidth={1.5} />
      <line x1={inX} y1={botY} x2={nodeX} y2={botY} stroke="#B9C4D6" strokeWidth={1.5} />

      {/* Ground symbol at rail midpoint */}
      {(() => {
        const midX = (inX + nodeX) / 2
        return (
          <g>
            <line x1={midX} y1={botY} x2={midX} y2={botY + 10} stroke="#B9C4D6" strokeWidth={1.5} />
            <line x1={midX - 12} y1={botY + 10} x2={midX + 12} y2={botY + 10} stroke="#B9C4D6" strokeWidth={2} />
            <line x1={midX - 8} y1={botY + 14} x2={midX + 8} y2={botY + 14} stroke="#B9C4D6" strokeWidth={1.5} />
            <line x1={midX - 4} y1={botY + 18} x2={midX + 4} y2={botY + 18} stroke="#B9C4D6" strokeWidth={1.5} />
          </g>
        )
      })()}
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
      <div style={{ fontSize: '1.4rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: '#54617A' }}>{label}</div>
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
  padding: '2.2rem',
  display: 'flex', flexDirection: 'column', gap: '2rem',
  fontSize: '2rem',
  overflow: 'auto',
}
const statusBoxStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: '0.5rem',
  padding: '0.9rem 1.1rem',
  border: '1px solid #12203a', borderRadius: '0.6rem',
}
const statusLabelStyle: React.CSSProperties = {
  fontSize: '1.4rem', color: '#54617A',
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
  padding: '1.5rem 3rem',
  background: '#F97316', color: '#0D1524',
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: '2.5rem', fontWeight: 700, letterSpacing: '0.08em',
  borderRadius: '0.8rem', zIndex: 20, pointerEvents: 'none',
}
const peekTipStyle: React.CSSProperties = {
  position: 'absolute', bottom: '9rem', left: '3rem',
  padding: '1.2rem 1.6rem',
  maxWidth: '55%',
  background: 'rgba(184, 124, 224, 0.14)',
  border: '1px solid #B87CE0',
  color: '#EAF0FA',
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: '1.8rem', lineHeight: 1.4,
  borderRadius: '0.6rem', zIndex: 8, pointerEvents: 'none',
}
