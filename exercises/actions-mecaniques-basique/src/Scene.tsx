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

// ─── Scene constants ──────────────────────────────────────────
const W = 800
const H = 450

// ─── Data model ───────────────────────────────────────────────
type Category = 'contact' | 'distance'
type Distribution = 'localised' | 'distributed'
type SceneId = 'ball_on_table' | 'book_on_shelf' | 'magnet_nail' | 'spring_mass'

interface Action {
  id: string
  actionLabelKey: keyof typeof en.labels
  category: Category
  distribution: Distribution
  color: string
  // Arrow geometry in SVG coords — (tailX, tailY) with head offset (headX, headY).
  tailX: number
  tailY: number
  headX: number
  headY: number
}

interface Scenario {
  id: SceneId
  sceneLabelKey: keyof typeof en.labels
  candidates: Array<Action & { correct: boolean }>
}

// Colors kept consistent per action-type across scenes so classification stays learnable.
const COLOR_WEIGHT = '#F97316'       // distance (Earth)
const COLOR_CONTACT_DIST = '#37C9B8' // contact + distributed
const COLOR_CONTACT_LOC = '#7BA8F5'  // contact + localised
const COLOR_DISTANCE_LOC = '#B98CE3' // distance + localised (magnet)
const COLOR_DISTRACTOR = '#54617A'

// ─── Scenarios (hand-authored — deterministic) ────────────────
const SCENARIO_STAGE1: Scenario = {
  id: 'ball_on_table',
  sceneLabelKey: 'scene_ball_on_table',
  candidates: [
    {
      id: 'weight',
      actionLabelKey: 'action_weight',
      category: 'distance',
      distribution: 'localised',
      color: COLOR_WEIGHT,
      tailX: 300, tailY: 220,
      headX: 300, headY: 320,
      correct: true,
    },
    {
      id: 'table_contact',
      actionLabelKey: 'action_table_contact',
      category: 'contact',
      distribution: 'distributed',
      color: COLOR_CONTACT_DIST,
      tailX: 300, tailY: 265,
      headX: 300, headY: 165,
      correct: true,
    },
    {
      id: 'hand',
      actionLabelKey: 'action_hand',
      category: 'contact',
      distribution: 'localised',
      color: COLOR_CONTACT_LOC,
      tailX: 245, tailY: 235,
      headX: 335, headY: 235,
      correct: true,
    },
  ],
}

