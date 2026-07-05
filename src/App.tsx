import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  BrainCircuit,
  ChevronDown,
  Download,
  LoaderCircle,
  MessageSquareText,
  Plus,
  Power as PowerIcon,
  Send,
  Settings as SettingsIcon,
  ShieldQuestion,
  Sparkles,
  Square,
  Trash2,
  Wrench,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { getDesktop } from './desktop'
import { Markdown } from './markdown'
import { ModelsView, MonitorView, SettingsView, UtilitiesView } from './views'
import type { DownloadState, MetricSeries } from './views'
import { OnboardingFlow } from './onboarding'
import { CopyButton, formatNumber } from './ui'
import type {
  BenchmarkRecord,
  Catalog,
  CatalogModel,
  ChatStatusPayload,
  ChatSummary,
  ChatTurn,
  DeviceInfo,
  FitReport,
  McpServerStatus,
  ModelInfo,
  OnboardingState,
  PermissionRequest,
  RuntimeEventPayload,
  Settings,
  StoredChat,
  StoredChatMessage,
  TelemetrySnapshot,
  ToolCallingTier,
  UpdateState,
} from './types'
import './App.css'

type ViewId = 'chat' | 'monitor' | 'models' | 'utilities' | 'settings'

const bridge = getDesktop()

const navItems: Array<{ id: ViewId; label: string; icon: LucideIcon }> = [
  { id: 'chat', label: 'Chat', icon: MessageSquareText },
  { id: 'monitor', label: 'Monitor', icon: Activity },
  { id: 'models', label: 'Models', icon: BrainCircuit },
  { id: 'utilities', label: 'Utilities', icon: Wrench },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
]

const SERIES_LENGTH = 28
const emptySeries = (): MetricSeries => ({
  cpu: Array(SERIES_LENGTH).fill(0),
  ram: Array(SERIES_LENGTH).fill(0),
  gpu: Array(SERIES_LENGTH).fill(0),
  vram: Array(SERIES_LENGTH).fill(0),
  storage: Array(SERIES_LENGTH).fill(0),
  power: Array(SERIES_LENGTH).fill(0),
  thermal: Array(SERIES_LENGTH).fill(0),
})
const pushSeries = (arr: number[], value: number) => [...arr.slice(1), Math.max(0, Math.min(100, value))]

const statusText = (payload: ChatStatusPayload): string =>
  ({
    starting: 'Preparing…',
    'loading-model': 'Loading model into memory…',
    'creating-context': 'Allocating context…',
    ready: 'Ready',
    generating: 'Generating…',
  })[payload.phase] ?? 'Working…'

// --- Data hooks -------------------------------------------------------------

function useSettings() {
  const [settings, setSettings] = useState<Settings | null>(null)
  useEffect(() => {
    void bridge.settings.get().then(setSettings)
  }, [])
  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => (prev ? { ...prev, ...patch } : prev))
    void bridge.settings.update(patch)
  }, [])
  return { settings, update }
}

// The single owner of onboarding completion: updates renderer state AND
// persists in one place, so no exit path can leave the flag unwritten.
function useOnboarding() {
  const [onboarding, setOnboarding] = useState<OnboardingState | null>(null)
  useEffect(() => {
    void bridge.onboarding.get().then(setOnboarding)
  }, [])
  const complete = useCallback((payload: { useCase?: string; priority?: string }) => {
    setOnboarding({ completed: true, useCase: payload.useCase ?? null, priority: payload.priority ?? null })
    void bridge.onboarding.complete(payload)
  }, [])
  return { onboarding, complete }
}

function useCatalog() {
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [fitReports, setFitReports] = useState<Record<string, FitReport | null>>({})
  const [refreshing, setRefreshing] = useState(false)

  const loadFits = useCallback(async (models: CatalogModel[]) => {
    const entries = await Promise.all(
      models.map(async (model) => [model.id, await bridge.catalog.fitCheck({ catalogId: model.id }).catch(() => null)] as const),
    )
    setFitReports(Object.fromEntries(entries))
  }, [])

  useEffect(() => {
    void bridge.catalog.get().then((result) => {
      setCatalog(result)
      void loadFits(result.models)
      // Quietly look for a newer catalog in the background on every launch.
      void bridge.catalog.refresh().then((fresh) => {
        if (fresh.updatedAt !== result.updatedAt) {
          setCatalog(fresh)
          void loadFits(fresh.models)
        }
      })
    })
  }, [loadFits])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      const fresh = await bridge.catalog.refresh()
      setCatalog(fresh)
      await loadFits(fresh.models)
    } finally {
      setRefreshing(false)
    }
  }, [loadFits])

  return { catalog, fitReports, refresh, refreshing }
}

function useModels() {
  const [models, setModels] = useState<ModelInfo[]>([])
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const [list, selected] = await Promise.all([bridge.models.list(), bridge.models.getSelected()])
    let next = selected && list.some((model) => model.path === selected) ? selected : null
    if (!next && list.length) {
      next = list[0].path
      await bridge.models.select(next)
    }
    setModels(list)
    setSelectedPath(next)
    setLoading(false)
    return list
  }, [])

  useEffect(() => {
    // One-shot load on mount; state is set after awaited IPC, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh()
  }, [refresh])

  const select = useCallback(async (path: string | null) => {
    setSelectedPath(path)
    await bridge.models.select(path)
  }, [])

  return { models, selectedPath, loading, refresh, select }
}

