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
  useSetStage,
  useTicker,
} from '@physics/sdk/react'
import { getHintFor, getStagesFor } from './stages'
import en from '../i18n/en.json'
import fr from '../i18n/fr.json'
import ar from '../i18n/ar.json'
import { Track } from './art/Track'
import { Bob } from './art/Bob'
import { GhostBob } from './art/GhostBob'
import { Spring } from './art/Spring'

// ─── Scene constants ────────────────────────────────────────────────────
const W = 800
const H = 450

// Track geometry (SVG coords)
const TRACK_Y = 210 // vertical position of the track
const TRACK_X0 = 100 // left edge (anchor wall)
const TRACK_X1 = 560 // right edge (before the waveform panel)
const ORIGIN_X = 330 // x = 0 in scene units maps here
const PX_PER_M = 40 // 1 metre = 40 SVG units → ±0.5 m fills the visible track

// Waveform panel (right of the track scene)
const WAVE_X = 588
const WAVE_Y = 100
const WAVE_W = 190
const WAVE_H = 220
const WAVE_T_SPAN = 8 // seconds visible on the x-axis of the waveform

// Physics DOF ranges
const XM_MIN = 0.1
const XM_MAX = 0.5
const XM_STEP = 0.01
const OMEGA_MIN = 0.5
const OMEGA_MAX = 4.0
const OMEGA_STEP = 0.05
const PHI_MIN = 0
const PHI_MAX = Math.PI * 2 // full turn
const PHI_STEP = Math.PI / 12 // 15° steps

const DEFAULT_XM = 0.3
const DEFAULT_OMEGA = 2.0
const DEFAULT_PHI = 0

// Sim pacing
const SPEED_FACTOR = 1 // simulate real-time seconds — periods of a few seconds are easy to read

// Matching tolerances (Experiment + Evaluate)
const XM_TOL = 0.03 // metres
const OMEGA_TOL = 0.15 // rad/s
const PHI_TOL = Math.PI / 12 // 15°

// Blind-stage rules
const STAGE3_TARGET_COUNT = 3 // K targets → K attempts

// ─── Setups (seed-picked) ───────────────────────────────────────────────
type Target = { id: string; xm: number; omega: number; phi: number }
type Setup = { targets: Target[] }

// Stage 2: three sinusoids that stress amplitude, then period, then phase.
const STAGE2_SETUPS: Setup[] = [
  {
    targets: [
      { id: 'e0a', xm: 0.35, omega: 1.5, phi: 0 },
      { id: 'e0b', xm: 0.35, omega: 2.5, phi: 0 },
      { id: 'e0c', xm: 0.25, omega: 2.5, phi: Math.PI / 2 },
    ],
  },
  {
    targets: [
      { id: 'e1a', xm: 0.4, omega: 1.0, phi: 0 },
      { id: 'e1b', xm: 0.2, omega: 3.0, phi: Math.PI / 4 },
      { id: 'e1c', xm: 0.3, omega: 2.0, phi: Math.PI },
    ],
  },
  {
    targets: [
      { id: 'e2a', xm: 0.45, omega: 2.0, phi: 0 },
      { id: 'e2b', xm: 0.3, omega: 2.0, phi: Math.PI / 2 },
      { id: 'e2c', xm: 0.3, omega: 3.5, phi: Math.PI / 2 },
    ],
  },
  {
    targets: [
      { id: 'e3a', xm: 0.25, omega: 1.5, phi: Math.PI / 3 },
      { id: 'e3b', xm: 0.4, omega: 3.0, phi: 0 },
      { id: 'e3c', xm: 0.35, omega: 2.0, phi: (3 * Math.PI) / 4 },
    ],
  },
  {
    targets: [
      { id: 'e4a', xm: 0.3, omega: 2.5, phi: 0 },
      { id: 'e4b', xm: 0.3, omega: 2.5, phi: Math.PI },
      { id: 'e4c', xm: 0.45, omega: 1.5, phi: Math.PI / 2 },
    ],
  },
]

