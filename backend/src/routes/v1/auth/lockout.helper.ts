import { type Db, sql } from '~/lib/db';
import { LOCKOUT_DURATION_MS, LOCKOUT_MAX_FAILURES } from './rate-limit.helper';

// Bumps failed_login_count on a user; when it reaches the max, arms a
// transient lockout (locked_until = now + duration) and resets the counter
// so a subsequent failure starts a fresh cycle after the lock expires.
// Shared by /auth/login and /my/password — both count toward the same lock.
export async function recordAuthFailure(userId: string, db: Db = sql): Promise<void> {
  const bumped = await db<{ failed_login_count: number }[]>`
    UPDATE users
    SET failed_login_count = failed_login_count + 1
    WHERE id = ${userId}
    RETURNING failed_login_count
  `;
  if ((bumped[0]?.failed_login_count ?? 0) >= LOCKOUT_MAX_FAILURES) {
    const lockedUntil = new Date(Date.now() + LOCKOUT_DURATION_MS);
    await db`
      UPDATE users
      SET locked_until = ${lockedUntil}, failed_login_count = 0
      WHERE id = ${userId}
    `;
  }
}

// Clears counter + any lock — used on successful auth (login, password
// change, password reset) as a courtesy.
export async function clearAuthFailures(userId: string, db: Db = sql): Promise<void> {
  await db`
    UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE id = ${userId}
  `;
}
