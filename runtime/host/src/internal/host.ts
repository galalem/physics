/**
 * Host — one instance per mounted exercise iframe.
 *
 * Owns:
 *   - the iframe element (sandbox attribute enforced, no override — D18)
 *   - postMessage listener + envelope dispatch
 *   - lifecycle state machine (LOADING → INIT → RUNNING → PAUSED/DONE/FAILED)
 *   - LMS callback fan-out (onProgress, onSaveState, onComplete, onError, ...)
 *   - LMS-triggered actions (pause, resume, reset, requestHint, requestState)
 */

import { PROTOCOL_VERSION } from '@physics/protocol'
import type {
  CompletePayload,
  ErrorPayload,
  ExerciseToHostMessage,
  HintAvailablePayload,
  HostToExerciseMessage,
  InitializedPayload,
  LogPayload,
  MessageId,
  ProgressPayload,
  ReadyPayload,
  SaveStatePayload,
  StageChangedPayload,
  StagesPayload,
} from '@physics/protocol'

const DEFAULT_READY_TIMEOUT_MS = 30_000
const DEFAULT_INIT_TIMEOUT_MS = 15_000

export type LifecycleState =
  | 'idle'
  | 'loading'
  | 'init'
  | 'running'
  | 'paused'
  | 'done'
  | 'failed'

export type MountConfig = {
  /** URL to the exercise bundle folder (index.html or the folder itself). */
  bundleUrl: string
  /** Exercise slug — for logging and identity. */
  exerciseId: string
  /** Attempt id; passed to iframe via query param so it's visible during bootstrap. */
  attemptId: string
  /** PRNG seed. */
  seed: number
  /** BCP-47 locale ('fr', 'en', 'ar'). */
  locale: string
  /** Opaque saved-state blob from a previous attempt, if resuming. */
  savedState?: string | null
  /** Host-provided per-exercise config. */
  config?: Record<string, unknown>

  // Timeouts (per runtime doc §7)
  /** Time to wait for READY. Default 30_000 ms. */
  readyTimeoutMs?: number
  /** Time to wait for INITIALIZED after sending INIT. Default 15_000 ms. */
  initTimeoutMs?: number

  // Callbacks (all optional)
  onReady?: (info: ReadyPayload) => void
  onInitialized?: (info: InitializedPayload) => void
  onStages?: (payload: StagesPayload) => void
  onStageChanged?: (payload: StageChangedPayload) => void
  onProgress?: (p: ProgressPayload) => void
  onSaveState?: (blob: string, stateVersion: number) => void
  onHintAvailable?: (hint: HintAvailablePayload) => void
  onComplete?: (r: CompletePayload) => void
  onError?: (e: ErrorPayload) => void
  onLog?: (l: LogPayload) => void

  /** Called when READY hasn't arrived within `readyTimeoutMs`. */
  onLoadTimeout?: () => void
  /** Called when INITIALIZED hasn't arrived within `initTimeoutMs`. */
  onInitTimeout?: () => void
  /** Called for any lifecycle transition. */
  onStateChange?: (state: LifecycleState) => void
}

/**
 * Reserved key (Python-style dunder) inside `savedState` where the host
 * stamps the last-reached stage on every STAGE_CHANGED. Namespaced so it
 * can never collide with author state coming from useCheckpoint.
 */
export const STAGE_STATE_KEY = '__stage__'

export class Host {
  private readonly iframe: HTMLIFrameElement
  private readonly container: HTMLElement
  private readonly config: MountConfig
  private msgSeq = 0
  private _state: LifecycleState = 'idle'
  private hintCallbacks = new Map<MessageId, (hint: HintAvailablePayload) => void>()
  private readyTimeoutId: ReturnType<typeof setTimeout> | null = null
  private initTimeoutId: ReturnType<typeof setTimeout> | null = null
  private destroyed = false
  // Last SAVE_STATE the exercise emitted (via useCheckpoint). We merge any
  // subsequent host-synthesized stage save on top so we never clobber author
  // progress. Null until the exercise checkpoints for the first time.
  private lastAuthorState: Record<string, unknown> | null = null
  private lastAuthorStateVersion = 0

