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
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'powerstation-monitor-smoke-'))
const screenshot = process.env.POWERSTATION_MONITOR_SCREENSHOT || path.join(os.tmpdir(), 'powerstation-monitor-processes.png')

await fs.writeFile(
  path.join(profile, 'powerstation-config.json'),
  JSON.stringify({ onboarding: { completed: true, useCase: 'everyday', priority: 'balanced' } }),
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
  await window.getByRole('button', { name: 'Monitor', exact: true }).click()
  await window.getByRole('heading', { name: 'Live monitor' }).waitFor()
  await window.getByRole('button', { name: 'Show applications and processes using RAM' }).click()
  await window.getByRole('heading', { name: 'RAM usage by app' }).waitFor()
  await window.getByText('Source: Operating-system process table').waitFor({ timeout: 15_000 })
  const drawer = window.locator('.process-drawer')
  const powerStationGroup = drawer.locator('.process-group.powerstation .process-group-summary')
  await powerStationGroup.waitFor({ timeout: 15_000 })
  await powerStationGroup.click()
  await drawer.getByText('PID', { exact: true }).waitFor()
  await window.screenshot({ path: screenshot, fullPage: true })
  console.log(`Monitor process inspector smoke test passed. Screenshot: ${screenshot}`)
} finally {
  await desktop.close().catch(() => undefined)
  await fs.rm(profile, { recursive: true, force: true })
}
