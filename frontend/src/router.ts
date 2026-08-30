import { auth, createRouter, guards, layout, type Guard } from '@galalem/react-router'
import { ensureMe } from './hooks/useMe'
import { tutorial } from './lib/tutorial'
import {
  AppLayout,
  AuthLayout,
  PublicLayout,
} from './layouts'
import {
  CheckoutSuccessPage,
  DashboardPage,
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
    layout(AppLayout, [
      auth([guards([requireTutorial], [{ path: '/dashboard', component: DashboardPage }])]),
    ]),
  ],
})
