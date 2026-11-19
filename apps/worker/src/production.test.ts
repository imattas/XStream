import { afterEach, expect, it, vi } from 'vitest'
import worker from './production'

const origin = 'https://example.test'
const env = {
  APP_ORIGIN: origin, SITE_PIN: '123456', TOKEN_ENCRYPTION_KEY: btoa('a'.repeat(32)),
  PIN_ATTEMPTS: { limit: vi.fn(async () => ({ success: true })) },
  ASSETS: { fetch: vi.fn(async () => new Response('asset')) },
} as unknown as Parameters<typeof worker.fetch>[1]

function enter(pin: string, source = origin) {
  return worker.fetch(new Request(origin + '/_access/unlock', { method: 'POST', headers: { Origin: source }, body: new URLSearchParams({ pin }) }), env)
}

afterEach(() => vi.useRealTimers())

it('requires a verified grant for every asset, deep link and API', async () => {
  for (const path of ['/', '/cloud', '/assets/test.js', '/api/health']) {
    const result = await worker.fetch(new Request(origin + path, { headers: { Cookie: '__Host-xstream-access=fabricated' } }), env)
    expect(result.status).toBe(401)
    expect(result.headers.get('Cache-Control')).toContain('no-store')
  }
  expect(env.ASSETS.fetch).not.toHaveBeenCalled()
  expect((await enter('000000')).headers.has('Set-Cookie')).toBe(false)
  expect((await enter(env.SITE_PIN, 'https://elsewhere.test')).status).toBe(403)
})

it('accepts a valid PIN and enforces expiry even when the cookie is replayed', async () => {
  vi.useFakeTimers()
  const issued = Date.now()
  const accepted = await enter(env.SITE_PIN)
  expect(accepted.status).toBe(303)
  const cookie = accepted.headers.get('Set-Cookie')!.split(';')[0]
  const health = () => worker.fetch(new Request(origin + '/api/health', { headers: { Cookie: cookie } }), env)
  vi.setSystemTime(issued + 7 * 86400000 - 1)
  expect((await health()).status).toBe(200)
  vi.setSystemTime(issued + 7 * 86400000)
  expect((await health()).status).toBe(401)
})
