import { T, useLocale } from '@galalem/react-localization'
import { Link, useRouter } from '@galalem/react-router'
import { useState } from 'react'
import { auth, type ApiError } from '~/lib/auth'

const ERROR_KEYS: Record<string, string> = {
  token_expired: 'common.error.token_expired',
  token_invalid: 'common.error.token_invalid',
  rate_limited: 'common.error.rate_limited',
  network_error: 'common.error.network',
}

type Outcome = 'success' | 'expired' | 'invalid'

export function ResetPasswordPage() {
  const { __ } = useLocale()
  const router = useRouter()
  const token = router.query.token
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)

  if (!token) {
    return (
      <div className="auth-form">
        <h2 className="h5 mb-3">{__('pages.reset_password.invalid_title')}</h2>
        <p className="form-body mb-4">{__('pages.reset_password.missing_token')}</p>
        <Link to="/forgot-password" className="btn btn-outline-primary w-100">
          <T>common.action.request_new_link</T>
        </Link>
      </div>
    )
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submitting) return
    setError(null)
    setLocalError(null)
    if (password.length < 8) {
      setLocalError(__('common.error.password_too_short'))
      return
    }
    if (password !== confirm) {
      setLocalError(__('common.error.passwords_dont_match'))
      return
    }
    setSubmitting(true)
    const res = await auth.resetPassword({ token, newPassword: password })
    setSubmitting(false)
    if (!res.error) return setOutcome('success')
    if (res.error.code === 'token_expired') return setOutcome('expired')
    if (res.error.code === 'token_invalid') return setOutcome('invalid')
    setError(res.error)
  }

  if (outcome === 'success') {
    return (
      <div className="auth-form">
        <h2 className="h5 mb-3">{__('pages.reset_password.success_title')}</h2>
        <p className="form-body mb-4">{__('pages.reset_password.success_body')}</p>
        <Link to="/login" className="btn btn-primary w-100">
          <T>common.action.back_to_login</T>
        </Link>
      </div>
    )
  }

  if (outcome === 'expired' || outcome === 'invalid') {
    const titleKey = outcome === 'expired' ? 'pages.reset_password.expired_title' : 'pages.reset_password.invalid_title'
    const bodyKey = outcome === 'expired' ? 'pages.reset_password.expired_body' : 'pages.reset_password.invalid_body'
    return (
      <div className="auth-form">
        <h2 className="h5 mb-3">{__(titleKey)}</h2>
        <p className="form-body mb-4">{__(bodyKey)}</p>
        <Link to="/forgot-password" className="btn btn-outline-primary w-100">
          <T>common.action.request_new_link</T>
        </Link>
      </div>
    )
  }

  const errorKey = error && (ERROR_KEYS[error.code] ?? 'common.error.unknown')

  return (
    <form className="auth-form" onSubmit={handleSubmit} noValidate>
      <h2 className="h5 mb-3">{__('pages.reset_password.title')}</h2>

      <div className="mb-3">
        <label htmlFor="reset-new-password" className="form-label">
          <T>common.auth.new_password</T>
        </label>
        <input
          id="reset-new-password"
          type="password"
          className="form-control"
          placeholder="••••••••"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={8}
          required
        />
      </div>

      <div className="mb-4">
        <label htmlFor="reset-confirm-password" className="form-label">
          {__('pages.reset_password.confirm_label')}
        </label>
        <input
          id="reset-confirm-password"
          type="password"
          className="form-control"
          placeholder="••••••••"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          minLength={8}
          required
        />
      </div>

      {(localError || errorKey) && (
        <div className="alert alert-danger py-2 mb-3" role="alert">
          {localError ?? (errorKey && __(errorKey))}
        </div>
      )}

      <button type="submit" className="form-submit btn btn-primary w-100" disabled={submitting}>
        {submitting ? __('common.auth.submitting') : __('pages.reset_password.submit')}
      </button>
    </form>
  )
}
