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
  useSeed,
} from '@physics/sdk/react'
import { getHintFor, getStagesFor } from './stages'
import en from '../i18n/en.json'
import fr from '../i18n/fr.json'
import ar from '../i18n/ar.json'

// ─── Scene constants ────────────────────────────────────────────────────
const W = 800
const H = 450

// Stage 1: 3 stacked mini-scopes
const SCOPE_X = 32
const SCOPE_W = 460
const SCOPE_TOP = 60
const SCOPE_H = 110
const SCOPE_GAP = 10

// Stage 2: single waveform card
const CARD_X = 60
const CARD_Y = 80
const CARD_W = 680
const CARD_H = 220

// Stage 3: two stacked scopes (target above, student below)
const S3_X = 32
const S3_W = 460
const S3_TARGET_Y = 60
const S3_STUDENT_Y = 220
const S3_SCOPE_H = 140

// Signal parameters
const F0 = 2 // Hz — source sine frequency (fixed)
const T_WIN = 1 // seconds visible per scope

// Sample-rate slider (Hz)
const FS_MIN = 1
const FS_MAX = 20
const FS_DEFAULT = 8

// Bit-depth slider
const N_MIN = 1
const N_MAX = 6
const N_DEFAULT = 3

// Stage 3 seeded targets
const STAGE3_TARGETS: { fsStar: number; nStar: number }[] = [
  { fsStar: 6, nStar: 2 },
  { fsStar: 10, nStar: 3 },
  { fsStar: 4, nStar: 4 },
  { fsStar: 12, nStar: 2 },
  { fsStar: 8, nStar: 5 },
]
const S3_FS_TOL = 0.5 // Hz

// Stage 2 waveform bank
type Bin = 'analog' | 'logic' | 'numeric'
type WaveKind = 'sine' | 'triangle' | 'damped' | 'square' | 'clock' | 'staircase' | 'sawtooth-staircase'

const WAVE_BANK: { kind: WaveKind; bin: Bin }[] = [
  { kind: 'sine', bin: 'analog' },
  { kind: 'triangle', bin: 'analog' },
  { kind: 'damped', bin: 'analog' },
  { kind: 'square', bin: 'logic' },
  { kind: 'clock', bin: 'logic' },
  { kind: 'staircase', bin: 'numeric' },
  { kind: 'sawtooth-staircase', bin: 'numeric' },
]

const dict = { en, fr, ar } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── Signal helpers ─────────────────────────────────────────────────────
function source(t: number): number {
  return Math.sin(2 * Math.PI * F0 * t)
}

function quantize(v: number, n: number): number {
  const levels = Math.pow(2, n) - 1
  if (levels <= 0) return v > 0 ? 1 : -1
  const norm = (v + 1) / 2
  const q = Math.round(norm * levels) / levels
  return q * 2 - 1
}

function numericSamples(fs: number, n: number): { t: number; v: number }[] {
  const out: { t: number; v: number }[] = []
  const dt = 1 / fs
  for (let t = 0; t <= T_WIN + 1e-9; t += dt) {
    out.push({ t, v: quantize(source(t), n) })
  }
  return out
}

function logicSignal(t: number): number {
  return source(t) > 0 ? 1 : -1
}

function waveFn(kind: WaveKind): (t: number) => number {
  switch (kind) {
    case 'sine':
      return (t) => Math.sin(2 * Math.PI * 2 * t)
    case 'triangle':
      return (t) => {
        const p = (t * 2) % 1
        return p < 0.5 ? 4 * p - 1 : 3 - 4 * p
      }
    case 'damped':
      return (t) => Math.exp(-1.4 * t) * Math.sin(2 * Math.PI * 3 * t)
    case 'square':
      return (t) => (Math.sin(2 * Math.PI * 2 * t) > 0 ? 1 : -1)
    case 'clock':
      return (t) => (((t * 4) % 1) < 0.5 ? 1 : -1)
    case 'staircase':
      return (t) => quantize(Math.sin(2 * Math.PI * 2 * t), 2)
    case 'sawtooth-staircase':
      return (t) => quantize(((t * 2) % 1) * 2 - 1, 2)
  }
}

function kindOf(kind: WaveKind): Bin {
  if (kind === 'square' || kind === 'clock') return 'logic'
  if (kind === 'staircase' || kind === 'sawtooth-staircase') return 'numeric'
  return 'analog'
}

