import { promises as fs } from 'node:fs'
import path from 'node:path'
import { readGgufFileInfo } from 'node-llama-cpp'
import { getState, managedModelsDir, mutate } from './config.js'
import type { KvGeometry } from './admission.js'
import { replacementDisposition } from './modelReplacement.js'

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
  managed: boolean

  geometry: KvGeometry | null

  templateSupportsTools: boolean | null
}

export type ModelReplacementResult = {
  replaced: boolean
  freedBytes: number
  removedCount: number
  detachedExternalCount: number
}

const SPLIT_PART = /-(\d{5})-of-(\d{5})\.gguf$/i
const QUANT_IN_NAME = /\b(IQ\d+[A-Z0-9_]*|Q\d[_A-Z0-9]*|F16|F32|BF16|MXFP4)\b/i

function quantFromName(fileName: string): string | null {
  const match = fileName.match(QUANT_IN_NAME)
  return match ? match[1].toUpperCase() : null
}

function isSecondarySplitPart(fileName: string): boolean {
  const match = fileName.match(SPLIT_PART)
  return Boolean(match && match[1] !== '00001')
}

async function modelFilePaths(filePath: string): Promise<string[]> {
  const dir = path.dirname(filePath)
  const fileName = path.basename(filePath)
  const match = fileName.match(SPLIT_PART)
  if (!match || match[1] !== '00001') return [filePath]
  const prefix = fileName.slice(0, fileName.length - match[0].length)
  const suffix = `-of-${match[2]}.gguf`
  try {
    const parts = (await fs.readdir(dir))
      .filter((s) => s.startsWith(prefix) && s.toLowerCase().endsWith(suffix.toLowerCase()) && SPLIT_PART.test(s))
      .map((s) => path.join(dir, s))
    return parts.length ? parts : [filePath]
  } catch {
    return [filePath]
  }
}

async function totalSizeWithSplitParts(filePath: string, firstPartSize: number): Promise<number> {
  const parts = await modelFilePaths(filePath)
  if (parts.length <= 1) return firstPartSize
  let total = 0
  for (const part of parts) {
    try {
      total += (await fs.stat(part)).size
    } catch {
      void 0
    }
  }
  return total > firstPartSize ? total : firstPartSize
}

async function walkForGguf(dir: string, depth: number, found: string[], limit: number): Promise<void> {
  if (depth < 0 || found.length >= limit) return
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (found.length >= limit) return
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.')) continue
      await walkForGguf(full, depth - 1, found, limit)
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.gguf') && !isSecondarySplitPart(entry.name)) {
      found.push(full)
    }
  }
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value

  if (typeof value === 'bigint') return Number(value)

  if (Array.isArray(value)) return asNumber(value[0])
  return null
}

function extractGeometry(archMeta: Record<string, unknown>): KvGeometry | null {
  const attention = (typeof archMeta.attention === 'object' && archMeta.attention !== null
    ? archMeta.attention
    : {}) as Record<string, unknown>
  const nLayers = asNumber(archMeta.block_count)
  const headCount = asNumber(attention.head_count) ?? asNumber(archMeta['attention.head_count'])
  const nKvHeads = asNumber(attention.head_count_kv) ?? asNumber(archMeta['attention.head_count_kv']) ?? headCount
  const embeddingLength = asNumber(archMeta.embedding_length)
  const keyLength = asNumber(attention.key_length) ?? asNumber(archMeta['attention.key_length'])
  const headDim = keyLength ?? (embeddingLength && headCount ? Math.round(embeddingLength / headCount) : null)
  if (!nLayers || !nKvHeads || !headDim) return null
  return { nLayers, nKvHeads, headDim }
}

type ModelMetadata = Omit<ModelInfo, 'path' | 'fileName' | 'sizeBytes' | 'source' | 'managed'>

const metadataCache = new Map<string, { mtimeMs: number; size: number; meta: ModelMetadata }>()

