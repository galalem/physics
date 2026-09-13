import type { Hono } from 'hono';
import { z } from 'zod';
import { responses } from '~/lib/response';
import { validate } from '~/lib/validate';
import { User, type AdminUserStatus } from '~/models/user';
import { toWire } from './users.helper';
import type { AdminEnv } from './types';

// GET /admin/users   paginated directory. Search matches email or full
//                    name. Soft-deleted rows are excluded unless asked
//                    for — this is the only surface that can see them.

const Query = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.enum(['all', 'active', 'disabled', 'locked', 'unverified', 'deleted']).default('all'),
  includeDeleted: z.coerce.boolean().default(false),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(100).default(25),
});

export default function registerRoutes(app: Hono<AdminEnv>): void {
  app.get('/users', validate('query', Query), async (c) => {
    const { q, status, includeDeleted, page, size } = c.req.valid('query');
    // Asking for the deleted bucket implies including them.
    const withDeleted = includeDeleted || status === 'deleted';
    const { rows, total } = await User.adminList(
      { query: q, status: status as AdminUserStatus, includeDeleted: withDeleted },
      page,
      size,
    );
    return responses.page(c, rows.map(toWire), page, size, total);
  });
}
