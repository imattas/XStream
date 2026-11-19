import Player from 'xbox-xcloud-player/dist/player';
import Gamepad from 'xbox-xcloud-player/dist/input/gamepad';

import { enableSystemKeyboard, type KeyboardPrompt } from './systemKeyboard';
import { readGamepads } from '../controllers/useControllers';
import type { InputMode } from '../../../../input-modes';
import type { StreamMode } from '../../../../stream-mode';

export interface StreamOptions { onKeyboard?: (prompt?: KeyboardPrompt) => void; onInputsReady?: (inputs: InputMode[], player: Player) => void; bitrateKbps?: number; deadzone?: number; swapAB?: boolean; relay?: boolean }
export interface StreamStats { rttMs?: number; width?: number; height?: number; fps?: number; videoMbps?: number }
export interface ConsoleInfo {
  serverId: string; deviceName: string; powerState: string; consoleType: string;
  wirelessWarning: boolean; outOfHomeWarning: boolean;
}
export type StreamState = 'idle'|'provisioning'|'negotiating'|'connected'|'disconnected'|'failed';

export function peerFailureDetail(iceState: RTCIceConnectionState, relay: boolean) {
  const hint = relay ? 'TLS relay is on; check that TURN over TLS on TCP 443 is reachable.' : 'TLS relay is off; try enabling it in Streaming settings if configured.';
  return 'The Xbox peer connection ended (ICE: ' + iceState + '). ' + hint;
}

export function gamepadOptions(options: StreamOptions) {
  return {
    enable_keyboard: false, enable_vibration: false,
    gamepad_deadzone: Math.max(0, Math.min(0.95, options.deadzone ?? 0.2)),
    gamepad_mapping: {
      A: options.swapAB ? '1' : '0', B: options.swapAB ? '0' : '1', X: '2', Y: '3',
      LeftShoulder: '4', RightShoulder: '5', LeftTrigger: '6', RightTrigger: '7',
      View: '8', Menu: '9', LeftThumb: '10', RightThumb: '11',
      DPadUp: '12', DPadDown: '13', DPadLeft: '14', DPadRight: '15', Nexus: '16'
    }
  };
}

async function request<T>(path: string, method: string, signal?: AbortSignal, data?: unknown): Promise<T> {
  const timeout = AbortSignal.timeout(method === 'POST' && path.endsWith('/session') ? 90000 : 20000);
  const response = await fetch(path, {
    method, credentials: 'same-origin', keepalive: method === 'DELETE', signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    headers: data === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: data === undefined ? undefined : JSON.stringify(data)
  });
  const reply = await response.json().catch(() => ({}));
  if (method === 'DELETE' && response.status === 404) return reply as T;
  if (!response.ok) {
    if (response.status === 401 && reply?.code === 'session_expired') window.dispatchEvent(new Event('xstream-session-expired'));
    throw new Error(typeof reply.error === 'string' ? reply.error : reply.message ?? 'Remote Play request failed.');
  }
  return reply as T;
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}

interface Attempt {
  base: string;
  abort: AbortController;
  path?: string;
  creation?: Promise<{sessionId: string; inputs?: InputMode[]}>;
  player?: Player;
  connectTimeout?: ReturnType<typeof setTimeout>;
  lossTimeout?: ReturnType<typeof setTimeout>;
  heartbeat?: ReturnType<typeof setTimeout>;
  previousVideo?: { id: string; bytes: number; timestamp: number };
}

// Retain an opaque handle across route changes if an upstream disconnect needs retrying.
const pendingReleases = new Map<string, Promise<void> | undefined>();
function release(path: string) {
  const pending = pendingReleases.get(path);
  if (pending) return pending;
  const cleanup = request(path, 'DELETE').then(() => {
    pendingReleases.delete(path);
  }, error => {
    pendingReleases.set(path, undefined);
    throw error;
  });
  pendingReleases.set(path, cleanup);
  return cleanup;
}

export class RemotePlayClient {
  private active?: Attempt;
  private closing?: Promise<void>;
  private releasePath?: string;
  private generation = 0;
  private state: StreamState = 'idle';
  constructor(private holderId: string, private onState: (state: StreamState, detail?: string) => void,
    private options: StreamOptions = {}) {}

  getState() { return this.state; }
  private update(state: StreamState, detail?: string) {
    this.state = state;
    this.onState(state, detail);
  }

