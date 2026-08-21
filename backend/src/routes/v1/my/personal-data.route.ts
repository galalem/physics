import type { Hono } from 'hono';
import { z } from 'zod';
import { sql } from '~/lib/db';
import { errors } from '~/lib/error';
import { responses } from '~/lib/response';
import { validate } from '~/lib/validate';
import { requirePasswordReverify } from '~/routes/v1/auth/password.helper';
import type { MyEnv } from './types';

// POST /my/personal-data   GDPR Articles 15 & 20 export.
//
// Password-confirmed (POST-with-body so the password never lands in a
// query string). Returns a JSON dump of every piece of personal data we
// store or reference for the caller. Excludes credential material —
// password_hash and token hashes are not personal data in the GDPR sense
// and would materially weaken the account if disclosed.

const ExportBody = z.object({
  password: z
    .string({ error: 'Password is required.' })
    .min(1, 'Password is required.'),
});

interface ProfileRow {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  locale: string;
  role: string;
  email_verified: boolean;
  created_at: Date;
}

interface EmailChangeRow {
  old_email: string | null;
  new_email: string;
  verified_at: Date | null;
  created_at: Date;
}

interface AttemptRow {
  id: string;
  exercise_slug: string;
  exercise_version: string;
  seed: bigint | number;
  started_at: Date;
  last_action_at: Date;
  completed_at: Date | null;
  succeeded: boolean | null;
  saved_state_blob: string | null;
  log: string;
}

interface SessionRow {
  id: string;
  created_at: Date;
  last_used_at: Date;
  expires_at: Date;
  user_agent: string | null;
}

export default function registerRoutes(app: Hono<MyEnv>): void {
  app.post('/personal-data', validate('json', ExportBody), async (c) => {
    const { password } = c.req.valid('json');
    const user = c.get('user');

    await requirePasswordReverify(user.id, password);

    // Aggregate SELECTs in parallel — they're all indexed reads on user_id.
    const [profileRows, emailChanges, attempts, sessions] = await Promise.all([
      sql<ProfileRow[]>`
        SELECT id, email, first_name, last_name, locale, role, email_verified, created_at
        FROM users WHERE id = ${user.id}
      `,
      sql<EmailChangeRow[]>`
        SELECT old_email, new_email, verified_at, created_at
        FROM email_changes WHERE user_id = ${user.id}
        ORDER BY created_at
      `,
      sql<AttemptRow[]>`
        SELECT a.id,
               e.slug AS exercise_slug,
               a.exercise_version,
               a.seed,
               a.started_at,
               a.last_action_at,
               a.completed_at,
               a.succeeded,
               a.saved_state_blob,
               a.log
        FROM attempts a
        JOIN exercises e ON e.id = a.exercise_id
        WHERE a.user_id = ${user.id}
        ORDER BY a.started_at
      `,
      sql<SessionRow[]>`
        SELECT id, created_at, last_used_at, expires_at, user_agent
        FROM sessions WHERE user_id = ${user.id}
        ORDER BY created_at
      `,
    ]);

    const profileRow = profileRows[0];
    // Middleware guarantees this row existed at request start. If it's
    // gone by now, the account was concurrently deleted — 401.
    if (!profileRow) throw errors.authenticationInvalid();

    const payload = {
      profile: {
        id: profileRow.id,
        email: profileRow.email,
        firstName: profileRow.first_name,
        lastName: profileRow.last_name,
        locale: profileRow.locale,
        role: profileRow.role,
        emailVerified: profileRow.email_verified,
        createdAt: profileRow.created_at.toISOString(),
      },
      emailHistory: emailChanges.map((r) => ({
        previousEmail: r.old_email,
        newEmail: r.new_email,
        changedAt: r.created_at.toISOString(),
        verifiedAt: r.verified_at ? r.verified_at.toISOString() : null,
      })),
      attempts: attempts.map((r) => ({
        id: r.id,
        exerciseSlug: r.exercise_slug,
        exerciseVersionAtStart: r.exercise_version,
        // seed is bigint in the schema; convert to number for wire
        // (values are 32-bit PRNG seeds — well within safe integer range).
        seed: Number(r.seed),
        startedAt: r.started_at.toISOString(),
        lastActionAt: r.last_action_at.toISOString(),
        completedAt: r.completed_at ? r.completed_at.toISOString() : null,
        succeeded: r.succeeded,
        savedStateBlob: r.saved_state_blob,
        log: r.log,
      })),
      sessions: sessions.map((r) => ({
        id: r.id,
        createdAt: r.created_at.toISOString(),
        lastUsedAt: r.last_used_at.toISOString(),
        expiresAt: r.expires_at.toISOString(),
        userAgent: r.user_agent,
      })),
    };

    const filename = `personal-data-${user.id}-${new Date().toISOString().slice(0, 10)}.json`;
    c.header('Content-Disposition', `attachment; filename="${filename}"`);
    c.header('Cache-Control', 'no-store');
    return responses.content(c, payload);
  });
}
