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
} from '@physics/sdk/react'
import { getHintFor, getStagesFor } from './stages'
import en from '../i18n/en.json'
import fr from '../i18n/fr.json'
import ar from '../i18n/ar.json'

// ─── Scene constants ────────────────────────────────────────────────────
const W = 800
const H = 450

// Scene panel (aligned with the reference exercise's 500×340 box).
const PANEL_X = 40
const PANEL_Y = 60
const PANEL_W = 500
const PANEL_H = 340
const SUN_CX = PANEL_X + PANEL_W / 2
const SUN_CY = PANEL_Y + PANEL_H / 2

// ─── Solar-system domain model ─────────────────────────────────────────
type Planet = {
  key: 'mercury' | 'venus' | 'earth' | 'mars' | 'jupiter' | 'saturn' | 'uranus' | 'neptune'
  au: number // orbital semi-major axis in AU (approximate)
  periodYears: number // sidereal period (approximate)
  radiusEarths: number // planet radius in Earth radii (visual only, sqrt-compressed later)
  color: string
  hasRing?: boolean
}

const PLANETS: Planet[] = [
  { key: 'mercury', au: 0.39, periodYears: 0.241, radiusEarths: 0.38, color: '#B9A88A' },
  { key: 'venus', au: 0.72, periodYears: 0.615, radiusEarths: 0.95, color: '#E9C79A' },
  { key: 'earth', au: 1.0, periodYears: 1.0, radiusEarths: 1.0, color: '#5FB6E8' },
  { key: 'mars', au: 1.52, periodYears: 1.881, radiusEarths: 0.53, color: '#D96B3A' },
  { key: 'jupiter', au: 5.20, periodYears: 11.86, radiusEarths: 11.2, color: '#D6B27A' },
  { key: 'saturn', au: 9.58, periodYears: 29.46, radiusEarths: 9.45, color: '#E3CE94', hasRing: true },
  { key: 'uranus', au: 19.2, periodYears: 84.01, radiusEarths: 4.01, color: '#A6DFE0' },
  { key: 'neptune', au: 30.05, periodYears: 164.8, radiusEarths: 3.88, color: '#5A7CE0' },
]

// Time slider spans 0..165 years so Neptune (P ≈ 164.8y) completes one full lap.
const T_MIN = 0
const T_MAX = 165

// Panel-space radii for the orbits.
// LINEAR mapping compresses inner planets so all 8 fit in a 150-px radius; still visibly cramped.
// LOG mapping spaces them roughly evenly for legibility.
const ORBIT_MAX_R = 150

function orbitR(au: number, mode: 'linear' | 'log'): number {
  if (mode === 'linear') {
    return (au / 30.05) * ORBIT_MAX_R
  }
  // log10, mapped so mercury (0.39) → ~14, neptune (30.05) → ORBIT_MAX_R.
  const lo = Math.log10(0.39)
  const hi = Math.log10(30.05)
  const t = (Math.log10(au) - lo) / (hi - lo)
  return 14 + t * (ORBIT_MAX_R - 14)
}

// Planet visual radius — sqrt-compressed so Jupiter isn't 11× Earth on screen.
function planetVisR(radiusEarths: number): number {
  return 1.6 + Math.sqrt(radiusEarths) * 1.2
}

// ─── Concept-card deck (blind stage) ───────────────────────────────────
type OptionKey = 'a' | 'b' | 'c' | 'd'
type Scenario = {
  id: 'distance' | 'seasons' | 'daynight' | 'size' | 'galaxy'
  correct: OptionKey
}
const PREDICT_DECK: Scenario[] = [
  { id: 'distance', correct: 'c' },
  { id: 'seasons', correct: 'c' },
  { id: 'daynight', correct: 'b' },
  { id: 'size', correct: 'a' },
  { id: 'galaxy', correct: 'b' },
]
const OPTION_KEYS: OptionKey[] = ['a', 'b', 'c', 'd']

