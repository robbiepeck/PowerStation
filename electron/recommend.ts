import { checkFit, OFFLOAD_RAM_FRACTION, type FitReport } from './admission.js'
import type { CatalogModel, UseCase } from './catalog.js'

export type Intent = {
  useCase: UseCase
  priority: 'speed' | 'balanced' | 'quality'

  maxDownloadGb?: number | null
}

export type Recommendation = {
  model: CatalogModel
  fit: FitReport
  defaultContextTokens: number
  score: number
  reasons: string[]

  versusPrimary?: string[]
}

const GIB = 1024 ** 3

function defaultContextFor(useCase: UseCase): number {
  switch (useCase) {
    case 'documents':
    case 'coding':
      return 32768
    case 'agents':
      return 16384
    default:
      return 8192
  }
}

function effectiveSpeedParams(model: CatalogModel): number {
  return model.activeParamsB ?? model.totalParamsB
}

export function recommendModels(options: {
  catalog: CatalogModel[]
  intent: Intent
  totalRamBytes: number
  gpuBudgetBytes: number
  freeDiskBytes: number | null

  measuredTpsByFile?: Record<string, number>
  limit?: number
}): Recommendation[] {
  const { catalog, intent, totalRamBytes, gpuBudgetBytes, freeDiskBytes, measuredTpsByFile } = options
  const ramGb = totalRamBytes / GIB

  const ranked: Recommendation[] = []
  for (const model of catalog) {
    if (model.minRamGb > ramGb + 0.5) continue
    if (intent.maxDownloadGb && model.sizeBytes > intent.maxDownloadGb * 1e9) continue
    if (freeDiskBytes !== null && model.sizeBytes > freeDiskBytes * 0.8) continue

    if (intent.useCase === 'agents' && model.toolCalling === 'none') continue

    const requestedContext = Math.min(defaultContextFor(intent.useCase), model.maxContext ?? Infinity)
    const fit = checkFit({
      weightsBytes: model.sizeBytes,
      geometry: model.geometry,
      kvBytesPerToken: model.kvBytesPerToken,
      contextTokens: requestedContext,
      budgetBytes: gpuBudgetBytes,
      offloadCeilingBytes: Math.round(totalRamBytes * OFFLOAD_RAM_FRACTION),
    })
    if (fit.verdict === 'wont-fit') continue

    const defaultContextTokens =
      fit.verdict === 'comfortable' || fit.offload
        ? requestedContext
        : Math.max(4096, Math.min(requestedContext, fit.maxComfortableContext ?? 4096))

    let score = 0
    const reasons: string[] = []

    const useCaseIndex = model.useCases.indexOf(intent.useCase)
    if (useCaseIndex >= 0) {
      score += 40 - useCaseIndex * 5
      reasons.push(describeUseCaseFit(intent.useCase, model))
    }

    if (intent.useCase === 'agents' || model.useCases.includes('agents')) {
      if (model.toolCalling === 'multi') score += intent.useCase === 'agents' ? 25 : 8
      else if (model.toolCalling === 'single') score += intent.useCase === 'agents' ? 5 : 2
    }

    const speedParams = effectiveSpeedParams(model)
    if (intent.priority === 'speed') {
      score += Math.max(0, 30 - speedParams * 4)
    } else if (intent.priority === 'quality') {
      score += Math.min(40, model.totalParamsB * 0.5)
    } else {
      score += Math.max(0, 15 - speedParams * 2) + Math.min(20, model.totalParamsB * 0.25)
    }

    if (fit.verdict === 'comfortable') {
      score += 15
      reasons.push(`Fits your machine comfortably — needs ~${(fit.totalBytes / 1e9).toFixed(0)} GB of the ~${(fit.budgetBytes / 1e9).toFixed(0)} GB available to models.`)
    } else if (fit.offload) {

      score -= 25
      reasons.push(fit.summary)
    } else {
      score -= 10
      reasons.push(`Fits, but tightly — PowerStation will cap its context at ${defaultContextTokens.toLocaleString()} tokens to stay safe.`)
    }

    const measuredTps = measuredTpsByFile?.[model.fileName.toLowerCase()]
    if (measuredTps) {
      reasons.push(`Measured on your machine: ${measuredTps} tok/s.`)
    } else if (model.expectedTps) {
      reasons.push(`Expected speed on your machine class: ~${model.expectedTps}.`)
    }
    if (model.activeParamsB) {
      reasons.push(`Efficient design: ${model.totalParamsB}B of knowledge, but only ~${model.activeParamsB}B works per token — so it answers fast.`)
    }
    if (intent.useCase === 'agents' && model.toolCalling === 'multi') {
      reasons.push('Trained for multi-step tool calling — suitable for connectors and MCP tools.')
    }

    ranked.push({ model, fit, defaultContextTokens, score, reasons })
  }

  ranked.sort((a, b) => b.score - a.score)
  const top = ranked.slice(0, options.limit ?? 3)
  for (let i = 1; i < top.length; i++) {
    top[i].versusPrimary = explainVersusPrimary(top[0], top[i], measuredTpsByFile)
  }
  return top
}

