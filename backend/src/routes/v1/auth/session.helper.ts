import type { Context } from 'hono';
import { setCookie } from 'hono/cookie';
import { config, SESSION_COOKIE, SESSION_TTL_SECONDS } from '~/config';

// HTTP-response shaping for the session cookie. The DB-side session
// operations live on the Session model — these two are the "how it lands
// on the client" piece.
const COOKIE_OPTIONS = () =>
  ({
      httpOnly: true,
      secure: config.sessionCookieSecure,
      sameSite: 'Lax' as const,
      path: '/',
  });

export function setSessionCookie(c: Context, token: string): void {
  setCookie(c, SESSION_COOKIE, token, {
    ...COOKIE_OPTIONS(),
    maxAge: SESSION_TTL_SECONDS,
  });
}

export function clearSessionCookie(c: Context): void {
  setCookie(c, SESSION_COOKIE, '', {
    ...COOKIE_OPTIONS(),
    maxAge: 0,
  });
}
