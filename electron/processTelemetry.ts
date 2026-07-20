import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import si from 'systeminformation'

export const PROCESS_METRICS = ['cpu', 'ram', 'storage', 'gpu', 'vram'] as const
export type ProcessMetricKey = (typeof PROCESS_METRICS)[number]

export type ProcessUsageProcess = {
  pid: number
  name: string
  value: number
}

export type ProcessUsageGroup = {
  id: string
  name: string
  value: number
  sharePct: number | null
  isPowerStation: boolean
  processes: ProcessUsageProcess[]
}

export type ProcessUsageSnapshot = {
  metric: ProcessMetricKey
  timestamp: number
  supported: boolean
  quality: 'measured' | 'best-effort' | 'unavailable'
  sourceLabel: string
  message?: string
  groups: ProcessUsageGroup[]
}

export type BaseProcess = {
  pid: number
  parentPid: number
  name: string
  cpu: number
  memRss: number
  command: string
  path: string
}

type Attribution = {
  supported: boolean
  quality: ProcessUsageSnapshot['quality']
  sourceLabel: string
  message?: string
  values: Map<number, number>
  totalValue?: number
}

type WindowsCounterSample = {
  Path?: string
  InstanceName?: string
  CookedValue?: number
}

let previousLinuxIo: { timestamp: number; values: Map<number, number> } | null = null
const PROCESS_TABLE_TIMEOUT_MS = 20_000

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export function isProcessMetric(value: unknown): value is ProcessMetricKey {
  return typeof value === 'string' && PROCESS_METRICS.includes(value as ProcessMetricKey)
}

export function powerStationProcessIds(processes: BaseProcess[], rootPid: number): Set<number> {
  const ids = new Set<number>([rootPid])
  let changed = true
  while (changed) {
    changed = false
    for (const processInfo of processes) {
      if (!ids.has(processInfo.pid) && ids.has(processInfo.parentPid)) {
        ids.add(processInfo.pid)
        changed = true
      }
    }
  }
  return ids
}

export function applicationName(processInfo: Pick<BaseProcess, 'name' | 'command' | 'path'>): string {
  const location = `${processInfo.path || ''} ${processInfo.command || ''}`
  const macBundle = location.match(/\/([^/]+)\.app\/Contents\//i)
  if (macBundle?.[1]) return macBundle[1]

  const executable = processInfo.name || (processInfo.path ? path.basename(processInfo.path) : '')
  const cleaned = executable.replace(/\.exe$/i, '').trim()
  return cleaned || 'Unknown process'
}

export function buildProcessGroups(
  processes: BaseProcess[],
  values: Map<number, number>,
  totalValue: number,
  rootPid: number,
): ProcessUsageGroup[] {
  const powerStationIds = powerStationProcessIds(processes, rootPid)
  const groups = new Map<string, ProcessUsageGroup>()

  for (const processInfo of processes) {
    const value = Math.max(0, values.get(processInfo.pid) ?? 0)
    if (!Number.isFinite(value) || value <= 0) continue

    const isPowerStation = powerStationIds.has(processInfo.pid)
    if (isPowerStation && processInfo.name.toLocaleLowerCase() === 'ps') continue
    const name = isPowerStation ? 'PowerStation' : applicationName(processInfo)
    const id = isPowerStation ? 'powerstation' : name.toLocaleLowerCase()
    const existing = groups.get(id) ?? {
      id,
      name,
      value: 0,
      sharePct: null,
      isPowerStation,
      processes: [],
    }
    existing.value += value
    existing.processes.push({ pid: processInfo.pid, name: processInfo.name || name, value })
    groups.set(id, existing)
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      sharePct: totalValue > 0 ? clamp((group.value / totalValue) * 100, 0, 100) : null,
      processes: group.processes.sort((left, right) => right.value - left.value).slice(0, 24),
    }))
    .sort((left, right) => right.value - left.value)
    .slice(0, 8)
}

