import type { Hono } from 'hono';
import { errors } from '~/lib/error';
import { responses } from '~/lib/response';
import { Session } from '~/models/session';
import type { AdminEnv } from './types';

//   DELETE /admin/users/:id/sessions        sign out everywhere
//   DELETE /admin/users/:id/sessions/:sid   revoke one device

export default function registerRoutes(app: Hono<AdminEnv>): void {
  app.delete('/users/:id/sessions', async (c) => {
    const id = c.req.param('id');
    const count = await Session.deleteAllForUser(id);
    return responses.mutation(c, id, `Signed out of ${count} device${count === 1 ? '' : 's'}.`);
  });

  app.delete('/users/:id/sessions/:sid', async (c) => {
    const id = c.req.param('id');
    const sid = c.req.param('sid');
    // Scoped by user id so a stray session id cannot be revoked from the
    // wrong person's detail screen.
    if (!(await Session.deleteById(sid, id))) {
      throw errors.resourceMissing('Session not found for this user.');
    }
    return responses.mutation(c, sid, 'Session revoked.');
  });
}
