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
  useSetStage,
} from '@physics/sdk/react'
import { getHintFor, getStagesFor } from './stages'
import en from '../i18n/en.json'

// ─── Scene constants ────────────────────────────────────────────────────
const W = 800
const H = 450

// Loop rectangle (world coords)
const LOOP_LEFT = 160
const LOOP_RIGHT = 480
const LOOP_TOP = 110
const LOOP_BOTTOM = 290

// Slot centres
const SLOT_AMMETER = { x: (LOOP_LEFT + LOOP_RIGHT) / 2, y: LOOP_TOP }
const SLOT_BATTERY = { x: LOOP_LEFT, y: (LOOP_TOP + LOOP_BOTTOM) / 2 }
const SLOT_LAMP = { x: (LOOP_LEFT + LOOP_RIGHT) / 2, y: LOOP_BOTTOM }
const SLOT_SAMPLE = { x: LOOP_RIGHT, y: (LOOP_TOP + LOOP_BOTTOM) / 2 }

// ─── Physics ────────────────────────────────────────────────────────────
// E = 12 V, series (lamp filament + wires) resistance R_series = 100 Ω,
// fixed cross-section S = 1 mm² = 1e-6 m². Length ℓ in metres.
// R_mat = ρ · ℓ / S ; I = E / (R_series + R_mat).
// Test vector: copper, ℓ = 0.20 m → R_mat = 1.7e-8·0.20/1e-6 = 3.4e-3 Ω
//   → I = 12 / 100.0034 ≈ 0.11999 A ≈ 120 mA → BRIGHT.
// Test vector: graphite, ℓ = 0.50 m → R_mat = 3e-4·0.5/1e-6 = 150 Ω
//   → I = 12 / 250 = 48 mA → DIM.
// Test vector: plastic, ℓ = 0.20 m → R_mat ≈ 2e12 Ω → I ≈ 6e-12 A → OFF.
const E_VOLTS = 12
const R_SERIES = 100
const S_CROSS = 1e-6

type MaterialId =
  | 'copper'
  | 'aluminum'
  | 'graphite'
  | 'salt_water'
  | 'tap_water'
  | 'distilled'
  | 'plastic'

type Category = 'conductor' | 'semi' | 'insulator'

type MaterialSpec = {
  id: MaterialId
  labelKey: string
  rho: number // Ω·m
  category: Category
  fill: string
  stroke: string
}

const MATERIALS: MaterialSpec[] = [
  { id: 'copper',     labelKey: 'mat_copper',    rho: 1.7e-8, category: 'conductor', fill: '#B76A3A', stroke: '#F9A968' },
  { id: 'aluminum',   labelKey: 'mat_aluminum',  rho: 2.8e-8, category: 'conductor', fill: '#7E8B9E', stroke: '#B9C4D6' },
  { id: 'graphite',   labelKey: 'mat_graphite',  rho: 3e-4,   category: 'semi',      fill: '#2A3247', stroke: '#8790A6' },
  { id: 'salt_water', labelKey: 'mat_salt_water', rho: 0.2,   category: 'semi',      fill: '#1F4058', stroke: '#7EE3D8' },
  { id: 'tap_water',  labelKey: 'mat_tap_water', rho: 200,    category: 'insulator', fill: '#1B3A4E', stroke: '#5AB0C7' },
  { id: 'distilled',  labelKey: 'mat_distilled', rho: 2e5,    category: 'insulator', fill: '#1A2E44', stroke: '#4A88A8' },
  { id: 'plastic',    labelKey: 'mat_plastic',   rho: 1e13,   category: 'insulator', fill: '#3B3247', stroke: '#B99AD6' },
]

function specOf(id: MaterialId): MaterialSpec {
  return MATERIALS.find((m) => m.id === id)!
}

/** Current in amps for a given material + length (m). */
function computeCurrent(rho: number, lengthM: number): number {
  const R_mat = (rho * lengthM) / S_CROSS
  return E_VOLTS / (R_SERIES + R_mat)
}

type Outcome = 'bright' | 'dim' | 'off'

