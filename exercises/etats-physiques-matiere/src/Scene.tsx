import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  useComplete,
  useCurrentStage,
  useDeclareStages,
  useHint,
  useInit,
  useNext,
  useProgress,
  useReset,
  useSeed,
  useSetStage,
  useTicker,
} from '@physics/sdk/react'
import { getHintFor, getStagesFor } from './stages'
import en from '../i18n/en.json'

// ─── Canvas ─────────────────────────────────────────────────────────────
const W = 800
const H = 450

// ─── Physics model ──────────────────────────────────────────────────────
type PhaseState = 'solid' | 'fusion' | 'liquid' | 'vap' | 'vapor'
type InitialState = 'solid' | 'liquid' | 'vapor'

// Water in "pedagogical energy units" — matches the reference-exercise
// engine so plateau widths stay visually distinct at m = 1.
const WATER = {
  T_start: -20, T_f: 0, T_v: 100, T_end: 130,
  c_s: 2, c_l: 4, c_v: 2,
  L_f: 80, L_v: 200,
  mass: 1,
} as const

type Curve = {
  qEnd: number
  segments: { state: PhaseState; q0: number; q1: number; T0: number; T1: number }[]
}

function computeCurve(): Curve {
  const m = WATER.mass
  const q1 = m * WATER.c_s * (WATER.T_f - WATER.T_start)
  const q2 = q1 + m * WATER.L_f
  const q3 = q2 + m * WATER.c_l * (WATER.T_v - WATER.T_f)
  const q4 = q3 + m * WATER.L_v
  const qEnd = q4 + m * WATER.c_v * (WATER.T_end - WATER.T_v)
  return {
    qEnd,
    segments: [
      { state: 'solid',  q0: 0,  q1,    T0: WATER.T_start, T1: WATER.T_f },
      { state: 'fusion', q0: q1, q1: q2, T0: WATER.T_f, T1: WATER.T_f },
      { state: 'liquid', q0: q2, q1: q3, T0: WATER.T_f, T1: WATER.T_v },
      { state: 'vap',    q0: q3, q1: q4, T0: WATER.T_v, T1: WATER.T_v },
      { state: 'vapor',  q0: q4, q1: qEnd, T0: WATER.T_v, T1: WATER.T_end },
    ],
  }
}

function stateAt(curve: Curve, Q: number): { T: number; state: PhaseState } {
  const clamped = Math.max(0, Math.min(Q, curve.qEnd))
  const seg = curve.segments.find((s) => clamped <= s.q1)
    ?? curve.segments[curve.segments.length - 1]!
  const span = seg.q1 - seg.q0
  const frac = span > 0 ? (clamped - seg.q0) / span : 1
  const T = seg.T0 + frac * (seg.T1 - seg.T0)
  return { T, state: seg.state }
}

// Initial-state Q seeds — segment midpoints for a stable start position.
function initialQ(curve: Curve, s: InitialState): number {
  switch (s) {
    case 'solid':  return 0
    case 'liquid': return (curve.segments[2]!.q0 + curve.segments[2]!.q1) / 2
    case 'vapor':  return (curve.segments[4]!.q0 + curve.segments[4]!.q1) / 2
  }
}

// ─── Constants ──────────────────────────────────────────────────────────
const HEAT_RATE_MAX = 90            // Q units / s at 100% power slider
const T_DEADBAND = 0.35             // °C — |T_target - currentT| below this = idle
const SETPOINT_MIN = -20
const SETPOINT_MAX = 130

// Stage 2 target: reach liquid @ 40°C starting from solid.
const STAGE2_TARGET = {
  initial: 'solid' as InitialState,
  T: 40,
  state: 'liquid' as PhaseState,
  T_tolerance: 2,                   // °C
}

// Layout — mirrors the reference for HUD/panel proportions.
const MOL_X = 40, MOL_Y = 60, MOL_W = 190, MOL_H = 320
const PLOT_X0 = 258, PLOT_Y0 = 60, PLOT_W = 302, PLOT_H = 320
const PLOT_X1 = PLOT_X0 + PLOT_W
const PLOT_Y1 = PLOT_Y0 + PLOT_H

