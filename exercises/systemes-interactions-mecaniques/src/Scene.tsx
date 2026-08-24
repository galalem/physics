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

// ─── Scene constants ────────────────────────────────────────
const W = 800
const H = 450

type ObjId = 'L' | 'T' | 'E'
type PairKey = 'LT' | 'LE' | 'TE'

function pairKey(a: ObjId, b: ObjId): PairKey {
  const order: Record<ObjId, number> = { L: 0, T: 1, E: 2 }
  const [x, y] = order[a] < order[b] ? [a, b] : [b, a]
  return `${x}${y}` as PairKey
}

const PAIR_ENDS: Record<PairKey, [ObjId, ObjId]> = {
  LT: ['L', 'T'],
  LE: ['L', 'E'],
  TE: ['T', 'E'],
}

// Object hotspot positions (SVG coords). Also used for stage-3 dots.
const POS: Record<ObjId, { x: number; y: number }> = {
  L: { x: 400, y: 155 }, // book center
  T: { x: 400, y: 220 }, // table top center
  E: { x: 400, y: 400 }, // ground surface (below table)
}

// ─── Force list ─────────────────────────────────────────────
// Each force is drawn at (ax, ay) with unit direction (dx, dy).
// It belongs to one Newton pair (`pair`) and is applied on `recipient`
// by `actor`. State (internal/external/inactive) is derived from the
// student's system selection at render time.
type Force = {
  id: string
  pair: PairKey
  actor: ObjId
  recipient: ObjId
  ax: number
  ay: number
  dx: number
  dy: number
  label: string
}

const FORCES: Force[] = [
  // Pair LT — contact between book and table
  { id: 'f_T_L', pair: 'LT', actor: 'T', recipient: 'L', ax: 360, ay: 180, dx: 0, dy: -1, label: 'F(T→L)' },
  { id: 'f_L_T', pair: 'LT', actor: 'L', recipient: 'T', ax: 440, ay: 210, dx: 0, dy: 1, label: 'F(L→T)' },
  // Pair LE — gravity between book and Earth
  { id: 'f_E_L', pair: 'LE', actor: 'E', recipient: 'L', ax: 465, ay: 158, dx: 0, dy: 1, label: 'P(L)' },
  { id: 'f_L_E', pair: 'LE', actor: 'L', recipient: 'E', ax: 465, ay: 395, dx: 0, dy: -1, label: 'F(L→E)' },
  // Pair TE — table sitting on Earth (contact + gravity)
  { id: 'f_E_T', pair: 'TE', actor: 'E', recipient: 'T', ax: 285, ay: 230, dx: 0, dy: 1, label: 'P(T)' },
  { id: 'f_T_E', pair: 'TE', actor: 'T', recipient: 'E', ax: 285, ay: 395, dx: 0, dy: -1, label: 'F(T→E)' },
]

// ─── Stage 2 target set — seeded ordering ───────────────────
type Stage2Setup = { targetMembers: ObjId[]; queryKey: string }
const STAGE2_SETUPS: Stage2Setup[] = [
  { targetMembers: ['L', 'T'], queryKey: 'query_LT' },
  { targetMembers: ['T', 'E'], queryKey: 'query_TE' },
  { targetMembers: ['L', 'T', 'E'], queryKey: 'query_ALL' },
]

const STAGE2_ORDERINGS: number[][] = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
]

const STAGE2_SHOT_BUDGET = 5
const STAGE3_BUDGET = 3

// ─── Locale label loader ────────────────────────────────────
const dict = { en } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── Helpers ────────────────────────────────────────────────
function setEq(a: Set<ObjId>, b: Set<ObjId>) {
  if (a.size !== b.size) return false
  for (const x of a) if (!b.has(x)) return false
  return true
}
function setKey(s: Set<ObjId>): string {
  const seq = (['L', 'T', 'E'] as ObjId[]).filter((o) => s.has(o)).join('')
  return seq.length > 0 ? seq : '_'
}

