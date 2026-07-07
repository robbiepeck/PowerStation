// Local, OpenAI-compatible HTTP API for the running model. Off by default,
// bound strictly to 127.0.0.1, and gated by a bearer token — so other apps and
// scripts on THIS machine can call your local model with the standard OpenAI
// SDK, but nothing off-machine can reach it and nothing on-machine can use it
// without the token you copy from Settings.
//
// Design (confirmed): token-required auth, honour the requested model (fall
// back to the app's selected model), RAW inference (no app system prompt or
// skills — the caller controls the messages), and no tool calling in v1.

import http from 'node:http'
import crypto from 'node:crypto'
import { getState, mutate } from './config.js'
import * as llm from './llm.js'
import * as models from './models.js'
import { admitModel } from './admitModel.js'
import { embedForApi } from './rag.js'
import {
  apiError,
  chatChunk,
  chatCompletion,
  embeddingInputs,
  embeddingsResponse,
  modelsList,
  parseChatBody,
} from './apiFormat.js'

export type ApiRequestLog = {
  id: number
  timestamp: number
  method: string
  path: string
  model: string | null
  status: number
  durationMs: number
  error?: string
}

export type ApiServerStatus = {
  enabled: boolean
  running: boolean
  port: number
  url: string
  token: string
  requestCount: number
  lastError: string | null
}

const MAX_BODY_BYTES = 8 * 1024 * 1024
const LOG_LIMIT = 60
const DEFAULT_MAX_TOKENS = 2048

let server: http.Server | null = null
let running = false
let lastError: string | null = null
let requestCount = 0
let nextRequestId = 1
const log: ApiRequestLog[] = []
let logListener: ((entry: ApiRequestLog) => void) | null = null
let statusListener: (() => void) | null = null

export function setApiLogListener(fn: typeof logListener): void {
  logListener = fn
}
export function setApiStatusListener(fn: typeof statusListener): void {
  statusListener = fn
}
export function getApiLog(): ApiRequestLog[] {
  return [...log]
}

function generateToken(): string {
  return crypto.randomBytes(24).toString('base64url')
}

/** A token is created lazily the first time the server is enabled. */
async function ensureToken(): Promise<string> {
  const state = await getState()
  if (state.apiServer.token) return state.apiServer.token
  const token = generateToken()
  await mutate((s) => {
    s.apiServer.token = token
  })
  return token
}

export async function getApiStatus(): Promise<ApiServerStatus> {
  const { apiServer } = await getState()
  return {
    enabled: apiServer.enabled,
    running,
    port: apiServer.port,
    url: `http://127.0.0.1:${apiServer.port}/v1`,
    token: apiServer.token,
    requestCount,
    lastError,
  }
}

function record(entry: Omit<ApiRequestLog, 'id' | 'timestamp'>): void {
  requestCount += 1
  const full: ApiRequestLog = { id: nextRequestId++, timestamp: Date.now(), ...entry }
  log.push(full)
  if (log.length > LOG_LIMIT) log.shift()
  logListener?.(full)
}

// --- request helpers ------------------------------------------------------------

