import { type Locale, requireEnv } from '~/config';
import { sendMail } from '~/lib/mailer';
import { render } from '~/templates/emails';

// Fire-and-forget notice after a successful payment. Triggered from the
// `checkout.completed` webhook once the entitlement row lands.
export async function sendPaymentSuccessNotice(
  to: string,
  locale: Locale,
  args: { days: number; validUntil: Date },
): Promise<void> {
  const link = requireEnv('PUBLIC_BASE_URL').replace(/\/$/, '') + '/';
  const rendered = render('payment-success-notice', locale, { ...args, link });
  await sendMail({ to, ...rendered });
}
