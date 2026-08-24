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

// ─── Scene constants ────────────────────────────────────────────────
const W = 800
const H = 450

// Two schematic panels side-by-side; BR quadrant (x > 600 && y > 350) reserved.
const PANEL_TOP = 74
const PANEL_BOT = 258
const L_PANEL_L = 40
const L_PANEL_R = 388
const R_PANEL_L = 412
const R_PANEL_R = 760

// ─── i18n label loader ──────────────────────────────────────────────
const dict = { en } as const
type Locale = keyof typeof dict
type Labels = typeof dict.en.labels
function svgLabels(locale: string): Labels {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels as Labels
}

// ─── Physics solver (pure) ──────────────────────────────────────────
// Thévenin: U = E − r·I, and with a load R: I = E / (R + r), U = R·I.
// Norton: I₀ = E / r, G₀ = 1/r. External terminal behavior is identical.
//
// Test vectors:
//   solve(12, 2, 4)  → I = 2 A,  U = 8 V,  I₀ = 6 A
//   solve(9,  1, 2)  → I = 3 A,  U = 6 V,  I₀ = 9 A
//   solve(15, 5, 25) → I = 0.5 A, U = 12.5 V, I₀ = 3 A
function solve(E: number, r: number, R: number): { I: number; U: number; I0: number; G0: number } {
  const denom = R + r
  const I = denom > 0 ? E / denom : 0
  const U = R * I
  const I0 = r > 0 ? E / r : 0
  const G0 = r > 0 ? 1 / r : 0
  return { I, U, I0, G0 }
}

// ─── Stage-2 targets (hand-authored) ────────────────────────────────
// E=12 V, r=2 Ω fixed. Adjust R to hit each U.
//   U=6  V → R=2  Ω  (I=3 A)
//   U=8  V → R=4  Ω  (I=2 A)
//   U=10 V → R=10 Ω  (I=1 A)
const STAGE2_E = 12
const STAGE2_r = 2
const STAGE2_TARGETS: number[] = [6, 8, 10] // volts

// ─── Stage-3 black-box scenarios (hand-authored) ────────────────────
// Each scenario hides an (E, r) and exposes two operating points.
type BlackBox = {
  E: number
  r: number
  points: [{ R: number; I: number; U: number }, { R: number; I: number; U: number }]
}
// Verify each: r = (U1-U2)/(I2-I1),  E = U1 + r·I1.
//   A: (E=12, r=2): (R=4,I=2,U=8), (R=10,I=1,U=10) → r=2, E=12 ✓
//   B: (E=9,  r=1): (R=2,I=3,U=6), (R=8,I=1,U=8)   → r=1, E=9  ✓
//   C: (E=15, r=5): (R=5,I=1.5,U=7.5), (R=25,I=0.5,U=12.5) → r=5, E=15 ✓
const SCENARIOS: BlackBox[] = [
  { E: 12, r: 2, points: [{ R: 4, I: 2, U: 8 }, { R: 10, I: 1, U: 10 }] },
  { E: 9,  r: 1, points: [{ R: 2, I: 3, U: 6 }, { R: 8,  I: 1, U: 8  }] },
  { E: 15, r: 5, points: [{ R: 5, I: 1.5, U: 7.5 }, { R: 25, I: 0.5, U: 12.5 }] },
]
const STAGE3_TOL = 0.03 // ±3%
const STAGE3_ATTEMPTS = 3
const STAGE3_ACE_COUNT = 3

// ─── Slider bounds ──────────────────────────────────────────────────
const E_MIN = 3,  E_MAX = 18, E_STEP = 0.5, E_INIT = 12
const r_MIN = 0.5, r_MAX = 10, r_STEP = 0.5, r_INIT = 2
const R_MIN = 1,  R_MAX = 30, R_STEP = 0.5, R_INIT = 5

const TARGET_TOL = 0.05 // ±5% on U targets

// ─── Numeric fmt ────────────────────────────────────────────────────
function fmt(x: number, unit: string, digits = 2): string {
  const s = Number.isFinite(x) ? x.toFixed(digits) : '—'
  return `${s} ${unit}`
}

