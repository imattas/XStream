import { afterEach, expect, it, vi } from 'vitest';
import { turnCredentials } from './turn';

afterEach(() => vi.unstubAllGlobals());

it('only issues TLS 443 credentials to the configured account', async () => {
  const fetcher = vi.fn(async () => Response.json({ iceServers: [{ urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'], username: 'short', credential: 'secret' }] }, { status: 201 }));
  vi.stubGlobal('fetch', fetcher);
  const env = { TURN_KEY_ID: 'key', TURN_KEY_API_TOKEN: 'private', TURN_ALLOWED_USER_ID: 'owner' };
  await expect(turnCredentials(env, 'stranger')).rejects.toMatchObject({ status: 403 });
  expect(fetcher).not.toHaveBeenCalled();
  expect(await turnCredentials(env, 'owner')).toEqual({ iceServers: [{ urls: 'turns:turn.cloudflare.com:443?transport=tcp', username: 'short', credential: 'secret' }] });
});

it('fails closed when configuration or valid credentials are missing', async () => {
  await expect(turnCredentials({}, 'owner')).rejects.toMatchObject({ status: 503 });
  vi.stubGlobal('fetch', async () => Response.json({ iceServers: [] }, { status: 201 }));
  await expect(turnCredentials({ TURN_KEY_ID: 'key', TURN_KEY_API_TOKEN: 'private', TURN_ALLOWED_USER_ID: 'owner' }, 'owner')).rejects.toMatchObject({ status: 502 });
});
