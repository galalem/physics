import type { Hono } from 'hono';
import { responses } from '~/lib/response';
import type { MyEnv } from './types';

// GET /my/profile   current user profile. AuthedUser is already attached
//                   by the requireAuth middleware and is itself the wire
//                   shape — no reshape or extra DB read needed.
export default function registerRoutes(app: Hono<MyEnv>): void {
  app.get('/profile', (c) => {
    c.header('Cache-Control', 'no-store');
    return responses.content(c, c.get('user'));
  });
}
