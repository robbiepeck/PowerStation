import os from 'node:os'
import si from 'systeminformation'
import { getDeviceInfo, getLastTokensPerSec, getLoadedPath } from './llm.js'

export type TelemetrySnapshot = {
  timestamp: number
  cpu: { load: number; cores: number; real: boolean }
  ram: { usedGb: number; totalGb: number; real: boolean }
  gpu: { load: number | null; name: string | null; type: string | null; real: boolean }
  vram: { usedGb: number | null; totalGb: number | null; real: boolean }
  power: { watts: number; estimated: boolean }
  thermal: { celsius: number | null; headroomPct: number; real: boolean }
  tokensPerSec: number
  model: { loaded: boolean; path: string | null }
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const round = (value: number, decimals = 0) => {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

let timer: ReturnType<typeof setInterval> | null = null
let staticInfo: { gpuName: string | null; gpuType: string | null; tdpWatts: number } | null = null

async function loadStaticInfo(): Promise<NonNullable<typeof staticInfo>> {
  if (staticInfo) return staticInfo
  const device = await getDeviceInfo().catch(() => null)
  // Rough package power ceiling used only to scale the (estimated) power readout.
  const cores = os.cpus().length
  const tdpWatts = clamp(18 + cores * 3.5, 25, 130)
  staticInfo = {
    gpuName: device?.gpuNames?.[0] ?? null,
    gpuType: typeof device?.gpuType === 'string' ? device.gpuType : device?.gpuType === false ? 'cpu' : null,
    tdpWatts,
  }
  return staticInfo
}

async function sample(): Promise<TelemetrySnapshot> {
  const info = await loadStaticInfo()
  const [load, mem, temp, device] = await Promise.all([
    si.currentLoad().catch(() => null),
    si.mem().catch(() => null),
    si.cpuTemperature().catch(() => null),
    getDeviceInfo().catch(() => null),
  ])

  const cpuLoad = clamp(load?.currentLoad ?? 0, 0, 100)
  const totalRam = mem?.total ?? os.totalmem()
  const usedRam = mem ? mem.total - mem.available : os.totalmem() - os.freemem()

  let vramUsedGb: number | null = null
  let vramTotalGb: number | null = null
  let vramReal = false
  if (device?.vram && device.vram.total > 0) {
    vramTotalGb = device.vram.total / 1e9
    vramUsedGb = device.vram.used / 1e9
    vramReal = true
  }

  // GPU utilisation is generally unavailable without elevated access (especially on Apple Silicon).
  const gpuLoad: number | null = null

  const tempC = temp && typeof temp.main === 'number' && temp.main > 0 ? temp.main : null

  // Power draw cannot be read cross-platform without privileges; derive a labelled estimate from load.
  const powerWatts = round(
    7 + (cpuLoad / 100) * info.tdpWatts * 0.62 + (gpuLoad != null ? (gpuLoad / 100) * info.tdpWatts * 0.38 : (cpuLoad / 100) * info.tdpWatts * 0.18),
    1,
  )

  const headroomPct =
    tempC != null ? clamp(100 - ((tempC - 35) / (95 - 35)) * 100, 0, 100) : clamp(100 - powerWatts * 0.6, 8, 96)

  return {
    timestamp: Date.now(),
    cpu: { load: round(cpuLoad, 1), cores: os.cpus().length, real: true },
    ram: { usedGb: round(usedRam / 1e9, 2), totalGb: round(totalRam / 1e9, 1), real: true },
    gpu: { load: gpuLoad, name: info.gpuName, type: info.gpuType, real: gpuLoad != null },
    vram: { usedGb: vramUsedGb != null ? round(vramUsedGb, 2) : null, totalGb: vramTotalGb != null ? round(vramTotalGb, 1) : null, real: vramReal },
    power: { watts: powerWatts, estimated: true },
    thermal: { celsius: tempC != null ? round(tempC, 1) : null, headroomPct: round(headroomPct), real: tempC != null },
    tokensPerSec: round(getLastTokensPerSec(), 1),
    model: { loaded: Boolean(getLoadedPath()), path: getLoadedPath() },
  }
}

export function startTelemetry(send: (snapshot: TelemetrySnapshot) => void, intervalMs = 1200): void {
  if (timer) return
  const tick = async () => {
    try {
      send(await sample())
    } catch {
      /* ignore transient sampling errors */
    }
  }
  void tick()
  timer = setInterval(() => void tick(), intervalMs)
}

export function stopTelemetry(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