// ─── i18n ──────────────────────────────────────────────────────────────
const dict = { en } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels as Record<string, string>
}

// ─── Component ──────────────────────────────────────────────────────────
export default function Scene() {
  const { locale } = useInit()
  const stages = useMemo(() => getStagesFor(locale), [locale])
  useDeclareStages(stages)
  const labels = useMemo(() => svgLabels(locale), [locale])
  const L = useCallback((k: string) => labels[k] ?? k, [labels])
  const rootRng = useSeed()

  const stageIdx = useCurrentStage()
  const isObserve    = stageIdx === 1
  const isExperiment = stageIdx === 2
  const isEvaluate   = stageIdx === 3

  // ─── Sim state ────────────────────────────────────────────────
  const curve = useMemo(() => computeCurve(), [])
  const [Tsetpoint, setTsetpoint] = useState<number>(20)
  const [power, setPower] = useState<number>(50)          // 0..100 slider
  const [initial, setInitial] = useState<InitialState>('solid')
  const [Q, setQ] = useState<number>(0)
  const [statesSeen, setStatesSeen] = useState<Set<PhaseState>>(new Set(['solid']))

  const { T: currentT, state: currentState } = stateAt(curve, Q)

  // Direction of heat flow: +1 heating, -1 cooling, 0 idle within deadband.
  const heatDir = isEvaluate
    ? 0
    : Math.abs(Tsetpoint - currentT) < T_DEADBAND
      ? 0
      : (Tsetpoint > currentT ? 1 : -1)

  // ─── Stage 3 labeling ─────────────────────────────────────────
  const LABEL_CHOICES: PhaseState[] = ['solid', 'fusion', 'liquid', 'vap', 'vapor']
  const shuffledChoices = useMemo(() => rootRng.shuffle(LABEL_CHOICES), [rootRng])
  const [assignedLabels, setAssignedLabels] = useState<(PhaseState | null)[]>(
    () => curve.segments.map(() => null),
  )

  const setStage = useSetStage()
  const progress = useProgress()
  const complete = useComplete()

  // ─── Advance predicates ───────────────────────────────────────
  const observeDone = statesSeen.size >= 4
  const experimentDone =
    initial === STAGE2_TARGET.initial &&
    currentState === STAGE2_TARGET.state &&
    Math.abs(currentT - STAGE2_TARGET.T) < STAGE2_TARGET.T_tolerance
  const evaluateDone = assignedLabels.every(
    (l, i) => l !== null && l === curve.segments[i]!.state,
  )
  const canSubmit = isObserve ? observeDone : isExperiment ? experimentDone : evaluateDone

  // ─── Tickers ──────────────────────────────────────────────────
  // 1. Heat/cool integrator — drives Q toward setpoint.
  useTicker((dt) => {
    if (isEvaluate) return
    if (heatDir === 0) return
    const rate = (power / 100) * HEAT_RATE_MAX
    if (rate <= 0) return
    setQ((prev) => {
      const next = prev + heatDir * rate * dt
      return Math.max(0, Math.min(next, curve.qEnd))
    })
  })

  // 2. Animation phase — jiggle molecules every frame, including on stage 3.
  const [tPhase, setTPhase] = useState(0)
  useTicker((dt) => setTPhase((v) => v + dt))

  // Track witnessed states on stage 1.
  useEffect(() => {
    if (!isObserve) return
    setStatesSeen((prev) => {
      if (prev.has(currentState)) return prev
      const next = new Set(prev)
      next.add(currentState)
      return next
    })
  }, [isObserve, currentState])

  // Snap Q to initial-state anchor on toggle change.
  const prevInitial = useRef(initial)
  useEffect(() => {
    if (prevInitial.current !== initial) {
      setQ(initialQ(curve, initial))
      prevInitial.current = initial
    }
  }, [initial, curve])

  // ─── Reset ────────────────────────────────────────────────────
  const resetForStage = useCallback((stage: number) => {
    setPower(50)
    if (stage === 2) {
      setInitial('solid')
      setTsetpoint(20)
      setQ(initialQ(curve, 'solid'))
    } else {
      setInitial('solid')
      setTsetpoint(20)
      setQ(0)
    }
    setStatesSeen(new Set(['solid']))
    setAssignedLabels(curve.segments.map(() => null))
    prevInitial.current = 'solid'
  }, [curve])

  useReset(() => resetForStage(stageIdx))

  // ─── Progress + next + hint ───────────────────────────────────
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

  // ─── Plot coord helpers ───────────────────────────────────────
  // plotQMax is derived from the stable curve.qEnd — do NOT let live Q
  // drive it or the axes flicker every frame.
  const plotQMax = useMemo(() => curve.qEnd * 1.02, [curve])
  const plotTMin = -30
  const plotTMax = WATER.T_end + 10

  const qToX = useCallback(
    (q: number) => PLOT_X0 + (q / plotQMax) * PLOT_W,
    [plotQMax],
  )
  const tToY = useCallback(
    (t: number) => PLOT_Y1 - ((t - plotTMin) / (plotTMax - plotTMin)) * PLOT_H,
    [],
  )

  const yTicks = useMemo(() => {
    const anchors = [plotTMin, 0, WATER.T_f, WATER.T_v, plotTMax]
    const seen = new Set<number>()
    return anchors
      .filter((v) => v >= plotTMin && v <= plotTMax)
      .filter((v) => !seen.has(Math.round(v)) && seen.add(Math.round(v)))
      .map((t) => ({ t, y: tToY(t) }))
  }, [tToY])

  // Static full-curve overlay (stages 1 + 2 as a faint reference; stage 3
  // is the labeling target with per-segment colouring).
  const curvePath = useCallback((c: Curve): string => {
    let d = ''
    c.segments.forEach((s, i) => {
      const x0 = qToX(s.q0), y0 = tToY(s.T0)
      const x1 = qToX(s.q1), y1 = tToY(s.T1)
      d += i === 0 ? `M ${x0} ${y0} ` : ''
      d += `L ${x1} ${y1} `
    })
    return d
  }, [qToX, tToY])

  // ─── Molecules ─────────────────────────────────────────────────
  const molecules = useMemo(() => {
    const rng = rootRng.fork()
    return Array.from({ length: 40 }, (_, i) => ({
      id: i,
      gx: (i % 8) / 7,
      gy: Math.floor(i / 8) / 4,
      jx: rng.next() - 0.5,
      jy: rng.next() - 0.5,
      phase: rng.next() * Math.PI * 2,
    }))
  }, [rootRng])

  // Freeze molecule display on stage 3 to a static 'solid' pose — the
  // beaker's phase visualisation would be help.
  const displayState: PhaseState = isEvaluate ? 'solid' : currentState

  // ─── HUD text ─────────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${L('stage')} 0${stageIdx} · ${stageName}`
  const hudTR = isObserve
    ? `${L('states_seen')}: ${statesSeen.size}/5`
    : isExperiment
      ? experimentDone ? `${L('target_reached')} ✓` : L('target_prompt')
      : `${L('labels')}: ${assignedLabels.filter((l, i) => l === curve.segments[i]!.state).length}/${curve.segments.length}`
  const hudBL = isObserve ? L('tip1') : isExperiment ? L('tip2') : L('tip3')

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block', userSelect: 'none' }}
      >
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        {/* ── Molecule beaker (left) ─────────────────────────── */}
        <rect
          x={MOL_X} y={MOL_Y} width={MOL_W} height={MOL_H}
          fill="none" stroke="#12203a" strokeWidth={1} rx={6}
        />
        <text
          x={MOL_X + 8} y={MOL_Y - 8}
          fill="#6C7A93" fontFamily="'JetBrains Mono', monospace"
          fontSize={11} letterSpacing="0.1em"
        >
          {L('beaker')}
        </text>

        <MoleculeCloud
          x={MOL_X + 12} y={MOL_Y + 24}
          w={MOL_W - 24} h={MOL_H - 60}
          state={displayState}
          molecules={molecules}
          tPhase={tPhase}
        />

        {/* State label at bottom — hidden (dash) on blind stage. */}
        <text
          x={MOL_X + MOL_W / 2} y={MOL_Y + MOL_H - 12}
          fill="#B9C4D6" fontFamily="'JetBrains Mono', monospace"
          fontSize={14} textAnchor="middle" fontWeight={600}
        >
          {isEvaluate ? '—' : L(`state_${displayState}`)}
        </text>

        {/* Heater element under the beaker — hidden on stage 3. */}
        {!isEvaluate && heatDir !== 0 && (
          <HeaterElement
            x={MOL_X + MOL_W / 2}
            y={MOL_Y + MOL_H + 4}
            intensity={power / 100}
            direction={heatDir}
            tPhase={tPhase}
          />
        )}

        {/* ── T vs t plot (centre) ───────────────────────────── */}
        <rect
          x={PLOT_X0} y={PLOT_Y0} width={PLOT_W} height={PLOT_H}
          fill="none" stroke="#12203a" strokeWidth={1} rx={6}
        />
        <text
          x={PLOT_X0 + 8} y={PLOT_Y0 - 8}
          fill="#6C7A93" fontFamily="'JetBrains Mono', monospace"
          fontSize={11} letterSpacing="0.1em"
        >
          {L('plot_title')}
        </text>
        <text
          x={PLOT_X0 - 8} y={PLOT_Y0 + 4}
          fill="#6C7A93" fontFamily="'JetBrains Mono', monospace"
          fontSize={10} textAnchor="end"
        >
          T (°C)
        </text>
        <text
          x={PLOT_X1 + 4} y={PLOT_Y1 + 12}
          fill="#6C7A93" fontFamily="'JetBrains Mono', monospace"
          fontSize={10}
        >
          t
        </text>

        {/* Horizontal gridlines + tick labels */}
        {yTicks.map((tk, i) => (
          <g key={i}>
            <line
              x1={PLOT_X0} y1={tk.y} x2={PLOT_X1} y2={tk.y}
              stroke="#12203a" strokeWidth={1} strokeDasharray="2 4"
            />
            <text
              x={PLOT_X0 - 4} y={tk.y + 3}
              fill="#6C7A93" fontFamily="'JetBrains Mono', monospace"
              fontSize={9} textAnchor="end"
            >
              {Math.round(tk.t)}
            </text>
          </g>
        ))}
        {plotTMin < 0 && (
          <line
            x1={PLOT_X0} y1={tToY(0)} x2={PLOT_X1} y2={tToY(0)}
            stroke="#3A4863" strokeWidth={0.8} strokeDasharray="1 3"
          />
        )}

        {/* Faint reference curve on stages 1 + 2 so the student can
            see where they've been on the T(t) trace. Removed on the
            blind stage — the curve there is drawn per-segment with
            correct/wrong colouring below. */}
        {!isEvaluate && (
          <path
            d={curvePath(curve)}
            fill="none" stroke="#3A4863" strokeWidth={1.2}
            strokeDasharray="4 5" opacity={0.6}
          />
        )}

        {/* Stage 2 setpoint indicator — dashed horizontal T-line */}
        {isExperiment && (
          <>
            <line
              x1={PLOT_X0} y1={tToY(Tsetpoint)}
              x2={PLOT_X1} y2={tToY(Tsetpoint)}
              stroke="#F9A968" strokeWidth={1} strokeDasharray="4 4" opacity={0.55}
            />
            <text
              x={PLOT_X1 - 4} y={tToY(Tsetpoint) - 4}
              fill="#F9A968" fontFamily="'JetBrains Mono', monospace"
              fontSize={9} textAnchor="end"
            >
              setpoint {Tsetpoint}°C
            </text>
            {/* Target band: liquid @ 40°C, ±T_tolerance */}
            <rect
              x={PLOT_X0} y={tToY(STAGE2_TARGET.T + STAGE2_TARGET.T_tolerance)}
              width={PLOT_W}
              height={
                tToY(STAGE2_TARGET.T - STAGE2_TARGET.T_tolerance)
                - tToY(STAGE2_TARGET.T + STAGE2_TARGET.T_tolerance)
              }
              fill="#37C9B8" opacity={0.08}
            />
            <text
              x={PLOT_X0 + 6} y={tToY(STAGE2_TARGET.T) + 3}
              fill="#37C9B8" fontFamily="'JetBrains Mono', monospace"
              fontSize={9}
            >
              target 40°C
            </text>
          </>
        )}

        {/* Stage 3 — numbered coloured segments (kept), no live dot,
            no live curve (both are help). */}
        {isEvaluate && (
          <>
            {curve.segments.map((s, i) => {
              const selected = assignedLabels[i]
              const correct = selected !== null && selected === s.state
              const wrong   = selected !== null && selected !== s.state
              const stroke  = correct ? '#37C9B8' : wrong ? '#F97316' : '#B9C4D6'
              return (
                <line
                  key={i}
                  x1={qToX(s.q0)} y1={tToY(s.T0)}
                  x2={qToX(s.q1)} y2={tToY(s.T1)}
                  stroke={stroke} strokeWidth={3.5} strokeLinecap="round"
                />
              )
            })}
            {curve.segments.map((s, i) => {
              const cx = (qToX(s.q0) + qToX(s.q1)) / 2
              const cy = (tToY(s.T0) + tToY(s.T1)) / 2
              return (
                <g key={i}>
                  <circle
                    cx={cx} cy={cy - 14} r={11}
                    fill="#0D1524" stroke="#3A4863" strokeWidth={1}
                  />
                  <text
                    x={cx} y={cy - 10}
                    fill="#B9C4D6" fontFamily="'JetBrains Mono', monospace"
                    fontSize={12} fontWeight={700} textAnchor="middle"
                  >
                    {i + 1}
                  </text>
                </g>
              )
            })}
          </>
        )}

        {/* Live tracking dot — help, hidden on stage 3. */}
        {!isEvaluate && (
          <circle
            cx={qToX(Q)} cy={tToY(currentT)}
            r={4} fill="#F9A968" stroke="#0D1524" strokeWidth={1}
          />
        )}

        {/* Thermometer glyph on the left panel */}
        {!isEvaluate && (
          <Thermometer x={MOL_X - 22} y={MOL_Y + 20} height={MOL_H - 60} T={currentT} />
        )}
      </svg>

      {/* ── HUD overlays (HTML) ──────────────────────────────── */}
      <div style={hudTLStyle}>{hudTL}</div>
      <div style={{ ...hudTRStyle, color: canSubmit ? '#37C9B8' : '#B9C4D6' }}>
        {hudTR}
      </div>
      <div style={hudBLStyle}>{hudBL}</div>
      {/* BR reserved for parent chrome. */}

      {/* ── Right-panel controls ──────────────────────────────── */}
      <div style={rightPanelWrapperStyle}>
        <div style={rightPanelTitleStyle}>{L('controls_title')}</div>
        <div style={rightPanelBoxStyle}>

          {!isEvaluate && (
            <>
              {isExperiment && (
                <div style={targetPromptStyle}>
                  {L('field_target')}: {L('target_prompt')}
                </div>
              )}

              {isExperiment && (
                <FieldGroup label={L('field_initial')}>
                  <Toggle
                    options={[
                      { value: 'solid',  label: L('state_solid') },
                      { value: 'liquid', label: L('state_liquid') },
                      { value: 'vapor',  label: L('state_vapor') },
                    ]}
                    value={initial}
                    onChange={(v) => setInitial(v as InitialState)}
                  />
                </FieldGroup>
              )}

              <FieldGroup label={`${L('field_setpoint')}: ${Tsetpoint}°C`}>
                <input
                  type="range"
                  min={SETPOINT_MIN} max={SETPOINT_MAX} step={5}
                  value={Tsetpoint}
                  onChange={(e) => setTsetpoint(parseInt(e.target.value, 10))}
                  style={{ width: '100%', accentColor: '#F9A968', height: '2rem' }}
                />
              </FieldGroup>

              <FieldGroup label={`${L('field_rate')}: ${power}%`}>
                <input
                  type="range"
                  min={0} max={100} step={5}
                  value={power}
                  onChange={(e) => setPower(parseInt(e.target.value, 10))}
                  style={{ width: '100%', accentColor: '#F9A968', height: '2rem' }}
                />
              </FieldGroup>

              <div style={statusBoxStyle}>
                <div style={statusLabelStyle}>{L('field_status')}</div>
                <div style={{ fontSize: '1.9rem', color: '#B9C4D6' }}>
                  T = <span style={{ color: '#F9A968', fontWeight: 700 }}>
                    {currentT.toFixed(1)}°C
                  </span>
                </div>
                <div style={{ fontSize: '1.5rem', color: '#54617A' }}>
                  {heatDir > 0 ? '↑ heating'
                    : heatDir < 0 ? '↓ cooling'
                    : '· idle'}
                </div>
                <button type="button" onClick={() => resetForStage(stageIdx)} style={resetBtnStyle}>
                  ↻ {L('reset_sim')}
                </button>
              </div>
            </>
          )}

          {isEvaluate && (
            <>
              <div style={{ fontSize: '1.8rem', color: '#B9C4D6', lineHeight: 1.5 }}>
                {L('evaluate_prompt')}
              </div>
              {curve.segments.map((s, i) => {
                const selected = assignedLabels[i]
                const correct = selected !== null && selected === s.state
                const wrong = selected !== null && selected !== s.state
                return (
                  <div key={i} style={segRowStyle}>
                    <div style={{
                      minWidth: '2.6rem', height: '2.6rem',
                      borderRadius: '50%',
                      background: correct ? '#37C9B8' : wrong ? '#F97316' : '#0D1524',
                      color: (correct || wrong) ? '#0D1524' : '#B9C4D6',
                      border: '1px solid #3A4863',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: '1.6rem', fontWeight: 700,
                    }}>{i + 1}</div>
                    <select
                      value={selected ?? ''}
                      onChange={(e) => {
                        const v = e.target.value as PhaseState | ''
                        setAssignedLabels((prev) => {
                          const next = [...prev]
                          next[i] = v === '' ? null : v
                          return next
                        })
                      }}
                      style={{
                        flex: 1, padding: '1rem 1.2rem',
                        background: '#0D1524', color: '#B9C4D6',
                        border: `1px solid ${correct ? '#37C9B8' : wrong ? '#F97316' : '#3A4863'}`,
                        borderRadius: '0.4rem',
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: '1.8rem',
                      }}
                    >
                      <option value="">— {L('pick_label')} —</option>
                      {shuffledChoices.map((c) => (
                        <option key={c} value={c}>{L(`state_${c}`)}</option>
                      ))}
                    </select>
                  </div>
                )
              })}
            </>
          )}

        </div>
      </div>
    </div>
  )
}