const BRIGHT_MIN_A = 0.06 // ≥ 60 mA → bright
const DIM_MIN_A = 0.003 // ≥ 3 mA → at least dim

function outcomeOf(currentA: number): Outcome {
  if (currentA >= BRIGHT_MIN_A) return 'bright'
  if (currentA >= DIM_MIN_A) return 'dim'
  return 'off'
}

// ─── Stage-3 scenarios (hand-authored deck, seed-picked, ace 3 in a row) ─
type Stage3Scenario = { material: MaterialId; lengthCm: number; correct: Outcome }
const STAGE3_DECK: Stage3Scenario[] = [
  { material: 'copper',     lengthCm: 20, correct: 'bright' },
  { material: 'graphite',   lengthCm: 50, correct: 'dim' },
  { material: 'plastic',    lengthCm: 30, correct: 'off' },
  { material: 'aluminum',   lengthCm: 40, correct: 'bright' },
  { material: 'tap_water',  lengthCm: 20, correct: 'off' },
  { material: 'graphite',   lengthCm: 15, correct: 'bright' },
  { material: 'distilled',  lengthCm: 25, correct: 'off' },
  { material: 'salt_water', lengthCm: 10, correct: 'off' },
]
const STAGE3_CHAIN_TARGET = 3

// ─── Locale label loader ────────────────────────────────────────────────
const dict = { en } as const
type Locale = keyof typeof dict
function svgLabels(locale: string): Record<string, string> {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels as Record<string, string>
}

// ─── Length slider bounds ───────────────────────────────────────────────
const LENGTH_MIN_CM = 5
const LENGTH_MAX_CM = 50
const LENGTH_DEFAULT_CM = 20

