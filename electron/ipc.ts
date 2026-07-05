import path from 'node:path'
import { ipcMain, dialog, shell, type BrowserWindow } from 'electron'
import * as models from './models.js'
import * as llm from './llm.js'
import * as mcp from './mcp.js'
import * as agent from './agent.js'
import { getDeviceHealthProfile } from './device.js'
import { getCatalog, refreshCatalog, type CatalogModel } from './catalog.js'
import { recommendModels, type Intent } from './recommend.js'
import { getHardwareProfile } from './hardware.js'
import { admittedContextTokens, checkFit, OFFLOAD_RAM_FRACTION, USABLE_BUDGET_FRACTION } from './admission.js'
import { getState, mutate, patchSettings, managedModelsDir, type Settings, type ToolPermission } from './config.js'

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
    // Path-boundary check: a bare prefix would also match /robbiepeck/PowerStation-evil.
    return (
      parsed.hostname === 'github.com' &&
      (parsed.pathname === '/robbiepeck/PowerStation' || parsed.pathname.startsWith('/robbiepeck/PowerStation/'))
    )
  } catch {
    return false
  }
}

// One home for the capability heuristic: catalog tier wins; otherwise the
// GGUF's own chat template is the best signal for tool training. Geometry
// alone is NOT evidence — every valid transformer GGUF has geometry.
function resolveToolTier(info: { templateSupportsTools: boolean | null } | null, entry: CatalogModel | null) {
  if (entry) return entry.toolCalling
  return info?.templateSupportsTools ? ('single' as const) : ('none' as const)
}

async function findCatalogEntryForModel(modelPath: string): Promise<CatalogModel | null> {
  const fileName = path.basename(modelPath).toLowerCase()
  const catalog = await getCatalog()
  return catalog.models.find((entry) => entry.fileName.toLowerCase() === fileName) ?? null
}

async function getGpuBudgetBytes(): Promise<number> {
  const device = await llm.getDeviceInfo().catch(() => null)
  if (device?.vram && device.vram.total > 0) return device.vram.total
  const profile = await getHardwareProfile()
  return profile.gpuBudgetBytes
}

async function getOffloadCeilingBytes(): Promise<number> {
  const profile = await getHardwareProfile()
  return Math.round(profile.totalRamBytes * OFFLOAD_RAM_FRACTION)
}

/** Reconnect/disconnect MCP servers so connections mirror the settings. */
async function reconcileMcpServers(): Promise<void> {
  const state = await getState()
  const wanted = new Map(state.settings.utilities.mcpServers.filter((server) => server.enabled).map((s) => [s.id, s]))
  const statuses = new Map(mcp.getMcpStatuses().map((status) => [status.id, status.state]))
  for (const [id, serverState] of statuses) {
    if (!wanted.has(id) && (serverState === 'connected' || serverState === 'connecting')) {
      await mcp.disconnectServer(id)
    }
  }
  for (const [id, config] of wanted) {
    const serverState = statuses.get(id)
    // Never auto-retry a failed server — that turns every settings change into
    // a child-process spawn. Errors retry via the explicit reconnect button or
    // by toggling the server off and on.
    if (serverState === 'connected' || serverState === 'connecting' || serverState === 'error') continue
    void mcp.connectServer(config)
  }
}

