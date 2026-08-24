import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
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

// ─── Scene constants ────────────────────────────────────────────────
const W = 800
const H = 450

// Bench geometry (SVG units, y-down)
const AXIS_Y = 270
const OBJ_X = 130                // object AB is fixed on the bench
const LENS_X = 340
const OBJ_HEIGHT_PX = 60         // AB height above axis (arrow tip at AXIS_Y − 60)
const PX_PER_CM = 7              // physical scale of the bench
const OBJ_P_CM = (LENS_X - OBJ_X) / PX_PER_CM   // = 30 cm (fixed)

// Screen movable range
const SCREEN_X_MIN = LENS_X + 45          // ≈ 6.4 cm from lens
const SCREEN_X_MAX = 760                  // = 60 cm from lens
const SCREEN_TOP = 110
const SCREEN_BOT = 430

// Lens visual
const LENS_HALF_H = 90
const LENS_APERTURE_PX = 40      // half-diameter used for CoC calc

// Sharpness model
const SHARP_SIGMA_CM = 0.9       // gaussian width of the sharpness peak
const STAGE1_ADVANCE_SHARPNESS = 0.85
const F_MATCH_REL_TOL = 0.05     // ±5% tolerance on measured f'

// Stage 1: known focal length
const STAGE1_F_CM = 10

// Stage 2 setups — each is a triple of hidden focal lengths (cm)
// Object stays at p = 30 cm, so image at p' = f·p/(p−f) is in [7, 60] cm
type Setup = { targets: number[] }
const STAGE2_SETUPS: Setup[] = [
  { targets: [8, 12, 15] },
  { targets: [9, 11, 14] },
  { targets: [10, 13, 8.5] },
  { targets: [11, 9, 13.5] },
]
const STAGE2_SHOT_BUDGET = 5

// Stage 3 setups — different mix, strictly one-shot-per-lens
const STAGE3_SETUPS: Setup[] = [
  { targets: [9, 12.5, 15] },
  { targets: [8, 11, 14] },
  { targets: [10.5, 13, 8.5] },
  { targets: [12, 9.5, 14.5] },
]

// Beam / rays visual
const RAY_COLORS = {
  parallel: '#F97316',    // orange — parallel-then-focal ray
  central: '#37C9B8',     // teal — through optical center
  focal: '#B98BE3',       // violet — focal-then-parallel ray
}

// ─── Physics helpers ────────────────────────────────────────────────
/** p' from p and f (all positive real distances, cm). */
function imageDist(pCm: number, fCm: number): number {
  // 1/p + 1/p' = 1/f  →  p' = p·f / (p − f)
  return (pCm * fCm) / (pCm - fCm)
}
/** f' from measured p and p' (all positive, cm). */
function focalFromMeasurement(pCm: number, pPrimeCm: number): number {
  return (pCm * pPrimeCm) / (pCm + pPrimeCm)
}
function sharpness(screenPrimeCm: number, truePrimeCm: number): number {
  const d = (screenPrimeCm - truePrimeCm) / SHARP_SIGMA_CM
  return Math.exp(-d * d)
}
function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x))
}
function fmtCm(v: number): string {
  return `${v.toFixed(1)}cm`
}
function fmtCmShort(v: number): string {
  return `${v.toFixed(2)}`
}

