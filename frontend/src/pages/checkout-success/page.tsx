import { T } from '@galalem/react-localization'
import { Link } from '@galalem/react-router'
import { openSettings } from '~/hooks'
import './styles.scss'

// Assume-success landing (per API-DESIGN D28). The webhook is the source
// of truth; this page never polls. If the entitlement isn't in the DB by
// the time the user clicks through to an exercise, the paywall will
// re-catch them — but in practice the webhook lands within a second or two.
export function CheckoutSuccessPage() {
  const sessionId = new URLSearchParams(window.location.search).get('session')

  return (
    <div className="checkout-success-page">
      <article className="card">
        <div className="check-icon" aria-hidden="true">
          <svg viewBox="0 0 60 60" width="72" height="72">
            <circle cx="30" cy="30" r="28" fill="#37c9b8" opacity="0.18" />
            <circle cx="30" cy="30" r="22" fill="#37c9b8" />
            <path
              d="M18 30 L27 39 L42 22"
              stroke="#fff"
              strokeWidth="3.5"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        <h1><T>pages.checkout_success.title</T></h1>
        <p className="body"><T>pages.checkout_success.body</T></p>

        {sessionId && (
          <div className="reference">
            <span className="label"><T>pages.checkout_success.reference_label</T></span>
            <code>{sessionId}</code>
          </div>
        )}

        <div className="actions">
          <Link to="/" className="btn btn-primary rounded-pill">
            <T>pages.checkout_success.cta_start</T>
          </Link>
          <button
            type="button"
            className="btn btn-outline-dark rounded-pill"
            onClick={() => openSettings('subscription')}
          >
            <T>pages.checkout_success.cta_profile</T>
          </button>
        </div>
      </article>
    </div>
  )
}
