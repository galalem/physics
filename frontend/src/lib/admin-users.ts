import { bread, http, type ContentResponse, type MutationResponse, type PaginatedResponse } from '~/lib/api'

// Admin user directory. Pure namespace beside `auth` — `api.ts` stays
// transport-only, and the pages own their own list/filter state.

export type AdminUserStatus = 'deleted' | 'disabled' | 'locked' | 'unverified' | 'active'
export type AdminUserFilter = 'all' | 'active' | 'disabled' | 'locked' | 'unverified' | 'deleted'

export interface AdminUser {
  id: string
  email: string
  firstName: string
  lastName: string
  fullName: string
  locale: string
  role: string
  /** Derived server-side so the list and the detail screen cannot disagree. */
  status: AdminUserStatus
  emailVerified: boolean
  active: boolean
  deletedAt: string | null
  lockedUntil: string | null
  failedLoginCount: number
  tutorialDoneAt: string | null
  tutorialOutcome: 'completed' | 'skipped' | null
  customerId: string | null
  createdAt: string
}

export interface AdminUserSession {
  id: string
  /** No IP is recorded anywhere — user agent and timestamps are all we have. */
  userAgent: string | null
  createdAt: string
  lastUsedAt: string
  expiresAt: string
}

export interface AdminUserDetail extends AdminUser {
  sessions: AdminUserSession[]
  entitlements: {
    id: string
    source: string
    scopeFilter: { tags?: unknown } | null
    /** How many live exercises this scope actually unlocks. 0 = paid for nothing. */
    unlocks: number
    grantedAt: string
    validUntil: string
  }[]
  attempts: { total: number; completed: number; succeeded: number; lastActivityAt: string | null }
}

export interface AdminUserListParams {
  q?: string
  status?: AdminUserFilter
  includeDeleted?: boolean
  page?: number
  size?: number
}

export const adminUsers = {
  list: ({ q, status = 'all', includeDeleted = false, page = 1, size = 25 }: AdminUserListParams = {}) =>
    bread.browse<AdminUser>('admin/users', page, size, {
      q: q?.trim() || undefined,
      status,
      includeDeleted: String(includeDeleted),
    }) as Promise<PaginatedResponse<AdminUser>>,

  read: (id: string) => bread.read<AdminUserDetail>('admin/users', id),

  update: (id: string, patch: Partial<Pick<AdminUser, 'firstName' | 'lastName' | 'email' | 'locale' | 'role'>>) =>
    http.patch(`admin/users/${id}`, patch) as Promise<ContentResponse<AdminUser>>,

  invite: (body: { email: string; firstName: string; lastName: string; locale: string; role: string }) =>
    http.post('admin/users', body) as Promise<ContentResponse<AdminUser>>,

  resendInvite: (id: string) => http.post(`admin/users/${id}/invite`) as Promise<MutationResponse>,

  disable: (id: string) => http.post(`admin/users/${id}/disable`) as Promise<MutationResponse>,
  enable: (id: string) => http.post(`admin/users/${id}/enable`) as Promise<MutationResponse>,
  unlock: (id: string) => http.post(`admin/users/${id}/unlock`) as Promise<MutationResponse>,
  restore: (id: string) => http.post(`admin/users/${id}/restore`) as Promise<MutationResponse>,

  /** Soft delete. Hard erasure is user-initiated only (GDPR). */
  remove: (id: string) => http.delete(`admin/users/${id}`) as Promise<MutationResponse>,

  revokeSessions: (id: string) => http.delete(`admin/users/${id}/sessions`) as Promise<MutationResponse>,
  revokeSession: (id: string, sessionId: string) =>
    http.delete(`admin/users/${id}/sessions/${sessionId}`) as Promise<MutationResponse>,
}
