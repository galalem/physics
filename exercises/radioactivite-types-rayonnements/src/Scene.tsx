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

// Panel geometry
const GRID_X = 32
const GRID_Y = 60
const GRID_W = 340
const GRID_H = 340

const PLOT_X = 400
const PLOT_Y = 60
const PLOT_W = 300
const PLOT_H = 340

// Sim clock caps out here — used as horizontal extent for the observe plot.
const T_SIM_MAX = 120

// Ray palette — each ray type gets its own "just decayed" flash colour so the
// grid reinforces which ray the isotope emits.
type RayType = 'alpha' | 'beta_minus' | 'beta_plus' | 'gamma'
const RAY_COLOR: Record<RayType, string> = {
  alpha: '#C084FC',       // purple — heavy helium nucleus
  beta_minus: '#F9A968',  // amber — electron
  beta_plus: '#F472B6',   // pink — positron
  gamma: '#5FE1F0',       // cyan — photon
}
const RAY_GLYPH: Record<RayType, string> = {
  alpha: 'α',
  beta_minus: 'β⁻',
  beta_plus: 'β⁺',
  gamma: 'γ',
}
const RAY_ORDER: readonly RayType[] = ['alpha', 'beta_minus', 'beta_plus', 'gamma']

// ─── Isotope catalogue (stage 1 free-play picker) ───────────────────────
// T-values are educational sim-scale (in u); not real physics numbers.
type Isotope = {
  id: string
  symbol: string
  parentA: number
  parentZ: number
  daughterSymbol: string
  daughterA: number
  daughterZ: number
  ray: RayType
  T: number
}
const ISOTOPES: readonly Isotope[] = [
  { id: 'U238',  symbol: 'U',  parentA: 238, parentZ: 92, daughterSymbol: 'Th', daughterA: 234, daughterZ: 90, ray: 'alpha',      T: 18 },
  { id: 'C14',   symbol: 'C',  parentA: 14,  parentZ: 6,  daughterSymbol: 'N',  daughterA: 14,  daughterZ: 7,  ray: 'beta_minus', T: 15 },
  { id: 'Na22',  symbol: 'Na', parentA: 22,  parentZ: 11, daughterSymbol: 'Ne', daughterA: 22,  daughterZ: 10, ray: 'beta_plus',  T: 12 },
  { id: 'Co60m', symbol: 'Co*',parentA: 60,  parentZ: 27, daughterSymbol: 'Co', daughterA: 60,  daughterZ: 27, ray: 'gamma',      T: 8  },
]

// ─── Quiz pool (stages 2 + 3) ───────────────────────────────────────────
// 8 real curriculum-style transformations. Seeded shuffle picks 3 for stage 2
// and 3 for stage 3.
type QuizItem = {
  parentSymbol: string
  parentA: number
  parentZ: number
  daughterSymbol: string
  daughterA: number
  daughterZ: number
  ray: RayType
}
const QUIZ_POOL: readonly QuizItem[] = [
  { parentSymbol: 'U',  parentA: 238, parentZ: 92, daughterSymbol: 'Th', daughterA: 234, daughterZ: 90, ray: 'alpha' },
  { parentSymbol: 'Ra', parentA: 226, parentZ: 88, daughterSymbol: 'Rn', daughterA: 222, daughterZ: 86, ray: 'alpha' },
  { parentSymbol: 'C',  parentA: 14,  parentZ: 6,  daughterSymbol: 'N',  daughterA: 14,  daughterZ: 7,  ray: 'beta_minus' },
  { parentSymbol: 'P',  parentA: 32,  parentZ: 15, daughterSymbol: 'S',  daughterA: 32,  daughterZ: 16, ray: 'beta_minus' },
  { parentSymbol: 'Na', parentA: 22,  parentZ: 11, daughterSymbol: 'Ne', daughterA: 22,  daughterZ: 10, ray: 'beta_plus' },
  { parentSymbol: 'F',  parentA: 18,  parentZ: 9,  daughterSymbol: 'O',  daughterA: 18,  daughterZ: 8,  ray: 'beta_plus' },
  { parentSymbol: 'Co*',parentA: 60,  parentZ: 27, daughterSymbol: 'Co', daughterA: 60,  daughterZ: 27, ray: 'gamma' },
  { parentSymbol: 'Tc*',parentA: 99,  parentZ: 43, daughterSymbol: 'Tc', daughterA: 99,  daughterZ: 43, ray: 'gamma' },
]
const STREAK_TARGET = 3

