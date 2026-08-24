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

// ─── Scene constants ────────────────────────────────────────────────
const W = 800
const H = 450

// Stage 1 layout
const S1_LENS_CX = 400
const S1_LENS_CY = 225
const S1_LENS_HH = 78          // half-height in SVG units
const S1_LENS_SCALE = 3.2      // multiplier on LENS_GEOM values
const S1_FOCAL = 150           // signed focal distance for the illustration
const S1_RAY_X0 = 90           // left starting x of parallel rays
const S1_N_RAYS = 5
const S1_RAY_SPREAD = 48       // top ray at cy - spread, bottom at cy + spread

// Picker layout (below the lens in stage 1)
const PICK_Y = 385
const PICK_X0 = 80
const PICK_STEP = 108
const PICK_W = 92
const PICK_H = 60
const PICK_HH = 24
const PICK_SCALE = 1.0

// Card layout (stages 2 & 3)
const CARD_CY = 120
const CARD_XS = [155, 400, 645]
const CARD_HH = 52
const CARD_SCALE = 2.0
const CARD_HALF_W = 65         // hit-region half-width (for drop-return snapping)
const CARD_HALF_H = 65

// Bin layout (stages 2 & 3)
const BIN_CONV = { x: 60, y: 260, w: 330, h: 140 }
const BIN_DIV = { x: 410, y: 260, w: 330, h: 140 }

// ─── Lens types + geometry ──────────────────────────────────────────
type LensType =
  | 'biconvex'
  | 'plan-convex'
  | 'meniscus-conv'
  | 'biconcave'
  | 'plan-concave'
  | 'meniscus-div'

const ALL_LENSES: LensType[] = [
  'biconvex',
  'plan-convex',
  'meniscus-conv',
  'biconcave',
  'plan-concave',
  'meniscus-div',
]

type Kind = 'converging' | 'diverging'

const KIND_OF: Record<LensType, Kind> = {
  'biconvex': 'converging',
  'plan-convex': 'converging',
  'meniscus-conv': 'converging',
  'biconcave': 'diverging',
  'plan-concave': 'diverging',
  'meniscus-div': 'diverging',
}

// Per-lens face geometry (shape units, unscaled):
// [leftEdgeDX, leftMidDX, rightEdgeDX, rightMidDX] relative to lens center.
// centerThickness = rightMid - leftMid; edgeThickness = rightEdge - leftEdge.
// Converging: centerThickness > edgeThickness. Diverging: reversed.
const LENS_GEOM: Record<LensType, [number, number, number, number]> = {
  'biconvex':       [-4, -24, +4, +24],
  'plan-convex':    [-4,  -4, +4, +24],
  'meniscus-conv':  [+0, -16, +16, +8],
  'biconcave':      [-16, -4, +16, +4],
  'plan-concave':   [-4,  -4, +16, +4],
  'meniscus-div':   [+0,  -8, +16,  0],
}

// Build the SVG path for a lens outline centered at (cx, cy).
// Each face is a quadratic Bezier from top-corner to bottom-corner whose
// midpoint x equals the face midpoint. Given endpoints (E, ±h) and control
// (c, cy) on a quadratic, the curve midpoint is ((E + c) / 2, cy) — so
// c = 2·M − E.
function lensPath(
  cx: number,
  cy: number,
  hh: number,
  scale: number,
  type: LensType,
): string {
  const [LE, LM, RE, RM] = LENS_GEOM[type]
  const le = cx + LE * scale
  const lm = cx + LM * scale
  const re = cx + RE * scale
  const rm = cx + RM * scale
  const yT = cy - hh
  const yB = cy + hh
  const lc = 2 * lm - le
  const rc = 2 * rm - re
  return `M ${le} ${yT} Q ${lc} ${cy} ${le} ${yB} L ${re} ${yB} Q ${rc} ${cy} ${re} ${yT} Z`
}

// ─── Stage-2 / Stage-3 setups (seed-picked, hand-authored) ──────────
// Each setup is 3 lens types covering a mix of converging and diverging.
type Setup = { cards: LensType[] }

