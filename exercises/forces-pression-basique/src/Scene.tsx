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
import en from '../i18n/en.json'
import fr from '../i18n/fr.json'
import ar from '../i18n/ar.json'

// ─── Scene constants ────────────────────────────────────────────────────
const W = 800
const H = 450

// Scene panel: outward-label style (x=40..540, y=60..400)
const PANEL_X = 40
const PANEL_Y = 60
const PANEL_W = 500
const PANEL_H = 340

// Ground / surface line in the scene
const GROUND_Y = 320

// ─── Domain model ───────────────────────────────────────────────────────
type Bench = 'nail' | 'tack' | 'track'
type Orient = 'point' | 'flat' // for nail/tack; for track: 'point' = tank, 'flat' = tire

/**
 * A scenario is a (bench, orient) pair. Illustrative F and S numbers
 * (1ère-depth, no unit calc). Pressure = F / S in illustrative units.
 * The pure function `pressureOf` is the single source of physics truth
 * used by both the observation HUD and the blind-stage MCQ scoring.
 */
type Scenario = { bench: Bench; orient: Orient }

// Illustrative numbers only. Units labelled in HUD as N and cm².
// These are chosen so the "point/tack/tank" side always dominates in
// F/S; the wrinkle is that F may differ too (tank is heavier than car,
// but its S is enormously bigger — key case for the blind stage).
const CATALOG: Record<Bench, { label: string; forces: Record<Orient, number>; areas: Record<Orient, number> }> = {
  nail: {
    label: 'nail',
    // Same hammer strike → same F on both orientations.
    forces: { point: 50, flat: 50 },
    // Nail point ~ 0.01 cm², nail head ~ 0.5 cm²
    areas: { point: 0.01, flat: 0.5 },
  },
  tack: {
    label: 'tack',
    // Same finger press → same F both ways.
    forces: { point: 10, flat: 10 },
    // Tack point ~ 0.02 cm², tack head ~ 0.8 cm²
    areas: { point: 0.02, flat: 0.8 },
  },
  track: {
    label: 'track',
    // Tank is far heavier than a car — but distributes over a huge tread.
    // point=tank, flat=car.
    forces: { point: 400000, flat: 15000 },
    // Tank tread ~ 40000 cm² (whole belt), car tires ~ 600 cm² (4 patches).
    areas: { point: 40000, flat: 600 },
  },
}

/** Pure physics function — single source of truth for pressure grading. */
function pressureOf(s: Scenario): number {
  const c = CATALOG[s.bench]
  return c.forces[s.orient] / c.areas[s.orient]
}

/** "High" / "low" regime classifier for exploration coverage. */
function regimeOf(s: Scenario): 'high' | 'low' {
  return pressureOf(s) >= 100 ? 'high' : 'low'
}

/** Regime key used to count distinct outcomes on stage 2. */
function regimeKey(s: Scenario): string {
  return `${s.bench}:${regimeOf(s)}`
}

// ─── Blind-stage deck ────────────────────────────────────────────────────
// Ace-the-deck (§5.3 preferred). Enumerated case-classes:
//  1. same bench, same F, different S → pure "smaller S wins"
//  2. same bench (tack), same F, different S
//  3. cross-bench: nail point vs tack flat → different F, different S
//  4. tank vs car: heavier F but MUCH bigger S → the interesting case
//  5. tack point vs nail flat → different F, different S, tack wins
// Each pair has a well-defined "which side" answer via pressureOf().
type Pair = { left: Scenario; right: Scenario }

const PREDICT_DECK: Pair[] = [
  { left: { bench: 'nail', orient: 'point' }, right: { bench: 'nail', orient: 'flat' } },
  { left: { bench: 'tack', orient: 'flat' },  right: { bench: 'tack', orient: 'point' } },
  { left: { bench: 'nail', orient: 'point' }, right: { bench: 'tack', orient: 'flat' } },
  { left: { bench: 'track', orient: 'point' }, right: { bench: 'track', orient: 'flat' } },
  { left: { bench: 'tack', orient: 'point' }, right: { bench: 'nail', orient: 'flat' } },
]

