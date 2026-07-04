// Hardware detection for the scan-and-reveal onboarding step and the 16GB
// floor gate. macOS / Apple Silicon focused: memory is unified, so the GPU
// budget is the Metal working-set limit rather than discrete VRAM.

import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import si from 'systeminformation'

const execFileAsync = promisify(execFile)

export const RAM_FLOOR_BYTES = 15.5 * 1024 ** 3 // "16GB" machines report 16 GiB exactly

export type HardwareProfile = {
  platform: NodeJS.Platform
  isAppleSilicon: boolean
  chip: string | null
  machineModel: string | null
  cpuCores: number
  totalRamBytes: number
  /** Usable accelerator memory budget; on Apple Silicon the Metal working-set limit. */
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

/**
 * @param measuredGpuBudgetBytes The Metal working-set total reported by the
 * inference runtime (llama.getVramState().total). Preferred over the fallback
 * heuristic because it comes from the exact backend that will run inference.
 */
export async function getHardwareProfile(measuredGpuBudgetBytes?: number | null): Promise<HardwareProfile> {
  if (cachedProfile && !measuredGpuBudgetBytes) return cachedProfile

  const totalRamBytes = os.totalmem()
  const isAppleSilicon = process.platform === 'darwin' && process.arch === 'arm64'

  const [chip, machineModel, disks] = await Promise.all([
    process.platform === 'darwin' ? sysctl('machdep.cpu.brand_string') : Promise.resolve(os.cpus()[0]?.model ?? null),
    process.platform === 'darwin' ? sysctl('hw.model') : si.system().then((s) => s.model || null).catch(() => null),
    si.fsSize().catch(() => []),
  ])

  const rootDisk = disks.find((d) => d.mount === '/') ?? disks[0]
  const freeDiskBytes = rootDisk && typeof rootDisk.available === 'number' ? rootDisk.available : null

  // Metal typically allows the GPU ~65-75% of unified memory. The measured
  // value from the runtime wins whenever it is available.
  const fallbackBudget = Math.round(totalRamBytes * (isAppleSilicon ? 0.7 : 0.6))
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

/**
 * Sudo-free memory pressure on macOS via kern.memorystatus_vm_pressure_level
 * (1 = normal, 2 = warn, 4 = critical). Returns null where unsupported.
 */
export async function getMemoryPressureLevel(): Promise<MemoryPressureLevel | null> {
  if (process.platform !== 'darwin') return null
  const raw = await sysctl('kern.memorystatus_vm_pressure_level')
  if (raw === '1') return 'normal'
  if (raw === '2') return 'warn'
  if (raw === '4') return 'critical'
  return null
}
