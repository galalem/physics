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
const AXIS_Y = 225
const AXIS_X0 = 60
const AXIS_X1 = 740
const O = { x: 400, y: AXIS_Y }

// f' calibration
const PX_PER_CM = 8
const F_MIN_CM = 5
const F_MAX_CM = 40
const DEFAULT_F_CM = 20

// Success tolerances
const HIT_TOL_CM = 0.8 // ±0.8 cm ≈ 6.4 px
const STAGE2_MAX_SHOTS = 5 // 3 targets, K+2 slack
const COVERAGE_MIN_CM = 8 // ≥ ~23% of the 35 cm range

// Lens rendering
const LENS_H = 220
const LENS_TOP = AXIS_Y - LENS_H / 2
const LENS_BOT = AXIS_Y + LENS_H / 2

// ─── Hand-authored setups ───────────────────────────────────────────────
type Target = { id: string; fCm: number }
type Setup = { targets: Target[] }

const STAGE2_TARGETS: Target[] = [
  { id: 't2a', fCm: 10 }, //  C = 10.0 δ
  { id: 't2b', fCm: 25 }, //  C =  4.0 δ
  { id: 't2c', fCm: 15 }, //  C ≈  6.67 δ
]

// Stage-3 setups — each is a 3-target sequence.  Miss the sequence → cycle to next.
const STAGE3_SETUPS: Setup[] = [
  {
    targets: [
      { id: 's0a', fCm: 10 }, //  C = 10 δ
      { id: 's0b', fCm: 25 }, //  C =  4 δ
      { id: 's0c', fCm: 20 }, //  C =  5 δ
    ],
  },
  {
    targets: [
      { id: 's1a', fCm: 12.5 }, // C =  8 δ
      { id: 's1b', fCm: 8 }, //     C = 12.5 δ
      { id: 's1c', fCm: 20 }, //    C =  5 δ
    ],
  },
  {
    targets: [
      { id: 's2a', fCm: 5 }, //   C = 20 δ
      { id: 's2b', fCm: 25 }, //  C =  4 δ
      { id: 's2c', fCm: 10 }, //  C = 10 δ
    ],
  },
]

// ─── Locale dict ────────────────────────────────────────────────────────
const dict = { en } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── Pure helpers ───────────────────────────────────────────────────────
function vergenceFromCm(fCm: number): number {
  // C in dioptres for f' in centimetres: C = 1/f'(m) = 100/f'(cm)
  return 100 / fCm
}
function xFromFCm(fCm: number): number {
  return O.x + fCm * PX_PER_CM
}
function fCmFromX(x: number): number {
  return (x - O.x) / PX_PER_CM
}
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}
function lensThicknessPx(fCm: number): number {
  // Shorter f' → thicker lens.  30 px at f=5, 5 px at f=40.
  const frac = (F_MAX_CM - fCm) / (F_MAX_CM - F_MIN_CM)
  return 5 + 25 * frac
}

