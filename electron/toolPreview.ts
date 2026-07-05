// Human-readable previews for side-effecting tool calls, computed before the
// permission prompt so the user approves what will actually happen — a real
// diff, not raw JSON. Recognises the de-facto filesystem MCP tool shapes.

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { applyTextEdits, previewDiff, type DiffLine, type DiffSummary } from './diffUtil.js'
import { getServerBaseDir, type McpToolInfo } from './mcp.js'

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

const MAX_PREVIEW_BYTES = 200_000

async function readTextIfSmall(filePath: string): Promise<{ text: string; note: string | null } | null> {
  try {
    const stat = await fs.stat(filePath)
    if (!stat.isFile()) return null
    if (stat.size > MAX_PREVIEW_BYTES) return { text: '', note: 'File too large to preview — showing the new content only.' }
    return { text: await fs.readFile(filePath, 'utf8'), note: null }
  } catch {
    return null // does not exist → new file
  }
}

/**
 * Build a preview for known write-shaped tools; null means "no preview" and
 * the modal falls back to showing the raw arguments.
 */
export async function buildToolPreview(tool: McpToolInfo, args: unknown): Promise<ToolPreview | null> {
  const record = typeof args === 'object' && args !== null ? (args as Record<string, unknown>) : {}
  // Models often pass paths relative to the server's allowed folder — resolve
  // the same way the filesystem server will, or the preview reads the wrong file.
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
    /* preview is best-effort; the permission prompt still shows raw args */
  }
  return null
}

export function previewTitle(preview: ToolPreview): string {
  if (preview.kind === 'move') return `Move ${path.basename(preview.from)} → ${preview.to}`
  return preview.newFile ? `Create ${preview.path}` : `Modify ${preview.path}`
}