function useTelemetry() {
  const [snapshot, setSnapshot] = useState<TelemetrySnapshot | null>(null)
  const [series, setSeries] = useState<MetricSeries>(emptySeries)
  useEffect(() => {
    return bridge.telemetry.onUpdate((snap) => {
      setSnapshot(snap)
      setSeries((prev) => ({
        cpu: pushSeries(prev.cpu, snap.cpu.load),
        ram: pushSeries(prev.ram, snap.ram.totalGb ? (snap.ram.usedGb / snap.ram.totalGb) * 100 : 0),
        gpu: pushSeries(prev.gpu, snap.gpu.load ?? 0),
        vram: pushSeries(prev.vram, snap.vram.totalGb ? ((snap.vram.usedGb ?? 0) / snap.vram.totalGb) * 100 : 0),
        storage: pushSeries(prev.storage, snap.storage.totalGb ? (snap.storage.usedGb / snap.storage.totalGb) * 100 : 0),
        power: pushSeries(prev.power, (snap.power.watts / 120) * 100),
        thermal: pushSeries(prev.thermal, snap.thermal.headroomPct),
      }))
    })
  }, [])
  return { snapshot, series }
}

function useDevice() {
  const [device, setDevice] = useState<DeviceInfo | null>(null)
  useEffect(() => {
    void bridge.device.info().then(setDevice).catch(() => undefined)
  }, [])
  return device
}

function useMcpStatuses() {
  const [statuses, setStatuses] = useState<McpServerStatus[]>([])
  useEffect(() => {
    void bridge.mcp.statuses().then(setStatuses)
    return bridge.mcp.onStatus(setStatuses)
  }, [])
  return statuses
}

function usePermissionPrompt() {
  const [request, setRequest] = useState<PermissionRequest | null>(null)
  const queue = useRef<PermissionRequest[]>([])
  useEffect(() => {
    const offRequest = bridge.agent.onPermissionRequest((payload) => {
      setRequest((current) => {
        if (current) {
          queue.current.push(payload)
          return current
        }
        return payload
      })
    })
    // The main process auto-denies prompts after a timeout — dismiss the modal
    // so a late "Allow" click can't appear to grant something already denied.
    const offExpired = bridge.agent.onPermissionExpired(({ promptId }) => {
      queue.current = queue.current.filter((item) => item.promptId !== promptId)
      setRequest((current) => (current?.promptId === promptId ? queue.current.shift() ?? null : current))
    })
    return () => {
      offRequest()
      offExpired()
    }
  }, [])
  const respond = useCallback((promptId: string, decision: 'allow-once' | 'allow-always' | 'deny') => {
    void bridge.agent.respondPermission({ promptId, decision })
    setRequest(queue.current.shift() ?? null)
  }, [])
  return { request, respond }
}

function useRuntimeEvents() {
  const [event, setEvent] = useState<RuntimeEventPayload | null>(null)
  useEffect(() => {
    return bridge.runtimeEvents.onEvent(setEvent)
  }, [])
  return { event, dismiss: () => setEvent(null) }
}

function useUpdates() {
  const [updateState, setUpdateState] = useState<UpdateState | null>(null)

  useEffect(() => {
    void bridge.updates.getState().then(setUpdateState)
    const unsubscribe = bridge.updates.onState(setUpdateState)
    void bridge.updates.check().catch((error) => {
      setUpdateState((current) =>
        current
          ? { ...current, phase: 'error', message: error instanceof Error ? error.message : String(error) }
          : null,
      )
    })
    return unsubscribe
  }, [])

  const installLatest = useCallback(() => {
    void bridge.updates.installLatest().then(setUpdateState).catch((error) => {
      setUpdateState((current) =>
        current
          ? { ...current, phase: 'error', message: error instanceof Error ? error.message : String(error) }
          : null,
      )
    })
  }, [])

  return { installLatest, updateState }
}

function useChatHistory() {
  const [summaries, setSummaries] = useState<ChatSummary[]>([])
  const refresh = useCallback(async () => {
    const list = await bridge.chats.list().catch(() => [])
    setSummaries(list)
  }, [])
  useEffect(() => {
    // One-shot load on mount; state is set after awaited IPC, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh()
  }, [refresh])
  return { summaries, refresh }
}

function useBenchmarks() {
  const [results, setResults] = useState<Record<string, BenchmarkRecord>>({})
  const refresh = useCallback(async () => {
    const map = await bridge.bench.results().catch(() => ({}))
    setResults(map)
  }, [])
  useEffect(() => {
    // One-shot load on mount; state is set after awaited IPC, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh()
  }, [refresh])
  return { results, refresh }
}

