import { beginDeviceGrant, microsoftGrant, xboxStreamingTicket, xboxUser } from './provider';
import { AuthError, digest, randomSecret, seal, unseal, type AuthEnv } from './security';
import { cookie, createSession, sessionCookie, sessionSeconds, setCookie } from './session';

const pairingCookie = '__Host-xstream-pair';
const expired = () => new AuthError(410, 'expired', 'Pairing code expired. Request a new code.');
const pending = (interval: number) => Response.json({ pending: true, interval });

export async function deviceLogin(request: Request, env: AuthEnv, action: string) {
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } });
  if (request.headers.get('Origin') !== env.APP_ORIGIN) throw new AuthError(403, 'csrf', 'Start pairing from XStream.');
  const previous = cookie(request, pairingCookie);
  if (action !== 'start' && (!previous || request.headers.get('X-Pairing-Id') !== await digest(previous))) throw expired();
  if (action === 'cancel') {
    if (previous) await env.DB.prepare('DELETE FROM device_logins WHERE id=?').bind(await digest(previous)).run();
    return new Response(null, { status: 204, headers: { 'Set-Cookie': setCookie(pairingCookie, '', 0) } });
  }
  if (action === 'start') {
    if (!env.MICROSOFT_CLIENT_ID) throw new AuthError(503, 'configuration', 'The host needs to configure a Microsoft public client ID for pairing.');
    const clientKey = request.headers.get('CF-Connecting-IP') || 'unknown';
    const admission = await env.PAIRING_STARTS.limit({ key: clientKey });
    if (!admission.success) return Response.json({ error: 'Too many pairing attempts. Try again in a minute.' },
      { status: 429, headers: { 'Retry-After': '60' } });
    const data = await beginDeviceGrant(env);
    const { user_code: code, device_code: secret, verification_uri: uri, expires_in: lifetime, interval = 5 } = data;
    if (typeof code !== 'string' || !code || typeof secret !== 'string' || !secret ||
        typeof uri !== 'string' || !/^https:\/\/(?:www\.)?microsoft\.com\/(?:link|devicelogin)\/?$/i.test(uri) ||
        typeof lifetime !== 'number' || !Number.isSafeInteger(lifetime) || lifetime <= 0 ||
        typeof interval !== 'number' || !Number.isSafeInteger(interval) || interval < 1) {
      throw new AuthError(502, 'device_response', 'Microsoft returned an incomplete pairing response.');
    }
    const browser = randomSecret();
    const id = await digest(browser);
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare('DELETE FROM device_logins WHERE expires_at<=? OR id=?').bind(now, previous ? await digest(previous) : ''),
      env.DB.prepare('INSERT INTO device_logins VALUES(?,?,?,?,?)').bind(id, await seal(env, 'pair:' + id, secret),
        now + lifetime * 1000, interval, now + interval * 1000)
    ]);
    return Response.json({ id, code, uri, interval, expiresAt: now + lifetime * 1000 }, { headers: { 'Set-Cookie': setCookie(pairingCookie, browser, lifetime) } });
  }
  if (!previous) throw expired();
  const id = await digest(previous);
  const now = Date.now();
  // A lease longer than the token request timeout serializes concurrent polls from this browser.
  const row = await env.DB.prepare('UPDATE device_logins SET next_poll=? WHERE id=? AND expires_at>? AND next_poll<=? RETURNING device_code, interval_seconds')
    .bind(now + 45000, id, now, now).first<{ device_code: string; interval_seconds: number }>();
  if (!row) {
    const waiting = await env.DB.prepare('SELECT next_poll FROM device_logins WHERE id=? AND expires_at>?')
      .bind(id, now).first<{ next_poll: number }>();
    if (!waiting) throw expired();
    return pending(Math.max(1, Math.ceil((waiting.next_poll - now) / 1000)));
  }
  let grant;
  try {
    grant = await microsoftGrant(env, { grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: await unseal(env, 'pair:' + id, row.device_code) });
  } catch (error) {
    if (error instanceof AuthError && ['authorization_pending', 'slow_down', 'provider_unavailable'].includes(error.code)) {
      const interval = row.interval_seconds + (error.code === 'authorization_pending' ? 0 : 5);
      await env.DB.prepare('UPDATE device_logins SET next_poll=?, interval_seconds=? WHERE id=?')
        .bind(Date.now() + interval * 1000, interval, id).run();
      return pending(interval);
    }
    await env.DB.prepare('DELETE FROM device_logins WHERE id=?').bind(id).run();
    if (error instanceof AuthError && error.code === 'authorization_declined') throw new AuthError(403, 'declined', 'Sign-in was declined. Request a new code to try again.');
    if (error instanceof AuthError && error.code === 'expired_token') throw expired();
    throw error;
  }
  const user = await xboxUser(grant.access);
  await xboxStreamingTicket(user.ticket);
  const consumed = await env.DB.prepare('DELETE FROM device_logins WHERE id=? AND expires_at>?').bind(id, Date.now()).run();
  if (!consumed.meta.changes) throw expired();
  const raw = await createSession(env, await digest(user.hash), grant, cookie(request, sessionCookie));
  const response = Response.json({ authenticated: true });
  response.headers.append('Set-Cookie', setCookie(sessionCookie, raw, sessionSeconds));
  response.headers.append('Set-Cookie', setCookie(pairingCookie, '', 0));
  return response;
}
