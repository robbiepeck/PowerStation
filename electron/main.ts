import { app, BrowserWindow, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fixPath from 'fix-path'
import { loadState } from './config.js'
import { registerIpc } from './ipc.js'
import { startTelemetry, stopTelemetry } from './telemetry.js'
import { shutdown as shutdownLlm, getActiveRequestIds, stopChat } from './llm.js'
import { disconnectAll as disconnectMcp } from './mcp.js'
import { stopApiServer } from './apiServer.js'
import { registerUpdateIpc, scheduleInitialUpdateCheck } from './updates.js'

if (process.platform === 'darwin') fixPath()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const isDevelopment = Boolean(process.env.VITE_DEV_SERVER_URL)

function isSafeExternalUrl(url: string): boolean {
  try {
    return ['https:', 'http:', 'mailto:'].includes(new URL(url).protocol)
  } catch {
    return false
  }
}

let mainWindow: BrowserWindow | null = null

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
      preload: path.join(__dirname, 'preload.cjs'),
    },
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
    if (isSafeExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env.VITE_DEV_SERVER_URL
    if (devUrl && url.startsWith(devUrl)) return
    if (url.startsWith('file://')) return
    event.preventDefault()
    if (isSafeExternalUrl(url)) void shell.openExternal(url)
  })

  if (isDevelopment && process.env.VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.setAppUserModelId('com.powerstation.desktop')

void app.whenReady().then(async () => {
  await loadState()
  registerIpc(() => mainWindow)
  registerUpdateIpc(() => mainWindow)
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

app.on('before-quit', () => {
  stopTelemetry()
  shutdownLlm()
  void disconnectMcp()
  void stopApiServer()
})
