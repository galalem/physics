import type { Hono } from 'hono';
import { resolveUser } from '~/middleware/auth';
import type { AuthEnv } from './types';

// GET /check   nginx-internal auth_request gate for /runtime/*.
//              Runs the same credential resolver as any protected route
//              but returns bare 200/401 with no JSON body — nginx wants
//              only the status code.
//
// Deliberately does NOT use requireAuth so failures don't emit the unified
// error envelope. The `internal;` directive at the nginx layer keeps this
// endpoint unreachable from the public network.
export default function registerRoutes(app: Hono<AuthEnv>): void {
  app.get('/check', async (c) => {
    const user = await resolveUser(c);
    c.header('Cache-Control', 'no-store');
    return c.body(null, user ? 200 : 401);
  });
}
