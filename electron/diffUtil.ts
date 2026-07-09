export type DiffLine = {
  type: 'same' | 'add' | 'del' | 'skip'
  text: string
}

const MAX_LINES = 2000
const CONTEXT = 3

function lcsTable(a: string[], b: string[]): Uint32Array {
  const width = b.length + 1
  const table = new Uint32Array((a.length + 1) * width)
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * width + j] =
        a[i] === b[j] ? table[(i + 1) * width + j + 1] + 1 : Math.max(table[(i + 1) * width + j], table[i * width + j + 1])
    }
  }
  return table
}

export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = oldText === '' ? [] : oldText.replace(/\r\n/g, '\n').split('\n').slice(0, MAX_LINES)
  const b = newText === '' ? [] : newText.replace(/\r\n/g, '\n').split('\n').slice(0, MAX_LINES)
  const width = b.length + 1
  const table = lcsTable(a, b)
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ type: 'same', text: a[i] })
      i++
      j++
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
      out.push({ type: 'del', text: a[i] })
      i++
    } else {
      out.push({ type: 'add', text: b[j] })
      j++
    }
  }
  while (i < a.length) out.push({ type: 'del', text: a[i++] })
  while (j < b.length) out.push({ type: 'add', text: b[j++] })
  return out
}

export function compactDiff(lines: DiffLine[], context: number = CONTEXT): DiffLine[] {
  const keep = new Array<boolean>(lines.length).fill(false)
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].type !== 'same') {
      for (let k = Math.max(0, i - context); k <= Math.min(lines.length - 1, i + context); k++) keep[k] = true
    }
  }
  const out: DiffLine[] = []
  let skipped = 0
  for (let i = 0; i < lines.length; i++) {
    if (keep[i]) {
      if (skipped > 0) {
        out.push({ type: 'skip', text: `⋯ ${skipped} unchanged line${skipped === 1 ? '' : 's'}` })
        skipped = 0
      }
      out.push(lines[i])
    } else {
      skipped++
    }
  }
  if (skipped > 0) out.push({ type: 'skip', text: `⋯ ${skipped} unchanged line${skipped === 1 ? '' : 's'}` })
  return out
}

export type DiffSummary = { added: number; removed: number }

export function summarizeDiff(lines: DiffLine[]): DiffSummary {
  let added = 0
  let removed = 0
  for (const line of lines) {
    if (line.type === 'add') added++
    if (line.type === 'del') removed++
  }
  return { added, removed }
}

export function previewDiff(oldText: string, newText: string): { lines: DiffLine[]; summary: DiffSummary } {
  const full = diffLines(oldText, newText)
  return { lines: compactDiff(full), summary: summarizeDiff(full) }
}

export function applyTextEdits(
  content: string,
  edits: Array<{ oldText: string; newText: string }>,
): string | null {
  let result = content
  for (const edit of edits) {
    if (typeof edit?.oldText !== 'string' || typeof edit?.newText !== 'string') return null
    const index = result.indexOf(edit.oldText)
    if (index === -1) return null
    result = result.slice(0, index) + edit.newText + result.slice(index + edit.oldText.length)
  }
  return result
}
