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
// AM signal: s(t) = A0 · [1 + m·cos(2π f_m t)] · cos(2π f_p t)
// Envelope:  env(t) = A0 · (1 + m·cos(2π f_m t))
// Spectrum:  carrier at f_p (amplitude 1), sidebands at f_p ± f_m (amp m/2)
// f in kHz, t in ms → 2π f t is unit-consistent.
const A0 = 1

function sAM(t: number, fm: number, fp: number, m: number): number {
  return A0 * (1 + m * Math.cos(2 * Math.PI * fm * t)) * Math.cos(2 * Math.PI * fp * t)
}
function envAM(t: number, fm: number, m: number): number {
  return A0 * (1 + m * Math.cos(2 * Math.PI * fm * t))
}

// ─── Ranges ────────────────────────────────────────────────────────────
const FM_MIN = 0.5, FM_MAX = 4, FM_STEP = 0.1     // kHz
const FP_MIN = 5, FP_MAX = 15, FP_STEP = 0.5      // kHz
const M_MIN = 0, M_MAX = 1.5, M_STEP = 0.05

// ─── Targets ──────────────────────────────────────────────────────────
type Params = { fm: number; fp: number; m: number }
const STAGE2_TARGETS: Params[] = [
  { fm: 1.0, fp: 10.0, m: 0.5 },
  { fm: 2.0, fp: 10.0, m: 1.0 },
  { fm: 1.5, fp: 8.0,  m: 0.8 },
]
const STAGE3_TARGETS: Params[] = [
  { fm: 1.0, fp: 10.0, m: 0.5 },
  { fm: 2.0, fp: 8.0,  m: 0.8 },
  { fm: 0.5, fp: 12.0, m: 0.3 },
]

const FREQ_TOL_PCT = 0.05
const M_TOL = 0.05

function matches(p: Params, target: Params): boolean {
  return (
    Math.abs(p.fm - target.fm) / target.fm <= FREQ_TOL_PCT &&
    Math.abs(p.fp - target.fp) / target.fp <= FREQ_TOL_PCT &&
    Math.abs(p.m - target.m) <= M_TOL
  )
}
function withinFreq(user: number, exact: number): boolean {
  return Math.abs(user - exact) / exact <= FREQ_TOL_PCT
}
function withinM(user: number, exact: number): boolean {
  return Math.abs(user - exact) <= M_TOL
}
function q3IsCorrect(a: Params, t: Params): boolean {
  return withinFreq(a.fm, t.fm) && withinFreq(a.fp, t.fp) && withinM(a.m, t.m)
}

// ─── Time window ───────────────────────────────────────────────────────
const T_WINDOW_MS = 4          // fixed 4 ms
const SAMPLES = 600

