import { useCallback, useEffect, useMemo, useState } from 'react'
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
  useTicker,
} from '@physics/sdk/react'
import { getHintFor, getStagesFor } from './stages'
import en from '../i18n/en.json'

// ─── Scene constants ────────────────────────────────────────────────────
const W = 800
const H = 450
const GRID_ROWS = 10
const GRID_COLS = 10
const N0 = GRID_ROWS * GRID_COLS

// Grid panel (left half) — U-235 fuel pellet
const GRID_X = 32
const GRID_Y = 60
const GRID_W = 340
const GRID_H = 340

// Plot panel (right half) — remaining fuel N(t)
const PLOT_X = 400
const PLOT_Y = 60
const PLOT_W = 300
const PLOT_H = 340

// Multiplication-factor slider bounds (dimensionless).
// k = expected neutrons produced per fission that survive to trigger the next.
// k < 1: subcritical (dies out); k = 1: critical; k > 1: supercritical.
const K_MIN = 0.5
const K_MAX = 2.0
const K_DEFAULT = 1.0

// Characteristic pellet time (fixed geometric constant, in "time units" u).
// Effective decay of remaining fuel: alpha = k / TAU_0.
// Effective half-life of remaining fuel: T½_eff = τ₀ · ln 2 / k.
const TAU_0 = 20

// Sim clock cap — chosen so k=0.5 (slowest decay) still shows a clear tail.
const T_SIM_MAX = 80

// Seed-picked target k values (span sub / near-critical / supercritical).
const STAGE2_TARGETS = [0.7, 1.0, 1.3, 1.6, 1.9]
const STAGE3_TARGETS = [0.6, 0.9, 1.2, 1.5, 1.8]

// Tolerances
const STAGE2_TOL = 0.05 // ±5% on |k_student − k_target| / k_target
const STAGE3_TOL = 0.03 // ±3% on the typed-in k

// Sample-point times, expressed as multiples of the target effective half-life.
// Chosen to bracket the burn: pre-, at-, and post-half-life readings.
const STAGE2_SAMPLE_FRACTIONS = [0.5, 1.0, 2.0]
const STAGE3_SAMPLE_FRACTIONS = [0.6, 1.2, 2.0, 2.8]

// Gaussian noise applied to Evaluate assay readings (relative to N₀).
const STAGE3_NOISE_SIGMA = 0.04

const dict = { en } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── Physics helpers ────────────────────────────────────────────────────
// Effective decay constant: higher k = neutrons multiply faster = fuel burns faster.
function lambdaEffFromK(k: number): number {
  return k / TAU_0
}
// Effective half-life of the remaining fuel.
function halfLifeEff(k: number): number {
  return (TAU_0 * Math.LN2) / k
}
// Analytic N(t): exact closed form. Use everywhere — grid, plot, curves.
function analyticN(t: number, k: number): number {
  return N0 * Math.exp(-lambdaEffFromK(k) * t)
}

/** From N0 uniform draws U∈(0,1], derive sorted fission times for the current k. */
function lifetimesFor(uniforms: readonly number[], k: number): number[] {
  const alpha = lambdaEffFromK(k)
  const taus = uniforms.map((u) => -Math.log(u) / alpha)
  return taus.sort((a, b) => a - b)
}

