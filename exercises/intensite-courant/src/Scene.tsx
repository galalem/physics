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
const LOOP_LEFT = 130
const LOOP_RIGHT = 500
const LOOP_TOP = 100
const LOOP_BOTTOM = 340
const SLOT_HIT_RADIUS = 55

// Slot ordering: [top, right, bottom, left]
type SlotIdx = 0 | 1 | 2 | 3
type CompKind = 'battery' | 'lamp' | 'wire' | 'resistor' | 'ammeter'
type Slot = CompKind | null

const SLOT_CENTERS: { x: number; y: number }[] = [
  { x: (LOOP_LEFT + LOOP_RIGHT) / 2, y: LOOP_TOP },      // top
  { x: LOOP_RIGHT, y: (LOOP_TOP + LOOP_BOTTOM) / 2 },    // right
  { x: (LOOP_LEFT + LOOP_RIGHT) / 2, y: LOOP_BOTTOM },   // bottom
  { x: LOOP_LEFT, y: (LOOP_TOP + LOOP_BOTTOM) / 2 },     // left
]
const SLOT_ORIENT: ('h' | 'v')[] = ['h', 'v', 'h', 'v']

const dict = { en } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── Circuit topology (Tier 1: hand-authored currents, no true solver) ──
// Series loop model. If the loop is complete (all 4 slots filled AND
// contains a battery), the branch current I is set by how many resistors
// sit in series with the source. Base value 240 mA; each extra resistor
// halves the current (60 mA, 30 mA, 15 mA). These are hand-authored to
// match the Stage-2 targets — Tier 1 pattern rule: no RNG for readings.
type CircuitState = { slots: [Slot, Slot, Slot, Slot] }

function isLoopComplete(c: CircuitState): boolean {
  if (c.slots.some((s) => s === null)) return false
  return c.slots.includes('battery')
}
function hasLamp(c: CircuitState): boolean {
  return c.slots.includes('lamp')
}
function countResistors(c: CircuitState): number {
  return c.slots.filter((s) => s === 'resistor').length
}
/**
 * Hand-authored series current in mA. Values are picked so the Stage-2
 * targets (240 / 60) fall out of the topology directly:
 *   0 resistors → 240 mA (baseline: E / R_lamp with R_lamp ≈ 5 Ω, E ≈ 1.2 V)
 *   1 resistor  → 60 mA  (added series R quadruples R_total)
 *   2 resistors → 30 mA  (halved again)
 *   3 resistors → 15 mA
 * Returns 0 for a broken loop.
 */
function currentMAExplicit(c: CircuitState): number {
  if (!isLoopComplete(c)) return 0
  const n = countResistors(c)
  if (n === 0) return 240
  if (n === 1) return 60
  if (n === 2) return 30
  return 15
}
function lampLit(c: CircuitState): boolean {
  return isLoopComplete(c) && hasLamp(c) && currentMAExplicit(c) > 0
}
function ammeterSlot(c: CircuitState): SlotIdx | -1 {
  const idx = c.slots.indexOf('ammeter')
  return idx as SlotIdx | -1
}
/** Diagnostic message for the current circuit — used in BL tip on stages 1+2 only. */
function diagnose(c: CircuitState, labels: Record<string, string>): string {
  const L = (k: string) => labels[k] ?? k
  const empty = c.slots.filter((s) => s === null).length
  if (empty > 0) return L('diag_incomplete')
  if (!c.slots.includes('battery')) return L('diag_no_battery')
  if (!hasLamp(c)) return L('diag_no_lamp')
  if (ammeterSlot(c) === -1) return L('diag_no_ammeter')
  return L('diag_ok')
}

