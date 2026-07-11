import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Bell,
  BatteryCharging,
  CalendarClock,
  CheckCircle2,
  Clock3,
  FileClock,
  History,
  Laptop,
  LoaderCircle,
  Pause,
  Play,
  Plus,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react'
import { getDesktop } from './desktop'
import type { ModelInfo, ScheduledJob, SchedulerSnapshot, ScheduleRun } from './types'
import { PanelHeader, ToggleControl } from './ui'

const bridge = getDesktop()
const localTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
const timezones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [localTimezone, 'UTC']

const PRESETS = [
  { label: 'Every hour', cron: '0 * * * *' },
  { label: 'Every morning', cron: '0 9 * * *' },
  { label: 'Weekday mornings', cron: '0 9 * * 1-5' },
  { label: 'Monday mornings', cron: '0 9 * * 1' },
]

type JobDraft = {
  id?: string
  name: string
  enabled: boolean
  cron: string
  timezone: string
  modelPath: string
  prompt: string
  systemPrompt: string
  maxTokens: number
  timeoutSeconds: number
  missedRunPolicy: 'skip' | 'run-once'
  allowOnBattery: boolean
  notify: boolean
}

function blankDraft(selectedPath: string | null): JobDraft {
  return {
    name: '',
    enabled: true,
    cron: '0 9 * * 1-5',
    timezone: localTimezone,
    modelPath: selectedPath ?? '',
    prompt: '',
    systemPrompt: '',
    maxTokens: 1024,
    timeoutSeconds: 300,
    missedRunPolicy: 'skip',
    allowOnBattery: false,
    notify: true,
  }
}

function draftFromJob(job: ScheduledJob): JobDraft {
  return {
    id: job.id,
    name: job.name,
    enabled: job.enabled,
    cron: job.cron,
    timezone: job.timezone,
    modelPath: job.modelPath,
    prompt: job.prompt,
    systemPrompt: job.systemPrompt,
    maxTokens: job.maxTokens,
    timeoutSeconds: job.timeoutSeconds,
    missedRunPolicy: job.missedRunPolicy,
    allowOnBattery: job.allowOnBattery,
    notify: job.notify,
  }
}

function dateTime(value: number | null, timezone?: string): string {
  if (!value) return 'Not scheduled'
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: timezone,
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(value)
  } catch {
    return new Date(value).toLocaleString()
  }
}

function cronSummary(cron: string): string {
  return PRESETS.find((preset) => preset.cron === cron)?.label ?? `Cron · ${cron}`
}

function runStatusText(run: ScheduleRun): string {
  if (run.status === 'running') return 'Running now'
  if (run.status === 'success') return 'Completed'
  if (run.status === 'skipped') return 'Skipped safely'
  return 'Failed'
}

