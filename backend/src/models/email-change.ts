import { createHash, randomBytes } from 'node:crypto';
import { type Db, sql } from '~/lib/db';

const TTL_MS = 24 * 60 * 60 * 1000;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export type RedeemResult =
  | { ok: true; userId: string; newEmail: string }
  | { ok: false; reason: 'invalid' | 'expired' | 'stale' };

export class EmailChange {
  // Cap on total verification mails sent for a single pending transition
  // (initial mint + resends). Resets when the token expires.
  static readonly MAX_ISSUED_COUNT = 3;

  // Initiates a new email transition (signup with oldEmail=null, or an
  // email change). Soft-invalidates any prior pending row for this user
  // so their old tokens stop working, then inserts a fresh pending row
  // with a new verification token. Returns the plaintext token — the
  // caller mails it.
  static async initiate(
    userId: string,
    oldEmail: string | null,
    newEmail: string,
    db: Db = sql,
  ): Promise<string> {
    await db`
      UPDATE email_changes
      SET token_hash = NULL, token_expires_at = NULL
      WHERE user_id = ${userId} AND verified_at IS NULL AND token_hash IS NOT NULL
    `;
    const token = randomBytes(32).toString('base64url');
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + TTL_MS);
    await db`
      INSERT INTO email_changes (user_id, old_email, new_email, token_hash, token_expires_at)
      VALUES (${userId}, ${oldEmail}, ${newEmail}, ${tokenHash}, ${expiresAt})
    `;
    return token;
  }

  // Records a restore: user switches back to an address they'd previously
  // verified. No token, no mail — verification is borrowed from history.
  // Caller should have already confirmed the target address is in the
  // user's previously-verified history via wasPreviouslyVerified.
  static async recordRestore(
    userId: string,
    oldEmail: string | null,
    newEmail: string,
    db: Db = sql,
  ): Promise<void> {
    await db`
      UPDATE email_changes
      SET token_hash = NULL, token_expires_at = NULL
      WHERE user_id = ${userId} AND verified_at IS NULL AND token_hash IS NOT NULL
    `;
    await db`
      INSERT INTO email_changes (user_id, old_email, new_email, verified_at)
      VALUES (${userId}, ${oldEmail}, ${newEmail}, now())
    `;
  }

  // True if this user has ever successfully verified this email address.
  // Used to gate the restore path.
  static async wasPreviouslyVerified(userId: string, email: string, db: Db = sql): Promise<boolean> {
    const rows = await db<{ found: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM email_changes
        WHERE user_id = ${userId}
          AND LOWER(new_email) = LOWER(${email})
          AND verified_at IS NOT NULL
      ) AS found
    `;
    return rows[0]?.found ?? false;
  }

  // Atomic verify: marks the row verified, but only if the row's new_email
  // still matches the user's current email. A "stale" token — one minted
  // for an address the user has since abandoned — is rejected.
  static async redeemToken(token: string, db: Db = sql): Promise<RedeemResult> {
    const tokenHash = hashToken(token);
    const claimed = await db<{ user_id: string; new_email: string }[]>`
      UPDATE email_changes ec
      SET verified_at = now(),
          token_hash = NULL,
          token_expires_at = NULL
      FROM users u
      WHERE ec.token_hash = ${tokenHash}
        AND ec.verified_at IS NULL
        AND ec.token_expires_at > now()
        AND u.id = ec.user_id
        AND u.deleted_at IS NULL
        AND LOWER(u.email) = LOWER(ec.new_email)
      RETURNING ec.user_id, ec.new_email
    `;
    const winner = claimed[0];
    if (winner) return { ok: true, userId: winner.user_id, newEmail: winner.new_email };

    const probe = await db<{
      verified_at: Date | null;
      token_expires_at: Date | null;
      new_email: string;
      current_email: string;
    }[]>`
      SELECT ec.verified_at, ec.token_expires_at, ec.new_email, u.email AS current_email
      FROM email_changes ec
      JOIN users u ON u.id = ec.user_id
      WHERE ec.token_hash = ${tokenHash}
    `;
    const row = probe[0];
    if (!row) return { ok: false, reason: 'invalid' };
    if (row.verified_at !== null) return { ok: false, reason: 'invalid' };
    if (row.token_expires_at && row.token_expires_at.getTime() <= Date.now())
      return { ok: false, reason: 'expired' };
    if (row.new_email.toLowerCase() !== row.current_email.toLowerCase())
      return { ok: false, reason: 'stale' };
    return { ok: false, reason: 'invalid' };
  }

  // The single pending row for a user (if any) — its issued count and
  // expiry. Used by the resend endpoint to decide between rotate / reject
  // / no-op.
  static async findPending(
    userId: string,
    db: Db = sql,
  ): Promise<{ issuedCount: number; tokenExpiresAt: Date } | null> {
    const rows = await db<{ token_issued_count: number; token_expires_at: Date }[]>`
      SELECT token_issued_count, token_expires_at
      FROM email_changes
      WHERE user_id = ${userId} AND verified_at IS NULL AND token_hash IS NOT NULL
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) return null;
    return { issuedCount: row.token_issued_count, tokenExpiresAt: row.token_expires_at };
  }

  // Rotates the token on the pending row. When `resetCount` is true, sets
  // issued_count back to 1 (used when the previous token had already
  // expired, so the user gets a fresh cap). Otherwise increments by 1.
  // Returns null if no pending row exists (rare race).
  static async rotateToken(
    userId: string,
    resetCount: boolean,
    db: Db = sql,
  ): Promise<{ token: string; issuedCount: number } | null> {
    const token = randomBytes(32).toString('base64url');
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + TTL_MS);
    const rows = await db<{ token_issued_count: number }[]>`
      UPDATE email_changes
      SET token_hash = ${tokenHash},
          token_expires_at = ${expiresAt},
          token_issued_count = CASE WHEN ${resetCount} THEN 1 ELSE token_issued_count + 1 END
      WHERE user_id = ${userId} AND verified_at IS NULL AND token_hash IS NOT NULL
      RETURNING token_issued_count
    `;
    const row = rows[0];
    if (!row) return null;
    return { token, issuedCount: row.token_issued_count };
  }
}
