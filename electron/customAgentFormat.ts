// Custom agent shape and sanitization — pure, unit-tested, reused by backup
// restore and agent export/import. An agent is a reusable assistant in the
// Microsoft-365 agent-builder sense, scoped to what a local app can honestly
// deliver: a name and face, instructions appended to the system prompt, the
// indexed knowledge folders it retrieves across, and the connectors (MCP
// servers) it may use. Deliberately NOT part of an agent (per product
// decision): model binding — an agent shapes the conversation, not which
// weights answer it.

export type AgentKnowledge = {
  /** Folder-index id (rag.ts derives it from the path). */
  folderId: string
  /** Absolute path — kept so a restored agent can re-index on a new machine. */
  folder: string
  name: string
}

export type CustomAgent = {
  id: string
  name: string
  /** 1–4 chars shown as the agent's face (usually an emoji). */
  emoji: string
  description: string
  /** Appended to the system prompt after the global prompt and any project instructions. */
  instructions: string
  knowledge: AgentKnowledge[]
  /**
   * Configured MCP servers this agent may use. Empty means "inherit" (whatever
   * the project or global settings already enable) — an agent only *scopes*
   * connectors when it names some, so an empty list never silences tools.
   */
  mcpServerIds: string[]
  createdAt: number
  updatedAt: number
}

const MAX_NAME = 60
const MAX_DESCRIPTION = 200
const MAX_INSTRUCTIONS = 8_000
const MAX_KNOWLEDGE = 8
const MAX_SERVERS = 40
export const DEFAULT_AGENT_EMOJI = '🤖'

export const AGENT_SHARE_FORMAT = 'powerstation-agent'
export const AGENT_SHARE_VERSION = 1

export function isValidAgentId(id: unknown): id is string {
  return typeof id === 'string' && /^agent-[a-z0-9-]{4,60}$/.test(id)
}

export function newAgentId(): string {
  return `agent-${Date.now()}-${Math.round(Math.random() * 1e6)}`
}

function sanitizeKnowledge(value: unknown): AgentKnowledge[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const out: AgentKnowledge[] = []
  for (const item of value) {
    if (out.length >= MAX_KNOWLEDGE) break
    const record = typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : null
    const folderId = typeof record?.folderId === 'string' && /^[a-f0-9]{16}$/.test(record.folderId) ? record.folderId : null
    const folder = typeof record?.folder === 'string' && record.folder ? record.folder.slice(0, 1024) : null
    if (!folderId || !folder || seen.has(folderId)) continue
    seen.add(folderId)
    out.push({
      folderId,
      folder,
      name: typeof record?.name === 'string' && record.name ? record.name.slice(0, 120) : 'Folder',
    })
  }
  return out
}

/** Returns null when the input is not salvageable (no usable name). */
export function sanitizeCustomAgent(raw: unknown, id: string): CustomAgent | null {
  if (typeof raw !== 'object' || raw === null || !isValidAgentId(id)) return null
  const record = raw as Record<string, unknown>
  const name = typeof record.name === 'string' ? record.name.trim().replace(/\s+/g, ' ').slice(0, MAX_NAME) : ''
  if (!name) return null
  const emoji =
    typeof record.emoji === 'string' && record.emoji.trim() ? [...record.emoji.trim()].slice(0, 4).join('') : DEFAULT_AGENT_EMOJI
  const mcpServerIds = Array.isArray(record.mcpServerIds)
    ? [...new Set(record.mcpServerIds.filter((v): v is string => typeof v === 'string' && v.length <= 120))].slice(0, MAX_SERVERS)
    : []
  return {
    id,
    name,
    emoji,
    description: typeof record.description === 'string' ? record.description.trim().slice(0, MAX_DESCRIPTION) : '',
    instructions: typeof record.instructions === 'string' ? record.instructions.slice(0, MAX_INSTRUCTIONS) : '',
    knowledge: sanitizeKnowledge(record.knowledge),
    mcpServerIds,
    createdAt: typeof record.createdAt === 'number' && Number.isFinite(record.createdAt) ? record.createdAt : Date.now(),
    updatedAt: typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt) ? record.updatedAt : Date.now(),
  }
}

/**
 * Wrap an agent as a portable share file. Knowledge folders travel by path and
 * index id; on another machine the index won't exist until the folder is
 * re-indexed, and connector ids may not resolve — both degrade gracefully
 * (retrieve nothing / connect nothing) rather than error.
 */
export function buildAgentShare(agent: CustomAgent): string {
  return JSON.stringify({ format: AGENT_SHARE_FORMAT, version: AGENT_SHARE_VERSION, agent }, null, 1)
}

/** Parse a share file to a raw agent object (still un-sanitized). Throws with a readable message. */
export function parseAgentShare(text: string): Record<string, unknown> {
  if (typeof text !== 'string' || !text.trim()) throw new Error('The file is empty.')
  if (text.length > 2_000_000) throw new Error('The file is too large to be a PowerStation agent.')
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('The file is not valid JSON.')
  }
  const record = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null
  if (record?.format !== AGENT_SHARE_FORMAT) throw new Error('The file is not a PowerStation agent export.')
  if (record.version !== AGENT_SHARE_VERSION) {
    throw new Error(`Unsupported agent version ${String(record.version)} — this build reads version ${AGENT_SHARE_VERSION}.`)
  }
  if (typeof record.agent !== 'object' || record.agent === null) throw new Error('The agent export is missing its agent data.')
  return record.agent as Record<string, unknown>
}
