import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Activity,
  AlertTriangle,
  BrainCircuit,
  Cable,
  CheckCircle2,
  Cpu,
  Database,
  Gauge,
  HardDrive,
  MessageSquareText,
  Microchip,
  Play,
  Power as PowerIcon,
  RotateCcw,
  Send,
  Settings,
  ShieldCheck,
  Square,
  Thermometer,
  Zap,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import './App.css'

type ViewId = 'workbench' | 'monitor' | 'models' | 'settings'
type MessageRole = 'system' | 'assistant' | 'user'
type MetricKey = 'cpu' | 'ram' | 'gpu' | 'vram' | 'power' | 'thermal'

type ModelProfile = {
  id: string
  name: string
  status: 'Ready' | 'Template' | 'Awaiting model'
  family: string
  context: number
  minMemory: number
  vramBase: number
  weight: number
}

type ChatMessage = {
  id: string
  role: MessageRole
  title: string
  body: string
  meta: string
}

type Telemetry = {
  cpu: number
  ram: number
  gpu: number
  vram: number
  power: number
  thermal: number
  tokens: number
  series: Record<MetricKey, number[]>
}

const modelProfiles: ModelProfile[] = [
  {
    id: 'local-slot',
    name: 'Local model slot',
    status: 'Awaiting model',
    family: 'Open model adapter',
    context: 8192,
    minMemory: 8,
    vramBase: 2.8,
    weight: 2.8,
  },
  {
    id: 'llama-8b',
    name: 'Llama 3.1 8B Instruct',
    status: 'Template',
    family: 'General chat',
    context: 8192,
    minMemory: 10,
    vramBase: 4.8,
    weight: 4,
  },
  {
    id: 'qwen-coder',
    name: 'Qwen2.5 Coder 7B',
    status: 'Template',
    family: 'Code assistant',
    context: 32768,
    minMemory: 12,
    vramBase: 5.2,
    weight: 4.4,
  },
]

const initialMessages: ChatMessage[] = [
  {
    id: 'system-1',
    role: 'system',
    title: 'System notes',
    body: 'Runtime limits are armed. Model requests will be estimated against memory budget and compute cap before dispatch.',
    meta: 'Local controller',
  },
  {
    id: 'assistant-1',
    role: 'assistant',
    title: 'PowerStation',
    body: 'Local model adapter is ready for a backend connector. Start the runtime, send a prompt, and watch the load estimate change.',
    meta: 'Mock adapter',
  },
]

const navItems: Array<{ id: ViewId; label: string; icon: LucideIcon }> = [
  { id: 'workbench', label: 'Workbench', icon: MessageSquareText },
  { id: 'monitor', label: 'Monitor', icon: Activity },
  { id: 'models', label: 'Models', icon: BrainCircuit },
  { id: 'settings', label: 'Settings', icon: Settings },
]

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

const randomBetween = (min: number, max: number) =>
  Math.random() * (max - min) + min

const seedSeries = (base: number, variance: number) =>
  Array.from({ length: 28 }, (_, index) =>
    clamp(base + Math.sin(index * 0.72) * variance + (index % 4) * 0.9, 0, 100),
  )

const initialTelemetry: Telemetry = {
  cpu: 6,
  ram: 2.4,
  gpu: 4,
  vram: 0.8,
  power: 11,
  thermal: 88,
  tokens: 0,
  series: {
    cpu: seedSeries(8, 3),
    ram: seedSeries(18, 2),
    gpu: seedSeries(5, 2),
    vram: seedSeries(8, 2),
    power: seedSeries(12, 3),
    thermal: seedSeries(88, 4),
  },
}

function pushSeries(series: number[], value: number) {
  return [...series.slice(1), clamp(value, 0, 100)]
}