// ─── Component ──────────────────────────────────────────────────────
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

  // ─── Slider state ─────────────────────────────────────────────────
  const [E, setE] = useState<number>(E_INIT)
  const [r, setr] = useState<number>(r_INIT)
  const [R, setR] = useState<number>(R_INIT)

  // ─── Stage-1 coverage ─────────────────────────────────────────────
  const [seenE, setSeenE] = useState<Set<number>>(() => new Set([E_INIT]))
  const [seenr, setSeenr] = useState<Set<number>>(() => new Set([r_INIT]))
  const [seenR, setSeenR] = useState<Set<number>>(() => new Set([R_INIT]))

  useEffect(() => {
    if (isStage1) setSeenE((s) => (s.has(E) ? s : new Set(s).add(E)))
  }, [E, isStage1])
  useEffect(() => {
    if (isStage1) setSeenr((s) => (s.has(r) ? s : new Set(s).add(r)))
  }, [r, isStage1])
  useEffect(() => {
    if (isStage1) setSeenR((s) => (s.has(R) ? s : new Set(s).add(R)))
  }, [R, isStage1])

  const movedE = seenE.size >= 2
  const movedr = seenr.size >= 2
  const movedR = seenR.size >= 2

  // ─── Stage-2 target hits ──────────────────────────────────────────
  // Track which target U each has been achieved (within ±5%).
  const [stage2Hit, setStage2Hit] = useState<[boolean, boolean, boolean]>([false, false, false])

  // Effective (E, r) values used by the schematics — locked in stage 2.
  const displayE = isStage2 ? STAGE2_E : E
  const displayr = isStage2 ? STAGE2_r : r

  const s = solve(displayE, displayr, R)

  useEffect(() => {
    if (!isStage2) return
    setStage2Hit((prev) => {
      const next: [boolean, boolean, boolean] = [prev[0], prev[1], prev[2]]
      for (let i = 0; i < 3; i++) {
        const target = STAGE2_TARGETS[i]!
        if (!next[i] && target > 0 && Math.abs(s.U - target) / target <= TARGET_TOL) {
          next[i] = true
        }
      }
      return (next[0] === prev[0] && next[1] === prev[1] && next[2] === prev[2]) ? prev : next
    })
  }, [isStage2, s.U])

  const stage2Done = stage2Hit.every(Boolean)

  // ─── Stage-3 black-box state ──────────────────────────────────────
  const initialScenarioIdx = seed % SCENARIOS.length
  const [scenarioIdx, setScenarioIdx] = useState<number>(initialScenarioIdx)
  const [inputE, setInputE] = useState<string>('')
  const [inputr, setInputr] = useState<string>('')
  const [attemptsLeft, setAttemptsLeft] = useState<number>(STAGE3_ATTEMPTS)
  const [solvedCount, setSolvedCount] = useState<number>(0)
  const [lastVerdict, setLastVerdict] = useState<null | 'correct' | 'wrong'>(null)

  const scenario = SCENARIOS[scenarioIdx]!

  const stage3Done = solvedCount >= STAGE3_ACE_COUNT

  // ─── Advance ──────────────────────────────────────────────────────
  const stage1Done = movedE && movedr && movedR
  const canSubmit = isStage1 ? stage1Done : isStage2 ? stage2Done : stage3Done

  // ─── Reset ────────────────────────────────────────────────────────
  const resetStageState = useCallback(() => {
    setE(E_INIT); setr(r_INIT); setR(R_INIT)
    setSeenE(new Set([E_INIT]))
    setSeenr(new Set([r_INIT]))
    setSeenR(new Set([R_INIT]))
    setStage2Hit([false, false, false])
    setScenarioIdx(initialScenarioIdx)
    setInputE(''); setInputr('')
    setAttemptsLeft(STAGE3_ATTEMPTS)
    setSolvedCount(0)
    setLastVerdict(null)
  }, [initialScenarioIdx])
  useReset(resetStageState)

  useEffect(() => {
    progress(stageIdx / stages.length, { stage: stageIdx, canSubmit })
  }, [stageIdx, canSubmit, stages.length, progress])

  useNext(() => {
    if (stageIdx < stages.length) {
      setStage(stageIdx + 1)
      resetStageState()
    } else {
      complete({ success: true })
    }
  })

  // ─── Peek (strategy hint only — text overlay, never numeric answer) ─
  const [peekText, setPeekText] = useState<string | null>(null)
  usePeek(() => {
    if (!isStage3) return
    setPeekText(labels.peek_tip ?? null)
  })
  useEffect(() => {
    if (!peekText) return
    const t = setTimeout(() => setPeekText(null), 5000)
    return () => clearTimeout(t)
  }, [peekText])

  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  // ─── Stage-3 submit ───────────────────────────────────────────────
  const advanceScenario = useCallback((keepStreak: boolean) => {
    setScenarioIdx((idx) => (idx + 1) % SCENARIOS.length)
    setAttemptsLeft(STAGE3_ATTEMPTS)
    setInputE(''); setInputr('')
    if (!keepStreak) setSolvedCount(0)
  }, [])

  const submitStage3 = useCallback(() => {
    const eNum = parseFloat(inputE.replace(',', '.'))
    const rNum = parseFloat(inputr.replace(',', '.'))
    if (!Number.isFinite(eNum) || !Number.isFinite(rNum)) return
    const eOK = Math.abs(eNum - scenario.E) / scenario.E <= STAGE3_TOL
    const rOK = Math.abs(rNum - scenario.r) / scenario.r <= STAGE3_TOL
    if (eOK && rOK) {
      setLastVerdict('correct')
      const nextCount = solvedCount + 1
      setSolvedCount(nextCount)
      if (nextCount < STAGE3_ACE_COUNT) {
        // brief feedback, then rotate to next scenario keeping streak
        setTimeout(() => {
          setLastVerdict(null)
          advanceScenario(true)
        }, 900)
      }
    } else {
      setLastVerdict('wrong')
      setAttemptsLeft((n) => {
        const next = n - 1
        if (next <= 0) {
          setTimeout(() => {
            setLastVerdict(null)
            advanceScenario(false) // streak broken
          }, 900)
        } else {
          setTimeout(() => setLastVerdict(null), 700)
        }
        return next
      })
    }
  }, [inputE, inputr, scenario, solvedCount, advanceScenario])

  // ─── HUD text ─────────────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`

  const covMark = (ok: boolean, txt: string) => `${ok ? '✓' : '·'} ${txt}`
  const hudTR =
    isStage1
      ? `${covMark(movedE, labels.cov_e)}   ${covMark(movedr, labels.cov_r)}   ${covMark(movedR, labels.cov_R)}`
      : isStage2
        ? `${labels.targets}: ${stage2Hit.filter(Boolean).length}/3`
        : `${labels.scenario} ${scenarioIdx + 1} · ${labels.scenarios_solved} ${solvedCount}/${STAGE3_ACE_COUNT} · ${labels.attempts_left} ${attemptsLeft}`

  const hudBL = isStage3
    ? (peekText ?? labels.tip3)
    : isStage2
      ? labels.tip2
      : labels.tip1

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block', userSelect: 'none' }}
      >
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        {(isStage1 || isStage2) && (
          <>
            {/* Thévenin panel */}
            <PanelFrame x={L_PANEL_L} y={PANEL_TOP} w={L_PANEL_R - L_PANEL_L} h={PANEL_BOT - PANEL_TOP} title={labels.thevenin} />
            <TheveninSchematic
              x={L_PANEL_L} y={PANEL_TOP}
              E={displayE} r={displayr} R={R} U={s.U} I={s.I}
              labels={labels}
            />

            {/* Norton panel */}
            <PanelFrame x={R_PANEL_L} y={PANEL_TOP} w={R_PANEL_R - R_PANEL_L} h={PANEL_BOT - PANEL_TOP} title={labels.norton} />
            <NortonSchematic
              x={R_PANEL_L} y={PANEL_TOP}
              I0={s.I0} G0={s.G0} r={displayr} R={R} U={s.U} I={s.I}
              labels={labels}
            />
          </>
        )}

        {isStage3 && (
          <>
            {/* Black-box panel — single centered schematic */}
            <PanelFrame x={100} y={PANEL_TOP} w={600} h={PANEL_BOT - PANEL_TOP} title={labels.black_box} />
            <BlackBoxSchematic
              x={100} y={PANEL_TOP}
              labels={labels}
              points={scenario.points}
              verdict={lastVerdict}
            />
          </>
        )}
      </svg>

      {/* ─── HTML overlays ────────────────────────────────────────── */}
      <div style={hudTLStyle}>{hudTL}</div>
      <div style={hudTRStyle(canSubmit)}>{hudTR}</div>
      <div style={hudBLStyle}>{hudBL}</div>

      {/* Controls strip — bottom-center. Never touches BR quadrant. */}
      {(isStage1 || isStage2) && (
        <div style={controlsStripStyle}>
          <SliderControl
            label={labels.slider_E} value={E} onChange={setE}
            min={E_MIN} max={E_MAX} step={E_STEP} unit={labels.unit_v}
            disabled={isStage2}
          />
          <SliderControl
            label={labels.slider_r} value={r} onChange={setr}
            min={r_MIN} max={r_MAX} step={r_STEP} unit={labels.unit_ohm}
            disabled={isStage2}
          />
          <SliderControl
            label={labels.slider_R} value={R} onChange={setR}
            min={R_MIN} max={R_MAX} step={R_STEP} unit={labels.unit_ohm}
            disabled={false}
          />
        </div>
      )}

      {isStage2 && (
        <div style={targetsStripStyle}>
          {STAGE2_TARGETS.map((tv, i) => (
            <div key={i} style={targetChipStyle(stage2Hit[i]!)}>
              <span style={{ opacity: 0.7 }}>{labels.target_prompt} </span>
              <strong>{fmt(tv, labels.unit_v, 1)}</strong>
              {stage2Hit[i] && <span style={{ marginLeft: '0.8rem', color: '#37C9B8' }}>✓</span>}
            </div>
          ))}
        </div>
      )}

      {isStage3 && (
        <div style={stage3StripStyle}>
          <NumericInput label={labels.input_E} unit={labels.unit_v} value={inputE} onChange={setInputE} disabled={lastVerdict === 'correct'} />
          <NumericInput label={labels.input_r} unit={labels.unit_ohm} value={inputr} onChange={setInputr} disabled={lastVerdict === 'correct'} />
          <button
            onClick={submitStage3}
            disabled={inputE.trim() === '' || inputr.trim() === '' || lastVerdict === 'correct'}
            style={submitBtnStyle(inputE.trim() !== '' && inputr.trim() !== '' && lastVerdict !== 'correct')}
          >
            {labels.submit}
          </button>
          {lastVerdict === 'correct' && (
            <div style={{ ...verdictStyle, color: '#37C9B8', borderColor: '#37C9B8' }}>{labels.correct}</div>
          )}
          {lastVerdict === 'wrong' && (
            <div style={{ ...verdictStyle, color: '#EF4444', borderColor: '#EF4444' }}>{labels.wrong}</div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── HUD styles ─────────────────────────────────────────────────────
const hudTLStyle: React.CSSProperties = {
  position: 'absolute', top: '3rem', left: '3rem',
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: '2.3rem', letterSpacing: '0.14em', textTransform: 'uppercase',
  color: '#6C7A93', zIndex: 5, pointerEvents: 'none',
}
const hudTRStyle = (canSubmit: boolean): React.CSSProperties => ({
  position: 'absolute', top: '3rem', right: '3rem',
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: '1.6rem', letterSpacing: '0.08em',
  color: canSubmit ? '#37C9B8' : '#B9C4D6',
  zIndex: 5, pointerEvents: 'none', textAlign: 'right',
})
const hudBLStyle: React.CSSProperties = {
  position: 'absolute', bottom: '3rem', left: '3rem',
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: '1.6rem', letterSpacing: '0.06em',
  color: '#6C7A93', zIndex: 5, pointerEvents: 'none', maxWidth: '48%',
}

// Bottom-center controls strip.
// Explicitly avoids BR by using left+transform and constraining max width.
const controlsStripStyle: React.CSSProperties = {
  position: 'absolute',
  left: '50%',
  transform: 'translateX(-50%)',
  bottom: '10rem',
  display: 'flex',
  gap: '3rem',
  padding: '1.4rem 2.4rem',
  background: 'rgba(19,31,53,0.85)',
  border: '1px solid #3A4863',
  borderRadius: '0.8rem',
  zIndex: 5,
  fontFamily: "'JetBrains Mono', monospace",
  color: '#B9C4D6',
  maxWidth: '78%',
}

const targetsStripStyle: React.CSSProperties = {
  position: 'absolute',
  left: '50%',
  transform: 'translateX(-50%)',
  bottom: '22rem',
  display: 'flex',
  gap: '1.4rem',
  zIndex: 5,
  fontFamily: "'JetBrains Mono', monospace",
  color: '#B9C4D6',
}

const targetChipStyle = (hit: boolean): React.CSSProperties => ({
  padding: '0.7rem 1.4rem',
  background: hit ? 'rgba(55,201,184,0.12)' : 'rgba(19,31,53,0.85)',
  border: `1px solid ${hit ? '#37C9B8' : '#3A4863'}`,
  borderRadius: '0.6rem',
  fontSize: '1.6rem',
  letterSpacing: '0.04em',
})

const stage3StripStyle: React.CSSProperties = {
  position: 'absolute',
  left: '50%',
  transform: 'translateX(-50%)',
  bottom: '9rem',
  display: 'flex',
  gap: '1.6rem',
  padding: '1.4rem 2.2rem',
  background: 'rgba(19,31,53,0.9)',
  border: '1px solid #3A4863',
  borderRadius: '0.8rem',
  zIndex: 5,
  fontFamily: "'JetBrains Mono', monospace",
  color: '#B9C4D6',
  alignItems: 'center',
  maxWidth: '78%',
}

const submitBtnStyle = (enabled: boolean): React.CSSProperties => ({
  padding: '0.9rem 2rem',
  background: enabled ? '#F97316' : '#2A3345',
  color: enabled ? '#0D1524' : '#54617A',
  border: 'none',
  borderRadius: '0.5rem',
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: '1.4rem',
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  fontWeight: 700,
  cursor: enabled ? 'pointer' : 'not-allowed',
})

const verdictStyle: React.CSSProperties = {
  padding: '0.6rem 1.2rem',
  border: '1px solid',
  borderRadius: '0.5rem',
  fontSize: '1.4rem',
  letterSpacing: '0.14em',
  fontWeight: 700,
}

// ─── Slider control ─────────────────────────────────────────────────
function SliderControl({
  label, value, onChange, min, max, step, unit, disabled,
}: {
  label: string
  value: number
  onChange: (n: number) => void
  min: number
  max: number
  step: number
  unit: string
  disabled: boolean
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minWidth: '14rem' }}>
      <div style={{ fontSize: '1.3rem', letterSpacing: '0.1em', color: '#6C7A93', display: 'flex', justifyContent: 'space-between' }}>
        <span>{label}</span>
        <span style={{ color: disabled ? '#54617A' : '#B9C4D6' }}>{fmt(value, unit, 1)}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.currentTarget.value))}
        disabled={disabled}
        style={{
          width: '100%', marginTop: '0.4rem',
          accentColor: disabled ? '#54617A' : '#F97316',
          opacity: disabled ? 0.55 : 1,
        }}
      />
    </div>
  )
}

