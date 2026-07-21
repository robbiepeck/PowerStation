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
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'powerstation-about-smoke-'))
const screenshot = process.env.POWERSTATION_ABOUT_SCREENSHOT || path.join(os.tmpdir(), 'powerstation-about.png')
const openSourceScreenshot = screenshot.replace(/(\.[^.]+)?$/, '-open-source$1')
const packageVersion = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).version

await fs.writeFile(
  path.join(profile, 'powerstation-config.json'),
  JSON.stringify({
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
  await window.getByRole('button', { name: 'About', exact: true }).click()
  await window.getByRole('heading', { name: 'Local AI, made legible.' }).waitFor()
  await window.getByText(`Version ${packageVersion}`, { exact: true }).waitFor()
  await window.getByText('github.com/robbiepeck/PowerStation', { exact: true }).waitFor()

  const guideRows = window.locator('.about-guide-row')
  if ((await guideRows.count()) !== 9) throw new Error('About field guide must explain all nine primary sections.')

  await window.screenshot({ path: screenshot, fullPage: true })
  await window.getByRole('heading', { name: 'Built in the open, improved together.' }).scrollIntoViewIfNeeded()
  await window.screenshot({ path: openSourceScreenshot, fullPage: true })
  console.log(`About view smoke test passed. Screenshots: ${screenshot}, ${openSourceScreenshot}`)
} finally {
  await desktop.close().catch(() => undefined)
  await fs.rm(profile, { recursive: true, force: true })
}
