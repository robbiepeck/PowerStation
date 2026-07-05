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

export type VisionSupport = {
  mmprojUrl: string
  mmprojFileName: string
  mmprojSizeBytes: number
}

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
  /**
   * The model's vision variant files, when they exist. Metadata only for now:
   * the bundled runtime has no multimodal support yet (docs/vision-plan.md),
   * so nothing downloads or gates on this until it does.
   */
  vision: VisionSupport | null
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

  const visionRecord =
    typeof record.vision === 'object' && record.vision !== null ? (record.vision as Record<string, unknown>) : null
  const mmprojUrl = cleanString(visionRecord?.mmprojUrl, 500)
  const mmprojFileName = cleanString(visionRecord?.mmprojFileName, 200)
  const mmprojSizeBytes = cleanNumber(visionRecord?.mmprojSizeBytes)
  const vision: VisionSupport | null =
    visionRecord && isTrustedModelUrl(mmprojUrl) && mmprojFileName && mmprojSizeBytes
      ? { mmprojUrl, mmprojFileName, mmprojSizeBytes }
      : null

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
    vision,
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

// --- Connector gallery -------------------------------------------------------
// Curated MCP servers, one click to add. Same remote/cache/bundled lifecycle
// as the model catalog — and stricter validation, because these entries become
// spawned child processes: only `npx -y <validated-npm-package> <safe-args>`
// can ever be constructed from this data.

export type ConnectorEntry = {
  id: string
  name: string
  tagline: string
  /** What the model concretely gets — shown on the card. */
  detail: string
  npmPackage: string
  /** Literal args; the string "{folder}" is replaced by a user-picked folder. */
  args: string[]
  needsFolder: boolean
  maintainer: 'official' | 'community'
  worksOffline: boolean
  permissionsNote: string
}

export type ConnectorCatalog = {
  schemaVersion: number
  updatedAt: string
  source: 'bundled' | 'cached' | 'remote'
  connectors: ConnectorEntry[]
}

const REMOTE_CONNECTORS_URL = 'https://raw.githubusercontent.com/robbiepeck/PowerStation/main/catalog/connectors.json'
const NPM_PACKAGE_RE = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/
// No leading dash (no flag injection), conservative charset, or the folder token.
const SAFE_ARG_RE = /^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,119}$/

function cachedConnectorsPath(): string {
  return path.join(app.getPath('userData'), 'connectors-cache.json')
}

function bundledConnectorsPath(): string {
  return path.join(app.getAppPath(), 'catalog', 'connectors.json')
}

function sanitizeConnector(value: unknown): ConnectorEntry | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  const id = cleanString(record.id, 60)
  const name = cleanString(record.name, 80)
  const npmPackage = cleanString(record.npmPackage, 214)
  if (!id || !name || !NPM_PACKAGE_RE.test(npmPackage)) return null
  const args = Array.isArray(record.args)
    ? record.args.slice(0, 6).map((arg) => cleanString(arg, 120))
    : []
  if (!args.every((arg) => arg === '{folder}' || SAFE_ARG_RE.test(arg))) return null
  return {
    id,
    name,
    tagline: cleanString(record.tagline, 160),
    detail: cleanString(record.detail, 400),
    npmPackage,
    args,
    needsFolder: record.needsFolder === true || args.includes('{folder}'),
    maintainer: record.maintainer === 'official' ? 'official' : 'community',
    worksOffline: record.worksOffline === true,
    permissionsNote: cleanString(record.permissionsNote, 200),
  }
}

function sanitizeConnectorCatalog(raw: unknown, source: ConnectorCatalog['source']): ConnectorCatalog | null {
  if (typeof raw !== 'object' || raw === null) return null
  const record = raw as Record<string, unknown>
  if (cleanNumber(record.schemaVersion) !== 1) return null
  const connectors = Array.isArray(record.connectors)
    ? record.connectors.map(sanitizeConnector).filter((c): c is ConnectorEntry => c !== null)
    : []
  if (!connectors.length) return null
  return { schemaVersion: 1, updatedAt: cleanString(record.updatedAt, 40), source, connectors }
}

let currentConnectors: ConnectorCatalog | null = null

async function readConnectorsFile(filePath: string, source: ConnectorCatalog['source']): Promise<ConnectorCatalog | null> {
  try {
    return sanitizeConnectorCatalog(JSON.parse(await fs.readFile(filePath, 'utf8')), source)
  } catch {
    return null
  }
}

export async function getConnectorCatalog(): Promise<ConnectorCatalog> {
  if (currentConnectors) return currentConnectors
  const cached = await readConnectorsFile(cachedConnectorsPath(), 'cached')
  const bundled = await readConnectorsFile(bundledConnectorsPath(), 'bundled')
  if (cached && bundled) {
    currentConnectors = cached.updatedAt >= bundled.updatedAt ? cached : bundled
  } else {
    currentConnectors = cached ?? bundled
  }
  if (!currentConnectors) {
    currentConnectors = { schemaVersion: 1, updatedAt: '', source: 'bundled', connectors: [] }
  }
  return currentConnectors
}