// ─── Label loader ───────────────────────────────────────────────────
const dict = { en } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── Component ──────────────────────────────────────────────────────
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

  // Setup cycling — resets rotate through hand-authored triples
  const [s2Cycle, setS2Cycle] = useState(0)
  const [s3Cycle, setS3Cycle] = useState(0)
  const stage2Setup = useMemo(
    () => STAGE2_SETUPS[(seed + s2Cycle) % STAGE2_SETUPS.length]!,
    [seed, s2Cycle],
  )
  const stage3Setup = useMemo(
    () => STAGE3_SETUPS[(seed + s3Cycle) % STAGE3_SETUPS.length]!,
    [seed, s3Cycle],
  )

  // ─── State ─────────────────────────────────────────────────────
  const svgRef = useRef<SVGSVGElement>(null)
  const [screenX, setScreenX] = useState(500)
  const [dragging, setDragging] = useState(false)
  const [moved, setMoved] = useState(false)
  const [bestSharpness, setBestSharpness] = useState(0)  // stage 1 advance
  const [targetIdx, setTargetIdx] = useState(0)
  const [lit, setLit] = useState<boolean[]>([false, false, false])
  const [shots, setShots] = useState(0)
  const [peekVisible, setPeekVisible] = useState(false)
  const [fireFlash, setFireFlash] = useState<{ ok: boolean; at: number } | null>(null)
  const [tick, setTick] = useState(0)
  const rafRef = useRef<number>(0)

  const activeTargets = isStage2 ? stage2Setup.targets : isStage3 ? stage3Setup.targets : []
  const currentTrueF = activeTargets[targetIdx]

  // Derived measurements
  const screenPCm = (screenX - LENS_X) / PX_PER_CM      // measured p' (cm, positive)
  const measuredF = focalFromMeasurement(OBJ_P_CM, screenPCm)

  // True image plane for the CURRENT lens (stage 1: fixed; stage 2/3: current target)
  const activeF = isStage1
    ? STAGE1_F_CM
    : currentTrueF !== undefined
      ? currentTrueF
      : STAGE1_F_CM
  const trueImagePCm = imageDist(OBJ_P_CM, activeF)
  const imageX = LENS_X + trueImagePCm * PX_PER_CM

  const currentSharpness = sharpness(screenPCm, trueImagePCm)

  // Track best sharpness for stage 1 advance
  useEffect(() => {
    if (!isStage1) return
    if (currentSharpness > bestSharpness) setBestSharpness(currentSharpness)
  }, [isStage1, currentSharpness, bestSharpness])

  // ─── Reset ─────────────────────────────────────────────────────
  const resetStageState = useCallback(() => {
    setScreenX(500)
    setMoved(false)
    setBestSharpness(0)
    setTargetIdx(0)
    setLit([false, false, false])
    setShots(0)
    setPeekVisible(false)
    setFireFlash(null)
  }, [])
  useReset(resetStageState)

  // ─── Advance predicate ─────────────────────────────────────────
  const canSubmit = isStage1
    ? moved && bestSharpness >= STAGE1_ADVANCE_SHARPNESS
    : isStage2
      ? lit.every(Boolean)
      : lit.every(Boolean)

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

  // ─── Fire ──────────────────────────────────────────────────────
  const canFire = isStage2
    ? shots < STAGE2_SHOT_BUDGET && !lit.every(Boolean)
    : isStage3
      ? targetIdx < activeTargets.length
      : false

  const fire = useCallback(() => {
    if (!canFire) return
    const trueF = activeTargets[targetIdx]
    if (trueF === undefined) return
    const measured = focalFromMeasurement(OBJ_P_CM, (screenX - LENS_X) / PX_PER_CM)
    const relErr = Math.abs(measured - trueF) / trueF
    const hit = relErr < F_MATCH_REL_TOL

    if (isStage2) {
      setShots((s) => s + 1)
      if (hit) {
        setLit((prev) => {
          const next = [...prev]
          next[targetIdx] = true
          return next
        })
        // Advance to next unlit target (§5.2 stage 2: hit → advance; miss → same target, shot++)
        setTargetIdx((i) => {
          const litArr = [...lit]
          litArr[i] = true
          for (let k = 0; k < litArr.length; k++) {
            if (!litArr[k]) return k
          }
          return i
        })
      }
      // No advance on miss — student keeps the same lens for retry
      setFireFlash({ ok: hit, at: Date.now() })
    } else if (isStage3) {
      // One-shot-per-target: always advance, always consume shot
      setShots((s) => s + 1)
      if (hit) {
        setLit((prev) => {
          const next = [...prev]
          next[targetIdx] = true
          return next
        })
      }
      setTargetIdx((i) => i + 1)
      setFireFlash({ ok: hit, at: Date.now() })
    }
    setTick(Date.now())
  }, [canFire, activeTargets, targetIdx, screenX, isStage2, isStage3, lit])

  // ─── Fire-flash timer ─────────────────────────────────────────
  useEffect(() => {
    if (!fireFlash) return
    const step = () => {
      const elapsed = Date.now() - fireFlash.at
      if (elapsed >= 900) { setFireFlash(null); return }
      setTick(Date.now())
      rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(rafRef.current)
  }, [fireFlash])

  // ─── Stage-2 exhaustion → cycle to next setup ─────────────────
  useEffect(() => {
    if (!isStage2) return
    if (shots >= STAGE2_SHOT_BUDGET && !lit.every(Boolean)) {
      const t = setTimeout(() => {
        setS2Cycle((n) => n + 1)
        setScreenX(500)
        setMoved(false)
        setTargetIdx(0)
        setLit([false, false, false])
        setShots(0)
        setFireFlash(null)
      }, 900)
      return () => clearTimeout(t)
    }
  }, [isStage2, shots, lit])

  // ─── Stage-3 exhaustion → cycle to next setup ─────────────────
  useEffect(() => {
    if (!isStage3) return
    const allShotsFired = targetIdx >= activeTargets.length && activeTargets.length > 0
    const allLit = lit.every(Boolean)
    if (allShotsFired && !allLit) {
      const t = setTimeout(() => {
        setS3Cycle((n) => n + 1)
        setScreenX(500)
        setTargetIdx(0)
        setLit([false, false, false])
        setShots(0)
        setFireFlash(null)
      }, 1100)
      return () => clearTimeout(t)
    }
  }, [isStage3, targetIdx, lit, activeTargets.length])

  // ─── Peek (§5.2 rule 4 — strategy hint + verification value) ───
  usePeek(() => {
    if (!isStage3) return
    setPeekVisible(true)
  })
  useEffect(() => {
    if (!peekVisible) return
    const t = setTimeout(() => setPeekVisible(false), 1800)
    return () => clearTimeout(t)
  }, [peekVisible])

  // ─── Hint ──────────────────────────────────────────────────────
  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  // ─── Spacebar fires (stages 2 & 3) ────────────────────────────
  useEffect(() => {
    if (isStage1) return
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space') { e.preventDefault(); fire() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isStage1, fire])

  // ─── Pointer / drag ───────────────────────────────────────────
  const svgPoint = (e: React.PointerEvent) => {
    const el = svgRef.current; if (!el) return null
    const rect = el.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) / rect.width) * W,
      y: ((e.clientY - rect.top) / rect.height) * H,
    }
  }
  const applyDrag = (p: { x: number; y: number }) => {
    const clamped = clamp(p.x, SCREEN_X_MIN, SCREEN_X_MAX)
    setScreenX(clamped)
    if (!moved) setMoved(true)
  }

  // ─── Geometry for the three characteristic rays ───────────────
  // Object tip B = (OBJ_X, AXIS_Y − OBJ_HEIGHT_PX)
  // Image tip B' (real, inverted) at (imageX, AXIS_Y + gamma·OBJ_HEIGHT_PX)
  const gamma = trueImagePCm / OBJ_P_CM       // magnification magnitude (image inverted)
  const bY = AXIS_Y - OBJ_HEIGHT_PX
  const bImgY = AXIS_Y + gamma * OBJ_HEIGHT_PX
  const fPx = activeF * PX_PER_CM
  const fFocalX = LENS_X - fPx
  const fPrimeX = LENS_X + fPx

  // Rays visible in stage 1 & 2, hidden in stage 3
  const showRays = isStage1 || isStage2

  // Extended ray endpoints — draw across the bench to the far right,
  // and beyond image plane if needed for visual clarity
  const RIGHT_EDGE = 780
  // Ray 1 (parallel then through F')
  //   Segments: (OBJ_X, bY) → (LENS_X, bY) → (RIGHT_EDGE, ?)
  const ray1SlopeAfter = (AXIS_Y - bY) / fPx  // downward per px
  const ray1EndY = bY + (RIGHT_EDGE - LENS_X) * ray1SlopeAfter
  // Ray 2 (through O)
  //   (OBJ_X, bY) → (LENS_X, AXIS_Y) → continue straight to RIGHT_EDGE
  const ray2Slope = (AXIS_Y - bY) / (LENS_X - OBJ_X)
  const ray2EndY = AXIS_Y + (RIGHT_EDGE - LENS_X) * ray2Slope
  // Ray 3 (through F then parallel)
  //   (OBJ_X, bY) → intersect lens plane at y3, then horizontal
  //   Line from B through F(fFocalX, AXIS_Y). Slope = (AXIS_Y - bY)/(fFocalX - OBJ_X)
  const ray3SlopeBefore = (AXIS_Y - bY) / (fFocalX - OBJ_X)
  const ray3LensY = bY + (LENS_X - OBJ_X) * ray3SlopeBefore

  // ─── Blur rendering for the projected image on the screen ────
  // Circle-of-confusion (px) at screen: |screen_x − image_x| * (aperture / p'_true)
  const cocPx = Math.abs(screenX - imageX) * (LENS_APERTURE_PX / (trueImagePCm * PX_PER_CM))
  // SVG Gaussian blur stdDeviation ≈ CoC / 2
  const blurStd = clamp(cocPx / 2, 0.15, 22)
  const imgArrowHeight = Math.abs(gamma * OBJ_HEIGHT_PX)
  // Blur filter unique per stage to force re-render on change
  const blurFilterId = `focBlur-${stageIdx}`

  // ─── HUD text ─────────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`
  const hudTR = isStage1
    ? `p=${fmtCm(OBJ_P_CM)} · p'=${fmtCm(screenPCm)} · 1/p+1/p'=${(1 / OBJ_P_CM + 1 / screenPCm).toFixed(4)}`
    : isStage2
      ? `p=${fmtCm(OBJ_P_CM)} · p'=${fmtCm(screenPCm)} · ${labels.lens_short} ${targetIdx + 1}/${activeTargets.length}`
      : `p=${fmtCm(OBJ_P_CM)} · p'=${fmtCm(screenPCm)} · ${labels.lens_short} ${Math.min(targetIdx + 1, activeTargets.length)}/${activeTargets.length}`
  const hudBL = isStage1 ? labels.tip1 : isStage2 ? labels.tip2 : labels.tip3

  // Progress line — under TL (never in BR)
  const progressLine = isStage1
    ? `${labels.sharpness} ${(currentSharpness * 100).toFixed(0)}%`
    : isStage2
      ? `${labels.measured} ${lit.filter(Boolean).length}/${activeTargets.length} · ${labels.shots} ${shots}/${STAGE2_SHOT_BUDGET}`
      : `${labels.measured} ${lit.filter(Boolean).length}/${activeTargets.length} · ${labels.shots} ${shots}/${activeTargets.length}`

  // ─── Render ────────────────────────────────────────────────────
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block', touchAction: 'none', userSelect: 'none' }}
        onPointerMove={(e) => { if (dragging) { const p = svgPoint(e); if (p) applyDrag(p) } }}
        onPointerUp={() => setDragging(false)}
        onPointerLeave={() => setDragging(false)}
      >
        <defs>
          <filter id={blurFilterId} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation={blurStd} />
          </filter>
        </defs>

        {/* Background — NO rx */}
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        {/* Bench frame */}
        <rect x={32} y={90} width={720} height={352} fill="none" stroke="#12203a" strokeWidth={1} rx={6} />
        <text x={40} y={82} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={11} letterSpacing="0.1em">
          {labels.bench}
        </text>

        {/* Sharpness bar (stage 1 & 2 only — HELP, hidden on stage 3) */}
        {(isStage1 || isStage2) && (
          <g>
            <rect x={90} y={98} width={200} height={8} fill="#12203a" rx={4} />
            <rect
              x={90}
              y={98}
              width={200 * currentSharpness}
              height={8}
              fill={currentSharpness >= 0.9 ? '#37C9B8' : currentSharpness >= 0.5 ? '#F97316' : '#54617A'}
              rx={4}
            />
            <text x={90} y={122} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={10} letterSpacing="0.1em">
              {labels.sharpness}: {(currentSharpness * 100).toFixed(0)}%
            </text>
          </g>
        )}

        {/* Optical axis */}
        <line x1={50} y1={AXIS_Y} x2={780} y2={AXIS_Y} stroke="#2A3654" strokeWidth={1} strokeDasharray="2 4" />

        {/* Focal points F and F' — visible when rays visible */}
        {showRays && fFocalX > 60 && (
          <>
            <line x1={fFocalX} y1={AXIS_Y - 6} x2={fFocalX} y2={AXIS_Y + 6} stroke="#6C7A93" strokeWidth={1} />
            <text x={fFocalX} y={AXIS_Y + 20} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={11} textAnchor="middle">F</text>
            <line x1={fPrimeX} y1={AXIS_Y - 6} x2={fPrimeX} y2={AXIS_Y + 6} stroke="#6C7A93" strokeWidth={1} />
            <text x={fPrimeX} y={AXIS_Y + 20} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={11} textAnchor="middle">F&apos;</text>
          </>
        )}

        {/* Object AB (arrow up) */}
        <g>
          <line x1={OBJ_X} y1={AXIS_Y} x2={OBJ_X} y2={bY} stroke="#F97316" strokeWidth={2.4} />
          <polygon
            points={`${OBJ_X},${bY - 8} ${OBJ_X - 5},${bY} ${OBJ_X + 5},${bY}`}
            fill="#F97316"
          />
          <text x={OBJ_X - 10} y={AXIS_Y + 16} fill="#F9A968" fontFamily="'JetBrains Mono', monospace" fontSize={11} textAnchor="end">
            A
          </text>
          <text x={OBJ_X - 10} y={bY} fill="#F9A968" fontFamily="'JetBrains Mono', monospace" fontSize={11} textAnchor="end">
            B
          </text>
        </g>

        {/* Object-lens distance annotation (visible always, required info) */}
        <g>
          <line x1={OBJ_X} y1={AXIS_Y + 34} x2={LENS_X} y2={AXIS_Y + 34} stroke="#54617A" strokeWidth={1} />
          <line x1={OBJ_X} y1={AXIS_Y + 30} x2={OBJ_X} y2={AXIS_Y + 38} stroke="#54617A" strokeWidth={1} />
          <line x1={LENS_X} y1={AXIS_Y + 30} x2={LENS_X} y2={AXIS_Y + 38} stroke="#54617A" strokeWidth={1} />
          <text x={(OBJ_X + LENS_X) / 2} y={AXIS_Y + 48} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={11} textAnchor="middle">
            p = {fmtCm(OBJ_P_CM)}
          </text>
        </g>

        {/* Rays (stage 1 & 2 only) */}
        {showRays && (
          <g opacity={0.9}>
            {/* Ray 1: parallel-then-focal (orange) */}
            <line x1={OBJ_X} y1={bY} x2={LENS_X} y2={bY} stroke={RAY_COLORS.parallel} strokeWidth={1.5} />
            <line x1={LENS_X} y1={bY} x2={RIGHT_EDGE} y2={ray1EndY} stroke={RAY_COLORS.parallel} strokeWidth={1.5} />
            {/* Ray 2: through O (teal) */}
            <line x1={OBJ_X} y1={bY} x2={RIGHT_EDGE} y2={ray2EndY} stroke={RAY_COLORS.central} strokeWidth={1.5} />
            {/* Ray 3: focal-then-parallel (violet), only if F is between OBJ and LENS on axis */}
            {fFocalX > OBJ_X && fFocalX < LENS_X && (
              <>
                <line x1={OBJ_X} y1={bY} x2={LENS_X} y2={ray3LensY} stroke={RAY_COLORS.focal} strokeWidth={1.5} />
                <line x1={LENS_X} y1={ray3LensY} x2={RIGHT_EDGE} y2={ray3LensY} stroke={RAY_COLORS.focal} strokeWidth={1.5} />
              </>
            )}
            {/* Image tip marker at true image plane */}
            {imageX > LENS_X && imageX < 780 && (
              <circle cx={imageX} cy={bImgY} r={3.5} fill="#EAF0FA" opacity={0.5} />
            )}
          </g>
        )}

        {/* Converging lens — vertical double-arrowed line at LENS_X */}
        <g>
          <line x1={LENS_X} y1={AXIS_Y - LENS_HALF_H} x2={LENS_X} y2={AXIS_Y + LENS_HALF_H} stroke="#8FA4C4" strokeWidth={2.5} strokeLinecap="round" />
          {/* Top arrowheads (converging = out-pointing) */}
          <polygon points={`${LENS_X - 6},${AXIS_Y - LENS_HALF_H + 8} ${LENS_X},${AXIS_Y - LENS_HALF_H} ${LENS_X + 6},${AXIS_Y - LENS_HALF_H + 8}`} fill="#8FA4C4" />
          <polygon points={`${LENS_X - 6},${AXIS_Y + LENS_HALF_H - 8} ${LENS_X},${AXIS_Y + LENS_HALF_H} ${LENS_X + 6},${AXIS_Y + LENS_HALF_H - 8}`} fill="#8FA4C4" />
          {/* Lens center O marker */}
          <circle cx={LENS_X} cy={AXIS_Y} r={3} fill="#8FA4C4" />
          <text x={LENS_X + 10} y={AXIS_Y - LENS_HALF_H - 6} fill="#8FA4C4" fontFamily="'JetBrains Mono', monospace" fontSize={11}>
            {labels.lens}
          </text>
          <text x={LENS_X + 10} y={AXIS_Y - 6} fill="#8FA4C4" fontFamily="'JetBrains Mono', monospace" fontSize={11}>
            O
          </text>
        </g>

        {/* Screen — draggable */}
        <g
          onPointerDown={(e) => { e.preventDefault(); setDragging(true); const p = svgPoint(e); if (p) applyDrag(p) }}
          style={{ cursor: 'grab' }}
        >
          {/* Screen body */}
          <rect x={screenX - 5} y={SCREEN_TOP} width={10} height={SCREEN_BOT - SCREEN_TOP} fill="#1A2338" stroke="#8FA4C4" strokeWidth={1.5} />
          {/* Screen face (light side facing lens) */}
          <rect x={screenX - 5} y={SCREEN_TOP} width={5} height={SCREEN_BOT - SCREEN_TOP} fill="#0f1a2f" />
          {/* Drag handles */}
          <rect x={screenX - 12} y={SCREEN_TOP - 10} width={24} height={12} fill="#37C9B8" opacity={0.85} rx={2} />
          <rect x={screenX - 12} y={SCREEN_BOT - 2} width={24} height={12} fill="#37C9B8" opacity={0.85} rx={2} />
          {/* Projected image (blurred arrow, inverted below axis) */}
          <g filter={`url(#${blurFilterId})`}>
            <line
              x1={screenX}
              y1={AXIS_Y}
              x2={screenX}
              y2={AXIS_Y + imgArrowHeight}
              stroke="#F97316"
              strokeWidth={2.2}
              opacity={0.9}
            />
            <polygon
              points={`${screenX},${AXIS_Y + imgArrowHeight + 8} ${screenX - 5},${AXIS_Y + imgArrowHeight} ${screenX + 5},${AXIS_Y + imgArrowHeight}`}
              fill="#F97316"
              opacity={0.9}
            />
          </g>
          {/* Screen distance annotation */}
          <line x1={LENS_X} y1={AXIS_Y + 74} x2={screenX} y2={AXIS_Y + 74} stroke="#54617A" strokeWidth={1} />
          <line x1={LENS_X} y1={AXIS_Y + 70} x2={LENS_X} y2={AXIS_Y + 78} stroke="#54617A" strokeWidth={1} />
          <line x1={screenX} y1={AXIS_Y + 70} x2={screenX} y2={AXIS_Y + 78} stroke="#54617A" strokeWidth={1} />
          <text x={(LENS_X + screenX) / 2} y={AXIS_Y + 90} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={11} textAnchor="middle">
            p&apos; = {fmtCm(screenPCm)}
          </text>
        </g>

        {/* Fire flash — green pulse on hit, red on miss (post-submit feedback) */}
        {fireFlash && (() => {
          const elapsed = Date.now() - fireFlash.at
          const op = clamp(1 - elapsed / 900, 0, 1)
          const color = fireFlash.ok ? '#37C9B8' : '#E44063'
          return (
            <g opacity={op * 0.9}>
              <rect x={screenX - 26} y={SCREEN_TOP - 20} width={52} height={SCREEN_BOT - SCREEN_TOP + 40} fill="none" stroke={color} strokeWidth={3} rx={4} />
            </g>
          )
        })()}

        {/* Peek badge — stage 3 top-center */}
        {isStage3 && peekVisible && (
          <g>
            <rect x={W / 2 - 200} y={12} width={400} height={62} rx={8} fill="rgba(13,21,36,.9)" stroke="#F97316" strokeWidth={1.5} />
            <text x={W / 2} y={32} fill="#F9A968" fontFamily="'JetBrains Mono', monospace" fontSize={11} textAnchor="middle" letterSpacing="0.08em">
              STRATEGY: EYE THE MINIMUM BLOB, THEN f&apos; = p·p&apos;/(p+p&apos;)
            </text>
            <text x={W / 2} y={54} fill="#EAF0FA" fontFamily="'JetBrains Mono', monospace" fontSize={13} textAnchor="middle" fontWeight={700} letterSpacing="0.1em">
              p&apos; = {fmtCmShort(screenPCm)} cm · f&apos; = {fmtCmShort(measuredF)} cm
            </text>
          </g>
        )}

        {/* Stage 2/3: lens progress dots (top-center of scene) */}
        {(isStage2 || isStage3) && (
          <g>
            {activeTargets.map((_, i) => {
              const cx = W / 2 - (activeTargets.length - 1) * 12 + i * 24
              const isCurrent = i === targetIdx
              const isL = lit[i]
              return (
                <g key={`ld-${i}`}>
                  <circle
                    cx={cx}
                    cy={92}
                    r={7}
                    fill={isL ? '#37C9B8' : 'none'}
                    stroke={isL ? '#37C9B8' : isCurrent ? '#F97316' : '#54617A'}
                    strokeWidth={2}
                  />
                </g>
              )
            })}
          </g>
        )}
      </svg>

      {/* HUD overlays — HTML in rem */}
      <div style={{ position: 'absolute', top: '3rem', left: '3rem', fontFamily: "'JetBrains Mono', monospace", fontSize: '2.3rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: '#6C7A93', zIndex: 5, pointerEvents: 'none' }}>
        {hudTL}
      </div>
      <div style={{ position: 'absolute', top: '7.5rem', left: '3rem', fontFamily: "'JetBrains Mono', monospace", fontSize: '1.9rem', letterSpacing: '0.08em', color: canSubmit ? '#37C9B8' : '#B9C4D6', zIndex: 5, pointerEvents: 'none' }}>
        {progressLine}
      </div>
      <div style={{ position: 'absolute', top: '3rem', right: '3rem', fontFamily: "'JetBrains Mono', monospace", fontSize: '1.9rem', letterSpacing: '0.06em', color: '#B9C4D6', zIndex: 5, pointerEvents: 'none', textAlign: 'right', maxWidth: '55%' }}>
        {hudTR}
      </div>
      <div style={{ position: 'absolute', bottom: '3rem', left: '3rem', fontFamily: "'JetBrains Mono', monospace", fontSize: '2rem', letterSpacing: '0.06em', color: '#6C7A93', zIndex: 5, pointerEvents: 'none', maxWidth: '52%' }}>
        {hudBL}
      </div>
      {/* NO bottom-right overlay — BR reserved for parent chrome */}

      {/* Fire button (stages 2 & 3) */}
      {(isStage2 || isStage3) && (
        <button
          type="button"
          onClick={fire}
          disabled={!canFire}
          style={{
            position: 'absolute',
            bottom: '3rem',
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '1.6rem 3.6rem',
            background: canFire ? '#F97316' : 'rgba(30,42,64,0.85)',
            color: canFire ? '#FFFFFF' : '#6C7A93',
            border: `0.3rem solid ${canFire ? '#F97316' : 'rgba(58,72,99,0.6)'}`,
            borderRadius: '100rem',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '2.4rem',
            fontWeight: 700,
            letterSpacing: '0.12em',
            cursor: canFire ? 'pointer' : 'not-allowed',
            zIndex: 10,
          }}
        >
          <i className="bi bi-lightning-charge-fill" style={{ marginInlineEnd: '0.8rem', fontSize: '2.4rem', verticalAlign: '-0.2rem' }} />
          {labels.fire}
        </button>
      )}

      {/* Tick reference to force re-render on rAF flash */}
      <span style={{ display: 'none' }}>{tick}</span>
    </div>
  )
}
