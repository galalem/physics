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

// ─── Scene constants ────────────────────────────────────────────────────
const W = 800
const H = 450

// Time-domain scope panel (left) — Stage 1 & 2 only
const TD_X = 32
const TD_Y = 60
const TD_W = 360
const TD_H = 200

// Magnitude spectrum panel — all stages. Shifts to center on Stage 3
// (time domain hidden per §4.7 blind-stage).
const SP_X_DEFAULT = 420
const SP_X_CENTER = 230
const SP_Y = 60
const SP_W = 340
const SP_H = 200

// Time-domain waveform display: 1-second window at f_0 = 2 Hz for
// Stages 1 & 2 (student not tuning f_0 there).
const F0_STAGES12 = 2
const T_WIN = 1
const TD_STEPS = 220

// Harmonic + rolloff DOFs
const HARMONIC_MAX = 7
const P_MIN = 0.5
const P_MAX = 2.5
const P_STEP = 0.1
const P_DEFAULT = 1.0

// Waveform families and their harmonic / rolloff signatures
type Family = 'sine' | 'square' | 'triangle' | 'sawtooth'

const FAMILY_SPEC: Record<Family, { harmonics: number[]; rolloff: number }> = {
  sine: { harmonics: [1], rolloff: 1.0 },
  square: { harmonics: [1, 3, 5, 7], rolloff: 1.0 },
  triangle: { harmonics: [1, 3, 5, 7], rolloff: 2.0 },
  sawtooth: { harmonics: [1, 2, 3, 4, 5, 6, 7], rolloff: 1.0 },
}

// Stage 2 targets — reconstruct-to-match. Rotates on seed.
const STAGE2_TARGETS: {
  harmonics: number[]
  rolloff: number
  family: Family
}[] = [
  { harmonics: [1, 3, 5, 7], rolloff: 1.0, family: 'square' },
  { harmonics: [1, 3, 5], rolloff: 2.0, family: 'triangle' },
  { harmonics: [1, 2, 3, 4, 5], rolloff: 1.0, family: 'sawtooth' },
  { harmonics: [1, 3, 5, 7], rolloff: 2.0, family: 'triangle' },
  { harmonics: [1], rolloff: 1.0, family: 'sine' },
]
const S2_P_TOL = 0.15

// Stage 3 blind targets — spectrum-only classification + f_0 read-off.
const STAGE3_TARGETS: { family: Family; f0: number }[] = [
  { family: 'square', f0: 2 },
  { family: 'triangle', f0: 3 },
  { family: 'sawtooth', f0: 2 },
  { family: 'sine', f0: 4 },
  { family: 'triangle', f0: 2 },
  { family: 'square', f0: 3 },
]
const S3_F0_TOL = 0.5
const S3_ATTEMPTS_PER_TARGET = 2

const dict = { en } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── Signal helpers ─────────────────────────────────────────────────────
function ampOf(n: number, rolloff: number): number {
  return 1 / Math.pow(n, rolloff)
}

function synthesize(t: number, active: Set<number>, rolloff: number, f0: number): number {
  let y = 0
  for (const n of active) {
    y += ampOf(n, rolloff) * Math.sin(2 * Math.PI * n * f0 * t)
  }
  return y
}

function timeSamples(active: Set<number>, rolloff: number, f0: number): number[] {
  const out = new Array<number>(TD_STEPS + 1)
  for (let i = 0; i <= TD_STEPS; i++) {
    out[i] = synthesize((i / TD_STEPS) * T_WIN, active, rolloff, f0)
  }
  return out
}

function peakOf(arr: number[]): number {
  let m = 0
  for (const v of arr) if (Math.abs(v) > m) m = Math.abs(v)
  return m
}

function tdPath(samples: number[], peak: number, x: number, y: number, w: number, h: number): string {
  if (samples.length === 0) return `M ${x} ${y + h / 2}`
  const denom = peak > 0 ? peak : 1
  let d = ''
  for (let i = 0; i < samples.length; i++) {
    const norm = samples[i]! / denom
    const sx = x + (i / (samples.length - 1)) * w
    const sy = y + h / 2 - norm * (h / 2 - 8)
    d += `${i === 0 ? 'M' : 'L'} ${sx.toFixed(1)} ${sy.toFixed(1)} `
  }
  return d
}