async function readMetadata(filePath: string): Promise<ModelMetadata> {
  const fileName = path.basename(filePath)
  const fallback: ModelMetadata = {
    name: fileName.replace(/\.gguf$/i, ''),
    architecture: null,
    parameters: null,
    quantization: quantFromName(fileName),
    contextLength: null,
    geometry: null,
    templateSupportsTools: null,
  }
  try {
    const info = (await readGgufFileInfo(filePath, { readTensorInfo: false, logWarnings: false })) as {
      metadata?: Record<string, Record<string, unknown>>
    }
    const metadata = info.metadata ?? {}
    const general = (metadata.general ?? {}) as Record<string, unknown>
    const tokenizer = (metadata.tokenizer ?? {}) as Record<string, unknown>
    const architecture = typeof general.architecture === 'string' ? general.architecture : null
    const archMeta = architecture ? ((metadata[architecture] ?? {}) as Record<string, unknown>) : {}
    const contextLength = asNumber(archMeta.context_length)

    const chatTemplate = typeof tokenizer.chat_template === 'string' ? tokenizer.chat_template : null
    return {
      name: typeof general.name === 'string' && general.name.trim() ? general.name : fallback.name,
      architecture,
      parameters: typeof general.size_label === 'string' ? general.size_label : null,
      quantization: quantFromName(fileName),
      contextLength,
      geometry: extractGeometry(archMeta),
      templateSupportsTools: chatTemplate === null ? null : /\btools?\b/i.test(chatTemplate),
    }
  } catch {
    return fallback
  }
}

async function readMetadataCached(filePath: string, stat: { mtimeMs: number; size: number }): Promise<ModelMetadata> {
  const cached = metadataCache.get(filePath)
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.meta
  const meta = await readMetadata(filePath)
  metadataCache.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size, meta })
  return meta
}

export async function listModels(): Promise<ModelInfo[]> {
  const state = await getState()
  const fromFolders = new Map<string, 'folder' | 'imported'>()
  const managedRoot = path.resolve(managedModelsDir())

  for (const folder of state.modelFolders) {
    const found: string[] = []
    await walkForGguf(folder, 4, found, 200)
    for (const filePath of found) fromFolders.set(path.resolve(filePath), 'folder')
  }
  for (const filePath of state.importedModelPaths) {
    const resolved = path.resolve(filePath)
    if (!fromFolders.has(resolved)) fromFolders.set(resolved, 'imported')
  }

  const entries = await Promise.all(
    [...fromFolders.entries()].map(async ([filePath, source]) => {
      let stat: { mtimeMs: number; size: number }
      try {
        stat = await fs.stat(filePath)
      } catch {
        return null
      }
      const [sizeBytes, meta] = await Promise.all([
        totalSizeWithSplitParts(filePath, stat.size),
        readMetadataCached(filePath, stat),
      ])
      const managed = filePath === managedRoot || filePath.startsWith(managedRoot + path.sep)
      return { path: filePath, fileName: path.basename(filePath), sizeBytes, source, managed, ...meta } satisfies ModelInfo
    }),
  )

  return entries.filter((entry): entry is ModelInfo => entry !== null).sort((a, b) => a.name.localeCompare(b.name))
}

export async function getModelInfo(filePath: string): Promise<ModelInfo | null> {
  const resolved = path.resolve(filePath)
  let stat: { mtimeMs: number; size: number }
  try {
    stat = await fs.stat(resolved)
  } catch {
    return null
  }
  const [sizeBytes, meta] = await Promise.all([
    totalSizeWithSplitParts(resolved, stat.size),
    readMetadataCached(resolved, stat),
  ])
  const managedRoot = path.resolve(managedModelsDir())
  const managed = resolved === managedRoot || resolved.startsWith(managedRoot + path.sep)
  return { path: resolved, fileName: path.basename(resolved), sizeBytes, source: 'folder', managed, ...meta }
}

export async function importModelFile(filePath: string): Promise<void> {
  const resolved = path.resolve(filePath)
  const stat = await fs.stat(resolved)
  if (!stat.isFile()) throw new Error('Model path is not a file.')
  await mutate((state) => {
    if (!state.importedModelPaths.includes(resolved)) state.importedModelPaths.push(resolved)
  })
}

/**
 * Makes one model the sole model visible to PowerStation. Files downloaded into
 * PowerStation's managed model directory are deleted; files owned by another
 * application are only detached from PowerStation.
 */
