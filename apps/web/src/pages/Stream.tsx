import { useEffect, useId, useRef, useState } from 'react'
import { RemotePlayClient, type StreamState, type StreamStats } from '../streaming/client'
import type { Preferences } from '../settings/preferences'
import type { Controller } from '../controllers/useControllers'
import type Player from 'xbox-xcloud-player/dist/player'
import { inputLabels, type InputMode } from '../../../../input-modes'
import GameKeyboard from '../components/GameKeyboard'
import type { KeyboardPrompt } from '../streaming/systemKeyboard'
import StreamInput from '../streaming/StreamInput'
import { Loader, message, navigate } from '../components/ui'

const labels: Record<StreamState, string> = {
  idle: 'Starting session', provisioning: 'Preparing your Xbox', negotiating: 'Connecting to your Xbox',
  connected: 'Connected', disconnected: 'Connection interrupted', failed: 'Connection failed',
}

import type { StreamMode } from '../../../../stream-mode'

let closingSession: Promise<void> = Promise.resolve()

export default function Stream({ serverId, mode, name, preferences, controllers }: {
  serverId: string; mode: StreamMode; name: string; preferences: Preferences; controllers: Controller[]
}) {
  const [state, setState] = useState<StreamState>('idle')
  const [detail, setDetail] = useState('')
  const [notice, setNotice] = useState('')
  const [stats, setStats] = useState<StreamStats>({})
  const [diagnostics, setDiagnostics] = useState(preferences.startStats)
  const [controls, setControls] = useState(true)
  const [fullscreen, setFullscreen] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [inputs, setInputs] = useState<{ modes: InputMode[]; player: Player }>()
  const [chosenInput, setChosenInput] = useState<InputMode>()
  const automaticInput = navigator.maxTouchPoints && inputs?.modes.includes('touch') ? 'touch' : controllers.length ? 'controller' : 'overlay'
  const preferred = preferences.preferredInput
  const inputMode = chosenInput ?? (preferred !== 'auto' && inputs?.modes.includes(preferred) ? preferred : automaticInput)
  const [keyboard, setKeyboard] = useState<KeyboardPrompt>()
  const [closing, setClosing] = useState(false)
  const holder = 'remote-media-' + useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const screen = useRef<HTMLElement>(null)
  const client = useRef<RemotePlayClient | null>(null)
  const automaticRetryUsed = useRef(false)
  const manualAction = useRef(false)
  const modeLabel = mode === 'xcloud' ? 'Cloud Gaming' : 'Remote Play'

  useEffect(() => {
    let active = true
    let instance: RemotePlayClient | undefined
    let hadConnection = false
    let retry: number | undefined
    setKeyboard(undefined)
    setInputs(undefined)
    setState('idle')
    setDetail('')
    setStats({})
    setNotice('')
    setClosing(false)
    manualAction.current = false

    function changed(next: StreamState, reason?: string) {
      if (!active || manualAction.current) return
      window.clearTimeout(retry)
      setState(next)
      setDetail(reason ?? '')
      if (next === 'connected') hadConnection = true
      const interrupted = next === 'disconnected' || next === 'failed'
      if (interrupted) setControls(true)
      if (interrupted && hadConnection && preferences.autoReconnect && !automaticRetryUsed.current) {
        setNotice('Attempting to reconnect in three seconds…')
        retry = window.setTimeout(() => {
          if (!active || manualAction.current) return
          automaticRetryUsed.current = true
          setAttempt(n => n + 1)
        }, 3000)
      } else if (next === 'connected') setNotice('')
    }
    async function start() {
      try {
        await closingSession
        if (!active) return
        instance = new RemotePlayClient(holder, changed, {
          onKeyboard(prompt) { if (active) setKeyboard(prompt) },
          onInputsReady(modes, player) {
            if (!active) return
            setInputs({ modes, player })
            setChosenInput(undefined)
          },
          relay: preferences.relay, bitrateKbps: preferences.bitrateKbps, deadzone: preferences.deadzone, swapAB: preferences.swapAB,
        })
        client.current = instance
        await instance.connect(serverId, mode)
      } catch (reason) {
        if (instance?.getState() !== 'failed') changed('failed', message(reason))
      }
    }
    function close() {
      active = false
      window.clearTimeout(retry)
      if (instance) {
        closingSession = Promise.resolve(instance.disconnect()).catch(() => undefined)
        instance = undefined
      }
      client.current = null
    }
    void start()
    function restore(event: PageTransitionEvent) {
      if (event.persisted) setAttempt(n => n + 1)
    }
    window.addEventListener('pagehide', close)
    window.addEventListener('pageshow', restore)
    return () => {
      window.removeEventListener('pagehide', close)
      window.removeEventListener('pageshow', restore)
      close()
    }
  }, [holder, attempt, serverId, mode, preferences])

  useEffect(() => {
    if (!diagnostics || state !== 'connected') return
    let active = true
    let sampling = false
    let timer: number | undefined
    async function refresh() {
      window.clearTimeout(timer)
      if (document.hidden || sampling) return
      sampling = true
      try {
        const sample = await client.current?.stats()
        if (active && sample) setStats(sample)
      } catch { if (active) setStats({}) }
      finally {
        sampling = false
        if (active && !document.hidden) timer = window.setTimeout(refresh, 2000)
      }
    }
    void refresh()
    document.addEventListener('visibilitychange', refresh)
    return () => {
      active = false
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [diagnostics, state])

  useEffect(() => {
    function changed() { setFullscreen(!!document.fullscreenElement) }
    function escape(event: KeyboardEvent) { if (event.key === 'Escape') setControls(true) }
    document.addEventListener('fullscreenchange', changed)
    window.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('fullscreenchange', changed)
      window.removeEventListener('keydown', escape)
    }
  }, [])

  async function leave() {
    if (manualAction.current) return
    manualAction.current = true
    setClosing(true)
    try {
      await client.current?.disconnect()
      navigate(mode === 'xcloud' ? '/cloud' : '/home')
    } catch (reason) {
      manualAction.current = false
      setClosing(false)
      setState('failed')
      setDetail(message(reason))
    }
  }

  async function playMedia() {
    try {
      const media = Array.from(screen.current?.querySelectorAll<HTMLMediaElement>('audio,video') ?? [])
      await Promise.all(media.map(element => element.play()))
      setNotice('')
    } catch (reason) { setNotice(message(reason)) }
  }

  const stateLabel = mode === 'xcloud' && state === 'provisioning' ? 'Preparing your cloud game' :
    mode === 'xcloud' && state === 'negotiating' ? 'Connecting to your cloud game' : labels[state]
  const ended = state === 'failed' || state === 'disconnected'
  return <main ref={screen} className={'stream-screen size-' + preferences.fit} id="main">
    <div className="media-holder" id={holder} />
    {keyboard && state === 'connected' && <GameKeyboard key={keyboard.id} prompt={keyboard} player={inputs?.player} />}
    {!keyboard && inputs && state === 'connected' && inputMode !== 'controller' && <StreamInput key={inputMode} player={inputs.player} mode={inputMode} preferences={preferences} />}
    {controls ? <div className="gamebar" role="toolbar" aria-label="Stream controls">
      <span>{modeLabel} · {name}</span>
      <span className={'status ' + (state === 'connected' ? 'online' : '')}>{stateLabel}</span>
      <span className="pad-status">{controllers.length ? 'Controller connected' : 'No controller'}</span>
      {inputs && state === 'connected' && <select aria-label="Stream input" value={inputMode} onChange={e => setChosenInput(e.target.value as InputMode)}>
        {inputs.modes.map(item => <option key={item} value={item}>{inputLabels[item]}</option>)}
      </select>}
      <button onClick={() => setDiagnostics(!diagnostics)} aria-pressed={diagnostics}>Statistics</button>
      {document.fullscreenEnabled && <button onClick={async () => {
        try {
          if (document.fullscreenElement) await document.exitFullscreen()
          else await screen.current?.requestFullscreen()
        } catch (reason) { setNotice(message(reason)) }
      }}>{fullscreen ? 'Exit fullscreen' : 'Fullscreen'}</button>}
      {state === 'connected' && <><button onClick={() => void playMedia()}>Resume playback</button><button onClick={() => setControls(false)}>Hide controls</button></>}
      <button className="leave" disabled={closing} onClick={() => void leave()}>{closing ? 'Disconnecting…' : 'Disconnect'}</button>
    </div> : <button className="show-controls" onClick={() => setControls(true)}>Show controls</button>}
    {state !== 'connected' && <section className="stream-state">
      {ended ? <><h1>{stateLabel}</h1>{detail && <p role="alert">{detail}</p>}
        <button className="primary" disabled={closing} onClick={() => { automaticRetryUsed.current = false; setAttempt(n => n + 1) }}>Reconnect</button></> :
        <Loader>{detail || stateLabel + '…'}</Loader>}
    </section>}
    {notice && <p role="status" className="stream-notice">{notice}</p>}
    {diagnostics && <aside className="stats" aria-label="Stream statistics"><h2>Stream statistics</h2>
      <dl><dt>Resolution</dt><dd>{stats.width && stats.height ? stats.width + ' × ' + stats.height : '—'}</dd>
        <dt>Frame rate</dt><dd>{stats.fps != null ? Math.round(stats.fps) + ' fps' : '—'}</dd>
        <dt>Received video bitrate</dt><dd>{stats.videoMbps != null ? stats.videoMbps.toFixed(2) + ' Mbps' : '—'}</dd>
        <dt>Round-trip latency</dt><dd>{stats.rttMs != null ? Math.round(stats.rttMs) + ' ms' : '—'}</dd></dl>
    </aside>}
  </main>
}
