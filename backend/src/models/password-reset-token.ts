import { createHash, randomBytes } from 'node:crypto';
import { type Db, sql } from '~/lib/db';

const TTL_MS = 60 * 60 * 1000;

/**
 * Invites reuse this table: the mechanism is identical (one-time, hashed
 * at rest, expiring) and redeeming one lands on the same "set your
 * password" page. Only the lifetime differs — a reset is a response to
 * something the user just did, an invite may sit in an inbox for days.
 */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export type RedeemResult =
  | { ok: true; userId: string }
  | { ok: false; reason: 'invalid' | 'expired' };

export class PasswordResetToken {
  // Mints a fresh reset token. Returns the plaintext — caller mails it
  // inside the reset link.
  static async mint(userId: string, db: Db = sql, ttlMs: number = TTL_MS): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + ttlMs);
    await db`
      INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
      VALUES (${userId}, ${tokenHash}, ${expiresAt})
    `;
    return token;
  }

  // Soft-invalidates any outstanding (unconsumed) reset tokens for the
  // user. Called before minting a fresh one so old links stop working.
  // Kept as UPDATE (not DELETE) so historical rows still count toward
  // the per-account rate limit via countRecentMints.
  static async invalidateOutstanding(userId: string, db: Db = sql): Promise<void> {
    await db`
      UPDATE password_reset_tokens
      SET consumed_at = now()
      WHERE user_id = ${userId} AND consumed_at IS NULL
    `;
  }

  // Atomic redeem: matches by hash, requires unconsumed + unexpired,
  // sets consumed_at, returns user_id. Follow-up probe distinguishes
  // reasons on failure.
  static async redeem(token: string, db: Db = sql): Promise<RedeemResult> {
    const tokenHash = hashToken(token);
    const claimed = await db<{ user_id: string }[]>`
      UPDATE password_reset_tokens
      SET consumed_at = now()
      WHERE token_hash = ${tokenHash}
        AND consumed_at IS NULL
        AND expires_at > now()
      RETURNING user_id
    `;
    const winner = claimed[0];
    if (winner) return { ok: true, userId: winner.user_id };

    const probe = await db<{ expires_at: Date; consumed_at: Date | null }[]>`
      SELECT expires_at, consumed_at FROM password_reset_tokens WHERE token_hash = ${tokenHash}
    `;
    const row = probe[0];
    if (!row) return { ok: false, reason: 'invalid' };
    if (row.consumed_at !== null) return { ok: false, reason: 'invalid' };
    if (row.expires_at.getTime() <= Date.now()) return { ok: false, reason: 'expired' };
    return { ok: false, reason: 'invalid' };
  }

  // Number of reset tokens minted for a user in the last `withinMs`.
  // Feeds the per-account rate limit on POST /auth/password-reset.
  static async countRecentMints(userId: string, withinMs: number): Promise<number> {
    const since = new Date(Date.now() - withinMs);
    const rows = await sql<{ n: number }[]>`
      SELECT COUNT(*)::int AS n FROM password_reset_tokens
      WHERE user_id = ${userId} AND created_at > ${since}
    `;
    return rows[0]?.n ?? 0;
  }
}