function useSimulatedTelemetry({
  isRunning,
  promptLoad,
  computeCap,
  memoryBudget,
  selectedModel,
}: {
  isRunning: boolean
  promptLoad: number
  computeCap: number
  memoryBudget: number
  selectedModel: ModelProfile
}) {
  const [telemetry, setTelemetry] = useState<Telemetry>(initialTelemetry)

  useEffect(() => {
    const interval = window.setInterval(() => {
      setTelemetry((current) => {
        const activeLoad = isRunning ? Math.max(promptLoad, 8) : 0
        const capFactor = computeCap / 100
        const cpu = isRunning
          ? clamp(9 + capFactor * 34 + activeLoad * 0.34 + randomBetween(-6, 6), 4, computeCap)
          : clamp(3 + randomBetween(0, 5), 1, 11)
        const gpu = isRunning
          ? clamp(8 + capFactor * 46 + activeLoad * 0.28 + randomBetween(-7, 7), 3, computeCap)
          : clamp(2 + randomBetween(0, 4), 1, 9)
        const ram = isRunning
          ? clamp(
              selectedModel.minMemory * 0.44 + memoryBudget * 0.24 + (activeLoad / 100) * memoryBudget * 0.46 + randomBetween(-0.35, 0.35),
              2,
              memoryBudget,
            )
          : clamp(1.8 + randomBetween(0, 0.9), 1.2, 3.1)
        const vram = isRunning
          ? clamp(selectedModel.vramBase + (activeLoad / 100) * 4.6 + randomBetween(-0.2, 0.25), 0.8, selectedModel.vramBase + 5.8)
          : clamp(0.5 + randomBetween(0, 0.4), 0.3, 1.2)
        const power = isRunning
          ? clamp(16 + cpu * 0.54 + gpu * 0.68 + activeLoad * 0.12 + randomBetween(-4, 5), 14, 146)
          : clamp(8 + randomBetween(0, 3), 5, 16)
        const thermal = clamp(100 - power * 0.43 - activeLoad * 0.13 + randomBetween(-3, 3), 8, 96)
        const tokens = isRunning
          ? clamp(capFactor * (38 - selectedModel.weight * 2.1) - activeLoad * 0.07 + randomBetween(-1.6, 2.2), 1.5, 44)
          : 0

        return {
          cpu,
          ram,
          gpu,
          vram,
          power,
          thermal,
          tokens,
          series: {
            cpu: pushSeries(current.series.cpu, cpu),
            ram: pushSeries(current.series.ram, (ram / memoryBudget) * 100),
            gpu: pushSeries(current.series.gpu, gpu),
            vram: pushSeries(current.series.vram, (vram / Math.max(selectedModel.vramBase + 5.8, 8)) * 100),
            power: pushSeries(current.series.power, (power / 150) * 100),
            thermal: pushSeries(current.series.thermal, thermal),
          },
        }
      })
    }, 1100)

    return () => window.clearInterval(interval)
  }, [computeCap, isRunning, memoryBudget, promptLoad, selectedModel])

  return telemetry
}

