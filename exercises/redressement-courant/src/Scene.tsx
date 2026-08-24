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
import en from '../i18n/en.json'
import { getHintFor, getStagesFor } from './stages'
import { F_MAINS, simulate, tolerance } from './rectifier'
import type { Rect as RectKind, Filter as FilterKind } from './rectifier'

// ─── Scene constants ────────────────────────────────────────────────────
const W = 800
const H = 450

// Schematic panel (top of left column)
const SCHEM_X = 32
const SCHEM_Y = 60
const SCHEM_W = 560
const SCHEM_H = 220

// Scope panel (below schematic)
const SCOPE_X = 32
const SCOPE_Y = 290
const SCOPE_W = 560
const SCOPE_H = 128

// Palette (right column)
const PAL_X = 608
const PAL_Y = 60
const PAL_W = 160
const PAL_H = 358

// Circuit topology inside the schematic panel
const AC_CX = 100
const AC_CY = 175
const TOP_RAIL_Y = 105
const BOT_RAIL_Y = 245
const RECT_SLOT_X = 250
const RECT_SLOT_Y = TOP_RAIL_Y // horizontal slot on top rail
const FILTER_SLOT_X = 380
const FILTER_SLOT_Y = 175 // vertical slot spanning the two rails
const LOAD_X = 470

const SLOT_HIT_RADIUS = 60

type SlotId = 'rect' | 'filter'
type PaletteKind = 'half' | 'bridge' | 'cap' | 'wire'

type Slots = { rect: PaletteKind | null; filter: PaletteKind | null }
const EMPTY_SLOTS: Slots = { rect: null, filter: null }

// Puzzle scenarios for stage 3 (seed-picked; rotated on wrong).
type Puzzle = {
  filterPref: 'cap' | 'wire'
  U_max: number
  R: number
  C_uf: number
  correctRect: 'half' | 'bridge'
}
const PUZZLES: Puzzle[] = [
  { filterPref: 'cap', U_max: 20, R: 1000, C_uf: 470, correctRect: 'bridge' },
  { filterPref: 'wire', U_max: 20, R: 1000, C_uf: 0, correctRect: 'half' },
  { filterPref: 'cap', U_max: 15, R: 800, C_uf: 220, correctRect: 'bridge' },
  { filterPref: 'wire', U_max: 15, R: 800, C_uf: 0, correctRect: 'bridge' },
]

// Fixed exploration params for stages 1 + 2.
const EXPLORE_PARAMS = { U_max: 20, R: 1000, C_uf: 470 } as const

// ─── Locale dictionary ──────────────────────────────────────────────────
const dict = { en } as const
type Locale = keyof typeof dict
function svgLabels(locale: string): Record<string, string> {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels as Record<string, string>
}

// ─── Helpers to map slot state to solver inputs ─────────────────────────
function rectOfSlot(k: PaletteKind | null): RectKind {
  if (k === 'half') return 'half'
  if (k === 'bridge') return 'bridge'
  return 'none'
}
function filterOfSlot(k: PaletteKind | null): FilterKind {
  return k === 'cap' ? 'cap' : 'wire'
}
function isRectifierKind(k: PaletteKind): boolean {
  return k === 'half' || k === 'bridge'
}
function isFilterKind(k: PaletteKind): boolean {
  return k === 'cap' || k === 'wire'
}

