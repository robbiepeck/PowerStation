import { describe, expect, it } from 'vitest'
import { shouldUseSystemInformationMemory } from './telemetryPlatform.js'

describe('telemetry platform probes', () => {
  it('avoids the fragile systeminformation memory probe on macOS', () => {
    expect(shouldUseSystemInformationMemory('darwin')).toBe(false)
  })

  it.each(['win32', 'linux'] as const)('keeps the richer memory probe on %s', (platform) => {
    expect(shouldUseSystemInformationMemory(platform)).toBe(true)
  })
})