// ─── Component ──────────────────────────────────────────────────────────
export default function Scene() {
  const { locale, seed } = useInit()
  const stages = useMemo(() => getStagesFor(locale), [locale])
  useDeclareStages(stages)
  const labels = useMemo(() => svgLabels(locale), [locale])

  const stageIdx = useCurrentStage()
  const setStage = useSetStage()

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  // ─── Editable state (stages 1 + 2) ────────────────────────────────
  const [material, setMaterial] = useState<MaterialId | null>(null)
  const [lengthCm, setLengthCm] = useState<number>(LENGTH_DEFAULT_CM)

  // ─── Stage-1 coverage ────────────────────────────────────────────
  const [sawBright, setSawBright] = useState(false)
  const [sawOff, setSawOff] = useState(false)

  // ─── Stage-2 targets ─────────────────────────────────────────────
  const [target2Hit, setTarget2Hit] = useState<Record<Outcome, boolean>>({
    bright: false,
    dim: false,
    off: false,
  })

  // ─── Stage-3 blind prediction ────────────────────────────────────
  const [scenarioCursor, setScenarioCursor] = useState<number>(seed >>> 0)
  const [chain, setChain] = useState<number>(0)
  const [lastPrediction, setLastPrediction] = useState<Outcome | null>(null)
  const [lastResult, setLastResult] = useState<null | 'correct' | 'wrong'>(null)

  const scenario = STAGE3_DECK[scenarioCursor % STAGE3_DECK.length]!

  // Effective material/length depends on stage. On stage 3 the puzzle
  // dictates them; on stages 1+2 the student sets them.
  const activeMaterial: MaterialId | null = isStage3 ? scenario.material : material
  const activeLengthCm: number = isStage3 ? scenario.lengthCm : lengthCm
  const activeLengthM = activeLengthCm / 100
  const activeSpec = activeMaterial ? specOf(activeMaterial) : null

  const currentA = activeSpec ? computeCurrent(activeSpec.rho, activeLengthM) : 0
  const currentMA = currentA * 1000
  const outcome: Outcome | null = activeSpec ? outcomeOf(currentA) : null

  const complete = useComplete()
  const progress = useProgress()

  // Stage-1 coverage tracking (only outside stage 3 to keep the live
  // outcome sensor completely quiet during the blind stage).
  useEffect(() => {
    if (!isStage1 || !outcome) return
    if (outcome === 'bright' && !sawBright) setSawBright(true)
    if (outcome === 'off' && !sawOff) setSawOff(true)
  }, [isStage1, outcome, sawBright, sawOff])

  // Stage-2 target tracking
  useEffect(() => {
    if (!isStage2 || !outcome) return
    if (!target2Hit[outcome]) {
      setTarget2Hit((prev) => ({ ...prev, [outcome]: true }))
    }
  }, [isStage2, outcome, target2Hit])

  const stage1Done = sawBright && sawOff
  const stage2Done = target2Hit.bright && target2Hit.dim && target2Hit.off
  const stage3Done = chain >= STAGE3_CHAIN_TARGET

  const canSubmit = isStage1 ? stage1Done : isStage2 ? stage2Done : stage3Done

  const resetStageState = useCallback(() => {
    setMaterial(null)
    setLengthCm(LENGTH_DEFAULT_CM)
    setSawBright(false)
    setSawOff(false)
    setTarget2Hit({ bright: false, dim: false, off: false })
    setChain(0)
    setLastPrediction(null)
    setLastResult(null)
    setScenarioCursor(seed >>> 0)
  }, [seed])

  useReset(resetStageState)

  useEffect(() => {
    progress(stageIdx / stages.length, { stage: stageIdx, canSubmit })
  }, [stageIdx, canSubmit, stages.length, progress])

  useNext(() => {
    if (stageIdx < stages.length) {
      setStage(stageIdx + 1)
    } else {
      complete({ success: true })
    }
  })

  // ─── Peek — strategy hint only, NEVER reveals the answer (§4.7) ───
  const [peekText, setPeekText] = useState<string | null>(null)
  usePeek(() => {
    if (!isStage3) return
    setPeekText(labels.peek_tip ?? '')
  })
  useEffect(() => {
    if (!peekText) return
    const t = setTimeout(() => setPeekText(null), 4500)
    return () => clearTimeout(t)
  }, [peekText])

  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  // ─── Stage-3 submit ──────────────────────────────────────────────
  const submitPrediction = useCallback(
    (guess: Outcome) => {
      setLastPrediction(guess)
      const correct = guess === scenario.correct
      setLastResult(correct ? 'correct' : 'wrong')
      // 1200 ms of visible feedback, then advance the deck.
      setTimeout(() => {
        setLastPrediction(null)
        setLastResult(null)
        setScenarioCursor((c) => c + 1)
        if (correct) {
          setChain((c) => c + 1)
        } else {
          setChain(0)
        }
      }, 1200)
    },
    [scenario],
  )

  // ─── Palette clicks (stages 1+2 → set material, stage 3 → predict) ─
  const onPaletteClickMaterial = useCallback((id: MaterialId) => {
    if (isStage3) return
    setMaterial(id)
  }, [isStage3])

  const onPredictionClick = useCallback((o: Outcome) => {
    if (!isStage3) return
    if (lastResult !== null) return // wait for cooldown
    submitPrediction(o)
  }, [isStage3, lastResult, submitPrediction])

  // ─── HUD text ─────────────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`

  const bright = target2Hit.bright ? '✓' : labels.target_pending
  const dim = target2Hit.dim ? '✓' : labels.target_pending
  const off = target2Hit.off ? '✓' : labels.target_pending
  const hudTR = isStage1
    ? `${sawBright ? '✓' : labels.target_pending} ${labels.lamp_bright}   ${sawOff ? '✓' : labels.target_pending} ${labels.lamp_off}`
    : isStage2
      ? `${labels.targets}  ${bright} ${labels.lamp_bright}  ${dim} ${labels.lamp_dim}  ${off} ${labels.lamp_off}`
      : `${labels.chain} ${chain}/${STAGE3_CHAIN_TARGET}`

  const hudBL = isStage3
    ? (peekText ??
        (lastResult === 'correct'
          ? labels.correct
          : lastResult === 'wrong'
            ? labels.wrong
            : labels.tip3))
    : isStage2
      ? labels.tip2
      : labels.tip1

  // ─── Category bar (visible on stages 1 + 2 only) ──────────────────
  const showLiveReadout = !isStage3

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block', userSelect: 'none' }}
      >
        {/* NO borderRadius on <svg>. NO rx on the bg <rect>. */}
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        {/* Schematic panel */}
        <rect x={32} y={60} width={560} height={358} fill="none" stroke="#12203a" strokeWidth={1} rx={6} />
        <text x={40} y={52} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={11} letterSpacing="0.1em">
          {labels.schematic}
        </text>

        {/* Palette panel */}
        <rect x={608} y={60} width={160} height={358} fill="none" stroke="#12203a" strokeWidth={1} rx={6} />
        <text x={616} y={52} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={11} letterSpacing="0.1em">
          {isStage3 ? labels.predict : labels.palette}
        </text>

        {/* Loop wires (structural — always drawn) */}
        <g>
          {/* Corner dots */}
          {[
            [LOOP_LEFT, LOOP_TOP],
            [LOOP_RIGHT, LOOP_TOP],
            [LOOP_RIGHT, LOOP_BOTTOM],
            [LOOP_LEFT, LOOP_BOTTOM],
          ].map(([x, y], i) => (
            <circle key={`c${i}`} cx={x} cy={y} r={2.5} fill="#3A4863" />
          ))}
          {/* Segments from corner to slot centre */}
          {/* top */}
          <line x1={LOOP_LEFT} y1={LOOP_TOP} x2={SLOT_AMMETER.x - 22} y2={LOOP_TOP} stroke="#3A4863" strokeWidth={2} />
          <line x1={SLOT_AMMETER.x + 22} y1={LOOP_TOP} x2={LOOP_RIGHT} y2={LOOP_TOP} stroke="#3A4863" strokeWidth={2} />
          {/* right */}
          <line x1={LOOP_RIGHT} y1={LOOP_TOP} x2={LOOP_RIGHT} y2={SLOT_SAMPLE.y - 26} stroke="#3A4863" strokeWidth={2} />
          <line x1={LOOP_RIGHT} y1={SLOT_SAMPLE.y + 26} x2={LOOP_RIGHT} y2={LOOP_BOTTOM} stroke="#3A4863" strokeWidth={2} />
          {/* bottom */}
          <line x1={LOOP_LEFT} y1={LOOP_BOTTOM} x2={SLOT_LAMP.x - 20} y2={LOOP_BOTTOM} stroke="#3A4863" strokeWidth={2} />
          <line x1={SLOT_LAMP.x + 20} y1={LOOP_BOTTOM} x2={LOOP_RIGHT} y2={LOOP_BOTTOM} stroke="#3A4863" strokeWidth={2} />
          {/* left */}
          <line x1={LOOP_LEFT} y1={LOOP_TOP} x2={LOOP_LEFT} y2={SLOT_BATTERY.y - 22} stroke="#3A4863" strokeWidth={2} />
          <line x1={LOOP_LEFT} y1={SLOT_BATTERY.y + 22} x2={LOOP_LEFT} y2={LOOP_BOTTOM} stroke="#3A4863" strokeWidth={2} />
        </g>

        {/* Battery (left, vertical: current flows up on the left when + is at top) */}
        <g transform={`translate(${SLOT_BATTERY.x}, ${SLOT_BATTERY.y}) rotate(90)`}>
          <BatterySymbol />
        </g>
        <text
          x={SLOT_BATTERY.x - 34}
          y={SLOT_BATTERY.y + 4}
          fill="#B9C4D6"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={11}
          textAnchor="end"
        >
          {labels.battery}
        </text>

        {/* Ammeter (top, horizontal) */}
        <g transform={`translate(${SLOT_AMMETER.x}, ${SLOT_AMMETER.y})`}>
          <AmmeterSymbol />
          {/* Reading above the meter: hidden on stage 3 (blind) */}
          {showLiveReadout ? (
            <text
              x={0}
              y={-22}
              fill={currentA > 0 ? '#37C9B8' : '#6C7A93'}
              fontFamily="'JetBrains Mono', monospace"
              fontSize={12}
              textAnchor="middle"
            >
              {formatCurrent(currentMA)}
            </text>
          ) : (
            <text
              x={0}
              y={-22}
              fill="#6C7A93"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={12}
              textAnchor="middle"
            >
              ?
            </text>
          )}
        </g>

        {/* Lamp (bottom, horizontal) */}
        <g transform={`translate(${SLOT_LAMP.x}, ${SLOT_LAMP.y})`}>
          <LampSymbol outcome={showLiveReadout ? outcome : null} />
        </g>

        {/* Material slot (right, vertical) */}
        <g transform={`translate(${SLOT_SAMPLE.x}, ${SLOT_SAMPLE.y}) rotate(90)`}>
          {activeSpec ? (
            <SampleSymbol spec={activeSpec} />
          ) : (
            <>
              <rect
                x={-26}
                y={-14}
                width={52}
                height={28}
                fill="none"
                stroke="#3A4863"
                strokeWidth={1.2}
                strokeDasharray="4 4"
                rx={3}
                opacity={0.8}
              />
              {/* Terminal stubs so the loop reads as open, not closed */}
              <line x1={-32} y1={0} x2={-26} y2={0} stroke="#54617A" strokeWidth={2} />
              <line x1={26} y1={0} x2={32} y2={0} stroke="#54617A" strokeWidth={2} />
            </>
          )}
        </g>
        {!activeSpec && (
          <text
            x={SLOT_SAMPLE.x + 32}
            y={SLOT_SAMPLE.y + 4}
            fill="#6C7A93"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={10}
            textAnchor="start"
          >
            {labels.sample_hint}
          </text>
        )}

        {/* Category bar under the loop (stages 1 + 2). Highlights the
            category the current material belongs to. */}
        {showLiveReadout && (
          <g transform={`translate(${LOOP_LEFT + 4}, 322)`}>
            <text
              x={0}
              y={-6}
              fill="#6C7A93"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
              letterSpacing="0.1em"
            >
              {labels.resistivity} · {labels.ohm_meter}
            </text>
            <CategoryBar activeCategory={activeSpec?.category ?? null} labels={labels} />
          </g>
        )}

        {/* Length slider (inside SVG via foreignObject so it letterboxes
            with the scene). Hidden readout on stage 3 (blind); slider
            replaced with a static label showing the seeded length. */}
        <foreignObject x={LOOP_LEFT - 8} y={362} width={LOOP_RIGHT - LOOP_LEFT + 16} height={44}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontFamily: "'JetBrains Mono', monospace",
              color: '#B9C4D6',
              fontSize: 11,
              width: '100%',
              height: '100%',
            }}
          >
            <span style={{ minWidth: 78 }}>{labels.length}</span>
            {!isStage3 ? (
              <>
                <input
                  type="range"
                  min={LENGTH_MIN_CM}
                  max={LENGTH_MAX_CM}
                  step={1}
                  value={lengthCm}
                  onChange={(e) => setLengthCm(Number(e.target.value))}
                  style={{ flex: 1, accentColor: '#F97316' }}
                />
                <span style={{ minWidth: 44, textAlign: 'right' }}>{lengthCm} cm</span>
              </>
            ) : (
              <span style={{ flex: 1, opacity: 0.85 }}>
                ℓ = {activeLengthCm} cm · S = 1 mm²
              </span>
            )}
          </div>
        </foreignObject>

        {/* Palette or prediction cards on the right ------------------- */}
        {!isStage3 && (
          <g>
            {MATERIALS.map((m, i) => {
              const y = 84 + i * 46
              const selected = material === m.id
              return (
                <g
                  key={m.id}
                  transform={`translate(688, ${y})`}
                  style={{ cursor: 'pointer' }}
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    onPaletteClickMaterial(m.id)
                  }}
                >
                  <rect
                    x={-58}
                    y={-18}
                    width={116}
                    height={36}
                    fill={selected ? '#1E2C48' : '#131F35'}
                    stroke={selected ? '#F97316' : '#3A4863'}
                    strokeWidth={selected ? 1.4 : 1}
                    rx={4}
                  />
                  {/* Small material swatch */}
                  <rect
                    x={-50}
                    y={-8}
                    width={16}
                    height={16}
                    fill={m.fill}
                    stroke={m.stroke}
                    strokeWidth={1}
                    rx={2}
                  />
                  <text
                    x={-28}
                    y={-1}
                    fill="#B9C4D6"
                    fontFamily="'JetBrains Mono', monospace"
                    fontSize={10}
                    textAnchor="start"
                  >
                    {labels[m.labelKey] ?? m.id}
                  </text>
                  <text
                    x={-28}
                    y={11}
                    fill="#6C7A93"
                    fontFamily="'JetBrains Mono', monospace"
                    fontSize={9}
                    textAnchor="start"
                  >
                    ρ = {formatRho(m.rho)}
                  </text>
                </g>
              )
            })}
          </g>
        )}

        {isStage3 && (
          <g>
            {(['bright', 'dim', 'off'] as Outcome[]).map((o, i) => {
              const y = 130 + i * 76
              const showLast = lastPrediction === o
              const isCorrectHit = showLast && lastResult === 'correct'
              const isWrongHit = showLast && lastResult === 'wrong'
              const disabled = lastResult !== null && !showLast
              const stroke = isCorrectHit
                ? '#37C9B8'
                : isWrongHit
                  ? '#EF4444'
                  : showLast
                    ? '#F97316'
                    : '#3A4863'
              return (
                <g
                  key={o}
                  transform={`translate(688, ${y})`}
                  style={{ cursor: lastResult !== null ? 'default' : 'pointer', opacity: disabled ? 0.4 : 1 }}
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    onPredictionClick(o)
                  }}
                >
                  <rect
                    x={-58}
                    y={-28}
                    width={116}
                    height={56}
                    fill="#131F35"
                    stroke={stroke}
                    strokeWidth={showLast ? 1.6 : 1}
                    rx={5}
                  />
                  <OutcomeGlyph outcome={o} />
                  <text
                    x={0}
                    y={22}
                    fill="#B9C4D6"
                    fontFamily="'JetBrains Mono', monospace"
                    fontSize={10}
                    letterSpacing="0.08em"
                    textAnchor="middle"
                    style={{ textTransform: 'uppercase' }}
                  >
                    {o === 'bright' ? labels.lamp_bright : o === 'dim' ? labels.lamp_dim : labels.lamp_off}
                  </text>
                </g>
              )
            })}
          </g>
        )}

        {/* Current-flow animation (stages 1 + 2 only, when circuit
            actually conducts). Hidden on stage 3 — would reveal outcome. */}
        {showLiveReadout && outcome && outcome !== 'off' && (
          <g>
            <path
              id="flow-path"
              d={`M ${LOOP_LEFT} ${LOOP_TOP} L ${LOOP_RIGHT} ${LOOP_TOP} L ${LOOP_RIGHT} ${LOOP_BOTTOM} L ${LOOP_LEFT} ${LOOP_BOTTOM} Z`}
              fill="none"
              stroke="none"
            />
            {[0, 0.5, 1.0, 1.5].map((delay) => (
              <circle key={`f${delay}`} r={2.5} fill="#37C9B8">
                <animateMotion
                  dur={outcome === 'bright' ? '2s' : '3.5s'}
                  repeatCount="indefinite"
                  begin={`${delay}s`}
                >
                  <mpath href="#flow-path" />
                </animateMotion>
              </circle>
            ))}
          </g>
        )}

        {/* BR quadrant (x > 600 && y > 350) intentionally empty —
            reserved for parent chrome (§4.3). */}
      </svg>

      {/* HUD overlays — HTML in `rem` (1 rem = 1 vh) */}
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
          fontSize: '1.5rem',
          letterSpacing: '0.08em',
          color: canSubmit ? '#37C9B8' : '#B9C4D6',
          zIndex: 5,
          pointerEvents: 'none',
          textAlign: 'right',
          maxWidth: '54%',
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
          fontSize: '1.8rem',
          letterSpacing: '0.06em',
          color:
            isStage3 && lastResult === 'correct'
              ? '#37C9B8'
              : isStage3 && lastResult === 'wrong'
                ? '#EF4444'
                : '#6C7A93',
          zIndex: 5,
          pointerEvents: 'none',
          maxWidth: '58%',
        }}
      >
        {hudBL}
      </div>
      {/* BR reserved — no overlay. */}
    </div>
  )
}

