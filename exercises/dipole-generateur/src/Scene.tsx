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

// ─── Canvas ─────────────────────────────────────────────────────────
const W = 800
const H = 450

// ─── Slider ranges ──────────────────────────────────────────────────
const E_MIN = 0
const E_MAX = 15
const E_STEP = 0.5
const R_INT_MIN = 0
const R_INT_MAX = 5
const R_INT_STEP = 0.1
// Load R: kept away from short-/open-circuit extremes on stage 3 so the
// student can't cheat by reading E directly (open) or E/r (short).
const R_LOAD_MIN = 3
const R_LOAD_MAX = 30
const R_LOAD_STEP = 0.5

// ─── Physics (Pouillet) ─────────────────────────────────────────────
// Series loop: I = E / (R + r);  U = R * I = E - r * I.
// Test: E=12 V, r=2 Ω, R=4 Ω → I = 12/6 = 2 A; U = 4*2 = 8 V.
function solve(E: number, r: number, R: number): { I: number; U: number } {
  const denom = R + r
  if (denom <= 0) return { I: 0, U: 0 }
  const I = E / denom
  const U = R * I
  return { I, U }
}

// ─── Stage-2 targets (hand-authored, seed-picked) ───────────────────
type Target = { E: number; r: number }
const TARGET_SETS: Target[][] = [
  [{ E: 9, r: 2 }, { E: 6, r: 4 }],
  [{ E: 12, r: 3 }, { E: 4.5, r: 1 }],
  [{ E: 15, r: 1 }, { E: 7.5, r: 2.5 }],
]

// ─── Stage-3 puzzles (hand-authored, seed-picked; ace-the-deck of 3) ─
type Puzzle = { E: number; r: number }
// Three complete decks of three batteries each. Every battery has a
// non-trivial r so the two-point formula is meaningful, and E/r is
// well outside the R_LOAD range (so the student can't guess by
// short-circuit inspection).
const DECKS: Puzzle[][] = [
  [
    { E: 12, r: 2 },
    { E: 9, r: 1 },
    { E: 6, r: 3 },
  ],
  [
    { E: 10, r: 2.5 },
    { E: 4.5, r: 1.5 },
    { E: 13.5, r: 3 },
  ],
  [
    { E: 7.5, r: 2 },
    { E: 11, r: 1 },
    { E: 5, r: 2.5 },
  ],
]
const STAGE3_ATTEMPTS = 3
const TOLERANCE = 0.05

// ─── i18n dispatch ──────────────────────────────────────────────────
const dict = { en } as const
type Locale = keyof typeof dict
function svgLabels(locale: string): Record<string, string> {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels as Record<string, string>
}

// ─── U(I) plot geometry ─────────────────────────────────────────────
const PLOT_X0 = 360
const PLOT_X1 = 590
const PLOT_Y0 = 380 // y for U=0
const PLOT_Y1 = 100 // y for U=15
const U_AXIS_MAX = 15
const I_AXIS_MAX = 5
const mapU = (u: number) => PLOT_Y0 - (Math.max(0, Math.min(U_AXIS_MAX, u)) / U_AXIS_MAX) * (PLOT_Y0 - PLOT_Y1)
const mapI = (i: number) => PLOT_X0 + (Math.max(0, Math.min(I_AXIS_MAX, i)) / I_AXIS_MAX) * (PLOT_X1 - PLOT_X0)

// Clip the line U = E - r*I to the plot rectangle.
// Line endpoints: (I=0, U=E) → (I_end, U_end) where I_end is the
// smaller of I_AXIS_MAX and E/r (open-circuit line if r=0).
function lineEndpoints(E: number, r: number): { x1: number; y1: number; x2: number; y2: number } {
  const uAt0 = E
  const iMaxLine = r > 0 ? E / r : I_AXIS_MAX
  const iEnd = Math.min(I_AXIS_MAX, iMaxLine)
  const uEnd = E - r * iEnd
  return { x1: mapI(0), y1: mapU(uAt0), x2: mapI(iEnd), y2: mapU(uEnd) }
}

