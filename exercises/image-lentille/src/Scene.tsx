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
// SVG viewBox 800×450 (16:9). Cartesian x is svg-x; Cartesian y = H − svg-y.
const W = 800
const H = 450
const AXIS_Y = 225

// Lens: thin converging lens centered at O, focal length f' > 0.
const O_X = 400
const F_CM = 20                   // f' in cm — fixed for this exercise
const PX_PER_CM = 5               // 1 cm = 5 svg px
const FOCAL_PX = F_CM * PX_PER_CM // 100 px

// Object arrow AB: base A on axis, tip B above. Height fixed.
const OBJECT_HEIGHT_PX = 15
const X_MIN = 60   // OA = −68 cm  (far object)
const X_MAX = 375  // OA = −5 cm   (very close, virtual image case)
const DEFAULT_X = 250 // OA = −30 cm — real, γ = −2, image at x = 700

// Hit-test tolerance on image x-position (svg px). 12 px ≈ 2.4 cm on OA'.
const TOL_PX = 12

// Ray-render clipping (avoid enormous SVG line lengths near image-at-infinity).
const MAX_RAY_EXTENT = 1200

// ─── Stage target sets ─────────────────────────────────────────────────
type Target = { id: string; oaCm: number }
type Setup = { targets: Target[] }

// Stage 2: all three targets visible simultaneously; slack shot budget.
// Canonical geometry stops (3f', 2f', 1.5f') so students see the family
// of image positions the lens produces for real objects.
const STAGE2_TARGETS: Target[] = [
  { id: 't2a', oaCm: -60 },
  { id: 't2b', oaCm: -40 },
  { id: 't2c', oaCm: -30 },
]
const STAGE2_SHOT_BUDGET = 5

// Stage 3: 3 setups cycled on fail. All hand-picked so every target's
// image sits on-canvas (x_A' ≤ 790). Sequential — one shot per target.
const STAGE3_SETUPS: Setup[] = [
  {
    targets: [
      { id: 's0a', oaCm: -55 },
      { id: 's0b', oaCm: -35 },
      { id: 's0c', oaCm: -28 },
    ],
  },
  {
    targets: [
      { id: 's1a', oaCm: -50 },
      { id: 's1b', oaCm: -45 },
      { id: 's1c', oaCm: -32 },
    ],
  },
  {
    targets: [
      { id: 's2a', oaCm: -65 },
      { id: 's2b', oaCm: -38 },
      { id: 's2c', oaCm: -33 },
    ],
  },
]

// ─── Pure optical math ──────────────────────────────────────────────────
/** Thin-lens conjugation. Returns OA' in cm. NaN if OA ≈ −f'. */
function conjugate(oaCm: number, fCm: number): number {
  const denom = 1 / fCm + 1 / oaCm
  if (Math.abs(denom) < 1e-6) return NaN
  return 1 / denom
}
function magnification(oaCm: number, oaPCm: number): number {
  return oaPCm / oaCm
}
function xFromOA(oaCm: number): number {
  return O_X + oaCm * PX_PER_CM
}
function oaCmFromX(x: number): number {
  return (x - O_X) / PX_PER_CM
}
function cartY(y: number): number {
  return H - y
}

/** Ray 3 lens-plane y-intercept: line from B through F reaching x = O_X. */
function ray3LensY(xB: number, yB: number): number {
  const dx = O_X - 300 // F is at (300, AXIS_Y)
  const bx = xB - 300
  if (Math.abs(bx) < 0.5) return yB // B on the F-vertical; degenerate → passthrough
  return AXIS_Y + (dx * (yB - AXIS_Y)) / bx
}

