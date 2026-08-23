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
import fr from '../i18n/fr.json'
import ar from '../i18n/ar.json'
import { wavelengthCss } from './wavelengthToRgb'
import {
  ELEMENT_KEYS,
  ELEMENTS,
  featureMatches,
  SETUPS,
  SOURCE_KEYS,
  type ElementKey,
  type SourceKey,
} from './physics'

// ─── Scene constants ────────────────────────────────────────────────────
const W = 800
const H = 450

// Spectrum strip geometry (SVG units)
const STRIP_X0 = 60
const STRIP_X1 = 530
const STRIP_W = STRIP_X1 - STRIP_X0
const LAMBDA_MIN = 380
const LAMBDA_MAX = 750

const TARGET_Y = 110
const STUDENT_Y = 260
const STRIP_H = 92

// Continuum sampling (SVG rects)
const CONTINUUM_SAMPLES = 60

// ─── Label loader ───────────────────────────────────────────────────────
const dict = { en, fr, ar } as const
type Locale = keyof typeof dict
function svgLabels(locale: string) {
  const key = (locale in dict ? locale : 'en') as Locale
  return dict[key].labels
}

function lambdaToX(nm: number): number {
  return STRIP_X0 + ((nm - LAMBDA_MIN) / (LAMBDA_MAX - LAMBDA_MIN)) * STRIP_W
}

// ─── Spectrum strip renderer ────────────────────────────────────────────
type StripProps = {
  y: number
  source: SourceKey
  element: ElementKey
  title: string
  titleColor: string
}

function SpectrumStrip({ y, source, element, title, titleColor }: StripProps) {
  const lines = ELEMENTS[element].lines
  const bandW = STRIP_W / CONTINUUM_SAMPLES

  return (
    <g>
      {/* Title */}
      <text
        x={STRIP_X0}
        y={y - 8}
        fill={titleColor}
        fontFamily="'JetBrains Mono', monospace"
        fontSize={11}
        letterSpacing="0.14em"
      >
        {title}
      </text>

      {/* Strip frame */}
      <rect
        x={STRIP_X0 - 1}
        y={y - 1}
        width={STRIP_W + 2}
        height={STRIP_H + 2}
        fill="none"
        stroke="#2A3654"
        strokeWidth={1}
        rx={4}
      />

      {/* Background: continuous rainbow for continuum/absorption; black for emission */}
      {source === 'emission' ? (
        <rect
          x={STRIP_X0}
          y={y}
          width={STRIP_W}
          height={STRIP_H}
          fill="#02040A"
        />
      ) : (
        <g>
          {Array.from({ length: CONTINUUM_SAMPLES }, (_, i) => {
            const nm =
              LAMBDA_MIN + ((i + 0.5) / CONTINUUM_SAMPLES) * (LAMBDA_MAX - LAMBDA_MIN)
            return (
              <rect
                key={`c${i}`}
                x={STRIP_X0 + i * bandW}
                y={y}
                width={bandW + 0.4}
                height={STRIP_H}
                fill={wavelengthCss(nm, 0.95)}
              />
            )
          })}
        </g>
      )}

      {/* Foreground lines: emission = bright colored; absorption = dark gaps */}
      {source !== 'continuum' && (
        <g>
          {lines.map((nm, i) => {
            const cx = lambdaToX(nm)
            if (cx < STRIP_X0 || cx > STRIP_X1) return null
            if (source === 'emission') {
              return (
                <rect
                  key={`l${i}`}
                  x={cx - 1.1}
                  y={y}
                  width={2.2}
                  height={STRIP_H}
                  fill={wavelengthCss(nm, 1)}
                />
              )
            }
            // absorption: dark bar
            return (
              <rect
                key={`l${i}`}
                x={cx - 1.1}
                y={y}
                width={2.2}
                height={STRIP_H}
                fill="#02040A"
              />
            )
          })}
        </g>
      )}
    </g>
  )
}