function useChat() {
  const [messages, setMessages] = useState<ChatTurn[]>([])
  const [streaming, setStreaming] = useState(false)
  const [chatId, setChatId] = useState<string | null>(null)
  const activeRef = useRef<string | null>(null)
  // Set when a persisted chat is loaded; sent once with the next message so
  // the worker replays the conversation into the model's context.
  const replayRef = useRef<Array<{ role: 'user' | 'assistant'; text: string }> | null>(null)

  const patchAssistant = useCallback((requestId: string, patch: (turn: ChatTurn) => ChatTurn) => {
    setMessages((prev) =>
      prev.map((message) => (message.requestId === requestId && message.role === 'assistant' ? patch(message) : message)),
    )
  }, [])

  useEffect(() => {
    const offToken = bridge.chat.onToken(({ requestId, token }) => {
      if (activeRef.current !== requestId) return
      patchAssistant(requestId, (turn) => ({ ...turn, content: turn.content + token, status: undefined }))
    })
    const offStatus = bridge.chat.onStatus((payload) => {
      if (activeRef.current !== payload.requestId) return
      patchAssistant(payload.requestId, (turn) =>
        !turn.content ? { ...turn, status: statusText(payload) } : turn,
      )
    })
    const offAdmission = bridge.chat.onAdmission((payload) => {
      patchAssistant(payload.requestId, (turn) => ({ ...turn, admission: payload }))
    })
    const offToolCall = bridge.chat.onToolCall(({ requestId, toolKey, args }) => {
      patchAssistant(requestId, (turn) => ({
        ...turn,
        status: undefined,
        toolCalls: [...(turn.toolCalls ?? []), { toolKey, args, ok: null, summary: null }],
      }))
    })
    const offToolResult = bridge.chat.onToolResult(({ requestId, toolKey, ok, summary }) => {
      patchAssistant(requestId, (turn) => {
        const calls = [...(turn.toolCalls ?? [])]
        for (let i = calls.length - 1; i >= 0; i--) {
          if (calls[i].toolKey === toolKey && calls[i].ok === null) {
            calls[i] = { ...calls[i], ok, summary }
            break
          }
        }
        return { ...turn, toolCalls: calls }
      })
    })
    const offDone = bridge.chat.onDone(({ requestId, tokensPerSec, aborted, haltReason }) => {
      if (activeRef.current !== requestId) return
      patchAssistant(requestId, (turn) => ({
        ...turn,
        streaming: false,
        status: undefined,
        tokensPerSec,
        aborted,
        haltReason,
      }))
      setStreaming(false)
      activeRef.current = null
    })
    const offError = bridge.chat.onError(({ requestId, message }) => {
      patchAssistant(requestId, (turn) => ({ ...turn, streaming: false, status: undefined, error: message }))
      if (activeRef.current === requestId) {
        setStreaming(false)
        activeRef.current = null
      }
    })
    return () => {
      offToken()
      offStatus()
      offAdmission()
      offToolCall()
      offToolResult()
      offDone()
      offError()
    }
  }, [patchAssistant])

  const send = useCallback((text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    const requestId = `req-${Date.now()}-${Math.round(Math.random() * 1e6)}`
    activeRef.current = requestId
    setStreaming(true)
    setMessages((prev) => [
      ...prev,
      { id: `u-${requestId}`, role: 'user', content: trimmed },
      { id: `a-${requestId}`, role: 'assistant', content: '', requestId, streaming: true, status: 'Preparing…' },
    ])
    const history = replayRef.current ?? undefined
    replayRef.current = null
    void bridge.chat.send({ requestId, prompt: trimmed, history })
  }, [])

  const stop = useCallback(() => {
    if (activeRef.current) void bridge.chat.stop(activeRef.current)
  }, [])

  const reset = useCallback(() => {
    activeRef.current = null
    replayRef.current = null
    setStreaming(false)
    setMessages([])
    setChatId(null)
    void bridge.chat.reset()
  }, [])

  const loadChat = useCallback((stored: StoredChat) => {
    activeRef.current = null
    setStreaming(false)
    setChatId(stored.id)
    replayRef.current = stored.messages.map((m) => ({ role: m.role, text: m.content }))
    setMessages(
      stored.messages.map((m, index) => ({
        id: `s-${stored.id}-${index}`,
        role: m.role,
        content: m.content,
        tokensPerSec: m.tokensPerSec,
      })),
    )
    // Fresh worker session; the saved turns replay with the next message.
    void bridge.chat.reset()
  }, [])

  return { messages, streaming, chatId, setChatId, send, stop, reset, loadChat }
}

function serializeChat(messages: ChatTurn[]): StoredChatMessage[] {
  return messages
    .filter((m) => m.content && !m.error && !m.streaming)
    .map((m) => ({
      role: m.role,
      content: m.content,
      ...(m.tokensPerSec ? { tokensPerSec: m.tokensPerSec } : {}),
    }))
}

// --- App shell --------------------------------------------------------------

