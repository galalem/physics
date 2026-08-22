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
  useTicker,
} from '@physics/sdk/react'
import { getHintFor, getStagesFor } from './stages'
import en from '../i18n/en.json'
import fr from '../i18n/fr.json'
import ar from '../i18n/ar.json'

// ─── Canvas ─────────────────────────────────────────────────────────────
const W = 800
const H = 450

// ─── Physics model ──────────────────────────────────────────────────────
// Pedagogical "energy units" — not real J. Balanced so all segments are visible.
type SubstanceId = 'water' | 'iode'
type PhaseState = 'solid' | 'fusion' | 'liquid' | 'vap' | 'vapor'

type Substance = {
  id: SubstanceId
  isSublimation: boolean
  T_start: number
  T_f: number
  T_v: number
  T_end: number
  c_s: number
  c_l: number
  c_v: number
  L_f: number
  L_v: number
}

const SUBSTANCES: Record<SubstanceId, Substance> = {
  water: {
    id: 'water', isSublimation: false,
    T_start: -20, T_f: 0, T_v: 100, T_end: 130,
    c_s: 2, c_l: 4, c_v: 2,
    L_f: 80, L_v: 200,
  },
  iode: {
    id: 'iode', isSublimation: true,
    T_start: 20, T_f: 180, T_v: 180, T_end: 260,
    c_s: 1, c_l: 1, c_v: 1,
    L_f: 100, L_v: 0,
  },
}

type Curve = {
  qEnd: number
  segments: { state: PhaseState; q0: number; q1: number; T0: number; T1: number }[]
}

function computeCurve(sub: Substance, mass: number): Curve {
  if (sub.isSublimation) {
    const q1 = mass * sub.c_s * (sub.T_f - sub.T_start)
    const q2 = q1 + mass * sub.L_f
    const qEnd = q2 + mass * sub.c_v * (sub.T_end - sub.T_f)
    return {
      qEnd,
      segments: [
        { state: 'solid',  q0: 0,  q1: q1,   T0: sub.T_start, T1: sub.T_f },
        { state: 'fusion', q0: q1, q1: q2,   T0: sub.T_f,     T1: sub.T_f },
        { state: 'vapor',  q0: q2, q1: qEnd, T0: sub.T_f,     T1: sub.T_end },
      ],
    }
  }
  const q1 = mass * sub.c_s * (sub.T_f - sub.T_start)
  const q2 = q1 + mass * sub.L_f
  const q3 = q2 + mass * sub.c_l * (sub.T_v - sub.T_f)
  const q4 = q3 + mass * sub.L_v
  const qEnd = q4 + mass * sub.c_v * (sub.T_end - sub.T_v)
  return {
    qEnd,
    segments: [
      { state: 'solid',  q0: 0,  q1: q1,   T0: sub.T_start, T1: sub.T_f },
      { state: 'fusion', q0: q1, q1: q2,   T0: sub.T_f,     T1: sub.T_f },
      { state: 'liquid', q0: q2, q1: q3,   T0: sub.T_f,     T1: sub.T_v },
      { state: 'vap',    q0: q3, q1: q4,   T0: sub.T_v,     T1: sub.T_v },
      { state: 'vapor',  q0: q4, q1: qEnd, T0: sub.T_v,     T1: sub.T_end },
    ],
  }
}

function stateAt(curve: Curve, Q: number): { T: number; state: PhaseState } {
  const seg = curve.segments.find((s) => Q <= s.q1) ?? curve.segments[curve.segments.length - 1]!
  const span = seg.q1 - seg.q0
  const t = span > 0 ? (Q - seg.q0) / span : 1
  const T = seg.T0 + t * (seg.T1 - seg.T0)
  return { T, state: seg.state }
}

// ─── Constants ──────────────────────────────────────────────────────────
const HEAT_RATE_MAX = 90 // Q units per second at full slider
const MASS_OPTIONS = [0.5, 1.0, 1.5]
const STAGE2_TARGET = { substance: 'water' as SubstanceId, mass: 1.0 }
const STAGE3_TARGET = { substance: 'water' as SubstanceId, mass: 1.0 }

