import { expect, test } from '@playwright/test'

test('an open private view signs out at the original seven-day deadline despite activity', async ({ page }) => {
  const start = Date.UTC(2026, 0, 1)
  const week = 7 * 24 * 60 * 60 * 1000
  await page.clock.install({ time: new Date(start) })
  await page.route('**/api/auth/session', async route => {
    const now = await page.evaluate(() => Date.now())
    return route.fulfill({ json: { authenticated: true, user: { name: 'Test Pilot' }, serverTime: now, expiresAt: start + week } })
  })
  await page.goto('/settings/home')
  await expect(page.locator('.account-hero')).toContainText('Test Pilot')
  await page.clock.fastForward(week - 60000)
  const checked = page.waitForResponse('**/api/auth/session')
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await checked
  await expect(page.locator('.account-hero')).toBeVisible()
  await page.clock.fastForward(60001)
  await expect(page.getByRole('heading', { name: 'Link your Microsoft account' })).toBeVisible()
  await expect(page.getByText('Test Pilot')).toHaveCount(0)
})

test('signing out clears another open tab in the same browser', async ({ page, context }) => {
  const expiry = Date.now() + 7 * 86400000
  let authenticated = true
  await context.route('**/api/auth/session', route => route.fulfill({ json: { authenticated, expiresAt: expiry, serverTime: Date.now(), user: { name: 'Test Pilot' } } }))
  await context.route('**/api/auth/logout', route => {
    authenticated = false
    return route.fulfill({status: 204})
  })
  await page.goto('/settings/home')
  const second = await context.newPage()
  await second.goto('/settings/home')
  await expect(second.locator('.account-hero')).toBeVisible()
  await page.getByRole('button', {name: 'Sign out'}).click()
  await expect(second.getByRole('heading', {name:'Link your Microsoft account'})).toBeVisible()
})
