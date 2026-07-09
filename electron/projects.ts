import { app, shell } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { getState, mutate } from './config.js'
import { isValidProjectId, newProjectId, sanitizeProject, type Project } from './projectFormat.js'

const MAX_PROJECTS = 50

export function projectsDir(): string {
  return path.join(app.getPath('userData'), 'projects')
}

function projectFile(id: string): string {
  return path.join(projectsDir(), `${id}.json`)
}

async function readProject(id: string): Promise<Project | null> {
  try {
    const raw = await fs.readFile(projectFile(id), 'utf8')
    return sanitizeProject(JSON.parse(raw), id)
  } catch {
    return null
  }
}

async function writeProject(project: Project): Promise<void> {
  await fs.mkdir(projectsDir(), { recursive: true })
  await fs.writeFile(projectFile(project.id), JSON.stringify(project, null, 1), 'utf8')
}

export async function listProjects(): Promise<Project[]> {
  let files: string[]
  try {
    files = await fs.readdir(projectsDir())
  } catch {
    return []
  }
  const ids = files
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -5))
    .filter(isValidProjectId)
  const projects = (await Promise.all(ids.map(readProject))).filter((p): p is Project => p !== null)
  return projects.sort((a, b) => a.name.localeCompare(b.name)).slice(0, MAX_PROJECTS)
}

export async function getProject(id: unknown): Promise<Project | null> {
  if (!isValidProjectId(id)) return null
  return readProject(id)
}

export async function saveProject(payload: unknown): Promise<Project | null> {
  const record = typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {}
  const id = isValidProjectId(record.id) ? record.id : newProjectId()
  const existing = await readProject(id)
  const project = sanitizeProject({ ...record, createdAt: existing?.createdAt, updatedAt: Date.now() }, id)
  if (!project) return null
  await writeProject(project)
  return project
}

export async function importProject(raw: unknown): Promise<boolean> {
  const record = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  if (!isValidProjectId(record.id)) return false
  const project = sanitizeProject(record, record.id)
  if (!project) return false
  await writeProject(project)
  return true
}

export async function deleteProject(id: unknown): Promise<boolean> {
  if (!isValidProjectId(id)) return false
  try {
    await fs.rm(projectFile(id))
  } catch {
    return false
  }
  const state = await getState()
  if (state.activeProjectId === id) {
    await mutate((current) => {
      current.activeProjectId = null
    })
  }
  return true
}

export async function setActiveProject(id: unknown): Promise<Project | null> {
  const project = id === null ? null : await getProject(id)
  await mutate((current) => {
    current.activeProjectId = project?.id ?? null
  })
  return project
}

export async function getActiveProject(): Promise<Project | null> {
  const state = await getState()
  if (!state.activeProjectId) return null
  const project = await readProject(state.activeProjectId)

  if (!project) {
    await mutate((current) => {
      current.activeProjectId = null
    })
  }
  return project
}

export async function revealProjectsDir(): Promise<boolean> {
  await fs.mkdir(projectsDir(), { recursive: true })
  shell.showItemInFolder(projectsDir())
  return true
}
