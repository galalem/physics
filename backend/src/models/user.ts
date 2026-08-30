import { type Locale } from '~/config';
import { type Db, sql } from '~/lib/db';
import { errors } from '~/lib/error';
import type { AuthedUser, UserRole } from '~/middleware/auth';
import { clearAuthFailures, recordAuthFailure } from '~/routes/v1/auth/lockout.helper';
import { verifyPassword } from '~/routes/v1/auth/password.helper';
import {
  LOGIN_IP_LIMIT_MAX,
  LOGIN_WINDOW_MS,
  peekLimit,
  recordAttempt,
} from '~/routes/v1/auth/rate-limit.helper';

// Superset of the columns needed to build an AuthedUser. Structural typing
// lets any wider row (with password_hash, session_id, etc.) pass through.
export interface UserRow {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  locale: string;
  role: string;
  email_verified: boolean;
  tutorial_done_at: Date | null;
}

interface UserRowForAuth extends UserRow {
  password_hash: string;
  locked_until: Date | null;
}

export class User {
  // Converts a DB row → AuthedUser (wire shape). Used everywhere we build
  // an AuthedUser from a users-table SELECT: middleware's session lookup,
  // authenticateWithPassword, signup, profile-update.
  static fromRow(row: UserRow): AuthedUser {
    return {
      id: row.id,
      email: row.email,
      firstName: row.first_name,
      lastName: row.last_name,
      fullName: `${row.first_name} ${row.last_name}`,
      locale: row.locale as Locale,
      role: row.role as UserRole,
      emailVerified: row.email_verified,
      tutorialDoneAt: row.tutorial_done_at?.toISOString() ?? null,
    };
  }

  // Full password-based authentication flow: per-IP cap → lookup → decoy or
  // real argon2 verify → lock gate → email-verified gate → clear counters.
  // On success returns the AuthedUser; on any failure throws the correct
  // HttpError. Callers (login, future /auth/token, future OAuth callbacks)
  // then issue whatever credential they want (session cookie, JWT, ...).
  //
  // `ip` is passed in rather than a full Hono Context so this stays a plain
  // model method — no HTTP layer coupling.
  static async authenticateWithPassword(
    email: string,
    password: string,
    ip: string,
  ): Promise<AuthedUser> {
    const ipKey = `ip:login:${ip}`;

    // Reject early if the per-IP cap is already tripped — don't spend
    // argon2 CPU on requests that are over quota.
    const ipCheck = peekLimit(ipKey, LOGIN_IP_LIMIT_MAX, LOGIN_WINDOW_MS);
    if (!ipCheck.ok) throw errors.rateLimited(ipCheck.retryAfter);

    const rows = await sql<UserRowForAuth[]>`
      SELECT id, email, password_hash, first_name, last_name, locale, role, tutorial_done_at,
             email_verified, locked_until
      FROM users
      WHERE email = ${email}
    `;
    const row = rows[0] ?? null;

    // Unknown email: still spend argon2 time against a decoy so timing
    // doesn't reveal whether the account exists.
    if (!row) {
      await verifyPassword(null, password);
      recordAttempt(ipKey, LOGIN_WINDOW_MS);
      throw errors.invalidCredentials();
    }

    // Locked-account gate: reject without argon2 work. The lock is
    // transient — retryAfter is seconds until it clears.
    if (row.locked_until && row.locked_until.getTime() > Date.now()) {
      recordAttempt(ipKey, LOGIN_WINDOW_MS);
      const retryAfter = Math.ceil((row.locked_until.getTime() - Date.now()) / 1000);
      throw errors.authenticationExpired({ retryAfter });
    }

    const ok = await verifyPassword(row.password_hash, password);
    if (!ok) {
      recordAttempt(ipKey, LOGIN_WINDOW_MS);
      await recordAuthFailure(row.id);
      throw errors.invalidCredentials();
    }

    // Password OK but email not verified: counts toward the IP cap (attacker
    // could probe unverified accounts), does NOT bump the per-account
    // counter (password was correct).
    if (!row.email_verified) {
      recordAttempt(ipKey, LOGIN_WINDOW_MS);
      throw errors.emailNotVerified();
    }

    await clearAuthFailures(row.id);

    return User.fromRow(row);
  }

  static async findById(userId: string, db: Db = sql): Promise<UserRow | null> {
    const [row] = await db<UserRow[]>`
      SELECT id, email, first_name, last_name, locale, role, email_verified, tutorial_done_at
      FROM users WHERE id = ${userId}
    `;
    return row ?? null;
  }

  // Terminal either way — finishing and skipping both close the gate. First
  // write wins, so a guest flag syncing after a real completion cannot
  // downgrade the recorded outcome.
  static async markTutorialDone(
    userId: string,
    outcome: 'completed' | 'skipped',
    db: Db = sql,
  ): Promise<void> {
    await db`
      UPDATE users
      SET tutorial_done_at = now(), tutorial_outcome = ${outcome}
      WHERE id = ${userId} AND tutorial_done_at IS NULL
    `;
  }

  static async getCustomerId(userId: string, db: Db = sql): Promise<string | null> {
    const [row] = await db<{ customer_id: string | null }[]>`
      SELECT customer_id FROM users WHERE id = ${userId}
    `;
    return row?.customer_id ?? null;
  }

  static async setCustomerId(userId: string, customerId: string, db: Db = sql): Promise<void> {
    await db`UPDATE users SET customer_id = ${customerId} WHERE id = ${userId}`;
  }
}