// ─── Component ──────────────────────────────────────────────────────────
export default function Scene() {
  const { locale, seed } = useInit()
  const stages = useMemo(() => getStagesFor(locale), [locale])
  useDeclareStages(stages)
  const labels = useMemo(() => svgLabels(locale), [locale])

  const stageIdx = useCurrentStage()
  const setStage = useSetStage()
  const progress = useProgress()
  const complete = useComplete()

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  // ─── Slot state ───────────────────────────────────────────────────────
  const [slots, setSlots] = useState<Slots>(EMPTY_SLOTS)

  // ─── Stage-1 coverage flags ───────────────────────────────────────────
  const [sawUnfiltered, setSawUnfiltered] = useState(false)
  const [sawSmoothed, setSawSmoothed] = useState(false)

  // ─── Stage-2 target flags ─────────────────────────────────────────────
  const [hitTargetA, setHitTargetA] = useState(false)
  const [hitTargetB, setHitTargetB] = useState(false)

  // ─── Stage-3 puzzle state ─────────────────────────────────────────────
  const [puzzleIdx, setPuzzleIdx] = useState<number>(seed % PUZZLES.length)
  const puzzle = PUZZLES[puzzleIdx]!
  const [stage3Submitted, setStage3Submitted] = useState(false)
  const [stage3Correct, setStage3Correct] = useState<boolean | null>(null)

  // Params in effect for the current stage
  const params = isStage3
    ? { U_max: puzzle.U_max, R: puzzle.R, C_uf: puzzle.C_uf }
    : EXPLORE_PARAMS

  // ─── Live simulation for the visible config ──────────────────────────
  // Stage 3 uses the correct-answer's simulation to compute target readouts
  // (student's placement is not simulated live — feedback is post-submit only).
  const displayConfig = useMemo(() => {
    if (isStage3) {
      // Target values shown come from the CORRECT config; student's own
      // choice is not simulated until submit.
      return {
        rect: puzzle.correctRect as RectKind,
        filter: puzzle.filterPref as FilterKind,
      }
    }
    return {
      rect: rectOfSlot(slots.rect),
      filter: filterOfSlot(slots.filter),
    }
  }, [isStage3, slots, puzzle])

  const sim = useMemo(
    () =>
      simulate({
        rect: displayConfig.rect,
        filter: displayConfig.filter,
        U_max: params.U_max,
        R: params.R,
        C_uf: params.C_uf,
      }),
    [displayConfig, params.U_max, params.R, params.C_uf],
  )

  // ─── Stage-1 coverage tracking ───────────────────────────────────────
  useEffect(() => {
    if (!isStage1) return
    const r = displayConfig.rect
    const f = displayConfig.filter
    const rectified = r === 'half' || r === 'bridge'
    if (rectified && f === 'wire' && sim.U_ripple > 8 && !sawUnfiltered) setSawUnfiltered(true)
    if (rectified && f === 'cap' && sim.U_ripple < 2 && !sawSmoothed) setSawSmoothed(true)
  }, [isStage1, displayConfig, sim, sawUnfiltered, sawSmoothed])

  // ─── Stage-2 target tracking ─────────────────────────────────────────
  useEffect(() => {
    if (!isStage2) return
    // Target A — smooth DC: U_ripple < 0.5 V (only bridge + cap qualifies at fixed params).
    if (sim.U_ripple < 0.5 && !hitTargetA) setHitTargetA(true)
    // Target B — raw pulse: U_avg < 7 V AND U_ripple > 10 V (only half + wire qualifies).
    if (sim.U_avg < 7 && sim.U_ripple > 10 && !hitTargetB) setHitTargetB(true)
  }, [isStage2, sim, hitTargetA, hitTargetB])

  // ─── Stage-3 puzzle init: pre-fill filter branch ─────────────────────
  useEffect(() => {
    if (!isStage3) return
    if (slots.rect === null && slots.filter === null) {
      setSlots({ rect: null, filter: puzzle.filterPref })
    }
  }, [isStage3, slots.rect, slots.filter, puzzle.filterPref])

  // ─── Stage-3 wrong-answer rotation ───────────────────────────────────
  useEffect(() => {
    if (!isStage3) return
    if (stage3Submitted && stage3Correct === false) {
      const t = setTimeout(() => {
        setPuzzleIdx((i) => (i + 1) % PUZZLES.length)
        setSlots(EMPTY_SLOTS)
        setStage3Submitted(false)
        setStage3Correct(null)
      }, 1600)
      return () => clearTimeout(t)
    }
    return
  }, [isStage3, stage3Submitted, stage3Correct])

  // ─── Advance predicates ──────────────────────────────────────────────
  const stage1Done = sawUnfiltered && sawSmoothed
  const stage2Done = hitTargetA && hitTargetB
  const stage3Done = stage3Correct === true
  const canSubmit = isStage1 ? stage1Done : isStage2 ? stage2Done : stage3Done

  // ─── Reset ───────────────────────────────────────────────────────────
  const resetStageState = useCallback(() => {
    setSlots(EMPTY_SLOTS)
    setSawUnfiltered(false)
    setSawSmoothed(false)
    setHitTargetA(false)
    setHitTargetB(false)
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

  // ─── Peek — text strategy hint (never reveals the rectifier) ────────
  const [peekText, setPeekText] = useState<string | null>(null)
  usePeek(() => {
    if (!isStage3) return
    setPeekText(labels.peek_tip ?? labels.tip3 ?? '')
  })
  useEffect(() => {
    if (!peekText) return
    const t = setTimeout(() => setPeekText(null), 5000)
    return () => clearTimeout(t)
  }, [peekText])

  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  // ─── Stage-3 grading ─────────────────────────────────────────────────
  const gradeStage3 = useCallback(
    (placed: PaletteKind) => {
      const studentSim = simulate({
        rect: rectOfSlot(placed),
        filter: puzzle.filterPref,
        U_max: puzzle.U_max,
        R: puzzle.R,
        C_uf: puzzle.C_uf,
      })
      const targetSim = simulate({
        rect: puzzle.correctRect,
        filter: puzzle.filterPref,
        U_max: puzzle.U_max,
        R: puzzle.R,
        C_uf: puzzle.C_uf,
      })
      const avgOK = tolerance(targetSim.U_avg, studentSim.U_avg, 0.1)
      const ripOK = tolerance(targetSim.U_ripple, studentSim.U_ripple, 0.15)
      return avgOK && ripOK && placed === puzzle.correctRect
    },
    [puzzle],
  )

  // ─── Drag machinery ──────────────────────────────────────────────────
  type PendingState = { fromSlot: SlotId; comp: PaletteKind; startClientX: number; startClientY: number }
  type DraggingState = { comp: PaletteKind; fromSlot: SlotId | null; x: number; y: number }
  const DRAG_THRESHOLD_PX = 5
  const [pending, setPending] = useState<PendingState | null>(null)
  const [dragging, setDragging] = useState<DraggingState | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

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

  const slotIsEditable = useCallback(
    (id: SlotId): boolean => {
      if (!isStage3) return true
      // On stage 3: only the rectifier slot is editable.
      return id === 'rect'
    },
    [isStage3],
  )

  // Is the placed kind compatible with the slot?
  const kindFitsSlot = (id: SlotId, kind: PaletteKind): boolean => {
    if (id === 'rect') return isRectifierKind(kind)
    return isFilterKind(kind)
  }

  const onPointerDownPalette = useCallback((kind: PaletteKind, e: React.PointerEvent<SVGElement>) => {
    e.stopPropagation()
    if (isStage3 && !isRectifierKind(kind)) return
    const svg = e.currentTarget.ownerSVGElement
    if (!svg) return
    ;(e.currentTarget as SVGElement).setPointerCapture(e.pointerId)
    const pos = clientToSvg(svg, e.clientX, e.clientY)
    setDragging({ comp: kind, fromSlot: null, x: pos.x, y: pos.y })
  }, [isStage3])

  const onPointerDownSlot = useCallback(
    (id: SlotId, comp: PaletteKind, e: React.PointerEvent<SVGElement>) => {
      e.stopPropagation()
      if (!slotIsEditable(id)) return
      ;(e.currentTarget as SVGElement).setPointerCapture(e.pointerId)
      setPending({ fromSlot: id, comp, startClientX: e.clientX, startClientY: e.clientY })
    },
    [slotIsEditable],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (pending) {
        const dist = Math.hypot(e.clientX - pending.startClientX, e.clientY - pending.startClientY)
        if (dist > DRAG_THRESHOLD_PX) {
          const from = pending.fromSlot
          setSlots((prev) => ({ ...prev, [from]: null }))
          const pos = clientToSvg(e.currentTarget, e.clientX, e.clientY)
          setDragging({ comp: pending.comp, fromSlot: from, x: pos.x, y: pos.y })
          setPending(null)
        }
        return
      }
      if (!dragging) return
      const pos = clientToSvg(e.currentTarget, e.clientX, e.clientY)
      setDragging((prev) => (prev ? { ...prev, x: pos.x, y: pos.y } : null))
    },
    [pending, dragging],
  )

  const onPointerUp = useCallback(
    (_e: React.PointerEvent<SVGSVGElement>) => {
      if (pending) {
        // click-only: no toggle for this exercise.
        setPending(null)
        return
      }
      if (!dragging) return
      // Find nearest slot within hit radius that also accepts this kind.
      const slotCoords: Array<{ id: SlotId; x: number; y: number }> = [
        { id: 'rect', x: RECT_SLOT_X, y: RECT_SLOT_Y },
        { id: 'filter', x: FILTER_SLOT_X, y: FILTER_SLOT_Y },
      ]
      let bestId: SlotId | null = null
      let bestDist = SLOT_HIT_RADIUS
      for (const s of slotCoords) {
        const d = Math.hypot(dragging.x - s.x, dragging.y - s.y)
        if (d < bestDist && kindFitsSlot(s.id, dragging.comp) && slotIsEditable(s.id)) {
          bestDist = d
          bestId = s.id
        }
      }
      if (bestId) {
        const drop = bestId
        setSlots((prev) => ({ ...prev, [drop]: dragging.comp }))
        if (isStage3 && drop === 'rect') {
          // Auto-submit: one-shot placement.
          const placed = dragging.comp
          setTimeout(() => {
            const ok = gradeStage3(placed)
            setStage3Submitted(true)
            setStage3Correct(ok)
          }, 0)
        }
      }
      setDragging(null)
    },
    [pending, dragging, isStage3, gradeStage3, slotIsEditable],
  )

  // ─── Palette layout ──────────────────────────────────────────────────
  const paletteX = 688
  const paletteYStart = 100
  const paletteStep = 68
  // Stage 3: restricted to the two rectifier options (correct + 1 decoy).
  const paletteItems: PaletteKind[] = isStage3 ? ['half', 'bridge'] : ['half', 'bridge', 'cap', 'wire']

  // ─── HUD text ────────────────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`

  const hudTR = isStage1
    ? `${sawUnfiltered ? '✓' : '·'} ${labels.seen_unfiltered}   ${sawSmoothed ? '✓' : '·'} ${labels.seen_smoothed}`
    : isStage2
      ? `${labels.targets}   ${hitTargetA ? '✓' : '·'} A   ${hitTargetB ? '✓' : '·'} B`
      : stage3Submitted
        ? stage3Correct
          ? labels.stage3_correct
          : labels.stage3_wrong
        : labels.stage3_place

  // BL: contextual tip / peek. On stage 3, peek text lives here.
  const hudBL = isStage3
    ? peekText ?? labels.tip3
    : isStage2
      ? labels.tip2
      : labels.tip1

  // ─── Rendering helpers ───────────────────────────────────────────────
  const rectSlotEmpty = slots.rect === null
  const filterSlotEmpty = slots.filter === null
  const dragHiOverEmpty = (dragging: DraggingState | null) => !!dragging

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
        {/* Background — NO borderRadius, NO rx */}
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        {/* Schematic panel border + title */}
        <rect x={SCHEM_X} y={SCHEM_Y} width={SCHEM_W} height={SCHEM_H} fill="none" stroke="#12203a" strokeWidth={1} rx={6} />
        <text x={SCHEM_X + 8} y={SCHEM_Y - 8} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={11} letterSpacing="0.1em">
          {labels.schematic}
        </text>

        {/* Scope panel border + title */}
        <rect x={SCOPE_X} y={SCOPE_Y} width={SCOPE_W} height={SCOPE_H} fill="none" stroke="#12203a" strokeWidth={1} rx={6} />
        <text x={SCOPE_X + 8} y={SCOPE_Y - 8} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={11} letterSpacing="0.1em">
          {labels.scope}
        </text>

        {/* Palette panel border + title */}
        <rect x={PAL_X} y={PAL_Y} width={PAL_W} height={PAL_H} fill="none" stroke="#12203a" strokeWidth={1} rx={6} />
        <text x={PAL_X + 8} y={PAL_Y - 8} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={11} letterSpacing="0.1em">
          {labels.palette}
        </text>

        {/* ─── Circuit topology ────────────────────────────── */}
        {/* Top rail: from AC(+) to right corner */}
        <line x1={AC_CX} y1={TOP_RAIL_Y} x2={RECT_SLOT_X - 34} y2={TOP_RAIL_Y} stroke="#3A4863" strokeWidth={2} />
        <line x1={RECT_SLOT_X + 34} y1={TOP_RAIL_Y} x2={LOAD_X} y2={TOP_RAIL_Y} stroke="#3A4863" strokeWidth={2} />
        {/* Bottom rail: from AC(-) to bottom right */}
        <line x1={AC_CX} y1={BOT_RAIL_Y} x2={LOAD_X} y2={BOT_RAIL_Y} stroke="#3A4863" strokeWidth={2} />
        {/* AC-side verticals */}
        <line x1={AC_CX} y1={AC_CY - 22} x2={AC_CX} y2={TOP_RAIL_Y} stroke="#3A4863" strokeWidth={2} />
        <line x1={AC_CX} y1={AC_CY + 22} x2={AC_CX} y2={BOT_RAIL_Y} stroke="#3A4863" strokeWidth={2} />
        {/* Filter branch verticals (into the parallel slot) */}
        <line x1={FILTER_SLOT_X} y1={TOP_RAIL_Y} x2={FILTER_SLOT_X} y2={FILTER_SLOT_Y - 34} stroke="#3A4863" strokeWidth={2} />
        <line x1={FILTER_SLOT_X} y1={FILTER_SLOT_Y + 34} x2={FILTER_SLOT_X} y2={BOT_RAIL_Y} stroke="#3A4863" strokeWidth={2} />
        {/* Load branch verticals (through the resistor) */}
        <line x1={LOAD_X} y1={TOP_RAIL_Y} x2={LOAD_X} y2={AC_CY - 22} stroke="#3A4863" strokeWidth={2} />
        <line x1={LOAD_X} y1={AC_CY + 22} x2={LOAD_X} y2={BOT_RAIL_Y} stroke="#3A4863" strokeWidth={2} />
        {/* Junction dots at the branch splits */}
        <circle cx={FILTER_SLOT_X} cy={TOP_RAIL_Y} r={3} fill="#B9C4D6" />
        <circle cx={FILTER_SLOT_X} cy={BOT_RAIL_Y} r={3} fill="#B9C4D6" />
        <circle cx={LOAD_X} cy={TOP_RAIL_Y} r={3} fill="#B9C4D6" />
        <circle cx={LOAD_X} cy={BOT_RAIL_Y} r={3} fill="#B9C4D6" />

        {/* AC source symbol (fixed) */}
        <AcSourceSymbol cx={AC_CX} cy={AC_CY} label={`${params.U_max} V`} />

        {/* Load resistor R (fixed) */}
        <ResistorSymbol cx={LOAD_X} cy={AC_CY} orient="v" labelText={`R = ${params.R} Ω`} />

        {/* ─── Slots ─────────────────────────────────────── */}
        {/* Rectifier slot (horizontal) */}
        <g>
          {rectSlotEmpty ? (
            <rect
              x={RECT_SLOT_X - 34}
              y={RECT_SLOT_Y - 20}
              width={68}
              height={40}
              fill="none"
              stroke={dragHiOverEmpty(dragging) ? '#F97316' : '#3A4863'}
              strokeWidth={1.2}
              strokeDasharray="4 4"
              rx={4}
              opacity={0.85}
            />
          ) : (
            <g
              onPointerDown={(e) => slotIsEditable('rect') && onPointerDownSlot('rect', slots.rect!, e)}
              style={{ cursor: slotIsEditable('rect') ? 'grab' : 'default' }}
            >
              <rect x={RECT_SLOT_X - 36} y={RECT_SLOT_Y - 22} width={72} height={44} fill="transparent" />
              <ComponentGlyph kind={slots.rect!} cx={RECT_SLOT_X} cy={RECT_SLOT_Y} orient="h" />
            </g>
          )}
          {/* Stage-3 post-submit indicator on the rectifier slot */}
          {isStage3 && stage3Submitted && stage3Correct === true && (
            <circle cx={RECT_SLOT_X} cy={RECT_SLOT_Y} r={30} fill="none" stroke="#37C9B8" strokeWidth={2} opacity={0.9} />
          )}
          {isStage3 && stage3Submitted && stage3Correct === false && (
            <circle cx={RECT_SLOT_X} cy={RECT_SLOT_Y} r={30} fill="none" stroke="#EF4444" strokeWidth={2} opacity={0.85} />
          )}
        </g>

        {/* Filter slot (vertical) */}
        <g>
          {filterSlotEmpty ? (
            <rect
              x={FILTER_SLOT_X - 20}
              y={FILTER_SLOT_Y - 34}
              width={40}
              height={68}
              fill="none"
              stroke={dragHiOverEmpty(dragging) ? '#F97316' : '#3A4863'}
              strokeWidth={1.2}
              strokeDasharray="4 4"
              rx={4}
              opacity={slotIsEditable('filter') ? 0.85 : 0.35}
            />
          ) : (
            <g
              onPointerDown={(e) => slotIsEditable('filter') && onPointerDownSlot('filter', slots.filter!, e)}
              style={{ cursor: slotIsEditable('filter') ? 'grab' : 'default' }}
            >
              <rect x={FILTER_SLOT_X - 22} y={FILTER_SLOT_Y - 36} width={44} height={72} fill="transparent" />
              <ComponentGlyph kind={slots.filter!} cx={FILTER_SLOT_X} cy={FILTER_SLOT_Y} orient="v" />
            </g>
          )}
        </g>

        {/* ─── Live readouts (stages 1+2 only) ────────────── */}
        {!isStage3 && (
          <g>
            <text x={SCHEM_X + 12} y={SCHEM_Y + SCHEM_H - 10} fill="#B9C4D6" fontFamily="'JetBrains Mono', monospace" fontSize={11}>
              {labels.u_avg} = {sim.U_avg.toFixed(2)} {labels.unit_v}
            </text>
            <text x={SCHEM_X + 180} y={SCHEM_Y + SCHEM_H - 10} fill="#B9C4D6" fontFamily="'JetBrains Mono', monospace" fontSize={11}>
              {labels.u_ripple} = {sim.U_ripple.toFixed(2)} {labels.unit_v}
            </text>
            <text x={SCHEM_X + 360} y={SCHEM_Y + SCHEM_H - 10} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={10}>
              f_mains = {F_MAINS} {labels.unit_hz}
            </text>
          </g>
        )}

        {/* ─── Stage-3 target + parameter readouts (blind mode) ────── */}
        {isStage3 && (
          <g>
            {/* Params row inside the schematic panel bottom edge */}
            <text x={SCHEM_X + 12} y={SCHEM_Y + SCHEM_H - 10} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={11}>
              {labels.params}: {labels.u_max_label} = {params.U_max} {labels.unit_v}   {labels.r_label} = {params.R} {labels.unit_ohm}   {labels.c_label} ={' '}
              {params.C_uf > 0 ? `${params.C_uf} ${labels.unit_uf}` : labels.no_cap}
            </text>
          </g>
        )}

        {/* ─── Scope ──────────────────────────────────────── */}
        {!isStage3 ? (
          <ScopeTrace sim={sim} x={SCOPE_X} y={SCOPE_Y} width={SCOPE_W} height={SCOPE_H} />
        ) : (
          <BlindScopePanel
            x={SCOPE_X}
            y={SCOPE_Y}
            width={SCOPE_W}
            height={SCOPE_H}
            targetAvg={sim.U_avg}
            targetRipple={sim.U_ripple}
            labels={labels}
          />
        )}

        {/* ─── Stage-2 target labels overlay ──────────────── */}
        {isStage2 && (
          <g>
            <text x={SCOPE_X + 10} y={SCOPE_Y + SCOPE_H + 22} fill={hitTargetA ? '#37C9B8' : '#B9C4D6'} fontFamily="'JetBrains Mono', monospace" fontSize={11}>
              {labels.target_a_label}: {labels.target_a_req}
            </text>
            <text x={SCOPE_X + 260} y={SCOPE_Y + SCOPE_H + 22} fill={hitTargetB ? '#37C9B8' : '#B9C4D6'} fontFamily="'JetBrains Mono', monospace" fontSize={11}>
              {labels.target_b_label}: {labels.target_b_req}
            </text>
          </g>
        )}

        {/* ─── Palette items ──────────────────────────────── */}
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
              <ComponentGlyph kind={k} cx={0} cy={0} orient="h" />
              <text x={0} y={38} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={10} textAnchor="middle">
                {labels[`comp_${k}`] ?? k}
              </text>
            </g>
          )
        })}

        {/* ─── Drag ghost ─────────────────────────────────── */}
        {dragging && (
          <g transform={`translate(${dragging.x}, ${dragging.y})`} opacity={0.75} pointerEvents="none">
            <ComponentGlyph kind={dragging.comp} cx={0} cy={0} orient="h" />
          </g>
        )}

        {/* BR quadrant intentionally left empty — reserved for parent chrome. */}
      </svg>

      {/* HUD overlays — HTML, sized in rem */}
      <div style={{ position: 'absolute', top: '3rem', left: '3rem', fontFamily: "'JetBrains Mono', monospace", fontSize: '2.3rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: '#6C7A93', zIndex: 5, pointerEvents: 'none' }}>
        {hudTL}
      </div>
      <div style={{ position: 'absolute', top: '3rem', right: '3rem', fontFamily: "'JetBrains Mono', monospace", fontSize: '1.5rem', letterSpacing: '0.08em', color: canSubmit ? '#37C9B8' : '#B9C4D6', zIndex: 5, pointerEvents: 'none', textAlign: 'right', maxWidth: '38%' }}>
        {hudTR}
      </div>
      <div style={{ position: 'absolute', bottom: '3rem', left: '3rem', fontFamily: "'JetBrains Mono', monospace", fontSize: '1.8rem', letterSpacing: '0.06em', color: peekText ? '#F9A968' : '#6C7A93', zIndex: 5, pointerEvents: 'none', maxWidth: '58%', lineHeight: 1.35 }}>
        {hudBL}
      </div>
      {/* BR HUD: intentionally omitted — reserved for parent chrome (§4.3). */}
    </div>
  )
}

