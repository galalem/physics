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

// Loop rectangle (world coords)
const LOOP_LEFT = 130
const LOOP_RIGHT = 500
const LOOP_TOP = 100
const LOOP_BOTTOM = 340
const PROBE_HIT_RADIUS = 60

// Four fixed dipoles at the loop slot centers.
// Order: 0=battery(top), 1=lamp1(right), 2=lamp2(bottom), 3=switch(left)
type DipoleIdx = 0 | 1 | 2 | 3
const DIPOLE_CENTERS: { x: number; y: number }[] = [
  { x: (LOOP_LEFT + LOOP_RIGHT) / 2, y: LOOP_TOP },      // battery — top
  { x: LOOP_RIGHT, y: (LOOP_TOP + LOOP_BOTTOM) / 2 },    // lamp1  — right
  { x: (LOOP_LEFT + LOOP_RIGHT) / 2, y: LOOP_BOTTOM },   // lamp2  — bottom
  { x: LOOP_LEFT, y: (LOOP_TOP + LOOP_BOTTOM) / 2 },     // switch — left
]
const DIPOLE_ORIENT: ('h' | 'v')[] = ['h', 'v', 'h', 'v']
const DIPOLE_KINDS = ['battery', 'lamp', 'lamp', 'switch'] as const

// Probe positions (voltmeter body sits here, one step INTO the loop
// interior from each dipole, so probe leads reach both ends of the dipole).
const PROBE_OFFSET = 55
const PROBE_CENTERS: { x: number; y: number }[] = [
  { x: DIPOLE_CENTERS[0]!.x, y: DIPOLE_CENTERS[0]!.y + PROBE_OFFSET },
  { x: DIPOLE_CENTERS[1]!.x - PROBE_OFFSET, y: DIPOLE_CENTERS[1]!.y },
  { x: DIPOLE_CENTERS[2]!.x, y: DIPOLE_CENTERS[2]!.y - PROBE_OFFSET },
  { x: DIPOLE_CENTERS[3]!.x + PROBE_OFFSET, y: DIPOLE_CENTERS[3]!.y },
]

// ─── Physics: hand-authored voltage table ───────────────────
// Series loop. Battery E = 6V, lamps consume the current.
// When switch is closed: I flows → U_L1 = 4V, U_L2 = 2V, U_K = 0V, U_bat = 6V.
// KVL: +6 - 4 - 2 - 0 = 0 ✓
// When switch is open: I = 0 → no drop across lamps.
// U_L1 = 0V, U_L2 = 0V, U_K = 6V, U_bat = 6V.
// KVL: +6 - 0 - 0 - 6 = 0 ✓
type Palette = 'voltmeter' | 'ammeter' | 'wire'
function voltageAt(dipole: DipoleIdx, switchClosed: boolean): number {
  if (dipole === 0) return 6 // battery (source EMF, either state)
  if (dipole === 3) return switchClosed ? 0 : 6
  // lamps: full drop when current flows, 0 when open
  if (!switchClosed) return 0
  return dipole === 1 ? 4 : 2
}

// ─── Stage-2 targets — hand-authored, seed-picked ────────────
type Target = { dipole: DipoleIdx; U: number; sw: 'closed' | 'open' }
const TARGET_SETS: Target[][] = [
  [
    { dipole: 0, U: 6, sw: 'closed' }, // battery
    { dipole: 2, U: 2, sw: 'closed' }, // lamp2
  ],
  [
    { dipole: 1, U: 4, sw: 'closed' }, // lamp1
    { dipole: 3, U: 6, sw: 'open' },   // open switch drops full E
  ],
  [
    { dipole: 1, U: 4, sw: 'closed' }, // lamp1
    { dipole: 0, U: 6, sw: 'closed' }, // battery
  ],
]

// ─── Stage-3 scenarios — one hidden dipole per seed ─────────
// The student must place a voltmeter across the "?" dipole.
type Scenario = { hidden: DipoleIdx; targetU: number }
const SCENARIOS: Scenario[] = [
  { hidden: 2, targetU: 2 }, // hide lamp2 → student computes 6 - 4 - 0 = 2
  { hidden: 1, targetU: 4 }, // hide lamp1 → 6 - 2 - 0 = 4
  { hidden: 0, targetU: 6 }, // hide battery → +U_L1 + U_L2 + U_K = 4 + 2 + 0 = 6
]

