import { useEffect, useState } from 'react'

// Global settings-modal state. Module-level singleton (mirrors useMe
// pattern) so the modal can be opened from anywhere (nav dropdown,
// checkout-success CTA, paywall CTA) without prop threading.
//
// Also URL-syncs `?settings=<section>` on mount so deep links work
// (`/checkout/success?settings=subscription` opens the modal directly).

export type SettingsSection =
  | 'credentials'
  | 'profile'
  | 'privacy'
  | 'subscription'
  | 'support'

const DEFAULT_SECTION: SettingsSection = 'profile'
const VALID_SECTIONS: SettingsSection[] = [
  'credentials',
  'profile',
  'privacy',
  'subscription',
  'support',
]

type State = { open: boolean; section: SettingsSection }

let cache: State = { open: false, section: DEFAULT_SECTION }
const listeners = new Set<(s: State) => void>()

function broadcast(next: State) {
  cache = next
  for (const l of listeners) l(next)
}

function parseSection(raw: string | null): SettingsSection | null {
  if (!raw) return null
  return VALID_SECTIONS.includes(raw as SettingsSection) ? (raw as SettingsSection) : null
}

// Sync the URL query param without a full navigation (no scroll jump,
// no history spam — we replace, not push, so back button skips the
// modal-open state instead of trapping on it).
function syncUrl(open: boolean, section: SettingsSection) {
  const url = new URL(window.location.href)
  if (open) url.searchParams.set('settings', section)
  else url.searchParams.delete('settings')
  window.history.replaceState({}, '', url.pathname + url.search + url.hash)
}

export function openSettings(section: SettingsSection = DEFAULT_SECTION) {
  broadcast({ open: true, section })
  syncUrl(true, section)
}

export function closeSettings() {
  broadcast({ open: false, section: cache.section })
  syncUrl(false, cache.section)
}

export function useSettings() {
  const [state, setState] = useState<State>(cache)

  useEffect(() => {
    // Subscribe before honoring the deep-link so the broadcast reaches us.
    listeners.add(setState)
    if (!cache.open) {
      const fromUrl = parseSection(new URLSearchParams(window.location.search).get('settings'))
      if (fromUrl) broadcast({ open: true, section: fromUrl })
    }
    return () => { listeners.delete(setState) }
  }, [])

  return state
}