function App() {
  const [activeView, setActiveView] = useState<ViewId>('chat')
  const { settings, update: updateSettings } = useSettings()
  const { onboarding, complete: completeOnboarding } = useOnboarding()
  const { catalog, fitReports, refresh: refreshCatalog, refreshing: catalogRefreshing } = useCatalog()
  const { models, selectedPath, refresh, select } = useModels()
  const { snapshot, series } = useTelemetry()
  const device = useDevice()
  const mcpStatuses = useMcpStatuses()
  const permissionPrompt = usePermissionPrompt()
  const runtimeEvents = useRuntimeEvents()
  const { installLatest, updateState } = useUpdates()
  const chat = useChat()
  const chatHistory = useChatHistory()
  const benchmarks = useBenchmarks()
  const refreshBenchmarks = benchmarks.refresh
  const [download, setDownload] = useState<DownloadState>(null)
  const [benchmarking, setBenchmarking] = useState(false)
  const [benchBusyPath, setBenchBusyPath] = useState<string | null>(null)
  const resetChat = chat.reset

  const selectedModel = useMemo(() => models.find((model) => model.path === selectedPath) ?? null, [models, selectedPath])
  // The capability tier is resolved by the main process on models:list — one
  // heuristic, one home.
  const selectedTier: ToolCallingTier = selectedModel?.toolCalling ?? 'none'
  const utilitiesDisabled = !selectedModel
  const visibleView = activeView === 'utilities' && utilitiesDisabled ? 'models' : activeView

  useEffect(() => {
    const offProgress = bridge.models.onDownloadProgress((payload) => {
      setDownload((current) =>
        current
          ? { ...current, id: payload.id, totalSize: payload.totalSize, downloadedSize: payload.downloadedSize }
          : { id: payload.id, uri: '', totalSize: payload.totalSize, downloadedSize: payload.downloadedSize },
      )
    })
    const offBenchmarking = bridge.models.onBenchmarking(() => setBenchmarking(true))
    const offDone = bridge.models.onDownloadDone((payload) => {
      setDownload(null)
      setBenchmarking(false)
      void (async () => {
        await select(payload.filePath)
        resetChat()
        await refresh()
        await refreshBenchmarks()
      })()
    })
    const offError = bridge.models.onDownloadError((payload) => {
      setBenchmarking(false)
      setDownload((current) => (current ? { ...current, error: payload.message } : current))
    })
    return () => {
      offProgress()
      offBenchmarking()
      offDone()
      offError()
    }
  }, [refresh, refreshBenchmarks, resetChat, select])

  // Autosave the conversation (debounced) whenever a turn settles. Files are
  // plain JSON in the user-data folder; saving is a setting, on by default.
  // The ref keeps the save-callback reading the current chat id without making
  // it an effect dependency (a fresh id must not re-trigger a save).
  const chatIdRef = useRef(chat.chatId)
  useEffect(() => {
    chatIdRef.current = chat.chatId
  }, [chat.chatId])
  useEffect(() => {
    if (chat.streaming || !settings?.saveChats) return
    const serialized = serializeChat(chat.messages)
    if (!serialized.length) return
    const timer = window.setTimeout(() => {
      void bridge.chats
        .save({ id: chatIdRef.current ?? undefined, messages: serialized, modelPath: selectedPath ?? undefined })
        .then((result) => {
          if (result?.id && result.id !== chatIdRef.current) chat.setChatId(result.id)
          void chatHistory.refresh()
        })
        .catch(() => undefined)
    }, 600)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.messages, chat.streaming, settings?.saveChats, selectedPath])

  const handleLoadChat = useCallback(
    async (id: string) => {
      const stored = await bridge.chats.get(id)
      if (!stored) {
        void chatHistory.refresh()
        return
      }
      chat.loadChat(stored)
      // Reselect the chat's model when it is still around, without wiping the
      // just-loaded messages.
      if (stored.modelPath && stored.modelPath !== selectedPath && models.some((m) => m.path === stored.modelPath)) {
        await select(stored.modelPath)
      }
      setActiveView('chat')
    },
    [chat, chatHistory, models, select, selectedPath],
  )

  const handleDeleteChat = useCallback(
    async (id: string) => {
      await bridge.chats.delete(id)
      if (chat.chatId === id) chat.reset()
      void chatHistory.refresh()
    },
    [chat, chatHistory],
  )

  const handleDeleteAllChats = useCallback(async () => {
    if (!window.confirm('Delete all saved chats from this machine? This cannot be undone.')) return
    await bridge.chats.deleteAll()
    chat.reset()
    void chatHistory.refresh()
  }, [chat, chatHistory])

  const handleBenchmark = useCallback(
    async (model: ModelInfo) => {
      if (chat.messages.length > 0 && !window.confirm('Benchmarking clears the current chat context. Continue?')) {
        return
      }
      setBenchBusyPath(model.path)
      try {
        await bridge.bench.run(model.path)
        if (chat.messages.length > 0) chat.reset()
        await Promise.all([refreshBenchmarks(), refresh()])
      } catch (error) {
        window.alert(error instanceof Error ? error.message : String(error))
      } finally {
        setBenchBusyPath(null)
      }
    },
    [chat, refresh, refreshBenchmarks],
  )

  const handleSelectModel = useCallback(
    async (path: string | null) => {
      if (path === selectedPath) return
      await select(path)
      chat.reset()
    },
    [chat, select, selectedPath],
  )

  const handleDownload = useCallback(async (uri: string) => {
    setDownload({ id: 'pending', uri, totalSize: 0, downloadedSize: 0 })
    try {
      await bridge.models.download(uri)
    } catch (error) {
      setDownload({ id: 'pending', uri, totalSize: 0, downloadedSize: 0, error: String(error) })
    }
  }, [])

  const handleOpenModelWebsite = useCallback((url: string) => {
    void bridge.app.openExternal(url).catch((error) => {
      window.alert(error instanceof Error ? error.message : String(error))
    })
  }, [])

  const handleImportFile = useCallback(async () => {
    await bridge.models.pickFile()
    await refresh()
  }, [refresh])

  const handleAddFolder = useCallback(async () => {
    await bridge.models.pickFolder()
    await refresh()
  }, [refresh])

  const handleRemove = useCallback(
    async (model: ModelInfo) => {
      await bridge.models.remove(model.path)
      await refresh()
    },
    [refresh],
  )

  const handleDelete = useCallback(
    async (model: ModelInfo) => {
      const confirmed = window.confirm(`Delete ${model.fileName} from disk? This permanently removes the file.`)
      if (!confirmed) return
      const result = await bridge.models.deleteFile(model.path)
      if (!result.deleted && result.reason) window.alert(result.reason)
      await refresh()
    },
    [refresh],
  )

  if (onboarding === null) return null

  if (!onboarding.completed) {
    return (
      <OnboardingFlow
        benchmarking={benchmarking}
        download={download}
        onDownload={handleDownload}
        onComplete={(payload) => {
          completeOnboarding(payload)
          setActiveView('chat')
        }}
        onSkipToModels={(payload) => {
          completeOnboarding(payload ?? {})
          setActiveView('models')
        }}
      />
    )
  }

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Primary">
        <button className="brand-mark" type="button" aria-label="PowerStation home" onClick={() => setActiveView('chat')}>
          <PowerIcon size={21} strokeWidth={2.4} />
          <span>PowerStation</span>
        </button>
        <nav className="nav-stack" aria-label="PowerStation sections">
          {navItems.map((item) => {
            const Icon = item.icon
            const disabled = item.id === 'utilities' && utilitiesDisabled
            return (
              <button
                className={`${item.id === visibleView ? 'nav-button active' : 'nav-button'}${disabled ? ' disabled' : ''}`}
                key={item.id}
                type="button"
                aria-label={item.label}
                aria-disabled={disabled}
                disabled={disabled}
                onClick={() => {
                  if (!disabled) setActiveView(item.id)
                }}
              >
                <Icon size={19} strokeWidth={2.1} />
                <span>{item.label}</span>
              </button>
            )
          })}
        </nav>

        <button className="new-chat-button" type="button" onClick={chat.reset}>
          <Plus size={16} />
          New chat
        </button>

        {chatHistory.summaries.length > 0 ? (
          <div className="chat-list" aria-label="Recent chats">
            <span className="chat-list-title">Recent</span>
            <div className="chat-list-scroll">
              {chatHistory.summaries.map((summary) => (
                <div className={summary.id === chat.chatId ? 'chat-item active' : 'chat-item'} key={summary.id}>
                  <button
                    className="chat-item-main"
                    type="button"
                    title={summary.title}
                    onClick={() => void handleLoadChat(summary.id)}
                  >
                    {summary.title}
                  </button>
                  <button
                    className="chat-item-delete"
                    type="button"
                    aria-label={`Delete chat: ${summary.title}`}
                    onClick={() => void handleDeleteChat(summary.id)}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <UpdateButton onUpdate={installLatest} state={updateState} />

        <div className="rail-status" title={snapshot?.model.loaded ? 'Model loaded' : 'No model loaded'}>
          <span className={snapshot?.model.loaded ? 'status-dot live' : 'status-dot'} />
          <span>{snapshot?.model.loaded ? 'Model loaded' : 'Idle'}</span>
        </div>
      </aside>

      <main className="app-main">
        {visibleView === 'chat' && (
          <ChatView
            messages={chat.messages}
            models={models}
            onManageModels={() => setActiveView('models')}
            onNewChat={chat.reset}
            onOpenMonitor={() => setActiveView('monitor')}
            onSelectModel={handleSelectModel}
            onSend={chat.send}
            onStop={chat.stop}
            runtimeEvent={runtimeEvents.event}
            onDismissRuntimeEvent={runtimeEvents.dismiss}
            selectedModel={selectedModel}
            snapshot={snapshot}
            streaming={chat.streaming}
          />
        )}
        {visibleView === 'monitor' && <MonitorView device={device} series={series} snapshot={snapshot} />}
        {visibleView === 'models' && (
          <div className="scroll-view">
            <ModelsView
              benchBusyPath={benchBusyPath}
              benchResults={benchmarks.results}
              benchmarking={benchmarking}
              catalog={catalog}
              catalogRefreshing={catalogRefreshing}
              device={device}
              download={download}
              fitReports={fitReports}
              models={models}
              onAddFolder={handleAddFolder}
              onBenchmark={(model) => void handleBenchmark(model)}
              onDelete={handleDelete}
              onDownload={handleDownload}
              onOpenWebsite={handleOpenModelWebsite}
              onImportFile={handleImportFile}
              onRefreshCatalog={() => void refreshCatalog()}
              onRemove={handleRemove}
              onReveal={(model) => void bridge.models.reveal(model.path)}
              onSelect={(model) => void handleSelectModel(model.path)}
              selectedPath={selectedPath}
            />
          </div>
        )}
        {visibleView === 'utilities' && (
          <div className="scroll-view">
            <UtilitiesView
              enabled={Boolean(selectedModel)}
              mcpStatuses={mcpStatuses}
              onSettingsChange={updateSettings}
              selectedModel={selectedModel}
              selectedTier={selectedTier}
              settings={settings}
            />
          </div>
        )}
        {visibleView === 'settings' && (
          <div className="scroll-view">
            {settings ? (
              <SettingsView
                onChange={updateSettings}
                onDeleteAllChats={() => void handleDeleteAllChats()}
                onRevealChats={() => void bridge.chats.reveal()}
                settings={settings}
              />
            ) : null}
          </div>
        )}
      </main>

      {permissionPrompt.request ? (
        <PermissionModal request={permissionPrompt.request} onRespond={permissionPrompt.respond} />
      ) : null}
    </div>
  )
}

function UpdateButton({ onUpdate, state }: { onUpdate: () => void; state: UpdateState | null }) {
  if (!state) return null

  const downloading = state.phase === 'downloading'
  const configurationError =
    state.phase === 'error' && Boolean(state.message?.match(/private|release feed|update metadata/i))
  const shouldShow =
    state.phase === 'available' ||
    state.phase === 'downloading' ||
    state.phase === 'downloaded' ||
    (state.phase === 'error' && Boolean(state.latestVersion) && !configurationError)

  if (!shouldShow) return null

  const label =
    state.phase === 'available'
      ? state.latestVersion
        ? `Update ${state.latestVersion}`
        : 'Update'
      : state.phase === 'downloaded'
        ? 'Restart to update'
        : state.phase === 'error'
          ? configurationError
            ? 'Updates unavailable'
            : 'Retry update'
          : `Updating ${Math.round(state.progressPct ?? 0)}%`

  return (
    <button
      className={`update-button ${state.phase}`}
      type="button"
      onClick={onUpdate}
      disabled={downloading || configurationError}
      title={
        state.message ??
        (state.latestVersion ? `Latest version ${state.latestVersion}` : 'Check for PowerStation updates')
      }
    >
      {downloading ? <LoaderCircle className="spin-icon" size={15} /> : <Download size={15} />}
      <span>{label}</span>
    </button>
  )
}

// --- Status pill --------------------------------------------------------------

function StatusPill({
  onOpenMonitor,
  snapshot,
  streaming,
}: {
  onOpenMonitor: () => void
  snapshot: TelemetrySnapshot | null
  streaming: boolean
}) {
  if (!snapshot) return <span className="runtime-pill subtle">Starting…</span>

  const pressure = snapshot.pressure.level
  const ramPct = snapshot.ram.totalGb ? (snapshot.ram.usedGb / snapshot.ram.totalGb) * 100 : 0
  const tone = pressure === 'critical' ? 'critical' : pressure === 'warn' || ramPct > 88 ? 'warn' : 'ok'
  const label =
    tone === 'critical'
      ? 'Memory critical'
      : tone === 'warn'
        ? 'Memory getting tight'
        : streaming && snapshot.tokensPerSec > 0
          ? `Running smoothly · ${formatNumber(snapshot.tokensPerSec, 1)} tok/s`
          : snapshot.model.loaded
            ? snapshot.tokensPerSec > 0
              ? `Ready · last run ${formatNumber(snapshot.tokensPerSec, 1)} tok/s`
              : 'Ready'
            : 'No model loaded'

  return (
    <button className={`status-pill ${tone}`} type="button" onClick={onOpenMonitor} title="Open the full monitor">
      <span className="status-dot-pill" />
      {label}
    </button>
  )
}

// --- Chat view --------------------------------------------------------------

function ChatView({
  messages,
  models,
  onManageModels,
  onNewChat,
  onOpenMonitor,
  onSelectModel,
  onSend,
  onStop,
  runtimeEvent,
  onDismissRuntimeEvent,
  selectedModel,
  snapshot,
  streaming,
}: {
  messages: ChatTurn[]
  models: ModelInfo[]
  onManageModels: () => void
  onNewChat: () => void
  onOpenMonitor: () => void
  onSelectModel: (path: string) => void
  onSend: (text: string) => void
  onStop: () => void
  runtimeEvent: RuntimeEventPayload | null
  onDismissRuntimeEvent: () => void
  selectedModel: ModelInfo | null
  snapshot: TelemetrySnapshot | null
  streaming: boolean
}) {
  const bottomRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages])

  const hasModels = models.length > 0

  return (
    <div className="chat-view">
      <header className="chat-header">
        <ModelPicker
          models={models}
          onManageModels={onManageModels}
          onSelectModel={onSelectModel}
          selectedModel={selectedModel}
        />
        <div className="chat-header-right">
          <StatusPill onOpenMonitor={onOpenMonitor} snapshot={snapshot} streaming={streaming} />
          <button className="secondary-button compact" type="button" onClick={onNewChat} disabled={messages.length === 0}>
            <Plus size={14} />
            New chat
          </button>
        </div>
      </header>

      <div className="chat-scroll">
        {messages.length === 0 ? (
          hasModels ? (
            <div className="chat-welcome">
              <div className="welcome-glyph">
                <Sparkles size={26} />
              </div>
              <h1>Chat with {selectedModel ? selectedModel.name : 'a local model'}</h1>
              <p>Runs entirely on this machine. Your prompts never leave the device.</p>
            </div>
          ) : (
            <div className="chat-welcome">
              <div className="welcome-glyph">
                <BrainCircuit size={26} />
              </div>
              <h1>No model installed yet</h1>
              <p>Pick a model matched to this Mac from the catalog to get started.</p>
              <button className="primary-button" type="button" onClick={onManageModels}>
                Browse models
              </button>
            </div>
          )
        ) : (
          <div className="message-column">
            {messages.map((message) => (
              <MessageBubble key={message.id} message={message} modelName={selectedModel?.name ?? 'Model'} />
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {runtimeEvent ? (
        <div className={`runtime-card ${runtimeEvent.type}`} role="alert">
          <AlertTriangle size={17} />
          <div>
            <strong>{runtimeEvent.type === 'crashed' ? 'The model runtime crashed — PowerStation recovered' : 'Paused to protect your system'}</strong>
            <p>{runtimeEvent.message}</p>
          </div>
          <div className="runtime-card-actions">
            <button className="secondary-button compact" type="button" onClick={onManageModels}>
              Switch model
            </button>
            <button className="ghost-button" type="button" aria-label="Dismiss" onClick={onDismissRuntimeEvent}>
              <X size={15} />
            </button>
          </div>
        </div>
      ) : null}

      <Composer disabled={!hasModels || !selectedModel} onSend={onSend} onStop={onStop} streaming={streaming} />
    </div>
  )
}

function ModelPicker({
  models,
  onManageModels,
  onSelectModel,
  selectedModel,
}: {
  models: ModelInfo[]
  onManageModels: () => void
  onSelectModel: (path: string) => void
  selectedModel: ModelInfo | null
}) {
  const [open, setOpen] = useState(false)

  if (models.length === 0) {
    return (
      <button className="model-picker empty" type="button" onClick={onManageModels}>
        <BrainCircuit size={16} />
        Add a model
      </button>
    )
  }

  return (
    <div className="model-picker-wrap">
      <button className="model-picker" type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <BrainCircuit size={16} />
        <span className="model-picker-name">{selectedModel?.name ?? 'Select a model'}</span>
        {selectedModel?.parameters ? <span className="model-picker-tag">{selectedModel.parameters}</span> : null}
        <ChevronDown size={15} />
      </button>
      {open ? (
        <>
          <div className="picker-backdrop" onClick={() => setOpen(false)} />
          <div className="picker-menu" role="listbox">
            {models.map((model) => (
              <button
                className={model.path === selectedModel?.path ? 'picker-item active' : 'picker-item'}
                key={model.path}
                type="button"
                onClick={() => {
                  onSelectModel(model.path)
                  setOpen(false)
                }}
              >
                <span className="picker-item-main">
                  <strong>{model.name}</strong>
                  <small>
                    {[model.parameters, model.quantization].filter(Boolean).join(' · ') || model.fileName}
                  </small>
                </span>
              </button>
            ))}
            <button
              className="picker-manage"
              type="button"
              onClick={() => {
                onManageModels()
                setOpen(false)
              }}
            >
              Manage models…
            </button>
          </div>
        </>
      ) : null}
    </div>
  )
}

function MessageBubble({ message, modelName }: { message: ChatTurn; modelName: string }) {
  if (message.role === 'user') {
    return (
      <article className="message user">
        <div className="bubble user-bubble">{message.content}</div>
      </article>
    )
  }

  const showStatus = message.streaming && !message.content && !message.error && !(message.toolCalls?.length)
  const slow = !message.streaming && !message.error && message.tokensPerSec !== undefined && message.tokensPerSec > 0 && message.tokensPerSec < 5

  return (
    <article className="message assistant">
      <div className="assistant-head">
        <span className="assistant-name">{modelName}</span>
        {message.streaming ? <span className="caret-dot" /> : null}
      </div>

      {message.admission && (message.admission.verdict === 'tight' || message.admission.schemaTokens > 0) ? (
        <div className="admission-line" title={message.admission.summary}>
          {message.admission.verdict === 'tight'
            ? `Context capped at ${message.admission.contextTokens.toLocaleString()} tokens to fit memory safely.`
            : null}
          {message.admission.schemaTokens > 0
            ? ` ${message.admission.toolCount} tools connected (~${message.admission.schemaTokens.toLocaleString()} tokens of context).`
            : null}
        </div>
      ) : null}

      {message.toolCalls?.length ? (
        <div className="tool-call-stack">
          {message.toolCalls.map((call, index) => (
            <div className={`tool-call ${call.ok === null ? 'running' : call.ok ? 'done' : 'failed'}`} key={`${call.toolKey}-${index}`}>
              <Wrench size={13} />
              <span className="tool-call-name">{call.toolKey}</span>
              <span className="tool-call-state">
                {call.ok === null ? 'running…' : call.ok ? 'done' : 'failed'}
              </span>
              {call.summary ? <span className="tool-call-summary" title={call.summary}>{call.summary}</span> : null}
            </div>
          ))}
        </div>
      ) : null}

      {message.error ? (
        <div className="assistant-error">{message.error}</div>
      ) : showStatus ? (
        <div className="assistant-status">
          <span className="spinner" />
          {message.status}
        </div>
      ) : (
        <Markdown source={message.content} />
      )}

      {message.haltReason ? (
        <div className="halt-note">
          {message.haltReason === 'repeated-call'
            ? 'Stopped: the model tried the exact same tool call three times. Rephrase the request or try a more capable model.'
            : 'Stopped: this turn hit its tool-call budget. Send a follow-up message to continue.'}
        </div>
      ) : null}

      {!message.streaming && !message.error && message.content ? (
        <div className="assistant-foot">
          <CopyButton text={message.content} />
          {message.aborted ? <span className="muted">stopped</span> : null}
          {message.tokensPerSec ? <span className="muted">{formatNumber(message.tokensPerSec, 1)} tok/s</span> : null}
          {slow ? <span className="muted slow-hint">This model runs slowly on your machine — consider a smaller one from Models.</span> : null}
        </div>
      ) : null}
    </article>
  )
}

// --- Permission modal ----------------------------------------------------------

function PermissionModal({
  request,
  onRespond,
}: {
  request: PermissionRequest
  onRespond: (promptId: string, decision: 'allow-once' | 'allow-always' | 'deny') => void
}) {
  const argsPreview = useMemo(() => {
    try {
      const text = JSON.stringify(request.args, null, 2) ?? '{}'
      return text.length > 1200 ? `${text.slice(0, 1200)}…` : text
    } catch {
      return String(request.args)
    }
  }, [request.args])

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Tool permission request">
      <div className="permission-modal">
        <div className="permission-head">
          <ShieldQuestion size={20} />
          <div>
            <h3>Allow this tool call?</h3>
            <p>
              The model wants to run <strong>{request.toolName}</strong> from <strong>{request.serverName}</strong>.
            </p>
          </div>
        </div>
        <pre className="permission-args">{argsPreview}</pre>
        <p className="permission-note">
          Tools run on your machine with your permissions. Only allow calls you understand.
        </p>
        <div className="permission-actions">
          <button className="secondary-button" type="button" onClick={() => onRespond(request.promptId, 'deny')}>
            Deny
          </button>
          <div className="permission-allow">
            <button className="secondary-button" type="button" onClick={() => onRespond(request.promptId, 'allow-always')}>
              Always allow
            </button>
            <button className="primary-button" type="button" onClick={() => onRespond(request.promptId, 'allow-once')}>
              Allow once
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Composer({
  disabled,
  onSend,
  onStop,
  streaming,
}: {
  disabled: boolean
  onSend: (text: string) => void
  onStop: () => void
  streaming: boolean
}) {
  const [value, setValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const resize = () => {
    const node = textareaRef.current
    if (!node) return
    node.style.height = 'auto'
    node.style.height = `${Math.min(node.scrollHeight, 220)}px`
  }

  const submit = () => {
    if (disabled || streaming) return
    const trimmed = value.trim()
    if (!trimmed) return
    onSend(trimmed)
    setValue('')
    window.requestAnimationFrame(resize)
  }

  return (
    <div className="composer">
      <div className="composer-inner">
        <textarea
          ref={textareaRef}
          aria-label="Message"
          placeholder={disabled ? 'Add and select a model to start chatting' : 'Message your local model…'}
          rows={1}
          value={value}
          disabled={disabled}
          onChange={(event) => {
            setValue(event.target.value)
            resize()
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              submit()
            }
          }}
        />
        {streaming ? (
          <button className="stop-button" type="button" onClick={onStop} aria-label="Stop generating">
            <Square size={14} fill="currentColor" />
          </button>
        ) : (
          <button
            className="send-button"
            type="button"
            onClick={submit}
            disabled={disabled || !value.trim()}
            aria-label="Send message"
          >
            <Send size={16} />
          </button>
        )}
      </div>
      <p className="composer-hint">
        {streaming ? 'Generating… press stop to interrupt' : 'Enter to send · Shift + Enter for a new line'}
      </p>
    </div>
  )
}

export default App
