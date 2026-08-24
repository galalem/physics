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

// Rectangular series-loop layout (world coords, SVG viewBox units)
const LOOP_LEFT = 160
const LOOP_RIGHT = 480
const LOOP_TOP = 145
const LOOP_BOTTOM = 335

const GEN_CX = (LOOP_LEFT + LOOP_RIGHT) / 2
const GEN_CY = LOOP_TOP // top side
const R1_CX = LOOP_RIGHT
const R1_CY = (LOOP_TOP + LOOP_BOTTOM) / 2 // right side
const R2_CX = (LOOP_LEFT + LOOP_RIGHT) / 2 + 55 // right half of bottom side
const R2_CY = LOOP_BOTTOM
const AMM_CX = LOOP_LEFT
const AMM_CY = (LOOP_TOP + LOOP_BOTTOM) / 2 // left side
const SW_CX = (LOOP_LEFT + LOOP_RIGHT) / 2 - 60 // left half of bottom side
const SW_CY = LOOP_BOTTOM

// ─── Pouillet solver (pure) ────────────────────────────────────────────
// Test: E=12, r=2, R₁=10, R₂=12 → R_total = 24 → I = 0.5 A
// Test: E=6, r=1, R₁=1, R₂=2 → R_total = 4 → I = 1.5 A
// Test: E=10, r=0.5, R₁=1.5, R₂=2 → R_total = 4 → I = 2.5 A
type CircuitParams = { E: number; r: number; R1: number; R2: number; useR2: boolean }
function pouilletI(p: CircuitParams): number {
  const Rt = p.R1 + (p.useR2 ? p.R2 : 0)
  const denom = p.r + Rt
  if (denom <= 0) return 0
  return p.E / denom
}

// ─── Hand-authored stage-2 targets ────────────────────────────────────
type Target = { I: number; label: string }
const STAGE2_TARGETS: Target[] = [
  { I: 1.0, label: 'I ≈ 1.00 A' },
  { I: 0.4, label: 'I ≈ 0.40 A' },
]
const STAGE2_TOLERANCE = 0.05 // ±5%

// ─── Hand-authored stage-3 scenarios (each yields integer or clean 0.5 A) ─
type Scenario = { E: number; r: number; R1: number; R2: number; useR2: boolean; I: number }
const STAGE3_SCENARIOS: Scenario[] = [
  { E: 12, r: 2, R1: 10, R2: 12, useR2: true, I: 0.5 },
  { E: 6, r: 1, R1: 1, R2: 2, useR2: true, I: 1.5 },
  { E: 10, r: 0.5, R1: 1.5, R2: 2, useR2: true, I: 2.5 },
]
const STAGE3_DECK_SIZE = STAGE3_SCENARIOS.length
const STAGE3_MAX_ATTEMPTS = 3
const STAGE3_TOLERANCE = 0.05

// ─── i18n label loader ────────────────────────────────────────────────
const dict = { en } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels as Record<string, string>
}

