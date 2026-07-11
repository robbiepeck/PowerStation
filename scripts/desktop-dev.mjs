import { spawn } from 'node:child_process'
import net from 'node:net'
import path from 'node:path'
import process from 'node:process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const electronPath = require('electron')
const vitePath = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js')
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const host = '127.0.0.1'

async function canListen(port) {
  return await new Promise((resolve) => {
    const server = net.createServer()
    server.unref()
    server.once('error', () => resolve(false))
    server.listen({ host, port, exclusive: true }, () => {
      server.close(() => resolve(true))
    })
  })
}

async function choosePort(start = 5173, attempts = 100) {
  for (let port = start; port < start + attempts; port += 1) {
    if (await canListen(port)) return port
  }
  throw new Error(`No free development port found between ${start} and ${start + attempts - 1}.`)
}

async function waitForServer(url, child, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Vite exited before ${url} became ready.`)
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error(`Timed out waiting for ${url}.`)
}

async function runChecked(command, args) {
  const child = spawn(command, args, { cwd: root, stdio: 'inherit' })
  const code = await new Promise((resolve) => child.once('exit', resolve))
  if (code !== 0) throw new Error(`${command} ${args.join(' ')} exited with code ${String(code)}.`)
}

let vite = null
let electron = null
let stopping = false

function stop(code = 0) {
  if (stopping) return
  stopping = true
  if (electron?.exitCode === null) electron.kill('SIGTERM')
  if (vite?.exitCode === null) vite.kill('SIGTERM')
  process.exitCode = code
}

process.once('SIGINT', () => stop(0))
process.once('SIGTERM', () => stop(0))

try {
  const port = await choosePort()
  const url = `http://${host}:${port}`
  console.log(`Starting PowerStation renderer at ${url}`)

  vite = spawn(process.execPath, [vitePath, '--host', host, '--port', String(port), '--strictPort'], {
    cwd: root,
    stdio: 'inherit',
  })
  vite.once('exit', (code) => {
    if (!stopping) stop(typeof code === 'number' ? code : 1)
  })

  await waitForServer(url, vite)
  await runChecked(npmCommand, ['run', 'build:electron'])

  electron = spawn(electronPath, ['.'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, VITE_DEV_SERVER_URL: url },
  })
  electron.once('exit', (code) => {
    if (!stopping) stop(typeof code === 'number' ? code : 0)
  })
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  stop(1)
}
