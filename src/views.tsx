import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle,
  BadgeCheck,
  BookOpenCheck,
  Brain,
  Code2,
  Cpu,
  Database,
  Download,
  ExternalLink,
  FileDown,
  FlaskConical,
  FolderOpen,
  FolderSearch,
  Gauge,
  Globe,
  HardDrive,
  ListOrdered,
  Microchip,
  Plug,
  Plus,
  RefreshCw,
  Search as SearchIcon,
  ShieldCheck,
  Sparkle,
  Wand2,
  Thermometer,
  Trash2,
  Wrench,
  Zap,
} from 'lucide-react'
import type { LucideIcon as LucideIconType } from 'lucide-react'
import { getDesktop } from './desktop'
import type {
  BenchmarkRecord,
  Catalog,
  CatalogModel,
  ConnectorCatalog,
  ConnectorEntry,
  DeviceInfo,
  FitReport,
  McpServerConfig,
  McpServerStatus,
  McpToolInfoResponse,
  ModelInfo,
  OllamaStatus,
  IndexProgress,
  RagIndexListing,
  Recommendation,
  Settings,
  SkillCatalog,
  SkillInfo,
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
  skillModes: {},
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
  if (fit.offload) return <Badge tone="estimated">Runs on CPU · slower</Badge>
  if (fit.verdict === 'tight') return <Badge tone="estimated">Tight fit</Badge>
  return <Badge tone="danger">Won't fit this machine</Badge>
}

function TierBadge({ tier }: { tier: ToolCallingTier }) {
  if (tier === 'multi') return <Badge tone="real">Agent-ready</Badge>
  if (tier === 'single') return <Badge tone="estimated">Basic tools</Badge>
  return <Badge tone="neutral">Chat only</Badge>
}

