// Inference worker. Runs inside an Electron utilityProcess so that a native
// crash in llama.cpp (OOM, bad GGUF, driver bug) kills THIS process, not the
// app — the host (llm.ts) turns that into a recovery card in the UI.
// All node-llama-cpp state lives here; the main process talks over parentPort.

import { getLlama, LlamaChatSession, defineChatSessionFunction } from 'node-llama-cpp'
import type { ChatRequest, ChatResult, WorkerMessage, WorkerRequest } from './llmProtocol.js'

type LlamaInstance = Awaited<ReturnType<typeof getLlama>>
type LoadedModel = Awaited<ReturnType<LlamaInstance['loadModel']>>
type LoadedContext = Awaited<ReturnType<LoadedModel['createContext']>>

type LoadedState = {
  path: string
  contextTokens: number
  systemPrompt: string
  model: LoadedModel
  context: LoadedContext
  session: LlamaChatSession
}

const port = process.parentPort
if (!port) throw new Error('llmWorker must run inside an Electron utilityProcess')

function post(message: WorkerMessage): void {
  port.postMessage(message)
}

let llamaPromise: Promise<LlamaInstance> | null = null
let loaded: LoadedState | null = null
let loadingPath: string | null = null
let lastTokensPerSec = 0

const abortControllers = new Map<string, AbortController>()
const activeGenerations = new Set<Promise<unknown>>()
const pendingToolCalls = new Map<number, { resolve: (value: string) => void; reject: (error: Error) => void }>()
let nextToolCallId = 1

function publishState(): void {
  post({ event: 'state', loadedPath: loaded?.path ?? null, loadingPath, tokensPerSec: lastTokensPerSec })
}

async function getLlamaInstance(): Promise<LlamaInstance> {
  if (!llamaPromise) llamaPromise = getLlama()
  return llamaPromise
}

function clampContextSize(requested: number, trained: number): number {
  const ceiling = trained && trained > 0 ? trained : requested
  return Math.max(512, Math.min(requested, ceiling))
}

function abortAll(): void {
  for (const controller of abortControllers.values()) controller.abort()
}

// Callers abort first, but node-llama-cpp only stops on the next loop turn, so
// the session must not be reset or disposed until generations have settled.
async function waitForGenerations(): Promise<void> {
  await Promise.allSettled([...activeGenerations])
}

async function disposeLoaded(): Promise<void> {
  if (!loaded) return
  const current = loaded
  loaded = null
  try {
    await current.context.dispose()
  } catch {
    /* ignore */
  }
  try {
    await current.model.dispose()
  } catch {
    /* ignore */
  }
  publishState()
}

async function getDeviceInfo() {
  const llama = await getLlamaInstance()
  const [vram, gpuNames] = await Promise.all([
    llama.getVramState().catch(() => null),
    llama.getGpuDeviceNames().catch(() => [] as string[]),
  ])
  return { gpuType: llama.gpu, gpuNames, vram }
}

async function ensureModelLoaded(request: ChatRequest): Promise<LoadedState> {
  const systemPrompt = request.systemPrompt ?? ''
  if (loaded && loaded.path === request.modelPath && loaded.systemPrompt === systemPrompt) {
    const target = clampContextSize(request.contextTokens, loaded.model.trainContextSize)
    if (loaded.contextTokens >= target) return loaded
  }

  // Reuse the loaded model when only the system prompt changed — recreate the
  // session (fresh history) without paying the model load again.
  if (loaded && loaded.path === request.modelPath && loaded.systemPrompt !== systemPrompt) {
    const target = clampContextSize(request.contextTokens, loaded.model.trainContextSize)
    if (loaded.contextTokens >= target) {
      loaded.session.dispose()
      loaded.session = new LlamaChatSession({
        contextSequence: loaded.context.getSequence(),
        systemPrompt: systemPrompt || undefined,
      })
      loaded.systemPrompt = systemPrompt
      return loaded
    }
  }

  if (loaded) await disposeLoaded()

  loadingPath = request.modelPath
  publishState()
  try {
    const llama = await getLlamaInstance()
    post({ event: 'chat:status', requestId: request.requestId, status: { phase: 'loading-model', modelPath: request.modelPath } })
    const model = await llama.loadModel({ modelPath: request.modelPath })
    post({ event: 'chat:status', requestId: request.requestId, status: { phase: 'creating-context', modelPath: request.modelPath } })
    const contextSize = clampContextSize(request.contextTokens, model.trainContextSize)
    const context = await model.createContext({ contextSize })
    const session = new LlamaChatSession({
      contextSequence: context.getSequence(),
      systemPrompt: systemPrompt || undefined,
    })
    loaded = { path: request.modelPath, contextTokens: contextSize, systemPrompt, model, context, session }
    post({ event: 'chat:status', requestId: request.requestId, status: { phase: 'ready', modelPath: request.modelPath } })
    return loaded
  } finally {
    loadingPath = null
    publishState()
  }
}

