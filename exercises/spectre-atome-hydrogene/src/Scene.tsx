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
  NF_DEFAULT,
  NF_MAX,
  NF_MIN,
  NI_DEFAULT,
  NI_MAX,
  NI_MIN,
  pickSetup,
  seriesName,
  spectralBand,
  transitionEnergyEv,
  transitionMatches,
  transitionWavelengthNm,
} from './physics'
import { wavelengthCss } from './wavelengthToRgb'

// ─── Scene constants ────────────────────────────────────────────────────
const W = 800
const H = 450

// Energy-diagram geometry (SVG units)
const DIAG_X0 = 60
const DIAG_X1 = 320
const DIAG_Y_TOP = 78     // ionization (E = 0)
const DIAG_Y_BOT = 380    // ground state (E = -13.6 eV)
const N_LEVELS = 7        // draw n = 1..7

// Spectrum strip geometry
const STRIP_X0 = 348
const STRIP_X1 = 632
const STRIP_Y = 226
const STRIP_H = 34
const LAMBDA_VIS_MIN = 380
const LAMBDA_VIS_MAX = 750

// Coverage threshold for stage 1 advance
const COVERAGE_MIN_FRAC = 0.5

const dict = { en, fr, ar } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── Utilities ──────────────────────────────────────────────────────────
/** y coordinate of level n in the energy diagram (linear in E). */
function levelY(n: number): number {
  // E_n = -13.6/n²  → normalised t = 1 - 1/n²  (0 at ground, 1 at ionisation)
  const t = 1 - 1 / (n * n)
  return DIAG_Y_BOT - t * (DIAG_Y_BOT - DIAG_Y_TOP)
}

/** Maps a wavelength (nm) to an x coordinate inside the visible spectrum strip. */
function strixXForLambda(nm: number): number {
  const clamped = Math.max(LAMBDA_VIS_MIN, Math.min(LAMBDA_VIS_MAX, nm))
  const t = (clamped - LAMBDA_VIS_MIN) / (LAMBDA_VIS_MAX - LAMBDA_VIS_MIN)
  return STRIP_X0 + t * (STRIP_X1 - STRIP_X0)
}

