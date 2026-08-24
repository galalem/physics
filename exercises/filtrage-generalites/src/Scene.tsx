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
  useSeed,
  useSetStage,
} from '@physics/sdk/react'
import { getHintFor, getStagesFor } from './stages'
import en from '../i18n/en.json'

// ─── Canvas ─────────────────────────────────────────────────────────────
const W = 800
const H = 450

// Schematic box (left)
const CIRC_X0 = 40, CIRC_Y0 = 90, CIRC_W = 220, CIRC_H = 220

// Bode magnitude plot (right, upper)
const BODE_X0 = 300, BODE_Y0 = 80
const BODE_W = 300, BODE_H = 220
const BODE_X1 = BODE_X0 + BODE_W
const BODE_Y1 = BODE_Y0 + BODE_H

// Phase plot (right, lower — small row)
const PHASE_Y0 = 320
const PHASE_H = 70
const PHASE_Y1 = PHASE_Y0 + PHASE_H

// Frequency axis (log10): 10 Hz → 100 kHz (4 decades)
const F_MIN = 10
const F_MAX = 100000
const LOG_F_MIN = Math.log10(F_MIN)
const LOG_F_MAX = Math.log10(F_MAX)

// Magnitude axis: -60 dB → +10 dB
const DB_MIN = -60
const DB_MAX = 10

// Phase axis: -90° → +90°
const PH_MIN = -90
const PH_MAX = 90

// Stage 1 fc slider range (log)
const FC1_MIN = 30
const FC1_MAX = 30000

// Stage 2 R/C ranges
const R_MIN = 100      // Ω
const R_MAX = 100000   // 100 kΩ
const C_MIN = 1e-9     // 1 nF
const C_MAX = 10e-6    // 10 µF

// Stage 2 target
const STAGE2_FC_TARGET = 1000 // Hz
const STAGE2_TOL = 0.06       // ±6%

// Fixed Q used for band-pass / band-stop visualisations
const Q_FIXED = 3

// ─── Filter families ────────────────────────────────────────────────────
type FilterType = 'lp' | 'hp' | 'bp' | 'bs'
const FAMILIES: readonly FilterType[] = ['lp', 'hp', 'bp', 'bs']

// Stage-3 deck: each problem shows one Bode magnitude curve; answer = family.
type Problem = { family: FilterType; fc: number }
const STAGE3_PROBLEMS: Problem[] = [
  { family: 'lp', fc: 1000 },
  { family: 'hp', fc: 500 },
  { family: 'bp', fc: 2000 },
  { family: 'bs', fc: 1500 },
]

// ─── Physics ────────────────────────────────────────────────────────────
function magDb(family: FilterType, f: number, fc: number, Q: number): number {
  if (family === 'lp') {
    const r = f / fc
    return -10 * Math.log10(1 + r * r)
  }
  if (family === 'hp') {
    const r = f / fc
    return 10 * Math.log10((r * r) / (1 + r * r))
  }
  const x = f / fc - fc / f
  const qx = Q * x
  if (family === 'bp') return -10 * Math.log10(1 + qx * qx)
  // band-stop
  return 10 * Math.log10((qx * qx) / (1 + qx * qx))
}

function phaseDeg(family: FilterType, f: number, fc: number, Q: number): number {
  if (family === 'lp') return -Math.atan(f / fc) * (180 / Math.PI)
  if (family === 'hp') return 90 - Math.atan(f / fc) * (180 / Math.PI)
  const x = f / fc - fc / f
  const qx = Q * x
  if (family === 'bp') return -Math.atan(qx) * (180 / Math.PI)
  // band-stop: H = jqx/(1 + jqx). re = qx²/(1+qx²), im = qx/(1+qx²)
  const denom = 1 + qx * qx
  const re = (qx * qx) / denom
  const im = qx / denom
  return Math.atan2(im, re) * (180 / Math.PI)
}

// ─── Axis mappings ──────────────────────────────────────────────────────
function fToX(f: number): number {
  const t = (Math.log10(f) - LOG_F_MIN) / (LOG_F_MAX - LOG_F_MIN)
  return BODE_X0 + t * BODE_W
}
function dbToY(db: number): number {
  const t = (db - DB_MIN) / (DB_MAX - DB_MIN)
  return BODE_Y1 - t * BODE_H
}
function phToY(deg: number): number {
  const t = (deg - PH_MIN) / (PH_MAX - PH_MIN)
  return PHASE_Y1 - t * PHASE_H
}

