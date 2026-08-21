import { useLocale } from '@galalem/react-localization';
import { useMe } from '~/hooks';
import { refreshMe } from '~/hooks/useMe';
import { settings } from '~/lib/settings';
import './styles.scss';

const LOCALES = ['en', 'fr', 'ar'] as const

export function LanguageSwitcher() {
  const { locale, setLocale } = useLocale()
  const { me } = useMe()

  async function onPick(code: (typeof LOCALES)[number]) {
    if (code === locale) return
    void setLocale(code)
    // Fire-and-forget backend sync when authed: keeps profile.locale in step
    // with the user's actual choice so it survives fresh devices / logins.
    if (me && me.locale !== code) {
      try {
        const res = await settings.updateProfile({ locale: code })
        if (!res.error) await refreshMe()
      } catch { /* silent — localStorage still carries the pick */ }
    }
  }

  return (
    <div className="lang-switcher d-inline-flex border rounded-pill overflow-hidden" role="group">
      {LOCALES.map((code) => (
        <button
          key={code}
          type="button"
          className={`btn btn-sm ${locale === code ? 'active' : ''}`}
          onClick={() => onPick(code)}
        >
          {code}
        </button>
      ))}
    </div>
  )
}
