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
  saveChats: boolean

  autoCompact: boolean

  agentProfile: 'trusted' | 'cautious'

  agentPlanPreview: boolean
  utilities: UtilitySettings
}

export type BenchmarkRecord = {
  tokensPerSec: number

  promptTokensPerSec: number
  outputTokens: number
  contextTokens: number
  measuredAt: number
}

export type ImpactSource = 'chat' | 'api' | 'compare'

export type ImpactUsageBucket = {
  generationCount: number
  elapsedMs: number
  energyWh: number
  outputTokenEstimate: number
}

export type ImpactModelUsage = ImpactUsageBucket & {
  modelName: string
  fileName: string
  lastUsedAt: number
}

export type ImpactUsageStats = ImpactUsageBucket & {
  schemaVersion: 1
  startedAt: number
  updatedAt: number
  byModel: Record<string, ImpactModelUsage>
  bySource: Record<ImpactSource, ImpactUsageBucket>
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

  skillModes: Record<string, 'auto' | 'always'>
  mcpServers: McpServerConfig[]
}

export type PersistedState = {
  modelFolders: string[]
  importedModelPaths: string[]
  selectedModelPath: string | null
  settings: Settings
  toolPermissions: Record<string, ToolPermission>
  onboarding: OnboardingState

  benchmarks: Record<string, BenchmarkRecord>

  lastSeenVersion: string

  activeProjectId: string | null

  seededSkillSlugs: string[]

  apiServer: ApiServerConfig
  /** Cumulative local inference impact counters for this install. */
  impactUsage: ImpactUsageStats
}

export type ApiServerConfig = {
  enabled: boolean
  port: number

  token: string
}

const defaultUtilities: UtilitySettings = {
  systemPrompt: '',
  skillModes: {},
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
  saveChats: true,
  autoCompact: true,
  agentProfile: 'trusted',
  agentPlanPreview: false,
  utilities: defaultUtilities,
}

function emptyImpactBucket(): ImpactUsageBucket {
  return {
    generationCount: 0,
    elapsedMs: 0,
    energyWh: 0,
    outputTokenEstimate: 0,
  }
}

function defaultImpactUsage(now = Date.now()): ImpactUsageStats {
  return {
    schemaVersion: 1,
    startedAt: now,
    updatedAt: now,
    byModel: {},
    bySource: {
      chat: emptyImpactBucket(),
      api: emptyImpactBucket(),
      compare: emptyImpactBucket(),
    },
    ...emptyImpactBucket(),
  }
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

function sanitizeMcpServers(value: unknown): McpServerConfig[] {
  if (!Array.isArray(value)) return []

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
  const skillModes: Record<string, 'auto' | 'always'> = {}
  if (typeof record.skillModes === 'object' && record.skillModes !== null) {
    for (const [rawSlug, mode] of Object.entries(record.skillModes as Record<string, unknown>).slice(0, 100)) {
      const slug = cleanString(rawSlug, 60).toLowerCase()
      if (/^[a-z0-9-]+$/.test(slug) && (mode === 'auto' || mode === 'always')) skillModes[slug] = mode
    }
  }

  if (Array.isArray(record.enabledSkills)) {
    for (const raw of record.enabledSkills.slice(0, 100)) {
      const slug = cleanString(raw, 60).toLowerCase()
      if (/^[a-z0-9-]+$/.test(slug) && !skillModes[slug]) skillModes[slug] = 'always'
    }
  }
  return {
    systemPrompt: cleanString(record.systemPrompt, 20000),
    skillModes,
    mcpServers: sanitizeMcpServers(record.mcpServers),
  }
}

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
    saveChats: boolOr(s.saveChats, defaultSettings.saveChats),
    autoCompact: boolOr(s.autoCompact, defaultSettings.autoCompact),
    agentProfile: s.agentProfile === 'cautious' ? 'cautious' : 'trusted',
    agentPlanPreview: boolOr(s.agentPlanPreview, defaultSettings.agentPlanPreview),
    utilities: sanitizeUtilities(utilities),
  }
}

