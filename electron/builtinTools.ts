// First-party tools the model can call WITHOUT any MCP server — currently the
// Repair toolset. They ride the exact same rails as external tools: the same
// ask/allow/deny permissions, the same previews, the same audit log. The only
// mutating tool resolves its target through repair.ts's id allowlist and
// containment guard, so the model cannot express an out-of-contract delete no
// matter what it generates.
//
// Registration is gated on the "Storage repair" skill being active for the
// message — the skill teaches the workflow, and its Off/Auto/Always modes
// double as the feature switch (no tool-schema tokens spent otherwise).

import type { McpToolInfo } from './mcp.js'
import * as repair from './repair.js'

export const BUILTIN_SERVER_ID = '__powerstation'
export const REPAIR_SKILL_SLUG = 'storage-repair'

const TOOL_DEFS: McpToolInfo[] = [
  {
    key: 'powerstation:storage_report',
    serverId: BUILTIN_SERVER_ID,
    serverName: 'PowerStation',
    name: 'storage_report',
    description:
      'Read-only: disk usage overview — free space, sizes of well-known AI-file locations, and models duplicated across apps. Sizes are bytes; approximate=true means the figure is a floor.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    key: 'powerstation:list_reclaimables',
    serverId: BUILTIN_SERVER_ID,
    serverName: 'PowerStation',
    name: 'list_reclaimables',
    description:
      'Read-only: the only things that can be removed — data PowerStation itself created (all rebuildable or re-downloadable), each with id, size in bytes, and consequence.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    key: 'powerstation:clean_reclaimable',
    serverId: BUILTIN_SERVER_ID,
    serverName: 'PowerStation',
    name: 'clean_reclaimable',
    description:
      'Remove ONE reclaimable by the id list_reclaimables returned. Only PowerStation-created data can be removed; anything else fails safely. Ask the user before calling.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'A reclaimable id from list_reclaimables.' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    key: 'powerstation:check_model_integrity',
    serverId: BUILTIN_SERVER_ID,
    serverName: 'PowerStation',
    name: 'check_model_integrity',
    description:
      'Read-only: verify every local model file (GGUF signature, plausible size vs the catalogue). A bad file is fixed by re-downloading from the Models tab.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
]

export function getBuiltinRepairTools(): McpToolInfo[] {
  return TOOL_DEFS
}

export function findBuiltinTool(key: string): McpToolInfo | null {
  return TOOL_DEFS.find((tool) => tool.key === key) ?? null
}

const cap = (text: string, max = 6000) => (text.length > max ? `${text.slice(0, max)}…` : text)

export async function callBuiltinTool(tool: McpToolInfo, args: unknown): Promise<{ ok: boolean; text: string }> {
  try {
    switch (tool.name) {
      case 'storage_report': {
        const report = await repair.getStorageReport()
        return {
          ok: true,
          text: cap(
            JSON.stringify({
              disk: report.disk,
              locations: report.locations
                .filter((l) => l.exists)
                .map(({ id, label, sizeBytes, fileCount, approximate }) => ({ id, label, sizeBytes, fileCount, approximate })),
              duplicates: report.duplicates,
            }),
          ),
        }
      }
      case 'list_reclaimables': {
        return { ok: true, text: cap(JSON.stringify(await repair.getReclaimables())) }
      }
      case 'clean_reclaimable': {
        const id = typeof args === 'object' && args !== null ? (args as Record<string, unknown>).id : null
        if (typeof id !== 'string') return { ok: false, text: 'clean_reclaimable needs an id from list_reclaimables.' }
        const result = await repair.cleanReclaimable(id)
        return result.removed
          ? { ok: true, text: `Removed. Freed ${result.freedBytes.toLocaleString()} bytes.` }
          : { ok: false, text: 'Nothing was removed — the id was not on the reclaimable list (only PowerStation-created data can be cleaned).' }
      }
      case 'check_model_integrity': {
        return { ok: true, text: cap(JSON.stringify(await repair.checkModelIntegrity())) }
      }
      default:
        return { ok: false, text: `Unknown built-in tool: ${tool.name}` }
    }
  } catch (error) {
    return { ok: false, text: error instanceof Error ? error.message : String(error) }
  }
}
