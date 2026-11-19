import api from './index'
import { seal, unseal, type AuthEnv } from './auth/security'

interface ProductionEnv extends AuthEnv {
  ASSETS: Fetcher
  SITE_PIN: string
  PIN_ATTEMPTS: RateLimit
}

const duration = 7 * 24 * 60 * 60
const cookieName = '__Host-xstream-access'
const unlock = '/_access/unlock'
const timerPath = '/_access/deadline.js'
const privateHeaders = {
  'Cache-Control': 'private, no-store',
  'Referrer-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Strict-Transport-Security': 'max-age=31536000',
}

function promptPage(message = '', status = 401) {
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unlock XStream</title>
<style>:root{color-scheme:dark;font:1rem system-ui;background:#151715}dialog{width:min(20rem,80vw);padding:1.6rem;border:1px solid #526052;border-radius:1rem;background:#212421;color:#fff}h1{margin:0 0 1rem;font-size:1.4rem}input,button{box-sizing:border-box;width:100%;padding:.75rem;margin-top:.5rem;font:inherit;border-radius:.5rem}button{background:#abeb95;color:#15210e;border:0;font-weight:650;cursor:pointer}</style>
<dialog open aria-labelledby="heading"><form method="post" action="${unlock}"><h1 id="heading">Unlock XStream</h1><label>Site PIN<input autofocus required type="password" name="pin" inputmode="numeric" pattern="[0-9]{6}" maxlength="6"></label>${message ? '<p role="alert">'+message+'</p>' : ''}<button>Unlock</button></form></dialog></html>`, {
    status, headers: { ...privateHeaders, 'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
      ...(status === 429 ? { 'Retry-After': '60' } : {}) },
  })
}

async function deadline(request: Request, env: ProductionEnv) {
  const value = request.headers.get('Cookie')?.split(';').map(c => c.trim()).find(c => c.startsWith(cookieName + '='))?.slice(cookieName.length + 1)
  if (!value) return 0
  try {
    return Number(await unseal(env, 'site-access:' + env.SITE_PIN, value))
  } catch {
    return 0
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.origin !== env.APP_ORIGIN || !env.SITE_PIN || !env.TOKEN_ENCRYPTION_KEY) return new Response(null, { status: 503, headers: privateHeaders })
    if (url.pathname === unlock && request.method === 'POST') {
      if (request.headers.get('Origin') !== url.origin) return new Response(null, { status: 403, headers: privateHeaders })
      const { success } = await env.PIN_ATTEMPTS.limit({ key: request.headers.get('CF-Connecting-IP') || 'unknown' })
      if (!success) return promptPage('Too many attempts. Try again in a minute.', 429)
      if (Number(request.headers.get('Content-Length')) > 128 || !request.headers.get('Content-Type')?.startsWith('application/x-www-form-urlencoded')) return new Response(null, { status: 400, headers: privateHeaders })
      const pin = (await request.formData()).get('pin')
      if (pin !== env.SITE_PIN) return promptPage('Incorrect PIN. Try again.')
      const expires = Date.now() + duration * 1000
      const token = await seal(env, 'site-access:' + env.SITE_PIN, String(expires))
      return new Response(null, { status: 303, headers: { ...privateHeaders, Location: '/',
        'Set-Cookie': `${cookieName}=${token}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${duration}` } })
    }

    const expires = await deadline(request, env)
    const remaining = expires - Date.now()
    if (!(remaining > 0 && remaining <= duration * 1000)) {
      if (request.headers.get('Sec-Fetch-Dest') === 'document' || request.headers.get('Accept')?.includes('text/html')) return promptPage()
      return Response.json({ error: 'Enter the site PIN to continue.' }, { status: 401, headers: privateHeaders })
    }
    if (url.pathname === timerPath) {
      return new Response(`const deadline = Date.now() + Number(document.currentScript.dataset.remaining);
function check() { if (Date.now() >= deadline) location.reload(); }
setTimeout(check, Math.max(0, deadline - Date.now()));
addEventListener('pageshow', check);
document.addEventListener('visibilitychange', check);`, { headers: { ...privateHeaders, 'Content-Type': 'text/javascript' } })
    }
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return api.fetch(request, env)
    const asset = await env.ASSETS.fetch(request)
    const response = new Response(asset.body, asset)
    response.headers.set('Cache-Control', 'private, no-store')
    if (request.method === 'GET' && response.headers.get('Content-Type')?.includes('text/html')) {
      return new HTMLRewriter().on('head', { element(el) {
        el.prepend(`<script src="${timerPath}" data-remaining="${remaining}"></script>`, { html: true })
      } }).transform(response)
    }
    return response
  },
} satisfies ExportedHandler<ProductionEnv>
