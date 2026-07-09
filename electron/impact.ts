import path from 'node:path'
import { getState, mutate, type ImpactSource, type ImpactUsageStats } from './config.js'
import { getLastPowerWatts } from './telemetry.js'
import * as models from './models.js'

export type ImpactGenerationSample = {
  source: ImpactSource
  modelPath: string
  elapsedMs: number
  outputText?: string
  outputTokenEstimate?: number
  tokensPerSec?: number
  powerWatts?: number | null
}

export type ImpactReport = {
  generatedAt: number
  tracked: ImpactUsageStats
}

const FALLBACK_INFERENCE_WATTS = 35

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function estimateTokens(text: string | undefined): number {
  if (!text) return 0
  return Math.max(1, Math.ceil(text.length / 4))
}

function addSample(
  bucket: {
    generationCount: number
    elapsedMs: number
    energyWh: number
    outputTokenEstimate: number
  },
  sample: { elapsedMs: number; energyWh: number; outputTokenEstimate: number },
) {
  bucket.generationCount += 1
  bucket.elapsedMs += sample.elapsedMs
  bucket.energyWh += sample.energyWh
  bucket.outputTokenEstimate += sample.outputTokenEstimate
}

export async function recordGeneration(sample: ImpactGenerationSample): Promise<void> {
  const elapsedMs = clampNumber(sample.elapsedMs, 0, 1000 * 60 * 60 * 12, 0)
  if (!sample.modelPath || elapsedMs <= 0) return
  const outputTokenEstimate = clampNumber(
    sample.outputTokenEstimate ?? estimateTokens(sample.outputText),
    0,
    10_000_000,
    0,
  )
  const watts = clampNumber(sample.powerWatts ?? getLastPowerWatts() ?? FALLBACK_INFERENCE_WATTS, 1, 500, FALLBACK_INFERENCE_WATTS)
  const energyWh = (watts * elapsedMs) / 3.6e6
  const info = await models.getModelInfo(sample.modelPath).catch(() => null)
  const fileName = info?.fileName ?? path.basename(sample.modelPath)
  const modelName = info?.name ?? fileName.replace(/\.gguf$/i, '')
  const modelKey = path.resolve(sample.modelPath).toLowerCase()
  const source = sample.source === 'api' || sample.source === 'compare' ? sample.source : 'chat'
  const now = Date.now()

  await mutate((state) => {
    const impact = state.impactUsage
    const compact = { elapsedMs, energyWh, outputTokenEstimate }
    addSample(impact, compact)
    addSample(impact.bySource[source], compact)
    const current = impact.byModel[modelKey] ?? {
      generationCount: 0,
      elapsedMs: 0,
      energyWh: 0,
      outputTokenEstimate: 0,
      modelName,
      fileName,
      lastUsedAt: now,
    }
    current.modelName = modelName
    current.fileName = fileName
    current.lastUsedAt = now
    addSample(current, compact)
    impact.byModel[modelKey] = current
    impact.updatedAt = now
  })
}

export async function getImpactReport(): Promise<ImpactReport> {
  return {
    generatedAt: Date.now(),
    tracked: (await getState()).impactUsage,
  }
}
