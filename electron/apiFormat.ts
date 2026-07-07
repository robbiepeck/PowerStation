// Pure OpenAI-shape mapping for the local API server — no I/O, no Electron, so
// every wire-format decision is unit-tested. The server (apiServer.ts) does the
// HTTP and inference; this file only translates between OpenAI JSON and the
// worker's request/result shapes.

export type OpenAiMessage = { role: string; content: unknown }

export type ParsedChatBody = {
  model: string | null
  systemPrompt: string | undefined
  history: Array<{ role: 'user' | 'assistant'; text: string }>
  prompt: string
  stream: boolean
  temperature: number | undefined
  maxTokens: number | undefined
}

/** Coerce OpenAI content (string, or an array of content parts) to plain text. */
function contentToText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === 'object' && part !== null && typeof (part as { text?: unknown }).text === 'string' ? (part as { text: string }).text : ''))
      .join('')
  }
  return ''
}

/**
 * Split OpenAI chat messages into the worker's shape: system messages become
 * the system prompt (raw — only the caller's, never the app's), the last
 * message becomes the prompt, everything between becomes replayed history.
 * Throws a readable message when the request can't produce a prompt.
 */
export function parseChatBody(body: unknown): ParsedChatBody {
  const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : null
  if (!record) throw new Error('Request body must be a JSON object.')
  const messages = Array.isArray(record.messages) ? (record.messages as OpenAiMessage[]) : null
  if (!messages || !messages.length) throw new Error('`messages` must be a non-empty array.')

  const systemParts: string[] = []
  const turns: Array<{ role: 'user' | 'assistant'; text: string }> = []
  for (const message of messages) {
    const role = typeof message?.role === 'string' ? message.role : ''
    const text = contentToText(message?.content)
    if (role === 'system' || role === 'developer') {
      if (text) systemParts.push(text)
    } else if (role === 'assistant') {
      turns.push({ role: 'assistant', text })
    } else {
      // user (and anything unrecognised) is treated as a user turn.
      turns.push({ role: 'user', text })
    }
  }
  if (!turns.length) throw new Error('At least one user or assistant message is required.')
  const last = turns[turns.length - 1]
  const history = turns.slice(0, -1)

  const maxTokensRaw = record.max_completion_tokens ?? record.max_tokens
  return {
    model: typeof record.model === 'string' && record.model ? record.model : null,
    systemPrompt: systemParts.length ? systemParts.join('\n\n') : undefined,
    history,
    prompt: last.text,
    stream: record.stream === true,
    temperature: typeof record.temperature === 'number' && Number.isFinite(record.temperature) ? record.temperature : undefined,
    maxTokens: typeof maxTokensRaw === 'number' && Number.isFinite(maxTokensRaw) ? maxTokensRaw : undefined,
  }
}

const approxTokens = (text: string) => Math.max(0, Math.round(text.length / 4))

export function chatCompletion(opts: {
  id: string
  created: number
  model: string
  content: string
  promptText: string
  finishReason?: 'stop' | 'length'
}): Record<string, unknown> {
  const promptTokens = approxTokens(opts.promptText)
  const completionTokens = approxTokens(opts.content)
  return {
    id: opts.id,
    object: 'chat.completion',
    created: opts.created,
    model: opts.model,
    choices: [
      { index: 0, message: { role: 'assistant', content: opts.content }, finish_reason: opts.finishReason ?? 'stop' },
    ],
    usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens },
  }
}

export function chatChunk(opts: {
  id: string
  created: number
  model: string
  delta?: string
  finishReason?: 'stop' | 'length' | null
  role?: boolean
}): Record<string, unknown> {
  const delta: Record<string, unknown> = {}
  if (opts.role) delta.role = 'assistant'
  if (opts.delta !== undefined) delta.content = opts.delta
  return {
    id: opts.id,
    object: 'chat.completion.chunk',
    created: opts.created,
    model: opts.model,
    choices: [{ index: 0, delta, finish_reason: opts.finishReason ?? null }],
  }
}

export function modelsList(models: Array<{ id: string; created: number }>): Record<string, unknown> {
  return {
    object: 'list',
    data: models.map((m) => ({ id: m.id, object: 'model', created: m.created, owned_by: 'powerstation' })),
  }
}

export function embeddingsResponse(model: string, vectors: number[][]): Record<string, unknown> {
  const total = vectors.reduce((sum, v) => sum + v.length, 0)
  return {
    object: 'list',
    data: vectors.map((embedding, index) => ({ object: 'embedding', index, embedding })),
    model,
    usage: { prompt_tokens: total, total_tokens: total },
  }
}

export function apiError(message: string, type = 'invalid_request_error', code: string | null = null): Record<string, unknown> {
  return { error: { message, type, code } }
}

/** OpenAI `input` can be a string or an array of strings. Normalise to string[]. */
export function embeddingInputs(body: unknown): string[] {
  const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : null
  const input = record?.input
  if (typeof input === 'string') return input ? [input] : []
  if (Array.isArray(input)) return input.filter((s): s is string => typeof s === 'string' && s.length > 0).slice(0, 96)
  return []
}
