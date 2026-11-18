import { deviceLogin } from './device';
import { AuthError, digest, type AuthEnv } from './security';
import { cookie, requireSession, sessionProfile, sessionCookie, setCookie } from './session';
export { AuthError, type AuthEnv } from './security';
export { requireSession, getXhomeCredentials, type AuthSession } from './session';

export async function handleAuth(request: Request, env: AuthEnv): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  const action = /^\/api\/auth\/device\/(start|poll|cancel)$/.exec(path)?.[1];
  if (action) return deviceLogin(request, env, action);
  if (path === '/api/auth/session') {
    if (request.method !== 'GET') return new Response(null, { status: 405, headers: { Allow: 'GET' } });
    try {
      const serverTime = Date.now();
      const session = await requireSession(request, env);
      const user = await sessionProfile(env, session);
      if (Date.now() >= session.expiresAt) throw new AuthError(401, 'session_expired', 'Sign in again.');
      return Response.json({ authenticated: true, user, expiresAt: session.expiresAt, serverTime }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      if (!(error instanceof AuthError) || error.status !== 401) throw error;
      return Response.json({ authenticated: false }, { headers: { 'Cache-Control': 'no-store' } });
    }
  }
  if (path === '/api/auth/logout') {
    if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } });
    if (!env.APP_ORIGIN || request.headers.get('Origin') !== env.APP_ORIGIN) throw new AuthError(403, 'csrf', 'Sign out from this application.');
    const raw = cookie(request, sessionCookie);
    if (raw) await env.DB.prepare('DELETE FROM auth_sessions WHERE id=?').bind(await digest(raw)).run();
    return new Response(null, { status: 204, headers: { 'Set-Cookie': setCookie(sessionCookie, '', 0), 'Cache-Control': 'no-store' } });
  }
  return null;
}
