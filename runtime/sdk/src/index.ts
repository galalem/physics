/**
 * @physics/sdk — entry point.
 *
 * Exercises call `defineExercise({...})` from their `main.tsx`. React hooks
 * are exported separately from `@physics/sdk/react` — this file is the
 * bootstrap-only surface.
 */

import { createElement, type FC } from 'react'
import { createRoot } from 'react-dom/client'
import { createRuntime } from './internal/runtime.js'

export type ExerciseConfig = {
  /** Exercise slug (matches the DB row + bundle folder name). */
  id: string
  /** Bump this when the state shape changes — used for the SAVE_STATE version check. */
  version: string
  /** The scene component. Rendered inside the iframe's #root. */
  render: FC
  /** Optional list of asset URLs to preload before INITIALIZED is sent. */
  assets?: readonly string[]
  /** Reserved: Zod schema to validate the INIT.config payload. */
  configSchema?: unknown
}

/**
 * Bootstrap the exercise. Call this exactly once from your entry file.
 *
 * Order of operations:
 *   1. Create the runtime bridge (starts listening for host messages).
 *   2. Send READY to the host.
 *   3. Wait for INIT from the host (contains seed, locale, config, savedState).
 *   4. Preload any static assets listed on `config.assets`.
 *   5. Mount the React tree.
 *   6. Send INITIALIZED to the host.
 */
export function defineExercise(config: ExerciseConfig): void {
  const runtime = createRuntime(config.id, config.version)
  runtime.sendReady()

  runtime
    .waitForInit()
    .then(async (init) => {
      if (config.assets && config.assets.length > 0) {
        await Promise.all(config.assets.map(preloadAsset))
      }

      const container = typeof document !== 'undefined' ? document.getElementById('root') : null
      if (!container) {
        runtime.log('error', 'defineExercise: no #root element in document')
        return
      }

      createRoot(container).render(createElement(config.render))
      runtime.sendInitialized(Boolean(init.savedState))
    })
    .catch((err: unknown) => {
      runtime.log('error', 'defineExercise: bootstrap failed', { err: String(err) })
    })
}

async function preloadAsset(url: string): Promise<void> {
  if (/\.(png|jpg|jpeg|gif|svg|webp)$/i.test(url)) {
    await new Promise<void>((resolve, reject) => {
      const img = new Image()
      img.onload = (): void => resolve()
      img.onerror = (): void => reject(new Error(`preload failed: ${url}`))
      img.src = url
    })
    return
  }
  // Everything else: fetch + discard. Warms the HTTP cache.
  await fetch(url)
}

// Re-export select protocol types + version for convenience.
export { PROTOCOL_VERSION } from '@physics/protocol'
export type {
  CompletePayload,
  ErrorPayload,
  ExerciseToHostMessage,
  HostToExerciseMessage,
  InitPayload,
  ProtocolVersion,
} from '@physics/protocol'
