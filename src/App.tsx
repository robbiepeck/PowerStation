import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  BrainCircuit,
  ChevronDown,
  Download,
  LoaderCircle,
  MessageSquareText,
  Plus,
  Power as PowerIcon,
  Send,
  Settings as SettingsIcon,
  Sparkles,
  Square,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { getDesktop } from './desktop'
import { Markdown } from './markdown'
import { ModelsView, MonitorView, SettingsView } from './views'
import type { DownloadState, MetricSeries } from './views'
import { CopyButton, formatNumber } from './ui'
import type { ChatStatusPayload, ChatTurn, DeviceInfo, ModelInfo, Settings, TelemetrySnapshot, UpdateState } from './types'
import './App.css'

type ViewId = 'chat' | 'monitor' | 'models' | 'settings'

const bridge = getDesktop()

const navItems: Array<{ id: ViewId; label: string; icon: LucideIcon }> = [
  { id: 'chat', label: 'Chat', icon: MessageSquareText },
  { id: 'monitor', label: 'Monitor', icon: Activity },
  { id: 'models', label: 'Models', icon: BrainCircuit },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
]

const SERIES_LENGTH = 28
const emptySeries = (): MetricSeries => ({
  cpu: Array(SERIES_LENGTH).fill(0),
  ram: Array(SERIES_LENGTH).fill(0),
  gpu: Array(SERIES_LENGTH).fill(0),
  vram: Array(SERIES_LENGTH).fill(0),
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

function useChat() {
  const [messages, setMessages] = useState<ChatTurn[]>([])
  const [streaming, setStreaming] = useState(false)
  const activeRef = useRef<string | null>(null)

  useEffect(() => {
    const offToken = bridge.chat.onToken(({ requestId, token }) => {
      if (activeRef.current !== requestId) return
      setMessages((prev) =>
        prev.map((message) =>
          message.requestId === requestId && message.role === 'assistant'
            ? { ...message, content: message.content + token, status: undefined }
            : message,
        ),
      )
    })
    const offStatus = bridge.chat.onStatus((payload) => {
      if (activeRef.current !== payload.requestId) return
      setMessages((prev) =>
        prev.map((message) =>
          message.requestId === payload.requestId && message.role === 'assistant' && !message.content
            ? { ...message, status: statusText(payload) }
            : message,
        ),
      )
    })
    const offDone = bridge.chat.onDone(({ requestId, tokensPerSec, aborted }) => {
      if (activeRef.current !== requestId) return
      setMessages((prev) =>
        prev.map((message) =>
          message.requestId === requestId && message.role === 'assistant'
            ? { ...message, streaming: false, status: undefined, tokensPerSec, aborted }
            : message,
        ),
      )
      setStreaming(false)
      activeRef.current = null
    })
    const offError = bridge.chat.onError(({ requestId, message }) => {
      setMessages((prev) =>
        prev.map((turn) =>
          turn.requestId === requestId && turn.role === 'assistant'
            ? { ...turn, streaming: false, status: undefined, error: message }
            : turn,
        ),
      )
      if (activeRef.current === requestId) {
        setStreaming(false)
        activeRef.current = null
      }
    })
    return () => {
      offToken()
      offStatus()
      offDone()
      offError()
    }
  }, [])

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
    void bridge.chat.send({ requestId, prompt: trimmed })
  }, [])

  const stop = useCallback(() => {
    if (activeRef.current) void bridge.chat.stop(activeRef.current)
  }, [])

  const reset = useCallback(() => {
    activeRef.current = null
    setStreaming(false)
    setMessages([])
    void bridge.chat.reset()
  }, [])

  return { messages, streaming, send, stop, reset }
}

// --- App shell --------------------------------------------------------------

function App() {
  const [activeView, setActiveView] = useState<ViewId>('chat')
  const { settings, update: updateSettings } = useSettings()
  const { models, selectedPath, refresh, select } = useModels()
  const { snapshot, series } = useTelemetry()
  const device = useDevice()
  const { installLatest, updateState } = useUpdates()
  const chat = useChat()
  const [download, setDownload] = useState<DownloadState>(null)

  const selectedModel = useMemo(() => models.find((model) => model.path === selectedPath) ?? null, [models, selectedPath])

  useEffect(() => {
    const offProgress = bridge.models.onDownloadProgress((payload) => {
      setDownload((current) =>
        current
          ? { ...current, id: payload.id, totalSize: payload.totalSize, downloadedSize: payload.downloadedSize }
          : { id: payload.id, uri: '', totalSize: payload.totalSize, downloadedSize: payload.downloadedSize },
      )
    })
    const offDone = bridge.models.onDownloadDone(() => {
      setDownload(null)
      void refresh()
    })
    const offError = bridge.models.onDownloadError((payload) => {
      setDownload((current) => (current ? { ...current, error: payload.message } : current))
    })
    return () => {
      offProgress()
      offDone()
      offError()
    }
  }, [refresh])

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
            return (
              <button
                className={item.id === activeView ? 'nav-button active' : 'nav-button'}
                key={item.id}
                type="button"
                aria-label={item.label}
                onClick={() => setActiveView(item.id)}
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

        <UpdateButton onUpdate={installLatest} state={updateState} />

        <div className="rail-status" title={snapshot?.model.loaded ? 'Model loaded' : 'No model loaded'}>
          <span className={snapshot?.model.loaded ? 'status-dot live' : 'status-dot'} />
          <span>{snapshot?.model.loaded ? 'Model loaded' : 'Idle'}</span>
        </div>
      </aside>

      <main className="app-main">
        {activeView === 'chat' && (
          <ChatView
            device={device}
            messages={chat.messages}
            models={models}
            onManageModels={() => setActiveView('models')}
            onNewChat={chat.reset}
            onSelectModel={handleSelectModel}
            onSend={chat.send}
            onStop={chat.stop}
            selectedModel={selectedModel}
            snapshot={snapshot}
            streaming={chat.streaming}
          />
        )}
        {activeView === 'monitor' && <MonitorView device={device} series={series} snapshot={snapshot} />}
        {activeView === 'models' && (
          <div className="scroll-view">
            <ModelsView
              device={device}
              download={download}
              models={models}
              onAddFolder={handleAddFolder}
              onDelete={handleDelete}
              onDownload={handleDownload}
              onImportFile={handleImportFile}
              onRefresh={refresh}
              onRemove={handleRemove}
              onReveal={(model) => void bridge.models.reveal(model.path)}
              onSelect={(model) => void handleSelectModel(model.path)}
              selectedPath={selectedPath}
            />
          </div>
        )}
        {activeView === 'settings' && (
          <div className="scroll-view">
            {settings ? <SettingsView onChange={updateSettings} settings={settings} /> : null}
          </div>
        )}
      </main>
    </div>
  )
}

