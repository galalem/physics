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
import { BatterySymbol } from './art/Battery'
import { SwitchSymbol } from './art/Switch'
import { AmmeterSymbol } from './art/Ammeter'
import { VoltmeterSymbol } from './art/Voltmeter'
import { ResistorSymbol } from './art/Resistor'
import { CapacitorSymbol } from './art/Capacitor'
import { CoilSymbol } from './art/Coil'

// ─── Scene constants ────────────────────────────────────────────────────
const W = 800
const H = 450

// Fixed circuit constants (sliders deferred — see report).
const E_VOLTS = 6
const R_OHM_INTERNAL = 2
const R_RESISTOR = 100

// Loop geometry — single rectangular loop with fixed schematic + one receiver slot.
const LOOP_LEFT = 170
const LOOP_RIGHT = 510
const LOOP_TOP = 140
const LOOP_BOTTOM = 340

const BATTERY_POS = { x: LOOP_LEFT, y: (LOOP_TOP + LOOP_BOTTOM) / 2 }
const SWITCH_POS = { x: (LOOP_LEFT + LOOP_RIGHT) / 2, y: LOOP_TOP }
const AMMETER_POS = { x: LOOP_RIGHT, y: (LOOP_TOP + LOOP_BOTTOM) / 2 }
const RECEIVER_POS = { x: (LOOP_LEFT + LOOP_RIGHT) / 2, y: LOOP_BOTTOM }
const VOLTMETER_POS = { x: RECEIVER_POS.x, y: RECEIVER_POS.y + 40 }

const SLOT_HIT_RADIUS = 55

type Receiver = 'resistor' | 'capacitor' | 'coil'
type Slot = Receiver | null

const dict = { en } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── Solver — pure DC steady-state ──────────────────────────────────────
// Test vectors:
//   resistor: E=6, r=2, R=100 → I = 6/(2+100) ≈ 0.0588 A, U_R = 100·I ≈ 5.88 V
//   capacitor (steady state): I = 0, U_C = E = 6 V
//   ideal coil (steady state): U_L = 0, I = E/r = 6/2 = 3 A
type CircuitState = { slot: Slot; switchClosed: boolean }
type Readings = { I: number; U: number; complete: boolean }
function solve(c: CircuitState): Readings {
  if (c.slot === null || !c.switchClosed) return { I: 0, U: 0, complete: false }
  if (c.slot === 'resistor') {
    const I = E_VOLTS / (R_OHM_INTERNAL + R_RESISTOR)
    return { I, U: R_RESISTOR * I, complete: true }
  }
  if (c.slot === 'capacitor') return { I: 0, U: E_VOLTS, complete: true }
  // coil
  const I = E_VOLTS / R_OHM_INTERNAL
  return { I, U: 0, complete: true }
}

function fmtI(I: number): string {
  if (Math.abs(I) < 1) return `${(I * 1000).toFixed(0)} mA`
  return `${I.toFixed(2)} A`
}
function fmtU(U: number): string {
  return `${U.toFixed(2)} V`
}

// ─── Stage-3 hand-authored scenarios (seed-picked) ──────────────────────
type Scenario = { answer: Receiver; Iamps: number; Uvolts: number }
const SCENARIOS: Scenario[] = [
  { answer: 'capacitor', Iamps: 0, Uvolts: 6.0 },
  { answer: 'coil', Iamps: 3.0, Uvolts: 0.0 },
  { answer: 'resistor', Iamps: 0.1, Uvolts: 5.8 },
]