// ─── Helpers ────────────────────────────────────────────────────────────
function formatCurrent(ma: number): string {
  const v = Math.abs(ma)
  if (v >= 100) return `${ma.toFixed(0)} mA`
  if (v >= 10) return `${ma.toFixed(1)} mA`
  if (v >= 1) return `${ma.toFixed(2)} mA`
  if (v >= 0.01) return `${ma.toFixed(3)} mA`
  return `< 0.01 mA`
}

/** Human-readable ρ in scientific notation for the palette card. */
function formatRho(rho: number): string {
  const exp = Math.floor(Math.log10(rho))
  const mant = rho / Math.pow(10, exp)
  const mantStr = mant.toFixed(1).replace(/\.0$/, '')
  return `${mantStr}·10^${exp}`
}

// ─── Category bar ───────────────────────────────────────────────────────
function CategoryBar({
  activeCategory,
  labels,
}: {
  activeCategory: Category | null
  labels: Record<string, string>
}) {
  const cats: { key: Category; label: string; color: string }[] = [
    { key: 'conductor', label: labels.category_conductor ?? 'conductor', color: '#37C9B8' },
    { key: 'semi', label: labels.category_semi ?? 'semi-conductor', color: '#F9A968' },
    { key: 'insulator', label: labels.category_insulator ?? 'insulator', color: '#7E8B9E' },
  ]
  const segW = 168
  return (
    <g>
      {cats.map((c, i) => {
        const x = i * (segW + 8)
        const active = activeCategory === c.key
        return (
          <g key={c.key} transform={`translate(${x}, 0)`}>
            <rect
              x={0}
              y={0}
              width={segW}
              height={22}
              fill={active ? c.color : '#131F35'}
              stroke={active ? c.color : '#3A4863'}
              strokeWidth={1}
              rx={3}
              opacity={active ? 0.9 : 1}
            />
            <text
              x={segW / 2}
              y={14}
              fill={active ? '#0D1524' : '#6C7A93'}
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
              textAnchor="middle"
              letterSpacing="0.1em"
              fontWeight={active ? 700 : 400}
            >
              {c.label}
            </text>
          </g>
        )
      })}
    </g>
  )
}

