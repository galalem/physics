import { useCallback, useEffect, useMemo, useState } from 'react'
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

// Bench geometry (SVG units) — schematic, not strictly to scale.
const AXIS_Y = 235
const OBJ_X = 195           // objective lens x (fixed anchor)
const F1_MARK_PX = 28       // fixed schematic offset for F1 / F'1 markers
const F2_MARK_PX = 34       // fixed schematic offset for F2 / F'2 markers
const DELTA_PX_MIN = 90     // Δ = 100 mm displayed as 90 px
const DELTA_PX_MAX = 210    // Δ = 200 mm displayed as 210 px
const AB_H_PX = 14          // object arrow height in svg px

// Physics parameters
const F1_MIN = 4              // mm — objective focal length
const F1_MAX = 16
const F1_DEFAULT = 8
const F2_MIN = 15             // mm — ocular focal length
const F2_MAX = 40
const F2_DEFAULT = 25
const DELTA_MIN = 100         // mm — tube length (optical interval)
const DELTA_MAX = 200
const DELTA_DEFAULT = 160

const DM_MM = 250             // distinct-vision distance (constant)

// Stage 2 targets: (|γ₁|*, G_oc*).
const STAGE2_TARGETS: { g1: number; goc: number }[] = [
  { g1: 25, goc: 12.5 },   // e.g. Δ=200, f1=8 → |γ₁|=25 ; f2=20 → G_oc=12.5
  { g1: 20, goc: 10 },     // e.g. Δ=160, f1=8 → 20 ; f2=25 → 10
  { g1: 16, goc: 8.33 },   // e.g. Δ=160, f1=10 → 16 ; f2=30 → 8.33
  { g1: 12, goc: 12.5 },
  { g1: 30, goc: 10 },
]
const STAGE2_G1_TOL = 0.06     // ±6 %
const STAGE2_GOC_TOL = 0.05    // ±5 %

// Stage 3 targets: G* (unsigned total magnifying power).
const STAGE3_SETUPS: { targets: number[] }[] = [
  { targets: [200, 300, 400] },
  { targets: [250, 350, 500] },
  { targets: [150, 250, 320] },
  { targets: [180, 280, 380] },
]
const STAGE3_TOL = 0.05        // ±5 %

// Stage 1 advance criterion — each slider must sweep ≥ half its range.
const COVERAGE_MIN_FRAC = 0.5

// ─── Physics helpers ────────────────────────────────────────────────────
function gamma1(f1: number, delta: number): number {
  // Signed: real object with converging lens → inverted enlarged image.
  return -delta / f1
}
function gocPower(f2: number): number {
  return DM_MM / f2
}
function totalG(f1: number, f2: number, delta: number): number {
  return (delta * DM_MM) / (f1 * f2)
}
function deltaToPx(delta: number): number {
  return (
    DELTA_PX_MIN +
    ((delta - DELTA_MIN) / (DELTA_MAX - DELTA_MIN)) *
      (DELTA_PX_MAX - DELTA_PX_MIN)
  )
}
function formatG(g: number): string {
  const abs = Math.abs(g)
  if (abs >= 100) return g.toFixed(0)
  if (abs >= 10) return g.toFixed(1)
  return g.toFixed(2)
}

