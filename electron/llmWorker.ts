import { getLlama, LlamaChatSession, defineChatSessionFunction, type ChatHistoryItem } from 'node-llama-cpp'
import type {
  BenchmarkRequest,
  BenchmarkResult,
  ChatRequest,
  ChatResult,
  EmbedRequest,
  WorkerMessage,
  WorkerRequest,
} from './llmProtocol.js'
import { generationTokensPerSecond } from './generationMetrics.js'

type LlamaInstance = Awaited<ReturnType<typeof getLlama>>
type LoadedModel = Awaited<ReturnType<LlamaInstance['loadModel']>>
type LoadedContext = Awaited<ReturnType<LoadedModel['createContext']>>

type LoadedState = {
  path: string
  contextTokens: number
  systemPrompt: string
  model: LoadedModel
  context: LoadedContext

  sequence: ReturnType<LoadedContext['getSequence']>
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

  for (const [callId, pending] of pendingToolCalls) {
    pendingToolCalls.delete(callId)
    pending.reject(new Error('Aborted'))
  }
}

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
    void 0
  }
  try {
    await current.model.dispose()
  } catch {
    void 0
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
  if (loaded && loaded.path === request.modelPath) {
    const target = clampContextSize(request.contextTokens, loaded.model.trainContextSize)
    if (loaded.contextTokens >= target) {

      if (loaded.systemPrompt !== systemPrompt) {
        const prior = loaded.session.getChatHistory().filter((item) => item.type !== 'system')
        loaded.session.dispose()
        loaded.session = new LlamaChatSession({
          contextSequence: loaded.sequence,
          systemPrompt: systemPrompt || undefined,
        })
        if (prior.length) {
          const items: ChatHistoryItem[] = systemPrompt ? [{ type: 'system', text: systemPrompt }] : []
          loaded.session.setChatHistory([...items, ...prior])
        }
        loaded.systemPrompt = systemPrompt
      }
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
    const sequence = context.getSequence()
    const session = new LlamaChatSession({
      contextSequence: sequence,
      systemPrompt: systemPrompt || undefined,
    })
    loaded = { path: request.modelPath, contextTokens: contextSize, systemPrompt, model, context, sequence, session }
    post({ event: 'chat:status', requestId: request.requestId, status: { phase: 'ready', modelPath: request.modelPath } })
    return loaded
  } finally {
    loadingPath = null
    publishState()
  }
}

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
      for (const [key, value] of Object.entries(record.properties as Record<string, unknown>).slice(0, 100)) {
        if (key.length > 200) continue
        props[key] = sanitizeSchema(value, depth + 1)
      }
      out.properties = props
    }
    if (Array.isArray(record.required)) out.required = record.required.filter((k) => typeof k === 'string').slice(0, 100)
    if (typeof record.description === 'string') out.description = record.description.slice(0, 1000)
    return out
  }
  if (type === 'array') {
    return {
      type: 'array',
      items: sanitizeSchema(record.items, depth + 1),
      ...(typeof record.description === 'string' ? { description: record.description.slice(0, 1000) } : {}),
    }
  }
  if (type === 'string' || type === 'number' || type === 'integer' || type === 'boolean' || type === 'null') {
    const out: Record<string, unknown> = { type }
    if (Array.isArray(record.enum)) out.enum = record.enum.slice(0, 100)
    if (typeof record.description === 'string') out.description = record.description.slice(0, 1000)
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
  tools.slice(0, 200).forEach((tool, index) => {
    const fnName = `tool_${index}_${tool.key.replace(/[^a-zA-Z0-9_]/g, '_')}`.slice(0, 64)
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
  })
  return functions
}

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
  let active: Awaited<ReturnType<typeof ensureModelLoaded>> | null = null

  let isolatedSnapshot: ChatHistoryItem[] | null = null
  try {
    active = await ensureModelLoaded(request)
    if (request.isolated) isolatedSnapshot = active.session.getChatHistory()

    if (request.history?.length) {
      const items: ChatHistoryItem[] = []
      if (request.systemPrompt) items.push({ type: 'system', text: request.systemPrompt })
      for (const turn of request.history) {
        if (turn.role === 'user') items.push({ type: 'user', text: turn.text })
        else items.push({ type: 'model', response: [turn.text] })
      }
      active.session.setChatHistory(items)
    }
    if (!request.isolated && request.autoCompact !== false) {
      await maybeCompact(active, request.requestId, request.systemPrompt ?? '')
    }
    post({ event: 'chat:status', requestId: request.requestId, status: { phase: 'generating' } })
    const guard = new ToolGuard(request.maxToolCalls ?? 15, () => controller.abort())
    const functions = buildSessionFunctions(request, guard)
    const start = Date.now()
    let charCount = 0
    let outputTokens = 0
    let firstTokenAt: number | null = null
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
      onResponseChunk: (chunk: { tokens?: unknown[] }) => {
        const tokenCount = chunk.tokens?.length ?? 0
        if (tokenCount > 0 && firstTokenAt === null) firstTokenAt = Date.now()
        outputTokens += tokenCount
      },
    } as Parameters<LlamaChatSession['prompt']>[1])
    activeGenerations.add(generation)
    let text: string
    try {
      text = await generation
    } finally {
      activeGenerations.delete(generation)
    }
    const finishedAt = Date.now()
    const elapsedSec = (finishedAt - start) / 1000
    const approxTokens = Math.max(1, Math.round(charCount / 4))
    const tokensPerSec = generationTokensPerSecond({
      outputTokens: outputTokens || approxTokens,
      startedAt: start,
      firstTokenAt,
      finishedAt,
    })
    if (!request.isolated) lastTokensPerSec = tokensPerSec
    publishState()
    return {
      text,
      tokensPerSec,
      elapsedMs: Math.round(elapsedSec * 1000),
      aborted: controller.signal.aborted && guard.haltReason === null,
      toolCallCount: guard.callCount,
      haltReason: guard.haltReason,
      contextUsed: active.sequence.nextTokenIndex,
      contextSize: active.contextTokens,
    }
  } finally {

    if (active && isolatedSnapshot) active.session.setChatHistory(isolatedSnapshot)
    abortControllers.delete(request.requestId)
  }
}

