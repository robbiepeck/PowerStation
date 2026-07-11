import crypto from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { app, Notification, powerMonitor, shell } from 'electron'
import { admitModel } from './admitModel.js'
import { getState } from './config.js'
import { getMemoryPressureLevel } from './hardware.js'
import * as llm from './llm.js'
import * as models from './models.js'
import {
  nextCronOccurrence,
  buildScheduledInferenceRequest,
  sanitizeScheduledJob,
  sanitizeScheduleRun,
  zonedMinuteKey,
  type ScheduledJob,
  type ScheduleRun,
} from './scheduleFormat.js'

export type SchedulerSnapshot = {
  jobs: ScheduledJob[]
  runs: ScheduleRun[]
  runningJobIds: string[]
  openAtLogin: boolean
  openAtLoginSupported: boolean
  backgroundNote: string
}

type ScheduleStore = { version: 1; jobs: ScheduledJob[]; runs: ScheduleRun[] }

const MAX_JOBS = 50
const MAX_RUNS = 250
const MISSED_GRACE_MS = 90_000
const OUTPUT_LIMIT = 100_000

let store: ScheduleStore | null = null
let writeQueue: Promise<void> = Promise.resolve()
let timer: ReturnType<typeof setTimeout> | null = null
let ticking = false
let started = false
let stopping = false
let changeListener: ((snapshot: SchedulerSnapshot) => void) | null = null
const runningJobIds = new Set<string>()
const pendingManualJobIds = new Set<string>()
const queuedJobIds = new Set<string>()
const activeRequestIds = new Map<string, string>()
let executionChain: Promise<unknown> = Promise.resolve()

function schedulesFile(): string {
  return path.join(app.getPath('userData'), 'scheduled-jobs.json')
}

function defaultStore(): ScheduleStore {
  return { version: 1, jobs: [], runs: [] }
}

function snapshotStore(current: ScheduleStore): string {
  return JSON.stringify(current, null, 1)
}

async function persist(): Promise<void> {
  if (!store) return
  const target = schedulesFile()
  const snapshot = snapshotStore(store)
  const temp = `${target}.${process.pid}.tmp`
  writeQueue = writeQueue.catch(() => undefined).then(async () => {
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 })
    await fs.writeFile(temp, snapshot, { encoding: 'utf8', mode: 0o600 })
    await fs.rename(temp, target)
    await fs.chmod(target, 0o600).catch(() => undefined)
  })
  return writeQueue
}

function parseStore(value: unknown): ScheduleStore {
  const record = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
  const rawJobs = Array.isArray(record.jobs) ? record.jobs.slice(0, MAX_JOBS) : []
  const jobs: ScheduledJob[] = []
  for (const raw of rawJobs) {
    const item = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : null
    const id = typeof item?.id === 'string' ? item.id : ''
    try {
      const job = sanitizeScheduledJob(item, id)
      if (job.enabled && typeof item?.nextRunAt === 'number' && Number.isFinite(item.nextRunAt)) {
        job.nextRunAt = item.nextRunAt
      }
      if (typeof item?.lastRunAt === 'number' && Number.isFinite(item.lastRunAt)) job.lastRunAt = item.lastRunAt
      if (typeof item?.lastScheduledFor === 'number' && Number.isFinite(item.lastScheduledFor)) {
        job.lastScheduledFor = item.lastScheduledFor
      }
      jobs.push(job)
    } catch {
      void 0
    }
  }
  const runs = (Array.isArray(record.runs) ? record.runs : [])
    .slice(0, MAX_RUNS)
    .map(sanitizeScheduleRun)
    .filter((run): run is ScheduleRun => run !== null)
  return { version: 1, jobs, runs }
}

async function loadStore(): Promise<ScheduleStore> {
  if (store) return store
  try {
    const raw = await fs.readFile(schedulesFile(), 'utf8')
    store = parseStore(JSON.parse(raw))
  } catch {
    store = defaultStore()
  }
  let repaired = false
  const now = Date.now()
  for (const run of store.runs) {
    if (run.status === 'running') {
      run.status = 'failed'
      run.finishedAt = now
      run.error = 'PowerStation stopped before this run completed.'
      repaired = true
    }
  }
  if (repaired) await persist()
  return store
}

function loginSupported(): boolean {
  return app.isPackaged && (process.platform === 'darwin' || process.platform === 'win32')
}

