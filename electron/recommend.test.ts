import { describe, expect, it } from 'vitest'
import { explainVersusPrimary, type Recommendation } from './recommend.js'
import type { CatalogModel } from './catalog.js'
import type { FitReport } from './admission.js'

function rec(overrides: {
  name: string
  fileName: string
  totalParamsB: number
  activeParamsB?: number | null
  toolCalling?: CatalogModel['toolCalling']
  verdict?: FitReport['verdict']
  offload?: boolean
}): Recommendation {
  return {
    model: {
      name: overrides.name,
      fileName: overrides.fileName,
      totalParamsB: overrides.totalParamsB,
      activeParamsB: overrides.activeParamsB ?? null,
      toolCalling: overrides.toolCalling ?? 'multi',
    } as CatalogModel,
    fit: {
      verdict: overrides.verdict ?? 'comfortable',
      offload: overrides.offload ?? false,
    } as FitReport,
    defaultContextTokens: 8192,
    score: 0,
    reasons: [],
  }
}

describe('explainVersusPrimary', () => {
  const primary = rec({ name: 'Gemma 4 E4B', fileName: 'gemma.gguf', totalParamsB: 8, activeParamsB: 4 })

  it('says nothing when the models are effectively equal', () => {
    const twin = rec({ name: 'Twin', fileName: 'twin.gguf', totalParamsB: 8, activeParamsB: 4 })
    expect(explainVersusPrimary(primary, twin)).toEqual([])
  })

  it('compares measured speeds when both models were benchmarked', () => {
    const other = rec({ name: 'Qwen', fileName: 'qwen.gguf', totalParamsB: 8, activeParamsB: 4 })
    const lines = explainVersusPrimary(primary, other, { 'gemma.gguf': 34, 'qwen.gguf': 61 })
    expect(lines.some((l) => l.includes('Measured faster') && l.includes('61 vs 34'))).toBe(true)
  })

  it('flags offload against a comfortable primary as heavier', () => {
    const big = rec({ name: 'Big', fileName: 'big.gguf', totalParamsB: 70, verdict: 'comfortable', offload: true })
    const lines = explainVersusPrimary(primary, big)
    expect(lines.some((l) => l.startsWith('Heavier on this machine'))).toBe(true)
    expect(lines.some((l) => l.includes('More knowledge capacity'))).toBe(true)
  })

  it('is honest when the alternate wins an axis', () => {
    const tiny = rec({ name: 'Tiny', fileName: 'tiny.gguf', totalParamsB: 2, toolCalling: 'none' })
    const lines = explainVersusPrimary(primary, tiny)
    expect(lines.some((l) => l.includes('likely faster replies'))).toBe(true)
    expect(lines.some((l) => l.includes('Less knowledge capacity'))).toBe(true)
    expect(lines.some((l) => l.includes('Weaker tool calling'))).toBe(true)
    expect(lines.length).toBeLessThanOrEqual(3)
  })
})
