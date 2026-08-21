import { useLocale } from '@galalem/react-localization'
import { useEffect } from 'react'
import { useMe } from '~/hooks'

export function LocaleSync() {
  const { locale, setLocale } = useLocale()
  const { me } = useMe()

  // Reflect active locale on the <html> element (lang + dir for RTL).
  useEffect(() => {
    if (!locale) return
    document.documentElement.lang = locale
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr'
  }, [locale])

  // When the authed user's stored preference disagrees with the active
  // locale (fresh device, cleared storage, cross-browser login), snap the
  // active locale to the user's preference. Account wins over browser
  // default. No-op when unauthed or when they already match.
  //
  // `locale` is deliberately omitted from deps: reacting to locale changes
  // creates a snap-back race with the switcher's optimistic setLocale (it
  // flips the active locale before its backend POST + refreshMe complete,
  // so this effect would briefly see the new active vs the stale me.locale
  // and revert). Firing only on `me` changes is safe: if the user actively
  // clicked to switch, refreshMe updates me.locale to match, effect fires,
  // and finds them already in sync.
  useEffect(() => {
    if (!me) return
    if (me.locale === locale) return
    void setLocale(me.locale)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, setLocale])

  return null
}
