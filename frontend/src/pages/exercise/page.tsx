import { T, useLocale } from '@galalem/react-localization'
import { Link, useRouter } from '@galalem/react-router'
import { mount, type MountHandle } from '@physics/host'
import { useEffect, useRef, useState } from 'react'
import { MathText } from '~/components'
import { bread, type ApiError } from '~/lib/api'
import { useAttempts } from '~/hooks/useAttempts'
import './styles.scss'

// Backend GET /api/v1/exercises/:slug response shape.
type ExerciseDetail = {
  slug: string
  title: string
  formula: string | null
  description: string | null
  bundleUrl: string | null
  tags: string[]
  before: Array<{ slug: string; title: string }>
  after: Array<{ slug: string; title: string }>
  // Present only when the request is authenticated.
  resumableAttemptId?: string | null
  completed?: boolean
}

type State =
  | { kind: 'loading' }
  | { kind: 'success'; exercise: ExerciseDetail }
  | { kind: 'error'; status: number; error: ApiError }

// Minimal shapes for @physics/protocol payloads we consume. Kept local
// instead of adding @physics/protocol as a direct dep — the protocol is
// v1-locked (see PROTOCOL_VERSION) so drift is negligible.
type StageInfo = {
  index: number
  name: string
  instruction: string
  concept?: string
  peekable?: boolean
}

type CompletePayload = {
  success: boolean
  score?: number
  timeMs: number
}

function newSeed() {
  return Math.floor(Math.random() * 1_000_000)
}

