import { promises as fs } from 'node:fs'
import path from 'node:path'
import { applyTextEdits, previewDiff, type DiffLine, type DiffSummary } from './diffUtil.js'
import { getServerBaseDir, type McpToolInfo } from './mcp.js'
import { getReclaimables } from './repair.js'

export type ToolPreview =
  | {
      kind: 'diff'
      path: string
      newFile: boolean
      lines: DiffLine[]
      summary: DiffSummary
      note: string | null
    }
  | { kind: 'move'; from: string; to: string }
  | { kind: 'note'; title: string; body: string }

const MAX_PREVIEW_BYTES = 200_000

async function readTextIfSmall(filePath: string): Promise<{ text: string; note: string | null } | null> {
  try {
    const stat = await fs.stat(filePath)
    if (!stat.isFile()) return null
    if (stat.size > MAX_PREVIEW_BYTES) return { text: '', note: 'File too large to preview — showing the new content only.' }
    return { text: await fs.readFile(filePath, 'utf8'), note: null }
  } catch {
    return null
  }
}

export async function buildToolPreview(tool: McpToolInfo, args: unknown): Promise<ToolPreview | null> {
  const record = typeof args === 'object' && args !== null ? (args as Record<string, unknown>) : {}

  if (tool.key === 'powerstation:clean_reclaimable') {
    const id = typeof record.id === 'string' ? record.id : null
    const item = id ? (await getReclaimables().catch(() => [])).find((r) => r.id === id) : null
    return item
      ? {
          kind: 'note',
          title: `Remove: ${item.label} (${(item.sizeBytes / 1e6).toFixed(1)} MB)`,
          body: `${item.detail} After removal: ${item.consequence}`,
        }
      : {
          kind: 'note',
          title: 'Remove: unknown item',
          body: 'This id is not on the reclaimable list, so the call will fail safely — only PowerStation-created data can be removed.',
        }
  }

  const baseDir = getServerBaseDir(tool.serverId)
  const resolvePath = (p: string) => (path.isAbsolute(p) || !baseDir ? p : path.join(baseDir, p))
  try {
    if (tool.name === 'write_file' && typeof record.path === 'string' && typeof record.content === 'string') {
      const existing = await readTextIfSmall(resolvePath(record.path))
      const oldText = existing?.text ?? ''
      const { lines, summary } = previewDiff(oldText, record.content)
      return {
        kind: 'diff',
        path: resolvePath(record.path),
        newFile: existing === null,
        lines,
        summary,
        note: existing?.note ?? null,
      }
    }

    if (tool.name === 'edit_file' && typeof record.path === 'string' && Array.isArray(record.edits)) {
      const existing = await readTextIfSmall(resolvePath(record.path))
      if (!existing || existing.note) {
        return existing?.note
          ? { kind: 'diff', path: resolvePath(record.path), newFile: false, lines: [], summary: { added: 0, removed: 0 }, note: existing.note }
          : null
      }
      const edited = applyTextEdits(
        existing.text,
        record.edits as Array<{ oldText: string; newText: string }>,
      )
      if (edited === null) {
        return {
          kind: 'diff',
          path: resolvePath(record.path),
          newFile: false,
          lines: [],
          summary: { added: 0, removed: 0 },
          note: "One of the edits doesn't match the file's current content — the tool call would fail as-is.",
        }
      }
      const { lines, summary } = previewDiff(existing.text, edited)
      return { kind: 'diff', path: resolvePath(record.path), newFile: false, lines, summary, note: null }
    }

    if (tool.name === 'move_file' && typeof record.source === 'string' && typeof record.destination === 'string') {
      return { kind: 'move', from: record.source, to: record.destination }
    }
  } catch {
    void 0
  }
  return null
}

export function previewTitle(preview: ToolPreview): string {
  if (preview.kind === 'move') return `Move ${path.basename(preview.from)} → ${preview.to}`
  if (preview.kind === 'note') return preview.title
  return preview.newFile ? `Create ${preview.path}` : `Modify ${preview.path}`
}
