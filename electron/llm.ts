// LLM runtime host. Inference itself runs in an isolated utilityProcess
// (llmWorker.ts) so a native llama.cpp crash becomes a restartable event with
// a recovery card instead of killing the app. This module supervises that
// worker: request/response correlation, token streaming, crash surfacing, and
// the tool-execution bridge used by the agent harness.

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { utilityProcess, type UtilityProcess } from 'electron'
import { createModelDownloader } from 'node-llama-cpp'
import type {
  BenchmarkRequest,
  BenchmarkResult,
  ChatRequest,
  ChatResult,
  ChatStatus,
  ToolDefinition,
  WorkerDeviceInfo,
  WorkerMessage,
  WorkerRequest,
} from './llmProtocol.js'
import { isWorkerEvent } from './llmProtocol.js'

export type { ChatStatus, ToolDefinition }

export type RuntimeEvent = { type: 'crashed'; message: string }

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void }
type ChatCallbacks = {
  onToken: (token: string) => void
  onStatus?: (status: ChatStatus) => void
  onToolCall?: (toolKey: string, args: unknown) => void
  onCompacted?: (payload: { summary: string; beforeTokens: number; afterTokensEstimate: number }) => void
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let worker: UtilityProcess | null = null
let nextRequestId = 1
const pending = new Map<number, Pending>()
const chatCallbacks = new Map<string, ChatCallbacks>()
const runtimeListeners = new Set<(event: RuntimeEvent) => void>()

// Mirrored from worker 'state' events so telemetry can read them synchronously.
let loadedPath: string | null = null
let loadingPath: string | null = null
let lastTokensPerSec = 0

// The agent layer installs this; it runs MCP calls (with permission checks) in
// the main process and returns the tool output that goes back into the model.
let toolExecutor: ((toolKey: string, args: unknown, requestId: string) => Promise<string>) | null = null

export function setToolExecutor(executor: typeof toolExecutor): void {
  toolExecutor = executor
}

export function onRuntimeEvent(listener: (event: RuntimeEvent) => void): () => void {
  runtimeListeners.add(listener)
  return () => runtimeListeners.delete(listener)
}

function handleWorkerMessage(message: WorkerMessage): void {
  if (isWorkerEvent(message)) {
    switch (message.event) {
      case 'chat:token':
        chatCallbacks.get(message.requestId)?.onToken(message.token)
        return
      case 'chat:compacted': {
        const callbacks = chatCallbacks.get(message.requestId)
        callbacks?.onCompacted?.({
          summary: message.summary,
          beforeTokens: message.beforeTokens,
          afterTokensEstimate: message.afterTokensEstimate,
        })
        return
      }
      case 'chat:status':
        chatCallbacks.get(message.requestId)?.onStatus?.(message.status)
        return
      case 'chat:toolCall': {
        chatCallbacks.get(message.requestId)?.onToolCall?.(message.toolKey, message.args)
        const executor = toolExecutor
        void (async () => {
          try {
            if (!executor) throw new Error('No tool executor is configured.')
            const result = await executor(message.toolKey, message.args, message.requestId)
            send({ id: 0, cmd: 'toolResult', payload: { callId: message.callId, result } })
          } catch (error) {
            send({
              id: 0,
              cmd: 'toolResult',
              payload: { callId: message.callId, error: error instanceof Error ? error.message : String(error) },
            })
          }
        })()
        return
      }
      case 'state':
        loadedPath = message.loadedPath
        loadingPath = message.loadingPath
        lastTokensPerSec = message.tokensPerSec
        return
    }
  }
  const entry = pending.get(message.id)
  if (!entry) return
  pending.delete(message.id)
  if (message.ok) entry.resolve(message.result)
  else entry.reject(new Error(message.error))
}

// Respawn guard: a worker that crashes during native init must not be
// re-forked in a tight loop (the telemetry tick used to do exactly that).
let crashCooldownUntil = 0
let recentCrashes = 0

function handleWorkerExit(code: number): void {
  worker = null
  loadedPath = null
  loadingPath = null
  const message =
    'The model runtime stopped unexpectedly' +
    (code ? ` (exit code ${code})` : '') +
    '. This usually means the model ran out of memory. PowerStation recovered — try a smaller context or a smaller model.'
  const error = new Error(message)
  for (const entry of pending.values()) entry.reject(error)
  pending.clear()
  chatCallbacks.clear()
  // Only report crashes; code 0 is a deliberate shutdown.
  if (code !== 0) {
    recentCrashes += 1
    // Escalating cooldown: 5s after the first crash, up to 60s when crashing repeatedly.
    crashCooldownUntil = Date.now() + Math.min(60000, 5000 * recentCrashes)
    for (const listener of runtimeListeners) listener({ type: 'crashed', message })
  }
}

export function isWorkerRunning(): boolean {
  return worker !== null
}

function ensureWorker(): UtilityProcess {
  if (worker) return worker
  if (Date.now() < crashCooldownUntil) {
    throw new Error('The model runtime crashed recently and is cooling down. Try again in a moment.')
  }
  const spawned = utilityProcess.fork(path.join(__dirname, 'llmWorker.js'), [], {
    serviceName: 'PowerStation LLM runtime',
  })
  spawned.on('message', (message: unknown) => {
    // A responsive worker clears the crash streak.
    recentCrashes = 0
    handleWorkerMessage(message as WorkerMessage)
  })
  spawned.on('exit', (code) => {
    if (worker === spawned || worker === null) handleWorkerExit(code)
  })
  worker = spawned
  return spawned
}

function send(request: WorkerRequest): void {
  ensureWorker().postMessage(request)
}

// Omit must distribute over the request union, otherwise 'payload' is dropped.
type WorkerRequestBody = WorkerRequest extends infer R ? (R extends WorkerRequest ? Omit<R, 'id'> : never) : never

function call<T>(request: WorkerRequestBody): Promise<T> {
  const id = nextRequestId++
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject })
    send({ ...request, id } as WorkerRequest)
  })
}

