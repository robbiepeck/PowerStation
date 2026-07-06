// Repair tab service. The contract, enforced structurally:
//
//   1. Everything outside the app's data folder is READ-ONLY. The only action
//      offered on external paths is "reveal in Finder" — the human deletes
//      with their own hands, through the OS, recoverably (Trash).
//   2. Deletes exist only for data PowerStation itself created, resolve their
//      targets server-side from an allowlist of ids (the renderer never sends
//      a path), and every one must pass assertWithinDir(userData) — the
//      realpath containment guard unit-tested against traversal and symlink
//      escapes.
//   3. No shell commands, no elevation, no system files. Ever.
//
// Every delete is appended to a repair log (also in the data folder), so the
// tab can show exactly what it has ever removed.

import os from 'node:os'
import path from 'node:path'
import { app, shell } from 'electron'
import { promises as fs } from 'node:fs'
import si from 'systeminformation'
import { assertWithinDir, findDuplicateModels, looksLikeGguf, walkSize, type DuplicateGroup, type ModelFileRef } from './repairUtil.js'
import { getOllamaStatus } from './ollama.js'
import { getLmStudioStatus } from './lmstudio.js'
import * as models from './models.js'
import * as rag from './rag.js'
import { getCatalog } from './catalog.js'

export type StorageLocation = {
  id: string
  label: string
  path: string
  exists: boolean
  sizeBytes: number
  fileCount: number
  /** True when the size walk hit its cap — the figure is a floor. */
  approximate: boolean
  /** Why this location is on the curated list. */
  note: string
  /** Everything here is reveal-only; kept explicit so the UI can say so. */
  action: 'reveal-only'
}

export type StorageReport = {
  disk: { totalGb: number; freeGb: number; usedGb: number } | null
  locations: StorageLocation[]
  duplicates: DuplicateGroup[]
  scannedAt: number
}

export type Reclaimable = {
  id: string
  label: string
  detail: string
  sizeBytes: number
  /** What happens after removal — every entry must be rebuildable or re-downloadable. */
  consequence: string
}

export type IntegrityResult = {
  path: string
  name: string
  status: 'ok' | 'missing' | 'not-gguf' | 'size-mismatch' | 'unreadable'
  detail: string
}

export type RepairLogEntry = {
  id: string
  label: string
  sizeBytes: number
  timestamp: number
}

// --- Curated read-only scan list ----------------------------------------------

function curatedLocations(): Array<{ id: string; label: string; path: string; note: string }> {
  const home = os.homedir()
  const userData = app.getPath('userData')
  const common = [
    { id: 'ps-models', label: 'PowerStation models', path: path.join(userData, 'models'), note: 'Managed model downloads. Delete individual models from the Models tab.' },
    { id: 'ps-data', label: 'PowerStation data (chats, skills, indexes)', path: userData, note: 'Everything the app stores. Individual pieces are managed in their own tabs.' },
    { id: 'downloads', label: 'Downloads folder', path: path.join(home, 'Downloads'), note: 'A common home for forgotten model files and installers.' },
    { id: 'ollama', label: 'Ollama models', path: path.join(home, '.ollama', 'models'), note: 'Managed by Ollama (ollama rm <model>). Import into PowerStation without copying from the Models tab.' },
    { id: 'lmstudio', label: 'LM Studio models', path: path.join(home, '.lmstudio', 'models'), note: 'Managed inside LM Studio. Import into PowerStation without copying from the Models tab.' },
    { id: 'hf-cache', label: 'Hugging Face cache', path: path.join(home, '.cache', 'huggingface'), note: 'Created by Python tools (transformers, diffusers). Safe to clear if you no longer use them — they re-download on use.' },
  ]
  if (process.platform === 'darwin') {
    common.push({ id: 'trash', label: 'Trash', path: path.join(home, '.Trash'), note: 'Empty it from Finder when you are sure.' })
  }
  return common
}

async function getDisk(): Promise<StorageReport['disk']> {
  try {
    const disks = await si.fsSize()
    const target = app.getPath('userData').toLowerCase()
    const disk =
      disks
        .filter((d) => d.mount && target.startsWith(d.mount.toLowerCase()))
        .sort((a, b) => b.mount.length - a.mount.length)[0] ?? disks.find((d) => d.mount === '/') ?? disks[0]
    if (!disk?.size) return null
    const free = typeof disk.available === 'number' ? disk.available : disk.size - disk.used
    return {
      totalGb: Math.round(disk.size / 1e8) / 10,
      freeGb: Math.round(free / 1e8) / 10,
      usedGb: Math.round((disk.size - free) / 1e8) / 10,
    }
  } catch {
    return null
  }
}

