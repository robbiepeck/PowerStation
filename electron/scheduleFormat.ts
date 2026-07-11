export type MissedRunPolicy = 'skip' | 'run-once'
export type ScheduleRunStatus = 'running' | 'success' | 'failed' | 'skipped'

export type ScheduledJob = {
  id: string
  name: string
  enabled: boolean
  cron: string
  timezone: string
  modelPath: string
  prompt: string
  systemPrompt: string
  maxTokens: number
  timeoutSeconds: number
  missedRunPolicy: MissedRunPolicy
  allowOnBattery: boolean
  notify: boolean
  createdAt: number
  updatedAt: number
  nextRunAt: number | null
  lastRunAt: number | null
  lastScheduledFor: number | null
}

export type ScheduleRun = {
  id: string
  jobId: string
  jobName: string
  scheduledFor: number | null
  startedAt: number
  finishedAt: number | null
  status: ScheduleRunStatus
  output: string
  error: string
  modelName: string
  tokensPerSec: number | null
}

export function buildScheduledInferenceRequest(job: ScheduledJob, contextTokens: number, temperature: number) {
  return {
    modelPath: job.modelPath,
    prompt: job.prompt,
    systemPrompt: job.systemPrompt || undefined,
    contextTokens,
    temperature,
    maxTokens: job.maxTokens,
    isolated: true as const,
    autoCompact: false as const,
  }
}

type CronField = { values: Set<number>; wildcard: boolean }
type ParsedCron = {
  minute: CronField
  hour: CronField
  dayOfMonth: CronField
  month: CronField
  dayOfWeek: CronField
}

const JOB_ID = /^schedule-[a-z0-9-]{8,80}$/
const MAX_SEARCH_MS = 5 * 366 * 24 * 60 * 60 * 1000
const MIN_CADENCE_MINUTES = 5
const formatterCache = new Map<string, Intl.DateTimeFormat>()

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function cleanString(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function parseField(raw: string, min: number, max: number, normalize?: (value: number) => number): CronField {
  const values = new Set<number>()
  for (const segment of raw.split(',')) {
    if (!segment) throw new Error('Cron fields cannot contain empty list items.')
    const [base, stepText] = segment.split('/')
    if (segment.split('/').length > 2) throw new Error(`Invalid cron field “${raw}”.`)
    const step = stepText === undefined ? 1 : Number(stepText)
    if (!Number.isInteger(step) || step < 1 || step > max - min + 1) throw new Error(`Invalid cron step in “${raw}”.`)

    let start: number
    let end: number
    if (base === '*') {
      start = min
      end = max
    } else if (/^\d+-\d+$/.test(base)) {
      const [left, right] = base.split('-').map(Number)
      start = left
      end = right
      if (start > end) throw new Error(`Cron ranges must increase in “${raw}”.`)
    } else if (/^\d+$/.test(base)) {
      start = Number(base)
      end = stepText === undefined ? start : max
    } else {
      throw new Error(`Invalid cron field “${raw}”. Use numbers, *, ranges, lists, or steps.`)
    }
    if (start < min || start > max || end < min || end > max) {
      throw new Error(`Cron value in “${raw}” must be between ${min} and ${max}.`)
    }
    for (let value = start; value <= end; value += step) values.add(normalize ? normalize(value) : value)
  }
  if (!values.size) throw new Error(`Cron field “${raw}” does not select any values.`)
  const fullRange = new Set<number>()
  for (let value = min; value <= max; value += 1) fullRange.add(normalize ? normalize(value) : value)
  return { values, wildcard: values.size === fullRange.size && [...fullRange].every((value) => values.has(value)) }
}

export function parseCron(expression: string): ParsedCron {
  const fields = expression.trim().replace(/\s+/g, ' ').split(' ')
  if (fields.length !== 5) throw new Error('Use a standard five-field cron expression: minute hour day month weekday.')
  return {
    minute: parseField(fields[0], 0, 59),
    hour: parseField(fields[1], 0, 23),
    dayOfMonth: parseField(fields[2], 1, 31),
    month: parseField(fields[3], 1, 12),
    dayOfWeek: parseField(fields[4], 0, 7, (value) => (value === 7 ? 0 : value)),
  }
}

function assertSafeCadence(parsed: ParsedCron): void {
  const times: number[] = []
  for (const hour of parsed.hour.values) {
    for (const minute of parsed.minute.values) times.push(hour * 60 + minute)
  }
  times.sort((a, b) => a - b)
  if (times.length < 2) return
  for (let index = 0; index < times.length; index += 1) {
    const current = times[index]
    const next = index === times.length - 1 ? times[0] + 24 * 60 : times[index + 1]
    if (next - current < MIN_CADENCE_MINUTES) {
      throw new Error('Scheduled jobs must be at least five minutes apart.')
    }
  }
}

function assertPossibleCalendarDay(parsed: ParsedCron): void {
  if (!parsed.dayOfWeek.wildcard || parsed.dayOfMonth.wildcard) return
  const daysInMonth = [0, 31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  const possible = [...parsed.month.values].some((month) =>
    [...parsed.dayOfMonth.values].some((day) => day <= daysInMonth[month]),
  )
  if (!possible) throw new Error('This cron expression selects a day that does not exist in its selected month.')
}

export function isValidTimeZone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(0)
    return Boolean(timezone)
  } catch {
    return false
  }
}

