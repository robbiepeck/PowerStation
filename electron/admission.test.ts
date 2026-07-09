import { describe, expect, it } from 'vitest'
import {
  admittedContextTokens,
  checkFit,
  estimateKvCacheBytes,
  kvBytesPerToken,
  type KvGeometry,
} from './admission.js'

const LLAMA_8B: KvGeometry = { nLayers: 32, nKvHeads: 8, headDim: 128 }
const GB = 1024 ** 3

describe('kvBytesPerToken', () => {
  it('matches the known Llama-3.1-8B figure (~128KB/token)', () => {

    expect(kvBytesPerToken(LLAMA_8B)).toBe(131072)
  })

  it('scales KV cache linearly with context', () => {
    const at8k = estimateKvCacheBytes(LLAMA_8B, 8192)
    const at32k = estimateKvCacheBytes(LLAMA_8B, 32768)
    expect(at32k).toBe(at8k * 4)

    expect(at32k / GB).toBeCloseTo(4, 0)
  })

  it('returns zero KV bytes when geometry is unknown', () => {
    expect(estimateKvCacheBytes(null, 32768)).toBe(0)
  })
})

describe('checkFit', () => {
  const weights8bQ4 = 4.9e9

  it('passes an 8B Q4 model with 8k context on a 16GB machine (≈11GB Metal budget)', () => {
    const report = checkFit({
      weightsBytes: weights8bQ4,
      geometry: LLAMA_8B,
      contextTokens: 8192,
      budgetBytes: 11.2 * GB,
    })
    expect(report.verdict).toBe('comfortable')
    expect(report.fits).toBe(true)
  })

  it('rejects a 20GB model on a 16GB machine', () => {
    const report = checkFit({
      weightsBytes: 20e9,
      geometry: LLAMA_8B,
      contextTokens: 8192,
      budgetBytes: 11.2 * GB,
    })
    expect(report.verdict).toBe('wont-fit')
    expect(report.fits).toBe(false)
    expect(report.suggestions.length).toBeGreaterThan(0)
  })

  it('flags a technically-fitting-but-tight load and suggests a smaller context', () => {

    const report = checkFit({
      weightsBytes: weights8bQ4,
      geometry: LLAMA_8B,
      contextTokens: 131072,
      budgetBytes: 24 * GB,
    })
    expect(report.verdict).not.toBe('comfortable')
    expect(report.maxComfortableContext).not.toBeNull()
    expect(report.maxComfortableContext!).toBeLessThan(131072)
    expect(report.suggestions.some((s) => s.includes('context'))).toBe(true)
  })

  it('accounts for memory already in use', () => {
    const free = checkFit({
      weightsBytes: weights8bQ4,
      geometry: LLAMA_8B,
      contextTokens: 8192,
      budgetBytes: 11.2 * GB,
    })
    const busy = checkFit({
      weightsBytes: weights8bQ4,
      geometry: LLAMA_8B,
      contextTokens: 8192,
      budgetBytes: 11.2 * GB,
      usedBytes: 4 * GB,
    })
    expect(busy.headroomBytes).toBeLessThan(free.headroomBytes)
  })

  it('never reports a comfortable context below the 512-token minimum', () => {
    const report = checkFit({
      weightsBytes: 10e9,
      geometry: LLAMA_8B,
      contextTokens: 8192,
      budgetBytes: 11 * GB,
    })
    if (report.maxComfortableContext !== null) {
      expect(report.maxComfortableContext).toBeGreaterThanOrEqual(512)
    }
  })
})

describe('CPU-offload tier', () => {
  it('classifies a model too big for the GPU but within the RAM ceiling as tight/offload', () => {

    const report = checkFit({
      weightsBytes: 12.11e9,
      geometry: null,
      kvBytesPerToken: 49152,
      contextTokens: 8192,
      budgetBytes: 11.2 * GB,
      offloadCeilingBytes: Math.round(16 * GB * 0.8),
    })
    expect(report.verdict).toBe('tight')
    expect(report.offload).toBe(true)
    expect(report.fits).toBe(true)
    expect(report.summary).toContain('CPU')
    expect(report.headroomBytes).toBeGreaterThan(0)
  })

  it('still refuses a model beyond both the GPU budget and the RAM ceiling', () => {
    const report = checkFit({
      weightsBytes: 20e9,
      geometry: LLAMA_8B,
      contextTokens: 8192,
      budgetBytes: 11.2 * GB,
      offloadCeilingBytes: Math.round(16 * GB * 0.8),
    })
    expect(report.verdict).toBe('wont-fit')
    expect(report.offload).toBe(false)
    expect(report.fits).toBe(false)
  })

  it('keeps the strict verdict when no offload ceiling is provided', () => {
    const report = checkFit({
      weightsBytes: 12.11e9,
      geometry: null,
      kvBytesPerToken: 49152,
      contextTokens: 8192,
      budgetBytes: 11.2 * GB,
    })
    expect(report.verdict).toBe('wont-fit')
    expect(report.offload).toBe(false)
  })

  it('never reports offload for a model that fits the GPU', () => {
    const report = checkFit({
      weightsBytes: 4.9e9,
      geometry: LLAMA_8B,
      contextTokens: 8192,
      budgetBytes: 11.2 * GB,
      offloadCeilingBytes: Math.round(16 * GB * 0.8),
    })
    expect(report.offload).toBe(false)
    expect(report.verdict).toBe('comfortable')
  })
})

describe('admittedContextTokens', () => {
  it('leaves a comfortable request unchanged', () => {
    const admitted = admittedContextTokens({
      weightsBytes: 4.9e9,
      geometry: LLAMA_8B,
      contextTokens: 8192,
      budgetBytes: 11.2 * GB,
    })
    expect(admitted).toBe(8192)
  })

  it('shrinks an oversized context down to what fits', () => {
    const admitted = admittedContextTokens({
      weightsBytes: 4.9e9,
      geometry: LLAMA_8B,
      contextTokens: 131072,
      budgetBytes: 11.2 * GB,
    })
    expect(admitted).toBeLessThan(131072)
    expect(admitted).toBeGreaterThanOrEqual(512)
  })
})
