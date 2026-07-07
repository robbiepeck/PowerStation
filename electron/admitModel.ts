// Shared "will this model fit, and at what context?" helper. The in-app chat
// path does this inline; the local API server reuses it so an API request can
// never load a model that would blow past the machine's memory budget — it
// gets an honest error instead.

import { getState } from './config.js'
import * as llm from './llm.js'
import * as models from './models.js'
import { getCatalog, type CatalogModel } from './catalog.js'
import { getHardwareProfile } from './hardware.js'
import { admittedContextTokens, checkFit, OFFLOAD_RAM_FRACTION } from './admission.js'

async function gpuBudgetBytes(): Promise<number> {
  const device = await llm.getDeviceInfo().catch(() => null)
  if (device?.vram && device.vram.total > 0) return device.vram.total
  return (await getHardwareProfile()).gpuBudgetBytes
}

async function offloadCeilingBytes(): Promise<number> {
  return Math.round((await getHardwareProfile()).totalRamBytes * OFFLOAD_RAM_FRACTION)
}

async function catalogEntryFor(modelPath: string): Promise<CatalogModel | null> {
  const fileName = modelPath.toLowerCase().split('/').pop() ?? ''
  const catalog = await getCatalog().catch(() => null)
  return catalog?.models.find((entry) => entry.fileName.toLowerCase() === fileName) ?? null
}

export type Admission = { fits: boolean; contextTokens: number; reason?: string }

export async function admitModel(modelPath: string): Promise<Admission> {
  const state = await getState()
  const [info, entry, budget, offloadCeiling] = await Promise.all([
    models.getModelInfo(modelPath),
    catalogEntryFor(modelPath),
    gpuBudgetBytes(),
    offloadCeilingBytes(),
  ])
  if (!info && !entry) return { fits: false, contextTokens: 0, reason: 'Model file not found.' }
  const fitRequest = {
    weightsBytes: Math.max(info?.sizeBytes ?? 0, entry?.sizeBytes ?? 0),
    geometry: info?.geometry ?? entry?.geometry ?? null,
    kvBytesPerToken: entry?.kvBytesPerToken ?? null,
    contextTokens: state.settings.contextTokens,
    budgetBytes: budget,
    offloadCeilingBytes: offloadCeiling,
  }
  const fit = checkFit(fitRequest)
  if (!fit.fits && fit.maxComfortableContext === null) {
    return { fits: false, contextTokens: 0, reason: `${fit.summary} ${fit.suggestions.join(' ')}`.trim() }
  }
  return { fits: true, contextTokens: admittedContextTokens(fitRequest) }
}