export async function replaceWithModel(filePath: string): Promise<ModelReplacementResult> {
  const resolved = path.resolve(filePath)
  const stat = await fs.stat(resolved)
  if (!stat.isFile()) throw new Error('Model path is not a file.')

  const [knownModels, managedRoot] = await Promise.all([
    listModels(),
    fs.realpath(managedModelsDir()).catch(() => path.resolve(managedModelsDir())),
  ])
  const targetReal = await fs.realpath(resolved)
  let freedBytes = 0
  let removedCount = 0
  let detachedExternalCount = 0

  for (const model of knownModels) {
    const modelReal = await fs.realpath(model.path).catch(() => path.resolve(model.path))
    const disposition = replacementDisposition(managedRoot, modelReal, targetReal)
    if (disposition === 'keep') continue
    if (disposition === 'delete') {
      const result = await deleteModelFile(model.path)
      if (result.deleted) {
        freedBytes += result.freedBytes
        removedCount += 1
      }
    } else {
      detachedExternalCount += 1
    }
  }

  await mutate((state) => {
    state.modelFolders = [managedModelsDir()]
    state.importedModelPaths = [resolved]
    state.selectedModelPath = resolved
  })

  return { replaced: true, freedBytes, removedCount, detachedExternalCount }
}

export async function addModelFolder(dir: string): Promise<void> {
  const resolved = path.resolve(dir)
  await mutate((state) => {
    if (!state.modelFolders.includes(resolved)) state.modelFolders.push(resolved)
  })
}

export async function removeImported(filePath: string): Promise<void> {
  const resolved = path.resolve(filePath)
  await mutate((state) => {
    state.importedModelPaths = state.importedModelPaths.filter((p) => path.resolve(p) !== resolved)
    if (state.selectedModelPath && path.resolve(state.selectedModelPath) === resolved) state.selectedModelPath = null
  })
}

export async function isKnownModelPath(filePath: string): Promise<boolean> {
  if (typeof filePath !== 'string' || !filePath) return false
  const resolved = path.resolve(filePath)
  const state = await getState()
  const candidate = await fs.realpath(resolved).catch(() => null)
  if (!candidate) return false
  for (const imported of state.importedModelPaths) {
    const known = await fs.realpath(path.resolve(imported)).catch(() => null)
    if (known === candidate) return true
  }
  for (const folder of state.modelFolders) {
    const root = await fs.realpath(path.resolve(folder)).catch(() => null)
    if (root && (candidate === root || candidate.startsWith(root + path.sep))) return true
  }
  return false
}

export async function deleteModelFile(filePath: string): Promise<{ deleted: boolean; freedBytes: number; reason?: string }> {
  if (typeof filePath !== 'string' || !filePath) {
    return { deleted: false, freedBytes: 0, reason: 'Invalid model path.' }
  }
  const resolved = path.resolve(filePath)
  const [candidate, listed, managedRoot] = await Promise.all([
    fs.realpath(resolved).catch(() => null),
    listModels(),
    fs.realpath(managedModelsDir()).catch(() => path.resolve(managedModelsDir())),
  ])
  if (!candidate) return { deleted: false, freedBytes: 0, reason: 'The model file no longer exists.' }
  const listedModel = await Promise.all(
    listed.map(async (model) => ({
      model,
      real: await fs.realpath(model.path).catch(() => null),
    })),
  ).then((entries) => entries.find((entry) => entry.real === candidate)?.model)
  if (!listedModel) {
    return { deleted: false, freedBytes: 0, reason: 'The file is not an exact model currently listed by PowerStation.' }
  }
  if (!(candidate === managedRoot || candidate.startsWith(managedRoot + path.sep))) {
    return {
      deleted: false,
      freedBytes: 0,
      reason: 'PowerStation only deletes models it downloaded. Remove externally managed models from the list instead.',
    }
  }

  const parts = await modelFilePaths(listedModel.path)
  const validatedParts: Array<{ path: string; size: number }> = []
  for (const part of parts) {
    const partReal = await fs.realpath(part).catch(() => null)
    if (!partReal || !(partReal === managedRoot || partReal.startsWith(managedRoot + path.sep))) {
      return { deleted: false, freedBytes: 0, reason: 'A model part resolved outside PowerStation storage.' }
    }
    const stat = await fs.stat(part).catch(() => null)
    if (!stat?.isFile()) return { deleted: false, freedBytes: 0, reason: 'A model part is no longer a regular file.' }
    validatedParts.push({ path: part, size: stat.size })
  }
  for (const part of validatedParts) await fs.rm(part.path, { force: true })
  await removeImported(listedModel.path)
  return { deleted: true, freedBytes: validatedParts.reduce((sum, part) => sum + part.size, 0) }
}

export async function selectModel(filePath: string | null): Promise<string | null> {
  const resolved = filePath ? path.resolve(filePath) : null
  await mutate((state) => {
    state.selectedModelPath = resolved
  })
  return resolved
}
