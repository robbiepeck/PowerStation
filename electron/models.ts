import { promises as fs } from 'node:fs'
import path from 'node:path'
import { readGgufFileInfo } from 'node-llama-cpp'
import { getState, mutate } from './config.js'
import type { KvGeometry } from './admission.js'

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

  geometry: KvGeometry | null

  templateSupportsTools: boolean | null
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

type ModelMetadata = Omit<ModelInfo, 'path' | 'fileName' | 'sizeBytes' | 'source'>

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
      return { path: filePath, fileName: path.basename(filePath), sizeBytes, source, ...meta } satisfies ModelInfo
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
  return { path: resolved, fileName: path.basename(resolved), sizeBytes, source: 'folder', ...meta }
}

export async function importModelFile(filePath: string): Promise<void> {
  const resolved = path.resolve(filePath)
  const stat = await fs.stat(resolved)
  if (!stat.isFile()) throw new Error('Model path is not a file.')
  await mutate((state) => {
    if (!state.importedModelPaths.includes(resolved)) state.importedModelPaths.push(resolved)
  })
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
  const resolved = path.resolve(filePath)
  const known = await isKnownModelPath(resolved)
  if (!known) return { deleted: false, freedBytes: 0, reason: 'File is outside any known model folder' }

  const parts = await modelFilePaths(resolved)
  let freedBytes = 0
  for (const part of parts) {
    try {
      freedBytes += (await fs.stat(part)).size
    } catch {
      void 0
    }
    await fs.rm(part, { force: true })
  }
  await removeImported(resolved)
  return { deleted: true, freedBytes }
}

export async function selectModel(filePath: string | null): Promise<string | null> {
  const resolved = filePath ? path.resolve(filePath) : null
  await mutate((state) => {
    state.selectedModelPath = resolved
  })
  return resolved
}