// ─── Stage-3 puzzle deck (seed-picked, hand-authored) ────────────────────
// Each puzzle pre-fills 3 of 4 slots. The student places ONE component
// from a restricted palette (correct + 2 decoys). Goal chip in TR shows
// which role the missing piece must play — the student reasons from the
// physical goal, not from trial-and-error.
type PuzzleSetup = {
  preFilled: [Slot, Slot, Slot, Slot]  // one entry is null → empty slot
  emptySlotIdx: SlotIdx
  correctComp: CompKind
  palette: CompKind[]                  // correct + 2 decoys
  goalKey: 'goal_measure' | 'goal_receive' | 'goal_close'
}
const PUZZLES: PuzzleSetup[] = [
  // P0: student must add an ammeter to measure I without altering the loop.
  {
    preFilled: ['battery', 'wire', 'lamp', null],
    emptySlotIdx: 3,
    correctComp: 'ammeter',
    palette: ['ammeter', 'resistor', 'wire'],
    goalKey: 'goal_measure',
  },
  // P1: ammeter is present but no receiver — student must add the lamp.
  {
    preFilled: ['battery', 'wire', null, 'ammeter'],
    emptySlotIdx: 2,
    correctComp: 'lamp',
    palette: ['lamp', 'wire', 'resistor'],
    goalKey: 'goal_receive',
  },
  // P2: loop has battery + lamp + ammeter; student must close it with a
  // plain conductor so I is not reduced. Resistor is a plausible decoy
  // (it would close the loop but drop the current).
  {
    preFilled: ['battery', null, 'lamp', 'ammeter'],
    emptySlotIdx: 1,
    correctComp: 'wire',
    palette: ['wire', 'resistor', 'ammeter'],
    goalKey: 'goal_close',
  },
]

// ─── Stage-2 target deck (hand-authored, seed-picked) ────────────────────
type TargetSet = { targets: number[] }  // in mA
const TARGET_SETS: TargetSet[] = [
  { targets: [240, 60] },  // full loop → add a resistor
  { targets: [60, 240] },  // start with resistor → remove it
]

