import type { Hono } from 'hono';
import { z } from 'zod';
import { sql } from '~/lib/db';
import { responses } from '~/lib/response';
import { validate } from '~/lib/validate';
import { sendAccountDeletedNotice } from '~/routes/v1/auth/mails.helper';
import { requirePasswordReverify } from '~/routes/v1/auth/password.helper';
import { logout } from '~/routes/v1/auth/logout.route';
import type { MyEnv } from './types';

// DELETE /my/profile   GDPR delete. Password-confirmed. A single DELETE on
//                      users cascades atomically to sessions, email_changes,
//                      password_reset_tokens, password_changes, and
//                      attempts. Clears the caller's cookie in the response
//                      (belt-and-suspenders — the cascade already
//                      invalidated every session row, the browser just
//                      doesn't know it yet).
//
//                      No soft-delete — GDPR "right to erasure" is best
//                      served by an actual delete. Recovery isn't offered.

const DeleteBody = z.object({
  password: z
    .string({ error: 'Password is required.' })
    .min(1, 'Password is required.'),
});

export default function registerRoutes(app: Hono<MyEnv>): void {
  app.delete('/profile', validate('json', DeleteBody), async (c) => {
    const { password } = c.req.valid('json');
    const user = c.get('user');

    // Password re-verify + lockout gate + failure-counter bump — all
    // handled by the shared helper. Throws HttpError on any failure.
    await requirePasswordReverify(user.id, password);

    // Single-statement DELETE — cascades handle the rest atomically.
    await sql`DELETE FROM users WHERE id = ${user.id}`;

    try {
      await sendAccountDeletedNotice(user.email, user.locale);
    } catch (err) {
      console.error('[profile-delete] farewell email dispatch failed:', err);
    }

    await logout(c);
    c.header('Cache-Control', 'no-store');
    return responses.empty(c);
  });
}
