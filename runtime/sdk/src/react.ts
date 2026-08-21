/**
 * @physics/sdk/react — the ~15 hooks exercises call from their scenes.
 *
 * All hooks call `getRuntime()` internally; the runtime is a singleton
 * created by `defineExercise` in the same iframe. Calling a hook before
 * `defineExercise` throws.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { getRuntime, type CompleteResult, type HintResult } from './internal/runtime.js'
import { createRng, type Rng } from './internal/prng.js'
import type { StageInfo } from '@physics/protocol'

export type { Rng, HintResult, CompleteResult, StageInfo }

export type ProgressExtras = {
  /** 1-indexed current stage. Chrome uses this to highlight the stage rail. */
  stage?: number
  /** Live readout text for chrome's left-rail readout box. */
  readout?: string
  /** If true, chrome's Next / Finish button becomes enabled. */
  canSubmit?: boolean
}

// ─────────────────────────────────────────────────────────────────────────
// useInit — snapshot of the INIT payload the exercise received
// ─────────────────────────────────────────────────────────────────────────

export function useInit<S = unknown, C = Record<string, unknown>>(): {
  seed: number
  locale: string
  config: C
  restored: S | null
} {
  const rt = getRuntime()
  return {
    seed: rt.seed,
    locale: rt.locale,
    config: rt.config as C,
    restored: rt.restored as S | null,
  }
}

// ─────────────────────────────────────────────────────────────────────────
// useSeed — Rng scoped to the current seed (recreated on RESET)
// ─────────────────────────────────────────────────────────────────────────

export function useSeed(): Rng {
  const rt = getRuntime()
  const seed = useSyncExternalStore(
    (cb) => rt.subscribe(cb),
    () => rt.seed,
    () => rt.seed,
  )
  return useMemo(() => createRng(seed), [seed])
}

// ─────────────────────────────────────────────────────────────────────────
// usePaused — reactive to PAUSE / RESUME messages from host
// ─────────────────────────────────────────────────────────────────────────

export function usePaused(): boolean {
  const rt = getRuntime()
  return useSyncExternalStore(
    (cb) => rt.subscribe(cb),
    () => rt.paused,
    () => rt.paused,
  )
}

// ─────────────────────────────────────────────────────────────────────────
// useTicker — rAF loop with dt clamp at 1/30s, auto-pauses on paused + hidden
// ─────────────────────────────────────────────────────────────────────────

