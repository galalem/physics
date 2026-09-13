import type { AdminUserRow } from '~/models/user';

/**
 * DB row → wire shape for the admin console.
 *
 * `status` is derived here rather than in the client so the list and the
 * detail screen can never disagree about what a row is. Order matters:
 * deleted outranks disabled outranks locked outranks unverified.
 */
export type AdminUserStatusLabel =
  | 'deleted'
  | 'disabled'
  | 'locked'
  | 'unverified'
  | 'active';

export function statusOf(row: AdminUserRow): AdminUserStatusLabel {
  if (row.deleted_at) return 'deleted';
  if (!row.active) return 'disabled';
  if (row.locked_until && row.locked_until.getTime() > Date.now()) return 'locked';
  if (!row.email_verified) return 'unverified';
  return 'active';
}

export function toWire(row: AdminUserRow) {
  return {
    id: row.id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    fullName: `${row.first_name} ${row.last_name}`,
    locale: row.locale,
    role: row.role,
    status: statusOf(row),
    emailVerified: row.email_verified,
    active: row.active,
    deletedAt: row.deleted_at?.toISOString() ?? null,
    lockedUntil: row.locked_until?.toISOString() ?? null,
    failedLoginCount: row.failed_login_count,
    tutorialDoneAt: row.tutorial_done_at?.toISOString() ?? null,
    tutorialOutcome: row.tutorial_outcome,
    customerId: row.customer_id,
    createdAt: row.created_at.toISOString(),
  };
}
