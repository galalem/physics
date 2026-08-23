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
import fr from '../i18n/fr.json'
import ar from '../i18n/ar.json'
import { Car, CAR_W, FLY_ROOF_DX, FLY_ROOF_DY } from './art/Car'
import { Pedestrian } from './art/Pedestrian'
import { Fly } from './art/Fly'

// ─── Scene constants ────────────────────────────────────────────────────
const W = 800
const H = 450

// Road / sidewalk / play area
const ROAD_Y = 340 // horizon of the road (car's wheels rest here)
const SIDEWALK_Y = 380 // pedestrian's feet
const SCENE_LEFT = 60
const SCENE_RIGHT = W - 60

// Motion parameters (qualitative — 1ère level, no vectors)
const CAR_SPEED_PX = 90 // SVG units per second
const PED_SPEED_PX = 32 // pedestrian's forward walking speed
// The pedestrian walks obliquely — from BR toward TL of the sidewalk band.
// Direction vector normalized:
const PED_DIR = { x: -0.85, y: -0.53 } // moves left-and-up-across-the-scene
// Loop period (seconds) — one full sweep of the car across the scene.
const LOOP_SECONDS = (SCENE_RIGHT - SCENE_LEFT + CAR_W) / CAR_SPEED_PX

// Frames
type Frame = 'road' | 'car' | 'pedestrian'
const FRAMES: Frame[] = ['road', 'car', 'pedestrian']

// Stage-3 attempt budget (§5.2)
const STAGE3_ATTEMPTS = 3

// ─── i18n plumbing ──────────────────────────────────────────────────────
const dict = { en, fr, ar } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── Trajectory samples per frame (deterministic, hand-authored geometry) ─
// Each returns an SVG path drawn in the "trajectory panel" band centred on
// (TRAJ_CX, TRAJ_CY). The panel is a small preview box on the left side.
const TRAJ_CX = 200
const TRAJ_CY = 220
const TRAJ_HALF = 60 // half-width of the trajectory sample line

function trajectoryPath(frame: Frame): string {
  switch (frame) {
    case 'road':
      // Horizontal line, left-to-right
      return `M ${TRAJ_CX - TRAJ_HALF} ${TRAJ_CY} L ${TRAJ_CX + TRAJ_HALF} ${TRAJ_CY}`
    case 'car':
      // Stationary point — represented as a tight cluster; drawn as a
      // short zero-length "line" (single point rendered separately).
      return `M ${TRAJ_CX} ${TRAJ_CY} L ${TRAJ_CX} ${TRAJ_CY}`
    case 'pedestrian': {
      // Inclined line — car moving one way, pedestrian moving obliquely
      // → relative velocity is inclined.
      const dx = TRAJ_HALF
      const dy = -TRAJ_HALF * 0.55
      return `M ${TRAJ_CX - dx} ${TRAJ_CY - dy} L ${TRAJ_CX + dx} ${TRAJ_CY + dy}`
    }
  }
}

// Marker at the trajectory midpoint (helps signal "stationary dot" for car frame)
function trajectoryEndpoints(frame: Frame): { x: number; y: number }[] {
  switch (frame) {
    case 'road':
      return [
        { x: TRAJ_CX - TRAJ_HALF, y: TRAJ_CY },
        { x: TRAJ_CX + TRAJ_HALF, y: TRAJ_CY },
      ]
    case 'car':
      return [{ x: TRAJ_CX, y: TRAJ_CY }]
    case 'pedestrian':
      return [
        { x: TRAJ_CX - TRAJ_HALF, y: TRAJ_CY + TRAJ_HALF * 0.55 },
        { x: TRAJ_CX + TRAJ_HALF, y: TRAJ_CY - TRAJ_HALF * 0.55 },
      ]
  }
}

