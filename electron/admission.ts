// Pre-flight admission control: decide whether a model + context will fit in
// memory BEFORE loading it, so the user never has to act as the OOM killer.
// All inputs are knowable up front — weights ≈ GGUF file size (mmap'd), the KV
// cache grows linearly with context, and the usable budget comes from the Metal
// working-set limit on Apple Silicon.

export type KvGeometry = {
  nLayers: number
  nKvHeads: number
  headDim: number
}

export type FitRequest = {
  weightsBytes: number
  geometry: KvGeometry | null
  contextTokens: number
  /** Usable accelerator budget (Metal recommendedMaxWorkingSetSize on Apple Silicon). */
  budgetBytes: number
  /** Memory already in use by other processes inside that budget, if known. */
  usedBytes?: number
  /**
   * Effective KV bytes/token when known (catalog data). Many 2026 models use
   * hybrid attention (sliding-window / linear layers), so the naive
   * layers × heads × dim math from the GGUF header overstates the real cost —
   * this override wins when present.
   */
  kvBytesPerToken?: number | null
  /**
   * CPU-offload ceiling (typically OFFLOAD_RAM_FRACTION × total RAM). A model
   * that exceeds the GPU budget but fits under this ceiling gets a 'tight'
   * verdict with offload=true instead of 'wont-fit' — it runs, just slower.
   */
  offloadCeilingBytes?: number | null
}

export type FitVerdict = 'comfortable' | 'tight' | 'wont-fit'

export type FitReport = {
  verdict: FitVerdict
  fits: boolean
  /** True when the model only fits by offloading layers to the CPU (slower). */
  offload: boolean
  weightsBytes: number
  kvCacheBytes: number
  buffersBytes: number
  totalBytes: number
  budgetBytes: number
  headroomBytes: number
  headroomPct: number
  /** Largest context (in tokens) that would still fit comfortably, or null if even 512 won't. */
  maxComfortableContext: number | null
  /** Human-readable one-liner explaining the verdict. */
  summary: string
  /** Ordered degradation suggestions when the request doesn't fit comfortably. */
  suggestions: string[]
}

const FP16_BYTES = 2
const MIN_CONTEXT = 512
// llama.cpp compute/scratch buffers: floor of 512MB, grows with model size.
const MIN_BUFFER_BYTES = 512 * 1024 * 1024
const BUFFER_WEIGHT_FRACTION = 0.08
// Leave this fraction of the budget untouched so the OS never starts swapping.
const OS_HEADROOM_FRACTION = 0.1
/** Fraction of the raw accelerator budget that models may actually use. */
export const USABLE_BUDGET_FRACTION = 1 - OS_HEADROOM_FRACTION
/**
 * Models larger than the GPU budget can still run with layers offloaded to the
 * CPU (llama.cpp splits automatically) at a real speed cost — but only while
 * everything fits in system RAM with room for the OS. This fraction of total
 * RAM is the ceiling for that "runs, but slower" tier.
 */
export const OFFLOAD_RAM_FRACTION = 0.8
// Below this remaining-headroom fraction a load is "tight": it works, but big
// prompts or other apps can push it over.
const TIGHT_HEADROOM_FRACTION = 0.15

export function kvBytesPerToken(geometry: KvGeometry): number {
  // K + V, one per layer, fp16 elements.
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
  // Too big for the GPU budget, but small enough to run with layers offloaded
  // to the CPU: a real option llama.cpp handles automatically, at a speed cost.
  const offload = !fitsGpu && request.offloadCeilingBytes != null && totalBytes <= request.offloadCeilingBytes
  const fits = fitsGpu || offload
  const verdict: FitVerdict = comfortable ? 'comfortable' : fits ? 'tight' : 'wont-fit'

  // Solve for the largest context that keeps the comfortable margin.
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
    // In offload mode the meaningful headroom is against the RAM ceiling.
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

/**
 * Clamp a requested context size to what admission control allows, never below
 * the minimum llama.cpp context. Returns the requested size unchanged when
 * geometry is unknown (we then rely on the runtime's own auto-fitting).
 */
export function admittedContextTokens(request: FitRequest): number {
  const report = checkFit(request)
  if (report.verdict === 'comfortable') return Math.max(MIN_CONTEXT, request.contextTokens)
  if (report.maxComfortableContext) return Math.max(MIN_CONTEXT, Math.min(request.contextTokens, report.maxComfortableContext))
  return Math.max(MIN_CONTEXT, request.contextTokens)
}