  constructor(container: HTMLElement, config: MountConfig) {
    this.container = container
    this.config = config
    this.iframe = this.createIframe()
    this.container.appendChild(this.iframe)
    window.addEventListener('message', this.handleMessage)
    this.setState('loading')
    this.readyTimeoutId = setTimeout(() => {
      this.readyTimeoutId = null
      config.onLoadTimeout?.()
    }, config.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS)
  }

  get state(): LifecycleState {
    return this._state
  }

  // ─────────────────────────────────────────────────────────────────────
  // Actions the LMS can trigger
  // ─────────────────────────────────────────────────────────────────────

  pause(): void {
    if (this._state !== 'running') return
    this.setState('paused')
    this.send('PAUSE', undefined)
  }

  resume(): void {
    if (this._state !== 'paused') return
    this.setState('running')
    this.send('RESUME', undefined)
  }

  reset(newSeed: number): void {
    // Runtime doc §7: RESET returns us to init-waiting state.
    this.setState('init')
    this.send('RESET', { newSeed })
  }

  /**
   * Full restart — RESET with a new seed AND rewind to stage 1. Used by
   * the completion overlay's Restart button. Distinct from `reset()`
   * (which is the mid-attempt Retry: new seed, stage stays put).
   */
  restart(newSeed: number): void {
    this.setState('init')
    this.send('RESET', { newSeed, resetStage: true })
  }

  /**
   * Jump the exercise to an arbitrary stage. Wired end-to-end (protocol +
   * SDK) so a future stage-tab UI can navigate freely. No UI callsite
   * exists yet in the LMS — intentionally dormant.
   */
  setStage(index: number): void {
    this.send('SET_STAGE', { index })
  }

  requestHint(level: number): Promise<HintAvailablePayload> {
    return new Promise<HintAvailablePayload>((resolve) => {
      const id = this.nextMessageId()
      this.hintCallbacks.set(id, resolve)
      this.send('HINT_REQUEST', { level }, id)
    })
  }

  requestState(): void {
    this.send('REQUEST_STATE', undefined)
  }

  next(): void {
    this.send('NEXT', undefined)
  }

  peek(): void {
    this.send('PEEK', undefined)
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    window.removeEventListener('message', this.handleMessage)
    if (this.readyTimeoutId) clearTimeout(this.readyTimeoutId)
    if (this.initTimeoutId) clearTimeout(this.initTimeoutId)
    if (this.iframe.parentNode === this.container) {
      this.container.removeChild(this.iframe)
    }
    this.hintCallbacks.clear()
  }

  // ─────────────────────────────────────────────────────────────────────
  // Internal
  // ─────────────────────────────────────────────────────────────────────

  private createIframe(): HTMLIFrameElement {
    const iframe = document.createElement('iframe')
    // D18: sandbox attribute is load-bearing. Enforced here with no override API.
    iframe.setAttribute('sandbox', 'allow-scripts')
    iframe.style.width = '100%'
    iframe.style.height = '100%'
    iframe.style.border = '0'
    iframe.style.display = 'block'

    const url = new URL(this.config.bundleUrl, window.location.href)
    // Query params bootstrap the SDK before INIT (see runtime doc §9).
    url.searchParams.set('attemptId', this.config.attemptId)
    url.searchParams.set('seed', String(this.config.seed))
    iframe.src = url.toString()

    return iframe
  }

