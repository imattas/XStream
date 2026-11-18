import { test, expect, type Page } from '@playwright/test'

const xbox = {
  serverId: 'series-x', deviceName: 'Living room', powerState: 'On',
  consoleType: 'Xbox Series X', outOfHomeWarning: false, wirelessWarning: false,
}

async function signedIn(page: Page) {
  const expiry = Date.now() + 7 * 86400000
  await page.route('**/api/auth/session', route => route.fulfill({ json: { authenticated: true, expiresAt: expiry, serverTime: Date.now(), user: { name: 'Test player' } } }))
  await page.route('**/api/consoles', route => route.fulfill({ json: { consoles: [xbox] } }))
}

test('signed-out mobile login pairs with Microsoft and enters the dashboard', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 })
  let approved = false
  const expiry = Date.now() + 7 * 86400000
  await page.route('**/api/auth/session', route => route.fulfill({ json: { authenticated: approved, expiresAt: expiry, serverTime: Date.now(), user: approved ? { name: 'FixtureFox', picture: '/images/console.png' } : undefined } }))
  await page.route('**/api/consoles', route => route.fulfill({ json: { consoles: [] } }))
  await page.route('**/api/auth/device/start', route => route.fulfill({ json: { id: 'fixture-id', code: 'TEST-CODE', uri: 'https://microsoft.com/link', interval: 1, expiresAt: Date.now() + 60000 } }))
  await page.route('**/api/auth/device/poll', route => {
    approved = true
    return route.fulfill({ json: { authenticated: true } })
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Link your Microsoft account' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy()
  await page.getByRole('button', { name: 'Sign in with Microsoft' }).click()
  await expect(page.getByText('TEST-CODE')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Copy code' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible()
  await expect(page.getByText(/Code expires in/)).toBeVisible()
  await expect(page.getByRole('link', { name: 'Open verification page' })).toHaveAttribute('href', 'https://microsoft.com/link')
  await expect(page.getByRole('heading', { name: 'My Consoles' })).toBeVisible()
  await expect(page.locator('.profile')).toHaveText('FixtureFox')
  await expect(page.locator('.avatar img')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy()
})

test('console discovery handles an empty list, standby, offline and an expired session', async ({ page }) => {
  await signedIn(page)
  let fetches = 0
  await page.route('**/api/consoles', route => {
    ++fetches
    if (fetches === 3) return route.fulfill({ status: 401, json: { error: 'Xbox rejected the streaming credential.' } })
    if (fetches === 4) return route.fulfill({ status: 401, json: { code: 'session_expired', error: 'Session expired' } })
    return route.fulfill({ json: { consoles: fetches === 1 ? [] : [
      { ...xbox, powerState: 'ConnectedStandby' },
      { ...xbox, serverId: 'office', deviceName: 'Office Xbox', powerState: 'Off' },
    ] } })
  })
  await page.goto('/home')
  await expect(page.getByRole('heading', { name: 'No consoles found' })).toBeVisible()
  await page.reload()
  await expect(page.getByText('Standby')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Console offline' })).toBeDisabled()
  await expect(page.getByRole('link', { name: 'Start stream' })).toHaveAttribute('href', '/stream/series-x')
  await page.reload()
  await expect(page.getByRole('alert')).toContainText('Xbox rejected the streaming credential.')
  await page.reload()
  await expect(page.getByRole('alert')).toContainText('session expired')
})

test('settings persist across reload and controller hotplug updates detection', async ({ page }) => {
  await signedIn(page)
  await page.goto('/')
  await page.getByRole('link', { name: 'Settings', exact: true }).click()
  await page.getByRole('link', { name: 'Streaming', exact: true }).click()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(page.getByLabel('Spinner motion')).toHaveCount(0)
  await page.getByLabel('Video size').selectOption('cover')
  await page.getByLabel('Maximum video bitrate').selectOption('20000')
  await page.reload()
  await expect(page.getByLabel('Video size')).toHaveValue('cover')
  await expect(page.getByLabel('Maximum video bitrate')).toHaveValue('20000')
  await page.getByRole('link', { name: 'Input', exact: true }).click()
  const pad = page.locator('.pad-preview .pad-0')
  const before = (await pad.boundingBox())!
  await page.getByLabel('Height from bottom').fill('20')
  expect((await pad.boundingBox())!.y).toBeLessThan(before.y)
  await page.getByLabel('Side inset').fill('6')
  expect((await pad.boundingBox())!.x).toBeGreaterThan(before.x)
  await page.getByLabel('Control size').fill('85')
  await page.getByLabel('Control opacity').fill('60')
  await page.getByLabel('Swap left and right control groups').check()
  await page.getByLabel('Swap A and B buttons').check()
  await page.reload()
  await expect(page.getByLabel('Control size')).toHaveValue('85')
  await expect(page.getByLabel('Control opacity')).toHaveValue('60')
  await expect(page.getByLabel('Swap left and right control groups')).toBeChecked()
  await expect(page.getByLabel('Swap A and B buttons')).toBeChecked()
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [
      { connected: true, index: 0, id: 'Test Xbox Controller', mapping: 'standard', axes: [0,0,0,0], buttons: Array(17) },
    ] })
    dispatchEvent(new Event('gamepadconnected'))
  })
  await expect(page.getByText('Test Xbox Controller')).toBeVisible()
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [] })
    dispatchEvent(new Event('gamepaddisconnected'))
  })
  await expect(page.getByText('Connect a controller and press a button', { exact: false })).toBeVisible()
  await page.goBack()
  await expect(page.getByLabel('Video size')).toHaveValue('cover')
})

