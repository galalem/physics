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
} from '@physics/sdk/react'
import { getHintFor, getStagesFor } from './stages'
import en from '../i18n/en.json'

// ─── Canvas ─────────────────────────────────────────────────────────────
const W = 800
const H = 450

// ─── Physics ────────────────────────────────────────────────────────────
// FM signal: s(t) = cos(2π f_p t + β · sin(2π f_m t)), β = Δf / f_m
// Spectrum: bars at f_p + n·f_m for n = -4..4, amplitude = |J_n(β)|
// f in kHz, t in ms → 2π f t is unit-consistent.
const FP_FIXED = 10 // kHz, carrier frequency (fixed for this exercise)

function sFM(t: number, fm: number, fp: number, beta: number): number {
  return Math.cos(2 * Math.PI * fp * t + beta * Math.sin(2 * Math.PI * fm * t))
}

// ─── Bessel LUT ─────────────────────────────────────────────────────────
// BESSEL_LUT[n][k] = J_n(k * 0.5), for k = 0..10 (β = 0..5 step 0.5).
// Values from standard tables; magnitude is used for rendering.
const BESSEL_LUT: number[][] = [
  // J0
  [1.0000,  0.9385,  0.7652,  0.5118,  0.2239, -0.0484, -0.2601, -0.3801, -0.3971, -0.3205, -0.1776],
  // J1
  [0.0000,  0.2423,  0.4401,  0.5579,  0.5767,  0.4971,  0.3391,  0.1374, -0.0660, -0.2311, -0.3276],
  // J2
  [0.0000,  0.0306,  0.1149,  0.2321,  0.3528,  0.4461,  0.4861,  0.4586,  0.3641,  0.2178,  0.0466],
  // J3
  [0.0000,  0.0026,  0.0196,  0.0610,  0.1289,  0.2166,  0.3091,  0.3868,  0.4302,  0.4247,  0.3648],
  // J4
  [0.0000,  0.0002,  0.0025,  0.0118,  0.0340,  0.0738,  0.1320,  0.2043,  0.2811,  0.3484,  0.3912],
]

function besselMag(n: number, beta: number): number {
  const idxN = Math.abs(n)
  if (idxN >= BESSEL_LUT.length) return 0
  const clamped = Math.max(0, Math.min(5, beta))
  const k = clamped / 0.5
  const lo = Math.min(9, Math.floor(k))
  const hi = lo + 1
  const t = k - lo
  const row = BESSEL_LUT[idxN]!
  return Math.abs(row[lo]! * (1 - t) + row[hi]! * t)
}

// ─── Ranges ────────────────────────────────────────────────────────────
const FM_MIN = 0.5, FM_MAX = 3, FM_STEP = 0.1     // kHz
const DF_MIN = 0.5, DF_MAX = 8, DF_STEP = 0.25    // kHz

// ─── Targets ──────────────────────────────────────────────────────────
type Params = { fm: number; df: number }
const STAGE2_TARGETS: Params[] = [
  { fm: 2.0, df: 1.0 },  // β = 0.5 (narrow)
  { fm: 1.5, df: 3.0 },  // β = 2.0 (moderate)
  { fm: 1.0, df: 5.0 },  // β = 5.0 (wide)
]
const STAGE3_TARGETS: Params[] = [
  { fm: 2.5, df: 1.25 }, // β = 0.5 (narrow-band, few sidebands, spacing 2.5 kHz)
  { fm: 1.5, df: 3.0 },  // β = 2.0 (moderate, spacing 1.5 kHz)
  { fm: 1.0, df: 4.0 },  // β = 4.0 (wide, spacing 1.0 kHz, many sidebands)
]

const FREQ_TOL_PCT = 0.05

function matches(p: Params, target: Params): boolean {
  return (
    Math.abs(p.fm - target.fm) / target.fm <= FREQ_TOL_PCT &&
    Math.abs(p.df - target.df) / target.df <= FREQ_TOL_PCT
  )
}
function withinPct(user: number, exact: number): boolean {
  return Math.abs(user - exact) / exact <= FREQ_TOL_PCT
}
function q3IsCorrect(a: Params, t: Params): boolean {
  return withinPct(a.fm, t.fm) && withinPct(a.df, t.df)
}

