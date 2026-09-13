import { T, useLocale } from '@galalem/react-localization'
import { Link, useRouter } from '@galalem/react-router'
import { useState } from 'react'
import { refreshMe } from '~/hooks/useMe'
import { auth, type ApiError } from '~/lib/auth'
import { ensureMe } from '~/hooks/useMe'
import { tutorial } from '~/lib/tutorial'

const ERROR_KEYS: Record<string, string> = {
  invalid_credentials: 'common.error.invalid_credentials',
  email_not_verified: 'common.error.email_not_verified',
  rate_limited: 'common.error.rate_limited',
  network_error: 'common.error.network',
}

export function LoginPage() {
  const { __ } = useLocale()
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [resent, setResent] = useState(false)
  const [resending, setResending] = useState(false)

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submitting) return
    setError(null)
    setResent(false)
    setSubmitting(true)
    const res = await auth.login({ email: email.trim(), password })
    if (!res.error) {
      await refreshMe()
      const me = await ensureMe()
      // A guest may have taken the tutorial before registering — carry that
      // up so the gate does not push them through it a second time.
      if (await tutorial.syncGuestFlag(me)) await refreshMe()
      setSubmitting(false)
      // Admins land straight in the console; everyone else on the home page.
      router.redirect(me?.role === 'admin' ? '/admin' : '/')
      return
    }
    setSubmitting(false)
    setError(res.error)
  }

  const handleResend = async () => {
    if (resending) return
    setResending(true)
    await auth.resendVerify({ email: email.trim() })
    setResending(false)
    setResent(true)
  }

  const errorKey = error && (ERROR_KEYS[error.code] ?? 'common.error.unknown')

  return (
    <form className="auth-form login-form" onSubmit={handleSubmit} noValidate>
      <div className="mb-3">
        <label htmlFor="login-email" className="form-label">
          <T>common.auth.email</T>
        </label>
        <input
          id="login-email"
          type="email"
          className="form-control"
          placeholder="you@example.com"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>

      <div className="mb-3">
        <label htmlFor="login-password" className="form-label">
          <T>common.auth.password</T>
        </label>
        <input
          id="login-password"
          type="password"
          className="form-control"
          placeholder="••••••••"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <div className="form-body text-end text-lowercase">
          <Link to="/forgot-password">
            <T>common.auth.forgot_password</T>
          </Link>
        </div>
      </div>

      {errorKey && (
        <div className="alert alert-danger py-2 mb-3" role="alert">
          {__(errorKey)}
          {error?.code === 'email_not_verified' && (
            <div className="mt-2">
              {resent ? (
                <span className="text-success small">{__('pages.signup.resent')}</span>
              ) : (
                <button
                  type="button"
                  className="btn btn-link btn-sm p-0"
                  onClick={handleResend}
                  disabled={resending || !email.trim()}
                >
                  {__('common.action.resend_verification')}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      <button type="submit" className="form-submit btn btn-primary w-100" disabled={submitting}>
        {submitting ? __('common.auth.submitting') : __('common.auth.login')}
      </button>

      <div className="divider">
        <T>common.literal.or</T>
      </div>

      <button type="button" className="btn w-100 form-google" disabled>
        <T>common.auth.continue_with_google</T>
      </button>

      <div className="form-body text-center mt-3">
        <T>pages.login.switch_note</T>{' '}
        <Link to="/signup">
          <T>common.auth.signup</T>
        </Link>
      </div>
    </form>
  )
}
