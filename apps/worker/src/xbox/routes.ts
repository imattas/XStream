import { HomeError, HomeService, malformed, object, sdpOffer, validId, type HomeAccess } from './home';

import type { StreamMode } from '../../../../stream-mode';
import { catalog, requireTitle, validTitleId } from './cloud';

const ttl = 10 * 60 * 1000;
const invalid = () => new HomeError(400, 'Invalid streaming request.');
const json = (value: unknown, status = 200) => Response.json(value, { status });
async function readBody(request: Request) {
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw invalid();
  const reader = request.body?.getReader();
  if (!reader) throw invalid();
  let size = 0;
  let text = '';
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 128 * 1024) {
      await reader.cancel();
      throw new HomeError(413, 'Signaling request is too large.');
    }
    text += decoder.decode(value, { stream: true });
  }
  try { return object(JSON.parse(text + decoder.decode())); } catch { throw invalid(); }
}

function localCandidates(value: unknown) {
  if (!Array.isArray(value) || !value.length || value.length > 128) throw invalid();
  return value.map((entry: unknown) => {
    const c = object(entry);
    if (typeof c.candidate !== 'string' || c.candidate.length > 2048 ||
        !(typeof c.sdpMid === 'string' || c.sdpMid === null) ||
        !(Number.isInteger(c.sdpMLineIndex) || c.sdpMLineIndex === null) ||
        !(c.usernameFragment == null || typeof c.usernameFragment === 'string')) throw invalid();
    return JSON.stringify({ candidate: c.candidate, sdpMid: c.sdpMid, sdpMLineIndex: c.sdpMLineIndex, usernameFragment: c.usernameFragment });
  });
}

function readExchange(reply: unknown, action: 'sdp'|'ice') {
  if (reply === null) return { pending: true };
  const raw = object(reply).exchangeResponse;
  if (typeof raw !== 'string') malformed();
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { malformed(); }
  if (action === 'sdp') {
    const { sdp } = object(parsed);
    if (typeof sdp !== 'string' || !sdp) malformed();
    return { sdp };
  }
  if (!Array.isArray(parsed) || !parsed.length) malformed();
  const candidates = parsed.map((entry: unknown) => {
    const c = object(entry);
    if (typeof c.candidate !== 'string') malformed();
    return { candidate: c.candidate, sdpMid: c.sdpMid == null ? null : String(c.sdpMid),
      sdpMLineIndex: c.sdpMLineIndex == null ? null : Number(c.sdpMLineIndex) };
  });
  return { candidates };
}