// ─── Colors ─────────────────────────────────────────────────────────────
const SIGNAL_COLOR = '#37C9B8'
const ENV_COLOR    = '#F9A968'
const CARRIER_COLOR= '#B87CE0'
const SIDEBAND_COLOR = '#F9A968'
const TARGET_COLOR = '#8AA0BF'
const OK_COLOR = '#37C9B8'
const BAD_COLOR = '#F97316'
const OVERMOD_COLOR = '#F97316'

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

  const [fm, setFm] = useState(1.0)
  const [fp, setFp] = useState(10.0)
  const [m, setM] = useState(0.5)

  const [touchedFm, setTouchedFm] = useState(false)
  const [touchedFp, setTouchedFp] = useState(false)
  const [touchedM, setTouchedM] = useState(false)
  const [sawOvermod, setSawOvermod] = useState(false)

  const [q2Idx, setQ2Idx] = useState(0)
  const [q2Solved, setQ2Solved] = useState<boolean[]>(() => STAGE2_TARGETS.map(() => false))

  const [q3Idx, setQ3Idx] = useState(0)
  const [q3Fm, setQ3Fm] = useState('')
  const [q3Fp, setQ3Fp] = useState('')
  const [q3M, setQ3M] = useState('')
  const [q3Answers, setQ3Answers] = useState<(Params | null)[]>(() => STAGE3_TARGETS.map(() => null))
  const [peekFlash, setPeekFlash] = useState(false)

  const setStage = useSetStage()
  const progress = useProgress()
  const complete = useComplete()

  const onFm = (v: number) => { setFm(v); setTouchedFm(true) }
  const onFp = (v: number) => { setFp(v); setTouchedFp(true) }
  const onM = (v: number) => {
    setM(v); setTouchedM(true)
    if (v > 1) setSawOvermod(true)
  }

  useEffect(() => {
    if (!isExperiment) return
    const target = STAGE2_TARGETS[q2Idx]!
    if (matches({ fm, fp, m }, target) && !q2Solved[q2Idx]) {
      setQ2Solved((prev) => {
        const next = [...prev]
        next[q2Idx] = true
        return next
      })
    }
  }, [fm, fp, m, q2Idx, q2Solved, isExperiment])

  const observeDone = touchedFm && touchedFp && touchedM && sawOvermod
  const experimentDone = q2Solved.every(Boolean)
  const evaluateDone = q3Answers.every((a, i) => a !== null && q3IsCorrect(a, STAGE3_TARGETS[i]!))
  const canSubmit = isObserve ? observeDone : isExperiment ? experimentDone : evaluateDone

  const resetForStage = useCallback((_s: number) => {
    setFm(1.0); setFp(10.0); setM(0.5)
    setTouchedFm(false); setTouchedFp(false); setTouchedM(false); setSawOvermod(false)
    setQ2Idx(0); setQ2Solved(STAGE2_TARGETS.map(() => false))
    setQ3Idx(0); setQ3Fm(''); setQ3Fp(''); setQ3M('')
    setQ3Answers(STAGE3_TARGETS.map(() => null))
    setPeekFlash(false)
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
    setTimeout(() => setPeekFlash(false), 1600)
  })

  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  const submitQ3 = () => {
    const vfm = parseFloat(q3Fm), vfp = parseFloat(q3Fp), vm = parseFloat(q3M)
    if (Number.isNaN(vfm) || Number.isNaN(vfp) || Number.isNaN(vm)) return
    setQ3Answers((prev) => {
      const next = [...prev]
      next[q3Idx] = { fm: vfm, fp: vfp, m: vm }
      return next
    })
  }
  const goNextQ3 = () => {
    if (q3Idx < STAGE3_TARGETS.length - 1) {
      setQ3Idx((n) => n + 1)
      setQ3Fm(''); setQ3Fp(''); setQ3M('')
    }
  }
  const goNextQ2 = () => {
    if (q2Idx < STAGE2_TARGETS.length - 1) setQ2Idx((n) => n + 1)
  }

  const currentTarget = isExperiment
    ? STAGE2_TARGETS[q2Idx]!
    : isEvaluate ? STAGE3_TARGETS[q3Idx]! : null
  const q3Answer = isEvaluate ? q3Answers[q3Idx] ?? null : null

  const stageName = stages[stageIdx - 1]?.name ?? ''
  const q3SolvedCount = q3Answers.filter((a, i) => a !== null && q3IsCorrect(a, STAGE3_TARGETS[i]!)).length
  const hudTL = `${L('stage')} 0${stageIdx} · ${stageName}`
  const hudTR = isObserve
    ? `${L('sliders')}: ${[touchedFm, touchedFp, touchedM].filter(Boolean).length}/3  ·  ${sawOvermod ? '✓' : '○'} m>1`
    : isExperiment
      ? `${L('target')} ${q2Idx + 1}/${STAGE2_TARGETS.length}  ·  ${q2Solved.filter(Boolean).length}/${STAGE2_TARGETS.length} ${L('matched')}`
      : `${L('question')} ${q3Idx + 1}/${STAGE3_TARGETS.length}  ·  ${q3SolvedCount}/${STAGE3_TARGETS.length} ${L('solved')}`
  const hudBL = isObserve ? L('tip1') : isExperiment ? L('tip2') : L('tip3')

  // Scene box on the left (plots inside); title sits outside above the box.
  const SCENE_X = 40, SCENE_Y = 60, SCENE_W = 530, SCENE_H = 340
  const PLOT_X = 52
  const PLOT_W = 506
  const TIME_Y = 90
  const TIME_H = 140
  const SPEC_Y = 250
  const SPEC_H = 140

  const timeDomainVisible = isObserve || isExperiment || (isEvaluate && peekFlash)

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block', borderRadius: 14, userSelect: 'none' }}
      >
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" rx={14} />

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
          hiddenLabel={L('hidden_peek')}
          liveParams={{ fm, fp, m }}
          targetParams={isExperiment ? currentTarget : null}
          isOvermod={m > 1}
          L={L}
        />

        <SpectrumPlot
          x={PLOT_X} y={SPEC_Y} w={PLOT_W} h={SPEC_H}
          fm={isEvaluate ? currentTarget!.fm : fm}
          fp={isEvaluate ? currentTarget!.fp : fp}
          m={isEvaluate ? currentTarget!.m : m}
          showValues={isEvaluate}
          L={L}
        />
      </svg>

      <div style={hudTLStyle}>{hudTL}</div>
      <div style={{ ...hudTRStyle, color: canSubmit ? '#37C9B8' : '#B9C4D6' }}>{hudTR}</div>
      <div style={hudBLStyle}>{hudBL}</div>

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
                  <span>f_p = {currentTarget.fp.toFixed(1)}</span>
                  <span>m = {currentTarget.m.toFixed(2)}</span>
                </div>
                {q2Solved[q2Idx] && (
                  <div style={{ color: OK_COLOR, fontSize: '1.6rem', marginTop: '0.4rem' }}>
                    ✓ {L('matched_msg')}
                  </div>
                )}
              </div>
            )}

            <FieldGroup label={`${L('field_fm')}: ${fm.toFixed(1)} kHz`}>
              <NumberSlider min={FM_MIN} max={FM_MAX} step={FM_STEP} value={fm} onChange={onFm} accent={ENV_COLOR} />
            </FieldGroup>

            <FieldGroup label={`${L('field_fp')}: ${fp.toFixed(1)} kHz`}>
              <NumberSlider min={FP_MIN} max={FP_MAX} step={FP_STEP} value={fp} onChange={onFp} accent={CARRIER_COLOR} />
            </FieldGroup>

            <FieldGroup label={`${L('field_m')}: ${m.toFixed(2)}${m > 1 ? '  ⚠' : ''}`}>
              <NumberSlider min={M_MIN} max={M_MAX} step={M_STEP} value={m} onChange={onM} accent={m > 1 ? OVERMOD_COLOR : SIGNAL_COLOR} />
            </FieldGroup>

            {isObserve && m > 1 && (
              <div style={{ ...statusBoxStyle, borderColor: OVERMOD_COLOR }}>
                <div style={{ ...statusLabelStyle, color: OVERMOD_COLOR }}>{L('overmod_title')}</div>
                <div style={{ fontSize: '1.6rem', color: '#B9C4D6', lineHeight: 1.4 }}>{L('overmod_desc')}</div>
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

            <FieldGroup label={`${L('field_fp')} (kHz)`}>
              <input
                type="number" value={q3Fp} step="0.1"
                disabled={q3Answer !== null}
                onChange={(e) => setQ3Fp(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') submitQ3() }}
                placeholder="? kHz"
                style={inputStyle}
              />
            </FieldGroup>

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

            <FieldGroup label={L('field_m')}>
              <div style={{ display: 'flex', gap: '0.4rem' }}>
                <input
                  type="number" value={q3M} step="0.05"
                  disabled={q3Answer !== null}
                  onChange={(e) => setQ3M(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') submitQ3() }}
                  placeholder="?"
                  style={{ ...inputStyle, flex: 1 }}
                />
                <button
                  type="button"
                  onClick={submitQ3}
                  disabled={q3Answer !== null || q3Fp === '' || q3Fm === '' || q3M === ''}
                  style={{
                    ...submitBtnStyle,
                    opacity: q3Answer !== null || q3Fp === '' || q3Fm === '' || q3M === '' ? 0.45 : 1,
                    cursor: q3Answer !== null || q3Fp === '' || q3Fm === '' || q3M === '' ? 'not-allowed' : 'pointer',
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
                    f_p = {t.fp.toFixed(1)} · f_m = {t.fm.toFixed(1)} · m = {t.m.toFixed(2)}
                  </div>
                </div>
              )
            })()}

            {q3Answer && q3Idx < STAGE3_TARGETS.length - 1 && (
              <button type="button" onClick={goNextQ3} style={nextBtnStyle}>
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

// ─── Time-domain plot ───────────────────────────────────────────────────
function TimePlot({
  x, y, w, h, visible, hiddenLabel, liveParams, targetParams, isOvermod, L,
}: {
  x: number; y: number; w: number; h: number
  visible: boolean
  hiddenLabel: string
  liveParams: Params
  targetParams: Params | null
  isOvermod: boolean
  L: (k: string) => string
}) {
  const cy = y + h / 2
  const amp = h * 0.36  // v=±2 (m=1) maps to plot bounds; m=1.5 will clip visibly

  const scaleY = (v: number) => cy - (v / 2) * amp

  const buildSignalPath = (fm: number, fp: number, m: number) => {
    let path = ''
    for (let i = 0; i < SAMPLES; i++) {
      const t = (i / (SAMPLES - 1)) * T_WINDOW_MS
      const v = sAM(t, fm, fp, m)
      const px = x + (i / (SAMPLES - 1)) * w
      const py = scaleY(v)
      path += `${i === 0 ? 'M' : 'L'} ${px.toFixed(1)} ${py.toFixed(1)} `
    }
    return path.trimEnd()
  }

  const buildEnvelopePath = (fm: number, m: number, sign: 1 | -1) => {
    let path = ''
    const steps = 200
    for (let i = 0; i < steps; i++) {
      const t = (i / (steps - 1)) * T_WINDOW_MS
      const v = sign * envAM(t, fm, m)
      const px = x + (i / (steps - 1)) * w
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
              d={buildSignalPath(targetParams.fm, targetParams.fp, targetParams.m)}
              stroke={TARGET_COLOR}
              strokeWidth={1}
              strokeDasharray="3 3"
              fill="none"
              opacity={0.7}
            />
          )}

          <path
            d={buildEnvelopePath(liveParams.fm, liveParams.m, 1)}
            stroke={ENV_COLOR} strokeWidth={1.4} fill="none" opacity={0.85}
          />
          <path
            d={buildEnvelopePath(liveParams.fm, liveParams.m, -1)}
            stroke={ENV_COLOR} strokeWidth={1.4} fill="none" opacity={0.85}
          />

          <path
            d={buildSignalPath(liveParams.fm, liveParams.fp, liveParams.m)}
            stroke={isOvermod ? OVERMOD_COLOR : SIGNAL_COLOR}
            strokeWidth={1.2}
            fill="none"
          />
        </g>
      )}

      {visible && (
        <g transform={`translate(${x + w - 130}, ${y + 12})`}>
          <line x1={0} y1={0} x2={16} y2={0} stroke={isOvermod ? OVERMOD_COLOR : SIGNAL_COLOR} strokeWidth={1.4} />
          <text x={22} y={3} fontSize={9} fill="#B9C4D6">{L('legend_signal')}</text>
          <line x1={0} y1={12} x2={16} y2={12} stroke={ENV_COLOR} strokeWidth={1.4} opacity={0.85} />
          <text x={22} y={15} fontSize={9} fill="#B9C4D6">{L('legend_envelope')}</text>
          {targetParams && (
            <>
              <line x1={0} y1={24} x2={16} y2={24} stroke={TARGET_COLOR} strokeWidth={1} strokeDasharray="3 3" />
              <text x={22} y={27} fontSize={9} fill="#B9C4D6">{L('legend_target')}</text>
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
  x, y, w, h, fm, fp, m, showValues, L,
}: {
  x: number; y: number; w: number; h: number
  fm: number; fp: number; m: number
  showValues: boolean
  L: (k: string) => string
}) {
  const baseY = y + h - 22
  const topY = y + 26
  const usableH = baseY - topY

  const F_LO = 4
  const F_HI = 16
  const xOf = (f: number) => x + ((f - F_LO) / (F_HI - F_LO)) * w
  // Vertical: carrier amplitude = 1 → top of usable area; sideband = m/2 fraction from bottom.
  const carrierY = topY
  const sidebandY = baseY - (m / 2) * usableH

  const clampY = (yv: number) => Math.max(topY, Math.min(baseY - 1, yv))

  const ticks: number[] = []
  for (let f = F_LO; f <= F_HI; f += 2) ticks.push(f)

  return (
    <g fontFamily="'JetBrains Mono', monospace">
      <rect x={x} y={y} width={w} height={h}
        fill="none" stroke="#12203a" strokeWidth={1} rx={4} />

      <text x={x + 6} y={y + 14}
        fontSize={10} fill="#54617A" letterSpacing="0.15em">
        {L('plot_spectrum')} — |S(f)|
      </text>

      <line x1={x + 8} y1={baseY} x2={x + w - 8} y2={baseY} stroke="#3A4863" strokeWidth={0.8} />

      {ticks.map((f) => (
        <g key={f}>
          <line x1={xOf(f)} y1={baseY} x2={xOf(f)} y2={baseY + 4} stroke="#3A4863" strokeWidth={0.8} />
          <text x={xOf(f)} y={baseY + 15}
            fontSize={9} fill="#54617A" textAnchor="middle">{f}</text>
        </g>
      ))}
      <text x={x + w - 4} y={baseY + 15}
        fontSize={9} fill="#54617A" textAnchor="end">f (kHz)</text>

      <line x1={xOf(fp - fm)} y1={baseY} x2={xOf(fp - fm)} y2={clampY(sidebandY)}
        stroke={SIDEBAND_COLOR} strokeWidth={1.6} />
      <circle cx={xOf(fp - fm)} cy={clampY(sidebandY)} r={3} fill={SIDEBAND_COLOR} />

      <line x1={xOf(fp)} y1={baseY} x2={xOf(fp)} y2={clampY(carrierY)}
        stroke={CARRIER_COLOR} strokeWidth={2} />
      <circle cx={xOf(fp)} cy={clampY(carrierY)} r={3.5} fill={CARRIER_COLOR} />

      <line x1={xOf(fp + fm)} y1={baseY} x2={xOf(fp + fm)} y2={clampY(sidebandY)}
        stroke={SIDEBAND_COLOR} strokeWidth={1.6} />
      <circle cx={xOf(fp + fm)} cy={clampY(sidebandY)} r={3} fill={SIDEBAND_COLOR} />

      {showValues ? (
        <>
          <text x={xOf(fp)} y={clampY(carrierY) - 8}
            fontSize={11} fill={CARRIER_COLOR} textAnchor="middle" fontWeight={700}>
            {fp.toFixed(1)}
          </text>
          <text x={xOf(fp - fm)} y={clampY(sidebandY) - 8}
            fontSize={10} fill={SIDEBAND_COLOR} textAnchor="middle" fontWeight={700}>
            {(fp - fm).toFixed(1)}
          </text>
          <text x={xOf(fp + fm)} y={clampY(sidebandY) - 8}
            fontSize={10} fill={SIDEBAND_COLOR} textAnchor="middle" fontWeight={700}>
            {(fp + fm).toFixed(1)}
          </text>
          <text x={x + w - 8} y={topY + 12}
            fontSize={9} fill="#54617A" textAnchor="end">
            {L('carrier_amp')} = 1 · {L('sideband_amp')} = m/2
          </text>
        </>
      ) : (
        <>
          <text x={xOf(fp)} y={clampY(carrierY) - 6}
            fontSize={10} fill={CARRIER_COLOR} textAnchor="middle">f_p</text>
          <text x={xOf(fp - fm)} y={clampY(sidebandY) - 6}
            fontSize={9} fill={SIDEBAND_COLOR} textAnchor="middle">f_p−f_m</text>
          <text x={xOf(fp + fm)} y={clampY(sidebandY) - 6}
            fontSize={9} fill={SIDEBAND_COLOR} textAnchor="middle">f_p+f_m</text>
        </>
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
// Panel aligned to the SVG scene box: top/bottom/right positions computed as
// (SVG_coord × 0.222rem) so both boxes share the same visual frame.
// Scene box: SVG x=40..570, y=60..400. Controls box: SVG x=590..770, y=60..400.
const rightPanelWrapperStyle: React.CSSProperties = {
  position: 'absolute',
  top: '9.7rem',        // title baseline at SVG y≈52 (matches scene title)
  bottom: '11.1rem',    // box bottom at SVG y=400
  right: '6.7rem',      // SVG x=770 (30 units gap to right edge)
  width: '40rem',       // SVG 180 units wide
  boxSizing: 'border-box',
  zIndex: 6,
  color: '#B9C4D6',
  fontFamily: "'JetBrains Mono', monospace",
  display: 'flex', flexDirection: 'column',
}
const rightPanelTitleStyle: React.CSSProperties = {
  fontSize: '2.44rem',                // matches SVG scene title fontSize=11
  color: '#6C7A93',
  letterSpacing: '0.1em',
  marginBottom: '1.2rem',
  marginLeft: '0.4rem',
}
const rightPanelBoxStyle: React.CSSProperties = {
  flex: 1,
  border: '1px solid #12203a', borderRadius: '0.6rem',
  padding: '2.5rem',
  display: 'flex', flexDirection: 'column', gap: '4rem',
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