// Stages 2 & 3 use the same three scenarios (same physics, different UI).
const SCENARIOS_TEST: Scenario[] = [
  {
    id: 'book_on_shelf',
    sceneLabelKey: 'scene_book_on_shelf',
    candidates: [
      {
        id: 'weight',
        actionLabelKey: 'action_weight',
        category: 'distance',
        distribution: 'localised',
        color: COLOR_WEIGHT,
        tailX: 300, tailY: 220,
        headX: 300, headY: 320,
        correct: true,
      },
      {
        id: 'shelf_contact',
        actionLabelKey: 'action_shelf_contact',
        category: 'contact',
        distribution: 'distributed',
        color: COLOR_CONTACT_DIST,
        tailX: 300, tailY: 275,
        headX: 300, headY: 175,
        correct: true,
      },
      {
        id: 'hand',
        actionLabelKey: 'action_hand',
        category: 'contact',
        distribution: 'localised',
        color: COLOR_DISTRACTOR,
        tailX: 245, tailY: 235,
        headX: 335, headY: 235,
        correct: false,
      },
      {
        id: 'air',
        actionLabelKey: 'action_air',
        category: 'contact',
        distribution: 'distributed',
        color: COLOR_DISTRACTOR,
        tailX: 360, tailY: 200,
        headX: 260, headY: 200,
        correct: false,
      },
    ],
  },
  {
    id: 'magnet_nail',
    sceneLabelKey: 'scene_magnet_nail',
    candidates: [
      {
        id: 'weight',
        actionLabelKey: 'action_weight',
        category: 'distance',
        distribution: 'localised',
        color: COLOR_WEIGHT,
        tailX: 300, tailY: 240,
        headX: 300, headY: 335,
        correct: true,
      },
      {
        id: 'magnet',
        actionLabelKey: 'action_magnet',
        category: 'distance',
        distribution: 'localised',
        color: COLOR_DISTANCE_LOC,
        tailX: 300, tailY: 220,
        headX: 300, headY: 125,
        correct: true,
      },
      {
        id: 'ground_contact',
        actionLabelKey: 'action_ground_contact',
        category: 'contact',
        distribution: 'distributed',
        color: COLOR_DISTRACTOR,
        tailX: 300, tailY: 280,
        headX: 300, headY: 190,
        correct: false,
      },
      {
        id: 'thread',
        actionLabelKey: 'action_thread',
        category: 'contact',
        distribution: 'localised',
        color: COLOR_DISTRACTOR,
        tailX: 300, tailY: 235,
        headX: 380, headY: 155,
        correct: false,
      },
    ],
  },
  {
    id: 'spring_mass',
    sceneLabelKey: 'scene_spring_mass',
    candidates: [
      {
        id: 'weight',
        actionLabelKey: 'action_weight',
        category: 'distance',
        distribution: 'localised',
        color: COLOR_WEIGHT,
        tailX: 320, tailY: 230,
        headX: 320, headY: 325,
        correct: true,
      },
      {
        id: 'table_contact',
        actionLabelKey: 'action_table_contact',
        category: 'contact',
        distribution: 'distributed',
        color: COLOR_CONTACT_DIST,
        tailX: 320, tailY: 265,
        headX: 320, headY: 170,
        correct: true,
      },
      {
        id: 'spring',
        actionLabelKey: 'action_spring',
        category: 'contact',
        distribution: 'localised',
        color: COLOR_CONTACT_LOC,
        tailX: 285, tailY: 235,
        headX: 195, headY: 235,
        correct: true,
      },
      {
        id: 'hand',
        actionLabelKey: 'action_hand',
        category: 'contact',
        distribution: 'localised',
        color: COLOR_DISTRACTOR,
        tailX: 355, tailY: 235,
        headX: 435, headY: 235,
        correct: false,
      },
    ],
  },
]

const STAGE2_SUBMIT_BUDGET = 5

// ─── Label loader ─────────────────────────────────────────────
const dict = { en } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── Arrow rendering ──────────────────────────────────────────
function Arrow({
  x0, y0, x1, y1, color, glow, onClick, selected, dim, interactive,
}: {
  x0: number; y0: number; x1: number; y1: number
  color: string
  glow: boolean
  onClick?: (() => void) | undefined
  selected: boolean
  dim: boolean
  interactive: boolean
}) {
  const dx = x1 - x0
  const dy = y1 - y0
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  // Arrowhead: two lines forming a chevron 8px from tip at 25° each side.
  const head = 12
  const spread = 0.42 // ~24° each side
  const perpX = -uy
  const perpY = ux
  const hx1 = x1 - ux * head + perpX * head * spread
  const hy1 = y1 - uy * head + perpY * head * spread
  const hx2 = x1 - ux * head - perpX * head * spread
  const hy2 = y1 - uy * head - perpY * head * spread
  const opacity = dim ? 0.28 : 1
  const stroke = selected ? '#EAF0FA' : color
  const sw = selected ? 3.2 : 2.4
  return (
    <g
      onClick={onClick}
      style={{ cursor: interactive ? 'pointer' : 'default', pointerEvents: interactive ? 'auto' : 'none' }}
      opacity={opacity}
    >
      {/* Invisible fatter hit target */}
      {interactive && (
        <line x1={x0} y1={y0} x2={x1} y2={y1}
          stroke="transparent" strokeWidth={22} strokeLinecap="round" />
      )}
      {glow && (
        <line x1={x0} y1={y0} x2={x1} y2={y1}
          stroke={color} strokeOpacity={0.22} strokeWidth={10} strokeLinecap="round" />
      )}
      <line x1={x0} y1={y0} x2={x1} y2={y1}
        stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
      <line x1={x1} y1={y1} x2={hx1} y2={hy1}
        stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
      <line x1={x1} y1={y1} x2={hx2} y2={hy2}
        stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
      {/* Point of application dot */}
      <circle cx={x0} cy={y0} r={4} fill={stroke} />
    </g>
  )
}

