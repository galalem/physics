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
  computeFeature,
  featureMatchesTolerance,
  pressureKpa,
  SETUPS,
  scaleHeight,
} from './physics'

// ─── Scene constants ──────────────────────────────────────────────────
const W = 800
const H = 450

// Barometer geometry (SVG units)
const RES_LEFT = 70
const RES_RIGHT = 300
const RES_TOP = 340 // reservoir surface (Hg pool level)
const RES_BOT = 405
const TUBE_LEFT = 168
const TUBE_RIGHT = 202
const TUBE_TOP = 70 // sealed / vacuum end
const TUBE_BASE = 388 // tube extends into pool
// Column mapping: 1 mm Hg = COLUMN_PX_PER_MM SVG units
const COLUMN_MAX_MM = 850 // full-tube capacity for scale
const COLUMN_PX_HEIGHT = RES_TOP - TUBE_TOP // 270 SVG units
const COLUMN_PX_PER_MM = COLUMN_PX_HEIGHT / COLUMN_MAX_MM // ≈ 0.318 svg/mm

// Altitude column (right-side visualization of atmosphere)
const ATM_X = 360
const ATM_W = 90
const ATM_TOP = 70
const ATM_BOT = 400
const ATM_MAX_M = 9000 // slider goes to 8000, leave a bit of headroom

// ─── Physics DOF constants ────────────────────────────────────────────
const Z_MIN = 0 // m
const Z_MAX = 8000 // m
const Z_DEFAULT = 0

const P0_MIN = 95 // kPa
const P0_MAX = 108 // kPa
const P0_DEFAULT = 101

const T_MIN = 250 // K
const T_MAX = 310 // K
const T_DEFAULT = 288

const COVERAGE_MIN_FRAC = 0.5

const dict = { en, fr, ar } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── Formatters ───────────────────────────────────────────────────────
function fmtMm(mm: number): string {
  if (!Number.isFinite(mm)) return '—'
  if (mm >= 100) return `${mm.toFixed(0)}mm`
  return `${mm.toFixed(1)}mm`
}
function fmtKpa(kpa: number): string {
  return `${kpa.toFixed(2)}kPa`
}
function fmtHpa(kpa: number): string {
  return `${(kpa * 10).toFixed(0)}hPa`
}