// ─── Label loader ───────────────────────────────────────────────────────
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

  const stage2Target = useMemo(
    () => STAGE2_TARGETS[seed % STAGE2_TARGETS.length]!,
    [seed],
  )
  // Stage-3 setup cycles on fail-out. Seed picks initial, subsequent bad
  // passes step through the setup list.
  const [stage3SetupIdx, setStage3SetupIdx] = useState(0)
  const stage3Setup = useMemo(
    () =>
      STAGE3_SETUPS[(seed + stage3SetupIdx) % STAGE3_SETUPS.length]!,
    [seed, stage3SetupIdx],
  )

  const stageIdx = useCurrentStage()
  const setStage = useSetStage()
  const complete = useComplete()
  const progress = useProgress()

  // ─── State ────────────────────────────────────────────────────────
  const [f1, setF1] = useState(F1_DEFAULT)
  const [f2, setF2] = useState(F2_DEFAULT)
  const [delta, setDelta] = useState(DELTA_DEFAULT)
  const [peekVisible, setPeekVisible] = useState(false)

  // Stage 1 coverage — each slider's min/max sweep across the session.
  const [f1Min, setF1Min] = useState(F1_DEFAULT)
  const [f1Max, setF1Max] = useState(F1_DEFAULT)
  const [f2Min, setF2Min] = useState(F2_DEFAULT)
  const [f2Max, setF2Max] = useState(F2_DEFAULT)
  const [deltaMin, setDeltaMin] = useState(DELTA_DEFAULT)
  const [deltaMax, setDeltaMax] = useState(DELTA_DEFAULT)

  // Stage 3 one-shot-per-target.
  const [s3TargetIdx, setS3TargetIdx] = useState(0)
  const [s3Lit, setS3Lit] = useState<number[]>([])

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  const resetStageState = useCallback(() => {
    setF1(F1_DEFAULT)
    setF2(F2_DEFAULT)
    setDelta(DELTA_DEFAULT)
    setF1Min(F1_DEFAULT); setF1Max(F1_DEFAULT)
    setF2Min(F2_DEFAULT); setF2Max(F2_DEFAULT)
    setDeltaMin(DELTA_DEFAULT); setDeltaMax(DELTA_DEFAULT)
    setPeekVisible(false)
    setS3TargetIdx(0)
    setS3Lit([])
  }, [])
  useReset(resetStageState)

  // ─── Derived quantities ───────────────────────────────────────────
  const g1 = gamma1(f1, delta)              // signed
  const g1Abs = Math.abs(g1)
  const goc = gocPower(f2)
  const G = totalG(f1, f2, delta)           // unsigned magnifying power

  // Stage 1 coverage
  const f1Cov = (f1Max - f1Min) / (F1_MAX - F1_MIN)
  const f2Cov = (f2Max - f2Min) / (F2_MAX - F2_MIN)
  const deltaCov = (deltaMax - deltaMin) / (DELTA_MAX - DELTA_MIN)
  const stage1Done =
    f1Cov >= COVERAGE_MIN_FRAC &&
    f2Cov >= COVERAGE_MIN_FRAC &&
    deltaCov >= COVERAGE_MIN_FRAC

  // Stage 2 match
  const g1Err = Math.abs(g1Abs - stage2Target.g1) / stage2Target.g1
  const gocErr = Math.abs(goc - stage2Target.goc) / stage2Target.goc
  const g1Ok = g1Err < STAGE2_G1_TOL
  const gocOk = gocErr < STAGE2_GOC_TOL
  const stage2Match = g1Ok && gocOk

  // Stage 3 status
  const activeS3Target = stage3Setup.targets[s3TargetIdx] ?? null
  const s3AllShotsSpent = s3TargetIdx >= stage3Setup.targets.length
  const s3AllLit = s3Lit.length === stage3Setup.targets.length
  const canSubmit = isStage1
    ? stage1Done
    : isStage2
      ? stage2Match
      : s3AllLit

  // ─── SDK wiring ───────────────────────────────────────────────────
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

  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  // Peek — §4.7 rule 4: current DOF value only, no beam / no answer.
  usePeek(() => {
    if (!isStage3) return
    setPeekVisible(true)
  })
  useEffect(() => {
    if (!peekVisible) return
    const t = setTimeout(() => setPeekVisible(false), 1800)
    return () => clearTimeout(t)
  }, [peekVisible])

  // ─── Stage 3 confirm — one shot per target ────────────────────────
  const canConfirm = isStage3 && !s3AllShotsSpent
  const confirm = useCallback(() => {
    if (!canConfirm || activeS3Target == null) return
    const err = Math.abs(G - activeS3Target) / activeS3Target
    if (err < STAGE3_TOL) {
      setS3Lit((prev) => [...prev, activeS3Target])
    }
    // Always advance — miss counts as a spent shot (§5.2).
    setS3TargetIdx((i) => i + 1)
  }, [canConfirm, G, activeS3Target])

  // Fail-out: all shots spent, not all lit → cycle setup + reset.
  useEffect(() => {
    if (!isStage3) return
    if (s3AllShotsSpent && !s3AllLit) {
      const t = setTimeout(() => {
        setStage3SetupIdx((i) => i + 1)
        // Local resets — do NOT touch setStage3SetupIdx inside resetStageState.
        setF1(F1_DEFAULT); setF2(F2_DEFAULT); setDelta(DELTA_DEFAULT)
        setS3TargetIdx(0)
        setS3Lit([])
        setPeekVisible(false)
      }, 1500)
      return () => clearTimeout(t)
    }
  }, [isStage3, s3AllShotsSpent, s3AllLit])

  // Spacebar confirms on stage 3.
  useEffect(() => {
    if (!isStage3) return
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space') { e.preventDefault(); confirm() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isStage3, confirm])

  // ─── Bench geometry (derived) ─────────────────────────────────────
  const deltaPx = deltaToPx(delta)
  const F1_X = OBJ_X - F1_MARK_PX
  const F1_PRIME_X = OBJ_X + F1_MARK_PX
  const A1B1_X = F1_PRIME_X + deltaPx      // A1B1 sits at F2 (by construction)
  const F2_X = A1B1_X
  const OC_X = F2_X + F2_MARK_PX
  const F2_PRIME_X = OC_X + F2_MARK_PX

  // Object AB — fixed schematic offset from objective for visibility.
  const OBJ_ARROW_X = OBJ_X - 65

  // Intermediate image height ∝ |γ₁|; clamp for display.
  const A1B1_H_RAW = AB_H_PX * g1Abs
  const A1B1_H = Math.min(90, A1B1_H_RAW)

  // Emerging bundle angle (clamped for display).
  // Physically slope = A1B1_H / f'₂_px; visually cap it.
  const emergSlope = Math.min(0.45, A1B1_H / (F2_MARK_PX * 2.2))

  // Stage visibility gates
  const showIntermediate = isStage1 || isStage2   // A1B1 + construction rays
  const showEmergingBundle = isStage1 || isStage2 // emergent rays = help
  const showFocalLabels = true                    // F1, F'1, F2, F'2 always shown

  // ─── HUD text ─────────────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`
  const hudTR = isStage1
    ? `G = ${formatG(G)} × · |γ1| = ${formatG(g1Abs)} · Goc = ${formatG(goc)}`
    : isStage2
      ? stage2Match
        ? `✓ ${labels.match_ok} · G = ${formatG(G)} ×`
        : `|γ1| = ${formatG(g1Abs)} · Goc = ${formatG(goc)}`
      : peekVisible
        ? `${labels.peek_reveal} G = ${formatG(G)} ×`
        : `G = ?`
  const hudBL = isStage1
    ? labels.tip1
    : isStage2
      ? labels.tip2
      : labels.tip3
  // Secondary TL line (stage 2 target readout, stage 3 target progress).
  const hudTLSecondary = isStage1
    ? `f1·${(f1Cov * 100).toFixed(0)}% f2·${(f2Cov * 100).toFixed(0)}% Δ·${(deltaCov * 100).toFixed(0)}%`
    : isStage2
      ? `${labels.target_short}: |γ1|*=${stage2Target.g1} Goc*=${stage2Target.goc}`
      : s3AllShotsSpent && !s3AllLit
        ? labels.exhausted
        : activeS3Target != null
          ? `${labels.target} ${s3TargetIdx + 1}/${stage3Setup.targets.length}: G* = ${activeS3Target}× · ${labels.hits} ${s3Lit.length}/${stage3Setup.targets.length}`
          : `${labels.hits} ${s3Lit.length}/${stage3Setup.targets.length}`

  // ─── Render ───────────────────────────────────────────────────────
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
          userSelect: 'none',
        }}
      >
        {/* Background — no rx */}
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        {/* Bench frame */}
        <rect
          x={32}
          y={70}
          width={480}
          height={340}
          fill="none"
          stroke="#12203a"
          strokeWidth={1}
          rx={6}
        />
        <text
          x={40}
          y={62}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={11}
          letterSpacing="0.1em"
        >
          {labels.bench}
        </text>

        {/* Optical axis */}
        <line
          x1={50}
          y1={AXIS_Y}
          x2={500}
          y2={AXIS_Y}
          stroke="#2A3654"
          strokeWidth={1}
          strokeDasharray="2 4"
        />

        {/* Object AB (arrow up) */}
        <line
          x1={OBJ_ARROW_X}
          y1={AXIS_Y}
          x2={OBJ_ARROW_X}
          y2={AXIS_Y - AB_H_PX}
          stroke="#F97316"
          strokeWidth={2.2}
        />
        <polygon
          points={`${OBJ_ARROW_X - 3},${AXIS_Y - AB_H_PX + 3} ${OBJ_ARROW_X + 3},${AXIS_Y - AB_H_PX + 3} ${OBJ_ARROW_X},${AXIS_Y - AB_H_PX - 3}`}
          fill="#F97316"
        />
        <text
          x={OBJ_ARROW_X}
          y={AXIS_Y + 14}
          fill="#F9A968"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={10}
          textAnchor="middle"
        >
          {labels.object}
        </text>

        {/* Objective lens: vertical line with converging arrowheads */}
        <line
          x1={OBJ_X}
          y1={AXIS_Y - 60}
          x2={OBJ_X}
          y2={AXIS_Y + 60}
          stroke="#37C9B8"
          strokeWidth={2.2}
        />
        <polygon
          points={`${OBJ_X - 4},${AXIS_Y - 60 + 8} ${OBJ_X + 4},${AXIS_Y - 60 + 8} ${OBJ_X},${AXIS_Y - 60}`}
          fill="#37C9B8"
        />
        <polygon
          points={`${OBJ_X - 4},${AXIS_Y + 60 - 8} ${OBJ_X + 4},${AXIS_Y + 60 - 8} ${OBJ_X},${AXIS_Y + 60}`}
          fill="#37C9B8"
        />
        <text
          x={OBJ_X}
          y={AXIS_Y - 66}
          fill="#37C9B8"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={10}
          textAnchor="middle"
        >
          {labels.objective} · f'1 = {f1.toFixed(1)}mm
        </text>

        {/* Focal markers F1, F'1 on axis */}
        {showFocalLabels && (
          <>
            <circle cx={F1_X} cy={AXIS_Y} r={2.5} fill="#54617A" />
            <text
              x={F1_X}
              y={AXIS_Y + 14}
              fill="#54617A"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
              textAnchor="middle"
            >
              F1
            </text>
            <circle cx={F1_PRIME_X} cy={AXIS_Y} r={2.5} fill="#54617A" />
            <text
              x={F1_PRIME_X}
              y={AXIS_Y + 14}
              fill="#54617A"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
              textAnchor="middle"
            >
              F'1
            </text>
          </>
        )}

        {/* Construction rays through objective (two characteristic rays
            — schematic; object position is not to scale, so we use only
            the two rays that converge robustly at B1 regardless: the
            parallel-in ray and the ray through the optical center). */}
        {showIntermediate && (() => {
          const abTopX = OBJ_ARROW_X
          const abTopY = AXIS_Y - AB_H_PX
          const a1b1TopY = AXIS_Y + A1B1_H
          return (
            <g stroke="rgba(249,115,22,0.55)" strokeWidth={1.2} fill="none">
              {/* Ray A — parallel to axis, then bends at lens toward B1 */}
              <line x1={abTopX} y1={abTopY} x2={OBJ_X} y2={abTopY} />
              <line x1={OBJ_X} y1={abTopY} x2={A1B1_X} y2={a1b1TopY} />
              {/* Ray B — straight through optical center */}
              <line x1={abTopX} y1={abTopY} x2={A1B1_X} y2={a1b1TopY} />
            </g>
          )
        })()}

        {/* Intermediate image A1B1 (arrow down — inverted) */}
        {showIntermediate && (
          <>
            <line
              x1={A1B1_X}
              y1={AXIS_Y}
              x2={A1B1_X}
              y2={AXIS_Y + A1B1_H}
              stroke="#F97316"
              strokeWidth={2.2}
            />
            <polygon
              points={`${A1B1_X - 3},${AXIS_Y + A1B1_H - 3} ${A1B1_X + 3},${AXIS_Y + A1B1_H - 3} ${A1B1_X},${AXIS_Y + A1B1_H + 3}`}
              fill="#F97316"
            />
            <text
              x={A1B1_X}
              y={AXIS_Y - 6}
              fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
              textAnchor="middle"
            >
              {labels.image1}
            </text>
          </>
        )}

        {/* Focal markers F2, F'2 */}
        {showFocalLabels && (
          <>
            <circle cx={F2_X} cy={AXIS_Y} r={2.5} fill="#54617A" />
            <text
              x={F2_X - 8}
              y={AXIS_Y - 14}
              fill="#54617A"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
              textAnchor="end"
            >
              F2
            </text>
            <circle cx={F2_PRIME_X} cy={AXIS_Y} r={2.5} fill="#54617A" />
            <text
              x={F2_PRIME_X}
              y={AXIS_Y + 14}
              fill="#54617A"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
              textAnchor="middle"
            >
              F'2
            </text>
          </>
        )}

        {/* Ocular lens */}
        <line
          x1={OC_X}
          y1={AXIS_Y - 50}
          x2={OC_X}
          y2={AXIS_Y + 50}
          stroke="#37C9B8"
          strokeWidth={2.2}
        />
        <polygon
          points={`${OC_X - 4},${AXIS_Y - 50 + 7} ${OC_X + 4},${AXIS_Y - 50 + 7} ${OC_X},${AXIS_Y - 50}`}
          fill="#37C9B8"
        />
        <polygon
          points={`${OC_X - 4},${AXIS_Y + 50 - 7} ${OC_X + 4},${AXIS_Y + 50 - 7} ${OC_X},${AXIS_Y + 50}`}
          fill="#37C9B8"
        />
        <text
          x={OC_X}
          y={AXIS_Y - 56}
          fill="#37C9B8"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={10}
          textAnchor="middle"
        >
          {labels.ocular} · f'2 = {f2.toFixed(1)}mm
        </text>

        {/* Δ dimension bracket between F'1 and F2 (below axis) */}
        <line
          x1={F1_PRIME_X}
          y1={AXIS_Y + 44}
          x2={F2_X}
          y2={AXIS_Y + 44}
          stroke="#54617A"
          strokeWidth={1}
        />
        <line
          x1={F1_PRIME_X}
          y1={AXIS_Y + 40}
          x2={F1_PRIME_X}
          y2={AXIS_Y + 48}
          stroke="#54617A"
          strokeWidth={1}
        />
        <line
          x1={F2_X}
          y1={AXIS_Y + 40}
          x2={F2_X}
          y2={AXIS_Y + 48}
          stroke="#54617A"
          strokeWidth={1}
        />
        <text
          x={(F1_PRIME_X + F2_X) / 2}
          y={AXIS_Y + 58}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={10}
          textAnchor="middle"
        >
          Δ = {delta.toFixed(0)}mm
        </text>

        {/* Emerging parallel bundle from ocular (help — hidden on stage 3) */}
        {showEmergingBundle && (
          <g stroke="#F97316" strokeWidth={1.6} fill="none" opacity={0.85}>
            {/* Beam 1: from axis, parallel to axis */}
            <line x1={OC_X} y1={AXIS_Y} x2={OC_X + 90} y2={AXIS_Y} />
            {/* Beam 2: same slope up (representing angular size) */}
            <line
              x1={OC_X}
              y1={AXIS_Y}
              x2={OC_X + 90}
              y2={AXIS_Y - emergSlope * 90}
            />
            {/* Eye hint pill */}
            <text
              x={OC_X + 96}
              y={AXIS_Y - emergSlope * 90 / 2 + 3}
              fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
            >
              → eye
            </text>
          </g>
        )}

        {/* Stage 3 peek badge — strategy hint + live G */}
        {isStage3 && peekVisible && (
          <g>
            <rect
              x={W / 2 - 180}
              y={90}
              width={360}
              height={54}
              rx={12}
              fill="rgba(13,21,36,0.9)"
              stroke="#F97316"
              strokeWidth={1.5}
            />
            <text
              x={W / 2}
              y={110}
              fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={11}
              fontWeight={700}
              letterSpacing="0.06em"
              textAnchor="middle"
            >
              G = (Δ · d_m) / (f'1 · f'2)  ·  d_m = 250 mm
            </text>
            <text
              x={W / 2}
              y={130}
              fill="#37C9B8"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={13}
              fontWeight={700}
              letterSpacing="0.08em"
              textAnchor="middle"
            >
              live G = {formatG(G)} ×
            </text>
          </g>
        )}

        {/* Stage 3 target chip (on-canvas near ocular) */}
        {isStage3 && activeS3Target != null && !s3AllShotsSpent && (
          <g>
            <rect
              x={OC_X + 20}
              y={AXIS_Y + 20}
              width={130}
              height={30}
              rx={6}
              fill="rgba(249,115,22,0.14)"
              stroke="#F97316"
              strokeWidth={1.5}
            />
            <text
              x={OC_X + 85}
              y={AXIS_Y + 40}
              fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={12}
              fontWeight={700}
              textAnchor="middle"
            >
              G* = {activeS3Target}×
            </text>
          </g>
        )}

        {/* Stage 3 lit-target dots (small, above ocular) */}
        {isStage3 && (
          <g>
            {stage3Setup.targets.map((t, i) => {
              const cx = OC_X + 20 + i * 18
              const lit = s3Lit.includes(t)
              return (
                <circle
                  key={`s3dot-${i}`}
                  cx={cx}
                  cy={AXIS_Y - 68}
                  r={6}
                  fill={lit ? '#37C9B8' : 'none'}
                  stroke={lit ? '#37C9B8' : i === s3TargetIdx ? '#F97316' : '#54617A'}
                  strokeWidth={1.8}
                />
              )
            })}
          </g>
        )}
      </svg>

      {/* ─── HUD overlays (HTML in rem — never SVG text) ─────────────── */}
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
      {hudTLSecondary && (
        <div
          style={{
            position: 'absolute',
            top: '7rem',
            left: '3rem',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '2rem',
            letterSpacing: '0.08em',
            color:
              stage2Match || s3AllLit || stage1Done
                ? '#37C9B8'
                : '#B9C4D6',
            zIndex: 5,
            pointerEvents: 'none',
            maxWidth: '55%',
          }}
        >
          {hudTLSecondary}
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
          color:
            stage2Match || s3AllLit ? '#37C9B8' : peekVisible ? '#F9A968' : '#B9C4D6',
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
          maxWidth: '52%',
        }}
      >
        {hudBL}
      </div>
      {/* NO bottom-right overlay — reserved for parent chrome. */}

      {/* ─── Sliders (right column, mirrors diffraction) ─────────────── */}
      <div
        style={{
          position: 'absolute',
          top: '13rem',
          right: '3rem',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '1.5rem',
          zIndex: 6,
        }}
      >
        <SliderVertical
          label="f'1"
          unit="mm"
          value={f1}
          min={F1_MIN}
          max={F1_MAX}
          step={0.1}
          format={(v) => v.toFixed(1)}
          onChange={(v) => {
            setF1(v)
            setF1Min((prev) => Math.min(prev, v))
            setF1Max((prev) => Math.max(prev, v))
          }}
        />
        <SliderVertical
          label="f'2"
          unit="mm"
          value={f2}
          min={F2_MIN}
          max={F2_MAX}
          step={0.5}
          format={(v) => v.toFixed(1)}
          onChange={(v) => {
            setF2(v)
            setF2Min((prev) => Math.min(prev, v))
            setF2Max((prev) => Math.max(prev, v))
          }}
        />
        <SliderVertical
          label="Δ"
          unit="mm"
          value={delta}
          min={DELTA_MIN}
          max={DELTA_MAX}
          step={1}
          format={(v) => v.toFixed(0)}
          onChange={(v) => {
            setDelta(v)
            setDeltaMin((prev) => Math.min(prev, v))
            setDeltaMax((prev) => Math.max(prev, v))
          }}
        />
      </div>

      {/* Confirm button — stage 3 only */}
      {isStage3 && (
        <button
          type="button"
          onClick={confirm}
          disabled={!canConfirm}
          style={{
            position: 'absolute',
            bottom: '3rem',
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '1.6rem 3.6rem',
            background: canConfirm ? '#F97316' : 'rgba(30,42,64,0.85)',
            color: canConfirm ? '#FFFFFF' : '#6C7A93',
            border: `0.3rem solid ${canConfirm ? '#F97316' : 'rgba(58,72,99,0.6)'}`,
            borderRadius: '100rem',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '2.3rem',
            fontWeight: 700,
            letterSpacing: '0.12em',
            cursor: canConfirm ? 'pointer' : 'not-allowed',
            zIndex: 10,
          }}
        >
          <i
            className="bi bi-lightning-charge-fill"
            style={{
              marginInlineEnd: '0.8rem',
              fontSize: '2.4rem',
              verticalAlign: '-0.2rem',
            }}
          />
          {labels.confirm}
        </button>
      )}
    </div>
  )
}

// ─── Slider primitive (verbatim style from diffraction) ─────────────────
function SliderVertical({
  label, unit, value, min, max, step, format, onChange, accent = '#37C9B8',
}: {
  label: string
  unit: string
  value: number
  min: number
  max: number
  step: number
  format: (v: number) => string
  onChange: (v: number) => void
  accent?: string
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '0.4rem',
      }}
    >
      <div
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '1.5rem',
          color: '#54617A',
        }}
      >
        {format(max)}
      </div>
      <div
        style={{
          width: '2.5rem',
          height: '14rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{
            width: '14rem',
            height: '2.2rem',
            transform: 'rotate(-90deg)',
            transformOrigin: 'center',
            accentColor: accent,
            cursor: 'pointer',
          }}
        />
      </div>
      <div
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '1.5rem',
          color: '#54617A',
        }}
      >
        {format(min)}
      </div>
      <div
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '1.9rem',
          color: accent,
        }}
      >
        {label} = {format(value)}{unit}
      </div>
    </div>
  )
}