// ─── Symbols ────────────────────────────────────────────────────────────
function BatterySymbol() {
  return (
    <g>
      <line x1={-32} y1={0} x2={-4} y2={0} stroke="#54617A" strokeWidth={2} />
      <line x1={4} y1={0} x2={32} y2={0} stroke="#54617A" strokeWidth={2} />
      <line x1={-4} y1={-14} x2={-4} y2={14} stroke="#B9C4D6" strokeWidth={2} />
      <line x1={4} y1={-9} x2={4} y2={9} stroke="#B9C4D6" strokeWidth={5} />
      <text x={-12} y={-18} fill="#F9A968" fontFamily="'JetBrains Mono', monospace" fontSize={10} textAnchor="middle" fontWeight={700}>
        +
      </text>
      <text x={12} y={-18} fill="#7EE3D8" fontFamily="'JetBrains Mono', monospace" fontSize={10} textAnchor="middle" fontWeight={700}>
        −
      </text>
    </g>
  )
}

function AmmeterSymbol() {
  return (
    <g>
      <line x1={-32} y1={0} x2={-14} y2={0} stroke="#54617A" strokeWidth={2} />
      <line x1={14} y1={0} x2={32} y2={0} stroke="#54617A" strokeWidth={2} />
      <circle cx={0} cy={0} r={14} fill="#131F35" stroke="#54617A" strokeWidth={1.4} />
      <text
        x={0}
        y={4}
        fill="#B9C4D6"
        fontFamily="'JetBrains Mono', monospace"
        fontSize={12}
        textAnchor="middle"
        fontWeight={700}
      >
        A
      </text>
    </g>
  )
}