// ─── Component ──────────────────────────────────────────────────────────
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

  // ─── State ────────────────────────────────────────────────────────────
  const [fCm, setFCm] = useState(DEFAULT_F_CM)
  const [dragging, setDragging] = useState(false)
  const [fMin, setFMin] = useState(DEFAULT_F_CM)
  const [fMax, setFMax] = useState(DEFAULT_F_CM)
  const [lit, setLit] = useState<string[]>([])
  const [shots, setShots] = useState(0)
  const [targetIdx, setTargetIdx] = useState(0)
  const [setupIdx, setSetupIdx] = useState(seed % STAGE3_SETUPS.length)
  const [peekVisible, setPeekVisible] = useState(false)
  const [feedback, setFeedback] = useState<'ok' | 'miss' | null>(null)

  const svgRef = useRef<SVGSVGElement>(null)

  // ─── Derived ──────────────────────────────────────────────────────────
  const stage3Setup = STAGE3_SETUPS[setupIdx]!
  const activeTargets: Target[] = isStage2
    ? STAGE2_TARGETS
    : isStage3
      ? stage3Setup.targets
      : []
  const currentTarget = isStage2 || isStage3 ? activeTargets[targetIdx] : undefined

  const C = vergenceFromCm(fCm) // δ

  // ─── Reset ────────────────────────────────────────────────────────────
  const resetStageState = useCallback(() => {
    setFCm(DEFAULT_F_CM)
    setFMin(DEFAULT_F_CM)
    setFMax(DEFAULT_F_CM)
    setLit([])
    setShots(0)
    setTargetIdx(0)
    setPeekVisible(false)
    setFeedback(null)
    setDragging(false)
  }, [])
  useReset(resetStageState)

  // ─── Fire / Set ───────────────────────────────────────────────────────
  const canFire =
    isStage2
      ? shots < STAGE2_MAX_SHOTS && lit.length < activeTargets.length
      : isStage3
        ? targetIdx < activeTargets.length
        : false

  const fire = useCallback(() => {
    if (!canFire) return
    const target = activeTargets[targetIdx]
    if (!target) return
    const err = Math.abs(fCm - target.fCm)
    const hit = err <= HIT_TOL_CM

    if (isStage2) {
      setShots((s) => s + 1)
      if (hit && !lit.includes(target.id)) {
        setLit((prev) => [...prev, target.id])
        // Advance to the next unlit target if there is one.
        setTargetIdx((i) => Math.min(activeTargets.length - 1, i + 1))
        setFeedback('ok')
      } else {
        setFeedback('miss')
      }
    } else if (isStage3) {
      // One shot per target: advance regardless of hit.
      if (hit) setLit((prev) => [...prev, target.id])
      setTargetIdx((i) => i + 1)
      setFeedback(hit ? 'ok' : 'miss')
    }
  }, [canFire, activeTargets, targetIdx, fCm, isStage2, isStage3, lit])

  // Clear feedback pulse
  useEffect(() => {
    if (!feedback) return
    const t = setTimeout(() => setFeedback(null), 700)
    return () => clearTimeout(t)
  }, [feedback])

  // Stage 3: full-clear check → reset to next setup if any target missed
  useEffect(() => {
    if (!isStage3) return
    const allShotsFired = targetIdx >= activeTargets.length
    const allLit = lit.length === activeTargets.length
    if (allShotsFired && !allLit) {
      const nextSetup = (setupIdx + 1) % STAGE3_SETUPS.length
      setSetupIdx(nextSetup)
      setFCm(DEFAULT_F_CM)
      setLit([])
      setTargetIdx(0)
    }
  }, [isStage3, targetIdx, lit.length, activeTargets.length, setupIdx])

  // ─── Advance predicate ────────────────────────────────────────────────
  const stage1Done = fMax - fMin >= COVERAGE_MIN_CM
  const canSubmit = isStage1
    ? stage1Done
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

  // ─── Peek (strategy hint + live f') ───────────────────────────────────
  usePeek(() => {
    if (!isStage3) return
    setPeekVisible(true)
  })
  useEffect(() => {
    if (!peekVisible) return
    const t = setTimeout(() => setPeekVisible(false), 2200)
    return () => clearTimeout(t)
  }, [peekVisible])

  // ─── Hint handler ─────────────────────────────────────────────────────
  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  // ─── Spacebar fires (stages 2 & 3) ────────────────────────────────────
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

  // ─── Pointer / drag ──────────────────────────────────────────────────
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
    const newF = clamp(fCmFromX(p.x), F_MIN_CM, F_MAX_CM)
    setFCm(newF)
    setFMin((prev) => Math.min(prev, newF))
    setFMax((prev) => Math.max(prev, newF))
  }

  // ─── Geometry for rendering ──────────────────────────────────────────
  const fPx = fCm * PX_PER_CM
  const fPrimeX = O.x + fPx
  const fX = O.x - fPx
  const twoFPrimeX = O.x + 2 * fPx
  const twoFX = O.x - 2 * fPx
  const lensT = lensThicknessPx(fCm)

  // Biconvex lens path.  Two quadratic Beziers; at the midpoint each curve is
  // half-way between the axis line and its control point, so the max lens
  // half-width equals lensT / 2.
  const lensPath =
    `M ${O.x} ${LENS_TOP} ` +
    `Q ${O.x + lensT} ${AXIS_Y} ${O.x} ${LENS_BOT} ` +
    `Q ${O.x - lensT} ${AXIS_Y} ${O.x} ${LENS_TOP} Z`

  // ─── HUD ─────────────────────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`

  const fFmt = fCm.toFixed(1)
  const cFmt = C.toFixed(2)

  // Live readout — required information across ALL stages
  const hudTR = `f' = ${fFmt} cm  ·  C = ${cFmt} δ`

  // Bottom-left tip line
  const hudBL = isStage1 ? labels.tip1 : isStage2 ? labels.tip2 : labels.tip3

  // Extra TL row for progress / target (never BR)
  const hudTLSub = isStage2
    ? currentTarget
      ? `${labels.shots} ${shots}/${STAGE2_MAX_SHOTS} · ${labels.lit} ${lit.length}/${activeTargets.length} · ${labels.target_f} = ${currentTarget.fCm.toFixed(1)} cm`
      : `${labels.shots} ${shots}/${STAGE2_MAX_SHOTS} · ${labels.lit} ${lit.length}/${activeTargets.length}`
    : isStage3
      ? currentTarget
        ? `${labels.target} ${Math.min(targetIdx + 1, activeTargets.length)}/${activeTargets.length} · ${labels.target_C} = ${vergenceFromCm(currentTarget.fCm).toFixed(2)} δ`
        : `${labels.lit} ${lit.length}/${activeTargets.length}`
      : ''

  const stage2Exhausted =
    isStage2 && shots >= STAGE2_MAX_SHOTS && lit.length < activeTargets.length

  // ─── Render ──────────────────────────────────────────────────────────
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
        onPointerUp={() => setDragging(false)}
        onPointerLeave={() => setDragging(false)}
      >
        {/* Full-canvas background */}
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        {/* Bench frame */}
        <rect
          x={32}
          y={60}
          width={720}
          height={358}
          fill="none"
          stroke="#12203a"
          strokeWidth={1}
          rx={6}
        />
        <text
          x={40}
          y={52}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={11}
          letterSpacing="0.1em"
        >
          {labels.axis}
        </text>

        {/* Optical axis */}
        <line
          x1={AXIS_X0}
          y1={AXIS_Y}
          x2={AXIS_X1}
          y2={AXIS_Y}
          stroke={isStage3 ? '#1E2A44' : '#2A3654'}
          strokeWidth={1}
          strokeDasharray="4 4"
        />

        {/* Stage 1: 2F and 2F' tick marks */}
        {isStage1 && (
          <g>
            {twoFX > AXIS_X0 + 8 && (
              <>
                <line
                  x1={twoFX}
                  y1={AXIS_Y - 6}
                  x2={twoFX}
                  y2={AXIS_Y + 6}
                  stroke="#54617A"
                  strokeWidth={1}
                />
                <text
                  x={twoFX}
                  y={AXIS_Y + 22}
                  fill="#54617A"
                  fontFamily="'JetBrains Mono', monospace"
                  fontSize={10}
                  textAnchor="middle"
                >
                  2F
                </text>
              </>
            )}
            {twoFPrimeX < AXIS_X1 - 8 && (
              <>
                <line
                  x1={twoFPrimeX}
                  y1={AXIS_Y - 6}
                  x2={twoFPrimeX}
                  y2={AXIS_Y + 6}
                  stroke="#54617A"
                  strokeWidth={1}
                />
                <text
                  x={twoFPrimeX}
                  y={AXIS_Y + 22}
                  fill="#54617A"
                  fontFamily="'JetBrains Mono', monospace"
                  fontSize={10}
                  textAnchor="middle"
                >
                  2F'
                </text>
              </>
            )}
          </g>
        )}

        {/* Lens body — biconvex shape whose thickness follows 1/f' */}
        <path
          d={lensPath}
          fill="rgba(55, 201, 184, 0.10)"
          stroke="#37C9B8"
          strokeWidth={1.6}
          strokeLinejoin="round"
        />
        {/* Central axis of the lens */}
        <line
          x1={O.x}
          y1={LENS_TOP - 8}
          x2={O.x}
          y2={LENS_BOT + 8}
          stroke="#37C9B8"
          strokeWidth={0.8}
          strokeDasharray="2 3"
          opacity={0.55}
        />
        {/* Standard converging-lens chevrons top / bottom */}
        <path
          d={`M ${O.x - 6} ${LENS_TOP + 8} L ${O.x} ${LENS_TOP} L ${O.x + 6} ${LENS_TOP + 8}`}
          fill="none"
          stroke="#37C9B8"
          strokeWidth={1.6}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <path
          d={`M ${O.x - 6} ${LENS_BOT - 8} L ${O.x} ${LENS_BOT} L ${O.x + 6} ${LENS_BOT - 8}`}
          fill="none"
          stroke="#37C9B8"
          strokeWidth={1.6}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* O (optical centre) — dot + label (hidden on stage 3) */}
        <circle cx={O.x} cy={O.y} r={3.5} fill="#EAF0FA" />
        {!isStage3 && (
          <text
            x={O.x}
            y={AXIS_Y - 12}
            fill="#EAF0FA"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={11}
            textAnchor="middle"
          >
            O
          </text>
        )}

        {/* F (front focal point) — visible on stages 1 & 2 */}
        {!isStage3 && fX > AXIS_X0 + 8 && (
          <g>
            <circle cx={fX} cy={AXIS_Y} r={4} fill="#B9C4D6" />
            <text
              x={fX}
              y={AXIS_Y - 12}
              fill="#B9C4D6"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={11}
              textAnchor="middle"
            >
              F
            </text>
          </g>
        )}

        {/* Focal-length dimension segment (stage 1 only) */}
        {isStage1 && (
          <g>
            <line
              x1={O.x}
              y1={AXIS_Y + 46}
              x2={fPrimeX}
              y2={AXIS_Y + 46}
              stroke="#F9A968"
              strokeWidth={1.3}
            />
            <line
              x1={O.x}
              y1={AXIS_Y + 42}
              x2={O.x}
              y2={AXIS_Y + 50}
              stroke="#F9A968"
              strokeWidth={1.3}
            />
            <line
              x1={fPrimeX}
              y1={AXIS_Y + 42}
              x2={fPrimeX}
              y2={AXIS_Y + 50}
              stroke="#F9A968"
              strokeWidth={1.3}
            />
            <text
              x={(O.x + fPrimeX) / 2}
              y={AXIS_Y + 62}
              fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={12}
              textAnchor="middle"
            >
              f' = {fFmt} cm
            </text>
          </g>
        )}

        {/* Stage-2 current-target tick */}
        {isStage2 && currentTarget && (() => {
          const tx = xFromFCm(currentTarget.fCm)
          return (
            <g>
              {/* Vertical guide */}
              <line
                x1={tx}
                y1={AXIS_Y - 24}
                x2={tx}
                y2={AXIS_Y + 24}
                stroke="#F97316"
                strokeWidth={1.3}
                strokeDasharray="3 3"
                opacity={0.9}
              />
              {/* Downward chevron above axis */}
              <path
                d={`M ${tx - 6} ${AXIS_Y - 34} L ${tx} ${AXIS_Y - 26} L ${tx + 6} ${AXIS_Y - 34}`}
                fill="none"
                stroke="#F97316"
                strokeWidth={1.8}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              <text
                x={tx}
                y={AXIS_Y - 40}
                fill="#F9A968"
                fontFamily="'JetBrains Mono', monospace"
                fontSize={11}
                textAnchor="middle"
              >
                f'* = {currentTarget.fCm.toFixed(1)} cm
              </text>
              <text
                x={tx}
                y={AXIS_Y + 60}
                fill="#F9A968"
                fontFamily="'JetBrains Mono', monospace"
                fontSize={10}
                textAnchor="middle"
              >
                C* = {vergenceFromCm(currentTarget.fCm).toFixed(2)} δ
              </text>
            </g>
          )
        })()}

        {/* Stage-2 lit target ghosts (already hit) */}
        {isStage2 &&
          activeTargets
            .filter((t) => lit.includes(t.id))
            .map((t) => {
              const tx = xFromFCm(t.fCm)
              return (
                <g key={`lit-${t.id}`} opacity={0.45}>
                  <circle cx={tx} cy={AXIS_Y} r={6} fill="#37C9B8" />
                </g>
              )
            })}

        {/* F' — draggable handle.  Labeled on stages 1 & 2, bare on stage 3. */}
        <g
          onPointerDown={(e) => {
            e.preventDefault()
            setDragging(true)
            const p = svgPoint(e)
            if (p) applyDrag(p)
          }}
          style={{ cursor: dragging ? 'grabbing' : 'grab' }}
        >
          <circle
            cx={fPrimeX}
            cy={AXIS_Y}
            r={14}
            fill={
              feedback === 'ok'
                ? 'rgba(55,201,184,.22)'
                : feedback === 'miss'
                  ? 'rgba(249,115,22,.22)'
                  : 'rgba(249,115,22,.16)'
            }
          />
          <circle
            cx={fPrimeX}
            cy={AXIS_Y}
            r={6.5}
            fill={feedback === 'ok' ? '#37C9B8' : '#F97316'}
          />
          {!isStage3 && (
            <text
              x={fPrimeX}
              y={AXIS_Y - 20}
              fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={11}
              textAnchor="middle"
            >
              F'
            </text>
          )}
        </g>

        {/* Peek strategy badge (stage 3) */}
        {isStage3 && peekVisible && (
          <g>
            <rect
              x={W / 2 - 220}
              y={12}
              width={440}
              height={58}
              rx={10}
              fill="rgba(13,21,36,.92)"
              stroke="#F97316"
              strokeWidth={1.4}
            />
            <text
              x={W / 2}
              y={34}
              fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={13}
              fontWeight={700}
              letterSpacing="0.08em"
              textAnchor="middle"
            >
              {labels.peek_strategy}
            </text>
            <text
              x={W / 2}
              y={56}
              fill="#B9C4D6"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={12}
              letterSpacing="0.06em"
              textAnchor="middle"
            >
              live f' = {fFmt} cm
              {currentTarget && `  ·  target C* = ${vergenceFromCm(currentTarget.fCm).toFixed(2)} δ`}
            </text>
          </g>
        )}
      </svg>

      {/* HUD overlays — HTML in rem */}
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
      {hudTLSub && (
        <div
          style={{
            position: 'absolute',
            top: '7.6rem',
            left: '3rem',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '1.9rem',
            letterSpacing: '0.08em',
            color: '#37C9B8',
            zIndex: 5,
            pointerEvents: 'none',
          }}
        >
          {hudTLSub}
        </div>
      )}
      <div
        style={{
          position: 'absolute',
          top: '3rem',
          right: '3rem',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '2.3rem',
          letterSpacing: '0.08em',
          color: '#37C9B8',
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
          maxWidth: '50%',
        }}
      >
        {hudBL}
      </div>
      {/* BR reserved for parent-side chrome — nothing here. */}

      {/* Stage-2 exhausted message (bottom-center, below fire button) */}
      {stage2Exhausted && (
        <div
          style={{
            position: 'absolute',
            bottom: '11rem',
            left: '50%',
            transform: 'translateX(-50%)',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '1.9rem',
            letterSpacing: '0.1em',
            color: '#F9A968',
            zIndex: 5,
            pointerEvents: 'none',
            textAlign: 'center',
          }}
        >
          {labels.exhausted}
        </div>
      )}

      {/* Fire / Set button — stages 2 & 3 only */}
      {!isStage1 && (
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
            className="bi bi-crosshair"
            style={{ marginInlineEnd: '0.8rem', fontSize: '2.8rem', verticalAlign: '-0.2rem' }}
          />
          {labels.set}
        </button>
      )}
    </div>
  )
}
