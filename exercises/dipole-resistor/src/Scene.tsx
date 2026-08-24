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

// ─── Scene constants ────────────────────────────────────────
const W = 800
const H = 450

// Layout: schematic (left) · scatter plot (middle) · palette (right)
const SCHEM_X0 = 32
const SCHEM_X1 = 300
const SCHEM_Y0 = 60
const SCHEM_Y1 = 418

const PLOT_X0 = 316
const PLOT_X1 = 592
const PLOT_Y0 = 60
const PLOT_Y1 = 418

const PAL_X0 = 608
const PAL_X1 = 768
const PAL_Y0 = 60
const PAL_Y1 = 418

// Loop rectangle (world coords) — single-slot dipole schematic
const LOOP_LEFT = 90
const LOOP_RIGHT = 240
const LOOP_TOP = 140
const LOOP_BOTTOM = 340
const SLOT_HIT_RADIUS = 55

// Resistor slot is at the right side of the loop (index 1 in 4-slot layout).
// Battery = left. Ammeter = bottom. Wire = top (drawn structural).
const RES_SLOT_X = LOOP_RIGHT
const RES_SLOT_Y = (LOOP_TOP + LOOP_BOTTOM) / 2
const AMM_X = (LOOP_LEFT + LOOP_RIGHT) / 2
const AMM_Y = LOOP_BOTTOM
const BAT_X = LOOP_LEFT
const BAT_Y = (LOOP_TOP + LOOP_BOTTOM) / 2

// ─── Component types ────────────────────────────────────────
type ResKind = 'r47' | 'r100' | 'r220' | 'lamp'
type Slot = ResKind | null

const RES_OHMS: Record<Exclude<ResKind, 'lamp'>, number> = {
  r47: 47,
  r100: 100,
  r220: 220,
}

// ─── Physics ────────────────────────────────────────────────
// Ideal battery + resistor: U_across_R = E, I = E / R
// Non-ohmic lamp: empirical I(U) = k * U^0.6 (mA) with k chosen so
//   I(12V) ~= 190 mA. Curve on I(U) plot.
function currentMilliAmps(kind: ResKind, E: number): number {
  if (kind === 'lamp') {
    return E > 0 ? 45 * Math.pow(E, 0.6) : 0
  }
  const R = RES_OHMS[kind]
  return (E / R) * 1000
}

// ─── Stage-2 targets (hand-authored, not RNG) ───────────────
type Target = { kind: Exclude<ResKind, 'lamp'>; targetI_mA: number; label: string }
const TARGETS: Target[] = [
  { kind: 'r47', targetI_mA: 100, label: 'R = 47 Ω · I = 100 mA' },
  { kind: 'r100', targetI_mA: 60, label: 'R = 100 Ω · I = 60 mA' },
]
const TARGET_TOL = 0.05 // ±5%

// ─── Stage-3 puzzles (seeded pick) ──────────────────────────
type Puzzle = {
  hiddenR: Exclude<ResKind, 'lamp'>
  palette: ResKind[] // correct + 2 decoys
  // Scatter points to show as "measurements taken with unknown R":
  points: { U: number; I: number }[]
}
const PUZZLE_U_SAMPLES = [2, 4, 6, 8, 10]

function makePuzzle(hidden: Exclude<ResKind, 'lamp'>, palette: ResKind[]): Puzzle {
  const R = RES_OHMS[hidden]
  return {
    hiddenR: hidden,
    palette,
    points: PUZZLE_U_SAMPLES.map((U) => ({ U, I: (U / R) * 1000 })),
  }
}

const PUZZLES: Puzzle[] = [
  makePuzzle('r47', ['r47', 'r100', 'r220']),
  makePuzzle('r100', ['r100', 'r220', 'r47']),
  makePuzzle('r220', ['r220', 'r47', 'r100']),
]

// ─── i18n loader ─────────────────────────────────────────────
const dict = { en } as const
type Locale = keyof typeof dict
function svgLabels(locale: string): Record<string, string> {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels as Record<string, string>
}

// ─── Plot projection helpers ────────────────────────────────
const PLOT_PAD_L = 44
const PLOT_PAD_R = 16
const PLOT_PAD_T = 32
const PLOT_PAD_B = 40
const PLOT_INNER_X0 = PLOT_X0 + PLOT_PAD_L
const PLOT_INNER_X1 = PLOT_X1 - PLOT_PAD_R
const PLOT_INNER_Y0 = PLOT_Y0 + PLOT_PAD_T
const PLOT_INNER_Y1 = PLOT_Y1 - PLOT_PAD_B
const U_MAX = 12
const I_MAX_MA = 220

