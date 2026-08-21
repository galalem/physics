/**
 * FakeHost — simulates the LMS host inside the same window as the exercise.
 *
 * Since preview runs the exercise WITHOUT an iframe, both sides share one
 * `window`. `window.parent === window` at top-level, so the SDK's
 * `window.parent.postMessage()` loops back to `window`. Both sides listen on
 * `window` and filter by message-type family (each only handles messages
 * intended for it — no explicit source check needed).
 *
 * State is subscribed to by the React chrome for rendering.
 */

import { PROTOCOL_VERSION } from '@physics/protocol'
import type {
  CompletePayload,
  ErrorPayload,
  ExerciseToHostMessage,
  HintAvailablePayload,
  HostToExerciseMessage,
  MessageId,
  StageInfo,
} from '@physics/protocol'

export type PreviewSnapshot = {
  seed: number
  locale: string
  paused: boolean
  stages: readonly StageInfo[]
  currentStage: number
  progress: number
  readout: string | null
  canSubmit: boolean
  hintsRemaining: number | null
  lastCheckpoint: string | null
  lastHint: HintAvailablePayload | null
  completed: CompletePayload | null
  errored: ErrorPayload | null
  ready: boolean
  initialized: boolean
}

export type PreviewInitConfig = {
  /** Initial seed. If omitted, a random one is generated. */
  seed?: number
  /** Initial locale. Default 'fr'. */
  locale?: string
  /** Config to pass to the exercise via INIT. */
  config?: Record<string, unknown>
  /** Opaque saved-state blob to resume from. */
  savedState?: string | null
}

export class FakeHost {
  private msgSeq = 0
  private listeners = new Set<() => void>()

  private snapshot: PreviewSnapshot = {
    seed: 0,
    locale: 'fr',
    paused: false,
    stages: [],
    currentStage: 1,
    progress: 0,
    readout: null,
    canSubmit: false,
    hintsRemaining: null,
    lastCheckpoint: null,
    lastHint: null,
    completed: null,
    errored: null,
    ready: false,
    initialized: false,
  }

  private initConfig: Required<Omit<PreviewInitConfig, 'savedState'>> & {
    savedState: string | null
  }

  constructor(initConfig: PreviewInitConfig = {}) {
    this.initConfig = {
      seed: initConfig.seed ?? Math.floor(Math.random() * 1_000_000),
      locale: initConfig.locale ?? 'fr',
      config: initConfig.config ?? {},
      savedState: initConfig.savedState ?? null,
    }
    this.snapshot.seed = this.initConfig.seed
    this.snapshot.locale = this.initConfig.locale
    window.addEventListener('message', this.handleMessage)
  }

  // ─────────────────────────────────────────────────────────────────────
  // React subscription
  // ─────────────────────────────────────────────────────────────────────

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot(): PreviewSnapshot {
    return this.snapshot
  }

