export function generationTokensPerSecond({
  outputTokens,
  startedAt,
  firstTokenAt,
  finishedAt,
}: {
  outputTokens: number
  startedAt: number
  firstTokenAt: number | null
  finishedAt: number
}): number {
  if (!Number.isFinite(outputTokens) || outputTokens <= 0) return 0

  // Prompt evaluation happens before the first generated token and should not
  // be reported as model write speed. Once the first token arrives, measure
  // the intervals for the remaining tokens. This also avoids false "slow"
  // warnings for short answers where fixed startup latency dominates.
  if (firstTokenAt !== null) {
    const measuredTokens = Math.max(0, outputTokens - 1)
    const generationMs = Math.max(0, finishedAt - firstTokenAt)
    return measuredTokens > 0 && generationMs > 0 ? (measuredTokens / generationMs) * 1000 : 0
  }

  const elapsedMs = Math.max(0, finishedAt - startedAt)
  return elapsedMs > 0 ? (outputTokens / elapsedMs) * 1000 : 0
}
