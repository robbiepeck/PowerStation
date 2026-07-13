# Scheduled jobs

PowerStation can run bounded recurring prompts against an installed local model. Open **Schedules**
to create, pause, test, edit, or delete a job and inspect its local run history.

Scheduled jobs are deliberately **inference-only**. They generate text, but PowerStation never
attaches MCP tools, built-in tools, skills, project context, knowledge folders, the local API, or a
shell to an unattended run. A prompt cannot expand its own permissions.

## Create and test a job

Choose **New job**, then set:

- **Name and installed model.** The model is pinned to the job. If that file is removed, the run is
  skipped safely instead of silently switching to another model.
- **Schedule and timezone.** Friendly presets cover hourly, daily, weekday, and weekly jobs. The
  cron field remains editable for precise schedules.
- **Prompt and optional system instructions.** These are the only instructions supplied to the
  isolated run.
- **Output and time limits.** Responses are capped at 64–4,096 tokens and runs at 30 seconds–15
  minutes.
- **Missed-run policy.** Skip a run missed while PowerStation was unavailable, or run once after
  wake/startup. PowerStation never replays a backlog of missed occurrences.
- **Battery and notifications.** Jobs skip on battery by default. Notifications contain status
  only—not generated text or prompts that could appear on a lock screen.

Use **Run now** to test the exact saved job. Its result enters the same ledger as an automatic run.

## Cron format

PowerStation accepts standard five-field numeric cron expressions:

```text
minute hour day-of-month month day-of-week
```

Fields support `*`, numbers, lists, increasing ranges, and steps. Sunday can be `0` or `7`.

| Expression | Meaning |
| --- | --- |
| `0 * * * *` | At the start of every hour. |
| `0 9 * * *` | Every day at 09:00. |
| `0 9 * * 1-5` | Weekdays at 09:00. |
| `30 8 * * 1` | Mondays at 08:30. |
| `*/15 8-17 * * 1-5` | Every 15 minutes during weekday working hours. |

The minimum cadence is five minutes. Timezones use IANA names such as `Australia/Brisbane` or
`Europe/London`. During daylight-saving fallback, a repeated wall-clock minute runs at most once;
a nonexistent spring-forward time is naturally skipped.

## Execution model

- Runs use the same isolated native worker and model-fit admission control as chat and the local API.
- Chat, API, comparison, and scheduled inference are serialized. If another generation owns the
  runtime when a job becomes due, the job is recorded as safely skipped rather than interrupting it.
- Two occurrences of the same job never overlap. Jobs due together run sequentially.
- Critical operating-system memory pressure skips the run. Model timeouts first request a clean
  stop, then terminate a stuck worker after a bounded grace period.
- If the scheduled run loaded a different model and idle unloading is enabled, that model is
  unloaded after the run.
- Each ledger entry records status, timestamps, model, speed, output or a bounded error. An
  interrupted `running` record becomes a failure the next time PowerStation starts.

## Application lifecycle

On macOS, closing PowerStation's window leaves the app running, so jobs continue until you choose
**PowerStation → Quit**. A packaged source installation can enable **Start PowerStation at login**
from the Schedules view. PowerStation enforces a single app instance so login startup and a manual
launch cannot create competing schedulers.

On Windows and Linux, keep the app running; closing its final window currently quits it. The UI
states this limitation rather than implying a background service exists.

PowerStation does not install privileged daemons, edit system cron files, or require administrator
access.

## Storage, privacy, and backup

Definitions and the newest 250 run records live in `scheduled-jobs.json` inside PowerStation's
private user-data directory. Writes are atomic and the file is permissioned for the current user.
**Show data** reveals it in the file manager.

Prompts and results stay local. A standard PowerStation backup includes job definitions but not run
history; restored jobs whose model is missing are paused. Model weights are never included.

Scheduled outputs can contain sensitive material. Review the ledger before sharing screenshots or
support material. PowerStation's privacy-safe diagnostics exclude schedule prompts and results.

See [Projects and backup](projects.md), [Memory and monitoring](memory-and-monitoring.md), and
[Security](../SECURITY.md).
