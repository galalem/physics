import { type Db, sql } from '~/lib/db';
import { type EntitlementRow, Entitlement } from '~/models/entitlement';
import { matchesScope } from './scope-filter';

// Pure evaluator. Free-tier bypass → any entitlement whose scope filter
// (or null = full catalog) matches the exercise's tags grants access.
// Callable in a tight loop with pre-loaded entitlements — avoids N DB
// fetches when scoring a whole list of exercises.
export function evaluateAccess(
  tier: string,
  tags: Set<string>,
  entitlements: EntitlementRow[],
): boolean {
  if (tier === 'free') return true;
  for (const ent of entitlements) {
    if (matchesScope(ent.scope_filter?.tags ?? null, tags)) return true;
  }
  return false;
}

// Single-exercise convenience: loads the user's active entitlements and
// delegates. Used by hot paths that only need one decision (POST /my/attempts,
// GET /exercises/:slug). Free tier short-circuits the DB hit.
export async function checkAccess(
  userId: string,
  tier: string,
  tags: Set<string>,
  db: Db = sql,
): Promise<boolean> {
  if (tier === 'free') return true;
  const entitlements = await Entitlement.activeForUser(userId, db);
  return evaluateAccess(tier, tags, entitlements);
}
