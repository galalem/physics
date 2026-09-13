import type { Hono } from 'hono';
import { errors } from '~/lib/error';
import { responses } from '~/lib/response';
import { Session } from '~/models/session';
import { User } from '~/models/user';
import type { AdminEnv } from './types';

// Reversible state changes on one user.
//
//   POST   /admin/users/:id/disable   active = false
//   POST   /admin/users/:id/enable    active = true
//   POST   /admin/users/:id/unlock    clear the auto-lockout
//   DELETE /admin/users/:id           SOFT delete
//   POST   /admin/users/:id/restore   undo a soft delete
//
// Hard erasure is NOT here on purpose: it stays user-initiated (GDPR)
// in routes/v1/my/profile-delete.

/** An admin locking themselves out of the console is not recoverable in-app. */
function refuseSelf(actorId: string, targetId: string, what: string): void {
  if (actorId === targetId) {
    throw errors.invalidValue(`You cannot ${what} your own account.`);
  }
}

export default function registerRoutes(app: Hono<AdminEnv>): void {
  app.post('/users/:id/disable', async (c) => {
    const id = c.req.param('id');
    refuseSelf(c.get('user').id, id, 'disable');
    if (!(await User.setActive(id, false))) throw errors.resourceMissing('User not found.');
    // Disabling is checked on every request, so dropping their sessions is
    // not what logs them out — it just stops the dead cookies lingering.
    await Session.deleteAllForUser(id);
    return responses.mutation(c, id, 'Account disabled.');
  });

  app.post('/users/:id/enable', async (c) => {
    const id = c.req.param('id');
    if (!(await User.setActive(id, true))) throw errors.resourceMissing('User not found.');
    return responses.mutation(c, id, 'Account enabled.');
  });

  app.post('/users/:id/unlock', async (c) => {
    const id = c.req.param('id');
    if (!(await User.clearLockout(id))) throw errors.resourceMissing('User not found.');
    return responses.mutation(c, id, 'Lockout cleared.');
  });

  app.delete('/users/:id', async (c) => {
    const id = c.req.param('id');
    refuseSelf(c.get('user').id, id, 'delete');
    if (!(await User.softDelete(id))) throw errors.resourceMissing('User not found.');
    await Session.deleteAllForUser(id);
    return responses.mutation(c, id, 'Account deleted. History is preserved.');
  });

  app.post('/users/:id/restore', async (c) => {
    const id = c.req.param('id');
    if (!(await User.restore(id))) {
      throw errors.resourceMissing('No deleted user with that id.');
    }
    return responses.mutation(c, id, 'Account restored.');
  });
}