const STAGE2_SETUPS: Setup[] = [
  { cards: ['biconvex', 'biconcave', 'meniscus-conv'] },
  { cards: ['plan-convex', 'plan-concave', 'meniscus-div'] },
  { cards: ['meniscus-conv', 'plan-concave', 'biconvex'] },
  { cards: ['biconcave', 'plan-convex', 'meniscus-div'] },
]

const STAGE3_SETUPS: Setup[] = [
  { cards: ['plan-convex', 'meniscus-div', 'biconcave'] },
  { cards: ['meniscus-conv', 'plan-concave', 'biconvex'] },
  { cards: ['biconvex', 'meniscus-div', 'plan-concave'] },
  { cards: ['biconcave', 'meniscus-conv', 'plan-convex'] },
]

const STAGE2_STREAK_TARGET = 3

// ─── Label loader ───────────────────────────────────────────────────
const dict = { en } as const
type Locale = keyof typeof dict

function labelsFor(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

function shapeLabel(labels: ReturnType<typeof labelsFor>, type: LensType): string {
  switch (type) {
    case 'biconvex': return labels.biconvex
    case 'plan-convex': return labels.plan_convex
    case 'meniscus-conv': return labels.meniscus_conv
    case 'biconcave': return labels.biconcave
    case 'plan-concave': return labels.plan_concave
    case 'meniscus-div': return labels.meniscus_div
  }
}

// ─── Ray math ───────────────────────────────────────────────────────
// Thin-lens illustration: rays enter horizontally at y=cy+dy, pass through
// the lens plane at x=lensX, and exit toward the focal point.
function rayExit(
  kind: Kind,
  dy: number,
  lensX: number,
  cy: number,
  F: number,
): { toX: number; toY: number } {
  // Converging: slope = -dy / F   (ray converges through F' = (lensX+F, cy))
  // Diverging:  slope = +dy / F   (ray diverges away from virtual F'
  //                                at (lensX-F, cy))
  const slope = kind === 'converging' ? -dy / F : dy / F
  const toX = W - 20
  const toY = cy + dy + slope * (toX - lensX)
  return { toX, toY }
}

function isInsideRect(
  p: { x: number; y: number },
  r: { x: number; y: number; w: number; h: number },
): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h
}