function cors(res: http.ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(text)
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request body too large.'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** Resolve an OpenAI `model` string to an installed model path, else the selected one. */
async function resolveModelPath(requested: string | null): Promise<{ path: string; id: string } | null> {
  const list = await models.listModels()
  if (requested) {
    const want = requested.toLowerCase()
    const match = list.find((m) => {
      const fn = m.fileName.toLowerCase()
      return fn === want || fn.replace(/\.gguf$/, '') === want || m.name.toLowerCase() === want
    })
    if (match) return { path: match.path, id: match.fileName }
  }
  const state = await getState()
  const selected = state.selectedModelPath
  const model = selected ? list.find((m) => m.path === selected) : list[0]
  return model ? { path: model.path, id: model.fileName } : null
}

async function handleChat(res: http.ServerResponse, body: unknown): Promise<{ status: number; model: string | null; error?: string }> {
  let parsed
  try {
    parsed = parseChatBody(body)
  } catch (error) {
    sendJson(res, 400, apiError(error instanceof Error ? error.message : 'Bad request'))
    return { status: 400, model: null, error: 'bad request' }
  }
  const resolved = await resolveModelPath(parsed.model)
  if (!resolved) {
    sendJson(res, 404, apiError('No model is available. Add and select a model in PowerStation first.', 'model_not_found'))
    return { status: 404, model: parsed.model }
  }
  const admission = await admitModel(resolved.path)
  if (!admission.fits) {
    sendJson(res, 422, apiError(admission.reason ?? 'The model does not fit this machine.', 'model_wont_fit'))
    return { status: 422, model: resolved.id, error: admission.reason }
  }

  const state = await getState()
  const requestId = `api-${nextRequestId}`
  const id = `chatcmpl-${crypto.randomBytes(8).toString('hex')}`
  const created = Math.floor(Date.now() / 1000)
  const chatOptions = {
    requestId,
    modelPath: resolved.path,
    prompt: parsed.prompt,
    systemPrompt: parsed.systemPrompt, // raw: only the caller's system message
    contextTokens: admission.contextTokens,
    temperature: parsed.temperature ?? state.settings.temperature,
    maxTokens: parsed.maxTokens ?? DEFAULT_MAX_TOKENS,
    history: parsed.history.length ? parsed.history : undefined,
    autoCompact: false,
    isolated: true, // never disturb the app's in-chat session
  }

  if (parsed.stream) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
    res.write(`data: ${JSON.stringify(chatChunk({ id, created, model: resolved.id, role: true }))}\n\n`)
    try {
      await llm.chat({
        ...chatOptions,
        onToken: (token) => res.write(`data: ${JSON.stringify(chatChunk({ id, created, model: resolved.id, delta: token }))}\n\n`),
        onStatus: () => {},
        onToolCall: () => {},
        onCompacted: () => {},
      })
      res.write(`data: ${JSON.stringify(chatChunk({ id, created, model: resolved.id, finishReason: 'stop' }))}\n\n`)
      res.write('data: [DONE]\n\n')
      res.end()
      return { status: 200, model: resolved.id }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      res.write(`data: ${JSON.stringify({ error: { message, type: 'server_error' } })}\n\n`)
      res.write('data: [DONE]\n\n')
      res.end()
      return { status: 500, model: resolved.id, error: message }
    }
  }

  try {
    const result = await llm.chat({ ...chatOptions, onToken: () => {}, onStatus: () => {}, onToolCall: () => {}, onCompacted: () => {} })
    sendJson(res, 200, chatCompletion({ id, created, model: resolved.id, content: result.text, promptText: parsed.prompt }))
    return { status: 200, model: resolved.id }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    sendJson(res, 500, apiError(message, 'server_error'))
    return { status: 500, model: resolved.id, error: message }
  }
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const started = Date.now()
  const method = req.method ?? 'GET'
  const path = (req.url ?? '').split('?')[0]
  cors(res)
  if (method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  // Auth: constant-ish check against the configured bearer token.
  const state = await getState()
  const auth = req.headers.authorization ?? ''
  const presented = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!state.apiServer.token || presented !== state.apiServer.token) {
    sendJson(res, 401, apiError('Missing or invalid API key.', 'invalid_api_key'))
    record({ method, path, model: null, status: 401, durationMs: Date.now() - started, error: 'unauthorized' })
    return
  }

  try {
    if (method === 'GET' && path === '/v1/models') {
      const list = await models.listModels()
      sendJson(res, 200, modelsList(list.map((m) => ({ id: m.fileName, created: 0 }))))
      record({ method, path, model: null, status: 200, durationMs: Date.now() - started })
      return
    }
    if (method === 'POST' && path === '/v1/chat/completions') {
      const body = JSON.parse((await readBody(req)) || '{}')
      const outcome = await handleChat(res, body)
      record({ method, path, model: outcome.model, status: outcome.status, durationMs: Date.now() - started, error: outcome.error })
      return
    }
    if (method === 'POST' && path === '/v1/embeddings') {
      const body = JSON.parse((await readBody(req)) || '{}')
      const inputs = embeddingInputs(body)
      if (!inputs.length) {
        sendJson(res, 400, apiError('`input` must be a non-empty string or array of strings.'))
        record({ method, path, model: null, status: 400, durationMs: Date.now() - started })
        return
      }
      const { model, vectors } = await embedForApi(inputs)
      sendJson(res, 200, embeddingsResponse(model, vectors))
      record({ method, path, model, status: 200, durationMs: Date.now() - started })
      return
    }
    sendJson(res, 404, apiError(`Unknown endpoint ${method} ${path}`, 'not_found'))
    record({ method, path, model: null, status: 404, durationMs: Date.now() - started })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!res.headersSent) sendJson(res, 500, apiError(message, 'server_error'))
    else res.end()
    record({ method, path, model: null, status: 500, durationMs: Date.now() - started, error: message })
  }
}

// --- lifecycle ------------------------------------------------------------------

export async function startApiServer(): Promise<void> {
  if (server) return
  const token = await ensureToken()
  void token
  const { apiServer } = await getState()
  lastError = null
  server = http.createServer((req, res) => void handleRequest(req, res))
  server.on('error', (err) => {
    lastError = err instanceof Error ? err.message : String(err)
    running = false
    server = null
    statusListener?.()
  })
  await new Promise<void>((resolve) => {
    // Bind to loopback ONLY — never 0.0.0.0. Off-machine clients cannot reach it.
    server!.listen(apiServer.port, '127.0.0.1', () => {
      running = true
      statusListener?.()
      resolve()
    })
  })
}

export async function stopApiServer(): Promise<void> {
  if (!server) {
    running = false
    return
  }
  const current = server
  server = null
  running = false
  await new Promise<void>((resolve) => current.close(() => resolve()))
  statusListener?.()
}

/** Bring the running server in line with config (called after any api:* change and on boot). */
export async function syncApiServer(): Promise<ApiServerStatus> {
  const { apiServer } = await getState()
  if (apiServer.enabled && !running) {
    await startApiServer().catch((err) => {
      lastError = err instanceof Error ? err.message : String(err)
    })
  } else if (!apiServer.enabled && running) {
    await stopApiServer()
  } else if (apiServer.enabled && running) {
    // Port may have changed — restart onto the new one.
    await stopApiServer()
    await startApiServer().catch((err) => {
      lastError = err instanceof Error ? err.message : String(err)
    })
  }
  return getApiStatus()
}

export async function regenerateApiToken(): Promise<ApiServerStatus> {
  await mutate((s) => {
    s.apiServer.token = generateToken()
  })
  return getApiStatus()
}
