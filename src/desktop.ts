import type {
  ChatStatusPayload,
  DeviceInfo,
  ModelInfo,
  PowerStationBridge,
  Settings,
  TelemetrySnapshot,
  Unsubscribe,
} from './types'

declare global {
  interface Window {
    powerStation?: PowerStationBridge
  }
}

/**
 * In a packaged/dev Electron build the preload bridge exposes `window.powerStation`.
 * When the renderer runs in a plain browser (`npm run dev`) we fall back to a mock
 * so the full UI can still be developed and previewed without a model loaded.
 */
export const isElectron = typeof window !== 'undefined' && Boolean(window.powerStation)

type Listener<T> = (payload: T) => void

function emitter<T>() {
  const listeners = new Set<Listener<T>>()
  return {
    on: (callback: Listener<T>): Unsubscribe => {
      listeners.add(callback)
      return () => listeners.delete(callback)
    },
    emit: (payload: T) => listeners.forEach((listener) => listener(payload)),
  }
}

const MOCK_REPLY = `Here's a quick **browser preview** of PowerStation's chat. The real desktop build streams tokens from your selected local GGUF model.

\`\`\`ts
// Inference runs in the Electron main process via node-llama-cpp
const session = new LlamaChatSession({ contextSequence })
await session.prompt(userText, { onTextChunk: send })
\`\`\`

- Pick a downloaded model from the header
- Watch live host metrics on the **Monitor** tab
- Manage models on the **Models** tab`

function createMockBridge(): PowerStationBridge {
  const mockModels: ModelInfo[] = [
    {
      path: '/mock/qwen2.5-3b-instruct-q4_k_m.gguf',
      fileName: 'qwen2.5-3b-instruct-q4_k_m.gguf',
      name: 'Qwen2.5 3B Instruct (preview)',
      architecture: 'qwen2',
      parameters: '3B',
      quantization: 'Q4_K_M',
      contextLength: 32768,
      sizeBytes: 2_100_000_000,
      source: 'imported',
    },
    {
      path: '/mock/llama-3.2-1b-instruct-q8_0.gguf',
      fileName: 'llama-3.2-1b-instruct-q8_0.gguf',
      name: 'Llama 3.2 1B Instruct (preview)',
      architecture: 'llama',
      parameters: '1B',
      quantization: 'Q8_0',
      contextLength: 131072,
      sizeBytes: 1_300_000_000,
      source: 'folder',
    },
  ]
  let selectedPath: string | null = mockModels[0].path

  const tokenEmitter = emitter<{ requestId: string; token: string }>()
  const doneEmitter = emitter<{ requestId: string; text: string; tokensPerSec: number; aborted: boolean }>()
  const statusEmitter = emitter<ChatStatusPayload>()
  const telemetryEmitter = emitter<TelemetrySnapshot>()
  const aborted = new Set<string>()

  let generating = false
  const startTelemetry = () => {
    const total = 16
    let tick = 0
    return window.setInterval(() => {
      tick += 1
      const base = generating ? 52 : 9
      const wobble = Math.sin(tick * 0.6) * 6
      const cpu = Math.max(2, Math.min(100, base + wobble + (generating ? 18 : 3)))
      const snapshot: TelemetrySnapshot = {
        timestamp: Date.now(),
        cpu: { load: cpu, cores: 10, real: false },
        ram: { usedGb: generating ? 9.4 : 3.1, totalGb: total, real: false },
        gpu: { load: generating ? 64 + wobble : 5, name: 'Simulated GPU', type: 'mock', real: false },
        vram: { usedGb: generating ? 3.6 : 0.6, totalGb: total, real: false },
        power: { watts: generating ? 48 + wobble : 11, estimated: true },
        thermal: { celsius: null, headroomPct: generating ? 64 : 92, real: false },
        tokensPerSec: generating ? 38 : 0,
        model: { loaded: generating, path: selectedPath },
      }
      telemetryEmitter.emit(snapshot)
    }, 1100)
  }
  let telemetryHandle: number | null = null

  const settings: Settings = {
    memoryBudgetGb: 14,
    computeCap: 72,
    contextTokens: 8192,
    autoUnloadIdle: true,
    lowPowerBias: false,
    temperature: 0.7,
    maxTokens: 1024,
  }

  const deviceInfo: DeviceInfo = {
    gpuType: 'mock',
    gpuNames: ['Simulated GPU (browser preview)'],
    vram: { total: 16e9, used: 0.6e9, free: 15.4e9, unifiedSize: 16e9 },
  }

  return {
    platform: 'browser',
    runtime: 'browser-mock',
    models: {
      list: async () => [...mockModels],
      pickFile: async () => [...mockModels],
      pickFolder: async () => [...mockModels],
      select: async (filePath) => {
        selectedPath = filePath
        return selectedPath
      },
      getSelected: async () => selectedPath,
      remove: async () => undefined,
      deleteFile: async () => ({ deleted: false, reason: 'Not available in browser preview' }),
      reveal: async () => true,
      download: async () => mockModels[0].path,
      onDownloadProgress: () => () => undefined,
      onDownloadDone: () => () => undefined,
      onDownloadError: () => () => undefined,
    },
    chat: {
      send: async ({ requestId, prompt }) => {
        generating = true
        statusEmitter.emit({ requestId, phase: 'starting' })
        const reply = prompt.trim().length < 4 ? 'Hello! Ask me anything to see the streaming preview.' : MOCK_REPLY
        const words = reply.split(/(\s+)/)
        window.setTimeout(() => statusEmitter.emit({ requestId, phase: 'generating' }), 220)
        let index = 0
        const step = window.setInterval(() => {
          if (aborted.has(requestId) || index >= words.length) {
            window.clearInterval(step)
            generating = false
            const wasAborted = aborted.has(requestId)
            aborted.delete(requestId)
            doneEmitter.emit({ requestId, text: reply, tokensPerSec: 38, aborted: wasAborted })
            return
          }
          tokenEmitter.emit({ requestId, token: words[index] })
          index += 1
        }, 28)
        return { requestId, ok: true }
      },
      stop: async (requestId) => {
        aborted.add(requestId)
        return true
      },
      reset: async () => undefined,
      unload: async () => undefined,
      onToken: (callback) => tokenEmitter.on(callback),
      onDone: (callback) => doneEmitter.on(callback),
      onError: () => () => undefined,
      onStatus: (callback) => statusEmitter.on(callback),
    },
    telemetry: {
      onUpdate: (callback) => {
        if (telemetryHandle === null) telemetryHandle = startTelemetry()
        return telemetryEmitter.on(callback)
      },
    },
    settings: {
      get: async () => ({ ...settings }),
      update: async (patch) => Object.assign(settings, patch),
    },
    device: { info: async () => deviceInfo },
  }
}

let bridge: PowerStationBridge | null = null

export function getDesktop(): PowerStationBridge {
  if (bridge) return bridge
  bridge = window.powerStation ?? createMockBridge()
  return bridge
}