// ─── Numeric input (stage 3) ────────────────────────────────────────
function NumericInput({
  label, unit, value, onChange, disabled,
}: {
  label: string
  unit: string
  value: string
  onChange: (v: string) => void
  disabled: boolean
}) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '1.5rem' }}>
      <span style={{ color: '#6C7A93' }}>{label}</span>
      <input
        type="number" inputMode="decimal" step="0.1"
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        disabled={disabled}
        style={{
          width: '6rem',
          padding: '0.4rem 0.6rem',
          background: '#0D1524',
          border: '1px solid #3A4863',
          borderRadius: '0.4rem',
          color: '#EAF0FA',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '1.6rem',
          textAlign: 'right',
          outline: 'none',
        }}
      />
      <span style={{ color: '#6C7A93' }}>{unit}</span>
    </label>
  )
}

// ─── SVG art ────────────────────────────────────────────────────────

function PanelFrame({ x, y, w, h, title }: { x: number; y: number; w: number; h: number; title: string }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} fill="none" stroke="#12203a" strokeWidth={1} rx={6} />
      <text
        x={x + 8} y={y - 8}
        fill="#6C7A93"
        fontFamily="'JetBrains Mono', monospace"
        fontSize={11}
        letterSpacing="0.14em"
      >
        {title}
      </text>
    </g>
  )
}

