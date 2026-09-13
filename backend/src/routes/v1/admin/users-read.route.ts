import type { Hono } from 'hono';
import { errors } from '~/lib/error';
import { responses } from '~/lib/response';
import { sql } from '~/lib/db';
import { matchesScope } from '~/lib/scope-filter';
import { Attempt } from '~/models/attempt';
import { Entitlement } from '~/models/entitlement';
import { Session } from '~/models/session';
import { User } from '~/models/user';
import { toWire } from './users.helper';
import type { AdminEnv } from './types';

// GET /admin/users/:id   one user plus the context a support question
//                        actually needs: live devices, what they paid for,
//                        and how much they have played.

export default function registerRoutes(app: Hono<AdminEnv>): void {
  app.get('/users/:id', async (c) => {
    const id = c.req.param('id');
    const row = await User.adminFindById(id);
    if (!row) throw errors.resourceMissing('User not found.');

    const [sessions, entitlements, attempts, catalogue] = await Promise.all([
      Session.listForUser(id),
      Entitlement.activeForUser(id),
      Attempt.summaryForUser(id),
      // The whole live catalogue with its tags, once — 125 rows, so
      // counting in memory beats a query per entitlement.
      sql<{ exercise_id: string; compound: string }[]>`
        SELECT et.exercise_id, p.slug || ':' || t.slug AS compound
        FROM exercises e
        JOIN exercises_tags et ON et.exercise_id = e.id
        JOIN tags t ON t.id = et.tag_id
        JOIN tags p ON p.id = t.parent_id
        WHERE e.published = true AND e.deleted_at IS NULL
      `,
    ]);

    const tagsByExercise = new Map<string, Set<string>>();
    for (const row of catalogue) {
      let set = tagsByExercise.get(row.exercise_id);
      if (!set) {
        set = new Set<string>();
        tagsByExercise.set(row.exercise_id, set);
      }
      set.add(row.compound);
    }

    // "Why can't I open exercise X?" is the question this screen exists to
    // answer, and a scope that matches nothing is invisible without this —
    // the user paid and unlocked zero exercises, with no error anywhere.
    const unlockCount = (scope: { tags?: unknown } | null): number => {
      let n = 0;
      for (const tags of tagsByExercise.values()) {
        if (matchesScope(scope?.tags ?? null, tags)) n += 1;
      }
      return n;
    };

    return responses.content(c, {
      ...toWire(row),
      // No IP is recorded anywhere — user_agent and timestamps are all we
      // have. Surfacing that honestly beats inventing a column.
      sessions: sessions.map((s) => ({
        id: s.id,
        userAgent: s.user_agent,
        createdAt: s.created_at.toISOString(),
        lastUsedAt: s.last_used_at.toISOString(),
        expiresAt: s.expires_at.toISOString(),
      })),
      entitlements: entitlements.map((e) => ({
        id: e.id,
        source: e.source,
        scopeFilter: e.scope_filter,
        unlocks: unlockCount(e.scope_filter),
        grantedAt: e.granted_at.toISOString(),
        validUntil: e.valid_until.toISOString(),
      })),
      attempts,
    });
  });
}
