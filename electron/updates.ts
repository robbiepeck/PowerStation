import { createRequire } from 'node:module'
import { spawn, execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { app, ipcMain, type BrowserWindow } from 'electron'
import { createReadStream, createWriteStream } from 'node:fs'
import { promises as fs } from 'node:fs'
import https from 'node:https'
import os from 'node:os'
import path from 'node:path'
import type { ProgressInfo, UpdateInfo } from 'electron-updater'

const require = createRequire(import.meta.url)
const { autoUpdater } = require('electron-updater') as typeof import('electron-updater')

const macAutoUpdatesSupported = false
const linuxAppImageUpdatesSupported = process.platform === 'linux' && Boolean(process.env.APPIMAGE)
const builtInUpdatesSupported =
  app.isPackaged && (process.platform === 'win32' || linuxAppImageUpdatesSupported || (process.platform === 'darwin' && macAutoUpdatesSupported))
const manualMacUpdatesSupported = app.isPackaged && process.platform === 'darwin' && !macAutoUpdatesSupported
const updatesSupported = builtInUpdatesSupported || manualMacUpdatesSupported
const unsupportedUpdateMessage = app.isPackaged
  ? process.platform === 'linux'
    ? 'In-app updates are available for Linux AppImage builds. Download the latest package manually when running from a deb install.'
    : 'Updates are not available for this platform.'
  : 'Updates are only available in packaged desktop builds.'

type GitHubReleaseAsset = {
  name?: string
  browser_download_url?: string
  size?: number
  digest?: string
}

type GitHubRelease = {
  tag_name?: string
  name?: string
  assets?: GitHubReleaseAsset[]
}

type ManualUpdateAsset = {
  name: string
  url: string
  size: number
  digest: string | null
  kind: 'dmg' | 'zip'
}

const UPDATE_HOSTS = new Set([
  'github.com',
  'api.github.com',
  'objects.githubusercontent.com',
  'github-releases.githubusercontent.com',
  'release-assets.githubusercontent.com',
])

function isUpdateUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw)
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password && !parsed.port && UPDATE_HOSTS.has(parsed.hostname)
  } catch {
    return false
  }
}

export type UpdateState = {
  phase: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error' | 'unsupported'
  currentVersion: string
  latestVersion?: string
  releaseName?: string
  message?: string
  progressPct?: number
  transferredBytes?: number
  totalBytes?: number
  bytesPerSecond?: number
  lastCheckedAt?: number
}

let state: UpdateState = {
  phase: updatesSupported ? 'idle' : 'unsupported',
  currentVersion: app.getVersion(),
  message: updatesSupported ? undefined : unsupportedUpdateMessage,
}
let installAfterDownload = false
let manualMacUpdate: { version: string; releaseName?: string; asset: ManualUpdateAsset } | null = null

function cleanInfo(info?: UpdateInfo): Pick<UpdateState, 'latestVersion' | 'releaseName'> {
  return {
    latestVersion: info?.version,
    releaseName: typeof info?.releaseName === 'string' ? info.releaseName : undefined,
  }
}

function setState(patch: Partial<UpdateState>, getWindow?: () => BrowserWindow | null): UpdateState {
  state = { ...state, ...patch, currentVersion: app.getVersion() }
  const win = getWindow?.()
  if (win && !win.isDestroyed()) win.webContents.send('updates:state', state)
  return state
}

function formatUpdateError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('releases.atom') && message.includes('404')) {
    return 'PowerStation could not reach the GitHub release feed. This usually means the update repository or release assets are private. Publish releases from a public repository or configure an authenticated updater.'
  }
  if (message.includes('latest-mac.yml') && message.includes('404')) {
    return 'PowerStation found a release, but the macOS update metadata is missing. Upload latest-mac.yml from Electron Builder to the GitHub Release.'
  }
  if (message.includes('latest-linux.yml') && message.includes('404')) {
    return 'PowerStation found a release, but the Linux update metadata is missing. Upload latest-linux.yml from Electron Builder to the GitHub Release.'
  }
  return message.split('\n')[0] || 'Update check failed.'
}

