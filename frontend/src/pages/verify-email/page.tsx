import { T, useLocale } from '@galalem/react-localization'
import { Link, useRouter } from '@galalem/react-router'
import { useEffect, useRef, useState } from 'react'
import { auth } from '~/lib/auth'

type State =
  | { kind: 'verifying' }
  | { kind: 'success' }
  | { kind: 'expired' }
  | { kind: 'invalid' }
  | { kind: 'missing_token' }

export function VerifyEmailPage() {
  const { __ } = useLocale()
  const router = useRouter()
  const token = router.query.token
  const [state, setState] = useState<State>(() =>
    token ? { kind: 'verifying' } : { kind: 'missing_token' },
  )
  // Guard against StrictMode double-fire: the token is single-use, so a
  // second call always fails with token_invalid and races the first.
  const called = useRef(false)

  useEffect(() => {
    if (!token || called.current) return
    called.current = true
    auth.verifyEmail({ token }).then((res) => {
      if (!res.error) return setState({ kind: 'success' })
      if (res.error.code === 'token_expired') return setState({ kind: 'expired' })
      setState({ kind: 'invalid' })
    })
  }, [token])

  return (
    <div className="auth-form">
      {state.kind === 'verifying' && (
        <p className="form-body">{__('pages.verify_email.verifying')}</p>
      )}
      {state.kind === 'success' && (
        <>
          <h2 className="h5 mb-3">{__('pages.verify_email.success_title')}</h2>
          <p className="form-body mb-4">{__('pages.verify_email.success_body')}</p>
          <Link to="/login" className="btn btn-primary w-100">
            <T>common.action.back_to_login</T>
          </Link>
        </>
      )}
      {state.kind === 'expired' && (
        <>
          <h2 className="h5 mb-3">{__('pages.verify_email.expired_title')}</h2>
          <p className="form-body mb-4">{__('pages.verify_email.expired_body')}</p>
          <ResendForm />
        </>
      )}
      {state.kind === 'invalid' && (
        <>
          <h2 className="h5 mb-3">{__('pages.verify_email.invalid_title')}</h2>
          <p className="form-body mb-4">{__('pages.verify_email.invalid_body')}</p>
          <Link to="/login" className="btn btn-outline-primary w-100">
            <T>common.action.back_to_login</T>
          </Link>
        </>
      )}
      {state.kind === 'missing_token' && (
        <>
          <h2 className="h5 mb-3">{__('pages.verify_email.invalid_title')}</h2>
          <p className="form-body mb-4">{__('pages.verify_email.missing_token')}</p>
          <Link to="/login" className="btn btn-outline-primary w-100">
            <T>common.action.back_to_login</T>
          </Link>
        </>
      )}
    </div>
  )
}

function ResendForm() {
  const { __ } = useLocale()
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submitting) return
    setSubmitting(true)
    await auth.resendVerify({ email: email.trim() })
    setSubmitting(false)
    setDone(true)
  }

  if (done) {
    return <p className="text-success form-body">{__('pages.signup.resent')}</p>
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div className="mb-3">
        <label htmlFor="verify-resend-email" className="form-label">
          <T>common.auth.email</T>
        </label>
        <input
          id="verify-resend-email"
          type="email"
          className="form-control"
          placeholder="you@example.com"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>
      <button type="submit" className="btn btn-primary w-100" disabled={submitting}>
        {submitting ? __('common.auth.submitting') : __('common.action.resend_verification')}
      </button>
    </form>
  )
}
