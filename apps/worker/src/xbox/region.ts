/** The xHome login service chooses the region. Only accept Microsoft streaming origins. */
export function homeOrigin(value: unknown): string | null {
  if (typeof value !== 'string') return null
  let url: URL
  try { url = new URL(value) } catch { return null }
  const knownHost = ['.gssv-play-prodxhome.xboxlive.com', '.gssv-play-prod.xboxlive.com']
    .some(suffix => url.hostname.endsWith(suffix))
  if (!knownHost || url.protocol !== 'https:' || url.username || url.password ||
      url.port || url.pathname !== '/' || url.search || url.hash) return null
  return url.origin
}