function runPowerShellCounter(patterns: string[]): Promise<WindowsCounterSample[]> {
  const quotedPatterns = patterns.map((pattern) => `'${pattern}'`).join(',')
  const script = [
    `$samples = (Get-Counter @(${quotedPatterns}) -ErrorAction Stop).CounterSamples`,
    `$samples | Select-Object Path,InstanceName,CookedValue | ConvertTo-Json -Compress`,
  ].join('; ')

  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { timeout: 10_000, maxBuffer: 2 * 1024 * 1024, windowsHide: true },
      (error, stdout) => {
        if (error) {
          reject(error)
          return
        }
        try {
          const parsed = JSON.parse(stdout.trim() || '[]') as WindowsCounterSample | WindowsCounterSample[]
          resolve(Array.isArray(parsed) ? parsed : [parsed])
        } catch (parseError) {
          reject(parseError)
        }
      },
    )
  })
}

async function windowsStorageAttribution(): Promise<Attribution> {
  try {
    const samples = await runPowerShellCounter(['\\Process(*)\\ID Process', '\\Process(*)\\IO Data Bytes/sec'])
    const pidsByInstance = new Map<string, number>()
    for (const sample of samples) {
      if (!sample.Path?.toLowerCase().endsWith('\\id process')) continue
      const pid = Math.round(Number(sample.CookedValue))
      if (pid > 0 && sample.InstanceName) pidsByInstance.set(sample.InstanceName, pid)
    }

    const values = new Map<number, number>()
    for (const sample of samples) {
      if (!sample.Path?.toLowerCase().endsWith('\\io data bytes/sec') || !sample.InstanceName) continue
      const pid = pidsByInstance.get(sample.InstanceName)
      const value = Number(sample.CookedValue)
      if (pid && Number.isFinite(value) && value > 0) values.set(pid, value)
    }
    return {
      supported: true,
      quality: 'measured',
      sourceLabel: 'Windows performance counters',
      values,
      totalValue: [...values.values()].reduce((sum, value) => sum + value, 0),
    }
  } catch {
    return unavailable('Windows did not expose per-process disk I/O counters on this device.')
  }
}

async function windowsGpuAttribution(metric: 'gpu' | 'vram'): Promise<Attribution> {
  const counter = metric === 'gpu' ? '\\GPU Engine(*)\\Utilization Percentage' : '\\GPU Process Memory(*)\\Dedicated Usage'
  try {
    const samples = await runPowerShellCounter([counter])
    const values = new Map<number, number>()
    for (const sample of samples) {
      const pidMatch = sample.InstanceName?.match(/pid_(\d+)/i)
      const pid = pidMatch ? Number(pidMatch[1]) : 0
      const value = Number(sample.CookedValue)
      if (pid > 0 && Number.isFinite(value) && value > 0) {
        values.set(pid, (values.get(pid) ?? 0) + value)
      }
    }
    if (metric === 'gpu') {
      for (const [pid, value] of values) values.set(pid, clamp(value, 0, 100))
    }
    return {
      supported: true,
      quality: 'best-effort',
      sourceLabel: 'Windows GPU performance counters',
      values,
      totalValue: metric === 'gpu' ? 100 : [...values.values()].reduce((sum, value) => sum + value, 0),
      message: values.size ? undefined : 'No per-process GPU activity was reported in this sample.',
    }
  } catch {
    return unavailable('The graphics driver did not expose per-process GPU counters to Windows.')
  }
}

async function readLinuxIo(pid: number): Promise<number | null> {
  const contents = await fs.readFile(`/proc/${pid}/io`, 'utf8').catch(() => null)
  if (!contents) return null
  let total = 0
  for (const line of contents.split('\n')) {
    if (!line.startsWith('read_bytes:') && !line.startsWith('write_bytes:')) continue
    const value = Number(line.split(':')[1]?.trim())
    if (Number.isFinite(value) && value > 0) total += value
  }
  return total
}