type EmbedState = {
  path: string
  model: Awaited<ReturnType<Awaited<ReturnType<typeof getLlama>>['loadModel']>>
  context: Awaited<ReturnType<EmbedState['model']['createEmbeddingContext']>>
}

let embedLoaded: EmbedState | null = null

async function embed(request: EmbedRequest): Promise<number[][]> {
  if (!embedLoaded || embedLoaded.path !== request.modelPath) {
    if (embedLoaded) {
      await embedLoaded.context.dispose()
      await embedLoaded.model.dispose()
      embedLoaded = null
    }
    const llama = await getLlamaInstance()
    const model = await llama.loadModel({ modelPath: request.modelPath })
    const context = await model.createEmbeddingContext()
    embedLoaded = { path: request.modelPath, model, context }
  }
  const vectors: number[][] = []
  for (const text of request.texts.slice(0, 64)) {
    const embedding = await embedLoaded.context.getEmbeddingFor(text)
    vectors.push([...embedding.vector])
  }
  return vectors
}

const COMPACT_THRESHOLD = 0.75
const COMPACT_KEEP_RECENT = 4
const COMPACT_PROMPT =
  'Summarize our conversation so far in under 150 words, for your own memory: include names, facts, ' +
  'decisions, preferences, and any unfinished task state. Reply with only the summary.'

async function maybeCompact(active: LoadedState, requestId: string, systemPrompt: string): Promise<void> {
  const beforeTokens = active.sequence.nextTokenIndex
  if (beforeTokens < active.contextTokens * COMPACT_THRESHOLD) return
  const nonSystem = active.session.getChatHistory().filter((item) => item.type !== 'system')
  if (nonSystem.length <= COMPACT_KEEP_RECENT + 2) return

  let summary: string
  const generation = active.session.prompt(COMPACT_PROMPT, { temperature: 0, maxTokens: 220 })
  activeGenerations.add(generation)
  try {
    summary = (await generation).trim()
  } catch {
    return
  } finally {
    activeGenerations.delete(generation)
  }
  if (!summary) return

  const recent = nonSystem.slice(-COMPACT_KEEP_RECENT)
  const items: ChatHistoryItem[] = []
  if (systemPrompt) items.push({ type: 'system', text: systemPrompt })
  items.push({
    type: 'user',
    text: `[Context note: the earlier conversation was compressed to save memory. Summary:]\n${summary}`,
  })
  items.push({ type: 'model', response: ['Understood. Continuing with that context.'] })
  items.push(...recent)
  active.session.setChatHistory(items)

  const rawEstimate = active.model.tokenize(
    items
      .map((item) => ('text' in item ? String(item.text) : item.type === 'model' ? item.response.filter((r) => typeof r === 'string').join(' ') : ''))
      .join(' '),
  ).length
  const afterTokensEstimate = Math.min(rawEstimate, beforeTokens)
  post({ event: 'chat:compacted', requestId, summary, beforeTokens, afterTokensEstimate })
}