// ─── Sub-components ────────────────────────────────────────────────────
function MoleculeCloud({ x, y, w, h, state, molecules, tPhase }: {
  x: number; y: number; w: number; h: number
  state: PhaseState
  molecules: { id: number; gx: number; gy: number; jx: number; jy: number; phase: number }[]
  tPhase: number
}) {
  const cfg = {
    solid:  { order: 1.0, density: 1.0, jiggle: 1.5,  fillY: 0.7 },
    fusion: { order: 0.5, density: 1.0, jiggle: 4,    fillY: 0.7 },
    liquid: { order: 0.0, density: 1.0, jiggle: 6,    fillY: 0.55 },
    vap:    { order: 0.0, density: 0.7, jiggle: 10,   fillY: 0.35 },
    vapor:  { order: 0.0, density: 0.4, jiggle: 14,   fillY: 0.0 },
  }[state]

  const color = '#7EE3D8'
  const stroke = '#37C9B8'
  const N = Math.round(molecules.length * cfg.density)

  return (
    <g>
      <rect
        x={x} y={y} width={w} height={h}
        fill="#0F1A2E" stroke="#12203a" strokeWidth={1} rx={4}
      />
      {state !== 'vapor' && (
        <line
          x1={x} y1={y + h * (1 - cfg.fillY)}
          x2={x + w} y2={y + h * (1 - cfg.fillY)}
          stroke={stroke} strokeWidth={0.6} opacity={0.35}
          strokeDasharray="2 3"
        />
      )}
      {molecules.slice(0, N).map((m) => {
        const boxTop = y + h * (1 - cfg.fillY) + 8
        const boxBot = y + h - 8
        const gxOrd = x + 8 + m.gx * (w - 16)
        const gyOrd = boxTop + m.gy * (boxBot - boxTop)
        const gxRnd = x + 8 + (((m.gx + m.jx * 0.5) % 1 + 1) % 1) * (w - 16)
        const gyRnd = y + 8 + (((m.gy + m.jy * 0.5) % 1 + 1) % 1) * (h - 16)
        const bx = gxOrd * cfg.order + gxRnd * (1 - cfg.order)
        const by = gyOrd * cfg.order + gyRnd * (1 - cfg.order)
        const wob = cfg.jiggle
        return (
          <circle
            key={m.id}
            cx={bx + Math.cos(tPhase * 3 + m.phase) * wob}
            cy={by + Math.sin(tPhase * 4 + m.phase * 1.3) * wob}
            r={4} fill={color} stroke={stroke} strokeWidth={0.8} opacity={0.9}
          />
        )
      })}
    </g>
  )
}