function compareVersions(a: string, b: string): number {
  const parse = (version: string) =>
    version
      .replace(/^v/i, '')
      .split('.')
      .map((part) => Number.parseInt(part, 10))
      .filter((part) => Number.isFinite(part))
  const left = parse(a)
  const right = parse(b)
  const length = Math.max(left.length, right.length, 3)
  for (let index = 0; index < length; index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

function chooseMacAsset(release: GitHubRelease): ManualUpdateAsset | null {
  const assets = Array.isArray(release.assets) ? release.assets : []
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  const updateAssets = assets
    .map((asset) => ({
      name: typeof asset.name === 'string' ? asset.name : '',
      url: typeof asset.browser_download_url === 'string' ? asset.browser_download_url : '',
      size: typeof asset.size === 'number' ? asset.size : 0,
      digest:
        typeof asset.digest === 'string' && /^sha256:[a-f0-9]{64}$/i.test(asset.digest)
          ? asset.digest.toLowerCase()
          : null,
    }))
    .map((asset) => {
      const lower = asset.name.toLowerCase()
      const kind = lower.endsWith('.zip') ? 'zip' : lower.endsWith('.dmg') ? 'dmg' : null
      return kind ? { ...asset, kind } : null
    })
    .filter((asset): asset is ManualUpdateAsset => Boolean(asset?.name && asset.url && asset.size > 0 && asset.size <= 2_000_000_000 && isUpdateUrl(asset.url)))

  return (
    updateAssets.find((asset) => asset.name.toLowerCase().includes(`macos-${arch}.${asset.kind}`)) ??
    updateAssets.find((asset) => asset.name.toLowerCase().includes(`macos-universal.${asset.kind}`)) ??
    null
  )
}

function requestUrl(url: string, redirects = 0): Promise<import('node:http').IncomingMessage> {
  if (!isUpdateUrl(url)) return Promise.reject(new Error('Update URL is not an approved GitHub URL.'))
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': `PowerStation/${app.getVersion()}`,
        },
      },
      (response) => {
        const location = response.headers.location
        if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && location) {
          response.resume()
          if (redirects > 5) {
            reject(new Error('Too many redirects while downloading update.'))
            return
          }
          const next = new URL(location, url).toString()
          if (!isUpdateUrl(next)) {
            reject(new Error('Update redirect left the approved GitHub hosts.'))
            return
          }
          resolve(requestUrl(next, redirects + 1))
          return
        }
        if (!response.statusCode || response.statusCode >= 400) {
          response.resume()
          reject(new Error(`Update request failed with HTTP ${response.statusCode ?? 'unknown'}.`))
          return
        }
        resolve(response)
      },
    )
    request.on('error', reject)
  })
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await requestUrl(url)
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of response) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > 2 * 1024 * 1024) throw new Error('Update metadata is too large.')
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T
}

async function downloadFile(
  url: string,
  targetPath: string,
  onProgress: (progress: { downloadedSize: number; totalSize: number }) => void,
): Promise<void> {
  const response = await requestUrl(url)
  const totalSize = Number(response.headers['content-length'] ?? 0)
  if (totalSize > 2_000_000_000) throw new Error('Update download is too large.')
  let downloadedSize = 0

  await new Promise<void>((resolve, reject) => {
    const file = createWriteStream(targetPath)
    response.on('data', (chunk: Buffer) => {
      downloadedSize += chunk.length
      if (downloadedSize > 2_000_000_000) {
        response.destroy(new Error('Update download is too large.'))
        file.destroy()
        return
      }
      onProgress({ downloadedSize, totalSize })
    })
    response.on('error', reject)
    file.on('error', reject)
    file.on('finish', resolve)
    response.pipe(file)
  }).catch(async (error) => {
    await fs.rm(targetPath, { force: true }).catch(() => undefined)
    throw error
  })
}

