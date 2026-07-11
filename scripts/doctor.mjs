import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import {
  MINIMUM_INSTALL_DISK_BYTES,
  MINIMUM_NODE_MAJOR,
  RECOMMENDED_RAM_BYTES,
  formatGb,
  nodeMajor,
} from './source-install-lib.mjs'

const execFileAsync = promisify(execFile)

async function commandVersion(command, args) {
  try {
    const { stdout } = await execFileAsync(command, args, { timeout: 10_000 })
    return stdout.trim().split('\n')[0]
  } catch {
    return null
  }
}

export async function inspectMac({ allowUnsupported = false } = {}) {
  const checks = []
  const platformOk = process.platform === 'darwin'
  const archOk = process.arch === 'arm64'
  checks.push({ level: platformOk ? 'pass' : 'fail', label: 'Operating system', detail: `${process.platform} (macOS required)` })
  checks.push({ level: archOk ? 'pass' : 'fail', label: 'Processor', detail: `${process.arch} (Apple Silicon required)` })

  const nodeOk = nodeMajor() >= MINIMUM_NODE_MAJOR
  checks.push({ level: nodeOk ? 'pass' : 'fail', label: 'Node.js', detail: `${process.version} (v${MINIMUM_NODE_MAJOR}+ required)` })

  const npmVersion = await commandVersion(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['--version'])
  checks.push({ level: npmVersion ? 'pass' : 'fail', label: 'npm', detail: npmVersion ?? 'not found' })

  const totalRam = os.totalmem()
  checks.push({
    level: totalRam >= RECOMMENDED_RAM_BYTES ? 'pass' : 'warn',
    label: 'Memory',
    detail: `${formatGb(totalRam, 0)} (${formatGb(RECOMMENDED_RAM_BYTES, 0)} recommended)`,
  })

  let availableDisk = 0
  try {
    const stats = await fs.statfs(process.cwd())
    availableDisk = stats.bavail * stats.bsize
  } catch {
    availableDisk = 0
  }
  checks.push({
    level: availableDisk >= MINIMUM_INSTALL_DISK_BYTES ? 'pass' : 'fail',
    label: 'Build disk space',
    detail: `${formatGb(availableDisk)} available (${formatGb(MINIMUM_INSTALL_DISK_BYTES, 0)} required)`,
  })

  const gitVersion = await commandVersion('git', ['--version'])
  checks.push({ level: gitVersion ? 'pass' : 'warn', label: 'Git', detail: gitVersion ?? 'not found; updates require Git' })

  const commandLineTools = await commandVersion('/usr/bin/xcode-select', ['-p'])
  checks.push({
    level: commandLineTools ? 'pass' : 'warn',
    label: 'Xcode Command Line Tools',
    detail: commandLineTools ? 'available' : 'not found; required if a native dependency must compile',
  })

  const failed = checks.some((check) => check.level === 'fail')
  return { checks, ok: allowUnsupported || !failed }
}

export function printInspection(result) {
  console.log('\nPowerStation source-install check\n')
  for (const check of result.checks) {
    const icon = check.level === 'pass' ? '✓' : check.level === 'warn' ? '!' : '✗'
    console.log(`${icon} ${check.label}: ${check.detail}`)
  }
  console.log('')
  if (!result.ok) {
    console.error('Fix the failed checks above, then run the installer again.')
  } else if (result.checks.some((check) => check.level === 'warn')) {
    console.log('Checks passed with warnings. PowerStation will still let you make the final model choice.')
  } else {
    console.log('This Mac is ready to build PowerStation locally.')
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await inspectMac({ allowUnsupported: process.env.POWERSTATION_INSTALL_ALLOW_UNSUPPORTED === '1' })
  printInspection(result)
  if (!result.ok) process.exitCode = 1
}
