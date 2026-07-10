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

  vision: VisionSupport | null
}

export type Catalog = {
  schemaVersion: number
  updatedAt: string
  source: 'bundled' | 'cached' | 'remote'
  models: CatalogModel[]
}

// Keep catalogue inputs immutable: a branch ref could be replaced between
// validation and download. Update this commit deliberately when publishing a
// release that changes catalogue data.
const CATALOG_COMMIT = 'c429a935594889993ed9d9b258f300e6ca5c6396'
const REMOTE_CATALOG_URL = `https://raw.githubusercontent.com/robbiepeck/PowerStation/${CATALOG_COMMIT}/catalog/models.json`
const MAX_CATALOG_BYTES = 2 * 1024 * 1024
const MAX_GALLERY_BYTES = 512 * 1024
const HF_REVISION_RE = /^[a-f0-9]{40}$/i
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

async function readJsonFileCapped(filePath: string, maxBytes: number): Promise<unknown> {
  const stat = await fs.stat(filePath)
  if (!stat.isFile() || stat.size > maxBytes) throw new Error('Catalog file is too large.')
  return JSON.parse(await fs.readFile(filePath, 'utf8')) as unknown
}

async function fetchJsonCapped(url: string, maxBytes: number): Promise<unknown> {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15000) })
  if (!response.ok) throw new Error(`Catalog fetch failed (${response.status})`)
  const advertised = Number(response.headers.get('content-length') ?? 0)
  if (advertised > maxBytes) throw new Error('Remote catalog is too large.')
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Remote catalog has no response body.')
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const next = await reader.read()
    if (next.done) break
    size += next.value.byteLength
    if (size > maxBytes) {
      await reader.cancel()
      throw new Error('Remote catalog is too large.')
    }
    chunks.push(next.value)
  }
  const text = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8')
  return JSON.parse(text) as unknown
}

function trustedModelFileUrl(url: string, repo: string, fileName: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'huggingface.co' || parsed.username || parsed.password || parsed.port) return false
    const pathname = decodeURIComponent(parsed.pathname)
    const prefix = `/${repo}/resolve/`
    const rest = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : ''
    const [revision, ...fileParts] = rest.split('/')
    return HF_REVISION_RE.test(revision) && fileParts.length > 0 && path.posix.basename(pathname) === fileName
  } catch {
    return false
  }
}

function trustedModelWebsite(url: string, repo: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && parsed.hostname === 'huggingface.co' && !parsed.username && !parsed.password && !parsed.port &&
      (parsed.pathname === `/${repo}` || parsed.pathname === `/${repo}/`)
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
  const hfRepo = cleanString(record.hfRepo, 200)
  if (!id || !name || !/^[^/\\]{1,195}\.gguf$/i.test(fileName) || !sizeBytes || !minRamGb) return null
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}\/[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}$/.test(hfRepo)) return null
  if (!trustedModelFileUrl(downloadUrl, hfRepo, fileName) || !trustedModelWebsite(websiteUrl, hfRepo)) return null

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
    visionRecord && /^[^/\\]{1,195}\.gguf$/i.test(mmprojFileName) && trustedModelFileUrl(mmprojUrl, hfRepo, mmprojFileName) && mmprojSizeBytes
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
    hfRepo,
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
    return sanitizeCatalog(await readJsonFileCapped(filePath, MAX_CATALOG_BYTES), source)
  } catch {
    return null
  }
}

export async function getCatalog(): Promise<Catalog> {
  if (current) return current
  const cached = await readCatalogFile(cachedCatalogPath(), 'cached')
  const bundled = await readCatalogFile(bundledCatalogPath(), 'bundled')

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
    const parsed = sanitizeCatalog(await fetchJsonCapped(REMOTE_CATALOG_URL, MAX_CATALOG_BYTES), 'remote')
    if (!parsed) throw new Error('Remote catalog failed validation')
    const cachePath = cachedCatalogPath()
    await fs.writeFile(cachePath, JSON.stringify({ ...parsed, source: undefined }, null, 1), { encoding: 'utf8', mode: 0o600 })
    await fs.chmod(cachePath, 0o600).catch(() => undefined)
    current = parsed
    return parsed
  } catch {

    return base
  }
}