function zonedParts(timestamp: number, timezone: string): { year: number; minute: number; hour: number; day: number; month: number; weekday: number } {
  let formatter = formatterCache.get(timezone)
  if (!formatter) {
    if (formatterCache.size >= 64) formatterCache.clear()
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      hourCycle: 'h23',
    })
    formatterCache.set(timezone, formatter)
  }
  const parts = formatter.formatToParts(timestamp)
  const values = Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]))
  const weekday = new Date(Date.UTC(values.year, values.month - 1, values.day)).getUTCDay()
  return { year: values.year, minute: values.minute, hour: values.hour, day: values.day, month: values.month, weekday }
}

export function zonedMinuteKey(timestamp: number, timezone: string): string {
  const local = zonedParts(timestamp, timezone)
  return `${local.year}-${local.month}-${local.day}-${local.hour}-${local.minute}`
}

function cronDayMatches(parsed: ParsedCron, local: ReturnType<typeof zonedParts>): boolean {
  if (!parsed.month.values.has(local.month)) return false
  const dayMatches = parsed.dayOfMonth.values.has(local.day)
  const weekdayMatches = parsed.dayOfWeek.values.has(local.weekday)
  if (parsed.dayOfMonth.wildcard && parsed.dayOfWeek.wildcard) return true
  if (parsed.dayOfMonth.wildcard) return weekdayMatches
  if (parsed.dayOfWeek.wildcard) return dayMatches
  return dayMatches || weekdayMatches
}

export function nextCronOccurrence(expression: string, timezone: string, after: number): number {
  if (!isValidTimeZone(timezone)) throw new Error('Choose a valid IANA timezone, such as Australia/Brisbane.')
  const parsed = parseCron(expression)
  assertSafeCadence(parsed)
  assertPossibleCalendarDay(parsed)
  let candidate = Math.floor(after / 60_000) * 60_000 + 60_000
  const searchEndsAt = candidate + MAX_SEARCH_MS
  while (candidate <= searchEndsAt) {
    const local = zonedParts(candidate, timezone)
    if (cronDayMatches(parsed, local)) {
      if (parsed.minute.values.has(local.minute) && parsed.hour.values.has(local.hour)) return candidate
      candidate += 60_000
      continue
    }

    const localDate = `${local.year}-${local.month}-${local.day}`
    let probe = candidate
    while (probe <= searchEndsAt) {
      probe += 60 * 60_000
      const next = zonedParts(probe, timezone)
      if (`${next.year}-${next.month}-${next.day}` !== localDate) break
    }
    // Resume one minute after the final hour of the old local day. This keeps
    // the search DST-safe without testing every minute of a non-matching day.
    candidate = probe - 59 * 60_000
  }
  throw new Error('This cron expression has no occurrence in the next five years. Check its day and month fields.')
}

export function sanitizeScheduledJob(value: unknown, id: string, now = Date.now()): ScheduledJob {
  if (!JOB_ID.test(id)) throw new Error('Invalid scheduled job id.')
  const record = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
  const name = cleanString(record.name, 100)
  const cron = cleanString(record.cron, 100)
  const timezone = cleanString(record.timezone, 100)
  const modelPath = cleanString(record.modelPath, 4096)
  const prompt = cleanString(record.prompt, 50_000)
  const systemPrompt = cleanString(record.systemPrompt, 20_000)
  if (!name) throw new Error('Give the scheduled job a name.')
  if (!modelPath) throw new Error('Choose an installed model for this scheduled job.')
  if (!prompt) throw new Error('Give the model a prompt to run.')
  const enabled = record.enabled !== false
  const createdAt = Math.max(0, numberOr(record.createdAt, now))
  return {
    id,
    name,
    enabled,
    cron,
    timezone,
    modelPath,
    prompt,
    systemPrompt,
    maxTokens: Math.round(Math.min(4096, Math.max(64, numberOr(record.maxTokens, 1024)))),
    timeoutSeconds: Math.round(Math.min(900, Math.max(30, numberOr(record.timeoutSeconds, 300)))),
    missedRunPolicy: record.missedRunPolicy === 'run-once' ? 'run-once' : 'skip',
    allowOnBattery: record.allowOnBattery === true,
    notify: record.notify !== false,
    createdAt,
    updatedAt: Math.max(createdAt, numberOr(record.updatedAt, now)),
    nextRunAt: enabled ? nextCronOccurrence(cron, timezone, now) : null,
    lastRunAt: typeof record.lastRunAt === 'number' && Number.isFinite(record.lastRunAt) ? record.lastRunAt : null,
    lastScheduledFor:
      typeof record.lastScheduledFor === 'number' && Number.isFinite(record.lastScheduledFor)
        ? record.lastScheduledFor
        : null,
  }
}

export function sanitizeScheduleRun(value: unknown): ScheduleRun | null {
  const record = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
  if (!record) return null
  const id = cleanString(record.id, 100)
  const jobId = cleanString(record.jobId, 100)
  const status = record.status
  if (!id || !JOB_ID.test(jobId) || !['running', 'success', 'failed', 'skipped'].includes(String(status))) return null
  const startedAt = numberOr(record.startedAt, 0)
  return {
    id,
    jobId,
    jobName: cleanString(record.jobName, 100),
    scheduledFor: typeof record.scheduledFor === 'number' && Number.isFinite(record.scheduledFor) ? record.scheduledFor : null,
    startedAt,
    finishedAt: typeof record.finishedAt === 'number' && Number.isFinite(record.finishedAt) ? record.finishedAt : null,
    status: status as ScheduleRunStatus,
    output: typeof record.output === 'string' ? record.output.slice(0, 100_000) : '',
    error: cleanString(record.error, 2000),
    modelName: cleanString(record.modelName, 300),
    tokensPerSec: typeof record.tokensPerSec === 'number' && Number.isFinite(record.tokensPerSec) ? record.tokensPerSec : null,
  }
}
