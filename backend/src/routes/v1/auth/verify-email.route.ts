import type { Hono } from 'hono';
import { z } from 'zod';
import type { Locale } from '~/config';
import { sql } from '~/lib/db';
import { errors } from '~/lib/error';
import { responses } from '~/lib/response';
import { validate } from '~/lib/validate';
import { EmailChange } from '~/models/email-change';
import { sendVerificationEmail } from './mails.helper';
import {
  clientIp,
  MINT_IP_LIMIT_MAX,
  MINT_WINDOW_MS,
  rateLimit,
} from './rate-limit.helper';
import type { AuthEnv } from './types';

const VerifyEmailBody = z.object({
  token: z
    .string({ error: 'Token is required.' })
    .min(1, 'Token is required.'),
});

const ResendBody = z.object({
  email: z
    .string({ error: 'Email is required.' })
    .trim()
    .toLowerCase()
    .pipe(z.email('Email format is invalid.')),
});

function registerVerifyEmailRoute(app: Hono<AuthEnv>): void {
  app.post('/verify-email', validate('json', VerifyEmailBody), async (c) => {
    const { token } = c.req.valid('json');

    // Redeem is atomic + only succeeds if the row's new_email still matches
    // the user's current users.email. On success we also flip
    // users.email_verified. Both inside one tx so a failure between the
    // two rolls the redeem back.
    await sql.begin(async (tx) => {
      const result = await EmailChange.redeemToken(token, tx);
      if (!result.ok) {
        if (result.reason === 'expired') throw errors.tokenExpired();
        throw errors.tokenInvalid();
      }
      await tx`
        UPDATE users SET email_verified = true WHERE id = ${result.userId}
      `;
    });

    c.header('Cache-Control', 'no-store');
    return responses.empty(c);
  });
}

function registerResendVerifyEmailRoute(app: Hono<AuthEnv>): void {
  app.post('/verify-email/resend', validate('json', ResendBody), async (c) => {
    const { email } = c.req.valid('json');

    // Per-IP cap first — safe to surface as 429 regardless of the target.
    const ipCheck = rateLimit(`ip:verify-email-resend:${clientIp(c)}`, MINT_IP_LIMIT_MAX, MINT_WINDOW_MS);
    if (!ipCheck.ok) throw errors.rateLimited(ipCheck.retryAfter);

    // Silent 200 if the account doesn't exist or is already verified.
    const rows = await sql<{ id: string; locale: string; email_verified: boolean }[]>`
      SELECT id, locale, email_verified FROM users WHERE email = ${email} AND deleted_at IS NULL
    `;
    const user = rows[0];

    if (user && !user.email_verified) {
      const pending = await EmailChange.findPending(user.id);
      // No pending row for an unverified user is a weird state — silent 200.
      if (pending) {
        const now = Date.now();
        const tokenExpired = pending.tokenExpiresAt.getTime() <= now;

        // Cap hit AND current token still valid → 429. If the token has
        // already expired, we let the user resend (counter resets).
        if (!tokenExpired && pending.issuedCount >= EmailChange.MAX_ISSUED_COUNT) {
          const retryAfter = Math.ceil((pending.tokenExpiresAt.getTime() - now) / 1000);
          throw errors.rateLimited(retryAfter);
        }

        const result = await EmailChange.rotateToken(user.id, tokenExpired);
        if (result) {
          const mailLocale: Locale = c.get('locale') ?? (user.locale as Locale);
          try {
            await sendVerificationEmail(email, result.token, mailLocale);
          } catch (err) {
            console.error('[verify-email/resend] mail dispatch failed:', err);
          }
        }
      }
    }

    c.header('Cache-Control', 'no-store');
    return responses.empty(c);
  });
}

export default function registerRoutes(app: Hono<AuthEnv>): void {
  registerVerifyEmailRoute(app);
  registerResendVerifyEmailRoute(app);
}
