export function parseTeamIdentifier(output: string): string | null {
  const match = output.match(/(?:^|\n)TeamIdentifier=([^\r\n]+)/)
  const value = match?.[1]?.trim()
  if (!value || value.toLowerCase() === 'not set') return null
  return /^[A-Z0-9]{6,20}$/.test(value) ? value : null
}

export function isSafeZipEntry(entry: string): boolean {
  if (!entry || entry.includes('\0')) return false
  const portable = entry.replaceAll('\\', '/')
  if (portable.startsWith('/') || /^[A-Za-z]:\//.test(portable)) return false
  const normalized = portable.split('/').filter((part) => part !== '' && part !== '.')
  return normalized.length > 0 && normalized.every((part) => part !== '..')
}
