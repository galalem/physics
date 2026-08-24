import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  useComplete,
  useCurrentStage,
  useDeclareStages,
  useHint,
  useInit,
  useNext,
  useProgress,
  useReset,
  useSeed,
  useSetStage,
} from '@physics/sdk/react'
import { getHintFor, getStagesFor } from './stages'
import { elementFor } from './elements'
import en from '../i18n/en.json'

// ─── Canvas ──────────────────────────────────────────────────────────────
const W = 800
const H = 450

// Ranges
const Z_MIN = 1, Z_MAX = 92
const N_MIN = 0, N_MAX = 158
const A_MAX = 250

// Nucleus box
const NUC_X = 50, NUC_Y = 60, NUC_W = 240, NUC_H = 300
const NUC_CX = NUC_X + NUC_W / 2
const NUC_CY = NUC_Y + NUC_H / 2 - 10

// Stability chart
const CHART_X0 = 320, CHART_Y0 = 60, CHART_W = 260, CHART_H = 300
const CHART_X1 = CHART_X0 + CHART_W, CHART_Y1 = CHART_Y0 + CHART_H
const CHART_Z_MAX = 100
const CHART_N_MAX = 160

// ─── Physics: stability band ──────────────────────────────────────────────
// Band centre: N ≈ Z · (1 + Z/166). Calibrated so that Fe-56 (Z=26,N=30)
// sits inside the band, C-14 (Z=6,N=8) is above (β⁻), and Ni-56
// (Z=28,N=28) is below (β⁺).
function bandCenter(z: number): number {
  return z * (1 + z / 166)
}
function bandHalfWidth(z: number): number {
  return Math.max(1.5, z * 0.08)
}

type Klass = 'stable' | 'beta_minus' | 'beta_plus'
function classify(Z: number, N: number): Klass {
  const c = bandCenter(Z)
  const hw = bandHalfWidth(Z)
  if (N > c + hw) return 'beta_minus'
  if (N < c - hw) return 'beta_plus'
  return 'stable'
}

const CLASS_COLOR: Record<Klass, string> = {
  stable: '#37C9B8',
  beta_minus: '#F97316',
  beta_plus: '#9F7AEA',
}

// Stage 2 targets (must match by (Z, N)). Cover all three classes with
// two same-A pairs (A=56: Fe stable + Ni β⁺; and C-14 as β⁻).
type Target = { Z: number; N: number; key: string; symbol: string }
const STAGE2_TARGETS: Target[] = [
  { Z: 6,  N: 8,  key: 'C14',  symbol: 'C'  },
  { Z: 26, N: 30, key: 'Fe56', symbol: 'Fe' },
  { Z: 28, N: 28, key: 'Ni56', symbol: 'Ni' },
]

// Stage 3 MCQ deck. Each problem: given (Z, N), pick the correct
// stability class from three options. Hand-authored. Ace-the-deck.
type Problem = { Z: number; N: number; correct: Klass; label: string }
const STAGE3_PROBLEMS: Problem[] = [
  // C-12 — stable (isotope pair with C-14, tests band interior)
  { Z: 6,  N: 6,  correct: 'stable',     label: 'C-12'   },
  // C-14 — β⁻ (excess neutrons for Z=6)
  { Z: 6,  N: 8,  correct: 'beta_minus', label: 'C-14'   },
  // Al-25 — β⁺ (excess protons for Z=13)
  { Z: 13, N: 12, correct: 'beta_plus',  label: 'Al-25'  },
  // Cs-137 — β⁻ (heavy, well above band)
  { Z: 55, N: 82, correct: 'beta_minus', label: 'Cs-137' },
]
const STAGE3_TOTAL = STAGE3_PROBLEMS.length

// ─── i18n ────────────────────────────────────────────────────────────────
const dict = { en } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels as Record<string, string>
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