export function ExercisePage() {
  const router = useRouter()
  const slug = (router.params.slug as string | undefined) ?? ''
  const [state, setState] = useState<State>({ kind: 'loading' })
  const { locale, __ } = useLocale()

  const canvasRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<MountHandle | null>(null)
  const attempt = useAttempts()
  const [iframeReady, setIframeReady] = useState(false)
  const [iframeError, setIframeError] = useState<string | null>(null)
  const [paywallUrl, setPaywallUrl] = useState<string | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)

  // Playback state fed by @physics/host callbacks.
  const [stages, setStages] = useState<StageInfo[]>([])
  const [currentStage, setCurrentStage] = useState(1)
  const [readout, setReadout] = useState<string | null>(null)
  const [canSubmit, setCanSubmit] = useState(false)
  const [completed, setCompleted] = useState<CompletePayload | null>(null)

  function load() {
    if (!slug) {
      setState({ kind: 'error', status: 404, error: { code: 'not_found', message: 'No slug' } })
      return
    }
    setState({ kind: 'loading' })
    bread.read<ExerciseDetail>('/exercises', slug).then((res) => {
      if (res.error) return setState({ kind: 'error', status: res.status, error: res.error })
      setState({ kind: 'success', exercise: res.content })
    })
  }

  useEffect(load, [slug, locale])

  // Mount the exercise iframe once we have data. Re-mounts if the slug,
  // resumable-attempt hint, or locale changes. Resume when GET
  // /exercises/:slug embeds `resumableAttemptId` (D25 grace + no
  // entitlement re-check); otherwise POST a fresh attempt.
  const bundleUrl = state.kind === 'success' ? state.exercise.bundleUrl : null
  const exerciseSlug = state.kind === 'success' ? state.exercise.slug : null
  const resumableAttemptId = state.kind === 'success' ? state.exercise.resumableAttemptId ?? null : null
  useEffect(() => {
    if (!bundleUrl || !exerciseSlug || !canvasRef.current) return

    setIframeReady(false)
    setIframeError(null)
    setPaywallUrl(null)
    setStages([])
    setCurrentStage(1)
    setReadout(null)
    setCanSubmit(false)
    setCompleted(null)

    let cancelled = false
    let handle: MountHandle | null = null

    ;(async () => {
      const res = resumableAttemptId
        ? await attempt.resume(resumableAttemptId)
        : await attempt.start(exerciseSlug, newSeed())
      if (cancelled) return
      if (res.error) {
        // Session expired between page load and mount — auth guard would
        // have caught it otherwise. Hand back to /login preserving intent.
        if (res.error.code === 'authentication_required') {
          router.replace(`/login?redirectUrl=${encodeURIComponent(router.path)}`)
          return
        }
        if (res.error.code === 'entitlement_required') {
          setPaywallUrl(typeof res.error.checkoutUrl === 'string' ? res.error.checkoutUrl : '/pricing')
          return
        }
        setIframeError(res.error.message || __('pages.exercise.iframe_error_eyebrow'))
        return
      }

      // Always use the exercise-detail bundleUrl (already signed by
      // /exercises/:slug after checkAccess). Resume is version-matched
      // server-side, so the detail URL equals the attempt's locked URL
      // as pure strings — one signed source of truth, no branching.
      // `savedStateBlob` is null on start, populated on resume.
      handle = mount(canvasRef.current!, {
        bundleUrl,
        exerciseId: exerciseSlug,
        attemptId: res.content.id,
        seed: res.content.seed,
        savedState: res.content.savedStateBlob,
        locale: locale ?? 'fr',
        onReady: () => setIframeReady(true),
        onError: (e) => setIframeError(e.message || e.code || 'Exercise error'),
        onLoadTimeout: () => setIframeError(__('pages.exercise.iframe_timeout')),
        // __ intentionally not in this effect's deps — the library reads
        // from a global dictionary, so a stale closure still returns fresh
        // translations after the user switches locale (which triggers the
        // effect anyway).
        onStages: (p) => setStages([...p.stages]),
        onStageChanged: (p) => setCurrentStage(p.index),
        onProgress: (p) => {
          if (p.readout !== undefined) setReadout(p.readout)
          if (p.canSubmit !== undefined) setCanSubmit(p.canSubmit)
          if (p.stage !== undefined) setCurrentStage(p.stage)
        },
        onSaveState: (blob, version) => attempt.patchState(blob, version),
        onComplete: (r) => {
          setCompleted(r)
          attempt.complete(r.success)
        },
      })
      handleRef.current = handle
    })()

    return () => {
      cancelled = true
      handle?.destroy()
      handleRef.current = null
      attempt.reset()
    }
  }, [bundleUrl, exerciseSlug, resumableAttemptId, locale])

  // Sync React state with the browser's fullscreen state so ESC / F11 /
  // browser-native exits flip our class off too. Also covers the case
  // where the user right-clicks → exit fullscreen.
  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === canvasRef.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  async function toggleFullscreen() {
    // TS lib.dom.d.ts is behind reality here — `screen.orientation.lock`
    // exists on Android Chrome/Firefox but isn't in the standard type. The
    // narrow structural type covers both `lock` and `unlock` as optional.
    const orientation = screen.orientation as ScreenOrientation & {
      lock?: (o: 'landscape' | 'portrait' | 'natural' | 'any') => Promise<void>
      unlock?: () => void
    }
    const el = canvasRef.current
    if (!el) return
    if (isFullscreen) {
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => {})
      else setIsFullscreen(false)
      // Best-effort unlock — irrelevant on desktop, quietly ignored on iOS.
      try { orientation?.unlock?.() } catch { /* noop */ }
    } else {
      if (typeof el.requestFullscreen === 'function') {
        try {
          await el.requestFullscreen()
          // Android Chrome + Firefox honor orientation.lock() only from
          // inside a fullscreen element with a fresh user gesture. iOS
          // Safari doesn't allow it at all — .catch swallows the
          // rejection so the flow doesn't fail on unsupported browsers.
          try { await orientation?.lock?.('landscape') } catch { /* noop */ }
          return
        } catch {
          // fall through to CSS fallback (iOS iPhone Safari)
        }
      }
      setIsFullscreen(true)
    }
  }

  async function onReset() {
    if (!exerciseSlug) return
    setCompleted(null)
    const res = await attempt.start(exerciseSlug, newSeed())
    if (res.error) return
    handleRef.current?.reset(res.content.seed)
  }
  async function onRestart() {
    if (!exerciseSlug) return
    setCompleted(null)
    const res = await attempt.start(exerciseSlug, newSeed())
    if (res.error) return
    handleRef.current?.restart(res.content.seed)
  }
  function onGoHome() {
    router.push('/')
  }
  function onNext() {
    handleRef.current?.next()
  }
  function onPeek() {
    handleRef.current?.peek()
  }

  if (state.kind === 'loading') {
    return (
      <div className="exercise-loading">
        <div className="spinner-border text-primary" role="status">
          <span className="visually-hidden"><T>common.literal.loading</T></span>
        </div>
      </div>
    )
  }

  if (state.kind === 'error') {
    const isNotFound = state.status === 404 || state.error.code === 'not_found'
    return (
      <div className="exercise-error">
        <div className="error-card">
          <h1>
            <T>
              {isNotFound
                ? 'pages.exercise.error_not_found_title'
                : 'pages.exercise.error_generic_title'}
            </T>
          </h1>
          <p>
            <T>
              {isNotFound
                ? 'pages.exercise.error_not_found_body'
                : 'pages.exercise.error_generic_body'}
            </T>
          </p>
          <div className="actions">
            {!isNotFound && (
              <button type="button" className="btn btn-primary rounded-pill" onClick={load}>
                <T>common.literal.retry</T>
              </button>
            )}
            <Link to="/#catalogue" className="btn rounded-pill btn-subtle">
              <span className="icon-rtl-flip">←</span> <T>pages.exercise.back_to_catalogue</T>
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const ex = state.exercise

  const totalStages = stages.length || 3
  const currentStageInfo = stages[currentStage - 1]
  const isLastStage = stages.length > 0 && currentStage >= stages.length

  return (
    <div className="exercise-page">
        <Link to="/#catalogue" className="back-link">
          <span className="icon-rtl-flip">←</span> <T>pages.exercise.back_to_catalogue</T>
        </Link>

        <h1 className="exercise-title">{ex.title}</h1>

        <div className="stage-rail">
          {Array.from({ length: totalStages }, (_, i) => (
            <div
              key={i}
              className={`segment${i + 1 <= currentStage ? ' is-filled' : ''}`}
            />
          ))}
        </div>

        <div className="stage-label">
          {__('pages.exercise.stage_label').replace('{n}', String(currentStage))}
        </div>
        <h2 className="stage-title">{currentStageInfo?.name ?? ''}</h2>
        <p className="instruction">
          <MathText>{currentStageInfo?.instruction ?? ''}</MathText>
        </p>

        {currentStageInfo?.concept && (
          <div className="concept">
            <div className="label"><T>pages.exercise.concept_label</T></div>
            <div className="text">
              <MathText>{currentStageInfo.concept}</MathText>
            </div>
          </div>
        )}

        <div className={`canvas${isFullscreen ? ' is-fullscreen' : ''}`} ref={canvasRef}>
          <div className="canvas-controls">
            <button
              type="button"
              onClick={toggleFullscreen}
              aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            >
              <i className={`bi ${isFullscreen ? 'bi-fullscreen-exit' : 'bi-arrows-fullscreen'}`} aria-hidden="true" />
            </button>
          </div>
          {(paywallUrl || iframeError || !iframeReady) && (
            <div className="loading-overlay">
              {paywallUrl ? (
                <>
                  <div className="eyebrow"><T>pages.exercise.paywall_eyebrow</T></div>
                  <div className="title"><T>pages.exercise.paywall_title</T></div>
                  <div className="hint"><T>pages.exercise.paywall_hint</T></div>
                  <Link to={paywallUrl} className="btn btn-primary rounded-pill mt-3">
                    <T>pages.exercise.paywall_cta</T>
                  </Link>
                </>
              ) : iframeError ? (
                <>
                  <div className="eyebrow"><T>pages.exercise.iframe_error_eyebrow</T></div>
                  <div className="title">
                    {__('pages.exercise.iframe_error_title').replace('{title}', ex.title)}
                  </div>
                  <div className="hint">{iframeError}</div>
                </>
              ) : (
                <>
                  <div className="eyebrow"><T>pages.exercise.iframe_loading_eyebrow</T></div>
                  <div className="title">{ex.title}</div>
                  <div className="hint"><T>pages.exercise.iframe_loading_hint</T></div>
                  <div
                    className="progress-indicator"
                    role="progressbar"
                    aria-label={__('common.literal.loading')}
                  />
                  <div className="fullscreen-hint"><T>pages.exercise.fullscreen_hint</T></div>
                </>
              )}
            </div>
          )}
          {completed && (
            <div className={`completion-overlay${completed.success ? '' : ' is-failed'}`}>
              <div className="completion-card">
                <div className="badge">
                  <T>
                    {completed.success
                      ? 'pages.exercise.completion_success_badge'
                      : 'pages.exercise.completion_failed_badge'}
                  </T>
                </div>
                <h2>
                  <T>
                    {completed.success
                      ? 'pages.exercise.completion_success_title'
                      : 'pages.exercise.completion_failed_title'}
                  </T>
                </h2>
                {completed.score !== undefined && (
                  <div className="meta">
                    {__('pages.exercise.score_label').replace('{n}', String(completed.score))}
                  </div>
                )}
                <div className="meta">
                  {__('pages.exercise.time_label').replace(
                    '{n}',
                    (completed.timeMs / 1000).toFixed(1),
                  )}
                </div>
                <div className="completion-actions">
                  <button
                    type="button"
                    className="btn btn-primary rounded-pill"
                    onClick={onRestart}
                  >
                    <span className="icon-rtl-flip">↻</span> <T>pages.exercise.completion_restart</T>
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline-secondary rounded-pill"
                    onClick={onGoHome}
                  >
                    <T>pages.exercise.completion_go_home</T>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {readout && (
          <div className="readout">
            <div className="label"><T>pages.exercise.readout_label</T></div>
            <div className="value">{readout}</div>
          </div>
        )}

        <div className="controls">
          <button type="button" className="btn rounded-pill btn-subtle" onClick={onReset}>
            <span className="icon-rtl-flip">↻</span> <T>common.literal.retry</T>
          </button>
          {currentStageInfo?.peekable && (
            <button type="button" className="btn rounded-pill btn-subtle" onClick={onPeek}>
              <T>pages.exercise.peek</T>
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary rounded-pill"
            disabled={!canSubmit}
            onClick={onNext}
          >
            <T>{isLastStage ? 'common.literal.finish' : 'common.literal.next'}</T>
          </button>
        </div>
    </div>
  )
}