// ─── Component ──────────────────────────────────────────────────────────
export default function Scene() {
  const { locale, seed } = useInit()
  const stages = useMemo(() => getStagesFor(locale), [locale])
  useDeclareStages(stages)
  const labels = useMemo(() => svgLabels(locale), [locale])
  const rootRng = useSeed()

  // Seeded deterministic targets
  const stage2Target = useMemo(() => {
    void rootRng
    return STAGE2_TARGETS[seed % STAGE2_TARGETS.length]!
  }, [seed, rootRng])

  const stageIdx = useCurrentStage()
  const setStage = useSetStage()
  const progress = useProgress()
  const complete = useComplete()

  const [activeSet, setActiveSet] = useState<Set<number>>(() => new Set())
  const [rolloff, setRolloff] = useState(P_DEFAULT)
  const [toggleCount, setToggleCount] = useState(0)
  const [rolloffChanges, setRolloffChanges] = useState(0)

  const [s3TargetIdx, setS3TargetIdx] = useState(() => seed % STAGE3_TARGETS.length)
  const stage3Target = STAGE3_TARGETS[s3TargetIdx]!
  const [s3Family, setS3Family] = useState<Family | null>(null)
  const [s3F0Input, setS3F0Input] = useState('')
  const [s3Attempts, setS3Attempts] = useState(S3_ATTEMPTS_PER_TARGET)
  const [s3Passed, setS3Passed] = useState(false)
  const [s3Feedback, setS3Feedback] = useState<'ok' | 'no' | null>(null)

  const [peekText, setPeekText] = useState<string | null>(null)
  const peekIdxRef = useRef(0)

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  // ─── Match logic ──────────────────────────────────────────────────
  const s2TargetSet = useMemo(() => new Set(stage2Target.harmonics), [stage2Target])
  const setsEqual = useMemo(() => {
    if (activeSet.size !== s2TargetSet.size) return false
    for (const n of activeSet) if (!s2TargetSet.has(n)) return false
    return true
  }, [activeSet, s2TargetSet])
  const s2Match = setsEqual && Math.abs(rolloff - stage2Target.rolloff) <= S2_P_TOL

  const canSubmit = isStage1
    ? toggleCount >= 4 && rolloffChanges >= 2
    : isStage2
      ? s2Match
      : s3Passed

  useEffect(() => {
    progress(stageIdx / stages.length, { stage: stageIdx, canSubmit })
  }, [stageIdx, stages.length, canSubmit, progress])

  const clearHarmonicState = useCallback(() => {
    setActiveSet(new Set())
    setRolloff(P_DEFAULT)
    setToggleCount(0)
    setRolloffChanges(0)
  }, [])

  const resetAll = useCallback(() => {
    clearHarmonicState()
    setS3Family(null)
    setS3F0Input('')
    setS3Attempts(S3_ATTEMPTS_PER_TARGET)
    setS3Passed(false)
    setS3Feedback(null)
    setPeekText(null)
    peekIdxRef.current = 0
    setS3TargetIdx(seed % STAGE3_TARGETS.length)
  }, [clearHarmonicState, seed])

  useReset(resetAll)

  useNext(() => {
    if (stageIdx < stages.length) {
      setStage(stageIdx + 1)
      // Give each stage a clean canvas of harmonics/rolloff.
      clearHarmonicState()
    } else {
      complete({ success: true })
    }
  })

  // Peek — strategy hint rotation, never reveals the target.
  const PEEK_HINTS = useMemo(
    () => [labels.peek_hint_1, labels.peek_hint_2],
    [labels],
  )
  usePeek(() => {
    if (!isStage3) return
    setPeekText(PEEK_HINTS[peekIdxRef.current % PEEK_HINTS.length]!)
    peekIdxRef.current += 1
  })
  useEffect(() => {
    if (!peekText) return
    const t = setTimeout(() => setPeekText(null), 3500)
    return () => clearTimeout(t)
  }, [peekText])

  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  // ─── DOF handlers ─────────────────────────────────────────────────
  const toggleHarmonic = useCallback((n: number) => {
    setActiveSet((prev) => {
      const next = new Set(prev)
      if (next.has(n)) next.delete(n)
      else next.add(n)
      return next
    })
    setToggleCount((c) => c + 1)
  }, [])

  const onRolloffChange = useCallback(
    (v: number) => {
      setRolloff((prev) => {
        if (Math.abs(v - prev) > 1e-6) setRolloffChanges((c) => c + 1)
        return v
      })
    },
    [],
  )

  // ─── Waveform paths (time-domain, Stages 1 & 2) ───────────────────
  const studentTimeSamples = useMemo(
    () => timeSamples(activeSet, rolloff, F0_STAGES12),
    [activeSet, rolloff],
  )
  const studentPeak = useMemo(() => peakOf(studentTimeSamples), [studentTimeSamples])
  const studentTDPath = useMemo(
    () => tdPath(studentTimeSamples, studentPeak, TD_X, TD_Y, TD_W, TD_H),
    [studentTimeSamples, studentPeak],
  )

  const targetTimeSamples = useMemo(
    () => timeSamples(s2TargetSet, stage2Target.rolloff, F0_STAGES12),
    [s2TargetSet, stage2Target.rolloff],
  )
  const targetPeak = useMemo(() => peakOf(targetTimeSamples), [targetTimeSamples])
  const targetTDPath = useMemo(
    () => tdPath(targetTimeSamples, targetPeak, TD_X, TD_Y, TD_W, TD_H),
    [targetTimeSamples, targetPeak],
  )

  // ─── Spectrum geometry ─────────────────────────────────────────────
  const spX = isStage3 ? SP_X_CENTER : SP_X_DEFAULT
  const barSlotW = SP_W / HARMONIC_MAX
  const barW = barSlotW * 0.55
  const barBaseY = SP_Y + SP_H - 26
  const barMaxH = SP_H - 46

  const studentBarAmps = useMemo(() => {
    const out: number[] = []
    for (let n = 1; n <= HARMONIC_MAX; n++) {
      out.push(activeSet.has(n) ? ampOf(n, rolloff) : 0)
    }
    return out
  }, [activeSet, rolloff])

  const targetBarAmpsS2 = useMemo(() => {
    const out: number[] = []
    for (let n = 1; n <= HARMONIC_MAX; n++) {
      out.push(s2TargetSet.has(n) ? ampOf(n, stage2Target.rolloff) : 0)
    }
    return out
  }, [s2TargetSet, stage2Target.rolloff])

  const s3Spec = FAMILY_SPEC[stage3Target.family]
  const s3TargetSet = useMemo(() => new Set(s3Spec.harmonics), [s3Spec])
  const targetBarAmpsS3 = useMemo(() => {
    const out: number[] = []
    for (let n = 1; n <= HARMONIC_MAX; n++) {
      out.push(s3TargetSet.has(n) ? ampOf(n, s3Spec.rolloff) : 0)
    }
    return out
  }, [s3TargetSet, s3Spec])

  // ─── Stage 3 submit grading ────────────────────────────────────────
  const handleSubmitS3 = useCallback(() => {
    if (s3Feedback !== null || s3Passed) return
    if (s3Family === null || s3F0Input.trim() === '') return
    const f0Guess = Number(s3F0Input)
    const familyOk = s3Family === stage3Target.family
    const f0Ok = Number.isFinite(f0Guess) && Math.abs(f0Guess - stage3Target.f0) <= S3_F0_TOL
    if (familyOk && f0Ok) {
      setS3Passed(true)
      setS3Feedback('ok')
      setTimeout(() => setS3Feedback(null), 1200)
    } else {
      setS3Feedback('no')
      setTimeout(() => {
        setS3Feedback(null)
        setS3Attempts((prev) => {
          const next = prev - 1
          if (next <= 0) {
            // Strike-out: reseed the target and reset attempts.
            setS3TargetIdx((i) => (i + 1) % STAGE3_TARGETS.length)
            setS3Family(null)
            setS3F0Input('')
            return S3_ATTEMPTS_PER_TARGET
          }
          return next
        })
      }, 900)
    }
  }, [s3F0Input, s3Family, s3Feedback, s3Passed, stage3Target])

  // ─── HUD strings ───────────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`
  const hudTR = isStage1
    ? `on ${activeSet.size}/${HARMONIC_MAX} · p = ${rolloff.toFixed(1)}`
    : isStage2
      ? s2Match
        ? `✓ ${labels.match_ok}`
        : `on ${activeSet.size}/${HARMONIC_MAX} · p = ${rolloff.toFixed(1)}`
      : s3Passed
        ? `✓ ${labels.correct}`
        : `${labels.attempts_left}: ${s3Attempts}`
  // Secondary TR line — feedback and mid-progress cues, never in BR.
  const hudTR2 = isStage2 && !s2Match && setsEqual
    ? `set ok · tune p`
    : isStage3 && s3Feedback === 'no'
      ? `✗ ${labels.wrong}`
      : ''
  const hudBL = isStage1 ? labels.tip1 : isStage2 ? labels.tip2 : labels.tip3

  const hudTR2Color = s3Feedback === 'no' ? '#EF476F' : '#6C7A93'

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block', userSelect: 'none' }}
      >
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        {/* ─── Time-domain scope — Stages 1 & 2 only ──────────────── */}
        {!isStage3 && (
          <g>
            <rect
              x={TD_X - 8}
              y={TD_Y - 8}
              width={TD_W + 16}
              height={TD_H + 16}
              fill="none"
              stroke={isStage2 && s2Match ? '#37C9B8' : '#12203a'}
              strokeWidth={isStage2 && s2Match ? 1.5 : 1}
              rx={6}
            />
            <text
              x={TD_X}
              y={TD_Y - 12}
              fill="#6C7A93"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={11}
              letterSpacing="0.1em"
            >
              {labels.time_domain}
            </text>
            <line
              x1={TD_X}
              y1={TD_Y + TD_H / 2}
              x2={TD_X + TD_W}
              y2={TD_Y + TD_H / 2}
              stroke="#3A4863"
              strokeWidth={1}
            />
            {isStage2 && (
              <path
                d={targetTDPath}
                fill="none"
                stroke="#F97316"
                strokeWidth={1.8}
                opacity={0.75}
                strokeDasharray="4 3"
              />
            )}
            {activeSet.size > 0 && (
              <path d={studentTDPath} fill="none" stroke="#37C9B8" strokeWidth={2} />
            )}
          </g>
        )}

        {/* ─── Magnitude spectrum panel ───────────────────────────── */}
        <g>
          <rect
            x={spX - 8}
            y={SP_Y - 8}
            width={SP_W + 16}
            height={SP_H + 16}
            fill="none"
            stroke="#12203a"
            strokeWidth={1}
            rx={6}
          />
          <text
            x={spX}
            y={SP_Y - 12}
            fill="#6C7A93"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={11}
            letterSpacing="0.1em"
          >
            {labels.spectrum}
          </text>
          <line
            x1={spX}
            y1={barBaseY}
            x2={spX + SP_W}
            y2={barBaseY}
            stroke="#3A4863"
            strokeWidth={1}
          />
          {Array.from({ length: HARMONIC_MAX }).map((_, i) => {
            const n = i + 1
            const cx = spX + barSlotW * (n - 0.5)
            const bx = cx - barW / 2
            const showTargetOverlay = isStage2
            const targetAmp = isStage3 ? targetBarAmpsS3[i]! : targetBarAmpsS2[i]!
            const studentAmp = studentBarAmps[i]!
            const targetH = targetAmp * barMaxH
            const studentH = studentAmp * barMaxH
            const f0ForLabel = isStage3 ? stage3Target.f0 : F0_STAGES12
            const freqLabel = `${(n * f0ForLabel).toFixed(0)}`

            return (
              <g key={`bar-${n}`}>
                {/* Stage 2: target bar outline drawn behind student bar */}
                {showTargetOverlay && targetAmp > 0.001 && (
                  <rect
                    x={bx}
                    y={barBaseY - targetH}
                    width={barW}
                    height={targetH}
                    fill="none"
                    stroke="#F97316"
                    strokeWidth={1.5}
                    strokeDasharray="3 2"
                  />
                )}
                {/* Student bar (Stage 1 & 2) */}
                {!isStage3 && studentAmp > 0.001 && (
                  <rect
                    x={bx + 2}
                    y={barBaseY - studentH}
                    width={barW - 4}
                    height={studentH}
                    fill="#37C9B8"
                    opacity={0.85}
                  />
                )}
                {/* Stage 3: target bar solid amber (required info) */}
                {isStage3 && targetAmp > 0.001 && (
                  <rect
                    x={bx + 2}
                    y={barBaseY - targetH}
                    width={barW - 4}
                    height={targetH}
                    fill="#F9A968"
                    opacity={0.9}
                  />
                )}
                {/* Frequency label under each bar slot (required info) */}
                <text
                  x={cx}
                  y={barBaseY + 14}
                  fill="#6C7A93"
                  fontFamily="'JetBrains Mono', monospace"
                  fontSize={10}
                  textAnchor="middle"
                >
                  {freqLabel}
                </text>
                {/* Harmonic index reference */}
                <text
                  x={cx}
                  y={barBaseY + 26}
                  fill="#3A4863"
                  fontFamily="'JetBrains Mono', monospace"
                  fontSize={8}
                  textAnchor="middle"
                >
                  {`${n}f0`}
                </text>
              </g>
            )
          })}
          {/* Unit hint */}
          <text
            x={spX + SP_W}
            y={SP_Y - 12}
            fill="#3A4863"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={9}
            textAnchor="end"
          >
            Hz
          </text>
        </g>
      </svg>

      {/* ─── HUD overlays (TL / TR / BL only — BR reserved) ──────── */}
      <div
        style={{
          position: 'absolute',
          top: '3rem',
          left: '3rem',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '2.3rem',
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: '#6C7A93',
          zIndex: 5,
          pointerEvents: 'none',
        }}
      >
        {hudTL}
      </div>
      <div
        style={{
          position: 'absolute',
          top: '3rem',
          right: '3rem',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '2.3rem',
          letterSpacing: '0.08em',
          color: '#37C9B8',
          zIndex: 5,
          pointerEvents: 'none',
          textAlign: 'right',
        }}
      >
        <div>{hudTR}</div>
        {hudTR2 && (
          <div
            style={{
              fontSize: '1.8rem',
              marginTop: '0.4rem',
              color: hudTR2Color,
            }}
          >
            {hudTR2}
          </div>
        )}
      </div>
      <div
        style={{
          position: 'absolute',
          bottom: '3rem',
          left: '3rem',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '2.3rem',
          letterSpacing: '0.06em',
          color: '#6C7A93',
          zIndex: 5,
          pointerEvents: 'none',
          maxWidth: '54%',
        }}
      >
        {hudBL}
      </div>

      {/* ─── Stage 1 & 2: harmonic row + rolloff slider ──────────── */}
      {!isStage3 && (
        <>
          {/* Rolloff slider — horizontal, spans mid-canvas width */}
          <div
            style={{
              position: 'absolute',
              bottom: '22rem',
              left: '3rem',
              width: 'calc(100% - 6rem)',
              display: 'flex',
              alignItems: 'center',
              gap: '1.5rem',
              fontFamily: "'JetBrains Mono', monospace",
              zIndex: 6,
            }}
          >
            <div style={{ fontSize: '1.6rem', color: '#6C7A93', minWidth: '11rem' }}>
              {labels.rolloff}
            </div>
            <input
              type="range"
              min={P_MIN}
              max={P_MAX}
              step={P_STEP}
              value={rolloff}
              onChange={(e) => onRolloffChange(Number(e.target.value))}
              style={{
                flex: 1,
                accentColor: '#37C9B8',
                cursor: 'pointer',
              }}
            />
            <div style={{ fontSize: '1.6rem', color: '#37C9B8', minWidth: '7rem' }}>
              p = {rolloff.toFixed(1)}
            </div>
          </div>

          {/* Harmonic toggle row */}
          <div
            style={{
              position: 'absolute',
              bottom: '10rem',
              left: '50%',
              transform: 'translateX(-50%)',
              display: 'flex',
              gap: '1rem',
              zIndex: 6,
            }}
          >
            {Array.from({ length: HARMONIC_MAX }).map((_, i) => {
              const n = i + 1
              const on = activeSet.has(n)
              return (
                <button
                  key={n}
                  type="button"
                  onClick={() => toggleHarmonic(n)}
                  style={{
                    padding: '1rem 1.4rem',
                    background: on ? '#37C9B8' : '#12203a',
                    color: on ? '#0D1524' : '#EAF0FA',
                    border: `1.5px solid ${on ? '#37C9B8' : '#3A4863'}`,
                    borderRadius: '0.8rem',
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: '1.7rem',
                    cursor: 'pointer',
                    minWidth: '5rem',
                    fontWeight: 600,
                  }}
                >
                  {`${n}×`}
                </button>
              )
            })}
          </div>
        </>
      )}

      {/* ─── Stage 3: family MCQ + f_0 input + submit ────────────── */}
      {isStage3 && (
        <div
          style={{
            position: 'absolute',
            bottom: '6rem',
            left: '3rem',
            maxWidth: '42rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '1.2rem',
            fontFamily: "'JetBrains Mono', monospace",
            zIndex: 6,
          }}
        >
          <div style={{ fontSize: '1.7rem', color: '#6C7A93', letterSpacing: '0.1em' }}>
            {labels.family_prompt}
          </div>
          <div style={{ display: 'flex', gap: '0.8rem', flexWrap: 'wrap' }}>
            {(['sine', 'square', 'triangle', 'sawtooth'] as Family[]).map((f) => {
              const on = s3Family === f
              return (
                <button
                  key={f}
                  type="button"
                  onClick={() => !s3Passed && setS3Family(f)}
                  disabled={s3Passed}
                  style={{
                    padding: '0.9rem 1.3rem',
                    background: on ? '#37C9B8' : '#12203a',
                    color: on ? '#0D1524' : '#EAF0FA',
                    border: `1.5px solid ${on ? '#37C9B8' : '#3A4863'}`,
                    borderRadius: '0.8rem',
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: '1.6rem',
                    cursor: s3Passed ? 'default' : 'pointer',
                    minWidth: '8rem',
                    fontWeight: 600,
                  }}
                >
                  {labels[f]}
                </button>
              )
            })}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginTop: '0.4rem' }}>
            <div style={{ fontSize: '1.7rem', color: '#6C7A93' }}>{labels.f0_prompt}</div>
            <input
              type="number"
              value={s3F0Input}
              onChange={(e) => setS3F0Input(e.target.value)}
              disabled={s3Passed}
              step={0.1}
              style={{
                width: '9rem',
                padding: '0.7rem 1rem',
                background: '#12203a',
                color: '#EAF0FA',
                border: '1.5px solid #3A4863',
                borderRadius: '0.6rem',
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '1.6rem',
              }}
            />
            <button
              type="button"
              onClick={handleSubmitS3}
              disabled={
                s3Passed ||
                s3Family === null ||
                s3F0Input.trim() === '' ||
                s3Feedback !== null
              }
              style={{
                padding: '0.9rem 1.6rem',
                background: '#F9A968',
                color: '#0D1524',
                border: 'none',
                borderRadius: '0.6rem',
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '1.6rem',
                fontWeight: 700,
                cursor:
                  s3Passed || s3Family === null || s3F0Input.trim() === ''
                    ? 'default'
                    : 'pointer',
                opacity:
                  s3Passed || s3Family === null || s3F0Input.trim() === '' ? 0.5 : 1,
                letterSpacing: '0.1em',
              }}
            >
              {labels.submit}
            </button>
          </div>
          {peekText && (
            <div
              style={{
                marginTop: '0.4rem',
                padding: '0.9rem 1.2rem',
                background: 'rgba(249,115,22,0.12)',
                border: '1px solid #F97316',
                borderRadius: '0.6rem',
                color: '#F9A968',
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '1.5rem',
                maxWidth: '42rem',
              }}
            >
              {peekText}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
