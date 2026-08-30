import type { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { z } from 'zod';
import { type Locale, SESSION_COOKIE, SUPPORTED_LOCALES } from '~/config';
import { sql } from '~/lib/db';
import { errors } from '~/lib/error';
import { responses } from '~/lib/response';
import { validate } from '~/lib/validate';
import { EmailChange } from '~/models/email-change';
import { Session } from '~/models/session';
import { User } from '~/models/user';
import { sendEmailChangedNotice, sendVerificationEmail } from '~/routes/v1/auth/mails.helper';
import { requirePasswordReverify } from '~/routes/v1/auth/password.helper';
import type { MyEnv } from './types';

// POST /my/profile   partial update.
//                    - Cheap fields (firstName / lastName / locale) update
//                      directly, no password needed.
//                    - Email change requires password re-verification.
//                      Three sub-paths for the email itself:
//                      · same as current  → no-op (only cheap fields apply)
//                      · previously verified → restore (no mail sent,
//                        email_verified stays true)
//                      · new address       → verify flow (email_verified
//                        reset to false, verification mail sent to new
//                        address, notice mailed to old address)
//                    Other sessions get invalidated on any real email change;
//                    caller's session stays alive so mistake correction is
//                    possible.

const UpdateBody = z
  .object({
    firstName: z
      .string({ error: 'First name must be a string.' })
      .trim()
      .min(1, 'First name is required.')
      .max(50, 'First name must be 50 characters or fewer.')
      .optional(),
    lastName: z
      .string({ error: 'Last name must be a string.' })
      .trim()
      .min(1, 'Last name is required.')
      .max(50, 'Last name must be 50 characters or fewer.')
      .optional(),
    email: z
      .string({ error: 'Email must be a string.' })
      .trim()
      .toLowerCase()
      .pipe(z.email('Email format is invalid.'))
      .optional(),
    password: z
      .string({ error: 'Password must be a string.' })
      .min(1, 'Password is required.')
      .optional(),
    locale: z
      .enum(SUPPORTED_LOCALES, {
        error: `Locale must be one of ${SUPPORTED_LOCALES.join(', ')}.`,
      })
      .optional(),
  })
  .refine(
    (data) => data.email === undefined || (typeof data.password === 'string' && data.password.length > 0),
    { message: 'Password is required when changing email.', path: ['password'] },
  );

interface UpdatedRow {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  locale: string;
  role: string;
  email_verified: boolean;
  tutorial_done_at: Date | null;
}

export default function registerRoutes(app: Hono<MyEnv>): void {
  app.post('/profile', validate('json', UpdateBody), async (c) => {
    const body = c.req.valid('json');
    const user = c.get('user');

    const isEmailChange = body.email !== undefined && body.email !== user.email;

    // --- Cheap-only path -------------------------------------------------
    if (!isEmailChange) {
      const rows = await sql<UpdatedRow[]>`
        UPDATE users SET
          first_name = COALESCE(${body.firstName ?? null}, first_name),
          last_name  = COALESCE(${body.lastName ?? null}, last_name),
          locale     = COALESCE(${body.locale ?? null}, locale)
        WHERE id = ${user.id}
        RETURNING id, email, first_name, last_name, locale, role, email_verified, tutorial_done_at
      `;
      const updated = rows[0];
      if (!updated) throw errors.authenticationInvalid();
      c.header('Cache-Control', 'no-store');
      return responses.content(c, User.fromRow(updated));
    }

    // --- Email-change path -----------------------------------------------
    // Schema refine + isEmailChange guarantee both fields are present.
    const newEmail = body.email as string;
    const password = body.password as string;

    await requirePasswordReverify(user.id, password);

    // Restore branch — target email is one this user has previously verified.
    const isRestore = await EmailChange.wasPreviouslyVerified(user.id, newEmail);

    // Keep the caller's session alive; nuke every other session on any real
    // email change (both restore and new).
    const currentCookie = getCookie(c, SESSION_COOKIE);
    const currentHash = currentCookie ? Session.hashToken(currentCookie) : null;

    let updated: UpdatedRow;
    let verifyToken: string | null = null;

    try {
      const result = await sql.begin(async (tx) => {
        if (isRestore) {
          await EmailChange.recordRestore(user.id, user.email, newEmail, tx);
        }
        // UPDATE users. `email_verified` flips to true on restore (verified
        // via history) and false on a new-address change.
        const updRows = await tx<UpdatedRow[]>`
          UPDATE users SET
            email          = ${newEmail},
            email_verified = ${isRestore},
            first_name     = COALESCE(${body.firstName ?? null}, first_name),
            last_name      = COALESCE(${body.lastName ?? null}, last_name),
            locale         = COALESCE(${body.locale ?? null}, locale)
          WHERE id = ${user.id}
          RETURNING id, email, first_name, last_name, locale, role, email_verified, tutorial_done_at
        `;
        const row = updRows[0];
        if (!row) throw errors.authenticationInvalid();

        if (currentHash) {
          await tx`
            DELETE FROM sessions
            WHERE user_id = ${user.id} AND token_hash != ${currentHash}
          `;
        } else {
          await tx`DELETE FROM sessions WHERE user_id = ${user.id}`;
        }

        // New-address branch: mint a verification token bound to this
        // specific transition. (Restore skips this — no mail, no token.)
        let token: string | null = null;
        if (!isRestore) {
          token = await EmailChange.initiate(user.id, user.email, newEmail, tx);
        }
        return { row, token };
      });
      updated = result.row;
      verifyToken = result.token;
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === '23505') {
        throw errors.emailAlreadyRegistered();
      }
      throw err;
    }

    // Best-effort mails. Verification link → new address (skipped on
    // restore). Notice → old address (always, so the user knows a change
    // happened regardless of how it was verified).
    const verifyLocale: Locale = c.get('locale') ?? (updated.locale as Locale);
    const noticeLocale: Locale = user.locale;

    if (verifyToken) {
      try {
        await sendVerificationEmail(newEmail, verifyToken, verifyLocale);
      } catch (err) {
        console.error('[profile-update] verification email dispatch failed:', err);
      }
    }
    try {
      await sendEmailChangedNotice(user.email, noticeLocale);
    } catch (err) {
      console.error('[profile-update] notice email dispatch failed:', err);
    }

    c.header('Cache-Control', 'no-store');
    return responses.content(c, User.fromRow(updated));
  });
}
