import { http, type MutationResponse } from './api'

export type { ApiError } from './api'

export type Locale = 'en' | 'fr' | 'ar'
export type UserRole = 'learner' | 'admin' | 'expert'

export interface Me {
  id: string
  email: string
  firstName: string
  lastName: string
  fullName: string
  locale: Locale
  role: UserRole
  emailVerified: boolean
  /** Null until the user finishes or skips the onboarding tutorial. */
  tutorialDoneAt: string | null
}

export const auth = {
  signup: (input: { email: string; password: string; firstName: string; lastName: string; locale: Locale }) =>
    http.post('auth/signup', input) as Promise<MutationResponse>,
  login: (input: { email: string; password: string }) =>
    http.post('auth/login', input) as Promise<MutationResponse>,
  logout: () => http.post('auth/logout'),
  verifyEmail: (input: { token: string }) => http.post('auth/verify-email', input),
  resendVerify: (input: { email: string }) => http.post('auth/verify-email/resend', input),
  requestReset: (input: { email: string }) => http.post('auth/password-reset', input),
  resetPassword: (input: { token: string; newPassword: string }) => http.post('auth/password', input),
}
