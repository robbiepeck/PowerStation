import path from 'node:path'
import { app, ipcMain, dialog, shell, type BrowserWindow } from 'electron'
import * as models from './models.js'
import * as llm from './llm.js'
import * as mcp from './mcp.js'
import * as agent from './agent.js'
import * as chats from './chats.js'
import * as skills from './skills.js'
import * as ollama from './ollama.js'
import * as lmstudio from './lmstudio.js'
import * as projects from './projects.js'
import * as backup from './backup.js'
import * as repair from './repair.js'
import * as customAgents from './customAgents.js'
import * as apiServer from './apiServer.js'
import { REPAIR_SKILL_SLUG } from './builtinTools.js'
import * as rag from './rag.js'
import { extractFile, TEXT_EXTENSIONS } from './files.js'
import { composeSystemPrompt } from './skillFormat.js'
import { getDeviceHealthProfile } from './device.js'
import {
  getCatalog,
  refreshCatalog,
  getConnectorCatalog,
  refreshConnectorCatalog,
  getSkillCatalog,
  refreshSkillCatalog,
  type CatalogModel,
  type ConnectorEntry,
} from './catalog.js'
import { promises as fs } from 'node:fs'
import { recommendModels, type Intent } from './recommend.js'
import { getHardwareProfile } from './hardware.js'
import { admittedContextTokens, checkFit, OFFLOAD_RAM_FRACTION, USABLE_BUDGET_FRACTION } from './admission.js'
import {
  getState,
  mutate,
  patchSettings,
  managedModelsDir,
  type BenchmarkRecord,
  type Settings,
  type ToolPermission,
} from './config.js'
import { isAllowedModelUri, isPathInside, isTrustedExternalUrl } from './security.js'
import { showSecurityPrompt } from './confirm.js'
import { quoteCommandArg } from './mcpCommand.js'
import { requiredModelDownloadSpace } from './downloadCapacity.js'

function resolveToolTier(info: { templateSupportsTools: boolean | null } | null, entry: CatalogModel | null) {
  if (entry) return entry.toolCalling
  return info?.templateSupportsTools ? ('single' as const) : ('none' as const)
}

async function findCatalogEntryForModel(modelPath: string): Promise<CatalogModel | null> {
  const fileName = path.basename(modelPath).toLowerCase()
  const catalog = await getCatalog()
  return catalog.models.find((entry) => entry.fileName.toLowerCase() === fileName) ?? null
}

