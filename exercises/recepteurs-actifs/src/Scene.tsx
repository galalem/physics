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
import { SourceSymbol } from './art/Source'
import { ResistorSymbol } from './art/Resistor'
import { AmmeterSymbol } from './art/Ammeter'
import { VoltmeterSymbol } from './art/Voltmeter'
import { ElectrolyzerSymbol } from './art/Electrolyzer'
import { DCMotorSymbol } from './art/DCMotor'

// ─── Scene constants ────────────────────────────────────────────────────
const W = 800
const H = 450

// Schematic loop rectangle (world coords).
const LOOP_LEFT = 100
const LOOP_RIGHT = 400
const LOOP_TOP = 130
const LOOP_BOTTOM = 330

// Fixed slot centres.
const P_SOURCE = { x: (LOOP_LEFT + LOOP_RIGHT) / 2, y: LOOP_TOP }
const P_AMMETER = { x: LOOP_RIGHT, y: (LOOP_TOP + LOOP_BOTTOM) / 2 }
const P_RECEIVER = { x: (LOOP_LEFT + LOOP_RIGHT) / 2, y: LOOP_BOTTOM }
const P_RESISTOR = { x: LOOP_LEFT, y: (LOOP_TOP + LOOP_BOTTOM) / 2 }
const P_VOLTMETER = { x: (LOOP_LEFT + LOOP_RIGHT) / 2 + 60, y: LOOP_BOTTOM + 60 }

const SLOT_HIT_RADIUS = 60

// Palette layout inside the right panel.
const PALETTE_X = 620
const PALETTE_Y_ELEC = 130
const PALETTE_Y_MOTOR = 230

// Physics constants.
const R_INTERNAL = 0.5   // source internal resistance (Ω)
const E_MIN = 0, E_MAX = 12, E_STEP = 0.1
const R_MIN = 0, R_MAX = 20, R_STEP = 0.1

type ReceiverKind = 'electrolyzer' | 'motor'
type Receiver = { kind: ReceiverKind; Ep: number; rp: number }

const RECEIVERS: Record<ReceiverKind, Receiver> = {
  electrolyzer: { kind: 'electrolyzer', Ep: 1.7, rp: 1.0 },
  motor:        { kind: 'motor',        Ep: 4.5, rp: 2.0 },
}

// ─── Linear DC solver ───────────────────────────────────────────────────
// KVL around a single-loop series circuit with an active receiver:
//   E = r·I + R·I + E' + r'·I  →  I = (E − E') / (r + R + r')
//   U (voltage across receiver) = E' + r'·I
// Test vector: E=8, R=4, electrolyzer(1.7,1)  →  I = 6.3/5.5 = 1.145 A, U = 2.845 V
function solve(E: number, R: number, receiver: Receiver | null): { I: number; U: number; running: boolean } {
  if (!receiver) return { I: 0, U: 0, running: false }
  const drive = E - receiver.Ep
  if (drive <= 0) return { I: 0, U: receiver.Ep, running: false }
  const I = drive / (R_INTERNAL + R + receiver.rp)
  const U = receiver.Ep + receiver.rp * I
  return { I, U, running: true }
}

// ─── Hand-authored target sets (stage 2) ───────────────────────────────
// Two targets per set; each is (receiver, target current in A). ±5% tolerance.
type Target = { receiver: ReceiverKind; I: number }
const TARGET_SETS: Target[][] = [
  [
    { receiver: 'electrolyzer', I: 0.500 }, // e.g. E=6.5, R=6.3 → I≈0.50
    { receiver: 'motor',        I: 0.300 }, // e.g. E=7.0, R=5.8 → I≈0.30
  ],
  [
    { receiver: 'electrolyzer', I: 0.800 }, // e.g. E=8.0, R=6.4 → I≈0.80
    { receiver: 'motor',        I: 0.500 }, // e.g. E=9.0, R=6.5 → I≈0.50
  ],
]

