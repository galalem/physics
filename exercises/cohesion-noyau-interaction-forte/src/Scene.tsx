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
import { ELEMENTS, elementFor } from './elements'
import en from '../i18n/en.json'

// ─── Canvas ─────────────────────────────────────────────────────────────
const W = 800
const H = 450

// Ranges
const Z_MIN = 1, Z_MAX = 92
const N_MIN = 0, N_MAX = 158
const A_MAX = 250

// Nucleus box
const NUC_X = 50, NUC_Y = 60, NUC_W = 240, NUC_H = 220
const NUC_CX = NUC_X + NUC_W / 2
const NUC_CY = NUC_Y + NUC_H / 2 - 6

// Binding-energy-per-nucleon curve panel
const CURVE_X = 320, CURVE_Y = 60, CURVE_W = 260, CURVE_H = 190
const CURVE_X1 = CURVE_X + CURVE_W, CURVE_Y1 = CURVE_Y + CURVE_H
const CURVE_A_MAX = 250
const CURVE_BA_MAX = 9.2  // MeV/nucleon, tick around ~8.8

// Force bars panel (below curve — stays left of x=600, so BR quadrant free)
const FORCE_X = 320, FORCE_Y = 275, FORCE_W = 260, FORCE_H = 88

// Composition summary line — below nucleus
const SUMMARY_Y = NUC_Y + NUC_H + 26

// ─── Domain constants ───────────────────────────────────────────────────
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

// Semi-empirical mass formula coefficients (MeV)
const a_v = 15.835
const a_s = 18.33
const a_c = 0.714
const a_a = 23.2
const a_p = 11.2

function bindingEnergyPerNucleon(A: number, Z: number): number {
  if (A <= 1) return 0
  const N = A - Z
  const pairingSign = A % 2 !== 0 ? 0 : Z % 2 === 0 && N % 2 === 0 ? 1 : -1
  const B =
    a_v * A -
    a_s * Math.pow(A, 2 / 3) -
    a_c * Z * Z / Math.pow(A, 1 / 3) -
    a_a * (N - Z) * (N - Z) / A +
    (pairingSign * a_p) / Math.sqrt(A)
  return Math.max(0, B / A)
}

// Optimal Z for a given A (stability-line approx). Used to draw the curve envelope.
function optimalZ(A: number): number {
  if (A <= 1) return 1
  // Solve dB/dZ = 0 for Z at fixed A: Z ≈ A / (2 + (a_c / (2*a_a)) * A^(2/3))
  const denom = 2 + (a_c / (2 * a_a)) * Math.pow(A, 2 / 3)
  return Math.max(1, Math.min(A, A / denom))
}

// Force bars (qualitative per-nucleon MeV, normalized to [0,1] against 16 MeV)
const FORCE_MAX_MEV = 16
function strongPerNucleon(A: number): number {
  if (A <= 1) return 0
  return Math.max(0, a_v - a_s / Math.pow(A, 1 / 3))
}
function coulombPerNucleon(A: number, Z: number): number {
  if (A <= 1) return 0
  return (a_c * Z * Z) / Math.pow(A, 4 / 3)
}

// Curve region classification for stage 3. (Regions used to author the deck.)
type CurveRegion = 'rising' | 'peak' | 'falling'

// ─── Stage 2 targets (hand-authored) ────────────────────────────────────
type Target = { Z: number; N: number; key: string }
const STAGE2_TARGETS: Target[] = [
  { Z: 2,  N: 2,   key: 'He4'  },   // rising side, fusion
  { Z: 26, N: 30,  key: 'Fe56' },   // curve peak
  { Z: 92, N: 143, key: 'U235' },   // falling side, fission
]

// ─── Stage 3 MCQ deck (hand-authored, ace-the-deck) ─────────────────────
// Choices are the three curve regions; deck is a set of nuclei covering each region.
type Problem = { Z: number; N: number; region: CurveRegion; key: string }
const STAGE3_PROBLEMS: Problem[] = [
  { Z: 2,  N: 2,   region: 'rising',  key: 'He4'  },
  { Z: 26, N: 30,  region: 'peak',    key: 'Fe56' },
  { Z: 92, N: 146, region: 'falling', key: 'U238' },
  { Z: 8,  N: 8,   region: 'rising',  key: 'O16'  },
]

// ─── i18n ───────────────────────────────────────────────────────────────
const dict = { en } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels as Record<string, string>
}