function backgroundNote(): string {
  if (process.platform === 'darwin') return 'Jobs continue after the window closes, until you quit PowerStation.'
  return 'Keep PowerStation running for jobs to execute. Closing its window currently quits the app on this platform.'
}

export async function getSnapshot(): Promise<SchedulerSnapshot> {
  const current = await loadStore()
  return {
    jobs: [...current.jobs].sort((a, b) => (a.nextRunAt ?? Number.MAX_SAFE_INTEGER) - (b.nextRunAt ?? Number.MAX_SAFE_INTEGER)),
    runs: [...current.runs].sort((a, b) => b.startedAt - a.startedAt),
    runningJobIds: [...new Set([...runningJobIds, ...queuedJobIds])],
    openAtLogin: loginSupported() ? app.getLoginItemSettings().openAtLogin : false,
    openAtLoginSupported: loginSupported(),
    backgroundNote: backgroundNote(),
  }
}

async function emitChange(): Promise<void> {
  changeListener?.(await getSnapshot())
}

export function setChangeListener(listener: typeof changeListener): void {
  changeListener = listener
}

function scheduleTimer(): void {
  if (!started || stopping) return
  if (timer) clearTimeout(timer)
  const nextRuns = (store?.jobs ?? [])
    .filter((job) => job.enabled && job.nextRunAt !== null)
    .map((job) => job.nextRunAt as number)
  const next = nextRuns.length ? Math.min(...nextRuns) : null
  const delay = next === null ? 60_000 : Math.min(60_000, Math.max(1000, next - Date.now()))
  timer = setTimeout(requestTick, delay)
}

function pushRun(run: ScheduleRun): void {
  if (!store) return
  store.runs.unshift(run)
  if (store.runs.length > MAX_RUNS) store.runs.length = MAX_RUNS
}

async function recordSkipped(job: ScheduledJob, scheduledFor: number | null, reason: string): Promise<ScheduleRun> {
  const now = Date.now()
  const run: ScheduleRun = {
    id: `run-${now}-${crypto.randomBytes(4).toString('hex')}`,
    jobId: job.id,
    jobName: job.name,
    scheduledFor,
    startedAt: now,
    finishedAt: now,
    status: 'skipped',
    output: '',
    error: reason,
    modelName: path.basename(job.modelPath),
    tokensPerSec: null,
  }
  job.lastRunAt = now
  pushRun(run)
  await persist()
  await emitChange()
  return run
}

function notify(job: ScheduledJob, title: string, body: string): void {
  if (stopping || !job.notify || !Notification.isSupported()) return
  try {
    new Notification({ title, body, silent: false }).show()
  } catch {
    void 0
  }
}