// ─── Hand-authored blind-stage scenarios (stage 3) ─────────────────────
// Each scenario locks E and R and shows a target U across the receiver.
// Only one receiver matches within ±5%.
type Scenario = {
  E: number
  R: number
  correct: ReceiverKind
  targetU: number  // reference U for the correct receiver
}
const SCENARIOS: Scenario[] = [
  { E: 8.0,  R: 4.0, correct: 'electrolyzer', targetU: 2.85 },  // motor would give U≈5.58
  { E: 10.0, R: 6.0, correct: 'motor',        targetU: 5.79 },  // electrolyzer U≈2.81
  { E: 6.0,  R: 2.0, correct: 'motor',        targetU: 5.17 },  // electrolyzer U≈2.93
]

const TOL = 0.05 // ±5%

function within(a: number, b: number): boolean {
  if (b === 0) return Math.abs(a) < 0.001
  return Math.abs(a - b) / Math.abs(b) < TOL
}

// ─── i18n label loader ─────────────────────────────────────────────────
const dict = { en } as const
type Locale = keyof typeof dict
function svgLabels(locale: string): Record<string, string> {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── Component glyph dispatcher ─────────────────────────────────────────
function ReceiverGlyph({ kind, active }: { kind: ReceiverKind; active: boolean }) {
  return kind === 'electrolyzer'
    ? <ElectrolyzerSymbol active={active} />
    : <DCMotorSymbol active={active} />
}

// ─── Scene ──────────────────────────────────────────────────────────────
export default function Scene() {
  const { locale, seed } = useInit()
  const stages = useMemo(() => getStagesFor(locale), [locale])
  useDeclareStages(stages)
  const labels = useMemo(() => svgLabels(locale), [locale])

  const stageIdx = useCurrentStage()
  const setStage = useSetStage()
  const complete = useComplete()
  const progress = useProgress()

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  // ─── Slider + placement state ────────────────────────────────────────
  const [E, setE] = useState(4.0)
  const [R, setR] = useState(4.0)
  const [receiver, setReceiver] = useState<ReceiverKind | null>(null)

  // ─── Stage-1 coverage ───────────────────────────────────────────────
  const [sawElecRan, setSawElecRan] = useState(false)
  const [sawMotorRan, setSawMotorRan] = useState(false)

  // ─── Stage-2 targets ────────────────────────────────────────────────
  const targetSetIdx = useMemo(() => seed % TARGET_SETS.length, [seed])
  const targets = TARGET_SETS[targetSetIdx]!
  const [targetsHit, setTargetsHit] = useState<boolean[]>(() => targets.map(() => false))

  // ─── Stage-3 blind ──────────────────────────────────────────────────
  const [scenarioIdx, setScenarioIdx] = useState<number>(() => seed % SCENARIOS.length)
  const scenario = SCENARIOS[scenarioIdx]!
  const [stage3Submitted, setStage3Submitted] = useState(false)
  const [stage3Correct, setStage3Correct] = useState<boolean | null>(null)

  // ─── Live solve (readings used by stages 1+2; hidden pre-submit on 3) ─
  const receiverObj = receiver ? RECEIVERS[receiver] : null
  const { I, U, running } = solve(E, R, receiverObj)

  // ─── Stage-1 coverage: witness each receiver running under load ─────
  useEffect(() => {
    if (!isStage1) return
    if (running && receiver === 'electrolyzer' && I > 0.05 && !sawElecRan) setSawElecRan(true)
    if (running && receiver === 'motor' && I > 0.05 && !sawMotorRan) setSawMotorRan(true)
  }, [isStage1, running, receiver, I, sawElecRan, sawMotorRan])

  // ─── Stage-2 targets: mark each hit when receiver matches and I matches ─
  useEffect(() => {
    if (!isStage2 || !receiver) return
    setTargetsHit((prev) => {
      let changed = false
      const next = prev.slice()
      for (let i = 0; i < targets.length; i++) {
        if (next[i]) continue
        const t = targets[i]!
        if (t.receiver === receiver && running && within(I, t.I)) {
          next[i] = true
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [isStage2, receiver, running, I, targets])

  // ─── Stage-3 init: lock sliders to scenario, clear slot ─────────────
  useEffect(() => {
    if (!isStage3) return
    setE(scenario.E)
    setR(scenario.R)
    // The empty-slot state is triggered when receiver is null. Do not overwrite
    // a receiver the student has just placed here.
  }, [isStage3, scenario.E, scenario.R])

  // ─── Advance predicates ─────────────────────────────────────────────
  const stage1Done = sawElecRan && sawMotorRan
  const stage2Done = targetsHit.every(Boolean)
  const stage3Done = stage3Correct === true

  const canSubmit = isStage1 ? stage1Done : isStage2 ? stage2Done : stage3Done

  // ─── Reset ──────────────────────────────────────────────────────────
  const resetStageState = useCallback(() => {
    setE(4.0)
    setR(4.0)
    setReceiver(null)
    setSawElecRan(false)
    setSawMotorRan(false)
    setTargetsHit(targets.map(() => false))
    setStage3Submitted(false)
    setStage3Correct(null)
    setPeekText(null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targets])
  useReset(resetStageState)

  useEffect(() => {
    progress(stageIdx / stages.length, { stage: stageIdx, canSubmit })
  }, [stageIdx, canSubmit, stages.length, progress])

  useNext(() => {
    if (stageIdx < stages.length) {
      setStage(stageIdx + 1)
      resetStageState()
    } else {
      complete({ success: true })
    }
  })

  // ─── Peek (strategy hint only — no answer reveal, no ghost) ─────────
  const [peekText, setPeekText] = useState<string | null>(null)
  usePeek(() => {
    if (!isStage3) return
    setPeekText(labels.peek_tip ?? '')
  })
  useEffect(() => {
    if (!peekText) return
    const t = setTimeout(() => setPeekText(null), 5000)
    return () => clearTimeout(t)
  }, [peekText])

  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  // ─── Drag machinery for the single receiver slot ────────────────────
  type Dragging = { kind: ReceiverKind; x: number; y: number; fromSlot: boolean }
  const [dragging, setDragging] = useState<Dragging | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  const clientToSvg = (svg: SVGSVGElement, clientX: number, clientY: number) => {
    const rect = svg.getBoundingClientRect()
    const scale = 1 / Math.min(rect.width / W, rect.height / H)
    const drawW = W / scale
    const drawH = H / scale
    const offX = (rect.width - drawW) / 2
    const offY = (rect.height - drawH) / 2
    return { x: (clientX - rect.left - offX) * scale, y: (clientY - rect.top - offY) * scale }
  }

  const onPointerDownPalette = useCallback((kind: ReceiverKind, e: React.PointerEvent<SVGElement>) => {
    e.stopPropagation()
    // Stage 3: if already submitted with the correct pick, freeze interaction.
    if (isStage3 && stage3Submitted && stage3Correct === true) return
    const svg = e.currentTarget.ownerSVGElement
    if (!svg) return
    ;(e.currentTarget as SVGElement).setPointerCapture(e.pointerId)
    const pos = clientToSvg(svg, e.clientX, e.clientY)
    setDragging({ kind, fromSlot: false, x: pos.x, y: pos.y })
  }, [isStage3, stage3Submitted, stage3Correct])

  const onPointerDownSlot = useCallback((e: React.PointerEvent<SVGElement>) => {
    e.stopPropagation()
    if (!receiver) return
    // Stage 3: after a submitted correct pick, prevent lifting the receiver back out.
    if (isStage3 && stage3Submitted) return
    ;(e.currentTarget as SVGElement).setPointerCapture(e.pointerId)
    const svg = e.currentTarget.ownerSVGElement
    if (!svg) return
    const pos = clientToSvg(svg, e.clientX, e.clientY)
    setDragging({ kind: receiver, fromSlot: true, x: pos.x, y: pos.y })
    setReceiver(null)
  }, [receiver, isStage3, stage3Submitted])

  const onPointerMove = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (!dragging) return
    const pos = clientToSvg(e.currentTarget, e.clientX, e.clientY)
    setDragging((prev) => (prev ? { ...prev, x: pos.x, y: pos.y } : null))
  }, [dragging])

  const submitStage3 = useCallback((placed: ReceiverKind) => {
    const isCorrect = placed === scenario.correct
    setStage3Submitted(true)
    setStage3Correct(isCorrect)
    if (!isCorrect) {
      // Rotate to next scenario after brief pause; clear the wrong placement.
      window.setTimeout(() => {
        setScenarioIdx((n) => (n + 1) % SCENARIOS.length)
        setReceiver(null)
        setStage3Submitted(false)
        setStage3Correct(null)
      }, 1600)
    }
  }, [scenario.correct])

  const onPointerUp = useCallback((_e: React.PointerEvent<SVGSVGElement>) => {
    if (!dragging) return
    const d = Math.hypot(dragging.x - P_RECEIVER.x, dragging.y - P_RECEIVER.y)
    if (d < SLOT_HIT_RADIUS) {
      setReceiver(dragging.kind)
      if (isStage3 && !stage3Submitted) {
        // Queue submit after slot state commits.
        const placed = dragging.kind
        window.setTimeout(() => submitStage3(placed), 0)
      }
    }
    // Dropped elsewhere: slot stays empty (already cleared on lift).
    setDragging(null)
  }, [dragging, isStage3, stage3Submitted, submitStage3])

  // ─── Palette items visible per stage ────────────────────────────────
  // Stage 3 restricted palette = correct + 1 decoy. With only two receiver
  // types in this exercise, that is exactly the full set of two — but the
  // student must still choose based on understanding (not by elimination).
  const paletteKinds: ReceiverKind[] = ['electrolyzer', 'motor']

  // ─── HUD text ───────────────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`

  const hudTR = isStage1
    ? `${sawElecRan ? '✓' : '·'} ${labels.seen_electrolyzer}   ${sawMotorRan ? '✓' : '·'} ${labels.seen_motor}`
    : isStage2
      ? `${labels.targets}: ${targetsHit.filter(Boolean).length}/${targets.length}`
      : stage3Submitted
        ? (stage3Correct ? labels.correct : labels.wrong)
        : labels.place_receiver

  const hudBL = isStage3
    ? (peekText ?? labels.tip3)
    : isStage1 ? labels.tip1
    : labels.tip2

  // ─── Stage 2 target lines (rendered as SVG chips inside the right panel) ─
  const targetChip = (t: Target, i: number, hit: boolean) => {
    const y = 300 + i * 22
    return (
      <g key={`t${i}`} transform={`translate(${498}, ${y})`}>
        <rect x={0} y={-10} width={250} height={20} fill={hit ? '#0F2A28' : '#131F35'} stroke={hit ? '#37C9B8' : '#3A4863'} strokeWidth={1} rx={4} />
        <text x={10} y={4} fill={hit ? '#37C9B8' : '#B9C4D6'} fontFamily="'JetBrains Mono', monospace" fontSize={10}>
          {hit ? '✓' : '·'} {labels[`comp_${t.receiver}`] ?? t.receiver}: I = {(t.I * 1000).toFixed(0)} mA
        </text>
      </g>
    )
  }

  // ─── Render ─────────────────────────────────────────────────────────
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block', userSelect: 'none', touchAction: 'none' }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {/* Full-canvas background. NO rx, NO borderRadius on <svg>. */}
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        {/* Schematic panel */}
        <rect x={32} y={60} width={430} height={358} fill="none" stroke="#12203a" strokeWidth={1} rx={6} />
        <text x={40} y={52} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={11} letterSpacing="0.1em">
          {labels.schematic}
        </text>

        {/* Right panel (palette + targets) */}
        <rect x={478} y={60} width={290} height={358} fill="none" stroke="#12203a" strokeWidth={1} rx={6} />
        <text x={486} y={52} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={11} letterSpacing="0.1em">
          {labels.palette}
        </text>

        {/* Loop wires — structural, always drawn as stubs between corners and slots */}
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
          {/* Top row: corner → source(−) and source(+) → corner */}
          <line x1={LOOP_LEFT} y1={LOOP_TOP} x2={P_SOURCE.x - 32} y2={LOOP_TOP} stroke="#3A4863" strokeWidth={2} />
          <line x1={P_SOURCE.x + 32} y1={LOOP_TOP} x2={LOOP_RIGHT} y2={LOOP_TOP} stroke="#3A4863" strokeWidth={2} />
          {/* Right column: corner → ammeter and ammeter → corner */}
          <line x1={LOOP_RIGHT} y1={LOOP_TOP} x2={LOOP_RIGHT} y2={P_AMMETER.y - 32} stroke="#3A4863" strokeWidth={2} />
          <line x1={LOOP_RIGHT} y1={P_AMMETER.y + 32} x2={LOOP_RIGHT} y2={LOOP_BOTTOM} stroke="#3A4863" strokeWidth={2} />
          {/* Bottom row: corner → receiver and receiver → corner */}
          <line x1={LOOP_LEFT} y1={LOOP_BOTTOM} x2={P_RECEIVER.x - 32} y2={LOOP_BOTTOM} stroke="#3A4863" strokeWidth={2} />
          <line x1={P_RECEIVER.x + 32} y1={LOOP_BOTTOM} x2={LOOP_RIGHT} y2={LOOP_BOTTOM} stroke="#3A4863" strokeWidth={2} />
          {/* Left column: corner → resistor and resistor → corner */}
          <line x1={LOOP_LEFT} y1={LOOP_TOP} x2={LOOP_LEFT} y2={P_RESISTOR.y - 32} stroke="#3A4863" strokeWidth={2} />
          <line x1={LOOP_LEFT} y1={P_RESISTOR.y + 32} x2={LOOP_LEFT} y2={LOOP_BOTTOM} stroke="#3A4863" strokeWidth={2} />
        </g>

        {/* Source (top slot) — fixed. Labeled with current E value on stages 1+2. */}
        <g transform={`translate(${P_SOURCE.x}, ${P_SOURCE.y})`}>
          <SourceSymbol />
          <text x={0} y={26} fill="#B9C4D6" fontFamily="'JetBrains Mono', monospace" fontSize={10} textAnchor="middle">
            E = {E.toFixed(1)} V
          </text>
          <text x={0} y={38} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={8} textAnchor="middle">
            {labels.generator_r}
          </text>
        </g>

        {/* External resistor (left slot) — fixed. Rotated vertical. */}
        <g transform={`translate(${P_RESISTOR.x}, ${P_RESISTOR.y}) rotate(90)`}>
          <ResistorSymbol />
        </g>
        <text
          x={P_RESISTOR.x - 28} y={P_RESISTOR.y + 4}
          fill="#B9C4D6" fontFamily="'JetBrains Mono', monospace" fontSize={10} textAnchor="end"
        >
          R = {R.toFixed(1)} Ω
        </text>

        {/* Ammeter (right slot) — fixed. Reading hidden on stage 3 pre-submit. */}
        <g transform={`translate(${P_AMMETER.x}, ${P_AMMETER.y}) rotate(90)`}>
          <AmmeterSymbol
            reading={I}
            showReading={!isStage3 || (stage3Submitted && stage3Correct === true)}
          />
        </g>

        {/* Voltmeter (floating, parallel to receiver). Dashed leads to receiver terminals. */}
        <g>
          <line
            x1={P_RECEIVER.x - 32} y1={P_RECEIVER.y}
            x2={P_VOLTMETER.x - 13} y2={P_VOLTMETER.y}
            stroke="#3A4863" strokeWidth={1} strokeDasharray="3 3"
          />
          <line
            x1={P_RECEIVER.x + 32} y1={P_RECEIVER.y}
            x2={P_VOLTMETER.x + 13} y2={P_VOLTMETER.y}
            stroke="#3A4863" strokeWidth={1} strokeDasharray="3 3"
          />
          <g transform={`translate(${P_VOLTMETER.x}, ${P_VOLTMETER.y})`}>
            <VoltmeterSymbol
              reading={U}
              showReading={!isStage3 || (stage3Submitted && stage3Correct === true)}
            />
          </g>
        </g>

        {/* Receiver slot (bottom): empty → dashed rect; filled → glyph */}
        <g>
          {receiver === null && (
            <rect
              x={P_RECEIVER.x - 30} y={P_RECEIVER.y - 18}
              width={60} height={36}
              fill="none"
              stroke={dragging ? '#F97316' : '#3A4863'}
              strokeWidth={1.2}
              strokeDasharray="4 4"
              rx={4}
              opacity={0.85}
            />
          )}
          {receiver !== null && (
            <g
              onPointerDown={onPointerDownSlot}
              style={{ cursor: isStage3 && stage3Submitted ? 'default' : 'grab' }}
            >
              <rect x={P_RECEIVER.x - 34} y={P_RECEIVER.y - 20} width={68} height={40} fill="transparent" />
              <g transform={`translate(${P_RECEIVER.x}, ${P_RECEIVER.y})`}>
                <ReceiverGlyph kind={receiver} active={running && !isStage3} />
              </g>
            </g>
          )}
          {/* Stage-3 wrong flash */}
          {isStage3 && stage3Submitted && stage3Correct === false && (
            <circle cx={P_RECEIVER.x} cy={P_RECEIVER.y} r={28} fill="none" stroke="#EF4444" strokeWidth={2} opacity={0.85} />
          )}
          {/* Stage-3 correct flash */}
          {isStage3 && stage3Submitted && stage3Correct === true && (
            <circle cx={P_RECEIVER.x} cy={P_RECEIVER.y} r={28} fill="none" stroke="#37C9B8" strokeWidth={2} opacity={0.9} />
          )}
        </g>

        {/* Current-flow animation (stages 1+2 only — hidden on stage 3 pre-submit per §4.7) */}
        {running && !isStage3 && (
          <g>
            <path
              id="flow-path"
              d={`M ${LOOP_LEFT} ${LOOP_TOP} L ${LOOP_RIGHT} ${LOOP_TOP} L ${LOOP_RIGHT} ${LOOP_BOTTOM} L ${LOOP_LEFT} ${LOOP_BOTTOM} Z`}
              fill="none" stroke="none"
            />
            {[0, 0.5, 1.0, 1.5].map((delay) => (
              <circle key={`f${delay}`} r={2.5} fill="#37C9B8">
                <animateMotion dur="2s" repeatCount="indefinite" begin={`${delay}s`}>
                  <mpath href="#flow-path" />
                </animateMotion>
              </circle>
            ))}
          </g>
        )}

        {/* Palette cards (right panel) */}
        {paletteKinds.map((kind) => {
          const y = kind === 'electrolyzer' ? PALETTE_Y_ELEC : PALETTE_Y_MOTOR
          const specKey = kind === 'electrolyzer' ? 'elec_specs' : 'motor_specs'
          return (
            <g
              key={kind}
              transform={`translate(${PALETTE_X}, ${y})`}
              style={{ cursor: 'grab' }}
              onPointerDown={(e) => onPointerDownPalette(kind, e)}
            >
              <rect x={-70} y={-38} width={140} height={76} fill="#131F35" stroke="#3A4863" strokeWidth={1} rx={4} />
              <g>
                <ReceiverGlyph kind={kind} active={false} />
              </g>
              <text x={0} y={22} fill="#B9C4D6" fontFamily="'JetBrains Mono', monospace" fontSize={10} textAnchor="middle">
                {labels[`comp_${kind}`] ?? kind}
              </text>
              <text x={0} y={33} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={8} textAnchor="middle">
                {labels[specKey]}
              </text>
            </g>
          )
        })}

        {/* Stage-2 target chips (SVG, inside right panel) */}
        {isStage2 && targets.map((t, i) => targetChip(t, i, targetsHit[i] ?? false))}

        {/* Stage-3 "given" chip: E, R, target U */}
        {isStage3 && (
          <g>
            <rect x={498} y={300} width={250} height={44} fill="#131F35" stroke="#3A4863" strokeWidth={1} rx={4} />
            <text x={508} y={314} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={9} letterSpacing="0.1em">
              {labels.given}
            </text>
            <text x={508} y={330} fill="#B9C4D6" fontFamily="'JetBrains Mono', monospace" fontSize={10}>
              E = {scenario.E.toFixed(1)} V   R = {scenario.R.toFixed(1)} Ω
            </text>
            <text x={508} y={342} fill="#F9A968" fontFamily="'JetBrains Mono', monospace" fontSize={10}>
              {labels.target_U} = {scenario.targetU.toFixed(2)} V
            </text>
          </g>
        )}

        {/* Receiver-off notice (stages 1+2 when E ≤ E') */}
        {!isStage3 && receiver !== null && !running && (
          <text x={P_RECEIVER.x} y={P_RECEIVER.y + 46} fill="#F9A968" fontFamily="'JetBrains Mono', monospace" fontSize={9} textAnchor="middle">
            {labels.receiver_off}
          </text>
        )}

        {/* Drag ghost */}
        {dragging && (
          <g transform={`translate(${dragging.x}, ${dragging.y})`} opacity={0.75} pointerEvents="none">
            <ReceiverGlyph kind={dragging.kind} active={false} />
          </g>
        )}

        {/* BR quadrant (x > 600, y > 350) intentionally left empty — reserved for parent chrome. */}
      </svg>

      {/* HUD TL */}
      <div style={{
        position: 'absolute', top: '3rem', left: '3rem',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '2.3rem', letterSpacing: '0.14em', textTransform: 'uppercase',
        color: '#6C7A93', zIndex: 5, pointerEvents: 'none',
      }}>{hudTL}</div>

      {/* HUD TR */}
      <div style={{
        position: 'absolute', top: '3rem', right: '3rem',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '1.5rem', letterSpacing: '0.08em',
        color: canSubmit ? '#37C9B8' : '#B9C4D6',
        zIndex: 5, pointerEvents: 'none', textAlign: 'right', maxWidth: '38%',
      }}>{hudTR}</div>

      {/* HUD BL — tip / peek / diagnostic */}
      <div style={{
        position: 'absolute', bottom: '3rem', left: '3rem',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '1.7rem', letterSpacing: '0.05em',
        color: peekText ? '#F9A968' : '#6C7A93',
        zIndex: 5, pointerEvents: 'none', maxWidth: '58%',
      }}>{hudBL}</div>

      {/* BR quadrant reserved. No overlay here. */}

      {/* Slider overlays (interactive) — mid-right, above the reserved BR corner. */}
      <div style={{
        position: 'absolute',
        top: '55%', right: '3%',
        width: '30%',
        display: 'flex', flexDirection: 'column', gap: '0.6rem',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '1.4rem',
        color: '#B9C4D6',
        zIndex: 6,
      }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
          <span style={{ color: '#6C7A93', letterSpacing: '0.08em' }}>
            {labels.slider_E} = {E.toFixed(1)} {labels.unit_V}
          </span>
          <input
            type="range"
            min={E_MIN} max={E_MAX} step={E_STEP} value={E}
            onChange={(e) => setE(parseFloat(e.target.value))}
            disabled={isStage3}
            style={{ width: '100%', accentColor: '#37C9B8' }}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
          <span style={{ color: '#6C7A93', letterSpacing: '0.08em' }}>
            {labels.slider_R} = {R.toFixed(1)} {labels.unit_ohm}
          </span>
          <input
            type="range"
            min={R_MIN} max={R_MAX} step={R_STEP} value={R}
            onChange={(e) => setR(parseFloat(e.target.value))}
            disabled={isStage3}
            style={{ width: '100%', accentColor: '#37C9B8' }}
          />
        </label>
      </div>
    </div>
  )
}
