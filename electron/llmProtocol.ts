export type ChatStatus =
  | { phase: 'loading-model'; modelPath: string }
  | { phase: 'creating-context'; modelPath: string }
  | { phase: 'ready'; modelPath: string }
  | { phase: 'generating' }

export type WorkerDeviceInfo = {
  gpuType: string | false
  gpuNames: string[]
  vram: { total: number; used: number; free: number; unifiedSize: number } | null
}

export type ChatRequest = {
  requestId: string
  modelPath: string
  prompt: string
  systemPrompt?: string
  contextTokens: number
  temperature: number
  maxTokens: number

  tools?: ToolDefinition[]

  maxToolCalls?: number

  history?: Array<{ role: 'user' | 'assistant'; text: string }>

  autoCompact?: boolean

  isolated?: boolean
}

export type BenchmarkRequest = {
  modelPath: string
  contextTokens: number
  systemPrompt?: string
}

export type BenchmarkResult = {
  tokensPerSec: number
  outputTokens: number
  elapsedMs: number

  promptTokensPerSec: number
}

export type ChatResult = {
  text: string
  tokensPerSec: number

  elapsedMs: number
  aborted: boolean
  toolCallCount: number

  haltReason: 'repeated-call' | 'call-budget' | null

  contextUsed: number
  contextSize: number
}

export type EmbedRequest = {
  modelPath: string
  texts: string[]
}

export type ToolDefinition = {

  key: string
  description: string

  parameters: Record<string, unknown> | null
}

export type WorkerRequest =
  | { id: number; cmd: 'deviceInfo' }
  | { id: number; cmd: 'chat'; payload: ChatRequest }
  | { id: number; cmd: 'benchmark'; payload: BenchmarkRequest }
  | { id: number; cmd: 'embed'; payload: EmbedRequest }
  | { id: number; cmd: 'stop'; payload: { requestId: string } }
  | { id: number; cmd: 'reset' }
  | { id: number; cmd: 'unload' }
  | { id: number; cmd: 'toolResult'; payload: { callId: number; result?: string; error?: string } }

export type WorkerResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string }

export type WorkerEvent =
  | { event: 'chat:token'; requestId: string; token: string }
  | { event: 'chat:status'; requestId: string; status: ChatStatus }
  | { event: 'chat:toolCall'; requestId: string; callId: number; toolKey: string; args: unknown }
  | { event: 'chat:compacted'; requestId: string; summary: string; beforeTokens: number; afterTokensEstimate: number }
  | { event: 'state'; loadedPath: string | null; loadingPath: string | null; tokensPerSec: number }

export type WorkerMessage = WorkerResponse | WorkerEvent

export function isWorkerEvent(message: WorkerMessage): message is WorkerEvent {
  return 'event' in message
}
