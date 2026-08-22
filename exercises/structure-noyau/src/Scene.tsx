import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  useSetStage,
  useCurrentStage,
  useComplete,
  useDeclareStages,
  useHint,
  useInit,
  useNext,
  useProgress,
  useReset,
  useSeed,
} from '@physics/sdk/react'
import { getHintFor, getStagesFor } from './stages'
import en from '../i18n/en.json'
import fr from '../i18n/fr.json'
import ar from '../i18n/ar.json'
import { ELEMENTS, elementFor } from './elements'

// ─── Canvas ─────────────────────────────────────────────────────────────
const W = 800
const H = 450

// Ranges
const A_MIN = 1, A_MAX = 250
const Z_MIN = 1, Z_MAX = 92

// Nucleus box
const NUC_X = 50, NUC_Y = 60, NUC_W = 240, NUC_H = 300
const NUC_CX = NUC_X + NUC_W / 2
const NUC_CY = NUC_Y + NUC_H / 2 - 10

// Stability chart
const CHART_X0 = 320, CHART_Y0 = 60, CHART_W = 260, CHART_H = 300
const CHART_X1 = CHART_X0 + CHART_W, CHART_Y1 = CHART_Y0 + CHART_H
const CHART_Z_MAX = 100
const CHART_N_MAX = 160

// Targets for stages 2 + 3 — culturally-relevant isotopes.
type Isotope = { A: number; Z: number; key: string }
const STAGE2_TARGETS: Isotope[] = [
  { A: 14,  Z: 6,  key: 'C14'  },
  { A: 16,  Z: 8,  key: 'O16'  },
  { A: 235, Z: 92, key: 'U235' },
]

// Stage 3: given (Z, N), pick correct isotope from choices.
const STAGE3_PROBLEMS: { correct: Isotope; distractors: Isotope[] }[] = [
  {
    correct:    { A: 12, Z: 6, key: 'C12' },
    distractors: [
      { A: 14, Z: 7, key: 'N14' },
      { A: 12, Z: 5, key: 'B12' },
      { A: 13, Z: 6, key: 'C13' },
    ],
  },
  {
    correct:    { A: 4, Z: 2, key: 'He4' },
    distractors: [
      { A: 3, Z: 2, key: 'He3' },
      { A: 4, Z: 1, key: 'H4'  },
      { A: 2, Z: 2, key: 'He2' },
    ],
  },
  {
    correct:    { A: 238, Z: 92, key: 'U238' },
    distractors: [
      { A: 235, Z: 92, key: 'U235' },
      { A: 238, Z: 94, key: 'Pu238' },
      { A: 232, Z: 90, key: 'Th232' },
    ],
  },
]
const STAGE3_TOTAL = STAGE3_PROBLEMS.length

// ─── i18n ───────────────────────────────────────────────────────────────
const dict = { en, fr, ar } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels as Record<string, string>
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

