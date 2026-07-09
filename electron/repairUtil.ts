import path from 'node:path'
import { promises as fs } from 'node:fs'

export function isWithin(base: string, target: string): boolean {
  const rel = path.relative(path.resolve(base), path.resolve(target))
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

export async function assertWithinDir(base: string, target: string): Promise<string> {
  const realBase = await fs.realpath(base)

  let probe = path.resolve(target)
  let suffix = ''
  for (;;) {
    try {
      probe = await fs.realpath(probe)
      break
    } catch {
      suffix = path.join(path.basename(probe), suffix)
      const parent = path.dirname(probe)
      if (parent === probe) break
      probe = parent
    }
  }
  const resolved = path.join(probe, suffix)
  if (!isWithin(realBase, resolved)) {
    throw new Error(`Refusing to touch a path outside the app data folder: ${target}`)
  }
  return resolved
}

export type WalkResult = {
  sizeBytes: number
  fileCount: number

  approximate: boolean
}

export async function walkSize(dir: string, maxEntries = 20_000): Promise<WalkResult> {
  let sizeBytes = 0
  let fileCount = 0
  let seen = 0
  let approximate = false

  async function walk(current: string, depth: number): Promise<void> {
    if (approximate || depth > 12) return
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (seen >= maxEntries) {
        approximate = true
        return
      }
      seen += 1
      const full = path.join(current, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        await walk(full, depth + 1)
      } else if (entry.isFile()) {
        try {
          sizeBytes += (await fs.lstat(full)).size
          fileCount += 1
        } catch {
          void 0
        }
      }
    }
  }

  await walk(dir, 0)
  return { sizeBytes, fileCount, approximate }
}

export type ModelFileRef = {

  app: string
  name: string
  path: string
  sizeBytes: number
}

export type DuplicateGroup = {

  key: string
  copies: ModelFileRef[]

  wastedBytes: number
}

export function findDuplicateModels(refs: ModelFileRef[]): DuplicateGroup[] {
  const groups = new Map<string, ModelFileRef[]>()
  for (const ref of refs) {
    if (!ref.sizeBytes) continue
    const base = path.basename(ref.name || ref.path).toLowerCase()
    const key = `${base}::${ref.sizeBytes}`
    groups.set(key, [...(groups.get(key) ?? []), ref])
  }
  const out: DuplicateGroup[] = []
  for (const [key, copies] of groups) {
    const apps = new Set(copies.map((c) => c.app))

    if (copies.length < 2 || apps.size < 2) continue
    const distinctPaths = new Set(copies.map((c) => path.resolve(c.path)))
    if (distinctPaths.size < 2) continue
    out.push({ key, copies, wastedBytes: (distinctPaths.size - 1) * copies[0].sizeBytes })
  }
  return out.sort((a, b) => b.wastedBytes - a.wastedBytes)
}

export function looksLikeGguf(firstBytes: Buffer): boolean {
  return firstBytes.length >= 4 && firstBytes.toString('ascii', 0, 4) === 'GGUF'
}
