import { app, shell } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import {
  buildAgentShare,
  isValidAgentId,
  newAgentId,
  parseAgentShare,
  sanitizeCustomAgent,
  type CustomAgent,
} from './customAgentFormat.js'

const MAX_AGENTS = 100

export function agentsDir(): string {
  return path.join(app.getPath('userData'), 'agents')
}

function agentFile(id: string): string {
  return path.join(agentsDir(), `${id}.json`)
}

async function readAgent(id: string): Promise<CustomAgent | null> {
  try {
    const raw = await fs.readFile(agentFile(id), 'utf8')
    return sanitizeCustomAgent(JSON.parse(raw), id)
  } catch {
    return null
  }
}

async function writeAgent(agent: CustomAgent): Promise<void> {
  await fs.mkdir(agentsDir(), { recursive: true, mode: 0o700 })
  await fs.chmod(agentsDir(), 0o700).catch(() => undefined)
  const target = agentFile(agent.id)
  const temp = `${target}.${process.pid}.tmp`
  await fs.writeFile(temp, JSON.stringify(agent, null, 1), { encoding: 'utf8', mode: 0o600 })
  await fs.rename(temp, target)
}

export async function listAgents(): Promise<CustomAgent[]> {
  let files: string[]
  try {
    files = await fs.readdir(agentsDir())
  } catch {
    return []
  }
  const ids = files
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -5))
    .filter(isValidAgentId)
  const agents = (await Promise.all(ids.map(readAgent))).filter((a): a is CustomAgent => a !== null)
  return agents.sort((a, b) => a.name.localeCompare(b.name)).slice(0, MAX_AGENTS)
}

export async function getAgent(id: unknown): Promise<CustomAgent | null> {
  if (!isValidAgentId(id)) return null
  return readAgent(id)
}

export async function saveAgent(payload: unknown): Promise<CustomAgent | null> {
  const record = typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {}
  const id = isValidAgentId(record.id) ? record.id : newAgentId()
  const existing = await readAgent(id)
  const agent = sanitizeCustomAgent({ ...record, createdAt: existing?.createdAt, updatedAt: Date.now() }, id)
  if (!agent) return null
  await writeAgent(agent)
  return agent
}

export async function importAgent(raw: unknown): Promise<boolean> {
  const record = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  if (!isValidAgentId(record.id)) return false
  const agent = sanitizeCustomAgent(record, record.id)
  if (!agent) return false
  await writeAgent(agent)
  return true
}

export async function exportAgentShare(id: unknown): Promise<string | null> {
  const agent = await getAgent(id)
  return agent ? buildAgentShare(agent) : null
}

export async function importAgentShare(text: string): Promise<CustomAgent | null> {
  const raw = parseAgentShare(text)
  const id = newAgentId()
  const now = Date.now()
  const agent = sanitizeCustomAgent({ ...raw, createdAt: now, updatedAt: now }, id)
  if (!agent) return null
  await writeAgent(agent)
  return agent
}

export async function deleteAgent(id: unknown): Promise<boolean> {
  if (!isValidAgentId(id)) return false
  try {
    await fs.rm(agentFile(id))
    return true
  } catch {
    return false
  }
}

export async function revealAgentsDir(): Promise<boolean> {
  await fs.mkdir(agentsDir(), { recursive: true, mode: 0o700 })
  shell.showItemInFolder(agentsDir())
  return true
}