function formatLambda(nm: number): string {
  if (nm < 10) return `${nm.toFixed(3)}nm`
  if (nm < 1000) return `${nm.toFixed(1)}nm`
  return `${(nm / 1000).toFixed(2)}µm`
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

  // Slider state
  const [nI, setNI] = useState(NI_DEFAULT)
  const [nF, setNF] = useState(NF_DEFAULT)
  const [peekVisible, setPeekVisible] = useState(false)

  // Stage 1 coverage tracking
  const [nIMin, setNIMin] = useState(NI_DEFAULT)
  const [nIMax, setNIMax] = useState(NI_DEFAULT)
  const [nFMin, setNFMin] = useState(NF_DEFAULT)
  const [nFMax, setNFMax] = useState(NF_DEFAULT)

  // Stage 3 fail-with-restart rotation
  const failCountRef = useRef(0)
  const peekIdxRef = useRef(0)

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  // Setup selected by seed (stage 2 uses seed, stage 3 uses seed + failCount + 1
  // so a stage-3 failure rotates to a different physical target).
  const stage2Setup = useMemo(() => pickSetup(seed, 0), [seed])
  const [stage3FailTick, setStage3FailTick] = useState(0)
  const stage3Setup = useMemo(
    () => pickSetup(seed + 1, stage3FailTick),
    [seed, stage3FailTick],
  )

  const resetStageState = useCallback(() => {
    setNI(NI_DEFAULT)
    setNF(NF_DEFAULT)
    setNIMin(NI_DEFAULT); setNIMax(NI_DEFAULT)
    setNFMin(NF_DEFAULT); setNFMax(NF_DEFAULT)
    setPeekVisible(false)
  }, [])
  useReset(() => {
    resetStageState()
    failCountRef.current = 0
    setStage3FailTick(0)
  })

  // ─── Coverage (stage 1 advance predicate) ─────────────────────────────
  const covNi = (nIMax - nIMin) / (NI_MAX - NI_MIN)
  const covNf = (nFMax - nFMin) / (NF_MAX - NF_MIN)
  const stage1Done = covNi >= COVERAGE_MIN_FRAC && covNf >= COVERAGE_MIN_FRAC

  // ─── Feature: emitted wavelength ──────────────────────────────────────
  const validTransition = nI > nF
  const lambdaNm = validTransition ? transitionWavelengthNm(nI, nF)! : null
  const deltaE = validTransition ? transitionEnergyEv(nI, nF) : null
  const currentSeries = seriesName(nF)

  // Match check
  const stage2Match = validTransition && transitionMatches(nI, nF, stage2Setup)
  const stage3Match = validTransition && transitionMatches(nI, nF, stage3Setup)

  const canSubmit = isStage1 ? stage1Done : isStage2 ? stage2Match : true // stage 3 always allows submit; wrong → rotate

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
      // Wrong answer → rotate to a new seeded target, reset sliders.
      failCountRef.current += 1
      setStage3FailTick((t) => t + 1)
      resetStageState()
    }
  })

  // ─── Peek (blind stage only — strategy hint, never the rendering) ─────
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

  // ─── Derived UI values ────────────────────────────────────────────────
  const showSpectrum = !isStage3   // §5.2: continuous vis hidden on stage 3
  const activeSetup = isStage3 ? stage3Setup : stage2Setup
  const targetLambda = activeSetup.targetLambdaNm
  const targetBand = activeSetup.band
  const targetXStrip = strixXForLambda(targetLambda)
  const targetInStrip = targetLambda >= LAMBDA_VIS_MIN && targetLambda <= LAMBDA_VIS_MAX

  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`
  const hudTR = isStage1
    ? `ni·${(covNi * 100).toFixed(0)}% nf·${(covNf * 100).toFixed(0)}%`
    : isStage3
      ? `ni = ${nI} · nf = ${nF}`   // required info; no live λ readout
      : validTransition
        ? `λ = ${formatLambda(lambdaNm!)} · ΔE = ${deltaE!.toFixed(2)} eV`
        : labels.invalid_transition
  const hudBL = peekVisible
    ? PEEK_TIPS[(peekIdxRef.current - 1) % PEEK_TIPS.length]!
    : (isStage1 ? labels.tip1 : isStage2 ? labels.tip2 : labels.tip3)

  // ─── Spectrum strip (SVG gradient + sampled rects for visible band) ───
  // Rendered as one gradient <rect> — vector, no Canvas 2D DPR dance.
  const stripStops = useMemo(() => {
    const stops: { offset: number; color: string }[] = []
    const N = 24
    for (let i = 0; i <= N; i++) {
      const t = i / N
      const nm = LAMBDA_VIS_MIN + t * (LAMBDA_VIS_MAX - LAMBDA_VIS_MIN)
      stops.push({ offset: t, color: wavelengthCss(nm, 0.95) })
    }
    return stops
  }, [])

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block', userSelect: 'none' }}
      >
        <defs>
          <linearGradient id="spectrumGrad" x1="0" y1="0" x2="1" y2="0">
            {stripStops.map((s) => (
              <stop key={s.offset} offset={s.offset} stopColor={s.color} />
            ))}
          </linearGradient>
        </defs>

        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        {/* ─── Left panel: energy-level diagram ─────────────────────── */}
        <rect
          x={32} y={60} width={320} height={358}
          fill="none" stroke="#12203a" strokeWidth={1} rx={6}
        />
        <text
          x={40} y={52} fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={11} letterSpacing="0.1em"
        >
          {labels.diagram_label}
        </text>

        {/* Ionisation line (E = 0) */}
        <line
          x1={DIAG_X0 - 4} y1={DIAG_Y_TOP} x2={DIAG_X1 + 4} y2={DIAG_Y_TOP}
          stroke="#54617A" strokeWidth={1} strokeDasharray="3 3"
        />
        <text
          x={DIAG_X1 + 8} y={DIAG_Y_TOP + 3}
          fill="#54617A" fontFamily="'JetBrains Mono', monospace" fontSize={9}
        >
          n = ∞ · 0 eV
        </text>

        {/* Level lines n = 1..7 */}
        {Array.from({ length: N_LEVELS }, (_, i) => {
          const n = i + 1
          const y = levelY(n)
          const E = -13.6 / (n * n)
          const isNi = validTransition && n === nI && !isStage3
          const isNf = validTransition && n === nF && !isStage3
          const emphasise = isNi || isNf
          return (
            <g key={`lvl-${n}`}>
              <line
                x1={DIAG_X0} y1={y} x2={DIAG_X1} y2={y}
                stroke={emphasise ? '#37C9B8' : '#3A4863'}
                strokeWidth={emphasise ? 2 : 1}
              />
              <text
                x={DIAG_X0 - 8} y={y + 3}
                fill={emphasise ? '#37C9B8' : '#6C7A93'}
                fontFamily="'JetBrains Mono', monospace"
                fontSize={10} textAnchor="end"
              >
                n={n}
              </text>
              <text
                x={DIAG_X1 + 6} y={y + 3}
                fill="#54617A"
                fontFamily="'JetBrains Mono', monospace"
                fontSize={9}
              >
                {E.toFixed(n <= 3 ? 2 : 3)}
              </text>
            </g>
          )
        })}

        {/* Series markers along the left edge for n_f = 1, 2, 3 */}
        {[1, 2, 3].map((nf) => {
          const y = levelY(nf)
          const color = nf === 1 ? '#B48CE6' : nf === 2 ? '#7ADCC9' : '#F0A46A'
          const name = nf === 1 ? labels.series_lyman
            : nf === 2 ? labels.series_balmer
              : labels.series_paschen
          return (
            <text
              key={`series-${nf}`}
              x={DIAG_X0 - 34} y={y - 3}
              fill={color}
              fontFamily="'JetBrains Mono', monospace"
              fontSize={8} textAnchor="start" opacity={0.8}
            >
              {name.slice(0, 3)}
            </text>
          )
        })}

        {/* Transition arrow (stages 1 & 2 only — it visualises ΔE) */}
        {validTransition && !isStage3 && (() => {
          const y1 = levelY(nI)
          const y2 = levelY(nF)
          const x = DIAG_X0 + 90
          const arrowColor = lambdaNm
            ? spectralBand(lambdaNm) === 'visible'
              ? wavelengthCss(lambdaNm, 1)
              : spectralBand(lambdaNm) === 'UV'
                ? '#B48CE6'
                : '#F0A46A'
            : '#37C9B8'
          return (
            <g>
              <defs>
                <marker
                  id="arr-down" viewBox="0 0 10 10"
                  refX={5} refY={9} markerWidth={7} markerHeight={7}
                  orient="auto"
                >
                  <path d="M0,0 L5,9 L10,0 Z" fill={arrowColor} />
                </marker>
              </defs>
              <line
                x1={x} y1={y1} x2={x} y2={y2 - 2}
                stroke={arrowColor} strokeWidth={2}
                markerEnd="url(#arr-down)"
                opacity={0.9}
              />
              <text
                x={x + 8} y={(y1 + y2) / 2 + 3}
                fill={arrowColor}
                fontFamily="'JetBrains Mono', monospace"
                fontSize={9}
              >
                ΔE = {deltaE!.toFixed(2)}eV
              </text>
              <text
                x={x + 8} y={(y1 + y2) / 2 + 14}
                fill="#B9C4D6"
                fontFamily="'JetBrains Mono', monospace"
                fontSize={9}
              >
                {currentSeries}
              </text>
            </g>
          )
        })()}

        {/* Stage 3: series band on diagram is silent — user must reason.  */}
        {isStage3 && (
          <text
            x={DIAG_X0 + 90} y={DIAG_Y_TOP + 40}
            fill="#6C7A93"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={9}
          >
            (transition hidden)
          </text>
        )}

        {/* ─── Middle panel: spectrum strip (hidden on stage 3) ─────── */}
        <rect
          x={340} y={72} width={300} height={340}
          fill="none" stroke="#12203a" strokeWidth={1} rx={6}
        />
        <text
          x={348} y={64} fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={11} letterSpacing="0.1em"
        >
          {labels.spectrum_label}
        </text>

        {/* Continuous visualisation — the "help" per §4.7. Hidden on stage 3. */}
        {showSpectrum && (
          <g>
            {/* UV bracket */}
            <rect
              x={STRIP_X0 - 20} y={STRIP_Y} width={20} height={STRIP_H}
              fill="#1A1230" stroke="#2A3654" strokeWidth={0.5}
            />
            <text
              x={STRIP_X0 - 10} y={STRIP_Y + STRIP_H + 12}
              fill="#8467B5"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={9} textAnchor="middle"
            >
              {labels.band_uv}
            </text>

            {/* Visible band */}
            <rect
              x={STRIP_X0} y={STRIP_Y} width={STRIP_X1 - STRIP_X0} height={STRIP_H}
              fill="url(#spectrumGrad)" stroke="#2A3654" strokeWidth={0.5}
            />
            <text
              x={(STRIP_X0 + STRIP_X1) / 2} y={STRIP_Y + STRIP_H + 12}
              fill="#B9C4D6"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={9} textAnchor="middle"
            >
              {labels.band_vis}  380–750nm
            </text>

            {/* IR bracket */}
            <rect
              x={STRIP_X1} y={STRIP_Y} width={20} height={STRIP_H}
              fill="#2B1010" stroke="#2A3654" strokeWidth={0.5}
            />
            <text
              x={STRIP_X1 + 10} y={STRIP_Y + STRIP_H + 12}
              fill="#C77A5A"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={9} textAnchor="middle"
            >
              {labels.band_ir}
            </text>

            {/* Live emission-line marker */}
            {validTransition && lambdaNm !== null && (() => {
              const band = spectralBand(lambdaNm)
              let markerX: number
              let markerColor: string
              if (band === 'visible') {
                markerX = strixXForLambda(lambdaNm)
                markerColor = wavelengthCss(lambdaNm, 1)
              } else if (band === 'UV') {
                markerX = STRIP_X0 - 10
                markerColor = '#B48CE6'
              } else {
                markerX = STRIP_X1 + 10
                markerColor = '#F0A46A'
              }
              return (
                <g>
                  <line
                    x1={markerX} y1={STRIP_Y - 6} x2={markerX} y2={STRIP_Y + STRIP_H + 6}
                    stroke={markerColor} strokeWidth={2}
                  />
                  <text
                    x={markerX} y={STRIP_Y - 10}
                    fill={markerColor}
                    fontFamily="'JetBrains Mono', monospace"
                    fontSize={10} textAnchor="middle"
                  >
                    λ = {formatLambda(lambdaNm)}
                  </text>
                </g>
              )
            })()}
          </g>
        )}

        {/* Target marker (stages 2 & 3) — required information per §5.2 */}
        {(isStage2 || isStage3) && (() => {
          let tx: number
          if (targetBand === 'visible' && targetInStrip) {
            tx = targetXStrip
          } else if (targetBand === 'UV') {
            tx = STRIP_X0 - 10
          } else {
            tx = STRIP_X1 + 10
          }
          const yTop = isStage3 ? STRIP_Y + 40 : STRIP_Y - 30
          return (
            <g>
              <line
                x1={tx} y1={STRIP_Y - 22}
                x2={tx} y2={STRIP_Y + STRIP_H + 22}
                stroke="#F97316" strokeWidth={1.5}
                strokeDasharray="5 4" opacity={0.9}
              />
              <circle cx={tx} cy={STRIP_Y - 22} r={3} fill="#F97316" />
              <text
                x={tx} y={yTop}
                fill="#F9A968"
                fontFamily="'JetBrains Mono', monospace"
                fontSize={10} textAnchor="middle"
              >
                λ* = {formatLambda(targetLambda)}
              </text>
              <text
                x={tx} y={STRIP_Y + STRIP_H + 34}
                fill="#F9A968"
                fontFamily="'JetBrains Mono', monospace"
                fontSize={9} textAnchor="middle"
              >
                {targetBand === 'UV' ? labels.band_uv
                  : targetBand === 'IR' ? labels.band_ir
                    : labels.band_vis}
              </text>
              {/* Stage 3 auxiliary anchor: show target inside a dedicated
                  strip-free region so the student can read λ* even though
                  the spectrum itself is hidden. */}
              {isStage3 && (
                <text
                  x={(STRIP_X0 + STRIP_X1) / 2} y={STRIP_Y + STRIP_H / 2 + 4}
                  fill="#EAF0FA"
                  fontFamily="'JetBrains Mono', monospace"
                  fontSize={16} textAnchor="middle"
                  letterSpacing="0.06em"
                >
                  target · λ* = {formatLambda(targetLambda)}
                </text>
              )}
            </g>
          )
        })()}
      </svg>

      {/* HUD overlays */}
      <div
        style={{
          position: 'absolute', top: '3rem', left: '3rem',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '2.3rem', letterSpacing: '0.14em',
          textTransform: 'uppercase', color: '#6C7A93',
          zIndex: 5, pointerEvents: 'none',
        }}
      >
        {hudTL}
      </div>
      <div
        style={{
          position: 'absolute', top: '3rem', right: '3rem',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '2.3rem', letterSpacing: '0.08em',
          color: (isStage2 && stage2Match) ? '#37C9B8' : '#B9C4D6',
          textAlign: 'right', zIndex: 5, pointerEvents: 'none',
        }}
      >
        {hudTR}
      </div>
      <div
        style={{
          position: 'absolute', bottom: '3rem', left: '3rem',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '2.3rem', letterSpacing: '0.06em',
          color: peekVisible ? '#F9A968' : '#6C7A93',
          maxWidth: '55%', zIndex: 5, pointerEvents: 'none',
          lineHeight: 1.3,
        }}
      >
        {hudBL}
      </div>
      {/* BR is reserved for parent-side chrome — no overlay here. */}

      {/* ─── Sliders (right stacked column) ─────────────────────────── */}
      <div
        style={{
          position: 'absolute',
          top: '18rem',
          right: '3rem',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '2rem',
          zIndex: 6,
        }}
      >
        <SliderVertical
          label="n_i"
          value={nI}
          min={NI_MIN}
          max={NI_MAX}
          step={1}
          format={(v) => v.toFixed(0)}
          onChange={(v) => {
            setNI(v)
            setNIMin((p) => Math.min(p, v))
            setNIMax((p) => Math.max(p, v))
          }}
        />
        <SliderVertical
          label="n_f"
          value={nF}
          min={NF_MIN}
          max={NF_MAX}
          step={1}
          format={(v) => v.toFixed(0)}
          onChange={(v) => {
            setNF(v)
            setNFMin((p) => Math.min(p, v))
            setNFMax((p) => Math.max(p, v))
          }}
        />
      </div>
    </div>
  )
}

// ─── Slider primitive ────────────────────────────────────────────────────
function SliderVertical({
  label, value, min, max, step, format, onChange, accent = '#37C9B8',
}: {
  label: string
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
        {format(min)}
      </div>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.9rem', color: accent }}>
        {label} = {format(value)}
      </div>
    </div>
  )
}
