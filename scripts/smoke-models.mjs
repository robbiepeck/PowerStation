import { createRequire } from 'node:module'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'

const require = createRequire(import.meta.url)
const electronPath = require('electron')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'powerstation-models-smoke-'))
const screenshot = process.env.POWERSTATION_MODELS_SCREENSHOT || path.join(os.tmpdir(), 'powerstation-models.png')
const modelDir = path.join(profile, 'models')
const modelPath = path.join(modelDir, 'current-test-model.Q4_K_M.gguf')
const packageVersion = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).version

await fs.mkdir(modelDir, { recursive: true })
await fs.writeFile(modelPath, 'GGUFTEST', { mode: 0o600 })
await fs.writeFile(
  path.join(profile, 'powerstation-config.json'),
  JSON.stringify({
    importedModelPaths: [modelPath],
    selectedModelPath: modelPath,
    onboarding: { completed: true, useCase: 'everyday', priority: 'balanced' },
    lastSeenVersion: packageVersion,
  }),
  { mode: 0o600 },
)

const desktop = await electron.launch({
  executablePath: electronPath,
  args: ['.', '--powerstation-smoke-test'],
  cwd: root,
  env: { ...process.env, POWERSTATION_TEST_USER_DATA: profile },
})

try {
  const window = await desktop.firstWindow()
  await window.getByRole('button', { name: 'Models', exact: true }).click()
  await window.getByRole('heading', { name: 'Local models' }).waitFor()
  await window.getByRole('region', { name: 'One-model mode' }).waitFor()
  await window.getByText('PowerStation keeps one chat model at a time.', { exact: false }).waitFor()
  await window.getByRole('button', { name: 'Replace with .gguf' }).waitFor()
  await window.getByRole('button', { name: 'Download & replace' }).waitFor()
  if ((await window.getByRole('button', { name: 'Add models folder' }).count()) !== 0) {
    throw new Error('One-model mode must not expose folder-based multi-model registration.')
  }
  await window.screenshot({ path: screenshot, fullPage: true })
  console.log(`Models view smoke test passed. Screenshot: ${screenshot}`)
} finally {
  await desktop.close().catch(() => undefined)
  await fs.rm(profile, { recursive: true, force: true })
}
