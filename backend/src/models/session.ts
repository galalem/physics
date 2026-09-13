import { createHash, randomBytes } from 'node:crypto';
import { SESSION_TTL_SECONDS } from '~/config';
import { type Db, sql } from '~/lib/db';

export interface SessionSummaryRow {
  id: string;
  user_agent: string | null;
  created_at: Date;
  last_used_at: Date;
  expires_at: Date;
}

export class Session {
  // SHA-256 hash of a plaintext session token — same shape stored on
  // sessions.token_hash. Kept as its own method so the middleware
  // (lookup) and route handlers (delete) don't duplicate the hashing.
  static hashToken(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }

  // Mints a fresh session: 256-bit random token, SHA-256 hashed at rest.
  // Returns the plaintext — only the caller ever sees it (it goes
  // straight into the response cookie).
  static async create(userId: string, userAgent: string | null, db: Db = sql): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    const tokenHash = Session.hashToken(token);
    const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
    await db`
      INSERT INTO sessions (user_id, token_hash, expires_at, user_agent)
      VALUES (${userId}, ${tokenHash}, ${expiresAt}, ${userAgent})
    `;
    return token;
  }

  // Deletes the specific session identified by the plaintext cookie
  // token. Idempotent — deleting an already-gone row is a no-op.
  // Admin: a user's live devices. No IP column exists — `user_agent` and
  // `last_used_at` are all we record, so the admin UI cannot show an IP
  // without a schema change.
  static async listForUser(userId: string, db: Db = sql): Promise<SessionSummaryRow[]> {
    return db<SessionSummaryRow[]>`
      SELECT id, user_agent, created_at, last_used_at, expires_at
      FROM sessions
      WHERE user_id = ${userId} AND expires_at > now()
      ORDER BY last_used_at DESC
    `;
  }

  static async deleteById(sessionId: string, userId: string, db: Db = sql): Promise<boolean> {
    const rows = await db`
      DELETE FROM sessions WHERE id = ${sessionId} AND user_id = ${userId} RETURNING id
    `;
    return rows.length > 0;
  }

  /** Sign out everywhere. Returns how many devices were dropped. */
  static async deleteAllForUser(userId: string, db: Db = sql): Promise<number> {
    const rows = await db`DELETE FROM sessions WHERE user_id = ${userId} RETURNING id`;
    return rows.length;
  }

  static async deleteByToken(rawToken: string, db: Db = sql): Promise<void> {
    await db`DELETE FROM sessions WHERE token_hash = ${Session.hashToken(rawToken)}`;
  }
}
