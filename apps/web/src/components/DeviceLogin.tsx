import { useEffect, useState } from 'react'
import { notifySessionChange } from '../auth/useAppSession'
import { api, message } from './ui'

interface Pairing { id: string; code: string; uri: string; interval: number; expiresAt: number }

export default function DeviceLogin() {
  const [pair, setPair] = useState<Pairing>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!pair) return
    const { id, interval } = pair
    const abort = new AbortController()
    const clock = window.setInterval(() => {
      const time = Date.now()
      setNow(time)
      if (time >= pair.expiresAt) {
        abort.abort()
        setError('Your pairing code expired. Request a new one.')
        setPair(undefined)
      }
    }, 500)
    let timer = window.setTimeout(poll, pair.interval * 1000)
    async function poll() {
      try {
        const reply = await api<{ authenticated?: boolean; interval: number }>('/api/auth/device/poll',
          { method: 'POST', headers: { 'X-Pairing-Id': id }, signal: abort.signal })
        if (abort.signal.aborted) return
        setError('')
        if (reply.authenticated) { notifySessionChange(); location.reload() }
        else timer = window.setTimeout(poll, reply.interval * 1000)
      } catch (reason) {
        if (abort.signal.aborted) return
        if (reason instanceof TypeError) {
          setError('Connection interrupted. Waiting to retry…')
          timer = window.setTimeout(poll, Math.max(5, interval) * 1000)
        } else { setError(message(reason)); setPair(undefined) }
      }
    }
    return () => { abort.abort(); window.clearInterval(clock); window.clearTimeout(timer) }
  }, [pair])
  async function start() {
    setBusy(true)
    setError('')
    setCopied(false)
    try {
      const result = await api<Pairing>('/api/auth/device/start', { method: 'POST' })
      setNow(Date.now())
      setPair(result)
    } catch (reason) { setError(message(reason)) }
    finally { setBusy(false) }
  }
  async function cancel() {
    if (!pair) return
    setBusy(true)
    setPair(undefined)
    setError('')
    try { await api('/api/auth/device/cancel', { method: 'POST', headers: { 'X-Pairing-Id': pair.id } }) }
    catch (reason) { setError(message(reason)) }
    finally { setBusy(false) }
  }
  return <><h1>Link your Microsoft account</h1>
    {error && <p className="error-message" role="alert">{error}</p>}
    {pair ? <section aria-label="Microsoft pairing">
      <p>Enter this code on Microsoft’s verification page using this device or another one.</p>
      <p><strong>{pair.code}</strong> <button onClick={async () => {
        try { await navigator.clipboard.writeText(pair.code); setCopied(true) }
        catch { setError('Select the code and copy it manually.') }
      }}>{copied ? 'Copied' : 'Copy code'}</button></p>
      <a className="button primary" href={pair.uri} target="_blank" rel="noopener noreferrer">Open verification page</a>
      <p>{pair.uri}</p><p>Code expires in {Math.max(0, Math.ceil((pair.expiresAt - now) / 1000))} seconds.</p>
      <p role="status">Waiting for authorization. Keep this tab open.</p>
      <button onClick={() => void cancel()}>Cancel</button>
    </section> : <><p>Sign in to play from your Xbox console or launch a Cloud Gaming title.</p>
      <button className="button primary microsoft" disabled={busy} onClick={() => void start()}>
        <span className="ms-icon" aria-hidden="true"><i /><i /><i /><i /></span>{busy ? 'Please wait…' : error ? 'Retry' : 'Sign in with Microsoft'}
      </button></>}
  </>
}
