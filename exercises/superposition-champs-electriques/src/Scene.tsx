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
  D_DEFAULT,
  D_MAX,
  D_MIN,
  D_STEP,
  fieldAtM,
  fieldFromCharge,
  H_M,
  magnitude,
  Q_DEFAULT,
  Q_MAX,
  Q_MIN,
  Q_STEP,
  SETUPS,
  featureMatchesTolerance,
} from './physics'

// ─── Scene constants ────────────────────────────────────────
const W = 800
const H = 450

// Bench (schematic) SVG geometry. The right ~200 px of the canvas is
// left for the HTML slider overlay; BR corner is reserved for parent
// chrome per §4.3 so nothing is drawn there.
const BENCH_X = 32
const BENCH_Y = 60
const BENCH_W = 560
const BENCH_H = 358

// Physics ↔ SVG mapping. Origin at (ORIGIN_X, ORIGIN_Y). One physics
// meter = M_PER_UNIT SVG units, isotropic so arrow angles stay honest.
const ORIGIN_X = BENCH_X + BENCH_W / 2 // 312
const ORIGIN_Y = 340
const UNITS_PER_METER = 55

// Field-arrow scale in SVG-units per (V/m). Chosen so the largest
// realistic |E| (~60 V/m per source) still fits inside the bench.
const ARROW_SCALE = 1.3

const COVERAGE_MIN_FRAC = 0.5

const dict = { en, fr, ar } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

function xToSvg(xPhys: number): number {
  return ORIGIN_X + UNITS_PER_METER * xPhys
}
function yToSvg(yPhys: number): number {
  return ORIGIN_Y - UNITS_PER_METER * yPhys
}

// ─── Arrow primitive ────────────────────────────────────────
type ArrowProps = {
  x0: number
  y0: number
  x1: number
  y1: number
  color: string
  width?: number
  opacity?: number
  dashed?: boolean
}
function Arrow({
  x0,
  y0,
  x1,
  y1,
  color,
  width = 2,
  opacity = 1,
  dashed = false,
}: ArrowProps) {
  const dx = x1 - x0
  const dy = y1 - y0
  const len = Math.sqrt(dx * dx + dy * dy)
  if (len < 1) return null
  const ux = dx / len
  const uy = dy / len
  const HEAD = Math.min(10, len * 0.4)
  const shaftX1 = x1 - ux * HEAD
  const shaftY1 = y1 - uy * HEAD
  // Head triangle (perpendicular vectors: nx = -uy, ny = ux)
  const nx = -uy
  const ny = ux
  const hw = HEAD * 0.55
  const p1x = x1
  const p1y = y1
  const p2x = shaftX1 + nx * hw
  const p2y = shaftY1 + ny * hw
  const p3x = shaftX1 - nx * hw
  const p3y = shaftY1 - ny * hw
  return (
    <g opacity={opacity}>
      <line
        x1={x0}
        y1={y0}
        x2={shaftX1}
        y2={shaftY1}
        stroke={color}
        strokeWidth={width}
        strokeLinecap="round"
        strokeDasharray={dashed ? '5 4' : undefined}
      />
      <polygon
        points={`${p1x},${p1y} ${p2x},${p2y} ${p3x},${p3y}`}
        fill={color}
      />
    </g>
  )
}

