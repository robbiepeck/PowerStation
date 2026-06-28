import { promises as fs } from 'node:fs'
import path from 'node:path'
import { readGgufFileInfo } from 'node-llama-cpp'
import { getState, mutate } from './config.js'

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

async function readMetadata(filePath: string): Promise<Omit<ModelInfo, 'path' | 'fileName' | 'sizeBytes' | 'source'>> {
  const fileName = path.basename(filePath)
  const fallback = {
    name: fileName.replace(/\.gguf$/i, ''),
    architecture: null,
    parameters: null,
    quantization: quantFromName(fileName),
    contextLength: null,
  }
  try {
    const info = (await readGgufFileInfo(filePath, { readTensorInfo: false, logWarnings: false })) as {
      metadata?: Record<string, Record<string, unknown>>
    }
    const metadata = info.metadata ?? {}
    const general = (metadata.general ?? {}) as Record<string, unknown>
    const architecture = typeof general.architecture === 'string' ? general.architecture : null
    const archMeta = architecture ? ((metadata[architecture] ?? {}) as Record<string, unknown>) : {}
    const contextLength = typeof archMeta.context_length === 'number' ? archMeta.context_length : null
    return {
      name: typeof general.name === 'string' && general.name.trim() ? general.name : fallback.name,
      architecture,
      parameters: typeof general.size_label === 'string' ? general.size_label : null,
      quantization: quantFromName(fileName),
      contextLength,
    }
  } catch {
    return fallback
  }
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
      let sizeBytes: number
      try {
        sizeBytes = (await fs.stat(filePath)).size
      } catch {
        return null
      }
      const meta = await readMetadata(filePath)
      return { path: filePath, fileName: path.basename(filePath), sizeBytes, source, ...meta } satisfies ModelInfo
    }),
  )

  return entries.filter((entry): entry is ModelInfo => entry !== null).sort((a, b) => a.name.localeCompare(b.name))
}

export async function importModelFile(filePath: string): Promise<void> {
  const resolved = path.resolve(filePath)
  await fs.access(resolved)
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
  return (
    state.importedModelPaths.some((p) => path.resolve(p) === resolved) ||
    state.modelFolders.some((folder) => {
      const root = path.resolve(folder)
      return resolved === root || resolved.startsWith(root + path.sep)
    })
  )
}

export async function deleteModelFile(filePath: string): Promise<{ deleted: boolean; reason?: string }> {
  const resolved = path.resolve(filePath)
  const known = await isKnownModelPath(resolved)
  if (!known) return { deleted: false, reason: 'File is outside any known model folder' }
  await fs.rm(resolved)
  await removeImported(resolved)
  return { deleted: true }
}

export async function selectModel(filePath: string | null): Promise<string | null> {
  const resolved = filePath ? path.resolve(filePath) : null
  await mutate((state) => {
    state.selectedModelPath = resolved
  })
  return resolved
}
