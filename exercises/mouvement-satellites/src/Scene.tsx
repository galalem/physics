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
  useTicker,
} from '@physics/sdk/react'
import { getHintFor, getStagesFor } from './stages'
import en from '../i18n/en.json'
import { Earth } from './art/Earth'
import { Satellite } from './art/Satellite'
import { TargetOrbitRing } from './art/TargetOrbitRing'
import {
  type Orbit,
  orbitFromLaunch,
  period,
  periapsisR,
  positionAt,
  sampleOrbit,
  vCirc,
} from './orbit'

// ─── Scene geometry ─────────────────────────────────────────────────────
const W = 800
const H = 450
const CENTER = { x: 400, y: 225 } // Earth centre in SVG coords
const PX_PER_KM = 0.004 // 1 SVG unit = 250 km; 6400 km Earth → 25.6 SVG
const R_EARTH_KM = 6400
const R_EARTH_SVG = R_EARTH_KM * PX_PER_KM

// ─── Physics range (all in km / km·s⁻¹ / s) ─────────────────────────────
const R_MIN = 7000
const R_MAX = 50000
const V_MIN = 2.0
const V_MAX = 10.0 // v_escape at r_min=7000 is √(2·GM/r) = 10.69, so we stay below
const DEFAULT_R = 20000
const DEFAULT_V = 5.0

const CIRC_TOL = 0.03 // 3% band around v_circ counts as circular
const HIT_TOL_R = 0.05 // 5% radius tolerance for target match
const HIT_TOL_V = 0.05 // 5% speed tolerance for target match (must be ≈ v_circ)
const SIM_PERIOD_SEC = 8 // cinematic seconds per orbit period, regardless of physical T
const SHOT_BUDGET_STAGE3 = 4 // 3 targets, one spare — miss the pool → restart with fresh setup

// ─── Setups (seed-picked) ───────────────────────────────────────────────
// Targets = orbital radii; each yields a period T shown to the student.
// Setups cover LEO / ICO / MEO / GEO variety so the student rotates
// through the full Kepler-3rd curve. Hand-authored, not RNG-derived.
type Setup = { targets: number[] } // radii in km

const STAGE2_SETUPS: Setup[] = [
  { targets: [8000, 20000, 42200] }, // LEO, MEO, GEO
  { targets: [10000, 25000, 35000] },
  { targets: [7500, 15000, 30000] },
  { targets: [12000, 22000, 42200] },
]

const STAGE3_SETUPS: Setup[] = [
  { targets: [8000, 20000, 42200] }, // classic LEO / MEO / GEO
  { targets: [10000, 26000, 42200] },
  { targets: [9000, 18000, 30000] },
  { targets: [7500, 22000, 42200] },
]

// ─── Coordinate helpers ─────────────────────────────────────────────────
function kmToSvgX(xKm: number): number {
  return CENTER.x + xKm * PX_PER_KM
}
function kmToSvgY(yKm: number): number {
  // Physical y (with launch velocity +y) → SVG y flips (SVG y grows downward)
  return CENTER.y - yKm * PX_PER_KM
}
function toSvgR(rKm: number): number {
  return rKm * PX_PER_KM
}

