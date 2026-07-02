export type UtilityItem = {
  id: string
  label: string
}

export type McpServerConfig = {
  id: string
  name: string
  command: string
}

export type UtilitySettings = {
  systemPrompt: string
  skills: UtilityItem[]
  connectors: UtilityItem[]
  mcpServers: McpServerConfig[]
}

export type ModelInfo = {
  path: string
  fileName: string
  name: string
  architecture: string | null
  parameters: string | null
  quantization: string | null
  contextLength: number | null
  sizeBytes: number
  source: 'folder' | 'imported'
}

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

export type TelemetrySnapshot = {
  timestamp: number
  cpu: { load: number; cores: number; real: boolean }
  ram: { usedGb: number; totalGb: number; real: boolean }
  gpu: { load: number | null; name: string | null; type: string | null; real: boolean }
  vram: { usedGb: number | null; totalGb: number | null; real: boolean }
  storage: { usedGb: number; totalGb: number; freeGb: number; mount: string | null; real: boolean }
  power: { watts: number; estimated: boolean }
  thermal: { celsius: number | null; headroomPct: number; real: boolean }
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

export type StorageBreakdownItem = {
  path: string
  name: string
  type: 'file' | 'directory'
  sizeBytes: number
  modifiedAt: number
  category: string
  reason: string
  potentiallyUnneeded: boolean
}

export type StorageBreakdownRoot = {
  path: string
  label: string
  sizeBytes: number
  skipped: number
}

export type StorageBreakdown = {
  scannedAt: number
  scannedBytes: number
  scannedEntries: number
  skipped: number
  roots: StorageBreakdownRoot[]
  items: StorageBreakdownItem[]
  cleanupBytes: number
  note: string
}

export type ChatStatusPayload =
  | { requestId: string; phase: 'starting' }
  | { requestId: string; phase: 'loading-model'; modelPath: string }
  | { requestId: string; phase: 'creating-context'; modelPath: string }
  | { requestId: string; phase: 'ready'; modelPath: string }
  | { requestId: string; phase: 'generating' }

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
  }
  chat: {
    send: (payload: { requestId: string; prompt: string }) => Promise<{ requestId: string; ok: boolean }>
    stop: (requestId: string) => Promise<boolean>
    reset: () => Promise<void>
    unload: () => Promise<void>
    onToken: (callback: (payload: { requestId: string; token: string }) => void) => Unsubscribe
    onDone: (
      callback: (payload: { requestId: string; text: string; tokensPerSec: number; aborted: boolean }) => void,
    ) => Unsubscribe
    onError: (callback: (payload: { requestId: string; message: string }) => void) => Unsubscribe
    onStatus: (callback: (payload: ChatStatusPayload) => void) => Unsubscribe
  }
  telemetry: { onUpdate: (callback: (snapshot: TelemetrySnapshot) => void) => Unsubscribe }
  settings: { get: () => Promise<Settings>; update: (patch: Partial<Settings>) => Promise<Settings> }
  device: { info: () => Promise<DeviceInfo> }
  storage: {
    analyze: () => Promise<StorageBreakdown>
    reveal: (filePath: string) => Promise<boolean>
  }
  updates: {
    getState: () => Promise<UpdateState>
    check: () => Promise<UpdateState>
    installLatest: () => Promise<UpdateState>
    onState: (callback: (state: UpdateState) => void) => Unsubscribe
  }
}

export type MessageRole = 'user' | 'assistant'

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
}