// ─── Component ──────────────────────────────────────────────────────────
export default function Scene() {
  const { locale, seed } = useInit()
  const stages = useMemo(() => getStagesFor(locale), [locale])
  useDeclareStages(stages)
  const labels = useMemo(() => svgLabels(locale), [locale])

  const stageIdx = useCurrentStage()
  const setStage = useSetStage()

  const targetSet = useMemo(() => TARGET_SETS[seed % TARGET_SETS.length]!, [seed])

  // ─── Slot state ────────────────────────────────────────────────────────
  const [slots, setSlots] = useState<[Slot, Slot, Slot, Slot]>([null, null, null, null])

  // ─── Stage-1 coverage flags ────────────────────────────────────────────
  const [sawReading, setSawReading] = useState(false)          // ammeter placed, I > 0
  const [uniformSeen, setUniformSeen] = useState(false)         // ammeter observed in ≥ 2 distinct slots with same I > 0
  const [ammeterSlotsSeen, setAmmeterSlotsSeen] = useState<Set<number>>(new Set())

  // ─── Stage-2 target tracking ───────────────────────────────────────────
  const [targetsHit, setTargetsHit] = useState<boolean[]>([false, false])

  // ─── Stage-3 blind state ───────────────────────────────────────────────
  const [stage3Submitted, setStage3Submitted] = useState(false)
  const [stage3Correct, setStage3Correct] = useState<boolean | null>(null)
  const [puzzleRotation, setPuzzleRotation] = useState(0)      // seed offset after a wrong attempt

  const circuit: CircuitState = { slots }
  const I_ma = currentMAExplicit(circuit)
  const lit = lampLit(circuit)
  const ammIdx = ammeterSlot(circuit)

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  const complete = useComplete()
  const progress = useProgress()

  // Active puzzle (may rotate after wrong Stage-3 submit).
  const activePuzzle = useMemo(() => PUZZLES[(seed + puzzleRotation) % PUZZLES.length]!, [seed, puzzleRotation])

  // ─── Stage 1 coverage ──────────────────────────────────────────────────
  useEffect(() => {
    if (!isStage1) return
    if (ammIdx >= 0 && I_ma > 0 && !sawReading) setSawReading(true)
    if (ammIdx >= 0 && I_ma > 0 && !ammeterSlotsSeen.has(ammIdx)) {
      setAmmeterSlotsSeen((prev) => {
        const next = new Set(prev)
        next.add(ammIdx)
        return next
      })
    }
  }, [isStage1, ammIdx, I_ma, sawReading, ammeterSlotsSeen])

  useEffect(() => {
    if (!isStage1) return
    if (ammeterSlotsSeen.size >= 2 && !uniformSeen) setUniformSeen(true)
  }, [isStage1, ammeterSlotsSeen, uniformSeen])

  // ─── Stage 2 target tracking ───────────────────────────────────────────
  useEffect(() => {
    if (!isStage2) return
    if (ammIdx < 0 || I_ma <= 0) return
    setTargetsHit((prev) => {
      const next = [...prev]
      for (let i = 0; i < targetSet.targets.length; i++) {
        const t = targetSet.targets[i]!
        if (!next[i] && Math.abs(I_ma - t) / t < 0.05) next[i] = true
      }
      return next
    })
  }, [isStage2, ammIdx, I_ma, targetSet.targets])

  // ─── Stage 3 puzzle initialization ─────────────────────────────────────
  useEffect(() => {
    if (!isStage3) return
    if (slots.every((s) => s === null)) {
      setSlots([...activePuzzle.preFilled] as [Slot, Slot, Slot, Slot])
      setStage3Submitted(false)
      setStage3Correct(null)
    }
  }, [isStage3, slots, activePuzzle])

  // ─── Advance predicates ────────────────────────────────────────────────
  const stage1Done = sawReading && uniformSeen
  const stage2Done = targetsHit.every(Boolean)
  const stage3Done = stage3Correct === true
  const canSubmit = isStage1 ? stage1Done : isStage2 ? stage2Done : stage3Done

  // ─── Reset ─────────────────────────────────────────────────────────────
  const resetStageState = useCallback(() => {
    setSlots([null, null, null, null])
    setSawReading(false)
    setUniformSeen(false)
    setAmmeterSlotsSeen(new Set())
    setTargetsHit([false, false])
    setStage3Submitted(false)
    setStage3Correct(null)
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

  // ─── Stage-3 submit — one attempt per puzzle. Wrong = rotate. ─────────
  const submitStage3 = useCallback(() => {
    const placed = slots[activePuzzle.emptySlotIdx]
    const correct = placed === activePuzzle.correctComp && lampLit({ slots })
    setStage3Submitted(true)
    setStage3Correct(correct)
    if (!correct) {
      // Rotate to next puzzle after a brief pause so the student sees the
      // wrong indicator, then reset with a shifted puzzle.
      setTimeout(() => {
        setPuzzleRotation((n) => n + 1)
        setSlots([null, null, null, null])
        setStage3Submitted(false)
        setStage3Correct(null)
      }, 1400)
    }
  }, [slots, activePuzzle])

  // ─── Peek — strategy hint only, never a component ghost ────────────────
  const [peekText, setPeekText] = useState<string | null>(null)
  usePeek(() => { if (isStage3) setPeekText(labels.peek_tip) })
  useEffect(() => {
    if (!peekText) return
    const t = setTimeout(() => setPeekText(null), 5000)
    return () => clearTimeout(t)
  }, [peekText])

  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  // ─── Drag machinery ────────────────────────────────────────────────────
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
    // On stage 3 after submit, palette is inert until rotation resets state.
    if (isStage3 && stage3Submitted) return
    ;(e.currentTarget as SVGElement).setPointerCapture(e.pointerId)
    const pos = clientToSvg(svg, e.clientX, e.clientY)
    setDragging({ comp: kind, fromSlot: null, x: pos.x, y: pos.y })
  }, [isStage3, stage3Submitted])

  const onPointerDownSlot = useCallback((idx: SlotIdx, comp: CompKind, e: React.PointerEvent<SVGElement>) => {
    e.stopPropagation()
    // Stage 3: pre-filled slots are locked; only the empty slot is interactive.
    if (isStage3 && idx !== activePuzzle.emptySlotIdx) return
    if (isStage3 && stage3Submitted) return
    ;(e.currentTarget as SVGElement).setPointerCapture(e.pointerId)
    setPending({ fromSlot: idx, comp, startClientX: e.clientX, startClientY: e.clientY })
  }, [isStage3, activePuzzle.emptySlotIdx, stage3Submitted])

  const onPointerMove = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (pending) {
      const dist = Math.hypot(e.clientX - pending.startClientX, e.clientY - pending.startClientY)
      if (dist > DRAG_THRESHOLD_PX) {
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
      // Under-threshold click — no toggle behaviour in this exercise.
      setPending(null)
      return
    }
    if (!dragging) return
    let bestIdx = -1
    let bestDist = SLOT_HIT_RADIUS
    for (let i = 0; i < 4; i++) {
      const c = SLOT_CENTERS[i]!
      const d = Math.hypot(dragging.x - c.x, dragging.y - c.y)
      if (d < bestDist) { bestDist = d; bestIdx = i }
    }
    // Stage 3: only accept drops into the empty slot; other drops are discarded.
    const stage3Locked = isStage3 && bestIdx !== activePuzzle.emptySlotIdx
    if (bestIdx >= 0 && !stage3Locked) {
      const dropped = dragging.comp
      const dropIdx = bestIdx as SlotIdx
      setSlots((prev) => {
        const next = prev.slice() as [Slot, Slot, Slot, Slot]
        next[dropIdx] = dropped
        return next
      })
      // Stage 3: auto-submit on placement (single-attempt model).
      if (isStage3 && bestIdx === activePuzzle.emptySlotIdx) {
        setTimeout(submitStage3, 0)
      }
    }
    setDragging(null)
  }, [pending, dragging, isStage3, activePuzzle.emptySlotIdx, submitStage3])

  // ─── Palette layout ────────────────────────────────────────────────────
  // Palette layout: keep 5 items entirely inside x∈[608,768] and y∈[60,350]
  // so no palette content spills into the reserved BR quadrant (§4.3).
  // Last item center at y = 75 + 4*60 = 315; card is y=-22..y=22, label at y=32,
  // so the deepest text sits at 315+32 = 347 (< 350).
  const paletteX = 688
  const paletteYStart = 75
  const paletteStep = 60
  // Stage 3 uses the puzzle's restricted palette (correct + 2 decoys).
  // Stages 1+2 expose the full palette.
  const paletteItems: CompKind[] = isStage3
    ? activePuzzle.palette
    : ['battery', 'lamp', 'wire', 'resistor', 'ammeter']

  // ─── HUD text ─────────────────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`

  // Stage 1 TR: coverage progress. Stage 2 TR: targets N/M. Stage 3 TR: goal chip.
  const hudTR = isStage1
    ? `${sawReading ? '✓' : '·'} ${labels.measured_I}   ${uniformSeen ? '✓' : '·'} ${labels.uniform_I}`
    : isStage2
      ? `${labels.targets}: ${targetsHit.filter(Boolean).length}/${targetSet.targets.length}`
      : stage3Submitted
        ? (stage3Correct ? labels.correct : labels.wrong)
        : `${labels.goal_prefix}: ${labels[activePuzzle.goalKey] ?? ''}`

  // BL: tip + (on stages 1+2) a diagnostic line stacked below.
  // On stage 3, show peek text if active, else tip3. diagnose() is help — not
  // shown on the blind stage (§4.7).
  const bl_line1 = isStage3 ? (peekText ?? labels.tip3) : (isStage1 ? labels.tip1 : labels.tip2)
  const bl_line2 = !isStage3 ? diagnose(circuit, labels) : ''

  // Stage 2 target chips (goal read-out — required info, kept on stages 1+2 for
  // grounding, kept as a goal chip on stage 3 TR instead of numeric target).
  const stage2TargetChips = isStage2 ? targetSet.targets : []

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

        {/* Stage-2 target chips row (bottom of schematic panel) */}
        {isStage2 && stage2TargetChips.length > 0 && (
          <g>
            {stage2TargetChips.map((t, i) => {
              const hit = targetsHit[i]
              const cx = 100 + i * 120
              const cy = 400
              return (
                <g key={`tgt${i}`}>
                  <rect x={cx - 46} y={cy - 14} width={92} height={26} rx={4} fill="#131F35" stroke={hit ? '#37C9B8' : '#3A4863'} strokeWidth={1} />
                  <text x={cx} y={cy + 5} fill={hit ? '#37C9B8' : '#B9C4D6'} fontFamily="'JetBrains Mono', monospace" fontSize={12} textAnchor="middle" letterSpacing="0.05em">
                    {hit ? '✓ ' : ''}{`${labels.target_current}: ${t} ${labels.unit_mA}`}
                  </text>
                </g>
              )
            })}
          </g>
        )}

        {/* Loop skeleton */}
        <g>
          {[
            [LOOP_LEFT, LOOP_TOP], [LOOP_RIGHT, LOOP_TOP],
            [LOOP_RIGHT, LOOP_BOTTOM], [LOOP_LEFT, LOOP_BOTTOM],
          ].map(([x, y], i) => (
            <circle key={`c${i}`} cx={x} cy={y} r={2.5} fill="#3A4863" />
          ))}
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
          const isEditable = !(isStage3 && i !== activePuzzle.emptySlotIdx)
          return (
            <g key={`slot${i}`}>
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
                  style={{ cursor: isEditable ? 'grab' : 'default' }}
                >
                  <rect x={c.x - 34} y={c.y - 22} width={68} height={44} fill="transparent" />
                  <ComponentGlyph
                    kind={slot}
                    cx={c.x}
                    cy={c.y}
                    orient={orient!}
                    // Lamp glow is a live outcome signal — suppress it on the blind
                    // stage until the student has committed AND been marked correct
                    // (§4.7 rule 3: no pre-submit indication).
                    active={
                      slot === 'lamp'
                        ? (isStage3 ? (stage3Submitted && stage3Correct === true && lit) : lit)
                        : true
                    }
                  />
                  {/* Ammeter reading pinned above the meter's slot */}
                  {slot === 'ammeter' && (
                    <text
                      x={c.x}
                      y={c.y - 22}
                      fill={ammeterDisplayColor(isStage3, stage3Submitted, stage3Correct, I_ma)}
                      fontFamily="'JetBrains Mono', monospace"
                      fontSize={12}
                      textAnchor="middle"
                      letterSpacing="0.05em"
                    >
                      {ammeterDisplayText(isStage3, stage3Submitted, stage3Correct, I_ma, labels)}
                    </text>
                  )}
                </g>
              )}
              {/* Stage-3 post-submit slot flash */}
              {isStage3 && i === activePuzzle.emptySlotIdx && stage3Submitted && (
                <circle
                  cx={c.x} cy={c.y} r={26}
                  fill="none"
                  stroke={stage3Correct ? '#37C9B8' : '#EF4444'}
                  strokeWidth={2}
                  opacity={0.85}
                />
              )}
            </g>
          )
        })}

        {/* Current-flow animation when lit (stages 1+2 only — hidden on
            stage 3 to keep pre-submit outcome invisible per §4.7 rule 3) */}
        {lit && !isStage3 && (
          <g>
            <path
              id="flow-path"
              d={`M ${LOOP_LEFT} ${LOOP_TOP} L ${LOOP_RIGHT} ${LOOP_TOP} L ${LOOP_RIGHT} ${LOOP_BOTTOM} L ${LOOP_LEFT} ${LOOP_BOTTOM} Z`}
              fill="none"
              stroke="none"
            />
            {[0, 0.5, 1.0, 1.5].map((delay) => (
              <circle key={`f${delay}`} r={2.5} fill="#37C9B8">
                {/* Faster loop when I is larger — animation duration scales inversely with I. */}
                <animateMotion dur={`${flowDurationS(I_ma)}s`} repeatCount="indefinite" begin={`${delay}s`}>
                  <mpath href="#flow-path" />
                </animateMotion>
              </circle>
            ))}
          </g>
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
              <rect x={-58} y={-22} width={116} height={44} fill="#131F35" stroke="#3A4863" strokeWidth={1} rx={4} />
              <ComponentGlyph kind={k} cx={0} cy={0} orient="h" active={false} />
              <text x={0} y={32} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={10} textAnchor="middle">
                {(labels as Record<string, string>)[`comp_${k}`] ?? k}
              </text>
            </g>
          )
        })}

        {/* Drag ghost */}
        {dragging && (
          <g transform={`translate(${dragging.x}, ${dragging.y})`} opacity={0.75} pointerEvents="none">
            <ComponentGlyph kind={dragging.comp} cx={0} cy={0} orient="h" active={false} />
          </g>
        )}

        {/* BR quadrant intentionally empty — reserved for parent chrome (§4.3). */}
      </svg>

      {/* HUD overlays (HTML in rem — do not use SVG <text> for HUD). */}
      <div style={{ position: 'absolute', top: '3rem', left: '3rem', fontFamily: "'JetBrains Mono', monospace", fontSize: '2.3rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: '#6C7A93', zIndex: 5, pointerEvents: 'none' }}>
        {hudTL}
      </div>
      <div style={{ position: 'absolute', top: '3rem', right: '3rem', fontFamily: "'JetBrains Mono', monospace", fontSize: '1.6rem', letterSpacing: '0.08em', color: canSubmit ? '#37C9B8' : (isStage3 && stage3Submitted && !stage3Correct ? '#EF4444' : '#B9C4D6'), zIndex: 5, pointerEvents: 'none', textAlign: 'right', maxWidth: '42%' }}>
        {hudTR}
      </div>
      <div style={{ position: 'absolute', bottom: '3rem', left: '3rem', fontFamily: "'JetBrains Mono', monospace", fontSize: '1.7rem', letterSpacing: '0.06em', color: '#6C7A93', zIndex: 5, pointerEvents: 'none', maxWidth: '58%', lineHeight: 1.4 }}>
        <div>{bl_line1}</div>
        {bl_line2 && <div style={{ marginTop: '0.6rem', color: lit ? '#37C9B8' : '#6C7A93' }}>{bl_line2}</div>}
      </div>
      {/* BR reserved — no overlay here. */}
    </div>
  )
}