// ─── Component ──────────────────────────────────────────────
export default function Scene() {
  const { locale, seed } = useInit()
  const stages = useMemo(() => getStagesFor(locale), [locale])
  useDeclareStages(stages)
  const labels = useMemo(() => svgLabels(locale), [locale])

  const stageIdx = useCurrentStage()
  const setStage = useSetStage()
  const progress = useProgress()
  const complete = useComplete()

  // ─── DOF state ────────────────────────────────────────────
  const [q1, setQ1] = useState(Q_DEFAULT)
  const [q2, setQ2] = useState(Q_DEFAULT)
  const [d, setD] = useState(D_DEFAULT)
  const [peekVisible, setPeekVisible] = useState(false)

  // Stage 1 coverage tracking
  const [q1Min, setQ1Min] = useState(Q_DEFAULT)
  const [q1Max, setQ1Max] = useState(Q_DEFAULT)
  const [q2Min, setQ2Min] = useState(Q_DEFAULT)
  const [q2Max, setQ2Max] = useState(Q_DEFAULT)
  const [dMin, setDMin] = useState(D_DEFAULT)
  const [dMax, setDMax] = useState(D_DEFAULT)

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  // Stage 3 fail-with-restart: rotate to next setup on wrong submit.
  const failCountRef = useRef(0)
  const peekIdxRef = useRef(0)

  // Seed-indexed setup selection. On stage-3 fail we bump `setupNonce`
  // to rotate to the next setup so re-submitting the same one is not
  // possible (fail-with-restart, §5.3).
  const [setupNonce, setSetupNonce] = useState(0)
  const activeSetup = useMemo(
    () => SETUPS[(seed + setupNonce) % SETUPS.length]!,
    [seed, setupNonce],
  )

  const resetStageState = useCallback(() => {
    setQ1(Q_DEFAULT)
    setQ2(Q_DEFAULT)
    setD(D_DEFAULT)
    setQ1Min(Q_DEFAULT)
    setQ1Max(Q_DEFAULT)
    setQ2Min(Q_DEFAULT)
    setQ2Max(Q_DEFAULT)
    setDMin(D_DEFAULT)
    setDMax(D_DEFAULT)
    setPeekVisible(false)
  }, [])
  useReset(() => {
    failCountRef.current = 0
    setSetupNonce(0)
    resetStageState()
  })

  // ─── Coverage (stage 1 predicate) ─────────────────────────
  const cov1 = (q1Max - q1Min) / (Q_MAX - Q_MIN)
  const cov2 = (q2Max - q2Min) / (Q_MAX - Q_MIN)
  const covD = (dMax - dMin) / (D_MAX - D_MIN)
  const stage1Done =
    cov1 >= COVERAGE_MIN_FRAC &&
    cov2 >= COVERAGE_MIN_FRAC &&
    covD >= COVERAGE_MIN_FRAC

  // ─── Feature (resultant E at M) ───────────────────────────
  const E = useMemo(() => fieldAtM(q1, q2, d), [q1, q2, d])
  const featureMatch = featureMatchesTolerance(E, activeSetup)

  const canSubmit = isStage1 ? stage1Done : featureMatch

  useEffect(() => {
    progress(stageIdx / 3, { stage: stageIdx, canSubmit })
  }, [stageIdx, canSubmit, progress])

  useNext(() => {
    if (stageIdx < 3) {
      setStage(stageIdx + 1)
      resetStageState()
    } else if (featureMatch) {
      complete({ success: true })
    } else {
      // Fail-with-restart: rotate to next setup, reset sliders.
      failCountRef.current += 1
      setSetupNonce((n) => n + 1)
      resetStageState()
    }
  })

  // ─── Peek (stage 3 only — text tip, never renders arrows) ─
  const PEEK_TIPS = useMemo(
    () => [labels.peek_tip_formula, labels.peek_tip_anchor],
    [labels],
  )
  usePeek(() => {
    if (!isStage3) return
    setPeekVisible(true)
    peekIdxRef.current += 1
  })
  useEffect(() => {
    if (!peekVisible) return
    const t = setTimeout(() => setPeekVisible(false), 4000)
    return () => clearTimeout(t)
  }, [peekVisible])

  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  // ─── Individual & resultant field arrows (hidden on stage 3) ─
  const showFieldArrows = !isStage3
  const Mx = xToSvg(0)
  const My = yToSvg(H_M)
  const chargeLx = xToSvg(-d)
  const chargeLy = yToSvg(0)
  const chargeRx = xToSvg(d)
  const chargeRy = yToSvg(0)

  // Colors: red for +, blue for −, brown for neutral (~0)
  const chargeColor = (q: number): string => {
    if (Math.abs(q) < 0.5) return '#6C7A93'
    return q > 0 ? '#F97316' : '#4C8EEF'
  }
  const q1Color = chargeColor(q1)
  const q2Color = chargeColor(q2)
  const resultantColor = '#37C9B8'
  const targetColor = '#F9A968'

  // Compute per-source field at M for arrow drawing
  const E1 = fieldFromCharge(q1, -d, 0, 0, H_M)
  const E2 = fieldFromCharge(q2, d, 0, 0, H_M)

  // Convert a physics field vector at M into SVG endpoint (arrow tip).
  // Physics y-up → SVG y-down: flip Ey for the on-screen delta.
  const fieldToTip = (Ex: number, Ey: number) => ({
    x: Mx + Ex * ARROW_SCALE,
    y: My - Ey * ARROW_SCALE,
  })

  const tipE1 = fieldToTip(E1.Ex, E1.Ey)
  const tipE2 = fieldToTip(E2.Ex, E2.Ey)
  const tipR = fieldToTip(E.Ex, E.Ey)
  const tipTarget = fieldToTip(activeSetup.targetEx, activeSetup.targetEy)

  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`
  // TR: coverage on stage 1 only. Stage 2 and 3 leave TR blank —
  // no live match indicator (§4.7 rule 3) and no live delta readout.
  const hudTR = isStage1
    ? `q1·${(cov1 * 100).toFixed(0)}%  q2·${(cov2 * 100).toFixed(0)}%  d·${(covD * 100).toFixed(0)}%`
    : ''
  const hudBL = peekVisible
    ? PEEK_TIPS[(peekIdxRef.current - 1) % PEEK_TIPS.length]!
    : isStage1
      ? labels.tip1
      : isStage2
        ? labels.tip2
        : labels.tip3

  // Ground line and axis labels for the schematic
  const groundY = yToSvg(0)

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

        {/* Bench frame */}
        <rect
          x={BENCH_X}
          y={BENCH_Y}
          width={BENCH_W}
          height={BENCH_H}
          fill="none"
          stroke="#12203a"
          strokeWidth={1}
          rx={6}
        />
        <text
          x={BENCH_X + 8}
          y={BENCH_Y - 8}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={11}
          letterSpacing="0.1em"
        >
          {labels.bench}
        </text>

        {/* Ground axis line at y = 0 (charge row) */}
        <line
          x1={BENCH_X + 12}
          y1={groundY}
          x2={BENCH_X + BENCH_W - 12}
          y2={groundY}
          stroke="#2A3654"
          strokeWidth={1}
          strokeDasharray="2 4"
        />

        {/* Vertical axis through the origin (helps localize M) */}
        <line
          x1={ORIGIN_X}
          y1={BENCH_Y + 12}
          x2={ORIGIN_X}
          y2={BENCH_Y + BENCH_H - 12}
          stroke="#2A3654"
          strokeWidth={1}
          strokeDasharray="2 4"
        />

        {/* Charge markers */}
        <g>
          <circle
            cx={chargeLx}
            cy={chargeLy}
            r={9}
            fill={q1Color}
            stroke="#0D1524"
            strokeWidth={1.5}
          />
          <text
            x={chargeLx}
            y={chargeLy + 3}
            fill="#0D1524"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={11}
            fontWeight={700}
            textAnchor="middle"
          >
            {q1 > 0.5 ? '+' : q1 < -0.5 ? '−' : '0'}
          </text>
          <text
            x={chargeLx}
            y={chargeLy + 24}
            fill="#6C7A93"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={10}
            textAnchor="middle"
          >
            q1
          </text>

          <circle
            cx={chargeRx}
            cy={chargeRy}
            r={9}
            fill={q2Color}
            stroke="#0D1524"
            strokeWidth={1.5}
          />
          <text
            x={chargeRx}
            y={chargeRy + 3}
            fill="#0D1524"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={11}
            fontWeight={700}
            textAnchor="middle"
          >
            {q2 > 0.5 ? '+' : q2 < -0.5 ? '−' : '0'}
          </text>
          <text
            x={chargeRx}
            y={chargeRy + 24}
            fill="#6C7A93"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={10}
            textAnchor="middle"
          >
            q2
          </text>
        </g>

        {/* d indicator: dashed segment between the two charges with label */}
        <g opacity={0.7}>
          <line
            x1={chargeLx}
            y1={chargeLy + 36}
            x2={chargeRx}
            y2={chargeRy + 36}
            stroke="#54617A"
            strokeWidth={1}
          />
          <line
            x1={chargeLx}
            y1={chargeLy + 32}
            x2={chargeLx}
            y2={chargeLy + 40}
            stroke="#54617A"
            strokeWidth={1}
          />
          <line
            x1={chargeRx}
            y1={chargeRy + 32}
            x2={chargeRx}
            y2={chargeRy + 40}
            stroke="#54617A"
            strokeWidth={1}
          />
          <text
            x={(chargeLx + chargeRx) / 2}
            y={chargeLy + 52}
            fill="#6C7A93"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={10}
            textAnchor="middle"
          >
            2d = {(2 * d).toFixed(2)} m
          </text>
        </g>

        {/* Test point M */}
        <g>
          <circle
            cx={Mx}
            cy={My}
            r={5}
            fill="#B9C4D6"
            stroke="#0D1524"
            strokeWidth={1.5}
          />
          <text
            x={Mx + 10}
            y={My - 8}
            fill="#B9C4D6"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={12}
            fontWeight={700}
          >
            {labels.point_m}
          </text>
          <text
            x={Mx + 10}
            y={My + 8}
            fill="#54617A"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={9}
          >
            h = {H_M.toFixed(2)} m
          </text>
        </g>

        {/* Stage 2 & 3: target arrow silhouette + component labels
            (required information — student can't compute without it). */}
        {(isStage2 || isStage3) && (
          <g>
            <Arrow
              x0={Mx}
              y0={My}
              x1={tipTarget.x}
              y1={tipTarget.y}
              color={targetColor}
              width={2.5}
              dashed
              opacity={0.85}
            />
            <text
              x={tipTarget.x + 8}
              y={tipTarget.y + 4}
              fill={targetColor}
              fontFamily="'JetBrains Mono', monospace"
              fontSize={11}
              fontWeight={700}
            >
              {labels.target_arrow}
            </text>
            {/* Target component readout, anchored bottom-left of the
                bench (well away from the reserved BR corner). */}
            <text
              x={BENCH_X + 12}
              y={BENCH_Y + BENCH_H - 22}
              fill={targetColor}
              fontFamily="'JetBrains Mono', monospace"
              fontSize={11}
            >
              Ex* = {activeSetup.targetEx.toFixed(0)} V/m
            </text>
            <text
              x={BENCH_X + 12}
              y={BENCH_Y + BENCH_H - 8}
              fill={targetColor}
              fontFamily="'JetBrains Mono', monospace"
              fontSize={11}
            >
              Ey* = {activeSetup.targetEy.toFixed(0)} V/m
            </text>
          </g>
        )}

        {/* Field arrows E1, E2, resultant — stages 1 & 2 ONLY.
            Removed on stage 3 (§4.7: this is the primary help). */}
        {showFieldArrows && (
          <g>
            {/* E1 from q1 */}
            {magnitude(E1) > 0.3 && (
              <Arrow
                x0={Mx}
                y0={My}
                x1={tipE1.x}
                y1={tipE1.y}
                color={q1Color}
                width={1.8}
                opacity={0.75}
              />
            )}
            {/* E2 from q2 */}
            {magnitude(E2) > 0.3 && (
              <Arrow
                x0={Mx}
                y0={My}
                x1={tipE2.x}
                y1={tipE2.y}
                color={q2Color}
                width={1.8}
                opacity={0.75}
              />
            )}
            {/* Head-to-tail parallelogram helpers (light dashed) */}
            {magnitude(E1) > 0.3 && magnitude(E2) > 0.3 && (
              <>
                <line
                  x1={tipE1.x}
                  y1={tipE1.y}
                  x2={tipR.x}
                  y2={tipR.y}
                  stroke={q2Color}
                  strokeWidth={0.8}
                  strokeDasharray="3 3"
                  opacity={0.4}
                />
                <line
                  x1={tipE2.x}
                  y1={tipE2.y}
                  x2={tipR.x}
                  y2={tipR.y}
                  stroke={q1Color}
                  strokeWidth={0.8}
                  strokeDasharray="3 3"
                  opacity={0.4}
                />
              </>
            )}
            {/* Resultant E */}
            {magnitude(E) > 0.3 && (
              <Arrow
                x0={Mx}
                y0={My}
                x1={tipR.x}
                y1={tipR.y}
                color={resultantColor}
                width={3}
              />
            )}
            {/* Arrow labels — only render if arrow long enough */}
            {magnitude(E1) > 4 && (
              <text
                x={(Mx + tipE1.x) / 2 + 6}
                y={(My + tipE1.y) / 2 - 4}
                fill={q1Color}
                fontFamily="'JetBrains Mono', monospace"
                fontSize={10}
              >
                E1
              </text>
            )}
            {magnitude(E2) > 4 && (
              <text
                x={(Mx + tipE2.x) / 2 - 14}
                y={(My + tipE2.y) / 2 - 4}
                fill={q2Color}
                fontFamily="'JetBrains Mono', monospace"
                fontSize={10}
              >
                E2
              </text>
            )}
            {magnitude(E) > 4 && (
              <text
                x={tipR.x + 6}
                y={tipR.y - 4}
                fill={resultantColor}
                fontFamily="'JetBrains Mono', monospace"
                fontSize={11}
                fontWeight={700}
              >
                E
              </text>
            )}
          </g>
        )}

        {/* Scale reference: 10 V/m arrow marker (upper-left inside bench).
            Kept subtle so it doesn't compete with the field vectors. */}
        <g opacity={0.5}>
          <line
            x1={BENCH_X + 14}
            y1={BENCH_Y + 18}
            x2={BENCH_X + 14 + 10 * ARROW_SCALE}
            y2={BENCH_Y + 18}
            stroke="#54617A"
            strokeWidth={1.5}
          />
          <text
            x={BENCH_X + 14 + 10 * ARROW_SCALE + 6}
            y={BENCH_Y + 22}
            fill="#6C7A93"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={9}
          >
            10 V/m
          </text>
        </g>
      </svg>

      {/* HUD overlays (TL / TR / BL). BR is RESERVED — do not add. */}
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
      {hudTR && (
        <div
          style={{
            position: 'absolute',
            top: '3rem',
            right: '28rem',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '2.1rem',
            letterSpacing: '0.08em',
            color: stage1Done ? '#37C9B8' : '#B9C4D6',
            zIndex: 5,
            pointerEvents: 'none',
            textAlign: 'right',
          }}
        >
          {hudTR}
        </div>
      )}
      <div
        style={{
          position: 'absolute',
          bottom: '3rem',
          left: '3rem',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '2.1rem',
          letterSpacing: '0.06em',
          color: peekVisible ? '#F9A968' : '#6C7A93',
          zIndex: 5,
          pointerEvents: 'none',
          maxWidth: '60%',
          lineHeight: 1.35,
        }}
      >
        {hudBL}
      </div>

      {/* Slider column (right side, HTML overlay) */}
      <div
        style={{
          position: 'absolute',
          top: '6rem',
          right: '3rem',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '1.3rem',
          zIndex: 6,
        }}
      >
        <SliderVertical
          label="q1"
          unit="nC"
          value={q1}
          min={Q_MIN}
          max={Q_MAX}
          step={Q_STEP}
          format={(v) =>
            v >= 0 ? `+${v.toFixed(1)}` : `−${Math.abs(v).toFixed(1)}`
          }
          accent={q1Color}
          onChange={(v) => {
            setQ1(v)
            setQ1Min((prev) => Math.min(prev, v))
            setQ1Max((prev) => Math.max(prev, v))
          }}
        />
        <SliderVertical
          label="q2"
          unit="nC"
          value={q2}
          min={Q_MIN}
          max={Q_MAX}
          step={Q_STEP}
          format={(v) =>
            v >= 0 ? `+${v.toFixed(1)}` : `−${Math.abs(v).toFixed(1)}`
          }
          accent={q2Color}
          onChange={(v) => {
            setQ2(v)
            setQ2Min((prev) => Math.min(prev, v))
            setQ2Max((prev) => Math.max(prev, v))
          }}
        />
        <SliderVertical
          label="d"
          unit="m"
          value={d}
          min={D_MIN}
          max={D_MAX}
          step={D_STEP}
          format={(v) => v.toFixed(2)}
          onChange={(v) => {
            setD(v)
            setDMin((prev) => Math.min(prev, v))
            setDMax((prev) => Math.max(prev, v))
          }}
        />
      </div>
    </div>
  )
}

// ─── Slider primitive (adapted from exercises/diffraction) ──
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
        gap: '0.35rem',
      }}
    >
      <div
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '1.4rem',
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
          fontSize: '1.4rem',
          color: '#54617A',
        }}
      >
        {format(min)}
      </div>
      <div
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '1.8rem',
          color: accent,
        }}
      >
        {label} = {format(value)}
        {unit}
      </div>
    </div>
  )
}
