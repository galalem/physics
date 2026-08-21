import { type Db, sql } from '~/lib/db';

export class PasswordChange {
  // Appends a password change audit entry. Called from signup,
  // /my/password, and /auth/password. No reads yet — the table sits
  // ready for future features (reject reuse of recent passwords,
  // recovery via a previous password).
  static async record(userId: string, passwordHash: string, db: Db = sql): Promise<void> {
    await db`
      INSERT INTO password_changes (user_id, password_hash)
      VALUES (${userId}, ${passwordHash})
    `;
  }
}