  private handleMessage = (event: MessageEvent): void => {
    // Only accept messages from our own iframe's content window.
    if (event.source !== this.iframe.contentWindow) return

    const raw = event.data as { v?: number; type?: string } | null
    if (!raw || typeof raw !== 'object' || raw.v !== PROTOCOL_VERSION) return

    const msg = raw as ExerciseToHostMessage

    switch (msg.type) {
      case 'READY':
        this.handleReady(msg.payload)
        break
      case 'INITIALIZED':
        this.handleInitialized(msg.payload)
        break
      case 'STAGES':
        this.config.onStages?.(msg.payload)
        break
      case 'STAGE_CHANGED':
        this.handleStageChanged(msg.payload)
        break
      case 'PROGRESS':
        this.config.onProgress?.(msg.payload)
        break
      case 'SAVE_STATE':
        this.handleSaveState(msg.payload)
        break
      case 'HINT_AVAILABLE':
        this.handleHintAvailable(msg.replyTo, msg.payload)
        break
      case 'COMPLETE':
        this.setState('done')
        this.config.onComplete?.(msg.payload)
        break
      case 'ERROR':
        this.setState('failed')
        this.config.onError?.(msg.payload)
        break
      case 'LOG':
        this.config.onLog?.(msg.payload)
        break
    }
  }

  private handleReady(payload: ReadyPayload): void {
    if (this.readyTimeoutId) {
      clearTimeout(this.readyTimeoutId)
      this.readyTimeoutId = null
    }
    this.config.onReady?.(payload)

    // Auto-advance: send INIT.
    this.setState('init')
    this.send('INIT', {
      seed: this.config.seed,
      locale: this.config.locale,
      savedState: this.config.savedState ?? null,
      config: this.config.config ?? {},
    })
    this.initTimeoutId = setTimeout(() => {
      this.initTimeoutId = null
      this.config.onInitTimeout?.()
    }, this.config.initTimeoutMs ?? DEFAULT_INIT_TIMEOUT_MS)
  }

  private handleInitialized(payload: InitializedPayload): void {
    if (this.initTimeoutId) {
      clearTimeout(this.initTimeoutId)
      this.initTimeoutId = null
    }
    this.setState('running')
    this.config.onInitialized?.(payload)
  }

  private handleSaveState(payload: SaveStatePayload): void {
    try {
      const parsed = JSON.parse(payload.payload) as unknown
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        this.lastAuthorState = parsed as Record<string, unknown>
      }
    } catch {
      // Author state stays as previously known; unparseable blob still
      // forwards to the LMS as-is below.
    }
    this.lastAuthorStateVersion = payload.stateVersion
    this.config.onSaveState?.(payload.payload, payload.stateVersion)
  }

  private handleStageChanged(payload: StageChangedPayload): void {
    this.config.onStageChanged?.(payload)
    // Fire a synthesized save so stage is always persisted, even for
    // exercises that never call useCheckpoint. Merges under any last-seen
    // author state so this never clobbers author-persisted progress.
    const merged = {
      ...(this.lastAuthorState ?? {}),
      [STAGE_STATE_KEY]: payload.index,
    }
    let blob: string
    try {
      blob = JSON.stringify(merged)
    } catch {
      return
    }
    this.config.onSaveState?.(blob, this.lastAuthorStateVersion)
  }

  private handleHintAvailable(replyTo: MessageId | undefined, payload: HintAvailablePayload): void {
    if (replyTo) {
      const cb = this.hintCallbacks.get(replyTo)
      if (cb) {
        cb(payload)
        this.hintCallbacks.delete(replyTo)
      }
    }
    this.config.onHintAvailable?.(payload)
  }

  private setState(next: LifecycleState): void {
    if (this._state === next) return
    this._state = next
    this.config.onStateChange?.(next)
  }

  private send<T extends HostToExerciseMessage['type']>(
    type: T,
    payload: Extract<HostToExerciseMessage, { type: T }>['payload'],
    id?: MessageId,
  ): void {
    const envelope: HostToExerciseMessage = {
      v: PROTOCOL_VERSION,
      type,
      id: id ?? this.nextMessageId(),
      ts: Date.now(),
      payload,
    } as HostToExerciseMessage
    // sandbox="allow-scripts" (D18) gives the iframe an opaque "null"
    // origin, so we cannot target it by URL. The `event.source === iframe`
    // check on the receive side (line 191) is the real security gate;
    // targetOrigin="*" here is the only shape that actually delivers.
    this.iframe.contentWindow?.postMessage(envelope, '*')
  }

  private nextMessageId(): MessageId {
    return `h_${(++this.msgSeq).toString(36)}`
  }
}
