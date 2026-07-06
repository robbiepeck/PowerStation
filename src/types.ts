export type McpServerConfig = {
  id: string
  name: string
  command: string
  enabled: boolean
}

export type SkillMode = 'off' | 'auto' | 'always'

export type UtilitySettings = {
  systemPrompt: string
  /** Per-skill activation: absent = off, 'always' = every turn, 'auto' = when triggers match. */
  skillModes: Record<string, 'auto' | 'always'>
  mcpServers: McpServerConfig[]
}

export type SkillInfo = {
  slug: string
  name: string
  description: string
  body: string
  triggers: string[]
  mode: SkillMode
  tokenEstimate: number
  builtIn: boolean
}

export type ConnectorEntry = {
  id: string
  name: string
  tagline: string
  detail: string
  npmPackage: string
  args: string[]
  needsFolder: boolean
  maintainer: 'official' | 'community'
  worksOffline: boolean
  permissionsNote: string
}

export type ConnectorCatalog = {
  schemaVersion: number
  updatedAt: string
  source: 'bundled' | 'cached' | 'remote'
  connectors: ConnectorEntry[]
}

export type SkillGalleryEntry = {
  id: string
  name: string
  description: string
  category: string
  triggers: string
  body: string
}

export type SkillCatalog = {
  schemaVersion: number
  updatedAt: string
  source: 'bundled' | 'cached' | 'remote'
  skills: SkillGalleryEntry[]
}

export type OllamaModel = {
  name: string
  blobPath: string
  sizeBytes: number
  parameterSize: string | null
  quantization: string | null
}

export type OllamaStatus = {
  detected: boolean
  running: boolean
  version: string | null
  models: OllamaModel[]
}

export type LmStudioModel = {
  name: string
  fileName: string
  path: string
  sizeBytes: number
}

export type LmStudioStatus = {
  detected: boolean
  models: LmStudioModel[]
}

export type KvGeometry = {
  nLayers: number
  nKvHeads: number
  headDim: number
}

export type ModelInfo = {
  path: string
  fileName: string
  name: string
  architecture: string | null
  parameters: string | null
  quantization: string | null
  contextLength: number | null
  /** Total size including sibling split parts. */
  sizeBytes: number
  source: 'folder' | 'imported'
  geometry: KvGeometry | null
  templateSupportsTools: boolean | null
  /** Capability tier resolved by the main process (catalog or template heuristic). */
  toolCalling: ToolCallingTier
  /** Measured tokens/sec on this machine, when a benchmark has run. */
  measuredTps: number | null
}

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
  utilities: UtilitySettings
}

export type BenchmarkRecord = {
  tokensPerSec: number
  promptTokensPerSec: number
  outputTokens: number
  contextTokens: number
  measuredAt: number
}

export type StoredAttachment = {
  name: string
  tokenEstimate: number
  text: string
}

export type StoredToolCall = {
  toolKey: string
  argsJson: string
  ok: boolean | null
  summary: string
  decision: ToolDecision | null
  preview: ToolPreview | null
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
  titleLocked: boolean
  pinned: boolean
  projectId: string | null
  agent: AgentBadge | null
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
  agent: AgentBadge | null
  updatedAt: number
  messageCount: number
  snippet?: string
}

export type ChatScope = { projectId: string | null }

export type ProjectKnowledge = {
  folderId: string
  folder: string
  name: string
}

export type Project = {
  id: string
  name: string
  instructions: string
  modelPath: string | null
  knowledge: ProjectKnowledge | null
  skillModes: Record<string, SkillMode>
  mcpServerIds: string[]
  createdAt: number
  updatedAt: number
}

export type BackupSummary = {
  chats: number
  skills: number
  projects: number
  agents: number
  settingsApplied: boolean
}

export type AgentKnowledge = {
  folderId: string
  folder: string
  name: string
}

export type CustomAgent = {
  id: string
  name: string
  emoji: string
  description: string
  instructions: string
  knowledge: AgentKnowledge[]
  createdAt: number
  updatedAt: number
}

export type AgentBadge = { id: string; name: string; emoji: string }

export type StorageLocation = {
  id: string
  label: string
  path: string
  exists: boolean
  sizeBytes: number
  fileCount: number
  approximate: boolean
  note: string
  action: 'reveal-only'
}

export type DuplicateGroup = {
  key: string
  copies: Array<{ app: string; name: string; path: string; sizeBytes: number }>
  wastedBytes: number
}

export type StorageReport = {
  disk: { totalGb: number; freeGb: number; usedGb: number } | null
  locations: StorageLocation[]
  duplicates: DuplicateGroup[]
  scannedAt: number
}

