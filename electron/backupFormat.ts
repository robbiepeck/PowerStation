export const BACKUP_FORMAT = 'powerstation-backup'
export const BACKUP_VERSION = 1

export type BackupSkill = { slug: string; content: string }

export type BackupArchive = {
  format: typeof BACKUP_FORMAT
  version: number
  exportedAt: string
  appVersion: string

  state: Record<string, unknown>
  skills: BackupSkill[]
  chats: unknown[]
  projects: unknown[]

  agents: unknown[]
}

const MAX_INPUT_CHARS = 300 * 1024 * 1024
const MAX_SKILLS = 200
const MAX_CHATS = 500
const MAX_PROJECTS = 50
const SLUG_PATTERN = /^[a-z0-9-]{1,60}$/

export function buildBackupJson(parts: {
  appVersion: string
  state: Record<string, unknown>
  skills: BackupSkill[]
  chats: unknown[]
  projects: unknown[]
  agents?: unknown[]
}): string {
  const archive: BackupArchive = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion: parts.appVersion,
    state: parts.state,
    skills: parts.skills.slice(0, MAX_SKILLS),
    chats: parts.chats.slice(0, MAX_CHATS),
    projects: parts.projects.slice(0, MAX_PROJECTS),
    agents: (parts.agents ?? []).slice(0, MAX_PROJECTS),
  }
  return JSON.stringify(archive, null, 1)
}

export function parseBackupJson(text: string): BackupArchive {
  if (typeof text !== 'string' || !text.trim()) throw new Error('The file is empty.')
  if (text.length > MAX_INPUT_CHARS) throw new Error('The file is too large to be a PowerStation backup.')
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('The file is not valid JSON.')
  }
  const record = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null
  if (record?.format !== BACKUP_FORMAT) throw new Error('The file is not a PowerStation backup.')
  if (record.version !== BACKUP_VERSION) {
    throw new Error(`Unsupported backup version ${String(record.version)} — this build reads version ${BACKUP_VERSION}.`)
  }
  const skills = (Array.isArray(record.skills) ? record.skills : [])
    .slice(0, MAX_SKILLS)
    .map((item) => {
      const s = typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : null
      const slug = typeof s?.slug === 'string' ? s.slug.toLowerCase() : ''
      const content = typeof s?.content === 'string' ? s.content : ''
      if (!SLUG_PATTERN.test(slug) || !content || content.length > 200_000) return null
      return { slug, content }
    })
    .filter((s): s is BackupSkill => s !== null)
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: typeof record.exportedAt === 'string' ? record.exportedAt : '',
    appVersion: typeof record.appVersion === 'string' ? record.appVersion : '',
    state: typeof record.state === 'object' && record.state !== null ? (record.state as Record<string, unknown>) : {},
    skills,
    chats: (Array.isArray(record.chats) ? record.chats : []).slice(0, MAX_CHATS),
    projects: (Array.isArray(record.projects) ? record.projects : []).slice(0, MAX_PROJECTS),
    agents: (Array.isArray(record.agents) ? record.agents : []).slice(0, MAX_PROJECTS),
  }
}
