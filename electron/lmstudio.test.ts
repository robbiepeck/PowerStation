import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { listModelsUnder } from './lmstudio.js'

let root: string

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ps-lmstudio-'))
  const write = async (rel: string, bytes: number) => {
    const full = path.join(root, rel)
    await fs.mkdir(path.dirname(full), { recursive: true })
    await fs.writeFile(full, Buffer.alloc(bytes))
  }
  await write('lmstudio-community/gemma-2b/gemma-2b-Q4_K_M.gguf', 10)
  // Vision projector companions must not be listed as chat models.
  await write('lmstudio-community/gemma-2b/mmproj-gemma-2b-F16.gguf', 5)
  // Split series: only part 1 surfaces, priced as the whole set.
  await write('team/big-model/big-model-Q4-00001-of-00003.gguf', 100)
  await write('team/big-model/big-model-Q4-00002-of-00003.gguf', 100)
  await write('team/big-model/big-model-Q4-00003-of-00003.gguf', 50)
  // Non-model files are ignored.
  await write('team/big-model/notes.txt', 3)
})

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('listModelsUnder', () => {
  it('lists GGUFs with publisher/repo names, skipping mmproj companions', async () => {
    const models = await listModelsUnder(root)
    const names = models.map((m) => `${m.name}:${m.fileName}`).sort()
    expect(names).toEqual([
      'lmstudio-community/gemma-2b:gemma-2b-Q4_K_M.gguf',
      'team/big-model:big-model-Q4-00001-of-00003.gguf',
    ])
  })

  it('prices a split series as the sum of its parts', async () => {
    const models = await listModelsUnder(root)
    const split = models.find((m) => m.fileName.includes('00001-of-00003'))
    expect(split?.sizeBytes).toBe(250)
  })

  it('returns nothing for a missing root', async () => {
    expect(await listModelsUnder(path.join(root, 'does-not-exist'))).toEqual([])
  })
})