export type Reclaimable = {
  id: string
  label: string
  detail: string
  sizeBytes: number
  consequence: string
}

export type IntegrityResult = {
  path: string
  name: string
  status: 'ok' | 'missing' | 'not-gguf' | 'size-mismatch' | 'unreadable'
  detail: string
}

export type RepairLogEntry = {
  id: string
  label: string
  sizeBytes: number
  timestamp: number
}

export type ExtractedFile = {
  name: string
  path: string
  chars: number
  tokenEstimate: number
  text: string
  truncated: boolean
}

export type ExtractResult = { ok: true; file: ExtractedFile } | { ok: false; name: string; error: string }

export type FolderIndexInfo = {
  folderId: string
  folder: string
  name: string
  fileCount: number
  chunkCount: number
  builtAt: number
}

export type IndexProgress = { phase: 'scanning' | 'embedding-model' | 'embedding'; done: number; total: number }

export type RagIndexListing = FolderIndexInfo & {
  sizeBytes: number
  /** Folder contents changed since the index was built. */
  stale: boolean
  /** Folder no longer exists on disk. */
  missing: boolean
}

export type WhatsNew = { currentVersion: string; previousVersion: string | null; show: boolean }

export type MemoryPressureLevel = 'normal' | 'warn' | 'critical'

export type TelemetrySnapshot = {
  timestamp: number
  cpu: { load: number; cores: number; real: boolean }
  ram: { usedGb: number; totalGb: number; real: boolean }
  gpu: { load: number | null; name: string | null; type: string | null; real: boolean }
  vram: { usedGb: number | null; totalGb: number | null; real: boolean }
  storage: { usedGb: number; totalGb: number; freeGb: number; mount: string | null; real: boolean }
  power: { watts: number; estimated: boolean }
  battery: { present: boolean; charging: boolean; percent: number | null; real: boolean }
  thermal: { celsius: number | null; headroomPct: number; real: boolean }
  pressure: { level: MemoryPressureLevel | null; real: boolean }
  tokensPerSec: number
  model: { loaded: boolean; path: string | null }
}

export type DeviceInfo = {
  gpuType: string | false
  gpuNames: string[]
  vram: { total: number; used: number; free: number; unifiedSize: number } | null
  health: {
    modelName: string | null
    introducedYear: number | null
    ageYears: number | null
    batteryCapacityPct: number | null
    batteryCycleCount: number | null
    performanceCapacityPct: number | null
    estimateNote: string
  }
}

export type HardwareProfile = {
  platform: string
  isAppleSilicon: boolean
  chip: string | null
  machineModel: string | null
  cpuCores: number
  totalRamBytes: number
  gpuBudgetBytes: number
  gpuBudgetIsMeasured: boolean
  /** The canonical "usable for AI" figure — same number the fit math uses. */
  usableBudgetBytes: number
  freeDiskBytes: number | null
  meetsFloor: boolean
}

export type ToolCallingTier = 'none' | 'single' | 'multi'
export type UseCase = 'everyday' | 'coding' | 'agents' | 'documents' | 'reasoning'

export type CatalogModel = {
  id: string
  name: string
  family: string
  hfRepo: string
  downloadUrl: string
  websiteUrl: string
  fileName: string
  sizeBytes: number
  quant: string
  totalParamsB: number
  activeParamsB: number | null
  geometry: KvGeometry | null
  kvBytesPerToken: number | null
  maxContext: number | null
  toolCalling: ToolCallingTier
  license: string
  minRamGb: number
  expectedTps: string | null
  useCases: UseCase[]
  goodAt: string[]
  strugglesWith: string[]
  vision: { mmprojUrl: string; mmprojFileName: string; mmprojSizeBytes: number } | null
}

export type Catalog = {
  schemaVersion: number
  updatedAt: string
  source: 'bundled' | 'cached' | 'remote'
  models: CatalogModel[]
}

export type FitVerdict = 'comfortable' | 'tight' | 'wont-fit'

export type FitReport = {
  verdict: FitVerdict
  fits: boolean
  /** True when the model only fits by offloading layers to the CPU (slower). */
  offload: boolean
  weightsBytes: number
  kvCacheBytes: number
  buffersBytes: number
  totalBytes: number
  budgetBytes: number
  headroomBytes: number
  headroomPct: number
  maxComfortableContext: number | null
  summary: string
  suggestions: string[]
}

export type Intent = {
  useCase: UseCase
  priority: 'speed' | 'balanced' | 'quality'
  maxDownloadGb?: number | null
}

