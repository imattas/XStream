import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { build } from 'esbuild'
import { readFile, readdir } from 'node:fs/promises'
import { Miniflare, Request as MockRequest, Response as MockResponse } from 'miniflare'

const origin = 'https://xbox.example.test'
const regionalHost = 'uks.core.gssv-play-prodxhome.xboxlive.com'
let runtime: Miniflare
let cloudEnabled = false
let xboxTicketCount = 0
const cloudHost = 'uks.core.gssv-play-prod.xboxlive.com'

beforeAll(async () => {
  const [api, pages] = await Promise.all([
    build({ entryPoints: ['apps/worker/src/index.ts'], bundle: true, format: 'esm', write: false }),
    build({ stdin: { contents: `import { onRequest } from './functions/api/[[path]].ts';
      export default { fetch(request, env) { return onRequest({ request, env }) } }`, resolveDir: process.cwd() },
      bundle: true, format: 'esm', write: false }),
  ])
  runtime = new Miniflare({
    workers: [
      { name: 'pages', modules: true, script: pages.outputFiles[0].text, serviceBindings: { API: 'api' } },
      { name: 'api', modules: true, script: api.outputFiles[0].text, d1Databases: ['DB'], ratelimits: { PAIRING_STARTS: { simple: { limit: 12, period: 60 } } },
        compatibilityDate: '2026-06-01',
        bindings: { APP_ORIGIN: origin, MICROSOFT_CLIENT_ID: 'fixture-client',
          TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 42).toString('base64') },
        outboundService: async (request: MockRequest) => {
          const url = new URL(request.url)
          if (url.pathname.endsWith('/devicecode')) return MockResponse.json({
            device_code: 'private-fixture', user_code: 'TEST', verification_uri: 'https://microsoft.com/link', expires_in: 900, interval: 5
          })
          if (url.hostname === 'login.microsoftonline.com' && url.pathname.endsWith('/token')) {
            const form = new URLSearchParams(await request.text())
            if (form.get('device_code') === 'private-fixture' && !form.has('client_secret')) return MockResponse.json({
              access_token: 'fixture-access', refresh_token: 'fixture-refresh', token_type: 'Bearer', expires_in: 3600 })
            return new MockResponse(null, { status: 400 })
          }
          if (url.hostname === 'user.auth.xboxlive.com') {
            return MockResponse.json({ Token: 'fixture-user', DisplayClaims: { xui: [{ uhs: 'ticket-' + ++xboxTicketCount }] } })
          }
          if (url.hostname === 'xsts.auth.xboxlive.com') {
            const { RelyingParty } = await request.json() as { RelyingParty: string }
            return RelyingParty === 'http://xboxlive.com'
              ? MockResponse.json({ Token: 'fixture-profile', DisplayClaims: { xui: [{ uhs: 'fixture-hash' }] } })
              : MockResponse.json({ Token: 'fixture-xsts' })
          }
          if (url.hostname === 'profile.xboxlive.com' && request.headers.get('Authorization') === 'XBL3.0 x=fixture-hash;fixture-profile')
            return MockResponse.json({ profileUsers: [{ settings: [{ id: 'Gamertag', value: 'FixtureFox' },
              { id: 'Gamerscore', value: '10800' }, { id: 'TenureLevel', value: '3' }, { id: 'GameDisplayPicRaw', value: 'https://images-eds.xboxlive.com/fixture.png' }] }] })
          if (url.hostname === 'login.live.com') {
            const body = new URLSearchParams(await request.text())
            if (body.get('refresh_token') !== 'fixture-refresh') return new MockResponse(null, { status: 403 })
            return MockResponse.json({ access_token: 'fixture-transfer' })
          }
          if (url.hostname === 'xgpuweb.gssv-play-prod.xboxlive.com' && url.pathname === '/v2/login/user') {
            const grant = await request.json() as { offeringId: string; token: string }
            if (!cloudEnabled || grant.offeringId !== 'xgpuweb' || grant.token !== 'fixture-xsts') return new MockResponse(null, { status: 403 })
            return MockResponse.json({ gsToken: 'fixture-cloud', durationInSeconds: 3600,
              offeringSettings: { regions: [{ isDefault: true, baseUri: 'https://' + cloudHost }] } })
          }
          if (url.hostname === 'catalog.gamepass.com') return MockResponse.json({ Products: {
            product: { ProductTitle: 'Cloud Game', Image_Tile: { URL: '//store-images.s-microsoft.com/image' },
              Image_Hero: { URL: '//store-images.s-microsoft.com/banner' } }
          } })
          if (url.hostname === cloudHost && request.headers.get('Authorization') === 'Bearer fixture-cloud') {
            if (url.pathname === '/v1/waittime/Game.Name%20(Edition)') return MockResponse.json({ estimatedTotalWaitTimeInSeconds: 125 })
            if (url.pathname === '/v2/titles') return MockResponse.json({ results: [
              { titleId: 'Game.Name (Edition)', details: { productId: 'product', hasEntitlement: true, supportedInputTypes: ['MKB','NativeTouch'] } },
              null, { details: {} }, { titleId: 'locked', details: { hasEntitlement: false } }, { titleId: 'unknown', details: {} }
            ] })
            if (url.pathname.startsWith('/v2/titles/mru')) return MockResponse.json({ results: [{ titleId: 'Game.Name (Edition)', details: { productId: 'product' } }] })
            if (url.pathname === '/v5/sessions/cloud/play') {
              const body = await request.json() as {titleId: string; serverId: string}
              if (body.titleId === 'Game.Name (Edition)' && body.serverId === '') return MockResponse.json({ sessionPath: 'v5/sessions/cloud/cloud-id' })
            }
            if (url.pathname === '/v5/sessions/cloud/cloud-id' && request.method === 'DELETE') return new MockResponse(null, { status: 204 })
          }
          if (url.hostname === 'xhome.gssv-play-prod.xboxlive.com') {
            return MockResponse.json({ gsToken: 'fixture-stream', durationInSeconds: 3600,
              offeringSettings: { regions: [{ isDefault: true, baseUri: 'https://' + regionalHost }] } })
          }
          if (url.hostname === regionalHost && url.pathname === '/v6/servers/home' &&
              request.headers.get('Authorization') === 'Bearer fixture-stream') {
            return MockResponse.json({ results: [{ serverId: 'console-a', deviceName: 'Fixture Xbox', powerState: 'On', consoleType: 'XboxSeriesX' }] })
          }
          if (url.hostname === regionalHost && request.headers.get('Authorization') === 'Bearer fixture-stream') {
            if (url.pathname === '/v5/sessions/home/play' && request.method === 'POST') {
              return MockResponse.json({ sessionId: 'upstream-id', sessionPath: 'v5/sessions/home/upstream-id' })
            }
            if (url.pathname.endsWith('/upstream-id/connect') && request.method === 'POST') {
              const { userToken } = await request.json() as {userToken:string}
              return new MockResponse(null, { status: userToken === 'fixture-transfer' ? 204 : 403 })
            }
            if (url.pathname.endsWith('/upstream-id') && request.method === 'DELETE') return new MockResponse(null, { status: 204 })
          }
          return new MockResponse(null, { status: 404 })
        },
      },
    ],
  })
  const db = await runtime.getD1Database('DB', 'api')
  for (const migration of (await readdir('apps/worker/migrations')).sort()) {
    const sql = await readFile('apps/worker/migrations/' + migration, 'utf8')
    for (const statement of sql.split(';').filter(part => part.trim())) await db.prepare(statement).run()
  }
})
afterAll(async () => { await runtime?.dispose() })