// ─── Ammeter display helpers ─────────────────────────────────────────────
function ammeterDisplayText(
  isStage3: boolean,
  submitted: boolean,
  correct: boolean | null,
  I_ma: number,
  labels: Record<string, string>,
): string {
  if (isStage3 && !submitted) return labels.hidden_reading ?? '?'
  if (isStage3 && submitted && correct !== true) return labels.hidden_reading ?? '?'
  return `${I_ma} ${labels.unit_mA}`
}
function ammeterDisplayColor(
  isStage3: boolean,
  submitted: boolean,
  correct: boolean | null,
  I_ma: number,
): string {
  if (isStage3 && !submitted) return '#6C7A93'
  if (isStage3 && submitted && correct !== true) return '#6C7A93'
  return I_ma > 0 ? '#37C9B8' : '#6C7A93'
}

// Current-flow animation period (seconds) — inversely proportional to I,
// so the visual pace of the flow tracks the physical intensity.
function flowDurationS(I_ma: number): number {
  if (I_ma <= 0) return 6
  // 240 mA → 1.2 s per lap; 60 mA → 4.8 s; 30 mA → ~9 s; clamped.
  const s = 288 / I_ma
  return Math.min(9, Math.max(1.0, s))
}

// ─── Component glyphs ───────────────────────────────────────────────────
function ComponentGlyph({
  kind, cx, cy, orient, active,
}: {
  kind: CompKind
  cx: number
  cy: number
  orient: 'h' | 'v'
  active: boolean
}) {
  const rot = orient === 'v' ? 90 : 0
  return (
    <g transform={`translate(${cx}, ${cy}) rotate(${rot})`}>
      {kind === 'battery' && <BatterySymbol />}
      {kind === 'lamp' && <LampSymbol lit={active} />}
      {kind === 'wire' && <WireSymbol />}
      {kind === 'resistor' && <ResistorSymbol />}
      {kind === 'ammeter' && <AmmeterSymbol />}
    </g>
  )
}