function LampSymbol({ outcome }: { outcome: Outcome | null }) {
  const bright = outcome === 'bright'
  const dim = outcome === 'dim'
  const fill = bright ? '#F9A968' : dim ? '#B45309' : '#131F35'
  const stroke = bright || dim ? '#F9A968' : '#54617A'
  const filamentColor = bright ? '#B45309' : dim ? '#7A3B08' : '#54617A'
  return (
    <g>
      <line x1={-32} y1={0} x2={-14} y2={0} stroke="#54617A" strokeWidth={2} />
      <line x1={14} y1={0} x2={32} y2={0} stroke="#54617A" strokeWidth={2} />
      <circle cx={0} cy={0} r={13} fill={fill} stroke={stroke} strokeWidth={1.4} />
      {bright && (
        <circle cx={0} cy={0} r={22} fill="none" stroke="#F9A968" strokeWidth={1} opacity={0.35}>
          <animate attributeName="r" values="18;24;18" dur="1.5s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.15;0.4;0.15" dur="1.5s" repeatCount="indefinite" />
        </circle>
      )}
      {dim && (
        <circle cx={0} cy={0} r={18} fill="none" stroke="#F9A968" strokeWidth={1} opacity={0.2} />
      )}
      <line x1={-6} y1={-6} x2={6} y2={6} stroke={filamentColor} strokeWidth={1.5} />
      <line x1={-6} y1={6} x2={6} y2={-6} stroke={filamentColor} strokeWidth={1.5} />
    </g>
  )
}