// ─── Label loader ──────────────────────────────────────────────────────
const dict = { en, fr, ar } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── Component ─────────────────────────────────────────────────────────
export default function Scene() {
  const { locale } = useInit()
  const stages = useMemo(() => getStagesFor(locale), [locale])
  useDeclareStages(stages)
  const labels = useMemo(() => svgLabels(locale), [locale])
  const rootRng = useSeed()

  const stageIdx = useCurrentStage()
  const setStage = useSetStage()
  const progress = useProgress()
  const complete = useComplete()

  const isObserve = stageIdx === 1
  const isPredict = stageIdx === 2

  // Stage 1 (Observe) state
  const [tYears, setTYears] = useState(0)
  const [scale, setScale] = useState<'linear' | 'log'>('linear')
  const [seasonsOn, setSeasonsOn] = useState(false)
  const [touchedControls, setTouchedControls] = useState<Set<string>>(new Set())

  // Stage 2 (Evaluate) state — ace-the-deck with restart on wrong
  const deckOrder = useMemo(() => rootRng.shuffle(PREDICT_DECK), [rootRng])
  // Re-shuffle each time the student restarts the deck (wrong answer).
  const [deckSeed, setDeckSeed] = useState(0)
  const activeDeck = useMemo(() => {
    if (deckSeed === 0) return deckOrder
    // Deterministic re-shuffle: rotate then re-shuffle via a fresh RNG-independent swap.
    // We just rotate by deckSeed and reverse when odd, so order changes but stays reproducible.
    const rotated = [...deckOrder.slice(deckSeed % deckOrder.length), ...deckOrder.slice(0, deckSeed % deckOrder.length)]
    return deckSeed % 2 === 0 ? rotated : rotated.slice().reverse()
  }, [deckOrder, deckSeed])
  const [scenarioIdx, setScenarioIdx] = useState(0)
  const [pick, setPick] = useState<OptionKey | null>(null)
  const [aced, setAced] = useState(false)
  const [peekOpen, setPeekOpen] = useState(false)

  const scenario = activeDeck[scenarioIdx % activeDeck.length]!
  const correctAnswer = scenario.correct

  const COVERAGE_TARGET = 3
  const observeDone = touchedControls.size >= COVERAGE_TARGET
  const predictDone = aced
  const canSubmit = isObserve ? observeDone : predictDone

  const markTouched = useCallback((key: string) => {
    setTouchedControls((prev) => {
      if (prev.has(key)) return prev
      const next = new Set(prev)
      next.add(key)
      return next
    })
  }, [])

  const resetForStage = useCallback((stage: number) => {
    setTYears(0)
    setScale('linear')
    setSeasonsOn(false)
    setTouchedControls(new Set())
    setScenarioIdx(0)
    setPick(null)
    setAced(false)
    setDeckSeed(0)
    setPeekOpen(false)
    void stage
  }, [])

  useReset(() => resetForStage(stageIdx))

  useEffect(() => {
    progress(stageIdx / stages.length, { stage: stageIdx, canSubmit })
  }, [stageIdx, canSubmit, stages.length, progress])

  useNext(() => {
    if (stageIdx < stages.length) {
      const next = stageIdx + 1
      setStage(next)
      resetForStage(next)
    } else {
      complete({ success: true })
    }
  })

  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  usePeek(() => {
    setPeekOpen(true)
    setTimeout(() => setPeekOpen(false), 3500)
  })

  const onTimeChange = useCallback((v: number) => {
    setTYears(v)
    markTouched('time')
  }, [markTouched])

  const onScaleChange = useCallback((v: 'linear' | 'log') => {
    setScale(v)
    markTouched('scale')
  }, [markTouched])

  const onSeasonsChange = useCallback((v: boolean) => {
    setSeasonsOn(v)
    markTouched('seasons')
  }, [markTouched])

  const pickAnswer = useCallback((choice: OptionKey) => {
    if (pick !== null) return
    setPick(choice)
    const ok = choice === correctAnswer
    if (ok) {
      // Auto-advance after brief pause so student sees the confirmation.
      setTimeout(() => {
        setPick(null)
        if (scenarioIdx + 1 >= activeDeck.length) {
          setAced(true)
        } else {
          setScenarioIdx((i) => i + 1)
        }
      }, 900)
    }
    // On wrong: student must explicitly restart via the button (visible cost + reflection moment).
  }, [pick, correctAnswer, scenarioIdx, activeDeck.length])

  const restartDeck = useCallback(() => {
    setPick(null)
    setScenarioIdx(0)
    setDeckSeed((s) => s + 1)
  }, [])

  // ─── Question content lookup ──────────────────────────────────────────
  type L = typeof labels
  const questionTitle = (s: Scenario, l: L): string => l[`q_${s.id}_title` as keyof L] as string
  const questionPrompt = (s: Scenario, l: L): string => l[`q_${s.id}_prompt` as keyof L] as string
  const optionText = (s: Scenario, opt: OptionKey, l: L): string =>
    l[`q_${s.id}_${opt}` as keyof L] as string

  // ─── HUD text ─────────────────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`
  const streakCount = aced ? activeDeck.length : scenarioIdx + (pick !== null && pick === correctAnswer ? 1 : 0)
  const hudTR = isObserve
    ? `${labels.coverage}: ${touchedControls.size}/${COVERAGE_TARGET}`
    : `${labels.streak}: ${streakCount}/${activeDeck.length}`
  const hudBL = isObserve ? labels.tip1 : labels.tip2

  // ─── Scene geometry (Stage 1) ─────────────────────────────────────────
  // Earth's orbital phase for seasons demo (fraction of an Earth year).
  const earthPhase = ((tYears % 1) + 1) % 1

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block', userSelect: 'none' }}
      >
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        {/* Scene panel — title outside above box */}
        <rect
          x={PANEL_X}
          y={PANEL_Y}
          width={PANEL_W}
          height={PANEL_H}
          fill="none"
          stroke="#12203a"
          strokeWidth={1}
          rx={6}
        />
        <text
          x={PANEL_X + 8}
          y={PANEL_Y - 8}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={11}
          letterSpacing="0.1em"
        >
          {labels.scene_title}
        </text>

        {isObserve && (
          <>
            {/* Background starfield */}
            <Starfield cx={SUN_CX} cy={SUN_CY} r={ORBIT_MAX_R + 15} />

            {/* Orbits */}
            {PLANETS.map((p) => (
              <circle
                key={`orbit-${p.key}`}
                cx={SUN_CX}
                cy={SUN_CY}
                r={orbitR(p.au, scale)}
                fill="none"
                stroke="#1B2A48"
                strokeWidth={0.6}
                strokeDasharray="2 3"
              />
            ))}

            {/* Sun */}
            <circle cx={SUN_CX} cy={SUN_CY} r={8} fill="#F9A968" />
            <circle cx={SUN_CX} cy={SUN_CY} r={12} fill="none" stroke="#F97316" strokeWidth={0.6} opacity={0.5} />
            <text
              x={SUN_CX}
              y={SUN_CY + 22}
              fill="#6C7A93"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={9}
              textAnchor="middle"
            >
              {labels.sun}
            </text>

            {/* Planets — angle from period */}
            {PLANETS.map((p) => {
              const r = orbitR(p.au, scale)
              const angle = (tYears / p.periodYears) * 2 * Math.PI
              const cx = SUN_CX + r * Math.cos(angle)
              const cy = SUN_CY + r * Math.sin(angle)
              const pr = planetVisR(p.radiusEarths)
              const showLabel = p.key === 'earth' || p.key === 'neptune' || p.key === 'jupiter' || p.key === 'mercury'
              return (
                <g key={p.key}>
                  {p.hasRing && (
                    <ellipse
                      cx={cx}
                      cy={cy}
                      rx={pr * 2.1}
                      ry={pr * 0.7}
                      fill="none"
                      stroke={p.color}
                      strokeWidth={0.6}
                      opacity={0.7}
                    />
                  )}
                  <circle cx={cx} cy={cy} r={pr} fill={p.color} />
                  {showLabel && (
                    <text
                      x={cx}
                      y={cy - pr - 4}
                      fill="#B9C4D6"
                      fontFamily="'JetBrains Mono', monospace"
                      fontSize={7}
                      textAnchor="middle"
                    >
                      {labels[p.key]}
                    </text>
                  )}
                </g>
              )
            })}

            {/* Seasons inset — top-left of panel */}
            {seasonsOn && <SeasonsInset x={PANEL_X + 12} y={PANEL_Y + 12} phase={earthPhase} labels={labels} />}
          </>
        )}

        {isPredict && (
          <>
            {/* Blind stage — no diagram. Just a starfield token so the panel isn't empty. */}
            <Starfield cx={SUN_CX} cy={SUN_CY} r={ORBIT_MAX_R + 15} density={40} />
            <text
              x={SUN_CX}
              y={SUN_CY - 8}
              fill="#3A4863"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={11}
              textAnchor="middle"
              letterSpacing="0.15em"
            >
              — no diagram —
            </text>
            <text
              x={SUN_CX}
              y={SUN_CY + 12}
              fill="#3A4863"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={9}
              textAnchor="middle"
              letterSpacing="0.1em"
            >
              answer from concept
            </text>
          </>
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
      </div>
      <div
        style={{
          position: 'absolute',
          top: '3rem',
          right: '3rem',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '2.3rem',
          letterSpacing: '0.08em',
          color: canSubmit ? '#37C9B8' : '#B9C4D6',
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
          maxWidth: '58%',
        }}
      >
        {hudBL}
      </div>

      {/* Right panel — aligned with SVG scene box y=60..400 */}
      <div
        style={{
          position: 'absolute',
          top: '9.7rem',
          bottom: '11.1rem',
          right: '6.7rem',
          width: '40rem',
          boxSizing: 'border-box',
          zIndex: 6,
          color: '#B9C4D6',
          fontFamily: "'JetBrains Mono', monospace",
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            fontSize: '2.44rem',
            color: '#6C7A93',
            letterSpacing: '0.1em',
            marginBottom: '1.2rem',
            marginLeft: '0.4rem',
          }}
        >
          {isObserve ? labels.controls : labels.question}
        </div>
        <div
          style={{
            flex: 1,
            border: '1px solid #12203a',
            borderRadius: '0.6rem',
            padding: '2.5rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '2.5rem',
            fontSize: '2rem',
            overflow: 'auto',
          }}
        >
          {isObserve && (
            <>
              <FieldGroup label={labels.field_time}>
                <Slider min={T_MIN} max={T_MAX} step={0.1} value={tYears} onChange={onTimeChange} />
                <div style={{ fontSize: '1.7rem', color: '#6C7A93', marginTop: '0.4rem' }}>
                  {tYears.toFixed(1)} {labels.years}
                </div>
              </FieldGroup>
              <FieldGroup label={labels.field_scale}>
                <Toggle
                  options={[
                    { value: 'linear', label: labels.linear },
                    { value: 'log', label: labels.log },
                  ]}
                  value={scale}
                  onChange={(v) => onScaleChange(v as 'linear' | 'log')}
                />
              </FieldGroup>
              <FieldGroup label={labels.field_seasons}>
                <Toggle
                  options={[
                    { value: 'off', label: labels.off },
                    { value: 'on', label: labels.on },
                  ]}
                  value={seasonsOn ? 'on' : 'off'}
                  onChange={(v) => onSeasonsChange(v === 'on')}
                />
              </FieldGroup>
            </>
          )}

          {isPredict && (
            <>
              <div style={{ fontSize: '1.6rem', color: '#6C7A93', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                {scenarioIdx + 1} / {activeDeck.length} · {questionTitle(scenario, labels)}
              </div>
              <div style={{ fontSize: '1.9rem', color: '#EAF0FA', lineHeight: 1.4 }}>
                {questionPrompt(scenario, labels)}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                {OPTION_KEYS.map((opt) => {
                  const isPicked = pick === opt
                  const isCorrect = pick !== null && opt === correctAnswer
                  const isWrong = pick !== null && isPicked && opt !== correctAnswer
                  const bg = isCorrect ? '#37C9B8' : isWrong ? '#F97316' : isPicked ? '#3A4863' : 'transparent'
                  const fg = isCorrect || isWrong ? '#0D1524' : '#B9C4D6'
                  return (
                    <button
                      key={opt}
                      type="button"
                      disabled={pick !== null}
                      onClick={() => pickAnswer(opt)}
                      style={{
                        padding: '0.9rem 1.1rem',
                        background: bg,
                        color: fg,
                        border: '1px solid #3A4863',
                        borderRadius: '0.5rem',
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: '1.7rem',
                        textAlign: 'left',
                        cursor: pick !== null ? 'default' : 'pointer',
                        opacity: pick !== null && !isPicked && !isCorrect ? 0.35 : 1,
                        lineHeight: 1.35,
                      }}
                    >
                      <span style={{ opacity: 0.6, marginRight: '0.6em' }}>{opt.toUpperCase()}.</span>
                      {optionText(scenario, opt, labels)}
                      {isCorrect ? '  ✓' : isWrong ? '  ✗' : ''}
                    </button>
                  )
                })}
              </div>
              {pick !== null && pick !== correctAnswer && (
                <button
                  type="button"
                  onClick={restartDeck}
                  style={{
                    padding: '0.9rem 1.2rem',
                    background: 'transparent',
                    color: '#F97316',
                    border: '1px solid #F97316',
                    borderRadius: '0.5rem',
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: '1.7rem',
                    cursor: 'pointer',
                  }}
                >
                  ↻ {labels.restart_deck}
                </button>
              )}
              {peekOpen && (
                <div
                  style={{
                    padding: '0.8rem 1rem',
                    background: 'rgba(249,169,104,0.08)',
                    border: '1px solid #F9A968',
                    borderRadius: '0.5rem',
                    color: '#F9A968',
                    fontSize: '1.5rem',
                    lineHeight: 1.4,
                  }}
                >
                  Strategy: think in orders of magnitude for distances (AU vs ly).
                  Seasons come from axial tilt, not distance. Day/night comes from spin, not orbit.
                  We orbit an ordinary star on a spiral arm — not at the galactic center.
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Small SVG helpers ─────────────────────────────────────────────────
function Starfield({ cx, cy, r, density = 60 }: { cx: number; cy: number; r: number; density?: number }) {
  // Deterministic pseudo-random star positions from a fixed hash — same on every render.
  const stars = useMemo(() => {
    const out: { x: number; y: number; s: number }[] = []
    for (let i = 0; i < density; i++) {
      // LCG-ish deterministic hash
      const h1 = Math.sin(i * 12.9898) * 43758.5453
      const h2 = Math.sin(i * 78.233) * 43758.5453
      const h3 = Math.sin(i * 39.346) * 43758.5453
      const rx = (h1 - Math.floor(h1)) * 2 - 1
      const ry = (h2 - Math.floor(h2)) * 2 - 1
      const rs = (h3 - Math.floor(h3))
      out.push({ x: cx + rx * r, y: cy + ry * r, s: 0.4 + rs * 0.8 })
    }
    return out
  }, [cx, cy, r, density])
  return (
    <g pointerEvents="none">
      {stars.map((st, i) => (
        <circle key={i} cx={st.x} cy={st.y} r={st.s} fill="#3A4863" opacity={0.55} />
      ))}
    </g>
  )
}

// Seasons inset — Earth with tilted axis + subsolar point sliding between the tropics.
function SeasonsInset({
  x,
  y,
  phase,
  labels,
}: {
  x: number
  y: number
  phase: number
  labels: Record<string, string>
}) {
  const boxW = 130
  const boxH = 100
  const cx = x + boxW / 2
  const cy = y + boxH / 2 + 4
  const earthR = 22
  // Subsolar latitude — sinusoidal between ±23.5°, phase=0 → March equinox.
  const subsolarDeg = 23.5 * Math.sin(2 * Math.PI * phase)
  // Sun on the left of Earth for the inset.
  const sunX = x + 14
  const sunY = cy

  return (
    <g>
      <rect x={x} y={y} width={boxW} height={boxH} fill="#0A111E" stroke="#12203a" strokeWidth={0.6} rx={4} />
      <text
        x={x + 6}
        y={y + 10}
        fill="#54617A"
        fontFamily="'JetBrains Mono', monospace"
        fontSize={7}
        letterSpacing="0.08em"
      >
        {labels.seasons}
      </text>
      {/* Sunlight rays */}
      <line x1={sunX} y1={sunY - 10} x2={cx - earthR} y2={sunY - 10} stroke="#F9A968" strokeWidth={0.5} opacity={0.6} />
      <line x1={sunX} y1={sunY} x2={cx - earthR} y2={sunY} stroke="#F9A968" strokeWidth={0.5} opacity={0.6} />
      <line x1={sunX} y1={sunY + 10} x2={cx - earthR} y2={sunY + 10} stroke="#F9A968" strokeWidth={0.5} opacity={0.6} />
      <circle cx={sunX} cy={sunY} r={4} fill="#F9A968" />
      {/* Earth with tilted axis (23.5°) */}
      <g transform={`translate(${cx} ${cy}) rotate(-23.5)`}>
        <circle cx={0} cy={0} r={earthR} fill="#1F3E6A" stroke="#3A4863" strokeWidth={0.6} />
        <line x1={0} y1={-earthR - 4} x2={0} y2={earthR + 4} stroke="#B9C4D6" strokeWidth={0.6} />
        {/* Equator line */}
        <line x1={-earthR} y1={0} x2={earthR} y2={0} stroke="#3A4863" strokeWidth={0.4} />
        {/* Tropics */}
        <line x1={-earthR + 3} y1={-earthR * 0.4} x2={earthR - 3} y2={-earthR * 0.4} stroke="#3A4863" strokeWidth={0.3} strokeDasharray="1 1" />
        <line x1={-earthR + 3} y1={earthR * 0.4} x2={earthR - 3} y2={earthR * 0.4} stroke="#3A4863" strokeWidth={0.3} strokeDasharray="1 1" />
        {/* Subsolar point — dot at the tilt-space y matching the current subsolar latitude,
            projected onto the tilted Earth surface. In tilted frame: dot is on the Sun-facing
            hemisphere at latitude subsolarDeg (positive = north). */}
        <circle cx={-earthR * Math.cos((subsolarDeg * Math.PI) / 180)} cy={-earthR * Math.sin((subsolarDeg * Math.PI) / 180)} r={1.6} fill="#F9A968" />
      </g>
      <text
        x={x + boxW - 6}
        y={y + boxH - 6}
        fill="#54617A"
        fontFamily="'JetBrains Mono', monospace"
        fontSize={6}
        textAnchor="end"
      >
        {subsolarDeg >= 0 ? '+' : ''}{subsolarDeg.toFixed(1)}°
      </text>
    </g>
  )
}

// ─── Small HTML components ─────────────────────────────────────────────
function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
      <div style={{ fontSize: '1.5rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: '#54617A' }}>
        {label}
      </div>
      {children}
    </div>
  )
}

function Toggle<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div style={{ display: 'flex', gap: '0.6rem' }}>
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            style={{
              flex: 1,
              padding: '0.9rem 1rem',
              background: active ? '#3A4863' : 'transparent',
              color: active ? '#EAF0FA' : '#6C7A93',
              border: '1px solid #3A4863',
              borderRadius: '0.5rem',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '1.8rem',
              cursor: 'pointer',
            }}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

function Slider({
  min,
  max,
  step,
  value,
  onChange,
}: {
  min: number
  max: number
  step: number
  value: number
  onChange: (v: number) => void
}) {
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      style={{
        width: '100%',
        accentColor: '#37C9B8',
        cursor: 'pointer',
      }}
    />
  )
}