/** Count of intact ²³⁵U nuclei still remaining at time t. */
function aliveAt(sortedTaus: readonly number[], t: number): number {
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

  // Fork 1 — PHYSICS stream: N0 uniform draws for fission-time remapping.
  // Must be forked before any other fork (fork position is API contract).
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

  // Target k selection — seed-modulo (no fork needed).
  const targetK2 = useMemo(
    () => STAGE2_TARGETS[seed % STAGE2_TARGETS.length] as number,
    [seed],
  )
  const targetK3 = useMemo(
    () => STAGE3_TARGETS[seed % STAGE3_TARGETS.length] as number,
    [seed],
  )

  // Fork 2 — NOISE stream: Gaussian jitter on stage-3 assay readings.
  // Double-fork to advance past the physics fork position and keep this stream
  // isolated from any future cosmetic fork we might add.
  const stage3Points = useMemo(() => {
    const noiseRng = rootRng.fork().fork()
    const T_eff = halfLifeEff(targetK3)
    return STAGE3_SAMPLE_FRACTIONS.map((frac) => {
      const t = frac * T_eff
      const nMean = analyticN(t, targetK3)
      const raw = nMean + N0 * noiseRng.gauss(0, STAGE3_NOISE_SIGMA)
      const n = Math.max(0, Math.min(N0, raw))
      return { t, n: Math.round(n) }
    })
  }, [rootRng, targetK3])

  // ── Per-stage state ─────────────────────────────────────────
  const stageIdx = useCurrentStage()
  const [k, setK] = useState(K_DEFAULT)
  const [tSim, setTSim] = useState(0)
  const [logScale, setLogScale] = useState(false)
  const [running, setRunning] = useState(true)
  const [logToggled, setLogToggled] = useState(false)
  const [kMoved, setKMoved] = useState(false)
  const [peekVisible, setPeekVisible] = useState(false)
  const [stage3Guess, setStage3Guess] = useState<string>('')
  const [stage3Verdict, setStage3Verdict] = useState<'ok' | 'off' | null>(null)

  const setStage = useSetStage()
  const progress = useProgress()
  const complete = useComplete()

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  // Sorted fission times remapped analytically from the frozen uniform draws.
  // Changing k does NOT re-sample — the same U keeps its identity atom.
  const sortedTaus = useMemo(() => lifetimesFor(uniforms, k), [uniforms, k])
  // Precomputed step-down curve: one point per fission event.
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
  const lambdaEff = lambdaEffFromK(k)
  const activity = lambdaEff * nAlive // fissions per time unit

  const resetStage = useCallback(() => {
    setK(K_DEFAULT)
    setTSim(0)
    setLogScale(false)
    setRunning(true)
    setLogToggled(false)
    setKMoved(false)
    setPeekVisible(false)
    setStage3Guess('')
    setStage3Verdict(null)
  }, [])
  useReset(resetStage)

  // Ticker — no live sim on Evaluate (§4.7 anti-friction).
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

  // Advance predicates
  const canSubmit = isStage1
    ? tSim >= halfLifeEff(k) && logToggled && kMoved
    : isStage2
      ? Math.abs(k - targetK2) / targetK2 < STAGE2_TOL
      : stage3Verdict === 'ok'

  useEffect(() => {
    progress(stageIdx / 3, { stage: stageIdx, canSubmit })
  }, [stageIdx, canSubmit, progress])

  useNext(() => {
    if (stageIdx < 3) {
      setStage(stageIdx + 1)
      resetStage()
    } else {
      complete({ success: true })
    }
  })

  // Peek: 1.5 s curve reveal. Never reveals the k value in the HUD.
  usePeek(() => {
    if (!isStage3) return
    setPeekVisible(true)
  })
  useEffect(() => {
    if (!peekVisible) return
    const timer = setTimeout(() => setPeekVisible(false), 1500)
    return () => clearTimeout(timer)
  }, [peekVisible])

  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  // Stage 3 submit
  const submitGuess = useCallback(() => {
    const parsed = Number(stage3Guess.replace(',', '.'))
    if (!Number.isFinite(parsed) || parsed <= 0) return
    const off = Math.abs(parsed - targetK3) / targetK3
    setStage3Verdict(off < STAGE3_TOL ? 'ok' : 'off')
  }, [stage3Guess, targetK3])

  // ─── Grid render ─────────────────────────────────────────────────────
  const cellW = GRID_W / GRID_COLS
  const cellH = GRID_H / GRID_ROWS
  const dotR = Math.min(cellW, cellH) * 0.28
  const dots: React.ReactNode[] = []
  for (let i = 0; i < N0; i++) {
    const row = Math.floor(i / GRID_COLS)
    const col = i % GRID_COLS
    const cx = GRID_X + (col + 0.5) * cellW
    const cy = GRID_Y + (row + 0.5) * cellH
    const u = uniforms[i] as number
    const tau = -Math.log(u) / lambdaEff
    const intact = tau > tSim
    // "Just fissioned" flash: within 0.6 u after the fission event
    const justFissioned = !intact && tau > tSim - 0.6
    dots.push(
      <circle
        key={i}
        cx={cx}
        cy={cy}
        r={dotR}
        fill={intact ? '#37C9B8' : justFissioned ? '#F97316' : '#2A3244'}
        stroke={intact ? '#37C9B8' : justFissioned ? '#F97316' : '#3A4863'}
        strokeWidth={intact ? 0 : 0.6}
        opacity={intact ? 0.95 : justFissioned ? 0.7 : 0.35}
      />,
    )
  }

  // ─── Plot render ──────────────────────────────────────────────────────
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

  // Analytic N(t) reference — exact closed form
  const analyticPath = useMemo(() => {
    const steps = 80
    let d = ''
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * T_SIM_MAX
      const n = analyticN(t, k)
      if (logScale && n < 1) break
      const sx = tToSvgX(t)
      const sy = nToSvgY(n, logScale)
      d += `${i === 0 ? 'M' : 'L'} ${sx.toFixed(1)} ${sy.toFixed(1)} `
    }
    return d
  }, [k, logScale])

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
        const psy = nToSvgY(prev.n, logScale)
        d += `L ${sx.toFixed(1)} ${psy.toFixed(1)} L ${sx.toFixed(1)} ${sy.toFixed(1)} `
      } else {
        d += `M ${sx.toFixed(1)} ${sy.toFixed(1)} `
      }
      prev = p
    }
    if (prev) {
      const sx = tToSvgX(tSim)
      const sy = nToSvgY(prev.n, logScale)
      d += `L ${sx.toFixed(1)} ${sy.toFixed(1)} `
    }
    return d
  }, [stepCurve, tSim, logScale, isStage3])

  // Stage 2 mystery target curve
  const targetPath = useMemo(() => {
    if (!isStage2) return ''
    const steps = 80
    let d = ''
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * T_SIM_MAX
      const n = analyticN(t, targetK2)
      if (logScale && n < 1) break
      const sx = tToSvgX(t)
      const sy = nToSvgY(n, logScale)
      d += `${i === 0 ? 'M' : 'L'} ${sx.toFixed(1)} ${sy.toFixed(1)} `
    }
    return d
  }, [isStage2, targetK2, logScale])

  const stage2Samples = useMemo(() => {
    if (!isStage2) return []
    const T_eff = halfLifeEff(targetK2)
    return STAGE2_SAMPLE_FRACTIONS.map((frac) => {
      const t = frac * T_eff
      const n = analyticN(t, targetK2)
      return { t, n }
    })
  }, [isStage2, targetK2])

  // The effective-half-life vertical marker on the plot (stages 1+2 only).
  const T_eff_current = halfLifeEff(k)

  // ─── HUD ─────────────────────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`
  // TR: primary readout. On evaluate, "k = ?" — even during peek, the k value
  // is NEVER shown. Peek only reveals the curve.
  const hudTRPrimary = isStage3
    ? peekVisible
      ? `${labels.peek_reveal} ${labels.nuclei}`
      : `k = ?`
    : isStage2
      ? `Δ = ${(100 * Math.abs(k - targetK2) / targetK2).toFixed(1)}%`
      : `k = ${k.toFixed(2)}`
  // TR secondary — moved OFF the BR corner (BR reserved for parent chrome).
  const hudTRSecondary = isStage1
    ? `N = ${nAlive} · A = ${activity.toFixed(2)} /u · t = ${tSim.toFixed(1)} u`
    : isStage2
      ? `k = ${k.toFixed(2)}`
      : stage3Verdict === 'ok'
        ? `${labels.match_ok} · k = ${targetK3.toFixed(2)}`
        : stage3Verdict === 'off'
          ? `${labels.match_off}`
          : `${labels.enter_prompt}`
  const hudBL = isStage1 ? labels.tip1 : isStage2 ? labels.tip2 : labels.tip3

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
          userSelect: 'none',
        }}
      >
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        {/* ─── Left panel: fuel-pellet dot grid (Stages 1 & 2) ────── */}
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

        {/* ─── Left panel replacement on Stage 3: reactor-logbook card ─── */}
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
              N₀ = {N0} · τ₀ = {TAU_0} u
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
        <line
          x1={PLOT_X}
          y1={PLOT_Y + PLOT_H}
          x2={PLOT_X + PLOT_W}
          y2={PLOT_Y + PLOT_H}
          stroke="#3A4863"
          strokeWidth={1.5}
        />
        <line x1={PLOT_X} y1={PLOT_Y} x2={PLOT_X} y2={PLOT_Y + PLOT_H} stroke="#3A4863" strokeWidth={1.5} />
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
        {[0, 20, 40, 60, 80].map((tv) => (
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
        {/* Effective half-life vertical marker (stages 1+2 only) */}
        {!isStage3 && T_eff_current <= T_SIM_MAX && (
          <>
            <line
              x1={tToSvgX(T_eff_current)}
              y1={PLOT_Y}
              x2={tToSvgX(T_eff_current)}
              y2={PLOT_Y + PLOT_H}
              stroke="#37C9B8"
              strokeWidth={1}
              strokeDasharray="3 4"
              opacity={0.5}
            />
            <text
              x={tToSvgX(T_eff_current)}
              y={PLOT_Y - 4}
              fill="#37C9B8"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={9}
              textAnchor="middle"
            >
              T½,eff
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
        {/* Analytic curve (reference) — stages 1+2 only */}
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
            <path d={targetPath} fill="none" stroke="#F97316" strokeWidth={2} opacity={0.9} />
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
        {/* Stochastic step curve (stages 1+2 only) */}
        {stochasticPath && <path d={stochasticPath} fill="none" stroke="#F9A968" strokeWidth={2} />}
        {/* Stage 3: assay sample points on the graph (required info) */}
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
        {/* Stage 3 peek: reveal true curve briefly (never reveals the k value) */}
        {isStage3 && peekVisible && (
          <path
            d={(() => {
              const steps = 80
              let d = ''
              for (let i = 0; i <= steps; i++) {
                const t = (i / steps) * T_SIM_MAX
                const n = analyticN(t, targetK3)
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
        {/* Sim-clock cursor (stages 1+2 only) */}
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

      {/* ─── HUD overlays (TL / TR / BL only; BR reserved for parent chrome) ─── */}
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
      {/* TR — primary + secondary line stacked (moved off BR per §4.3) */}
      <div
        style={{
          position: 'absolute',
          top: '3rem',
          right: '3rem',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: '0.6rem',
          fontFamily: "'JetBrains Mono', monospace",
          zIndex: 5,
          pointerEvents: 'none',
        }}
      >
        <div style={{ fontSize: '2.3rem', letterSpacing: '0.08em', color: '#37C9B8' }}>
          {hudTRPrimary}
        </div>
        <div style={{ fontSize: '1.6rem', letterSpacing: '0.06em', color: '#F9A968' }}>
          {hudTRSecondary}
        </div>
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

      {/* ─── LOG toggle (all stages) ────────────────────────────────── */}
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

      {/* ─── k slider (stages 1+2 only — hidden on Evaluate per §4.7) ── */}
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
            {K_MAX.toFixed(1)}
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
              min={K_MIN}
              max={K_MAX}
              step={0.05}
              value={k}
              onChange={(e) => {
                setK(Number(e.target.value))
                setKMoved(true)
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
            {K_MIN.toFixed(1)}
          </div>
          <div
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '1.5rem',
              color: '#6C7A93',
              marginTop: '0.2rem',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
            }}
          >
            {labels.absorber}
          </div>
        </div>
      )}

      {/* ─── Stage 3: numeric input + submit (bottom-center) ──────── */}
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
            k =
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
              fontSize: '1.7rem',
              color: '#6C7A93',
              letterSpacing: '0.06em',
            }}
          >
            {labels.tau0_note}
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