async function executeJob(job: ScheduledJob, scheduledFor: number | null): Promise<ScheduleRun> {
  if (stopping) return recordSkipped(job, scheduledFor, 'PowerStation stopped before this queued run began.')
  if (runningJobIds.has(job.id)) return recordSkipped(job, scheduledFor, 'This job is already running.')
  if (llm.getActiveRequestIds().length > 0) {
    return recordSkipped(job, scheduledFor, 'Another chat, API request, or scheduled job was using the model runtime.')
  }
  if (!job.allowOnBattery && powerMonitor.isOnBatteryPower()) {
    return recordSkipped(job, scheduledFor, 'Skipped while this computer was running on battery power.')
  }
  if ((await getMemoryPressureLevel().catch(() => null)) === 'critical') {
    return recordSkipped(job, scheduledFor, 'Skipped because the operating system reported critical memory pressure.')
  }
  let installedModel: Awaited<ReturnType<typeof models.listModels>>[number]
  let admission: Awaited<ReturnType<typeof admitModel>>
  try {
    const match = (await models.listModels()).find((model) => path.resolve(model.path) === path.resolve(job.modelPath))
    if (!match) return recordSkipped(job, scheduledFor, 'The selected model is no longer installed.')
    installedModel = match
    admission = await admitModel(job.modelPath)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return recordSkipped(job, scheduledFor, `The model safety check failed: ${detail}`.slice(0, 2000))
  }
  if (!admission.fits) return recordSkipped(job, scheduledFor, admission.reason ?? 'The selected model does not fit safely.')

  const startedAt = Date.now()
  const requestId = `scheduled-${job.id.slice(9, 40)}-${startedAt}`
  const run: ScheduleRun = {
    id: `run-${startedAt}-${crypto.randomBytes(4).toString('hex')}`,
    jobId: job.id,
    jobName: job.name,
    scheduledFor,
    startedAt,
    finishedAt: null,
    status: 'running',
    output: '',
    error: '',
    modelName: installedModel.fileName,
    tokensPerSec: null,
  }
  runningJobIds.add(job.id)
  activeRequestIds.set(job.id, requestId)
  job.lastRunAt = startedAt
  pushRun(run)
  await persist()
  await emitChange()

  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    llm.stopChat(requestId)
  }, job.timeoutSeconds * 1000)
  const hardTimeout = setTimeout(() => {
    llm.shutdown()
  }, (job.timeoutSeconds + 30) * 1000)
  let unloadAfterRun = false
  try {
    const state = await getState()
    unloadAfterRun = state.settings.autoUnloadIdle && llm.getLoadedPath() !== job.modelPath
    const result = await llm.chat({
      requestId,
      ...buildScheduledInferenceRequest(job, admission.contextTokens, state.settings.temperature),
      onToken: () => {},
      onStatus: () => {},
      onToolCall: () => {},
      onCompacted: () => {},
    })
    if (timedOut) throw new Error(`The run exceeded its ${job.timeoutSeconds}-second limit.`)
    if (result.aborted) throw new Error('The model stopped before completing the scheduled run.')
    run.status = 'success'
    run.output = result.text.slice(0, OUTPUT_LIMIT)
    run.tokensPerSec = result.tokensPerSec
    notify(job, `${job.name} completed`, 'The result is ready in PowerStation → Schedules.')
  } catch (error) {
    run.status = 'failed'
    run.error = timedOut
      ? `The run exceeded its ${job.timeoutSeconds}-second limit.`
      : error instanceof Error
        ? error.message.slice(0, 2000)
        : String(error).slice(0, 2000)
    notify(job, `${job.name} failed`, 'Open PowerStation → Schedules to review the error.')
  } finally {
    clearTimeout(timeout)
    clearTimeout(hardTimeout)
    if (unloadAfterRun) await llm.unloadModel().catch(() => undefined)
    run.finishedAt = Date.now()
    runningJobIds.delete(job.id)
    activeRequestIds.delete(job.id)
    await persist()
    await emitChange()
  }
  return run
}