async function collectModelRefs(): Promise<ModelFileRef[]> {
  const refs: ModelFileRef[] = []
  const [ours, ollama, lmstudio] = await Promise.all([
    models.listModels().catch(() => []),
    getOllamaStatus().catch(() => ({ models: [] as Array<{ name: string; blobPath: string; sizeBytes: number }> })),
    getLmStudioStatus().catch(() => ({ models: [] as Array<{ name: string; fileName: string; path: string; sizeBytes: number }> })),
  ])
  for (const m of ours) refs.push({ app: 'PowerStation', name: m.fileName, path: m.path, sizeBytes: m.sizeBytes })
  // Ollama blobs are content-addressed (no file name), so pair them with our
  // models by exact size only when the tag name matches nothing — skip: size-only
  // matching would be guesswork, and the duplicate list must never guess.
  for (const m of lmstudio.models) refs.push({ app: 'LM Studio', name: m.fileName, path: m.path, sizeBytes: m.sizeBytes })
  void ollama
  return refs
}

export async function getStorageReport(): Promise<StorageReport> {
  const locations: StorageLocation[] = []
  for (const loc of curatedLocations()) {
    let exists = false
    try {
      exists = (await fs.stat(loc.path)).isDirectory()
    } catch {
      /* stays false */
    }
    const walk = exists ? await walkSize(loc.path) : { sizeBytes: 0, fileCount: 0, approximate: false }
    locations.push({ ...loc, exists, ...walk, action: 'reveal-only' })
  }
  const duplicates = findDuplicateModels(await collectModelRefs())
  return { disk: await getDisk(), locations, duplicates, scannedAt: Date.now() }
}

/** Reveal a curated location in the OS file manager. Ids only — never paths. */
export async function revealLocation(id: unknown): Promise<boolean> {
  const loc = curatedLocations().find((l) => l.id === id)
  if (!loc) return false
  try {
    await fs.access(loc.path)
  } catch {
    return false
  }
  shell.showItemInFolder(loc.path)
  return true
}

// --- Reclaimables (app-owned data only) -----------------------------------------

const EMBED_MODEL_FILE = 'nomic-embed-text-v1.5.Q8_0.gguf'

async function sizeOf(target: string): Promise<number> {
  try {
    const stat = await fs.stat(target)
    return stat.isDirectory() ? (await walkSize(target)).sizeBytes : stat.size
  } catch {
    return 0
  }
}

/** Resolve a reclaimable id to concrete paths — server-side, allowlisted. */
async function reclaimableTargets(id: string): Promise<{ label: string; paths: string[] } | null> {
  const userData = app.getPath('userData')
  if (id.startsWith('rag-orphan-')) {
    const folderId = id.slice('rag-orphan-'.length)
    if (!/^[a-f0-9]{16}$/.test(folderId)) return null
    return { label: `Orphaned folder index ${folderId}`, paths: [path.join(userData, 'rag', `${folderId}.json`)] }
  }
  if (id === 'embeddings-model') {
    return { label: 'Embeddings model (re-downloads on next folder use)', paths: [path.join(userData, 'embeddings', EMBED_MODEL_FILE)] }
  }
  if (id === 'catalog-caches') {
    return {
      label: 'Catalogue caches (refetched automatically)',
      paths: ['catalog-cache.json', 'connectors-cache.json', 'skills-cache.json'].map((f) => path.join(userData, f)),
    }
  }
  return null
}

