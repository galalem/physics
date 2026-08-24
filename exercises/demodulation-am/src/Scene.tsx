import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
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

// ─── Canvas ─────────────────────────────────────────────────────────────
const W = 800
const H = 450

// ─── Physics ────────────────────────────────────────────────────────────
// AM input: s(t) = A0 * (1 + m*cos(2π fm t)) * cos(2π fp t)
// Envelope: env(t) = A0 * (1 + m*cos(2π fm t))
// Rectifier: r(t) = max(0, s(t))
// RC low-pass (exact integrator): u_C[i+1] = u_C[i] + (r - u_C) * (1 - exp(-dt/τ))
// Ideal recovered signal: env(t)/π  (half-wave-rectified sinusoid mean = A/π)
// f in kHz, t in ms → 2π f t is dimensionless.
const A0 = 1

function sAM(t: number, fm: number, fp: number, m: number): number {
  return A0 * (1 + m * Math.cos(2 * Math.PI * fm * t)) * Math.cos(2 * Math.PI * fp * t)
}
function envAM(t: number, fm: number, m: number): number {
  return A0 * (1 + m * Math.cos(2 * Math.PI * fm * t))
}

// ─── Ranges ─────────────────────────────────────────────────────────────
const TAU_MIN = 0.01, TAU_MAX = 2, TAU_STEP = 0.01   // ms
const TAU_RIPPLE_MAX = 0.05                          // sawRipple threshold
const TAU_DROOP_MIN = 0.5                            // sawDroop threshold

// ─── Targets ────────────────────────────────────────────────────────────
type Scenario = { fm: number; fp: number; m: number; tau: number }
const STAGE2_TARGETS: Scenario[] = [
  { fm: 1.0, fp: 10.0, m: 0.7, tau: 0.20 },   // ideal window
  { fm: 0.5, fp: 8.0,  m: 0.8, tau: 0.35 },   // slower message ⇒ longer tau
  { fm: 2.0, fp: 15.0, m: 0.6, tau: 0.10 },   // faster carrier ⇒ shorter tau
]
const STAGE3_TARGETS: Scenario[] = [
  { fm: 1.0, fp: 10.0, m: 0.7, tau: 0.02 },   // too small ⇒ ripple
  { fm: 0.5, fp: 8.0,  m: 0.8, tau: 1.00 },   // too large ⇒ droop
  { fm: 2.0, fp: 12.0, m: 0.6, tau: 0.15 },   // ideal ⇒ clean
]
const STAGE1_SCENARIO: Scenario = { fm: 1.0, fp: 10.0, m: 0.7, tau: 0.20 }

// ─── Tolerances ─────────────────────────────────────────────────────────
const TAU_TOL_STAGE2 = 0.10   // ±10% for slider matching (visible target)
const TAU_TOL_STAGE3 = 0.25   // ±25% for blind read (typed value)

function matchesTau(userTau: number, targetTau: number, tol: number): boolean {
  return Math.abs(userTau - targetTau) / targetTau <= tol
}

// ─── Time window / sampling ─────────────────────────────────────────────
// 600 samples over 4 ms ⇒ dt = 6.67 µs ⇒ 15 samples per carrier period at fp=10kHz.
// At fp=15kHz: 10 samples/period — still comfortably above Nyquist.
const T_WINDOW_MS = 4
const SAMPLES = 600

// ─── Colors ─────────────────────────────────────────────────────────────
const INPUT_COLOR    = '#8AA0BF'   // AM input backdrop
const RECT_COLOR     = '#B87CE0'   // rectified train
const SMOOTHED_COLOR = '#37C9B8'   // recovered u_m(t) — the "hero" trace
const IDEAL_COLOR    = '#F9A968'   // dashed ideal envelope
const TARGET_COLOR   = '#8AA0BF'   // dashed target output in stage 2
const OK_COLOR       = '#37C9B8'
const BAD_COLOR      = '#F97316'
const RIPPLE_COLOR   = '#F97316'
const DROOP_COLOR    = '#F97316'

