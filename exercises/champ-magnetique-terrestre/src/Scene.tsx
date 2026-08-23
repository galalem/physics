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
  SETUPS,
  declinaison,
  featureMatchesTolerance,
  inclinaison,
  isoclinePoints,
} from './physics'

// ─── Scene constants ────────────────────────────────────────────────────
const W = 800
const H = 450

// Map region in SVG coords
const MAP_X0 = 40
const MAP_X1 = 560
const MAP_Y0 = 60
const MAP_Y1 = 400
const MAP_W = MAP_X1 - MAP_X0
const MAP_H = MAP_Y1 - MAP_Y0

// Canvas overlay as % of container (SVG uses viewBox 800x450 that fills the div)
const CANVAS_LEFT_PCT = (MAP_X0 / W) * 100
const CANVAS_TOP_PCT = (MAP_Y0 / H) * 100
const CANVAS_WIDTH_PCT = (MAP_W / W) * 100
const CANVAS_HEIGHT_PCT = (MAP_H / H) * 100

// ─── Physics DOF ranges (degrees) ───────────────────────────────────────
const LAT_MIN = -90
const LAT_MAX = 90
const LAT_DEFAULT = 0
const LON_MIN = -180
const LON_MAX = 180
const LON_DEFAULT = 0
const ALPHA_MIN = 0
const ALPHA_MAX = 30
const ALPHA_DEFAULT = 11 // real Earth ~ 11°

// Coverage threshold for stage 1 advance
const COVERAGE_MIN_FRAC = 0.5

// ─── Locale dict (EN only; FR/AR are a separate bulk pass) ──────────────
const dict = { en, fr, ar } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── Map projection helpers ────────────────────────────────────────────
function lonToX(lon: number): number {
  return MAP_X0 + ((lon + 180) / 360) * MAP_W
}
function latToY(lat: number): number {
  return MAP_Y0 + ((90 - lat) / 180) * MAP_H
}

// ─── Colormap: diverging blue→gray→orange for inclinaison [-90, 90] ────
function inclColor(I: number): [number, number, number] {
  const t = Math.max(-1, Math.min(1, I / 90))
  const s = Math.abs(t)
  const gray: [number, number, number] = [40, 45, 60]
  const target: [number, number, number] =
    t >= 0 ? [220, 130, 50] : [30, 100, 200]
  return [
    Math.round(gray[0] + s * (target[0] - gray[0])),
    Math.round(gray[1] + s * (target[1] - gray[1])),
    Math.round(gray[2] + s * (target[2] - gray[2])),
  ]
}

function formatDeg(d: number): string {
  const sign = d >= 0 ? '' : '-'
  return `${sign}${Math.abs(d).toFixed(1)}°`
}
function formatDegInt(d: number): string {
  const sign = d >= 0 ? '' : '-'
  return `${sign}${Math.abs(d).toFixed(0)}°`
}

