import si from 'systeminformation'

const round = (value: number, decimals = 0) => {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

function inferAppleSiliconIntro(modelText: string): { year: number; yearFraction: number } | null {
  if (/\bM4\b/i.test(modelText)) return { year: 2024, yearFraction: 2024.8 }
  if (/\bM3\b/i.test(modelText)) return { year: 2023, yearFraction: 2023.8 }
  if (/\bM2\b/i.test(modelText)) return { year: 2022, yearFraction: 2022.5 }
  if (/\bM1\b/i.test(modelText)) return { year: 2020, yearFraction: 2020.8 }
  return null
}

export type DeviceHealthProfile = {
  modelName: string | null
  introducedYear: number | null
  ageYears: number | null
  batteryCapacityPct: number | null
  batteryCycleCount: number | null
  performanceCapacityPct: number | null
  estimateNote: string
}

export async function getDeviceHealthProfile(gpuNames: string[]): Promise<DeviceHealthProfile> {
  const [system, battery] = await Promise.all([si.system().catch(() => null), si.battery().catch(() => null)])
  const modelName = gpuNames[0] ?? system?.version ?? system?.model ?? null
  const intro = inferAppleSiliconIntro(`${modelName ?? ''} ${system?.version ?? ''}`)

  const now = new Date()
  const nowYear = now.getFullYear() + now.getMonth() / 12
  const ageYears = intro ? round(Math.max(0, nowYear - intro.yearFraction), 1) : null

  const batteryCapacityPct =
    battery?.hasBattery && battery.designedCapacity > 0 && battery.maxCapacity > 0
      ? round((battery.maxCapacity / battery.designedCapacity) * 100)
      : null

  const ageCapacity = ageYears != null ? clamp(100 - ageYears * 3, 62, 100) : 92
  const performanceCapacityPct = round(clamp((batteryCapacityPct ?? 100) * 0.35 + ageCapacity * 0.65, 60, 100))

  return {
    modelName,
    introducedYear: intro?.year ?? null,
    ageYears,
    batteryCapacityPct,
    batteryCycleCount: battery?.hasBattery ? battery.cycleCount : null,
    performanceCapacityPct,
    estimateNote:
      'Age is estimated from the detected chip generation. Battery capacity uses reported battery health when available. Performance capacity is a rough age and battery based estimate, not a benchmark.',
  }
}
