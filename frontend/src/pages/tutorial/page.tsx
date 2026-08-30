import { T, useLocale } from '@galalem/react-localization'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from '@galalem/react-router'
import { MathText } from '~/components'
import { TutorialScene, type SceneAllow, type SceneSnapshot, type TutorialSceneHandle } from './components/TutorialScene'
import { TourOverlay } from './components/TourOverlay'
import { TOUR, stepAllow } from './tour-script'
import { useMe, refreshMe } from '~/hooks/useMe'
import { tutorial } from '~/lib/tutorial'
// Shared chrome — see the snapshot note below.
import '../exercise/styles.scss'
import './styles.scss'

/**
 * Guided tutorial page.
 *
 * DELIBERATE SNAPSHOT of the exercise-page chrome. It reuses the real
 * `.exercise-page` SCSS classes so visual changes propagate for free —
 * only behavior can diverge. Revisit when the exercise page's chrome
 * markup changes. See ROADMAP "Tutorial / onboarding page".
 *
 * Copy is hardcoded English during UI iteration; trilingual key
 * extraction is a dedicated final substep.
 */

const STAGES = [
  { index: 1, key: 'observe', peekable: false },
  { index: 2, key: 'experiment', peekable: false },
  { index: 3, key: 'evaluate', peekable: true },
] as const

const TOTAL_STAGES = STAGES.length


