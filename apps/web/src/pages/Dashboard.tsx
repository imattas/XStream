import { useEffect, useState } from 'react'
import type { ConsoleInfo } from '../streaming/client'
import { api, Link, Loader, message } from '../components/ui'

function ConsoleCard({ console: device }: { console: ConsoleInfo }) {
  const state = device.powerState || 'Unknown'
  const offline = ['off', 'offline', 'disconnected'].includes(state.toLowerCase())
  const status = state === 'On' ? 'Powered on' : state === 'ConnectedStandby' ? 'Standby' : state
  return <article className="card console-card">
    <div className="console-title"><h2>{device.deviceName || 'Xbox console'}</h2><span className={'status ' + (!offline && state === 'On' ? 'online' : '')}>{status}</span></div>
    <img className="console-photo" src="/images/console.png" width="200" height="56" alt="" />
    <p className="device-model">{device.consoleType || 'Xbox'} · <span>{device.serverId}</span></p>
    {device.wirelessWarning && <p>For a more stable stream, connect your Xbox with Ethernet.</p>}
    {device.outOfHomeWarning && <p>Your console may be unavailable outside your home network.</p>}
    {offline ? <button disabled>Console offline</button> :
      <Link className="button primary" streamName={device.deviceName} href={'/stream/' + encodeURIComponent(device.serverId)}>Start stream</Link>}
  </article>
}

export default function Dashboard() {
  const [devices, setDevices] = useState<ConsoleInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    const abort = new AbortController()
    void api<{ consoles: ConsoleInfo[] }>('/api/consoles', { signal: abort.signal })
      .then(result => { if (!abort.signal.aborted) setDevices(result.consoles) })
      .catch(reason => { if (!abort.signal.aborted) setError(message(reason)) })
      .finally(() => { if (!abort.signal.aborted) setLoading(false) })
    return () => abort.abort()
  }, [])
  return <main className="workspace" id="main">
    <div className="page-title"><h1>My Consoles</h1></div>
    {loading ? <Loader>Finding your consoles…</Loader> : error ? <div className="card" role="alert"><h2>Couldn’t load consoles</h2><p>{error}</p></div> :
      devices.length ? <div className="console-grid">{devices.map(device => <ConsoleCard key={device.serverId} console={device} />)}</div> :
      <div className="card empty"><img src="/images/console.png" alt="" width="200" height="56" /><h2>No consoles found</h2><p>Enable remote features on your Xbox, then check that the console appears in the Xbox app with this Microsoft account.</p></div>}
  </main>
}