export type Recommendation = {
  model: CatalogModel
  fit: FitReport
  defaultContextTokens: number
  score: number
  reasons: string[]
  versusPrimary?: string[]
}

export type ComparePhase = 'loading' | 'generating' | 'refused' | 'error' | 'skipped'
export type CompareStatusPayload = { requestId: string; slot: number; phase: ComparePhase; message?: string }
export type CompareTokenPayload = { requestId: string; slot: number; token: string }
export type CompareResultPayload = {
  requestId: string
  slot: number
  text: string
  tokensPerSec: number
  elapsedMs: number
  aborted: boolean
}

export type OnboardingState = {
  completed: boolean
  useCase: string | null
  priority: string | null
}

export type McpServerStatus = {
  id: string
  name: string
  state: 'connected' | 'connecting' | 'error' | 'disconnected'
  toolCount: number
  error: string | null
}

export type McpToolInfo = {
  key: string
  serverId: string
  serverName: string
  name: string
  description: string
  inputSchema: Record<string, unknown> | null
}

export type McpToolInfoResponse = {
  tools: McpToolInfo[]
  schemaTokens: number
  contextTokens: number
}

export type ToolPermission = 'allow' | 'ask' | 'deny'

export type DiffLine = { type: 'same' | 'add' | 'del' | 'skip'; text: string }

export type ToolPreview =
  | {
      kind: 'diff'
      path: string
      newFile: boolean
      lines: DiffLine[]
      summary: { added: number; removed: number }
      note: string | null
    }
  | { kind: 'move'; from: string; to: string }
  | { kind: 'note'; title: string; body: string }

export type PermissionRequest = {
  promptId: string
  requestId: string
  toolKey: string
  serverName: string
  toolName: string
  args: unknown
  preview: ToolPreview | null
}

export type PermissionDecision = 'allow-once' | 'allow-turn' | 'allow-always' | 'deny'

export type RuntimeEventPayload = {
  type: 'crashed' | 'autopaused'
  message: string
}

export type ChatStatusPayload =
  | { requestId: string; phase: 'starting' }
  | { requestId: string; phase: 'loading-model'; modelPath: string }
  | { requestId: string; phase: 'creating-context'; modelPath: string }
  | { requestId: string; phase: 'ready'; modelPath: string }
  | { requestId: string; phase: 'generating' }

export type ChatAdmissionPayload = {
  requestId: string
  contextTokens: number
  verdict: FitVerdict
  summary: string
  toolCount: number
  schemaTokens: number
  /** Names of skills applied to this turn (always-on + trigger-matched). */
  activeSkills: string[]
}

export type ChatToolCallPayload = { requestId: string; toolKey: string; args: unknown }
export type ChatToolResultPayload = {
  requestId: string
  toolKey: string
  ok: boolean
  summary: string
  decision: ToolDecision
  preview: ToolPreview | null
  durationMs: number
  timestamp: number
}

export type ChatDonePayload = {
  requestId: string
  text: string
  tokensPerSec: number
  /** Wall-clock generation time in the worker — the basis of the energy estimate. */
  elapsedMs: number
  aborted: boolean
  toolCallCount: number
  haltReason: 'repeated-call' | 'call-budget' | null
  contextUsed: number
  contextSize: number
}

export type DownloadProgress = { id: string; totalSize: number; downloadedSize: number }
export type DownloadDone = { id: string; filePath: string }
export type DownloadError = { id: string; message: string }

export type UpdateState = {
  phase: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error' | 'unsupported'
  currentVersion: string
  latestVersion?: string
  releaseName?: string
  message?: string
  progressPct?: number
  transferredBytes?: number
  totalBytes?: number
  bytesPerSecond?: number
  lastCheckedAt?: number
}

export type Unsubscribe = () => void