// ─── Component ────────────────────────────────────────────────────────
export default function Scene() {
  const { locale, seed } = useInit()
  const stages = useMemo(() => getStagesFor(locale), [locale])
  useDeclareStages(stages)
  const labels = useMemo(() => svgLabels(locale), [locale])

  const stageIdx = useCurrentStage()
  const setStage = useSetStage()
  const progress = useProgress()
  const complete = useComplete()

  const [z, setZ] = useState(Z_DEFAULT)
  const [p0, setP0] = useState(P0_DEFAULT)
  const [tK, setTK] = useState(T_DEFAULT)
  const [peekVisible, setPeekVisible] = useState(false)
  const [failCount, setFailCount] = useState(0)

  // Setup is seed-indexed + shifted by fail count so a wrong stage-3 submit
  // rotates to a fresh target (no brute-force retries on the same setup).
  const setup = useMemo(
    () => SETUPS[(seed + failCount) % SETUPS.length]!,
    [seed, failCount],
  )

  // Stage 1 coverage bits
  const [zMin, setZMin] = useState(Z_DEFAULT)
  const [zMax, setZMax] = useState(Z_DEFAULT)
  const [p0Min, setP0Min] = useState(P0_DEFAULT)
  const [p0Max, setP0Max] = useState(P0_DEFAULT)
  const [tMin, setTMin] = useState(T_DEFAULT)
  const [tMax, setTMax] = useState(T_DEFAULT)

  const peekIdxRef = useRef(0)

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  const resetStageState = useCallback(() => {
    setZ(Z_DEFAULT)
    setP0(P0_DEFAULT)
    setTK(T_DEFAULT)
    setZMin(Z_DEFAULT); setZMax(Z_DEFAULT)
    setP0Min(P0_DEFAULT); setP0Max(P0_DEFAULT)
    setTMin(T_DEFAULT); setTMax(T_DEFAULT)
    setPeekVisible(false)
  }, [])
  useReset(() => {
    resetStageState()
    setFailCount(0)
  })

  // Coverage
  const zCoverage = (zMax - zMin) / (Z_MAX - Z_MIN)
  const p0Coverage = (p0Max - p0Min) / (P0_MAX - P0_MIN)
  const tCoverage = (tMax - tMin) / (T_MAX - T_MIN)
  const stage1Done =
    zCoverage >= COVERAGE_MIN_FRAC &&
    p0Coverage >= COVERAGE_MIN_FRAC &&
    tCoverage >= COVERAGE_MIN_FRAC

  // Physics
  const hMm = computeFeature(z, p0, tK)
  const pKpa = pressureKpa(z, p0, tK)
  const hScaleMeters = scaleHeight(tK)

  const featureMatch = featureMatchesTolerance(hMm, setup.hStar)

  const canSubmit = isStage1 ? stage1Done : featureMatch

  useEffect(() => {
    progress(stageIdx / 3, { stage: stageIdx, canSubmit })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageIdx, canSubmit])

  useNext(() => {
    if (stageIdx < 3) {
      setStage(stageIdx + 1)
      resetStageState()
      return
    }
    if (featureMatch) {
      complete({ success: true })
    } else {
      // Fail-with-restart: rotate to next setup, reset all state.
      setFailCount((n) => n + 1)
      resetStageState()
    }
  })

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

  // ─── Column geometry (live: only rendered on stages 1 & 2) ──────
  const showColumn = !isStage3
  // Clamp mercury display height to tube range so extreme sliders don't
  // draw off-canvas.
  const columnMm = Math.max(0, Math.min(COLUMN_MAX_MM, hMm))
  const columnTopY = RES_TOP - columnMm * COLUMN_PX_PER_MM

  // ─── Target tick geometry (stages 2 & 3) ─────────────────────────
  const showTargetTick = isStage2 || isStage3
  const targetY = RES_TOP - setup.hStar * COLUMN_PX_PER_MM

  // ─── Altitude marker geometry ────────────────────────────────────
  // Draw altitude column always; the current-altitude marker uses the
  // slider value, which is required info on all stages.
  const zFrac = Math.max(0, Math.min(1, z / ATM_MAX_M))
  const zMarkerY = ATM_BOT - zFrac * (ATM_BOT - ATM_TOP)

  // ─── HUD text ────────────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`

  const hudTR = isStage1
    ? `z·${(zCoverage * 100).toFixed(0)}% p0·${(p0Coverage * 100).toFixed(0)}% T·${(tCoverage * 100).toFixed(0)}%`
    : isStage2
      ? `h = ${fmtMm(hMm)} · p = ${fmtKpa(pKpa)}`
      : `h* = ${fmtMm(setup.hStar)}`

  const hudBL = peekVisible
    ? PEEK_TIPS[(peekIdxRef.current - 1) % PEEK_TIPS.length]!
    : isStage1
      ? labels.tip1
      : isStage2
        ? labels.tip2
        : labels.tip3

  // ─── Render ──────────────────────────────────────────────────────
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block', userSelect: 'none' }}
      >
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        {/* Bench frame around barometer + altitude column */}
        <rect
          x={32}
          y={50}
          width={460}
          height={370}
          fill="none"
          stroke="#12203a"
          strokeWidth={1}
          rx={6}
        />
        <text
          x={40}
          y={42}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={11}
          letterSpacing="0.1em"
        >
          {labels.bench}
        </text>

        {/* Atmosphere hint: downward pressure arrows over the reservoir */}
        <g opacity={0.6}>
          {[110, 155, 245, 275].map((ax) => (
            <g key={`atm-${ax}`}>
              <line
                x1={ax}
                y1={310}
                x2={ax}
                y2={335}
                stroke="#54617A"
                strokeWidth={0.8}
              />
              <path
                d={`M ${ax - 2.5} 332 L ${ax} 338 L ${ax + 2.5} 332`}
                fill="none"
                stroke="#54617A"
                strokeWidth={0.8}
              />
            </g>
          ))}
          <text
            x={190}
            y={300}
            fill="#6C7A93"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={9}
            textAnchor="middle"
          >
            {labels.atmosphere}
          </text>
        </g>

        {/* Reservoir tray (outer walls) */}
        <path
          d={`M ${RES_LEFT} ${RES_TOP - 4}
              L ${RES_LEFT} ${RES_BOT}
              L ${RES_RIGHT} ${RES_BOT}
              L ${RES_RIGHT} ${RES_TOP - 4}`}
          fill="none"
          stroke="#54617A"
          strokeWidth={1.4}
          strokeLinejoin="round"
        />
        {/* Reservoir mercury pool */}
        <rect
          x={RES_LEFT + 2}
          y={RES_TOP}
          width={RES_RIGHT - RES_LEFT - 4}
          height={RES_BOT - RES_TOP - 2}
          fill="#8892A6"
        />
        {/* Mercury sheen on pool surface */}
        <rect
          x={RES_LEFT + 2}
          y={RES_TOP}
          width={RES_RIGHT - RES_LEFT - 4}
          height={3}
          fill="#B9C4D6"
          opacity={0.7}
        />
        <text
          x={RES_LEFT + 8}
          y={RES_BOT - 8}
          fill="#3A4863"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={9}
        >
          {labels.reservoir}
        </text>

        {/* Tube outline (vacuum-sealed at top, dips into reservoir at bottom) */}
        <rect
          x={TUBE_LEFT}
          y={TUBE_TOP}
          width={TUBE_RIGHT - TUBE_LEFT}
          height={TUBE_BASE - TUBE_TOP}
          fill="#050B18"
          stroke="#54617A"
          strokeWidth={1.2}
          rx={2}
        />
        {/* Vacuum label at top of tube */}
        <text
          x={(TUBE_LEFT + TUBE_RIGHT) / 2}
          y={TUBE_TOP - 6}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={9}
          textAnchor="middle"
        >
          {labels.vacuum}
        </text>

        {/* Mercury column inside tube — HIDDEN on stage 3 (blind stage) */}
        {showColumn && (
          <g>
            <rect
              x={TUBE_LEFT + 1.5}
              y={columnTopY}
              width={TUBE_RIGHT - TUBE_LEFT - 3}
              height={RES_TOP - columnTopY + 2}
              fill="#8892A6"
            />
            {/* Meniscus highlight */}
            <rect
              x={TUBE_LEFT + 1.5}
              y={columnTopY}
              width={TUBE_RIGHT - TUBE_LEFT - 3}
              height={2}
              fill="#B9C4D6"
              opacity={0.85}
            />
          </g>
        )}

        {/* Column-scale ticks on side of tube (every 100 mm) */}
        {[0, 100, 200, 300, 400, 500, 600, 700, 800].map((mm) => {
          const y = RES_TOP - mm * COLUMN_PX_PER_MM
          if (y < TUBE_TOP - 2) return null
          return (
            <g key={`tick-${mm}`}>
              <line
                x1={TUBE_RIGHT + 2}
                y1={y}
                x2={TUBE_RIGHT + 8}
                y2={y}
                stroke="#2A3654"
                strokeWidth={0.8}
              />
              {mm % 200 === 0 && (
                <text
                  x={TUBE_RIGHT + 11}
                  y={y + 3}
                  fill="#54617A"
                  fontFamily="'JetBrains Mono', monospace"
                  fontSize={8}
                >
                  {mm}
                </text>
              )}
            </g>
          )
        })}
        <text
          x={TUBE_RIGHT + 11}
          y={TUBE_TOP + 8}
          fill="#54617A"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={8}
        >
          mmHg
        </text>

        {/* Target tick (stages 2 & 3) — always shows h* with a labeled value */}
        {showTargetTick && (
          <g>
            <line
              x1={TUBE_LEFT - 20}
              y1={targetY}
              x2={TUBE_RIGHT + 24}
              y2={targetY}
              stroke="#F97316"
              strokeWidth={1.2}
              strokeDasharray="4 4"
              opacity={0.85}
            />
            <text
              x={TUBE_LEFT - 22}
              y={targetY - 4}
              fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
              textAnchor="end"
            >
              h* = {setup.hStar}
            </text>
            <text
              x={TUBE_LEFT - 22}
              y={targetY + 10}
              fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={9}
              textAnchor="end"
            >
              {labels.target}
            </text>
          </g>
        )}

        {/* ── Altitude column (right of barometer, always visible) ── */}
        <rect
          x={ATM_X}
          y={ATM_TOP}
          width={ATM_W}
          height={ATM_BOT - ATM_TOP}
          fill="none"
          stroke="#2A3654"
          strokeWidth={0.8}
          rx={4}
        />
        {/* Sky gradient bands */}
        {Array.from({ length: 12 }).map((_, i) => {
          const bandH = (ATM_BOT - ATM_TOP) / 12
          const y0 = ATM_TOP + i * bandH
          const shade = Math.floor(20 + i * 6)
          return (
            <rect
              key={`atm-band-${i}`}
              x={ATM_X + 1}
              y={y0}
              width={ATM_W - 2}
              height={bandH + 0.2}
              fill={`rgb(${shade},${shade + 10},${shade + 30})`}
              opacity={0.55}
            />
          )
        })}
        <text
          x={ATM_X + ATM_W / 2}
          y={ATM_TOP - 6}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={9}
          textAnchor="middle"
        >
          altitude
        </text>
        {/* Altitude scale ticks */}
        {[0, 2000, 4000, 6000, 8000].map((zM) => {
          const y = ATM_BOT - (zM / ATM_MAX_M) * (ATM_BOT - ATM_TOP)
          return (
            <g key={`zt-${zM}`}>
              <line
                x1={ATM_X + ATM_W}
                y1={y}
                x2={ATM_X + ATM_W + 6}
                y2={y}
                stroke="#2A3654"
                strokeWidth={0.8}
              />
              <text
                x={ATM_X + ATM_W + 9}
                y={y + 3}
                fill="#54617A"
                fontFamily="'JetBrains Mono', monospace"
                fontSize={8}
              >
                {zM}m
              </text>
            </g>
          )
        })}
        {/* Current altitude marker — required info (slider readback) */}
        <g>
          <line
            x1={ATM_X - 6}
            y1={zMarkerY}
            x2={ATM_X + ATM_W + 4}
            y2={zMarkerY}
            stroke="#37C9B8"
            strokeWidth={1.4}
          />
          <text
            x={ATM_X - 8}
            y={zMarkerY + 3}
            fill="#37C9B8"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={9}
            textAnchor="end"
          >
            z
          </text>
        </g>

        {/* Small p vs z curve overlay — HIDDEN on stage 3 to keep it a
            straight visual-feedback loop only for stages 1 & 2. */}
        {!isStage3 && (() => {
          const cxLeft = ATM_X + 4
          const cxRight = ATM_X + ATM_W - 4
          const pAtZero = p0 // kPa
          const pAtMax = pressureKpa(ATM_MAX_M, p0, tK) // kPa
          const pRange = pAtZero - pAtMax || 1
          // Sample 24 points along altitude
          const N = 24
          const pts: string[] = []
          for (let i = 0; i <= N; i++) {
            const zi = (i / N) * ATM_MAX_M
            const pi = pressureKpa(zi, p0, tK)
            const yPx =
              ATM_BOT - (zi / ATM_MAX_M) * (ATM_BOT - ATM_TOP)
            const xFrac = (pi - pAtMax) / pRange
            const xPx = cxLeft + xFrac * (cxRight - cxLeft)
            pts.push(`${i === 0 ? 'M' : 'L'} ${xPx.toFixed(1)} ${yPx.toFixed(1)}`)
          }
          return (
            <path
              d={pts.join(' ')}
              fill="none"
              stroke="#37C9B8"
              strokeWidth={1}
              opacity={0.7}
            />
          )
        })()}

        {/* Scale-height annotation (bottom of barometer bench) */}
        <text
          x={40}
          y={412}
          fill="#3A4863"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={9}
        >
          H = {(hScaleMeters / 1000).toFixed(2)} km
        </text>
      </svg>

      {/* HUD overlays (HTML, rem-sized) */}
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
          color: '#6C7A93',
          zIndex: 5,
          pointerEvents: 'none',
          maxWidth: '52%',
        }}
      >
        {hudBL}
      </div>
      {/* BR corner intentionally empty — reserved for parent-side chrome. */}

      {/* Slider column (right side, HTML overlay) */}
      <div
        style={{
          position: 'absolute',
          top: '7rem',
          right: '3rem',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '1.2rem',
          zIndex: 6,
        }}
      >
        <SliderVertical
          label="z"
          unit="m"
          value={z}
          min={Z_MIN}
          max={Z_MAX}
          step={50}
          format={(v) => v.toFixed(0)}
          onChange={(v) => {
            setZ(v)
            setZMin((prev) => Math.min(prev, v))
            setZMax((prev) => Math.max(prev, v))
          }}
        />
        <SliderVertical
          label="p0"
          unit="kPa"
          value={p0}
          min={P0_MIN}
          max={P0_MAX}
          step={0.25}
          format={(v) => v.toFixed(2)}
          onChange={(v) => {
            setP0(v)
            setP0Min((prev) => Math.min(prev, v))
            setP0Max((prev) => Math.max(prev, v))
          }}
          altReadout={fmtHpa(p0)}
        />
        <SliderVertical
          label="T"
          unit="K"
          value={tK}
          min={T_MIN}
          max={T_MAX}
          step={1}
          format={(v) => v.toFixed(0)}
          onChange={(v) => {
            setTK(v)
            setTMin((prev) => Math.min(prev, v))
            setTMax((prev) => Math.max(prev, v))
          }}
        />
      </div>
    </div>
  )
}

// ─── Slider primitive ────────────────────────────────────────────────
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
  altReadout,
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
  altReadout?: string
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '0.3rem',
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
          height: '15rem',
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
            width: '15rem',
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
      {altReadout && (
        <div
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '1.3rem',
            color: '#54617A',
          }}
        >
          {altReadout}
        </div>
      )}
    </div>
  )
}
