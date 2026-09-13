import { auth, createRouter, guards, layout, roles, type Guard } from '@galalem/react-router'
import { ensureMe } from './hooks/useMe'
import { tutorial } from './lib/tutorial'
import { lazyLayout, lazyPage } from './lib/lazy-page'
import { AuthLayout, PublicLayout } from './layouts'
import {
  CheckoutSuccessPage,
  ExercisePage,
  ForgotPasswordPage,
  HomePage,
  LoginPage,
  PricingPage,
  PrivacyPage,
  ResetPasswordPage,
  SignupPage,
  TermsPage,
  TutorialPage,
  VerifyEmailPage,
} from './pages'
import type { Me } from './lib/auth'

// Signed-in users are pushed through the tutorial before they can reach
// the app proper. Applied to the app-shaped routes only — the marketing
// home, pricing and legal pages stay reachable, so a redirect never traps
// someone who just wanted to read the terms.
const requireTutorial: Guard = async () => {
  const me = await ensureMe()
  return tutorial.isPending(me) ? { redirect: '/tutorial' } : true
}

export const router = createRouter({
  auth: {
    currentUser: ensureMe,
    userRoles: (user) => [(user as Me).role],
    loginPath: '/login',
  },
  routes: [
    layout(PublicLayout, [
      { path: '/', component: HomePage },
      { path: '/privacy', component: PrivacyPage },
      { path: '/terms', component: TermsPage },
      { path: '/pricing', component: PricingPage },
      { path: '/checkout/success', component: CheckoutSuccessPage },
      // Public on purpose — the tutorial doubles as the pitch for guests.
      { path: '/tutorial', component: TutorialPage },
      auth([guards([requireTutorial], [{ path: '/exercises/:slug', component: ExercisePage }])]),
    ]),
    layout(AuthLayout, [
      { path: '/login', component: LoginPage },
      { path: '/signup', component: SignupPage },
      { path: '/forgot-password', component: ForgotPasswordPage },
      { path: '/reset-password', component: ResetPasswordPage },
      { path: '/verify-email', component: VerifyEmailPage },
    ]),

    // Admin console. Every page is code-split, so the chunks are only
    // fetched once the roles guard passes — guests and students never
    // download any of it.
    layout(lazyLayout(() => import('./layouts/admin/layout').then((m) => m.AdminLayout)), [
      auth([
        roles(['admin'], [
          { path: '/admin', component: lazyPage(() => import('./pages/admin/dashboard/page').then((m) => m.AdminDashboardPage)) },
          { path: '/admin/users', component: lazyPage(() => import('./pages/admin/users/page').then((m) => m.AdminUsersPage)) },
          { path: '/admin/users/:id', component: lazyPage(() => import('./pages/admin/users/detail').then((m) => m.AdminUserDetailPage)) },
          { path: '/admin/exercises', component: lazyPage(() => import('./pages/admin/exercises/page').then((m) => m.AdminExercisesPage)) },
          { path: '/admin/tags', component: lazyPage(() => import('./pages/admin/tags/page').then((m) => m.AdminTagsPage)) },
          { path: '/admin/entitlements', component: lazyPage(() => import('./pages/admin/entitlements/page').then((m) => m.AdminEntitlementsPage)) },
          { path: '/admin/promo-codes', component: lazyPage(() => import('./pages/admin/promo-codes/page').then((m) => m.AdminPromoCodesPage)) },
          { path: '/admin/attempts', component: lazyPage(() => import('./pages/admin/attempts/page').then((m) => m.AdminAttemptsPage)) },
          { path: '/admin/teachers', component: lazyPage(() => import('./pages/admin/planned').then((m) => m.AdminTeachersPage)) },
          { path: '/admin/experts', component: lazyPage(() => import('./pages/admin/planned').then((m) => m.AdminExpertsPage)) },
          { path: '/admin/feedback', component: lazyPage(() => import('./pages/admin/planned').then((m) => m.AdminFeedbackPage)) },
        ]),
      ]),
    ]),
  ],
})
