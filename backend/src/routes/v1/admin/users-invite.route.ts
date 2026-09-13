import { randomBytes } from 'node:crypto';
import type { Hono } from 'hono';
import { z } from 'zod';
import type { Locale } from '~/config';
import { sql } from '~/lib/db';
import { errors } from '~/lib/error';
import { responses } from '~/lib/response';
import { validate } from '~/lib/validate';
import { INVITE_TTL_MS, PasswordResetToken } from '~/models/password-reset-token';
import { User } from '~/models/user';
import { hashPassword } from '~/routes/v1/auth/password.helper';
import { sendInviteEmail } from '~/routes/v1/auth/mails.helper';
import { toWire } from './users.helper';
import type { AdminEnv } from './types';

// POST /admin/users             create an account and email an invite link
// POST /admin/users/:id/invite  re-send it (links expire)
//
// No password ever passes through the admin. The row is created with an
// unusable hash and `email_verified = false`, so it cannot be signed into
// until the invitee redeems the link and picks their own password — which
// is also what verifies the address.

const Body = z.object({
  email: z.email('Enter a valid email address.'),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  locale: z.enum(['en', 'fr', 'ar']).default('fr'),
  role: z.enum(['learner', 'admin', 'expert']).default('learner'),
});

/** Argon2 over random bytes: a real hash that no input can ever match. */
async function unusablePasswordHash(): Promise<string> {
  return hashPassword(randomBytes(32).toString('base64url'));
}

export default function registerRoutes(app: Hono<AdminEnv>): void {
  app.post('/users', validate('json', Body), async (c) => {
    const { email, firstName, lastName, locale, role } = c.req.valid('json');
    const passwordHash = await unusablePasswordHash();

    let created;
    try {
      const rows = await sql<{ id: string }[]>`
        INSERT INTO users (email, password_hash, first_name, last_name, locale, role, email_verified)
        VALUES (${email}, ${passwordHash}, ${firstName}, ${lastName}, ${locale}, ${role}, false)
        RETURNING id
      `;
      created = rows[0]!;
    } catch (err) {
      if (err instanceof Error && 'code' in err && err.code === '23505') {
        throw errors.emailAlreadyRegistered();
      }
      throw err;
    }

    const token = await PasswordResetToken.mint(created.id, sql, INVITE_TTL_MS);
    await sendInviteEmail(email, token, firstName, locale as Locale);

    const row = await User.adminFindById(created.id);
    return responses.content(c, toWire(row!), 201);
  });

  app.post('/users/:id/invite', async (c) => {
    const id = c.req.param('id');
    const row = await User.adminFindById(id);
    if (!row || row.deleted_at) throw errors.resourceMissing('User not found.');
    if (row.email_verified) {
      throw errors.invalidValue('This account is already active — send a password reset instead.');
    }

    // Older links stop working the moment a new one is issued.
    const token = await sql.begin(async (tx) => {
      await PasswordResetToken.invalidateOutstanding(id, tx);
      return PasswordResetToken.mint(id, tx, INVITE_TTL_MS);
    });
    await sendInviteEmail(row.email, token, row.first_name, row.locale as Locale);

    return responses.mutation(c, id, 'Invite re-sent.');
  });
}
