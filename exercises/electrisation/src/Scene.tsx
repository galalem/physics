import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  useSetStage,
  useCurrentStage,
  useComplete,
  useDeclareStages,
  useHint,
  useInit,
  useNext,
  useProgress,
  useReset,
  useSeed,
} from '@physics/sdk/react'
import { getHintFor, getStagesFor } from './stages'
import en from '../i18n/en.json'
import fr from '../i18n/fr.json'
import ar from '../i18n/ar.json'

// ─── Scene constants ────────────────────────────────────────────────────
const W = 800
const H = 450

// Geometry
const BALL_CX = 500
const BALL_CY = 250
const BALL_R = 22
const BENCH_Y = 360
const ROD_HALF = 80
const ROD_HEIGHT = 16
const ROD_MIN_X = 90
const ROD_MAX_X = BALL_CX - BALL_R - ROD_HALF - 10 // no overlap with ball
const CLOTH_W = 44
const CLOTH_H = 28
const CLOTH_REST_X = 210
const CLOTH_REST_Y = 400
const ROD_REST_X = 180

// Distance thresholds for ball reaction
const CLOSE_DIST_FULL = 20 // ≤ this → full tilt
const CLOSE_DIST_NONE = 120 // ≥ this → no tilt
const OUTCOME_RECORD_PROX = 0.3

// Rub mechanics
const RUB_PROGRESS_PER_MOVE = 0.03
const RUB_CHARGED_THRESHOLD = 0.5
const RUB_MIN_DELTA = 2 // min pointermove dx to count

// Charge model
type Charge = -1 | 0 | 1
type RodMaterial = 'glass' | 'ebonite'
type ClothMaterial = 'silk' | 'fur'

function rubResult(rod: RodMaterial, cloth: ClothMaterial): Charge {
  if (rod === 'glass' && cloth === 'silk') return 1
  if (rod === 'ebonite' && cloth === 'fur') return -1
  return 0
}

type Outcome = 'attract' | 'repel' | 'neither'

function outcomeFor(rodQ: Charge, ballQ: Charge): Outcome {
  if (rodQ === 0 && ballQ === 0) return 'neither'
  if (rodQ === 0 || ballQ === 0) return 'attract'
  return rodQ * ballQ > 0 ? 'repel' : 'attract'
}

type Scenario = { rodQ: Charge; ballQ: Charge }
const PREDICT_DECK: Scenario[] = [
  { rodQ: 1, ballQ: 1 },
  { rodQ: -1, ballQ: -1 },
  { rodQ: 1, ballQ: -1 },
  { rodQ: -1, ballQ: 1 },
  { rodQ: 1, ballQ: 0 },
  { rodQ: -1, ballQ: 0 },
]
const PREDICT_TARGET = 4

const dict = { en, fr, ar } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