export type PowerStationBridge = {
  platform: string
  runtime: string
  app: {
    openExternal: (url: string) => Promise<boolean>
  }
  hardware: {
    profile: () => Promise<HardwareProfile>
  }
  catalog: {
    get: () => Promise<Catalog>
    refresh: () => Promise<Catalog>
    recommend: (intent: Intent) => Promise<Recommendation[]>
    fitCheck: (payload: { catalogId?: string; modelPath?: string; contextTokens?: number }) => Promise<FitReport | null>
  }
  onboarding: {
    get: () => Promise<OnboardingState>
    complete: (payload: { useCase?: string; priority?: string }) => Promise<OnboardingState>
  }
  models: {
    list: () => Promise<ModelInfo[]>
    pickFile: () => Promise<ModelInfo[]>
    pickFolder: () => Promise<ModelInfo[]>
    select: (filePath: string | null) => Promise<string | null>
    getSelected: () => Promise<string | null>
    remove: (filePath: string) => Promise<void>
    deleteFile: (filePath: string) => Promise<{ deleted: boolean; reason?: string }>
    reveal: (filePath: string) => Promise<boolean>
    download: (uri: string) => Promise<string>
    onDownloadProgress: (callback: (payload: DownloadProgress) => void) => Unsubscribe
    onDownloadDone: (callback: (payload: DownloadDone) => void) => Unsubscribe
    onDownloadError: (callback: (payload: DownloadError) => void) => Unsubscribe
    onBenchmarking: (callback: (payload: { id: string; filePath: string }) => void) => Unsubscribe
  }
  bench: {
    run: (modelPath: string) => Promise<BenchmarkRecord>
    results: () => Promise<Record<string, BenchmarkRecord>>
  }
  chats: {
    list: (scope?: ChatScope) => Promise<ChatSummary[]>
    get: (id: string) => Promise<StoredChat | null>
    save: (payload: {
      id?: string
      messages: StoredChatMessage[]
      modelPath?: string
      ragFolder?: { id: string; name: string } | null
      projectId?: string | null
      agent?: AgentBadge | null
    }) => Promise<{ id: string } | null>
    rename: (id: string, title: string) => Promise<boolean>
    pin: (id: string, pinned: boolean) => Promise<boolean>
    delete: (id: string) => Promise<boolean>
    deleteAll: () => Promise<number>
    reveal: () => Promise<boolean>
    search: (query: string, scope?: ChatScope) => Promise<ChatSummary[]>
    export: (id: string) => Promise<string | null>
    exportAudit: (id: string) => Promise<string | null>
  }
  agents: {
    list: () => Promise<CustomAgent[]>
    get: (id: string) => Promise<CustomAgent | null>
    save: (payload: Partial<CustomAgent> & { name: string }) => Promise<CustomAgent | null>
    delete: (id: string) => Promise<boolean>
    reveal: () => Promise<boolean>
  }
  projects: {
    list: () => Promise<Project[]>
    get: (id: string) => Promise<Project | null>
    getActive: () => Promise<Project | null>
    save: (payload: Partial<Project> & { name: string }) => Promise<Project | null>
    delete: (id: string) => Promise<boolean>
    setActive: (id: string | null) => Promise<Project | null>
    reveal: () => Promise<boolean>
  }
  backup: {
    export: (payload?: { filePath?: string }) => Promise<(BackupSummary & { filePath: string }) | null>
    restore: (payload?: { filePath?: string }) => Promise<BackupSummary | null>
  }
  repair: {
    report: () => Promise<StorageReport>
    reclaimables: () => Promise<Reclaimable[]>
    clean: (id: string) => Promise<{ removed: boolean; freedBytes: number }>
    reveal: (id: string) => Promise<boolean>
    integrity: () => Promise<IntegrityResult[]>
    log: () => Promise<RepairLogEntry[]>
  }
  compare: {
    run: (payload: { requestId: string; prompt: string; modelPaths: string[] }) => Promise<{ ok: boolean }>
    stop: (requestId: string) => Promise<boolean>
    onToken: (callback: (payload: CompareTokenPayload) => void) => Unsubscribe
    onStatus: (callback: (payload: CompareStatusPayload) => void) => Unsubscribe
    onResult: (callback: (payload: CompareResultPayload) => void) => Unsubscribe
    onDone: (callback: (payload: { requestId: string }) => void) => Unsubscribe
  }
  files: {
    pickAndExtract: () => Promise<ExtractResult[]>
    extract: (paths: string[]) => Promise<ExtractResult[]>
    pathForFile: (file: File) => string
  }
  rag: {
    index: (folder: string) => Promise<FolderIndexInfo>
    info: (folderId: string) => Promise<RagIndexListing | null>
    list: () => Promise<RagIndexListing[]>
    delete: (folderId: string) => Promise<boolean>
    reindex: (folderId: string) => Promise<FolderIndexInfo>
    onIndexProgress: (callback: (payload: IndexProgress) => void) => Unsubscribe
  }
  whatsNew: {
    get: () => Promise<WhatsNew>
    seen: () => Promise<boolean>
  }
  skills: {
    list: () => Promise<SkillInfo[]>
    save: (payload: {
      slug?: string
      name: string
      description: string
      body: string
      triggers?: string
    }) => Promise<SkillInfo | null>
    delete: (slug: string) => Promise<boolean>
    setMode: (payload: { slug: string; mode: SkillMode }) => Promise<boolean>
    reveal: () => Promise<boolean>
    gallery: () => Promise<SkillCatalog>
    install: (id: string) => Promise<SkillInfo | null>
  }
  connectors: {
    get: () => Promise<ConnectorCatalog>
    add: (payload: { connectorId: string; folder?: string }) => Promise<McpServerConfig[]>
    pickFolder: () => Promise<string | null>
  }
  lmstudio: {
    status: () => Promise<LmStudioStatus>
    import: (path: string) => Promise<string>
  }
  ollama: {
    status: () => Promise<OllamaStatus>
    import: (name: string) => Promise<string>
  }
  chat: {
    send: (payload: {
      requestId: string
      prompt: string
      history?: Array<{ role: 'user' | 'assistant'; text: string }>
      ragFolderId?: string
      ragQuery?: string
      agentId?: string
    }) => Promise<{ requestId: string; ok: boolean }>
    stop: (requestId: string) => Promise<boolean>
    reset: () => Promise<void>
    unload: () => Promise<void>
    onToken: (callback: (payload: { requestId: string; token: string }) => void) => Unsubscribe
    onDone: (callback: (payload: ChatDonePayload) => void) => Unsubscribe
    onError: (callback: (payload: { requestId: string; message: string }) => void) => Unsubscribe
    onStatus: (callback: (payload: ChatStatusPayload) => void) => Unsubscribe
    onAdmission: (callback: (payload: ChatAdmissionPayload) => void) => Unsubscribe
    onToolCall: (callback: (payload: ChatToolCallPayload) => void) => Unsubscribe
    onToolResult: (callback: (payload: ChatToolResultPayload) => void) => Unsubscribe
    onSources: (callback: (payload: { requestId: string; sources: string[] }) => void) => Unsubscribe
    onCompacted: (
      callback: (payload: { requestId: string; summary: string; beforeTokens: number; afterTokensEstimate: number }) => void,
    ) => Unsubscribe
  }
  agent: {
    respondPermission: (payload: { promptId: string; decision: PermissionDecision }) => Promise<boolean>
    onPermissionRequest: (callback: (payload: PermissionRequest) => void) => Unsubscribe
    onPermissionExpired: (callback: (payload: { promptId: string }) => void) => Unsubscribe
  }
  mcp: {
    statuses: () => Promise<McpServerStatus[]>
    toolInfo: () => Promise<McpToolInfoResponse>
    reconnect: (serverId: string) => Promise<McpServerStatus | null>
    onStatus: (callback: (payload: McpServerStatus[]) => void) => Unsubscribe
  }
  permissions: {
    get: () => Promise<Record<string, ToolPermission>>
    set: (payload: { toolKey: string; permission: ToolPermission }) => Promise<boolean>
  }
  runtimeEvents: {
    onEvent: (callback: (payload: RuntimeEventPayload) => void) => Unsubscribe
  }
  telemetry: { onUpdate: (callback: (snapshot: TelemetrySnapshot) => void) => Unsubscribe }
  settings: { get: () => Promise<Settings>; update: (patch: Partial<Settings>) => Promise<Settings> }
  device: { info: () => Promise<DeviceInfo> }
  updates: {
    getState: () => Promise<UpdateState>
    check: () => Promise<UpdateState>
    installLatest: () => Promise<UpdateState>
    onState: (callback: (state: UpdateState) => void) => Unsubscribe
  }
}

export type MessageRole = 'user' | 'assistant'

export type ToolDecision = 'allowed' | 'allowed-always' | 'allowed-turn' | 'auto-allowed' | 'denied' | 'blocked'

export type ToolCallRecord = {
  toolKey: string
  args: unknown
  ok: boolean | null
  summary: string | null
  decision?: ToolDecision
  preview?: ToolPreview | null
  durationMs?: number
  timestamp?: number
}

export type ChatTurn = {
  id: string
  role: MessageRole
  content: string
  requestId?: string
  status?: string
  streaming?: boolean
  error?: string
  tokensPerSec?: number
  aborted?: boolean
  toolCalls?: ToolCallRecord[]
  haltReason?: 'repeated-call' | 'call-budget' | null
  admission?: ChatAdmissionPayload
  attachments?: StoredAttachment[]
  sources?: string[]
  /** Inline notice (e.g. auto-compaction) rendered as a slim chip, not a bubble. */
  notice?: { summary: string; beforeTokens: number; afterTokensEstimate: number }
}