/**
 * Thévenin: closed loop with (E — r) inside a dashed source box,
 * external terminals a/b, load R on the right vertical branch.
 * Ammeter symbol on top wire, voltmeter across R.
 */
function TheveninSchematic({
  x, y, E, r, R, U, I, labels,
}: {
  x: number; y: number
  E: number; r: number; R: number; U: number; I: number
  labels: Labels
}) {
  // Local rectangle within the panel — panel is 348 wide, 184 tall.
  const cx = x + 30
  const cy = y + 40
  // Loop corners in local terms
  const topY = cy + 20
  const botY = cy + 130
  const leftX = cx + 10
  const rightX = cx + 260
  const termX = cx + 200 // external terminals split at this x
  return (
    <g>
      {/* Dashed box: internal source */}
      <rect
        x={leftX - 6} y={topY - 30} width={termX - leftX + 12} height={botY - topY + 40}
        fill="none" stroke="#54617A" strokeWidth={1} strokeDasharray="4 4" rx={4}
      />
      <text x={leftX - 4} y={topY - 34} fill="#54617A" fontSize={9} fontFamily="'JetBrains Mono', monospace">
        {labels.src_int}
      </text>

      {/* Loop wires */}
      <line x1={leftX} y1={topY} x2={termX} y2={topY} stroke="#3A4863" strokeWidth={2} />
      <line x1={termX} y1={topY} x2={rightX} y2={topY} stroke="#3A4863" strokeWidth={2} />
      <line x1={rightX} y1={topY} x2={rightX} y2={botY} stroke="#3A4863" strokeWidth={2} />
      <line x1={rightX} y1={botY} x2={leftX} y2={botY} stroke="#3A4863" strokeWidth={2} />
      <line x1={leftX} y1={botY} x2={leftX} y2={topY} stroke="#3A4863" strokeWidth={2} />

      {/* Battery (E) on top-left */}
      <g transform={`translate(${leftX + 42}, ${topY})`}>
        <BatterySymbol />
        <text x={0} y={22} fill="#B9C4D6" fontSize={10} fontFamily="'JetBrains Mono', monospace" textAnchor="middle">
          E = {E.toFixed(1)} {labels.unit_v}
        </text>
      </g>

      {/* Internal r resistor on top-center */}
      <g transform={`translate(${leftX + 130}, ${topY})`}>
        <ResistorSymbol />
        <text x={0} y={-16} fill="#B9C4D6" fontSize={10} fontFamily="'JetBrains Mono', monospace" textAnchor="middle">
          r = {r.toFixed(1)} {labels.unit_ohm}
        </text>
      </g>

      {/* Terminal markers a, b */}
      <circle cx={termX} cy={topY} r={3} fill="#B9C4D6" />
      <circle cx={termX} cy={botY} r={3} fill="#B9C4D6" />
      <text x={termX + 6} y={topY - 4} fill="#7EE3D8" fontSize={10} fontFamily="'JetBrains Mono', monospace">a</text>
      <text x={termX + 6} y={botY + 12} fill="#7EE3D8" fontSize={10} fontFamily="'JetBrains Mono', monospace">b</text>

      {/* Ammeter on wire between terminal a and R */}
      <g transform={`translate(${termX + 30}, ${topY})`}>
        <AmmeterSymbol reading={fmt(I, labels.unit_a, 2)} />
      </g>

      {/* Load R on right vertical branch */}
      <g transform={`translate(${rightX}, ${(topY + botY) / 2}) rotate(90)`}>
        <ResistorSymbol />
      </g>
      <text x={rightX + 14} y={(topY + botY) / 2 - 2} fill="#B9C4D6" fontSize={10} fontFamily="'JetBrains Mono', monospace">
        R = {R.toFixed(1)} {labels.unit_ohm}
      </text>
      <text x={rightX + 14} y={(topY + botY) / 2 + 12} fill="#37C9B8" fontSize={10} fontFamily="'JetBrains Mono', monospace">
        {labels.readout_U} = {fmt(U, labels.unit_v, 2)}
      </text>
    </g>
  )
}

