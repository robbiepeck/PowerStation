// Chat-with-a-folder: index a folder's text into local embeddings, retrieve
// the most relevant chunks per question. Everything is local — the embedding
// model is a small GGUF running in the same isolated worker as chat, and each
// folder's index is a plain JSON file in the app's data directory.

import { app } from 'electron'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { downloadModel, embedTexts } from './llm.js'
import { extractFile, isSupportedFile } from './files.js'
import { buildRetrievalBlock, chunkText, sourceFiles, topKChunks, type Chunk } from './ragUtil.js'

// nomic-embed-text is small (~84MB), strong, Apache-2.0, and needs task
// prefixes on both sides of the retrieval (search_document / search_query).
const EMBED_MODEL_URL =
  'https://huggingface.co/nomic-ai/nomic-embed-text-v1.5-GGUF/resolve/main/nomic-embed-text-v1.5.Q8_0.gguf'
const EMBED_MODEL_FILE = 'nomic-embed-text-v1.5.Q8_0.gguf'
const DOC_PREFIX = 'search_document: '
const QUERY_PREFIX = 'search_query: '

const MAX_FILES = 500
const MAX_CHUNKS = 4000
const EMBED_BATCH = 16
const TOP_K = 6

export type FolderIndexInfo = {
  folderId: string
  folder: string
  name: string
  fileCount: number
  chunkCount: number
  builtAt: number
}

type StoredIndex = FolderIndexInfo & {
  newestMtimeMs: number
  chunks: Array<Chunk & { vector: number[] }>
}

export type IndexProgress = { phase: 'scanning' | 'embedding-model' | 'embedding'; done: number; total: number }

function ragDir(): string {
  return path.join(app.getPath('userData'), 'rag')
}

function embeddingsDir(): string {
  return path.join(app.getPath('userData'), 'embeddings')
}

function folderIdFor(folder: string): string {
  return createHash('sha256').update(path.resolve(folder)).digest('hex').slice(0, 16)
}

async function ensureEmbedModel(onProgress?: (p: IndexProgress) => void): Promise<string> {
  const target = path.join(embeddingsDir(), EMBED_MODEL_FILE)
  const stat = await fs.stat(target).catch(() => null)
  if (stat?.isFile() && stat.size > 10_000_000) return target
  await fs.mkdir(embeddingsDir(), { recursive: true })
  onProgress?.({ phase: 'embedding-model', done: 0, total: 1 })
  const downloaded = await downloadModel({
    uri: EMBED_MODEL_URL,
    dirPath: embeddingsDir(),
    onProgress: ({ totalSize, downloadedSize }) =>
      onProgress?.({ phase: 'embedding-model', done: downloadedSize, total: totalSize || 1 }),
  })
  return downloaded
}

async function collectFiles(folder: string): Promise<string[]> {
  const found: string[] = []
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth < 0 || found.length >= MAX_FILES) return
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (found.length >= MAX_FILES) return
      if (entry.name.startsWith('.')) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) await walk(full, depth - 1)
      else if (entry.isFile() && isSupportedFile(full)) found.push(full)
    }
  }
  await walk(folder, 5)
  return found
}

async function readIndex(folderId: string): Promise<StoredIndex | null> {
  try {
    const raw = await fs.readFile(path.join(ragDir(), `${folderId}.json`), 'utf8')
    return JSON.parse(raw) as StoredIndex
  } catch {
    return null
  }
}

/**
 * Build (or reuse) the index for a folder. Reuse is safe when the file list
 * length and the newest mtime are unchanged — cheap and right nearly always;
 * "re-attach the folder" is the manual refresh.
 */
export async function ensureFolderIndex(
  folder: string,
  onProgress?: (p: IndexProgress) => void,
): Promise<FolderIndexInfo> {
  const resolved = path.resolve(folder)
  const stat = await fs.stat(resolved)
  if (!stat.isDirectory()) throw new Error('Not a folder.')
  const folderId = folderIdFor(resolved)

  onProgress?.({ phase: 'scanning', done: 0, total: 1 })
  const files = await collectFiles(resolved)
  if (!files.length) throw new Error('No readable text, markdown, code or PDF files in that folder.')

  let newestMtimeMs = 0
  for (const file of files) {
    const s = await fs.stat(file).catch(() => null)
    if (s && s.mtimeMs > newestMtimeMs) newestMtimeMs = s.mtimeMs
  }

  const existing = await readIndex(folderId)
  if (existing && existing.fileCount === files.length && existing.newestMtimeMs === newestMtimeMs) {
    return toInfo(existing)
  }

  const modelPath = await ensureEmbedModel(onProgress)

  // Extract + chunk
  const chunks: Chunk[] = []
  for (const file of files) {
    if (chunks.length >= MAX_CHUNKS) break
    try {
      const extracted = await extractFile(file)
      chunks.push(...chunkText(path.relative(resolved, file), extracted.text))
    } catch {
      /* unreadable file — skip */
    }
  }
  const capped = chunks.slice(0, MAX_CHUNKS)

  // Embed in batches
  const vectors: number[][] = []
  for (let i = 0; i < capped.length; i += EMBED_BATCH) {
    const batch = capped.slice(i, i + EMBED_BATCH)
    const embedded = await embedTexts(modelPath, batch.map((chunk) => DOC_PREFIX + chunk.text))
    vectors.push(...embedded)
    onProgress?.({ phase: 'embedding', done: Math.min(i + EMBED_BATCH, capped.length), total: capped.length })
  }

  const index: StoredIndex = {
    folderId,
    folder: resolved,
    name: path.basename(resolved),
    fileCount: files.length,
    chunkCount: capped.length,
    builtAt: Date.now(),
    newestMtimeMs,
    chunks: capped.map((chunk, i) => ({ ...chunk, vector: vectors[i] ?? [] })),
  }
  await fs.mkdir(ragDir(), { recursive: true })
  await fs.writeFile(path.join(ragDir(), `${folderId}.json`), JSON.stringify(index), 'utf8')
  return toInfo(index)
}

