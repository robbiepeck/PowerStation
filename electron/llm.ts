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
  if (loaded && loaded.path === modelPath && loaded.contextTokens >= contextTokens) return loaded
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
    const text = await active.session.prompt(options.prompt, {
      temperature: options.temperature,
      maxTokens: options.maxTokens > 0 ? options.maxTokens : undefined,
      signal: controller.signal,
      stopOnAbortSignal: true,
      onTextChunk: (chunk: string) => {
        charCount += chunk.length
        options.onToken(chunk)
      },
    })
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
  if (loaded) loaded.session.resetChatHistory()
}

export async function unloadModel(): Promise<void> {
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