// ─── i18n ───────────────────────────────────────────────────────────────
const dict = { en } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels as Record<string, string>
}

// ─── Signal simulation ─────────────────────────────────────────────────
// Returns unshifted traces (before any DC removal / rescale). Rendering
// normalizes each series independently for display.
type Traces = {
  input: Float32Array
  rect: Float32Array
  smoothed: Float32Array
  ideal: Float32Array
}

function simulate(fm: number, fp: number, m: number, tauMs: number): Traces {
  const dt = T_WINDOW_MS / (SAMPLES - 1)
  const alpha = 1 - Math.exp(-dt / tauMs)
  const input = new Float32Array(SAMPLES)
  const rect = new Float32Array(SAMPLES)
  const smoothed = new Float32Array(SAMPLES)
  const ideal = new Float32Array(SAMPLES)
  // Warm-up so u_C starts near steady-state, otherwise the first samples
  // show a spurious charge-up transient that looks like droop.
  let uC = 0
  const warm = 200
  for (let i = 0; i < warm; i++) {
    const t = (i - warm) * dt
    const r = Math.max(0, sAM(t, fm, fp, m))
    uC = uC + (r - uC) * alpha
  }
  for (let i = 0; i < SAMPLES; i++) {
    const t = i * dt
    const s = sAM(t, fm, fp, m)
    const r = Math.max(0, s)
    uC = uC + (r - uC) * alpha
    input[i] = s
    rect[i] = r
    smoothed[i] = uC
    ideal[i] = envAM(t, fm, m) / Math.PI
  }
  return { input, rect, smoothed, ideal }
}

