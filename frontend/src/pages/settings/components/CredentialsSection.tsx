import { T, useLocale } from '@galalem/react-localization'
import { useState } from 'react'
import { useMe } from '~/hooks'
import { refreshMe } from '~/hooks/useMe'
import { settings } from '~/lib/settings'

export function CredentialsSection() {
  const { me } = useMe()
  const [emailOpen, setEmailOpen] = useState(false)
  const [passwordOpen, setPasswordOpen] = useState(false)

  return (
    <section className="settings-section">
      <header>
        <h2><T>pages.settings.credentials.title</T></h2>
        <p><T>pages.settings.credentials.description</T></p>
      </header>

      {/* --- Email --- */}
      <div className="row">
        <div className="row-info">
          <div className="row-label"><T>pages.settings.credentials.email_label</T></div>
          <div className="row-value">{me?.email}</div>
          {me?.emailVerified === false && (
            <div className="row-hint warning">
              <i className="bi bi-exclamation-circle" aria-hidden="true" /> <T>pages.settings.credentials.email_not_verified</T>
            </div>
          )}
        </div>
        {!emailOpen ? (
          <button type="button" className="btn btn-sm btn-outline-dark rounded-pill" onClick={() => setEmailOpen(true)}>
            <T>pages.settings.credentials.change_email</T>
          </button>
        ) : (
          <ChangeEmailForm currentEmail={me?.email ?? ''} onDone={() => setEmailOpen(false)} />
        )}
      </div>

      {/* --- Password --- */}
      <div className="row">
        <div className="row-info">
          <div className="row-label"><T>pages.settings.credentials.password_label</T></div>
          <div className="row-value">••••••••</div>
        </div>
        {!passwordOpen ? (
          <button type="button" className="btn btn-sm btn-outline-dark rounded-pill" onClick={() => setPasswordOpen(true)}>
            <T>pages.settings.credentials.change_password</T>
          </button>
        ) : (
          <ChangePasswordForm onDone={() => setPasswordOpen(false)} />
        )}
      </div>
    </section>
  )
}

function ChangeEmailForm({ currentEmail, onDone }: { currentEmail: string; onDone: () => void }) {
  const { __ } = useLocale()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<{ email: string; restored: boolean } | null>(null)

  const valid = email.trim() && email.trim() !== currentEmail && password

  async function onSubmit() {
    if (!valid || submitting) return
    setSubmitting(true)
    setError(null)
    const res = await settings.changeEmail({ email: email.trim().toLowerCase(), password })
    setSubmitting(false)
    if (res.error) {
      setError(res.error.message)
      return
    }
    // Backend flips email_verified to true iff this was a restore (previously
    // verified address) — no verification mail sent in that branch.
    setPending({ email: email.trim().toLowerCase(), restored: res.content.emailVerified })
    await refreshMe()
    setEmail('')
    setPassword('')
  }

  if (pending) {
    const prefixKey = pending.restored
      ? 'pages.settings.credentials.email_restored_prefix'
      : 'pages.settings.credentials.email_pending_prefix'
    const suffixKey = pending.restored
      ? 'pages.settings.credentials.email_restored_suffix'
      : 'pages.settings.credentials.email_pending_suffix'
    return (
      <div className="inline-form">
        <div className="row-hint">
          <i className="bi bi-envelope-check" aria-hidden="true" />
          <span>
            <T>{prefixKey}</T>{' '}
            <strong>{pending.email}</strong>
            <T>{suffixKey}</T>
          </span>
        </div>
        <div className="inline-actions">
          <button type="button" className="btn btn-sm btn-outline-dark rounded-pill" onClick={onDone}><T>common.literal.close</T></button>
        </div>
      </div>
    )
  }

  return (
    <div className="inline-form">
      <label>
        <span><T>pages.settings.credentials.new_email</T></span>
        <input
          type="email"
          className="form-control"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
        />
      </label>
      <label>
        <span><T>pages.settings.credentials.current_password</T></span>
        <input
          type="password"
          className="form-control"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
      </label>
      {error && <div className="alert alert-danger">{error}</div>}
      <div className="inline-actions">
        <button type="button" className="btn btn-sm btn-outline-dark rounded-pill" onClick={onDone} disabled={submitting}>
          <T>common.literal.cancel</T>
        </button>
        <button type="button" className="btn btn-sm btn-primary rounded-pill" onClick={onSubmit} disabled={!valid || submitting}>
          {submitting ? __('pages.settings.credentials.sending') : __('pages.settings.credentials.send_verification')}
        </button>
      </div>
    </div>
  )
}

function ChangePasswordForm({ onDone }: { onDone: () => void }) {
  const { __ } = useLocale()
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const mismatch = confirm.length > 0 && confirm !== newPassword
  const valid =
    oldPassword.length >= 1 &&
    newPassword.length >= 8 &&
    confirm === newPassword &&
    newPassword !== oldPassword

  async function onSubmit() {
    if (!valid || submitting) return
    setSubmitting(true)
    setError(null)
    const res = await settings.changePassword({ oldPassword, newPassword })
    setSubmitting(false)
    if (res.error) {
      setError(res.error.message)
      return
    }
    // Backend nukes all sessions on success — including this one. Reload
    // so the router's next auth-check bounces to /login cleanly.
    window.location.href = '/login'
  }

  return (
    <div className="inline-form">
      <label>
        <span><T>pages.settings.credentials.current_password</T></span>
        <input
          type="password"
          className="form-control"
          value={oldPassword}
          onChange={(e) => setOldPassword(e.target.value)}
          autoComplete="current-password"
        />
      </label>
      <label>
        <span><T>pages.settings.credentials.new_password</T></span>
        <input
          type="password"
          className="form-control"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          autoComplete="new-password"
          minLength={8}
        />
      </label>
      <label>
        <span><T>pages.settings.credentials.confirm_new_password</T></span>
        <input
          type="password"
          className={`form-control ${mismatch ? 'is-invalid' : ''}`}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
        />
        {mismatch && <div className="invalid-feedback d-block"><T>pages.settings.credentials.password_mismatch</T></div>}
      </label>
      {error && <div className="alert alert-danger">{error}</div>}
      <div className="row-hint">
        <T>pages.settings.credentials.password_signout_hint</T>
      </div>
      <div className="inline-actions">
        <button type="button" className="btn btn-sm btn-outline-dark rounded-pill" onClick={onDone} disabled={submitting}>
          <T>common.literal.cancel</T>
        </button>
        <button type="button" className="btn btn-sm btn-primary rounded-pill" onClick={onSubmit} disabled={!valid || submitting}>
          {submitting ? __('pages.settings.credentials.updating') : __('pages.settings.credentials.change_password')}
        </button>
      </div>
    </div>
  )
}
