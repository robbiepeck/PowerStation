import { app } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'

export type Settings = {
  memoryBudgetGb: number
  computeCap: number
  contextTokens: number
  autoUnloadIdle: boolean
  lowPowerBias: boolean
  temperature: number
  maxTokens: number
}

export type PersistedState = {
  modelFolders: string[]
  importedModelPaths: string[]
  selectedModelPath: string | null
  settings: Settings
}

const defaultSettings: Settings = {
  memoryBudgetGb: 14,
  computeCap: 72,
  contextTokens: 8192,
  autoUnloadIdle: true,
  lowPowerBias: false,
  temperature: 0.7,
  maxTokens: 1024,
}

let state: PersistedState | null = null

function configPath() {
  return path.join(app.getPath('userData'), 'powerstation-config.json')
}

export function managedModelsDir() {
  return path.join(app.getPath('userData'), 'models')
}

function normalize(parsed: Partial<PersistedState> | null): PersistedState {
  const managed = managedModelsDir()
  const folders = Array.isArray(parsed?.modelFolders) ? parsed!.modelFolders.filter((f) => typeof f === 'string') : []
  if (!folders.includes(managed)) folders.unshift(managed)
  return {
    modelFolders: folders,
    importedModelPaths: Array.isArray(parsed?.importedModelPaths)
      ? parsed!.importedModelPaths.filter((p) => typeof p === 'string')
      : [],
    selectedModelPath: typeof parsed?.selectedModelPath === 'string' ? parsed!.selectedModelPath : null,
    settings: { ...defaultSettings, ...(parsed?.settings ?? {}) },
  }
}

export async function loadState(): Promise<PersistedState> {
  if (state) return state
  await fs.mkdir(managedModelsDir(), { recursive: true })
  try {
    const raw = await fs.readFile(configPath(), 'utf8')
    state = normalize(JSON.parse(raw) as Partial<PersistedState>)
  } catch {
    state = normalize(null)
  }
  return state
}

export async function getState(): Promise<PersistedState> {
  return state ?? loadState()
}

export async function saveState(): Promise<void> {
  if (!state) return
  await fs.writeFile(configPath(), JSON.stringify(state, null, 2), 'utf8')
}

export async function patchSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await getState()
  current.settings = { ...current.settings, ...patch }
  await saveState()
  return current.settings
}

export async function mutate(fn: (current: PersistedState) => void): Promise<PersistedState> {
  const current = await getState()
  fn(current)
  await saveState()
  return current
}
