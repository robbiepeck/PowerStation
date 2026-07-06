// Conversation persistence. Chats are plain JSON files — one per conversation
// — in the app's user-data directory, so "where is my data" has a concrete,
// revealable answer. Files are written only while the save-chats setting is
// on, and everything on disk is sanitised on the way back in.

import { app, shell } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'

export type StoredAttachment = {
  name: string
  tokenEstimate: number
  /** Full extracted text — kept so resuming a chat can replay it into the model. */
  text: string
}

export type StoredToolCall = {
  toolKey: string
  argsJson: string
  ok: boolean | null
  summary: string
  decision: string | null
  preview: unknown
  durationMs: number
  timestamp: number
}

export type StoredChatMessage = {
  role: 'user' | 'assistant'
  content: string
  tokensPerSec?: number
  attachments?: StoredAttachment[]
  sources?: string[]
  toolCalls?: StoredToolCall[]
}

export type StoredChat = {
  id: string
  title: string
  /** True once the user renamed the chat — saves stop re-deriving the title. */
  titleLocked: boolean
  pinned: boolean
  /** Workspace this chat belongs to; null = Personal. */
  projectId: string | null
  createdAt: number
  updatedAt: number
  modelPath: string | null
  ragFolder: { id: string; name: string } | null
  messages: StoredChatMessage[]
}

export type ChatSummary = {
  id: string
  title: string
  pinned: boolean
  projectId: string | null
  updatedAt: number
  messageCount: number
  snippet?: string
}

/** Sidebar scope: a project id for that workspace, or null for Personal (unassigned). */
export type ChatScope = { projectId: string | null } | undefined

const MAX_CHATS = 200
const MAX_MESSAGES = 400
const MAX_MESSAGE_CHARS = 200_000

export function chatsDir(): string {
  return path.join(app.getPath('userData'), 'chats')
}

function chatFile(id: string): string {
  return path.join(chatsDir(), `${id}.json`)
}

function isValidId(id: unknown): id is string {
  return typeof id === 'string' && /^[a-z0-9-]{6,80}$/.test(id)
}

function newId(): string {
  return `chat-${Date.now()}-${Math.round(Math.random() * 1e6)}`
}

function deriveTitle(messages: StoredChatMessage[]): string {
  const firstUser = messages.find((m) => m.role === 'user' && m.content.trim())
  const raw = (firstUser?.content ?? 'New chat').trim().replace(/\s+/g, ' ')
  return raw.length > 60 ? `${raw.slice(0, 57)}…` : raw
}

function sanitizeAttachments(value: unknown): StoredAttachment[] | undefined {
  if (!Array.isArray(value)) return undefined
  const attachments = value
    .slice(0, 4)
    .map((item) => {
      const record = typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : null
      const name = typeof record?.name === 'string' ? record.name.slice(0, 200) : ''
      const text = typeof record?.text === 'string' ? record.text.slice(0, MAX_MESSAGE_CHARS) : ''
      if (!name || !text) return null
      return {
        name,
        tokenEstimate:
          typeof record?.tokenEstimate === 'number' && Number.isFinite(record.tokenEstimate)
            ? record.tokenEstimate
            : Math.ceil(text.length / 4),
        text,
      }
    })
    .filter((a): a is StoredAttachment => a !== null)
  return attachments.length ? attachments : undefined
}

const DECISIONS = new Set(['allowed', 'allowed-always', 'allowed-turn', 'auto-allowed', 'denied', 'blocked'])

function sanitizeToolCalls(value: unknown): StoredToolCall[] | undefined {
  if (!Array.isArray(value)) return undefined
  const calls = value
    .slice(0, 30)
    .map((item) => {
      const record = typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : null
      const toolKey = typeof record?.toolKey === 'string' ? record.toolKey.slice(0, 200) : ''
      if (!toolKey) return null
      return {
        toolKey,
        argsJson: typeof record?.argsJson === 'string' ? record.argsJson.slice(0, 2000) : '{}',
        ok: typeof record?.ok === 'boolean' ? record.ok : null,
        summary: typeof record?.summary === 'string' ? record.summary.slice(0, 400) : '',
        decision: typeof record?.decision === 'string' && DECISIONS.has(record.decision) ? record.decision : null,
        preview: (record?.preview ?? null) as unknown,
        durationMs: typeof record?.durationMs === 'number' && Number.isFinite(record.durationMs) ? record.durationMs : 0,
        timestamp: typeof record?.timestamp === 'number' && Number.isFinite(record.timestamp) ? record.timestamp : 0,
      }
    })
    .filter((c): c is StoredToolCall => c !== null)
  return calls.length ? calls : undefined
}

