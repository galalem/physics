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

// Circuit box
const CIRC_X0 = 40, CIRC_Y0 = 90, CIRC_W = 240, CIRC_H = 220

// Bode magnitude plot area
const BODE_X0 = 310, BODE_Y0 = 80
const BODE_W = 290, BODE_H = 210
const BODE_X1 = BODE_X0 + BODE_W
const BODE_Y1 = BODE_Y0 + BODE_H

// Phase plot area (band-pass includes phase per §5.4)
const PHASE_X0 = BODE_X0, PHASE_Y0 = 310
const PHASE_W = BODE_W, PHASE_H = 80
const PHASE_X1 = PHASE_X0 + PHASE_W
const PHASE_Y1 = PHASE_Y0 + PHASE_H

// Frequency axis (log10): 10 Hz → 100 kHz (4 decades)
const F_MIN = 10
const F_MAX = 100000
const LOG_F_MIN = Math.log10(F_MIN)
const LOG_F_MAX = Math.log10(F_MAX)

// Magnitude axis: -60 dB → +10 dB
const DB_MIN = -60
const DB_MAX = 10

// Phase axis: −90° → +90°
const PH_MIN = -90
const PH_MAX = 90

// Component ranges (log)
const R_MIN = 1        // Ω
const R_MAX = 1000     // 1 kΩ
const L_MIN = 1e-5     // 10 µH
const L_MAX = 1        // 1 H
const C_MIN = 1e-9     // 1 nF
const C_MAX = 1e-4     // 100 µF

// Stage 2 target — audio-band centre
const STAGE2_F0_TARGET = 2000 // Hz
const STAGE2_TOL = 0.06       // ±6%

// Stage 3 problems: each (f_0, Q, choices). Q drives curve sharpness.
type Problem = { f0: number; Q: number; choices: number[] }
const STAGE3_PROBLEMS: Problem[] = [
  { f0: 100,   Q: 5, choices: [30, 100, 300, 1000] },
  { f0: 1000,  Q: 3, choices: [100, 300, 1000, 3000] },
  { f0: 10000, Q: 8, choices: [1000, 3000, 10000, 30000] },
  { f0: 316,   Q: 6, choices: [100, 316, 1000, 3162] },
]

// ─── Helpers ────────────────────────────────────────────────────────────
function f0From(L: number, C: number): number {
  return 1 / (2 * Math.PI * Math.sqrt(L * C))
}
function qFrom(R: number, L: number, f0: number): number {
  return (2 * Math.PI * f0 * L) / R
}
function magDb(f: number, f0: number, Q: number): number {
  const d = Q * (f / f0 - f0 / f)
  return -10 * Math.log10(1 + d * d)
}
function phaseDeg(f: number, f0: number, Q: number): number {
  return -Math.atan(Q * (f / f0 - f0 / f)) * (180 / Math.PI)
}

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

function bodePath(f0: number, Q: number, samples = 260): string {
  let d = ''
  for (let i = 0; i <= samples; i++) {
    const t = i / samples
    const f = Math.pow(10, LOG_F_MIN + t * (LOG_F_MAX - LOG_F_MIN))
    const y = dbToY(magDb(f, f0, Q))
    d += (i === 0 ? 'M ' : 'L ') + `${fToX(f).toFixed(2)} ${y.toFixed(2)} `
  }
  return d
}

function phasePath(f0: number, Q: number, samples = 260): string {
  let d = ''
  for (let i = 0; i <= samples; i++) {
    const t = i / samples
    const f = Math.pow(10, LOG_F_MIN + t * (LOG_F_MAX - LOG_F_MIN))
    const y = phToY(phaseDeg(f, f0, Q))
    d += (i === 0 ? 'M ' : 'L ') + `${fToX(f).toFixed(2)} ${y.toFixed(2)} `
  }
  return d
}

// Exact bandwidth crossings (where magnitude = −3 dB): solve
// Q(f/f0 − f0/f) = ±1 → f² ∓ (f0/Q)f − f0² = 0
function bandwidth(f0: number, Q: number): { fL: number; fH: number } {
  const a = f0 / Q
  const disc = Math.sqrt(a * a + 4 * f0 * f0)
  const fH = (a + disc) / 2
  const fL = (-a + disc) / 2
  return { fL, fH }
}

