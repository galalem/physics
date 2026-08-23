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
} from '@physics/sdk/react'
import { getHintFor, getStagesFor } from './stages'
import en from '../i18n/en.json'
import fr from '../i18n/fr.json'
import ar from '../i18n/ar.json'
import {
  SETUPS,
  celerityMatches,
  gaussianAmplitude,
  peakPositionAt,
} from './physics'

// ─── Scene constants ───────────────────────────────────────────────────
const W = 800
const H = 450

// Rope geometry (SVG units) — the schematic occupies the left ~78% of the
// canvas; the slider column is an HTML overlay pinned to the right edge.
const ROPE_X0 = 60
const ROPE_X1 = 620
const ROPE_LEN_PX = ROPE_X1 - ROPE_X0
const ROPE_PHYS_LEN = 8 // meters
const PX_PER_M = ROPE_LEN_PX / ROPE_PHYS_LEN

// Baseline y-positions for the three stacked snapshots (stage 1).
const STAGE1_BASELINES = [140, 240, 340] as const
// Snapshot times (seconds) for each rope in stage 1.
const STAGE1_TIMES = [0.10, 0.20, 0.30] as const
// Max pulse amplitude in SVG units (upward from baseline).
const PULSE_PX_MAX = 42

// Single rope y for stages 2 and 3.
const SINGLE_ROPE_Y = 250

// Physics parameter ranges.
const C_MIN = 5      // m/s
const C_MAX = 30     // m/s
const C_DEFAULT = 15 // m/s

const A_MIN = 0.30   // relative amplitude
const A_MAX = 1.00
const A_DEFAULT = 0.60

const SIGMA_MIN = 0.20 // m (spatial half-width)
const SIGMA_MAX = 0.80
const SIGMA_DEFAULT = 0.45

// Stage-1 advance predicate: each slider must sweep this fraction of its range.
const COVERAGE_MIN_FRAC = 0.5

// ─── Label loader ─────────────────────────────────────────────────────
const dict = { en, fr, ar } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── Coordinate + rendering helpers ───────────────────────────────────
function physXToSvg(xPhys: number): number {
  return ROPE_X0 + xPhys * PX_PER_M
}

/** Sample the Gaussian pulse into an SVG polyline path (top of the envelope). */
function pulsePath(
  baselineY: number,
  peakPhys: number,
  sigmaX: number,
  amplitude: number,
): string {
  const N = 96
  let d = ''
  for (let i = 0; i <= N; i++) {
    const xPhys = (i / N) * ROPE_PHYS_LEN
    const yAmp = gaussianAmplitude(xPhys, peakPhys, sigmaX, amplitude)
    const sx = physXToSvg(xPhys)
    const sy = baselineY - yAmp * PULSE_PX_MAX
    d += (i === 0 ? 'M ' : ' L ') + sx.toFixed(2) + ' ' + sy.toFixed(2)
  }
  return d
}

