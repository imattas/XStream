import { useCallback, useEffect, useRef, useState } from 'react'
import { api, message } from '../components/ui'

interface Session {
  authenticated: boolean
  expiresAt?: number
  serverTime?: number
  user?: { name: string; picture?: string; gamerscore?: number; tenure?: number }
}
const changeKey = 'xstream.auth-change'
const expiredMessage = 'Your session expired. Sign in again to access your Xbox.'

// A notification contains no account information or credentials.
export function notifySessionChange() {
  try { localStorage.setItem(changeKey, crypto.randomUUID()) } catch { /* Tabs also check on focus. */ }
}

export function useAppSession() {
  const [session, setSession] = useState<Session | null>(null)
  const [sessionError, setError] = useState('')
  const [authMessage, setMessage] = useState('')
  const [retry, setRetry] = useState(0)
  const deadline = useRef<number | undefined>(undefined)
  const pending = useRef<AbortController | undefined>(undefined)
  const signedOut = useCallback((reason = '') => {
    pending.current?.abort()
    deadline.current = undefined
    setError('')
    setMessage(reason)
    setSession({ authenticated: false })
  }, [])

  useEffect(() => {
    let timer: number | undefined
    function expire() {
      signedOut(expiredMessage)
    }
    function checkTime() {
      if (deadline.current !== undefined && Date.now() >= deadline.current) { expire(); return true }
      return false
    }
    async function read() {
      pending.current?.abort()
      const abort = new AbortController()
      pending.current = abort
      const started = Date.now()
      try {
        const value = await api<Session>('/api/auth/session', { signal: abort.signal })
        if (abort.signal.aborted) return
        window.clearTimeout(timer)
        if (!value.authenticated) {
          signedOut(deadline.current !== undefined ? expiredMessage : '')
          return
        }
        // Use the server's remaining lifetime, including time spent waiting for this response.
        if (typeof value.expiresAt !== 'number' || !Number.isFinite(value.expiresAt) ||
            typeof value.serverTime !== 'number' || !Number.isFinite(value.serverTime)) {
          signedOut('Your session could not be verified. Sign in again.')
          return
        }
        deadline.current = started + value.expiresAt - value.serverTime
        if (checkTime()) return
        timer = window.setTimeout(() => {
          if (deadline.current !== undefined) expire()
        }, Math.max(0, deadline.current - Date.now()))
        setMessage('')
        setError('')
        setSession(value)
      } catch (reason) {
        if (!abort.signal.aborted && !checkTime()) setError(message(reason))
      }
    }
    function wake() { if (!document.hidden && !checkTime()) void read() }
    function restore(event: PageTransitionEvent) { if (event.persisted) wake() }
    function changed(event: StorageEvent) {
      if (event.key !== changeKey) return
      signedOut()
      void read()
    }
    void read()
    window.addEventListener('focus', wake)
    window.addEventListener('pageshow', restore)
    window.addEventListener('storage', changed)
    window.addEventListener('xstream-session-expired', expire)
    document.addEventListener('visibilitychange', wake)
    return () => {
      pending.current?.abort()
      window.clearTimeout(timer)
      window.removeEventListener('focus', wake)
      window.removeEventListener('pageshow', restore)
      window.removeEventListener('storage', changed)
      window.removeEventListener('xstream-session-expired', expire)
      document.removeEventListener('visibilitychange', wake)
    }
  }, [signedOut, retry])
  return { session, sessionError, authMessage, signedOut, retrySession: () => setRetry(n => n + 1) }
}
