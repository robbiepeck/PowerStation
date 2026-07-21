import { describe, expect, it } from 'vitest'
import { replacementDisposition } from './modelReplacement.js'

describe('replacementDisposition', () => {
  const managed = '/Users/test/PowerStation/models'
  const target = '/Users/test/PowerStation/models/current.gguf'

  it('keeps the replacement target', () => {
    expect(replacementDisposition(managed, target, target)).toBe('keep')
  })

  it('deletes another PowerStation-managed model', () => {
    expect(replacementDisposition(managed, `${managed}/unused.gguf`, target)).toBe('delete')
  })

  it('only detaches a model owned by another application', () => {
    expect(replacementDisposition(managed, '/Users/test/.ollama/models/blobs/sha256-model', target)).toBe('detach')
  })

  it('does not confuse a similarly prefixed folder with the managed folder', () => {
    expect(replacementDisposition(managed, '/Users/test/PowerStation/models-old/model.gguf', target)).toBe('detach')
  })
})