const BENCH_PROMPT = 'In one short paragraph, explain why the sky appears blue. Then list three interesting facts about light.'
const BENCH_MAX_TOKENS = 128
const BENCH_TIMEOUT_MS = 90_000

const BENCH_READ_PASSAGE =
  'The history of computing spans mechanical calculators, electromechanical relays, vacuum tubes, transistors, and integrated circuits. ' +
  'Each generation reduced cost and size while increasing reliability and speed, enabling entirely new categories of application. '.repeat(28)

async function benchmark(request: BenchmarkRequest): Promise<BenchmarkResult> {
  if (activeGenerations.size > 0) throw new Error('A generation is already running — try again when it finishes.')
  const active = await ensureModelLoaded({
    requestId: 'benchmark',
    modelPath: request.modelPath,
    prompt: '',
    systemPrompt: request.systemPrompt,
    contextTokens: request.contextTokens,
    temperature: 0,
    maxTokens: BENCH_MAX_TOKENS,
  })

  let promptTokensPerSec = 0
  const passageTokens = active.model.tokenize(BENCH_READ_PASSAGE).length
  if (passageTokens + 64 < active.contextTokens) {
    const readController = new AbortController()
    const readTimer = setTimeout(() => readController.abort(), BENCH_TIMEOUT_MS)
    const readStart = Date.now()
    try {
      const reading = active.session.prompt(BENCH_READ_PASSAGE + '\n\nReply with just: ok', {
        temperature: 0,
        maxTokens: 1,
        signal: readController.signal,
        stopOnAbortSignal: true,
      })
      activeGenerations.add(reading)
      try {
        await reading
      } finally {
        activeGenerations.delete(reading)
      }
      const readElapsed = Date.now() - readStart
      if (readElapsed > 0 && !readController.signal.aborted) {
        promptTokensPerSec = (passageTokens / readElapsed) * 1000
      }
    } catch {
      void 0
    } finally {
      clearTimeout(readTimer)
      active.session.resetChatHistory()
    }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), BENCH_TIMEOUT_MS)
  const start = Date.now()

  let outputTokens = 0
  const generation = active.session.prompt(BENCH_PROMPT, {
    temperature: 0,
    maxTokens: BENCH_MAX_TOKENS,
    signal: controller.signal,
    stopOnAbortSignal: true,
    onResponseChunk: (chunk: { tokens?: unknown[] }) => {
      outputTokens += chunk.tokens?.length ?? 0
    },
  } as Parameters<LlamaChatSession['prompt']>[1])
  activeGenerations.add(generation)
  try {
    await generation
  } finally {
    activeGenerations.delete(generation)
    clearTimeout(timer)

    active.session.resetChatHistory()
  }
  const elapsedMs = Date.now() - start
  if (outputTokens <= 0) throw new Error('The model loaded but produced no measurable output.')
  const tokensPerSec = elapsedMs > 0 ? (outputTokens / elapsedMs) * 1000 : 0
  lastTokensPerSec = tokensPerSec
  publishState()
  return { tokensPerSec, outputTokens, elapsedMs, promptTokensPerSec }
}

async function handleRequest(request: WorkerRequest): Promise<unknown> {
  switch (request.cmd) {
    case 'deviceInfo':
      return getDeviceInfo()
    case 'chat':
      return chat(request.payload)
    case 'benchmark':
      return benchmark(request.payload)
    case 'embed':
      return embed(request.payload)
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

      if (request.cmd !== 'toolResult') post({ id: request.id, ok: true, result })
    })
    .catch((error: unknown) => {
      post({ id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) })
    })
})

publishState()
