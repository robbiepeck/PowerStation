import { app, BrowserWindow, shell } from 'electron'
import { fileURLToPath, pathToFileURL } from 'node:url'
import os from 'node:os'
import path from 'node:path'
import fixPath from 'fix-path'
import { loadState } from './config.js'
import { registerIpc } from './ipc.js'
import { startTelemetry, stopTelemetry } from './telemetry.js'
import { shutdown as shutdownLlm, getActiveRequestIds, stopChat } from './llm.js'
import { disconnectAll as disconnectMcp } from './mcp.js'
import { stopApiServer } from './apiServer.js'
import { registerUpdateIpc, scheduleInitialUpdateCheck } from './updates.js'
import { startScheduler, stopScheduler } from './scheduledJobs.js'
import { isTrustedExternalUrl, isTrustedRendererNavigation, trustedLoopbackDevUrl } from './security.js'

if (process.platform === 'darwin') fixPath()
const smokeTest = app.commandLine.hasSwitch('powerstation-smoke-test')
if (process.env.POWERSTATION_TEST_USER_DATA && (!app.isPackaged || smokeTest)) {
  const requested = path.resolve(process.env.POWERSTATION_TEST_USER_DATA)
  const relativeToTemp = path.relative(path.resolve(os.tmpdir()), requested)
  if (app.isPackaged && (relativeToTemp === '' || relativeToTemp.startsWith('..') || path.isAbsolute(relativeToTemp))) {
    throw new Error('Packaged smoke-test profiles must be inside the operating system temporary directory.')
  }
  app.setPath('userData', requested)
}
if (!smokeTest && !app.requestSingleInstanceLock()) app.exit(0)

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const devServerUrl = trustedLoopbackDevUrl(process.env.VITE_DEV_SERVER_URL)?.toString() ?? null
const appEntryPath = path.join(__dirname, '../dist/index.html')
const appEntryUrl = pathToFileURL(appEntryPath).toString()

// Force Chromium's renderer sandbox for every window, including future windows
// that accidentally omit the per-window preference.
app.enableSandbox()

let mainWindow: BrowserWindow | null = null
let quitCleanupStarted = false

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 950,
    minWidth: 1100,
    minHeight: 760,
    backgroundColor: '#f7f9f8',
    title: 'PowerStation',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  })

  const session = mainWindow.webContents.session
  session.setPermissionCheckHandler((webContents, permission) =>
    permission === 'clipboard-sanitized-write' && webContents === mainWindow?.webContents,
  )
  session.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(permission === 'clipboard-sanitized-write' && webContents === mainWindow?.webContents)
  })

  let wasCritical = false
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
    startTelemetry((snapshot) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('telemetry:update', snapshot)

      const critical = snapshot.pressure.level === 'critical'
      if (critical && !wasCritical) {
        const active = getActiveRequestIds()
        if (active.length) {
          for (const requestId of active) stopChat(requestId)
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('runtime:event', {
              type: 'autopaused',
              message:
                'Generation was paused because your machine hit critical memory pressure. Close some apps, switch to a smaller model, or continue anyway.',
            })
          }
        }
      }
      wasCritical = critical
    })
    scheduleInitialUpdateCheck(() => mainWindow)
  })

  mainWindow.on('closed', () => {
    stopTelemetry()
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isTrustedExternalUrl(url)) void shell.openExternal(new URL(url).toString())
    return { action: 'deny' }
  })

  const guardNavigation = (event: Electron.Event, url: string) => {
    if (isTrustedRendererNavigation(url, appEntryUrl, devServerUrl)) return
    event.preventDefault()
    if (isTrustedExternalUrl(url)) void shell.openExternal(new URL(url).toString())
  }
  mainWindow.webContents.on('will-navigate', guardNavigation)
  mainWindow.webContents.on('will-redirect', guardNavigation)
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault())

  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl)
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    void mainWindow.loadFile(appEntryPath)
  }
}

app.on('second-instance', () => {
  if (!mainWindow || mainWindow.isDestroyed()) createMainWindow()
  else {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
})

app.setAppUserModelId('com.powerstation.desktop')

void app.whenReady().then(async () => {
  await loadState()
  registerIpc(() => mainWindow)
  registerUpdateIpc(() => mainWindow)
  await startScheduler()
  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', (event) => {
  event.preventDefault()
  if (quitCleanupStarted) return
  quitCleanupStarted = true
  stopTelemetry()
  stopScheduler()
  shutdownLlm()
  const forceExit = setTimeout(() => app.exit(0), 5_000)
  void Promise.allSettled([disconnectMcp(), stopApiServer()]).finally(() => {
    clearTimeout(forceExit)
    app.exit(0)
  })
})