function formatHz(f: number): string {
  if (f >= 1000) return `${(f / 1000).toFixed(f >= 10000 ? 0 : 1)} kHz`
  return `${f.toFixed(0)} Hz`
}

function formatOhm(r: number): string {
  if (r >= 1000) return `${(r / 1000).toFixed(r >= 10000 ? 0 : 2)} kΩ`
  if (r >= 1) return `${r.toFixed(r >= 10 ? 0 : 1)} Ω`
  return `${r.toFixed(2)} Ω`
}

function formatHenry(l: number): string {
  if (l >= 1) return `${l.toFixed(2)} H`
  if (l >= 1e-3) return `${(l * 1e3).toFixed(l >= 1e-2 ? 1 : 2)} mH`
  if (l >= 1e-6) return `${(l * 1e6).toFixed(l >= 1e-5 ? 0 : 1)} µH`
  return `${(l * 1e9).toFixed(0)} nH`
}

function formatFarad(c: number): string {
  if (c >= 1e-6) return `${(c * 1e6).toFixed(c >= 1e-5 ? 1 : 2)} µF`
  if (c >= 1e-9) return `${(c * 1e9).toFixed(c >= 1e-8 ? 0 : 1)} nF`
  return `${(c * 1e12).toFixed(0)} pF`
}

