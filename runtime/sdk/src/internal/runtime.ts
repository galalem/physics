/**
 * Runtime bridge — singleton that owns:
 *   - the postMessage listener (host → exercise)
 *   - the exercise's public state (seed, locale, config, paused, restored)
 *   - message send helpers (READY, PROGRESS, SAVE_STATE, COMPLETE, ERROR, LOG)
 *   - subscription for React hooks (useSyncExternalStore-friendly)
 *   - handler slots for RESET and HINT_REQUEST
 *
 * All React hooks call `getRuntime()` to reach this instance. Created
 * once by `defineExercise`; throws if referenced before that.
 */

import { PROTOCOL_VERSION } from '@physics/protocol'
import type {
  CompletePayload,
  ExerciseToHostMessage,
  HostToExerciseMessage,
  InitPayload,
  MessageId,
  ProgressPayload,
  SavedStateBlob,
  StageInfo,
} from '@physics/protocol'

const SDK_VERSION = '0.0.0'
const SAVE_DEBOUNCE_MS = 500
const PROGRESS_THROTTLE_MS = 500

export type HintResult = { text: string; mediaUrl?: string }
export type CompleteResult = {
  success: boolean
  score?: number
  attemptSummary?: Record<string, unknown>
}

/**
 * Reserved key inside `savedState` where the host stamps the last-reached
 * stage on every STAGE_CHANGED. Read on INIT to auto-resume the exercise
 * at the right stage. Must stay in lockstep with @physics/host's constant.
 */
export const STAGE_STATE_KEY = '__stage__'

class Runtime {
  // Public reactive state (React hooks read this)
  seed = 0
  locale = 'en'
  config: Record<string, unknown> = {}
  restored: unknown | null = null
  paused = false
  currentStage = 1

  // Internal
  private stateVersion: number
  private lastCheckpoint: SavedStateBlob | null = null
  private saveDebounce: ReturnType<typeof setTimeout> | null = null
  private progressThrottle: ReturnType<typeof setTimeout> | null = null
  private pendingProgress: ProgressPayload | null = null
  private msgSeq = 0
  private initResolve: ((p: InitPayload) => void) | null = null
  private readonly initPromise: Promise<InitPayload>
  private startTime = 0
  private completeCalled = false

  private listeners = new Set<() => void>()
  private hintHandler: ((level: number) => HintResult | Promise<HintResult>) | null = null
  private resetHandler: (() => void) | null = null
  private nextHandler: (() => void) | null = null
  private peekHandler: (() => void) | null = null

