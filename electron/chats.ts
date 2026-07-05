// Conversation persistence. Chats are plain JSON files — one per conversation
// — in the app's user-data directory, so "where is my data" has a concrete,
// revealable answer. Files are written only while the save-chats setting is
// on, and everything on disk is sanitised on the way back in.

import { app, shell } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'

export type StoredChatMessage = {
  role: 'user' | 'assistant'
  content: string
  tokensPerSec?: number
}

export type StoredChat = {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  modelPath: string | null
  messages: StoredChatMessage[]
}

export type ChatSummary = {
  id: string
  title: string
  updatedAt: number
  messageCount: number
}

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
      return { role, content, ...(tokensPerSec !== undefined ? { tokensPerSec } : {}) }
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
    createdAt: typeof record.createdAt === 'number' ? record.createdAt : Date.now(),
    updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : Date.now(),
    modelPath: typeof record.modelPath === 'string' ? record.modelPath : null,
    messages,
  }
}

async function readChat(id: string): Promise<StoredChat | null> {
  try {
    const raw = await fs.readFile(chatFile(id), 'utf8')
    return sanitizeChat(JSON.parse(raw), id)
  } catch {
    return null
  }
}

export async function listChats(): Promise<ChatSummary[]> {
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
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_CHATS)
    .map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt, messageCount: c.messages.length }))
}

export async function getChat(id: unknown): Promise<StoredChat | null> {
  if (!isValidId(id)) return null
  return readChat(id)
}

export async function saveChat(payload: {
  id?: unknown
  messages: unknown
  modelPath?: unknown
}): Promise<{ id: string } | null> {
  const messages = sanitizeMessages(payload.messages)
  if (!messages.length) return null
  const id = isValidId(payload.id) ? payload.id : newId()
  const existing = await readChat(id)
  const chat: StoredChat = {
    id,
    title: deriveTitle(messages),
    createdAt: existing?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
    modelPath: typeof payload.modelPath === 'string' ? payload.modelPath : existing?.modelPath ?? null,
    messages,
  }
  await fs.mkdir(chatsDir(), { recursive: true })
  await fs.writeFile(chatFile(id), JSON.stringify(chat, null, 1), 'utf8')
  return { id }
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

export async function revealChatsDir(): Promise<boolean> {
  await fs.mkdir(chatsDir(), { recursive: true })
  shell.showItemInFolder(chatsDir())
  return true
}
