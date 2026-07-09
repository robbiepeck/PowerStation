import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import si from 'systeminformation'

const execFileAsync = promisify(execFile)

export const RAM_FLOOR_BYTES = 15.5 * 1024 ** 3

export type HardwareProfile = {
  platform: NodeJS.Platform
  isAppleSilicon: boolean
  chip: string | null
  machineModel: string | null
  cpuCores: number
  totalRamBytes: number

  gpuBudgetBytes: number
  gpuBudgetIsMeasured: boolean
  freeDiskBytes: number | null
  meetsFloor: boolean
}

export type MemoryPressureLevel = 'normal' | 'warn' | 'critical'

async function sysctl(name: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('/usr/sbin/sysctl', ['-n', name], { timeout: 3000 })
    return stdout.trim() || null
  } catch {
    return null
  }
}

let cachedProfile: HardwareProfile | null = null

export async function getHardwareProfile(measuredGpuBudgetBytes?: number | null): Promise<HardwareProfile> {
  if (cachedProfile && !measuredGpuBudgetBytes) return cachedProfile

  const totalRamBytes = os.totalmem()
  const isAppleSilicon = process.platform === 'darwin' && process.arch === 'arm64'

  const [chip, machineModel, disks] = await Promise.all([
    process.platform === 'darwin' ? sysctl('machdep.cpu.brand_string') : Promise.resolve(os.cpus()[0]?.model?.trim() ?? null),
    process.platform === 'darwin'
      ? sysctl('hw.model')
      : si
          .system()
          .then((s) => [s.manufacturer, s.model].filter(Boolean).join(' ') || null)
          .catch(() => null),
    si.fsSize().catch(() => []),
  ])

  const rootDisk =
    process.platform === 'win32'
      ? disks.find((d) => d.mount?.toUpperCase().startsWith('C')) ?? disks[0]
      : disks.find((d) => d.mount === '/') ?? disks[0]
  const freeDiskBytes = rootDisk && typeof rootDisk.available === 'number' ? rootDisk.available : null

  const fallbackBudget = Math.round(totalRamBytes * (isAppleSilicon ? 0.7 : 0.5))
  const gpuBudgetIsMeasured = typeof measuredGpuBudgetBytes === 'number' && measuredGpuBudgetBytes > 0

  const profile: HardwareProfile = {
    platform: process.platform,
    isAppleSilicon,
    chip,
    machineModel,
    cpuCores: os.cpus().length,
    totalRamBytes,
    gpuBudgetBytes: gpuBudgetIsMeasured ? measuredGpuBudgetBytes! : fallbackBudget,
    gpuBudgetIsMeasured,
    freeDiskBytes,
    meetsFloor: totalRamBytes >= RAM_FLOOR_BYTES,
  }
  cachedProfile = profile
  return profile
}

export async function getMemoryPressureLevel(): Promise<MemoryPressureLevel | null> {
  if (process.platform === 'darwin') {
    const raw = await sysctl('kern.memorystatus_vm_pressure_level')
    if (raw === '1') return 'normal'
    if (raw === '2') return 'warn'
    if (raw === '4') return 'critical'
    return null
  }
  if (process.platform === 'win32') {
    const mem = await si.mem().catch(() => null)
    if (!mem || !mem.total || typeof mem.available !== 'number') return null
    const availableFraction = mem.available / mem.total
    if (availableFraction < 0.07) return 'critical'
    if (availableFraction < 0.15) return 'warn'
    return 'normal'
  }
  return null
}