type Answer = 'left' | 'right' | 'same'
function answerFor(pair: Pair): Answer {
  const pL = pressureOf(pair.left)
  const pR = pressureOf(pair.right)
  if (Math.abs(pL - pR) / Math.max(pL, pR) < 0.01) return 'same'
  return pL > pR ? 'left' : 'right'
}

// Coverage target for stage 2: 4 distinct (bench × regime) combinations.
const REGIME_TARGET = 4

// ─── i18n loader ────────────────────────────────────────────────────────
const dict = { en, fr, ar } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── Small helpers ──────────────────────────────────────────────────────
function fmtForce(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`
  return `${n}`
}
function fmtArea(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`
  if (n < 0.1) return n.toFixed(2)
  if (n < 1) return n.toFixed(2)
  return `${n}`
}
function fmtPressure(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`
  if (n >= 10) return n.toFixed(0)
  return n.toFixed(1)
}

// ─── Component ──────────────────────────────────────────────────────────
export default function Scene() {
  const { locale } = useInit()
  const stages = useMemo(() => getStagesFor(locale), [locale])
  useDeclareStages(stages)
  const labels = useMemo(() => svgLabels(locale), [locale])
  const rootRng = useSeed()

  // Seeded deck shuffle — same seed → same order.
  const deck = useMemo(() => rootRng.shuffle(PREDICT_DECK), [rootRng])

  const stageIdx = useCurrentStage()
  const setStage = useSetStage()
  const progress = useProgress()
  const complete = useComplete()

  // Stage roles:
  //   1 = Observe: bench locked to 'tack', only orientation toggles.
  //   2 = Explore: full bench + orient selectors; witness ≥4 distinct regimes.
  //   3 = Predict: blind stage. Pressure bar hidden. MCQ ace-the-deck.
  const isObserve = stageIdx === 1
  const isExplore = stageIdx === 2
  const isInteractive = isObserve || isExplore
  const isPredict = stageIdx === 3

  // Interactive state
  const [bench, setBench] = useState<Bench>('tack')
  const [orient, setOrient] = useState<Orient>('flat')
  const [seenRegimes, setSeenRegimes] = useState<Set<string>>(new Set())

  // Predict state
  const [pairIdx, setPairIdx] = useState(0)
  const [pick, setPick] = useState<Answer | null>(null)
  const [dealt, setDealt] = useState(0) // count of pairs correctly aced in this pass

  const currentPair = deck[pairIdx % deck.length]!
  const correctAnswer = answerFor(currentPair)

  const currentScenario: Scenario = { bench, orient }
  const currentP = pressureOf(currentScenario)
  const currentF = CATALOG[bench].forces[orient]
  const currentS = CATALOG[bench].areas[orient]

  // Record regime seen on interactive stages.
  useEffect(() => {
    if (!isInteractive) return
    setSeenRegimes((prev) => {
      const key = regimeKey(currentScenario)
      if (prev.has(key)) return prev
      const next = new Set(prev)
      next.add(key)
      return next
    })
    // currentScenario is a derived object — depend on primitives.
  }, [isInteractive, bench, orient])

  // Stage-1 lock: only 'tack' bench.
  useEffect(() => {
    if (isObserve && bench !== 'tack') setBench('tack')
  }, [isObserve, bench])

  // Advance criteria per stage
  const observeDone = seenRegimes.has('tack:high') && seenRegimes.has('tack:low')
  const exploreDone = seenRegimes.size >= REGIME_TARGET
  const predictDone = dealt >= deck.length
  const canSubmit = isObserve ? observeDone : isExplore ? exploreDone : predictDone

  const resetForStage = useCallback((stage: number) => {
    setBench(stage === 1 ? 'tack' : 'tack')
    setOrient('flat')
    setSeenRegimes(new Set())
    setPairIdx(0)
    setPick(null)
    setDealt(0)
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

  const pickAnswer = useCallback((choice: Answer) => {
    setPick(choice)
    // Ace-the-deck: any wrong pick restarts the deck.
    // Correct → increment dealt; when dealt reaches deck.length canSubmit fires.
    // Actual advance happens after the student clicks "next".
  }, [])

  const advancePair = useCallback(() => {
    if (pick === null) return
    if (pick === correctAnswer) {
      const newDealt = dealt + 1
      setDealt(newDealt)
      setPick(null)
      // Move to next pair unless we just finished the deck.
      if (newDealt < deck.length) {
        setPairIdx((i) => (i + 1) % deck.length)
      }
    } else {
      // Wrong → restart deck from scratch with a fresh order.
      // Re-shuffle deterministically off the same seed by re-picking rng.
      // (Order is fixed for the seed; we simply reset progress.)
      setDealt(0)
      setPairIdx(0)
      setPick(null)
    }
  }, [pick, correctAnswer, dealt, deck.length])

  // Bench/orient label helpers
  const benchLabel = (b: Bench) =>
    b === 'nail' ? labels.bench_nail : b === 'tack' ? labels.bench_tack : labels.bench_track
  const orientLabel = (b: Bench, o: Orient) => {
    if (b === 'track') return o === 'point' ? labels.orient_tank : labels.orient_tire
    return o === 'point' ? labels.orient_point : labels.orient_flat
  }

  // HUD text
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`
  const hudTR = isObserve
    ? `${labels.regimes_seen}: ${seenRegimes.size}/2`
    : isExplore
      ? `${labels.regimes_seen}: ${seenRegimes.size}/${REGIME_TARGET}`
      : `${labels.deck}: ${dealt}/${deck.length}`
  const hudBL = isObserve ? labels.tip1 : isExplore ? labels.tip2 : labels.tip3

  // For the blind stage HUD we show F and S for each side as REQUIRED
  // information (§4.7): student must be able to align paper math with
  // sim state. Pressure is HELP → hidden until submit.

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block', userSelect: 'none' }}
      >
        {/* Full-canvas bg — NO rx, NO borderRadius */}
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        {/* Scene panel — outward-label style */}
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

        {isInteractive && (
          <InteractiveScene
            bench={bench}
            orient={orient}
            pressure={currentP}
            labels={labels}
          />
        )}

        {isPredict && (
          <PredictScene
            pair={currentPair}
            pick={pick}
            correctAnswer={correctAnswer}
            labels={labels}
          />
        )}
      </svg>

      {/* HUD overlays — HTML in `rem`. NO bottom-right. */}
      <div style={{
        position: 'absolute', top: '3rem', left: '3rem',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '2.3rem', letterSpacing: '0.14em',
        textTransform: 'uppercase', color: '#6C7A93',
        zIndex: 5, pointerEvents: 'none',
      }}>
        {hudTL}
      </div>
      <div style={{
        position: 'absolute', top: '3rem', right: '3rem',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '2.3rem', letterSpacing: '0.08em',
        color: canSubmit ? '#37C9B8' : '#B9C4D6',
        zIndex: 5, pointerEvents: 'none',
      }}>
        {hudTR}
      </div>
      <div style={{
        position: 'absolute', bottom: '3rem', left: '3rem',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '2.3rem', letterSpacing: '0.06em',
        color: '#6C7A93', zIndex: 5, pointerEvents: 'none',
        maxWidth: '58%',
      }}>
        {hudBL}
      </div>

      {/* Right panel */}
      <div
        style={{
          position: 'absolute',
          top: '9.7rem', bottom: '11.1rem',
          right: '6.7rem',
          width: '40rem',
          boxSizing: 'border-box',
          zIndex: 6,
          color: '#B9C4D6',
          fontFamily: "'JetBrains Mono', monospace",
          display: 'flex', flexDirection: 'column',
        }}
      >
        <div style={{
          fontSize: '2.44rem', color: '#6C7A93',
          letterSpacing: '0.1em', marginBottom: '1.2rem',
          marginLeft: '0.4rem',
        }}>
          {isInteractive ? labels.controls : labels.question}
        </div>
        <div
          style={{
            flex: 1,
            border: '1px solid #12203a',
            borderRadius: '0.6rem',
            padding: '2.5rem',
            display: 'flex', flexDirection: 'column', gap: '2.4rem',
            fontSize: '2rem',
            overflow: 'auto',
          }}
        >
          {isInteractive && (
            <>
              <FieldGroup label={labels.field_bench}>
                <Toggle
                  options={
                    isObserve
                      ? [{ value: 'tack', label: benchLabel('tack') }]
                      : [
                          { value: 'nail', label: benchLabel('nail') },
                          { value: 'tack', label: benchLabel('tack') },
                          { value: 'track', label: benchLabel('track') },
                        ]
                  }
                  value={bench}
                  onChange={(v) => {
                    if (isObserve) return // locked
                    setBench(v as Bench)
                    // Reset orient to a sane default per bench.
                    setOrient('flat')
                  }}
                />
              </FieldGroup>
              <FieldGroup label={labels.field_orient}>
                <Toggle
                  options={[
                    { value: 'point', label: orientLabel(bench, 'point') },
                    { value: 'flat',  label: orientLabel(bench, 'flat') },
                  ]}
                  value={orient}
                  onChange={(v) => setOrient(v as Orient)}
                />
              </FieldGroup>
              <div style={{
                display: 'flex', flexDirection: 'column', gap: '0.5rem',
                padding: '0.9rem 1.1rem',
                border: '1px solid #12203a',
                borderRadius: '0.5rem',
              }}>
                <div style={{
                  fontSize: '1.5rem', color: '#54617A',
                  letterSpacing: '0.08em', textTransform: 'uppercase',
                }}>
                  {labels.field_readout}
                </div>
                <ReadoutRow label={labels.force_lbl} value={fmtForce(currentF)} unit={labels.unit_n} />
                <ReadoutRow label={labels.area_lbl}  value={fmtArea(currentS)}   unit={labels.unit_cm2} />
                <ReadoutRow
                  label={labels.pressure_lbl}
                  value={fmtPressure(currentP)}
                  unit={labels.unit_pa}
                  emphasise
                />
                <PressureBar p={currentP} />
                <div style={{
                  fontSize: '1.55rem',
                  color: regimeOf(currentScenario) === 'high' ? '#F97316' : '#37C9B8',
                  marginTop: '0.2rem',
                }}>
                  {regimeOf(currentScenario) === 'high' ? labels.regime_high : labels.regime_low}
                </div>
              </div>
            </>
          )}

          {isPredict && (
            <>
              <div style={{ fontSize: '1.85rem', color: '#B9C4D6', lineHeight: 1.4 }}>
                {labels.pick_side}
              </div>

              {/* Required-info readouts (F, S) — pressure withheld. */}
              <div style={{ display: 'flex', gap: '1.4rem' }}>
                <SideReadout
                  title={labels.left}
                  scenario={currentPair.left}
                  labels={labels}
                />
                <SideReadout
                  title={labels.right}
                  scenario={currentPair.right}
                  labels={labels}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                {(['left', 'right', 'same'] as Answer[]).map((a) => {
                  const isPicked = pick === a
                  const isRight = pick !== null && a === correctAnswer
                  const isWrong = pick !== null && isPicked && a !== correctAnswer
                  const bg =
                    isRight ? '#37C9B8'
                    : isWrong ? '#F97316'
                    : isPicked ? '#3A4863'
                    : 'transparent'
                  const fg = (isRight || isWrong) ? '#0D1524' : '#B9C4D6'
                  return (
                    <button
                      key={a}
                      type="button"
                      disabled={pick !== null}
                      onClick={() => pickAnswer(a)}
                      style={{
                        padding: '0.9rem 1.2rem',
                        background: bg,
                        color: fg,
                        border: '1px solid #3A4863',
                        borderRadius: '0.5rem',
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: '1.9rem',
                        textAlign: 'left',
                        cursor: pick !== null ? 'default' : 'pointer',
                        opacity: pick !== null && !isPicked && !isRight ? 0.4 : 1,
                      }}
                    >
                      {a === 'left' ? labels.left : a === 'right' ? labels.right : labels.same}
                      {isRight ? '  ✓' : isWrong ? '  ✗' : ''}
                    </button>
                  )
                })}
              </div>

              {pick !== null && (
                <button
                  type="button"
                  onClick={advancePair}
                  style={{
                    padding: '1rem 1.4rem',
                    background: pick === correctAnswer ? '#37C9B8' : '#F97316',
                    color: '#0D1524',
                    border: `1px solid ${pick === correctAnswer ? '#37C9B8' : '#F97316'}`,
                    borderRadius: '0.5rem',
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: '2rem',
                    cursor: 'pointer',
                  }}
                >
                  {pick === correctAnswer ? `${labels.next_q} →` : `${labels.restart_deck} ↻`}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Interactive scene (stages 1+2) ─────────────────────────────────────
function InteractiveScene({
  bench, orient, pressure, labels,
}: {
  bench: Bench; orient: Orient; pressure: number; labels: Record<string, string>
}) {
  void pressure; void labels
  // Ground line
  const gx1 = PANEL_X + 40
  const gx2 = PANEL_X + PANEL_W - 40
  return (
    <g>
      {/* Surface under the object */}
      <line x1={gx1} y1={GROUND_Y} x2={gx2} y2={GROUND_Y} stroke="#3A4863" strokeWidth={2} />
      {surfaceHatch(gx1, gx2, GROUND_Y, bench)}

      {/* Force arrow — same magnitude across orientations. */}
      <ForceArrow cx={PANEL_X + PANEL_W / 2} baseY={GROUND_Y - 190} tipY={GROUND_Y - 130} />

      {/* Object at rest on the surface */}
      {bench === 'nail' && <NailGraphic cx={PANEL_X + PANEL_W / 2} groundY={GROUND_Y} orient={orient} />}
      {bench === 'tack' && <TackGraphic cx={PANEL_X + PANEL_W / 2} groundY={GROUND_Y} orient={orient} />}
      {bench === 'track' && <TrackGraphic cx={PANEL_X + PANEL_W / 2} groundY={GROUND_Y} orient={orient} />}

      {/* Contact area indicator strip below the surface */}
      <ContactStrip cx={PANEL_X + PANEL_W / 2} groundY={GROUND_Y} bench={bench} orient={orient} />
    </g>
  )
}

function surfaceHatch(x1: number, x2: number, y: number, bench: Bench) {
  // Different hatch color per bench (wood / skin / sand) — subtle hint.
  const color = bench === 'nail' ? '#3E2E1E' : bench === 'tack' ? '#5A3A32' : '#4A3E2A'
  const marks: React.ReactElement[] = []
  const step = 12
  for (let x = x1; x < x2; x += step) {
    marks.push(
      <line
        key={x}
        x1={x} y1={y}
        x2={x + 8} y2={y + 10}
        stroke={color}
        strokeWidth={1}
        opacity={0.55}
      />,
    )
  }
  return <g pointerEvents="none">{marks}</g>
}

function ForceArrow({ cx, baseY, tipY }: { cx: number; baseY: number; tipY: number }) {
  return (
    <g pointerEvents="none">
      <line x1={cx} y1={baseY} x2={cx} y2={tipY - 8} stroke="#F9A968" strokeWidth={3} />
      <polygon
        points={`${cx - 6},${tipY - 8} ${cx + 6},${tipY - 8} ${cx},${tipY}`}
        fill="#F9A968"
      />
      <text
        x={cx + 12} y={baseY + 12}
        fill="#F9A968"
        fontFamily="'JetBrains Mono', monospace"
        fontSize={12}
      >
        F
      </text>
    </g>
  )
}

// ── Object graphics ──────────────────────────────────────────────────────
function NailGraphic({ cx, groundY, orient }: { cx: number; groundY: number; orient: Orient }) {
  // point → tip at groundY, head at top. flat → head at groundY, tip up.
  const shaftLen = 90
  const shaftW = 8
  const headR = 14
  if (orient === 'point') {
    const topY = groundY - shaftLen
    return (
      <g pointerEvents="none">
        <rect x={cx - shaftW / 2} y={topY} width={shaftW} height={shaftLen - 6} fill="#B9C4D6" stroke="#3A4863" strokeWidth={1} rx={2} />
        <polygon points={`${cx - shaftW / 2},${groundY - 6} ${cx + shaftW / 2},${groundY - 6} ${cx},${groundY + 2}`} fill="#EAF0FA" stroke="#3A4863" strokeWidth={1} />
        <circle cx={cx} cy={topY} r={headR} fill="#8090A6" stroke="#3A4863" strokeWidth={1.2} />
      </g>
    )
  }
  // flat: head down on the surface, shaft pointing up.
  const bottomY = groundY
  const topY = groundY - shaftLen
  return (
    <g pointerEvents="none">
      <ellipse cx={cx} cy={bottomY - 2} rx={headR} ry={4} fill="#8090A6" stroke="#3A4863" strokeWidth={1} />
      <rect x={cx - shaftW / 2} y={topY + 6} width={shaftW} height={shaftLen - 6} fill="#B9C4D6" stroke="#3A4863" strokeWidth={1} rx={2} />
      <polygon points={`${cx - shaftW / 2},${topY + 6} ${cx + shaftW / 2},${topY + 6} ${cx},${topY - 2}`} fill="#EAF0FA" stroke="#3A4863" strokeWidth={1} />
    </g>
  )
}

function TackGraphic({ cx, groundY, orient }: { cx: number; groundY: number; orient: Orient }) {
  const pinLen = 30
  const pinW = 5
  const headR = 20
  if (orient === 'point') {
    // Head up, pin down into surface.
    const headCy = groundY - pinLen - headR / 2
    return (
      <g pointerEvents="none">
        <rect x={cx - pinW / 2} y={headCy + headR / 2 - 2} width={pinW} height={pinLen} fill="#B9C4D6" stroke="#3A4863" strokeWidth={1} rx={1.5} />
        <polygon points={`${cx - pinW / 2},${groundY - 6} ${cx + pinW / 2},${groundY - 6} ${cx},${groundY + 1}`} fill="#EAF0FA" stroke="#3A4863" strokeWidth={1} />
        <ellipse cx={cx} cy={headCy} rx={headR} ry={headR / 2} fill="#F9A968" stroke="#B27340" strokeWidth={1.2} />
        <ellipse cx={cx - 5} cy={headCy - 3} rx={4} ry={2} fill="#FDD7B6" opacity={0.65} />
      </g>
    )
  }
  // flat: cap down on the surface.
  return (
    <g pointerEvents="none">
      <ellipse cx={cx} cy={groundY - 2} rx={headR} ry={headR / 2} fill="#F9A968" stroke="#B27340" strokeWidth={1.2} />
      <ellipse cx={cx - 5} cy={groundY - 5} rx={4} ry={2} fill="#FDD7B6" opacity={0.65} />
      <rect x={cx - pinW / 2} y={groundY - 2 - pinLen} width={pinW} height={pinLen} fill="#B9C4D6" stroke="#3A4863" strokeWidth={1} rx={1.5} />
      <polygon points={`${cx - pinW / 2},${groundY - 2 - pinLen} ${cx + pinW / 2},${groundY - 2 - pinLen} ${cx},${groundY - 2 - pinLen - 6}`} fill="#EAF0FA" stroke="#3A4863" strokeWidth={1} />
    </g>
  )
}

function TrackGraphic({ cx, groundY, orient }: { cx: number; groundY: number; orient: Orient }) {
  // point = tank tread (long spread), flat = car tires (small patches).
  if (orient === 'point') {
    // Tank: wide chunky base
    const w = 220, h = 40
    const x = cx - w / 2
    const y = groundY - h
    return (
      <g pointerEvents="none">
        <rect x={x} y={y} width={w} height={h} fill="#4E5C2C" stroke="#2A331B" strokeWidth={1.5} rx={4} />
        <rect x={x + 30} y={y - 22} width={w - 60} height={22} fill="#607037" stroke="#2A331B" strokeWidth={1} rx={3} />
        <circle cx={x + 40} cy={y - 12} r={6} fill="#2A331B" />
        {/* Barrel */}
        <rect x={cx - 8} y={y - 30} width={80} height={6} fill="#2A331B" />
        {/* Tread pattern */}
        {Array.from({ length: 11 }).map((_, i) => (
          <line
            key={i}
            x1={x + 8 + i * 20} y1={y + 6}
            x2={x + 8 + i * 20} y2={y + h - 6}
            stroke="#2A331B" strokeWidth={1.4}
          />
        ))}
      </g>
    )
  }
  // Car: small body with two tires
  const bodyW = 120, bodyH = 26
  const bx = cx - bodyW / 2
  const by = groundY - 20 - bodyH
  const tireR = 10
  return (
    <g pointerEvents="none">
      <rect x={bx} y={by} width={bodyW} height={bodyH} fill="#4A6A8A" stroke="#2A3A4A" strokeWidth={1.2} rx={5} />
      <rect x={bx + 18} y={by - 14} width={bodyW - 36} height={16} fill="#6B8DAA" stroke="#2A3A4A" strokeWidth={1} rx={3} />
      <circle cx={bx + 22} cy={groundY - tireR} r={tireR} fill="#1B1F26" stroke="#0D1524" strokeWidth={1} />
      <circle cx={bx + bodyW - 22} cy={groundY - tireR} r={tireR} fill="#1B1F26" stroke="#0D1524" strokeWidth={1} />
      <circle cx={bx + 22} cy={groundY - tireR} r={3} fill="#54617A" />
      <circle cx={bx + bodyW - 22} cy={groundY - tireR} r={3} fill="#54617A" />
    </g>
  )
}

// Contact strip: visual chip below the ground line showing the CURRENT
// contact width, kept short (relative) so students see area difference.
function ContactStrip({ cx, groundY, bench, orient }: {
  cx: number; groundY: number; bench: Bench; orient: Orient
}) {
  // Map illustrative area (cm²) to a width in SVG units, using a log scale
  // so the tiny nail-point and huge tank-tread both fit on-screen.
  const s = CATALOG[bench].areas[orient]
  const w = Math.max(3, Math.min(300, 6 + 22 * Math.log10(s + 1)))
  const y = groundY + 8
  const color = regimeOf({ bench, orient }) === 'high' ? '#F97316' : '#37C9B8'
  return (
    <g pointerEvents="none">
      <line x1={cx - w / 2} y1={y} x2={cx + w / 2} y2={y} stroke={color} strokeWidth={4} strokeLinecap="round" />
      <line x1={cx - w / 2} y1={y - 4} x2={cx - w / 2} y2={y + 4} stroke={color} strokeWidth={1.6} />
      <line x1={cx + w / 2} y1={y - 4} x2={cx + w / 2} y2={y + 4} stroke={color} strokeWidth={1.6} />
      <text
        x={cx} y={y + 18}
        fill={color}
        fontFamily="'JetBrains Mono', monospace"
        fontSize={11}
        textAnchor="middle"
      >
        S
      </text>
    </g>
  )
}

// ─── Predict scene (stage 3, blind) ─────────────────────────────────────
function PredictScene({
  pair, pick, correctAnswer, labels,
}: {
  pair: Pair; pick: Answer | null; correctAnswer: Answer;
  labels: Record<string, string>
}) {
  // Two-side split. HELP (pressure bar) is HIDDEN. REQUIRED-INFO
  // (F and S) lives in the right panel — see SideReadout.
  const midX = PANEL_X + PANEL_W / 2
  const leftCx = PANEL_X + PANEL_W * 0.28
  const rightCx = PANEL_X + PANEL_W * 0.72
  const submitted = pick !== null
  return (
    <g>
      {/* Divider */}
      <line x1={midX} y1={PANEL_Y + 12} x2={midX} y2={PANEL_Y + PANEL_H - 12} stroke="#12203a" strokeWidth={1} />

      {/* Left side */}
      <g>
        <text
          x={leftCx} y={PANEL_Y + 24}
          fill={submitted ? (correctAnswer === 'left' ? '#37C9B8' : '#6C7A93') : '#6C7A93'}
          fontFamily="'JetBrains Mono', monospace"
          fontSize={11} letterSpacing="0.1em"
          textAnchor="middle"
        >
          {labels.left}
        </text>
        <MiniScene cx={leftCx} scenario={pair.left} />
      </g>
      {/* Right side */}
      <g>
        <text
          x={rightCx} y={PANEL_Y + 24}
          fill={submitted ? (correctAnswer === 'right' ? '#37C9B8' : '#6C7A93') : '#6C7A93'}
          fontFamily="'JetBrains Mono', monospace"
          fontSize={11} letterSpacing="0.1em"
          textAnchor="middle"
        >
          {labels.right}
        </text>
        <MiniScene cx={rightCx} scenario={pair.right} />
      </g>

      {/* Post-submit outcome banner (feedback AFTER commit only) */}
      {submitted && (
        <text
          x={midX} y={PANEL_Y + PANEL_H - 20}
          fill={pick === correctAnswer ? '#37C9B8' : '#F97316'}
          fontFamily="'JetBrains Mono', monospace"
          fontSize={13}
          textAnchor="middle"
        >
          {pick === correctAnswer ? `✓ ${labels.penetrates}` : `✗ ${labels.no_penetrate}`}
        </text>
      )}
    </g>
  )
}

function MiniScene({ cx, scenario }: { cx: number; scenario: Scenario }) {
  // Same object graphics, no pressure bar or magnitudes on scene.
  const gy = GROUND_Y - 10
  return (
    <g pointerEvents="none">
      <line x1={cx - 90} y1={gy} x2={cx + 90} y2={gy} stroke="#3A4863" strokeWidth={2} />
      {scenario.bench === 'nail' && <NailGraphic cx={cx} groundY={gy} orient={scenario.orient} />}
      {scenario.bench === 'tack' && <TackGraphic cx={cx} groundY={gy} orient={scenario.orient} />}
      {scenario.bench === 'track' && <TrackGraphic cx={cx} groundY={gy} orient={scenario.orient} />}
      {/* Force arrow — same as interactive but shorter, no magnitude readout */}
      <ForceArrow cx={cx} baseY={gy - 170} tipY={gy - 118} />
    </g>
  )
}

// ─── Small right-panel components ───────────────────────────────────────
function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
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

function Toggle<T extends string>({ options, value, onChange }: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            style={{
              flex: 1,
              minWidth: '10rem',
              padding: '0.8rem 0.8rem',
              background: active ? '#3A4863' : 'transparent',
              color: active ? '#EAF0FA' : '#6C7A93',
              border: '1px solid #3A4863',
              borderRadius: '0.5rem',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '1.7rem',
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

function ReadoutRow({ label, value, unit, emphasise }: {
  label: string; value: string; unit: string; emphasise?: boolean
}) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between',
      alignItems: 'baseline', gap: '1rem',
    }}>
      <span style={{
        fontSize: '1.6rem',
        color: emphasise ? '#F9A968' : '#6C7A93',
        fontWeight: emphasise ? 700 : 400,
      }}>
        {label}
      </span>
      <span style={{
        fontSize: emphasise ? '2rem' : '1.7rem',
        color: emphasise ? '#F9A968' : '#B9C4D6',
        fontWeight: emphasise ? 700 : 400,
      }}>
        {value} <span style={{ fontSize: '1.3rem', color: '#54617A' }}>{unit}</span>
      </span>
    </div>
  )
}

function PressureBar({ p }: { p: number }) {
  // Log-scaled bar so tiny + huge values both fit.
  const w = Math.max(2, Math.min(100, 8 * Math.log10(p + 1)))
  const isHigh = p >= 100
  const color = isHigh ? '#F97316' : '#37C9B8'
  return (
    <div style={{
      height: '0.6rem',
      background: '#12203a',
      borderRadius: '0.3rem',
      overflow: 'hidden',
      marginTop: '0.4rem',
    }}>
      <div style={{
        width: `${w}%`,
        height: '100%',
        background: color,
        transition: 'width 0.2s ease-out',
      }} />
    </div>
  )
}

function SideReadout({ title, scenario, labels }: {
  title: string; scenario: Scenario; labels: Record<string, string>
}) {
  const F = CATALOG[scenario.bench].forces[scenario.orient]
  const S = CATALOG[scenario.bench].areas[scenario.orient]
  return (
    <div style={{
      flex: 1,
      border: '1px solid #12203a',
      borderRadius: '0.5rem',
      padding: '0.9rem 1rem',
      display: 'flex', flexDirection: 'column', gap: '0.35rem',
      fontSize: '1.6rem',
    }}>
      <div style={{
        fontSize: '1.4rem', letterSpacing: '0.1em',
        textTransform: 'uppercase', color: '#54617A',
      }}>
        {title}
      </div>
      <div style={{ color: '#B9C4D6' }}>
        {labels.force_lbl} = {fmtForce(F)} <span style={{ color: '#54617A' }}>{labels.unit_n}</span>
      </div>
      <div style={{ color: '#B9C4D6' }}>
        {labels.area_lbl} = {fmtArea(S)} <span style={{ color: '#54617A' }}>{labels.unit_cm2}</span>
      </div>
    </div>
  )
}
