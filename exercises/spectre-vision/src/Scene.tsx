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

const SOURCE = { x: 90, y: 225 }
const PRISM_C = { x: 380, y: 225 }
const PRISM_SIZE = 66 // half-height of triangle
const SCREEN_X = 700
const SCREEN_TOP = 60
const SCREEN_BOT = 400

// Prism rotation limits and mapping
const PHI_MIN = -0.4 // ~ -22.9°
const PHI_MAX = 0.4 // ~ +22.9°
const DEFAULT_PHI = 0

// Spectrum model — qualitative, 1ère-level. The prism disperses white light
// into a rainbow; rotation shifts the whole spectrum vertically.
const LAMBDA_MIN = 400
const LAMBDA_MAX = 700
const LAMBDA_CENTER = 550

// Screen intersection: y(λ, φ) = SCREEN_CENTER_Y + PHI_TO_Y·φ + DISP_PER_NM·(λ − λc).
// Shorter λ (violet) deviates MORE → sits higher on screen (smaller SVG y)
// in the natural orientation (φ = 0). Rotating the prism translates the
// whole band; wavelength ordering is invariant.
const SCREEN_CENTER_Y = 225
const PHI_TO_Y = 260
const DISP_PER_NM = 0.35

// Hit tolerance (SVG px) — chosen so tap-precision is achievable with a drag
// and adjacent target φ solutions stay well-separated.
const HIT_TOL_Y = 11

type Slit = { id: string; lambda: number; y: number }

const STAGE2_SLITS: Slit[] = [
  { id: 's2-red', lambda: 650, y: 280 },
  { id: 's2-green', lambda: 530, y: 170 },
  { id: 's2-blue', lambda: 460, y: 250 },
]
const STAGE2_SHOT_BUDGET = 5

// Stage-3 setups (seed-picked). Each has 3 slits requiring 3 distinct φ.
// Hand-verified: every required φ ∈ (PHI_MIN, PHI_MAX) and adjacent-φ gaps
// exceed 2·(HIT_TOL_Y / PHI_TO_Y) so cross-firing is impossible.
const STAGE3_SETUPS: { slits: Slit[] }[] = [
  {
    slits: [
      { id: 's3a-red', lambda: 640, y: 310 },
      { id: 's3a-green', lambda: 540, y: 200 },
      { id: 's3a-violet', lambda: 420, y: 140 },
    ],
  },
  {
    slits: [
      { id: 's3b-orange', lambda: 600, y: 260 },
      { id: 's3b-cyan', lambda: 500, y: 190 },
      { id: 's3b-red', lambda: 680, y: 340 },
    ],
  },
  {
    slits: [
      { id: 's3c-green', lambda: 550, y: 210 },
      { id: 's3c-violet', lambda: 430, y: 130 },
      { id: 's3c-yellow', lambda: 580, y: 270 },
    ],
  },
]

// Fire trail timing (cosmetic only, driven by rAF).
const BEAM_INCIDENT_MS = 90
const BEAM_FAN_MS = 320
const BEAM_FADE_MS = 500
const BEAM_TOTAL_MS = BEAM_INCIDENT_MS + BEAM_FAN_MS + BEAM_FADE_MS

// ─── Wavelength → sRGB (piecewise CIE approximation, inlined) ─────────
function wavelengthToRgb(nm: number): [number, number, number] {
  let r = 0
  let g = 0
  let b = 0
  if (nm >= 380 && nm < 440) {
    r = -(nm - 440) / (440 - 380); g = 0; b = 1
  } else if (nm < 490) {
    r = 0; g = (nm - 440) / (490 - 440); b = 1
  } else if (nm < 510) {
    r = 0; g = 1; b = -(nm - 510) / (510 - 490)
  } else if (nm < 580) {
    r = (nm - 510) / (580 - 510); g = 1; b = 0
  } else if (nm < 645) {
    r = 1; g = -(nm - 645) / (645 - 580); b = 0
  } else if (nm <= 780) {
    r = 1; g = 0; b = 0
  }
  let factor = 1
  if (nm >= 380 && nm < 420) factor = 0.3 + 0.7 * (nm - 380) / 40
  else if (nm > 700) factor = 0.3 + 0.7 * (780 - nm) / 80
  const gamma = 0.8
  const to8 = (c: number) =>
    Math.round(255 * Math.pow(Math.max(0, c) * factor, gamma))
  return [to8(r), to8(g), to8(b)]
}
function wavelengthCss(nm: number, alpha = 1): string {
  const [r, g, b] = wavelengthToRgb(nm)
  return `rgba(${r},${g},${b},${alpha})`
}

