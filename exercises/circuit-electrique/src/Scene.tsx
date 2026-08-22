import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  useSetStage,
  useCurrentStage,
  useComplete,
  useDeclareStages,
  useHint,
  useInit,
  useNext,
  usePeek,
  useProgress,
  useReset,
} from '@physics/sdk/react'
import { getHintFor, getStagesFor } from './stages'
import en from '../i18n/en.json'
import fr from '../i18n/fr.json'
import ar from '../i18n/ar.json'

// ─── Scene constants ────────────────────────────────────────────────────
const W = 800
const H = 450

// Loop rectangle (world coords)
const LOOP_LEFT = 130
const LOOP_RIGHT = 500
const LOOP_TOP = 100
const LOOP_BOTTOM = 340
const SLOT_HIT_RADIUS = 55

// Slot ordering: [top, right, bottom, left]
type SlotIdx = 0 | 1 | 2 | 3
type CompKind = 'battery' | 'switch' | 'lamp' | 'wire'
type Slot = CompKind | null

const SLOT_CENTERS: { x: number; y: number }[] = [
  { x: (LOOP_LEFT + LOOP_RIGHT) / 2, y: LOOP_TOP },      // top
  { x: LOOP_RIGHT, y: (LOOP_TOP + LOOP_BOTTOM) / 2 },    // right
  { x: (LOOP_LEFT + LOOP_RIGHT) / 2, y: LOOP_BOTTOM },   // bottom
  { x: LOOP_LEFT, y: (LOOP_TOP + LOOP_BOTTOM) / 2 },     // left
]

const SLOT_ORIENT: ('h' | 'v')[] = ['h', 'v', 'h', 'v']

const dict = { en, fr, ar } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── Circuit topology ────────────────────────────────────────────
type CircuitState = { slots: [Slot, Slot, Slot, Slot]; switchClosed: boolean }

function isLoopComplete(c: CircuitState): boolean {
  if (c.slots.some((s) => s === null)) return false
  const hasSwitch = c.slots.includes('switch')
  const hasBattery = c.slots.includes('battery')
  if (!hasBattery) return false
  if (hasSwitch && !c.switchClosed) return false
  return true
}

function lampLit(c: CircuitState): boolean {
  return isLoopComplete(c) && c.slots.includes('lamp')
}

/** Diagnostic message for the current circuit — used in tips/HUD. */
function diagnose(c: CircuitState, labels: Record<string, string>): string {
  const empty = c.slots.filter((s) => s === null).length
  const L = (k: string) => labels[k] ?? k
  if (empty > 0) return `${L('diag_empty_prefix')} ${empty} ${L('diag_empty_suffix')}`
  if (!c.slots.includes('battery')) return L('diag_no_battery')
  if (c.slots.includes('switch') && !c.switchClosed) return L('diag_switch_open')
  if (!c.slots.includes('lamp')) return L('diag_no_lamp')
  return L('diag_ok')
}

