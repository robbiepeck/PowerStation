export type KvGeometry = {
  nLayers: number
  nKvHeads: number
  headDim: number
}

export type FitRequest = {
  weightsBytes: number
  geometry: KvGeometry | null
  contextTokens: number

  budgetBytes: number

  usedBytes?: number

  kvBytesPerToken?: number | null

  offloadCeilingBytes?: number | null
}

export type FitVerdict = 'comfortable' | 'tight' | 'wont-fit'

export type FitReport = {
  verdict: FitVerdict
  fits: boolean

  offload: boolean
  weightsBytes: number
  kvCacheBytes: number
  buffersBytes: number
  totalBytes: number
  budgetBytes: number
  headroomBytes: number
  headroomPct: number

  maxComfortableContext: number | null

  summary: string

  suggestions: string[]
}

const FP16_BYTES = 2
const MIN_CONTEXT = 512

const MIN_BUFFER_BYTES = 512 * 1024 * 1024
const BUFFER_WEIGHT_FRACTION = 0.08

const OS_HEADROOM_FRACTION = 0.1

export const USABLE_BUDGET_FRACTION = 1 - OS_HEADROOM_FRACTION

export const OFFLOAD_RAM_FRACTION = 0.8

const TIGHT_HEADROOM_FRACTION = 0.15

export function kvBytesPerToken(geometry: KvGeometry): number {

  return 2 * geometry.nLayers * geometry.nKvHeads * geometry.headDim * FP16_BYTES
}

export function estimateKvCacheBytes(
  geometry: KvGeometry | null,
  contextTokens: number,
  perTokenOverride?: number | null,
): number {
  const perToken = perTokenOverride ?? (geometry ? kvBytesPerToken(geometry) : null)
  if (!perToken) return 0
  return perToken * Math.max(0, contextTokens)
}

function resolvePerToken(request: FitRequest): number | null {
  return request.kvBytesPerToken ?? (request.geometry ? kvBytesPerToken(request.geometry) : null)
}

export function estimateBufferBytes(weightsBytes: number): number {
  return Math.max(MIN_BUFFER_BYTES, Math.round(weightsBytes * BUFFER_WEIGHT_FRACTION))
}

export function estimateTotalBytes(weightsBytes: number, geometry: KvGeometry | null, contextTokens: number): number {
  return weightsBytes + estimateKvCacheBytes(geometry, contextTokens) + estimateBufferBytes(weightsBytes)
}

function formatGb(bytes: number): string {
  return `${(bytes / 1e9).toFixed(1)} GB`
}

export function checkFit(request: FitRequest): FitReport {
  const usableBudget = Math.max(0, Math.round(request.budgetBytes * USABLE_BUDGET_FRACTION) - (request.usedBytes ?? 0))
  const perToken = resolvePerToken(request)
  const kvCacheBytes = perToken ? perToken * Math.max(0, request.contextTokens) : 0
  const buffersBytes = estimateBufferBytes(request.weightsBytes)
  const totalBytes = request.weightsBytes + kvCacheBytes + buffersBytes
  const headroomBytes = usableBudget - totalBytes
  const headroomPct = usableBudget > 0 ? (headroomBytes / usableBudget) * 100 : -100

  const fitsGpu = headroomBytes >= 0
  const comfortable = fitsGpu && headroomBytes >= usableBudget * TIGHT_HEADROOM_FRACTION

  const offload = !fitsGpu && request.offloadCeilingBytes != null && totalBytes <= request.offloadCeilingBytes
  const fits = fitsGpu || offload
  const verdict: FitVerdict = comfortable ? 'comfortable' : fits ? 'tight' : 'wont-fit'

  let maxComfortableContext: number | null = null
  if (perToken) {
    const spare = usableBudget * (1 - TIGHT_HEADROOM_FRACTION) - request.weightsBytes - buffersBytes
    const tokens = Math.floor(spare / perToken)
    maxComfortableContext = tokens >= MIN_CONTEXT ? tokens : null
  } else if (comfortable) {
    maxComfortableContext = request.contextTokens
  }

  const suggestions: string[] = []
  if (verdict !== 'comfortable') {
    if (offload) {
      suggestions.push('For full speed, choose a model that fits your GPU memory.')
    }
    if (maxComfortableContext && maxComfortableContext < request.contextTokens) {
      suggestions.push(`Reduce the context window to ${maxComfortableContext.toLocaleString()} tokens or less.`)
    }
    suggestions.push('Choose a smaller quantization or a smaller model.')
    suggestions.push('Close other memory-heavy apps before loading.')
  }

  const summary =
    verdict === 'comfortable'
      ? `Fits comfortably: needs ~${formatGb(totalBytes)} of ${formatGb(usableBudget)} available.`
      : offload
        ? `Runs, but not fully on the GPU: needs ~${formatGb(totalBytes)} against a ~${formatGb(usableBudget)} GPU budget, so layers will offload to the CPU — expect much slower responses.`
        : verdict === 'tight'
          ? `Fits, but tightly: needs ~${formatGb(totalBytes)} of ${formatGb(usableBudget)} available. Expect pressure with other apps open.`
          : `Won't fit: needs ~${formatGb(totalBytes)} but only ${formatGb(usableBudget)} is available.`

  return {
    verdict,
    fits,
    offload,
    weightsBytes: request.weightsBytes,
    kvCacheBytes,
    buffersBytes,
    totalBytes,

    budgetBytes: usableBudget,
    headroomBytes: offload ? request.offloadCeilingBytes! - totalBytes : headroomBytes,
    headroomPct: offload
      ? ((request.offloadCeilingBytes! - totalBytes) / request.offloadCeilingBytes!) * 100
      : headroomPct,
    maxComfortableContext,
    summary,
    suggestions,
  }
}

export function admittedContextTokens(request: FitRequest): number {
  const report = checkFit(request)
  if (report.verdict === 'comfortable') return Math.max(MIN_CONTEXT, request.contextTokens)
  if (report.maxComfortableContext) return Math.max(MIN_CONTEXT, Math.min(request.contextTokens, report.maxComfortableContext))
  return Math.max(MIN_CONTEXT, request.contextTokens)
}