async function linuxStorageAttribution(processes: BaseProcess[]): Promise<Attribution> {
  const timestamp = Date.now()
  const readings = await Promise.all(processes.map(async (processInfo) => [processInfo.pid, await readLinuxIo(processInfo.pid)] as const))
  const current = new Map<number, number>()
  for (const [pid, value] of readings) if (value != null) current.set(pid, value)

  const previous = previousLinuxIo
  previousLinuxIo = { timestamp, values: current }
  if (!previous || timestamp - previous.timestamp > 30_000) {
    return {
      supported: true,
      quality: 'measured',
      sourceLabel: 'Linux /proc I/O counters',
      message: 'Collecting a second sample to calculate disk activity…',
      values: new Map(),
      totalValue: 0,
    }
  }

  const seconds = Math.max((timestamp - previous.timestamp) / 1000, 0.1)
  const values = new Map<number, number>()
  for (const [pid, value] of current) {
    const before = previous.values.get(pid)
    if (before == null || value <= before) continue
    values.set(pid, (value - before) / seconds)
  }
  return {
    supported: true,
    quality: 'measured',
    sourceLabel: 'Linux /proc I/O counters',
    values,
    totalValue: [...values.values()].reduce((sum, value) => sum + value, 0),
  }
}

function unavailable(message: string): Attribution {
  return {
    supported: false,
    quality: 'unavailable',
    sourceLabel: 'Not exposed by this operating system',
    message,
    values: new Map(),
  }
}

async function metricAttribution(metric: ProcessMetricKey, processes: BaseProcess[]): Promise<Attribution> {
  if (metric === 'cpu') {
    const platformCpuScale = process.platform === 'darwin' ? Math.max(os.cpus().length, 1) : 1
    return {
      supported: true,
      quality: 'measured',
      sourceLabel: 'Operating-system process table',
      values: new Map(processes.map((processInfo) => [processInfo.pid, Math.max(0, processInfo.cpu / platformCpuScale)])),
      totalValue: 100,
    }
  }
  if (metric === 'ram') {
    return {
      supported: true,
      quality: 'measured',
      sourceLabel: 'Operating-system process table',
      values: new Map(processes.map((processInfo) => [processInfo.pid, Math.max(0, processInfo.memRss)])),
      totalValue: os.totalmem(),
    }
  }
  if (metric === 'storage') {
    if (process.platform === 'win32') return windowsStorageAttribution()
    if (process.platform === 'linux') return linuxStorageAttribution(processes)
    return unavailable('macOS requires privileged diagnostics for per-process disk I/O, so PowerStation does not collect it.')
  }
  if (process.platform === 'win32') return windowsGpuAttribution(metric)
  if (process.platform === 'darwin') {
    return unavailable(
      metric === 'gpu'
        ? 'macOS does not expose per-process GPU activity to sandboxed desktop apps.'
        : 'Apple Silicon uses unified memory and macOS does not expose reliable per-process VRAM attribution.',
    )
  }
  return unavailable('Per-process GPU data requires vendor-specific driver tooling and is unavailable on this Linux device.')
}

export async function getProcessUsage(metric: ProcessMetricKey): Promise<ProcessUsageSnapshot> {
  let timeout: ReturnType<typeof setTimeout> | null = null
  let processData: Awaited<ReturnType<typeof si.processes>>
  try {
    processData = await Promise.race([
      si.processes(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('Process table collection timed out.')), PROCESS_TABLE_TIMEOUT_MS)
      }),
    ])
  } catch {
    return {
      metric,
      timestamp: Date.now(),
      supported: false,
      quality: 'unavailable',
      sourceLabel: 'Operating-system process table',
      message: 'The operating system did not return process data in time. Try refreshing the process inspector.',
      groups: [],
    }
  } finally {
    if (timeout) clearTimeout(timeout)
  }
  const processes: BaseProcess[] = processData.list.map((processInfo) => ({
    pid: processInfo.pid,
    parentPid: processInfo.parentPid,
    name: processInfo.name,
    cpu: processInfo.cpu,
    memRss: processInfo.memRss * 1024,
    command: processInfo.command,
    path: processInfo.path,
  }))
  const attribution = await metricAttribution(metric, processes)
  const totalValue = attribution.totalValue ?? [...attribution.values.values()].reduce((sum, value) => sum + value, 0)
  const groups = attribution.supported ? buildProcessGroups(processes, attribution.values, totalValue, process.pid) : []

  return {
    metric,
    timestamp: Date.now(),
    supported: attribution.supported,
    quality: attribution.quality,
    sourceLabel: attribution.sourceLabel,
    message: attribution.message ?? (groups.length ? undefined : 'No measurable activity was reported in this sample.'),
    groups,
  }
}
