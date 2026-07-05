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
  utilities: UtilitySettings
}

export type UtilityItem = {
  id: string
  label: string
}

export type McpServerConfig = {
  id: string
  name: string
  command: string
  enabled: boolean
}

export type ToolPermission = 'allow' | 'ask' | 'deny'

export type OnboardingState = {
  completed: boolean
  useCase: string | null
  priority: string | null
}

export type UtilitySettings = {
  systemPrompt: string
  skills: UtilityItem[]
  connectors: UtilityItem[]
  mcpServers: McpServerConfig[]
}

export type PersistedState = {
  modelFolders: string[]
  importedModelPaths: string[]
  selectedModelPath: string | null
  settings: Settings
  toolPermissions: Record<string, ToolPermission>
  onboarding: OnboardingState
}

const defaultUtilities: UtilitySettings = {
  systemPrompt: '',
  skills: [],
  connectors: [],
  mcpServers: [],
}

const defaultSettings: Settings = {
  memoryBudgetGb: 14,
  computeCap: 72,
  contextTokens: 8192,
  autoUnloadIdle: true,
  lowPowerBias: false,
  temperature: 0.7,
  maxTokens: 1024,
  utilities: defaultUtilities,
}

let state: PersistedState | null = null

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function boolOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function cleanString(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

function sanitizeUtilityItems(value: unknown, prefix: string): UtilityItem[] {
  if (!Array.isArray(value)) return []
  return value
    .slice(0, 80)
    .map((item, index) => {
      const record = typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : null
      const label = cleanString(record?.label, 160)
      if (!label) return null
      const id = cleanString(record?.id, 120) || `${prefix}-${index}`
      return { id, label }
    })
    .filter((item): item is UtilityItem => Boolean(item))
}

function sanitizeMcpServers(value: unknown): McpServerConfig[] {
  if (!Array.isArray(value)) return []
  // Server names must be unique: tool keys (permissions, the model-facing
  // function registry) are derived from them, and duplicates would collide.
  const seenNames = new Set<string>()
  return value
    .slice(0, 40)
    .map((item, index) => {
      const record = typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : null
      let name = cleanString(record?.name, 120)
      const command = cleanString(record?.command, 2000)
      if (!name || !command) return null
      for (let n = 2; seenNames.has(name.toLowerCase()); n++) {
        name = `${cleanString(record?.name, 110)} (${n})`
      }
      seenNames.add(name.toLowerCase())
      const id = cleanString(record?.id, 120) || `mcp-${index}`
      return { id, name, command, enabled: boolOr(record?.enabled, true) }
    })
    .filter((server): server is McpServerConfig => Boolean(server))
}

function sanitizeToolPermissions(value: unknown): Record<string, ToolPermission> {
  if (typeof value !== 'object' || value === null) return {}
  const out: Record<string, ToolPermission> = {}
  for (const [key, permission] of Object.entries(value as Record<string, unknown>).slice(0, 500)) {
    const cleanKey = cleanString(key, 200)
    if (cleanKey && (permission === 'allow' || permission === 'ask' || permission === 'deny')) {
      out[cleanKey] = permission
    }
  }
  return out
}

function sanitizeOnboarding(value: unknown): OnboardingState {
  const record = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
  return {
    completed: boolOr(record.completed, false),
    useCase: cleanString(record.useCase, 40) || null,
    priority: cleanString(record.priority, 40) || null,
  }
}

function sanitizeUtilities(value: unknown): UtilitySettings {
  const record = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
  return {
    systemPrompt: cleanString(record.systemPrompt, 20000),
    skills: sanitizeUtilityItems(record.skills, 'skill'),
    connectors: sanitizeUtilityItems(record.connectors, 'connector'),
    mcpServers: sanitizeMcpServers(record.mcpServers),
  }
}

// Settings arrive from the renderer (settings:update) and from a possibly
// corrupted on-disk config, so every field is coerced and range-clamped here
// before it can reach llama.cpp (a NaN context size would otherwise crash it).
function sanitizeSettings(patch: Partial<Settings> | null | undefined, base: Settings): Settings {
  const s = { ...base, ...(patch ?? {}) }
  const utilities = { ...base.utilities, ...((patch?.utilities as Partial<UtilitySettings> | undefined) ?? {}) }
  return {
    memoryBudgetGb: clampNumber(s.memoryBudgetGb, 4, 64, defaultSettings.memoryBudgetGb),
    computeCap: clampNumber(s.computeCap, 20, 100, defaultSettings.computeCap),
    contextTokens: clampNumber(s.contextTokens, 512, 32768, defaultSettings.contextTokens),
    autoUnloadIdle: boolOr(s.autoUnloadIdle, defaultSettings.autoUnloadIdle),
    lowPowerBias: boolOr(s.lowPowerBias, defaultSettings.lowPowerBias),
    temperature: clampNumber(s.temperature, 0, 2, defaultSettings.temperature),
    maxTokens: clampNumber(s.maxTokens, 0, 4096, defaultSettings.maxTokens),
    utilities: sanitizeUtilities(utilities),
  }
}

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
    settings: sanitizeSettings(parsed?.settings ?? null, defaultSettings),
    toolPermissions: sanitizeToolPermissions(parsed?.toolPermissions),
    onboarding: sanitizeOnboarding(parsed?.onboarding),
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
  current.settings = sanitizeSettings(patch, current.settings)
  await saveState()
  return current.settings
}

export async function mutate(fn: (current: PersistedState) => void): Promise<PersistedState> {
  const current = await getState()
  fn(current)
  await saveState()
  return current
}