// ─── Time window ───────────────────────────────────────────────────────
const T_WINDOW_MS = 4
const SAMPLES = 600

// ─── Spectrum axis ─────────────────────────────────────────────────────
// f_p fixed at 10 kHz; sidebands at f_p ± n·f_m for n = 1..4.
// Max |n|·f_m = 4·3 = 12 kHz → sidebands span [-2, 22] kHz.
// Clip axis to [0, 22] kHz; anything below 0 is clipped (rare, only at
// wide n·f_m combinations, and those bars have tiny |J_n|).
const F_LO = 0
const F_HI = 22
const BESSEL_N_MAX = 4
const SIGNIFICANT_THRESHOLD = 0.05

// ─── Colors ─────────────────────────────────────────────────────────────
const SIGNAL_COLOR = '#37C9B8'
const CARRIER_COLOR = '#B87CE0'
const SIDEBAND_COLOR = '#F9A968'
const TARGET_COLOR = '#8AA0BF'
const CARSON_COLOR = '#B87CE0'
const OK_COLOR = '#37C9B8'
const BAD_COLOR = '#F97316'
const WITNESS_COLOR = '#F9A968'

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

  const stageIdx = useCurrentStage()
  const isObserve = stageIdx === 1
  const isExperiment = stageIdx === 2
  const isEvaluate = stageIdx === 3

  const [fm, setFm] = useState(1.5)
  const [df, setDf] = useState(2.0)
  const beta = df / fm

  const [touchedFm, setTouchedFm] = useState(false)
  const [touchedDf, setTouchedDf] = useState(false)
  const [sawNarrow, setSawNarrow] = useState(false)
  const [sawWide, setSawWide] = useState(false)

  const [q2Idx, setQ2Idx] = useState(0)
  const [q2Solved, setQ2Solved] = useState<boolean[]>(() => STAGE2_TARGETS.map(() => false))

  const [q3Idx, setQ3Idx] = useState(0)
  const [q3Fm, setQ3Fm] = useState('')
  const [q3Df, setQ3Df] = useState('')
  const [q3Answers, setQ3Answers] = useState<(Params | null)[]>(() => STAGE3_TARGETS.map(() => null))
  const [q3HasWrong, setQ3HasWrong] = useState(false)

  const [peekTip, setPeekTip] = useState<string | null>(null)
  const peekIdxRef = useRef(0)
  const peekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const setStage = useSetStage()
  const progress = useProgress()
  const complete = useComplete()

  const updateWrinkles = (nextFm: number, nextDf: number) => {
    const b = nextDf / nextFm
    if (b < 0.3) setSawNarrow(true)
    if (b > 2) setSawWide(true)
  }

  const onFm = (v: number) => { setFm(v); setTouchedFm(true); updateWrinkles(v, df) }
  const onDf = (v: number) => { setDf(v); setTouchedDf(true); updateWrinkles(fm, v) }

  useEffect(() => {
    if (!isExperiment) return
    const target = STAGE2_TARGETS[q2Idx]!
    if (matches({ fm, df }, target) && !q2Solved[q2Idx]) {
      setQ2Solved((prev) => {
        const next = [...prev]
        next[q2Idx] = true
        return next
      })
    }
  }, [fm, df, q2Idx, q2Solved, isExperiment])

  const observeDone = touchedFm && touchedDf && sawNarrow && sawWide
  const experimentDone = q2Solved.every(Boolean)
  const evaluateDone = q3Answers.every((a, i) => a !== null && q3IsCorrect(a, STAGE3_TARGETS[i]!))
  const canSubmit = isObserve ? observeDone : isExperiment ? experimentDone : evaluateDone

  const resetForStage = useCallback(() => {
    setFm(1.5); setDf(2.0)
    setTouchedFm(false); setTouchedDf(false)
    setSawNarrow(false); setSawWide(false)
    setQ2Idx(0); setQ2Solved(STAGE2_TARGETS.map(() => false))
    setQ3Idx(0); setQ3Fm(''); setQ3Df('')
    setQ3Answers(STAGE3_TARGETS.map(() => null))
    setQ3HasWrong(false)
    setPeekTip(null)
    peekIdxRef.current = 0
    if (peekTimerRef.current) {
      clearTimeout(peekTimerRef.current)
      peekTimerRef.current = null
    }
  }, [])

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

  usePeek(() => {
    if (!isEvaluate) return
    // §4.7 rule 4: text-only strategy hint, waveform stays hidden.
    const tips = [L('peek_tip_1'), L('peek_tip_2')]
    setPeekTip(tips[peekIdxRef.current % tips.length]!)
    peekIdxRef.current += 1
    if (peekTimerRef.current) clearTimeout(peekTimerRef.current)
    peekTimerRef.current = setTimeout(() => {
      setPeekTip(null)
      peekTimerRef.current = null
    }, 2000)
  })

  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  const submitQ3 = () => {
    const vfm = parseFloat(q3Fm)
    const vdf = parseFloat(q3Df)
    if (Number.isNaN(vfm) || Number.isNaN(vdf)) return
    const answer: Params = { fm: vfm, df: vdf }
    setQ3Answers((prev) => {
      const next = [...prev]
      next[q3Idx] = answer
      return next
    })
    if (!q3IsCorrect(answer, STAGE3_TARGETS[q3Idx]!)) setQ3HasWrong(true)
  }

  const goNextQ3 = () => {
    if (q3Idx < STAGE3_TARGETS.length - 1) {
      setQ3Idx((n) => n + 1)
      setQ3Fm(''); setQ3Df('')
    }
  }
  const goNextQ2 = () => {
    if (q2Idx < STAGE2_TARGETS.length - 1) setQ2Idx((n) => n + 1)
  }
  const tryAgain = () => resetForStage()

  const currentTarget: Params | null = isExperiment
    ? STAGE2_TARGETS[q2Idx]!
    : isEvaluate ? STAGE3_TARGETS[q3Idx]! : null
  const q3Answer = isEvaluate ? q3Answers[q3Idx] ?? null : null
  const q3AllSubmitted = q3Answers.every((a) => a !== null)

  const stageName = stages[stageIdx - 1]?.name ?? ''
  const q3SolvedCount = q3Answers.filter((a, i) => a !== null && q3IsCorrect(a, STAGE3_TARGETS[i]!)).length
  const hudTL = `${L('stage')} 0${stageIdx} · ${stageName}`
  const hudTR = isObserve
    ? `${L('sliders')}: ${[touchedFm, touchedDf].filter(Boolean).length}/2  ·  ${sawNarrow ? '✓' : '○'} β<0.3  ·  ${sawWide ? '✓' : '○'} β>2`
    : isExperiment
      ? `${L('target')} ${q2Idx + 1}/${STAGE2_TARGETS.length}  ·  ${q2Solved.filter(Boolean).length}/${STAGE2_TARGETS.length} ${L('matched')}`
      : `${L('question')} ${q3Idx + 1}/${STAGE3_TARGETS.length}  ·  ${q3SolvedCount}/${STAGE3_TARGETS.length} ${L('solved')}`
  const hudBL = peekTip ?? (isObserve ? L('tip1') : isExperiment ? L('tip2') : L('tip3'))

  // Scene box on the left (plots inside); title sits outside above the box.
  const SCENE_X = 40, SCENE_Y = 60, SCENE_W = 530, SCENE_H = 340
  const PLOT_X = 52
  const PLOT_W = 506
  const TIME_Y = 90
  const TIME_H = 140
  const SPEC_Y = 250
  const SPEC_H = 140

  // §4.7: waveform stays hidden on evaluate — no peek reveal.
  const timeDomainVisible = !isEvaluate

  // Spectrum uses TARGET params on evaluate (never the typed guesses).
  const specFm = isEvaluate && currentTarget ? currentTarget.fm : fm
  const specDf = isEvaluate && currentTarget ? currentTarget.df : df
  const specBeta = specDf / specFm

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

        <TimePlot
          x={PLOT_X} y={TIME_Y} w={PLOT_W} h={TIME_H}
          visible={timeDomainVisible}
          hiddenLabel={L('hidden_label')}
          liveFm={fm} liveDf={df}
          targetParams={isExperiment ? currentTarget : null}
          L={L}
        />

        <SpectrumPlot
          x={PLOT_X} y={SPEC_Y} w={PLOT_W} h={SPEC_H}
          fm={specFm} beta={specBeta} fp={FP_FIXED}
          targetParams={isExperiment ? currentTarget : null}
          showCarson={isExperiment}
          showValues={isEvaluate}
          L={L}
        />
      </svg>

      <div style={hudTLStyle}>{hudTL}</div>
      <div style={{ ...hudTRStyle, color: canSubmit ? '#37C9B8' : '#B9C4D6' }}>{hudTR}</div>
      <div style={hudBLStyle}>{hudBL}</div>
      {/* BR reserved for parent chrome — do not render anything here. */}

      <div style={rightPanelWrapperStyle}>
        <div style={rightPanelTitleStyle}>{L('controls_title')}</div>
        <div style={rightPanelBoxStyle}>

          {(isObserve || isExperiment) && (
            <>
              {isExperiment && currentTarget && (
                <div style={targetBoxStyle}>
                  <div style={statusLabelStyle}>{L('target')}</div>
                  <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', color: TARGET_COLOR, fontWeight: 700, fontSize: '1.8rem' }}>
                    <span>f_m = {currentTarget.fm.toFixed(1)}</span>
                    <span>Δf = {currentTarget.df.toFixed(2)}</span>
                    <span>β = {(currentTarget.df / currentTarget.fm).toFixed(2)}</span>
                  </div>
                  {q2Solved[q2Idx] && (
                    <div style={{ color: OK_COLOR, fontSize: '1.6rem', marginTop: '0.4rem' }}>
                      ✓ {L('matched_msg')}
                    </div>
                  )}
                </div>
              )}

              <FieldGroup label={`${L('field_fm')}: ${fm.toFixed(1)} kHz`}>
                <NumberSlider min={FM_MIN} max={FM_MAX} step={FM_STEP} value={fm} onChange={onFm} accent={SIDEBAND_COLOR} />
              </FieldGroup>

              <FieldGroup label={`${L('field_df')}: ${df.toFixed(2)} kHz`}>
                <NumberSlider min={DF_MIN} max={DF_MAX} step={DF_STEP} value={df} onChange={onDf} accent={SIGNAL_COLOR} />
              </FieldGroup>

              <div style={{ fontSize: '1.6rem', color: '#B9C4D6' }}>
                {L('field_fp')}: {FP_FIXED.toFixed(1)} kHz
                <span style={{ color: '#54617A', marginLeft: '1rem' }}>·</span>
                <span style={{ marginLeft: '1rem' }}>{L('field_beta')}: {beta.toFixed(2)}</span>
              </div>

              {isObserve && beta < 0.3 && (
                <div style={{ ...statusBoxStyle, borderColor: WITNESS_COLOR }}>
                  <div style={{ ...statusLabelStyle, color: WITNESS_COLOR }}>{L('narrowband_title')}</div>
                  <div style={{ fontSize: '1.6rem', color: '#B9C4D6', lineHeight: 1.4 }}>{L('narrowband_desc')}</div>
                </div>
              )}
              {isObserve && beta > 2 && (
                <div style={{ ...statusBoxStyle, borderColor: WITNESS_COLOR }}>
                  <div style={{ ...statusLabelStyle, color: WITNESS_COLOR }}>{L('wideband_title')}</div>
                  <div style={{ fontSize: '1.6rem', color: '#B9C4D6', lineHeight: 1.4 }}>{L('wideband_desc')}</div>
                </div>
              )}

              {isExperiment && q2Solved[q2Idx] && q2Idx < STAGE2_TARGETS.length - 1 && (
                <button type="button" onClick={goNextQ2} style={nextBtnStyle}>
                  {L('next_q')} →
                </button>
              )}
            </>
          )}

          {isEvaluate && currentTarget && (
            <>
              <div style={{ fontSize: '1.8rem', color: '#B9C4D6', lineHeight: 1.4 }}>
                {L('problem_prompt')}
              </div>

              <div style={{ fontSize: '1.5rem', color: '#54617A' }}>
                {L('field_fp')}: {FP_FIXED.toFixed(1)} kHz
              </div>

              <FieldGroup label={`${L('field_fm')} (kHz)`}>
                <input
                  type="number" value={q3Fm} step="0.1"
                  disabled={q3Answer !== null}
                  onChange={(e) => setQ3Fm(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') submitQ3() }}
                  placeholder="? kHz"
                  style={inputStyle}
                />
              </FieldGroup>

              <FieldGroup label={`${L('field_df')} (kHz)`}>
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  <input
                    type="number" value={q3Df} step="0.05"
                    disabled={q3Answer !== null}
                    onChange={(e) => setQ3Df(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') submitQ3() }}
                    placeholder="? kHz"
                    style={{ ...inputStyle, flex: 1 }}
                  />
                  <button
                    type="button"
                    onClick={submitQ3}
                    disabled={q3Answer !== null || q3Fm === '' || q3Df === ''}
                    style={{
                      ...submitBtnStyle,
                      opacity: q3Answer !== null || q3Fm === '' || q3Df === '' ? 0.45 : 1,
                      cursor: q3Answer !== null || q3Fm === '' || q3Df === '' ? 'not-allowed' : 'pointer',
                    }}
                  >✓</button>
                </div>
              </FieldGroup>

              {q3Answer && (() => {
                const t = currentTarget
                const allOk = q3IsCorrect(q3Answer, t)
                return (
                  <div style={{
                    padding: '1rem 1.2rem',
                    border: `1px solid ${allOk ? OK_COLOR : BAD_COLOR}`,
                    borderRadius: '0.5rem',
                    background: allOk ? 'rgba(55,201,184,0.08)' : 'rgba(249,115,22,0.08)',
                    color: allOk ? OK_COLOR : BAD_COLOR,
                    fontSize: '1.7rem',
                    display: 'flex', flexDirection: 'column', gap: '0.4rem',
                  }}>
                    <div style={{ fontWeight: 700 }}>
                      {allOk ? `✓ ${L('correct')}` : `✗ ${L('exact_was')}`}
                    </div>
                    <div style={{ color: '#B9C4D6', fontSize: '1.5rem' }}>
                      f_m = {t.fm.toFixed(2)} · Δf = {t.df.toFixed(2)} · β = {(t.df / t.fm).toFixed(2)}
                    </div>
                  </div>
                )
              })()}

              {q3Answer && q3Idx < STAGE3_TARGETS.length - 1 && (
                <button type="button" onClick={goNextQ3} style={nextBtnStyle}>
                  {L('next_q')} →
                </button>
              )}

              {q3HasWrong && q3AllSubmitted && (
                <button type="button" onClick={tryAgain} style={tryAgainBtnStyle}>
                  ⟳ {L('try_again')}
                </button>
              )}
            </>
          )}

        </div>
      </div>
    </div>
  )
}

// ─── Time-domain plot ───────────────────────────────────────────────────
function TimePlot({
  x, y, w, h, visible, hiddenLabel, liveFm, liveDf, targetParams, L,
}: {
  x: number; y: number; w: number; h: number
  visible: boolean
  hiddenLabel: string
  liveFm: number
  liveDf: number
  targetParams: Params | null
  L: (k: string) => string
}) {
  const cy = y + h / 2
  const amp = h * 0.4

  const scaleY = (v: number) => cy - v * amp

  const buildSignalPath = (fm: number, df: number) => {
    const beta = df / fm
    let path = ''
    for (let i = 0; i < SAMPLES; i++) {
      const t = (i / (SAMPLES - 1)) * T_WINDOW_MS
      const v = sFM(t, fm, FP_FIXED, beta)
      const px = x + (i / (SAMPLES - 1)) * w
      const py = scaleY(v)
      path += `${i === 0 ? 'M' : 'L'} ${px.toFixed(1)} ${py.toFixed(1)} `
    }
    return path.trimEnd()
  }

  const clipId = `time-clip-${x}-${y}`

  return (
    <g fontFamily="'JetBrains Mono', monospace">
      <defs>
        <clipPath id={clipId}>
          <rect x={x + 1} y={y + 1} width={w - 2} height={h - 2} />
        </clipPath>
      </defs>

      <rect x={x} y={y} width={w} height={h}
        fill="none" stroke="#12203a" strokeWidth={1} rx={4} />

      <line x1={x} y1={cy} x2={x + w} y2={cy} stroke="#22304d" strokeWidth={0.8} />

      <text x={x + 6} y={y + 14}
        fontSize={10} fill="#54617A" letterSpacing="0.15em">
        {L('plot_time')}
      </text>

      {!visible ? (
        <text x={x + w / 2} y={cy + 4}
          fontSize={12} fill="#54617A" textAnchor="middle" letterSpacing="0.1em">
          {hiddenLabel}
        </text>
      ) : (
        <g clipPath={`url(#${clipId})`}>
          {targetParams && (
            <path
              d={buildSignalPath(targetParams.fm, targetParams.df)}
              stroke={TARGET_COLOR}
              strokeWidth={1}
              strokeDasharray="3 3"
              fill="none"
              opacity={0.7}
            />
          )}

          <path
            d={buildSignalPath(liveFm, liveDf)}
            stroke={SIGNAL_COLOR}
            strokeWidth={1.2}
            fill="none"
          />
        </g>
      )}

      {visible && (
        <g transform={`translate(${x + w - 130}, ${y + 12})`}>
          <line x1={0} y1={0} x2={16} y2={0} stroke={SIGNAL_COLOR} strokeWidth={1.4} />
          <text x={22} y={3} fontSize={9} fill="#B9C4D6">{L('legend_signal')}</text>
          {targetParams && (
            <>
              <line x1={0} y1={12} x2={16} y2={12} stroke={TARGET_COLOR} strokeWidth={1} strokeDasharray="3 3" />
              <text x={22} y={15} fontSize={9} fill="#B9C4D6">{L('legend_target')}</text>
            </>
          )}
        </g>
      )}

      {visible && (
        <text x={x + w - 4} y={cy - 4}
          fontSize={9} fill="#54617A" textAnchor="end">
          t (ms) →
        </text>
      )}
    </g>
  )
}

// ─── Spectrum plot ──────────────────────────────────────────────────────
function SpectrumPlot({
  x, y, w, h, fm, beta, fp, targetParams, showCarson, showValues, L,
}: {
  x: number; y: number; w: number; h: number
  fm: number; beta: number; fp: number
  targetParams: Params | null
  showCarson: boolean
  showValues: boolean
  L: (k: string) => string
}) {
  const baseY = y + h - 22
  const topY = y + 26
  const usableH = baseY - topY

  const xOf = (f: number) => x + ((f - F_LO) / (F_HI - F_LO)) * w
  const clampY = (yv: number) => Math.max(topY, Math.min(baseY - 1, yv))
  const inRange = (f: number) => f >= F_LO && f <= F_HI

  // Ticks every 2 kHz.
  const ticks: number[] = []
  for (let f = F_LO; f <= F_HI; f += 2) ticks.push(f)

  // Bars: n = -N..N; each bar height = |J_n(β)|; label = f_p + n·f_m.
  type Bar = { n: number; f: number; amp: number }
  const bars: Bar[] = []
  for (let n = -BESSEL_N_MAX; n <= BESSEL_N_MAX; n++) {
    const freq = fp + n * fm
    if (!inRange(freq)) continue
    bars.push({ n, f: freq, amp: besselMag(n, beta) })
  }

  // Target bars (dashed ghost markers on stage 2).
  const targetBars: Bar[] = []
  if (targetParams) {
    const tbeta = targetParams.df / targetParams.fm
    for (let n = -BESSEL_N_MAX; n <= BESSEL_N_MAX; n++) {
      const freq = fp + n * targetParams.fm
      if (!inRange(freq)) continue
      targetBars.push({ n, f: freq, amp: besselMag(n, tbeta) })
    }
  }

  // Carson bandwidth markers on stage 2: two vertical lines at f_p ± (Δf + f_m).
  const carsonFmt = (target: Params) => {
    const bw = target.df + target.fm
    return { lo: fp - bw, hi: fp + bw }
  }

  return (
    <g fontFamily="'JetBrains Mono', monospace">
      <rect x={x} y={y} width={w} height={h}
        fill="none" stroke="#12203a" strokeWidth={1} rx={4} />

      <text x={x + 6} y={y + 14}
        fontSize={10} fill="#54617A" letterSpacing="0.15em">
        {L('plot_spectrum')} — |S(f)|
      </text>

      {/* Baseline */}
      <line x1={x + 8} y1={baseY} x2={x + w - 8} y2={baseY} stroke="#3A4863" strokeWidth={0.8} />

      {/* Frequency ticks — REQUIRED information in stage 3. */}
      {ticks.map((f) => (
        <g key={f}>
          <line x1={xOf(f)} y1={baseY} x2={xOf(f)} y2={baseY + 4} stroke="#3A4863" strokeWidth={0.8} />
          <text x={xOf(f)} y={baseY + 15}
            fontSize={9} fill="#54617A" textAnchor="middle">{f}</text>
        </g>
      ))}
      <text x={x + w - 4} y={baseY + 15}
        fontSize={9} fill="#54617A" textAnchor="end">f (kHz)</text>

      {/* Carson band markers (stage 2 target visualization) */}
      {showCarson && targetParams && (() => {
        const { lo, hi } = carsonFmt(targetParams)
        return (
          <g>
            {inRange(lo) && (
              <line x1={xOf(lo)} y1={topY} x2={xOf(lo)} y2={baseY}
                stroke={CARSON_COLOR} strokeWidth={0.8} strokeDasharray="2 4" opacity={0.6} />
            )}
            {inRange(hi) && (
              <line x1={xOf(hi)} y1={topY} x2={xOf(hi)} y2={baseY}
                stroke={CARSON_COLOR} strokeWidth={0.8} strokeDasharray="2 4" opacity={0.6} />
            )}
            {inRange(hi) && (
              <text x={xOf(hi)} y={topY - 4} fontSize={9} fill={CARSON_COLOR}
                textAnchor="middle" opacity={0.8}>
                {L('legend_carson')}
              </text>
            )}
          </g>
        )
      })()}

      {/* Target ghost bars (stage 2) */}
      {targetBars.map((b, i) => {
        const yv = clampY(baseY - b.amp * usableH)
        return (
          <g key={`t${i}`} opacity={0.55}>
            <line x1={xOf(b.f)} y1={baseY} x2={xOf(b.f)} y2={yv}
              stroke={TARGET_COLOR} strokeWidth={1.2} strokeDasharray="2 3" />
          </g>
        )
      })}

      {/* Live bars */}
      {bars.map((b, i) => {
        const isCarrier = b.n === 0
        const color = isCarrier ? CARRIER_COLOR : SIDEBAND_COLOR
        const yv = clampY(baseY - b.amp * usableH)
        const significant = b.amp >= SIGNIFICANT_THRESHOLD
        return (
          <g key={`b${i}`} opacity={significant ? 1 : 0.35}>
            <line x1={xOf(b.f)} y1={baseY} x2={xOf(b.f)} y2={yv}
              stroke={color} strokeWidth={isCarrier ? 2 : 1.6} />
            <circle cx={xOf(b.f)} cy={yv} r={isCarrier ? 3.5 : 3} fill={color} />
          </g>
        )
      })}

      {/* Labels above bars */}
      {showValues ? (
        bars.map((b, i) => {
          if (b.amp < SIGNIFICANT_THRESHOLD) return null
          const yv = clampY(baseY - b.amp * usableH)
          const isCarrier = b.n === 0
          return (
            <text key={`lv${i}`} x={xOf(b.f)} y={yv - 8}
              fontSize={isCarrier ? 11 : 10}
              fill={isCarrier ? CARRIER_COLOR : SIDEBAND_COLOR}
              textAnchor="middle" fontWeight={700}>
              {b.f.toFixed(1)}
            </text>
          )
        })
      ) : (
        <>
          {/* Structural labels for stages 1 & 2: f_p center, and outermost pair labeled f_p ± n·f_m form is redundant; use spacing hint instead. */}
          {bars.filter((b) => b.n === 0).map((b, i) => {
            const yv = clampY(baseY - b.amp * usableH)
            return (
              <text key={`lc${i}`} x={xOf(b.f)} y={yv - 6}
                fontSize={10} fill={CARRIER_COLOR} textAnchor="middle">f_p</text>
            )
          })}
          {bars.filter((b) => b.n === 1 || b.n === -1).map((b, i) => {
            if (b.amp < SIGNIFICANT_THRESHOLD) return null
            const yv = clampY(baseY - b.amp * usableH)
            return (
              <text key={`ls${i}`} x={xOf(b.f)} y={yv - 6}
                fontSize={9} fill={SIDEBAND_COLOR} textAnchor="middle">
                {b.n < 0 ? 'f_p−f_m' : 'f_p+f_m'}
              </text>
            )
          })}
        </>
      )}

      {/* Amplitude annotation */}
      {showValues && (
        <text x={x + w - 8} y={topY + 12}
          fontSize={9} fill="#54617A" textAnchor="end">
          {L('sideband_label')}: |J_n(β)|
        </text>
      )}
    </g>
  )
}

// ─── UI sub-components ──────────────────────────────────────────────────
function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
      <div style={statusLabelStyle}>{label}</div>
      {children}
    </div>
  )
}