// Build an SVG path from a sampled orbit (in physical km).
function orbitPath(orbit: Orbit): string {
  const pts = sampleOrbit(orbit)
  if (!pts.length) return ''
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${kmToSvgX(p.x)} ${kmToSvgY(p.y)}`).join(' ')
}

// Format: T in seconds → "hh h mm" or "mmm min" or "mm min"
function formatPeriod(TSec: number): string {
  const min = TSec / 60
  if (min < 100) return `${min.toFixed(1)} min`
  if (min < 300) return `${Math.round(min)} min`
  const hr = min / 60
  if (hr < 10) return `${hr.toFixed(1)} h`
  return `${Math.round(hr)} h`
}
function formatMm(rKm: number): string {
  return `${(rKm / 1000).toFixed(1)} Mm`
}

// ─── Labels loader ──────────────────────────────────────────────────────
const dict = { en } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── Component ──────────────────────────────────────────────────────────
type Flight = { orbit: Orbit; startedAt: number; crashRadius: number }

export default function Scene() {
  const { locale, seed } = useInit()
  const stages = useMemo(() => getStagesFor(locale), [locale])
  useDeclareStages(stages)
  const labels = useMemo(() => svgLabels(locale), [locale])

  const stageIdx = useCurrentStage()
  const setStage = useSetStage()
  const complete = useComplete()
  const progress = useProgress()

  const [setupRotation, setSetupRotation] = useState(0) // bumps on stage-3 restart to rotate setups
  const setup2 = useMemo(
    () => STAGE2_SETUPS[seed % STAGE2_SETUPS.length]!,
    [seed],
  )
  const setup3 = useMemo(
    () => STAGE3_SETUPS[(seed + setupRotation) % STAGE3_SETUPS.length]!,
    [seed, setupRotation],
  )

  const [rKm, setRKm] = useState(DEFAULT_R)
  const [vKmPerS, setVKmPerS] = useState(DEFAULT_V)
  const [flight, setFlight] = useState<Flight | null>(null)
  const [satPos, setSatPos] = useState<{ x: number; y: number }>({ x: DEFAULT_R, y: 0 })
  const [hits, setHits] = useState<number[]>([]) // indices into activeTargets
  const [shotCount, setShotCount] = useState(0)
  const [distinctR, setDistinctR] = useState<number[]>([])
  const [vMoved, setVMoved] = useState(false)
  const [lastFire, setLastFire] = useState<{ orbit: Orbit; crashed: boolean } | null>(null)
  const [shotsRemaining, setShotsRemaining] = useState(SHOT_BUDGET_STAGE3)
  const [peekTip, setPeekTip] = useState<string | null>(null)
  const [draggingSat, setDraggingSat] = useState(false)

  const svgRef = useRef<SVGSVGElement>(null)

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  const activeTargets = isStage2 ? setup2.targets : isStage3 ? setup3.targets : []

  const vc = vCirc(rKm)
  const currentPeriod = period(rKm) // circular period at current r (for HUD)
  const isCircular = Math.abs(vKmPerS - vc) / vc < CIRC_TOL

  // ─── Reset handler (chrome Reset button) ────────────────────────────
  const resetStageState = useCallback(() => {
    setRKm(DEFAULT_R)
    setVKmPerS(DEFAULT_V)
    setFlight(null)
    setSatPos({ x: DEFAULT_R, y: 0 })
    setHits([])
    setShotCount(0)
    setDistinctR([])
    setVMoved(false)
    setLastFire(null)
    setShotsRemaining(SHOT_BUDGET_STAGE3)
    setPeekTip(null)
  }, [])
  useReset(resetStageState)

  // ─── Fire: compute orbit, start the sim ────────────────────────────
  const canFire = !flight && (!isStage3 || shotsRemaining > 0)
  const fire = useCallback(() => {
    if (!canFire) return
    const orbit = orbitFromLaunch(rKm, vKmPerS)
    const crashRadius = R_EARTH_KM
    setFlight({ orbit, startedAt: performance.now(), crashRadius })
    setLastFire({ orbit, crashed: periapsisR(orbit) < R_EARTH_KM })
    setShotCount((n) => n + 1)
    if (isStage3) setShotsRemaining((n) => n - 1)
    if (isStage1) {
      // Bucket r to the nearest 5000 km for the "distinct radii" advance
      const bucket = Math.round(rKm / 5000) * 5000
      setDistinctR((prev) => (prev.includes(bucket) ? prev : [...prev, bucket]))
    }

    // Immediate hit check for stage 2 / 3: hit registers on FIRE, based on
    // the launched (r, v) matching a target's (r_target, v_circ(r_target)).
    // The sim then plays out visually for confirmation. Only circular
    // orbits within tolerance count.
    if ((isStage2 || isStage3) && isCircular) {
      for (let i = 0; i < activeTargets.length; i++) {
        if (hits.includes(i)) continue
        const rt = activeTargets[i]!
        const vt = vCirc(rt)
        if (
          Math.abs(rKm - rt) / rt < HIT_TOL_R &&
          Math.abs(vKmPerS - vt) / vt < HIT_TOL_V
        ) {
          setHits((prev) => [...prev, i])
          break
        }
      }
    }
  }, [canFire, rKm, vKmPerS, isCircular, isStage1, isStage2, isStage3, activeTargets, hits])

  // ─── Ticker (cinematic orbit playback) ─────────────────────────────
  useTicker(() => {
    if (!flight) return
    const elapsed = (performance.now() - flight.startedAt) / 1000 // real seconds
    const pos = positionAt(flight.orbit, elapsed, SIM_PERIOD_SEC)
    if (!pos) {
      setFlight(null)
      return
    }
    setSatPos(pos)

    // Crash check — orbit intersects Earth.
    const rNow = Math.hypot(pos.x, pos.y)
    if (rNow < flight.crashRadius && elapsed > 0.15) {
      // pretty ugly to fly through Earth graphic — cut the sim short
      setFlight(null)
      return
    }
    if (elapsed >= SIM_PERIOD_SEC) {
      // One full period completed. Stop and rest satellite at launch point.
      setFlight(null)
      setSatPos({ x: rKm, y: 0 })
    }
  })

  // ─── Blind-stage fail-with-restart (§5.2) ──────────────────────────
  useEffect(() => {
    if (!isStage3) return
    if (
      shotsRemaining === 0 &&
      !flight &&
      hits.length < activeTargets.length
    ) {
      // Out of shots with targets remaining — rotate to the next setup and
      // reset local stage state. Fresh start, same stage. This is the
      // "failure is honest signal" branch of §4.7 rule 1.
      setSetupRotation((n) => n + 1)
      // Defer the state reset so the setup memo updates first.
      resetStageState()
    }
  }, [isStage3, shotsRemaining, flight, hits.length, activeTargets.length, resetStageState])

  // ─── Advance predicate ─────────────────────────────────────────────
  const canSubmit = isStage1
    ? shotCount >= 3 && distinctR.length >= 2 && vMoved
    : hits.length === activeTargets.length && activeTargets.length > 0

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

  // ─── Peek: rotating strategy TEXT tip (never the orbit ring) ───────
  const PEEK_TIPS = useMemo(
    () => [labels.peek_tip_kepler, labels.peek_tip_geo, labels.peek_tip_vcirc],
    [labels],
  )
  const peekIdxRef = useRef(0)
  usePeek(() => {
    if (!isStage3) return
    const tip = PEEK_TIPS[peekIdxRef.current % PEEK_TIPS.length]!
    setPeekTip(tip)
    peekIdxRef.current += 1
  })
  useEffect(() => {
    if (!peekTip) return
    const t = setTimeout(() => setPeekTip(null), 4500)
    return () => clearTimeout(t)
  }, [peekTip])

  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  // ─── Satellite radial drag (r control) ─────────────────────────────
  const svgPoint = (e: React.PointerEvent) => {
    const el = svgRef.current
    if (!el) return null
    const rect = el.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) / rect.width) * W,
      y: ((e.clientY - rect.top) / rect.height) * H,
    }
  }
  const applyRFromPoint = (p: { x: number; y: number }) => {
    // Convert SVG point → physical distance from Earth centre, in km,
    // preserving the launch axis (+x). We want the drag to move the sat
    // radially; snap it back to the +x axis so the launch condition stays
    // clean (tangential v launched at (r, 0)).
    const dxSvg = p.x - CENTER.x
    const dySvg = CENTER.y - p.y
    const rSvg = Math.hypot(dxSvg, dySvg)
    const rNew = Math.max(R_MIN, Math.min(R_MAX, rSvg / PX_PER_KM))
    setRKm(rNew)
    if (isStage1) {
      const bucket = Math.round(rNew / 5000) * 5000
      setDistinctR((prev) => (prev.includes(bucket) ? prev : [...prev, bucket]))
    }
  }
  const satPointerDown = (e: React.PointerEvent) => {
    if (flight) return
    e.preventDefault()
    e.stopPropagation()
    setDraggingSat(true)
  }
  const svgPointerMove = (e: React.PointerEvent) => {
    if (!draggingSat || flight) return
    const p = svgPoint(e)
    if (p) applyRFromPoint(p)
  }
  const svgPointerUp = () => setDraggingSat(false)

  // While not in flight, keep sat visually pinned to (r, 0) — the launch
  // point. Effect keeps satPos synced when r changes off-flight.
  useEffect(() => {
    if (!flight) setSatPos({ x: rKm, y: 0 })
  }, [rKm, flight])

  // ─── Preview orbit (stage 1 & 2 only — HIDDEN on blind stage) ──────
  const showPreviewOrbit = isStage1 || isStage2
  // Preview shows the CIRCULAR orbit at current r (the "what a circular
  // orbit looks like at this r" reference). We render it whenever the
  // student is at circular v OR always — always is more useful for stage 2
  // where students align preview with target rings.
  const previewOrbit: Orbit = { kind: 'circular', r: rKm, T: currentPeriod }
  const previewD = showPreviewOrbit ? orbitPath(previewOrbit) : ''

  // Stage-1 trail: show the last few full orbits as fading dashed rings so
  // the student sees how their choices reshape the orbit.
  const trailD =
    isStage1 && lastFire && !flight ? orbitPath(lastFire.orbit) : ''

  // ─── Grid ──────────────────────────────────────────────────────────
  const gridLines: React.ReactNode[] = []
  for (let gx = 40; gx < W; gx += 60) {
    gridLines.push(
      <line key={`gx${gx}`} x1={gx} y1={0} x2={gx} y2={H} stroke="#12203a" strokeWidth={1} />,
    )
  }
  for (let gy = 40; gy < H; gy += 60) {
    gridLines.push(
      <line key={`gy${gy}`} x1={0} y1={gy} x2={W} y2={gy} stroke="#12203a" strokeWidth={1} />,
    )
  }

  // ─── HUD strings ───────────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`
  const hudTR = `r = ${formatMm(rKm)} · v = ${vKmPerS.toFixed(2)} km/s`
  const hudBL = isStage3 && peekTip
    ? peekTip
    : isStage1
      ? labels.tip1
      : isStage2
        ? labels.tip2
        : labels.tip3
  // BR-corner (§4.3) is reserved for parent chrome. Do NOT render there.

  const vCircDisplay = `${labels.vcirc} = ${vc.toFixed(2)} km/s`
  const periodDisplay = `${labels.period_of_r} = ${formatPeriod(currentPeriod)}`

  // Satellite orientation: on the +x axis, velocity is +y in physics,
  // which points UP in SVG (rotate to point up = -90° from default).
  const satAngleRad = -Math.PI / 2

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
        onPointerMove={svgPointerMove}
        onPointerUp={svgPointerUp}
        onPointerLeave={svgPointerUp}
      >
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />
        {gridLines}

        {/* Radial guide from Earth centre out to the launch point — a subtle */}
        {/* dashed line so students see the "r" they are setting. */}
        <line
          x1={CENTER.x}
          y1={CENTER.y}
          x2={kmToSvgX(rKm)}
          y2={kmToSvgY(0)}
          stroke="#3A4863"
          strokeDasharray="2 4"
          strokeWidth={0.9}
        />

        {/* Stage 1 trail — last completed orbit fades in dashed */}
        {trailD && (
          <path
            d={trailD}
            fill="none"
            stroke="#F97316"
            strokeWidth={1.4}
            strokeDasharray="2 5"
            opacity={0.35}
          />
        )}

        {/* Target orbit rings — stage 2 only. Hidden on blind stage. */}
        {isStage2 &&
          activeTargets.map((rt, i) => (
            <g key={`t${i}`}>
              <TargetOrbitRing
                cx={CENTER.x}
                cy={CENTER.y}
                r={toSvgR(rt)}
                hit={hits.includes(i)}
              />
              <text
                x={CENTER.x + toSvgR(rt) + 6}
                y={CENTER.y - 6}
                fill={hits.includes(i) ? '#37C9B8' : '#B9C4D6'}
                fontFamily="'JetBrains Mono', monospace"
                fontSize={10}
                textAnchor="start"
              >
                T = {formatPeriod(period(rt))}
              </text>
            </g>
          ))}

        {/* Preview orbit (stage 1 + 2) — a solid ring at current r. */}
        {previewD && (
          <path
            d={previewD}
            fill="none"
            stroke={isCircular ? '#37C9B8' : '#54617A'}
            strokeWidth={isCircular ? 1.4 : 1.1}
            strokeDasharray={isCircular ? undefined : '3 5'}
            opacity={0.55}
          />
        )}

        {/* Current-flight trajectory trace (all stages) — dotted so the */}
        {/* student sees the actual path taken. This shows the elliptical */}
        {/* shape when v ≠ v_circ. It is NOT a preview; it renders only */}
        {/* during flight, so the blind-stage rule is preserved. */}
        {flight && (
          <path
            d={orbitPath(flight.orbit)}
            fill="none"
            stroke="#F97316"
            strokeWidth={1}
            strokeDasharray="1 4"
            opacity={0.6}
          />
        )}

        {/* Earth */}
        <Earth cx={CENTER.x} cy={CENTER.y} r={R_EARTH_SVG} />

        {/* Satellite: interactive when not in flight */}
        <g
          onPointerDown={satPointerDown}
          style={{ cursor: flight ? 'default' : draggingSat ? 'grabbing' : 'grab' }}
        >
          {/* Enlarged invisible hit area for easier grabbing */}
          <circle
            cx={kmToSvgX(satPos.x)}
            cy={kmToSvgY(satPos.y)}
            r={16}
            fill="transparent"
          />
          <Satellite
            x={kmToSvgX(satPos.x)}
            y={kmToSvgY(satPos.y)}
            angleRad={satAngleRad}
            dragging={draggingSat}
            inFlight={!!flight}
          />
        </g>

        {/* Focus marker at Earth centre (helps students see the two-body */}
        {/* geometry — the focus of every orbit is at Earth's centre). */}
        <circle cx={CENTER.x} cy={CENTER.y} r={1.6} fill="#F97316" opacity={0.85} />

        {/* μ readout — bottom-left of SVG, upper-left quadrant so it stays */}
        {/* clear of the reserved BR quadrant (§4.3). */}
        <text
          x={20}
          y={H - 20}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={10}
          textAnchor="start"
        >
          μ = 4·10⁵ km³/s²
        </text>
      </svg>

      {/* HUD overlays — HTML in `rem` (§4.3). BR stays empty. */}
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
      {/* TL secondary — orbit readouts + hit/shot counters. Stacked under TL */}
      <div
        style={{
          position: 'absolute',
          top: '8rem',
          left: '3rem',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '1.9rem',
          letterSpacing: '0.06em',
          color: '#54617A',
          zIndex: 5,
          pointerEvents: 'none',
          lineHeight: 1.5,
        }}
      >
        <div style={{ color: isCircular ? '#37C9B8' : '#54617A' }}>{vCircDisplay}</div>
        <div>{periodDisplay}</div>
        {(isStage2 || isStage3) && (
          <div style={{ marginTop: '0.8rem', color: '#B9C4D6' }}>
            {labels.hits} {hits.length}/{activeTargets.length}
          </div>
        )}
        {isStage3 && (
          <div style={{ color: shotsRemaining <= 1 ? '#F97316' : '#B9C4D6' }}>
            {labels.shots} {shotsRemaining}/{SHOT_BUDGET_STAGE3}
          </div>
        )}
      </div>

      {/* TR — live DOF readout. This is REQUIRED info (§4.7). */}
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

      {/* Stage-3 target periods list — required info per §4.7. Placed */}
      {/* just under the TR line so it stays clear of the reserved BR. */}
      {isStage3 && (
        <div
          style={{
            position: 'absolute',
            top: '8rem',
            right: '3rem',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '1.9rem',
            letterSpacing: '0.06em',
            color: '#B9C4D6',
            zIndex: 5,
            pointerEvents: 'none',
            textAlign: 'right',
            lineHeight: 1.6,
          }}
        >
          <div style={{ color: '#6C7A93', marginBottom: '0.3rem' }}>{labels.targets}</div>
          {activeTargets.map((rt, i) => {
            const hit = hits.includes(i)
            return (
              <div
                key={i}
                style={{
                  color: hit ? '#37C9B8' : '#B9C4D6',
                  textDecoration: hit ? 'line-through' : 'none',
                }}
              >
                T{i + 1} = {formatPeriod(period(rt))}
              </div>
            )
          })}
        </div>
      )}

      {/* BL — coaching tip or peek strategy hint (blind stage). */}
      <div
        style={{
          position: 'absolute',
          bottom: '3rem',
          left: '3rem',
          maxWidth: '50rem',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: isStage3 && peekTip ? '2rem' : '2.3rem',
          letterSpacing: '0.06em',
          color: isStage3 && peekTip ? '#F9A968' : '#6C7A93',
          zIndex: 5,
          pointerEvents: 'none',
          lineHeight: 1.35,
        }}
      >
        {hudBL}
      </div>

      {/* v slider — right side of canvas, vertical (rotated) */}
      <div
        style={{
          position: 'absolute',
          top: '14rem',
          right: '3rem',
          height: '38rem',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '1rem',
          zIndex: 6,
        }}
      >
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.9rem', color: '#6C7A93' }}>
          {V_MAX.toFixed(0)}
        </div>
        <div
          style={{
            width: '2rem',
            height: '30rem',
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <input
            type="range"
            min={V_MIN}
            max={V_MAX}
            step={0.1}
            value={vKmPerS}
            onChange={(e) => {
              setVKmPerS(Number(e.target.value))
              setVMoved(true)
            }}
            disabled={!!flight}
            style={{
              width: '30rem',
              height: '2rem',
              transform: 'rotate(-90deg)',
              transformOrigin: 'center',
              accentColor: '#F97316',
              cursor: flight ? 'not-allowed' : 'pointer',
            }}
          />
        </div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.9rem', color: '#6C7A93' }}>
          {V_MIN.toFixed(0)}
        </div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.7rem', color: '#54617A' }}>
          v (km/s)
        </div>
      </div>

      {/* Fire (launch) button */}
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
          className="bi bi-rocket-takeoff"
          style={{ marginInlineEnd: '0.8rem', fontSize: '2.6rem', verticalAlign: '-0.2rem' }}
        />
        {labels.launch}
      </button>
    </div>
  )
}