// ─── Component ──────────────────────────────────────────────────────────
export default function Scene() {
  const { locale, seed } = useInit()
  const stages = useMemo(() => getStagesFor(locale), [locale])
  useDeclareStages(stages)
  const labels = en.labels

  const stageIdx = useCurrentStage()
  const setStage = useSetStage()
  const complete = useComplete()
  const progress = useProgress()

  // State ---------------------------------------------------------------
  const [xA, setXA] = useState(DEFAULT_X)
  const [dragging, setDragging] = useState(false)
  const [moved, setMoved] = useState(false)
  const [reachedF, setReachedF] = useState(false) // stage-1 richness
  const [crossedF, setCrossedF] = useState(false)
  const [lit, setLit] = useState<string[]>([])
  const [shots, setShots] = useState(0)
  const [targetIdx, setTargetIdx] = useState(0)
  const [setupCycle, setSetupCycle] = useState(0)
  const [peekVisible, setPeekVisible] = useState(false)
  const [fireFlash, setFireFlash] = useState<number | null>(null)

  const svgRef = useRef<SVGSVGElement>(null)

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  const stage3Setup = useMemo(
    () => STAGE3_SETUPS[(seed + setupCycle) % STAGE3_SETUPS.length]!,
    [seed, setupCycle],
  )
  const activeTargets: Target[] = isStage2
    ? STAGE2_TARGETS
    : isStage3
      ? stage3Setup.targets
      : []

  // Derived object/image geometry --------------------------------------
  const oaCm = oaCmFromX(xA)
  const yBObj = AXIS_Y - OBJECT_HEIGHT_PX

  const oaPCm = conjugate(oaCm, F_CM)
  const gamma = isNaN(oaPCm) ? NaN : magnification(oaCm, oaPCm)
  const xAp = isNaN(oaPCm) ? NaN : xFromOA(oaPCm)
  const yBp = isNaN(gamma) ? NaN : AXIS_Y - gamma * OBJECT_HEIGHT_PX
  const isReal = !isNaN(oaPCm) && oaPCm > 0
  const isVirtual = !isNaN(oaPCm) && oaPCm < 0
  const atInfinity = isNaN(oaPCm) || Math.abs(oaCm + F_CM) < 0.5

  // Stage-1 progress: student saw both real and virtual image regimes.
  useEffect(() => {
    if (!isStage1) return
    if (Math.abs(oaCm + F_CM) < 1.5) setReachedF(true)
    if (reachedF && ((oaCm > -F_CM && !crossedF) || (oaCm < -F_CM && crossedF))) {
      // Approaching from the other side of F after having touched it → crossed.
    }
    if (reachedF && oaCm > -F_CM + 2) setCrossedF(true)
  }, [oaCm, isStage1, reachedF, crossedF])

  // Advance predicates -------------------------------------------------
  const canSubmit = isStage1
    ? moved && reachedF && crossedF
    : isStage2
      ? lit.length === activeTargets.length
      : targetIdx >= activeTargets.length && lit.length === activeTargets.length

  // Reset --------------------------------------------------------------
  const resetStageState = useCallback(() => {
    setXA(DEFAULT_X)
    setMoved(false)
    setReachedF(false)
    setCrossedF(false)
    setLit([])
    setShots(0)
    setTargetIdx(0)
    setPeekVisible(false)
    setFireFlash(null)
  }, [])
  useReset(resetStageState)

  // Fire ---------------------------------------------------------------
  const canFire = isStage2
    ? shots < STAGE2_SHOT_BUDGET && lit.length < activeTargets.length
    : isStage3
      ? targetIdx < activeTargets.length
      : false

  const fire = useCallback(() => {
    if (!canFire) return

    if (isStage2) {
      setShots((s) => s + 1)
      if (!isNaN(xAp)) {
        const hit = activeTargets.find(
          (t) => !lit.includes(t.id) && Math.abs(xAp - xFromOA(conjugate(t.oaCm, F_CM))) < TOL_PX,
        )
        if (hit) setLit((prev) => [...prev, hit.id])
      }
    } else if (isStage3) {
      const current = activeTargets[targetIdx]
      if (current) {
        const targetXAp = xFromOA(conjugate(current.oaCm, F_CM))
        if (!isNaN(xAp) && Math.abs(xAp - targetXAp) < TOL_PX) {
          setLit((prev) => [...prev, current.id])
        }
      }
      setTargetIdx((i) => i + 1)
    }

    setFireFlash(Date.now())
  }, [canFire, isStage2, isStage3, activeTargets, lit, targetIdx, xAp])

  // Stage-3 fail → cycle to next setup. ---------------------------------
  useEffect(() => {
    if (!isStage3) return
    if (targetIdx < activeTargets.length) return
    if (lit.length === activeTargets.length) return
    // All shots spent, not all lit → cycle setup + reset.
    const t = setTimeout(() => {
      setSetupCycle((c) => c + 1)
      setXA(DEFAULT_X)
      setLit([])
      setShots(0)
      setTargetIdx(0)
      setFireFlash(null)
    }, 900)
    return () => clearTimeout(t)
  }, [isStage3, targetIdx, activeTargets.length, lit.length])

  // Fire-flash fade (cosmetic) ----------------------------------------
  useEffect(() => {
    if (fireFlash === null) return
    const t = setTimeout(() => setFireFlash(null), 550)
    return () => clearTimeout(t)
  }, [fireFlash])

  // Progress ----------------------------------------------------------
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

  // Peek --------------------------------------------------------------
  usePeek(() => {
    if (!isStage3) return
    setPeekVisible(true)
  })
  useEffect(() => {
    if (!peekVisible) return
    const t = setTimeout(() => setPeekVisible(false), 2200)
    return () => clearTimeout(t)
  }, [peekVisible])

  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  // Spacebar fires (stages 2 & 3) ---------------------------------------
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

  // Pointer / drag ----------------------------------------------------
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
    const clamped = Math.max(X_MIN, Math.min(X_MAX, p.x))
    setXA(clamped)
    if (!moved) setMoved(true)
  }
  const objectDown = (e: React.PointerEvent) => {
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

  // ─── Ray geometry (stages 1 & 2 only) ─────────────────────────────
  // Ray 1 (parallel from B, through F' after lens)
  // Ray 2 (through O, undeviated)
  // Ray 3 (through F, then parallel to axis after lens)
  const showRays = (isStage1 || isStage2) && !atInfinity && !isNaN(xAp)
  const showConstructedImage = (isStage1 || isStage2) && !atInfinity

  // Lens plane intercepts (right after refraction)
  const yLens1 = yBObj                                  // ray 1: horizontal on left
  // ray 2 passes through O = (O_X, AXIS_Y); the intercept y IS AXIS_Y (used inline)
  const yLens3 = ray3LensY(xA, yBObj)                    // ray 3: from B through F

  // After refraction, each right-side ray direction from lens intercept:
  // ray 1: through F' → dir (100, AXIS_Y - yLens1)
  // ray 2: undeviated → dir (O - B) i.e. continues through B (leftward from B) so
  //        rightward direction from lens intercept is (O - B) = (400 - xA, AXIS_Y - yBObj)
  // ray 3: parallel to axis → dir (1, 0)
  //
  // We render each right-segment as: solid from lens intercept to canvas edge,
  // trimmed at B' for real image, and dashed backward extension from lens
  // intercept to B' for virtual image.
  type RaySeg = {
    left: [number, number, number, number]
    right: [number, number, number, number]
    backDash?: [number, number, number, number]
  }

  const rays: RaySeg[] = []
  if (showRays) {
    const xBp = xAp
    const yBpFinal = yBp

    // Ray 1
    {
      const dx = 500 - O_X // 100 — direction x through F'
      const dy = AXIS_Y - yLens1
      const dLen = Math.hypot(dx, dy) || 1
      const rightX = isReal ? xBp : O_X + (dx / dLen) * MAX_RAY_EXTENT
      const rightY = isReal ? yBpFinal : yLens1 + (dy / dLen) * MAX_RAY_EXTENT
      const seg: RaySeg = {
        left: [xA, yBObj, O_X, yLens1],
        right: [O_X, yLens1, rightX, rightY],
      }
      if (isVirtual) {
        seg.backDash = [O_X, yLens1, xBp, yBpFinal]
      }
      rays.push(seg)
    }

    // Ray 2 (through O)
    {
      const dx = O_X - xA
      const dy = AXIS_Y - yBObj
      const dLen = Math.hypot(dx, dy) || 1
      const rightX = isReal ? xBp : O_X + (dx / dLen) * MAX_RAY_EXTENT
      const rightY = isReal ? yBpFinal : AXIS_Y + (dy / dLen) * MAX_RAY_EXTENT
      const seg: RaySeg = {
        left: [xA, yBObj, O_X, AXIS_Y],
        right: [O_X, AXIS_Y, rightX, rightY],
      }
      if (isVirtual) {
        seg.backDash = [O_X, AXIS_Y, xBp, yBpFinal]
      }
      rays.push(seg)
    }

    // Ray 3 (through F, then parallel to axis)
    {
      const rightX = isReal ? xBp : O_X + MAX_RAY_EXTENT
      const rightY = yLens3
      const seg: RaySeg = {
        left: [xA, yBObj, O_X, yLens3],
        right: [O_X, yLens3, rightX, rightY],
      }
      if (isVirtual) {
        seg.backDash = [O_X, yLens3, xBp, yBpFinal]
      }
      rays.push(seg)
    }
  }

  // ─── HUD content ──────────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`

  const oaStr = `${oaCm.toFixed(1)}cm`
  const oaPStr = atInfinity ? '±∞' : `${oaPCm.toFixed(1)}cm`
  const gammaStr = atInfinity ? '±∞' : gamma.toFixed(2)
  const natureStr = atInfinity
    ? labels.infinity
    : isReal
      ? labels.real
      : labels.virtual

  const hudTR = isStage1
    ? `OA=${oaStr} · OA'=${oaPStr} · γ=${gammaStr}`
    : isStage2
      ? `OA=${oaStr} · ${shots}/${STAGE2_SHOT_BUDGET} · ${labels.lit} ${lit.length}/${activeTargets.length}`
      : `OA=${oaStr} · ${labels.target} ${Math.min(targetIdx + 1, activeTargets.length)}/${activeTargets.length}`

  const hudBL = isStage1 ? labels.tip1 : isStage2 ? labels.tip2 : labels.tip3

  // ─── Render helpers ────────────────────────────────────────────────
  const rayColor = '#F97316'
  const rayGlow = 'rgba(249,115,22,0.22)'

  // Ghost target arrow — dashed outline at expected image position.
  const renderTargetGhost = (t: Target, opts: { lit: boolean; current: boolean }) => {
    const oaPT = conjugate(t.oaCm, F_CM)
    if (isNaN(oaPT)) return null
    const xT = xFromOA(oaPT)
    const gammaT = magnification(t.oaCm, oaPT)
    const yT = AXIS_Y - gammaT * OBJECT_HEIGHT_PX
    const color = opts.lit ? '#37C9B8' : opts.current ? '#F97316' : '#54617A'
    const opacity = opts.lit ? 0.9 : opts.current ? 1 : 0.55
    return (
      <g key={t.id} opacity={opacity}>
        {opts.current && !opts.lit && (
          <circle cx={xT} cy={AXIS_Y} r={16} fill="none" stroke="#F97316" strokeWidth={1.5} opacity={0.55}>
            <animate attributeName="r" values="12;20;12" dur="1.6s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.7;0.15;0.7" dur="1.6s" repeatCount="indefinite" />
          </circle>
        )}
        <line x1={xT} y1={AXIS_Y} x2={xT} y2={yT} stroke={color} strokeWidth={2} strokeDasharray="4 4" />
        {/* Arrowhead */}
        {(() => {
          const dir = yT < AXIS_Y ? -1 : 1
          return (
            <polygon
              points={`${xT - 5},${yT + dir * 7} ${xT + 5},${yT + dir * 7} ${xT},${yT}`}
              fill="none"
              stroke={color}
              strokeWidth={1.8}
              strokeDasharray="3 3"
            />
          )
        })()}
        {/* Axis footprint dot */}
        <circle cx={xT} cy={AXIS_Y} r={3.5} fill={color} />
        {isStage3 && (
          <text
            x={xT}
            y={AXIS_Y + 18}
            fill="#F9A968"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={10}
            textAnchor="middle"
          >
            A' ({Math.round(xT)}, {cartY(AXIS_Y)})
          </text>
        )}
      </g>
    )
  }

  // Stage-3 sequential visibility of targets.
  const stage3RenderList = isStage3
    ? activeTargets.map((t, i) => ({
        t,
        show: lit.includes(t.id) || i === targetIdx,
        current: i === targetIdx,
      }))
    : []

  const showFireButton = !isStage1
  const showExhaustedWarn = isStage2 && shots >= STAGE2_SHOT_BUDGET && lit.length < activeTargets.length

  // ─── Render ────────────────────────────────────────────────────────
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

        {/* Grid — sparse on stages 1/2, denser + labeled on stage 3 */}
        {isStage3
          ? (() => {
              const g: React.ReactNode[] = []
              for (let x = 0; x <= W; x += 50) {
                g.push(
                  <line
                    key={`gx${x}`}
                    x1={x}
                    y1={0}
                    x2={x}
                    y2={H}
                    stroke="#12203a"
                    strokeWidth={x % 100 === 0 ? 1 : 0.5}
                    opacity={x % 100 === 0 ? 1 : 0.6}
                  />,
                )
              }
              for (let y = 0; y <= H; y += 50) {
                g.push(
                  <line
                    key={`gy${y}`}
                    x1={0}
                    y1={y}
                    x2={W}
                    y2={y}
                    stroke="#12203a"
                    strokeWidth={y % 100 === 0 ? 1 : 0.5}
                    opacity={y % 100 === 0 ? 1 : 0.6}
                  />,
                )
              }
              // x-axis labels (Cartesian)
              for (let x = 100; x <= 700; x += 100) {
                g.push(
                  <text
                    key={`lx${x}`}
                    x={x}
                    y={H - 6}
                    fill="#6C7A93"
                    fontFamily="'JetBrains Mono', monospace"
                    fontSize={9}
                    textAnchor="middle"
                  >
                    {x}
                  </text>,
                )
              }
              return g
            })()
          : (() => {
              const g: React.ReactNode[] = []
              for (let x = 40; x < W; x += 60) {
                g.push(<line key={`gx${x}`} x1={x} y1={0} x2={x} y2={H} stroke="#12203a" strokeWidth={1} />)
              }
              for (let y = 40; y < H; y += 60) {
                g.push(<line key={`gy${y}`} x1={0} y1={y} x2={W} y2={y} stroke="#12203a" strokeWidth={1} />)
              }
              return g
            })()}

        {/* Optical axis */}
        <line
          x1={20}
          y1={AXIS_Y}
          x2={W - 20}
          y2={AXIS_Y}
          stroke="#2A3654"
          strokeWidth={1}
          strokeDasharray="2 4"
        />

        {/* Lens: a tall thin vertical body with double-arrow tips */}
        <g>
          <line
            x1={O_X}
            y1={80}
            x2={O_X}
            y2={H - 80}
            stroke="rgba(56,209,255,0.18)"
            strokeWidth={16}
            strokeLinecap="round"
          />
          <line
            x1={O_X}
            y1={80}
            x2={O_X}
            y2={H - 80}
            stroke="#38D1FF"
            strokeWidth={2.2}
            strokeLinecap="round"
          />
          {/* Upper arrows */}
          <polyline
            points={`${O_X - 6},${86} ${O_X},${76} ${O_X + 6},${86}`}
            fill="none"
            stroke="#38D1FF"
            strokeWidth={2.2}
            strokeLinecap="round"
          />
          <polyline
            points={`${O_X - 6},${H - 86} ${O_X},${H - 76} ${O_X + 6},${H - 86}`}
            fill="none"
            stroke="#38D1FF"
            strokeWidth={2.2}
            strokeLinecap="round"
          />
        </g>

        {/* Focal-point markers */}
        {[
          { x: O_X - FOCAL_PX, label: 'F' },
          { x: O_X + FOCAL_PX, label: "F'" },
          { x: O_X - 2 * FOCAL_PX, label: '2F' },
          { x: O_X + 2 * FOCAL_PX, label: "2F'" },
        ].map((m) => (
          <g key={m.label}>
            <line x1={m.x} y1={AXIS_Y - 5} x2={m.x} y2={AXIS_Y + 5} stroke="#6C7A93" strokeWidth={1.5} />
            <text
              x={m.x}
              y={AXIS_Y + 18}
              fill="#6C7A93"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
              textAnchor="middle"
            >
              {m.label}
            </text>
          </g>
        ))}
        {/* O label */}
        <text
          x={O_X + 8}
          y={AXIS_Y - 8}
          fill="#EAF0FA"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={11}
        >
          O
        </text>

        {/* Rays (stages 1 & 2 only) */}
        {showRays &&
          rays.map((seg, i) => (
            <g key={`ray${i}`}>
              <line
                x1={seg.left[0]}
                y1={seg.left[1]}
                x2={seg.left[2]}
                y2={seg.left[3]}
                stroke={rayGlow}
                strokeWidth={8}
                strokeLinecap="round"
              />
              <line
                x1={seg.left[0]}
                y1={seg.left[1]}
                x2={seg.left[2]}
                y2={seg.left[3]}
                stroke={rayColor}
                strokeWidth={2}
                strokeLinecap="round"
              />
              <line
                x1={seg.right[0]}
                y1={seg.right[1]}
                x2={seg.right[2]}
                y2={seg.right[3]}
                stroke={rayGlow}
                strokeWidth={8}
                strokeLinecap="round"
              />
              <line
                x1={seg.right[0]}
                y1={seg.right[1]}
                x2={seg.right[2]}
                y2={seg.right[3]}
                stroke={rayColor}
                strokeWidth={2}
                strokeLinecap="round"
              />
              {seg.backDash && (
                <line
                  x1={seg.backDash[0]}
                  y1={seg.backDash[1]}
                  x2={seg.backDash[2]}
                  y2={seg.backDash[3]}
                  stroke={rayColor}
                  strokeWidth={1.5}
                  strokeDasharray="6 5"
                  opacity={0.75}
                />
              )}
            </g>
          ))}

        {/* Stage 2 targets — all three visible simultaneously */}
        {isStage2 &&
          activeTargets.map((t) =>
            renderTargetGhost(t, { lit: lit.includes(t.id), current: false }),
          )}

        {/* Stage 3 targets — current + lit only */}
        {isStage3 &&
          stage3RenderList
            .filter((r) => r.show)
            .map((r) => renderTargetGhost(r.t, { lit: lit.includes(r.t.id), current: r.current }))}

        {/* Constructed image A'B' (stages 1 & 2) */}
        {showConstructedImage && !isNaN(xAp) && !isNaN(yBp) && (
          <g opacity={isReal ? 1 : 0.75}>
            <line
              x1={xAp}
              y1={AXIS_Y}
              x2={xAp}
              y2={yBp}
              stroke={isReal ? '#37C9B8' : '#38D1FF'}
              strokeWidth={3}
              strokeDasharray={isVirtual ? '5 4' : undefined}
              strokeLinecap="round"
            />
            {(() => {
              const dir = yBp < AXIS_Y ? -1 : 1
              return (
                <polygon
                  points={`${xAp - 6},${yBp + dir * 9} ${xAp + 6},${yBp + dir * 9} ${xAp},${yBp}`}
                  fill={isReal ? '#37C9B8' : '#38D1FF'}
                  opacity={isVirtual ? 0.8 : 1}
                />
              )
            })()}
            <text
              x={xAp + 10}
              y={yBp + (yBp < AXIS_Y ? -2 : 12)}
              fill={isReal ? '#37C9B8' : '#38D1FF'}
              fontFamily="'JetBrains Mono', monospace"
              fontSize={11}
              fontWeight={600}
            >
              B'
            </text>
            <text
              x={xAp + 8}
              y={AXIS_Y + 14}
              fill="#EAF0FA"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
            >
              A'
            </text>
          </g>
        )}

        {/* Fire flash — briefly highlights the current image position */}
        {fireFlash !== null && !isNaN(xAp) && !isStage1 && (
          <circle cx={xAp} cy={AXIS_Y} r={22} fill="none" stroke="#F97316" strokeWidth={2} opacity={0.7}>
            <animate attributeName="r" from="10" to="30" dur="0.5s" repeatCount="1" />
            <animate attributeName="opacity" from="0.9" to="0" dur="0.5s" repeatCount="1" />
          </circle>
        )}

        {/* Object arrow AB (draggable) */}
        <g onPointerDown={objectDown} style={{ cursor: 'grab' }}>
          {/* Wide invisible hit-target */}
          <rect
            x={xA - 14}
            y={yBObj - 6}
            width={28}
            height={OBJECT_HEIGHT_PX + 22}
            fill="transparent"
          />
          <line
            x1={xA}
            y1={AXIS_Y}
            x2={xA}
            y2={yBObj}
            stroke="rgba(234,240,250,0.14)"
            strokeWidth={10}
            strokeLinecap="round"
          />
          <line
            x1={xA}
            y1={AXIS_Y}
            x2={xA}
            y2={yBObj}
            stroke="#EAF0FA"
            strokeWidth={3}
            strokeLinecap="round"
          />
          <polygon points={`${xA - 6},${yBObj + 7} ${xA + 6},${yBObj + 7} ${xA},${yBObj - 3}`} fill="#EAF0FA" />
          <circle cx={xA} cy={AXIS_Y} r={4.5} fill="#EAF0FA" />
          <text
            x={xA + 9}
            y={yBObj + 2}
            fill="#EAF0FA"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={11}
            fontWeight={600}
          >
            B
          </text>
          <text
            x={xA + 9}
            y={AXIS_Y - 8}
            fill="#EAF0FA"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={11}
          >
            A
          </text>
        </g>

        {/* Stage 3: axis coord label for object + f' reminder */}
        {isStage3 && (
          <>
            <text
              x={xA}
              y={AXIS_Y + 32}
              fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
              textAnchor="middle"
            >
              A ({Math.round(xA)}, {cartY(AXIS_Y)})
            </text>
            <text
              x={O_X}
              y={72}
              fill="#B9C4D6"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={11}
              textAnchor="middle"
            >
              f' = {F_CM}cm · {PX_PER_CM}px = 1cm
            </text>
          </>
        )}

        {/* Peek badge (stage 3) */}
        {isStage3 && peekVisible && (
          <g>
            <rect
              x={W / 2 - 240}
              y={16}
              width={480}
              height={54}
              rx={12}
              fill="rgba(13,21,36,0.9)"
              stroke="#F97316"
              strokeWidth={1.5}
            />
            <text
              x={W / 2}
              y={36}
              fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={11}
              letterSpacing="0.08em"
              textAnchor="middle"
            >
              {labels.strategy}
            </text>
            <text
              x={W / 2}
              y={57}
              fill="#EAF0FA"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={13}
              fontWeight={700}
              letterSpacing="0.1em"
              textAnchor="middle"
            >
              current OA = {oaCm.toFixed(1)}cm
            </text>
          </g>
        )}

        {/* Nature chip (stage 1 only — help, removed on stages 2 & 3) */}
        {isStage1 && (
          <g>
            <rect
              x={W / 2 - 100}
              y={H - 44}
              width={200}
              height={26}
              rx={13}
              fill="rgba(13,21,36,0.85)"
              stroke={atInfinity ? '#F97316' : isReal ? '#37C9B8' : '#38D1FF'}
              strokeWidth={1.2}
            />
            <text
              x={W / 2}
              y={H - 27}
              fill={atInfinity ? '#F9A968' : isReal ? '#37C9B8' : '#38D1FF'}
              fontFamily="'JetBrains Mono', monospace"
              fontSize={11}
              fontWeight={700}
              letterSpacing="0.12em"
              textAnchor="middle"
            >
              {natureStr}
            </text>
          </g>
        )}
      </svg>

      {/* HUD — HTML overlays in the 3 allowed corners (BR reserved) */}
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
          fontSize: '2rem',
          letterSpacing: '0.08em',
          color: canSubmit ? '#37C9B8' : '#B9C4D6',
          textAlign: 'right',
          zIndex: 5,
          pointerEvents: 'none',
        }}
      >
        {hudTR}
        {showExhaustedWarn && (
          <div style={{ color: '#F9A968', marginTop: '0.6rem', fontSize: '1.7rem' }}>
            {labels.exhausted}
          </div>
        )}
      </div>
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
          maxWidth: '48%',
        }}
      >
        {hudBL}
      </div>

      {/* Fire button (stages 2 & 3) */}
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
            transition: 'background 0.15s, transform 0.1s',
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