function queueJob(job: ScheduledJob, scheduledFor: number | null): Promise<ScheduleRun> {
  queuedJobIds.add(job.id)
  void emitChange()
  const execute = async () => {
    try {
      return await executeJob(job, scheduledFor)
    } finally {
      queuedJobIds.delete(job.id)
      await emitChange()
    }
  }
  const run = executionChain.then(execute, execute)
  executionChain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

async function tick(): Promise<void> {
  if (ticking || stopping) return
  ticking = true
  try {
    const current = await loadStore()
    const now = Date.now()
    const due: Array<{ job: ScheduledJob; scheduledFor: number }> = []
    for (const job of current.jobs) {
      if (!job.enabled) continue
      if (job.nextRunAt === null) job.nextRunAt = nextCronOccurrence(job.cron, job.timezone, now)
      if (job.nextRunAt > now) continue
      const scheduledFor = job.nextRunAt
      job.nextRunAt = nextCronOccurrence(job.cron, job.timezone, now)
      if (
        job.lastScheduledFor !== null &&
        zonedMinuteKey(job.lastScheduledFor, job.timezone) === zonedMinuteKey(scheduledFor, job.timezone)
      ) {
        continue
      }
      job.lastScheduledFor = scheduledFor
      if (now - scheduledFor > MISSED_GRACE_MS && job.missedRunPolicy === 'skip') {
        await recordSkipped(job, scheduledFor, 'Missed while PowerStation was asleep or not running.')
      } else {
        due.push({ job, scheduledFor })
      }
    }
    await persist()
    await emitChange()
    for (const item of due) await queueJob(item.job, item.scheduledFor)
  } finally {
    ticking = false
    scheduleTimer()
  }
}

function requestTick(): void {
  void tick().catch(() => {
    scheduleTimer()
  })
}

export async function saveJob(payload: unknown): Promise<ScheduledJob> {
  const current = await loadStore()
  const record = typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {}
  const requestedId = typeof record.id === 'string' ? record.id : ''
  const existing = current.jobs.find((job) => job.id === requestedId)
  if (existing && (runningJobIds.has(existing.id) || queuedJobIds.has(existing.id))) {
    throw new Error('Wait for this job to finish before editing it.')
  }
  if (!existing && current.jobs.length >= MAX_JOBS) throw new Error(`PowerStation supports up to ${MAX_JOBS} scheduled jobs.`)
  const now = Date.now()
  const id = existing?.id ?? `schedule-${crypto.randomUUID()}`
  const scheduleChanged = Boolean(existing && (existing.cron !== record.cron || existing.timezone !== record.timezone))
  const job = sanitizeScheduledJob(
    {
      ...record,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      lastRunAt: existing?.lastRunAt ?? null,
      lastScheduledFor: scheduleChanged ? null : (existing?.lastScheduledFor ?? null),
    },
    id,
    now,
  )
  const installed = (await models.listModels()).some((model) => path.resolve(model.path) === path.resolve(job.modelPath))
  if (!installed) throw new Error('Choose a model that is currently installed.')
  if (existing) current.jobs[current.jobs.indexOf(existing)] = job
  else current.jobs.push(job)
  await persist()
  scheduleTimer()
  await emitChange()
  return job
}

export async function deleteJob(id: unknown): Promise<boolean> {
  const current = await loadStore()
  if (typeof id !== 'string' || runningJobIds.has(id) || queuedJobIds.has(id)) return false
  const before = current.jobs.length
  current.jobs = current.jobs.filter((job) => job.id !== id)
  current.runs = current.runs.filter((run) => run.jobId !== id)
  if (current.jobs.length === before) return false
  await persist()
  scheduleTimer()
  await emitChange()
  return true
}

export async function runJobNow(id: unknown): Promise<ScheduleRun> {
  const current = await loadStore()
  const job = typeof id === 'string' ? current.jobs.find((candidate) => candidate.id === id) : null
  if (!job) throw new Error('Scheduled job not found.')
  if (runningJobIds.has(job.id) || queuedJobIds.has(job.id) || pendingManualJobIds.has(job.id)) {
    throw new Error('This job is already running or queued.')
  }
  pendingManualJobIds.add(job.id)
  try {
    return await queueJob(job, null)
  } finally {
    pendingManualJobIds.delete(job.id)
  }
}

export async function setOpenAtLogin(enabled: unknown): Promise<SchedulerSnapshot> {
  if (!loginSupported()) throw new Error('Start at login is available in packaged macOS and Windows builds.')
  app.setLoginItemSettings({ openAtLogin: enabled === true })
  await emitChange()
  return getSnapshot()
}

export async function revealScheduleData(): Promise<boolean> {
  await fs.mkdir(path.dirname(schedulesFile()), { recursive: true, mode: 0o700 })
  await loadStore()
  await persist()
  shell.showItemInFolder(schedulesFile())
  return true
}

export async function exportJobDefinitions(): Promise<ScheduledJob[]> {
  return (await loadStore()).jobs.map((job) => ({ ...job }))
}

export async function importJobDefinitions(values: unknown[]): Promise<number> {
  const current = await loadStore()
  const installedPaths = new Set((await models.listModels()).map((model) => path.resolve(model.path)))
  let count = 0
  for (const value of values.slice(0, MAX_JOBS)) {
    if (current.jobs.length >= MAX_JOBS) break
    const record = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
    try {
      const id = `schedule-${crypto.randomUUID()}`
      const job = sanitizeScheduledJob({ ...record, id: undefined, lastRunAt: null, lastScheduledFor: null }, id)
      const installed = installedPaths.has(path.resolve(job.modelPath))
      if (!installed) job.enabled = false
      current.jobs.push(job)
      count += 1
    } catch {
      void 0
    }
  }
  await persist()
  scheduleTimer()
  await emitChange()
  return count
}

export async function startScheduler(): Promise<void> {
  if (started) return
  started = true
  stopping = false
  await loadStore()
  powerMonitor.on('resume', requestTick)
  scheduleTimer()
  requestTick()
}

export function stopScheduler(): void {
  const wasStarted = started
  stopping = true
  started = false
  if (timer) clearTimeout(timer)
  timer = null
  if (wasStarted) powerMonitor.removeListener('resume', requestTick)
  for (const requestId of activeRequestIds.values()) llm.stopChat(requestId)
}
