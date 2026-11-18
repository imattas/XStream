import type { ComponentProps } from 'react'

export function Brand() {
  return <span className="brand"><img src="/images/xstream-mark.svg" alt="" width="36" height="36" />XStream</span>
}

export function Loader({ children }: { children: string }) {
  return <div role="status" className="loading"><span className="ring" aria-hidden="true" />{children}</div>
}

export function Link({ href, onClick, streamName, ...props }: ComponentProps<'a'> & { href: string; streamName?: string }) {
  return <a href={href} {...props} onClick={event => {
    onClick?.(event)
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    navigate(href, streamName)
  }} />
}

export function navigate(path: string, streamName?: string) {
  window.history.pushState(streamName ? { streamName } : null, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
  window.scrollTo(0, 0)
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...init })
  if (!response.ok) {
    const data = await response.json().catch(() => null) as { error?: string; code?: string } | null
    if (response.status === 401 && data?.code === 'session_expired') window.dispatchEvent(new Event('xstream-session-expired'))
    throw new Error(data?.error || `Request failed (HTTP ${response.status}).`)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export function message(reason: unknown) {
  return reason instanceof Error ? reason.message : 'The request could not be completed.'
}
