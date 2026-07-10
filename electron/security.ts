import path from 'node:path'
import { fileURLToPath } from 'node:url'

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])
const HF_SHORTHAND = /^hf:[a-z0-9][a-z0-9._-]{0,95}\/[a-z0-9][a-z0-9._-]{0,95}(?::[a-z0-9][a-z0-9._-]{0,199})?$/i

function parseHttpsUrl(raw: unknown): URL | null {
  if (typeof raw !== 'string' || raw.length > 2048) return null
  try {
    const parsed = new URL(raw)
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || (parsed.port && parsed.port !== '443')) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

/** External pages the packaged UI is allowed to hand to the operating system. */
export function isTrustedExternalUrl(raw: unknown): boolean {
  const parsed = parseHttpsUrl(raw)
  if (!parsed) return false
  if (parsed.hostname === 'huggingface.co') return true
  return (
    parsed.hostname === 'github.com' &&
    (parsed.pathname === '/robbiepeck/PowerStation' || parsed.pathname.startsWith('/robbiepeck/PowerStation/'))
  )
}

/** User-entered model downloads are restricted to Hugging Face, never arbitrary HTTPS/localhost targets. */
export function isAllowedModelUri(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false
  const value = raw.trim()
  if (HF_SHORTHAND.test(value)) return true
  const parsed = parseHttpsUrl(value)
  if (!parsed || parsed.hostname !== 'huggingface.co') return false
  let pathname: string
  try {
    pathname = decodeURIComponent(parsed.pathname)
  } catch {
    return false
  }
  return pathname.toLowerCase().endsWith('.gguf') && pathname.includes('/resolve/')
}

export function trustedLoopbackDevUrl(raw: unknown): URL | null {
  if (typeof raw !== 'string') return null
  try {
    const parsed = new URL(raw)
    if (parsed.protocol !== 'http:' || !LOOPBACK_HOSTS.has(parsed.hostname) || parsed.username || parsed.password) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

/** Only the bundled entry document (or the exact loopback dev origin) may retain the preload bridge. */
export function isTrustedRendererNavigation(
  targetUrl: string,
  appEntryUrl: string,
  devServerUrl?: string | null,
): boolean {
  try {
    const target = new URL(targetUrl)
    const dev = trustedLoopbackDevUrl(devServerUrl)
    if (dev) return target.origin === dev.origin

    const entry = new URL(appEntryUrl)
    if (entry.protocol === 'powerstation:') {
      return (
        target.protocol === entry.protocol &&
        target.hostname === entry.hostname &&
        target.pathname === entry.pathname &&
        target.search === ''
      )
    }
    if (target.protocol !== 'file:' || entry.protocol !== 'file:') return false
    return path.resolve(fileURLToPath(target)) === path.resolve(fileURLToPath(entry)) && target.search === ''
  } catch {
    return false
  }
}

/** Lexical containment check for already-resolved, non-symlink capability paths. */
export function isPathInside(root: string, candidate: string, allowRoot = false): boolean {
  const resolvedRoot = path.resolve(root)
  const resolvedCandidate = path.resolve(candidate)
  return (allowRoot && resolvedCandidate === resolvedRoot) || resolvedCandidate.startsWith(resolvedRoot + path.sep)
}
