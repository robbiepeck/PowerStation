import { app } from 'electron'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { managedModelsDir } from './config.js'

const MB = 1_000_000
const GB = 1_000_000_000
const MAX_ENTRIES = 120_000
const MAX_DEPTH = 10
const LARGE_FILE_BYTES = 250 * MB
const LARGE_FOLDER_BYTES = 600 * MB

export type StorageBreakdownItem = {
  path: string
  name: string
  type: 'file' | 'directory'
  sizeBytes: number
  modifiedAt: number
  category: string
  reason: string
  potentiallyUnneeded: boolean
}

export type StorageBreakdownRoot = {
  path: string
  label: string
  sizeBytes: number
  skipped: number
}

export type StorageBreakdown = {
  scannedAt: number
  scannedBytes: number
  scannedEntries: number
  skipped: number
  roots: StorageBreakdownRoot[]
  items: StorageBreakdownItem[]
  cleanupBytes: number
  note: string
}

type ScanState = {
  entries: number
  skipped: number
  items: StorageBreakdownItem[]
  managedModelsPath: string
}

const staleDays = (modifiedAt: number) => (Date.now() - modifiedAt) / 86_400_000

function isInside(child: string, parent: string): boolean {
  const root = path.resolve(parent)
  return child === root || child.startsWith(root + path.sep)
}

// Storage results are produced by scanning locations under the user's home
// directory and the app's own data folder. Revealing a path is only allowed for
// items that fall inside those same roots, so the renderer cannot point the OS
// file manager at arbitrary locations.
export function isWithinScannedRoots(filePath: string): boolean {
  if (typeof filePath !== 'string' || !filePath) return false
  const resolved = path.resolve(filePath)
  return isInside(resolved, os.homedir()) || isInside(resolved, app.getPath('userData'))
}

async function exists(dirPath: string) {
  try {
    await fs.access(dirPath)
    return true
  } catch {
    return false
  }
}

function classify(filePath: string, type: 'file' | 'directory', sizeBytes: number, modifiedAt: number, managedModelsPath: string) {
  const normalized = filePath.split(path.sep).join('/')
  const lowerName = path.basename(filePath).toLowerCase()
  const days = staleDays(modifiedAt)
  const archive = /\.(dmg|pkg|zip|tar|tgz|gz|rar|7z|iso)$/i.test(lowerName)

  if (normalized.includes('/.Trash/')) {
    return { category: 'Trash', reason: 'Items in Trash are already marked for removal.', potentiallyUnneeded: true }
  }
  if (normalized.includes('/Library/Caches/')) {
    return { category: 'Cache', reason: 'Cache files are usually temporary and can often be rebuilt by apps.', potentiallyUnneeded: true }
  }
  if (normalized.startsWith(managedModelsPath.split(path.sep).join('/'))) {
    return { category: 'Local model', reason: 'Downloaded model files can be large, but may be intentionally kept for PowerStation.', potentiallyUnneeded: false }
  }
  if (type === 'directory' && lowerName === 'node_modules') {
    return { category: 'Development dependencies', reason: 'Dependency folders can often be recreated by reinstalling packages.', potentiallyUnneeded: true }
  }
  if (archive && days > 14) {
    return { category: 'Old installer or archive', reason: 'Installer and archive files are often safe to remove after use.', potentiallyUnneeded: true }
  }
  if (normalized.includes('/Downloads/') && days > 30) {
    return { category: 'Old download', reason: 'This download has not changed recently and may no longer be needed.', potentiallyUnneeded: true }
  }
  if (sizeBytes >= GB && days > 90) {
    return { category: 'Large inactive item', reason: 'This is large and has not changed recently.', potentiallyUnneeded: true }
  }
  return { category: 'Large item', reason: 'This is one of the larger items found in user storage.', potentiallyUnneeded: false }
}

function maybeAddItem(state: ScanState, item: Omit<StorageBreakdownItem, 'category' | 'reason' | 'potentiallyUnneeded'>) {
  const shouldAdd = item.sizeBytes >= (item.type === 'directory' ? LARGE_FOLDER_BYTES : LARGE_FILE_BYTES)
  if (!shouldAdd) return
  const classification = classify(item.path, item.type, item.sizeBytes, item.modifiedAt, state.managedModelsPath)
  state.items.push({ ...item, ...classification })
}

