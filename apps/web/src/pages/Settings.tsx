import { inputLabels } from '../../../../input-modes'
import { useState } from 'react'
import type { Controller } from '../controllers/useControllers'
import type { Fit, Preferences } from '../settings/preferences'
import { PadGroups, padStyle } from '../components/PadGroups'
import { Link, message } from '../components/ui'

interface Props {
  profile?: { picture?: string; gamerscore?: number; tenure?: number }
  tab: string
  name: string
  controllers: Controller[]
  preferences: Preferences
  update: (changes: Partial<Preferences>) => void
  storageError: boolean
  logout: () => Promise<void>
}
const sections = [{ id: 'home', name: 'Account' }, { id: 'general', name: 'General' }, { id: 'appearance', name: 'Appearance' }, { id: 'streaming', name: 'Streaming' }, { id: 'input', name: 'Input' }]

export default function Settings({ tab, name, profile, controllers, preferences, update, storageError, logout }: Props) {
  const [group, setGroup] = useState(0)
  const [copyStatus, setCopyStatus] = useState('')
  const [badPicture, setBadPicture] = useState<string>()
  const [loggingOut, setLoggingOut] = useState(false)
  const [error, setError] = useState('')
  return <main id="main" className="workspace">
    <div className="page-title"><h1>Settings</h1></div>
    <div className="settings-layout">
      <nav className="settings-menu" aria-label="Settings">{sections.map(section =>
        <Link key={section.id} aria-current={tab === section.id ? 'page' : undefined} href={'/settings/' + section.id}>{section.name}</Link>
      )}</nav>
      <div className="settings-content">
        {tab === 'home' && <><section className="card account-card"><div className="account-hero">
          <span className="account-avatar">{profile?.picture && profile.picture !== badPicture ? <img src={profile.picture} alt="" onError={() => setBadPicture(profile.picture)} /> : name.slice(0,1).toUpperCase()}</span>
          <div><h2>{name}</h2><p>Xbox profile</p></div>
        </div><div className="account-body">
          <dl className="account-metrics"><div><dt>Gamerscore</dt><dd>{profile?.gamerscore?.toLocaleString() ?? 'Unavailable'}</dd></div>
            <div><dt>Xbox Live tenure</dt><dd>{profile?.tenure == null ? 'Unavailable' : profile.tenure + (profile.tenure === 1 ? ' year' : ' years')}</dd></div></dl>
          {profile && <button onClick={async () => { try { await navigator.clipboard.writeText(name); setCopyStatus('Gamertag copied') } catch { setCopyStatus('Select your gamertag above to copy it.') } }}>Copy gamertag</button>}
          {copyStatus && <p role="status">{copyStatus}</p>}
        </div></section>
        <section className="card"><h2>Account management</h2>
          <div className="field"><span>Game Pass membership</span><a className="button" href="https://account.microsoft.com/services" target="_blank" rel="noreferrer">Manage subscriptions ↗</a></div>
          <div className="field"><span>Cloud hours remaining<small>Balance unavailable in XStream</small></span><a className="button" href="https://www.xbox.com/play" target="_blank" rel="noreferrer">Open Xbox ↗</a></div>
          <div className="field"><span>Session on this device</span>
          <button disabled={loggingOut} onClick={async () => {
            setLoggingOut(true)
            try { await logout() } catch (reason) { setError(message(reason)); setLoggingOut(false) }
          }}>{loggingOut ? 'Signing out…' : 'Sign out'}</button></div>
          {error && <p role="alert">{error}</p>}
        </section></>}
        {tab === 'streaming' && <><section className="card"><h2>Streaming</h2>
          <label className="field">Video size<select value={preferences.fit} onChange={e => update({ fit: e.target.value as Fit })}>
            <option value="contain">Fit to screen</option><option value="cover">Zoom to fill</option><option value="fill">Stretch</option>
          </select></label>
          <label className="field">Maximum video bitrate<select value={preferences.bitrateKbps} onChange={e => update({ bitrateKbps: Number(e.target.value) })}>
            {[0, 5000, 10000, 20000, 30000, 50000].map(rate => <option key={rate} value={rate}>{rate === 0 ? 'Automatic' : rate / 1000 + ' Mbps'}</option>)}
          </select></label>
          <label className="field">Show statistics when a stream starts<input type="checkbox" checked={preferences.startStats} onChange={e => update({ startStats: e.target.checked })} /></label>
          <label className="field"><span>Reconnect after an interruption</span><input type="checkbox" checked={preferences.autoReconnect} onChange={e => update({ autoReconnect: e.target.checked })} /></label>
        </section>
        </>}
        {tab === 'general' && <section className="card"><h2>General</h2>
          <label className="field">Start page<select value={preferences.startPage} onChange={e => update({ startPage: e.target.value === 'cloud' ? 'cloud' : 'home' })}>
            <option value="home">My Consoles</option><option value="cloud">Cloud Gaming</option>
          </select></label>
          <label className="field">Default game order<select value={preferences.catalogSort} onChange={e => update({ catalogSort: e.target.value as Preferences['catalogSort'] })}>
            <option value="recommended">Catalog order / relevance</option><option value="az">Name A–Z</option><option value="za">Name Z–A</option><option value="last">Last played</option>
          </select></label>
        </section>}
        {tab === 'appearance' && <section className="card"><h2>Appearance</h2>
          <fieldset className="background-choices"><legend>Background</legend>
            {(['classic', 'aurora', 'midnight'] as const).map(bg => <label key={bg}><span className={'backdrop-sample bg-' + bg} /><span>
              <input type="radio" name="background" checked={preferences.background === bg} onChange={() => update({ background: bg })} />{bg[0].toUpperCase() + bg.slice(1)}</span></label>)}
          </fieldset>
          <label className="field">Accent color<select value={preferences.accent} onChange={e => update({ accent: e.target.value as Preferences['accent'] })}>
            <option value="green">Xbox green</option><option value="blue">Ocean blue</option><option value="violet">Violet</option>
          </select></label>
        </section>}
        {tab === 'input' && <>
          <section className="card"><h2>Controller configuration</h2>
            <label className="field"><span>Preferred input<small>Automatic uses native touch on supported touchscreens or the on-screen controller when no gamepad is connected.</small></span><select value={preferences.preferredInput} onChange={e => update({ preferredInput: e.target.value as Preferences['preferredInput'] })}>
              <option value="auto">Automatic</option>{Object.entries(inputLabels).map(([id,label]) => <option key={id} value={id}>{label}</option>)}
            </select></label>
            <label className="field"><span>Stick deadzone ({Math.round(preferences.deadzone * 100)}%)</span><input aria-label="Stick deadzone" type="range" min="0" max="40" value={Math.round(preferences.deadzone * 100)} onChange={e => update({ deadzone: Number(e.target.value) / 100 })} /></label>
            <label className="field"><span>Swap A and B buttons</span><input type="checkbox" checked={preferences.swapAB} onChange={e => update({ swapAB: e.target.checked })} /></label>
          </section>
          <section className="card"><h2>On-screen controller</h2><p>Drag the sticks and hold the buttons to play. On a keyboard, WASD moves, arrow keys aim, and J, K, U, I press A, B, X, Y.</p>
            <div className="pad-preview" aria-label="Controller layout preview"><div className="input-surface mode-overlay" data-mirrored={preferences.overlayMirrored} style={padStyle(preferences)}>
              <PadGroups preferences={preferences} /></div></div>
            <label className="field">Control size ({preferences.overlayScale}%)<input aria-label="Control size" type="range" min="75" max="115" step="5" value={preferences.overlayScale} onChange={e => update({ overlayScale: Number(e.target.value) })} /></label>
            <label className="field">Control opacity ({preferences.overlayOpacity}%)<input aria-label="Control opacity" type="range" min="35" max="100" step="5" value={preferences.overlayOpacity} onChange={e => update({ overlayOpacity: Number(e.target.value) })} /></label>
            <label className="field">Swap left and right control groups<input type="checkbox" checked={preferences.overlayMirrored} onChange={e => update({ overlayMirrored: e.target.checked })} /></label>
            <label className="field">Side inset ({preferences.overlayInset}%)<input type="range" aria-label="Side inset" min="0" max="8" value={preferences.overlayInset} onChange={e => update({ overlayInset: Number(e.target.value) })} /></label>
            <label className="field">Control group<select value={group} onChange={e => setGroup(Number(e.target.value))}>
              <option value="0">Directional controls</option><option value="1">Menu controls</option><option value="2">Action controls</option>
            </select></label>
            <label className="field">Height from bottom ({preferences.overlayLift[group]}%)<input type="range" aria-label="Height from bottom" min="0" max="30" value={preferences.overlayLift[group]} onChange={e => {
              const lift: Preferences['overlayLift'] = [...preferences.overlayLift]
              lift[group] = Number(e.target.value)
              update({ overlayLift: lift })
            }} /></label>
            <button className="reset-layout" onClick={() => update({ overlayLift: [2,2,2], overlayInset: 2, overlayScale: 100, overlayOpacity: 100, overlayMirrored: false })}>Reset controller layout</button>
          </section>
          <section className="card"><h2>Controllers detected</h2>
            {controllers.length ? <ul className="controllers">{controllers.map(pad => <li key={pad.index}><strong>{pad.name}</strong><span>{pad.axes} axes · {pad.buttons} buttons · {pad.mapping || 'Device-specific'} mapping</span></li>)}</ul> :
              <p>Connect a controller and press a button to make it visible to your browser.</p>}
          </section></>}
        {storageError && <p role="alert">Your browser could not save these settings. They apply until you close or reload this page.</p>}
      </div>
    </div>
  </main>
}