  async connect(target: string, mode: StreamMode = 'xhome') {
    const generation = ++this.generation;
    if (this.active) await this.close(this.active);
    else if (this.closing) await this.closing;
    if (generation !== this.generation) return;
    const attempt: Attempt = { abort: new AbortController(), base: mode === 'xcloud' ? '/api/cloud/session' : '/api/stream/session' };
    this.active = attempt;
    const signal = attempt.abort.signal;
    this.update('provisioning');
    let stage = 'XS-BROWSER';
    try {
      if (typeof RTCPeerConnection === 'undefined' || typeof HTMLVideoElement.prototype.requestVideoFrameCallback !== 'function' ||
          typeof RTCRtpTransceiver === 'undefined' || typeof RTCRtpTransceiver.prototype.setCodecPreferences !== 'function') {
        throw new Error('This browser lacks the WebRTC video features required by the Xbox player.');
      }
      for (const path of pendingReleases.keys()) await release(path);
      signal.throwIfAborted();
      stage = 'XS-RELAY';
      const relay = this.options.relay ? await request<{iceServers: RTCIceServer[]}>('/api/turn', 'POST', signal) : undefined;
      stage = 'XS-SESSION';
      // Let creation finish after cancellation so a late-created server session can still be released.
      attempt.creation = request<{sessionId: string; inputs?: InputMode[]}>(attempt.base, 'POST', undefined, {
        ...(mode === 'xcloud' ? { titleId: target } : { serverId: target }), locale: navigator.language, timezoneOffsetMinutes: new Date().getTimezoneOffset()
      });
      const { sessionId, inputs } = await attempt.creation;
      if (signal.aborted) return;
      attempt.path = attempt.base + '/' + encodeURIComponent(sessionId);
      const resetTimeout = () => {
        clearTimeout(attempt.connectTimeout);
        attempt.connectTimeout = setTimeout(() => this.fail(attempt, 'Timed out waiting for Xbox or WebRTC. Check your network and try again.', 'XS-TIMEOUT'), 90000);
      };
      resetTimeout();
      stage = 'XS-PROVISION';
      let transferred = false;
      let queuedAt: number | undefined;
      let estimate: number | null = null;
      for (;;) {
        const { state } = await request<{state: string}>(attempt.path + '/state', 'GET', signal);
        if (state !== 'WaitingForResources' && queuedAt !== undefined) {
          queuedAt = undefined;
          this.update('provisioning');
          resetTimeout();
        }
        if (state === 'Provisioned') break;
        if (state === 'WaitingForResources' && mode === 'xcloud') {
          if (queuedAt === undefined) {
            queuedAt = Date.now();
            const reply = await request<{ seconds: number | null }>('/api/cloud/waittime?titleId=' + encodeURIComponent(target), 'GET', signal).catch(() => null);
            signal.throwIfAborted();
            estimate = reply?.seconds ?? null;
          }
          const elapsed = Math.floor((Date.now() - queuedAt) / 1000);
          const elapsedText = Math.floor(elapsed / 60) + ':' + String(elapsed % 60).padStart(2, '0');
          const remaining = estimate === null ? null : Math.ceil((estimate - elapsed) / 60);
          const timing = remaining !== null && remaining > 0 ? 'About ' + remaining + ' min remaining.' : 'Waiting for Xbox to assign a server.';
          this.update('provisioning', 'In the Xbox queue · ' + elapsedText + ' elapsed. ' + timing);
          resetTimeout();
          await sleep(5000, signal);
          continue;
        }
        if (state === 'ReadyToConnect' && !transferred) {
          await request(attempt.path + '/connect', 'POST', signal);
          transferred = true;
          continue;
        } else if (!['New', 'Provisioning', 'ReadyToConnect', 'WaitingForResources'].includes(state)) {
          throw new Error('Xbox could not provision the stream (' + state + ').');
        }
        await sleep(750, signal);
      }
      signal.throwIfAborted();
      this.update('negotiating');
      stage = 'XS-SIGNAL';
      const player = new Player(this.holderId, { video_bitrate: this.options.bitrateKbps ?? 0 });
      attempt.player = player;
      if (relay) player._peerConnection.setConfiguration({ iceServers: relay.iceServers, iceTransportPolicy: 'relay' });
      if (this.options.onKeyboard) enableSystemKeyboard(player, this.options.onKeyboard);
      const input = player._channels.input;
      const startInput = input.start.bind(input);
      // The player's message handshake resets controller slot zero immediately before starting input.
      input.start = () => {
        startInput();
        const modes: InputMode[] = inputs ?? ['controller', 'overlay'];
        if (readGamepads()) {
          new Gamepad(0, gamepadOptions(this.options)).attach(player);
          this.options.onInputsReady?.(modes, player);
        } else {
          player._channels.control.sendGamepadState(0, true);
          this.options.onInputsReady?.(modes.filter(mode => mode !== 'controller'), player);
        }
      };
      player.onConnectionStateChange((state) => {
        if (this.active !== attempt) return;
        if (state === 'connected') {
          clearTimeout(attempt.connectTimeout);
          clearTimeout(attempt.lossTimeout);
          this.update('connected');
        } else if (state === 'disconnected') {
          this.update('disconnected', 'Waiting for the network to recover…');
          clearTimeout(attempt.lossTimeout);
          attempt.lossTimeout = setTimeout(() => this.fail(attempt, 'The peer connection was interrupted.', 'XS-CONNECTION'), 10000);
        } else if (state === 'failed' || state === 'closed') {
          this.fail(attempt, peerFailureDetail(player._peerConnection.iceConnectionState, this.options.relay === true), 'XS-CONNECTION');
        }
      });
      const offer = await player.createOffer();
      await request(attempt.path + '/sdp', 'POST', signal, { sdp: offer.sdp });
      const answer = await this.exchange<{sdp: string}>(attempt.path + '/sdp', signal);
      await player.setRemoteOffer(answer.sdp);
      // The service exchanges a complete batch of ICE candidates rather than trickle ICE.
      stage = 'XS-ICE';
      const deadline = Date.now() + (relay ? 15000 : 5000);
      while (player._peerConnection.iceGatheringState !== 'complete' && Date.now() < deadline) await sleep(100, signal);
      const candidates = player.getIceCandidates().map(c => c.toJSON());
      if (!candidates.length) throw new Error('The browser gathered no ICE candidates.');
      await request(attempt.path + '/ice', 'POST', signal, { candidates });
      const remote = await this.exchange<{candidates: RTCIceCandidateInit[]}>(attempt.path + '/ice', signal);
      await player.setRemoteIceCandidates(remote.candidates);
      signal.throwIfAborted();
      this.keepalive(attempt);
    } catch (err) {
      if (!signal.aborted) {
        this.fail(attempt, err instanceof Error ? err.message : 'Could not connect to Xbox.', stage);
        throw err;
      }
    }
  }