// Stage 3: harder — a mix of periods and phases; each setup ships K = 3 targets.
const STAGE3_SETUPS: Setup[] = [
  {
    targets: [
      { id: 'v0a', xm: 0.4, omega: 2.0, phi: 0 },
      { id: 'v0b', xm: 0.25, omega: 3.0, phi: Math.PI / 2 },
      { id: 'v0c', xm: 0.35, omega: 1.5, phi: Math.PI },
    ],
  },
  {
    targets: [
      { id: 'v1a', xm: 0.3, omega: 2.5, phi: Math.PI / 4 },
      { id: 'v1b', xm: 0.45, omega: 1.0, phi: 0 },
      { id: 'v1c', xm: 0.2, omega: 3.5, phi: (3 * Math.PI) / 4 },
    ],
  },
  {
    targets: [
      { id: 'v2a', xm: 0.35, omega: 2.0, phi: Math.PI / 2 },
      { id: 'v2b', xm: 0.4, omega: 3.0, phi: Math.PI },
      { id: 'v2c', xm: 0.25, omega: 1.5, phi: Math.PI / 6 },
    ],
  },
  {
    targets: [
      { id: 'v3a', xm: 0.45, omega: 2.5, phi: 0 },
      { id: 'v3b', xm: 0.3, omega: 1.5, phi: (5 * Math.PI) / 6 },
      { id: 'v3c', xm: 0.2, omega: 3.0, phi: Math.PI / 3 },
    ],
  },
]

const dict = { en, fr, ar } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── Physics helpers (INLINE — no shared package) ───────────────────────
// x(t) = Xm · cos(ω·t + φ)  — position in metres, t in seconds
function elongationAt(t: number, xm: number, omega: number, phi: number): number {
  return xm * Math.cos(omega * t + phi)
}

function toSvgX(m: number): number {
  return ORIGIN_X + m * PX_PER_M
}

// Waveform path in the right-side panel.
// Time axis: 0..WAVE_T_SPAN → left..right of WAVE_W.
// Y axis: −XM_MAX..+XM_MAX → bottom..top of WAVE_H (centered at WAVE_Y + WAVE_H/2).
function waveformPath(xm: number, omega: number, phi: number, samples = 96): string {
  const midY = WAVE_Y + WAVE_H / 2
  const yScale = (WAVE_H / 2) / XM_MAX
  const parts: string[] = []
  for (let i = 0; i <= samples; i++) {
    const t = (i / samples) * WAVE_T_SPAN
    const x = elongationAt(t, xm, omega, phi)
    const px = WAVE_X + (i / samples) * WAVE_W
    const py = midY - x * yScale
    parts.push(`${i === 0 ? 'M' : 'L'} ${px.toFixed(2)} ${py.toFixed(2)}`)
  }
  return parts.join(' ')
}

// Format helpers for the target-label chips on stage 3.
function fmtPhi(phi: number): string {
  // Show phi as a fraction of π rounded to nearest π/12.
  const n = Math.round((phi / (Math.PI / 12)))
  if (n === 0) return '0'
  const num = n
  const den = 12
  const g = gcd(Math.abs(num), den)
  const a = num / g
  const b = den / g
  if (b === 1) return a === 1 ? 'π' : a === -1 ? '−π' : `${a}π`
  const numStr = a === 1 ? 'π' : a === -1 ? '−π' : `${a}π`
  return `${numStr}/${b}`
}
function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b)
}
function fmtT(omega: number): string {
  return ((2 * Math.PI) / omega).toFixed(2)
}

// ─── Component ──────────────────────────────────────────────────────────
type Playback = { xm: number; omega: number; phi: number; targetXm: number; targetOmega: number; targetPhi: number; startedAt: number; targetId: string | null }

