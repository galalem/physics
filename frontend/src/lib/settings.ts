import { http, type ContentResponse, type MutationResponse, type Response } from './api'
import type { Locale, Me } from './auth'

export interface Entitlement {
  id: string
  grantedAt: string
  validUntil: string
  source: string
  scopeFilter: { tags?: unknown } | null
  amountMinor: number | null
  currency: string | null
}

export interface SubscriptionSummary {
  active: Entitlement[]
  history: Entitlement[]
}

// All operations on /my/*, plus the /auth/logout convenience for the
// "delete account" post-invalidation. Types live here because
// `lib/api.ts` is transport-only (per the layering memory).
export const settings = {
  getProfile: () => http.get('my/profile') as Promise<ContentResponse<Me>>,

  updateProfile: (input: { firstName?: string; lastName?: string; locale?: Locale }) =>
    http.post('my/profile', input) as Promise<ContentResponse<Me>>,

  changeEmail: (input: { email: string; password: string }) =>
    http.post('my/profile', input) as Promise<ContentResponse<Me>>,

  changePassword: (input: { oldPassword: string; newPassword: string }) =>
    http.post('my/password', input) as Promise<Response>,

  exportPersonalData: (input: { password: string }) =>
    http.post('my/personal-data', input) as Promise<ContentResponse<Record<string, unknown>>>,

  deleteAccount: (input: { password: string }) =>
    http.delete('my/profile', input) as Promise<MutationResponse>,

  getSubscription: () =>
    http.get('my/subscription') as Promise<ContentResponse<SubscriptionSummary>>,
}
