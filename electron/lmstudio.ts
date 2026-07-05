// LM Studio detection. Like the Ollama import, this borrows GGUF files people
// already have on disk — LM Studio stores them as plain .gguf files under
// ~/.lmstudio/models/<publisher>/<repo>/ — and registers them in place, no
// re-download and no extra disk. Inference always runs in PowerStation's own
// runtime with the same admission checks as any other model.

import os from 'node:os'
import path from 'node:path'
import { promises as fs } from 'node:fs'

export type LmStudioModel = {
  /** "publisher/repo" as LM Studio presents it. */
  name: string
  fileName: string
  path: string
  /** For split GGUFs this is the whole series, matching what loading costs. */
  sizeBytes: number
}

export type LmStudioStatus = {
  detected: boolean
  models: LmStudioModel[]
}

const MAX_MODELS = 100
const MAX_DEPTH = 4
const SPLIT_PATTERN = /-(\d{5})-of-(\d{5})\.gguf$/i

function candidateRoots(): string[] {
  const home = os.homedir()
  return [
    path.join(home, '.lmstudio', 'models'),
    // Pre-0.3 releases kept models under the cache directory.
    path.join(home, '.cache', 'lm-studio', 'models'),
  ]
}

/**
 * Walk one LM Studio models root. Exported for tests — production callers go
 * through getLmStudioStatus/resolveLmStudioModel, which pin the roots.
 */
export async function listModelsUnder(root: string): Promise<LmStudioModel[]> {
  const models: LmStudioModel[] = []

  async function walk(dir: string, segments: string[]): Promise<void> {
    if (segments.length > MAX_DEPTH || models.length >= MAX_MODELS) return
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    const ggufs = entries.filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.gguf'))
    for (const entry of entries) {
      if (entry.isDirectory()) await walk(path.join(dir, entry.name), [...segments, entry.name])
    }
    for (const entry of ggufs) {
      if (models.length >= MAX_MODELS) return
      // Vision projectors are companions, not chat models.
      if (entry.name.toLowerCase().startsWith('mmproj')) continue
      // For split series, surface only part 1 and price the whole set —
      // that is what actually loads (admission sums the parts the same way).
      const split = SPLIT_PATTERN.exec(entry.name)
      if (split && split[1] !== '00001') continue
      const full = path.join(dir, entry.name)
      let sizeBytes = 0
      try {
        if (split) {
          const prefix = entry.name.slice(0, entry.name.length - split[0].length)
          const parts = ggufs.filter((e) => e.name.startsWith(prefix) && SPLIT_PATTERN.test(e.name))
          for (const part of parts) sizeBytes += (await fs.stat(path.join(dir, part.name))).size
        } else {
          sizeBytes = (await fs.stat(full)).size
        }
      } catch {
        continue
      }
      models.push({
        name: segments.length >= 2 ? `${segments[0]}/${segments[1]}` : segments[0] ?? entry.name,
        fileName: entry.name,
        path: full,
        sizeBytes,
      })
    }
  }

  await walk(root, [])
  return models
}

async function listAll(): Promise<LmStudioModel[]> {
  const seen = new Set<string>()
  const models: LmStudioModel[] = []
  for (const root of candidateRoots()) {
    for (const model of await listModelsUnder(root)) {
      if (seen.has(model.path)) continue
      seen.add(model.path)
      models.push(model)
    }
  }
  return models.sort((a, b) => a.name.localeCompare(b.name) || a.fileName.localeCompare(b.fileName))
}

export async function getLmStudioStatus(): Promise<LmStudioStatus> {
  const models = await listAll()
  return { detected: models.length > 0, models }
}

/** Resolve to a listed file — server-side, so the renderer never supplies a path. */
export async function resolveLmStudioModel(filePath: unknown): Promise<LmStudioModel | null> {
  if (typeof filePath !== 'string') return null
  const models = await listAll()
  return models.find((model) => model.path === filePath) ?? null
}