// ─── Component ──────────────────────────────────────────────────────────
export default function Scene() {
  const { locale, seed } = useInit()
  const stages = useMemo(() => getStagesFor(locale), [locale])
  useDeclareStages(stages)
  const labels = useMemo(() => svgLabels(locale), [locale])
  const rootRng = useSeed()

  const stage2Queue = useMemo<{ kind: WaveKind; bin: Bin }[]>(() => {
    void rootRng
    const indices = [0, 1, 2, 3, 4, 5, 6]
    const rot = seed % indices.length
    const rotated = [...indices.slice(rot), ...indices.slice(0, rot)]
    return rotated.slice(0, 5).map((i) => WAVE_BANK[i]!)
  }, [seed, rootRng])

  const stage3Target = useMemo(() => {
    return STAGE3_TARGETS[seed % STAGE3_TARGETS.length]!
  }, [seed])

  const stageIdx = useCurrentStage()
  const [fs, setFs] = useState(FS_DEFAULT)
  const [nBits, setNBits] = useState(N_DEFAULT)
  const [fsChanges, setFsChanges] = useState(0)
  const [nChanges, setNChanges] = useState(0)
  const [q2Idx, setQ2Idx] = useState(0)
  const [q2Correct, setQ2Correct] = useState(0)
  const [q2Feedback, setQ2Feedback] = useState<'ok' | 'no' | null>(null)
  const [peekVisible, setPeekVisible] = useState(false)

  const setStage = useSetStage()
  const progress = useProgress()
  const complete = useComplete()

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  const resetStageState = useCallback(() => {
    setFs(FS_DEFAULT)
    setNBits(N_DEFAULT)
    setFsChanges(0)
    setNChanges(0)
    setQ2Idx(0)
    setQ2Correct(0)
    setQ2Feedback(null)
    setPeekVisible(false)
  }, [])

  const s3Match =
    Math.abs(fs - stage3Target.fsStar) <= S3_FS_TOL &&
    nBits === stage3Target.nStar

  const canSubmit = isStage1
    ? fsChanges >= 2 && nChanges >= 2
    : isStage2
      ? q2Correct >= stage2Queue.length
      : s3Match

  useEffect(() => {
    progress(stageIdx / 3, { stage: stageIdx, canSubmit })
  }, [stageIdx, canSubmit, progress])

  useReset(resetStageState)

  useNext(() => {
    if (stageIdx < 3) {
      setStage(stageIdx + 1)
      resetStageState()
    } else {
      complete({ success: true })
    }
  })

  usePeek(() => {
    if (!isStage3) return
    setPeekVisible(true)
  })
  useEffect(() => {
    if (!peekVisible) return
    const t = setTimeout(() => setPeekVisible(false), 1500)
    return () => clearTimeout(t)
  }, [peekVisible])

  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  // ─── Scope path builders ──────────────────────────────────────────────
  function analogPath(x: number, y: number, w: number, h: number, fn: (t: number) => number, steps = 200): string {
    let d = ''
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * T_WIN
      const sx = x + (t / T_WIN) * w
      const sy = y + h / 2 - fn(t) * (h / 2 - 6)
      d += `${i === 0 ? 'M' : 'L'} ${sx.toFixed(1)} ${sy.toFixed(1)} `
    }
    return d
  }

  function staircasePath(x: number, y: number, w: number, h: number, samples: { t: number; v: number }[]): string {
    if (samples.length === 0) return ''
    let d = ''
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i]!
      const nextT = i + 1 < samples.length ? samples[i + 1]!.t : T_WIN
      const sx1 = x + (s.t / T_WIN) * w
      const sx2 = x + (nextT / T_WIN) * w
      const sy = y + h / 2 - s.v * (h / 2 - 6)
      d += `${i === 0 ? 'M' : 'L'} ${sx1.toFixed(1)} ${sy.toFixed(1)} L ${sx2.toFixed(1)} ${sy.toFixed(1)} `
    }
    return d
  }

  function logicPath(x: number, y: number, w: number, h: number, fn: (t: number) => number, steps = 400): string {
    let d = ''
    let prevV = fn(0) > 0 ? 1 : -1
    const startY = y + h / 2 - prevV * (h / 2 - 6)
    d += `M ${x.toFixed(1)} ${startY.toFixed(1)} `
    for (let i = 1; i <= steps; i++) {
      const t = (i / steps) * T_WIN
      const v = fn(t) > 0 ? 1 : -1
      const sx = x + (t / T_WIN) * w
      if (v !== prevV) {
        const midY = y + h / 2 - prevV * (h / 2 - 6)
        d += `L ${sx.toFixed(1)} ${midY.toFixed(1)} `
        prevV = v
      }
      const sy = y + h / 2 - v * (h / 2 - 6)
      d += `L ${sx.toFixed(1)} ${sy.toFixed(1)} `
    }
    return d
  }

  const s1Analog = useMemo(
    () => analogPath(SCOPE_X, SCOPE_TOP, SCOPE_W, SCOPE_H, source),
    [],
  )
  const s1Samples = useMemo(() => numericSamples(fs, nBits), [fs, nBits])
  const s1Numeric = useMemo(
    () => staircasePath(SCOPE_X, SCOPE_TOP + (SCOPE_H + SCOPE_GAP), SCOPE_W, SCOPE_H, s1Samples),
    [s1Samples],
  )
  const s1Logic = useMemo(
    () => logicPath(SCOPE_X, SCOPE_TOP + 2 * (SCOPE_H + SCOPE_GAP), SCOPE_W, SCOPE_H, logicSignal),
    [],
  )
  const s1AnalogGhost = useMemo(
    () => analogPath(SCOPE_X, SCOPE_TOP + (SCOPE_H + SCOPE_GAP), SCOPE_W, SCOPE_H, source),
    [],
  )

  const s3TargetSamples = useMemo(
    () => numericSamples(stage3Target.fsStar, stage3Target.nStar),
    [stage3Target],
  )
  const s3TargetPath = useMemo(
    () => staircasePath(S3_X, S3_TARGET_Y, S3_W, S3_SCOPE_H, s3TargetSamples),
    [s3TargetSamples],
  )
  const s3StudentPath = useMemo(
    () => staircasePath(S3_X, S3_STUDENT_Y, S3_W, S3_SCOPE_H, s1Samples),
    [s1Samples],
  )
  const s3AnalogGhostTarget = useMemo(
    () => analogPath(S3_X, S3_TARGET_Y, S3_W, S3_SCOPE_H, source),
    [],
  )
  const s3AnalogGhostStudent = useMemo(
    () => analogPath(S3_X, S3_STUDENT_Y, S3_W, S3_SCOPE_H, source),
    [],
  )

  const q2Wave = stage2Queue[q2Idx]
  const stage2Path = useMemo(() => {
    if (!q2Wave) return ''
    const fn = waveFn(q2Wave.kind)
    const k = kindOf(q2Wave.kind)
    if (k === 'logic') return logicPath(CARD_X, CARD_Y, CARD_W, CARD_H, fn)
    if (k === 'numeric') {
      const steps = 8
      const samples: { t: number; v: number }[] = []
      for (let i = 0; i <= steps; i++) {
        samples.push({ t: (i / steps) * T_WIN, v: fn((i / steps) * T_WIN) })
      }
      return staircasePath(CARD_X, CARD_Y, CARD_W, CARD_H, samples)
    }
    return analogPath(CARD_X, CARD_Y, CARD_W, CARD_H, fn)
  }, [q2Wave])

  const nyquistOk = fs >= 2 * F0
  const nyquistWarnColor = nyquistOk ? '#37C9B8' : '#F97316'

  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`
  const hudTR = isStage1
    ? `f_s = ${fs} Hz · N = ${nBits} bits`
    : isStage2
      ? `${labels.progress} ${q2Correct} / ${stage2Queue.length}`
      : peekVisible
        ? `${labels.peek_reveal} f_s* = ${stage3Target.fsStar} Hz · N* = ${stage3Target.nStar}`
        : s3Match
          ? `✓ ${labels.match_ok}`
          : `f_s = ${fs} Hz · N = ${nBits} bits`
  const hudBL = isStage1 ? labels.tip1 : isStage2 ? labels.tip2 : labels.tip3
  const hudBR = isStage1
    ? `${nyquistOk ? '✓' : '✗'} f_s ≥ 2·f_0 = ${2 * F0} Hz`
    : isStage2
      ? q2Feedback === 'ok'
        ? `✓ ${labels.correct}`
        : q2Feedback === 'no'
          ? `✗ ${labels.wrong}`
          : ''
      : ''

  const handleClassify = useCallback(
    (bin: Bin) => {
      if (!q2Wave) return
      if (q2Feedback) return
      if (bin === q2Wave.bin) {
        setQ2Feedback('ok')
        setTimeout(() => {
          setQ2Feedback(null)
          setQ2Correct((c) => c + 1)
          if (q2Idx + 1 < stage2Queue.length) setQ2Idx((i) => i + 1)
        }, 700)
      } else {
        setQ2Feedback('no')
        setTimeout(() => setQ2Feedback(null), 900)
      }
    },
    [q2Wave, q2Feedback, q2Idx, stage2Queue.length],
  )

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block', borderRadius: 14, userSelect: 'none' }}
      >
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" rx={14} />

        {/* ─── STAGE 1: three stacked scopes ──────────────────────────── */}
        {isStage1 &&
          (['analog', 'numeric', 'logic'] as const).map((kind, idx) => {
            const y = SCOPE_TOP + idx * (SCOPE_H + SCOPE_GAP)
            const mid = y + SCOPE_H / 2
            const title =
              kind === 'analog' ? labels.analog : kind === 'numeric' ? labels.numeric : labels.logic
            const path = kind === 'analog' ? s1Analog : kind === 'numeric' ? s1Numeric : s1Logic
            const color = kind === 'analog' ? '#37C9B8' : kind === 'numeric' ? '#F9A968' : '#EAF0FA'
            return (
              <g key={kind}>
                <rect
                  x={SCOPE_X - 8}
                  y={y - 8}
                  width={SCOPE_W + 16}
                  height={SCOPE_H + 16}
                  fill="none"
                  stroke="#12203a"
                  strokeWidth={1}
                  rx={6}
                />
                <text
                  x={SCOPE_X}
                  y={y - 12}
                  fill="#6C7A93"
                  fontFamily="'JetBrains Mono', monospace"
                  fontSize={11}
                  letterSpacing="0.1em"
                >
                  {title}
                </text>
                <line x1={SCOPE_X} y1={mid} x2={SCOPE_X + SCOPE_W} y2={mid} stroke="#3A4863" strokeWidth={1} />
                {kind === 'numeric' && (
                  <path d={s1AnalogGhost} fill="none" stroke="#37C9B8" strokeWidth={1} opacity={0.25} strokeDasharray="3 3" />
                )}
                <path d={path} fill="none" stroke={color} strokeWidth={kind === 'analog' ? 2 : 1.8} />
                {kind === 'numeric' &&
                  s1Samples.map((s, i) => (
                    <circle
                      key={`smp${i}`}
                      cx={SCOPE_X + (s.t / T_WIN) * SCOPE_W}
                      cy={y + SCOPE_H / 2 - s.v * (SCOPE_H / 2 - 6)}
                      r={2.4}
                      fill={color}
                    />
                  ))}
              </g>
            )
          })}

        {/* ─── STAGE 2: single big waveform card ──────────────────────── */}
        {isStage2 && q2Wave && (
          <>
            <rect
              x={CARD_X - 8}
              y={CARD_Y - 8}
              width={CARD_W + 16}
              height={CARD_H + 16}
              fill="none"
              stroke={q2Feedback === 'ok' ? '#37C9B8' : q2Feedback === 'no' ? '#EF476F' : '#12203a'}
              strokeWidth={1.5}
              rx={6}
            />
            <text
              x={CARD_X}
              y={CARD_Y - 12}
              fill="#6C7A93"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={11}
              letterSpacing="0.1em"
            >
              {labels.classify}
            </text>
            <line
              x1={CARD_X}
              y1={CARD_Y + CARD_H / 2}
              x2={CARD_X + CARD_W}
              y2={CARD_Y + CARD_H / 2}
              stroke="#3A4863"
              strokeWidth={1}
            />
            <path d={stage2Path} fill="none" stroke="#37C9B8" strokeWidth={2.2} />
          </>
        )}

        {/* ─── STAGE 3: target + student scopes stacked ───────────────── */}
        {isStage3 && (
          <>
            {(
              [
                { y: S3_TARGET_Y, title: labels.target, path: s3TargetPath, ghost: s3AnalogGhostTarget, samples: s3TargetSamples, color: '#F97316' },
                { y: S3_STUDENT_Y, title: labels.yours, path: s3StudentPath, ghost: s3AnalogGhostStudent, samples: s1Samples, color: s3Match ? '#37C9B8' : '#F9A968' },
              ] as const
            ).map((s, i) => (
              <g key={`s3-${i}`}>
                <rect
                  x={S3_X - 8}
                  y={s.y - 8}
                  width={S3_W + 16}
                  height={S3_SCOPE_H + 16}
                  fill="none"
                  stroke={i === 1 && s3Match ? '#37C9B8' : '#12203a'}
                  strokeWidth={i === 1 && s3Match ? 1.5 : 1}
                  rx={6}
                />
                <text
                  x={S3_X}
                  y={s.y - 12}
                  fill="#6C7A93"
                  fontFamily="'JetBrains Mono', monospace"
                  fontSize={11}
                  letterSpacing="0.1em"
                >
                  {s.title}
                </text>
                <line
                  x1={S3_X}
                  y1={s.y + S3_SCOPE_H / 2}
                  x2={S3_X + S3_W}
                  y2={s.y + S3_SCOPE_H / 2}
                  stroke="#3A4863"
                  strokeWidth={1}
                />
                <path d={s.ghost} fill="none" stroke="#37C9B8" strokeWidth={1} opacity={0.2} strokeDasharray="3 3" />
                <path d={s.path} fill="none" stroke={s.color} strokeWidth={2} />
                {s.samples.map((sm, j) => (
                  <circle
                    key={`s3d${i}-${j}`}
                    cx={S3_X + (sm.t / T_WIN) * S3_W}
                    cy={s.y + S3_SCOPE_H / 2 - sm.v * (S3_SCOPE_H / 2 - 6)}
                    r={2.4}
                    fill={s.color}
                  />
                ))}
              </g>
            ))}
          </>
        )}
      </svg>

      {/* ─── HUD overlays ────────────────────────────────────────────── */}
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
        {hudTR}
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
          maxWidth: '48%',
        }}
      >
        {hudBL}
      </div>
      {hudBR && (
        <div
          style={{
            position: 'absolute',
            bottom: '3rem',
            right: '3rem',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '2.3rem',
            letterSpacing: '0.08em',
            color: isStage1 ? nyquistWarnColor : '#37C9B8',
            textAlign: 'right',
            zIndex: 5,
            pointerEvents: 'none',
          }}
        >
          {hudBR}
        </div>
      )}

      {/* ─── Stage 1 & 3 controls: f_s and N vertical sliders ───────── */}
      {(isStage1 || isStage3) && (
        <div
          style={{
            position: 'absolute',
            top: '6rem',
            right: '3rem',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '2rem',
            zIndex: 6,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.6rem' }}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.6rem', color: '#6C7A93' }}>
              {FS_MAX}
            </div>
            <div style={{ width: '2rem', height: '13rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <input
                type="range"
                min={FS_MIN}
                max={FS_MAX}
                step={1}
                value={fs}
                onChange={(e) => {
                  const next = Number(e.target.value)
                  setFs((prev) => {
                    if (next !== prev) setFsChanges((n) => n + 1)
                    return next
                  })
                }}
                style={{
                  width: '13rem',
                  height: '2rem',
                  transform: 'rotate(-90deg)',
                  transformOrigin: 'center',
                  accentColor: '#37C9B8',
                  cursor: 'pointer',
                }}
              />
            </div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.6rem', color: '#6C7A93' }}>
              {FS_MIN}
            </div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.6rem', color: '#37C9B8' }}>
              f_s = {fs} Hz
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.6rem' }}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.6rem', color: '#6C7A93' }}>
              {N_MAX}
            </div>
            <div style={{ width: '2rem', height: '13rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <input
                type="range"
                min={N_MIN}
                max={N_MAX}
                step={1}
                value={nBits}
                onChange={(e) => {
                  const next = Number(e.target.value)
                  setNBits((prev) => {
                    if (next !== prev) setNChanges((n) => n + 1)
                    return next
                  })
                }}
                style={{
                  width: '13rem',
                  height: '2rem',
                  transform: 'rotate(-90deg)',
                  transformOrigin: 'center',
                  accentColor: '#37C9B8',
                  cursor: 'pointer',
                }}
              />
            </div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.6rem', color: '#6C7A93' }}>
              {N_MIN}
            </div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.6rem', color: '#37C9B8' }}>
              N = {nBits} bits
            </div>
          </div>
        </div>
      )}

      {/* ─── Stage 2: 3 bin buttons ─────────────────────────────────── */}
      {isStage2 && (
        <div
          style={{
            position: 'absolute',
            bottom: '10rem',
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            gap: '2rem',
            zIndex: 10,
          }}
        >
          {(['analog', 'logic', 'numeric'] as Bin[]).map((b) => (
            <button
              key={b}
              type="button"
              onClick={() => handleClassify(b)}
              disabled={q2Feedback !== null}
              style={{
                padding: '1.2rem 1.6rem',
                background: '#12203a',
                color: '#EAF0FA',
                border: '1.5px solid #3A4863',
                borderRadius: '1rem',
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '1.7rem',
                cursor: q2Feedback ? 'default' : 'pointer',
                minWidth: '13rem',
                opacity: q2Feedback ? 0.6 : 1,
              }}
            >
              {labels[b]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