async function assertModelDownloadCapacity(uri: string, destination: string): Promise<void> {
  const catalog = await getCatalog()
  const entry = catalog.models.find((model) => model.downloadUrl === uri)
  if (!entry) return

  await fs.mkdir(destination, { recursive: true, mode: 0o700 })
  const existingSize = await fs
    .stat(path.join(destination, entry.fileName))
    .then((stat) => (stat.isFile() ? stat.size : 0))
    .catch(() => 0)
  const filesystem = await fs.statfs(destination)
  const availableBytes = filesystem.bavail * filesystem.bsize
  const requiredBytes = requiredModelDownloadSpace(entry.sizeBytes, existingSize)
  if (availableBytes < requiredBytes) {
    const requiredGb = (requiredBytes / 1e9).toFixed(1)
    const availableGb = (availableBytes / 1e9).toFixed(1)
    throw new Error(`Not enough free disk space. This download needs ${requiredGb} GB including safety headroom; ${availableGb} GB is available.`)
  }
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

async function getEffectiveSystemPrompt(
  message?: string,
  agentId?: string,
): Promise<{ prompt: string | undefined; skillNames: string[]; skillSlugs: string[] }> {
  const state = await getState()
  const project = await projects.getActiveProject()
  const agent = agentId ? await customAgents.getAgent(agentId) : null

  const base = [state.settings.utilities.systemPrompt, project?.instructions ?? '', agent?.instructions ?? '']
    .map((part) => part.trim())
    .filter(Boolean)
    .join('\n\n')
  const active = await skills.getActiveSkills(message, project?.skillModes)
  const composed = composeSystemPrompt(base, active)
  return {
    prompt: composed || undefined,
    skillNames: active.map((skill) => skill.name),
    skillSlugs: active.map((skill) => skill.slug),
  }
}

async function runModelBenchmark(modelPath: string): Promise<BenchmarkRecord> {
  if (llm.getActiveRequestIds().length > 0) {
    throw new Error('A generation is running — benchmark when the chat is idle.')
  }
  const state = await getState()
  const [info, entry, budget, offloadCeilingBytes] = await Promise.all([
    models.getModelInfo(modelPath),
    findCatalogEntryForModel(modelPath),
    getGpuBudgetBytes(),
    getOffloadCeilingBytes(),
  ])
  if (!info) throw new Error('Model file not found.')
  const fitRequest = {
    weightsBytes: Math.max(info.sizeBytes, entry?.sizeBytes ?? 0),
    geometry: info.geometry ?? entry?.geometry ?? null,
    kvBytesPerToken: entry?.kvBytesPerToken ?? null,
    contextTokens: state.settings.contextTokens,
    budgetBytes: budget,
    offloadCeilingBytes,
  }
  const fit = checkFit(fitRequest)
  if (!fit.fits && fit.maxComfortableContext === null) throw new Error(fit.summary)
  const contextTokens = admittedContextTokens(fitRequest)

  const result = await llm.runBenchmark({
    modelPath,
    contextTokens,

    systemPrompt: (await getEffectiveSystemPrompt()).prompt,
  })
  const record: BenchmarkRecord = {
    tokensPerSec: Math.round(result.tokensPerSec * 10) / 10,
    promptTokensPerSec: Math.round(result.promptTokensPerSec),
    outputTokens: result.outputTokens,
    contextTokens,
    measuredAt: Date.now(),
  }
  await mutate((current) => {
    current.benchmarks[path.basename(modelPath).toLowerCase()] = record
  })
  return record
}

let activeAgentId: string | null = null
let downloadActive = false
const MAX_MODEL_DOWNLOAD_BYTES = 256 * 1024 ** 3
let mainWindowGetter: () => BrowserWindow | null = () => null

async function reconcileMcpServers(): Promise<void> {
  const state = await getState()
  const project = await projects.getActiveProject()
  const agent = activeAgentId ? await customAgents.getAgent(activeAgentId) : null

  const scopeIds = agent?.mcpServerIds.length ? agent.mcpServerIds : project ? project.mcpServerIds : null
  const wanted = new Map(
    state.settings.utilities.mcpServers
      .filter((server) => (scopeIds ? scopeIds.includes(server.id) : server.enabled))
      .map((s) => [s.id, s]),
  )
  const statuses = new Map(mcp.getMcpStatuses().map((status) => [status.id, status.state]))
  for (const [id, serverState] of statuses) {
    if (!wanted.has(id) && (serverState === 'connected' || serverState === 'connecting')) {
      await mcp.disconnectServer(id)
    }
  }
  for (const [id, config] of wanted) {
    const serverState = statuses.get(id)

    if (serverState === 'connected' || serverState === 'connecting') {
      const activeConfig = mcp.getServerConfig(id)
      if (activeConfig?.name === config.name && activeConfig.command === config.command) continue
      await mcp.disconnectServer(id)
    }
    if (serverState === 'error') continue
    const response = await showSecurityPrompt(mainWindowGetter(), {
      message: `Run the MCP server “${config.name}”?`,
      detail: `${config.command}\n\nThis starts a process with your user-account permissions. Review the command carefully.`,
      buttons: ['Cancel', 'Run server'],
      cancelId: 0,
    })
    if (response === 1) void mcp.connectServer(config)
  }
}

export function registerIpc(getWindow: () => BrowserWindow | null): void {
  mainWindowGetter = getWindow
  type IpcHandler = Parameters<typeof ipcMain.handle>[1]
  const handle = (channel: string, listener: IpcHandler) => {
    ipcMain.handle(channel, (event, ...args) => {
      const win = getWindow()
      if (
        !win ||
        win.isDestroyed() ||
        event.sender !== win.webContents ||
        event.senderFrame !== win.webContents.mainFrame
      ) {
        throw new Error('Rejected IPC from an untrusted renderer.')
      }
      return listener(event, ...args)
    })
  }

  const send = (channel: string, payload: unknown) => {
    const win = getWindow()
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
  }
  // Paths are capabilities granted by a native file/folder picker. Renderer-
  // supplied absolute paths are never trusted on their own.
  const approvedAttachmentPaths = new Set<string>()
  const approvedFolders = new Set<string>()
  const rememberFolder = (folder: string) => {
    if (approvedFolders.size >= 32) approvedFolders.clear()
    approvedFolders.add(path.resolve(folder))
  }
  const isApprovedFolder = async (folder: string): Promise<boolean> => {
    const resolved = path.resolve(folder)
    if (approvedFolders.has(resolved)) return true
    const project = await projects.getActiveProject()
    if (project?.knowledge && path.resolve(project.knowledge.folder) === resolved) return true
    const agent = activeAgentId ? await customAgents.getAgent(activeAgentId) : null
    return Boolean(agent?.knowledge.some((item) => path.resolve(item.folder) === resolved))
  }

  llm.setToolExecutor(agent.executeToolCall)
  llm.onRuntimeEvent((event) => send('runtime:event', event))
  agent.setPermissionRequester(async (request) => {
    const args = (() => {
      try {
        return JSON.stringify(request.args, null, 2).slice(0, 1800)
      } catch {
        return String(request.args).slice(0, 1800)
      }
    })()
    const preview = request.preview
    const previewText =
      preview?.kind === 'diff'
        ? `${preview.newFile ? 'Create' : 'Modify'} ${preview.path} (+${preview.summary.added}/-${preview.summary.removed})${preview.note ? `\n${preview.note}` : ''}`
        : preview?.kind === 'move'
          ? `Move ${preview.from} to ${preview.to}`
          : preview?.kind === 'note'
            ? `${preview.title}\n${preview.body}`
            : ''
    const response = await showSecurityPrompt(getWindow(), {
      message: `Allow ${request.toolName} from ${request.serverName}?`,
      detail: [previewText, args, 'Tools run with your operating-system permissions.'].filter(Boolean).join('\n\n'),
      buttons: ['Deny', 'Allow once', 'Allow this turn', 'Always allow'],
      cancelId: 0,
    })
    return response === 3 ? 'allow-always' : response === 2 ? 'allow-turn' : response === 1 ? 'allow-once' : 'deny'
  })
  agent.setPlanRequester(async (request) => {
    const response = await showSecurityPrompt(getWindow(), {
      message: 'Approve this tool plan?',
      detail: `${request.plan.slice(0, 4000)}\n\nThe model will still request each tool call individually.`,
      buttons: ['Deny', 'Approve plan'],
      cancelId: 0,
    })
    return response === 1
  })
  agent.setToolResultReporter((event) => send('chat:toolResult', event))
  apiServer.setApiLogListener((entry) => send('api:request', entry))
  apiServer.setApiStatusListener(() => void apiServer.getApiStatus().then((s) => send('api:status', s)))

  void apiServer.syncApiServer()
  mcp.onMcpStatusChange((statuses) => send('mcp:status', statuses))
  void reconcileMcpServers()

  handle('models:list', async () => {
    const [list, catalog, state] = await Promise.all([models.listModels(), getCatalog(), getState()])
    return list.map((model) => ({
      ...model,
      toolCalling: resolveToolTier(
        model,
        catalog.models.find((entry) => entry.fileName.toLowerCase() === model.fileName.toLowerCase()) ?? null,
      ),
      measuredTps: state.benchmarks[model.fileName.toLowerCase()]?.tokensPerSec ?? null,
    }))
  })
  handle('models:getSelected', async () => (await getState()).selectedModelPath)
  handle('models:select', async (_event, filePath: string | null) => {
    if (filePath !== null && (typeof filePath !== 'string' || !(await models.isKnownModelPath(filePath)))) {
      throw new Error('Unknown model path.')
    }
    return models.selectModel(filePath)
  })
  handle('models:remove', (_event, filePath: string) => models.removeImported(filePath))
  handle('models:deleteFile', async (_event, filePath: string) => {

    const loaded = llm.getLoadedPath()
    if (loaded && path.resolve(loaded) === path.resolve(filePath)) await llm.unloadModel().catch(() => undefined)
    return models.deleteModelFile(filePath)
  })
  handle('models:reveal', async (_event, filePath: string) => {
    if (!(await models.isKnownModelPath(filePath))) return false
    shell.showItemInFolder(path.resolve(filePath))
    return true
  })

  handle('models:pickFile', async () => {
    const win = getWindow()
    if (!win) return models.listModels()
    const result = await dialog.showOpenDialog(win, {
      title: 'Add a GGUF model',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'GGUF model', extensions: ['gguf'] }],
    })
    if (!result.canceled) {
      for (const filePath of result.filePaths) {
        if (!filePath.toLowerCase().endsWith('.gguf')) throw new Error('Only GGUF model files can be imported.')
        await models.importModelFile(filePath)
      }
    }
    return models.listModels()
  })

  handle('models:pickFolder', async () => {
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

  handle('models:download', async (_event, uri: string) => {
    if (!isAllowedModelUri(uri)) {
      throw new Error('Only Hugging Face GGUF downloads (hf: or huggingface.co) are allowed.')
    }
    if (downloadActive) throw new Error('A model download is already running.')
    const normalizedUri = uri.trim()
    const destination = managedModelsDir()
    await assertModelDownloadCapacity(normalizedUri, destination)
    const confirmation = await showSecurityPrompt(getWindow(), {
      message: 'Download this model?',
      detail: `${normalizedUri}\n\nDownloaded model files are parsed by the local native runtime. Only download models you trust.`,
      buttons: ['Cancel', 'Download'],
      cancelId: 0,
    })
    if (confirmation !== 1) throw new Error('Download cancelled.')
    const id = `dl-${Date.now()}`
    downloadActive = true
    void (async () => {
      try {
        if (!isAllowedModelUri(uri)) {
          throw new Error('Only Hugging Face (hf:) or HTTPS GGUF URLs can be downloaded.')
        }
        const filePath = await llm.downloadModel({
          uri: normalizedUri,
          dirPath: destination,
          onProgress: ({ totalSize, downloadedSize }) => {
            if (totalSize > MAX_MODEL_DOWNLOAD_BYTES || downloadedSize > MAX_MODEL_DOWNLOAD_BYTES) {
              throw new Error('Model download exceeds the 256 GB safety limit.')
            }
            send('models:downloadProgress', { id, totalSize, downloadedSize })
          },
        })
        const [realDestination, realFile] = await Promise.all([fs.realpath(destination), fs.realpath(filePath)])
        if (!isPathInside(realDestination, realFile) || !realFile.toLowerCase().endsWith('.gguf')) {
          throw new Error('Downloaded model resolved outside the managed model folder or was not a GGUF file.')
        }
        await models.importModelFile(realFile)

        try {
          send('models:benchmarking', { id, filePath: realFile })
          await runModelBenchmark(realFile)
        } catch {
          void 0
        }
        send('models:downloadDone', { id, filePath: realFile })
      } catch (error) {
        send('models:downloadError', { id, message: error instanceof Error ? error.message : String(error) })
      } finally {
        downloadActive = false
      }
    })()
    return id
  })

  handle('ollama:status', () => ollama.getOllamaStatus())
  handle('ollama:import', async (_event, name: string) => {

    const model = await ollama.resolveOllamaModel(name)
    if (!model) throw new Error('That model was not found in Ollama.')
    await models.importModelFile(model.blobPath)
    return model.blobPath
  })

  handle('lmstudio:status', () => lmstudio.getLmStudioStatus())
  handle('lmstudio:import', async (_event, filePath: string) => {

    const model = await lmstudio.resolveLmStudioModel(filePath)
    if (!model) throw new Error('That model was not found in LM Studio.')
    await models.importModelFile(model.path)
    return model.path
  })

  handle('bench:run', async (_event, modelPath: string) => {
    if (typeof modelPath !== 'string' || !(await models.isKnownModelPath(modelPath))) {
      throw new Error('Unknown model path.')
    }
    return runModelBenchmark(modelPath)
  })
  handle('bench:results', async () => (await getState()).benchmarks)

  const chatScope = (scope: unknown): chats.ChatScope => {
    if (typeof scope !== 'object' || scope === null || !('projectId' in scope)) return undefined
    const projectId = (scope as { projectId: unknown }).projectId
    return { projectId: typeof projectId === 'string' ? projectId : null }
  }
  handle('chats:list', (_event, scope?: unknown) => chats.listChats(chatScope(scope)))
  handle('chats:get', (_event, id: string) => chats.getChat(id))
  handle('chats:save', async (_event, payload: { id?: string; messages: unknown; modelPath?: string }) => {
    const state = await getState()
    if (!state.settings.saveChats) return null
    return chats.saveChat(payload ?? { messages: [] })
  })
  handle('chats:rename', (_event, id: string, title: string) => chats.renameChat(id, title))
  handle('chats:pin', (_event, id: string, pinned: boolean) => chats.setChatPinned(id, pinned))
  handle('chats:delete', (_event, id: string) => chats.deleteChat(id))
  handle('chats:deleteAll', () => chats.deleteAllChats())
  handle('chats:reveal', () => chats.revealChatsDir())
  handle('chats:search', (_event, query: string, scope?: unknown) => chats.searchChats(query, chatScope(scope)))
  handle('chats:exportAudit', async (_event, id: string) => {
    const chat = await chats.getChat(id)
    if (!chat) return null
    const records = chats.collectAuditLog(chat)
    const result = await dialog.showSaveDialog({
      defaultPath: `${chat.title.replace(/[\\/:*?"<>|]/g, '-').slice(0, 50)}-audit.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (result.canceled || !result.filePath) return null
    await fs.writeFile(
      result.filePath,
      JSON.stringify({ chat: chat.title, exportedAt: new Date().toISOString(), toolCalls: records }, null, 2),
      'utf8',
    )
    return result.filePath
  })
  handle('chats:export', async (_event, id: string) => {
    const chat = await chats.getChat(id)
    if (!chat) return null
    const result = await dialog.showSaveDialog({
      defaultPath: `${chat.title.replace(/[\\/:*?"<>|]/g, '-').slice(0, 60)}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    })
    if (result.canceled || !result.filePath) return null
    await chats.exportChatMarkdown(chat, result.filePath)
    return result.filePath
  })

  handle('api:status', () => apiServer.getApiStatus())
  handle('api:log', () => apiServer.getApiLog())
  handle('api:setEnabled', async (_event, enabled: boolean) => {
    await mutate((s) => {
      s.apiServer.enabled = enabled === true
    })
    return apiServer.syncApiServer()
  })
  handle('api:setPort', async (_event, port: number) => {
    const clamped = Math.min(65535, Math.max(1024, Math.round(Number(port) || 0)))
    await mutate((s) => {
      s.apiServer.port = clamped
    })
    return apiServer.syncApiServer()
  })
  handle('api:regenerateToken', () => apiServer.regenerateApiToken())

  handle('agents:list', () => customAgents.listAgents())
  handle('agents:get', (_event, id: string) => customAgents.getAgent(id))
  handle('agents:save', async (_event, payload: unknown) => {
    const record = typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {}
    const knowledge = Array.isArray(record.knowledge) ? record.knowledge : []
    const existing = typeof record.id === 'string' ? await customAgents.getAgent(record.id) : null
    for (const item of knowledge) {
      const folder = typeof item === 'object' && item !== null ? (item as Record<string, unknown>).folder : null
      const existingFolder = existing?.knowledge.some((entry) => entry.folder === folder)
      if (typeof folder === 'string' && !existingFolder && !(await isApprovedFolder(folder))) {
        throw new Error('Choose agent knowledge folders with the native folder picker first.')
      }
    }
    const saved = await customAgents.saveAgent(payload)

    if (saved && saved.id === activeAgentId) void reconcileMcpServers()
    return saved
  })
  handle('agents:delete', async (_event, id: string) => {
    const removed = await customAgents.deleteAgent(id)
    if (removed && id === activeAgentId) {
      activeAgentId = null
      void reconcileMcpServers()
    }
    return removed
  })
  handle('agents:reveal', () => customAgents.revealAgentsDir())

  handle('agents:setActive', async (_event, id: string | null) => {
    const next = typeof id === 'string' && (await customAgents.getAgent(id)) ? id : null
    if (next === activeAgentId) return true
    activeAgentId = next
    await reconcileMcpServers()
    return true
  })
  handle('agents:export', async (_event, id: string) => {
    const json = await customAgents.exportAgentShare(id)
    if (!json) return null
    const agent = await customAgents.getAgent(id)
    const result = await dialog.showSaveDialog({
      defaultPath: `${(agent?.name ?? 'agent').replace(/[\\/:*?"<>|]/g, '-').slice(0, 50)}.agent.json`,
      filters: [{ name: 'PowerStation agent', extensions: ['json'] }],
    })
    if (result.canceled || !result.filePath) return null
    await fs.writeFile(result.filePath, json, 'utf8')
    return result.filePath
  })
  handle('agents:import', async () => {
    const picked = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'PowerStation agent', extensions: ['json'] }],
    })
    if (picked.canceled || !picked.filePaths.length) return null
    const text = await fs.readFile(picked.filePaths[0], 'utf8')

    return customAgents.importAgentShare(text)
  })

  handle('projects:list', () => projects.listProjects())
  handle('projects:get', (_event, id: string) => projects.getProject(id))
  handle('projects:getActive', () => projects.getActiveProject())
  handle('projects:save', async (_event, payload: unknown) => {
    const record = typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {}
    const knowledge = typeof record.knowledge === 'object' && record.knowledge !== null ? (record.knowledge as Record<string, unknown>) : null
    const existing = typeof record.id === 'string' ? await projects.getProject(record.id) : null
    if (typeof knowledge?.folder === 'string' && knowledge.folder !== existing?.knowledge?.folder && !(await isApprovedFolder(knowledge.folder))) {
      throw new Error('Choose project knowledge folders with the native folder picker first.')
    }
    const saved = await projects.saveProject(payload)

    if (saved && (await getState()).activeProjectId === saved.id) void reconcileMcpServers()
    return saved
  })
  handle('projects:delete', async (_event, id: string) => {
    const removed = await projects.deleteProject(id)
    if (removed) void reconcileMcpServers()
    return removed
  })
  handle('projects:setActive', async (_event, id: string | null) => {
    const project = await projects.setActiveProject(typeof id === 'string' ? id : null)
    await reconcileMcpServers()
    return project
  })
  handle('projects:reveal', () => projects.revealProjectsDir())

  handle('repair:report', () => repair.getStorageReport())
  handle('repair:reclaimables', () => repair.getReclaimables())
  handle('repair:clean', (_event, id: string) => repair.cleanReclaimable(id))
  handle('repair:reveal', (_event, id: string) => repair.revealLocation(id))
  handle('repair:integrity', () => repair.checkModelIntegrity())
  handle('repair:log', () => repair.getRepairLog())

  handle('backup:export', async () => {
    const result = await dialog.showSaveDialog({
      defaultPath: `powerstation-backup-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (result.canceled || !result.filePath) return null
    const filePath = result.filePath
    const summary = await backup.exportBackup(filePath)
    return { filePath, ...summary }
  })
  handle('backup:restore', async () => {
    const picked = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'PowerStation backup', extensions: ['json'] }],
    })
      if (picked.canceled || !picked.filePaths.length) return null
      const confirm = await dialog.showMessageBox({
        type: 'warning',
        buttons: ['Restore', 'Cancel'],
        defaultId: 0,
        cancelId: 1,
        message: 'Restore from this backup?',
        detail:
          'Settings and permissions will be replaced by the backup. Chats, skills and projects from the backup overwrite items with the same id; everything else you have stays. Model files do not travel in backups — models missing on this machine simply will not appear until re-downloaded.',
      })
      if (confirm.response !== 0) return null
    const filePath = picked.filePaths[0]
    const summary = await backup.restoreBackup(filePath)
    await reconcileMcpServers()
    return summary
  })

  handle('files:pickAndExtract', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Documents & text', extensions: ['pdf', ...[...TEXT_EXTENSIONS].map((ext) => ext.slice(1))] },
      ],
    })
    if (result.canceled || !result.filePaths.length) return []
    if (approvedAttachmentPaths.size + result.filePaths.length > 32) approvedAttachmentPaths.clear()
    for (const filePath of result.filePaths) {
      const real = await fs.realpath(filePath).catch(() => null)
      if (real) approvedAttachmentPaths.add(real)
    }
    return Promise.all(
      result.filePaths.slice(0, 4).map(async (filePath) => {
        try {
          return { ok: true as const, file: await extractFile(filePath) }
        } catch (error) {
          return { ok: false as const, name: path.basename(filePath), error: error instanceof Error ? error.message : String(error) }
        }
      }),
    )
  })
  handle('files:extract', async (_event, paths: string[]) => {
    if (!Array.isArray(paths)) return []
    return Promise.all(
      paths.slice(0, 4).map(async (filePath) => {
        try {
          const realFile = typeof filePath === 'string' ? await fs.realpath(filePath).catch(() => null) : null
          if (!realFile || !approvedAttachmentPaths.has(realFile)) {
            throw new Error('Choose files with the native file picker before attaching them.')
          }
          return { ok: true as const, file: await extractFile(realFile) }
        } catch (error) {
          return { ok: false as const, name: path.basename(String(filePath)), error: error instanceof Error ? error.message : String(error) }
        }
      }),
    )
  })
  handle('rag:index', async (_event, folder: string) => {
    if (typeof folder !== 'string') throw new Error('Bad folder')
    if (!(await isApprovedFolder(folder))) throw new Error('Choose this folder with the native folder picker first.')
    return rag.ensureFolderIndex(folder, (progress) => send('rag:indexProgress', progress))
  })
  handle('rag:info', (_event, folderId: string) => rag.getFolderIndexInfo(folderId))
  handle('rag:list', () => rag.listFolderIndexes())
  handle('rag:delete', (_event, folderId: string) => rag.deleteFolderIndex(folderId))
  handle('rag:reindex', (_event, folderId: string) => {
    if (typeof folderId !== 'string') throw new Error('Bad folder id')
    return rag.reindexFolder(folderId, (progress) => send('rag:indexProgress', progress))
  })

  handle('app:whatsNew', async () => {
    const state = await getState()
    const currentVersion = app.getVersion()
    const previousVersion = state.lastSeenVersion || null

    if (previousVersion === null) {
      await mutate((current) => {
        current.lastSeenVersion = currentVersion
      })
    }
    return {
      currentVersion,
      previousVersion,
      show: previousVersion !== null && previousVersion !== currentVersion,
    }
  })
  handle('app:whatsNewSeen', async () => {
    await mutate((state) => {
      state.lastSeenVersion = app.getVersion()
    })
    return true
  })

  handle('app:openExternal', async (_event, url: string) => {
    if (!isTrustedExternalUrl(url)) {
      throw new Error('PowerStation can only open trusted external pages.')
    }
    await shell.openExternal(new URL(url).toString())
    return true
  })

  handle('hardware:profile', async () => {
    const device = await llm.getDeviceInfo().catch(() => null)
    const profile = await getHardwareProfile(device?.vram?.total ?? null)

    return { ...profile, usableBudgetBytes: Math.round(profile.gpuBudgetBytes * USABLE_BUDGET_FRACTION) }
  })

  handle('catalog:get', () => getCatalog())
  handle('catalog:refresh', () => {

    void refreshConnectorCatalog()
    void refreshSkillCatalog()
    return refreshCatalog()
  })

  handle('skills:list', () => skills.listSkills())
  handle('skills:save', (_event, payload: { slug?: string; name: string; description: string; body: string }) =>
    skills.saveSkill(payload ?? { name: '', description: '', body: '' }),
  )
  handle('skills:delete', (_event, slug: string) => skills.deleteSkill(slug))
  handle('skills:setMode', (_event, payload: { slug: string; mode: 'off' | 'auto' | 'always' }) =>
    skills.setSkillMode(payload?.slug, payload?.mode),
  )
  handle('skills:reveal', () => skills.revealSkillsDir())
  handle('skills:gallery', () => getSkillCatalog())
  handle('skills:install', async (_event, id: string) => {

    const gallery = await getSkillCatalog()
    const entry = gallery.skills.find((skill) => skill.id === id)
    if (!entry) throw new Error('Unknown gallery skill.')
    return skills.saveSkill({
      slug: entry.id,
      name: entry.name,
      description: entry.description,
      body: entry.body,
      triggers: entry.triggers,
    })
  })

  handle('connectors:get', () => getConnectorCatalog())
  handle('app:pickFolder', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    if (result.canceled || !result.filePaths.length) return null
    rememberFolder(result.filePaths[0])
    return result.filePaths[0]
  })
  handle('connectors:add', async (_event, payload: { connectorId: string; folder?: string }) => {
    const catalog = await getConnectorCatalog()
    const entry: ConnectorEntry | undefined = catalog.connectors.find((c) => c.id === payload?.connectorId)
    if (!entry) throw new Error('Unknown connector.')

    let folder: string | null = null
    if (entry.needsFolder) {
      folder = typeof payload.folder === 'string' ? payload.folder : null
      if (!folder) throw new Error('This connector needs a folder.')
      if (!(await isApprovedFolder(folder))) throw new Error('Choose the connector folder with the native folder picker first.')
      const stat = await fs.stat(folder).catch(() => null)
      if (!stat?.isDirectory()) throw new Error('The chosen folder does not exist.')
    }

    const args = entry.args.map((arg) => (arg === '{folder}' ? folder! : arg))
    const quoted = args.map((arg) => quoteCommandArg(arg))
    const command = ['npx', '-y', `${entry.npmPackage}@${entry.version}`, ...quoted].join(' ')

    const state = await getState()

    const existing = state.settings.utilities.mcpServers.find(
      (server) => !entry.needsFolder && server.command.startsWith(`npx -y ${entry.npmPackage}@${entry.version}`),
    )
    let serverId: string
    if (existing) {
      serverId = existing.id
      await mutate((current) => {
        const server = current.settings.utilities.mcpServers.find((s) => s.id === existing.id)
        if (server) server.enabled = true
      })
    } else {
      serverId = `mcp-${Date.now()}-${Math.round(Math.random() * 1e6)}`
      const name = entry.needsFolder ? `${entry.name} (${path.basename(folder!)})` : entry.name
      await mutate((current) => {
        current.settings.utilities.mcpServers.push({
          id: serverId,
          name,
          command,
          enabled: true,
        })
      })
    }

    const activeProject = await projects.getActiveProject()
    if (activeProject && !activeProject.mcpServerIds.includes(serverId)) {
      await projects.saveProject({ ...activeProject, mcpServerIds: [...activeProject.mcpServerIds, serverId] })
    }
    void reconcileMcpServers()
    return (await getState()).settings.utilities.mcpServers
  })

  handle('catalog:recommend', async (_event, intent: Intent) => {
    const [catalog, profile, budget, state] = await Promise.all([
      getCatalog(),
      getHardwareProfile(),
      getGpuBudgetBytes(),
      getState(),
    ])
    return recommendModels({
      catalog: catalog.models,
      intent,
      totalRamBytes: profile.totalRamBytes,
      gpuBudgetBytes: budget,
      freeDiskBytes: profile.freeDiskBytes,
      measuredTpsByFile: Object.fromEntries(
        Object.entries(state.benchmarks).map(([file, record]) => [file, record.tokensPerSec]),
      ),
    })
  })

  handle('fit:check', async (_event, payload: { catalogId?: string; modelPath?: string; contextTokens?: number }) => {
    const state = await getState()
    const requestedContext = typeof payload?.contextTokens === 'number' && Number.isFinite(payload.contextTokens) ? payload.contextTokens : state.settings.contextTokens
    const contextTokens = Math.min(32768, Math.max(512, Math.round(requestedContext)))
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
      if (!(await models.isKnownModelPath(payload.modelPath))) return null
      const info = await models.getModelInfo(payload.modelPath)
      if (!info) return null
      const entry = await findCatalogEntryForModel(payload.modelPath)
      return checkFit({

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

  handle('onboarding:get', async () => (await getState()).onboarding)
  handle('onboarding:complete', async (_event, payload: { useCase?: string; priority?: string }) => {
    const state = await mutate((current) => {
      current.onboarding = {
        completed: true,
        useCase: typeof payload?.useCase === 'string' ? payload.useCase.slice(0, 40) : current.onboarding.useCase,
        priority: typeof payload?.priority === 'string' ? payload.priority.slice(0, 40) : current.onboarding.priority,
      }
    })
    return state.onboarding
  })

  handle('mcp:statuses', () => mcp.getMcpStatuses())
  handle('mcp:toolInfo', async () => {
    const state = await getState()
    return {
      tools: mcp.getConnectedTools(),
      schemaTokens: agent.estimateToolSchemaTokens(),
      contextTokens: state.settings.contextTokens,
    }
  })
  handle('mcp:reconnect', async (_event, serverId: string) => {
    const state = await getState()
    const config = state.settings.utilities.mcpServers.find((server) => server.id === serverId)
    if (!config) return null
    const response = await showSecurityPrompt(getWindow(), {
      message: `Run the MCP server “${config.name}”?`,
      detail: `${config.command}\n\nThis starts a process with your user-account permissions.`,
      buttons: ['Cancel', 'Run server'],
      cancelId: 0,
    })
    if (response !== 1) return null
    return mcp.connectServer(config)
  })

  handle('permissions:get', async () => (await getState()).toolPermissions)
  handle('permissions:set', async (_event, payload: { toolKey: string; permission: ToolPermission }) => {
    if (!payload || typeof payload.toolKey !== 'string') return false
    if (!['allow', 'ask', 'deny'].includes(payload.permission)) return false
    await agent.setToolPermission(payload.toolKey.slice(0, 200), payload.permission)
    return true
  })

  handle('agent:permissionResponse', (_event, payload: { promptId: string; decision: string }) => {
    void payload
    return false
  })

  handle('agent:planResponse', (_event, payload: { promptId: string; approved: boolean }) => {
    void payload
    return false
  })

  handle('settings:get', async () => (await getState()).settings)
  handle('settings:update', async (_event, patch: Partial<Settings>) => {
    const before = JSON.stringify((await getState()).settings.utilities.mcpServers)
    const settings = await patchSettings(patch)

    if (JSON.stringify(settings.utilities.mcpServers) !== before) void reconcileMcpServers()
    return settings
  })
  handle('device:info', async () => {
    const info = await llm.getDeviceInfo().catch(() => null)
    const profile = await getHardwareProfile(info?.vram?.total ?? null)
    const gpuNames = info?.gpuNames?.length ? info.gpuNames : profile.gpuDevices.map((gpu) => gpu.name)
    return {
      gpuType: info?.gpuType ?? false,
      gpuNames,
      vram: info?.vram ?? null,
      gpuBudgetSource: profile.gpuBudgetSource,
      gpuDevices: profile.gpuDevices,
      health: await getDeviceHealthProfile(gpuNames),
    }
  })

  handle(
    'chat:send',
    async (
      _event,
      payload: {
        requestId: string
        prompt: string
        history?: Array<{ role: string; text: string }>
        ragFolderId?: string
        ragQuery?: string
        agentId?: string
      },
    ) => {
    if (!payload || typeof payload !== 'object') throw new Error('Invalid chat request.')
    const requestId = typeof payload.requestId === 'string' ? payload.requestId : ''
    const prompt = typeof payload.prompt === 'string' ? payload.prompt : ''
    if (!/^[a-zA-Z0-9_-]{6,120}$/.test(requestId)) throw new Error('Invalid chat request id.')
    if (!prompt.trim() || prompt.length > 200_000) throw new Error('Chat prompt is empty or too large.')

    const history = Array.isArray(payload.history)
      ? payload.history
          .slice(-200)
          .map((turn) => ({
            role: turn?.role === 'assistant' ? ('assistant' as const) : ('user' as const),
            text: typeof turn?.text === 'string' ? turn.text.slice(0, 200_000) : '',
          }))
          .filter((turn) => turn.text)
      : undefined
    const state = await getState()
    const modelPath = state.selectedModelPath
    if (!modelPath || !(await models.isKnownModelPath(modelPath))) {
      send('chat:error', { requestId, message: 'No model selected. Add and select a model first.' })
      return { requestId, ok: false }
    }
    void (async () => {
      try {

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

        const tier = resolveToolTier(info, entry)
        const agentId = typeof payload.agentId === 'string' ? payload.agentId : undefined
        const effective = await getEffectiveSystemPrompt(
          typeof payload.ragQuery === 'string' ? payload.ragQuery : prompt,
          agentId,
        )
        const includeRepairTools = effective.skillSlugs.includes(REPAIR_SKILL_SLUG)
        const toolDefinitions = tier === 'none' ? [] : agent.getAgentToolDefinitions(includeRepairTools)
        const maxToolCalls = tier === 'multi' ? 15 : 3
        send('chat:admission', {
          requestId,
          contextTokens,
          verdict: fit.verdict,
          summary: fit.summary,
          toolCount: toolDefinitions.length,
          schemaTokens: agent.estimateToolSchemaTokens(toolDefinitions),
          activeSkills: effective.skillNames,
        })

        let effectivePrompt = prompt
        const folderIds = new Set<string>()
        if (typeof payload.ragFolderId === 'string') folderIds.add(payload.ragFolderId)
        if (agentId) {
          const chatAgent = await customAgents.getAgent(agentId)
          for (const knowledge of chatAgent?.knowledge ?? []) folderIds.add(knowledge.folderId)
        }
        if (folderIds.size > 0) {
          try {
            const retrieval = await rag.queryFolders(
              [...folderIds],
              typeof payload.ragQuery === 'string' ? payload.ragQuery.slice(0, 4000) : prompt.slice(0, 4000),
            )
            if (retrieval) {
              effectivePrompt = `${retrieval.block}\n\n${prompt}`
              send('chat:sources', { requestId, sources: retrieval.sources })
            }
          } catch {
            void 0
          }
        }

        if (state.settings.agentPlanPreview && toolDefinitions.length > 0) {
          try {
            const toolList = toolDefinitions.map((t) => `- ${t.key}: ${t.description}`.slice(0, 200)).join('\n')
            const planResult = await llm.chat({
              requestId: `${requestId}-plan`,
              modelPath,
              prompt:
                `You have these tools available:\n${toolList}\n\nThe user asked:\n"""${prompt.slice(0, 2000)}"""\n\n` +
                'If answering this needs one or more tool calls, reply with a short numbered plan — each step naming the tool it will use and why. Do not call any tools and do not answer the question yet; give only the plan. If no tools are needed, reply with exactly: NO_TOOLS',
              systemPrompt: effective.prompt,
              contextTokens,
              temperature: 0,
              maxTokens: 260,
              history: history?.length ? history : undefined,
              isolated: true,
              onToken: () => {},
              onStatus: () => {},
              onToolCall: () => {},
              onCompacted: () => {},
            })
            const plan = planResult.text.trim()
            if (plan && !/no_tools/i.test(plan)) {
              const approved = await agent.requestPlanApproval(requestId, plan)
              if (!approved) {
                send('chat:done', {
                  requestId,
                  text: '',
                  tokensPerSec: 0,
                  elapsedMs: 0,
                  aborted: true,
                  toolCallCount: 0,
                  haltReason: null,
                  contextUsed: 0,
                  contextSize: contextTokens,
                })
                return
              }
              agent.allowTurn(requestId)
            }
          } catch {
            void 0
          }
        }

        const result = await llm.chat({
          requestId,
          modelPath,
          prompt: effectivePrompt,
          systemPrompt: effective.prompt,
          contextTokens,
          temperature: state.settings.temperature,
          maxTokens: state.settings.maxTokens,
          tools: toolDefinitions.length ? toolDefinitions : undefined,
          maxToolCalls,
          history: history?.length ? history : undefined,
          autoCompact: state.settings.autoCompact,
          onToken: (token) => send('chat:token', { requestId, token }),
          onStatus: (status) => send('chat:status', { requestId, ...status }),
          onToolCall: (toolKey, args) => send('chat:toolCall', { requestId, toolKey, args }),
          onCompacted: (payload) => send('chat:compacted', { requestId, ...payload }),
        })
        send('chat:done', {
          requestId,
          text: result.text,
          tokensPerSec: result.tokensPerSec,
          elapsedMs: result.elapsedMs,
          aborted: result.aborted,
          toolCallCount: result.toolCallCount,
          haltReason: result.haltReason,
          contextUsed: result.contextUsed,
          contextSize: result.contextSize,
        })
      } catch (error) {
        send('chat:error', { requestId, message: error instanceof Error ? error.message : String(error) })
      } finally {
        agent.endTurn(requestId)
      }
    })()
    return { requestId, ok: true }
  })

  handle('chat:stop', (_event, requestId: string) => llm.stopChat(requestId))
  handle('chat:reset', () => llm.resetChat())

  const abortedCompares = new Set<string>()
  handle(
    'compare:run',
    async (_event, payload: { requestId: string; prompt: string; modelPaths: string[] }) => {
      const requestId = typeof payload?.requestId === 'string' ? payload.requestId : ''
      const prompt = typeof payload?.prompt === 'string' ? payload.prompt.trim() : ''
      const modelPaths = Array.isArray(payload?.modelPaths) ? payload.modelPaths.slice(0, 2) : []
      if (!/^[a-zA-Z0-9_-]{6,120}$/.test(requestId) || !prompt || prompt.length > 200_000 || modelPaths.length !== 2) return { ok: false }
      for (const modelPath of modelPaths) {
        if (typeof modelPath !== 'string' || !(await models.isKnownModelPath(modelPath))) return { ok: false }
      }
      abortedCompares.delete(requestId)
      void (async () => {
        const state = await getState()
        const effective = await getEffectiveSystemPrompt(prompt)
        for (let slot = 0; slot < modelPaths.length; slot++) {
          if (abortedCompares.has(requestId)) {
            send('compare:status', { requestId, slot, phase: 'skipped' })
            continue
          }
          const modelPath = modelPaths[slot]
          try {
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
              send('compare:status', { requestId, slot, phase: 'refused', message: `${fit.summary} ${fit.suggestions.join(' ')}` })
              continue
            }
            send('compare:status', { requestId, slot, phase: 'loading' })
            const result = await llm.chat({
              requestId: `${requestId}-slot${slot}`,
              modelPath,
              prompt,
              systemPrompt: effective.prompt,
              contextTokens: admittedContextTokens(fitRequest),
              temperature: state.settings.temperature,
              maxTokens: state.settings.maxTokens,
              autoCompact: false,
              onToken: (token) => send('compare:token', { requestId, slot, token }),
              onStatus: (status) => {
                if (status.phase === 'generating') send('compare:status', { requestId, slot, phase: 'generating' })
              },
            })
            send('compare:result', {
              requestId,
              slot,
              text: result.text,
              tokensPerSec: result.tokensPerSec,
              elapsedMs: result.elapsedMs,
              aborted: result.aborted,
            })
          } catch (error) {
            send('compare:status', {
              requestId,
              slot,
              phase: 'error',
              message: error instanceof Error ? error.message : String(error),
            })
          }
        }
        abortedCompares.delete(requestId)
        send('compare:done', { requestId })
      })()
      return { ok: true }
    },
  )
  handle('compare:stop', (_event, requestId: string) => {
    if (typeof requestId !== 'string') return false
    abortedCompares.add(requestId)

    for (const slot of [0, 1]) void llm.stopChat(`${requestId}-slot${slot}`)
    return true
  })
  handle('chat:unload', () => llm.unloadModel())
}
