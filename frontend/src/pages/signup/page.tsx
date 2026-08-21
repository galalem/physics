import { T, useLocale } from '@galalem/react-localization'
import { Link } from '@galalem/react-router'
import { useState } from 'react'
import { auth, type ApiError, type Locale } from '~/lib/auth'

const ERROR_KEYS: Record<string, string> = {
  email_already_registered: 'common.error.email_taken',
  invalid_value: 'common.error.unknown',
  rate_limited: 'common.error.rate_limited',
  network_error: 'common.error.network',
}

export function SignupPage() {
  const { __, locale } = useLocale()
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [done, setDone] = useState(false)

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submitting) return
    setError(null)
    setSubmitting(true)
    const res = await auth.signup({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim(),
      password,
      locale: (locale as Locale) ?? 'en',
    })
    setSubmitting(false)
    if (!res.error) {
      setDone(true)
      return
    }
    setError(res.error)
  }

  if (done) {
    return (
      <div className="auth-form signup-done">
        <h2 className="h5 mb-3">{__('pages.signup.done_title')}</h2>
        <p className="form-body mb-4">{__('pages.signup.done_body').replace('{email}', email.trim())}</p>
        <Link to="/login" className="btn btn-outline-primary w-100">
          <T>common.action.back_to_login</T>
        </Link>
      </div>
    )
  }

  const errorKey = error && (ERROR_KEYS[error.code] ?? 'common.error.unknown')
  const errorMessage = error?.code === 'invalid_value' ? error.message : errorKey && __(errorKey)

  return (
    <form className="auth-form signup-form" onSubmit={handleSubmit} noValidate>
      <div className="row g-2">
        <div className="col-6 mb-3">
          <label htmlFor="signup-first-name" className="form-label">
            <T>common.auth.first_name</T>
          </label>
          <input
            id="signup-first-name"
            type="text"
            className="form-control"
            placeholder={__('common.auth.first_name_placeholder')}
            autoComplete="given-name"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            required
          />
        </div>
        <div className="col-6 mb-3">
          <label htmlFor="signup-last-name" className="form-label">
            <T>common.auth.last_name</T>
          </label>
          <input
            id="signup-last-name"
            type="text"
            className="form-control"
            placeholder={__('common.auth.last_name_placeholder')}
            autoComplete="family-name"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            required
          />
        </div>
      </div>

      <div className="mb-3">
        <label htmlFor="signup-email" className="form-label">
          <T>common.auth.email</T>
        </label>
        <input
          id="signup-email"
          type="email"
          className="form-control"
          placeholder="you@example.com"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>

      <div className="mb-4">
        <label htmlFor="signup-password" className="form-label">
          <T>common.auth.password</T>
        </label>
        <input
          id="signup-password"
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

      {errorMessage && (
        <div className="alert alert-danger py-2 mb-3" role="alert">{errorMessage}</div>
      )}

      <button type="submit" className="form-submit btn btn-primary w-100" disabled={submitting}>
        {submitting ? __('common.auth.submitting') : __('common.auth.signup')}
      </button>

      <div className="divider">
        <T>common.literal.or</T>
      </div>

      <button type="button" className="btn w-100 form-google" disabled>
        <T>common.auth.continue_with_google</T>
      </button>

      <div className="form-body text-center mt-3">
        <T>pages.signup.switch_note</T>{' '}
        <Link to="/login">
          <T>common.auth.login</T>
        </Link>
      </div>
    </form>
  )
}
