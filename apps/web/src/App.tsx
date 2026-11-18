import { lazy, Suspense, useEffect, useState } from 'react'
import { api, Brand, Link, Loader, navigate } from './components/ui'
import Cloud from './pages/Cloud'
import Dashboard from './pages/Dashboard'
import DeviceLogin from './components/DeviceLogin'
import Settings from './pages/Settings'
import { notifySessionChange, useAppSession } from './auth/useAppSession'
import { usePreferences } from './settings/preferences'
import { useControllers } from './controllers/useControllers'

const Stream = lazy(() => import('./pages/Stream'))
export default function App() {
  const [failedPicture, setFailedPicture] = useState<string>()
  const [path, setPath] = useState(location.pathname)
  const { session, sessionError, authMessage, signedOut, retrySession } = useAppSession()
  const settings = usePreferences()
  useEffect(() => { document.documentElement.dataset.accent = settings.preferences.accent }, [settings.preferences.accent])
  useEffect(() => {
    function visited() { setPath(location.pathname) }
    window.addEventListener('popstate', visited)
    return () => window.removeEventListener('popstate', visited)
  }, [])
  const streamMatch = /^\/stream\/(cloud\/)?([^/]+)\/?$/.exec(path)
  const cloud = (path === '/' && settings.preferences.startPage === 'cloud') || /^\/cloud\/?$/.test(path)
  const mode = streamMatch?.[1] ? 'xcloud' : 'xhome'
  const tab = /^\/settings(?:\/(home|input|streaming|general|appearance))?\/?$/.exec(path)
  const controllers = useControllers(!!session?.authenticated && (!!streamMatch || tab?.[1] === 'input'))
  const home = !cloud && ['/', '/home', '/home/'].includes(path)
  const name = session?.user?.name || 'Account'
  const picture = session?.user?.picture
  const title = !session?.authenticated ? 'Xbox Remote Play' : streamMatch ? (mode === 'xcloud' ? 'Cloud Gaming' : 'Remote Play') : cloud ? 'Cloud Gaming' : tab ? 'Settings' : home ? 'My Consoles' : 'Page not found'
  useEffect(() => { document.title = 'XStream · ' + title }, [title])
  let consoleId = ''
  if (streamMatch) {
    try { consoleId = decodeURIComponent(streamMatch[2] ?? '') } catch { /* Invalid deep link */ }
  }
  if (session?.authenticated && consoleId) {
    return <Suspense fallback={<Loader>Loading player…</Loader>}>
      <Stream key={path + ':' + session.expiresAt} mode={mode} name={history.state?.streamName || consoleId} serverId={consoleId} preferences={settings.preferences} controllers={controllers} />
    </Suspense>
  }

  return <div data-background={settings.preferences.background} className={'shell' + (!session?.authenticated ? ' signed-out' : '')}>
    <a className="skip" href="#main">Skip to content</a>
    <header className="header"><Link className="brand-link" href="/home" aria-label="XStream home"><Brand /></Link>
      {session?.authenticated && <><nav aria-label="Main navigation">
        <Link href="/home" aria-current={home ? 'page' : undefined}>My Consoles</Link>
        <Link href="/cloud" aria-current={cloud ? 'page' : undefined}>Cloud Gaming</Link>
        <Link href="/settings/home" aria-current={tab ? 'page' : undefined}>Settings</Link>
      </nav><Link className="profile" href="/settings/home" aria-label={name + ' account settings'}>
        <span className="avatar" aria-hidden="true">{picture && picture !== failedPicture
          ? <img src={picture} alt="" referrerPolicy="no-referrer" onError={() => setFailedPicture(picture)} />
          : name.slice(0, 1).toUpperCase()}</span><span className="profile-name">{name}</span>
      </Link></>}
    </header>
    {!session ? <main id="main" className="center">
      {sessionError ? <section className="card" role="alert"><h1>Couldn’t reach XStream</h1><p>{sessionError}</p><button onClick={retrySession}>Try again</button></section> : <Loader>Checking your session…</Loader>}
    </main> : !session.authenticated ?
      <main id="main" className="login-layout">
        <section className="login-panel">
          {authMessage && <p className="error-message" role="alert">{authMessage}</p>}
          <DeviceLogin />
        </section>
      </main> : home ? <Dashboard key={session.expiresAt} /> : cloud ? <Cloud key={session.expiresAt} defaultSort={settings.preferences.catalogSort} /> : tab ? <Settings key={session.expiresAt} tab={tab[1] || 'home'} name={name} profile={session.user} controllers={controllers} {...settings} logout={async () => {
        await api('/api/auth/logout', { method: 'POST' })
        signedOut()
        notifySessionChange()
        navigate('/')
      }} /> : <main id="main" className="workspace"><h1>Page not found</h1><Link className="button" href="/home">My Consoles</Link></main>}
    <footer><span>XStream</span><a href="/THIRD-PARTY-NOTICES.txt">Open-source licenses</a></footer>
  </div>
}

