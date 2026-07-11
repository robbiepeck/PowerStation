import { describe, expect, it } from 'vitest'
import { requiredModelDownloadSpace } from './downloadCapacity.js'

describe('requiredModelDownloadSpace', () => {
  it('reserves room for the complete model and filesystem headroom', () => {
    expect(requiredModelDownloadSpace(3_000, 0, 1_000)).toBe(4_000)
  })

  it('accounts for a resumable partial download', () => {
    expect(requiredModelDownloadSpace(3_000, 1_250, 1_000)).toBe(2_750)
  })

  it('still preserves headroom when the model is already complete', () => {
    expect(requiredModelDownloadSpace(3_000, 3_000, 1_000)).toBe(1_000)
  })
})