// A dual-purpose heater: red flame when heating, blue chill glow when cooling.
function HeaterElement({ x, y, intensity, direction, tPhase }: {
  x: number; y: number; intensity: number; direction: number; tPhase: number
}) {
  const isHeat = direction > 0
  const h = 20 + intensity * 34
  const w = 22 + intensity * 8
  const flicker = 1 + 0.08 * Math.sin(tPhase * 12)
  if (isHeat) {
    return (
      <g transform={`translate(${x}, ${y})`}>
        <path
          d={`M ${-w / 2 * flicker} 0 Q ${-w / 4} ${-h * 0.4} 0 ${-h * flicker} Q ${w / 4} ${-h * 0.4} ${w / 2 * flicker} 0 Z`}
          fill="#F97316" opacity={0.85}
        />
        <path
          d={`M ${-w / 3 * flicker} 0 Q ${-w / 6} ${-h * 0.5} 0 ${-h * 0.75 * flicker} Q ${w / 6} ${-h * 0.5} ${w / 3 * flicker} 0 Z`}
          fill="#FCD34D" opacity={0.9}
        />
      </g>
    )
  }
  // cooling — a downward-pointing chill glow (inverted flame, blue palette)
  return (
    <g transform={`translate(${x}, ${y})`}>
      <path
        d={`M ${-w / 2 * flicker} 0 Q ${-w / 4} ${h * 0.4} 0 ${h * flicker} Q ${w / 4} ${h * 0.4} ${w / 2 * flicker} 0 Z`}
        fill="#3B82F6" opacity={0.75}
      />
      <path
        d={`M ${-w / 3 * flicker} 0 Q ${-w / 6} ${h * 0.5} 0 ${h * 0.75 * flicker} Q ${w / 6} ${h * 0.5} ${w / 3 * flicker} 0 Z`}
        fill="#93C5FD" opacity={0.9}
      />
    </g>
  )
}

