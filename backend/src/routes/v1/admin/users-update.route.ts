import type { Hono } from 'hono';
import { z } from 'zod';
import { errors } from '~/lib/error';
import { responses } from '~/lib/response';
import { validate } from '~/lib/validate';
import { User } from '~/models/user';
import { toWire } from './users.helper';
import type { AdminEnv } from './types';

// PATCH /admin/users/:id   partial profile edit.
//
// Editing `email` here bypasses the verification flow that normal users
// go through — the new address is trusted immediately. That is the point
// (it exists to fix a typo at signup), but the client is expected to warn.
//
// Role is the one field an admin may not turn on themselves: see the guard
// below. The rest of this route is happy to edit your own row.

const Body = z
  .object({
    firstName: z.string().trim().min(1).max(80).optional(),
    lastName: z.string().trim().min(1).max(80).optional(),
    email: z.email('Enter a valid email address.').optional(),
    locale: z.enum(['en', 'fr', 'ar']).optional(),
    role: z.enum(['learner', 'admin', 'expert']).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: 'Nothing to update.' });

export default function registerRoutes(app: Hono<AdminEnv>): void {
  app.patch('/users/:id', validate('json', Body), async (c) => {
    const id = c.req.param('id');
    const patch = c.req.valid('json');

    // Same single-operator lockout that `refuseSelf` blocks on disable and
    // delete, arriving through the edit form instead. This route only runs
    // for admins, so a role patch on your own row is either a no-op or a
    // demotion — and a demotion is unrecoverable without database access.
    if (patch.role && patch.role !== 'admin' && id === c.get('user').id) {
      throw errors.invalidValue('You cannot change your own role.');
    }

    let row;
    try {
      row = await User.adminUpdate(id, patch);
    } catch (err) {
      // users_email_lower_idx — the case-insensitive uniqueness index.
      if (err instanceof Error && 'code' in err && err.code === '23505') {
        throw errors.emailAlreadyRegistered();
      }
      throw err;
    }
    if (!row) throw errors.resourceMissing('User not found.');
    return responses.content(c, toWire(row));
  });
}
