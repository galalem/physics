import { type Locale, requireEnv } from '~/config';
import { render } from '~/templates/emails';
import { sendMail } from '~/lib/mailer';

// All auth-flow mail dispatchers. Each is a thin wrapper: build the link
// (if any), pick the localized template, hand off to the SMTP seam.
// `PUBLIC_BASE_URL` is read lazily via requireEnv so scripts that never
// touch mail (migrate, seed) don't need it set.

function baseUrl(): string {
  return requireEnv('PUBLIC_BASE_URL').replace(/\/$/, '');
}

// Verification link sent on signup and after any new-address email change.
export async function sendVerificationEmail(to: string, token: string, locale: Locale): Promise<void> {
  const link = `${baseUrl()}/verify-email?token=${encodeURIComponent(token)}`;
  const rendered = render('verify-email', locale, { link });
  await sendMail({ to, ...rendered });
}

// Reset link sent from POST /auth/password-reset. Frontend hosts the
// /reset-password page which posts back to POST /api/v1/auth/password.
export async function sendPasswordResetEmail(to: string, token: string, locale: Locale): Promise<void> {
  const link = `${baseUrl()}/reset-password?token=${encodeURIComponent(token)}`;
  const rendered = render('password-reset', locale, { link });
  await sendMail({ to, ...rendered });
}

// Admin invite. Points at the same /reset-password page a reset link
// uses — the invited user is choosing a first password rather than
// replacing one, but the flow and the token are identical.
export async function sendInviteEmail(
  to: string,
  token: string,
  firstName: string,
  locale: Locale,
): Promise<void> {
  const link = `${baseUrl()}/reset-password?token=${encodeURIComponent(token)}`;
  const rendered = render('user-invite', locale, { link, firstName });
  await sendMail({ to, ...rendered });
}

// Fire-and-forget notice to the OLD email after an email change. Purely
// informational — recovery is "log in with old email + change back".
export async function sendEmailChangedNotice(to: string, locale: Locale): Promise<void> {
  const rendered = render('email-changed-notice', locale);
  await sendMail({ to, ...rendered });
}

// Fire-and-forget notice after a password change. Tips the user off if
// their account was compromised — recovery is the standard reset flow.
export async function sendPasswordChangedNotice(to: string, locale: Locale): Promise<void> {
  const rendered = render('password-changed-notice', locale);
  await sendMail({ to, ...rendered });
}

// Fire-and-forget farewell after an account deletion. Also tips off a
// hijacked account; recovery in that case is contacting us directly since
// the account itself is gone.
export async function sendAccountDeletedNotice(to: string, locale: Locale): Promise<void> {
  const rendered = render('account-deleted-notice', locale);
  await sendMail({ to, ...rendered });
}
