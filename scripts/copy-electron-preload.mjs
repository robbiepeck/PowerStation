import { copyFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(rootDir, 'dist-electron')

await mkdir(outDir, { recursive: true })
await copyFile(path.join(rootDir, 'electron/preload.cjs'), path.join(outDir, 'preload.cjs'))
