// Model catalog service. The catalog is the product's editorial heart — it
// must be updatable without shipping a new app build, so the source of truth
// is catalog/models.json in the GitHub repo, fetched at launch and on demand
// ("Update catalog"), with the copy bundled at build time as offline fallback.
// Remote JSON is untrusted input: every field is validated and download URLs
// are pinned to huggingface.co before anything reaches the renderer.

import { app } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { KvGeometry } from './admission.js'

export type ToolCallingTier = 'none' | 'single' | 'multi'
export type UseCase = 'everyday' | 'coding' | 'agents' | 'documents' | 'reasoning'

export type CatalogModel = {
  id: string
  name: string
  family: string
  hfRepo: string
  downloadUrl: string
  websiteUrl: string
  fileName: string
  sizeBytes: number
  quant: string
  totalParamsB: number
  activeParamsB: number | null
  geometry: KvGeometry | null
  kvBytesPerToken: number | null
  maxContext: number | null
  toolCalling: ToolCallingTier
  license: string
  minRamGb: number
  expectedTps: string | null
  useCases: UseCase[]
  goodAt: string[]
  strugglesWith: string[]
}

export type Catalog = {
  schemaVersion: number
  updatedAt: string
  source: 'bundled' | 'cached' | 'remote'
  models: CatalogModel[]
}

const REMOTE_CATALOG_URL = 'https://raw.githubusercontent.com/robbiepeck/PowerStation/main/catalog/models.json'
const USE_CASES: UseCase[] = ['everyday', 'coding', 'agents', 'documents', 'reasoning']
const TIERS: ToolCallingTier[] = ['none', 'single', 'multi']

function cachedCatalogPath(): string {
  return path.join(app.getPath('userData'), 'catalog-cache.json')
}

function bundledCatalogPath(): string {
  return path.join(app.getAppPath(), 'catalog', 'models.json')
}

function cleanString(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

function cleanNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function cleanStringArray(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return []
  return value
    .slice(0, maxItems)
    .map((item) => cleanString(item, maxLength))
    .filter(Boolean)
}

function isTrustedModelUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && parsed.hostname === 'huggingface.co'
  } catch {
    return false
  }
}

function sanitizeModel(value: unknown): CatalogModel | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>

  const id = cleanString(record.id, 80)
  const name = cleanString(record.name, 120)
  const downloadUrl = cleanString(record.downloadUrl, 500)
  const websiteUrl = cleanString(record.websiteUrl, 500)
  const fileName = cleanString(record.fileName, 200)
  const sizeBytes = cleanNumber(record.sizeBytes)
  const minRamGb = cleanNumber(record.minRamGb)
  if (!id || !name || !fileName || !sizeBytes || !minRamGb) return null
  if (!isTrustedModelUrl(downloadUrl) || !isTrustedModelUrl(websiteUrl)) return null

  const geometryRecord =
    typeof record.geometry === 'object' && record.geometry !== null ? (record.geometry as Record<string, unknown>) : null
  const nLayers = cleanNumber(geometryRecord?.nLayers)
  const nKvHeads = cleanNumber(geometryRecord?.nKvHeads)
  const headDim = cleanNumber(geometryRecord?.headDim)
  const geometry: KvGeometry | null = nLayers && nKvHeads && headDim ? { nLayers, nKvHeads, headDim } : null

  const toolCalling = TIERS.includes(record.toolCalling as ToolCallingTier)
    ? (record.toolCalling as ToolCallingTier)
    : 'none'
  const useCases = Array.isArray(record.useCases)
    ? (record.useCases.filter((item) => USE_CASES.includes(item as UseCase)) as UseCase[])
    : []

  return {
    id,
    name,
    family: cleanString(record.family, 120),
    hfRepo: cleanString(record.hfRepo, 200),
    downloadUrl,
    websiteUrl,
    fileName,
    sizeBytes,
    quant: cleanString(record.quant, 40),
    totalParamsB: cleanNumber(record.totalParamsB) ?? 0,
    activeParamsB: cleanNumber(record.activeParamsB),
    geometry,
    kvBytesPerToken: cleanNumber(record.kvBytesPerToken),
    maxContext: cleanNumber(record.maxContext),
    toolCalling,
    license: cleanString(record.license, 120),
    minRamGb,
    expectedTps: cleanString(record.expectedTps, 80) || null,
    useCases,
    goodAt: cleanStringArray(record.goodAt, 6, 200),
    strugglesWith: cleanStringArray(record.strugglesWith, 6, 200),
  }
}

function sanitizeCatalog(raw: unknown, source: Catalog['source']): Catalog | null {
  if (typeof raw !== 'object' || raw === null) return null
  const record = raw as Record<string, unknown>
  const schemaVersion = cleanNumber(record.schemaVersion)
  if (schemaVersion !== 1) return null
  const models = Array.isArray(record.models)
    ? record.models.map(sanitizeModel).filter((model): model is CatalogModel => model !== null)
    : []
  if (!models.length) return null
  return {
    schemaVersion,
    updatedAt: cleanString(record.updatedAt, 40),
    source,
    models,
  }
}

let current: Catalog | null = null

async function readCatalogFile(filePath: string, source: Catalog['source']): Promise<Catalog | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    return sanitizeCatalog(JSON.parse(raw), source)
  } catch {
    return null
  }
}

export async function getCatalog(): Promise<Catalog> {
  if (current) return current
  const cached = await readCatalogFile(cachedCatalogPath(), 'cached')
  const bundled = await readCatalogFile(bundledCatalogPath(), 'bundled')
  // Prefer whichever is newer; the cache is only ever written from a validated
  // remote fetch, so a stale bundled copy loses to a fresher cache.
  if (cached && bundled) {
    current = cached.updatedAt >= bundled.updatedAt ? cached : bundled
  } else {
    current = cached ?? bundled
  }
  if (!current) {
    current = { schemaVersion: 1, updatedAt: '', source: 'bundled', models: [] }
  }
  return current
}

export async function refreshCatalog(): Promise<Catalog> {
  const base = await getCatalog()
  try {
    const response = await fetch(REMOTE_CATALOG_URL, { signal: AbortSignal.timeout(15000) })
    if (!response.ok) throw new Error(`Catalog fetch failed (${response.status})`)
    const parsed = sanitizeCatalog(await response.json(), 'remote')
    if (!parsed) throw new Error('Remote catalog failed validation')
    await fs.writeFile(cachedCatalogPath(), JSON.stringify({ ...parsed, source: undefined }, null, 1), 'utf8')
    current = parsed
    return parsed
  } catch {
    // Offline or invalid remote data — keep whatever we already had.
    return base
  }
}