/**
 * Norton: current source (I0) in parallel with r, in parallel with R,
 * between nodes a (top) and b (bottom).
 */
function NortonSchematic({
  x, y, I0, G0, r, R, U, I, labels,
}: {
  x: number; y: number
  I0: number; G0: number; r: number; R: number; U: number; I: number
  labels: Labels
}) {
  const cx = x + 30
  const cy = y + 40
  const topY = cy + 20
  const botY = cy + 130
  const leftX = cx + 10
  const rightX = cx + 260
  const srcX = leftX + 42
  const rX = leftX + 130
  const rBoxRight = rX + 40
  return (
    <g>
      {/* Dashed box: internal source (current source + r) */}
      <rect
        x={leftX - 6} y={topY - 30} width={rBoxRight - leftX + 6} height={botY - topY + 40}
        fill="none" stroke="#54617A" strokeWidth={1} strokeDasharray="4 4" rx={4}
      />
      <text x={leftX - 4} y={topY - 34} fill="#54617A" fontSize={9} fontFamily="'JetBrains Mono', monospace">
        {labels.src_int}
      </text>

      {/* Top rail (a) and bottom rail (b) */}
      <line x1={leftX} y1={topY} x2={rightX} y2={topY} stroke="#3A4863" strokeWidth={2} />
      <line x1={leftX} y1={botY} x2={rightX} y2={botY} stroke="#3A4863" strokeWidth={2} />
      <line x1={rightX} y1={topY} x2={rightX} y2={botY} stroke="#3A4863" strokeWidth={2} />

      {/* Current source branch (vertical) */}
      <line x1={srcX} y1={topY} x2={srcX} y2={topY + 20} stroke="#3A4863" strokeWidth={2} />
      <line x1={srcX} y1={botY - 20} x2={srcX} y2={botY} stroke="#3A4863" strokeWidth={2} />
      <g transform={`translate(${srcX}, ${(topY + botY) / 2})`}>
        <CurrentSourceSymbol />
      </g>
      <text x={srcX + 20} y={(topY + botY) / 2 - 2} fill="#B9C4D6" fontSize={10} fontFamily="'JetBrains Mono', monospace">
        I₀ = {I0.toFixed(2)} {labels.unit_a}
      </text>

      {/* Internal r branch (vertical) */}
      <line x1={rX} y1={topY} x2={rX} y2={topY + 20} stroke="#3A4863" strokeWidth={2} />
      <line x1={rX} y1={botY - 20} x2={rX} y2={botY} stroke="#3A4863" strokeWidth={2} />
      <g transform={`translate(${rX}, ${(topY + botY) / 2}) rotate(90)`}>
        <ResistorSymbol />
      </g>
      <text x={rX + 20} y={(topY + botY) / 2 - 2} fill="#B9C4D6" fontSize={10} fontFamily="'JetBrains Mono', monospace">
        r = {r.toFixed(1)} {labels.unit_ohm}
      </text>
      <text x={rX + 20} y={(topY + botY) / 2 + 12} fill="#7EE3D8" fontSize={10} fontFamily="'JetBrains Mono', monospace">
        G₀ = {G0.toFixed(3)} {labels.unit_s}
      </text>

      {/* Terminal markers a, b */}
      <circle cx={rBoxRight + 20} cy={topY} r={3} fill="#B9C4D6" />
      <circle cx={rBoxRight + 20} cy={botY} r={3} fill="#B9C4D6" />
      <text x={rBoxRight + 22} y={topY - 4} fill="#7EE3D8" fontSize={10} fontFamily="'JetBrains Mono', monospace">a</text>
      <text x={rBoxRight + 22} y={botY + 12} fill="#7EE3D8" fontSize={10} fontFamily="'JetBrains Mono', monospace">b</text>

      {/* External load R (right branch) */}
      <g transform={`translate(${rightX - 4}, ${(topY + botY) / 2}) rotate(90)`}>
        <ResistorSymbol />
      </g>
      <text x={rightX + 14} y={(topY + botY) / 2 - 2} fill="#B9C4D6" fontSize={10} fontFamily="'JetBrains Mono', monospace">
        R = {R.toFixed(1)} {labels.unit_ohm}
      </text>
      <text x={rightX + 14} y={(topY + botY) / 2 + 12} fill="#37C9B8" fontSize={10} fontFamily="'JetBrains Mono', monospace">
        {labels.readout_U} = {fmt(U, labels.unit_v, 2)}
      </text>
      <text x={rightX + 14} y={(topY + botY) / 2 + 26} fill="#37C9B8" fontSize={10} fontFamily="'JetBrains Mono', monospace">
        {labels.readout_I} = {fmt(I, labels.unit_a, 2)}
      </text>
    </g>
  )
}