  private async exchange<T>(path: string, signal: AbortSignal) {
    for (;;) {
      const reply = await request<T & {pending?: true}>(path, 'GET', signal);
      if (!reply.pending) return reply;
      await sleep(500, signal);
    }
  }
  private keepalive(attempt: Attempt) {
    attempt.heartbeat = setTimeout(async () => {
      try {
        await request(attempt.path + '/keepalive', 'POST', attempt.abort.signal);
        if (this.active === attempt) this.keepalive(attempt);
      } catch (err) {
        this.fail(attempt, err instanceof Error ? err.message : 'Xbox keepalive failed.', 'XS-KEEPALIVE');
      }
    }, 30000);
  }
  private fail(attempt: Attempt, detail: string, code: string) {
    if (this.active !== attempt) return;
    this.update('failed', '[' + code + '] ' + detail);
    void this.close(attempt).catch(() => undefined);
  }
  private close(attempt: Attempt) {
    const closing = this.dispose(attempt).finally(() => {
      if (this.closing === closing) this.closing = undefined;
    });
    this.closing = closing;
    return closing;
  }
  private async dispose(attempt: Attempt) {
    this.active = undefined;
    attempt.abort.abort();
    clearTimeout(attempt.connectTimeout);
    clearTimeout(attempt.lossTimeout);
    clearTimeout(attempt.heartbeat);
    const player = attempt.player;
    if (player) {
      player._peerConnection.onconnectionstatechange = null;
      for (const receiver of player._peerConnection.getReceivers()) receiver.track?.stop();
      for (const sender of player._peerConnection.getSenders()) sender.track?.stop();
      const audio = player.getAudioElement();
      if (audio) { audio.pause(); audio.srcObject = null; }
      player.destroy();
    }
    let path = attempt.path;
    if (!path && attempt.creation) {
      const created = await attempt.creation.catch(() => undefined);
      if (created) path = attempt.base + '/' + encodeURIComponent(created.sessionId);
    }
    if (path) {
      this.releasePath = path;
      await release(path);
    }
  }
  async disconnect() {
    this.generation++;
    this.update('idle');
    if (this.active) await this.close(this.active);
    else if (this.closing) await this.closing;
    else if (this.releasePath && pendingReleases.has(this.releasePath)) await release(this.releasePath);
  }
  async stats(): Promise<StreamStats> {
    const result: StreamStats = {};
    const attempt = this.active;
    if (!attempt?.player) return result;
    const report = await attempt.player._peerConnection.getStats();
    report.forEach(row => {
      if (row.type === 'inbound-rtp' && (row.kind === 'video' || row.mediaType === 'video')) {
        result.width = row.frameWidth; result.height = row.frameHeight; result.fps = row.framesPerSecond;
        if (Number.isFinite(row.bytesReceived) && Number.isFinite(row.timestamp)) {
          const previous = attempt.previousVideo;
          if (previous && previous.id === row.id && row.timestamp > previous.timestamp && row.bytesReceived >= previous.bytes) {
            result.videoMbps = (row.bytesReceived - previous.bytes) * 8 / ((row.timestamp - previous.timestamp) * 1000);
          }
          attempt.previousVideo = { id: row.id, bytes: row.bytesReceived, timestamp: row.timestamp };
        }
      }
      if (row.type === 'candidate-pair' && row.state === 'succeeded' && row.nominated && typeof row.currentRoundTripTime === 'number') {
        result.rttMs = Math.round(row.currentRoundTripTime * 1000);
      }
    });
    return result;
  }
}