export type ConnectorEntry = {
  id: string
  name: string
  tagline: string

  detail: string
  npmPackage: string
  version: string

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

const REMOTE_CONNECTORS_URL = `https://raw.githubusercontent.com/robbiepeck/PowerStation/${CATALOG_COMMIT}/catalog/connectors.json`
const NPM_PACKAGE_RE = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/
const EXACT_VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const ALLOWED_NPM_PACKAGES = new Set([
  '@modelcontextprotocol/server-filesystem',
  '@modelcontextprotocol/server-memory',
  '@kazuph/mcp-fetch',
  'duckduckgo-mcp-server',
  '@modelcontextprotocol/server-sequential-thinking',
  '@modelcontextprotocol/server-everything',
])

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
  const version = cleanString(record.version, 80)
  if (!id || !name || !NPM_PACKAGE_RE.test(npmPackage) || !ALLOWED_NPM_PACKAGES.has(npmPackage) || !EXACT_VERSION_RE.test(version)) return null
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
    version,
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
let connectorRefreshInFlight: Promise<ConnectorCatalog> | null = null

async function readConnectorsFile(filePath: string, source: ConnectorCatalog['source']): Promise<ConnectorCatalog | null> {
  try {
    return sanitizeConnectorCatalog(await readJsonFileCapped(filePath, MAX_GALLERY_BYTES), source)
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

export function refreshConnectorCatalog(): Promise<ConnectorCatalog> {
  if (connectorRefreshInFlight) return connectorRefreshInFlight
  connectorRefreshInFlight = (async () => {
    const base = await getConnectorCatalog()
    try {
      const parsed = sanitizeConnectorCatalog(await fetchJsonCapped(REMOTE_CONNECTORS_URL, MAX_GALLERY_BYTES), 'remote')
      if (!parsed) throw new Error('Remote connector catalog failed validation')
      const cachePath = cachedConnectorsPath()
      await fs.writeFile(cachePath, JSON.stringify({ ...parsed, source: undefined }, null, 1), { encoding: 'utf8', mode: 0o600 })
      await fs.chmod(cachePath, 0o600).catch(() => undefined)
      currentConnectors = parsed
      return parsed
    } catch {
      return base
    }
  })().finally(() => {
    connectorRefreshInFlight = null
  })
  return connectorRefreshInFlight
}

export type SkillGalleryEntry = {
  id: string
  name: string
  description: string
  category: string

  triggers: string
  body: string
}

export type SkillCatalog = {
  schemaVersion: number
  updatedAt: string
  source: 'bundled' | 'cached' | 'remote'
  skills: SkillGalleryEntry[]
}

const REMOTE_SKILLS_URL = `https://raw.githubusercontent.com/robbiepeck/PowerStation/${CATALOG_COMMIT}/catalog/skills.json`
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
let skillRefreshInFlight: Promise<SkillCatalog> | null = null

async function readSkillCatalogFile(filePath: string, source: SkillCatalog['source']): Promise<SkillCatalog | null> {
  try {
    return sanitizeSkillCatalog(await readJsonFileCapped(filePath, MAX_GALLERY_BYTES), source)
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

export function refreshSkillCatalog(): Promise<SkillCatalog> {
  if (skillRefreshInFlight) return skillRefreshInFlight
  skillRefreshInFlight = (async () => {
    const base = await getSkillCatalog()
    try {
      const parsed = sanitizeSkillCatalog(await fetchJsonCapped(REMOTE_SKILLS_URL, MAX_GALLERY_BYTES), 'remote')
      if (!parsed) throw new Error('Remote skill catalog failed validation')
      const cachePath = cachedSkillsPath()
      await fs.writeFile(cachePath, JSON.stringify({ ...parsed, source: undefined }, null, 1), { encoding: 'utf8', mode: 0o600 })
      await fs.chmod(cachePath, 0o600).catch(() => undefined)
      currentSkillCatalog = parsed
      return parsed
    } catch {
      return base
    }
  })().finally(() => {
    skillRefreshInFlight = null
  })
  return skillRefreshInFlight
}
