import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  useSetStage,
  useCurrentStage,
  useComplete,
  useDeclareStages,
  useHint,
  useInit,
  useNext,
  usePeek,
  useProgress,
  useReset,
  useSeed,
  useTicker,
} from '@physics/sdk/react'
import { getHintFor, getStagesFor } from './stages'
import en from '../i18n/en.json'
import fr from '../i18n/fr.json'
import ar from '../i18n/ar.json'

// ─── Scene constants ────────────────────────────────────────────────────
const W = 800
const H = 450

// Left panel: circuit schematic
const SCH_X = 32
const SCH_Y = 60
const SCH_W = 360
const SCH_H = 350

// Right panel: I(U) characteristic (stage 1) / scope (stages 2,3)
const PLOT_X = 412
const PLOT_Y = 60
const PLOT_W = 250
const PLOT_H = 350

// Physics (Shockley diode + series resistor)
const I_S = 1e-9 // A, saturation current
const V_T_THERMAL = 0.026 // V, thermal voltage at ~300K
const V_KNEE = 0.6 // "practical" threshold for HUD/messaging (V)
const R_SERIES = 100 // Ω

// I(U) plot ranges
const U_MIN = -1.5
const U_MAX = 1.2
const I_MIN_MA = -2 // mA
const I_MAX_MA = 25 // mA

// Stage 1 sweep controls
const E_MIN = -2
const E_MAX = 3
const E_DEFAULT = 0

// Stage 2 AC controls
const VP_MIN = 1 // V
const VP_MAX = 5 // V
const VP_DEFAULT = 3 // V
const AC_FREQ = 1 // Hz (fixed for simplicity)
const SCOPE_WINDOW_S = 2 // seconds visible

// Stage 3 topology options + seeded targets
type Topology = 'half' | 'reverse' | 'full'
const STAGE3_TARGETS: Topology[] = ['half', 'full', 'reverse']

const dict = { en, fr, ar } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

// ─── Physics helpers ────────────────────────────────────────────────────
/** Shockley I(V_D) — returns current in Amps for a given diode voltage. */
function diodeI(vD: number): number {
  return I_S * (Math.exp(vD / V_T_THERMAL) - 1)
}

/** Solve E = V_D + R·I(V_D) by bisection. Returns V_D in volts. */
function solveVd(e: number): number {
  // For E < ~0 the diode reverse-blocks; V_D ≈ E, I ≈ 0.
  if (e < -0.05) return e
  let lo = -0.1
  let hi = Math.max(0.9, e)
  for (let i = 0; i < 60; i++) {
    const mid = 0.5 * (lo + hi)
    const f = mid + R_SERIES * diodeI(mid) - e
    if (Math.abs(f) < 1e-6) return mid
    if (f > 0) hi = mid
    else lo = mid
  }
  return 0.5 * (lo + hi)
}

/** V_out(t) of the given topology fed with V_in(t). */
function topologyOut(topo: Topology, vIn: number): number {
  if (topo === 'half') return Math.max(0, vIn - V_KNEE)
  if (topo === 'reverse') return Math.min(0, vIn + V_KNEE)
  // full-wave bridge (4 diodes): |V_in| minus 2·V_th
  return Math.max(0, Math.abs(vIn) - 2 * V_KNEE)
}

// ─── Plot coord helpers ─────────────────────────────────────────────────
function uToSvgX(u: number): number {
  return PLOT_X + ((u - U_MIN) / (U_MAX - U_MIN)) * PLOT_W
}
function iToSvgY(iMa: number): number {
  return PLOT_Y + PLOT_H - ((iMa - I_MIN_MA) / (I_MAX_MA - I_MIN_MA)) * PLOT_H
}

// Time-domain (scope) coord helpers
function tToScopeX(t: number): number {
  return PLOT_X + (t / SCOPE_WINDOW_S) * PLOT_W
}
const SCOPE_V_MAX = VP_MAX + 0.5
function vToScopeY(v: number): number {
  return PLOT_Y + PLOT_H / 2 - (v / SCOPE_V_MAX) * (PLOT_H / 2)
}

