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

// Pivot Δ (fixed axis of rotation). Bar rests here.
const PIVOT = { x: 400, y: 210 }
const BAR_HALF = 300      // svg units — bar spans (100, 210) → (700, 210)
const SCALE = 10          // svg units per centimetre
const HANG_LEN = 46       // svg units from bar to weight centre
const D2_MIN_CM = -28
const D2_MAX_CM = 28

// Tolerance on the balance equation (cm on d₂). Chosen so a natural drag
// snap resolution is enough, but eyeballing is not.
const D2_TOL_CM = 0.6

// Live-tilt gain — degrees per N·cm of net moment.
const TILT_GAIN_DEG_PER_NCM = 0.25
const MAX_TILT_DEG = 22
const MISS_TILT_DEG = 26

// Fire feedback animation (post-submit, ms).
const FEEDBACK_MS = 950

// Physical scenario shape ────────────────────────────────────────────────
// P1, P2 in newtons; d1 in cm (fixed, on the left of pivot: positive means
// "at d1 cm to the left"). Student solves for d2 (signed cm; positive = right
// of pivot). Balance: P1·d1 = P2·d2.
type Scenario = { id: string; P1: number; d1: number; P2: number }

const STAGE1_SCENARIO: Scenario = { id: 'obs', P1: 5, d1: 12, P2: 6 } // d₂_target = 10
const STAGE1_START_D2 = 20

// Stage 2 — fixed 3 scenarios, budget 5 (K+2 slack).
const STAGE2_SCENARIOS: Scenario[] = [
  { id: 'exp-a', P1: 4, d1: 15, P2: 6 },  // 10
  { id: 'exp-b', P1: 8, d1: 10, P2: 4 },  // 20
  { id: 'exp-c', P1: 5, d1: 12, P2: 10 }, // 6
]
const STAGE2_SHOT_BUDGET = 5

// Stage 3 — 3 setups, seed-picked. Each has 3 sequential scenarios (one shot
// per scenario). Hand-authored so every d₂_target lies in [5, 22] cm.
const STAGE3_SETUPS: { scenarios: Scenario[] }[] = [
  {
    scenarios: [
      { id: 's0a', P1: 6, d1: 10, P2: 4 },   // 15
      { id: 's0b', P1: 3, d1: 20, P2: 10 },  // 6
      { id: 's0c', P1: 8, d1: 15, P2: 6 },   // 20
    ],
  },
  {
    scenarios: [
      { id: 's1a', P1: 5, d1: 12, P2: 10 },  // 6
      { id: 's1b', P1: 4, d1: 18, P2: 8 },   // 9
      { id: 's1c', P1: 10, d1: 6, P2: 3 },   // 20
    ],
  },
  {
    scenarios: [
      { id: 's2a', P1: 7, d1: 12, P2: 4 },   // 21
      { id: 's2b', P1: 6, d1: 15, P2: 9 },   // 10
      { id: 's2c', P1: 4, d1: 21, P2: 12 },  // 7
    ],
  },
]

const dict = { en } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── Pure physics helpers ───────────────────────────────────────────────
function d2TargetOf(s: Scenario) {
  return (s.P1 * s.d1) / s.P2
}
function netMomentNCm(s: Scenario, d2: number) {
  // M1 (counter-clockwise, P1 on the left): + P1·d1
  // M2 (clockwise, P2 on the right when d2 > 0): − P2·d2
  return s.P1 * s.d1 - s.P2 * d2
}
function isBalanced(s: Scenario, d2: number) {
  return Math.abs(d2 - d2TargetOf(s)) < D2_TOL_CM
}
function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v
}