async function validateDownloadedAsset(asset: ManualUpdateAsset, filePath: string): Promise<void> {
  const stat = await fs.stat(filePath)
  if (!stat.isFile() || stat.size !== asset.size) {
    throw new Error(`Update download size mismatch: expected ${asset.size} bytes, received ${stat.size} bytes.`)
  }
  if (!asset.digest) return

  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) hash.update(chunk)
  const actual = `sha256:${hash.digest('hex')}`
  if (actual !== asset.digest) throw new Error('Update download failed its SHA-256 integrity check.')
}

function execFileAsync(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(command, args, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr.trim() || stdout.trim() || error.message))
        return
      }
      resolve()
    })
  })
}

async function findExtractedApp(dir: string): Promise<string> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const direct = entries.find((entry) => entry.isDirectory() && entry.name === 'PowerStation.app')
  if (direct) return path.join(dir, direct.name)
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const nested = path.join(dir, entry.name)
    const nestedEntries = await fs.readdir(nested, { withFileTypes: true }).catch(() => [])
    const appEntry = nestedEntries.find((candidate) => candidate.isDirectory() && candidate.name === 'PowerStation.app')
    if (appEntry) return path.join(nested, appEntry.name)
  }
  throw new Error('Downloaded update did not contain PowerStation.app.')
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
}

function currentAppBundlePath(): string {
  return path.resolve(process.execPath, '../../..')
}

async function validateExtractedApp(appPath: string): Promise<void> {
  const plistPath = path.join(appPath, 'Contents/Info.plist')
  const identifier = await new Promise<string>((resolve, reject) => {
    execFile('/usr/bin/plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', plistPath], (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr.trim() || stdout.trim() || error.message))
        return
      }
      resolve(stdout.trim())
    })
  })
  if (identifier !== 'com.powerstation.desktop') {
    throw new Error('Downloaded update is not a PowerStation app bundle.')
  }
  await execFileAsync('/usr/bin/codesign', ['--verify', '--deep', '--strict', appPath])
  await execFileAsync('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=4', appPath])
}

async function installExtractedAppAndRestart(
  newAppPath: string,
  tempDir: string,
  mountDir: string | null,
  getWindow: () => BrowserWindow | null,
): Promise<void> {
  const appPath = currentAppBundlePath()
  if (!appPath.endsWith('.app')) throw new Error('PowerStation is not running from a macOS app bundle.')
  const backupPath = `${appPath}.backup-${Date.now()}`
  const scriptPath = path.join(tempDir, 'install-powerstation-update.zsh')
  const script = `#!/bin/zsh
set -euo pipefail
APP_PID=${process.pid}
APP_PATH=${shellQuote(appPath)}
NEW_APP=${shellQuote(newAppPath)}
BACKUP_PATH=${shellQuote(backupPath)}
TEMP_DIR=${shellQuote(tempDir)}
MOUNT_DIR=${mountDir ? shellQuote(mountDir) : "''"}

for _ in {1..300}; do
  if ! kill -0 "$APP_PID" 2>/dev/null; then
    break
  fi
  sleep 0.1
done

if [ -d "$APP_PATH" ]; then
  /bin/mv "$APP_PATH" "$BACKUP_PATH"
fi
if ! /usr/bin/ditto "$NEW_APP" "$APP_PATH"; then
  /bin/rm -rf "$APP_PATH"
  if [ -d "$BACKUP_PATH" ]; then
    /bin/mv "$BACKUP_PATH" "$APP_PATH"
  fi
  exit 1
fi
if [ -n "$MOUNT_DIR" ]; then
  /usr/bin/hdiutil detach "$MOUNT_DIR" >/dev/null 2>&1 || true
fi
if ! /usr/bin/open "$APP_PATH"; then
  /bin/rm -rf "$APP_PATH"
  if [ -d "$BACKUP_PATH" ]; then
    /bin/mv "$BACKUP_PATH" "$APP_PATH"
  fi
  exit 1
fi
/bin/rm -rf "$BACKUP_PATH"
/bin/rm -rf "$TEMP_DIR"
`
  await fs.writeFile(scriptPath, script, { mode: 0o700 })
  setState({ phase: 'downloaded', message: 'Installing update and restarting…', progressPct: 100 }, getWindow)
  spawn('/bin/zsh', [scriptPath], { detached: true, stdio: 'ignore' }).unref()
  setTimeout(() => app.quit(), 250)
}