// ─── Component ──────────────────────────────────────────────────────────
export default function Scene() {
  const { locale, seed } = useInit()
  const stages = useMemo(() => getStagesFor(locale), [locale])
  useDeclareStages(stages)
  const labels = useMemo(() => svgLabels(locale), [locale])

  // Seed-indexed setup selection with stage-3 fail rotation
  const [setupIdx, setSetupIdx] = useState(() => seed % SETUPS.length)
  const currentSetup = SETUPS[setupIdx]!
  const failCountRef = useRef(0)

  const stageIdx = useCurrentStage()
  const setStage = useSetStage()
  const progress = useProgress()
  const complete = useComplete()

  // DOF state
  const [lat, setLat] = useState(LAT_DEFAULT)
  const [lon, setLon] = useState(LON_DEFAULT)
  const [alpha, setAlpha] = useState(ALPHA_DEFAULT)
  const [peekVisible, setPeekVisible] = useState(false)
  const [peekIdx, setPeekIdx] = useState(0)

  // Coverage tracking (stage 1)
  const [latMin, setLatMin] = useState(LAT_DEFAULT)
  const [latMax, setLatMax] = useState(LAT_DEFAULT)
  const [lonMin, setLonMin] = useState(LON_DEFAULT)
  const [lonMax, setLonMax] = useState(LON_DEFAULT)
  const [alphaMin, setAlphaMin] = useState(ALPHA_DEFAULT)
  const [alphaMax, setAlphaMax] = useState(ALPHA_DEFAULT)

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  const resetStageState = useCallback(() => {
    setLat(LAT_DEFAULT)
    setLon(LON_DEFAULT)
    setAlpha(ALPHA_DEFAULT)
    setLatMin(LAT_DEFAULT); setLatMax(LAT_DEFAULT)
    setLonMin(LON_DEFAULT); setLonMax(LON_DEFAULT)
    setAlphaMin(ALPHA_DEFAULT); setAlphaMax(ALPHA_DEFAULT)
    setPeekVisible(false)
  }, [])
  useReset(resetStageState)

  // Coverage (stage 1 advance predicate)
  const covLat = (latMax - latMin) / (LAT_MAX - LAT_MIN)
  const covLon = (lonMax - lonMin) / (LON_MAX - LON_MIN)
  const covAlpha = (alphaMax - alphaMin) / (ALPHA_MAX - ALPHA_MIN)
  const stage1Done =
    covLat >= COVERAGE_MIN_FRAC &&
    covLon >= COVERAGE_MIN_FRAC &&
    covAlpha >= COVERAGE_MIN_FRAC

  // Feature computation
  const currentIncl = inclinaison(lat, lon, alpha)
  const currentDecl = declinaison(lat, lon, alpha)
  const featureMatch = featureMatchesTolerance(
    currentIncl,
    currentSetup.targetInclinaison,
  )

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
      // Fail-with-restart: rotate to next setup, reset DOFs
      failCountRef.current += 1
      setSetupIdx((seed + failCountRef.current) % SETUPS.length)
      resetStageState()
    }
  })

  // Peek — strategy text only, NEVER the visualization
  const PEEK_TIPS = useMemo(
    () => [labels.peek_tip_formula, labels.peek_tip_anchor],
    [labels],
  )
  usePeek(() => {
    if (!isStage3) return
    setPeekVisible(true)
    setPeekIdx((i) => (i + 1) % PEEK_TIPS.length)
  })
  useEffect(() => {
    if (!peekVisible) return
    const t = setTimeout(() => setPeekVisible(false), 4000)
    return () => clearTimeout(t)
  }, [peekVisible])

  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  // ─── Canvas 2D inclinaison heatmap (stages 1+2 only, hidden on 3) ──
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const showViz = !isStage3
  useEffect(() => {
    if (!showViz) return
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const cssW = canvas.offsetWidth
    const cssH = canvas.offsetHeight
    if (cssW === 0 || cssH === 0) return
    const targetW = Math.max(1, Math.round(cssW * dpr))
    const targetH = Math.max(1, Math.round(cssH * dpr))
    if (canvas.width !== targetW) canvas.width = targetW
    if (canvas.height !== targetH) canvas.height = targetH
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    // Downsample rendering to 2x2 blocks for perf; still crisp on retina
    const stepPx = 2
    const gridW = Math.max(1, Math.floor(targetW / stepPx))
    const gridH = Math.max(1, Math.floor(targetH / stepPx))
    const image = ctx.createImageData(targetW, targetH)
    const data = image.data
    for (let gy = 0; gy < gridH; gy++) {
      const py0 = gy * stepPx
      const yFrac = (gy + 0.5) / gridH
      const latAt = 90 - yFrac * 180
      for (let gx = 0; gx < gridW; gx++) {
        const px0 = gx * stepPx
        const xFrac = (gx + 0.5) / gridW
        const lonAt = -180 + xFrac * 360
        const I = inclinaison(latAt, lonAt, alpha)
        const [r, g, b] = inclColor(I)
        for (let dy = 0; dy < stepPx; dy++) {
          const py = py0 + dy
          if (py >= targetH) break
          const rowBase = py * targetW
          for (let dx = 0; dx < stepPx; dx++) {
            const px = px0 + dx
            if (px >= targetW) break
            const idx = (rowBase + px) * 4
            data[idx] = r
            data[idx + 1] = g
            data[idx + 2] = b
            data[idx + 3] = 210
          }
        }
      }
    }
    ctx.putImageData(image, 0, 0)
  }, [showViz, alpha])

  // ─── Isocline polyline (stage 2 only — hidden on stage 3) ─────────
  const isoclinePath = useMemo(() => {
    if (!isStage2) return null
    const pts = isoclinePoints(currentSetup.targetInclinaison, alpha, 128)
    if (pts.length === 0) return null
    let d = ''
    let started = false
    let prevLon = 0
    for (let i = 0; i < pts.length; i++) {
      const [pLat, pLon] = pts[i]!
      if (started && Math.abs(pLon - prevLon) > 180) {
        started = false
      }
      const x = lonToX(pLon)
      const y = latToY(pLat)
      d += (started ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1) + ' '
      started = true
      prevLon = pLon
    }
    return d
  }, [isStage2, currentSetup, alpha])

  // ─── Coordinates for markers ────────────────────────────────────
  const compassX = lonToX(lon)
  const compassY = latToY(lat)
  const magPoleX = lonToX(0)
  const magPoleY = latToY(90 - alpha)

  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`

  // TR: coverage on s1; live readout on s2 (help stage); target-only on s3
  const hudTR = isStage1
    ? `lat·${(covLat * 100).toFixed(0)}% lon·${(covLon * 100).toFixed(0)}% α·${(covAlpha * 100).toFixed(0)}%`
    : isStage2
      ? `I=${formatDeg(currentIncl)} D=${formatDeg(currentDecl)}`
      : `TARGET I*=${formatDegInt(currentSetup.targetInclinaison)}`
  const hudTR2 = isStage2
    ? `TARGET I*=${formatDegInt(currentSetup.targetInclinaison)}`
    : ''

  const hudBL = peekVisible
    ? PEEK_TIPS[peekIdx]!
    : isStage1
      ? labels.tip1
      : isStage2
        ? labels.tip2
        : labels.tip3

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block', userSelect: 'none' }}
      >
        {/* NO borderRadius on <svg>. NO rx on the bg <rect>. */}
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        {/* Map frame */}
        <rect
          x={MAP_X0} y={MAP_Y0} width={MAP_W} height={MAP_H}
          fill="#0A1220" stroke="#12203a" strokeWidth={1} rx={6}
        />
        <text
          x={MAP_X0 + 6} y={MAP_Y0 - 8}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={11} letterSpacing="0.1em"
        >
          {labels.map}
        </text>

        {/* Latitude grid lines (equator emphasized) */}
        {[-60, -30, 0, 30, 60].map((la) => (
          <g key={`la${la}`}>
            <line
              x1={MAP_X0} y1={latToY(la)} x2={MAP_X1} y2={latToY(la)}
              stroke={la === 0 ? '#2A3654' : '#182338'}
              strokeWidth={la === 0 ? 1 : 0.5}
              strokeDasharray={la === 0 ? undefined : '2 4'}
            />
            <text
              x={MAP_X0 - 4} y={latToY(la) + 3}
              fill="#54617A" textAnchor="end"
              fontFamily="'JetBrains Mono', monospace" fontSize={8}
            >
              {la}
            </text>
          </g>
        ))}
        {/* Longitude grid lines (prime meridian emphasized) */}
        {[-120, -60, 0, 60, 120].map((lo) => (
          <g key={`lo${lo}`}>
            <line
              x1={lonToX(lo)} y1={MAP_Y0} x2={lonToX(lo)} y2={MAP_Y1}
              stroke={lo === 0 ? '#2A3654' : '#182338'}
              strokeWidth={lo === 0 ? 1 : 0.5}
              strokeDasharray={lo === 0 ? undefined : '2 4'}
            />
            <text
              x={lonToX(lo)} y={MAP_Y1 + 12}
              fill="#54617A" textAnchor="middle"
              fontFamily="'JetBrains Mono', monospace" fontSize={8}
            >
              {lo}
            </text>
          </g>
        ))}

        {/* Geographic pole labels */}
        <text
          x={lonToX(0)} y={MAP_Y0 - 12}
          fill="#6C7A93" textAnchor="middle"
          fontFamily="'JetBrains Mono', monospace" fontSize={10} fontWeight="bold"
        >
          {labels.n_pole}
        </text>
        <text
          x={lonToX(0)} y={MAP_Y1 + 24}
          fill="#6C7A93" textAnchor="middle"
          fontFamily="'JetBrains Mono', monospace" fontSize={10} fontWeight="bold"
        >
          {labels.s_pole}
        </text>

        {/* Isocline (target locus) — stage 2 only. Hidden on stage 3 (help). */}
        {isStage2 && isoclinePath && (
          <path
            d={isoclinePath}
            fill="none"
            stroke="#F97316"
            strokeWidth={1.5}
            strokeDasharray="6 4"
            opacity={0.85}
          />
        )}

        {/* Magnetic pole marker M (always visible — apparatus geometry) */}
        {magPoleY >= MAP_Y0 && magPoleY <= MAP_Y1 && (
          <g>
            <circle cx={magPoleX} cy={magPoleY} r={5} fill="none" stroke="#37C9B8" strokeWidth={1.5} />
            <circle cx={magPoleX} cy={magPoleY} r={2} fill="#37C9B8" />
            <text
              x={magPoleX + 8} y={magPoleY - 8}
              fill="#37C9B8"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10} fontWeight="bold"
            >
              {labels.mag_pole}
            </text>
          </g>
        )}

        {/* Compass marker */}
        <g transform={`translate(${compassX} ${compassY})`}>
          {/* Position dot — required info (student sees where their sliders point) */}
          <circle r={4} fill="#F9A968" />
          <circle r={7} fill="none" stroke="#F9A968" strokeWidth={1} opacity={0.5} />
          <text
            x={10} y={-8}
            fill="#F9A968"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={10} fontWeight="bold"
          >
            {labels.compass}
          </text>
          {/* B̄ direction arrow (rotates by declinaison) — HELP: stages 1+2 only */}
          {!isStage3 && (() => {
            const arrowLen = 22
            const rad = (currentDecl * Math.PI) / 180
            const tipX = arrowLen * Math.sin(rad)
            const tipY = -arrowLen * Math.cos(rad)
            const headLen = 5
            const headAng = 0.45
            const b1X = tipX - headLen * Math.sin(rad - headAng)
            const b1Y = tipY + headLen * Math.cos(rad - headAng)
            const b2X = tipX - headLen * Math.sin(rad + headAng)
            const b2Y = tipY + headLen * Math.cos(rad + headAng)
            return (
              <g>
                <line x1={0} y1={0} x2={tipX} y2={tipY} stroke="#F9A968" strokeWidth={1.5} />
                <polygon points={`${tipX},${tipY} ${b1X},${b1Y} ${b2X},${b2Y}`} fill="#F9A968" />
              </g>
            )
          })()}
        </g>

        {/* Target inclinaison coordinate label (SVG text near markers)
            — required info per §4.7 on stages 2 and 3 */}
        {(isStage2 || isStage3) && (
          <text
            x={MAP_X0 + 8} y={MAP_Y1 - 8}
            fill="#F9A968"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={11} fontWeight="bold"
          >
            I* = {formatDegInt(currentSetup.targetInclinaison)}
          </text>
        )}
      </svg>

      {/* Canvas 2D heatmap overlay — CONTINUOUS VISUALIZATION (help).
          Gated on !isStage3 per §4.7. Never rendered on the blind stage,
          even during peek (peek is text-only). */}
      {showViz && (
        <canvas
          ref={canvasRef}
          style={{
            position: 'absolute',
            left: `${CANVAS_LEFT_PCT}%`,
            top: `${CANVAS_TOP_PCT}%`,
            width: `${CANVAS_WIDTH_PCT}%`,
            height: `${CANVAS_HEIGHT_PCT}%`,
            pointerEvents: 'none',
            zIndex: 2,
            mixBlendMode: 'screen',
            borderRadius: 6,
          }}
        />
      )}

      {/* HUD overlays (HTML, rem-sized) */}
      <div style={{
        position: 'absolute',
        top: '3rem', left: '3rem',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '2.3rem',
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: '#6C7A93',
        zIndex: 5,
        pointerEvents: 'none',
      }}>
        {hudTL}
      </div>
      <div style={{
        position: 'absolute',
        top: '3rem', right: '3rem',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '2.3rem',
        letterSpacing: '0.08em',
        color: '#B9C4D6',
        zIndex: 5,
        pointerEvents: 'none',
        textAlign: 'right',
      }}>
        {hudTR}
        {hudTR2 && (
          <div style={{ fontSize: '1.9rem', color: '#F9A968', marginTop: '0.4rem' }}>
            {hudTR2}
          </div>
        )}
      </div>
      <div style={{
        position: 'absolute',
        bottom: '3rem', left: '3rem',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '2.3rem',
        letterSpacing: '0.06em',
        color: peekVisible ? '#37C9B8' : '#6C7A93',
        zIndex: 5,
        pointerEvents: 'none',
        maxWidth: '55%',
      }}>
        {hudBL}
      </div>
      {/* NO bottom-right overlay — reserved for parent-side chrome. */}

      {/* Slider column (right side) */}
      <div style={{
        position: 'absolute',
        top: '6rem', right: '3rem',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '1.2rem',
        zIndex: 6,
      }}>
        <SliderVertical
          label="lat"
          unit="°"
          value={lat}
          min={LAT_MIN}
          max={LAT_MAX}
          step={1}
          format={(v) => v.toFixed(0)}
          onChange={(v) => {
            setLat(v)
            setLatMin((prev) => Math.min(prev, v))
            setLatMax((prev) => Math.max(prev, v))
          }}
        />
        <SliderVertical
          label="lon"
          unit="°"
          value={lon}
          min={LON_MIN}
          max={LON_MAX}
          step={2}
          format={(v) => v.toFixed(0)}
          onChange={(v) => {
            setLon(v)
            setLonMin((prev) => Math.min(prev, v))
            setLonMax((prev) => Math.max(prev, v))
          }}
        />
        <SliderVertical
          label="α"
          unit="°"
          value={alpha}
          min={ALPHA_MIN}
          max={ALPHA_MAX}
          step={0.5}
          format={(v) => v.toFixed(1)}
          onChange={(v) => {
            setAlpha(v)
            setAlphaMin((prev) => Math.min(prev, v))
            setAlphaMax((prev) => Math.max(prev, v))
          }}
        />
      </div>
    </div>
  )
}

// ─── SliderVertical primitive (copied from diffraction, tightened) ─────
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
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.3rem' }}>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.4rem', color: '#54617A' }}>
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
            height: '2rem',
            transform: 'rotate(-90deg)',
            transformOrigin: 'center',
            accentColor: accent,
            cursor: 'pointer',
          }}
        />
      </div>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.4rem', color: '#54617A' }}>
        {format(min)}
      </div>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.8rem', color: accent }}>
        {label} = {format(value)}{unit}
      </div>
    </div>
  )
}
