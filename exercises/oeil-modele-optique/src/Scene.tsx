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

// ─── Scene constants ────────────────────────────────────────────────────
const W = 800
const H = 450

// Reduced-eye layout (SVG coords, y-down).
const AXIS_Y = 240
const LENS_X = 300
const OBJECT_X = 90 // fixed display anchor for the object arrow; the label carries the real distance
const PX_PER_MM = 8 // 17 mm eye → 136 SVG px behind lens (retina at x = 436 for normal eye)

// Draggable primitive: F' along the optical axis. f' in millimetres.
const F_MIN_MM = 12
const F_MAX_MM = 24
const DEFAULT_FPRIME_MM = 17

// Hit tolerance on the image distance (mm on the axis, i.e., how close the
// image must land to the retina). 0.3 mm ≈ 2.4 SVG px → tight but achievable
// via the on-axis drag.
const HIT_TOL_MM = 0.3

// Post-submit flash duration (feedback lives here — never live per §4.7).
const FLASH_MS = 900

// Normal (undefective) eye — used for stages 1 & 2.
const NORMAL_EYE_LENGTH_MM = 17

// Stage-2 experiment: three seeded object distances, five shot budget.
type ObjectDistance = number // use Number.POSITIVE_INFINITY for ∞
type TargetSpec = { id: string; d: ObjectDistance; label: string }

const STAGE2_TARGETS: TargetSpec[] = [
  { id: 'far', d: Number.POSITIVE_INFINITY, label: '∞' },
  { id: 'mid', d: 1000, label: '1 m' },
  { id: 'near', d: 250, label: '25 cm' },
]
const STAGE2_SHOT_BUDGET = 5

// Stage-3 setups — hand-authored so each has a workable f' in [F_MIN, F_MAX].
// Seed picks the initial setup; consecutive failures cycle through them so
// the student cannot brute-force by re-attempting the same numbers.
type EyeVariant = 'myopia' | 'hypermetropia'
type Stage3Setup = {
  eyeLengthMm: number
  variant: EyeVariant
  targets: TargetSpec[]
}
const STAGE3_SETUPS: Stage3Setup[] = [
  {
    eyeLengthMm: 15,
    variant: 'hypermetropia',
    targets: [
      { id: 's0a', d: 500, label: '50 cm' },
      { id: 's0b', d: 200, label: '20 cm' },
    ],
  },
  {
    eyeLengthMm: 20,
    variant: 'myopia',
    targets: [
      { id: 's1a', d: Number.POSITIVE_INFINITY, label: '∞' },
      { id: 's1b', d: 500, label: '50 cm' },
    ],
  },
  {
    eyeLengthMm: 18,
    variant: 'myopia',
    targets: [
      { id: 's2a', d: 1000, label: '1 m' },
      { id: 's2b', d: 250, label: '25 cm' },
    ],
  },
  {
    eyeLengthMm: 16,
    variant: 'hypermetropia',
    targets: [
      { id: 's3a', d: Number.POSITIVE_INFINITY, label: '∞' },
      { id: 's3b', d: 400, label: '40 cm' },
    ],
  },
]

// ─── Physics ────────────────────────────────────────────────────────────
// Image distance d' from thin-lens conjugation: 1/f' = 1/d + 1/d'.
// Object at infinity → d' = f' (image at rear focal point).
// Otherwise d' = f'·d / (d − f'); returns +∞ if the object is at/inside F.
function imageDistanceMm(fprimeMm: number, dMm: ObjectDistance): number {
  if (!isFinite(dMm)) return fprimeMm
  const denom = dMm - fprimeMm
  if (denom <= 0) return Number.POSITIVE_INFINITY
  return (fprimeMm * dMm) / denom
}