// ─── Nucleon packing (golden-angle spiral, deterministic on A,Z) ────────
function packNucleons(A: number, Z: number, cx: number, cy: number, R: number) {
  const golden = Math.PI * (3 - Math.sqrt(5))
  const typeAssign: ('p' | 'n')[] = Array.from({ length: A }, (_, i) => (i < Z ? 'p' : 'n'))
  // Deterministic interleave: stable per (A,Z)
  const seedSalt = A * 131 + Z * 17
  const shuffled = [...typeAssign].sort(() => ((seedSalt >> 3) & 1) - 0.5)
  return Array.from({ length: A }, (_, i) => {
    const r = R * Math.sqrt((i + 0.5) / A)
    const theta = i * golden
    return {
      x: cx + r * Math.cos(theta),
      y: cy + r * Math.sin(theta),
      type: shuffled[i]!,
    }
  })
}

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

  // Slider state: Z + N (independent DOFs for this pattern)
  const [Z, setZ] = useState(6)
  const [N, setN] = useState(6)
  const A = Math.max(1, Z + N)

  // Stage 1: distinct elements visited
  const OBSERVE_TARGET = 6
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

  // Stage 2: matched targets
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

  // Stage 3 ace-the-deck
  const deck = useMemo(() => rootRng.shuffle(STAGE3_PROBLEMS), [rootRng])
  const [deckIdx, setDeckIdx] = useState(0)
  const [pick, setPick] = useState<CurveRegion | null>(null)
  const [passCount, setPassCount] = useState(0)
  const currentProblem = deck[deckIdx % deck.length]!

  const pickAnswer = useCallback((region: CurveRegion) => {
    if (pick !== null) return
    setPick(region)
    if (region === currentProblem.region) {
      window.setTimeout(() => {
        setPassCount((n) => n + 1)
        setDeckIdx((i) => i + 1)
        setPick(null)
      }, 600)
    } else {
      // Wrong — restart deck at problem 1 with reset streak
      window.setTimeout(() => {
        setDeckIdx(0)
        setPassCount(0)
        setPick(null)
      }, 900)
    }
  }, [pick, currentProblem])

  // SDK wiring
  const setStage = useSetStage()
  const progress = useProgress()
  const complete = useComplete()

  const observeDone = zSeen.size >= OBSERVE_TARGET
  const experimentDone = matchedTargets.size >= STAGE2_TARGETS.length
  const evaluateDone = passCount >= STAGE3_PROBLEMS.length
  const canSubmit = isObserve ? observeDone : isExperiment ? experimentDone : evaluateDone

  const resetForStage = useCallback(() => {
    setZ(6); setN(6)
    setZSeen(new Set([6]))
    setMatchedTargets(new Set())
    setDeckIdx(0); setPick(null); setPassCount(0)
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

  // Clamp helpers — keep A within [1, A_MAX]
  const setZClamped = useCallback((z: number) => {
    setZ(clamp(z, Z_MIN, Z_MAX))
  }, [])
  const setNClamped = useCallback((n: number) => {
    setN(clamp(n, N_MIN, N_MAX))
  }, [])

  // ─── Derived display ─────────────────────────────────────────────────
  const element = elementFor(Z)
  const symbol = element?.symbol ?? '?'
  const elementName = element ? (element.name.en ?? symbol) : '—'

  const nucleonR = clamp(12 - (A - 4) * 0.045, 2.6, 12)
  const R_nuc = Math.min(NUC_W, NUC_H) / 2 - 16
  const nucleons = useMemo(
    () => packNucleons(Math.min(A, A_MAX), Math.min(Z, Math.min(A, Z_MAX)), NUC_CX, NUC_CY, R_nuc),
    [A, Z, R_nuc],
  )

  // ─── Binding-energy curve (envelope: optimal Z per A) ────────────────
  const curvePath = useMemo(() => {
    let d = ''
    for (let a = 2; a <= CURVE_A_MAX; a += 2) {
      const zOpt = Math.round(optimalZ(a))
      const ba = bindingEnergyPerNucleon(a, zOpt)
      const px = CURVE_X + (a / CURVE_A_MAX) * CURVE_W
      const py = CURVE_Y1 - (ba / CURVE_BA_MAX) * CURVE_H
      d += d === '' ? `M ${px.toFixed(2)} ${py.toFixed(2)}` : ` L ${px.toFixed(2)} ${py.toFixed(2)}`
    }
    return d
  }, [])

  const curBA = bindingEnergyPerNucleon(A, Z)
  const markerX = CURVE_X + (Math.min(A, CURVE_A_MAX) / CURVE_A_MAX) * CURVE_W
  const markerY = CURVE_Y1 - (Math.min(curBA, CURVE_BA_MAX) / CURVE_BA_MAX) * CURVE_H

  // Iron marker position (fixed reference on curve)
  const ironX = CURVE_X + (56 / CURVE_A_MAX) * CURVE_W
  const ironY = CURVE_Y1 - (bindingEnergyPerNucleon(56, 26) / CURVE_BA_MAX) * CURVE_H

  // ─── Force bars ──────────────────────────────────────────────────────
  const strongFrac = clamp(strongPerNucleon(A) / FORCE_MAX_MEV, 0, 1)
  const coulombFrac = clamp(coulombPerNucleon(A, Z) / FORCE_MAX_MEV, 0, 1)
  const barTrackW = FORCE_W - 100  // leave 100px for label on the left
  const barX0 = FORCE_X + 100
  const barH = 12
  const strongBarY = FORCE_Y + 22
  const coulombBarY = FORCE_Y + 52

  // ─── HUD text ────────────────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${L('stage')} 0${stageIdx} · ${stageName}`
  const hudTR = isObserve
    ? `${L('elements_seen')}: ${zSeen.size}/${OBSERVE_TARGET}`
    : isExperiment
      ? `${L('matched')}: ${matchedTargets.size}/${STAGE2_TARGETS.length}`
      : `${L('correct')}: ${passCount}/${STAGE3_PROBLEMS.length}`
  const hudBL = isObserve ? L('tip1') : isExperiment ? L('tip2') : L('tip3')

  // Stage 2 next target name
  const currentTarget = isExperiment
    ? STAGE2_TARGETS.find((t) => !matchedTargets.has(t.key)) ?? STAGE2_TARGETS[0]!
    : null
  const currentTargetName = currentTarget
    ? `${elementFor(currentTarget.Z)?.symbol ?? '?'}-${currentTarget.Z + currentTarget.N}`
    : ''

  // Choice ordering (fixed — not shuffled; only 3 categories, hides no answer)
  const CHOICES: { region: CurveRegion; key: string }[] = [
    { region: 'rising',  key: 'choice_rising'  },
    { region: 'peak',    key: 'choice_peak'    },
    { region: 'falling', key: 'choice_falling' },
  ]

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block', userSelect: 'none' }}
      >
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        {/* ─── Nucleus panel ─── */}
        <rect
          x={NUC_X} y={NUC_Y} width={NUC_W} height={NUC_H}
          fill="none" stroke="#12203a" strokeWidth={1} rx={6}
        />
        <text
          x={NUC_X + 8} y={NUC_Y - 8}
          fill="#6C7A93" fontFamily="'JetBrains Mono', monospace"
          fontSize={11} letterSpacing="0.1em"
        >
          {L('nucleus')}
        </text>

        {/* Nucleons */}
        {nucleons.map((nu, i) => (
          <circle
            key={i}
            cx={nu.x} cy={nu.y} r={nucleonR}
            fill={nu.type === 'p' ? '#F97316' : '#7EE3D8'}
            stroke={nu.type === 'p' ? '#B8501E' : '#37C9B8'}
            strokeWidth={0.6}
            opacity={0.92}
          />
        ))}

        {/* Symbol overlay — HIDDEN on stage 3 (element identity is a hint toward region) */}
        {!isEvaluate && (
          <g transform={`translate(${NUC_CX}, ${NUC_Y + NUC_H - 30})`}>
            <text
              x={-6} y={-4}
              fill="#B9C4D6"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
              textAnchor="end"
            >
              {A}
            </text>
            <text
              x={-6} y={12}
              fill="#B9C4D6"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
              textAnchor="end"
            >
              {Z}
            </text>
            <text
              x={4} y={4}
              fill="#EAF0FA"
              fontFamily="'Space Grotesk', system-ui, sans-serif"
              fontSize={24}
              fontWeight={700}
              dominantBaseline="middle"
            >
              {symbol}
            </text>
          </g>
        )}

        {/* Element name — HIDDEN on stage 3 (shows '?' instead) */}
        <text
          x={NUC_CX} y={NUC_Y + NUC_H - 6}
          fill="#6C7A93" fontFamily="'JetBrains Mono', monospace"
          fontSize={11} textAnchor="middle"
        >
          {isEvaluate ? '?' : elementName}
        </text>

        {/* Composition summary line — KEPT on all stages (required info) */}
        <text
          x={NUC_X} y={SUMMARY_Y}
          fill="#B9C4D6" fontFamily="'JetBrains Mono', monospace" fontSize={11}
        >
          A = <tspan fill="#F9A968" fontWeight={700}>{A}</tspan>
          {'   '}Z = <tspan fill="#F97316" fontWeight={700}>{Z}</tspan>
          {'   '}N = <tspan fill="#7EE3D8" fontWeight={700}>{N}</tspan>
        </text>

        {/* ─── Binding-energy curve panel ─── */}
        <rect
          x={CURVE_X} y={CURVE_Y} width={CURVE_W} height={CURVE_H}
          fill="none" stroke="#12203a" strokeWidth={1} rx={6}
        />
        <text
          x={CURVE_X + 8} y={CURVE_Y - 8}
          fill="#6C7A93" fontFamily="'JetBrains Mono', monospace"
          fontSize={11} letterSpacing="0.1em"
        >
          {L('binding_curve')}
        </text>
        <text
          x={CURVE_X - 8} y={CURVE_Y + 6}
          fill="#6C7A93" fontFamily="'JetBrains Mono', monospace"
          fontSize={10} textAnchor="end"
        >
          E/A
        </text>
        <text
          x={CURVE_X1 + 4} y={CURVE_Y1 + 12}
          fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={10}
        >
          A
        </text>

        {/* Grid ticks (A axis) */}
        {[0, 50, 100, 150, 200, 250].map((a) => {
          const px = CURVE_X + (a / CURVE_A_MAX) * CURVE_W
          return (
            <g key={`at${a}`}>
              <line x1={px} y1={CURVE_Y1} x2={px} y2={CURVE_Y1 + 4} stroke="#3A4863" strokeWidth={1} />
              <text
                x={px} y={CURVE_Y1 + 14}
                fill="#6C7A93" fontFamily="'JetBrains Mono', monospace"
                fontSize={9} textAnchor="middle"
              >
                {a}
              </text>
            </g>
          )
        })}
        {/* 8 MeV horizontal reference (labelled tick) */}
        {(() => {
          const y8 = CURVE_Y1 - (8 / CURVE_BA_MAX) * CURVE_H
          return (
            <g>
              <line
                x1={CURVE_X} y1={y8} x2={CURVE_X1} y2={y8}
                stroke="#3A4863" strokeWidth={0.6} strokeDasharray="2 4"
              />
              <text
                x={CURVE_X - 6} y={y8 + 3}
                fill="#6C7A93" fontFamily="'JetBrains Mono', monospace"
                fontSize={9} textAnchor="end"
              >
                8
              </text>
            </g>
          )
        })()}

        {/* The curve itself — always visible (shape is context, not the answer) */}
        <defs>
          <clipPath id="curve-clip">
            <rect x={CURVE_X} y={CURVE_Y} width={CURVE_W} height={CURVE_H} />
          </clipPath>
        </defs>
        <g clipPath="url(#curve-clip)">
          <path d={curvePath} fill="none" stroke="#37C9B8" strokeWidth={1.4} opacity={0.85} />

          {/* Iron reference marker on curve — kept on stages 1+2, HIDDEN on stage 3 */}
          {!isEvaluate && (
            <>
              <circle cx={ironX} cy={ironY} r={3.2} fill="#37C9B8" stroke="#0D1524" strokeWidth={1} />
              <text
                x={ironX + 6} y={ironY - 6}
                fill="#37C9B8" fontFamily="'JetBrains Mono', monospace" fontSize={9}
              >
                {L('iron_marker')}
              </text>
            </>
          )}

          {/* Moving marker at (A_current, B/A_current) — HIDDEN on stage 3 */}
          {!isEvaluate && (
            <circle
              cx={markerX} cy={markerY} r={5}
              fill="#F9A968" stroke="#0D1524" strokeWidth={1.5}
            />
          )}
        </g>

        {/* ─── Force bars panel ─── */}
        <rect
          x={FORCE_X} y={FORCE_Y} width={FORCE_W} height={FORCE_H}
          fill="none" stroke="#12203a" strokeWidth={1} rx={6}
        />
        <text
          x={FORCE_X + 8} y={FORCE_Y - 8}
          fill="#6C7A93" fontFamily="'JetBrains Mono', monospace"
          fontSize={11} letterSpacing="0.1em"
        >
          {L('force_bars')}
        </text>

        {/* Strong-force bar — HIDDEN on stage 3 */}
        {!isEvaluate && (
          <>
            <text
              x={FORCE_X + 8} y={strongBarY + barH / 2 + 3}
              fill="#B9C4D6" fontFamily="'JetBrains Mono', monospace" fontSize={9}
            >
              {L('strong_force')}
            </text>
            <rect
              x={barX0} y={strongBarY} width={barTrackW} height={barH}
              fill="none" stroke="#3A4863" strokeWidth={0.6} rx={2}
            />
            <rect
              x={barX0} y={strongBarY} width={barTrackW * strongFrac} height={barH}
              fill="#F97316" opacity={0.85} rx={2}
            />
            <text
              x={FORCE_X + 8} y={coulombBarY + barH / 2 + 3}
              fill="#B9C4D6" fontFamily="'JetBrains Mono', monospace" fontSize={9}
            >
              {L('coulomb_force')}
            </text>
            <rect
              x={barX0} y={coulombBarY} width={barTrackW} height={barH}
              fill="none" stroke="#3A4863" strokeWidth={0.6} rx={2}
            />
            <rect
              x={barX0} y={coulombBarY} width={barTrackW * coulombFrac} height={barH}
              fill="#7EE3D8" opacity={0.85} rx={2}
            />
          </>
        )}
        {/* Force bars area on stage 3: show hidden placeholder text */}
        {isEvaluate && (
          <text
            x={FORCE_X + FORCE_W / 2} y={FORCE_Y + FORCE_H / 2 + 4}
            fill="#3A4863" fontFamily="'JetBrains Mono', monospace"
            fontSize={10} textAnchor="middle" letterSpacing="0.1em"
          >
            {'— hidden —'}
          </text>
        )}
      </svg>

      {/* HUD overlays */}
      <div style={hudTLStyle}>{hudTL}</div>
      <div style={{ ...hudTRStyle, color: canSubmit ? '#37C9B8' : '#B9C4D6' }}>{hudTR}</div>
      <div style={hudBLStyle}>{hudBL}</div>
      {/* Bottom-right reserved for parent chrome (fullscreen toggle) */}

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
                  }}>
                    {L('target')}
                  </div>
                  <div style={{
                    fontSize: '2.1rem', color: '#F9A968', fontWeight: 700, marginTop: '0.4rem',
                  }}>
                    {currentTargetName}
                  </div>
                </div>
              )}
              <FieldGroup label={`${L('field_Z')}: ${Z} (${elementName})`}>
                <NumberSlider min={Z_MIN} max={Z_MAX} value={Z} onChange={setZClamped} />
              </FieldGroup>
              <FieldGroup label={`${L('field_N')}: ${N}`}>
                <NumberSlider min={N_MIN} max={N_MAX} value={N} onChange={setNClamped} />
              </FieldGroup>
              <FieldGroup label={`${L('field_A')}: ${A}`}>
                <div style={{ padding: '1rem 1.2rem', color: '#6C7A93', fontSize: '1.8rem' }}>
                  = Z + N
                </div>
              </FieldGroup>
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
                }}>
                  {L('given')}
                </div>
                <div style={{ fontSize: '2rem', color: '#B9C4D6' }}>
                  Z = <span style={{ color: '#F97316', fontWeight: 700 }}>{currentProblem.Z}</span>
                  {'   '}
                  N = <span style={{ color: '#7EE3D8', fontWeight: 700 }}>{currentProblem.N}</span>
                </div>
              </div>
              <div style={{ fontSize: '1.7rem', color: '#B9C4D6' }}>
                {L('where_on_curve')}
              </div>
              {CHOICES.map((c) => {
                const isPicked = pick === c.region
                const isCorrect = pick !== null && c.region === currentProblem.region
                const isWrong = pick !== null && isPicked && c.region !== currentProblem.region
                const bg = isCorrect ? '#37C9B8' : isWrong ? '#F97316' : isPicked ? '#3A4863' : 'transparent'
                const fg = isCorrect || isWrong ? '#0D1524' : '#B9C4D6'
                return (
                  <button
                    key={c.key}
                    type="button"
                    disabled={pick !== null}
                    onClick={() => pickAnswer(c.region)}
                    style={{
                      padding: '1.2rem 1.4rem',
                      background: bg,
                      color: fg,
                      border: '1px solid #3A4863',
                      borderRadius: '0.5rem',
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: '1.8rem',
                      textAlign: 'left',
                      cursor: pick !== null ? 'default' : 'pointer',
                      opacity: pick !== null && !isPicked && !isCorrect ? 0.4 : 1,
                    }}
                  >
                    {L(c.key)}
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
      }}>
        {label}
      </div>
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
