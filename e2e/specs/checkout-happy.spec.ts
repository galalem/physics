import { expect, test } from '@playwright/test'
import { cleanupTestUsers, createVerifiedUser, hasActiveEntitlement } from '../helpers/db'
import { fireCompletedWebhook } from '../helpers/gp-webhook'

// Prod-targeted end-to-end for the paid checkout flow. Skips the GP-side
// cash-confirmation UI (QR only, not automatable) by fabricating the
// `checkout.completed` webhook the way GP would fire it — same shape,
// same HMAC signing secret. Everything else runs against the real prod
// backend + Neon DB.
//
// Prereqs (env vars, sourceable from `backend/.env`):
//   PLAYWRIGHT_BASE_URL=https://physics.galalem.tn
//   DATABASE_URL=<neon prod URL>
//   GALALEM_PAYMENTS_WEBHOOK_SECRET=<same as backend>
//
// See `test:prod` in package.json.

const PAID_SLUG = 'dipole-rc'

test.describe('checkout happy path (prod-only)', () => {
  test.skip(
    !process.env.PLAYWRIGHT_BASE_URL || !process.env.GALALEM_PAYMENTS_WEBHOOK_SECRET,
    'prod-only — use `pnpm test:prod` (needs PLAYWRIGHT_BASE_URL + GALALEM_PAYMENTS_WEBHOOK_SECRET)',
  )

  test.afterAll(async () => {
    await cleanupTestUsers()
  })

  test('login → paywall → checkout redirect → synthetic webhook → paywall lifts', async ({ page, baseURL }) => {
    const email = `e2e-checkout-${Date.now()}@example.com`
    const password = 'supersecret'

    // --- Setup: verified user, no email round-trip -----------------------
    const user = await createVerifiedUser(email, password, baseURL!)

    // --- Login -----------------------------------------------------------
    await page.goto('/login')
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password').fill(password)
    await page.getByRole('button', { name: 'Log in' }).click()
    await expect(page).toHaveURL('/')

    // --- Paywall on a paid exercise --------------------------------------
    await page.goto(`/exercises/${PAID_SLUG}`)
    await expect(page.getByRole('link', { name: 'View plans' })).toBeVisible()

    // --- Follow paywall CTA → /pricing -----------------------------------
    await page.getByRole('link', { name: 'View plans' }).click()
    await expect(page).toHaveURL(/\/pricing/)

    // --- Subscribe on the 1-week card → GP hosted redirect ---------------
    const weekCard = page.locator('.pricing-card').filter({ hasText: '1 week' })
    await Promise.all([
      page.waitForURL(/payments\.galalem\.tn\/checkout\/ses_/, { timeout: 10_000 }),
      weekCard.getByRole('button', { name: 'Subscribe' }).click(),
    ])

    // --- Extract session_id from the GP URL ------------------------------
    const gpUrl = page.url()
    const match = gpUrl.match(/\/checkout\/(ses_[A-Za-z0-9]+)/)
    if (!match) throw new Error(`Session id not found in GP URL: ${gpUrl}`)
    const sessionId = match[1]

    // --- Fire the webhook GP would fire on cash confirmation -------------
    const validityUntil = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString()
    await fireCompletedWebhook({
      targetUrl: `${baseURL}/api/v1/webhooks/galalem-payments`,
      secret: process.env.GALALEM_PAYMENTS_WEBHOOK_SECRET!,
      sessionId,
      userId: user.id,
      validityUntil,
      amountMinor: 10_000,
      currency: 'TND',
    })

    // --- Entitlement lands in DB -----------------------------------------
    await expect
      .poll(() => hasActiveEntitlement(user.id), { timeout: 5_000, intervals: [200, 500] })
      .toBe(true)

    // --- Paywall gone on reload ------------------------------------------
    await page.goto(`/exercises/${PAID_SLUG}`)
    await expect(page.getByRole('link', { name: 'View plans' })).toHaveCount(0)
    await expect(page.locator('iframe').first()).toBeVisible()
  })
})
