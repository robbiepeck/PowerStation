import { describe, expect, it } from 'vitest'
import {
  buildScheduledInferenceRequest,
  nextCronOccurrence,
  parseCron,
  sanitizeScheduledJob,
  zonedMinuteKey,
} from './scheduleFormat.js'

const UTC = 'UTC'

describe('scheduled job format', () => {
  it('parses standard fields, ranges, lists, steps, and Sunday 7', () => {
    const parsed = parseCron('*/15 8-17 * * 1-5,7')
    expect(parsed.minute.values.has(45)).toBe(true)
    expect(parsed.hour.values.has(17)).toBe(true)
    expect(parsed.dayOfWeek.values.has(0)).toBe(true)
  })

  it('finds the next occurrence in the selected timezone', () => {
    const after = Date.UTC(2026, 6, 12, 8, 58)
    expect(nextCronOccurrence('0 9 * * *', UTC, after)).toBe(Date.UTC(2026, 6, 12, 9, 0))
  })

  it('uses cron day-of-month OR weekday semantics when both are restricted', () => {
    const after = Date.UTC(2026, 6, 12, 0, 0) // Sunday
    expect(nextCronOccurrence('0 9 20 * 1', UTC, after)).toBe(Date.UTC(2026, 6, 13, 9, 0)) // Monday
  })

  it('gives repeated DST wall-clock minutes the same identity', () => {
    expect(zonedMinuteKey(Date.UTC(2026, 10, 1, 5, 30), 'America/New_York')).toBe(
      zonedMinuteKey(Date.UTC(2026, 10, 1, 6, 30), 'America/New_York'),
    )
  })

  it('rejects malformed and dangerously frequent expressions', () => {
    expect(() => parseCron('* * *')).toThrow('five-field')
    expect(() => nextCronOccurrence('* * * * *', UTC, Date.now())).toThrow('five minutes')
    expect(() => nextCronOccurrence('0 24 * * *', UTC, Date.now())).toThrow('between 0 and 23')
  })

  it('handles leap-day schedules without a minute-by-minute multi-year scan', () => {
    expect(nextCronOccurrence('0 9 29 2 *', UTC, Date.UTC(2026, 2, 1))).toBe(Date.UTC(2028, 1, 29, 9, 0))
  })

  it('sanitizes bounded inference-only job settings', () => {
    const job = sanitizeScheduledJob(
      {
        name: 'Morning brief',
        cron: '0 9 * * 1-5',
        timezone: UTC,
        modelPath: '/models/model.gguf',
        prompt: 'Draft today’s plan.',
        maxTokens: 99_999,
        timeoutSeconds: 1,
      },
      'schedule-12345678',
      Date.UTC(2026, 6, 12, 0, 0),
    )
    expect(job.maxTokens).toBe(4096)
    expect(job.timeoutSeconds).toBe(30)
    expect(job.nextRunAt).toBe(Date.UTC(2026, 6, 13, 9, 0))
    const request = buildScheduledInferenceRequest(job, 4096, 0.4)
    expect(request).toMatchObject({ isolated: true, autoCompact: false, contextTokens: 4096, maxTokens: 4096 })
    expect(request).not.toHaveProperty('tools')
    expect(request).not.toHaveProperty('history')
  })
})
