const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])

function normalizedHostname(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
}

export function isTrustedApiHostHeader(raw: unknown): boolean {
  if (typeof raw !== 'string' || !raw || raw.length > 300) return false
  try {
    const parsed = new URL(`http://${raw}`)
    return !parsed.username && !parsed.password && LOOPBACK_HOSTS.has(normalizedHostname(parsed.hostname))
  } catch {
    return false
  }
}

export function trustedApiOrigin(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw || raw.length > 500 || raw === 'null') return null
  try {
    const parsed = new URL(raw)
    if (
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
      parsed.username ||
      parsed.password ||
      !LOOPBACK_HOSTS.has(normalizedHostname(parsed.hostname)) ||
      parsed.pathname !== '/' ||
      parsed.search ||
      parsed.hash
    ) {
      return null
    }
    return parsed.origin
  } catch {
    return null
  }
}

export function isTrustedApiBrowserRequest(origin: unknown): boolean {
  return origin === undefined || trustedApiOrigin(origin) !== null
}