function UpdateButton({ onUpdate, state }: { onUpdate: () => void; state: UpdateState | null }) {
  if (!state || state.phase === 'idle' || state.phase === 'unsupported' || state.phase === 'checking') return null

  const downloading = state.phase === 'downloading'
  const label =
    state.phase === 'available'
      ? state.latestVersion
        ? `Update ${state.latestVersion}`
        : 'Update'
      : state.phase === 'downloaded'
        ? 'Restart to update'
        : state.phase === 'error'
          ? 'Retry update'
          : `Updating ${Math.round(state.progressPct ?? 0)}%`

  return (
    <button
      className={`update-button ${state.phase}`}
      type="button"
      onClick={onUpdate}
      disabled={downloading}
      title={state.message ?? (state.latestVersion ? `Latest version ${state.latestVersion}` : undefined)}
    >
      {downloading ? <LoaderCircle className="spin-icon" size={15} /> : <Download size={15} />}
      <span>{label}</span>
    </button>
  )
}

// --- Chat view --------------------------------------------------------------

function ChatView({
  device,
  messages,
  models,
  onManageModels,
  onNewChat,
  onSelectModel,
  onSend,
  onStop,
  selectedModel,
  snapshot,
  streaming,
}: {
  device: DeviceInfo | null
  messages: ChatTurn[]
  models: ModelInfo[]
  onManageModels: () => void
  onNewChat: () => void
  onSelectModel: (path: string) => void
  onSend: (text: string) => void
  onStop: () => void
  selectedModel: ModelInfo | null
  snapshot: TelemetrySnapshot | null
  streaming: boolean
}) {
  const bottomRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages])

  const hasModels = models.length > 0
  const accelerator = typeof device?.gpuType === 'string' ? device.gpuType.toUpperCase() : 'CPU'

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
          {snapshot && snapshot.tokensPerSec > 0 ? (
            <span className="runtime-pill">
              <span className="status-dot live" />
              {formatNumber(snapshot.tokensPerSec, 1)} tok/s · {accelerator}
            </span>
          ) : (
            <span className="runtime-pill subtle">{hasModels ? `Local · ${accelerator}` : 'No model'}</span>
          )}
          <button className="secondary-button compact" type="button" onClick={onNewChat} disabled={messages.length === 0}>
            <Plus size={14} />
            New chat
          </button>
        </div>
      </header>

      <div className="chat-scroll">
        {messages.length === 0 ? (
          <div className="chat-welcome">
            <div className="welcome-glyph">
              <Sparkles size={26} />
            </div>
            {hasModels ? (
              <>
                <h1>Chat with {selectedModel ? selectedModel.name : 'a local model'}</h1>
                <p>Runs entirely on this machine. Your prompts never leave the device.</p>
              </>
            ) : (
              <>
                <h1>Add a local model to get started</h1>
                <p>Import a GGUF file you've downloaded or fetch one from Hugging Face, then start chatting offline.</p>
                <button className="primary-button" type="button" onClick={onManageModels}>
                  <BrainCircuit size={15} />
                  Manage models
                </button>
              </>
            )}
          </div>
        ) : (
          <div className="message-column">
            {messages.map((message) => (
              <MessageBubble key={message.id} message={message} modelName={selectedModel?.name ?? 'Model'} />
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

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

  const showStatus = message.streaming && !message.content && !message.error
  return (
    <article className="message assistant">
      <div className="assistant-head">
        <span className="assistant-name">{modelName}</span>
        {message.streaming ? <span className="caret-dot" /> : null}
      </div>
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
      {!message.streaming && !message.error && message.content ? (
        <div className="assistant-foot">
          <CopyButton text={message.content} />
          {message.aborted ? <span className="muted">stopped</span> : null}
          {message.tokensPerSec ? <span className="muted">{formatNumber(message.tokensPerSec, 1)} tok/s</span> : null}
        </div>
      ) : null}
    </article>
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
