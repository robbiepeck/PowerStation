import path from 'node:path'

export const MINIMUM_NODE_MAJOR = 22
export const RECOMMENDED_RAM_BYTES = 16 * 1024 ** 3
export const MINIMUM_INSTALL_DISK_BYTES = 4 * 1024 ** 3

export function parseVersion(value) {
  const match = String(value).trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/)
  return match ? match.slice(1).map(Number) : null
}

export function compareVersions(left, right) {
  const a = parseVersion(left)
  const b = parseVersion(right)
  if (!a || !b) throw new Error(`Cannot compare invalid versions: ${left}, ${right}`)
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index]
  }
  return 0
}

export function isStableReleaseTag(value) {
  return /^v\d+\.\d+\.\d+$/.test(String(value))
}

export function nodeMajor(value = process.version) {
  const match = String(value).match(/^v?(\d+)/)
  return match ? Number(match[1]) : 0
}

export function formatGb(bytes, decimals = 1) {
  return `${(Math.max(0, Number(bytes) || 0) / 1024 ** 3).toFixed(decimals)} GB`
}

export function selectInstallDirectory({ override, home, systemAppExists, systemDirectoryWritable, userAppExists }) {
  if (override) return path.resolve(override)
  if (systemAppExists && systemDirectoryWritable) return '/Applications'
  const userApplications = path.join(home, 'Applications')
  if (userAppExists) return userApplications
  return userApplications
}
