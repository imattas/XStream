import { AuthError, getXhomeCredentials, handleAuth, requireSession, type AuthEnv } from './auth'
import { xboxRoute } from './xbox/routes'
import { turnCredentials } from './turn'
import { HomeError, HomeService, validId } from './xbox/home'

const securityHeaders = {
  'Cache-Control': 'private, no-store',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Strict-Transport-Security': 'max-age=31536000',
}

function secure(response: Response) {
  const result = new Response(response.body, response)
  for (const [name, value] of Object.entries(securityHeaders)) result.headers.set(name, value)
  return result
}

async function route(request: Request, env: AuthEnv): Promise<Response> {
  const { pathname, origin } = new URL(request.url)
  if (pathname === '/api/health' && request.method === 'GET') {
    return Response.json({ status: 'ok' })
  }
  // Wrangler normalizes the upstream URL to its own listening port behind Vite.
  const localDevProxy = origin === 'http://127.0.0.1:8787' && env.APP_ORIGIN === 'http://127.0.0.1:5173'
  if (!env.APP_ORIGIN || (origin !== env.APP_ORIGIN && !localDevProxy)) {
    return Response.json({ error: 'This address is not the configured XStream origin.' }, { status: 403 })
  }
  if (!['GET', 'HEAD'].includes(request.method) && request.headers.get('Origin') !== env.APP_ORIGIN) {
    return Response.json({ error: 'A same-origin request is required.' }, { status: 403 })
  }
  if (pathname.startsWith('/api/auth/')) {
    const response = await handleAuth(request, env)
    if (response) return response
  }
  if (pathname === '/api/turn' && request.method === 'POST') {
    const session = await requireSession(request, env)
    const limit = await env.PAIRING_STARTS.limit({ key: 'turn:' + session.userId })
    if (!limit.success) return Response.json({ error: 'Too many relay requests. Try again shortly.' }, { status: 429 })
    return Response.json(await turnCredentials(env, session.userId))
  }
  if (/^\/api\/(?:consoles|stream|cloud)(?:\/|$)/.test(pathname)) {
    const session = await requireSession(request, env)
    const mode = pathname.startsWith('/api/cloud/') ? 'xcloud' : 'xhome'
    const credentials = await getXhomeCredentials(session, env, mode)
    const create = request.method === 'POST' && (pathname === '/api/stream/session' || pathname === '/api/cloud/session')
    const retry = create ? request.clone() : undefined
    const response = await xboxRoute(request, env, credentials, mode)
    const conflict = response.status === 409 && create && (await response.clone().json() as {error?: string}).error === 'Disconnect your active stream before starting another.'
    if (!conflict || !retry) return response
    const rows = await env.DB.prepare('SELECT id, region, upstream_id, mode FROM stream_sessions WHERE owner = ? AND expires_at > ?')
      .bind(session.id, Date.now()).all<{id: string; region: string; upstream_id: string; mode: string}>()
    for (const row of rows.results) {
      if (!validId(row.upstream_id) || (row.mode !== 'xhome' && row.mode !== 'xcloud')) {
        return Response.json({ error: 'Another stream is still starting. Wait a moment and retry.' }, { status: 409 })
      }
      const prior = await getXhomeCredentials(session, env, row.mode)
      const home = new HomeService(prior, new URL(request.url).hostname, row.mode)
      try { await home.call('/v5/sessions/' + (row.mode === 'xcloud' ? 'cloud/' : 'home/') + row.upstream_id, 'DELETE', undefined, row.region) }
      catch (error) { if (!(error instanceof HomeError && error.status === 404)) return Response.json({ error: 'Could not disconnect the previous Xbox stream. Try again.' }, { status: 502 }) }
      await env.DB.prepare('DELETE FROM stream_sessions WHERE id = ? AND owner = ? AND upstream_id = ?')
        .bind(row.id, session.id, row.upstream_id).run()
    }
    return xboxRoute(retry, env, credentials, mode)
  }
  return Response.json({ error: 'Unknown API route.' }, { status: 404 })
}

export default {
  async fetch(request, env) {
    try {
      return secure(await route(request, env))
    } catch (error) {
      if (error instanceof AuthError) {
        return secure(Response.json({ error: error.message, code: error.code }, { status: error.status }))
      }
      return secure(Response.json({ error: 'The request could not be completed. Try again.' }, { status: 500 }))
    }
  },
} satisfies ExportedHandler<AuthEnv>
