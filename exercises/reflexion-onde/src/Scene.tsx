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
  reflectedAngleDeg,
  SETUPS,
  TOLERANCE_DEG,
  withinTolerance,
} from './physics'

// ─── Scene constants ────────────────────────────────────────────────────
const W = 800
const H = 450

// Barrier pivot (SVG units). Left of center so both incident (upper-left)
// and reflected (variable) rays have room to breathe.
const PIVOT_X = 380
const PIVOT_Y = 225
const BARRIER_HALF = 100          // barrier extends ±100 units along its surface
const RAY_LEN = 190               // principal ray length for incident + reflected
const WAVEFRONT_HALF = 26         // half-length of each perpendicular wavefront tick
const WAVEFRONTS_PER_SIDE = 6     // number of wavefronts drawn on each ray
const MM_TO_SVG = 0.6             // 1 mm wavelength → 0.6 SVG units of tick spacing

// Sliders — physically meaningful ranges
const I_MIN = 20
const I_MAX = 70
const I_DEFAULT = 45
const I_STEP = 1

const ALPHA_MIN = -30
const ALPHA_MAX = 30
const ALPHA_DEFAULT = 0
const ALPHA_STEP = 1

const LAMBDA_MIN = 20
const LAMBDA_MAX = 60
const LAMBDA_DEFAULT = 40
const LAMBDA_STEP = 1

const COVERAGE_MIN_FRAC = 0.5

// ─── Label loader ───────────────────────────────────────────────────────
const dict = { en, fr, ar } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── Trig helpers ───────────────────────────────────────────────────────
const D2R = Math.PI / 180

/** Return the unit vector (screen coords, +x right, +y down) for an angle in degrees. */
function unitFromDeg(deg: number): [number, number] {
  return [Math.cos(deg * D2R), Math.sin(deg * D2R)]
}

