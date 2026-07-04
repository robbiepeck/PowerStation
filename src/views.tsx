import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  BadgeCheck,
  BookOpenCheck,
  Code2,
  Cpu,
  Database,
  Download,
  ExternalLink,
  FileDown,
  FolderSearch,
  Gauge,
  HardDrive,
  Microchip,
  Plug,
  Plus,
  RefreshCw,
  ShieldCheck,
  Thermometer,
  Trash2,
  Wrench,
  Zap,
} from 'lucide-react'
import { getDesktop } from './desktop'
import type {
  Catalog,
  CatalogModel,
  DeviceInfo,
  FitReport,
  McpServerStatus,
  McpToolInfoResponse,
  ModelInfo,
  Settings,
  TelemetrySnapshot,
  ToolCallingTier,
  ToolPermission,
  UtilitySettings,
} from './types'
import {
  Badge,
  MetricTile,
  PanelHeader,
  RangeControl,
  ToggleControl,
  clamp,
  formatBytes,
  formatNumber,
} from './ui'
import type { MetricInfo } from './ui'

const bridge = getDesktop()

export type MetricKey = 'cpu' | 'ram' | 'gpu' | 'vram' | 'storage' | 'power' | 'thermal'
export type MetricSeries = Record<MetricKey, number[]>

const METRIC_INFO: Record<MetricKey, MetricInfo> = {
  cpu: {
    title: 'CPU',
    body: 'The CPU is your computer processor. A higher number means PowerStation and other apps are asking the processor to do more work.',
  },
  ram: {
    title: 'RAM',
    body: 'RAM is your computer memory. Local models need RAM to stay loaded, and larger models usually need more of it.',
  },
  gpu: {
    title: 'GPU',
    body: 'The GPU is the graphics chip. Some local models can use it to generate answers faster than the CPU alone.',
  },
  vram: {
    title: 'VRAM',
    body: 'VRAM is memory used by the graphics chip. On Apple Silicon this comes from shared memory, so it overlaps with normal RAM.',
  },
  storage: {
    title: 'Storage',
    body: 'Storage is disk space on your computer. This shows how much of the main disk is already used and how much total space it has.',
  },
  power: {
    title: 'Power draw',
    body: 'Power draw is how much electrical power the workload appears to be using right now. In this app it is an estimate unless the system gives direct sensor access.',
  },
  thermal: {
    title: 'Thermal headroom',
    body: 'Thermal headroom is how much cooling room your computer has left. A lower number means the machine is getting closer to heat limits.',
  },
}

export type DownloadState = {
  id: string
  uri: string
  totalSize: number
  downloadedSize: number
  error?: string
} | null

const EMPTY_UTILITIES: UtilitySettings = {
  systemPrompt: '',
  skills: [],
  connectors: [],
  mcpServers: [],
}

