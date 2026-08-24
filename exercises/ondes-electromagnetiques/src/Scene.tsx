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
  C,
  E0_DEFAULT,
  E0_MAX,
  E0_MIN,
  formatFrequency,
  formatLambda,
  frequencyFromS,
  S_DEFAULT,
  S_MAX,
  S_MIN,
  SETUPS,
  THETA_DEFAULT,
  THETA_MAX,
  THETA_MIN,
  TOLERANCE,
  lambdaMatchesTol,
  wavelengthFromS,
} from './physics'

// ─── Scene constants ────────────────────────────────────────────
const W = 800
const H = 450

// Wave visualization region (top)
const VIZ_X_LEFT = 60
const VIZ_X_RIGHT = 660
const VIZ_WIDTH = VIZ_X_RIGHT - VIZ_X_LEFT // 600
const VIZ_Y_CENTER = 155
const VIZ_AMP_MAX = 55 // px, full vertical swing at E_0 = E0_MAX

// Spectrum band region (bottom)
const BAND_X_LEFT = 60
const BAND_X_RIGHT = 660
const BAND_WIDTH = BAND_X_RIGHT - BAND_X_LEFT // 600
const BAND_Y_TOP = 300
const BAND_Y_BOT = 350
const BAND_HEIGHT = BAND_Y_BOT - BAND_Y_TOP

// Log-scale mapping: λ ∈ [3e-10, 30] m maps linearly to x ∈ [BAND_X_RIGHT, BAND_X_LEFT]
const LOG_LAMBDA_MAX = Math.log10(C / frequencyFromS(S_MIN)) // = log10(30) ≈ 1.477
const LOG_LAMBDA_RANGE = S_MAX - S_MIN // 11 (since Δlog10(λ) = -Δlog10(f))

function lambdaToBandX(lambda: number): number {
  const logL = Math.log10(lambda)
  const t = (LOG_LAMBDA_MAX - logL) / LOG_LAMBDA_RANGE
  return BAND_X_LEFT + t * BAND_WIDTH
}

// Named spectrum bands (boundaries in meters, converted to x once)
type Band = { xL: number; xR: number; fill: string; labelKey: string }
const BANDS: Band[] = [
  { // radio: 30 m → 1 m
    xL: lambdaToBandX(30),
    xR: lambdaToBandX(1),
    fill: '#2C3E5C',
    labelKey: 'band_radio',
  },
  { // microwave: 1 m → 1 mm
    xL: lambdaToBandX(1),
    xR: lambdaToBandX(1e-3),
    fill: '#3D3A6B',
    labelKey: 'band_microwave',
  },
  { // infrared: 1 mm → 780 nm
    xL: lambdaToBandX(1e-3),
    xR: lambdaToBandX(780e-9),
    fill: '#8A3A20',
    labelKey: 'band_infrared',
  },
  { // visible: 780 nm → 380 nm  (rainbow, painted with linearGradient)
    xL: lambdaToBandX(780e-9),
    xR: lambdaToBandX(380e-9),
    fill: 'url(#visibleGrad)',
    labelKey: 'band_visible',
  },
  { // uv: 380 nm → 10 nm
    xL: lambdaToBandX(380e-9),
    xR: lambdaToBandX(10e-9),
    fill: '#4A22A0',
    labelKey: 'band_uv',
  },
  { // x-ray: 10 nm → 3e-10 m  (clip to band right edge)
    xL: lambdaToBandX(10e-9),
    xR: BAND_X_RIGHT,
    fill: '#9C22A0',
    labelKey: 'band_xray',
  },
]

// Slider-coverage threshold for stage 1 advance
const COVERAGE_MIN_FRAC = 0.5

