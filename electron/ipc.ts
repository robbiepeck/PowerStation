import path from 'node:path'
import { ipcMain, dialog, shell, type BrowserWindow } from 'electron'
import * as models from './models.js'
import * as llm from './llm.js'
import { getDeviceHealthProfile } from './device.js'
import { analyzeStorage, isWithinScannedRoots } from './storage.js'
import { getState, patchSettings, managedModelsDir, type Settings } from './config.js'

// Model downloads come from a free-text field, so constrain them to the schemes
// the app actually supports (Hugging Face shorthand or a direct HTTPS GGUF URL)
// and reject things like file:, ftp:, or custom protocol handlers.
function isAllowedModelUri(uri: string): boolean {
  if (typeof uri !== 'string') return false
  const trimmed = uri.trim()
  if (/^hf:/i.test(trimmed)) return true
  try {
    return new URL(trimmed).protocol === 'https:'
  } catch {
    return false
  }
}

function isTrustedExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return false
    if (parsed.hostname === 'huggingface.co') return true
    return parsed.hostname === 'github.com' && parsed.pathname.startsWith('/robbiepeck/PowerStation/releases')
  } catch {
    return false
  }
}

export function registerIpc(getWindow: () => BrowserWindow | null): void {
  const send = (channel: string, payload: unknown) => {
    const win = getWindow()
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
  }

  // --- Models ---------------------------------------------------------------
  ipcMain.handle('models:list', () => models.listModels())
  ipcMain.handle('models:getSelected', async () => (await getState()).selectedModelPath)
  ipcMain.handle('models:select', (_event, filePath: string | null) => models.selectModel(filePath))
  ipcMain.handle('models:remove', (_event, filePath: string) => models.removeImported(filePath))
  ipcMain.handle('models:deleteFile', (_event, filePath: string) => models.deleteModelFile(filePath))
  ipcMain.handle('models:reveal', async (_event, filePath: string) => {
    if (!(await models.isKnownModelPath(filePath))) return false
    shell.showItemInFolder(path.resolve(filePath))
    return true
  })

  ipcMain.handle('models:pickFile', async () => {
    const win = getWindow()
    if (!win) return models.listModels()
    const result = await dialog.showOpenDialog(win, {
      title: 'Add a GGUF model',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'GGUF model', extensions: ['gguf'] }],
    })
    if (!result.canceled) {
      for (const filePath of result.filePaths) await models.importModelFile(filePath)
    }
    return models.listModels()
  })

  ipcMain.handle('models:pickFolder', async () => {
    const win = getWindow()
    if (!win) return models.listModels()
    const result = await dialog.showOpenDialog(win, {
      title: 'Add a folder of GGUF models',
      properties: ['openDirectory'],
    })
    if (!result.canceled) {
      for (const dir of result.filePaths) await models.addModelFolder(dir)
    }
    return models.listModels()
  })

  ipcMain.handle('models:download', (_event, uri: string) => {
    const id = `dl-${Date.now()}`
    void (async () => {
      try {
        if (!isAllowedModelUri(uri)) {
          throw new Error('Only Hugging Face (hf:) or HTTPS GGUF URLs can be downloaded.')
        }
        const filePath = await llm.downloadModel({
          uri,
          dirPath: managedModelsDir(),
          onProgress: ({ totalSize, downloadedSize }) => send('models:downloadProgress', { id, totalSize, downloadedSize }),
        })
        await models.importModelFile(filePath)
        send('models:downloadDone', { id, filePath })
      } catch (error) {
        send('models:downloadError', { id, message: error instanceof Error ? error.message : String(error) })
      }
    })()
    return id
  })

  ipcMain.handle('app:openExternal', async (_event, url: string) => {
    if (!isTrustedExternalUrl(url)) {
      throw new Error('PowerStation can only open trusted external pages.')
    }
    await shell.openExternal(new URL(url).toString())
    return true
  })

  // --- Settings & device ----------------------------------------------------
  ipcMain.handle('settings:get', async () => (await getState()).settings)
  ipcMain.handle('settings:update', (_event, patch: Partial<Settings>) => patchSettings(patch))
  ipcMain.handle('device:info', async () => {
    const info = await llm.getDeviceInfo()
    return { ...info, health: await getDeviceHealthProfile(info.gpuNames) }
  })
  ipcMain.handle('storage:analyze', () => analyzeStorage())
  ipcMain.handle('storage:reveal', (_event, filePath: string) => {
    if (!isWithinScannedRoots(filePath)) return false
    shell.showItemInFolder(path.resolve(filePath))
    return true
  })

  // --- Chat -----------------------------------------------------------------
  ipcMain.handle('chat:send', async (_event, payload: { requestId: string; prompt: string }) => {
    const { requestId, prompt } = payload
    const state = await getState()
    const modelPath = state.selectedModelPath
    if (!modelPath) {
      send('chat:error', { requestId, message: 'No model selected. Add and select a model first.' })
      return { requestId, ok: false }
    }
    void (async () => {
      try {
        const result = await llm.chat({
          requestId,
          modelPath,
          prompt,
          contextTokens: state.settings.contextTokens,
          temperature: state.settings.temperature,
          maxTokens: state.settings.maxTokens,
          onToken: (token) => send('chat:token', { requestId, token }),
          onStatus: (status) => send('chat:status', { requestId, ...status }),
        })
        send('chat:done', { requestId, text: result.text, tokensPerSec: result.tokensPerSec, aborted: result.aborted })
      } catch (error) {
        send('chat:error', { requestId, message: error instanceof Error ? error.message : String(error) })
      }
    })()
    return { requestId, ok: true }
  })

  ipcMain.handle('chat:stop', (_event, requestId: string) => llm.stopChat(requestId))
  ipcMain.handle('chat:reset', () => llm.resetChat())
  ipcMain.handle('chat:unload', () => llm.unloadModel())
}