// ─── Component ──────────────────────────────────────────────
export default function Scene() {
  const { locale, seed } = useInit()
  const stages = useMemo(() => getStagesFor(locale), [locale])
  useDeclareStages(stages)
  const labels = useMemo(() => svgLabels(locale), [locale])

  const stageIdx = useCurrentStage()
  const setStage = useSetStage()
  const complete = useComplete()
  const progress = useProgress()

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  // ─── State ────────────────────────────────────────────────
  const [system, setSystem] = useState<Set<ObjId>>(new Set())
  const [configsSeen, setConfigsSeen] = useState<Set<string>>(new Set())

  const stage2Order = useMemo(
    () => STAGE2_ORDERINGS[seed % STAGE2_ORDERINGS.length]!,
    [seed],
  )
  const [stage2Idx, setStage2Idx] = useState(0)
  const [stage2Lit, setStage2Lit] = useState<number[]>([])
  const [stage2Shots, setStage2Shots] = useState(0)

  const [pairSel, setPairSel] = useState<ObjId | null>(null)
  const [drawnPairs, setDrawnPairs] = useState<PairKey[]>([])
  const [stage3Failed, setStage3Failed] = useState(false)

  const [peekVisible, setPeekVisible] = useState(false)

  const stage2CurrentSetup = STAGE2_SETUPS[stage2Order[stage2Idx] ?? 0]!

  // ─── Reset ────────────────────────────────────────────────
  const resetAll = useCallback(() => {
    setSystem(new Set())
    setConfigsSeen(new Set())
    setStage2Idx(0)
    setStage2Lit([])
    setStage2Shots(0)
    setPairSel(null)
    setDrawnPairs([])
    setStage3Failed(false)
    setPeekVisible(false)
  }, [])
  useReset(resetAll)

  // ─── Interaction ──────────────────────────────────────────
  const toggleObject = useCallback(
    (o: ObjId) => {
      if (isStage3) {
        if (pairSel === null) {
          setPairSel(o)
          return
        }
        if (pairSel === o) {
          setPairSel(null)
          return
        }
        const key = pairKey(pairSel, o)
        setPairSel(null)
        setDrawnPairs((prev) => {
          const next = [...prev, key]
          if (prev.includes(key)) {
            // duplicate — meaningful cost (§4.7)
            setStage3Failed(true)
          }
          return next
        })
        return
      }
      // stages 1 & 2: toggle membership
      setSystem((prev) => {
        const next = new Set(prev)
        if (next.has(o)) next.delete(o)
        else next.add(o)
        if (isStage1) {
          setConfigsSeen((cs) => {
            const nn = new Set(cs)
            nn.add(setKey(next))
            return nn
          })
        }
        return next
      })
    },
    [isStage3, pairSel, isStage1],
  )

  // ─── Stage 3 auto-reset on failure or budget exhaustion ──
  useEffect(() => {
    if (!isStage3) return
    if (drawnPairs.length < STAGE3_BUDGET && !stage3Failed) return
    const unique = new Set(drawnPairs).size
    if (unique === 3 && drawnPairs.length === 3 && !stage3Failed) return
    // Not all three unique — reset stage 3 after a beat so the student
    // sees the red duplicate line before the wipe.
    const t = setTimeout(() => {
      setDrawnPairs([])
      setStage3Failed(false)
      setPairSel(null)
    }, 1400)
    return () => clearTimeout(t)
  }, [isStage3, drawnPairs, stage3Failed])

  // ─── Stage 2 fire ────────────────────────────────────────
  const stage2Match = useMemo(() => {
    const target = new Set<ObjId>(stage2CurrentSetup.targetMembers)
    return setEq(system, target)
  }, [system, stage2CurrentSetup])

  const stage2Done = stage2Lit.length === STAGE2_SETUPS.length
  const canFire = isStage2 && stage2Shots < STAGE2_SHOT_BUDGET && !stage2Done

  const fire = useCallback(() => {
    if (!canFire) return
    setStage2Shots((s) => s + 1)
    if (stage2Match) {
      setStage2Lit((prev) => [...prev, stage2Idx])
      setStage2Idx((i) => i + 1)
      setSystem(new Set())
    }
  }, [canFire, stage2Match, stage2Idx])

  // Auto-reset stage 2 when shots run out without a full clear
  useEffect(() => {
    if (!isStage2) return
    if (stage2Shots < STAGE2_SHOT_BUDGET || stage2Done) return
    const t = setTimeout(() => {
      setStage2Idx(0)
      setStage2Lit([])
      setStage2Shots(0)
      setSystem(new Set())
    }, 1600)
    return () => clearTimeout(t)
  }, [isStage2, stage2Shots, stage2Done])

  // ─── Advance predicate ───────────────────────────────────
  const stage1Done = useMemo(() => {
    const partials = Array.from(configsSeen).filter(
      (k) => k !== '_' && k !== 'LTE',
    )
    return partials.length >= 2
  }, [configsSeen])

  const stage3Done = useMemo(() => {
    return (
      drawnPairs.length === 3 &&
      new Set(drawnPairs).size === 3 &&
      !stage3Failed
    )
  }, [drawnPairs, stage3Failed])

  const canSubmit = isStage1 ? stage1Done : isStage2 ? stage2Done : stage3Done

  useEffect(() => {
    progress(stageIdx / 3, { stage: stageIdx, canSubmit })
  }, [stageIdx, canSubmit, progress])

  useNext(() => {
    if (stageIdx < 3) {
      setStage(stageIdx + 1)
      setSystem(new Set())
      setConfigsSeen(new Set())
      setStage2Idx(0)
      setStage2Lit([])
      setStage2Shots(0)
      setPairSel(null)
      setDrawnPairs([])
      setStage3Failed(false)
      setPeekVisible(false)
    } else {
      complete({ success: true })
    }
  })

  // ─── Peek (strategy hint — §4.7 rule 4) ──────────────────
  usePeek(() => {
    if (!isStage3) return
    setPeekVisible(true)
  })
  useEffect(() => {
    if (!peekVisible) return
    const t = setTimeout(() => setPeekVisible(false), 2500)
    return () => clearTimeout(t)
  }, [peekVisible])

  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  // Space bar confirms on stage 2
  useEffect(() => {
    if (!isStage2) return
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault()
        fire()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isStage2, fire])

  // ─── Derived rendering ───────────────────────────────────
  const forceState = (
    f: Force,
  ): 'internal' | 'external' | 'inactive' => {
    const [a, b] = PAIR_ENDS[f.pair]
    const inA = system.has(a)
    const inB = system.has(b)
    if (inA && inB) return 'internal'
    if (inA !== inB) return 'external'
    return 'inactive'
  }

  const showObjects = !isStage3
  const showArrows = isStage1 || isStage2 // hidden on the blind stage
  const showBoundary = (isStage1 || isStage2) && system.size > 0

  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`

  const systemLabel =
    system.size === 0
      ? '∅'
      : (['L', 'T', 'E'] as ObjId[]).filter((o) => system.has(o)).join(',')

  const hudTR = isStage1
    ? `${labels.system}: {${systemLabel}}`
    : isStage2
      ? `${labels.system}: {${systemLabel}}`
      : `${labels.pairs} ${new Set(drawnPairs).size}/3`

  const hudBL = isStage1 ? labels.tip1 : isStage2 ? labels.tip2 : labels.tip3

  const stage2QueryStr =
    isStage2 && !stage2Done
      ? (labels[stage2CurrentSetup.queryKey as keyof typeof labels] as string)
      : ''

  const stage2Exhausted =
    isStage2 && stage2Shots >= STAGE2_SHOT_BUDGET && !stage2Done

  // Colors for the system boundary ring
  const memberList = (['L', 'T', 'E'] as ObjId[]).filter((o) => system.has(o))

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

        {/* Ground band (Terre) */}
        <rect x={0} y={380} width={W} height={70} fill="#151E33" />
        <line
          x1={0}
          y1={380}
          x2={W}
          y2={380}
          stroke="#2A3654"
          strokeWidth={1}
        />
        {Array.from({ length: 20 }).map((_, i) => (
          <line
            key={`gh${i}`}
            x1={i * 40}
            y1={380}
            x2={i * 40 + 14}
            y2={366}
            stroke="#2A3654"
            strokeWidth={0.8}
          />
        ))}

        {/* System boundary — dashed lasso around included objects.
            Rendered as individual rings so the shape follows the choice. */}
        {showBoundary &&
          memberList.map((o) => {
            const rx = o === 'T' ? 175 : o === 'E' ? 380 : 90
            const ry = o === 'T' ? 45 : o === 'E' ? 40 : 40
            return (
              <ellipse
                key={`ring${o}`}
                cx={POS[o].x}
                cy={POS[o].y}
                rx={rx}
                ry={ry}
                fill="rgba(55, 201, 184, 0.08)"
                stroke="#37C9B8"
                strokeWidth={1.4}
                strokeDasharray="6 5"
              />
            )
          })}

        {showObjects && (
          <>
            {/* Table legs */}
            <rect x={280} y={230} width={12} height={130} fill="#3A4863" />
            <rect x={508} y={230} width={12} height={130} fill="#3A4863" />

            {/* Table top — clickable */}
            <g
              onClick={() => toggleObject('T')}
              style={{ cursor: 'pointer' }}
            >
              <rect
                x={260}
                y={210}
                width={280}
                height={20}
                fill="#54617A"
                stroke={system.has('T') ? '#37C9B8' : '#6C7A93'}
                strokeWidth={system.has('T') ? 2 : 1}
                rx={2}
              />
              <text
                x={400}
                y={224}
                fill="#EAF0FA"
                fontFamily="'JetBrains Mono', monospace"
                fontSize={12}
                textAnchor="middle"
                fontWeight={700}
              >
                T · {labels.table}
              </text>
            </g>

            {/* Book — clickable */}
            <g
              onClick={() => toggleObject('L')}
              style={{ cursor: 'pointer' }}
            >
              <rect
                x={330}
                y={130}
                width={140}
                height={50}
                fill="#37C9B8"
                stroke={system.has('L') ? '#F9A968' : '#1A2338'}
                strokeWidth={system.has('L') ? 2 : 1}
                rx={3}
              />
              <rect
                x={334}
                y={134}
                width={4}
                height={42}
                fill="#1A2338"
                opacity={0.5}
              />
              <text
                x={400}
                y={162}
                fill="#0D1524"
                fontFamily="'JetBrains Mono', monospace"
                fontSize={12}
                textAnchor="middle"
                fontWeight={700}
              >
                L · {labels.book}
              </text>
            </g>

            {/* Terre — clickable band label (left side, not BR) */}
            <g
              onClick={() => toggleObject('E')}
              style={{ cursor: 'pointer' }}
            >
              <rect
                x={30}
                y={396}
                width={130}
                height={30}
                fill="rgba(13, 21, 36, 0.85)"
                stroke={system.has('E') ? '#37C9B8' : '#54617A'}
                strokeWidth={system.has('E') ? 2 : 1}
                rx={4}
              />
              <text
                x={95}
                y={416}
                fill="#EAF0FA"
                fontFamily="'JetBrains Mono', monospace"
                fontSize={12}
                textAnchor="middle"
                fontWeight={700}
              >
                E · {labels.earth}
              </text>
            </g>
          </>
        )}

        {/* Force arrows (stages 1 + 2 only) */}
        {showArrows &&
          FORCES.map((f) => (
            <ForceArrow key={f.id} f={f} state={forceState(f)} />
          ))}

        {/* Stage 3: abstract dots with labels */}
        {isStage3 && (
          <>
            {/* Faint scene ghost so the student remembers what L/T/E mean */}
            <rect
              x={330}
              y={130}
              width={140}
              height={50}
              fill="none"
              stroke="#2A3654"
              strokeWidth={1}
              rx={3}
            />
            <rect
              x={260}
              y={210}
              width={280}
              height={20}
              fill="none"
              stroke="#2A3654"
              strokeWidth={1}
              rx={2}
            />
            <line
              x1={0}
              y1={380}
              x2={W}
              y2={380}
              stroke="#2A3654"
              strokeWidth={1}
              strokeDasharray="3 4"
            />

            {/* Drawn pair lines */}
            {drawnPairs.map((pk, i) => {
              const [a, b] = PAIR_ENDS[pk]
              const pa = POS[a]
              const pb = POS[b]
              const firstIdx = drawnPairs.indexOf(pk)
              const isDup = firstIdx !== i
              const stroke = isDup ? '#E5484D' : '#37C9B8'
              return (
                <line
                  key={`dp${i}`}
                  x1={pa.x}
                  y1={pa.y}
                  x2={pb.x}
                  y2={pb.y}
                  stroke={stroke}
                  strokeWidth={3}
                  strokeLinecap="round"
                  opacity={0.85}
                />
              )
            })}

            {/* Object dots */}
            {(['L', 'T', 'E'] as ObjId[]).map((o) => {
              const p = POS[o]
              const isSel = pairSel === o
              return (
                <g
                  key={`dot${o}`}
                  onClick={() => toggleObject(o)}
                  style={{ cursor: 'pointer' }}
                >
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={26}
                    fill="rgba(0,0,0,0)"
                  />
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={isSel ? 15 : 13}
                    fill={isSel ? '#F97316' : '#37C9B8'}
                    stroke="#0D1524"
                    strokeWidth={2}
                  />
                  <text
                    x={p.x + 24}
                    y={p.y + 5}
                    fill="#F9A968"
                    fontFamily="'JetBrains Mono', monospace"
                    fontSize={14}
                    fontWeight={700}
                  >
                    {o} · {o === 'L' ? labels.book : o === 'T' ? labels.table : labels.earth}
                  </text>
                </g>
              )
            })}
          </>
        )}

        {/* Peek badge — strategy hint (§4.7 rule 4) */}
        {isStage3 && peekVisible && (
          <g>
            <rect
              x={W / 2 - 330}
              y={16}
              width={660}
              height={40}
              rx={20}
              fill="rgba(13,21,36,.92)"
              stroke="#F97316"
              strokeWidth={1.5}
            />
            <text
              x={W / 2}
              y={41}
              fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={12}
              letterSpacing="0.06em"
              textAnchor="middle"
            >
              {labels.peek_hint}
            </text>
          </g>
        )}
      </svg>

      {/* ─── HUD ───────────────────────────────────────────── */}
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
          color:
            stage1Done || stage2Done || stage3Done ? '#37C9B8' : '#B9C4D6',
          zIndex: 5,
          pointerEvents: 'none',
          textAlign: 'right',
        }}
      >
        {hudTR}
      </div>

      {/* Stage 2 target query (secondary TR line) */}
      {isStage2 && stage2QueryStr && !stage2Done && (
        <div
          style={{
            position: 'absolute',
            top: '8rem',
            right: '3rem',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '1.9rem',
            letterSpacing: '0.04em',
            color: stage2Match ? '#37C9B8' : '#F9A968',
            zIndex: 5,
            pointerEvents: 'none',
            textAlign: 'right',
            maxWidth: '55%',
          }}
        >
          → {stage2QueryStr}
        </div>
      )}
      {isStage2 && (
        <div
          style={{
            position: 'absolute',
            top: '12rem',
            right: '3rem',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '1.7rem',
            letterSpacing: '0.06em',
            color: stage2Exhausted ? '#E5484D' : '#6C7A93',
            zIndex: 5,
            pointerEvents: 'none',
            textAlign: 'right',
          }}
        >
          {labels.shots} {stage2Shots}/{STAGE2_SHOT_BUDGET} · {labels.hits}{' '}
          {stage2Lit.length}/{STAGE2_SETUPS.length}
        </div>
      )}

      {/* Stage 3 attempts counter (secondary TR line — NOT bottom-right) */}
      {isStage3 && (
        <div
          style={{
            position: 'absolute',
            top: '8rem',
            right: '3rem',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '1.9rem',
            letterSpacing: '0.06em',
            color: stage3Failed ? '#E5484D' : '#F9A968',
            zIndex: 5,
            pointerEvents: 'none',
            textAlign: 'right',
          }}
        >
          {labels.tries} {drawnPairs.length}/{STAGE3_BUDGET}
        </div>
      )}

      <div
        style={{
          position: 'absolute',
          bottom: '3rem',
          left: '3rem',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '2.2rem',
          letterSpacing: '0.06em',
          color: '#6C7A93',
          zIndex: 5,
          pointerEvents: 'none',
          maxWidth: '55%',
        }}
      >
        {hudBL}
      </div>
      {/* NO bottom-right overlay — reserved for parent chrome (fullscreen). */}

      {/* Fire / Confirm button (stage 2 only) */}
      {isStage2 && !stage2Done && (
        <button
          type="button"
          onClick={fire}
          disabled={!canFire}
          style={{
            position: 'absolute',
            bottom: '3rem',
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '1.8rem 3.6rem',
            background: canFire ? '#F97316' : 'rgba(30,42,64,0.85)',
            color: canFire ? '#FFFFFF' : '#6C7A93',
            border: `0.3rem solid ${canFire ? '#F97316' : 'rgba(58,72,99,0.6)'}`,
            borderRadius: '100rem',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '2.4rem',
            fontWeight: 700,
            letterSpacing: '0.12em',
            cursor: canFire ? 'pointer' : 'not-allowed',
            zIndex: 10,
          }}
        >
          <i
            className="bi bi-check-circle-fill"
            style={{
              marginInlineEnd: '0.8rem',
              fontSize: '2.6rem',
              verticalAlign: '-0.2rem',
            }}
          />
          {labels.confirm}
        </button>
      )}
    </div>
  )
}

// ─── Force arrow subcomponent ──────────────────────────────
function ForceArrow({
  f,
  state,
}: {
  f: Force
  state: 'internal' | 'external' | 'inactive'
}) {
  const len = 40
  const x2 = f.ax + f.dx * len
  const y2 = f.ay + f.dy * len

  let stroke: string
  let strokeWidth: number
  let opacity: number
  let dash: string | undefined
  if (state === 'internal') {
    stroke = '#6C7A93'
    strokeWidth = 1.5
    opacity = 0.6
    dash = '3 4'
  } else if (state === 'external') {
    stroke = '#F97316'
    strokeWidth = 2.6
    opacity = 1
    dash = undefined
  } else {
    stroke = '#4A5A78'
    strokeWidth = 1.6
    opacity = 0.55
    dash = undefined
  }

  const headSize = 7
  const nx = -f.dy
  const ny = f.dx
  const h1x = x2 - f.dx * headSize + nx * (headSize * 0.55)
  const h1y = y2 - f.dy * headSize + ny * (headSize * 0.55)
  const h2x = x2 - f.dx * headSize - nx * (headSize * 0.55)
  const h2y = y2 - f.dy * headSize - ny * (headSize * 0.55)

  const labelX = x2 + f.dx * 6 + (f.dx === 0 ? 8 : 0)
  const labelY = y2 + (f.dy === 0 ? 4 : f.dy > 0 ? 12 : -6)

  return (
    <g opacity={opacity}>
      <line
        x1={f.ax}
        y1={f.ay}
        x2={x2}
        y2={y2}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={dash}
      />
      <polygon
        points={`${x2},${y2} ${h1x},${h1y} ${h2x},${h2y}`}
        fill={stroke}
      />
      <text
        x={labelX}
        y={labelY}
        fill={stroke}
        fontFamily="'JetBrains Mono', monospace"
        fontSize={10}
        fontWeight={700}
      >
        {f.label}
      </text>
    </g>
  )
}
