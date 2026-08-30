import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { type Locale, SESSION_COOKIE, SESSION_MAX_LIFETIME_SECONDS, SESSION_TTL_SECONDS } from '~/config';
import { sql } from '~/lib/db';
import { errors } from '~/lib/error';
import { Session } from '~/models/session';
import { User } from '~/models/user';

export type UserRole = 'learner' | 'admin' | 'expert';

export interface AuthedUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  fullName: string;
  locale: Locale;
  role: UserRole;
  emailVerified: boolean;
  /** Null until the user finishes or skips the onboarding tutorial. */
  tutorialDoneAt: string | null;
}

type Resolution =
  | { kind: 'valid'; user: AuthedUser }
  | { kind: 'expired' }
  | { kind: 'invalid' }
  | { kind: 'none' };

interface SessionRow {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  locale: string;
  role: string;
  email_verified: boolean;
  tutorial_done_at: Date | null;
  session_id: string;
  session_created_at: Date;
  expires_at: Date;
}

async function resolveCookieToken(token: string): Promise<Resolution> {
  const tokenHash = Session.hashToken(token);
  const rows = await sql<SessionRow[]>`
    SELECT
      u.id, u.email, u.first_name, u.last_name, u.locale, u.role, u.email_verified,
      u.tutorial_done_at,
      s.id AS session_id, s.created_at AS session_created_at, s.expires_at
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ${tokenHash}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return { kind: 'invalid' };
  if (row.expires_at.getTime() <= Date.now()) return { kind: 'expired' };

  // Slide expires_at up: rolling TTL from now, capped at the session's
  // absolute lifetime from created_at.
  const rolling = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
  const hardCap = new Date(row.session_created_at.getTime() + SESSION_MAX_LIFETIME_SECONDS * 1000);
  const newExpires = rolling < hardCap ? rolling : hardCap;

  await sql`
    UPDATE sessions
    SET last_used_at = now(), expires_at = ${newExpires}
    WHERE id = ${row.session_id}
  `;

  return { kind: 'valid', user: User.fromRow(row) };
}

// Order: session cookie → Bearer → API-Key. Bearer and API-Key are stubbed
// until issuance endpoints land; the branches exist so future callers can
// drop in without a middleware rewrite.
async function resolveCredential(
  cookieToken: string | null,
  bearer: string | null,
  apiKey: string | null,
): Promise<Resolution> {
  if (cookieToken) return resolveCookieToken(cookieToken);
  if (bearer) return { kind: 'invalid' };
  if (apiKey) return { kind: 'invalid' };
  return { kind: 'none' };
}

function readCredentials(c: Parameters<MiddlewareHandler>[0]): {
  cookieToken: string | null;
  bearer: string | null;
  apiKey: string | null;
} {
  const cookieToken = getCookie(c, SESSION_COOKIE) ?? null;
  const authHeader = c.req.header('authorization') ?? '';
  const bearer = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : null;
  const apiKey = c.req.header('x-api-key') ?? null;
  return { cookieToken, bearer, apiKey };
}

// Required auth: throws on any resolution other than `valid`.
export const requireAuth: MiddlewareHandler<{ Variables: { user: AuthedUser } }> = async (c, next) => {
  const { cookieToken, bearer, apiKey } = readCredentials(c);
  const res = await resolveCredential(cookieToken, bearer, apiKey);
  if (res.kind === 'valid') {
    c.set('user', res.user);
    await next();
    return;
  }
  if (res.kind === 'expired') throw errors.authenticationExpired();
  if (res.kind === 'invalid') throw errors.authenticationInvalid();
  throw errors.authenticationRequired();
};

// Optional auth: attaches user on valid credential, silent otherwise. Used
// on public catalog routes to enrich responses (e.g. `completed`, `resumableAttemptId`).
export const optionalAuth: MiddlewareHandler<{ Variables: { user?: AuthedUser } }> = async (c, next) => {
  const { cookieToken, bearer, apiKey } = readCredentials(c);
  const res = await resolveCredential(cookieToken, bearer, apiKey);
  if (res.kind === 'valid') c.set('user', res.user);
  await next();
};

// Pure resolver (no middleware side effects). Returns the authed user if
// the request carries any valid credential, else null. Used by /auth/check
// which needs to respond 200/401 with empty body — no JSON error envelope.
export async function resolveUser(c: Parameters<MiddlewareHandler>[0]): Promise<AuthedUser | null> {
  const { cookieToken, bearer, apiKey } = readCredentials(c);
  const res = await resolveCredential(cookieToken, bearer, apiKey);
  return res.kind === 'valid' ? res.user : null;
}
