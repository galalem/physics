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
import fr from '../i18n/fr.json'
import ar from '../i18n/ar.json'
import {
  computePower,
  computeWork,
  horizontalForce,
  SETUPS,
  verticalForce,
  withinTol,
} from './physics'

// ─── Scene constants ────────────────────────────────────────────
const W = 800
const H = 450

// Ground / scene geometry (SVG units)
const FLOOR_Y = 340
const SCENE_X0 = 40
const SCENE_X1 = 540
const CRATE_W = 80
const CRATE_H = 60
const CRATE_X = 190
const CRATE_TOP = FLOOR_Y - CRATE_H // 280
const ANCHOR_X = CRATE_X + CRATE_W // 270
const ANCHOR_Y = CRATE_TOP + 8 // 288

// Force vector display scaling — F/F_MAX → 0..PX
const FORCE_ARROW_PX = 140

// Motion arrow scaling
const MOTION_START_X = CRATE_X + CRATE_W + 4
const MOTION_MAX_PX = 220

// ─── Physics DOF constants ──────────────────────────────────────
const F_MIN = 10
const F_MAX = 200
const F_DEFAULT = 100
const F_STEP = 5

const ALPHA_MIN = 0
const ALPHA_MAX = 90
const ALPHA_DEFAULT = 30
const ALPHA_STEP = 5

const D_MIN = 1
const D_MAX = 10
const D_DEFAULT = 5
const D_STEP = 0.5

const DT_MIN = 1
const DT_MAX = 30
const DT_DEFAULT = 10
const DT_STEP = 0.5

const COVERAGE_MIN_FRAC = 0.5

// ─── Label loader ────────────────────────────────────────────────
const dict = { en, fr, ar } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── Formatters ──────────────────────────────────────────────────
function formatW(w: number): string {
  if (Math.abs(w) >= 1000) return `${(w / 1000).toFixed(2)}kJ`
  if (Math.abs(w) >= 100) return `${w.toFixed(0)}J`
  return `${w.toFixed(1)}J`
}
function formatP(p: number): string {
  if (Math.abs(p) >= 1000) return `${(p / 1000).toFixed(2)}kW`
  if (Math.abs(p) >= 100) return `${p.toFixed(0)}W`
  return `${p.toFixed(1)}W`
}