function projU(U: number): number {
  return PLOT_INNER_X0 + (Math.max(0, Math.min(U_MAX, U)) / U_MAX) * (PLOT_INNER_X1 - PLOT_INNER_X0)
}
function projI(I: number): number {
  return PLOT_INNER_Y1 - (Math.max(0, Math.min(I_MAX_MA, I)) / I_MAX_MA) * (PLOT_INNER_Y1 - PLOT_INNER_Y0)
}

// Colors per resistor kind for scatter points on stages 1/2
const KIND_COLOR: Record<ResKind, string> = {
  r47: '#F97316',
  r100: '#37C9B8',
  r220: '#7EAAF9',
  lamp: '#F9A968',
}

// ─── Slider constants ────────────────────────────────────────
const SLIDER_TRACK_X0 = PAL_X0 + 20
const SLIDER_TRACK_X1 = PAL_X1 - 20
const SLIDER_TRACK_Y = 348
const SLIDER_KNOB_R = 8
const E_MIN = 0
const E_MAX = 12

function knobX(E: number): number {
  return SLIDER_TRACK_X0 + (E / E_MAX) * (SLIDER_TRACK_X1 - SLIDER_TRACK_X0)
}

// ─── Component ──────────────────────────────────────────────
export default function Scene() {
  const { locale, seed } = useInit()
  const stages = useMemo(() => getStagesFor(locale), [locale])
  useDeclareStages(stages)
  const labels = useMemo(() => svgLabels(locale), [locale])

  const puzzle = useMemo(() => PUZZLES[seed % PUZZLES.length]!, [seed])

  const stageIdx = useCurrentStage()
  const setStage = useSetStage()
  const complete = useComplete()
  const progress = useProgress()

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  // ─── Slot + voltage state ─────────────────────────────────
  const [slot, setSlot] = useState<Slot>(null)
  const [E, setE] = useState<number>(0)

  // ─── Scatter accumulator (stages 1+2 only) ────────────────
  const [points, setPoints] = useState<{ U: number; I: number; kind: ResKind }[]>([])

  // ─── Stage-1 coverage ─────────────────────────────────────
  const [triedRs, setTriedRs] = useState<Set<ResKind>>(new Set())
  const [triedEs, setTriedEs] = useState<Set<number>>(new Set())

  // ─── Stage-2 target flags ─────────────────────────────────
  const [t0Hit, setT0Hit] = useState(false)
  const [t1Hit, setT1Hit] = useState(false)

  // ─── Stage-3 blind state ──────────────────────────────────
  const [stage3Submitted, setStage3Submitted] = useState(false)
  const [stage3Correct, setStage3Correct] = useState<boolean | null>(null)
  const [stage3AttemptsLeft, setStage3AttemptsLeft] = useState(1)

  // ─── Live physics ─────────────────────────────────────────
  const I_mA = slot ? currentMilliAmps(slot, E) : 0
  const U_V = slot ? E : 0

  // ─── Stage-1 coverage tracking ────────────────────────────
  useEffect(() => {
    if (!isStage1) return
    if (slot && !triedRs.has(slot)) {
      setTriedRs((prev) => {
        const next = new Set(prev)
        next.add(slot)
        return next
      })
    }
    if (E > 0) {
      const bucket = Math.round(E * 2) / 2 // 0.5V buckets
      if (!triedEs.has(bucket)) {
        setTriedEs((prev) => {
          const next = new Set(prev)
          next.add(bucket)
          return next
        })
      }
    }
  }, [isStage1, slot, E, triedRs, triedEs])

  // ─── Scatter accumulator (stages 1+2) ─────────────────────
  useEffect(() => {
    if (isStage3) return
    if (!slot || E <= 0) return
    setPoints((prev) => {
      // Dedup by rounded (U, kind) — one point per distinct voltage per resistor
      const roundedU = Math.round(E * 4) / 4
      if (prev.some((p) => p.kind === slot && Math.abs(p.U - roundedU) < 0.001)) return prev
      const next = prev.slice()
      next.push({ U: roundedU, I: currentMilliAmps(slot, roundedU), kind: slot })
      // Cap trail length to keep the plot readable
      if (next.length > 80) next.shift()
      return next
    })
  }, [slot, E, isStage3])

  // ─── Stage-2 target tracking ──────────────────────────────
  useEffect(() => {
    if (!isStage2 || !slot || slot === 'lamp') return
    for (let i = 0; i < TARGETS.length; i++) {
      const t = TARGETS[i]!
      if (slot !== t.kind) continue
      const err = Math.abs(I_mA - t.targetI_mA) / t.targetI_mA
      if (err < TARGET_TOL) {
        if (i === 0 && !t0Hit) setT0Hit(true)
        if (i === 1 && !t1Hit) setT1Hit(true)
      }
    }
  }, [isStage2, slot, I_mA, t0Hit, t1Hit])

  // ─── Advance predicates ───────────────────────────────────
  const stage1Done = triedRs.size >= 2 && triedEs.size >= 2 && I_mA > 0.001
  const stage2Done = t0Hit && t1Hit
  const stage3Done = stage3Correct === true
  const canSubmit = isStage1 ? stage1Done : isStage2 ? stage2Done : stage3Done

  // ─── Reset ────────────────────────────────────────────────
  const resetStageState = useCallback(() => {
    setSlot(null)
    setE(0)
    setPoints([])
    setTriedRs(new Set())
    setTriedEs(new Set())
    setT0Hit(false)
    setT1Hit(false)
    setStage3Submitted(false)
    setStage3Correct(null)
    setStage3AttemptsLeft(1)
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

  // ─── Peek (strategy hint text — never a component ghost) ──
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

  // ─── Stage-3 submit ───────────────────────────────────────
  const submitStage3 = useCallback((placed: ResKind) => {
    const correct = placed === puzzle.hiddenR
    setStage3Submitted(true)
    setStage3Correct(correct)
    if (!correct) {
      setStage3AttemptsLeft((n) => {
        const nextN = Math.max(0, n - 1)
        // Single-attempt puzzle: reset after brief flash for another go
        // (seed-picked puzzle stays the same until Reset button rotates seed via chrome).
        setTimeout(() => {
          setSlot(null)
          setStage3Submitted(false)
          setStage3Correct(null)
          setStage3AttemptsLeft(1)
        }, 1400)
        return nextN
      })
    }
  }, [puzzle.hiddenR])

  // ─── Drag machinery ───────────────────────────────────────
  type DraggingState = { kind: ResKind; x: number; y: number }
  const [dragging, setDragging] = useState<DraggingState | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  // Slider drag
  const [sliderActive, setSliderActive] = useState(false)

  const clientToSvg = (svg: SVGSVGElement, clientX: number, clientY: number) => {
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

  const onPointerDownPalette = useCallback((kind: ResKind, e: React.PointerEvent<SVGElement>) => {
    e.stopPropagation()
    const svg = e.currentTarget.ownerSVGElement
    if (!svg) return
    ;(e.currentTarget as SVGElement).setPointerCapture(e.pointerId)
    const pos = clientToSvg(svg, e.clientX, e.clientY)
    setDragging({ kind, x: pos.x, y: pos.y })
  }, [])

  const onPointerDownSlot = useCallback((e: React.PointerEvent<SVGElement>) => {
    e.stopPropagation()
    if (!slot) return
    // Stage 3: dragging a placed component out is disallowed (single-attempt commit).
    if (isStage3 && stage3Submitted) return
    ;(e.currentTarget as SVGElement).setPointerCapture(e.pointerId)
    // Immediately lift the slot into a drag so the student can move/discard it.
    const svg = e.currentTarget.ownerSVGElement
    if (!svg) return
    const pos = clientToSvg(svg, e.clientX, e.clientY)
    setDragging({ kind: slot, x: pos.x, y: pos.y })
    setSlot(null)
  }, [slot, isStage3, stage3Submitted])

  const onPointerDownSlider = useCallback((e: React.PointerEvent<SVGElement>) => {
    if (isStage3) return
    e.stopPropagation()
    ;(e.currentTarget as SVGElement).setPointerCapture(e.pointerId)
    setSliderActive(true)
    const svg = e.currentTarget.ownerSVGElement
    if (!svg) return
    const pos = clientToSvg(svg, e.clientX, e.clientY)
    const t = (pos.x - SLIDER_TRACK_X0) / (SLIDER_TRACK_X1 - SLIDER_TRACK_X0)
    const nextE = Math.max(E_MIN, Math.min(E_MAX, t * E_MAX))
    setE(Math.round(nextE * 10) / 10)
  }, [isStage3])

  const onPointerMove = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (sliderActive) {
      const pos = clientToSvg(e.currentTarget, e.clientX, e.clientY)
      const t = (pos.x - SLIDER_TRACK_X0) / (SLIDER_TRACK_X1 - SLIDER_TRACK_X0)
      const nextE = Math.max(E_MIN, Math.min(E_MAX, t * E_MAX))
      setE(Math.round(nextE * 10) / 10)
      return
    }
    if (!dragging) return
    const pos = clientToSvg(e.currentTarget, e.clientX, e.clientY)
    setDragging((prev) => (prev ? { ...prev, x: pos.x, y: pos.y } : null))
  }, [dragging, sliderActive])

  const onPointerUp = useCallback((_e: React.PointerEvent<SVGSVGElement>) => {
    if (sliderActive) {
      setSliderActive(false)
      return
    }
    if (!dragging) return
    const dx = dragging.x - RES_SLOT_X
    const dy = dragging.y - RES_SLOT_Y
    const dist = Math.hypot(dx, dy)
    if (dist < SLOT_HIT_RADIUS) {
      setSlot(dragging.kind)
      if (isStage3 && !stage3Submitted) {
        // Auto-submit on placement (single-attempt commit).
        const placed = dragging.kind
        setTimeout(() => submitStage3(placed), 0)
      }
    }
    // else: dropped off-slot → discarded (slot stays null / current)
    setDragging(null)
  }, [dragging, sliderActive, isStage3, stage3Submitted, submitStage3])

  // ─── Palette items ────────────────────────────────────────
  const paletteItems: ResKind[] = isStage3
    ? (puzzle.palette as ResKind[])
    : (['r47', 'r100', 'r220', 'lamp'] as ResKind[])
  const paletteYStart = 92
  const paletteStep = isStage3 ? 76 : 60

  // ─── Scatter points shown ─────────────────────────────────
  const shownPoints: { U: number; I: number; kind: ResKind | 'unknown' }[] = isStage3
    ? puzzle.points.map((p) => ({ U: p.U, I: p.I, kind: 'unknown' as const }))
    : points

  // ─── HUD text ─────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`
  const hudTR = isStage1
    ? `${triedRs.size >= 2 ? '✓' : '·'} ${labels.seen_r} ${triedRs.size}/2   ${triedEs.size >= 2 ? '✓' : '·'} ${labels.seen_e} ${triedEs.size}/2`
    : isStage2
      ? `${labels.targets}: ${(t0Hit ? 1 : 0) + (t1Hit ? 1 : 0)}/${TARGETS.length}`
      : stage3Submitted
        ? (stage3Correct
            ? labels.correct
            : `${labels.wrong}  ${labels.attempts_left}: ${stage3AttemptsLeft}`)
        : labels.place_resistor

  const hudBL = isStage3
    ? (peekText ?? labels.tip3)
    : isStage2
      ? labels.tip2
      : labels.tip1

  // Compose stage-2 target chips text
  const targetChipsText = TARGETS.map((t, i) => {
    const hit = i === 0 ? t0Hit : t1Hit
    return `${hit ? '✓' : '·'} ${labels.target_prefix}${i + 1}: ${t.label}`
  })

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
        <rect x={SCHEM_X0} y={SCHEM_Y0} width={SCHEM_X1 - SCHEM_X0} height={SCHEM_Y1 - SCHEM_Y0} fill="none" stroke="#12203a" strokeWidth={1} rx={6} />
        <text x={SCHEM_X0 + 8} y={SCHEM_Y0 - 8} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={11} letterSpacing="0.1em">
          {labels.schematic}
        </text>

        {/* Plot panel */}
        <rect x={PLOT_X0} y={PLOT_Y0} width={PLOT_X1 - PLOT_X0} height={PLOT_Y1 - PLOT_Y0} fill="none" stroke="#12203a" strokeWidth={1} rx={6} />
        <text x={PLOT_X0 + 8} y={PLOT_Y0 - 8} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={11} letterSpacing="0.1em">
          {labels.plot}
        </text>

        {/* Palette panel */}
        <rect x={PAL_X0} y={PAL_Y0} width={PAL_X1 - PAL_X0} height={PAL_Y1 - PAL_Y0} fill="none" stroke="#12203a" strokeWidth={1} rx={6} />
        <text x={PAL_X0 + 8} y={PAL_Y0 - 8} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={11} letterSpacing="0.1em">
          {labels.palette}
        </text>

        {/* ─── Schematic: loop wires + fixed components ─── */}
        <g>
          {/* Corner dots */}
          {[[LOOP_LEFT, LOOP_TOP], [LOOP_RIGHT, LOOP_TOP], [LOOP_RIGHT, LOOP_BOTTOM], [LOOP_LEFT, LOOP_BOTTOM]].map(
            ([x, y], i) => <circle key={`c${i}`} cx={x} cy={y} r={2.5} fill="#3A4863" />
          )}
          {/* Top wire (structural, always drawn) */}
          <line x1={LOOP_LEFT} y1={LOOP_TOP} x2={LOOP_RIGHT} y2={LOOP_TOP} stroke="#3A4863" strokeWidth={2} />
          {/* Right side: two stubs bracketing the resistor slot */}
          <line x1={LOOP_RIGHT} y1={LOOP_TOP} x2={RES_SLOT_X} y2={RES_SLOT_Y - 22} stroke="#3A4863" strokeWidth={2} />
          <line x1={LOOP_RIGHT} y1={LOOP_BOTTOM} x2={RES_SLOT_X} y2={RES_SLOT_Y + 22} stroke="#3A4863" strokeWidth={2} />
          {/* Bottom: two stubs bracketing the ammeter */}
          <line x1={LOOP_LEFT} y1={LOOP_BOTTOM} x2={AMM_X - 22} y2={LOOP_BOTTOM} stroke="#3A4863" strokeWidth={2} />
          <line x1={AMM_X + 22} y1={LOOP_BOTTOM} x2={LOOP_RIGHT} y2={LOOP_BOTTOM} stroke="#3A4863" strokeWidth={2} />
          {/* Left side: two stubs bracketing the battery */}
          <line x1={LOOP_LEFT} y1={LOOP_TOP} x2={BAT_X} y2={BAT_Y - 22} stroke="#3A4863" strokeWidth={2} />
          <line x1={LOOP_LEFT} y1={LOOP_BOTTOM} x2={BAT_X} y2={BAT_Y + 22} stroke="#3A4863" strokeWidth={2} />
        </g>

        {/* Battery (fixed, left, vertical) */}
        <g transform={`translate(${BAT_X}, ${BAT_Y}) rotate(90)`}>
          <BatterySymbol />
        </g>

        {/* Ammeter (fixed, bottom, horizontal). Reading hidden on stage 3 pre-submit. */}
        <g transform={`translate(${AMM_X}, ${AMM_Y})`}>
          <AmmeterSymbol />
        </g>
        {!isStage3 && slot && (
          <text
            x={AMM_X}
            y={AMM_Y + 30}
            fill={I_mA > 0.5 ? '#37C9B8' : '#6C7A93'}
            fontFamily="'JetBrains Mono', monospace"
            fontSize={12}
            textAnchor="middle"
          >
            I = {I_mA.toFixed(1)} mA
          </text>
        )}
        {isStage3 && stage3Submitted && stage3Correct && (
          <text
            x={AMM_X}
            y={AMM_Y + 30}
            fill="#37C9B8"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={12}
            textAnchor="middle"
          >
            I = {currentMilliAmps(puzzle.hiddenR, 6).toFixed(1)} mA @ 6 V
          </text>
        )}

        {/* Resistor slot */}
        {slot === null && (
          <rect
            x={RES_SLOT_X - 18}
            y={RES_SLOT_Y - 30}
            width={36}
            height={60}
            fill="none"
            stroke={dragging ? '#F97316' : '#3A4863'}
            strokeWidth={1.2}
            strokeDasharray="4 4"
            rx={4}
            opacity={0.85}
          />
        )}
        {slot !== null && (
          <g
            onPointerDown={onPointerDownSlot}
            style={{ cursor: isStage3 && stage3Submitted ? 'default' : 'grab' }}
          >
            <rect x={RES_SLOT_X - 20} y={RES_SLOT_Y - 34} width={40} height={68} fill="transparent" />
            <g transform={`translate(${RES_SLOT_X}, ${RES_SLOT_Y}) rotate(90)`}>
              {slot === 'lamp'
                ? <LampSymbol lit={I_mA > 0.5 && !isStage3} />
                : <ResistorSymbol label={slot === 'r47' ? '47Ω' : slot === 'r100' ? '100Ω' : '220Ω'} />}
            </g>
          </g>
        )}

        {/* Voltmeter-like label (U across resistor) — shown on stages 1+2 only. */}
        {!isStage3 && slot && (
          <text
            x={RES_SLOT_X + 34}
            y={RES_SLOT_Y - 4}
            fill="#B9C4D6"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={11}
          >
            U = {U_V.toFixed(1)} V
          </text>
        )}
        {/* Stage-3 wrong-answer flash */}
        {isStage3 && stage3Submitted && stage3Correct === false && (
          <circle cx={RES_SLOT_X} cy={RES_SLOT_Y} r={30} fill="none" stroke="#EF4444" strokeWidth={2} opacity={0.85} />
        )}
        {/* Stage-3 correct-answer flash */}
        {isStage3 && stage3Submitted && stage3Correct === true && (
          <circle cx={RES_SLOT_X} cy={RES_SLOT_Y} r={30} fill="none" stroke="#37C9B8" strokeWidth={2} opacity={0.9} />
        )}

        {/* ─── Formula strip (help — stages 1+2 only) ─── */}
        {!isStage3 && slot && slot !== 'lamp' && (
          <text
            x={SCHEM_X0 + 14}
            y={SCHEM_Y1 - 18}
            fill="#6C7A93"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={11}
          >
            U = R·I = {RES_OHMS[slot]}·{(I_mA / 1000).toFixed(3)} = {U_V.toFixed(2)} V
          </text>
        )}
        {!isStage3 && slot === 'lamp' && (
          <text
            x={SCHEM_X0 + 14}
            y={SCHEM_Y1 - 18}
            fill="#6C7A93"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={11}
          >
            lamp: I(U) is non-linear
          </text>
        )}

        {/* ─── Scatter plot ─── */}
        <ScatterPlot
          points={shownPoints}
          currentPoint={!isStage3 && slot ? { U: U_V, I: I_mA, kind: slot } : null}
          hideKindColor={isStage3}
        />

        {/* ─── Palette items ─── */}
        {paletteItems.map((k, i) => {
          const y = paletteYStart + i * paletteStep
          return (
            <g
              key={k}
              transform={`translate(${(PAL_X0 + PAL_X1) / 2}, ${y})`}
              style={{ cursor: 'grab' }}
              onPointerDown={(e) => onPointerDownPalette(k, e)}
            >
              <rect x={-58} y={-22} width={116} height={44} fill="#131F35" stroke="#3A4863" strokeWidth={1} rx={4} />
              {k === 'lamp'
                ? <LampSymbol lit={false} />
                : <ResistorSymbol label={k === 'r47' ? '47Ω' : k === 'r100' ? '100Ω' : '220Ω'} />}
              <text x={0} y={34} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={10} textAnchor="middle">
                {labels[`comp_${k}`] ?? k}
              </text>
            </g>
          )
        })}

        {/* ─── E slider (stages 1+2 only) ─── */}
        {!isStage3 && (
          <g>
            <text
              x={(PAL_X0 + PAL_X1) / 2}
              y={SLIDER_TRACK_Y - 26}
              fill="#6C7A93"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={11}
              textAnchor="middle"
              letterSpacing="0.06em"
            >
              {labels.voltage}
            </text>
            {/* Track hit area (wider than visible track for easy grabbing) */}
            <rect
              x={SLIDER_TRACK_X0 - 4}
              y={SLIDER_TRACK_Y - 14}
              width={SLIDER_TRACK_X1 - SLIDER_TRACK_X0 + 8}
              height={28}
              fill="transparent"
              onPointerDown={onPointerDownSlider}
              style={{ cursor: 'pointer' }}
            />
            <line
              x1={SLIDER_TRACK_X0}
              y1={SLIDER_TRACK_Y}
              x2={SLIDER_TRACK_X1}
              y2={SLIDER_TRACK_Y}
              stroke="#3A4863"
              strokeWidth={2}
            />
            {/* Filled part */}
            <line
              x1={SLIDER_TRACK_X0}
              y1={SLIDER_TRACK_Y}
              x2={knobX(E)}
              y2={SLIDER_TRACK_Y}
              stroke="#37C9B8"
              strokeWidth={2}
            />
            {/* Knob */}
            <circle
              cx={knobX(E)}
              cy={SLIDER_TRACK_Y}
              r={SLIDER_KNOB_R}
              fill="#0D1524"
              stroke="#37C9B8"
              strokeWidth={2}
              onPointerDown={onPointerDownSlider}
              style={{ cursor: 'grab' }}
            />
            <text
              x={(PAL_X0 + PAL_X1) / 2}
              y={SLIDER_TRACK_Y + 26}
              fill="#B9C4D6"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={12}
              textAnchor="middle"
            >
              E = {E.toFixed(1)} V
            </text>
          </g>
        )}

        {/* ─── Stage-2 target chips (right side of plot panel, top) ─── */}
        {isStage2 && (
          <g>
            {targetChipsText.map((txt, i) => (
              <text
                key={i}
                x={PLOT_X1 - 8}
                y={PLOT_Y0 + 20 + i * 16}
                fill={((i === 0 && t0Hit) || (i === 1 && t1Hit)) ? '#37C9B8' : '#B9C4D6'}
                fontFamily="'JetBrains Mono', monospace"
                fontSize={11}
                textAnchor="end"
              >
                {txt}
              </text>
            ))}
          </g>
        )}

        {/* ─── Stage-3: "unknown R" watermark in schematic ─── */}
        {isStage3 && !stage3Submitted && (
          <text
            x={SCHEM_X0 + 14}
            y={SCHEM_Y1 - 18}
            fill="#6C7A93"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={11}
          >
            {labels.unknown_r}
          </text>
        )}

        {/* ─── Drag ghost ─── */}
        {dragging && (
          <g transform={`translate(${dragging.x}, ${dragging.y})`} opacity={0.75} pointerEvents="none">
            {dragging.kind === 'lamp'
              ? <LampSymbol lit={false} />
              : <ResistorSymbol label={dragging.kind === 'r47' ? '47Ω' : dragging.kind === 'r100' ? '100Ω' : '220Ω'} />}
          </g>
        )}

        {/* BR quadrant (x > 600 && y > 350) intentionally free — parent chrome. */}
      </svg>

      {/* HUD overlays */}
      <div style={{ position: 'absolute', top: '3rem', left: '3rem', fontFamily: "'JetBrains Mono', monospace", fontSize: '2.3rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: '#6C7A93', zIndex: 5, pointerEvents: 'none' }}>
        {hudTL}
      </div>
      <div style={{ position: 'absolute', top: '3rem', right: '3rem', fontFamily: "'JetBrains Mono', monospace", fontSize: '1.5rem', letterSpacing: '0.08em', color: canSubmit ? '#37C9B8' : '#B9C4D6', zIndex: 5, pointerEvents: 'none', textAlign: 'right', maxWidth: '40%' }}>
        {hudTR}
      </div>
      <div style={{ position: 'absolute', bottom: '3rem', left: '3rem', fontFamily: "'JetBrains Mono', monospace", fontSize: '1.7rem', letterSpacing: '0.06em', color: '#6C7A93', zIndex: 5, pointerEvents: 'none', maxWidth: '58%' }}>
        {hudBL}
      </div>
      {/* NO bottom-right div — reserved for parent chrome. */}
    </div>
  )
}

// ─── Scatter plot component ─────────────────────────────────
function ScatterPlot({
  points,
  currentPoint,
  hideKindColor,
}: {
  points: { U: number; I: number; kind: ResKind | 'unknown' }[]
  currentPoint: { U: number; I: number; kind: ResKind } | null
  hideKindColor: boolean
}) {
  const uTicks = [0, 2, 4, 6, 8, 10, 12]
  const iTicks = [0, 50, 100, 150, 200]

  return (
    <g>
      {/* Grid lines */}
      {uTicks.map((u) => (
        <line
          key={`ux${u}`}
          x1={projU(u)}
          y1={PLOT_INNER_Y0}
          x2={projU(u)}
          y2={PLOT_INNER_Y1}
          stroke="#12203a"
          strokeWidth={1}
        />
      ))}
      {iTicks.map((i) => (
        <line
          key={`iy${i}`}
          x1={PLOT_INNER_X0}
          y1={projI(i)}
          x2={PLOT_INNER_X1}
          y2={projI(i)}
          stroke="#12203a"
          strokeWidth={1}
        />
      ))}
      {/* Axes */}
      <line
        x1={PLOT_INNER_X0}
        y1={PLOT_INNER_Y1}
        x2={PLOT_INNER_X1}
        y2={PLOT_INNER_Y1}
        stroke="#3A4863"
        strokeWidth={1.5}
      />
      <line
        x1={PLOT_INNER_X0}
        y1={PLOT_INNER_Y0}
        x2={PLOT_INNER_X0}
        y2={PLOT_INNER_Y1}
        stroke="#3A4863"
        strokeWidth={1.5}
      />
      {/* Tick labels */}
      {uTicks.map((u) => (
        <text
          key={`utl${u}`}
          x={projU(u)}
          y={PLOT_INNER_Y1 + 14}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={9}
          textAnchor="middle"
        >
          {u}
        </text>
      ))}
      {iTicks.map((i) => (
        <text
          key={`itl${i}`}
          x={PLOT_INNER_X0 - 6}
          y={projI(i) + 3}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={9}
          textAnchor="end"
        >
          {i}
        </text>
      ))}
      {/* Axis titles */}
      <text
        x={(PLOT_INNER_X0 + PLOT_INNER_X1) / 2}
        y={PLOT_INNER_Y1 + 30}
        fill="#6C7A93"
        fontFamily="'JetBrains Mono', monospace"
        fontSize={10}
        textAnchor="middle"
      >
        U (V)
      </text>
      <text
        x={PLOT_INNER_X0 - 30}
        y={(PLOT_INNER_Y0 + PLOT_INNER_Y1) / 2}
        fill="#6C7A93"
        fontFamily="'JetBrains Mono', monospace"
        fontSize={10}
        textAnchor="middle"
        transform={`rotate(-90 ${PLOT_INNER_X0 - 30} ${(PLOT_INNER_Y0 + PLOT_INNER_Y1) / 2})`}
      >
        I (mA)
      </text>
      {/* Data points */}
      {points.map((p, idx) => {
        const color = hideKindColor
          ? '#B9C4D6'
          : (p.kind === 'unknown' ? '#B9C4D6' : KIND_COLOR[p.kind])
        return (
          <circle key={`p${idx}`} cx={projU(p.U)} cy={projI(p.I)} r={2.4} fill={color} />
        )
      })}
      {/* Current live point (stages 1+2) */}
      {currentPoint && currentPoint.I > 0.001 && (
        <circle
          cx={projU(currentPoint.U)}
          cy={projI(currentPoint.I)}
          r={4}
          fill="none"
          stroke={KIND_COLOR[currentPoint.kind]}
          strokeWidth={1.6}
        />
      )}
    </g>
  )
}

// ─── Component glyphs ───────────────────────────────────────
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

function ResistorSymbol({ label }: { label: string }) {
  return (
    <g>
      <line x1={-32} y1={0} x2={-18} y2={0} stroke="#54617A" strokeWidth={2} />
      <line x1={18} y1={0} x2={32} y2={0} stroke="#54617A" strokeWidth={2} />
      <rect x={-18} y={-8} width={36} height={16} fill="#131F35" stroke="#B9C4D6" strokeWidth={1.2} rx={2} />
      <text x={0} y={3} fill="#B9C4D6" fontFamily="'JetBrains Mono', monospace" fontSize={9} textAnchor="middle">
        {label}
      </text>
    </g>
  )
}

function AmmeterSymbol() {
  return (
    <g>
      <line x1={-32} y1={0} x2={-14} y2={0} stroke="#54617A" strokeWidth={2} />
      <line x1={14} y1={0} x2={32} y2={0} stroke="#54617A" strokeWidth={2} />
      <circle cx={0} cy={0} r={13} fill="#131F35" stroke="#54617A" strokeWidth={1.4} />
      <text x={0} y={4} fill="#B9C4D6" fontFamily="'JetBrains Mono', monospace" fontSize={11} textAnchor="middle" fontWeight={700}>
        A
      </text>
    </g>
  )
}

function LampSymbol({ lit }: { lit: boolean }) {
  return (
    <g>
      <line x1={-32} y1={0} x2={-14} y2={0} stroke="#54617A" strokeWidth={2} />
      <line x1={14} y1={0} x2={32} y2={0} stroke="#54617A" strokeWidth={2} />
      <circle cx={0} cy={0} r={13} fill={lit ? '#F9A968' : '#131F35'} stroke={lit ? '#F9A968' : '#54617A'} strokeWidth={1.4} />
      <line x1={-6} y1={-6} x2={6} y2={6} stroke={lit ? '#B45309' : '#54617A'} strokeWidth={1.5} />
      <line x1={-6} y1={6} x2={6} y2={-6} stroke={lit ? '#B45309' : '#54617A'} strokeWidth={1.5} />
    </g>
  )
}