function BatterySymbol() {
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

function LampSymbol({ lit }: { lit: boolean }) {
  return (
    <g>
      <line x1={-32} y1={0} x2={-14} y2={0} stroke="#54617A" strokeWidth={2} />
      <line x1={14} y1={0} x2={32} y2={0} stroke="#54617A" strokeWidth={2} />
      <circle cx={0} cy={0} r={13} fill={lit ? '#F9A968' : '#131F35'} stroke={lit ? '#F9A968' : '#54617A'} strokeWidth={1.4} />
      {lit && (
        <circle cx={0} cy={0} r={22} fill="none" stroke="#F9A968" strokeWidth={1} opacity={0.35}>
          <animate attributeName="r" values="18;24;18" dur="1.5s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.15;0.4;0.15" dur="1.5s" repeatCount="indefinite" />
        </circle>
      )}
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

function ResistorSymbol() {
  return (
    <g>
      <line x1={-32} y1={0} x2={-18} y2={0} stroke="#54617A" strokeWidth={2} />
      <line x1={18} y1={0} x2={32} y2={0} stroke="#54617A" strokeWidth={2} />
      <rect x={-18} y={-8} width={36} height={16} fill="#131F35" stroke="#54617A" strokeWidth={1.4} rx={2} />
      <text x={0} y={4} fill="#B9C4D6" fontFamily="'JetBrains Mono', monospace" fontSize={10} textAnchor="middle">R</text>
    </g>
  )
}

function AmmeterSymbol() {
  return (
    <g>
      <line x1={-32} y1={0} x2={-13} y2={0} stroke="#54617A" strokeWidth={2} />
      <line x1={13} y1={0} x2={32} y2={0} stroke="#54617A" strokeWidth={2} />
      <circle cx={0} cy={0} r={13} fill="#131F35" stroke="#54617A" strokeWidth={1.4} />
      <text x={0} y={4} fill="#B9C4D6" fontFamily="'JetBrains Mono', monospace" fontSize={11} textAnchor="middle" fontWeight={700}>A</text>
    </g>
  )
}

