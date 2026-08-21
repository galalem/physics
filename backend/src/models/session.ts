import { createHash, randomBytes } from 'node:crypto';
import { SESSION_TTL_SECONDS } from '~/config';
import { type Db, sql } from '~/lib/db';

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
  static async deleteByToken(rawToken: string, db: Db = sql): Promise<void> {
    await db`DELETE FROM sessions WHERE token_hash = ${Session.hashToken(rawToken)}`;
  }
}
