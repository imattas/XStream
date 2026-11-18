import PlayerApiClient from 'xbox-xcloud-player/dist/apiclient';
import { homeOrigin } from './region';
import type { StreamMode } from '../../../../stream-mode';
export interface HomeAccess {
  owner: string;
  region: string;
  gsToken: string;
  getConnectToken(): Promise<string>;
}

export class HomeError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
export function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
}
export function validId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}
export function malformed(): never {
  throw new HomeError(502, 'Xbox returned an incomplete streaming response.');
}

// The CommonJS release exposes its default constructor through a wrapper in workerd's bundle.
const ApiClient = typeof PlayerApiClient === 'function' ? PlayerApiClient :
  (PlayerApiClient as { default: typeof PlayerApiClient }).default;

export class HomeService extends ApiClient {
  constructor(access: HomeAccess, private appHost: string, private mode: StreamMode = 'xhome') {
    super({ locale: 'en-US', host: access.region, token: access.gsToken });
  }

  // Use the Worker's bounded, region-validated transport for the SDK's console request.
  override get(path: string) { return this.call(path); }

  async call(path: string, method = 'GET', payload?: unknown, region = this.getBaseHost()): Promise<unknown> {
    const origin = homeOrigin(region);
    if (!origin) malformed();
    let response: Response;
    try {
      response = await fetch(origin + path, {
        method, redirect: 'manual', signal: AbortSignal.timeout(12000),
        headers: {
          Accept: 'application/json', 'Content-Type': 'application/json',
          Authorization: 'Bearer ' + this.getConfig().token,
          'X-Gssv-Client': 'XboxComBrowser',
          'X-MS-Device-Info': JSON.stringify({
            appInfo: { env: { clientAppId: this.appHost, clientAppType: 'browser', httpEnvironment: 'prod' } },
            dev: { hw: { sdktype: 'web' }, displayInfo: { dimensions: { widthInPixels: 1920, heightInPixels: 1080 } } }
          })
        },
        body: payload === undefined ? undefined : JSON.stringify(payload)
      });
    } catch { throw new HomeError(503, 'The Xbox streaming service could not be reached.'); }
    if (!response.ok) {
      const errors: Record<number, string> = {
        401: 'Xbox rejected this streaming credential. Sign in again.',
        403: this.mode === 'xcloud' ? 'Xbox denied Cloud Gaming access. Check your subscription and title entitlement.' : 'Xbox denied Remote Play for this app, account or console.',
        404: 'Xbox could not find the selected target or streaming session.',
        409: 'Xbox reported a conflicting streaming session.',
        429: 'Xbox is rate limiting requests. Try again later.'
      };
      throw new HomeError(errors[response.status] ? response.status : 502,
        errors[response.status] ?? 'The Xbox streaming service rejected this request.');
    }
    if (response.status === 204) return null;
    const text = await response.text();
    if (!text) return null;
    try { return JSON.parse(text) as unknown; } catch { return malformed(); }
  }

  async consoles() {
    const data = object(await this.getConsoles());
    if (!Array.isArray(data.results)) malformed();
    return data.results.map((entry: unknown) => {
      const c = object(entry);
      if (!validId(c.serverId) || typeof c.deviceName !== 'string' || typeof c.powerState !== 'string') malformed();
      return { serverId: c.serverId, deviceName: c.deviceName, powerState: c.powerState,
        consoleType: typeof c.consoleType === 'string' ? c.consoleType : '',
        wirelessWarning: c.wirelessWarning === true, outOfHomeWarning: c.outOfHomeWarning === true };
    });
  }

  async create(serverId: string, locale: string, timezoneOffsetMinutes: number) {
    const console = (await this.consoles()).find((item) => item.serverId === serverId);
    if (!console) throw new HomeError(404, 'This console is unavailable on your Xbox account.');
    if (['off', 'offline'].includes(console.powerState.toLowerCase())) throw new HomeError(409, 'This Xbox is offline.');
    return this.play(serverId, locale, timezoneOffsetMinutes);
  }

  async play(target: string, locale: string, timezoneOffsetMinutes: number) {
    const cloud = this.mode === 'xcloud';
    const prefix = '/v5/sessions/' + (cloud ? 'cloud' : 'home') + '/';
    const result = object(await this.call(prefix + 'play', 'POST', {
      clientSessionId: '', titleId: cloud ? target : '', systemUpdateGroup: '', serverId: cloud ? '' : target, fallbackRegionNames: [],
      settings: { nanoVersion: 'V3;WebrtcTransport.dll', enableOptionalDataCollection: false,
        enableTextToSpeech: false, highContrast: 0, locale, useIceConnection: false,
        timezoneOffsetMinutes, sdkType: 'web', osName: 'windows' }
    }));
    // Greenlight's streammanager also supports play responses carrying only sessionPath.
    const id = typeof result.sessionPath === 'string' && result.sessionPath.startsWith(prefix.slice(1)) && result.sessionPath.slice(prefix.length - 1);
    if (!validId(id) || (result.sessionId !== undefined && result.sessionId !== id)) malformed();
    return id;
  }
}

// xbox-xcloud-player/src/lib/stream.ts, sendSDPOffer, protocol versions from 1.0.0-beta7.
export function sdpOffer(sdp: string) {
  return { messageType: 'offer', requestId: '1', sdp, configuration: {
    chatConfiguration: { bytesPerSample: 2, expectedClipDurationMs: 20, format: { codec: 'opus', container: 'webm' },
      numChannels: 1, sampleFrequencyHz: 24000 },
    chat: { minVersion: 1, maxVersion: 1 }, control: { minVersion: 1, maxVersion: 3 },
    input: { minVersion: 1, maxVersion: 9 }, message: { minVersion: 1, maxVersion: 1 },
    reliableinput: { minVersion: 9, maxVersion: 9 }, unreliableinput: { minVersion: 9, maxVersion: 9 }
  } };
}