// Molecule box
const MOL_X = 40, MOL_Y = 60, MOL_W = 190, MOL_H = 320

// Plot
const PLOT_X0 = 258, PLOT_Y0 = 60, PLOT_W = 302, PLOT_H = 320
const PLOT_X1 = PLOT_X0 + PLOT_W, PLOT_Y1 = PLOT_Y0 + PLOT_H

// ─── i18n ───────────────────────────────────────────────────────────────
const dict = { en, fr, ar } as const
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
  const isObserve = stageIdx === 1
  const isExperiment = stageIdx === 2
  const isEvaluate = stageIdx === 3

  // Sim state (stages 1 + 2)
  const [substance, setSubstance] = useState<SubstanceId>('water')
  const [mass, setMass] = useState<number>(1.0)
  const [heatRate, setHeatRate] = useState<number>(50)
  const [Q, setQ] = useState<number>(0)
  const [statesSeen, setStatesSeen] = useState<Set<PhaseState>>(new Set(['solid']))

  const curve = useMemo(() => computeCurve(SUBSTANCES[substance], mass), [substance, mass])
  const targetCurve = useMemo(
    () => computeCurve(SUBSTANCES[STAGE2_TARGET.substance], STAGE2_TARGET.mass),
    [],
  )
  const targetCurve3 = useMemo(
    () => computeCurve(SUBSTANCES[STAGE3_TARGET.substance], STAGE3_TARGET.mass),
    [],
  )

  const { T: currentT, state: currentState } = stateAt(curve, Q)

  // Stage 3 labeling — one label slot per real segment (5 for water).
  const LABEL_CHOICES: PhaseState[] = ['solid', 'fusion', 'liquid', 'vap', 'vapor']
  const shuffledChoices = useMemo(() => rootRng.shuffle(LABEL_CHOICES), [rootRng])
  const [assignedLabels, setAssignedLabels] = useState<(PhaseState | null)[]>(
    () => targetCurve3.segments.map(() => null),
  )

  const setStage = useSetStage()
  const progress = useProgress()
  const complete = useComplete()

  const observeDone = statesSeen.size >= 4
  const experimentDone = substance === STAGE2_TARGET.substance && Math.abs(mass - STAGE2_TARGET.mass) < 0.01
  const evaluateDone = assignedLabels.every((l, i) => l !== null && l === targetCurve3.segments[i]!.state)
  const canSubmit = isObserve ? observeDone : isExperiment ? experimentDone : evaluateDone

  // Simulation ticker (stages 1 + 2)
  useTicker((dt) => {
    if (isEvaluate) return
    const rate = (heatRate / 100) * HEAT_RATE_MAX
    if (rate <= 0) return
    setQ((prev) => Math.min(prev + rate * dt, curve.qEnd))
  })

  useEffect(() => {
    if (!isObserve) return
    setStatesSeen((prev) => {
      if (prev.has(currentState)) return prev
      const next = new Set(prev)
      next.add(currentState)
      return next
    })
  }, [isObserve, currentState])

  const resetSim = useCallback(() => {
    setQ(0)
    setStatesSeen(new Set(['solid']))
  }, [])

  const resetForStage = useCallback((stage: number) => {
    setSubstance('water')
    setMass(1.0)
    setHeatRate(50)
    setQ(0)
    setStatesSeen(new Set(['solid']))
    setAssignedLabels(targetCurve3.segments.map(() => null))
    void stage
  }, [targetCurve3])

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

  // Reset Q when substance/mass change
  const prevSubMass = useRef({ substance, mass })
  useEffect(() => {
    if (prevSubMass.current.substance !== substance || prevSubMass.current.mass !== mass) {
      setQ(0)
      setStatesSeen(new Set(['solid']))
      prevSubMass.current = { substance, mass }
    }
  }, [substance, mass])

  // ─── Plot helpers ─────────────────────────────────────────────────
  const plotQMax = useMemo(() => {
    const live = curve.qEnd
    const tgt = isExperiment ? targetCurve.qEnd : isEvaluate ? targetCurve3.qEnd : live
    return Math.max(live, tgt) * 1.02
  }, [curve, targetCurve, targetCurve3, isExperiment, isEvaluate])

  const plotTMin = -30
  const plotTMax = useMemo(() => {
    const live = SUBSTANCES[substance].T_end
    const tgt = isExperiment
      ? SUBSTANCES[STAGE2_TARGET.substance].T_end
      : isEvaluate ? SUBSTANCES[STAGE3_TARGET.substance].T_end : live
    return Math.max(live, tgt) + 10
  }, [substance, isExperiment, isEvaluate])

  const qToX = (q: number) => PLOT_X0 + (q / plotQMax) * PLOT_W
  const tToY = (t: number) => PLOT_Y1 - ((t - plotTMin) / (plotTMax - plotTMin)) * PLOT_H

  const curvePath = (c: Curve): string => {
    let d = ''
    c.segments.forEach((s, i) => {
      const x0 = qToX(s.q0), y0 = tToY(s.T0)
      const x1 = qToX(s.q1), y1 = tToY(s.T1)
      d += i === 0 ? `M ${x0} ${y0} ` : ''
      d += `L ${x1} ${y1} `
    })
    return d
  }

  const livePathUpTo = (c: Curve, Qmax: number): string => {
    let d = ''
    for (let i = 0; i < c.segments.length; i++) {
      const s = c.segments[i]!
      const x0 = qToX(s.q0), y0 = tToY(s.T0)
      if (i === 0) d += `M ${x0} ${y0} `
      if (Qmax >= s.q1) {
        d += `L ${qToX(s.q1)} ${tToY(s.T1)} `
      } else {
        const span = s.q1 - s.q0
        const t = span > 0 ? (Qmax - s.q0) / span : 1
        d += `L ${qToX(Qmax)} ${tToY(s.T0 + t * (s.T1 - s.T0))} `
        break
      }
    }
    return d
  }

  const xTicks = useMemo(() => {
    const n = 5
    return Array.from({ length: n + 1 }, (_, i) => {
      const q = (i / n) * plotQMax
      return { q, x: qToX(q) }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plotQMax])

  const yTicks = useMemo(() => {
    const anchors = [plotTMin, 0, SUBSTANCES[substance].T_f, SUBSTANCES[substance].T_v, plotTMax]
      .filter((v) => v >= plotTMin && v <= plotTMax)
    const seen = new Set<number>()
    const uniq = anchors.filter((v) => (seen.has(Math.round(v)) ? false : (seen.add(Math.round(v)), true)))
    return uniq.map((t) => ({ t, y: tToY(t) }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [substance, plotTMax])

  // ─── Molecules ─────────────────────────────────────────────────────
  const molecules = useMemo(() => {
    const N = 40
    const rng = rootRng.fork()
    return Array.from({ length: N }, (_, i) => {
      const gridX = i % 8
      const gridY = Math.floor(i / 8)
      return {
        id: i,
        gx: gridX / 7,
        gy: gridY / 4,
        jx: rng.next() - 0.5,
        jy: rng.next() - 0.5,
        phase: rng.next() * Math.PI * 2,
      }
    })
  }, [rootRng])

  const [tPhase, setTPhase] = useState(0)
  useTicker((dt) => setTPhase((v) => v + dt))

  const displayState: PhaseState = isEvaluate ? 'solid' : currentState

  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${L('stage')} 0${stageIdx} · ${stageName}`
  const hudTR = isObserve
    ? `${L('states_seen')}: ${statesSeen.size}/${curve.segments.length}`
    : isExperiment
      ? experimentDone ? `${L('matched')} ✓` : L('match_target')
      : `${L('labels')}: ${assignedLabels.filter((l, i) => l === targetCurve3.segments[i]!.state).length}/${targetCurve3.segments.length}`
  const hudBL = isObserve ? L('tip1') : isExperiment ? L('tip2') : L('tip3')

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block', userSelect: 'none' }}
      >
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        {/* Molecule beaker */}
        <rect x={MOL_X} y={MOL_Y} width={MOL_W} height={MOL_H} fill="none" stroke="#12203a" strokeWidth={1} rx={6} />
        <text x={MOL_X + 8} y={MOL_Y - 8} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={11} letterSpacing="0.1em">
          {L('beaker')}
        </text>
        <MoleculeCloud
          x={MOL_X + 12} y={MOL_Y + 24}
          w={MOL_W - 24} h={MOL_H - 60}
          state={displayState}
          molecules={molecules}
          tPhase={tPhase}
          substance={substance}
        />
        <text
          x={MOL_X + MOL_W / 2}
          y={MOL_Y + MOL_H - 12}
          fill="#B9C4D6"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={14}
          textAnchor="middle"
          fontWeight={600}
        >
          {isEvaluate ? '—' : L(`state_${displayState}`)}
        </text>

        {/* Bunsen flame */}
        {!isEvaluate && heatRate > 0 && (
          <BunsenFlame x={MOL_X + MOL_W / 2} y={MOL_Y + MOL_H + 4} intensity={heatRate / 100} tPhase={tPhase} />
        )}

        {/* Plot */}
        <rect x={PLOT_X0} y={PLOT_Y0} width={PLOT_W} height={PLOT_H} fill="none" stroke="#12203a" strokeWidth={1} rx={6} />
        <text x={PLOT_X0 + 8} y={PLOT_Y0 - 8} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={11} letterSpacing="0.1em">
          {L('plot_title')}
        </text>

        <text x={PLOT_X0 - 8} y={PLOT_Y0 + 4} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={10} textAnchor="end">
          T (°C)
        </text>
        <text x={PLOT_X1 + 4} y={PLOT_Y1 + 12} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={10}>
          Q
        </text>

        {/* Gridlines + Y ticks */}
        {yTicks.map((tk, i) => (
          <g key={i}>
            <line x1={PLOT_X0} y1={tk.y} x2={PLOT_X1} y2={tk.y} stroke="#12203a" strokeWidth={1} strokeDasharray="2 4" />
            <text x={PLOT_X0 - 4} y={tk.y + 3} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={9} textAnchor="end">
              {Math.round(tk.t)}
            </text>
          </g>
        ))}
        {xTicks.map((tk, i) => (
          <line key={i} x1={tk.x} y1={PLOT_Y1} x2={tk.x} y2={PLOT_Y1 + 4} stroke="#3A4863" strokeWidth={1} />
        ))}

        {plotTMin < 0 && (
          <line x1={PLOT_X0} y1={tToY(0)} x2={PLOT_X1} y2={tToY(0)} stroke="#3A4863" strokeWidth={0.8} strokeDasharray="1 3" />
        )}

        {isExperiment && (
          <path d={curvePath(targetCurve)} fill="none" stroke="#37C9B8" strokeWidth={2} strokeDasharray="6 6" opacity={0.55} />
        )}

        {isEvaluate && (
          <>
            {targetCurve3.segments.map((s, i) => {
              const selected = assignedLabels[i]
              const correct = selected !== null && selected === s.state
              const wrong = selected !== null && selected !== s.state
              const stroke = correct ? '#37C9B8' : wrong ? '#F97316' : '#B9C4D6'
              return (
                <line
                  key={i}
                  x1={qToX(s.q0)} y1={tToY(s.T0)}
                  x2={qToX(s.q1)} y2={tToY(s.T1)}
                  stroke={stroke}
                  strokeWidth={3.5}
                  strokeLinecap="round"
                />
              )
            })}
            {targetCurve3.segments.map((s, i) => {
              const cx = (qToX(s.q0) + qToX(s.q1)) / 2
              const cy = (tToY(s.T0) + tToY(s.T1)) / 2
              return (
                <g key={i}>
                  <circle cx={cx} cy={cy - 14} r={11} fill="#0D1524" stroke="#3A4863" strokeWidth={1} />
                  <text
                    x={cx} y={cy - 10}
                    fill="#B9C4D6"
                    fontFamily="'JetBrains Mono', monospace"
                    fontSize={12}
                    fontWeight={700}
                    textAnchor="middle"
                  >
                    {i + 1}
                  </text>
                </g>
              )
            })}
          </>
        )}

        {!isEvaluate && (
          <>
            <path d={livePathUpTo(curve, Q)} fill="none" stroke="#F9A968" strokeWidth={2.5} strokeLinejoin="round" />
            <circle cx={qToX(Q)} cy={tToY(currentT)} r={4} fill="#F9A968" stroke="#0D1524" strokeWidth={1} />
          </>
        )}
      </svg>

      <div style={hudTLStyle}>{hudTL}</div>
      <div style={{ ...hudTRStyle, color: canSubmit ? '#37C9B8' : '#B9C4D6' }}>{hudTR}</div>
      <div style={hudBLStyle}>{hudBL}</div>

      <div style={rightPanelWrapperStyle}>
        <div style={rightPanelTitleStyle}>{L('controls_title')}</div>
        <div style={rightPanelBoxStyle}>
          {!isEvaluate && (
            <>
              <FieldGroup label={L('field_substance')}>
                <Toggle
                  options={[
                    { value: 'water', label: L('substance_water') },
                    { value: 'iode',  label: L('substance_iode') },
                  ]}
                  value={substance}
                  onChange={(v) => setSubstance(v as SubstanceId)}
                />
              </FieldGroup>

              <FieldGroup label={`${L('field_mass')}: ${mass.toFixed(1)}`}>
                <Toggle
                  options={MASS_OPTIONS.map((m) => ({ value: String(m), label: m.toFixed(1) }))}
                  value={String(mass)}
                  onChange={(v) => setMass(parseFloat(v))}
                />
              </FieldGroup>

              <FieldGroup label={`${L('field_heat')}: ${heatRate}%`}>
                <input
                  type="range"
                  min={0} max={100} step={5}
                  value={heatRate}
                  onChange={(e) => setHeatRate(parseInt(e.target.value, 10))}
                  style={{ width: '100%', accentColor: '#F9A968', height: '2rem' }}
                />
              </FieldGroup>

              <div style={statusBoxStyle}>
                <div style={statusLabelStyle}>{L('field_status')}</div>
                <div style={{ fontSize: '1.9rem', color: '#B9C4D6' }}>
                  T = <span style={{ color: '#F9A968', fontWeight: 700 }}>{currentT.toFixed(1)}°C</span>
                </div>
                <div style={{ fontSize: '1.9rem', color: '#B9C4D6' }}>
                  Q = <span style={{ color: '#F9A968', fontWeight: 700 }}>{Q.toFixed(0)}</span> / {curve.qEnd.toFixed(0)}
                </div>
                <button type="button" onClick={resetSim} style={resetBtnStyle}>
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
              {targetCurve3.segments.map((s, i) => {
                const selected = assignedLabels[i]
                const correct = selected !== null && selected === s.state
                const wrong = selected !== null && selected !== s.state
                return (
                  <div key={i} style={segRowStyle}>
                    <div style={{
                      minWidth: '2.6rem', height: '2.6rem',
                      borderRadius: '50%',
                      background: correct ? '#37C9B8' : wrong ? '#F97316' : '#0D1524',
                      color: correct || wrong ? '#0D1524' : '#B9C4D6',
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
                        flex: 1,
                        padding: '1rem 1.2rem',
                        background: '#0D1524',
                        color: '#B9C4D6',
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

// ─── Sub-components ─────────────────────────────────────────────────────
function MoleculeCloud({ x, y, w, h, state, molecules, tPhase, substance }: {
  x: number; y: number; w: number; h: number
  state: PhaseState
  molecules: { id: number; gx: number; gy: number; jx: number; jy: number; phase: number }[]
  tPhase: number
  substance: SubstanceId
}) {
  const config = {
    solid:  { order: 1.0, density: 1.0, jiggle: 1.5,  fillY: 0.7 },
    fusion: { order: 0.5, density: 1.0, jiggle: 4,    fillY: 0.7 },
    liquid: { order: 0.0, density: 1.0, jiggle: 6,    fillY: 0.55 },
    vap:    { order: 0.0, density: 0.7, jiggle: 10,   fillY: 0.35 },
    vapor:  { order: 0.0, density: 0.4, jiggle: 14,   fillY: 0.0 },
  }[state]

  const color = substance === 'water' ? '#7EE3D8' : '#B87CE0'
  const stroke = substance === 'water' ? '#37C9B8' : '#7B4FAA'
  const N = Math.round(molecules.length * config.density)

  return (
    <g>
      <rect x={x} y={y} width={w} height={h} fill="#0F1A2E" stroke="#12203a" strokeWidth={1} rx={4} />
      {state !== 'vapor' && (
        <line x1={x} y1={y + h * (1 - config.fillY)} x2={x + w} y2={y + h * (1 - config.fillY)} stroke={stroke} strokeWidth={0.6} opacity={0.35} strokeDasharray="2 3" />
      )}
      {molecules.slice(0, N).map((m) => {
        const boxYTop = y + h * (1 - config.fillY) + 8
        const boxYBot = y + h - 8
        const gyOrdered = boxYTop + m.gy * (boxYBot - boxYTop)
        const gxOrdered = x + 8 + m.gx * (w - 16)
        const gxRandom = x + 8 + (((m.gx + m.jx * 0.5) % 1 + 1) % 1) * (w - 16)
        const gyRandom = y + 8 + (((m.gy + m.jy * 0.5) % 1 + 1) % 1) * (h - 16)
        const baseX = gxOrdered * config.order + gxRandom * (1 - config.order)
        const baseY = gyOrdered * config.order + gyRandom * (1 - config.order)
        const wob = config.jiggle
        const dx = Math.cos(tPhase * 3 + m.phase) * wob
        const dy = Math.sin(tPhase * 4 + m.phase * 1.3) * wob
        return (
          <circle
            key={m.id}
            cx={baseX + dx}
            cy={baseY + dy}
            r={4}
            fill={color}
            stroke={stroke}
            strokeWidth={0.8}
            opacity={0.9}
          />
        )
      })}
    </g>
  )
}

function BunsenFlame({ x, y, intensity, tPhase }: { x: number; y: number; intensity: number; tPhase: number }) {
  const h = 20 + intensity * 34
  const w = 22 + intensity * 8
  const flicker = 1 + 0.08 * Math.sin(tPhase * 12)
  return (
    <g transform={`translate(${x}, ${y})`}>
      <path
        d={`M ${-w / 2 * flicker} 0 Q ${-w / 4} ${-h * 0.4} 0 ${-h * flicker} Q ${w / 4} ${-h * 0.4} ${w / 2 * flicker} 0 Z`}
        fill="#F97316"
        opacity={0.85}
      />
      <path
        d={`M ${-w / 3 * flicker} 0 Q ${-w / 6} ${-h * 0.5} 0 ${-h * 0.75 * flicker} Q ${w / 6} ${-h * 0.5} ${w / 3 * flicker} 0 Z`}
        fill="#FCD34D"
        opacity={0.9}
      />
    </g>
  )
}

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
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
              padding: '1rem 1rem',
              background: active ? '#3A4863' : 'transparent',
              color: active ? '#EAF0FA' : '#6C7A93',
              border: '1px solid #3A4863',
              borderRadius: '0.4rem',
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
  marginTop: '0.6rem',
  padding: '1rem 1.4rem',
  background: 'transparent',
  color: '#6C7A93',
  border: '1px solid #3A4863',
  borderRadius: '0.4rem',
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: '1.9rem',
  cursor: 'pointer',
}
const segRowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '0.8rem',
}
