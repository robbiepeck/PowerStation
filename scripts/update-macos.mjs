import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { compareVersions, isStableReleaseTag } from './source-install-lib.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'

async function run(command, args, options = {}) {
  const child = spawn(command, args, { stdio: 'inherit', ...options })
  await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} ${args.join(' ')} exited with ${signal ? `signal ${signal}` : `code ${String(code)}`}.`))
    })
  })
}

async function latestRelease() {
  const response = await fetch('https://api.github.com/repos/robbiepeck/PowerStation/releases/latest', {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'PowerStation-source-updater' },
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`GitHub release check failed with HTTP ${response.status}.`)
  const payload = await response.json()
  const tag = typeof payload?.tag_name === 'string' ? payload.tag_name : ''
  if (!isStableReleaseTag(tag)) throw new Error('The latest GitHub release does not have a stable version tag.')
  return tag
}

try {
  if (process.platform !== 'darwin' && process.env.POWERSTATION_INSTALL_ALLOW_UNSUPPORTED !== '1') {
    throw new Error('The macOS source updater can only run on macOS.')
  }
  const currentPackage = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'))
  const currentVersion = String(currentPackage.version ?? '')
  const tag = await latestRelease()
  const releaseComparison = compareVersions(tag, currentVersion)
  if (releaseComparison <= 0) {
    console.log(
      releaseComparison === 0
        ? `PowerStation ${currentVersion} is already the latest source release.`
        : `This checkout (${currentVersion}) is newer than the latest published source release (${tag.slice(1)}).`,
    )
    process.exit(0)
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'powerstation-source-update-'))
  const sourceDir = path.join(tempDir, 'PowerStation')
  try {
    console.log(`Updating PowerStation ${currentVersion} to ${tag.slice(1)} from source…`)
    await run('git', [
      'clone',
      '--depth',
      '1',
      '--branch',
      tag,
      'https://github.com/robbiepeck/PowerStation.git',
      sourceDir,
    ])
    const updatePackage = JSON.parse(await fs.readFile(path.join(sourceDir, 'package.json'), 'utf8'))
    if (String(updatePackage.version ?? '') !== tag.slice(1)) {
      throw new Error(`Release tag ${tag} does not match its package version.`)
    }
    await run(npmCommand, ['run', 'install:mac'], { cwd: sourceDir, env: process.env })
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
  }
} catch (error) {
  console.error(`PowerStation update failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
