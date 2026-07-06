// Project (workspace) shape and sanitization — pure, so it can be unit-tested
// and reused by backup restore. A project bundles the things you'd otherwise
// set up per chat: instructions, a knowledge folder, skill modes, a connector
// selection, and a preferred model. Everything is optional except the name.

import type { SkillMode } from './skillFormat.js'

export type ProjectKnowledge = {
  /** Folder-index id (rag.ts derives it from the path). */
  folderId: string
  /** Absolute path — kept so a restored project can re-index on a new machine. */
  folder: string
  name: string
}

export type Project = {
  id: string
  name: string
  /** Extra system-prompt text, appended after the global base prompt. */
  instructions: string
  modelPath: string | null
  knowledge: ProjectKnowledge | null
  /** Per-project skill modes; skills not listed keep their global mode. */
  skillModes: Record<string, SkillMode>
  /** Configured MCP servers enabled while this project is active. */
  mcpServerIds: string[]
  createdAt: number
  updatedAt: number
}

const MAX_NAME = 60
const MAX_INSTRUCTIONS = 8_000
const MAX_SERVERS = 40
const MAX_SKILL_MODES = 200
const SKILL_MODES = new Set<SkillMode>(['off', 'auto', 'always'])

export function isValidProjectId(id: unknown): id is string {
  return typeof id === 'string' && /^proj-[a-z0-9-]{4,60}$/.test(id)
}

export function newProjectId(): string {
  return `proj-${Date.now()}-${Math.round(Math.random() * 1e6)}`
}

/** Returns null when the input is not salvageable (no usable name). */
export function sanitizeProject(raw: unknown, id: string): Project | null {
  if (typeof raw !== 'object' || raw === null || !isValidProjectId(id)) return null
  const record = raw as Record<string, unknown>
  const name = typeof record.name === 'string' ? record.name.trim().replace(/\s+/g, ' ').slice(0, MAX_NAME) : ''
  if (!name) return null

  const knowledgeRecord =
    typeof record.knowledge === 'object' && record.knowledge !== null ? (record.knowledge as Record<string, unknown>) : null
  const knowledge: ProjectKnowledge | null =
    knowledgeRecord &&
    typeof knowledgeRecord.folderId === 'string' &&
    /^[a-f0-9]{16}$/.test(knowledgeRecord.folderId) &&
    typeof knowledgeRecord.folder === 'string' &&
    knowledgeRecord.folder.length > 0
      ? {
          folderId: knowledgeRecord.folderId,
          folder: knowledgeRecord.folder.slice(0, 1024),
          name: typeof knowledgeRecord.name === 'string' && knowledgeRecord.name ? knowledgeRecord.name.slice(0, 120) : 'Folder',
        }
      : null

  const skillModes: Record<string, SkillMode> = {}
  if (typeof record.skillModes === 'object' && record.skillModes !== null) {
    for (const [slug, mode] of Object.entries(record.skillModes as Record<string, unknown>)) {
      if (Object.keys(skillModes).length >= MAX_SKILL_MODES) break
      if (/^[a-z0-9-]{1,60}$/.test(slug) && SKILL_MODES.has(mode as SkillMode)) skillModes[slug] = mode as SkillMode
    }
  }

  const mcpServerIds = Array.isArray(record.mcpServerIds)
    ? [...new Set(record.mcpServerIds.filter((v): v is string => typeof v === 'string' && v.length <= 120))].slice(0, MAX_SERVERS)
    : []

  return {
    id,
    name,
    instructions: typeof record.instructions === 'string' ? record.instructions.slice(0, MAX_INSTRUCTIONS) : '',
    modelPath: typeof record.modelPath === 'string' && record.modelPath ? record.modelPath : null,
    knowledge,
    skillModes,
    mcpServerIds,
    createdAt: typeof record.createdAt === 'number' && Number.isFinite(record.createdAt) ? record.createdAt : Date.now(),
    updatedAt: typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt) ? record.updatedAt : Date.now(),
  }
}
