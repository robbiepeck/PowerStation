/** Split a command without invoking a shell. Supports quoted args and backslash escapes. */
export function splitCommand(command: string): string[] {
  const parts: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let escaped = false
  let started = false

  for (const char of command) {
    if (escaped) {
      current += char
      escaped = false
      started = true
      continue
    }
    if (char === '\\' && quote === '"') {
      escaped = true
      started = true
      continue
    }
    if (quote) {
      if (char === quote) quote = null
      else current += char
      started = true
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      started = true
      continue
    }
    if (/\s/.test(char)) {
      if (started) {
        parts.push(current)
        current = ''
        started = false
      }
      continue
    }
    current += char
    started = true
  }

  if (escaped || quote) throw new Error('Command contains an unterminated quote or escape.')
  if (started) parts.push(current)
  return parts
}

/** Quote one display-string argument so splitCommand reconstructs it exactly. */
export function quoteCommandArg(value: string): string {
  if (value && !/[\s'"\\]/.test(value)) return value
  return JSON.stringify(value)
}
