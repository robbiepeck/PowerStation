import { useState } from 'react'
import type { ReactNode } from 'react'
import {
  AlertTriangle,
  BadgeCheck,
  BookOpenCheck,
  Code2,
  Cpu,
  Database,
  Download,
  FileDown,
  FolderSearch,
  HardDrive,
  Microchip,
  RefreshCw,
  ShieldCheck,
  Thermometer,
  Trash2,
  Zap,
} from 'lucide-react'
import { STARTER_MODELS, type StarterModel } from './modelCatalog'
import type { DeviceInfo, ModelInfo, Settings, TelemetrySnapshot } from './types'
import {
  Badge,
  MetricTile,
  PanelHeader,
  RangeControl,
  Sparkline,
  ToggleControl,
  clamp,
  formatBytes,
  formatNumber,
} from './ui'

export type MetricKey = 'cpu' | 'ram' | 'gpu' | 'vram' | 'power' | 'thermal'
export type MetricSeries = Record<MetricKey, number[]>

export type DownloadState = {
  id: string
  uri: string
  totalSize: number
  downloadedSize: number
  error?: string
} | null

function starterIcon(model: StarterModel) {
  if (model.tone === 'compact') return Zap
  if (model.tone === 'code') return Code2
  if (model.tone === 'strong') return Cpu
  return BookOpenCheck
}

