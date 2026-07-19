import { useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { Check, Copy, Info, ListTree } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export function formatNumber(value: number, decimals = 0) {
  return value.toLocaleString(undefined, {
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals,
  })
}

export function formatBytes(bytes: number) {
  if (!bytes || bytes < 0) return '—'
  const gb = bytes / 1e9
  if (gb >= 1) return `${formatNumber(gb, gb >= 10 ? 1 : 2)} GB`
  return `${formatNumber(bytes / 1e6, 0)} MB`
}

export function PanelHeader({ action, eyebrow, title }: { action?: ReactNode; eyebrow: string; title: string }) {
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

export function MiniReadout({ label, value }: { label: string; value: string }) {
  return (
    <div className="mini-readout">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode
  tone?: 'real' | 'estimated' | 'neutral' | 'danger'
}) {
  return <span className={`badge ${tone}`}>{children}</span>
}

export type MetricInfo = {
  title: string
  body: string
}

export function MetricInfoButton({ info }: { info: MetricInfo }) {
  const [open, setOpen] = useState(false)

  return (
    <span className={`metric-info ${open ? 'open' : ''}`}>
      <button
        type="button"
        aria-label={`What ${info.title} means`}
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation()
          setOpen((current) => !current)
        }}
        onBlur={() => setOpen(false)}
      >
        <Info size={12} />
      </button>
      <span className="metric-info-popover" role="dialog" aria-label={`${info.title} explanation`}>
        <strong>{info.title}</strong>
        <span>{info.body}</span>
      </span>
    </span>
  )
}

export function LoadMeter({ label, value }: { label: string; value: number }) {
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

export function RangeControl({
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

export function ToggleControl({
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

export function Sparkline({ height = 42, series }: { height?: number; series: number[] }) {
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

export function MetricTile({
  display,
  icon: Icon,
  info,
  label,
  onClick,
  onInspect,
  series,
  sub,
  tone,
  value,
}: {
  display: string
  icon: LucideIcon
  info?: MetricInfo
  label: string
  onClick?: () => void
  onInspect?: () => void
  series: number[]
  sub?: ReactNode
  tone: 'amber' | 'blue' | 'green' | 'teal'
  value: number
}) {
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!onClick) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onClick()
    }
  }

  return (
    <div
      className={`metric-tile ${tone} ${onClick ? 'clickable' : ''}`}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={handleKeyDown}
    >
      <div className="metric-topline">
        <span className="metric-label">
          <Icon size={15} />
          {label}
          {info ? <MetricInfoButton info={info} /> : null}
          {onInspect ? (
            <button
              className="metric-process-button"
              type="button"
              aria-label={`Show applications and processes using ${label}`}
              title={`Show applications and processes using ${label}`}
              onClick={(event) => {
                event.stopPropagation()
                onInspect()
              }}
            >
              <ListTree size={12} />
            </button>
          ) : null}
        </span>
        <strong>{display}</strong>
      </div>
      <Sparkline series={series} />
      <div className="metric-bar">
        <span style={{ width: `${clamp(value, 0, 100)}%` }} />
      </div>
      {sub ? <div className="metric-sub">{sub}</div> : null}
    </div>
  )
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      className="copy-button"
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(text)
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1400)
      }}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
      {copied ? 'Copied' : label}
    </button>
  )
}