// ─── Wavelength axis (SVG) ──────────────────────────────────────────────
function WavelengthAxis({ y }: { y: number }) {
  const ticks = [400, 450, 500, 550, 600, 650, 700, 750]
  return (
    <g>
      <line
        x1={STRIP_X0}
        y1={y}
        x2={STRIP_X1}
        y2={y}
        stroke="#2A3654"
        strokeWidth={1}
      />
      {ticks.map((nm) => {
        const cx = lambdaToX(nm)
        return (
          <g key={nm}>
            <line
              x1={cx}
              y1={y}
              x2={cx}
              y2={y + 4}
              stroke="#54617A"
              strokeWidth={1}
            />
            <text
              x={cx}
              y={y + 15}
              fill="#6C7A93"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={9}
              textAnchor="middle"
            >
              {nm}
            </text>
          </g>
        )
      })}
      <text
        x={STRIP_X1}
        y={y + 26}
        fill="#54617A"
        fontFamily="'JetBrains Mono', monospace"
        fontSize={9}
        textAnchor="end"
      >
        λ / nm
      </text>
    </g>
  )
}

// ─── Component ──────────────────────────────────────────────────────────
export default function Scene() {
  const { locale, seed } = useInit()
  const stages = useMemo(() => getStagesFor(locale), [locale])
  useDeclareStages(stages)
  const labels = useMemo(() => svgLabels(locale), [locale])

  const stageIdx = useCurrentStage()
  const setStage = useSetStage()
  const progress = useProgress()
  const complete = useComplete()

  const isStage1 = stageIdx === 1
  const isStage2 = stageIdx === 2
  const isStage3 = stageIdx === 3

  // ─── DOF state ─────────────────────────────────────────────────────
  const [source, setSource] = useState<SourceKey>('continuum')
  const [element, setElement] = useState<ElementKey>('H')
  const [peekVisible, setPeekVisible] = useState(false)
  const [peekIdx, setPeekIdx] = useState(0)

  // Fail-with-restart: rotate SETUPS on wrong submit
  const [failCount, setFailCount] = useState(0)

  // Stage 1 coverage: distinct (source, element) categories visited.
  // Discrete analog of the "sweep ≥ 50% of range" rule — for a
  // 3-option picker, ≥ 50% means 2 of 3 categories visited.
  const [viewedSources, setViewedSources] = useState<SourceKey[]>(['continuum'])
  const [viewedElements, setViewedElements] = useState<ElementKey[]>(['H'])

  const activeSetup = useMemo(
    () => SETUPS[(seed + failCount) % SETUPS.length]!,
    [seed, failCount],
  )

  const chooseSource = useCallback((s: SourceKey) => {
    setSource(s)
    setViewedSources((prev) => (prev.includes(s) ? prev : [...prev, s]))
  }, [])
  const chooseElement = useCallback((e: ElementKey) => {
    setElement(e)
    setViewedElements((prev) => (prev.includes(e) ? prev : [...prev, e]))
  }, [])

  const resetStageState = useCallback(() => {
    setSource('continuum')
    setElement('H')
    setViewedSources(['continuum'])
    setViewedElements(['H'])
    setPeekVisible(false)
    setPeekIdx(0)
  }, [])
  useReset(resetStageState)

  // ─── Coverage (stage 1 advance) ────────────────────────────────────
  const sourceCov = viewedSources.length / SOURCE_KEYS.length
  const elementCov = viewedElements.length / ELEMENT_KEYS.length
  const stage1Done = viewedSources.length >= 2 && viewedElements.length >= 2

  // ─── Feature-match (used for canSubmit + stage 3 evaluation) ───────
  const featureMatch = featureMatches({ source, element }, activeSetup)
  const canSubmit = isStage1 ? stage1Done : featureMatch

  useEffect(() => {
    progress(stageIdx / 3, { stage: stageIdx, canSubmit })
  }, [stageIdx, canSubmit, progress])

  useNext(() => {
    if (stageIdx < 3) {
      setStage(stageIdx + 1)
      resetStageState()
      return
    }
    if (featureMatch) {
      complete({ success: true })
    } else {
      // Fail-with-restart: rotate to next seeded setup, reset choices.
      setFailCount((n) => n + 1)
      resetStageState()
    }
  })

  // ─── Peek (text strategy hint only; NEVER shows student's spectrum) ─
  const PEEK_TIPS = useMemo(
    () => [labels.peek_tip_formula, labels.peek_tip_anchor],
    [labels],
  )
  usePeek(() => {
    if (!isStage3) return
    setPeekVisible(true)
    setPeekIdx((i) => i + 1)
  })
  useEffect(() => {
    if (!peekVisible) return
    const t = setTimeout(() => setPeekVisible(false), 4000)
    return () => clearTimeout(t)
  }, [peekVisible])

  useHint(async (level) => ({ text: getHintFor(locale, stageIdx, level) }))

  // ─── HUD text ─────────────────────────────────────────────────────
  const stageName = stages[stageIdx - 1]?.name ?? ''
  const hudTL = `${labels.stage} 0${stageIdx} · ${stageName}`

  const sourceLabel = labels[`source_${source}` as keyof typeof labels] as string
  const elementLabel = labels[`element_${element}` as keyof typeof labels] as string
  const targetSourceLabel = labels[
    `source_${activeSetup.source}` as keyof typeof labels
  ] as string

  const hudTR = isStage1
    ? `SRC ${(sourceCov * 100).toFixed(0)}% · ELT ${(elementCov * 100).toFixed(0)}%`
    : isStage2
      ? `${labels.src_short}: ${sourceLabel} · ${labels.elt_short}: ${elementLabel}`
      : // stage 3: show current selection (required info), but NO match hint
        `${labels.src_short}: ${sourceLabel} · ${labels.elt_short}: ${elementLabel}`
  const hudBL = peekVisible
    ? PEEK_TIPS[(peekIdx - 1 + PEEK_TIPS.length) % PEEK_TIPS.length]!
    : isStage1
      ? labels.tip1
      : isStage2
        ? labels.tip2
        : labels.tip3

  // Whether to render the student preview strip. This is the primary
  // "help" for this pattern — hidden on stage 3 per §4.7.
  const showStudentStrip = !isStage3

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

        {/* Bench frame (schematic container — always visible) */}
        <rect
          x={32}
          y={60}
          width={508}
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
          letterSpacing="0.14em"
        >
          {labels.bench}
        </text>

        {/* ─── Target spectrum (stages 2 & 3 — required info) ───────── */}
        {isStage2 && (
          <SpectrumStrip
            y={TARGET_Y}
            source={activeSetup.source}
            element={activeSetup.element}
            title={`${labels.target_word} — ${targetSourceLabel}`}
            titleColor="#F9A968"
          />
        )}
        {/* Stage 3: target strip is shown UNLABELED — the source type
            classification is part of what the student must determine. */}
        {isStage3 && (
          <SpectrumStrip
            y={TARGET_Y}
            source={activeSetup.source}
            element={activeSetup.element}
            title={labels.target_word}
            titleColor="#F9A968"
          />
        )}
        {/* Stage 1 shows student strip in the top slot as well */}
        {isStage1 && (
          <SpectrumStrip
            y={TARGET_Y}
            source={source}
            element={element}
            title={`${labels.spectrum_word} — ${sourceLabel}, ${elementLabel}`}
            titleColor="#37C9B8"
          />
        )}

        {/* Wavelength axis under the target strip */}
        <WavelengthAxis y={TARGET_Y + STRIP_H + 4} />

        {/* ─── Student preview strip (stages 1 & 2 — the "help") ────── */}
        {showStudentStrip && (isStage2) && (
          <SpectrumStrip
            y={STUDENT_Y}
            source={source}
            element={element}
            title={`${labels.spectrum_word} — ${sourceLabel}, ${elementLabel}`}
            titleColor="#37C9B8"
          />
        )}
        {isStage2 && (
          <WavelengthAxis y={STUDENT_Y + STRIP_H + 4} />
        )}

        {/* ─── Stage 3: student preview slot is a locked placeholder ─── */}
        {/* No student spectrum. Empty slot with a "hidden" tag. */}
        {isStage3 && (
          <g>
            <rect
              x={STRIP_X0 - 1}
              y={STUDENT_Y - 1}
              width={STRIP_W + 2}
              height={STRIP_H + 2}
              fill="none"
              stroke="#2A3654"
              strokeWidth={1}
              strokeDasharray="4 4"
              rx={4}
            />
            <text
              x={STRIP_X0}
              y={STUDENT_Y - 8}
              fill="#6C7A93"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={11}
              letterSpacing="0.14em"
            >
              {labels.hidden_word}
            </text>
            <text
              x={STRIP_X0 + STRIP_W / 2}
              y={STUDENT_Y + STRIP_H / 2 + 4}
              fill="#3A4863"
              fontFamily="'JetBrains Mono', monospace"
              fontSize={12}
              letterSpacing="0.24em"
              textAnchor="middle"
            >
              {labels.blind_notice}
            </text>
          </g>
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
          fontSize: '2.1rem',
          letterSpacing: '0.08em',
          color: '#B9C4D6',
          textAlign: 'right',
          zIndex: 5,
          pointerEvents: 'none',
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
          fontSize: '2.2rem',
          letterSpacing: '0.06em',
          color: peekVisible ? '#F9A968' : '#6C7A93',
          zIndex: 5,
          pointerEvents: 'none',
          maxWidth: '58%',
        }}
      >
        {hudBL}
      </div>
      {/* NO bottom-right — reserved for parent chrome. */}

      {/* ─── Picker column (right side, HTML overlay) ─────────────── */}
      <div
        style={{
          position: 'absolute',
          top: '8rem',
          right: '2rem',
          bottom: '8rem',
          width: '24rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '2rem',
          zIndex: 6,
        }}
      >
        <PickerGroup
          heading={labels.source_word}
          options={SOURCE_KEYS.map((k) => ({
            key: k,
            label: labels[`source_${k}` as keyof typeof labels] as string,
          }))}
          value={source}
          onSelect={(k) => chooseSource(k as SourceKey)}
        />
        <PickerGroup
          heading={labels.element_word}
          options={ELEMENT_KEYS.map((k) => ({
            key: k,
            label: `${ELEMENTS[k].symbol} · ${
              labels[`element_${k}` as keyof typeof labels] as string
            }`,
          }))}
          value={element}
          onSelect={(k) => chooseElement(k as ElementKey)}
        />
      </div>
    </div>
  )
}

// ─── Picker primitive (button group for discrete DOFs) ────────────────
function PickerGroup({
  heading,
  options,
  value,
  onSelect,
}: {
  heading: string
  options: { key: string; label: string }[]
  value: string
  onSelect: (key: string) => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
      <div
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '1.7rem',
          color: '#54617A',
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
        }}
      >
        {heading}
      </div>
      {options.map((opt) => {
        const selected = opt.key === value
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => onSelect(opt.key)}
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '1.9rem',
              padding: '0.9rem 1.2rem',
              textAlign: 'left',
              border: `1px solid ${selected ? '#37C9B8' : '#2A3654'}`,
              background: selected ? 'rgba(55,201,184,0.14)' : 'rgba(20,30,50,0.6)',
              color: selected ? '#37C9B8' : '#B9C4D6',
              borderRadius: '0.6rem',
              cursor: 'pointer',
              letterSpacing: '0.04em',
              transition: 'border-color 0.15s, background 0.15s, color 0.15s',
            }}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