export function StarterModelCatalog({
  download,
  onDownload,
  onManageModels,
  variant = 'models',
}: {
  download: DownloadState
  onDownload: (uri: string) => void
  onManageModels?: () => void
  variant?: 'models' | 'welcome'
}) {
  const downloadingUri = download?.uri
  const downloadPct = download && download.totalSize ? (download.downloadedSize / download.totalSize) * 100 : 0

  return (
    <section className={`starter-catalog ${variant}`}>
      <div className="starter-catalog-head">
        <span>Starter models</span>
        <h2>{variant === 'welcome' ? 'Download a local model to begin' : 'Download from PowerStation'}</h2>
        <p>
          Pick a GGUF model and PowerStation will download it into the local model folder, import it, and select it for
          chat when the download completes.
        </p>
      </div>

      <div className="starter-grid">
        {STARTER_MODELS.map((model) => {
          const Icon = starterIcon(model)
          const active = downloadingUri === model.uri
          const disabled = Boolean(download) && !download?.error
          const failed = active && Boolean(download?.error)
          const label = active && !download?.error ? 'Downloading' : failed ? 'Retry download' : 'Download'

          return (
            <article className={`starter-card ${model.tone}`} key={model.id}>
              <div className="starter-card-top">
                <span className="starter-icon" aria-hidden="true">
                  <Icon size={18} />
                </span>
                <div>
                  <h3>{model.name}</h3>
                  <p>{model.bestFor}</p>
                </div>
              </div>

              <div className="starter-specs" aria-label={`${model.name} specs`}>
                <span>{model.parameters}</span>
                <span>{model.quantization}</span>
                <span>{model.downloadSize}</span>
                <span>{model.recommendedMemory}</span>
                <span>{model.license}</span>
              </div>

              <div className="starter-tradeoffs">
                <div>
                  <strong>Pros</strong>
                  <ul>
                    {model.pros.map((item) => (
                      <li key={item}>
                        <BadgeCheck size={13} />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <strong>Cons</strong>
                  <ul>
                    {model.cons.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              </div>

              {active ? (
                <div className="starter-download-status">
                  {download?.error ? (
                    <p className="error-text">{download.error}</p>
                  ) : (
                    <>
                      <div className="download-progress-head">
                        <span>{label}</span>
                        <strong>
                          {formatBytes(download?.downloadedSize ?? 0)} / {formatBytes(download?.totalSize ?? 0)}
                        </strong>
                      </div>
                      <div className="meter-track medium">
                        <span style={{ width: `${clamp(downloadPct, 2, 100)}%` }} />
                      </div>
                    </>
                  )}
                </div>
              ) : null}

              <button
                className="primary-button starter-download"
                type="button"
                disabled={disabled && !failed}
                onClick={() => onDownload(model.uri)}
              >
                <Download size={15} />
                {disabled && !active ? 'Download running' : label}
              </button>
            </article>
          )
        })}
      </div>

      {onManageModels ? (
        <button className="secondary-button starter-manage" type="button" onClick={onManageModels}>
          Import a local file instead
        </button>
      ) : null}
    </section>
  )
}

function LargeChart({ label, series, value, note }: { label: string; series: number[]; value: string; note?: ReactNode }) {
  return (
    <div className="large-chart">
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      <Sparkline series={series} height={92} />
      {note ? <div className="chart-note">{note}</div> : null}
    </div>
  )
}

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
  const gpuDisplay = snapshot.gpu.load != null ? `${formatNumber(snapshot.gpu.load)}%` : 'n/a'

  const rows = [
    { label: 'CPU', value: `${formatNumber(snapshot.cpu.load)}%`, detail: `${snapshot.cpu.cores} cores`, real: snapshot.cpu.real },
    { label: 'RAM', value: `${formatNumber(snapshot.ram.usedGb, 1)} GB`, detail: `${formatNumber(snapshot.ram.totalGb, 0)} GB total`, real: snapshot.ram.real },
    {
      label: 'VRAM',
      value: snapshot.vram.totalGb ? `${formatNumber(snapshot.vram.usedGb ?? 0, 1)} GB` : 'n/a',
      detail: snapshot.vram.totalGb ? `${formatNumber(snapshot.vram.totalGb, 0)} GB total` : 'unavailable',
      real: snapshot.vram.real,
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
            <Microchip size={15} />
            <span>{device?.gpuNames?.[0] ?? snapshot.gpu.name ?? 'GPU'}</span>
            <Badge tone="neutral">{typeof device?.gpuType === 'string' ? device.gpuType : 'cpu'}</Badge>
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
        <span className="muted">CPU, RAM and VRAM are live · power and thermal headroom are estimated without elevated access</span>
      </div>

      <div className="metric-stack wide">
        <MetricTile
          display={`${formatNumber(snapshot.cpu.load)}%`}
          icon={Cpu}
          label="CPU"
          series={series.cpu}
          sub={<Badge tone="real">live</Badge>}
          tone="teal"
          value={snapshot.cpu.load}
        />
        <MetricTile
          display={`${formatNumber(snapshot.ram.usedGb, 1)} GB`}
          icon={HardDrive}
          label="RAM"
          series={series.ram}
          sub={<Badge tone="real">live</Badge>}
          tone="blue"
          value={ramPct}
        />
        <MetricTile
          display={gpuDisplay}
          icon={Microchip}
          label="GPU"
          series={series.gpu}
          sub={<Badge tone={snapshot.gpu.real ? 'real' : 'estimated'}>{snapshot.gpu.real ? 'live' : 'n/a on this OS'}</Badge>}
          tone="teal"
          value={snapshot.gpu.load ?? 0}
        />
        <MetricTile
          display={snapshot.vram.totalGb ? `${formatNumber(snapshot.vram.usedGb ?? 0, 1)} GB` : 'n/a'}
          icon={Database}
          label="VRAM"
          series={series.vram}
          sub={<Badge tone={snapshot.vram.real ? 'real' : 'estimated'}>{snapshot.vram.real ? 'live' : 'n/a'}</Badge>}
          tone="blue"
          value={vramPct}
        />
        <MetricTile
          display={`${formatNumber(snapshot.power.watts, 1)} W`}
          icon={Zap}
          label="Power draw"
          series={series.power}
          sub={<Badge tone="estimated">estimated</Badge>}
          tone="amber"
          value={clamp((snapshot.power.watts / 120) * 100, 0, 100)}
        />
        <MetricTile
          display={`${formatNumber(snapshot.thermal.headroomPct)}%`}
          icon={Thermometer}
          label="Thermal headroom"
          series={series.thermal}
          sub={<Badge tone={snapshot.thermal.real ? 'real' : 'estimated'}>{snapshot.thermal.real ? 'sensor' : 'estimated'}</Badge>}
          tone="green"
          value={snapshot.thermal.headroomPct}
        />
      </div>

      <div className="chart-board">
        <LargeChart label="CPU load" series={series.cpu} value={`${formatNumber(snapshot.cpu.load)}%`} />
        <LargeChart label="RAM" series={series.ram} value={`${formatNumber(snapshot.ram.usedGb, 1)} GB`} />
        <LargeChart label="Power (est.)" series={series.power} value={`${formatNumber(snapshot.power.watts, 1)} W`} />
        <LargeChart
          label="Thermal headroom"
          series={series.thermal}
          value={snapshot.thermal.celsius != null ? `${formatNumber(snapshot.thermal.celsius)}°C` : `${formatNumber(snapshot.thermal.headroomPct)}%`}
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

export function ModelsView({
  device,
  download,
  models,
  onAddFolder,
  onDelete,
  onDownload,
  onImportFile,
  onRefresh,
  onRemove,
  onReveal,
  onSelect,
  selectedPath,
}: {
  device: DeviceInfo | null
  download: DownloadState
  models: ModelInfo[]
  onAddFolder: () => void
  onDelete: (model: ModelInfo) => void
  onDownload: (uri: string) => void
  onImportFile: () => void
  onRefresh: () => void
  onRemove: (model: ModelInfo) => void
  onReveal: (model: ModelInfo) => void
  onSelect: (model: ModelInfo) => void
  selectedPath: string | null
}) {
  const [uri, setUri] = useState('')
  const downloadPct = download && download.totalSize ? (download.downloadedSize / download.totalSize) * 100 : 0

  return (
    <div className="models-view">
      <PanelHeader
        eyebrow="Models"
        title="Local models"
        action={
          <button className="secondary-button compact" type="button" onClick={onRefresh}>
            <RefreshCw size={14} />
            Refresh
          </button>
        }
      />

      <StarterModelCatalog download={download} onDownload={onDownload} />

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
            Import a <code>.gguf</code> file you've downloaded, add a folder of models, or paste a Hugging Face URI above
            to download one. Models run fully on-device — nothing leaves your machine.
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
            max={32768}
            step={512}
            unit="tok"
            onChange={(value) => onChange({ contextTokens: value })}
          />
          <p className="policy-note subtle">Temperature, token cap, and context window are applied to local inference.</p>
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
        <span>All inference runs locally on this device. Prompts and responses never leave your machine.</span>
      </div>
    </div>
  )
}
