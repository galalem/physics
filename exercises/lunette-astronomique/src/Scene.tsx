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
const AXIS_Y = 250
const X_OBJ = 180

// Slider ranges (mm, mapped 1:1 to SVG px)
const F1_MIN = 80
const F1_MAX = 280
const F1_DEFAULT = 200
const F2_MIN = 8
const F2_MAX = 40
const F2_DEFAULT = 20
const D_MIN = 60
const D_MAX = 340
const D_DEFAULT = 220

// Fixed incoming ray angle from a distant star (radians)
const ALPHA_IN = 0.05

// Visual aperture radii (SVG px)
const H_OBJ = 42
const H_EYE = 14

// Match tolerances
const G_TOL = 0.05 // ±5% on G
const D_TOL = 0.05 // ±5% on d relative to (f'1 + f'2)

// Coverage threshold for stage 1 advance
const COVERAGE_MIN_FRAC = 0.5

// Stage 2 target magnifications (sequential, fixed)
const STAGE2_TARGETS: number[] = [8, 15, 12]

// Stage 3 hand-authored target setups (seed-picked). Each target must be
// reachable given slider ranges + afocal constraint.
// Range checks: G_min = F1_MIN/F2_MAX = 2, G_max = F1_MAX/F2_MIN = 35.
// Afocal check: for any G* we can pick f'2 so that (f'2, G*·f'2, f'2·(1+G*))
// all fall in range. All targets below are within [5, 25] and comfortably feasible.
type Setup = { targets: number[] }
const STAGE3_SETUPS: Setup[] = [
  { targets: [10, 6, 20] },
  { targets: [15, 8, 22] },
  { targets: [5, 12, 18] },
  { targets: [7, 16, 24] },
]

// ─── Pure geometry helpers ──────────────────────────────────────────────
type Pt = { x: number; y: number }

/** Trace one ray through the two-lens system. Returns SVG-space polyline. */
function traceRay(h0: number, f1: number, f2: number, d: number): Pt[] {
  // At objective plane: (h0, ALPHA_IN)
  // Before objective, extrapolate back to x=0
  const hAt0 = h0 - ALPHA_IN * X_OBJ
  const p0: Pt = { x: 0, y: AXIS_Y - hAt0 }
  const pObj: Pt = { x: X_OBJ, y: AXIS_Y - h0 }

  // After objective: θ' = ALPHA_IN - h0 / f1
  const thetaAfterObj = ALPHA_IN - h0 / f1
  const xEye = X_OBJ + d
  const hAtEye = h0 + d * thetaAfterObj
  const pEye: Pt = { x: xEye, y: AXIS_Y - hAtEye }

  // After eyepiece: θ'' = θ' - hAtEye / f2
  const thetaAfterEye = thetaAfterObj - hAtEye / f2

  // Propagate to a fixed exit length (avoids off-canvas ray sweeps)
  const exitLen = Math.min(230, W - xEye - 8)
  const hAtExit = hAtEye + exitLen * thetaAfterEye
  const pExit: Pt = { x: xEye + exitLen, y: AXIS_Y - hAtExit }

  return [p0, pObj, pEye, pExit]
}

