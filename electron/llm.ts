import { getLlama, LlamaChatSession, createModelDownloader } from 'node-llama-cpp'

type LlamaInstance = Awaited<ReturnType<typeof getLlama>>
type LoadedModel = Awaited<ReturnType<LlamaInstance['loadModel']>>
type LoadedContext = Awaited<ReturnType<LoadedModel['createContext']>>

export type ChatStatus =
  | { phase: 'loading-model'; modelPath: string }
  | { phase: 'creating-context'; modelPath: string }
  | { phase: 'ready'; modelPath: string }
  | { phase: 'generating' }

type LoadedState = {
  path: string
  contextTokens: number
  model: LoadedModel
  context: LoadedContext
  session: LlamaChatSession
}

let llamaPromise: Promise<LlamaInstance> | null = null
let loaded: LoadedState | null = null
let loadingPath: string | null = null
let lastTokensPerSec = 0

const abortControllers = new Map<string, AbortController>()
const activeGenerations = new Set<Promise<unknown>>()

function abortAll(): void {
  for (const controller of abortControllers.values()) controller.abort()
}

// Wait for every in-flight prompt to actually settle. Callers abort first, but
// node-llama-cpp only stops on the next loop turn, so the session must not be
// reset or disposed until the generation promises have resolved.
async function waitForGenerations(): Promise<void> {
  await Promise.allSettled([...activeGenerations])
}

async function getLlamaInstance(): Promise<LlamaInstance> {
  if (!llamaPromise) llamaPromise = getLlama()
  return llamaPromise
}

function clampContextSize(requested: number, trained: number): number {
  const ceiling = trained && trained > 0 ? trained : requested
  return Math.max(512, Math.min(requested, ceiling))
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
}

export async function getDeviceInfo(): Promise<{
  gpuType: string | false
  gpuNames: string[]
  vram: { total: number; used: number; free: number; unifiedSize: number } | null
}> {
  const llama = await getLlamaInstance()
  const [vram, gpuNames] = await Promise.all([
    llama.getVramState().catch(() => null),
    llama.getGpuDeviceNames().catch(() => [] as string[]),
  ])
  return { gpuType: llama.gpu, gpuNames, vram }
}

export async function ensureModelLoaded(
  modelPath: string,
  contextTokens: number,
  onStatus?: (status: ChatStatus) => void,
): Promise<LoadedState> {
  // Compare against the *effective* context size (clamped to the model's trained
  // ceiling), not the raw request. Otherwise asking for more tokens than the model
  // supports makes the clamped value always look "too small" and reloads the model
  // on every single message.
  if (loaded && loaded.path === modelPath) {
    const target = clampContextSize(contextTokens, loaded.model.trainContextSize)
    if (loaded.contextTokens >= target) return loaded
  }
  if (loaded) await disposeLoaded()

  loadingPath = modelPath
  try {
    const llama = await getLlamaInstance()
    onStatus?.({ phase: 'loading-model', modelPath })
    const model = await llama.loadModel({ modelPath })
    onStatus?.({ phase: 'creating-context', modelPath })
    const contextSize = clampContextSize(contextTokens, model.trainContextSize)
    const context = await model.createContext({ contextSize })
    const session = new LlamaChatSession({ contextSequence: context.getSequence() })
    loaded = { path: modelPath, contextTokens: contextSize, model, context, session }
    onStatus?.({ phase: 'ready', modelPath })
    return loaded
  } finally {
    loadingPath = null
  }
}

export async function chat(options: {
  requestId: string
  modelPath: string
  prompt: string
  contextTokens: number
  temperature: number
  maxTokens: number
  onToken: (token: string) => void
  onStatus?: (status: ChatStatus) => void
}): Promise<{ text: string; tokensPerSec: number; aborted: boolean }> {
  const controller = new AbortController()
  abortControllers.set(options.requestId, controller)
  try {
    const active = await ensureModelLoaded(options.modelPath, options.contextTokens, options.onStatus)
    options.onStatus?.({ phase: 'generating' })
    const start = Date.now()
    let charCount = 0
    const generation = active.session.prompt(options.prompt, {
      temperature: options.temperature,
      maxTokens: options.maxTokens > 0 ? options.maxTokens : undefined,
      signal: controller.signal,
      stopOnAbortSignal: true,
      onTextChunk: (chunk: string) => {
        charCount += chunk.length
        options.onToken(chunk)
      },
    })
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
    return { text, tokensPerSec: lastTokensPerSec, aborted: controller.signal.aborted }
  } finally {
    abortControllers.delete(options.requestId)
  }
}

export function stopChat(requestId: string): boolean {
  const controller = abortControllers.get(requestId)
  if (controller) {
    controller.abort()
    return true
  }
  return false
}

export async function resetChat(): Promise<void> {
  abortAll()
  await waitForGenerations()
  if (loaded) loaded.session.resetChatHistory()
}

export async function unloadModel(): Promise<void> {
  abortAll()
  await waitForGenerations()
  await disposeLoaded()
}

export function getLoadedPath(): string | null {
  return loaded?.path ?? null
}

export function getLoadingPath(): string | null {
  return loadingPath
}

export function getLastTokensPerSec(): number {
  return lastTokensPerSec
}

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