export function CatalogGrid({
  benchResults,
  catalog,
  download,
  fitReports,
  onDownload,
  onOpenWebsite,
  selectedModel,
}: {
  benchResults?: Record<string, BenchmarkRecord>
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
              {model.vision ? (
                <span
                  className="badge neutral"
                  title="This model can accept images. PowerStation's local runtime doesn't support image input yet — vision lands the moment the runtime does (see the roadmap)."
                >
                  vision-capable model
                </span>
              ) : null}
            </div>

            <div className="starter-specs" aria-label={`${model.name} specs`}>
              <span>{model.totalParamsB}B{model.activeParamsB ? ` · ${model.activeParamsB}B active` : ''}</span>
              <span>{model.quant}</span>
              <span>{formatBytes(model.sizeBytes)}</span>
              <span>{model.minRamGb}GB+ RAM</span>
              {benchResults?.[model.fileName.toLowerCase()] ? (
                <span className="measured-tps" title="Measured with a standard benchmark on this machine">
                  ⚡ {formatNumber(benchResults[model.fileName.toLowerCase()].tokensPerSec, 1)} tok/s measured
                  {benchResults[model.fileName.toLowerCase()].promptTokensPerSec > 0
                    ? ` · reads ${formatNumber(benchResults[model.fileName.toLowerCase()].promptTokensPerSec, 0)} tok/s`
                    : ''}
                </span>
              ) : model.expectedTps ? (
                <span>{model.expectedTps}</span>
              ) : null}
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
      detail: bridge.platform === 'darwin' ? 'macOS kernel signal' : 'derived from available memory',
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

// --- Recommendation panel ---------------------------------------------------------

const REC_USE_CASES: Array<{ id: string; label: string }> = [
  { id: 'everyday', label: 'Everyday assistant' },
  { id: 'coding', label: 'Coding' },
  { id: 'agents', label: 'Agents & tools' },
  { id: 'documents', label: 'Private documents' },
  { id: 'reasoning', label: 'Deep reasoning' },
]

function RecommendPanel({
  download,
  models,
  onDownload,
}: {
  download: DownloadState
  models: ModelInfo[]
  onDownload: (uri: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [useCase, setUseCase] = useState('everyday')
  const [priority, setPriority] = useState<'speed' | 'balanced' | 'quality'>('balanced')
  const [results, setResults] = useState<Recommendation[] | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    // Prefill from the onboarding answers.
    void bridge.onboarding.get().then((state) => {
      if (state.useCase) setUseCase(state.useCase)
      if (state.priority === 'speed' || state.priority === 'balanced' || state.priority === 'quality') {
        setPriority(state.priority)
      }
    }).catch(() => undefined)
  }, [])

  const run = async () => {
    setBusy(true)
    try {
      setResults(await bridge.catalog.recommend({ useCase: useCase as Recommendation['model']['useCases'][number], priority }))
    } catch {
      setResults([])
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <div className="recommend-collapsed">
        <button className="secondary-button" type="button" onClick={() => setOpen(true)}>
          <Wand2 size={15} />
          Get a recommendation for this machine
        </button>
      </div>
    )
  }

  return (
    <section className="recommend-panel">
      <div className="recommend-controls">
        <label>
          <span>I mainly want</span>
          <select value={useCase} onChange={(event) => setUseCase(event.target.value)}>
            {REC_USE_CASES.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Priority</span>
          <select value={priority} onChange={(event) => setPriority(event.target.value as typeof priority)}>
            <option value="speed">Fast replies</option>
            <option value="balanced">Balanced</option>
            <option value="quality">Smartest that fits</option>
          </select>
        </label>
        <button className="primary-button compact-primary" type="button" disabled={busy} onClick={() => void run()}>
          {busy ? 'Checking…' : 'Recommend'}
        </button>
        <button className="ghost-button" type="button" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>

      {results !== null ? (
        results.length === 0 ? (
          <p className="utility-empty">Nothing in the catalogue comfortably fits this machine for that use.</p>
        ) : (
          <div className="recommend-results">
            {results.map((rec, index) => {
              const installed = models.some((m) => m.fileName.toLowerCase() === rec.model.fileName.toLowerCase())
              const busyDownload = Boolean(download) && !download?.error
              return (
                <article className={index === 0 ? 'recommend-card top' : 'recommend-card'} key={rec.model.id}>
                  <div className="recommend-card-head">
                    <strong>{rec.model.name}</strong>
                    {index === 0 ? <Badge tone="real">best match</Badge> : null}
                    <span className="muted">{formatBytes(rec.model.sizeBytes)}</span>
                  </div>
                  <ul>
                    {rec.reasons.slice(0, 2).map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                  {installed ? (
                    <Badge tone="neutral">already installed</Badge>
                  ) : (
                    <button
                      className="secondary-button compact"
                      type="button"
                      disabled={busyDownload}
                      onClick={() => onDownload(rec.model.downloadUrl)}
                    >
                      <Download size={14} />
                      Download
                    </button>
                  )}
                </article>
              )
            })}
          </div>
        )
      ) : null}
    </section>
  )
}

// --- Models ---------------------------------------------------------------------

export function ModelsView({
  benchBusyPath,
  benchResults,
  benchmarking,
  catalog,
  catalogRefreshing,
  device,
  download,
  fitReports,
  models,
  ollama,
  onAddFolder,
  onBenchmark,
  onDelete,
  onDownload,
  onImportOllama,
  onOpenWebsite,
  onImportFile,
  onRefreshCatalog,
  onRemove,
  onReveal,
  onSelect,
  selectedPath,
}: {
  benchBusyPath: string | null
  benchResults: Record<string, BenchmarkRecord>
  benchmarking: boolean
  catalog: Catalog | null
  catalogRefreshing: boolean
  device: DeviceInfo | null
  download: DownloadState
  fitReports: Record<string, FitReport | null>
  models: ModelInfo[]
  ollama: OllamaStatus | null
  onAddFolder: () => void
  onBenchmark: (model: ModelInfo) => void
  onDelete: (model: ModelInfo) => void
  onDownload: (uri: string) => void
  onImportOllama: (name: string) => void
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
          benchResults={benchResults}
          catalog={catalog}
          download={download}
          fitReports={fitReports}
          onDownload={onDownload}
          onOpenWebsite={onOpenWebsite}
          selectedModel={selectedModel}
        />
      </section>

      <RecommendPanel download={download} models={models} onDownload={onDownload} />

      {ollama?.detected && ollama.models.length > 0 ? (
        <section className="ollama-card">
          <div className="ollama-card-head">
            <span className="connector-icon">
              <Database size={16} />
            </span>
            <div>
              <h3>Found in Ollama {ollama.running ? `(running v${ollama.version})` : '(installed)'}</h3>
              <p>
                Use models you already downloaded with Ollama — no re-download, no extra disk. They run in
                PowerStation's own runtime with the same admission checks as any other model.
              </p>
            </div>
          </div>
          <div className="ollama-model-list">
            {ollama.models.map((model) => {
              const imported = models.some((m) => m.path === model.blobPath)
              return (
                <div className="ollama-model-row" key={model.name}>
                  <div className="ollama-model-main">
                    <strong>{model.name}</strong>
                    <span>
                      {[model.parameterSize, model.quantization, formatBytes(model.sizeBytes)]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </div>
                  {imported ? (
                    <Badge tone="real">imported ✓</Badge>
                  ) : (
                    <button className="secondary-button compact" type="button" onClick={() => onImportOllama(model.name)}>
                      <FileDown size={14} />
                      Use in PowerStation
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      ) : null}

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
          {benchmarking && !download.error ? (
            <p className="benchmarking-note">Measuring speed on your machine — chat is ready the moment this finishes.</p>
          ) : null}
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
                  {model.measuredTps ? (
                    <Badge tone="real">
                      {formatNumber(model.measuredTps, 1)} tok/s
                      {benchResults[model.fileName.toLowerCase()]?.promptTokensPerSec
                        ? ` · reads ${formatNumber(benchResults[model.fileName.toLowerCase()].promptTokensPerSec, 0)}`
                        : ''}{' '}
                      measured
                    </Badge>
                  ) : null}
                </div>
                <div className="model-row-actions">
                  <button
                    className="ghost-button"
                    type="button"
                    title="Measure real tokens/sec for this model on this machine"
                    disabled={benchBusyPath !== null}
                    onClick={() => onBenchmark(model)}
                  >
                    {benchBusyPath === model.path ? 'Benchmarking…' : 'Benchmark'}
                  </button>
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

            <SkillsPanel contextTokens={settings?.contextTokens ?? 8192} />

            <ConnectorGallery
              mcpServers={utilities.mcpServers}
              onServersChanged={(servers) => updateUtilities({ mcpServers: servers })}
              toolsBlocked={toolsBlocked}
            />

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

// --- Skills -----------------------------------------------------------------------

const EMPTY_SKILL_DRAFT = { name: '', description: '', body: '', triggers: '' }

function SkillsPanel({ contextTokens }: { contextTokens: number }) {
  const [skills, setSkills] = useState<SkillInfo[] | null>(null)
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const [draft, setDraft] = useState(EMPTY_SKILL_DRAFT)
  const [saving, setSaving] = useState(false)
  const [gallery, setGallery] = useState<SkillCatalog | null>(null)
  const [galleryOpen, setGalleryOpen] = useState(false)
  const [installing, setInstalling] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const list = await bridge.skills.list().catch(() => [])
    setSkills(list)
  }, [])

  useEffect(() => {
    // One-shot load on mount; state is set after awaited IPC, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh()
  }, [refresh])

  const setMode = (skill: SkillInfo, mode: SkillInfo['mode']) => {
    void bridge.skills.setMode({ slug: skill.slug, mode }).then(refresh)
  }

  const startEdit = (skill: SkillInfo | null) => {
    setEditing(skill ? skill.slug : 'new')
    setDraft(
      skill
        ? { name: skill.name, description: skill.description, body: skill.body, triggers: skill.triggers.join(', ') }
        : EMPTY_SKILL_DRAFT,
    )
  }

  const saveDraft = async () => {
    if (!draft.name.trim() || !draft.body.trim()) return
    setSaving(true)
    try {
      await bridge.skills.save({ slug: editing === 'new' ? undefined : (editing ?? undefined), ...draft })
      setEditing(null)
      await refresh()
    } finally {
      setSaving(false)
    }
  }

  const remove = async (skill: SkillInfo) => {
    if (!window.confirm(`Delete the skill "${skill.name}"? The file is removed from disk.`)) return
    await bridge.skills.delete(skill.slug)
    if (editing === skill.slug) setEditing(null)
    await refresh()
  }

  const openGallery = () => {
    setGalleryOpen((open) => !open)
    if (!gallery) void bridge.skills.gallery().then(setGallery).catch(() => undefined)
  }

  const install = async (id: string) => {
    setInstalling(id)
    try {
      await bridge.skills.install(id)
      await refresh()
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error))
    } finally {
      setInstalling(null)
    }
  }

  const enabledTokens = (skills ?? []).filter((s) => s.mode === 'always').reduce((sum, s) => sum + s.tokenEstimate, 0)
  const skillPct = contextTokens > 0 ? (enabledTokens / contextTokens) * 100 : 0

  return (
    <section className="utility-panel skills-panel">
      <div className="utility-panel-head">
        <BookOpenCheck size={16} />
        <h4>Skills</h4>
        <div className="panel-head-actions">
          <button className="ghost-button" type="button" onClick={() => void bridge.skills.reveal()}>
            Show files
          </button>
          <button className="secondary-button compact" type="button" onClick={openGallery}>
            <Sparkle size={14} />
            {galleryOpen ? 'Close gallery' : 'Browse gallery'}
          </button>
          <button className="secondary-button compact" type="button" onClick={() => startEdit(null)}>
            <Plus size={14} />
            New skill
          </button>
        </div>
      </div>
      <p className="panel-hint">
        Skills are reusable instructions — plain markdown files — added to the system prompt. <strong>Always</strong>{' '}
        applies on every message; <strong>Auto</strong> activates only when a message matches the skill's triggers,
        saving context on small models. They work with every model, including chat-only ones.
      </p>

      {enabledTokens > 0 ? (
        <div className={skillPct > 25 ? 'context-meter warn' : 'context-meter'}>
          <Gauge size={14} />
          <span>
            Always-on skills use ~{enabledTokens.toLocaleString()} tokens of your {contextTokens.toLocaleString()}-token
            context ({formatNumber(skillPct, 0)}%)
            {skillPct > 25 ? ' — consider switching some to Auto.' : ''}
          </span>
        </div>
      ) : null}

      {galleryOpen ? (
        <div className="skill-gallery">
          {gallery === null ? (
            <p className="utility-empty">Loading gallery…</p>
          ) : (
            <>
              <p className="panel-hint">
                Curated skills, updated with the catalogue — installing copies a markdown file into your skills
                folder, yours to edit or delete.
              </p>
              <div className="skill-gallery-grid">
                {gallery.skills.map((entry) => {
                  const installed = (skills ?? []).some((skill) => skill.slug === entry.id)
                  return (
                    <article className="skill-gallery-card" key={entry.id}>
                      <div className="skill-gallery-head">
                        <strong>{entry.name}</strong>
                        <Badge tone="neutral">{entry.category}</Badge>
                      </div>
                      <p>{entry.description}</p>
                      <span className="skill-gallery-meta">
                        ~{Math.ceil(entry.body.length / 4)} tok
                        {entry.triggers ? ` · triggers: ${entry.triggers.split(',').slice(0, 3).join(',')}` : ''}
                      </span>
                      {installed ? (
                        <Badge tone="real">installed ✓</Badge>
                      ) : (
                        <button
                          className="secondary-button compact"
                          type="button"
                          disabled={installing !== null}
                          onClick={() => void install(entry.id)}
                        >
                          {installing === entry.id ? 'Installing…' : 'Install'}
                        </button>
                      )}
                    </article>
                  )
                })}
              </div>
            </>
          )}
        </div>
      ) : null}

      <div className="skill-list">
        {skills === null ? (
          <p className="utility-empty">Loading skills…</p>
        ) : skills.length === 0 && editing !== 'new' ? (
          <p className="utility-empty">No skills yet — create one, or drop .md files into the skills folder.</p>
        ) : (
          skills.map((skill) => (
            <div className={skill.mode !== 'off' ? 'skill-card enabled' : 'skill-card'} key={skill.slug}>
              <div className="skill-card-row">
                <select
                  className="skill-mode"
                  aria-label={`Activation for ${skill.name}`}
                  value={skill.mode}
                  onChange={(event) => setMode(skill, event.target.value as SkillInfo['mode'])}
                >
                  <option value="off">Off</option>
                  <option value="auto">Auto</option>
                  <option value="always">Always</option>
                </select>
                <button className="skill-card-main" type="button" onClick={() => startEdit(skill)}>
                  <strong>{skill.name}</strong>
                  <span>
                    {skill.description || 'No description'}
                    {skill.mode === 'auto'
                      ? ` — triggers: ${skill.triggers.length ? skill.triggers.join(', ') : '(name words)'}`
                      : ''}
                  </span>
                </button>
                <div className="skill-card-side">
                  <Badge tone="neutral">~{skill.tokenEstimate} tok</Badge>
                  {skill.builtIn ? <Badge tone="neutral">starter</Badge> : null}
                  <button
                    className="ghost-button danger"
                    type="button"
                    title={`Delete ${skill.name}`}
                    onClick={() => void remove(skill)}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
              {editing === skill.slug ? (
                <SkillEditor draft={draft} onChange={setDraft} onCancel={() => setEditing(null)} onSave={() => void saveDraft()} saving={saving} />
              ) : null}
            </div>
          ))
        )}
        {editing === 'new' ? (
          <div className="skill-card enabled">
            <SkillEditor draft={draft} onChange={setDraft} onCancel={() => setEditing(null)} onSave={() => void saveDraft()} saving={saving} />
          </div>
        ) : null}
      </div>
    </section>
  )
}

function SkillEditor({
  draft,
  onCancel,
  onChange,
  onSave,
  saving,
}: {
  draft: typeof EMPTY_SKILL_DRAFT
  onCancel: () => void
  onChange: (draft: typeof EMPTY_SKILL_DRAFT) => void
  onSave: () => void
  saving: boolean
}) {
  return (
    <div className="skill-editor">
      <div className="skill-editor-meta">
        <input
          aria-label="Skill name"
          placeholder="Skill name"
          value={draft.name}
          onChange={(event) => onChange({ ...draft, name: event.target.value })}
        />
        <input
          aria-label="Skill description"
          placeholder="One-line description"
          value={draft.description}
          onChange={(event) => onChange({ ...draft, description: event.target.value })}
        />
      </div>
      <input
        aria-label="Skill triggers"
        placeholder="Auto-mode triggers, comma-separated (e.g. review, refactor) — leave empty to match the name"
        value={draft.triggers}
        onChange={(event) => onChange({ ...draft, triggers: event.target.value })}
      />
      <textarea
        aria-label="Skill instructions"
        placeholder="The instructions added to the system prompt while this skill is enabled…"
        rows={8}
        value={draft.body}
        onChange={(event) => onChange({ ...draft, body: event.target.value })}
      />
      <div className="skill-editor-actions">
        <span className="muted">~{Math.ceil(draft.body.length / 4)} tokens</span>
        <div>
          <button className="ghost-button" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="primary-button compact-primary"
            type="button"
            disabled={saving || !draft.name.trim() || !draft.body.trim()}
            onClick={onSave}
          >
            {saving ? 'Saving…' : 'Save skill'}
          </button>
        </div>
      </div>
    </div>
  )
}

// --- Connector gallery ---------------------------------------------------------

const CONNECTOR_ICONS: Record<string, LucideIconType> = {
  filesystem: FolderOpen,
  memory: Brain,
  'web-fetch': Globe,
  'web-search': SearchIcon,
  'sequential-thinking': ListOrdered,
  'everything-demo': FlaskConical,
}

function ConnectorGallery({
  mcpServers,
  onServersChanged,
  toolsBlocked,
}: {
  mcpServers: McpServerConfig[]
  onServersChanged: (servers: McpServerConfig[]) => void
  toolsBlocked: boolean
}) {
  const [gallery, setGallery] = useState<ConnectorCatalog | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    void bridge.connectors.get().then(setGallery).catch(() => undefined)
  }, [])

  const addedCount = (entry: ConnectorEntry) =>
    mcpServers.filter((server) => server.command.startsWith(`npx -y ${entry.npmPackage}`)).length

  const add = async (entry: ConnectorEntry) => {
    setBusyId(entry.id)
    try {
      let folder: string | undefined
      if (entry.needsFolder) {
        const picked = await bridge.connectors.pickFolder()
        if (!picked) return
        folder = picked
      }
      const servers = await bridge.connectors.add({ connectorId: entry.id, folder })
      onServersChanged(servers)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="utility-panel connector-panel">
      <div className="utility-panel-head">
        <Plug size={16} />
        <h4>Connector gallery</h4>
      </div>
      <p className="panel-hint">
        Curated tools the model can use — one click, no commands to paste. Every tool call still goes through your
        permission prompts.
      </p>
      <div className="connector-grid">
        {gallery === null ? (
          <p className="utility-empty">Loading connectors…</p>
        ) : (
          gallery.connectors.map((entry) => {
            const Icon = CONNECTOR_ICONS[entry.id] ?? Plug
            const count = addedCount(entry)
            const added = count > 0
            return (
              <article className={added ? 'connector-card added' : 'connector-card'} key={entry.id}>
                <div className="connector-card-head">
                  <span className="connector-icon">
                    <Icon size={17} />
                  </span>
                  <div>
                    <h5>{entry.name}</h5>
                    <p>{entry.tagline}</p>
                  </div>
                </div>
                <div className="connector-badges">
                  <Badge tone={entry.maintainer === 'official' ? 'real' : 'neutral'}>
                    {entry.maintainer === 'official' ? 'official' : 'community'}
                  </Badge>
                  {entry.worksOffline ? <Badge tone="neutral">works offline</Badge> : <Badge tone="estimated">uses internet</Badge>}
                </div>
                <p className="connector-detail">{entry.detail}</p>
                {entry.permissionsNote ? <p className="connector-permissions">{entry.permissionsNote}</p> : null}
                <button
                  className={added ? 'secondary-button compact' : 'primary-button compact-primary'}
                  type="button"
                  disabled={toolsBlocked || busyId !== null}
                  title={toolsBlocked ? 'The selected model is not tool-trained' : undefined}
                  onClick={() => void add(entry)}
                >
                  {busyId === entry.id
                    ? 'Adding…'
                    : added
                      ? entry.needsFolder
                        ? `Added ${count} · add another folder`
                        : 'Added ✓'
                      : entry.needsFolder
                        ? 'Add & choose folder…'
                        : 'Add'}
                </button>
              </article>
            )
          })
        )}
      </div>
    </section>
  )
}

// --- Knowledge folders (RAG index manager) --------------------------------------

function KnowledgeFoldersSection() {
  const [indexes, setIndexes] = useState<RagIndexListing[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [progress, setProgress] = useState<IndexProgress | null>(null)

  const refresh = useCallback(async () => {
    const list = await bridge.rag.list().catch(() => [])
    setIndexes(list)
  }, [])

  useEffect(() => {
    // One-shot load on mount; state is set after awaited IPC, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh()
    return bridge.rag.onIndexProgress(setProgress)
  }, [refresh])

  const reindex = async (id: string) => {
    setBusyId(id)
    try {
      await bridge.rag.reindex(id)
      await refresh()
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error))
    } finally {
      setBusyId(null)
      setProgress(null)
    }
  }

  const remove = async (listing: RagIndexListing) => {
    if (!window.confirm(`Delete the index for "${listing.name}"? The folder itself is untouched.`)) return
    await bridge.rag.delete(listing.folderId)
    await refresh()
  }

  if (indexes !== null && indexes.length === 0) return null

  return (
    <section className="settings-section">
      <h3>Knowledge folders</h3>
      <p className="policy-note subtle">
        Folders you've attached to chats, indexed for retrieval. Indexes are plain JSON files in
        PowerStation's data folder; deleting one never touches the folder itself.
      </p>
      {indexes === null ? (
        <p className="utility-empty">Loading…</p>
      ) : (
        <div className="rag-index-list">
          {indexes.map((listing) => (
            <div className="rag-index-row" key={listing.folderId}>
              <div className="rag-index-main">
                <strong>{listing.name}</strong>
                <span title={listing.folder}>
                  {listing.fileCount} files · {listing.chunkCount} chunks · {formatBytes(listing.sizeBytes)} · indexed{' '}
                  {new Date(listing.builtAt).toLocaleDateString()}
                </span>
              </div>
              <div className="rag-index-side">
                {listing.missing ? (
                  <Badge tone="danger">folder missing</Badge>
                ) : listing.stale ? (
                  <Badge tone="estimated">folder changed</Badge>
                ) : (
                  <Badge tone="real">up to date</Badge>
                )}
                {!listing.missing ? (
                  <button
                    className="ghost-button"
                    type="button"
                    disabled={busyId !== null}
                    onClick={() => void reindex(listing.folderId)}
                  >
                    {busyId === listing.folderId
                      ? progress?.phase === 'embedding'
                        ? `Indexing ${progress.done}/${progress.total}`
                        : 'Re-indexing…'
                      : 'Re-index'}
                  </button>
                ) : null}
                <button className="ghost-button danger" type="button" onClick={() => void remove(listing)}>
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

// --- Settings ---------------------------------------------------------------------

export function SettingsView({
  onChange,
  onDeleteAllChats,
  onRevealChats,
  settings,
}: {
  onChange: (patch: Partial<Settings>) => void
  onDeleteAllChats: () => void
  onRevealChats: () => void
  settings: Settings
}) {
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
          <ToggleControl
            label="Compress long chats automatically"
            checked={settings.autoCompact}
            onChange={(value) => onChange({ autoCompact: value })}
          />
          <p className="policy-note subtle">
            When a conversation nears the context limit, the model summarizes its older turns for itself and keeps
            going — the transcript you see is never shortened. A notice appears in the chat whenever this happens.
          </p>
        </section>

        <section className="settings-section">
          <h3>Chat history</h3>
          <ToggleControl
            label="Save chats on this device"
            checked={settings.saveChats}
            onChange={(value) => onChange({ saveChats: value })}
          />
          <p className="policy-note subtle">
            Saved chats are plain JSON files in PowerStation's data folder — nothing leaves this machine. Turning
            saving off stops new writes; existing files stay until you delete them.
          </p>
          <div className="settings-actions">
            <button className="secondary-button compact" type="button" onClick={onRevealChats}>
              Show chat files
            </button>
            <button className="ghost-button danger" type="button" onClick={onDeleteAllChats}>
              Delete all chats
            </button>
          </div>
        </section>

        <KnowledgeFoldersSection />

        <section className="settings-section">
          <h3>Memory safety</h3>
          <p className="policy-note subtle">
            Memory management is automatic. Before any model loads, PowerStation computes its real footprint
            (weights + context cache + buffers) against your machine's measured GPU budget and refuses or shrinks the
            request if it wouldn't fit. While generating, it watches the operating system's memory-pressure signal and
            pauses automatically if the system gets into trouble — no knobs to mistune.
          </p>
          <div className="policy-note">
            <ShieldCheck size={17} />
            <span>The Monitor tab shows the live signals these decisions are based on, labelled as measured or estimated.</span>
          </div>
        </section>
      </div>

      <div className="settings-footer">
        <ShieldCheck size={16} />
        <span>
          All inference runs locally on this device. Prompts and responses never leave your machine. Models live in
          PowerStation's local models folder; saved chats are plain files you can open, reveal, or delete above.
        </span>
      </div>
    </div>
  )
}
