import { describe, expect, it } from 'vitest'
import { generationTokensPerSecond } from './generationMetrics.js'

describe('generationTokensPerSecond', () => {
  it('excludes prompt evaluation latency from generated-token speed', () => {
    expect(
      generationTokensPerSecond({
        outputTokens: 9,
        startedAt: 0,
        firstTokenAt: 4_500,
        finishedAt: 4_700,
      }),
    ).toBe(40)
  })

  it('falls back to total elapsed time when token timing is unavailable', () => {
    expect(
      generationTokensPerSecond({
        outputTokens: 20,
        startedAt: 1_000,
        firstTokenAt: null,
        finishedAt: 2_000,
      }),
    ).toBe(20)
  })

  it('does not invent a rate for a single instantaneous token', () => {
    expect(
      generationTokensPerSecond({
        outputTokens: 1,
        startedAt: 0,
        firstTokenAt: 100,
        finishedAt: 100,
      }),
    ).toBe(0)
  })
})
