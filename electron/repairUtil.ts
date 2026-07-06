// Pure core of the Repair tab. The safety property of the whole feature
// lives here: assertWithinDir is the single gate every Repair delete must
// pass, and it resolves symlinks before judging containment — so neither
// `..` traversal nor a symlink planted inside the data folder can point a
// delete at anything outside it. Unit-tested against both attacks.

import path from 'node:path'
import { promises as fs } from 'node:fs'

/** True when target (fully resolved) sits at or below base (fully resolved). */
export function isWithin(base: string, target: string): boolean {
  const rel = path.relative(path.resolve(base), path.resolve(target))
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/**
 * Throws unless `target` — after resolving symlinks on every existing part of
 * its path — is inside `base`. Every mutating Repair operation calls this.
 */
export async function assertWithinDir(base: string, target: string): Promise<string> {
  const realBase = await fs.realpath(base)
  // realpath the deepest existing ancestor so a symlinked parent can't smuggle
  // a not-yet-checked leaf outside the base.
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
  /** True when the walk hit its entry cap — the size is a floor, not a total. */
  approximate: boolean
}

/**
 * Bounded, read-only size walk: stat only, never follows symlinks, stops at
 * maxEntries so a giant Downloads folder can't stall the app.
 */
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
          /* raced or unreadable — skip */
        }
      }
    }
  }

  await walk(dir, 0)
  return { sizeBytes, fileCount, approximate }
}

export type ModelFileRef = {
  /** Which app owns the copy, e.g. "PowerStation", "Ollama", "LM Studio". */
  app: string
  name: string
  path: string
  sizeBytes: number
}

export type DuplicateGroup = {
  /** Normalized key the copies matched on. */
  key: string
  copies: ModelFileRef[]
  /** Bytes recoverable by keeping one copy. */
  wastedBytes: number
}

/**
 * Same weights installed by more than one app. Exact size match plus a
 * normalized file name — deliberately conservative, so it never claims two
 * different quantizations are duplicates.
 */
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
    // Only cross-app copies count: two entries from one app are usually the
    // same file listed twice (e.g. a folder added and a file imported).
    if (copies.length < 2 || apps.size < 2) continue
    const distinctPaths = new Set(copies.map((c) => path.resolve(c.path)))
    if (distinctPaths.size < 2) continue
    out.push({ key, copies, wastedBytes: (distinctPaths.size - 1) * copies[0].sizeBytes })
  }
  return out.sort((a, b) => b.wastedBytes - a.wastedBytes)
}

/** GGUF files start with the ASCII magic "GGUF". */
export function looksLikeGguf(firstBytes: Buffer): boolean {
  return firstBytes.length >= 4 && firstBytes.toString('ascii', 0, 4) === 'GGUF'
}