/**
 * Black-box schematic (stage 3). A sealed rectangle labeled "?"
 * with two terminals a/b, connected to a load R. Below, a small
 * table shows the two operating points.
 */
function BlackBoxSchematic({
  x, y, labels, points, verdict,
}: {
  x: number; y: number
  labels: Labels
  points: BlackBox['points']
  verdict: null | 'correct' | 'wrong'
}) {
  const midY = y + 60
  const boxL = x + 60
  const boxR = x + 260
  const boxT = midY - 32
  const boxB = midY + 32
  const termX = boxR + 30
  const rightX = boxR + 130

  const borderColor = verdict === 'correct' ? '#37C9B8' : verdict === 'wrong' ? '#EF4444' : '#54617A'

  return (
    <g>
      {/* Black-box body */}
      <rect
        x={boxL} y={boxT} width={boxR - boxL} height={boxB - boxT}
        fill="#131F35" stroke={borderColor} strokeWidth={1.5} rx={4}
      />
      <text
        x={(boxL + boxR) / 2} y={midY + 8}
        fill="#B9C4D6"
        fontSize={22} fontFamily="'JetBrains Mono', monospace"
        textAnchor="middle" letterSpacing="0.2em"
      >
        {labels.unknown} E, r {labels.unknown}
      </text>

      {/* Terminal wires from box to terminals a, b */}
      <line x1={boxR} y1={boxT + 12} x2={termX} y2={boxT + 12} stroke="#3A4863" strokeWidth={2} />
      <line x1={boxR} y1={boxB - 12} x2={termX} y2={boxB - 12} stroke="#3A4863" strokeWidth={2} />
      <circle cx={termX} cy={boxT + 12} r={3} fill="#B9C4D6" />
      <circle cx={termX} cy={boxB - 12} r={3} fill="#B9C4D6" />
      <text x={termX + 6} y={boxT + 10} fill="#7EE3D8" fontSize={10} fontFamily="'JetBrains Mono', monospace">a</text>
      <text x={termX + 6} y={boxB - 4} fill="#7EE3D8" fontSize={10} fontFamily="'JetBrains Mono', monospace">b</text>

      {/* External load R on the right (variable to sweep) */}
      <line x1={termX} y1={boxT + 12} x2={rightX} y2={boxT + 12} stroke="#3A4863" strokeWidth={2} />
      <line x1={termX} y1={boxB - 12} x2={rightX} y2={boxB - 12} stroke="#3A4863" strokeWidth={2} />
      <line x1={rightX} y1={boxT + 12} x2={rightX} y2={boxB - 12} stroke="#3A4863" strokeWidth={2} />
      <g transform={`translate(${rightX}, ${midY}) rotate(90)`}>
        <ResistorSymbol />
      </g>
      <text x={rightX + 14} y={midY - 2} fill="#B9C4D6" fontSize={10} fontFamily="'JetBrains Mono', monospace">
        R
      </text>

      {/* Operating point table below the schematic */}
      <g transform={`translate(${x + 60}, ${midY + 80})`}>
        <text x={0} y={-6} fill="#6C7A93" fontSize={11} fontFamily="'JetBrains Mono', monospace" letterSpacing="0.12em">
          {labels.op_point} · {labels.given}
        </text>
        {/* Header */}
        <text x={0}   y={12} fill="#6C7A93" fontSize={12} fontFamily="'JetBrains Mono', monospace">#</text>
        <text x={60}  y={12} fill="#6C7A93" fontSize={12} fontFamily="'JetBrains Mono', monospace">R ({labels.unit_ohm})</text>
        <text x={200} y={12} fill="#6C7A93" fontSize={12} fontFamily="'JetBrains Mono', monospace">I ({labels.unit_a})</text>
        <text x={340} y={12} fill="#6C7A93" fontSize={12} fontFamily="'JetBrains Mono', monospace">U ({labels.unit_v})</text>
        {points.map((p, i) => (
          <g key={i} transform={`translate(0, ${34 + i * 22})`}>
            <text x={0}   y={0} fill="#EAF0FA" fontSize={14} fontFamily="'JetBrains Mono', monospace">{i + 1}</text>
            <text x={60}  y={0} fill="#EAF0FA" fontSize={14} fontFamily="'JetBrains Mono', monospace">{p.R.toFixed(1)}</text>
            <text x={200} y={0} fill="#EAF0FA" fontSize={14} fontFamily="'JetBrains Mono', monospace">{p.I.toFixed(2)}</text>
            <text x={340} y={0} fill="#EAF0FA" fontSize={14} fontFamily="'JetBrains Mono', monospace">{p.U.toFixed(2)}</text>
          </g>
        ))}
      </g>
    </g>
  )
}

