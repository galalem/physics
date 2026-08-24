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
import {
  E1_EV,
  HV_MAX,
  HV_MIN,
  HV_STEP,
  N_MAX,
  N_START_MAX,
  N_START_MIN,
  SETUPS,
  featureMatches,
  levelEnergy,
  nearestAbsorption,
} from './physics'

// ─── Scene constants ────────────────────────────────────────
const W = 800
const H = 450

// Diagram geometry (SVG units)
const DIAG_LEFT = 90
const DIAG_RIGHT = 460
const DIAG_TOP = 70
const DIAG_BOTTOM = 400
const DIAG_HEIGHT = DIAG_BOTTOM - DIAG_TOP // 330

// Convert energy (eV, negative) to y-coordinate on the diagram.
// yE(0) = DIAG_TOP, yE(-E1) = DIAG_BOTTOM.
function yE(E: number): number {
  return DIAG_TOP + ((0 - E) * DIAG_HEIGHT) / E1_EV
}

// Coverage threshold — sliders must sweep ≥ 50% of range on stage 1
const COVERAGE_MIN_FRAC = 0.5

// Default slider positions
const N_START_DEFAULT = 1
const HV_DEFAULT = 7 // midpoint

// ─── Label loader ────────────────────────────────────────────
const dict = { en } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// Peek timing (blind stage only — text overlay in BL HUD)
const PEEK_MS = 4000

// Highlight tolerance for the "arrow tip lands on an integer level" feedback.
// Purely visual — governs when the target line glows on stages 1 & 2 (help).
// Stage 3 does NOT use this.
const VISUAL_LOCK_TOL = 0.03 // fraction of level spacing near ionization is tight

// Formatter
function fmtEv(v: number): string {
  return `${v.toFixed(2)} eV`
}