function bodePath(family: FilterType, fc: number, Q: number, samples = 240): string {
  let d = ''
  for (let i = 0; i <= samples; i++) {
    const t = i / samples
    const f = Math.pow(10, LOG_F_MIN + t * (LOG_F_MAX - LOG_F_MIN))
    const y = dbToY(magDb(family, f, fc, Q))
    d += (i === 0 ? 'M ' : 'L ') + `${fToX(f).toFixed(2)} ${y.toFixed(2)} `
  }
  return d
}

function phasePath(family: FilterType, fc: number, Q: number, samples = 240): string {
  let d = ''
  for (let i = 0; i <= samples; i++) {
    const t = i / samples
    const f = Math.pow(10, LOG_F_MIN + t * (LOG_F_MAX - LOG_F_MIN))
    const y = phToY(phaseDeg(family, f, fc, Q))
    d += (i === 0 ? 'M ' : 'L ') + `${fToX(f).toFixed(2)} ${y.toFixed(2)} `
  }
  return d
}

// ─── Formatters ─────────────────────────────────────────────────────────
function formatHz(f: number): string {
  if (f >= 1000) return `${(f / 1000).toFixed(f >= 10000 ? 0 : 1)} kHz`
  return `${f.toFixed(0)} Hz`
}
function formatOhm(r: number): string {
  if (r >= 1000) return `${(r / 1000).toFixed(r >= 10000 ? 0 : 2)} kΩ`
  return `${r.toFixed(0)} Ω`
}
function formatFarad(c: number): string {
  if (c >= 1e-6) return `${(c * 1e6).toFixed(c >= 1e-5 ? 1 : 2)} µF`
  if (c >= 1e-9) return `${(c * 1e9).toFixed(c >= 1e-8 ? 0 : 1)} nF`
  return `${(c * 1e12).toFixed(0)} pF`
}

