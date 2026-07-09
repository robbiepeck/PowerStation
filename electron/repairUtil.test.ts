import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { assertWithinDir, findDuplicateModels, isWithin, looksLikeGguf, walkSize } from './repairUtil.js'

let base: string
let outside: string

beforeAll(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), 'ps-repair-base-'))
  outside = await fs.mkdtemp(path.join(os.tmpdir(), 'ps-repair-outside-'))
  await fs.writeFile(path.join(base, 'inside.json'), '{}')
  await fs.writeFile(path.join(outside, 'victim.txt'), 'precious')

  await fs.symlink(outside, path.join(base, 'escape-dir'))
  await fs.symlink(path.join(outside, 'victim.txt'), path.join(base, 'escape-file'))
})

afterAll(async () => {
  await fs.rm(base, { recursive: true, force: true })
  await fs.rm(outside, { recursive: true, force: true })
})

describe('assertWithinDir', () => {
  it('allows real files inside the base', async () => {
    await expect(assertWithinDir(base, path.join(base, 'inside.json'))).resolves.toBeTruthy()
  })

  it('allows not-yet-existing paths inside the base', async () => {
    await expect(assertWithinDir(base, path.join(base, 'new-dir', 'new.json'))).resolves.toBeTruthy()
  })

  it('rejects .. traversal', async () => {
    await expect(assertWithinDir(base, path.join(base, '..', 'somewhere'))).rejects.toThrow('outside the app data folder')
  })

  it('rejects absolute paths elsewhere', async () => {
    await expect(assertWithinDir(base, path.join(outside, 'victim.txt'))).rejects.toThrow('outside')
  })

  it('rejects a symlinked file inside base pointing outside', async () => {
    await expect(assertWithinDir(base, path.join(base, 'escape-file'))).rejects.toThrow('outside')
  })

  it('rejects a path under a symlinked directory that escapes', async () => {
    await expect(assertWithinDir(base, path.join(base, 'escape-dir', 'victim.txt'))).rejects.toThrow('outside')
  })
})

describe('isWithin', () => {
  it('handles equal, nested, and sibling paths', () => {
    expect(isWithin('/a/b', '/a/b')).toBe(true)
    expect(isWithin('/a/b', '/a/b/c/d')).toBe(true)
    expect(isWithin('/a/b', '/a/bc')).toBe(false)
    expect(isWithin('/a/b', '/a')).toBe(false)
  })
})

describe('walkSize', () => {
  it('sums files without following symlinks', async () => {
    const result = await walkSize(base)

    expect(result.fileCount).toBe(1)
    expect(result.sizeBytes).toBe(2)
    expect(result.approximate).toBe(false)
  })

  it('marks capped walks as approximate', async () => {
    const result = await walkSize(base, 1)
    expect(result.approximate).toBe(true)
  })

  it('returns zeros for missing directories', async () => {
    expect(await walkSize(path.join(base, 'nope'))).toEqual({ sizeBytes: 0, fileCount: 0, approximate: false })
  })
})

describe('findDuplicateModels', () => {
  const A = { app: 'PowerStation', name: 'gemma.gguf', path: '/ps/gemma.gguf', sizeBytes: 100 }

  it('flags the same file name+size across two apps', () => {
    const groups = findDuplicateModels([A, { app: 'Ollama', name: 'gemma.gguf', path: '/ollama/gemma.gguf', sizeBytes: 100 }])
    expect(groups).toHaveLength(1)
    expect(groups[0].wastedBytes).toBe(100)
  })

  it('ignores same-app listings and identical paths', () => {
    expect(findDuplicateModels([A, { ...A }])).toHaveLength(0)
    expect(findDuplicateModels([A, { ...A, app: 'Ollama' }])).toHaveLength(0)
  })

  it('never pairs different sizes (different quantizations)', () => {
    expect(
      findDuplicateModels([A, { app: 'Ollama', name: 'gemma.gguf', path: '/o/gemma.gguf', sizeBytes: 200 }]),
    ).toHaveLength(0)
  })
})

describe('looksLikeGguf', () => {
  it('accepts the GGUF magic and rejects everything else', () => {
    expect(looksLikeGguf(Buffer.from('GGUFxxxx'))).toBe(true)
    expect(looksLikeGguf(Buffer.from('JUNK'))).toBe(false)
    expect(looksLikeGguf(Buffer.from('GG'))).toBe(false)
  })
})