export async function refreshConnectorCatalog(): Promise<ConnectorCatalog> {
  const base = await getConnectorCatalog()
  try {
    const response = await fetch(REMOTE_CONNECTORS_URL, { signal: AbortSignal.timeout(15000) })
    if (!response.ok) throw new Error(`Connector catalog fetch failed (${response.status})`)
    const parsed = sanitizeConnectorCatalog(await response.json(), 'remote')
    if (!parsed) throw new Error('Remote connector catalog failed validation')
    await fs.writeFile(cachedConnectorsPath(), JSON.stringify({ ...parsed, source: undefined }, null, 1), 'utf8')
    currentConnectors = parsed
    return parsed
  } catch {
    return base
  }
}

// --- Skills gallery ------------------------------------------------------------
// Curated skills, one click to install as a local markdown file. Same
// remote/cache/bundled lifecycle; bodies are plain instructions, never code.

export type SkillGalleryEntry = {
  id: string
  name: string
  description: string
  category: string
  /** Comma-separated trigger phrases, same format as skill frontmatter. */
  triggers: string
  body: string
}

export type SkillCatalog = {
  schemaVersion: number
  updatedAt: string
  source: 'bundled' | 'cached' | 'remote'
  skills: SkillGalleryEntry[]
}

const REMOTE_SKILLS_URL = 'https://raw.githubusercontent.com/robbiepeck/PowerStation/main/catalog/skills.json'
const SKILL_ID_RE = /^[a-z0-9-]{1,60}$/

function cachedSkillsPath(): string {
  return path.join(app.getPath('userData'), 'skills-cache.json')
}

function bundledSkillsCatalogPath(): string {
  return path.join(app.getAppPath(), 'catalog', 'skills.json')
}

function sanitizeSkillEntry(value: unknown): SkillGalleryEntry | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  const id = cleanString(record.id, 60).toLowerCase()
  const name = cleanString(record.name, 60)
  const body = cleanString(record.body, 24_000)
  if (!SKILL_ID_RE.test(id) || !name || !body) return null
  return {
    id,
    name,
    description: cleanString(record.description, 160),
    category: cleanString(record.category, 30) || 'general',
    triggers: cleanString(record.triggers, 400),
    body,
  }
}

function sanitizeSkillCatalog(raw: unknown, source: SkillCatalog['source']): SkillCatalog | null {
  if (typeof raw !== 'object' || raw === null) return null
  const record = raw as Record<string, unknown>
  if (cleanNumber(record.schemaVersion) !== 1) return null
  const skills = Array.isArray(record.skills)
    ? record.skills.map(sanitizeSkillEntry).filter((entry): entry is SkillGalleryEntry => entry !== null)
    : []
  if (!skills.length) return null
  return { schemaVersion: 1, updatedAt: cleanString(record.updatedAt, 40), source, skills }
}

let currentSkillCatalog: SkillCatalog | null = null

async function readSkillCatalogFile(filePath: string, source: SkillCatalog['source']): Promise<SkillCatalog | null> {
  try {
    return sanitizeSkillCatalog(JSON.parse(await fs.readFile(filePath, 'utf8')), source)
  } catch {
    return null
  }
}

export async function getSkillCatalog(): Promise<SkillCatalog> {
  if (currentSkillCatalog) return currentSkillCatalog
  const cached = await readSkillCatalogFile(cachedSkillsPath(), 'cached')
  const bundled = await readSkillCatalogFile(bundledSkillsCatalogPath(), 'bundled')
  if (cached && bundled) {
    currentSkillCatalog = cached.updatedAt >= bundled.updatedAt ? cached : bundled
  } else {
    currentSkillCatalog = cached ?? bundled
  }
  if (!currentSkillCatalog) {
    currentSkillCatalog = { schemaVersion: 1, updatedAt: '', source: 'bundled', skills: [] }
  }
  return currentSkillCatalog
}

export async function refreshSkillCatalog(): Promise<SkillCatalog> {
  const base = await getSkillCatalog()
  try {
    const response = await fetch(REMOTE_SKILLS_URL, { signal: AbortSignal.timeout(15000) })
    if (!response.ok) throw new Error(`Skill catalog fetch failed (${response.status})`)
    const parsed = sanitizeSkillCatalog(await response.json(), 'remote')
    if (!parsed) throw new Error('Remote skill catalog failed validation')
    await fs.writeFile(cachedSkillsPath(), JSON.stringify({ ...parsed, source: undefined }, null, 1), 'utf8')
    currentSkillCatalog = parsed
    return parsed
  } catch {
    return base
  }
}