export default function Scene() {
  const { locale, seed } = useInit()
  const stages = useMemo(() => getStagesFor(locale), [locale])
  useDeclareStages(stages)
  const labels = useMemo(() => svgLabels(locale), [locale])

  const setup2 = useMemo(() => STAGE2_SETUPS[seed % STAGE2_SETUPS.length]!, [seed])
  const setup3 = useMemo(() => STAGE3_SETUPS[seed % STAGE3_SETUPS.length]!, [seed])

  const stageIdx = useCurrentStage()
  const setStage = useSetStage()

  // ─── State ─────────────────────────────────────────────────────────────
  const [xm, setXm] = useState(DEFAULT_XM)
  const [omega, setOmega] = useState(DEFAULT_OMEGA)
  const [phi, setPhi] = useState(DEFAULT_PHI)
  const [playback, setPlayback] = useState<Playback | null>(null)
  const [now, setNow] = useState(0) // seconds since playback started (SIM time)

  // Stage 1 accounting
  const [playCount, setPlayCount] = useState(0)
  const [distinctOmegas, setDistinctOmegas] = useState<number[]>([])
  const [otherSliderMoved, setOtherSliderMoved] = useState(false)

  // Stage 2 / 3 progress
  const [targetIdx, setTargetIdx] = useState(0) // which target in the current setup
  const [hits, setHits] = useState<string[]>([])
  const [feedback, setFeedback] = useState<'idle' | 'hit' | 'miss'>('idle')

  // Stage 3 anti-friction
  const [attemptsLeft, setAttemptsLeft] = useState(STAGE3_TARGET_COUNT)

  // Peek (stage 3 only)
  const [peekTip, setPeekTip] = useState<string | null>(null)
  const peekIdxRef = useRef(0)

  const complete = useComplete()
  const progress = useProgress()

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  const activeTargets = isStage2 ? setup2.targets : isStage3 ? setup3.targets : []
  const currentTarget: Target | undefined = (isStage2 || isStage3) ? activeTargets[targetIdx] : undefined

  // ─── Reset ────────────────────────────────────────────────────────────
  const resetStageState = useCallback(() => {
    setXm(DEFAULT_XM)
    setOmega(DEFAULT_OMEGA)
    setPhi(DEFAULT_PHI)
    setPlayback(null)
    setNow(0)
    setPlayCount(0)
    setDistinctOmegas([])
    setOtherSliderMoved(false)
    setTargetIdx(0)
    setHits([])
    setFeedback('idle')
    setAttemptsLeft(STAGE3_TARGET_COUNT)
    setPeekTip(null)
  }, [])
  useReset(resetStageState)

  // ─── Play ─────────────────────────────────────────────────────────────
  const canPlay = !playback && (!isStage3 || attemptsLeft > 0) && (!(isStage2 || isStage3) || (hits.length < activeTargets.length))
  const play = useCallback(() => {
    if (!canPlay) return
    const target = (isStage2 || isStage3) ? activeTargets[targetIdx] : undefined
    setPlayback({
      xm,
      omega,
      phi,
      targetXm: target?.xm ?? xm,
      targetOmega: target?.omega ?? omega,
      targetPhi: target?.phi ?? phi,
      startedAt: performance.now(),
      targetId: target?.id ?? null,
    })
    setNow(0)
    setFeedback('idle')

    if (isStage1) {
      setPlayCount((n) => n + 1)
      const bucket = Math.round(omega * 4) / 4 // 0.25 rad/s buckets
      setDistinctOmegas((prev) => (prev.includes(bucket) ? prev : [...prev, bucket]))
    }
    if (isStage3) {
      setAttemptsLeft((n) => n - 1)
    }
  }, [canPlay, isStage1, isStage3, isStage2, xm, omega, phi, activeTargets, targetIdx])

  const stop = useCallback(() => {
    setPlayback(null)
    setNow(0)
  }, [])

  // ─── Ticker ───────────────────────────────────────────────────────────
  useTicker(() => {
    if (!playback) return
    const t = ((performance.now() - playback.startedAt) / 1000) * SPEED_FACTOR
    setNow(t)

    // Judge match at the end of one target-period.
    const targetPeriod = (2 * Math.PI) / playback.targetOmega
    if (t >= targetPeriod && (isStage2 || isStage3)) {
      const dXm = Math.abs(playback.xm - playback.targetXm)
      const dOm = Math.abs(playback.omega - playback.targetOmega)
      // Phase difference wrapped into [-π, π]
      const rawDPhi = playback.phi - playback.targetPhi
      const dPhi = Math.abs(Math.atan2(Math.sin(rawDPhi), Math.cos(rawDPhi)))
      const success = dXm <= XM_TOL && dOm <= OMEGA_TOL && dPhi <= PHI_TOL
      if (success && playback.targetId && !hits.includes(playback.targetId)) {
        setHits((prev) => [...prev, playback.targetId!])
        setFeedback('hit')
      } else if (!success) {
        setFeedback('miss')
      }
      setPlayback(null)
      setNow(0)
    }
  })

  // Auto-advance target after successful hit (short pause so the student sees the feedback).
  useEffect(() => {
    if (feedback !== 'hit') return
    if (!(isStage2 || isStage3)) return
    const timer = setTimeout(() => {
      setFeedback('idle')
      if (targetIdx < activeTargets.length - 1) {
        setTargetIdx((i) => i + 1)
      }
    }, 900)
    return () => clearTimeout(timer)
  }, [feedback, isStage2, isStage3, targetIdx, activeTargets.length])

  // Stage 3: on miss, either advance to next target if attempts remain, or fail-with-restart.
  useEffect(() => {
    if (!isStage3) return
    if (feedback !== 'miss') return
    const timer = setTimeout(() => {
      setFeedback('idle')
      if (targetIdx < activeTargets.length - 1 && attemptsLeft > 0) {
        setTargetIdx((i) => i + 1)
      } else if (hits.length < activeTargets.length) {
        // Out of attempts or last target missed → fresh restart.
        resetStageState()
      }
    }, 1100)
    return () => clearTimeout(timer)
  }, [feedback, isStage3, targetIdx, activeTargets.length, attemptsLeft, hits.length, resetStageState])

  // ─── Advance predicate ────────────────────────────────────────────────
  const canSubmit = isStage1
    ? playCount >= 3 && distinctOmegas.length >= 2 && otherSliderMoved
    : (isStage2 || isStage3) && hits.length === activeTargets.length && activeTargets.length > 0

  useEffect(() => {
    progress(stageIdx / 3, { stage: stageIdx, canSubmit })
  }, [stageIdx, canSubmit, progress])

  useNext(() => {
    if (stageIdx < 3) {
      setStage(stageIdx + 1)
      resetStageState()
    } else {
      complete({ success: true })
    }
  })

  // ─── Peek (blind stage only — strategy TEXT, never the waveform) ──────
  const PEEK_TIPS = useMemo(
    () => [labels.peek_tip_period, labels.peek_tip_phase, labels.peek_tip_amplitude],
    [labels],
  )
  usePeek(() => {
    if (!isStage3) return
    setPeekTip(PEEK_TIPS[peekIdxRef.current % PEEK_TIPS.length]!)
    peekIdxRef.current += 1
  })
  useEffect(() => {
    if (!peekTip) return
    const t = setTimeout(() => setPeekTip(null), 4500)
    return () => clearTimeout(t)
  }, [peekTip])

  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  // ─── Current bob positions (metres → SVG) ──────────────────────────────
  const t = playback ? now : 0
  // In stage 1 the student's parameters drive the live curve; in stage 2/3 the
  // student's bob uses their sliders and the ghost uses the (frozen) target.
  const studentX = playback
    ? elongationAt(t, playback.xm, playback.omega, playback.phi)
    : elongationAt(0, xm, omega, phi)
  const ghostX = playback && (isStage2 || isStage3)
    ? elongationAt(t, playback.targetXm, playback.targetOmega, playback.targetPhi)
    : (isStage2 || isStage3) && currentTarget
      ? elongationAt(0, currentTarget.xm, currentTarget.omega, currentTarget.phi)
      : null

  // ─── HUD text ─────────────────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`
  const hudTL2 = `${labels.amplitude} = ${xm.toFixed(2)} m · ${labels.omega} = ${omega.toFixed(2)} rad/s · ${labels.phase} = ${(phi / Math.PI).toFixed(2)}π`
  const hudTRLines: string[] = []
  if (isStage2) {
    hudTRLines.push(`${labels.matches} ${hits.length}/${activeTargets.length}`)
    hudTRLines.push(`${labels.target} ${Math.min(targetIdx + 1, activeTargets.length)}/${activeTargets.length}`)
  } else if (isStage3) {
    hudTRLines.push(`${labels.matches} ${hits.length}/${activeTargets.length}`)
    hudTRLines.push(`${labels.attempts} ${attemptsLeft}/${STAGE3_TARGET_COUNT}`)
  } else {
    hudTRLines.push(`t = ${t.toFixed(2)} s`)
  }
  const hudBL = isStage3 && peekTip
    ? peekTip
    : (isStage1 ? labels.tip1 : isStage2 ? labels.tip2 : labels.tip3)
  // BR: RESERVED for parent chrome — leave empty (per §4.3).

  // Show waveform panel only on stages 1 + 2. Blind stage hides it (§4.7).
  const showWaveform = isStage1 || isStage2

  // Ticks along the track: −0.5, −0.25, 0, +0.25, +0.5 m
  const trackTicks = [-0.5, -0.25, 0.25, 0.5].map((m) => ({
    x: toSvgX(m),
    label: m > 0 ? `+${m.toFixed(2)}` : m.toFixed(2),
  }))

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
          touchAction: 'none',
          userSelect: 'none',
        }}
      >
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        {/* Grid */}
        {Array.from({ length: 13 }).map((_, i) => (
          <line key={`gx${i}`} x1={i * 60 + 20} y1={0} x2={i * 60 + 20} y2={H} stroke="#12203a" strokeWidth={1} />
        ))}
        {Array.from({ length: 7 }).map((_, i) => (
          <line key={`gy${i}`} x1={0} y1={i * 60 + 30} x2={W} y2={i * 60 + 30} stroke="#12203a" strokeWidth={1} />
        ))}

        {/* Track + spring + bobs */}
        <Track
          x1={TRACK_X0}
          x2={TRACK_X1}
          y={TRACK_Y}
          originX={ORIGIN_X}
          tickPositions={trackTicks}
        />
        <Spring x1={TRACK_X0} x2={toSvgX(studentX)} y={TRACK_Y} coils={10} amplitude={6} stroke="#6C7A93" />

        {/* Ghost bob (target motion) — only on stage 2 + 3 */}
        {(isStage2 || isStage3) && ghostX !== null && (
          <g>
            <GhostBob x={toSvgX(ghostX)} y={TRACK_Y - 26} />
            <text
              x={toSvgX(ghostX)}
              y={TRACK_Y - 46}
              fill="#37C9B8"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={9}
              textAnchor="middle"
              opacity={0.85}
            >
              ghost
            </text>
          </g>
        )}
        <Bob x={toSvgX(studentX)} y={TRACK_Y} />

        {/* Target parameter chip on stage 3 (required info — cannot be computed without it) */}
        {isStage3 && currentTarget && (
          <g>
            <rect
              x={140}
              y={302}
              width={340}
              height={72}
              fill="#101a2e"
              stroke="#37C9B8"
              strokeWidth={1.2}
              rx={6}
              opacity={0.9}
            />
            <text
              x={160}
              y={324}
              fill="#37C9B8"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={11}
              letterSpacing="0.14em"
            >
              TARGET {targetIdx + 1} / {activeTargets.length}
            </text>
            <text
              x={160}
              y={350}
              fill="#EAF0FA"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={14}
            >
              Xm = {currentTarget.xm.toFixed(2)} m
            </text>
            <text
              x={300}
              y={350}
              fill="#EAF0FA"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={14}
            >
              T = {fmtT(currentTarget.omega)} s
            </text>
            <text
              x={160}
              y={370}
              fill="#EAF0FA"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={14}
            >
              φ = {fmtPhi(currentTarget.phi)}
            </text>
          </g>
        )}

        {/* Stage 2 also surfaces the numeric target info (as a mild chip) — the
            waveform is the primary help, but knowing the exact target values
            lets the student verify their calculation. Stage 2 is NOT the blind
            stage; help is fine. */}
        {isStage2 && currentTarget && (
          <g opacity={0.85}>
            <rect x={140} y={310} width={300} height={54} fill="#101a2e" stroke="#54617A" strokeWidth={1} rx={6} />
            <text
              x={156}
              y={328}
              fill="#37C9B8"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
              letterSpacing="0.14em"
            >
              TARGET {targetIdx + 1} / {activeTargets.length}
            </text>
            <text x={156} y={352} fill="#B9C4D6" fontFamily="'JetBrains Mono', monospace" fontSize={12}>
              Xm = {currentTarget.xm.toFixed(2)} m · T = {fmtT(currentTarget.omega)} s · φ = {fmtPhi(currentTarget.phi)}
            </text>
          </g>
        )}

        {/* Waveform panel (stages 1 + 2) */}
        {showWaveform && (
          <g>
            <rect x={WAVE_X - 8} y={WAVE_Y - 18} width={WAVE_W + 22} height={WAVE_H + 44} fill="#101a2e" stroke="#3A4863" strokeWidth={1} rx={6} />
            {/* axes */}
            <line x1={WAVE_X} y1={WAVE_Y + WAVE_H / 2} x2={WAVE_X + WAVE_W} y2={WAVE_Y + WAVE_H / 2} stroke="#3A4863" strokeWidth={0.8} />
            <line x1={WAVE_X} y1={WAVE_Y} x2={WAVE_X} y2={WAVE_Y + WAVE_H} stroke="#3A4863" strokeWidth={0.8} />
            <text
              x={WAVE_X - 4}
              y={WAVE_Y - 4}
              fill="#54617A"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={9}
              textAnchor="end"
            >
              x(t)
            </text>
            <text
              x={WAVE_X + WAVE_W}
              y={WAVE_Y + WAVE_H + 14}
              fill="#54617A"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={9}
              textAnchor="end"
            >
              t (s)
            </text>
            {/* Target curve (teal, dashed) — only on stage 2 */}
            {isStage2 && currentTarget && (
              <path
                d={waveformPath(currentTarget.xm, currentTarget.omega, currentTarget.phi)}
                fill="none"
                stroke="#37C9B8"
                strokeWidth={1.6}
                strokeDasharray="4 4"
                opacity={0.85}
              />
            )}
            {/* Student curve (orange) */}
            <path
              d={waveformPath(xm, omega, phi)}
              fill="none"
              stroke="#F97316"
              strokeWidth={1.8}
            />
            {/* Playhead */}
            {playback && now > 0 && now < WAVE_T_SPAN && (
              <line
                x1={WAVE_X + (now / WAVE_T_SPAN) * WAVE_W}
                y1={WAVE_Y}
                x2={WAVE_X + (now / WAVE_T_SPAN) * WAVE_W}
                y2={WAVE_Y + WAVE_H}
                stroke="#F9A968"
                strokeWidth={0.8}
                opacity={0.7}
              />
            )}
          </g>
        )}

        {/* Feedback pill */}
        {feedback === 'hit' && (
          <g>
            <rect x={330} y={80} width={140} height={32} fill="#0e2a24" stroke="#37C9B8" strokeWidth={1.4} rx={6} />
            <text x={400} y={101} fill="#37C9B8" fontFamily="'JetBrains Mono', monospace" fontSize={14} textAnchor="middle" letterSpacing="0.12em">
              MATCH
            </text>
          </g>
        )}
        {feedback === 'miss' && (
          <g>
            <rect x={330} y={80} width={140} height={32} fill="#2a1414" stroke="#F97316" strokeWidth={1.4} rx={6} />
            <text x={400} y={101} fill="#F97316" fontFamily="'JetBrains Mono', monospace" fontSize={14} textAnchor="middle" letterSpacing="0.12em">
              MISS
            </text>
          </g>
        )}
      </svg>

      {/* HUD overlays — HTML in rem */}
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
        <div style={{ marginTop: '0.6rem', fontSize: '1.8rem', letterSpacing: '0.08em', textTransform: 'none', color: '#B9C4D6' }}>
          {hudTL2}
        </div>
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
          textAlign: 'right',
          zIndex: 5,
          pointerEvents: 'none',
        }}
      >
        {hudTRLines[0]}
        {hudTRLines[1] && (
          <div style={{ marginTop: '0.6rem', color: '#6C7A93' }}>{hudTRLines[1]}</div>
        )}
      </div>
      <div
        style={{
          position: 'absolute',
          bottom: '3rem',
          left: '3rem',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '2.1rem',
          letterSpacing: '0.06em',
          color: '#6C7A93',
          maxWidth: '46rem',
          zIndex: 5,
          pointerEvents: 'none',
        }}
      >
        {hudBL}
      </div>
      {/* BR corner intentionally empty (reserved for parent-side chrome). */}

      {/* Slider stack (top-right column, vertical sliders per §5.4) */}
      <div
        style={{
          position: 'absolute',
          top: '18rem',
          right: '3rem',
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'flex-start',
          gap: '2.4rem',
          zIndex: 6,
        }}
      >
        <VerticalSlider
          caption={labels.amplitude}
          min={XM_MIN}
          max={XM_MAX}
          step={XM_STEP}
          value={xm}
          onChange={(v) => {
            setXm(v)
            if (isStage1) setOtherSliderMoved(true)
          }}
          format={(v) => v.toFixed(2)}
          disabled={!!playback}
        />
        <VerticalSlider
          caption={labels.omega}
          min={OMEGA_MIN}
          max={OMEGA_MAX}
          step={OMEGA_STEP}
          value={omega}
          onChange={(v) => setOmega(v)}
          format={(v) => v.toFixed(2)}
          disabled={!!playback}
        />
        <VerticalSlider
          caption={labels.phase}
          min={PHI_MIN}
          max={PHI_MAX}
          step={PHI_STEP}
          value={phi}
          onChange={(v) => {
            setPhi(v)
            if (isStage1) setOtherSliderMoved(true)
          }}
          format={(v) => `${(v / Math.PI).toFixed(2)}π`}
          disabled={!!playback}
        />
      </div>

      {/* Play / Stop button (bottom-center) */}
      <button
        type="button"
        onClick={playback ? stop : play}
        disabled={!playback && !canPlay}
        style={{
          position: 'absolute',
          bottom: '3rem',
          left: '50%',
          transform: 'translateX(-50%)',
          padding: '2rem 4rem',
          background: playback ? '#1E2A40' : canPlay ? '#F97316' : 'rgba(30,42,64,0.85)',
          color: playback ? '#F9A968' : canPlay ? '#FFFFFF' : '#6C7A93',
          border: `0.3rem solid ${playback ? '#F97316' : canPlay ? '#F97316' : 'rgba(58,72,99,0.6)'}`,
          borderRadius: '100rem',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '2.6rem',
          fontWeight: 700,
          letterSpacing: '0.12em',
          cursor: !playback && !canPlay ? 'not-allowed' : 'pointer',
          zIndex: 10,
          transition: 'background 0.15s',
        }}
      >
        <i
          className={playback ? 'bi bi-stop-fill' : 'bi bi-play-fill'}
          style={{ marginInlineEnd: '0.8rem', fontSize: '2.8rem', verticalAlign: '-0.2rem' }}
        />
        {playback ? labels.stop : labels.play}
      </button>
    </div>
  )
}

// ─── Small helper — vertical rotated slider ─────────────────────────────
type SliderProps = {
  caption: string
  min: number
  max: number
  step: number
  value: number
  onChange: (v: number) => void
  format: (v: number) => string
  disabled?: boolean
}

function VerticalSlider({ caption, min, max, step, value, onChange, format, disabled }: SliderProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.8rem' }}>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.7rem', color: '#B9C4D6', minHeight: '1.7rem' }}>
        {format(value)}
      </div>
      <div style={{ width: '2rem', height: '26rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{
            width: '26rem',
            height: '2rem',
            transform: 'rotate(-90deg)',
            transformOrigin: 'center',
            accentColor: '#F97316',
            cursor: disabled ? 'not-allowed' : 'pointer',
            opacity: disabled ? 0.5 : 1,
          }}
        />
      </div>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.7rem', color: '#54617A' }}>{caption}</div>
    </div>
  )
}