// A thin thermometer glyph anchored on the left side of the beaker.
function Thermometer({ x, y, height, T }: {
  x: number; y: number; height: number; T: number
}) {
  const barW = 6
  const bulbR = 6
  const T_MIN = -30
  const T_MAX = 140
  const frac = Math.max(0, Math.min(1, (T - T_MIN) / (T_MAX - T_MIN)))
  const fillY = y + height * (1 - frac)
  const color = T < 0 ? '#93C5FD' : T < 100 ? '#F9A968' : '#F97316'
  return (
    <g>
      <rect
        x={x - barW / 2} y={y} width={barW} height={height}
        fill="#0F1A2E" stroke="#3A4863" strokeWidth={0.8} rx={3}
      />
      <rect
        x={x - barW / 2 + 1} y={fillY}
        width={barW - 2} height={y + height - fillY}
        fill={color} opacity={0.9}
      />
      <circle
        cx={x} cy={y + height + bulbR - 2} r={bulbR}
        fill={color} stroke="#3A4863" strokeWidth={0.8}
      />
    </g>
  )
}

function FieldGroup({ label, children }: {
  label: string; children: React.ReactNode
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
      <div style={{
        fontSize: '1.5rem', letterSpacing: '0.1em',
        textTransform: 'uppercase', color: '#54617A',
      }}>
        {label}
      </div>
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
              flex: 1, padding: '1rem 1rem',
              background: active ? '#3A4863' : 'transparent',
              color: active ? '#EAF0FA' : '#6C7A93',
              border: '1px solid #3A4863',
              borderRadius: '0.4rem',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '1.9rem', cursor: 'pointer',
            }}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

