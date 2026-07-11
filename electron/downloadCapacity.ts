const DEFAULT_RESERVE_BYTES = 1024 ** 3

export function requiredModelDownloadSpace(
  expectedBytes: number,
  existingBytes: number,
  reserveBytes = DEFAULT_RESERVE_BYTES,
): number {
  const expected = Number.isFinite(expectedBytes) ? Math.max(0, expectedBytes) : 0
  const existing = Number.isFinite(existingBytes) ? Math.max(0, existingBytes) : 0
  const reserve = Number.isFinite(reserveBytes) ? Math.max(0, reserveBytes) : DEFAULT_RESERVE_BYTES
  return Math.max(0, expected - existing) + reserve
}
