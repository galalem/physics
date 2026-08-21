import type { Hono, Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { SESSION_COOKIE } from '~/config';
import { responses } from '~/lib/response';
import { requireAuth } from '~/middleware/auth';
import { Session } from '~/models/session';
import type { AuthEnv } from './types';
import { clearSessionCookie } from './session.helper';


export async function logout(c: Context): Promise<void> {
  const cookieToken = getCookie(c, SESSION_COOKIE);
  if (cookieToken) await Session.deleteByToken(cookieToken);
  clearSessionCookie(c);
}

// POST /logout   requires a valid credential. Deletes the specific session
//                row for the incoming cookie and clears the cookie in the
//                response. Idempotent: if the row was already gone, we still
//                return 200 and clear the cookie.
//
// Note: when Bearer / API-Key issuance land, logout for those credential
// types will revoke only the specific token/key used (session cookies on
// the same account stay untouched). V1 only issues session cookies, so the
// branch below covers everything.
export default function registerRoutes(app: Hono<AuthEnv>): void {
  app.post('/logout', requireAuth, async (c) => {
    await logout(c);
    c.header('Cache-Control', 'no-store');
    return responses.empty(c);
  });
}
