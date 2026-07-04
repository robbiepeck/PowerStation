// Recommendation engine: (detected hardware × stated intent) → ranked models
// with honest reasons. The user is never asked what computer they have — that
// is detected; the questionnaire only covers what can't be: what they want to
// do and how they trade speed against quality.

import { checkFit, type FitReport } from './admission.js'
import type { CatalogModel, UseCase } from './catalog.js'

export type Intent = {
  useCase: UseCase
  priority: 'speed' | 'balanced' | 'quality'
  /** Optional cap on download size, in GB (decimal). */
  maxDownloadGb?: number | null
}

export type Recommendation = {
  model: CatalogModel
  fit: FitReport
  defaultContextTokens: number
  score: number
  reasons: string[]
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
  limit?: number
}): Recommendation[] {
  const { catalog, intent, totalRamBytes, gpuBudgetBytes, freeDiskBytes } = options
  const ramGb = totalRamBytes / GIB

  const ranked: Recommendation[] = []
  for (const model of catalog) {
    if (model.minRamGb > ramGb + 0.5) continue
    if (intent.maxDownloadGb && model.sizeBytes > intent.maxDownloadGb * 1e9) continue
    if (freeDiskBytes !== null && model.sizeBytes > freeDiskBytes * 0.8) continue
    // An agent-focused pick without tool training would be present-and-broken.
    if (intent.useCase === 'agents' && model.toolCalling === 'none') continue

    const requestedContext = Math.min(defaultContextFor(intent.useCase), model.maxContext ?? Infinity)
    const fit = checkFit({
      weightsBytes: model.sizeBytes,
      geometry: model.geometry,
      kvBytesPerToken: model.kvBytesPerToken,
      contextTokens: requestedContext,
      budgetBytes: gpuBudgetBytes,
    })
    if (fit.verdict === 'wont-fit') continue

    const defaultContextTokens =
      fit.verdict === 'comfortable'
        ? requestedContext
        : Math.max(4096, Math.min(requestedContext, fit.maxComfortableContext ?? 4096))

    let score = 0
    const reasons: string[] = []

    const useCaseIndex = model.useCases.indexOf(intent.useCase)
    if (useCaseIndex >= 0) {
      score += 40 - useCaseIndex * 5
      reasons.push(useCaseLine(intent.useCase, model))
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
    } else {
      score -= 10
      reasons.push(`Fits, but tightly — PowerStation will cap its context at ${defaultContextTokens.toLocaleString()} tokens to stay safe.`)
    }

    if (model.expectedTps) {
      reasons.push(`Expected speed on your machine class: ~${model.expectedTps}.`)
    }
    if (model.activeParamsB) {
      reasons.push(`Mixture-of-experts design: ${model.totalParamsB}B knowledge with only ${model.activeParamsB}B active per token, so it responds fast.`)
    }
    if (intent.useCase === 'agents' && model.toolCalling === 'multi') {
      reasons.push('Trained for multi-step tool calling — suitable for connectors and MCP tools.')
    }

    ranked.push({ model, fit, defaultContextTokens, score, reasons })
  }

  ranked.sort((a, b) => b.score - a.score)
  return ranked.slice(0, options.limit ?? 3)
}

function useCaseLine(useCase: UseCase, model: CatalogModel): string {
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