// ─── Component ──────────────────────────────────────────────────────
export default function Scene() {
  const { locale, seed } = useInit()
  const stages = useMemo(() => getStagesFor(locale), [locale])
  useDeclareStages(stages)
  const labels = useMemo(() => labelsFor(locale), [locale])

  const stageIdx = useCurrentStage()
  const setStage = useSetStage()
  const complete = useComplete()
  const progress = useProgress()

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  // ─── Stage 1 state ────────────────────────────────────────────
  const [currentLens, setCurrentLens] = useState<LensType>('biconvex')
  const [visited, setVisited] = useState<Set<LensType>>(new Set(['biconvex']))

  // ─── Stage 2 state ────────────────────────────────────────────
  const stage2Setup = useMemo(
    () => STAGE2_SETUPS[seed % STAGE2_SETUPS.length]!,
    [seed],
  )
  const [s2Placed, setS2Placed] = useState<Record<number, Kind>>({})
  const [s2Streak, setS2Streak] = useState(0)
  const [s2Flash, setS2Flash] = useState<{ idx: number; ok: boolean } | null>(null)

  // ─── Stage 3 state ────────────────────────────────────────────
  const [s3Cycle, setS3Cycle] = useState(0)
  const stage3Setup = useMemo(
    () => STAGE3_SETUPS[(seed + s3Cycle) % STAGE3_SETUPS.length]!,
    [seed, s3Cycle],
  )
  const [s3CardIdx, setS3CardIdx] = useState(0)
  const [s3Results, setS3Results] = useState<{ ok: boolean; picked: Kind }[]>([])
  const [s3Flash, setS3Flash] = useState<{ idx: number; ok: boolean } | null>(null)
  const [peekVisible, setPeekVisible] = useState(false)

  // ─── Drag state (shared for stages 2 & 3) ─────────────────────
  const [drag, setDrag] = useState<{
    idx: number
    x: number       // current pointer position in SVG units
    y: number
    hovered: 'converging' | 'diverging' | null
  } | null>(null)

  const svgRef = useRef<SVGSVGElement>(null)

  // ─── Cleanup on stage change ──────────────────────────────────
  useEffect(() => {
    setDrag(null)
  }, [stageIdx])

  // ─── Reset ────────────────────────────────────────────────────
  const resetStageState = useCallback(() => {
    setCurrentLens('biconvex')
    setVisited(new Set(['biconvex']))
    setS2Placed({})
    setS2Streak(0)
    setS2Flash(null)
    setS3CardIdx(0)
    setS3Results([])
    setS3Cycle(0)
    setS3Flash(null)
    setPeekVisible(false)
    setDrag(null)
  }, [])
  useReset(resetStageState)

  // ─── Peek (stage 3 only) — strategy hint, NOT an answer reveal ─
  usePeek(() => {
    if (!isStage3) return
    setPeekVisible(true)
  })
  useEffect(() => {
    if (!peekVisible) return
    const t = setTimeout(() => setPeekVisible(false), 2400)
    return () => clearTimeout(t)
  }, [peekVisible])

  // ─── Hint ─────────────────────────────────────────────────────
  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  // ─── Advance predicate ────────────────────────────────────────
  const stage2Done = s2Streak >= STAGE2_STREAK_TARGET
  const stage3Done =
    s3CardIdx >= stage3Setup.cards.length &&
    s3Results.length === stage3Setup.cards.length &&
    s3Results.every((r) => r.ok)
  const canSubmit = isStage1
    ? visited.size >= ALL_LENSES.length
    : isStage2
      ? stage2Done
      : stage3Done

  useEffect(() => {
    progress(stageIdx / 3, { stage: stageIdx, canSubmit })
  }, [stageIdx, canSubmit, progress])

  useNext(() => {
    if (stageIdx < 3) {
      setStage(stageIdx + 1)
      // Do not reset stage-1 exploration state on advance; stage-2/3 use
      // their own state slices that start empty.
    } else {
      complete({ success: true })
    }
  })

  // ─── Stage-3 fail-with-restart (§4.7 wrong = meaningful cost) ─
  useEffect(() => {
    if (!isStage3) return
    if (s3CardIdx < stage3Setup.cards.length) return
    if (s3Results.length !== stage3Setup.cards.length) return
    const allOk = s3Results.every((r) => r.ok)
    if (allOk) return
    // At least one miss → wait a beat so student sees the last flash, then
    // roll to the next hand-authored setup and reset the pass.
    const t = setTimeout(() => {
      setS3Cycle((c) => c + 1)
      setS3CardIdx(0)
      setS3Results([])
      setS3Flash(null)
      setDrag(null)
    }, 900)
    return () => clearTimeout(t)
  }, [isStage3, s3CardIdx, s3Results, stage3Setup.cards.length])

  // ─── Flash clear ──────────────────────────────────────────────
  useEffect(() => {
    if (!s2Flash) return
    const t = setTimeout(() => setS2Flash(null), 550)
    return () => clearTimeout(t)
  }, [s2Flash])
  useEffect(() => {
    if (!s3Flash) return
    const t = setTimeout(() => setS3Flash(null), 550)
    return () => clearTimeout(t)
  }, [s3Flash])

  // ─── Pointer math ─────────────────────────────────────────────
  const svgPoint = useCallback(
    (e: React.PointerEvent): { x: number; y: number } | null => {
      const el = svgRef.current
      if (!el) return null
      const rect = el.getBoundingClientRect()
      return {
        x: ((e.clientX - rect.left) / rect.width) * W,
        y: ((e.clientY - rect.top) / rect.height) * H,
      }
    },
    [],
  )

  const isCardActive = useCallback(
    (idx: number): boolean => {
      if (isStage2) {
        // Card is active if not yet placed AND streak hasn't been reset
        // past it (we walk left to right by streak count).
        return idx === s2Streak && !(idx in s2Placed)
      }
      if (isStage3) {
        return idx === s3CardIdx
      }
      return false
    },
    [isStage2, isStage3, s2Streak, s2Placed, s3CardIdx],
  )

  const onCardPointerDown = useCallback(
    (idx: number) => (e: React.PointerEvent) => {
      if (!isCardActive(idx)) return
      e.preventDefault()
      const p = svgPoint(e)
      if (!p) return
      ;(e.target as Element).setPointerCapture?.(e.pointerId)
      setDrag({ idx, x: p.x, y: p.y, hovered: null })
    },
    [isCardActive, svgPoint],
  )

  const onSvgPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!drag) return
      const p = svgPoint(e)
      if (!p) return
      const hovered = isInsideRect(p, BIN_CONV)
        ? 'converging'
        : isInsideRect(p, BIN_DIV)
          ? 'diverging'
          : null
      setDrag((d) => (d ? { ...d, x: p.x, y: p.y, hovered } : null))
    },
    [drag, svgPoint],
  )

  const commit = useCallback(
    (idx: number, picked: Kind) => {
      const cards = isStage2 ? stage2Setup.cards : stage3Setup.cards
      const type = cards[idx]!
      const truth = KIND_OF[type]
      const ok = picked === truth

      if (isStage2) {
        if (ok) {
          setS2Placed((prev) => ({ ...prev, [idx]: picked }))
          setS2Streak((s) => s + 1)
        } else {
          // Streak reset — all cards return to the tray for a fresh pass.
          setS2Placed({})
          setS2Streak(0)
        }
        setS2Flash({ idx, ok })
      } else if (isStage3) {
        setS3Results((prev) => [...prev, { ok, picked }])
        setS3CardIdx((i) => i + 1)
        setS3Flash({ idx, ok })
      }
    },
    [isStage2, isStage3, stage2Setup.cards, stage3Setup.cards],
  )

  const onSvgPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!drag) return
      const p = svgPoint(e)
      const target = p
        ? isInsideRect(p, BIN_CONV)
          ? 'converging'
          : isInsideRect(p, BIN_DIV)
            ? 'diverging'
            : null
        : null
      if (target) commit(drag.idx, target)
      setDrag(null)
    },
    [drag, svgPoint, commit],
  )

  const onSvgPointerCancel = useCallback(() => {
    setDrag(null)
  }, [])

  // ─── Stage 1 picker action ────────────────────────────────────
  const pickLens = useCallback((t: LensType) => {
    setCurrentLens(t)
    setVisited((prev) => {
      if (prev.has(t)) return prev
      const next = new Set(prev)
      next.add(t)
      return next
    })
  }, [])

  // ─── Stage 1 ray computation ──────────────────────────────────
  const stage1Rays = useMemo(() => {
    if (!isStage1) return []
    const kind = KIND_OF[currentLens]
    const rays: { dy: number; toX: number; toY: number }[] = []
    for (let i = 0; i < S1_N_RAYS; i++) {
      const t = i / (S1_N_RAYS - 1)
      const dy = -S1_RAY_SPREAD + 2 * S1_RAY_SPREAD * t
      const exit = rayExit(kind, dy, S1_LENS_CX, S1_LENS_CY, S1_FOCAL)
      rays.push({ dy, toX: exit.toX, toY: exit.toY })
    }
    return rays
  }, [isStage1, currentLens])

  // ─── Render helpers ───────────────────────────────────────────
  const kindColor = (k: Kind, dim = false): string => {
    if (k === 'converging') return dim ? 'rgba(55, 201, 184, 0.32)' : '#37C9B8'
    return dim ? 'rgba(178, 130, 240, 0.32)' : '#B282F0'
  }

  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`
  const hudTR = isStage1
    ? `${labels.type} · ${shapeLabel(labels, currentLens)}`
    : isStage2
      ? `${labels.streak} ${s2Streak}/${STAGE2_STREAK_TARGET}`
      : `${labels.card} ${Math.min(s3CardIdx + 1, stage3Setup.cards.length)}/${stage3Setup.cards.length}`
  const hudBL = isStage1 ? labels.tip1 : isStage2 ? labels.tip2 : labels.tip3

  // Stage 1 auxiliary: visited counter (kept in TL area, below main TL text)
  const s1VisitedLine = isStage1
    ? `${labels.visited} ${visited.size}/${ALL_LENSES.length}`
    : ''

  // TR color: warm accent on match, kind color on drag hover
  const trColor =
    isStage1
      ? KIND_OF[currentLens] === 'converging'
        ? '#37C9B8'
        : '#B282F0'
      : '#B9C4D6'

  // ─── Render ───────────────────────────────────────────────────
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
        onPointerMove={onSvgPointerMove}
        onPointerUp={onSvgPointerUp}
        onPointerLeave={onSvgPointerCancel}
        onPointerCancel={onSvgPointerCancel}
      >
        {/* Background — NO borderRadius/rx (§4.4) */}
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        {isStage1 && (
          <Stage1
            currentLens={currentLens}
            rays={stage1Rays}
            onPick={pickLens}
            visited={visited}
            kindColor={kindColor}
          />
        )}

        {(isStage2 || isStage3) && (
          <Stage2or3
            isStage3={isStage3}
            cards={(isStage2 ? stage2Setup.cards : stage3Setup.cards)}
            drag={drag}
            onCardPointerDown={onCardPointerDown}
            s2Placed={s2Placed}
            s2Streak={s2Streak}
            s3CardIdx={s3CardIdx}
            s3Results={s3Results}
            s2Flash={s2Flash}
            s3Flash={s3Flash}
            labels={labels}
            kindColor={kindColor}
            isCardActive={isCardActive}
          />
        )}

        {/* Peek strategy hint (stage 3 only) */}
        {isStage3 && peekVisible && (
          <g>
            <rect
              x={80}
              y={205}
              width={640}
              height={40}
              rx={8}
              fill="rgba(13,21,36,0.94)"
              stroke="#F97316"
              strokeWidth={1.5}
            />
            <text
              x={W / 2}
              y={230}
              fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={14}
              fontWeight={700}
              letterSpacing="0.06em"
              textAnchor="middle"
            >
              {labels.peek_prompt}
            </text>
          </g>
        )}
      </svg>

      {/* ─── HUD overlays (HTML, NOT SVG text) ────────────────── */}
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

      {isStage1 && s1VisitedLine && (
        <div
          style={{
            position: 'absolute',
            top: '7rem',
            left: '3rem',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '1.9rem',
            letterSpacing: '0.08em',
            color: visited.size >= ALL_LENSES.length ? '#37C9B8' : '#54617A',
            zIndex: 5,
            pointerEvents: 'none',
          }}
        >
          {s1VisitedLine}
        </div>
      )}

      <div
        style={{
          position: 'absolute',
          top: '3rem',
          right: '3rem',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '2.3rem',
          letterSpacing: '0.08em',
          color: trColor,
          textAlign: 'right',
          zIndex: 5,
          pointerEvents: 'none',
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
          maxWidth: '55%',
          zIndex: 5,
          pointerEvents: 'none',
        }}
      >
        {hudBL}
      </div>
      {/* BR reserved for parent chrome — no overlay here. */}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// Stage 1 — Observe: lens picker + ray diagram
// ═══════════════════════════════════════════════════════════════════
function Stage1({
  currentLens,
  rays,
  onPick,
  visited,
  kindColor,
}: {
  currentLens: LensType
  rays: { dy: number; toX: number; toY: number }[]
  onPick: (t: LensType) => void
  visited: Set<LensType>
  kindColor: (k: Kind, dim?: boolean) => string
}) {
  const kind = KIND_OF[currentLens]
  const focusX = kind === 'converging'
    ? S1_LENS_CX + S1_FOCAL
    : S1_LENS_CX - S1_FOCAL
  const isVirtual = kind === 'diverging'

  return (
    <>
      {/* Optical axis */}
      <line
        x1={40}
        y1={S1_LENS_CY}
        x2={W - 40}
        y2={S1_LENS_CY}
        stroke="#2A3654"
        strokeWidth={1}
        strokeDasharray="4 6"
      />

      {/* Incident (horizontal) rays — from source to lens plane */}
      {rays.map((r, i) => (
        <line
          key={`in-${i}`}
          x1={S1_RAY_X0}
          y1={S1_LENS_CY + r.dy}
          x2={S1_LENS_CX}
          y2={S1_LENS_CY + r.dy}
          stroke="rgba(249,115,22,0.22)"
          strokeWidth={7}
          strokeLinecap="round"
        />
      ))}
      {rays.map((r, i) => (
        <line
          key={`inCore-${i}`}
          x1={S1_RAY_X0}
          y1={S1_LENS_CY + r.dy}
          x2={S1_LENS_CX}
          y2={S1_LENS_CY + r.dy}
          stroke="#F97316"
          strokeWidth={2}
          strokeLinecap="round"
        />
      ))}

      {/* Refracted rays — from lens plane outward */}
      {rays.map((r, i) => (
        <line
          key={`out-${i}`}
          x1={S1_LENS_CX}
          y1={S1_LENS_CY + r.dy}
          x2={r.toX}
          y2={r.toY}
          stroke="rgba(249,115,22,0.22)"
          strokeWidth={7}
          strokeLinecap="round"
        />
      ))}
      {rays.map((r, i) => (
        <line
          key={`outCore-${i}`}
          x1={S1_LENS_CX}
          y1={S1_LENS_CY + r.dy}
          x2={r.toX}
          y2={r.toY}
          stroke="#F97316"
          strokeWidth={2}
          strokeLinecap="round"
        />
      ))}

      {/* Virtual back-extensions (diverging) — dashed */}
      {isVirtual && rays.map((r, i) => (
        <line
          key={`virt-${i}`}
          x1={S1_LENS_CX}
          y1={S1_LENS_CY + r.dy}
          x2={focusX}
          y2={S1_LENS_CY}
          stroke="rgba(178,130,240,0.55)"
          strokeWidth={1}
          strokeDasharray="3 5"
        />
      ))}

      {/* Focal marker F' */}
      <g>
        <line
          x1={focusX}
          y1={S1_LENS_CY - 8}
          x2={focusX}
          y2={S1_LENS_CY + 8}
          stroke={isVirtual ? '#B282F0' : '#37C9B8'}
          strokeWidth={1.5}
        />
        <circle
          cx={focusX}
          cy={S1_LENS_CY}
          r={4}
          fill={isVirtual ? '#B282F0' : '#37C9B8'}
        />
        <text
          x={focusX + 10}
          y={S1_LENS_CY - 10}
          fill={isVirtual ? '#B282F0' : '#37C9B8'}
          fontFamily="'JetBrains Mono', monospace"
          fontSize={13}
          fontStyle="italic"
        >
          F'{isVirtual ? ' (virtual)' : ''}
        </text>
      </g>

      {/* Lens outline */}
      <path
        d={lensPath(S1_LENS_CX, S1_LENS_CY, S1_LENS_HH, S1_LENS_SCALE, currentLens)}
        fill="rgba(180,205,240,0.18)"
        stroke="#B9C4D6"
        strokeWidth={2}
        strokeLinejoin="round"
      />

      {/* Lens center marker O */}
      <circle cx={S1_LENS_CX} cy={S1_LENS_CY} r={2.5} fill="#B9C4D6" />

      {/* Picker row — 6 lens buttons at the bottom */}
      <text
        x={PICK_X0}
        y={PICK_Y - PICK_HH - 22}
        fill="#54617A"
        fontFamily="'JetBrains Mono', monospace"
        fontSize={10}
        letterSpacing="0.14em"
      >
        SWAP LENS
      </text>
      {ALL_LENSES.map((t, i) => {
        const cx = PICK_X0 + PICK_STEP * i + PICK_W / 2
        const cy = PICK_Y
        const active = t === currentLens
        const seen = visited.has(t)
        const strokeCol = active
          ? kindColor(KIND_OF[t])
          : seen
            ? '#54617A'
            : '#3A4863'
        return (
          <g
            key={t}
            onPointerDown={(e) => {
              e.preventDefault()
              onPick(t)
            }}
            style={{ cursor: 'pointer' }}
          >
            <rect
              x={cx - PICK_W / 2}
              y={cy - PICK_HH - 6}
              width={PICK_W}
              height={PICK_H}
              rx={6}
              fill={active ? 'rgba(55,201,184,0.10)' : 'rgba(30,42,64,0.55)'}
              stroke={strokeCol}
              strokeWidth={active ? 1.8 : 1}
            />
            <path
              d={lensPath(cx, cy - 8, PICK_HH * 0.5, PICK_SCALE, t)}
              fill="rgba(180,205,240,0.22)"
              stroke={active ? '#EAF0FA' : seen ? '#B9C4D6' : '#6C7A93'}
              strokeWidth={1.5}
            />
            {seen && (
              <circle
                cx={cx + PICK_W / 2 - 8}
                cy={cy - PICK_HH - 6 + 8}
                r={3}
                fill={kindColor(KIND_OF[t])}
              />
            )}
          </g>
        )
      })}
    </>
  )
}

// ═══════════════════════════════════════════════════════════════════
// Stage 2 & 3 — Experiment/Evaluate: drag cards into bins
// ═══════════════════════════════════════════════════════════════════
function Stage2or3({
  isStage3,
  cards,
  drag,
  onCardPointerDown,
  s2Placed,
  s2Streak,
  s3CardIdx,
  s3Results,
  s2Flash,
  s3Flash,
  labels,
  kindColor,
  isCardActive,
}: {
  isStage3: boolean
  cards: LensType[]
  drag: { idx: number; x: number; y: number; hovered: Kind | null } | null
  onCardPointerDown: (idx: number) => (e: React.PointerEvent) => void
  s2Placed: Record<number, Kind>
  s2Streak: number
  s3CardIdx: number
  s3Results: { ok: boolean; picked: Kind }[]
  s2Flash: { idx: number; ok: boolean } | null
  s3Flash: { idx: number; ok: boolean } | null
  labels: ReturnType<typeof labelsFor>
  kindColor: (k: Kind, dim?: boolean) => string
  isCardActive: (idx: number) => boolean
}) {
  const isStage2 = !isStage3

  return (
    <>
      {/* Tray outline (visual anchor) */}
      <rect
        x={40}
        y={62}
        width={720}
        height={160}
        rx={6}
        fill="none"
        stroke="#1A2338"
        strokeWidth={1}
      />
      <text
        x={50}
        y={54}
        fill="#54617A"
        fontFamily="'JetBrains Mono', monospace"
        fontSize={10}
        letterSpacing="0.14em"
      >
        {labels.cards}
      </text>

      {/* Cards */}
      {cards.map((type, idx) => {
        const home = { x: CARD_XS[idx]!, y: CARD_CY }
        const isDragging = drag?.idx === idx
        const active = isCardActive(idx)

        // Stage 2: placed cards render inside their bin.
        // Stage 3: submitted cards render inside their bin (with hit/miss color).
        let cx: number, cy: number
        let placedKind: Kind | null = null
        let cardOk: boolean | null = null

        if (isStage2 && idx in s2Placed) {
          placedKind = s2Placed[idx]!
          const bin = placedKind === 'converging' ? BIN_CONV : BIN_DIV
          // Stack placed cards horizontally inside the bin
          const rowIdx = Object.entries(s2Placed)
            .filter(([, k]) => k === placedKind)
            .findIndex(([i]) => Number(i) === idx)
          cx = bin.x + 60 + rowIdx * 90
          cy = bin.y + bin.h / 2
          cardOk = true
        } else if (isStage3 && idx < s3Results.length) {
          const res = s3Results[idx]!
          placedKind = res.picked
          const bin = placedKind === 'converging' ? BIN_CONV : BIN_DIV
          const rowIdx = s3Results
            .slice(0, idx + 1)
            .filter((r) => r.picked === placedKind).length - 1
          cx = bin.x + 60 + rowIdx * 90
          cy = bin.y + bin.h / 2
          cardOk = res.ok
        } else if (isDragging && drag) {
          cx = drag.x
          cy = drag.y
        } else {
          cx = home.x
          cy = home.y
        }

        // Card frame color
        const flash = isStage2 ? s2Flash : s3Flash
        const flashActive = flash?.idx === idx
        const frameCol = placedKind
          ? cardOk
            ? '#37C9B8'
            : '#E15D6C'
          : flashActive
            ? flash!.ok
              ? '#37C9B8'
              : '#E15D6C'
            : active
              ? '#F97316'
              : '#3A4863'

        const inactive =
          !active && placedKind === null && !flashActive
        const opacity = inactive ? 0.35 : 1

        return (
          <g
            key={`card-${idx}-${type}`}
            opacity={opacity}
            style={{ cursor: active ? 'grab' : 'default' }}
          >
            {/* Card background */}
            <rect
              x={cx - CARD_HALF_W}
              y={cy - CARD_HALF_H}
              width={CARD_HALF_W * 2}
              height={CARD_HALF_H * 2}
              rx={8}
              fill="rgba(20,30,50,0.85)"
              stroke={frameCol}
              strokeWidth={active || flashActive || placedKind ? 2 : 1}
            />

            {/* Hit region for pointer-down (transparent overlay covers whole card) */}
            <rect
              x={cx - CARD_HALF_W}
              y={cy - CARD_HALF_H}
              width={CARD_HALF_W * 2}
              height={CARD_HALF_H * 2}
              rx={8}
              fill="transparent"
              onPointerDown={active ? onCardPointerDown(idx) : undefined}
              style={{ cursor: active ? 'grab' : 'default' }}
            />

            {/* Lens silhouette */}
            <path
              d={lensPath(cx, cy - (isStage3 ? 0 : 10), CARD_HH, CARD_SCALE, type)}
              fill="rgba(180,205,240,0.24)"
              stroke="#B9C4D6"
              strokeWidth={1.6}
              strokeLinejoin="round"
              pointerEvents="none"
            />

            {/* Shape label (stage 2 only — REMOVED on stage 3 per §4.7) */}
            {isStage2 && (
              <text
                x={cx}
                y={cy + CARD_HALF_H - 12}
                fill="#B9C4D6"
                fontFamily="'JetBrains Mono', monospace"
                fontSize={10}
                letterSpacing="0.10em"
                textAnchor="middle"
                pointerEvents="none"
              >
                {shapeLabel(labels, type)}
              </text>
            )}
          </g>
        )
      })}

      {/* Streak dots (stage 2) — placed just above the bins */}
      {isStage2 && (
        <g>
          {Array.from({ length: STAGE2_STREAK_TARGET }).map((_, i) => (
            <circle
              key={`streak-${i}`}
              cx={W / 2 - 22 + i * 22}
              cy={244}
              r={5}
              fill={i < s2Streak ? '#37C9B8' : 'none'}
              stroke={i < s2Streak ? '#37C9B8' : '#3A4863'}
              strokeWidth={1.5}
            />
          ))}
        </g>
      )}

      {/* Stage-3 result dots — just above the bins */}
      {isStage3 && (
        <g>
          {Array.from({ length: cards.length }).map((_, i) => {
            const res = s3Results[i]
            const col = res ? (res.ok ? '#37C9B8' : '#E15D6C') : 'none'
            const stroke = res
              ? res.ok ? '#37C9B8' : '#E15D6C'
              : i === s3CardIdx ? '#F97316' : '#3A4863'
            return (
              <circle
                key={`s3dot-${i}`}
                cx={W / 2 - 22 + i * 22}
                cy={244}
                r={5}
                fill={col}
                stroke={stroke}
                strokeWidth={1.5}
              />
            )
          })}
        </g>
      )}

      {/* Bins */}
      <BinRect
        rect={BIN_CONV}
        label={labels.converging}
        kind="converging"
        hovered={drag?.hovered === 'converging'}
        kindColor={kindColor}
      />
      <BinRect
        rect={BIN_DIV}
        label={labels.diverging}
        kind="diverging"
        hovered={drag?.hovered === 'diverging'}
        kindColor={kindColor}
      />
    </>
  )
}

function BinRect({
  rect,
  label,
  kind,
  hovered,
  kindColor,
}: {
  rect: { x: number; y: number; w: number; h: number }
  label: string
  kind: Kind
  hovered: boolean
  kindColor: (k: Kind, dim?: boolean) => string
}) {
  const col = kindColor(kind)
  return (
    <g pointerEvents="none">
      <rect
        x={rect.x}
        y={rect.y}
        width={rect.w}
        height={rect.h}
        rx={10}
        fill={hovered ? 'rgba(55,201,184,0.10)' : 'rgba(20,30,50,0.55)'}
        stroke={col}
        strokeWidth={hovered ? 2.4 : 1.4}
        strokeDasharray={hovered ? undefined : '6 5'}
        opacity={hovered ? 1 : 0.7}
      />
      <text
        x={rect.x + rect.w / 2}
        y={rect.y + 24}
        fill={col}
        fontFamily="'JetBrains Mono', monospace"
        fontSize={13}
        fontWeight={700}
        letterSpacing="0.16em"
        textAnchor="middle"
      >
        {label}
      </text>
    </g>
  )
}
