// Ollama detection. Many people already have models in Ollama; PowerStation
// can use those GGUF blobs directly — no re-download — by reading Ollama's
// manifest store and registering the blob file as an imported model. Ollama is
// optional and never a dependency: inference always runs in PowerStation's own
// runtime, we only borrow the files.

import os from 'node:os'
import path from 'node:path'
import { promises as fs } from 'node:fs'

export type OllamaModel = {
  /** Ollama tag, e.g. "llama3:latest". */
  name: string
  blobPath: string
  sizeBytes: number
  /** From the daemon's /api/tags when it is running. */
  parameterSize: string | null
  quantization: string | null
}

export type OllamaStatus = {
  detected: boolean
  running: boolean
  version: string | null
  models: OllamaModel[]
}

const DAEMON_URL = 'http://127.0.0.1:11434'
const MODEL_LAYER = 'application/vnd.ollama.image.model'

function modelsRoot(): string {
  return process.env.OLLAMA_MODELS || path.join(os.homedir(), '.ollama', 'models')
}

async function detectDaemon(): Promise<string | null> {
  try {
    const res = await fetch(`${DAEMON_URL}/api/version`, { signal: AbortSignal.timeout(1500) })
    if (!res.ok) return null
    const body = (await res.json()) as { version?: string }
    return typeof body.version === 'string' ? body.version : 'unknown'
  } catch {
    return null
  }
}

async function daemonTagDetails(): Promise<Map<string, { parameterSize: string | null; quantization: string | null }>> {
  const details = new Map<string, { parameterSize: string | null; quantization: string | null }>()
  try {
    const res = await fetch(`${DAEMON_URL}/api/tags`, { signal: AbortSignal.timeout(3000) })
    if (!res.ok) return details
    const body = (await res.json()) as { models?: Array<Record<string, unknown>> }
    for (const model of body.models ?? []) {
      const name = typeof model.name === 'string' ? model.name : null
      const d = typeof model.details === 'object' && model.details !== null ? (model.details as Record<string, unknown>) : {}
      if (name) {
        details.set(name, {
          parameterSize: typeof d.parameter_size === 'string' ? d.parameter_size : null,
          quantization: typeof d.quantization_level === 'string' ? d.quantization_level : null,
        })
      }
    }
  } catch {
    /* daemon not reachable — manifest data still works */
  }
  return details
}

/**
 * Walk the manifest store: manifests/<registry>/<namespace>/<model>/<tag> is a
 * JSON file whose model layer digest names the GGUF blob. Works whether or not
 * the daemon is running.
 */
async function listFromManifests(): Promise<OllamaModel[]> {
  const root = modelsRoot()
  const manifestsDir = path.join(root, 'manifests')
  const models: OllamaModel[] = []

  async function walk(dir: string, segments: string[]): Promise<void> {
    if (segments.length > 4 || models.length >= 100) return
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full, [...segments, entry.name])
      } else if (entry.isFile() && segments.length >= 3) {
        // segments: [registry, namespace, model], file name = tag
        try {
          const manifest = JSON.parse(await fs.readFile(full, 'utf8')) as {
            layers?: Array<{ mediaType?: string; digest?: string; size?: number }>
          }
          const layer = manifest.layers?.find((l) => l.mediaType === MODEL_LAYER)
          const digest = layer?.digest
          if (!digest || !/^sha256:[a-f0-9]{64}$/.test(digest)) continue
          const blobPath = path.join(root, 'blobs', digest.replace(':', '-'))
          const stat = await fs.stat(blobPath).catch(() => null)
          if (!stat?.isFile()) continue
          const namespace = segments[1]
          const modelName = segments.slice(2).join('/')
          const name = `${namespace === 'library' ? '' : `${namespace}/`}${modelName}:${entry.name}`
          models.push({
            name,
            blobPath,
            sizeBytes: stat.size,
            parameterSize: null,
            quantization: null,
          })
        } catch {
          /* unreadable manifest — skip */
        }
      }
    }
  }

  await walk(manifestsDir, [])
  return models
}

export async function getOllamaStatus(): Promise<OllamaStatus> {
  const [version, models] = await Promise.all([detectDaemon(), listFromManifests()])
  if (version) {
    const details = await daemonTagDetails()
    for (const model of models) {
      const d = details.get(model.name)
      if (d) {
        model.parameterSize = d.parameterSize
        model.quantization = d.quantization
      }
    }
  }
  return {
    detected: version !== null || models.length > 0,
    running: version !== null,
    version,
    models: models.sort((a, b) => a.name.localeCompare(b.name)),
  }
}

/** Resolve an Ollama tag to its blob path — server-side, from our own listing. */
export async function resolveOllamaModel(name: unknown): Promise<OllamaModel | null> {
  if (typeof name !== 'string') return null
  const models = await listFromManifests()
  return models.find((model) => model.name === name) ?? null
}