function sanitizeMessages(value: unknown): StoredChatMessage[] {
  if (!Array.isArray(value)) return []
  return value
    .slice(-MAX_MESSAGES)
    .map((item) => {
      const record = typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : null
      const role = record?.role === 'user' || record?.role === 'assistant' ? record.role : null
      const content = typeof record?.content === 'string' ? record.content.slice(0, MAX_MESSAGE_CHARS) : ''
      if (!role || !content) return null
      const tokensPerSec = typeof record?.tokensPerSec === 'number' && Number.isFinite(record.tokensPerSec)
        ? record.tokensPerSec
        : undefined
      const attachments = sanitizeAttachments(record?.attachments)
      const sources = Array.isArray(record?.sources)
        ? record.sources.filter((s): s is string => typeof s === 'string').slice(0, 12)
        : undefined
      const toolCalls = sanitizeToolCalls(record?.toolCalls)
      return {
        role,
        content,
        ...(tokensPerSec !== undefined ? { tokensPerSec } : {}),
        ...(attachments ? { attachments } : {}),
        ...(sources?.length ? { sources } : {}),
        ...(toolCalls?.length ? { toolCalls } : {}),
      }
    })
    .filter((m): m is StoredChatMessage => m !== null)
}

function sanitizeChat(raw: unknown, id: string): StoredChat | null {
  if (typeof raw !== 'object' || raw === null) return null
  const record = raw as Record<string, unknown>
  const messages = sanitizeMessages(record.messages)
  if (!messages.length) return null
  return {
    id,
    title: typeof record.title === 'string' && record.title.trim() ? record.title.slice(0, 80) : deriveTitle(messages),
    titleLocked: record.titleLocked === true,
    pinned: record.pinned === true,
    projectId:
      typeof record.projectId === 'string' && /^proj-[a-z0-9-]{4,60}$/.test(record.projectId) ? record.projectId : null,
    createdAt: typeof record.createdAt === 'number' ? record.createdAt : Date.now(),
    updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : Date.now(),
    modelPath: typeof record.modelPath === 'string' ? record.modelPath : null,
    ragFolder: sanitizeRagFolder(record.ragFolder),
    messages,
  }
}

function sanitizeRagFolder(value: unknown): { id: string; name: string } | null {
  const record = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
  const id = typeof record?.id === 'string' && /^[a-f0-9]{16}$/.test(record.id) ? record.id : null
  const name = typeof record?.name === 'string' ? record.name.slice(0, 120) : ''
  return id ? { id, name } : null
}

async function readChat(id: string): Promise<StoredChat | null> {
  try {
    const raw = await fs.readFile(chatFile(id), 'utf8')
    return sanitizeChat(JSON.parse(raw), id)
  } catch {
    return null
  }
}

export async function listChats(scope?: ChatScope): Promise<ChatSummary[]> {
  let files: string[]
  try {
    files = await fs.readdir(chatsDir())
  } catch {
    return []
  }
  const ids = files
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -5))
    .filter(isValidId)
  const chats = (await Promise.all(ids.map(readChat))).filter((c): c is StoredChat => c !== null)
  return chats
    .filter((c) => (scope === undefined ? true : c.projectId === scope.projectId))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt)
    .slice(0, MAX_CHATS)
    .map((c) => ({
      id: c.id,
      title: c.title,
      pinned: c.pinned,
      projectId: c.projectId,
      updatedAt: c.updatedAt,
      messageCount: c.messages.length,
    }))
}

export async function getChat(id: unknown): Promise<StoredChat | null> {
  if (!isValidId(id)) return null
  return readChat(id)
}

export async function saveChat(payload: {
  id?: unknown
  messages: unknown
  modelPath?: unknown
  ragFolder?: unknown
  projectId?: unknown
}): Promise<{ id: string } | null> {
  const messages = sanitizeMessages(payload.messages)
  if (!messages.length) return null
  const id = isValidId(payload.id) ? payload.id : newId()
  const existing = await readChat(id)
  const chat: StoredChat = {
    id,
    title: existing?.titleLocked ? existing.title : deriveTitle(messages),
    titleLocked: existing?.titleLocked ?? false,
    pinned: existing?.pinned ?? false,
    // A chat's workspace is set at creation and never migrates on later saves.
    projectId:
      existing?.projectId ??
      (typeof payload.projectId === 'string' && /^proj-[a-z0-9-]{4,60}$/.test(payload.projectId) ? payload.projectId : null),
    createdAt: existing?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
    modelPath: typeof payload.modelPath === 'string' ? payload.modelPath : existing?.modelPath ?? null,
    ragFolder: payload.ragFolder === undefined ? existing?.ragFolder ?? null : sanitizeRagFolder(payload.ragFolder),
    messages,
  }
  await writeChat(chat)
  return { id }
}

