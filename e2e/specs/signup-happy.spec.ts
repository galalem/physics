import { expect, test } from '@playwright/test'
import { extractLinkToken, purge, waitForRecipient } from '../helpers/mailpit'

// Template spec: drives the full signup → verify → login flow end-to-end
// against the real backend + Mailpit. Kept as the canonical example for
// future e2e specs; not exhaustive coverage.

test('signup → verify → login (EN)', async ({ page }) => {
  await purge()
  const email = `e2e-signup-${Date.now()}@example.com`
  const password = 'supersecret'

  // --- Signup -----------------------------------------------------------
  await page.goto('/signup')
  await page.getByLabel('First name').fill('E2E')
  await page.getByLabel('Last name').fill('Signup')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign up' }).click()
  await expect(page.getByText('Check your inbox')).toBeVisible()

  // --- Verify -----------------------------------------------------------
  const verifyMail = await waitForRecipient(email)
  expect(verifyMail.Subject).toContain('Verify')
  const token = extractLinkToken(verifyMail)

  await page.goto(`/verify-email?token=${token}`)
  await expect(page.getByText('Email verified')).toBeVisible()

  // --- Login ------------------------------------------------------------
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page).toHaveURL('/')

  // Session cookie set by the login response.
  const cookies = await page.context().cookies()
  expect(cookies.find((c) => c.name === 'session')).toBeDefined()
})