// node-llama-cpp enforces tool parameters with a GBNF grammar built from a
// restricted JSON-schema subset. MCP servers can send richer schemas, so
// anything unsupported degrades to a permissive object rather than crashing.
function sanitizeSchema(schema: unknown, depth = 0): Record<string, unknown> {
  const permissive = { type: 'object' as const }
  if (depth > 6 || typeof schema !== 'object' || schema === null) return permissive
  const record = schema as Record<string, unknown>
  if (record.$ref || record.anyOf || record.oneOf || record.allOf || record.not) return permissive
  const type = record.type
  if (type === 'object' || (type === undefined && record.properties)) {
    const out: Record<string, unknown> = { type: 'object' }
    if (typeof record.properties === 'object' && record.properties !== null) {
      const props: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(record.properties as Record<string, unknown>)) {
        props[key] = sanitizeSchema(value, depth + 1)
      }
      out.properties = props
    }
    if (Array.isArray(record.required)) out.required = record.required.filter((k) => typeof k === 'string')
    if (typeof record.description === 'string') out.description = record.description
    return out
  }
  if (type === 'array') {
    return {
      type: 'array',
      items: sanitizeSchema(record.items, depth + 1),
      ...(typeof record.description === 'string' ? { description: record.description } : {}),
    }
  }
  if (type === 'string' || type === 'number' || type === 'integer' || type === 'boolean' || type === 'null') {
    const out: Record<string, unknown> = { type }
    if (Array.isArray(record.enum)) out.enum = record.enum
    if (typeof record.description === 'string') out.description = record.description
    return out
  }
  return permissive
}

function requestToolExecution(requestId: string, toolKey: string, args: unknown): Promise<string> {
  const callId = nextToolCallId++
  return new Promise<string>((resolve, reject) => {
    pendingToolCalls.set(callId, { resolve, reject })
    post({ event: 'chat:toolCall', requestId, callId, toolKey, args })
  })
}

