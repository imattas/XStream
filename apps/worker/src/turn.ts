import { AuthError } from './auth/security';

interface TurnEnv { TURN_KEY_ID?: string; TURN_KEY_API_TOKEN?: string; TURN_ALLOWED_USER_ID?: string }
const tlsUrl = 'turns:turn.cloudflare.com:443?transport=tcp';

export async function turnCredentials(env: TurnEnv, userId: string) {
  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN || !env.TURN_ALLOWED_USER_ID) {
    throw new AuthError(503, 'turn_unavailable', 'The TURN relay is not configured.');
  }
  if (userId !== env.TURN_ALLOWED_USER_ID) throw new AuthError(403, 'turn_forbidden', 'The TURN relay is not enabled for this account.');
  let response: Response;
  try {
    response = await fetch('https://rtc.live.cloudflare.com/v1/turn/keys/' + encodeURIComponent(env.TURN_KEY_ID) + '/credentials/generate-ice-servers', {
      method: 'POST', headers: { Authorization: 'Bearer ' + env.TURN_KEY_API_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: 43200 }), signal: AbortSignal.timeout(10000), redirect: 'manual'
    });
  } catch { throw new AuthError(502, 'turn_failed', 'Could not reach the TURN relay service.'); }
  if (!response.ok) throw new AuthError(502, 'turn_failed', 'The TURN relay service could not issue credentials.');
  const result = await response.json().catch(() => null) as { iceServers?: { urls?: string | string[]; username?: unknown; credential?: unknown }[] } | null;
  const server = Array.isArray(result?.iceServers) ? result.iceServers.find(s => Array.isArray(s.urls) && s.urls.includes(tlsUrl)) : undefined;
  if (!server || typeof server.username !== 'string' || !server.username || typeof server.credential !== 'string' || !server.credential) {
    throw new AuthError(502, 'turn_failed', 'The TURN relay service returned invalid credentials.');
  }
  return { iceServers: [{ urls: tlsUrl, username: server.username, credential: server.credential }] };
}
