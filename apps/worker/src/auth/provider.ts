import { homeOrigin } from '../xbox/region';
import { AuthError, signedOut, type AuthEnv } from './security';

export const authority = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';
const userEndpoint = 'https://user.auth.xboxlive.com/user/authenticate';
const xstsEndpoint = 'https://xsts.auth.xboxlive.com/xsts/authorize';
import type { StreamMode } from '../../../../stream-mode';
const transferEndpoint = 'https://login.live.com/oauth20_token.srf';
type ObjectValue = Record<string, unknown>;
function object(value: unknown): ObjectValue {
  return value && typeof value === 'object' ? value as ObjectValue : {};
}
const malformed = () => new AuthError(502, 'provider_response', 'Microsoft or Xbox returned an incomplete authentication response.');
function token(value: unknown) {
  if (typeof value !== 'string' || !value || value.length > 65536) throw malformed();
  return value;
}
function expiry(seconds: unknown) {
  if (typeof seconds !== 'number' || !Number.isSafeInteger(seconds) || seconds <= 0) throw malformed();
  return Date.now() + seconds * 1000;
}
async function post(endpoint: string, body: BodyInit, headers: HeadersInit, stage: string) {
  let response;
  try {
    response = await fetch(endpoint, { method: 'POST', headers, body, redirect: 'manual', signal: AbortSignal.timeout(10000) });
  } catch {
    throw new AuthError(502, 'provider_unavailable', 'The authentication service could not be reached.');
  }
  const data = object(await response.json().catch(() => null));
  if (response.ok) return data;
  if (stage === 'device_poll' && ['authorization_pending', 'slow_down', 'authorization_declined', 'expired_token', 'bad_verification_code'].includes(String(data.error))) {
    throw new AuthError(400, String(data.error), 'The pairing code is no longer available. Request a new code.');
  }
  if (endpoint === authority + '/token' && data.error === 'invalid_grant') throw signedOut();
  if (response.status === 429 || response.status >= 500) {
    throw new AuthError(503, 'provider_unavailable', 'The authentication service is temporarily unavailable.');
  }
  if (stage === 'xcloud_offering') throw new AuthError(403, 'xcloud_offering_denied',
    'Xbox denied Cloud Gaming access. Check your subscription, region and account eligibility.');
  throw new AuthError(403, stage + '_denied', 'Microsoft or Xbox denied the ' + stage.replaceAll('_', ' ') + ' request for this app or account.');
}
function xboxPost(endpoint: string, body: ObjectValue, stage: string) {
  return post(endpoint, JSON.stringify(body), { 'Content-Type': 'application/json', 'x-xbl-contract-version': '1' }, stage);
}
export const upstreamClientId = '1f907974-e22b-4810-a9de-d9647380c97e';
function oauthPost(env: AuthEnv, fields: Record<string, string>, endpoint: string, stage: string) {
  const body = new URLSearchParams({ ...fields, client_id: env.MICROSOFT_CLIENT_ID || upstreamClientId });
  return post(endpoint, body, { 'Content-Type': 'application/x-www-form-urlencoded' }, stage);
}

export const deviceScopes = 'xboxlive.signin openid profile offline_access';
export function beginDeviceGrant(env: AuthEnv) {
  return oauthPost(env, { scope: deviceScopes }, authority + '/devicecode', 'device_login');
}
export interface MicrosoftGrant { access: string; refresh?: string; expires: number }
export interface XboxUser { ticket: string; hash: string }
export interface HomeGrant { gsToken: string; region: string; expires: number }
export async function microsoftGrant(env: AuthEnv, fields: Record<string, string>): Promise<MicrosoftGrant> {
  const data = await oauthPost(env, fields, authority + '/token', fields.device_code ? 'device_poll' : 'microsoft_sign_in');
  if (typeof data.token_type !== 'string' || data.token_type.toLowerCase() !== 'bearer') throw malformed();
  return { access: token(data.access_token), refresh: data.refresh_token ? token(data.refresh_token) : undefined, expires: expiry(data.expires_in) };
}
export async function xboxUser(access: string): Promise<XboxUser> {
  const data = await xboxPost(userEndpoint, {
    Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: 'd=' + access },
    RelyingParty: 'http://auth.xboxlive.com', TokenType: 'JWT'
  }, 'xbox_user');
  const claims = object(data.DisplayClaims).xui;
  if (!Array.isArray(claims)) throw malformed();
  return { ticket: token(data.Token), hash: token(object(claims[0]).uhs) };
}
export async function xboxStreamingTicket(userTicket: string) {
  const xsts = await xboxPost(xstsEndpoint, {
    Properties: { SandboxId: 'RETAIL', UserTokens: [userTicket] },
    RelyingParty: 'http://gssv.xboxlive.com/', TokenType: 'JWT'
  }, 'xbox_streaming_access');
  return token(xsts.Token);
}
export interface XboxProfile { name: string; picture?: string; gamerscore?: number; tenure?: number }

