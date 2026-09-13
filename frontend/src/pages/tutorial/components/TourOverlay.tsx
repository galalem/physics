import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { T, useLocale } from '@galalem/react-localization'
import { MathText } from '~/components'
import { CHAPTERS, chapterProgress, type TourStep } from '../tour-script'

/**
 * Odoo-style guided-tour overlay.
 *
 * Everything outside the spotlight is dimmed + blurred by four bands laid
 * around the anchor's rect — the hole is genuinely uncovered, so the
 * highlighted element stays fully interactive while the rest of the page
 * is visually muted and (via `blockOutside`) click-inert.
 *
 * Anchors are resolved from `data-tour="…"` attributes in the same
 * document. That is the whole reason the tutorial renders inline instead
 * of in a sandboxed iframe.
 */

type Rect = { top: number; left: number; width: number; height: number }

interface Props {
  step: TourStep
  index: number
  /** True when the step's advance condition is satisfied (or it is click-advance). */
  canAdvance: boolean
  /**
   * The scene has reached a state no further action can clear — stage 2's
   * shot budget spent with stars still dark. The step's predicate can never
   * fire, and the Retry button sits outside the spotlight, so the way out
   * has to live in here.
   */
  stuck?: boolean
  onRetry?: () => void
  onNext: () => void
  onBack: () => void
  onSkip: () => void
}

/**
 * Tour copy carries both `$math$` and `**bold**`. MathText handles only the
 * former, so split on bold first and hand each run to MathText.
 */
function TourBody({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean)
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('**') && p.endsWith('**') ? (
          <strong key={i}>
            <MathText>{p.slice(2, -2)}</MathText>
          </strong>
        ) : (
          <MathText key={i}>{p}</MathText>
        ),
      )}
    </>
  )
}

const PAD = 8
const TOOLTIP_W = 360
const GAP = 14
/** Matches the exercise page's single-column breakpoint. */
const NARROW = 800

function readRect(selector: string | undefined, padding: number): Rect | null {
  if (!selector) return null
  const el = document.querySelector(
    selector.startsWith('.') || selector.startsWith('#') || selector.startsWith('[')
      ? selector
      : `[data-tour="${selector}"]`,
  )
  if (!el) return null
  const r = el.getBoundingClientRect()
  if (r.width === 0 && r.height === 0) return null
  return {
    top: r.top - padding,
    left: r.left - padding,
    width: r.width + padding * 2,
    height: r.height + padding * 2,
  }
}