// ─── Component ───────────────────────────────────────────────────────────
export default function Scene() {
  const { locale } = useInit()
  const stages = useMemo(() => getStagesFor(locale), [locale])
  useDeclareStages(stages)
  const labels = useMemo(() => svgLabels(locale), [locale])
  const L = useCallback((k: string) => labels[k] ?? k, [labels])
  const rootRng = useSeed()

  const stageIdx = useCurrentStage()
  const isObserve = stageIdx === 1
  const isExperiment = stageIdx === 2
  const isEvaluate = stageIdx === 3

  const [Z, setZ] = useState(6)
  const [N, setN] = useState(6)
  const A = Z + N
  const klass = classify(Z, N)

  // Stage 1 progress: visit each of the three regions at least once
  const [regionsSeen, setRegionsSeen] = useState<Set<Klass>>(new Set(['stable']))
  useEffect(() => {
    if (!isObserve) return
    setRegionsSeen((prev) => {
      if (prev.has(klass)) return prev
      const next = new Set(prev)
      next.add(klass)
      return next
    })
  }, [klass, isObserve])

  // Stage 2 completion
  const [matchedTargets, setMatchedTargets] = useState<Set<string>>(new Set())
  useEffect(() => {
    if (!isExperiment) return
    const hit = STAGE2_TARGETS.find((t) => t.Z === Z && t.N === N)
    if (!hit) return
    setMatchedTargets((prev) => {
      if (prev.has(hit.key)) return prev
      const next = new Set(prev)
      next.add(hit.key)
      return next
    })
  }, [Z, N, isExperiment])

  // Stage 3 — ace-the-deck (wrong answer restarts from problem 0)
  const [deckSalt, setDeckSalt] = useState(0)
  const deck = useMemo(
    () => rootRng.fork().shuffle(STAGE3_PROBLEMS),
    // Re-shuffle when the deck resets (salt bump) or on fresh mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deckSalt, rootRng],
  )
  const [deckIdx, setDeckIdx] = useState(0)
  const [pick, setPick] = useState<Klass | null>(null)
  const [passCount, setPassCount] = useState(0)
  const currentProblem = deck[deckIdx % deck.length]!

  const pickAnswer = useCallback((choice: Klass) => {
    if (pick !== null) return
    setPick(choice)
    if (choice === currentProblem.correct) {
      // Correct — advance after brief green flash
      window.setTimeout(() => {
        setPassCount((n) => n + 1)
        setDeckIdx((i) => i + 1)
        setPick(null)
      }, 600)
    } else {
      // Wrong — restart deck at 0 with fresh shuffle
      window.setTimeout(() => {
        setDeckIdx(0)
        setPassCount(0)
        setPick(null)
        setDeckSalt((s) => s + 1)
      }, 900)
    }
  }, [pick, currentProblem])

  // SDK wiring
  const setStage = useSetStage()
  const progress = useProgress()
  const complete = useComplete()

  const observeDone = regionsSeen.size >= 3
  const experimentDone = matchedTargets.size >= STAGE2_TARGETS.length
  const evaluateDone = passCount >= STAGE3_TOTAL
  const canSubmit = isObserve ? observeDone : isExperiment ? experimentDone : evaluateDone

  const resetForStage = useCallback(() => {
    setZ(6); setN(6)
    setRegionsSeen(new Set(['stable']))
    setMatchedTargets(new Set())
    setDeckIdx(0); setPick(null); setPassCount(0); setDeckSalt((s) => s + 1)
  }, [])

  useReset(resetForStage)

  useEffect(() => {
    progress(stageIdx / 3, { stage: stageIdx, canSubmit })
  }, [stageIdx, canSubmit, progress])

  useNext(() => {
    if (stageIdx < 3) {
      setStage(stageIdx + 1)
      resetForStage()
    } else {
      complete({ success: true })
    }
  })

  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  // Clamped setters (Z + N sliders; keep A = Z + N ≤ A_MAX)
  const setZClamped = useCallback((z: number) => {
    const nz = clamp(z, Z_MIN, Z_MAX)
    setZ(nz)
    if (nz + N > A_MAX) setN(A_MAX - nz)
  }, [N])
  const setNClamped = useCallback((n: number) => {
    const nn = clamp(n, N_MIN, N_MAX)
    setN(nn)
    if (Z + nn > A_MAX) setZ(A_MAX - nn)
  }, [Z])

  // ─── Nucleon packing ───────────────────────────────────────────────────
  const nucleons = useMemo(() => {
    const total = Math.min(A, A_MAX)
    const R = Math.min(NUC_W, NUC_H) / 2 - 20
    const positions: { x: number; y: number; type: 'p' | 'n' }[] = []
    const golden = Math.PI * (3 - Math.sqrt(5))
    const indices = Array.from({ length: total }, (_, i) => i)
    const typeAssign = indices.map((i) => (i < Z ? 'p' : 'n') as 'p' | 'n')
    const seedSalt = A * 131 + Z * 17
    const shuffled = [...typeAssign].sort(() => ((seedSalt >> 3) & 1) - 0.5)
    for (let i = 0; i < total; i++) {
      const r = R * Math.sqrt((i + 0.5) / total)
      const theta = i * golden
      positions.push({
        x: NUC_CX + r * Math.cos(theta),
        y: NUC_CY + r * Math.sin(theta),
        type: shuffled[i]!,
      })
    }
    return positions
  }, [A, Z])

  const nucleonR = useMemo(() => clamp(12 - (A - 4) * 0.045, 2.6, 12), [A])

  // ─── Stability chart geometry ──────────────────────────────────────────
  const stabilityPath = useMemo(() => {
    let d = ''
    for (let z = 0; z <= CHART_Z_MAX; z += 2) {
      const nApprox = bandCenter(z)
      const px = CHART_X0 + (z / CHART_Z_MAX) * CHART_W
      const py = CHART_Y1 - (nApprox / CHART_N_MAX) * CHART_H
      d += d === '' ? `M ${px} ${py}` : ` L ${px} ${py}`
    }
    return d
  }, [])

  const stabilityBandTop = useMemo(() => {
    let d = ''
    for (let z = 0; z <= CHART_Z_MAX; z += 2) {
      const nApprox = bandCenter(z) + bandHalfWidth(z)
      const px = CHART_X0 + (z / CHART_Z_MAX) * CHART_W
      const py = CHART_Y1 - (nApprox / CHART_N_MAX) * CHART_H
      d += d === '' ? `M ${px} ${py}` : ` L ${px} ${py}`
    }
    return d
  }, [])
  const stabilityBandBottom = useMemo(() => {
    let d = ''
    for (let z = 0; z <= CHART_Z_MAX; z += 2) {
      const nApprox = Math.max(0, bandCenter(z) - bandHalfWidth(z))
      const px = CHART_X0 + (z / CHART_Z_MAX) * CHART_W
      const py = CHART_Y1 - (nApprox / CHART_N_MAX) * CHART_H
      d += d === '' ? `M ${px} ${py}` : ` L ${px} ${py}`
    }
    return d
  }, [])
  // Reverse bottom path so we can concat with top → filled ribbon polygon
  const bandFillPath = useMemo(() => {
    const bottomPts: string[] = []
    for (let z = 0; z <= CHART_Z_MAX; z += 2) {
      const nApprox = Math.max(0, bandCenter(z) - bandHalfWidth(z))
      const px = CHART_X0 + (z / CHART_Z_MAX) * CHART_W
      const py = CHART_Y1 - (nApprox / CHART_N_MAX) * CHART_H
      bottomPts.push(`${px} ${py}`)
    }
    bottomPts.reverse()
    return `${stabilityBandTop} L ${bottomPts.join(' L ')} Z`
  }, [stabilityBandTop])

  const zToPx = (z: number) => CHART_X0 + (z / CHART_Z_MAX) * CHART_W
  const nToPy = (n: number) => CHART_Y1 - (n / CHART_N_MAX) * CHART_H

  // ─── Derived display ──────────────────────────────────────────────────
  const element = elementFor(Z)
  const symbol = element?.symbol ?? '?'
  const elementName = element ? getElementDisplayName(element, locale) : '—'

  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${L('stage')} 0${stageIdx} · ${stageName}`
  const hudTR = isObserve
    ? `${L('regions_seen')}: ${regionsSeen.size}/3`
    : isExperiment
      ? `${L('matched')}: ${matchedTargets.size}/${STAGE2_TARGETS.length}`
      : `${L('correct')}: ${passCount}/${STAGE3_TOTAL}`
  const hudBL = isObserve ? L('tip1') : isExperiment ? L('tip2') : L('tip3')

  const classDisplay = (k: Klass): string =>
    k === 'stable' ? L('class_stable')
    : k === 'beta_minus' ? L('class_beta_minus')
    : L('class_beta_plus')

  const currentTarget = isExperiment
    ? (STAGE2_TARGETS.find((t) => !matchedTargets.has(t.key)) ?? STAGE2_TARGETS[0]!)
    : null
  const currentTargetName = currentTarget
    ? `${currentTarget.symbol}-${currentTarget.Z + currentTarget.N}`
    : ''

  // Choices displayed for stage 3 MCQ. Order is fixed (not shuffled per
  // problem) because there are only three options and their meaning is
  // categorical — shuffling would just add cognitive friction.
  const MCQ_CHOICES: Klass[] = ['stable', 'beta_minus', 'beta_plus']

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block', userSelect: 'none' }}
      >
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        {/* ─── Nucleus panel ─── */}
        <rect x={NUC_X} y={NUC_Y} width={NUC_W} height={NUC_H}
              fill="none" stroke="#12203a" strokeWidth={1} rx={6} />
        <text x={NUC_X + 8} y={NUC_Y - 8} fill="#6C7A93"
              fontFamily="'JetBrains Mono', monospace" fontSize={11} letterSpacing="0.1em">
          {L('nucleus')}
        </text>

        {/* Nucleons */}
        {nucleons.map((nu, i) => (
          <circle
            key={i}
            cx={nu.x} cy={nu.y} r={nucleonR}
            fill={nu.type === 'p' ? '#F97316' : '#7EE3D8'}
            stroke={nu.type === 'p' ? '#B8501E' : '#37C9B8'}
            strokeWidth={0.6} opacity={0.92}
          />
        ))}

        {/* Element symbol overlay — HIDDEN on stage 3 (§4.7) */}
        {!isEvaluate && (
          <g transform={`translate(${NUC_X + NUC_W / 2}, ${NUC_Y + NUC_H - 34})`}>
            <text x={-6} y={-4} fill="#B9C4D6"
                  fontFamily="'JetBrains Mono', monospace" fontSize={10}
                  textAnchor="end" dominantBaseline="alphabetic">
              {A}
            </text>
            <text x={-6} y={12} fill="#B9C4D6"
                  fontFamily="'JetBrains Mono', monospace" fontSize={10}
                  textAnchor="end" dominantBaseline="alphabetic">
              {Z}
            </text>
            <text x={4} y={4} fill="#EAF0FA"
                  fontFamily="'Space Grotesk', system-ui, sans-serif"
                  fontSize={26} fontWeight={700} dominantBaseline="middle">
              {symbol}
            </text>
          </g>
        )}
        <text x={NUC_X + NUC_W / 2} y={NUC_Y + NUC_H - 8}
              fill="#6C7A93" fontFamily="'JetBrains Mono', monospace"
              fontSize={11} textAnchor="middle">
          {isEvaluate ? '?' : elementName}
        </text>

        {/* ─── Stability chart ─── */}
        <rect x={CHART_X0} y={CHART_Y0} width={CHART_W} height={CHART_H}
              fill="none" stroke="#12203a" strokeWidth={1} rx={6} />
        <text x={CHART_X0 + 8} y={CHART_Y0 - 8} fill="#6C7A93"
              fontFamily="'JetBrains Mono', monospace" fontSize={11} letterSpacing="0.1em">
          {L('stability_chart')}
        </text>
        <text x={CHART_X0 - 8} y={CHART_Y0 + 4} fill="#6C7A93"
              fontFamily="'JetBrains Mono', monospace" fontSize={10} textAnchor="end">
          {L('n_axis')}
        </text>
        <text x={CHART_X1 + 4} y={CHART_Y1 + 12} fill="#6C7A93"
              fontFamily="'JetBrains Mono', monospace" fontSize={10}>
          {L('z_axis')}
        </text>

        {/* Grid ticks — kept on all stages (axes are required info) */}
        {[0, 20, 40, 60, 80, 100].map((z) => (
          <g key={`zt${z}`}>
            <line x1={zToPx(z)} y1={CHART_Y1} x2={zToPx(z)} y2={CHART_Y1 + 4}
                  stroke="#3A4863" strokeWidth={1} />
            <text x={zToPx(z)} y={CHART_Y1 + 14} fill="#6C7A93"
                  fontFamily="'JetBrains Mono', monospace" fontSize={9} textAnchor="middle">
              {z}
            </text>
          </g>
        ))}
        {[0, 40, 80, 120, 160].map((n) => (
          <g key={`nt${n}`}>
            <line x1={CHART_X0 - 4} y1={nToPy(n)} x2={CHART_X0} y2={nToPy(n)}
                  stroke="#3A4863" strokeWidth={1} />
            <text x={CHART_X0 - 6} y={nToPy(n) + 3} fill="#6C7A93"
                  fontFamily="'JetBrains Mono', monospace" fontSize={9} textAnchor="end">
              {n}
            </text>
          </g>
        ))}

        {/* N = Z diagonal — kept on all stages (pure geometry, not the answer) */}
        <line
          x1={zToPx(0)} y1={nToPy(0)}
          x2={zToPx(Math.min(CHART_Z_MAX, CHART_N_MAX))}
          y2={nToPy(Math.min(CHART_Z_MAX, CHART_N_MAX))}
          stroke="#3A4863" strokeWidth={0.8} strokeDasharray="2 4"
        />

        <defs>
          <clipPath id="chart-clip">
            <rect x={CHART_X0} y={CHART_Y0} width={CHART_W} height={CHART_H} />
          </clipPath>
        </defs>

        {/* Stability band + region annotations — HIDDEN on stage 3 (§4.7) */}
        {!isEvaluate && (
          <g clipPath="url(#chart-clip)">
            {/* β⁻ region (above band, upper-left of band centre) */}
            <text x={CHART_X0 + 20} y={CHART_Y0 + 30}
                  fill="#F97316" opacity={0.6}
                  fontFamily="'JetBrains Mono', monospace" fontSize={10}>
              {L('beta_minus_region')}
            </text>
            {/* β⁺ region (below band, lower-right) */}
            <text x={CHART_X1 - 90} y={CHART_Y1 - 12}
                  fill="#9F7AEA" opacity={0.7}
                  fontFamily="'JetBrains Mono', monospace" fontSize={10}>
              {L('beta_plus_region')}
            </text>
            {/* Band ribbon */}
            <path d={bandFillPath} fill="#37C9B8" opacity={0.12} />
            <path d={stabilityBandTop}    fill="none" stroke="#37C9B8"
                  strokeWidth={0.5} strokeDasharray="2 3" opacity={0.5} />
            <path d={stabilityBandBottom} fill="none" stroke="#37C9B8"
                  strokeWidth={0.5} strokeDasharray="2 3" opacity={0.5} />
            <path d={stabilityPath} fill="none" stroke="#37C9B8"
                  strokeWidth={1.2} opacity={0.75} />
          </g>
        )}

        {/* Target markers (stage 2 only) */}
        {isExperiment && STAGE2_TARGETS.map((t) => {
          const matched = matchedTargets.has(t.key)
          const px = zToPx(t.Z)
          const py = nToPy(t.N)
          return (
            <g key={t.key}>
              <circle cx={px} cy={py} r={7} fill="none"
                      stroke={matched ? '#37C9B8' : '#F9A968'}
                      strokeWidth={1.5}
                      strokeDasharray={matched ? undefined : '2 2'} />
              <text x={px + 10} y={py + 4}
                    fill={matched ? '#37C9B8' : '#F9A968'}
                    fontFamily="'JetBrains Mono', monospace" fontSize={9}>
                {t.symbol}-{t.Z + t.N}
              </text>
            </g>
          )
        })}

        {/* Current (Z, N) dot — colour reveals classification, so on
            stage 3 render it in a neutral colour (dot position is
            required info; colour is the answer). */}
        <circle
          cx={zToPx(Math.min(Z, CHART_Z_MAX))}
          cy={nToPy(Math.min(N, CHART_N_MAX))}
          r={5}
          fill={isEvaluate ? '#F9A968' : CLASS_COLOR[klass]}
          stroke="#0D1524"
          strokeWidth={1.5}
        />

        {/* Composition summary line — KEPT on all stages (required info) */}
        <text x={CHART_X0} y={CHART_Y1 + 30}
              fill="#B9C4D6" fontFamily="'JetBrains Mono', monospace" fontSize={11}>
          A = <tspan fill="#F9A968" fontWeight={700}>{A}</tspan>
          {'  '}
          Z = <tspan fill="#F97316" fontWeight={700}>{Z}</tspan>
          {'  '}
          N = <tspan fill="#7EE3D8" fontWeight={700}>{N}</tspan>
        </text>
      </svg>

      {/* HUD overlays */}
      <div style={hudTLStyle}>{hudTL}</div>
      <div style={{ ...hudTRStyle, color: canSubmit ? '#37C9B8' : '#B9C4D6' }}>{hudTR}</div>
      <div style={hudBLStyle}>{hudBL}</div>
      {/* BR reserved for parent chrome */}

      {/* Right panel */}
      <div style={rightPanelWrapperStyle}>
        <div style={rightPanelTitleStyle}>{L('controls_title')}</div>
        <div style={rightPanelBoxStyle}>
          {!isEvaluate && (
            <>
              {isExperiment && (
                <div style={{
                  padding: '1.2rem 1.4rem',
                  border: '1px solid #F9A968',
                  borderRadius: '0.5rem',
                  background: 'rgba(249,169,104,0.06)',
                }}>
                  <div style={{
                    fontSize: '1.5rem', color: '#54617A',
                    letterSpacing: '0.08em', textTransform: 'uppercase',
                  }}>{L('target')}</div>
                  <div style={{
                    fontSize: '2.1rem', color: '#F9A968',
                    fontWeight: 700, marginTop: '0.4rem',
                  }}>{currentTargetName}</div>
                </div>
              )}

              <FieldGroup label={`${L('field_Z')}: ${Z} (${elementName})`}>
                <NumberSlider min={Z_MIN} max={Z_MAX} value={Z} onChange={setZClamped} />
              </FieldGroup>
              <FieldGroup label={`${L('field_N')}: ${N}`}>
                <NumberSlider min={N_MIN} max={N_MAX} value={N} onChange={setNClamped} />
              </FieldGroup>

              {/* Live classification (stages 1 + 2) */}
              <div style={{
                padding: '1.2rem 1.4rem',
                border: `1px solid ${CLASS_COLOR[klass]}`,
                borderRadius: '0.5rem',
                background: 'rgba(255,255,255,0.02)',
                display: 'flex', flexDirection: 'column', gap: '0.4rem',
              }}>
                <div style={{
                  fontSize: '1.4rem', color: '#54617A',
                  letterSpacing: '0.08em', textTransform: 'uppercase',
                }}>
                  classification
                </div>
                <div style={{
                  fontSize: '2.1rem', color: CLASS_COLOR[klass], fontWeight: 700,
                }}>
                  {classDisplay(klass)}
                </div>
                <div style={{ fontSize: '1.4rem', color: '#6C7A93' }}>
                  {klass === 'beta_minus' ? L('excess_n')
                    : klass === 'beta_plus' ? L('excess_p')
                    : L('in_band')}
                </div>
              </div>
            </>
          )}

          {isEvaluate && (
            <>
              <div style={{
                padding: '1.2rem 1.4rem',
                border: '1px solid #F9A968',
                borderRadius: '0.5rem',
                background: 'rgba(249,169,104,0.06)',
                display: 'flex', flexDirection: 'column', gap: '0.5rem',
              }}>
                <div style={{
                  fontSize: '1.5rem', color: '#54617A',
                  letterSpacing: '0.08em', textTransform: 'uppercase',
                }}>{L('given')}</div>
                <div style={{ fontSize: '2rem', color: '#B9C4D6' }}>
                  Z = <span style={{ color: '#F97316', fontWeight: 700 }}>{currentProblem.Z}</span>
                  {'  '}
                  N = <span style={{ color: '#7EE3D8', fontWeight: 700 }}>{currentProblem.N}</span>
                </div>
              </div>
              <div style={{ fontSize: '1.8rem', color: '#B9C4D6' }}>
                {L('which_class')}
              </div>
              {MCQ_CHOICES.map((c) => {
                const isPicked = pick === c
                const isCorrect = pick !== null && c === currentProblem.correct
                const isWrong = pick !== null && isPicked && c !== currentProblem.correct
                const bg = isCorrect ? '#37C9B8'
                  : isWrong ? '#F97316'
                  : isPicked ? '#3A4863'
                  : 'transparent'
                const fg = isCorrect || isWrong ? '#0D1524' : '#B9C4D6'
                return (
                  <button
                    key={c}
                    type="button"
                    disabled={pick !== null}
                    onClick={() => pickAnswer(c)}
                    style={{
                      padding: '1.2rem 1.4rem',
                      background: bg,
                      color: fg,
                      border: '1px solid #3A4863',
                      borderRadius: '0.5rem',
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: '2rem',
                      textAlign: 'left',
                      cursor: pick !== null ? 'default' : 'pointer',
                      opacity: pick !== null && !isPicked && !isCorrect ? 0.4 : 1,
                    }}
                  >
                    {classDisplay(c)}
                    {isCorrect ? '  ✓' : isWrong ? '  ✗' : ''}
                  </button>
                )
              })}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Sub-components ─────────────────────────────────────────────────────
function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
      <div style={{
        fontSize: '1.5rem', letterSpacing: '0.1em',
        textTransform: 'uppercase', color: '#54617A',
      }}>{label}</div>
      {children}
    </div>
  )
}

function NumberSlider({ min, max, value, onChange }: {
  min: number; max: number; value: number; onChange: (v: number) => void
}) {
  return (
    <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', width: '100%', minWidth: 0 }}>
      <button type="button" onClick={() => onChange(value - 1)} style={stepBtnStyle}>−</button>
      <input
        type="range"
        min={min} max={max} step={1}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        style={{ flex: 1, minWidth: 0, width: 0, height: '2rem', accentColor: '#F9A968' }}
      />
      <button type="button" onClick={() => onChange(value + 1)} style={stepBtnStyle}>+</button>
    </div>
  )
}

function getElementDisplayName(
  el: { symbol: string; name: Record<string, string> },
  locale: string,
): string {
  return el.name[locale] ?? el.name.en ?? el.symbol
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
  color: '#6C7A93', zIndex: 5, pointerEvents: 'none', maxWidth: '58%',
}
const rightPanelWrapperStyle: React.CSSProperties = {
  position: 'absolute',
  top: '9.7rem', bottom: '20rem',
  right: '6.7rem', width: '40rem',
  boxSizing: 'border-box', zIndex: 6,
  color: '#B9C4D6', fontFamily: "'JetBrains Mono', monospace",
  display: 'flex', flexDirection: 'column',
}
const rightPanelTitleStyle: React.CSSProperties = {
  fontSize: '2.44rem', color: '#6C7A93',
  letterSpacing: '0.1em', marginBottom: '1.2rem', marginLeft: '0.4rem',
}
const rightPanelBoxStyle: React.CSSProperties = {
  flex: 1, border: '1px solid #12203a', borderRadius: '0.6rem',
  padding: '2rem',
  display: 'flex', flexDirection: 'column', gap: '1.8rem',
  fontSize: '2rem', overflow: 'auto',
}
const stepBtnStyle: React.CSSProperties = {
  width: '3.2rem', height: '3.2rem',
  background: 'transparent',
  color: '#B9C4D6',
  border: '1px solid #3A4863',
  borderRadius: '0.4rem',
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: '2rem',
  cursor: 'pointer',
  flexShrink: 0,
}