function NumberSlider({ min, max, step, value, onChange, accent }: {
  min: number; max: number; step: number
  value: number
  onChange: (v: number) => void
  accent: string
}) {
  const bump = (delta: number) =>
    onChange(Math.min(max, Math.max(min, +(value + delta).toFixed(3))))
  return (
    <div style={{ display: 'flex', gap: '0.8rem', alignItems: 'center', width: '100%', minWidth: 0 }}>
      <button type="button" onClick={() => bump(-step)} disabled={value <= min} style={sliderBtnStyle}>−</button>
      <input
        type="range"
        min={min} max={max} step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ flex: 1, minWidth: 0, width: 0, height: '2.6rem', accentColor: accent }}
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
  color: '#6C7A93', zIndex: 5, pointerEvents: 'none', maxWidth: '52%',
}
const rightPanelWrapperStyle: React.CSSProperties = {
  position: 'absolute',
  top: '9.7rem',
  bottom: '11.1rem',
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
  color: '#6C7A93',
  letterSpacing: '0.1em',
  marginBottom: '1.2rem',
  marginLeft: '0.4rem',
}
const rightPanelBoxStyle: React.CSSProperties = {
  flex: 1,
  border: '1px solid #12203a', borderRadius: '0.6rem',
  padding: '2.5rem',
  display: 'flex', flexDirection: 'column', gap: '3rem',
  fontSize: '2rem',
  overflow: 'auto',
}
const statusBoxStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: '0.6rem',
  padding: '1rem 1.2rem',
  border: '1px solid #12203a', borderRadius: '0.6rem',
}
const targetBoxStyle: React.CSSProperties = {
  ...statusBoxStyle,
  borderColor: TARGET_COLOR,
}
const statusLabelStyle: React.CSSProperties = {
  fontSize: '1.5rem', color: '#54617A',
  letterSpacing: '0.1em', textTransform: 'uppercase',
}
const inputStyle: React.CSSProperties = {
  padding: '1rem 1.2rem',
  background: '#12203a',
  color: '#EAF0FA',
  border: '1px solid #3A4863',
  borderRadius: '0.5rem',
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: '2rem',
  fontWeight: 700,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
}
const submitBtnStyle: React.CSSProperties = {
  padding: '1rem 1.4rem',
  background: OK_COLOR,
  color: '#0D1524',
  border: '1px solid ' + OK_COLOR,
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
const tryAgainBtnStyle: React.CSSProperties = {
  padding: '1rem 1.4rem',
  background: 'transparent',
  color: BAD_COLOR,
  border: `1px solid ${BAD_COLOR}`,
  borderRadius: '0.5rem',
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: '1.9rem',
  fontWeight: 700,
  cursor: 'pointer',
}
const sliderBtnStyle: React.CSSProperties = {
  width: '3.6rem', height: '3.6rem',
  background: 'transparent',
  color: '#B9C4D6',
  border: '1px solid #3A4863',
  borderRadius: '0.5rem',
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: '2.2rem',
  cursor: 'pointer',
  padding: 0,
}
