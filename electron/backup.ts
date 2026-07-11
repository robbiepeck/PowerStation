import { app } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { buildBackupJson, parseBackupJson } from './backupFormat.js'
import { applyRestoredState, getState, type PersistedState } from './config.js'
import * as chats from './chats.js'
import * as projects from './projects.js'
import * as customAgents from './customAgents.js'
import { skillsDir } from './skills.js'
import * as scheduledJobs from './scheduledJobs.js'

export type BackupSummary = {
  chats: number
  skills: number
  projects: number
  agents: number
  schedules: number
  settingsApplied: boolean
}

const SLUG_PATTERN = /^[a-z0-9-]{1,60}$/

async function collectSkillFiles(): Promise<Array<{ slug: string; content: string }>> {
  let files: string[]
  try {
    files = await fs.readdir(skillsDir())
  } catch {
    return []
  }
  const out: Array<{ slug: string; content: string }> = []
  for (const file of files) {
    if (!file.endsWith('.md')) continue
    const slug = file.slice(0, -3).toLowerCase()
    if (!SLUG_PATTERN.test(slug)) continue
    try {
      out.push({ slug, content: await fs.readFile(path.join(skillsDir(), file), 'utf8') })
    } catch {
      void 0
    }
  }
  return out
}

export async function exportBackup(filePath: string): Promise<BackupSummary> {
  const state = await getState()
  const summaries = await chats.listChats()
  const fullChats = (await Promise.all(summaries.map((s) => chats.getChat(s.id)))).filter((c) => c !== null)
  const skills = await collectSkillFiles()
  const projectList = await projects.listProjects()
  const agentList = await customAgents.listAgents()
  const scheduleList = await scheduledJobs.exportJobDefinitions()

  const portableState: Partial<PersistedState> = { ...state }
  delete portableState.lastSeenVersion
  const json = buildBackupJson({
    appVersion: app.getVersion(),
    state: portableState as unknown as Record<string, unknown>,
    skills,
    chats: fullChats,
    projects: projectList,
    agents: agentList,
    schedules: scheduleList,
  })
  await fs.writeFile(filePath, json, { encoding: 'utf8', mode: 0o600 })
  return {
    chats: fullChats.length,
    skills: skills.length,
    projects: projectList.length,
    agents: agentList.length,
    schedules: scheduleList.length,
    settingsApplied: true,
  }
}

export async function restoreBackup(filePath: string): Promise<BackupSummary> {
  const stat = await fs.stat(filePath)
  if (!stat.isFile() || stat.size > 300 * 1024 * 1024) throw new Error('Backup file is too large.')
  const archive = parseBackupJson(await fs.readFile(filePath, 'utf8'))

  let skillCount = 0
  await fs.mkdir(skillsDir(), { recursive: true, mode: 0o700 })
  for (const skill of archive.skills) {
    await fs.writeFile(path.join(skillsDir(), `${skill.slug}.md`), skill.content, { encoding: 'utf8', mode: 0o600 })
    skillCount += 1
  }

  let chatCount = 0
  for (const chat of archive.chats) {
    if (await chats.importChat(chat)) chatCount += 1
  }

  let projectCount = 0
  for (const project of archive.projects) {
    if (await projects.importProject(project)) projectCount += 1
  }

  let agentCount = 0
  for (const agent of archive.agents) {
    if (await customAgents.importAgent(agent)) agentCount += 1
  }

  const scheduleCount = await scheduledJobs.importJobDefinitions(archive.schedules)

  await applyRestoredState(archive.state as Partial<PersistedState>)

  return {
    chats: chatCount,
    skills: skillCount,
    projects: projectCount,
    agents: agentCount,
    schedules: scheduleCount,
    settingsApplied: true,
  }
}
