import type { Catalog, CatalogModel, ImpactReport, ModelInfo, StorageReport } from './types'

export const IMPACT_ASSUMPTIONS = {
  electricityKgCo2ePerKwh: 0.445,
  networkKwhPerGb: 0.03,
  storageKwhPerGbYear: 0.001,
  trainingTokensPerParameter: 20,
  datacenterPue: 1.12,
  sustainedTrainingTflopsPerWatt: 0.7,
  allocationDownloads: 100_000,
  trainingRangeLow: 0.35,
  trainingRangeHigh: 3,
}

export type ModelCreationEstimate = {
  totalParamsB: number | null
  activeParamsB: number | null
  trainingTokensB: number | null
  trainingEnergyKwh: number | null
  trainingKgCo2e: number | null
  lowKgCo2e: number | null
  highKgCo2e: number | null
  allocatedKgCo2e: number | null
  downloadKgCo2e: number
  downloadEnergyKwh: number
  confidence: 'catalog' | 'metadata' | 'file-size'
}

export function matchCatalogModel(catalog: Catalog | null, model: ModelInfo | null): CatalogModel | null {
  if (!catalog || !model) return null
  return catalog.models.find((entry) => entry.fileName.toLowerCase() === model.fileName.toLowerCase()) ?? null
}

export function kgFromKwh(kwh: number): number {
  return Math.max(0, kwh) * IMPACT_ASSUMPTIONS.electricityKgCo2ePerKwh
}

export function formatCo2(kg: number | null | undefined): string {
  if (kg == null || !Number.isFinite(kg)) return 'Unknown'
  if (kg < 0.001) return '<1 g CO2e'
  if (kg < 1) return `${formatNumber(kg * 1000, kg < 0.1 ? 1 : 0)} g CO2e`
  if (kg < 1000) return `${formatNumber(kg, kg < 10 ? 2 : kg < 100 ? 1 : 0)} kg CO2e`
  return `${formatNumber(kg / 1000, kg < 10_000 ? 2 : 1)} t CO2e`
}

export function formatEnergy(kwh: number | null | undefined): string {
  if (kwh == null || !Number.isFinite(kwh)) return 'Unknown'
  if (kwh < 0.001) return '<1 Wh'
  if (kwh < 1) return `${formatNumber(kwh * 1000, kwh < 0.1 ? 1 : 0)} Wh`
  return `${formatNumber(kwh, kwh < 10 ? 2 : kwh < 100 ? 1 : 0)} kWh`
}

export function formatDuration(ms: number): string {
  if (!ms || ms < 0) return '0s'
  const seconds = ms / 1000
  if (seconds < 60) return `${formatNumber(seconds, seconds < 10 ? 1 : 0)}s`
  const minutes = seconds / 60
  if (minutes < 60) return `${formatNumber(minutes, minutes < 10 ? 1 : 0)}m`
  return `${formatNumber(minutes / 60, 1)}h`
}

export function estimateModelCreation(model: ModelInfo | null, catalogEntry: CatalogModel | null): ModelCreationEstimate | null {
  if (!model) return null
  const parsedParamsB = parseParameterBillions(model.parameters)
  const inferredParamsB = inferParamsFromFileSize(model.sizeBytes, model.quantization ?? catalogEntry?.quant ?? null)
  const totalParamsB = catalogEntry?.totalParamsB ?? parsedParamsB ?? inferredParamsB
  const activeParamsB = catalogEntry?.activeParamsB ?? null
  const computeParamsB = activeParamsB && activeParamsB > 0 && activeParamsB < totalParamsB ? activeParamsB : totalParamsB
  const trainingTokensB = totalParamsB * IMPACT_ASSUMPTIONS.trainingTokensPerParameter
  const trainingFlops = 6 * computeParamsB * 1e9 * trainingTokensB * 1e9
  const flopsPerKwh = IMPACT_ASSUMPTIONS.sustainedTrainingTflopsPerWatt * 1e12 * 1000 * 3600
  const trainingEnergyKwh = (trainingFlops / flopsPerKwh) * IMPACT_ASSUMPTIONS.datacenterPue
  const trainingKgCo2e = kgFromKwh(trainingEnergyKwh)
  const downloadEnergyKwh = (model.sizeBytes / 1e9) * IMPACT_ASSUMPTIONS.networkKwhPerGb
  const downloadKgCo2e = kgFromKwh(downloadEnergyKwh)
  const confidence = catalogEntry ? 'catalog' : parsedParamsB ? 'metadata' : 'file-size'

  return {
    totalParamsB,
    activeParamsB,
    trainingTokensB,
    trainingEnergyKwh,
    trainingKgCo2e,
    lowKgCo2e: trainingKgCo2e * IMPACT_ASSUMPTIONS.trainingRangeLow,
    highKgCo2e: trainingKgCo2e * IMPACT_ASSUMPTIONS.trainingRangeHigh,
    allocatedKgCo2e: trainingKgCo2e / IMPACT_ASSUMPTIONS.allocationDownloads,
    downloadKgCo2e,
    downloadEnergyKwh,
    confidence,
  }
}

export function localUsageKg(report: ImpactReport | null): number {
  return kgFromKwh((report?.tracked.energyWh ?? 0) / 1000)
}

export function modelStorageAnnualKg(bytes: number): number {
  return kgFromKwh((bytes / 1e9) * IMPACT_ASSUMPTIONS.storageKwhPerGbYear)
}

export function selectedModelTrackedUsage(report: ImpactReport | null, model: ModelInfo | null) {
  if (!report || !model) return null
  const key = model.path.toLowerCase()
  return report.tracked.byModel[key] ?? null
}

export function storageImpact(storage: StorageReport | null, selectedModel: ModelInfo | null) {
  const psModels = storage?.locations.find((loc) => loc.id === 'ps-models')?.sizeBytes ?? 0
  const psData = storage?.locations.find((loc) => loc.id === 'ps-data')?.sizeBytes ?? 0
  const duplicateBytes = storage?.duplicates.reduce((sum, group) => sum + group.wastedBytes, 0) ?? 0
  return {
    selectedModelBytes: selectedModel?.sizeBytes ?? 0,
    appDataBytes: Math.max(0, psData - psModels),
    managedModelBytes: psModels,
    duplicateBytes,
  }
}

function parseParameterBillions(label: string | null | undefined): number | null {
  if (!label) return null
  const b = label.match(/([\d.]+)\s*B\b/i)
  if (b) return Number(b[1])
  const m = label.match(/([\d.]+)\s*M\b/i)
  if (m) return Number(m[1]) / 1000
  return null
}

function inferParamsFromFileSize(sizeBytes: number, quant: string | null): number {
  const bytesPerParam = bytesPerParamForQuant(quant)
  return Math.max(0.1, sizeBytes / (bytesPerParam * 1e9))
}

function bytesPerParamForQuant(quant: string | null): number {
  const q = (quant ?? '').toUpperCase()
  if (q.includes('Q2') || q.includes('IQ2')) return 0.38
  if (q.includes('Q3') || q.includes('IQ3')) return 0.48
  if (q.includes('Q4') || q.includes('IQ4')) return 0.58
  if (q.includes('Q5') || q.includes('IQ5')) return 0.7
  if (q.includes('Q6') || q.includes('IQ6')) return 0.82
  if (q.includes('Q8') || q.includes('IQ8')) return 1.05
  if (q.includes('BF16') || q.includes('F16')) return 2
  if (q.includes('F32')) return 4
  return 0.65
}

function formatNumber(value: number, decimals: number): string {
  return value.toLocaleString(undefined, {
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals,
  })
}
