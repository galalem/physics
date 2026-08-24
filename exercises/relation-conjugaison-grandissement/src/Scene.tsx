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

// ─── Canvas ─────────────────────────────────────────────────────────────
const W = 800
const H = 450

// ─── Bench geometry (SVG units) ─────────────────────────────────────────
const AXIS_Y = 225
const LENS_X = 400
const PX_PER_MM = 1.5 // 200 mm ≈ 300 px
const BENCH_LEFT = 40
const BENCH_RIGHT = 760
const BENCH_TOP = 60
const BENCH_BOT = 400

// ─── Physical parameters (Descartes algebraic convention, mm) ───────────
// Real object: p = OA < 0, to the left of lens.
// Converging lens: f' > 0.
const P_MIN = -180
const P_MAX = -8
const P_DEFAULT = -60
const F_MIN = 15
const F_MAX = 80
const F_DEFAULT = 40

// Object arrow height (mm). Fixed — magnification comes from the image only.
const AB_MM = 12

// Numerical guard: when p is within GUARD_MM of −f', the image runs to
// infinity. Freeze the image outside the canvas rather than dividing.
const GUARD_MM = 2

// Match tolerances
const S2_P_TOL = 0.05  // ±5 % on p
const S2_G_TOL = 0.08  // ±8 % on γ
const S3_P_TOL = 0.06
const S3_G_TOL = 0.10

// Shot budgets
const STAGE2_SHOT_BUDGET = 5

// ─── Stage-2 targets (p*, γ*) — sequential ghost images ─────────────────
// Each pair is realisable with (p, f') inside the slider ranges.
type Target2 = { id: string; pStar: number; gStar: number }
const STAGE2_TARGETS: Target2[] = [
  { id: 't2a', pStar: -60, gStar: -2 },   // p=-60, f'=40 → p'=120, γ=-2 (real, inverted, ×2)
  { id: 't2b', pStar: -80, gStar: -1 },   // p=-80, f'=40 → p'=80,  γ=-1 (real, inverted, ×1)
  { id: 't2c', pStar: -30, gStar: 2 },    // p=-30, f'=60 → p'=-60, γ=2  (virtual, upright, ×2)
]

// ─── Stage-3 setups (blind eval) — (p'*, γ*) pairs ──────────────────────
// Each setup has K=3 sequential targets. Miss the shot budget → next setup.
type Target3 = { id: string; pPrimeStar: number; gStar: number }
type Setup3 = { targets: Target3[] }
const STAGE3_SETUPS: Setup3[] = [
  {
    targets: [
      // p=-60, f'=40 → p'=120, γ=-2 (real, inverted, ×2)
      { id: 's0a', pPrimeStar: 120, gStar: -2 },
      // p=-40, f'=30 → p'=120, γ=-3 (same p' but different γ ⇒ different p, f')
      { id: 's0b', pPrimeStar: 120, gStar: -3 },
      // p=-30, f'=60 → p'=-60, γ=2  (virtual, upright — sign-convention wrinkle)
      { id: 's0c', pPrimeStar: -60, gStar: 2 },
    ],
  },
  {
    targets: [
      // p=-30, f'=60 → p'=-60, γ=2 (virtual)
      { id: 's1a', pPrimeStar: -60, gStar: 2 },
      // p=-90, f'=60 → p'=180, γ=-2
      { id: 's1b', pPrimeStar: 180, gStar: -2 },
      // p=-80, f'=40 → p'=80,  γ=-1
      { id: 's1c', pPrimeStar: 80, gStar: -1 },
    ],
  },
  {
    targets: [
      // p=-80, f'=40 → p'=80,  γ=-1
      { id: 's2a', pPrimeStar: 80, gStar: -1 },
      // p=-45, f'=30 → p'=90,  γ=-2
      { id: 's2b', pPrimeStar: 90, gStar: -2 },
      // p=-30, f'=45 → p'=-90, γ=3 (virtual, strongly enlarged)
      { id: 's2c', pPrimeStar: -90, gStar: 3 },
    ],
  },
  {
    targets: [
      // p=-100, f'=50 → p'=100, γ=-1
      { id: 's3a', pPrimeStar: 100, gStar: -1 },
      // p=-60,  f'=30 → p'=60,  γ=-1 (same γ, different p')
      { id: 's3b', pPrimeStar: 60, gStar: -1 },
      // p=-45, f'=60 → p'=-180, γ=4 (virtual, ×4)
      { id: 's3c', pPrimeStar: -180, gStar: 4 },
    ],
  },
]