// ─── Object silhouettes ───────────────────────────────────────
function SceneGeometry({ sceneId }: { sceneId: SceneId }) {
  const wallStroke = '#2A3654'
  const surfaceFill = '#1A2338'
  const objectStroke = '#54617A'
  const objectFill = '#12203A'
  switch (sceneId) {
    case 'ball_on_table':
      return (
        <g>
          {/* Table */}
          <rect x={140} y={265} width={340} height={12} fill={surfaceFill} stroke={wallStroke} strokeWidth={1} />
          <line x1={170} y1={277} x2={170} y2={355} stroke={wallStroke} strokeWidth={1.5} />
          <line x1={450} y1={277} x2={450} y2={355} stroke={wallStroke} strokeWidth={1.5} />
          {/* Ball */}
          <circle cx={300} cy={240} r={26} fill={objectFill} stroke={objectStroke} strokeWidth={2} />
          <text x={300} y={244} textAnchor="middle" fill="#6C7A93"
            fontFamily="'JetBrains Mono', monospace" fontSize={10}>
            SYS
          </text>
          {/* Hand (schematic) */}
          <rect x={218} y={225} width={20} height={20} fill={objectFill} stroke={objectStroke} strokeWidth={1.5} rx={4} />
          <line x1={215} y1={235} x2={238} y2={235} stroke={objectStroke} strokeWidth={1.5} />
        </g>
      )
    case 'book_on_shelf':
      return (
        <g>
          {/* Shelf */}
          <rect x={140} y={280} width={340} height={12} fill={surfaceFill} stroke={wallStroke} strokeWidth={1} />
          <line x1={140} y1={280} x2={140} y2={355} stroke={wallStroke} strokeWidth={1.5} />
          <line x1={480} y1={280} x2={480} y2={355} stroke={wallStroke} strokeWidth={1.5} />
          {/* Book */}
          <rect x={272} y={222} width={56} height={58} fill={objectFill} stroke={objectStroke} strokeWidth={2} rx={2} />
          <line x1={282} y1={232} x2={318} y2={232} stroke={objectStroke} strokeWidth={1} />
          <line x1={282} y1={244} x2={318} y2={244} stroke={objectStroke} strokeWidth={1} />
          <text x={300} y={260} textAnchor="middle" fill="#6C7A93"
            fontFamily="'JetBrains Mono', monospace" fontSize={10}>
            SYS
          </text>
        </g>
      )
    case 'magnet_nail':
      return (
        <g>
          {/* Ceiling / support */}
          <rect x={200} y={80} width={200} height={14} fill={surfaceFill} stroke={wallStroke} strokeWidth={1} />
          {/* Magnet body */}
          <rect x={272} y={95} width={56} height={22} fill="#3A2A22" stroke="#8A5A44" strokeWidth={1.5} rx={3} />
          <text x={300} y={110} textAnchor="middle" fill="#F9A968"
            fontFamily="'JetBrains Mono', monospace" fontSize={9} letterSpacing="0.1em">
            N — S
          </text>
          {/* Nail (SYS), hovering — clearly separated from magnet */}
          <polygon points="290,225 310,225 305,265 295,265" fill={objectFill} stroke={objectStroke} strokeWidth={2} />
          <rect x={287} y={220} width={26} height={7} fill={objectFill} stroke={objectStroke} strokeWidth={2} />
          <text x={300} y={280} textAnchor="middle" fill="#6C7A93"
            fontFamily="'JetBrains Mono', monospace" fontSize={10}>
            SYS
          </text>
          {/* Ground */}
          <line x1={140} y1={370} x2={480} y2={370} stroke={wallStroke} strokeWidth={1.5} />
          <line x1={155} y1={370} x2={140} y2={385} stroke={wallStroke} strokeWidth={0.8} />
          <line x1={185} y1={370} x2={170} y2={385} stroke={wallStroke} strokeWidth={0.8} />
          <line x1={215} y1={370} x2={200} y2={385} stroke={wallStroke} strokeWidth={0.8} />
          <line x1={245} y1={370} x2={230} y2={385} stroke={wallStroke} strokeWidth={0.8} />
          <line x1={275} y1={370} x2={260} y2={385} stroke={wallStroke} strokeWidth={0.8} />
          <line x1={305} y1={370} x2={290} y2={385} stroke={wallStroke} strokeWidth={0.8} />
          <line x1={335} y1={370} x2={320} y2={385} stroke={wallStroke} strokeWidth={0.8} />
          <line x1={365} y1={370} x2={350} y2={385} stroke={wallStroke} strokeWidth={0.8} />
          <line x1={395} y1={370} x2={380} y2={385} stroke={wallStroke} strokeWidth={0.8} />
          <line x1={425} y1={370} x2={410} y2={385} stroke={wallStroke} strokeWidth={0.8} />
          <line x1={455} y1={370} x2={440} y2={385} stroke={wallStroke} strokeWidth={0.8} />
        </g>
      )
    case 'spring_mass':
      return (
        <g>
          {/* Table */}
          <rect x={140} y={265} width={340} height={12} fill={surfaceFill} stroke={wallStroke} strokeWidth={1} />
          <line x1={170} y1={277} x2={170} y2={355} stroke={wallStroke} strokeWidth={1.5} />
          <line x1={450} y1={277} x2={450} y2={355} stroke={wallStroke} strokeWidth={1.5} />
          {/* Wall on left */}
          <rect x={140} y={205} width={10} height={60} fill={surfaceFill} stroke={wallStroke} strokeWidth={1} />
          {/* Spring (zig-zag) from wall to mass */}
          <polyline
            points="150,235 165,225 175,245 185,225 195,245 205,225 215,245 225,235 285,235"
            fill="none" stroke="#8AA1C8" strokeWidth={1.8} strokeLinejoin="round"
          />
          {/* Mass (SYS) */}
          <rect x={285} y={215} width={70} height={50} fill={objectFill} stroke={objectStroke} strokeWidth={2} rx={4} />
          <text x={320} y={244} textAnchor="middle" fill="#6C7A93"
            fontFamily="'JetBrains Mono', monospace" fontSize={10}>
            SYS
          </text>
        </g>
      )
  }
}

