import { T, useLocale } from '@galalem/react-localization'
import { Link } from '@galalem/react-router'
import { useState } from 'react'
import { auth, type ApiError } from '~/lib/auth'

const ERROR_KEYS: Record<string, string> = {
  rate_limited: 'common.error.rate_limited',
  network_error: 'common.error.network',
}

export function ForgotPasswordPage() {
  const { __ } = useLocale()
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [done, setDone] = useState(false)

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submitting) return
    setError(null)
    setSubmitting(true)
    const res = await auth.requestReset({ email: email.trim() })
    setSubmitting(false)
    if (!res.error) {
      setDone(true)
      return
    }
    setError(res.error)
  }

  if (done) {
    return (
      <div className="auth-form">
        <h2 className="h5 mb-3"><T>pages.forgot_password.done_title</T></h2>
        <p className="form-body mb-4">
          {__('pages.forgot_password.done_body').replace('{email}', email.trim())}
        </p>
        <Link to="/login" className="btn btn-outline-primary w-100">
          <T>common.action.back_to_login</T>
        </Link>
      </div>
    )
  }

  const errorKey = error && (ERROR_KEYS[error.code] ?? 'common.error.unknown')

  return (
    <form className="auth-form login-form" onSubmit={handleSubmit} noValidate>
      <div className="mb-3 form-body">
        <T>common.auth.forgot_password_instructions</T>
      </div>

      <div className="mb-4">
        <label htmlFor="reset-email" className="form-label">
          <T>common.auth.email</T>
        </label>
        <input
          id="reset-email"
          type="email"
          className="form-control"
          placeholder="you@example.com"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>

      {errorKey && (
        <div className="alert alert-danger py-2 mb-3" role="alert">{__(errorKey)}</div>
      )}

      <button type="submit" className="form-submit btn btn-primary w-100" disabled={submitting}>
        {submitting ? __('common.auth.submitting') : __('common.auth.send_reset_link')}
      </button>
    </form>
  )
}