// ─── i18n loader ────────────────────────────────────────────────────────
const dict = { en } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── Optics (Descartes signed convention) ───────────────────────────────
function imagePosition(p: number, fPrime: number): { pPrime: number; gamma: number; atInfinity: boolean } {
  const denom = p + fPrime
  if (Math.abs(denom) < GUARD_MM) {
    return { pPrime: Number.POSITIVE_INFINITY, gamma: Number.POSITIVE_INFINITY, atInfinity: true }
  }
  const pPrime = (fPrime * p) / denom
  const gamma = pPrime / p
  return { pPrime, gamma, atInfinity: false }
}

function svgFromP(p: number) { return LENS_X + p * PX_PER_MM }
function svgYFromAB(abMm: number) { return AXIS_Y - abMm * PX_PER_MM }

// Clamp a value between lo and hi
function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)) }

function fmtP(mm: number) {
  if (!isFinite(mm)) return '∞'
  return `${mm >= 0 ? '+' : ''}${mm.toFixed(1)}mm`
}
function fmtG(g: number) {
  if (!isFinite(g)) return '∞'
  return `${g >= 0 ? '+' : ''}${g.toFixed(2)}`
}

// ─── Component ──────────────────────────────────────────────────────────
export default function Scene() {
  const { locale, seed } = useInit()
  const stages = useMemo(() => getStagesFor(locale), [locale])
  useDeclareStages(stages)
  const labels = useMemo(() => svgLabels(locale), [locale])

  const stageIdx = useCurrentStage()
  const setStage = useSetStage()
  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  // ─── State ────────────────────────────────────────────────────────────
  const [p, setP] = useState(P_DEFAULT)
  const [fPrime, setFPrime] = useState(F_DEFAULT)

  // Stage-1 coverage: track the swept range on both sliders and whether p
  // has been observed on both sides of −f'.
  const [pMin, setPMin] = useState(P_DEFAULT)
  const [pMax, setPMax] = useState(P_DEFAULT)
  const [fMin, setFMin] = useState(F_DEFAULT)
  const [fMax, setFMax] = useState(F_DEFAULT)
  const [sawReal, setSawReal] = useState(false)     // p < −f' → real image
  const [sawVirtual, setSawVirtual] = useState(false) // p > −f' → virtual image

  // Stage-2 sequential targets
  const [s2Idx, setS2Idx] = useState(0)
  const [s2Lit, setS2Lit] = useState<string[]>([])
  const [s2Shots, setS2Shots] = useState(0)

  // Stage-3 sequential targets, one shot per target, setup-cycled on failure
  const [setupOffset, setSetupOffset] = useState(0)
  const [s3Idx, setS3Idx] = useState(0)
  const [s3Lit, setS3Lit] = useState<string[]>([])

  const [peekVisible, setPeekVisible] = useState(false)
  const [flash, setFlash] = useState<{ ok: boolean; at: number } | null>(null)

  const stage3Setup = STAGE3_SETUPS[(seed + setupOffset) % STAGE3_SETUPS.length]!
  const s3Targets = stage3Setup.targets

  const setPTrack = useCallback((v: number) => {
    setP(v)
    setPMin((cur) => Math.min(cur, v))
    setPMax((cur) => Math.max(cur, v))
    if (v < -fPrime) setSawReal(true)
    if (v > -fPrime) setSawVirtual(true)
  }, [fPrime])

  const setFTrack = useCallback((v: number) => {
    setFPrime(v)
    setFMin((cur) => Math.min(cur, v))
    setFMax((cur) => Math.max(cur, v))
    if (p < -v) setSawReal(true)
    if (p > -v) setSawVirtual(true)
  }, [p])

  const complete = useComplete()
  const progress = useProgress()

  // ─── Reset ────────────────────────────────────────────────────────────
  const resetStageState = useCallback(() => {
    setP(P_DEFAULT)
    setFPrime(F_DEFAULT)
    setPMin(P_DEFAULT); setPMax(P_DEFAULT)
    setFMin(F_DEFAULT); setFMax(F_DEFAULT)
    setSawReal(false); setSawVirtual(false)
    setS2Idx(0); setS2Lit([]); setS2Shots(0)
    setS3Idx(0); setS3Lit([])
    setPeekVisible(false)
    setFlash(null)
  }, [])
  useReset(resetStageState)

  // ─── Live optics ──────────────────────────────────────────────────────
  const { pPrime, gamma, atInfinity } = useMemo(() => imagePosition(p, fPrime), [p, fPrime])

  // ─── Match tests ──────────────────────────────────────────────────────
  const s2Current = STAGE2_TARGETS[s2Idx]
  const s2MatchNow = useMemo(() => {
    if (!s2Current || atInfinity) return false
    const dp = Math.abs(p - s2Current.pStar) / Math.max(1, Math.abs(s2Current.pStar))
    const dg = Math.abs(gamma - s2Current.gStar) / Math.max(0.5, Math.abs(s2Current.gStar))
    // Signs must match too
    if (Math.sign(gamma) !== Math.sign(s2Current.gStar)) return false
    return dp < S2_P_TOL && dg < S2_G_TOL
  }, [s2Current, p, gamma, atInfinity])

  const s3Current = s3Targets[s3Idx]
  const s3MatchNow = useMemo(() => {
    if (!s3Current || atInfinity) return false
    const dpp = Math.abs(pPrime - s3Current.pPrimeStar) / Math.max(1, Math.abs(s3Current.pPrimeStar))
    const dg = Math.abs(gamma - s3Current.gStar) / Math.max(0.5, Math.abs(s3Current.gStar))
    if (Math.sign(pPrime) !== Math.sign(s3Current.pPrimeStar)) return false
    if (Math.sign(gamma) !== Math.sign(s3Current.gStar)) return false
    return dpp < S3_P_TOL && dg < S3_G_TOL
  }, [s3Current, pPrime, gamma, atInfinity])

  // ─── CHECK button (fire) ──────────────────────────────────────────────
  const canCheckS2 = isStage2 && s2Shots < STAGE2_SHOT_BUDGET && s2Idx < STAGE2_TARGETS.length
  const canCheckS3 = isStage3 && s3Idx < s3Targets.length
  const canCheck = canCheckS2 || canCheckS3

  const check = useCallback(() => {
    if (isStage2 && canCheckS2) {
      setS2Shots((s) => s + 1)
      if (s2MatchNow && s2Current) {
        setS2Lit((prev) => [...prev, s2Current.id])
        setS2Idx((i) => i + 1)
        setFlash({ ok: true, at: Date.now() })
      } else {
        setFlash({ ok: false, at: Date.now() })
      }
    } else if (isStage3 && canCheckS3) {
      if (s3MatchNow && s3Current) {
        setS3Lit((prev) => [...prev, s3Current.id])
        setFlash({ ok: true, at: Date.now() })
      } else {
        setFlash({ ok: false, at: Date.now() })
      }
      // One-shot-per-target: advance regardless of hit
      setS3Idx((i) => i + 1)
    }
  }, [isStage2, isStage3, canCheckS2, canCheckS3, s2MatchNow, s3MatchNow, s2Current, s3Current])

  // ─── Blind-stage fail-with-restart ────────────────────────────────────
  useEffect(() => {
    if (!isStage3) return
    const allShotsFired = s3Idx >= s3Targets.length
    const allLit = s3Lit.length === s3Targets.length
    if (allShotsFired && !allLit) {
      // Missed at least one target — cycle to next setup and restart.
      const t = setTimeout(() => {
        setSetupOffset((k) => k + 1)
        setP(P_DEFAULT)
        setFPrime(F_DEFAULT)
        setS3Idx(0)
        setS3Lit([])
        setFlash(null)
      }, 900)
      return () => clearTimeout(t)
    }
  }, [isStage3, s3Idx, s3Targets.length, s3Lit.length])

  // Flash auto-fade
  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash(null), 700)
    return () => clearTimeout(t)
  }, [flash])

  // ─── Advance predicate ────────────────────────────────────────────────
  const pCoverage = (pMax - pMin) / (P_MAX - P_MIN)
  const fCoverage = (fMax - fMin) / (F_MAX - F_MIN)
  const stage1Done = pCoverage >= 0.5 && fCoverage >= 0.3 && sawReal && sawVirtual

  const canSubmit = isStage1
    ? stage1Done
    : isStage2
      ? s2Lit.length === STAGE2_TARGETS.length
      : s3Lit.length === s3Targets.length

  useEffect(() => {
    progress(stageIdx / 3, { stage: stageIdx, canSubmit })
  }, [stageIdx, canSubmit, progress])

  useNext(() => {
    if (stageIdx < 3) { setStage(stageIdx + 1); resetStageState() }
    else complete({ success: true })
  })

  // ─── Peek (§4.7 rule 4 — strategy hint) ───────────────────────────────
  usePeek(() => {
    if (!isStage3) return
    setPeekVisible(true)
  })
  useEffect(() => {
    if (!peekVisible) return
    const t = setTimeout(() => setPeekVisible(false), 2400)
    return () => clearTimeout(t)
  }, [peekVisible])

  // ─── Hints ────────────────────────────────────────────────────────────
  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  // ─── Rendering helpers ────────────────────────────────────────────────
  // Object arrow always at svgFromP(p), pointing UP.
  const objSvgX = svgFromP(p)
  const objTipY = svgYFromAB(AB_MM)

  // Image: only compute svg position if within reasonable bounds and not at ∞
  const imageSvgX = atInfinity ? null : svgFromP(pPrime)
  const imageAbSvgMm = atInfinity ? 0 : gamma * AB_MM
  const imageTipY = atInfinity ? AXIS_Y : svgYFromAB(imageAbSvgMm)
  const imageOnScreen = imageSvgX !== null && imageSvgX > BENCH_LEFT + 5 && imageSvgX < BENCH_RIGHT - 5

  // Focal points on the axis
  const FprimeSvgX = LENS_X + fPrime * PX_PER_MM
  const FSvgX = LENS_X - fPrime * PX_PER_MM

  // ─── Three characteristic rays (stages 1 & 2) ─────────────────────────
  const characteristicRays = useMemo(() => {
    if (isStage3 || atInfinity) return null
    if (!imageOnScreen) return null
    if (imageSvgX === null) return null
    const B = { x: objSvgX, y: objTipY }
    const Bp = { x: imageSvgX, y: imageTipY }
    const paths: React.ReactNode[] = []
    // Ray 1: parallel to axis, then through F' after the lens
    paths.push(
      <line key="r1a" x1={B.x} y1={B.y} x2={LENS_X} y2={B.y}
        stroke="rgba(249,115,22,0.6)" strokeWidth={1.2} strokeLinecap="round" />,
    )
    // From lens through F' toward image tip, extended
    const dx1 = FprimeSvgX - LENS_X
    const dy1 = AXIS_Y - B.y
    // Parametric: (LENS_X + t*dx1, B.y + t*dy1) — pick t large enough to pass image
    const t1 = (Bp.x - LENS_X) / (dx1 || 1)
    const endX1 = LENS_X + t1 * dx1
    const endY1 = B.y + t1 * dy1
    paths.push(
      <line key="r1b" x1={LENS_X} y1={B.y} x2={endX1} y2={endY1}
        stroke="rgba(249,115,22,0.6)" strokeWidth={1.2} strokeLinecap="round" />,
    )
    // Ray 2: through optical centre O — straight line B → Bp
    paths.push(
      <line key="r2" x1={B.x} y1={B.y} x2={Bp.x} y2={Bp.y}
        stroke="rgba(55,201,184,0.55)" strokeWidth={1.2} strokeLinecap="round" strokeDasharray="4 4" />,
    )
    // Ray 3: through F then parallel to axis after lens
    // From B toward F, extended to LENS_X.
    const dx3 = FSvgX - B.x
    const dy3 = AXIS_Y - B.y
    const t3 = (LENS_X - B.x) / (dx3 || 1)
    const lensYFromR3 = B.y + t3 * dy3
    paths.push(
      <line key="r3a" x1={B.x} y1={B.y} x2={LENS_X} y2={lensYFromR3}
        stroke="rgba(249,168,104,0.55)" strokeWidth={1.2} strokeLinecap="round" />,
    )
    // Ray 3b: after lens, parallel to axis at height lensYFromR3, extended to image tip
    paths.push(
      <line key="r3b" x1={LENS_X} y1={lensYFromR3} x2={Bp.x} y2={lensYFromR3}
        stroke="rgba(249,168,104,0.55)" strokeWidth={1.2} strokeLinecap="round" />,
    )
    return paths
  }, [isStage3, atInfinity, imageOnScreen, imageSvgX, objSvgX, objTipY, imageTipY, FprimeSvgX, FSvgX])

  // ─── Stage-2 ghost image (target visualisation) ───────────────────────
  const ghostImage = useMemo(() => {
    if (!isStage2 || !s2Current) return null
    const denom = s2Current.pStar + fPrime // not used; ghost is computed from (pStar, gStar) directly
    void denom
    const ghostP = s2Current.pStar
    const ghostPPrime = ghostP * s2Current.gStar
    const ghostAb = s2Current.gStar * AB_MM
    return {
      objX: svgFromP(ghostP),
      imgX: svgFromP(ghostPPrime),
      imgTipY: svgYFromAB(ghostAb),
      abMm: ghostAb,
      isVirtual: ghostPPrime < 0,
    }
  }, [isStage2, s2Current, fPrime])

  // ─── HUD strings ──────────────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`

  const hudTR = isStage1
    ? (atInfinity ? `p' = ∞` : `p' = ${fmtP(pPrime)} · γ = ${fmtG(gamma)}`)
    : isStage2
      ? s2Current
        ? `target: p*=${fmtP(s2Current.pStar)} · γ*=${fmtG(s2Current.gStar)}`
        : `${labels.match_ok}`
      : s3Current
        ? `target: p'*=${fmtP(s3Current.pPrimeStar)} · γ*=${fmtG(s3Current.gStar)}`
        : `${labels.match_ok}`

  const hudBL = isStage1 ? labels.tip1 : isStage2 ? labels.tip2 : labels.tip3

  // Stage-2 progress (TL secondary — BR reserved)
  const hudProgress = isStage2
    ? `${labels.shots} ${s2Shots}/${STAGE2_SHOT_BUDGET} · ${labels.lit} ${s2Lit.length}/${STAGE2_TARGETS.length}`
    : isStage3
      ? `${labels.target} ${Math.min(s3Idx + 1, s3Targets.length)}/${s3Targets.length} · ${labels.lit} ${s3Lit.length}/${s3Targets.length}`
      : `p·${(pCoverage * 100).toFixed(0)}% · f'·${(fCoverage * 100).toFixed(0)}%`

  const showExhaustedWarn = isStage2 && s2Shots >= STAGE2_SHOT_BUDGET && s2Lit.length < STAGE2_TARGETS.length

  // Colour helpers
  const flashOk = flash?.ok === true
  const flashKo = flash?.ok === false

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block', userSelect: 'none' }}
      >
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        {/* Bench frame */}
        <rect x={BENCH_LEFT} y={BENCH_TOP} width={BENCH_RIGHT - BENCH_LEFT} height={BENCH_BOT - BENCH_TOP}
          fill="none" stroke="#12203a" strokeWidth={1} rx={6} />
        <text x={BENCH_LEFT + 8} y={BENCH_TOP - 8} fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace" fontSize={11} letterSpacing="0.1em">
          {labels.bench}
        </text>

        {/* Grid ticks along axis (every 20 mm) — student can read positions on stage 3 */}
        {isStage3 && Array.from({ length: 19 }, (_, i) => {
          const mm = -180 + i * 20
          const x = LENS_X + mm * PX_PER_MM
          if (x < BENCH_LEFT + 4 || x > BENCH_RIGHT - 4) return null
          const isMajor = mm % 40 === 0
          return (
            <g key={`tick${mm}`}>
              <line x1={x} y1={AXIS_Y - (isMajor ? 6 : 3)} x2={x} y2={AXIS_Y + (isMajor ? 6 : 3)}
                stroke="#2A3654" strokeWidth={isMajor ? 1 : 0.5} />
              {isMajor && (
                <text x={x} y={AXIS_Y + 18} fill="#54617A"
                  fontFamily="'JetBrains Mono', monospace" fontSize={9} textAnchor="middle">
                  {mm}
                </text>
              )}
            </g>
          )
        })}

        {/* Optical axis */}
        <line x1={BENCH_LEFT + 6} y1={AXIS_Y} x2={BENCH_RIGHT - 6} y2={AXIS_Y}
          stroke="#2A3654" strokeWidth={1} strokeDasharray="3 5" />

        {/* Focal points F and F' (on both sides of lens at distance |f'|) */}
        <g>
          <circle cx={FSvgX} cy={AXIS_Y} r={3} fill="#54617A" />
          <text x={FSvgX} y={AXIS_Y - 8} fill="#6C7A93"
            fontFamily="'JetBrains Mono', monospace" fontSize={10} textAnchor="middle">F</text>
          <circle cx={FprimeSvgX} cy={AXIS_Y} r={3} fill="#54617A" />
          <text x={FprimeSvgX} y={AXIS_Y - 8} fill="#6C7A93"
            fontFamily="'JetBrains Mono', monospace" fontSize={10} textAnchor="middle">F'</text>
        </g>

        {/* Characteristic rays (stages 1 & 2 only) */}
        {characteristicRays}

        {/* Stage-2 ghost image (teal target) */}
        {ghostImage && (
          <g opacity={0.85}>
            {/* Ghost object marker (light teal, slightly offset above) */}
            <line x1={ghostImage.objX} y1={AXIS_Y} x2={ghostImage.objX} y2={svgYFromAB(AB_MM)}
              stroke="rgba(55,201,184,0.35)" strokeWidth={2.5} strokeLinecap="round" strokeDasharray="3 3" />
            {/* Ghost image */}
            <line x1={ghostImage.imgX} y1={AXIS_Y} x2={ghostImage.imgX} y2={ghostImage.imgTipY}
              stroke="#37C9B8" strokeWidth={3.2} strokeLinecap="round" strokeDasharray="4 4" />
            {/* Ghost arrowhead */}
            <polygon
              points={`${ghostImage.imgX - 5},${ghostImage.imgTipY + (ghostImage.abMm > 0 ? 6 : -6)} ${ghostImage.imgX + 5},${ghostImage.imgTipY + (ghostImage.abMm > 0 ? 6 : -6)} ${ghostImage.imgX},${ghostImage.imgTipY}`}
              fill="#37C9B8" opacity={0.85}
            />
            <text x={ghostImage.imgX + 8} y={ghostImage.imgTipY + (ghostImage.abMm > 0 ? -4 : 12)}
              fill="#37C9B8" fontFamily="'JetBrains Mono', monospace" fontSize={10}>
              ghost {ghostImage.isVirtual ? `(${labels.virtual})` : ''}
            </text>
          </g>
        )}

        {/* Lens (double-arrow biconvex glyph, drawn as a tall thin element on the axis) */}
        <g>
          <line x1={LENS_X} y1={BENCH_TOP + 20} x2={LENS_X} y2={BENCH_BOT - 20}
            stroke="#B9C4D6" strokeWidth={1.5} opacity={0.85} />
          {/* Upper arrow tip */}
          <polygon points={`${LENS_X - 6},${BENCH_TOP + 26} ${LENS_X + 6},${BENCH_TOP + 26} ${LENS_X},${BENCH_TOP + 18}`}
            fill="#B9C4D6" />
          {/* Lower arrow tip */}
          <polygon points={`${LENS_X - 6},${BENCH_BOT - 26} ${LENS_X + 6},${BENCH_BOT - 26} ${LENS_X},${BENCH_BOT - 18}`}
            fill="#B9C4D6" />
          <text x={LENS_X} y={BENCH_TOP + 14} fill="#B9C4D6"
            fontFamily="'JetBrains Mono', monospace" fontSize={11} textAnchor="middle">
            O
          </text>
        </g>

        {/* Object arrow AB (orange, always visible) */}
        <g>
          <line x1={objSvgX} y1={AXIS_Y} x2={objSvgX} y2={objTipY}
            stroke="#F97316" strokeWidth={3.4} strokeLinecap="round" />
          <polygon
            points={`${objSvgX - 5},${objTipY + 6} ${objSvgX + 5},${objTipY + 6} ${objSvgX},${objTipY}`}
            fill="#F97316"
          />
          {isStage1 || isStage2 ? (
            <text x={objSvgX + 8} y={objTipY + 4} fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace" fontSize={10}>
              A B  ·  p={fmtP(p)}
            </text>
          ) : (
            <text x={objSvgX} y={AXIS_Y + 34} fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace" fontSize={10} textAnchor="middle">
              p = {fmtP(p)}
            </text>
          )}
        </g>

        {/* Image arrow A'B' (hidden on stage 3) */}
        {!isStage3 && !atInfinity && imageOnScreen && imageSvgX !== null && (
          <g>
            <line x1={imageSvgX} y1={AXIS_Y} x2={imageSvgX} y2={imageTipY}
              stroke="#F97316" strokeWidth={3.4} strokeLinecap="round" opacity={0.9} />
            <polygon
              points={`${imageSvgX - 5},${imageTipY + (imageAbSvgMm > 0 ? 6 : -6)} ${imageSvgX + 5},${imageTipY + (imageAbSvgMm > 0 ? 6 : -6)} ${imageSvgX},${imageTipY}`}
              fill="#F97316"
            />
            <text x={imageSvgX + 8} y={imageTipY + (imageAbSvgMm > 0 ? -4 : 12)}
              fill="#F9A968" fontFamily="'JetBrains Mono', monospace" fontSize={10}>
              A' B'  ·  p'={fmtP(pPrime)}  γ={fmtG(gamma)}
            </text>
          </g>
        )}

        {/* Image "at infinity" indicator (stage 1 only) */}
        {!isStage3 && atInfinity && (
          <text x={LENS_X + 40} y={AXIS_Y - 20} fill="#F9A968"
            fontFamily="'JetBrains Mono', monospace" fontSize={12}>
            p' → ∞  (object at F)
          </text>
        )}

        {/* Stage-3 target region marker (position only, no image) */}
        {isStage3 && s3Current && (() => {
          const tx = svgFromP(s3Current.pPrimeStar)
          if (tx < BENCH_LEFT + 4 || tx > BENCH_RIGHT - 4) return null
          return (
            <g>
              {/* Position marker on axis */}
              <circle cx={tx} cy={AXIS_Y} r={7} fill="none" stroke="#F97316" strokeWidth={1.5} opacity={0.7}>
                <animate attributeName="r" values="6;10;6" dur="1.6s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.7;0.2;0.7" dur="1.6s" repeatCount="indefinite" />
              </circle>
              <circle cx={tx} cy={AXIS_Y} r={3} fill="#F97316" />
              <text x={tx} y={AXIS_Y + 34} fill="#F9A968"
                fontFamily="'JetBrains Mono', monospace" fontSize={10} textAnchor="middle">
                p'* = {fmtP(s3Current.pPrimeStar)}
              </text>
              <text x={tx} y={AXIS_Y + 48} fill="#F9A968"
                fontFamily="'JetBrains Mono', monospace" fontSize={10} textAnchor="middle">
                γ* = {fmtG(s3Current.gStar)}
              </text>
            </g>
          )
        })()}

        {/* Stage-3 lit target log (small ticks below axis) */}
        {isStage3 && s3Targets.map((t, i) => {
          const isLit = s3Lit.includes(t.id)
          const isDone = i < s3Idx
          const cx = BENCH_LEFT + 40 + i * 22
          return (
            <g key={`s3log-${t.id}`}>
              <circle cx={cx} cy={BENCH_BOT - 12} r={6}
                fill={isLit ? '#37C9B8' : isDone ? '#54617A' : 'none'}
                stroke={isLit ? '#37C9B8' : '#54617A'} strokeWidth={1.5} />
            </g>
          )
        })}

        {/* Flash overlay after CHECK (post-submit feedback, §4.7 rule 3) */}
        {flash && (
          <g>
            <rect x={LENS_X - 90} y={BENCH_TOP - 40} width={180} height={28} rx={14}
              fill={flash.ok ? 'rgba(55,201,184,0.20)' : 'rgba(249,115,22,0.20)'}
              stroke={flash.ok ? '#37C9B8' : '#F97316'} strokeWidth={1.5} />
            <text x={LENS_X} y={BENCH_TOP - 22}
              fill={flash.ok ? '#37C9B8' : '#F9A968'}
              fontFamily="'JetBrains Mono', monospace" fontSize={13} fontWeight={700}
              letterSpacing="0.12em" textAnchor="middle">
              {flash.ok ? '✓ MATCH' : '✗ OFF-TARGET'}
            </text>
          </g>
        )}

        {/* Peek panel — strategy hint + current DOF readout (stage 3) */}
        {isStage3 && peekVisible && (
          <g>
            <rect x={W / 2 - 200} y={12} width={400} height={54} rx={12}
              fill="rgba(13,21,36,0.92)" stroke="#F97316" strokeWidth={1.5} />
            <text x={W / 2} y={30} fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace" fontSize={11} fontWeight={700}
              letterSpacing="0.10em" textAnchor="middle">
              {labels.peek_hint}
            </text>
            <text x={W / 2} y={50} fill="#EAF0FA"
              fontFamily="'JetBrains Mono', monospace" fontSize={12} textAnchor="middle">
              p = {fmtP(p)}  ·  f' = {fPrime.toFixed(1)}mm
            </text>
          </g>
        )}
      </svg>

      {/* ─── HUD overlays (HTML) ─────────────────────────────────────── */}
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
        fontFamily: "'JetBrains Mono', monospace", fontSize: '2.1rem',
        letterSpacing: '0.06em',
        color: (isStage2 && s2MatchNow) || (isStage3 && s3MatchNow) ? '#37C9B8' : '#B9C4D6',
        textAlign: 'right', zIndex: 5, pointerEvents: 'none', maxWidth: '46%',
      }}>
        {hudTR}
      </div>

      <div style={{
        position: 'absolute', bottom: '3rem', left: '3rem',
        fontFamily: "'JetBrains Mono', monospace", fontSize: '2.2rem',
        letterSpacing: '0.06em', color: '#6C7A93', zIndex: 5, pointerEvents: 'none',
        maxWidth: '52%',
      }}>
        {hudBL}
      </div>

      {/* Progress line — placed under TL (BR is reserved) */}
      <div style={{
        position: 'absolute', top: '8rem', left: '3rem',
        fontFamily: "'JetBrains Mono', monospace", fontSize: '1.9rem',
        letterSpacing: '0.08em',
        color: showExhaustedWarn ? '#F9A968' : '#37C9B8',
        zIndex: 5, pointerEvents: 'none',
      }}>
        {hudProgress}
        {showExhaustedWarn && (
          <div style={{ marginTop: '0.6rem', color: '#F9A968' }}>{labels.exhausted}</div>
        )}
      </div>

      {/* ─── Slider column (right, avoids BR corner) ─────────────────── */}
      <div style={{
        position: 'absolute',
        top: '10rem', right: '3rem',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', gap: '1.5rem',
        zIndex: 6,
      }}>
        <SliderVertical
          label="p"
          unit="mm"
          value={p}
          min={P_MIN}
          max={P_MAX}
          step={0.5}
          format={(v) => v.toFixed(1)}
          accent="#F97316"
          onChange={(v) => setPTrack(clamp(v, P_MIN, P_MAX))}
        />
        <SliderVertical
          label="f'"
          unit="mm"
          value={fPrime}
          min={F_MIN}
          max={F_MAX}
          step={0.5}
          format={(v) => v.toFixed(1)}
          accent="#37C9B8"
          onChange={(v) => setFTrack(clamp(v, F_MIN, F_MAX))}
        />
      </div>

      {/* ─── CHECK button (stages 2 & 3 only) ────────────────────────── */}
      {!isStage1 && (
        <button
          type="button"
          onClick={check}
          disabled={!canCheck}
          style={{
            position: 'absolute',
            bottom: '3rem', left: '50%',
            transform: 'translateX(-50%)',
            padding: '2rem 4rem',
            background: canCheck ? (flashOk ? '#37C9B8' : flashKo ? '#F97316' : '#F97316') : 'rgba(30,42,64,0.85)',
            color: canCheck ? '#FFFFFF' : '#6C7A93',
            border: `0.3rem solid ${canCheck ? (flashOk ? '#37C9B8' : '#F97316') : 'rgba(58,72,99,0.6)'}`,
            borderRadius: '100rem',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '2.6rem', fontWeight: 700, letterSpacing: '0.12em',
            cursor: canCheck ? 'pointer' : 'not-allowed',
            zIndex: 10,
            transition: 'background 0.15s',
          }}
        >
          <i className="bi bi-check2-circle"
            style={{ marginInlineEnd: '0.8rem', fontSize: '2.8rem', verticalAlign: '-0.2rem' }} />
          {labels.check}
        </button>
      )}
    </div>
  )
}

// ─── Slider primitive (adapted from diffraction reference) ──────────────
function SliderVertical({
  label, unit, value, min, max, step, format, onChange, accent,
}: {
  label: string
  unit: string
  value: number
  min: number
  max: number
  step: number
  format: (v: number) => string
  onChange: (v: number) => void
  accent: string
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.4rem' }}>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.5rem', color: '#54617A' }}>
        {format(max)}
      </div>
      <div style={{ width: '2.5rem', height: '16rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{
            width: '16rem',
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