function createUtilityId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.round(Math.random() * 1e6)}`
}

function isCurrentCatalogModel(model: CatalogModel, selectedModel?: ModelInfo | null) {
  if (!selectedModel) return false
  return selectedModel.fileName.toLowerCase() === model.fileName.toLowerCase()
}

// --- Catalog ------------------------------------------------------------------

function FitBadge({ fit }: { fit: FitReport | null | undefined }) {
  if (fit === undefined) return null
  if (fit === null) return <Badge tone="neutral">fit unknown</Badge>
  if (fit.verdict === 'comfortable') return <Badge tone="real">Fits comfortably</Badge>
  if (fit.verdict === 'tight') return <Badge tone="estimated">Tight fit</Badge>
  return <Badge tone="danger">Won't fit this Mac</Badge>
}

function TierBadge({ tier }: { tier: ToolCallingTier }) {
  if (tier === 'multi') return <Badge tone="real">Agent-ready</Badge>
  if (tier === 'single') return <Badge tone="estimated">Basic tools</Badge>
  return <Badge tone="neutral">Chat only</Badge>
}

export function CatalogGrid({
  catalog,
  download,
  fitReports,
  onDownload,
  onOpenWebsite,
  selectedModel,
}: {
  catalog: Catalog | null
  download: DownloadState
  fitReports: Record<string, FitReport | null>
  onDownload: (uri: string) => void
  onOpenWebsite: (url: string) => void
  selectedModel?: ModelInfo | null
}) {
  if (!catalog || !catalog.models.length) {
    return <p className="empty-hint">Loading the model catalog…</p>
  }

  const downloadingUri = download?.uri
  const downloadPct = download && download.totalSize ? (download.downloadedSize / download.totalSize) * 100 : 0

  return (
    <div className="starter-grid">
      {catalog.models.map((model) => {
        const fit = fitReports[model.id]
        const active = downloadingUri === model.downloadUrl
        const current = isCurrentCatalogModel(model, selectedModel)
        const busy = Boolean(download) && !download?.error
        const failed = active && Boolean(download?.error)
        const wontFit = fit != null && fit.verdict === 'wont-fit'

        return (
          <article className={`starter-card ${current ? 'currently-used' : ''} ${wontFit ? 'wont-fit' : ''}`} key={model.id}>
            <div className="starter-card-top">
              <span className="starter-icon" aria-hidden="true">
                {model.useCases.includes('coding') ? <Code2 size={18} /> : model.useCases.includes('agents') ? <Wrench size={18} /> : <BookOpenCheck size={18} />}
              </span>
              <div>
                <h3>{model.name}</h3>
                <p>{model.family}</p>
              </div>
            </div>

            <div className="starter-badges">
              <FitBadge fit={fit} />
              <TierBadge tier={model.toolCalling} />
            </div>

            <div className="starter-specs" aria-label={`${model.name} specs`}>
              <span>{model.totalParamsB}B{model.activeParamsB ? ` · ${model.activeParamsB}B active` : ''}</span>
              <span>{model.quant}</span>
              <span>{formatBytes(model.sizeBytes)}</span>
              <span>{model.minRamGb}GB+ RAM</span>
              {model.expectedTps ? <span>{model.expectedTps}</span> : null}
              <span>{model.license}</span>
            </div>

            <div className="starter-tradeoffs">
              <div>
                <strong>Great at</strong>
                <ul>
                  {model.goodAt.slice(0, 3).map((item) => (
                    <li key={item}>
                      <BadgeCheck size={13} />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <strong>Will struggle with</strong>
                <ul>
                  {model.strugglesWith.slice(0, 3).map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>

            {fit && fit.verdict !== 'comfortable' ? <p className="starter-fit-note">{fit.summary}</p> : null}

            {active && !download?.error ? (
              <div className="starter-download-status">
                <div className="download-progress-head">
                  <span>Downloading</span>
                  <strong>
                    {formatBytes(download?.downloadedSize ?? 0)} / {formatBytes(download?.totalSize ?? 0)}
                  </strong>
                </div>
                <div className="meter-track medium">
                  <span style={{ width: `${clamp(downloadPct, 2, 100)}%` }} />
                </div>
              </div>
            ) : null}
            {failed && download?.error ? <p className="error-text">{download.error}</p> : null}

            <button
              className="starter-website-button"
              type="button"
              onClick={() => onOpenWebsite(model.websiteUrl)}
              aria-label={`View ${model.name} on Hugging Face`}
            >
              <ExternalLink size={15} />
              View on Hugging Face
            </button>
            {current ? (
              <button className="primary-button starter-download currently-used-button" type="button" disabled>
                <BadgeCheck size={15} />
                Currently used
              </button>
            ) : (
              <button
                className="primary-button starter-download"
                type="button"
                disabled={(busy && !failed) || wontFit}
                title={wontFit ? fit?.summary : undefined}
                onClick={() => onDownload(model.downloadUrl)}
              >
                <Download size={15} />
                {wontFit ? "Won't fit" : busy && !active ? 'Download running' : failed ? 'Retry download' : 'Download'}
              </button>
            )}
          </article>
        )
      })}
    </div>
  )
}

// --- Monitor ------------------------------------------------------------------

export function MonitorView({
  device,
  series,
  snapshot,
}: {
  device: DeviceInfo | null
  series: MetricSeries
  snapshot: TelemetrySnapshot | null
}) {
  if (!snapshot) {
    return (
      <div className="monitor-view">
        <PanelHeader eyebrow="Telemetry" title="Live monitor" />
        <p className="empty-hint">Waiting for the first host telemetry sample…</p>
      </div>
    )
  }

  const ramPct = snapshot.ram.totalGb ? (snapshot.ram.usedGb / snapshot.ram.totalGb) * 100 : 0
  const vramPct = snapshot.vram.totalGb ? ((snapshot.vram.usedGb ?? 0) / snapshot.vram.totalGb) * 100 : 0
  const storagePct = snapshot.storage.totalGb ? (snapshot.storage.usedGb / snapshot.storage.totalGb) * 100 : 0
  const gpuDisplay = snapshot.gpu.load != null ? `${formatNumber(snapshot.gpu.load)}%` : 'n/a'
  const pressureLabel =
    snapshot.pressure.level === 'critical'
      ? 'Critical'
      : snapshot.pressure.level === 'warn'
        ? 'Elevated'
        : snapshot.pressure.level === 'normal'
          ? 'Normal'
          : 'n/a'

  const rows = [
    { label: 'CPU', value: `${formatNumber(snapshot.cpu.load)}%`, detail: `${snapshot.cpu.cores} cores`, real: snapshot.cpu.real },
    { label: 'RAM', value: `${formatNumber(snapshot.ram.usedGb, 1)} GB`, detail: `${formatNumber(snapshot.ram.totalGb, 0)} GB total`, real: snapshot.ram.real },
    {
      label: 'Memory pressure',
      value: pressureLabel,
      detail: 'macOS kernel signal',
      real: snapshot.pressure.real,
    },
    {
      label: 'VRAM',
      value: snapshot.vram.totalGb ? `${formatNumber(snapshot.vram.usedGb ?? 0, 1)} GB` : 'n/a',
      detail: snapshot.vram.totalGb ? `${formatNumber(snapshot.vram.totalGb, 0)} GB total` : 'unavailable',
      real: snapshot.vram.real,
    },
    {
      label: 'Storage',
      value: snapshot.storage.totalGb ? `${formatNumber(snapshot.storage.usedGb, 1)} GB` : 'n/a',
      detail: snapshot.storage.totalGb
        ? `${formatNumber(snapshot.storage.freeGb, 1)} GB free of ${formatNumber(snapshot.storage.totalGb, 0)} GB`
        : 'unavailable',
      real: snapshot.storage.real,
    },
    { label: 'Power', value: `${formatNumber(snapshot.power.watts, 1)} W`, detail: 'package estimate', real: !snapshot.power.estimated },
    {
      label: 'Thermal',
      value: snapshot.thermal.celsius != null ? `${formatNumber(snapshot.thermal.celsius)}°C` : `${formatNumber(snapshot.thermal.headroomPct)}% headroom`,
      detail: snapshot.thermal.real ? 'sensor' : 'estimated',
      real: snapshot.thermal.real,
    },
  ]

  return (
    <div className="monitor-view">
      <PanelHeader
        eyebrow="Telemetry"
        title="Live monitor"
        action={
          <div className="device-chip">
            <div className="device-chip-main">
              <Microchip size={15} />
              <span>{device?.gpuNames?.[0] ?? device?.health.modelName ?? snapshot.gpu.name ?? 'GPU'}</span>
              <Badge tone="neutral">{typeof device?.gpuType === 'string' ? device.gpuType : 'cpu'}</Badge>
            </div>
            <div className="device-chip-health" title={device?.health.estimateNote}>
              <span>{device?.health.ageYears != null ? `${formatNumber(device.health.ageYears, 1)}y old` : 'Age n/a'}</span>
              <span>{device?.health.batteryCapacityPct != null ? `Battery ${formatNumber(device.health.batteryCapacityPct)}%` : 'Battery n/a'}</span>
              <span>{device?.health.performanceCapacityPct != null ? `Perf ${formatNumber(device.health.performanceCapacityPct)}%` : 'Perf est. n/a'}</span>
            </div>
          </div>
        }
      />

      <div className="monitor-banner">
        <span>
          <strong>{formatNumber(snapshot.tokensPerSec, 1)}</strong> tok/s
        </span>
        <span>
          <strong>{snapshot.model.loaded ? 'Model loaded' : 'Idle'}</strong>
          {snapshot.model.loaded ? ' · generating uses GPU + RAM' : ' · no model in memory'}
        </span>
        <span>
          <strong>Pressure {pressureLabel.toLowerCase()}</strong>
          {snapshot.pressure.level === 'critical' ? ' · PowerStation pauses generation automatically' : ''}
        </span>
        <span className="muted">CPU, RAM, VRAM, storage and pressure are live · power and thermal headroom are estimated without elevated access</span>
      </div>

      <div className="metric-stack wide">
        <MetricTile
          display={`${formatNumber(snapshot.cpu.load)}%`}
          icon={Cpu}
          info={METRIC_INFO.cpu}
          label="CPU"
          series={series.cpu}
          sub={<Badge tone="real">live</Badge>}
          tone="teal"
          value={snapshot.cpu.load}
        />
        <MetricTile
          display={`${formatNumber(snapshot.ram.usedGb, 1)} GB`}
          icon={HardDrive}
          info={METRIC_INFO.ram}
          label="RAM"
          series={series.ram}
          sub={<Badge tone="real">live</Badge>}
          tone="blue"
          value={ramPct}
        />
        <MetricTile
          display={gpuDisplay}
          icon={Microchip}
          info={METRIC_INFO.gpu}
          label="GPU"
          series={series.gpu}
          sub={<Badge tone={snapshot.gpu.real ? 'real' : 'estimated'}>{snapshot.gpu.real ? 'live' : 'n/a on this OS'}</Badge>}
          tone="teal"
          value={snapshot.gpu.load ?? 0}
        />
        <MetricTile
          display={snapshot.vram.totalGb ? `${formatNumber(snapshot.vram.usedGb ?? 0, 1)} GB` : 'n/a'}
          icon={Database}
          info={METRIC_INFO.vram}
          label="VRAM"
          series={series.vram}
          sub={<Badge tone={snapshot.vram.real ? 'real' : 'estimated'}>{snapshot.vram.real ? 'live' : 'n/a'}</Badge>}
          tone="blue"
          value={vramPct}
        />
        <MetricTile
          display={snapshot.storage.totalGb ? `${formatNumber(snapshot.storage.usedGb, 0)} / ${formatNumber(snapshot.storage.totalGb, 0)} GB` : 'n/a'}
          icon={HardDrive}
          info={METRIC_INFO.storage}
          label="Storage"
          series={series.storage}
          sub={
            <Badge tone={snapshot.storage.real ? 'real' : 'estimated'}>
              {snapshot.storage.real ? `${formatNumber(snapshot.storage.freeGb, 0)} GB free` : 'n/a'}
            </Badge>
          }
          tone="blue"
          value={storagePct}
        />
        <MetricTile
          display={`${formatNumber(snapshot.power.watts, 1)} W`}
          icon={Zap}
          info={METRIC_INFO.power}
          label="Power draw"
          series={series.power}
          sub={<Badge tone="estimated">estimated</Badge>}
          tone="amber"
          value={clamp((snapshot.power.watts / 120) * 100, 0, 100)}
        />
        <MetricTile
          display={`${formatNumber(snapshot.thermal.headroomPct)}%`}
          icon={Thermometer}
          info={METRIC_INFO.thermal}
          label="Thermal headroom"
          series={series.thermal}
          sub={<Badge tone={snapshot.thermal.real ? 'real' : 'estimated'}>{snapshot.thermal.real ? 'sensor' : 'estimated'}</Badge>}
          tone="green"
          value={snapshot.thermal.headroomPct}
        />
      </div>

      <div className="process-table">
        <div className="table-head">
          <span>Signal</span>
          <span>Current</span>
          <span>Detail</span>
          <span>Source</span>
        </div>
        {rows.map((row) => (
          <div className="table-row" key={row.label}>
            <span>{row.label}</span>
            <strong>{row.value}</strong>
            <span>{row.detail}</span>
            <span>
              <Badge tone={row.real ? 'real' : 'estimated'}>{row.real ? 'live' : 'estimated'}</Badge>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// --- Models ---------------------------------------------------------------------

export function ModelsView({
  catalog,
  catalogRefreshing,
  device,
  download,
  fitReports,
  models,
  onAddFolder,
  onDelete,
  onDownload,
  onOpenWebsite,
  onImportFile,
  onRefreshCatalog,
  onRemove,
  onReveal,
  onSelect,
  selectedPath,
}: {
  catalog: Catalog | null
  catalogRefreshing: boolean
  device: DeviceInfo | null
  download: DownloadState
  fitReports: Record<string, FitReport | null>
  models: ModelInfo[]
  onAddFolder: () => void
  onDelete: (model: ModelInfo) => void
  onDownload: (uri: string) => void
  onOpenWebsite: (url: string) => void
  onImportFile: () => void
  onRefreshCatalog: () => void
  onRemove: (model: ModelInfo) => void
  onReveal: (model: ModelInfo) => void
  onSelect: (model: ModelInfo) => void
  selectedPath: string | null
}) {
  const [uri, setUri] = useState('')
  const downloadPct = download && download.totalSize ? (download.downloadedSize / download.totalSize) * 100 : 0
  const selectedModel = models.find((model) => model.path === selectedPath) ?? null

  return (
    <div className="models-view">
      <PanelHeader
        eyebrow="Models"
        title="Local models"
        action={
          <div className="catalog-meta">
            {catalog ? (
              <span className="catalog-updated">
                Catalog {catalog.updatedAt || 'bundled'} · {catalog.source}
              </span>
            ) : null}
            <button className="secondary-button compact" type="button" onClick={onRefreshCatalog} disabled={catalogRefreshing}>
              <RefreshCw size={14} className={catalogRefreshing ? 'spin-icon' : undefined} />
              {catalogRefreshing ? 'Updating' : 'Update catalog'}
            </button>
          </div>
        }
      />

      <section className="starter-catalog">
        <div className="starter-catalog-head">
          <span>Matched to this Mac</span>
          <h2>Model catalog</h2>
          <p>
            Every card shows whether the model fits this machine's memory and what it's honestly good at. Downloads
            install into PowerStation's local model folder and are selected automatically when they finish.
          </p>
        </div>
        <CatalogGrid
          catalog={catalog}
          download={download}
          fitReports={fitReports}
          onDownload={onDownload}
          onOpenWebsite={onOpenWebsite}
          selectedModel={selectedModel}
        />
      </section>

      <div className="model-actions">
        <button className="secondary-button" type="button" onClick={onImportFile}>
          <FileDown size={15} />
          Import .gguf file
        </button>
        <button className="secondary-button" type="button" onClick={onAddFolder}>
          <FolderSearch size={15} />
          Add models folder
        </button>
      </div>

      <form
        className="download-form"
        onSubmit={(event) => {
          event.preventDefault()
          if (uri.trim()) {
            onDownload(uri.trim())
            setUri('')
          }
        }}
      >
        <input
          aria-label="Model URL or Hugging Face URI"
          placeholder="Download GGUF: hf:user/repo:Q4_K_M  or  https://…/model.gguf"
          value={uri}
          onChange={(event) => setUri(event.target.value)}
        />
        <button className="primary-button" type="submit" disabled={!uri.trim() || Boolean(download)}>
          <Download size={15} />
          Download
        </button>
      </form>

      {download ? (
        <div className="download-progress">
          <div className="download-progress-head">
            <span>{download.error ? 'Download failed' : 'Downloading'} · {download.uri}</span>
            <strong>
              {download.error ? '—' : `${formatBytes(download.downloadedSize)} / ${formatBytes(download.totalSize)}`}
            </strong>
          </div>
          {download.error ? (
            <p className="error-text">{download.error}</p>
          ) : (
            <div className="meter-track medium">
              <span style={{ width: `${clamp(downloadPct, 2, 100)}%` }} />
            </div>
          )}
        </div>
      ) : null}

      {models.length === 0 ? (
        <div className="empty-models">
          <Database size={28} />
          <h3>No models yet</h3>
          <p>
            Download one from the catalog above, import a <code>.gguf</code> file, or add a folder of models. Models
            run fully on-device — nothing leaves your machine.
          </p>
        </div>
      ) : (
        <div className="model-list">
          {models.map((model) => {
            const active = model.path === selectedPath
            return (
              <div className={active ? 'model-row active' : 'model-row'} key={model.path}>
                <button className="model-main" type="button" onClick={() => onSelect(model)}>
                  <span className="model-radio" aria-hidden="true">
                    <span className={active ? 'dot on' : 'dot'} />
                  </span>
                  <span className="model-text">
                    <strong>{model.name}</strong>
                    <small>{model.fileName}</small>
                  </span>
                </button>
                <div className="model-tags">
                  {model.parameters ? <Badge tone="neutral">{model.parameters}</Badge> : null}
                  {model.quantization ? <Badge tone="neutral">{model.quantization}</Badge> : null}
                  {model.contextLength ? <Badge tone="neutral">{formatNumber(model.contextLength)} ctx</Badge> : null}
                  <Badge tone="neutral">{formatBytes(model.sizeBytes)}</Badge>
                </div>
                <div className="model-row-actions">
                  <button className="ghost-button" type="button" title="Reveal in file manager" onClick={() => onReveal(model)}>
                    Reveal
                  </button>
                  {model.source === 'imported' ? (
                    <button className="ghost-button" type="button" title="Remove from list" onClick={() => onRemove(model)}>
                      Remove
                    </button>
                  ) : null}
                  <button className="ghost-button danger" type="button" title="Delete file from disk" onClick={() => onDelete(model)}>
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="device-card">
        <h3>Compute device</h3>
        <div className="device-grid">
          <div>
            <span>Accelerator</span>
            <strong>{typeof device?.gpuType === 'string' ? device.gpuType.toUpperCase() : 'CPU'}</strong>
          </div>
          <div>
            <span>Device</span>
            <strong>{device?.gpuNames?.[0] ?? 'Unknown'}</strong>
          </div>
          <div>
            <span>VRAM</span>
            <strong>{device?.vram ? formatBytes(device.vram.total) : 'n/a'}</strong>
          </div>
        </div>
      </div>
    </div>
  )
}

// --- Utilities --------------------------------------------------------------------

export function UtilitiesView({
  enabled,
  mcpStatuses,
  onSettingsChange,
  selectedModel,
  selectedTier,
  settings,
}: {
  enabled: boolean
  mcpStatuses: McpServerStatus[]
  onSettingsChange: (patch: Partial<Settings>) => void
  selectedModel: ModelInfo | null
  selectedTier: ToolCallingTier
  settings: Settings | null
}) {
  const [skillDraft, setSkillDraft] = useState('')
  const [connectorDraft, setConnectorDraft] = useState('')
  const [mcpNameDraft, setMcpNameDraft] = useState('')
  const [mcpCommandDraft, setMcpCommandDraft] = useState('')
  const [toolInfo, setToolInfo] = useState<McpToolInfoResponse | null>(null)
  const [permissions, setPermissions] = useState<Record<string, ToolPermission>>({})
  const utilities = settings?.utilities ?? EMPTY_UTILITIES
  const disabled = !enabled || !settings
  const toolsBlocked = selectedTier === 'none'

  useEffect(() => {
    void bridge.mcp.toolInfo().then(setToolInfo).catch(() => undefined)
    void bridge.permissions.get().then(setPermissions).catch(() => undefined)
  }, [mcpStatuses])

  const updateUtilities = (patch: Partial<UtilitySettings>) => {
    if (disabled) return
    onSettingsChange({ utilities: { ...utilities, ...patch } })
  }

  const addSkill = () => {
    const label = skillDraft.trim()
    if (!label) return
    updateUtilities({ skills: [...utilities.skills, { id: createUtilityId('skill'), label }] })
    setSkillDraft('')
  }

  const addConnector = () => {
    const label = connectorDraft.trim()
    if (!label) return
    updateUtilities({ connectors: [...utilities.connectors, { id: createUtilityId('connector'), label }] })
    setConnectorDraft('')
  }

  const addMcpServer = () => {
    const name = mcpNameDraft.trim()
    const command = mcpCommandDraft.trim()
    if (!name || !command) return
    updateUtilities({
      mcpServers: [...utilities.mcpServers, { id: createUtilityId('mcp'), name, command, enabled: true }],
    })
    setMcpNameDraft('')
    setMcpCommandDraft('')
  }

  const setPermission = (toolKey: string, permission: ToolPermission) => {
    setPermissions((prev) => ({ ...prev, [toolKey]: permission }))
    void bridge.permissions.set({ toolKey, permission })
  }

  const statusFor = (id: string) => mcpStatuses.find((status) => status.id === id) ?? null
  const schemaPct = toolInfo && toolInfo.contextTokens > 0 ? (toolInfo.schemaTokens / toolInfo.contextTokens) * 100 : 0

  return (
    <div className="utilities-view">
      <section className={disabled ? 'utilities-section disabled' : 'utilities-section'} aria-disabled={disabled}>
        <div className="utilities-head">
          <div>
            <span>Utilities</span>
            <h3>Agent utilities</h3>
            <p>
              {selectedModel
                ? `Configured for ${selectedModel.name}`
                : 'Download and select a local model to configure utilities.'}
            </p>
          </div>
          <TierBadge tier={selectedTier} />
        </div>

        {toolsBlocked && selectedModel ? (
          <div className="tier-warning">
            <AlertTriangle size={16} />
            <span>
              <strong>{selectedModel.name}</strong> isn't trained for tool calling, so MCP tools stay off — the model
              would produce broken calls and blame would land on the app. Models marked <em>Agent-ready</em> in the
              catalog unlock the full harness.
            </span>
          </div>
        ) : null}
        {selectedTier === 'single' && selectedModel ? (
          <div className="tier-warning mild">
            <AlertTriangle size={16} />
            <span>
              This model handles single tool calls reliably, but not long agent loops — PowerStation caps it at 3 tool
              calls per turn.
            </span>
          </div>
        ) : null}

        <fieldset className="utilities-fieldset" disabled={disabled}>
          <div className="utilities-grid">
            <section className="utility-panel personalisation">
              <div className="utility-panel-head">
                <BookOpenCheck size={16} />
                <h4>Personalisation</h4>
              </div>
              <label className="utility-label">
                <span>System prompt</span>
                <textarea
                  aria-label="System prompt"
                  placeholder="Describe how the local model should behave for this workspace."
                  rows={7}
                  value={utilities.systemPrompt}
                  onChange={(event) => updateUtilities({ systemPrompt: event.target.value })}
                />
              </label>
            </section>

            <section className="utility-panel">
              <div className="utility-panel-head">
                <ShieldCheck size={16} />
                <h4>Skills</h4>
              </div>
              <UtilityAddRow
                buttonLabel="Add skill"
                onAdd={addSkill}
                placeholder="Skill name or local folder path"
                value={skillDraft}
                onChange={setSkillDraft}
              />
              <UtilityItemList
                emptyText="No skills added"
                items={utilities.skills}
                onRemove={(id) => updateUtilities({ skills: utilities.skills.filter((item) => item.id !== id) })}
              />
            </section>

            <section className="utility-panel">
              <div className="utility-panel-head">
                <Database size={16} />
                <h4>Connectors</h4>
              </div>
              <UtilityAddRow
                buttonLabel="Add connector"
                onAdd={addConnector}
                placeholder="Connector name or service"
                value={connectorDraft}
                onChange={setConnectorDraft}
              />
              <UtilityItemList
                emptyText="No connectors added"
                items={utilities.connectors}
                onRemove={(id) =>
                  updateUtilities({ connectors: utilities.connectors.filter((item) => item.id !== id) })
                }
              />
            </section>

            <section className="utility-panel mcp-panel">
              <div className="utility-panel-head">
                <Plug size={16} />
                <h4>MCP servers</h4>
              </div>

              {toolInfo && toolInfo.schemaTokens > 0 ? (
                <div className={schemaPct > 25 ? 'context-meter warn' : 'context-meter'}>
                  <Gauge size={14} />
                  <span>
                    Tool definitions use ~{toolInfo.schemaTokens.toLocaleString()} tokens of your{' '}
                    {toolInfo.contextTokens.toLocaleString()}-token context ({formatNumber(schemaPct, 0)}%)
                    {schemaPct > 25 ? ' — consider disabling servers you are not using.' : ''}
                  </span>
                </div>
              ) : null}

              <div className="mcp-add-grid">
                <input
                  aria-label="MCP server name"
                  placeholder="Server name"
                  value={mcpNameDraft}
                  onChange={(event) => setMcpNameDraft(event.target.value)}
                  disabled={toolsBlocked}
                />
                <input
                  aria-label="MCP server command"
                  placeholder='Command, e.g. npx -y @modelcontextprotocol/server-filesystem ~/Documents'
                  value={mcpCommandDraft}
                  onChange={(event) => setMcpCommandDraft(event.target.value)}
                  disabled={toolsBlocked}
                />
                <button
                  className="secondary-button compact"
                  type="button"
                  onClick={addMcpServer}
                  disabled={toolsBlocked || !mcpNameDraft.trim() || !mcpCommandDraft.trim()}
                >
                  <Plus size={14} />
                  Add server
                </button>
              </div>

              <div className="utility-list">
                {utilities.mcpServers.length ? (
                  utilities.mcpServers.map((server) => {
                    const status = statusFor(server.id)
                    return (
                      <div className="utility-item mcp-item" key={server.id}>
                        <div className="mcp-item-main">
                          <strong>{server.name}</strong>
                          <code>{server.command}</code>
                          <div className="mcp-item-status">
                            {status ? (
                              <Badge
                                tone={
                                  status.state === 'connected' ? 'real' : status.state === 'error' ? 'danger' : 'neutral'
                                }
                              >
                                {status.state === 'connected'
                                  ? `connected · ${status.toolCount} tools`
                                  : status.state}
                              </Badge>
                            ) : (
                              <Badge tone="neutral">{server.enabled ? 'not connected' : 'disabled'}</Badge>
                            )}
                            {status?.error ? <span className="mcp-error">{status.error}</span> : null}
                          </div>
                        </div>
                        <div className="mcp-item-actions">
                          <label className="mcp-toggle" title={server.enabled ? 'Disable server' : 'Enable server'}>
                            <input
                              type="checkbox"
                              checked={server.enabled}
                              onChange={(event) =>
                                updateUtilities({
                                  mcpServers: utilities.mcpServers.map((item) =>
                                    item.id === server.id ? { ...item, enabled: event.target.checked } : item,
                                  ),
                                })
                              }
                            />
                            <span>{server.enabled ? 'On' : 'Off'}</span>
                          </label>
                          <button
                            className="ghost-button danger"
                            type="button"
                            title={`Remove ${server.name}`}
                            onClick={() =>
                              updateUtilities({
                                mcpServers: utilities.mcpServers.filter((item) => item.id !== server.id),
                              })
                            }
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    )
                  })
                ) : (
                  <p className="utility-empty">
                    No MCP servers added. MCP servers give the model tools — files, search, APIs — always behind a
                    permission prompt.
                  </p>
                )}
              </div>

              {toolInfo && toolInfo.tools.length ? (
                <div className="tool-permission-list">
                  <h5>Tool permissions</h5>
                  {toolInfo.tools.map((tool) => (
                    <div className="tool-permission-row" key={tool.key}>
                      <div>
                        <strong>{tool.name}</strong>
                        <span>{tool.serverName}</span>
                      </div>
                      <select
                        aria-label={`Permission for ${tool.key}`}
                        value={permissions[tool.key] ?? 'ask'}
                        onChange={(event) => setPermission(tool.key, event.target.value as ToolPermission)}
                      >
                        <option value="ask">Ask every time</option>
                        <option value="allow">Always allow</option>
                        <option value="deny">Never allow</option>
                      </select>
                    </div>
                  ))}
                </div>
              ) : null}
            </section>
          </div>
        </fieldset>
      </section>
    </div>
  )
}

function UtilityAddRow({
  buttonLabel,
  onAdd,
  onChange,
  placeholder,
  value,
}: {
  buttonLabel: string
  onAdd: () => void
  onChange: (value: string) => void
  placeholder: string
  value: string
}) {
  return (
    <div className="utility-add-row">
      <input
        aria-label={buttonLabel}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            onAdd()
          }
        }}
      />
      <button className="secondary-button compact" type="button" onClick={onAdd} disabled={!value.trim()}>
        <Plus size={14} />
        {buttonLabel}
      </button>
    </div>
  )
}

function UtilityItemList({
  emptyText,
  items,
  onRemove,
}: {
  emptyText: string
  items: UtilitySettings['skills']
  onRemove: (id: string) => void
}) {
  return (
    <div className="utility-list">
      {items.length ? (
        items.map((item) => (
          <div className="utility-item" key={item.id}>
            <span>{item.label}</span>
            <button
              className="ghost-button danger"
              type="button"
              title={`Remove ${item.label}`}
              onClick={() => onRemove(item.id)}
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))
      ) : (
        <p className="utility-empty">{emptyText}</p>
      )}
    </div>
  )
}

// --- Settings ---------------------------------------------------------------------

export function SettingsView({ onChange, settings }: { onChange: (patch: Partial<Settings>) => void; settings: Settings }) {
  return (
    <div className="settings-view">
      <PanelHeader eyebrow="Settings" title="Runtime & generation" />
      <div className="settings-grid">
        <section className="settings-section">
          <h3>Generation</h3>
          <RangeControl
            label="Temperature"
            value={settings.temperature}
            min={0}
            max={1.5}
            step={0.05}
            unit=""
            onChange={(value) => onChange({ temperature: value })}
          />
          <RangeControl
            label="Max response tokens"
            value={settings.maxTokens}
            min={0}
            max={4096}
            step={64}
            unit={settings.maxTokens === 0 ? '(no cap)' : 'tok'}
            onChange={(value) => onChange({ maxTokens: value })}
          />
          <RangeControl
            label="Context window"
            value={settings.contextTokens}
            min={512}
            max={131072}
            step={512}
            unit="tok"
            onChange={(value) => onChange({ contextTokens: value })}
          />
          <p className="policy-note subtle">
            The context window is a request, not a promise — before every load PowerStation checks it against your
            memory and shrinks it if it wouldn't fit safely.
          </p>
        </section>

        <section className="settings-section">
          <h3>Runtime policy</h3>
          <RangeControl
            label="Memory budget"
            value={settings.memoryBudgetGb}
            min={4}
            max={64}
            step={1}
            unit="GB"
            onChange={(value) => onChange({ memoryBudgetGb: value })}
          />
          <RangeControl
            label="Compute cap"
            value={settings.computeCap}
            min={20}
            max={100}
            step={1}
            unit="%"
            onChange={(value) => onChange({ computeCap: value })}
          />
          <ToggleControl
            label="Auto unload on idle"
            checked={settings.autoUnloadIdle}
            onChange={(value) => onChange({ autoUnloadIdle: value })}
          />
          <ToggleControl
            label="Low power bias"
            checked={settings.lowPowerBias}
            onChange={(value) => onChange({ lowPowerBias: value })}
          />
          <div className="policy-note">
            <AlertTriangle size={17} />
            <span>Memory budget and compute cap are advisory guides today — llama.cpp manages allocation directly.</span>
          </div>
        </section>
      </div>

      <div className="settings-footer">
        <ShieldCheck size={16} />
        <span>
          All inference runs locally on this device. Prompts and responses never leave your machine. Models live in
          PowerStation's local models folder; chats stay in memory unless you copy them out.
        </span>
      </div>
    </div>
  )
}