// ─── Geometry / physics helpers ────────────────────────────
function screenYFor(lambda: number, phi: number): number {
  return SCREEN_CENTER_Y + PHI_TO_Y * phi + DISP_PER_NM * (lambda - LAMBDA_CENTER)
}
function hitSlit(phi: number, slit: Slit): boolean {
  return Math.abs(screenYFor(slit.lambda, phi) - slit.y) < HIT_TOL_Y
}
function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x))
}
function cartY(svgY: number): number {
  return H - svgY
}
function radToDeg(r: number): number {
  return (r * 180) / Math.PI
}

// Prism vertex geometry — apex up (untransformed), rotated by phi about PRISM_C.
function prismPoints(phi: number): string {
  const h = PRISM_SIZE
  const vs: [number, number][] = [
    [0, -h],
    [-h * 0.87, h * 0.5],
    [h * 0.87, h * 0.5],
  ]
  const c = Math.cos(phi)
  const s = Math.sin(phi)
  return vs
    .map(([x, y]) =>
      `${(PRISM_C.x + c * x - s * y).toFixed(2)},${(PRISM_C.y + s * x + c * y).toFixed(2)}`,
    )
    .join(' ')
}

// ─── Locale label loader ───────────────────────────────────
const dict = { en } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── Component ─────────────────────────────────────────────
export default function Scene() {
  const { locale, seed } = useInit()
  const stages = useMemo(() => getStagesFor(locale), [locale])
  useDeclareStages(stages)
  const labels = useMemo(() => svgLabels(locale), [locale])

  const stage3Setup = useMemo(
    () => STAGE3_SETUPS[seed % STAGE3_SETUPS.length]!,
    [seed],
  )

  const stageIdx = useCurrentStage()
  const setStage = useSetStage()

  const [phi, setPhi] = useState(DEFAULT_PHI)
  const [dragging, setDragging] = useState(false)
  const dragStartRef = useRef<{ pointerAngle: number; phi0: number } | null>(null)
  const [phiSweepMin, setPhiSweepMin] = useState(DEFAULT_PHI)
  const [phiSweepMax, setPhiSweepMax] = useState(DEFAULT_PHI)
  const [lit, setLit] = useState<string[]>([])
  const [shots, setShots] = useState(0)
  const [targetIdx, setTargetIdx] = useState(0)
  const [beamAnim, setBeamAnim] = useState<{ phi: number; at: number } | null>(null)
  const [tick, setTick] = useState(0)
  const [peekVisible, setPeekVisible] = useState(false)

  const svgRef = useRef<SVGSVGElement>(null)
  const rafRef = useRef<number>(0)

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  const activeSlits: Slit[] = isStage2
    ? STAGE2_SLITS
    : isStage3
      ? stage3Setup.slits
      : []

  const progress = useProgress()
  const complete = useComplete()

  const resetStageState = useCallback(() => {
    setPhi(DEFAULT_PHI)
    setPhiSweepMin(DEFAULT_PHI)
    setPhiSweepMax(DEFAULT_PHI)
    setLit([])
    setShots(0)
    setTargetIdx(0)
    setBeamAnim(null)
    setPeekVisible(false)
  }, [])
  useReset(resetStageState)

  // Stage 1 advance: sweep at least ~20° total range.
  const phiSweep = phiSweepMax - phiSweepMin
  const STAGE1_SWEEP_MIN = 0.35

  const canFire = isStage2
    ? shots < STAGE2_SHOT_BUDGET && lit.length < activeSlits.length
    : isStage3
      ? targetIdx < activeSlits.length
      : false

  const fire = useCallback(() => {
    if (!canFire) return
    if (isStage2) {
      const newlyLit = activeSlits
        .filter((sl) => !lit.includes(sl.id) && hitSlit(phi, sl))
        .map((sl) => sl.id)
      setShots((s) => s + 1)
      if (newlyLit.length) setLit((prev) => [...prev, ...newlyLit])
    } else if (isStage3) {
      const cur = activeSlits[targetIdx]
      if (cur && hitSlit(phi, cur)) {
        setLit((prev) => [...prev, cur.id])
      }
      setTargetIdx((i) => i + 1)
    }
    setBeamAnim({ phi, at: Date.now() })
    setTick(Date.now())
  }, [canFire, phi, isStage2, isStage3, activeSlits, lit, targetIdx])

  // Stage-3 one-shot-per-target: if all shots spent without lighting all
  // targets, reset the stage (fresh attempt on the same seeded setup).
  useEffect(() => {
    if (!isStage3) return
    if (!(targetIdx >= activeSlits.length && lit.length < activeSlits.length)) return
    const t = setTimeout(resetStageState, 900)
    return () => clearTimeout(t)
  }, [isStage3, targetIdx, lit.length, activeSlits.length, resetStageState])

  // Cosmetic beam animation (rAF; not useTicker — this is not physics).
  useEffect(() => {
    if (!beamAnim) return
    const step = () => {
      const now = Date.now()
      if (now - beamAnim.at >= BEAM_TOTAL_MS) {
        setBeamAnim(null)
        return
      }
      setTick(now)
      rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(rafRef.current)
  }, [beamAnim])

  const canSubmit = isStage1
    ? phiSweep >= STAGE1_SWEEP_MIN
    : isStage2
      ? lit.length === activeSlits.length
      : lit.length === activeSlits.length && targetIdx >= activeSlits.length

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

  // Peek — strategy hint + current φ (§4.7 rule 4). NEVER reveals the spectrum.
  usePeek(() => {
    if (!isStage3) return
    setPeekVisible(true)
  })
  useEffect(() => {
    if (!peekVisible) return
    const t = setTimeout(() => setPeekVisible(false), 1800)
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

  // ─── Pointer / drag on the prism ──────────────────────────
  const svgPoint = (e: React.PointerEvent) => {
    const el = svgRef.current
    if (!el) return null
    const rect = el.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) / rect.width) * W,
      y: ((e.clientY - rect.top) / rect.height) * H,
    }
  }
  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault()
    const p = svgPoint(e)
    if (!p) return
    dragStartRef.current = {
      pointerAngle: Math.atan2(p.y - PRISM_C.y, p.x - PRISM_C.x),
      phi0: phi,
    }
    setDragging(true)
  }
  const applyDrag = (p: { x: number; y: number }) => {
    const start = dragStartRef.current
    if (!start) return
    const cur = Math.atan2(p.y - PRISM_C.y, p.x - PRISM_C.x)
    const next = clamp(start.phi0 + (cur - start.pointerAngle), PHI_MIN, PHI_MAX)
    setPhi(next)
    setPhiSweepMin((prev) => Math.min(prev, next))
    setPhiSweepMax((prev) => Math.max(prev, next))
  }

  // ─── Beam trail phase state (stages 2 & 3 animation) ───────
  let iFrac = 0
  let fanFrac = 0
  let beamOp = 0
  if (beamAnim) {
    const elapsed = Math.max(0, tick - beamAnim.at)
    if (elapsed < BEAM_INCIDENT_MS) {
      iFrac = elapsed / BEAM_INCIDENT_MS
      beamOp = 1
    } else if (elapsed < BEAM_INCIDENT_MS + BEAM_FAN_MS) {
      iFrac = 1
      fanFrac = (elapsed - BEAM_INCIDENT_MS) / BEAM_FAN_MS
      beamOp = 1
    } else {
      iFrac = 1
      fanFrac = 1
      beamOp = 1 - (elapsed - BEAM_INCIDENT_MS - BEAM_FAN_MS) / BEAM_FADE_MS
    }
  }

  // Continuous spectrum band on the screen (stages 1 & 2 only — HELP that is
  // REMOVED in stage 3 per §4.7 / §5.2).
  const SPECTRUM_SAMPLES = 44
  const spectrumBand = useMemo(() => {
    if (isStage3) return null
    const step = (LAMBDA_MAX - LAMBDA_MIN) / SPECTRUM_SAMPLES
    const nodes: React.ReactNode[] = []
    for (let i = 0; i <= SPECTRUM_SAMPLES; i++) {
      const lambda = LAMBDA_MIN + i * step
      const y = screenYFor(lambda, phi)
      if (y < SCREEN_TOP - 4 || y > SCREEN_BOT + 4) continue
      nodes.push(
        <rect
          key={`b${i}`}
          x={SCREEN_X - 8}
          y={y - (step * DISP_PER_NM) / 2 - 0.3}
          width={16}
          height={step * DISP_PER_NM + 0.6}
          fill={wavelengthCss(lambda, 0.95)}
        />,
      )
    }
    return nodes
  }, [phi, isStage3])

  // Fire-trail colored rays from prism exit face to screen (stages 2 & 3).
  const trailRays = useMemo(() => {
    if (!beamAnim || fanFrac <= 0) return null
    const rays: React.ReactNode[] = []
    const N = 22
    const step = (LAMBDA_MAX - LAMBDA_MIN) / N
    const startX = PRISM_C.x + PRISM_SIZE * 0.7
    const startY = PRISM_C.y
    for (let i = 0; i <= N; i++) {
      const lambda = LAMBDA_MIN + i * step
      const yEnd = screenYFor(lambda, beamAnim.phi)
      const endX = startX + (SCREEN_X - 8 - startX) * fanFrac
      const endY = startY + (yEnd - startY) * fanFrac
      rays.push(
        <line
          key={`r${i}`}
          x1={startX}
          y1={startY}
          x2={endX}
          y2={endY}
          stroke={wavelengthCss(lambda, 0.85)}
          strokeWidth={1.6}
          strokeLinecap="round"
        />,
      )
    }
    return rays
  }, [beamAnim, fanFrac])

  const stageName = stages[stageIdx - 1]?.name ?? ''
  const phiDeg = radToDeg(phi)
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`
  const hudTR = `${labels.angle} = ${phiDeg >= 0 ? '+' : ''}${phiDeg.toFixed(1)}°`
  const hudBL = isStage1 ? labels.tip1 : isStage2 ? labels.tip2 : labels.tip3

  const currentSlit: Slit | undefined = isStage3 ? activeSlits[targetIdx] : undefined
  const showContinuousSpectrum = !isStage3
  const showFireButton = !isStage1
  const stage3Missed =
    isStage3 && targetIdx >= activeSlits.length && lit.length < activeSlits.length

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
        onPointerMove={(e) => {
          if (dragging) {
            const p = svgPoint(e)
            if (p) applyDrag(p)
          }
        }}
        onPointerUp={() => {
          setDragging(false)
          dragStartRef.current = null
        }}
        onPointerLeave={() => {
          setDragging(false)
          dragStartRef.current = null
        }}
      >
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        {/* Bench frame */}
        <rect
          x={32}
          y={44}
          width={738}
          height={378}
          fill="none"
          stroke="#12203a"
          strokeWidth={1}
          rx={6}
        />
        <text
          x={40}
          y={36}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={11}
          letterSpacing="0.1em"
        >
          {labels.bench}
        </text>

        {/* Stage-3 read-off grid near the screen (subtle, dashed) */}
        {isStage3 && (() => {
          const nodes: React.ReactNode[] = []
          for (let y = 80; y <= 400; y += 40) {
            nodes.push(
              <line
                key={`g${y}`}
                x1={SCREEN_X - 60}
                y1={y}
                x2={SCREEN_X + 12}
                y2={y}
                stroke="#1a2540"
                strokeWidth={0.6}
                strokeDasharray="2 4"
              />,
            )
          }
          return nodes
        })()}

        {/* Incident white ray from source to prism edge */}
        <line
          x1={SOURCE.x + 16}
          y1={SOURCE.y}
          x2={PRISM_C.x - PRISM_SIZE * 0.87}
          y2={PRISM_C.y}
          stroke="#EAF0FA"
          strokeOpacity={0.15}
          strokeWidth={8}
          strokeLinecap="round"
        />
        <line
          x1={SOURCE.x + 16}
          y1={SOURCE.y}
          x2={PRISM_C.x - PRISM_SIZE * 0.87}
          y2={PRISM_C.y}
          stroke="#EAF0FA"
          strokeOpacity={0.7}
          strokeWidth={2.4}
          strokeLinecap="round"
        />

        {/* Continuous spectrum on the screen (stages 1 & 2) */}
        {showContinuousSpectrum && spectrumBand}

        {/* Fire trail (stages 2 & 3): incident flash + fanning colored rays */}
        {beamAnim && (
          <g opacity={beamOp}>
            {iFrac > 0 && (
              <line
                x1={SOURCE.x + 16}
                y1={SOURCE.y}
                x2={
                  SOURCE.x +
                  16 +
                  (PRISM_C.x - PRISM_SIZE * 0.87 - SOURCE.x - 16) * iFrac
                }
                y2={SOURCE.y + (PRISM_C.y - SOURCE.y) * iFrac}
                stroke="#F5F8FF"
                strokeWidth={2.6}
                strokeLinecap="round"
              />
            )}
            {trailRays}
          </g>
        )}

        {/* Source (white lamp) */}
        <circle cx={SOURCE.x} cy={SOURCE.y} r={14} fill="#F5F8FF" opacity={0.18} />
        <circle cx={SOURCE.x} cy={SOURCE.y} r={7} fill="#F5F8FF" />
        <text
          x={SOURCE.x}
          y={SOURCE.y + 28}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={10}
          textAnchor="middle"
        >
          {labels.source}
        </text>
        {isStage3 && (
          <text
            x={SOURCE.x}
            y={SOURCE.y - 20}
            fill="#F9A968"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={10}
            textAnchor="middle"
          >
            S ({SOURCE.x}, {cartY(SOURCE.y)})
          </text>
        )}

        {/* Screen (dark bar) */}
        <rect
          x={SCREEN_X - 8}
          y={SCREEN_TOP}
          width={16}
          height={SCREEN_BOT - SCREEN_TOP}
          fill="#050B18"
          stroke="#2A3654"
          strokeWidth={1}
        />
        <text
          x={SCREEN_X}
          y={SCREEN_TOP - 8}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={10}
          textAnchor="middle"
        >
          {labels.screen}
        </text>

        {/* Slit targets (stages 2 & 3) */}
        {(isStage2 || isStage3) &&
          activeSlits.map((sl, i) => {
            const isCurrent = isStage3 && i === targetIdx
            const isLit = lit.includes(sl.id)
            const color = wavelengthCss(sl.lambda, 1)
            return (
              <g key={sl.id}>
                {/* Colored chip next to the screen — declares the target's λ */}
                <rect
                  x={SCREEN_X + 14}
                  y={sl.y - 6}
                  width={20}
                  height={12}
                  fill={color}
                  opacity={isLit ? 1 : 0.55}
                  stroke={
                    isLit
                      ? '#37C9B8'
                      : isCurrent
                        ? '#F97316'
                        : 'rgba(234,240,250,0.35)'
                  }
                  strokeWidth={isCurrent || isLit ? 1.6 : 0.8}
                  rx={2}
                />
                {/* Guide tick into the screen at the target y */}
                <line
                  x1={SCREEN_X - 14}
                  y1={sl.y}
                  x2={SCREEN_X - 8}
                  y2={sl.y}
                  stroke={
                    isLit ? '#37C9B8' : isCurrent ? '#F97316' : '#54617A'
                  }
                  strokeWidth={1.6}
                />
                {isLit && (
                  <circle
                    cx={SCREEN_X}
                    cy={sl.y}
                    r={13}
                    fill="#37C9B8"
                    opacity={0.22}
                  />
                )}
                {/* Required-info label for the blind stage: λ + Cartesian y */}
                {isStage3 && (
                  <text
                    x={SCREEN_X + 38}
                    y={sl.y + 3}
                    fill="#F9A968"
                    fontFamily="'JetBrains Mono', monospace"
                    fontSize={10}
                  >
                    λ={sl.lambda}nm · y={cartY(sl.y)}
                  </text>
                )}
              </g>
            )
          })}

        {/* Draggable prism */}
        <g
          onPointerDown={startDrag}
          style={{ cursor: dragging ? 'grabbing' : 'grab' }}
        >
          <polygon
            points={prismPoints(phi)}
            fill="none"
            stroke="rgba(234,240,250,0.12)"
            strokeWidth={12}
            strokeLinejoin="round"
          />
          <polygon
            points={prismPoints(phi)}
            fill="rgba(234,240,250,0.08)"
            stroke="#EAF0FA"
            strokeWidth={2}
            strokeLinejoin="round"
          />
          <circle cx={PRISM_C.x} cy={PRISM_C.y} r={3} fill="#37C9B8" />
        </g>
        <text
          x={PRISM_C.x}
          y={PRISM_C.y + PRISM_SIZE + 22}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={10}
          textAnchor="middle"
        >
          {labels.prism}
        </text>
        {isStage3 && (
          <text
            x={PRISM_C.x}
            y={PRISM_C.y - PRISM_SIZE - 12}
            fill="#F9A968"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={10}
            textAnchor="middle"
          >
            P ({PRISM_C.x}, {cartY(PRISM_C.y)})
          </text>
        )}

        {/* Peek strategy overlay (top-center) — NEVER shows the spectrum. */}
        {isStage3 && peekVisible && (
          <g>
            <rect
              x={W / 2 - 220}
              y={16}
              width={440}
              height={54}
              rx={10}
              fill="rgba(13,21,36,.92)"
              stroke="#F97316"
              strokeWidth={1.5}
            />
            <text
              x={W / 2}
              y={36}
              fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={11}
              textAnchor="middle"
              letterSpacing="0.05em"
            >
              y(λ) = 225 + 260·φ + 0.35·(λ − 550) · solve for φ
            </text>
            <text
              x={W / 2}
              y={56}
              fill="#B9C4D6"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={11}
              textAnchor="middle"
              letterSpacing="0.05em"
            >
              current φ = {phiDeg >= 0 ? '+' : ''}{phiDeg.toFixed(1)}°
            </text>
          </g>
        )}
      </svg>

      {/* HUD overlays — HTML in rem, NOT SVG text */}
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
          fontSize: '2.3rem',
          letterSpacing: '0.08em',
          color: canSubmit ? '#37C9B8' : '#B9C4D6',
          zIndex: 5,
          pointerEvents: 'none',
          textAlign: 'right',
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
          fontSize: '2.3rem',
          letterSpacing: '0.06em',
          color: '#6C7A93',
          zIndex: 5,
          pointerEvents: 'none',
          maxWidth: '46%',
        }}
      >
        {hudBL}
      </div>
      {/* NO bottom-right overlay — BR reserved for parent chrome (fullscreen). */}

      {/* Secondary status (progress / shots) — stacked under TL, not BR */}
      <div
        style={{
          position: 'absolute',
          top: '8rem',
          left: '3rem',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '2rem',
          letterSpacing: '0.08em',
          color: canSubmit ? '#37C9B8' : '#B9C4D6',
          zIndex: 5,
          pointerEvents: 'none',
        }}
      >
        {isStage1
          ? `${labels.sweep} ${Math.min(100, Math.round((phiSweep / STAGE1_SWEEP_MIN) * 100))}%`
          : isStage2
            ? `${labels.shots} ${shots}/${STAGE2_SHOT_BUDGET} · ${labels.lit} ${lit.length}/${activeSlits.length}`
            : `${labels.shot} ${targetIdx}/${activeSlits.length} · ${labels.lit} ${lit.length}/${activeSlits.length}`}
      </div>

      {/* Stage-3 current-target hint (required info line) */}
      {isStage3 && currentSlit && !stage3Missed && (
        <div
          style={{
            position: 'absolute',
            top: '13rem',
            left: '3rem',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '1.9rem',
            letterSpacing: '0.06em',
            color: '#F9A968',
            zIndex: 5,
            pointerEvents: 'none',
          }}
        >
          {labels.aim} λ={currentSlit.lambda}nm → y={cartY(currentSlit.y)}
        </div>
      )}
      {isStage3 && stage3Missed && (
        <div
          style={{
            position: 'absolute',
            top: '13rem',
            left: '3rem',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '1.9rem',
            letterSpacing: '0.06em',
            color: '#F97316',
            zIndex: 5,
            pointerEvents: 'none',
          }}
        >
          {labels.miss_reset}
        </div>
      )}

      {/* Fire button */}
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
            style={{
              marginInlineEnd: '0.8rem',
              fontSize: '2.8rem',
              verticalAlign: '-0.2rem',
            }}
          />
          {labels.fire}
        </button>
      )}
    </div>
  )
}