export function TourOverlay({ step, index, canAdvance, stuck, onRetry, onNext, onBack, onSkip }: Props) {
  const { __ } = useLocale()
  const chapter = chapterProgress(index)
  const [rect, setRect] = useState<Rect | null>(null)
  const rafRef = useRef(0)

  // vw/vh are read during render, so resize/rotate must force one.
  const [, bumpViewport] = useState(0)
  useEffect(() => {
    const onResize = () => bumpViewport((n) => n + 1)
    window.addEventListener('resize', onResize)
    window.addEventListener('orientationchange', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('orientationchange', onResize)
    }
  }, [])

  // In real fullscreen only the fullscreen element's subtree renders, so a
  // body-mounted overlay would silently vanish. Portal into it instead.
  const [fsEl, setFsEl] = useState<Element | null>(null)
  useEffect(() => {
    const sync = () => setFsEl(document.fullscreenElement)
    sync()
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [])

  const padding = step.padding ?? PAD

  // Track the anchor every frame: the scene animates, the page scrolls, and
  // the canvas is aspect-ratio driven so it moves on resize.
  // Only commit when the rect actually moved — otherwise every frame would
  // re-render the tooltip, and KaTeX would re-typeset the body 60x a second.
  const lastRef = useRef<Rect | null>(null)
  const track = useCallback(() => {
    const next = readRect(step.anchor, padding)
    const prev = lastRef.current
    const changed =
      (next === null) !== (prev === null) ||
      (!!next &&
        !!prev &&
        (Math.abs(next.top - prev.top) > 0.5 ||
          Math.abs(next.left - prev.left) > 0.5 ||
          Math.abs(next.width - prev.width) > 0.5 ||
          Math.abs(next.height - prev.height) > 0.5))
    if (changed) {
      lastRef.current = next
      setRect(next)
    }
    rafRef.current = requestAnimationFrame(track)
  }, [step.anchor, padding])

  useLayoutEffect(() => {
    rafRef.current = requestAnimationFrame(track)
    return () => cancelAnimationFrame(rafRef.current)
  }, [track])

  // Bring the anchor into view when a step opens.
  useEffect(() => {
    if (!step.anchor) return
    const el = document.querySelector(
      step.anchor.startsWith('.') || step.anchor.startsWith('#') || step.anchor.startsWith('[')
        ? step.anchor
        : `[data-tour="${step.anchor}"]`,
    )
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [step.anchor, step.id])

  // Enter advances when allowed; Escape skips.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && canAdvance) {
        e.preventDefault()
        onNext()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [canAdvance, onNext])

  const vw = window.innerWidth
  const vh = window.innerHeight
  // On phones there is no room to float a card beside anything, and a
  // floating card would cover the canvas the student needs to touch. Dock
  // it to the bottom instead — the anchor is scrolled to centre, above it.
  const narrow = vw <= NARROW

  // Centred card when the step has no anchor (stage intros, the sign-off).
  const centered = !rect && !narrow

  let tipTop = vh / 2 - 90
  let tipLeft = vw / 2 - TOOLTIP_W / 2
  let placement: 'top' | 'bottom' | 'left' | 'right' | 'center' | 'sheet' = 'center'

  if (narrow) {
    placement = 'sheet'
  } else if (rect) {
    const spaceBelow = vh - (rect.top + rect.height)
    const spaceAbove = rect.top
    const spaceRight = vw - (rect.left + rect.width)
    const preferred = step.placement ?? 'auto'

    const fitsBelow = spaceBelow > 190
    const fitsAbove = spaceAbove > 190
    const fitsRight = spaceRight > TOOLTIP_W + GAP

    if (preferred === 'right' || (preferred === 'auto' && fitsRight && rect.width < vw * 0.5)) {
      placement = 'right'
      tipLeft = rect.left + rect.width + GAP
      tipTop = Math.max(16, rect.top + rect.height / 2 - 90)
    } else if (preferred === 'left' && spaceAbove >= 0) {
      placement = 'left'
      tipLeft = Math.max(16, rect.left - TOOLTIP_W - GAP)
      tipTop = Math.max(16, rect.top + rect.height / 2 - 90)
    } else if (preferred === 'top' || (preferred === 'auto' && !fitsBelow && fitsAbove)) {
      placement = 'top'
      tipLeft = Math.min(Math.max(16, rect.left + rect.width / 2 - TOOLTIP_W / 2), vw - TOOLTIP_W - 16)
      tipTop = rect.top - GAP
    } else {
      placement = 'bottom'
      tipLeft = Math.min(Math.max(16, rect.left + rect.width / 2 - TOOLTIP_W / 2), vw - TOOLTIP_W - 16)
      tipTop = rect.top + rect.height + GAP
    }
  }

  const bands: Rect[] = rect
    ? [
        { top: 0, left: 0, width: vw, height: Math.max(0, rect.top) },
        { top: rect.top + rect.height, left: 0, width: vw, height: Math.max(0, vh - rect.top - rect.height) },
        { top: Math.max(0, rect.top), left: 0, width: Math.max(0, rect.left), height: rect.height },
        {
          top: Math.max(0, rect.top),
          left: rect.left + rect.width,
          width: Math.max(0, vw - rect.left - rect.width),
          height: rect.height,
        },
      ]
    : [{ top: 0, left: 0, width: vw, height: vh }]

  const tree = (
    <div className="tour-root">
      {bands.map((b, i) => (
        <div
          key={i}
          className={`tour-band${step.blockOutside === false ? ' is-passthrough' : ''}`}
          style={{ top: b.top, left: b.left, width: b.width, height: b.height }}
        />
      ))}

      {rect && <div className="tour-ring" style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }} />}

      <div
        className={`tour-tip is-${placement}${centered ? ' is-centered' : ''}`}
        style={
          placement === 'sheet'
            ? undefined
            : {
                top: tipTop,
                left: tipLeft,
                width: TOOLTIP_W,
                transform: placement === 'top' ? 'translateY(-100%)' : undefined,
              }
        }
        role="dialog"
        aria-live="polite"
      >
        <div className="tour-progress">
          <div className="head">
            <span className="chapter-title"><T>{chapter.title}</T></span>
            <span className="count">{chapter.position} / {chapter.length}</span>
          </div>
          <div className="chapter-rail" aria-label={`Chapter ${chapter.chapter + 1} of ${CHAPTERS.length}`}>
            {CHAPTERS.map((c, i) => (
              <span
                key={c.id}
                className={`pip${i < chapter.chapter ? ' is-done' : ''}${i === chapter.chapter ? ' is-active' : ''}`}
              >
                <span className="fill" style={i === chapter.chapter ? { width: `${(chapter.position / chapter.length) * 100}%` } : undefined} />
              </span>
            ))}
          </div>
        </div>

        {step.title && (
          <h3 className="tour-title">
            <T>{step.title}</T>
          </h3>
        )}
        <div className="tour-body">
          <TourBody text={__(step.body)} />
        </div>

        <div className="tour-actions">
          {/* Muted, footer-left, away from the eye's path to Continue —
              reachable when wanted, not an invitation. */}
          <button type="button" className="skip" onClick={onSkip}>
            <T>pages.tutorial.skip</T>
          </button>
          {index > 0 && (
            <button type="button" className="btn rounded-pill btn-subtle btn-sm" onClick={onBack}>
              <T>common.literal.back</T>
            </button>
          )}
          {step.advance === 'click' ? (
            <button type="button" className="btn btn-primary rounded-pill btn-sm" onClick={onNext}>
              <T>{step.cta ?? 'common.literal.next'}</T>
            </button>
          ) : canAdvance ? (
            <button type="button" className="btn btn-primary rounded-pill btn-sm" onClick={onNext}>
              <T>{step.cta ?? 'pages.tutorial.continue'}</T>
            </button>
          ) : stuck && onRetry ? (
            <button type="button" className="btn btn-primary rounded-pill btn-sm" onClick={onRetry}>
              <span className="icon-rtl-flip">↻</span> <T>pages.tutorial.tour_retry</T>
            </button>
          ) : (
            <span className="tour-waiting">
              <span className="pulse" aria-hidden="true" />
              <T>{step.waiting ?? 'pages.tutorial.waiting_default'}</T>
            </span>
          )}
        </div>
      </div>
    </div>
  )

  return createPortal(tree, (fsEl as HTMLElement | null) ?? document.body)
}
