// Standalone smoke test for the bundled GGUF engine.
// Downloads a tiny real instruct model into PowerStation's managed models folder
// (so it also shows up in the app) and runs a streaming prompt to prove inference.
import { getLlama, LlamaChatSession, createModelDownloader } from 'node-llama-cpp'
import os from 'node:os'
import path from 'node:path'
import { promises as fs } from 'node:fs'

const modelsDir =
  process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library', 'Application Support', 'PowerStation', 'models')
    : path.join(os.homedir(), '.powerstation-models')

await fs.mkdir(modelsDir, { recursive: true })

const uri = process.env.MODEL_URI || 'hf:Qwen/Qwen2.5-0.5B-Instruct-GGUF:q4_k_m'
console.log('[smoke] downloading', uri)
console.log('[smoke] into', modelsDir)

const downloader = await createModelDownloader({
  modelUri: uri,
  dirPath: modelsDir,
  onProgress: ({ totalSize, downloadedSize }) => {
    const pct = totalSize ? ((downloadedSize / totalSize) * 100).toFixed(0) : '?'
    process.stdout.write(`\r[smoke] ${(downloadedSize / 1e6).toFixed(0)}/${(totalSize / 1e6).toFixed(0)} MB (${pct}%)   `)
  },
})
await downloader.download()
const modelPath = downloader.entrypointFilePath
console.log('\n[smoke] downloaded:', modelPath)

const llama = await getLlama()
console.log('[smoke] gpu:', llama.gpu, '| devices:', await llama.getGpuDeviceNames().catch(() => []))
const vram = await llama.getVramState().catch(() => null)
if (vram) console.log('[smoke] vram total GB:', (vram.total / 1e9).toFixed(1), 'used GB:', (vram.used / 1e9).toFixed(2))

const model = await llama.loadModel({ modelPath })
console.log('[smoke] model size in memory GB:', (model.size / 1e9).toFixed(2), '| trainCtx:', model.trainContextSize)
const context = await model.createContext({ contextSize: 2048 })
const session = new LlamaChatSession({ contextSequence: context.getSequence() })

const start = Date.now()
let chars = 0
process.stdout.write('[smoke] reply: ')
const text = await session.prompt('In one short sentence, what is a GGUF file?', {
  maxTokens: 120,
  temperature: 0.7,
  onTextChunk: (chunk) => {
    chars += chunk.length
    process.stdout.write(chunk)
  },
})
const secs = (Date.now() - start) / 1000
console.log(`\n[smoke] ~${(Math.round(chars / 4) / secs).toFixed(1)} tok/s, ${text.length} chars in ${secs.toFixed(1)}s`)

await context.dispose()
await model.dispose()
console.log('[smoke] SMOKE OK')