// ─── Symbol library ─────────────────────────────────────────────────

function BatterySymbol() {
  return (
    <g>
      <line x1={-32} y1={0} x2={-4} y2={0} stroke="#54617A" strokeWidth={2} />
      <line x1={4} y1={0} x2={32} y2={0} stroke="#54617A" strokeWidth={2} />
      <line x1={-4} y1={-14} x2={-4} y2={14} stroke="#B9C4D6" strokeWidth={2} />
      <line x1={4} y1={-9} x2={4} y2={9} stroke="#B9C4D6" strokeWidth={5} />
      <text x={-12} y={-18} fill="#F9A968" fontFamily="'JetBrains Mono', monospace" fontSize={10} textAnchor="middle" fontWeight={700}>+</text>
      <text x={12} y={-18} fill="#7EE3D8" fontFamily="'JetBrains Mono', monospace" fontSize={10} textAnchor="middle" fontWeight={700}>−</text>
    </g>
  )
}

function ResistorSymbol() {
  return (
    <g>
      <line x1={-32} y1={0} x2={-18} y2={0} stroke="#54617A" strokeWidth={2} />
      <line x1={18} y1={0} x2={32} y2={0} stroke="#54617A" strokeWidth={2} />
      <rect x={-18} y={-8} width={36} height={16} fill="#131F35" stroke="#54617A" strokeWidth={1.5} rx={2} />
    </g>
  )
}