// ─── Component ──────────────────────────────────────────────────────────
export default function Scene() {
  const { locale, seed } = useInit()
  const stages = useMemo(() => getStagesFor(locale), [locale])
  useDeclareStages(stages)
  const labels = useMemo(() => svgLabels(locale), [locale])

  const stageIdx = useCurrentStage()
  const setStage = useSetStage()
  const progress = useProgress()
  const complete = useComplete()

  // ─── DOF state ────────────────────────────────────────────────────────
  const [iDeg, setIDeg] = useState<number>(I_DEFAULT)
  const [alphaDeg, setAlphaDeg] = useState<number>(ALPHA_DEFAULT)
  const [lambdaMm, setLambdaMm] = useState<number>(LAMBDA_DEFAULT)
  const [peekVisible, setPeekVisible] = useState(false)
  const peekIdxRef = useRef(0)

  // Coverage tracking (per-slider min/max seen this attempt)
  const [iMinSeen, setIMinSeen] = useState<number>(I_DEFAULT)
  const [iMaxSeen, setIMaxSeen] = useState<number>(I_DEFAULT)
  const [alphaMinSeen, setAlphaMinSeen] = useState<number>(ALPHA_DEFAULT)
  const [alphaMaxSeen, setAlphaMaxSeen] = useState<number>(ALPHA_DEFAULT)
  const [lambdaMinSeen, setLambdaMinSeen] = useState<number>(LAMBDA_DEFAULT)
  const [lambdaMaxSeen, setLambdaMaxSeen] = useState<number>(LAMBDA_DEFAULT)

  // Fail-with-restart on stage 3: rotate to a different setup on miss.
  const failCountRef = useRef(0)
  const [failTick, setFailTick] = useState(0)  // trigger re-render when rotating

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  const setup = useMemo(() => {
    void failTick   // keep dependency
    return SETUPS[(seed + failCountRef.current) % SETUPS.length]!
  }, [seed, failTick])

  const resetStageState = useCallback(() => {
    setIDeg(I_DEFAULT)
    setAlphaDeg(ALPHA_DEFAULT)
    setLambdaMm(LAMBDA_DEFAULT)
    setIMinSeen(I_DEFAULT); setIMaxSeen(I_DEFAULT)
    setAlphaMinSeen(ALPHA_DEFAULT); setAlphaMaxSeen(ALPHA_DEFAULT)
    setLambdaMinSeen(LAMBDA_DEFAULT); setLambdaMaxSeen(LAMBDA_DEFAULT)
    setPeekVisible(false)
    peekIdxRef.current = 0
  }, [])
  useReset(useCallback(() => {
    failCountRef.current = 0
    setFailTick((t) => t + 1)
    resetStageState()
  }, [resetStageState]))

  // ─── Coverage predicate for stage 1 advance ──────────────────────────
  const iCov = (iMaxSeen - iMinSeen) / (I_MAX - I_MIN)
  const alphaCov = (alphaMaxSeen - alphaMinSeen) / (ALPHA_MAX - ALPHA_MIN)
  const lambdaCov = (lambdaMaxSeen - lambdaMinSeen) / (LAMBDA_MAX - LAMBDA_MIN)
  const stage1Done =
    iCov >= COVERAGE_MIN_FRAC &&
    alphaCov >= COVERAGE_MIN_FRAC &&
    lambdaCov >= COVERAGE_MIN_FRAC

  // ─── Reflected direction (feature) ───────────────────────────────────
  const outDeg = reflectedAngleDeg(iDeg, alphaDeg)
  const featureMatch = withinTolerance(outDeg, setup.targetOutDeg)

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
      // Fail-with-restart: rotate to a different seeded setup, reset sliders.
      failCountRef.current += 1
      setFailTick((t) => t + 1)
      resetStageState()
    }
  })

  // ─── Peek (blind stage only, text-only rotation) ─────────────────────
  const peekTips = useMemo(
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

  // ─── Geometry ────────────────────────────────────────────────────────
  // Barrier surface upward direction on screen:
  //   at α = 0  → (0, -1)  (straight up)
  //   at α > 0  → top leans right
  const [barUpX, barUpY] = [Math.sin(alphaDeg * D2R), -Math.cos(alphaDeg * D2R)]
  const barTop: [number, number] = [PIVOT_X + BARRIER_HALF * barUpX, PIVOT_Y + BARRIER_HALF * barUpY]
  const barBot: [number, number] = [PIVOT_X - BARRIER_HALF * barUpX, PIVOT_Y - BARRIER_HALF * barUpY]

  // Barrier normal (into source region):
  //   at α = 0 → (-1, 0)  (points left)
  const nx = -Math.cos(alphaDeg * D2R)
  const ny = -Math.sin(alphaDeg * D2R)

  // Incident propagation vector (from +x, positive = down-right)
  const [dinX, dinY] = unitFromDeg(iDeg)
  // Incident ray "source" endpoint (upstream of pivot)
  const inSrc: [number, number] = [PIVOT_X - RAY_LEN * dinX, PIVOT_Y - RAY_LEN * dinY]

  // Reflected propagation vector
  const [doutX, doutY] = unitFromDeg(outDeg)
  const outEnd: [number, number] = [PIVOT_X + RAY_LEN * doutX, PIVOT_Y + RAY_LEN * doutY]

  // Target reflected direction (drawn on stages 2+3)
  const [tgtX, tgtY] = unitFromDeg(setup.targetOutDeg)
  const targetEnd: [number, number] = [PIVOT_X + RAY_LEN * tgtX, PIVOT_Y + RAY_LEN * tgtY]

  const spacingSvg = Math.max(6, lambdaMm * MM_TO_SVG)

  // Build wavefront tick lines along a principal ray direction.
  // Ticks are perpendicular to (dx, dy) and centered on positions along the ray.
  function wavefrontTicks(
    dx: number,
    dy: number,
    startFromPivot: boolean,
    keyPrefix: string,
    stroke: string,
  ): React.ReactNode[] {
    const perpX = -dy
    const perpY = dx
    const nodes: React.ReactNode[] = []
    for (let k = 0; k < WAVEFRONTS_PER_SIDE; k++) {
      const s = (0.5 + k) * spacingSvg
      if (s > RAY_LEN - 6) break
      // Incident: ticks step BACKWARD from pivot along -d. Reflected: FORWARD along +d.
      const sign = startFromPivot ? 1 : -1
      const cx = PIVOT_X + sign * s * dx
      const cy = PIVOT_Y + sign * s * dy
      const opacity = 1 - k / (WAVEFRONTS_PER_SIDE + 1)
      nodes.push(
        <line
          key={`${keyPrefix}-${k}`}
          x1={cx - WAVEFRONT_HALF * perpX}
          y1={cy - WAVEFRONT_HALF * perpY}
          x2={cx + WAVEFRONT_HALF * perpX}
          y2={cy + WAVEFRONT_HALF * perpY}
          stroke={stroke}
          strokeWidth={1.4}
          opacity={opacity}
        />,
      )
    }
    return nodes
  }

  // Incident wavefronts (upstream side — ticks step backward from pivot).
  const incidentWavefronts = useMemo(
    () => wavefrontTicks(dinX, dinY, false, 'in', '#37C9B8'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dinX, dinY, spacingSvg],
  )
  // Reflected wavefronts (downstream — ticks step forward from pivot).
  const reflectedWavefronts = useMemo(
    () => wavefrontTicks(doutX, doutY, true, 'out', '#F97316'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doutX, doutY, spacingSvg],
  )

  // Coverage badges (only visible on stage 1)
  const coverageBadge =
    `i·${(iCov * 100).toFixed(0)}% α·${(alphaCov * 100).toFixed(0)}% λ·${(lambdaCov * 100).toFixed(0)}%`

  // HUD contents — NO live delta / warmer-colder feedback on stage 3.
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`
  const hudTR = isStage1
    ? coverageBadge
    : isStage2
      ? `r* = ${setup.targetOutDeg.toFixed(0)}°`
      : `r* = ${setup.targetOutDeg.toFixed(0)}°`
  const hudBL = peekVisible
    ? peekTips[(peekIdxRef.current - 1) % peekTips.length]
    : isStage1
      ? labels.tip1
      : isStage2
        ? labels.tip2
        : labels.tip3
  // BR reserved for parent chrome — no overlay.

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block', userSelect: 'none' }}
      >
        {/* Full-canvas dark background. No rx per §4.4. */}
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        {/* Bench frame */}
        <rect x={32} y={60} width={720} height={358} fill="none" stroke="#12203a" strokeWidth={1} rx={6} />
        <text x={40} y={52} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={11} letterSpacing="0.1em">
          {labels.bench}
        </text>

        {/* Barrier surface line */}
        <line
          x1={barTop[0]} y1={barTop[1]}
          x2={barBot[0]} y2={barBot[1]}
          stroke="#B9C4D6" strokeWidth={3}
          strokeLinecap="round"
        />
        {/* Barrier hatching (thin ticks on the non-source side) — visual cue */}
        {Array.from({ length: 8 }).map((_, k) => {
          const t = (k + 0.5) / 8
          const bx = barBot[0] + (barTop[0] - barBot[0]) * t
          const by = barBot[1] + (barTop[1] - barBot[1]) * t
          const hx = bx - 8 * nx
          const hy = by - 8 * ny
          return (
            <line
              key={`h-${k}`}
              x1={bx} y1={by} x2={hx} y2={hy}
              stroke="#3A4863" strokeWidth={1}
            />
          )
        })}
        <text
          x={barTop[0] + 6} y={barTop[1] - 6}
          fill="#54617A"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={10}
        >
          {labels.barrier} · α = {alphaDeg.toFixed(0)}°
        </text>

        {/* Normal indicator (short dashed line, from pivot into source region) */}
        <line
          x1={PIVOT_X} y1={PIVOT_Y}
          x2={PIVOT_X + 34 * nx} y2={PIVOT_Y + 34 * ny}
          stroke="#54617A" strokeWidth={1} strokeDasharray="2 3"
        />
        <text
          x={PIVOT_X + 40 * nx} y={PIVOT_Y + 40 * ny + 3}
          fill="#54617A"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={10}
          textAnchor="middle"
        >
          {labels.normal}
        </text>

        {/* Incident principal ray (always visible — required context) */}
        <line
          x1={inSrc[0]} y1={inSrc[1]}
          x2={PIVOT_X} y2={PIVOT_Y}
          stroke="#37C9B8" strokeWidth={1.2}
          opacity={0.55}
          strokeDasharray="4 3"
        />
        {/* Incident direction arrowhead (near pivot) */}
        {(() => {
          const back = 8
          const hx = PIVOT_X - back * dinX
          const hy = PIVOT_Y - back * dinY
          const px = -dinY, py = dinX
          const w = 4
          return (
            <path
              d={`M ${PIVOT_X} ${PIVOT_Y} L ${hx + w * px} ${hy + w * py} L ${hx - w * px} ${hy - w * py} Z`}
              fill="#37C9B8"
              opacity={0.75}
            />
          )
        })()}
        {/* "source" label near the far end of the incident ray */}
        <text
          x={inSrc[0] - 6 * dinX} y={inSrc[1] - 6 * dinY}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={10}
          textAnchor="middle"
        >
          {labels.source}
        </text>

        {/* Incident wavefronts — hidden on stage 3 (help removed per §4.7) */}
        {!isStage3 && incidentWavefronts}

        {/* Reflected principal ray + wavefronts — hidden on stage 3 */}
        {!isStage3 && (
          <>
            <line
              x1={PIVOT_X} y1={PIVOT_Y}
              x2={outEnd[0]} y2={outEnd[1]}
              stroke="#F97316" strokeWidth={1.2}
              opacity={0.55}
              strokeDasharray="4 3"
            />
            {(() => {
              const forward = 8
              const hx = outEnd[0] - forward * doutX
              const hy = outEnd[1] - forward * doutY
              const px = -doutY, py = doutX
              const w = 4
              return (
                <path
                  d={`M ${outEnd[0]} ${outEnd[1]} L ${hx + w * px} ${hy + w * py} L ${hx - w * px} ${hy - w * py} Z`}
                  fill="#F97316"
                  opacity={0.75}
                />
              )
            })()}
            {reflectedWavefronts}
            <text
              x={outEnd[0] + 6 * doutX} y={outEnd[1] + 6 * doutY + 3}
              fill="#54617A"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
              textAnchor="middle"
            >
              {labels.reflected}
            </text>
          </>
        )}

        {/* Target reflected-direction marker (stages 2 + 3 — required info) */}
        {(isStage2 || isStage3) && (
          <g>
            <line
              x1={PIVOT_X} y1={PIVOT_Y}
              x2={targetEnd[0]} y2={targetEnd[1]}
              stroke="#F9A968" strokeWidth={1.5}
              strokeDasharray="6 5"
              opacity={0.85}
            />
            {(() => {
              const back = 10
              const hx = targetEnd[0] - back * tgtX
              const hy = targetEnd[1] - back * tgtY
              const px = -tgtY, py = tgtX
              const w = 5
              return (
                <path
                  d={`M ${targetEnd[0]} ${targetEnd[1]} L ${hx + w * px} ${hy + w * py} L ${hx - w * px} ${hy - w * py} Z`}
                  fill="#F9A968"
                />
              )
            })()}
            <text
              x={targetEnd[0] + 12 * tgtX} y={targetEnd[1] + 12 * tgtY + 3}
              fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={11}
              textAnchor="middle"
            >
              r* = {setup.targetOutDeg.toFixed(0)}°
            </text>
          </g>
        )}

        {/* Pivot dot (visual anchor) */}
        <circle cx={PIVOT_X} cy={PIVOT_Y} r={2.4} fill="#B9C4D6" />
      </svg>

      {/* HUD overlays — HTML in rem */}
      <div style={{
        position: 'absolute', top: '3rem', left: '3rem',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '2.3rem', letterSpacing: '0.14em',
        textTransform: 'uppercase', color: '#6C7A93',
        zIndex: 5, pointerEvents: 'none',
      }}>
        {hudTL}
      </div>
      <div style={{
        position: 'absolute', top: '3rem', right: '3rem',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '2.3rem', letterSpacing: '0.08em',
        color: isStage1 && stage1Done ? '#37C9B8' : '#B9C4D6',
        zIndex: 5, pointerEvents: 'none', textAlign: 'right',
      }}>
        {hudTR}
      </div>
      <div style={{
        position: 'absolute', bottom: '3rem', left: '3rem',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '2.3rem', letterSpacing: '0.06em',
        color: peekVisible ? '#F9A968' : '#6C7A93',
        zIndex: 5, pointerEvents: 'none', maxWidth: '48%',
      }}>
        {hudBL}
      </div>
      {/* BR reserved for parent chrome — intentionally no overlay here. */}

      {/* ─── Slider column (right side) ─────────────────────────────── */}
      <div style={{
        position: 'absolute',
        top: '6rem', right: '3rem',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', gap: '1.5rem',
        zIndex: 6,
      }}>
        <SliderVertical
          label="i"
          unit="°"
          value={iDeg}
          min={I_MIN} max={I_MAX} step={I_STEP}
          format={(v) => v.toFixed(0)}
          onChange={(v) => {
            setIDeg(v)
            setIMinSeen((p) => Math.min(p, v))
            setIMaxSeen((p) => Math.max(p, v))
          }}
        />
        <SliderVertical
          label="α"
          unit="°"
          value={alphaDeg}
          min={ALPHA_MIN} max={ALPHA_MAX} step={ALPHA_STEP}
          format={(v) => v.toFixed(0)}
          onChange={(v) => {
            setAlphaDeg(v)
            setAlphaMinSeen((p) => Math.min(p, v))
            setAlphaMaxSeen((p) => Math.max(p, v))
          }}
        />
        <SliderVertical
          label="λ"
          unit="mm"
          value={lambdaMm}
          min={LAMBDA_MIN} max={LAMBDA_MAX} step={LAMBDA_STEP}
          format={(v) => v.toFixed(0)}
          onChange={(v) => {
            setLambdaMm(v)
            setLambdaMinSeen((p) => Math.min(p, v))
            setLambdaMaxSeen((p) => Math.max(p, v))
          }}
        />
      </div>

      {/* Reference: tolerance appears in nowhere-visible location; single-submit
          semantics are enforced inside useNext above. TOLERANCE_DEG is imported
          only to keep the physics module's contract honored. */}
      <span style={{ display: 'none' }}>{TOLERANCE_DEG}</span>
    </div>
  )
}

// ─── Slider primitive ────────────────────────────────────────────────────
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
        {format(max)}{unit}
      </div>
      <div style={{ width: '2.5rem', height: '14rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.5rem', color: '#54617A' }}>
        {format(min)}{unit}
      </div>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.9rem', color: accent }}>
        {label} = {format(value)}{unit}
      </div>
    </div>
  )
}