function estimatePromptLoad(text: string, contextLimit: number, selectedModel: ModelProfile) {
  const trimmed = text.trim()
  if (!trimmed) return 0

  const estimatedTokens = Math.ceil(trimmed.length / 4)
  const codeWeight = /```|function|class|SELECT|import|export|const|let/.test(trimmed) ? 12 : 0
  const contextPressure = (estimatedTokens / contextLimit) * 720
  const memoryPressure = selectedModel.weight * 5.5

  return clamp(8 + contextPressure + memoryPressure + codeWeight, 4, 100)
}

function formatNumber(value: number, decimals = 0) {
  return value.toLocaleString(undefined, {
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals,
  })
}

function makeMockReply(prompt: string, load: number, memoryBudget: number) {
  const words = prompt.trim().split(/\s+/).filter(Boolean).length
  const risk = load > 72 ? 'High' : load > 48 ? 'Elevated' : 'Nominal'

  return `Mock response prepared for ${words} words. Prompt load is ${formatNumber(load)} percent with ${memoryBudget} GB reserved. Risk level: ${risk}.`
}

function App() {
  const [activeView, setActiveView] = useState<ViewId>('workbench')
  const [isRunning, setIsRunning] = useState(false)
  const [selectedModelId, setSelectedModelId] = useState(modelProfiles[0].id)
  const [memoryBudget, setMemoryBudget] = useState(14)
  const [computeCap, setComputeCap] = useState(72)
  const [contextLimit, setContextLimit] = useState(8192)
  const [autoUnload, setAutoUnload] = useState(true)
  const [lowPowerMode, setLowPowerMode] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages)
  const [composer, setComposer] = useState('')
  const [lastPromptLoad, setLastPromptLoad] = useState(10)

  const selectedModel = useMemo(
    () => modelProfiles.find((model) => model.id === selectedModelId) ?? modelProfiles[0],
    [selectedModelId],
  )

  const estimatedPromptLoad = useMemo(
    () => estimatePromptLoad(composer, contextLimit, selectedModel),
    [composer, contextLimit, selectedModel],
  )

  const visiblePromptLoad = Math.max(lastPromptLoad, estimatedPromptLoad)
  const telemetry = useSimulatedTelemetry({
    isRunning,
    promptLoad: visiblePromptLoad,
    computeCap,
    memoryBudget,
    selectedModel,
  })

  useEffect(() => {
    const interval = window.setInterval(() => {
      setLastPromptLoad((value) => (isRunning ? Math.max(8, value * 0.9) : Math.max(0, value * 0.72)))
    }, 900)

    return () => window.clearInterval(interval)
  }, [isRunning])

  function handleSend() {
    const prompt = composer.trim()
    if (!prompt || !isRunning) return

    const load = estimatePromptLoad(prompt, contextLimit, selectedModel)
    setComposer('')
    setLastPromptLoad(load)
    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      title: 'Prompt',
      body: prompt,
      meta: `${Math.ceil(prompt.length / 4)} tokens estimated`,
    }
    setMessages((current) => [...current, userMessage])

    window.setTimeout(() => {
      setMessages((current) => [
        ...current,
        {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          title: selectedModel.name,
          body: makeMockReply(prompt, load, memoryBudget),
          meta: 'Mock response',
        },
      ])
    }, 620)
  }

  function resetSession() {
    setMessages(initialMessages)
    setComposer('')
    setLastPromptLoad(isRunning ? 12 : 0)
  }

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Primary">
        <button className="brand-mark" type="button" aria-label="PowerStation home" onClick={() => setActiveView('workbench')}>
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
                title={item.label}
                aria-label={item.label}
                onClick={() => setActiveView(item.id)}
              >
                <Icon size={19} strokeWidth={2.1} />
                <span>{item.label}</span>
              </button>
            )
          })}
        </nav>
        <div className="session-stack" aria-label="Recent sessions">
          <div className="session-head">
            <span>Sessions</span>
            <button type="button">New</button>
          </div>
          <button className="session-item active" type="button">
            <span>Research notes</span>
            <small>2m ago</small>
          </button>
          <button className="session-item" type="button">
            <span>Code refactor</span>
            <small>1h ago</small>
          </button>
          <button className="session-item" type="button">
            <span>Data analysis</span>
            <small>3h ago</small>
          </button>
        </div>
        <div className="rail-status" title={isRunning ? 'Runtime online' : 'Runtime stopped'}>
          <span className={isRunning ? 'status-dot live' : 'status-dot'} />
          <span>{isRunning ? 'Runtime online' : 'Runtime stopped'}</span>
        </div>
      </aside>

      <div className="app-frame">
        <TopBar
          computeCap={computeCap}
          isRunning={isRunning}
          memoryBudget={memoryBudget}
          onReset={resetSession}
          onStart={() => setIsRunning(true)}
          onStop={() => setIsRunning(false)}
          selectedModel={selectedModel}
          telemetry={telemetry}
        />

        <main className={activeView === 'workbench' ? 'content-grid workbench-grid' : 'content-grid'}>
          <section className="primary-surface" aria-label={navItems.find((item) => item.id === activeView)?.label}>
            {activeView === 'workbench' && (
              <WorkbenchView
                autoUnload={autoUnload}
                composer={composer}
                computeCap={computeCap}
                contextLimit={contextLimit}
                estimatedPromptLoad={visiblePromptLoad}
                isRunning={isRunning}
                lowPowerMode={lowPowerMode}
                memoryBudget={memoryBudget}
                messages={messages}
                onComposerChange={setComposer}
                onComputeCapChange={setComputeCap}
                onContextLimitChange={setContextLimit}
                onMemoryBudgetChange={setMemoryBudget}
                onResetSession={resetSession}
                onSend={handleSend}
                onToggleAutoUnload={setAutoUnload}
                onToggleLowPowerMode={setLowPowerMode}
                selectedModel={selectedModel}
              />
            )}
            {activeView === 'monitor' && <MonitorView computeCap={computeCap} memoryBudget={memoryBudget} telemetry={telemetry} />}
            {activeView === 'models' && (
              <ModelsView selectedModelId={selectedModelId} onSelectModel={setSelectedModelId} />
            )}
            {activeView === 'settings' && (
              <SettingsView
                autoUnload={autoUnload}
                computeCap={computeCap}
                contextLimit={contextLimit}
                lowPowerMode={lowPowerMode}
                memoryBudget={memoryBudget}
                onComputeCapChange={setComputeCap}
                onContextLimitChange={setContextLimit}
                onMemoryBudgetChange={setMemoryBudget}
                onToggleAutoUnload={setAutoUnload}
                onToggleLowPowerMode={setLowPowerMode}
              />
            )}
          </section>

          <ResourcePanel
            computeCap={computeCap}
            memoryBudget={memoryBudget}
            promptLoad={visiblePromptLoad}
            selectedModel={selectedModel}
            telemetry={telemetry}
          />
        </main>
      </div>
    </div>
  )
}

function TopBar({
  computeCap,
  isRunning,
  memoryBudget,
  onReset,
  onStart,
  onStop,
  selectedModel,
  telemetry,
}: {
  computeCap: number
  isRunning: boolean
  memoryBudget: number
  onReset: () => void
  onStart: () => void
  onStop: () => void
  selectedModel: ModelProfile
  telemetry: Telemetry
}) {
  return (
    <header className="topbar">
      <div className="title-block">
        <div className="product-name">
          <PowerIcon size={18} strokeWidth={2.4} />
          <span>PowerStation</span>
        </div>
        <div className="runtime-line">
          <span className={isRunning ? 'status-dot live' : 'status-dot'} />
          <span>Local runtime</span>
          <span className="muted">/</span>
          <span>{isRunning ? 'Model standby' : 'Stopped'}</span>
        </div>
      </div>

      <div className="top-metrics" aria-label="Runtime summary">
        <MiniReadout label="Model" value={selectedModel.name} />
        <MiniReadout label="Memory budget" value={`${memoryBudget} GB`} />
        <MiniReadout label="Compute cap" value={`${computeCap}%`} />
        <MiniReadout label="Power draw" value={`${formatNumber(telemetry.power)} W`} />
      </div>

      <div className="top-actions">
        <button className="secondary-button icon-button" type="button" title="Reset session" aria-label="Reset session" onClick={onReset}>
          <RotateCcw size={16} />
        </button>
        {isRunning ? (
          <button className="danger-button" type="button" onClick={onStop}>
            <Square size={14} fill="currentColor" />
            Stop
          </button>
        ) : (
          <button className="primary-button" type="button" onClick={onStart}>
            <Play size={15} fill="currentColor" />
            Start model
          </button>
        )}
      </div>
    </header>
  )
}

function WorkbenchView({
  autoUnload,
  composer,
  computeCap,
  contextLimit,
  estimatedPromptLoad,
  isRunning,
  lowPowerMode,
  memoryBudget,
  messages,
  onComposerChange,
  onComputeCapChange,
  onContextLimitChange,
  onMemoryBudgetChange,
  onResetSession,
  onSend,
  onToggleAutoUnload,
  onToggleLowPowerMode,
  selectedModel,
}: {
  autoUnload: boolean
  composer: string
  computeCap: number
  contextLimit: number
  estimatedPromptLoad: number
  isRunning: boolean
  lowPowerMode: boolean
  memoryBudget: number
  messages: ChatMessage[]
  onComposerChange: (value: string) => void
  onComputeCapChange: (value: number) => void
  onContextLimitChange: (value: number) => void
  onMemoryBudgetChange: (value: number) => void
  onResetSession: () => void
  onSend: () => void
  onToggleAutoUnload: (value: boolean) => void
  onToggleLowPowerMode: (value: boolean) => void
  selectedModel: ModelProfile
}) {
  return (
    <div className="workbench-layout">
      <div className="conversation-panel">
        <PanelHeader
          eyebrow="Conversation"
          title="Workbench"
          action={
            <button className="secondary-button compact" type="button" onClick={onResetSession}>
              <RotateCcw size={14} />
              Reset
            </button>
          }
        />

        <div className="message-list" aria-live="polite">
          {messages.map((message) => (
            <article className={`message-row ${message.role}`} key={message.id}>
              <div className="message-meta">
                <span>{message.title}</span>
                <small>{message.meta}</small>
              </div>
              <p>{message.body}</p>
            </article>
          ))}
        </div>

        <div className="composer-shell">
          <div className="prompt-strip">
            <LoadMeter label="Prompt load" value={estimatedPromptLoad} />
            <div className="token-readout">
              <span>Tokens</span>
              <strong>{composer.trim() ? Math.ceil(composer.trim().length / 4) : 0}</strong>
            </div>
          </div>
          <textarea
            aria-label="Prompt"
            placeholder={isRunning ? 'Send a local prompt...' : 'Start model to enable prompt input'}
            value={composer}
            onChange={(event) => onComposerChange(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                onSend()
              }
            }}
          />
          <div className="composer-actions">
            <div className="runtime-hint">
              <Cable size={14} />
              <span>{selectedModel.family}</span>
            </div>
            <button className="primary-button" type="button" disabled={!isRunning || !composer.trim()} onClick={onSend}>
              <Send size={15} />
              Send
            </button>
          </div>
        </div>
      </div>

      <aside className="control-panel" aria-label="Runtime limits">
        <PanelHeader eyebrow="Runtime limits" title="Guardrails" />
        <RangeControl label="Memory budget" value={memoryBudget} min={4} max={32} step={1} unit="GB" onChange={onMemoryBudgetChange} />
        <RangeControl label="Compute cap" value={computeCap} min={20} max={100} step={1} unit="%" onChange={onComputeCapChange} />
        <RangeControl label="Context window" value={contextLimit} min={4096} max={32768} step={1024} unit="tok" onChange={onContextLimitChange} />
        <ToggleControl label="Auto unload on idle" checked={autoUnload} onChange={onToggleAutoUnload} />
        <ToggleControl label="Low power bias" checked={lowPowerMode} onChange={onToggleLowPowerMode} />

        <div className="system-note">
          <div className="note-icon">
            <ShieldCheck size={17} />
          </div>
          <div>
            <strong>Local controller</strong>
            <p>Requests are staged through the budget estimator before model dispatch.</p>
          </div>
        </div>
      </aside>
    </div>
  )
}

function ResourcePanel({
  computeCap,
  memoryBudget,
  promptLoad,
  selectedModel,
  telemetry,
}: {
  computeCap: number
  memoryBudget: number
  promptLoad: number
  selectedModel: ModelProfile
  telemetry: Telemetry
}) {
  const metrics = [
    { label: 'CPU', value: telemetry.cpu, display: `${formatNumber(telemetry.cpu)}%`, icon: Cpu, series: telemetry.series.cpu, tone: 'teal' },
    { label: 'RAM', value: (telemetry.ram / memoryBudget) * 100, display: `${formatNumber(telemetry.ram, 1)} GB`, icon: HardDrive, series: telemetry.series.ram, tone: 'blue' },
    { label: 'GPU', value: telemetry.gpu, display: `${formatNumber(telemetry.gpu)}%`, icon: Microchip, series: telemetry.series.gpu, tone: 'teal' },
    { label: 'VRAM', value: (telemetry.vram / Math.max(selectedModel.vramBase + 5.8, 8)) * 100, display: `${formatNumber(telemetry.vram, 1)} GB`, icon: Database, series: telemetry.series.vram, tone: 'blue' },
    { label: 'Power draw', value: (telemetry.power / 150) * 100, display: `${formatNumber(telemetry.power)} W`, icon: Zap, series: telemetry.series.power, tone: 'amber' },
    { label: 'Thermal headroom', value: telemetry.thermal, display: `${formatNumber(telemetry.thermal)}%`, icon: Thermometer, series: telemetry.series.thermal, tone: 'green' },
  ] as const

  return (
    <aside className="resource-panel" aria-label="Monitor">
      <PanelHeader eyebrow="Monitor" title="Resource draw" />
      <div className="runtime-card">
        <div>
          <span>Local runtime</span>
          <strong>{formatNumber(telemetry.tokens, 1)} tok/s</strong>
        </div>
        <Gauge size={28} />
      </div>

      <LoadMeter label="Prompt load" value={promptLoad} />
      <LoadMeter label="Compute cap" value={computeCap} />

      <div className="metric-stack">
        {metrics.map((metric) => (
          <MetricTile
            display={metric.display}
            icon={metric.icon}
            key={metric.label}
            label={metric.label}
            series={metric.series}
            tone={metric.tone}
            value={metric.value}
          />
        ))}
      </div>
    </aside>
  )
}

function MonitorView({
  computeCap,
  memoryBudget,
  telemetry,
}: {
  computeCap: number
  memoryBudget: number
  telemetry: Telemetry
}) {
  const rows = [
    { label: 'CPU', value: `${formatNumber(telemetry.cpu)}%`, limit: `${computeCap}% cap`, status: telemetry.cpu > computeCap * 0.86 ? 'Watch' : 'Clear' },
    { label: 'RAM', value: `${formatNumber(telemetry.ram, 1)} GB`, limit: `${memoryBudget} GB budget`, status: telemetry.ram > memoryBudget * 0.86 ? 'Watch' : 'Clear' },
    { label: 'Power', value: `${formatNumber(telemetry.power)} W`, limit: '150 W rail', status: telemetry.power > 120 ? 'Watch' : 'Clear' },
    { label: 'Thermal', value: `${formatNumber(telemetry.thermal)}%`, limit: 'Headroom', status: telemetry.thermal < 22 ? 'Watch' : 'Clear' },
  ]

  return (
    <div className="monitor-view">
      <PanelHeader eyebrow="Telemetry" title="Live monitor" />
      <div className="chart-board">
        <LargeChart label="CPU" series={telemetry.series.cpu} value={`${formatNumber(telemetry.cpu)}%`} />
        <LargeChart label="RAM" series={telemetry.series.ram} value={`${formatNumber(telemetry.ram, 1)} GB`} />
        <LargeChart label="GPU" series={telemetry.series.gpu} value={`${formatNumber(telemetry.gpu)}%`} />
        <LargeChart label="Power draw" series={telemetry.series.power} value={`${formatNumber(telemetry.power)} W`} />
      </div>

      <div className="process-table">
        <div className="table-head">
          <span>Signal</span>
          <span>Current</span>
          <span>Limit</span>
          <span>Status</span>
        </div>
        {rows.map((row) => (
          <div className="table-row" key={row.label}>
            <span>{row.label}</span>
            <strong>{row.value}</strong>
            <span>{row.limit}</span>
            <span className={row.status === 'Watch' ? 'status-text warn' : 'status-text'}>{row.status}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function ModelsView({
  onSelectModel,
  selectedModelId,
}: {
  onSelectModel: (id: string) => void
  selectedModelId: string
}) {
  return (
    <div className="models-view">
      <PanelHeader eyebrow="Models" title="Adapter registry" />
      <div className="model-list">
        {modelProfiles.map((model) => (
          <button
            className={model.id === selectedModelId ? 'model-row active' : 'model-row'}
            key={model.id}
            type="button"
            onClick={() => onSelectModel(model.id)}
          >
            <span className="model-icon">
              <BrainCircuit size={18} />
            </span>
            <span className="model-main">
              <strong>{model.name}</strong>
              <small>{model.family}</small>
            </span>
            <span>{model.context.toLocaleString()} ctx</span>
            <span>{model.minMemory} GB min</span>
            <span className="model-status">{model.status}</span>
          </button>
        ))}
      </div>

      <div className="adapter-panel">
        <div>
          <h3>Model adapter</h3>
          <p>Runtime contract: start, stop, stream tokens, estimate memory, report load, unload on threshold.</p>
        </div>
        <div className="adapter-grid">
          <AdapterStep label="Load weights" state="Pending" />
          <AdapterStep label="Reserve memory" state="Armed" />
          <AdapterStep label="Stream response" state="Mocked" />
          <AdapterStep label="Host metrics" state="Mocked" />
        </div>
      </div>
    </div>
  )
}

function SettingsView({
  autoUnload,
  computeCap,
  contextLimit,
  lowPowerMode,
  memoryBudget,
  onComputeCapChange,
  onContextLimitChange,
  onMemoryBudgetChange,
  onToggleAutoUnload,
  onToggleLowPowerMode,
}: {
  autoUnload: boolean
  computeCap: number
  contextLimit: number
  lowPowerMode: boolean
  memoryBudget: number
  onComputeCapChange: (value: number) => void
  onContextLimitChange: (value: number) => void
  onMemoryBudgetChange: (value: number) => void
  onToggleAutoUnload: (value: boolean) => void
  onToggleLowPowerMode: (value: boolean) => void
}) {
  return (
    <div className="settings-view">
      <PanelHeader eyebrow="Settings" title="Safety profile" />
      <div className="settings-grid">
        <section className="settings-section">
          <h3>Budgets</h3>
          <RangeControl label="Memory budget" value={memoryBudget} min={4} max={32} step={1} unit="GB" onChange={onMemoryBudgetChange} />
          <RangeControl label="Compute cap" value={computeCap} min={20} max={100} step={1} unit="%" onChange={onComputeCapChange} />
          <RangeControl label="Context window" value={contextLimit} min={4096} max={32768} step={1024} unit="tok" onChange={onContextLimitChange} />
        </section>

        <section className="settings-section">
          <h3>Runtime policy</h3>
          <ToggleControl label="Auto unload on idle" checked={autoUnload} onChange={onToggleAutoUnload} />
          <ToggleControl label="Low power bias" checked={lowPowerMode} onChange={onToggleLowPowerMode} />
          <div className="policy-note">
            <AlertTriangle size={17} />
            <span>Hard stops will be enforced by the host controller once a backend process is attached.</span>
          </div>
        </section>
      </div>
    </div>
  )
}

function PanelHeader({
  action,
  eyebrow,
  title,
}: {
  action?: ReactNode
  eyebrow: string
  title: string
}) {
  return (
    <div className="panel-header">
      <div>
        <span>{eyebrow}</span>
        <h2>{title}</h2>
      </div>
      {action}
    </div>
  )
}

function MiniReadout({ label, value }: { label: string; value: string }) {
  return (
    <div className="mini-readout">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function LoadMeter({ label, value }: { label: string; value: number }) {
  const level = value > 76 ? 'high' : value > 52 ? 'medium' : 'low'

  return (
    <div className="load-meter">
      <div className="meter-label">
        <span>{label}</span>
        <strong>{formatNumber(value)}%</strong>
      </div>
      <div className={`meter-track ${level}`}>
        <span style={{ width: `${clamp(value, 0, 100)}%` }} />
      </div>
    </div>
  )
}

function RangeControl({
  label,
  max,
  min,
  onChange,
  step,
  unit,
  value,
}: {
  label: string
  max: number
  min: number
  onChange: (value: number) => void
  step: number
  unit: string
  value: number
}) {
  return (
    <label className="range-control">
      <span>
        {label}
        <strong>
          {value.toLocaleString()} {unit}
        </strong>
      </span>
      <input
        max={max}
        min={min}
        onChange={(event) => onChange(Number(event.target.value))}
        step={step}
        type="range"
        value={value}
      />
    </label>
  )
}

function ToggleControl({
  checked,
  label,
  onChange,
}: {
  checked: boolean
  label: string
  onChange: (value: boolean) => void
}) {
  return (
    <label className="toggle-control">
      <span>{label}</span>
      <input checked={checked} onChange={(event) => onChange(event.target.checked)} type="checkbox" />
      <i aria-hidden="true" />
    </label>
  )
}

function MetricTile({
  display,
  icon: Icon,
  label,
  series,
  tone,
  value,
}: {
  display: string
  icon: LucideIcon
  label: string
  series: number[]
  tone: 'amber' | 'blue' | 'green' | 'teal'
  value: number
}) {
  return (
    <div className={`metric-tile ${tone}`}>
      <div className="metric-topline">
        <span>
          <Icon size={15} />
          {label}
        </span>
        <strong>{display}</strong>
      </div>
      <Sparkline series={series} />
      <div className="metric-bar">
        <span style={{ width: `${clamp(value, 0, 100)}%` }} />
      </div>
    </div>
  )
}

function LargeChart({ label, series, value }: { label: string; series: number[]; value: string }) {
  return (
    <div className="large-chart">
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      <Sparkline series={series} height={92} />
    </div>
  )
}

function Sparkline({ height = 42, series }: { height?: number; series: number[] }) {
  const width = 180
  const points = series
    .map((value, index) => {
      const x = (index / Math.max(series.length - 1, 1)) * width
      const y = height - (clamp(value, 0, 100) / 100) * height
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')

  return (
    <svg className="sparkline" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <polyline points={points} />
    </svg>
  )
}

function AdapterStep({ label, state }: { label: string; state: string }) {
  return (
    <div className="adapter-step">
      <CheckCircle2 size={15} />
      <span>{label}</span>
      <strong>{state}</strong>
    </div>
  )
}

export default App
