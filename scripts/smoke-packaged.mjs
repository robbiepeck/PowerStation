import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

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

let output = ''
const child = spawn(executable, ['--powerstation-smoke-test'], {
  env: {
    ...process.env,
    POWERSTATION_TEST_USER_DATA: profile,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})

child.stdout.on('data', (chunk) => {
  output += chunk.toString()
})
child.stderr.on('data', (chunk) => {
  output += chunk.toString()
})

const exit = new Promise((resolve, reject) => {
  child.once('error', reject)
  child.once('exit', (code, signal) => resolve({ code, signal }))
})
const timeout = new Promise((_, reject) => {
  setTimeout(() => {
    child.kill('SIGKILL')
    reject(new Error('Packaged smoke test timed out after 90 seconds.'))
  }, 90_000).unref()
})

try {
  const result = await Promise.race([exit, timeout])
  if (result.code !== 0 || !output.includes('POWERSTATION_PACKAGED_SMOKE_OK')) {
    throw new Error(
      `Packaged app failed its self-check (${result.signal ? `signal ${result.signal}` : `code ${String(result.code)}`}):\n${output.trim()}`,
    )
  }
  const persisted = JSON.parse(await fs.readFile(path.join(profile, 'powerstation-config.json'), 'utf8'))
  if (persisted.settings?.saveChats !== false) {
    throw new Error('Packaged settings IPC did not persist the updated value.')
  }
  console.log(`Packaged PowerStation smoke test passed on ${process.platform}/${process.arch}.`)
} finally {
  await fs.rm(profile, { recursive: true, force: true })
}