function AmmeterSymbol({ reading }: { reading: string }) {
  return (
    <g>
      <line x1={-32} y1={0} x2={-13} y2={0} stroke="#54617A" strokeWidth={2} />
      <line x1={13} y1={0} x2={32} y2={0} stroke="#54617A" strokeWidth={2} />
      <circle cx={0} cy={0} r={13} fill="#131F35" stroke="#54617A" strokeWidth={1.5} />
      <text x={0} y={4} fill="#B9C4D6" fontSize={11} fontFamily="'JetBrains Mono', monospace" textAnchor="middle">A</text>
      <text x={0} y={-18} fill="#37C9B8" fontSize={10} fontFamily="'JetBrains Mono', monospace" textAnchor="middle">
        {reading}
      </text>
    </g>
  )
}

function CurrentSourceSymbol() {
  // Circle with a downward arrow: current source pointing from + rail down to − rail.
  return (
    <g>
      <line x1={0} y1={-32} x2={0} y2={-13} stroke="#54617A" strokeWidth={2} />
      <line x1={0} y1={13} x2={0} y2={32} stroke="#54617A" strokeWidth={2} />
      <circle cx={0} cy={0} r={13} fill="#131F35" stroke="#54617A" strokeWidth={1.5} />
      {/* Arrow pointing down (conventional current direction) */}
      <line x1={0} y1={-8} x2={0} y2={7} stroke="#F97316" strokeWidth={1.6} />
      <polygon points="-3,4 3,4 0,10" fill="#F97316" />
    </g>
  )
}
