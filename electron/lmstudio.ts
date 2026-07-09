import os from 'node:os'
import path from 'node:path'
import { promises as fs } from 'node:fs'

export type LmStudioModel = {

  name: string
  fileName: string
  path: string

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

    path.join(home, '.cache', 'lm-studio', 'models'),
  ]
}

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

      if (entry.name.toLowerCase().startsWith('mmproj')) continue

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

export async function resolveLmStudioModel(filePath: unknown): Promise<LmStudioModel | null> {
  if (typeof filePath !== 'string') return null
  const models = await listAll()
  return models.find((model) => model.path === filePath) ?? null
}
