import { auth, createRouter, layout } from '@galalem/react-router'
import { ensureMe } from './hooks/useMe'
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
  VerifyEmailPage,
} from './pages'

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
      auth([{ path: '/exercises/:slug', component: ExercisePage }]),
    ]),
    layout(AuthLayout, [
      { path: '/login', component: LoginPage },
      { path: '/signup', component: SignupPage },
      { path: '/forgot-password', component: ForgotPasswordPage },
      { path: '/reset-password', component: ResetPasswordPage },
      { path: '/verify-email', component: VerifyEmailPage },
    ]),
    layout(AppLayout, [
      auth([{ path: '/dashboard', component: DashboardPage }]),
    ]),
  ],
})