async function checkManualMacUpdate(getWindow: () => BrowserWindow | null): Promise<UpdateState> {
  setState({ phase: 'checking', message: undefined }, getWindow)
  const release = await fetchJson<GitHubRelease>('https://api.github.com/repos/robbiepeck/PowerStation/releases/latest')
  const version = typeof release.tag_name === 'string' ? release.tag_name.replace(/^v/i, '') : ''
  if (!version) throw new Error('Latest PowerStation release did not include a version tag.')
  const asset = chooseMacAsset(release)
  if (!asset) throw new Error(`PowerStation ${version} does not include a macOS ${process.arch} update asset.`)

  if (compareVersions(version, app.getVersion()) <= 0) {
    manualMacUpdate = null
    return setState(
      {
        phase: 'idle',
        latestVersion: version,
        releaseName: release.name,
        lastCheckedAt: Date.now(),
        message: `PowerStation ${app.getVersion()} is already current.`,
      },
      getWindow,
    )
  }

  manualMacUpdate = { version, releaseName: release.name, asset }
  return setState({ phase: 'available', latestVersion: version, releaseName: release.name, message: undefined }, getWindow)
}

async function installManualMacUpdate(getWindow: () => BrowserWindow | null): Promise<UpdateState> {
  if (!manualMacUpdate) {
    await checkManualMacUpdate(getWindow)
  }
  if (!manualMacUpdate) return state

  const update = manualMacUpdate
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'powerstation-update-'))
  const artifactPath = path.join(tempDir, update.asset.name)
  const extractDir = path.join(tempDir, 'extracted')
  const mountDir = update.asset.kind === 'dmg' ? path.join(tempDir, 'mount') : null
  await fs.mkdir(extractDir, { recursive: true })
  let handedOff = false
  let mounted = false
  try {
    setState({ phase: 'downloading', latestVersion: update.version, progressPct: 0, message: undefined }, getWindow)
    await downloadFile(update.asset.url, artifactPath, ({ downloadedSize, totalSize }) => {
      setState(
        {
          phase: 'downloading',
          latestVersion: update.version,
          transferredBytes: downloadedSize,
          totalBytes: totalSize || update.asset.size,
          progressPct: totalSize ? (downloadedSize / totalSize) * 100 : undefined,
        },
        getWindow,
      )
    })
    await validateDownloadedAsset(update.asset, artifactPath)

    let extractedApp: string
    if (update.asset.kind === 'zip') {
      await execFileAsync('/usr/bin/ditto', ['-x', '-k', artifactPath, extractDir])
      extractedApp = await findExtractedApp(extractDir)
    } else {
      if (!mountDir) throw new Error('Missing update mount directory.')
      await fs.mkdir(mountDir, { recursive: true })
      await execFileAsync('/usr/bin/hdiutil', ['attach', artifactPath, '-nobrowse', '-readonly', '-mountpoint', mountDir])
      mounted = true
      extractedApp = await findExtractedApp(mountDir)
    }
    await validateExtractedApp(extractedApp)
    await installExtractedAppAndRestart(extractedApp, tempDir, mountDir, getWindow)
    handedOff = true
    return state
  } finally {
    if (!handedOff) {
      if (mounted && mountDir) await execFileAsync('/usr/bin/hdiutil', ['detach', mountDir]).catch(() => undefined)
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}

async function checkForUpdates(getWindow: () => BrowserWindow | null): Promise<UpdateState> {
  if (manualMacUpdatesSupported) return checkManualMacUpdate(getWindow)
  if (!builtInUpdatesSupported) return setState({ phase: 'unsupported', message: state.message }, getWindow)
  setState({ phase: 'checking', message: undefined }, getWindow)
  await autoUpdater.checkForUpdates()
  return state
}

async function installLatest(getWindow: () => BrowserWindow | null): Promise<UpdateState> {
  if (manualMacUpdatesSupported) return installManualMacUpdate(getWindow)
  if (!builtInUpdatesSupported) return setState({ phase: 'unsupported', message: state.message }, getWindow)

  installAfterDownload = true
  if (state.phase === 'downloaded') {
    autoUpdater.quitAndInstall(false, true)
    return state
  }
  if (state.phase !== 'available') {
    await checkForUpdates(getWindow)
  }
  if (state.phase === 'available') {
    setState({ phase: 'downloading', progressPct: 0 }, getWindow)
    await autoUpdater.downloadUpdate()
  }
  return state
}

export function registerUpdateIpc(getWindow: () => BrowserWindow | null): void {
  type IpcHandler = Parameters<typeof ipcMain.handle>[1]
  const handle = (channel: string, listener: IpcHandler) => {
    ipcMain.handle(channel, (event, ...args) => {
      const win = getWindow()
      if (!win || win.isDestroyed() || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) {
        throw new Error('Rejected IPC from an untrusted renderer.')
      }
      return listener(event, ...args)
    })
  }
  if (!updatesSupported) {
    handle('updates:getState', () => state)
    handle('updates:check', () => state)
    handle('updates:installLatest', () => state)
    return
  }

  if (builtInUpdatesSupported) {
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.allowDowngrade = false
    autoUpdater.allowPrerelease = false

    autoUpdater.on('checking-for-update', () => {
      setState({ phase: 'checking', message: undefined }, getWindow)
    })

    autoUpdater.on('update-available', (info) => {
      setState({ phase: 'available', ...cleanInfo(info), message: undefined }, getWindow)
    })

    autoUpdater.on('update-not-available', (info) => {
      setState({ phase: 'idle', ...cleanInfo(info), message: undefined, lastCheckedAt: Date.now() }, getWindow)
    })

    autoUpdater.on('download-progress', (progress: ProgressInfo) => {
      setState(
        {
          phase: 'downloading',
          progressPct: progress.percent,
          transferredBytes: progress.transferred,
          totalBytes: progress.total,
          bytesPerSecond: progress.bytesPerSecond,
        },
        getWindow,
      )
    })

    autoUpdater.on('update-downloaded', (info) => {
      setState({ phase: 'downloaded', ...cleanInfo(info), progressPct: 100 }, getWindow)
      if (installAfterDownload) {
        setTimeout(() => autoUpdater.quitAndInstall(false, true), 350)
      }
    })

    autoUpdater.on('error', (error) => {
      installAfterDownload = false
      setState({ phase: 'error', message: formatUpdateError(error) }, getWindow)
    })
  }

  handle('updates:getState', () => state)
  handle('updates:check', async () => {
    try {
      return await checkForUpdates(getWindow)
    } catch (error) {
      installAfterDownload = false
      return setState({ phase: 'error', message: formatUpdateError(error) }, getWindow)
    }
  })
  handle('updates:installLatest', async () => {
    try {
      return await installLatest(getWindow)
    } catch (error) {
      installAfterDownload = false
      return setState({ phase: 'error', message: formatUpdateError(error) }, getWindow)
    }
  })
}

export function scheduleInitialUpdateCheck(getWindow: () => BrowserWindow | null): void {
  if (!updatesSupported) return
  setTimeout(() => {
    void checkForUpdates(getWindow).catch((error) => {
      setState({ phase: 'error', message: formatUpdateError(error) }, getWindow)
    })
  }, 2500)
}
