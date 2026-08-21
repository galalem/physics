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
  useTicker,
} from '@physics/sdk/react'
import { getHintFor, getStagesFor } from './stages'
import en from '../i18n/en.json'
import fr from '../i18n/fr.json'
import ar from '../i18n/ar.json'

// ─── Scene constants ────────────────────────────────────────────────────
const W = 800
const H = 450
const GRID_ROWS = 10
const GRID_COLS = 10
const N0 = GRID_ROWS * GRID_COLS

// Grid panel (left half)
const GRID_X = 32
const GRID_Y = 60
const GRID_W = 340
const GRID_H = 340

// Plot panel (right half)
const PLOT_X = 400
const PLOT_Y = 60
const PLOT_W = 300
const PLOT_H = 340

// T½ slider bounds (arbitrary "time units", u)
const T_MIN = 5
const T_MAX = 40
const T_DEFAULT = 20

// Sim clock caps out here so the plot has a stable horizontal extent.
const T_SIM_MAX = 120 // ~3× T_MAX

// Stage 2: mystery T½ candidates (seed-picked) — deliberately span the slider range
const STAGE2_TARGETS = [8, 12, 18, 25, 32]

// Stage 3: hidden T½ candidates (seed-picked)
const STAGE3_TARGETS = [10, 15, 22, 28, 35]

// Tolerances
const STAGE2_TOL = 0.05 // ±5% on |Tstudent − Ttarget| / Ttarget
const STAGE3_TOL = 0.03 // ±3% on numeric input

// Sample-point times, expressed as multiples of the target T½.
// Chosen to bracket the decay: one before, one at, one after the half-life.
const STAGE2_SAMPLE_FRACTIONS = [0.5, 1.0, 2.0]
const STAGE3_SAMPLE_FRACTIONS = [0.6, 1.2, 2.0, 2.8]

// Gaussian noise applied to Evaluate's shown data points (relative to N₀).
const STAGE3_NOISE_SIGMA = 0.04

const dict = { en, fr, ar } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── Physics helpers ────────────────────────────────────────────────────
function lambdaFromT(T: number): number {
  return Math.LN2 / T
}
function analyticN(t: number, T: number): number {
  return N0 * Math.exp(-lambdaFromT(T) * t)
}

/** From N0 uniform draws U∈(0,1], derive sorted lifetimes for a given λ. */
function lifetimesFor(uniforms: readonly number[], T: number): number[] {
  const lambda = lambdaFromT(T)
  const taus = uniforms.map((u) => -Math.log(u) / lambda)
  return taus.sort((a, b) => a - b)
}

/** Count of nuclei still alive at time t given sorted lifetimes. */
function aliveAt(sortedTaus: readonly number[], t: number): number {
  // binary search for first tau > t
  let lo = 0
  let hi = sortedTaus.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if ((sortedTaus[mid] as number) <= t) lo = mid + 1
    else hi = mid
  }
  return N0 - lo
}

// ─── Coordinate helpers ─────────────────────────────────────────────────
function tToSvgX(t: number): number {
  return PLOT_X + (t / T_SIM_MAX) * PLOT_W
}
function nToSvgY(n: number, log: boolean): number {
  if (!log) return PLOT_Y + PLOT_H - (n / N0) * PLOT_H
  // log10 with floor at 1 (so N=1 sits at bottom, N=100 at top)
  const y = n <= 0 ? 0 : Math.log10(n) / Math.log10(N0)
  return PLOT_Y + PLOT_H - y * PLOT_H
}

