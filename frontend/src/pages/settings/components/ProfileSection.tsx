import { T, useLocale } from '@galalem/react-localization'
import { useEffect, useState } from 'react'
import { refreshMe } from '~/hooks/useMe'
import { useMe } from '~/hooks'
import { type Locale } from '~/lib/auth'
import { settings } from '~/lib/settings'

const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  fr: 'Français',
  ar: 'العربية',
}

export function ProfileSection() {
  const { me } = useMe()
  // Alias the library setter so it doesn't collide with the form state's setLocale.
  const { __, setLocale: setActiveLocale } = useLocale()
  const [firstName, setFirstName] = useState(me?.firstName ?? '')
  const [lastName, setLastName] = useState(me?.lastName ?? '')
  const [locale, setLocale] = useState<Locale>(me?.locale ?? 'en')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!me) return
    setFirstName(me.firstName)
    setLastName(me.lastName)
    setLocale(me.locale)
  }, [me])

  const dirty =
    firstName !== me?.firstName || lastName !== me?.lastName || locale !== me?.locale

  async function onSave() {
    if (!dirty || saving) return
    setSaving(true)
    setError(null)
    setSaved(false)
    const localeChanged = locale !== me?.locale
    const res = await settings.updateProfile({ firstName, lastName, locale })
    if (res.error) {
      setSaving(false)
      setError(res.error.message)
      return
    }
    await refreshMe()
    if (localeChanged) await setActiveLocale(locale)
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2200)
  }

  return (
    <section className="settings-section">
      <header>
        <h2><T>pages.settings.profile.title</T></h2>
        <p><T>pages.settings.profile.description</T></p>
      </header>

      <div className="form-grid">
        <label>
          <span><T>pages.settings.profile.first_name</T></span>
          <input
            type="text"
            className="form-control"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            maxLength={50}
          />
        </label>
        <label>
          <span><T>pages.settings.profile.last_name</T></span>
          <input
            type="text"
            className="form-control"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            maxLength={50}
          />
        </label>
        <label className="full">
          <span><T>pages.settings.profile.language</T></span>
          <select
            className="form-select"
            value={locale}
            onChange={(e) => setLocale(e.target.value as Locale)}
          >
            {(Object.keys(LOCALE_LABELS) as Locale[]).map((k) => (
              <option key={k} value={k}>{LOCALE_LABELS[k]}</option>
            ))}
          </select>
        </label>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}

      <div className="actions">
        <button
          type="button"
          className="btn btn-primary rounded-pill"
          onClick={onSave}
          disabled={!dirty || saving}
        >
          {saving ? __('pages.settings.profile.saving') : __('pages.settings.profile.save')}
        </button>
        {saved && <span className="saved-hint"><T>pages.settings.profile.saved</T></span>}
      </div>
    </section>
  )
}