export async function xboxRoute(request: Request, env: { DB: D1Database }, access: HomeAccess, mode: StreamMode = 'xhome'): Promise<Response> {
  try {
    const url = new URL(request.url);
    const home = new HomeService(access, url.hostname, mode);
    const method = request.method;
    const cloud = mode === 'xcloud';
    const sessionBase = cloud ? '/api/cloud/session' : '/api/stream/session';
    const upstreamBase = cloud ? '/v5/sessions/cloud/' : '/v5/sessions/home/';
    if (cloud && url.pathname === '/api/cloud/waittime' && method === 'GET') {
      const title = url.searchParams.get('titleId');
      if (!validTitleId(title)) throw invalid();
      const { estimatedTotalWaitTimeInSeconds: seconds } = object(await home.call('/v1/waittime/' + encodeURIComponent(title)));
      return json({ seconds: typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0 ? seconds : null });
    }
    if (cloud && url.pathname === '/api/cloud/catalog' && method === 'GET') return json(await catalog(home));
    if (url.pathname === '/api/consoles' && method === 'GET') return json({ consoles: await home.consoles() });
    const info = /^\/api\/consoles\/([\w-]+)$/.exec(url.pathname);
    if (info && method === 'GET') {
      const console = (await home.consoles()).find((item) => item.serverId === info[1]);
      if (!console) throw new HomeError(404, 'Console unavailable.');
      return json({ console });
    }
    if (url.pathname === sessionBase && method === 'POST') {
      const body = await readBody(request);
      const target = cloud ? body.titleId : body.serverId;
      const validTarget = cloud ? validTitleId : validId;
      if (!validTarget(target)) throw invalid();
      const locale = typeof body.locale === 'string' && /^[a-zA-Z0-9-]{2,35}$/.test(body.locale) ? body.locale : 'en-US';
      const timezone = typeof body.timezoneOffsetMinutes === 'number' && Number.isInteger(body.timezoneOffsetMinutes) &&
        Math.abs(body.timezoneOffsetMinutes) <= 840 ? body.timezoneOffsetMinutes : 0;
      await env.DB.prepare('DELETE FROM stream_sessions WHERE expires_at <= ?').bind(Date.now()).run();
      const sessionId = crypto.randomUUID();
      const reservation = await env.DB.prepare(`INSERT INTO stream_sessions (id, owner, region, upstream_id, expires_at, mode)
        SELECT ?, ?, ?, '', ?, ? WHERE NOT EXISTS (SELECT 1 FROM stream_sessions WHERE owner = ? AND expires_at > ?)`)
        .bind(sessionId, access.owner, access.region, Date.now() + ttl, mode, access.owner, Date.now()).run();
      if (!reservation.meta.changes) throw new HomeError(409, 'Disconnect your active stream before starting another.');
      let upstreamId: string | undefined;
      let inputs;
      try {
        if (cloud) inputs = await requireTitle(home, target);
        upstreamId = cloud ? await home.play(target, locale, timezone) : await home.create(target, locale, timezone);
        const updated = await env.DB.prepare('UPDATE stream_sessions SET upstream_id = ? WHERE id = ?')
          .bind(upstreamId, sessionId).run();
        if (!updated.meta.changes) throw new HomeError(409, 'The streaming session expired during setup.');
      } catch (err) {
        if (upstreamId) await home.call(upstreamBase + upstreamId, 'DELETE').catch(() => undefined);
        await env.DB.prepare('DELETE FROM stream_sessions WHERE id = ?').bind(sessionId).run();
        throw err;
      }
      return json({ sessionId, inputs }, 201);
    }

    if (!url.pathname.startsWith(sessionBase + '/')) throw new HomeError(404, 'Unknown streaming route.');
    const route = /^\/([\w-]+)(?:\/(state|connect|sdp|ice|keepalive))?$/.exec(url.pathname.slice(sessionBase.length));
    if (!route) throw new HomeError(404, 'Streaming route unavailable.');
    const [, sessionId, action] = route;
    const row = await env.DB.prepare('SELECT region, upstream_id FROM stream_sessions WHERE id = ? AND owner = ? AND expires_at > ? AND mode = ?')
      .bind(sessionId, access.owner, Date.now(), mode).first<{region: string; upstream_id: string}>();
    if (!row) throw new HomeError(404, 'Streaming session has ended.');
    const path = upstreamBase + row.upstream_id;
    const call = (op: string, verb: string, body?: unknown) => home.call(path + op, verb, body, row.region);

    if (!action && method === 'DELETE') {
      try { await call('', 'DELETE'); }
      catch (e) { if (!(e instanceof HomeError && e.status === 404)) throw e; }
      await env.DB.prepare('DELETE FROM stream_sessions WHERE id = ? AND owner = ?').bind(sessionId, access.owner).run();
      return json({ ended: true });
    }
    if (action === 'state' && method === 'GET') {
      const { state } = object(await call('/state', 'GET'));
      if (typeof state !== 'string') malformed();
      if (cloud && state === 'WaitingForResources') {
        const now = Date.now();
        await env.DB.prepare('UPDATE stream_sessions SET expires_at = ? WHERE id = ? AND expires_at < ?')
          .bind(now + ttl, sessionId, now + ttl / 2).run();
      }
      return json({ state });
    }
    if (action === 'connect' && method === 'POST') {
      await call('/connect', 'POST', { userToken: await access.getConnectToken() });
      return json({ accepted: true });
    }
    if (action === 'keepalive' && method === 'POST') {
      await call('/keepalive', 'POST');
      await env.DB.prepare('UPDATE stream_sessions SET expires_at = ? WHERE id = ? AND owner = ?')
        .bind(Date.now() + ttl, sessionId, access.owner).run();
      return json({ accepted: true });
    }
    if (action === 'sdp' || action === 'ice') {
      if (method === 'GET') return json(readExchange(await call('/' + action, 'GET'), action));
      if (method === 'POST') {
        const data = await readBody(request);
        if (action === 'sdp') {
          if (typeof data.sdp !== 'string' || !data.sdp || data.sdp.length > 98304) throw invalid();
          await call('/sdp', 'POST', sdpOffer(data.sdp));
        } else {
          await call('/ice', 'POST', { candidates: localCandidates(data.candidates) });
        }
        return json({ accepted: true });
      }
    }
    throw new HomeError(405, 'Method unavailable for this streaming route.');
  } catch (err) {
    if (err instanceof HomeError) return json({ error: err.message }, err.status);
    throw err;
  }
}
