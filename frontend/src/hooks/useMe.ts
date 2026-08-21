import { useEffect, useState } from 'react'
import { http, type ContentResponse } from '~/lib/api'
import { auth, type Me } from '~/lib/auth'

type State = { me: Me | null; loading: boolean }

let cache: State = { me: null, loading: true }
let pending: Promise<void> | null = null
const listeners = new Set<(s: State) => void>()

function broadcast(next: State) {
  cache = next
  for (const l of listeners) l(next)
}

function fetchMe() {
  if (pending) return pending
  pending = (async () => {
    const res = (await http.get('my/profile')) as ContentResponse<Me>
    broadcast({ me: res.error ? null : res.content, loading: false })
  })().finally(() => { pending = null })
  return pending
}

// Async accessor. Triggers the initial fetch on first call, returns the
// cached value on every call after. Safe to await from async route guards
// on every navigation — the underlying request only fires once.
export async function ensureMe(): Promise<Me | null> {
  if (cache.loading) await fetchMe()
  return cache.me
}

// Force a refetch bypassing the cache. Call after auth-state mutations
// (login) so the next ensureMe() sees the new user rather than the
// stale pre-auth null.
export function refreshMe(): Promise<void> {
  pending = null;
  return fetchMe()
}

export function useMe() {
  const [state, setState] = useState<State>(cache)

  useEffect(() => {
    listeners.add(setState)
    if (cache.loading) fetchMe()
    return () => { listeners.delete(setState) }
  }, [])

  return {
    ...state,
    refresh: () => fetchMe(),
    logout: async () => {
      await auth.logout()
      broadcast({ me: null, loading: false })
    },
  }
}