function buildSessionFunctions(request: ChatRequest, guard: ToolGuard) {
  const tools = request.tools ?? []
  if (!tools.length) return undefined
  const functions: Record<string, ReturnType<typeof defineChatSessionFunction>> = {}
  for (const tool of tools) {
    // Model-facing name: llama.cpp function names must be simple identifiers.
    const fnName = tool.key.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 64)
    functions[fnName] = defineChatSessionFunction({
      description: tool.description.slice(0, 1000),
      ...(tool.parameters ? { params: sanitizeSchema(tool.parameters) as never } : {}),
      handler: async (params: unknown) => {
        const guardResult = guard.check(tool.key, params)
        if (guardResult) return guardResult
        try {
          return await requestToolExecution(request.requestId, tool.key, params ?? {})
        } catch (error) {
          return `Tool call failed: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    })
  }
  return functions
}

// Loop guards: small local models retry the same failing call or wander into
// unbounded tool loops; both bloat the context and compound the degradation.
class ToolGuard {
  private calls = 0
  private signatures = new Map<string, number>()
  haltReason: ChatResult['haltReason'] = null

  constructor(
    private readonly maxCalls: number,
    private readonly abort: () => void,
  ) {}

  get callCount(): number {
    return this.calls
  }

  /** Returns a message for the model when the call is blocked, else null. */
  check(toolKey: string, args: unknown): string | null {
    this.calls += 1
    if (this.calls > this.maxCalls) {
      this.haltReason = 'call-budget'
      this.abort()
      return `Stopped: this turn already used its budget of ${this.maxCalls} tool calls.`
    }
    const signature = `${toolKey}:${JSON.stringify(args ?? {})}`
    const seen = (this.signatures.get(signature) ?? 0) + 1
    this.signatures.set(signature, seen)
    if (seen >= 3) {
      this.haltReason = 'repeated-call'
      this.abort()
      return 'Stopped: the exact same tool call was attempted three times.'
    }
    return null
  }
}

async function chat(request: ChatRequest): Promise<ChatResult> {
  const controller = new AbortController()
  abortControllers.set(request.requestId, controller)
  try {
    const active = await ensureModelLoaded(request)
    post({ event: 'chat:status', requestId: request.requestId, status: { phase: 'generating' } })
    const guard = new ToolGuard(request.maxToolCalls ?? 15, () => controller.abort())
    const functions = buildSessionFunctions(request, guard)
    const start = Date.now()
    let charCount = 0
    const generation = active.session.prompt(request.prompt, {
      temperature: request.temperature,
      maxTokens: request.maxTokens > 0 ? request.maxTokens : undefined,
      signal: controller.signal,
      stopOnAbortSignal: true,
      ...(functions ? { functions } : {}),
      onTextChunk: (chunk: string) => {
        charCount += chunk.length
        post({ event: 'chat:token', requestId: request.requestId, token: chunk })
      },
    } as Parameters<LlamaChatSession['prompt']>[1])
    activeGenerations.add(generation)
    let text: string
    try {
      text = await generation
    } finally {
      activeGenerations.delete(generation)
    }
    const elapsedSec = (Date.now() - start) / 1000
    const approxTokens = Math.max(1, Math.round(charCount / 4))
    lastTokensPerSec = elapsedSec > 0 ? approxTokens / elapsedSec : 0
    publishState()
    return {
      text,
      tokensPerSec: lastTokensPerSec,
      aborted: controller.signal.aborted && guard.haltReason === null,
      toolCallCount: guard.callCount,
      haltReason: guard.haltReason,
    }
  } finally {
    abortControllers.delete(request.requestId)
  }
}

async function handleRequest(request: WorkerRequest): Promise<unknown> {
  switch (request.cmd) {
    case 'deviceInfo':
      return getDeviceInfo()
    case 'chat':
      return chat(request.payload)
    case 'stop': {
      const controller = abortControllers.get(request.payload.requestId)
      if (controller) controller.abort()
      return Boolean(controller)
    }
    case 'reset':
      abortAll()
      await waitForGenerations()
      if (loaded) loaded.session.resetChatHistory()
      return null
    case 'unload':
      abortAll()
      await waitForGenerations()
      await disposeLoaded()
      return null
    case 'toolResult': {
      const pending = pendingToolCalls.get(request.payload.callId)
      if (pending) {
        pendingToolCalls.delete(request.payload.callId)
        if (request.payload.error !== undefined) pending.reject(new Error(request.payload.error))
        else pending.resolve(request.payload.result ?? '')
      }
      return null
    }
  }
}

port.on('message', (event: Electron.MessageEvent) => {
  const request = event.data as WorkerRequest
  if (!request || typeof request.id !== 'number') return
  void handleRequest(request)
    .then((result) => {
      // toolResult is fire-and-forget from the host's perspective.
      if (request.cmd !== 'toolResult') post({ id: request.id, ok: true, result })
    })
    .catch((error: unknown) => {
      post({ id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) })
    })
})

publishState()
