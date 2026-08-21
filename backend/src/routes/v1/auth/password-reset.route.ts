import type { Hono } from 'hono';
import { z } from 'zod';
import type { Locale } from '~/config';
import { sql } from '~/lib/db';
import { errors } from '~/lib/error';
import { responses } from '~/lib/response';
import { validate } from '~/lib/validate';
import { PasswordChange } from '~/models/password-change';
import { PasswordResetToken } from '~/models/password-reset-token';
import { sendPasswordResetEmail } from './mails.helper';
import { hashPassword } from './password.helper';
import {
  clientIp,
  MINT_EMAIL_LIMIT_MAX,
  MINT_IP_LIMIT_MAX,
  MINT_WINDOW_MS,
  rateLimit,
} from './rate-limit.helper';
import type { AuthEnv } from './types';

const MintBody = z.object({
  email: z
    .string({ error: 'Email is required.' })
    .trim()
    .toLowerCase()
    .pipe(z.email('Email format is invalid.')),
});

const ConsumeBody = z.object({
  token: z
    .string({ error: 'Token is required.' })
    .min(1, 'Token is required.'),
  newPassword: z
    .string({ error: 'New password is required.' })
    .min(8, 'Password must be at least 8 characters.'),
});

function registerMintRoute(app: Hono<AuthEnv>): void {
  app.post('/password-reset', validate('json', MintBody), async (c) => {
    const { email } = c.req.valid('json');

    const ipCheck = rateLimit(`ip:password-reset:${clientIp(c)}`, MINT_IP_LIMIT_MAX, MINT_WINDOW_MS);
    if (!ipCheck.ok) throw errors.rateLimited(ipCheck.retryAfter);

    // Silent 200 for unknown / unverified accounts — enumeration protection.
    const rows = await sql<{ id: string; locale: string; email_verified: boolean }[]>`
      SELECT id, locale, email_verified FROM users WHERE email = ${email}
    `;
    const user = rows[0];

    if (user && user.email_verified) {
      const recent = await PasswordResetToken.countRecentMints(user.id, MINT_WINDOW_MS);
      if (recent >= MINT_EMAIL_LIMIT_MAX) {
        throw errors.rateLimited(Math.ceil(MINT_WINDOW_MS / 1000));
      }

      const token = await sql.begin(async (tx) => {
        await PasswordResetToken.invalidateOutstanding(user.id, tx);
        return PasswordResetToken.mint(user.id, tx);
      });

      const mailLocale: Locale = c.get('locale') ?? (user.locale as Locale);
      try {
        await sendPasswordResetEmail(email, token, mailLocale);
      } catch (err) {
        console.error('[password-reset] mail dispatch failed:', err);
      }
    }

    c.header('Cache-Control', 'no-store');
    return responses.empty(c);
  });
}

function registerConsumeRoute(app: Hono<AuthEnv>): void {
  app.post('/password', validate('json', ConsumeBody), async (c) => {
    const { token, newPassword } = c.req.valid('json');

    // Hash outside the tx (argon2id is CPU-bound). If redeem fails inside
    // the tx we've done a wasted hash — no state change.
    const password_hash = await hashPassword(newPassword);

    await sql.begin(async (tx) => {
      const result = await PasswordResetToken.redeem(token, tx);
      if (!result.ok) {
        if (result.reason === 'expired') throw errors.tokenExpired();
        throw errors.tokenInvalid();
      }
      await tx`
        UPDATE users
        SET password_hash = ${password_hash},
            failed_login_count = 0,
            locked_until = NULL
        WHERE id = ${result.userId}
      `;
      await tx`DELETE FROM sessions WHERE user_id = ${result.userId}`;
      await PasswordChange.record(result.userId, password_hash, tx);
    });

    c.header('Cache-Control', 'no-store');
    return responses.empty(c);
  });
}

export default function registerRoutes(app: Hono<AuthEnv>): void {
  registerMintRoute(app);
  registerConsumeRoute(app);
}