  constructor(
    public readonly exerciseId: string,
    public readonly exerciseVersion: string,
  ) {
    this.stateVersion = hashString(exerciseVersion)
    this.initPromise = new Promise<InitPayload>((resolve) => {
      this.initResolve = resolve
    })
    if (typeof window !== 'undefined') {
      window.addEventListener('message', this.handleMessage)
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Public API used by defineExercise + hooks
  // ─────────────────────────────────────────────────────────────────────

  sendReady(): void {
    this.send('READY', {
      protocolVersion: PROTOCOL_VERSION,
      sdkVersion: SDK_VERSION,
      exerciseId: this.exerciseId,
      exerciseVersion: this.exerciseVersion,
    })
  }

  waitForInit(): Promise<InitPayload> {
    return this.initPromise
  }

  sendInitialized(resumedFromSave: boolean): void {
    this.send('INITIALIZED', { ok: true, resumedFromSave })
  }

  reportProgress(
    fraction: number,
    extras?: { stage?: number; readout?: string; canSubmit?: boolean },
  ): void {
    const clamped = Math.max(0, Math.min(1, fraction))
    const payload: ProgressPayload = { fraction: clamped }
    if (extras?.stage !== undefined) payload.stage = extras.stage
    if (extras?.readout !== undefined) payload.readout = extras.readout
    if (extras?.canSubmit !== undefined) payload.canSubmit = extras.canSubmit
    this.pendingProgress = payload
    if (this.progressThrottle) return
    this.progressThrottle = setTimeout(() => {
      this.progressThrottle = null
      if (this.pendingProgress) {
        this.send('PROGRESS', this.pendingProgress)
        this.pendingProgress = null
      }
    }, PROGRESS_THROTTLE_MS)
  }

  declareStages(stages: readonly StageInfo[]): void {
    this.send('STAGES', { stages })
  }

  setStage(index: number): void {
    this.currentStage = index
    this.send('STAGE_CHANGED', { index })
    this.notify()
  }

  checkpoint(state: unknown): void {
    let blob: SavedStateBlob
    try {
      blob = JSON.stringify(state)
    } catch (err) {
      this.log('error', 'checkpoint: JSON.stringify failed', { err: String(err) })
      return
    }
    this.lastCheckpoint = blob
    if (this.saveDebounce) clearTimeout(this.saveDebounce)
    this.saveDebounce = setTimeout(() => {
      this.saveDebounce = null
      this.emitSaveStateNow()
    }, SAVE_DEBOUNCE_MS)
  }

  complete(result: CompleteResult): void {
    if (this.completeCalled) {
      this.log('warn', 'useComplete called more than once; ignoring subsequent calls')
      return
    }
    this.completeCalled = true
    const timeMs = Math.round(performance.now() - this.startTime)
    const payload: CompletePayload = { success: result.success, timeMs }
    if (result.score !== undefined) payload.score = result.score
    if (result.attemptSummary !== undefined) payload.attemptSummary = result.attemptSummary
    this.send('COMPLETE', payload)
  }

  registerReset(handler: (() => void) | null): void {
    this.resetHandler = handler
  }

  registerHint(
    handler: ((level: number) => HintResult | Promise<HintResult>) | null,
  ): void {
    this.hintHandler = handler
  }

  registerNext(handler: (() => void) | null): void {
    this.nextHandler = handler
  }

  registerPeek(handler: (() => void) | null): void {
    this.peekHandler = handler
  }

  log(level: 'debug' | 'info' | 'warn' | 'error', message: string, data?: unknown): void {
    if (!isDev()) return
    const payload = data === undefined ? { level, message } : { level, message, data }
    this.send('LOG', payload)
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Internal
  // ─────────────────────────────────────────────────────────────────────

  private handleMessage = (event: MessageEvent): void => {
    const raw = event.data as { v?: number; type?: string } | null
    if (!raw || typeof raw !== 'object' || raw.v !== PROTOCOL_VERSION) return
    const msg = raw as HostToExerciseMessage

    switch (msg.type) {
      case 'INIT':
        this.handleInit(msg.payload)
        break
      case 'PAUSE':
        this.setPaused(true)
        break
      case 'RESUME':
        this.setPaused(false)
        break
      case 'RESET':
        this.handleReset(msg.payload.newSeed, msg.payload.resetStage === true)
        break
      case 'SET_STAGE':
        this.setStage(msg.payload.index)
        break
      case 'HINT_REQUEST':
        void this.handleHintRequest(msg.id, msg.payload.level)
        break
      case 'REQUEST_STATE':
        this.emitSaveStateNow()
        break
      case 'NEXT':
        this.nextHandler?.()
        break
      case 'PEEK':
        this.peekHandler?.()
        break
    }
  }

  private handleInit(p: InitPayload): void {
    this.seed = p.seed
    this.locale = p.locale
    this.config = p.config
    this.restored = null
    this.currentStage = 1
    if (p.savedState) {
      try {
        const parsed = JSON.parse(p.savedState) as unknown
        this.restored = parsed
        // Auto-resume: if the host stamped a stage on prior STAGE_CHANGED
        // events (see @physics/host), pick it up so the exercise mounts at
        // the last-reached stage — no author code required.
        if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const stage = (parsed as Record<string, unknown>)[STAGE_STATE_KEY]
          if (typeof stage === 'number' && Number.isFinite(stage) && stage >= 1) {
            this.currentStage = Math.floor(stage)
          }
        }
      } catch {
        this.restored = null
      }
    }
    this.startTime = performance.now()
    // Resumed at a non-first stage → tell chrome now so its rail highlight
    // matches before the exercise's first render (author code no longer
    // needs to fire an initial STAGE_CHANGED).
    if (this.currentStage !== 1) {
      this.send('STAGE_CHANGED', { index: this.currentStage })
    }
    if (this.initResolve) {
      this.initResolve(p)
      this.initResolve = null
    }
    this.notify()
  }

  private setPaused(p: boolean): void {
    if (this.paused === p) return
    this.paused = p
    this.notify()
  }

  private handleReset(newSeed: number, resetStage: boolean): void {
    this.seed = newSeed
    this.restored = null
    this.completeCalled = false
    this.lastCheckpoint = null
    this.startTime = performance.now()
    if (resetStage) {
      this.currentStage = 1
      // Notify the host chrome so its stage rail highlight rewinds too.
      this.send('STAGE_CHANGED', { index: 1 })
    }
    this.resetHandler?.()
    this.notify()
  }

  private async handleHintRequest(replyToId: MessageId, level: number): Promise<void> {
    if (!this.hintHandler) return
    try {
      const result = await this.hintHandler(level)
      this.send('HINT_AVAILABLE', result, replyToId)
    } catch (err) {
      this.send('ERROR', {
        code: 'hint_failed',
        message: String(err),
        recoverable: false,
      })
    }
  }

  private emitSaveStateNow(): void {
    if (this.lastCheckpoint === null) return
    this.send('SAVE_STATE', {
      payload: this.lastCheckpoint,
      stateVersion: this.stateVersion,
    })
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }

  private send<T extends ExerciseToHostMessage['type']>(
    type: T,
    payload: Extract<ExerciseToHostMessage, { type: T }>['payload'],
    replyTo?: MessageId,
  ): void {
    const envelope: ExerciseToHostMessage = {
      v: PROTOCOL_VERSION,
      type,
      id: `e_${(++this.msgSeq).toString(36)}`,
      ts: Date.now(),
      payload,
      ...(replyTo ? { replyTo } : {}),
    } as ExerciseToHostMessage
    // Loopback-safe: when top-level (preview / dev), window.parent === window,
    // so window.parent.postMessage(...) posts to self — which the FakeHost
    // also listens on. In production (iframe), window.parent is the LMS host.
    //
    // targetOrigin="*": in production the SDK runs inside a
    // sandbox="allow-scripts" iframe with opaque "null" origin, and the
    // parent is the LMS at a real origin; we can't target by URL. In
    // preview the parent is ourselves (loopback). The host filters by
    // `event.source` so `*` is safe on the wire.
    if (typeof window !== 'undefined') {
      window.parent.postMessage(envelope, '*')
    }
  }
}

function hashString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 0x5bd1e995)
    h ^= h >>> 15
  }
  return h >>> 0
}

function isDev(): boolean {
  try {
    const meta = import.meta as { env?: { DEV?: boolean } }
    return meta.env?.DEV === true
  } catch {
    return false
  }
}

let instance: Runtime | null = null

export function createRuntime(id: string, version: string): Runtime {
  if (instance) {
    throw new Error('@physics/sdk: defineExercise called more than once')
  }
  instance = new Runtime(id, version)
  return instance
}

export function getRuntime(): Runtime {
  if (!instance) {
    throw new Error('@physics/sdk: hook called before defineExercise()')
  }
  return instance
}

/** For testing only. */
export function _resetRuntime(): void {
  instance = null
}

export type { Runtime }
