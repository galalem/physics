/**
 * @physics/protocol
 *
 * The postMessage contract between the LMS host chrome and a sandboxed
 * exercise iframe. Types + a single version constant. Zero runtime code.
 *
 * See docs/physicsruntimedesign.md §6 for the full protocol spec.
 */

// ─────────────────────────────────────────────────────────────────────────
// Version
// ─────────────────────────────────────────────────────────────────────────

/**
 * Protocol major version. A mismatch causes the receiver to refuse to
 * proceed and emit an ERROR. Minor extensions must be additive-only
 * (new optional fields, new message types) — bump this when they aren't.
 */
export const PROTOCOL_VERSION = 1 as const

export type ProtocolVersion = typeof PROTOCOL_VERSION

// ─────────────────────────────────────────────────────────────────────────
// Envelope
// ─────────────────────────────────────────────────────────────────────────

/** Message correlation id. Set on every message. */
export type MessageId = string

/** Every message on the wire is wrapped in this envelope. */
export type Envelope<T extends string, P = undefined> = {
  /** Protocol major version. */
  v: ProtocolVersion
  /** Message kind — discriminant for the union. */
  type: T
  /** Unique id for correlation. Sender assigns. */
  id: MessageId
  /** Set on responses to correlated request/reply pairs. */
  replyTo?: MessageId
  /** Sender timestamp (ms since epoch). Debug-only, not authoritative. */
  ts: number
  /** Typed per message kind. */
  payload: P
}

// ─────────────────────────────────────────────────────────────────────────
// Shared value types
// ─────────────────────────────────────────────────────────────────────────

/**
 * The saved-state blob shipped in SAVE_STATE. Opaque to the host — never
 * introspected; passed back as-is via `INIT.savedState` on resume.
 */
export type SavedStateBlob = string

// ─────────────────────────────────────────────────────────────────────────
// Stages — exercise-authored, chrome-rendered
// ─────────────────────────────────────────────────────────────────────────

/** Metadata for one stage of an exercise. Emitted via STAGES. */
export type StageInfo = {
  /** 1-indexed stage number. */
  index: number
  /** Stage label (already localized by the exercise). */
  name: string
  /** Instruction text shown in chrome's left rail (localized). */
  instruction: string
  /** Optional "Concept" callout (e.g., a formula or short principle). */
  concept?: string
  /** If true, chrome shows the Peek button while this stage is active. */
  peekable?: boolean
}

// ─────────────────────────────────────────────────────────────────────────
// Host → Exercise payloads
// ─────────────────────────────────────────────────────────────────────────

export type InitPayload = {
  /** Seed for the exercise's PRNG. Load-bearing for reproducibility. */
  seed: number
  /** BCP-47 locale, e.g., 'fr', 'en', 'ar'. */
  locale: string
  /** Opaque saved state to restore, if any. Null on fresh attempts. */
  savedState?: SavedStateBlob | null
  /** Host-provided per-exercise config. Exercise validates against its own schema. */
  config: Record<string, unknown>
}

export type ResetPayload = {
  /** New seed for the retry. */
  newSeed: number
  /**
   * If true, the SDK also rewinds `currentStage` to 1 and emits a
   * STAGE_CHANGED. Used by the completion overlay's "Restart" button.
   * Omitted (or false) for the mid-attempt Retry, which keeps the
   * student on their current stage with only fresh seed + local state.
   */
  resetStage?: boolean
}

export type SetStagePayload = {
  /** 1-indexed target stage. */
  index: number
}

export type HintRequestPayload = {
  /** Which hint level the student asked for. 1-indexed. */
  level: number
}

// ─────────────────────────────────────────────────────────────────────────
// Exercise → Host payloads
// ─────────────────────────────────────────────────────────────────────────

export type ReadyPayload = {
  /** Protocol version the exercise's SDK was built against. */
  protocolVersion: ProtocolVersion
  /** SDK version the exercise was built with. */
  sdkVersion: string
  /** The exercise's id (matches the DB slug). */
  exerciseId: string
  /** The exercise's version, from `defineExercise.version`. */
  exerciseVersion: string
}

export type InitializedPayload = {
  ok: true
  /** True if `savedState` was provided in INIT and successfully applied. */
  resumedFromSave: boolean
}

export type ProgressPayload = {
  /** 0..1. Drives the host's visual progress bar. */
  fraction: number
  /** True if the Next / Finish button in chrome should be enabled. */
  canSubmit?: boolean
  /** Remaining hints available to request. */
  hintsRemaining?: number
  /** Current 1-indexed stage, for chrome's stage-rail highlight. */
  stage?: number
  /** Optional live readout text for chrome's left-rail readout box. */
  readout?: string
}

export type StagesPayload = {
  stages: readonly StageInfo[]
}

export type StageChangedPayload = {
  /** 1-indexed. */
  index: number
}

export type SaveStatePayload = {
  /** JSON-serialized snapshot of the exercise's state. */
  payload: SavedStateBlob
  /** Tags the state with `defineExercise.version` so version drift is detectable. */
  stateVersion: number
}

export type HintAvailablePayload = {
  /** The hint text, in the current locale. */
  text: string
  /** Optional media URL (image / audio) to render alongside. */
  mediaUrl?: string
}

export type CompletePayload = {
  success: boolean
  /** Optional numeric score. Semantics are per-exercise. */
  score?: number
  /** Total elapsed time in the attempt (ms). */
  timeMs: number
  /** Free-form summary the exercise wants to hand back. */
  attemptSummary?: Record<string, unknown>
}

export type ErrorPayload = {
  /** Machine-friendly error code. */
  code: string
  /** Human-readable message (in locale if possible). */
  message: string
  /** V1 protocol always emits unrecoverable errors. */
  recoverable: false
}

export type LogPayload = {
  level: 'debug' | 'info' | 'warn' | 'error'
  message: string
  data?: unknown
}

// ─────────────────────────────────────────────────────────────────────────
// Message unions
// ─────────────────────────────────────────────────────────────────────────

export type HostToExerciseMessage =
  | Envelope<'INIT', InitPayload>
  | Envelope<'PAUSE', undefined>
  | Envelope<'RESUME', undefined>
  | Envelope<'RESET', ResetPayload>
  | Envelope<'SET_STAGE', SetStagePayload>
  | Envelope<'HINT_REQUEST', HintRequestPayload>
  | Envelope<'REQUEST_STATE', undefined>
  | Envelope<'NEXT', undefined>
  | Envelope<'PEEK', undefined>

export type ExerciseToHostMessage =
  | Envelope<'READY', ReadyPayload>
  | Envelope<'INITIALIZED', InitializedPayload>
  | Envelope<'STAGES', StagesPayload>
  | Envelope<'STAGE_CHANGED', StageChangedPayload>
  | Envelope<'PROGRESS', ProgressPayload>
  | Envelope<'SAVE_STATE', SaveStatePayload>
  | Envelope<'HINT_AVAILABLE', HintAvailablePayload>
  | Envelope<'COMPLETE', CompletePayload>
  | Envelope<'ERROR', ErrorPayload>
  | Envelope<'LOG', LogPayload>

export type AnyMessage = HostToExerciseMessage | ExerciseToHostMessage

// Convenience unions of message-type discriminants
export type HostToExerciseMessageType = HostToExerciseMessage['type']
export type ExerciseToHostMessageType = ExerciseToHostMessage['type']