// ─── Component ────────────────────────────────────────────────
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

  // ─── Stage 1 state ──────────────────────────────────────
  const [inspected, setInspected] = useState<Set<string>>(new Set())
  const [selectedS1, setSelectedS1] = useState<string | null>(null)

  // ─── Stages 2/3 rotation start (seed-picked) ────────────
  const startIdx = useMemo(() => seed % SCENARIOS_TEST.length, [seed])
  const orderedScenarios = useMemo<Scenario[]>(
    () => [0, 1, 2].map((k) => SCENARIOS_TEST[(startIdx + k) % SCENARIOS_TEST.length]!),
    [startIdx],
  )

  // ─── Stage 2 state ──────────────────────────────────────
  const [s2SceneIdx, setS2SceneIdx] = useState(0)
  const [s2Chosen, setS2Chosen] = useState<Set<string>>(new Set())
  const [s2Submits, setS2Submits] = useState(0)
  const [s2Lit, setS2Lit] = useState<string[]>([]) // scenario ids solved
  const [s2Flash, setS2Flash] = useState<'ok' | 'miss' | null>(null)

  // ─── Stage 3 state ──────────────────────────────────────
  const [s3SceneIdx, setS3SceneIdx] = useState(0)
  const [s3Chosen, setS3Chosen] = useState<Set<string>>(new Set())
  const [s3Lit, setS3Lit] = useState<string[]>([])
  const [s3Fired, setS3Fired] = useState(0)
  const [s3Flash, setS3Flash] = useState<'ok' | 'miss' | null>(null)
  const [peekVisible, setPeekVisible] = useState(false)

  const resetStageState = useCallback(() => {
    setInspected(new Set())
    setSelectedS1(null)
    setS2SceneIdx(0); setS2Chosen(new Set()); setS2Submits(0); setS2Lit([]); setS2Flash(null)
    setS3SceneIdx(0); setS3Chosen(new Set()); setS3Lit([]); setS3Fired(0); setS3Flash(null)
    setPeekVisible(false)
  }, [])

  useReset(resetStageState)

  // ─── Advance predicates ────────────────────────────────
  const stage1Done = inspected.size >= SCENARIO_STAGE1.candidates.length
  const stage2Done = s2Lit.length >= SCENARIOS_TEST.length
  const stage3Done = s3Fired >= SCENARIOS_TEST.length && s3Lit.length === SCENARIOS_TEST.length

  const canSubmit = isStage1 ? stage1Done : isStage2 ? stage2Done : stage3Done

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

  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  // ─── Stage 1 arrow click ────────────────────────────────
  const inspectArrow = (id: string) => {
    setSelectedS1(id)
    setInspected((prev) => {
      if (prev.has(id)) return prev
      const next = new Set(prev)
      next.add(id)
      return next
    })
  }

  // ─── Stage 2 arrow click ────────────────────────────────
  const toggleS2Arrow = (id: string) => {
    setS2Chosen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
    setS2Flash(null)
  }

  // ─── Stage 3 candidate chip click ──────────────────────
  const toggleS3Chip = (id: string) => {
    if (s3Flash === 'ok') return // scene resolved, wait for auto-advance
    setS3Chosen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  // ─── Submit — stages 2 & 3 ─────────────────────────────
  const fire = useCallback(() => {
    if (isStage2) {
      if (s2Lit.length >= SCENARIOS_TEST.length) return
      if (s2Submits >= STAGE2_SUBMIT_BUDGET) return
      const scenario = orderedScenarios[s2SceneIdx]!
      const correct = new Set(scenario.candidates.filter((c) => c.correct).map((c) => c.id))
      const same = correct.size === s2Chosen.size &&
        [...correct].every((id) => s2Chosen.has(id))
      setS2Submits((n) => n + 1)
      if (same) {
        setS2Lit((prev) => prev.includes(scenario.id) ? prev : [...prev, scenario.id])
        setS2Flash('ok')
        setTimeout(() => {
          setS2Flash(null)
          setS2Chosen(new Set())
          setS2SceneIdx((i) => (i + 1) % SCENARIOS_TEST.length)
        }, 900)
      } else {
        setS2Flash('miss')
      }
    } else if (isStage3) {
      if (s3Fired >= SCENARIOS_TEST.length) return
      const scenario = orderedScenarios[s3SceneIdx]!
      const correct = new Set(scenario.candidates.filter((c) => c.correct).map((c) => c.id))
      const same = correct.size === s3Chosen.size &&
        [...correct].every((id) => s3Chosen.has(id))
      const nextFired = s3Fired + 1
      setS3Fired(nextFired)
      if (same) {
        setS3Lit((prev) => [...prev, scenario.id])
        setS3Flash('ok')
      } else {
        setS3Flash('miss')
      }
      setTimeout(() => {
        setS3Flash(null)
        setS3Chosen(new Set())
        setS3SceneIdx((i) => Math.min(i + 1, SCENARIOS_TEST.length - 1))
      }, 900)
    }
  }, [isStage2, isStage3, s2Chosen, s2SceneIdx, s2Submits, s2Lit, s3Chosen, s3SceneIdx, s3Fired, orderedScenarios])

  // ─── Blind-stage fail-with-restart ─────────────────────
  useEffect(() => {
    if (!isStage3) return
    const allFired = s3Fired >= SCENARIOS_TEST.length
    const allLit = s3Lit.length === SCENARIOS_TEST.length
    if (allFired && !allLit) {
      const t = setTimeout(() => {
        // Reset stage 3 only — keep stage index the same.
        setS3SceneIdx(0)
        setS3Chosen(new Set())
        setS3Lit([])
        setS3Fired(0)
        setS3Flash(null)
      }, 1500)
      return () => clearTimeout(t)
    }
  }, [isStage3, s3Fired, s3Lit])

  // ─── Stage 2 submit-budget exhaustion ──────────────────
  useEffect(() => {
    if (!isStage2) return
    if (s2Submits >= STAGE2_SUBMIT_BUDGET && s2Lit.length < SCENARIOS_TEST.length) {
      const t = setTimeout(() => {
        setS2SceneIdx(0)
        setS2Chosen(new Set())
        setS2Submits(0)
        setS2Lit([])
        setS2Flash(null)
      }, 1500)
      return () => clearTimeout(t)
    }
  }, [isStage2, s2Submits, s2Lit])

  // ─── Peek (stage 3 only) ───────────────────────────────
  usePeek(() => {
    if (!isStage3) return
    setPeekVisible(true)
  })
  useEffect(() => {
    if (!peekVisible) return
    const t = setTimeout(() => setPeekVisible(false), 2000)
    return () => clearTimeout(t)
  }, [peekVisible])

  // ─── Derive current scene ──────────────────────────────
  const activeScene: Scenario = isStage1
    ? SCENARIO_STAGE1
    : isStage2
      ? orderedScenarios[s2SceneIdx]!
      : orderedScenarios[s3SceneIdx]!

  const s1SelectedAction = isStage1
    ? SCENARIO_STAGE1.candidates.find((c) => c.id === selectedS1) ?? null
    : null

  // ─── Submit-button enabled state ───────────────────────
  const canFireStage2 = isStage2 && s2Submits < STAGE2_SUBMIT_BUDGET &&
    s2Lit.length < SCENARIOS_TEST.length && s2Flash !== 'ok'
  const canFireStage3 = isStage3 && s3Fired < SCENARIOS_TEST.length &&
    s3Chosen.size > 0 && s3Flash === null
  const canFire = canFireStage2 || canFireStage3

  // ─── HUD strings ───────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`

  const hudTR = isStage1
    ? s1SelectedAction
      ? `${labels[s1SelectedAction.category === 'contact' ? 'category_contact' : 'category_distance']} · ${labels[s1SelectedAction.distribution === 'localised' ? 'distribution_localised' : 'distribution_distributed']}`
      : `${inspected.size}/${SCENARIO_STAGE1.candidates.length}`
    : isStage2
      ? `${labels.scene} ${s2SceneIdx + 1}/${SCENARIOS_TEST.length}  ·  ${labels.lit} ${s2Lit.length}/${SCENARIOS_TEST.length}`
      : `${labels.scene} ${Math.min(s3SceneIdx + 1, SCENARIOS_TEST.length)}/${SCENARIOS_TEST.length}  ·  ${labels.lit} ${s3Lit.length}/${SCENARIOS_TEST.length}`

  const hudBL = isStage1 ? labels.tip1 : isStage2 ? labels.tip2 : labels.tip3

  // Secondary readouts (avoid BR — put in a stacked row under TL)
  const hudTL2 = isStage2
    ? `${labels.submits} ${s2Submits}/${STAGE2_SUBMIT_BUDGET}`
    : isStage3
      ? `${labels.submits} ${s3Fired}/${SCENARIOS_TEST.length}`
      : null

  // Scene name subtitle
  const sceneSubtitle = labels[activeScene.sceneLabelKey]

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block', userSelect: 'none' }}
      >
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        {/* Scene frame — left half */}
        <rect x={40} y={80} width={480} height={330} fill="none"
          stroke="#12203a" strokeWidth={1} rx={6} />
        <text x={52} y={72} fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace" fontSize={11} letterSpacing="0.1em">
          {sceneSubtitle}
        </text>

        <SceneGeometry sceneId={activeScene.id} />

        {/* Arrows: visible on stages 1 & 2 only. Stage 3 = blind. */}
        {(isStage1 || isStage2) && activeScene.candidates.map((c) => {
          const interactive = true
          const selected = isStage1
            ? selectedS1 === c.id
            : s2Chosen.has(c.id)
          const dim = isStage2 && s2Flash === 'miss' && !c.correct
          const glow = selected
          const onClick = isStage1
            ? () => inspectArrow(c.id)
            : isStage2
              ? () => toggleS2Arrow(c.id)
              : undefined
          return (
            <Arrow
              key={c.id}
              x0={c.tailX} y0={c.tailY} x1={c.headX} y1={c.headY}
              color={c.color}
              selected={selected}
              glow={glow}
              dim={dim}
              interactive={interactive}
              onClick={onClick}
            />
          )
        })}

        {/* Stage 2 arrow labels — show name on hover-selected arrow */}
        {isStage2 && activeScene.candidates.filter((c) => s2Chosen.has(c.id)).map((c, i) => (
          <text key={`lbl-${c.id}`} x={540} y={110 + i * 20}
            fill={c.color}
            fontFamily="'JetBrains Mono', monospace" fontSize={12}>
            · {labels[c.actionLabelKey]}
          </text>
        ))}
        {isStage2 && s2Chosen.size === 0 && (
          <text x={540} y={110}
            fill="#54617A"
            fontFamily="'JetBrains Mono', monospace" fontSize={11}
            fontStyle="italic">
            {labels.chosen} —
          </text>
        )}

        {/* Stage 2 post-submit feedback: check/cross */}
        {isStage2 && s2Flash === 'ok' && (
          <g>
            <circle cx={540} cy={220} r={18} fill="none" stroke="#37C9B8" strokeWidth={2.4} />
            <polyline points="530,220 538,228 552,212"
              fill="none" stroke="#37C9B8" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
            <text x={568} y={225} fill="#37C9B8"
              fontFamily="'JetBrains Mono', monospace" fontSize={13} fontWeight={700}>
              {labels.correct}
            </text>
          </g>
        )}
        {isStage2 && s2Flash === 'miss' && (
          <g>
            <circle cx={540} cy={220} r={18} fill="none" stroke="#E57373" strokeWidth={2.4} />
            <line x1={532} y1={212} x2={548} y2={228} stroke="#E57373" strokeWidth={3} strokeLinecap="round" />
            <line x1={548} y1={212} x2={532} y2={228} stroke="#E57373" strokeWidth={3} strokeLinecap="round" />
            <text x={568} y={225} fill="#E57373"
              fontFamily="'JetBrains Mono', monospace" fontSize={13} fontWeight={700}>
              {labels.miss}
            </text>
          </g>
        )}

        {/* Stage 3 post-submit feedback */}
        {isStage3 && s3Flash === 'ok' && (
          <g>
            <circle cx={540} cy={220} r={18} fill="none" stroke="#37C9B8" strokeWidth={2.4} />
            <polyline points="530,220 538,228 552,212"
              fill="none" stroke="#37C9B8" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
            <text x={568} y={225} fill="#37C9B8"
              fontFamily="'JetBrains Mono', monospace" fontSize={13} fontWeight={700}>
              {labels.correct}
            </text>
          </g>
        )}
        {isStage3 && s3Flash === 'miss' && (
          <g>
            <circle cx={540} cy={220} r={18} fill="none" stroke="#E57373" strokeWidth={2.4} />
            <line x1={532} y1={212} x2={548} y2={228} stroke="#E57373" strokeWidth={3} strokeLinecap="round" />
            <line x1={548} y1={212} x2={532} y2={228} stroke="#E57373" strokeWidth={3} strokeLinecap="round" />
            <text x={568} y={225} fill="#E57373"
              fontFamily="'JetBrains Mono', monospace" fontSize={13} fontWeight={700}>
              {labels.miss}
            </text>
          </g>
        )}

        {/* Peek strategy-hint badge (stage 3 top-center) */}
        {isStage3 && peekVisible && (
          <g>
            <rect x={W / 2 - 220} y={16} width={440} height={30} rx={15}
              fill="rgba(13,21,36,.9)" stroke="#F97316" strokeWidth={1.5} />
            <text x={W / 2} y={35} fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={11} letterSpacing="0.06em" textAnchor="middle">
              {labels.peek_hint}
            </text>
          </g>
        )}
      </svg>

      {/* HUD — HTML overlays in rem, four corners (BR reserved) */}
      <div style={{
        position: 'absolute', top: '3rem', left: '3rem',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '2.3rem', letterSpacing: '0.14em',
        textTransform: 'uppercase', color: '#6C7A93',
        zIndex: 5, pointerEvents: 'none',
      }}>
        {hudTL}
      </div>
      {hudTL2 && (
        <div style={{
          position: 'absolute', top: '7.5rem', left: '3rem',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '1.9rem', letterSpacing: '0.06em',
          color: '#54617A', zIndex: 5, pointerEvents: 'none',
        }}>
          {hudTL2}
        </div>
      )}
      <div style={{
        position: 'absolute', top: '3rem', right: '3rem',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '2.3rem', letterSpacing: '0.08em',
        color: '#37C9B8', zIndex: 5, pointerEvents: 'none',
        textAlign: 'right', maxWidth: '48%',
      }}>
        {hudTR}
      </div>
      <div style={{
        position: 'absolute', bottom: '3rem', left: '3rem',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '2.3rem', letterSpacing: '0.06em',
        color: '#6C7A93', zIndex: 5, pointerEvents: 'none',
        maxWidth: '46%',
      }}>
        {hudBL}
      </div>
      {/* BR intentionally empty — reserved for parent chrome */}

      {/* Stage 3 candidate chips (right-side, HTML) */}
      {isStage3 && (
        <div style={{
          position: 'absolute', top: '13rem', right: '3rem',
          display: 'flex', flexDirection: 'column',
          gap: '1.2rem', alignItems: 'flex-end',
          zIndex: 6, maxWidth: '40rem',
        }}>
          <div style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '1.7rem', color: '#6C7A93',
            letterSpacing: '0.14em', textTransform: 'uppercase',
          }}>
            {labels.select}
          </div>
          {activeScene.candidates.map((c) => {
            const chosen = s3Chosen.has(c.id)
            const locked = s3Flash !== null
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => toggleS3Chip(c.id)}
                disabled={locked}
                style={{
                  padding: '1.4rem 2.4rem',
                  background: chosen ? 'rgba(55,201,184,0.15)' : 'rgba(30,42,64,0.85)',
                  color: chosen ? '#37C9B8' : '#B9C4D6',
                  border: `0.25rem solid ${chosen ? '#37C9B8' : 'rgba(58,72,99,0.6)'}`,
                  borderRadius: '2rem',
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: '2rem',
                  letterSpacing: '0.04em',
                  cursor: locked ? 'not-allowed' : 'pointer',
                  opacity: locked ? 0.6 : 1,
                  textAlign: 'right',
                }}
              >
                {labels[c.actionLabelKey]}
              </button>
            )
          })}
        </div>
      )}

      {/* Fire / Submit button — stages 2 & 3 */}
      {(isStage2 || isStage3) && (
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
          }}
        >
          <i className="bi bi-check2-circle"
            style={{ marginInlineEnd: '0.8rem', fontSize: '2.8rem', verticalAlign: '-0.2rem' }} />
          {labels.submit}
        </button>
      )}
    </div>
  )
}
