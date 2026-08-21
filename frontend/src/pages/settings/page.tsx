import { T, useLocale } from '@galalem/react-localization'
import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { closeSettings, openSettings, useMe, useSettings, type SettingsSection } from '~/hooks'
import { CredentialsSection } from './components/CredentialsSection'
import { PrivacySection } from './components/PrivacySection'
import { ProfileSection } from './components/ProfileSection'
import { SubscriptionSection } from './components/SubscriptionSection'
import { SupportSection } from './components/SupportSection'
import './styles.scss'

interface NavEntry {
  key: SettingsSection
  labelKey: string
  icon: string
}

const NAV: NavEntry[] = [
  { key: 'credentials',  labelKey: 'pages.settings.nav_credentials',  icon: 'bi-shield-lock' },
  { key: 'profile',      labelKey: 'pages.settings.nav_profile',      icon: 'bi-person' },
  { key: 'subscription', labelKey: 'pages.settings.nav_subscription', icon: 'bi-star' },
  { key: 'privacy',      labelKey: 'pages.settings.nav_privacy',      icon: 'bi-file-earmark-lock' },
  { key: 'support',      labelKey: 'pages.settings.nav_support',      icon: 'bi-life-preserver' },
]

// Mounted once at the layout level; render is state-driven from useSettings.
// Modal-in-modal (delete-account confirmation) is owned by PrivacySection.
export function SettingsModal() {
  const { open: isOpen, section } = useSettings()
  const { me } = useMe()
  const { __ } = useLocale()

  // Lock body scroll + escape-to-close while open.
  useEffect(() => {
    if (!isOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeSettings() }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [isOpen])

  if (!isOpen || !me) return null

  return createPortal(
    <div className="settings-modal" role="dialog" aria-modal="true" aria-label={__('layouts.public.settings')}>
      <div className="backdrop" onClick={closeSettings} />
      <div className="panel">
        <aside className="sidebar">
          <header>
            <span className="avatar" aria-hidden="true">
              {((me.firstName?.[0] ?? '') + (me.lastName?.[0] ?? '')).toUpperCase()}
            </span>
            <div>
              <div className="name">{me.fullName}</div>
              <div className="email">{me.email}</div>
            </div>
          </header>
          <nav>
            {NAV.map((n) => (
              <button
                key={n.key}
                type="button"
                className={`nav-item ${section === n.key ? 'is-active' : ''}`}
                onClick={() => openSettings(n.key)}
              >
                <i className={`bi ${n.icon}`} aria-hidden="true" />
                <span><T>{n.labelKey}</T></span>
              </button>
            ))}
          </nav>
        </aside>

        <main className="content">
          <button type="button" className="close" onClick={closeSettings} aria-label={__('common.literal.close')}>
            <i className="bi bi-x-lg" aria-hidden="true" />
          </button>
          {section === 'credentials'  && <CredentialsSection />}
          {section === 'profile'      && <ProfileSection />}
          {section === 'subscription' && <SubscriptionSection />}
          {section === 'privacy'      && <PrivacySection />}
          {section === 'support'      && <SupportSection />}
        </main>
      </div>
    </div>,
    document.body,
  )
}