// ─── Component ──────────────────────────────────────────────────────────
export default function Scene() {
  const { locale, seed } = useInit()
  const stages = useMemo(() => getStagesFor(locale), [locale])
  useDeclareStages(stages)
  const labels = useMemo(() => svgLabels(locale), [locale])
  const rootRng = useSeed()

  const stage3Target = useMemo<Topology>(() => {
    void rootRng
    return STAGE3_TARGETS[seed % STAGE3_TARGETS.length]!
  }, [seed, rootRng])

  const stageIdx = useCurrentStage()
  const [E, setE] = useState(E_DEFAULT)
  const [vP, setVp] = useState(VP_DEFAULT)
  const [visited, setVisited] = useState<Array<{ u: number; i: number }>>([])
  const [sweptHigh, setSweptHigh] = useState(false)
  const [sweptLow, setSweptLow] = useState(false)
  const [vpChanges, setVpChanges] = useState(0)
  const [scopeT, setScopeT] = useState(0)
  const [pick, setPick] = useState<Topology | null>(null)
  const [peekVisible, setPeekVisible] = useState(false)

  const setStage = useSetStage()
  const progress = useProgress()
  const complete = useComplete()

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  const opPoint = useMemo(() => {
    const vD = solveVd(E)
    const iA = Math.max(0, diodeI(vD))
    return { vD, iMa: iA * 1000 }
  }, [E])

  // Record sweep coverage + trace on E change
  useEffect(() => {
    if (!isStage1) return
    setVisited((prev) => {
      const last = prev[prev.length - 1]
      if (last && Math.abs(last.u - opPoint.vD) < 0.005) return prev
      const next = [...prev, { u: opPoint.vD, i: opPoint.iMa }]
      return next.slice(-400)
    })
    if (E >= V_KNEE + 0.4) setSweptHigh(true)
    if (E <= -0.5) setSweptLow(true)
  }, [E, opPoint.vD, opPoint.iMa, isStage1])

  // Scope animation for stages 2 and 3
  useTicker((dt) => {
    if (!isStage2 && !isStage3) return
    setScopeT((prev) => (prev + dt) % SCOPE_WINDOW_S)
  })

  const resetStageState = useCallback(() => {
    setE(E_DEFAULT)
    setVp(VP_DEFAULT)
    setVisited([])
    setSweptHigh(false)
    setSweptLow(false)
    setVpChanges(0)
    setScopeT(0)
    setPick(null)
    setPeekVisible(false)
  }, [])

  const canSubmit = isStage1
    ? sweptHigh && sweptLow
    : isStage2
      ? vpChanges >= 2
      : pick === stage3Target

  useEffect(() => {
    progress(stageIdx / 3, { stage: stageIdx, canSubmit })
  }, [stageIdx, canSubmit, progress])

  useReset(resetStageState)

  useNext(() => {
    if (stageIdx < 3) {
      setStage(stageIdx + 1)
      resetStageState()
    } else {
      complete({ success: true })
    }
  })

  usePeek(() => {
    if (!isStage3) return
    setPeekVisible(true)
  })
  useEffect(() => {
    if (!peekVisible) return
    const t = setTimeout(() => setPeekVisible(false), 1500)
    return () => clearTimeout(t)
  }, [peekVisible])

  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  // ─── Circuit schematic geometry ──────────────────────────────────────
  const rect = {
    left: SCH_X + 50,
    right: SCH_X + SCH_W - 50,
    top: SCH_Y + 80,
    bottom: SCH_Y + SCH_H - 80,
  }
  const source = { x: rect.left, y: (rect.top + rect.bottom) / 2 }
  const resistor = { x: (rect.left + rect.right) / 2, y: rect.top }
  const diode = { x: rect.right, y: (rect.top + rect.bottom) / 2 }

  // AC-instantaneous V for scope stages
  const vInInstant = isStage1 ? E : vP * Math.sin(2 * Math.PI * AC_FREQ * scopeT)
  const iInstantMa = isStage1
    ? opPoint.iMa
    : Math.max(0, vInInstant - V_KNEE) / R_SERIES * 1000

  const wireStroke = '#54617A'
  const activeColor = '#37C9B8'
  const wireW = 1.6
  const conducting = iInstantMa > 0.5
  const wireColor = conducting ? activeColor : wireStroke
  const wireWidth = conducting ? wireW + 0.6 : wireW

  // Guide curve for I(U) — dashed characteristic
  const guidePath = useMemo(() => {
    const steps = 120
    let d = ''
    for (let i = 0; i <= steps; i++) {
      const u = U_MIN + (i / steps) * (U_MAX - U_MIN)
      const iMa = Math.min(I_MAX_MA + 5, Math.max(I_MIN_MA - 5, diodeI(u) * 1000))
      const sx = uToSvgX(u)
      const sy = iToSvgY(iMa)
      d += `${i === 0 ? 'M' : 'L'} ${sx.toFixed(1)} ${sy.toFixed(1)} `
    }
    return d
  }, [])

  const tracePath = useMemo(() => {
    if (visited.length < 2) return ''
    const sorted = [...visited].sort((a, b) => a.u - b.u)
    let d = ''
    for (let i = 0; i < sorted.length; i++) {
      const p = sorted[i]!
      const iClamped = Math.min(I_MAX_MA + 2, Math.max(I_MIN_MA - 2, p.i))
      const sx = uToSvgX(p.u)
      const sy = iToSvgY(iClamped)
      d += `${i === 0 ? 'M' : 'L'} ${sx.toFixed(1)} ${sy.toFixed(1)} `
    }
    return d
  }, [visited])

  // Scope traces for stages 2 & 3
  function buildScopeTrace(fn: (v: number) => number): string {
    const steps = 200
    let d = ''
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * SCOPE_WINDOW_S
      const vin = vP * Math.sin(2 * Math.PI * AC_FREQ * t)
      const vout = fn(vin)
      const sx = tToScopeX(t)
      const sy = vToScopeY(vout)
      d += `${i === 0 ? 'M' : 'L'} ${sx.toFixed(1)} ${sy.toFixed(1)} `
    }
    return d
  }
  const vInScopePath = useMemo(() => buildScopeTrace((v) => v), [vP])
  const vOutScopePath = useMemo(
    () => buildScopeTrace((v) => Math.max(0, v - V_KNEE)),
    [vP],
  )
  const targetScopePath = useMemo(
    () => buildScopeTrace((v) => topologyOut(stage3Target, v)),
    [vP, stage3Target],
  )
  const pickScopePath = useMemo(
    () => (pick ? buildScopeTrace((v) => topologyOut(pick, v)) : ''),
    [vP, pick],
  )

  // Zero axes for plots
  const zeroY = iToSvgY(0)
  const zeroX = uToSvgX(0)
  const scopeMidY = PLOT_Y + PLOT_H / 2

  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`
  const hudTR = isStage1
    ? `V_D = ${opPoint.vD.toFixed(2)} V · I = ${opPoint.iMa.toFixed(1)} mA`
    : isStage2
      ? `V_p = ${vP.toFixed(1)} V`
      : peekVisible
        ? `${labels.peek_reveal} ${labels[('topo_' + stage3Target) as keyof typeof labels]}`
        : pick
          ? pick === stage3Target
            ? `✓ ${labels.correct}`
            : `✗ ${labels.wrong}`
          : labels.pick_topology
  const hudBL = isStage1 ? labels.tip1 : isStage2 ? labels.tip2 : labels.tip3
  const hudBR = isStage1
    ? sweptHigh && sweptLow
      ? `✓ ${labels.swept_ok}`
      : `${sweptLow ? '✓' : '○'} ${labels.reverse} · ${sweptHigh ? '✓' : '○'} ${labels.forward}`
    : isStage2
      ? vpChanges >= 2
        ? `✓ ${labels.observed_clip}`
        : `${labels.change_vp} (${vpChanges}/2)`
      : ''

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block', userSelect: 'none' }}
      >
        <rect x={0} y={0} width={W} height={H} fill="#0D1524" />

        {/* ─── Left panel: circuit schematic ─────────────────────────── */}
        <rect
          x={SCH_X - 8}
          y={SCH_Y - 8}
          width={SCH_W + 16}
          height={SCH_H + 16}
          fill="none"
          stroke="#12203a"
          strokeWidth={1}
          rx={6}
        />
        <text
          x={SCH_X}
          y={SCH_Y - 14}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={11}
          letterSpacing="0.1em"
        >
          {labels.circuit}
        </text>

        {/* Wires: source → top → resistor → top → diode → right side → bottom → back */}
        <line x1={source.x} y1={source.y - 14} x2={source.x} y2={rect.top} stroke={wireColor} strokeWidth={wireWidth} />
        <line x1={source.x} y1={rect.top} x2={resistor.x - 22} y2={rect.top} stroke={wireColor} strokeWidth={wireWidth} />
        <line x1={resistor.x + 22} y1={rect.top} x2={diode.x} y2={rect.top} stroke={wireColor} strokeWidth={wireWidth} />
        <line x1={diode.x} y1={rect.top} x2={diode.x} y2={diode.y - 16} stroke={wireColor} strokeWidth={wireWidth} />
        <line x1={diode.x} y1={diode.y + 16} x2={diode.x} y2={rect.bottom} stroke={wireColor} strokeWidth={wireWidth} />
        <line x1={diode.x} y1={rect.bottom} x2={source.x} y2={rect.bottom} stroke={wireColor} strokeWidth={wireWidth} />
        <line x1={source.x} y1={rect.bottom} x2={source.x} y2={source.y + 14} stroke={wireColor} strokeWidth={wireWidth} />

        {/* Source symbol */}
        {isStage1 ? (
          <>
            {/* DC battery: long + short plate */}
            <line x1={source.x - 16} y1={source.y - 14} x2={source.x + 16} y2={source.y - 14} stroke="#EAF0FA" strokeWidth={2.4} />
            <line x1={source.x - 9} y1={source.y - 4} x2={source.x + 9} y2={source.y - 4} stroke="#EAF0FA" strokeWidth={2.4} />
            <line x1={source.x - 16} y1={source.y + 6} x2={source.x + 16} y2={source.y + 6} stroke="#EAF0FA" strokeWidth={2.4} />
            <line x1={source.x - 9} y1={source.y + 16} x2={source.x + 9} y2={source.y + 16} stroke="#EAF0FA" strokeWidth={2.4} />
            <text
              x={source.x - 26}
              y={source.y + 4}
              fill="#37C9B8"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
              textAnchor="end"
            >
              E = {E.toFixed(1)}V
            </text>
          </>
        ) : (
          <>
            {/* AC source: circle with sine */}
            <circle cx={source.x} cy={source.y} r={16} fill="none" stroke="#EAF0FA" strokeWidth={1.6} />
            <path
              d={`M ${source.x - 10} ${source.y} Q ${source.x - 5} ${source.y - 8}, ${source.x} ${source.y} T ${source.x + 10} ${source.y}`}
              fill="none" stroke="#EAF0FA" strokeWidth={1.4}
            />
            <text
              x={source.x - 22}
              y={source.y + 4}
              fill="#37C9B8"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
              textAnchor="end"
            >
              ~
            </text>
          </>
        )}

        {/* Resistor: zigzag */}
        {(() => {
          const rx = resistor.x, ry = resistor.y
          const zw = 22, zh = 6
          const pts = [
            [rx - zw, ry],
            [rx - zw + 4, ry - zh],
            [rx - zw + 12, ry + zh],
            [rx - zw + 20, ry - zh],
            [rx - zw + 28, ry + zh],
            [rx - zw + 36, ry - zh],
            [rx - zw + 44, ry],
          ]
          const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`).join(' ')
          return (
            <>
              <path d={path} fill="none" stroke="#EAF0FA" strokeWidth={1.8} />
              <text
                x={rx}
                y={ry - 14}
                fill="#6C7A93"
                fontFamily="'JetBrains Mono', monospace"
                fontSize={10}
                textAnchor="middle"
              >
                R = {R_SERIES}Ω
              </text>
            </>
          )
        })()}

        {/* Diode symbol (vertical, anode at top, cathode at bottom) */}
        {(() => {
          const dx = diode.x, dy = diode.y
          const glow = conducting ? Math.min(1, iInstantMa / 20) : 0
          return (
            <>
              {glow > 0.05 && (
                <circle cx={dx} cy={dy} r={22} fill="#F97316" opacity={0.15 + 0.35 * glow} />
              )}
              {/* Triangle (anode arrow pointing down toward cathode) */}
              <polygon
                points={`${dx - 10},${dy - 10} ${dx + 10},${dy - 10} ${dx},${dy + 4}`}
                fill={conducting ? '#F97316' : '#EAF0FA'}
                stroke="#EAF0FA"
                strokeWidth={1}
              />
              {/* Cathode bar */}
              <line x1={dx - 12} y1={dy + 6} x2={dx + 12} y2={dy + 6} stroke="#EAF0FA" strokeWidth={2.4} />
              <text
                x={dx + 18}
                y={dy + 4}
                fill={conducting ? '#F97316' : '#6C7A93'}
                fontFamily="'JetBrains Mono', monospace"
                fontSize={10}
              >
                D
              </text>
            </>
          )
        })()}

        {/* Current arrow along top rail when conducting */}
        {conducting && (
          <g key="flow">
            <path id="diode-flow" d={`M ${source.x} ${rect.top} L ${diode.x} ${rect.top} L ${diode.x} ${diode.y - 16}`} fill="none" stroke="none" />
            {[0, 0.6, 1.2].map((delay) => (
              <circle key={`f${delay}`} r={2.6} fill={activeColor}>
                <animateMotion dur="1.6s" repeatCount="indefinite" begin={`${delay}s`}>
                  <mpath href="#diode-flow" />
                </animateMotion>
              </circle>
            ))}
          </g>
        )}

        {/* ─── Right panel: I(U) or scope ─────────────────────────────── */}
        <rect
          x={PLOT_X - 8}
          y={PLOT_Y - 8}
          width={PLOT_W + 16}
          height={PLOT_H + 16}
          fill="none"
          stroke="#12203a"
          strokeWidth={1}
          rx={6}
        />
        <text
          x={PLOT_X}
          y={PLOT_Y - 14}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={11}
          letterSpacing="0.1em"
        >
          {isStage1 ? labels.characteristic : labels.scope}
        </text>

        {/* Grid + axes */}
        {isStage1 ? (
          <>
            {/* Vertical grid (U) */}
            {[-1, 0, 1].map((u) => (
              <line
                key={`vg${u}`}
                x1={uToSvgX(u)} y1={PLOT_Y} x2={uToSvgX(u)} y2={PLOT_Y + PLOT_H}
                stroke="#12203a" strokeWidth={1}
              />
            ))}
            {/* Horizontal grid (I) */}
            {[0, 5, 10, 15, 20].map((iv) => (
              <line
                key={`hg${iv}`}
                x1={PLOT_X} y1={iToSvgY(iv)} x2={PLOT_X + PLOT_W} y2={iToSvgY(iv)}
                stroke="#12203a" strokeWidth={1}
              />
            ))}
            {/* Axes (x at I=0, y at U=0) */}
            <line x1={PLOT_X} y1={zeroY} x2={PLOT_X + PLOT_W} y2={zeroY} stroke="#3A4863" strokeWidth={1.5} />
            <line x1={zeroX} y1={PLOT_Y} x2={zeroX} y2={PLOT_Y + PLOT_H} stroke="#3A4863" strokeWidth={1.5} />
            {/* Axis ticks + labels */}
            {[-1, 1].map((u) => (
              <text
                key={`ut${u}`}
                x={uToSvgX(u)}
                y={zeroY + 12}
                fill="#54617A"
                fontFamily="'JetBrains Mono', monospace"
                fontSize={9}
                textAnchor="middle"
              >
                {u}
              </text>
            ))}
            {[5, 10, 15, 20].map((iv) => (
              <text
                key={`it${iv}`}
                x={zeroX - 4}
                y={iToSvgY(iv) + 3}
                fill="#54617A"
                fontFamily="'JetBrains Mono', monospace"
                fontSize={9}
                textAnchor="end"
              >
                {iv}
              </text>
            ))}
            <text
              x={PLOT_X + PLOT_W - 4}
              y={zeroY - 6}
              fill="#6C7A93"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
              textAnchor="end"
            >
              U (V) →
            </text>
            <text
              transform={`rotate(-90 ${PLOT_X + 12} ${PLOT_Y + 12})`}
              x={PLOT_X + 12}
              y={PLOT_Y + 12}
              fill="#6C7A93"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
            >
              I (mA) ↑
            </text>
            {/* Ideal-threshold marker */}
            <line
              x1={uToSvgX(V_KNEE)} y1={PLOT_Y} x2={uToSvgX(V_KNEE)} y2={PLOT_Y + PLOT_H}
              stroke="#F9A968" strokeWidth={1} strokeDasharray="3 4" opacity={0.35}
            />
            <text
              x={uToSvgX(V_KNEE)}
              y={PLOT_Y + 12}
              fill="#F9A968"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={9}
              textAnchor="middle"
            >
              V_th
            </text>
            {/* Guide curve (dashed) + trace of visited points */}
            <clipPath id="iu-clip">
              <rect x={PLOT_X} y={PLOT_Y} width={PLOT_W} height={PLOT_H} />
            </clipPath>
            <g clipPath="url(#iu-clip)">
              <path d={guidePath} fill="none" stroke="#54617A" strokeWidth={1.2} strokeDasharray="3 4" opacity={0.5} />
              {tracePath && <path d={tracePath} fill="none" stroke={activeColor} strokeWidth={2.2} />}
              {/* Live operating-point marker */}
              <circle cx={uToSvgX(opPoint.vD)} cy={iToSvgY(opPoint.iMa)} r={5} fill="#F97316" />
              <circle cx={uToSvgX(opPoint.vD)} cy={iToSvgY(opPoint.iMa)} r={10} fill="none" stroke="#F97316" strokeWidth={1} opacity={0.5} />
            </g>
          </>
        ) : (
          <>
            {/* Scope axes */}
            {/* Vertical grid */}
            {[0.5, 1, 1.5].map((t) => (
              <line
                key={`sg${t}`}
                x1={tToScopeX(t)} y1={PLOT_Y} x2={tToScopeX(t)} y2={PLOT_Y + PLOT_H}
                stroke="#12203a" strokeWidth={1}
              />
            ))}
            {/* Horizontal grid */}
            {[-4, -2, 2, 4].map((v) => (
              <line
                key={`hs${v}`}
                x1={PLOT_X} y1={vToScopeY(v)} x2={PLOT_X + PLOT_W} y2={vToScopeY(v)}
                stroke="#12203a" strokeWidth={1}
              />
            ))}
            {/* Zero axis */}
            <line x1={PLOT_X} y1={scopeMidY} x2={PLOT_X + PLOT_W} y2={scopeMidY} stroke="#3A4863" strokeWidth={1.5} />
            <line x1={PLOT_X} y1={PLOT_Y} x2={PLOT_X} y2={PLOT_Y + PLOT_H} stroke="#3A4863" strokeWidth={1.5} />
            <text
              x={PLOT_X + PLOT_W - 4}
              y={scopeMidY - 4}
              fill="#6C7A93"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
              textAnchor="end"
            >
              t (s) →
            </text>
            <text
              x={PLOT_X + 6}
              y={PLOT_Y + 10}
              fill="#6C7A93"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={10}
            >
              V ↑
            </text>
            {/* Voltage ticks */}
            {[-4, -2, 2, 4].map((v) => (
              <text
                key={`vt${v}`}
                x={PLOT_X - 4}
                y={vToScopeY(v) + 3}
                fill="#54617A"
                fontFamily="'JetBrains Mono', monospace"
                fontSize={9}
                textAnchor="end"
              >
                {v}
              </text>
            ))}
            <clipPath id="scope-clip">
              <rect x={PLOT_X} y={PLOT_Y} width={PLOT_W} height={PLOT_H} />
            </clipPath>
            <g clipPath="url(#scope-clip)">
              {isStage2 ? (
                <>
                  <path d={vInScopePath} fill="none" stroke="#B9C4D6" strokeWidth={1.4} strokeDasharray="4 4" opacity={0.7} />
                  <path d={vOutScopePath} fill="none" stroke={activeColor} strokeWidth={2.2} />
                </>
              ) : (
                <>
                  <path d={targetScopePath} fill="none" stroke="#F97316" strokeWidth={2.2} />
                  {pick && (
                    <path d={pickScopePath} fill="none" stroke={pick === stage3Target ? activeColor : '#EF476F'} strokeWidth={1.8} strokeDasharray="4 3" opacity={0.85} />
                  )}
                </>
              )}
              {/* Sweep cursor */}
              {isStage2 && (
                <line
                  x1={tToScopeX(scopeT)} y1={PLOT_Y}
                  x2={tToScopeX(scopeT)} y2={PLOT_Y + PLOT_H}
                  stroke="#F9A968" strokeWidth={1} opacity={0.35}
                />
              )}
            </g>
            {/* Legend */}
            {isStage2 && (
              <g transform={`translate(${PLOT_X + 10}, ${PLOT_Y + PLOT_H - 24})`}>
                <line x1={0} y1={0} x2={16} y2={0} stroke="#B9C4D6" strokeWidth={1.4} strokeDasharray="4 4" />
                <text x={20} y={3} fill="#B9C4D6" fontFamily="'JetBrains Mono', monospace" fontSize={9}>V_in</text>
                <line x1={0} y1={14} x2={16} y2={14} stroke={activeColor} strokeWidth={2} />
                <text x={20} y={17} fill={activeColor} fontFamily="'JetBrains Mono', monospace" fontSize={9}>V_R</text>
              </g>
            )}
            {isStage3 && (
              <g transform={`translate(${PLOT_X + 10}, ${PLOT_Y + PLOT_H - 24})`}>
                <line x1={0} y1={0} x2={16} y2={0} stroke="#F97316" strokeWidth={2} />
                <text x={20} y={3} fill="#F97316" fontFamily="'JetBrains Mono', monospace" fontSize={9}>{labels.target}</text>
                {pick && (
                  <>
                    <line x1={0} y1={14} x2={16} y2={14} stroke={pick === stage3Target ? activeColor : '#EF476F'} strokeWidth={1.8} strokeDasharray="4 3" />
                    <text x={20} y={17} fill={pick === stage3Target ? activeColor : '#EF476F'} fontFamily="'JetBrains Mono', monospace" fontSize={9}>{labels.your_pick}</text>
                  </>
                )}
              </g>
            )}
          </>
        )}
      </svg>

      {/* ─── HUD overlays ────────────────────────────────────────────── */}
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
          textAlign: 'right',
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
          fontSize: '2.3rem',
          letterSpacing: '0.06em',
          color: '#6C7A93',
          zIndex: 5,
          pointerEvents: 'none',
          maxWidth: '48%',
        }}
      >
        {hudBL}
      </div>
      {hudBR && (
        <div
          style={{
            position: 'absolute',
            bottom: '3rem',
            right: '3rem',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '2.3rem',
            letterSpacing: '0.08em',
            color: '#37C9B8',
            textAlign: 'right',
            zIndex: 5,
            pointerEvents: 'none',
          }}
        >
          {hudBR}
        </div>
      )}

      {/* ─── Stage 1 & 2 controls: right-side vertical sliders ──────── */}
      {(isStage1 || isStage2) && (
        <div
          style={{
            position: 'absolute',
            top: '6rem',
            right: '3rem',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '2rem',
            zIndex: 6,
          }}
        >
          {isStage1 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.6rem' }}>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.6rem', color: '#6C7A93' }}>
                {E_MAX}
              </div>
              <div style={{ width: '2rem', height: '30rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <input
                  type="range"
                  min={E_MIN * 100}
                  max={E_MAX * 100}
                  step={1}
                  value={Math.round(E * 100)}
                  onChange={(e) => setE(Number(e.target.value) / 100)}
                  style={{
                    width: '30rem',
                    height: '2rem',
                    transform: 'rotate(-90deg)',
                    transformOrigin: 'center',
                    accentColor: activeColor,
                    cursor: 'pointer',
                  }}
                />
              </div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.6rem', color: '#6C7A93' }}>
                {E_MIN}
              </div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.6rem', color: activeColor }}>
                E = {E.toFixed(2)} V
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.6rem' }}>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.6rem', color: '#6C7A93' }}>
                {VP_MAX}
              </div>
              <div style={{ width: '2rem', height: '30rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <input
                  type="range"
                  min={VP_MIN * 100}
                  max={VP_MAX * 100}
                  step={1}
                  value={Math.round(vP * 100)}
                  onChange={(e) => {
                    const next = Number(e.target.value) / 100
                    setVp((prev) => {
                      if (Math.abs(next - prev) > 0.05) setVpChanges((n) => n + 1)
                      return next
                    })
                  }}
                  style={{
                    width: '30rem',
                    height: '2rem',
                    transform: 'rotate(-90deg)',
                    transformOrigin: 'center',
                    accentColor: activeColor,
                    cursor: 'pointer',
                  }}
                />
              </div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.6rem', color: '#6C7A93' }}>
                {VP_MIN}
              </div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.6rem', color: activeColor }}>
                V_p = {vP.toFixed(1)} V
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── Stage 3: topology-pick buttons (bottom center) ─────────── */}
      {isStage3 && (
        <div
          style={{
            position: 'absolute',
            bottom: '10rem',
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            gap: '2rem',
            zIndex: 10,
          }}
        >
          {(['half', 'reverse', 'full'] as Topology[]).map((t) => {
            const active = pick === t
            const wasCorrect = pick && t === stage3Target
            const wasWrongPick = active && pick !== stage3Target
            const bg = active
              ? pick === stage3Target
                ? activeColor
                : '#EF476F'
              : '#12203a'
            const border = wasCorrect && !active ? activeColor : '#3A4863'
            return (
              <button
                key={t}
                type="button"
                onClick={() => setPick(t)}
                disabled={!!pick && pick === stage3Target}
                style={{
                  padding: '1.2rem 1.6rem',
                  background: bg,
                  color: '#EAF0FA',
                  border: `1.5px solid ${wasWrongPick ? '#EF476F' : border}`,
                  borderRadius: '1rem',
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: '1.7rem',
                  cursor: pick && pick === stage3Target ? 'default' : 'pointer',
                  minWidth: '14rem',
                }}
              >
                {labels[('topo_' + t) as keyof typeof labels]}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
