import { createRequire } from 'node:module'
import { app, ipcMain, type BrowserWindow } from 'electron'
import type { ProgressInfo, UpdateInfo } from 'electron-updater'

const require = createRequire(import.meta.url)
const { autoUpdater } = require('electron-updater') as typeof import('electron-updater')

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
  phase: app.isPackaged ? 'idle' : 'unsupported',
  currentVersion: app.getVersion(),
  message: app.isPackaged ? undefined : 'Updates are only available in packaged desktop builds.',
}
let installAfterDownload = false

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

async function checkForUpdates(getWindow: () => BrowserWindow | null): Promise<UpdateState> {
  if (!app.isPackaged) return setState({ phase: 'unsupported' }, getWindow)
  setState({ phase: 'checking', message: undefined }, getWindow)
  await autoUpdater.checkForUpdates()
  return state
}

async function installLatest(getWindow: () => BrowserWindow | null): Promise<UpdateState> {
  if (!app.isPackaged) return setState({ phase: 'unsupported' }, getWindow)

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
    setState({ phase: 'error', message: error.message || String(error) }, getWindow)
  })

  ipcMain.handle('updates:getState', () => state)
  ipcMain.handle('updates:check', () => checkForUpdates(getWindow))
  ipcMain.handle('updates:installLatest', () => installLatest(getWindow))
}

export function scheduleInitialUpdateCheck(getWindow: () => BrowserWindow | null): void {
  if (!app.isPackaged) return
  setTimeout(() => {
    void checkForUpdates(getWindow).catch((error) => {
      setState({ phase: 'error', message: error instanceof Error ? error.message : String(error) }, getWindow)
    })
  }, 2500)
}
