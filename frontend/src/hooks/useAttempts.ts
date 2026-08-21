import { useCallback, useRef, useState } from 'react'
import { http, type ContentResponse, type Response } from '~/lib/api'

export interface Attempt {
  id: string
  exerciseSlug: string
  exerciseVersionAtStart: string
  seed: number
  startedAt: string
  lastActionAt: string
  completedAt: string | null
  succeeded: boolean
  savedStateBlob: string | null
  savedStateVersion: number | null
  log: string
}

// Owns the current attempt id via ref so save-state and complete callbacks
// always target the latest row — `start()` mints a fresh attempt while the
// iframe (and its captured closures) may still be alive from a prior mount.
export function useAttempts() {
  const idRef = useRef<string | null>(null)
  const [current, setCurrent] = useState<Attempt | null>(null)

  const start = useCallback(async (exerciseSlug: string, seed: number) => {
    const res = (await http.post('/my/attempts', { exerciseSlug, seed })) as ContentResponse<Attempt>
    if (!res.error) {
      idRef.current = res.content.id
      setCurrent(res.content)
    }
    return res
  }, [])

  // Resume flow — pairs with `resumableAttemptId` from GET /exercises/:slug.
  // Skips the entitlement-gated POST since the row already exists (D25 grace
  // rule: in-flight attempts finish even if the plan expires mid-play).
  const resume = useCallback(async (attemptId: string) => {
    const res = (await http.get(`/my/attempts/${attemptId}`)) as ContentResponse<Attempt>
    if (!res.error) {
      idRef.current = res.content.id
      setCurrent(res.content)
    }
    return res
  }, [])

  // keepalive:true so a final save just before unload (tab close, nav)
  // survives — otherwise the browser aborts in-flight fetches with the
  // document and the write is lost.
  const patchState = useCallback((blob: string, version: number): Promise<Response> | void => {
    const id = idRef.current
    if (!id) return
    return http.patch(`/my/attempts/${id}`, { savedStateBlob: blob, savedStateVersion: version }, { keepalive: true })
  }, [])

  const complete = useCallback((succeeded: boolean): Promise<Response> | void => {
    const id = idRef.current
    if (!id) return
    return http.post(`/my/attempts/${id}/complete`, { succeeded }, { keepalive: true })
  }, [])

  const reset = useCallback(() => {
    idRef.current = null
    setCurrent(null)
  }, [])

  return { current, start, resume, patchState, complete, reset }
}
