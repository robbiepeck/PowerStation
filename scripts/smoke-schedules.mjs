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
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'powerstation-schedules-smoke-'))
const screenshot = process.env.POWERSTATION_SCHEDULES_SCREENSHOT || path.join(os.tmpdir(), 'powerstation-schedules.png')
const editorScreenshot = screenshot.replace(/(\.[^.]+)?$/, '-editor$1')
const modelsDir = path.join(profile, 'models')
const fakeModel = path.join(modelsDir, 'smoke-model-Q4_K_M.gguf')
const realModel = process.env.POWERSTATION_SMOKE_MODEL ? path.resolve(process.env.POWERSTATION_SMOKE_MODEL) : null
const testModel = realModel ?? fakeModel

await fs.mkdir(modelsDir, { recursive: true })
await fs.writeFile(fakeModel, 'GGUF-smoke-fixture', { mode: 0o600 })
await fs.writeFile(
  path.join(profile, 'powerstation-config.json'),
  JSON.stringify({
    onboarding: { completed: true, useCase: 'everyday', priority: 'balanced' },
    importedModelPaths: realModel ? [realModel] : [],
    selectedModelPath: realModel,
  }),
  { mode: 0o600 },
)

const desktop = await electron.launch({
  executablePath: electronPath,
  args: ['.'],
  cwd: root,
  env: { ...process.env, POWERSTATION_TEST_USER_DATA: profile },
})

try {
  const window = await desktop.firstWindow()
  await window.getByRole('button', { name: 'Schedules' }).click()
  await window.getByRole('heading', { name: 'Quiet automation' }).waitFor()
  await window.getByText('No scheduled work').waitFor()
  await window.getByRole('button', { name: 'New job' }).click()
  await window.getByRole('heading', { name: 'Create a local job' }).waitFor()
  await window.getByText('Tools and connectors are never attached.').waitFor()
  await window.screenshot({ path: editorScreenshot, fullPage: true })
  await window.getByLabel('Name').fill('Morning smoke brief')
  await window.getByLabel('Installed model').selectOption(testModel)
  await window.getByLabel('Prompt').fill(realModel ? 'Reply with exactly: SCHEDULE_OK' : 'Return a two-line local status brief.')
  if (realModel) {
    await window.getByLabel('Max output tokens').fill('64')
    await window.getByLabel('Time limit').selectOption('60')
  }
  await window.getByLabel('Allow on battery').check()
  await window.getByRole('button', { name: 'Save schedule' }).click()
  await window.getByRole('heading', { name: 'Morning smoke brief' }).waitFor()
  await window.getByText('Weekday mornings').waitFor()
  await window.getByRole('button', { name: 'Run now' }).click()
  if (realModel) {
    const successfulRun = window.locator('.schedule-run-row.success')
    await successfulRun.waitFor({ timeout: 120_000 })
    await successfulRun.locator('summary').click()
    const output = await successfulRun.locator('pre').textContent()
    if (!output?.includes('SCHEDULE_OK')) throw new Error('Scheduled inference completed without the expected output.')
  } else {
    await window.locator('.schedule-run-row').waitFor({ timeout: 10_000 })
  }
  await window.screenshot({ path: screenshot, fullPage: true })
  console.log(`Schedules smoke test passed. Screenshots: ${screenshot}, ${editorScreenshot}`)
} finally {
  await desktop.close().catch(() => undefined)
  await fs.rm(profile, { recursive: true, force: true })
}