function formatG(g: number): string {
  const a = Math.abs(g)
  if (a >= 100) return `${g.toFixed(0)}×`
  if (a >= 10) return `${g.toFixed(1)}×`
  return `${g.toFixed(2)}×`
}
function formatDeg(rad: number): string {
  return `${((rad * 180) / Math.PI).toFixed(2)}°`
}

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

  const stageIdx = useCurrentStage()
  const setStage = useSetStage()

  // Stage-3 setup cycles when the student blows a shot budget.
  const [stage3Cycle, setStage3Cycle] = useState(0)
  const activeStage3 = useMemo(
    () => STAGE3_SETUPS[(seed + stage3Cycle) % STAGE3_SETUPS.length]!,
    [seed, stage3Cycle],
  )

  // DOF state
  const [f1, setF1] = useState(F1_DEFAULT)
  const [f2, setF2] = useState(F2_DEFAULT)
  const [d, setD] = useState(D_DEFAULT)

  // Coverage tracking for stage 1 advance
  const [f1Min, setF1Min] = useState(F1_DEFAULT)
  const [f1Max, setF1Max] = useState(F1_DEFAULT)
  const [f2Min, setF2Min] = useState(F2_DEFAULT)
  const [f2Max, setF2Max] = useState(F2_DEFAULT)
  const [dMinT, setDMinT] = useState(D_DEFAULT)
  const [dMaxT, setDMaxT] = useState(D_DEFAULT)

  // Sequential target progress (stages 2 & 3)
  const [targetIdx, setTargetIdx] = useState(0)
  const [results, setResults] = useState<boolean[]>([])

  // Peek badge visibility (stage 3)
  const [peekVisible, setPeekVisible] = useState(false)

  // Post-submit feedback flash (stage 3)
  const [flash, setFlash] = useState<{ hit: boolean; at: number } | null>(null)

  const complete = useComplete()
  const progress = useProgress()

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  const resetStageState = useCallback(() => {
    setF1(F1_DEFAULT)
    setF2(F2_DEFAULT)
    setD(D_DEFAULT)
    setF1Min(F1_DEFAULT); setF1Max(F1_DEFAULT)
    setF2Min(F2_DEFAULT); setF2Max(F2_DEFAULT)
    setDMinT(D_DEFAULT); setDMaxT(D_DEFAULT)
    setTargetIdx(0)
    setResults([])
    setPeekVisible(false)
    setFlash(null)
  }, [])
  useReset(resetStageState)

  // ─── Derived quantities ─────────────────────────────────────────────
  const G = f1 / f2
  const dAfocal = f1 + f2
  const afocalErrRel = Math.abs(d - dAfocal) / dAfocal

  const f1Coverage = (f1Max - f1Min) / (F1_MAX - F1_MIN)
  const f2Coverage = (f2Max - f2Min) / (F2_MAX - F2_MIN)
  const dCoverage = (dMaxT - dMinT) / (D_MAX - D_MIN)
  const stage1Done =
    f1Coverage >= COVERAGE_MIN_FRAC &&
    f2Coverage >= COVERAGE_MIN_FRAC &&
    dCoverage >= COVERAGE_MIN_FRAC

  const activeTargets = isStage2
    ? STAGE2_TARGETS
    : isStage3
      ? activeStage3.targets
      : []
  const currentTarget = activeTargets[targetIdx]

  const gErrRel = currentTarget !== undefined
    ? Math.abs(G - currentTarget) / currentTarget
    : 1
  const matchOk = gErrRel < G_TOL && afocalErrRel < D_TOL

  const canConfirm = isStage2 && matchOk && targetIdx < activeTargets.length
  const canFire = isStage3 && targetIdx < activeTargets.length

  const hitCount = results.filter(Boolean).length

  // ─── Commit action (Confirm / Fire) ────────────────────────────────
  const commit = useCallback(() => {
    if (isStage2 && canConfirm) {
      setResults((prev) => [...prev, true])
      setTargetIdx((i) => i + 1)
    } else if (isStage3 && canFire) {
      const hit = matchOk
      setResults((prev) => [...prev, hit])
      setTargetIdx((i) => i + 1)
      setFlash({ hit, at: Date.now() })
    }
  }, [isStage2, isStage3, canConfirm, canFire, matchOk])

  // Flash timeout (visual)
  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash(null), 900)
    return () => clearTimeout(t)
  }, [flash])

  // ─── Stage-3 fail: cycle setup and reset shot state on incomplete run ─
  useEffect(() => {
    if (!isStage3) return
    const allFired = targetIdx >= activeTargets.length
    const allHit = hitCount === activeTargets.length
    if (allFired && !allHit) {
      const t = setTimeout(() => {
        setStage3Cycle((c) => c + 1)
        setTargetIdx(0)
        setResults([])
        setFlash(null)
      }, 900)
      return () => clearTimeout(t)
    }
    return
  }, [isStage3, targetIdx, hitCount, activeTargets.length])

  // ─── canSubmit + progress ───────────────────────────────────────────
  const canSubmit = isStage1
    ? stage1Done
    : isStage2
      ? hitCount === activeTargets.length
      : hitCount === activeTargets.length

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

  usePeek(() => {
    if (!isStage3) return
    setPeekVisible(true)
  })
  useEffect(() => {
    if (!peekVisible) return
    const t = setTimeout(() => setPeekVisible(false), 1800)
    return () => clearTimeout(t)
  }, [peekVisible])

  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  // Spacebar commits on stages 2 & 3
  useEffect(() => {
    if (isStage1) return
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault()
        commit()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isStage1, commit])

  // ─── Ray traces (hidden on stage 3) ────────────────────────────────
  const showRays = isStage1 || isStage2
  const rayHeights = useMemo(() => [-H_OBJ * 0.72, 0, H_OBJ * 0.72], [])
  const traces = useMemo(
    () => rayHeights.map((h0) => traceRay(h0, f1, f2, d)),
    [rayHeights, f1, f2, d],
  )

  const xEye = X_OBJ + d

  // Intermediate image (stage 1 only, marker)
  const xImg = X_OBJ + f1
  const yImg = AXIS_Y - f1 * ALPHA_IN

  // ─── HUD strings ────────────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`

  const hudTR = isStage1
    ? `G = ${formatG(G)}`
    : isStage2
      ? matchOk
        ? `✓ ${labels.match_ok}`
        : `G = ${formatG(G)}  · ΔG = ${(100 * gErrRel).toFixed(1)}%`
      : `G* = ${formatG(currentTarget ?? 0)}`

  const hudBL = isStage1 ? labels.tip1 : isStage2 ? labels.tip2 : labels.tip3

  const showTargetProgress = (isStage2 || isStage3) && targetIdx < activeTargets.length

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block', userSelect: 'none' }}
      >
        {/* Background — NO borderRadius on <svg>, NO rx on this rect */}
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        {/* Bench frame */}
        <rect x={32} y={60} width={720} height={358} fill="none" stroke="#12203a" strokeWidth={1} rx={6} />
        <text x={40} y={52} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={11} letterSpacing="0.1em">
          {labels.bench}
        </text>

        {/* Optical axis */}
        <line x1={40} y1={AXIS_Y} x2={W - 32} y2={AXIS_Y}
          stroke="#2A3654" strokeWidth={1} strokeDasharray="2 4" />

        {/* Distant star + α label (top-left of bench) */}
        <g>
          <text x={54} y={AXIS_Y - ALPHA_IN * X_OBJ - H_OBJ - 6}
            fill="#F9A968" fontFamily="'JetBrains Mono', monospace" fontSize={14}>
            ★
          </text>
          <text x={72} y={AXIS_Y - ALPHA_IN * X_OBJ - H_OBJ - 6}
            fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={10}>
            {labels.star}
          </text>
          <text x={54} y={AXIS_Y + 22}
            fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={10}>
            α = {formatDeg(ALPHA_IN)}
          </text>
        </g>

        {/* Ray bundle (stages 1 & 2) */}
        {showRays && traces.map((pts, i) => (
          <g key={`ray-${i}`}>
            {[0, 1, 2].map((seg) => (
              <g key={`seg-${seg}`}>
                <line
                  x1={pts[seg]!.x} y1={pts[seg]!.y}
                  x2={pts[seg + 1]!.x} y2={pts[seg + 1]!.y}
                  stroke="rgba(249,115,22,.22)" strokeWidth={5.5} strokeLinecap="round"
                />
                <line
                  x1={pts[seg]!.x} y1={pts[seg]!.y}
                  x2={pts[seg + 1]!.x} y2={pts[seg + 1]!.y}
                  stroke="#F97316" strokeWidth={1.6} strokeLinecap="round"
                />
              </g>
            ))}
          </g>
        ))}

        {/* Intermediate image marker (stage 1 only — help for understanding) */}
        {isStage1 && xImg > X_OBJ + 8 && xImg < W - 20 && (
          <g>
            <line x1={xImg} y1={yImg - 6} x2={xImg} y2={yImg + 6}
              stroke="#37C9B8" strokeWidth={1.5} />
            <line x1={xImg - 6} y1={yImg} x2={xImg + 6} y2={yImg}
              stroke="#37C9B8" strokeWidth={1.5} />
            <text x={xImg + 9} y={yImg - 4}
              fill="#37C9B8" fontFamily="'JetBrains Mono', monospace" fontSize={9}>
              F'₁
            </text>
          </g>
        )}

        {/* Objective lens */}
        <g>
          <ellipse cx={X_OBJ} cy={AXIS_Y} rx={5} ry={H_OBJ}
            fill="rgba(55,201,184,0.16)" stroke="#37C9B8" strokeWidth={1.4} />
          <line x1={X_OBJ - 4} y1={AXIS_Y - H_OBJ - 3} x2={X_OBJ + 4} y2={AXIS_Y - H_OBJ - 3}
            stroke="#37C9B8" strokeWidth={1.4} strokeLinecap="round" />
          <line x1={X_OBJ - 4} y1={AXIS_Y + H_OBJ + 3} x2={X_OBJ + 4} y2={AXIS_Y + H_OBJ + 3}
            stroke="#37C9B8" strokeWidth={1.4} strokeLinecap="round" />
          <text x={X_OBJ} y={AXIS_Y - H_OBJ - 8}
            fill="#37C9B8" fontFamily="'JetBrains Mono', monospace" fontSize={10} textAnchor="middle">
            f'₁ = {f1.toFixed(0)}mm
          </text>
          <text x={X_OBJ} y={AXIS_Y + H_OBJ + 20}
            fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={10} textAnchor="middle">
            {labels.objective}
          </text>
        </g>

        {/* Eyepiece lens */}
        <g>
          <ellipse cx={xEye} cy={AXIS_Y} rx={4} ry={H_EYE}
            fill="rgba(55,201,184,0.16)" stroke="#37C9B8" strokeWidth={1.4} />
          <line x1={xEye - 3} y1={AXIS_Y - H_EYE - 3} x2={xEye + 3} y2={AXIS_Y - H_EYE - 3}
            stroke="#37C9B8" strokeWidth={1.4} strokeLinecap="round" />
          <line x1={xEye - 3} y1={AXIS_Y + H_EYE + 3} x2={xEye + 3} y2={AXIS_Y + H_EYE + 3}
            stroke="#37C9B8" strokeWidth={1.4} strokeLinecap="round" />
          <text x={xEye} y={AXIS_Y - H_EYE - 8}
            fill="#37C9B8" fontFamily="'JetBrains Mono', monospace" fontSize={10} textAnchor="middle">
            f'₂ = {f2.toFixed(1)}mm
          </text>
          <text x={xEye} y={AXIS_Y + H_EYE + 22}
            fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={10} textAnchor="middle">
            {labels.eyepiece}
          </text>
        </g>

        {/* Spacing indicator (d, below lenses) */}
        <g>
          <line x1={X_OBJ} y1={AXIS_Y + H_OBJ + 34} x2={xEye} y2={AXIS_Y + H_OBJ + 34}
            stroke="#54617A" strokeWidth={1} />
          <line x1={X_OBJ} y1={AXIS_Y + H_OBJ + 30} x2={X_OBJ} y2={AXIS_Y + H_OBJ + 38}
            stroke="#54617A" strokeWidth={1} />
          <line x1={xEye} y1={AXIS_Y + H_OBJ + 30} x2={xEye} y2={AXIS_Y + H_OBJ + 38}
            stroke="#54617A" strokeWidth={1} />
          <text x={(X_OBJ + xEye) / 2} y={AXIS_Y + H_OBJ + 30}
            fill="#54617A" fontFamily="'JetBrains Mono', monospace" fontSize={9} textAnchor="middle">
            d = {d.toFixed(0)}mm
          </text>
        </g>

        {/* Afocal indicator bar (stages 1 & 2 only — feedback removed on stage 3) */}
        {(isStage1 || isStage2) && (
          <g>
            <rect x={X_OBJ} y={AXIS_Y + H_OBJ + 46}
              width={Math.max(6, xEye - X_OBJ)} height={4}
              fill={afocalErrRel < D_TOL ? '#37C9B8' : '#F97316'} opacity={0.55} />
            <text x={(X_OBJ + xEye) / 2} y={AXIS_Y + H_OBJ + 62}
              fill={afocalErrRel < D_TOL ? '#37C9B8' : '#F9A968'}
              fontFamily="'JetBrains Mono', monospace" fontSize={9} textAnchor="middle">
              {afocalErrRel < D_TOL ? labels.afocal_ok : labels.afocal_off}
              {' '}(Δd = {(100 * afocalErrRel).toFixed(1)}%)
            </text>
          </g>
        )}

        {/* Peek strategy hint (stage 3) */}
        {isStage3 && peekVisible && (
          <g>
            <rect x={W / 2 - 265} y={12} width={530} height={50} rx={8}
              fill="rgba(13,21,36,.92)" stroke="#F97316" strokeWidth={1.5} />
            <text x={W / 2} y={32} fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={12} fontWeight={700} textAnchor="middle">
              {labels.peek_line1}
            </text>
            <text x={W / 2} y={52} fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={11} textAnchor="middle">
              {labels.peek_line2}
            </text>
          </g>
        )}

        {/* Post-submit fire flash (stage 3) */}
        {isStage3 && flash && (
          <g>
            <rect x={W / 2 - 60} y={H - 130} width={120} height={32} rx={16}
              fill={flash.hit ? 'rgba(55,201,184,0.88)' : 'rgba(232,93,93,0.88)'} />
            <text x={W / 2} y={H - 108} fill="#0D1524"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={14} fontWeight={800} letterSpacing="0.14em" textAnchor="middle">
              {flash.hit ? labels.hit : labels.miss}
            </text>
          </g>
        )}
      </svg>

      {/* HUD — HTML overlays in rem (TL, TR, BL). BR reserved for parent chrome. */}
      <div style={{
        position: 'absolute', top: '3rem', left: '3rem',
        fontFamily: "'JetBrains Mono', monospace", fontSize: '2.3rem',
        letterSpacing: '0.14em', textTransform: 'uppercase',
        color: '#6C7A93', zIndex: 5, pointerEvents: 'none',
      }}>
        {hudTL}
      </div>
      <div style={{
        position: 'absolute', top: '3rem', right: '3rem',
        fontFamily: "'JetBrains Mono', monospace", fontSize: '2.3rem',
        letterSpacing: '0.08em',
        color: (isStage2 || isStage3) && matchOk && isStage2 ? '#37C9B8' : '#B9C4D6',
        zIndex: 5, pointerEvents: 'none', textAlign: 'right',
      }}>
        {hudTR}
      </div>
      <div style={{
        position: 'absolute', bottom: '3rem', left: '3rem',
        fontFamily: "'JetBrains Mono', monospace", fontSize: '2.3rem',
        letterSpacing: '0.06em', color: '#6C7A93',
        zIndex: 5, pointerEvents: 'none', maxWidth: '52%',
      }}>
        {hudBL}
      </div>

      {/* Target progress line (below TL) */}
      {showTargetProgress && (
        <div style={{
          position: 'absolute', top: '7.5rem', left: '3rem',
          fontFamily: "'JetBrains Mono', monospace", fontSize: '1.8rem',
          letterSpacing: '0.10em', color: '#37C9B8',
          zIndex: 5, pointerEvents: 'none',
        }}>
          {labels.target_short} {Math.min(targetIdx + 1, activeTargets.length)}/{activeTargets.length}
          {' · '}G* = {formatG(currentTarget ?? 0)}
          {isStage3 && (
            <>
              {' · '}
              <span style={{ color: '#B9C4D6' }}>{labels.shot} {targetIdx + 1}/{activeTargets.length}</span>
            </>
          )}
        </div>
      )}

      {/* Result markers (stages 2 & 3): green = hit, red = miss, dim = pending */}
      {(isStage2 || isStage3) && (
        <div style={{
          position: 'absolute', top: '10.5rem', left: '3rem',
          fontFamily: "'JetBrains Mono', monospace", fontSize: '2.2rem',
          letterSpacing: '0.16em', zIndex: 5, pointerEvents: 'none',
        }}>
          {activeTargets.map((_, i) => {
            const done = i < results.length
            const hit = results[i] === true
            const color = done ? (hit ? '#37C9B8' : '#E85D5D') : '#3A4863'
            return (
              <span key={i} style={{ color, marginInlineEnd: '0.7rem' }}>▪</span>
            )
          })}
        </div>
      )}

      {/* Blind-stage required-info readout (α + current DOFs) */}
      {isStage3 && (
        <div style={{
          position: 'absolute', top: '13.5rem', left: '3rem',
          fontFamily: "'JetBrains Mono', monospace", fontSize: '1.6rem',
          letterSpacing: '0.08em', color: '#B9C4D6',
          zIndex: 5, pointerEvents: 'none',
        }}>
          α = {formatDeg(ALPHA_IN)}
          {'  ·  '}f'₁ = {f1.toFixed(0)}
          {'  ·  '}f'₂ = {f2.toFixed(1)}
          {'  ·  '}d = {d.toFixed(0)}
        </div>
      )}

      {/* Confirm / Fire button — bottom-center. BR corner intentionally empty. */}
      {(isStage2 || isStage3) && (
        <button
          type="button"
          onClick={commit}
          disabled={isStage2 ? !canConfirm : !canFire}
          style={{
            position: 'absolute', bottom: '3rem', left: '50%',
            transform: 'translateX(-50%)',
            padding: '2rem 4rem',
            background: (isStage2 ? canConfirm : canFire) ? '#F97316' : 'rgba(30,42,64,0.85)',
            color: (isStage2 ? canConfirm : canFire) ? '#FFFFFF' : '#6C7A93',
            border: `0.3rem solid ${(isStage2 ? canConfirm : canFire) ? '#F97316' : 'rgba(58,72,99,0.6)'}`,
            borderRadius: '100rem',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '2.6rem', fontWeight: 700, letterSpacing: '0.12em',
            cursor: (isStage2 ? canConfirm : canFire) ? 'pointer' : 'not-allowed',
            zIndex: 10,
          }}
        >
          <i
            className={isStage2 ? 'bi bi-check-lg' : 'bi bi-crosshair'}
            style={{ marginInlineEnd: '0.8rem', fontSize: '2.8rem', verticalAlign: '-0.2rem' }}
          />
          {isStage2 ? labels.confirm : labels.fire}
        </button>
      )}

      {/* Sliders (top-right column) */}
      <div style={{
        position: 'absolute', top: '6rem', right: '3rem',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', gap: '1.5rem', zIndex: 6,
      }}>
        <SliderVertical
          label="f'₁"
          unit="mm"
          value={f1}
          min={F1_MIN}
          max={F1_MAX}
          step={1}
          format={(v) => v.toFixed(0)}
          onChange={(v) => {
            setF1(v)
            setF1Min((prev) => Math.min(prev, v))
            setF1Max((prev) => Math.max(prev, v))
          }}
        />
        <SliderVertical
          label="f'₂"
          unit="mm"
          value={f2}
          min={F2_MIN}
          max={F2_MAX}
          step={0.1}
          format={(v) => v.toFixed(1)}
          onChange={(v) => {
            setF2(v)
            setF2Min((prev) => Math.min(prev, v))
            setF2Max((prev) => Math.max(prev, v))
          }}
        />
        <SliderVertical
          label="d"
          unit="mm"
          value={d}
          min={D_MIN}
          max={D_MAX}
          step={1}
          format={(v) => v.toFixed(0)}
          onChange={(v) => {
            setD(v)
            setDMinT((prev) => Math.min(prev, v))
            setDMaxT((prev) => Math.max(prev, v))
          }}
        />
      </div>
    </div>
  )
}

// ─── Vertical slider primitive (adapted from diffraction) ───────────────
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
        {label} = {format(value)}{unit}
      </div>
    </div>
  )
}
