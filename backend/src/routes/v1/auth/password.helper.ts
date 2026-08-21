import { hash, verify, type Options } from '@node-rs/argon2';
import { sql } from '~/lib/db';
import { errors } from '~/lib/error';
import { recordAuthFailure } from './lockout.helper';

// OWASP 2024 recommendation. `algorithm` is omitted because argon2id is
// the library default; specifying it explicitly needs the `Algorithm`
// const enum, which verbatimModuleSyntax refuses at import.
const ARGON_OPTIONS: Options = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
};

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, ARGON_OPTIONS);
}

// When `encoded` is null (unknown email on login), verify against a decoy
// hash so both branches spend argon2 time — constant-time defense against
// user-enumeration timing attacks. Always returns false in the decoy case.
// Decoy is lazy-initialized so scripts that never authenticate (migrate,
// seed) don't pay the ~50 ms startup cost.
let decoyPromise: Promise<string> | null = null;
function getDecoy(): Promise<string> {
  if (!decoyPromise) decoyPromise = hash('decoy-not-a-real-password', ARGON_OPTIONS);
  return decoyPromise;
}

export async function verifyPassword(encoded: string | null, plain: string): Promise<boolean> {
  if (encoded === null) {
    await verify(await getDecoy(), plain);
    return false;
  }
  return verify(encoded, plain);
}

// Danger-zone password re-verification. Used by any endpoint that gates an
// irreversible or high-value action (delete account, export data, change
// email, change password).
//
// The session cookie already authenticates the caller — this extra check
// proves they aren't a stolen-cookie attacker. Applies the same lockout
// semantics as /auth/login: locked → 401 authentication_expired with
// retryAfter; wrong → 401 invalid_credentials + bumps the shared failure
// counter (10 failures across any password endpoint → 15-min lockout);
// missing user row → 401 authentication_invalid.
export async function requirePasswordReverify(userId: string, password: string): Promise<void> {
  const rows = await sql<{ password_hash: string; locked_until: Date | null }[]>`
    SELECT password_hash, locked_until FROM users WHERE id = ${userId}
  `;
  const row = rows[0];
  if (!row) throw errors.authenticationInvalid();

  if (row.locked_until && row.locked_until.getTime() > Date.now()) {
    const retryAfter = Math.ceil((row.locked_until.getTime() - Date.now()) / 1000);
    throw errors.authenticationExpired({ retryAfter });
  }

  const ok = await verifyPassword(row.password_hash, password);
  if (!ok) {
    await recordAuthFailure(userId);
    throw errors.invalidCredentials('The current password is incorrect.');
  }
}
