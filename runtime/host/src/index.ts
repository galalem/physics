/**
 * @physics/host — LMS-side iframe manager for sandboxed exercises.
 *
 * Public API is intentionally tiny:
 *   - `mount(container, config)` — creates the iframe, returns a Handle.
 *   - Types for MountConfig, MountHandle, LifecycleState.
 *
 * See docs/physicsruntimedesign.md §9 for the intended usage shape.
 */

import { Host } from './internal/host.js'
import type { HintAvailablePayload } from '@physics/protocol'

export type { LifecycleState, MountConfig } from './internal/host.js'
export { STAGE_STATE_KEY } from './internal/host.js'

export type MountHandle = {
  /** PAUSE the exercise. No-op if not currently running. */
  pause(): void
  /** RESUME the exercise. No-op if not currently paused. */
  resume(): void
  /**
   * RESET the exercise with a new seed. Puts the iframe back through INIT.
   * Old saved state is dropped (per runtime doc §7). Stage stays put —
   * this is the mid-attempt Retry gesture.
   */
  reset(newSeed: number): void
  /**
   * Full restart — new seed AND rewind to stage 1. Used by the completion
   * overlay's Restart button.
   */
  restart(newSeed: number): void
  /** Jump to any 1-indexed stage. Dormant until a stage-tab UI is wired. */
  setStage(index: number): void
  /**
   * Send a HINT_REQUEST and resolve when HINT_AVAILABLE arrives.
   * Correlated via the message envelope's replyTo.
   */
  requestHint(level: number): Promise<HintAvailablePayload>
  /** Ask the exercise to emit a fresh SAVE_STATE now (bypassing debounce). */
  requestState(): void
  /** Chrome's Next / Finish button — exercise decides what to do. */
  next(): void
  /** Chrome's Peek button (visible per stage's `peekable` flag). */
  peek(): void
  /** Tear down: remove iframe, detach listeners, cancel timers. */
  destroy(): void
  /** Current lifecycle state. Reads through to the Host instance. */
  readonly state: import('./internal/host.js').LifecycleState
}

/**
 * Mount a sandboxed exercise iframe inside `container`.
 *
 * @param container - HTMLElement or a CSS selector string.
 * @param config - See {@link MountConfig}.
 * @returns A {@link MountHandle} for controlling the mounted exercise.
 */
export function mount(
  container: HTMLElement | string,
  config: import('./internal/host.js').MountConfig,
): MountHandle {
  const element =
    typeof container === 'string'
      ? document.querySelector<HTMLElement>(container)
      : container
  if (!element) {
    throw new Error(`@physics/host.mount: container not found: ${String(container)}`)
  }

  const host = new Host(element, config)

  return {
    pause: () => host.pause(),
    resume: () => host.resume(),
    reset: (newSeed) => host.reset(newSeed),
    restart: (newSeed) => host.restart(newSeed),
    setStage: (index) => host.setStage(index),
    requestHint: (level) => host.requestHint(level),
    requestState: () => host.requestState(),
    next: () => host.next(),
    peek: () => host.peek(),
    destroy: () => host.destroy(),
    get state() {
      return host.state
    },
  }
}

// Re-export protocol version for LMS use.
export { PROTOCOL_VERSION } from '@physics/protocol'