// ─── Component ─────────────────────────────────────────────────────────
export default function Scene() {
  const { locale, seed } = useInit()
  const stages = useMemo(() => getStagesFor(locale), [locale])
  useDeclareStages(stages)
  const labels = useMemo(() => svgLabels(locale), [locale])
  const L = useCallback((k: string) => labels[k] ?? k, [labels])

  const stageIdx = useCurrentStage()
  const isObserve = stageIdx === 1
  const isExperiment = stageIdx === 2
  const isEvaluate = stageIdx === 3

  // Slider state — τ only, per pattern brief §5.5.
  const [tau, setTau] = useState(STAGE1_SCENARIO.tau)

  // Observe coverage tracking.
  const [touchedTau, setTouchedTau] = useState(false)
  const [sawRipple, setSawRipple] = useState(false)
  const [sawDroop, setSawDroop] = useState(false)

  // Seed derives cycle offset so Try Again picks a different starting
  // question set — combined with q3Cycle it lets Try Again present a
  // deterministic-but-different rotation.
  const [q3Cycle, setQ3Cycle] = useState(0)

  // Experiment state.
  const [q2Idx, setQ2Idx] = useState(0)
  const [q2Solved, setQ2Solved] = useState<boolean[]>(() =>
    STAGE2_TARGETS.map(() => false),
  )

  // Evaluate state.
  const q3Order = useMemo(() => {
    // Deterministic rotation of the target array based on seed + cycle.
    const n = STAGE3_TARGETS.length
    const shift = ((seed % n) + q3Cycle) % n
    const out: number[] = []
    for (let i = 0; i < n; i++) out.push((shift + i) % n)
    return out
  }, [seed, q3Cycle])
  const [q3Idx, setQ3Idx] = useState(0)
  const [q3Tau, setQ3Tau] = useState('')
  const [q3Answers, setQ3Answers] = useState<(number | null)[]>(() =>
    STAGE3_TARGETS.map(() => null),
  )
  const [peekTip, setPeekTip] = useState<string | null>(null)
  const peekIdxRef = useRef(0)

  const setStage = useSetStage()
  const progress = useProgress()
  const complete = useComplete()

  // ─── Slider handler ─────────────────────────────────────────────────
  const onTau = (v: number) => {
    setTau(v)
    setTouchedTau(true)
    if (v <= TAU_RIPPLE_MAX) setSawRipple(true)
    if (v >= TAU_DROOP_MIN) setSawDroop(true)
  }

  // ─── Current scenario per stage ────────────────────────────────────
  const scenario: Scenario = isObserve
    ? { ...STAGE1_SCENARIO, tau }
    : isExperiment
      ? { ...(STAGE2_TARGETS[q2Idx] as Scenario), tau }
      : { ...(STAGE3_TARGETS[q3Order[q3Idx] as number] as Scenario) }
  // In stage 3 the SIM uses the target's hidden tau (student is diagnosing it).

  // ─── Experiment auto-detect ─────────────────────────────────────────
  useEffect(() => {
    if (!isExperiment) return
    const target = STAGE2_TARGETS[q2Idx] as Scenario
    if (matchesTau(tau, target.tau, TAU_TOL_STAGE2) && !q2Solved[q2Idx]) {
      setQ2Solved((prev) => {
        const next = [...prev]
        next[q2Idx] = true
        return next
      })
    }
  }, [tau, q2Idx, q2Solved, isExperiment])

  // ─── Success predicates ─────────────────────────────────────────────
  const observeDone = touchedTau && sawRipple && sawDroop
  const experimentDone = q2Solved.every(Boolean)

  const q3Results = q3Answers.map((a, i) =>
    a !== null
      ? matchesTau(a, (STAGE3_TARGETS[q3Order[i] as number] as Scenario).tau, TAU_TOL_STAGE3)
      : null,
  )
  const q3AllSubmitted = q3Answers.every((a) => a !== null)
  const q3AllCorrect = q3Results.every((r) => r === true)
  const q3HasWrong = q3Results.some((r) => r === false)
  const evaluateDone = q3AllSubmitted && q3AllCorrect

  const canSubmit = isObserve
    ? observeDone
    : isExperiment
      ? experimentDone
      : evaluateDone

  // ─── Reset ──────────────────────────────────────────────────────────
  const resetForStage = useCallback(() => {
    setTau(STAGE1_SCENARIO.tau)
    setTouchedTau(false)
    setSawRipple(false)
    setSawDroop(false)
    setQ2Idx(0)
    setQ2Solved(STAGE2_TARGETS.map(() => false))
    setQ3Idx(0)
    setQ3Tau('')
    setQ3Answers(STAGE3_TARGETS.map(() => null))
    setPeekTip(null)
  }, [])

  useReset(resetForStage)

  // ─── Progress ───────────────────────────────────────────────────────
  useEffect(() => {
    progress(stageIdx / 3, { stage: stageIdx, canSubmit })
  }, [stageIdx, canSubmit, progress])

  // ─── Stage advance ──────────────────────────────────────────────────
  useNext(() => {
    if (stageIdx < 3) {
      setStage(stageIdx + 1)
      resetForStage()
    } else {
      complete({ success: true })
    }
  })

  // ─── Peek — text-only strategy hint (§4.7 rule 4) ──────────────────
  usePeek(() => {
    if (!isEvaluate) return
    const tips = [L('peek_tip_1'), L('peek_tip_2')]
    const tip = tips[peekIdxRef.current % tips.length] as string
    setPeekTip(tip)
    peekIdxRef.current += 1
    setTimeout(() => setPeekTip(null), 2000)
  })

  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  // ─── Evaluate submit ────────────────────────────────────────────────
  const currentQ3Answer = q3Answers[q3Idx] ?? null
  const submitQ3 = () => {
    if (currentQ3Answer !== null) return
    const v = parseFloat(q3Tau)
    if (Number.isNaN(v) || v <= 0) return
    setQ3Answers((prev) => {
      const next = [...prev]
      next[q3Idx] = v
      return next
    })
  }
  const goNextQ3 = () => {
    if (q3Idx < STAGE3_TARGETS.length - 1) {
      setQ3Idx((n) => n + 1)
      setQ3Tau('')
    }
  }
  const goNextQ2 = () => {
    if (q2Idx < STAGE2_TARGETS.length - 1) setQ2Idx((n) => n + 1)
  }

  // ─── Try Again — restart stage 3 with a rotated setup (§4.7 rule 1) ─
  const tryAgain = useCallback(() => {
    setQ3Cycle((c) => c + 1)
    setQ3Idx(0)
    setQ3Tau('')
    setQ3Answers(STAGE3_TARGETS.map(() => null))
    setPeekTip(null)
  }, [])

  // ─── HUD ────────────────────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const q3SolvedCount = q3Results.filter((r) => r === true).length
  const hudTL = `${L('stage')} 0${stageIdx} · ${stageName}`
  const hudTR = isObserve
    ? `${L('sliders')}: ${touchedTau ? 1 : 0}/1  ·  ${sawRipple ? '✓' : '○'} ripple  ·  ${sawDroop ? '✓' : '○'} droop`
    : isExperiment
      ? `${L('target')} ${q2Idx + 1}/${STAGE2_TARGETS.length}  ·  ${q2Solved.filter(Boolean).length}/${STAGE2_TARGETS.length} ${L('matched')}`
      : `${L('question')} ${q3Idx + 1}/${STAGE3_TARGETS.length}  ·  ${q3SolvedCount}/${STAGE3_TARGETS.length} ${L('solved')}`
  const hudBL = peekTip ?? (isObserve ? L('tip1') : isExperiment ? L('tip2') : L('tip3'))

  // ─── Scene geometry ────────────────────────────────────────────────
  const SCENE_X = 40, SCENE_Y = 60, SCENE_W = 530, SCENE_H = 340
  const PLOT_X = 52, PLOT_W = 506
  const PLOT_Y = 90, PLOT_H = 300

  // On evaluate stage, hide the AM input backdrop and the ideal envelope
  // (both would be "help"). Only the smoothed output remains — that is
  // the diagnostic trace.
  const inputVisible = isObserve || isExperiment
  const rectVisible = isObserve   // only shown on stage 1 for pedagogy
  const idealVisible = isObserve || isExperiment
  const targetVisible = isExperiment
  // Precompute traces for the current scenario + student's tau (or, on
  // stage 3, the hidden tau). Also precompute the stage-2 target overlay.
  const liveTraces = useMemo(
    () => simulate(scenario.fm, scenario.fp, scenario.m, scenario.tau),
    [scenario.fm, scenario.fp, scenario.m, scenario.tau],
  )
  const targetTraces = useMemo(() => {
    if (!isExperiment) return null
    const t = STAGE2_TARGETS[q2Idx] as Scenario
    return simulate(t.fm, t.fp, t.m, t.tau)
  }, [isExperiment, q2Idx])

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
          x={PLOT_X} y={PLOT_Y} w={PLOT_W} h={PLOT_H}
          traces={liveTraces}
          targetTraces={targetVisible ? targetTraces : null}
          inputVisible={inputVisible}
          rectVisible={rectVisible}
          idealVisible={idealVisible}
          isEvaluate={isEvaluate}
          fm={scenario.fm}
          fp={scenario.fp}
          m={scenario.m}
          L={L}
        />
      </svg>

      <div style={hudTLStyle}>{hudTL}</div>
      <div style={{ ...hudTRStyle, color: canSubmit ? OK_COLOR : '#B9C4D6' }}>{hudTR}</div>
      <div style={hudBLStyle}>{hudBL}</div>
      {/* NO bottom-right — reserved for parent chrome */}

      <div style={rightPanelWrapperStyle}>
        <div style={rightPanelTitleStyle}>{L('controls_title')}</div>
        <div style={rightPanelBoxStyle}>

          {(isObserve || isExperiment) && (
            <>
              {isExperiment && (
                <div style={targetBoxStyle}>
                  <div style={statusLabelStyle}>{L('target')} {q2Idx + 1}/{STAGE2_TARGETS.length}</div>
                  <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', color: TARGET_COLOR, fontWeight: 700, fontSize: '1.7rem' }}>
                    <span>f_m = {(STAGE2_TARGETS[q2Idx] as Scenario).fm.toFixed(1)}</span>
                    <span>f_p = {(STAGE2_TARGETS[q2Idx] as Scenario).fp.toFixed(1)}</span>
                    <span>m = {(STAGE2_TARGETS[q2Idx] as Scenario).m.toFixed(2)}</span>
                    <span>τ = {(STAGE2_TARGETS[q2Idx] as Scenario).tau.toFixed(2)} ms</span>
                  </div>
                  {q2Solved[q2Idx] && (
                    <div style={{ color: OK_COLOR, fontSize: '1.6rem', marginTop: '0.4rem' }}>
                      ✓ {L('matched_msg')}
                    </div>
                  )}
                </div>
              )}

              {isObserve && (
                <div style={givensBoxStyle}>
                  <div style={statusLabelStyle}>{L('given_label')}</div>
                  <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', color: '#B9C4D6', fontWeight: 700, fontSize: '1.7rem' }}>
                    <span>f_m = {STAGE1_SCENARIO.fm.toFixed(1)} kHz</span>
                    <span>f_p = {STAGE1_SCENARIO.fp.toFixed(1)} kHz</span>
                    <span>m = {STAGE1_SCENARIO.m.toFixed(2)}</span>
                  </div>
                </div>
              )}

              <FieldGroup label={`${L('field_tau')}: ${tau.toFixed(2)} ms`}>
                <NumberSlider
                  min={TAU_MIN} max={TAU_MAX} step={TAU_STEP}
                  value={tau} onChange={onTau} accent={SMOOTHED_COLOR}
                />
              </FieldGroup>

              {isObserve && tau <= TAU_RIPPLE_MAX && (
                <div style={{ ...statusBoxStyle, borderColor: RIPPLE_COLOR }}>
                  <div style={{ ...statusLabelStyle, color: RIPPLE_COLOR }}>{L('ripple_title')}</div>
                  <div style={{ fontSize: '1.5rem', color: '#B9C4D6', lineHeight: 1.4 }}>{L('ripple_desc')}</div>
                </div>
              )}
              {isObserve && tau >= TAU_DROOP_MIN && (
                <div style={{ ...statusBoxStyle, borderColor: DROOP_COLOR }}>
                  <div style={{ ...statusLabelStyle, color: DROOP_COLOR }}>{L('droop_title')}</div>
                  <div style={{ fontSize: '1.5rem', color: '#B9C4D6', lineHeight: 1.4 }}>{L('droop_desc')}</div>
                </div>
              )}
              {isObserve && sawRipple && sawDroop && (
                <div style={{ ...statusBoxStyle, borderColor: OK_COLOR }}>
                  <div style={{ ...statusLabelStyle, color: OK_COLOR }}>{L('ideal_title')}</div>
                  <div style={{ fontSize: '1.5rem', color: '#B9C4D6', lineHeight: 1.4 }}>{L('ideal_desc')}</div>
                </div>
              )}

              {isExperiment && q2Solved[q2Idx] && q2Idx < STAGE2_TARGETS.length - 1 && (
                <button type="button" onClick={goNextQ2} style={nextBtnStyle}>
                  {L('next_q')} →
                </button>
              )}
            </>
          )}

          {isEvaluate && (
            <>
              <div style={{ fontSize: '1.7rem', color: '#B9C4D6', lineHeight: 1.4 }}>
                {L('problem_prompt')}
              </div>

              <div style={givensBoxStyle}>
                <div style={statusLabelStyle}>{L('given_label')}</div>
                <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', color: '#B9C4D6', fontWeight: 700, fontSize: '1.6rem' }}>
                  <span>f_m = {scenario.fm.toFixed(1)} kHz</span>
                  <span>f_p = {scenario.fp.toFixed(1)} kHz</span>
                  <span>m = {scenario.m.toFixed(2)}</span>
                </div>
              </div>

              <FieldGroup label={`${L('field_tau')} (ms)`}>
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  <input
                    type="number" value={q3Tau} step="0.01" min="0"
                    disabled={currentQ3Answer !== null}
                    onChange={(e) => setQ3Tau(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') submitQ3() }}
                    placeholder="? ms"
                    style={{ ...inputStyle, flex: 1 }}
                  />
                  <button
                    type="button"
                    onClick={submitQ3}
                    disabled={currentQ3Answer !== null || q3Tau === ''}
                    style={{
                      ...submitBtnStyle,
                      opacity: currentQ3Answer !== null || q3Tau === '' ? 0.45 : 1,
                      cursor: currentQ3Answer !== null || q3Tau === '' ? 'not-allowed' : 'pointer',
                    }}
                  >✓</button>
                </div>
              </FieldGroup>

              {currentQ3Answer !== null && (() => {
                const t = STAGE3_TARGETS[q3Order[q3Idx] as number] as Scenario
                const ok = matchesTau(currentQ3Answer, t.tau, TAU_TOL_STAGE3)
                return (
                  <div style={{
                    padding: '1rem 1.2rem',
                    border: `1px solid ${ok ? OK_COLOR : BAD_COLOR}`,
                    borderRadius: '0.5rem',
                    background: ok ? 'rgba(55,201,184,0.08)' : 'rgba(249,115,22,0.08)',
                    color: ok ? OK_COLOR : BAD_COLOR,
                    fontSize: '1.6rem',
                    display: 'flex', flexDirection: 'column', gap: '0.4rem',
                  }}>
                    <div style={{ fontWeight: 700 }}>
                      {ok ? `✓ ${L('correct')}` : `✗ ${L('exact_was')}`}
                    </div>
                    <div style={{ color: '#B9C4D6', fontSize: '1.5rem' }}>
                      τ = {t.tau.toFixed(2)} ms
                    </div>
                  </div>
                )
              })()}

              {currentQ3Answer !== null && q3Idx < STAGE3_TARGETS.length - 1 && (
                <button type="button" onClick={goNextQ3} style={nextBtnStyle}>
                  {L('next_q')} →
                </button>
              )}

              {q3AllSubmitted && q3HasWrong && (
                <button type="button" onClick={tryAgain} style={tryAgainBtnStyle}>
                  ↻ {L('try_again')}
                </button>
              )}
            </>
          )}

        </div>
      </div>
    </div>
  )
}

// ─── Time-domain plot ──────────────────────────────────────────────────
function TimePlot({
  x, y, w, h, traces, targetTraces, inputVisible, rectVisible, idealVisible,
  isEvaluate, fm, fp, m, L,
}: {
  x: number; y: number; w: number; h: number
  traces: Traces
  targetTraces: Traces | null
  inputVisible: boolean
  rectVisible: boolean
  idealVisible: boolean
  isEvaluate: boolean
  fm: number
  fp: number
  m: number
  L: (k: string) => string
}) {
  const clipId = `demod-clip-${x}-${y}`

  // Visual Y range chosen so that:
  //   input s(t)  ∈ [-(1+m), 1+m]  → maps to [-1.6, 1.6] worst case at m=1
  //   rectified   ∈ [0, 1+m]
  //   smoothed    ∈ [0, (1+m)/π]  ≈ 0 to 0.64
  //   ideal       ∈ [(1-m)/π, (1+m)/π] ≈ 0.10 to 0.54 at m=0.7
  // We plot centered vertically with center at 0 mapped to (y + h*0.55), so the
  // predominantly-positive rectified/smoothed traces sit in the upper 45% of
  // the plot and the input's negative excursions have room below. Rescale by
  // AMP_MAX so ±(1+m_max) fills the plot cleanly.
  const cy = y + h * 0.58
  const AMP_MAX = 1.9              // fits (1 + m) with m up to ~0.85 comfortably
  const scaleY = (v: number) => cy - (v / AMP_MAX) * (h * 0.42)

  const buildPath = (arr: Float32Array) => {
    let path = ''
    const n = arr.length
    for (let i = 0; i < n; i++) {
      const px = x + (i / (n - 1)) * w
      const py = scaleY(arr[i] as number)
      path += `${i === 0 ? 'M' : 'L'} ${px.toFixed(1)} ${py.toFixed(1)} `
    }
    return path.trimEnd()
  }

  const zeroY = scaleY(0)

  return (
    <g fontFamily="'JetBrains Mono', monospace">
      <defs>
        <clipPath id={clipId}>
          <rect x={x + 1} y={y + 1} width={w - 2} height={h - 2} />
        </clipPath>
      </defs>

      <rect x={x} y={y} width={w} height={h}
        fill="none" stroke="#12203a" strokeWidth={1} rx={4} />

      {/* Zero baseline for the smoothed / rectified traces */}
      <line x1={x} y1={zeroY} x2={x + w} y2={zeroY} stroke="#22304d" strokeWidth={0.8} />

      <text x={x + 6} y={y + 14}
        fontSize={10} fill="#54617A" letterSpacing="0.15em">
        {isEvaluate ? L('plot_output') : L('plot_time')}
      </text>

      {/* Time axis label */}
      <text x={x + w - 4} y={y + h - 4}
        fontSize={9} fill="#54617A" textAnchor="end">
        t (ms) → (window = {T_WINDOW_MS} ms)
      </text>
      <text x={x + 6} y={y + h - 4}
        fontSize={9} fill="#54617A" textAnchor="start">
        f_m = {fm.toFixed(1)}  f_p = {fp.toFixed(1)}  m = {m.toFixed(2)}
      </text>

      <g clipPath={`url(#${clipId})`}>
        {/* Stage-2 target overlay (dashed) drawn under the live smoothed trace */}
        {targetTraces && (
          <path
            d={buildPath(targetTraces.smoothed)}
            stroke={TARGET_COLOR}
            strokeWidth={1.2}
            strokeDasharray="4 4"
            fill="none"
            opacity={0.75}
          />
        )}

        {/* AM input backdrop (dim) — stages 1 & 2 only */}
        {inputVisible && (
          <path
            d={buildPath(traces.input)}
            stroke={INPUT_COLOR}
            strokeWidth={0.7}
            fill="none"
            opacity={0.45}
          />
        )}

        {/* Rectified (stage 1 only, dim) */}
        {rectVisible && (
          <path
            d={buildPath(traces.rect)}
            stroke={RECT_COLOR}
            strokeWidth={0.9}
            fill="none"
            opacity={0.55}
          />
        )}

        {/* Ideal envelope (dashed amber) — help; hidden on evaluate */}
        {idealVisible && (
          <path
            d={buildPath(traces.ideal)}
            stroke={IDEAL_COLOR}
            strokeWidth={1.3}
            strokeDasharray="5 4"
            fill="none"
            opacity={0.9}
          />
        )}

        {/* Smoothed recovered signal — the hero trace, always visible */}
        <path
          d={buildPath(traces.smoothed)}
          stroke={SMOOTHED_COLOR}
          strokeWidth={1.6}
          fill="none"
        />
      </g>

      {/* Legend */}
      <g transform={`translate(${x + w - 148}, ${y + 12})`}>
        <line x1={0} y1={0} x2={16} y2={0} stroke={SMOOTHED_COLOR} strokeWidth={1.6} />
        <text x={22} y={3} fontSize={9} fill="#B9C4D6">{L('legend_smoothed')}</text>
        {idealVisible && (
          <>
            <line x1={0} y1={12} x2={16} y2={12} stroke={IDEAL_COLOR} strokeWidth={1.3} strokeDasharray="5 4" />
            <text x={22} y={15} fontSize={9} fill="#B9C4D6">{L('legend_ideal')}</text>
          </>
        )}
        {inputVisible && (
          <>
            <line x1={0} y1={24} x2={16} y2={24} stroke={INPUT_COLOR} strokeWidth={0.7} opacity={0.6} />
            <text x={22} y={27} fontSize={9} fill="#B9C4D6">{L('legend_input')}</text>
          </>
        )}
        {rectVisible && (
          <>
            <line x1={0} y1={36} x2={16} y2={36} stroke={RECT_COLOR} strokeWidth={0.9} opacity={0.6} />
            <text x={22} y={39} fontSize={9} fill="#B9C4D6">{L('legend_rect')}</text>
          </>
        )}
        {targetTraces && (
          <>
            <line
              x1={0} y1={rectVisible ? 48 : 36} x2={16} y2={rectVisible ? 48 : 36}
              stroke={TARGET_COLOR} strokeWidth={1.2} strokeDasharray="4 4"
            />
            <text x={22} y={rectVisible ? 51 : 39} fontSize={9} fill="#B9C4D6">
              {L('legend_target')}
            </text>
          </>
        )}
      </g>
    </g>
  )
}

// ─── UI sub-components ─────────────────────────────────────────────────
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

// ─── Styles ────────────────────────────────────────────────────────────
const hudTLStyle: CSSProperties = {
  position: 'absolute', top: '3rem', left: '3rem',
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: '2.3rem', letterSpacing: '0.14em', textTransform: 'uppercase',
  color: '#6C7A93', zIndex: 5, pointerEvents: 'none',
}
const hudTRStyle: CSSProperties = {
  position: 'absolute', top: '3rem', right: '3rem',
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: '2.3rem', letterSpacing: '0.08em',
  zIndex: 5, pointerEvents: 'none',
}
const hudBLStyle: CSSProperties = {
  position: 'absolute', bottom: '3rem', left: '3rem',
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: '2.3rem', letterSpacing: '0.06em',
  color: '#6C7A93', zIndex: 5, pointerEvents: 'none', maxWidth: '52%',
}
const rightPanelWrapperStyle: CSSProperties = {
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
const rightPanelTitleStyle: CSSProperties = {
  fontSize: '2.44rem',
  color: '#6C7A93',
  letterSpacing: '0.1em',
  marginBottom: '1.2rem',
  marginLeft: '0.4rem',
}
const rightPanelBoxStyle: CSSProperties = {
  flex: 1,
  border: '1px solid #12203a', borderRadius: '0.6rem',
  padding: '2.5rem',
  display: 'flex', flexDirection: 'column', gap: '2.4rem',
  fontSize: '2rem',
  overflow: 'auto',
}
const statusBoxStyle: CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: '0.6rem',
  padding: '1rem 1.2rem',
  border: '1px solid #12203a', borderRadius: '0.6rem',
}
const targetBoxStyle: CSSProperties = {
  ...statusBoxStyle,
  borderColor: TARGET_COLOR,
}
const givensBoxStyle: CSSProperties = {
  ...statusBoxStyle,
  borderColor: '#3A4863',
}
const statusLabelStyle: CSSProperties = {
  fontSize: '1.5rem', color: '#54617A',
  letterSpacing: '0.1em', textTransform: 'uppercase',
}
const inputStyle: CSSProperties = {
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
const submitBtnStyle: CSSProperties = {
  padding: '1rem 1.4rem',
  background: OK_COLOR,
  color: '#0D1524',
  border: '1px solid ' + OK_COLOR,
  borderRadius: '0.5rem',
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: '2rem',
  fontWeight: 800,
}
const nextBtnStyle: CSSProperties = {
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
const tryAgainBtnStyle: CSSProperties = {
  padding: '1rem 1.4rem',
  background: 'transparent',
  color: BAD_COLOR,
  border: '1px solid ' + BAD_COLOR,
  borderRadius: '0.5rem',
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: '1.8rem',
  fontWeight: 700,
  cursor: 'pointer',
}
const sliderBtnStyle: CSSProperties = {
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