// ─── Slider (SVG, horizontal, pointer-driven) ───────────────────────
type SliderProps = {
  x: number
  y: number
  width: number
  label: string
  unit: string
  min: number
  max: number
  step: number
  value: number
  onChange: (v: number) => void
  hidden?: boolean
  disabled?: boolean
}
function Slider({ x, y, width, label, unit, min, max, step, value, onChange, hidden, disabled }: SliderProps) {
  const trackY = y + 22
  const frac = (value - min) / (max - min)
  const knobX = x + frac * width
  const captureRef = useRef<{ id: number; el: SVGElement } | null>(null)
  const svgToVal = (svg: SVGSVGElement, clientX: number) => {
    const rect = svg.getBoundingClientRect()
    const scale = 1 / Math.min(rect.width / W, rect.height / H)
    const drawW = W / scale
    const offX = (rect.width - drawW) / 2
    const svgX = (clientX - rect.left - offX) * scale
    const raw = min + ((svgX - x) / width) * (max - min)
    const snapped = Math.round(raw / step) * step
    return Math.max(min, Math.min(max, Number(snapped.toFixed(3))))
  }
  const onPointerDown = (e: React.PointerEvent<SVGElement>) => {
    if (disabled) return
    e.stopPropagation()
    const svg = e.currentTarget.ownerSVGElement
    if (!svg) return
    ;(e.currentTarget as SVGElement).setPointerCapture(e.pointerId)
    captureRef.current = { id: e.pointerId, el: e.currentTarget as SVGElement }
    onChange(svgToVal(svg, e.clientX))
  }
  const onPointerMove = (e: React.PointerEvent<SVGElement>) => {
    if (disabled) return
    if (!captureRef.current) return
    const svg = (captureRef.current.el as SVGElement).ownerSVGElement
    if (!svg) return
    onChange(svgToVal(svg, e.clientX))
  }
  const onPointerUp = (_e: React.PointerEvent<SVGElement>) => {
    captureRef.current = null
  }
  const shownValue = hidden ? '?' : `${value.toFixed(step < 1 ? 1 : 0)} ${unit}`
  const trackColor = disabled || hidden ? '#3A4863' : '#54617A'
  const knobColor = disabled || hidden ? '#54617A' : '#37C9B8'
  return (
    <g>
      <text x={x + width / 2} y={y + 8} fill="#B9C4D6" fontFamily="'JetBrains Mono', monospace" fontSize={12} textAnchor="middle" letterSpacing="0.1em">
        {label}
      </text>
      {/* Hit area */}
      <rect
        x={x - 6} y={trackY - 14} width={width + 12} height={28}
        fill="transparent"
        style={{ cursor: disabled ? 'default' : 'pointer' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      />
      <line x1={x} y1={trackY} x2={x + width} y2={trackY} stroke={trackColor} strokeWidth={2} pointerEvents="none" />
      {!hidden && (
        <circle cx={knobX} cy={trackY} r={7} fill={knobColor} stroke="#0D1524" strokeWidth={2} pointerEvents="none" />
      )}
      {hidden && (
        <>
          <rect x={x + width / 2 - 10} y={trackY - 7} width={20} height={14} fill="#131F35" stroke="#54617A" strokeWidth={1} rx={2} pointerEvents="none" />
          <text x={x + width / 2} y={trackY + 3} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={11} textAnchor="middle" fontWeight={700} pointerEvents="none">?</text>
        </>
      )}
      <text x={x + width / 2} y={trackY + 26} fill={hidden ? '#6C7A93' : '#37C9B8'} fontFamily="'JetBrains Mono', monospace" fontSize={12} textAnchor="middle" letterSpacing="0.05em">
        {shownValue}
      </text>
    </g>
  )
}

// ─── Component symbols ─────────────────────────────────────────────
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

function ResistorSymbol({ label, active }: { label: string; active?: boolean }) {
  const bodyStroke = active ? '#37C9B8' : '#54617A'
  return (
    <g>
      <line x1={-32} y1={0} x2={-18} y2={0} stroke="#54617A" strokeWidth={2} />
      <line x1={18} y1={0} x2={32} y2={0} stroke="#54617A" strokeWidth={2} />
      <rect x={-18} y={-8} width={36} height={16} fill="#131F35" stroke={bodyStroke} strokeWidth={1.4} rx={2} />
      <text x={0} y={4} fill="#B9C4D6" fontFamily="'JetBrains Mono', monospace" fontSize={11} textAnchor="middle">{label}</text>
    </g>
  )
}

function AmmeterSymbol({ reading, showReading }: { reading: string; showReading: boolean }) {
  return (
    <g>
      <line x1={-32} y1={0} x2={-13} y2={0} stroke="#54617A" strokeWidth={2} />
      <line x1={13} y1={0} x2={32} y2={0} stroke="#54617A" strokeWidth={2} />
      <circle cx={0} cy={0} r={13} fill="#131F35" stroke="#54617A" strokeWidth={1.4} />
      <text x={0} y={4} fill="#B9C4D6" fontFamily="'JetBrains Mono', monospace" fontSize={11} textAnchor="middle" fontWeight={700}>A</text>
      {showReading && (
        <text x={0} y={-20} fill="#37C9B8" fontFamily="'JetBrains Mono', monospace" fontSize={11} textAnchor="middle">
          {reading}
        </text>
      )}
    </g>
  )
}

function VoltmeterSymbol({ reading, showReading }: { reading: string; showReading: boolean }) {
  return (
    <g>
      <line x1={-32} y1={0} x2={-13} y2={0} stroke="#54617A" strokeWidth={2} />
      <line x1={13} y1={0} x2={32} y2={0} stroke="#54617A" strokeWidth={2} />
      <circle cx={0} cy={0} r={13} fill="#131F35" stroke="#54617A" strokeWidth={1.4} />
      <text x={0} y={4} fill="#B9C4D6" fontFamily="'JetBrains Mono', monospace" fontSize={11} textAnchor="middle" fontWeight={700}>V</text>
      {showReading && (
        <text x={0} y={-20} fill="#37C9B8" fontFamily="'JetBrains Mono', monospace" fontSize={11} textAnchor="middle">
          {reading}
        </text>
      )}
    </g>
  )
}

// ─── Scene ─────────────────────────────────────────────────────────
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

  const complete = useComplete()
  const progress = useProgress()

  // ─── Slider state ─────────────────────────────────────────────
  const [E, setE] = useState(9)
  const [rInt, setRInt] = useState(1.5)
  const [R, setR] = useState(10)

  // Underlying (hidden) generator on stage 3.
  const deckIdx = seed % DECKS.length
  const deck = DECKS[deckIdx]!
  const [puzzleIdx, setPuzzleIdx] = useState(0)
  const currentPuzzle = deck[puzzleIdx] ?? deck[0]!

  // For stage 3 the visible plot uses hidden E, r; sliders show `?`.
  const effE = isStage3 ? currentPuzzle.E : E
  const effR_int = isStage3 ? currentPuzzle.r : rInt
  const { I, U } = solve(effE, effR_int, R)

  // Power readouts
  const P_delivered = U * I
  const P_lost = effR_int * I * I

  // ─── Stage 1 coverage ─────────────────────────────────────────
  const [sweptE, setSweptE] = useState(false)
  const [sweptR_int, setSweptR_int] = useState(false)
  const [sweptR, setSweptR] = useState(false)
  const [sawCurrent, setSawCurrent] = useState(false)
  const eRange = useRef<{ min: number; max: number }>({ min: E, max: E })
  const rRange = useRef<{ min: number; max: number }>({ min: rInt, max: rInt })
  const RRange = useRef<{ min: number; max: number }>({ min: R, max: R })

  useEffect(() => {
    if (!isStage1) return
    eRange.current = { min: Math.min(eRange.current.min, E), max: Math.max(eRange.current.max, E) }
    if (!sweptE && eRange.current.max - eRange.current.min >= 3) setSweptE(true)
  }, [E, isStage1, sweptE])

  useEffect(() => {
    if (!isStage1) return
    rRange.current = { min: Math.min(rRange.current.min, rInt), max: Math.max(rRange.current.max, rInt) }
    if (!sweptR_int && rRange.current.max - rRange.current.min >= 1) setSweptR_int(true)
  }, [rInt, isStage1, sweptR_int])

  useEffect(() => {
    if (!isStage1) return
    RRange.current = { min: Math.min(RRange.current.min, R), max: Math.max(RRange.current.max, R) }
    if (!sweptR && RRange.current.max - RRange.current.min >= 5) setSweptR(true)
  }, [R, isStage1, sweptR])

  useEffect(() => {
    if (!isStage1) return
    if (!sawCurrent && I > 0.05) setSawCurrent(true)
  }, [I, isStage1, sawCurrent])

  // ─── Stage 2 targets ──────────────────────────────────────────
  const targetSet = TARGET_SETS[seed % TARGET_SETS.length]!
  const [targetsHit, setTargetsHit] = useState<boolean[]>(() => targetSet.map(() => false))
  useEffect(() => {
    setTargetsHit(targetSet.map(() => false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed])

  useEffect(() => {
    if (!isStage2) return
    setTargetsHit((prev) => {
      let changed = false
      const next = prev.slice()
      for (let i = 0; i < targetSet.length; i++) {
        if (next[i]) continue
        const t = targetSet[i]!
        const dE = Math.abs(E - t.E) / Math.max(1e-6, t.E)
        const dr = Math.abs(rInt - t.r) / Math.max(1e-6, t.r)
        if (dE <= TOLERANCE && dr <= TOLERANCE) {
          next[i] = true
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [E, rInt, isStage2, targetSet])
  const stage2HitCount = targetsHit.filter(Boolean).length
  // Which target line to show as ghost: the first un-hit target, else last.
  const activeTargetIdx = targetsHit.findIndex((h) => !h)
  const activeTarget = targetSet[activeTargetIdx === -1 ? targetSet.length - 1 : activeTargetIdx]!

  // ─── Stage 3 state ────────────────────────────────────────────
  const [answerE, setAnswerE] = useState('')
  const [answerR, setAnswerR] = useState('')
  const [attemptsLeft, setAttemptsLeft] = useState(STAGE3_ATTEMPTS)
  const [submitFeedback, setSubmitFeedback] = useState<'correct' | 'wrong' | null>(null)
  const [deckCleared, setDeckCleared] = useState(false)
  const [peekText, setPeekText] = useState<string | null>(null)

  // ─── Reset ────────────────────────────────────────────────────
  const resetStageState = useCallback(() => {
    setE(9)
    setRInt(1.5)
    setR(10)
    setSweptE(false)
    setSweptR_int(false)
    setSweptR(false)
    setSawCurrent(false)
    eRange.current = { min: 9, max: 9 }
    rRange.current = { min: 1.5, max: 1.5 }
    RRange.current = { min: 10, max: 10 }
    setTargetsHit(targetSet.map(() => false))
    setPuzzleIdx(0)
    setAnswerE('')
    setAnswerR('')
    setAttemptsLeft(STAGE3_ATTEMPTS)
    setSubmitFeedback(null)
    setDeckCleared(false)
    setPeekText(null)
  }, [targetSet])
  useReset(resetStageState)

  // ─── Advance predicates ───────────────────────────────────────
  const stage1Done = sweptE && sweptR_int && sweptR && sawCurrent
  const stage2Done = stage2HitCount === targetSet.length
  const stage3Done = deckCleared
  const canSubmit = isStage1 ? stage1Done : isStage2 ? stage2Done : stage3Done

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

  // ─── Peek — strategy text, never the answer ───────────────────
  usePeek(() => {
    if (!isStage3) return
    setPeekText(labels.peek_tip ?? '')
  })
  useEffect(() => {
    if (!peekText) return
    const t = setTimeout(() => setPeekText(null), 6000)
    return () => clearTimeout(t)
  }, [peekText])

  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  // ─── Stage-3 submit ───────────────────────────────────────────
  const trySubmit = useCallback(() => {
    if (!isStage3) return
    const parsedE = Number(answerE)
    const parsedR = Number(answerR)
    if (!Number.isFinite(parsedE) || !Number.isFinite(parsedR)) return
    const truth = currentPuzzle
    const dE = Math.abs(parsedE - truth.E) / Math.max(1e-6, truth.E)
    const dr = Math.abs(parsedR - truth.r) / Math.max(1e-6, truth.r)
    const ok = dE <= TOLERANCE && dr <= TOLERANCE
    if (ok) {
      setSubmitFeedback('correct')
      // Move to next battery (or finish the deck) after a brief hold.
      window.setTimeout(() => {
        if (puzzleIdx + 1 >= deck.length) {
          setDeckCleared(true)
          setSubmitFeedback(null)
        } else {
          setPuzzleIdx((n) => n + 1)
          setAnswerE('')
          setAnswerR('')
          setAttemptsLeft(STAGE3_ATTEMPTS)
          setSubmitFeedback(null)
          setR(10)
        }
      }, 900)
    } else {
      setSubmitFeedback('wrong')
      setAttemptsLeft((n) => {
        const next = n - 1
        if (next <= 0) {
          // Blew the battery — reset the whole deck. Ace-the-deck: 3 in a row.
          window.setTimeout(() => {
            setPuzzleIdx(0)
            setAnswerE('')
            setAnswerR('')
            setAttemptsLeft(STAGE3_ATTEMPTS)
            setSubmitFeedback(null)
            setR(10)
          }, 1200)
        } else {
          window.setTimeout(() => setSubmitFeedback(null), 900)
        }
        return next
      })
    }
  }, [isStage3, answerE, answerR, currentPuzzle, puzzleIdx, deck.length])

  // ─── HUD text ─────────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`

  const fmtI = `${I.toFixed(2)} ${labels.unit_A}`
  const fmtU = `${U.toFixed(2)} ${labels.unit_V}`

  // TR: on stages 1+2, live P readouts + coverage/targets. On stage 3,
  // battery counter + attempts. Meter READINGS (U, I) stay visible in
  // the schematic on stage 3 — those are the required-info the student
  // is meant to use to deduce E, r. Powers and characteristic are help.
  let hudTR = ''
  if (isStage1) {
    const cov = [
      `${sweptE ? '✓' : '·'} ${labels.coverage_E}`,
      `${sweptR_int ? '✓' : '·'} ${labels.coverage_r}`,
      `${sweptR ? '✓' : '·'} ${labels.coverage_R}`,
      `${sawCurrent ? '✓' : '·'} ${labels.coverage_current}`,
    ].join('\n')
    hudTR = cov
  } else if (isStage2) {
    hudTR = `${labels.targets}: ${stage2HitCount}/${targetSet.length}`
  } else {
    hudTR = `${labels.battery_count} ${puzzleIdx + 1} ${labels.of_three}\n${labels.attempts_left}: ${attemptsLeft}`
  }

  // BL: contextual tip. On stage 3 peek overrides it.
  const hudBL = isStage3
    ? (peekText ?? labels.tip3)
    : isStage1
      ? labels.tip1
      : labels.tip2

  // ─── Plot rendering ───────────────────────────────────────────
  const yourLine = lineEndpoints(effE, effR_int)
  const targetLine = isStage2 ? lineEndpoints(activeTarget.E, activeTarget.r) : null
  const opX = mapI(I)
  const opY = mapU(U)

  // Show characteristic line on stages 1 & 2 only. On stage 3 the line
  // is the answer — hiding it is the whole point of the blind stage.
  const showCharacteristic = !isStage3

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block', userSelect: 'none', touchAction: 'none' }}
      >
        {/* Background. NO rx. */}
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        {/* Schematic panel */}
        <rect x={32} y={60} width={296} height={358} fill="none" stroke="#12203a" strokeWidth={1} rx={6} />
        <text x={40} y={52} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={11} letterSpacing="0.1em">
          {labels.schematic}
        </text>

        {/* Plot panel */}
        <rect x={340} y={60} width={260} height={358} fill="none" stroke="#12203a" strokeWidth={1} rx={6} />
        <text x={348} y={52} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={11} letterSpacing="0.1em">
          {labels.characteristic}
        </text>

        {/* Controls panel */}
        <rect x={608} y={60} width={160} height={358} fill="none" stroke="#12203a" strokeWidth={1} rx={6} />
        <text x={616} y={52} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={11} letterSpacing="0.1em">
          {labels.controls}
        </text>

        {/* ─── Schematic art ────────────────────────────────── */}
        {/* Outer loop rectangle (structural wires) */}
        {(() => {
          const LX = 100, RX = 260, TY = 130, BY = 340
          return (
            <g>
              {/* Corners */}
              {[[LX, TY], [RX, TY], [RX, BY], [LX, BY]].map(([x, y], i) => (
                <circle key={`c${i}`} cx={x} cy={y} r={2.5} fill="#3A4863" />
              ))}
              {/* Top arm w/ ammeter break at x=180 */}
              <line x1={LX} y1={TY} x2={180 - 32} y2={TY} stroke="#3A4863" strokeWidth={2} />
              <line x1={180 + 32} y1={TY} x2={RX} y2={TY} stroke="#3A4863" strokeWidth={2} />
              {/* Right arm w/ resistor R break at y=235 */}
              <line x1={RX} y1={TY} x2={RX} y2={235 - 32} stroke="#3A4863" strokeWidth={2} />
              <line x1={RX} y1={235 + 32} x2={RX} y2={BY} stroke="#3A4863" strokeWidth={2} />
              {/* Bottom arm (solid wire) */}
              <line x1={LX} y1={BY} x2={RX} y2={BY} stroke="#3A4863" strokeWidth={2} />
              {/* Left arm — inside a dashed "real battery" case containing E symbol + internal r */}
              {/* Wires above battery, between battery and r, and below r */}
              <line x1={LX} y1={TY} x2={LX} y2={180 - 32} stroke="#3A4863" strokeWidth={2} />
              <line x1={LX} y1={180 + 32} x2={LX} y2={260 - 18} stroke="#3A4863" strokeWidth={2} />
              <line x1={LX} y1={260 + 18} x2={LX} y2={BY} stroke="#3A4863" strokeWidth={2} />

              {/* Dashed "real battery" box */}
              <rect
                x={64} y={140} width={72} height={160}
                fill="none"
                stroke="#54617A"
                strokeWidth={1}
                strokeDasharray="4 4"
                rx={4}
              />
              <text x={100} y={132} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={10} textAnchor="middle" letterSpacing="0.08em">
                {labels.battery_case}
              </text>

              {/* Battery symbol at (100, 180) — vertical orientation */}
              <g transform={`translate(${100}, ${180}) rotate(90)`}>
                <BatterySymbol />
              </g>
              {/* Internal r resistor at (100, 260) */}
              <g transform={`translate(${100}, ${260}) rotate(90)`}>
                <ResistorSymbol label={labels.slider_r} />
              </g>

              {/* Ammeter at (180, 130) — horizontal */}
              <g transform={`translate(${180}, ${130})`}>
                <AmmeterSymbol reading={fmtI} showReading={true} />
              </g>

              {/* Load R at (260, 235) — vertical */}
              <g transform={`translate(${260}, ${235}) rotate(90)`}>
                <ResistorSymbol label={labels.slider_R} />
              </g>

              {/* Voltmeter branch: two dashed wires from the battery-case terminals
                  meeting a V circle to the right of the case. Shows U (terminal voltage). */}
              <line x1={100} y1={140} x2={148} y2={140} stroke="#54617A" strokeWidth={1} strokeDasharray="3 3" />
              <line x1={148} y1={140} x2={148} y2={215} stroke="#54617A" strokeWidth={1} strokeDasharray="3 3" />
              <line x1={100} y1={300} x2={148} y2={300} stroke="#54617A" strokeWidth={1} strokeDasharray="3 3" />
              <line x1={148} y1={300} x2={148} y2={255} stroke="#54617A" strokeWidth={1} strokeDasharray="3 3" />
              <g transform={`translate(${148}, ${235})`}>
                <VoltmeterSymbol reading={fmtU} showReading={true} />
              </g>

              {/* Current-flow markers (stages 1 + 2 only) — animated dots
                  around the outer loop when I > 0. Hidden on stage 3. */}
              {!isStage3 && I > 0.02 && (
                <g>
                  <path
                    id="flow-path"
                    d={`M ${LX} ${TY} L ${RX} ${TY} L ${RX} ${BY} L ${LX} ${BY} Z`}
                    fill="none" stroke="none"
                  />
                  {[0, 0.6, 1.2, 1.8].map((delay) => (
                    <circle key={`f${delay}`} r={2.5} fill="#37C9B8">
                      <animateMotion dur="2.4s" repeatCount="indefinite" begin={`${delay}s`}>
                        <mpath href="#flow-path" />
                      </animateMotion>
                    </circle>
                  ))}
                </g>
              )}
            </g>
          )
        })()}

        {/* Power / operating-point strip below the schematic (stages 1+2 only) */}
        {!isStage3 && (
          <g>
            <text x={40} y={392} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={11} letterSpacing="0.08em">
              P_delivered = U·I = <tspan fill="#37C9B8">{P_delivered.toFixed(2)} {labels.unit_W}</tspan>
            </text>
            <text x={40} y={408} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={11} letterSpacing="0.08em">
              P_lost = r·I² = <tspan fill="#F9A968">{P_lost.toFixed(2)} {labels.unit_W}</tspan>
            </text>
          </g>
        )}

        {/* ─── U(I) plot ─────────────────────────────────────── */}
        {/* Axes */}
        <g>
          {/* Origin at (PLOT_X0, PLOT_Y0) */}
          <line x1={PLOT_X0} y1={PLOT_Y1 - 6} x2={PLOT_X0} y2={PLOT_Y0} stroke="#3A4863" strokeWidth={1.4} />
          <line x1={PLOT_X0} y1={PLOT_Y0} x2={PLOT_X1 + 6} y2={PLOT_Y0} stroke="#3A4863" strokeWidth={1.4} />
          {/* Axis labels */}
          <text x={PLOT_X0 - 8} y={PLOT_Y1 - 8} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={10} textAnchor="start">
            {labels.axis_U}
          </text>
          <text x={PLOT_X1 + 6} y={PLOT_Y0 + 14} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={10} textAnchor="end">
            {labels.axis_I}
          </text>
          {/* Tick labels on U axis */}
          {[0, 5, 10, 15].map((u) => (
            <g key={`tu${u}`}>
              <line x1={PLOT_X0 - 3} y1={mapU(u)} x2={PLOT_X0} y2={mapU(u)} stroke="#3A4863" />
              <text x={PLOT_X0 - 6} y={mapU(u) + 3} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={9} textAnchor="end">{u}</text>
            </g>
          ))}
          {/* Tick labels on I axis */}
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <g key={`ti${i}`}>
              <line x1={mapI(i)} y1={PLOT_Y0} x2={mapI(i)} y2={PLOT_Y0 + 3} stroke="#3A4863" />
              <text x={mapI(i)} y={PLOT_Y0 + 14} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={9} textAnchor="middle">{i}</text>
            </g>
          ))}
        </g>

        {/* Target ghost line (stage 2 only) */}
        {targetLine && (
          <g>
            <line
              x1={targetLine.x1} y1={targetLine.y1}
              x2={targetLine.x2} y2={targetLine.y2}
              stroke="#F9A968"
              strokeWidth={1.6}
              strokeDasharray="6 4"
              opacity={0.85}
            />
            <text x={targetLine.x1 + 6} y={targetLine.y1 + 12} fill="#F9A968" fontFamily="'JetBrains Mono', monospace" fontSize={9} letterSpacing="0.06em">
              {labels.target_line}
            </text>
          </g>
        )}

        {/* Your characteristic line (stages 1+2) */}
        {showCharacteristic && (
          <line
            x1={yourLine.x1} y1={yourLine.y1}
            x2={yourLine.x2} y2={yourLine.y2}
            stroke="#37C9B8"
            strokeWidth={2}
          />
        )}

        {/* Operating point marker — always visible (it's a required-info
            live reading, matching the U, I meter numbers). */}
        <circle cx={opX} cy={opY} r={4} fill="#37C9B8" stroke="#0D1524" strokeWidth={1.6} />
        {!isStage3 && (
          <text x={opX + 8} y={opY - 6} fill="#B9C4D6" fontFamily="'JetBrains Mono', monospace" fontSize={9}>
            {labels.op_point}
          </text>
        )}

        {/* On stage 3, mark plot origin area with "?" to signal the line is hidden */}
        {isStage3 && (
          <text x={(PLOT_X0 + PLOT_X1) / 2} y={PLOT_Y1 + 18} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={11} textAnchor="middle" opacity={0.7}>
            U(I) — {labels.hidden}
          </text>
        )}

        {/* ─── Controls panel — sliders ───────────────────────── */}
        <Slider
          x={620} y={90} width={136}
          label={`${labels.slider_E} (${labels.unit_V})`}
          unit={labels.unit_V}
          min={E_MIN} max={E_MAX} step={E_STEP}
          value={E}
          onChange={setE}
          hidden={isStage3}
          disabled={isStage3}
        />
        <Slider
          x={620} y={158} width={136}
          label={`${labels.slider_r} (${labels.unit_Ohm})`}
          unit={labels.unit_Ohm}
          min={R_INT_MIN} max={R_INT_MAX} step={R_INT_STEP}
          value={rInt}
          onChange={setRInt}
          hidden={isStage3}
          disabled={isStage3}
        />
        <Slider
          x={620} y={226} width={136}
          label={`${labels.slider_R} (${labels.unit_Ohm})`}
          unit={labels.unit_Ohm}
          min={R_LOAD_MIN} max={R_LOAD_MAX} step={R_LOAD_STEP}
          value={R}
          onChange={setR}
        />

        {/* Stage-3 answer entry */}
        {isStage3 && !deckCleared && (
          <foreignObject x={614} y={290} width={148} height={124}>
            <div style={{
              display: 'flex', flexDirection: 'column', gap: '4rem',
              fontFamily: "'JetBrains Mono', monospace",
              color: '#B9C4D6',
              width: '100%',
            }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                <span style={{ fontSize: '1.4rem', letterSpacing: '0.06em', color: '#6C7A93' }}>{labels.solve_for_E}</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={answerE}
                  onChange={(e) => setAnswerE(e.target.value)}
                  style={{
                    background: '#131F35',
                    border: `1px solid ${submitFeedback === 'wrong' ? '#EF4444' : '#3A4863'}`,
                    borderRadius: '2rem',
                    color: '#37C9B8',
                    padding: '2rem 4rem',
                    fontSize: '2.2rem',
                    fontFamily: 'inherit',
                    outline: 'none',
                    width: '100%',
                    boxSizing: 'border-box',
                  }}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                <span style={{ fontSize: '1.4rem', letterSpacing: '0.06em', color: '#6C7A93' }}>{labels.solve_for_r}</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={answerR}
                  onChange={(e) => setAnswerR(e.target.value)}
                  style={{
                    background: '#131F35',
                    border: `1px solid ${submitFeedback === 'wrong' ? '#EF4444' : '#3A4863'}`,
                    borderRadius: '2rem',
                    color: '#37C9B8',
                    padding: '2rem 4rem',
                    fontSize: '2.2rem',
                    fontFamily: 'inherit',
                    outline: 'none',
                    width: '100%',
                    boxSizing: 'border-box',
                  }}
                />
              </label>
              <button
                onClick={trySubmit}
                disabled={answerE.trim() === '' || answerR.trim() === ''}
                style={{
                  background: '#37C9B8',
                  color: '#0D1524',
                  border: 'none',
                  borderRadius: '2rem',
                  padding: '2.4rem 0',
                  fontSize: '1.6rem',
                  fontFamily: 'inherit',
                  fontWeight: 700,
                  letterSpacing: '0.12em',
                  cursor: (answerE.trim() === '' || answerR.trim() === '') ? 'not-allowed' : 'pointer',
                  opacity: (answerE.trim() === '' || answerR.trim() === '') ? 0.5 : 1,
                }}
              >
                {labels.submit_answer}
              </button>
            </div>
          </foreignObject>
        )}
      </svg>

      {/* HUD overlays (HTML, `rem` units) */}
      <div style={{ position: 'absolute', top: '3rem', left: '3rem', fontFamily: "'JetBrains Mono', monospace", fontSize: '2.3rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: '#6C7A93', zIndex: 5, pointerEvents: 'none' }}>
        {hudTL}
      </div>
      <div style={{
        position: 'absolute', top: '3rem', right: '3rem',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '1.5rem', letterSpacing: '0.08em',
        color: canSubmit ? '#37C9B8' : (isStage3 && submitFeedback === 'wrong' ? '#EF4444' : '#B9C4D6'),
        zIndex: 5, pointerEvents: 'none', textAlign: 'right',
        whiteSpace: 'pre-line',
      }}>
        {hudTR}
      </div>
      <div style={{
        position: 'absolute', bottom: '3rem', left: '3rem',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '1.7rem', letterSpacing: '0.06em',
        color: peekText ? '#37C9B8' : '#6C7A93',
        zIndex: 5, pointerEvents: 'none', maxWidth: '55%',
        lineHeight: 1.35,
      }}>
        {hudBL}
      </div>
      {/* BR corner reserved for parent chrome — intentionally empty. */}
    </div>
  )
}