// ─── Stage-2 seeded pairings ────────────────────────────────────────────
// A set of 3 (shownTrajectory, correctFrame) pairings — student picks the frame.
// Each setup is one permutation of the 3 frames; seed picks which permutation.
const STAGE2_SETUPS: Frame[][] = [
  ['road', 'car', 'pedestrian'],
  ['pedestrian', 'road', 'car'],
  ['car', 'pedestrian', 'road'],
  ['road', 'pedestrian', 'car'],
  ['pedestrian', 'car', 'road'],
]

// ─── Stage-3 seeded single-question setups ──────────────────────────────
// Blind stage: single trajectory shown, student names the frame.
// Each setup shows a distinct trajectory; the correct answer is the frame
// that would produce it in the underlying scene.
const STAGE3_SETUPS: Frame[] = ['car', 'pedestrian', 'road', 'car', 'pedestrian']

// ─── Component ──────────────────────────────────────────────────────────
export default function Scene() {
  const { locale, seed } = useInit()
  const stages = useMemo(() => getStagesFor(locale), [locale])
  useDeclareStages(stages)
  const labels = useMemo(() => svgLabels(locale), [locale])

  const stageIdx = useCurrentStage()
  const setStage = useSetStage()
  const complete = useComplete()
  const progress = useProgress()

  // ── Stage 1 state ─────────────────────────────────────────────────────
  const [selectedFrame, setSelectedFrame] = useState<Frame>('road')
  const [framesSeen, setFramesSeen] = useState<Frame[]>(['road'])

  // ── Stage 2 state ─────────────────────────────────────────────────────
  const setup2 = useMemo(
    () => STAGE2_SETUPS[seed % STAGE2_SETUPS.length]!,
    [seed],
  )
  const [step2Idx, setStep2Idx] = useState(0) // 0..2
  const [step2Pick, setStep2Pick] = useState<Frame>('road')
  const [step2Matched, setStep2Matched] = useState<boolean[]>([false, false, false])
  const [step2Feedback, setStep2Feedback] = useState<null | 'correct' | 'wrong'>(null)

  // ── Stage 3 state ─────────────────────────────────────────────────────
  const setup3 = useMemo(
    () => STAGE3_SETUPS[seed % STAGE3_SETUPS.length]!,
    [seed],
  )
  const [step3Pick, setStep3Pick] = useState<Frame>('road')
  const [step3Attempts, setStep3Attempts] = useState(STAGE3_ATTEMPTS)
  const [step3Solved, setStep3Solved] = useState(false)
  const [step3Feedback, setStep3Feedback] = useState<null | 'correct' | 'wrong'>(null)

  const [peekTip, setPeekTip] = useState<string | null>(null)

  // ── Animation clock (only stage 1 & 2 render the scene) ───────────────
  const [tSec, setTSec] = useState(0)
  const startRef = useRef(performance.now())
  useTicker(() => {
    if (stageIdx === 3) return // blind stage: no scene animation
    const now = performance.now()
    const elapsed = ((now - startRef.current) / 1000) % LOOP_SECONDS
    setTSec(elapsed)
  })

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  // ── Reset ─────────────────────────────────────────────────────────────
  const resetStageState = useCallback(() => {
    setSelectedFrame('road')
    setFramesSeen(['road'])
    setStep2Idx(0)
    setStep2Pick('road')
    setStep2Matched([false, false, false])
    setStep2Feedback(null)
    setStep3Pick('road')
    setStep3Attempts(STAGE3_ATTEMPTS)
    setStep3Solved(false)
    setStep3Feedback(null)
    setPeekTip(null)
    startRef.current = performance.now()
  }, [])
  useReset(resetStageState)

  // ── Frame selection handlers ──────────────────────────────────────────
  const chooseFrameStage1 = useCallback((f: Frame) => {
    setSelectedFrame(f)
    setFramesSeen((prev) => (prev.includes(f) ? prev : [...prev, f]))
  }, [])

  const chooseFrameStage2 = useCallback((f: Frame) => {
    setStep2Pick(f)
    setStep2Feedback(null)
  }, [])

  const chooseFrameStage3 = useCallback((f: Frame) => {
    if (step3Solved || step3Attempts <= 0) return
    setStep3Pick(f)
    setStep3Feedback(null)
  }, [step3Solved, step3Attempts])

  // ── Confirm button (FIRE analogue) ────────────────────────────────────
  const confirmStage2 = useCallback(() => {
    if (step2Matched[step2Idx]) return
    const correct = setup2[step2Idx] === step2Pick
    if (correct) {
      setStep2Feedback('correct')
      setStep2Matched((prev) => {
        const next = [...prev]
        next[step2Idx] = true
        return next
      })
    } else {
      setStep2Feedback('wrong')
    }
  }, [step2Idx, step2Pick, step2Matched, setup2])

  const advanceStage2 = useCallback(() => {
    if (step2Idx < 2) {
      setStep2Idx(step2Idx + 1)
      setStep2Pick('road')
      setStep2Feedback(null)
    }
  }, [step2Idx])

  const confirmStage3 = useCallback(() => {
    if (step3Solved || step3Attempts <= 0) return
    const correct = setup3 === step3Pick
    if (correct) {
      setStep3Feedback('correct')
      setStep3Solved(true)
    } else {
      setStep3Feedback('wrong')
      setStep3Attempts((n) => n - 1)
    }
  }, [setup3, step3Pick, step3Solved, step3Attempts])

  // ── Blind-stage fail: out of attempts without solve → restart ─────────
  useEffect(() => {
    if (!isStage3) return
    if (step3Attempts === 0 && !step3Solved) {
      const t = setTimeout(() => resetStageState(), 1200)
      return () => clearTimeout(t)
    }
    return undefined
  }, [isStage3, step3Attempts, step3Solved, resetStageState])

  // ── Advance predicate ─────────────────────────────────────────────────
  const canSubmit = isStage1
    ? framesSeen.length === 3
    : isStage2
      ? step2Matched.every(Boolean)
      : step3Solved

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

  // ── Peek (blind stage strategy hint — text, NEVER the scene) ──────────
  const PEEK_TIPS = useMemo(
    () => [
      labels.peek_tip_rest,
      labels.peek_tip_horizontal,
      labels.peek_tip_inclined,
    ],
    [labels],
  )
  const peekIdxRef = useRef(0)
  usePeek(() => {
    if (!isStage3) return
    setPeekTip(PEEK_TIPS[peekIdxRef.current % PEEK_TIPS.length]!)
    peekIdxRef.current += 1
  })
  useEffect(() => {
    if (!peekTip) return
    const t = setTimeout(() => setPeekTip(null), 4000)
    return () => clearTimeout(t)
  }, [peekTip])

  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  // ── Scene positions (stage 1 & 2) ─────────────────────────────────────
  // Car moves left-to-right along the road, wraps.
  const carXAbs = SCENE_LEFT + tSec * CAR_SPEED_PX
  // Pedestrian moves obliquely; wraps within a band.
  const pedT = (tSec * PED_SPEED_PX) % (SCENE_RIGHT - SCENE_LEFT)
  const pedXAbs = SCENE_RIGHT - pedT * -PED_DIR.x
  const pedYAbs = SIDEWALK_Y + pedT * -PED_DIR.y * 0.35 // gentle diagonal

  // Fly position on the roof (absolute, in stage 1 & 2)
  const flyAbs = { x: carXAbs + FLY_ROOF_DX, y: ROAD_Y + FLY_ROOF_DY }

  // Depending on the selected/observed frame in stage 1, the trajectory
  // is drawn as a dashed line over the scene near the fly.
  //  - road frame: horizontal line spanning the visible portion of the trip
  //  - car frame: a single dot at the fly's roof position
  //  - pedestrian frame: an inclined line
  function stageOneTrajectoryPath(frame: Frame): string {
    const yFly = ROAD_Y + FLY_ROOF_DY
    switch (frame) {
      case 'road':
        return `M ${SCENE_LEFT} ${yFly} L ${SCENE_RIGHT - CAR_W / 2} ${yFly}`
      case 'car':
        // "Stationary dot" — represented by a very short trace at fly pos.
        return `M ${flyAbs.x - 1} ${flyAbs.y} L ${flyAbs.x + 1} ${flyAbs.y}`
      case 'pedestrian': {
        // Inclined line — from BR of visible area, toward TL of scene
        const x1 = SCENE_LEFT + 60
        const y1 = yFly - 40
        const x2 = SCENE_RIGHT - CAR_W / 2
        const y2 = yFly + 30
        return `M ${x1} ${y1} L ${x2} ${y2}`
      }
    }
  }

  // ── HUD text ──────────────────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`
  const hudTR = isStage1
    ? `${labels.frames_seen} ${framesSeen.length}/3`
    : isStage2
      ? `${labels.matched} ${step2Matched.filter(Boolean).length}/3`
      : `${labels.attempts} ${step3Attempts}/${STAGE3_ATTEMPTS}`
  const hudBL = isStage3 && peekTip
    ? peekTip
    : isStage1
      ? labels.tip1
      : isStage2
        ? labels.tip2
        : labels.tip3
  // BR is intentionally EMPTY — reserved for parent-side chrome (§4.3).

  // Current pick per stage
  const pickForStage: Frame = isStage2 ? step2Pick : isStage3 ? step3Pick : selectedFrame
  const setPickForStage = (f: Frame) => {
    if (isStage1) chooseFrameStage1(f)
    else if (isStage2) chooseFrameStage2(f)
    else if (isStage3) chooseFrameStage3(f)
  }

  // Confirm button state
  const canConfirm = isStage2
    ? !step2Matched[step2Idx]
    : isStage3
      ? !step3Solved && step3Attempts > 0
      : false
  const showConfirm = isStage2 || isStage3

  // Stage-2 shown trajectory & advance to next pairing
  const shownFrame2 = setup2[step2Idx]!
  const shownTrajectoryFrame: Frame = isStage2 ? shownFrame2 : setup3

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
          touchAction: 'none',
          userSelect: 'none',
        }}
      >
        {/* Background — NO rx per §4.4 */}
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        {/* Faint grid */}
        {Array.from({ length: 13 }).map((_, i) => (
          <line
            key={`gx${i}`}
            x1={60 + i * 60}
            y1={40}
            x2={60 + i * 60}
            y2={H - 40}
            stroke="#12203a"
            strokeWidth={1}
          />
        ))}
        {Array.from({ length: 7 }).map((_, i) => (
          <line
            key={`gy${i}`}
            x1={40}
            y1={60 + i * 55}
            x2={W - 40}
            y2={60 + i * 55}
            stroke="#12203a"
            strokeWidth={1}
          />
        ))}

        {/* Scene: stages 1 & 2 render road + car + pedestrian + fly.
            Stage 3 renders only the trajectory + fly dot (blind). */}
        {(isStage1 || isStage2) && (
          <>
            {/* Road line */}
            <line x1={SCENE_LEFT - 20} y1={ROAD_Y} x2={SCENE_RIGHT + 20} y2={ROAD_Y} stroke="#3A4863" strokeWidth={1.5} />
            {/* Sidewalk stripe (a lighter band above the road, cosmetic) */}
            <line x1={SCENE_LEFT - 20} y1={SIDEWALK_Y} x2={SCENE_RIGHT + 20} y2={SIDEWALK_Y} stroke="#2A3244" strokeWidth={1} strokeDasharray="4 6" />
            {/* Road-frame labels */}
            <text x={SCENE_LEFT - 10} y={ROAD_Y + 22} fill="#54617A" fontFamily="'JetBrains Mono', monospace" fontSize={10}>
              {labels.road}
            </text>

            {/* Car */}
            <Car x={carXAbs} y={ROAD_Y} dim={isStage2} />

            {/* Pedestrian */}
            <Pedestrian x={pedXAbs} y={pedYAbs} dim={isStage2} />

            {/* Fly on car roof */}
            <Fly x={flyAbs.x} y={flyAbs.y} label={labels.fly} />
          </>
        )}

        {/* Stage 1: overlay the selected-frame trajectory of the fly onto
            the live scene as a dashed line. This IS help — trajectory
            visualization is the observation lesson. It's OK on stage 1
            (Observe) but MUST NOT appear on the blind stage. */}
        {isStage1 && (
          <path
            d={stageOneTrajectoryPath(selectedFrame)}
            stroke="#37C9B8"
            strokeWidth={2}
            strokeDasharray="6 5"
            fill="none"
            opacity={0.85}
          />
        )}

        {/* Stage 2 & 3: show a trajectory sample box with the challenge
            trajectory drawn inside. Student picks the matching frame. */}
        {(isStage2 || isStage3) && (
          <g>
            <rect
              x={TRAJ_CX - TRAJ_HALF - 20}
              y={TRAJ_CY - TRAJ_HALF - 20}
              width={2 * TRAJ_HALF + 40}
              height={2 * TRAJ_HALF + 40}
              fill="rgba(30,42,64,0.55)"
              stroke="#3A4863"
              strokeWidth={1.2}
              rx={6}
            />
            <text
              x={TRAJ_CX}
              y={TRAJ_CY - TRAJ_HALF - 6}
              fill="#6C7A93"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
              textAnchor="middle"
            >
              {labels.trajectory}
            </text>
            {/* Trajectory line */}
            {shownTrajectoryFrame !== 'car' && (
              <path
                d={trajectoryPath(shownTrajectoryFrame)}
                stroke="#37C9B8"
                strokeWidth={2.4}
                strokeDasharray="6 5"
                fill="none"
              />
            )}
            {/* Endpoint dots + midpoint dot for the stationary case */}
            {trajectoryEndpoints(shownTrajectoryFrame).map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r={shownTrajectoryFrame === 'car' ? 5 : 3.2} fill="#F97316" stroke="#0D1524" strokeWidth={0.8} />
            ))}
            {/* Step counter for stage 2 */}
            {isStage2 && (
              <text
                x={TRAJ_CX}
                y={TRAJ_CY + TRAJ_HALF + 30}
                fill="#B9C4D6"
                fontFamily="'JetBrains Mono', monospace"
                fontSize={11}
                textAnchor="middle"
              >
                {step2Idx + 1} / 3
              </text>
            )}
          </g>
        )}

        {/* Stage 3 mini-fly indicator next to the trajectory (required
            info: what point is being observed). */}
        {isStage3 && (
          <g>
            <text
              x={TRAJ_CX}
              y={TRAJ_CY + TRAJ_HALF + 50}
              fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
              textAnchor="middle"
            >
              {labels.fly}
            </text>
          </g>
        )}
      </svg>

      {/* HUD overlays (HTML in rem) */}
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
          color: '#37C9B8',
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
          maxWidth: '55rem',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '2rem',
          letterSpacing: '0.06em',
          color: '#6C7A93',
          zIndex: 5,
          pointerEvents: 'none',
          lineHeight: 1.3,
        }}
      >
        {hudBL}
      </div>
      {/* BR is intentionally EMPTY — reserved for parent-side chrome. */}

      {/* Frame picker — vertical stack on the right */}
      <div
        style={{
          position: 'absolute',
          top: '14rem',
          right: '3rem',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'stretch',
          gap: '1.2rem',
          width: '20rem',
          zIndex: 6,
        }}
      >
        <div
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '1.7rem',
            color: '#54617A',
            textAlign: 'center',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
          }}
        >
          {isStage1 ? 'Frame' : labels.pick_frame}
        </div>
        {FRAMES.map((f) => {
          const active = pickForStage === f
          const label =
            f === 'road' ? labels.frame_road : f === 'car' ? labels.frame_car : labels.frame_pedestrian
          return (
            <button
              key={f}
              type="button"
              onClick={() => setPickForStage(f)}
              disabled={isStage3 && (step3Solved || step3Attempts <= 0)}
              style={{
                padding: '1.4rem 1.6rem',
                background: active ? '#F97316' : 'rgba(30,42,64,0.85)',
                color: active ? '#FFFFFF' : '#B9C4D6',
                border: `0.25rem solid ${active ? '#F97316' : 'rgba(58,72,99,0.6)'}`,
                borderRadius: '1.2rem',
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '2rem',
                letterSpacing: '0.06em',
                cursor:
                  isStage3 && (step3Solved || step3Attempts <= 0) ? 'not-allowed' : 'pointer',
                textAlign: 'center',
                transition: 'background 0.15s, border 0.15s',
              }}
            >
              {label}
            </button>
          )
        })}
      </div>

      {/* Confirm button (only stage 2 & 3) */}
      {showConfirm && (
        <button
          type="button"
          onClick={isStage2 ? confirmStage2 : confirmStage3}
          disabled={!canConfirm}
          style={{
            position: 'absolute',
            bottom: '3rem',
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '2rem 4rem',
            background: canConfirm ? '#F97316' : 'rgba(30,42,64,0.85)',
            color: canConfirm ? '#FFFFFF' : '#6C7A93',
            border: `0.3rem solid ${canConfirm ? '#F97316' : 'rgba(58,72,99,0.6)'}`,
            borderRadius: '100rem',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '2.6rem',
            fontWeight: 700,
            letterSpacing: '0.12em',
            cursor: canConfirm ? 'pointer' : 'not-allowed',
            zIndex: 10,
          }}
        >
          <i
            className="bi bi-check2-circle"
            style={{ marginInlineEnd: '0.8rem', fontSize: '2.6rem', verticalAlign: '-0.2rem' }}
          />
          {labels.fire}
        </button>
      )}

      {/* Stage-2 advance-to-next-pairing button — appears after correct match */}
      {isStage2 && step2Matched[step2Idx] && step2Idx < 2 && (
        <button
          type="button"
          onClick={advanceStage2}
          style={{
            position: 'absolute',
            bottom: '9rem',
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '1rem 2rem',
            background: 'rgba(55,201,184,0.15)',
            color: '#37C9B8',
            border: '0.25rem solid #37C9B8',
            borderRadius: '100rem',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '1.8rem',
            letterSpacing: '0.1em',
            cursor: 'pointer',
            zIndex: 10,
          }}
        >
          NEXT ({step2Idx + 2}/3)
        </button>
      )}

      {/* Stage-2 feedback chip */}
      {isStage2 && step2Feedback && (
        <div
          style={{
            position: 'absolute',
            top: '8rem',
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '1rem 2rem',
            background:
              step2Feedback === 'correct' ? 'rgba(55,201,184,0.18)' : 'rgba(249,115,22,0.18)',
            color: step2Feedback === 'correct' ? '#37C9B8' : '#F9A968',
            border: `0.2rem solid ${step2Feedback === 'correct' ? '#37C9B8' : '#F97316'}`,
            borderRadius: '0.8rem',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '1.8rem',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            zIndex: 8,
          }}
        >
          {step2Feedback === 'correct' ? labels.correct : labels.wrong}
        </div>
      )}

      {/* Stage-3 feedback chip */}
      {isStage3 && step3Feedback && (
        <div
          style={{
            position: 'absolute',
            top: '8rem',
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '1rem 2rem',
            background:
              step3Feedback === 'correct' ? 'rgba(55,201,184,0.18)' : 'rgba(249,115,22,0.18)',
            color: step3Feedback === 'correct' ? '#37C9B8' : '#F9A968',
            border: `0.2rem solid ${step3Feedback === 'correct' ? '#37C9B8' : '#F97316'}`,
            borderRadius: '0.8rem',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '1.8rem',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            zIndex: 8,
          }}
        >
          {step3Feedback === 'correct' ? labels.correct : labels.wrong}
        </div>
      )}
    </div>
  )
}