function sanitizeBenchmarks(value: unknown): Record<string, BenchmarkRecord> {
  if (typeof value !== 'object' || value === null) return {}
  const out: Record<string, BenchmarkRecord> = {}
  for (const [key, record] of Object.entries(value as Record<string, unknown>).slice(0, 300)) {
    const cleanKey = cleanString(key, 200).toLowerCase()
    const r = typeof record === 'object' && record !== null ? (record as Record<string, unknown>) : null
    const tokensPerSec = typeof r?.tokensPerSec === 'number' && Number.isFinite(r.tokensPerSec) ? r.tokensPerSec : null
    if (!cleanKey || tokensPerSec === null || tokensPerSec <= 0) continue
    out[cleanKey] = {
      tokensPerSec,
      promptTokensPerSec: clampNumber(r?.promptTokensPerSec, 0, 1e6, 0),
      outputTokens: clampNumber(r?.outputTokens, 0, 100000, 0),
      contextTokens: clampNumber(r?.contextTokens, 0, 1048576, 0),
      measuredAt: clampNumber(r?.measuredAt, 0, Number.MAX_SAFE_INTEGER, 0),
    }
  }
  return out
}

function cleanImpactBucket(value: unknown): ImpactUsageBucket {
  const r = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
  return {
    generationCount: clampNumber(r.generationCount, 0, 10_000_000, 0),
    elapsedMs: clampNumber(r.elapsedMs, 0, Number.MAX_SAFE_INTEGER, 0),
    energyWh: clampNumber(r.energyWh, 0, 1_000_000_000, 0),
    outputTokenEstimate: clampNumber(r.outputTokenEstimate, 0, Number.MAX_SAFE_INTEGER, 0),
  }
}

function sanitizeImpactUsage(value: unknown): ImpactUsageStats {
  const now = Date.now()
  const fallback = defaultImpactUsage(now)
  const r = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
  const bySourceRaw = typeof r.bySource === 'object' && r.bySource !== null ? (r.bySource as Record<string, unknown>) : {}
  const byModelRaw = typeof r.byModel === 'object' && r.byModel !== null ? (r.byModel as Record<string, unknown>) : {}
  const byModel: Record<string, ImpactModelUsage> = {}
  for (const [key, raw] of Object.entries(byModelRaw).slice(0, 300)) {
    const cleanKey = cleanString(key, 300)
    if (!cleanKey) continue
    const record = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
    const bucket = cleanImpactBucket(record)
    byModel[cleanKey] = {
      ...bucket,
      modelName: cleanString(record.modelName, 200) || cleanString(record.fileName, 200) || cleanKey,
      fileName: cleanString(record.fileName, 200) || cleanKey,
      lastUsedAt: clampNumber(record.lastUsedAt, 0, Number.MAX_SAFE_INTEGER, 0),
    }
  }
  return {
    schemaVersion: 1,
    startedAt: clampNumber(r.startedAt, 0, Number.MAX_SAFE_INTEGER, fallback.startedAt),
    updatedAt: clampNumber(r.updatedAt, 0, Number.MAX_SAFE_INTEGER, fallback.updatedAt),
    byModel,
    bySource: {
      chat: cleanImpactBucket(bySourceRaw.chat),
      api: cleanImpactBucket(bySourceRaw.api),
      compare: cleanImpactBucket(bySourceRaw.compare),
    },
    ...cleanImpactBucket(r),
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
    benchmarks: sanitizeBenchmarks(parsed?.benchmarks),
    lastSeenVersion: cleanString(parsed?.lastSeenVersion, 40),
    activeProjectId: typeof parsed?.activeProjectId === 'string' ? parsed!.activeProjectId : null,
    seededSkillSlugs: Array.isArray(parsed?.seededSkillSlugs)
      ? parsed!.seededSkillSlugs.filter((s): s is string => typeof s === 'string').slice(0, 200)
      : [],
    apiServer: sanitizeApiServer(parsed?.apiServer),
    impactUsage: sanitizeImpactUsage(parsed?.impactUsage),
  }
}

function sanitizeApiServer(value: unknown): ApiServerConfig {
  const r = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
  return {
    enabled: r.enabled === true,
    port: clampNumber(r.port, 1024, 65535, 4141),

    token: typeof r.token === 'string' && /^[A-Za-z0-9_-]{16,100}$/.test(r.token) ? r.token : '',
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

export async function applyRestoredState(restored: Partial<PersistedState>): Promise<void> {
  const current = await getState()
  state = normalize({ ...current, ...restored, lastSeenVersion: current.lastSeenVersion })
  await saveState()
}

export async function mutate(fn: (current: PersistedState) => void): Promise<PersistedState> {
  const current = await getState()
  fn(current)
  await saveState()
  return current
}