test('failed stream creation can be retried and disconnected', async ({ page }) => {
  await signedIn(page)
  let attempts = 0
  await page.route('**/api/stream/session', route => {
    attempts++
    return route.fulfill({ status: 503, json: { error: 'Xbox is unavailable.' } })
  })
  await page.goto('/')
  await page.getByRole('link', { name: 'Start stream' }).click()
  await expect(page.getByRole('alert')).toContainText('Xbox is unavailable.')
  await page.getByRole('button', { name: 'Reconnect' }).click()
  await expect.poll(() => attempts).toBe(2)
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'My Consoles' })).toBeVisible()
})

test('switches from Remote Play to a searched cloud title after releasing the home session', async ({ page }) => {
  await signedIn(page)
  let ended = false
  await page.route('**/api/stream/session', route => route.fulfill({ json: { sessionId: 'home' } }))
  await page.route('**/api/stream/session/home/state', route => route.fulfill({ json: { state: 'Provisioning' } }))
  await page.route('**/api/stream/session/home', route => {
    ended = route.request().method() === 'DELETE'
    return route.fulfill({ json: { ended } })
  })
  await page.route('**/api/cloud/catalog', route => route.fulfill({ json: { recent: ['one'],
    games: [{ id: 'one', name: 'Game One' }, { id: 'two', name: 'Game Two', banner: '/images/console.png', inputs: ['kbm'], categories: ['Racing'], publisher: 'Élan' }] } }))
  await page.route('**/api/cloud/session', route => {
    expect(ended).toBe(true)
    expect(route.request().postDataJSON().titleId).toBe('two')
    return route.fulfill({ status: 403, json: { error: 'Xbox denied title entitlement.' } })
  })
  await page.goto('/home')
  const consoleBounds = await page.locator('.console-card').boundingBox()
  await page.getByRole('link', { name: 'Start stream' }).click()
  await expect(page.getByText('Remote Play · Living room')).toBeVisible()
  await page.goBack()
  await page.getByRole('link', { name: 'Cloud Gaming' }).click()
  await page.getByRole('button', { name: 'Recently played' }).click()
  await expect(page.getByText('Game Two', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Recently played' }).click()
  await page.getByLabel('Sort by').selectOption('za')
  await expect(page.locator('.cloud-game h2').first()).toHaveText('Game Two')
  await page.getByLabel('Input', { exact: true }).selectOption('kbm')
  await page.getByLabel('Genre').selectOption('Racing')
  await page.getByLabel('Search games').fill('elan two')
  await expect(page.locator('.cloud-game')).toHaveCount(1)
  const card = page.locator('.cloud-game')
  await expect(card.locator('.game-overlay')).toHaveCSS('opacity', '0')
  const gameBounds = await card.boundingBox()
  expect(gameBounds?.width).toBe(consoleBounds?.width)
  expect(gameBounds?.height).toBe(consoleBounds?.height)
  await card.hover()
  await expect(card.locator('.game-overlay')).toHaveCSS('opacity', '1')
  await expect(card.locator('img')).toHaveCSS('filter', 'grayscale(1)')
  await card.getByRole('button', { name: 'Game details for Game Two' }).click({position:{x:12,y:12}})
  const modal = page.getByRole('dialog', { name: 'Game Two' })
  await expect(modal.getByText('Racing')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(modal).toHaveCount(0)
  await expect(card.getByRole('button', { name: 'Game details for Game Two' })).toBeFocused()
  await page.getByRole('link', { name: 'Play Game Two' }).click()
  await expect(page.getByText('Cloud Gaming · Game Two')).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('entitlement')
})

test.describe('touch library', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 320, height: 700 } })

  test('shows game names and lets players tap Play directly on artwork cards', async ({ page }) => {
    await signedIn(page)
    await page.route('**/api/cloud/catalog', route => route.fulfill({ json: {
      recent: [], games: [{ id: 'race', name: 'Race Day', banner: '/images/console.png' }],
    } }))
    await page.route('**/api/cloud/session', route => route.fulfill({ status: 503, json: { error: 'Game unavailable.' } }))
    await page.goto('/cloud')
    await expect(page.locator('.game-banner')).toHaveClass(/loaded/)
    await expect(page.locator('.game-overlay')).toHaveCSS('opacity', '1')
    await page.getByRole('link', { name: 'Play Race Day' }).tap()
    await expect(page).toHaveURL(/\/stream\/cloud\/race$/)
    await expect(page.getByRole('alert')).toContainText('Game unavailable.')
  })
})