// ─── Component ──────────────────────────────────────────────
export default function Scene() {
  const { locale, seed } = useInit()
  const stages = useMemo(() => getStagesFor(locale), [locale])
  useDeclareStages(stages)
  const labels = useMemo(() => svgLabels(locale), [locale])

  // Seed-indexed hand-authored setup (deterministic, reviewable)
  const setup = useMemo(() => SETUPS[seed % SETUPS.length]!, [seed])

  const stageIdx = useCurrentStage()
  const setStage = useSetStage()
  const progress = useProgress()
  const complete = useComplete()

  // ─── DOF state ─────────────────────────────────────────────
  const [nStart, setNStart] = useState(N_START_DEFAULT)
  const [hv, setHv] = useState(HV_DEFAULT)
  const [peekVisible, setPeekVisible] = useState(false)

  // Stage 1 coverage tracking
  const [nMin, setNMin] = useState(N_START_DEFAULT)
  const [nMax, setNMax] = useState(N_START_DEFAULT)
  const [hvMinSeen, setHvMinSeen] = useState(HV_DEFAULT)
  const [hvMaxSeen, setHvMaxSeen] = useState(HV_DEFAULT)

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  const resetStageState = useCallback(() => {
    setNStart(N_START_DEFAULT)
    setHv(HV_DEFAULT)
    setNMin(N_START_DEFAULT); setNMax(N_START_DEFAULT)
    setHvMinSeen(HV_DEFAULT); setHvMaxSeen(HV_DEFAULT)
    setPeekVisible(false)
  }, [])
  useReset(resetStageState)

  // ─── Coverage ─────────────────────────────────────────────
  const nCoverage = (nMax - nMin) / (N_START_MAX - N_START_MIN)
  const hvCoverage = (hvMaxSeen - hvMinSeen) / (HV_MAX - HV_MIN)
  const stage1Done = nCoverage >= COVERAGE_MIN_FRAC && hvCoverage >= COVERAGE_MIN_FRAC

  // ─── Feature match (stage 2 & 3) ──────────────────────────
  const setupMatch = featureMatches(nStart, hv, setup)

  // Stage-1 / stage-2 visual absorption feedback (help — REMOVED on stage 3).
  // This is what tells the student, live, whether their photon is being absorbed
  // and which n_final it hits. It IS the training-wheels visualization.
  const absorption = useMemo(
    () => (isStage3 ? null : nearestAbsorption(nStart, hv)),
    [nStart, hv, isStage3],
  )
  const isAbsorbed = absorption !== null && absorption.err < VISUAL_LOCK_TOL

  const canSubmit = isStage1 ? stage1Done : setupMatch

  // Stage-3 fail-with-restart: one submit per attempt; wrong → rotate.
  // failCountRef is currently only used to force a state reset; setup itself
  // is deliberately fixed by seed (student must solve THIS transition).
  const failCountRef = useRef(0)

  useEffect(() => {
    progress(stageIdx / 3, { stage: stageIdx, canSubmit })
  }, [stageIdx, canSubmit, progress])

  useNext(() => {
    if (stageIdx < 3) {
      setStage(stageIdx + 1)
      resetStageState()
    } else if (setupMatch) {
      complete({ success: true })
    } else {
      failCountRef.current += 1
      resetStageState()
    }
  })

  // ─── Peek (blind stage only, text only) ───────────────────
  const PEEK_TIPS = useMemo(
    () => [labels.peek_tip_formula, labels.peek_tip_anchor],
    [labels],
  )
  const peekIdxRef = useRef(0)
  usePeek(() => {
    if (!isStage3) return
    setPeekVisible(true)
    peekIdxRef.current += 1
  })
  useEffect(() => {
    if (!peekVisible) return
    const t = setTimeout(() => setPeekVisible(false), PEEK_MS)
    return () => clearTimeout(t)
  }, [peekVisible])

  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  // ─── Rendered geometry ────────────────────────────────────
  // Cache the level y-positions (only recomputed on layout constants).
  const levelYs = useMemo(() => {
    const ys: number[] = []
    for (let n = 1; n <= N_MAX; n++) ys.push(yE(levelEnergy(n)))
    return ys
  }, [])

  // Photon arrow (stages 1 & 2): base at y(E_start), tip at y(E_start + hv)
  const arrowBaseY = yE(levelEnergy(nStart))
  const arrowTipEnergy = levelEnergy(nStart) + hv
  const ionized = arrowTipEnergy > 0
  const arrowTipY = ionized ? DIAG_TOP - 4 : yE(arrowTipEnergy)
  const ARROW_X = 400

  // ─── HUD text ─────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`

  const hudTR = isStage1
    ? `n·${(nCoverage * 100).toFixed(0)}% hv·${(hvCoverage * 100).toFixed(0)}%`
    : `n_i = ${nStart}   hν = ${fmtEv(hv)}`

  const hudBL = peekVisible
    ? PEEK_TIPS[(peekIdxRef.current - 1) % PEEK_TIPS.length]!
    : isStage1
      ? labels.tip1
      : isStage2
        ? labels.tip2
        : labels.tip3
  // BR intentionally left empty (parent-chrome reservation).

  // Colors
  const LEVEL_COLOR = '#3B4A6A'
  const LEVEL_LABEL_COLOR = '#6C7A93'
  const START_COLOR = '#37C9B8'
  const TARGET_COLOR = '#F97316'
  const PHOTON_COLOR = '#F9CE68'
  const ABSORB_COLOR = '#37C9B8'

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block', userSelect: 'none' }}
      >
        {/* Full-canvas background — NO rx */}
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        {/* Diagram frame */}
        <rect
          x={32}
          y={60}
          width={462}
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
          {labels.diagram_title}
        </text>

        {/* Y-axis anchors: E = 0 (top, ionization) and E_1 (bottom, ground) —
            these two labels stay visible on ALL stages (required orientation). */}
        <line
          x1={DIAG_LEFT - 6}
          y1={DIAG_TOP}
          x2={DIAG_RIGHT}
          y2={DIAG_TOP}
          stroke="#2A3654"
          strokeWidth={1}
          strokeDasharray="2 4"
        />
        <text
          x={DIAG_RIGHT + 6}
          y={DIAG_TOP + 3}
          fill={LEVEL_LABEL_COLOR}
          fontFamily="'JetBrains Mono', monospace"
          fontSize={9}
        >
          {labels.level_e0}
        </text>

        {/* Ground state (n=1) — always visible.
            On stage 3 it also acts as the visual anchor for n_i (if n_i=1). */}
        <line
          x1={DIAG_LEFT}
          y1={DIAG_BOTTOM}
          x2={DIAG_RIGHT}
          y2={DIAG_BOTTOM}
          stroke={LEVEL_COLOR}
          strokeWidth={1.5}
        />
        <text
          x={DIAG_LEFT - 10}
          y={DIAG_BOTTOM + 3}
          fill={LEVEL_LABEL_COLOR}
          fontFamily="'JetBrains Mono', monospace"
          fontSize={10}
          textAnchor="end"
        >
          n=1
        </text>
        <text
          x={DIAG_RIGHT + 6}
          y={DIAG_BOTTOM + 3}
          fill={LEVEL_LABEL_COLOR}
          fontFamily="'JetBrains Mono', monospace"
          fontSize={9}
        >
          {labels.level_e1}
        </text>

        {/* Intermediate levels n=2..6 — HELP visualization, hidden on stage 3. */}
        {!isStage3 && levelYs.slice(1).map((y, i) => {
          const n = i + 2
          const isCurrent = n === nStart
          const glow = isAbsorbed && absorption!.nFinal === n
          return (
            <g key={`lvl${n}`}>
              <line
                x1={DIAG_LEFT}
                y1={y}
                x2={DIAG_RIGHT}
                y2={y}
                stroke={glow ? ABSORB_COLOR : LEVEL_COLOR}
                strokeWidth={glow ? 2 : 1}
                opacity={glow ? 1 : 0.85}
              />
              <text
                x={DIAG_LEFT - 10}
                y={y + 3}
                fill={isCurrent ? START_COLOR : LEVEL_LABEL_COLOR}
                fontFamily="'JetBrains Mono', monospace"
                fontSize={10}
                textAnchor="end"
              >
                n={n}
              </text>
              <text
                x={DIAG_RIGHT + 6}
                y={y + 3}
                fill={LEVEL_LABEL_COLOR}
                fontFamily="'JetBrains Mono', monospace"
                fontSize={9}
              >
                {levelEnergy(n).toFixed(2)} eV
              </text>
            </g>
          )
        })}

        {/* Stage 2 & 3: target markers (dashed, orange).
            Stage 2 shows n_i and n_f at the correct y (help + required).
            Stage 3 shows the LABELS only (as text, not as scaled lines),
            since scaled lines would let the student measure gaps by eye. */}
        {isStage2 && (
          <g>
            {/* Highlight target n_i */}
            <line
              x1={DIAG_LEFT - 4}
              y1={yE(levelEnergy(setup.nStart))}
              x2={DIAG_RIGHT + 4}
              y2={yE(levelEnergy(setup.nStart))}
              stroke={TARGET_COLOR}
              strokeWidth={1.5}
              strokeDasharray="6 4"
              opacity={0.85}
            />
            <text
              x={DIAG_RIGHT + 44}
              y={yE(levelEnergy(setup.nStart)) + 3}
              fill={TARGET_COLOR}
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
            >
              n_i*
            </text>
            {/* Highlight target n_f */}
            <line
              x1={DIAG_LEFT - 4}
              y1={yE(levelEnergy(setup.nFinal))}
              x2={DIAG_RIGHT + 4}
              y2={yE(levelEnergy(setup.nFinal))}
              stroke={TARGET_COLOR}
              strokeWidth={1.5}
              strokeDasharray="6 4"
              opacity={0.85}
            />
            <text
              x={DIAG_RIGHT + 44}
              y={yE(levelEnergy(setup.nFinal)) + 3}
              fill={TARGET_COLOR}
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
            >
              n_f*
            </text>
            <text
              x={DIAG_LEFT}
              y={DIAG_TOP - 10}
              fill={TARGET_COLOR}
              fontFamily="'JetBrains Mono', monospace"
              fontSize={11}
              letterSpacing="0.1em"
            >
              {labels.target_label}: {setup.nStart} → {setup.nFinal}
            </text>
          </g>
        )}

        {/* Stage 3: target as TEXT only — no scaled y-positions, no help lines.
            Student must know E_n = -E1/n². */}
        {isStage3 && (
          <g>
            <text
              x={(DIAG_LEFT + DIAG_RIGHT) / 2}
              y={200}
              fill={TARGET_COLOR}
              fontFamily="'JetBrains Mono', monospace"
              fontSize={22}
              textAnchor="middle"
              letterSpacing="0.12em"
            >
              {labels.target_label}
            </text>
            <text
              x={(DIAG_LEFT + DIAG_RIGHT) / 2}
              y={240}
              fill="#EAF0FA"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={28}
              textAnchor="middle"
              letterSpacing="0.08em"
            >
              n_i = {setup.nStart}  →  n_f = {setup.nFinal}
            </text>
            <text
              x={(DIAG_LEFT + DIAG_RIGHT) / 2}
              y={278}
              fill={LEVEL_LABEL_COLOR}
              fontFamily="'JetBrains Mono', monospace"
              fontSize={11}
              textAnchor="middle"
              letterSpacing="0.06em"
            >
              E_n = -13.6 / n²  (eV)
            </text>
          </g>
        )}

        {/* Electron marker on the current n_i level — help visualization,
            hidden on stage 3 (level positions themselves are hidden). */}
        {!isStage3 && (
          <g>
            <circle
              cx={DIAG_LEFT + 20}
              cy={yE(levelEnergy(nStart))}
              r={5}
              fill={START_COLOR}
            />
            <circle
              cx={DIAG_LEFT + 20}
              cy={yE(levelEnergy(nStart))}
              r={9}
              fill="none"
              stroke={START_COLOR}
              strokeWidth={1}
              opacity={0.5}
            />
          </g>
        )}

        {/* Photon arrow — HELP visualization, hidden on stage 3. */}
        {!isStage3 && (
          <g>
            {/* Arrow shaft */}
            <line
              x1={ARROW_X}
              y1={arrowBaseY}
              x2={ARROW_X}
              y2={arrowTipY}
              stroke={ionized ? '#B45309' : (isAbsorbed ? ABSORB_COLOR : PHOTON_COLOR)}
              strokeWidth={2}
            />
            {/* Arrow head */}
            {!ionized && (
              <polygon
                points={`${ARROW_X - 5},${arrowTipY + 6} ${ARROW_X + 5},${arrowTipY + 6} ${ARROW_X},${arrowTipY}`}
                fill={isAbsorbed ? ABSORB_COLOR : PHOTON_COLOR}
              />
            )}
            {/* Arrow base dot */}
            <circle
              cx={ARROW_X}
              cy={arrowBaseY}
              r={3}
              fill={PHOTON_COLOR}
            />
            {/* Photon label + status */}
            <text
              x={ARROW_X + 14}
              y={(arrowBaseY + arrowTipY) / 2 + 3}
              fill={PHOTON_COLOR}
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
            >
              hν
            </text>
            <text
              x={ARROW_X + 14}
              y={(arrowBaseY + arrowTipY) / 2 + 18}
              fill={
                ionized
                  ? '#B45309'
                  : isAbsorbed
                    ? ABSORB_COLOR
                    : LEVEL_LABEL_COLOR
              }
              fontFamily="'JetBrains Mono', monospace"
              fontSize={9}
            >
              {ionized
                ? labels.ionized
                : isAbsorbed
                  ? `${labels.match_ok} → n=${absorption!.nFinal}`
                  : labels.no_absorb}
            </text>
          </g>
        )}
      </svg>

      {/* HUD overlays (HTML in rem) */}
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
          color: '#B9C4D6',
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
          color: peekVisible ? '#F9A968' : '#6C7A93',
          zIndex: 5,
          pointerEvents: 'none',
          maxWidth: '55%',
        }}
      >
        {hudBL}
      </div>
      {/* BR intentionally empty — reserved for parent-side chrome. */}

      {/* Slider column (right side, HTML overlay) */}
      <div
        style={{
          position: 'absolute',
          top: '9rem',
          right: '4rem',
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'flex-start',
          gap: '2rem',
          zIndex: 6,
        }}
      >
        <SliderVertical
          label="n_i"
          unit=""
          value={nStart}
          min={N_START_MIN}
          max={N_START_MAX}
          step={1}
          format={(v) => v.toFixed(0)}
          onChange={(v) => {
            const iv = Math.round(v)
            setNStart(iv)
            setNMin((prev) => Math.min(prev, iv))
            setNMax((prev) => Math.max(prev, iv))
          }}
        />
        <SliderVertical
          label={'hν'}
          unit="eV"
          value={hv}
          min={HV_MIN}
          max={HV_MAX}
          step={HV_STEP}
          format={(v) => v.toFixed(2)}
          onChange={(v) => {
            setHv(v)
            setHvMinSeen((prev) => Math.min(prev, v))
            setHvMaxSeen((prev) => Math.max(prev, v))
          }}
          accent="#F9CE68"
        />
      </div>
    </div>
  )
}

// ─── Slider primitive (copied from diffraction reference, adapted) ─────
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
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.4rem' }}>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.5rem', color: '#54617A' }}>
        {format(max)}
      </div>
      <div style={{ width: '2.5rem', height: '17rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{
            width: '17rem',
            height: '2.2rem',
            transform: 'rotate(-90deg)',
            transformOrigin: 'center',
            accentColor: accent,
            cursor: 'pointer',
          }}
        />
      </div>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.5rem', color: '#54617A' }}>
        {format(min)}
      </div>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.9rem', color: accent }}>
        {label} = {format(value)}{unit ? ` ${unit}` : ''}
      </div>
    </div>
  )
}