  private notify(patch: Partial<PreviewSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch }
    for (const listener of this.listeners) listener()
  }

  // ─────────────────────────────────────────────────────────────────────
  // Actions (called by chrome UI)
  // ─────────────────────────────────────────────────────────────────────

  pause(): void {
    if (this.snapshot.paused) return
    this.notify({ paused: true })
    this.send('PAUSE', undefined)
  }

  resume(): void {
    if (!this.snapshot.paused) return
    this.notify({ paused: false })
    this.send('RESUME', undefined)
  }

  next(): void {
    this.send('NEXT', undefined)
  }

  peek(): void {
    this.send('PEEK', undefined)
  }

  resetWithNewSeed(): void {
    const newSeed = Math.floor(Math.random() * 1_000_000)
    this.initConfig.seed = newSeed
    this.resetSnapshotForRetry(newSeed)
    this.send('RESET', { newSeed })
  }

  resetWithSameSeed(): void {
    // Cleanest way to restart with the same seed: full page reload.
    // The exercise will bootstrap again and receive the same seed via INIT.
    window.location.reload()
  }

  setSeed(newSeed: number): void {
    this.initConfig.seed = newSeed
    this.resetSnapshotForRetry(newSeed)
    this.send('RESET', { newSeed })
  }

  requestHint(level: number): void {
    this.send('HINT_REQUEST', { level })
  }

  requestState(): void {
    this.send('REQUEST_STATE', undefined)
  }

  destroy(): void {
    window.removeEventListener('message', this.handleMessage)
    this.listeners.clear()
  }

  // ─────────────────────────────────────────────────────────────────────
  // Internal — message handling
  // ─────────────────────────────────────────────────────────────────────

  private handleMessage = (event: MessageEvent): void => {
    const raw = event.data as { v?: number; type?: string } | null
    if (!raw || typeof raw !== 'object' || raw.v !== PROTOCOL_VERSION) return

    // Filter: only handle messages FROM the exercise (Exercise → Host).
    // Messages the host itself sends have Host → Exercise types (INIT, PAUSE,
    // RESET, HINT_REQUEST, REQUEST_STATE, NEXT, PEEK) — falling through the
    // switch is intentional.
    const msg = raw as ExerciseToHostMessage
    switch (msg.type) {
      case 'READY':
        this.handleReady()
        break
      case 'INITIALIZED':
        this.notify({ initialized: true })
        break
      case 'STAGES':
        this.notify({ stages: msg.payload.stages })
        break
      case 'STAGE_CHANGED':
        this.notify({ currentStage: msg.payload.index })
        break
      case 'PROGRESS': {
        const patch: Partial<PreviewSnapshot> = { progress: msg.payload.fraction }
        if (msg.payload.readout !== undefined) patch.readout = msg.payload.readout
        if (msg.payload.canSubmit !== undefined) patch.canSubmit = msg.payload.canSubmit
        if (msg.payload.hintsRemaining !== undefined) patch.hintsRemaining = msg.payload.hintsRemaining
        if (msg.payload.stage !== undefined) patch.currentStage = msg.payload.stage
        this.notify(patch)
        break
      }
      case 'SAVE_STATE':
        this.notify({ lastCheckpoint: msg.payload.payload })
        break
      case 'HINT_AVAILABLE':
        this.notify({ lastHint: msg.payload })
        break
      case 'COMPLETE':
        this.notify({ completed: msg.payload })
        break
      case 'ERROR':
        this.notify({ errored: msg.payload })
        break
      case 'LOG':
        // eslint-disable-next-line no-console
        console.log('[preview] exercise:', msg.payload.level, msg.payload.message, msg.payload.data)
        break
      default:
        // Falling through here is expected for Host → Exercise messages
        // that loop back to us on the same window.
        break
    }
  }

  private handleReady(): void {
    this.notify({ ready: true })
    // Auto-send INIT — same behavior as the real host.
    this.send('INIT', {
      seed: this.initConfig.seed,
      locale: this.initConfig.locale,
      savedState: this.initConfig.savedState,
      config: this.initConfig.config,
    })
  }

  private resetSnapshotForRetry(newSeed: number): void {
    this.notify({
      seed: newSeed,
      completed: null,
      errored: null,
      progress: 0,
      readout: null,
      canSubmit: false,
      currentStage: 1,
      lastHint: null,
      lastCheckpoint: null,
      initialized: false,
    })
  }

  // ─────────────────────────────────────────────────────────────────────
  // Internal — send
  // ─────────────────────────────────────────────────────────────────────

  private send<T extends HostToExerciseMessage['type']>(
    type: T,
    payload: Extract<HostToExerciseMessage, { type: T }>['payload'],
    id?: MessageId,
  ): void {
    const envelope: HostToExerciseMessage = {
      v: PROTOCOL_VERSION,
      type,
      id: id ?? `preview_${(++this.msgSeq).toString(36)}`,
      ts: Date.now(),
      payload,
    } as HostToExerciseMessage
    window.postMessage(envelope, window.location.origin)
  }
}
