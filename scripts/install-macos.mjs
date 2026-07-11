import { execFile, spawn } from 'node:child_process'
import { constants, promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { inspectMac, printInspection } from './doctor.mjs'
import { selectInstallDirectory } from './source-install-lib.mjs'

const execFileAsync = promisify(execFile)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const systemApp = '/Applications/PowerStation.app'
const userApp = path.join(os.homedir(), 'Applications', 'PowerStation.app')

async function exists(filePath) {
  return fs.access(filePath).then(() => true).catch(() => false)
}

async function writable(filePath) {
  return fs.access(filePath, constants.W_OK).then(() => true).catch(() => false)
}

async function run(command, args, options = {}) {
  const child = spawn(command, args, { cwd: root, stdio: 'inherit', ...options })
  await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} ${args.join(' ')} exited with ${signal ? `signal ${signal}` : `code ${String(code)}`}.`))
    })
  })
}

async function quitRunningApp() {
  try {
    await execFileAsync('/usr/bin/pgrep', ['-x', 'PowerStation'])
  } catch {
    return
  }
  console.log('Closing the currently running PowerStation app…')
  await execFileAsync('/usr/bin/osascript', ['-e', 'tell application "PowerStation" to quit']).catch(() => undefined)
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      await execFileAsync('/usr/bin/pgrep', ['-x', 'PowerStation'])
      await new Promise((resolve) => setTimeout(resolve, 250))
    } catch {
      return
    }
  }
  throw new Error('PowerStation is still running. Quit it and run the installer again.')
}

async function appVersion(appPath) {
  const plist = path.join(appPath, 'Contents', 'Info.plist')
  const { stdout } = await execFileAsync('/usr/bin/plutil', [
    '-extract',
    'CFBundleShortVersionString',
    'raw',
    '-o',
    '-',
    plist,
  ])
  return stdout.trim()
}

async function installApp(sourceApp, installDirectory, expectedVersion) {
  await fs.mkdir(installDirectory, { recursive: true, mode: 0o755 })
  const target = path.join(installDirectory, 'PowerStation.app')
  const staging = path.join(installDirectory, `.PowerStation.app.install-${randomUUID()}`)
  const backup = path.join(installDirectory, `.PowerStation.app.backup-${randomUUID()}`)
  await fs.rm(staging, { recursive: true, force: true })

  const sourceVersion = await appVersion(sourceApp)
  if (sourceVersion !== expectedVersion) {
    throw new Error(`Packaged app version ${sourceVersion} does not match source version ${expectedVersion}.`)
  }
  await execFileAsync('/usr/bin/codesign', ['--verify', '--deep', '--strict', sourceApp])
  await quitRunningApp()
  console.log(`Installing PowerStation ${sourceVersion} into ${installDirectory}…`)
  await execFileAsync('/usr/bin/ditto', [sourceApp, staging])
  await execFileAsync('/usr/bin/codesign', ['--verify', '--deep', '--strict', staging])

  let backedUp = false
  try {
    if (await exists(target)) {
      await fs.rename(target, backup)
      backedUp = true
    }
    await fs.rename(staging, target)
    if (process.env.POWERSTATION_INSTALL_SKIP_LAUNCH !== '1') {
      await execFileAsync('/usr/bin/open', [target])
    }
    if (backedUp) await fs.rm(backup, { recursive: true, force: true })
  } catch (error) {
    await fs.rm(target, { recursive: true, force: true }).catch(() => undefined)
    if (backedUp) await fs.rename(backup, target).catch(() => undefined)
    throw error
  } finally {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined)
  }
  return target
}

try {
  const sourcePackage = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'))
  const expectedVersion = String(sourcePackage.version ?? '')
  if (!/^\d+\.\d+\.\d+$/.test(expectedVersion)) throw new Error('package.json does not contain a stable version.')
  const inspection = await inspectMac({ allowUnsupported: process.env.POWERSTATION_INSTALL_ALLOW_UNSUPPORTED === '1' })
  printInspection(inspection)
  if (!inspection.ok) process.exit(1)

  if (process.env.POWERSTATION_INSTALL_SKIP_DEPENDENCIES !== '1') {
    console.log('\nInstalling locked dependencies…')
    await run(npmCommand, ['ci'])
  }

  const sourceApp = process.env.POWERSTATION_INSTALL_SOURCE_APP
    ? path.resolve(process.env.POWERSTATION_INSTALL_SOURCE_APP)
    : path.join(root, 'release', 'mac-arm64', 'PowerStation.app')
  if (!process.env.POWERSTATION_INSTALL_SOURCE_APP) {
    console.log('\nBuilding the local PowerStation app…')
    await run(npmCommand, ['run', 'package:mac:local'])
  }
  if (!(await exists(sourceApp))) throw new Error(`Packaged app was not created at ${sourceApp}.`)

  const systemAppExists = await exists(systemApp)
  const userAppExists = await exists(userApp)
  const installDirectory = selectInstallDirectory({
    override: process.env.POWERSTATION_INSTALL_DIR,
    home: os.homedir(),
    systemAppExists,
    systemDirectoryWritable: await writable('/Applications'),
    userAppExists,
  })
  const installed = await installApp(sourceApp, installDirectory, expectedVersion)
  console.log(`\n✓ PowerStation ${await appVersion(installed)} installed successfully.`)
  console.log('  Your models, chats and settings were preserved.')
  if (process.env.POWERSTATION_INSTALL_SKIP_LAUNCH === '1') console.log('  Launch was skipped for automated verification.')
} catch (error) {
  console.error(`\nPowerStation installation failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