export function useTicker(fn: (dt: number) => void): void {
  const paused = usePaused()
  const fnRef = useRef(fn)
  fnRef.current = fn

  useEffect(() => {
    if (paused) return
    let raf = 0
    let lastTime = performance.now()
    let stopped = false

    const tick = (now: number): void => {
      if (stopped) return
      // Clamp dt so a hidden-tab-resume can't hand the sim 10s of dt.
      const dtSec = Math.min((now - lastTime) / 1000, 1 / 30)
      lastTime = now
      if (typeof document === 'undefined' || !document.hidden) {
        fnRef.current(dtSec)
      }
      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame((n) => {
      lastTime = n
      raf = requestAnimationFrame(tick)
    })

    return () => {
      stopped = true
      cancelAnimationFrame(raf)
    }
  }, [paused])
}

// ─────────────────────────────────────────────────────────────────────────
// useCheckpoint — JSON-serializes state, debounced SAVE_STATE at 500ms
// ─────────────────────────────────────────────────────────────────────────

export function useCheckpoint<S>(): (state: S) => void {
  const rt = getRuntime()
  return useCallback((state: S) => rt.checkpoint(state), [rt])
}

// ─────────────────────────────────────────────────────────────────────────
// useComplete — idempotent; second call is a dev warning + no-op
// ─────────────────────────────────────────────────────────────────────────

export function useComplete(): (result: CompleteResult) => void {
  const rt = getRuntime()
  return useCallback((result: CompleteResult) => rt.complete(result), [rt])
}

// ─────────────────────────────────────────────────────────────────────────
// useProgress — throttled to ~2 Hz by the runtime
// ─────────────────────────────────────────────────────────────────────────

export function useProgress(): (fraction: number, extras?: ProgressExtras) => void {
  const rt = getRuntime()
  return useCallback(
    (fraction: number, extras?: ProgressExtras) => rt.reportProgress(fraction, extras),
    [rt],
  )
}

// ─────────────────────────────────────────────────────────────────────────
// useReset — SDK re-seeds; author provides reset logic for their state
// ─────────────────────────────────────────────────────────────────────────

export function useReset(handler: () => void): void {
  const rt = getRuntime()
  const handlerRef = useRef(handler)
  handlerRef.current = handler
  useEffect(() => {
    const stable = (): void => handlerRef.current()
    rt.registerReset(stable)
    return () => rt.registerReset(null)
  }, [rt])
}

// ─────────────────────────────────────────────────────────────────────────
// Stage-related hooks — exercise-declared, chrome-rendered
// ─────────────────────────────────────────────────────────────────────────

/**
 * Declare the exercise's stages to the chrome once. Convention is 3 stages
 * (Observe / Experiment / Evaluate) but this is not enforced.
 * Pass a stable array (memoized) — this hook re-sends whenever the array
 * identity changes, so avoid inline literals.
 */
export function useDeclareStages(stages: readonly StageInfo[]): void {
  const rt = getRuntime()
  useEffect(() => {
    rt.declareStages(stages)
  }, [rt, stages])
}

/**
 * Set the current stage — SDK owns the reactive value. Emits STAGE_CHANGED
 * to chrome and updates any component reading via `useCurrentStage()`.
 * Accepts any index (forward or backward), so a future stage-tab UI can
 * wire directly into this without SDK changes.
 */
export function useSetStage(): (index: number) => void {
  const rt = getRuntime()
  return useCallback((index: number) => rt.setStage(index), [rt])
}

/**
 * Reactive read of the SDK-owned current stage. Reflects INIT-time resume
 * (via the `__stage__` save-state key), author-invoked `setStage(...)`,
 * and host-triggered SET_STAGE / RESET (with `resetStage`) messages.
 */
export function useCurrentStage(): number {
  const rt = getRuntime()
  return useSyncExternalStore(
    (cb) => rt.subscribe(cb),
    () => rt.currentStage,
    () => rt.currentStage,
  )
}

/** Register a handler for chrome's Next / Finish button click. */
export function useNext(handler: () => void): void {
  const rt = getRuntime()
  const handlerRef = useRef(handler)
  handlerRef.current = handler
  useEffect(() => {
    const stable = (): void => handlerRef.current()
    rt.registerNext(stable)
    return () => rt.registerNext(null)
  }, [rt])
}

/** Register a handler for chrome's Peek button click. */
export function usePeek(handler: () => void): void {
  const rt = getRuntime()
  const handlerRef = useRef(handler)
  handlerRef.current = handler
  useEffect(() => {
    const stable = (): void => handlerRef.current()
    rt.registerPeek(stable)
    return () => rt.registerPeek(null)
  }, [rt])
}

// ─────────────────────────────────────────────────────────────────────────
// useHint — author returns hint text (per locale). Text lives in the bundle.
// ─────────────────────────────────────────────────────────────────────────

export function useHint(
  handler: (level: number) => HintResult | Promise<HintResult>,
): void {
  const rt = getRuntime()
  const handlerRef = useRef(handler)
  handlerRef.current = handler
  useEffect(() => {
    const stable = (level: number): HintResult | Promise<HintResult> =>
      handlerRef.current(level)
    rt.registerHint(stable)
    return () => rt.registerHint(null)
  }, [rt])
}

// ─────────────────────────────────────────────────────────────────────────
// useAsset — Suspense-integrated URL loader (images / json / audio-url)
// ─────────────────────────────────────────────────────────────────────────

const assetCache = new Map<string, Promise<unknown> | { value: unknown }>()

export function useAsset<T = unknown>(url: string): T {
  const cached = assetCache.get(url)
  if (cached !== undefined) {
    if (cached instanceof Promise) throw cached
    return cached.value as T
  }
  const promise = loadAsset(url).then(
    (value) => {
      assetCache.set(url, { value })
      return value
    },
    (err) => {
      assetCache.delete(url)
      throw err
    },
  )
  assetCache.set(url, promise)
  throw promise
}

async function loadAsset(url: string): Promise<unknown> {
  if (/\.(png|jpg|jpeg|gif|svg|webp)$/i.test(url)) {
    return await loadImage(url)
  }
  if (/\.json$/i.test(url)) {
    const res = await fetch(url)
    return (await res.json()) as unknown
  }
  // Audio / other: return the URL; author feeds it to useAudio().play(url).
  return url
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = (): void => resolve(img)
    img.onerror = (): void => reject(new Error(`useAsset: failed to load ${url}`))
    img.src = url
  })
}

// ─────────────────────────────────────────────────────────────────────────
// useAudio — paused-aware sound API (minimal V1)
// ─────────────────────────────────────────────────────────────────────────

export type AudioApi = {
  play(id: string): void
  stop(id: string): void
  setVolume(v: number): void
}

class AudioMgr {
  private sounds = new Map<string, HTMLAudioElement>()
  private volume = 1
  private muted = false

  play(id: string): void {
    let audio = this.sounds.get(id)
    if (!audio) {
      audio = new Audio(id)
      this.sounds.set(id, audio)
    }
    audio.volume = this.muted ? 0 : this.volume
    void audio.play().catch(() => {
      /* autoplay policies can reject; swallow */
    })
  }

  stop(id: string): void {
    const audio = this.sounds.get(id)
    if (audio) {
      audio.pause()
      audio.currentTime = 0
    }
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v))
    const effective = this.muted ? 0 : this.volume
    for (const audio of this.sounds.values()) audio.volume = effective
  }

  setMuted(m: boolean): void {
    this.muted = m
    const effective = m ? 0 : this.volume
    for (const audio of this.sounds.values()) audio.volume = effective
  }
}

const audioMgr = new AudioMgr()

export function useAudio(): AudioApi {
  const paused = usePaused()
  useEffect(() => {
    audioMgr.setMuted(paused)
  }, [paused])
  return audioMgr
}

// ─────────────────────────────────────────────────────────────────────────
// useDpr — device pixel ratio, reactive to changes
// ─────────────────────────────────────────────────────────────────────────

export function useDpr(): number {
  const [dpr, setDpr] = useState(() =>
    typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
  )
  useEffect(() => {
    if (typeof window === 'undefined') return
    const mql = window.matchMedia(`(resolution: ${dpr}dppx)`)
    const handler = (): void => setDpr(window.devicePixelRatio || 1)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [dpr])
  return dpr
}

// ─────────────────────────────────────────────────────────────────────────
// useLog — dev-only structured log sent to the host as LOG messages
// ─────────────────────────────────────────────────────────────────────────

export function useLog(): (message: string, data?: unknown) => void {
  const rt = getRuntime()
  return useCallback((message: string, data?: unknown) => rt.log('info', message, data), [rt])
}