// ─── Formatting helpers ───────────────────────────────────────────────
function fmt(n: number): string {
  if (Math.abs(n) < 0.005) return '0'
  if (Math.abs(n) < 1) return n.toFixed(2).replace(/\.?0+$/, '')
  if (Number.isInteger(n)) return n.toString()
  return n.toFixed(1).replace(/\.0$/, '')
}
function fmtA(I: number): string {
  if (I >= 1) return `${I.toFixed(2)} A`
  return `${(I * 1000).toFixed(0)} mA`
}

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

  // Slider-driven params for stages 1 & 2
  const [E, setE] = useState(6)
  const [r, setR] = useState(1)
  const [R1, setR1] = useState(4)
  const [R2, setR2] = useState(2)
  const [useR2, setUseR2] = useState(true)

  // Stage-1 coverage
  const [ECov, setECov] = useState<Set<string>>(new Set())
  const [rCov, setRCov] = useState<Set<string>>(new Set())
  const [R1Cov, setR1Cov] = useState<Set<string>>(new Set())
  const [R2Cov, setR2Cov] = useState<Set<string>>(new Set())
  const [sawCurrent, setSawCurrent] = useState(false)

  // Stage-2 targets
  const [targetsHit, setTargetsHit] = useState<boolean[]>(() => STAGE2_TARGETS.map(() => false))

  // Stage-3: seed picks starting scenario, wrap-around
  const scenarioSequence = useMemo(() => {
    const start = Math.abs(seed | 0) % STAGE3_DECK_SIZE
    return Array.from({ length: STAGE3_DECK_SIZE }, (_, i) => (start + i) % STAGE3_DECK_SIZE)
  }, [seed])
  const [scenarioSeqIdx, setScenarioSeqIdx] = useState(0)
  const [attemptsLeft, setAttemptsLeft] = useState(STAGE3_MAX_ATTEMPTS)
  const [stage3Input, setStage3Input] = useState('')
  const [stage3Feedback, setStage3Feedback] =
    useState<'none' | 'wrong' | 'correct' | 'deck-reset'>('none')

  const currentScenario = STAGE3_SCENARIOS[scenarioSequence[scenarioSeqIdx] ?? 0]!

  const complete = useComplete()
  const progress = useProgress()

  // Live circuit (stages 1+2)
  const liveI = pouilletI({ E, r, R1, R2, useR2 })

  // Stage-1 coverage tracker
  useEffect(() => {
    if (!isStage1) return
    setECov((s) => (s.has(E.toFixed(2)) ? s : new Set(s).add(E.toFixed(2))))
    setRCov((s) => (s.has(r.toFixed(2)) ? s : new Set(s).add(r.toFixed(2))))
    setR1Cov((s) => (s.has(R1.toFixed(2)) ? s : new Set(s).add(R1.toFixed(2))))
    setR2Cov((s) => (s.has(R2.toFixed(2)) ? s : new Set(s).add(R2.toFixed(2))))
    if (liveI > 0.01 && !sawCurrent) setSawCurrent(true)
  }, [isStage1, E, r, R1, R2, liveI, sawCurrent])

  // Stage-2 target tracker
  useEffect(() => {
    if (!isStage2) return
    setTargetsHit((prev) => {
      let changed = false
      const next = prev.slice()
      STAGE2_TARGETS.forEach((t, i) => {
        if (next[i]) return
        if (Math.abs(liveI - t.I) / t.I < STAGE2_TOLERANCE) {
          next[i] = true
          changed = true
        }
      })
      return changed ? next : prev
    })
  }, [isStage2, liveI])

  // Advance criteria
  const coverageDone =
    ECov.size >= 2 &&
    rCov.size >= 2 &&
    R1Cov.size >= 2 &&
    R2Cov.size >= 2 &&
    sawCurrent
  const targetsDone = targetsHit.every(Boolean)
  const stage3Done = scenarioSeqIdx >= STAGE3_DECK_SIZE

  const canSubmit = isStage1 ? coverageDone : isStage2 ? targetsDone : stage3Done

  // Reset
  const resetStageState = useCallback(() => {
    setE(6); setR(1); setR1(4); setR2(2); setUseR2(true)
    setECov(new Set()); setRCov(new Set())
    setR1Cov(new Set()); setR2Cov(new Set())
    setSawCurrent(false)
    setTargetsHit(STAGE2_TARGETS.map(() => false))
    setScenarioSeqIdx(0)
    setAttemptsLeft(STAGE3_MAX_ATTEMPTS)
    setStage3Input('')
    setStage3Feedback('none')
  }, [])
  useReset(resetStageState)

  // Progress
  useEffect(() => {
    progress(stageIdx / stages.length, { stage: stageIdx, canSubmit })
  }, [stageIdx, canSubmit, stages.length, progress])

  // Next
  useNext(() => {
    if (stageIdx < stages.length) {
      setStage(stageIdx + 1)
    } else {
      complete({ success: true })
    }
  })

  // Peek — strategy hint only (no answer reveal)
  const [peekText, setPeekText] = useState<string | null>(null)
  usePeek(() => {
    if (!isStage3) return
    setPeekText(labels.peek_tip ?? '')
  })
  useEffect(() => {
    if (!peekText) return
    const t = setTimeout(() => setPeekText(null), 5000)
    return () => clearTimeout(t)
  }, [peekText])

  // Hints
  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  // Stage-3 submit
  const onStage3Submit = useCallback(() => {
    if (stage3Feedback === 'correct' || stage3Feedback === 'deck-reset') return
    const val = parseFloat(stage3Input.replace(',', '.'))
    if (!isFinite(val) || val < 0) {
      setStage3Feedback('wrong')
      return
    }
    const target = currentScenario.I
    const correct = Math.abs(val - target) / target < STAGE3_TOLERANCE
    if (correct) {
      setStage3Feedback('correct')
      setTimeout(() => {
        setStage3Feedback('none')
        setStage3Input('')
        setAttemptsLeft(STAGE3_MAX_ATTEMPTS)
        setScenarioSeqIdx((idx) => idx + 1)
      }, 1200)
    } else {
      const nextAttempts = attemptsLeft - 1
      if (nextAttempts <= 0) {
        setAttemptsLeft(0)
        setStage3Feedback('deck-reset')
        setTimeout(() => {
          setStage3Feedback('none')
          setStage3Input('')
          setScenarioSeqIdx(0)
          setAttemptsLeft(STAGE3_MAX_ATTEMPTS)
        }, 1800)
      } else {
        setAttemptsLeft(nextAttempts)
        setStage3Feedback('wrong')
      }
    }
  }, [attemptsLeft, currentScenario.I, stage3Feedback, stage3Input])

  // Effective values for schematic (fixed on stage 3)
  const dE = isStage3 ? currentScenario.E : E
  const dR = isStage3 ? currentScenario.r : r
  const dR1 = isStage3 ? currentScenario.R1 : R1
  const dR2 = isStage3 ? currentScenario.R2 : R2
  const dUseR2 = isStage3 ? currentScenario.useR2 : useR2

  // HUD
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`

  const hudTR = isStage1
    ? `${labels.coverage}: ` +
      [
        ECov.size >= 2 ? '✓E' : '·E',
        rCov.size >= 2 ? '✓r' : '·r',
        R1Cov.size >= 2 ? '✓R1' : '·R1',
        R2Cov.size >= 2 ? '✓R2' : '·R2',
        sawCurrent ? '✓I' : '·I',
      ].join(' ')
    : isStage2
      ? `${labels.targets}: ${targetsHit.filter(Boolean).length}/${STAGE2_TARGETS.length}`
      : stage3Done
        ? labels.deck_complete
        : `${labels.scenario}: ${scenarioSeqIdx + 1}/${STAGE3_DECK_SIZE} · ${labels.attempts_left}: ${attemptsLeft}`

  const stage2TargetLine = STAGE2_TARGETS.map(
    (t, i) => `${targetsHit[i] ? '✓' : '·'} ${t.label}`,
  ).join('   ')

  const hudBL = isStage1
    ? labels.tip1
    : isStage2
      ? stage2TargetLine
      : (peekText ?? labels.tip3)

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

        {/* Schematic panel frame */}
        <rect
          x={32}
          y={60}
          width={560}
          height={358}
          fill="none"
          stroke="#12203a"
          strokeWidth={1}
          rx={6}
        />
        <text
          x={40}
          y={52}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={11}
          letterSpacing="0.1em"
        >
          {labels.schematic}
        </text>

        {/* Right panel frame */}
        <rect
          x={608}
          y={60}
          width={160}
          height={358}
          fill="none"
          stroke="#12203a"
          strokeWidth={1}
          rx={6}
        />
        <text
          x={616}
          y={52}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={11}
          letterSpacing="0.1em"
        >
          {isStage3 ? labels.given : labels.controls}
        </text>

        {/* Loop wires — structural stubs from corners to component terminals */}
        <g stroke="#3A4863" strokeWidth={2}>
          {[
            [LOOP_LEFT, LOOP_TOP],
            [LOOP_RIGHT, LOOP_TOP],
            [LOOP_RIGHT, LOOP_BOTTOM],
            [LOOP_LEFT, LOOP_BOTTOM],
          ].map(([x, y], i) => (
            <circle key={`c${i}`} cx={x} cy={y} r={2.5} fill="#3A4863" stroke="none" />
          ))}
          {/* Top: generator stubs */}
          <line x1={LOOP_LEFT} y1={LOOP_TOP} x2={GEN_CX - 42} y2={LOOP_TOP} />
          <line x1={GEN_CX + 42} y1={LOOP_TOP} x2={LOOP_RIGHT} y2={LOOP_TOP} />
          {/* Right: R1 (vertical) stubs */}
          <line x1={LOOP_RIGHT} y1={LOOP_TOP} x2={LOOP_RIGHT} y2={R1_CY - 32} />
          <line x1={LOOP_RIGHT} y1={R1_CY + 32} x2={LOOP_RIGHT} y2={LOOP_BOTTOM} />
          {/* Bottom: from bottom-right corner → R2 → switch → bottom-left corner */}
          <line x1={LOOP_RIGHT} y1={LOOP_BOTTOM} x2={R2_CX + 32} y2={LOOP_BOTTOM} />
          <line x1={R2_CX - 32} y1={LOOP_BOTTOM} x2={SW_CX + 32} y2={LOOP_BOTTOM} />
          <line x1={SW_CX - 32} y1={LOOP_BOTTOM} x2={LOOP_LEFT} y2={LOOP_BOTTOM} />
          {/* Left: ammeter (vertical) stubs */}
          <line x1={LOOP_LEFT} y1={LOOP_TOP} x2={LOOP_LEFT} y2={AMM_CY - 32} />
          <line x1={LOOP_LEFT} y1={AMM_CY + 32} x2={LOOP_LEFT} y2={LOOP_BOTTOM} />
        </g>

        {/* Generator (E, r) — top side */}
        <GeneratorSymbol cx={GEN_CX} cy={GEN_CY} E={dE} r={dR} />

        {/* R1 — right side, vertical */}
        <ResistorSymbol
          cx={R1_CX}
          cy={R1_CY}
          orient="v"
          label="R₁"
          value={`${fmt(dR1)} Ω`}
        />

        {/* R2 — bottom (or bypass wire when switch open) */}
        {dUseR2 ? (
          <ResistorSymbol
            cx={R2_CX}
            cy={R2_CY}
            orient="h"
            label="R₂"
            value={`${fmt(dR2)} Ω`}
          />
        ) : (
          <line
            x1={R2_CX - 32}
            y1={R2_CY}
            x2={R2_CX + 32}
            y2={R2_CY}
            stroke="#3A4863"
            strokeWidth={2}
            strokeDasharray="3 3"
          />
        )}

        {/* Switch — bottom, left of R2. Clickable on stages 1+2 only. */}
        <SwitchSymbol
          cx={SW_CX}
          cy={SW_CY}
          closed={dUseR2}
          onClick={isStage3 ? undefined : () => setUseR2((v) => !v)}
        />

        {/* Ammeter — left side, vertical. Reading hidden on stage 3. */}
        <AmmeterSymbol
          cx={AMM_CX}
          cy={AMM_CY}
          reading={isStage3 ? null : liveI}
        />

        {/* Current-flow animation — stages 1+2 only, when I > 0 */}
        {!isStage3 && liveI > 0.01 && (
          <g>
            <path
              id="flow-path"
              d={`M ${LOOP_LEFT} ${LOOP_TOP} L ${LOOP_RIGHT} ${LOOP_TOP} L ${LOOP_RIGHT} ${LOOP_BOTTOM} L ${LOOP_LEFT} ${LOOP_BOTTOM} Z`}
              fill="none"
              stroke="none"
            />
            {[0, 0.5, 1.0, 1.5].map((delay) => (
              <circle key={`f${delay}`} r={2.5} fill="#37C9B8">
                <animateMotion dur="2s" repeatCount="indefinite" begin={`${delay}s`}>
                  <mpath href="#flow-path" />
                </animateMotion>
              </circle>
            ))}
          </g>
        )}

        {/* Formula strip — stages 1+2 only. Hidden on stage 3 (help, per §4.7). */}
        {!isStage3 && (
          <g>
            <rect
              x={80}
              y={378}
              width={464}
              height={30}
              fill="#131F35"
              stroke="#3A4863"
              strokeWidth={1}
              rx={4}
            />
            <text
              x={312}
              y={397}
              textAnchor="middle"
              fill="#B9C4D6"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={13}
            >
              {`I = E / (r + R₁${dUseR2 ? ' + R₂' : ''}) = ${fmt(dE)} / (${fmt(dR)} + ${fmt(dR1)}${
                dUseR2 ? ` + ${fmt(dR2)}` : ''
              }) = ${fmtA(liveI)}`}
            </text>
          </g>
        )}

        {/* Right-panel content — stage 1+2: sliders (foreignObject); stage 3: given values */}
        {!isStage3 && (
          <foreignObject x={614} y={78} width={148} height={330}>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 10,
                color: '#B9C4D6',
              }}
            >
              <SliderRow label="E" unit="V" min={0} max={24} step={0.5} value={E} onChange={setE} />
              <SliderRow label="r" unit="Ω" min={0} max={5} step={0.1} value={r} onChange={setR} decimals={1} />
              <SliderRow label="R₁" unit="Ω" min={0.5} max={20} step={0.5} value={R1} onChange={setR1} decimals={1} />
              <SliderRow
                label="R₂"
                unit="Ω"
                min={0.5}
                max={20}
                step={0.5}
                value={R2}
                onChange={setR2}
                decimals={1}
                enabled={useR2}
              />
              <div
                style={{
                  marginTop: 4,
                  padding: '6px 8px',
                  border: '1px solid #3A4863',
                  borderRadius: 3,
                  background: '#131F35',
                  color: '#6C7A93',
                  fontSize: 9,
                  lineHeight: 1.3,
                }}
              >
                switch = R₂ {useR2 ? 'in loop' : 'bypassed'}
              </div>
            </div>
          </foreignObject>
        )}

        {isStage3 && (
          <g fontFamily="'JetBrains Mono', monospace" fill="#B9C4D6">
            <text x={688} y={102} fontSize={10} textAnchor="middle" fill="#6C7A93" letterSpacing="0.1em">
              {labels.given}
            </text>
            <text x={688} y={128} fontSize={14} textAnchor="middle">E = {fmt(currentScenario.E)} V</text>
            <text x={688} y={150} fontSize={14} textAnchor="middle">r = {fmt(currentScenario.r)} Ω</text>
            <text x={688} y={172} fontSize={14} textAnchor="middle">R₁ = {fmt(currentScenario.R1)} Ω</text>
            <text x={688} y={194} fontSize={14} textAnchor="middle">R₂ = {fmt(currentScenario.R2)} Ω</text>
            <text x={688} y={234} fontSize={10} textAnchor="middle" fill="#6C7A93" letterSpacing="0.1em">
              {labels.find}
            </text>
            <text x={688} y={258} fontSize={18} textAnchor="middle" fill="#F97316" fontWeight={600}>
              I = ?
            </text>
          </g>
        )}

        {/* Stage-3 numeric input — bottom of the schematic panel (BL side).
             Kept left of x=580 to preserve BR-quadrant reservation (§4.3). */}
        {isStage3 && !stage3Done && (
          <foreignObject x={70} y={368} width={490} height={44}>
            <div
              style={{
                display: 'flex',
                gap: 10,
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 11,
                color: '#B9C4D6',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
              }}
            >
              <span style={{ color: '#6C7A93', fontSize: 10, letterSpacing: '0.1em' }}>
                {labels.enter_I}
              </span>
              <input
                type="text"
                inputMode="decimal"
                value={stage3Input}
                onChange={(e) => setStage3Input(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onStage3Submit()
                }}
                disabled={stage3Feedback === 'correct' || stage3Feedback === 'deck-reset'}
                placeholder="0.00"
                style={{
                  width: 84,
                  height: 26,
                  background: '#131F35',
                  border: `1px solid ${
                    stage3Feedback === 'wrong'
                      ? '#EF4444'
                      : stage3Feedback === 'correct'
                        ? '#37C9B8'
                        : '#3A4863'
                  }`,
                  color: '#EAF0FA',
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 13,
                  borderRadius: 3,
                  textAlign: 'center',
                  outline: 'none',
                  padding: 0,
                }}
              />
              <span style={{ color: '#6C7A93', fontSize: 11 }}>A</span>
              <button
                onClick={onStage3Submit}
                disabled={
                  stage3Feedback === 'correct' ||
                  stage3Feedback === 'deck-reset' ||
                  !stage3Input.trim()
                }
                style={{
                  height: 26,
                  padding: '0 14px',
                  background: '#37C9B8',
                  color: '#0D1524',
                  border: 'none',
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 10,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  borderRadius: 3,
                  cursor: 'pointer',
                  fontWeight: 700,
                  opacity:
                    stage3Feedback === 'correct' ||
                    stage3Feedback === 'deck-reset' ||
                    !stage3Input.trim()
                      ? 0.5
                      : 1,
                }}
              >
                {labels.submit}
              </button>
              {stage3Feedback !== 'none' && (
                <span
                  style={{
                    fontSize: 10,
                    letterSpacing: '0.06em',
                    color:
                      stage3Feedback === 'correct'
                        ? '#37C9B8'
                        : stage3Feedback === 'wrong'
                          ? '#EF4444'
                          : '#F97316',
                  }}
                >
                  {stage3Feedback === 'correct' && labels.correct}
                  {stage3Feedback === 'wrong' &&
                    `${labels.wrong} · ${attemptsLeft} ${labels.attempts_left}`}
                  {stage3Feedback === 'deck-reset' && labels.deck_reset}
                </span>
              )}
            </div>
          </foreignObject>
        )}

        {isStage3 && stage3Done && (
          <foreignObject x={70} y={368} width={490} height={44}>
            <div
              style={{
                display: 'flex',
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 12,
                color: '#37C9B8',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
              }}
            >
              {labels.deck_complete}
            </div>
          </foreignObject>
        )}
      </svg>

      {/* HUD overlays — HTML in rem */}
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
          fontSize: '1.5rem',
          letterSpacing: '0.08em',
          color: canSubmit ? '#37C9B8' : '#B9C4D6',
          zIndex: 5,
          pointerEvents: 'none',
          textAlign: 'right',
          maxWidth: '38%',
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
          fontSize: '1.7rem',
          letterSpacing: '0.06em',
          color: peekText ? '#F9A968' : '#6C7A93',
          zIndex: 5,
          pointerEvents: 'none',
          maxWidth: '58%',
          lineHeight: 1.3,
        }}
      >
        {hudBL}
      </div>
      {/* BR is reserved for parent chrome (fullscreen). Do NOT add an overlay here. */}
    </div>
  )
}

// ─── HTML slider row (rendered inside <foreignObject>) ─────────────────
function SliderRow({
  label,
  unit,
  min,
  max,
  step,
  value,
  onChange,
  enabled = true,
  decimals = 0,
}: {
  label: string
  unit: string
  min: number
  max: number
  step: number
  value: number
  onChange: (v: number) => void
  enabled?: boolean
  decimals?: number
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, opacity: enabled ? 1 : 0.4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10 }}>
        <span>
          {label} <span style={{ color: '#6C7A93' }}>({unit})</span>
        </span>
        <span style={{ color: '#37C9B8' }}>{value.toFixed(decimals)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={!enabled}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{
          width: '100%',
          height: 14,
          accentColor: '#37C9B8',
        }}
      />
    </div>
  )
}

// ─── SVG component symbols ─────────────────────────────────────────────
function GeneratorSymbol({ cx, cy, E, r }: { cx: number; cy: number; E: number; r: number }) {
  return (
    <g transform={`translate(${cx}, ${cy})`}>
      <line x1={-42} y1={0} x2={-6} y2={0} stroke="#54617A" strokeWidth={2} />
      <line x1={6} y1={0} x2={42} y2={0} stroke="#54617A" strokeWidth={2} />
      <line x1={-6} y1={-14} x2={-6} y2={14} stroke="#B9C4D6" strokeWidth={2} />
      <line x1={6} y1={-9} x2={6} y2={9} stroke="#B9C4D6" strokeWidth={5} />
      <text
        x={-14}
        y={-18}
        fill="#F9A968"
        fontFamily="'JetBrains Mono', monospace"
        fontSize={10}
        textAnchor="middle"
        fontWeight={700}
      >
        +
      </text>
      <text
        x={14}
        y={-18}
        fill="#7EE3D8"
        fontFamily="'JetBrains Mono', monospace"
        fontSize={10}
        textAnchor="middle"
        fontWeight={700}
      >
        −
      </text>
      <text
        x={0}
        y={22}
        fill="#B9C4D6"
        fontFamily="'JetBrains Mono', monospace"
        fontSize={10}
        textAnchor="middle"
      >
        E = {fmt(E)} V
      </text>
      <text
        x={0}
        y={34}
        fill="#6C7A93"
        fontFamily="'JetBrains Mono', monospace"
        fontSize={9}
        textAnchor="middle"
      >
        r = {fmt(r)} Ω
      </text>
    </g>
  )
}

function ResistorSymbol({
  cx,
  cy,
  orient,
  label,
  value,
}: {
  cx: number
  cy: number
  orient: 'h' | 'v'
  label: string
  value: string
}) {
  const rot = orient === 'v' ? 90 : 0
  return (
    <g transform={`translate(${cx}, ${cy}) rotate(${rot})`}>
      <line x1={-32} y1={0} x2={-18} y2={0} stroke="#54617A" strokeWidth={2} />
      <line x1={18} y1={0} x2={32} y2={0} stroke="#54617A" strokeWidth={2} />
      <rect
        x={-18}
        y={-8}
        width={36}
        height={16}
        fill="#131F35"
        stroke="#54617A"
        strokeWidth={1.4}
        rx={2}
      />
      {/* Undo the rotation on the labels so they read left-to-right in both orientations */}
      <g transform={`rotate(${-rot})`}>
        <text
          x={0}
          y={-14}
          fill="#B9C4D6"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={11}
          textAnchor="middle"
          fontWeight={600}
        >
          {label}
        </text>
        <text
          x={0}
          y={26}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={10}
          textAnchor="middle"
        >
          {value}
        </text>
      </g>
    </g>
  )
}

function SwitchSymbol({
  cx,
  cy,
  closed,
  onClick,
}: {
  cx: number
  cy: number
  closed: boolean
  onClick?: (() => void) | undefined
}) {
  const bladeAngle = closed ? 0 : -30
  return (
    <g
      transform={`translate(${cx}, ${cy})`}
      style={{ cursor: onClick ? 'pointer' : 'default' }}
      onClick={onClick}
    >
      <rect x={-32} y={-18} width={64} height={36} fill="transparent" />
      <line x1={-32} y1={0} x2={-22} y2={0} stroke="#54617A" strokeWidth={2} />
      <line x1={22} y1={0} x2={32} y2={0} stroke="#54617A" strokeWidth={2} />
      <circle cx={-22} cy={0} r={2.4} fill="#B9C4D6" />
      <circle cx={22} cy={0} r={2.4} fill="#B9C4D6" />
      <line
        x1={-22}
        y1={0}
        x2={-22 + Math.cos((bladeAngle * Math.PI) / 180) * 44}
        y2={0 + Math.sin((bladeAngle * Math.PI) / 180) * 44}
        stroke={closed ? '#37C9B8' : '#B9C4D6'}
        strokeWidth={2}
      />
    </g>
  )
}

function AmmeterSymbol({
  cx,
  cy,
  reading,
}: {
  cx: number
  cy: number
  reading: number | null
}) {
  return (
    <g transform={`translate(${cx}, ${cy})`}>
      {/* Vertical stubs (left side of loop) */}
      <line x1={0} y1={-32} x2={0} y2={-13} stroke="#54617A" strokeWidth={2} />
      <line x1={0} y1={13} x2={0} y2={32} stroke="#54617A" strokeWidth={2} />
      <circle cx={0} cy={0} r={13} fill="#131F35" stroke="#54617A" strokeWidth={1.4} />
      <text
        x={0}
        y={4}
        fill="#B9C4D6"
        fontFamily="'JetBrains Mono', monospace"
        fontSize={11}
        textAnchor="middle"
        fontWeight={600}
      >
        A
      </text>
      {/* Reading — hidden on stage 3 (shows "?") */}
      <text
        x={-20}
        y={-4}
        textAnchor="end"
        fill={reading === null ? '#F97316' : reading > 0.01 ? '#37C9B8' : '#6C7A93'}
        fontFamily="'JetBrains Mono', monospace"
        fontSize={11}
      >
        {reading === null ? '? A' : fmtA(reading)}
      </text>
    </g>
  )
}