function formatQ(q: number): string {
  if (q >= 100) return q.toFixed(0)
  if (q >= 10) return q.toFixed(1)
  return q.toFixed(2)
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

  // Component state (log-scale sliders)
  const [logR, setLogR] = useState<number>(Math.log10(100))    // 100 Ω
  const [logL, setLogL] = useState<number>(Math.log10(10e-3))  // 10 mH
  const [logC, setLogC] = useState<number>(Math.log10(100e-9)) // 100 nF

  const R = Math.pow(10, logR)
  const Lval = Math.pow(10, logL)
  const C = Math.pow(10, logC)
  const f0 = f0From(Lval, C)
  const Q = qFrom(R, Lval, f0)
  const deltaF = f0 / Q

  const [f0Seen, setF0Seen] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!isObserve) return
    const bucket = Math.round(Math.log10(f0) * 3)
    setF0Seen((prev) => {
      const key = String(bucket)
      if (prev.has(key)) return prev
      const next = new Set(prev)
      next.add(key)
      return next
    })
  }, [isObserve, f0])

  // Stage 3 ace-the-deck state
  const [deckOrder, setDeckOrder] = useState<number[]>(() =>
    rootRng.shuffle(STAGE3_PROBLEMS.map((_, i) => i)),
  )
  const [passIdx, setPassIdx] = useState(0)
  const [pick, setPick] = useState<number | null>(null)
  const [showResult, setShowResult] = useState(false)
  const [wrongBanner, setWrongBanner] = useState(false)

  const currentProblem = STAGE3_PROBLEMS[deckOrder[passIdx] ?? 0]!
  const choicesShuffled = useMemo(
    () => rootRng.fork().shuffle(currentProblem.choices),
    [rootRng, currentProblem],
  )

  const setStage = useSetStage()
  const progress = useProgress()
  const complete = useComplete()

  const reshuffleDeck = useCallback(() => {
    setDeckOrder(rootRng.fork().shuffle(STAGE3_PROBLEMS.map((_, i) => i)))
    setPassIdx(0)
    setPick(null)
    setShowResult(false)
    setWrongBanner(false)
  }, [rootRng])

  const handlePick = useCallback(
    (choice: number) => {
      if (showResult || pick !== null) return
      setPick(choice)
      setShowResult(true)
      if (choice === currentProblem.f0) {
        setTimeout(() => {
          setPick(null)
          setShowResult(false)
          setPassIdx((n) => n + 1)
        }, 900)
      } else {
        setWrongBanner(true)
        setTimeout(() => {
          setWrongBanner(false)
          reshuffleDeck()
        }, 1400)
      }
    },
    [showResult, pick, currentProblem, reshuffleDeck],
  )

  // Advance criteria
  const observeDone = f0Seen.size >= 3
  const experimentDone =
    Math.abs(f0 - STAGE2_F0_TARGET) / STAGE2_F0_TARGET < STAGE2_TOL
  const evaluateDone = passIdx >= STAGE3_PROBLEMS.length && !showResult
  const canSubmit = isObserve
    ? observeDone
    : isExperiment
      ? experimentDone
      : evaluateDone

  const resetForStage = useCallback(() => {
    setLogR(Math.log10(100))
    setLogL(Math.log10(10e-3))
    setLogC(Math.log10(100e-9))
    setF0Seen(new Set())
    reshuffleDeck()
  }, [reshuffleDeck])

  useReset(() => resetForStage())

  useEffect(() => {
    progress(stageIdx / 3, { stage: stageIdx, canSubmit })
  }, [stageIdx, canSubmit, progress])

  useNext(() => {
    if (stageIdx < 3) {
      setStage(stageIdx + 1)
      resetForStage()
    } else {
      complete({ success: true })
    }
  })

  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  // Peek — strategy hints, cycling
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

  // Which (f_0, Q) drives the plot in each stage
  const plotF0 = isEvaluate ? currentProblem.f0 : f0
  const plotQ = isEvaluate ? currentProblem.Q : Q

  // HUD text
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${L('stage')} 0${stageIdx} · ${stageName}`
  const hudTR = isObserve
    ? `${L('regions')}: ${f0Seen.size}/3`
    : isExperiment
      ? experimentDone
        ? `${L('matched')} ✓`
        : `${L('target')}: f_0 = ${STAGE2_F0_TARGET} Hz`
      : `${L('question')} ${Math.min(passIdx + 1, STAGE3_PROBLEMS.length)}/${STAGE3_PROBLEMS.length}`
  const hudBL = isObserve ? L('tip1') : isExperiment ? L('tip2') : L('tip3')

  // Peak marker at (f_0, 0 dB)
  const fcX = fToX(plotF0)
  const fcY = dbToY(0)
  const { fL, fH } = bandwidth(plotF0, plotQ)
  const showBandwidthMarks = fL >= F_MIN && fH <= F_MAX

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block', userSelect: 'none' }}
      >
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        {/* Circuit box */}
        <rect x={CIRC_X0} y={CIRC_Y0} width={CIRC_W} height={CIRC_H} fill="none" stroke="#12203a" strokeWidth={1} rx={6} />
        <text x={CIRC_X0 + 8} y={CIRC_Y0 - 10} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={11} letterSpacing="0.1em">
          {L('circuit_title')}
        </text>

        <CircuitDiagram
          x0={CIRC_X0} y0={CIRC_Y0}
          w={CIRC_W} h={CIRC_H}
          R={R} Lval={Lval} C={C}
          hideValues={isEvaluate}
          label={L}
        />

        {/* Bode plot box */}
        <rect x={BODE_X0} y={BODE_Y0} width={BODE_W} height={BODE_H} fill="none" stroke="#12203a" strokeWidth={1} rx={6} />
        <text x={BODE_X0 + 8} y={BODE_Y0 - 10} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={11} letterSpacing="0.1em">
          {L('bode_title')}
        </text>
        <text x={BODE_X0 - 6} y={BODE_Y0 - 2} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={10} textAnchor="end">
          |H| (dB)
        </text>

        {/* Magnitude Y-axis gridlines */}
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

        {/* Magnitude X-axis decade gridlines (no tick labels here — phase plot below carries them) */}
        {[10, 100, 1000, 10000, 100000].map((f) => {
          const x = fToX(f)
          return (
            <line key={f} x1={x} y1={BODE_Y0} x2={x} y2={BODE_Y1} stroke="#12203a" strokeWidth={1} strokeDasharray="2 4" />
          )
        })}
        {[10, 100, 1000, 10000].flatMap((base) =>
          [2, 3, 4, 5, 6, 7, 8, 9].map((k) => {
            const f = base * k
            if (f > F_MAX) return null
            const x = fToX(f)
            return (
              <line
                key={`m-${base}-${k}`}
                x1={x} y1={BODE_Y0} x2={x} y2={BODE_Y1}
                stroke="#12203a" strokeWidth={0.5} opacity={0.4}
              />
            )
          }),
        )}

        {/* −3 dB reference line + label */}
        <line
          x1={BODE_X0} y1={dbToY(-3)} x2={BODE_X1} y2={dbToY(-3)}
          stroke="#F9A968" strokeWidth={1} strokeDasharray="4 3" opacity={0.4}
        />
        <text x={BODE_X0 + 4} y={dbToY(-3) - 3} fill="#F9A968" fontFamily="'JetBrains Mono', monospace" fontSize={9} opacity={0.7}>
          −3 dB
        </text>

        {/* Bandwidth crossings: f_L and f_H — required info (visible in all stages) */}
        {showBandwidthMarks && (() => {
          const xL = fToX(fL)
          const xH = fToX(fH)
          return (
            <g opacity={0.65}>
              <line x1={xL} y1={dbToY(-3)} x2={xL} y2={BODE_Y1} stroke="#F9A968" strokeWidth={0.9} strokeDasharray="2 3" />
              <line x1={xH} y1={dbToY(-3)} x2={xH} y2={BODE_Y1} stroke="#F9A968" strokeWidth={0.9} strokeDasharray="2 3" />
              <circle cx={xL} cy={dbToY(-3)} r={2.5} fill="#F9A968" />
              <circle cx={xH} cy={dbToY(-3)} r={2.5} fill="#F9A968" />
            </g>
          )
        })()}

        {/* Stage 2 target f_0 vertical guide */}
        {isExperiment && (() => {
          const tX = fToX(STAGE2_F0_TARGET)
          return (
            <g opacity={0.85}>
              <line x1={tX} y1={BODE_Y0} x2={tX} y2={PHASE_Y1} stroke="#F9A968" strokeWidth={1.4} strokeDasharray="6 4" />
              <text x={tX + 4} y={BODE_Y0 + 12} fill="#F9A968" fontFamily="'JetBrains Mono', monospace" fontSize={10}>
                {L('target_f0')}: {STAGE2_F0_TARGET} Hz
              </text>
            </g>
          )
        })()}

        {/* Magnitude Bode curve */}
        <path d={bodePath(plotF0, plotQ)} fill="none" stroke="#F9A968" strokeWidth={2.5} strokeLinejoin="round" />

        {/* f_0 marker on magnitude plot */}
        <line x1={fcX} y1={BODE_Y0} x2={fcX} y2={PHASE_Y1} stroke="#B87CE0" strokeWidth={1} strokeDasharray="3 3" opacity={0.7} />
        <circle cx={fcX} cy={fcY} r={5} fill="#B87CE0" stroke="#0D1524" strokeWidth={1.5} />
        <text
          x={Math.min(fcX + 6, BODE_X1 - 60)}
          y={fcY - 8}
          fill="#B87CE0"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={11}
          fontWeight={700}
        >
          {isEvaluate ? 'f_0 = ?' : `f_0 = ${formatHz(plotF0)}`}
        </text>

        {/* ─── Phase plot ─── */}
        <rect x={PHASE_X0} y={PHASE_Y0} width={PHASE_W} height={PHASE_H} fill="none" stroke="#12203a" strokeWidth={1} rx={6} />
        <text x={PHASE_X0 + 8} y={PHASE_Y0 - 6} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={10} letterSpacing="0.1em">
          {L('phase_title')}
        </text>
        <text x={PHASE_X0 - 6} y={PHASE_Y0 + 8} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={9} textAnchor="end">
          °
        </text>

        {/* Phase Y-axis gridlines */}
        {[-90, -45, 0, 45, 90].map((deg) => {
          const y = phToY(deg)
          return (
            <g key={`ph-${deg}`}>
              <line
                x1={PHASE_X0} y1={y} x2={PHASE_X1} y2={y}
                stroke="#12203a" strokeWidth={1}
                strokeDasharray={deg === 0 ? undefined : '2 4'}
                opacity={deg === 0 ? 0.9 : 0.6}
              />
              <text x={PHASE_X0 - 4} y={y + 3} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={9} textAnchor="end">
                {deg > 0 ? `+${deg}` : deg}
              </text>
            </g>
          )
        })}

        {/* Phase X-axis: decade lines + tick labels (single row for whole plot column) */}
        {[10, 100, 1000, 10000, 100000].map((f) => {
          const x = fToX(f)
          return (
            <g key={`phx-${f}`}>
              <line x1={x} y1={PHASE_Y0} x2={x} y2={PHASE_Y1} stroke="#12203a" strokeWidth={1} strokeDasharray="2 4" />
              <text x={x} y={PHASE_Y1 + 12} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={9} textAnchor="middle">
                {f >= 1000 ? `${f / 1000}k` : String(f)}
              </text>
            </g>
          )
        })}
        {[10, 100, 1000, 10000].flatMap((base) =>
          [2, 3, 4, 5, 6, 7, 8, 9].map((k) => {
            const f = base * k
            if (f > F_MAX) return null
            const x = fToX(f)
            return (
              <line
                key={`phm-${base}-${k}`}
                x1={x} y1={PHASE_Y0} x2={x} y2={PHASE_Y1}
                stroke="#12203a" strokeWidth={0.5} opacity={0.4}
              />
            )
          }),
        )}
        <text x={PHASE_X1 - 24} y={PHASE_Y1 + 12} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={10} textAnchor="end">
          f (Hz)
        </text>

        {/* Phase curve */}
        <path d={phasePath(plotF0, plotQ)} fill="none" stroke="#37C9B8" strokeWidth={2} strokeLinejoin="round" />

        {/* Phase = 0 cross-hair at f_0 */}
        <circle cx={fcX} cy={phToY(0)} r={3.5} fill="#B87CE0" stroke="#0D1524" strokeWidth={1.2} />
      </svg>

      {/* Wrong-answer restart banner (ace-the-deck) */}
      {wrongBanner && (
        <div style={wrongBannerStyle}>{L('wrong_restart')}</div>
      )}

      {/* Peek tip (auto-dismisses after 4s) */}
      {peekTip && (
        <div style={peekTipStyle}>{peekTip}</div>
      )}

      <div style={hudTLStyle}>{hudTL}</div>
      <div style={{ ...hudTRStyle, color: canSubmit ? '#37C9B8' : '#B9C4D6' }}>{hudTR}</div>
      <div style={hudBLStyle}>{hudBL}</div>

      <div style={rightPanelWrapperStyle}>
        <div style={rightPanelTitleStyle}>{L('controls_title')}</div>
        <div style={rightPanelBoxStyle}>
          {!isEvaluate && (
            <>
              <FieldGroup label={`${L('field_R')}: ${formatOhm(R)}`}>
                <NumberSlider
                  min={Math.log10(R_MIN)} max={Math.log10(R_MAX)}
                  step={0.05}
                  value={logR}
                  onChange={setLogR}
                />
              </FieldGroup>

              <FieldGroup label={`${L('field_L')}: ${formatHenry(Lval)}`}>
                <NumberSlider
                  min={Math.log10(L_MIN)} max={Math.log10(L_MAX)}
                  step={0.05}
                  value={logL}
                  onChange={setLogL}
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
                <div style={{ fontSize: '1.7rem', color: '#B9C4D6' }}>
                  f_0 = <span style={{ color: '#B87CE0', fontWeight: 700 }}>{formatHz(f0)}</span>
                </div>
                <div style={{ fontSize: '1.7rem', color: '#B9C4D6' }}>
                  Q = <span style={{ color: '#37C9B8', fontWeight: 700 }}>{formatQ(Q)}</span>
                </div>
                <div style={{ fontSize: '1.7rem', color: '#B9C4D6' }}>
                  Δf = <span style={{ color: '#F9A968', fontWeight: 700 }}>{formatHz(deltaF)}</span>
                </div>
                {isExperiment && experimentDone && (
                  <div style={{ fontSize: '1.5rem', color: '#37C9B8', marginTop: '0.3rem' }}>
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
                  const isCorrect = choice === currentProblem.f0
                  const bg = showResult
                    ? isCorrect ? '#37C9B8' : isPicked ? '#F97316' : 'transparent'
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
                      }}
                    >
                      {formatHz(choice)}
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
            <div style={{ fontSize: '1.8rem', color: '#37C9B8' }}>
              ✓ {L('all_correct')}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Sub-components ─────────────────────────────────────────────────────
function CircuitDiagram({ x0, y0, w, h, R, Lval, C, hideValues, label: T }: {
  x0: number; y0: number; w: number; h: number
  R: number; Lval: number; C: number
  hideValues: boolean
  label: (k: string) => string
}) {
  // Series R-L-C loop. Output measured across R.
  //
  //  Vin+ ●──[L]──[C]──●──[R]──● Vin-
  //   │                        │
  //   └────────────────────────┘  (ground rail)
  //   Vout+ = tap between C and R.  Vout- = ground.

  const inX = x0 + 26
  const outX = x0 + w - 26
  const topY = y0 + 60
  const botY = y0 + h - 45

  // Divide top rail into 3 segments: L | C | R
  const railLen = outX - inX
  const seg = railLen / 3
  const lX0 = inX + 12
  const lX1 = lX0 + seg - 24
  const cX0 = inX + seg + 12
  const cX1 = cX0 + seg - 24
  const rX0 = inX + 2 * seg + 12
  const rX1 = rX0 + seg - 24

  // Tap between C and R (top-of-R)
  const tapX = (cX1 + rX0) / 2

  // Inductor: 4 half-circle bumps
  const lMidY = topY
  const lBumps = 4
  const lStep = (lX1 - lX0) / lBumps
  const lArcs: string[] = []
  for (let i = 0; i < lBumps; i++) {
    const xa = lX0 + i * lStep
    const xb = xa + lStep
    // arc from xa,lMidY up to xb,lMidY
    lArcs.push(`M ${xa} ${lMidY} A ${lStep / 2} ${lStep / 2} 0 0 1 ${xb} ${lMidY}`)
  }

  // Capacitor plates (vertical bars along horizontal rail)
  const cMidX = (cX0 + cX1) / 2
  const cGap = 6

  // Resistor zigzag
  const rMidY = topY
  const rSteps = 6
  const rDx = (rX1 - rX0) / rSteps
  const rPts: [number, number][] = [[rX0, rMidY]]
  for (let i = 0; i < rSteps; i++) {
    const xa = rX0 + i * rDx
    const yUp = i % 2 === 0 ? rMidY - 7 : rMidY + 7
    rPts.push([xa + rDx / 2, yUp])
  }
  rPts.push([rX1, rMidY])

  return (
    <g>
      {/* Input node */}
      <text x={inX - 4} y={topY - 12} fill="#54617A" fontFamily="'JetBrains Mono', monospace" fontSize={10} textAnchor="middle">
        {T('v_in')}
      </text>
      <circle cx={inX} cy={topY} r={3} fill="#B9C4D6" />

      {/* Segments of top rail (skinny wires between components) */}
      <line x1={inX} y1={topY} x2={lX0} y2={topY} stroke="#B9C4D6" strokeWidth={1.5} />
      {/* Inductor bumps */}
      {lArcs.map((d, i) => (
        <path key={`larc-${i}`} d={d} fill="none" stroke="#B9C4D6" strokeWidth={1.5} />
      ))}
      <text x={(lX0 + lX1) / 2} y={rMidY - 14} fill="#37C9B8" fontFamily="'JetBrains Mono', monospace" fontSize={11} fontWeight={700} textAnchor="middle">
        L{hideValues ? '' : ` = ${formatHenry(Lval)}`}
      </text>

      <line x1={lX1} y1={topY} x2={cX0} y2={topY} stroke="#B9C4D6" strokeWidth={1.5} />

      {/* Capacitor: two vertical plates centered on cMidX */}
      <line x1={cX0} y1={topY} x2={cMidX - cGap / 2} y2={topY} stroke="#B9C4D6" strokeWidth={1.5} />
      <line x1={cMidX - cGap / 2} y1={topY - 10} x2={cMidX - cGap / 2} y2={topY + 10} stroke="#B9C4D6" strokeWidth={2} />
      <line x1={cMidX + cGap / 2} y1={topY - 10} x2={cMidX + cGap / 2} y2={topY + 10} stroke="#B9C4D6" strokeWidth={2} />
      <line x1={cMidX + cGap / 2} y1={topY} x2={cX1} y2={topY} stroke="#B9C4D6" strokeWidth={1.5} />
      <text x={cMidX} y={rMidY - 14} fill="#F9A968" fontFamily="'JetBrains Mono', monospace" fontSize={11} fontWeight={700} textAnchor="middle">
        C{hideValues ? '' : ` = ${formatFarad(C)}`}
      </text>

      <line x1={cX1} y1={topY} x2={rX0} y2={topY} stroke="#B9C4D6" strokeWidth={1.5} />

      {/* Vout+ tap (between C and R) */}
      <circle cx={tapX} cy={topY} r={3} fill="#B9C4D6" />
      <text x={tapX} y={topY - 12} fill="#54617A" fontFamily="'JetBrains Mono', monospace" fontSize={10} textAnchor="middle">
        {T('v_out')}
      </text>

      {/* Resistor zigzag */}
      <polyline
        points={rPts.map((p) => p.join(',')).join(' ')}
        fill="none"
        stroke="#B9C4D6"
        strokeWidth={1.5}
      />
      <text x={(rX0 + rX1) / 2} y={rMidY + 22} fill="#B87CE0" fontFamily="'JetBrains Mono', monospace" fontSize={11} fontWeight={700} textAnchor="middle">
        R{hideValues ? '' : ` = ${formatOhm(R)}`}
      </text>

      {/* Right terminal (Vin- / Vout-) */}
      <line x1={rX1} y1={topY} x2={outX} y2={topY} stroke="#B9C4D6" strokeWidth={1.5} />
      <circle cx={outX} cy={topY} r={3} fill="#B9C4D6" />

      {/* Ground rail (return wire from Vin+ down and across to Vin-) */}
      <line x1={inX} y1={topY} x2={inX} y2={botY} stroke="#B9C4D6" strokeWidth={1.5} />
      <line x1={inX} y1={botY} x2={outX} y2={botY} stroke="#B9C4D6" strokeWidth={1.5} />
      <line x1={outX} y1={botY} x2={outX} y2={topY} stroke="#B9C4D6" strokeWidth={1.5} />

      {/* Ground symbol on bottom rail */}
      {(() => {
        const gX = (inX + outX) / 2
        return (
          <g>
            <line x1={gX} y1={botY} x2={gX} y2={botY + 10} stroke="#B9C4D6" strokeWidth={1.5} />
            <line x1={gX - 12} y1={botY + 10} x2={gX + 12} y2={botY + 10} stroke="#B9C4D6" strokeWidth={2} />
            <line x1={gX - 8}  y1={botY + 14} x2={gX + 8}  y2={botY + 14} stroke="#B9C4D6" strokeWidth={1.5} />
            <line x1={gX - 4}  y1={botY + 18} x2={gX + 4}  y2={botY + 18} stroke="#B9C4D6" strokeWidth={1.5} />
          </g>
        )
      })()}
    </g>
  )
}

function NumberSlider({ min, max, step, value, onChange, disabled }: {
  min: number; max: number; step: number
  value: number
  onChange: (v: number) => void
  disabled?: boolean
}) {
  const bump = (delta: number) =>
    onChange(Math.min(max, Math.max(min, +(value + delta).toFixed(3))))
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
  display: 'flex', flexDirection: 'column', gap: '2rem',
  fontSize: '2rem',
  overflow: 'auto',
}
const statusBoxStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: '0.5rem',
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
  top: '8rem', left: '50%',
  transform: 'translateX(-50%)',
  maxWidth: '60%',
  padding: '1.2rem 1.8rem',
  background: 'rgba(184, 124, 224, 0.15)',
  color: '#B87CE0',
  border: '1px solid #B87CE0',
  borderRadius: '0.6rem',
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: '1.9rem', lineHeight: 1.35, textAlign: 'center',
  zIndex: 15, pointerEvents: 'none',
}