describe('Pages to API service binding in workerd', () => {
  it('binds a private pairing code to its browser and consumes approval once', async () => {
    const start = await runtime.dispatchFetch(origin + '/api/auth/device/start', { method: 'POST', headers: { Origin: origin } })
    const pairing = await start.json() as { id: string }
    expect(pairing).toMatchObject({ code: 'TEST', uri: 'https://microsoft.com/link', interval: 5, expiresAt: expect.any(Number) })
    const cookie = start.headers.get('set-cookie')!.split(';')[0]
    const poll = (Cookie: string) => runtime.dispatchFetch(origin + '/api/auth/device/poll', { method: 'POST', headers: { Origin: origin, Cookie, 'X-Pairing-Id': pairing.id } })
    expect((await poll('')).status).toBe(410)
    expect(await (await poll(cookie)).json()).toMatchObject({ pending: true })
    const db = await runtime.getD1Database('DB', 'api')
    expect((await db.prepare('SELECT device_code FROM device_logins').first())?.device_code).not.toBe('private-fixture')
    await db.prepare('UPDATE device_logins SET next_poll=0').run()
    const success = await poll(cookie)
    expect(await success.json()).toEqual({ authenticated: true })
    expect(success.headers.getSetCookie().some(value => value.startsWith('__Host-xstream=') && value.includes('HttpOnly'))).toBe(true)
    expect((await poll(cookie)).status).toBe(410)
  })
  it('serves health, protects private routes and rejects cross-origin writes', async () => {
    const health = await runtime.dispatchFetch(origin + '/api/health')
    expect(await health.json()).toEqual({ status: 'ok' })
    for (const path of ['/api/auth/login', '/api/auth/callback']) {
      expect((await runtime.dispatchFetch(origin + path, { redirect: 'manual' })).status).toBe(404)
    }
    expect(health.headers.get('Cache-Control')).toContain('no-store')
    expect((await runtime.dispatchFetch(origin + '/api/consoles')).status).toBe(401)
    expect((await runtime.dispatchFetch(origin + '/api/stream/session', { method: 'POST', headers: { Origin: 'https://elsewhere.test' } })).status).toBe(403)
  })

  it('pairs a browser, retains tokens server-side, lists the console and revokes the cookie on logout', async () => {
    const startLink = await runtime.dispatchFetch(origin + '/api/auth/device/start', { method: 'POST', headers: { Origin: origin } })
    const pairing = await startLink.json() as { id: string }
    const browser = startLink.headers.get('set-cookie')!.split(';')[0]
    const database = await runtime.getD1Database('DB', 'api')
    await database.prepare('UPDATE device_logins SET next_poll=0').run()
    const paired = await runtime.dispatchFetch(origin + '/api/auth/device/poll', { method: 'POST', headers: { Origin: origin, Cookie: browser, 'X-Pairing-Id': pairing.id } })
    expect(paired.status).toBe(200)
    const sessionHeader = paired.headers.getSetCookie().find(value => value.startsWith('__Host-xstream='))
    expect(sessionHeader).toContain('HttpOnly')
    const cookie = sessionHeader!.split(';')[0]
    const profile = await runtime.dispatchFetch(origin + '/api/auth/session', { headers: { Cookie: cookie } })
    expect(await profile.json()).toEqual({ authenticated: true, serverTime: expect.any(Number), expiresAt: expect.any(Number), user: { name: 'FixtureFox', gamerscore: 10800, tenure: 3, picture: 'https://images-eds.xboxlive.com/fixture.png' } })
    const consoles = await runtime.dispatchFetch(origin + '/api/consoles', { headers: { Cookie: cookie } })
    expect(consoles.status).toBe(200)
    const publicData = await consoles.text()
    expect(publicData).toContain('Fixture Xbox')
    expect(publicData).not.toContain('fixture-stream')
    const db = await runtime.getD1Database('DB', 'api')
    const row = await db.prepare('SELECT credentials FROM auth_sessions').first<{credentials:string}>()
    expect(row?.credentials).toBeTruthy()
    expect(row!.credentials).not.toContain('fixture-refresh')
    const headers = { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' }
    const created = await runtime.dispatchFetch(origin + '/api/stream/session', {
      method: 'POST', headers, body: JSON.stringify({ serverId: 'console-a' }),
    })
    expect(created.status).toBe(201)
    const { sessionId } = await created.json() as {sessionId:string}
    expect(sessionId).not.toBe('upstream-id')
    const sessionUrl = origin + '/api/stream/session/' + sessionId
    const connect = await runtime.dispatchFetch(sessionUrl + '/connect', { method: 'POST', headers })
    expect(await connect.json()).toEqual({ accepted: true })
    expect((await runtime.dispatchFetch(sessionUrl, { method: 'DELETE', headers })).status).toBe(200)
    expect((await runtime.dispatchFetch(sessionUrl + '/state', { headers })).status).toBe(404)
    const cloudCatalog = () => runtime.dispatchFetch(origin + '/api/cloud/catalog', { headers })
    const denied = await cloudCatalog()
    expect(denied.status).toBe(403)
    expect(await denied.json()).toMatchObject({ code: 'xcloud_offering_denied' })
    cloudEnabled = true
    expect(await (await cloudCatalog()).json()).toMatchObject({
      games: [{ id: 'Game.Name (Edition)', name: 'Cloud Game', inputs: ['controller','overlay','touch','kbm'], cover: 'https://store-images.s-microsoft.com/image', banner: 'https://store-images.s-microsoft.com/banner' }], recent: ['Game.Name (Edition)']
    })
    const start = (titleId: string) => runtime.dispatchFetch(origin + '/api/cloud/session', {
      method: 'POST', headers, body: JSON.stringify({ titleId })
    })
    expect((await start('unlisted')).status).toBe(404)
    expect((await start('locked')).status).toBe(403)
    expect((await start('unknown')).status).toBe(403)
    const waittime = await runtime.dispatchFetch(origin + '/api/cloud/waittime?titleId=Game.Name%20(Edition)', { headers })
    expect(await waittime.json()).toEqual({ seconds: 125 })
    const cloudStream = await start('Game.Name (Edition)')
    expect(cloudStream.status).toBe(201)
    expect(await cloudStream.clone().json()).toMatchObject({ inputs: ['controller','overlay','touch','kbm'] })
    const cloudId = (await cloudStream.json() as {sessionId: string}).sessionId
    expect((await runtime.dispatchFetch(origin + '/api/stream/session/' + cloudId, { method: 'DELETE', headers })).status).toBe(404)
    expect((await runtime.dispatchFetch(origin + '/api/stream/session', { method: 'POST', headers,
      body: JSON.stringify({ serverId: 'console-a' }) })).status).toBe(409)
    expect((await runtime.dispatchFetch(origin + '/api/cloud/session/' + cloudId, { method: 'DELETE', headers })).status).toBe(200)
    const logout = await runtime.dispatchFetch(origin + '/api/auth/logout', { method: 'POST', headers: { Cookie: cookie, Origin: origin } })
    expect(logout.status).toBe(204)
    expect((await runtime.dispatchFetch(origin + '/api/consoles', { headers: { Cookie: cookie } })).status).toBe(401)
  })
})





