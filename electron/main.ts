import { app, BrowserWindow, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { loadState } from './config.js'
import { registerIpc } from './ipc.js'
import { startTelemetry, stopTelemetry } from './telemetry.js'
import { unloadModel } from './llm.js'
import { registerUpdateIpc, scheduleInitialUpdateCheck } from './updates.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const isDevelopment = Boolean(process.env.VITE_DEV_SERVER_URL)

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

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
    startTelemetry((snapshot) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('telemetry:update', snapshot)
    })
    scheduleInitialUpdateCheck(() => mainWindow)
  })

  mainWindow.on('closed', () => {
    stopTelemetry()
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
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
  void unloadModel()
})
