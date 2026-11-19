import { readFile } from 'node:fs/promises';
import { Miniflare } from 'miniflare';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { getXhomeCredentials, handleAuth, requireSession, type AuthEnv } from '../apps/worker/src/auth';
import { createSession, sessionCookie } from '../apps/worker/src/auth/session';
import { digest, randomSecret, seal, unseal } from '../apps/worker/src/auth/security';
import { xboxHome } from '../apps/worker/src/auth/provider';

const origin = 'https://xstream.example';
let runtime: Miniflare;
let env: AuthEnv;
beforeAll(async () => {
  runtime = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response() } }', d1Databases: ['DB'] });
  const DB = await runtime.getD1Database('DB');
  const migration = await readFile(new URL('../apps/worker/migrations/0001_auth.sql', import.meta.url), 'utf8');
  await DB.batch(migration.split(';').map(sql => sql.trim()).filter(Boolean).map(sql => DB.prepare(sql)));
  const pairing = await readFile(new URL('../apps/worker/migrations/0004_device_login.sql', import.meta.url), 'utf8');
  await DB.batch(pairing.split(';').map(sql => sql.trim()).filter(Boolean).map(sql => DB.prepare(sql)));
  env = { DB, PAIRING_STARTS: { limit: async () => ({ success: true }) }, APP_ORIGIN: origin, MICROSOFT_CLIENT_ID: 'fixture-id',
    TOKEN_ENCRYPTION_KEY: btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))) } as AuthEnv;
});
afterAll(async () => { await runtime.dispose(); });
afterEach(() => { vi.unstubAllGlobals(); });
async function session(expires: number) {
  const raw = await createSession(env, await digest('user-claim'), { access: 'original-access', refresh: 'original-refresh', expires }, null);
  const request = new Request(origin + '/api/consoles', { headers: { Cookie: sessionCookie + '=' + raw } });
  return { raw, request, session: await requireSession(request, env) };
}
describe('Application sessions', () => {
  it.each(['authorization_declined', 'expired_token', 'cancel', 'timeout'])('ends pairing on %s', async ending => {
    const exchange = vi.fn().mockResolvedValueOnce(Response.json({
      user_code: 'TEST', device_code: 'fixture', verification_uri: 'https://www.microsoft.com/link', expires_in: 900, interval: 5
    }));
    vi.stubGlobal('fetch', exchange);
    const start = await handleAuth(new Request(origin + '/api/auth/device/start', { method: 'POST', headers: { Origin: origin } }), env);
    const { id } = await start!.json() as { id: string };
    const headers = { Origin: origin, Cookie: start!.headers.get('set-cookie')!.split(';')[0], 'X-Pairing-Id': id };
    const action = (name: string) => handleAuth(new Request(origin + '/api/auth/device/' + name, { method: 'POST', headers }), env);
    const ready = () => env.DB.prepare('UPDATE device_logins SET next_poll=0 WHERE id=?').bind(id).run();
    for (const [code, seconds] of [['authorization_pending', 5], ['slow_down', 10]] as const) {
      await ready();
      exchange.mockResolvedValueOnce(Response.json({ error: code }, { status: 400 }));
      expect(await (await action('poll'))!.json()).toEqual({ pending: true, interval: seconds });
    }
    if (ending === 'timeout') await env.DB.prepare('UPDATE device_logins SET expires_at=0 WHERE id=?').bind(id).run();
    else if (ending === 'cancel') expect((await action('cancel'))!.status).toBe(204);
    else {
      await ready();
      exchange.mockResolvedValueOnce(Response.json({ error: ending }, { status: 400 }));
      await expect(action('poll')).rejects.toMatchObject({ code: ending === 'authorization_declined' ? 'declined' : 'expired' });
    }
    const calls = exchange.mock.calls.length;
    await expect(action('poll')).rejects.toMatchObject({ status: 410 });
    expect(exchange.mock.calls.length).toBe(calls);
  });
  it('stops excess pairing requests before calling the identity provider', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const request = new Request(origin + '/api/auth/device/start', { method: 'POST', headers: { Origin: origin } });
    const blocked = await handleAuth(request, { ...env, PAIRING_STARTS: { limit: async () => ({ success: false }) } });
    expect(blocked?.status).toBe(429);
    expect(blocked?.headers.get('Retry-After')).toBe('60');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('encrypts grants and rejects ciphertext copied to another row', async () => {
    const envelope = await seal(env, 'session:a', 'fixture-access');
    expect(envelope).not.toContain('fixture-access');
    await expect(unseal(env, 'session:a', envelope)).resolves.toBe('fixture-access');
    await expect(unseal(env, 'session:b', envelope)).rejects.toMatchObject({ status: 401 });
  });
  it('enforces expiry and same-origin logout', async () => {
    const started = Date.now();
    const current = await session(Date.now() + 3600_000);
    const week = 7 * 24 * 3600_000;
    expect(current.session.expiresAt).toBeGreaterThanOrEqual(started + week);
    expect(current.session.expiresAt).toBeLessThanOrEqual(Date.now() + week);
    const foreign = new Request(origin + '/api/auth/logout', { method: 'POST', headers: { Cookie: sessionCookie + '=' + current.raw, Origin: 'https://foreign.example' } });
    await expect(handleAuth(foreign, env)).rejects.toMatchObject({ status: 403 });
    expect(await requireSession(current.request, env)).toEqual(current.session);
    await env.DB.prepare('UPDATE auth_sessions SET expires_at=0 WHERE id=?').bind(current.session.id).run();
    await expect(requireSession(current.request, env)).rejects.toMatchObject({ status: 401 });
  });
});
describe('Xbox credentials', () => {
  it('uses the operator registration for the console-specific transfer grant and rotates its refresh token', async () => {
    const current = await session(Date.now() + 3600_000);
    const exchange = vi.fn()
      .mockResolvedValueOnce(Response.json({ Token: 'user', DisplayClaims: { xui: [{ uhs: 'user-claim' }] } }))
      .mockResolvedValueOnce(Response.json({ Token: 'gssv' }))
      .mockResolvedValueOnce(Response.json({ gsToken: 'home', durationInSeconds: 3600,
        offeringSettings: { regions: [{ isDefault: true, baseUri: 'https://unit.gssv-play-prod.xboxlive.com' }] } }))
      .mockResolvedValueOnce(Response.json({ access_token: 'transfer', refresh_token: 'transfer-refresh' }))
      .mockResolvedValueOnce(Response.json({ error: 'invalid_scope' }, { status: 400 }));
    vi.stubGlobal('fetch', exchange);
    const access = await getXhomeCredentials(current.session, env);
    expect(access.owner).toBe(current.session.id);
    expect(await access.getConnectToken()).toBe('transfer');
    expect(exchange.mock.calls[3][0]).toBe('https://login.live.com/oauth20_token.srf');
    const form = exchange.mock.calls[3][1].body as URLSearchParams;
    expect(form.get('client_id')).toBe(env.MICROSOFT_CLIENT_ID);
    expect(form.get('scope')).toMatch(/PURPOSE_XBOX_CLOUD_CONSOLE_TRANSFER_TOKEN$/);
    const cached = await getXhomeCredentials(current.session, env);
    await expect(cached.getConnectToken()).rejects.toMatchObject({ status: 403, code: 'console_transfer_denied' });
    expect((exchange.mock.calls[4][1].body as URLSearchParams).get('refresh_token')).toBe('transfer-refresh');
  });
  it('retains rotated Microsoft grants when the downstream Xbox exchange fails', async () => {
    const current = await session(0);
    const exchange = vi.fn().mockResolvedValueOnce(Response.json({
      access_token: 'new-access', refresh_token: 'rotated-refresh', token_type: 'Bearer', expires_in: 3600
    })).mockResolvedValueOnce(Response.json({ internal: 'private-provider-diagnostic' }, { status: 403 }));
    vi.stubGlobal('fetch', exchange);
    await expect(getXhomeCredentials(current.session, env)).rejects.toMatchObject({ code: 'xbox_user_denied' });
    expect((exchange.mock.calls[0][1].body as URLSearchParams).get('refresh_token')).toBe('original-refresh');
    const row = await env.DB.prepare('SELECT credentials,lock_id FROM auth_sessions WHERE id=?')
      .bind(current.session.id).first<{ credentials: string; lock_id: string | null }>();
    expect(row!.lock_id).toBeNull();
    expect(row!.credentials).not.toContain('rotated-refresh');
    const credentials = JSON.parse(await unseal(env, 'session:' + current.session.id, row!.credentials));
    expect(credentials.microsoft.refresh).toBe('rotated-refresh');
  });
  it('does not refresh concurrently or use revoked grants again', async () => {
    const current = await session(0);
    await env.DB.prepare('UPDATE auth_sessions SET lock_id=?,lock_until=? WHERE id=?')
      .bind(randomSecret(), Date.now() + 30_000, current.session.id).run();
    const exchange = vi.fn().mockResolvedValue(Response.json({ error: 'invalid_grant' }, { status: 400 }));
    vi.stubGlobal('fetch', exchange);
    await expect(getXhomeCredentials(current.session, env)).rejects.toMatchObject({ status: 409 });
    expect(exchange).not.toHaveBeenCalled();
    await env.DB.prepare('UPDATE auth_sessions SET lock_until=0 WHERE id=?').bind(current.session.id).run();
    await expect(getXhomeCredentials(current.session, env)).rejects.toMatchObject({ status: 401 });
    await expect(requireSession(current.request, env)).rejects.toMatchObject({ status: 401 });
  });
  it('uses the authorized free-to-play offering when the subscriber offering is denied', async () => {
    const exchange = vi.fn().mockResolvedValueOnce(Response.json({ Token: 'fixture' }))
      .mockResolvedValueOnce(new Response(null, { status: 403 })).mockResolvedValueOnce(Response.json({
        gsToken: 'free', durationInSeconds: 3600,
        offeringSettings: { regions: [{ isDefault: true, baseUri: 'https://east.core.gssv-play-prod.xboxlive.com' }] }
      }));
    vi.stubGlobal('fetch', exchange);
    expect((await xboxHome('user-ticket', 'xcloud')).gsToken).toBe('free');
    const [url, options] = exchange.mock.calls[2];
    expect(url).toBe('https://xgpuwebf2p.gssv-play-prod.xboxlive.com/v2/login/user');
    expect(JSON.parse(options.body).offeringId).toBe('xgpuwebf2p');
  });
  it('rejects a region outside the Xbox streaming service before forwarding the bearer', async () => {
    const exchange = vi.fn().mockResolvedValueOnce(Response.json({ Token: 'xsts' })).mockResolvedValueOnce(Response.json({
      gsToken: 'home', durationInSeconds: 3600,
      offeringSettings: { regions: [{ isDefault: true, baseUri: 'https://other.example/' }] }
    }));
    vi.stubGlobal('fetch', exchange);
    await expect(xboxHome('user-ticket')).rejects.toMatchObject({ code: 'provider_response' });
    expect(exchange).toHaveBeenCalledTimes(2);
  });
});

it('uses the upstream public client ID for pairing when no override is configured', async () => {
  const exchange = vi.fn().mockResolvedValue(Response.json({
    user_code: 'TEST', device_code: 'fixture', verification_uri: 'https://microsoft.com/link', expires_in: 900, interval: 5
  }));
  vi.stubGlobal('fetch', exchange);
  const result = await handleAuth(new Request(origin + '/api/auth/device/start', { method: 'POST', headers: { Origin: origin } }), { ...env, MICROSOFT_CLIENT_ID: '' });
  expect(result?.status).toBe(200);
  const init = exchange.mock.calls[0][1] as RequestInit;
  expect((init.body as URLSearchParams).get('client_id')).toBe('1f907974-e22b-4810-a9de-d9647380c97e');
  expect((init.body as URLSearchParams).get('scope')).toBe('xboxlive.signin openid profile offline_access');
});