// ─── Component ──────────────────────────────────────────────────────────
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

  const [slot, setSlot] = useState<Slot>(null)
  const [switchClosed, setSwitchClosed] = useState(false)

  // Stage-1 coverage: student must observe each of the 3 receivers with switch closed.
  const [sawResistor, setSawResistor] = useState(false)
  const [sawCapacitor, setSawCapacitor] = useState(false)
  const [sawCoil, setSawCoil] = useState(false)

  // Stage-2 targets: hit I=0 AND U=0 (each achievable with a different receiver).
  const [hitI0, setHitI0] = useState(false)
  const [hitU0, setHitU0] = useState(false)

  // Stage-3 blind state.
  const [scenarioIdx, setScenarioIdx] = useState<number>(seed % SCENARIOS.length)
  const [stage3Submitted, setStage3Submitted] = useState(false)
  const [stage3Correct, setStage3Correct] = useState<boolean | null>(null)
  const [peekText, setPeekText] = useState<string | null>(null)

  const scenario = SCENARIOS[scenarioIdx]!

  const readings = useMemo(() => solve({ slot, switchClosed }), [slot, switchClosed])

  // ── Stage-1 coverage tracking ─────────────────────────────────
  useEffect(() => {
    if (!isStage1 || !switchClosed) return
    if (slot === 'resistor' && !sawResistor) setSawResistor(true)
    if (slot === 'capacitor' && !sawCapacitor) setSawCapacitor(true)
    if (slot === 'coil' && !sawCoil) setSawCoil(true)
  }, [isStage1, slot, switchClosed, sawResistor, sawCapacitor, sawCoil])

  // ── Stage-2 target tracking ───────────────────────────────────
  useEffect(() => {
    if (!isStage2 || !switchClosed || slot === null) return
    if (readings.I === 0 && !hitI0) setHitI0(true)
    if (readings.U === 0 && !hitU0) setHitU0(true)
  }, [isStage2, switchClosed, slot, readings, hitI0, hitU0])

  // ── Stage-3: pre-close the switch when entering (schematic is fixed) ──
  useEffect(() => {
    if (isStage3 && !switchClosed) setSwitchClosed(true)
  }, [isStage3, switchClosed])

  const stage1Done = sawResistor && sawCapacitor && sawCoil
  const stage2Done = hitI0 && hitU0
  const stage3Done = stage3Correct === true
  const canSubmit = isStage1 ? stage1Done : isStage2 ? stage2Done : stage3Done

  const resetStageState = useCallback(() => {
    setSlot(null)
    setSwitchClosed(false)
    setSawResistor(false)
    setSawCapacitor(false)
    setSawCoil(false)
    setHitI0(false)
    setHitU0(false)
    setStage3Submitted(false)
    setStage3Correct(null)
    setPeekText(null)
  }, [])
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

  // ── Peek: text strategy hint only, no ghost reveal (§4.7 rule 4) ──
  usePeek(() => {
    if (!isStage3) return
    setPeekText(labels.peek_tip)
  })
  useEffect(() => {
    if (!peekText) return
    const t = setTimeout(() => setPeekText(null), 4500)
    return () => clearTimeout(t)
  }, [peekText])

  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  // ── Drag machinery ────────────────────────────────────────────────
  const svgRef = useRef<SVGSVGElement>(null)
  const [dragging, setDragging] = useState<
    { comp: Receiver; fromSlot: boolean; x: number; y: number } | null
  >(null)

  const clientToSvg = (svg: SVGSVGElement, clientX: number, clientY: number) => {
    const rect = svg.getBoundingClientRect()
    const scale = 1 / Math.min(rect.width / W, rect.height / H)
    const drawW = W / scale
    const drawH = H / scale
    const offX = (rect.width - drawW) / 2
    const offY = (rect.height - drawH) / 2
    return { x: (clientX - rect.left - offX) * scale, y: (clientY - rect.top - offY) * scale }
  }

  const onPointerDownPalette = useCallback((kind: Receiver, e: React.PointerEvent<SVGElement>) => {
    e.stopPropagation()
    const svg = e.currentTarget.ownerSVGElement
    if (!svg) return
    ;(e.currentTarget as SVGElement).setPointerCapture(e.pointerId)
    const pos = clientToSvg(svg, e.clientX, e.clientY)
    setDragging({ comp: kind, fromSlot: false, x: pos.x, y: pos.y })
  }, [])

  const onPointerDownSlot = useCallback((e: React.PointerEvent<SVGElement>) => {
    if (isStage3) return
    if (slot === null) return
    e.stopPropagation()
    const svg = e.currentTarget.ownerSVGElement
    if (!svg) return
    ;(e.currentTarget as SVGElement).setPointerCapture(e.pointerId)
    const pos = clientToSvg(svg, e.clientX, e.clientY)
    setDragging({ comp: slot, fromSlot: true, x: pos.x, y: pos.y })
    setSlot(null)
  }, [slot, isStage3])

  const onPointerMove = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (!dragging) return
    const pos = clientToSvg(e.currentTarget, e.clientX, e.clientY)
    setDragging((prev) => (prev ? { ...prev, x: pos.x, y: pos.y } : null))
  }, [dragging])

  const commitStage3 = useCallback((placed: Receiver) => {
    const correct = placed === scenario.answer
    setStage3Submitted(true)
    setStage3Correct(correct)
    if (!correct) {
      // Rotate to next scenario after brief cost signal (§4.7 rule 1: wrong = meaningful cost).
      setTimeout(() => {
        setScenarioIdx((i) => (i + 1) % SCENARIOS.length)
        setSlot(null)
        setStage3Submitted(false)
        setStage3Correct(null)
      }, 1400)
    }
  }, [scenario.answer])

  const onPointerUp = useCallback(() => {
    if (!dragging) return
    const d = dragging
    setDragging(null)
    const dist = Math.hypot(d.x - RECEIVER_POS.x, d.y - RECEIVER_POS.y)
    if (dist <= SLOT_HIT_RADIUS) {
      setSlot(d.comp)
      if (isStage3 && !stage3Submitted) {
        // Microtask so state settles before commit reads the placement.
        setTimeout(() => commitStage3(d.comp), 0)
      }
    }
    // else: dropped off-slot → discarded.
  }, [dragging, isStage3, stage3Submitted, commitStage3])

  const onSwitchClick = useCallback(() => {
    if (isStage3) return
    setSwitchClosed((prev) => !prev)
  }, [isStage3])

  // ── Palette ────────────────────────────────────────────────────
  const paletteItems: Receiver[] = ['resistor', 'capacitor', 'coil']
  const paletteX = 688
  const paletteYStart = 108
  const paletteStep = 78

  // ── HUD text ──────────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`
  const hudTR = isStage1
    ? `${sawResistor ? '✓' : '·'} R  ${sawCapacitor ? '✓' : '·'} C  ${sawCoil ? '✓' : '·'} L`
    : isStage2
      ? `${hitI0 ? '✓' : '·'} ${labels.target_i0}   ${hitU0 ? '✓' : '·'} ${labels.target_u0}`
      : stage3Submitted
        ? (stage3Correct ? labels.correct : labels.wrong)
        : labels.place_receiver
  const hudBL = isStage3
    ? (peekText ?? labels.tip3)
    : isStage1
      ? labels.tip1
      : labels.tip2

  // Diagnostic strip below tip (stages 1+2 only — §4.7 hides live feedback on 3).
  let diagText = ''
  if (!isStage3) {
    if (slot === null) diagText = labels.diag_empty
    else if (!switchClosed) diagText = labels.diag_switch_open
    else if (slot === 'resistor') diagText = labels.diag_ok_resistor
    else if (slot === 'capacitor') diagText = labels.diag_ok_capacitor
    else diagText = labels.diag_ok_coil
  }

  // Meter reading strings.
  const showLive = !isStage3
  const iText = showLive
    ? (switchClosed && slot ? fmtI(readings.I) : '—')
    : fmtI(scenario.Iamps)
  const uText = showLive
    ? (switchClosed && slot ? fmtU(readings.U) : '—')
    : fmtU(scenario.Uvolts)

  // Current-flow animation gated off on stage 3 (§4.7: no live outcome).
  const showFlow = !isStage3 && readings.complete && readings.I > 0

  const receiverGlyph = (r: Receiver) => (
    r === 'resistor' ? <ResistorSymbol /> :
    r === 'capacitor' ? <CapacitorSymbol /> :
    <CoilSymbol />
  )

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
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        {/* Schematic panel */}
        <rect x={32} y={60} width={560} height={358} fill="none" stroke="#12203a" strokeWidth={1} rx={6} />
        <text x={40} y={52} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={11} letterSpacing="0.1em">
          {labels.schematic}
        </text>

        {/* Palette panel */}
        <rect x={608} y={60} width={160} height={358} fill="none" stroke="#12203a" strokeWidth={1} rx={6} />
        <text x={616} y={52} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={11} letterSpacing="0.1em">
          {labels.palette}
        </text>

        {/* Structural loop wires */}
        <g>
          {[[LOOP_LEFT, LOOP_TOP], [LOOP_RIGHT, LOOP_TOP], [LOOP_RIGHT, LOOP_BOTTOM], [LOOP_LEFT, LOOP_BOTTOM]].map(
            ([x, y], i) => <circle key={`c${i}`} cx={x} cy={y} r={2.5} fill="#3A4863" />,
          )}
          {/* top */}
          <line x1={LOOP_LEFT} y1={LOOP_TOP} x2={SWITCH_POS.x - 32} y2={LOOP_TOP} stroke="#3A4863" strokeWidth={2} />
          <line x1={SWITCH_POS.x + 32} y1={LOOP_TOP} x2={LOOP_RIGHT} y2={LOOP_TOP} stroke="#3A4863" strokeWidth={2} />
          {/* right */}
          <line x1={LOOP_RIGHT} y1={LOOP_TOP} x2={LOOP_RIGHT} y2={AMMETER_POS.y - 32} stroke="#3A4863" strokeWidth={2} />
          <line x1={LOOP_RIGHT} y1={AMMETER_POS.y + 32} x2={LOOP_RIGHT} y2={LOOP_BOTTOM} stroke="#3A4863" strokeWidth={2} />
          {/* bottom */}
          <line x1={LOOP_LEFT} y1={LOOP_BOTTOM} x2={RECEIVER_POS.x - 32} y2={LOOP_BOTTOM} stroke="#3A4863" strokeWidth={2} />
          <line x1={RECEIVER_POS.x + 32} y1={LOOP_BOTTOM} x2={LOOP_RIGHT} y2={LOOP_BOTTOM} stroke="#3A4863" strokeWidth={2} />
          {/* left */}
          <line x1={LOOP_LEFT} y1={LOOP_TOP} x2={LOOP_LEFT} y2={BATTERY_POS.y - 32} stroke="#3A4863" strokeWidth={2} />
          <line x1={LOOP_LEFT} y1={BATTERY_POS.y + 32} x2={LOOP_LEFT} y2={LOOP_BOTTOM} stroke="#3A4863" strokeWidth={2} />
        </g>

        {/* Battery — fixed (vertical) */}
        <g transform={`translate(${BATTERY_POS.x}, ${BATTERY_POS.y}) rotate(90)`}>
          <BatterySymbol />
        </g>
        <text
          x={BATTERY_POS.x - 22}
          y={BATTERY_POS.y + 4}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={11}
          textAnchor="end"
        >
          E, r
        </text>

        {/* Switch — clickable on stages 1+2 */}
        <g
          transform={`translate(${SWITCH_POS.x}, ${SWITCH_POS.y})`}
          onPointerDown={(e) => { e.stopPropagation(); onSwitchClick() }}
          style={{ cursor: isStage3 ? 'default' : 'pointer' }}
        >
          <SwitchSymbol closed={switchClosed} />
        </g>

        {/* Ammeter (vertical, in series) */}
        <g transform={`translate(${AMMETER_POS.x}, ${AMMETER_POS.y})`}>
          <AmmeterSymbol reading={iText} hidden={false} />
        </g>

        {/* Voltmeter branch: dashed leads from receiver ends to voltmeter body */}
        <g stroke="#3A4863" strokeWidth={1} strokeDasharray="3 3" fill="none">
          <line x1={RECEIVER_POS.x - 32} y1={LOOP_BOTTOM} x2={RECEIVER_POS.x - 32} y2={VOLTMETER_POS.y} />
          <line x1={RECEIVER_POS.x - 32} y1={VOLTMETER_POS.y} x2={VOLTMETER_POS.x - 14} y2={VOLTMETER_POS.y} />
          <line x1={RECEIVER_POS.x + 32} y1={LOOP_BOTTOM} x2={RECEIVER_POS.x + 32} y2={VOLTMETER_POS.y} />
          <line x1={RECEIVER_POS.x + 32} y1={VOLTMETER_POS.y} x2={VOLTMETER_POS.x + 14} y2={VOLTMETER_POS.y} />
        </g>
        <g transform={`translate(${VOLTMETER_POS.x}, ${VOLTMETER_POS.y})`}>
          <VoltmeterSymbol reading={uText} hidden={false} />
        </g>

        {/* Receiver slot */}
        {slot === null && (
          <g>
            <rect
              x={RECEIVER_POS.x - 30}
              y={RECEIVER_POS.y - 18}
              width={60}
              height={36}
              fill="none"
              stroke={dragging ? '#F97316' : '#3A4863'}
              strokeWidth={1.2}
              strokeDasharray="4 4"
              rx={4}
              opacity={0.85}
            />
            {isStage3 && (
              <text
                x={RECEIVER_POS.x}
                y={RECEIVER_POS.y + 5}
                fill="#6C7A93"
                fontFamily="'JetBrains Mono', monospace"
                fontSize={16}
                textAnchor="middle"
                fontWeight={700}
              >
                ?
              </text>
            )}
          </g>
        )}
        {slot !== null && (
          <g
            onPointerDown={onPointerDownSlot}
            style={{ cursor: isStage3 ? 'default' : 'grab' }}
          >
            <rect x={RECEIVER_POS.x - 34} y={RECEIVER_POS.y - 20} width={68} height={40} fill="transparent" />
            <g transform={`translate(${RECEIVER_POS.x}, ${RECEIVER_POS.y})`}>
              {receiverGlyph(slot)}
            </g>
          </g>
        )}

        {/* Post-submit feedback ring (only on stage 3, after commit) */}
        {isStage3 && stage3Submitted && (
          <circle
            cx={RECEIVER_POS.x}
            cy={RECEIVER_POS.y}
            r={30}
            fill="none"
            stroke={stage3Correct ? '#37C9B8' : '#EF4444'}
            strokeWidth={2}
            opacity={0.9}
          />
        )}

        {/* Current-flow animation (stages 1+2 only, when I > 0) */}
        {showFlow && (
          <g>
            <path
              id="flow-path"
              d={`M ${LOOP_LEFT} ${LOOP_TOP} L ${LOOP_RIGHT} ${LOOP_TOP} L ${LOOP_RIGHT} ${LOOP_BOTTOM} L ${LOOP_LEFT} ${LOOP_BOTTOM} Z`}
              fill="none"
              stroke="none"
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

        {/* Stage-3 measurement caption (problem statement, not feedback) */}
        {isStage3 && (
          <text
            x={LOOP_LEFT}
            y={LOOP_TOP - 22}
            fill="#B9C4D6"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={11}
            letterSpacing="0.08em"
          >
            measured: I = {fmtI(scenario.Iamps)}  ·  U = {fmtU(scenario.Uvolts)}
          </text>
        )}

        {/* Palette items */}
        {paletteItems.map((k, i) => {
          const y = paletteYStart + i * paletteStep
          const disabled = isStage3 && stage3Submitted
          return (
            <g
              key={k}
              transform={`translate(${paletteX}, ${y})`}
              style={{ cursor: disabled ? 'default' : 'grab', opacity: disabled ? 0.4 : 1 }}
              onPointerDown={(e) => { if (!disabled) onPointerDownPalette(k, e) }}
            >
              <rect x={-58} y={-24} width={116} height={48} fill="#131F35" stroke="#3A4863" strokeWidth={1} rx={4} />
              {receiverGlyph(k)}
              <text
                x={0}
                y={38}
                fill="#6C7A93"
                fontFamily="'JetBrains Mono', monospace"
                fontSize={10}
                textAnchor="middle"
              >
                {labels[`comp_${k}`]}
              </text>
            </g>
          )
        })}

        {/* Drag ghost */}
        {dragging && (
          <g transform={`translate(${dragging.x}, ${dragging.y})`} opacity={0.75} pointerEvents="none">
            {receiverGlyph(dragging.comp)}
          </g>
        )}
        {/* BR quadrant (x > 600, y > 350) intentionally empty — reserved for parent chrome. */}
      </svg>

      {/* HUD overlays (HTML, in rem) */}
      <div style={{ position: 'absolute', top: '3rem', left: '3rem', fontFamily: "'JetBrains Mono', monospace", fontSize: '2.3rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: '#6C7A93', zIndex: 5, pointerEvents: 'none' }}>
        {hudTL}
      </div>
      <div style={{ position: 'absolute', top: '3rem', right: '3rem', fontFamily: "'JetBrains Mono', monospace", fontSize: '1.5rem', letterSpacing: '0.08em', color: canSubmit ? '#37C9B8' : '#B9C4D6', zIndex: 5, pointerEvents: 'none', textAlign: 'right' }}>
        {hudTR}
      </div>
      <div style={{ position: 'absolute', bottom: '3rem', left: '3rem', fontFamily: "'JetBrains Mono', monospace", fontSize: '1.8rem', letterSpacing: '0.06em', color: '#6C7A93', zIndex: 5, pointerEvents: 'none', maxWidth: '58%' }}>
        <div>{hudBL}</div>
        {diagText && (
          <div style={{ marginTop: '0.6rem', fontSize: '1.4rem', color: '#54617A' }}>{diagText}</div>
        )}
      </div>
      {/* BR reserved for parent chrome — no overlay here. */}
    </div>
  )
}