// ─── Component ──────────────────────────────────────────────────
export default function Scene() {
  const { locale, seed } = useInit()
  const stages = useMemo(() => getStagesFor(locale), [locale])
  useDeclareStages(stages)
  const labels = useMemo(() => svgLabels(locale), [locale])

  const stageIdx = useCurrentStage()
  const setStage = useSetStage()
  const progress = useProgress()
  const complete = useComplete()

  // ─── DOF state ─────────────────────────────────────────────
  const [failCount, setFailCount] = useState(0)
  const setup = useMemo(
    () => SETUPS[(seed + failCount) % SETUPS.length]!,
    [seed, failCount],
  )

  const [fN, setFN] = useState(F_DEFAULT)
  const [alpha, setAlpha] = useState(ALPHA_DEFAULT)
  const [dM, setDM] = useState(D_DEFAULT)
  const [dt, setDt] = useState(DT_DEFAULT)
  const [peekVisible, setPeekVisible] = useState(false)
  const peekIdxRef = useRef(0)

  // Coverage tracking (stage 1)
  const [fMinT, setFMinT] = useState(F_DEFAULT)
  const [fMaxT, setFMaxT] = useState(F_DEFAULT)
  const [aMinT, setAMinT] = useState(ALPHA_DEFAULT)
  const [aMaxT, setAMaxT] = useState(ALPHA_DEFAULT)
  const [dMinT, setDMinT] = useState(D_DEFAULT)
  const [dMaxT, setDMaxT] = useState(D_DEFAULT)
  const [dtMinT, setDtMinT] = useState(DT_DEFAULT)
  const [dtMaxT, setDtMaxT] = useState(DT_DEFAULT)

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  const resetStageState = useCallback(() => {
    setFN(F_DEFAULT)
    setAlpha(ALPHA_DEFAULT)
    setDM(D_DEFAULT)
    setDt(DT_DEFAULT)
    setFMinT(F_DEFAULT); setFMaxT(F_DEFAULT)
    setAMinT(ALPHA_DEFAULT); setAMaxT(ALPHA_DEFAULT)
    setDMinT(D_DEFAULT); setDMaxT(D_DEFAULT)
    setDtMinT(DT_DEFAULT); setDtMaxT(DT_DEFAULT)
    setPeekVisible(false)
  }, [])
  useReset(resetStageState)

  // ─── Physics ────────────────────────────────────────────────
  const workJ = computeWork(fN, dM, alpha)
  const powerW = computePower(workJ, dt)
  const fx = horizontalForce(fN, alpha)
  const fy = verticalForce(fN, alpha)

  // ─── Coverage (stage 1) ────────────────────────────────────
  const fCov = (fMaxT - fMinT) / (F_MAX - F_MIN)
  const aCov = (aMaxT - aMinT) / (ALPHA_MAX - ALPHA_MIN)
  const dCov = (dMaxT - dMinT) / (D_MAX - D_MIN)
  const dtCov = (dtMaxT - dtMinT) / (DT_MAX - DT_MIN)
  const stage1Done =
    fCov >= COVERAGE_MIN_FRAC &&
    aCov >= COVERAGE_MIN_FRAC &&
    dCov >= COVERAGE_MIN_FRAC &&
    dtCov >= COVERAGE_MIN_FRAC

  // ─── Match checks (silent on stage 3 — no live tint) ───────
  const stage2Match = withinTol(powerW, setup.pStar)
  const stage3WorkMatch = withinTol(workJ, setup.wStar)
  const stage3DMatch = withinTol(dM, setup.dStar, 0.02)
  const stage3Match = stage3WorkMatch && stage3DMatch

  const canSubmit = isStage1 ? stage1Done : isStage2 ? stage2Match : true
  // Stage 3: NEXT is always active (single-submit fail-with-restart).

  useEffect(() => {
    progress(stageIdx / 3, { stage: stageIdx, canSubmit })
  }, [stageIdx, canSubmit, progress])

  useNext(() => {
    if (stageIdx < 3) {
      setStage(stageIdx + 1)
      resetStageState()
    } else if (stage3Match) {
      complete({ success: true })
    } else {
      // Fail-with-restart: rotate to next setup, reset sliders.
      setFailCount((n) => n + 1)
      resetStageState()
    }
  })

  // ─── Peek: strategy text hint only, NEVER the visualization ─
  const PEEK_TIPS = useMemo(
    () => [labels.peek_tip_formula, labels.peek_tip_anchor],
    [labels],
  )
  usePeek(() => {
    if (!isStage3) return
    peekIdxRef.current += 1
    setPeekVisible(true)
  })
  useEffect(() => {
    if (!peekVisible) return
    const t = setTimeout(() => setPeekVisible(false), 4000)
    return () => clearTimeout(t)
  }, [peekVisible])

  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  // ─── Visualization gating ──────────────────────────────────
  // Force decomposition + live W/P readout is the "help" for this pattern.
  // On stage 3 it is HIDDEN. Peek does NOT reveal it — peek is text only.
  const showForceViz = !isStage3
  const showLiveReadout = !isStage3

  // ─── SVG geometry derived from state ────────────────────────
  const alphaRad = (alpha * Math.PI) / 180
  // Force vector: tail at anchor, tip toward upper-right at angle α above horizontal.
  const forceLen = (fN / F_MAX) * FORCE_ARROW_PX
  const tipX = ANCHOR_X + Math.cos(alphaRad) * forceLen
  const tipY = ANCHOR_Y - Math.sin(alphaRad) * forceLen

  // Motion arrow length scales with d (visual only — always drawn on stages
  // 2 + 3 since knowing d is required info; on stage 1 also drawn).
  const motionLen = ((dM - D_MIN) / (D_MAX - D_MIN)) * MOTION_MAX_PX + 20
  const motionEndX = Math.min(MOTION_START_X + motionLen, SCENE_X1 - 10)

  // Target motion (stage 3) — d*
  const targetMotionLen =
    ((setup.dStar - D_MIN) / (D_MAX - D_MIN)) * MOTION_MAX_PX + 20
  const targetMotionEndX = Math.min(
    MOTION_START_X + targetMotionLen,
    SCENE_X1 - 10,
  )

  // ─── HUD text ────────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`
  const hudTR = isStage1
    ? `F·${(fCov * 100).toFixed(0)}% α·${(aCov * 100).toFixed(0)}% d·${(dCov * 100).toFixed(0)}% Δt·${(dtCov * 100).toFixed(0)}%`
    : isStage2
      ? `${labels.target_short}: P* = ${formatP(setup.pStar)}`
      : `${labels.target_short}: W* = ${formatW(setup.wStar)} · d* = ${setup.dStar.toFixed(1)}m`
  const hudBL = peekVisible
    ? PEEK_TIPS[(peekIdxRef.current - 1) % PEEK_TIPS.length]!
    : isStage1
      ? labels.tip1
      : isStage2
        ? labels.tip2
        : labels.tip3
  // BR is reserved for parent chrome (fullscreen). Live readout goes TR-below.

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
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        {/* Scene frame */}
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
          {labels.bench}
        </text>

        {/* Floor */}
        <line
          x1={SCENE_X0}
          y1={FLOOR_Y}
          x2={SCENE_X1}
          y2={FLOOR_Y}
          stroke="#3A4863"
          strokeWidth={2}
        />
        {/* Floor hatching */}
        {Array.from({ length: 24 }).map((_, i) => {
          const x = SCENE_X0 + i * 21
          return (
            <line
              key={`h${i}`}
              x1={x}
              y1={FLOOR_Y + 2}
              x2={x + 8}
              y2={FLOOR_Y + 12}
              stroke="#2A3654"
              strokeWidth={1}
            />
          )
        })}
        <text
          x={SCENE_X0 + 4}
          y={FLOOR_Y + 24}
          fill="#54617A"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={9}
        >
          {labels.floor}
        </text>

        {/* Crate */}
        <rect
          x={CRATE_X}
          y={CRATE_TOP}
          width={CRATE_W}
          height={CRATE_H}
          fill="#1A2338"
          stroke="#54617A"
          strokeWidth={1.5}
          rx={2}
        />
        {/* Crate plank lines */}
        <line
          x1={CRATE_X}
          y1={CRATE_TOP + CRATE_H / 2}
          x2={CRATE_X + CRATE_W}
          y2={CRATE_TOP + CRATE_H / 2}
          stroke="#2A3654"
          strokeWidth={1}
        />
        <line
          x1={CRATE_X + CRATE_W / 2}
          y1={CRATE_TOP}
          x2={CRATE_X + CRATE_W / 2}
          y2={CRATE_TOP + CRATE_H}
          stroke="#2A3654"
          strokeWidth={1}
        />
        <text
          x={CRATE_X + CRATE_W / 2}
          y={CRATE_TOP + CRATE_H / 2 + 4}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={10}
          textAnchor="middle"
        >
          {labels.crate}
        </text>

        {/* Motion arrow — always visible (d is required info) */}
        <g>
          <line
            x1={MOTION_START_X}
            y1={FLOOR_Y - 4}
            x2={motionEndX}
            y2={FLOOR_Y - 4}
            stroke="#37C9B8"
            strokeWidth={1.5}
          />
          <path
            d={`M ${motionEndX} ${FLOOR_Y - 4} l -6 -4 l 0 8 z`}
            fill="#37C9B8"
          />
          <text
            x={(MOTION_START_X + motionEndX) / 2}
            y={FLOOR_Y - 10}
            fill="#37C9B8"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={10}
            textAnchor="middle"
          >
            d = {dM.toFixed(1)}m
          </text>
        </g>

        {/* Stage-3 target d* marker (dashed) */}
        {isStage3 && (
          <g>
            <line
              x1={MOTION_START_X}
              y1={FLOOR_Y + 20}
              x2={targetMotionEndX}
              y2={FLOOR_Y + 20}
              stroke="#F97316"
              strokeWidth={1.5}
              strokeDasharray="5 4"
              opacity={0.85}
            />
            <path
              d={`M ${targetMotionEndX} ${FLOOR_Y + 20} l -6 -4 l 0 8 z`}
              fill="#F97316"
              opacity={0.85}
            />
            <text
              x={(MOTION_START_X + targetMotionEndX) / 2}
              y={FLOOR_Y + 34}
              fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
              textAnchor="middle"
            >
              d* = {setup.dStar.toFixed(1)}m
            </text>
          </g>
        )}

        {/* Person — simple stick figure to the right of crate */}
        {(() => {
          const PX = 470
          const HEAD_Y = 240
          return (
            <g stroke="#8FA0C4" strokeWidth={2} strokeLinecap="round" fill="none">
              <circle cx={PX} cy={HEAD_Y} r={9} fill="#1A2338" />
              <line x1={PX} y1={HEAD_Y + 9} x2={PX} y2={HEAD_Y + 45} />
              {/* legs */}
              <line x1={PX} y1={HEAD_Y + 45} x2={PX - 10} y2={FLOOR_Y} />
              <line x1={PX} y1={HEAD_Y + 45} x2={PX + 10} y2={FLOOR_Y} />
              {/* Back arm (relaxed) */}
              <line x1={PX} y1={HEAD_Y + 16} x2={PX + 10} y2={HEAD_Y + 30} />
              {/* Front arm — reaches toward the rope tip */}
              <line x1={PX} y1={HEAD_Y + 16} x2={tipX} y2={tipY} />
            </g>
          )
        })()}

        {/* Rope from anchor to force tip (always visible so geometry
            of the pull is clear; on stage 3 we still show the rope so
            the student can see α, but the DECOMPOSITION vectors are
            hidden — those are the "help"). */}
        <line
          x1={ANCHOR_X}
          y1={ANCHOR_Y}
          x2={tipX}
          y2={tipY}
          stroke="#54617A"
          strokeWidth={2}
        />

        {/* Force vector (arrow) — the primary help. Hidden on stage 3. */}
        {showForceViz && (
          <g>
            <line
              x1={ANCHOR_X}
              y1={ANCHOR_Y}
              x2={tipX}
              y2={tipY}
              stroke="#37C9B8"
              strokeWidth={2.5}
            />
            <path
              d={`M ${tipX} ${tipY}
                  l ${-Math.cos(alphaRad) * 8 - Math.sin(alphaRad) * 4}
                    ${Math.sin(alphaRad) * 8 - Math.cos(alphaRad) * 4}
                  M ${tipX} ${tipY}
                  l ${-Math.cos(alphaRad) * 8 + Math.sin(alphaRad) * 4}
                    ${Math.sin(alphaRad) * 8 + Math.cos(alphaRad) * 4}`}
              stroke="#37C9B8"
              strokeWidth={2.5}
              fill="none"
              strokeLinecap="round"
            />
            <text
              x={tipX + 6}
              y={tipY - 4}
              fill="#37C9B8"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
            >
              {labels.rope} = {fN.toFixed(0)}N
            </text>

            {/* cos(α) horizontal projection — dashed along floor */}
            <line
              x1={ANCHOR_X}
              y1={ANCHOR_Y}
              x2={ANCHOR_X + Math.cos(alphaRad) * forceLen}
              y2={ANCHOR_Y}
              stroke="#F9A968"
              strokeWidth={1.5}
              strokeDasharray="4 3"
            />
            <text
              x={ANCHOR_X + (Math.cos(alphaRad) * forceLen) / 2}
              y={ANCHOR_Y - 4}
              fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={9}
              textAnchor="middle"
            >
              {labels.cos_proj} = {fx.toFixed(0)}N
            </text>

            {/* sin(α) vertical dashed */}
            <line
              x1={tipX}
              y1={ANCHOR_Y}
              x2={tipX}
              y2={tipY}
              stroke="#6C7A93"
              strokeWidth={1}
              strokeDasharray="3 3"
              opacity={0.7}
            />
            <text
              x={tipX + 4}
              y={(ANCHOR_Y + tipY) / 2 + 4}
              fill="#6C7A93"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={9}
            >
              {labels.sin_proj} = {fy.toFixed(0)}N
            </text>

            {/* Angle arc */}
            {alpha > 3 && (
              <path
                d={`M ${ANCHOR_X + 26} ${ANCHOR_Y}
                    A 26 26 0 0 0 ${ANCHOR_X + Math.cos(alphaRad) * 26} ${ANCHOR_Y - Math.sin(alphaRad) * 26}`}
                stroke="#F9A968"
                strokeWidth={1}
                fill="none"
                opacity={0.8}
              />
            )}
            <text
              x={ANCHOR_X + 34}
              y={ANCHOR_Y - 8}
              fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={9}
            >
              α = {alpha.toFixed(0)}°
            </text>
          </g>
        )}

        {/* Blind stage: show only the anchor point + a small α indicator
            on the rope so student knows the geometry, but no force
            components and no numeric F/α labels beyond what the sliders
            already give (readout in HUD panel). */}
        {isStage3 && (
          <text
            x={ANCHOR_X + 34}
            y={ANCHOR_Y - 8}
            fill="#6C7A93"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={9}
          >
            α = {alpha.toFixed(0)}°
          </text>
        )}

        {/* Target chip (SVG) — labeled target coordinate on stages 2 + 3.
            Required info: the student needs the target value visible in
            the scene, not only in the HUD overlay. */}
        {isStage2 && (
          <g>
            <rect
              x={SCENE_X0 + 12}
              y={80}
              width={170}
              height={30}
              fill="#0D1524"
              stroke="#F97316"
              strokeWidth={1}
              rx={4}
            />
            <text
              x={SCENE_X0 + 22}
              y={99}
              fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={12}
              letterSpacing="0.05em"
            >
              {labels.target_short}: P* = {formatP(setup.pStar)}
            </text>
          </g>
        )}
        {isStage3 && (
          <g>
            <rect
              x={SCENE_X0 + 12}
              y={80}
              width={220}
              height={30}
              fill="#0D1524"
              stroke="#F97316"
              strokeWidth={1}
              rx={4}
            />
            <text
              x={SCENE_X0 + 22}
              y={99}
              fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={12}
              letterSpacing="0.05em"
            >
              W* = {formatW(setup.wStar)} · d* = {setup.dStar.toFixed(1)}m
            </text>
          </g>
        )}
      </svg>

      {/* HUD — TL */}
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

      {/* HUD — TR (coverage % / target readout) */}
      <div
        style={{
          position: 'absolute',
          top: '3rem',
          right: '3rem',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '2.1rem',
          letterSpacing: '0.06em',
          color: stage1Done && isStage1 ? '#37C9B8' : '#B9C4D6',
          zIndex: 5,
          pointerEvents: 'none',
          textAlign: 'right',
          maxWidth: '52%',
        }}
      >
        {hudTR}
      </div>

      {/* HUD — TR-below: live W and P readout. Stages 1+2 only
          (this is "help" per §4.7 — hidden on stage 3). */}
      {showLiveReadout && (
        <div
          style={{
            position: 'absolute',
            top: '7.5rem',
            right: '3rem',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '2.3rem',
            letterSpacing: '0.06em',
            color: isStage2 && stage2Match ? '#37C9B8' : '#B9C4D6',
            zIndex: 5,
            pointerEvents: 'none',
            textAlign: 'right',
          }}
        >
          W = {formatW(workJ)} · P = {formatP(powerW)}
        </div>
      )}

      {/* HUD — BL (tip / peek text) */}
      <div
        style={{
          position: 'absolute',
          bottom: '3rem',
          left: '3rem',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '2.0rem',
          letterSpacing: '0.05em',
          color: peekVisible ? '#F9A968' : '#6C7A93',
          zIndex: 5,
          pointerEvents: 'none',
          maxWidth: '58%',
        }}
      >
        {hudBL}
      </div>

      {/* BR reserved — NO overlay here. */}

      {/* Sliders — stacked vertical column on right side */}
      <div
        style={{
          position: 'absolute',
          top: '13rem',
          right: '2.5rem',
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'flex-start',
          gap: '0.5rem',
          zIndex: 6,
        }}
      >
        <SliderVertical
          label="F"
          unit="N"
          value={fN}
          min={F_MIN}
          max={F_MAX}
          step={F_STEP}
          format={(v) => v.toFixed(0)}
          onChange={(v) => {
            setFN(v)
            setFMinT((p) => Math.min(p, v))
            setFMaxT((p) => Math.max(p, v))
          }}
        />
        <SliderVertical
          label="α"
          unit="°"
          value={alpha}
          min={ALPHA_MIN}
          max={ALPHA_MAX}
          step={ALPHA_STEP}
          format={(v) => v.toFixed(0)}
          onChange={(v) => {
            setAlpha(v)
            setAMinT((p) => Math.min(p, v))
            setAMaxT((p) => Math.max(p, v))
          }}
        />
        <SliderVertical
          label="d"
          unit="m"
          value={dM}
          min={D_MIN}
          max={D_MAX}
          step={D_STEP}
          format={(v) => v.toFixed(1)}
          onChange={(v) => {
            setDM(v)
            setDMinT((p) => Math.min(p, v))
            setDMaxT((p) => Math.max(p, v))
          }}
        />
        <SliderVertical
          label="Δt"
          unit="s"
          value={dt}
          min={DT_MIN}
          max={DT_MAX}
          step={DT_STEP}
          format={(v) => v.toFixed(1)}
          onChange={(v) => {
            setDt(v)
            setDtMinT((p) => Math.min(p, v))
            setDtMaxT((p) => Math.max(p, v))
          }}
        />
      </div>
    </div>
  )
}

// ─── Slider primitive (rotated vertical, compact) ────────────────
function SliderVertical({
  label,
  unit,
  value,
  min,
  max,
  step,
  format,
  onChange,
  accent = '#37C9B8',
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
        gap: '0.3rem',
        width: '6.5rem',
      }}
    >
      <div
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '1.3rem',
          color: '#54617A',
        }}
      >
        {format(max)}
      </div>
      <div
        style={{
          width: '2.4rem',
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
          fontSize: '1.3rem',
          color: '#54617A',
        }}
      >
        {format(min)}
      </div>
      <div
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '1.7rem',
          color: accent,
          whiteSpace: 'nowrap',
        }}
      >
        {label}={format(value)}{unit}
      </div>
    </div>
  )
}
