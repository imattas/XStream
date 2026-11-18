import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RemotePlayClient, gamepadOptions, type StreamState } from './client';
import Player from 'xbox-xcloud-player/dist/player';
import Gamepad from 'xbox-xcloud-player/dist/input/gamepad';
import { ReportTypes } from 'xbox-xcloud-player/dist/channel/input/packet';

class Transceiver { setCodecPreferences() {} }
class Peer extends EventTarget {
  static latest: Peer;
  connectionState = 'new';
  iceGatheringState = 'complete';
  onconnectionstatechange: (() => void) | null = null;
  channels = new Map<string, { readyState: string }>();
  constructor() { super(); Peer.latest = this; }
  createDataChannel(label: string) {
    const channel = { readyState: 'open', send: vi.fn() };
    this.channels.set(label, channel);
    return channel;
  }
  addTransceiver() { return new Transceiver(); }
  createOffer() { return Promise.resolve({ type: 'offer', sdp: 'v=0\r\n' }); }
  async setLocalDescription() {
    const c = { candidate: 'candidate:1 1 UDP 1 192.0.2.1 9002 typ host', sdpMid: '0', sdpMLineIndex: 0 };
    this.dispatchEvent(Object.assign(new Event('icecandidate'), { candidate: { ...c, toJSON: () => c } }));
  }
  setRemoteDescription = vi.fn(() => Promise.resolve());
  async addIceCandidate() { this.connectionState = 'connected'; this.onconnectionstatechange?.(); }
  getStats() { return Promise.resolve(new Map([['pair', { type: 'candidate-pair', state: 'succeeded', nominated: true, currentRoundTripTime: 0.023 }]])); }
  getReceivers() { return []; }
  getSenders() { return []; }
  close = vi.fn();
}
let pads: Array<GamepadSnapshot | null>;
interface GamepadSnapshot { index: number; axes: number[]; buttons: { value: number }[] }
beforeEach(() => {
  pads = [];
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('navigator', { language: 'en-US', getGamepads: () => pads, permissions: { query: async () => ({ state: 'denied' }) } });
  vi.stubGlobal('RTCPeerConnection', Peer);
  vi.stubGlobal('RTCRtpTransceiver', Transceiver);
  vi.stubGlobal('RTCRtpReceiver', { getCapabilities: () => ({ codecs: [] }) });
  vi.stubGlobal('HTMLVideoElement', class { requestVideoFrameCallback() {} });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('delivers ordered input during a video stall without overflowing packet counts', async () => {
  vi.useFakeTimers();
  const player = new Player('media');
  const input = player._channels.input;
  const packets: DataView[] = [];
  vi.spyOn(input, 'send').mockImplementation(data => { packets.push(data as DataView); });
  try {
    input.start();
    const presses = Array.from({ length: 301 }, (_, i) => i % 2 === 0);
    for (const pressed of presses) input.queueKeyboardFrame({ key: 'a', keyCode: 65, pressed });
    await vi.advanceTimersByTimeAsync(16);
    const reports = packets.filter(packet => packet.getUint16(0, true) === ReportTypes.Keyboard);
    const received = reports.flatMap(packet => {
      const count = packet.getUint8(14);
      expect(packet.byteLength).toBe(15 + count * 3);
      return Array.from({ length: count }, (_, i) => packet.getUint8(16 + i * 3) === 1);
    });
    expect(received).toEqual(presses);
    packets.length = 0;
    const controllerFrame = new Gamepad(0).getDefaultFamepadFrame();
    input.queueGamepadFrames(Array.from({ length: 300 }, () => controllerFrame), true);
    expect(packets.reduce((total, packet) => {
      expect(packet.getUint16(0, true)).toBe(ReportTypes.Gamepad);
      const count = packet.getUint8(14);
      expect(packet.byteLength).toBe(15 + count * 23);
      return total + count;
    }, 0)).toBe(300);
    packets.length = 0;
    const target = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 100 }) };
    input.queuePointerFrame({ events: Array.from({ length: 300 }, () =>
      ({ type: 'pointermove', x: 50, y: 20, pressure: 1, twist: 0, target })) });
    await vi.advanceTimersByTimeAsync(16);
    expect(packets.reduce((total, packet) => {
      expect(packet.getUint16(0, true)).toBe(ReportTypes.Pointer);
      expect(packet.getUint8(14)).toBe(1);
      const count = packet.getUint8(15);
      expect(packet.byteLength).toBe(16 + count * 20);
      return total + count;
    }, 0)).toBe(300);
    const sent = packets.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(packets).toHaveLength(sent);
  } finally {
    player.destroy();
  }
});