const dict = { en } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── Component ──────────────────────────────────────────────────
export default function Scene() {
  const { locale, seed } = useInit()
  const stages = useMemo(() => getStagesFor(locale), [locale])
  useDeclareStages(stages)
  const labels = useMemo(() => svgLabels(locale), [locale])

  const failCountRef = useRef(0)
  const [failTick, setFailTick] = useState(0)
  const setup = useMemo(
    () => SETUPS[(seed + failCountRef.current) % SETUPS.length]!,
    [seed, failTick],
  )

  const stageIdx = useCurrentStage()
  const setStage = useSetStage()
  const progress = useProgress()
  const complete = useComplete()

  // ─── DOF state ────────────────────────────────────────────
  const [sVal, setSVal] = useState(S_DEFAULT) // log10(f)
  const [e0, setE0] = useState(E0_DEFAULT)
  const [theta, setTheta] = useState(THETA_DEFAULT)
  const [peekVisible, setPeekVisible] = useState(false)

  // Stage 1 coverage — track [min, max] per slider
  const [sMinSeen, setSMinSeen] = useState(S_DEFAULT)
  const [sMaxSeen, setSMaxSeen] = useState(S_DEFAULT)
  const [e0MinSeen, setE0MinSeen] = useState(E0_DEFAULT)
  const [e0MaxSeen, setE0MaxSeen] = useState(E0_DEFAULT)
  const [thMinSeen, setThMinSeen] = useState(THETA_DEFAULT)
  const [thMaxSeen, setThMaxSeen] = useState(THETA_DEFAULT)

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  const resetStageState = useCallback(() => {
    setSVal(S_DEFAULT)
    setE0(E0_DEFAULT)
    setTheta(THETA_DEFAULT)
    setSMinSeen(S_DEFAULT); setSMaxSeen(S_DEFAULT)
    setE0MinSeen(E0_DEFAULT); setE0MaxSeen(E0_DEFAULT)
    setThMinSeen(THETA_DEFAULT); setThMaxSeen(THETA_DEFAULT)
    setPeekVisible(false)
  }, [])
  useReset(() => {
    failCountRef.current = 0
    setFailTick((t) => t + 1)
    resetStageState()
  })

  // ─── Current physics values ───────────────────────────────
  const f = frequencyFromS(sVal)
  const lambda = wavelengthFromS(sVal)

  // ─── Coverage predicate (stage 1) ─────────────────────────
  const covS = (sMaxSeen - sMinSeen) / (S_MAX - S_MIN)
  const covE = (e0MaxSeen - e0MinSeen) / (E0_MAX - E0_MIN)
  const covT = (thMaxSeen - thMinSeen) / (THETA_MAX - THETA_MIN)
  const stage1Done =
    covS >= COVERAGE_MIN_FRAC &&
    covE >= COVERAGE_MIN_FRAC &&
    covT >= COVERAGE_MIN_FRAC

  // ─── Match check (stage 2 live; stage 3 only at submit) ───
  const stage2Match = lambdaMatchesTol(lambda, setup.lambdaTarget)

  // canSubmit gates the chrome Next button. Stage 3 must NOT depend on
  // stage3Match — that would leak "getting warmer" info before submit.
  const canSubmit = isStage1
    ? stage1Done
    : isStage2
      ? stage2Match
      : true // stage 3: always submittable; verdict happens on Next-click

  useEffect(() => {
    progress(stageIdx / 3, { stage: stageIdx, canSubmit })
  }, [stageIdx, canSubmit, progress])

  useNext(() => {
    if (stageIdx < 3) {
      setStage(stageIdx + 1)
      resetStageState()
    } else {
      // Blind-stage single-submit: check NOW, not before.
      if (lambdaMatchesTol(lambda, setup.lambdaTarget)) {
        complete({ success: true })
      } else {
        // Fail-with-restart: rotate to next seeded setup, reset DOFs.
        failCountRef.current += 1
        setFailTick((t) => t + 1)
        resetStageState()
      }
    }
  })

  // ─── Peek (blind stage only, TEXT only, no rendering reveal) ──
  const peekIdxRef = useRef(0)
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

  // ─── Wave path builders (E and B) ─────────────────────────
  // Display period count scales with log10(f) — more oscillations at higher f.
  // This is a *display* effect only (real λ is off-scale on both ends).
  const nPeriods = 1 + 7 * ((sVal - S_MIN) / (S_MAX - S_MIN))
  const thetaRad = (theta * Math.PI) / 180
  const eAmp = (e0 / E0_MAX) * VIZ_AMP_MAX * Math.cos(thetaRad)
  // B in this display represents E's out-of-plane rotational component so the
  // student sees polarization affecting BOTH curves. |cB| = |E| in vacuum, so
  // the total oscillation energy stays constant as θ_p rotates.
  const bAmp = (e0 / E0_MAX) * VIZ_AMP_MAX * Math.sin(thetaRad)

  const wavePath = useMemo(() => {
    if (isStage3) return { e: '', b: '' }
    const SAMPLES = 240
    let ePath = ''
    let bPath = ''
    for (let i = 0; i <= SAMPLES; i++) {
      const t = i / SAMPLES
      const x = VIZ_X_LEFT + t * VIZ_WIDTH
      const phase = 2 * Math.PI * nPeriods * t
      const eY = VIZ_Y_CENTER - eAmp * Math.sin(phase)
      const bY = VIZ_Y_CENTER + bAmp * Math.sin(phase)
      ePath += `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${eY.toFixed(2)} `
      bPath += `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${bY.toFixed(2)} `
    }
    return { e: ePath.trim(), b: bPath.trim() }
  }, [isStage3, nPeriods, eAmp, bAmp])

  // ─── HUD text ─────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`

  // TR: coverage on stage 1; live readout on stage 2; readout only on stage 3.
  // Stage 3 must NOT show match status (§4.7 rule 3).
  const hudTR = isStage1
    ? `f·${(covS * 100).toFixed(0)}% E·${(covE * 100).toFixed(0)}% Θ·${(covT * 100).toFixed(0)}%`
    : isStage2
      ? stage2Match
        ? `✓ ${labels.match_ok}`
        : `λ = ${formatLambda(lambda)}`
      : `λ = ${formatLambda(lambda)}` // stage 3: readout only, no verdict

  const hudBL = peekVisible
    ? peekIdxRef.current % 2 === 1
      ? labels.peek_tip_formula
      : labels.peek_tip_anchor
    : isStage1
      ? labels.tip1
      : isStage2
        ? labels.tip2
        : labels.tip3
  // BR — reserved for parent-side chrome (fullscreen). Do NOT render here.

  // ─── Marker positions ─────────────────────────────────────
  const targetX = lambdaToBandX(setup.lambdaTarget)
  const currentBandX = lambdaToBandX(lambda)
  const targetBandLabel = (labels as Record<string, string>)[setup.labelKey] ?? ''

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block', userSelect: 'none' }}
      >
        <defs>
          {/* Visible-light rainbow gradient. Long-λ (red) on the LEFT to match
              the band's log-λ axis where λ decreases left-to-right. */}
          <linearGradient id="visibleGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#ff2020" />
            <stop offset="20%" stopColor="#ff8000" />
            <stop offset="35%" stopColor="#ffff00" />
            <stop offset="55%" stopColor="#40d040" />
            <stop offset="75%" stopColor="#2080ff" />
            <stop offset="100%" stopColor="#8020ff" />
          </linearGradient>
        </defs>

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
          {labels.bench}
        </text>

        {/* ─── Wave viz region ────────────────────────────── */}
        {/* z-axis (propagation direction) */}
        <line
          x1={VIZ_X_LEFT}
          y1={VIZ_Y_CENTER}
          x2={VIZ_X_RIGHT}
          y2={VIZ_Y_CENTER}
          stroke="#2A3654"
          strokeWidth={1}
          strokeDasharray="2 4"
        />
        <text
          x={VIZ_X_RIGHT + 6}
          y={VIZ_Y_CENTER + 3}
          fill="#54617A"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={9}
        >
          {labels.propagation}
        </text>

        {/* Wave curves (stages 1 & 2 only) */}
        {!isStage3 && (
          <g>
            {bAmp !== 0 && (
              <path
                d={wavePath.b}
                fill="none"
                stroke="#3E8DF0"
                strokeWidth={1.5}
                opacity={0.85}
              />
            )}
            {eAmp !== 0 && (
              <path
                d={wavePath.e}
                fill="none"
                stroke="#F03A3A"
                strokeWidth={1.8}
              />
            )}
            {/* Field labels near the crest at first quarter-period */}
            <text
              x={VIZ_X_LEFT + 8}
              y={VIZ_Y_CENTER - VIZ_AMP_MAX - 4}
              fill="#F03A3A"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={11}
            >
              {labels.e_field}
            </text>
            <text
              x={VIZ_X_LEFT + 8}
              y={VIZ_Y_CENTER + VIZ_AMP_MAX + 12}
              fill="#3E8DF0"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={11}
            >
              {labels.b_field}
            </text>
          </g>
        )}

        {/* Polarization compass — top-right of viz region.
            Hidden on stage 3 (helps interpret polarization). */}
        {!isStage3 && (
          <g transform={`translate(${VIZ_X_RIGHT - 40}, ${VIZ_Y_CENTER - 65})`}>
            <circle cx={0} cy={0} r={16} fill="#0D1524" stroke="#2A3654" strokeWidth={1} />
            <line
              x1={0}
              y1={0}
              x2={14 * Math.cos((theta - 90) * Math.PI / 180)}
              y2={14 * Math.sin((theta - 90) * Math.PI / 180)}
              stroke="#F03A3A"
              strokeWidth={2}
              strokeLinecap="round"
            />
            <text
              x={0}
              y={30}
              fill="#54617A"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={8}
              textAnchor="middle"
            >
              θp = {theta.toFixed(0)}°
            </text>
          </g>
        )}

        {/* ─── Spectrum band ─────────────────────────────── */}
        <text
          x={BAND_X_LEFT}
          y={BAND_Y_TOP - 12}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={10}
          letterSpacing="0.08em"
        >
          {labels.spectrum}
        </text>

        {/* Band rectangles — hidden on stage 3 (band coloring is the primary
            visual "help" that shows which band a λ falls into). */}
        {!isStage3 && (
          <g>
            {BANDS.map((band, i) => (
              <rect
                key={i}
                x={band.xL}
                y={BAND_Y_TOP}
                width={Math.max(band.xR - band.xL, 0)}
                height={BAND_HEIGHT}
                fill={band.fill}
                opacity={0.85}
              />
            ))}
            {BANDS.map((band, i) => {
              const cx = (band.xL + band.xR) / 2
              const wide = band.xR - band.xL > 40
              if (!wide) return null
              return (
                <text
                  key={`lbl${i}`}
                  x={cx}
                  y={BAND_Y_BOT + 12}
                  fill="#54617A"
                  fontFamily="'JetBrains Mono', monospace"
                  fontSize={9}
                  textAnchor="middle"
                >
                  {(labels as Record<string, string>)[band.labelKey]}
                </text>
              )
            })}
          </g>
        )}

        {/* Empty band outline on stage 3 (silhouette + λ axis ticks). */}
        {isStage3 && (
          <g>
            <rect
              x={BAND_X_LEFT}
              y={BAND_Y_TOP}
              width={BAND_WIDTH}
              height={BAND_HEIGHT}
              fill="none"
              stroke="#12203a"
              strokeWidth={1}
            />
            {/* Log-decade tick marks — required info: student needs the axis. */}
            {[1, -2, -5, -8].map((decade) => {
              const tickLambda = Math.pow(10, decade)
              const x = lambdaToBandX(tickLambda)
              if (x < BAND_X_LEFT - 2 || x > BAND_X_RIGHT + 2) return null
              return (
                <g key={decade}>
                  <line
                    x1={x}
                    y1={BAND_Y_BOT}
                    x2={x}
                    y2={BAND_Y_BOT + 4}
                    stroke="#2A3654"
                    strokeWidth={1}
                  />
                  <text
                    x={x}
                    y={BAND_Y_BOT + 14}
                    fill="#54617A"
                    fontFamily="'JetBrains Mono', monospace"
                    fontSize={8}
                    textAnchor="middle"
                  >
                    10^{decade} m
                  </text>
                </g>
              )
            })}
          </g>
        )}

        {/* Current-λ marker (stages 1 & 2 only) — moves with the f slider. */}
        {!isStage3 && (
          <g>
            <polygon
              points={`${currentBandX},${BAND_Y_TOP - 8} ${currentBandX - 5},${BAND_Y_TOP - 2} ${currentBandX + 5},${BAND_Y_TOP - 2}`}
              fill="#37C9B8"
            />
            <line
              x1={currentBandX}
              y1={BAND_Y_TOP}
              x2={currentBandX}
              y2={BAND_Y_BOT}
              stroke="#37C9B8"
              strokeWidth={1}
              opacity={0.6}
            />
          </g>
        )}

        {/* Target-λ marker (stages 2 & 3) — dashed line + λ* label. */}
        {(isStage2 || isStage3) && (
          <g>
            <line
              x1={targetX}
              y1={BAND_Y_TOP - 6}
              x2={targetX}
              y2={BAND_Y_BOT + 6}
              stroke="#F97316"
              strokeWidth={1.5}
              strokeDasharray="4 4"
            />
            <text
              x={targetX}
              y={BAND_Y_TOP - 10}
              fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
              textAnchor="middle"
            >
              λ*
            </text>
            <text
              x={targetX}
              y={BAND_Y_BOT + 26}
              fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
              textAnchor="middle"
            >
              {formatLambda(setup.lambdaTarget)}
            </text>
            {targetBandLabel && (
              <text
                x={targetX}
                y={BAND_Y_BOT + 38}
                fill="#54617A"
                fontFamily="'JetBrains Mono', monospace"
                fontSize={9}
                textAnchor="middle"
              >
                ({targetBandLabel})
              </text>
            )}
          </g>
        )}

        {/* Tolerance hint on stage 3: show ±5% window as pale ticks around
            the target — required info so student knows how tight the check is.
            Not "getting warmer" feedback (doesn't move with slider). */}
        {isStage3 && (
          <g>
            {[1 - TOLERANCE, 1 + TOLERANCE].map((k) => {
              const x = lambdaToBandX(setup.lambdaTarget * k)
              return (
                <line
                  key={k}
                  x1={x}
                  y1={BAND_Y_TOP + 4}
                  x2={x}
                  y2={BAND_Y_BOT - 4}
                  stroke="#F97316"
                  strokeWidth={0.7}
                  opacity={0.35}
                  strokeDasharray="2 3"
                />
              )
            })}
          </g>
        )}
      </svg>

      {/* HUD overlays (TL / TR / BL — BR reserved for chrome) */}
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
          color: isStage2 && stage2Match ? '#37C9B8' : '#B9C4D6',
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

      {/* ─── Slider column (right side, HTML overlay) ──── */}
      <div
        style={{
          position: 'absolute',
          top: '6rem',
          right: '3rem',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '1.5rem',
          zIndex: 6,
        }}
      >
        <SliderVertical
          label="f"
          unit=""
          value={sVal}
          min={S_MIN}
          max={S_MAX}
          step={0.01}
          format={() => formatFrequency(f)}
          formatEdge={(v) => `10^${v.toFixed(0)}`}
          onChange={(v) => {
            setSVal(v)
            setSMinSeen((prev) => Math.min(prev, v))
            setSMaxSeen((prev) => Math.max(prev, v))
          }}
        />
        <SliderVertical
          label="E₀"
          unit="V/m"
          value={e0}
          min={E0_MIN}
          max={E0_MAX}
          step={0.1}
          format={(v) => v.toFixed(1)}
          onChange={(v) => {
            setE0(v)
            setE0MinSeen((prev) => Math.min(prev, v))
            setE0MaxSeen((prev) => Math.max(prev, v))
          }}
        />
        <SliderVertical
          label="θp"
          unit="°"
          value={theta}
          min={THETA_MIN}
          max={THETA_MAX}
          step={1}
          format={(v) => v.toFixed(0)}
          onChange={(v) => {
            setTheta(v)
            setThMinSeen((prev) => Math.min(prev, v))
            setThMaxSeen((prev) => Math.max(prev, v))
          }}
        />
      </div>
    </div>
  )
}

// ─── Slider primitive ─────────────────────────────────────────────
function SliderVertical({
  label,
  unit,
  value,
  min,
  max,
  step,
  format,
  formatEdge,
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
  formatEdge?: (v: number) => string
  onChange: (v: number) => void
  accent?: string
}) {
  const edge = formatEdge ?? format
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.4rem' }}>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.5rem', color: '#54617A' }}>
        {edge(max)}
      </div>
      <div
        style={{
          width: '2.5rem',
          height: '11rem',
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
            width: '11rem',
            height: '2.2rem',
            transform: 'rotate(-90deg)',
            transformOrigin: 'center',
            accentColor: accent,
            cursor: 'pointer',
          }}
        />
      </div>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.5rem', color: '#54617A' }}>
        {edge(min)}
      </div>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.7rem', color: accent }}>
        {label} = {format(value)}
        {unit}
      </div>
    </div>
  )
}
