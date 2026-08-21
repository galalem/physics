import type { Hono } from 'hono';
import { z } from 'zod';
import { type Locale, SUPPORTED_LOCALES } from '~/config';
import { sql } from '~/lib/db';
import { errors, HttpError } from '~/lib/error';
import { responses } from '~/lib/response';
import { validate } from '~/lib/validate';
import { EmailChange } from '~/models/email-change';
import { PasswordChange } from '~/models/password-change';
import { sendVerificationEmail } from './mails.helper';
import { hashPassword } from './password.helper';
import type { AuthEnv } from './types';

const SignupBody = z.object({
  email: z
    .string({ error: 'Email is required.' })
    .trim()
    .toLowerCase()
    .pipe(z.email('Email format is invalid.')),
  password: z
    .string({ error: 'Password is required.' })
    .min(8, 'Password must be at least 8 characters.'),
  firstName: z
    .string({ error: 'First name is required.' })
    .trim()
    .min(1, 'First name is required.')
    .max(50, 'First name must be 50 characters or fewer.'),
  lastName: z
    .string({ error: 'Last name is required.' })
    .trim()
    .min(1, 'Last name is required.')
    .max(50, 'Last name must be 50 characters or fewer.'),
  locale: z.enum(SUPPORTED_LOCALES, {
    error: `Locale must be one of ${SUPPORTED_LOCALES.join(', ')}.`,
  }),
});

export default function registerRoutes(app: Hono<AuthEnv>): void {
  app.post('/signup', validate('json', SignupBody), async (c) => {
    const { email, password, firstName, lastName, locale: bodyLocale } = c.req.valid('json');

    const password_hash = await hashPassword(password);

    // User insert + initial email_changes row + password_changes audit all
    // share one transaction so a partial signup can never leak. Mail
    // dispatch below happens after commit and is best-effort — an SMTP
    // hiccup doesn't roll the account back; the user can request a fresh
    // link via /auth/verify-email/resend.
    const { user, token } = await sql.begin(async (tx) => {
      let userRow;
      try {
        const rows = await tx<
          {
            id: string;
            email: string;
            first_name: string;
            last_name: string;
            locale: string;
            role: string;
            email_verified: boolean;
          }[]
        >`
          INSERT INTO users (email, password_hash, first_name, last_name, locale)
          VALUES (${email}, ${password_hash}, ${firstName}, ${lastName}, ${bodyLocale})
          RETURNING id, email, first_name, last_name, locale, role, email_verified
        `;
        userRow = rows[0];
      } catch (err: unknown) {
        // Postgres unique_violation on the LOWER(email) index.
        if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === '23505') {
          throw errors.emailAlreadyRegistered();
        }
        throw err;
      }
      if (!userRow) throw new HttpError(500, 'internal_error', 'User insert returned no row.');

      const t = await EmailChange.initiate(userRow.id, null, userRow.email, tx);
      await PasswordChange.record(userRow.id, password_hash, tx);
      return { user: userRow, token: t };
    });

    // Prefer request Accept-Language over the persisted users.locale when
    // the two differ.
    const mailLocale: Locale = c.get('locale') ?? (user.locale as Locale);
    try {
      await sendVerificationEmail(user.email, token, mailLocale);
    } catch (err) {
      console.error('[signup] verification email dispatch failed:', err);
    }

    c.header('Cache-Control', 'no-store');
    return responses.mutation(c, user.id, 'Account created. Check your inbox to verify your email.', 201);
  });
}