// ─── Component ────────────────────────────────────────────────────────
export default function Scene() {
  const { locale, seed } = useInit()
  const stages = useMemo(() => getStagesFor(locale), [locale])
  useDeclareStages(stages)
  const labels = useMemo(() => svgLabels(locale), [locale])

  const stageIdx = useCurrentStage()
  const setStage = useSetStage()
  const progress = useProgress()
  const complete = useComplete()

  // DOF state
  const [c, setC] = useState(C_DEFAULT)
  const [amp, setAmp] = useState(A_DEFAULT)
  const [sigma, setSigma] = useState(SIGMA_DEFAULT)
  const [peekVisible, setPeekVisible] = useState(false)
  const peekIdxRef = useRef(0)

  // Stage 1 coverage tracking (per-DOF min/max).
  const [cMin, setCMin] = useState(C_DEFAULT)
  const [cMax, setCMax] = useState(C_DEFAULT)
  const [ampMin, setAmpMin] = useState(A_DEFAULT)
  const [ampMax, setAmpMax] = useState(A_DEFAULT)
  const [sigmaMin, setSigmaMin] = useState(SIGMA_DEFAULT)
  const [sigmaMax, setSigmaMax] = useState(SIGMA_DEFAULT)

  // Stage-3 fail-with-restart: rotates the target through SETUPS.
  const [failCount, setFailCount] = useState(0)

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  // Seed-indexed setups. Stage 3 uses a different rotation than stage 2 so
  // the student can't reuse the value they just found by matching visually.
  const stage2Setup = useMemo(
    () => SETUPS[seed % SETUPS.length]!,
    [seed],
  )
  const stage3Setup = useMemo(
    () => SETUPS[(seed + 1 + failCount) % SETUPS.length]!,
    [seed, failCount],
  )

  const resetStageState = useCallback(() => {
    setC(C_DEFAULT)
    setAmp(A_DEFAULT)
    setSigma(SIGMA_DEFAULT)
    setCMin(C_DEFAULT); setCMax(C_DEFAULT)
    setAmpMin(A_DEFAULT); setAmpMax(A_DEFAULT)
    setSigmaMin(SIGMA_DEFAULT); setSigmaMax(SIGMA_DEFAULT)
    setPeekVisible(false)
  }, [])
  useReset(resetStageState)

  // ─── Stage-1 coverage ────────────────────────────────────────────
  const cCov = (cMax - cMin) / (C_MAX - C_MIN)
  const ampCov = (ampMax - ampMin) / (A_MAX - A_MIN)
  const sigmaCov = (sigmaMax - sigmaMin) / (SIGMA_MAX - SIGMA_MIN)
  const stage1Done =
    cCov >= COVERAGE_MIN_FRAC &&
    ampCov >= COVERAGE_MIN_FRAC &&
    sigmaCov >= COVERAGE_MIN_FRAC

  // ─── Stage-2 feature match (internal — never surfaced live in the SVG) ─
  const stage2Match = celerityMatches(c, stage2Setup.cStar)
  // Stage-3 feature match — computed for canSubmit gating only; NOT rendered
  // live in the scene or HUD before submit.
  const stage3Match = celerityMatches(c, stage3Setup.cStar)

  const canSubmit = isStage1 ? stage1Done : isStage2 ? stage2Match : true
  // Stage 3 is single-submit: the student can always submit; failure rotates.

  useEffect(() => {
    progress(stageIdx / 3, { stage: stageIdx, canSubmit })
  }, [stageIdx, canSubmit, progress])

  useNext(() => {
    if (isStage1) {
      if (stage1Done) {
        setStage(2)
        resetStageState()
      }
      return
    }
    if (isStage2) {
      if (stage2Match) {
        setStage(3)
        resetStageState()
      }
      return
    }
    // Stage 3
    if (stage3Match) {
      complete({ success: true })
    } else {
      setFailCount((f) => f + 1)
      resetStageState()
    }
  })

  // ─── Peek (stage 3 only — text tip, never the visualization) ──────
  const PEEK_TIPS = useMemo(
    () => [labels.peek_tip_formula, labels.peek_tip_anchor],
    [labels],
  )
  usePeek(() => {
    if (!isStage3) return
    setPeekVisible(true)
    peekIdxRef.current += 1
  })
  useEffect(() => {
    if (!peekVisible) return
    const t = setTimeout(() => setPeekVisible(false), 4000)
    return () => clearTimeout(t)
  }, [peekVisible])

  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  // ─── HUD text ─────────────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`

  // TR — coverage on stage 1, current v readout on stages 2/3.
  // Stage 3 shows the current slider value (required info per §4.7) but
  // never reveals whether it matches until after submit.
  const hudTR = isStage1
    ? `v·${(cCov * 100).toFixed(0)}% A·${(ampCov * 100).toFixed(0)}% σ·${(sigmaCov * 100).toFixed(0)}%`
    : `v = ${c.toFixed(1)} m/s`

  const hudBL = peekVisible
    ? PEEK_TIPS[(peekIdxRef.current - 1) % PEEK_TIPS.length]!
    : isStage1
      ? labels.tip1
      : isStage2
        ? labels.tip2
        : labels.tip3
  // BR reserved — no overlay.

  // ─── Derived geometry for stage 2 (single snapshot) ────────────────
  const stage2PeakPhys = peakPositionAt(c, stage2Setup.tau)
  const stage2PeakSvg = physXToSvg(Math.max(0, Math.min(ROPE_PHYS_LEN, stage2PeakPhys)))

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block', userSelect: 'none' }}
      >
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        {/* Scene frame */}
        <rect x={32} y={60} width={608} height={358}
              fill="none" stroke="#12203a" strokeWidth={1} rx={6} />
        <text x={40} y={52} fill="#6C7A93"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={11} letterSpacing="0.1em">
          {labels.rope_label}
        </text>

        {/* ─── Stage 1: three stacked snapshots ─────────────────────── */}
        {isStage1 && STAGE1_BASELINES.map((baseY, i) => {
          const t = STAGE1_TIMES[i]!
          const peakPhys = peakPositionAt(c, t)
          return (
            <g key={`snap${i}`}>
              {/* Rope baseline */}
              <line x1={ROPE_X0} y1={baseY} x2={ROPE_X1} y2={baseY}
                    stroke="#2A3654" strokeWidth={1} />
              {/* Source marker at x=0 */}
              <circle cx={ROPE_X0} cy={baseY} r={4}
                      fill="#37C9B8" opacity={0.85} />
              {/* Time label to the left of the rope */}
              <text x={ROPE_X0 - 12} y={baseY + 4}
                    fill="#6C7A93"
                    fontFamily="'JetBrains Mono', monospace"
                    fontSize={10} textAnchor="end">
                t = {t.toFixed(2)}s
              </text>
              {/* Pulse envelope (only if peak within rope range) */}
              {peakPhys >= -sigma * 3 && peakPhys <= ROPE_PHYS_LEN + sigma * 3 && (
                <path d={pulsePath(baseY, peakPhys, sigma, amp)}
                      stroke="#37C9B8" strokeWidth={1.5} fill="none" opacity={0.95} />
              )}
            </g>
          )
        })}

        {/* ─── Stage 2: single snapshot at target time τ* ─────────── */}
        {isStage2 && (
          <g>
            {/* Rope baseline */}
            <line x1={ROPE_X0} y1={SINGLE_ROPE_Y} x2={ROPE_X1} y2={SINGLE_ROPE_Y}
                  stroke="#2A3654" strokeWidth={1} />
            {/* Source marker */}
            <circle cx={ROPE_X0} cy={SINGLE_ROPE_Y} r={5}
                    fill="#37C9B8" opacity={0.9} />
            <text x={ROPE_X0} y={SINGLE_ROPE_Y + 22}
                  fill="#54617A"
                  fontFamily="'JetBrains Mono', monospace"
                  fontSize={10} textAnchor="middle">
              {labels.source_label}
            </text>

            {/* Snapshot-time caption */}
            <text x={ROPE_X0} y={SINGLE_ROPE_Y - 90}
                  fill="#6C7A93"
                  fontFamily="'JetBrains Mono', monospace"
                  fontSize={11} letterSpacing="0.08em">
              {labels.snapshot_label} t = {stage2Setup.tau.toFixed(2)}s
            </text>

            {/* Live pulse envelope */}
            <path d={pulsePath(SINGLE_ROPE_Y, stage2PeakPhys, sigma, amp)}
                  stroke="#37C9B8" strokeWidth={1.7} fill="none" />

            {/* Target dashed vertical marker at d* */}
            <line
              x1={physXToSvg(stage2Setup.d)} y1={SINGLE_ROPE_Y - PULSE_PX_MAX - 20}
              x2={physXToSvg(stage2Setup.d)} y2={SINGLE_ROPE_Y + 18}
              stroke="#F97316" strokeWidth={1.2} strokeDasharray="4 4" opacity={0.85}
            />
            <text x={physXToSvg(stage2Setup.d)} y={SINGLE_ROPE_Y - PULSE_PX_MAX - 26}
                  fill="#F9A968"
                  fontFamily="'JetBrains Mono', monospace"
                  fontSize={10} textAnchor="middle">
              d* = {stage2Setup.d.toFixed(2)} m
            </text>

            {/* Live peak-position readout under the rope */}
            <text x={stage2PeakSvg} y={SINGLE_ROPE_Y + 34}
                  fill="#B9C4D6"
                  fontFamily="'JetBrains Mono', monospace"
                  fontSize={10} textAnchor="middle">
              x_peak = {stage2PeakPhys.toFixed(2)} m
            </text>
          </g>
        )}

        {/* ─── Stage 3: source + target only — pulse hidden ────────── */}
        {isStage3 && (
          <g>
            {/* Rope baseline */}
            <line x1={ROPE_X0} y1={SINGLE_ROPE_Y} x2={ROPE_X1} y2={SINGLE_ROPE_Y}
                  stroke="#2A3654" strokeWidth={1} />
            {/* Source (marker + label) */}
            <circle cx={ROPE_X0} cy={SINGLE_ROPE_Y} r={5}
                    fill="#37C9B8" opacity={0.9} />
            <text x={ROPE_X0} y={SINGLE_ROPE_Y + 22}
                  fill="#54617A"
                  fontFamily="'JetBrains Mono', monospace"
                  fontSize={10} textAnchor="middle">
              {labels.source_label}
            </text>
            {/* Distance ticks along the rope */}
            {[1, 2, 3, 4, 5, 6, 7].map((m) => (
              <g key={`tick${m}`}>
                <line x1={physXToSvg(m)} y1={SINGLE_ROPE_Y - 3}
                      x2={physXToSvg(m)} y2={SINGLE_ROPE_Y + 3}
                      stroke="#2A3654" strokeWidth={1} />
                <text x={physXToSvg(m)} y={SINGLE_ROPE_Y + 14}
                      fill="#3A4863"
                      fontFamily="'JetBrains Mono', monospace"
                      fontSize={8} textAnchor="middle">
                  {m}m
                </text>
              </g>
            ))}

            {/* Target point M with required-info labels: d* and τ* */}
            {(() => {
              const mx = physXToSvg(stage3Setup.d)
              return (
                <g>
                  <circle cx={mx} cy={SINGLE_ROPE_Y} r={6}
                          fill="none" stroke="#F97316" strokeWidth={1.5} />
                  <circle cx={mx} cy={SINGLE_ROPE_Y} r={2.5}
                          fill="#F97316" />
                  <text x={mx} y={SINGLE_ROPE_Y - 14}
                        fill="#F9A968"
                        fontFamily="'JetBrains Mono', monospace"
                        fontSize={11} textAnchor="middle">
                    M
                  </text>
                  <text x={mx} y={SINGLE_ROPE_Y - 30}
                        fill="#F9A968"
                        fontFamily="'JetBrains Mono', monospace"
                        fontSize={10} textAnchor="middle">
                    d* = {stage3Setup.d.toFixed(2)} m
                  </text>
                  <text x={mx} y={SINGLE_ROPE_Y - 44}
                        fill="#F9A968"
                        fontFamily="'JetBrains Mono', monospace"
                        fontSize={10} textAnchor="middle">
                    τ* = {stage3Setup.tau.toFixed(2)} s
                  </text>
                </g>
              )
            })()}
          </g>
        )}
      </svg>

      {/* ─── HUD overlays (HTML, in rem) ──────────────────────────── */}
      <div style={{
        position: 'absolute', top: '3rem', left: '3rem',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '2.3rem', letterSpacing: '0.14em', textTransform: 'uppercase',
        color: '#6C7A93', zIndex: 5, pointerEvents: 'none',
      }}>
        {hudTL}
      </div>
      <div style={{
        position: 'absolute', top: '3rem', right: '3rem',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '2.3rem', letterSpacing: '0.08em',
        color: '#B9C4D6', textAlign: 'right',
        zIndex: 5, pointerEvents: 'none',
      }}>
        {hudTR}
      </div>
      <div style={{
        position: 'absolute', bottom: '3rem', left: '3rem',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '2.3rem', letterSpacing: '0.06em',
        color: peekVisible ? '#B9C4D6' : '#6C7A93',
        zIndex: 5, pointerEvents: 'none', maxWidth: '48%',
      }}>
        {hudBL}
      </div>
      {/* BR reserved for parent chrome — no overlay. */}

      {/* ─── Slider column (right side) ─────────────────────────── */}
      <div style={{
        position: 'absolute', top: '6rem', right: '3rem',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        gap: '1.5rem', zIndex: 6,
      }}>
        <SliderVertical
          label="v"
          unit="m/s"
          value={c}
          min={C_MIN}
          max={C_MAX}
          step={0.1}
          format={(v) => v.toFixed(1)}
          onChange={(v) => {
            setC(v)
            setCMin((prev) => Math.min(prev, v))
            setCMax((prev) => Math.max(prev, v))
          }}
        />
        <SliderVertical
          label="A"
          unit=""
          value={amp}
          min={A_MIN}
          max={A_MAX}
          step={0.02}
          format={(v) => v.toFixed(2)}
          onChange={(v) => {
            setAmp(v)
            setAmpMin((prev) => Math.min(prev, v))
            setAmpMax((prev) => Math.max(prev, v))
          }}
        />
        <SliderVertical
          label="σ"
          unit="m"
          value={sigma}
          min={SIGMA_MIN}
          max={SIGMA_MAX}
          step={0.02}
          format={(v) => v.toFixed(2)}
          onChange={(v) => {
            setSigma(v)
            setSigmaMin((prev) => Math.min(prev, v))
            setSigmaMax((prev) => Math.max(prev, v))
          }}
        />
      </div>
    </div>
  )
}

// ─── Slider primitive (copied from diffraction, adapted) ─────────────
function SliderVertical({
  label, unit, value, min, max, step, format, onChange, accent = '#37C9B8',
}: {
  label: string
  unit: string
  value: number
  min: number
  max: number
  step: number
  format: (v: number) => string
  onChange: (v: number) => void
  accent?: string
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.4rem' }}>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.5rem', color: '#54617A' }}>
        {format(max)}
      </div>
      <div style={{ width: '2.5rem', height: '11rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{
            width: '11rem',
            height: '2rem',
            transform: 'rotate(-90deg)',
            transformOrigin: 'center',
            accentColor: accent,
            cursor: 'pointer',
          }}
        />
      </div>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.5rem', color: '#54617A' }}>
        {format(min)}
      </div>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.8rem', color: accent }}>
        {label} = {format(value)}{unit}
      </div>
    </div>
  )
}