// ─── i18n ───────────────────────────────────────────────────────────────
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
  const isObserve = stageIdx === 1
  const isExperiment = stageIdx === 2
  const isEvaluate = stageIdx === 3

  // ── Stage 1 state
  const [family1, setFamily1] = useState<FilterType>('lp')
  const [logFc1, setLogFc1] = useState<number>(Math.log10(1000))
  const [familiesSeen, setFamiliesSeen] = useState<Set<FilterType>>(new Set(['lp']))
  const fc1 = Math.pow(10, logFc1)

  useEffect(() => {
    if (!isObserve) return
    setFamiliesSeen((prev) => {
      if (prev.has(family1)) return prev
      const next = new Set(prev); next.add(family1); return next
    })
  }, [family1, isObserve])

  // ── Stage 2 state (RC low-pass build)
  const [logR, setLogR] = useState<number>(Math.log10(1000))    // 1 kΩ
  const [logC, setLogC] = useState<number>(Math.log10(100e-9))  // 100 nF
  const R = Math.pow(10, logR)
  const C = Math.pow(10, logC)
  const fc2 = 1 / (2 * Math.PI * R * C)
  const tau = R * C

  // ── Stage 3 state (ace-the-deck classification)
  const [deckOrder, setDeckOrder] = useState<number[]>(() =>
    rootRng.shuffle(STAGE3_PROBLEMS.map((_, i) => i)),
  )
  const [passIdx, setPassIdx] = useState(0)
  const [pick, setPick] = useState<FilterType | null>(null)
  const [showResult, setShowResult] = useState(false)
  const [wrongBanner, setWrongBanner] = useState(false)

  const currentProblem = STAGE3_PROBLEMS[deckOrder[passIdx]!]!
  const choicesShuffled = useMemo<FilterType[]>(
    () => rootRng.fork().shuffle([...FAMILIES]) as FilterType[],
    // reshuffle each question — passIdx and deckOrder are the deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rootRng, passIdx, deckOrder],
  )

  // Determine what family + fc drives the plot
  const plotFamily: FilterType = isObserve
    ? family1
    : isExperiment
      ? 'lp'
      : currentProblem.family
  const plotFc: number = isObserve
    ? fc1
    : isExperiment
      ? fc2
      : currentProblem.fc

  // ── SDK plumbing
  const setStage = useSetStage()
  const progress = useProgress()
  const complete = useComplete()

  const observeDone = familiesSeen.size >= 3
  const experimentDone = Math.abs(fc2 - STAGE2_FC_TARGET) / STAGE2_FC_TARGET < STAGE2_TOL
  const evaluateDone = passIdx >= STAGE3_PROBLEMS.length && !showResult
  const canSubmit = isObserve ? observeDone : isExperiment ? experimentDone : evaluateDone

  const reshuffleDeck = useCallback(() => {
    setDeckOrder(rootRng.fork().shuffle(STAGE3_PROBLEMS.map((_, i) => i)))
    setPassIdx(0); setPick(null); setShowResult(false); setWrongBanner(false)
  }, [rootRng])

  const handlePick = useCallback((choice: FilterType) => {
    if (showResult || pick !== null) return
    setPick(choice)
    setShowResult(true)
    if (choice === currentProblem.family) {
      setTimeout(() => {
        setPick(null); setShowResult(false)
        setPassIdx((n) => n + 1)
      }, 900)
    } else {
      setWrongBanner(true)
      setTimeout(() => {
        setWrongBanner(false)
        reshuffleDeck()
      }, 1400)
    }
  }, [showResult, pick, currentProblem, reshuffleDeck])

  const resetForStage = useCallback(() => {
    setFamily1('lp')
    setLogFc1(Math.log10(1000))
    setFamiliesSeen(new Set(['lp']))
    setLogR(Math.log10(1000))
    setLogC(Math.log10(100e-9))
    reshuffleDeck()
  }, [reshuffleDeck])

  useReset(() => resetForStage())

  useEffect(() => {
    progress(stageIdx / 3, { stage: stageIdx, canSubmit })
  }, [stageIdx, canSubmit, progress])

  useNext(() => {
    if (stageIdx < 3) {
      const next = stageIdx + 1
      setStage(next)
    } else {
      complete({ success: true })
    }
  })

  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  // ── Peek (stage 3 only)
  const peekIdxRef = useRef(0)
  const [peekTip, setPeekTip] = useState<string | null>(null)
  usePeek(() => {
    if (!isEvaluate) return
    const key = `peek_tip_${(peekIdxRef.current % 3) + 1}`
    setPeekTip(L(key))
    peekIdxRef.current += 1
  })
  useEffect(() => {
    if (!peekTip) return
    const t = setTimeout(() => setPeekTip(null), 4000)
    return () => clearTimeout(t)
  }, [peekTip])

  // ── HUD text
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${L('stage')} 0${stageIdx} · ${stageName}`
  const hudTR = isObserve
    ? `${L('families_seen')}: ${familiesSeen.size}/3`
    : isExperiment
      ? experimentDone
        ? `${L('matched')} ✓`
        : `${L('target_fc')}: ${STAGE2_FC_TARGET} Hz`
      : passIdx < STAGE3_PROBLEMS.length
        ? `${L('question')} ${passIdx + 1}/${STAGE3_PROBLEMS.length}`
        : `${L('all_correct')} ✓`
  const hudBL = isObserve ? L('tip1') : isExperiment ? L('tip2') : L('tip3')

  // Marker at (fc, magDb(fc)) — for LP/HP that is −3 dB; for BP the peak (0 dB);
  // for BS the notch trough. We compute the actual value analytically.
  const markerDb = magDb(plotFamily, plotFc, plotFc, Q_FIXED)
  const fcX = fToX(plotFc)
  const fcY = dbToY(markerDb)

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block', userSelect: 'none' }}
      >
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        {/* Schematic box */}
        <rect x={CIRC_X0} y={CIRC_Y0} width={CIRC_W} height={CIRC_H} fill="none" stroke="#12203a" strokeWidth={1} rx={6} />
        <text x={CIRC_X0 + 8} y={CIRC_Y0 - 10} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={11} letterSpacing="0.1em">
          {L('circuit_title')}
        </text>

        {isExperiment ? (
          <RCLowPassDiagram
            x0={CIRC_X0} y0={CIRC_Y0}
            w={CIRC_W} h={CIRC_H}
            R={R} C={C}
            hideValues={false}
            L={L}
          />
        ) : (
          <GenericTwoPort
            x0={CIRC_X0} y0={CIRC_Y0}
            w={CIRC_W} h={CIRC_H}
            family={plotFamily}
            hideValues={isEvaluate}
            L={L}
          />
        )}

        {/* Bode magnitude plot */}
        <rect x={BODE_X0} y={BODE_Y0} width={BODE_W} height={BODE_H} fill="none" stroke="#12203a" strokeWidth={1} rx={6} />
        <text x={BODE_X0 + 8} y={BODE_Y0 - 10} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={11} letterSpacing="0.1em">
          {L('bode_title')}
        </text>
        <text x={BODE_X0 - 6} y={BODE_Y0 - 2} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={10} textAnchor="end">
          |H| (dB)
        </text>

        {/* Y-axis dB gridlines */}
        {[10, 0, -10, -20, -30, -40, -50, -60].map((db) => {
          const y = dbToY(db)
          return (
            <g key={db}>
              <line x1={BODE_X0} y1={y} x2={BODE_X1} y2={y} stroke="#12203a" strokeWidth={1} strokeDasharray={db === 0 ? undefined : '2 4'} opacity={db === 0 ? 0.9 : 0.7} />
              <text x={BODE_X0 - 4} y={y + 3} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={9} textAnchor="end">
                {db}
              </text>
            </g>
          )
        })}

        {/* X-axis decade gridlines */}
        {[10, 100, 1000, 10000, 100000].map((f) => {
          const x = fToX(f)
          return (
            <g key={f}>
              <line x1={x} y1={BODE_Y0} x2={x} y2={BODE_Y1} stroke="#12203a" strokeWidth={1} strokeDasharray="2 4" />
              <text x={x} y={BODE_Y1 + 12} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={9} textAnchor="middle">
                {f >= 1000 ? `${f / 1000}k` : String(f)}
              </text>
            </g>
          )
        })}
        {/* Minor log gridlines */}
        {[10, 100, 1000, 10000].flatMap((base) =>
          [2, 3, 4, 5, 6, 7, 8, 9].map((k) => {
            const f = base * k
            if (f > F_MAX) return null
            const x = fToX(f)
            return (
              <line
                key={`${base}-${k}`}
                x1={x} y1={BODE_Y0} x2={x} y2={BODE_Y1}
                stroke="#12203a" strokeWidth={0.5} opacity={0.4}
              />
            )
          }),
        )}

        {/* -3 dB reference line */}
        <line
          x1={BODE_X0} y1={dbToY(-3)} x2={BODE_X1} y2={dbToY(-3)}
          stroke="#F9A968" strokeWidth={1} strokeDasharray="4 3" opacity={0.4}
        />
        <text x={BODE_X0 + 4} y={dbToY(-3) - 3} fill="#F9A968" fontFamily="'JetBrains Mono', monospace" fontSize={9} opacity={0.7}>
          −3 dB
        </text>

        {/* Stage-2 target guide */}
        {isExperiment && (() => {
          const tX = fToX(STAGE2_FC_TARGET)
          return (
            <g opacity={0.75}>
              <line x1={tX} y1={BODE_Y0} x2={tX} y2={BODE_Y1} stroke="#F9A968" strokeWidth={1.4} strokeDasharray="6 4" />
              <text x={tX + 4} y={BODE_Y0 + 12} fill="#F9A968" fontFamily="'JetBrains Mono', monospace" fontSize={10}>
                {L('target_fc')}: {STAGE2_FC_TARGET} Hz
              </text>
            </g>
          )
        })()}

        {/* Bode magnitude curve */}
        <path d={bodePath(plotFamily, plotFc, Q_FIXED)} fill="none" stroke="#F9A968" strokeWidth={2.5} strokeLinejoin="round" />

        {/* f_c / f_0 marker on magnitude */}
        <line x1={fcX} y1={BODE_Y0} x2={fcX} y2={BODE_Y1} stroke="#B87CE0" strokeWidth={1} strokeDasharray="3 3" opacity={0.7} />
        <circle cx={fcX} cy={fcY} r={5} fill="#B87CE0" stroke="#0D1524" strokeWidth={1.5} />
        <text
          x={Math.min(fcX + 6, BODE_X1 - 70)}
          y={fcY - 8}
          fill="#B87CE0"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={11}
          fontWeight={700}
        >
          {isEvaluate ? 'f_c = ?' : `f_c = ${formatHz(plotFc)}`}
        </text>

        {/* Phase plot */}
        <rect x={BODE_X0} y={PHASE_Y0} width={BODE_W} height={PHASE_H} fill="none" stroke="#12203a" strokeWidth={1} rx={6} />
        <text x={BODE_X0 + 8} y={PHASE_Y0 - 6} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={10} letterSpacing="0.1em">
          {L('phase_title')}
        </text>
        {/* 0° reference */}
        <line x1={BODE_X0} y1={phToY(0)} x2={BODE_X1} y2={phToY(0)} stroke="#12203a" strokeWidth={1} opacity={0.9} />
        <text x={BODE_X0 - 4} y={phToY(0) + 3} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={9} textAnchor="end">0</text>
        <text x={BODE_X0 - 4} y={phToY(90)  + 3} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={9} textAnchor="end">+90</text>
        <text x={BODE_X0 - 4} y={phToY(-90) + 3} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={9} textAnchor="end">−90</text>
        {/* decade gridlines carried down into the phase strip */}
        {[10, 100, 1000, 10000, 100000].map((f) => {
          const x = fToX(f)
          return (
            <line key={`ph-${f}`} x1={x} y1={PHASE_Y0} x2={x} y2={PHASE_Y1} stroke="#12203a" strokeWidth={1} strokeDasharray="2 4" />
          )
        })}
        <path d={phasePath(plotFamily, plotFc, Q_FIXED)} fill="none" stroke="#37C9B8" strokeWidth={2} strokeLinejoin="round" />
        {/* phase axis f-label (top-left of strip, avoids BR-reserved quadrant) */}
        <text x={BODE_X1 - 40} y={PHASE_Y0 - 6} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={10} textAnchor="end">
          f (Hz)
        </text>
      </svg>

      <div style={hudTLStyle}>{hudTL}</div>
      <div style={{ ...hudTRStyle, color: canSubmit ? '#37C9B8' : '#B9C4D6' }}>{hudTR}</div>
      <div style={hudBLStyle}>{hudBL}</div>

      {wrongBanner && (
        <div style={wrongBannerStyle}>{L('wrong_restart')}</div>
      )}
      {peekTip && (
        <div style={peekTipStyle}>{peekTip}</div>
      )}

      <div style={rightPanelWrapperStyle}>
        <div style={rightPanelTitleStyle}>{L('controls_title')}</div>
        <div style={rightPanelBoxStyle}>
          {isObserve && (
            <>
              <FieldGroup label={L('field_family')}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem' }}>
                  {FAMILIES.map((f) => {
                    const active = f === family1
                    return (
                      <button
                        key={f}
                        type="button"
                        onClick={() => setFamily1(f)}
                        style={{
                          padding: '0.6rem 0.4rem',
                          background: active ? '#F9A968' : 'transparent',
                          color: active ? '#0D1524' : '#B9C4D6',
                          border: `1px solid ${active ? '#F9A968' : '#3A4863'}`,
                          borderRadius: '0.4rem',
                          fontFamily: "'JetBrains Mono', monospace",
                          fontSize: '1.6rem',
                          fontWeight: 700,
                          cursor: 'pointer',
                          letterSpacing: '0.04em',
                        }}
                      >
                        {L(`family_${f}`)}
                      </button>
                    )
                  })}
                </div>
              </FieldGroup>

              <FieldGroup label={`${L('field_cutoff')}: ${formatHz(fc1)}`}>
                <NumberSlider
                  min={Math.log10(FC1_MIN)} max={Math.log10(FC1_MAX)}
                  step={0.05}
                  value={logFc1}
                  onChange={setLogFc1}
                />
              </FieldGroup>

              <div style={statusBoxStyle}>
                <div style={statusLabelStyle}>{L('field_derived')}</div>
                <div style={{ fontSize: '1.8rem', color: '#B9C4D6' }}>
                  H(jω) = <span style={{ color: '#F9A968', fontWeight: 700 }}>{L(`family_${family1}`)}</span>
                </div>
                <div style={{ fontSize: '1.6rem', color: '#54617A' }}>
                  {family1 === 'lp' || family1 === 'hp'
                    ? `f_c = ${formatHz(fc1)}`
                    : `f_0 = ${formatHz(fc1)}   Q = ${Q_FIXED}`}
                </div>
              </div>
            </>
          )}

          {isExperiment && (
            <>
              <FieldGroup label={`${L('field_R')}: ${formatOhm(R)}`}>
                <NumberSlider
                  min={Math.log10(R_MIN)} max={Math.log10(R_MAX)}
                  step={0.05}
                  value={logR}
                  onChange={setLogR}
                />
              </FieldGroup>
              <FieldGroup label={`${L('field_C')}: ${formatFarad(C)}`}>
                <NumberSlider
                  min={Math.log10(C_MIN)} max={Math.log10(C_MAX)}
                  step={0.05}
                  value={logC}
                  onChange={setLogC}
                />
              </FieldGroup>

              <div style={statusBoxStyle}>
                <div style={statusLabelStyle}>{L('field_derived')}</div>
                <div style={{ fontSize: '1.8rem', color: '#B9C4D6' }}>
                  f_c = <span style={{ color: '#B87CE0', fontWeight: 700 }}>{formatHz(fc2)}</span>
                </div>
                <div style={{ fontSize: '1.8rem', color: '#B9C4D6' }}>
                  τ = <span style={{ color: '#37C9B8', fontWeight: 700 }}>{(tau * 1000).toFixed(3)}</span> ms
                </div>
                {experimentDone && (
                  <div style={{ fontSize: '1.6rem', color: '#37C9B8', marginTop: '0.3rem' }}>
                    ✓ {L('matched')}
                  </div>
                )}
              </div>
            </>
          )}

          {isEvaluate && passIdx < STAGE3_PROBLEMS.length && (
            <>
              <div style={{ fontSize: '1.8rem', color: '#B9C4D6', lineHeight: 1.5 }}>
                {L('evaluate_prompt')}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                {choicesShuffled.map((choice) => {
                  const isPicked = pick === choice
                  const isCorrect = choice === currentProblem.family
                  const bg = showResult
                    ? isCorrect ? '#37C9B8'
                    : isPicked ? '#F97316'
                    : 'transparent'
                    : 'transparent'
                  const color = showResult && (isCorrect || isPicked) ? '#0D1524' : '#EAF0FA'
                  return (
                    <button
                      key={choice}
                      type="button"
                      disabled={showResult}
                      onClick={() => handlePick(choice)}
                      style={{
                        padding: '0.7rem 0.5rem',
                        background: bg,
                        color,
                        border: '1px solid #3A4863',
                        borderRadius: '0.4rem',
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: '1.7rem',
                        fontWeight: 700,
                        cursor: showResult ? 'default' : 'pointer',
                        letterSpacing: '0.04em',
                      }}
                    >
                      {L(`family_${choice}`)}
                    </button>
                  )
                })}
              </div>
              <div style={{ fontSize: '1.5rem', color: '#54617A' }}>
                Q {passIdx + 1}/{STAGE3_PROBLEMS.length}
              </div>
            </>
          )}
          {isEvaluate && passIdx >= STAGE3_PROBLEMS.length && (
            <div style={{ fontSize: '1.8rem', color: '#37C9B8' }}>✓ {L('all_correct')}</div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Schematics ─────────────────────────────────────────────────────────

// Generic 2-port with a "black box" and a small silhouette icon of |H|.
function GenericTwoPort({ x0, y0, w, h, family, hideValues, L }: {
  x0: number; y0: number; w: number; h: number
  family: FilterType
  hideValues: boolean
  L: (k: string) => string
}) {
  const inX  = x0 + 24
  const outX = x0 + w - 24
  const midX = (inX + outX) / 2
  const rowY = y0 + h / 2
  // Black-box footprint
  const bx0 = midX - 44, by0 = rowY - 34, bw = 88, bh = 68

  // Silhouette curve inside the box that hints at the family shape.
  // Coordinates are relative to the box: draw a simplified |H|(f) sketch.
  const s = 8  // margin
  const cx0 = bx0 + s
  const cx1 = bx0 + bw - s
  const cy0 = by0 + s
  const cy1 = by0 + bh - s
  const cw = cx1 - cx0
  const ch = cy1 - cy0
  const flatY  = cy0 + ch * 0.35
  const dropY  = cy0 + ch * 0.9
  let iconPath = ''
  if (family === 'lp') {
    iconPath = `M ${cx0} ${flatY} L ${cx0 + cw * 0.5} ${flatY} Q ${cx0 + cw * 0.65} ${flatY} ${cx1} ${dropY}`
  } else if (family === 'hp') {
    iconPath = `M ${cx0} ${dropY} Q ${cx0 + cw * 0.35} ${flatY} ${cx0 + cw * 0.5} ${flatY} L ${cx1} ${flatY}`
  } else if (family === 'bp') {
    iconPath = `M ${cx0} ${dropY} Q ${cx0 + cw * 0.3} ${flatY - ch * 0.15} ${midX} ${cy0 + ch * 0.15} Q ${cx1 - cw * 0.3} ${flatY - ch * 0.15} ${cx1} ${dropY}`
  } else {
    // bs — flat, notch down, flat
    iconPath = `M ${cx0} ${flatY} L ${cx0 + cw * 0.32} ${flatY} Q ${midX} ${cy1} ${cx1 - cw * 0.32} ${flatY} L ${cx1} ${flatY}`
  }

  return (
    <g>
      {/* input node */}
      <text x={inX} y={rowY - 16} fill="#54617A" fontFamily="'JetBrains Mono', monospace" fontSize={10} textAnchor="middle">
        {L('v_in')}
      </text>
      <circle cx={inX} cy={rowY} r={3} fill="#B9C4D6" />
      <line x1={inX} y1={rowY} x2={bx0} y2={rowY} stroke="#B9C4D6" strokeWidth={1.5} />

      {/* black box */}
      <rect x={bx0} y={by0} width={bw} height={bh} fill="#0D1524" stroke="#B9C4D6" strokeWidth={1.5} rx={4} />
      <path d={iconPath} fill="none" stroke="#F9A968" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" opacity={0.85} />
      <text x={midX} y={by0 - 6} fill="#37C9B8" fontFamily="'JetBrains Mono', monospace" fontSize={11} fontWeight={700} textAnchor="middle">
        {hideValues ? 'H(jω) = ?' : `H(jω)`}
      </text>
      <text x={midX} y={by0 + bh + 14} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={10} textAnchor="middle">
        {hideValues ? '?' : L(`family_${family}`)}
      </text>

      {/* output node */}
      <line x1={bx0 + bw} y1={rowY} x2={outX} y2={rowY} stroke="#B9C4D6" strokeWidth={1.5} />
      <circle cx={outX} cy={rowY} r={3} fill="#B9C4D6" />
      <text x={outX} y={rowY - 16} fill="#54617A" fontFamily="'JetBrains Mono', monospace" fontSize={10} textAnchor="middle">
        {L('v_out')}
      </text>

      {/* ground rail */}
      <line x1={inX}  y1={rowY} x2={inX}  y2={rowY + 60} stroke="#B9C4D6" strokeWidth={1.5} />
      <line x1={outX} y1={rowY} x2={outX} y2={rowY + 60} stroke="#B9C4D6" strokeWidth={1.5} />
      <line x1={inX}  y1={rowY + 60} x2={outX} y2={rowY + 60} stroke="#B9C4D6" strokeWidth={1.5} />
      <line x1={midX} y1={rowY + 60} x2={midX} y2={rowY + 68} stroke="#B9C4D6" strokeWidth={1.5} />
      <line x1={midX - 12} y1={rowY + 68} x2={midX + 12} y2={rowY + 68} stroke="#B9C4D6" strokeWidth={2} />
      <line x1={midX - 8}  y1={rowY + 72} x2={midX + 8}  y2={rowY + 72} stroke="#B9C4D6" strokeWidth={1.5} />
      <line x1={midX - 4}  y1={rowY + 76} x2={midX + 4}  y2={rowY + 76} stroke="#B9C4D6" strokeWidth={1.5} />
    </g>
  )
}

// Concrete RC low-pass — used in stage 2.
function RCLowPassDiagram({ x0, y0, w, h, R, C, hideValues, L }: {
  x0: number; y0: number; w: number; h: number
  R: number; C: number
  hideValues: boolean
  L: (k: string) => string
}) {
  const inX = x0 + 30
  const outX = x0 + w - 30
  const topY = y0 + 50
  const botY = y0 + h - 50
  const midX = (inX + outX) / 2
  const rL = 60
  const rX0 = midX - rL / 2
  const rX1 = midX + rL / 2
  const rY = topY
  const capX = outX
  const capTop = topY + 20
  const capBot = capTop + 30
  const capW = 20

  return (
    <g>
      <text x={inX} y={topY - 12} fill="#54617A" fontFamily="'JetBrains Mono', monospace" fontSize={10} textAnchor="middle">
        {L('v_in')}
      </text>
      <circle cx={inX} cy={topY} r={3} fill="#B9C4D6" />
      <line x1={inX} y1={topY} x2={rX0} y2={topY} stroke="#B9C4D6" strokeWidth={1.5} />
      <polyline
        points={[
          [rX0, rY], [rX0 + 6, rY - 8], [rX0 + 18, rY + 8],
          [rX0 + 30, rY - 8], [rX0 + 42, rY + 8], [rX0 + 54, rY - 8],
          [rX1, rY],
        ].map((p) => p.join(',')).join(' ')}
        fill="none" stroke="#B9C4D6" strokeWidth={1.5}
      />
      <text x={midX} y={rY - 16} fill="#37C9B8" fontFamily="'JetBrains Mono', monospace" fontSize={11} fontWeight={700} textAnchor="middle">
        R{hideValues ? '' : ` = ${formatOhm(R)}`}
      </text>
      <line x1={rX1} y1={topY} x2={capX} y2={topY} stroke="#B9C4D6" strokeWidth={1.5} />
      <line x1={capX} y1={topY} x2={capX} y2={capTop} stroke="#B9C4D6" strokeWidth={1.5} />
      <circle cx={outX + 20} cy={topY} r={3} fill="#B9C4D6" />
      <line x1={capX} y1={topY} x2={outX + 20} y2={topY} stroke="#B9C4D6" strokeWidth={1.5} />
      <text x={outX + 30} y={topY - 4} fill="#54617A" fontFamily="'JetBrains Mono', monospace" fontSize={10}>
        {L('v_out')}
      </text>
      <line x1={capX - capW / 2} y1={capTop} x2={capX + capW / 2} y2={capTop} stroke="#B9C4D6" strokeWidth={2} />
      <line x1={capX - capW / 2} y1={capBot - 8} x2={capX + capW / 2} y2={capBot - 8} stroke="#B9C4D6" strokeWidth={2} />
      <line x1={capX} y1={capBot - 8} x2={capX} y2={botY} stroke="#B9C4D6" strokeWidth={1.5} />
      <text x={capX + 16} y={(capTop + capBot) / 2} fill="#F9A968" fontFamily="'JetBrains Mono', monospace" fontSize={11} fontWeight={700}>
        C{hideValues ? '' : ` = ${formatFarad(C)}`}
      </text>
      <line x1={inX} y1={topY} x2={inX} y2={botY} stroke="#B9C4D6" strokeWidth={1.5} />
      <line x1={inX} y1={botY} x2={capX} y2={botY} stroke="#B9C4D6" strokeWidth={1.5} />
      <line x1={midX} y1={botY} x2={midX} y2={botY + 10} stroke="#B9C4D6" strokeWidth={1.5} />
      <line x1={midX - 12} y1={botY + 10} x2={midX + 12} y2={botY + 10} stroke="#B9C4D6" strokeWidth={2} />
      <line x1={midX - 8}  y1={botY + 14} x2={midX + 8}  y2={botY + 14} stroke="#B9C4D6" strokeWidth={1.5} />
      <line x1={midX - 4}  y1={botY + 18} x2={midX + 4}  y2={botY + 18} stroke="#B9C4D6" strokeWidth={1.5} />
    </g>
  )
}

// ─── Reusable widgets ───────────────────────────────────────────────────
function NumberSlider({ min, max, step, value, onChange, disabled }: {
  min: number; max: number; step: number
  value: number
  onChange: (v: number) => void
  disabled?: boolean
}) {
  const bump = (delta: number) => onChange(Math.min(max, Math.max(min, +(value + delta).toFixed(3))))
  return (
    <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', width: '100%', minWidth: 0 }}>
      <button type="button" onClick={() => bump(-step)} disabled={disabled || value <= min} style={sliderBtnStyle}>−</button>
      <input
        type="range"
        min={min} max={max} step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        disabled={disabled}
        style={{ flex: 1, minWidth: 0, width: 0, accentColor: '#F9A968' }}
      />
      <button type="button" onClick={() => bump(step)} disabled={disabled || value >= max} style={sliderBtnStyle}>+</button>
    </div>
  )
}

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
      <div style={{ fontSize: '1.5rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: '#54617A' }}>{label}</div>
      {children}
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
  top: '13.7rem', bottom: '13.3rem',
  right: '6.7rem',
  width: '33rem',
  boxSizing: 'border-box',
  zIndex: 6,
  color: '#B9C4D6',
  fontFamily: "'JetBrains Mono', monospace",
  display: 'flex', flexDirection: 'column',
}
const rightPanelTitleStyle: React.CSSProperties = {
  fontSize: '2.44rem',
  color: '#6C7A93', letterSpacing: '0.1em',
  marginBottom: '1.2rem', marginLeft: '0.4rem',
}
const rightPanelBoxStyle: React.CSSProperties = {
  flex: 1,
  border: '1px solid #12203a', borderRadius: '0.6rem',
  padding: '2.5rem',
  display: 'flex', flexDirection: 'column', gap: '2.5rem',
  fontSize: '2rem',
  overflow: 'auto',
}
const statusBoxStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: '0.6rem',
  padding: '1rem 1.2rem',
  border: '1px solid #12203a', borderRadius: '0.6rem',
}
const statusLabelStyle: React.CSSProperties = {
  fontSize: '1.5rem', color: '#54617A',
  letterSpacing: '0.1em', textTransform: 'uppercase',
}
const sliderBtnStyle: React.CSSProperties = {
  width: '3.2rem', height: '3.2rem',
  background: 'transparent',
  color: '#B9C4D6',
  border: '1px solid #3A4863',
  borderRadius: '0.5rem',
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: '2rem',
  cursor: 'pointer',
}
const wrongBannerStyle: React.CSSProperties = {
  position: 'absolute', top: '50%', left: '50%',
  transform: 'translate(-50%, -50%)',
  padding: '1.5rem 3rem', background: '#F97316', color: '#0D1524',
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: '2.5rem', fontWeight: 700, letterSpacing: '0.08em',
  borderRadius: '0.8rem', zIndex: 20, pointerEvents: 'none',
}
const peekTipStyle: React.CSSProperties = {
  position: 'absolute',
  top: '9rem', left: '3rem',
  maxWidth: '54%',
  padding: '1rem 1.4rem',
  background: 'rgba(184, 124, 224, 0.14)',
  border: '1px solid #B87CE0',
  borderRadius: '0.5rem',
  color: '#B87CE0',
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: '1.9rem',
  letterSpacing: '0.04em',
  lineHeight: 1.4,
  zIndex: 12,
  pointerEvents: 'none',
}