// ─── Locale glue ────────────────────────────────────────────────────────
const dict = { en } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── Component ──────────────────────────────────────────────────────────
export default function Scene() {
  const { locale, seed } = useInit()
  const stages = useMemo(() => getStagesFor(locale), [locale])
  useDeclareStages(stages)
  const labels = useMemo(() => svgLabels(locale), [locale])

  const stageIdx = useCurrentStage()
  const setStage = useSetStage()

  const [fprime, setFprime] = useState(DEFAULT_FPRIME_MM)
  const [dragging, setDragging] = useState(false)
  const [moved, setMoved] = useState(false)
  const [lit, setLit] = useState<string[]>([])
  const [shots, setShots] = useState(0)
  const [targetIdx, setTargetIdx] = useState(0)
  const [flash, setFlash] = useState<{ hit: boolean; at: number } | null>(null)
  const [tick, setTick] = useState(0)
  const [peekVisible, setPeekVisible] = useState(false)
  const [cycleIdx, setCycleIdx] = useState(0)

  const svgRef = useRef<SVGSVGElement>(null)
  const rafRef = useRef<number>(0)

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  // Seeded stage-3 setup, cycling on failure.
  const stage3Setup = useMemo(
    () => STAGE3_SETUPS[(seed + cycleIdx) % STAGE3_SETUPS.length]!,
    [seed, cycleIdx],
  )

  const eyeLengthMm = isStage3 ? stage3Setup.eyeLengthMm : NORMAL_EYE_LENGTH_MM
  const retinaX = LENS_X + eyeLengthMm * PX_PER_MM

  const activeTargets: TargetSpec[] = isStage2
    ? STAGE2_TARGETS
    : isStage3
      ? stage3Setup.targets
      : [{ id: 'obs', d: Number.POSITIVE_INFINITY, label: '∞' }]

  // "Current" target for the object-arrow label and stage-3 targeting.
  // Stage 2: next unlit; Stage 3: targetIdx; Stage 1: fixed at ∞.
  const currentTarget: TargetSpec = isStage1
    ? activeTargets[0]!
    : isStage2
      ? (STAGE2_TARGETS.find((t) => !lit.includes(t.id)) ?? STAGE2_TARGETS[STAGE2_TARGETS.length - 1]!)
      : (activeTargets[Math.min(targetIdx, activeTargets.length - 1)] ?? activeTargets[0]!)

  const complete = useComplete()
  const progress = useProgress()

  const resetStageState = useCallback(() => {
    setFprime(DEFAULT_FPRIME_MM)
    setMoved(false)
    setLit([])
    setShots(0)
    setTargetIdx(0)
    setFlash(null)
    setPeekVisible(false)
  }, [])
  useReset(resetStageState)

  const canFire = isStage2
    ? shots < STAGE2_SHOT_BUDGET && lit.length < STAGE2_TARGETS.length
    : isStage3
      ? targetIdx < activeTargets.length
      : false

  const fire = useCallback(() => {
    if (!canFire) return
    if (isStage2) {
      // Each fire checks all unlit targets; only one can match (unique f' per d).
      const unlit = STAGE2_TARGETS.filter((t) => !lit.includes(t.id))
      const newlyLit: string[] = []
      for (const t of unlit) {
        const dImg = imageDistanceMm(fprime, t.d)
        if (Math.abs(dImg - NORMAL_EYE_LENGTH_MM) < HIT_TOL_MM) newlyLit.push(t.id)
      }
      setShots((s) => s + 1)
      if (newlyLit.length) setLit((prev) => [...prev, ...newlyLit])
      setFlash({ hit: newlyLit.length > 0, at: Date.now() })
      setTick(Date.now())
    } else if (isStage3) {
      // One shot per target, hit-or-miss. §5.2 anti-brute-force rule.
      const t = activeTargets[targetIdx]
      if (!t) return
      const dImg = imageDistanceMm(fprime, t.d)
      const hit = Math.abs(dImg - eyeLengthMm) < HIT_TOL_MM
      if (hit) setLit((prev) => [...prev, t.id])
      setTargetIdx((i) => i + 1)
      setFlash({ hit, at: Date.now() })
      setTick(Date.now())
    }
  }, [canFire, isStage2, isStage3, fprime, lit, targetIdx, activeTargets, eyeLengthMm])

  // Stage-3 fail-with-cycle: all shots spent without lighting all → reset + next setup.
  useEffect(() => {
    if (!isStage3) return
    const allShotsFired = targetIdx >= activeTargets.length
    const allLit = lit.length === activeTargets.length
    if (allShotsFired && !allLit) {
      const t = setTimeout(() => {
        setCycleIdx((c) => c + 1)
        resetStageState()
      }, 1200)
      return () => clearTimeout(t)
    }
  }, [isStage3, targetIdx, lit.length, activeTargets.length, resetStageState])

  // Flash animation (rAF, cosmetic — not physics).
  useEffect(() => {
    if (!flash) return
    const step = () => {
      const now = Date.now()
      if (now - flash.at >= FLASH_MS) {
        setFlash(null)
        return
      }
      setTick(now)
      rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(rafRef.current)
  }, [flash])

  const canSubmit = isStage1
    ? moved
    : isStage2
      ? lit.length === activeTargets.length
      : targetIdx >= activeTargets.length && lit.length === activeTargets.length

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

  usePeek(() => {
    if (!isStage3) return
    setPeekVisible(true)
  })
  useEffect(() => {
    if (!peekVisible) return
    const t = setTimeout(() => setPeekVisible(false), 3000)
    return () => clearTimeout(t)
  }, [peekVisible])

  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  // Spacebar fires on stages 2 & 3.
  useEffect(() => {
    if (isStage1) return
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault()
        fire()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isStage1, fire])

  // ─── Pointer / drag on F' ─────────────────────────────────────────────
  const svgPoint = (e: React.PointerEvent) => {
    const el = svgRef.current
    if (!el) return null
    const rect = el.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) / rect.width) * W,
      y: ((e.clientY - rect.top) / rect.height) * H,
    }
  }
  const applyDrag = (p: { x: number; y: number }) => {
    const rawMm = (p.x - LENS_X) / PX_PER_MM
    const clamped = Math.max(F_MIN_MM, Math.min(F_MAX_MM, rawMm))
    setFprime(clamped)
    if (isStage1 && !moved && Math.abs(clamped - DEFAULT_FPRIME_MM) > 1) setMoved(true)
  }
  const handleDown = (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragging(true)
    const p = svgPoint(e)
    if (p) applyDrag(p)
  }
  const svgMove = (e: React.PointerEvent) => {
    if (!dragging) return
    const p = svgPoint(e)
    if (p) applyDrag(p)
  }

  // ─── Rendering geometry ───────────────────────────────────────────────
  const fprimeX = LENS_X + fprime * PX_PER_MM
  const activeObjectD = currentTarget.d
  const dImg = imageDistanceMm(fprime, activeObjectD)
  const focusX = isFinite(dImg) ? LENS_X + dImg * PX_PER_MM : W + 200
  const focusOnRetina = isFinite(dImg) && Math.abs(dImg - eyeLengthMm) < HIT_TOL_MM

  // Flash opacity 0..1
  let flashOp = 0
  if (flash) {
    const elapsed = Math.max(0, tick - flash.at)
    flashOp = Math.max(0, 1 - elapsed / FLASH_MS)
  }

  const showRays = isStage1 || isStage2 // help — hidden on stage 3 (§4.7)
  const showFocusDot = isStage1 || isStage2
  const showFireButton = !isStage1

  // Grid on stage 3 for spatial orientation while reading the labels.
  const gridLines: React.ReactNode[] = []
  if (isStage3) {
    for (let gx = 0; gx <= W; gx += 50) {
      gridLines.push(
        <line
          key={`gx${gx}`}
          x1={gx}
          y1={0}
          x2={gx}
          y2={H}
          stroke="#12203a"
          strokeWidth={gx % 100 === 0 ? 1 : 0.5}
          opacity={gx % 100 === 0 ? 1 : 0.6}
        />,
      )
    }
    for (let gy = 0; gy <= H; gy += 50) {
      gridLines.push(
        <line
          key={`gy${gy}`}
          x1={0}
          y1={gy}
          x2={W}
          y2={gy}
          stroke="#12203a"
          strokeWidth={gy % 100 === 0 ? 1 : 0.5}
          opacity={gy % 100 === 0 ? 1 : 0.6}
        />,
      )
    }
  } else {
    for (let gx = 40; gx < W; gx += 60) {
      gridLines.push(
        <line key={`gx${gx}`} x1={gx} y1={0} x2={gx} y2={H} stroke="#12203a" strokeWidth={1} />,
      )
    }
    for (let gy = 40; gy < H; gy += 60) {
      gridLines.push(
        <line key={`gy${gy}`} x1={0} y1={gy} x2={W} y2={gy} stroke="#12203a" strokeWidth={1} />,
      )
    }
  }

  // HUD text
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`
  const hudTR_line1 = `f' = ${fprime.toFixed(2)} mm`
  const hudBL = isStage1 ? labels.tip1 : isStage2 ? labels.tip2 : labels.tip3

  // Sclera outline (decorative eye body). Stretches with retinaX.
  const scleraPath =
    `M ${LENS_X - 30} ${AXIS_Y - 88}` +
    ` C ${LENS_X - 55} ${AXIS_Y - 50}, ${LENS_X - 55} ${AXIS_Y + 50}, ${LENS_X - 30} ${AXIS_Y + 88}` +
    ` C ${LENS_X - 15} ${AXIS_Y + 100}, ${retinaX - 20} ${AXIS_Y + 92}, ${retinaX + 6} ${AXIS_Y}` +
    ` C ${retinaX - 20} ${AXIS_Y - 92}, ${LENS_X - 15} ${AXIS_Y - 100}, ${LENS_X - 30} ${AXIS_Y - 88}` +
    ` Z`

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
          touchAction: 'none',
          userSelect: 'none',
        }}
        onPointerMove={svgMove}
        onPointerUp={() => setDragging(false)}
        onPointerLeave={() => setDragging(false)}
      >
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />
        {gridLines}

        {/* Eye body (sclera) */}
        <path
          d={scleraPath}
          fill="rgba(30,42,64,0.55)"
          stroke="rgba(108,122,147,0.45)"
          strokeWidth={1.5}
        />

        {/* Optical axis (dashed) */}
        <line
          x1={10}
          y1={AXIS_Y}
          x2={W - 10}
          y2={AXIS_Y}
          stroke="#6C7A93"
          strokeWidth={1}
          strokeDasharray="4 5"
        />

        {/* Retina — curved orange arc at the eye's back wall */}
        <path
          d={`M ${retinaX - 4} ${AXIS_Y - 72} Q ${retinaX + 14} ${AXIS_Y} ${retinaX - 4} ${AXIS_Y + 72}`}
          fill="none"
          stroke="#F9A968"
          strokeWidth={2.5}
        />

        {/* Iris (two short flaps flanking the lens, decorative) */}
        <line
          x1={LENS_X}
          y1={AXIS_Y - 88}
          x2={LENS_X}
          y2={AXIS_Y - 62}
          stroke="rgba(108,122,147,0.6)"
          strokeWidth={3}
          strokeLinecap="round"
        />
        <line
          x1={LENS_X}
          y1={AXIS_Y + 62}
          x2={LENS_X}
          y2={AXIS_Y + 88}
          stroke="rgba(108,122,147,0.6)"
          strokeWidth={3}
          strokeLinecap="round"
        />

        {/* Crystalline (thin bi-convex lens) */}
        <ellipse
          cx={LENS_X}
          cy={AXIS_Y}
          rx={10}
          ry={60}
          fill="rgba(55,201,184,0.15)"
          stroke="#37C9B8"
          strokeWidth={2}
        />
        <polyline
          points={`${LENS_X - 8},${AXIS_Y - 54} ${LENS_X},${AXIS_Y - 62} ${LENS_X + 8},${AXIS_Y - 54}`}
          fill="none"
          stroke="#37C9B8"
          strokeWidth={2}
        />
        <polyline
          points={`${LENS_X - 8},${AXIS_Y + 54} ${LENS_X},${AXIS_Y + 62} ${LENS_X + 8},${AXIS_Y + 54}`}
          fill="none"
          stroke="#37C9B8"
          strokeWidth={2}
        />

        {/* Object arrow — displayed at fixed x, label carries the physical d */}
        <line
          x1={OBJECT_X}
          y1={AXIS_Y}
          x2={OBJECT_X}
          y2={AXIS_Y - 34}
          stroke="#EAF0FA"
          strokeWidth={2.5}
        />
        <polyline
          points={`${OBJECT_X - 6},${AXIS_Y - 26} ${OBJECT_X},${AXIS_Y - 34} ${OBJECT_X + 6},${AXIS_Y - 26}`}
          fill="none"
          stroke="#EAF0FA"
          strokeWidth={2.5}
        />
        <text
          x={OBJECT_X}
          y={AXIS_Y + 22}
          fill="#B9C4D6"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={11}
          textAnchor="middle"
        >
          {labels.objectAt} = {currentTarget.label}
        </text>

        {/* Rays — stage 1 & 2 only. §4.7: hidden on stage 3. */}
        {showRays && !isFinite(activeObjectD) && (
          <g>
            {[-32, 0, 32].map((offset) => {
              const y = AXIS_Y + offset
              const dx = fprimeX - LENS_X
              const dy = AXIS_Y - y
              const extend = 2.6
              return (
                <g key={`inf${offset}`}>
                  <line
                    x1={0}
                    y1={y}
                    x2={LENS_X}
                    y2={y}
                    stroke="rgba(249,115,22,.22)"
                    strokeWidth={7}
                    strokeLinecap="round"
                  />
                  <line
                    x1={0}
                    y1={y}
                    x2={LENS_X}
                    y2={y}
                    stroke="#F97316"
                    strokeWidth={1.8}
                    strokeLinecap="round"
                  />
                  <line
                    x1={LENS_X}
                    y1={y}
                    x2={LENS_X + dx * extend}
                    y2={y + dy * extend}
                    stroke="rgba(249,115,22,.22)"
                    strokeWidth={7}
                    strokeLinecap="round"
                  />
                  <line
                    x1={LENS_X}
                    y1={y}
                    x2={LENS_X + dx * extend}
                    y2={y + dy * extend}
                    stroke="#F97316"
                    strokeWidth={1.8}
                    strokeLinecap="round"
                  />
                </g>
              )
            })}
          </g>
        )}

        {showRays && isFinite(activeObjectD) && (() => {
          const B = { x: OBJECT_X, y: AXIS_Y - 34 }
          // Ray 1: from B parallel to axis, refracts through F'.
          const dx = fprimeX - LENS_X
          const dy = AXIS_Y - B.y
          const extend = 2.6
          const ray1End = { x: LENS_X + dx * extend, y: B.y + dy * extend }
          // Ray 2: from B through O (lens centre), continues straight.
          const d2x = LENS_X - B.x
          const d2y = AXIS_Y - B.y
          const t = (W - 40 - LENS_X) / d2x
          const ray2End = { x: LENS_X + d2x * t, y: AXIS_Y + d2y * t }
          return (
            <g>
              <line x1={B.x} y1={B.y} x2={LENS_X} y2={B.y} stroke="rgba(249,115,22,.22)" strokeWidth={7} strokeLinecap="round" />
              <line x1={B.x} y1={B.y} x2={LENS_X} y2={B.y} stroke="#F97316" strokeWidth={1.8} strokeLinecap="round" />
              <line x1={LENS_X} y1={B.y} x2={ray1End.x} y2={ray1End.y} stroke="rgba(249,115,22,.22)" strokeWidth={7} strokeLinecap="round" />
              <line x1={LENS_X} y1={B.y} x2={ray1End.x} y2={ray1End.y} stroke="#F97316" strokeWidth={1.8} strokeLinecap="round" />
              <line x1={B.x} y1={B.y} x2={ray2End.x} y2={ray2End.y} stroke="rgba(249,115,22,.22)" strokeWidth={7} strokeLinecap="round" />
              <line x1={B.x} y1={B.y} x2={ray2End.x} y2={ray2End.y} stroke="#F97316" strokeWidth={1.8} strokeLinecap="round" />
            </g>
          )
        })()}

        {/* Focus indicator on axis — stage 1 & 2 (visual hit/miss). §4.7 help. */}
        {showFocusDot && isFinite(dImg) && focusX > LENS_X + 8 && focusX < W - 10 && (
          <g>
            <circle
              cx={focusX}
              cy={AXIS_Y}
              r={11}
              fill={focusOnRetina ? '#37C9B8' : '#F9A968'}
              opacity={0.28}
            />
            <circle
              cx={focusX}
              cy={AXIS_Y}
              r={5}
              fill={focusOnRetina ? '#37C9B8' : '#F9A968'}
            />
          </g>
        )}

        {/* Coordinate labels — stage 3 required information (§4.7). */}
        {isStage3 && (
          <>
            <text
              x={LENS_X - 12}
              y={AXIS_Y - 110}
              fill="#EAF0FA"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={11}
            >
              O
            </text>
            <text
              x={OBJECT_X}
              y={AXIS_Y - 44}
              fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={12}
              fontWeight={700}
              textAnchor="middle"
            >
              {labels.objectAt} = {currentTarget.label}
            </text>
            <text
              x={retinaX - 18}
              y={AXIS_Y - 92}
              fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={12}
              fontWeight={700}
              textAnchor="end"
            >
              {labels.retinaAt} = {eyeLengthMm} mm
            </text>
          </>
        )}

        {/* F' handle — the DOF (draggable primitive) */}
        <g onPointerDown={handleDown} style={{ cursor: dragging ? 'grabbing' : 'grab' }}>
          <circle cx={fprimeX} cy={AXIS_Y} r={18} fill="rgba(249,115,22,0.22)" />
          <circle
            cx={fprimeX}
            cy={AXIS_Y}
            r={9}
            fill="#F97316"
            stroke="#FFFFFF"
            strokeWidth={1.5}
          />
          <text
            x={fprimeX}
            y={AXIS_Y - 24}
            fill="#F9A968"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={13}
            fontWeight={700}
            textAnchor="middle"
          >
            F'
          </text>
        </g>

        {/* Post-submit flash (§4.7 rule 3: feedback post-submit only) */}
        {flash && flashOp > 0 && (
          <rect
            x={0}
            y={0}
            width={W}
            height={H}
            fill={flash.hit ? '#37C9B8' : '#F9A968'}
            opacity={flashOp * 0.14}
            pointerEvents="none"
          />
        )}

        {/* Peek badge — strategy hint + current f' (§4.7 rule 4). Stage 3 only. */}
        {isStage3 && peekVisible && (
          <g>
            <rect
              x={W / 2 - 210}
              y={10}
              width={420}
              height={62}
              rx={12}
              fill="rgba(13,21,36,.92)"
              stroke="#F97316"
              strokeWidth={1.5}
            />
            <text
              x={W / 2}
              y={32}
              fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={11}
              textAnchor="middle"
              letterSpacing="0.06em"
            >
              1/f' = 1/d + 1/d' — read d, d' from labels
            </text>
            <text
              x={W / 2}
              y={56}
              fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={13}
              fontWeight={700}
              textAnchor="middle"
              letterSpacing="0.1em"
            >
              current f' = {fprime.toFixed(2)} mm
            </text>
          </g>
        )}
      </svg>

      {/* HUD overlays (HTML, in rem) */}
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

      {/* TR: current DOF readout + progress. Kept required-info only per §4.7. */}
      <div
        style={{
          position: 'absolute',
          top: '3rem',
          right: '3rem',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '2.3rem',
          letterSpacing: '0.08em',
          color: '#37C9B8',
          textAlign: 'right',
          zIndex: 5,
          pointerEvents: 'none',
        }}
      >
        {hudTR_line1}
        {(isStage2 || isStage3) && (
          <div
            style={{
              fontSize: '1.7rem',
              letterSpacing: '0.06em',
              color: '#B9C4D6',
              marginTop: '0.6rem',
            }}
          >
            {labels.hits} {lit.length}/{activeTargets.length}
            {isStage2 && ` · ${labels.shots} ${shots}/${STAGE2_SHOT_BUDGET}`}
            {isStage3 &&
              ` · ${labels.target} ${Math.min(targetIdx + 1, activeTargets.length)}/${activeTargets.length}`}
          </div>
        )}
      </div>

      {/* BL: contextual tip */}
      <div
        style={{
          position: 'absolute',
          bottom: '3rem',
          left: '3rem',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '2.3rem',
          letterSpacing: '0.06em',
          color: '#6C7A93',
          zIndex: 5,
          pointerEvents: 'none',
        }}
      >
        {hudBL}
      </div>

      {/* BR intentionally empty — reserved for parent chrome (fullscreen). */}

      {/* Fire button — bottom-centre pill */}
      {showFireButton && (
        <button
          type="button"
          onClick={fire}
          disabled={!canFire}
          style={{
            position: 'absolute',
            bottom: '3rem',
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '2rem 4rem',
            background: canFire ? '#F97316' : 'rgba(30,42,64,0.85)',
            color: canFire ? '#FFFFFF' : '#6C7A93',
            border: `0.3rem solid ${canFire ? '#F97316' : 'rgba(58,72,99,0.6)'}`,
            borderRadius: '100rem',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '2.6rem',
            fontWeight: 700,
            letterSpacing: '0.12em',
            cursor: canFire ? 'pointer' : 'not-allowed',
            zIndex: 10,
          }}
        >
          <i
            className="bi bi-lightning-charge-fill"
            style={{ marginInlineEnd: '0.8rem', fontSize: '2.8rem', verticalAlign: '-0.2rem' }}
          />
          {labels.fire}
        </button>
      )}
    </div>
  )
}
