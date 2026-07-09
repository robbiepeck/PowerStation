// Hardware detection for the scan-and-reveal onboarding step and the 16GB
// floor gate. On Apple Silicon memory is unified, so the GPU budget is the
// Metal working-set limit; on Windows/Linux the budget is discrete VRAM when a GPU
// is present (measured from the inference backend), with system RAM as the
// CPU-inference fallback.

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
  /** Usable accelerator budget: Metal working-set limit (macOS) or VRAM (Windows/Linux dGPU). */
  gpuBudgetBytes: number
  gpuBudgetIsMeasured: boolean
  gpuBudgetSource: 'backend' | 'detected-vram' | 'estimated'
  gpuDevices: GpuDeviceInfo[]
  freeDiskBytes: number | null
  meetsFloor: boolean
}

export type GpuDeviceInfo = {
  name: string
  vendor: string | null
  bus: string | null
  vramBytes: number | null
  vramIsDynamic: boolean
  dedicated: boolean
  driverVersion: string | null
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

function graphicsMbToBytes(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  return Math.round(value * 1024 ** 2)
}

function normalizeVendor(value: string | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  if (/advanced micro devices|ati/i.test(trimmed)) return 'AMD'
  if (/nvidia/i.test(trimmed)) return 'NVIDIA'
  if (/intel/i.test(trimmed)) return 'Intel'
  if (/apple/i.test(trimmed)) return 'Apple'
  if (/microsoft/i.test(trimmed)) return 'Microsoft'
  return trimmed
}

function isLikelyDiscreteGpu(device: { vendor: string | null; name: string; vramBytes: number | null; vramIsDynamic: boolean }): boolean {
  if (device.vramIsDynamic || !device.vramBytes) return false
  if (device.vendor === 'NVIDIA') return true
  if (device.vendor === 'AMD' && device.vramBytes >= 2 * 1024 ** 3) return true
  if (device.vendor === 'Intel' || device.vendor === 'Microsoft') return false
  if (/basic render|software|virtual|remote display|parallels/i.test(device.name)) return false
  return device.vramBytes >= 2 * 1024 ** 3
}

function rankGpu(device: GpuDeviceInfo): number {
  const vendorScore = device.vendor === 'NVIDIA' || device.vendor === 'AMD' ? 3 : device.vendor === 'Intel' ? 1 : 2
  const dedicatedScore = device.dedicated ? 10 : 0
  return dedicatedScore + vendorScore + (device.vramBytes ?? 0) / 1024 ** 4
}

function normalizeGpuDevices(controllers: Awaited<ReturnType<typeof si.graphics>>['controllers']): GpuDeviceInfo[] {
  return controllers
    .map((controller) => {
      const name = (controller.name || controller.model || 'Unknown GPU').trim()
      const vendor = normalizeVendor(controller.vendor || controller.subVendor)
      const vramBytes = graphicsMbToBytes(controller.memoryTotal ?? controller.vram)
      const vramIsDynamic = Boolean(controller.vramDynamic)
      const device = {
        name,
        vendor,
        bus: controller.bus || controller.busAddress || null,
        vramBytes,
        vramIsDynamic,
        dedicated: false,
        driverVersion: controller.driverVersion || null,
      }
      return { ...device, dedicated: isLikelyDiscreteGpu(device) }
    })
    .sort((a, b) => rankGpu(b) - rankGpu(a))
}

export async function getGpuDevices(): Promise<GpuDeviceInfo[]> {
  const graphics = await si.graphics().catch(() => null)
  return normalizeGpuDevices(graphics?.controllers ?? [])
}

/**
 * @param measuredGpuBudgetBytes The accelerator memory total reported by the
 * inference runtime (llama.getVramState().total) — the Metal working-set limit
 * on Apple Silicon, or discrete VRAM under CUDA/Vulkan on Windows/Linux. Preferred
 * over the fallback heuristic because it comes from the exact backend that
 * will run inference.
 */
export async function getHardwareProfile(measuredGpuBudgetBytes?: number | null): Promise<HardwareProfile> {
  if (cachedProfile && !measuredGpuBudgetBytes) return cachedProfile

  const totalRamBytes = os.totalmem()
  const isAppleSilicon = process.platform === 'darwin' && process.arch === 'arm64'

  const [chip, machineModel, disks, gpuDevices] = await Promise.all([
    process.platform === 'darwin' ? sysctl('machdep.cpu.brand_string') : Promise.resolve(os.cpus()[0]?.model?.trim() ?? null),
    process.platform === 'darwin'
      ? sysctl('hw.model')
      : si
          .system()
          .then((s) => [s.manufacturer, s.model].filter(Boolean).join(' ') || null)
          .catch(() => null),
    si.fsSize().catch(() => []),
    getGpuDevices(),
  ])

  const rootDisk =
    process.platform === 'win32'
      ? disks.find((d) => d.mount?.toUpperCase().startsWith('C')) ?? disks[0]
      : disks.find((d) => d.mount === '/') ?? disks[0]
  const freeDiskBytes = rootDisk && typeof rootDisk.available === 'number' ? rootDisk.available : null

  // Fallbacks when the runtime hasn't reported a measured budget yet:
  // Apple Silicon — Metal typically allows the GPU ~65-75% of unified memory.
  // Windows/Linux — use OS-reported dGPU VRAM before falling back to CPU/shared-memory inference.
  const fallbackBudget = Math.round(totalRamBytes * (isAppleSilicon ? 0.7 : 0.5))
  const gpuBudgetIsMeasured = typeof measuredGpuBudgetBytes === 'number' && measuredGpuBudgetBytes > 0
  const detectedGpuBudgetBytes = process.platform === 'darwin' ? null : (gpuDevices.find((gpu) => gpu.vramBytes)?.vramBytes ?? null)
  const gpuBudgetSource = gpuBudgetIsMeasured ? 'backend' : detectedGpuBudgetBytes ? 'detected-vram' : 'estimated'

  const profile: HardwareProfile = {
    platform: process.platform,
    isAppleSilicon,
    chip,
    machineModel,
    cpuCores: os.cpus().length,
    totalRamBytes,
    gpuBudgetBytes: gpuBudgetIsMeasured ? measuredGpuBudgetBytes! : (detectedGpuBudgetBytes ?? fallbackBudget),
    gpuBudgetIsMeasured,
    gpuBudgetSource,
    gpuDevices,
    freeDiskBytes,
    meetsFloor: totalRamBytes >= RAM_FLOOR_BYTES,
  }
  cachedProfile = profile
  return profile
}

/**
 * Privilege-free memory pressure.
 * macOS: the kernel's own signal via kern.memorystatus_vm_pressure_level
 * (1 = normal, 2 = warn, 4 = critical).
 * Windows/Linux: derived from available physical memory (there is no single kernel
 * pressure number without a driver) — labelled as derived in the UI.
 * Returns null where unsupported.
 */
export async function getMemoryPressureLevel(): Promise<MemoryPressureLevel | null> {
  if (process.platform === 'darwin') {
    const raw = await sysctl('kern.memorystatus_vm_pressure_level')
    if (raw === '1') return 'normal'
    if (raw === '2') return 'warn'
    if (raw === '4') return 'critical'
    return null
  }
  if (process.platform === 'win32' || process.platform === 'linux') {
    const mem = await si.mem().catch(() => null)
    if (!mem || !mem.total || typeof mem.available !== 'number') return null
    const availableFraction = mem.available / mem.total
    if (availableFraction < 0.07) return 'critical'
    if (availableFraction < 0.15) return 'warn'
    return 'normal'
  }
  return null
}