test('account settings sign out through the Worker', async ({ page }) => {
  await signedIn(page)
  await page.route('**/api/auth/logout', route => {
    expect(route.request().method()).toBe('POST')
    return route.fulfill({ status: 204 })
  })
  await page.goto('/settings/home')
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByRole('button', { name: 'Sign in with Microsoft' })).toBeVisible()
})


test('cloud library animates while loading, batches cards and searches the entire catalog', async ({ page }) => {
  await signedIn(page)
  let release!: () => void
  const ready = new Promise<void>(resolve => { release = resolve })
  const games = Array.from({ length: 240 }, (_, n) => ({ id: String(n), name: 'Game ' + n }))
  await page.route('**/api/cloud/catalog', async route => {
    await ready
    await route.fulfill({ json: { games, recent: [] } })
  })
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/cloud')
  const ring = page.locator('.ring')
  await expect(page.getByText('Loading your game catalog…')).toBeVisible()
  const transform = await ring.evaluate(el => getComputedStyle(el).transform)
  await expect.poll(() => ring.evaluate(el => getComputedStyle(el).transform)).not.toBe(transform)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(ring).toHaveCSS('animation-name', 'spin')
  release()
  await expect(page.locator('.cloud-game')).toHaveCount(24)
  await expect(page.getByRole('button', { name: 'Refresh' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Show more games' }).scrollIntoViewIfNeeded()
  await expect(page.locator('.cloud-game')).toHaveCount(48)
  await page.getByLabel('Search games').fill('game 239')
  await expect(page.locator('.cloud-game')).toHaveCount(1)
  await expect(page.getByRole('link', { name: 'Play Game 239' })).toBeVisible()
})

test('appearance and start page survive reload', async ({ page }) => {
  await signedIn(page)
  await page.route('**/api/cloud/catalog', route => route.fulfill({ json: { games: [], recent: [] } }))
  await page.goto('/settings/appearance')
  await page.getByLabel('Aurora').check()
  await page.getByLabel('Accent color').selectOption('violet')
  await page.getByRole('link', {name:'General'}).click()
  await page.getByLabel('Start page').selectOption('cloud')
  await page.getByLabel('Default game order').selectOption('za')
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('data-accent','violet')
  await expect(page.getByLabel('Sort by')).toHaveValue('za')
  await expect(page.locator('.shell')).toHaveAttribute('data-background','aurora')
  await expect(page.getByRole('heading', {name:'Cloud Gaming'})).toBeVisible()
  await page.getByRole('link', {name:'My Consoles'}).click()
  await expect(page.getByRole('heading', {name:'My Consoles'})).toBeVisible()
})