export function TutorialPage() {
  const { __ } = useLocale()
  const { me } = useMe()
  const [stage, setStage] = useState(1)
  const [snapshot, setSnapshot] = useState<SceneSnapshot | null>(null)
  const [done, setDone] = useState(false)
  const sceneRef = useRef<TutorialSceneHandle>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)

  // ─── Tour ─────────────────────────────────────────────────────────────
  const [stepIndex, setStepIndex] = useState(0)
  const [tourActive, setTourActive] = useState(true)
  const step = TOUR[stepIndex]

  // The tour owns what the student may touch; free play once it ends.
  const allow: SceneAllow = tourActive && step ? stepAllow(step) : { drag: true, fire: true }

  // Steps drive the stage forward — never backward, so a student who
  // clicks Next early is not yanked back a stage.
  useEffect(() => {
    if (!tourActive || !step) return
    setStage((cur) => (step.stage > cur ? step.stage : cur))
  }, [tourActive, step])

  // ─── Fullscreen (mirrors the exercise page, including the iOS fallback) ──
  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === canvasRef.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  async function toggleFullscreen() {
    const orientation = screen.orientation as ScreenOrientation & {
      lock?: (o: 'landscape' | 'portrait' | 'natural' | 'any') => Promise<void>
      unlock?: () => void
    }
    const el = canvasRef.current
    if (!el) return
    if (isFullscreen) {
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => {})
      else setIsFullscreen(false)
      try { orientation?.unlock?.() } catch { /* noop */ }
    } else {
      if (typeof el.requestFullscreen === 'function') {
        try {
          await el.requestFullscreen()
          try { await orientation?.lock?.('landscape') } catch { /* noop */ }
          return
        } catch {
          // fall through to the CSS fallback (iOS iPhone Safari)
        }
      }
      setIsFullscreen(true)
    }
  }

  // Fullscreen renders only the canvas subtree, so a step pointing at the
  // instruction rail or the controls would spotlight something invisible.
  // Drop out of fullscreen when the tour moves to such a step.
  useEffect(() => {
    if (!tourActive || !step || !isFullscreen) return
    const anchor = step.anchor
    if (!anchor) return
    const el = document.querySelector(
      anchor.startsWith('.') || anchor.startsWith('#') || anchor.startsWith('[')
        ? anchor
        : `[data-tour="${anchor}"]`,
    )
    const insideCanvas = !!el && !!canvasRef.current?.contains(el)
    if (insideCanvas) return
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    else setIsFullscreen(false)
  }, [tourActive, step, isFullscreen])

  // Signed-in users get the flag on their row; guests get localStorage,
  // which is synced up if they register later.
  const markDone = useCallback(
    (outcome: 'completed' | 'skipped') => {
      if (me) {
        void tutorial.markServer(outcome).then(() => refreshMe())
      } else {
        tutorial.setLocal(outcome)
      }
    },
    [me],
  )

  const canAdvance =
    !step || step.advance === 'click' ? true : !!snapshot && step.advance(snapshot)

  const onTourNext = () => {
    if (stepIndex >= TOUR.length - 1) {
      setTourActive(false)
      setDone(true)
      markDone('completed')
      return
    }
    setStepIndex((i) => i + 1)
  }
  const onTourBack = () => setStepIndex((i) => Math.max(0, i - 1))
  const onTourSkip = () => {
    setTourActive(false)
    markDone('skipped')
  }

  const stageInfo = STAGES[stage - 1]!
  const isLastStage = stage === TOTAL_STAGES
  const canSubmit = snapshot?.canSubmit ?? false

  const onSnapshot = useCallback((s: SceneSnapshot) => setSnapshot(s), [])

  const onNext = () => {
    if (isLastStage) setDone(true)
    else setStage((s) => s + 1)
  }

  const restart = () => {
    setDone(false)
    setStage(1)
    setStepIndex(0)
    setTourActive(true)
  }

  return (
    <div className="exercise-page tutorial-page">
      <Link to="/" className="back-link">
        <span className="icon-rtl-flip">←</span> <T>pages.tutorial.back_home</T>
      </Link>

      <h1 className="exercise-title"><T>pages.tutorial.title</T></h1>

      <div className="stage-rail">
        {Array.from({ length: TOTAL_STAGES }, (_, i) => (
          <div key={i} className={`segment${i + 1 <= stage ? ' is-filled' : ''}`} />
        ))}
      </div>

      <div className="stage-label">{__('pages.exercise.stage_label').replace('{n}', String(stage))}</div>
      <h2 className="stage-title">
        <T>{`pages.tutorial.stage.${stageInfo.key}.name`}</T>
      </h2>
      <p className="instruction">
        <MathText>{__(`pages.tutorial.stage.${stageInfo.key}.instruction`)}</MathText>
      </p>

      <div className="concept">
        <div className="label"><T>pages.exercise.concept_label</T></div>
        <div className="text">
          <MathText>{__(`pages.tutorial.stage.${stageInfo.key}.concept`)}</MathText>
        </div>
      </div>

      {snapshot?.readout && (
        <div className="readout">
          <div className="label"><T>pages.exercise.readout_label</T></div>
          <div className="value">{snapshot.readout}</div>
        </div>
      )}

      <div className={`canvas${isFullscreen ? ' is-fullscreen' : ''}`} ref={canvasRef}>
        <div className="canvas-controls">
          <button
            type="button"
            onClick={toggleFullscreen}
            aria-label={__(isFullscreen ? 'pages.tutorial.fullscreen_exit' : 'pages.tutorial.fullscreen_enter')}
            data-tour="fullscreen"
          >
            <i className={`bi ${isFullscreen ? 'bi-fullscreen-exit' : 'bi-arrows-fullscreen'}`} aria-hidden="true" />
          </button>
        </div>

        <TutorialScene ref={sceneRef} stage={stage} allow={allow} onSnapshot={onSnapshot} />

        {done && (
          <div className="completion-overlay">
            <div className="completion-card">
              <div className="badge"><T>pages.tutorial.complete_badge</T></div>
              <h2><T>pages.tutorial.complete_title</T></h2>
              <div className="completion-actions">
                <Link to="/#catalogue" className="btn btn-primary rounded-pill">
                  <T>pages.tutorial.complete_browse</T>
                </Link>
                <button type="button" className="btn rounded-pill btn-subtle" onClick={restart}>
                  <T>pages.tutorial.replay</T>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="controls">
        <button type="button" className="btn rounded-pill btn-subtle" onClick={() => sceneRef.current?.reset()}>
          <span className="icon-rtl-flip">↻</span> <T>common.literal.retry</T>
        </button>
        {stageInfo.peekable && (
          <button type="button" className="btn rounded-pill btn-subtle" onClick={() => sceneRef.current?.peek()}>
            <T>pages.exercise.peek</T>
          </button>
        )}
        <button type="button" className="btn btn-primary rounded-pill" disabled={!canSubmit} onClick={onNext}>
          <T>{isLastStage ? 'common.literal.finish' : 'common.literal.next'}</T>
        </button>
      </div>

      {tourActive && step && (
        <TourOverlay
          step={step}
          index={stepIndex}
          canAdvance={canAdvance}
          onNext={onTourNext}
          onBack={onTourBack}
          onSkip={onTourSkip}
        />
      )}

      {!tourActive && !done && (
        <button type="button" className="tour-resume" onClick={restart}>
          <i className="bi bi-play-circle" aria-hidden="true" /> <T>pages.tutorial.resume_tour</T>
        </button>
      )}
    </div>
  )
}