// ─── Styles ─────────────────────────────────────────────────────────────
const hudTLStyle: React.CSSProperties = {
  position: 'absolute', top: '3rem', left: '3rem',
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: '2.3rem', letterSpacing: '0.14em', textTransform: 'uppercase',
  color: '#6C7A93', zIndex: 5, pointerEvents: 'none',
}
const hudTRStyle: React.CSSProperties = {
  position: 'absolute', top: '3rem', right: '3rem',
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: '2.3rem', letterSpacing: '0.08em',
  zIndex: 5, pointerEvents: 'none',
}
const hudBLStyle: React.CSSProperties = {
  position: 'absolute', bottom: '3rem', left: '3rem',
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: '2.3rem', letterSpacing: '0.06em',
  color: '#6C7A93', zIndex: 5, pointerEvents: 'none', maxWidth: '58%',
}
const rightPanelWrapperStyle: React.CSSProperties = {
  position: 'absolute',
  top: '9.7rem', bottom: '15.6rem',
  right: '6.7rem', width: '40rem',
  boxSizing: 'border-box', zIndex: 6,
  color: '#B9C4D6', fontFamily: "'JetBrains Mono', monospace",
  display: 'flex', flexDirection: 'column',
}
const rightPanelTitleStyle: React.CSSProperties = {
  fontSize: '2.44rem', color: '#6C7A93',
  letterSpacing: '0.1em', marginBottom: '1.2rem', marginLeft: '0.4rem',
}
const rightPanelBoxStyle: React.CSSProperties = {
  flex: 1, border: '1px solid #12203a', borderRadius: '0.6rem',
  padding: '2rem',
  display: 'flex', flexDirection: 'column', gap: '2rem',
  fontSize: '2rem', overflow: 'auto',
}
const statusBoxStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: '0.6rem',
  padding: '1.2rem 1.4rem',
  border: '1px solid #12203a', borderRadius: '0.5rem',
}
const statusLabelStyle: React.CSSProperties = {
  fontSize: '1.5rem', color: '#54617A',
  letterSpacing: '0.08em', textTransform: 'uppercase',
}
const resetBtnStyle: React.CSSProperties = {
  marginTop: '0.6rem', padding: '1rem 1.4rem',
  background: 'transparent', color: '#6C7A93',
  border: '1px solid #3A4863', borderRadius: '0.4rem',
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: '1.9rem', cursor: 'pointer',
}
const segRowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '0.8rem',
}
const targetPromptStyle: React.CSSProperties = {
  padding: '1rem 1.2rem',
  border: '1px solid #37C9B8',
  borderRadius: '0.4rem',
  fontSize: '1.7rem',
  color: '#37C9B8',
  letterSpacing: '0.04em',
  background: 'rgba(55,201,184,0.06)',
}