export async function getReclaimables(): Promise<Reclaimable[]> {
  const out: Reclaimable[] = []
  const indexes = await rag.listFolderIndexes().catch(() => [])
  for (const index of indexes) {
    if (!index.missing) continue
    out.push({
      id: `rag-orphan-${index.folderId}`,
      label: `Index of a deleted folder: ${index.name}`,
      detail: `The folder ${index.folder} no longer exists, so this index can never be used again.`,
      sizeBytes: index.sizeBytes,
      consequence: 'Nothing — the source folder is already gone.',
    })
  }
  const embed = await sizeOf(path.join(app.getPath('userData'), 'embeddings', EMBED_MODEL_FILE))
  if (embed > 0) {
    out.push({
      id: 'embeddings-model',
      label: 'Folder-chat embeddings model',
      detail: 'Used to index knowledge folders. Only worth removing if you do not chat with folders.',
      sizeBytes: embed,
      consequence: 'Re-downloads (~84 MB) the next time you attach a folder.',
    })
  }
  let cacheBytes = 0
  for (const target of (await reclaimableTargets('catalog-caches'))!.paths) cacheBytes += await sizeOf(target)
  if (cacheBytes > 0) {
    out.push({
      id: 'catalog-caches',
      label: 'Catalogue caches',
      detail: 'Cached copies of the model, connector, and skill catalogues.',
      sizeBytes: cacheBytes,
      consequence: 'Refetched from the repository on next launch — the bundled copies cover offline use.',
    })
  }
  return out
}

const repairLogFile = () => path.join(app.getPath('userData'), 'repair-log.json')

export async function getRepairLog(): Promise<RepairLogEntry[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(repairLogFile(), 'utf8')) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((e): e is RepairLogEntry => typeof e === 'object' && e !== null && typeof (e as RepairLogEntry).label === 'string')
      .slice(-100)
  } catch {
    return []
  }
}

async function appendRepairLog(entry: RepairLogEntry): Promise<void> {
  const log = [...(await getRepairLog()), entry].slice(-100)
  await fs.writeFile(repairLogFile(), JSON.stringify(log, null, 1), 'utf8')
}

/**
 * Remove one reclaimable. The id is resolved to paths here, and every path
 * must pass the containment guard — belt and braces, since the allowlist
 * above already only produces userData paths.
 */
export async function cleanReclaimable(id: unknown): Promise<{ removed: boolean; freedBytes: number }> {
  if (typeof id !== 'string') return { removed: false, freedBytes: 0 }
  const target = await reclaimableTargets(id)
  if (!target) return { removed: false, freedBytes: 0 }
  const userData = app.getPath('userData')
  let freedBytes = 0
  for (const filePath of target.paths) {
    const safePath = await assertWithinDir(userData, filePath)
    const bytes = await sizeOf(safePath)
    try {
      await fs.rm(safePath, { force: true })
      freedBytes += bytes
    } catch {
      /* already gone or unreadable — fine */
    }
  }
  if (freedBytes > 0) {
    await appendRepairLog({ id, label: target.label, sizeBytes: freedBytes, timestamp: Date.now() })
  }
  return { removed: freedBytes > 0, freedBytes }
}

// --- Model integrity (read-only) -------------------------------------------------

export async function checkModelIntegrity(): Promise<IntegrityResult[]> {
  const list = await models.listModels().catch(() => [])
  const results: IntegrityResult[] = []
  for (const model of list) {
    let handle: import('node:fs/promises').FileHandle | null = null
    try {
      handle = await fs.open(model.path, 'r')
      const buffer = Buffer.alloc(4)
      await handle.read(buffer, 0, 4, 0)
      if (!looksLikeGguf(buffer)) {
        results.push({ path: model.path, name: model.name, status: 'not-gguf', detail: 'The file does not start with the GGUF signature — likely corrupt or mis-downloaded.' })
        continue
      }
      const catalog = await getCatalog().catch(() => null)
      const entry = catalog?.models.find((c) => c.fileName.toLowerCase() === path.basename(model.path).toLowerCase()) ?? null
      if (entry?.sizeBytes && model.sizeBytes < entry.sizeBytes * 0.98) {
        results.push({
          path: model.path,
          name: model.name,
          status: 'size-mismatch',
          detail: `File is ${(model.sizeBytes / 1e9).toFixed(2)} GB but the catalogue lists ${(entry.sizeBytes / 1e9).toFixed(2)} GB — the download may be incomplete. Re-download from the Models tab.`,
        })
        continue
      }
      results.push({ path: model.path, name: model.name, status: 'ok', detail: 'Valid GGUF header and plausible size.' })
    } catch {
      results.push({ path: model.path, name: model.name, status: 'unreadable', detail: 'The file could not be opened.' })
    } finally {
      await handle?.close().catch(() => undefined)
    }
  }
  return results
}