async function scanPath(targetPath: string, depth: number, state: ScanState): Promise<{ sizeBytes: number; modifiedAt: number; skipped: number }> {
  if (state.entries > MAX_ENTRIES || depth > MAX_DEPTH) return { sizeBytes: 0, modifiedAt: 0, skipped: 1 }

  state.entries += 1
  let stat
  try {
    stat = await fs.lstat(targetPath)
  } catch {
    state.skipped += 1
    return { sizeBytes: 0, modifiedAt: 0, skipped: 1 }
  }

  if (stat.isSymbolicLink()) return { sizeBytes: 0, modifiedAt: stat.mtimeMs, skipped: 0 }
  if (stat.isFile()) {
    maybeAddItem(state, {
      path: targetPath,
      name: path.basename(targetPath),
      type: 'file',
      sizeBytes: stat.size,
      modifiedAt: stat.mtimeMs,
    })
    return { sizeBytes: stat.size, modifiedAt: stat.mtimeMs, skipped: 0 }
  }
  if (!stat.isDirectory()) return { sizeBytes: 0, modifiedAt: stat.mtimeMs, skipped: 0 }

  let entries
  try {
    entries = await fs.readdir(targetPath, { withFileTypes: true })
  } catch {
    state.skipped += 1
    return { sizeBytes: 0, modifiedAt: stat.mtimeMs, skipped: 1 }
  }

  let sizeBytes = 0
  let modifiedAt = stat.mtimeMs
  let skipped = 0
  for (const entry of entries) {
    if (entry.name === 'node_modules' && depth > 3) continue
    const child = await scanPath(path.join(targetPath, entry.name), depth + 1, state)
    sizeBytes += child.sizeBytes
    modifiedAt = Math.max(modifiedAt, child.modifiedAt)
    skipped += child.skipped
  }

  if (depth <= 1 || path.basename(targetPath) === 'node_modules') {
    maybeAddItem(state, {
      path: targetPath,
      name: path.basename(targetPath),
      type: 'directory',
      sizeBytes,
      modifiedAt,
    })
  }

  return { sizeBytes, modifiedAt, skipped }
}

async function scanRoots() {
  const home = os.homedir()
  const roots = [
    { label: 'Downloads', path: path.join(home, 'Downloads') },
    { label: 'Desktop', path: path.join(home, 'Desktop') },
    { label: 'Documents', path: path.join(home, 'Documents') },
    { label: 'Movies', path: path.join(home, 'Movies') },
    { label: 'Pictures', path: path.join(home, 'Pictures') },
    { label: 'Music', path: path.join(home, 'Music') },
    { label: 'Caches', path: path.join(home, 'Library', 'Caches') },
    { label: 'Trash', path: path.join(home, '.Trash') },
    { label: 'PowerStation models', path: managedModelsDir() },
    { label: 'PowerStation data', path: app.getPath('userData') },
  ]

  const unique = new Map<string, { label: string; path: string }>()
  for (const root of roots) {
    if (await exists(root.path)) unique.set(root.path, root)
  }
  return [...unique.values()]
}

export async function analyzeStorage(): Promise<StorageBreakdown> {
  const managedModelsPath = managedModelsDir().split(path.sep).join('/')
  const state: ScanState = { entries: 0, skipped: 0, items: [], managedModelsPath }
  const roots: StorageBreakdownRoot[] = []

  for (const root of await scanRoots()) {
    const result = await scanPath(root.path, 0, state)
    roots.push({ path: root.path, label: root.label, sizeBytes: result.sizeBytes, skipped: result.skipped })
  }

  const items = state.items.sort((a, b) => Number(b.potentiallyUnneeded) - Number(a.potentiallyUnneeded) || b.sizeBytes - a.sizeBytes).slice(0, 80)

  return {
    scannedAt: Date.now(),
    scannedBytes: roots.reduce((sum, root) => sum + root.sizeBytes, 0),
    scannedEntries: state.entries,
    skipped: state.skipped,
    roots: roots.sort((a, b) => b.sizeBytes - a.sizeBytes),
    items,
    cleanupBytes: items.filter((item) => item.potentiallyUnneeded).reduce((sum, item) => sum + item.sizeBytes, 0),
    note: 'PowerStation scans common user-owned storage locations, caches, Trash, and its managed model folder. Protected system folders are not scanned.',
  }
}