export function explainVersusPrimary(
  primary: Recommendation,
  alternate: Recommendation,
  measuredTpsByFile?: Record<string, number>,
): string[] {
  const lines: string[] = []
  const p = primary.model
  const a = alternate.model

  const fitRank = (r: Recommendation) => (r.fit.verdict === 'comfortable' && !r.fit.offload ? 2 : r.fit.offload ? 0 : 1)
  const fitLabel = (r: Recommendation) => (r.fit.offload ? 'needs CPU offload (much slower)' : r.fit.verdict === 'comfortable' ? 'fits comfortably' : 'fits, but tightly')
  if (fitRank(alternate) !== fitRank(primary)) {
    lines.push(
      fitRank(alternate) < fitRank(primary)
        ? `Heavier on this machine: ${fitLabel(alternate)}, where ${p.name} ${fitLabel(primary)}.`
        : `Easier on this machine: ${fitLabel(alternate)}, where ${p.name} ${fitLabel(primary)}.`,
    )
  }

  const measuredA = measuredTpsByFile?.[a.fileName.toLowerCase()]
  const measuredP = measuredTpsByFile?.[p.fileName.toLowerCase()]
  if (measuredA && measuredP && Math.abs(measuredA - measuredP) >= 2) {
    lines.push(
      measuredA > measuredP
        ? `Measured faster on your machine: ${measuredA} vs ${measuredP} tok/s.`
        : `Measured slower on your machine: ${measuredA} vs ${measuredP} tok/s.`,
    )
  } else {
    const speedA = a.activeParamsB ?? a.totalParamsB
    const speedP = p.activeParamsB ?? p.totalParamsB
    if (speedA <= speedP * 0.6) {
      lines.push(`Lighter per token (≈${speedA}B active vs ≈${speedP}B) — likely faster replies.`)
    } else if (speedA >= speedP * 1.6) {
      lines.push(`Heavier per token (≈${speedA}B active vs ≈${speedP}B) — likely slower replies.`)
    }
  }

  if (a.totalParamsB >= p.totalParamsB * 1.5) {
    lines.push(`More knowledge capacity (${a.totalParamsB}B vs ${p.totalParamsB}B total) — often better on hard questions.`)
  } else if (a.totalParamsB <= p.totalParamsB * 0.6) {
    lines.push(`Less knowledge capacity (${a.totalParamsB}B vs ${p.totalParamsB}B total) — may miss on hard questions.`)
  }

  const tierRank = { none: 0, single: 1, multi: 2 } as const
  if (tierRank[a.toolCalling] !== tierRank[p.toolCalling]) {
    lines.push(
      tierRank[a.toolCalling] < tierRank[p.toolCalling]
        ? `Weaker tool calling (${a.toolCalling} vs ${p.toolCalling}) — matters for connectors and agents.`
        : `Stronger tool calling (${a.toolCalling} vs ${p.toolCalling}) — matters for connectors and agents.`,
    )
  }

  return lines.slice(0, 3)
}

function describeUseCaseFit(useCase: UseCase, model: CatalogModel): string {
  switch (useCase) {
    case 'coding':
      return `${model.name} is one of the strongest local coding models in its memory tier.`
    case 'agents':
      return `${model.name} is agent-trained: it can drive tools and multi-step tasks reliably for its size.`
    case 'documents':
      return `${model.name} handles long documents well — large context with a small memory footprint.`
    case 'reasoning':
      return `${model.name} is tuned for step-by-step reasoning.`
    default:
      return `${model.name} is a strong all-round assistant for everyday use.`
  }
}
