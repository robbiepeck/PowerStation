// Message protocol between the main process (llm.ts host) and the isolated
// inference worker (llmWorker.ts). The worker runs node-llama-cpp in an
// Electron utilityProcess so a native crash is a restartable event instead of
// taking down the whole app.

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
  /** JSON-schema tool definitions the model may call (agent mode). */
  tools?: ToolDefinition[]
  /** Hard cap on tool calls in a single turn (loop guard). */
  maxToolCalls?: number
  /**
   * Prior conversation to replay into the session before prompting — sent once
   * when resuming a persisted chat, so the model actually remembers it.
   */
  history?: Array<{ role: 'user' | 'assistant'; text: string }>
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
}

export type ChatResult = {
  text: string
  tokensPerSec: number
  aborted: boolean
  toolCallCount: number
  /** Set when the turn was halted by a loop guard. */
  haltReason: 'repeated-call' | 'call-budget' | null
  /** Tokens currently held in the session context, and its total size. */
  contextUsed: number
  contextSize: number
}

export type EmbedRequest = {
  modelPath: string
  texts: string[]
}

export type ToolDefinition = {
  /** Unique key, e.g. "filesystem:read_file". */
  key: string
  description: string
  /** JSON Schema for the tool parameters. */
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
  | { event: 'state'; loadedPath: string | null; loadingPath: string | null; tokensPerSec: number }

export type WorkerMessage = WorkerResponse | WorkerEvent

export function isWorkerEvent(message: WorkerMessage): message is WorkerEvent {
  return 'event' in message
}
