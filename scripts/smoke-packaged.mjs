import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { _electron as electron } from 'playwright'

const executable = process.argv[2] ? path.resolve(process.argv[2]) : ''
if (!executable) throw new Error('Usage: npm run test:packaged -- <path-to-packaged-executable>')
await fs.access(executable)
const packageVersion = JSON.parse(await fs.readFile(path.resolve('package.json'), 'utf8')).version

const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'powerstation-packaged-smoke-'))
await fs.writeFile(
  path.join(profile, 'powerstation-config.json'),
  JSON.stringify({
    onboarding: { completed: true, useCase: 'everyday', priority: 'balanced' },
    lastSeenVersion: packageVersion,
  }),
  { mode: 0o600 },
)

const desktop = await electron.launch({
  executablePath: executable,
  args: ['--powerstation-smoke-test'],
  env: { ...process.env, POWERSTATION_TEST_USER_DATA: profile },
  timeout: 60_000,
})

try {
  const window = await desktop.firstWindow({ timeout: 60_000 })
  await window.getByRole('button', { name: 'PowerStation home' }).waitFor({ timeout: 30_000 })
  if ((await window.title()) !== 'PowerStation') throw new Error(`Unexpected window title: ${await window.title()}`)

  const destinations = [
    ['Monitor', 'Live monitor'],
    ['Models', 'Local models'],
    ['Schedules', 'Quiet automation'],
    ['Settings', 'Runtime & generation'],
    ['Repair', 'Storage & health'],
  ]
  for (const [button, heading] of destinations) {
    await window.getByRole('button', { name: button, exact: true }).click()
    await window.getByRole('heading', { name: heading }).waitFor({ timeout: 30_000 })
  }

  await window.getByRole('button', { name: 'Schedules', exact: true }).click()
  await window.getByText('No scheduled work').waitFor({ timeout: 30_000 })
  await window.getByRole('button', { name: 'New job' }).click()
  await window.getByText('Tools and connectors are never attached.').waitFor()
  await window.getByRole('button', { name: 'Cancel' }).click()

  await window.getByRole('button', { name: 'Settings', exact: true }).click()
  const saveChats = window.locator('label.toggle-control').filter({ hasText: 'Save chats on this device' })
  await saveChats.click()
  let settingsPersisted = false
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const persisted = JSON.parse(await fs.readFile(path.join(profile, 'powerstation-config.json'), 'utf8'))
    if (persisted.settings?.saveChats === false) {
      settingsPersisted = true
      break
    }
    await window.waitForTimeout(100)
  }
  if (!settingsPersisted) throw new Error('Packaged settings IPC did not persist the updated value.')

  const entries = await fs.readdir(profile)
  for (const required of ['powerstation-config.json']) {
    if (!entries.includes(required)) throw new Error(`Packaged app did not create ${required} in its isolated profile.`)
  }
  console.log(`Packaged PowerStation smoke test passed on ${process.platform}/${process.arch}.`)
} finally {
  await desktop.close().catch(() => undefined)
  await fs.rm(profile, { recursive: true, force: true })
}