export async function xboxProfile(user: XboxUser): Promise<XboxProfile> {
  const ticket = await xboxPost(xstsEndpoint, {
    Properties: { SandboxId: 'RETAIL', UserTokens: [user.ticket] },
    RelyingParty: 'http://xboxlive.com', TokenType: 'JWT'
  }, 'xbox_profile');
  const claims = object(ticket.DisplayClaims).xui;
  const claim = Array.isArray(claims) ? object(claims[0]) : {};
  const name = typeof claim.gtg === 'string' ? claim.gtg.trim() : '';
  const response = await fetch('https://profile.xboxlive.com/users/me/profile/settings?settings=Gamertag,GameDisplayPicRaw,Gamerscore,TenureLevel', {
    headers: { Authorization: 'XBL3.0 x=' + token(claim.uhs) + ';' + token(ticket.Token), 'x-xbl-contract-version': '2', Accept: 'application/json' },
    redirect: 'manual', signal: AbortSignal.timeout(5000)
  }).catch(() => null);
  const users = response?.ok ? object(await response.json().catch(() => null)).profileUsers : undefined;
  const settings = Array.isArray(users) ? object(users[0]).settings : undefined;
  const values = new Map<string, string>();
  if (Array.isArray(settings)) for (const setting of settings) {
    const { id, value } = object(setting);
    if (typeof id === 'string' && typeof value === 'string') values.set(id, value.trim());
  }
  const gamertag = values.get('Gamertag') || name;
  if (!gamertag) throw malformed();
  const profile: XboxProfile = { name: gamertag };
  const score = values.get('Gamerscore'), years = values.get('TenureLevel');
  if (score && /^\d{1,10}$/.test(score)) profile.gamerscore = Number(score);
  if (years && /^\d{1,3}$/.test(years)) profile.tenure = Number(years);
  let url: URL;
  try { url = new URL(values.get('GameDisplayPicRaw') || ''); } catch { return profile; }
  if (['http:', 'https:'].includes(url.protocol) && !url.port && !url.username && !url.password &&
    (url.hostname.endsWith('.xboxlive.com') || url.hostname.endsWith('.xboxservices.com'))) {
    url.protocol = 'https:';
    profile.picture = url.href;
  }
  return profile;
}
export async function xboxHome(userTicket: string, mode: StreamMode = 'xhome'): Promise<HomeGrant> {
  const ticket = await xboxStreamingTicket(userTicket);
  const login = (offeringId: string) => post('https://' + offeringId + '.gssv-play-prod.xboxlive.com/v2/login/user',
    JSON.stringify({ token: ticket, offeringId }),
    { 'Content-Type': 'application/json', 'X-Gssv-Client': 'XboxComBrowser' }, mode + '_offering');
  const home = mode === 'xhome' ? await login('xhome') : await login('xgpuweb').catch(error => {
    if (!(error instanceof AuthError && error.code === 'xcloud_offering_denied')) throw error;
    return login('xgpuwebf2p');
  });
  const regions = object(home.offeringSettings).regions;
  if (!Array.isArray(regions)) throw malformed();
  const address = object(regions.find((item: unknown) => object(item).isDefault === true)).baseUri;
  const region = homeOrigin(address);
  if (!region) throw malformed();
  return { gsToken: token(home.gsToken), region, expires: expiry(home.durationInSeconds) };
}
export async function transferGrant(env: AuthEnv, refresh: string) {
  const data = await oauthPost(env, {
    grant_type: 'refresh_token', refresh_token: refresh,
    scope: 'service::http://Passport.NET/purpose::PURPOSE_XBOX_CLOUD_CONSOLE_TRANSFER_TOKEN'
  }, transferEndpoint, 'console_transfer');
  return { access: token(data.access_token), refresh: data.refresh_token ? token(data.refresh_token) : undefined };
}