export function registerIpc(getWindow: () => BrowserWindow | null): void {
  const send = (channel: string, payload: unknown) => {
    const win = getWindow()
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
  }

  // --- Agent/runtime event wiring -------------------------------------------
  llm.setToolExecutor(agent.executeToolCall)
  llm.onRuntimeEvent((event) => send('runtime:event', event))
  agent.setPermissionRequester((request) => send('agent:permissionRequest', request))
  agent.setPermissionExpiredNotifier((promptId) => send('agent:permissionExpired', { promptId }))
  agent.setToolResultReporter((event) => send('chat:toolResult', event))
  mcp.onMcpStatusChange((statuses) => send('mcp:status', statuses))
  void reconcileMcpServers()

  // --- Models ---------------------------------------------------------------
  // Each model is enriched with its resolved tool-calling tier so the renderer
  // never re-implements the capability heuristic.
  ipcMain.handle('models:list', async () => {
    const [list, catalog] = await Promise.all([models.listModels(), getCatalog()])
    return list.map((model) => ({
      ...model,
      toolCalling: resolveToolTier(
        model,
        catalog.models.find((entry) => entry.fileName.toLowerCase() === model.fileName.toLowerCase()) ?? null,
      ),
    }))
  })
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

  // --- Hardware, catalog, recommendations ------------------------------------
  ipcMain.handle('hardware:profile', async () => {
    const device = await llm.getDeviceInfo().catch(() => null)
    const profile = await getHardwareProfile(device?.vram?.total ?? null)
    // One canonical "usable for AI" number, shared with the fit math, so the
    // onboarding reveal and every fit summary quote the same figure.
    return { ...profile, usableBudgetBytes: Math.round(profile.gpuBudgetBytes * USABLE_BUDGET_FRACTION) }
  })

  ipcMain.handle('catalog:get', () => getCatalog())
  ipcMain.handle('catalog:refresh', () => refreshCatalog())

  ipcMain.handle('catalog:recommend', async (_event, intent: Intent) => {
    const [catalog, profile, budget] = await Promise.all([getCatalog(), getHardwareProfile(), getGpuBudgetBytes()])
    return recommendModels({
      catalog: catalog.models,
      intent,
      totalRamBytes: profile.totalRamBytes,
      gpuBudgetBytes: budget,
      freeDiskBytes: profile.freeDiskBytes,
    })
  })

  // Fit report for a catalog entry or a local model file, used by the UI to
  // show honest "will this fit" guidance before download or load.
  ipcMain.handle('fit:check', async (_event, payload: { catalogId?: string; modelPath?: string; contextTokens?: number }) => {
    const state = await getState()
    const contextTokens = payload.contextTokens ?? state.settings.contextTokens
    const [budget, offloadCeilingBytes] = await Promise.all([getGpuBudgetBytes(), getOffloadCeilingBytes()])
    if (payload.catalogId) {
      const catalog = await getCatalog()
      const entry = catalog.models.find((model) => model.id === payload.catalogId)
      if (!entry) return null
      return checkFit({
        weightsBytes: entry.sizeBytes,
        geometry: entry.geometry,
        kvBytesPerToken: entry.kvBytesPerToken,
        contextTokens: Math.min(contextTokens, entry.maxContext ?? contextTokens),
        budgetBytes: budget,
        offloadCeilingBytes,
      })
    }
    if (payload.modelPath) {
      const info = await models.getModelInfo(payload.modelPath)
      if (!info) return null
      const entry = await findCatalogEntryForModel(payload.modelPath)
      return checkFit({
        // The catalog total wins for multi-part models where the local stat
        // may undercount; the larger of the two is the safe estimate.
        weightsBytes: Math.max(info.sizeBytes, entry?.sizeBytes ?? 0),
        geometry: info.geometry,
        kvBytesPerToken: entry?.kvBytesPerToken ?? null,
        contextTokens,
        budgetBytes: budget,
        offloadCeilingBytes,
      })
    }
    return null
  })

  // --- Onboarding -------------------------------------------------------------
  ipcMain.handle('onboarding:get', async () => (await getState()).onboarding)
  ipcMain.handle('onboarding:complete', async (_event, payload: { useCase?: string; priority?: string }) => {
    const state = await mutate((current) => {
      current.onboarding = {
        completed: true,
        useCase: typeof payload?.useCase === 'string' ? payload.useCase.slice(0, 40) : current.onboarding.useCase,
        priority: typeof payload?.priority === 'string' ? payload.priority.slice(0, 40) : current.onboarding.priority,
      }
    })
    return state.onboarding
  })

  // --- MCP & permissions -------------------------------------------------------
  ipcMain.handle('mcp:statuses', () => mcp.getMcpStatuses())
  ipcMain.handle('mcp:toolInfo', async () => {
    const state = await getState()
    return {
      tools: mcp.getConnectedTools(),
      schemaTokens: agent.estimateToolSchemaTokens(),
      contextTokens: state.settings.contextTokens,
    }
  })
  ipcMain.handle('mcp:reconnect', async (_event, serverId: string) => {
    const state = await getState()
    const config = state.settings.utilities.mcpServers.find((server) => server.id === serverId)
    if (!config) return null
    return mcp.connectServer(config)
  })

  ipcMain.handle('permissions:get', async () => (await getState()).toolPermissions)
  ipcMain.handle('permissions:set', async (_event, payload: { toolKey: string; permission: ToolPermission }) => {
    if (!payload || typeof payload.toolKey !== 'string') return false
    if (!['allow', 'ask', 'deny'].includes(payload.permission)) return false
    await agent.setToolPermission(payload.toolKey.slice(0, 200), payload.permission)
    return true
  })

  ipcMain.handle('agent:permissionResponse', (_event, payload: { promptId: string; decision: string }) => {
    if (!payload || typeof payload.promptId !== 'string') return false
    const decision = ['allow-once', 'allow-always', 'deny'].includes(payload.decision)
      ? (payload.decision as agent.PermissionDecision)
      : 'deny'
    return agent.resolvePermission(payload.promptId, decision)
  })

  // --- Settings & device ----------------------------------------------------
  ipcMain.handle('settings:get', async () => (await getState()).settings)
  ipcMain.handle('settings:update', async (_event, patch: Partial<Settings>) => {
    const before = JSON.stringify((await getState()).settings.utilities.mcpServers)
    const settings = await patchSettings(patch)
    // Only touch MCP connections when the server list itself changed —
    // settings:update fires on every keystroke of unrelated fields.
    if (JSON.stringify(settings.utilities.mcpServers) !== before) void reconcileMcpServers()
    return settings
  })
  ipcMain.handle('device:info', async () => {
    const info = await llm.getDeviceInfo()
    return { ...info, health: await getDeviceHealthProfile(info.gpuNames) }
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
        // Admission control: verify the model + requested context fit BEFORE
        // asking the worker to load anything, and shrink the context if that
        // is what it takes to stay safe.
        const [info, entry, budget, offloadCeilingBytes] = await Promise.all([
          models.getModelInfo(modelPath),
          findCatalogEntryForModel(modelPath),
          getGpuBudgetBytes(),
          getOffloadCeilingBytes(),
        ])
        const fitRequest = {
          weightsBytes: Math.max(info?.sizeBytes ?? 0, entry?.sizeBytes ?? 0),
          geometry: info?.geometry ?? entry?.geometry ?? null,
          kvBytesPerToken: entry?.kvBytesPerToken ?? null,
          contextTokens: state.settings.contextTokens,
          budgetBytes: budget,
          offloadCeilingBytes,
        }
        const fit = checkFit(fitRequest)
        if (!fit.fits && fit.maxComfortableContext === null) {
          send('chat:error', {
            requestId,
            message: `${fit.summary} ${fit.suggestions.join(' ')}`,
          })
          return
        }
        const contextTokens = admittedContextTokens(fitRequest)

        // Agent tools: only register them for models that can actually use
        // them — an untrained model flailing at tool calls reads as a broken
        // app, not a limited model.
        const tier = resolveToolTier(info, entry)
        const toolDefinitions = tier === 'none' ? [] : agent.getAgentToolDefinitions()
        const maxToolCalls = tier === 'multi' ? 15 : 3

        send('chat:admission', {
          requestId,
          contextTokens,
          verdict: fit.verdict,
          summary: fit.summary,
          toolCount: toolDefinitions.length,
          schemaTokens: agent.estimateToolSchemaTokens(toolDefinitions),
        })

        const result = await llm.chat({
          requestId,
          modelPath,
          prompt,
          systemPrompt: state.settings.utilities.systemPrompt || undefined,
          contextTokens,
          temperature: state.settings.temperature,
          maxTokens: state.settings.maxTokens,
          tools: toolDefinitions.length ? toolDefinitions : undefined,
          maxToolCalls,
          onToken: (token) => send('chat:token', { requestId, token }),
          onStatus: (status) => send('chat:status', { requestId, ...status }),
          onToolCall: (toolKey, args) => send('chat:toolCall', { requestId, toolKey, args }),
        })
        send('chat:done', {
          requestId,
          text: result.text,
          tokensPerSec: result.tokensPerSec,
          aborted: result.aborted,
          toolCallCount: result.toolCallCount,
          haltReason: result.haltReason,
        })
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