export function SchedulesView({ models, selectedPath }: { models: ModelInfo[]; selectedPath: string | null }) {
  const [snapshot, setSnapshot] = useState<SchedulerSnapshot | null>(null)
  const [draft, setDraft] = useState<JobDraft | null>(null)
  const [saving, setSaving] = useState(false)
  const [busyJobId, setBusyJobId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(() => {
    void bridge.schedules.get().then(setSnapshot).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))
  }, [])

  useEffect(() => {
    refresh()
    return bridge.schedules.onChanged(setSnapshot)
  }, [refresh])

  const modelsByPath = useMemo(() => new Map(models.map((model) => [model.path, model])), [models])
  const enabledJobs = snapshot?.jobs.filter((job) => job.enabled) ?? []
  const nextJob = enabledJobs.reduce<ScheduledJob | null>(
    (next, job) => (!job.nextRunAt ? next : !next?.nextRunAt || job.nextRunAt < next.nextRunAt ? job : next),
    null,
  )

  const saveDraft = async () => {
    if (!draft) return
    setSaving(true)
    setError(null)
    try {
      await bridge.schedules.save(draft)
      setDraft(null)
      refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setSaving(false)
    }
  }

  const updateJob = async (job: ScheduledJob, patch: Partial<ScheduledJob>) => {
    setError(null)
    try {
      await bridge.schedules.save({ ...job, ...patch })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  const runNow = async (job: ScheduledJob) => {
    setBusyJobId(job.id)
    setError(null)
    try {
      await bridge.schedules.runNow(job.id)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusyJobId(null)
      refresh()
    }
  }

  const deleteJob = async (job: ScheduledJob) => {
    if (!window.confirm(`Delete “${job.name}” and its run history?`)) return
    const deleted = await bridge.schedules.delete(job.id).catch(() => false)
    if (!deleted) setError('This job could not be deleted. A running job must finish first.')
  }

  return (
    <div className="schedules-view">
      <PanelHeader
        eyebrow="Schedules"
        title="Quiet automation"
        action={
          <div className="schedule-header-actions">
            <button className="secondary-button compact" type="button" onClick={() => void bridge.schedules.reveal()}>
              <FileClock size={14} /> Show data
            </button>
            <button className="primary-button compact-primary" type="button" onClick={() => setDraft(blankDraft(selectedPath))}>
              <Plus size={15} /> New job
            </button>
          </div>
        }
      />

      <section className="schedule-command-bar" aria-label="Scheduler status">
        <div className="schedule-command-stat">
          <span className="schedule-command-icon"><CalendarClock size={18} /></span>
          <div><small>Active jobs</small><strong>{enabledJobs.length}</strong></div>
        </div>
        <div className="schedule-command-stat wide">
          <span className="schedule-command-icon"><Clock3 size={18} /></span>
          <div>
            <small>Next run</small>
            <strong>{nextJob ? `${nextJob.name} · ${dateTime(nextJob.nextRunAt, nextJob.timezone)}` : 'Nothing queued'}</strong>
          </div>
        </div>
        <div className="schedule-safety-seal">
          <ShieldCheck size={17} />
          <span><strong>Inference only</strong><small>No tools, shell, or network connectors</small></span>
        </div>
      </section>

      {error ? <div className="schedule-error"><X size={15} /> {error}</div> : null}

      <section className="schedule-background-card">
        <div>
          <Laptop size={18} />
          <span><strong>Background readiness</strong><small>{snapshot?.backgroundNote ?? 'Checking scheduler…'}</small></span>
        </div>
        {snapshot?.openAtLoginSupported ? (
          <ToggleControl
            label="Start PowerStation at login"
            checked={snapshot.openAtLogin}
            onChange={(enabled) => void bridge.schedules.setOpenAtLogin(enabled).then(setSnapshot).catch((reason) => setError(String(reason)))}
          />
        ) : null}
      </section>

      <div className="schedule-workspace">
        <section className="schedule-jobs-column">
          <div className="schedule-section-heading">
            <div><span>Job register</span><small>{snapshot?.jobs.length ?? 0} configured</small></div>
          </div>
          {!snapshot ? (
            <div className="schedule-empty"><LoaderCircle className="spin-icon" size={20} /> Loading schedules…</div>
          ) : snapshot.jobs.length === 0 ? (
            <div className="schedule-empty">
              <CalendarClock size={28} />
              <strong>No scheduled work</strong>
              <p>Create a bounded local prompt such as a morning plan, recurring draft, or weekly reflection.</p>
              <button className="secondary-button" type="button" onClick={() => setDraft(blankDraft(selectedPath))}>
                Create the first job
              </button>
            </div>
          ) : (
            <div className="schedule-job-list">
              {snapshot.jobs.map((job) => {
                const model = modelsByPath.get(job.modelPath)
                const running = snapshot.runningJobIds.includes(job.id) || busyJobId === job.id
                const lastRun = snapshot.runs.find((run) => run.jobId === job.id)
                return (
                  <article className={`schedule-job-card${job.enabled ? '' : ' paused'}`} key={job.id}>
                    <div className="schedule-job-rail" />
                    <div className="schedule-job-head">
                      <div>
                        <span className="schedule-job-state">{running ? 'running' : job.enabled ? 'armed' : 'paused'}</span>
                        <h3>{job.name}</h3>
                      </div>
                      <button
                        className="schedule-pause-button"
                        type="button"
                        disabled={running}
                        aria-label={job.enabled ? `Pause ${job.name}` : `Enable ${job.name}`}
                        onClick={() => void updateJob(job, { enabled: !job.enabled })}
                      >
                        {job.enabled ? <Pause size={14} /> : <Play size={14} />}
                        {job.enabled ? 'Pause' : 'Enable'}
                      </button>
                    </div>
                    <div className="schedule-job-meta">
                      <span><Clock3 size={13} /> {cronSummary(job.cron)}</span>
                      <span>{job.timezone}</span>
                      <span>{model?.name ?? 'Model missing'}</span>
                    </div>
                    <p className="schedule-job-prompt">{job.prompt}</p>
                    <div className="schedule-job-timing">
                      <div><small>Next</small><strong>{job.enabled ? dateTime(job.nextRunAt, job.timezone) : 'Paused'}</strong></div>
                      <div><small>Last</small><strong>{lastRun ? runStatusText(lastRun) : 'Never run'}</strong></div>
                    </div>
                    <div className="schedule-job-actions">
                      <button className="primary-button compact-primary" type="button" disabled={running || !model} onClick={() => void runNow(job)}>
                        {running ? <LoaderCircle className="spin-icon" size={14} /> : <Play size={14} />}
                        {running ? 'Running…' : 'Run now'}
                      </button>
                      <button className="secondary-button compact" type="button" disabled={running} onClick={() => setDraft(draftFromJob(job))}>Edit</button>
                      <button className="ghost-button danger" type="button" disabled={running} onClick={() => void deleteJob(job)} aria-label={`Delete ${job.name}`}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </section>

        <section className="schedule-ledger-column">
          <div className="schedule-section-heading">
            <div><span>Run ledger</span><small>Newest first · stored locally</small></div>
            <History size={16} />
          </div>
          {!snapshot?.runs.length ? (
            <div className="schedule-ledger-empty">Completed, skipped, and failed runs will appear here.</div>
          ) : (
            <div className="schedule-run-list">
              {snapshot.runs.slice(0, 40).map((run) => (
                <details className={`schedule-run-row ${run.status}`} key={run.id}>
                  <summary>
                    <span className="schedule-run-marker">
                      {run.status === 'running' ? <LoaderCircle className="spin-icon" size={14} /> : run.status === 'success' ? <CheckCircle2 size={14} /> : <X size={14} />}
                    </span>
                    <span className="schedule-run-title"><strong>{run.jobName}</strong><small>{dateTime(run.startedAt)}</small></span>
                    <span className="schedule-run-status">{runStatusText(run)}</span>
                  </summary>
                  <div className="schedule-run-detail">
                    <div className="schedule-run-facts">
                      <span>{run.modelName}</span>
                      {run.tokensPerSec ? <span>{run.tokensPerSec.toFixed(1)} tok/s</span> : null}
                      {run.finishedAt ? <span>{Math.max(0, Math.round((run.finishedAt - run.startedAt) / 1000))}s</span> : null}
                    </div>
                    {run.output ? <pre>{run.output}</pre> : null}
                    {run.error ? <p className="schedule-run-error">{run.error}</p> : null}
                  </div>
                </details>
              ))}
            </div>
          )}
        </section>
      </div>

      {draft ? (
        <div className="schedule-editor-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setDraft(null)}>
          <form className="schedule-editor" onSubmit={(event) => { event.preventDefault(); void saveDraft() }}>
            <div className="schedule-editor-head">
              <div><small>{draft.id ? 'Edit schedule' : 'New schedule'}</small><h2>{draft.id ? draft.name : 'Create a local job'}</h2></div>
              <button className="icon-button" type="button" onClick={() => setDraft(null)} aria-label="Close schedule editor"><X size={18} /></button>
            </div>

            <div className="schedule-editor-safety"><ShieldCheck size={16} /><span>This run can only generate text with the chosen local model. Tools and connectors are never attached.</span></div>

            <label className="schedule-field">
              <span>Name</span>
              <input required maxLength={100} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Morning planning brief" />
            </label>
            <label className="schedule-field">
              <span>Installed model</span>
              <select required value={draft.modelPath} onChange={(event) => setDraft({ ...draft, modelPath: event.target.value })}>
                <option value="">Choose a model…</option>
                {models.map((model) => <option value={model.path} key={model.path}>{model.name}</option>)}
              </select>
            </label>

            <fieldset className="schedule-time-fieldset">
              <legend>When it runs</legend>
              <div className="schedule-presets">
                {PRESETS.map((preset) => (
                  <button className={draft.cron === preset.cron ? 'active' : ''} type="button" key={preset.cron} onClick={() => setDraft({ ...draft, cron: preset.cron })}>{preset.label}</button>
                ))}
              </div>
              <div className="schedule-time-grid">
                <label className="schedule-field"><span>Cron expression</span><input required value={draft.cron} onChange={(event) => setDraft({ ...draft, cron: event.target.value })} spellCheck={false} /></label>
                <label className="schedule-field"><span>Timezone</span><input required list="powerstation-timezones" value={draft.timezone} onChange={(event) => setDraft({ ...draft, timezone: event.target.value })} /></label>
                <datalist id="powerstation-timezones">{timezones.map((zone) => <option value={zone} key={zone} />)}</datalist>
              </div>
              <small className="schedule-cron-help">Five fields: minute · hour · day · month · weekday. Numeric values only; minimum cadence is five minutes.</small>
            </fieldset>

            <label className="schedule-field">
              <span>Prompt</span>
              <textarea required maxLength={50_000} rows={6} value={draft.prompt} onChange={(event) => setDraft({ ...draft, prompt: event.target.value })} placeholder="Create a concise plan for today using these standing priorities…" />
            </label>
            <label className="schedule-field">
              <span>System instructions <small>optional</small></span>
              <textarea maxLength={20_000} rows={3} value={draft.systemPrompt} onChange={(event) => setDraft({ ...draft, systemPrompt: event.target.value })} placeholder="Return Markdown with three headings. Do not invent dates." />
            </label>

            <div className="schedule-limits-grid">
              <label className="schedule-field"><span>Max output tokens</span><input type="number" min={64} max={4096} step={64} value={draft.maxTokens} onChange={(event) => setDraft({ ...draft, maxTokens: Number(event.target.value) })} /></label>
              <label className="schedule-field"><span>Time limit</span><select value={draft.timeoutSeconds} onChange={(event) => setDraft({ ...draft, timeoutSeconds: Number(event.target.value) })}><option value={60}>1 minute</option><option value={180}>3 minutes</option><option value={300}>5 minutes</option><option value={600}>10 minutes</option><option value={900}>15 minutes</option></select></label>
              <label className="schedule-field"><span>If a run was missed</span><select value={draft.missedRunPolicy} onChange={(event) => setDraft({ ...draft, missedRunPolicy: event.target.value as JobDraft['missedRunPolicy'] })}><option value="skip">Skip it</option><option value="run-once">Run once after wake</option></select></label>
            </div>

            <div className="schedule-option-row">
              <label><input type="checkbox" checked={draft.allowOnBattery} onChange={(event) => setDraft({ ...draft, allowOnBattery: event.target.checked })} /><BatteryCharging size={15} /><span>Allow on battery</span></label>
              <label><input type="checkbox" checked={draft.notify} onChange={(event) => setDraft({ ...draft, notify: event.target.checked })} /><Bell size={15} /><span>Notify when finished</span></label>
            </div>

            <div className="schedule-editor-actions">
              <button className="ghost-button" type="button" onClick={() => setDraft(null)}>Cancel</button>
              <button className="primary-button" type="submit" disabled={saving}>{saving ? <LoaderCircle className="spin-icon" size={15} /> : null}{saving ? 'Validating…' : 'Save schedule'}</button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  )
}