function SampleSymbol({ spec }: { spec: MaterialSpec }) {
  // Electrodes at ±32 (terminal stubs), sample body between ±22.
  return (
    <g>
      <line x1={-32} y1={0} x2={-22} y2={0} stroke="#54617A" strokeWidth={2} />
      <line x1={22} y1={0} x2={32} y2={0} stroke="#54617A" strokeWidth={2} />
      {/* Electrode plates */}
      <line x1={-22} y1={-12} x2={-22} y2={12} stroke="#B9C4D6" strokeWidth={2} />
      <line x1={22} y1={-12} x2={22} y2={12} stroke="#B9C4D6" strokeWidth={2} />
      {/* Sample body */}
      <rect x={-20} y={-10} width={40} height={20} fill={spec.fill} stroke={spec.stroke} strokeWidth={1.2} rx={2} />
    </g>
  )
}

function OutcomeGlyph({ outcome }: { outcome: Outcome }) {
  if (outcome === 'off') {
    return (
      <g transform="translate(0, -4)">
        <circle cx={0} cy={0} r={11} fill="#131F35" stroke="#54617A" strokeWidth={1.4} />
        <line x1={-5} y1={-5} x2={5} y2={5} stroke="#54617A" strokeWidth={1.4} />
        <line x1={-5} y1={5} x2={5} y2={-5} stroke="#54617A" strokeWidth={1.4} />
      </g>
    )
  }
  if (outcome === 'dim') {
    return (
      <g transform="translate(0, -4)">
        <circle cx={0} cy={0} r={11} fill="#B45309" stroke="#F9A968" strokeWidth={1.4} opacity={0.85} />
        <line x1={-5} y1={-5} x2={5} y2={5} stroke="#7A3B08" strokeWidth={1.2} />
        <line x1={-5} y1={5} x2={5} y2={-5} stroke="#7A3B08" strokeWidth={1.2} />
      </g>
    )
  }
  // bright
  return (
    <g transform="translate(0, -4)">
      <circle cx={0} cy={0} r={11} fill="#F9A968" stroke="#F9A968" strokeWidth={1.4} />
      <line x1={-5} y1={-5} x2={5} y2={5} stroke="#B45309" strokeWidth={1.2} />
      <line x1={-5} y1={5} x2={5} y2={-5} stroke="#B45309" strokeWidth={1.2} />
      <circle cx={0} cy={0} r={17} fill="none" stroke="#F9A968" strokeWidth={0.8} opacity={0.5} />
    </g>
  )
}
