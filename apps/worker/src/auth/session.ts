import { deviceScopes, microsoftGrant, transferGrant, xboxHome, xboxUser, xboxProfile, type XboxProfile, type HomeGrant, type MicrosoftGrant } from './provider';
import { AuthError, digest, randomSecret, seal, signedOut, unseal, type AuthEnv } from './security';

import type { StreamMode } from '../../../../stream-mode';

export interface AuthSession { id: string; userId: string; expiresAt: number }
interface Credentials { profile?: { version?: number; value: XboxProfile; expires: number }; microsoft: MicrosoftGrant; home?: HomeGrant; cloud?: HomeGrant }
export const sessionCookie = '__Host-xstream';
export const sessionSeconds = 7 * 24 * 60 * 60;
export function cookie(request: Request, name: string) {
  const value = (request.headers.get('Cookie') || '').split(';').map(part => part.trim())
    .find(part => part.startsWith(name + '='))?.slice(name.length + 1);
  return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}
export function setCookie(name: string, value: string, seconds: number) {
  return name + '=' + value + '; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=' + seconds;
}
export async function requireSession(request: Request, env: AuthEnv): Promise<AuthSession> {
  const raw = cookie(request, sessionCookie);
  if (!raw) throw signedOut();
  const id = await digest(raw);
  const row = await env.DB.prepare('SELECT user_id, expires_at FROM auth_sessions WHERE id=? AND expires_at>?')
    .bind(id, Date.now()).first<{ user_id: string; expires_at: number }>();
  if (!row) throw signedOut();
  return { id, userId: row.user_id, expiresAt: row.expires_at };
}
export async function createSession(env: AuthEnv, userId: string, grant: MicrosoftGrant, previous: string | null) {
  const raw = randomSecret();
  const id = await digest(raw);
  const encrypted = await seal(env, 'session:' + id, JSON.stringify({ microsoft: grant }));
  const statements = [
    env.DB.prepare('DELETE FROM auth_sessions WHERE expires_at<=?').bind(Date.now()),
    env.DB.prepare('INSERT INTO auth_sessions(id,user_id,credentials,expires_at) VALUES(?,?,?,?)')
      .bind(id, userId, encrypted, Date.now() + sessionSeconds * 1000)
  ];
  if (previous) statements.push(env.DB.prepare('DELETE FROM auth_sessions WHERE id=?').bind(await digest(previous)));
  await env.DB.batch(statements);
  return raw;
}
async function read(env: AuthEnv, session: AuthSession): Promise<Credentials> {
  const row = await env.DB.prepare('SELECT credentials FROM auth_sessions WHERE id=? AND expires_at>?')
    .bind(session.id, Date.now()).first<{ credentials: string }>();
  if (!row) throw signedOut();
  return JSON.parse(await unseal(env, 'session:' + session.id, row.credentials)) as Credentials;
}
type Save = () => Promise<void>;
async function withCredentials<T>(env: AuthEnv, session: AuthSession, action: (credentials: Credentials, save: Save) => Promise<T>) {
  const lock = randomSecret();
  // Serializes rotating refresh grants across Worker isolates. A crashed request releases its lease after 90 seconds.
  const claimed = await env.DB.prepare('UPDATE auth_sessions SET lock_id=?, lock_until=? WHERE id=? AND expires_at>? AND lock_until<=?')
    .bind(lock, Date.now() + 90000, session.id, Date.now(), Date.now()).run();
  if (!claimed.meta.changes) {
    await read(env, session);
    throw new AuthError(409, 'auth_busy', 'Another request is refreshing Xbox credentials. Please retry.');
  }
  try {
    const credentials = await read(env, session);
    const save = async () => {
      const blob = await seal(env, 'session:' + session.id, JSON.stringify(credentials));
      const changed = await env.DB.prepare('UPDATE auth_sessions SET credentials=? WHERE id=? AND lock_id=? AND expires_at>?')
        .bind(blob, session.id, lock, Date.now()).run();
      if (!changed.meta.changes) throw signedOut();
    };
    return await action(credentials, save);
  } catch (error) {
    if (error instanceof AuthError && error.code === 'session_expired') {
      await env.DB.prepare('DELETE FROM auth_sessions WHERE id=? AND lock_id=?').bind(session.id, lock).run();
    }
    throw error;
  } finally {
    await env.DB.prepare('UPDATE auth_sessions SET lock_id=NULL, lock_until=0 WHERE id=? AND lock_id=?').bind(session.id, lock).run();
  }
}
const fresh = (expires: number) => expires > Date.now() + 60_000;
async function refreshMicrosoft(env: AuthEnv, credentials: Credentials, save: Save) {
  if (!fresh(credentials.microsoft.expires)) {
    if (!credentials.microsoft.refresh) throw signedOut();
    const grant = await microsoftGrant(env, { grant_type: 'refresh_token', refresh_token: credentials.microsoft.refresh, scope: deviceScopes });
    grant.refresh ??= credentials.microsoft.refresh;
    credentials.microsoft = grant;
    await save();
  }
}
export async function sessionProfile(env: AuthEnv, session: AuthSession) {
  const { profile } = await read(env, session);
  if (profile?.version === 2 && fresh(profile.expires)) return profile.value;
  try {
    return await withCredentials(env, session, async (credentials, save) => {
      if (credentials.profile?.version === 2 && fresh(credentials.profile.expires)) return credentials.profile.value;
      await refreshMicrosoft(env, credentials, save);
      const value = await xboxProfile(await xboxUser(credentials.microsoft.access));
      credentials.profile = { version: 2, value, expires: Date.now() + (value.picture ? 3600000 : 300000) };
      await save();
      return value;
    });
  } catch (error) {
    if (error instanceof AuthError && error.code === 'session_expired') throw error;
    return profile?.value;
  }
}
async function freshHome(env: AuthEnv, session: AuthSession, mode: StreamMode) {
  const slot = mode === 'xcloud' ? 'cloud' : 'home';
  const cached = (await read(env, session))[slot];
  if (cached && fresh(cached.expires)) return cached;
  return withCredentials(env, session, async (credentials, save) => {
    if (credentials[slot] && fresh(credentials[slot].expires)) return credentials[slot];
    await refreshMicrosoft(env, credentials, save);
    const user = await xboxUser(credentials.microsoft.access);
    // The encrypted Microsoft grant belongs to this cookie's session. Xbox can
    // issue a different user hash with each ticket for that same account.
    credentials[slot] = await xboxHome(user.ticket, mode);
    await save();
    return credentials[slot];
  });
}
export async function getXhomeCredentials(session: AuthSession, env: AuthEnv, mode: StreamMode = 'xhome') {
  const home = await freshHome(env, session, mode);
  return {
    owner: session.id, region: home.region, gsToken: home.gsToken,
    getConnectToken: () => withCredentials(env, session, async (credentials, save) => {
      if (!credentials.microsoft.refresh) throw signedOut();
      const transfer = await transferGrant(env, credentials.microsoft.refresh);
      if (transfer.refresh) {
        credentials.microsoft.refresh = transfer.refresh;
        await save();
      }
      return transfer.access;
    })
  };
}