// Radius of a hanging weight scales gently with its force so the visual is
// intuitive (heavier = bigger disc) without dominating the layout.
function weightRadius(P: number) {
  return 11 + Math.min(6, P * 0.6)
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

  const [stage3Cycle, setStage3Cycle] = useState(0)
  const stage3Setup = useMemo(
    () => STAGE3_SETUPS[(seed + stage3Cycle) % STAGE3_SETUPS.length]!,
    [seed, stage3Cycle],
  )

  const currentScenarios: Scenario[] = isStage1
    ? [STAGE1_SCENARIO]
    : isStage2
      ? STAGE2_SCENARIOS
      : stage3Setup.scenarios

  const [d2, setD2] = useState(STAGE1_START_D2)
  const [dragging, setDragging] = useState(false)
  const [movedMin, setMovedMin] = useState(STAGE1_START_D2)
  const [movedMax, setMovedMax] = useState(STAGE1_START_D2)
  const [sawBalance, setSawBalance] = useState(false)
  const [lit, setLit] = useState<string[]>([])
  const [shots, setShots] = useState(0)
  const [targetIdx, setTargetIdx] = useState(0)
  const [feedback, setFeedback] = useState<
    | { kind: 'hit'; at: number; d2: number; scenarioId: string }
    | { kind: 'miss'; at: number; d2: number; scenarioId: string; missDir: 1 | -1 }
    | null
  >(null)
  const [tick, setTick] = useState(0)
  const [peekVisible, setPeekVisible] = useState(false)

  const svgRef = useRef<SVGSVGElement>(null)
  const rafRef = useRef<number>(0)

  // ─── Reset ────────────────────────────────────────────────────────────
  const resetStageState = useCallback(() => {
    setD2(STAGE1_START_D2)
    setMovedMin(STAGE1_START_D2)
    setMovedMax(STAGE1_START_D2)
    setSawBalance(false)
    setLit([])
    setShots(0)
    setTargetIdx(0)
    setFeedback(null)
    setPeekVisible(false)
  }, [])
  useReset(resetStageState)

  // ─── Current scenario (per stage) ─────────────────────────────────────
  const currentScenario: Scenario =
    isStage1
      ? currentScenarios[0]!
      : currentScenarios[Math.min(targetIdx, currentScenarios.length - 1)]!

  // ─── Fire (Confirm) ───────────────────────────────────────────────────
  const canFire = isStage2
    ? shots < STAGE2_SHOT_BUDGET && lit.length < currentScenarios.length && !feedback
    : isStage3
      ? targetIdx < currentScenarios.length && !feedback
      : false

  const fire = useCallback(() => {
    if (!canFire) return
    const scenario = currentScenario
    const hit = isBalanced(scenario, d2)
    const net = netMomentNCm(scenario, d2)
    const now = Date.now()

    if (isStage2) {
      setShots((s) => s + 1)
      if (hit) {
        setLit((prev) =>
          prev.includes(scenario.id) ? prev : [...prev, scenario.id],
        )
        setFeedback({ kind: 'hit', at: now, d2, scenarioId: scenario.id })
        // Advance to the next un-solved scenario after the feedback resolves.
      } else {
        setFeedback({
          kind: 'miss',
          at: now,
          d2,
          scenarioId: scenario.id,
          missDir: net > 0 ? 1 : -1,
        })
      }
    } else if (isStage3) {
      if (hit) {
        setLit((prev) => [...prev, scenario.id])
        setFeedback({ kind: 'hit', at: now, d2, scenarioId: scenario.id })
      } else {
        setFeedback({
          kind: 'miss',
          at: now,
          d2,
          scenarioId: scenario.id,
          missDir: net > 0 ? 1 : -1,
        })
      }
      // one-shot-per-scenario — advance unconditionally
      setTargetIdx((i) => i + 1)
    }
    setTick(now)
  }, [canFire, currentScenario, d2, isStage2, isStage3])

  // ─── After stage-2 feedback: advance target index to next unsolved ────
  useEffect(() => {
    if (!feedback) return
    if (Date.now() - feedback.at >= FEEDBACK_MS) return
    const t = setTimeout(() => {
      if (isStage2 && feedback.kind === 'hit') {
        // Move to next unsolved scenario
        setTargetIdx((prev) => {
          for (let i = 0; i < currentScenarios.length; i++) {
            const nextIdx = (prev + 1 + i) % currentScenarios.length
            const s = currentScenarios[nextIdx]!
            if (!lit.includes(s.id) && s.id !== feedback.scenarioId) return nextIdx
          }
          return prev
        })
      }
      setFeedback(null)
    }, FEEDBACK_MS)
    return () => clearTimeout(t)
  }, [feedback, isStage2, currentScenarios, lit])

  // ─── Stage 3 failure: reset with next setup after animation ───────────
  useEffect(() => {
    if (!isStage3) return
    const allShotsFired = targetIdx >= currentScenarios.length
    const allLit = lit.length === currentScenarios.length
    if (allShotsFired && !allLit) {
      const t = setTimeout(() => {
        setStage3Cycle((c) => c + 1)
        setD2(STAGE1_START_D2)
        setLit([])
        setTargetIdx(0)
        setFeedback(null)
        setMovedMin(STAGE1_START_D2)
        setMovedMax(STAGE1_START_D2)
      }, FEEDBACK_MS + 400)
      return () => clearTimeout(t)
    }
  }, [isStage3, targetIdx, lit.length, currentScenarios.length])

  // ─── Feedback animation ticker ────────────────────────────────────────
  useEffect(() => {
    if (!feedback) return
    const step = () => {
      const now = Date.now()
      if (now - feedback.at >= FEEDBACK_MS) return
      setTick(now)
      rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(rafRef.current)
  }, [feedback])

  // ─── Advance predicate ────────────────────────────────────────────────
  const stage1Explored =
    movedMax - movedMin >= 8 && sawBalance
  const canSubmit = isStage1
    ? stage1Explored
    : isStage2
      ? lit.length === currentScenarios.length
      : targetIdx >= currentScenarios.length &&
        lit.length === currentScenarios.length

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

  // ─── Peek (stage 3) ───────────────────────────────────────────────────
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

  // Space bar confirms (stages 2 & 3)
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

  // ─── Pointer / drag ───────────────────────────────────────────────────
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
    if (feedback) return // don't move mid-feedback
    const dx = (p.x - PIVOT.x) / SCALE
    const next = clamp(dx, D2_MIN_CM, D2_MAX_CM)
    setD2(next)
    if (isStage1) {
      if (next < movedMin) setMovedMin(next)
      if (next > movedMax) setMovedMax(next)
      if (
        !sawBalance &&
        Math.abs(next - d2TargetOf(STAGE1_SCENARIO)) < 1.2
      ) {
        setSawBalance(true)
      }
    }
  }

  // ─── Geometry / tilt ──────────────────────────────────────────────────
  // Live tilt for stages 1 & 2 (pre-fire): proportional to net moment.
  // Positive net moment (left-heavy) tilts the bar so the LEFT goes down
  // — i.e. rotation angle in SVG (y-down, CCW positive) is NEGATIVE.
  const netNow = netMomentNCm(currentScenario, d2)
  const liveTiltDeg =
    isStage3
      ? 0
      : clamp(
          -netNow * TILT_GAIN_DEG_PER_NCM,
          -MAX_TILT_DEG,
          MAX_TILT_DEG,
        )

  // Feedback tilt: on hit → ease to 0. On miss → swing hard toward miss side.
  let feedbackTilt: number | null = null
  let feedbackAlpha = 0
  if (feedback) {
    const elapsed = Math.max(0, tick - feedback.at)
    feedbackAlpha = clamp(elapsed / FEEDBACK_MS, 0, 1)
    if (feedback.kind === 'hit') {
      // Ease current live tilt toward zero
      feedbackTilt = liveTiltDeg * (1 - feedbackAlpha)
    } else {
      // Ease from live tilt (or 0 in stage 3) toward MISS_TILT
      const start = isStage3 ? 0 : liveTiltDeg
      const target = -feedback.missDir * MISS_TILT_DEG
      feedbackTilt = start + (target - start) * feedbackAlpha
    }
  }

  const barTiltDeg = feedbackTilt !== null ? feedbackTilt : liveTiltDeg

  // ─── Bar-frame positions (before rotation) ───────────────────────────
  const P1_svgX = PIVOT.x - currentScenario.d1 * SCALE
  const P2_svgX = PIVOT.x + d2 * SCALE
  const barY = PIVOT.y

  // Distance ticks along the bar (in bar frame, before rotation)
  const tickCms = [-25, -20, -15, -10, -5, 5, 10, 15, 20, 25]

  // ─── HUD content ──────────────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`

  const d2Formatted = `${d2 >= 0 ? '' : '−'}${Math.abs(d2).toFixed(1)}`
  const hudTR = `d₂ = ${d2Formatted} ${labels.distUnit}`
  const hudBL = isStage1 ? labels.tip1 : isStage2 ? labels.tip2 : labels.tip3

  const showMomentsPanel = isStage1 || isStage2
  const showFireButton = !isStage1

  const M1 = currentScenario.P1 * currentScenario.d1
  const M2 = -currentScenario.P2 * d2
  const sumM = M1 + M2
  const balancedNow = Math.abs(sumM) < currentScenario.P2 * D2_TOL_CM

  // Feedback flash colour for the bar
  const barFlashColor =
    feedback && feedbackAlpha < 1
      ? feedback.kind === 'hit'
        ? '#37C9B8'
        : '#F97316'
      : '#EAF0FA'

  // Secondary status line (progress in TL)
  const stage2StatusLine =
    isStage2
      ? `${labels.shots} ${shots}/${STAGE2_SHOT_BUDGET} · ${labels.lit} ${lit.length}/${currentScenarios.length}`
      : null
  const stage3StatusLine =
    isStage3
      ? `${labels.target} ${Math.min(targetIdx + 1, currentScenarios.length)}/${currentScenarios.length} · ${labels.lit} ${lit.length}/${currentScenarios.length}`
      : null
  const showExhaustedWarn =
    isStage2 &&
    shots >= STAGE2_SHOT_BUDGET &&
    lit.length < currentScenarios.length &&
    !feedback

  // ─── Render ───────────────────────────────────────────────────────────
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
          if (!dragging) return
          const p = svgPoint(e)
          if (p) applyDrag(p)
        }}
        onPointerUp={() => setDragging(false)}
        onPointerLeave={() => setDragging(false)}
      >
        {/* Background — NO rx, matches platform convention */}
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        {/* Soft floor line beneath the pivot */}
        <line
          x1={0}
          y1={PIVOT.y + 96}
          x2={W}
          y2={PIVOT.y + 96}
          stroke="#12203a"
          strokeWidth={1}
        />

        {/* Pivot support triangle (stationary — does NOT rotate) */}
        <g>
          <polygon
            points={`${PIVOT.x},${PIVOT.y + 4} ${PIVOT.x - 34},${PIVOT.y + 90} ${PIVOT.x + 34},${PIVOT.y + 90}`}
            fill="rgba(58,72,99,0.85)"
            stroke="#3A4863"
            strokeWidth={1.5}
          />
          <line
            x1={PIVOT.x - 46}
            y1={PIVOT.y + 90}
            x2={PIVOT.x + 46}
            y2={PIVOT.y + 90}
            stroke="#3A4863"
            strokeWidth={2.5}
          />
          {/* Pivot marker (Δ) */}
          <circle cx={PIVOT.x} cy={PIVOT.y} r={5} fill="#EAF0FA" />
          <text
            x={PIVOT.x - 12}
            y={PIVOT.y + 68}
            fill="#6C7A93"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={14}
            fontWeight={700}
          >
            Δ
          </text>
        </g>

        {/* Lever group — rotates by barTiltDeg around the pivot */}
        <g transform={`rotate(${barTiltDeg} ${PIVOT.x} ${PIVOT.y})`}>
          {/* Bar */}
          <line
            x1={PIVOT.x - BAR_HALF}
            y1={barY}
            x2={PIVOT.x + BAR_HALF}
            y2={barY}
            stroke="rgba(234,240,250,0.10)"
            strokeWidth={16}
            strokeLinecap="round"
          />
          <line
            x1={PIVOT.x - BAR_HALF}
            y1={barY}
            x2={PIVOT.x + BAR_HALF}
            y2={barY}
            stroke={barFlashColor}
            strokeWidth={4}
            strokeLinecap="round"
          />

          {/* Distance ticks */}
          {tickCms.map((cm) => {
            const tx = PIVOT.x + cm * SCALE
            const isLabelled = cm % 10 === 0
            return (
              <g key={`tick${cm}`}>
                <line
                  x1={tx}
                  y1={barY - 6}
                  x2={tx}
                  y2={barY + 6}
                  stroke="#6C7A93"
                  strokeWidth={isLabelled ? 1.4 : 0.9}
                  opacity={isLabelled ? 0.9 : 0.55}
                />
                {isLabelled && (
                  <text
                    x={tx}
                    y={barY - 12}
                    fill="#6C7A93"
                    fontFamily="'JetBrains Mono', monospace"
                    fontSize={10}
                    textAnchor="middle"
                  >
                    {Math.abs(cm)}
                  </text>
                )}
              </g>
            )
          })}

          {/* P1 weight (fixed) — rope + disc + labels */}
          <g>
            <line
              x1={P1_svgX}
              y1={barY}
              x2={P1_svgX}
              y2={barY + HANG_LEN}
              stroke="#6C7A93"
              strokeWidth={1.5}
            />
            <circle
              cx={P1_svgX}
              cy={barY + HANG_LEN}
              r={weightRadius(currentScenario.P1) + 4}
              fill="#37C9B8"
              opacity={0.18}
            />
            <circle
              cx={P1_svgX}
              cy={barY + HANG_LEN}
              r={weightRadius(currentScenario.P1)}
              fill="#37C9B8"
              stroke="#5FE0D2"
              strokeWidth={1.5}
            />
            <text
              x={P1_svgX}
              y={barY + HANG_LEN + 4}
              fill="#0D1524"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={11}
              fontWeight={700}
              textAnchor="middle"
            >
              P₁
            </text>
            {/* Force + arm labels (required-info — visible all stages) */}
            <text
              x={P1_svgX}
              y={barY + HANG_LEN + weightRadius(currentScenario.P1) + 16}
              fill="#5FE0D2"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={11}
              textAnchor="middle"
            >
              {currentScenario.P1} N
            </text>
            <text
              x={P1_svgX}
              y={barY + HANG_LEN + weightRadius(currentScenario.P1) + 30}
              fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
              textAnchor="middle"
            >
              d₁ = {currentScenario.d1} cm
            </text>
          </g>

          {/* P2 weight (draggable) */}
          <g
            onPointerDown={(e) => {
              e.preventDefault()
              e.stopPropagation()
              if (feedback) return
              setDragging(true)
              const p = svgPoint(e)
              if (p) applyDrag(p)
            }}
            style={{ cursor: feedback ? 'default' : 'grab' }}
          >
            <line
              x1={P2_svgX}
              y1={barY}
              x2={P2_svgX}
              y2={barY + HANG_LEN}
              stroke="#F9A968"
              strokeWidth={1.5}
            />
            <circle
              cx={P2_svgX}
              cy={barY + HANG_LEN}
              r={weightRadius(currentScenario.P2) + 6}
              fill="#F97316"
              opacity={0.22}
            />
            <circle
              cx={P2_svgX}
              cy={barY + HANG_LEN}
              r={weightRadius(currentScenario.P2)}
              fill="#F97316"
              stroke="#FBBF7A"
              strokeWidth={1.8}
            />
            <text
              x={P2_svgX}
              y={barY + HANG_LEN + 4}
              fill="#0D1524"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={11}
              fontWeight={700}
              textAnchor="middle"
            >
              P₂
            </text>
            <text
              x={P2_svgX}
              y={barY + HANG_LEN + weightRadius(currentScenario.P2) + 16}
              fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={11}
              textAnchor="middle"
            >
              {currentScenario.P2} N
            </text>
          </g>
        </g>

        {/* Moments panel — stages 1 & 2 only (help) */}
        {showMomentsPanel && (
          <g>
            <rect
              x={W / 2 - 210}
              y={16}
              width={420}
              height={64}
              rx={8}
              fill="rgba(13,21,36,0.75)"
              stroke={balancedNow ? '#37C9B8' : '#3A4863'}
              strokeWidth={1.5}
            />
            {/* M1 */}
            <text
              x={W / 2 - 195}
              y={38}
              fill="#6C7A93"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
              letterSpacing="0.14em"
            >
              {labels.momentM1}
            </text>
            <text
              x={W / 2 - 195}
              y={62}
              fill="#37C9B8"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={15}
              fontWeight={700}
            >
              +{M1.toFixed(0)}
            </text>
            <text
              x={W / 2 - 195 + 46}
              y={62}
              fill="#6C7A93"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
            >
              {labels.momentUnit}
            </text>
            {/* M2 */}
            <text
              x={W / 2 - 60}
              y={38}
              fill="#6C7A93"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
              letterSpacing="0.14em"
            >
              {labels.momentM2}
            </text>
            <text
              x={W / 2 - 60}
              y={62}
              fill={M2 <= 0 ? '#F97316' : '#37C9B8'}
              fontFamily="'JetBrains Mono', monospace"
              fontSize={15}
              fontWeight={700}
            >
              {M2 >= 0 ? '+' : '−'}
              {Math.abs(M2).toFixed(0)}
            </text>
            <text
              x={W / 2 - 60 + 54}
              y={62}
              fill="#6C7A93"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
            >
              {labels.momentUnit}
            </text>
            {/* ΣM */}
            <text
              x={W / 2 + 80}
              y={38}
              fill="#6C7A93"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
              letterSpacing="0.14em"
            >
              {labels.momentSum}
            </text>
            <text
              x={W / 2 + 80}
              y={62}
              fill={balancedNow ? '#37C9B8' : '#F9A968'}
              fontFamily="'JetBrains Mono', monospace"
              fontSize={15}
              fontWeight={700}
            >
              {sumM >= 0 ? '+' : '−'}
              {Math.abs(sumM).toFixed(0)}
            </text>
            <text
              x={W / 2 + 80 + 54}
              y={62}
              fill="#6C7A93"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
            >
              {labels.momentUnit}
            </text>
            <text
              x={W / 2 + 170}
              y={54}
              fill={balancedNow ? '#37C9B8' : '#6C7A93'}
              fontFamily="'JetBrains Mono', monospace"
              fontSize={11}
              fontWeight={700}
              letterSpacing="0.12em"
              textAnchor="end"
            >
              {balancedNow ? labels.balanced : labels.notBalanced}
            </text>
          </g>
        )}

        {/* Peek badge (stage 3) — strategy hint + current d₂ */}
        {isStage3 && peekVisible && (
          <g>
            <rect
              x={W / 2 - 170}
              y={16}
              width={340}
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
              fontSize={12}
              fontWeight={700}
              letterSpacing="0.1em"
              textAnchor="middle"
            >
              {labels.peekStrategy}
            </text>
            <text
              x={W / 2}
              y={58}
              fill="#EAF0FA"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={12}
              letterSpacing="0.08em"
              textAnchor="middle"
            >
              {labels.peekNow}: {d2Formatted} {labels.distUnit}
            </text>
          </g>
        )}
      </svg>

      {/* HUD overlays (HTML, per corner) */}
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
      {(stage2StatusLine || stage3StatusLine) && (
        <div
          style={{
            position: 'absolute',
            top: '8rem',
            left: '3rem',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '2rem',
            letterSpacing: '0.08em',
            color: '#37C9B8',
            zIndex: 5,
            pointerEvents: 'none',
          }}
        >
          {stage2StatusLine ?? stage3StatusLine}
          {showExhaustedWarn && (
            <div style={{ color: '#F9A968', marginTop: '0.6rem' }}>
              {labels.exhausted}
            </div>
          )}
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
        }}
      >
        {hudBL}
      </div>
      {/* Bottom-right corner is RESERVED for parent chrome — no overlay here. */}

      {/* Confirm button */}
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
            className="bi bi-check-circle-fill"
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
