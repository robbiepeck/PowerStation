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

/**
 * The user's base system prompt plus active skills: always-on ones, and — when
 * a message is provided — auto skills whose triggers match it.
 */
async function getEffectiveSystemPrompt(
  message?: string,
): Promise<{ prompt: string | undefined; skillNames: string[]; skillSlugs: string[] }> {
  const state = await getState()
  const project = await projects.getActiveProject()
  // Project instructions extend the global base prompt; project skill modes
  // override the global ones for the slugs they name.
  const base = [state.settings.utilities.systemPrompt, project?.instructions ?? '']
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

/**
 * Measure real tokens/sec for a model on this machine and persist the result
 * (keyed by lowercase fileName so catalog entries and local files match up).
 * Runs the same admission check as chat — a model that won't fit isn't
 * benchmarked, it's refused.
 */
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
    // Same composed prompt as chat (always-on skills only), so the warm
    // session carries over.
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

/**
 * Reconnect/disconnect MCP servers so connections mirror the settings — or,
 * while a project is active, that project's connector selection.
 */
async function reconcileMcpServers(): Promise<void> {
  const state = await getState()
  const project = await projects.getActiveProject()
  const wanted = new Map(
    state.settings.utilities.mcpServers
      .filter((server) => (project ? project.mcpServerIds.includes(server.id) : server.enabled))
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
  // Each model is enriched with its resolved tool-calling tier and measured
  // speed so the renderer never re-implements either.
  ipcMain.handle('models:list', async () => {
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
        // Measure real speed while we're here: it doubles as pre-warming the
        // model, so the user's first chat message starts instantly. Optional —
        // a benchmark failure never blocks delivering the model.
        try {
          send('models:benchmarking', { id, filePath })
          await runModelBenchmark(filePath)
        } catch {
          /* model still delivered without a measurement */
        }
        send('models:downloadDone', { id, filePath })
      } catch (error) {
        send('models:downloadError', { id, message: error instanceof Error ? error.message : String(error) })
      }
    })()
    return id
  })

  // --- Ollama -----------------------------------------------------------------
  ipcMain.handle('ollama:status', () => ollama.getOllamaStatus())
  ipcMain.handle('ollama:import', async (_event, name: string) => {
    // Resolve server-side from our own manifest listing — the renderer never
    // supplies a file path.
    const model = await ollama.resolveOllamaModel(name)
    if (!model) throw new Error('That model was not found in Ollama.')
    await models.importModelFile(model.blobPath)
    return model.blobPath
  })

  // --- LM Studio ----------------------------------------------------------------
  ipcMain.handle('lmstudio:status', () => lmstudio.getLmStudioStatus())
  ipcMain.handle('lmstudio:import', async (_event, filePath: string) => {
    // Same rule as Ollama: resolve server-side from our own directory walk —
    // the renderer's string must match a file we listed, never a free path.
    const model = await lmstudio.resolveLmStudioModel(filePath)
    if (!model) throw new Error('That model was not found in LM Studio.')
    await models.importModelFile(model.path)
    return model.path
  })

  // --- Benchmarks -------------------------------------------------------------
  ipcMain.handle('bench:run', async (_event, modelPath: string) => {
    if (typeof modelPath !== 'string' || !(await models.isKnownModelPath(modelPath))) {
      throw new Error('Unknown model path.')
    }
    return runModelBenchmark(modelPath)
  })
  ipcMain.handle('bench:results', async () => (await getState()).benchmarks)

  // --- Chat history -------------------------------------------------------------
  const chatScope = (scope: unknown): chats.ChatScope => {
    if (typeof scope !== 'object' || scope === null || !('projectId' in scope)) return undefined
    const projectId = (scope as { projectId: unknown }).projectId
    return { projectId: typeof projectId === 'string' ? projectId : null }
  }
  ipcMain.handle('chats:list', (_event, scope?: unknown) => chats.listChats(chatScope(scope)))
  ipcMain.handle('chats:get', (_event, id: string) => chats.getChat(id))
  ipcMain.handle('chats:save', async (_event, payload: { id?: string; messages: unknown; modelPath?: string }) => {
    const state = await getState()
    if (!state.settings.saveChats) return null
    return chats.saveChat(payload ?? { messages: [] })
  })
  ipcMain.handle('chats:rename', (_event, id: string, title: string) => chats.renameChat(id, title))
  ipcMain.handle('chats:pin', (_event, id: string, pinned: boolean) => chats.setChatPinned(id, pinned))
  ipcMain.handle('chats:delete', (_event, id: string) => chats.deleteChat(id))
  ipcMain.handle('chats:deleteAll', () => chats.deleteAllChats())
  ipcMain.handle('chats:reveal', () => chats.revealChatsDir())
  ipcMain.handle('chats:search', (_event, query: string, scope?: unknown) => chats.searchChats(query, chatScope(scope)))
  ipcMain.handle('chats:exportAudit', async (_event, id: string) => {
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
  ipcMain.handle('chats:export', async (_event, id: string) => {
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

  // --- Projects (workspaces) ----------------------------------------------------
  ipcMain.handle('projects:list', () => projects.listProjects())
  ipcMain.handle('projects:get', (_event, id: string) => projects.getProject(id))
  ipcMain.handle('projects:getActive', () => projects.getActiveProject())
  ipcMain.handle('projects:save', async (_event, payload: unknown) => {
    const saved = await projects.saveProject(payload)
    // Editing the active project can change its connector selection.
    if (saved && (await getState()).activeProjectId === saved.id) void reconcileMcpServers()
    return saved
  })
  ipcMain.handle('projects:delete', async (_event, id: string) => {
    const removed = await projects.deleteProject(id)
    if (removed) void reconcileMcpServers()
    return removed
  })
  ipcMain.handle('projects:setActive', async (_event, id: string | null) => {
    const project = await projects.setActiveProject(typeof id === 'string' ? id : null)
    await reconcileMcpServers()
    return project
  })
  ipcMain.handle('projects:reveal', () => projects.revealProjectsDir())

  // --- Repair (diagnose, don't operate) --------------------------------------------
  ipcMain.handle('repair:report', () => repair.getStorageReport())
  ipcMain.handle('repair:reclaimables', () => repair.getReclaimables())
  ipcMain.handle('repair:clean', (_event, id: string) => repair.cleanReclaimable(id))
  ipcMain.handle('repair:reveal', (_event, id: string) => repair.revealLocation(id))
  ipcMain.handle('repair:integrity', () => repair.checkModelIntegrity())
  ipcMain.handle('repair:log', () => repair.getRepairLog())

  // --- Backup & restore -----------------------------------------------------------
  ipcMain.handle('backup:export', async (_event, payload?: { filePath?: string }) => {
    let filePath = typeof payload?.filePath === 'string' ? payload.filePath : null
    if (!filePath) {
      const result = await dialog.showSaveDialog({
        defaultPath: `powerstation-backup-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      })
      if (result.canceled || !result.filePath) return null
      filePath = result.filePath
    }
    const summary = await backup.exportBackup(filePath)
    return { filePath, ...summary }
  })
  ipcMain.handle('backup:restore', async (_event, payload?: { filePath?: string }) => {
    let filePath = typeof payload?.filePath === 'string' ? payload.filePath : null
    if (!filePath) {
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
      filePath = picked.filePaths[0]
    }
    const summary = await backup.restoreBackup(filePath)
    await reconcileMcpServers()
    return summary
  })

  // --- Attachments & folder knowledge ------------------------------------------
  ipcMain.handle('files:pickAndExtract', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Documents & text', extensions: ['pdf', ...[...TEXT_EXTENSIONS].map((ext) => ext.slice(1))] },
      ],
    })
    if (result.canceled || !result.filePaths.length) return []
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
  ipcMain.handle('files:extract', async (_event, paths: string[]) => {
    if (!Array.isArray(paths)) return []
    return Promise.all(
      paths.slice(0, 4).map(async (filePath) => {
        try {
          if (typeof filePath !== 'string') throw new Error('Bad path')
          return { ok: true as const, file: await extractFile(filePath) }
        } catch (error) {
          return { ok: false as const, name: path.basename(String(filePath)), error: error instanceof Error ? error.message : String(error) }
        }
      }),
    )
  })
  ipcMain.handle('rag:index', async (_event, folder: string) => {
    if (typeof folder !== 'string') throw new Error('Bad folder')
    return rag.ensureFolderIndex(folder, (progress) => send('rag:indexProgress', progress))
  })
  ipcMain.handle('rag:info', (_event, folderId: string) => rag.getFolderIndexInfo(folderId))
  ipcMain.handle('rag:list', () => rag.listFolderIndexes())
  ipcMain.handle('rag:delete', (_event, folderId: string) => rag.deleteFolderIndex(folderId))
  ipcMain.handle('rag:reindex', (_event, folderId: string) => {
    if (typeof folderId !== 'string') throw new Error('Bad folder id')
    return rag.reindexFolder(folderId, (progress) => send('rag:indexProgress', progress))
  })

  // --- What's new ---------------------------------------------------------------
  ipcMain.handle('app:whatsNew', async () => {
    const state = await getState()
    const currentVersion = app.getVersion()
    const previousVersion = state.lastSeenVersion || null
    // First run: stamp silently so only real version changes show the card.
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
  ipcMain.handle('app:whatsNewSeen', async () => {
    await mutate((state) => {
      state.lastSeenVersion = app.getVersion()
    })
    return true
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
  ipcMain.handle('catalog:refresh', () => {
    // One button refreshes all curated datasets.
    void refreshConnectorCatalog()
    void refreshSkillCatalog()
    return refreshCatalog()
  })

  // --- Skills ---------------------------------------------------------------
  ipcMain.handle('skills:list', () => skills.listSkills())
  ipcMain.handle('skills:save', (_event, payload: { slug?: string; name: string; description: string; body: string }) =>
    skills.saveSkill(payload ?? { name: '', description: '', body: '' }),
  )
  ipcMain.handle('skills:delete', (_event, slug: string) => skills.deleteSkill(slug))
  ipcMain.handle('skills:setMode', (_event, payload: { slug: string; mode: 'off' | 'auto' | 'always' }) =>
    skills.setSkillMode(payload?.slug, payload?.mode),
  )
  ipcMain.handle('skills:reveal', () => skills.revealSkillsDir())
  ipcMain.handle('skills:gallery', () => getSkillCatalog())
  ipcMain.handle('skills:install', async (_event, id: string) => {
    // Resolve the entry server-side from the validated catalog — the renderer
    // names an id, it never supplies skill content.
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

  // --- Connector gallery -------------------------------------------------------
  ipcMain.handle('connectors:get', () => getConnectorCatalog())
  ipcMain.handle('app:pickFolder', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    return result.canceled || !result.filePaths.length ? null : result.filePaths[0]
  })
  ipcMain.handle('connectors:add', async (_event, payload: { connectorId: string; folder?: string }) => {
    const catalog = await getConnectorCatalog()
    const entry: ConnectorEntry | undefined = catalog.connectors.find((c) => c.id === payload?.connectorId)
    if (!entry) throw new Error('Unknown connector.')

    let folder: string | null = null
    if (entry.needsFolder) {
      folder = typeof payload.folder === 'string' ? payload.folder : null
      if (!folder) throw new Error('This connector needs a folder.')
      const stat = await fs.stat(folder).catch(() => null)
      if (!stat?.isDirectory()) throw new Error('The chosen folder does not exist.')
    }

    // Command is constructed HERE from the validated catalog entry — never
    // from free-form remote strings.
    const args = entry.args.map((arg) => (arg === '{folder}' ? folder! : arg))
    const quoted = args.map((arg) => (arg.includes(' ') ? `"${arg}"` : arg))
    const command = ['npx', '-y', entry.npmPackage, ...quoted].join(' ')

    const state = await getState()
    // Idempotent for folderless connectors: adding "Memory" twice re-enables
    // the existing entry instead of spawning a duplicate server.
    const existing = state.settings.utilities.mcpServers.find(
      (server) => !entry.needsFolder && server.command.startsWith(`npx -y ${entry.npmPackage}`),
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
    // Adding a connector while a project is active should take effect there —
    // otherwise the project's selection silently filters the new server out.
    const activeProject = await projects.getActiveProject()
    if (activeProject && !activeProject.mcpServerIds.includes(serverId)) {
      await projects.saveProject({ ...activeProject, mcpServerIds: [...activeProject.mcpServerIds, serverId] })
    }
    void reconcileMcpServers()
    return (await getState()).settings.utilities.mcpServers
  })

  ipcMain.handle('catalog:recommend', async (_event, intent: Intent) => {
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
    const decision = ['allow-once', 'allow-turn', 'allow-always', 'deny'].includes(payload.decision)
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
  ipcMain.handle(
    'chat:send',
    async (
      _event,
      payload: {
        requestId: string
        prompt: string
        history?: Array<{ role: string; text: string }>
        ragFolderId?: string
        ragQuery?: string
      },
    ) => {
    const { requestId, prompt } = payload
    // History arrives once when resuming a persisted chat; validate strictly.
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
        // app, not a limited model. The built-in repair tools register only
        // when the Storage repair skill is active for this message: the skill
        // teaches the workflow, and its mode doubles as the feature switch.
        const tier = resolveToolTier(info, entry)
        const effective = await getEffectiveSystemPrompt(typeof payload.ragQuery === 'string' ? payload.ragQuery : prompt)
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

        // Chat-with-a-folder: retrieve the most relevant chunks for this
        // question and prepend them as framed reference data.
        let effectivePrompt = prompt
        if (typeof payload.ragFolderId === 'string') {
          try {
            const retrieval = await rag.queryFolder(
              payload.ragFolderId,
              typeof payload.ragQuery === 'string' ? payload.ragQuery.slice(0, 4000) : prompt.slice(0, 4000),
            )
            if (retrieval) {
              effectivePrompt = `${retrieval.block}\n\n${prompt}`
              send('chat:sources', { requestId, sources: retrieval.sources })
            }
          } catch {
            /* retrieval is best-effort; the question still goes through */
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

  ipcMain.handle('chat:stop', (_event, requestId: string) => llm.stopChat(requestId))
  ipcMain.handle('chat:reset', () => llm.resetChat())

  // --- Model compare -----------------------------------------------------------
  // One prompt, two models, run SEQUENTIALLY: the worker holds one model at a
  // time, so each run gets the whole machine — fair timings and no memory
  // gamble. Each slot goes through the same admission check as a normal chat;
  // a model that doesn't fit shows its honest refusal in that column.
  const abortedCompares = new Set<string>()
  ipcMain.handle(
    'compare:run',
    async (_event, payload: { requestId: string; prompt: string; modelPaths: string[] }) => {
      const requestId = typeof payload?.requestId === 'string' ? payload.requestId : ''
      const prompt = typeof payload?.prompt === 'string' ? payload.prompt.trim() : ''
      const modelPaths = Array.isArray(payload?.modelPaths) ? payload.modelPaths.slice(0, 2) : []
      if (!requestId || !prompt || modelPaths.length !== 2) return { ok: false }
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
  ipcMain.handle('compare:stop', (_event, requestId: string) => {
    if (typeof requestId !== 'string') return false
    abortedCompares.add(requestId)
    // Abort whichever slot is currently generating; pending slots are skipped.
    for (const slot of [0, 1]) void llm.stopChat(`${requestId}-slot${slot}`)
    return true
  })
  ipcMain.handle('chat:unload', () => llm.unloadModel())
}