// ─── Component ──────────────────────────────────────────────────────────
export default function Scene() {
  const { locale, seed } = useInit()
  const stages = useMemo(() => getStagesFor(locale), [locale])
  useDeclareStages(stages)
  const labels = useMemo(() => svgLabels(locale), [locale])
  const rootRng = useSeed()

  const predictOrder = useMemo(() => rootRng.shuffle(PREDICT_DECK), [rootRng])
  void seed

  const stageIdx = useCurrentStage()

  // Stage 1 draggable state
  const [rodMat, setRodMat] = useState<RodMaterial>('glass')
  const [clothMat, setClothMat] = useState<ClothMaterial>('silk')
  const [rodX, setRodX] = useState(ROD_REST_X)
  const [clothX, setClothX] = useState(CLOTH_REST_X)
  const [clothY, setClothY] = useState(CLOTH_REST_Y)
  const [rubEffort, setRubEffort] = useState(0)
  // Ball starts neutral in both drag stages (Stage 1 keeps it locked neutral).
  const [ballQ, setBallQ] = useState<Charge>(0)
  const [seenOutcomes, setSeenOutcomes] = useState<Set<Outcome>>(new Set())

  // Stage 3 (predict) state
  const [scenarioIdx, setScenarioIdx] = useState(0)
  const [pick, setPick] = useState<Outcome | null>(null)
  const [streak, setStreak] = useState(0)
  const [scenarioRodX, setScenarioRodX] = useState(ROD_REST_X)

  const setStage = useSetStage()
  const progress = useProgress()
  const complete = useComplete()

  // Stage roles:
  //   1 = Simple intro: ball fixed +, only rub + move rod. See attract + repel.
  //   2 = Full observation: ball click-cycles, must witness all three outcomes.
  //   3 = Predict: MCQ scenario with visual reveal on pick.
  const isSimple = stageIdx === 1
  const isFull = stageIdx === 2
  const isDrag = isSimple || isFull
  const isPredict = stageIdx === 3

  const scenario = predictOrder[scenarioIdx % predictOrder.length]!
  const correctAnswer = outcomeFor(scenario.rodQ, scenario.ballQ)

  // Derived state ─────────────────────────────────────────────
  const rodQ: Charge = rubEffort >= RUB_CHARGED_THRESHOLD ? rubResult(rodMat, clothMat) : 0

  const displayRodX = isPredict ? (pick !== null ? scenarioRodX : ROD_REST_X) : rodX
  const displayRodQ: Charge = isPredict ? scenario.rodQ : rodQ
  const displayBallQ: Charge = isPredict ? scenario.ballQ : ballQ

  const distance = Math.max(0, (BALL_CX - BALL_R) - (displayRodX + ROD_HALF))
  const proximity = clamp(1 - (distance - CLOSE_DIST_FULL) / (CLOSE_DIST_NONE - CLOSE_DIST_FULL), 0, 1)
  const currentOutcome = outcomeFor(displayRodQ, displayBallQ)
  // Ball hangs from a pivot above it; rod approaches from the LEFT.
  // In SVG, +rotation is CW visually, which swings a downward-hanging ball to the LEFT
  // (toward the rod). So attract → +tilt, repel → −tilt.
  const ballTilt = proximity * (currentOutcome === 'attract' ? 17 : currentOutcome === 'repel' ? -17 : 0)

  // Advance criteria per stage
  const simpleDone = seenOutcomes.has('neither') && seenOutcomes.has('attract')
  const fullDone = seenOutcomes.size >= 3
  const predictDone = streak >= PREDICT_TARGET
  const canSubmit = isSimple ? simpleDone : isFull ? fullDone : predictDone

  // Record outcome when close enough with stable state (drag stages).
  useEffect(() => {
    if (!isDrag) return
    if (proximity < OUTCOME_RECORD_PROX) return
    setSeenOutcomes((prev) => {
      if (prev.has(currentOutcome)) return prev
      const next = new Set(prev)
      next.add(currentOutcome)
      return next
    })
  }, [isDrag, proximity, currentOutcome])

  // Reset rub effort when material changes
  useEffect(() => {
    setRubEffort(0)
  }, [rodMat, clothMat])

  const resetForStage = useCallback((stage: number) => {
    setRodMat('glass')
    setClothMat('silk')
    setRodX(ROD_REST_X)
    setClothX(CLOTH_REST_X)
    setClothY(CLOTH_REST_Y)
    setRubEffort(0)
    void stage
    setBallQ(0)
    setSeenOutcomes(new Set())
    setScenarioIdx(0)
    setPick(null)
    setStreak(0)
    setScenarioRodX(ROD_REST_X)
  }, [])

  useReset(() => resetForStage(stageIdx))

  useEffect(() => {
    progress(stageIdx / 3, { stage: stageIdx, canSubmit })
  }, [stageIdx, canSubmit, progress])

  useNext(() => {
    if (stageIdx < 3) {
      const next = stageIdx + 1
      setStage(next)
      resetForStage(next)
    } else {
      complete({ success: true })
    }
  })

  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  const cycleBallCharge = useCallback(() => {
    setBallQ((prev) => (prev === 0 ? 1 : prev === 1 ? -1 : 0))
  }, [])

  const pickAnswer = useCallback((choice: Outcome) => {
    setPick(choice)
    const ok = choice === correctAnswer
    if (ok) {
      setStreak((s) => s + 1)
      setScenarioRodX(ROD_MAX_X) // animate rod approach for feedback
    } else {
      setStreak(0)
    }
  }, [correctAnswer])

  const nextScenario = useCallback(() => {
    setPick(null)
    setScenarioRodX(ROD_REST_X)
    setScenarioIdx((i) => i + 1)
  }, [])

  // ─── Drag machinery (SVG-space) ─────────────────────────────────
  type DragTarget = 'cloth' | 'rod' | null
  const [dragging, setDragging] = useState<DragTarget>(null)
  const dragOrigin = useRef<{
    clientX: number; clientY: number
    startRodX: number; startClothX: number; startClothY: number
    lastClientX: number
  } | null>(null)

  const svgToWorldScale = (svg: SVGSVGElement): number => {
    const rect = svg.getBoundingClientRect()
    return 1 / Math.min(rect.width / W, rect.height / H)
  }

  const onPointerDown = useCallback((target: 'cloth' | 'rod', e: React.PointerEvent<SVGElement>) => {
    if (!isDrag) return
    ;(e.currentTarget as SVGElement).setPointerCapture(e.pointerId)
    setDragging(target)
    dragOrigin.current = {
      clientX: e.clientX, clientY: e.clientY,
      startRodX: rodX, startClothX: clothX, startClothY: clothY,
      lastClientX: e.clientX,
    }
    e.stopPropagation()
  }, [isDrag, rodX, clothX, clothY])

  const onPointerMove = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (!dragging || !dragOrigin.current) return
    const svg = e.currentTarget
    const scale = svgToWorldScale(svg)
    const totalDx = (e.clientX - dragOrigin.current.clientX) * scale
    const totalDy = (e.clientY - dragOrigin.current.clientY) * scale
    const incrDx = (e.clientX - dragOrigin.current.lastClientX) * scale
    dragOrigin.current.lastClientX = e.clientX

    if (dragging === 'rod') {
      setRodX(clamp(dragOrigin.current.startRodX + totalDx, ROD_MIN_X, ROD_MAX_X))
    } else {
      const newClothX = clamp(dragOrigin.current.startClothX + totalDx, 70, 700)
      const newClothY = clamp(dragOrigin.current.startClothY + totalDy, 200, 420)
      setClothX(newClothX)
      setClothY(newClothY)
      // Check if cloth center overlaps rod → count rub effort
      const rodLeft = rodX - ROD_HALF, rodRight = rodX + ROD_HALF
      const overCloth = newClothX >= rodLeft - 10 && newClothX <= rodRight + 10
        && newClothY >= BALL_CY - 30 && newClothY <= BALL_CY + 30
      if (overCloth && Math.abs(incrDx) > RUB_MIN_DELTA) {
        setRubEffort((prev) => clamp(prev + RUB_PROGRESS_PER_MOVE, 0, 1))
      }
    }
  }, [dragging, rodX])

  const onPointerUp = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (!dragging) return
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch {}
    setDragging(null)
    dragOrigin.current = null
  }, [dragging])

  // ─── Rendering helpers ─────────────────────────────────────────
  const rodColor = rodMat === 'glass' ? '#B9D6F2' : '#22262B'
  const rodStroke = rodMat === 'glass' ? '#7AA6D2' : '#3A3F47'
  const clothFabricColor = clothMat === 'silk' ? '#E9C7A0' : '#8A5A3D'
  const clothStroke = clothMat === 'silk' ? '#B99168' : '#5A3A22'

  // Show up to 6 charge symbols along the rod based on rubEffort (only if pair transfers).
  const rubTargetQ = rubResult(rodMat, clothMat)
  const symbolCount = rubTargetQ !== 0 ? Math.floor(rubEffort * 6.001) : 0
  const rubSymbols = () => {
    if (symbolCount === 0) return null
    const sym = rubTargetQ > 0 ? '+' : '−'
    const color = rubTargetQ > 0 ? '#F97316' : '#37C9B8'
    return Array.from({ length: symbolCount }).map((_, i) => {
      const t = symbolCount === 1 ? 0.5 : i / (symbolCount - 1)
      const localX = -60 + t * 120
      return (
        <text
          key={i}
          x={localX}
          y={4}
          fill={color}
          fontFamily="'JetBrains Mono', monospace"
          fontSize={20}
          fontWeight={700}
          textAnchor="middle"
          dominantBaseline="middle"
          pointerEvents="none"
        >
          {sym}
        </text>
      )
    })
  }

  // Ball charge symbols centered inside the ball
  const ballSym = ballQ === 1 ? '+' : ballQ === -1 ? '−' : ''
  const ballColor = ballQ === 0 ? '#B9C4D6' : ballQ === 1 ? '#F9A968' : '#7EE3D8'
  const scenarioBallSym = displayBallQ === 1 ? '+' : displayBallQ === -1 ? '−' : ''
  const scenarioBallColor = displayBallQ === 0 ? '#B9C4D6' : displayBallQ === 1 ? '#F9A968' : '#7EE3D8'

  // HUD text ─────────────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`
  const hudTR = isSimple
    ? `${labels.outcomes_seen}: ${seenOutcomes.size}/2`
    : isFull
      ? `${labels.outcomes_seen}: ${seenOutcomes.size}/3`
      : `${labels.streak}: ${streak}/${PREDICT_TARGET}`
  const hudBL = isSimple ? labels.tip1 : isFull ? labels.tip2 : labels.tip3

  const outcomeLabel = (o: Outcome) =>
    o === 'attract' ? labels.attract : o === 'repel' ? labels.repel : labels.neither

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block', userSelect: 'none', touchAction: 'none' }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        {/* Scene panel — title outside above box */}
        <rect x={40} y={60} width={500} height={340} fill="none" stroke="#12203a" strokeWidth={1} rx={6} />
        <text x={48} y={52} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={11} letterSpacing="0.1em">
          {labels.bench}
        </text>

        {/* Bench line */}
        <line x1={60} y1={BENCH_Y} x2={504} y2={BENCH_Y} stroke="#3A4863" strokeWidth={2} />

        {/* Stand for the pith ball */}
        <line x1={BALL_CX} y1={BENCH_Y} x2={BALL_CX} y2={BALL_CY - 50} stroke="#54617A" strokeWidth={2} />
        <circle cx={BALL_CX} cy={BALL_CY - 50} r={3} fill="#54617A" />

        {/* Thread and ball, rotated about pivot */}
        <g transform={`rotate(${ballTilt} ${BALL_CX} ${BALL_CY - 50})`} style={{ transition: dragging ? 'none' : 'transform 0.25s ease-out' }}>
          <line x1={BALL_CX} y1={BALL_CY - 50} x2={BALL_CX} y2={BALL_CY - BALL_R} stroke="#6C7A93" strokeWidth={1} />
          <circle
            cx={BALL_CX}
            cy={BALL_CY}
            r={BALL_R}
            fill={isDrag ? ballColor : scenarioBallColor}
            stroke="#3A4863"
            strokeWidth={1.2}
            onClick={isFull ? cycleBallCharge : undefined}
            style={isFull ? { cursor: 'pointer' } : undefined}
          />
          <text
            x={BALL_CX}
            y={BALL_CY + 5}
            fill="#0D1524"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={16}
            fontWeight={700}
            textAnchor="middle"
            pointerEvents="none"
          >
            {isDrag ? ballSym : scenarioBallSym}
          </text>
        </g>

        {/* Rod — draggable in drag stages, fixed in predict */}
        <g
          transform={`translate(${displayRodX}, ${BALL_CY})`}
          style={{
            cursor: isDrag ? (dragging === 'rod' ? 'grabbing' : 'grab') : 'default',
            transition: (isPredict && dragging === null) ? 'transform 0.6s ease-in-out' : 'none',
          }}
          onPointerDown={(e) => onPointerDown('rod', e)}
        >
          {/* Bigger transparent hit area */}
          <rect x={-ROD_HALF - 6} y={-ROD_HEIGHT} width={(ROD_HALF + 6) * 2} height={ROD_HEIGHT * 2} fill="transparent" />
          <rect x={-ROD_HALF} y={-ROD_HEIGHT / 2} width={ROD_HALF * 2} height={ROD_HEIGHT} rx={ROD_HEIGHT / 2}
            fill={rodColor} stroke={rodStroke} strokeWidth={1.2} />
          <text
            x={-ROD_HALF + 10}
            y={-ROD_HEIGHT - 6}
            fill="#6C7A93"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={10}
            pointerEvents="none"
          >
            {rodMat === 'glass' ? labels.glass : labels.ebonite}
          </text>
          {/* Live rub-progress (drag) or scenario-fixed charge (predict) */}
          {isDrag && rubSymbols()}
          {isPredict && scenario.rodQ !== 0 && (() => {
            const sym = scenario.rodQ > 0 ? '+' : '−'
            const color = scenario.rodQ > 0 ? '#F97316' : '#37C9B8'
            return [-1, 0, 1].map((k) => (
              <text
                key={k}
                x={k * 40}
                y={4}
                fill={color}
                fontFamily="'JetBrains Mono', monospace"
                fontSize={20}
                fontWeight={700}
                textAnchor="middle"
                dominantBaseline="middle"
                pointerEvents="none"
              >
                {sym}
              </text>
            ))
          })()}
        </g>

        {/* Cloth — draggable in drag stages only */}
        {isDrag && (
          <g
            transform={`translate(${clothX}, ${clothY})`}
            style={{ cursor: dragging === 'cloth' ? 'grabbing' : 'grab' }}
            onPointerDown={(e) => onPointerDown('cloth', e)}
          >
            <rect x={-CLOTH_W / 2 - 4} y={-CLOTH_H / 2 - 4} width={CLOTH_W + 8} height={CLOTH_H + 8} fill="transparent" />
            <rect x={-CLOTH_W / 2} y={-CLOTH_H / 2} width={CLOTH_W} height={CLOTH_H} rx={4}
              fill={clothFabricColor} stroke={clothStroke} strokeWidth={1.2} />
            {/* Fabric weave suggestion */}
            <line x1={-CLOTH_W / 2 + 6} y1={-CLOTH_H / 2 + 6} x2={CLOTH_W / 2 - 6} y2={CLOTH_H / 2 - 6}
              stroke={clothStroke} strokeWidth={0.4} opacity={0.5} />
            <line x1={-CLOTH_W / 2 + 6} y1={CLOTH_H / 2 - 6} x2={CLOTH_W / 2 - 6} y2={-CLOTH_H / 2 + 6}
              stroke={clothStroke} strokeWidth={0.4} opacity={0.5} />
            <text
              x={0}
              y={CLOTH_H / 2 + 12}
              fill="#6C7A93"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
              textAnchor="middle"
              pointerEvents="none"
            >
              {clothMat === 'silk' ? labels.silk : labels.fur}
            </text>
          </g>
        )}

        {/* Outcome indicator when close */}
        {proximity > 0.3 && (
          <text
            x={(displayRodX + ROD_HALF + BALL_CX - BALL_R) / 2}
            y={BALL_CY - 55}
            fill={currentOutcome === 'neither' ? '#6C7A93' : '#F9A968'}
            fontFamily="'JetBrains Mono', monospace"
            fontSize={11}
            textAnchor="middle"
            opacity={proximity}
            pointerEvents="none"
          >
            {currentOutcome === 'attract' ? `↔ ${labels.attract}` : currentOutcome === 'repel' ? `↮ ${labels.repel}` : `— ${labels.neither}`}
          </text>
        )}

        {/* Hint arrows for first-time users on drag stages */}
        {isDrag && rubEffort < 0.1 && dragging === null && (
          <text
            x={CLOTH_REST_X}
            y={CLOTH_REST_Y - CLOTH_H / 2 - 20}
            fill="#54617A"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={9}
            textAnchor="middle"
            pointerEvents="none"
          >
            ↑ {labels.hint_drag_cloth}
          </text>
        )}
        {isDrag && rubEffort >= RUB_CHARGED_THRESHOLD && proximity < 0.1 && dragging === null && (
          <text
            x={ROD_REST_X}
            y={BALL_CY - 30}
            fill="#54617A"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={9}
            textAnchor="middle"
            pointerEvents="none"
          >
            → {labels.hint_drag_rod}
          </text>
        )}

      </svg>

      {/* HUD overlays */}
      <div style={{ position: 'absolute', top: '3rem', left: '3rem', fontFamily: "'JetBrains Mono', monospace", fontSize: '2.3rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: '#6C7A93', zIndex: 5, pointerEvents: 'none' }}>
        {hudTL}
      </div>
      <div style={{ position: 'absolute', top: '3rem', right: '3rem', fontFamily: "'JetBrains Mono', monospace", fontSize: '2.3rem', letterSpacing: '0.08em', color: canSubmit ? '#37C9B8' : '#B9C4D6', zIndex: 5, pointerEvents: 'none' }}>
        {hudTR}
      </div>
      <div style={{ position: 'absolute', bottom: '3rem', left: '3rem', fontFamily: "'JetBrains Mono', monospace", fontSize: '2.3rem', letterSpacing: '0.06em', color: '#6C7A93', zIndex: 5, pointerEvents: 'none', maxWidth: '58%' }}>
        {hudBL}
      </div>

      {/* Right panel — aligned with scene box (SVG y=60..400).
          top:9.7rem = title baseline at SVG y≈52; bottom:11.1rem = box bottom at y=400. */}
      <div
        style={{
          position: 'absolute',
          top: '9.7rem', bottom: '11.1rem',
          right: '6.7rem',
          width: '40rem',
          boxSizing: 'border-box',
          zIndex: 6,
          color: '#B9C4D6',
          fontFamily: "'JetBrains Mono', monospace",
          display: 'flex', flexDirection: 'column',
        }}
      >
        <div style={{ fontSize: '2.44rem', color: '#6C7A93', letterSpacing: '0.1em', marginBottom: '1.2rem', marginLeft: '0.4rem' }}>
          {isDrag ? labels.controls : labels.question}
        </div>
        <div
          style={{
            flex: 1,
            border: '1px solid #12203a', borderRadius: '0.6rem',
            padding: '2.5rem',
            display: 'flex', flexDirection: 'column', gap: '3rem',
            fontSize: '2rem',
            overflow: 'auto',
          }}
        >
        {isDrag && (
          <>
            <FieldGroup label={labels.field_rod}>
              <Toggle
                options={[
                  { value: 'glass', label: labels.glass },
                  { value: 'ebonite', label: labels.ebonite },
                ]}
                value={rodMat}
                onChange={(v) => setRodMat(v as RodMaterial)}
              />
            </FieldGroup>
            <FieldGroup label={labels.field_cloth}>
              <Toggle
                options={[
                  { value: 'silk', label: labels.silk },
                  { value: 'fur', label: labels.fur },
                ]}
                value={clothMat}
                onChange={(v) => setClothMat(v as ClothMaterial)}
              />
            </FieldGroup>
            {isFull && (
              <FieldGroup label={labels.field_ball}>
                <div style={{ fontSize: '1.7rem', color: '#6C7A93' }}>
                  {labels.click_ball_hint}
                </div>
              </FieldGroup>
            )}
            {isSimple && (
              <FieldGroup label={labels.field_ball}>
                <div style={{ fontSize: '1.7rem', color: '#6C7A93' }}>
                  {labels.ball_prefixed}
                </div>
              </FieldGroup>
            )}
            <div style={{
              display: 'flex', flexDirection: 'column', gap: '0.4rem',
              padding: '0.7rem 0.9rem', border: '1px solid #12203a', borderRadius: '0.5rem',
            }}>
              <div style={{ fontSize: '1.5rem', color: '#54617A', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                {labels.field_status}
              </div>
              <div style={{ fontSize: '1.7rem', color: '#B9C4D6' }}>
                {labels.rod}: <ChargeChip q={rodQ} /> &nbsp;
                {labels.ball}: <ChargeChip q={ballQ} />
              </div>
              <div style={{ fontSize: '1.5rem', color: '#6C7A93' }}>
                {labels.rub_progress}: {Math.round(rubEffort * 100)}%
              </div>
            </div>
          </>
        )}

        {isPredict && (
          <>
            <div style={{ fontSize: '1.9rem', color: '#B9C4D6', lineHeight: 1.5 }}>
              {labels.rod_is} <ChargeChip q={scenario.rodQ} /> ({scenarioChargeText(scenario.rodQ, labels)}).
              <br />
              {labels.ball_is} <ChargeChip q={scenario.ballQ} /> ({scenarioChargeText(scenario.ballQ, labels)}).
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {(['attract', 'repel', 'neither'] as Outcome[]).map((o) => {
                const isPicked = pick === o
                const isCorrect = pick !== null && o === correctAnswer
                const isWrong = pick !== null && isPicked && o !== correctAnswer
                const bg = isCorrect ? '#37C9B8' : isWrong ? '#F97316' : isPicked ? '#3A4863' : 'transparent'
                const fg = isCorrect || isWrong ? '#0D1524' : '#B9C4D6'
                return (
                  <button
                    key={o}
                    type="button"
                    disabled={pick !== null}
                    onClick={() => pickAnswer(o)}
                    style={{
                      padding: '0.9rem 1.2rem',
                      background: bg,
                      color: fg,
                      border: '1px solid #3A4863',
                      borderRadius: '0.5rem',
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: '1.9rem',
                      textAlign: 'left',
                      cursor: pick !== null ? 'default' : 'pointer',
                      opacity: pick !== null && !isPicked && !isCorrect ? 0.4 : 1,
                    }}
                  >
                    {outcomeLabel(o)}
                    {isCorrect ? '  ✓' : isWrong ? '  ✗' : ''}
                  </button>
                )
              })}
            </div>
            {pick !== null && (
              <button
                type="button"
                onClick={nextScenario}
                style={btnStyle('#37C9B8', true)}
              >
                {labels.next_q} →
              </button>
            )}
          </>
        )}
        </div>
      </div>
    </div>
  )
}

// ─── Small HTML components ────────────────────────────────────────
function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
      <div style={{ fontSize: '1.5rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: '#54617A' }}>{label}</div>
      {children}
    </div>
  )
}

function Toggle<T extends string>({ options, value, onChange }: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div style={{ display: 'flex', gap: '0.6rem' }}>
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            style={{
              flex: 1,
              padding: '0.9rem 1rem',
              background: active ? '#3A4863' : 'transparent',
              color: active ? '#EAF0FA' : '#6C7A93',
              border: '1px solid #3A4863',
              borderRadius: '0.5rem',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '1.9rem',
              cursor: 'pointer',
            }}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

function ChargeChip({ q }: { q: Charge }) {
  const color = q === 1 ? '#F9A968' : q === -1 ? '#7EE3D8' : '#6C7A93'
  const sym = q === 1 ? '+' : q === -1 ? '−' : '∅'
  return (
    <span
      style={{
        display: 'inline-block',
        minWidth: '1.8em',
        padding: '0 0.4rem',
        border: `1px solid ${color}`,
        color,
        borderRadius: '0.3rem',
        textAlign: 'center',
        fontWeight: 700,
        fontFamily: "'JetBrains Mono', monospace",
      }}
    >
      {sym}
    </span>
  )
}

function scenarioChargeText(q: Charge, labels: Record<string, string>): string {
  const key = q === 1 ? 'charge_pos' : q === -1 ? 'charge_neg' : 'charge_neutral'
  return labels[key] ?? key
}

function btnStyle(color: string, active: boolean, disabled = false): React.CSSProperties {
  return {
    padding: '1rem 1.4rem',
    background: active ? color : 'transparent',
    color: active ? '#0D1524' : color,
    border: `1px solid ${color}`,
    borderRadius: '0.5rem',
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: '2rem',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.4 : 1,
    flex: 1,
  }
}