// ─── Scope trace renderer ───────────────────────────────────────────────
function ScopeTrace({
  sim,
  x,
  y,
  width,
  height,
}: {
  sim: { samples: number[]; times: number[]; U_avg: number; U_ripple: number; windowMs: number }
  x: number
  y: number
  width: number
  height: number
}) {
  const inset = 12
  const traceX0 = x + inset
  const traceX1 = x + width - inset
  const traceY0 = y + inset
  const traceY1 = y + height - inset
  const traceW = traceX1 - traceX0
  const traceH = traceY1 - traceY0

  // y-scale spans −vRange..+vRange centered on 0 (unfiltered can go negative if rect='none')
  const maxAbs = Math.max(
    1,
    ...sim.samples.map((v) => Math.abs(v)),
    sim.U_avg + sim.U_ripple / 2,
  )
  const vTop = Math.ceil(maxAbs)
  const vBot = -Math.max(0, -Math.min(...sim.samples))
  const vSpan = Math.max(1, vTop - vBot)
  const yFor = (v: number) => traceY1 - ((v - vBot) / vSpan) * traceH
  const xFor = (i: number) => traceX0 + (i / Math.max(1, sim.samples.length - 1)) * traceW

  const path = sim.samples
    .map((v, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i).toFixed(1)} ${yFor(v).toFixed(1)}`)
    .join(' ')

  // Baseline at 0 V and at U_avg
  const zeroY = yFor(0)
  const avgY = yFor(sim.U_avg)

  return (
    <g>
      {/* Axes */}
      <line x1={traceX0} y1={traceY0} x2={traceX0} y2={traceY1} stroke="#233149" strokeWidth={1} />
      <line x1={traceX0} y1={zeroY} x2={traceX1} y2={zeroY} stroke="#233149" strokeWidth={1} strokeDasharray="2 4" />
      {/* Average line */}
      <line x1={traceX0} y1={avgY} x2={traceX1} y2={avgY} stroke="#37C9B8" strokeWidth={1} strokeDasharray="1 3" opacity={0.6} />
      {/* Trace */}
      <path d={path} fill="none" stroke="#F9A968" strokeWidth={1.5} />
      {/* Scale labels */}
      <text x={traceX0 - 6} y={traceY0 + 8} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={9} textAnchor="end">
        {vTop.toFixed(0)}V
      </text>
      <text x={traceX0 - 6} y={zeroY + 4} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={9} textAnchor="end">
        0
      </text>
      <text x={traceX1} y={traceY1 + 14} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={9} textAnchor="end">
        {sim.windowMs.toFixed(0)} ms
      </text>
    </g>
  )
}

// ─── Blind scope panel (stage 3) ────────────────────────────────────────
function BlindScopePanel({
  x,
  y,
  width,
  height,
  targetAvg,
  targetRipple,
  labels,
}: {
  x: number
  y: number
  width: number
  height: number
  targetAvg: number
  targetRipple: number
  labels: Record<string, string>
}) {
  const cx = x + width / 2
  const rowY = y + height / 2 - 6
  return (
    <g>
      <text x={cx} y={y + 24} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={10} textAnchor="middle" letterSpacing="0.14em">
        {labels.target} · {labels.hidden}
      </text>
      <text x={cx - 90} y={rowY} fill="#B9C4D6" fontFamily="'JetBrains Mono', monospace" fontSize={13} textAnchor="middle">
        {labels.u_avg} = {targetAvg.toFixed(2)} {labels.unit_v}
      </text>
      <text x={cx + 90} y={rowY} fill="#B9C4D6" fontFamily="'JetBrains Mono', monospace" fontSize={13} textAnchor="middle">
        {labels.u_ripple} = {targetRipple.toFixed(2)} {labels.unit_v}
      </text>
      <text x={cx} y={y + height - 12} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={9} textAnchor="middle">
        {labels.current}: {labels.hidden}
      </text>
    </g>
  )
}

// ─── Component-glyph dispatcher ─────────────────────────────────────────
function ComponentGlyph({
  kind,
  cx,
  cy,
  orient,
}: {
  kind: PaletteKind
  cx: number
  cy: number
  orient: 'h' | 'v'
}) {
  const rot = orient === 'v' ? 90 : 0
  return (
    <g transform={`translate(${cx}, ${cy}) rotate(${rot})`}>
      {kind === 'half' && <HalfDiodeSymbol />}
      {kind === 'bridge' && <BridgeSymbol />}
      {kind === 'cap' && <CapacitorSymbol />}
      {kind === 'wire' && <WireSymbol />}
    </g>
  )
}

// ─── Component symbols ──────────────────────────────────────────────────
function AcSourceSymbol({ cx, cy, label }: { cx: number; cy: number; label: string }) {
  return (
    <g transform={`translate(${cx}, ${cy})`}>
      <circle cx={0} cy={0} r={22} fill="#131F35" stroke="#54617A" strokeWidth={1.4} />
      {/* Sine glyph */}
      <path d={`M -12 0 Q -6 -10 0 0 T 12 0`} fill="none" stroke="#B9C4D6" strokeWidth={1.6} />
      <text x={0} y={38} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={10} textAnchor="middle">
        AC {label}
      </text>
    </g>
  )
}

function HalfDiodeSymbol() {
  // triangle points to the right (anode → cathode) with the bar at x=10
  return (
    <g>
      <line x1={-32} y1={0} x2={-12} y2={0} stroke="#54617A" strokeWidth={2} />
      <line x1={12} y1={0} x2={32} y2={0} stroke="#54617A" strokeWidth={2} />
      <polygon points="-12,-10 -12,10 10,0" fill="#F9A968" stroke="#F9A968" strokeWidth={1} />
      <line x1={10} y1={-10} x2={10} y2={10} stroke="#B9C4D6" strokeWidth={2} />
    </g>
  )
}

function BridgeSymbol() {
  // Small rhombus with a diode glyph inside — represents the 4-diode bridge as a block
  return (
    <g>
      <line x1={-32} y1={0} x2={-16} y2={0} stroke="#54617A" strokeWidth={2} />
      <line x1={16} y1={0} x2={32} y2={0} stroke="#54617A" strokeWidth={2} />
      <polygon
        points="-16,0 0,-14 16,0 0,14"
        fill="#131F35"
        stroke="#54617A"
        strokeWidth={1.4}
      />
      {/* Small ± indicators inside */}
      <text x={-8} y={3} fill="#F9A968" fontFamily="'JetBrains Mono', monospace" fontSize={8} textAnchor="middle" fontWeight={700}>
        ~
      </text>
      <text x={8} y={3} fill="#7EE3D8" fontFamily="'JetBrains Mono', monospace" fontSize={8} textAnchor="middle" fontWeight={700}>
        =
      </text>
    </g>
  )
}

function CapacitorSymbol() {
  return (
    <g>
      <line x1={-32} y1={0} x2={-4} y2={0} stroke="#54617A" strokeWidth={2} />
      <line x1={4} y1={0} x2={32} y2={0} stroke="#54617A" strokeWidth={2} />
      {/* Two parallel plates */}
      <line x1={-4} y1={-13} x2={-4} y2={13} stroke="#B9C4D6" strokeWidth={2.4} />
      <line x1={4} y1={-13} x2={4} y2={13} stroke="#B9C4D6" strokeWidth={2.4} />
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

function ResistorSymbol({
  cx,
  cy,
  orient,
  labelText,
}: {
  cx: number
  cy: number
  orient: 'h' | 'v'
  labelText: string
}) {
  const rot = orient === 'v' ? 90 : 0
  return (
    <g transform={`translate(${cx}, ${cy}) rotate(${rot})`}>
      <line x1={-32} y1={0} x2={-18} y2={0} stroke="#54617A" strokeWidth={2} />
      <line x1={18} y1={0} x2={32} y2={0} stroke="#54617A" strokeWidth={2} />
      <rect x={-18} y={-8} width={36} height={16} fill="#131F35" stroke="#54617A" strokeWidth={1.4} />
      {/* Label goes to the side; we render it in the un-rotated frame via counter-rotation
          so it stays horizontal regardless of orient. */}
      <g transform={`rotate(${-rot})`}>
        <text
          x={orient === 'v' ? 30 : 0}
          y={orient === 'v' ? 4 : -14}
          fill="#B9C4D6"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={10}
          textAnchor={orient === 'v' ? 'start' : 'middle'}
        >
          {labelText}
        </text>
      </g>
    </g>
  )
}