// ─── Component ──────────────────────────────────────────────────────────
export default function Scene() {
  const { locale, seed } = useInit()
  const stages = useMemo(() => getStagesFor(locale), [locale])
  useDeclareStages(stages)
  const labels = useMemo(() => svgLabels(locale), [locale])

  const rootRng = useSeed()
  // Fork discipline: draw all forks in a stable order at INIT/RESET.
  const uniforms = useMemo(() => {
    const physics = rootRng.fork()
    const out: number[] = []
    for (let i = 0; i < N0; i++) {
      let u = physics.next()
      if (u === 0) u = 1e-12 // guard log(0)
      out.push(u)
    }
    return out
  }, [rootRng])
  // Second fork: target isotope pick + Evaluate sample noise (order-stable).
  const targetT2 = useMemo(() => {
    return STAGE2_TARGETS[seed % STAGE2_TARGETS.length] as number
  }, [seed])
  const targetT3 = useMemo(() => {
    return STAGE3_TARGETS[seed % STAGE3_TARGETS.length] as number
  }, [seed])
  const stage3Points = useMemo(() => {
    // one fork for the noise
    const noiseRng = rootRng.fork().fork()
    return STAGE3_SAMPLE_FRACTIONS.map((frac) => {
      const t = frac * targetT3
      const nMean = analyticN(t, targetT3)
      const n = Math.max(0, Math.min(N0, nMean + N0 * noiseRng.gauss(0, STAGE3_NOISE_SIGMA)))
      return { t, n: Math.round(n) }
    })
  }, [rootRng, targetT3])

  // Stage state
  const stageIdx = useCurrentStage()
  const [T, setT] = useState(T_DEFAULT)
  const [tSim, setTSim] = useState(0)
  const [logScale, setLogScale] = useState(false)
  const [running, setRunning] = useState(true)
  const [logToggled, setLogToggled] = useState(false)
  const [tMoved, setTMoved] = useState(false)
  const [peekVisible, setPeekVisible] = useState(false)
  const [stage3Guess, setStage3Guess] = useState<string>('')
  const [stage3Verdict, setStage3Verdict] = useState<'ok' | 'off' | null>(null)

  const setStage = useSetStage()
  const progress = useProgress()
  const complete = useComplete()

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  // Sorted lifetimes for the current T (analytic remap of the shared U samples).
  const sortedTaus = useMemo(() => lifetimesFor(uniforms, T), [uniforms, T])
  // Precomputed step-down curve: (t_i, N_i) after each decay event.
  const stepCurve = useMemo(() => {
    const pts: { t: number; n: number }[] = [{ t: 0, n: N0 }]
    for (let i = 0; i < sortedTaus.length; i++) {
      const tau = sortedTaus[i] as number
      if (tau > T_SIM_MAX) break
      pts.push({ t: tau, n: N0 - (i + 1) })
    }
    return pts
  }, [sortedTaus])

  const nAlive = aliveAt(sortedTaus, tSim)
  const activity = lambdaFromT(T) * nAlive // "decays per time unit"

  const resetStage = useCallback(() => {
    setT(T_DEFAULT)
    setTSim(0)
    setLogScale(false)
    setRunning(true)
    setLogToggled(false)
    setTMoved(false)
    setPeekVisible(false)
    setStage3Guess('')
    setStage3Verdict(null)
  }, [])

  // Ticker — sim runs while running & tSim < T_SIM_MAX. Skip on stage 3 (no live sim).
  useTicker((dt) => {
    if (isStage3) return
    if (!running) return
    setTSim((prev) => {
      const nxt = prev + dt
      if (nxt >= T_SIM_MAX) {
        setRunning(false)
        return T_SIM_MAX
      }
      return nxt
    })
  })

  // Advance rules
  const canSubmit = isStage1
    ? tSim >= T && logToggled && tMoved
    : isStage2
      ? Math.abs(T - targetT2) / targetT2 < STAGE2_TOL
      : stage3Verdict === 'ok'

  const readout = isStage1
    ? `N = ${nAlive} · A = ${activity.toFixed(2)} /u · t = ${tSim.toFixed(1)} u`
    : isStage2
      ? `Δ = ${(100 * Math.abs(T - targetT2) / targetT2).toFixed(1)}% · T½ = ${T.toFixed(1)} u`
      : stage3Verdict === 'ok'
        ? `${labels.match_ok} · T½ = ${targetT3} u`
        : stage3Verdict === 'off'
          ? `${labels.match_off}`
          : `${labels.enter_prompt}`

  useEffect(() => {
    progress(stageIdx / 3, { stage: stageIdx, canSubmit, readout })
  }, [stageIdx, canSubmit, readout, progress])

  useReset(resetStage)

  useNext(() => {
    if (stageIdx < 3) {
      setStage(stageIdx + 1)
      resetStage()
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

  // ─── Stage 3 submit ──────────────────────────────────────────────────
  const submitGuess = useCallback(() => {
    const parsed = Number(stage3Guess.replace(',', '.'))
    if (!Number.isFinite(parsed) || parsed <= 0) return
    const off = Math.abs(parsed - targetT3) / targetT3
    setStage3Verdict(off < STAGE3_TOL ? 'ok' : 'off')
  }, [stage3Guess, targetT3])

  // ─── Grid render ─────────────────────────────────────────────────────
  const cellW = GRID_W / GRID_COLS
  const cellH = GRID_H / GRID_ROWS
  const dotR = Math.min(cellW, cellH) * 0.28
  const dots: React.ReactNode[] = []
  // A stable mapping cell → uniform-index. Use flat i order.
  for (let i = 0; i < N0; i++) {
    const row = Math.floor(i / GRID_COLS)
    const col = i % GRID_COLS
    const cx = GRID_X + (col + 0.5) * cellW
    const cy = GRID_Y + (row + 0.5) * cellH
    // Alive iff this cell's tau > tSim. But cell i's tau isn't the i-th sorted tau —
    // we need the original (unsorted) tau. Recompute per-cell tau from uniforms.
    const u = uniforms[i] as number
    const tau = -Math.log(u) / lambdaFromT(T)
    const alive = tau > tSim
    // "Just decayed" flash: within 0.6u after decay time
    const justDecayed = !alive && tau > tSim - 0.6
    dots.push(
      <circle
        key={i}
        cx={cx}
        cy={cy}
        r={dotR}
        fill={alive ? '#37C9B8' : justDecayed ? '#F97316' : '#2A3244'}
        stroke={alive ? '#37C9B8' : justDecayed ? '#F97316' : '#3A4863'}
        strokeWidth={alive ? 0 : 0.6}
        opacity={alive ? 0.95 : justDecayed ? 0.7 : 0.35}
      />,
    )
  }

  // ─── Plot render ──────────────────────────────────────────────────────
  // Grid + axis
  const plotGrid: React.ReactNode[] = []
  for (let i = 1; i < 5; i++) {
    const gx = PLOT_X + (i / 5) * PLOT_W
    plotGrid.push(
      <line key={`vx${i}`} x1={gx} y1={PLOT_Y} x2={gx} y2={PLOT_Y + PLOT_H} stroke="#12203a" strokeWidth={1} />,
    )
  }
  for (let i = 1; i < 5; i++) {
    const gy = PLOT_Y + (i / 5) * PLOT_H
    plotGrid.push(
      <line key={`gy${i}`} x1={PLOT_X} y1={gy} x2={PLOT_X + PLOT_W} y2={gy} stroke="#12203a" strokeWidth={1} />,
    )
  }

  // Analytic curve N₀ · exp(−λt) — sample densely
  const analyticPath = useMemo(() => {
    const steps = 80
    let d = ''
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * T_SIM_MAX
      const n = analyticN(t, T)
      if (logScale && n < 1) break
      const sx = tToSvgX(t)
      const sy = nToSvgY(n, logScale)
      d += `${i === 0 ? 'M' : 'L'} ${sx.toFixed(1)} ${sy.toFixed(1)} `
    }
    return d
  }, [T, logScale])

  // Stochastic step-down curve, clipped to current tSim
  const stochasticPath = useMemo(() => {
    if (isStage3) return ''
    if (stepCurve.length === 0) return ''
    let d = ''
    let prev: { t: number; n: number } | null = null
    for (const p of stepCurve) {
      if (p.t > tSim) break
      const sx = tToSvgX(p.t)
      const sy = nToSvgY(p.n, logScale)
      if (prev) {
        // horizontal then vertical (step down at decay)
        const psy = nToSvgY(prev.n, logScale)
        d += `L ${sx.toFixed(1)} ${psy.toFixed(1)} L ${sx.toFixed(1)} ${sy.toFixed(1)} `
      } else {
        d += `M ${sx.toFixed(1)} ${sy.toFixed(1)} `
      }
      prev = p
    }
    // Extend the last horizontal to current tSim
    if (prev) {
      const sx = tToSvgX(tSim)
      const sy = nToSvgY(prev.n, logScale)
      d += `L ${sx.toFixed(1)} ${sy.toFixed(1)} `
    }
    return d
  }, [stepCurve, tSim, logScale, isStage3])

  // Target overlay (Stage 2 mystery curve + 3 sample points)
  const targetPath = useMemo(() => {
    if (!isStage2) return ''
    const steps = 80
    let d = ''
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * T_SIM_MAX
      const n = analyticN(t, targetT2)
      if (logScale && n < 1) break
      const sx = tToSvgX(t)
      const sy = nToSvgY(n, logScale)
      d += `${i === 0 ? 'M' : 'L'} ${sx.toFixed(1)} ${sy.toFixed(1)} `
    }
    return d
  }, [isStage2, targetT2, logScale])

  const stage2Samples = useMemo(() => {
    if (!isStage2) return []
    return STAGE2_SAMPLE_FRACTIONS.map((frac) => {
      const t = frac * targetT2
      const n = analyticN(t, targetT2)
      return { t, n }
    })
  }, [isStage2, targetT2])

  // ─── HUD ─────────────────────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`
  const hudTR = isStage3
    ? peekVisible
      ? `${labels.peek_reveal} T½ = ${targetT3} u`
      : `T½ = ?`
    : `λ = ${lambdaFromT(T).toFixed(3)} /u`
  const hudBL = isStage1 ? labels.tip1 : isStage2 ? labels.tip2 : labels.tip3
  const hudBR = isStage1
    ? `N(t) = ${nAlive} · A(t) = ${activity.toFixed(2)} /u`
    : isStage2
      ? `Δ = ${(100 * Math.abs(T - targetT2) / targetT2).toFixed(1)}%`
      : ''

  // ─── Render ───────────────────────────────────────────────────────────
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
          borderRadius: 14,
          userSelect: 'none',
        }}
      >
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" rx={14} />

        {/* ─── Left panel: dot grid (Stages 1 & 2) ─────────────────── */}
        {!isStage3 && (
          <>
            <rect
              x={GRID_X - 8}
              y={GRID_Y - 8}
              width={GRID_W + 16}
              height={GRID_H + 16}
              fill="none"
              stroke="#12203a"
              strokeWidth={1}
              rx={6}
            />
            <text
              x={GRID_X}
              y={GRID_Y - 14}
              fill="#6C7A93"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={11}
              letterSpacing="0.1em"
            >
              N₀ = {N0} · {labels.nuclei}
            </text>
            {dots}
          </>
        )}

        {/* ─── Left panel replacement on Stage 3: sample-points card ─── */}
        {isStage3 && (
          <>
            <rect
              x={GRID_X - 8}
              y={GRID_Y - 8}
              width={GRID_W + 16}
              height={GRID_H + 16}
              fill="none"
              stroke="#12203a"
              strokeWidth={1}
              rx={6}
            />
            <text
              x={GRID_X}
              y={GRID_Y - 14}
              fill="#6C7A93"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={11}
              letterSpacing="0.1em"
            >
              {labels.field_measurements}
            </text>
            <text
              x={GRID_X + GRID_W / 2}
              y={GRID_Y + 30}
              fill="#B9C4D6"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={12}
              textAnchor="middle"
            >
              N₀ = {N0}
            </text>
            {stage3Points.map((p, i) => (
              <text
                key={i}
                x={GRID_X + GRID_W / 2}
                y={GRID_Y + 68 + i * 32}
                fill="#F9A968"
                fontFamily="'JetBrains Mono', monospace"
                fontSize={14}
                textAnchor="middle"
              >
                t = {p.t.toFixed(1)} u  →  N = {p.n}
              </text>
            ))}
            <text
              x={GRID_X + GRID_W / 2}
              y={GRID_Y + GRID_H - 20}
              fill="#6C7A93"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
              textAnchor="middle"
            >
              {labels.find_T}
            </text>
          </>
        )}

        {/* ─── Right panel: N(t) plot ──────────────────────────────── */}
        <rect
          x={PLOT_X - 8}
          y={PLOT_Y - 8}
          width={PLOT_W + 16}
          height={PLOT_H + 16}
          fill="none"
          stroke="#12203a"
          strokeWidth={1}
          rx={6}
        />
        {plotGrid}
        {/* Axes */}
        <line
          x1={PLOT_X}
          y1={PLOT_Y + PLOT_H}
          x2={PLOT_X + PLOT_W}
          y2={PLOT_Y + PLOT_H}
          stroke="#3A4863"
          strokeWidth={1.5}
        />
        <line x1={PLOT_X} y1={PLOT_Y} x2={PLOT_X} y2={PLOT_Y + PLOT_H} stroke="#3A4863" strokeWidth={1.5} />
        {/* Axis labels */}
        <text
          x={PLOT_X + PLOT_W - 6}
          y={PLOT_Y + PLOT_H + 18}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={10}
          textAnchor="end"
        >
          t (u) →
        </text>
        <text
          x={PLOT_X + 6}
          y={PLOT_Y - 6}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={10}
        >
          N {logScale ? '(log)' : ''} ↑
        </text>
        {/* Tick labels */}
        {[0, 40, 80, 120].map((tv) => (
          <text
            key={`tk${tv}`}
            x={tToSvgX(tv)}
            y={PLOT_Y + PLOT_H + 14}
            fill="#54617A"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={9}
            textAnchor="middle"
          >
            {tv}
          </text>
        ))}
        {(logScale ? [1, 10, 100] : [0, 50, 100]).map((nv) => (
          <text
            key={`nk${nv}`}
            x={PLOT_X - 6}
            y={nToSvgY(nv, logScale) + 3}
            fill="#54617A"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={9}
            textAnchor="end"
          >
            {nv}
          </text>
        ))}
        {/* T½ vertical marker (only on stages 1 & 2 to keep evaluate clean) */}
        {!isStage3 && (
          <>
            <line
              x1={tToSvgX(T)}
              y1={PLOT_Y}
              x2={tToSvgX(T)}
              y2={PLOT_Y + PLOT_H}
              stroke="#37C9B8"
              strokeWidth={1}
              strokeDasharray="3 4"
              opacity={0.5}
            />
            <text
              x={tToSvgX(T)}
              y={PLOT_Y - 4}
              fill="#37C9B8"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={9}
              textAnchor="middle"
            >
              T½
            </text>
            {/* N₀/2 horizontal reference */}
            <line
              x1={PLOT_X}
              y1={nToSvgY(N0 / 2, logScale)}
              x2={PLOT_X + PLOT_W}
              y2={nToSvgY(N0 / 2, logScale)}
              stroke="#37C9B8"
              strokeWidth={1}
              strokeDasharray="3 4"
              opacity={0.35}
            />
          </>
        )}
        {/* Analytic curve (reference) */}
        {!isStage3 && (
          <path
            d={analyticPath}
            fill="none"
            stroke="#37C9B8"
            strokeWidth={1.4}
            strokeDasharray="4 5"
            opacity={0.55}
          />
        )}
        {/* Stage 2: mystery target curve + sample points */}
        {isStage2 && (
          <>
            <path
              d={targetPath}
              fill="none"
              stroke="#F97316"
              strokeWidth={2}
              opacity={0.9}
            />
            {stage2Samples.map((s, i) => (
              <g key={`s2p${i}`}>
                <circle cx={tToSvgX(s.t)} cy={nToSvgY(s.n, logScale)} r={5} fill="#F97316" />
                <circle
                  cx={tToSvgX(s.t)}
                  cy={nToSvgY(s.n, logScale)}
                  r={9}
                  fill="none"
                  stroke="#F97316"
                  strokeWidth={1}
                  opacity={0.5}
                />
              </g>
            ))}
          </>
        )}
        {/* Stochastic step curve */}
        {stochasticPath && (
          <path d={stochasticPath} fill="none" stroke="#F9A968" strokeWidth={2} />
        )}
        {/* Stage 3: sample points on the graph */}
        {isStage3 &&
          stage3Points.map((p, i) => (
            <g key={`s3p${i}`}>
              <circle cx={tToSvgX(p.t)} cy={nToSvgY(p.n, logScale)} r={5} fill="#F97316" />
              <line
                x1={tToSvgX(p.t)}
                y1={PLOT_Y + PLOT_H}
                x2={tToSvgX(p.t)}
                y2={nToSvgY(p.n, logScale)}
                stroke="#F97316"
                strokeWidth={0.8}
                strokeDasharray="2 3"
                opacity={0.4}
              />
            </g>
          ))}
        {/* Stage 3 peek: reveal true curve briefly */}
        {isStage3 && peekVisible && (
          <path
            d={(() => {
              const steps = 80
              let d = ''
              for (let i = 0; i <= steps; i++) {
                const t = (i / steps) * T_SIM_MAX
                const n = analyticN(t, targetT3)
                if (logScale && n < 1) break
                const sx = tToSvgX(t)
                const sy = nToSvgY(n, logScale)
                d += `${i === 0 ? 'M' : 'L'} ${sx.toFixed(1)} ${sy.toFixed(1)} `
              }
              return d
            })()}
            fill="none"
            stroke="#37C9B8"
            strokeWidth={1.6}
            strokeDasharray="4 5"
            opacity={0.75}
          />
        )}
        {/* Sim-clock cursor */}
        {!isStage3 && (
          <line
            x1={tToSvgX(tSim)}
            y1={PLOT_Y}
            x2={tToSvgX(tSim)}
            y2={PLOT_Y + PLOT_H}
            stroke="#F9A968"
            strokeWidth={1}
            opacity={0.4}
          />
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
            color: '#37C9B8',
            textAlign: 'right',
            zIndex: 5,
            pointerEvents: 'none',
          }}
        >
          {hudBR}
        </div>
      )}

      {/* ─── Top-right column: LOG button + (stages 1–2) vertical T½ slider ─── */}
      <button
        type="button"
        onClick={() => {
          setLogScale((v) => !v)
          setLogToggled(true)
        }}
        style={{
          position: 'absolute',
          top: '8rem',
          right: '3rem',
          padding: '1rem 2.4rem',
          background: logScale ? '#37C9B8' : 'transparent',
          color: logScale ? '#0D1524' : '#37C9B8',
          border: `0.2rem solid #37C9B8`,
          borderRadius: '10rem',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '1.9rem',
          fontWeight: 700,
          letterSpacing: '0.1em',
          cursor: 'pointer',
          zIndex: 6,
        }}
      >
        <i
          className="bi bi-graph-up"
          style={{ marginInlineEnd: '0.6rem', fontSize: '2rem', verticalAlign: '-0.2rem' }}
        />
        {labels.log_toggle}
      </button>

      {!isStage3 && (
        <div
          style={{
            position: 'absolute',
            top: '14rem',
            right: '3rem',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '1rem',
            zIndex: 6,
          }}
        >
          <div
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '1.9rem',
              color: '#6C7A93',
            }}
          >
            {T_MAX}
          </div>
          <div
            style={{
              width: '2rem',
              height: '30rem',
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <input
              type="range"
              min={T_MIN}
              max={T_MAX}
              step={0.5}
              value={T}
              onChange={(e) => {
                setT(Number(e.target.value))
                setTMoved(true)
              }}
              style={{
                width: '30rem',
                height: '2rem',
                transform: 'rotate(-90deg)',
                transformOrigin: 'center',
                accentColor: '#37C9B8',
                cursor: 'pointer',
              }}
            />
          </div>
          <div
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '1.9rem',
              color: '#6C7A93',
            }}
          >
            {T_MIN}
          </div>
          <div
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '1.7rem',
              color: '#37C9B8',
              marginTop: '0.4rem',
            }}
          >
            T½ = {T.toFixed(1)}
          </div>
        </div>
      )}

      {/* Stage 3 only: numeric input + submit at bottom center */}
      {isStage3 && (
        <div
          style={{
            position: 'absolute',
            bottom: '10rem',
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            alignItems: 'center',
            gap: '1.4rem',
            zIndex: 6,
          }}
        >
          <label
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '2rem',
              color: '#6C7A93',
            }}
          >
            T½ =
          </label>
          <input
            type="text"
            inputMode="decimal"
            value={stage3Guess}
            placeholder="?"
            onChange={(e) => {
              setStage3Guess(e.target.value)
              setStage3Verdict(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitGuess()
            }}
            style={{
              width: '12rem',
              padding: '1rem 1.4rem',
              background: 'rgba(30,42,64,0.85)',
              color: '#F9A968',
              border: `0.2rem solid ${stage3Verdict === 'off' ? '#F97316' : '#3A4863'}`,
              borderRadius: '0.8rem',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '2.2rem',
              fontWeight: 700,
              textAlign: 'center',
              outline: 'none',
            }}
          />
          <span
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '2rem',
              color: '#6C7A93',
            }}
          >
            u
          </span>
          <button
            type="button"
            onClick={submitGuess}
            style={{
              padding: '1rem 2.4rem',
              background: stage3Verdict === 'ok' ? '#37C9B8' : '#F97316',
              color: stage3Verdict === 'ok' ? '#0D1524' : '#FFFFFF',
              border: 'none',
              borderRadius: '10rem',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '1.9rem',
              fontWeight: 700,
              letterSpacing: '0.1em',
              cursor: 'pointer',
            }}
          >
            <i
              className="bi bi-check2"
              style={{ marginInlineEnd: '0.6rem', fontSize: '2rem', verticalAlign: '-0.2rem' }}
            />
            {labels.submit}
          </button>
        </div>
      )}
    </div>
  )
}