export async function getDeviceInfo(): Promise<WorkerDeviceInfo> {
  return call<WorkerDeviceInfo>({ cmd: 'deviceInfo' })
}

// One inference at a time. The worker holds a single model + chat sequence, so
// concurrent generations (e.g. an in-app chat and a local-API-server request)
// would corrupt each other's session. Every generation acquires this lock, so
// they queue rather than overlap — the API server surfaces this as "serialized".
let inferenceChain: Promise<unknown> = Promise.resolve()
function withInferenceLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = inferenceChain.then(fn, fn)
  // Swallow settlement on the chain so one failed turn doesn't reject the next.
  inferenceChain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

export async function chat(
  options: Omit<ChatRequest, 'requestId'> & { requestId: string } & ChatCallbacks,
): Promise<ChatResult> {
  const { onToken, onStatus, onToolCall, onCompacted, ...request } = options
  chatCallbacks.set(request.requestId, { onToken, onStatus, onToolCall, onCompacted })
  try {
    return await withInferenceLock(() => call<ChatResult>({ cmd: 'chat', payload: request }))
  } finally {
    chatCallbacks.delete(request.requestId)
  }
}

export async function runBenchmark(payload: BenchmarkRequest): Promise<BenchmarkResult> {
  return withInferenceLock(() => call<BenchmarkResult>({ cmd: 'benchmark', payload }))
}

/** Embed texts with a small local embedding model (loaded lazily in the worker). */
export async function embedTexts(modelPath: string, texts: string[]): Promise<number[][]> {
  return call<number[][]>({ cmd: 'embed', payload: { modelPath, texts } })
}

export function stopChat(requestId: string): boolean {
  if (!worker) return false
  send({ id: 0, cmd: 'stop', payload: { requestId } })
  return true
}

export async function resetChat(): Promise<void> {
  if (!worker) return
  await call({ cmd: 'reset' })
}

export async function unloadModel(): Promise<void> {
  if (!worker) return
  await call({ cmd: 'unload' })
}

export function shutdown(): void {
  if (!worker) return
  const current = worker
  worker = null
  const error = new Error('The model runtime is shutting down.')
  for (const entry of pending.values()) entry.reject(error)
  pending.clear()
  chatCallbacks.clear()
  current.kill()
}

export function getLoadedPath(): string | null {
  return loadedPath
}

export function getLoadingPath(): string | null {
  return loadingPath
}

export function getLastTokensPerSec(): number {
  return lastTokensPerSec
}

export function getActiveRequestIds(): string[] {
  return [...chatCallbacks.keys()]
}

// Downloads are plain HTTPS with resume support — no native inference code
// involved, so they run in the main process, unaffected by worker restarts.
export async function downloadModel(options: {
  uri: string
  dirPath: string
  onProgress: (status: { totalSize: number; downloadedSize: number }) => void
}): Promise<string> {
  const downloader = await createModelDownloader({
    modelUri: options.uri,
    dirPath: options.dirPath,
    onProgress: ({ totalSize, downloadedSize }) => options.onProgress({ totalSize, downloadedSize }),
  })
  await downloader.download()
  return downloader.entrypointFilePath
}
