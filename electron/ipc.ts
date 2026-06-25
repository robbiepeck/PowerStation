import { ipcMain, dialog, shell, type BrowserWindow } from 'electron'
import * as models from './models.js'
import * as llm from './llm.js'
import { getState, patchSettings, managedModelsDir, type Settings } from './config.js'

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
  ipcMain.handle('models:reveal', (_event, filePath: string) => {
    shell.showItemInFolder(filePath)
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
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'huggingface.co') {
      throw new Error('PowerStation can only open trusted HTTPS model pages.')
    }
    await shell.openExternal(parsed.toString())
    return true
  })

  // --- Settings & device ----------------------------------------------------
  ipcMain.handle('settings:get', async () => (await getState()).settings)
  ipcMain.handle('settings:update', (_event, patch: Partial<Settings>) => patchSettings(patch))
  ipcMain.handle('device:info', () => llm.getDeviceInfo())

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