// ─── Component ──────────────────────────────────────────────────────────
export default function Scene() {
  const { locale } = useInit()
  const stages = useMemo(() => getStagesFor(locale), [locale])
  useDeclareStages(stages)
  const labels = useMemo(() => svgLabels(locale), [locale])

  const stageIdx = useCurrentStage()

  // Stage 1 & 2: fully user-built.
  const [slots, setSlots] = useState<[Slot, Slot, Slot, Slot]>([null, null, null, null])
  const [switchClosed, setSwitchClosed] = useState(false)
  const [peekVisible, setPeekVisible] = useState(false)

  // Stage 1 discovery flags
  const [sawLit, setSawLit] = useState(false)
  const [sawIncomplete, setSawIncomplete] = useState(false)

  // Stage 2: consecutive toggle-verifications (open → dark, close → lit)
  const [sawLitClosed, setSawLitClosed] = useState(false)
  const [sawDarkOpen, setSawDarkOpen] = useState(false)

  const setStage = useSetStage()
  const progress = useProgress()
  const complete = useComplete()

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  const circuit: CircuitState = { slots, switchClosed }
  const lit = lampLit(circuit)
  const complete_loop = isLoopComplete(circuit)

  // Stage 1: witness a lit lamp + witness at least one incomplete state
  useEffect(() => {
    if (!isStage1) return
    if (lit && !sawLit) setSawLit(true)
    if (!complete_loop && slots.some((s) => s !== null) && !sawIncomplete) setSawIncomplete(true)
  }, [isStage1, lit, complete_loop, slots, sawLit, sawIncomplete])

  // Stage 2: only counts if circuit contains battery, switch, lamp, wire (exactly one of each)
  const hasRequired = useMemo(() => {
    const counts = { battery: 0, switch: 0, lamp: 0, wire: 0 }
    for (const s of slots) if (s !== null) counts[s]++
    return counts.battery >= 1 && counts.switch >= 1 && counts.lamp >= 1 && counts.wire >= 1
  }, [slots])

  useEffect(() => {
    if (!isStage2 || !hasRequired) return
    if (switchClosed && lit && !sawLitClosed) setSawLitClosed(true)
    if (!switchClosed && !lit && !sawDarkOpen) setSawDarkOpen(true)
  }, [isStage2, hasRequired, switchClosed, lit, sawLitClosed, sawDarkOpen])

  // Stage 3: puzzle — 3 slots pre-filled, student adds the missing wire in slot 2 (right)
  useEffect(() => {
    if (!isStage3) return
    // If puzzle not yet initialized (all null after reset), populate it
    if (slots.every((s) => s === null)) {
      setSlots(['battery', null, 'lamp', 'switch'])
      setSwitchClosed(true)
    }
  }, [isStage3, slots])

  const stage1Done = sawLit && sawIncomplete
  const stage2Done = hasRequired && sawLitClosed && sawDarkOpen
  const stage3Done = isStage3 && lit && slots[1] === 'wire'
  const canSubmit = isStage1 ? stage1Done : isStage2 ? stage2Done : stage3Done

  const resetStageState = useCallback(() => {
    setSlots([null, null, null, null])
    setSwitchClosed(false)
    setSawLit(false)
    setSawIncomplete(false)
    setSawLitClosed(false)
    setSawDarkOpen(false)
    setPeekVisible(false)
  }, [])

  useReset(resetStageState)

  useEffect(() => {
    progress(stageIdx / 3, { stage: stageIdx, canSubmit })
  }, [stageIdx, canSubmit, progress])

  useNext(() => {
    if (stageIdx < 3) {
      setStage(stageIdx + 1)
      resetStageState()
    } else {
      complete({ success: true })
    }
  })

  usePeek(() => { if (isStage3) setPeekVisible(true) })
  useEffect(() => {
    if (!peekVisible) return
    const t = setTimeout(() => setPeekVisible(false), 1500)
    return () => clearTimeout(t)
  }, [peekVisible])

  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  // ─── Drag machinery ──────────────────────────────────────────────
  // Two-state pointer model:
  //   pending: pointer is down on a slot but hasn't moved enough to be a drag yet
  //   dragging: pointer is actively dragging a component (from palette or slot)
  // Threshold decides between click (→ toggle switch) and drag (→ move/remove).
  type PendingState = { fromSlot: SlotIdx; comp: CompKind; startClientX: number; startClientY: number }
  type DraggingState = { comp: CompKind; fromSlot: SlotIdx | null; x: number; y: number }
  const DRAG_THRESHOLD_PX = 5

  const [pending, setPending] = useState<PendingState | null>(null)
  const [dragging, setDragging] = useState<DraggingState | null>(null)

  const clientToSvg = (svg: SVGSVGElement, clientX: number, clientY: number): { x: number; y: number } => {
    const rect = svg.getBoundingClientRect()
    const scale = 1 / Math.min(rect.width / W, rect.height / H)
    const drawW = W / scale
    const drawH = H / scale
    const offX = (rect.width - drawW) / 2
    const offY = (rect.height - drawH) / 2
    return {
      x: (clientX - rect.left - offX) * scale,
      y: (clientY - rect.top - offY) * scale,
    }
  }

  const onPointerDownPalette = useCallback((kind: CompKind, e: React.PointerEvent<SVGElement>) => {
    e.stopPropagation()
    const svg = e.currentTarget.ownerSVGElement
    if (!svg) return
    ;(e.currentTarget as SVGElement).setPointerCapture(e.pointerId)
    const pos = clientToSvg(svg, e.clientX, e.clientY)
    setDragging({ comp: kind, fromSlot: null, x: pos.x, y: pos.y })
  }, [])

  const onPointerDownSlot = useCallback((idx: SlotIdx, comp: CompKind, e: React.PointerEvent<SVGElement>) => {
    e.stopPropagation()
    if (isStage3 && idx !== 1) return
    ;(e.currentTarget as SVGElement).setPointerCapture(e.pointerId)
    setPending({ fromSlot: idx, comp, startClientX: e.clientX, startClientY: e.clientY })
  }, [isStage3])

  const onPointerMove = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (pending) {
      const dist = Math.hypot(e.clientX - pending.startClientX, e.clientY - pending.startClientY)
      if (dist > DRAG_THRESHOLD_PX) {
        // Commit to drag: clear the source slot, start following the pointer.
        setSlots((prev) => {
          const next = prev.slice() as [Slot, Slot, Slot, Slot]
          next[pending.fromSlot] = null
          return next
        })
        const pos = clientToSvg(e.currentTarget, e.clientX, e.clientY)
        setDragging({ comp: pending.comp, fromSlot: pending.fromSlot, x: pos.x, y: pos.y })
        setPending(null)
      }
      return
    }
    if (!dragging) return
    const pos = clientToSvg(e.currentTarget, e.clientX, e.clientY)
    setDragging((prev) => (prev ? { ...prev, x: pos.x, y: pos.y } : null))
  }, [pending, dragging])

  const onPointerUp = useCallback((_e: React.PointerEvent<SVGSVGElement>) => {
    if (pending) {
      // Under-threshold → treat as click. Switch = toggle; others = no-op.
      if (pending.comp === 'switch') {
        setSwitchClosed((prev) => !prev)
      }
      setPending(null)
      return
    }
    if (!dragging) return
    // Find nearest slot within hit radius
    let bestIdx = -1
    let bestDist = SLOT_HIT_RADIUS
    for (let i = 0; i < 4; i++) {
      const c = SLOT_CENTERS[i]!
      const d = Math.hypot(dragging.x - c.x, dragging.y - c.y)
      if (d < bestDist) { bestDist = d; bestIdx = i }
    }
    if (bestIdx >= 0 && !(isStage3 && bestIdx !== 1)) {
      setSlots((prev) => {
        const next = prev.slice() as [Slot, Slot, Slot, Slot]
        next[bestIdx as SlotIdx] = dragging.comp
        return next
      })
    }
    // else: dropped outside any slot → discarded (component removed from circuit)
    setDragging(null)
  }, [pending, dragging, isStage3])

  // ─── Palette layout ──────────────────────────────────────────────
  const paletteX = 688
  const paletteYStart = 90
  const paletteStep = 68
  const paletteItems: CompKind[] = isStage3 ? ['wire'] : ['battery', 'switch', 'lamp', 'wire']

  // ─── HUD text ─────────────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`
  const hudTR = isStage1
    ? `${sawLit ? '✓' : '·'} ${labels.lit_once}  ${sawIncomplete ? '✓' : '·'} ${labels.broken_once}`
    : isStage2
      ? `${sawLitClosed ? '✓' : '·'} ${labels.on_when_closed}  ${sawDarkOpen ? '✓' : '·'} ${labels.off_when_open}`
      : `${labels.slot_missing}`
  const hudBL = isStage1 ? labels.tip1 : isStage2 ? labels.tip2 : labels.tip3
  const hudBR = diagnose(circuit, labels)

  const showScene = isStage1 || isStage2 || isStage3

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
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

        {showScene && (
          <>
            {/* Loop outline — the ONLY wires we draw between slot centers are the corners */}
            <g>
              {/* Corners */}
              {[
                [LOOP_LEFT, LOOP_TOP], [LOOP_RIGHT, LOOP_TOP],
                [LOOP_RIGHT, LOOP_BOTTOM], [LOOP_LEFT, LOOP_BOTTOM],
              ].map(([x, y], i) => (
                <circle key={`c${i}`} cx={x} cy={y} r={2.5} fill="#3A4863" />
              ))}
              {/* Segments from corner to slot center — always drawn (the "structural" wire) */}
              {/* top */}
              <line x1={LOOP_LEFT} y1={LOOP_TOP} x2={SLOT_CENTERS[0]!.x - 32} y2={LOOP_TOP} stroke="#3A4863" strokeWidth={2} />
              <line x1={SLOT_CENTERS[0]!.x + 32} y1={LOOP_TOP} x2={LOOP_RIGHT} y2={LOOP_TOP} stroke="#3A4863" strokeWidth={2} />
              {/* right */}
              <line x1={LOOP_RIGHT} y1={LOOP_TOP} x2={LOOP_RIGHT} y2={SLOT_CENTERS[1]!.y - 32} stroke="#3A4863" strokeWidth={2} />
              <line x1={LOOP_RIGHT} y1={SLOT_CENTERS[1]!.y + 32} x2={LOOP_RIGHT} y2={LOOP_BOTTOM} stroke="#3A4863" strokeWidth={2} />
              {/* bottom */}
              <line x1={LOOP_LEFT} y1={LOOP_BOTTOM} x2={SLOT_CENTERS[2]!.x - 32} y2={LOOP_BOTTOM} stroke="#3A4863" strokeWidth={2} />
              <line x1={SLOT_CENTERS[2]!.x + 32} y1={LOOP_BOTTOM} x2={LOOP_RIGHT} y2={LOOP_BOTTOM} stroke="#3A4863" strokeWidth={2} />
              {/* left */}
              <line x1={LOOP_LEFT} y1={LOOP_TOP} x2={LOOP_LEFT} y2={SLOT_CENTERS[3]!.y - 32} stroke="#3A4863" strokeWidth={2} />
              <line x1={LOOP_LEFT} y1={SLOT_CENTERS[3]!.y + 32} x2={LOOP_LEFT} y2={LOOP_BOTTOM} stroke="#3A4863" strokeWidth={2} />
            </g>

            {/* Slots */}
            {SLOT_CENTERS.map((c, i) => {
              const slot = slots[i as SlotIdx]
              const orient = SLOT_ORIENT[i]
              const isEditable = !(isStage3 && i !== 1)
              return (
                <g key={`slot${i}`}>
                  {/* Slot receiver background — dashed rect */}
                  {slot === null && (
                    <rect
                      x={c.x - 30}
                      y={c.y - 18}
                      width={60}
                      height={36}
                      fill="none"
                      stroke={dragging ? '#F97316' : '#3A4863'}
                      strokeWidth={1.2}
                      strokeDasharray="4 4"
                      rx={4}
                      opacity={isEditable ? 0.8 : 0.25}
                    />
                  )}
                  {slot !== null && (
                    <g
                      onPointerDown={(e) => isEditable && onPointerDownSlot(i as SlotIdx, slot, e)}
                      style={{ cursor: isEditable ? (slot === 'switch' ? 'pointer' : 'grab') : 'default' }}
                    >
                      {/* Bigger transparent hit area for reliable grabbing */}
                      <rect x={c.x - 34} y={c.y - 20} width={68} height={40} fill="transparent" />
                      <ComponentGlyph
                        kind={slot}
                        cx={c.x}
                        cy={c.y}
                        orient={orient!}
                        active={slot === 'lamp' ? lit : (slot === 'switch' ? switchClosed : true)}
                        switchClosed={switchClosed}
                      />
                    </g>
                  )}
                </g>
              )
            })}

            {/* Current-flow indication when lit */}
            {lit && (
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
          </>
        )}

        {/* Palette items */}
        {paletteItems.map((k, i) => {
          const y = paletteYStart + i * paletteStep
          return (
            <g
              key={k}
              transform={`translate(${paletteX}, ${y})`}
              style={{ cursor: 'grab' }}
              onPointerDown={(e) => onPointerDownPalette(k, e)}
            >
              <rect x={-58} y={-24} width={116} height={48} fill="#131F35" stroke="#3A4863" strokeWidth={1} rx={4} />
              <ComponentGlyph kind={k} cx={0} cy={0} orient="h" active={false} switchClosed={switchClosed} />
              <text x={0} y={38} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={10} textAnchor="middle">
                {labels[`comp_${k}`] ?? k}
              </text>
            </g>
          )
        })}

        {/* Drag ghost */}
        {dragging && (
          <g transform={`translate(${dragging.x}, ${dragging.y})`} opacity={0.75} pointerEvents="none">
            <ComponentGlyph kind={dragging.comp} cx={0} cy={0} orient="h" active={false} switchClosed={switchClosed} />
          </g>
        )}

        {/* Peek helper for stage 3 — show a green ghost of the missing wire */}
        {isStage3 && peekVisible && slots[1] !== 'wire' && (
          <g transform={`translate(${SLOT_CENTERS[1]!.x}, ${SLOT_CENTERS[1]!.y})`} opacity={0.55}>
            <ComponentGlyph kind="wire" cx={0} cy={0} orient="v" active={false} switchClosed={false} />
          </g>
        )}
      </svg>

      {/* HUD */}
      <div style={{ position: 'absolute', top: '3rem', left: '3rem', fontFamily: "'JetBrains Mono', monospace", fontSize: '2.3rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: '#6C7A93', zIndex: 5, pointerEvents: 'none' }}>
        {hudTL}
      </div>
      <div style={{ position: 'absolute', top: '3rem', right: '3rem', fontFamily: "'JetBrains Mono', monospace", fontSize: '1.5rem', letterSpacing: '0.08em', color: canSubmit ? '#37C9B8' : '#B9C4D6', zIndex: 5, pointerEvents: 'none', textAlign: 'right' }}>
        {hudTR}
      </div>
      <div style={{ position: 'absolute', bottom: '3rem', left: '3rem', fontFamily: "'JetBrains Mono', monospace", fontSize: '2.3rem', letterSpacing: '0.06em', color: '#6C7A93', zIndex: 5, pointerEvents: 'none', maxWidth: '58%' }}>
        {hudBL}
      </div>
      {hudBR && (
        <div style={{ position: 'absolute', bottom: '3rem', right: '3rem', fontFamily: "'JetBrains Mono', monospace", fontSize: '1.5rem', letterSpacing: '0.08em', color: lit ? '#37C9B8' : '#B9C4D6', textAlign: 'right', zIndex: 5, pointerEvents: 'none', maxWidth: '38%' }}>
          {hudBR}
        </div>
      )}
    </div>
  )
}

// ─── Component glyphs ───────────────────────────────────────────────────
function ComponentGlyph({
  kind, cx, cy, orient, active, switchClosed,
}: {
  kind: CompKind
  cx: number
  cy: number
  orient: 'h' | 'v'
  active: boolean
  switchClosed: boolean
}) {
  const rot = orient === 'v' ? 90 : 0
  return (
    <g transform={`translate(${cx}, ${cy}) rotate(${rot})`}>
      {kind === 'battery' && <BatterySymbol />}
      {kind === 'switch' && <SwitchSymbol closed={switchClosed} />}
      {kind === 'lamp' && <LampSymbol lit={active} />}
      {kind === 'wire' && <WireSymbol />}
    </g>
  )
}

function BatterySymbol() {
  // Long thin (+) / short thick (−) plates centered at origin, horizontal axis of current
  return (
    <g>
      <line x1={-32} y1={0} x2={-4} y2={0} stroke="#54617A" strokeWidth={2} />
      <line x1={4} y1={0} x2={32} y2={0} stroke="#54617A" strokeWidth={2} />
      <line x1={-4} y1={-14} x2={-4} y2={14} stroke="#B9C4D6" strokeWidth={2} />
      <line x1={4} y1={-9} x2={4} y2={9} stroke="#B9C4D6" strokeWidth={5} />
      <text x={-12} y={-18} fill="#F9A968" fontFamily="'JetBrains Mono', monospace" fontSize={10} textAnchor="middle" fontWeight={700}>+</text>
      <text x={12} y={-18} fill="#7EE3D8" fontFamily="'JetBrains Mono', monospace" fontSize={10} textAnchor="middle" fontWeight={700}>−</text>
    </g>
  )
}

function SwitchSymbol({ closed }: { closed: boolean }) {
  // Two pins at ±22, pivot at −22, blade rotates ~30° up when open
  const bladeAngle = closed ? 0 : -30
  return (
    <g>
      <rect x={-32} y={-18} width={64} height={36} fill="transparent" />
      <line x1={-32} y1={0} x2={-22} y2={0} stroke="#54617A" strokeWidth={2} />
      <line x1={22} y1={0} x2={32} y2={0} stroke="#54617A" strokeWidth={2} />
      <circle cx={-22} cy={0} r={2.4} fill="#B9C4D6" />
      <circle cx={22} cy={0} r={2.4} fill="#B9C4D6" />
      <line
        x1={-22}
        y1={0}
        x2={-22 + Math.cos((bladeAngle * Math.PI) / 180) * 44}
        y2={0 + Math.sin((bladeAngle * Math.PI) / 180) * 44}
        stroke={closed ? '#37C9B8' : '#B9C4D6'}
        strokeWidth={2}
      />
    </g>
  )
}

function LampSymbol({ lit }: { lit: boolean }) {
  return (
    <g>
      <line x1={-32} y1={0} x2={-14} y2={0} stroke="#54617A" strokeWidth={2} />
      <line x1={14} y1={0} x2={32} y2={0} stroke="#54617A" strokeWidth={2} />
      <circle cx={0} cy={0} r={13} fill={lit ? '#F9A968' : '#131F35'} stroke={lit ? '#F9A968' : '#54617A'} strokeWidth={1.4} />
      {lit && <circle cx={0} cy={0} r={22} fill="none" stroke="#F9A968" strokeWidth={1} opacity={0.35}>
        <animate attributeName="r" values="18;24;18" dur="1.5s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.15;0.4;0.15" dur="1.5s" repeatCount="indefinite" />
      </circle>}
      {/* Filament X */}
      <line x1={-6} y1={-6} x2={6} y2={6} stroke={lit ? '#B45309' : '#54617A'} strokeWidth={1.5} />
      <line x1={-6} y1={6} x2={6} y2={-6} stroke={lit ? '#B45309' : '#54617A'} strokeWidth={1.5} />
    </g>
  )
}

function WireSymbol() {
  return (
    <g>
      <line x1={-32} y1={0} x2={32} y2={0} stroke="#54617A" strokeWidth={2.4} />
    </g>
  )
}