// ─── Locale wiring ──────────────────────────────────────────────────────
const dict = { en } as const
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
/** From N₀ uniform draws U∈(0,1], derive sorted lifetimes for a given λ. */
function lifetimesFor(uniforms: readonly number[], T: number): number[] {
  const lambda = lambdaFromT(T)
  return uniforms.map((u) => -Math.log(u) / lambda).sort((a, b) => a - b)
}
// ─── Coordinate helpers ─────────────────────────────────────────────────
function tToSvgX(t: number): number {
  return PLOT_X + (t / T_SIM_MAX) * PLOT_W
}
function nToSvgY(n: number): number {
  return PLOT_Y + PLOT_H - (n / N0) * PLOT_H
}

// ─── Component ──────────────────────────────────────────────────────────
export default function Scene() {
  const { locale, seed } = useInit()
  const stages = useMemo(() => getStagesFor(locale), [locale])
  useDeclareStages(stages)
  const labels = useMemo(() => svgLabels(locale), [locale])

  // ── Fork discipline ─────────────────────────────────────────────────
  // Fork 1 (physics): N₀ uniforms for grid lifetimes. Consumed once at init.
  // Fork 2 (quiz): shuffle of the quiz pool. Consumed once.
  // Rule: physics fork FIRST — cosmetic / quiz forks after — never reorder.
  const rootRng = useSeed()
  const uniforms = useMemo(() => {
    const physics = rootRng.fork()
    const out: number[] = []
    for (let i = 0; i < N0; i++) {
      let u = physics.next()
      if (u === 0) u = 1e-12
      out.push(u)
    }
    return out
  }, [rootRng])
  const shuffledPool = useMemo(() => {
    const quiz = rootRng.fork().fork()
    return quiz.shuffle(QUIZ_POOL)
  }, [rootRng])
  // Non-overlapping slices of the shuffled pool: first 3 for stage 2, next 3 for stage 3.
  const stage2Items = useMemo(() => shuffledPool.slice(0, STREAK_TARGET), [shuffledPool])
  const stage3Items = useMemo(() => shuffledPool.slice(STREAK_TARGET, 2 * STREAK_TARGET), [shuffledPool])

  // Seed-picked starting isotope for stage 1 (varies per attempt so students
  // don't always land on the same one first).
  const initialIsotopeIdx = useMemo(() => seed % ISOTOPES.length, [seed])

  // ── Per-stage state ─────────────────────────────────────────────────
  const stageIdx = useCurrentStage()
  const setStage = useSetStage()
  const progress = useProgress()
  const complete = useComplete()

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  // Stage 1
  const [isotopeIdx, setIsotopeIdx] = useState(initialIsotopeIdx)
  const [tSim, setTSim] = useState(0)
  const [running, setRunning] = useState(true)
  const [isotopesSeen, setIsotopesSeen] = useState<Set<number>>(() => new Set([initialIsotopeIdx]))

  // Stage 2
  const [quiz2Idx, setQuiz2Idx] = useState(0)
  const [streak2, setStreak2] = useState(0)
  const [feedback2, setFeedback2] = useState<'ok' | 'off' | null>(null)

  // Stage 3
  const [quiz3Idx, setQuiz3Idx] = useState(0)
  const [streak3, setStreak3] = useState(0)
  const [aInput, setAInput] = useState('')
  const [zInput, setZInput] = useState('')
  const [feedback3, setFeedback3] = useState<'ok' | 'off' | null>(null)
  const [peekVisible, setPeekVisible] = useState(false)

  // ── Derived per-stage data ──────────────────────────────────────────
  const isotope = ISOTOPES[isotopeIdx] as Isotope
  const currentQuiz2 = stage2Items[quiz2Idx % stage2Items.length] as QuizItem
  const currentQuiz3 = stage3Items[quiz3Idx % stage3Items.length] as QuizItem

  // For the animated grid we always drive it from ONE T. Stage 1 = current
  // isotope's T. Stage 2 = current quiz item's isotope-equivalent T (we reuse
  // a mid-range value so the animation is watchable regardless of item).
  const gridT = isStage2 ? 15 : isotope.T
  const gridRay: RayType = isStage2 ? currentQuiz2.ray : isotope.ray

  const sortedTaus = useMemo(() => lifetimesFor(uniforms, gridT), [uniforms, gridT])

  // ── Reset ───────────────────────────────────────────────────────────
  const resetStage = useCallback(() => {
    setIsotopeIdx(initialIsotopeIdx)
    setTSim(0)
    setRunning(true)
    setIsotopesSeen(new Set([initialIsotopeIdx]))
    setQuiz2Idx(0)
    setStreak2(0)
    setFeedback2(null)
    setQuiz3Idx(0)
    setStreak3(0)
    setAInput('')
    setZInput('')
    setFeedback3(null)
    setPeekVisible(false)
  }, [initialIsotopeIdx])
  useReset(resetStage)

  // ── Ticker: drives sim on stages 1 and 2. Killed on stage 3. ────────
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

  // ── Advance predicates ──────────────────────────────────────────────
  const canSubmit = isStage1
    ? isotopesSeen.size >= 3 && tSim >= isotope.T
    : isStage2
      ? streak2 >= STREAK_TARGET
      : streak3 >= STREAK_TARGET

  useEffect(() => {
    progress(stageIdx / 3, { stage: stageIdx, canSubmit })
  }, [stageIdx, canSubmit, progress])

  useNext(() => {
    if (stageIdx < 3) {
      setStage(stageIdx + 1)
      // Do not full-reset — advance clears per-next-stage state only:
      setTSim(0)
      setRunning(true)
      setFeedback2(null)
      setFeedback3(null)
      setAInput('')
      setZInput('')
      setPeekVisible(false)
    } else {
      complete({ success: true })
    }
  })

  // ── Peek (stage 3 only — strategy hint, never the answer) ───────────
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

  // ── Stage 1: isotope pick handler ───────────────────────────────────
  const pickIsotope = useCallback((idx: number) => {
    setIsotopeIdx(idx)
    setTSim(0)
    setRunning(true)
    setIsotopesSeen((prev) => {
      const nxt = new Set(prev)
      nxt.add(idx)
      return nxt
    })
  }, [])

  // ── Stage 2: MCQ submit ─────────────────────────────────────────────
  const submitRay = useCallback((chosen: RayType) => {
    if (chosen === currentQuiz2.ray) {
      const nextStreak = streak2 + 1
      setStreak2(nextStreak)
      setFeedback2('ok')
      // Advance to next scenario after a beat (still shows verdict flash).
      if (nextStreak < STREAK_TARGET) {
        setQuiz2Idx((i) => (i + 1) % stage2Items.length)
      }
    } else {
      setStreak2(0)
      setFeedback2('off')
      setQuiz2Idx((i) => (i + 1) % stage2Items.length)
    }
    // Reset the grid clock so the new isotope's decay starts fresh.
    setTSim(0)
    setRunning(true)
  }, [currentQuiz2.ray, streak2, stage2Items.length])

  // ── Stage 3: numeric submit ─────────────────────────────────────────
  const submitDaughter = useCallback(() => {
    const a = Number(aInput.trim())
    const z = Number(zInput.trim())
    if (!Number.isFinite(a) || !Number.isFinite(z) || aInput.trim() === '' || zInput.trim() === '') return
    const correct = a === currentQuiz3.daughterA && z === currentQuiz3.daughterZ
    if (correct) {
      const nextStreak = streak3 + 1
      setStreak3(nextStreak)
      setFeedback3('ok')
      if (nextStreak < STREAK_TARGET) {
        setQuiz3Idx((i) => (i + 1) % stage3Items.length)
        setAInput('')
        setZInput('')
      }
    } else {
      setStreak3(0)
      setFeedback3('off')
      setQuiz3Idx((i) => (i + 1) % stage3Items.length)
      setAInput('')
      setZInput('')
    }
  }, [aInput, zInput, currentQuiz3, streak3, stage3Items.length])

  // ── Peek hint text (per current quiz item's ray) ────────────────────
  const peekText = useMemo(() => {
    if (!isStage3) return ''
    switch (currentQuiz3.ray) {
      case 'alpha':      return labels.peek_alpha
      case 'beta_minus': return labels.peek_beta_minus
      case 'beta_plus':  return labels.peek_beta_plus
      case 'gamma':      return labels.peek_gamma
    }
  }, [isStage3, currentQuiz3.ray, labels])

  // ── HUD strings ─────────────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`
  const hudTR = isStage1
    ? `${isotope.parentA}${isotope.symbol} · ${RAY_GLYPH[isotope.ray]}`
    : isStage2
      ? `${labels.streak}: ${streak2}/${STREAK_TARGET}`
      : `${labels.streak}: ${streak3}/${STREAK_TARGET}`
  const hudBL = isStage1 ? labels.tip1 : isStage2 ? labels.tip2 : labels.tip3
  // BR stays empty — reserved for parent-side chrome.

  // ── Dot grid (stage 1 + 2) ──────────────────────────────────────────
  const cellW = GRID_W / GRID_COLS
  const cellH = GRID_H / GRID_ROWS
  const dotR = Math.min(cellW, cellH) * 0.28
  const flashColor = RAY_COLOR[gridRay]
  const dots: React.ReactNode[] = []
  if (!isStage3) {
    for (let i = 0; i < N0; i++) {
      const row = Math.floor(i / GRID_COLS)
      const col = i % GRID_COLS
      const cx = GRID_X + (col + 0.5) * cellW
      const cy = GRID_Y + (row + 0.5) * cellH
      const u = uniforms[i] as number
      const tau = -Math.log(u) / lambdaFromT(gridT)
      const alive = tau > tSim
      const justDecayed = !alive && tau > tSim - 0.6
      const fill = alive ? '#37C9B8' : justDecayed ? flashColor : '#2A3244'
      const stroke = alive ? '#37C9B8' : justDecayed ? flashColor : '#3A4863'
      dots.push(
        <circle
          key={i}
          cx={cx}
          cy={cy}
          r={dotR}
          fill={fill}
          stroke={stroke}
          strokeWidth={alive ? 0 : 0.6}
          opacity={alive ? 0.95 : justDecayed ? 0.85 : 0.35}
        />,
      )
    }
  }

  // ── Right-panel: stage 1 plot ───────────────────────────────────────
  const analyticPath = useMemo(() => {
    if (!isStage1) return ''
    const steps = 80
    let d = ''
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * T_SIM_MAX
      const n = analyticN(t, isotope.T)
      const sx = tToSvgX(t)
      const sy = nToSvgY(n)
      d += `${i === 0 ? 'M' : 'L'} ${sx.toFixed(1)} ${sy.toFixed(1)} `
    }
    return d
  }, [isStage1, isotope.T])

  const stochasticPath = useMemo(() => {
    if (!isStage1) return ''
    const stepCurve: { t: number; n: number }[] = [{ t: 0, n: N0 }]
    for (let i = 0; i < sortedTaus.length; i++) {
      const tau = sortedTaus[i] as number
      if (tau > T_SIM_MAX) break
      stepCurve.push({ t: tau, n: N0 - (i + 1) })
    }
    let d = ''
    let prev: { t: number; n: number } | null = null
    for (const p of stepCurve) {
      if (p.t > tSim) break
      const sx = tToSvgX(p.t)
      const sy = nToSvgY(p.n)
      if (prev) {
        const psy = nToSvgY(prev.n)
        d += `L ${sx.toFixed(1)} ${psy.toFixed(1)} L ${sx.toFixed(1)} ${sy.toFixed(1)} `
      } else {
        d += `M ${sx.toFixed(1)} ${sy.toFixed(1)} `
      }
      prev = p
    }
    if (prev) {
      const sx = tToSvgX(tSim)
      const sy = nToSvgY(prev.n)
      d += `L ${sx.toFixed(1)} ${sy.toFixed(1)} `
    }
    return d
  }, [isStage1, sortedTaus, tSim])

  // Panel background/frame shared across all stages
  const panelFrame = (x: number, y: number, w: number, h: number, key: string) => (
    <rect
      key={key}
      x={x - 8}
      y={y - 8}
      width={w + 16}
      height={h + 16}
      fill="none"
      stroke="#12203a"
      strokeWidth={1}
      rx={6}
    />
  )

  // Isotope-symbol block (stage 3 left-panel + stage 2 header equation).
  const renderIsotopeBlock = (
    cx: number,
    cy: number,
    A: number,
    Z: number,
    symbol: string,
    color: string,
    scale = 1,
  ) => (
    <g>
      <text
        x={cx - 22 * scale}
        y={cy - 12 * scale}
        fill={color}
        fontFamily="'JetBrains Mono', monospace"
        fontSize={14 * scale}
        textAnchor="end"
      >
        {A}
      </text>
      <text
        x={cx - 22 * scale}
        y={cy + 14 * scale}
        fill={color}
        fontFamily="'JetBrains Mono', monospace"
        fontSize={14 * scale}
        textAnchor="end"
      >
        {Z}
      </text>
      <text
        x={cx}
        y={cy + 6 * scale}
        fill={color}
        fontFamily="'Space Grotesk', system-ui, sans-serif"
        fontSize={36 * scale}
        fontWeight={700}
        textAnchor="middle"
      >
        {symbol}
      </text>
    </g>
  )

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

        {/* ─── Left panel: animated grid (stages 1 & 2) ────────────────── */}
        {!isStage3 && (
          <>
            {panelFrame(GRID_X, GRID_Y, GRID_W, GRID_H, 'gridframe')}
            <text
              x={GRID_X}
              y={GRID_Y - 14}
              fill="#6C7A93"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={11}
              letterSpacing="0.1em"
            >
              N₀ = {N0} · {isStage1 ? isotope.symbol : currentQuiz2.parentSymbol}
              {'-'}{isStage1 ? isotope.parentA : currentQuiz2.parentA}
            </text>
            {dots}
            {/* Ray legend chip in the grid panel's top-right corner */}
            <g>
              <rect
                x={GRID_X + GRID_W - 62}
                y={GRID_Y + 6}
                width={56}
                height={22}
                rx={4}
                fill="#0D1524"
                stroke={flashColor}
                strokeWidth={1}
                opacity={0.9}
              />
              <text
                x={GRID_X + GRID_W - 34}
                y={GRID_Y + 22}
                fill={flashColor}
                fontFamily="'JetBrains Mono', monospace"
                fontSize={14}
                textAnchor="middle"
              >
                {isStage1 ? RAY_GLYPH[isotope.ray] : '?'}
              </text>
            </g>
          </>
        )}

        {/* ─── Left panel: stage 3 static parent card ─────────────────── */}
        {isStage3 && (
          <>
            {panelFrame(GRID_X, GRID_Y, GRID_W, GRID_H, 'parentframe')}
            <text
              x={GRID_X}
              y={GRID_Y - 14}
              fill="#6C7A93"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={11}
              letterSpacing="0.1em"
            >
              {labels.parent}
            </text>
            {renderIsotopeBlock(
              GRID_X + GRID_W / 2,
              GRID_Y + GRID_H / 2 - 20,
              currentQuiz3.parentA,
              currentQuiz3.parentZ,
              currentQuiz3.parentSymbol,
              '#37C9B8',
              1.8,
            )}
            <text
              x={GRID_X + GRID_W / 2}
              y={GRID_Y + GRID_H - 30}
              fill="#6C7A93"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={11}
              letterSpacing="0.1em"
              textAnchor="middle"
            >
              {`${labels.streak}: ${streak3}/${STREAK_TARGET}`}
            </text>
          </>
        )}

        {/* ─── Right panel: stage 1 plot ──────────────────────────────── */}
        {isStage1 && (
          <>
            {panelFrame(PLOT_X, PLOT_Y, PLOT_W, PLOT_H, 'plotframe')}
            {/* light grid */}
            {[1, 2, 3, 4].map((i) => (
              <line
                key={`vx${i}`}
                x1={PLOT_X + (i / 5) * PLOT_W}
                y1={PLOT_Y}
                x2={PLOT_X + (i / 5) * PLOT_W}
                y2={PLOT_Y + PLOT_H}
                stroke="#12203a"
                strokeWidth={1}
              />
            ))}
            {[1, 2, 3, 4].map((i) => (
              <line
                key={`hy${i}`}
                x1={PLOT_X}
                y1={PLOT_Y + (i / 5) * PLOT_H}
                x2={PLOT_X + PLOT_W}
                y2={PLOT_Y + (i / 5) * PLOT_H}
                stroke="#12203a"
                strokeWidth={1}
              />
            ))}
            {/* axes */}
            <line
              x1={PLOT_X}
              y1={PLOT_Y + PLOT_H}
              x2={PLOT_X + PLOT_W}
              y2={PLOT_Y + PLOT_H}
              stroke="#3A4863"
              strokeWidth={1.5}
            />
            <line x1={PLOT_X} y1={PLOT_Y} x2={PLOT_X} y2={PLOT_Y + PLOT_H} stroke="#3A4863" strokeWidth={1.5} />
            {/* axis labels */}
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
              N ↑
            </text>
            {/* T½ marker */}
            <line
              x1={tToSvgX(isotope.T)}
              y1={PLOT_Y}
              x2={tToSvgX(isotope.T)}
              y2={PLOT_Y + PLOT_H}
              stroke="#37C9B8"
              strokeWidth={1}
              strokeDasharray="3 4"
              opacity={0.5}
            />
            <text
              x={tToSvgX(isotope.T)}
              y={PLOT_Y - 4}
              fill="#37C9B8"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={9}
              textAnchor="middle"
            >
              T½
            </text>
            {/* N₀/2 reference */}
            <line
              x1={PLOT_X}
              y1={nToSvgY(N0 / 2)}
              x2={PLOT_X + PLOT_W}
              y2={nToSvgY(N0 / 2)}
              stroke="#37C9B8"
              strokeWidth={1}
              strokeDasharray="3 4"
              opacity={0.35}
            />
            {/* analytic curve */}
            <path
              d={analyticPath}
              fill="none"
              stroke="#37C9B8"
              strokeWidth={1.4}
              strokeDasharray="4 5"
              opacity={0.55}
            />
            {/* stochastic step */}
            {stochasticPath && (
              <path d={stochasticPath} fill="none" stroke={flashColor} strokeWidth={2} />
            )}
            {/* sim clock cursor */}
            <line
              x1={tToSvgX(tSim)}
              y1={PLOT_Y}
              x2={tToSvgX(tSim)}
              y2={PLOT_Y + PLOT_H}
              stroke="#F9A968"
              strokeWidth={1}
              opacity={0.4}
            />
            {/* transformation equation strip below plot */}
            <text
              x={PLOT_X + PLOT_W / 2}
              y={PLOT_Y + PLOT_H + 42}
              fill="#B9C4D6"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={13}
              textAnchor="middle"
            >
              {`${isotope.parentA}₍${isotope.parentZ}₎${isotope.symbol}  →  ${isotope.daughterA}₍${isotope.daughterZ}₎${isotope.daughterSymbol}  +  ${RAY_GLYPH[isotope.ray]}`}
            </text>
          </>
        )}

        {/* ─── Right panel: stage 2 quiz card ──────────────────────────── */}
        {isStage2 && (
          <>
            {panelFrame(PLOT_X, PLOT_Y, PLOT_W, PLOT_H, 'quizframe')}
            <text
              x={PLOT_X}
              y={PLOT_Y - 14}
              fill="#6C7A93"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={11}
              letterSpacing="0.1em"
            >
              {labels.pick_ray}
            </text>
            {/* Equation: parent → daughter + ? */}
            <g>
              {renderIsotopeBlock(
                PLOT_X + 60,
                PLOT_Y + 70,
                currentQuiz2.parentA,
                currentQuiz2.parentZ,
                currentQuiz2.parentSymbol,
                '#37C9B8',
                1,
              )}
              <text
                x={PLOT_X + 120}
                y={PLOT_Y + 78}
                fill="#6C7A93"
                fontFamily="'JetBrains Mono', monospace"
                fontSize={24}
                textAnchor="middle"
              >
                →
              </text>
              {renderIsotopeBlock(
                PLOT_X + 180,
                PLOT_Y + 70,
                currentQuiz2.daughterA,
                currentQuiz2.daughterZ,
                currentQuiz2.daughterSymbol,
                '#37C9B8',
                1,
              )}
              <text
                x={PLOT_X + 235}
                y={PLOT_Y + 78}
                fill="#6C7A93"
                fontFamily="'JetBrains Mono', monospace"
                fontSize={24}
                textAnchor="middle"
              >
                +
              </text>
              <text
                x={PLOT_X + 275}
                y={PLOT_Y + 85}
                fill="#F97316"
                fontFamily="'Space Grotesk', system-ui, sans-serif"
                fontSize={36}
                fontWeight={700}
                textAnchor="middle"
              >
                ?
              </text>
            </g>
            {/* conservation readout row */}
            <text
              x={PLOT_X + PLOT_W / 2}
              y={PLOT_Y + 140}
              fill="#6C7A93"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={11}
              letterSpacing="0.08em"
              textAnchor="middle"
            >
              {labels.conservation}
            </text>
            <text
              x={PLOT_X + PLOT_W / 2 - 40}
              y={PLOT_Y + 162}
              fill="#B9C4D6"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={13}
              textAnchor="middle"
            >
              {`ΔA = ${currentQuiz2.daughterA - currentQuiz2.parentA}`}
            </text>
            <text
              x={PLOT_X + PLOT_W / 2 + 40}
              y={PLOT_Y + 162}
              fill="#B9C4D6"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={13}
              textAnchor="middle"
            >
              {`ΔZ = ${currentQuiz2.daughterZ - currentQuiz2.parentZ}`}
            </text>
            {/* feedback text — post-submit only */}
            {feedback2 && (
              <text
                x={PLOT_X + PLOT_W / 2}
                y={PLOT_Y + 200}
                fill={feedback2 === 'ok' ? '#37C9B8' : '#F97316'}
                fontFamily="'JetBrains Mono', monospace"
                fontSize={13}
                letterSpacing="0.06em"
                textAnchor="middle"
              >
                {feedback2 === 'ok' ? labels.match_ok : labels.match_off}
              </text>
            )}
          </>
        )}

        {/* ─── Right panel: stage 3 ray card ──────────────────────────── */}
        {isStage3 && (
          <>
            {panelFrame(PLOT_X, PLOT_Y, PLOT_W, PLOT_H, 'rayframe')}
            <text
              x={PLOT_X}
              y={PLOT_Y - 14}
              fill="#6C7A93"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={11}
              letterSpacing="0.1em"
            >
              {labels.ray}
            </text>
            <text
              x={PLOT_X + PLOT_W / 2}
              y={PLOT_Y + GRID_H / 2 - 10}
              fill={RAY_COLOR[currentQuiz3.ray]}
              fontFamily="'Space Grotesk', system-ui, sans-serif"
              fontSize={96}
              fontWeight={700}
              textAnchor="middle"
            >
              {RAY_GLYPH[currentQuiz3.ray]}
            </text>
            <text
              x={PLOT_X + PLOT_W / 2}
              y={PLOT_Y + GRID_H / 2 + 40}
              fill="#6C7A93"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={12}
              letterSpacing="0.08em"
              textAnchor="middle"
            >
              {labels.solve_daughter}
            </text>
            {/* peek reveal (strategy hint — never the answer) */}
            {peekVisible && (
              <>
                <rect
                  x={PLOT_X + 10}
                  y={PLOT_Y + PLOT_H - 70}
                  width={PLOT_W - 20}
                  height={40}
                  rx={4}
                  fill="#12203a"
                  opacity={0.9}
                />
                <text
                  x={PLOT_X + PLOT_W / 2}
                  y={PLOT_Y + PLOT_H - 44}
                  fill="#F9A968"
                  fontFamily="'JetBrains Mono', monospace"
                  fontSize={12}
                  textAnchor="middle"
                >
                  {`${labels.peek_prefix} ${peekText}`}
                </text>
              </>
            )}
            {/* feedback — post-submit only */}
            {feedback3 && !peekVisible && (
              <text
                x={PLOT_X + PLOT_W / 2}
                y={PLOT_Y + PLOT_H - 30}
                fill={feedback3 === 'ok' ? '#37C9B8' : '#F97316'}
                fontFamily="'JetBrains Mono', monospace"
                fontSize={13}
                letterSpacing="0.06em"
                textAnchor="middle"
              >
                {feedback3 === 'ok' ? labels.match_ok : labels.match_off}
              </text>
            )}
          </>
        )}
      </svg>

      {/* ─── HUD overlays (TL / TR / BL only — BR reserved) ──────────── */}
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

      {/* ─── Stage 1: right-column isotope picker ────────────────────── */}
      {isStage1 && (
        <div
          style={{
            position: 'absolute',
            top: '9rem',
            right: '3rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '1.2rem',
            zIndex: 6,
          }}
        >
          <div
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '1.5rem',
              color: '#6C7A93',
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              marginBottom: '0.3rem',
            }}
          >
            {labels.select_isotope}
          </div>
          {ISOTOPES.map((iso, idx) => {
            const active = idx === isotopeIdx
            const color = RAY_COLOR[iso.ray]
            return (
              <button
                key={iso.id}
                type="button"
                onClick={() => pickIsotope(idx)}
                style={{
                  padding: '0.9rem 1.4rem',
                  background: active ? color : 'transparent',
                  color: active ? '#0D1524' : color,
                  border: `0.2rem solid ${color}`,
                  borderRadius: '1rem',
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: '1.7rem',
                  fontWeight: 700,
                  letterSpacing: '0.06em',
                  cursor: 'pointer',
                  textAlign: 'left',
                  minWidth: '14rem',
                }}
              >
                {`${iso.parentA}${iso.symbol} · ${RAY_GLYPH[iso.ray]}`}
              </button>
            )
          })}
        </div>
      )}

      {/* ─── Stage 2: bottom-center ray picker (4 buttons) ───────────── */}
      {isStage2 && (
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
          {RAY_ORDER.map((ray) => (
            <button
              key={ray}
              type="button"
              onClick={() => submitRay(ray)}
              style={{
                padding: '1rem 2rem',
                background: 'transparent',
                color: RAY_COLOR[ray],
                border: `0.2rem solid ${RAY_COLOR[ray]}`,
                borderRadius: '10rem',
                fontFamily: "'Space Grotesk', system-ui, sans-serif",
                fontSize: '2.4rem',
                fontWeight: 700,
                letterSpacing: '0.06em',
                cursor: 'pointer',
                minWidth: '7rem',
              }}
            >
              {RAY_GLYPH[ray]}
            </button>
          ))}
        </div>
      )}

      {/* ─── Stage 3: bottom-center numeric input for daughter A, Z ──── */}
      {isStage3 && (
        <div
          style={{
            position: 'absolute',
            bottom: '9rem',
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            alignItems: 'center',
            gap: '1rem',
            zIndex: 6,
          }}
        >
          <label
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '1.9rem',
              color: '#6C7A93',
            }}
          >
            {labels.daughter}:
          </label>
          <label
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '1.9rem',
              color: '#6C7A93',
            }}
          >
            A =
          </label>
          <input
            type="text"
            inputMode="numeric"
            value={aInput}
            placeholder="?"
            onChange={(e) => {
              setAInput(e.target.value)
              setFeedback3(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitDaughter()
            }}
            style={{
              width: '7rem',
              padding: '0.9rem 1rem',
              background: 'rgba(30,42,64,0.85)',
              color: '#F9A968',
              border: `0.2rem solid ${feedback3 === 'off' ? '#F97316' : '#3A4863'}`,
              borderRadius: '0.8rem',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '2rem',
              fontWeight: 700,
              textAlign: 'center',
              outline: 'none',
            }}
          />
          <label
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '1.9rem',
              color: '#6C7A93',
            }}
          >
            Z =
          </label>
          <input
            type="text"
            inputMode="numeric"
            value={zInput}
            placeholder="?"
            onChange={(e) => {
              setZInput(e.target.value)
              setFeedback3(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitDaughter()
            }}
            style={{
              width: '7rem',
              padding: '0.9rem 1rem',
              background: 'rgba(30,42,64,0.85)',
              color: '#F9A968',
              border: `0.2rem solid ${feedback3 === 'off' ? '#F97316' : '#3A4863'}`,
              borderRadius: '0.8rem',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '2rem',
              fontWeight: 700,
              textAlign: 'center',
              outline: 'none',
            }}
          />
          <button
            type="button"
            onClick={submitDaughter}
            style={{
              padding: '1rem 2rem',
              background: feedback3 === 'ok' ? '#37C9B8' : '#F97316',
              color: feedback3 === 'ok' ? '#0D1524' : '#FFFFFF',
              border: 'none',
              borderRadius: '10rem',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '1.9rem',
              fontWeight: 700,
              letterSpacing: '0.1em',
              cursor: 'pointer',
            }}
          >
            {labels.submit}
          </button>
        </div>
      )}
    </div>
  )
}