// ─── Component ──────────────────────────────────────────────────────────
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

  const [A, setA] = useState(12)
  const [Z, setZ] = useState(6)
  const N = Math.max(0, A - Z)

  // Track distinct Z touched (stage 1)
  const [zSeen, setZSeen] = useState<Set<number>>(new Set([Z]))
  useEffect(() => {
    if (!isObserve) return
    setZSeen((prev) => {
      if (prev.has(Z)) return prev
      const next = new Set(prev)
      next.add(Z)
      return next
    })
  }, [Z, isObserve])

  // Stage 2 completion state
  const [matchedTargets, setMatchedTargets] = useState<Set<string>>(new Set())
  useEffect(() => {
    if (!isExperiment) return
    const hit = STAGE2_TARGETS.find((t) => t.A === A && t.Z === Z)
    if (!hit) return
    setMatchedTargets((prev) => {
      if (prev.has(hit.key)) return prev
      const next = new Set(prev)
      next.add(hit.key)
      return next
    })
  }, [A, Z, isExperiment])

  // Stage 3 state — one problem at a time, shuffled choices per problem
  const [problemIdx, setProblemIdx] = useState(0)
  const [pick, setPick] = useState<string | null>(null)
  const [correctCount, setCorrectCount] = useState(0)

  const problemOrder = useMemo(() => rootRng.shuffle(STAGE3_PROBLEMS), [rootRng])
  const currentProblem = problemOrder[problemIdx % problemOrder.length]!
  const shuffledChoices = useMemo(() => {
    const bag = [currentProblem.correct, ...currentProblem.distractors]
    return rootRng.fork().shuffle(bag)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [problemIdx, rootRng])

  // SDK wiring
  const setStage = useSetStage()
  const progress = useProgress()
  const complete = useComplete()

  const observeDone = zSeen.size >= 5
  const experimentDone = matchedTargets.size >= STAGE2_TARGETS.length
  const evaluateDone = correctCount >= STAGE3_TOTAL
  const canSubmit = isObserve ? observeDone : isExperiment ? experimentDone : evaluateDone

  const resetForStage = useCallback((stage: number) => {
    setA(12)
    setZ(6)
    setZSeen(new Set([6]))
    setMatchedTargets(new Set())
    setProblemIdx(0)
    setPick(null)
    setCorrectCount(0)
    void stage
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

  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  const pickAnswer = useCallback((key: string) => {
    if (pick !== null) return
    setPick(key)
    if (key === currentProblem.correct.key) {
      setCorrectCount((c) => c + 1)
    }
  }, [pick, currentProblem])

  const nextProblem = useCallback(() => {
    setPick(null)
    setProblemIdx((i) => i + 1)
  }, [])

  // Constrain Z ≤ A
  const setZClamped = useCallback((z: number) => {
    setZ(clamp(z, Z_MIN, Math.min(Z_MAX, A)))
  }, [A])
  const setAClamped = useCallback((a: number) => {
    const na = clamp(a, A_MIN, A_MAX)
    setA(na)
    if (Z > na) setZ(na)
  }, [Z])

  // ─── Nucleon packing (spiral / golden-angle) ───────────────────────
  const nucleons = useMemo(() => {
    // Assign types: Z red (protons), N blue (neutrons). Shuffle indices for visual mix.
    const total = A
    const R = Math.min(NUC_W, NUC_H) / 2 - 20
    const positions: { x: number; y: number; type: 'p' | 'n' }[] = []
    const golden = Math.PI * (3 - Math.sqrt(5))
    const indices = Array.from({ length: total }, (_, i) => i)
    // Stable ordering — no RNG needed since packing is deterministic on A
    const typeAssign = indices.map((i) => (i < Z ? 'p' : 'n') as 'p' | 'n')
    // Shuffle type assignments deterministically with a small hash of (A,Z)
    const seedSalt = A * 131 + Z * 17
    const shuffled = [...typeAssign].sort((_, __) => {
      // Not truly random but stable per (A,Z) — good enough for visual mix
      return ((seedSalt >> 3) & 1) - 0.5
    })
    for (let i = 0; i < total; i++) {
      const t = i / Math.max(1, total - 1)
      const r = R * Math.sqrt((i + 0.5) / total)
      const theta = i * golden
      positions.push({
        x: NUC_CX + r * Math.cos(theta),
        y: NUC_CY + r * Math.sin(theta),
        type: shuffled[i]!,
      })
      void t
    }
    return positions
  }, [A, Z])

  // Nucleon radius scales down as A grows so nucleus stays contained
  const nucleonR = useMemo(() => {
    const base = 12
    return clamp(base - (A - 4) * 0.045, 2.6, base)
  }, [A])

  // ─── Stability chart ───────────────────────────────────────────────
  // "Line of stability": N ≈ Z for Z<20, else N ≈ Z + 0.0155·Z²  (rough)
  const stabilityPath = useMemo(() => {
    let d = ''
    for (let z = 0; z <= CHART_Z_MAX; z += 2) {
      const nApprox = z + 0.0155 * z * z
      const px = CHART_X0 + (z / CHART_Z_MAX) * CHART_W
      const py = CHART_Y1 - (nApprox / CHART_N_MAX) * CHART_H
      d += d === '' ? `M ${px} ${py}` : ` L ${px} ${py}`
    }
    return d
  }, [])

  const stabilityBandTop = useMemo(() => {
    let d = ''
    for (let z = 0; z <= CHART_Z_MAX; z += 2) {
      const nApprox = z + 0.0155 * z * z + Math.max(2, z * 0.15)
      const px = CHART_X0 + (z / CHART_Z_MAX) * CHART_W
      const py = CHART_Y1 - (nApprox / CHART_N_MAX) * CHART_H
      d += d === '' ? `M ${px} ${py}` : ` L ${px} ${py}`
    }
    return d
  }, [])
  const stabilityBandBottom = useMemo(() => {
    let d = ''
    for (let z = 0; z <= CHART_Z_MAX; z += 2) {
      const nApprox = z + 0.0155 * z * z - Math.max(2, z * 0.15)
      const px = CHART_X0 + (z / CHART_Z_MAX) * CHART_W
      const py = CHART_Y1 - (nApprox / CHART_N_MAX) * CHART_H
      d += d === '' ? `M ${px} ${py}` : ` L ${px} ${py}`
    }
    return d
  }, [])

  const zToPx = (z: number) => CHART_X0 + (z / CHART_Z_MAX) * CHART_W
  const nToPy = (n: number) => CHART_Y1 - (n / CHART_N_MAX) * CHART_H

  // ─── Symbol display ────────────────────────────────────────────────
  const element = elementFor(Z)
  const symbol = element?.symbol ?? '?'
  const elementName = element ? getElementDisplayName(element, locale) : '—'

  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${L('stage')} 0${stageIdx} · ${stageName}`
  const hudTR = isObserve
    ? `${L('elements_seen')}: ${zSeen.size}/5`
    : isExperiment
      ? `${L('matched')}: ${matchedTargets.size}/${STAGE2_TARGETS.length}`
      : `${L('correct')}: ${correctCount}/${STAGE3_TOTAL}`
  const hudBL = isObserve ? L('tip1') : isExperiment ? L('tip2') : L('tip3')

  // Isotope name display helper (localized element name + mass number)
  const isotopeLabel = useCallback((iso: Isotope): string => {
    const el = elementFor(iso.Z)
    const name = el ? getElementDisplayName(el, locale) : '—'
    return `${name}-${iso.A}`
  }, [locale])

  const currentTargetName = isExperiment
    ? isotopeLabel(STAGE2_TARGETS.find((t) => !matchedTargets.has(t.key)) ?? STAGE2_TARGETS[0]!)
    : ''

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block', userSelect: 'none' }}
      >
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        {/* ─── Nucleus panel ─── */}
        <rect x={NUC_X} y={NUC_Y} width={NUC_W} height={NUC_H} fill="none" stroke="#12203a" strokeWidth={1} rx={6} />
        <text x={NUC_X + 8} y={NUC_Y - 8} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={11} letterSpacing="0.1em">
          {L('nucleus')}
        </text>

        {/* Nucleons */}
        {nucleons.map((nu, i) => (
          <circle
            key={i}
            cx={nu.x}
            cy={nu.y}
            r={nucleonR}
            fill={nu.type === 'p' ? '#F97316' : '#7EE3D8'}
            stroke={nu.type === 'p' ? '#B8501E' : '#37C9B8'}
            strokeWidth={0.6}
            opacity={0.92}
          />
        ))}

        {/* Symbol readout — hidden on stage 3 unless answered */}
        {!isEvaluate && (
          <g transform={`translate(${NUC_X + NUC_W / 2}, ${NUC_Y + NUC_H - 34})`}>
            <text
              x={-6} y={-4}
              fill="#B9C4D6"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
              textAnchor="end"
              dominantBaseline="alphabetic"
            >
              {A}
            </text>
            <text
              x={-6} y={12}
              fill="#B9C4D6"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
              textAnchor="end"
              dominantBaseline="alphabetic"
            >
              {Z}
            </text>
            <text
              x={4} y={4}
              fill="#EAF0FA"
              fontFamily="'Space Grotesk', system-ui, sans-serif"
              fontSize={26}
              fontWeight={700}
              dominantBaseline="middle"
            >
              {symbol}
            </text>
          </g>
        )}
        <text
          x={NUC_X + NUC_W / 2}
          y={NUC_Y + NUC_H - 8}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={11}
          textAnchor="middle"
        >
          {isEvaluate ? '?' : elementName}
        </text>

        {/* ─── Stability chart ─── */}
        <rect x={CHART_X0} y={CHART_Y0} width={CHART_W} height={CHART_H} fill="none" stroke="#12203a" strokeWidth={1} rx={6} />
        <text x={CHART_X0 + 8} y={CHART_Y0 - 8} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={11} letterSpacing="0.1em">
          {L('stability_chart')}
        </text>
        <text x={CHART_X0 - 8} y={CHART_Y0 + 4} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={10} textAnchor="end">N</text>
        <text x={CHART_X1 + 4} y={CHART_Y1 + 12} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={10}>Z</text>

        {/* Grid ticks */}
        {[0, 20, 40, 60, 80, 100].map((z) => (
          <g key={`zt${z}`}>
            <line x1={zToPx(z)} y1={CHART_Y1} x2={zToPx(z)} y2={CHART_Y1 + 4} stroke="#3A4863" strokeWidth={1} />
            <text x={zToPx(z)} y={CHART_Y1 + 14} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={9} textAnchor="middle">
              {z}
            </text>
          </g>
        ))}
        {[0, 40, 80, 120, 160].map((n) => (
          <g key={`nt${n}`}>
            <line x1={CHART_X0 - 4} y1={nToPy(n)} x2={CHART_X0} y2={nToPy(n)} stroke="#3A4863" strokeWidth={1} />
            <text x={CHART_X0 - 6} y={nToPy(n) + 3} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={9} textAnchor="end">
              {n}
            </text>
          </g>
        ))}

        {/* N = Z diagonal reference */}
        <line
          x1={zToPx(0)} y1={nToPy(0)}
          x2={zToPx(Math.min(CHART_Z_MAX, CHART_N_MAX))}
          y2={nToPy(Math.min(CHART_Z_MAX, CHART_N_MAX))}
          stroke="#3A4863"
          strokeWidth={0.8}
          strokeDasharray="2 4"
        />

        {/* Stability band + curve — clipped to chart interior */}
        <defs>
          <clipPath id="chart-clip">
            <rect x={CHART_X0} y={CHART_Y0} width={CHART_W} height={CHART_H} />
          </clipPath>
        </defs>
        <g clipPath="url(#chart-clip)">
          <path
            d={`${stabilityBandTop} L ${stabilityBandBottom.split(' ').reverse().join(' ').replace(/L /g, '').replace(/M /g, '')} Z`}
            fill="#37C9B8"
            opacity={0.08}
          />
          <path d={stabilityBandTop}    fill="none" stroke="#37C9B8" strokeWidth={0.5} strokeDasharray="2 3" opacity={0.5} />
          <path d={stabilityBandBottom} fill="none" stroke="#37C9B8" strokeWidth={0.5} strokeDasharray="2 3" opacity={0.5} />
          <path d={stabilityPath}       fill="none" stroke="#37C9B8" strokeWidth={1.2} opacity={0.75} />
        </g>

        {/* Target markers (stage 2) */}
        {isExperiment && STAGE2_TARGETS.map((t) => {
          const matched = matchedTargets.has(t.key)
          const px = zToPx(t.Z)
          const py = nToPy(t.A - t.Z)
          return (
            <g key={t.key}>
              <circle cx={px} cy={py} r={7} fill="none" stroke={matched ? '#37C9B8' : '#F9A968'} strokeWidth={1.5} strokeDasharray={matched ? undefined : '2 2'} />
              <text
                x={px + 10} y={py + 4}
                fill={matched ? '#37C9B8' : '#F9A968'}
                fontFamily="'JetBrains Mono', monospace"
                fontSize={9}
              >
                {t.A}{elementFor(t.Z)?.symbol}
              </text>
            </g>
          )
        })}

        {/* Current (Z, N) marker */}
        <circle
          cx={zToPx(Math.min(Z, CHART_Z_MAX))}
          cy={nToPy(Math.min(N, CHART_N_MAX))}
          r={5}
          fill="#F9A968"
          stroke="#0D1524"
          strokeWidth={1.5}
        />

        {/* Composition summary line */}
        <text x={CHART_X0} y={CHART_Y1 + 30} fill="#B9C4D6" fontFamily="'JetBrains Mono', monospace" fontSize={11}>
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

      {/* Right panel */}
      <div style={rightPanelWrapperStyle}>
        <div style={rightPanelTitleStyle}>{L('controls_title')}</div>
        <div style={rightPanelBoxStyle}>
        {/* Sliders always visible (stages 1 + 2) */}
        {!isEvaluate && (
          <>
            {isExperiment && (
              <div style={{
                padding: '1.2rem 1.4rem',
                border: '1px solid #F9A968',
                borderRadius: '0.5rem',
                background: 'rgba(249,169,104,0.06)',
              }}>
                <div style={{ fontSize: '1.5rem', color: '#54617A', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                  {L('target')}
                </div>
                <div style={{ fontSize: '2.1rem', color: '#F9A968', fontWeight: 700, marginTop: '0.4rem' }}>
                  {currentTargetName}
                </div>
              </div>
            )}
            <FieldGroup label={`${L('field_A')}: ${A}`}>
              <NumberSlider min={A_MIN} max={A_MAX} value={A} onChange={setAClamped} />
            </FieldGroup>
            <FieldGroup label={`${L('field_Z')}: ${Z} (${elementName})`}>
              <NumberSlider min={Z_MIN} max={Math.min(Z_MAX, A)} value={Z} onChange={setZClamped} />
            </FieldGroup>
            <FieldGroup label={`${L('field_N')}: ${N}`}>
              <div style={{ padding: '1rem 1.2rem', color: '#6C7A93', fontSize: '1.8rem' }}>
                = A − Z
              </div>
            </FieldGroup>
          </>
        )}

        {/* Stage 3 MCQ */}
        {isEvaluate && (
          <>
            <div style={{
              padding: '1.2rem 1.4rem',
              border: '1px solid #F9A968',
              borderRadius: '0.5rem',
              background: 'rgba(249,169,104,0.06)',
              display: 'flex', flexDirection: 'column', gap: '0.5rem',
            }}>
              <div style={{ fontSize: '1.5rem', color: '#54617A', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                {L('given')}
              </div>
              <div style={{ fontSize: '2rem', color: '#B9C4D6' }}>
                Z = <span style={{ color: '#F97316', fontWeight: 700 }}>{currentProblem.correct.Z}</span>
                {'  '}
                N = <span style={{ color: '#7EE3D8', fontWeight: 700 }}>{currentProblem.correct.A - currentProblem.correct.Z}</span>
              </div>
            </div>
            <div style={{ fontSize: '1.8rem', color: '#B9C4D6' }}>
              {L('which_isotope')}
            </div>
            {shuffledChoices.map((c) => {
              const isPicked = pick === c.key
              const isCorrect = pick !== null && c.key === currentProblem.correct.key
              const isWrong = pick !== null && isPicked && c.key !== currentProblem.correct.key
              const bg = isCorrect ? '#37C9B8' : isWrong ? '#F97316' : isPicked ? '#3A4863' : 'transparent'
              const fg = isCorrect || isWrong ? '#0D1524' : '#B9C4D6'
              return (
                <button
                  key={c.key}
                  type="button"
                  disabled={pick !== null}
                  onClick={() => pickAnswer(c.key)}
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
                  {isotopeLabel(c)}
                  {isCorrect ? '  ✓' : isWrong ? '  ✗' : ''}
                </button>
              )
            })}
            {pick !== null && problemIdx < STAGE3_TOTAL - 1 && (
              <button
                type="button"
                onClick={nextProblem}
                style={{
                  padding: '1.2rem 1.4rem',
                  background: 'transparent',
                  color: '#37C9B8',
                  border: '1px solid #37C9B8',
                  borderRadius: '0.5rem',
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: '2rem',
                  cursor: 'pointer',
                }}
              >
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

// ─── Sub-components ─────────────────────────────────────────────────────
function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
      <div style={{ fontSize: '1.5rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: '#54617A' }}>{label}</div>
      {children}
    </div>
  )
}

function NumberSlider({ min, max, value, onChange }: {
  min: number; max: number; value: number; onChange: (v: number) => void
}) {
  return (
    <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', width: '100%', minWidth: 0 }}>
      <button
        type="button"
        onClick={() => onChange(value - 1)}
        style={stepBtnStyle}
      >−</button>
      <input
        type="range"
        min={min} max={max} step={1}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        style={{ flex: 1, minWidth: 0, width: 0, height: '2rem', accentColor: '#F9A968' }}
      />
      <button
        type="button"
        onClick={() => onChange(value + 1)}
        style={stepBtnStyle}
      >+</button>
    </div>
  )
}

function getElementDisplayName(el: { symbol: string; name: Record<string, string> }, locale: string): string {
  return el.name[locale] ?? el.name.en ?? el.symbol
}

// Silence unused import — ELEMENTS is referenced via elementFor
void ELEMENTS

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
