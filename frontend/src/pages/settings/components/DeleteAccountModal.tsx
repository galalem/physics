import { T, useLocale } from '@galalem/react-localization'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMe, closeSettings } from '~/hooks'
import { refreshMe } from '~/hooks/useMe'
import { settings } from '~/lib/settings'

// Nested modal for the account-deletion confirmation. Modal-in-modal is
// deliberately jarring — this is the one action that deserves ceremony.
// Type-your-email + password required. Backend clears the cookie on
// success; we refresh useMe (which will return null) and hard-navigate
// home so React state doesn't linger.
interface Props {
  onClose: () => void
}

export function DeleteAccountModal({ onClose }: Props) {
  const { me } = useMe()
  const { __ } = useLocale()
  const [emailConfirm, setEmailConfirm] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const emailMatches = emailConfirm.trim().toLowerCase() === (me?.email ?? '').toLowerCase()
  const valid = emailMatches && password.length > 0 && !submitting

  async function onConfirm() {
    if (!valid) return
    setSubmitting(true)
    setError(null)
    const res = await settings.deleteAccount({ password })
    if (res.error) {
      setSubmitting(false)
      setError(res.error.message)
      return
    }
    // Cookie cleared server-side; refresh the useMe cache to null
    // and hard-navigate home so nothing stale sticks around.
    await refreshMe()
    closeSettings()
    window.location.href = '/'
  }

  return createPortal(
    <div className="delete-account-modal" role="dialog" aria-modal="true" aria-label={__('pages.settings.delete_modal.aria_label')}>
      <div className="backdrop" onClick={submitting ? undefined : onClose} />
      <div className="panel">
        <header>
          <i className="bi bi-exclamation-triangle" aria-hidden="true" />
          <h3><T>pages.settings.delete_modal.title</T></h3>
        </header>
        <div className="body">
          <p>
            <T>pages.settings.delete_modal.warning_before</T>{' '}
            <strong><T>pages.settings.delete_modal.warning_emphasis</T></strong>{' '}
            <T>pages.settings.delete_modal.warning_after</T>
          </p>
          <label>
            <span>
              <T>pages.settings.delete_modal.type_email_prefix</T>{' '}
              <strong>{me?.email}</strong>{' '}
              <T>pages.settings.delete_modal.type_email_suffix</T>
            </span>
            <input
              type="email"
              className="form-control"
              value={emailConfirm}
              onChange={(e) => setEmailConfirm(e.target.value)}
              autoComplete="off"
              disabled={submitting}
            />
          </label>
          <label>
            <span><T>pages.settings.delete_modal.password_label</T></span>
            <input
              type="password"
              className="form-control"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              disabled={submitting}
            />
          </label>
          {error && <div className="alert alert-danger">{error}</div>}
        </div>
        <footer>
          <button type="button" className="btn btn-outline-dark rounded-pill" onClick={onClose} disabled={submitting}>
            <T>common.literal.cancel</T>
          </button>
          <button type="button" className="btn btn-danger rounded-pill" onClick={onConfirm} disabled={!valid}>
            {submitting ? __('pages.settings.delete_modal.deleting') : __('pages.settings.delete_modal.confirm_button')}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}
