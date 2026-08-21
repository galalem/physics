import type { Hono } from 'hono';
import { z } from 'zod';
import { sql } from '~/lib/db';
import { responses } from '~/lib/response';
import { validate } from '~/lib/validate';
import { PasswordChange } from '~/models/password-change';
import { clearAuthFailures } from '~/routes/v1/auth/lockout.helper';
import { sendPasswordChangedNotice } from '~/routes/v1/auth/mails.helper';
import { hashPassword, requirePasswordReverify } from '~/routes/v1/auth/password.helper';
import { logout } from '~/routes/v1/auth/logout.route';
import type { MyEnv } from './types';

// POST /my/password   authenticated password change (oldPassword, newPassword).
//                     Verifies old via argon2, hashes new, nukes ALL sessions
//                     including the caller's. Failed old-password attempts
//                     share the login lockout counter.

const PasswordChangeBody = z
  .object({
    oldPassword: z
      .string({ error: 'Old password is required.' })
      .min(1, 'Old password is required.'),
    newPassword: z
      .string({ error: 'New password is required.' })
      .min(8, 'Password must be at least 8 characters.'),
  })
  .refine((data) => data.oldPassword !== data.newPassword, {
    message: 'New password must be different from the old password.',
    path: ['newPassword'],
  });

export default function registerRoutes(app: Hono<MyEnv>): void {
  app.post('/password', validate('json', PasswordChangeBody), async (c) => {
    const { oldPassword, newPassword } = c.req.valid('json');
    const user = c.get('user');

    // Locked-account gate + password verify + failure-counter bump all
    // handled by the shared reverify helper.
    await requirePasswordReverify(user.id, oldPassword);

    // Hash outside the tx (argon2 is CPU-bound); then atomically rotate the
    // hash, clear the lockout state, and nuke every session (including the
    // caller's — user must log in again on every device).
    const password_hash = await hashPassword(newPassword);
    await sql.begin(async (tx) => {
      await tx`
        UPDATE users SET password_hash = ${password_hash} WHERE id = ${user.id}
      `;
      await clearAuthFailures(user.id, tx);
      await tx`DELETE FROM sessions WHERE user_id = ${user.id}`;
      await PasswordChange.record(user.id, password_hash, tx);
    });

    try {
      await sendPasswordChangedNotice(user.email, user.locale);
    } catch (err) {
      console.error('[password-change] notice email dispatch failed:', err);
    }

    await logout(c);
    c.header('Cache-Control', 'no-store');
    return responses.empty(c);
  });
}