async function writeChat(chat: StoredChat): Promise<void> {
  await fs.mkdir(chatsDir(), { recursive: true })
  await fs.writeFile(chatFile(chat.id), JSON.stringify(chat, null, 1), 'utf8')
}

/** Rename keeps updatedAt untouched so the list does not reorder under the user. */
export async function renameChat(id: unknown, title: unknown): Promise<boolean> {
  if (!isValidId(id) || typeof title !== 'string') return false
  const chat = await readChat(id)
  if (!chat) return false
  const trimmed = title.trim().replace(/\s+/g, ' ').slice(0, 80)
  if (trimmed) {
    chat.title = trimmed
    chat.titleLocked = true
  } else {
    // Clearing the name hands the title back to auto-derivation.
    chat.title = deriveTitle(chat.messages)
    chat.titleLocked = false
  }
  await writeChat(chat)
  return true
}

export async function setChatPinned(id: unknown, pinned: unknown): Promise<boolean> {
  if (!isValidId(id)) return false
  const chat = await readChat(id)
  if (!chat) return false
  chat.pinned = pinned === true
  await writeChat(chat)
  return true
}

/** Used by backup restore — sanitizes a full raw chat and writes it under its own id. */
export async function importChat(raw: unknown): Promise<boolean> {
  const record = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  if (!isValidId(record.id)) return false
  const chat = sanitizeChat(record, record.id)
  if (!chat) return false
  await writeChat(chat)
  return true
}

export async function deleteChat(id: unknown): Promise<boolean> {
  if (!isValidId(id)) return false
  try {
    await fs.rm(chatFile(id))
    return true
  } catch {
    return false
  }
}

export async function deleteAllChats(): Promise<number> {
  const summaries = await listChats()
  let removed = 0
  for (const summary of summaries) {
    if (await deleteChat(summary.id)) removed += 1
  }
  return removed
}

export async function searchChats(query: unknown, scope?: ChatScope): Promise<ChatSummary[]> {
  if (typeof query !== 'string' || !query.trim()) return listChats(scope)
  const needle = query.trim().toLowerCase()
  const summaries = await listChats(scope)
  const results: ChatSummary[] = []
  for (const summary of summaries) {
    const chat = await readChat(summary.id)
    if (!chat) continue
    if (chat.title.toLowerCase().includes(needle)) {
      results.push(summary)
      continue
    }
    const hit = chat.messages.find((m) => m.content.toLowerCase().includes(needle))
    if (hit) {
      const at = hit.content.toLowerCase().indexOf(needle)
      const start = Math.max(0, at - 40)
      results.push({ ...summary, snippet: `…${hit.content.slice(start, at + needle.length + 40)}…` })
    }
  }
  return results
}

export async function exportChatMarkdown(chat: StoredChat, filePath: string): Promise<void> {
  const lines: string[] = [
    `# ${chat.title}`,
    '',
    `_Exported from PowerStation · ${new Date(chat.updatedAt).toLocaleString()}_`,
    '',
  ]
  for (const message of chat.messages) {
    lines.push(message.role === 'user' ? '## You' : '## Model')
    if (message.attachments?.length) {
      lines.push('', `> Attached: ${message.attachments.map((a) => a.name).join(', ')}`)
    }
    lines.push('', message.content, '')
    if (message.sources?.length) lines.push(`> Sources: ${message.sources.join(', ')}`, '')
    if (message.toolCalls?.length) {
      lines.push('> Tool activity:')
      for (const call of message.toolCalls) {
        const state = call.ok === null ? 'not run' : call.ok ? 'ok' : 'failed'
        lines.push(`> - \`${call.toolKey}\` — ${call.decision ?? 'unknown'} · ${state}${call.durationMs ? ` · ${call.durationMs}ms` : ''}`)
      }
      lines.push('')
    }
  }
  await fs.writeFile(filePath, lines.join('\n'), 'utf8')
}

/** Flatten a chat's tool activity for the exportable audit log. */
export function collectAuditLog(chat: StoredChat): Array<StoredToolCall & { messageIndex: number }> {
  const records: Array<StoredToolCall & { messageIndex: number }> = []
  chat.messages.forEach((message, messageIndex) => {
    for (const call of message.toolCalls ?? []) records.push({ ...call, messageIndex })
  })
  return records
}

export async function revealChatsDir(): Promise<boolean> {
  await fs.mkdir(chatsDir(), { recursive: true })
  shell.showItemInFolder(chatsDir())
  return true
}
