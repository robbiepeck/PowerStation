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

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function closeDesktop() {
  const child = desktop.process()
  const exited = child?.exitCode !== null
    ? Promise.resolve(true)
    : new Promise((resolve) => child?.once('exit', () => resolve(true)))
  await desktop.evaluate(({ app }) => app.exit(0)).catch(() => undefined)
  const closed = await Promise.race([
    exited,
    new Promise((resolve) => setTimeout(() => resolve(false), 10_000)),
  ])
  if (closed) return
  console.warn('Packaged smoke process required forced cleanup after all assertions passed.')
  child?.kill('SIGKILL')
  const forcedClosed = await Promise.race([
    exited,
    wait(10_000).then(() => false),
  ])
  if (!forcedClosed) console.warn('Packaged smoke process did not report exit after forced cleanup.')
}

async function removeProfile() {
  const retryableCodes = new Set(['EBUSY', 'ENOTEMPTY', 'EPERM'])
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      await fs.rm(profile, { recursive: true, force: true })
      return
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : null
      if (!retryableCodes.has(code) || attempt === 39) throw error
      await wait(250)
    }
  }
}

let failure = null
try {
  const window = await desktop.firstWindow({ timeout: 60_000 })
  await window.getByRole('button', { name: 'PowerStation home' }).waitFor({ timeout: 30_000 })
  if ((await window.title()) !== 'PowerStation') throw new Error(`Unexpected window title: ${await window.title()}`)
  console.log('Packaged window and preload bridge are ready.')

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
  console.log('Primary packaged navigation is responsive.')

  const processSnapshot = await window.evaluate(() => Promise.race([
    globalThis.powerStation.telemetry.processes('ram'),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Process telemetry IPC timed out.')), 30_000)),
  ]))
  if (
    typeof processSnapshot.supported !== 'boolean' ||
    processSnapshot.metric !== 'ram' ||
    !Array.isArray(processSnapshot.groups)
  ) {
    throw new Error('Packaged process telemetry returned an invalid snapshot.')
  }
  console.log(
    processSnapshot.supported
      ? 'Packaged process telemetry returned a valid RAM ranking.'
      : 'Packaged process telemetry returned a valid unavailable snapshot.',
  )

  const scheduleSnapshot = await window.evaluate(() => Promise.race([
    globalThis.powerStation.schedules.get(),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Scheduler IPC timed out.')), 60_000)),
  ]))
  if (!Array.isArray(scheduleSnapshot.jobs) || !Array.isArray(scheduleSnapshot.runs)) {
    throw new Error('Packaged scheduler IPC returned an invalid snapshot.')
  }
  console.log('Packaged scheduler IPC returned a valid snapshot.')
  await window.getByRole('button', { name: 'Schedules', exact: true }).click()
  await window.getByRole('button', { name: 'New job' }).click()
  await window.getByText('Tools and connectors are never attached.').waitFor()
  await window.getByRole('button', { name: 'Cancel' }).click()
  console.log('Packaged scheduler editor is responsive.')

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
  console.log('Packaged settings persistence is working.')

  const entries = await fs.readdir(profile)
  for (const required of ['powerstation-config.json']) {
    if (!entries.includes(required)) throw new Error(`Packaged app did not create ${required} in its isolated profile.`)
  }
} catch (error) {
  failure = error
} finally {
  try {
    await closeDesktop()
  } catch (closeError) {
    if (!failure) failure = closeError
    else console.error(`Additional shutdown failure: ${closeError instanceof Error ? closeError.message : String(closeError)}`)
  }
  await removeProfile()
}
if (failure) throw failure
console.log(`Packaged PowerStation smoke test passed on ${process.platform}/${process.arch}.`)
