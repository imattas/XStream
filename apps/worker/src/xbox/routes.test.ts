import { afterEach, expect, it, vi } from 'vitest';
import { xboxRoute } from './routes';
import { HomeService, type HomeAccess } from './home';

const access: HomeAccess = {
  owner: 'session-owner', region: 'https://region.core.gssv-play-prodxhome.xboxlive.com',
  gsToken: 'fixture', getConnectToken: async () => 'transfer-fixture'
};
function sessionDB(expectedOwner: string) {
  return { prepare: () => ({
    bind: (_id: string, owner: string) => ({
      first: async () => owner === expectedOwner ? { region: access.region, upstream_id: 'upstream' } : null
    })
  }) } as unknown as D1Database;
}
function call(action: string, method: string, data?: unknown, owner = access.owner) {
  const request = new Request('https://example.test/api/stream/session/handle/' + action, {
    method, headers: { 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data)
  });
  return xboxRoute(request, { DB: sessionDB(owner) }, access);
}
afterEach(() => vi.unstubAllGlobals());

it('binds signaling to the signed-in session before making upstream requests', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  expect((await call('state', 'GET', undefined, 'another-owner')).status).toBe(404);
  expect(fetcher).not.toHaveBeenCalled();
});

it('rejects unknown and offline consoles before requesting a stream', async () => {
  const fetcher = vi.fn(async () => Response.json({ results: [{ serverId: 'known', deviceName: 'Home', powerState: 'Off' }] }));
  vi.stubGlobal('fetch', fetcher);
  const home = new HomeService(access, 'example.test');
  await expect(home.create('another', 'en-US', 0)).rejects.toMatchObject({ status: 404 });
  await expect(home.create('known', 'en-US', 0)).rejects.toMatchObject({ status: 409 });
  expect(fetcher.mock.calls).toHaveLength(2);
});

it('converts SDP and ICE to the pinned wire formats and handles empty poll responses', async () => {
  const remote = { candidate: 'a=candidate:2 1 UDP 1 192.0.2.1 9002 typ host', sdpMid: '0', sdpMLineIndex: '0' };
  const local = { candidate: 'candidate:1 1 UDP 1 192.0.2.2 8999 typ host', sdpMid: '0', sdpMLineIndex: 0 };
  const fetcher = vi.fn(async (url: string, init: RequestInit) => {
    if (init.method === 'POST' || url.endsWith('/sdp')) return new Response(null, { status: 204 });
    return Response.json({ exchangeResponse: JSON.stringify([remote]) });
  });
  vi.stubGlobal('fetch', fetcher);
  expect((await call('sdp', 'POST', { sdp: 'offer' })).status).toBe(200);
  expect(JSON.parse(String(fetcher.mock.calls[0][1].body))).toMatchObject({
    sdp: 'offer', requestId: '1', messageType: 'offer', configuration: { input: { minVersion: 1, maxVersion: 9 } }
  });
  expect(await (await call('sdp', 'GET')).json()).toEqual({ pending: true });
  expect((await call('ice', 'POST', { candidates: [local] })).status).toBe(200);
  expect(JSON.parse(String(fetcher.mock.calls[2][1].body))).toEqual({ candidates: [JSON.stringify(local)] });
  expect(await (await call('ice', 'GET')).json()).toEqual({ candidates: [{ ...remote, sdpMLineIndex: 0 }] });
  expect(fetcher.mock.calls.every(([url]) => url.startsWith(access.region + '/v5/sessions/home/upstream/'))).toBe(true);
  expect((await call('ice', 'POST', { candidates: ['malformed'] })).status).toBe(400);
});

it('maps upstream permission and malformed signaling failures to actionable errors', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('secret provider detail', { status: 403 }))
    .mockResolvedValueOnce(Response.json({ exchangeResponse: '{broken' })));
  const denied = await call('state', 'GET');
  expect(denied.status).toBe(403);
  expect(await denied.text()).not.toContain('secret provider detail');
  expect((await call('ice', 'GET')).status).toBe(502);
});

it('accepts a path-only play response and rejects a cloud or mismatched session path', async () => {
  const fetcher = vi.fn(async (url: string) => {
    if (url.endsWith('/servers/home')) return Response.json({ results: [{ serverId: 'c', deviceName: 'Home', powerState: 'On' }] });
    return Response.json({ sessionPath: 'v5/sessions/home/by-path' });
  });
  vi.stubGlobal('fetch', fetcher);
  const home = new HomeService(access, 'example.test');
  expect(await home.create('c', 'en-US', 0)).toBe('by-path');
  for (const bad of [{ sessionPath: 'v5/sessions/cloud/forbidden' }, { sessionPath: 'v5/sessions/home/one', sessionId: 'two' }]) {
    fetcher.mockResolvedValueOnce(Response.json({ results: [{ serverId: 'c', deviceName: 'Home', powerState: 'On' }] }))
      .mockResolvedValueOnce(Response.json(bad));
    await expect(home.create('c', 'en-US', 0)).rejects.toMatchObject({ status: 502 });
  }
});