// ─── Label loader ────────────────────────────────────────────
const dict = { en } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels as Record<string, string>
}

// ─── Component ──────────────────────────────────────────────
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

  const targets = useMemo(() => TARGET_SETS[seed % TARGET_SETS.length]!, [seed])
  const scenario = useMemo(() => SCENARIOS[seed % SCENARIOS.length]!, [seed])

  // Voltmeter position: which dipole probe it sits on, or null (in the palette).
  const [voltAt, setVoltAt] = useState<DipoleIdx | null>(null)
  // Switch state. Stage 3 keeps it closed.
  const [switchClosed, setSwitchClosed] = useState(false)

  // Stage-1 coverage flags
  const [sawBattery, setSawBattery] = useState(false)
  const [sawLamp, setSawLamp] = useState(false)
  const [sawOpen, setSawOpen] = useState(false)

  // Stage-2 target tracking
  const [hitFlags, setHitFlags] = useState<boolean[]>(() => targets.map(() => false))
  useEffect(() => {
    setHitFlags(targets.map(() => false))
  }, [targets])

  // Stage-3 submission
  const [stage3Submitted, setStage3Submitted] = useState(false)
  const [stage3Correct, setStage3Correct] = useState<boolean | null>(null)
  const [stage3AttemptsLeft, setStage3AttemptsLeft] = useState(1)
  // Which palette item last landed on the probe slot; drives the wrong-instrument
  // feedback ring when it isn't a voltmeter.
  const [stage3Placed, setStage3Placed] = useState<{ kind: Palette; dipole: DipoleIdx } | null>(null)

  // Stage-3 initialization: pin switch closed.
  useEffect(() => {
    if (isStage3 && !switchClosed) setSwitchClosed(true)
  }, [isStage3, switchClosed])

  // Live reading (hidden on stage-3 until submit).
  const readingU = voltAt !== null ? voltageAt(voltAt, switchClosed) : null

  // Stage-1 coverage
  useEffect(() => {
    if (!isStage1 || voltAt === null) return
    if (voltAt === 0 && !sawBattery) setSawBattery(true)
    if ((voltAt === 1 || voltAt === 2) && !sawLamp) setSawLamp(true)
  }, [isStage1, voltAt, sawBattery, sawLamp])

  useEffect(() => {
    if (!isStage1) return
    if (!switchClosed && !sawOpen) setSawOpen(true)
  }, [isStage1, switchClosed, sawOpen])

  // Stage-2 target detection: a target counts as hit whenever the voltmeter
  // reading matches its (dipole, switch-state) pair.
  useEffect(() => {
    if (!isStage2 || voltAt === null) return
    setHitFlags((prev) => {
      let changed = false
      const next = prev.slice()
      for (let i = 0; i < targets.length; i++) {
        if (next[i]) continue
        const t = targets[i]!
        const swOK = t.sw === 'closed' ? switchClosed : !switchClosed
        if (swOK && voltAt === t.dipole && voltageAt(voltAt, switchClosed) === t.U) {
          next[i] = true
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [isStage2, voltAt, switchClosed, targets])

  // Stage advance predicates
  const stage1Done = sawBattery && sawLamp && sawOpen
  const stage2Done = hitFlags.every(Boolean)
  const stage3Done = stage3Correct === true
  const canSubmit = isStage1 ? stage1Done : isStage2 ? stage2Done : stage3Done

  // ─── Reset ────────────────────────────────────────────────
  const resetStageState = useCallback(() => {
    setVoltAt(null)
    setSwitchClosed(false)
    setSawBattery(false)
    setSawLamp(false)
    setSawOpen(false)
    setHitFlags(targets.map(() => false))
    setStage3Submitted(false)
    setStage3Correct(null)
    setStage3AttemptsLeft(1)
    setStage3Placed(null)
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

  // ─── Stage-3 submit (called on placement) ────────────────────
  const submitStage3 = useCallback(
    (kind: Palette, dipole: DipoleIdx) => {
      const correct = kind === 'voltmeter' && dipole === scenario.hidden
      setStage3Submitted(true)
      setStage3Correct(correct)
      setStage3Placed({ kind, dipole })
      if (!correct) {
        setStage3AttemptsLeft((n) => {
          const next = n - 1
          if (next <= 0) {
            // Exhausted — rotate to next scenario by resetting.
            setTimeout(resetStageState, 1400)
          }
          return next
        })
      }
    },
    [scenario, resetStageState],
  )

  // ─── Peek (strategy hint text only) ──────────────────────────
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

  // ─── Drag machinery ──────────────────────────────────────────
  type PendingState = { fromProbe: DipoleIdx; kind: Palette; startClientX: number; startClientY: number }
  type DraggingState = { kind: Palette; fromProbe: DipoleIdx | null; x: number; y: number }
  const DRAG_THRESHOLD_PX = 5

  const [pending, setPending] = useState<PendingState | null>(null)
  const [dragging, setDragging] = useState<DraggingState | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

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

  const onPointerDownPalette = useCallback(
    (kind: Palette, e: React.PointerEvent<SVGElement>) => {
      e.stopPropagation()
      const svg = e.currentTarget.ownerSVGElement
      if (!svg) return
      if (isStage3 && stage3Submitted) return
      ;(e.currentTarget as SVGElement).setPointerCapture(e.pointerId)
      const pos = clientToSvg(svg, e.clientX, e.clientY)
      setDragging({ kind, fromProbe: null, x: pos.x, y: pos.y })
    },
    [isStage3, stage3Submitted],
  )

  const onPointerDownVoltmeter = useCallback(
    (probe: DipoleIdx, e: React.PointerEvent<SVGElement>) => {
      e.stopPropagation()
      if (isStage3) return // stage 3 is one-shot; no re-picking after placement
      ;(e.currentTarget as SVGElement).setPointerCapture(e.pointerId)
      setPending({
        fromProbe: probe,
        kind: 'voltmeter',
        startClientX: e.clientX,
        startClientY: e.clientY,
      })
    },
    [isStage3],
  )

  const onPointerDownSwitch = useCallback(
    (e: React.PointerEvent<SVGElement>) => {
      e.stopPropagation()
      if (isStage3) return
      setSwitchClosed((v) => !v)
    },
    [isStage3],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (pending) {
        const dist = Math.hypot(e.clientX - pending.startClientX, e.clientY - pending.startClientY)
        if (dist > DRAG_THRESHOLD_PX) {
          setVoltAt(null)
          const pos = clientToSvg(e.currentTarget, e.clientX, e.clientY)
          setDragging({ kind: pending.kind, fromProbe: pending.fromProbe, x: pos.x, y: pos.y })
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
        // Under threshold: no-op. Voltmeter stays where it is.
        setPending(null)
        return
      }
      if (!dragging) return
      let bestIdx = -1
      let bestDist = PROBE_HIT_RADIUS
      for (let i = 0; i < 4; i++) {
        const c = PROBE_CENTERS[i]!
        const d = Math.hypot(dragging.x - c.x, dragging.y - c.y)
        if (d < bestDist) {
          bestDist = d
          bestIdx = i
        }
      }
      if (bestIdx >= 0) {
        const target = bestIdx as DipoleIdx
        if (isStage3) {
          submitStage3(dragging.kind, target)
        } else {
          // Non-voltmeter palette entries don't exist outside stage 3, so this
          // is always a voltmeter drop on 1+2.
          if (dragging.kind === 'voltmeter') setVoltAt(target)
        }
      }
      setDragging(null)
    },
    [pending, dragging, isStage3, submitStage3],
  )

  // ─── Palette items ──────────────────────────────────────────
  const paletteX = 688
  const paletteYStart = 108
  const paletteStep = 80
  const paletteItems: Palette[] = isStage3 ? ['voltmeter', 'ammeter', 'wire'] : ['voltmeter']

  // ─── HUD text ────────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`

  const dipoleLabel = (d: DipoleIdx) =>
    d === 0 ? labels.dipole_battery : d === 1 ? labels.dipole_lamp1 : d === 2 ? labels.dipole_lamp2 : labels.dipole_switch

  const targetLine = (t: Target) => {
    const swTag = t.sw === 'closed' ? labels.target_when_closed : labels.target_when_open
    return `${labels.target_prefix} ${labels.target_across} ${dipoleLabel(t.dipole)} = ${t.U} ${labels.unit_V} ${swTag}`
  }

  const hudTR = isStage1
    ? `${sawBattery ? '✓' : '·'} ${labels.seen_battery}   ${sawLamp ? '✓' : '·'} ${labels.seen_lamp}   ${sawOpen ? '✓' : '·'} ${labels.seen_open}`
    : isStage2
      ? `${labels.targets}: ${hitFlags.filter(Boolean).length}/${targets.length}`
      : stage3Submitted
        ? stage3Correct
          ? labels.correct
          : `${labels.wrong} · ${labels.attempts_left}: ${stage3AttemptsLeft}`
        : labels.place_probe

  const hudBL = isStage3
    ? peekText ?? labels.tip3
    : isStage2
      ? targets
          .map((t, i) => `${hitFlags[i] ? '✓' : '·'} ${targetLine(t)}`)
          .join('   ')
      : labels.tip1
  // BR reserved — nothing rendered there.

  // ─── Component art helpers (inline) ─────────────────────────
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
          userSelect: 'none',
          touchAction: 'none',
        }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {/* NO borderRadius on <svg>. NO rx on the bg <rect>. */}
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        {/* Schematic panel */}
        <rect x={32} y={60} width={560} height={358} fill="none" stroke="#12203a" strokeWidth={1} rx={6} />
        <text
          x={40}
          y={52}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={11}
          letterSpacing="0.1em"
        >
          {labels.schematic}
        </text>

        {/* Palette panel */}
        <rect x={608} y={60} width={160} height={358} fill="none" stroke="#12203a" strokeWidth={1} rx={6} />
        <text
          x={616}
          y={52}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={11}
          letterSpacing="0.1em"
        >
          {labels.palette}
        </text>

        {/* Loop wires — structural stubs from corner to dipole slot edges */}
        <g>
          {[
            [LOOP_LEFT, LOOP_TOP],
            [LOOP_RIGHT, LOOP_TOP],
            [LOOP_RIGHT, LOOP_BOTTOM],
            [LOOP_LEFT, LOOP_BOTTOM],
          ].map(([x, y], i) => (
            <circle key={`c${i}`} cx={x} cy={y} r={2.5} fill="#3A4863" />
          ))}
          {/* top */}
          <line x1={LOOP_LEFT} y1={LOOP_TOP} x2={DIPOLE_CENTERS[0]!.x - 32} y2={LOOP_TOP} stroke="#3A4863" strokeWidth={2} />
          <line x1={DIPOLE_CENTERS[0]!.x + 32} y1={LOOP_TOP} x2={LOOP_RIGHT} y2={LOOP_TOP} stroke="#3A4863" strokeWidth={2} />
          {/* right */}
          <line x1={LOOP_RIGHT} y1={LOOP_TOP} x2={LOOP_RIGHT} y2={DIPOLE_CENTERS[1]!.y - 32} stroke="#3A4863" strokeWidth={2} />
          <line x1={LOOP_RIGHT} y1={DIPOLE_CENTERS[1]!.y + 32} x2={LOOP_RIGHT} y2={LOOP_BOTTOM} stroke="#3A4863" strokeWidth={2} />
          {/* bottom */}
          <line x1={LOOP_LEFT} y1={LOOP_BOTTOM} x2={DIPOLE_CENTERS[2]!.x - 32} y2={LOOP_BOTTOM} stroke="#3A4863" strokeWidth={2} />
          <line x1={DIPOLE_CENTERS[2]!.x + 32} y1={LOOP_BOTTOM} x2={LOOP_RIGHT} y2={LOOP_BOTTOM} stroke="#3A4863" strokeWidth={2} />
          {/* left */}
          <line x1={LOOP_LEFT} y1={LOOP_TOP} x2={LOOP_LEFT} y2={DIPOLE_CENTERS[3]!.y - 32} stroke="#3A4863" strokeWidth={2} />
          <line x1={LOOP_LEFT} y1={DIPOLE_CENTERS[3]!.y + 32} x2={LOOP_LEFT} y2={LOOP_BOTTOM} stroke="#3A4863" strokeWidth={2} />
        </g>

        {/* Fixed dipoles + labels */}
        {DIPOLE_CENTERS.map((c, i) => {
          const kind = DIPOLE_KINDS[i as DipoleIdx]
          const orient = DIPOLE_ORIENT[i]!
          const dLabelKey =
            i === 0 ? 'battery_label' : i === 1 ? 'lamp1_label' : i === 2 ? 'lamp2_label' : 'switch_label'
          const dLabel = labels[dLabelKey] ?? ''
          // Whether this dipole's voltage should be shown as a static label
          // beside the component (stage 3 only, and NOT for the hidden one).
          const showLabel = isStage3 && i !== scenario.hidden
          const staticU = voltageAt(i as DipoleIdx, true) // stage 3 pins switch closed
          // For the hidden dipole, show a "?" chip instead.
          const showHidden = isStage3 && i === scenario.hidden
          // Label positions: outside the loop rectangle so they don't collide
          // with the voltmeter placed inside.
          const labelPos =
            i === 0
              ? { x: c.x, y: c.y - 30, anchor: 'middle' as const }
              : i === 1
                ? { x: c.x + 30, y: c.y - 4, anchor: 'start' as const }
                : i === 2
                  ? { x: c.x, y: c.y + 38, anchor: 'middle' as const }
                  : { x: c.x - 30, y: c.y - 4, anchor: 'end' as const }
          return (
            <g key={`dip${i}`}>
              {/* clickable hit rect for the switch */}
              {kind === 'switch' ? (
                <g
                  onPointerDown={onPointerDownSwitch}
                  style={{ cursor: isStage3 ? 'default' : 'pointer' }}
                >
                  <rect x={c.x - 34} y={c.y - 20} width={68} height={40} fill="transparent" />
                  <DipoleGlyph kind={kind} orient={orient} lit={false} switchClosed={switchClosed} cx={c.x} cy={c.y} />
                </g>
              ) : (
                <DipoleGlyph
                  kind={kind}
                  orient={orient}
                  lit={switchClosed && (kind === 'lamp')}
                  switchClosed={switchClosed}
                  cx={c.x}
                  cy={c.y}
                />
              )}
              {/* Component identifier tag */}
              <text
                x={labelPos.x}
                y={labelPos.y}
                fill="#6C7A93"
                fontFamily="'JetBrains Mono', monospace"
                fontSize={10}
                textAnchor={labelPos.anchor}
                letterSpacing="0.06em"
              >
                {dLabel}
              </text>
              {/* Stage 3: static voltage annotation next to non-hidden dipoles */}
              {showLabel && (
                <text
                  x={labelPos.x}
                  y={labelPos.y + 12}
                  fill="#B9C4D6"
                  fontFamily="'JetBrains Mono', monospace"
                  fontSize={11}
                  fontWeight={700}
                  textAnchor={labelPos.anchor}
                >
                  {`U=${staticU} ${labels.unit_V}`}
                </text>
              )}
              {showHidden && (
                <text
                  x={labelPos.x}
                  y={labelPos.y + 12}
                  fill="#F97316"
                  fontFamily="'JetBrains Mono', monospace"
                  fontSize={13}
                  fontWeight={700}
                  textAnchor={labelPos.anchor}
                >
                  {`U=${labels.unknown}`}
                </text>
              )}
            </g>
          )
        })}

        {/* Current-flow indicator (stages 1+2 only, when loop closed) */}
        {!isStage3 && switchClosed && (
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

        {/* Probe target markers (visible when dragging or empty) */}
        {PROBE_CENTERS.map((p, i) => {
          const empty = voltAt !== i
          if (!empty) return null
          const highlight = dragging && dragging.kind === 'voltmeter'
          return (
            <g key={`probe${i}`}>
              <circle
                cx={p.x}
                cy={p.y}
                r={12}
                fill="none"
                stroke={highlight ? '#F97316' : '#3A4863'}
                strokeWidth={1.2}
                strokeDasharray="3 3"
                opacity={0.7}
              />
            </g>
          )
        })}

        {/* Placed voltmeter (only when placed AND not currently mid-drag from it) */}
        {voltAt !== null && (
          <g
            onPointerDown={(e) => onPointerDownVoltmeter(voltAt, e)}
            style={{ cursor: isStage3 ? 'default' : 'grab' }}
          >
            <VoltmeterPlacement
              dipoleIdx={voltAt}
              reading={
                isStage3 && !stage3Submitted
                  ? null
                  : readingU
              }
              readingLabel={
                isStage3 && !stage3Submitted
                  ? labels.reading_hidden ?? ''
                  : null
              }
              unitV={labels.unit_V ?? 'V'}
            />
          </g>
        )}

        {/* Stage-3 wrong-instrument marker: draw a translucent ghost of the
            chosen decoy at its dropped probe slot with a red ring. */}
        {isStage3 && stage3Submitted && stage3Correct === false && stage3Placed && stage3Placed.kind !== 'voltmeter' && (
          <g transform={`translate(${PROBE_CENTERS[stage3Placed.dipole]!.x}, ${PROBE_CENTERS[stage3Placed.dipole]!.y})`}>
            {stage3Placed.kind === 'ammeter' ? <AmmeterSymbol /> : <WireSymbol />}
            <circle cx={0} cy={0} r={22} fill="none" stroke="#EF4444" strokeWidth={2} opacity={0.85} />
          </g>
        )}

        {/* Stage-3 wrong-position marker: voltmeter dropped on the wrong probe */}
        {isStage3 &&
          stage3Submitted &&
          stage3Correct === false &&
          stage3Placed &&
          stage3Placed.kind === 'voltmeter' && (
            <circle
              cx={PROBE_CENTERS[stage3Placed.dipole]!.x}
              cy={PROBE_CENTERS[stage3Placed.dipole]!.y}
              r={26}
              fill="none"
              stroke="#EF4444"
              strokeWidth={2}
              opacity={0.85}
            />
          )}

        {/* Stage-3 correct marker */}
        {isStage3 && stage3Submitted && stage3Correct === true && stage3Placed && (
          <circle
            cx={PROBE_CENTERS[stage3Placed.dipole]!.x}
            cy={PROBE_CENTERS[stage3Placed.dipole]!.y}
            r={26}
            fill="none"
            stroke="#37C9B8"
            strokeWidth={2}
            opacity={0.95}
          />
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
              <rect x={-58} y={-30} width={116} height={60} fill="#131F35" stroke="#3A4863" strokeWidth={1} rx={4} />
              {k === 'voltmeter' && <VoltmeterSymbol />}
              {k === 'ammeter' && <AmmeterSymbol />}
              {k === 'wire' && <WireSymbol />}
              <text
                x={0}
                y={44}
                fill="#6C7A93"
                fontFamily="'JetBrains Mono', monospace"
                fontSize={10}
                textAnchor="middle"
              >
                {labels[`comp_${k}`] ?? k}
              </text>
            </g>
          )
        })}

        {/* Drag ghost */}
        {dragging && (
          <g transform={`translate(${dragging.x}, ${dragging.y})`} opacity={0.75} pointerEvents="none">
            {dragging.kind === 'voltmeter' && <VoltmeterSymbol />}
            {dragging.kind === 'ammeter' && <AmmeterSymbol />}
            {dragging.kind === 'wire' && <WireSymbol />}
          </g>
        )}

        {/* Leave BR quadrant empty — reserved for parent chrome (§4.3). */}
      </svg>

      {/* HUD overlays — HTML in `rem` */}
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
          maxWidth: '46%',
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
          fontSize: '1.7rem',
          letterSpacing: '0.06em',
          color: '#6C7A93',
          zIndex: 5,
          pointerEvents: 'none',
          maxWidth: '62%',
        }}
      >
        {hudBL}
      </div>
      {/* NO bottom-right div — reserved for parent chrome (§4.3). */}
    </div>
  )
}

// ─── Component glyphs ───────────────────────────────────────
function DipoleGlyph({
  kind,
  orient,
  lit,
  switchClosed,
  cx,
  cy,
}: {
  kind: (typeof DIPOLE_KINDS)[number]
  orient: 'h' | 'v'
  lit: boolean
  switchClosed: boolean
  cx: number
  cy: number
}) {
  const rot = orient === 'v' ? 90 : 0
  return (
    <g transform={`translate(${cx}, ${cy}) rotate(${rot})`}>
      {kind === 'battery' && <BatterySymbol />}
      {kind === 'lamp' && <LampSymbol lit={lit} />}
      {kind === 'switch' && <SwitchSymbol closed={switchClosed} />}
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
      <text
        x={-12}
        y={-18}
        fill="#F9A968"
        fontFamily="'JetBrains Mono', monospace"
        fontSize={10}
        textAnchor="middle"
        fontWeight={700}
      >
        +
      </text>
      <text
        x={12}
        y={-18}
        fill="#7EE3D8"
        fontFamily="'JetBrains Mono', monospace"
        fontSize={10}
        textAnchor="middle"
        fontWeight={700}
      >
        −
      </text>
    </g>
  )
}

function LampSymbol({ lit }: { lit: boolean }) {
  return (
    <g>
      <line x1={-32} y1={0} x2={-14} y2={0} stroke="#54617A" strokeWidth={2} />
      <line x1={14} y1={0} x2={32} y2={0} stroke="#54617A" strokeWidth={2} />
      <circle
        cx={0}
        cy={0}
        r={13}
        fill={lit ? '#F9A968' : '#131F35'}
        stroke={lit ? '#F9A968' : '#54617A'}
        strokeWidth={1.4}
      />
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

function SwitchSymbol({ closed }: { closed: boolean }) {
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

function VoltmeterSymbol() {
  return (
    <g>
      <circle cx={0} cy={0} r={16} fill="#131F35" stroke="#54617A" strokeWidth={1.4} />
      <text
        x={0}
        y={4}
        fill="#B9C4D6"
        fontFamily="'JetBrains Mono', monospace"
        fontSize={13}
        fontWeight={700}
        textAnchor="middle"
      >
        V
      </text>
    </g>
  )
}

function AmmeterSymbol() {
  return (
    <g>
      <circle cx={0} cy={0} r={16} fill="#131F35" stroke="#54617A" strokeWidth={1.4} />
      <text
        x={0}
        y={4}
        fill="#B9C4D6"
        fontFamily="'JetBrains Mono', monospace"
        fontSize={13}
        fontWeight={700}
        textAnchor="middle"
      >
        A
      </text>
    </g>
  )
}

function WireSymbol() {
  return (
    <g>
      <line x1={-28} y1={0} x2={28} y2={0} stroke="#54617A" strokeWidth={2.4} />
    </g>
  )
}

/**
 * Voltmeter placed at probe slot `dipoleIdx`. Draws the voltmeter body plus
 * two probe leads reaching the two ends of the corresponding dipole. Also
 * renders the reading (or a placeholder if hidden).
 */
function VoltmeterPlacement({
  dipoleIdx,
  reading,
  readingLabel,
  unitV,
}: {
  dipoleIdx: DipoleIdx
  reading: number | null
  readingLabel: string | null
  unitV: string
}) {
  const p = PROBE_CENTERS[dipoleIdx]!
  const d = DIPOLE_CENTERS[dipoleIdx]!
  const orient = DIPOLE_ORIENT[dipoleIdx]!
  // Probe lead endpoints: attach to the two "ends" of the dipole based on orient.
  const endA = orient === 'h' ? { x: d.x - 30, y: d.y } : { x: d.x, y: d.y - 30 }
  const endB = orient === 'h' ? { x: d.x + 30, y: d.y } : { x: d.x, y: d.y + 30 }
  // Body offset: voltmeter body sits at p; leads start from a small offset.
  const leadStartA = orient === 'h' ? { x: p.x - 12, y: p.y } : { x: p.x, y: p.y - 12 }
  const leadStartB = orient === 'h' ? { x: p.x + 12, y: p.y } : { x: p.x, y: p.y + 12 }
  return (
    <g>
      <line
        x1={leadStartA.x}
        y1={leadStartA.y}
        x2={endA.x}
        y2={endA.y}
        stroke="#37C9B8"
        strokeWidth={1.6}
      />
      <line
        x1={leadStartB.x}
        y1={leadStartB.y}
        x2={endB.x}
        y2={endB.y}
        stroke="#37C9B8"
        strokeWidth={1.6}
      />
      {/* Contact dots */}
      <circle cx={endA.x} cy={endA.y} r={2.4} fill="#37C9B8" />
      <circle cx={endB.x} cy={endB.y} r={2.4} fill="#37C9B8" />
      {/* Voltmeter body */}
      <circle cx={p.x} cy={p.y} r={16} fill="#131F35" stroke="#37C9B8" strokeWidth={1.4} />
      <text
        x={p.x}
        y={p.y - 3}
        fill="#B9C4D6"
        fontFamily="'JetBrains Mono', monospace"
        fontSize={9}
        fontWeight={700}
        textAnchor="middle"
      >
        V
      </text>
      {/* Reading — number or hidden placeholder */}
      {reading !== null ? (
        <text
          x={p.x}
          y={p.y + 9}
          fill="#37C9B8"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={9}
          fontWeight={700}
          textAnchor="middle"
        >
          {`${reading}${unitV}`}
        </text>
      ) : (
        <text
          x={p.x}
          y={p.y + 9}
          fill="#54617A"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={8}
          textAnchor="middle"
        >
          ?
        </text>
      )}
      {readingLabel && (
        <text
          x={p.x}
          y={p.y + 30}
          fill="#54617A"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={9}
          textAnchor="middle"
        >
          {readingLabel}
        </text>
      )}
    </g>
  )
}