function toInfo(index: StoredIndex): FolderIndexInfo {
  return {
    folderId: index.folderId,
    folder: index.folder,
    name: index.name,
    fileCount: index.fileCount,
    chunkCount: index.chunkCount,
    builtAt: index.builtAt,
  }
}

/**
 * Embeddings for the local API server's /v1/embeddings endpoint, using the same
 * bundled nomic model as folder retrieval (document-passage mode).
 */
export async function embedForApi(texts: string[]): Promise<{ model: string; vectors: number[][] }> {
  if (!texts.length) return { model: EMBED_MODEL_FILE, vectors: [] }
  const modelPath = await ensureEmbedModel()
  const vectors = await embedTexts(
    modelPath,
    texts.map((text) => DOC_PREFIX + text),
  )
  return { model: EMBED_MODEL_FILE, vectors }
}

export async function queryFolder(
  folderId: string,
  question: string,
): Promise<{ block: string; sources: string[] } | null> {
  if (typeof folderId !== 'string' || !/^[a-f0-9]{16}$/.test(folderId)) return null
  const index = await readIndex(folderId)
  if (!index || !index.chunks.length) return null
  const modelPath = await ensureEmbedModel()
  const [queryVector] = await embedTexts(modelPath, [QUERY_PREFIX + question])
  if (!queryVector) return null
  const top = topKChunks(queryVector, index.chunks, TOP_K)
  return { block: buildRetrievalBlock(top), sources: sourceFiles(top) }
}

/**
 * Retrieval across several folder indexes at once (custom agents reference
 * multiple knowledge folders). The query is embedded once; chunks from all
 * folders compete for the same top-k slots, so the best evidence wins no
 * matter which folder it lives in. With more than one folder, sources are
 * prefixed with the folder name so citations stay unambiguous.
 */
export async function queryFolders(
  folderIds: string[],
  question: string,
): Promise<{ block: string; sources: string[] } | null> {
  const ids = [...new Set(folderIds.filter((id) => typeof id === 'string' && /^[a-f0-9]{16}$/.test(id)))].slice(0, 8)
  if (!ids.length) return null
  const indexes = (await Promise.all(ids.map(readIndex))).filter(
    (index): index is StoredIndex => index !== null && index.chunks.length > 0,
  )
  if (!indexes.length) return null
  const modelPath = await ensureEmbedModel()
  const [queryVector] = await embedTexts(modelPath, [QUERY_PREFIX + question])
  if (!queryVector) return null
  const chunks =
    indexes.length === 1
      ? indexes[0].chunks
      : indexes.flatMap((index) => index.chunks.map((chunk) => ({ ...chunk, file: `${index.name}/${chunk.file}` })))
  const top = topKChunks(queryVector, chunks, TOP_K)
  return { block: buildRetrievalBlock(top), sources: sourceFiles(top) }
}

export type RagIndexListing = FolderIndexInfo & {
  sizeBytes: number
  stale: boolean
  missing: boolean
}

async function assessIndex(index: StoredIndex): Promise<RagIndexListing> {
  let sizeBytes = 0
  try {
    sizeBytes = (await fs.stat(path.join(ragDir(), `${index.folderId}.json`))).size
  } catch {
    /* listing best-effort */
  }
  const folderStat = await fs.stat(index.folder).catch(() => null)
  if (!folderStat?.isDirectory()) {
    return { ...toInfo(index), sizeBytes, stale: false, missing: true }
  }
  const files = await collectFiles(index.folder)
  let newestMtimeMs = 0
  for (const file of files) {
    const stat = await fs.stat(file).catch(() => null)
    if (stat && stat.mtimeMs > newestMtimeMs) newestMtimeMs = stat.mtimeMs
  }
  const stale = files.length !== index.fileCount || newestMtimeMs !== index.newestMtimeMs
  return { ...toInfo(index), sizeBytes, stale, missing: false }
}

export async function getFolderIndexInfo(folderId: string): Promise<RagIndexListing | null> {
  if (typeof folderId !== 'string' || !/^[a-f0-9]{16}$/.test(folderId)) return null
  const index = await readIndex(folderId)
  return index ? assessIndex(index) : null
}

export async function listFolderIndexes(): Promise<RagIndexListing[]> {
  let files: string[]
  try {
    files = await fs.readdir(ragDir())
  } catch {
    return []
  }
  const listings: RagIndexListing[] = []
  for (const file of files) {
    if (!file.endsWith('.json')) continue
    const index = await readIndex(file.slice(0, -5))
    if (index) listings.push(await assessIndex(index))
  }
  return listings.sort((a, b) => b.builtAt - a.builtAt)
}

export async function deleteFolderIndex(folderId: unknown): Promise<boolean> {
  if (typeof folderId !== 'string' || !/^[a-f0-9]{16}$/.test(folderId)) return false
  try {
    await fs.rm(path.join(ragDir(), `${folderId}.json`))
    return true
  } catch {
    return false
  }
}

/** Force a rebuild regardless of the freshness check. */
export async function reindexFolder(
  folderId: string,
  onProgress?: (p: IndexProgress) => void,
): Promise<FolderIndexInfo> {
  const index = await readIndex(folderId)
  if (!index) throw new Error('Index not found.')
  const folder = index.folder
  await deleteFolderIndex(folderId)
  return ensureFolderIndex(folder, onProgress)
}