describe('xHome browser negotiation using the published player', () => {
  it('exchanges SDP/ICE and releases the peer, keepalive and upstream session', async () => {
    vi.useFakeTimers();
    const log: string[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      log.push(init.method + ' ' + url);
      if (url === '/api/stream/session') return Response.json({ sessionId: 'stream' });
      if (url.endsWith('/state')) return Response.json({ state: 'Provisioned' });
      if (url.endsWith('/sdp') && init.method === 'GET') return Response.json({ sdp: 'answer-sdp' });
      if (url.endsWith('/ice') && init.method === 'GET') return Response.json({ candidates: [{ candidate: 'candidate:2 1 UDP 1 192.0.2.2 9002 typ host' }] });
      return Response.json({ accepted: true });
    });
    const states: StreamState[] = [];
    const client = new RemotePlayClient('media', state => states.push(state));
    await client.connect('console');
    expect(states).toEqual(['provisioning', 'negotiating', 'connected']);
    expect(Peer.latest.setRemoteDescription).toHaveBeenCalledWith({ type: 'answer', sdp: 'answer-sdp' });
    expect([...Peer.latest.channels.keys()]).toEqual(['chat', 'control', 'input', 'message']);
    const collectStats = vi.spyOn(Peer.latest, 'getStats');
    await vi.advanceTimersByTimeAsync(3000);
    expect(collectStats).not.toHaveBeenCalled();
    expect(await client.stats()).toEqual({ rttMs: 23 });
    expect(collectStats).toHaveBeenCalledOnce();
    await client.disconnect();
    expect(Peer.latest.close).toHaveBeenCalledOnce();
    expect(states.at(-1)).toBe('idle');
    expect(log.at(-1)).toBe('DELETE /api/stream/session/stream');
  });
  it('tears down the session when the provisioning service fails', async () => {
    const fetcher = vi.fn(async (url: string) => Response.json(url.endsWith('/state') ? { state: 'Failed' } : { sessionId: 'bad' }));
    vi.stubGlobal('fetch', fetcher);
    const client = new RemotePlayClient('media', () => {});
    await expect(client.connect('console')).rejects.toThrow('Failed');
    expect(client.getState()).toBe('failed');
    expect(fetcher).toHaveBeenCalledWith('/api/stream/session/bad', expect.objectContaining({ method: 'DELETE' }));
  });
  it('cleans up a creation reply received after a user disconnects', async () => {
    let complete!: (r: Response) => void;
    const fetcher = vi.fn((url: string) => url.endsWith('/session') ? new Promise<Response>(r => { complete = r; }) : Promise.resolve(Response.json({})));
    vi.stubGlobal('fetch', fetcher);
    const client = new RemotePlayClient('media', () => {});
    const connecting = client.connect('console');
    const disconnecting = client.disconnect();
    complete(Response.json({ sessionId: 'late' }));
    await Promise.all([connecting, disconnecting]);
    expect(fetcher).toHaveBeenLastCalledWith('/api/stream/session/late', expect.objectContaining({ method: 'DELETE' }));
    expect(client.getState()).toBe('idle');
  });
  it('retries a failed upstream release when the user disconnects again', async () => {
    let releases = 0;
    let complete!: (r: Response) => void;
    vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
      if (url.endsWith('/session')) return new Promise<Response>(r => { complete = r; });
      if (init.method === 'DELETE') releases++;
      return Promise.resolve(Response.json({}, { status: releases === 1 ? 503 : 200 }));
    });
    const client = new RemotePlayClient('media', () => {});
    const connecting = client.connect('console');
    const first = client.disconnect();
    complete(Response.json({ sessionId: 'retry' }));
    await connecting;
    await expect(first).rejects.toThrow();
    await Promise.all([client.disconnect(), client.disconnect()]);
    await client.disconnect();
    expect(releases).toBe(2);
  });
});

it('maps actual upstream input frames across unplug/replug, including swap, trigger, d-pad and axis deadzone', () => {
  const pad = new Gamepad(0, gamepadOptions({ deadzone: 0.2, swapAB: true }));
  const player = new Player('media');
  pad.attach(player);
  const physical = { index: 1, axes: [0.1, 0.6, 0, 0], buttons: Array.from({ length: 16 }, () => ({ value: 0 })) };
  physical.buttons[1].value = 1; physical.buttons[7].value = 0.5; physical.buttons[12].value = 1;
  pads = [null, physical];
  window.dispatchEvent(Object.assign(new Event('gamepadconnected'), { gamepad: physical }));
  expect(pad.getGamepadState()).toMatchObject({ A: 1, B: 0, RightTrigger: 0.5, DPadUp: 1, LeftThumbXAxis: 0, Nexus: 0 });
  expect(pad.getGamepadState()?.LeftThumbYAxis).toBeCloseTo(0.5);
  pads = [];
  window.dispatchEvent(Object.assign(new Event('gamepaddisconnected'), { gamepad: physical }));
  expect(pad.getGamepadState()).toBeUndefined();
  pads = [null, physical];
  window.dispatchEvent(Object.assign(new Event('gamepadconnected'), { gamepad: physical }));
  expect(pad.getPhysicalGamepadId()).toBe(1);
  pad.detach();
  expect(pad.getPhysicalGamepadId()).toBe(-1);
  player.destroy();
});
