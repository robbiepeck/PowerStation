import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { formatGb } from './source-install-lib.mjs'

const execFileAsync = promisify(execFile)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

async function command(command, args) {
  try {
    const { stdout } = await execFileAsync(command, args, { timeout: 10_000 })
    return stdout.trim().split('\n')[0]
  } catch {
    return 'unavailable'
  }
}

async function countFiles(dir, suffix = '') {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
  let count = 0
  let bytes = 0
  for (const entry of entries) {
    if (!entry.isFile() || (suffix && !entry.name.toLowerCase().endsWith(suffix))) continue
    count += 1
    bytes += await fs.stat(path.join(dir, entry.name)).then((stat) => stat.size).catch(() => 0)
  }
  return { count, bytes }
}

async function installedVersion(appPath) {
  return command('/usr/bin/plutil', [
    '-extract',
    'CFBundleShortVersionString',
    'raw',
    '-o',
    '-',
    path.join(appPath, 'Contents', 'Info.plist'),
  ])
}

const sourcePackage = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'))
const dataDir = path.join(os.homedir(), 'Library', 'Application Support', 'PowerStation')
const models = await countFiles(path.join(dataDir, 'models'), '.gguf')
const chats = await countFiles(path.join(dataDir, 'chats'), '.json')
const projects = await countFiles(path.join(dataDir, 'projects'), '.json')
const agents = await countFiles(path.join(dataDir, 'agents'), '.json')
const scheduleSummary = await fs
  .readFile(path.join(dataDir, 'scheduled-jobs.json'), 'utf8')
  .then((text) => JSON.parse(text))
  .then((value) => ({
    jobs: Array.isArray(value?.jobs) ? value.jobs.length : 0,
    runs: Array.isArray(value?.runs) ? value.runs.length : 0,
  }))
  .catch(() => ({ jobs: 0, runs: 0 }))
const disk = await fs.statfs(os.homedir()).catch(() => null)
const systemApp = '/Applications/PowerStation.app'
const userApp = path.join(os.homedir(), 'Applications', 'PowerStation.app')
const systemVersion = await fs.access(systemApp).then(() => installedVersion(systemApp)).catch(() => 'not installed')
const userVersion = await fs.access(userApp).then(() => installedVersion(userApp)).catch(() => 'not installed')

console.log(`PowerStation diagnostics
Source version: ${sourcePackage.version}
Source commit: ${await command('git', ['rev-parse', '--short=12', 'HEAD'])}
Source tree clean: ${(await command('git', ['status', '--porcelain'])) === '' ? 'yes' : 'no'}
macOS: ${await command('/usr/bin/sw_vers', ['-productVersion'])}
Architecture: ${process.arch}
Processor: ${os.cpus()[0]?.model ?? 'unknown'}
Memory: ${formatGb(os.totalmem(), 0)}
Free disk: ${disk ? formatGb(disk.bavail * disk.bsize) : 'unavailable'}
Node.js: ${process.version}
npm: ${await command(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['--version'])}
Git: ${await command('git', ['--version'])}
Xcode Command Line Tools: ${(await command('/usr/bin/xcode-select', ['-p'])) === 'unavailable' ? 'not installed' : 'installed'}
System Applications copy: ${systemVersion}
User Applications copy: ${userVersion}
Configuration present: ${await fs.access(path.join(dataDir, 'powerstation-config.json')).then(() => 'yes').catch(() => 'no')}
Models: ${models.count} (${formatGb(models.bytes)})
Chats: ${chats.count}
Projects: ${projects.count}
Agents: ${agents.count}
Schedules: ${scheduleSummary.jobs} (${scheduleSummary.runs} retained runs)

Privacy note: this report excludes usernames, paths, model names, chat titles, prompts, scheduled results, document contents and secrets.`)
